// Phase 135 (AISAFE-V20-02/03): the ONE validation gateway every AI change passes, in a fixed order:
// shape -> allow_list -> permission -> reference -> live_schema, stopping at the first failure.
// Reasons are built from fixed text, paths, ids and column NAMES only - never rejected argument values or upstream error text.
import {
  AI_CHART_SWAP_TYPES,
  AI_DEFAULT_SIZE,
  isAiNumericColumnType,
  parseAiOp,
  placeWidget,
  validateActionPatch,
  validateAiWidgetConfig,
  resolveHeatmapHost,
  validateAiLayerPatch,
  validateLayout,
  type AiClarification,
  type AiOp,
  type AiWidgetType,
} from "@kinetica-bi/shared";
import type { GatewayResult, GatewayStage, LiveSchemaPort, MutateTool } from "./tools/types";
import { applyOpToShadow, describeIntent, describeOp, shadowRects, type ShadowState } from "./shadow";

// Literal on purpose (see PERMISSIONS.AI_USE in lib/permissions.ts; kept local to avoid a catalog import cycle in specs).
const AI_USE = "ai:use";

/** Config keys the bar/line/pie/table/bignumber/records renderers read as COLUMN NAMES
 *  (packages/web/src/components/charts/WidgetRenderer.tsx:1057-1068 metricColumn/groupByColumn/groupByColumns;
 *   :1383-1384, :1693-1694, :1850-1851, :1968-1977 same keys). `metric`/`dimension` are snapshot-binding names only; no renderer reads them from config. */
export const AI_COLUMN_BINDING_KEYS: readonly string[] = ["metric", "metricColumn", "groupByColumn", "groupByColumns"];

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

type ColRef = { name: string; numeric: boolean };
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
    return refs;
  };
  if (op.op === "add_widget") {
    const t = (op.config as Record<string, unknown>).tableId;
    const tableId = typeof t === "number" ? t : undefined;
    return { tableId, refs: fromRec(op.config), probe: op.type !== "map" };
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
  const candidate = tool.toOp(parsed.data);
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
  const p = parseAiOp(candidate);
  if (!p.ok) return fail("shape", p.errors);
  const op: AiOp = p.op;
  const x: FailExtras = { slot: slotOf(op), label: describeIntent(op, shadow) };
  const f = (stage: GatewayStage, reasons: string[], refKey?: string): GatewayResult => fail(stage, reasons, { ...x, ...(refKey ? { refKey } : {}) });

  if (op.op === "patch" && Object.keys(op.action.configPatch).length === 0) {
    return f("shape", ["nothing to change; pass at least one setting"]);
  }

  // b. allow_list
  if (op.op === "add_widget") {
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
    if (kind === "widget" && shadow.widgets.get(id)?.dynamicViewId !== undefined) return f("reference", [DV_BOUND], `ref:widget:${id}`);
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
      const r = await tableRule(op.tableId);
      if (r) return r;
    }
    if (op.op === "add_widget") {
      const t = (op.config as Record<string, unknown>).tableId;
      if (op.type === "map") {
        if (t !== undefined) return f("reference", ["map widgets have no table"]);
      } else if (typeof t !== "number") {
        return f("reference", [`tableId is required for ${op.type}`]);
      } else {
        const r = await tableRule(t);
        if (r) return r;
      }
    }
  }

  // e. live_schema
  const cr = opColumnRefs(op, shadow);
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
