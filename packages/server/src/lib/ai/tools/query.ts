// 140 (AIGOV-V20-03): the AI's OWN read tools. Registered only when AI_DATA_ACCESS=query (registry QUERY_TOOL_NAMES gate).
import { z } from "zod/v4";
import { part } from "../outbound";
import type { ReadTool } from "./types";

const NOT_AVAILABLE = "Querying is not available in this deployment.";

const runQueryArgs = z.object({ sql: z.string().min(1).max(8000) });
export const runQuery: ReadTool = {
  kind: "read",
  name: "run_query",
  description:
    "Read rows for your own answer (not for charts; charts run their own queries). One SELECT or WITH ... SELECT on schema-qualified tables on this dashboard, or dynamic views by alias (dv_<id>, aidv_<n>). No semicolons or comments. Results are capped and marked as data.",
  args: runQueryArgs,
  async run(args, ctx) {
    const { sql } = runQueryArgs.parse(args);
    if (!ctx.query) return { parts: [part.config(NOT_AVAILABLE)], isError: true };
    const r = await ctx.query.run(sql, ctx.signal);
    return r.ok ? { parts: [part.rows(JSON.stringify(r.envelope))] } : { parts: [part.config(r.message)], isError: true };
  },
};

const profileArgs = z.object({ tableId: z.number().int().positive(), column: z.string().min(1).max(128) });
export const getColumnProfile: ReadTool = {
  kind: "read",
  name: "get_column_profile",
  description:
    "Profile one column of a table on this dashboard (tableId from list_tables, column from describe_table): row, distinct and null counts, min/max for numbers and times, top 10 values with counts for text. For your own answer, not for charts.",
  args: profileArgs,
  async run(args, ctx) {
    const a = profileArgs.parse(args);
    if (!ctx.query) return { parts: [part.config(NOT_AVAILABLE)], isError: true };
    const r = await ctx.query.profile(a, ctx.signal);
    return r.ok ? { parts: [part.values(JSON.stringify(r.envelope))] } : { parts: [part.config(r.message)], isError: true };
  },
};

export const QUERY_TOOLS: readonly ReadTool[] = [runQuery, getColumnProfile];
