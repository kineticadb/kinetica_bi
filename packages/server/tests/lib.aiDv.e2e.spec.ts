// Phase 139-10: scripted-provider end-to-end proofs for AI dynamic views over the SHIPPING registry, gateway and agent loop.
// Only the provider (ScriptedProvider) and the live schema port are stubbed. No network, no real provider, no Kinetica; .env is not read.
// The gateway's AI_DV_* limits come from parseAiConfig(env) -> gatewayDvLimits (the same helper runAnswer uses).
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { type AskRequest } from "@kinetica-bi/shared";
import { runAgentLoop, type AgentLoopInput, type AgentLoopDeps, type AgentLoopResult } from "../src/lib/ai/agentLoop";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { createShadow } from "../src/lib/ai/shadow";
import { part } from "../src/lib/ai/outbound";
import { parseAiConfig } from "../src/lib/aiConfig";
import { gatewayDvLimits } from "../src/lib/ai/dvDeps";
import type { LiveSchemaPort, ToolContext } from "../src/lib/ai/tools/types";
import type { LlmEvent } from "../src/lib/ai/provider";
import { forbidProviderNetwork } from "./helpers/aiTestKit";

afterEach(() => vi.unstubAllGlobals());

const call = (id: string, name: string, args: unknown): LlmEvent => ({ type: "tool_call", id, name, argsRaw: JSON.stringify(args) });
const DONE_TOOLS: LlmEvent = { type: "done", finish: "tool_calls" };
const DONE: LlmEvent = { type: "done", finish: "stop" };
const turn = (...calls: LlmEvent[]): LlmEvent[] => [...calls, DONE_TOOLS];
const final = (t: string): LlmEvent[] => [{ type: "text_delta", text: t }, DONE];

type Snap = AskRequest["snapshot"];
const T5 = { id: 5, schema: "demo", name: "trips", columns: [
  { name: "vendor", type: "string" }, { name: "fare", type: "double" }, { name: "zone_id", type: "int" }, { name: "pickup_datetime", type: "timestamp" }] };
const T6 = { id: 6, schema: "demo", name: "zones", columns: [{ name: "id", type: "int" }, { name: "borough", type: "string" }] };
const empty = (o: Partial<Snap> = {}): Snap => ({ widgets: [], layers: [], dynamicViews: [], filters: [], ...o }) as Snap;
const SECRET = "SECRETVAL_139";

const summary = { tempId: -1, name: "Trips by hour", baseTableId: 5, groupBy: [{ column: "pickup_datetime", bucket: "hour", as: "pickup_hour" }], aggregates: [{ fn: "count", as: "trips" }] };

const cfgEnv = { AI_ENABLED: "true", AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://localhost:11434/v1", AI_MODEL: "m" };
const limitsFrom = (extra: Record<string, string> = {}) => {
  const r = parseAiConfig({ ...cfgEnv, ...extra });
  if (!r.enabled) throw new Error("config invalid in test");
  return gatewayDvLimits(r.config);
};

function setup(steps: ScriptStep[], o: { snapshot?: Snap; limits?: ReturnType<typeof limitsFrom>; approvals?: { removeSaved?: boolean } } = {}) {
  const liveSchema: LiveSchemaPort = {
    describe: async (id) => {
      const t = [T5, T6].find((x) => x.id === id);
      return t ? { ok: true as const, table: t } : { ok: false as const };
    },
  };
  const provider = new ScriptedProvider(steps);
  const toolCtx: ToolContext = {
    username: "ann", dashboardId: 1, dataAccess: "schema", liveSchema,
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => [5, 6], registeredTables: () => [{ id: 5, schema: "demo", name: "trips" }],
  };
  const input: AgentLoopInput = {
    system: [part.system("sys")], messages: [{ role: "user", parts: [part.user("q")] }], registry: buildToolRegistry({ dataAccess: "schema" }), toolCtx,
    gateway: {
      username: "ann", dashboardId: 1, shadow: createShadow(o.snapshot ?? empty()), liveSchema,
      getPermissions: () => new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => [5, 6],
      aiDv: o.limits ?? limitsFrom(),
      ...(o.approvals ? { approvals: o.approvals } : {}),
      dynamicViewInfo: (id) => (id === 90 ? { name: "Saved", columns: [{ name: "vendor", type: "string" }], sourceTableId: 5 } : undefined),
    },
    maxNewWidgets: 6, dataAccess: "schema", maxToolSteps: 20, timeoutMs: 60_000,
  };
  const deps: AgentLoopDeps = { provider, signal: new AbortController().signal, now: () => 1_000, sleep: async () => {}, checkSession: () => {}, emit: () => {} };
  return { input, deps, provider };
}
const run = async (steps: ScriptStep[], o?: Parameters<typeof setup>[1]): Promise<AgentLoopResult & { requests: ScriptedProvider["requests"] }> => {
  forbidProviderNetwork();
  const s = setup(steps, o);
  const r = await runAgentLoop(s.input, s.deps);
  return { ...r, requests: s.provider.requests };
};

describe("AI dynamic views e2e (scripted provider, real tools + gateway + loop)", () => {
  it("E2EDV-1 create a summary view, then chart it", async () => {
    const r = await run([
      turn(call("a", "add_dynamic_view", summary)),
      turn(call("b", "add_widget", { tempId: -2, type: "bar", title: "Trips per hour", dynamicViewId: -1, metric: "trips", aggregation: "sum", groupBy: "pickup_hour" })),
      final("Done."),
    ]);
    expect(r.ops).toHaveLength(2);
    const dv = r.ops[0] as { op: string; columns: { name: string }[]; maxRecords: number; aggregated: boolean };
    expect(dv.op).toBe("add_dynamic_view");
    expect(dv.columns.map((c) => c.name)).toEqual(["pickup_hour", "trips"]);
    expect(dv.maxRecords).toBe(100000);
    expect(dv.aggregated).toBe(true);
    expect(r.ops[1]).toMatchObject({ op: "add_widget", config: { dynamicViewId: -1 } });
    expect(r.applied[0]).toBe('Added dynamic view "Trips by hour"');
  });

  it("E2EDV-2 change a view in one answer: add, rebind, remove", async () => {
    const snapshot = empty({
      widgets: [{ id: 42, type: "bar", title: "Per vendor", tableId: 5, dynamicViewId: -3, layout: { x: 0, y: 0, w: 18, h: 30 }, binding: { groupByColumn: "vendor", metric: "trips" } }],
      dynamicViews: [{ id: -3, name: "Old", baseTableId: 5, aggregated: true, columns: [{ name: "vendor", type: "string" }, { name: "trips", type: "long" }] }],
    } as Partial<Snap>);
    const r = await run([
      turn(call("a", "add_dynamic_view", { tempId: -4, name: "New", baseTableId: 5, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "count", as: "trips" }] })),
      turn(call("b", "edit_widget", { id: 42, dynamicViewId: -4 })),
      turn(call("c", "remove_dynamic_view", { id: -3 })),
      final("Done."),
    ], { snapshot });
    expect(r.ops.map((o) => o.op)).toEqual(["add_dynamic_view", "patch", "remove_dynamic_view"]);
    expect("drop" in r.ops[2]).toBe(false);
    expect("repoint" in r.ops[2]).toBe(false);
  });

  it("E2EDV-3 a repeated unknown column is skipped once with a did-you-mean", async () => {
    const bad = { tempId: -1, name: "v", baseTableId: 5, columns: [{ column: "fair" }] };
    const r = await run([turn(call("a", "add_dynamic_view", bad)), turn(call("b", "add_dynamic_view", bad)), final("Skipped.")]);
    expect(r.ops).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reasons.join(" ")).toContain("fare");
  });

  it("E2EDV-4 AI_DV_* limits from the config reach the gateway: session cap, join cap, record ceiling", async () => {
    const five = [-10, -11, -12, -13, -14].map((id) => ({ id, name: `V${-id}` }));
    const full = await run([turn(call("a", "add_dynamic_view", summary)), final("No.")], { snapshot: empty({ dynamicViews: five } as Partial<Snap>) });
    expect(full.ops).toEqual([]);
    expect(full.skipped[0]).toMatchObject({ stage: "cap" });
    expect(full.skipped[0].reasons).toEqual(["you already have 5 session views (limit 5); remove one first"]);
    // a non-default env value is what the runtime enforces (default would allow a second view)
    const two = await run([turn(call("a", "add_dynamic_view", summary)), final("No.")], {
      snapshot: empty({ dynamicViews: [{ id: -10, name: "V" }, { id: -11, name: "W" }] } as Partial<Snap>),
      limits: limitsFrom({ AI_DV_MAX_PER_SESSION: "2" }),
    });
    expect(two.skipped[0].reasons).toEqual(["you already have 2 session views (limit 2); remove one first"]);
    const joined = { tempId: -1, name: "J", baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] }], columns: [{ column: "vendor" }] };
    const noJoin = await run([turn(call("a", "add_dynamic_view", joined)), final("No.")], { limits: limitsFrom({ AI_DV_MAX_JOINS: "0" }) });
    expect(noJoin.skipped[0]).toMatchObject({ stage: "cap" });
    expect(noJoin.skipped[0].reasons).toEqual(["a view can join at most 0 tables"]);
    const joinOk = await run([turn(call("a", "add_dynamic_view", joined)), final("Ok.")]);
    expect(joinOk.ops).toHaveLength(1);
    const small = await run([turn(call("a", "add_dynamic_view", summary)), final("Ok.")], { limits: limitsFrom({ AI_DV_MAX_RECORDS: "500" }) });
    expect((small.ops[0] as { maxRecords: number }).maxRecords).toBe(500);
  });

  it("E2EDV-4b runAnswer builds the gateway limits with gatewayDvLimits(config) (structural; runAnswer needs a DB so it is not driven here)", () => {
    const src = readFileSync(new URL("../src/lib/ai/runAnswer.ts", import.meta.url), "utf8");
    expect(src).toContain("aiDv: gatewayDvLimits(config)");
    expect(src).toContain("sourceTableId: r.source_table_id");
  });

  it("E2EDV-5 an SQL argument is refused at the shape stage", async () => {
    const r = await run([
      turn(call("a", "add_dynamic_view", { ...summary, sql: "SELECT 1" })),
      turn(call("b", "add_dynamic_view", { ...summary, sql: "SELECT 1" })),
      final("Skipped."),
    ]);
    expect(r.ops).toEqual([]);
    expect(r.skipped[0].stage).toBe("shape");
  });

  it("E2EDV-6 removing a saved view asks first", async () => {
    const r = await run([turn(call("a", "remove_dynamic_view", { id: 90 })), final("Remove it?")], {
      snapshot: empty({ dynamicViews: [{ id: 90, name: "Saved" }] } as Partial<Snap>),
    });
    expect(r.ops).toEqual([]);
    expect(r.clarifications[0].kind).toBe("confirm_remove");
    const ok = await run([turn(call("a", "remove_dynamic_view", { id: 90 })), final("Removed.")], {
      snapshot: empty({ dynamicViews: [{ id: 90, name: "Saved" }] } as Partial<Snap>),
      approvals: { removeSaved: true },
    });
    expect(ok.ops).toHaveLength(1);
  });

  it("E2EDV-7 a filter value reaches the op but never a tool result, label or skipped reason", async () => {
    const withFilter = { ...summary, filters: [{ column: "vendor", value: SECRET }] };
    const bad = { tempId: -2, name: "B", baseTableId: 5, columns: [{ column: "vendr" }], filters: [{ column: "vendr", value: SECRET }] };
    const r = await run([turn(call("a", "add_dynamic_view", withFilter)), turn(call("b", "add_dynamic_view", bad)), turn(call("c", "add_dynamic_view", bad)), final("Done.")]);
    expect(r.ops).toHaveLength(1);
    expect(JSON.stringify(r.ops[0])).toContain(SECRET);
    expect(r.skipped).toHaveLength(1);
    expect(JSON.stringify([r.applied, r.skipped])).not.toContain(SECRET);
    const toolResults = r.requests.flatMap((q) => q.messages.filter((m) => m.role === "tool"));
    expect(toolResults.length).toBeGreaterThan(0);
    for (const m of toolResults) expect(JSON.stringify(m)).not.toContain(SECRET);
  });
});
