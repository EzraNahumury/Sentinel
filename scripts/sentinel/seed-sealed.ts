// Seed one Seal-encrypted case file into the public UI index, so the inspector
// shows a 🔒 entry that a whitelisted wallet can decrypt in the browser.
// Deterministic (no notary/LLM) — uses the same memory + Seal layer as the agent.
//   pnpm seal:seed [url]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendCaseFile,
  canonicalCaseFileMessage,
  hostKey,
  type CaseFileEntry,
} from "../../src/lib/memory";
import { FileAnchorStore } from "./anchor-store";
import { loadOrCreateSigner } from "./signer";
import { makeSealCaseFileCipher } from "./seal-cipher";

const url = process.argv[2] ?? "https://acme-sso-secure-login.example/";
const host = hostKey(url);
const PUBLIC = "public/sentinel-memory.json";

const signer = await loadOrCreateSigner(
  process.env.SENTINEL_SIGNER ?? ".sentinel/agent-key.pem",
);
const { cipher, label } = await makeSealCaseFileCipher();
console.log(`cipher: ${label}`);

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
  confidence: 0.96,
  rationale:
    "PRIVATE CASE FILE — credential-harvesting clone of the Acme corporate SSO " +
    "portal, targeting employees. Sealed on Walrus so only whitelisted analysts can read it.",
  model: "sentinel-demo",
  recalledEntryBlobIds: [],
};
entry.integrity = {
  alg: "ed25519",
  signerPublicKey: signer.publicKeyB64,
  signature: signer.sign(canonicalCaseFileMessage(entry)),
};

const anchors = new FileAnchorStore(".sentinel/anchors-sealdemo.json");
const { entryBlobId, manifestBlobId } = await appendCaseFile(entry, anchors, {
  cipher,
  epochs: 5,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let index: any = {};
try {
  index = JSON.parse(await readFile(PUBLIC, "utf8"));
} catch {
  // first publish
}
index.schema = index.schema ?? "sentinelmem.index.v1";
index.signerPublicKey = index.signerPublicKey ?? signer.publicKeyB64;
index.anchors = { ...(index.anchors ?? {}), [host]: manifestBlobId };
index.updatedAt = new Date().toISOString();
await mkdir(dirname(PUBLIC), { recursive: true });
await writeFile(PUBLIC, JSON.stringify(index, null, 2));

console.log(`sealed host : ${host}`);
console.log(`  entry blob : ${entryBlobId}`);
console.log(`  manifest   : ${manifestBlobId}`);
console.log(`merged into ${PUBLIC} — reload the UI to see the 🔒 entry.`);
