// Local SentinelMem agent server — lets the web UI trigger a REAL investigation
// (the agent can't run in a browser: it needs Node, Playwright, the TLSNotary
// harness, and the agent's signing key). The static Walrus Site can't reach this;
// it's for local / self-hosted use.
//
//   pnpm sentinel:serve              # then use the "Investigate" box in the UI
//
// Env: same as `pnpm sentinel` (SENTINEL_LLM/OLLAMA_*/TLSN_NOTARY_URL/…).
//   SENTINEL_PORT   server port (default 8787)
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { SentinelProvenance } from "./provenance";
import { investigate } from "./agent";
import { FileAnchorStore } from "./anchor-store";
import { loadOrCreateSigner } from "./signer";
import { LLM_PROVIDER, ANALYST_MODEL } from "./analyst";
import { DEFAULT_NOTARY_URL } from "../tlsn/harness";

const PORT = Number(process.env.SENTINEL_PORT ?? 8787);
const PUBLIC_INDEX = "public/sentinel-memory.json";

const opts = {
  publisher: process.env.WALRUS_PUBLISHER,
  aggregator: process.env.WALRUS_AGGREGATOR,
  epochs: Number(process.env.SENTINEL_EPOCHS ?? 5),
};
const anchors = new FileAnchorStore(
  process.env.SENTINEL_ANCHORS ?? ".sentinel/anchors.json",
);
const signer = await loadOrCreateSigner(
  process.env.SENTINEL_SIGNER ?? ".sentinel/agent-key.pem",
);
const prov = new SentinelProvenance({
  notaryUrl: process.env.TLSN_NOTARY_URL ?? DEFAULT_NOTARY_URL,
  publisher: opts.publisher,
  aggregator: opts.aggregator,
  epochs: opts.epochs,
});

async function publishIndex(host: string, manifestBlobId: string): Promise<void> {
  let existing: { anchors?: Record<string, string> } = {};
  try {
    existing = JSON.parse(await readFile(PUBLIC_INDEX, "utf8"));
  } catch {
    // first publish
  }
  const map = { ...(existing.anchors ?? {}), [host]: manifestBlobId };
  await mkdir(dirname(PUBLIC_INDEX), { recursive: true });
  await writeFile(
    PUBLIC_INDEX,
    JSON.stringify(
      {
        schema: "sentinelmem.index.v1",
        signerPublicKey: signer.publicKeyB64,
        anchors: map,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function send(res: import("node:http").ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

console.log("Starting notary key fetch, TLSNotary harness, headless browser…");
await prov.start();
console.log(`SentinelMem agent ready · llm=${LLM_PROVIDER}:${ANALYST_MODEL}`);

let busy = false;

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    send(res, 200, { ok: true, llm: `${LLM_PROVIDER}:${ANALYST_MODEL}`, busy });
    return;
  }
  if (req.method === "POST" && req.url === "/api/investigate") {
    if (busy) {
      send(res, 429, { error: "an investigation is already running — try again shortly" });
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let url = "";
    try {
      url = String(JSON.parse(raw || "{}").url ?? "").trim();
    } catch {
      // invalid json
    }
    if (!url) {
      send(res, 400, { error: "missing 'url' in request body" });
      return;
    }
    busy = true;
    console.log(`=== Investigating ${url} ===`);
    try {
      const r = await investigate(prov, anchors, signer, url, opts);
      await publishIndex(r.host, r.manifestBlobId);
      console.log(`  ${r.host}: ${r.verdict} (${Math.round(r.confidence * 100)}%) · ${r.tier}`);
      send(res, 200, {
        host: r.host,
        url: r.url,
        verdict: r.verdict,
        confidence: r.confidence,
        tier: r.tier,
        recalledVerified: r.recalledVerified,
        manifestBlobId: r.manifestBlobId,
        entryBlobId: r.entryBlobId,
      });
    } catch (e) {
      console.error("  investigation failed:", (e as Error).message);
      send(res, 500, { error: (e as Error).message });
    } finally {
      busy = false;
    }
    return;
  }
  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`SentinelMem agent server → http://localhost:${PORT}`);
  console.log("Use the Investigate box in the web UI (pnpm dev) to add memory.");
});
