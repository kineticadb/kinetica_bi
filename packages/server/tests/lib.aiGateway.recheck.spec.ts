// Phase 150 (APPROVE-V22-03): checkAiCandidate is checkAiOp minus parsing; buildGatewayDeps shape.
import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, checkAiCandidate, type GatewayDeps } from "../src/lib/ai/gateway";
import { buildGatewayDeps } from "../src/lib/ai/gatewayDeps";
import { createShadow } from "../src/lib/ai/shadow";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";

const addWidget: MutateTool = {
  kind: "mutate", name: "add_widget", description: "",
  args: z.object({ tempId: z.number(), type: z.string(), title: z.string(), tableId: z.number().optional(), config: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  toOp: (a) => {
    const { tempId, type, title, tableId, config, ...rest } = a as { tempId: number; type: string; title: string; tableId?: number; config?: Record<string, unknown> };
    return { op: "add_widget", tempId, type, title, config: { ...(config ?? {}), ...rest, ...(tableId !== undefined ? { tableId } : {}) } };
  },
};
const patch: MutateTool = {
  kind: "mutate", name: "patch", description: "",
  args: z.object({ kind: z.enum(["widget", "layer", "dynamicView"]), id: z.number(), configPatch: z.record(z.string(), z.unknown()) }),
  toOp: (a) => { const x = a as { kind: string; id: number; configPatch: unknown }; return { op: "patch", action: { target: { kind: x.kind, id: x.id }, configPatch: x.configPatch } }; },
};
const removeWidget: MutateTool = {
  kind: "mutate", name: "remove_widget", description: "",
  args: z.object({ id: z.number() }),
  toOp: (a) => ({ op: "remove_widget", id: (a as { id: number }).id }),
};
const setTitle: MutateTool = {
  kind: "mutate", name: "set_widget_title", description: "",
  args: z.object({ id: z.number(), title: z.string() }),
  toOp: (a) => ({ op: "set_widget_title", ...(a as object) }),
};
const snap = () => ({
  widgets: [{ id: 42, type: "map", title: "Trips", tableId: 7 }, { id: 43, type: "bar", title: "Fares", tableId: 7 }],
  layers: [{ id: 70, widgetId: 42, tableId: 7 }],
  dynamicViews: [{ id: 90, name: "dv" }],
  filters: [],
});
const T7 = { id: 7, schema: "demo", name: "nyctaxi", columns: [{ name: "fare_amount" }, { name: "vendor_id" }] };
const T5 = { id: 5, schema: "demo", name: "trips", columns: [{ name: "fare_amount" }, { name: "vendor_id" }] };
const live = (): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) => {
    const t = [T5, T7].find((x) => x.id === id);
    return t ? { ok: true as const, table: t } : { ok: false as const };
  }),
});
const mk = (o: Partial<GatewayDeps> = {}): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(),
  getPermissions: vi.fn(() => new Set(["dashboards:view", "ai:use"])), canViewDashboard: vi.fn(() => true), dashboardTableIds: () => [5, 7], ...o,
});
const add = (o: Record<string, unknown> = {}) => JSON.stringify({ tempId: -1, type: "bar", title: "T", tableId: 7, metric: "fare_amount", aggregation: "sum", groupByColumn: "vendor_id", ...o });

describe("checkAiCandidate", () => {
  const cases: Array<[string, MutateTool, string, Partial<GatewayDeps>]> = [
    ["add bar", addWidget, add(), {}],
    ["patch saved widget", patch, JSON.stringify({ kind: "widget", id: 43, configPatch: { title: "x" } }), {}],
    ["remove saved with approval", removeWidget, JSON.stringify({ id: 43 }), { approvals: { removeSaved: true } }],
    ["unknown column", addWidget, add({ metric: "nope_col" }), {}],
    ["table not on dashboard", addWidget, add({ tableId: 6 }), {}],
  ];
  for (const [name, tool, args, extra] of cases) {
    it(`APPRGW-1: same result and shadow as checkAiOp (${name})`, async () => {
      const a = mk(extra);
      const b = mk(extra);
      const ra = await checkAiOp(a, tool, args);
      const rb = await checkAiCandidate(b, tool.toOp(tool.args.parse(JSON.parse(args))));
      expect(rb).toEqual(ra);
      expect(b.shadow.widgets).toEqual(a.shadow.widgets);
    });
  }
  it("APPRGW-2: sequential candidates share one shadow", async () => {
    const d = mk();
    const r1 = await checkAiCandidate(d, addWidget.toOp(JSON.parse(add())));
    const r2 = await checkAiCandidate(d, setTitle.toOp({ id: -1, title: "New" }));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const alone = await checkAiCandidate(mk(), setTitle.toOp({ id: -1, title: "New" }));
    expect(alone).toMatchObject({ ok: false, stage: "reference" });
  });
  it("APPRGW-3: non-object candidate fails at shape", async () => {
    expect(await checkAiCandidate(mk(), "not an object")).toMatchObject({ ok: false, stage: "shape" });
  });
  it("APPRGW-4: buildGatewayDeps has the keys runAnswer always built", () => {
    const config = { dvMaxRecords: 1000, dvMaxJoins: 2, dvMaxPerSession: 5 } as never;
    const withA = buildGatewayDeps({ username: "dee", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(), config, approvals: { removeSaved: true } });
    const without = buildGatewayDeps({ username: "dee", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(), config });
    const keys = ["aiDv", "approvals", "canViewDashboard", "dashboardId", "dashboardTableIds", "dynamicViewInfo", "getPermissions", "liveSchema", "shadow", "username", "viewerRestriction"];
    expect(Object.keys(withA).sort()).toEqual(keys);
    expect(Object.keys(without).sort()).toEqual(keys);
    expect(without.approvals).toBeUndefined();
    expect(withA.aiDv).toEqual({ maxRecords: 1000, maxJoins: 2, maxPerSession: 5 });
  });
});
