// 142 UAT: the AI adds a timeline (binned time trend) instead of a line grouped by a raw timestamp.
import { describe, it, expect, vi } from "vitest";
import { checkAiOp, type GatewayDeps } from "../src/lib/ai/gateway";
import { createShadow } from "../src/lib/ai/shadow";
import { MUTATE_TOOLS } from "../src/lib/ai/tools/mutate";
import { AI_SYSTEM_RULES, projectSnapshot } from "../src/lib/ai/context";
import { buildGenerateRecipe } from "../src/lib/ai/generateMode";
import type { LiveSchemaPort, MutateTool } from "../src/lib/ai/tools/types";

const tool = (n: string): MutateTool => MUTATE_TOOLS.find((t) => t.name === n)!;
const T5 = {
  id: 5, schema: "demo", name: "nyctaxi", columns: [
    { name: "pickup_datetime", type: "timestamp" }, { name: "pickup_day", type: "date" }, { name: "fare_amount", type: "float" },
    { name: "vendor_id", type: "string(char4)" }, { name: "trip_seconds", type: "long" }, { name: "mystery" },
  ],
};
const live = (): LiveSchemaPort => ({ describe: vi.fn(async (id: number) => (id === 5 ? { ok: true as const, table: T5 } : { ok: false as const })) });
const snap = () => ({
  widgets: [{ id: 44, type: "timeline", title: "Fares over time", tableId: 5, binding: { metric: "fare_amount", aggregation: "sum", timeColumn: "pickup_datetime" } }],
  layers: [],
  dynamicViews: [{ id: -7, name: "AI view", baseTableId: 5, columns: [{ name: "pickup_datetime", type: "timestamp" }, { name: "fare_amount", type: "float" }] }],
  filters: [],
});
const mk = (o: Partial<GatewayDeps> = {}): GatewayDeps => ({
  username: "ann", dashboardId: 1, shadow: createShadow(snap()), liveSchema: live(),
  getPermissions: vi.fn(() => new Set(["dashboards:view", "ai:use"])), canViewDashboard: vi.fn(() => true), dashboardTableIds: () => [5], ...o,
});
const addTl = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ tempId: -1, type: "timeline", title: "Fares over time", tableId: 5, timeColumn: "pickup_datetime", metric: "fare_amount", aggregation: "sum", ...o });

describe("AI timeline: gateway", () => {
  it("GWTL-1 the add_widget tool maps timeColumn; a valid timeline passes and is placed", async () => {
    const r = await checkAiOp(mk(), tool("add_widget"), addTl({ colour: "teal", valueLabel: "Fares" }));
    expect(r.ok).toBe(true);
    if (r.ok && r.op.op === "add_widget") {
      expect(r.op.type).toBe("timeline");
      expect(r.op.config).toEqual({ tableId: 5, timeColumn: "pickup_datetime", metric: "fare_amount", aggregation: "sum", color: "teal", yFieldLabel: "Fares" });
      expect(r.op.layout).toMatchObject({ w: 18, h: 30 });
    }
    const date = await checkAiOp(mk(), tool("add_widget"), addTl({ timeColumn: "pickup_day" }));
    expect(date.ok).toBe(true);
  });

  it("GWTL-2 a non-temporal timeColumn is skipped at live_schema with a clear reason", async () => {
    for (const col of ["vendor_id", "trip_seconds", "fare_amount"]) {
      const r = await checkAiOp(mk(), tool("add_widget"), addTl({ timeColumn: col }));
      expect(r).toMatchObject({ ok: false, stage: "live_schema", refKey: `col:5:${col}` });
      if (!r.ok) expect(r.reasons).toEqual([`column ${col} is not a date or time column`]);
    }
  });

  it("GWTL-3 a missing timeColumn reads like any missing column; an untyped one is not refused", async () => {
    const r = await checkAiOp(mk(), tool("add_widget"), addTl({ timeColumn: "pickup_time" }));
    expect(r).toMatchObject({ ok: false, stage: "live_schema" });
    if (!r.ok) expect(r.reasons[0]).toMatch(/^column `pickup_time` not found on table demo\.nyctaxi/);
    expect((await checkAiOp(mk(), tool("add_widget"), addTl({ timeColumn: "mystery" }))).ok).toBe(true);
  });

  it("GWTL-4 the timeline catalogue is enforced (required keys, no group-by)", async () => {
    const miss = await checkAiOp(mk(), tool("add_widget"), addTl({ timeColumn: undefined }));
    expect(miss).toMatchObject({ ok: false, stage: "allow_list" });
    if (!miss.ok) expect(miss.reasons).toContain("missing required field timeColumn");
    const grp = await checkAiOp(mk(), tool("add_widget"), addTl({ groupBy: "vendor_id" }));
    expect(grp).toMatchObject({ ok: false, stage: "allow_list" });
    if (!grp.ok) expect(grp.reasons).toContain('config key "groupByColumn" is not allowed for timeline');
  });

  it("GWTL-5 a timeline is table-bound: dynamicViewId on add and a rebind are refused", async () => {
    const dv = await checkAiOp(mk(), tool("add_widget"), addTl({ tableId: undefined, dynamicViewId: -7 }));
    expect(dv).toMatchObject({ ok: false, stage: "reference" });
    if (!dv.ok) expect(dv.reasons).toEqual(["a timeline can't use a dynamic view yet; pass tableId"]);
    const rebind = await checkAiOp(mk(), tool("edit_widget"), JSON.stringify({ id: 44, dynamicViewId: -7 }));
    expect(rebind).toMatchObject({ ok: false, stage: "allow_list" });
    if (!rebind.ok) expect(rebind.reasons).toEqual(["a timeline can't be edited yet; remove it and add a new one"]);
  });

  it("GWTL-6 edit_widget on a timeline is refused with a usable reason", async () => {
    const r = await checkAiOp(mk(), tool("edit_widget"), JSON.stringify({ id: 44, colour: "amber" }));
    expect(r).toMatchObject({ ok: false, stage: "allow_list" });
    if (!r.ok) expect(r.reasons).toEqual(["a timeline can't be edited yet; remove it and add a new one"]);
  });
});

describe("AI timeline: model guidance", () => {
  it("GUIDETL-1 add_widget description and system rules steer trends to timeline", () => {
    const d = tool("add_widget").description;
    expect(d).toContain("timeline");
    expect(d).toContain("timeColumn");
    expect(d).toMatch(/line .*groups by raw values/);
    expect(AI_SYSTEM_RULES).toMatch(/trend over a date or timestamp column.*timeline/);
    expect(AI_SYSTEM_RULES.split("\n").length).toBeLessThanOrEqual(30);
  });
  it("GUIDETL-2 the generate recipe's trend slot is a timeline", () => {
    const s = buildGenerateRecipe("schema");
    expect(s).toContain("One time trend (type timeline)");
    expect(s).not.toContain("(type line)");
  });
  it("GUIDETL-3 the snapshot projection shows a timeline's time column to the model", () => {
    const v = projectSnapshot({ dashboardId: 1, question: "q", snapshot: snap(), turns: [] }, { id: 1 });
    expect(v.widgets[0].binding).toEqual({ metric: "fare_amount", aggregation: "sum", timeColumn: "pickup_datetime" });
  });
});
