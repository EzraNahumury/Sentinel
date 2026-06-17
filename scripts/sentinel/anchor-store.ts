// File-backed AnchorStore: persists host -> latest-manifest-blob-id across
// process restarts. The memory CONTENT lives on Walrus; this file is only the
// tiny mutable pointer. Restarting the process and recalling by host key proves
// cross-session persistence. In production this pointer moves on-chain
// (see move/scan_market/sources/sentinel_memory.move).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnchorStore } from "../../src/lib/memory";

export class FileAnchorStore implements AnchorStore {
  constructor(private readonly path: string) {}

  private async load(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async get(host: string): Promise<string | null> {
    return (await this.load())[host] ?? null;
  }

  async set(host: string, manifestBlobId: string): Promise<void> {
    const map = await this.load();
    map[host] = manifestBlobId;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(map, null, 2));
  }

  /** Full host -> manifest map (for publishing the UI index). */
  async all(): Promise<Record<string, string>> {
    return this.load();
  }
}
