import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import { checkAiOp, AI_COLUMN_BINDING_KEYS, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import { rectsOverlap } from "@kinetica-bi/shared";
import type { MutateTool, LiveSchemaPort } from "../src/lib/ai/tools/types";
import { CANARY_ROW_VALUE_9f3 as C } from "./helpers/aiTestKit";

const addWidget: MutateTool = {
  kind: "mutate", name: "add_widget", description: "",
  args: z.object({ tempId: z.number(), type: z.string(), title: z.string(), tableId: z.number().optional(), config: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  toOp: (a) => {
    const { tempId, type, title, tableId, config, ...rest } = a as { tempId: number; type: string; title: string; tableId?: number; config?: Record<string, unknown> };
    return { op: "add_widget", tempId, type, title, config: { ...(config ?? {}), ...rest, ...(tableId !== undefined ? { tableId } : {}) } };
  },
};
// Passes the model's JSON straight through as the op so the gateway itself (not the fake tool/zod) is what sees hostile keys.
const rawOp: MutateTool = {
  kind: "mutate", name: "raw", description: "",
  args: z.object({}).passthrough(),
  toOp: (a) => a,
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

const snap = () => ({
  widgets: [{ id: 42, type: "map", title: "Trips", tableId: 7 }, { id: 43, type: "bar", title: "Fares", tableId: 7 }],
  layers: [{ id: 70, widgetId: 42, tableId: 7 }],
  dynamicViews: [{ id: 90, name: "dv" }],
  filters: [],
});
const ANALYST = new Set(["dashboards:view", "ai:use"]);
const T5 = { id: 5, schema: "demo", name: "trips", columns: [
  { name: "fare_amount", type: "double" }, { name: "total_amount", type: "double" }, { name: "vendor_id", type: "string" },
  { name: "pickup_latitude", type: "double" }, { name: "pickup_longitude", type: "double" }, { name: "geom" }] };
const T6 = { id: 6, schema: "demo", name: "zones", columns: [{ name: "zone_id", type: "int" }] };
const T7 = { id: 7, schema: "demo", name: "nyctaxi", columns: [{ name: "fare_amount" }, { name: "vendor_id" }] };
// Table 9 is INACCESSIBLE (describe -> ok:false) but exists in the registry: positive control for no-disclosure checks.
const REGISTERED = [{ id: 9, schema: "secret", name: "secret_trips", columns: [{ name: "fare_secret" }, { name: "fare_amt_secret" }] }];
const live = (): LiveSchemaPort => ({
  describe: vi.fn(async (id: number) => {
    const t = [T5, T6, T7].find((x) => x.id === id);
    return t ? { ok: true as const, table: t } : { ok: false as const };
  }),
});
const mk = (o: Partial<GatewayDeps> = {}): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(),
  getPermissions: vi.fn(() => ANALYST), canViewDashboard: vi.fn(() => true), dashboardTableIds: () => [5, 7], ...o,
});
const add = (o: Record<string, unknown> = {}) => JSON.stringify({ tempId: -1, type: "bar", title: "T", tableId: 7, metric: "fare_amount", aggregation: "sum", groupByColumn: "vendor_id", ...o });
const pat = (kind: string, id: number, configPatch: unknown) => JSON.stringify({ kind, id, configPatch });

describe("checkAiOp gateway", () => {
  it("GW-1: shape failures, no values in reasons", async () => {
    const raw = add({ tempId: C });
    expect(raw).toContain(C);
    for (const r of [
      await checkAiOp(mk(), addWidget, "not json"),
      await checkAiOp(mk(), addWidget, raw),
      await checkAiOp(mk(), addWidget, add({ tempId: 5 })),
    ]) {
      expect(r).toMatchObject({ ok: false, stage: "shape" });
      if (!r.ok) expect(JSON.stringify(r.reasons)).not.toContain(C);
    }
  });

  it("GW-2: allow_list", async () => {
    const stage = async (t: MutateTool, raw: string) => { const r = await checkAiOp(mk(), t, raw); return r.ok ? "ok" : r.stage; };
    expect(await stage(addWidget, add({ type: "scatter" }))).toBe("allow_list");
    expect(await stage(addWidget, add({ config: { customWhere: "1=1" } }))).toBe("allow_list");
    const proto = `{"tempId":-1,"type":"bar","title":"T","tableId":7,"config":{"__proto__":{"x":1}}}`;
    // parseAiOp's z.record strips an own "__proto__" key before the allow-list stage (verified), so the plan's
    // "__proto__ -> allow_list" is not observable; assert the real guarantee: the accepted op never carries it.
    const pr = await checkAiOp(mk(), rawOp, `{"op":"add_widget","tempId":-1,"type":"bar","title":"T","config":{"tableId":7,"__proto__":{"x":1}}}`);
    if (pr.ok && pr.op.op === "add_widget") expect(Object.prototype.hasOwnProperty.call(pr.op.config, "__proto__")).toBe(false);
    else expect(pr).toMatchObject({ ok: false, stage: "allow_list" });
    expect(await stage(rawOp, `{"op":"add_widget","tempId":-1,"type":"bar","title":"T","config":{"tableId":7,"constructor":1}}`)).toBe("allow_list");
    expect(await stage(addWidget, proto)).toMatch(/ok|allow_list/); // fake tool's zod may drop the key; hostile-key proof is the rawOp pair above
    expect(await stage(addWidget, add({ config: { dynamicViewId: 3 } }))).toBe("allow_list");
    expect(await stage(patch, pat("widget", 42, { show_popup: "yes" }))).toBe("allow_list");
    expect(await stage(patch, pat("layer", 70, { table_id: 3 }))).toBe("allow_list");
    expect(await stage(patch, pat("widget", 43, { anything: 1 }))).toBe("allow_list");
  });

  it("GW-3: permission", async () => {
    const a = await checkAiOp(mk({ getPermissions: () => new Set(["dashboards:view"]) }), addWidget, add());
    expect(a).toMatchObject({ ok: false, stage: "permission" });
    const b = await checkAiOp(mk({ canViewDashboard: () => false }), addWidget, add());
    expect(b).toMatchObject({ ok: false, stage: "permission" });
  });

  it("GW-4: D-16 analyst without edit rights is accepted", async () => {
    expect((await checkAiOp(mk(), addWidget, add())).ok).toBe(true);
    expect((await checkAiOp(mk(), removeWidget, JSON.stringify({ id: 43 }))).ok).toBe(true);
    expect((await checkAiOp(mk(), patch, pat("widget", 42, { show_popup: true }))).ok).toBe(true);
  });

  it("GW-5: permissions re-read per op", async () => {
    const getPermissions = vi.fn().mockReturnValueOnce(ANALYST).mockReturnValueOnce(new Set(["dashboards:view"]));
    const d = mk({ getPermissions });
    expect((await checkAiOp(d, removeWidget, JSON.stringify({ id: 43 }))).ok).toBe(true);
    expect(await checkAiOp(d, removeWidget, JSON.stringify({ id: 42 }))).toMatchObject({ ok: false, stage: "permission" });
    expect(getPermissions).toHaveBeenCalledTimes(2);
  });

  it("GW-6: reference", async () => {
    expect(await checkAiOp(mk(), removeWidget, JSON.stringify({ id: 999 }))).toMatchObject({ ok: false, stage: "reference" });
    const d = mk();
    expect((await checkAiOp(d, removeWidget, JSON.stringify({ id: 42 }))).ok).toBe(true);
    expect(await checkAiOp(d, patch, pat("widget", 42, { show_popup: true }))).toMatchObject({ ok: false, stage: "reference" });
    const d2 = mk({ shadow: createShadow({ ...snap(), widgets: [...snap().widgets, { id: -1, type: "bar", title: "x" }] }) });
    expect(await checkAiOp(d2, addWidget, add({ tempId: -1 }))).toMatchObject({ ok: false, stage: "reference" });
    const d3 = mk();
    expect((await checkAiOp(d3, addWidget, add())).ok).toBe(true);
    expect(await checkAiOp(d3, addWidget, add())).toMatchObject({ ok: false, stage: "reference" });
  });

  it("GW-7: live_schema", async () => {
    const r = await checkAiOp(mk({ dashboardTableIds: () => [5, 7, 8] }), addWidget, add({ tableId: 8 }));
    expect(r).toMatchObject({ ok: false, stage: "live_schema", reasons: ["table 8 is not available"] });
    const typo = await checkAiOp(mk(), addWidget, add({ metric: "fare_amout" }));
    expect(typo.ok).toBe(false);
    if (!typo.ok) {
      expect(typo.stage).toBe("live_schema");
      const t = typo.reasons.join(" | ");
      expect(t).toContain("column `fare_amout` not found");
      expect(t).toContain("did you mean `fare_amount`");
    }
    const noTable = JSON.stringify({ tempId: -1, type: "bar", title: "T", metric: "fare_amount", aggregation: "sum", groupByColumn: "vendor_id" });
    expect(await checkAiOp(mk(), addWidget, noTable)).toMatchObject({ ok: false, stage: "reference" });
  });

  it("GW-8: stage order", async () => {
    const both = await checkAiOp(mk({ getPermissions: () => new Set() }), addWidget, "nope");
    expect(both).toMatchObject({ stage: "shape" });
    const d = mk({ getPermissions: () => new Set() });
    expect(await checkAiOp(d, addWidget, add({ tableId: 8 }))).toMatchObject({ ok: false, stage: "permission" });
    expect(d.liveSchema.describe).not.toHaveBeenCalled();
  });

  it("GW-9: success updates shadow", async () => {
    const d = mk();
    const r = await checkAiOp(d, addWidget, add({ type: "map", tempId: -2, tableId: undefined, metric: undefined, aggregation: undefined, groupByColumn: undefined }));
    expect(r).toMatchObject({ ok: true, label: 'Added map "T" below existing content' });
    expect((await checkAiOp(d, patch, pat("widget", -2, { show_popup: true }))).ok).toBe(true);
    expect((await checkAiOp(d, removeWidget, JSON.stringify({ id: 42 }))).ok).toBe(true);
    expect(await checkAiOp(d, patch, pat("widget", 42, { show_popup: true }))).toMatchObject({ ok: false, stage: "reference" });
    expect(AI_COLUMN_BINDING_KEYS).toContain("metricColumn");
  });
});

// ---------------------------------------------------------------- Phase 136 (GW6-)
const patchTypeTools = rawOp;
const raw = (o: Record<string, unknown>) => JSON.stringify(o);
const FULL = JSON.stringify(REGISTERED);
const snap6 = (over: Record<string, unknown> = {}) => ({
  widgets: [
    { id: 1, type: "bar", title: "Revenue", tableId: 5, layout: { x: 0, y: 0, w: 18, h: 30 }, binding: { groupByColumn: "vendor_id" } },
    { id: 2, type: "table", title: "Rows", tableId: 5, layout: { x: 18, y: 0, w: 18, h: 30 } },
    { id: 3, type: "bar", title: "Two", tableId: 5, layout: { x: 0, y: 30, w: 18, h: 30 }, binding: { groupByColumns: ["vendor_id", "geom"] } },
    { id: 4, type: "line", title: "Dv", tableId: 5, layout: { x: 18, y: 30, w: 18, h: 30 }, dynamicViewId: 90 },
  ],
  layers: [],
  dynamicViews: [{ id: 90, name: "dv" }],
  filters: [],
  ...over,
});
const mk6 = (snapshot: ReturnType<typeof snap6> | ReturnType<typeof snap> = snap6(), o: Partial<GatewayDeps> = {}) => mk({ shadow: createShadow(snapshot as never), ...o });
const fails: unknown[] = [];
const run = async (d: GatewayDeps, t: MutateTool, a: string) => {
  const r = await checkAiOp(d, t, a);
  if (!r.ok) fails.push(r);
  return r;
};

describe("checkAiOp gateway (phase 136)", () => {
  it("GW6-1: positive catalogue rejects sql/customWhere/etc, accepts catalogue-only", async () => {
    for (const bad of [{ sql: "select 1" }, { customWhere: "1=1" }, { drillDownColumn: "x" }, { layout: { x: 0 } }, { metricColumn: "fare_amount" }, { colour: "#ff0000" }, { aggregation: "SUM) FROM x" }]) {
      const r = await run(mk(), addWidget, add(bad));
      expect(r, JSON.stringify(bad)).toMatchObject({ ok: false, stage: "allow_list" });
    }
    const sql = await run(mk(), addWidget, add({ config: { sql: "select 1" } }));
    if (!sql.ok) expect(sql.reasons.join(" ")).toContain("sql");
    expect((await run(mk(), addWidget, add())).ok).toBe(true);
  });

  it("GW6-2: table rules and D-22", async () => {
    const noTable = await run(mk(), addWidget, add({ tableId: undefined }));
    expect(noTable).toMatchObject({ ok: false, stage: "reference", reasons: ["tableId is required for bar"] });
    const mapT = await run(mk(), addWidget, add({ type: "map", metric: undefined, aggregation: undefined, groupByColumn: undefined, tableId: 5 }));
    expect(mapT).toMatchObject({ ok: false, reasons: ["map widgets have no table"] });
    const off = await run(mk(), addWidget, add({ tableId: 6 }));
    expect(off).toMatchObject({ ok: false, stage: "reference", reasons: ["table 6 isn't on this dashboard; add it in dashboard settings first"] });
    const a = await run(mk(), addWidget, add({ tableId: 9 }));
    const b = await run(mk(), addWidget, add({ tableId: 999 }));
    expect(a).toMatchObject({ ok: false, stage: "reference" });
    expect(JSON.stringify((a as { reasons: string[] }).reasons).replace("9", "N")).toBe(JSON.stringify((b as { reasons: string[] }).reasons).replace("999", "N"));
    expect((a as { reasons: string[] }).reasons[0]).toBe("table 9 is not available; use list_tables for valid ids");
  });

  it("GW6-4: closest-name hints", async () => {
    const hint = async (m: string) => { const r = await run(mk(), addWidget, add({ tableId: 5, metric: m })); expect(r.ok).toBe(false); return r.ok ? "" : r.reasons.join(" | "); };
    expect(await hint("fare")).toContain("did you mean `fare_amount`");
    const am = await hint("amount");
    expect(am).toContain("`fare_amount`"); expect(am).toContain("`total_amount`");
    expect(await hint("FARE_AMOUNT")).toContain("did you mean `fare_amount`");
    for (const m of ["amount", "a", "pickup", "_"]) expect(((await hint(m)).match(/`/g) ?? []).length).toBeLessThanOrEqual(2 + 6);
  });

  it("GW6-3: D-17 no disclosure of inaccessible tables", async () => {
    expect(FULL).toContain("fare_secret"); // positive control: the sentinel exists in the registry fixture
    expect(FULL).toContain("secret_trips");
    const r = await run(mk(), addWidget, add({ tableId: 5, metric: "fare" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toContain("fare_amount");
    await run(mk(), addWidget, add({ tableId: 5, metric: "fare_secre" }));
    await run(mk(), addWidget, add({ tableId: 5, groupByColumn: "secret" }));
    await run(mk(), addWidget, add({ tableId: 9 }));
    await run(mk(), addWidget, add({ tableId: 9, metric: "fare_secret" }));
    expect(fails.length).toBeGreaterThan(4);
    for (const f of fails) {
      const j = JSON.stringify(f);
      expect(j).not.toContain("fare_secret");
      expect(j).not.toContain("secret_trips");
      expect(j).not.toContain("secret.");
    }
  });

  it("GW6-5: numeric checks", async () => {
    const bad = await run(mk(), addWidget, add({ tableId: 5, metric: "vendor_id" }));
    expect(bad).toMatchObject({ ok: false, stage: "live_schema" });
    if (!bad.ok) expect(bad.reasons.join(" ")).toContain("column vendor_id is not numeric");
    expect((await run(mk(), addWidget, add({ tableId: 5, metric: "vendor_id", aggregation: "count" }))).ok).toBe(true);
    expect((await run(mk(), addWidget, add({ tableId: 5, metric: "geom" }))).ok).toBe(true);
  });

  it("GW6-6: placement", async () => {
    const one = snap6({ widgets: [{ id: 1, type: "bar", title: "A", tableId: 5, layout: { x: 0, y: 0, w: 18, h: 30 } }] });
    const d = mk6(one as never);
    const r = await run(d, addWidget, add({ tableId: 5, title: "Fares" }));
    expect(r).toMatchObject({ ok: true, label: 'Added bar "Fares" at row 0, column 18' });
    if (r.ok && r.op.op === "add_widget") expect(r.op.layout).toEqual({ x: 18, y: 0, w: 18, h: 30 });
    const full = snap6({ widgets: [
      { id: 1, type: "bar", title: "A", tableId: 5, layout: { x: 0, y: 0, w: 18, h: 30 } },
      { id: 2, type: "bar", title: "B", tableId: 5, layout: { x: 18, y: 0, w: 18, h: 30 } }] });
    const d2 = mk6(full as never);
    const before = [...d2.shadow.widgets.values()].map((w) => w.rect);
    const r2 = await run(d2, addWidget, add({ tableId: 5, title: "Fares" }));
    expect(r2).toMatchObject({ ok: true, label: 'Added bar "Fares" below existing content' });
    if (r2.ok && r2.op.op === "add_widget") {
      expect(r2.op.layout).toBeDefined();
      for (const b of before) expect(rectsOverlap(r2.op.layout!, b)).toBe(false);
    }
  });

  it("GW6-8: change_widget_type", async () => {
    const ct = (id: number, type: string) => raw({ op: "change_widget_type", id, type });
    expect((await run(mk6(), patchTypeTools, ct(1, "line"))).ok).toBe(true);
    expect(await run(mk6(), patchTypeTools, ct(2, "bar"))).toMatchObject({ ok: false, reasons: ["only bar, line and pie charts can switch type; remove it and add a new one instead"] });
    expect(await run(mk6(), patchTypeTools, ct(3, "pie"))).toMatchObject({ ok: false, reasons: ["a pie chart shows one group-by column; remove the extra group-by first"] });
    expect((await run(mk6(), patchTypeTools, ct(3, "line"))).ok).toBe(true);
  });

  it("GW6-9: D-04 chart table change refused", async () => {
    const r = await run(mk6(), patch, pat("widget", 1, { tableId: 7 }));
    expect(r).toMatchObject({ ok: false, reasons: ["a chart's table can't be changed; add a new widget for the other table"] });
  });

  it("GW6-10: dv-bound widgets refuse edits", async () => {
    const msg = "this chart uses a dynamic view; the AI can't edit it yet";
    expect(await run(mk6(), patch, pat("widget", 4, { color: "sky" }))).toMatchObject({ ok: false, reasons: [msg] });
    expect(await run(mk6(), patchTypeTools, raw({ op: "set_widget_title", id: 4, title: "x" }))).toMatchObject({ ok: false, reasons: [msg] });
  });

  it("GW6-14: refKey, slot and label", async () => {
    const r = await run(mk(), addWidget, add({ tableId: 5, metric: "fare", title: "Fares" }));
    expect(r).toMatchObject({ ok: false, refKey: "col:5:fare", slot: "new:-1", label: 'Add bar "Fares"' });
    const p = await run(mk(), patch, pat("widget", 77, { show_popup: true }));
    expect(p).toMatchObject({ ok: false, stage: "reference", refKey: "ref:widget:77", slot: "widget:77" });
  });

  it("GW6-15: empty patch", async () => {
    expect(await run(mk(), patch, pat("widget", 43, {}))).toMatchObject({ ok: false, stage: "shape", reasons: ["nothing to change; pass at least one setting"] });
  });
});
