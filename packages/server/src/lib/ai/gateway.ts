// Phase 135 (AISAFE-V20-02/03): the ONE validation gateway every AI change passes, in a fixed order:
// shape -> allow_list -> permission -> reference -> live_schema, stopping at the first failure.
// Reasons are built from fixed text, paths, ids and column NAMES only - never rejected argument values or upstream error text.
import {
  AI_CHART_SWAP_TYPES,
  AI_FILTER_CAP_PER_TABLE,
  aiFilterSourceKey,
  coerceAiFilterItem,
  AI_DEFAULT_SIZE,
  AI_COLUMN_BINDING_KEYS as SHARED_BINDING_KEYS,
  planDvDependents,
  isAiNumericColumnType,
  isAiTemporalColumnType,
  AI_TABLELESS_WIDGET_TYPES,
  parseAiOp,
  placeWidget,
  validateActionPatch,
  validateAiWidgetConfig,
  resolveHeatmapHost,
  validateAiLayerPatch,
  validateLayout,
  type AiClarification,
  type AiFilterItem,
  type AiFilterSource,
  type AiOp,
  type AiWidgetType,
} from "@kinetica-bi/shared";
import { validateAiDvSpec, compileAiDvSpec, type AiDvTable } from "../aiDvCompile";
import type { GatewayResult, GatewayStage, LiveSchemaPort, MutateTool } from "./tools/types";
import { applyOpToShadow, describeIntent, describeOp, shadowRects, type ShadowState } from "./shadow";

// Literal on purpose (see PERMISSIONS.AI_USE in lib/permissions.ts; kept local to avoid a catalog import cycle in specs).
const AI_USE = "ai:use";

/** Config keys the bar/line/pie/table/bignumber/records renderers read as COLUMN NAMES
 *  (packages/web/src/components/charts/WidgetRenderer.tsx:1057-1068 metricColumn/groupByColumn/groupByColumns;
 *   :1383-1384, :1693-1694, :1850-1851, :1968-1977 same keys). `metric`/`dimension` are snapshot-binding names only; no renderer reads them from config. */
export const AI_COLUMN_BINDING_KEYS: readonly string[] = SHARED_BINDING_KEYS;

export type GatewayDeps = {
  username: string;
  dashboardId: number;
  shadow: ShadowState;
  liveSchema: LiveSchemaPort;
  getPermissions: (u: string) => ReadonlySet<string>;
  canViewDashboard: (u: string, dashboardId: number) => boolean;
  /** Tables associated with the dashboard (D-22). */
  dashboardTableIds: () => readonly number[];
  /** D-06: UX approval for removing saved content. */
  approvals?: { removeSaved?: boolean };
  /** 138: a saved dynamic view on THIS dashboard (name + stored columns; pre-check only, /api/filter/materialize probes authoritatively). undefined = not on this dashboard. */
  dynamicViewInfo?: (dvId: number) => { name: string; columns: { name: string; type?: string }[] | null; sourceTableId?: number } | undefined;
  /** 139: AI dynamic-view limits from AiConfig; defaults when absent. */
  aiDv?: { maxRecords: number; maxJoins: number; maxPerSession: number };
};

type FailExtras = { refKey?: string; slot?: string; label?: string; clarification?: AiClarification };
const fail = (stage: GatewayStage, reasons: string[], x: FailExtras = {}): GatewayResult => ({ ok: false, stage, reasons, ...x });
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
/** Closest names, best first, max 3. `cols` MUST be the probed (accessible, on-dashboard) table's columns only (D-17). */
function nearest(name: string, cols: string[]): string[] {
  const n = name.toLowerCase();
  const toks = (x: string) => x.split("_").filter((t) => t.length >= 3);
  const nt = toks(n);
  const sharedPrefix = (l: string) => {
    let k = 0;
    while (k < n.length && k < l.length && n[k] === l[k]) k++;
    return k;
  };
  const scored: { c: string; score: number; i: number }[] = [];
  cols.forEach((c, i) => {
    const l = c.toLowerCase();
    let score = Infinity;
    if (l === n) score = 0;
    else if (n.length >= 3 && (l.includes(n) || (l.length >= 3 && n.includes(l)))) score = 1;
    else if (toks(l).some((t) => nt.includes(t)) || sharedPrefix(l) >= 4) score = 2;
    else if (lev(n, l) <= 2) score = 3;
    if (score !== Infinity) scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).slice(0, 3).map((x) => x.c);
}

/** temporal: 142 timeline timeColumn must be a date/time column. */
type ColRef = { name: string; numeric: boolean; temporal?: boolean };
const strs = (v: unknown): string[] => (typeof v === "string" && v ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

const AI_WIDGET_LOCKED = "the AI assistant widget can't be changed";

/** Column references an op makes, with whether each must be numeric. (collectColumnRefs in lib/columnRefs.ts is unrelated.) */
function opColumnRefs(op: AiOp, shadow: ShadowState): { tableId: number | undefined; refs: ColRef[]; probe: boolean } | undefined {
  const fromRec = (rec: Record<string, unknown>): ColRef[] => {
    const refs: ColRef[] = [];
    const agg = typeof rec.aggregation === "string" ? rec.aggregation : undefined;
    const needNumeric = agg !== undefined && agg !== "count" && agg !== "count_distinct";
    for (const k of AI_COLUMN_BINDING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(rec, k)) continue;
      for (const name of strs(rec[k])) refs.push({ name, numeric: (k === "metric" || k === "metricColumn") && needNumeric });
    }
    for (const name of strs(rec.columns)) refs.push({ name, numeric: false });
    for (const name of strs(rec.sortField)) refs.push({ name, numeric: false });
    for (const name of strs(rec.timeColumn)) refs.push({ name, numeric: false, temporal: true });
    return refs;
  };
  if (op.op === "add_widget") {
    const t = (op.config as Record<string, unknown>).tableId;
    const tableId = typeof t === "number" ? t : undefined;
    return { tableId, refs: fromRec(op.config), probe: !AI_TABLELESS_WIDGET_TYPES.includes(op.type) };
  }
  if (op.op === "patch" && op.action.target.kind === "widget") {
    const refs = fromRec(op.action.configPatch);
    return { tableId: shadow.widgets.get(op.action.target.id)?.tableId, refs, probe: refs.length > 0 };
  }
  if (op.op === "patch" && op.action.target.kind === "layer") {
    // D-21: a heatmap value column is checked against the layer's own table.
    const refs = strs(op.action.configPatch.valueColumn).map((name) => ({ name, numeric: true }));
    return { tableId: shadow.layers.get(op.action.target.id)?.tableId, refs, probe: refs.length > 0 };
  }
  if (op.op === "add_layer") {
    const refs: ColRef[] = [
      ...strs(op.latColumn).map((name) => ({ name, numeric: true })),
      ...strs(op.lonColumn).map((name) => ({ name, numeric: true })),
      ...strs(op.wktColumn).map((name) => ({ name, numeric: false })),
      ...strs(op.wkbColumn).map((name) => ({ name, numeric: false })),
      ...strs(op.style?.valueColumn).map((name) => ({ name, numeric: true })),
    ];
    return { tableId: op.tableId, refs, probe: true };
  }
  return undefined;
}

function slotOf(op: AiOp): string | undefined {
  switch (op.op) {
    case "add_widget":
    case "add_layer":
    case "add_dynamic_view":
      return `new:${op.tempId}`;
    case "patch":
      return `${op.action.target.kind === "dynamicView" ? "dv" : op.action.target.kind}:${op.action.target.id}`;
    case "remove_widget":
    case "change_widget_type":
    case "set_widget_title":
      return `widget:${op.id}`;
    case "remove_layer":
      return `layer:${op.id}`;
    case "remove_dynamic_view":
      return `dv:${op.id}`;
    case "set_layout":
      return "layout";
    default:
      return undefined;
  }
}

const NOT_ON_DASHBOARD = (id: number) => `table ${id} isn't on this dashboard; add it in dashboard settings first`;
const NOT_AVAILABLE = (id: number) => `table ${id} is not available; use list_tables for valid ids`;
const DV_BOUND = "this chart uses a dynamic view; the AI can't edit it yet";
// 142: a timeline is add-only and table-bound (TimelineRenderer does not resolve a dynamic view's name yet).
const TIMELINE_NO_EDIT = "a timeline can't be edited yet; remove it and add a new one";
const TIMELINE_NO_DV = "a timeline can't use a dynamic view yet; pass tableId";
const NOT_TEMPORAL = (c: string) => `column ${c} is not a date or time column`;
const TABLE_KEYS = ["tableId", "table_id", "table"];

export async function checkAiOp(deps: GatewayDeps, tool: MutateTool, argsRaw: string): Promise<GatewayResult> {
  // a. shape
  let json: unknown;
  try {
    json = JSON.parse(argsRaw);
  } catch {
    return fail("shape", ["arguments are not valid JSON"]);
  }
  const parsed = tool.args.safeParse(json);
  if (!parsed.success) {
    return fail("shape", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const shadow = deps.shadow;
  const dvLimits = { maxRecords: deps.aiDv?.maxRecords ?? 100000, maxJoins: deps.aiDv?.maxJoins ?? 2 };
  const dvMaxPerSession = deps.aiDv?.maxPerSession ?? 5;
  /** Name/base/columns of a view: AI (negative) from the shadow, saved from the dashboard lookup. columns null = unknown. */
  const dvMeta = (id: number): { name: string; baseTableId?: number; columns: { name: string; type?: string }[] | null } | undefined => {
    if (id < 0) {
      const i = shadow.dvInfo.get(id);
      return i ? { name: i.name, ...(i.baseTableId !== undefined ? { baseTableId: i.baseTableId } : {}), columns: i.columns ?? null } : undefined;
    }
    const i = deps.dynamicViewInfo?.(id);
    return i ? { name: i.name, ...(i.sourceTableId !== undefined ? { baseTableId: i.sourceTableId } : {}), columns: i.columns } : undefined;
  };
  const candidate = tool.toOp(parsed.data);
  // 139 D-24: an add_layer bound to a view without a tableId takes the view's base table.
  if (isRec(candidate) && candidate.op === "add_layer" && typeof candidate.dynamicViewId === "number" && candidate.tableId === undefined) {
    const b = dvMeta(candidate.dynamicViewId)?.baseTableId;
    if (b !== undefined) candidate.tableId = b;
  }
  // D-11/D-12: an add_layer without a map id resolves to the dashboard's (or this answer's new) map, or asks.
  if (isRec(candidate) && candidate.op === "add_layer" && candidate.widgetId === undefined && typeof candidate.tableId === "number") {
    const hostX: FailExtras = {
      ...(typeof candidate.tempId === "number" ? { slot: `new:${candidate.tempId}` } : {}),
      label: `Add heatmap layer${typeof candidate.name === "string" && candidate.name ? ` "${candidate.name}"` : ""}`,
    };
    const maps = [...shadow.widgets.entries()].filter(([, w]) => w.type === "map").map(([id, w]) => ({ id, title: w.title }));
    const layers = [...shadow.layers.entries()].map(([id, l]) => ({ id, widgetId: l.widgetId, ...(l.tableId !== undefined ? { tableId: l.tableId } : {}) }));
    const host = resolveHeatmapHost({ maps, layers, tableId: candidate.tableId });
    if (host.kind === "use") candidate.widgetId = host.widgetId;
    else if (host.kind === "add_map") {
      return fail("reference", ["no map on this dashboard; add a map widget first (add_widget type map), then add the heatmap layer to its tempId"], hostX);
    } else {
      return fail("clarification", ["more than one map; ask the user which one"], {
        ...hostX,
        clarification: {
          kind: "choose_map",
          question: "Which map should get the heatmap?",
          options: host.options.map((o) => ({ id: String(o.widgetId), label: o.title })),
        },
      });
    }
  }
  // 138 D-02: a filter op with no source resolves to the one dashboard source that has the column, or asks.
  const filterColumn =
    isRec(candidate) && candidate.source === undefined
      ? candidate.op === "apply_filter" && Array.isArray(candidate.filters) && isRec(candidate.filters[0]) && typeof candidate.filters[0].column === "string"
        ? candidate.filters[0].column
        : candidate.op === "clear_filter" && typeof candidate.column === "string"
          ? candidate.column
          : undefined
      : undefined;
  if (isRec(candidate) && filterColumn !== undefined) {
    // permission first, so nothing is probed for a user without ai:use (same texts as stage c)
    const label = candidate.op === "apply_filter" ? `Filter on ${filterColumn}` : `Clear the ${filterColumn} filter`;
    if (!deps.getPermissions(deps.username).has(AI_USE)) return fail("permission", ["the AI assistant is not enabled for this user"], { label });
    if (!deps.canViewDashboard(deps.username, deps.dashboardId)) return fail("permission", ["this dashboard is not available"], { label });
    const tableLabel = (t: { schema: string; name: string }) => (t.schema ? `${t.schema}.${t.name}` : t.name);
    type Cand = { kind: "table" | "dynamicView"; id: number; label: string };
    const cands: Cand[] = [];
    let union: string[] = [];
    if (candidate.op === "apply_filter") {
      for (const id of deps.dashboardTableIds()) {
        const d = await deps.liveSchema.describe(id);
        if (!d.ok) continue;
        const names = d.table.columns.map((c) => c.name);
        union = union.concat(names);
        if (names.includes(filterColumn)) cands.push({ kind: "table", id, label: tableLabel(d.table) });
      }
      for (const id of shadow.dynamicViews) {
        const info = dvMeta(id);
        const names = (info?.columns ?? []).map((c) => c.name);
        union = union.concat(names);
        if (info && names.includes(filterColumn)) cands.push({ kind: "dynamicView", id, label: info.name });
      }
    } else {
      for (const [key, set] of shadow.filterCols) {
        if (!set.has(filterColumn)) continue;
        const [kind, rawId] = key.split(":");
        const id = Number(rawId);
        if (kind === "table") {
          const d = await deps.liveSchema.describe(id);
          cands.push({ kind: "table", id, label: d.ok ? tableLabel(d.table) : `table ${id}` });
        } else {
          cands.push({ kind: "dynamicView", id, label: dvMeta(id)?.name ?? `dynamic view ${id}` });
        }
      }
    }
    if (cands.length === 1) candidate.source = { kind: cands[0].kind, id: cands[0].id };
    else if (cands.length > 1) {
      return fail("clarification", [candidate.op === "apply_filter" ? "the column is on more than one table; ask the user which one" : "that column is filtered on more than one table; ask the user which one"], {
        label,
        clarification: {
          kind: "choose_option",
          question: candidate.op === "apply_filter" ? `Which table should I filter by ${filterColumn}?` : `Which table's ${filterColumn} filter should I clear?`,
          options: cands.map((c) => ({ id: `${c.kind}:${c.id}`, label: c.label })),
        },
      });
    } else if (candidate.op === "apply_filter") {
      const near = nearest(filterColumn, union);
      return fail("live_schema", [
        `column \`${filterColumn}\` not found on any table on this dashboard` + (near.length ? `; did you mean ${near.map((n) => `\`${n}\``).join(", ")}?` : ""),
      ], { label });
    } else {
      return fail("reference", [`no filter on \`${filterColumn}\``], { label });
    }
  }
  const p = parseAiOp(candidate);
  if (!p.ok) return fail("shape", p.errors);
  const op: AiOp = p.op;
  const x: FailExtras = { slot: slotOf(op), label: describeIntent(op, shadow) };
  const f = (stage: GatewayStage, reasons: string[], refKey?: string): GatewayResult => fail(stage, reasons, { ...x, ...(refKey ? { refKey } : {}) });

  if (op.op === "patch" && Object.keys(op.action.configPatch).length === 0) {
    return f("shape", ["nothing to change; pass at least one setting"]);
  }

  // 139 D-24: a patch carrying dynamicViewId on a widget/layer is a REBIND and must stand alone.
  const isRebind =
    op.op === "patch" &&
    (op.action.target.kind === "widget" || op.action.target.kind === "layer") &&
    Object.prototype.hasOwnProperty.call(op.action.configPatch, "dynamicViewId");
  const rebindView = isRebind && op.op === "patch" ? op.action.configPatch.dynamicViewId : undefined;
  /** Columns of a view vs the names an op reads. null columns (saved view, unknown) skip the pre-check. */
  const viewRefs = (vid: number, refs: ColRef[]): GatewayResult | undefined => {
    const meta = dvMeta(vid);
    if (!meta || !meta.columns) return undefined;
    const names = meta.columns.map((c) => c.name);
    const reasons: string[] = [];
    let refKey: string | undefined;
    for (const c of refs) {
      const key = `col:${vid}:${c.name}`;
      if (!names.includes(c.name)) {
        const near = nearest(c.name, names);
        reasons.push(`column \`${c.name}\` not found on dynamic view ${meta.name}` + (near.length ? `; did you mean ${near.map((n) => `\`${n}\``).join(", ")}?` : ""));
        refKey ??= key;
      } else if (c.numeric && isAiNumericColumnType(meta.columns.find((q) => q.name === c.name)?.type) === false) {
        reasons.push(`column ${c.name} is not numeric`);
        refKey ??= key;
      } else if (c.temporal && isAiTemporalColumnType(meta.columns.find((q) => q.name === c.name)?.type) === false) {
        reasons.push(NOT_TEMPORAL(c.name));
        refKey ??= key;
      }
    }
    return reasons.length ? f("live_schema", reasons, refKey) : undefined;
  };

  // b. allow_list
  if (op.op === "patch" && op.action.target.kind === "widget" && shadow.widgets.get(op.action.target.id)?.type === "timeline") {
    return f("allow_list", [TIMELINE_NO_EDIT]);
  }
  if (isRebind && op.op === "patch") {
    if (Object.keys(op.action.configPatch).length !== 1) return f("allow_list", ["change the view binding on its own, then send other settings in a separate edit"]);
    if (!(typeof rebindView === "number" && Number.isInteger(rebindView) && rebindView !== 0)) return f("allow_list", ["invalid value for dynamicViewId"]);
  } else if (op.op === "add_widget") {
    const v = validateAiWidgetConfig(op.type, op.config);
    if (!v.valid) return f("allow_list", v.reasons);
  } else if (op.op === "patch") {
    const { kind, id } = op.action.target;
    const patchRec = op.action.configPatch;
    let res: { valid: true } | { valid: false; reasons: string[] } | undefined;
    if (kind === "widget") {
      const w = shadow.widgets.get(id);
      if (w) {
        // D-04: a chart's data binding (table) never changes; the model must add a new widget instead.
        if (TABLE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(patchRec, k))) {
          return f("allow_list", ["a chart's table can't be changed; add a new widget for the other table"]);
        }
        res = validateActionPatch("widget", w.type, patchRec);
      }
    } else if (kind === "layer") {
      const l = shadow.layers.get(id);
      if (l) res = validateAiLayerPatch(patchRec, l.renderMode);
    } else if (kind === "dynamicView") {
      if (shadow.dynamicViews.has(id)) res = validateActionPatch("dynamicView", undefined, patchRec);
    }
    if (res && !res.valid) return f("allow_list", res.reasons);
  }

  // c. permission - re-read for EVERY op (no caching) so a mid-answer revocation rejects the next op.
  // D-16: NO edit-right checks here; session-only changes are allowed for any ai:use user. Edit rights are enforced at Keep (Phase 141).
  if (!deps.getPermissions(deps.username).has(AI_USE)) return f("permission", ["the AI assistant is not enabled for this user"]);
  if (!deps.canViewDashboard(deps.username, deps.dashboardId)) return f("permission", ["this dashboard is not available"]);

  // d. reference
  const missing = (kind: string, id: number, label = kind) => f("reference", [`${label} ${id} does not exist`], `ref:${kind}:${id}`);
  /** D-22: only tables associated with the dashboard. An inaccessible table reads exactly like a nonexistent one. */
  const tableRule = async (tableId: number): Promise<GatewayResult | undefined> => {
    if (deps.dashboardTableIds().includes(tableId)) return undefined;
    const d = await deps.liveSchema.describe(tableId);
    return f("reference", [d.ok ? NOT_ON_DASHBOARD(tableId) : NOT_AVAILABLE(tableId)], `table:${tableId}`);
  };
  /** D-06: saved content is only removed with the user's approval; temp (AI-created) content never asks. Never mutates the shadow. */
  const confirmRemove = (id: number, what: string): GatewayResult | undefined => {
    if (id < 0 || deps.approvals?.removeSaved === true) return undefined;
    return fail("clarification", ["removing saved content needs the user's approval"], {
      ...x,
      clarification: {
        kind: "confirm_remove",
        question: `Remove ${what}?`,
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
      },
    });
  };
  // 137: the AI Assistant widget (type "ai") is in the snapshot for placement/overlap but is never AI-editable.
  const isAiWidget = (id: number) => shadow.widgets.get(id)?.type === "ai";
  const lockedId =
    op.op === "patch" && op.action.target.kind === "widget" && isAiWidget(op.action.target.id) ? op.action.target.id
    : (op.op === "remove_widget" || op.op === "change_widget_type" || op.op === "set_widget_title") && isAiWidget(op.id) ? op.id
    : op.op === "set_layout" ? op.items.find((it) => isAiWidget(it.id))?.id
    : undefined;
  if (lockedId !== undefined) return f("reference", [AI_WIDGET_LOCKED], `ref:widget:${lockedId}`);
  if (op.op === "patch") {
    const { kind, id } = op.action.target;
    const exists = kind === "widget" ? shadow.widgets.has(id) : kind === "layer" ? shadow.layers.has(id) : kind === "dynamicView" ? shadow.dynamicViews.has(id) : true;
    if (!exists) return missing(kind, id);
    if (isRebind && typeof rebindView === "number") {
      if (!shadow.dynamicViews.has(rebindView) || !dvMeta(rebindView)) return missing("dynamicView", rebindView, "dynamic view");
    } else if (kind === "widget" && shadow.widgets.get(id)?.dynamicViewId !== undefined) return f("reference", [DV_BOUND], `ref:widget:${id}`);
  } else if (op.op === "remove_widget") {
    const w = shadow.widgets.get(op.id);
    if (!w) return missing("widget", op.id);
    const ask = confirmRemove(op.id, `the saved ${w.type} "${w.title}"`);
    if (ask) return ask;
  } else if (op.op === "remove_layer") {
    const l = shadow.layers.get(op.id);
    if (!l) return missing("layer", op.id);
    const ask = confirmRemove(op.id, `the saved layer ${l.title ? `"${l.title}"` : op.id}`);
    if (ask) return ask;
  } else if (op.op === "set_layout") {
    for (const it of op.items) if (!shadow.widgets.has(it.id)) return missing("widget", it.id);
  } else if (op.op === "remove_dynamic_view") {
    if (!shadow.dynamicViews.has(op.id)) return missing("dynamicView", op.id, "dynamic view");
  } else if (op.op === "change_widget_type" || op.op === "set_widget_title") {
    const w = shadow.widgets.get(op.id);
    if (!w) return missing("widget", op.id);
    if (w.dynamicViewId !== undefined) return f("reference", [DV_BOUND], `ref:widget:${op.id}`);
    if (op.op === "change_widget_type") {
      if (!(AI_CHART_SWAP_TYPES as readonly string[]).includes(w.type)) {
        return f("reference", ["only bar, line and pie charts can switch type; remove it and add a new one instead"], `ref:widget:${op.id}`);
      }
      if (op.type === "pie" && w.groupByCount > 1) {
        return f("reference", ["a pie chart shows one group-by column; remove the extra group-by first"], `ref:widget:${op.id}`);
      }
    }
  } else if (op.op === "add_widget" || op.op === "add_layer" || op.op === "add_dynamic_view") {
    if (shadow.usedTempIds.has(op.tempId)) return f("reference", [`temp id ${op.tempId} is already in use`], `ref:temp:${op.tempId}`);
    if (op.op === "add_layer") {
      const host = shadow.widgets.get(op.widgetId);
      if (!host) return missing("widget", op.widgetId);
      if (host.type !== "map") return f("reference", [`widget ${op.widgetId} is not a map`], `ref:widget:${op.widgetId}`);
      if (op.dynamicViewId !== undefined) {
        if (!shadow.dynamicViews.has(op.dynamicViewId) || !dvMeta(op.dynamicViewId)) return missing("dynamicView", op.dynamicViewId, "dynamic view");
        const b = dvMeta(op.dynamicViewId)?.baseTableId;
        if (b !== undefined && b !== op.tableId) return f("reference", [`the view is built on table ${b}; use tableId ${b}`], `table:${op.tableId}`);
      }
      const r = await tableRule(op.tableId);
      if (r) return r;
    }
    if (op.op === "add_widget") {
      const t = (op.config as Record<string, unknown>).tableId;
      const dv = (op.config as Record<string, unknown>).dynamicViewId;
      if (typeof dv === "number") {
        if (AI_TABLELESS_WIDGET_TYPES.includes(op.type)) return f("reference", [`${op.type} widgets can't use a dynamic view`]);
        if (op.type === "timeline") return f("reference", [TIMELINE_NO_DV]);
        if (t !== undefined) return f("reference", ["pass tableId or dynamicViewId, not both"]);
        if (!shadow.dynamicViews.has(dv) || !dvMeta(dv)) return missing("dynamicView", dv, "dynamic view");
      } else if (AI_TABLELESS_WIDGET_TYPES.includes(op.type)) {
        if (t !== undefined) {
          // Say what to do instead: a model that only hears "no table" tends to retry with the table again.
          const fix = op.type === "map" ? "leave out tableId; add the data afterwards with add_heatmap_layer on this map" : "leave out tableId";
          return f("reference", [`${op.type} widgets have no table: ${fix}`]);
        }
      } else if (typeof t !== "number") {
        return f("reference", [`tableId is required for ${op.type}`]);
      } else {
        const r = await tableRule(t);
        if (r) return r;
      }
    }
  }

  // 138: filter ops (apply_filter / clear_filter) validate against the dashboard sources + live schema and return here.
  if (op.op === "apply_filter" || op.op === "clear_filter") {
    const srcWord = (src: AiFilterSource) => (src.kind === "table" ? "table" : "dynamic view");
    /** stage d for a source: table on dashboard, or a view (saved on this dashboard, or AI-created this session). */
    const sourceRule = async (src: AiFilterSource): Promise<GatewayResult | undefined> => {
      if (src.kind === "table") return tableRule(src.id);
      if (!shadow.dynamicViews.has(src.id) || dvMeta(src.id) === undefined) return missing("dynamicView", src.id, "dynamic view");
      return undefined;
    };
    if (op.op === "clear_filter") {
      if (op.source === undefined) {
        if (![...shadow.filterCols.values()].some((set) => set.size > 0)) return f("reference", ["there are no filters to clear"]);
      } else {
        const r = await sourceRule(op.source);
        if (r) return r;
        const have = shadow.filterCols.get(aiFilterSourceKey(op.source));
        if (!have || have.size === 0) return f("reference", [`no filters on ${srcWord(op.source)} ${op.source.id}`]);
        if (op.column !== undefined && !have.has(op.column)) return f("reference", [`no filter on \`${op.column}\``]);
      }
    } else {
      const src = op.source;
      const r = await sourceRule(src);
      if (r) return r;
      let cols: { name: string; type?: string }[] | null;
      let where: string;
      if (src.kind === "table") {
        const d = await deps.liveSchema.describe(src.id);
        if (!d.ok) return f("live_schema", [`table ${src.id} is not available`], `table:${src.id}`);
        cols = d.table.columns;
        where = `table ${d.table.schema ? `${d.table.schema}.` : ""}${d.table.name}`;
      } else {
        const info = dvMeta(src.id);
        cols = info?.columns ?? null;
        where = `dynamic view ${info?.name ?? src.id}`;
      }
      const names = cols?.map((c) => c.name);
      const reasons: string[] = [];
      let refKey: string | undefined;
      const typed: AiFilterItem[] = [];
      for (const item of op.filters) {
        const col = cols?.find((c) => c.name === item.column);
        if (names && !col) {
          const near = src.kind === "table" ? nearest(item.column, names) : [];
          reasons.push(`column \`${item.column}\` not found on ${where}` + (near.length ? `; did you mean ${near.map((n) => `\`${n}\``).join(", ")}?` : ""));
          refKey ??= `col:${src.id}:${item.column}`;
          continue;
        }
        const c = coerceAiFilterItem(item, col?.type);
        if (c.ok) typed.push(c.item);
        else {
          reasons.push(c.reason);
          refKey ??= `col:${src.id}:${item.column}`;
        }
      }
      if (reasons.length) return f("live_schema", reasons, refKey);
      op.filters = typed;
      // D-08: refuse the WHOLE op past the cap; replacing an already-filtered column never adds to the count.
      const have = shadow.filterCols.get(aiFilterSourceKey(src)) ?? new Set<string>();
      const fresh = new Set(op.filters.map((q) => q.column).filter((c) => !have.has(c)));
      if (have.size + fresh.size > AI_FILTER_CAP_PER_TABLE) {
        return f("cap", [`the ${srcWord(src)} already has ${have.size} filters (limit ${AI_FILTER_CAP_PER_TABLE}); clear some first`]);
      }
    }
    const label = describeOp(op, shadow);
    applyOpToShadow(shadow, op);
    return { ok: true, op, label };
  }


  // 139: add_dynamic_view - structured spec checked against live columns AS THE USER, then compiled; returns here.
  if (op.op === "add_dynamic_view") {
    const spec = op.spec;
    if (spec.joins && spec.joins.length > dvLimits.maxJoins) return f("cap", [`a view can join at most ${dvLimits.maxJoins} tables`]);
    for (const tid of [spec.baseTableId, ...(spec.joins ?? []).map((j) => j.tableId)]) {
      const r = await tableRule(tid);
      if (r) return r;
    }
    const sessionCount = [...shadow.dynamicViews].filter((id) => id < 0).length;
    if (sessionCount >= dvMaxPerSession) {
      return f("cap", [`you already have ${sessionCount} session views (limit ${dvMaxPerSession}); remove one first`]);
    }
    const tables: AiDvTable[] = [];
    for (const tid of [spec.baseTableId, ...(spec.joins ?? []).map((j) => j.tableId)]) {
      const d = await deps.liveSchema.describe(tid);
      if (!d.ok) return f("live_schema", [`table ${tid} is not available`], `table:${tid}`);
      tables.push({ tableId: tid, ref: d.table.schema ? `${d.table.schema}.${d.table.name}` : d.table.name, columns: d.table.columns });
    }
    const v = validateAiDvSpec(spec, tables, dvLimits);
    if (!v.ok) {
      let refKey: string | undefined;
      const reasons = v.reasons.map((r) => {
        const m = v.missing.find((q) => r === `column \`${q.column}\` not found on ${tables.find((t) => t.tableId === q.tableId)?.ref}`);
        if (!m) return r;
        refKey ??= `col:${m.tableId}:${m.column}`;
        const near = nearest(m.column, (tables.find((t) => t.tableId === m.tableId)?.columns ?? []).map((c) => c.name));
        return r + (near.length ? `; did you mean ${near.map((n) => `\`${n}\``).join(", ")}?` : "");
      });
      return f("live_schema", reasons, refKey);
    }
    const c = compileAiDvSpec(spec, tables, dvLimits);
    op.columns = c.columns;
    op.maxRecords = c.maxRecords;
    op.aggregated = c.aggregated;
    const label = describeOp(op, shadow);
    applyOpToShadow(shadow, op);
    return { ok: true, op, label };
  }

  // 139: remove_dynamic_view stamps its dependents (repoint to the base table when every referenced column exists there, else drop).
  if (op.op === "remove_dynamic_view") {
    const meta = dvMeta(op.id);
    const name = meta?.name ?? `dynamic view ${op.id}`;
    const ask = confirmRemove(op.id, `the saved dynamic view "${name}"`);
    if (ask) return ask;
    let baseColumns: string[] = [];
    let baseKnown = false;
    if (meta?.baseTableId !== undefined) {
      const d = await deps.liveSchema.describe(meta.baseTableId);
      if (d.ok) {
        baseKnown = true;
        baseColumns = d.table.columns.map((c) => c.name);
      }
    }
    const plan = planDvDependents({
      widgets: [...shadow.widgets.entries()].filter(([, w]) => w.dynamicViewId === op.id).map(([id, w]) => ({ id, type: w.type, refs: w.refCols })),
      layers: [...shadow.layers.entries()].filter(([, l]) => l.dynamicViewId === op.id).map(([id, l]) => ({ id, refs: l.refCols })),
      baseColumns,
    });
    if (!baseKnown) {
      // no live base table to repoint to: every dependent goes (shadow order)
      plan.drop.widgetIds = [...shadow.widgets.entries()].filter(([, w]) => w.dynamicViewId === op.id).map(([id]) => id);
      plan.drop.layerIds = [...shadow.layers.entries()].filter(([, l]) => l.dynamicViewId === op.id).map(([id]) => id);
      plan.repoint.widgetIds = [];
      plan.repoint.layerIds = [];
    }
    if (baseKnown && meta?.baseTableId !== undefined && (plan.repoint.widgetIds.length > 0 || plan.repoint.layerIds.length > 0)) {
      op.repoint = { tableId: meta.baseTableId, ...plan.repoint };
    }
    if (plan.drop.widgetIds.length > 0 || plan.drop.layerIds.length > 0) op.drop = plan.drop;
    const savedDropped = plan.drop.widgetIds.filter((id) => id > 0).length + plan.drop.layerIds.filter((id) => id > 0).length;
    if (savedDropped > 0 && deps.approvals?.removeSaved !== true) {
      return fail("clarification", ["removing saved content needs the user's approval"], {
        ...x,
        clarification: {
          kind: "confirm_remove",
          question: `Remove the dynamic view "${name}" and ${savedDropped} saved ${savedDropped === 1 ? "item that uses" : "items that use"} it?`,
          options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        },
      });
    }
    const label = describeOp(op, shadow);
    applyOpToShadow(shadow, op);
    return { ok: true, op, label };
  }

  // e. live_schema
  // 139 D-24: bound/rebound widgets and layers are checked against the VIEW's columns, not a table.
  if (isRebind && op.op === "patch" && typeof rebindView === "number") {
    const t = op.action.target;
    const ent = t.kind === "widget" ? shadow.widgets.get(t.id) : shadow.layers.get(t.id);
    const bad = viewRefs(rebindView, (ent?.refCols ?? []).map((name) => ({ name, numeric: false })));
    if (bad) return bad;
    const vn = dvMeta(rebindView)?.name ?? String(rebindView);
    const label =
      t.kind === "widget"
        ? `Pointed "${shadow.widgets.get(t.id)?.title ?? t.id}" at dynamic view "${vn}"`
        : `Pointed layer ${shadow.layers.get(t.id)?.title ? `"${shadow.layers.get(t.id)!.title}"` : t.id} at dynamic view "${vn}"`;
    // 139 gap B: a saved view's source table comes from the dashboard lookup, not the snapshot-built shadow; record it so
    // applyOpToShadow moves the entity's tableId and later ops in this answer are checked against the new table.
    const rebindBase = dvMeta(rebindView)?.baseTableId;
    const dvi = shadow.dvInfo.get(rebindView);
    if (rebindBase !== undefined && dvi && dvi.baseTableId === undefined) dvi.baseTableId = rebindBase;
    applyOpToShadow(shadow, op);
    return { ok: true, op, label };
  }
  const boundView =
    op.op === "add_widget" && typeof (op.config as Record<string, unknown>).dynamicViewId === "number" ? ((op.config as Record<string, unknown>).dynamicViewId as number)
    : op.op === "add_layer" ? op.dynamicViewId
    : undefined;
  const cr = boundView !== undefined ? undefined : opColumnRefs(op, shadow);
  if (boundView !== undefined) {
    const refs = opColumnRefs(op, shadow)?.refs ?? [];
    const bad = viewRefs(boundView, refs);
    if (bad) return bad;
  }
  if (cr && (cr.probe || cr.refs.length > 0)) {
    if (cr.tableId === undefined) return f("live_schema", ["table is not available"]);
    const d = await deps.liveSchema.describe(cr.tableId);
    if (!d.ok) return f("live_schema", [`table ${cr.tableId} is not available`], `table:${cr.tableId}`);
    const names = d.table.columns.map((c) => c.name);
    const reasons: string[] = [];
    let refKey: string | undefined;
    for (const c of cr.refs) {
      const key = `col:${cr.tableId}:${c.name}`;
      if (!names.includes(c.name)) {
        const near = nearest(c.name, names);
        reasons.push(
          `column \`${c.name}\` not found on table ${d.table.schema ? `${d.table.schema}.` : ""}${d.table.name}` +
            (near.length ? `; did you mean ${near.map((n) => `\`${n}\``).join(", ")}?` : ""),
        );
        refKey ??= key;
      } else if (c.numeric) {
        const col = d.table.columns.find((q) => q.name === c.name);
        if (isAiNumericColumnType(col?.type) === false) {
          reasons.push(`column ${c.name} is not numeric`);
          refKey ??= key;
        }
      } else if (c.temporal) {
        // an untyped column (type unknown) is not refused, same as the numeric rule
        if (isAiTemporalColumnType(d.table.columns.find((q) => q.name === c.name)?.type) === false) {
          reasons.push(NOT_TEMPORAL(c.name));
          refKey ??= key;
        }
      }
    }
    if (reasons.length) return f("live_schema", reasons, refKey);
  }

  // f. layout: the gateway (never the model) places new widgets so nothing overlaps.
  if (op.op === "add_widget") {
    const size = AI_DEFAULT_SIZE[op.type as AiWidgetType];
    const r = placeWidget(shadowRects(shadow), size);
    op.layout = { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  if (op.op === "set_layout") {
    const next = new Map(shadowRects(shadow).map((r) => [r.id, r]));
    for (const it of op.items) next.set(it.id, it);
    const v = validateLayout([...next.values()]);
    if (!v.valid) return f("layout", v.reasons);
  }

  // g. ok
  const label = describeOp(op, shadow);
  applyOpToShadow(shadow, op);
  return { ok: true, op, label };
}
