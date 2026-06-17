// Browser/Node-side verification of a SentinelMem case file's agent signature,
// using WebCrypto Ed25519 (crypto.subtle). This is the same integrity gate the
// agent runs on recall, runnable in the UI so anyone can independently confirm a
// memory record on Walrus has not been tampered — without trusting our server.
//
// Note: this verifies the AGENT SIGNATURE only (record integrity + authenticity).
// Re-verifying the underlying TLSNotary proof requires the node harness; the UI
// surfaces the PROVEN tier + a link to the proof blob, which the verifier node
// re-checks.

import { canonicalCaseFileMessage, type CaseFileEntry } from "./memory";

// WebCrypto wants ArrayBuffer-backed views (BufferSource), not the default
// Uint8Array<ArrayBufferLike>, so allocate over a fresh ArrayBuffer.
function bytes(input: string, fromBase64 = false): Uint8Array<ArrayBuffer> {
  const src = fromBase64
    ? Uint8Array.from(atob(input), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(input);
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

export type MemoryVerifyStatus =
  | "verified" // signature valid (and trusted-key-pinned, if a key was provided)
  | "tampered" // signature does not match the current record bytes
  | "untrusted-signer" // valid envelope but not signed by the pinned key
  | "unsigned" // no integrity envelope
  | "unsupported"; // this runtime can't do Ed25519 in WebCrypto

export interface MemoryVerifyResult {
  status: MemoryVerifyStatus;
  reason: string;
  signerPublicKey?: string;
}

/**
 * Verify a case file's Ed25519 signature over its canonical message. If
 * `trustedSignerKey` (base64 SPKI DER) is given, the entry's signer must match
 * it (pinning); otherwise the signature is verified against its own embedded key
 * (self-consistent but unpinned).
 */
export async function verifyCaseFileSignature(
  entry: CaseFileEntry,
  trustedSignerKey?: string,
): Promise<MemoryVerifyResult> {
  if (!entry.integrity) {
    return { status: "unsigned", reason: "no signature envelope on this record" };
  }
  const { signerPublicKey, signature } = entry.integrity;
  if (trustedSignerKey && signerPublicKey !== trustedSignerKey) {
    return {
      status: "untrusted-signer",
      reason: "signed by a key that is not the pinned agent key",
      signerPublicKey,
    };
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return { status: "unsupported", reason: "WebCrypto subtle unavailable" };
  }
  try {
    const key = await subtle.importKey(
      "spki",
      bytes(signerPublicKey, true),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const msg = bytes(canonicalCaseFileMessage(entry));
    const ok = await subtle.verify("Ed25519", key, bytes(signature, true), msg);
    return ok
      ? { status: "verified", reason: "Ed25519 signature valid", signerPublicKey }
      : { status: "tampered", reason: "signature does not match the record", signerPublicKey };
  } catch (err) {
    return {
      status: "unsupported",
      reason: `Ed25519 not verifiable in this runtime: ${(err as Error).message}`,
      signerPublicKey,
    };
  }
}
