// SentinelMem CLI: investigate one or more URLs, building verifiable memory.
//
//   pnpm sentinel <url> [url...]
//
// Env:
//   SENTINEL_LLM        analyst backend: "ollama" (local/cloud, no key) or
//                       "anthropic" (auto: anthropic if ANTHROPIC_API_KEY set, else ollama)
//   ANTHROPIC_API_KEY   required only for SENTINEL_LLM=anthropic
//   OLLAMA_HOST/OLLAMA_KEY/OLLAMA_MODEL/OLLAMA_THINK   for the ollama backend
//   SENTINEL_MODEL      analyst model override
//   TLSN_NOTARY_URL     notary (default: hosted Railway instance)
//   WALRUS_PUBLISHER / WALRUS_AGGREGATOR   Walrus endpoint overrides
//   SENTINEL_EPOCHS     memory blob lifetime in epochs (default 5)
//   SENTINEL_ANCHORS    local anchor file (default .sentinel/anchors.json)
//   SENTINEL_SIGNER     agent Ed25519 signing key PEM (default .sentinel/agent-key.pem)
//   SENTINEL_PUBLISH    write public/sentinel-memory.json for the UI (default on; 0 to skip)
//
//   MemWal anchor backend (optional — replaces the local anchor file):
//   MEMWAL_ACCOUNT_ID, MEMWAL_PRIVATE_KEY, MEMWAL_SERVER_URL
//
//   On-chain anchoring (optional — requires the published sentinel_memory module):
//   SENTINEL_ANCHOR_ONCHAIN=1, SENTINEL_PKG, SENTINEL_MEMORY_REGISTRY, SUI_SECRET_KEY, SUI_RPC

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SentinelProvenance } from "./provenance";
import { investigate, type InvestigateResult } from "./agent";
import { LLM_PROVIDER, ANALYST_MODEL } from "./analyst";
import { FileAnchorStore } from "./anchor-store";
import { MemWalAnchorStore } from "./memwal-store";
import { createOnchainAnchor, type OnAnchor } from "./onchain";
import { loadOrCreateSigner, keyFingerprint } from "./signer";
import { DEFAULT_NOTARY_URL } from "../tlsn/harness";
import type { AnchorStore, MemoryWalrusOptions } from "../../src/lib/memory";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: pnpm sentinel <url> [url...]");
  process.exit(1);
}
if (LLM_PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "SENTINEL_LLM=anthropic but ANTHROPIC_API_KEY is not set.\n" +
      "  → set the key, or use a local model: SENTINEL_LLM=ollama (no key needed).",
  );
  process.exit(1);
}

const opts: MemoryWalrusOptions = {
  publisher: process.env.WALRUS_PUBLISHER,
  aggregator: process.env.WALRUS_AGGREGATOR,
  epochs: Number(process.env.SENTINEL_EPOCHS ?? 5),
};

const PUBLISH = !/^(0|false|no|off)$/i.test(process.env.SENTINEL_PUBLISH ?? "1");
const PUBLIC_INDEX = "public/sentinel-memory.json";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Pick the anchor backend: MemWal if configured, else a local file.
function makeAnchorStore(): { store: AnchorStore; label: string } {
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  const privateKey = process.env.MEMWAL_PRIVATE_KEY;
  const serverUrl =
    process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz";
  if (accountId && privateKey) {
    return {
      store: new MemWalAnchorStore({ serverUrl, accountId, privateKey }),
      label: `MemWal (${serverUrl})`,
    };
  }
  if (accountId || privateKey) {
    console.warn(
      "  MemWal partially configured — need BOTH MEMWAL_ACCOUNT_ID and MEMWAL_PRIVATE_KEY; falling back to local anchor file.",
    );
  }
  return {
    store: new FileAnchorStore(
      process.env.SENTINEL_ANCHORS ?? ".sentinel/anchors.json",
    ),
    label: process.env.SENTINEL_ANCHORS ?? ".sentinel/anchors.json",
  };
}

function makeOnAnchor(): OnAnchor | undefined {
  const on = /^(1|true|yes|on)$/i.test(process.env.SENTINEL_ANCHOR_ONCHAIN ?? "");
  if (!on) return undefined;
  const pkg = process.env.SENTINEL_PKG;
  const registryId = process.env.SENTINEL_MEMORY_REGISTRY;
  const secret = process.env.SUI_SECRET_KEY;
  if (!pkg || !registryId || !secret) {
    console.warn(
      "  SENTINEL_ANCHOR_ONCHAIN set but SENTINEL_PKG / SENTINEL_MEMORY_REGISTRY / SUI_SECRET_KEY missing — skipping on-chain anchoring.",
    );
    return undefined;
  }
  return createOnchainAnchor({ pkg, registryId, secret, rpc: process.env.SUI_RPC });
}

// Merge this run's host -> manifest pointers into the public UI index.
async function publishIndex(
  results: InvestigateResult[],
  signerPublicKey: string,
): Promise<void> {
  let existing: { anchors?: Record<string, string> } = {};
  try {
    existing = JSON.parse(await readFile(PUBLIC_INDEX, "utf8"));
  } catch {
    // first publish
  }
  const anchors = { ...(existing.anchors ?? {}) };
  for (const r of results) anchors[r.host] = r.manifestBlobId;
  await mkdir(dirname(PUBLIC_INDEX), { recursive: true });
  await writeFile(
    PUBLIC_INDEX,
    JSON.stringify(
      {
        schema: "sentinelmem.index.v1",
        signerPublicKey,
        anchors,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const { store: anchors, label: anchorLabel } = makeAnchorStore();
  const onAnchor = makeOnAnchor();
  const prov = new SentinelProvenance({
    notaryUrl: process.env.TLSN_NOTARY_URL ?? DEFAULT_NOTARY_URL,
    publisher: opts.publisher,
    aggregator: opts.aggregator,
    epochs: opts.epochs,
  });

  console.log(
    `SentinelMem — llm=${LLM_PROVIDER}:${ANALYST_MODEL} · notary=${
      process.env.TLSN_NOTARY_URL ?? DEFAULT_NOTARY_URL
    }`,
  );
  console.log(`Anchor backend: ${anchorLabel}${onAnchor ? " + on-chain" : ""}`);
  console.log("Starting notary key fetch, TLSNotary harness, headless browser…");
  await prov.start();
  const signer = await loadOrCreateSigner(
    process.env.SENTINEL_SIGNER ?? ".sentinel/agent-key.pem",
  );
  console.log(`Trusted notary key: ${prov.notaryKeyHex.slice(0, 16)}…`);
  console.log(`Agent signer key  : [${keyFingerprint(signer.publicKeyB64)}] (memory is signed + pinned)\n`);

  const results: InvestigateResult[] = [];
  try {
    for (const url of urls) {
      console.log(`=== Investigating ${url} ===`);
      const r = await investigate(prov, anchors, signer, url, opts, onAnchor);
      results.push(r);

      console.log(
        `  recall    : ${r.recalledVerified} prior memory verified` +
          (r.recalledRejected.length ? `, ${r.recalledRejected.length} REJECTED` : ""),
      );
      for (const rej of r.recalledRejected) {
        console.log(`              ✗ ${rej.blobId.slice(0, 10)}… — ${rej.reason}`);
      }
      console.log(
        `  evidence  : ${r.tier === "PROVEN" ? "🔒 PROVEN" : "⚠ UNVERIFIED"} — ${r.provenanceReason}`,
      );
      console.log(`  contentHash: ${r.contentHash || "(none)"}`);
      console.log(
        `  cloaking  : ${r.cloakingClusters} content cluster(s) across vantages` +
          (r.cloakingClusters > 1 ? " — POSSIBLE CLOAKING" : ""),
      );
      console.log(
        `  verdict   : ${r.verdict.toUpperCase()} (${pct(r.confidence)} confidence)` +
          (r.recallUsed ? " · recall-informed" : ""),
      );
      console.log(`  rationale : ${r.rationale}`);
      console.log(`  remembered: entry=${r.entryBlobId}`);
      console.log(`              manifest=${r.manifestBlobId} (host memory head)`);
      if (r.proofBlobId) console.log(`              proof=${r.proofBlobId}`);
      if (r.onchainDigest) console.log(`              on-chain anchor tx=${r.onchainDigest}`);
      console.log("");
    }
  } finally {
    await prov.stop();
  }

  if (PUBLISH) {
    await publishIndex(results, signer.publicKeyB64);
    console.log(`Published UI index → ${PUBLIC_INDEX} (open the web app to inspect memory)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
