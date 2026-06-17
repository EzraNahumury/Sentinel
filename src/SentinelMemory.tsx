// SentinelMem inspector — per-host, append-only agent memory rendered from
// Walrus, with a client-side "memory verified" badge and a live re-verify
// button. Reads a small public index (host -> latest manifest blob id) written
// by the agent (public/sentinel-memory.json), resolves each host's manifest +
// case files from Walrus, and verifies each record's Ed25519 signature in the
// browser (crypto.subtle), so anyone can independently confirm the memory has
// not been tampered.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  Lock,
  Brain,
  RefreshCw,
  FileCheck2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "./components/ui/card";
import { walrusAggregatorUrl } from "./lib/walrus";
import { readManifest, readCaseFile, type CaseFileEntry } from "./lib/memory";
import {
  verifyCaseFileSignature,
  type MemoryVerifyResult,
} from "./lib/memory-verify";

const INDEX_URL = "/sentinel-memory.json";
const TRUSTED_SIGNER =
  (import.meta.env.VITE_SENTINEL_SIGNER as string | undefined) || undefined;

interface MemoryIndex {
  schema?: string;
  signerPublicKey?: string;
  anchors: Record<string, string>;
  updatedAt?: string;
}

interface LoadedEntry {
  blobId: string;
  entry: CaseFileEntry;
  verify: MemoryVerifyResult;
}

interface HostMemory {
  host: string;
  manifestBlobId: string;
  entries: LoadedEntry[]; // newest first
}

async function loadMemory(): Promise<{ trusted?: string; hosts: HostMemory[] }> {
  const res = await fetch(INDEX_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `No memory index at ${INDEX_URL}. Run the agent first: pnpm sentinel https://example.com/`,
    );
  }
  const index = (await res.json()) as MemoryIndex;
  const trusted = TRUSTED_SIGNER ?? index.signerPublicKey;
  const hosts: HostMemory[] = [];
  for (const [host, manifestBlobId] of Object.entries(index.anchors ?? {})) {
    try {
      const manifest = await readManifest(manifestBlobId);
      const entries: LoadedEntry[] = [];
      for (const blobId of manifest.entries) {
        const entry = await readCaseFile(blobId);
        const verify = await verifyCaseFileSignature(entry, trusted);
        entries.push({ blobId, entry, verify });
      }
      entries.reverse();
      hosts.push({ host, manifestBlobId, entries });
    } catch {
      // Skip a host whose manifest/entries can't be read (e.g. expired blob).
    }
  }
  return { trusted, hosts };
}

export function SentinelMemory() {
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["sentinel-memory"],
    queryFn: loadMemory,
    refetchOnWindowFocus: false,
  });
  // Per-entry live re-verification overrides (blobId -> result).
  const [live, setLive] = useState<Record<string, MemoryVerifyResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const trusted = data?.trusted;

  const reverify = async (blobId: string) => {
    setBusy(blobId);
    try {
      // Re-fetch from Walrus so a tampered blob is caught on click.
      const entry = await readCaseFile(blobId);
      const result = await verifyCaseFileSignature(entry, trusted);
      setLive((m) => ({ ...m, [blobId]: result }));
    } catch (err) {
      setLive((m) => ({
        ...m,
        [blobId]: { status: "unsupported", reason: (err as Error).message },
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Brain className="h-5 w-5" /> SentinelMem — verifiable agent memory
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Per-host case files on Walrus. Each record is Ed25519-signed by the
            agent and verified in your browser — tampering is detectable here,
            not just on the server.
            {trusted && (
              <>
                {" "}
                Pinned signer{" "}
                <span className="font-mono">{trusted.slice(0, 16)}…</span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Reload
        </button>
      </div>

      {isPending ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading memory from Walrus…
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {(error as Error).message}
          </CardContent>
        </Card>
      ) : (data?.hosts.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No memory yet. Run{" "}
            <code className="text-foreground">
              pnpm sentinel https://example.com/
            </code>{" "}
            to build a case file.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.hosts.map((h) => (
            <HostBlock
              key={h.host}
              host={h}
              live={live}
              busy={busy}
              onReverify={reverify}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HostBlock({
  host,
  live,
  busy,
  onReverify,
}: {
  host: HostMemory;
  live: Record<string, MemoryVerifyResult>;
  busy: string | null;
  onReverify: (blobId: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{host.host}</div>
          <div className="text-xs text-muted-foreground">
            {host.entries.length} case file{host.entries.length === 1 ? "" : "s"}{" "}
            · manifest{" "}
            <a
              href={walrusAggregatorUrl(host.manifestBlobId)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[var(--color-ring)] hover:underline"
            >
              {host.manifestBlobId.slice(0, 10)}…
            </a>
          </div>
        </div>
      </div>
      <div className="divide-y">
        {host.entries.map((e) => (
          <EntryRow
            key={e.blobId}
            loaded={e}
            verify={live[e.blobId] ?? e.verify}
            busy={busy === e.blobId}
            onReverify={() => onReverify(e.blobId)}
          />
        ))}
      </div>
    </Card>
  );
}

function EntryRow({
  loaded,
  verify,
  busy,
  onReverify,
}: {
  loaded: LoadedEntry;
  verify: MemoryVerifyResult;
  busy: boolean;
  onReverify: () => void;
}) {
  const { entry, blobId } = loaded;
  return (
    <div className="px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={entry.verdict} />
        <TierBadge tier={entry.tier} />
        <MemoryBadge verify={verify} />
        <span className="text-muted-foreground">
          {Math.round(entry.confidence * 100)}% conf
        </span>
        {entry.recalledEntryBlobIds.length > 0 && (
          <span className="text-muted-foreground">
            · recall-informed ({entry.recalledEntryBlobIds.length})
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          {new Date(entry.observedAt).toLocaleString()}
        </span>
      </div>

      <p className="mt-1.5 text-muted-foreground">{entry.rationale}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
        {entry.contentHash && (
          <span className="font-mono text-muted-foreground">
            {entry.contentHash.slice(0, 18)}…
          </span>
        )}
        <a
          href={walrusAggregatorUrl(entry.screenshotBlobId)}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-ring)] hover:underline"
        >
          screenshot
        </a>
        <a
          href={walrusAggregatorUrl(entry.htmlBlobId)}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-ring)] hover:underline"
        >
          html
        </a>
        {entry.tlsnProofBlobId && (
          <a
            href={walrusAggregatorUrl(entry.tlsnProofBlobId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-violet-500 hover:underline"
          >
            <FileCheck2 className="h-3 w-3" /> TLS proof
          </a>
        )}
        <a
          href={walrusAggregatorUrl(blobId)}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:underline"
        >
          record
        </a>
        <button
          onClick={onReverify}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/40"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          Re-verify
        </button>
      </div>
      {verify.status !== "verified" && (
        <div className="mt-1 text-[11px] text-amber-600">{verify.reason}</div>
      )}
    </div>
  );
}

function MemoryBadge({ verify }: { verify: MemoryVerifyResult }) {
  if (verify.status === "verified")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-400/15 px-1.5 py-0.5 font-medium text-emerald-600">
        <ShieldCheck className="h-3 w-3" /> memory verified
      </span>
    );
  if (verify.status === "tampered")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-400/15 px-1.5 py-0.5 font-medium text-red-600">
        <ShieldX className="h-3 w-3" /> TAMPERED
      </span>
    );
  if (verify.status === "untrusted-signer")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-400/15 px-1.5 py-0.5 font-medium text-amber-600">
        <AlertTriangle className="h-3 w-3" /> untrusted signer
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
      <ShieldQuestion className="h-3 w-3" /> {verify.status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  if (tier === "PROVEN")
    return (
      <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-600">
        <Lock className="h-3 w-3" /> PROVEN
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
      unverified
    </span>
  );
}

function VerdictChip({ verdict }: { verdict: string }) {
  const tone =
    verdict === "phishing" || verdict === "cloaking"
      ? "bg-red-400/15 text-red-600"
      : verdict === "suspicious"
        ? "bg-amber-400/15 text-amber-600"
        : verdict === "benign"
          ? "bg-emerald-400/15 text-emerald-600"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium uppercase ${tone}`}>
      {verdict}
    </span>
  );
}
