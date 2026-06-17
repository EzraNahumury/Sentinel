// SentinelMem analyst agent — pluggable LLM backend.
//
// Given the cryptographically PROVEN evidence for a URL plus the agent's recalled
// (and re-verified) memory, emit a structured verdict. The agent's reasoning is
// advisory; the trustworthy part is the TLSNotary proof + the agent's signature
// over the record. The LLM is therefore swappable without affecting the
// verifiable-memory guarantees.
//
// Provider is chosen by SENTINEL_LLM (default: "anthropic" if ANTHROPIC_API_KEY
// is set, else "ollama" — a local model, no API key, no @anthropic-ai/sdk).
//   - ollama:    POST {OLLAMA_HOST}/api/chat with `format` = the JSON schema
//                (Ollama structured outputs). SENTINEL_MODEL default "llama3.1".
//   - anthropic: client.messages.create with output_config.format json_schema +
//                adaptive thinking. SENTINEL_MODEL default "claude-opus-4-8".
// The Anthropic SDK is imported lazily, so Ollama users don't need it installed.

import type { CaseFileEntry, Verdict } from "../../src/lib/memory";

export const LLM_PROVIDER = (
  process.env.SENTINEL_LLM ??
  (process.env.ANTHROPIC_API_KEY ? "anthropic" : "ollama")
).toLowerCase();

export const ANALYST_MODEL =
  LLM_PROVIDER === "ollama"
    ? (process.env.OLLAMA_MODEL ?? process.env.SENTINEL_MODEL ?? "llama3.1")
    : (process.env.SENTINEL_MODEL ?? "claude-opus-4-8");

// OLLAMA_HOST works for both local (http://localhost:11434) and Ollama Cloud
// (https://ollama.com). Cloud requires an API key (OLLAMA_KEY) sent as Bearer.
const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(
  /\/+$/,
  "",
);
const OLLAMA_KEY = process.env.OLLAMA_KEY ?? process.env.OLLAMA_API_KEY;
// gpt-oss is a reasoning model; set OLLAMA_THINK=low|medium|high. (Booleans are
// ignored for gpt-oss; other models like qwen3 accept true/false.)
const OLLAMA_THINK = process.env.OLLAMA_THINK;
const LLM_TIMEOUT_MS = Number(process.env.SENTINEL_LLM_TIMEOUT_MS ?? 120000);

export interface AnalystVerdict {
  verdict: Verdict;
  confidence: number;
  rationale: string;
  recall_used: boolean;
}

export interface AnalystInput {
  host: string;
  url: string;
  tier: "PROVEN" | "UNVERIFIED";
  provenanceReason: string;
  contentHash: string;
  renderHash?: string;
  httpStatus: number;
  htmlExcerpt: string;
  priorCaseFiles: CaseFileEntry[]; // already re-verified by the agent
  // Cross-vantage capture: rendered-HTML hash per device profile. >1 distinct
  // cluster means different devices saw different pages (UA/geo cloaking).
  vantages?: Array<{ profile: string; contentHash: string }>;
  cloakingClusters?: number;
}

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "rationale", "recall_used"],
  properties: {
    verdict: {
      type: "string",
      enum: ["phishing", "cloaking", "suspicious", "benign", "unknown"],
    },
    confidence: { type: "number", description: "0.0 (low) to 1.0 (high)" },
    rationale: {
      type: "string",
      description:
        "2-4 sentences citing the concrete evidence and any prior memory used.",
    },
    recall_used: {
      type: "boolean",
      description: "true if prior verified memory materially influenced the verdict",
    },
  },
} as const;

// Ollama (incl. Cloud) honors a plain schema but drops fields when
// `additionalProperties: false` is present, so the ollama backend uses this
// relaxed copy. (Anthropic structured outputs REQUIRE additionalProperties:false.)
const OLLAMA_FORMAT = {
  type: "object",
  required: ["verdict", "confidence", "rationale", "recall_used"],
  properties: {
    verdict: {
      type: "string",
      enum: ["phishing", "cloaking", "suspicious", "benign", "unknown"],
    },
    confidence: { type: "number" },
    rationale: { type: "string" },
    recall_used: { type: "boolean" },
  },
};

const SYSTEM = `You are SentinelMem, an autonomous web-security analyst.

You investigate a single URL using cryptographically verified evidence and your
own persistent memory of previously investigated hosts. Each prior memory entry
you are shown has ALREADY been re-verified against its TLSNotary proof — you may
treat its facts (proven host, content hash, prior verdict) as trustworthy.

Classify the target:
- phishing: impersonates a brand/login to steal credentials or funds.
- cloaking: shows different content to different visitors (compare content
  hashes across this and prior memory entries for the same host).
- suspicious: notable risk signals but not conclusive.
- benign: no meaningful risk signals.
- unknown: insufficient evidence to decide.

Rules:
- Ground every claim in the provided evidence or a cited prior memory entry.
- Compare RENDER HASHES (not the proof content hash) across time and across
  vantages: if a prior memory entry recorded a different render hash for this
  host, the content changed; differing hashes across vantages = cloaking. Only
  compare render hashes to each other — never a render hash to a proof hash.
- Report verifiable EVIDENCE and your reasoning. Do not claim a "provably correct"
  verdict — the proof attests provenance (the host really served this content),
  not maliciousness.
- For UNVERIFIED evidence (no proof), lower your confidence and note the gap.

Output ONLY a single JSON object with EXACTLY these four keys (no other keys, no
markdown, no prose before or after):
{"verdict": "benign", "confidence": 0.9, "rationale": "<2-4 sentences>", "recall_used": false}
  - verdict: one of phishing | cloaking | suspicious | benign | unknown
  - confidence: a number from 0.0 to 1.0
  - rationale: your reasoning, citing the concrete evidence
  - recall_used: true if prior verified memory influenced the verdict, else false
Do NOT use keys like "reasoning", "evidence", or "explanation".`;

function buildPrompt(input: AnalystInput): string {
  const memory = input.priorCaseFiles.length
    ? input.priorCaseFiles
        .map(
          (e, i) =>
            `  [${i + 1}] observedAt=${e.observedAt} tier=${e.tier} verdict=${e.verdict} ` +
            `confidence=${e.confidence} renderHash=${e.renderHash || "(none)"}\n` +
            `      rationale: ${e.rationale}`,
        )
        .join("\n")
    : "  (no prior verified memory for this host)";

  const vantageLines =
    input.vantages && input.vantages.length
      ? input.vantages
          .map((v) => `  ${v.profile}: ${v.contentHash}`)
          .join("\n") +
        `\n  → ${input.cloakingClusters ?? 1} distinct content cluster(s) across vantages` +
        ((input.cloakingClusters ?? 1) > 1
          ? " — STRONG CLOAKING SIGNAL (devices saw different pages)."
          : ".")
      : "  (single vantage)";

  return [
    `TARGET URL: ${input.url}`,
    `HOST: ${input.host}`,
    `EVIDENCE TIER: ${input.tier}`,
    `PROVENANCE: ${input.provenanceReason}`,
    `HTTP STATUS: ${input.httpStatus || "unknown"}`,
    `RENDER HASH (this investigation, comparable across time/vantages): ${input.renderHash || "(none)"}`,
    `PROOF CONTENT HASH (${input.tier === "PROVEN" ? "TLS transcript, do NOT compare to render hashes" : "n/a"}): ${input.contentHash || "(none)"}`,
    ``,
    `CROSS-VANTAGE RENDER HASHES:`,
    vantageLines,
    ``,
    `RENDERED HTML (primary vantage, truncated):`,
    "```html",
    input.htmlExcerpt,
    "```",
    ``,
    `PRIOR VERIFIED MEMORY FOR ${input.host}:`,
    memory,
    ``,
    `Return your verdict as JSON.`,
  ].join("\n");
}

function fallback(reason: string, input: AnalystInput): AnalystVerdict {
  return {
    verdict: "unknown",
    confidence: 0,
    rationale: reason,
    recall_used: input.priorCaseFiles.length > 0,
  };
}

// Ollama Cloud silently IGNORES the `format` JSON-schema (returns prose), and
// reasoning models may wrap the JSON in fences/preamble. Extract the JSON object
// defensively so the same code works on cloud + local + Claude.
function extractJson(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : t).trim();
  if (body.startsWith("{")) return body;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  return first !== -1 && last > first ? body.slice(first, last + 1) : body;
}

function parseVerdict(text: string, input: AnalystInput): AnalystVerdict {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(extractJson(text)) as any;
    // Normalize defensively: models (esp. cloud, schema-relaxed) may omit a
    // field or return the wrong type. Schemas can't enforce numeric ranges.
    const verdicts = ["phishing", "cloaking", "suspicious", "benign", "unknown"];
    // Models sometimes drift to alternate keys (reasoning/evidence/explanation);
    // map them so a good answer with off-schema keys isn't lost.
    const altRationale =
      parsed.rationale ??
      parsed.reasoning ??
      parsed.explanation ??
      (Array.isArray(parsed.evidence) ? parsed.evidence.join(" ") : parsed.evidence);
    return {
      verdict: verdicts.includes(parsed.verdict) ? parsed.verdict : "unknown",
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      rationale:
        typeof altRationale === "string" && altRationale.trim()
          ? altRationale
          : "(model returned no rationale)",
      recall_used: Boolean(parsed.recall_used),
    };
  } catch {
    return fallback(`unparseable LLM output: ${text.slice(0, 200)}`, input);
  }
}

// --- Ollama (local, no key) -------------------------------------------------
async function analyzeOllama(input: AnalystInput): Promise<AnalystVerdict> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OLLAMA_KEY ? { Authorization: `Bearer ${OLLAMA_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: ANALYST_MODEL,
        stream: false,
        // Relaxed schema (no additionalProperties:false) — honored by local AND
        // cloud Ollama; the strict VERDICT_SCHEMA makes cloud drop fields.
        format: OLLAMA_FORMAT,
        ...(OLLAMA_THINK ? { think: OLLAMA_THINK } : {}),
        options: { temperature: 0 },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    return fallback(
      `Ollama request to ${OLLAMA_HOST} failed (${(err as Error).message}). ` +
        `Local: run \`ollama serve\` + \`ollama pull ${ANALYST_MODEL}\`. ` +
        `Cloud (https://ollama.com): check OLLAMA_KEY.`,
      input,
    );
  }
  if (!res.ok) {
    return fallback(
      `Ollama error ${res.status}: ${await res.text().catch(() => "")}`,
      input,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const content: string = data?.message?.content ?? "";
  if (process.env.SENTINEL_DEBUG) {
    console.error(`[ollama] content(len=${content.length}): ${content.slice(0, 600)}`);
    if (data?.message?.thinking)
      console.error(`[ollama] thinking len=${String(data.message.thinking).length}`);
  }
  return parseVerdict(content, input);
}

// --- Anthropic (Claude) — SDK imported lazily -------------------------------
async function analyzeAnthropic(input: AnalystInput): Promise<AnalystVerdict> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AnthropicCtor: any;
  try {
    AnthropicCtor = (await import("@anthropic-ai/sdk")).default;
  } catch {
    throw new Error(
      "SENTINEL_LLM=anthropic requires @anthropic-ai/sdk. Run `pnpm add @anthropic-ai/sdk`, " +
        "or use a local model with SENTINEL_LLM=ollama (no SDK, no key).",
    );
  }
  const client = new AnthropicCtor(); // reads ANTHROPIC_API_KEY
  const response = await client.messages.create({
    model: ANALYST_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: VERDICT_SCHEMA },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(input) }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (response.stop_reason === "refusal") {
    return fallback("Analyst declined to classify (safety refusal).", input);
  }
  if (response.stop_reason === "max_tokens") {
    return fallback("Analyst output truncated (max_tokens) — raise the cap.", input);
  }
  const text = response.content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.type === "text")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text as string)
    .join("");
  return parseVerdict(text, input);
}

export async function analyze(input: AnalystInput): Promise<AnalystVerdict> {
  return LLM_PROVIDER === "ollama"
    ? analyzeOllama(input)
    : analyzeAnthropic(input);
}
