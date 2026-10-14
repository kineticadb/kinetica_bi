import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { streamAsk, parseSseStream, AskHttpError } from "./askStream";
import { useAiConfigured, __resetAiConfigCacheForTest } from "./aiAvailability";
import type { AskRequest } from "@kinetica-bi/shared";

const body: AskRequest = {
  dashboardId: 1,
  question: "q",
  snapshot: { widgets: [], layers: [], dynamicViews: [], filters: [] },
  turns: [],
};
const enc = new TextEncoder();
const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
const sse = (chunks: string[]) =>
  new Response(streamOf(chunks), { status: 200, headers: { "Content-Type": "text/event-stream" } });
const json = (b: unknown, status: number) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const collect = async <T,>(g: AsyncGenerator<T>) => {
  const out: T[] = [];
  for await (const e of g) out.push(e);
  return out;
};

afterEach(() => vi.restoreAllMocks());

describe("streamAsk", () => {
  it("ASKS-1: yields typed events, ignores comments", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      sse([
        'event: status\ndata: {"phase":"thinking","label":"t"}\n\n',
        ": ping\n\n",
        'event: step\ndata: {"n":1,"tool":"x","label":"l"}\n\n',
        'event: result\ndata: {"answerId":1}\n\n',
        'event: done\ndata: {"answerId":1,"outcome":"ok","steps":1}\n\n',
      ]),
    );
    const evs = await collect(streamAsk(body, new AbortController().signal));
    expect(evs.map((e) => e.event)).toEqual(["status", "step", "result", "done"]);
    expect((evs[2].data as { answerId: number }).answerId).toBe(1);
  });

  it("ASKS-2: split chunks and CRLF", async () => {
    const evs = await collect(
      parseSseStream(streamOf(["event: res", 'ult\r\ndata: {"a"', ":1}\r\n\r\n"])),
    );
    expect(evs).toEqual([{ event: "result", data: '{"a":1}' }]);
  });

  it("ASKS-3: typed HTTP errors", async () => {
    const sig = new AbortController().signal;
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(json({ error: "An AI answer is already in progress.", code: "AI_BUSY" }, 409));
    await expect(collect(streamAsk(body, sig))).rejects.toMatchObject({
      status: 409,
      code: "AI_BUSY",
      message: "An AI answer is already in progress.",
    });
    spy.mockResolvedValueOnce(json({ code: "AI_CAP_HOUR", message: "Too many.", retryAfterSeconds: 120 }, 429));
    const e = await collect(streamAsk(body, sig)).catch((x) => x);
    expect(e).toBeInstanceOf(AskHttpError);
    expect(e).toMatchObject({ code: "AI_CAP_HOUR", message: "Too many.", retryAfterSeconds: 120 });
    spy.mockResolvedValueOnce(json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" }, 503));
    await expect(collect(streamAsk(body, sig))).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("ASKS-4: abort mid-stream ends with AbortError and cancels reader", async () => {
    const cancel = vi.fn();
    const rs = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: status\ndata: {"phase":"thinking","label":"t"}\n\n'));
      },
      cancel,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(rs, { status: 200 }));
    const ac = new AbortController();
    const g = streamAsk(body, ac.signal);
    const first = await g.next();
    expect(first.value.event).toBe("status");
    ac.abort();
    await expect(g.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalled();
  });

  it("ASKS-5: single POST with credentials, body and signal", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(sse([]));
    const ac = new AbortController();
    await collect(streamAsk(body, ac.signal));
    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(init.signal).toBe(ac.signal);
  });
});

describe("useAiConfigured", () => {
  beforeEach(() => __resetAiConfigCacheForTest());
  it("ASKS-6: loading -> value, cached, disabled makes no fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ enabled: true }, 200));
    const off = renderHook(() => useAiConfigured(false));
    expect(off.result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    const a = renderHook(() => useAiConfigured(true));
    expect(a.result.current).toBeNull();
    await waitFor(() => expect(a.result.current).toBe(true));
    const b = renderHook(() => useAiConfigured(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
    __resetAiConfigCacheForTest();
    spy.mockImplementation(async () => json({ enabled: false }, 200));
    const c = renderHook(() => useAiConfigured(true));
    await waitFor(() => expect(c.result.current).toBe(false));
    __resetAiConfigCacheForTest();
    spy.mockRejectedValue(new Error("net"));
    const d = renderHook(() => useAiConfigured(true));
    await waitFor(() => expect(d.result.current).toBe(false));
  });
});
