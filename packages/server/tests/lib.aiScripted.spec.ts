import { describe, it, expect } from "vitest";
import { ScriptedProvider, RecordingProvider } from "../src/lib/ai/providers/scripted";
import { buildOutboundRequest, part, type OutboundRequest } from "../src/lib/ai/outbound";
import type { LlmEvent } from "../src/lib/ai/provider";

const req = (q = "hi"): OutboundRequest =>
  buildOutboundRequest({ system: [part.system("s")], messages: [{ role: "user", parts: [part.user(q)] }], tools: [], dataAccess: "schema" });
const collect = async (it: AsyncIterable<LlmEvent>) => { const out: LlmEvent[] = []; for await (const e of it) out.push(e); return out; };
const sig = () => new AbortController().signal;
const A: LlmEvent[] = [{ type: "text_delta", text: "a" }, { type: "done", finish: "stop" }];
const B: LlmEvent[] = [{ type: "text_delta", text: "b" }, { type: "done", finish: "stop" }];

describe("scripted providers", () => {
  it("SCR-1 yields step i on call i and records requests", async () => {
    const p = new ScriptedProvider([A, B]);
    const r1 = req("1"), r2 = req("2");
    expect(await collect(p.complete(r1, sig()))).toEqual(A);
    expect(await collect(p.complete(r2, sig()))).toEqual(B);
    expect(p.requests).toEqual([r1, r2]);
  });
  it("SCR-2 throws when calls exceed the script", async () => {
    const p = new ScriptedProvider([A]);
    await collect(p.complete(req(), sig()));
    await expect(collect(p.complete(req(), sig()))).rejects.toThrow(/script/i);
  });
  it("SCR-3 function steps receive request and index", async () => {
    const p = new ScriptedProvider([(r, i) => [{ type: "text_delta", text: `${r.messages.length}:${i}` }, { type: "done", finish: "stop" }]]);
    expect((await collect(p.complete(req(), sig())))[0]).toEqual({ type: "text_delta", text: "1:0" });
  });
  it("SCR-4 rejects unbranded requests", async () => {
    const p = new ScriptedProvider([A]);
    await expect(collect(p.complete({ system: "x", messages: [], tools: [], dataAccess: "schema" } as unknown as OutboundRequest, sig()))).rejects.toThrow(/OutboundRequest/);
  });
  it("SCR-5 aborted signal yields error aborted", async () => {
    const c = new AbortController(); c.abort();
    const p = new ScriptedProvider([A]);
    expect(await collect(p.complete(req(), c.signal))).toEqual([{ type: "error", kind: "aborted" }]);
  });
  it("SCR-6 RecordingProvider passes events through and records", async () => {
    const inner = new ScriptedProvider([A]);
    const rec = new RecordingProvider(inner);
    const r = req();
    expect(await collect(rec.complete(r, sig()))).toEqual(A);
    expect(rec.requests).toEqual([r]);
    expect(rec.id).toBe(inner.id);
  });
});
