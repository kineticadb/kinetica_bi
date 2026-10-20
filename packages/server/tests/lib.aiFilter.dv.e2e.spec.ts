// Phase 139 gap-fix A: apply_filter / clear_filter must accept an AI (negative-id) dynamic view source.
// Scripted provider + real tools + real gateway + real loop; no network.
import { describe, it, expect, vi, afterEach } from "vitest";
import { type AskRequest } from "@kinetica-bi/shared";
import { runAgentLoop, type AgentLoopInput, type AgentLoopDeps } from "../src/lib/ai/agentLoop";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { createShadow } from "../src/lib/ai/shadow";
import { part } from "../src/lib/ai/outbound";
import type { LiveSchemaPort, ToolContext } from "../src/lib/ai/tools/types";
import type { LlmEvent } from "../src/lib/ai/provider";
import { forbidProviderNetwork } from "./helpers/aiTestKit";

afterEach(() => vi.unstubAllGlobals());
const call = (id: string, name: string, args: unknown): LlmEvent => ({ type: "tool_call", id, name, argsRaw: JSON.stringify(args) });
const turn = (...calls: LlmEvent[]): LlmEvent[] => [...calls, { type: "done", finish: "tool_calls" }];
const final = (t: string): LlmEvent[] => [{ type: "text_delta", text: t }, { type: "done", finish: "stop" }];

type Snap = AskRequest["snapshot"];
const T5 = { id: 5, schema: "demo", name: "trips", columns: [{ name: "vendor", type: "string" }, { name: "fare", type: "double" }] };
const snap: Snap = {
  widgets: [{ id: 44, type: "bar", title: "Per vendor", tableId: 5, dynamicViewId: -3, layout: { x: 0, y: 0, w: 18, h: 30 } }],
  layers: [],
  dynamicViews: [{ id: -3, name: "Trips by vendor", baseTableId: 5, aggregated: true, columns: [{ name: "vendor", type: "string" }, { name: "trips", type: "long" }] }],
  filters: [],
} as Snap;

async function run(steps: ScriptStep[]) {
  forbidProviderNetwork();
  const liveSchema: LiveSchemaPort = { describe: async (id) => (id === 5 ? { ok: true as const, table: T5 } : { ok: false as const }) };
  const toolCtx: ToolContext = {
    username: "ann", dashboardId: 1, dataAccess: "schema", liveSchema,
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => [5], registeredTables: () => [{ id: 5, schema: "demo", name: "trips" }],
  };
  const input: AgentLoopInput = {
    system: [part.system("sys")], messages: [{ role: "user", parts: [part.user("q")] }], registry: buildToolRegistry({ dataAccess: "schema" }), toolCtx,
    gateway: {
      username: "ann", dashboardId: 1, shadow: createShadow(snap), liveSchema,
      getPermissions: () => new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => [5],
    },
    maxNewWidgets: 6, dataAccess: "schema", maxToolSteps: 20, timeoutMs: 60_000,
  };
  const deps: AgentLoopDeps = { provider: new ScriptedProvider(steps), signal: new AbortController().signal, now: () => 1_000, sleep: async () => {}, checkSession: () => {}, emit: () => {} };
  return runAgentLoop(input, deps);
}

describe("AI filters on AI dynamic views (139 gap A)", () => {
  it("GAPA-1 tool schema accepts a negative dynamicViewId, rejects 0, stays flat", () => {
    const reg = buildToolRegistry({ dataAccess: "schema" });
    for (const name of ["apply_filter", "clear_filter"]) {
      const t = reg.byName.get(name);
      expect(t, name).toBeDefined();
      const args = (t as { args: { safeParse: (v: unknown) => { success: boolean } } }).args;
      expect(args.safeParse({ dynamicViewId: -3, column: "vendor" }).success).toBe(true);
      expect(args.safeParse({ dynamicViewId: 90, column: "vendor" }).success).toBe(true);
      expect(args.safeParse({ dynamicViewId: 0, column: "vendor" }).success).toBe(false);
      expect(args.safeParse({ dynamicViewId: 1.5, column: "vendor" }).success).toBe(false);
    }
    const flat = JSON.stringify(reg.specs.filter((x) => x.name === "apply_filter" || x.name === "clear_filter"));
    expect(flat).not.toMatch(/anyOf|oneOf|allOf|\$ref|\$defs/);
  });

  it("GAPA-2 apply_filter on AI view -3 passes the gateway and stamps a dynamicView source", async () => {
    const r = await run([turn(call("a", "apply_filter", { dynamicViewId: -3, column: "vendor", value: "CMT" })), final("Done.")]);
    expect(r.ops).toEqual([{ op: "apply_filter", source: { kind: "dynamicView", id: -3 }, filters: [{ column: "vendor", operator: "eq", value: "CMT", dataType: "string" }] }]);
  });

  it("GAPA-3 an unknown negative id is refused", async () => {
    const r = await run([turn(call("a", "apply_filter", { dynamicViewId: -9, column: "vendor", value: "CMT" })), final("Sorry.")]);
    expect(r.ops).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ stage: "reference", reasons: ["dynamic view -9 does not exist"] });
  });

  it("GAPA-4 clear_filter on AI view -3 after filtering it", async () => {
    const r = await run([
      turn(call("a", "apply_filter", { dynamicViewId: -3, column: "vendor", value: "CMT" })),
      turn(call("b", "clear_filter", { dynamicViewId: -3 })),
      final("Done."),
    ]);
    expect(r.ops.map((o) => o.op)).toEqual(["apply_filter", "clear_filter"]);
  });
});
