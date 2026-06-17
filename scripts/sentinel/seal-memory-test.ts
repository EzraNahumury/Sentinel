// Verify the Seal <-> memory-layer wiring on the SAME code path the agent uses:
// appendCaseFile() encrypts before Walrus, recallCaseFiles() decrypts + the
// signature still re-verifies. Deterministic (no notary/LLM).
//   pnpm seal:memtest
import {
  appendCaseFile,
  recallCaseFiles,
  readCaseFile,
  canonicalCaseFileMessage,
  hostKey,
  InMemoryAnchorStore,
  type CaseFileEntry,
  type SealedEnvelope,
  type VerifyEntryFn,
} from "../../src/lib/memory";
import { walrusAggregatorUrl, DEFAULT_WALRUS_AGGREGATOR } from "../../src/lib/walrus";
import { loadOrCreateSigner, verifyEntrySignature } from "./signer";
import { makeSealCaseFileCipher } from "./seal-cipher";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
}

const url = "https://sealed-target.example/login";
const host = hostKey(url);

const signer = await loadOrCreateSigner(
  process.env.SENTINEL_SIGNER ?? ".sentinel/agent-key.pem",
);
const { cipher, label } = await makeSealCaseFileCipher();
console.log(`cipher: ${label}\n`);

const entry: CaseFileEntry = {
  schema: "sentinelmem.case-file.v1",
  host,
  url,
  observedAt: new Date().toISOString(),
  tier: "UNVERIFIED",
  tlsnProofBlobId: "",
  screenshotBlobId: "",
  htmlBlobId: "",
  contentHash: "",
  renderHash: "",
  provenServerName: host,
  httpStatus: 200,
  verdict: "phishing",
  confidence: 0.91,
  rationale: "Sensitive verdict that should never sit in plaintext on Walrus.",
  model: "test",
  recalledEntryBlobIds: [],
};
entry.integrity = {
  alg: "ed25519",
  signerPublicKey: signer.publicKeyB64,
  signature: signer.sign(canonicalCaseFileMessage(entry)),
};

const anchors = new InMemoryAnchorStore();

console.log("1. appendCaseFile with cipher (encrypt -> Walrus) …");
const { entryBlobId, manifestBlobId } = await appendCaseFile(entry, anchors, {
  cipher,
  epochs: 1,
});
console.log(`   entry blob=${entryBlobId}\n   manifest=${manifestBlobId}\n`);

console.log("2. raw blob on Walrus must be a SEALED envelope (not plaintext) …");
const rawRes = await fetch(walrusAggregatorUrl(entryBlobId, DEFAULT_WALRUS_AGGREGATOR), {
  signal: AbortSignal.timeout(30000),
});
const raw = (await rawRes.json()) as SealedEnvelope & Record<string, unknown>;
assert(raw.schema === "sentinelmem.sealed.v1", "blob is not a sealed envelope");
assert(typeof raw.ciphertext === "string" && !("verdict" in raw), "plaintext leaked in blob");
console.log(`   sealed ✅ (schema=${raw.schema}, no verdict in plaintext, ${String(raw.ciphertext).length} b64 chars)\n`);

console.log("3. recall WITHOUT cipher must refuse (plaintext reader can't read) …");
try {
  await readCaseFile(entryBlobId, DEFAULT_WALRUS_AGGREGATOR);
  throw new Error("UNEXPECTED: read a sealed blob without a cipher");
} catch (e) {
  const m = (e as Error).message;
  assert(!m.includes("UNEXPECTED"), m);
  console.log(`   refused ✅ (${m.slice(0, 60)}…)\n`);
}

console.log("4. recall WITH cipher: decrypt + signature re-verifies …");
const verifyEntry: VerifyEntryFn = async (e) => {
  if (!e.integrity) return { ok: false, reason: "unsigned" };
  if (e.integrity.signerPublicKey !== signer.publicKeyB64)
    return { ok: false, reason: "untrusted signer" };
  const ok = verifyEntrySignature(
    canonicalCaseFileMessage(e),
    e.integrity.signerPublicKey,
    e.integrity.signature,
  );
  return ok
    ? { ok: true, reason: "signature ok" }
    : { ok: false, reason: "signature invalid" };
};
const recalled = await recallCaseFiles(host, anchors, { cipher }, verifyEntry);
assert(recalled.verified.length === 1, `expected 1 verified, got ${recalled.verified.length} (rejected: ${JSON.stringify(recalled.rejected)})`);
assert(recalled.verified[0].entry.verdict === "phishing", "decrypted verdict mismatch");
assert(recalled.verified[0].entry.rationale === entry.rationale, "decrypted rationale mismatch");
console.log("   decrypted + signature verified ✅\n");

console.log("Seal↔memory wiring OK ✅ — case files encrypted on Walrus, recalled+verified via the agent path.");
