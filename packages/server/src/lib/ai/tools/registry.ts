// Phase 135 tool registry. 135 never registers run_query/get_column_profile; Phase 140 adds them
// behind dataAccess==='query' (AIGOV-V20-02/03). Provider schemas must be flat (see sanitizeToolSchema).
import { z } from "zod/v4";
import type { AiDataAccess } from "../../aiConfig";
import type { ToolSpec } from "../provider";
import type { AiTool } from "./types";
import { READ_TOOLS } from "./read";
import { MUTATE_TOOLS } from "./mutate";

export const QUERY_TOOL_NAMES = ["run_query", "get_column_profile"] as const;
export type ToolRegistry = { tools: readonly AiTool[]; specs: readonly ToolSpec[]; byName: ReadonlyMap<string, AiTool> };

const STRIP = new Set(["$schema", "additionalProperties", "propertyNames"]);
const COMPOSITE = ["$ref", "anyOf", "oneOf", "allOf", "not", "$defs", "definitions"];
const MAXSAFE = 9007199254740991;

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (STRIP.has(k)) continue;
      if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) === MAXSAFE) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return node;
}

/** Deep-clones and strips keys providers reject. Composites are left in place so buildToolRegistry fails loudly. */
export function sanitizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return clean(schema) as Record<string, unknown>;
}

function findComposite(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const x of node) { const f = findComposite(x); if (f) return f; }
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (COMPOSITE.includes(k)) return k;
      const f = findComposite(v);
      if (f) return f;
    }
  }
  return null;
}

export function buildToolRegistry(opts: { dataAccess: AiDataAccess; extraTools?: AiTool[] }): ToolRegistry {
  const queryNames: readonly string[] = QUERY_TOOL_NAMES;
  const extras = (opts.extraTools ?? []).filter((t) => !queryNames.includes(t.name) || opts.dataAccess === "query");
  const tools: AiTool[] = [...READ_TOOLS, ...MUTATE_TOOLS, ...extras];
  const byName = new Map<string, AiTool>();
  const specs: ToolSpec[] = [];
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`duplicate tool name: ${tool.name}`);
    byName.set(tool.name, tool);
    const jsonSchema = sanitizeToolSchema(z.toJSONSchema(tool.args) as Record<string, unknown>);
    const bad = findComposite(jsonSchema);
    if (bad) throw new Error(`tool ${tool.name} schema is not flat (${bad})`);
    specs.push({ name: tool.name, description: tool.description, jsonSchema });
  }
  return { tools, specs, byName };
}
