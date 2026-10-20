import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";

const rawOp: MutateTool = { kind: "mutate", name: "raw", description: "", args: z.object({}).passthrough(), toOp: (a) => a };

const T5 = { id: 5, schema: "demo", name: "trips", columns: [
  { name: "vendor", type: "string" }, { name: "fare", type: "double" }, { name: "zone_id", type: "int" },
  { name: "pickup_datetime", type: "timestamp" }, { name: "lat", type: "double" }, { name: "lon", type: "double" }] };
const T6 = { id: 6, schema: "demo", name: "zones", columns: [{ name: "id", type: "int" }, { name: "borough", type: "string" }] };
const T7 = { id: 7, schema: "fleet", name: "other", columns: [{ name: "x", type: "int" }] };
const live = (skip: number[] = []): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) => {
    const t = [T5, T6, T7].find((x) => x.id === id && !skip.includes(id));
    return t ? { ok: true as const, table: t } : { ok: false as const };
  }),
});

type Snap = Parameters<typeof createShadow>[0];
const DV3 = { id: -3, name: "Trips by hour", baseTableId: 5, aggregated: true, columns: [{ name: "vendor", type: "string" }, { name: "trips", type: "long" }] };
const snap = (o: Partial<Snap> = {}): Snap => ({ widgets: [], layers: [], dynamicViews: [], filters: [], ...o }) as Snap;
const mk = (o: Partial<GatewayDeps> = {}, s: Snap = snap(), lv: LiveSchemaPort = live()): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(s), liveSchema: lv,
  getPermissions: vi.fn(() => new Set(["dashboards:view", "ai:use"])), canViewDashboard: vi.fn(() => true),
  dashboardTableIds: () => [5, 6], ...o,
});
const run = (d: GatewayDeps, o: Record<string, unknown>) => checkAiOp(d, rawOp, JSON.stringify(o));
const reasons = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? [] : r.reasons).join(" | ");

const summarySpec = {
  baseTableId: 5,
  groupBy: [{ column: "pickup_datetime", bucket: "hour", as: "pickup_hour" }],
  aggregates: [{ fn: "count", as: "trips" }, { fn: "percentile", column: "fare", p: 90, as: "fare_p90" }],
};
const add = (spec: Record<string, unknown> = summarySpec, extra: Record<string, unknown> = {}) => ({ op: "add_dynamic_view", tempId: -3, name: "Trips by hour", spec, ...extra });
const join = (tableId = 6) => ({ tableId, type: "inner", on: [{ left: "zone_id", right: "id" }] });
const rm = (o: Record<string, unknown>) => ({ op: "remove_dynamic_view", ...o });

describe("gateway: add_dynamic_view (139)", () => {
  it("GWDV-1: ok stamps columns, maxRecords, aggregated; later ops see the view", async () => {
    const d = mk();
    const r = await run(d, add());
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "add_dynamic_view") {
      expect(r.op.columns?.map((c) => c.name)).toEqual(["pickup_hour", "trips", "fare_p90"]);
      expect(r.op.maxRecords).toBe(100000);
      expect(r.op.aggregated).toBe(true);
      expect(r.label).toBe('Added dynamic view "Trips by hour"');
    }
    expect(d.shadow.dynamicViews.has(-3)).toBe(true);
    expect(d.shadow.dvInfo.get(-3)?.columns?.length).toBe(3);
  });

  it("GWDV-2: SQL-ish keys are refused at shape and nothing is applied", async () => {
    for (const k of ["sql", "where", "template_sql"]) {
      const d = mk();
      const r = await run(d, add({ ...summarySpec, [k]: "1=1" }));
      expect(r).toMatchObject({ ok: false, stage: "shape" });
      expect(d.shadow.dynamicViews.size).toBe(0);
    }
  });

  it("GWDV-3: unknown column -> did-you-mean over THAT table only", async () => {
    const r = await run(mk(), add({ baseTableId: 5, columns: [{ column: "fair" }] }));
    expect(r).toMatchObject({ ok: false, stage: "live_schema", refKey: "col:5:fair" });
    expect(reasons(r)).toBe("column `fair` not found on demo.trips; did you mean `fare`?");
    const j = await run(mk(), add({ baseTableId: 5, joins: [join()], columns: [{ from: 1, column: "boro" }] }));
    expect(j).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(j)).toContain("column `boro` not found on demo.zones; did you mean `borough`?");
    const k = await run(mk(), add({ baseTableId: 5, joins: [join()], columns: [{ from: 1, column: "fare_x" }] }));
    expect(reasons(k)).not.toMatch(/`fare`|`vendor`|`lat`/);
  });

  it("GWDV-4: base / joined table must be on the dashboard", async () => {
    const a = await run(mk(), add({ baseTableId: 7, columns: [{ column: "x" }] }));
    expect(a).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(a)).toContain("table 7 isn't on this dashboard; add it in dashboard settings first");
    const b = await run(mk(), add({ baseTableId: 99, columns: [{ column: "x" }] }));
    expect(reasons(b)).toContain("table 99 is not available; use list_tables for valid ids");
    const c = await run(mk(), add({ baseTableId: 5, joins: [join(7)], columns: [{ column: "vendor" }] }));
    expect(c).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(c)).toContain("table 7 isn't on this dashboard");
  });

  it("GWDV-5: join cap", async () => {
    const r = await run(mk(), add({ baseTableId: 5, joins: [join(), join(), join()], columns: [{ column: "vendor" }] }));
    expect(r).toMatchObject({ ok: false, stage: "cap" });
    expect(reasons(r)).toContain("a view can join at most 2 tables");
  });

  it("GWDV-6: session cap counts negative views only and is shared across ops in an answer", async () => {
    const five = [-10, -11, -12, -13, -14].map((id) => ({ id, name: `V${-id}` }));
    const r = await run(mk({}, snap({ dynamicViews: [...five, { id: 90, name: "Saved" }] })), add());
    expect(r).toMatchObject({ ok: false, stage: "cap" });
    expect(reasons(r)).toBe("you already have 5 session views (limit 5); remove one first");
    const saved = [90, 91, 92, 93, 94, 95].map((id) => ({ id, name: `S${id}` }));
    expect((await run(mk({}, snap({ dynamicViews: saved })), add())).ok).toBe(true);
    const d = mk({ aiDv: { maxRecords: 100000, maxJoins: 2, maxPerSession: 2 } }, snap({ dynamicViews: [{ id: -10, name: "V" }] }));
    expect((await run(d, add())).ok).toBe(true);
    const second = await run(d, add(summarySpec, { tempId: -4 }));
    expect(second).toMatchObject({ ok: false, stage: "cap" });
    expect(reasons(second)).toContain("limit 2");
  });

  it("GWDV-7: type rules", async () => {
    const a = await run(mk(), add({ baseTableId: 5, groupBy: [{ column: "zone_id" }], aggregates: [{ fn: "avg", column: "vendor", as: "a" }] }));
    expect(a).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(a)).toContain("column vendor is not numeric");
    const b = await run(mk(), add({ baseTableId: 5, groupBy: [{ column: "fare", bucket: "hour" }], aggregates: [{ fn: "count", as: "n" }] }));
    expect(reasons(b)).toContain("column fare is not a date or time column");
  });

  it("GWDV-8: permission is checked first; nothing is described", async () => {
    const lv = live();
    const r = await run(mk({ getPermissions: () => new Set(["dashboards:view"]) }, snap(), lv), add());
    expect(r).toMatchObject({ ok: false, stage: "permission" });
    expect(lv.describe).not.toHaveBeenCalled();
  });

  it("GWDV-9: temp id reuse", async () => {
    const r = await run(mk({}, snap({ dynamicViews: [DV3] })), add());
    expect(r).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(r)).toContain("temp id -3 is already in use");
  });
});

describe("gateway: remove_dynamic_view (139)", () => {
  const widgets = [
    { id: 42, type: "bar", title: "Fares", tableId: 5, dynamicViewId: -3, binding: { groupByColumn: "vendor", metric: "fare" } },
    { id: -1, type: "bar", title: "Tmp", tableId: 5, dynamicViewId: -3, binding: { metric: "trips" } },
  ];
  const layers = [{ id: 70, widgetId: 42, tableId: 5, dynamicViewId: -3, columns: ["lat", "lon"] }];
  const s10 = () => snap({ widgets, layers, dynamicViews: [DV3] } as Partial<Snap>);

  it("GWDV-10: AI view with dependents -> repoint/drop stamped, no question", async () => {
    const d = mk({}, s10());
    const r = await run(d, rm({ id: -3 }));
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "remove_dynamic_view") {
      expect(r.op.repoint).toEqual({ tableId: 5, widgetIds: [42], layerIds: [70] });
      expect(r.op.drop).toEqual({ widgetIds: [-1], layerIds: [] });
      expect(r.label).toBe('Removed dynamic view "Trips by hour"; repointed "Fares" and layer 70 to its table; removed "Tmp"');
    }
    expect(d.shadow.dynamicViews.has(-3)).toBe(false);
    expect(d.shadow.widgets.has(-1)).toBe(false);
  });

  const dvInfo = (id: number) => (id === 90 ? { name: "Late", columns: [{ name: "vendor" }], sourceTableId: 5 } : undefined);
  it("GWDV-11: saved view asks once; approved stamps dependents against its base", async () => {
    const s = snap({ widgets: [{ id: -2, type: "bar", title: "W", tableId: 5, dynamicViewId: 90, binding: { groupByColumn: "vendor" } }], dynamicViews: [{ id: 90, name: "Late" }] } as Partial<Snap>);
    const ask = await run(mk({ dynamicViewInfo: dvInfo }, s), rm({ id: 90 }));
    expect(ask).toMatchObject({ ok: false, stage: "clarification" });
    if (!ask.ok) expect(ask.clarification).toMatchObject({ kind: "confirm_remove", question: 'Remove the saved dynamic view "Late"?' });
    const ok = await run(mk({ dynamicViewInfo: dvInfo, approvals: { removeSaved: true } }, s), rm({ id: 90 }));
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.op.op === "remove_dynamic_view") expect(ok.op.repoint).toEqual({ tableId: 5, widgetIds: [-2], layerIds: [] });
  });

  it("GWDV-12: dropping a saved dependent asks", async () => {
    const s = snap({ widgets: [{ id: 44, type: "bar", title: "Saved", tableId: 5, dynamicViewId: -3, binding: { metric: "trips" } }], dynamicViews: [DV3] } as Partial<Snap>);
    const ask = await run(mk({}, s), rm({ id: -3 }));
    expect(ask).toMatchObject({ ok: false, stage: "clarification" });
    if (!ask.ok) expect(ask.clarification?.question).toBe('Remove the dynamic view "Trips by hour" and 1 saved item that uses it?');
    const ok = await run(mk({ approvals: { removeSaved: true } }, s), rm({ id: -3 }));
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.op.op === "remove_dynamic_view") expect(ok.op.drop).toEqual({ widgetIds: [44], layerIds: [] });
  });

  it("GWDV-13: base table not describable -> everything is dropped", async () => {
    const r = await run(mk({ approvals: { removeSaved: true } }, s10(), live([5])), rm({ id: -3 }));
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "remove_dynamic_view") {
      expect(r.op.repoint).toBeUndefined();
      expect(r.op.drop).toEqual({ widgetIds: [42, -1], layerIds: [70] });
    }
  });
});

describe("gateway: AI views are filterable (D-23)", () => {
  const dvSnap = () => snap({ dynamicViews: [DV3] });
  const af = (column: string, source?: unknown, value: unknown = "x") => ({ op: "apply_filter", ...(source ? { source } : {}), filters: [{ column, operator: "eq", value }] });
  const SRC = { kind: "dynamicView", id: -3 };

  it("GWDV-14: apply_filter on an AI view uses its stamped columns", async () => {
    expect((await run(mk({}, dvSnap()), af("vendor", SRC))).ok).toBe(true);
    const nope = await run(mk({}, dvSnap()), af("nope", SRC));
    expect(nope).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(nope)).toContain("column `nope` not found on dynamic view Trips by hour");
    const gone = await run(mk({}, dvSnap()), af("vendor", { kind: "dynamicView", id: -8 }));
    expect(gone).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(gone)).toContain("dynamic view -8 does not exist");
    // a view added earlier in the same answer is filterable too
    const d = mk();
    expect((await run(d, add({ baseTableId: 5, columns: [{ column: "vendor" }] }))).ok).toBe(true);
    expect((await run(d, af("vendor", SRC))).ok).toBe(true);
  });

  it("GWDV-15: a column only on an AI view resolves to that view", async () => {
    const r = await run(mk({}, dvSnap()), af("trips", undefined, 5));
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "apply_filter") expect(r.op.source).toEqual(SRC);
  });
});

describe("gateway: privacy (139)", () => {
  it("GWDV-16: spec filter values never reach reasons, labels or clarifications", async () => {
    const SECRET = "SECRETVAL_139";
    const f = [{ column: "vendor", operator: "eq", value: SECRET }];
    const outs: Awaited<ReturnType<typeof run>>[] = [];
    outs.push(await run(mk(), add({ ...summarySpec, filters: f })));
    outs.push(await run(mk(), add({ baseTableId: 5, columns: [{ column: "fair" }], filters: f })));
    outs.push(await run(mk(), add({ baseTableId: 5, joins: [join(), join(), join()], columns: [{ column: "vendor" }], filters: f })));
    outs.push(await run(mk(), add({ baseTableId: 7, columns: [{ column: "x" }], filters: f })));
    outs.push(await run(mk({}, snap({ dynamicViews: [DV3] })), add({ ...summarySpec, filters: f })));
    for (const r of outs) {
      const shown = r.ok ? r.label : JSON.stringify({ reasons: r.reasons, label: r.label, clarification: r.clarification });
      expect(shown).not.toContain(SECRET);
    }
    expect(outs.some((r) => r.ok)).toBe(true);
    expect(outs.some((r) => !r.ok)).toBe(true);
  });
});
