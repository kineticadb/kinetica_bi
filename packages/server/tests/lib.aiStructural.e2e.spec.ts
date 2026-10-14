// Phase 136-09: scripted-provider end-to-end proofs over the SHIPPING registry, gateway and agent loop.
// Only the provider (ScriptedProvider) and the live schema port are stubbed. No network, no real provider.
import { describe, it, expect, vi, afterEach } from "vitest";
import { AI_DEFAULT_SIZE, type AiOp, type AskRequest } from "@kinetica-bi/shared";
import { runAgentLoop, type AgentLoopInput, type AgentLoopDeps, type AgentLoopResult } from "../src/lib/ai/agentLoop";
import { ScriptedProvider, type ScriptStep } from "../src/lib/ai/providers/scripted";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { createShadow } from "../src/lib/ai/shadow";
import { part } from "../src/lib/ai/outbound";
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
const COLS = [
  { name: "fare_amount", type: "double" }, { name: "total_amount", type: "double" }, { name: "vendor_id", type: "string" },
  { name: "payment_type", type: "string" }, { name: "pickup_latitude", type: "double" }, { name: "pickup_longitude", type: "double" },
];
const SNAP: Snap = {
  widgets: [
    { id: 12, type: "bar", title: "Revenue", tableId: 5, layout: { x: 0, y: 0, w: 18, h: 30 } },
    { id: 20, type: "map", title: "Trips map", layout: { x: 18, y: 0, w: 18, h: 45 } },
  ],
  layers: [
    { id: 30, widgetId: 20, title: "Trips heat", tableId: 5, renderMode: "heatmap" },
    { id: 31, widgetId: 20, title: "Zones", renderMode: "raster" },
  ],
  dynamicViews: [],
  filters: [],
};
const NO_MAP_SNAP: Snap = { widgets: [SNAP.widgets[0]], layers: [], dynamicViews: [], filters: [] };

function setup(steps: ScriptStep[], o: { snapshot?: Snap; maxNewWidgets?: number; approvals?: { removeSaved?: boolean } } = {}) {
  const liveSchema: LiveSchemaPort = {
    describe: async (id) => (id === 5 ? { ok: true as const, table: { id: 5, schema: "demo", name: "trips", columns: COLS } } : { ok: false as const }),
  };
  const provider = new ScriptedProvider(steps);
  const registry = buildToolRegistry({ dataAccess: "schema" });
  const snapshot = o.snapshot ?? SNAP;
  const registeredTables = () => [{ id: 5, schema: "demo", name: "trips" }, { id: 9, schema: "hidden", name: "secret_trips" }];
  const toolCtx: ToolContext = {
    username: "ann", dashboardId: 1, dataAccess: "schema", liveSchema,
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => [5], registeredTables,
  };
  const input: AgentLoopInput = {
    system: [part.system("sys")], messages: [{ role: "user", parts: [part.user("q")] }], registry, toolCtx,
    gateway: {
      username: "ann", dashboardId: 1, shadow: createShadow(snapshot), liveSchema,
      getPermissions: () => new Set(["dashboards:view", "ai:use"]), canViewDashboard: () => true, dashboardTableIds: () => [5],
      ...(o.approvals ? { approvals: o.approvals } : {}),
    },
    maxNewWidgets: o.maxNewWidgets ?? 6, dataAccess: "schema", maxToolSteps: 20, timeoutMs: 60_000,
  };
  const deps: AgentLoopDeps = { provider, signal: new AbortController().signal, now: () => 1_000, sleep: async () => {}, checkSession: () => {}, emit: () => {} };
  return { input, deps, provider, registeredTables };
}
const run = (steps: ScriptStep[], o?: Parameters<typeof setup>[1]): Promise<AgentLoopResult> => {
  forbidProviderNetwork();
  const s = setup(steps, o);
  return runAgentLoop(s.input, s.deps);
};
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const SAVED_RECTS = SNAP.widgets.map((w) => w.layout!);
const addBar = (id: string, tempId: number, metric = "fare_amount", title = "Fare") =>
  call(id, "add_widget", { tempId, type: "bar", title, tableId: 5, metric, aggregation: "avg", groupBy: "payment_type" });

describe("structural e2e (scripted provider, real tools + gateway + loop)", () => {
  it("E2E6-1 add widget: no sql/table/layout in config, placed clear of saved rects", async () => {
    const r = await run([
      turn(call("a", "describe_table", { tableId: 5 })),
      turn(call("b", "add_widget", { tempId: -1, type: "bar", title: "Fare by payment", tableId: 5, metric: "fare_amount", aggregation: "avg", groupBy: "payment_type", colour: "sky" })),
      final("Added."),
    ]);
    expect(r.outcome).toBe("ok");
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0] as Extract<AiOp, { op: "add_widget" }>;
    expect(op.op).toBe("add_widget");
    for (const k of ["sql", "table", "layout"]) expect(op.config).not.toHaveProperty(k);
    expect(op.layout).toBeDefined();
    for (const rect of SAVED_RECTS) expect(overlap(op.layout!, rect)).toBe(false);
    expect(r.applied[0]).toMatch(/Added bar "Fare by payment" (below existing content|at row \d+, column \d+)/);
  });

  it("E2E6-2 edit + retype + rename produce patch, change_widget_type, set_widget_title", async () => {
    const r = await run([
      turn(
        call("a", "edit_widget", { id: 12, aggregation: "max", topN: "25", colour: "amber" }),
        call("b", "change_widget_type", { id: 12, type: "line" }),
        call("c", "rename_widget", { id: 12, title: "Revenue by vendor" }),
      ),
      final("Done."),
    ]);
    expect(r.ops.map((o) => o.op)).toEqual(["patch", "change_widget_type", "set_widget_title"]);
    const patch = r.ops[0] as Extract<AiOp, { op: "patch" }>;
    expect(patch.action.target).toEqual({ kind: "widget", id: 12 });
    expect(Object.keys(patch.action.configPatch).sort()).toEqual(["aggregation", "color", "limit"]);
    expect(r.ops[1]).toMatchObject({ op: "change_widget_type", id: 12, type: "line" });
    expect(r.ops[2]).toMatchObject({ op: "set_widget_title", id: 12, title: "Revenue by vendor" });
  });

  it("E2E6-3 removing saved content needs approval", async () => {
    const steps = (): ScriptStep[] => [turn(call("a", "remove_widget", { id: 12 })), final("ok")];
    const r = await run(steps());
    expect(r.ops).toEqual([]);
    expect(r.clarifications).toHaveLength(1);
    expect(r.clarifications[0].kind).toBe("confirm_remove");
    expect(r.skipped.some((s) => s.stage === "clarification")).toBe(true);
    const r2 = await run(steps(), { approvals: { removeSaved: true } });
    expect(r2.ops).toEqual([{ op: "remove_widget", id: 12 }]);
    expect(r2.clarifications).toEqual([]);
  });

  it("E2E6-4 heatmap add/restyle/hide/remove; raster cannot be restyled", async () => {
    const r = await run([
      turn(
        call("a", "add_heatmap_layer", { tempId: -2, tableId: 5, spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude", ramp: "plasma", weightColumn: "fare_amount" }),
        call("b", "edit_heatmap_layer", { id: 30, ramp: "inferno", blurRadius: 12, opacity: 0.6 }),
        call("c", "set_layer_visibility", { id: 31, visible: false }),
        call("d", "remove_layer", { id: -2 }),
        call("e", "edit_heatmap_layer", { id: 31, ramp: "jet" }),
      ),
      final("Done."),
    ]);
    expect(r.outcome).toBe("ok");
    expect(r.ops.map((o) => o.op)).toEqual(["add_layer", "patch", "patch", "remove_layer"]);
    expect(r.ops[0]).toMatchObject({ op: "add_layer", widgetId: 20, tempId: -2, tableId: 5, renderMode: "heatmap" });
    expect((r.ops[1] as any).action).toEqual({ target: { kind: "layer", id: 30 }, configPatch: { colormap: "inferno", blurRadius: 12, opacity: 0.6 } });
    expect((r.ops[2] as any).action).toEqual({ target: { kind: "layer", id: 31 }, configPatch: { visible: false } });
    expect(r.ops[3]).toEqual({ op: "remove_layer", id: -2 });
    expect(r.clarifications).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].stage).toBe("allow_list");
    expect(r.skipped[0].label).toBe("Change layer 31");
  });

  it("E2E6-5 quiet repair: a nonexistent column fixed in one retry leaves no skipped entry", async () => {
    const s = setup([turn(addBar("a", -1, "fare")), turn(addBar("b", -1, "fare_amount")), final("ok")]);
    const r = await runAgentLoop(s.input, s.deps);
    expect(r.ops).toHaveLength(1);
    expect(r.skipped).toEqual([]);
    const toolMsg = s.provider.requests[1].messages.find((m) => m.role === "tool") as any;
    expect(toolMsg.isError).toBe(true);
    expect(JSON.stringify(toolMsg.parts ?? toolMsg.content)).toContain("fare_amount");
  });

  it("E2E6-6 a column that never resolves is refused, other valid parts still apply", async () => {
    const r = await run([
      turn(addBar("a", -3, "fare", "Bad")),
      turn(addBar("b", -3, "fare", "Bad"), call("c", "edit_widget", { id: 12, aggregation: "max" })),
      final("ok"),
    ]);
    expect(r.ops.map((o) => o.op)).toEqual(["patch"]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].label).toBe('Add bar "Bad"');
    expect(r.skipped[0].stage).toBe("live_schema");
  });

  it("E2E6-7 the model cannot get a hex colour into any op", async () => {
    const r = await run([
      turn(
        call("a", "add_widget", { tempId: -1, type: "bar", title: "T", tableId: 5, metric: "fare_amount", aggregation: "sum", colour: "#ff0000" }),
        call("b", "patch", { targetKind: "widget", targetId: 12, changes: { color: "#ff0000" } }),
      ),
      final("ok"),
    ]);
    expect(r.ops).toEqual([]);
    expect(r.rejected.map((x) => x.stage)).toEqual(["shape", "allow_list"]);
    expect(/#[0-9a-fA-F]{6}/.test(JSON.stringify(r.ops))).toBe(false);
  });

  it("E2E6-8 inaccessible and nonexistent tables are indistinguishable and never named", async () => {
    forbidProviderNetwork();
    const s = setup([
      turn(
        call("a", "add_widget", { tempId: -1, type: "bar", title: "T", tableId: 9, metric: "fare_amount", aggregation: "sum" }),
        call("b", "add_widget", { tempId: -2, type: "bar", title: "T", tableId: 999, metric: "fare_amount", aggregation: "sum" }),
      ),
      final("ok"),
    ]);
    expect(s.registeredTables().some((t) => t.name === "secret_trips")).toBe(true); // positive control
    const r = await runAgentLoop(s.input, s.deps);
    expect(r.ops).toEqual([]);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reasons.map((x) => x.replace(/9\b/, "N"))).toEqual(r.rejected[1].reasons.map((x) => x.replace(/999/, "N")));
    expect(r.rejected[0].stage).toBe(r.rejected[1].stage);
    expect(JSON.stringify(r)).not.toContain("secret_trips");
    expect(JSON.stringify(s.provider.requests)).not.toContain("secret_trips");
  });

  it("E2E6-9 set_layout: a non-overlapping swap applies, an overlapping move is skipped at stage layout", async () => {
    const r = await run([
      turn(call("a", "set_layout", { items: [{ id: 12, x: 18, y: 0, w: 18, h: 30 }, { id: 20, x: 0, y: 0, w: 18, h: 45 }] })),
      final("ok"),
    ]);
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0].op).toBe("set_layout");
    const r2 = await run([turn(call("a", "set_layout", { items: [{ id: 12, x: 10, y: 0, w: 18, h: 30 }] })), final("ok")]);
    expect(r2.ops).toEqual([]);
    expect(r2.skipped).toHaveLength(1);
    expect(r2.skipped[0].stage).toBe("layout");
  });

  it("E2E6-10 the per-answer new-widget cap holds", async () => {
    const calls = [1, 2, 3, 4, 5, 6, 7].map((n) => addBar(`c${n}`, -n, "fare_amount", `W${n}`));
    const r = await run([turn(...calls), final("ok")], { maxNewWidgets: 6 });
    expect(r.ops.filter((o) => o.op === "add_widget")).toHaveLength(6);
    expect(r.skipped.filter((s) => s.stage === "cap")).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    // no two new widgets overlap each other or saved ones
    const rects = [...SAVED_RECTS, ...r.ops.map((o) => (o as any).layout)];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
  });

  it("E2E6-12 D-12 with no map: add a map then a heatmap layer onto its tempId; the map counts toward the cap", async () => {
    const heat = (id: string) => call(id, "add_heatmap_layer", { tempId: -2, tableId: 5, spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude" });
    const r = await run([turn(call("a", "add_widget", { tempId: -1, type: "map", title: "Trips map" }), heat("b")), final("ok")], { snapshot: NO_MAP_SNAP });
    expect(r.ops.map((o) => o.op)).toEqual(["add_widget", "add_layer"]);
    const m = r.ops[0] as Extract<AiOp, { op: "add_widget" }>;
    expect(m.layout).toMatchObject({ w: AI_DEFAULT_SIZE.map.w, h: AI_DEFAULT_SIZE.map.h });
    expect(m.layout).toMatchObject({ w: 28, h: 45 });
    expect(overlap(m.layout!, NO_MAP_SNAP.widgets[0].layout!)).toBe(false);
    expect(r.ops[1]).toMatchObject({ op: "add_layer", widgetId: -1 });

    const r2 = await run(
      [turn(addBar("a", -1), call("b", "add_widget", { tempId: -2, type: "map", title: "Trips map" }), heat("c")), final("ok")],
      { snapshot: NO_MAP_SNAP, maxNewWidgets: 1 },
    );
    expect(r2.ops.map((o) => o.op)).toEqual(["add_widget"]);
    expect(r2.skipped.some((s) => s.stage === "cap")).toBe(true);
    const ref = r2.skipped.find((s) => s.stage === "reference");
    expect(ref?.reasons.join(" ")).toContain("no map on this dashboard");
  });
});
