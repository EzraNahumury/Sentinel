// MemWal (Walrus Memory) anchor backend — slots in behind the AnchorStore seam
// so the host -> latest-manifest-blob-id pointer lives in MemWal. The case-file
// and manifest BLOBS still live on Walrus; this stores the small mutable pointer
// in MemWal's memory.
//
// MemWal is an SDK (@mysten-incubation/memwal), NOT a key/value REST store:
//   - auth is a signed-request model — `key` is your Ed25519 delegate-key hex
//     (minted with your accountId in the Walrus Memory dashboard
//     https://memory.walrus.xyz/), not a Bearer token.
//   - storage is semantic: remember(text, ns) (async, LLM fact-extracted) and
//     recall({query, namespace, ...}) (similarity search). There is no exact
//     get-by-key, so we namespace per host and parse the manifest id out of the
//     recalled text.
//
// The SDK is imported lazily, so non-MemWal users don't need it installed.
//
// CAVEAT: recall is approximate and remember() may reword text, so this is a
// best-effort pointer. For an exact last-writer-wins pointer, keep FileAnchorStore
// (or the on-chain anchor) as the source of truth and mirror to MemWal. Verify the
// exact SDK method/param names against docs.wal.app before relying on it.

import type { AnchorStore } from "../../src/lib/memory";

export interface MemWalConfig {
  serverUrl: string; // MemWal relayer URL
  delegateKey: string; // Ed25519 delegate-key hex (NOT a Bearer token)
  accountId: string; // Walrus Memory account id (from the dashboard)
  namespace?: string; // default "sentinelmem"
}

export class MemWalAnchorStore implements AnchorStore {
  private readonly ns: string;
  private readonly cfg: MemWalConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mw: any;

  constructor(cfg: MemWalConfig) {
    this.cfg = cfg;
    this.ns = cfg.namespace ?? "sentinelmem";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async client(): Promise<any> {
    if (this.mw) return this.mw;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let MemWal: any;
    try {
      ({ MemWal } = await import("@mysten-incubation/memwal"));
    } catch {
      throw new Error(
        "MemWal backend requires the SDK. Run: " +
          "pnpm add @mysten-incubation/memwal @mysten/sui @mysten/seal @mysten/walrus ai zod",
      );
    }
    this.mw = MemWal.create({
      key: this.cfg.delegateKey,
      accountId: this.cfg.accountId,
      serverUrl: this.cfg.serverUrl,
      namespace: this.ns,
    });
    return this.mw;
  }

  private nsFor(host: string): string {
    return `${this.ns}:${host}`;
  }

  async get(host: string): Promise<string | null> {
    const mw = await this.client();
    const r = await mw.recall({
      query: `anchor manifestBlobId for host ${host}`,
      namespace: this.nsFor(host),
      limit: 1,
      maxDistance: 0.4,
    });
    const text: string | undefined = r?.results?.[0]?.text;
    if (!text) return null;
    const m = /manifestBlobId=([A-Za-z0-9_-]+)/.exec(text);
    return m ? m[1] : null;
  }

  async set(host: string, manifestBlobId: string): Promise<void> {
    const mw = await this.client();
    await mw.rememberAndWait(
      `anchor host=${host} manifestBlobId=${manifestBlobId} updatedAt=${new Date().toISOString()}`,
      this.nsFor(host),
    );
  }
}
