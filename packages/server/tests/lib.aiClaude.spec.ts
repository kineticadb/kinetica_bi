// Claude adapter specs. Fixtures are doc-derived (NOT live-recorded); the adapter is NOT live-verified.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { createClaudeProvider } from "../src/lib/ai/providers/claude";
import { buildOutboundRequest, part, type OutboundRequest } from "../src/lib/ai/outbound";
import type { LlmEvent, LlmMessage } from "../src/lib/ai/provider";
import { KEY_SENTINEL, captureConsole, findLeak } from "./helpers/aiTestKit";

const FX = join(__dirname, "fixtures/ai/claude");
const fx = (n: string) => readFileSync(join(FX, n), "utf8");
const enc = new TextEncoder();
const BASE = "https://claude.test/v1";

function streamOf(text: string, chunk: number): ReadableStream<Uint8Array> {
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}

type Rec = { url: string; init: RequestInit; body: Record<string, any> };
function fakeFetch(make: () => Response) {
  const calls: Rec[] = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "null")) });
    return make();
  }) as typeof fetch;
  return { fetchFn, calls };
}
const sseResp = (name: string, chunk = 1000) =>
  new Response(streamOf(fx(name), chunk), { status: 200, headers: { "content-type": "text/event-stream" } });

const TOOLS = [{ name: "describe_table", description: "d", jsonSchema: { type: "object", properties: {} } }];
function req(messages: LlmMessage[] = [{ role: "user", text: "hi" }]): OutboundRequest {
  return buildOutboundRequest({
    system: [part.system("SYS")],
    messages: messages.map((m) =>
      m.role === "user"
        ? { role: "user" as const, parts: [part.user(m.text)] }
        : m.role === "assistant"
          ? { role: "assistant" as const, parts: m.text ? [part.history(m.text)] : undefined, toolCalls: m.toolCalls, providerState: m.providerState }
          : { role: "tool" as const, toolCallId: m.toolCallId, name: m.name, parts: [part.schema(m.content)], isError: m.isError },
    ),
    tools: TOOLS,
    dataAccess: "schema",
  });
}
async function run(p: ReturnType<typeof createClaudeProvider>, r: OutboundRequest = req()): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of p.complete(r, new AbortController().signal)) out.push(e);
  return out;
}
const mk = (fetchFn: typeof fetch) =>
  createClaudeProvider({ baseUrl: BASE, model: "claude-sonnet-5-5", apiKey: KEY_SENTINEL }, { fetchFn });

afterEach(() => vi.restoreAllMocks());

describe("Claude adapter", () => {
  it("CLD-1: text stream, ping/unknown ignored, cumulative usage, any chunking", async () => {
    const expected: LlmEvent[] = [
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: ", " },
      { type: "text_delta", text: "world" },
      { type: "usage", inputTokens: 25, outputTokens: 15 },
      { type: "done", finish: "stop", assistantState: [{ type: "text", text: "Hello, world" }] },
    ];
    for (const n of [1, 3, 17, 5000]) {
      const { fetchFn } = fakeFetch(() => sseResp("text.sse.txt", n));
      const ev = await run(mk(fetchFn));
      expect(ev.map((e) => e.type)).toEqual(["text_delta", "text_delta", "text_delta", "usage", "done"]);
      expect(ev).toEqual(expected);
    }
  });

  it("CLD-2: split partial_json concatenated into one tool_call", async () => {
    for (const n of [1, 7, 5000]) {
      const { fetchFn } = fakeFetch(() => sseResp("tool_use_split_json.sse.txt", n));
      const ev = await run(mk(fetchFn));
      const calls = ev.filter((e) => e.type === "tool_call");
      expect(calls).toEqual([{ type: "tool_call", id: "toolu_01A", name: "describe_table", argsRaw: '{"tableId": 3, "name": "a } b"}' }]);
      expect(JSON.parse((calls[0] as any).argsRaw)).toEqual({ tableId: 3, name: "a } b" });
      expect(ev[ev.length - 1]).toMatchObject({ type: "done", finish: "tool_calls" });
    }
  });

  it("CLD-3: parallel tool_use in block order", async () => {
    const { fetchFn } = fakeFetch(() => sseResp("parallel_tool_use.sse.txt", 11));
    const ev = await run(mk(fetchFn));
    const calls = ev.filter((e) => e.type === "tool_call") as any[];
    expect(calls.map((c) => [c.id, c.name, c.argsRaw])).toEqual([
      ["toolu_P1", "list_tables", "{}"],
      ["toolu_P2", "describe_table", '{"tableId":7}'],
    ]);
  });

  it("CLD-4: thinking replayed verbatim; tool results first in ONE user message", async () => {
    const { fetchFn, calls } = fakeFetch(() => sseResp("thinking_tool_use.sse.txt", 13));
    const p = mk(fetchFn);
    const ev = await run(p);
    const done = ev[ev.length - 1] as Extract<LlmEvent, { type: "done" }>;
    const raw = done.assistantState as any[];
    expect(raw[0]).toEqual({ type: "thinking", thinking: "I should look at the table.", signature: "EqQBCgIYAhIM-SIG" });
    expect(raw[1]).toMatchObject({ type: "tool_use", id: "toolu_T1", name: "describe_table", input: { tableId: 9 } });

    const tc = ev.find((e) => e.type === "tool_call") as any;
    const next = req([
      { role: "user", text: "hi" },
      { role: "assistant", toolCalls: [{ id: tc.id, name: tc.name, argsJson: tc.argsRaw }], providerState: done.assistantState },
      { role: "tool", toolCallId: "toolu_T1", name: "describe_table", content: "cols: a,b" },
      { role: "tool", toolCallId: "toolu_X2", name: "list_tables", content: "boom", isError: true },
    ]);
    await run(p, next);
    const msgs = calls[1].body.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: "assistant", content: raw });
    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_T1", content: "cols: a,b" },
      { type: "tool_result", tool_use_id: "toolu_X2", content: "boom", is_error: true },
    ]);
  });

  it("CLD-4b: assistant without providerState is rebuilt as text + tool_use blocks", async () => {
    const { fetchFn, calls } = fakeFetch(() => sseResp("text.sse.txt"));
    await run(
      mk(fetchFn),
      req([
        { role: "user", text: "hi" },
        { role: "assistant", text: "thinking out loud", toolCalls: [{ id: "toolu_Z", name: "describe_table", argsJson: '{"tableId":1}' }] },
        { role: "tool", toolCallId: "toolu_Z", name: "describe_table", content: "ok" },
      ]),
    );
    expect(calls[0].body.messages[1].content).toEqual([
      { type: "text", text: "thinking out loud" },
      { type: "tool_use", id: "toolu_Z", name: "describe_table", input: { tableId: 1 } },
    ]);
  });

  it("CLD-5: mid-stream error event and HTTP errors; no body text leaks", async () => {
    for (const f of ["error_event_overloaded.sse.txt", "error_401.json", "error_429.json", "error_529.json"]) {
      expect(fx(f)).toContain("BODYSENTINEL"); // positive control
    }
    const cap = captureConsole();
    try {
      const a = fakeFetch(() => sseResp("error_event_overloaded.sse.txt", 9));
      const evA = await run(mk(a.fetchFn));
      expect(evA.filter((e) => e.type === "error")).toEqual([{ type: "error", kind: "overloaded" }]);
      expect(evA.some((e) => e.type === "done")).toBe(false);

      const h = (status: number, file: string, headers: Record<string, string> = {}) =>
        fakeFetch(() => new Response(fx(file), { status, headers: { "content-type": "application/json", ...headers } }));
      const r429 = await run(mk(h(429, "error_429.json", { "retry-after": "3" }).fetchFn));
      expect(r429).toEqual([{ type: "error", kind: "rate_limited", status: 429, retryAfterMs: 3000 }]);
      const r429b = await run(mk(h(429, "error_429.json").fetchFn));
      expect(r429b).toEqual([{ type: "error", kind: "rate_limited", status: 429 }]);
      expect("retryAfterMs" in r429b[0]).toBe(false);
      const r529 = await run(mk(h(529, "error_529.json").fetchFn));
      expect(r529).toEqual([{ type: "error", kind: "overloaded", status: 529 }]);
      const r401 = await run(mk(h(401, "error_401.json").fetchFn));
      expect(r401).toEqual([{ type: "error", kind: "auth", status: 401 }]);

      const all = JSON.stringify([evA, r429, r429b, r529, r401]) + cap.text();
      expect(findLeak(all, "BODYSENTINEL")).toBeNull();
      expect(findLeak(all, KEY_SENTINEL)).toBeNull();
    } finally {
      cap.restore();
    }
  });

  it("CLD-6: stop_reason mapping", async () => {
    const map: Record<string, string> = {
      end_turn: "stop",
      tool_use: "tool_calls",
      max_tokens: "length",
      refusal: "filtered",
      model_context_window_exceeded: "length",
      pause_turn: "other",
      stop_sequence: "other",
    };
    for (const [sr, finish] of Object.entries(map)) {
      const body = fx("text.sse.txt").replaceAll('"stop_reason":"end_turn"', `"stop_reason":"${sr}"`);
      const { fetchFn } = fakeFetch(() => new Response(streamOf(body, 50), { status: 200 }));
      const ev = await run(mk(fetchFn));
      expect(ev[ev.length - 1]).toMatchObject({ type: "done", finish });
    }
  });

  it("CLD-7: request shape; key only in x-api-key; no thinking; auto tool_choice", async () => {
    const { fetchFn, calls } = fakeFetch(() => sseResp("text.sse.txt"));
    await run(mk(fetchFn));
    const c = calls[0];
    expect(c.url).toBe(`${BASE}/messages`);
    expect(c.init.method).toBe("POST");
    const h = new Headers(c.init.headers as HeadersInit);
    expect(h.get("x-api-key")).toBe(KEY_SENTINEL);
    expect(h.get("anthropic-version")).toBe("2023-06-01");
    expect(h.get("content-type")).toBe("application/json");
    expect(c.init.redirect).toBe("error");
    const b = c.body;
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(b.max_tokens).toBe(4096);
    expect(b.system).toBe("SYS");
    expect(b.stream).toBe(true);
    expect(b.tools).toEqual([{ name: "describe_table", description: "d", input_schema: { type: "object", properties: {} } }]);
    expect(b.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect("thinking" in b).toBe(false);
    expect(["any", "tool"]).not.toContain(b.tool_choice.type);
    // key appears nowhere but the header
    expect(findLeak(JSON.stringify(b) + c.url, KEY_SENTINEL)).toBeNull();
    expect(findLeak([...h.entries()].map(([k, v]) => `${k}=${v}`).join("\n"), KEY_SENTINEL)).toBe("raw");
  });

  it("CLD-8: unbranded request throws before fetch", async () => {
    const { fetchFn, calls } = fakeFetch(() => sseResp("text.sse.txt"));
    const bad = { system: "x", messages: [], tools: [], dataAccess: "schema" } as unknown as OutboundRequest;
    await expect(run(mk(fetchFn), bad)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
