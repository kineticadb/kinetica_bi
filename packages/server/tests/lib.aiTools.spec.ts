import { describe, it, expect } from "vitest";
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
  it("TL-6 mutate toOp", () => {
    expect(byName(MUTATE_TOOLS, "add_widget").toOp({ tempId: -1, type: "bar", title: "T", tableId: 7, config: { metricColumn: "fare_amount" } })).toEqual({
      op: "add_widget", tempId: -1, type: "bar", title: "T", config: { metricColumn: "fare_amount", tableId: 7 },
    });
    expect(byName(MUTATE_TOOLS, "patch").toOp({ targetKind: "widget", targetId: 42, changes: { show_popup: true } })).toEqual({
      op: "patch", action: { target: { kind: "widget", id: 42 }, configPatch: { show_popup: true } },
    });
    for (const n of ["remove_widget", "remove_layer", "remove_dynamic_view"]) expect(byName(MUTATE_TOOLS, n).toOp({ id: 5 })).toEqual({ op: n, id: 5 });
  });
  it("TL-7 tool names", () => {
    expect(READ_TOOLS.map((t: ReadTool) => t.name)).toEqual(["get_dashboard", "list_tables", "describe_table"]);
    expect(MUTATE_TOOLS.map((t: MutateTool) => t.name)).toEqual(["add_widget", "patch", "remove_widget", "remove_layer", "remove_dynamic_view"]);
  });
});
