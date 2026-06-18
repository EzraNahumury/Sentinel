// SentinelMem orchestrator: investigate(url) = recall -> prove -> analyze -> remember.
//
//  1. RECALL the host's prior memory and re-verify every PROVEN entry against
//     its TLSNotary proof. An entry whose proof no longer verifies, or whose
//     recorded content hash no longer matches the proof, is REJECTED as tampered
//     and never reaches the analyst.
//  2. PROVE the target: capture + TLSNotary proof (PROVEN) or a flagged
//     UNVERIFIED capture.
//  3. ANALYZE with the LLM agent over the proven evidence + the trusted memory.
//  4. REMEMBER: append a new case file to the host's append-only Walrus memory.

import { SentinelProvenance } from "./provenance";
import { analyze, ANALYST_MODEL } from "./analyst";
import { type Signer, verifyEntrySignature } from "./signer";
import { type OnAnchor } from "./onchain";
import {
  hostKey,
  appendCaseFile,
  recallCaseFiles,
  canonicalCaseFileMessage,
  type AnchorStore,
  type CaseFileEntry,
  type MemoryWalrusOptions,
  type VerifyEntryFn,
} from "../../src/lib/memory";

export interface InvestigateResult {
  host: string;
  url: string;
  tier: "PROVEN" | "UNVERIFIED";
  provenanceReason: string;
  verdict: string;
  confidence: number;
  rationale: string;
  recallUsed: boolean;
  recalledVerified: number;
  recalledRejected: Array<{ blobId: string; reason: string }>;
  contentHash: string;
  cloakingClusters: number;
  entryBlobId: string;
  manifestBlobId: string;
  proofBlobId: string;
  screenshotBlobId: string;
  onchainDigest?: string;
}

export async function investigate(
  prov: SentinelProvenance,
  anchors: AnchorStore,
  signer: Signer,
  url: string,
  opts: MemoryWalrusOptions = {},
  onAnchor?: OnAnchor,
  owner?: string,
): Promise<InvestigateResult> {
  const host = hostKey(url);
  // Namespace the memory chain per owner wallet when provided (per-wallet silo);
  // otherwise it's the shared, host-keyed memory. entry.host stays the real host.
  const nsKey = owner ? `${owner.toLowerCase()}::${host}` : host;

  // 1. Recall + re-verify. The agent only ever trusts memory it can prove is
  //    (a) authentic and untampered, and (b) provenance-backed for THIS host.
  const verifyEntry: VerifyEntryFn = async (entry) => {
    // (a) Integrity: reject unsigned entries, entries signed by an untrusted key,
    //     and any record whose signature doesn't cover its current fields. This
    //     alone defeats verdict-flips, tier-flips, host swaps and field edits —
    //     a third party cannot re-sign without the agent's pinned key.
    if (!entry.integrity) {
      return { ok: false, reason: "unsigned record — excluded from trusted recall" };
    }
    if (entry.integrity.signerPublicKey !== signer.publicKeyB64) {
      return { ok: false, reason: "untrusted signer key — excluded" };
    }
    const msg = canonicalCaseFileMessage(entry);
    if (!verifyEntrySignature(msg, entry.integrity.signerPublicKey, entry.integrity.signature)) {
      return { ok: false, reason: "signature invalid — record tampered" };
    }

    // (b) Provenance: an entry that claims a TLSNotary proof must re-verify
    //     against THIS host (never the attacker-supplied provenServerName), and
    //     its content hash must be present and match the freshly derived one.
    //     Entries with no proof are authentic but not provenance-backed, so they
    //     are not fed to the analyst as trustworthy.
    if (!entry.tlsnProofBlobId) {
      return { ok: false, reason: "unverified (no proof) — excluded from trusted recall" };
    }
    const v = await prov.verifyStoredProof(entry.tlsnProofBlobId, entry.host);
    if (!v.ok) return { ok: false, reason: `proof re-verification failed: ${v.reason}` };
    if (
      !entry.contentHash ||
      !v.contentHash ||
      v.contentHash.toLowerCase() !== entry.contentHash.toLowerCase()
    ) {
      return { ok: false, reason: "content-hash missing or mismatched — record tampered" };
    }
    return { ok: true, reason: "signature + proof re-verified" };
  };

  const recalled = await recallCaseFiles(nsKey, anchors, opts, verifyEntry);

  // 2. Prove the target.
  const ev = await prov.proveUrl(url);

  // 3. Analyze with the agent over proven evidence + trusted memory.
  const verdict = await analyze({
    host,
    url,
    tier: ev.tier,
    provenanceReason: ev.reason,
    contentHash: ev.contentHash,
    renderHash: ev.renderHash,
    httpStatus: ev.httpStatus,
    htmlExcerpt: ev.html.slice(0, 12000),
    priorCaseFiles: recalled.verified.map((v) => v.entry),
    vantages: ev.vantages,
    cloakingClusters: ev.cloakingClusters,
  });

  // 4. Remember.
  const entry: CaseFileEntry = {
    schema: "sentinelmem.case-file.v1",
    host,
    url,
    observedAt: new Date().toISOString(),
    tier: ev.tier,
    tlsnProofBlobId: ev.proofBlobId,
    screenshotBlobId: ev.screenshotBlobId,
    htmlBlobId: ev.htmlBlobId,
    contentHash: ev.contentHash,
    renderHash: ev.renderHash,
    provenServerName: ev.provenServerName,
    httpStatus: ev.httpStatus,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    model: ANALYST_MODEL,
    recalledEntryBlobIds: recalled.verified.map((v) => v.blobId),
  };
  // Sign the record so any later tamper is mechanically detected on recall.
  entry.integrity = {
    alg: "ed25519",
    signerPublicKey: signer.publicKeyB64,
    signature: signer.sign(canonicalCaseFileMessage(entry)),
  };
  const { entryBlobId, manifestBlobId } = await appendCaseFile(
    entry,
    anchors,
    opts,
    nsKey,
  );

  // Optional: anchor the new manifest pointer on-chain (append-only audit).
  let onchainDigest: string | undefined;
  if (onAnchor) {
    try {
      onchainDigest = await onAnchor(host, manifestBlobId);
    } catch (err) {
      console.warn(`  on-chain anchor skipped: ${(err as Error).message}`);
    }
  }

  return {
    host,
    url,
    tier: ev.tier,
    provenanceReason: ev.reason,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    recallUsed: verdict.recall_used,
    recalledVerified: recalled.verified.length,
    recalledRejected: recalled.rejected,
    contentHash: ev.contentHash,
    cloakingClusters: ev.cloakingClusters,
    entryBlobId,
    manifestBlobId,
    proofBlobId: ev.proofBlobId,
    screenshotBlobId: ev.screenshotBlobId,
    onchainDigest,
  };
}
