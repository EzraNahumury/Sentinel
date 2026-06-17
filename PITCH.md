# SentinelMem — pitch (Sui Hackathon Overflow · Walrus track)

**One line:** an autonomous AI security-analyst agent whose long-term memory
lives on Walrus and is **cryptographically verifiable** — a recalled fact is not
"the LLM says it saw X" but a re-checkable proof that host X really served X, in
a record the agent signed and no one can tamper.

## The problem (the track's thesis)

AI agents are stateless and fragmented; they need durable, portable memory. But
naive agent memory is **self-asserted text** — an agent (or anyone who can edit
the store) can fabricate or silently corrupt it. If agents are going to act on
each other's memory, memory needs **integrity and provenance**, not just
persistence.

## What we built

A long-running URL-investigation agent. For each target it:

1. **Recalls** the host's prior case files from Walrus and **re-verifies** every
   one — the agent's Ed25519 signature over the record (pinned key) *and* the
   TLSNotary proof bound to that host. Anything tampered or unprovable is
   dropped before the agent reasons.
2. **Proves** the page: a real TLSNotary MPC proof that the host served this
   content over TLS (or a flagged UNVERIFIED capture for un-provable targets).
3. **Analyzes** with Claude (`claude-opus-4-8`) over the proven evidence + the
   trusted recalled memory → phishing / cloaking / suspicious / benign.
4. **Remembers**: appends a new, signed case file to the host's append-only
   Walrus memory; anchors the pointer (locally, on-chain, or in MemWal).

## Why it fits the Walrus track exactly

- **Verifiable memory for AI** — made *literal*. Walrus is the source of truth
  for agent memory, and every memory carries cryptographic integrity (agent
  signature) + provenance (TLSNotary). This is "Walrus as a Verifiable Data
  Platform for AI," not a file dump.
- **Long-running, stateful agent** — recall across sessions changes behavior
  (re-flags a returning cloaker instantly).
- **Artifact-driven** — proofs, screenshots, HTML, case files, manifests are all
  durable Walrus artifacts the agent reuses.
- **Pluggable** — the pointer backend is a one-line swap between a local file,
  an on-chain anchor, and **MemWal (Walrus Memory)**.

## Differentiator

Almost any team can put agent memory on Walrus. We make that memory
**unforgeable**: tamper any field of a stored record → the agent's signature
breaks → rejected; swap in a proof from another host → it no longer attests the
claimed host → rejected. Anyone can re-check it — even in the browser.

## Live demo (3–4 min)

> Setup once: `pnpm install && pnpm exec playwright install chromium`. The
> analyst LLM is pluggable: **local Ollama** (`ollama serve && ollama pull
> llama3.1`, no API key) or **Claude** (`pnpm add @anthropic-ai/sdk && export
> ANTHROPIC_API_KEY=...`). Notary defaults to the hosted instance. Use a TLS 1.2
> target (`https://example.com/` or your `phishing_site/`).

### Moment 1 — cross-session recall (memory that persists & changes behavior)

```bash
pnpm sentinel https://example.com/
```
> "First sighting. The agent captures the page, produces a TLSNotary proof,
> classifies it with Claude, and writes a **signed** case file to Walrus. Note
> the proof blob id and the manifest — that's the host's memory head."

```bash
pnpm sentinel https://example.com/
```
> "New process — nothing in memory locally; the memory lives on Walrus. It
> **recalls** the prior proof-backed case file by host key, re-verifies it, and
> is now recall-informed. The agent built on what it proved before."

Open the web app → the **SentinelMem** panel shows the host's case-file timeline
with a green **memory verified** badge (verified live in your browser via
WebCrypto — not our server).

### Moment 2 — forged memory is mechanically rejected

In the web UI, that **Re-verify** button re-fetches the record from Walrus and
re-checks the signature. Now forge the stored memory (one command — it flips a
verdict, re-uploads a tampered record, and repoints the manifest, since Walrus
blobs are immutable):

```bash
pnpm sentinel:tamper example.com
```
> "Reload the UI (or `pnpm sentinel https://example.com/` again). The agent's
> signature no longer matches the record, so it flips to **TAMPERED** / is
> **rejected** before the agent can act on it. The decision payload — not just
> the provenance — is integrity-protected. A forged memory is mechanically
> discarded, and you can confirm it yourself in the browser."

## Honest limitations (say them)

- TLSNotary alpha.12 is **TLS 1.2 only** — modern sites are stored as flagged
  UNVERIFIED and excluded from *trusted* recall. PROVEN flows use a controlled
  TLS 1.2 target.
- The browser badge verifies the **agent signature** (record integrity); the
  **TLSNotary proof** is re-checked by the verifier node (linked in the UI).
- On-chain anchoring and the MemWal backend are wired and ready; the default MVP
  uses a local pointer + a published JSON index for the UI.

## Stack

Walrus (memory + evidence) · TLSNotary (provenance) · Sui Move (on-chain anchor)
· pluggable analyst LLM (local **Ollama** or **Claude**) · MemWal-ready · React
inspector with in-browser Ed25519 verification.
