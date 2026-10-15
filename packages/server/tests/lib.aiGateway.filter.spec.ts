import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";

const rawOp: MutateTool = { kind: "mutate", name: "raw", description: "", args: z.object({}).passthrough(), toOp: (a) => a };

type Filt = { source: { kind: "table" | "dynamicView"; id: number }; column: string; op: string };
const tf = (cols: string[], id = 5): Filt[] => cols.map((column) => ({ source: { kind: "table", id }, column, op: "eq" }));
const snap = (filters: Filt[] = [], dynamicViews: { id: number; name: string }[] = []) => ({
  widgets: [{ id: 42, type: "bar", title: "Fares", tableId: 5 }],
  layers: [],
  dynamicViews,
  filters,
});
const T5 = { id: 5, schema: "demo", name: "trips", columns: [
  { name: "payment_type", type: "string" }, { name: "vendor_id", type: "string" }, { name: "fare_amount", type: "double" },
  { name: "pickup_datetime", type: "timestamp" }, { name: "geom", type: "geometry" }] };
const T6 = { id: 6, schema: "demo", name: "zones", columns: [{ name: "zone_id", type: "int" }, { name: "payment_type", type: "string" }] };
const live = (): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) => {
    const t = [T5, T6].find((x) => x.id === id);
    return t ? { ok: true as const, table: t } : { ok: false as const };
  }),
});
const mk = (o: Partial<GatewayDeps> = {}, s = snap()): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(s), liveSchema: live(),
  getPermissions: vi.fn(() => new Set(["dashboards:view", "ai:use"])), canViewDashboard: vi.fn(() => true),
  dashboardTableIds: () => [5], ...o,
});
const run = (d: GatewayDeps, o: Record<string, unknown>) => checkAiOp(d, rawOp, JSON.stringify(o));
const T = (id = 5) => ({ kind: "table", id });
const apply = (column: string, value: unknown, source: unknown = T(), operator = "eq") => ({ op: "apply_filter", source, filters: [{ column, operator, value }] });
const reasons = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? [] : r.reasons).join(" | ");

describe("gateway: filters (138)", () => {
  it("GWF-1: eq on a string column stamps typed value + dataType", async () => {
    const r = await run(mk(), apply("payment_type", "Credit"));
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "apply_filter") {
      expect(r.op.filters[0]).toMatchObject({ value: "Credit", dataType: "string" });
      expect(r.label).toBe("Filtered table 5 on payment_type");
    }
  });

  it("GWF-2: unknown column -> did-you-mean, refKey", async () => {
    const r = await run(mk(), apply("paymnt_type", "x"));
    expect(r).toMatchObject({ ok: false, stage: "live_schema", refKey: "col:5:paymnt_type" });
    expect(reasons(r)).toContain("did you mean `payment_type`");
  });

  it("GWF-3: number coercion", async () => {
    const bad = await run(mk(), apply("fare_amount", "abc"));
    expect(bad).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(bad)).toContain("column fare_amount needs a number");
    const good = await run(mk(), apply("fare_amount", "1,234.5"));
    expect(good.ok).toBe(true);
    if (good.ok && good.op.op === "apply_filter") expect(good.op.filters[0]).toMatchObject({ value: 1234.5, dataType: "number" });
    const rng = await run(mk(), apply("fare_amount", ["10", "2"], T(), "between"));
    expect(rng).toMatchObject({ ok: false, stage: "live_schema" });
  });

  it("GWF-4: geometry column refused", async () => {
    const r = await run(mk(), apply("geom", "x"));
    expect(r).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(r)).toContain("column geom can't be filtered");
  });

  it("GWF-5: table not on dashboard / unknown", async () => {
    const a = await run(mk(), apply("payment_type", "x", T(6)));
    expect(a).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(a)).toContain("table 6 isn't on this dashboard");
    const b = await run(mk(), apply("payment_type", "x", T(99)));
    expect(reasons(b)).toContain("table 99 is not available");
  });

  it("GWF-6: dynamic view sources", async () => {
    const s = snap([], [{ id: 90, name: "Late trips" }]);
    const dv = { kind: "dynamicView", id: 90 };
    const info = vi.fn((_id: number) => ({ name: "Late trips", columns: [{ name: "payment_type", type: "string" }] as { name: string; type?: string }[] | null }));
    expect((await run(mk({ dynamicViewInfo: info }, s), apply("payment_type", "x", dv))).ok).toBe(true);
    const nope = await run(mk({ dynamicViewInfo: info }, s), apply("nope", "x", dv));
    expect(nope).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(nope)).toContain("column `nope` not found on dynamic view Late trips");
    const nul = await run(mk({ dynamicViewInfo: () => ({ name: "Late trips", columns: null }) }, s), apply("anything", "x", dv));
    expect(nul.ok).toBe(true);
    if (nul.ok && nul.op.op === "apply_filter") expect(nul.op.filters[0].dataType).toBe("string");
    const gone = await run(mk({ dynamicViewInfo: () => undefined }, s), apply("payment_type", "x", dv));
    expect(reasons(gone)).toContain("dynamic view 90 does not exist");
    const temp = await run(mk({ dynamicViewInfo: info }, s), apply("payment_type", "x", { kind: "dynamicView", id: -3 }));
    expect(reasons(temp)).toContain("dynamic views created by the AI can't be filtered yet");
  });

  it("GWF-7: cap refuses whole, replace allowed", async () => {
    const cols = [...Array.from({ length: 24 }, (_, i) => `c${i + 1}`), "payment_type"];
    const d = mk({}, snap(tf(cols)));
    const over = await run(d, apply("vendor_id", "x"));
    expect(over).toMatchObject({ ok: false, stage: "cap" });
    expect(reasons(over)).toContain("already has 25 filters");
    expect((await run(d, apply("payment_type", "x"))).ok).toBe(true);
    const d2 = mk({}, snap(tf(cols.slice(0, 24))));
    const two = await run(d2, { op: "apply_filter", source: T(), filters: [{ column: "vendor_id", operator: "eq", value: "a" }, { column: "payment_type", operator: "eq", value: "b" }] });
    expect(two).toMatchObject({ ok: false, stage: "cap" });
    expect(d2.shadow.filterCols.get("table:5")?.size).toBe(24);
  });

  it("GWF-8: ops in one answer share the shadow", async () => {
    const cols = Array.from({ length: 24 }, (_, i) => `c${i + 1}`);
    const d = mk({}, snap(tf(cols)));
    expect((await run(d, apply("vendor_id", "x"))).ok).toBe(true);
    expect(await run(d, apply("fare_amount", "1"))).toMatchObject({ ok: false, stage: "cap" });
  });

  it("GWF-9: ambiguous / single / absent source", async () => {
    const two = mk({ dashboardTableIds: () => [5, 6] });
    const amb = await run(two, { op: "apply_filter", filters: [{ column: "payment_type", operator: "eq", value: "x" }] });
    expect(amb).toMatchObject({
      ok: false, stage: "clarification",
      clarification: {
        kind: "choose_option", question: "Which table should I filter by payment_type?",
        options: [{ id: "table:5", label: "demo.trips" }, { id: "table:6", label: "demo.zones" }],
      },
    });
    const one = await run(mk({ dashboardTableIds: () => [5, 6] }), { op: "apply_filter", filters: [{ column: "vendor_id", operator: "eq", value: "x" }] });
    expect(one.ok).toBe(true);
    if (one.ok && one.op.op === "apply_filter") expect(one.op.source).toEqual({ kind: "table", id: 5 });
    const none = await run(mk({ dashboardTableIds: () => [5, 6] }), { op: "apply_filter", filters: [{ column: "zzz_unknown", operator: "eq", value: "x" }] });
    expect(none).toMatchObject({ ok: false, stage: "live_schema" });
    expect(reasons(none)).toContain("zzz_unknown");
  });

  it("GWF-10: clear", async () => {
    const empty = await run(mk(), { op: "clear_filter" });
    expect(empty).toMatchObject({ ok: false, stage: "reference" });
    expect(reasons(empty)).toContain("there are no filters to clear");
    const d = mk({}, snap(tf(["payment_type", "vendor_id"])));
    const all = await run(d, { op: "clear_filter" });
    expect(all).toMatchObject({ ok: true, label: "Cleared all filters" });
    expect(d.shadow.filterCols.size).toBe(0);
    const d2 = mk({}, snap(tf(["payment_type"])));
    const miss = await run(d2, { op: "clear_filter", source: T(), column: "vendor_id" });
    expect(reasons(miss)).toContain("no filter on `vendor_id`");
    const d3 = mk({ dashboardTableIds: () => [5, 6] }, snap([...tf(["payment_type"]), ...tf(["payment_type"], 6)]));
    const amb = await run(d3, { op: "clear_filter", column: "payment_type" });
    expect(amb).toMatchObject({ ok: false, stage: "clarification", clarification: { kind: "choose_option", question: "Which table's payment_type filter should I clear?" } });
    const d4 = mk({}, snap(tf(["payment_type"])));
    const single = await run(d4, { op: "clear_filter", column: "payment_type" });
    expect(single.ok).toBe(true);
    if (single.ok && single.op.op === "clear_filter") expect(single.op.source).toEqual({ kind: "table", id: 5 });
  });

  it("GWF-11: no filter values in labels or reasons", async () => {
    const r = await run(mk(), apply("payment_type", "SECRETVAL_77"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.label)).not.toContain("SECRETVAL_77");
    const bad = await run(mk(), apply("fare_amount", "SECRETVAL_77"));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("SECRETVAL_77");
  });

  it("GWF-12: permission checked first, no probing", async () => {
    const liveSchema = live();
    const d = mk({ getPermissions: vi.fn(() => new Set(["dashboards:view"])), liveSchema, dashboardTableIds: () => [5, 6] });
    const r = await run(d, { op: "apply_filter", filters: [{ column: "payment_type", operator: "eq", value: "x" }] });
    expect(r).toMatchObject({ ok: false, stage: "permission" });
    expect(liveSchema.describe).not.toHaveBeenCalled();
  });
});
