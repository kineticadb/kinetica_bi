import { describe, it, expect } from "vitest";
import { parseSseStream } from "../src/lib/ai/sseParse";

const enc = new TextEncoder();
function streamOf(bytes: Uint8Array, chunk: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
}
const collect = async (body: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
  const out: { event?: string; data: string }[] = [];
  for await (const e of parseSseStream(body, signal)) out.push(e);
  return out;
};
const run = (s: string, chunk = 1000) => collect(streamOf(enc.encode(s), chunk));

describe("parseSseStream", () => {
  it("SSE-1: event and data; event optional", async () => {
    expect(await run('event: x\ndata: {"a":1}\n\n')).toEqual([{ event: "x", data: '{"a":1}' }]);
    const r = await run("data: hi\n\n");
    expect(r).toHaveLength(1);
    expect(r[0].event).toBeUndefined();
    expect(r[0].data).toBe("hi");
  });

  it("SSE-2: multi-line data, CRLF, comments, no-space colon", async () => {
    expect(await run("data: a\ndata: b\n\n")).toEqual([{ event: undefined, data: "a\nb" }]);
    expect(await run("event: e\r\ndata: 1\r\n\r\n")).toEqual([{ event: "e", data: "1" }]);
    expect(await run(": keep-alive\n\n\n: c\ndata: z\n\n")).toEqual([{ event: undefined, data: "z" }]);
    expect(await run("data:nospace\n\n")).toEqual([{ event: undefined, data: "nospace" }]);
  });

  it("SSE-3: identical output for any chunking, incl. split multi-byte char", async () => {
    const text = 'event: a\r\ndata: {"t":"café €"}\r\n\r\n: ping\n\ndata: x\ndata: y\n\ndata: [DONE]\n\n';
    const bytes = enc.encode(text);
    const expected = [
      { event: "a", data: '{"t":"café €"}' },
      { event: undefined, data: "x\ny" },
      { event: undefined, data: "[DONE]" },
    ];
    const results = await Promise.all([1, 3, 17, bytes.length].map((n) => collect(streamOf(bytes, n))));
    for (const r of results) expect(r).toEqual(expected);
  });

  it("SSE-4: trailing event without blank line is emitted; [DONE] passes through", async () => {
    expect(await run("data: last")).toEqual([{ event: undefined, data: "last" }]);
    expect(await run("data: [DONE]\n\n")).toEqual([{ event: undefined, data: "[DONE]" }]);
  });

  it("SSE-5: abort mid-stream ends with AbortError", async () => {
    const ac = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("data: one\n\n"));
      }, // never closes: a hanging stream
    });
    const seen: string[] = [];
    const p = (async () => {
      for await (const e of parseSseStream(body, ac.signal)) {
        seen.push(e.data);
        ac.abort();
      }
    })();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["one"]);
  });
});
