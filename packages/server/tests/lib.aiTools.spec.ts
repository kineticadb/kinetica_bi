import { parseAiOp } from "@kinetica-bi/shared";
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { READ_TOOLS, LIST_TABLES_CAP, LIST_TABLES_CONCURRENCY } from "../src/lib/ai/tools/read";
import { MUTATE_TOOLS } from "../src/lib/ai/tools/mutate";
import type { ToolContext, LiveSchemaPort, LiveTableInfo, ReadTool, MutateTool } from "../src/lib/ai/tools/types";

const CANARY = "CANARY_ROW_VALUE_9f3";
const byName = <T extends { name: string }>(l: readonly T[], n: string): T => l.find((t) => t.name === n)!;

function ctx(over: Partial<ToolContext> & { tables?: { id: number; schema: string; name: string; description?: string }[] }): ToolContext {
  const tables = over.tables ?? [];
  return {
    username: "u",
    dashboardId: 1,
    dataAccess: "schema",
    dashboardView: () => ({ dashboardId: 1, widgets: [], layers: [], dynamicViews: [], filters: [] }),
    dashboardTableIds: () => [],
    registeredTables: () => tables,
    liveSchema: { describe: async () => ({ ok: false }) },
    ...over,
  };
}
const tbl = (id: number) => ({ id, schema: "s", name: `t${id}` });
const info = (id: number): LiveTableInfo => ({ id, schema: "s", name: `t${id}`, columns: [{ name: "c", type: "int" }] });
const text = (r: { parts: { text: string }[] }) => r.parts.map((p) => p.text).join("\n");

describe("AI tools", () => {
  it("TL-1 list_tables only accessible, dashboard tables first, schema class", async () => {
    const ok = new Set([1, 2, 4]);
    const port: LiveSchemaPort = { describe: async (id) => (ok.has(id) ? { ok: true, table: info(id) } : { ok: false }) };
    const r = await byName(READ_TOOLS, "list_tables").run({}, ctx({ tables: [1, 2, 3, 4, 5].map(tbl), dashboardTableIds: () => [4], liveSchema: port }));
    const body = JSON.parse(r.parts[0].text);
    expect(body.tables.map((t: { id: number }) => t.id)).toEqual([4, 1, 2]);
    expect(body.tables[0]).toMatchObject({ schema: "s", name: "t4", columnCount: 1 });
    expect(r.parts.every((p) => p.cls === "schema")).toBe(true);
  });
  it("TL-2 cap and concurrency", async () => {
    let inflight = 0, max = 0, calls = 0;
    const port: LiveSchemaPort = {
      describe: async (id) => {
        calls++; inflight++; max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 1));
        inflight--;
        return { ok: true, table: info(id) };
      },
    };
    const tables = Array.from({ length: 80 }, (_, i) => tbl(i + 1));
    const r = await byName(READ_TOOLS, "list_tables").run({}, ctx({ tables, liveSchema: port }));
    expect(calls).toBe(LIST_TABLES_CAP);
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(LIST_TABLES_CONCURRENCY);
    expect(text(r)).toContain("30 more tables not shown; ask about a specific table");
  });
  it("TL-3 describe_table accessible vs inaccessible/unregistered identical", async () => {
    const port: LiveSchemaPort = { describe: async (id) => (id === 1 ? { ok: true, table: info(1) } : { ok: false }) };
    const c = ctx({ tables: [tbl(1), tbl(2)], liveSchema: port });
    const t = byName(READ_TOOLS, "describe_table");
    const good = await t.run({ tableId: 1 }, c);
    expect(JSON.parse(good.parts[0].text)).toEqual({ id: 1, schema: "s", name: "t1", columns: [{ name: "c", type: "int" }] });
    const denied = await t.run({ tableId: 2 }, c);
    const missing = await t.run({ tableId: 99 }, c);
    expect(denied.isError).toBe(true);
    expect(text(denied)).toBe("Table 2 is not available.");
    expect(text(missing)).toBe("Table 99 is not available.");
  });
  it("TL-4 serializer allow-list (positive control)", async () => {
    const dirty = { id: 1, schema: "s", name: "t1", description: "d".repeat(500), secret: CANARY, columns: [{ name: "c", type: "int", sample: CANARY }] } as unknown as LiveTableInfo;
    expect(JSON.stringify(dirty)).toContain(CANARY);
    const c = ctx({ tables: [tbl(1)], liveSchema: { describe: async () => ({ ok: true, table: dirty }) } });
    for (const [n, a] of [["describe_table", { tableId: 1 }], ["list_tables", {}]] as const) {
      const r = await byName(READ_TOOLS, n).run(a, c);
      expect(text(r)).not.toContain(CANARY);
      expect(text(r)).toContain("d".repeat(200));
      expect(text(r)).not.toContain("d".repeat(201));
    }
  });
  it("TL-5 get_dashboard", async () => {
    const c = ctx({});
    const r = await byName(READ_TOOLS, "get_dashboard").run({}, c);
    expect(r.parts).toEqual([{ cls: "config", text: JSON.stringify(c.dashboardView()) }]);
  });
  it("TL-6 mutate toOp (patch/remove)", () => {
    expect(byName(MUTATE_TOOLS, "patch").toOp({ targetKind: "widget", targetId: 42, changes: { show_popup: true } })).toEqual({
      op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { show_popup: true } },
    });
    for (const n of ["remove_widget", "remove_layer", "remove_dynamic_view"]) expect(byName(MUTATE_TOOLS, n).toOp({ id: 5 })).toEqual({ op: n, id: 5 });
  });
  it("TOOL6-1 add_widget toOp", () => {
    const t = byName(MUTATE_TOOLS, "add_widget");
    expect(t.toOp({ tempId: -1, type: "bar", title: "Fares", tableId: 5, metric: "fare_amount", aggregation: "sum", groupBy: "vendor_id", sortDir: "DESC", topN: "10", colour: "teal", showLegend: true, valueLabel: "Fare" })).toEqual({
      op: "add_widget", tempId: -1, type: "bar", title: "Fares",
      config: { tableId: 5, metric: "fare_amount", aggregation: "sum", groupByColumn: "vendor_id", sortDir: "DESC", limit: 10, color: "teal", showLegend: true, yFieldLabel: "Fare" },
    });
    const m = t.toOp({ tempId: -2, type: "map", title: "M" }) as { config: unknown; layout?: unknown };
    expect(m.config).toEqual({});
    expect("layout" in m).toBe(false);
  });
  it("TOOL6-2 edit_widget toOp", () => {
    const t = byName(MUTATE_TOOLS, "edit_widget");
    expect(t.toOp({ id: 12, aggregation: "avg", topN: "25", colour: "amber" })).toEqual({
      op: "patch", action: { target: { kind: "widget", id: 12 }, configPatch: { aggregation: "avg", limit: 25, color: "amber" } },
    });
    expect(t.toOp({ id: 12 })).toEqual({ op: "patch", action: { target: { kind: "widget", id: 12 }, configPatch: {} } });
  });
  it("TOOL6-3 rename / retype / layout", () => {
    expect(byName(MUTATE_TOOLS, "rename_widget").toOp({ id: 3, title: "New" })).toEqual({ op: "set_widget_title", id: 3, title: "New" });
    expect(byName(MUTATE_TOOLS, "change_widget_type").toOp({ id: 3, type: "line" })).toEqual({ op: "change_widget_type", id: 3, type: "line" });
    const items = [{ id: 3, x: 0, y: 0, w: 12, h: 10 }];
    expect(byName(MUTATE_TOOLS, "set_layout").toOp({ items })).toEqual({ op: "set_layout", items });
  });
  it("TOOL6-4 add_heatmap_layer toOp", () => {
    const t = byName(MUTATE_TOOLS, "add_heatmap_layer");
    const base = { tempId: -2, tableId: 5, spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude", ramp: "plasma", blurRadius: 8, opacity: 0.6, weightColumn: "fare_amount", name: "Pickups" };
    const op = t.toOp(base) as Record<string, unknown>;
    expect("widgetId" in op).toBe(false);
    expect(op).toEqual({
      op: "add_layer", tempId: -2, tableId: 5, renderMode: "heatmap", spatialMode: "latlon", latColumn: "pickup_latitude", lonColumn: "pickup_longitude", name: "Pickups",
      style: { colormap: "plasma", blurRadius: 8, opacity: 0.6, valueColumn: "fare_amount" },
    });
    expect((t.toOp({ ...base, mapWidgetId: 7 }) as { widgetId: number }).widgetId).toBe(7);
  });
  it("TOOL6-5 edit_heatmap_layer / set_layer_visibility", () => {
    expect(byName(MUTATE_TOOLS, "edit_heatmap_layer").toOp({ id: 4, ramp: "viridis", reverseRamp: true })).toEqual({
      op: "patch", action: { target: { kind: "layer", id: 4 }, configPatch: { colormap: "viridis", reverseColormap: true } },
    });
    expect(byName(MUTATE_TOOLS, "set_layer_visibility").toOp({ id: 4, visible: false })).toEqual({
      op: "patch", action: { target: { kind: "layer", id: 4 }, configPatch: { visible: false } },
    });
  });
  it("TOOL6-6 arg schemas reject out-of-vocabulary values", () => {
    const aw = byName(MUTATE_TOOLS, "add_widget").args;
    const ok = { tempId: -1, type: "bar", title: "T" };
    expect(aw.safeParse(ok).success).toBe(true);
    for (const bad of [{ colour: "#ff0000" }, { colour: "red" }, { aggregation: "median" }, { topN: "7" }, { sql: "select 1" }]) expect(aw.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    const ew = byName(MUTATE_TOOLS, "edit_widget").args;
    expect(ew.safeParse({ id: 1, colour: "teal" }).success).toBe(true);
    expect(ew.safeParse({ id: 1, sql: "x" }).success).toBe(false);
    expect(ew.safeParse({ id: 1, colour: "#fff" }).success).toBe(false);
    const hl = byName(MUTATE_TOOLS, "add_heatmap_layer").args;
    const h = { tempId: -1, tableId: 1, spatialMode: "wkt", wktColumn: "g" };
    expect(hl.safeParse(h).success).toBe(true);
    for (const bad of [{ ramp: "cividis" }, { blurRadius: 40 }, { opacity: 2 }]) expect(hl.safeParse({ ...h, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
  it("TOOL6-7 no config/sql/layout property or composite in mutate schemas", () => {
    const walk = (n: unknown, path: string, out: string[]) => {
      if (Array.isArray(n)) n.forEach((x, i) => walk(x, `${path}[${i}]`, out));
      else if (n && typeof n === "object") {
        for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
          if (["anyOf", "oneOf", "$ref"].includes(k)) out.push(`${path}.${k}`);
          if (k === "properties" && v && typeof v === "object") for (const p of Object.keys(v)) if (["config", "sql", "layout"].includes(p)) out.push(`${path}.properties.${p}`);
          walk(v, `${path}.${k}`, out);
        }
      }
    };
    for (const t of MUTATE_TOOLS) {
      if (t.name === "patch") continue; // dynamic-view patch keeps its free `changes` record
      const out: string[] = [];
      walk(z.toJSONSchema(t.args), t.name, out);
      expect(out, t.name).toEqual([]);
    }
  });
  it("TL-7 tool names", () => {
    expect(READ_TOOLS.map((t: ReadTool) => t.name)).toEqual(["get_dashboard", "list_tables", "describe_table"]);
    expect(MUTATE_TOOLS.map((t: MutateTool) => t.name)).toEqual(["add_widget", "edit_widget", "rename_widget", "change_widget_type", "set_layout", "add_heatmap_layer", "edit_heatmap_layer", "set_layer_visibility", "patch", "apply_filter", "clear_filter", "remove_widget", "remove_layer", "remove_dynamic_view"]);
  });
});

describe("filter tools (138)", () => {
  const af = () => byName(MUTATE_TOOLS, "apply_filter");
  const cf = () => byName(MUTATE_TOOLS, "clear_filter");
  it("TOOLF-1 apply_filter source", () => {
    expect(af().toOp({ column: "payment_type", value: "Credit" })).toEqual({ op: "apply_filter", filters: [{ column: "payment_type", operator: "eq", value: "Credit" }] });
    expect(af().toOp({ column: "payment_type", value: "Credit", tableId: 5 })).toMatchObject({ source: { kind: "table", id: 5 } });
    expect(af().toOp({ column: "payment_type", value: "Credit", dynamicViewId: 90 })).toMatchObject({ source: { kind: "dynamicView", id: 90 } });
    expect(parseAiOp(af().toOp({ column: "c", value: "v", tableId: 5, dynamicViewId: 90 })).ok).toBe(false);
  });
  it("TOOLF-2 operators", () => {
    expect(af().toOp({ column: "c", operator: "in", values: ["a", "b"] })).toMatchObject({ filters: [{ value: ["a", "b"] }] });
    expect(af().toOp({ column: "c", operator: "between", from: "1", to: "5" })).toMatchObject({ filters: [{ value: ["1", "5"] }] });
    const half = af().toOp({ column: "c", operator: "between", from: "1" }) as { filters: Record<string, unknown>[] };
    expect("value" in half.filters[0]).toBe(false);
    expect(af().toOp({ column: "c", operator: "isNull" })).toMatchObject({ filters: [{ value: null }] });
  });
  it("TOOLF-3 clear_filter", () => {
    expect(cf().toOp({})).toEqual({ op: "clear_filter" });
    expect(cf().toOp({ tableId: 5 })).toEqual({ op: "clear_filter", source: { kind: "table", id: 5 } });
    expect(cf().toOp({ tableId: 5, column: "vendor_id" })).toEqual({ op: "clear_filter", source: { kind: "table", id: 5 }, column: "vendor_id" });
    expect(cf().toOp({ column: "vendor_id" })).toEqual({ op: "clear_filter", column: "vendor_id" });
  });
});
