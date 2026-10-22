/**
 * Phase 141 Plan 07: server-side re-validation of a Keep request, before any write.
 * The client is never trusted: ownership, shape, blocked keys, references (this dashboard or this
 * request's temp ids), live schema, and a server-side dynamic view recompile.
 * Reasons are fixed text + ids + identifier names only; never config values, SQL or upstream errors.
 */
import { AI_BLOCKED_CONFIG_KEYS, AI_CHART_SWAP_TYPES, KEEP_RIGHTS_ORDER, type AiKeepRequest, type KeepRight } from "@kinetica-bi/shared";
import { getWidget, getDashboardLayer, getDashboardDynamicView, listDashboardTables } from "../db";
import { PERMISSIONS } from "./permissions";
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

