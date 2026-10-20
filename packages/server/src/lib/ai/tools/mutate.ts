// Phase 136 flat typed mutate tools: each emits a raw AiOp candidate; the gateway validates it.
// No tool accepts free-form config, SQL, hex colours or a layout for a new widget: vocabularies are enums.
import { z } from "zod/v4";
import { AI_WIDGET_TYPES, AI_PALETTE_NAMES, AI_HEATMAP_RAMPS, AI_CHART_SWAP_TYPES, CHART_AGGREGATIONS, AI_DV_AGG_FNS, AI_DV_BUCKETS } from "@kinetica-bi/shared";
import type { MutateTool } from "./types";

const PALETTE = AI_PALETTE_NAMES.join(", ");
const RAMPS = AI_HEATMAP_RAMPS.join(", ");

const s80 = z.string().max(80).optional();
const chartFields = {
  metric: z.string().max(128).optional(),
  aggregation: z.enum(CHART_AGGREGATIONS).optional(),
  groupBy: z.string().max(128).optional(),
  sortDir: z.enum(["ASC", "DESC"]).optional(),
  topN: z.enum(["5", "10", "25", "50", "100", "250", "500"]).optional(),
  colour: z.enum(AI_PALETTE_NAMES).optional(),
  showLegend: z.boolean().optional(),
  xAxisLabel: s80,
  yAxisLabel: s80,
  valueLabel: s80,
  label: s80,
  subLabel: s80,
};

type ChartArgs = {
  metric?: string; aggregation?: string; groupBy?: string; sortDir?: string; topN?: string; colour?: string;
  showLegend?: boolean; xAxisLabel?: string; yAxisLabel?: string; valueLabel?: string; label?: string; subLabel?: string;
};

function defined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

function chartFieldsToConfig(a: ChartArgs): Record<string, unknown> {
  return defined({
    metric: a.metric,
    aggregation: a.aggregation,
    groupByColumn: a.groupBy,
    sortDir: a.sortDir,
    limit: a.topN === undefined ? undefined : Number(a.topN),
    color: a.colour,
    showLegend: a.showLegend,
    xAxisLabel: a.xAxisLabel,
    yAxisLabel: a.yAxisLabel,
    yFieldLabel: a.valueLabel,
    label: a.label,
    subLabel: a.subLabel,
  });
}

const addWidgetArgs = z.object({
  tempId: z.number().int().negative(),
  type: z.enum(AI_WIDGET_TYPES),
  title: z.string().max(200),
  tableId: z.number().int().positive().optional(),
  dynamicViewId: z.number().int().optional(),
  ...chartFields,
  columns: z.array(z.string().max(128)).max(50).optional(),
  sortField: z.string().max(128).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  showPopup: z.boolean().optional(),
  showScaleBar: z.boolean().optional(),
  showFullscreen: z.boolean().optional(),
}).strict();

const editWidgetArgs = z.object({ id: z.number().int(), dynamicViewId: z.number().int().optional(), ...chartFields }).strict();
const renameArgs = z.object({ id: z.number().int(), title: z.string().min(1).max(200) }).strict();
const changeTypeArgs = z.object({ id: z.number().int(), type: z.enum(AI_CHART_SWAP_TYPES) }).strict();
const setLayoutArgs = z.object({
  items: z.array(z.object({
    id: z.number().int(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(6).max(36),
    h: z.number().int().min(6).max(200),
  }).strict()).min(1).max(30),
}).strict();
const addHeatmapArgs = z.object({
  tempId: z.number().int().negative(),
  tableId: z.number().int().positive().optional(),
  dynamicViewId: z.number().int().optional(),
  mapWidgetId: z.number().int().optional(),
  spatialMode: z.enum(["latlon", "wkt", "wkb"]),
  latColumn: z.string().max(128).optional(),
  lonColumn: z.string().max(128).optional(),
  wktColumn: z.string().max(128).optional(),
  wkbColumn: z.string().max(128).optional(),
  name: z.string().max(100).optional(),
  ramp: z.enum(AI_HEATMAP_RAMPS).optional(),
  reverseRamp: z.boolean().optional(),
  blurRadius: z.number().int().min(1).max(32).optional(),
  opacity: z.number().min(0).max(1).optional(),
  weightColumn: z.string().max(128).optional(),
}).strict();
const editHeatmapArgs = z.object({
  id: z.number().int(),
  dynamicViewId: z.number().int().optional(),
  name: z.string().max(100).optional(),
  ramp: z.enum(AI_HEATMAP_RAMPS).optional(),
  reverseRamp: z.boolean().optional(),
  blurRadius: z.number().int().min(1).max(32).optional(),
  opacity: z.number().min(0).max(1).optional(),
  weightColumn: z.string().max(128).optional(),
}).strict();
const layerVisArgs = z.object({ id: z.number().int(), visible: z.boolean() }).strict();
const patchArgs = z.object({
  targetKind: z.enum(["widget", "layer", "dynamicView"]),
  targetId: z.number().int(),
  changes: z.record(z.string(), z.unknown()),
}).strict();
const idArgs = z.object({ id: z.number().int() }).strict();

const addWidget: MutateTool = {
  kind: "mutate",
  name: "add_widget",
  description:
    `Add a widget. Use a new negative tempId (-1, -2, ...). Never SQL, never hex; colour is one of ${PALETTE}. ` +
    "Position is automatic. tableId must be a table on this dashboard (from list_tables); column names must come from describe_table. " +
    "Pass dynamicViewId (an AI or saved dynamic view) INSTEAD of tableId to chart a view; columns then come from that view. " +
    "To repair a rejected call reuse the same tempId.",
  args: addWidgetArgs,
  toOp(args) {
    const a = addWidgetArgs.parse(args);
    const config = defined({
      ...chartFieldsToConfig(a),
      tableId: a.tableId,
      dynamicViewId: a.dynamicViewId,
      columns: a.columns,
      sortField: a.sortField,
      sortDirection: a.sortDirection,
      show_popup: a.showPopup,
      show_scale_bar: a.showScaleBar,
      show_fullscreen: a.showFullscreen,
    });
    return { op: "add_widget", tempId: a.tempId, type: a.type, title: a.title, config };
  },
};
const editWidget: MutateTool = {
  kind: "mutate",
  name: "edit_widget",
  description: `Change settings of an existing widget (id from get_dashboard). Provide only what changes. Colour is one of ${PALETTE}; never SQL or hex. To point it at another dynamic view send dynamicViewId on its own; its columns must exist on that view.`,
  args: editWidgetArgs,
  toOp(args) {
    const { id, dynamicViewId, ...rest } = editWidgetArgs.parse(args);
    return { op: "patch", action: { target: { kind: "widget", id }, configPatch: defined({ ...chartFieldsToConfig(rest), dynamicViewId }) } };
  },
};
const renameWidget: MutateTool = {
  kind: "mutate",
  name: "rename_widget",
  description: "Rename a widget (id from get_dashboard).",
  args: renameArgs,
  toOp(args) {
    const a = renameArgs.parse(args);
    return { op: "set_widget_title", id: a.id, title: a.title };
  },
};
const changeWidgetType: MutateTool = {
  kind: "mutate",
  name: "change_widget_type",
  description: "Switch a chart between types: bar, line and pie only; for other changes remove and add.",
  args: changeTypeArgs,
  toOp(args) {
    const a = changeTypeArgs.parse(args);
    return { op: "change_widget_type", id: a.id, type: a.type };
  },
};
const setLayout: MutateTool = {
  kind: "mutate",
  name: "set_layout",
  description: "Move or resize widgets. 36 columns; give the full new position of every widget you move or resize; widgets must not overlap.",
  args: setLayoutArgs,
  toOp(args) {
    return { op: "set_layout", items: setLayoutArgs.parse(args).items };
  },
};
const addHeatmapLayer: MutateTool = {
  kind: "mutate",
  name: "add_heatmap_layer",
  description:
    `Add a heatmap layer to a map. Use a new negative tempId. Ramp is one of ${RAMPS}. ` +
    "Omit mapWidgetId to use the map that already shows this table. tableId must be a table on this dashboard; or pass dynamicViewId instead of tableId to draw a view that has the spatial columns.",
  args: addHeatmapArgs,
  toOp(args) {
    const a = addHeatmapArgs.parse(args);
    const style = defined({ colormap: a.ramp, reverseColormap: a.reverseRamp, blurRadius: a.blurRadius, opacity: a.opacity, valueColumn: a.weightColumn });
    return defined({
      op: "add_layer",
      tempId: a.tempId,
      widgetId: a.mapWidgetId,
      tableId: a.tableId,
      dynamicViewId: a.dynamicViewId,
      renderMode: "heatmap",
      spatialMode: a.spatialMode,
      latColumn: a.latColumn,
      lonColumn: a.lonColumn,
      wktColumn: a.wktColumn,
      wkbColumn: a.wkbColumn,
      name: a.name,
      style: Object.keys(style).length ? style : undefined,
    });
  },
};
const editHeatmapLayer: MutateTool = {
  kind: "mutate",
  name: "edit_heatmap_layer",
  description: `Restyle a heatmap layer (id from get_dashboard). Ramp is one of ${RAMPS}. To point it at another dynamic view send dynamicViewId on its own.`,
  args: editHeatmapArgs,
  toOp(args) {
    const a = editHeatmapArgs.parse(args);
    const configPatch = defined({ dynamicViewId: a.dynamicViewId, colormap: a.ramp, reverseColormap: a.reverseRamp, blurRadius: a.blurRadius, opacity: a.opacity, valueColumn: a.weightColumn, name: a.name });
    return { op: "patch", action: { target: { kind: "layer", id: a.id }, configPatch } };
  },
};
const setLayerVisibility: MutateTool = {
  kind: "mutate",
  name: "set_layer_visibility",
  description: "Show or hide a layer (id from get_dashboard).",
  args: layerVisArgs,
  toOp(args) {
    const a = layerVisArgs.parse(args);
    return { op: "patch", action: { target: { kind: "layer", id: a.id }, configPatch: { visible: a.visible } } };
  },
};
const patch: MutateTool = {
  kind: "mutate",
  name: "patch",
  description: "Change a dynamic view's settings; use edit_widget / edit_heatmap_layer for widgets and layers.",
  args: patchArgs,
  toOp(args) {
    const a = patchArgs.parse(args);
    return { op: "patch", action: { target: { kind: a.targetKind, id: a.targetId }, configPatch: a.changes } };
  },
};
const applyFilterArgs = z.object({
  tableId: z.number().int().positive().optional(),
  dynamicViewId: z.number().int().refine((n) => n !== 0, "dynamicViewId must be non-zero (negative = AI view this session)").optional(),
  column: z.string().max(128),
  operator: z.enum(["eq", "in", "between", "isNull"]).optional(),
  value: z.string().max(200).optional(),
  values: z.array(z.string().max(200)).max(100).optional(),
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),
});
const clearFilterArgs = z.object({
  tableId: z.number().int().positive().optional(),
  dynamicViewId: z.number().int().refine((n) => n !== 0, "dynamicViewId must be non-zero (negative = AI view this session)").optional(),
  column: z.string().max(128).optional(),
});
const applyFilter: MutateTool = {
  kind: "mutate",
  name: "apply_filter",
  description:
    "Filter the dashboard like a click: every chart, records table and map layer on that table (or dynamic view, saved or AI-created) narrows. Omit tableId and dynamicViewId unless the user named a table or chart. Filtering an already-filtered column replaces its filter. operator: eq (value), in (values), between (from, to), isNull (no value).",
  args: applyFilterArgs,
  toOp(args) {
    const a = applyFilterArgs.parse(args);
    const operator = a.operator ?? "eq";
    const value =
      operator === "in" ? a.values
      : operator === "between" ? (a.from !== undefined && a.to !== undefined ? [a.from, a.to] : undefined)
      : operator === "isNull" ? null
      : a.value;
    const item = defined({ column: a.column, operator, value });
    const out: Record<string, unknown> = { op: "apply_filter", filters: [item] };
    if (a.tableId !== undefined) out.source = { kind: "table", id: a.tableId };
    else if (a.dynamicViewId !== undefined) out.source = { kind: "dynamicView", id: a.dynamicViewId };
    // both ids: the stray key makes the strict op schema reject the call (the model must pick one)
    if (a.tableId !== undefined && a.dynamicViewId !== undefined) out.dynamicViewId = a.dynamicViewId;
    return out;
  },
};
const clearFilter: MutateTool = {
  kind: "mutate",
  name: "clear_filter",
  description: "Clear filters. No arguments clears every filter on the dashboard, the user's included. tableId or dynamicViewId clears that source; add column to clear one column.",
  args: clearFilterArgs,
  toOp(args) {
    const a = clearFilterArgs.parse(args);
    const out: Record<string, unknown> = { op: "clear_filter" };
    if (a.tableId !== undefined) out.source = { kind: "table", id: a.tableId };
    else if (a.dynamicViewId !== undefined) out.source = { kind: "dynamicView", id: a.dynamicViewId };
    if (a.column !== undefined) out.column = a.column;
    if (a.tableId !== undefined && a.dynamicViewId !== undefined) out.dynamicViewId = a.dynamicViewId;
    return out;
  },
};
const tbl = z.number().int().min(0).max(4).optional(); // 0 = base table, 1.. = joins in order
const addDynamicViewArgs = z.object({
  tempId: z.number().int().negative(),
  name: z.string().min(1).max(80),
  baseTableId: z.number().int().positive(),
  joins: z.array(z.object({
    tableId: z.number().int().positive(),
    type: z.enum(["inner", "left"]),
    on: z.array(z.object({ leftTable: tbl, left: z.string().max(128), right: z.string().max(128) }).strict()).min(1).max(4),
  }).strict()).max(4).optional(),
  columns: z.array(z.object({ table: tbl, column: z.string().max(128), as: z.string().max(128).optional() }).strict()).max(50).optional(),
  filters: z.array(z.object({
    table: tbl,
    column: z.string().max(128),
    operator: z.enum(["eq", "in", "between", "isNull"]).optional(),
    value: z.string().max(200).optional(),
    values: z.array(z.string().max(200)).max(100).optional(),
    low: z.string().max(200).optional(),
    high: z.string().max(200).optional(),
  }).strict()).max(10).optional(),
  groupBy: z.array(z.object({ table: tbl, column: z.string().max(128), bucket: z.enum(AI_DV_BUCKETS).optional(), as: z.string().max(128).optional() }).strict()).max(10).optional(),
  aggregates: z.array(z.object({ fn: z.enum(AI_DV_AGG_FNS), table: tbl, column: z.string().max(128).optional(), p: z.number().optional(), as: z.string().max(128) }).strict()).max(20).optional(),
  sort: z.array(z.object({ by: z.string().max(128), dir: z.enum(["asc", "desc"]) }).strict()).max(5).optional(),
  limit: z.number().int().positive().optional(),
}).strict();
const addDynamicView: MutateTool = {
  kind: "mutate",
  name: "add_dynamic_view",
  description:
    "Create a session-only dynamic view from a structured description (never SQL): a base table on this dashboard, optional inner/left joins on equal columns (at most the server limit), " +
    "then EITHER columns (a row view) OR groupBy + aggregates (a summary), plus optional filters, sort and limit. Buckets: minute..year on date/time columns. " +
    "median and percentile are approximate (about 2%). Use a new negative tempId, then bind widgets/layers with dynamicViewId = that tempId.",
  args: addDynamicViewArgs,
  toOp(args) {
    const a = addDynamicViewArgs.parse(args);
    const spec = defined({
      baseTableId: a.baseTableId,
      joins: a.joins?.map((j) => ({ tableId: j.tableId, type: j.type, on: j.on.map((k) => defined({ leftFrom: k.leftTable, left: k.left, right: k.right })) })),
      columns: a.columns?.map((c) => defined({ from: c.table, column: c.column, as: c.as })),
      filters: a.filters?.map((f) => {
        const operator = f.operator ?? "eq";
        const value =
          operator === "in" ? f.values
          : operator === "between" ? (f.low !== undefined && f.high !== undefined ? [f.low, f.high] : undefined)
          : operator === "isNull" ? null
          : f.value;
        return defined({ from: f.table, column: f.column, operator, value });
      }),
      groupBy: a.groupBy?.map((g) => defined({ from: g.table, column: g.column, bucket: g.bucket, as: g.as })),
      aggregates: a.aggregates?.map((g) => defined({ fn: g.fn, from: g.table, column: g.column, p: g.p, as: g.as })),
      sort: a.sort,
      limit: a.limit,
    });
    return { op: "add_dynamic_view", tempId: a.tempId, name: a.name, spec };
  },
};
const remover = (op: "remove_widget" | "remove_layer" | "remove_dynamic_view", what: string, extra = ""): MutateTool => ({
  kind: "mutate",
  name: op,
  description: `Remove a ${what} by id (from get_dashboard).${extra}`,
  args: idArgs,
  toOp(args) {
    return { op, id: idArgs.parse(args).id };
  },
});

export const MUTATE_TOOLS: readonly MutateTool[] = [
  addWidget,
  editWidget,
  renameWidget,
  changeWidgetType,
  setLayout,
  addHeatmapLayer,
  editHeatmapLayer,
  setLayerVisibility,
  patch,
  applyFilter,
  clearFilter,
  addDynamicView,
  remover("remove_widget", "widget", " Removing a saved widget may need the user's confirmation."),
  remover("remove_layer", "layer"),
  remover("remove_dynamic_view", "dynamic view", " Widgets and layers using it are pointed at its table when their columns fit, otherwise removed. Removing a saved dynamic view may need the user's confirmation."),
];
