// Verify MemWal credentials end-to-end: remember a probe line, then recall it.
//   pnpm memwal:test
// Env: MEMWAL_PRIVATE_KEY (required), MEMWAL_ACCOUNT_ID (required), MEMWAL_SERVER_URL.
import { MemWal } from "@mysten-incubation/memwal";

const key = process.env.MEMWAL_PRIVATE_KEY;
const accountId = process.env.MEMWAL_ACCOUNT_ID;
const serverUrl = process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz";

if (!key || !accountId) {
  console.error(
    "Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID (from memory.walrus.xyz).\n" +
      "Tip: put the private key in .sentinel/memwal-key.txt and load it into the env.",
  );
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mw: any = MemWal.create({ key, accountId, serverUrl });
const probe = `SentinelMem MemWal connectivity probe @ ${new Date().toISOString()}`;

console.log(`server: ${serverUrl}`);
console.log(`remember: "${probe}"`);
const job = await mw.remember(probe);
const jobId = job?.job_id ?? job?.jobId;
console.log(`  job: ${JSON.stringify(job)}`);
if (jobId) {
  await mw.waitForRememberJob(jobId);
  console.log("  remember job complete");
}

const r = await mw.recall("SentinelMem connectivity probe");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hits = (r?.results ?? []).map((x: any) => x.text).slice(0, 3);
console.log("recall top results:");
for (const h of hits) console.log(`  • ${h}`);
console.log(hits.length ? "\nMemWal OK ✅ (remember + recall round-trip works)" : "\nMemWal connected, but recall returned no results yet (indexing lag?).");
