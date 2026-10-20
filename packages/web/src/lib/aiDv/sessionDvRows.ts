// Phase 139 (AIACT-V20-07): session AI views -> DynamicViewRow, so every existing read site (DashboardContext,
// orphan detection, orchestrator dv:<id> keys, keep-alive, map WMS) sees them via the ONE merged list.
import { AI_DV_DEFAULT_MAX_RECORDS, type AiDvOutputColumn } from "@kinetica-bi/shared";
import type { DynamicViewRow } from "../../api/client";
import type { SessionDv } from "../aiSession/types";

export type SessionDvRowCtx = {
  dashboardId: number;
  nonce: string;
  gen: Readonly<Record<number, number>>;
  columns: Readonly<Record<number, readonly AiDvOutputColumn[]>>;
  tables: readonly { id: number; schema: string; name: string; columns: Record<string, string> }[];
};

const DATE_TYPES = new Set(["timestamp", "datetime", "date"]);
const isStringType = (t: string): boolean => t === "string" || t === "varchar" || t.startsWith("char");

function suggest(cols: Record<string, string> | undefined): { name: string; kind: "date" | "string" } | undefined {
  if (!cols) return undefined;
  const entries = Object.entries(cols).map(([n, t]) => [n, t.toLowerCase()] as const);
  const d = entries.find(([, t]) => DATE_TYPES.has(t));
  if (d) return { name: d[0], kind: "date" };
  const s = entries.find(([, t]) => isStringType(t));
  return s ? { name: s[0], kind: "string" } : undefined;
}

let memo: { views: unknown; nonce: string; gen: unknown; columns: unknown; tables: unknown; out: DynamicViewRow[] } | null = null;

export function toSessionDvRows(views: readonly SessionDv[], ctx: SessionDvRowCtx): DynamicViewRow[] {
  if (memo && memo.views === views && memo.nonce === ctx.nonce && memo.gen === ctx.gen && memo.columns === ctx.columns && memo.tables === ctx.tables) {
    return memo.out;
  }
  const out = views.map((v): DynamicViewRow => {
    const base = ctx.tables.find((t) => t.id === v.baseTableId);
    const cols = v.columns.length > 0 ? v.columns : ctx.columns[v.id];
    const sc = suggest(base?.columns);
    return {
      id: v.id,
      dashboard_id: ctx.dashboardId,
      source_table_id: v.baseTableId,
      name: v.name,
      template_sql: "",
      max_records: v.maxRecords ?? AI_DV_DEFAULT_MAX_RECORDS,
      columns_json: cols && cols.length > 0 ? [...cols] : null,
      aggregated: v.aggregated,
      created_at: "",
      updated_at: "",
      ai: {
        nonce: ctx.nonce,
        gen: ctx.gen[v.id] ?? 0,
        spec: v.spec,
        baseLabel: base ? `${base.schema}.${base.name}` : `table ${v.baseTableId}`,
        ...(sc ? { suggestColumn: sc } : {}),
      },
    };
  });
  memo = { views, nonce: ctx.nonce, gen: ctx.gen, columns: ctx.columns, tables: ctx.tables, out };
  return out;
}
