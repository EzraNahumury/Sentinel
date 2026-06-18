// SentinelMem — verifiable agent memory on Walrus.
//
// An AI analyst agent writes one "case file" per investigation and chains them
// into a per-host, append-only memory. Every memory entry that carries a
// TLSNotary proof can be independently re-verified on recall (see the
// `VerifyEntryFn` injected by the agent), so a recalled fact is not "the LLM
// says it saw X" but "here is a re-checkable proof that host X served exactly
// this content". Tampered or unprovable PROVEN entries are mechanically
// rejected before the agent is allowed to act on them.
//
// Storage model: each CaseFileEntry and each HostManifest is a distinct Walrus
// blob (immutable, content-addressed). A manifest lists the ordered case-file
// blob ids for a host and links to the previous manifest, forming an append-only
// audit chain. The only mutable pointer is host -> latest-manifest-blob-id, kept
// in an `AnchorStore` (a local file for the MVP; an on-chain anchor in
// production — see move/scan_market/sources/sentinel_memory.move).
//
// This module is isomorphic (browser + node): it only uses `fetch` via walrus.ts
// and never imports node APIs, so the React UI can read memory the same way the
// agent writes it.

import {
  uploadToWalrus,
  walrusAggregatorUrl,
  DEFAULT_WALRUS_AGGREGATOR,
} from "./walrus";

export type ProvenanceTier = "PROVEN" | "UNVERIFIED";
export type Verdict =
  | "phishing"
  | "cloaking"
  | "suspicious"
  | "benign"
  | "unknown";

/**
 * Signature over a case file's integrity-relevant fields, written by the agent.
 * On recall the signature is re-checked against a PINNED signer key, so a
 * third party who can edit a Walrus blob cannot forge or tamper a memory: any
 * change to verdict/host/contentHash/etc. breaks the signature and the entry is
 * rejected. This binds the agent's DECISION to the record — the TLSNotary proof
 * only attests host+content, not the verdict.
 */
export interface IntegrityEnvelope {
  alg: "ed25519";
  signerPublicKey: string; // base64 SPKI DER
  signature: string; // base64
}

/** One investigation, stored as a single Walrus blob. */
export interface CaseFileEntry {
  schema: "sentinelmem.case-file.v1";
  host: string;
  url: string;
  observedAt: string; // ISO 8601
  /**
   * PROVEN  — backed by a TLSNotary proof; `contentHash` is the hash of the
   *           cryptographically proven transcript and is re-checkable.
   * UNVERIFIED — captured but not provable (e.g. TLS 1.3 target); kept as a
   *           visibly-flagged lead, NOT a cryptographic guarantee.
   */
  tier: ProvenanceTier;
  // Evidence pointers — all on Walrus.
  tlsnProofBlobId: string; // "" when UNVERIFIED
  screenshotBlobId: string;
  htmlBlobId: string;
  contentHash: string; // proof-transcript hash (PROVEN) — bound to the TLSNotary proof for tamper-check
  /**
   * Hash of the rendered DOM (normalized), computed identically regardless of
   * tier. This is the COMPARABLE join key for cloaking + cross-time change
   * detection — `contentHash` is not comparable across tiers (transcript hash
   * on PROVEN vs DOM hash on UNVERIFIED).
   */
  renderHash?: string;
  provenServerName: string;
  httpStatus: number;
  // The analyst agent's reasoning over the proven evidence + recalled memory.
  verdict: Verdict;
  confidence: number; // 0.0 - 1.0
  rationale: string;
  model: string;
  // Which prior memory entries (by blob id) the agent recalled and trusted.
  recalledEntryBlobIds: string[];
  // Agent signature over the fields above (set on write; verified on recall).
  integrity?: IntegrityEnvelope;
}

/**
 * Deterministic, canonical serialization of a case file's integrity-relevant
 * fields (everything EXCEPT the integrity envelope itself). Both signing (on
 * write) and verification (on recall) hash exactly this string, so any tamper
 * to any included field is detected.
 */
export function canonicalCaseFileMessage(e: CaseFileEntry): string {
  return JSON.stringify([
    e.schema,
    e.host,
    e.url,
    e.observedAt,
    e.tier,
    e.tlsnProofBlobId,
    e.screenshotBlobId,
    e.htmlBlobId,
    e.contentHash,
    e.renderHash ?? "",
    e.provenServerName,
    e.httpStatus,
    e.verdict,
    e.confidence,
    e.rationale,
    e.model,
    e.recalledEntryBlobIds,
  ]);
}

/** Per-host append-only index of case-file blobs, itself stored on Walrus. */
export interface HostManifest {
  schema: "sentinelmem.manifest.v1";
  host: string;
  updatedAt: string;
  entries: string[]; // ordered case-file blob ids, oldest -> newest
  prevManifestBlobId: string | null; // append-only audit chain to the prior manifest
}

/** The one mutable pointer: host -> latest manifest blob id. */
/**
 * A second-agent (Auditor) attestation over an Analyst's case file. The auditor
 * trusts memory it did NOT create by re-verifying the Analyst's signature
 * against a PINNED analyst key (not by trusting a live peer) — trust-minimized
 * cross-agent coordination. Signed by the auditor's own key.
 */
export interface AuditRecord {
  schema: "sentinelmem.audit.v1";
  auditor: string; // auditor public key (base64 SPKI DER)
  host: string;
  analystSigner: string; // the analyst key the auditor pinned
  analystEntryBlobId: string; // the case file being audited
  signatureValid: boolean;
  proofVerified: boolean | null; // null when not checked (e.g. notary unavailable / UNVERIFIED tier)
  attestation: "concur" | "dissent" | "unverifiable";
  reason: string;
  auditedAt: string;
  integrity?: IntegrityEnvelope; // auditor's signature over this audit record
}

/** Canonical message the auditor signs (excludes the integrity envelope). */
export function canonicalAuditMessage(a: AuditRecord): string {
  return JSON.stringify([
    a.schema,
    a.auditor,
    a.host,
    a.analystSigner,
    a.analystEntryBlobId,
    a.signatureValid,
    a.proofVerified,
    a.attestation,
    a.reason,
    a.auditedAt,
  ]);
}

export interface AnchorStore {
  get(host: string): Promise<string | null>;
  set(host: string, manifestBlobId: string): Promise<void>;
}

/** In-memory anchor store (tests / ephemeral runs). */
export class InMemoryAnchorStore implements AnchorStore {
  private readonly map = new Map<string, string>();
  async get(host: string): Promise<string | null> {
    return this.map.get(host) ?? null;
  }
  async set(host: string, manifestBlobId: string): Promise<void> {
    this.map.set(host, manifestBlobId);
  }
}

/**
 * A Seal-encrypted case file, stored on Walrus in place of the plaintext entry.
 * The signed `CaseFileEntry` (integrity envelope included) is encrypted whole, so
 * decryption yields a record whose signature still re-verifies. `sealId` is the
 * Seal key-id used at encryption and must be presented again to decrypt.
 */
export interface SealedEnvelope {
  schema: "sentinelmem.sealed.v1";
  sealId: string;
  ciphertext: string; // base64 of the Seal-encrypted case file JSON
}

/**
 * Optional encrypt/decrypt hook for case files. Kept dependency-free here (an
 * interface only) so this module stays isomorphic; the agent supplies a Seal
 * implementation (see scripts/sentinel/seal-cipher.ts) when SENTINEL_SEAL=1.
 * Manifests stay plaintext — only the per-investigation case file is encrypted.
 */
export interface CaseFileCipher {
  seal(entry: CaseFileEntry): Promise<SealedEnvelope>;
  open(env: SealedEnvelope): Promise<CaseFileEntry>;
}

export interface MemoryWalrusOptions {
  publisher?: string;
  aggregator?: string;
  /** Walrus blob lifetime in epochs. Memory must outlive a single demo, so
   *  default higher than the evidence-blob default of 1. */
  epochs?: number;
  /** When set, case files are encrypted with this cipher before Walrus and
   *  decrypted on recall. Off by default (plaintext memory). */
  cipher?: CaseFileCipher;
}

/** Normalized host key for a URL (the memory is keyed by host). */
export function hostKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

async function fetchJson<T>(blobId: string, aggregator: string): Promise<T> {
  const res = await fetch(walrusAggregatorUrl(blobId, aggregator), {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Walrus fetch ${res.status} for blob ${blobId}`);
  return (await res.json()) as T;
}

export async function writeCaseFile(
  entry: CaseFileEntry,
  opts: MemoryWalrusOptions = {},
): Promise<string> {
  const payload = opts.cipher ? await opts.cipher.seal(entry) : entry;
  return uploadToWalrus(JSON.stringify(payload), {
    publisher: opts.publisher,
    epochs: opts.epochs ?? 5,
    contentType: "application/json",
  });
}

export async function readCaseFile(
  blobId: string,
  aggregator: string = DEFAULT_WALRUS_AGGREGATOR,
  cipher?: CaseFileCipher,
): Promise<CaseFileEntry> {
  const raw = await fetchJson<CaseFileEntry | SealedEnvelope>(blobId, aggregator);
  if (isSealedEnvelope(raw)) {
    if (!cipher) {
      throw new Error(
        "case file is Seal-encrypted — a reader cipher is required to recall it",
      );
    }
    return cipher.open(raw);
  }
  return raw as CaseFileEntry;
}

export function isSealedEnvelope(x: unknown): x is SealedEnvelope {
  return (x as SealedEnvelope | null)?.schema === "sentinelmem.sealed.v1";
}

/** Fetch a case-file blob WITHOUT decrypting — returns the plaintext entry or,
 *  for an encrypted record, the sealed envelope (so the UI can offer to decrypt). */
export async function readEntryRaw(
  blobId: string,
  aggregator: string = DEFAULT_WALRUS_AGGREGATOR,
): Promise<CaseFileEntry | SealedEnvelope> {
  return fetchJson<CaseFileEntry | SealedEnvelope>(blobId, aggregator);
}

async function writeManifest(
  manifest: HostManifest,
  opts: MemoryWalrusOptions,
): Promise<string> {
  return uploadToWalrus(JSON.stringify(manifest), {
    publisher: opts.publisher,
    epochs: opts.epochs ?? 5,
    contentType: "application/json",
  });
}

export async function readManifest(
  blobId: string,
  aggregator: string = DEFAULT_WALRUS_AGGREGATOR,
): Promise<HostManifest> {
  return fetchJson<HostManifest>(blobId, aggregator);
}

/**
 * Append a case file to a host's memory: write the entry blob, read the prior
 * manifest (if any), write a new manifest that appends the entry and links the
 * previous manifest, and move the anchor to the new manifest. Returns the new
 * blob ids so the caller can anchor them on-chain or display them.
 */
export async function appendCaseFile(
  entry: CaseFileEntry,
  anchors: AnchorStore,
  opts: MemoryWalrusOptions = {},
): Promise<{ entryBlobId: string; manifestBlobId: string }> {
  const aggregator = opts.aggregator ?? DEFAULT_WALRUS_AGGREGATOR;
  const entryBlobId = await writeCaseFile(entry, opts);

  const prevManifestBlobId = await anchors.get(entry.host);
  let prevEntries: string[] = [];
  if (prevManifestBlobId) {
    try {
      const prev = await readManifest(prevManifestBlobId, aggregator);
      prevEntries = prev.entries;
    } catch {
      // A missing/expired prior manifest must not block new memory; start a new
      // chain but still record the broken link for the audit trail.
    }
  }

  const manifest: HostManifest = {
    schema: "sentinelmem.manifest.v1",
    host: entry.host,
    updatedAt: entry.observedAt,
    entries: [...prevEntries, entryBlobId],
    prevManifestBlobId: prevManifestBlobId ?? null,
  };
  const manifestBlobId = await writeManifest(manifest, opts);
  await anchors.set(entry.host, manifestBlobId);
  return { entryBlobId, manifestBlobId };
}

/**
 * Verifier callback the agent injects. Re-checks a recalled entry (re-verify the
 * TLSNotary proof, recompute the content hash, compare against the stored hash)
 * and returns whether the agent may trust it.
 */
export type VerifyEntryFn = (
  entry: CaseFileEntry,
) => Promise<{ ok: boolean; reason: string }>;

export interface RecalledMemory {
  /** Entries the agent is allowed to trust, paired with their blob ids. */
  verified: Array<{ blobId: string; entry: CaseFileEntry }>;
  /** Entries dropped on recall (unreadable, tampered, or failed re-verification). */
  rejected: Array<{ blobId: string; reason: string }>;
  manifestBlobId: string | null;
}

/**
 * Recall a host's memory: resolve the anchor, walk the manifest, fetch each
 * case file, and (if a verifier is provided) re-verify every entry — dropping
 * any that fail. A fresh process recalls the full history by host key because
 * the memory lives on Walrus, not in the process.
 */
export async function recallCaseFiles(
  host: string,
  anchors: AnchorStore,
  opts: MemoryWalrusOptions = {},
  verifyEntry?: VerifyEntryFn,
): Promise<RecalledMemory> {
  const aggregator = opts.aggregator ?? DEFAULT_WALRUS_AGGREGATOR;
  const manifestBlobId = await anchors.get(host);
  if (!manifestBlobId) {
    return { verified: [], rejected: [], manifestBlobId: null };
  }

  let manifest: HostManifest;
  try {
    manifest = await readManifest(manifestBlobId, aggregator);
  } catch (err) {
    return {
      verified: [],
      rejected: [
        { blobId: manifestBlobId, reason: `manifest unreadable: ${(err as Error).message}` },
      ],
      manifestBlobId,
    };
  }

  const verified: RecalledMemory["verified"] = [];
  const rejected: RecalledMemory["rejected"] = [];
  for (const blobId of manifest.entries) {
    let entry: CaseFileEntry;
    try {
      entry = await readCaseFile(blobId, aggregator, opts.cipher);
    } catch (err) {
      rejected.push({ blobId, reason: `unreadable: ${(err as Error).message}` });
      continue;
    }
    if (verifyEntry) {
      const v = await verifyEntry(entry);
      if (!v.ok) {
        rejected.push({ blobId, reason: v.reason });
        continue;
      }
    }
    verified.push({ blobId, entry });
  }
  return { verified, rejected, manifestBlobId };
}
