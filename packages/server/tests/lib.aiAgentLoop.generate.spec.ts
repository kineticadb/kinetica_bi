// 142 generate mode: agentLoop beforeFinish hook (nudge once, no extra tool step).
import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { runAgentLoop, type AgentLoopInput, type AgentLoopDeps, type AiProgressEvent } from "../src/lib/ai/agentLoop";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { createJsonActionProvider } from "../src/lib/ai/providers/jsonAction";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { createShadow } from "../src/lib/ai/shadow";
import { part } from "../src/lib/ai/outbound";
import type { LiveSchemaPort, ReadTool, ToolContext } from "../src/lib/ai/tools/types";
import type { LlmEvent } from "../src/lib/ai/provider";
import { generateNudge } from "../src/lib/ai/generateMode";

const call = (id: string, name: string, args: unknown): LlmEvent => ({ type: "tool_call", id, name, argsRaw: JSON.stringify(args) });
const DONE_TOOLS: LlmEvent = { type: "done", finish: "tool_calls" };
const DONE: LlmEvent = { type: "done", finish: "stop" };
const turn = (...calls: LlmEvent[]): LlmEvent[] => [...calls, DONE_TOOLS];
const final = (t: string): LlmEvent[] => [{ type: "text_delta", text: t }, DONE];
const addW = (id: string, tempId = -1, col = "fare_amount") => call(id, "add_widget", { tempId, type: "bar", title: "T", tableId: 7, metric: col, aggregation: "sum", groupBy: "vendor_id" });
const describeT = (id: string) => call(id, "describe_table", { tableId: 7 });

function setup(steps: ScriptStep[], o: { maxToolSteps?: number; timeoutMs?: number; extraTools?: ReadTool[]; deps?: Partial<AgentLoopDeps>; perms?: ReadonlySet<string>; maxNewWidgets?: number; approvals?: { removeSaved?: boolean } } = {}) {
  const describe = vi.fn(async (id: number) =>
    id === 7
      ? { ok: true as const, table: { id: 7, schema: "demo", name: "nyctaxi", columns: [{ name: "fare_amount" }, { name: "vendor_id" }] } }
      : { ok: false as const });
  const liveSchema: LiveSchemaPort = { describe };
  const provider = new ScriptedProvider(steps);
  const registry = buildToolRegistry({ dataAccess: "schema", extraTools: o.extraTools });
  const toolCtx: ToolContext = {
    username: "ann", dashboardId: 1, dataAccess: "schema", liveSchema,
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => [7], registeredTables: () => [],
  };
  const shadow = createShadow({ widgets: [{ id: 42, type: "map", title: "Trips", tableId: 7 }], layers: [], dynamicViews: [], filters: [] });
  const input: AgentLoopInput = {
    system: [part.system("sys")], messages: [{ role: "user", parts: [part.user("q")] }], registry, toolCtx,
    gateway: { username: "ann", dashboardId: 1, shadow, liveSchema, getPermissions: () => o.perms ?? new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => [7], ...(o.approvals ? { approvals: o.approvals } : {}) },
    maxNewWidgets: o.maxNewWidgets ?? 6,
    dataAccess: "schema", maxToolSteps: o.maxToolSteps ?? 10, timeoutMs: o.timeoutMs ?? 60_000,
  };
  const events: AiProgressEvent[] = [];
  const sleeps: number[] = [];
  const clock = { t: 1_000 };
  const deps: AgentLoopDeps = {
    provider, signal: new AbortController().signal, now: () => clock.t,
    sleep: async (ms) => { sleeps.push(ms); }, checkSession: () => {}, emit: (e) => events.push(e), ...o.deps,
  };
  return { input, deps, provider, events, sleeps, clock, describe };
}
const run = (s: ReturnType<typeof setup>) => runAgentLoop(s.input, s.deps);


const hook = (n: number) => ({ addedWidgets }: { addedWidgets: number }) => (addedWidgets < n ? generateNudge(addedWidgets) : null);
const twoThenTwo = (): ScriptStep[] => [
  turn(addW("a", -1), addW("b", -2)), final("done"), turn(addW("c", -3), addW("d", -4)), final("Built it"),
];
const addOps = (r: { ops: { op: string }[] }) => r.ops.filter((o) => o.op === "add_widget");

describe("runAgentLoop beforeFinish", () => {
  it("GENNUDGE-1 no hook behaves as today", async () => {
    const s = setup([turn(addW("a", -1)), final("Added.")]);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(r.text).toBe("Added.");
    expect(addOps(r)).toHaveLength(1);
    expect(r.steps).toBe(1);
    expect(s.provider.requests).toHaveLength(2);
  });

  it("GENNUDGE-2 nudge then success, no step cost", async () => {
    const s = setup(twoThenTwo(), { maxNewWidgets: 8 });
    s.input.beforeFinish = hook(4);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(r.text).toBe("Built it");
    expect(addOps(r)).toHaveLength(4);
    expect(r.steps).toBe(4);
    const m = s.provider.requests[2].messages;
    expect(m[m.length - 1]).toEqual({ role: "user", text: generateNudge(2) });
    expect(m[m.length - 2]).toMatchObject({ role: "assistant", text: "done" });
  });

  it("GENNUDGE-3 at most once", async () => {
    const s = setup([turn(addW("a", -1), addW("b", -2)), final("done"), final("still done")], { maxNewWidgets: 8 });
    const spy = vi.fn(() => "more please");
    s.input.beforeFinish = spy;
    const r = await run(s);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("ok");
    expect(r.text).toBe("still done");
    expect(addOps(r)).toHaveLength(2);
  });

  it("GENNUDGE-4 null hook result adds no request", async () => {
    const steps = (): ScriptStep[] => [turn(addW("a", -1)), final("ok")];
    const base = setup(steps());
    await run(base);
    const s = setup(steps());
    s.input.beforeFinish = () => null;
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(s.provider.requests.length).toBe(base.provider.requests.length);
  });

  it("GENNUDGE-5 json-action decorator accepts the nudge shape", async () => {
    const jtext = (o: unknown): LlmEvent[] => [{ type: "text_delta", text: JSON.stringify(o) }, DONE];
    const wa = (t: number) => jtext({ tool: "add_widget", args: { tempId: t, type: "bar", title: "T", tableId: 7, metric: "fare_amount", aggregation: "sum", groupBy: "vendor_id" } });
    const s = setup([wa(-1), wa(-2), jtext({ final: "done" }), wa(-3), wa(-4), jtext({ final: "Built it" })], { maxNewWidgets: 8 });
    s.deps = { ...s.deps, provider: createJsonActionProvider(s.provider) };
    s.input.beforeFinish = hook(4);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    expect(addOps(r)).toHaveLength(4);
    expect(r.text).toBe("Built it");
  });

  it("GENNUDGE-6 empty turn text pushes no empty assistant message", async () => {
    const s = setup([turn(addW("a", -1), addW("b", -2)), [DONE], turn(addW("c", -3), addW("d", -4)), final("Built it")], { maxNewWidgets: 8 });
    s.input.beforeFinish = hook(4);
    const r = await run(s);
    expect(r.outcome).toBe("ok");
    const m = s.provider.requests[2].messages;
    expect(m[m.length - 1]).toEqual({ role: "user", text: generateNudge(2) });
    expect(m[m.length - 2]).toMatchObject({ role: "tool" });
  });
});
