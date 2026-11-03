// Phase 135-04: OpenAI-compatible chat-completions adapter on plain fetch (Gemini AI Studio, optionally Ollama).
// Unit-tested against HAND-WRITTEN fixtures (tests/fixtures/ai/openai); live proof is the 135 S6 spike.
// Rules: the key lives only in a closure and the Authorization header; provider response bodies are read ONLY to
// extract retry hints and are then discarded - never placed in an event, an Error, or a log line.
import { isOutboundRequest, type OutboundRequest } from "../outbound";
import type { LlmEvent, LlmMessage, LlmProvider, ProviderDeps, ProviderErrorKind } from "../provider";
import { parseSseStream } from "../sseParse";
import { providerFetch } from "./providerFetch";

export type OpenAiCompatOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  sendToolChoice?: boolean;
};

type OpenCall = { id: string; name: string; args: string; state?: unknown };
type ErrEvent = Extract<LlmEvent, { type: "error" }>;

const mapFinish = (r: unknown): Extract<LlmEvent, { type: "done" }>["finish"] =>
  r === "stop" ? "stop" : r === "tool_calls" ? "tool_calls" : r === "length" ? "length" : r === "content_filter" ? "filtered" : "other";

function toWireMessages(req: OutboundRequest): unknown[] {
  const out: unknown[] = [];
  if (req.system !== "") out.push({ role: "system", content: req.system });
  for (const m of req.messages as readonly LlmMessage[]) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    else {
      const msg: Record<string, unknown> = { role: "assistant", content: m.text ?? null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((c) => {
          const tc: Record<string, unknown> = { id: c.id, type: "function", function: { name: c.name, arguments: c.argsJson } };
          if (c.providerState !== undefined) tc.extra_content = c.providerState; // Gemini thought_signature, verbatim
          return tc;
        });
      }
      out.push(msg);
    }
  }
  return out;
}

function retryHintMs(headers: Headers, body: unknown, now: number): number | undefined {
  const h = headers.get("retry-after");
  if (h) {
    if (/^\d+(\.\d+)?$/.test(h.trim())) return Math.round(parseFloat(h) * 1000);
    const t = Date.parse(h);
    if (!Number.isNaN(t)) return Math.max(0, t - now);
  }
  const err = (Array.isArray(body) ? body[0] : body) as { error?: { details?: unknown; message?: unknown } } | undefined;
  const e = err && typeof err === "object" ? err.error : undefined;
  if (e && Array.isArray(e.details)) {
    for (const d of e.details as Array<{ retryDelay?: unknown }>) {
      if (d && typeof d.retryDelay === "string") {
        const m = /^([\d.]+)s$/.exec(d.retryDelay);
        if (m) return Math.round(parseFloat(m[1]) * 1000);
      }
    }
  }
  if (e && typeof e.message === "string") {
    const m = /retry in ([\d.]+)s/i.exec(e.message);
    if (m) return Math.round(parseFloat(m[1]) * 1000);
  }
  return undefined;
}

/** 142 UAT: Gemini answers a bad or missing key with 400 INVALID_ARGUMENT (reason API_KEY_INVALID, or only a message
 *  naming the API key), not 401. The body is inspected here only; it is never surfaced or logged. */
function isBadKeyBody(parsed: unknown): boolean {
  const e = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: unknown; details?: unknown } } | undefined;
  const err = e?.error;
  if (!err) return false;
  if (Array.isArray(err.details) && err.details.some((d) => (d as { reason?: unknown })?.reason === "API_KEY_INVALID")) return true;
  return typeof err.message === "string" && /\bapi[ _-]?key\b/i.test(err.message);
}

export function createOpenAiCompatProvider(opts: OpenAiCompatOptions, deps: ProviderDeps = {}): LlmProvider {
  const apiKey = opts.apiKey; // closure only
  const streaming = opts.stream !== false;
  const fetchFn = deps.fetchFn ?? providerFetch;
  const now = deps.now ?? Date.now;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function* run(req: OutboundRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
    const fail = (kind: ProviderErrorKind, status?: number, retryAfterMs?: number): ErrEvent => {
      const e: ErrEvent = { type: "error", kind };
      if (status !== undefined) e.status = status;
      if (retryAfterMs !== undefined) e.retryAfterMs = retryAfterMs;
      return e;
    };
    const transport = (err: unknown): ErrEvent => {
      const n = (err as { name?: string } | null)?.name;
      if (signal.aborted || n === "AbortError") return fail("aborted");
      if (n === "TimeoutError") return fail("timeout");
      return fail("network");
    };

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toWireMessages(req),
      stream: streaming,
      max_tokens: opts.maxTokens ?? 4096,
    };
    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.jsonSchema } }));
      if (opts.sendToolChoice !== false) body.tool_choice = "auto";
    }
    if (streaming) body.stream_options = { include_usage: true };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let res: Response;
    try {
      res = await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" });
    } catch (err) {
      yield transport(err);
      return;
    }

    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await res.text()); // hints only; discarded below
      } catch {
        parsed = undefined;
      }
      const s = res.status;
      const kind: ProviderErrorKind =
        s === 401 || s === 403 || (s === 400 && isBadKeyBody(parsed)) ? "auth" : s === 429 ? "rate_limited" : s >= 500 ? "overloaded" : "bad_request";
      yield fail(kind, s, kind === "rate_limited" ? retryHintMs(res.headers, parsed, now()) : undefined);
      return;
    }

    const open = new Map<string | number, OpenCall>();
    const order: OpenCall[] = [];
    let last: string | number | undefined;
    let emitted = 0;
    let finishRaw: unknown;
    let sawFinish = false;
    let sawDone = false;

    const accumulate = (tcs: unknown): void => {
      if (!Array.isArray(tcs)) return;
      for (const tc of tcs as Array<Record<string, any>>) {
        let key: string | number;
        if (typeof tc.index === "number") key = tc.index;
        else if (typeof tc.id === "string") key = tc.id;
        else {
          const prev = last !== undefined ? open.get(last) : undefined;
          key = last !== undefined && !(tc.function?.name && prev?.name) ? last : `anon_${open.size}`;
        }
        let c = open.get(key);
        if (!c) {
          c = { id: typeof tc.id === "string" ? tc.id : `call_${open.size}`, name: "", args: "" };
          open.set(key, c);
          order.push(c);
        }
        if (typeof tc.id === "string") c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        const a = tc.function?.arguments;
        if (typeof a === "string") c.args += a;
        else if (a && typeof a === "object") c.args = JSON.stringify(a);
        if (tc.extra_content !== undefined) c.state = tc.extra_content;
        last = key;
      }
    };
    function* flushCalls(): Generator<LlmEvent> {
      while (emitted < order.length) {
        const c = order[emitted++];
        const ev: LlmEvent = { type: "tool_call", id: c.id, name: c.name, argsRaw: c.args };
        if (c.state !== undefined) ev.providerState = c.state;
        yield ev;
      }
    }
    const usageOf = (u: any): LlmEvent | null =>
      u && typeof u === "object"
        ? { type: "usage", inputTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined, outputTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : undefined }
        : null;
    const doneEvent = (): LlmEvent => ({ type: "done", finish: open.size > 0 ? "tool_calls" : mapFinish(finishRaw) });

    if (!streaming) {
      let j: any;
      try {
        j = JSON.parse(await res.text());
      } catch (err) {
        yield (err as { name?: string })?.name === "AbortError" || signal.aborted ? fail("aborted") : fail("protocol");
        return;
      }
      const choice = j?.choices?.[0];
      if (!choice || typeof choice !== "object") {
        yield fail("protocol");
        return;
      }
      const msg = choice.message ?? {};
      if (typeof msg.content === "string" && msg.content !== "") yield { type: "text_delta", text: msg.content };
      accumulate(msg.tool_calls);
      yield* flushCalls();
      const u = usageOf(j.usage);
      if (u) yield u;
      finishRaw = choice.finish_reason;
      yield doneEvent();
      return;
    }

    if (!res.body) {
      yield fail("protocol");
      return;
    }
    try {
      for await (const ev of parseSseStream(res.body, signal)) {
        if (ev.data === "[DONE]") {
          sawDone = true;
          break;
        }
        let chunk: any;
        try {
          chunk = JSON.parse(ev.data);
        } catch {
          yield fail("protocol");
          return;
        }
        const choice = chunk?.choices?.[0];
        if (choice) {
          const d = choice.delta ?? {};
          if (typeof d.content === "string" && d.content !== "") yield { type: "text_delta", text: d.content };
          accumulate(d.tool_calls);
          if (choice.finish_reason) {
            sawFinish = true;
            finishRaw = choice.finish_reason;
            yield* flushCalls();
          }
        }
        const u = usageOf(chunk?.usage);
        if (u) yield u;
      }
    } catch (err) {
      yield transport(err);
      return;
    }
    if (!sawDone && !sawFinish) {
      yield fail("protocol"); // stream ended mid-flight
      return;
    }
    yield* flushCalls();
    yield doneEvent();
  }

  const provider: LlmProvider = {
    id: "openai-compatible",
    model: opts.model,
    capabilities: { nativeTools: true, parallelTools: true, streaming, usageInStream: true, forcedToolChoice: false, opaqueReplay: true },
    complete(req: OutboundRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
      if (!isOutboundRequest(req)) throw new Error("openai-compatible: request was not built by buildOutboundRequest");
      return run(req, signal);
    },
  };
  return provider;
}
