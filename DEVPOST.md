# SentinelMem — submission (Sui Hackathon Overflow · Walrus track)

> Verifiable agent memory on Walrus: an AI security analyst whose recall cannot
> be hallucinated, forged, or tampered.

## Inspiration
AI agents are stateless and fragmented, and the usual fix — "give the agent a
memory store" — just moves the trust problem. Naive agent memory is self-asserted
text that the agent (or anyone who can edit the store) can fabricate or silently
corrupt. If agents are going to *act on* their own and each other's memory, that
memory needs **integrity and provenance**, not just persistence. The Walrus track
asks for exactly this: "Walrus as a Verifiable Data Platform for AI."

## What it does
SentinelMem is a long-running URL-investigation agent. For each target it:
1. **Recalls** the host's prior case files from Walrus and **re-verifies** every
   one — the agent's Ed25519 signature over the record (pinned key) *and* the
   TLSNotary proof bound to that host. Tampered or unprovable memory is dropped
   before the agent reasons.
2. **Proves** the page across multiple device vantages: a real TLSNotary MPC
   proof of provenance, plus cross-vantage render hashes that flag cloaking
   (different devices served different pages).
3. **Analyzes** with a pluggable LLM (local/cloud **Ollama** or **Claude**) over
   the proven evidence + the trusted recalled memory → phishing / cloaking /
   suspicious / benign.
4. **Remembers**: appends a new, signed case file to the host's append-only
   Walrus memory; anchors the pointer (local file, on-chain, or MemWal).

A web inspector renders the per-host memory timeline and **re-verifies each
record's signature in your browser** (WebCrypto) — so anyone can confirm the
memory wasn't tampered, without trusting our server.

## How we built it
- **Walrus** — source of truth for agent memory *and* evidence: case files,
  per-host manifests (append-only audit chain), screenshots, HTML, and TLSNotary
  presentations are each Walrus blobs; the mutable pointer is the only thing
  outside Walrus (local file / on-chain / MemWal).
- **Integrity** — every case file is Ed25519-signed by the agent over a canonical
  message; recall verifies against a pinned key. Tamper any field → signature
  breaks → rejected.
- **Provenance** — reused a working headless WASM-MPC **TLSNotary** harness
  (COOP/COEP-isolated Chromium + WebSocket→TCP proxy) and the deterministic
  `checkProvenance` gate, re-bound to the memory's host.
- **Sui Move** — a `sentinel_memory` module anchors each host's manifest pointer
  as an append-only `MemoryAnchored` event.
- **LLM** — pluggable analyst (Ollama local/cloud, or Claude) with structured
  JSON output; the choice is orthogonal to the verifiable-memory guarantees.

## Challenges
- Running a **browser-only** WASM MPC prover headlessly (COOP/COEP + a WS→TCP
  proxy) and re-using it as the recall verifier.
- Making "forged memory is rejected" actually *true*: an adversarial review found
  a proof-only design was forgeable (verdict-flip, tier-flip, host-swap) — we
  closed it with a pinned signature over the whole record + host-bound proof.
- Cross-runtime crypto: Node signs (Ed25519), the **browser verifies**
  (WebCrypto) — same canonical bytes, raw 64-byte sig, SPKI-DER key.

## Accomplishments
- A working end-to-end agent where memory is durable **and** unforgeable.
- In-browser, server-less verification of memory integrity.
- Security core covered by tests (`pnpm test`) proving tamper rejection.

## What we learned
- "Verifiable memory" needs to bind the agent's *decision*, not just the data —
  a content proof doesn't stop a flipped verdict.
- Keep the LLM swappable: the trust properties shouldn't depend on the model.

## What's next
- MemWal-backed memory + Seal-encrypted case files for private investigations.
- Multi-agent: a second agent trusts memory it didn't create by re-verifying the
  signature, not the peer (trust-minimized delegation).
- Host the inspector on Walrus Sites for a fully-on-Walrus deployment.

## Built with
Walrus · Sui Move · TLSNotary · Ollama / Claude · Playwright · React · WebCrypto
Ed25519 · (MemWal-ready · Seal-ready)

---

## Demo video storyboard (~3 min)

| t | Shot | Say |
|---|---|---|
| 0:00 | Title + one-liner | "Agent memory you can't forge — on Walrus." |
| 0:15 | `pnpm sentinel https://example.com/` running | "The agent captures the page from desktop + mobile, makes a TLSNotary proof, classifies it, and writes a **signed** case file to Walrus." Point at the proof + manifest blob ids. |
| 0:55 | Kill terminal, run it again | "New process — memory isn't in the process, it's on Walrus. It **recalls** the proof-backed case file by host and is recall-informed instantly." |
| 1:25 | Web app, SentinelMem panel | "Here's the host's memory timeline, and this **memory verified** badge is checked **in your browser** with WebCrypto — not our server." Click **Re-verify**. |
| 1:55 | `pnpm sentinel:tamper example.com` | "Now forge the stored memory — flip the verdict without re-signing." |
| 2:10 | Reload UI / re-run sentinel | "The signature no longer matches → **TAMPERED** / **rejected** before the agent can act. The decision, not just the data, is integrity-protected." |
| 2:35 | (Optional) cloaking | "Point it at a site that cloaks by device — two render clusters → the agent flags cloaking, and every clustered hash came from a verified capture." |
| 2:50 | Close | "Durable, portable, and verifiable agent memory — that's Walrus as a verifiable data platform for AI." |

> Use a TLS 1.2 target for the PROVEN badge (example.com, or the project's
> `phishing_site/` worker). Pre-warm one investigation before recording so blobs
> are already on Walrus.
