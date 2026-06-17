# SentinelMem — verifiable agent memory on Walrus

> An autonomous AI security‑analyst agent whose long‑term memory lives on
> **Walrus**, where every record is **Ed25519‑signed** (tamper‑rejected on
> recall) and backed by a **TLSNotary** provenance proof — re‑verifiable in your
> browser. A recalled fact isn't *"the LLM says it saw X"*, it's *"here is a
> re‑checkable proof that host X really served X, in a record no one can forge."*

**Sui Hackathon Overflow · Walrus track** — *Walrus as a Verifiable Data Platform for AI.*

---

## The problem

AI agents are stateless and fragmented. The usual fix — "give the agent a memory
store" — just relocates the trust problem: naive agent memory is **self‑asserted
text** an agent (or anyone who can edit the store) can fabricate or silently
corrupt. If agents are going to *act on* their own and each other's memory, that
memory needs **integrity and provenance**, not just persistence.

## What SentinelMem does

A long‑running URL‑investigation agent. For each target it:

```
investigate(url):
  1. RECALL    load the host's prior case files from Walrus and gate each one:
               (a) verify the agent's Ed25519 signature over the record vs a
                   PINNED key — any edited field breaks it  ⇒  REJECTED
               (b) re-verify the TLSNotary proof bound to THIS host
                   (notary sig → proven host → HTTP 2xx → content hash)
               anything tampered/unprovable never reaches the agent.
  2. PROVE     capture the page across device vantages + a real TLSNotary MPC
               proof of provenance (PROVEN), or a flagged UNVERIFIED capture.
  3. ANALYZE   an LLM (Ollama or Claude) classifies the target over the proven
               evidence + the trusted recalled memory → phishing / cloaking /
               suspicious / benign.
  4. REMEMBER  append a new, SIGNED case file to the host's append-only Walrus
               memory; anchor the pointer (local file, on-chain, or MemWal).
```

A **web inspector** renders the per‑host memory timeline and **re‑verifies each
record's signature in your browser** (WebCrypto Ed25519) — so anyone can confirm
the memory wasn't tampered, without trusting our server.

## Why it fits the Walrus track

- **Verifiable memory for AI — made literal.** Walrus is the source of truth for
  agent memory, and every memory carries cryptographic integrity (agent
  signature) **and** provenance (TLSNotary). Not a file dump.
- **Long‑running, stateful agent** — recall across sessions changes behavior
  (re‑flags a returning cloaker instantly).
- **Artifact‑driven** — proofs, screenshots, HTML, case files, and manifests are
  durable Walrus artifacts the agent reuses.
- **Pluggable** — the pointer backend swaps between a local file, an on‑chain
  anchor (Sui Move), and **MemWal (Walrus Memory)** with zero agent changes.

## The differentiator

Almost any team can put agent memory on Walrus. SentinelMem makes that memory
**unforgeable**: tamper *any* field of a stored record → the agent's signature
breaks → rejected; swap in a proof from another host → it no longer attests the
claimed host → rejected. Anyone can re‑check it — even in the browser.

---

## Live on Sui testnet (verified)

| | |
| --- | --- |
| Package | `0xca26b2e73757ee26fd7e32f1f656bcffa81e5bd42b0fe115ca9ba90ee3297c6e` |
| `MemoryRegistry` (shared) | `0x4df6d15626ffde080ab1b5bf15728fc107a7007aa7adfba0eb059a57a21927b5` |
| `Market` (shared) | `0x86db8e0cf8a5cc9f2a1fbbd163ecc0c504b97b291e69ea2867e13e496110c267` |
| `MemoryAnchored` event | verified — agent‑driven anchor tx `GjknGzPK5S3ctGKebj8Ndw7PWhQgz1XBy8yt519RA1Dr` |

Explore on [Suiscan](https://suiscan.com/testnet/object/0xca26b2e73757ee26fd7e32f1f656bcffa81e5bd42b0fe115ca9ba90ee3297c6e).

---

## Quickstart

### 1. Install

```bash
pnpm install
pnpm exec playwright install chromium   # headless capture (one-time)
```

### 2. Pick an LLM backend (`SENTINEL_LLM`)

```bash
# Option A — local/cloud Ollama (no Anthropic SDK, no key for local)
ollama serve && ollama pull llama3.1            # local
# …or Ollama Cloud:
export OLLAMA_HOST=https://ollama.com
export OLLAMA_KEY=<your-key>
export OLLAMA_MODEL=gpt-oss:120b-cloud
export OLLAMA_THINK=low

# Option B — Claude (best quality)
pnpm add @anthropic-ai/sdk
export ANTHROPIC_API_KEY=sk-ant-...
```

`SENTINEL_LLM` auto‑selects `anthropic` if `ANTHROPIC_API_KEY` is set, else
`ollama`. The LLM choice is **orthogonal** to the verifiable‑memory guarantees —
the verdict is signed, not trusted as truth.

> **Windows (PowerShell):** use `$env:NAME = "value"` instead of `export`, or run
> the bundled helper `.\scripts\run.ps1` (sets env from `.sentinel/ollama-key.txt`).

### 3. Run the agent

```bash
pnpm sentinel "https://example.com/"     # investigate → signed case file on Walrus
pnpm sentinel "https://example.com/"     # again → recalls + re-verifies prior memory
pnpm dev                                 # http://localhost:5173 → SentinelMem panel
```

> The notary defaults to a hosted instance; if it's unreachable the agent degrades
> to `UNVERIFIED` (signing + recall + tamper‑rejection still work). For reliable
> `PROVEN` evidence, run a local notary (`pnpm tlsn:notary` + Docker) and set
> `TLSN_NOTARY_URL=http://127.0.0.1:7047`, or use `SENTINEL_NO_PROOF=1` to skip it.

### 4. Demos

```bash
# Tamper-rejection: forge a stored record, then recall rejects it
pnpm sentinel:tamper example.com
pnpm sentinel "https://example.com/"     # → "signature invalid — record tampered"

# Cloaking: a local target that serves different content per device
pnpm cloak:serve                                          # http://localhost:8799/cloak
SENTINEL_NO_PROOF=1 pnpm sentinel "http://localhost:8799/cloak"   # → CLOAKING (2 clusters)
```

### 5. Tests

```bash
pnpm test    # security core: sign/verify, tamper-rejection, untrusted-key — no network
```

---

## The verifiable‑memory guarantee

Each case file is signed with the agent's Ed25519 key over a **canonical message**
of its integrity‑relevant fields; on recall the signature is verified against a
**pinned** signer key. Two independent layers defend the headline claim:

1. **Signature (integrity + authenticity).** Tamper any field — `verdict`, `host`,
   `contentHash`, `renderHash`, `tier`, proof id — and the signature no longer
   matches → **rejected**. A third party can't re‑sign without the agent's key.
2. **Host‑bound proof (provenance truth).** A `PROVEN` entry's TLSNotary proof is
   re‑verified against the entry's **own host** (never an attacker‑supplied
   field), with a mandatory content‑hash match — so a foreign proof can't be
   swapped in.

`contentHash` (the proof's TLS‑transcript hash) is kept for the proof tamper‑check;
`renderHash` (the rendered‑DOM hash, tier‑independent) is the comparable join key
for **cloaking** and cross‑time change detection. The browser inspector verifies
the signature client‑side via WebCrypto Ed25519 — server‑less confirmation.

---

## Architecture

| Component | File |
| --- | --- |
| Verifiable memory layer (isomorphic) | `src/lib/memory.ts` |
| In‑browser Ed25519 verify (WebCrypto) | `src/lib/memory-verify.ts` |
| Web inspector (case‑file timeline + live verify) | `src/SentinelMemory.tsx` |
| Provenance engine (multi‑vantage capture + prove + re‑verify) | `scripts/sentinel/provenance.ts` |
| Analyst agent (pluggable Ollama/Claude, structured output) | `scripts/sentinel/analyst.ts` |
| Orchestrator (`investigate`) | `scripts/sentinel/agent.ts` |
| Agent record signer (Ed25519, pinned) | `scripts/sentinel/signer.ts` |
| Anchor backends (file / MemWal) | `scripts/sentinel/anchor-store.ts`, `memwal-store.ts` |
| On‑chain anchor client | `scripts/sentinel/onchain.ts` |
| Seal encryption helper (opt‑in) | `scripts/sentinel/seal.ts` |
| CLI / tamper demo / cloak target | `scripts/sentinel/{cli,tamper}.ts`, `phishing_site/local-server.ts` |
| Move modules (escrow + on‑chain anchor) | `move/scan_market/sources/{scan_market,sentinel_memory}.move` |
| Tests | `scripts/sentinel/sentinel.test.ts` |

Built on the original **Proof‑of‑Scan** decentralized scan marketplace
(`ScanExperience`, `JobBoard`, the TLSNotary harness in `scripts/tlsn/`) as the
underlying evidence‑acquisition layer.

---

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `SENTINEL_LLM` | `anthropic` if key set, else `ollama` | Analyst backend |
| `SENTINEL_MODEL` | `llama3.1` / `claude-opus-4-8` | Analyst model |
| `ANTHROPIC_API_KEY` | — | Required only for `SENTINEL_LLM=anthropic` |
| `OLLAMA_HOST` / `OLLAMA_KEY` / `OLLAMA_MODEL` / `OLLAMA_THINK` | localhost / — / `llama3.1` / — | Ollama (local or Cloud) |
| `SENTINEL_VANTAGES` | `desktop,iphone` | Device profiles per investigation (cloaking) |
| `TLSN_NOTARY_URL` | hosted Railway notary | TLSNotary notary |
| `SENTINEL_NO_PROOF` | — | Skip TLSNotary (UNVERIFIED tier; signing still active) |
| `SENTINEL_EPOCHS` | `5` | Walrus blob lifetime (epochs) |
| `SENTINEL_ANCHORS` / `SENTINEL_SIGNER` | `.sentinel/anchors.json` / `.sentinel/agent-key.pem` | Local pointer + signer key |
| `SENTINEL_ANCHOR_ONCHAIN` + `SENTINEL_PKG` + `SENTINEL_MEMORY_REGISTRY` + `SUI_SECRET_KEY` | — | Enable on‑chain anchoring |
| `MEMWAL_SERVER_URL` / `MEMWAL_ACCOUNT_ID` / `MEMWAL_DELEGATE_KEY` | — | Route the pointer through MemWal |

---

## Tech stack

**Walrus** (memory + evidence) · **Sui Move** (on‑chain anchor) · **TLSNotary**
(provenance, headless WASM‑MPC harness) · pluggable LLM (**Ollama** local/cloud or
**Claude**) · **MemWal**‑ and **Seal**‑ready · **Walrus Sites**‑deployable ·
React + Vite + Tailwind inspector with in‑browser Ed25519 verification ·
Playwright capture.

## Extras (code ready; activate with your own accounts)

- **MemWal** — `MemWalAnchorStore` wraps the `@mysten-incubation/memwal` SDK; set
  `MEMWAL_*` to route the pointer through Walrus Memory.
- **Seal** — `scripts/sentinel/seal.ts` encrypts case files before Walrus for
  authorized readers (needs a deployed allowlist policy + key servers).
- **Walrus Sites** — the build sets `base: "./"` + ships `ws-resources.json`;
  deploy the inspector with `pnpm deploy:site` (site‑builder).

## Honest limitations

- **TLS 1.2 only** for `PROVEN` evidence (tlsn alpha.12). Most modern sites are
  TLS 1.3 → stored as flagged `UNVERIFIED`. Cloudflare Workers **are** provable
  (default min TLS 1.0). Use `example.com` or the bundled cloaking target for
  `PROVEN` demos.
- The hosted notary is a free‑tier instance that can sleep; the agent retries to
  wake it and degrades gracefully to `UNVERIFIED` if it's down.
- The browser badge verifies the **agent signature**; the **TLSNotary proof** is
  re‑checked by the node verifier (the UI links to the proof blob).

## Documentation

- **[SENTINELMEM.md](SENTINELMEM.md)** — deep dive, full run guide, env, on‑chain/MemWal/Seal/Walrus‑Sites activation.
- **[PITCH.md](PITCH.md)** — problem → solution → track fit → live demo script.
- **[DEVPOST.md](DEVPOST.md)** — submission writeup + demo video storyboard.

## License

Hackathon project — see repository for details.
