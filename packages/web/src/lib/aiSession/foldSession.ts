// Phase 134/136: pure apply-time evaluation + fold of the session op-log. No stores, no toast, no
// runtime api/client imports, no chart registry (AI_WIDGET_DEFAULTS is hand-written). See types.ts
// for the op-log-vs-inverse design note.
import { translateWidgetOverlay, overlayTouchesChartSql } from "../widgetOverlayKeys";
import { translateLayerOverlay } from "../applyLayerOverrides";
import { deriveChartConfig } from "../chartSql";
import { AI_WIDGET_DEFAULTS } from "../aiWidgetDefaults";
import { makeAiHeatmapLayerConfig } from "../layerDefaults";
import { paletteColorAarrggbb } from "../aiPalette";
import {
  parseAiOp,
  validateActionPatch,
  validateAiWidgetConfig,
  validateAiLayerPatch,
  validateLayout,
  rectsOverlap,
  resolveRect,
  AI_CHART_SWAP_TYPES,
} from "@kinetica-bi/shared";
import { layersOfMap } from "@kinetica-bi/shared";
import { aiFilterSourceKey, AI_FILTER_CAP_PER_TABLE } from "@kinetica-bi/shared";
import { aiDvIsAggregated, AI_DV_DEFAULT_MAX_RECORDS } from "@kinetica-bi/shared";
import type { AiOp, AiWidgetType, AiDvSpec } from "@kinetica-bi/shared";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import { splitLayerSnapshot } from "../applyWidgetAction";
import { EMPTY_DERIVED } from "./constants";
import type {
  EvaluateOptions,
  OpResult,
  SessionBaseline,
  SessionDerived,
  SessionDv,
  SessionRect,
  SessionWidgetMeta,
  TurnEntry,
} from "./types";

type AddWidgetOp = Extract<AiOp, { op: "add_widget" }>;
type AddLayerOp = Extract<AiOp, { op: "add_layer" }>;
type Cfg = Record<string, unknown>;

/** D-23 defence in depth: keys the AI must never supply; removed before any use. */
const STRIP_KEYS = [
  "sql", "customWhere", "table", "tableRef", "drillDownColumn", "drillDownColumnType",
  "dynamicViewId", "dynamic_view_id", "metricId", "layout",
] as const;

function strip(config: Cfg): Cfg {
  const out: Cfg = {};
  for (const k of Object.keys(config)) {
    if ((STRIP_KEYS as readonly string[]).includes(k)) continue;
    out[k] = config[k];
  }
  return out;
}

const DEFAULT_CAP = 12;
const DERIVE_TYPES = ["bar", "line", "pie", "table", "bignumber"];

function findTable(baseline: SessionBaseline, id: unknown) {
  return typeof id === "number" ? baseline.tables?.find((t) => t.id === id) : undefined;
}

/** Re-derive sql/drill columns from structured fields (same generator as the config panel). */
function deriveInto(type: string, cfg: Cfg, baseline: SessionBaseline): Cfg {
  if (!DERIVE_TYPES.includes(type)) return cfg;
  const t = findTable(baseline, cfg.tableId);
  const tableName = t ? `${t.schema}.${t.name}` : typeof cfg.table === "string" ? cfg.table : "";
  if (!tableName) return cfg;
  const d = deriveChartConfig(type, cfg, {
    tableName,
    tableColumns: t?.columns ?? {},
    maxBarGroupBySeriesCap: baseline.maxBarGroupBySeriesCap ?? DEFAULT_CAP,
  });
  return d ? { ...cfg, ...d } : cfg;
}

/**
 * 142: model-facing timeline keys (timeColumn, metric, aggregation, color, yFieldLabel, showLegend) -> TimelineRenderer
 * config (timeCol + one metrics[] entry, aggregation upper-case, colour AARRGGBB). Nothing else is copied.
 */
function timelineRendererConfig(fields: Cfg): Cfg {
  const color = paletteColorAarrggbb(typeof fields.color === "string" ? fields.color : "violet") ?? paletteColorAarrggbb("violet");
  const metric: Cfg = {
    column: fields.metric,
    aggregation: typeof fields.aggregation === "string" ? fields.aggregation.toUpperCase() : fields.aggregation,
    color,
  };
  if (typeof fields.yFieldLabel === "string" && fields.yFieldLabel !== "") metric.label = fields.yFieldLabel;
  const out: Cfg = { timeCol: fields.timeColumn, metrics: [metric] };
  if (typeof fields.showLegend === "boolean") out.showLegend = fields.showLegend;
  return out;
}

/** The AI never supplies SQL: strip, apply defaults, translate to renderer keys, derive (D-01/D-23). */
export type DvBinding = { baseTableId: number | undefined; columns: readonly { name: string; type: string }[] };

export function makeSessionWidget(op: AddWidgetOp, baseline: SessionBaseline, dvBinding?: DvBinding): WidgetDto {
  // 139: dynamicViewId is honoured ONLY when the caller resolved a binding (stripped otherwise, D-23 defence in depth).
  const dvId = dvBinding && typeof op.config.dynamicViewId === "number" ? op.config.dynamicViewId : undefined;
  const { tableId, ...fields } = strip(op.config);
  const defaults = AI_WIDGET_DEFAULTS[op.type as AiWidgetType]?.config ?? {};
  if (op.type === "timeline") {
    // table-bound only (evaluate refuses a view binding): TimelineRenderer reads tableId + tableRef and runs its own SQL
    const config: Cfg = { ...defaults, ...timelineRendererConfig(fields) };
    const tt = findTable(baseline, tableId);
    if (tt) {
      config.tableId = tt.id;
      config.tableRef = `${tt.schema}.${tt.name}`;
    }
    if (op.layout) config.layout = { ...op.layout };
    return { id: op.tempId, dashboard_id: baseline.dashboardId, title: op.title, type: op.type, position: 0, config, created_at: "", updated_at: "" };
  }
  let config: Cfg = { ...defaults, ...translateWidgetOverlay(op.type, fields) };
  delete config.metricId;
  if (op.type === "records" && Array.isArray(config.columns)) config.columns = config.columns.join(", ");
  const t = findTable(baseline, dvId !== undefined ? dvBinding!.baseTableId : tableId);
  if (dvId !== undefined) config.dynamicViewId = dvId;
  if (t) {
    config.tableId = t.id;
    config.table = `${t.schema}.${t.name}`;
    // ChartConfigPanel dual-write convention: SQL names the base table (renderers FROM-swap to the view); column types = base + view output.
    const derivedFrom: SessionBaseline =
      dvId === undefined
        ? baseline
        : {
            ...baseline,
            tables: baseline.tables!.map((x) =>
              x.id === t.id ? { ...x, columns: { ...x.columns, ...Object.fromEntries(dvBinding!.columns.map((c) => [c.name, c.type])) } } : x,
            ),
          };
    config = deriveInto(op.type, config, derivedFrom);
  }
  if (op.layout) config.layout = { ...op.layout };
  return {
    id: op.tempId,
    dashboard_id: baseline.dashboardId,
    title: op.title,
    type: op.type,
    position: 0,
    config,
    created_at: "",
    updated_at: "",
  };
}

/** AI heatmap layer: table_id is the dashboard table, config is the complete heatmap config. */
export function makeSessionLayer(op: AddLayerOp, baseline: SessionBaseline, position: number): DashboardLayerDto {
  return {
    id: op.tempId,
    dashboard_id: baseline.dashboardId,
    table_id: op.tableId,
    layer_type: "KineticaWms",
    position,
    config: makeAiHeatmapLayerConfig({
      spatialMode: op.spatialMode,
      latColumn: op.latColumn,
      lonColumn: op.lonColumn,
      wktColumn: op.wktColumn,
      wkbColumn: op.wkbColumn,
      name: op.name,
      style: op.style,
    }),
    // Clickable like a hand-made layer (DB default 1); 0 was a stub-layer leftover that hid the info popup.
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: op.dynamicViewId ?? null,
    cb_config: null,
    track_config: null,
    filter_scope: null,
    created_at: "",
    updated_at: "",
  };
}

/** 138 D-09: filter ops are view state; the fold and the lock selector ignore them. */
export function isFilterOp(op: AiOp | null | undefined): boolean {
  return op?.op === "apply_filter" || op?.op === "clear_filter";
}

const skip = (reason: Exclude<OpResult, { status: "applied" }>["reason"], detail?: string): OpResult =>
  detail === undefined ? { status: "skipped", reason } : { status: "skipped", reason, detail };

type SimWidget = { type: string; saved: boolean; dvBound: boolean; groupCols: number; rect?: SessionRect };
type Sim = {
  widgets: Map<number, SimWidget>;
  layers: Map<number, { renderMode?: string; saved: boolean }>;
  dvs: Set<number>;
  dvBase: Map<number, number>;
  usedTemp: Set<number>;
  tableIds: Set<number> | null; // null: baseline.tables absent, table checks skipped
  tableColumns: Map<number, Readonly<Record<string, string>>> | null;
  filters: Map<string, Set<string>>; // seeded from opts.currentFilters at apply time, never from prior entries
};

function groupColCount(cfg: Cfg): number {
  return Array.isArray(cfg.groupByColumns) ? (cfg.groupByColumns as unknown[]).filter(Boolean).length : 0;
}

/** D-24: a patch whose only key is `dynamicViewId` rebinds a widget/layer to a view. */
function isRebindPatch(configPatch: Cfg): boolean {
  const keys = Object.keys(configPatch);
  return keys.length === 1 && keys[0] === "dynamicViewId";
}

function simApply(sim: Sim, op: AiOp): void {
  switch (op.op) {
    case "add_dynamic_view":
      sim.dvs.add(op.tempId);
      sim.dvBase.set(op.tempId, op.spec.baseTableId);
      break;
    case "remove_dynamic_view":
      sim.dvs.delete(op.id);
      for (const id of op.repoint?.widgetIds ?? []) {
        const w = sim.widgets.get(id);
        if (w) sim.widgets.set(id, { ...w, dvBound: false });
      }
      for (const id of op.drop?.widgetIds ?? []) sim.widgets.delete(id);
      for (const id of op.drop?.layerIds ?? []) sim.layers.delete(id);
      break;
    case "add_widget":
      sim.widgets.set(op.tempId, {
        type: op.type,
        saved: false,
        dvBound: typeof op.config.dynamicViewId === "number",
        groupCols: groupColCount(op.config),
        ...(op.layout ? { rect: { ...op.layout } } : {}),
      });
      break;
    case "remove_widget":
      sim.widgets.delete(op.id);
      break;
    case "add_layer":
      sim.layers.set(op.tempId, { renderMode: "heatmap", saved: false });
      break;
    case "remove_layer":
      sim.layers.delete(op.id);
      break;
    case "change_widget_type": {
      const w = sim.widgets.get(op.id);
      if (w) sim.widgets.set(op.id, { ...w, type: op.type });
      break;
    }
    case "set_layout":
      for (const it of op.items) {
        const w = sim.widgets.get(it.id);
        if (w) sim.widgets.set(it.id, { ...w, rect: { x: it.x, y: it.y, w: it.w, h: it.h } });
      }
      break;
    case "patch": {
      const { target, configPatch } = op.action;
      if (target.kind === "widget" && isRebindPatch(configPatch)) {
        const w = sim.widgets.get(target.id);
        if (w) sim.widgets.set(target.id, { ...w, dvBound: true });
        break;
      }
      if (target.kind === "widget" && Array.isArray(configPatch.groupByColumns)) {
        const w = sim.widgets.get(target.id);
        if (w) sim.widgets.set(target.id, { ...w, groupCols: groupColCount(configPatch) });
      }
      break;
    }
    default:
      break;
  }
}

function noteTemp(sim: Sim, op: AiOp): void {
  if (op.op === "add_widget" || op.op === "add_layer" || op.op === "add_dynamic_view") sim.usedTemp.add(op.tempId);
}

function buildSim(baseline: SessionBaseline, prior: readonly TurnEntry[]): Sim {
  const sim: Sim = {
    widgets: new Map(
      baseline.widgets.map((x, i) => [
        x.id,
        {
          type: x.type,
          saved: true,
          dvBound: x.config.dynamicViewId !== undefined && x.config.dynamicViewId !== null,
          groupCols: groupColCount(x.config),
          rect: resolveRect(x.config.layout as Partial<SessionRect> | undefined, i),
        },
      ]),
    ),
    layers: new Map(
      baseline.layers.map((x) => [x.id, { renderMode: (x.config as Cfg).renderMode as string | undefined, saved: true }]),
    ),
    dvs: new Set(baseline.dynamicViewIds),
    dvBase: new Map(Object.entries(baseline.dynamicViewSources ?? {}).map(([k, v]) => [Number(k), v])),
    usedTemp: new Set(),
    tableIds: baseline.tables ? new Set(baseline.tables.map((t) => t.id)) : null,
    tableColumns: baseline.tables ? new Map(baseline.tables.map((t) => [t.id, t.columns])) : null,
    filters: new Map(),
  };
  for (const e of prior) {
    if (!e.op) continue;
    noteTemp(sim, e.op);
    if (e.result.status === "applied") simApply(sim, e.op);
  }
  return sim;
}

function evalRebind(sim: Sim, configPatch: Cfg): OpResult {
  if (!isRebindPatch(configPatch)) return skip("patch_rejected", "change the view binding on its own");
  const v = configPatch.dynamicViewId;
  if (typeof v !== "number" || !Number.isInteger(v) || v === 0) return skip("patch_rejected", "invalid value for dynamicViewId");
  return sim.dvs.has(v) ? { status: "applied" } : skip("target_not_found", "no such dynamic view");
}

/** Column names the spec reads from the BASE table (from 0/absent). Joined tables are checked server-side. */
function baseTableColumnRefs(spec: AiDvSpec): string[] {
  const out: string[] = [];
  for (const list of [spec.columns, spec.groupBy, spec.aggregates, spec.filters] as ({ from?: number; column?: string }[] | undefined)[]) {
    for (const it of list ?? []) if ((it.from ?? 0) === 0 && it.column !== undefined) out.push(it.column);
  }
  for (const j of spec.joins ?? []) for (const k of j.on) if ((k.leftFrom ?? 0) === 0) out.push(k.left);
  return out;
}

function evaluateOne(sim: Sim, rawOp: unknown, opts: EvaluateOptions): TurnEntry {
  const parsed = parseAiOp(rawOp);
  if (!parsed.ok) return { raw: rawOp, op: null, result: skip("invalid_op", parsed.errors.join("; ")) };
  const op = parsed.op;
  const done = (result: OpResult): TurnEntry => {
    noteTemp(sim, op);
    if (result.status === "applied") simApply(sim, op);
    return { raw: rawOp, op, result };
  };
  // 137: defence in depth; the gateway refuses these too (137-01). The AI Assistant widget is never AI-editable.
  const isAi = (id: number) => sim.widgets.get(id)?.type === "ai";
  const aiTarget =
    op.op === "patch" ? (op.action.target.kind === "widget" && isAi(op.action.target.id))
    : op.op === "remove_widget" || op.op === "change_widget_type" || op.op === "set_widget_title" ? isAi(op.id)
    : op.op === "set_layout" ? op.items.some((it) => isAi(it.id))
    : false;
  if (aiTarget) return done(skip("unsupported_target", "AI assistant widget"));
  const tableOk = (id: unknown) => id === undefined || sim.tableIds === null || (typeof id === "number" && sim.tableIds.has(id));
  switch (op.op) {
    case "apply_filter": {
      const src = op.source;
      const key = aiFilterSourceKey(src);
      if (src.kind === "table") {
        if (!tableOk(src.id)) return done(skip("table_not_on_dashboard"));
        const cols = sim.tableColumns?.get(src.id);
        if (cols) {
          const missing = op.filters.find((f) => !(f.column in cols));
          if (missing) return done(skip("column_not_found", missing.column));
        }
      } else {
        if (!sim.dvs.has(src.id)) return done(skip("target_not_found"));
      }
      const have = sim.filters.get(key) ?? new Set<string>();
      const fresh = new Set(op.filters.map((f) => f.column).filter((c) => !have.has(c)));
      if (have.size + fresh.size > AI_FILTER_CAP_PER_TABLE) return done(skip("filter_cap", `${have.size} filters`));
      sim.filters.set(key, new Set([...have, ...fresh]));
      return done({ status: "applied" });
    }
    case "clear_filter": {
      const src = op.source;
      if (!src) {
        sim.filters.clear();
        return done({ status: "applied" });
      }
      const key = aiFilterSourceKey(src);
      if (src.kind === "table") {
        if (!tableOk(src.id)) return done(skip("table_not_on_dashboard"));
      } else {
        if (!sim.dvs.has(src.id)) return done(skip("target_not_found"));
      }
      if (op.column !== undefined) {
        if (!sim.filters.get(key)?.has(op.column)) return done(skip("target_not_found", `no filter on ${op.column}`));
        sim.filters.get(key)!.delete(op.column);
      } else {
        sim.filters.delete(key);
      }
      return done({ status: "applied" });
    }
    case "add_dynamic_view": {
      if (sim.usedTemp.has(op.tempId)) return done(skip("duplicate_temp_id"));
      const spec = op.spec;
      if (!tableOk(spec.baseTableId) || (spec.joins ?? []).some((j) => !tableOk(j.tableId))) return done(skip("table_not_on_dashboard"));
      const baseCols = sim.tableColumns?.get(spec.baseTableId);
      if (baseCols) {
        for (const name of baseTableColumnRefs(spec)) if (!(name in baseCols)) return done(skip("column_not_found", name));
      }
      return done({ status: "applied" });
    }
    case "remove_dynamic_view":
      if (!sim.dvs.has(op.id)) return done(skip("target_not_found"));
      if (op.id > 0 && !opts.removalApproved) return done(skip("needs_confirmation"));
      return done({ status: "applied" });
    case "add_widget": {
      if (sim.usedTemp.has(op.tempId)) return done(skip("duplicate_temp_id"));
      // 142 UAT: ops arrive from the server, which may stamp a map defaultView (never model-settable: the gateway refuses it).
      const v = validateAiWidgetConfig(op.type, op.config, { allowServerStamped: true });
      if (!v.valid) return done(skip("config_rejected", v.reasons.join("; ")));
      if (op.type === "timeline" && "dynamicViewId" in op.config) return done(skip("config_rejected", "a timeline can't use a dynamic view"));
      if ("dynamicViewId" in op.config) {
        if (op.config.tableId !== undefined) return done(skip("config_rejected", "pass tableId or dynamicViewId, not both"));
        if (typeof op.config.dynamicViewId !== "number" || !sim.dvs.has(op.config.dynamicViewId)) return done(skip("target_not_found", "no such dynamic view"));
      }
      if (!tableOk(op.config.tableId)) return done(skip("table_not_on_dashboard"));
      return done({ status: "applied" });
    }
    case "add_layer":
      if (sim.usedTemp.has(op.tempId)) return done(skip("duplicate_temp_id"));
      if (op.dynamicViewId !== undefined && !sim.dvs.has(op.dynamicViewId)) return done(skip("target_not_found", "no such dynamic view"));
      if (sim.widgets.get(op.widgetId)?.type !== "map") return done(skip("target_not_found", `no map widget ${op.widgetId}`));
      if (!tableOk(op.tableId)) return done(skip("table_not_on_dashboard"));
      return done({ status: "applied" });
    // D-06: existence first, then the ask-once gate for SAVED content (id > 0). AI-added (negative)
    // content is removed without asking.
    case "remove_widget":
      if (!sim.widgets.has(op.id)) return done(skip("target_not_found"));
      if (op.id > 0 && !opts.removalApproved) return done(skip("needs_confirmation"));
      return done({ status: "applied" });
    case "remove_layer":
      if (!sim.layers.has(op.id)) return done(skip("target_not_found"));
      if (op.id > 0 && !opts.removalApproved) return done(skip("needs_confirmation"));
      return done({ status: "applied" });
    case "patch": {
      const { target, configPatch } = op.action;
      if (target.kind === "layer") {
        const lay = sim.layers.get(target.id);
        if (!lay) return done(skip("target_not_found"));
        if ("dynamicViewId" in configPatch) return done(evalRebind(sim, configPatch));
        const v = validateAiLayerPatch(configPatch, lay.renderMode);
        if (!v.valid) {
          const onlyRestyle = v.reasons.every((r) => r === "only heatmap layers can be restyled");
          return done(skip(onlyRestyle ? "unsupported_target" : "patch_rejected", v.reasons.join("; ")));
        }
        return done({ status: "applied" });
      }
      if (target.kind === "widget") {
        const w = sim.widgets.get(target.id);
        if (!w) return done(skip("target_not_found"));
        if (w.type === "timeline") return done(skip("unsupported_target", "a timeline can't be edited"));
        if ("dynamicViewId" in configPatch) return done(evalRebind(sim, configPatch));
        if (w.dvBound) return done(skip("unsupported_target", "widget is bound to a dynamic view"));
        const v = validateActionPatch("widget", w.type, configPatch);
        if (!v.valid) return done(skip("patch_rejected", v.reasons.join("; ")));
        return done({ status: "applied" });
      }
      if (!sim.dvs.has(target.id)) return done(skip("target_not_found"));
      const v = validateActionPatch(target.kind, undefined, configPatch);
      if (!v.valid) return done(skip("patch_rejected", v.reasons.join("; ")));
      return done({ status: "applied" });
    }
    case "set_layout": {
      for (const it of op.items) if (!sim.widgets.has(it.id)) return done(skip("target_not_found", `no widget ${it.id}`));
      const v = validateLayout(op.items);
      if (!v.valid) return done(skip("layout_rejected", v.reasons.join("; ")));
      const moved = new Set(op.items.map((it) => it.id));
      for (const it of op.items) {
        for (const [id, w] of sim.widgets) {
          if (moved.has(id) || !w.rect) continue;
          if (rectsOverlap(it, w.rect)) return done(skip("layout_rejected", `widgets ${it.id} and ${id} overlap`));
        }
      }
      return done({ status: "applied" });
    }
    case "change_widget_type": {
      const w = sim.widgets.get(op.id);
      if (!w) return done(skip("target_not_found"));
      if (!(AI_CHART_SWAP_TYPES as readonly string[]).includes(w.type) || w.dvBound) return done(skip("unsupported_target"));
      if (op.type === "pie" && w.groupCols >= 2) return done(skip("unsupported_target", "pie supports one group-by column"));
      return done({ status: "applied" });
    }
    case "set_widget_title":
      return done(sim.widgets.has(op.id) ? { status: "applied" } : skip("target_not_found"));
  }
}

/** Evaluate one turn's raw ops against baseline + prior entries. Never throws. */
export function evaluateTurn(
  baseline: SessionBaseline,
  prior: readonly TurnEntry[],
  rawOps: readonly unknown[],
  opts: EvaluateOptions = {},
): TurnEntry[] {
  const sim = buildSim(baseline, prior);
  for (const [k, names] of Object.entries(opts.currentFilters ?? {})) sim.filters.set(k, new Set(names));
  return rawOps.map((r) => {
    try {
      return evaluateOne(sim, r, opts);
    } catch (err) {
      return { raw: r, op: null, result: skip("invalid_op", String(err)) };
    }
  });
}

function mergeLayerPatch(existing: Cfg | undefined, patch: Cfg): Cfg {
  const { config: patchConfig, topLevel } = splitLayerSnapshot(patch);
  const { config: existingConfig, ...existingTop } = (existing ?? {}) as { config?: Cfg } & Cfg;
  const merged: Cfg = { ...existingTop, ...topLevel };
  const cfg = patchConfig !== undefined ? { ...(existingConfig ?? {}), ...patchConfig } : existingConfig;
  if (cfg !== undefined && Object.keys(cfg).length > 0) merged.config = cfg;
  return merged;
}

/** Pure: fold applied entries into derived added/removed/patched state. */
export function foldSession(baseline: SessionBaseline, entries: Iterable<TurnEntry>): SessionDerived {
  const savedWidgets = new Map(baseline.widgets.map((x) => [x.id, x]));
  const addedWidgets = new Map<number, WidgetDto>();
  const addedLayers = new Map<number, DashboardLayerDto>();
  const removedWidgetIds = new Set<number>();
  const removedLayerIds = new Set<number>();
  const contribution = {
    widget: {} as Record<number, Cfg>,
    layer: {} as Record<number, Cfg>,
    dynamicView: {} as Record<number, Cfg>,
  };
  const layout: Record<number, SessionRect> = {};
  const widgetMeta: Record<number, SessionWidgetMeta> = {};
  const aiEditedWidgetIds = new Set<number>();
  const aiEditedLayerIds = new Set<number>();
  const addedDvs = new Map<number, SessionDv>();
  const removedDvIds = new Set<number>();
  const layerBinding: Record<number, { table_id: number | null; dynamic_view_id: number | null }> = {};
  const savedLayers = new Map(baseline.layers.map((x) => [x.id, x]));
  let applied = 0;

  const flagWidget = (id: number) => {
    if (savedWidgets.has(id)) aiEditedWidgetIds.add(id);
  };
  const baseOf = (id: number): number | undefined => addedDvs.get(id)?.baseTableId ?? baseline.dynamicViewSources?.[id];
  const dvBindingFor = (id: number): DvBinding => ({
    baseTableId: baseOf(id),
    columns: addedDvs.get(id)?.columns ?? baseline.dynamicViewColumns?.[id] ?? [],
  });
  const tableNameOf = (tableId: number | undefined): string | undefined => {
    const t = findTable(baseline, tableId);
    return t ? `${t.schema}.${t.name}` : undefined;
  };
  // Bind (dv number) or unbind (dv undefined, widgets read the base table) a widget. Saved widgets go through
  // widgetMeta (the overlay validators strip data-binding keys); `dynamicViewId: undefined` reads as unbound.
  const bindWidget = (id: number, dv: number | undefined, tableId: number | undefined) => {
    const tableName = tableNameOf(tableId);
    const binding: Cfg = {
      dynamicViewId: dv,
      ...(tableId !== undefined ? { tableId } : {}),
      ...(tableName !== undefined ? { table: tableName } : {}),
    };
    const temp = addedWidgets.get(id);
    if (temp) {
      const config: Cfg = { ...temp.config, ...binding };
      if (dv === undefined) delete config.dynamicViewId;
      addedWidgets.set(id, { ...temp, config });
    } else if (savedWidgets.has(id) && !removedWidgetIds.has(id)) {
      widgetMeta[id] = { ...widgetMeta[id], config: { ...widgetMeta[id]?.config, ...binding } };
      flagWidget(id);
    }
  };
  const bindLayer = (id: number, dv: number | null, tableId: number | undefined) => {
    const temp = addedLayers.get(id);
    if (temp) {
      addedLayers.set(id, { ...temp, dynamic_view_id: dv, ...(tableId !== undefined ? { table_id: tableId } : {}) });
    } else if (savedLayers.has(id) && !removedLayerIds.has(id)) {
      const cur = layerBinding[id]?.table_id ?? savedLayers.get(id)!.table_id;
      layerBinding[id] = { table_id: tableId ?? cur, dynamic_view_id: dv };
      aiEditedLayerIds.add(id);
    }
  };
  const removeWidgetId = (id: number) => {
    if (addedWidgets.has(id)) addedWidgets.delete(id);
    else if (savedWidgets.has(id)) {
      removedWidgetIds.add(id);
      delete contribution.widget[id];
      delete widgetMeta[id];
      aiEditedWidgetIds.delete(id);
    }
    delete layout[id];
  };
  const removeLayerId = (id: number) => {
    if (addedLayers.has(id)) addedLayers.delete(id);
    else if (savedLayers.has(id)) {
      removedLayerIds.add(id);
      delete contribution.layer[id];
      delete layerBinding[id];
      aiEditedLayerIds.delete(id);
    }
  };

  for (const e of entries) {
    if (e.result.status !== "applied" || !e.op) continue;
    if (isFilterOp(e.op)) continue; // 138 D-09: filters are view state, never derived/counted
    applied++;
    const op = e.op;
    switch (op.op) {
      case "add_dynamic_view":
        addedDvs.set(op.tempId, {
          id: op.tempId,
          name: op.name,
          spec: op.spec,
          baseTableId: op.spec.baseTableId,
          columns: op.columns ?? [],
          ...(op.maxRecords !== undefined ? { maxRecords: op.maxRecords } : {}),
          aggregated: op.aggregated ?? aiDvIsAggregated(op.spec),
        });
        break;
      case "remove_dynamic_view": {
        if (addedDvs.has(op.id)) addedDvs.delete(op.id);
        else {
          removedDvIds.add(op.id);
          delete contribution.dynamicView[op.id];
        }
        if (op.repoint) {
          for (const id of op.repoint.widgetIds) bindWidget(id, undefined, op.repoint.tableId);
          for (const id of op.repoint.layerIds) bindLayer(id, null, op.repoint.tableId);
        }
        for (const id of op.drop?.widgetIds ?? []) removeWidgetId(id);
        for (const id of op.drop?.layerIds ?? []) removeLayerId(id);
        break;
      }
      case "add_widget": {
        const dv = typeof op.config.dynamicViewId === "number" ? op.config.dynamicViewId : undefined;
        addedWidgets.set(op.tempId, makeSessionWidget(op, baseline, dv !== undefined ? dvBindingFor(dv) : undefined));
        break;
      }
      case "add_layer": {
        addedLayers.set(op.tempId, makeSessionLayer(op, baseline, baseline.layers.length + addedLayers.size));
        const hostTemp = addedWidgets.get(op.widgetId);
        if (hostTemp) {
          const inc = hostTemp.config.includedLayerIds;
          if (Array.isArray(inc) && inc.length > 0) {
            addedWidgets.set(op.widgetId, { ...hostTemp, config: { ...hostTemp.config, includedLayerIds: [...inc, op.tempId] } });
          }
        } else {
          const baseInc = savedWidgets.get(op.widgetId)?.config.includedLayerIds;
          if (Array.isArray(baseInc) && baseInc.length > 0) {
            const cur = contribution.widget[op.widgetId]?.includedLayerIds;
            const list = Array.isArray(cur) ? cur : baseInc;
            contribution.widget[op.widgetId] = { ...contribution.widget[op.widgetId], includedLayerIds: [...list, op.tempId] };
          }
        }
        break;
      }
      case "remove_widget":
        removeWidgetId(op.id);
        break;
      case "remove_layer":
        removeLayerId(op.id);
        break;
      case "patch": {
        const { target, configPatch } = op.action;
        if ((target.kind === "widget" || target.kind === "layer") && "dynamicViewId" in configPatch) {
          // D-24 rebind (evaluate guarantees dynamicViewId is the only key and the view exists)
          const dv = configPatch.dynamicViewId as number;
          if (target.kind === "widget") bindWidget(target.id, dv, baseOf(dv));
          else bindLayer(target.id, dv, baseOf(dv));
        } else if (target.kind === "widget") {
          const temp = addedWidgets.get(target.id);
          if (temp) {
            const translated = translateWidgetOverlay(temp.type, configPatch);
            delete translated.metricId;
            let config: Cfg = { ...temp.config, ...translated };
            if (overlayTouchesChartSql(translated)) config = deriveInto(temp.type, config, baseline);
            addedWidgets.set(target.id, { ...temp, config });
          } else {
            contribution.widget[target.id] = { ...contribution.widget[target.id], ...configPatch };
            flagWidget(target.id);
          }
        } else if (target.kind === "layer") {
          const temp = addedLayers.get(target.id);
          if (temp) {
            const { config, topLevel } = splitLayerSnapshot(configPatch);
            addedLayers.set(target.id, {
              ...temp,
              ...(topLevel as Partial<DashboardLayerDto>),
              config: { ...temp.config, ...translateLayerOverlay(config ?? {}) },
            });
          } else {
            contribution.layer[target.id] = mergeLayerPatch(contribution.layer[target.id], configPatch);
            aiEditedLayerIds.add(target.id);
          }
        } else {
          contribution.dynamicView[target.id] = { ...contribution.dynamicView[target.id], ...configPatch };
        }
        break;
      }
      case "set_layout":
        for (const it of op.items) {
          layout[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
          flagWidget(it.id);
        }
        break;
      case "change_widget_type": {
        const temp = addedWidgets.get(op.id);
        const defaults = AI_WIDGET_DEFAULTS[op.type as AiWidgetType]?.config ?? {};
        if (temp) {
          let config = deriveInto(op.type, { ...defaults, ...temp.config }, baseline);
          addedWidgets.set(op.id, { ...temp, type: op.type, config });
        } else {
          const savedCfg = savedWidgets.get(op.id)?.config ?? {};
          const prev = widgetMeta[op.id]?.config ?? {};
          const patch = translateWidgetOverlay(op.type, contribution.widget[op.id] ?? {});
          delete patch.metricId;
          const merged: Cfg = { ...savedCfg, ...prev, ...patch };
          const missingDefaults: Cfg = {};
          for (const k of Object.keys(defaults)) if (!(k in merged)) missingDefaults[k] = defaults[k];
          const derived = deriveInto(op.type, { ...missingDefaults, ...merged }, baseline);
          const config: Cfg = { ...missingDefaults };
          for (const k of ["sql", "drillDownColumn", "drillDownColumnType"]) if (k in derived) config[k] = derived[k];
          widgetMeta[op.id] = { ...widgetMeta[op.id], type: op.type, config: { ...prev, ...config } };
          flagWidget(op.id);
        }
        break;
      }
      case "set_widget_title": {
        const temp = addedWidgets.get(op.id);
        if (temp) addedWidgets.set(op.id, { ...temp, title: op.title });
        else {
          widgetMeta[op.id] = { ...widgetMeta[op.id], title: op.title };
          flagWidget(op.id);
        }
        break;
      }
      default:
        break;
    }
  }

  if (applied === 0) return EMPTY_DERIVED;

  // 137 (136-12 UAT finding 3): saved, non-removed maps that show an AI-added/edited/removed layer.
  // Drives the pill only; deliberately NOT merged into aiEditedWidgetIds (each change counts once).
  const changedLayerIds = new Set<number>([...aiEditedLayerIds, ...removedLayerIds, ...addedLayers.keys()]);
  const allLayers = [...baseline.layers, ...addedLayers.values()];
  const aiLayerHostWidgetIds = new Set<number>();
  if (changedLayerIds.size > 0) {
    for (const wd of baseline.widgets) {
      if (wd.type !== "map" || removedWidgetIds.has(wd.id)) continue;
      const eff = contribution.widget[wd.id]?.includedLayerIds;
      const includedLayerIds = Array.isArray(eff) ? eff : wd.config.includedLayerIds;
      if (layersOfMap({ config: { includedLayerIds } }, allLayers).some((l) => changedLayerIds.has(l.id))) {
        aiLayerHostWidgetIds.add(wd.id);
      }
    }
  }
  return {
    addedWidgets: [...addedWidgets.values()],
    removedWidgetIds,
    addedLayers: [...addedLayers.values()],
    removedLayerIds,
    contribution,
    appliedOpCount: applied,
    layout,
    aiEditedWidgetIds,
    aiEditedLayerIds,
    aiLayerHostWidgetIds,
    widgetMeta,
    addedDynamicViews: [...addedDvs.values()],
    removedDynamicViewIds: removedDvIds,
    layerBinding,
  };
}
