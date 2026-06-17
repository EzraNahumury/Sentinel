// SentinelMem security-core tests (no network). Run: `pnpm test`.
//
// These prove the headline claim mechanically: the agent's signature binds the
// whole record, any field tamper breaks it, and a different signer key is
// rejected. Network-dependent paths (Walrus, notary, LLM) are exercised by the
// live `pnpm sentinel` run, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  canonicalCaseFileMessage,
  type CaseFileEntry,
} from "../../src/lib/memory";
import { loadOrCreateSigner, verifyEntrySignature } from "./signer";

const KEY_DIR = `.sentinel/test-${process.pid}`;

function makeEntry(overrides: Partial<CaseFileEntry> = {}): CaseFileEntry {
  return {
    schema: "sentinelmem.case-file.v1",
    host: "example.com",
    url: "https://example.com/",
    observedAt: "2026-01-01T00:00:00.000Z",
    tier: "PROVEN",
    tlsnProofBlobId: "proofblob",
    screenshotBlobId: "ssblob",
    htmlBlobId: "htmlblob",
    contentHash: "0xabc123",
    renderHash: "0xrender123",
    provenServerName: "example.com",
    httpStatus: 200,
    verdict: "benign",
    confidence: 0.9,
    rationale: "no risk signals",
    model: "test-model",
    recalledEntryBlobIds: [],
    ...overrides,
  };
}

test("canonical message excludes the integrity field and survives JSON round-trip", () => {
  const e = makeEntry();
  const base = canonicalCaseFileMessage(e);
  const withIntegrity = JSON.parse(
    JSON.stringify({
      ...e,
      integrity: { alg: "ed25519", signerPublicKey: "k", signature: "s" },
    }),
  ) as CaseFileEntry;
  assert.equal(canonicalCaseFileMessage(withIntegrity), base);
});

test("sign -> verify round-trip succeeds", async () => {
  const signer = await loadOrCreateSigner(`${KEY_DIR}/k.pem`);
  const e = makeEntry();
  const sig = signer.sign(canonicalCaseFileMessage(e));
  assert.equal(
    verifyEntrySignature(canonicalCaseFileMessage(e), signer.publicKeyB64, sig),
    true,
  );
});

test("tampered verdict is rejected (signature no longer matches)", async () => {
  const signer = await loadOrCreateSigner(`${KEY_DIR}/k.pem`);
  const e = makeEntry({ verdict: "benign" });
  const sig = signer.sign(canonicalCaseFileMessage(e));
  const forged = makeEntry({ verdict: "phishing" }); // attacker flips it
  assert.equal(
    verifyEntrySignature(canonicalCaseFileMessage(forged), signer.publicKeyB64, sig),
    false,
  );
});

test("tampering any covered field (host/contentHash) is rejected", async () => {
  const signer = await loadOrCreateSigner(`${KEY_DIR}/k.pem`);
  const e = makeEntry();
  const sig = signer.sign(canonicalCaseFileMessage(e));
  for (const forged of [
    makeEntry({ host: "evil.com" }),
    makeEntry({ contentHash: "0xdeadbeef" }),
    makeEntry({ renderHash: "0xforgedrender" }),
    makeEntry({ tier: "UNVERIFIED" }),
    makeEntry({ tlsnProofBlobId: "otherproof" }),
  ]) {
    assert.equal(
      verifyEntrySignature(canonicalCaseFileMessage(forged), signer.publicKeyB64, sig),
      false,
    );
  }
});

test("signature from a different (untrusted) key is rejected", async () => {
  const a = await loadOrCreateSigner(`${KEY_DIR}/a.pem`);
  const b = await loadOrCreateSigner(`${KEY_DIR}/b.pem`);
  assert.notEqual(a.publicKeyB64, b.publicKeyB64);
  const e = makeEntry();
  const sigA = a.sign(canonicalCaseFileMessage(e));
  // Pinning to b's key (or verifying a's signature against b's key) must fail.
  assert.equal(
    verifyEntrySignature(canonicalCaseFileMessage(e), b.publicKeyB64, sigA),
    false,
  );
});

test("garbage signature/key inputs reject without throwing", () => {
  assert.equal(verifyEntrySignature("msg", "not-base64-!!", "also-bad"), false);
  assert.equal(verifyEntrySignature("msg", "", ""), false);
});

test.after(async () => {
  await rm(KEY_DIR, { recursive: true, force: true }).catch(() => undefined);
});
