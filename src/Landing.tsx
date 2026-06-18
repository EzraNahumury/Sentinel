// SentinelMem landing hero (Stellar.ai-style layout, content adapted to our
// project). The four tabs map to the agent loop: Recall → Prove → Analyze →
// Remember. "Open the inspector" enters the app (App.tsx toggles the view).
import { useEffect, useState, type ReactNode } from "react";
import {
  Brain,
  ChevronDown,
  Star,
  History,
  ShieldCheck,
  Database,
  Check,
  Lock,
} from "lucide-react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_165750_358b1e72-c921-48b7-aaac-f200994f32fb.mp4";
const REPO_URL = "https://github.com/EzraNahumury/Sentinel";

const TABS = [
  { id: "recall", label: "Recall", icon: History },
  { id: "prove", label: "Prove", icon: ShieldCheck },
  { id: "analyze", label: "Analyze", icon: Brain },
  { id: "remember", label: "Remember", icon: Database },
] as const;
type TabId = (typeof TABS)[number]["id"];

const NAV_LINKS: ReadonlyArray<{ label: string; chevron?: boolean; href?: string }> = [
  { label: "How it works", chevron: true },
  { label: "Capabilities", chevron: true },
  { label: "Walrus", href: "https://walrus.xyz" },
  { label: "GitHub", href: REPO_URL },
];

const STACK = ["WALRUS", "SUI", "SEAL", "MemWal", "TLSNotary", "Ollama"];

export function Landing({ onEnter }: { onEnter: () => void }) {
  const [tab, setTab] = useState<TabId>("recall");

  useEffect(() => {
    const ids = TABS.map((t) => t.id);
    const iv = setInterval(() => {
      setTab((prev) => ids[(ids.indexOf(prev) + 1) % ids.length]);
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div
      className="min-h-screen bg-white text-black"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* NAV */}
      <nav
        className="px-6 py-4 flex items-center justify-between max-w-7xl mx-auto animate-fade-in-up"
        style={{ opacity: 0, animationDelay: "0.1s" }}
      >
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 fill-black" />
          <span className="text-lg font-semibold">SentinelMem</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href ?? "#"}
              target={l.href ? "_blank" : undefined}
              rel={l.href ? "noreferrer" : undefined}
              className="flex items-center gap-1 text-sm text-gray-700 hover:text-black transition-colors"
            >
              {l.label}
              {l.chevron && <ChevronDown className="w-4 h-4" />}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-gray-700 hover:text-black transition-colors"
          >
            Docs
          </a>
          <button
            onClick={onEnter}
            className="bg-black text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Open inspector
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="px-6 pt-24 pb-32 max-w-7xl mx-auto text-center">
        <div
          className="inline-flex items-center gap-2 mb-8 animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.2s" }}
        >
          <span className="w-6 h-6 border border-gray-300 rounded flex items-center justify-center">
            <Star className="w-3.5 h-3.5 fill-black" />
          </span>
          <span className="text-sm font-medium text-black">
            Verifiable agent memory · live on Sui testnet
          </span>
        </div>

        <h1
          className="text-6xl md:text-7xl lg:text-[80px] font-normal leading-[1.1] tracking-tight mb-5 animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.3s" }}
        >
          Remember Everything.
          <br />
          <span className="bg-gradient-to-r from-black via-gray-500 to-gray-400 bg-clip-text text-transparent">
            Prove It On Walrus.
          </span>
        </h1>

        <p
          className="text-lg md:text-xl text-gray-600 mb-8 max-w-2xl mx-auto animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.4s" }}
        >
          Append-only memory for AI agents on Walrus — Ed25519-signed,
          TLSNotary-backed, and re-verifiable by anyone. Tampering is detected,
          not trusted.
        </p>

        <button
          onClick={onEnter}
          className="bg-black text-white px-8 py-3 rounded-full text-base font-medium hover:bg-gray-800 transition-colors mb-12 animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.5s" }}
        >
          Open the inspector
        </button>

        {/* TAB BAR */}
        <div
          className="flex justify-center mb-10 animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.6s" }}
        >
          <div className="bg-gray-100 rounded-lg p-1">
            {/* mobile */}
            <div className="grid grid-cols-2 gap-1 md:hidden">
              {TABS.map((t) => (
                <TabButton key={t.id} t={t} active={tab === t.id} onClick={() => setTab(t.id)} />
              ))}
            </div>
            {/* desktop */}
            <div className="hidden md:flex items-center">
              {TABS.map((t, i) => (
                <div key={t.id} className="flex items-center">
                  {i > 0 && <div className="w-px h-5 bg-gray-300" />}
                  <TabButton t={t} active={tab === t.id} onClick={() => setTab(t.id)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* VIDEO + OVERLAY */}
        <div
          className="relative rounded-3xl overflow-hidden h-[400px] md:h-[500px] animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.7s" }}
        >
          <video
            src={VIDEO_URL}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          <Overlay tab={tab} onEnter={onEnter} />
        </div>

        {/* STACK LOGOS */}
        <div
          className="mt-24 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 animate-fade-in-up"
          style={{ opacity: 0, animationDelay: "0.8s" }}
        >
          {STACK.map((name) => (
            <span
              key={name}
              className="text-sm font-semibold tracking-wide text-gray-400"
            >
              {name}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function TabButton({
  t,
  active,
  onClick,
}: {
  t: (typeof TABS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = t.icon;
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        active ? "bg-white text-black shadow-sm" : "text-gray-600"
      }`}
    >
      <Icon className="w-4 h-4" />
      {t.label}
    </button>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black/15 animate-fade-in-overlay">
      <div className="absolute top-1/2 left-1/2 w-[90%] max-w-md animate-slide-up-overlay">
        <div className="rounded-2xl bg-white p-6 text-left shadow-2xl">{children}</div>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-gray-100">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Step({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border border-gray-300 text-gray-400"
        }`}
      >
        {done && <Check className="h-3 w-3" />}
      </span>
      <span className={done ? "text-gray-900" : "text-gray-400"}>{label}</span>
    </div>
  );
}

function Overlay({ tab, onEnter }: { tab: TabId; onEnter: () => void }) {
  if (tab === "recall") {
    return (
      <Card key="recall">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <History className="h-4 w-4 text-violet-600" /> Recall & re-verify
        </div>
        <p className="mb-3 text-xs text-gray-500">Loading this host's prior memory from Walrus</p>
        <Bar pct={100} color="bg-violet-500" />
        <div className="mt-4 space-y-2">
          <Step label="Resolve anchor → manifest" done />
          <Step label="Fetch case files from Walrus" done />
          <Step label="Verify Ed25519 signatures" done />
          <Step label="Re-check TLSNotary proofs" done />
        </div>
        <p className="mt-3 text-xs text-emerald-600">3 prior entries verified · 0 rejected</p>
      </Card>
    );
  }
  if (tab === "prove") {
    return (
      <Card key="prove">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ShieldCheck className="h-4 w-4 text-orange-500" /> TLSNotary proof
        </div>
        <p className="mb-3 text-xs text-gray-500">Proving the host actually served this content</p>
        <Bar pct={67} color="bg-orange-500" />
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <Metric k="TLS handshake" v="OK" />
          <Metric k="Transcript" v="captured" />
          <Metric k="Notary signature" v="verifying…" />
          <Metric k="Content hash" v="0xee9e…5438" />
        </div>
      </Card>
    );
  }
  if (tab === "analyze") {
    return (
      <Card key="analyze">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Brain className="h-4 w-4 text-emerald-600" /> Analyst verdict
        </div>
        <p className="mb-3 text-xs text-gray-500">LLM over proven evidence + recalled memory</p>
        <div className="flex items-center gap-2">
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600">
            BENIGN
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-600">
            <Lock className="h-3 w-3" /> PROVEN
          </span>
          <span className="text-xs text-gray-500">98% confidence · recall-informed</span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-600">
          TLS-notarized fetch returned HTTP 200; identical render hashes across
          desktop and iPhone — no cloaking, no credential forms.
        </p>
      </Card>
    );
  }
  return (
    <Card key="remember">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Database className="h-4 w-4 text-blue-600" /> Commit to Walrus
      </div>
      <p className="mb-3 text-xs text-gray-500">Sign, store, and chain the new case file</p>
      <div className="space-y-2">
        <Step label="Sign record (Ed25519)" done />
        <Step label="Upload case file → Walrus blob" done />
        <Step label="Append manifest (audit chain)" done />
        <Step label="Move anchor → latest" done />
      </div>
      <button
        onClick={onEnter}
        className="mt-4 w-full rounded-lg bg-black py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
      >
        Anchor on-chain
      </button>
    </Card>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{k}</div>
      <div className="font-mono text-gray-900">{v}</div>
    </div>
  );
}
