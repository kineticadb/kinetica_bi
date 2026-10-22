/**
 * Phase 141 Plan 07: server-side re-validation of a Keep request, before any write.
 * The client is never trusted: ownership, shape, blocked keys, references (this dashboard or this
 * request's temp ids), live schema, and a server-side dynamic view recompile.
 * Reasons are fixed text + ids + identifier names only; never config values, SQL or upstream errors.
 */
import { AI_BLOCKED_CONFIG_KEYS, AI_CHART_SWAP_TYPES, KEEP_RIGHTS_ORDER, type AiKeepRequest, type KeepRight } from "@kinetica-bi/shared";
import { aiWidgetColumnRefs, aiLayerColumnRefs, checkAiDvSpec } from "@kinetica-bi/shared";
import { getWidget, getDashboardLayer, getDashboardDynamicView, listDashboardTables } from "../db";
import { PERMISSIONS } from "./permissions";
import { compileAiDvSpec, AiDvCompileError, type AiDvTable } from "./aiDvCompile";
import { substituteViewToken } from "./dynamicViewSql";
import { collectSignedWidgetConfigRefs, type RefKind } from "./dashboardExportRefs";

export type KeepCheck = { ok: true; warnings: string[] } | { ok: false; reasons: string[] };

const MAX_REASONS = 20;

/**
 * D-01: the rights a Keep needs from the REAL change set. Deliberately stricter than the individual
 * routes (POST/DELETE widgets need only dashboards:edit): Keep is one bulk write, so it asks for
 * the specific right of every kind of thing it touches.
 */
export function requiredRights(c: AiKeepRequest): Set<string> {
  const need = new Set<string>([PERMISSIONS.DASHBOARDS_EDIT]);
  if (c.widgets.add.length + c.widgets.edit.length + c.widgets.remove.length > 0) need.add(PERMISSIONS.WIDGETS_CONFIGURE);
  if (c.layers.add.length + c.layers.edit.length + c.layers.remove.length > 0) need.add(PERMISSIONS.LAYERS_MANAGE);
  if (c.dynamicViews.add.length + c.dynamicViews.remove.length > 0) need.add(PERMISSIONS.DYNAMIC_VIEWS_MANAGE);
  return need;
}

/** D-02: missing rights in the fixed KEEP_RIGHTS_ORDER (dashboards:edit is owned by the route gate). */
export function missingRights(required: ReadonlySet<string>, effective: ReadonlySet<string>): KeepRight[] {
  return KEEP_RIGHTS_ORDER.filter((p) => required.has(p) && !effective.has(p));
}

const IDENTITY_KEYS: ReadonlySet<string> = new Set(["id", "widgetId", "dashboardId", "dashboard_id", "table_id", "position", "type"]);
const BLOCKED_TOP: ReadonlySet<string> = new Set<string>(AI_BLOCKED_CONFIG_KEYS);
const PROTO_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

function hasProtoKey(v: unknown, depth = 0): boolean {
  if (depth > 12 || typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return v.some((x) => hasProtoKey(x, depth + 1));
  for (const k of Object.keys(v)) {
    if (PROTO_KEYS.has(k)) return true;
    if (hasProtoKey((v as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}

export function checkKeepChange(dashboardId: number, c: AiKeepRequest): KeepCheck {
  const reasons: string[] = [];
  const push = (m: string): void => {
    if (reasons.length < MAX_REASONS && !reasons.includes(m)) reasons.push(m);
  };
  const onDash = new Set(listDashboardTables(dashboardId).map((t) => t.id));
  const temps: Record<"widget" | "layer" | "dynamicView", Set<number>> = {
    widget: new Set(c.widgets.add.map((a) => a.tempId)),
    layer: new Set(c.layers.add.map((a) => a.tempId)),
    dynamicView: new Set(c.dynamicViews.add.map((a) => a.tempId)),
  };
  const removed = {
    widget: new Set(c.widgets.remove),
    layer: new Set(c.layers.remove),
    dynamicView: new Set(c.dynamicViews.remove),
  };
  const label = { widget: "widget", layer: "layer", dynamicView: "dynamic view" } as const;
  const owns = {
    widget: (id: number) => getWidget(id)?.dashboard_id === dashboardId,
    layer: (id: number) => getDashboardLayer(id)?.dashboard_id === dashboardId,
    dynamicView: (id: number) => getDashboardDynamicView(id)?.dashboard_id === dashboardId,
  };
  let removedRefs = 0;

  const checkRef = (kind: RefKind, id: number): void => {
    if (kind === "customMetric") return;
    if (kind === "table") {
      if (!onDash.has(id)) push(`table ${id} isn't on this dashboard`);
      return;
    }
    if (id < 0) {
      if (!temps[kind].has(id)) push(`temporary ${label[kind]} ${id} is not part of this change`);
      return;
    }
    if (!owns[kind](id)) push(`${label[kind]} ${id} is not on this dashboard`);
    else if (removed[kind].has(id)) removedRefs++;
  };
  const checkConfigRefs = (config: unknown): void => {
    for (const s of collectSignedWidgetConfigRefs(config)) checkRef(s.kind, s.id);
  };
  const checkKeys = (config: Record<string, unknown> | undefined, identity: boolean): void => {
    if (!config) return;
    for (const k of Object.keys(config)) {
      if (BLOCKED_TOP.has(k) || (identity && IDENTITY_KEYS.has(k))) push(`config key ${k} can't be set by Keep`);
    }
    if (hasProtoKey(config)) push("config contains a reserved key");
  };

  // ---- widgets ----
  for (const a of c.widgets.add) {
    checkKeys(a.config, true);
    checkConfigRefs(a.config);
  }
  for (const e of c.widgets.edit) {
    const w = getWidget(e.id);
    if (!w || w.dashboard_id !== dashboardId) {
      push(`widget ${e.id} is not on this dashboard`);
      continue;
    }
    if (w.type === "ai") {
      push("the AI assistant widget can't be changed by Keep");
      continue;
    }
    if (e.type !== undefined && !(AI_CHART_SWAP_TYPES as readonly string[]).includes(w.type)) push("only bar, line and pie charts can change type");
    checkKeys(e.configSet, true);
    for (const k of e.configUnset ?? []) if (BLOCKED_TOP.has(k) || IDENTITY_KEYS.has(k) || PROTO_KEYS.has(k)) push(`config key ${k} can't be set by Keep`);
    if (e.configSet) checkConfigRefs(e.configSet);
  }
  for (const id of c.widgets.remove) {
    const w = getWidget(id);
    if (!w || w.dashboard_id !== dashboardId) push(`widget ${id} is not on this dashboard`);
    else if (w.type === "ai") push("the AI assistant widget can't be changed by Keep");
  }

  // ---- layers ----
  for (const a of c.layers.add) {
    checkKeys(a.config, false);
    if (!onDash.has(a.tableId)) push(`table ${a.tableId} isn't on this dashboard`);
    if (a.dynamicViewId != null) checkRef("dynamicView", a.dynamicViewId);
  }
  for (const e of c.layers.edit) {
    if (!owns.layer(e.id)) {
      push(`layer ${e.id} is not on this dashboard`);
      continue;
    }
    checkKeys(e.configSet, false);
    if (e.tableId !== undefined && !onDash.has(e.tableId)) push(`table ${e.tableId} isn't on this dashboard`);
    if (e.dynamicViewId != null) checkRef("dynamicView", e.dynamicViewId);
  }
  for (const id of c.layers.remove) if (!owns.layer(id)) push(`layer ${id} is not on this dashboard`);

  // ---- dynamic views ----
  for (const a of c.dynamicViews.add) {
    const ids = [a.spec.baseTableId, ...(a.spec.joins ?? []).map((j) => j.tableId)];
    for (const t of ids) if (!onDash.has(t)) push(`table ${t} isn't on this dashboard`);
  }
  for (const id of c.dynamicViews.remove) if (!owns.dynamicView(id)) push(`dynamic view ${id} is not on this dashboard`);

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, warnings: removedRefs > 0 ? [`${removedRefs} saved references point at removed items`] : [] };
}


export type KeepPrepared = {
  dynamicViews: { tempId: number; name: string; sourceTableId: number; templateSql: string; maxRecords: number; columns: { name: string; type: string }[] }[];
  warnings: string[];
};
export type KeepPrepareDeps = {
  describe: (tableId: number) => Promise<{ ok: true; table: { schema: string; name: string; columns: { name: string; type?: string }[] } } | { ok: false }>;
  limits: { maxRecords: number; maxJoins: number };
  savedDvColumns: (dvId: number) => readonly { name: string }[] | null;
};
export type KeepPrepareResult = { ok: true; prepared: KeepPrepared } | { ok: false; reasons: string[] };

const refOf = (t: { schema: string; name: string }): string => (t.schema ? `${t.schema}.${t.name}` : t.name);
const SAVED_JOIN_WARNING = "Saved views read joined tables without their filters."; // 139 D-21

type ColCheck = { refs: string[]; dvId?: number; tableId?: number };

export async function prepareKeep(c: AiKeepRequest, deps: KeepPrepareDeps): Promise<KeepPrepareResult> {
  const reasons: string[] = [];
  const push = (m: string): void => {
    if (reasons.length < MAX_REASONS && !reasons.includes(m)) reasons.push(m);
  };

  // Cheap caps first, before any live-schema probe.
  for (const a of c.dynamicViews.add) {
    for (const m of checkAiDvSpec(a.spec)) push(m);
    if ((a.spec.joins ?? []).length > deps.limits.maxJoins) push(`a view can join at most ${deps.limits.maxJoins} tables`);
    if (a.spec.limit !== undefined && a.spec.limit > deps.limits.maxRecords) push(`limit ${a.spec.limit} is over the ${deps.limits.maxRecords}-row ceiling`);
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // Column checks, derived from the client config but never trusted for anything else.
  const checks: ColCheck[] = [];
  const bound = (cfg: Record<string, unknown>, stored: Record<string, unknown> = {}, unset: readonly string[] = []) => {
    const pick = (k: string): unknown => (k in cfg ? cfg[k] : unset.includes(k) ? undefined : stored[k]);
    const dv = pick("dynamicViewId");
    const t = pick("tableId");
    const dvId = typeof dv === "number" && Number.isInteger(dv) && dv !== 0 ? dv : undefined;
    const tableId = typeof t === "number" && Number.isInteger(t) && t > 0 ? t : undefined;
    return { dvId, tableId };
  };
  for (const a of c.widgets.add) {
    const refs = aiWidgetColumnRefs(a.config);
    if (refs.length > 0) checks.push({ refs, ...bound(a.config) });
  }
  for (const e of c.widgets.edit) {
    if (!e.configSet) continue;
    const refs = aiWidgetColumnRefs(e.configSet);
    if (refs.length === 0) continue;
    const stored = (getWidget(e.id)?.config ?? {}) as Record<string, unknown>;
    checks.push({ refs, ...bound(e.configSet, stored, e.configUnset) });
  }
  for (const a of c.layers.add) {
    const refs = aiLayerColumnRefs(a.config);
    if (refs.length > 0) checks.push({ refs, dvId: a.dynamicViewId ?? undefined, tableId: a.tableId });
  }
  for (const e of c.layers.edit) {
    if (!e.configSet) continue;
    const refs = aiLayerColumnRefs(e.configSet);
    if (refs.length === 0) continue;
    const stored = getDashboardLayer(e.id);
    const dvId = e.dynamicViewId !== undefined ? (e.dynamicViewId ?? undefined) : (stored?.dynamic_view_id ?? undefined);
    checks.push({ refs, dvId, tableId: e.tableId ?? stored?.table_id });
  }

  // Live schema as the user, once per distinct table.
  const tableCache = new Map<number, Promise<AiDvTable | null>>();
  const getTable = (id: number): Promise<AiDvTable | null> => {
    let p = tableCache.get(id);
    if (!p) {
      p = deps.describe(id).then((d) => (d.ok ? { tableId: id, ref: refOf(d.table), columns: d.table.columns } : null));
      tableCache.set(id, p);
    }
    return p;
  };

  // Dynamic views: rebuilt from the structured spec only (no 4th argument = the persisted raw-join template).
  const prepared: KeepPrepared = { dynamicViews: [], warnings: [] };
  const dvColumns = new Map<number, readonly { name: string }[]>();
  let anyJoin = false;
  for (const a of c.dynamicViews.add) {
    const ids = [a.spec.baseTableId, ...(a.spec.joins ?? []).map((j) => j.tableId)];
    const tables: AiDvTable[] = [];
    let missing = false;
    for (const id of ids) {
      const t = await getTable(id);
      if (!t) {
        push(`table ${id} is not available`);
        missing = true;
      } else tables.push(t);
    }
    if (missing) continue;
    try {
      const compiled = compileAiDvSpec(a.spec, tables, deps.limits);
      substituteViewToken(compiled.template, "_dummy_validation_view_name_");
      if ((a.spec.joins ?? []).length > 0) anyJoin = true;
      dvColumns.set(a.tempId, compiled.columns);
      prepared.dynamicViews.push({
        tempId: a.tempId,
        name: a.name,
        sourceTableId: a.spec.baseTableId,
        templateSql: compiled.template,
        maxRecords: compiled.maxRecords,
        columns: compiled.columns,
      });
    } catch (e) {
      if (e instanceof AiDvCompileError) for (const r of e.reasons) push(r);
      else push("the dynamic view couldn't be built");
    }
  }
  if (anyJoin) prepared.warnings.push(SAVED_JOIN_WARNING);

  for (const k of checks) {
    let known: ReadonlySet<string> | null = null;
    let where = "";
    if (k.dvId !== undefined) {
      const cols = k.dvId < 0 ? dvColumns.get(k.dvId) : deps.savedDvColumns(k.dvId);
      if (!cols) continue; // unknown column set (failed dv, or no saved columns): skip, never guess
      known = new Set(cols.map((x) => x.name));
      where = `dynamic view ${k.dvId}`;
    } else if (k.tableId !== undefined) {
      const t = await getTable(k.tableId);
      if (!t) {
        push(`table ${k.tableId} is not available`);
        continue;
      }
      known = new Set(t.columns.map((x) => x.name));
      where = `table ${k.tableId}`;
    }
    if (!known) continue;
    for (const r of k.refs) if (!known.has(r)) push(`column ${r} is not on ${where}`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, prepared };
}
