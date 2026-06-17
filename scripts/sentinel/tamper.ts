// Demo helper: forge a stored memory record and show SentinelMem rejects it.
//
//   pnpm sentinel:tamper <host-or-url>
//
// Walrus blobs are immutable, so "tampering" means: take the host's latest case
// file, flip a field (verdict) WITHOUT re-signing, upload the forged record as a
// new blob, build a new manifest pointing at it, and repoint the anchor. On the
// next recall (`pnpm sentinel <url>`) or UI reload, the agent's signature no
// longer matches the record -> REJECTED / TAMPERED.

import { readFile, writeFile } from "node:fs/promises";
import {
  hostKey,
  readManifest,
  readCaseFile,
  type HostManifest,
} from "../../src/lib/memory";
import { uploadToWalrus } from "../../src/lib/walrus";

const target = process.argv[2];
if (!target) {
  console.error("usage: pnpm sentinel:tamper <host-or-url>");
  process.exit(1);
}
const host = hostKey(target);
const PUBLIC = "public/sentinel-memory.json";
const LOCAL = process.env.SENTINEL_ANCHORS ?? ".sentinel/anchors.json";
const epochs = Number(process.env.SENTINEL_EPOCHS ?? 5);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (process.env.MEMWAL_BASE_URL) {
    console.warn(
      "Note: MEMWAL_BASE_URL is set. This demo helper repoints only the local " +
        "anchor file + public UI index, NOT the MemWal pointer the agent reads — " +
        "so a MemWal-backed recall won't see the tamper. Unset MEMWAL_BASE_URL for " +
        "the file-backed demo, or tamper the MemWal anchor directly.",
    );
  }
  const pub = await readJson(PUBLIC);
  const manifestBlobId: string | undefined = pub?.anchors?.[host];
  if (!manifestBlobId) {
    console.error(`No memory for ${host} in ${PUBLIC}. Run \`pnpm sentinel <url>\` first.`);
    process.exit(1);
  }

  const manifest = await readManifest(manifestBlobId);
  if (manifest.entries.length === 0) {
    console.error("Manifest has no entries.");
    process.exit(1);
  }
  const lastBlob = manifest.entries[manifest.entries.length - 1];
  const entry = await readCaseFile(lastBlob);

  const before = entry.verdict;
  entry.verdict = entry.verdict === "phishing" ? "benign" : "phishing"; // NOT re-signed
  const tamperedBlob = await uploadToWalrus(JSON.stringify(entry), {
    contentType: "application/json",
    epochs,
  });

  const newManifest: HostManifest = {
    ...manifest,
    entries: [...manifest.entries.slice(0, -1), tamperedBlob],
    updatedAt: new Date().toISOString(),
    prevManifestBlobId: manifestBlobId,
  };
  const newManifestBlob = await uploadToWalrus(JSON.stringify(newManifest), {
    contentType: "application/json",
    epochs,
  });

  if (pub) {
    pub.anchors[host] = newManifestBlob;
    pub.updatedAt = new Date().toISOString();
    await writeFile(PUBLIC, JSON.stringify(pub, null, 2));
  }
  const local = await readJson(LOCAL);
  if (local) {
    local[host] = newManifestBlob;
    await writeFile(LOCAL, JSON.stringify(local, null, 2));
  }

  console.log(`Forged ${host}: flipped verdict ${before} -> ${entry.verdict} (signature left stale).`);
  console.log(`  tampered record blob : ${tamperedBlob}`);
  console.log(`  repointed manifest   : ${newManifestBlob}`);
  console.log(
    `Now reload the web UI (the record shows TAMPERED) or run \`pnpm sentinel ${host}\` ` +
      `(recall rejects it: "signature invalid — record tampered").`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
