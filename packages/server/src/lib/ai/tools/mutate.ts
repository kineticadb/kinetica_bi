// Phase 136 flat typed mutate tools: each emits a raw AiOp candidate; the gateway validates it.
// No tool accepts free-form config, SQL, hex colours or a layout for a new widget: vocabularies are enums.
import { z } from "zod/v4";
import { AI_WIDGET_TYPES, AI_PALETTE_NAMES, AI_HEATMAP_RAMPS, AI_CHART_SWAP_TYPES, CHART_AGGREGATIONS } from "@kinetica-bi/shared";
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
  ...chartFields,
  columns: z.array(z.string().max(128)).max(50).optional(),
  sortField: z.string().max(128).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  showPopup: z.boolean().optional(),
  showScaleBar: z.boolean().optional(),
  showFullscreen: z.boolean().optional(),
}).strict();

const editWidgetArgs = z.object({ id: z.number().int(), ...chartFields }).strict();
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
  tableId: z.number().int().positive(),
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
    "To repair a rejected call reuse the same tempId.",
  args: addWidgetArgs,
  toOp(args) {
    const a = addWidgetArgs.parse(args);
    const config = defined({
      ...chartFieldsToConfig(a),
      tableId: a.tableId,
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
  description: `Change settings of an existing widget (id from get_dashboard). Provide only what changes. Colour is one of ${PALETTE}; never SQL or hex.`,
  args: editWidgetArgs,
  toOp(args) {
    const { id, ...rest } = editWidgetArgs.parse(args);
    return { op: "patch", action: { target: { kind: "widget", id }, configPatch: chartFieldsToConfig(rest) } };
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
    "Omit mapWidgetId to use the map that already shows this table. tableId must be a table on this dashboard.",
  args: addHeatmapArgs,
  toOp(args) {
    const a = addHeatmapArgs.parse(args);
    const style = defined({ colormap: a.ramp, reverseColormap: a.reverseRamp, blurRadius: a.blurRadius, opacity: a.opacity, valueColumn: a.weightColumn });
    return defined({
      op: "add_layer",
      tempId: a.tempId,
      widgetId: a.mapWidgetId,
      tableId: a.tableId,
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
  description: `Restyle a heatmap layer (id from get_dashboard). Ramp is one of ${RAMPS}.`,
  args: editHeatmapArgs,
  toOp(args) {
    const a = editHeatmapArgs.parse(args);
    const configPatch = defined({ colormap: a.ramp, reverseColormap: a.reverseRamp, blurRadius: a.blurRadius, opacity: a.opacity, valueColumn: a.weightColumn, name: a.name });
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
  remover("remove_widget", "widget", " Removing a saved widget may need the user's confirmation."),
  remover("remove_layer", "layer"),
  remover("remove_dynamic_view", "dynamic view"),
];
