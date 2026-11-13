// 152-02 (VIEWAI-V22-02): every registered tool/op is classified; unclassified is refused by default.
import { describe, it, expect } from "vitest";
import { AiOpSchema } from "@kinetica-bi/shared";
import { buildToolRegistry } from "../src/lib/ai/tools/registry";
import { QUERY_TOOLS } from "../src/lib/ai/tools/query";
import {
  VIEWER_AI_TOOL_CLASS, VIEWER_AF_ALLOWED_OPS, VIEWER_AF_REFUSED_OPS,
  isToolAllowedForViewerMode, isOpAllowedForViewerMode,
} from "../src/lib/viewerAi";

const reg = () => buildToolRegistry({ dataAccess: "query", extraTools: [...QUERY_TOOLS] });
/** Names present on one side only (registered-but-unclassified, classified-but-gone). */
const drift = (names: string[]) => {
  const table = Object.keys(VIEWER_AI_TOOL_CLASS);
  return { unclassified: names.filter((n) => !table.includes(n)).sort(), stale: table.filter((n) => !names.includes(n)).sort() };
};
const CHANGE = ["add_widget", "edit_widget", "rename_widget", "change_widget_type", "set_layout", "add_heatmap_layer", "edit_heatmap_layer", "set_layer_visibility", "patch", "add_dynamic_view", "remove_widget", "remove_layer", "remove_dynamic_view"];

describe("Viewer AI classification (152)", () => {
  it("VAICLS-1: every registered tool is classified, none stale (20)", () => {
    const names = reg().tools.map((t) => t.name);
    expect(names).toHaveLength(20);
    expect(drift(names)).toEqual({ unclassified: [], stale: [] });
    expect(names.sort()).toEqual(Object.keys(VIEWER_AI_TOOL_CLASS).sort());
  });

  it("VAICLS-2: positive control - an extra tool is reported unclassified", () => {
    expect(drift([...reg().tools.map((t) => t.name), "fake_tool"]).unclassified).toEqual(["fake_tool"]);
  });

  it("VAICLS-3: read|filter and change sets are exact", () => {
    const by = (f: (c: string) => boolean) => Object.entries(VIEWER_AI_TOOL_CLASS).filter(([, c]) => f(c)).map(([n]) => n).sort();
    expect(by((c) => c === "read" || c === "filter")).toEqual(["apply_filter", "clear_filter", "describe_table", "get_column_profile", "get_dashboard", "list_tables", "run_query"]);
    expect(by((c) => c === "change")).toEqual([...CHANGE].sort());
  });

  it("VAICLS-4: every AiOp is allowed XOR refused; allowed is exactly the filter ops", () => {
    const ops = AiOpSchema.options.map((o) => (o.shape.op as unknown as { value: string }).value);
    expect(ops.length).toBeGreaterThanOrEqual(12);
    for (const op of ops) expect(VIEWER_AF_ALLOWED_OPS.has(op) !== VIEWER_AF_REFUSED_OPS.has(op)).toBe(true);
    expect([...VIEWER_AF_ALLOWED_OPS, ...VIEWER_AF_REFUSED_OPS].sort()).toEqual([...ops].sort());
    expect([...VIEWER_AF_ALLOWED_OPS].sort()).toEqual(["apply_filter", "clear_filter"]);
  });

  it("VAICLS-5: default-deny predicates", () => {
    expect(isToolAllowedForViewerMode("fake_tool", "answers_filters")).toBe(false);
    expect(isToolAllowedForViewerMode("add_widget", "session_only")).toBe(true);
    expect(isToolAllowedForViewerMode("get_dashboard", "off")).toBe(false);
    expect(isToolAllowedForViewerMode("run_query", "answers_filters")).toBe(true);
    expect(isOpAllowedForViewerMode("add_track_layer", "answers_filters")).toBe(false);
    expect(isOpAllowedForViewerMode("apply_filter", "answers_filters")).toBe(true);
    expect(isOpAllowedForViewerMode("clear_filter", "off")).toBe(false);
  });

  it("VAICLS-6: offered narrows specs only; byName stays complete", () => {
    const r = buildToolRegistry({ dataAccess: "query", extraTools: [...QUERY_TOOLS], offered: (t) => isToolAllowedForViewerMode(t.name, "answers_filters") });
    expect(r.specs.map((s) => s.name).sort()).toEqual(["apply_filter", "clear_filter", "describe_table", "get_column_profile", "get_dashboard", "list_tables", "run_query"]);
    expect(r.tools).toHaveLength(20);
    expect(r.byName.get("add_widget")).toBeDefined();
  });
});
