// Phase 135-04: OpenAI-compatible adapter against HAND-WRITTEN fixtures (see fixtures/ai/openai/README.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createOpenAiCompatProvider } from "../src/lib/ai/providers/openaiCompat";
import { buildOutboundRequest, part } from "../src/lib/ai/outbound";
import type { LlmEvent, LlmMessage, ToolSpec } from "../src/lib/ai/provider";
import { KEY_SENTINEL, captureConsole, findLeak } from "./helpers/aiTestKit";

const FIX = path.join(__dirname, "fixtures/ai/openai");
const fixture = (f: string) => readFileSync(path.join(FIX, f), "utf8");
const BASE = "https://provider.test/v1";
const TOOLS: ToolSpec[] = [{ name: "list_tables", description: "List tables", jsonSchema: { type: "object", properties: {} } }];

type Rec = { url: string; init: RequestInit };
function fakeFetch(file: string, o: { status?: number; headers?: Record<string, string>; sliceBytes?: number } = {}) {
  const calls: Rec[] = [];
  const text = fixture(file);
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const bytes = new TextEncoder().encode(text);
    const n = o.sliceBytes ?? bytes.length;
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i >= bytes.length) return c.close();
        c.enqueue(bytes.slice(i, i + n));
        i += n;
      },
    });
    return new Response(body, { status: o.status ?? 200, headers: o.headers });
  });
  return { fn: fn as unknown as typeof fetch, calls, mock: fn };
}

const req = (messages: LlmMessage[] | null = null) =>
  buildOutboundRequest({
    system: [part.system("You are helpful.")],
    messages: messages
      ? (messages.map((m) =>
          m.role === "user"
            ? { role: "user" as const, parts: [part.user(m.text)] }
            : m.role === "assistant"
              ? { role: "assistant" as const, parts: m.text ? [part.history(m.text)] : undefined, toolCalls: m.toolCalls, providerState: m.providerState }
              : { role: "tool" as const, toolCallId: m.toolCallId, name: m.name, parts: [part.schema(m.content)] },
        ) as never)
      : [{ role: "user", parts: [part.user("hi")] }],
    tools: TOOLS,
    dataAccess: "schema",
  });

async function collect(it: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const run = (file: string, o: Parameters<typeof fakeFetch>[1] = {}, opts: Partial<Parameters<typeof createOpenAiCompatProvider>[0]> = {}) => {
  const f = fakeFetch(file, o);
  const p = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1", ...opts }, { fetchFn: f.fn });
  return { f, events: collect(p.complete(req(), new AbortController().signal)) };
};

afterEach(() => vi.unstubAllGlobals());

describe("OAI openai-compatible adapter", () => {
  it("OAI-1 text stream is identical regardless of chunk boundaries", async () => {
    const expected: LlmEvent[] = [
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "text_delta", text: " world" },
      { type: "usage", inputTokens: 12, outputTokens: 3 },
      { type: "done", finish: "stop" },
    ];
    for (const sliceBytes of [1, 3, 17, undefined]) expect(await run("text.sse.txt", { sliceBytes }).events).toEqual(expected);
  });

  it("OAI-2 fragmented args are concatenated, not parsed", async () => {
    for (const sliceBytes of [1, 17, undefined]) {
      const ev = await run("tool_fragmented.sse.txt", { sliceBytes }).events;
      expect(ev).toEqual([
        { type: "tool_call", id: "call_1", name: "describe_table", argsRaw: '{"table":"demo.nyctaxi"}' },
        { type: "usage", inputTokens: 20, outputTokens: 8 },
        { type: "done", finish: "tool_calls" },
      ]);
    }
  });

  it("OAI-3 index-less and whole-args calls (string and object args)", async () => {
    const a = await run("tool_no_index.sse.txt", { sliceBytes: 5 }).events;
    expect(a.filter((e) => e.type === "tool_call")).toEqual([{ type: "tool_call", id: "call_g1", name: "list_tables", argsRaw: '{"schema":"demo"}' }]);
    const b = await run("tool_whole_args.sse.txt").events;
    expect(b.filter((e) => e.type === "tool_call")).toEqual([{ type: "tool_call", id: "call_w1", name: "list_tables", argsRaw: '{"schema":"demo"}' }]);
    // arguments as an OBJECT -> stringified (inline body, same fetch seam)
    const body = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"o1","function":{"name":"list_tables","arguments":{"schema":"demo"}}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n';
    const fetchFn = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const p = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1" }, { fetchFn });
    const c = (await collect(p.complete(req(), new AbortController().signal))).filter((e) => e.type === "tool_call");
    expect(c).toEqual([{ type: "tool_call", id: "o1", name: "list_tables", argsRaw: '{"schema":"demo"}' }]);
  });

  it("OAI-4 parallel calls keep order", async () => {
    const ev = await run("tool_parallel.sse.txt", { sliceBytes: 7 }).events;
    expect(ev.filter((e) => e.type === "tool_call").map((e) => (e as { id: string }).id)).toEqual(["call_a", "call_b"]);
  });

  it("OAI-5 Gemini extra_content is replayed byte-identical", async () => {
    const ev = await run("gemini_extra_content.sse.txt", { sliceBytes: 11 }).events;
    const call = ev.find((e) => e.type === "tool_call") as Extract<LlmEvent, { type: "tool_call" }>;
    const fixtureExtra = JSON.parse(fixture("gemini_extra_content.sse.txt").split("\n")[0].slice(6)).choices[0].delta.tool_calls[0].extra_content;
    expect(call.providerState).toEqual(fixtureExtra);
    const next = fakeFetch("text.sse.txt");
    const p = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1" }, { fetchFn: next.fn });
    await collect(
      p.complete(
        req([
          { role: "user", text: "hi" },
          { role: "assistant", toolCalls: [{ id: call.id, name: call.name, argsJson: call.argsRaw, providerState: call.providerState }] },
          { role: "tool", toolCallId: call.id, name: call.name, content: "[]" },
        ]),
        new AbortController().signal,
      ),
    );
    const sent = JSON.parse(String(next.calls[0].init.body));
    const asst = sent.messages.find((m: { role: string }) => m.role === "assistant");
    expect(JSON.stringify(asst.tool_calls[0].extra_content)).toBe(JSON.stringify(fixtureExtra));
    expect(asst.content).toBeNull();
    expect(asst.tool_calls[0]).toMatchObject({ id: "call_x1", type: "function", function: { name: "list_tables", arguments: "{}" } });
    expect(sent.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_x1", content: "[]" });
  });

  it("OAI-6 missing finish_reason with a tool call -> tool_calls; truncation -> protocol", async () => {
    const ev = await run("no_finish_reason.sse.txt").events;
    expect(ev.at(-1)).toEqual({ type: "done", finish: "tool_calls" });
    expect(ev.some((e) => e.type === "tool_call")).toBe(true);
    const t = await run("truncated.sse.txt", { sliceBytes: 9 }).events;
    expect(t.at(-1)).toEqual({ type: "error", kind: "protocol" });
    expect(t.some((e) => e.type === "done")).toBe(false);
  });

  it("OAI-7 request shape and URL joining", async () => {
    for (const base of [BASE, "https://generativelanguage.googleapis.com/v1beta/openai/"]) {
      const f = fakeFetch("text.sse.txt");
      const p = createOpenAiCompatProvider({ baseUrl: base, model: "m1" }, { fetchFn: f.fn });
      await collect(p.complete(req(), new AbortController().signal));
      expect(f.calls[0].url).toBe(`${base.replace(/\/+$/, "")}/chat/completions`);
      expect(f.calls[0].init.method).toBe("POST");
      expect(f.calls[0].init.redirect).toBe("error");
      const b = JSON.parse(String(f.calls[0].init.body));
      expect(b).toEqual({
        model: "m1",
        messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "list_tables", description: "List tables", parameters: { type: "object", properties: {} } } }],
        tool_choice: "auto",
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4096,
      });
      expect("temperature" in b).toBe(false);
    }
    const f = fakeFetch("text.sse.txt");
    const p = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1", temperature: 0.2 }, { fetchFn: f.fn });
    await collect(p.complete(req(), new AbortController().signal));
    expect(JSON.parse(String(f.calls[0].init.body)).temperature).toBe(0.2);
  });

  it("OAI-8 key only in Authorization, only when set (with positive control)", async () => {
    const f = fakeFetch("text.sse.txt");
    const p = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1", apiKey: KEY_SENTINEL }, { fetchFn: f.fn });
    await collect(p.complete(req(), new AbortController().signal));
    const init = f.calls[0].init;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer " + KEY_SENTINEL); // positive control
    expect(findLeak(JSON.stringify({ url: f.calls[0].url, body: init.body, headers: { ...headers, Authorization: "" } }), KEY_SENTINEL)).toBeNull();
    expect(JSON.stringify(Object.keys(p))).not.toContain("apiKey");
    expect(findLeak(JSON.stringify(p), KEY_SENTINEL)).toBeNull();
    const g = fakeFetch("text.sse.txt");
    await collect(createOpenAiCompatProvider({ baseUrl: BASE, model: "m1" }, { fetchFn: g.fn }).complete(req(), new AbortController().signal));
    expect(Object.keys(g.calls[0].init.headers as object).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("OAI-9 errors are normalised and body text never leaks (with positive control)", async () => {
    const cap = captureConsole();
    try {
      const cases: Array<[string, { status: number; headers?: Record<string, string> }, LlmEvent]> = [
        ["error_401.json", { status: 401 }, { type: "error", kind: "auth", status: 401 }],
        ["error_400.json", { status: 400 }, { type: "error", kind: "bad_request", status: 400 }],
        ["error_429_gemini_array.json", { status: 429 }, { type: "error", kind: "rate_limited", status: 429, retryAfterMs: 34000 }],
        ["error_400.json", { status: 429, headers: { "Retry-After": "2" } }, { type: "error", kind: "rate_limited", status: 429, retryAfterMs: 2000 }],
        ["error_400.json", { status: 503 }, { type: "error", kind: "overloaded", status: 503 }],
      ];
      let all = "";
      for (const [file, o, want] of cases) {
        expect(findLeak(fixture(file), "BODYSENTINEL")).not.toBeNull(); // positive control
        const ev = await run(file, o).events;
        expect(ev).toEqual([want]);
        all += JSON.stringify(ev);
      }
      expect(findLeak(all + cap.text(), "BODYSENTINEL")).toBeNull();
      // transport failures
      const net = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1" }, { fetchFn: (async () => { throw new TypeError("fetch failed BODYSENTINEL"); }) as unknown as typeof fetch });
      const ne = await collect(net.complete(req(), new AbortController().signal));
      expect(ne).toEqual([{ type: "error", kind: "network" }]);
      const ac = new AbortController();
      ac.abort();
      const ab = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1" }, { fetchFn: (async () => { const e = new Error("x"); e.name = "AbortError"; throw e; }) as unknown as typeof fetch });
      expect(await collect(ab.complete(req(), ac.signal))).toEqual([{ type: "error", kind: "aborted" }]);
      expect(findLeak(cap.text(), "BODYSENTINEL")).toBeNull();
    } finally {
      cap.restore();
    }
  });

  it("OAI-10 unbranded request throws before fetch", async () => {
    const f = fakeFetch("text.sse.txt");
    const p = createOpenAiCompatProvider({ baseUrl: BASE, model: "m1" }, { fetchFn: f.fn });
    const forged = { ...req() };
    await expect((async () => collect(p.complete(forged as never, new AbortController().signal)))()).rejects.toThrow();
    expect(f.mock).not.toHaveBeenCalled();
  });

  it("OAI-11 stream:false yields the same events as the streamed equivalent", async () => {
    const ns = await run("nonstream_tool.json", {}, { stream: false }).events;
    const st = await run("tool_whole_args.sse.txt").events;
    expect(ns).toEqual(st);
    const f = fakeFetch("nonstream_tool.json");
    await collect(createOpenAiCompatProvider({ baseUrl: BASE, model: "m1", stream: false }, { fetchFn: f.fn }).complete(req(), new AbortController().signal));
    const b = JSON.parse(String(f.calls[0].init.body));
    expect(b.stream).toBe(false);
    expect("stream_options" in b).toBe(false);
  });
});
