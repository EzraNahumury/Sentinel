# SentinelMem — verifiable agent memory on Walrus

**Walrus track entry.** An autonomous AI security-analyst agent that investigates
URLs and builds a **persistent, append-only "case file" memory on Walrus** —
where every remembered fact is bound to a **TLSNotary proof**, so the agent's
recall cannot be hallucinated or forged. On recall, each memory entry is
**re-verified** before the agent is allowed to act on it; a tampered entry is
mechanically rejected.

> Most agent memory is self-asserted text an agent could fabricate or silently
> corrupt. SentinelMem makes the Walrus track's thesis — *verifiable memory for
> AI* — **literal**: a recalled fact is not "the LLM says it saw X" but "here is
> a re-checkable TLSNotary proof that host X served exactly this content."

Built on the Proof-of-Scan stack: it reuses the working headless WASM-MPC
TLSNotary harness, the deterministic `checkProvenance` gate, and Walrus storage,
and adds the agent + memory layer on top.

## How it works

```
investigate(url):
  1. RECALL  — load the host's prior case files from Walrus and gate each one:
               (a) verify the agent's Ed25519 signature over the record against a
                   PINNED key — any edited field (verdict, host, hash, …) breaks
                   it ⇒ REJECTED;
               (b) re-verify the TLSNotary proof bound to THIS host (notary sig →
                   proven host == entry.host → HTTP 2xx → content hash present and
                   matching). Anything that fails is never seen by the agent.
  2. PROVE   — capture the page + produce a TLSNotary proof. PROVEN evidence
               carries a re-checkable content hash; un-provable targets (e.g.
               TLS 1.3) are kept as flagged UNVERIFIED leads.
  3. ANALYZE — Claude (claude-opus-4-8) classifies the target using the proven
               evidence + the trusted recalled memory (phishing / cloaking /
               suspicious / benign), with structured output.
  4. REMEMBER— append a new case file to the host's append-only Walrus memory
               (entry blob → manifest blob → anchor pointer).
```

Memory model: each case file and each per-host manifest is its own Walrus blob
(immutable, content-addressed). A manifest lists the ordered case-file blob ids
and links the previous manifest (append-only audit chain). The only mutable
pointer is `host → latest-manifest-blob-id`, held in an `AnchorStore` — a local
file for the MVP (`.sentinel/anchors.json`), or on-chain in production
(`move/scan_market/sources/sentinel_memory.move`).

| Piece | File |
| --- | --- |
| Verifiable memory layer (isomorphic) | `src/lib/memory.ts` |
| Provenance engine (capture + prove + re-verify) | `scripts/sentinel/provenance.ts` |
| Analyst agent (Claude, structured output) | `scripts/sentinel/analyst.ts` |
| Orchestrator (`investigate`) | `scripts/sentinel/agent.ts` |
| Agent record signer (Ed25519, pinned) | `scripts/sentinel/signer.ts` |
| Anchor pointer (local file) | `scripts/sentinel/anchor-store.ts` |
| On-chain anchor client | `scripts/sentinel/onchain.ts` |
| MemWal anchor backend | `scripts/sentinel/memwal-store.ts` |
| CLI | `scripts/sentinel/cli.ts` |
| On-chain anchor (Move) | `move/scan_market/sources/sentinel_memory.move` |
| Web inspector (case-file timeline + live verify) | `src/SentinelMemory.tsx` |
| In-browser Ed25519 verify (WebCrypto) | `src/lib/memory-verify.ts` |

## Setup

```bash
pnpm install
pnpm exec playwright install chromium   # one-time, if not already done
```

The analyst LLM is pluggable (`SENTINEL_LLM`). Pick one:

```bash
# Option A — local Ollama, no API key, no extra dependency (default when no key is set)
ollama serve                 # in another terminal
ollama pull llama3.1         # or qwen2.5 / mistral — an instruct model
export SENTINEL_LLM=ollama   # (auto-selected if ANTHROPIC_API_KEY is unset)

# Option A-cloud — Ollama Cloud (hosted big models, no local GPU; API key required)
export OLLAMA_HOST=https://ollama.com
export OLLAMA_KEY=...                 # from ollama.com
export OLLAMA_MODEL=gpt-oss:120b-cloud

# Option B — Claude (best quality)
pnpm add @anthropic-ai/sdk   # pins the SDK version
export ANTHROPIC_API_KEY=sk-ant-...
# SENTINEL_LLM=anthropic is auto-selected when the key is present
```

The provider is orthogonal to the verifiable-memory guarantees — only the
`verdict`/`rationale` come from the LLM, and they are signed, not trusted as
truth. notary defaults to the hosted Railway instance (no Docker); local notary:
`pnpm tlsn:notary && export TLSN_NOTARY_URL=http://127.0.0.1:7047`.

Use a **TLS 1.2-capable target** for PROVEN evidence (`https://example.com/`
works; the project's own `phishing_site/` Worker is a controlled cloaking
adversary). TLS 1.3-only sites are captured but stored as **UNVERIFIED** —
the limitation is surfaced honestly as a two-tier feature, not hidden.

## Run

```bash
pnpm sentinel https://example.com/
```

### Demo moment 1 — cross-session recall

```bash
pnpm sentinel https://example.com/        # first sighting: investigates, remembers
# (process exits — memory is on Walrus, not in the process)
pnpm sentinel https://example.com/        # fresh process RECALLS the proof-backed
                                          # prior case file by host key and is
                                          # recall-informed instantly
```

### Web inspector

```bash
pnpm dev   # http://localhost:5173 — the "SentinelMem" panel
```

After a run, `pnpm sentinel` writes `public/sentinel-memory.json` (host → latest
manifest blob id + the agent signer key). The UI reads it, resolves each host's
manifest + case files from Walrus, and **verifies each record's Ed25519 signature
in your browser** (WebCrypto) — showing a green **memory verified** badge or a
red **TAMPERED** one, with a live **Re-verify** button that re-fetches from
Walrus. Pin a specific agent key with `VITE_SENTINEL_SIGNER=<base64-spki>`
(otherwise the index's signer key is used).

### On-chain anchoring (optional, production path)

The `sentinel_memory` Move module anchors each host's manifest pointer on Sui as
an append-only `MemoryAnchored` event.

**Deployed & verified on Sui testnet:**
- Package: `0xca26b2e73757ee26fd7e32f1f656bcffa81e5bd42b0fe115ca9ba90ee3297c6e`
- `MemoryRegistry` (shared): `0x4df6d15626ffde080ab1b5bf15728fc107a7007aa7adfba0eb059a57a21927b5`
- `Market` (shared, scan_market): `0x86db8e0cf8a5cc9f2a1fbbd163ecc0c504b97b291e69ea2867e13e496110c267`
- Verified `MemoryAnchored` event: tx `7A87ekqwshY7g9JHHZzdXztdi2pZirpZCxD558b8xTGZ`

Activate it (or re-publish your own):

```bash
# 1) republish the package (adds the sentinel_memory module) and note the new
#    package id + the shared MemoryRegistry object id from the publish output
sui client publish --gas-budget 200000000 move/scan_market

# 2) point the agent at it and turn anchoring on (testnet values above)
export SENTINEL_ANCHOR_ONCHAIN=1
export SENTINEL_PKG=0xca26b2e73757ee26fd7e32f1f656bcffa81e5bd42b0fe115ca9ba90ee3297c6e
export SENTINEL_MEMORY_REGISTRY=0x4df6d15626ffde080ab1b5bf15728fc107a7007aa7adfba0eb059a57a21927b5
export SUI_SECRET_KEY=suiprivkey...   # anchoring agent key (export via `sui keytool export`)
pnpm sentinel https://example.com/    # prints the on-chain anchor tx digest
```

`scripts/sentinel/onchain.ts` calls the move function by string target, so it
works without regenerating bindings.

### MemWal backend (Walrus Memory)

MemWal is an **SDK** (`@mysten-incubation/memwal`), not a REST key/value store, and
its memory is **semantic** (`remember`/`recall`), so the pointer is stored as
recallable text per host (best-effort, not an exact key — keep the local/on-chain
anchor as source of truth if you need exact last-writer-wins).

```bash
# SDK already installed. Creds from the SDK credentials panel at https://memory.walrus.xyz/
export MEMWAL_ACCOUNT_ID=0x...                     # from the dashboard
export MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
export MEMWAL_PRIVATE_KEY=<delegate private key>   # SECRET (e.g. .sentinel/memwal-key.txt, gitignored)

pnpm memwal:test                       # verify remember + recall round-trip
pnpm sentinel "https://example.com/"   # agent routes the pointer through MemWal
```

The SDK is imported lazily; only the pointer moves to MemWal (blobs stay on
Walrus). Confirm exact method/param names against the MemWal docs — see
`scripts/sentinel/memwal-store.ts` for the seam.

### Walrus Sites (host the inspector on Walrus)

The Vite build uses `base: "./"` and ships a `ws-resources.json` (SPA fallback),
so the inspector deploys as a Walrus Site:

```bash
# install site-builder (suiup) + download the network sites-config.yaml (see docs)
pnpm deploy:site            # vite build && site-builder deploy --epochs max ./dist
site-builder convert <OBJECT_ID_FROM_OUTPUT>   # → https://<base36>.wal.app
```

The first deploy writes `object_id` into `ws-resources.json` (commit it so
re-deploys update the same site). Optionally attach a SuiNS name → `https://<name>.wal.app`.

### Seal (encrypt case files — opt-in privacy)

`scripts/sentinel/seal.ts` encrypts a case file before Walrus and decrypts for
authorized readers via a Seal allowlist policy. Needs on-chain setup you deploy
(publish Seal's `whitelist.move` pattern, get key-server object ids), then set
`SENTINEL_SEAL=1`, `SEAL_PKG`, `SEAL_WHITELIST`, `SEAL_KEY_SERVERS`,
`SEAL_THRESHOLD`, and wire `encryptJson`/`decryptJson` around the case-file
write/read. The default flow stores plaintext (demo-friendly); Seal is the
private-investigation upgrade.

### Demo moment 2 — tampered memory is rejected

```bash
pnpm sentinel:tamper example.com   # flips a stored verdict without re-signing
pnpm sentinel https://example.com/ # recall now REJECTS it: "signature invalid"
```

Walrus blobs are immutable, so the helper forges a record (flip `verdict`
without re-signing), uploads it as a new blob, and repoints the manifest. On
recall the agent's signature no longer matches (and a swapped foreign proof no
longer attests `entry.host`), so the entry is **REJECTED** before the agent can
act on it — visible in the CLI and as a **TAMPERED** badge in the web UI
(re-verified live in your browser). The memory's decision payload, not just its
provenance, is integrity-protected.

## Env knobs

| Var | Default | Purpose |
| --- | --- | --- |
| `SENTINEL_LLM` | `anthropic` if key set, else `ollama` | Analyst backend: `ollama` (local, no key) or `anthropic` |
| `SENTINEL_MODEL` | `llama3.1` (ollama) / `claude-opus-4-8` (anthropic) | Analyst model |
| `ANTHROPIC_API_KEY` | — | Required **only** for `SENTINEL_LLM=anthropic` |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server — local, or `https://ollama.com` for Ollama Cloud |
| `OLLAMA_KEY` | — | API key (Bearer) for Ollama Cloud |
| `OLLAMA_MODEL` | `llama3.1` | Ollama model (e.g. `gpt-oss:120b-cloud`); overrides `SENTINEL_MODEL` for the ollama backend |
| `OLLAMA_THINK` | — | Reasoning level for reasoning models, e.g. `low`/`medium`/`high` for `gpt-oss` |
| `SENTINEL_VANTAGES` | `desktop,iphone` | Device profiles captured per investigation (cloaking detection) |
| `TLSN_NOTARY_URL` | hosted Railway notary | TLSNotary notary |
| `WALRUS_PUBLISHER` / `WALRUS_AGGREGATOR` | testnet defaults | Walrus endpoints |
| `SENTINEL_EPOCHS` | `5` | Memory blob lifetime (epochs) — outlives the demo |
| `SENTINEL_ANCHORS` | `.sentinel/anchors.json` | Anchor pointer file |
| `SENTINEL_SIGNER` | `.sentinel/agent-key.pem` | Analyst Ed25519 signing key (auto-generated) |
| `SENTINEL_AUDITOR_SIGNER` | `.sentinel/auditor-key.pem` | Auditor agent's own key (distinct identity) |
| `SENTINEL_ANALYST_KEY` | from published index | Analyst key the Auditor pins (trust anchor) |

## Multi-agent: the Auditor (trust-minimized cross-agent coordination)

A second agent — the **Auditor** (`scripts/sentinel/auditor.ts`, `pnpm
sentinel:audit <host>`) — consumes the Analyst's memory from Walrus and
**independently re-verifies** each case file by checking the Analyst's Ed25519
signature against a **pinned analyst key**. It trusts the data because it can
re-verify it, **not** because it trusts a live peer. It then emits its own
signed `AuditRecord` to Walrus, referencing the analyst entry.

```bash
pnpm sentinel "https://example.com/"   # Analyst (key A) writes signed memory
pnpm sentinel:audit example.com        # Auditor (key B) CONCUR — re-verified A's signature
pnpm sentinel:tamper example.com
pnpm sentinel:audit example.com        # Auditor DISSENT — tamper caught independently
```

The two agents are distinct signing identities (the CLI prints each key's
fingerprint). The Auditor pins the Analyst key from the published index
(`signerPublicKey`) or `SENTINEL_ANALYST_KEY`; its own key is
`SENTINEL_AUDITOR_SIGNER` (default `.sentinel/auditor-key.pem`). This is
delegation + cross-agent memory sharing with Walrus as the only shared channel.

## Honest limitations

- **TLS 1.2 only** for PROVEN evidence (tlsn alpha.12). Most modern sites are
  TLS 1.3 → stored as flagged UNVERIFIED. **Cloudflare Workers ARE provable**:
  Cloudflare's default Minimum TLS Version is 1.0, so the TLS-1.2 prover connects
  (force HTTP/1.1; avoid sites with bot challenges). Use `example.com` or the
  `phishing_site/` worker for PROVEN demos.
- **Ollama Cloud ignores `format`** (JSON schema) and returns prose; the analyst
  recovers the JSON defensively (`extractJson`). Local Ollama honors `format`.
  For `gpt-oss` set `OLLAMA_THINK=low`. Quality: cloud `gpt-oss:120b` ≫ local
  `llama3.1`.
- **Walrus testnet**: an epoch is ~2 days; default `epochs=5` (~10 days) is safe
  for a demo. Use `SENTINEL_EPOCHS` / `epochs=max` for longer; testnet is wiped
  periodically.
- **Head-only proving** (inherited): large pages may prove only the first bytes.
- **On-chain anchoring** is wired (`onchain.ts` + the `sentinel_memory` module);
  activates after republish. Default MVP uses a local pointer + the published UI
  index.
- **MemWal**: `MemWalAnchorStore` wraps the real `@mysten-incubation/memwal` SDK
  (semantic `remember`/`recall`, per-host namespace). Best-effort pointer — keep
  the local/on-chain anchor authoritative for exact reads.
- **Web inspector** verifies the **agent signature** in-browser; the **TLSNotary
  proof** is re-checked by the verifier node (the UI links to the proof blob).
