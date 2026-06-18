// SentinelMem provenance engine.
//
// Wraps the existing TLSNotary harness + the deterministic `checkProvenance`
// gate (the exact mechanism that gates scan payouts in verify-scans.ts) and
// repurposes it to gate what the agent is allowed to REMEMBER:
//   - proveUrl(url):  capture the page from multiple device vantages (for
//                     cloaking detection), produce a TLSNotary proof of the
//                     primary capture, and return PROVEN evidence (with a
//                     re-checkable content hash) or, if the target can't be
//                     proven (e.g. TLS 1.3), UNVERIFIED evidence.
//   - verifyStoredProof(blobId, host): re-run the full proof check on a recalled
//                     memory's proof so a tampered/forged memory is rejected.

import { chromium, devices, type Browser } from "playwright";
import { TlsnHarness, DEFAULT_NOTARY_URL } from "../tlsn/harness";
import { checkProvenance, notaryPemToKeyHex } from "../../src/lib/tlsnotary";
import {
  uploadToWalrus,
  walrusAggregatorUrl,
  DEFAULT_WALRUS_AGGREGATOR,
} from "../../src/lib/walrus";
import { normalizeHtmlForHash, sha256Hex } from "../../src/lib/vetting";
import type { ProvenanceTier } from "../../src/lib/memory";

export interface VantageHash {
  profile: string;
  contentHash: string;
}

export interface ProvenEvidence {
  tier: ProvenanceTier;
  reason: string;
  proofBlobId: string; // "" when UNVERIFIED
  screenshotBlobId: string;
  htmlBlobId: string;
  html: string; // rendered HTML of the primary vantage, for the analyst
  contentHash: string; // proven-transcript hash (PROVEN) or rendered-html hash (UNVERIFIED)
  renderHash: string; // hash of the rendered DOM — comparable across tiers/time
  provenServerName: string;
  httpStatus: number;
  // Cross-vantage cloaking signal: rendered-HTML hash per device profile.
  vantages: VantageHash[];
  cloakingClusters: number; // distinct rendered-content clusters across vantages
}

export interface SentinelProvenanceOptions {
  notaryUrl?: string;
  publisher?: string;
  aggregator?: string;
  epochs?: number;
  maxRecv?: number;
  proofTimeoutMs?: number;
  /** Device vantages to capture for cloaking detection (first = primary/proven). */
  vantages?: string[];
}

// Device profile -> Playwright device descriptor (null = plain desktop).
const VANTAGE_DEVICE: Record<string, string | null> = {
  desktop: null,
  iphone: "iPhone 15",
  android: "Pixel 7",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function vantageContextOptions(profile: string): any {
  const name = VANTAGE_DEVICE[profile];
  if (name && devices[name]) {
    const d = devices[name];
    return {
      userAgent: d.userAgent,
      viewport: d.viewport,
      deviceScaleFactor: d.deviceScaleFactor,
      isMobile: d.isMobile,
      hasTouch: d.hasTouch,
    };
  }
  return { viewport: { width: 1280, height: 800 } };
}

export class SentinelProvenance {
  private readonly notaryUrl: string;
  private readonly publisher?: string;
  private readonly aggregator: string;
  private readonly epochs: number;
  private readonly maxRecv: number;
  private readonly proofTimeoutMs: number;
  private readonly vantages: string[];
  private readonly harness: TlsnHarness;
  private browser?: Browser;
  private trustedKeyHex = "";
  private proofDisabled = false;

  constructor(opts: SentinelProvenanceOptions = {}) {
    this.notaryUrl = opts.notaryUrl ?? DEFAULT_NOTARY_URL;
    this.publisher = opts.publisher;
    this.aggregator = opts.aggregator ?? DEFAULT_WALRUS_AGGREGATOR;
    this.epochs = opts.epochs ?? 5;
    this.maxRecv = opts.maxRecv ?? 131072;
    this.proofTimeoutMs =
      opts.proofTimeoutMs ?? Number(process.env.SENTINEL_PROOF_TIMEOUT_MS ?? 240000);
    const vantages =
      opts.vantages ??
      (process.env.SENTINEL_VANTAGES ?? "desktop,iphone")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    this.vantages = vantages.length ? vantages : ["desktop"];
    this.harness = new TlsnHarness({ notaryUrl: this.notaryUrl });
  }

  /** The trusted notary key, re-derived from the notary's /info. */
  get notaryKeyHex(): string {
    return this.trustedKeyHex;
  }

  async start(): Promise<void> {
    const forceNoProof = /^(1|true|yes|on)$/i.test(
      process.env.SENTINEL_NO_PROOF ?? "",
    );
    if (forceNoProof) {
      this.proofDisabled = true;
      console.warn(
        "  SENTINEL_NO_PROOF set — running WITHOUT TLSNotary proofs (UNVERIFIED tier; memory signing + tamper-rejection still active).",
      );
    } else {
      try {
        this.trustedKeyHex = await this.fetchNotaryKey();
        await this.harness.start();
      } catch (err) {
        this.proofDisabled = true;
        console.warn(
          `  ${(err as Error).message}\n` +
            "  → continuing WITHOUT proofs (UNVERIFIED tier). The verifiable-memory layer\n" +
            "    (Ed25519 signing + recall + tamper-rejection) still works; only the\n" +
            "    TLSNotary PROVEN tier is unavailable. Set TLSN_NOTARY_URL to a reachable\n" +
            "    notary (or run a local one) for PROVEN evidence.",
        );
      }
    }
    this.browser = await chromium.launch({ headless: true });
  }

  // The hosted notary may be a sleeping free-tier instance whose cold-start
  // exceeds undici's 10s connect timeout. Retry with backoff so the repeated
  // attempts wake it, instead of crashing on the first miss.
  private async fetchNotaryKey(attempts = 6): Promise<string> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${this.notaryUrl}/info`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`notary /info ${res.status}`);
        const info = (await res.json()) as { publicKey: string };
        return notaryPemToKeyHex(info.publicKey);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          console.warn(
            `  notary not ready (try ${i + 1}/${attempts}: ${(err as Error).message}) — waking, retrying…`,
          );
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }
    throw new Error(
      `notary unreachable after ${attempts} tries: ${(lastErr as Error)?.message}`,
    );
  }

  async stop(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    await this.harness.stop();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async captureWith(
    url: string,
    ctxOpts: any,
  ): Promise<{ screenshot: Buffer; html: string }> {
    if (!this.browser) throw new Error("provenance engine not started");
    const context = await this.browser.newContext(ctxOpts);
    const page = await context.newPage();
    let html = "";
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page
        .waitForLoadState("networkidle", { timeout: 8000 })
        .catch(() => undefined);
      html = await page.content();
    } catch (err) {
      html = await page.content().catch(() => "");
      if (html.length < 200) {
        await page.setContent(
          `<html><body><h2>Scan of ${url}</h2><p>Navigation failed: ${(err as Error).message}</p></body></html>`,
        );
        html = await page.content();
      }
    }
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    await context.close();
    return { screenshot, html };
  }

  /** Capture every vantage + prove the primary, uploading evidence to Walrus. */
  async proveUrl(url: string): Promise<ProvenEvidence> {
    const profiles = this.vantages;
    const primaryProfile = profiles[0];

    // Capture each vantage's rendered HTML; the primary's screenshot/html is
    // stored and used as the proof reference. Divergent hashes => cloaking.
    let primary: { screenshot: Buffer; html: string } | null = null;
    const vantages: VantageHash[] = [];
    for (const profile of profiles) {
      let cap: { screenshot: Buffer; html: string };
      try {
        cap = await this.captureWith(url, vantageContextOptions(profile));
      } catch {
        continue; // a flaky vantage shouldn't abort the investigation
      }
      if (profile === primaryProfile && !primary) primary = cap;
      vantages.push({
        profile,
        contentHash: await sha256Hex(normalizeHtmlForHash(cap.html)),
      });
    }
    if (!primary) {
      // Fall back to a plain desktop capture if the primary vantage failed.
      primary = await this.captureWith(url, vantageContextOptions("desktop"));
    }
    const cloakingClusters = new Set(vantages.map((v) => v.contentHash)).size || 1;

    const { screenshot, html } = primary;
    // Always-comparable rendered-DOM hash of the primary vantage (tier-independent).
    const renderHash = await sha256Hex(normalizeHtmlForHash(html));
    const screenshotBlobId = await uploadToWalrus(screenshot, {
      publisher: this.publisher,
      contentType: "image/png",
      epochs: this.epochs,
    });
    const htmlBlobId = await uploadToWalrus(html, {
      publisher: this.publisher,
      contentType: "text/html",
      epochs: this.epochs,
    });

    let tier: ProvenanceTier = "UNVERIFIED";
    let reason = "";
    let proofBlobId = "";
    let contentHash = "";
    let provenServerName = "";
    let httpStatus = 0;

    // Retry the MPC proof a few times: a cold/throttled notary often drops the
    // first WebSocket (CloseEvent 1006) but holds once warm. A genuine proof
    // rejection is deterministic, so we stop retrying on that.
    const proveAttempts = this.proofDisabled
      ? 0
      : Number(process.env.SENTINEL_PROVE_ATTEMPTS ?? 3);
    if (this.proofDisabled) reason = "notary unavailable — no-proof mode";
    for (let attempt = 1; attempt <= proveAttempts; attempt++) {
      try {
        const { presentationJSON } = await this.harness.prove(
          url,
          this.maxRecv,
          this.proofTimeoutMs,
        );
        const verified = await this.harness.verify(presentationJSON);
        const expectedHost = new URL(url).hostname;
        const prov = await checkProvenance(verified, {
          expectedHost,
          trustedNotaryKeyHex: this.trustedKeyHex,
        });
        if (prov.status === "PROVEN") {
          proofBlobId = await uploadToWalrus(JSON.stringify(presentationJSON), {
            publisher: this.publisher,
            contentType: "application/json",
            epochs: this.epochs,
          });
          tier = "PROVEN";
          reason = prov.reason;
          contentHash = prov.htmlContentHash ?? "";
          provenServerName = prov.serverName ?? "";
          httpStatus = prov.statusCode ?? 0;
        } else {
          reason = `proof rejected: ${prov.reason}`;
        }
        break; // got a definitive answer (proven or cleanly rejected)
      } catch (err) {
        reason = `proving unavailable (TLS 1.3 target or notary unstable): ${(err as Error).message}`;
        if (attempt < proveAttempts) {
          console.warn(`  proof attempt ${attempt}/${proveAttempts} failed — retrying…`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    if (tier === "UNVERIFIED") {
      contentHash = await sha256Hex(normalizeHtmlForHash(html));
    }

    return {
      tier,
      reason,
      proofBlobId,
      screenshotBlobId,
      htmlBlobId,
      html,
      contentHash,
      renderHash,
      provenServerName,
      httpStatus,
      vantages,
      cloakingClusters,
    };
  }

  /**
   * Re-verify a recalled memory's stored proof. Returns ok=true only if the
   * notary signature, proven host, and HTTP status all check out; the freshly
   * derived content hash is returned so the caller can compare it against the
   * hash recorded in the memory entry (mismatch => the record was tampered).
   */
  async verifyStoredProof(
    proofBlobId: string,
    expectedHost: string,
  ): Promise<{ ok: boolean; reason: string; contentHash?: string }> {
    if (this.proofDisabled)
      return { ok: false, reason: "notary unavailable — cannot re-verify proof" };
    if (!proofBlobId) return { ok: false, reason: "no proof blob on entry" };
    let presentationJSON: unknown;
    try {
      const res = await fetch(walrusAggregatorUrl(proofBlobId, this.aggregator), {
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) throw new Error(`Walrus fetch ${res.status}`);
      presentationJSON = await res.json();
    } catch (err) {
      return { ok: false, reason: `proof fetch failed: ${(err as Error).message}` };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const verified = await this.harness.verify(presentationJSON as any);
      const prov = await checkProvenance(verified, {
        expectedHost,
        trustedNotaryKeyHex: this.trustedKeyHex,
      });
      return {
        ok: prov.status === "PROVEN",
        reason: prov.reason,
        contentHash: prov.htmlContentHash,
      };
    } catch (err) {
      return { ok: false, reason: `re-verification error: ${(err as Error).message}` };
    }
  }
}
