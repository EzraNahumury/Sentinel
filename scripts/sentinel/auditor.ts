// SentinelMem Auditor — the second agent (multi-agent coordination).
//
// The Auditor consumes the Analyst's memory from Walrus and INDEPENDENTLY
// re-verifies each case file by checking the Analyst's Ed25519 signature against
// a PINNED analyst key — it trusts the data because it can re-verify it, NOT
// because it trusts a live peer connection. It then emits its own signed
// `AuditRecord` (auditor key) to Walrus, referencing the analyst entry. This is
// trust-minimized cross-agent delegation: Analyst produces → Auditor attests,
// both signing their own records, sharing context purely through Walrus.

import {
  readManifest,
  readCaseFile,
  canonicalCaseFileMessage,
  canonicalAuditMessage,
  type AuditRecord,
} from "../../src/lib/memory";
import { uploadToWalrus } from "../../src/lib/walrus";
import { verifyEntrySignature, type Signer } from "./signer";

export interface AuditOptions {
  host: string;
  manifestBlobId: string;
  analystSigner: string; // analyst public key to pin (trust anchor)
  auditor: Signer;
  aggregator?: string;
  publisher?: string;
  epochs?: number;
}

export interface AuditResult {
  analystEntryBlobId: string;
  attestation: AuditRecord["attestation"];
  reason: string;
  auditBlobId: string;
}

async function signAndUpload(rec: AuditRecord, opts: AuditOptions): Promise<string> {
  rec.integrity = {
    alg: "ed25519",
    signerPublicKey: opts.auditor.publicKeyB64,
    signature: opts.auditor.sign(canonicalAuditMessage(rec)),
  };
  return uploadToWalrus(JSON.stringify(rec), {
    publisher: opts.publisher,
    contentType: "application/json",
    epochs: opts.epochs ?? 5,
  });
}

function record(
  opts: AuditOptions,
  blobId: string,
  signatureValid: boolean,
  attestation: AuditRecord["attestation"],
  reason: string,
): AuditRecord {
  return {
    schema: "sentinelmem.audit.v1",
    auditor: opts.auditor.publicKeyB64,
    host: opts.host,
    analystSigner: opts.analystSigner,
    analystEntryBlobId: blobId,
    signatureValid,
    proofVerified: null, // signature is the cross-agent trust anchor; proof re-check is the node verifier's job
    attestation,
    reason,
    auditedAt: new Date().toISOString(),
  };
}

export async function auditHost(opts: AuditOptions): Promise<AuditResult[]> {
  const manifest = await readManifest(opts.manifestBlobId, opts.aggregator);
  const results: AuditResult[] = [];

  for (const blobId of manifest.entries) {
    let signatureValid = false;
    let attestation: AuditRecord["attestation"] = "dissent";
    let reason = "";

    try {
      const entry = await readCaseFile(blobId, opts.aggregator);
      if (!entry.integrity) {
        attestation = "dissent";
        reason = "analyst record is unsigned";
      } else if (entry.integrity.signerPublicKey !== opts.analystSigner) {
        attestation = "dissent";
        reason = "signed by a non-pinned (untrusted) analyst key";
      } else {
        signatureValid = verifyEntrySignature(
          canonicalCaseFileMessage(entry),
          entry.integrity.signerPublicKey,
          entry.integrity.signature,
        );
        attestation = signatureValid ? "concur" : "dissent";
        reason = signatureValid
          ? "analyst signature independently re-verified by the auditor"
          : "analyst signature invalid — record tampered (rejected by the auditor)";
      }
    } catch (err) {
      attestation = "unverifiable";
      reason = `analyst record unreadable: ${(err as Error).message}`;
    }

    const rec = record(opts, blobId, signatureValid, attestation, reason);
    const auditBlobId = await signAndUpload(rec, opts);
    results.push({ analystEntryBlobId: blobId, attestation, reason, auditBlobId });
  }

  return results;
}
