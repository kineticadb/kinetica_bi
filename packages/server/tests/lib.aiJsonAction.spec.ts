// JSON action-plan fallback decorator (AI_TOOL_MODE=json).
import { describe, it, expect } from "vitest";
import { createJsonActionProvider, extractFirstJsonObject } from "../src/lib/ai/providers/jsonAction";
import { buildOutboundRequest, isOutboundRequest, part, type OutboundRequest } from "../src/lib/ai/outbound";
import type { LlmEvent, LlmMessage, LlmProvider } from "../src/lib/ai/provider";

const TOOLS = [
  { name: "describe_table", description: "Describe a table", jsonSchema: { type: "object", properties: { tableId: { type: "integer" } } } },
  { name: "list_tables", description: "List tables", jsonSchema: { type: "object", properties: {} } },
];

function fakeInner(script: LlmEvent[]) {
  const seen: OutboundRequest[] = [];
  const inner: LlmProvider = {
    id: "fake",
    model: "m",
    capabilities: { nativeTools: true, parallelTools: false, streaming: true, usageInStream: false, forcedToolChoice: false, opaqueReplay: false },
    async *complete(r) {
      seen.push(r);
      for (const e of script) yield e;
    },
  };
  return { inner, seen };
}
const textReply = (t: string, finish: "stop" | "length" = "stop"): LlmEvent[] => [
  { type: "text_delta", text: t.slice(0, 5) },
  { type: "text_delta", text: t.slice(5) },
  { type: "done", finish },
];
function req(messages: Parameters<typeof buildOutboundRequest>[0]["messages"] = [{ role: "user", parts: [part.user("q")] }]) {
  return buildOutboundRequest({ system: [part.system("BASE")], messages, tools: TOOLS, dataAccess: "schema" });
}
async function run(script: LlmEvent[], r = req()) {
  const { inner, seen } = fakeInner(script);
  const p = createJsonActionProvider(inner);
  const out: LlmEvent[] = [];
  for await (const e of p.complete(r, new AbortController().signal)) out.push(e);
  return { out, seen, p };
}

describe("json action provider", () => {
  it("JSA-1: inner gets tools[] empty and a system text with every tool + schema + instruction", async () => {
    const { seen, p } = await run(textReply('{"final":"x"}'));
    expect(p.id).toBe("json-action(fake)");
    expect(p.capabilities.nativeTools).toBe(false);
    expect(isOutboundRequest(seen[0])).toBe(true);
    expect(seen[0].tools.length).toBe(0);
    expect(seen[0].system.startsWith("BASE")).toBe(true);
    for (const t of TOOLS) {
      expect(seen[0].system).toContain(t.name);
      expect(seen[0].system).toContain(JSON.stringify(t.jsonSchema));
    }
    expect(seen[0].system).toContain('{"tool":"<name>","args":{...}}');
    expect(seen[0].system).toContain('{"final":"<text>"}');
  });

  it("JSA-2: fenced tool reply becomes a tool_call", async () => {
    const { out } = await run(textReply('```json\n{"tool":"describe_table","args":{"tableId":3}}\n```'));
    const tc = out.find((e) => e.type === "tool_call") as Extract<LlmEvent, { type: "tool_call" }>;
    expect(tc.name).toBe("describe_table");
    expect(tc.argsRaw).toBe('{"tableId":3}');
    expect(tc.id.length).toBeGreaterThan(3);
    expect(out.some((e) => e.type === "text_delta")).toBe(false);
    expect(out[out.length - 1]).toEqual({ type: "done", finish: "tool_calls" });
  });

  it("JSA-3: final with surrounding prose", async () => {
    const { out } = await run(textReply('Sure! {"final":"Done."} trailing'));
    expect(out).toEqual([
      { type: "text_delta", text: "Done." },
      { type: "done", finish: "stop" },
    ]);
  });

  it("JSA-4: unparseable / wrong-shaped replies fall back to raw text; strings with braces parse", async () => {
    const plain = await run(textReply("just words"));
    expect(plain.out).toEqual([
      { type: "text_delta", text: "just words" },
      { type: "done", finish: "stop" },
    ]);
    const bad = await run(textReply('{"tool": 5}'));
    expect(bad.out).toEqual([
      { type: "text_delta", text: '{"tool": 5}' },
      { type: "done", finish: "stop" },
    ]);
    const nested = await run(textReply('{"final":"a } b"}'));
    expect(nested.out[0]).toEqual({ type: "text_delta", text: "a } b" });
    expect(extractFirstJsonObject('x {"a":"}{"} y')).toEqual({ a: "}{" });
    expect(extractFirstJsonObject("{broken {\"ok\":1}")).toEqual({ ok: 1 });
    expect(extractFirstJsonObject("nothing")).toBeUndefined();
    expect(extractFirstJsonObject("[1,2]")).toBeUndefined();
  });

  it("JSA-5: history rewritten to plain text turns", async () => {
    const r = req([
      { role: "user", parts: [part.user("q")] },
      { role: "assistant", toolCalls: [{ id: "c1", name: "describe_table", argsJson: '{"tableId":3}' }], providerState: { opaque: 1 } },
      { role: "tool", toolCallId: "c1", name: "describe_table", parts: [part.schema("cols a,b")] },
    ]);
    const { seen } = await run(textReply('{"final":"k"}'), r);
    const ms = seen[0].messages as readonly LlmMessage[];
    expect(ms.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(ms[1]).toEqual({ role: "assistant", text: '{"tool":"describe_table","args":{"tableId":3}}' });
    expect(ms[2]).toEqual({ role: "user", text: "Tool result (describe_table): cols a,b" });
    expect(JSON.stringify(ms)).not.toContain("toolCalls");
  });

  it("JSA-6: usage and error pass through unchanged", async () => {
    const u: LlmEvent = { type: "usage", inputTokens: 3, outputTokens: 4 };
    const a = await run([u, ...textReply('{"final":"z"}')]);
    expect(a.out[0]).toEqual(u);
    const e: LlmEvent = { type: "error", kind: "rate_limited", status: 429, retryAfterMs: 2000 };
    const b = await run([{ type: "text_delta", text: "par" }, e]);
    expect(b.out).toEqual([e]);
  });

  it("JSA-OLL-1: Ollama UAT shape {\"<tool>\": {...}} becomes a call when the key is a known tool; nulls count as absent", async () => {
    const { out } = await run(textReply('{"describe_table":{"tableId":3,"note":null}}'));
    const tc = out.find((e) => e.type === "tool_call") as Extract<LlmEvent, { type: "tool_call" }>;
    expect(tc.name).toBe("describe_table");
    expect(JSON.parse(tc.argsRaw)).toEqual({ tableId: 3 });
  });

  it("JSA-OLL-2: an unknown single key stays text; the usual shape also drops nulls", async () => {
    const unknown = await run(textReply('{"drop_everything":{"x":1}}'));
    expect(unknown.out.some((e) => e.type === "tool_call")).toBe(false);
    const usual = await run(textReply('{"tool":"describe_table","args":{"tableId":3,"label":null}}'));
    const tc = usual.out.find((e) => e.type === "tool_call") as Extract<LlmEvent, { type: "tool_call" }>;
    expect(JSON.parse(tc.argsRaw)).toEqual({ tableId: 3 });
  });
});
