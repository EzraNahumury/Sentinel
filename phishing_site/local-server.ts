// Local cloaking target for the SentinelMem cloaking demo — no Cloudflare, no
// account. Serves DIFFERENT content by device (User-Agent), mirroring the
// Cloudflare worker's /cloak route, so the multi-vantage agent sees divergent
// render hashes and flags cloaking.
//
//   pnpm cloak:serve            # http://localhost:8799
// then (localhost is http → no TLS proof, so use no-proof mode):
//   SENTINEL_NO_PROOF=1 pnpm sentinel "http://localhost:8799/cloak"

import { createServer } from "node:http";

const PORT = Number(process.env.CLOAK_PORT ?? 8799);

function page(emoji: string, label: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${label}</title>
<style>body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f0f0f;color:#fff}
.e{font-size:8rem}.l{font-size:1.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.b{margin-top:1rem;color:#aaa;max-width:32rem;text-align:center}</style></head>
<body><div class="e">${emoji}</div><div class="l">${label}</div><div class="b">${body}</div></body></html>`;
}

const server = createServer((req, res) => {
  const ua = req.headers["user-agent"] ?? "";
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Phone|webOS|BlackBerry|IEMobile/i.test(ua);
  const url = req.url ?? "/";
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (url.startsWith("/cloak")) {
    // The cloak: benign-looking cat for desktop crawlers, a credential-phish
    // for mobile victims. Distinct content per device => distinct render hash.
    res.end(
      isMobile
        ? page(
            "\u{1F608}",
            "Account locked",
            "Your wallet is suspended. Enter your 12-word recovery phrase to restore access.",
          )
        : page("\u{1F431}", "Meow", "Just a friendly cat. Nothing to see here, crawler."),
    );
    return;
  }
  res.end(page("\u{1F30D}", isMobile ? "Mobile home" : "Desktop home", "Local cloaking demo target."));
});

server.listen(PORT, () => {
  console.log(`Cloaking target up → http://localhost:${PORT}/cloak (desktop=cat, mobile=phish)`);
});
