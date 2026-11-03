// Phase 140 (D-07/D-19): pure per-answer query scope. Built ONLY from server data (dashboard tables, saved dynamic
// view rows, this session's ai_session_views rows). The model sees dv_<id>/aidv_<n> aliases + display names; physical
// _kbi_* names (which embed the username) live only in `aliases` and `pass2Allowed`.
import { buildDynamicViewName } from "../dynamicViewName";

export type QueryScopeInput = {
  username: string;
  dashboardId: number;
  dashboardTables: readonly { id: number; schema: string; name: string }[];
  savedViews: readonly { id: number; name: string; columns?: readonly { name: string; type: string }[] | null }[];
  aiViews: readonly { viewName: string; dashboardId: number; tempId: number; gen: number }[];
  aiViewNames?: ReadonlyMap<number, string>;
};
export type QueryView = { alias: string; name: string; columns?: { name: string; type: string }[] };
export type QueryScope = {
  tableNames: ReadonlySet<string>;
  tableIdByName: ReadonlyMap<string, number>;
  aliases: ReadonlyMap<string, string>;
  pass1Allowed: ReadonlySet<string>;
  pass2Allowed: ReadonlySet<string>;
  views: readonly QueryView[];
};
export const savedViewAlias = (id: number): string => `dv_${id}`;
export const aiViewAlias = (tempId: number): string => `aidv_${Math.abs(tempId)}`;
const clip = (t: string): string => (t.length > 200 ? t.slice(0, 200) : t);

export function buildQueryScope(input: QueryScopeInput): QueryScope {
  const keyOf = (t: { schema: string; name: string }): string => (t.schema ? `${t.schema}.${t.name}` : t.name).toLowerCase();
  const counts = new Map<string, number>();
  for (const t of input.dashboardTables) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1);
  const tableNames = new Set<string>();
  const tableIdByName = new Map<string, number>();
  for (const t of input.dashboardTables) {
    const k = keyOf(t);
    if (counts.get(k) !== 1) continue; // collision: refuse, never guess
    tableNames.add(k);
    tableIdByName.set(k, t.id);
  }

  const aliases = new Map<string, string>();
  const views: QueryView[] = [];
  for (const v of input.savedViews) {
    const alias = savedViewAlias(v.id);
    aliases.set(alias, buildDynamicViewName({ userId: input.username, dashboardId: input.dashboardId, dynamicViewId: v.id }));
    const view: QueryView = { alias, name: clip(v.name) };
    if (v.columns) view.columns = v.columns.map((c) => ({ name: c.name, type: c.type }));
    views.push(view);
  }
  const best = new Map<number, { viewName: string; gen: number }>();
  for (const a of input.aiViews) {
    if (a.dashboardId !== input.dashboardId) continue;
    const cur = best.get(a.tempId);
    if (!cur || a.gen > cur.gen) best.set(a.tempId, { viewName: a.viewName, gen: a.gen });
  }
  for (const [tempId, { viewName }] of best) {
    const alias = aiViewAlias(tempId);
    aliases.set(alias, viewName);
    views.push({ alias, name: clip(input.aiViewNames?.get(tempId) ?? `AI view ${Math.abs(tempId)}`) });
  }

  const pass1Allowed = new Set<string>([...tableNames, ...aliases.keys()]);
  const pass2Allowed = new Set<string>([...tableNames, ...[...aliases.values()].map((n) => n.toLowerCase())]);
  return { tableNames, tableIdByName, aliases, pass1Allowed, pass2Allowed, views };
}
