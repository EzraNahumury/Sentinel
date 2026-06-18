// SentinelMem inspector — per-host, append-only agent memory rendered from
// Walrus, with a client-side "memory verified" badge and a live re-verify
// button. Reads a small public index (host -> latest manifest blob id) written
// by the agent (public/sentinel-memory.json), resolves each host's manifest +
// case files from Walrus, and verifies each record's Ed25519 signature in the
// browser (crypto.subtle), so anyone can independently confirm the memory has
// not been tampered.

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
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
  Anchor,
  ExternalLink,
  Check,
  Search,
} from "lucide-react";
import { Card, CardContent } from "./components/ui/card";
import { walrusAggregatorUrl } from "./lib/walrus";
import {
  readManifest,
  readCaseFile,
  readEntryRaw,
  isSealedEnvelope,
  type CaseFileEntry,
  type SealedEnvelope,
} from "./lib/memory";
import {
  verifyCaseFileSignature,
  type MemoryVerifyResult,
} from "./lib/memory-verify";
import { decryptSealedInBrowser } from "./lib/seal-browser";
import { SENTINEL_PKG, MEMORY_REGISTRY_ID, NETWORK } from "./constants";

const INDEX_URL = "/sentinel-memory.json";
const TRUSTED_SIGNER =
  (import.meta.env.VITE_SENTINEL_SIGNER as string | undefined) || undefined;
// Local agent server (pnpm sentinel:serve) that runs real investigations.
const AGENT_URL =
  (import.meta.env.VITE_AGENT_URL as string | undefined) || "http://localhost:8787";

interface MemoryIndex {
  schema?: string;
  signerPublicKey?: string;
  // Per-owner memory: owners[<wallet>][<host>] = manifest blob id.
  owners?: Record<string, Record<string, string>>;
  // Legacy shared format (pre per-wallet) — still read as a fallback.
  anchors?: Record<string, string>;
  updatedAt?: string;
}

interface LoadedEntry {
  blobId: string;
  entry?: CaseFileEntry; // present when plaintext (or after in-browser decrypt)
  verify?: MemoryVerifyResult;
  sealed?: SealedEnvelope; // present when Seal-encrypted and not yet decrypted
}

interface HostMemory {
  host: string;
  manifestBlobId: string;
  entries: LoadedEntry[]; // newest first
}

async function loadMemory(
  owner: string,
): Promise<{ trusted?: string; hosts: HostMemory[] }> {
  let index: MemoryIndex;
  try {
    const res = await fetch(INDEX_URL, { cache: "no-store" });
    if (!res.ok) return { trusted: TRUSTED_SIGNER, hosts: [] };
    // A missing file makes the dev server return index.html (HTML, not JSON);
    // parse defensively so "no memory yet" isn't shown as a JSON error.
    index = JSON.parse(await res.text()) as MemoryIndex;
  } catch {
    return { trusted: TRUSTED_SIGNER, hosts: [] };
  }
  const trusted = TRUSTED_SIGNER ?? index.signerPublicKey;
  // Only this wallet's investigations.
  const mine = index.owners?.[owner.toLowerCase()] ?? {};
  const hosts: HostMemory[] = [];
  for (const [host, manifestBlobId] of Object.entries(mine)) {
    try {
      const manifest = await readManifest(manifestBlobId);
      const entries: LoadedEntry[] = [];
      for (const blobId of manifest.entries) {
        const raw = await readEntryRaw(blobId);
        if (isSealedEnvelope(raw)) {
          entries.push({ blobId, sealed: raw });
        } else {
          const verify = await verifyCaseFileSignature(raw, trusted);
          entries.push({ blobId, entry: raw, verify });
        }
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
  const account = useCurrentAccount();
  const owner = account?.address;
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["sentinel-memory", owner],
    queryFn: () => loadMemory(owner as string),
    enabled: !!owner,
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
            Your investigations, scoped to the connected wallet. Each record is
            Ed25519-signed by the agent and verified in your browser — tampering
            is detectable here, not just on the server.
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

      <InvestigateBox onDone={() => refetch()} />

      {!owner ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Connect a wallet (top right) to view and build memory scoped to your
            address. Each wallet has its own verifiable, append-only memory.
          </CardContent>
        </Card>
      ) : isPending ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your memory from Walrus…
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
            No memory for this wallet yet. Use the{" "}
            <span className="text-foreground">Investigate</span> box above to
            analyze a URL — the case file will appear here under your address.
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
              trusted={trusted}
              onReverify={reverify}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InvestigateBox({ onDone }: { onDone: () => void }) {
  const account = useCurrentAccount();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; msg: string }
    | { status: "error"; msg: string }
  >({ status: "idle" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = url.trim();
    if (!target || state.status === "running") return;
    if (!account) {
      setState({
        status: "error",
        msg: "Connect a wallet first — memory is recorded under your address.",
      });
      return;
    }
    setState({ status: "running" });
    try {
      const res = await fetch(`${AGENT_URL}/api/investigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, owner: account.address }),
        signal: AbortSignal.timeout(180000),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `agent error ${res.status}`);
      setState({
        status: "done",
        msg: `${data.host}: ${String(data.verdict).toUpperCase()} (${Math.round(
          (data.confidence ?? 0) * 100,
        )}%) · ${data.tier}`,
      });
      setUrl("");
      onDone();
    } catch (err) {
      const m = (err as Error).message || String(err);
      const timedOut =
        (err as Error).name === "TimeoutError" || /timed out|timeout|abort/i.test(m);
      const offline = /Failed to fetch|NetworkError|ECONNREFUSED|refused|ENOTFOUND/i.test(m);
      setState({
        status: "error",
        msg: timedOut
          ? "Still investigating on the server — TLS 1.3 sites retry the notary and take longer. Click Reload in a minute to see it (it lands as UNVERIFIED)."
          : offline
            ? "Agent server not reachable — start it with `pnpm sentinel:serve` (with OLLAMA_* env set)."
            : m,
      });
    }
  };

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://suspicious-site.example/ — investigate & remember"
            className="w-full rounded-md border bg-[var(--color-card)] py-2 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-[var(--color-ring)]"
          />
        </div>
        <button
          type="submit"
          disabled={!url.trim() || !account || state.status === "running"}
          title={account ? "Investigate & remember under your wallet" : "Connect a wallet first"}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {state.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Investigate
        </button>
      </div>
      {state.status === "running" && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Running the agent — TLSNotary proof + headless capture + LLM analysis. This can take 30–90s…
        </p>
      )}
      {state.status === "done" && (
        <p className="mt-1.5 text-xs text-emerald-500">Added {state.msg}</p>
      )}
      {state.status === "error" && (
        <p className="mt-1.5 text-xs text-amber-600">{state.msg}</p>
      )}
    </form>
  );
}

function HostBlock({
  host,
  live,
  busy,
  trusted,
  onReverify,
}: {
  host: HostMemory;
  live: Record<string, MemoryVerifyResult>;
  busy: string | null;
  trusted?: string;
  onReverify: (blobId: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
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
        <AnchorOnChain host={host.host} manifestBlobId={host.manifestBlobId} />
      </div>
      <div className="divide-y">
        {host.entries.map((e) => (
          <EntryRow
            key={e.blobId}
            loaded={e}
            liveVerify={live[e.blobId]}
            trusted={trusted}
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
  liveVerify,
  trusted,
  busy,
  onReverify,
}: {
  loaded: LoadedEntry;
  liveVerify?: MemoryVerifyResult;
  trusted?: string;
  busy: boolean;
  onReverify: () => void;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [revealed, setRevealed] = useState<{
    entry: CaseFileEntry;
    verify: MemoryVerifyResult;
  } | null>(null);
  const [dec, setDec] = useState<{ status: "idle" | "decrypting" | "error"; error?: string }>(
    { status: "idle" },
  );

  const entry = revealed?.entry ?? loaded.entry;
  const verify = liveVerify ?? revealed?.verify ?? loaded.verify;

  // Encrypted record not yet decrypted in this browser.
  if (!entry) {
    const onDecrypt = async () => {
      if (!loaded.sealed || !account) return;
      setDec({ status: "decrypting" });
      try {
        const plain = await decryptSealedInBrowser(
          loaded.sealed,
          account.address,
          async (msg) => (await dAppKit.signPersonalMessage({ message: msg })).signature,
        );
        const v = await verifyCaseFileSignature(plain, trusted);
        setRevealed({ entry: plain, verify: v });
        setDec({ status: "idle" });
      } catch (e) {
        setDec({ status: "error", error: (e as Error).message });
      }
    };
    return (
      <div className="px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-400">
            <Lock className="h-3 w-3" /> Seal-encrypted
          </span>
          <span className="text-muted-foreground">
            content hidden — only whitelisted addresses can decrypt
          </span>
          <a
            href={walrusAggregatorUrl(loaded.blobId)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-muted-foreground hover:underline"
          >
            sealed blob
          </a>
          <button
            onClick={onDecrypt}
            disabled={!account || dec.status === "decrypting"}
            title={account ? "Decrypt with your connected wallet" : "Connect a wallet first"}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50"
          >
            {dec.status === "decrypting" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Lock className="h-3 w-3" />
            )}
            {dec.status === "decrypting" ? "Decrypting…" : "Decrypt with wallet"}
          </button>
        </div>
        {dec.status === "error" && (
          <div className="mt-1 text-[11px] text-amber-600">
            {/NoAccess|does not have access/i.test(dec.error ?? "")
              ? "Access denied — your address is not on the Seal whitelist."
              : dec.error}
          </div>
        )}
      </div>
    );
  }

  const blobId = loaded.blobId;
  const v: MemoryVerifyResult = verify ?? { status: "unsupported", reason: "unverified" };
  return (
    <div className="px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {loaded.sealed && (
          <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-400">
            <Lock className="h-3 w-3" /> decrypted
          </span>
        )}
        <VerdictChip verdict={entry.verdict} />
        <TierBadge tier={entry.tier} />
        <MemoryBadge verify={v} />
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
        {!loaded.sealed && (
          <button
            onClick={onReverify}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/40"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            Re-verify
          </button>
        )}
      </div>
      {v.status !== "verified" && (
        <div className="mt-1 text-[11px] text-amber-600">{v.reason}</div>
      )}
    </div>
  );
}

function AnchorOnChain({
  host,
  manifestBlobId,
}: {
  host: string;
  manifestBlobId: string;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "signing" }
    | { status: "done"; digest: string }
    | { status: "error"; error: string }
  >({ status: "idle" });

  const anchor = async () => {
    setState({ status: "signing" });
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${SENTINEL_PKG}::sentinel_memory::anchor_memory`,
        arguments: [
          tx.object(MEMORY_REGISTRY_ID),
          tx.pure.string(host),
          tx.pure.string(manifestBlobId),
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (res?.$kind === "FailedTransaction") {
        throw new Error("transaction failed on-chain");
      }
      const digest: string | undefined = res?.Transaction?.digest ?? res?.digest;
      if (!digest) throw new Error("no transaction digest returned");
      setState({ status: "done", digest });
    } catch (e) {
      setState({ status: "error", error: (e as Error).message });
    }
  };

  if (state.status === "done") {
    return (
      <a
        href={`https://suiscan.com/${NETWORK}/tx/${state.digest}`}
        target="_blank"
        rel="noreferrer"
        title={state.digest}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-500 hover:bg-emerald-500/20"
      >
        <Check className="h-3 w-3" /> anchored on-chain
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <button
        onClick={anchor}
        disabled={!account || state.status === "signing"}
        title={
          account
            ? "Write this host's memory pointer to Sui (MemoryAnchored event)"
            : "Connect a wallet first"
        }
        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50"
      >
        {state.status === "signing" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Anchor className="h-3 w-3" />
        )}
        {state.status === "signing" ? "Anchoring…" : "Anchor on-chain"}
      </button>
      {state.status === "error" && (
        <span
          className="max-w-[200px] truncate text-[10px] text-amber-600"
          title={state.error}
        >
          {state.error}
        </span>
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
