import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";

const rawOp: MutateTool = { kind: "mutate", name: "raw", description: "", args: z.object({}).passthrough(), toOp: (a) => a };

const T5 = { id: 5, schema: "demo", name: "trips", columns: [
  { name: "vendor", type: "string" }, { name: "fare", type: "double" }, { name: "lat", type: "double" }, { name: "lon", type: "double" }] };
const T6 = { id: 6, schema: "demo", name: "zones", columns: [{ name: "id", type: "int" }] };
const live = (): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) => {
    const t = [T5, T6].find((x) => x.id === id);
    return t ? { ok: true as const, table: t } : { ok: false as const };
  }),
});

type Snap = Parameters<typeof createShadow>[0];
const DV3 = { id: -3, name: "Trips by hour", baseTableId: 5, aggregated: true,
  columns: [{ name: "pickup_hour", type: "datetime" }, { name: "trips", type: "long" }, { name: "fare_p90", type: "double" }] };
const DV5 = { id: -5, name: "Geo view", baseTableId: 5, aggregated: false,
  columns: [{ name: "lat", type: "double" }, { name: "lon", type: "double" }] };
const snap = (o: Partial<Snap> = {}): Snap => ({
  widgets: [
    { id: 117, type: "map", title: "Map" },
    { id: 42, type: "bar", title: "Fares", tableId: 5, binding: { groupByColumn: "vendor", metric: "fare" } },
    { id: 43, type: "bar", title: "Vendors", tableId: 5, binding: { groupByColumn: "vendor" } },
    { id: 50, type: "ai", title: "AI" },
    { id: 44, type: "bar", title: "Bound", tableId: 5, dynamicViewId: -3, binding: { groupByColumn: "pickup_hour", metric: "trips" } },
  ],
  layers: [{ id: 70, widgetId: 117, tableId: 5, renderMode: "heatmap", title: "Pickups", columns: ["lat", "lon"] }],
  dynamicViews: [DV3, DV5, { id: 90, name: "Late" }],
  filters: [], ...o,
}) as Snap;
const SAVED90 = { name: "Late", columns: [{ name: "vendor", type: "string" }, { name: "late", type: "long" }] as { name: string; type?: string }[] | null, sourceTableId: 5 };
const mk = (o: Partial<GatewayDeps> = {}, s: Snap = snap(), saved = SAVED90): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(s), liveSchema: live(),
  getPermissions: vi.fn(() => new Set(["dashboards:view", "ai:use"])), canViewDashboard: vi.fn(() => true),
  dashboardTableIds: () => [5, 6],
  dynamicViewInfo: (id) => (id === 90 ? saved : undefined), ...o,
});
const run = (d: GatewayDeps, o: Record<string, unknown>) => checkAiOp(d, rawOp, JSON.stringify(o));
const reasons = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? [] : r.reasons).join(" | ");
const addW = (config: Record<string, unknown>, tempId = -1) => ({ op: "add_widget", tempId, type: "bar", title: "Hourly", config });
const addL = (o: Record<string, unknown>) => ({ op: "add_layer", tempId: -2, widgetId: 117, renderMode: "heatmap", spatialMode: "latlon", ...o });
const rebind = (kind: string, id: number, dv: unknown, extra: Record<string, unknown> = {}) => ({
  op: "patch", action: { target: { kind, id }, configPatch: { dynamicViewId: dv, ...extra } },
});

describe("gateway: bind widgets and layers to dynamic views (139-10)", () => {
  it("BINDDV-1: add_widget bound to an AI view, no tableId needed", async () => {
    const d = mk();
    const r = await run(d, addW({ dynamicViewId: -3, metric: "trips", aggregation: "sum", groupByColumn: "pickup_hour" }));
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "add_widget") {
      expect(r.op.layout).toBeDefined();
      expect(r.label).toMatch(/^Added bar "Hourly"/);
    }
    expect(d.shadow.widgets.get(-1)?.dynamicViewId).toBe(-3);
  });

  it("BINDDV-2: columns are checked against the VIEW", async () => {
    const a = await run(mk(), addW({ dynamicViewId: -3, metric: "fare", aggregation: "sum", groupByColumn: "pickup_hour" }));
    expect(a).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(a)).toBe("column `fare` not found on dynamic view Trips by hour; did you mean `fare_p90`?");
    const b = await run(mk(), addW({ dynamicViewId: -3, metric: "pickup_hour", aggregation: "sum", groupByColumn: "trips" }));
    expect(reasons(b)).toContain("column pickup_hour is not numeric");
  });

  it("BINDDV-3: exclusivity and unknown view", async () => {
    const a = await run(mk(), addW({ dynamicViewId: -3, tableId: 5, metric: "trips", aggregation: "sum", groupByColumn: "pickup_hour" }));
    expect(a).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(a)).toBe("pass tableId or dynamicViewId, not both");
    const b = await run(mk(), addW({ dynamicViewId: -8, metric: "trips", aggregation: "sum", groupByColumn: "x" }));
    expect(b).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(b)).toBe("dynamic view -8 does not exist");
  });

  it("BINDDV-4: saved view with unknown columns skips the column pre-check", async () => {
    const r = await run(mk({}, snap(), { ...SAVED90, columns: null }), addW({ dynamicViewId: 90, metric: "anything", aggregation: "sum", groupByColumn: "whatever" }));
    expect(r.ok).toBe(true);
  });

  it("BINDDV-5: heatmap layer on a view", async () => {
    const a = await run(mk(), addL({ dynamicViewId: -3, latColumn: "lat", lonColumn: "lon" }));
    expect(a).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(a)).toContain("column `lat` not found on dynamic view Trips by hour");
    const d = mk();
    const b = await run(d, addL({ dynamicViewId: -5, latColumn: "lat", lonColumn: "lon" }));
    expect(b.ok).toBe(true);
    if (b.ok && b.op.op === "add_layer") expect(b.op.tableId).toBe(5);
    const c = await run(mk(), addL({ dynamicViewId: -5, tableId: 6, latColumn: "lat", lonColumn: "lon" }));
    expect(c).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(c)).toBe("the view is built on table 5; use tableId 5");
  });

  it("BINDDV-6: rebind a widget checks refs against the target view", async () => {
    const a = await run(mk(), rebind("widget", 42, 90));
    expect(a).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(a)).toContain("column `fare` not found on dynamic view Late");
    const d = mk();
    const b = await run(d, rebind("widget", 43, 90));
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.label).toBe('Pointed "Vendors" at dynamic view "Late"');
    expect(d.shadow.widgets.get(43)?.dynamicViewId).toBe(90);
  });

  it("BINDDV-7: rebind must be on its own", async () => {
    const r = await run(mk(), rebind("widget", 43, -3, { color: "blue" }));
    expect(r).toMatchObject({ ok: false, stage: "allow_list" });
    expect(reasons(r)).toBe("change the view binding on its own, then send other settings in a separate edit");
  });

  it("BINDDV-8: an already dv-bound widget can be rebound; other edits stay refused", async () => {
    const d = mk({}, snap(), { ...SAVED90, columns: [{ name: "pickup_hour" }, { name: "trips" }] });
    const r = await run(d, rebind("widget", 44, 90));
    expect(r.ok).toBe(true);
    const other = await run(mk(), { op: "patch", action: { target: { kind: "widget", id: 44 }, configPatch: { color: "sky" } } });
    expect(other).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(other)).toContain("this chart uses a dynamic view");
  });

  it("BINDDV-9: layer rebind", async () => {
    const a = await run(mk(), rebind("layer", 70, -3));
    expect(a).toMatchObject({ ok: false, stage: "live_schema" });
    const d = mk();
    const b = await run(d, rebind("layer", 70, -5));
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.label).toBe('Pointed layer "Pickups" at dynamic view "Geo view"');
    expect(d.shadow.layers.get(70)?.dynamicViewId).toBe(-5);
  });

  it("BINDDV-10: unknown view and the locked AI widget", async () => {
    const a = await run(mk(), rebind("widget", 43, -8));
    expect(a).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(a)).toBe("dynamic view -8 does not exist");
    const b = await run(mk(), rebind("widget", 50, -3));
    expect(b).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(b)).toContain("the AI assistant widget can't be changed");
  });

  it("BINDDV-11: change a view in one answer, and BINDDV-12: labels and reasons carry no filter values", async () => {
    const w = createShadow(snap({ widgets: [{ id: 44, type: "bar", title: "Bound", tableId: 5, dynamicViewId: -3, binding: { groupByColumn: "vendor", metric: "trips" } }] } as Partial<Snap>));
    const d2 = mk({ shadow: w });
    const all = [
      await run(d2, { op: "add_dynamic_view", tempId: -4, name: "Hourly v2",
        spec: { baseTableId: 5, groupBy: [{ column: "vendor" }], aggregates: [{ fn: "count", as: "trips" }], filters: [{ column: "vendor", operator: "eq", value: "SECRETVAL_139" }] } }),
      await run(d2, rebind("widget", 44, -4)),
      await run(d2, { op: "remove_dynamic_view", id: -3 }),
    ];
    expect(all.map((r) => r.ok)).toEqual([true, true, true]);
    const rm = all[2];
    if (rm.ok && rm.op.op === "remove_dynamic_view") {
      expect(rm.op.repoint).toBeUndefined();
      expect(rm.op.drop).toBeUndefined();
    }
    expect(d2.shadow.widgets.get(44)?.dynamicViewId).toBe(-4);
    const text = JSON.stringify(all.map((r) => (r.ok ? r.label : r.reasons)));
    expect(text).not.toContain("SECRETVAL_139");
  });

  it("BINDDV-13: rebind to a SAVED view moves the shadow widget/layer tableId to the view's source table", async () => {
    const saved = { ...SAVED90, sourceTableId: 6, columns: [{ name: "vendor", type: "string" }] };
    const d = mk({}, snap(), saved);
    expect((await run(d, rebind("widget", 43, 90))).ok).toBe(true);
    expect(d.shadow.widgets.get(43)?.tableId).toBe(6);
    const d2 = mk({}, snap(), { ...saved, columns: [{ name: "lat" }, { name: "lon" }] });
    expect((await run(d2, rebind("layer", 70, 90))).ok).toBe(true);
    expect(d2.shadow.layers.get(70)?.tableId).toBe(6);
  });

  it("BINDDV-14: a follow-up layer patch in the same answer is checked against the new source table", async () => {
    // T5 has `fare`, T6 (zones) does not. After rebinding layer 70 to a saved view built on table 6, valueColumn=fare must be refused.
    const saved = { ...SAVED90, sourceTableId: 6, columns: [{ name: "lat" }, { name: "lon" }] };
    const d = mk({}, snap(), saved);
    expect((await run(d, rebind("layer", 70, 90))).ok).toBe(true);
    const r = await run(d, { op: "patch", action: { target: { kind: "layer", id: 70 }, configPatch: { valueColumn: "fare" } } });
    expect(r).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(r)).toContain("fare");
  });
});
