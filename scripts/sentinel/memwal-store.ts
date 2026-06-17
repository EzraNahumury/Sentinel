// MemWal (Walrus Memory) anchor backend — routes the host -> manifest pointer
// through MemWal instead of a local file. The case-file/manifest BLOBS still
// live on Walrus; this stores the small mutable pointer as a MemWal memory.
//
// Uses the real SDK (@mysten-incubation/memwal), per the dashboard quickstart:
//   const mw = MemWal.create({ key, accountId, serverUrl })
//   const job = await mw.remember(text); await mw.waitForRememberJob(job.job_id)
//   const r = await mw.recall(query); r.results[0].text
//
// Auth is the delegate PRIVATE key (MEMWAL_PRIVATE_KEY) the SDK signs with — not
// a Bearer token. The SDK is imported lazily so non-MemWal users don't need it.
//
// CAVEAT: MemWal memory is SEMANTIC (remember() runs an LLM fact-extractor; recall
// is similarity search), so this pointer is BEST-EFFORT — keep the local/on-chain
// anchor authoritative for exact last-writer-wins reads. We store + recall a
// host-tagged line and parse the manifest id from the best matching result.

import type { AnchorStore } from "../../src/lib/memory";

export interface MemWalConfig {
  serverUrl: string; // MEMWAL_SERVER_URL, e.g. https://relayer.memory.walrus.xyz
  accountId: string; // MEMWAL_ACCOUNT_ID
  privateKey: string; // MEMWAL_PRIVATE_KEY (delegate private key)
  topK?: number;
}

export class MemWalAnchorStore implements AnchorStore {
  private readonly cfg: MemWalConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mw: any;

  constructor(cfg: MemWalConfig) {
    this.cfg = cfg;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async client(): Promise<any> {
    if (this.mw) return this.mw;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let MemWal: any;
    try {
      ({ MemWal } = await import("@mysten-incubation/memwal"));
    } catch {
      throw new Error("MemWal backend requires the SDK: pnpm add @mysten-incubation/memwal");
    }
    this.mw = MemWal.create({
      key: this.cfg.privateKey,
      accountId: this.cfg.accountId,
      serverUrl: this.cfg.serverUrl,
    });
    return this.mw;
  }

  async set(host: string, manifestBlobId: string): Promise<void> {
    const mw = await this.client();
    const text =
      `SentinelMem anchor for host ${host}: ` +
      `manifestBlobId=${manifestBlobId} updatedAt=${new Date().toISOString()}`;
    const job = await mw.remember(text);
    const jobId = job?.job_id ?? job?.jobId;
    if (jobId) await mw.waitForRememberJob(jobId);
  }

  async get(host: string): Promise<string | null> {
    const mw = await this.client();
    const r = await mw.recall(`SentinelMem anchor manifestBlobId for host ${host}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = r?.results ?? [];
    let best: string | null = null;
    let bestAt = "";
    for (const res of results) {
      const text: string = res?.text ?? "";
      if (!text.includes(`host ${host}:`) && !text.includes(`host ${host} `)) continue;
      const m = /manifestBlobId=([A-Za-z0-9_-]+)/.exec(text);
      const at = /updatedAt=([0-9T:.\-Z]+)/.exec(text);
      if (m && (best === null || (at && at[1] > bestAt))) {
        best = m[1];
        bestAt = at ? at[1] : "";
      }
    }
    return best;
  }
}
