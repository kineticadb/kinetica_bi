// Claude provider (AIPRV-V20-04). Unit-tested against doc-derived fixtures; NOT live-verified (no Anthropic key — AI-F11).
// Wire rules (research Pitfall 4, platform.claude.com docs 2026-10):
//  - never send a forced tool_choice (any/tool => 400 on current models); send {type:"auto",disable_parallel_tool_use:true}
//  - never send `thinking` (adaptive by default; thinking:{type:"disabled"} is rejected on Sonnet 5.5)
//  - thinking/redacted_thinking blocks are replayed VERBATIM via the raw assistant content array (providerState)
//  - tool_result blocks go FIRST, all in ONE user message, directly after the tool_use message
//  - max_tokens is required; message_delta.usage is cumulative (last wins)
//  - the API key travels ONLY in the x-api-key header; provider body text is never surfaced (errors carry kind/status only)
import { isOutboundRequest, type OutboundRequest } from "../outbound";
import { parseSseStream } from "../sseParse";
import { providerFetch } from "./providerFetch";
import type { Capabilities, LlmEvent, LlmMessage, LlmProvider, ProviderDeps, ProviderErrorKind } from "../provider";

export type ClaudeOptions = { baseUrl: string; model: string; apiKey: string; maxTokens?: number };

const CAPS: Capabilities = {
  nativeTools: true,
  parallelTools: true,
  streaming: true,
  usageInStream: true,
  forcedToolChoice: false,
  opaqueReplay: true,
};

const FINISH: Record<string, "stop" | "tool_calls" | "length" | "filtered" | "other"> = {
  end_turn: "stop",
  tool_use: "tool_calls",
  max_tokens: "length",
  refusal: "filtered",
  model_context_window_exceeded: "length",
  pause_turn: "other",
  stop_sequence: "other",
};

type Json = Record<string, unknown>;

function parseObj(s: string): Json {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
  } catch {
    return {};
  }
}

function toWireMessages(messages: readonly LlmMessage[]): Json[] {
  const out: Json[] = [];
  let results: Json[] | null = null;
  for (const m of messages) {
    if (m.role === "tool") {
      if (!results) {
        results = [];
        out.push({ role: "user", content: results });
      }
      const b: Json = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      if (m.isError) b.is_error = true;
      results.push(b);
      continue;
    }
    results = null;
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.providerState !== undefined) {
      out.push({ role: "assistant", content: m.providerState });
    } else {
      const blocks: Json[] = [];
      if (m.text) blocks.push({ type: "text", text: m.text });
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: parseObj(c.argsJson) });
      if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
    }
  }
  return out;
}

function httpErrorKind(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 529 || status === 503 || status === 500 || status === 502 || status === 504) return "overloaded";
  if (status >= 400 && status < 500) return "bad_request";
  return "protocol";
}

function streamErrorKind(type: unknown): ProviderErrorKind {
  switch (type) {
    case "overloaded_error":
    case "api_error":
      return "overloaded";
    case "rate_limit_error":
      return "rate_limited";
    case "authentication_error":
    case "permission_error":
      return "auth";
    case "invalid_request_error":
    case "not_found_error":
    case "request_too_large":
      return "bad_request";
    default:
      return "protocol";
  }
}

export function createClaudeProvider(opts: ClaudeOptions, deps: ProviderDeps = {}): LlmProvider {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const maxTokens = opts.maxTokens ?? 4096;
  return {
    id: "claude",
    model: opts.model,
    capabilities: CAPS,
    async *complete(req: OutboundRequest, signal: AbortSignal): AsyncGenerator<LlmEvent> {
      if (!isOutboundRequest(req)) throw new Error("claude provider: request is not an OutboundRequest");
      const fetchFn = deps.fetchFn ?? providerFetch;
      const body: Json = {
        model: opts.model,
        max_tokens: maxTokens,
        messages: toWireMessages(req.messages),
        stream: true,
      };
      if (req.system) body.system = req.system;
      if (req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.jsonSchema }));
        body.tool_choice = { type: "auto", disable_parallel_tool_use: true };
      }

      let res: Response;
      try {
        res = await fetchFn(`${base}/messages`, {
          method: "POST",
          headers: {
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
          redirect: "error",
        });
      } catch (e) {
        yield { type: "error", kind: signal.aborted || (e as Error)?.name === "AbortError" ? "aborted" : "network" };
        return;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined); // body text is never read or surfaced
        const kind = httpErrorKind(res.status);
        const ev: LlmEvent = { type: "error", kind, status: res.status };
        if (kind === "rate_limited") {
          const ra = Number(res.headers.get("retry-after"));
          if (Number.isFinite(ra) && ra > 0 && res.headers.get("retry-after") !== null) ev.retryAfterMs = Math.round(ra * 1000);
        }
        yield ev;
        return;
      }
      if (!res.body) {
        yield { type: "error", kind: "protocol" };
        return;
      }

      type Block = { raw: Json; json?: string };
      const blocks = new Map<number, Block>();
      const content: Json[] = [];
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let stopReason: string | undefined;
      let finished = false;

      try {
        for await (const sse of parseSseStream(res.body, signal)) {
          let d: Json;
          try {
            d = JSON.parse(sse.data) as Json;
          } catch {
            continue;
          }
          const type = (sse.event ?? d.type) as string | undefined;
          if (type === "message_start") {
            const u = (d.message as Json | undefined)?.usage as Json | undefined;
            if (typeof u?.input_tokens === "number") inputTokens = u.input_tokens;
          } else if (type === "content_block_start") {
            const cb = { ...((d.content_block as Json) ?? {}) };
            const blk: Block = { raw: cb };
            if (cb.type === "text") cb.text = typeof cb.text === "string" ? cb.text : "";
            if (cb.type === "thinking") {
              cb.thinking = typeof cb.thinking === "string" ? cb.thinking : "";
              cb.signature = typeof cb.signature === "string" ? cb.signature : "";
            }
            if (cb.type === "tool_use") blk.json = "";
            blocks.set(d.index as number, blk);
          } else if (type === "content_block_delta") {
            const blk = blocks.get(d.index as number);
            const delta = d.delta as Json | undefined;
            if (!blk || !delta) continue;
            if (delta.type === "text_delta" && typeof delta.text === "string") {
              blk.raw.text = String(blk.raw.text ?? "") + delta.text;
              if (delta.text !== "") yield { type: "text_delta", text: delta.text };
            } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
              blk.json = (blk.json ?? "") + delta.partial_json;
            } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
              blk.raw.thinking = String(blk.raw.thinking ?? "") + delta.thinking;
            } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
              blk.raw.signature = String(blk.raw.signature ?? "") + delta.signature;
            }
          } else if (type === "content_block_stop") {
            const blk = blocks.get(d.index as number);
            if (!blk) continue;
            blocks.delete(d.index as number);
            if (blk.raw.type === "tool_use") {
              const argsRaw = blk.json && blk.json.trim() !== "" ? blk.json : "{}";
              blk.raw.input = parseObj(argsRaw);
              content.push(blk.raw);
              yield { type: "tool_call", id: String(blk.raw.id), name: String(blk.raw.name), argsRaw };
            } else {
              content.push(blk.raw);
            }
          } else if (type === "message_delta") {
            const delta = d.delta as Json | undefined;
            if (typeof delta?.stop_reason === "string") stopReason = delta.stop_reason;
            const u = d.usage as Json | undefined;
            if (typeof u?.output_tokens === "number") outputTokens = u.output_tokens; // cumulative: last wins
            if (typeof u?.input_tokens === "number") inputTokens = u.input_tokens;
          } else if (type === "message_stop") {
            finished = true;
            break;
          } else if (type === "error") {
            const et = (d.error as Json | undefined)?.type; // type only; message text is never surfaced
            yield { type: "error", kind: streamErrorKind(et) };
            return;
          }
          // ping and unknown event types are ignored
        }
      } catch (e) {
        yield { type: "error", kind: signal.aborted || (e as Error)?.name === "AbortError" ? "aborted" : "network" };
        return;
      }

      if (!finished) {
        yield { type: "error", kind: "protocol" };
        return;
      }
      if (inputTokens !== undefined || outputTokens !== undefined) {
        const u: LlmEvent = { type: "usage" };
        if (inputTokens !== undefined) u.inputTokens = inputTokens;
        if (outputTokens !== undefined) u.outputTokens = outputTokens;
        yield u;
      }
      yield { type: "done", finish: FINISH[stopReason ?? ""] ?? "other", assistantState: content };
    },
  };
}
