// Auditor CLI — the second agent. Reads the Analyst's published memory index,
// pins the Analyst's key, and independently re-verifies + attests each record.
//
//   pnpm sentinel:audit <host-or-url>
//
// Demonstrates multi-agent, trust-minimized coordination: the Auditor (its own
// key) concurs only when it can re-verify the Analyst's signature over the
// shared Walrus memory; on a tampered record it dissents.

import { readFile } from "node:fs/promises";
import { hostKey } from "../../src/lib/memory";
import { loadOrCreateSigner, keyFingerprint } from "./signer";
import { auditHost } from "./auditor";

const target = process.argv[2];
if (!target) {
  console.error("usage: pnpm sentinel:audit <host-or-url>");
  process.exit(1);
}
const host = hostKey(target);
const PUBLIC = "public/sentinel-memory.json";

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pub: any;
  try {
    pub = JSON.parse(await readFile(PUBLIC, "utf8"));
  } catch {
    console.error(`No memory index at ${PUBLIC}. Run \`pnpm sentinel <url>\` first.`);
    process.exit(1);
  }
  const manifestBlobId: string | undefined = pub?.anchors?.[host];
  const analystSigner: string | undefined =
    process.env.SENTINEL_ANALYST_KEY ?? pub?.signerPublicKey;
  if (!manifestBlobId || !analystSigner) {
    console.error(`No analyst memory for ${host} in ${PUBLIC}. Run \`pnpm sentinel ${host}\` first.`);
    process.exit(1);
  }

  const auditor = await loadOrCreateSigner(
    process.env.SENTINEL_AUDITOR_SIGNER ?? ".sentinel/auditor-key.pem",
  );
  console.log(`Auditor agent  [key ${keyFingerprint(auditor.publicKeyB64)}]  auditing host=${host}`);
  console.log(`  pinned analyst [key ${keyFingerprint(analystSigner)}]  (trust-minimized: verify signature, not peer)`);
  if (keyFingerprint(auditor.publicKeyB64) === keyFingerprint(analystSigner)) {
    console.log("  ⚠ auditor and analyst are the SAME key — set SENTINEL_AUDITOR_SIGNER to a different key for a true 2-agent demo.");
  }
  console.log("");

  const results = await auditHost({
    host,
    manifestBlobId,
    analystSigner,
    auditor,
    aggregator: process.env.WALRUS_AGGREGATOR,
    publisher: process.env.WALRUS_PUBLISHER,
    epochs: Number(process.env.SENTINEL_EPOCHS ?? 5),
  });

  for (const r of results) {
    const mark =
      r.attestation === "concur"
        ? "✓ CONCUR"
        : r.attestation === "dissent"
          ? "✗ DISSENT"
          : "? UNVERIFIABLE";
    console.log(`  ${mark}  analyst-entry ${r.analystEntryBlobId.slice(0, 10)}… — ${r.reason}`);
    console.log(`            audit record (auditor-signed) = ${r.auditBlobId}`);
  }
  const concur = results.filter((r) => r.attestation === "concur").length;
  console.log(
    `\nAuditor verdict: ${concur}/${results.length} analyst record(s) independently re-verified ` +
      `(cross-agent, trust-minimized — Analyst & Auditor are distinct signing identities).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
