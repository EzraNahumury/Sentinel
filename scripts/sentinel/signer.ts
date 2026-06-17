// SentinelMem agent signer — binds the agent's DECISION to each memory record.
//
// Every case file is signed with the agent's Ed25519 key over the canonical
// integrity message (see canonicalCaseFileMessage in src/lib/memory.ts). On
// recall the signature is verified against a PINNED signer key, so a third
// party who can write/edit a Walrus blob cannot forge or tamper a memory: any
// change to verdict/host/contentHash/etc. breaks the signature.
//
// Uses Node's built-in ed25519 (no extra dependency). The key persists at a
// PEM path so the agent's identity is stable across sessions.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";

export interface Signer {
  /** base64 SPKI DER public key — pin this on recall. */
  publicKeyB64: string;
  /** Detached ed25519 signature (base64) over the UTF-8 bytes of `msg`. */
  sign(msg: string): string;
}

export async function loadOrCreateSigner(path: string): Promise<Signer> {
  let pem: string;
  try {
    pem = await readFile(path, "utf8");
  } catch {
    const { privateKey } = generateKeyPairSync("ed25519");
    pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, pem, { mode: 0o600 });
  }
  const priv = createPrivateKey(pem);
  const pub = createPublicKey(priv);
  const publicKeyB64 = (pub.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  return {
    publicKeyB64,
    sign(msg: string): string {
      // ed25519 requires the algorithm arg to be null.
      return nodeSign(null, Buffer.from(msg, "utf8"), priv).toString("base64");
    },
  };
}

/** Verify a detached ed25519 signature. Returns false on any malformed input. */
export function verifyEntrySignature(
  msg: string,
  signerPublicKeyB64: string,
  signatureB64: string,
): boolean {
  try {
    const pub = createPublicKey({
      key: Buffer.from(signerPublicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return nodeVerify(null, Buffer.from(msg, "utf8"), pub, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
