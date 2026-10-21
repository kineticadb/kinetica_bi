// Phase 135 read tools. Results are built field-by-field from typed objects (allow-listed
// serializers) and wrapped in classified parts; upstream objects are never stringified.
import { z } from "zod/v4";
import { part } from "../outbound";
import { markUntrusted } from "../untrusted";
import type { LiveTableInfo, ReadTool, ToolContext } from "./types";

export const LIST_TABLES_CAP = 50;
export const LIST_TABLES_CONCURRENCY = 4;
const DESC_MAX = 200;

const clip = (s: unknown): string | undefined => (typeof s === "string" && s.length > 0 ? s.slice(0, DESC_MAX) : undefined);

function serializeColumns(t: LiveTableInfo): { name: string; type?: string }[] {
  return (Array.isArray(t.columns) ? t.columns : []).map((c) => {
    const out: { name: string; type?: string } = { name: String(c.name) };
    if (typeof c.type === "string") out.type = c.type;
    return out;
  });
}

const getDashboard: ReadTool = {
  kind: "read",
  name: "get_dashboard",
  description: "Get the current dashboard: widgets, layers, dynamic views and filters with their ids. Call this first; use these ids for patch and remove tools.",
  args: z.object({}),
  async run(_args, ctx) {
    return { parts: [part.config(JSON.stringify(markUntrusted(ctx.dashboardView())))] };
  },
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const listTables: ReadTool = {
  kind: "read",
  name: "list_tables",
  description: "List the tables you can use, with ids. Use describe_table for column names before referencing columns.",
  args: z.object({}),
  async run(_args, ctx: ToolContext) {
    const own = new Set(ctx.dashboardTableIds());
    const all = ctx.registeredTables();
    const ordered = [...all.filter((t) => own.has(t.id)), ...all.filter((t) => !own.has(t.id))];
    const probed = ordered.slice(0, LIST_TABLES_CAP);
    const notChecked = ordered.length - probed.length;
    const results = await mapLimit(probed, LIST_TABLES_CONCURRENCY, async (t) => ({ t, r: await ctx.liveSchema.describe(t.id) }));
    const tables = results.flatMap(({ t, r }) => {
      if (!r.ok) return [];
      const entry: { id: number; schema: string; name: string; description?: string; columnCount: number } = {
        id: t.id, schema: String(r.table.schema), name: String(r.table.name), columnCount: Array.isArray(r.table.columns) ? r.table.columns.length : 0,
      };
      const d = clip(r.table.description);
      if (d !== undefined) entry.description = d;
      return [entry];
    });
    const body: { tables: typeof tables; note?: string } = { tables };
    if (notChecked > 0) body.note = `${notChecked} more tables not shown; ask about a specific table`;
    return { parts: [part.schema(JSON.stringify(markUntrusted(body)))] };
  },
};

const describeTable: ReadTool = {
  kind: "read",
  name: "describe_table",
  description: "Get the columns of one table by id (from list_tables). Column names used in widget config must come from here.",
  args: z.object({ tableId: z.number().int().positive() }),
  async run(args, ctx) {
    const { tableId } = z.object({ tableId: z.number().int().positive() }).parse(args);
    const r = await ctx.liveSchema.describe(tableId);
    if (!r.ok) return { parts: [part.schema(`Table ${tableId} is not available.`)], isError: true };
    const t = r.table;
    const out: { id: number; schema: string; name: string; description?: string; columns: { name: string; type?: string }[] } = {
      id: t.id, schema: String(t.schema), name: String(t.name), columns: serializeColumns(t),
    };
    const d = clip(t.description);
    if (d !== undefined) out.description = d;
    return { parts: [part.schema(JSON.stringify(markUntrusted(out)))] };
  },
};

export const READ_TOOLS: readonly ReadTool[] = [getDashboard, listTables, describeTable];
