/**
 * toolCallSpike.ts - Phase 135 S6 live harness (OPERATOR-RUN; NOT PART OF THE EXPRESS APP).
 *
 * QUESTION: does the production OpenAI-compatible adapter + the real tool JSON schemas + the gateway
 * shape/allow-list/live-schema stages produce valid tool calls on a real model (Gemini AI Studio, optionally a
 * local Ollama model)? Which AI_TOOL_MODE (native | json) should be the documented default per model?
 *
 * USAGE (run it in YOUR OWN terminal; the key is read from the environment only and is never printed):
 *   cd packages/server
 *   read -s AI_API_KEY && export AI_API_KEY          # type the key, press Enter; nothing is echoed
 *   AI_ENABLED=true AI_PROVIDER=openai-compatible \
 *   AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
 *   AI_MODEL=<current Flash model id from AI Studio> \
 *     npx tsx src/spikes/toolCallSpike.ts --runs 5 --rpm 6 --out ./s6-gemini.json --record ./s6-gemini-wire
 *
 *   # Ollama (CPU-only is slow; raise the timeout and use a small tool-capable model):
 *   AI_ENABLED=true AI_PROVIDER=openai-compatible AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen3:8b \
 *   AI_TIMEOUT_MS=600000 npx tsx src/spikes/toolCallSpike.ts --runs 3 --rpm 30 --out ./s6-ollama.json [--mode json]
 *
 * FLAGS:
 *   --runs N            repetitions of each of the 7 scenarios (default 3)
 *   --rpm N             self-pace to at most N provider calls per minute (default 6)
 *   --out <file>        also write the JSON metrics to this file
 *   --record <dir>      write SANITISED wire captures (credential headers dropped, key string redacted)
 *   --mode native|json  tool mode (default: AI_TOOL_MODE or native); json wraps the adapter with the json-action decorator
 *   --stream true|false streaming vs non-streaming adapter (default true)
 *   --raw               additionally do ONE minimal bypass-adapter POST to separate adapter bugs from provider behaviour
 *   --burst N           OFF by default: fire N un-paced calls to provoke and capture a 429 (burns quota)
 *
 * SAFETY: prompts are synthetic and use only the inline demo.nyctaxi-style schema below (no real data - the Gemini
 * free tier may train on prompts). Only the endpoint origin, model and "key set / not set" are ever printed.
 * 429s are honoured (Retry-After / retryDelay), counted and reported - never hidden. Imports nothing from db/env/index/Express.
 *
 * SCORING: trials that end in a transport/quota/request error (429, 5xx, timeout/abort, network, 400/401/403) never
 * reached the model and are EXCLUDED from the quality figures (reported as excludedTrials); the >= 20-trial rule counts
 * clean trials only (fewer -> "inconclusive (N clean trials)"; all request errors -> INVALID RUN).
 * EARLY STOP: the run ends (partial output still written) after 3 consecutive 400s, or on a 429 that signals an
 * exhausted DAILY quota (quota id contains "PerDay" or retry delay > 1 h; Gemini free tier is ~20 requests/day/model).
 * AI_MODEL must be the model ID (e.g. gemini-3-flash-preview), not a product/display name. Gemini 3 "thinking"
 * models can exceed the 60 s default on a cold first call - use AI_TIMEOUT_MS=120000 or more.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAiConfig } from "../lib/aiConfig";
import { createOpenAiCompatProvider } from "../lib/ai/providers/openaiCompat";
import { createJsonActionProvider } from "../lib/ai/providers/jsonAction";
import type { LlmProvider, LlmToolCall } from "../lib/ai/provider";
import { buildToolRegistry, type ToolRegistry } from "../lib/ai/tools/registry";
import { AI_SYSTEM_RULES } from "../lib/ai/context";
import { buildOutboundRequest, part, type OutboundMessage } from "../lib/ai/outbound";
import { checkAiOp, type GatewayDeps } from "../lib/ai/gateway";
import { createShadow } from "../lib/ai/shadow";
import type { DashboardView, LiveSchemaPort, LiveTableInfo, ToolContext } from "../lib/ai/tools/types";
import {
  aggregateSpikeRuns,
  createEarlyStopGuard,
  createPacer,
  formatMatrixRow,
  INVALID_RUN_VERDICT,
  MATRIX_HEADER,
  parse429Body,
  sanitizeRecording,
  verdictFor,
  type SpikeCall,
  type SpikeRun,
} from "./toolCallSpikeMetrics";

// ---------- synthetic demo schema (no real data) ----------
const DEMO_TABLES: LiveTableInfo[] = [
  {
    id: 1, schema: "demo", name: "nyctaxi", description: "Synthetic taxi trips",
    columns: [
      { name: "vendor_id", type: "VARCHAR" }, { name: "pickup_datetime", type: "TIMESTAMP" },
      { name: "trip_distance", type: "DOUBLE" }, { name: "fare_amount", type: "DOUBLE" },
      { name: "passenger_count", type: "INT" }, { name: "pickup_longitude", type: "DOUBLE" }, { name: "pickup_latitude", type: "DOUBLE" },
    ],
  },
  { id: 2, schema: "demo", name: "nyc_zones", columns: [{ name: "zone_id", type: "INT" }, { name: "zone_name", type: "VARCHAR" }, { name: "borough", type: "VARCHAR" }] },
];
const DEMO_VIEW: DashboardView = { dashboardId: 1, title: "Demo", widgets: [], layers: [], dynamicViews: [], filters: [] };
const liveSchema: LiveSchemaPort = {
  async describe(id) {
    const t = DEMO_TABLES.find((x) => x.id === id);
    return t ? { ok: true, table: t } : { ok: false };
  },
};
const toolCtx: ToolContext = {
  username: "spike", dashboardId: 1, dataAccess: "schema",
  dashboardView: () => DEMO_VIEW,
  dashboardTableIds: () => [1],
  registeredTables: () => DEMO_TABLES.map(({ id, schema, name, description }) => ({ id, schema, name, ...(description ? { description } : {}) })),
  liveSchema,
};
const TABLES_TEXT = `Tables on this dashboard:\n${DEMO_TABLES.slice(0, 1).map((t) => `${t.schema}.${t.name} (id ${t.id}): ${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}`).join("\n")}`;

// ---------- args ----------
export type SpikeArgs = { runs: number; rpm: number; out?: string; record?: string; mode?: "native" | "json"; stream: boolean; raw: boolean; burst: number };
export function parseSpikeArgs(argv: string[]): SpikeArgs | { error: string } {
  const a: SpikeArgs = { runs: 3, rpm: 6, stream: true, raw: false, burst: 0 };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const next = () => argv[++i];
    const num = (v: string | undefined, min: number): number | null => (v !== undefined && /^\d+$/.test(v) && Number(v) >= min ? Number(v) : null);
    if (f === "--runs") { const n = num(next(), 1); if (n === null) return { error: "--runs needs an integer >= 1" }; a.runs = n; }
    else if (f === "--rpm") { const n = num(next(), 1); if (n === null) return { error: "--rpm needs an integer >= 1" }; a.rpm = n; }
    else if (f === "--burst") { const n = num(next(), 0); if (n === null) return { error: "--burst needs an integer >= 0" }; a.burst = n; }
    else if (f === "--out") { const v = next(); if (!v) return { error: "--out needs a file" }; a.out = v; }
    else if (f === "--record") { const v = next(); if (!v) return { error: "--record needs a directory" }; a.record = v; }
    else if (f === "--mode") { const v = next(); if (v !== "native" && v !== "json") return { error: "--mode must be native or json" }; a.mode = v; }
    else if (f === "--stream") { const v = next(); if (v !== "true" && v !== "false") return { error: "--stream must be true or false" }; a.stream = v === "true"; }
    else if (f === "--raw") a.raw = true;
    else return { error: `unknown flag ${f}` };
  }
  return a;
}

// ---------- wire observation (tee of the adapter's fetch) ----------
type Wire = { index: boolean[]; id: boolean[]; extra: boolean; fragmented: boolean; retryAfterHeader: boolean; retryDelayMs?: number; quotaId?: string; badRequest?: string; usage: boolean; pending: Promise<void>[] };
const freshWire = (): Wire => ({ index: [], id: [], extra: false, fragmented: false, retryAfterHeader: false, usage: false, pending: [] });

function inspectBody(w: Wire, status: number, text: string): void {
  if (status === 429) {
    const q = parse429Body(text);
    if (q.retryDelayMs !== undefined) w.retryDelayMs = q.retryDelayMs;
    if (q.quotaId !== undefined) w.quotaId = q.quotaId;
    return;
  }
  if (status === 400) { w.badRequest = text.slice(0, 300); return; }
  if (status < 200 || status >= 300) return;
  const seen = (tcs: unknown, perIndexChunks?: Map<string, number>): void => {
    if (!Array.isArray(tcs)) return;
    for (const tc of tcs as Array<Record<string, any>>) {
      w.index.push(typeof tc?.index === "number");
      if (typeof tc?.id === "string") w.id.push(true); else if (perIndexChunks === undefined) w.id.push(false);
      if (tc?.extra_content !== undefined) w.extra = true;
      if (perIndexChunks && typeof tc?.function?.arguments === "string") {
        const k = String(tc.index ?? tc.id ?? "?");
        const n = (perIndexChunks.get(k) ?? 0) + 1;
        perIndexChunks.set(k, n);
        if (n > 1) w.fragmented = true;
      }
    }
  };
  if (text.trimStart().startsWith("data:") || text.includes("\ndata:")) {
    const chunks = new Map<string, number>();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (j?.usage) w.usage = true;
        seen(j?.choices?.[0]?.delta?.tool_calls, chunks);
      } catch { /* ignore non-JSON keepalives */ }
    }
  } else {
    try {
      const j = JSON.parse(text);
      if (j?.usage) w.usage = true;
      seen(j?.choices?.[0]?.message?.tool_calls);
    } catch { /* not JSON */ }
  }
}

// ---------- tool execution with the same code that ships ----------
type ExecOut = { call: SpikeCall; message: Extract<OutboundMessage, { role: "tool" }>; ok: boolean };
async function execTool(reg: ToolRegistry, gw: GatewayDeps, c: LlmToolCall): Promise<ExecOut> {
  const mkMsg = (text: string, isError: boolean): ExecOut["message"] => ({ role: "tool", toolCallId: c.id, name: c.name, parts: [part.schema(text)], ...(isError ? { isError } : {}) });
  const tool = reg.byName.get(c.name);
  let json: unknown;
  let jsonOk = true;
  try { json = JSON.parse(c.argsJson); } catch { jsonOk = false; }
  if (!tool) {
    return { call: { name: c.name, known: false, jsonOk, zodOk: false, gatewayOk: false }, message: mkMsg(`Unknown tool "${c.name}".`, true), ok: false };
  }
  const zodOk = jsonOk && tool.args.safeParse(json).success;
  if (tool.kind === "read") {
    if (!zodOk) return { call: { name: c.name, known: true, jsonOk, zodOk, gatewayOk: false }, message: mkMsg("Invalid arguments.", true), ok: false };
    const r = await tool.run(json, toolCtx);
    return { call: { name: c.name, known: true, jsonOk, zodOk, gatewayOk: true }, message: { role: "tool", toolCallId: c.id, name: c.name, parts: r.parts, ...(r.isError ? { isError: true } : {}) }, ok: !r.isError };
  }
  const g = await checkAiOp(gw, tool, c.argsJson);
  if (g.ok) return { call: { name: c.name, known: true, jsonOk, zodOk, gatewayOk: true }, message: mkMsg(`OK: ${g.label}`, false), ok: true };
  return { call: { name: c.name, known: true, jsonOk, zodOk, gatewayOk: false }, message: mkMsg(`Rejected at ${g.stage}: ${g.reasons.join("; ")}`, true), ok: false };
}

// ---------- scenarios ----------
type Scenario = { n: number; label: string; prompt: string; expect: string[] | "none"; maxSteps: number; stopOnAdd: boolean; roundTrip?: boolean };
const SCENARIOS: Scenario[] = [
  { n: 1, label: "list_tables", prompt: "Which tables are available to me?", expect: ["list_tables"], maxSteps: 1, stopOnAdd: false },
  { n: 2, label: "describe_table typed args", prompt: "Show me the columns of table 1.", expect: ["describe_table"], maxSteps: 1, stopOnAdd: false },
  { n: 3, label: "multi-step add bar chart", prompt: "Add a bar chart of trips by vendor.", expect: ["get_dashboard", "list_tables", "describe_table", "add_widget"], maxSteps: 6, stopOnAdd: true },
  { n: 4, label: "parallel invite", prompt: "Describe both tables (ids 1 and 2).", expect: ["describe_table"], maxSteps: 1, stopOnAdd: false },
  { n: 5, label: "no-tool question", prompt: "In one sentence, what is a bar chart good for? Do not change anything.", expect: "none", maxSteps: 1, stopOnAdd: false },
  { n: 6, label: "multi-turn tool round-trip", prompt: "List the tables.", expect: ["list_tables"], maxSteps: 2, stopOnAdd: false, roundTrip: true },
  { n: 7, label: "malformed pressure", prompt: "Add a bar widget titled \"Fare by vendor\" on table 1 with metricColumn fare_amount, groupByColumns [vendor_id], aggregation sum, and a nested layout of x 0, y 0, w 6, h 4.", expect: ["add_widget", "describe_table", "get_dashboard", "list_tables"], maxSteps: 3, stopOnAdd: true },
];

type Ctx = {
  provider: LlmProvider; reg: ToolRegistry; wire: () => Wire; resetWire: () => void;
  pacer: { wait(): Promise<void> }; sleep: (ms: number) => Promise<void>; timeoutMs: number; notes: Notes;
  guard: ReturnType<typeof createEarlyStopGuard>;
};
type Notes = { usagePresent: number; fragmentedStreams: number; schemaRejections: string[]; errorKinds: Record<string, number> };

type Step = { text: string; calls: { id: string; name: string; argsRaw: string; providerState?: unknown }[]; finish: string; assistantState?: unknown; error?: { kind: string; status?: number }; rateLimited: number; retryAfterHeader: boolean; retryDelayMs?: number; wire: Wire };

async function oneStep(ctx: Ctx, messages: OutboundMessage[], pace = true): Promise<Step> {
  const tools = [...ctx.reg.specs];
  const req = buildOutboundRequest({
    system: [part.system(`${AI_SYSTEM_RULES}\n- Use at most 8 tool calls per request.`), part.schema(TABLES_TEXT), part.config(JSON.stringify(DEMO_VIEW))],
    messages, tools, dataAccess: "schema",
  });
  let rateLimited = 0;
  let retryAfterHeader = false;
  let retryDelayMs: number | undefined;
  for (let attempt = 0; ; attempt++) {
    if (pace) await ctx.pacer.wait();
    ctx.resetWire();
    const out: Step = { text: "", calls: [], finish: "other", rateLimited, retryAfterHeader, wire: ctx.wire() };
    let assistantState: unknown;
    for await (const ev of ctx.provider.complete(req, AbortSignal.timeout(ctx.timeoutMs))) {
      if (ev.type === "text_delta") out.text += ev.text;
      else if (ev.type === "tool_call") out.calls.push({ id: ev.id, name: ev.name, argsRaw: ev.argsRaw, ...(ev.providerState !== undefined ? { providerState: ev.providerState } : {}) });
      else if (ev.type === "done") { out.finish = ev.finish; assistantState = ev.assistantState; }
      else if (ev.type === "error") out.error = { kind: ev.kind, ...(ev.status !== undefined ? { status: ev.status } : {}) };
      if (ev.type === "error" && ev.retryAfterMs !== undefined) retryDelayMs = Math.max(retryDelayMs ?? 0, ev.retryAfterMs);
    }
    await Promise.all(ctx.wire().pending);
    const w = ctx.wire();
    if (assistantState !== undefined) out.assistantState = assistantState;
    if (w.usage) ctx.notes.usagePresent++;
    if (w.fragmented) ctx.notes.fragmentedStreams++;
    if (w.badRequest && ctx.notes.schemaRejections.length < 5) ctx.notes.schemaRejections.push(w.badRequest);
    if (out.error) ctx.notes.errorKinds[out.error.kind] = (ctx.notes.errorKinds[out.error.kind] ?? 0) + 1;
    const stepDelay = w.retryDelayMs ?? retryDelayMs;
    const stop = ctx.guard.observe({
      ...(out.error ? { kind: out.error.kind } : {}),
      ...(out.error?.status !== undefined ? { status: out.error.status } : {}),
      ...(out.error?.kind === "rate_limited" && stepDelay !== undefined ? { retryDelayMs: stepDelay } : {}),
      ...(out.error?.kind === "rate_limited" && w.quotaId !== undefined ? { quotaId: w.quotaId } : {}),
    });
    if (out.error?.kind === "rate_limited") {
      rateLimited++;
      retryAfterHeader = retryAfterHeader || w.retryAfterHeader;
      if (w.retryDelayMs !== undefined) retryDelayMs = Math.max(retryDelayMs ?? 0, w.retryDelayMs);
      const wait = out.error && retryDelayMs !== undefined ? retryDelayMs : 15_000 * (attempt + 1);
      if (!stop && attempt < 3 && wait <= 180_000) {
        console.log(`[s6] 429 from provider (suggested delay ${Math.round(wait / 1000)}s) - waiting, then retrying`);
        await ctx.sleep(wait + 500);
        continue;
      }
    }
    out.rateLimited = rateLimited;
    out.retryAfterHeader = retryAfterHeader;
    if (retryDelayMs !== undefined) out.retryDelayMs = retryDelayMs;
    return out;
  }
}

async function runScenario(ctx: Ctx, s: Scenario): Promise<SpikeRun> {
  const t0 = Date.now();
  const gw: GatewayDeps = {
    username: "spike", dashboardId: 1,
    shadow: createShadow({ widgets: [], layers: [], dynamicViews: [], filters: [] }),
    liveSchema,
    getPermissions: () => new Set(["ai:use"]),
    canViewDashboard: () => true,
    dashboardTableIds: () => [1, 2],
  };
  const run: SpikeRun = { scenario: s.n, expect: s.expect, calls: [], text: "", finish: "other", latencyMs: 0, rateLimited: 0 };
  const messages: OutboundMessage[] = [{ role: "user", parts: [part.user(s.prompt)] }];
  const idx: boolean[] = [];
  const ids: boolean[] = [];
  let awaitingRepair = false;
  let stepsDone = 0;
  let lastStepUsable = false;
  for (let i = 0; i < s.maxSteps; i++) {
    const st = await oneStep(ctx, messages);
    stepsDone++;
    run.rateLimited += st.rateLimited;
    run.retryAfterHeader = run.retryAfterHeader || st.retryAfterHeader;
    if (st.retryDelayMs !== undefined) run.retryDelayMs = Math.max(run.retryDelayMs ?? 0, st.retryDelayMs);
    idx.push(...st.wire.index);
    ids.push(...st.wire.id);
    if (st.wire.extra) run.extraContentSeen = true;
    run.finish = st.finish;
    run.text += st.text;
    if (st.error) { run.error = st.error; break; }
    lastStepUsable = st.text !== "" || st.calls.length > 0;
    if (st.calls.length === 0) break;
    const toolCalls: LlmToolCall[] = st.calls.map((c) => ({ id: c.id, name: c.name, argsJson: c.argsRaw, ...(c.providerState !== undefined ? { providerState: c.providerState } : {}) }));
    const results: ExecOut[] = [];
    for (const c of toolCalls) results.push(await execTool(ctx.reg, gw, c));
    run.calls.push(...results.map((r) => r.call));
    const anyValid = results.some((r) => r.ok);
    const anyBad = results.some((r) => !r.ok);
    if (awaitingRepair && anyValid) { run.repairOk = true; awaitingRepair = false; }
    if (anyBad && !run.repairAttempted) { run.repairAttempted = true; awaitingRepair = true; }
    if (s.stopOnAdd && results.some((r) => r.ok && r.call.name === "add_widget")) { awaitingRepair = false; break; }
    messages.push({
      role: "assistant",
      ...(st.text !== "" ? { parts: [part.history(st.text)] } : {}),
      toolCalls,
      ...(st.assistantState !== undefined ? { providerState: st.assistantState } : {}),
    });
    for (const r of results) messages.push(r.message);
  }
  if (run.repairAttempted && run.repairOk === undefined) run.repairOk = false;
  if (idx.length > 0) run.indexPresent = idx.every(Boolean);
  if (ids.length > 0) run.idPresent = ids.every(Boolean);
  if (s.roundTrip) run.secondTurnOk = stepsDone >= 2 && !run.error && lastStepUsable;
  run.latencyMs = Date.now() - t0;
  return run;
}

// ---------- main ----------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const providerLabel = (u: URL): string =>
  u.hostname.endsWith("googleapis.com") ? "gemini" : u.port === "11434" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? "ollama" : u.hostname;

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const args = parseSpikeArgs(argv);
  if ("error" in args) { console.error(`[s6] ERROR: ${args.error}`); return 1; }
  const cfg = parseAiConfig(env);
  if (!cfg.enabled) {
    console.error(`[s6] ERROR: AI is not enabled/valid (${cfg.reason}). Set AI_ENABLED=true AI_PROVIDER=openai-compatible AI_BASE_URL AI_MODEL (and AI_API_KEY for Gemini).`);
    if (cfg.reason === "invalid") for (const e of cfg.errors) console.error(`[s6]   - ${e}`);
    return 1;
  }
  const config = cfg.config;
  if (config.provider !== "openai-compatible") { console.error("[s6] ERROR: S6 targets AI_PROVIDER=openai-compatible (the Claude adapter is unit-tested only)."); return 1; }
  const mode = args.mode ?? config.toolMode;
  const origin = new URL(config.baseUrl);
  const secret = (env.AI_API_KEY ?? "").trim();
  console.log(`[s6] endpoint=${origin.origin} model=${config.model} key=${secret !== "" ? "set" : "not set"} mode=${mode} stream=${args.stream} runs=${args.runs} rpm=${args.rpm}`);

  // tee fetch for wire observation + sanitised recordings
  let wire = freshWire();
  const recordings: unknown[] = [];
  const teeFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const copy = res.clone();
    const status = res.status;
    if (status === 429 && res.headers.has("retry-after")) wire.retryAfterHeader = true;
    const w = wire;
    w.pending.push(
      copy.text().then((t) => {
        inspectBody(w, status, t);
        const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        let body: unknown = init?.body;
        try { body = JSON.parse(String(init?.body ?? "")); } catch { /* keep raw */ }
        recordings.push({ request: { url: `${u.origin}${u.pathname}`, headers: init?.headers ?? {}, body }, response: { status, headers: Object.fromEntries(res.headers), text: t.slice(0, 200_000) } });
      }).catch(() => {}),
    );
    return res;
  };

  const inner = createOpenAiCompatProvider(
    { baseUrl: config.baseUrl, model: config.model, stream: args.stream, ...(config.apiKey ? { apiKey: config.apiKey } : {}) },
    { fetchFn: teeFetch },
  );
  const provider = mode === "json" ? createJsonActionProvider(inner) : inner;
  const reg = buildToolRegistry({ dataAccess: "schema" });
  const notes: Notes = { usagePresent: 0, fragmentedStreams: 0, schemaRejections: [], errorKinds: {} };
  const ctx: Ctx = {
    provider, reg, wire: () => wire, resetWire: () => { wire = freshWire(); },
    pacer: createPacer({ rpm: args.rpm, now: Date.now, sleep }), sleep, timeoutMs: config.timeoutMs, notes,
    guard: createEarlyStopGuard(),
  };

  const runs: SpikeRun[] = [];
  try {
    for (let r = 1; r <= args.runs; r++) {
      for (const s of SCENARIOS) {
        const run = await runScenario(ctx, s);
        runs.push(run);
        console.log(`[s6] run ${r}/${args.runs} scenario ${s.n} (${s.label}): calls=${run.calls.map((c) => c.name).join(",") || "none"} finish=${run.finish}${run.error ? ` ERROR=${run.error.kind}${run.error.status ? `/${run.error.status}` : ""}` : ""} ${Math.round(run.latencyMs / 1000)}s`);
        if (ctx.guard.stopped()) break;
      }
      if (ctx.guard.stopped()) break;
    }
    const stopped = ctx.guard.stopped();
    if (stopped) console.log(`[s6] STOPPING EARLY: ${stopped}. Writing the partial results gathered so far.`);

    if (!stopped && args.burst > 0) {
      console.log(`[s6] burst: ${args.burst} un-paced calls (provokes 429)`);
      const delays: number[] = [];
      let n429 = 0;
      let hdr = false;
      for (let i = 0; i < args.burst; i++) {
        const st = await oneStep({ ...ctx, wire: () => wire }, [{ role: "user", parts: [part.user("Which tables are available to me?")] }], false);
        if (st.error?.kind === "rate_limited") { n429++; hdr = hdr || st.retryAfterHeader; if (st.retryDelayMs !== undefined) delays.push(st.retryDelayMs); }
      }
      console.log(`[s6] burst result: 429s=${n429} retryAfterHeader=${hdr} delaysMs=${JSON.stringify(delays)}`);
    }

    if (!ctx.guard.stopped() && args.raw) {
      await ctx.pacer.wait();
      const spec = reg.specs.find((t) => t.name === "list_tables")!;
      const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret !== "" ? { Authorization: `Bearer ${secret}` } : {}) },
        body: JSON.stringify({ model: config.model, stream: false, messages: [{ role: "user", content: "Which tables are available to me?" }], tools: [{ type: "function", function: { name: spec.name, description: spec.description, parameters: spec.jsonSchema } }] }),
      });
      const j: any = await res.json().catch(() => null);
      console.log(`[s6][raw] status=${res.status} tool_calls=${j?.choices?.[0]?.message?.tool_calls?.length ?? 0} finish=${j?.choices?.[0]?.finish_reason ?? "?"}`);
    }
  } finally {
    if (args.record) {
      await mkdir(args.record, { recursive: true });
      const clean = sanitizeRecording(recordings, secret);
      await Promise.all(clean.map((rec, i) => writeFile(join(args.record!, `wire-${String(i + 1).padStart(3, "0")}.json`), JSON.stringify(rec, null, 2))));
      console.log(`[s6] wrote ${clean.length} sanitised wire captures to ${args.record}`);
    }
  }

  const agg = aggregateSpikeRuns(runs);
  const date = new Date().toISOString().slice(0, 10);
  const label = providerLabel(origin);
  const row = formatMatrixRow({ provider: label, model: config.model, date, stream: mode === "json" ? `json/${args.stream}` : String(args.stream), agg });
  const perScenario = Object.fromEntries(SCENARIOS.map((s) => [`s${s.n}`, aggregateSpikeRuns(runs.filter((r) => r.scenario === s.n))]));
  const verdict = verdictFor(agg);
  const decision =
    verdict === "native" ? `AI_TOOL_MODE=native for ${config.model}`
    : verdict === INVALID_RUN_VERDICT ? `${INVALID_RUN_VERDICT}: every trial failed with a request error - no verdict`
    : verdict.startsWith("inconclusive") ? `${verdict}: ${agg.excludedTrials.count} trial(s) excluded (${JSON.stringify(agg.excludedTrials.byKind)}); re-run for >= 20 clean trials; default stays AI_TOOL_MODE=native`
    : `AI_TOOL_MODE=json (best effort) for ${config.model}`;

  const stoppedEarly = ctx.guard.stopped();
  const result = { endpoint: origin.origin, model: config.model, mode, stream: args.stream, date, ...(stoppedEarly ? { stoppedEarly } : {}), aggregate: agg, perScenario, notes, matrixRow: row, decision };
  if (args.out) await writeFile(args.out, JSON.stringify(result, null, 2));
  console.log("\n[s6] METRICS");
  console.log(JSON.stringify({ aggregate: agg, notes }, null, 2));
  console.log("\n[s6] MATRIX ROW (paste this back)");
  console.log(MATRIX_HEADER);
  console.log(row);
  console.log(`\n[s6] clean trials=${agg.cleanTrials}/${agg.trials} excluded=${agg.excludedTrials.count} ${JSON.stringify(agg.excludedTrials.byKind)}`);
  console.log(`[s6] decision: ${decision}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (e) => { console.error(`[s6] FATAL: ${e instanceof Error ? e.name : "error"}`); process.exit(1); },
  );
}
