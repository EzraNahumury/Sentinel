// Seal end-to-end demo (live on testnet):
//   pnpm seal:demo
//
// 1. Encrypt a SentinelMem case file with Seal (threshold key servers + on-chain
//    whitelist policy) → ciphertext + key-id.
// 2. Store the ciphertext as a Walrus blob (the real memory medium).
// 3. Read the blob back and DECRYPT it as the whitelisted reader → recover the
//    exact case file.
// 4. Prove the policy bites: a reader NOT on the whitelist is denied the key.
//
// Requires .sentinel/seal.json + .sentinel/seal-reader.key (run seal-setup +
// the on-chain whitelist steps first — see SENTINELMEM.md).
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createSealCrypto } from "./seal";
import { loadSealConfig, loadOrCreateReader } from "./seal-config";
import {
  uploadToWalrus,
  walrusAggregatorUrl,
  DEFAULT_WALRUS_AGGREGATOR,
} from "../../src/lib/walrus";

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function downloadBlob(blobId: string, tries = 8): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(walrusAggregatorUrl(blobId, DEFAULT_WALRUS_AGGREGATOR), {
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      lastErr = new Error(`aggregator ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`blob ${blobId} not retrievable: ${(lastErr as Error)?.message}`);
}

async function main(): Promise<void> {
  const cfg = await loadSealConfig();
  const reader = await loadOrCreateReader();

  console.log("Seal end-to-end demo");
  console.log(`  package   : ${cfg.packageId}`);
  console.log(`  whitelist : ${cfg.whitelistId}`);
  console.log(`  reader    : ${cfg.readerAddress}`);
  console.log(`  servers   : ${cfg.keyServers.length} key server(s), threshold ${cfg.threshold}\n`);

  const crypto = await createSealCrypto({
    packageId: cfg.packageId,
    whitelistId: cfg.whitelistId,
    keyServerObjectIds: cfg.keyServers,
    threshold: cfg.threshold,
  });

  const caseFile = {
    host: "secret-target.example",
    verdict: "malicious",
    confidence: 0.93,
    rationale: "Credential-harvesting form posting to an off-domain endpoint.",
    observedAt: "2026-06-17T00:00:00.000Z",
  };

  console.log("1. encrypt case file with Seal …");
  const { ciphertext, id } = await crypto.encryptJson(caseFile);
  console.log(`   ciphertext: ${ciphertext.length} bytes · key-id ${id.slice(0, 16)}…\n`);

  console.log("2. store ciphertext on Walrus …");
  const blobId = await uploadToWalrus(ciphertext, { epochs: 1 });
  console.log(`   blob: ${blobId}\n`);

  console.log("3. read blob back + decrypt as whitelisted reader …");
  const fetched = await downloadBlob(blobId);
  const recovered = await crypto.decryptJson(fetched, id, reader);
  const ok = eq(recovered, caseFile);
  console.log(`   recovered == original: ${ok ? "YES ✅" : "NO ❌"}`);
  if (!ok) {
    console.error("   recovered:", JSON.stringify(recovered));
    throw new Error("round-trip mismatch");
  }
  console.log("");

  console.log("4. negative test — reader NOT on the whitelist must be denied …");
  const outsider = Ed25519Keypair.generate();
  // Use a FRESH Seal client so it can't serve the key from the cache populated
  // by step 3 — the outsider must actually hit the key servers and be rejected.
  const outsiderCrypto = await createSealCrypto({
    packageId: cfg.packageId,
    whitelistId: cfg.whitelistId,
    keyServerObjectIds: cfg.keyServers,
    threshold: cfg.threshold,
  });
  try {
    await outsiderCrypto.decryptJson(fetched, id, outsider);
    throw new Error("UNEXPECTED: outsider decrypted the blob (policy not enforced!)");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("UNEXPECTED")) throw e;
    console.log(`   denied as expected ✅ (${msg.split("\n")[0].slice(0, 80)})`);
  }

  console.log("\nSeal OK ✅ — case file encrypted on Walrus, decryptable only by the whitelist.");
}

main().catch((err) => {
  console.error("\nSeal demo failed:", err);
  process.exit(1);
});
