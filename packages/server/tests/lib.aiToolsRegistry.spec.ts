import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { buildToolRegistry, sanitizeToolSchema, QUERY_TOOL_NAMES } from "../src/lib/ai/tools/registry";
import type { ReadTool } from "../src/lib/ai/tools/types";
import { QUERY_TOOLS } from "../src/lib/ai/tools/query";

const FORBIDDEN = ["$ref", "anyOf", "oneOf", "allOf", "not", "$schema", "additionalProperties", "propertyNames", "$defs", "definitions"];
const MAXSAFE = 9007199254740991;
function findBad(node: unknown, path = ""): string[] {
  if (Array.isArray(node)) return node.flatMap((x, i) => findBad(x, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => {
      const here: string[] = [];
      if (FORBIDDEN.includes(k)) here.push(`${path}.${k}`);
      if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) === MAXSAFE) here.push(`${path}.${k}`);
      return [...here, ...findBad(v, `${path}.${k}`)];
    });
  }
  return [];
}
const fake = (name: string): ReadTool => ({ kind: "read", name, description: "x", args: z.object({}), run: async () => ({ parts: [] }) });

describe("tool registry", () => {
  it("REG-1 schema mode has 18 tools", () => {
    const r = buildToolRegistry({ dataAccess: "schema" });
    expect(r.tools.map((t) => t.name).sort()).toEqual(
      ["add_dynamic_view", "add_heatmap_layer", "add_widget", "apply_filter", "change_widget_type", "clear_filter", "describe_table", "edit_heatmap_layer", "edit_widget", "get_dashboard", "list_tables", "patch", "remove_dynamic_view", "remove_layer", "remove_widget", "rename_widget", "set_layer_visibility", "set_layout"],
    );
    expect(r.specs).toHaveLength(18);
    for (const t of r.tools) expect(r.byName.get(t.name)).toBe(t);
  });
  it("REG-2 flat schemas, walker has positive control", () => {
    for (const s of buildToolRegistry({ dataAccess: "schema" }).specs) expect(findBad(s.jsonSchema), s.name).toEqual([]);
    const raw = sanitizeToolSchema(z.toJSONSchema(z.object({ a: z.union([z.string(), z.number()]) })) as Record<string, unknown>);
    expect(findBad(raw)).toContain(".properties.a.anyOf");
    const unionTool: ReadTool = { ...fake("u"), args: z.object({ a: z.union([z.string(), z.number()]) }) };
    expect(() => buildToolRegistry({ dataAccess: "schema", extraTools: [unionTool] })).toThrow();
  });
  it("REG-3 query gate both directions", () => {
    expect(QUERY_TOOL_NAMES).toEqual(["run_query", "get_column_profile"]);
    expect(buildToolRegistry({ dataAccess: "schema", extraTools: [fake("run_query")] }).byName.has("run_query")).toBe(false);
    expect(buildToolRegistry({ dataAccess: "query", extraTools: [fake("run_query")] }).byName.has("run_query")).toBe(true);
    expect(buildToolRegistry({ dataAccess: "schema", extraTools: [fake("other")] }).byName.has("other")).toBe(true);
  });
  it("REG-4 duplicate names throw", () => {
    expect(() => buildToolRegistry({ dataAccess: "schema", extraTools: [fake("list_tables")] })).toThrow(/duplicate/i);
  });
  it("REG-5a schema mode hides QUERY_TOOLS", () => {
    const r = buildToolRegistry({ dataAccess: "schema", extraTools: [...QUERY_TOOLS] });
    expect(r.tools).toHaveLength(18);
    expect(r.byName.has("run_query")).toBe(false);
    expect(r.byName.has("get_column_profile")).toBe(false);
    expect(r.specs.some((s) => s.name === "run_query" || s.name === "get_column_profile")).toBe(false);
  });
  it("REG-5b query mode registers both with flat schemas", () => {
    const r = buildToolRegistry({ dataAccess: "query", extraTools: [...QUERY_TOOLS] });
    expect(r.tools).toHaveLength(20);
    const props = (n: string) => Object.keys(((r.specs.find((s) => s.name === n)!.jsonSchema as { properties: Record<string, unknown> }).properties)).sort();
    expect(props("run_query")).toEqual(["sql"]);
    expect(props("get_column_profile")).toEqual(["column", "tableId"]);
  });
});
