# SentinelMem — testing / demo flow

A click-by-click walkthrough of the live local app.

## 0. Prerequisites (start these once)

```powershell
# Terminal A — web UI
pnpm dev                      # http://localhost:5173

# Terminal B — agent server (runs real investigations; env required)
$env:SENTINEL_LLM="ollama"
$env:OLLAMA_HOST="https://ollama.com"
$env:OLLAMA_KEY=(Get-Content .sentinel\ollama-key.txt -Raw).Trim()
$env:OLLAMA_MODEL="gpt-oss:120b-cloud"
$env:SENTINEL_PROVE_ATTEMPTS="1"
$env:SENTINEL_PROOF_TIMEOUT_MS="60000"
pnpm sentinel:serve           # http://localhost:8787
```

You also need a **Sui testnet wallet** (Sui Wallet / Slush) set to **testnet**.
For the on-chain anchor step it needs some testnet SUI (faucet.sui.io).

---

## 1. Landing → connect → enter
1. Open `http://localhost:5173/`.
2. Watch the hero tabs auto-cycle every 4s (**Recall → Prove → Analyze → Remember**) — the video overlay changes per tab.
3. Click **Connect Wallet** → pick your wallet (testnet).
4. On connect you're **taken straight into the inspector** (memory is scoped to your wallet).

**Expected:** empty state — *"No memory for this wallet yet. Use the Investigate box…"*

## 2. Add memory — PROVEN (fast)
1. In the **Investigate** box type `https://example.com/` → **Investigate**.
2. Wait ~10–30s (TLSNotary + capture + LLM + Walrus).

**Expected:** a case file appears for `example.com`: 🔒 **PROVEN**, ✅ **memory verified**, a verdict (BENIGN) + confidence + rationale.

## 3. Verify it's real (not a mock)
- Click **record** / **screenshot** / **html** / **TLS proof** → opens the actual **Walrus** blobs (new tab).
- Click **Re-verify** → re-fetches from Walrus and re-checks the Ed25519 signature in your browser → stays **memory verified**.

## 4. Anchor on-chain (needs testnet SUI for gas)
- Click **Anchor on-chain** on the host → your wallet signs an `anchor_memory` tx.

**Expected:** button turns to **✓ anchored on-chain** with a **Suiscan** link to the real tx.

## 5. Add memory — UNVERIFIED (modern site)
1. Investigate a TLS 1.3 site (most modern sites, e.g. a `*.vercel.app`).
2. Wait ~60–90s.

**Expected:** added as **unverified** (TLSNotary alpha.12 is TLS 1.2-only) — still **memory verified** (signed + tamper-evident), often with a **cloaking** verdict if desktop/mobile render hashes differ.

## 6. Per-wallet isolation (the key property)
1. In the header, disconnect / switch to a **different** wallet.
2. **Expected:** a different (empty) silo — you do **not** see wallet A's investigations.
3. Switch back to wallet A → your entries return.

## 7. Back to landing
- Click the **SentinelMem** brand or **Home** (top-left) → returns to the landing page.

---

## Optional (ask me to seed first)
These two features exist in code but currently have no per-wallet demo data:
- **Decrypt Seal (🔒)** — a Seal-encrypted case file you decrypt in-browser if your wallet is whitelisted (else *access denied*).
- **Tamper demo** — forge a stored record; on reload it flips to red **TAMPERED** (signature no longer matches).

Ask and I'll seed a sealed entry under your wallet + wire the tamper helper to the per-owner format.

---

## Honest limits
- **TLS 1.2 only** for PROVEN; TLS 1.3 → UNVERIFIED (not faked).
- Investigations run on the **local agent server** — not on the static Walrus Site (that stays read-only).
- One investigation at a time (serialized); a second click shows *"already running"*.
