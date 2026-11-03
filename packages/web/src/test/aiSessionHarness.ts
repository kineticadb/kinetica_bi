// Phase 134: spec-only helpers for the AI session store. Never imported by production code.
import type { WidgetDto, DashboardLayerDto } from "../api/client";
import type { SessionBaseline } from "../lib/aiSession/types";
import { useAiSessionStore } from "../store/aiSessionStore";

export function mapWidget(id: number, config: Record<string, unknown> = {}): WidgetDto {
  return { id, dashboard_id: 1, title: `map ${id}`, type: "map", position: 0, config, created_at: "", updated_at: "" };
}
export function recordsWidget(id: number, config: Record<string, unknown> = {}): WidgetDto {
  return { id, dashboard_id: 1, title: `records ${id}`, type: "records", position: 0, config, created_at: "", updated_at: "" };
}
export function savedLayer(id: number, overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto {
  return {
    id, dashboard_id: 1, table_id: 5, layer_type: "KineticaWms", position: 0, config: {},
    info_enabled: 0, info_columns: null, info_template: null, dynamic_view_id: null,
    cb_config: null, track_config: null, created_at: "", updated_at: "", ...overrides,
  };
}
export function baselineFixture(
  o: { widgets?: WidgetDto[]; layers?: DashboardLayerDto[]; dynamicViewIds?: number[]; dashboardId?: number } = {},
): SessionBaseline {
  return {
    dashboardId: o.dashboardId ?? 1,
    widgets: o.widgets ?? [mapWidget(42), mapWidget(43, { includedLayerIds: [7] }), recordsWidget(50)],
    layers: o.layers ?? [savedLayer(7, { config: { renderMode: "heatmap" } }), savedLayer(8)],
    dynamicViewIds: o.dynamicViewIds ?? [90],
    tables: [
      { id: 5, schema: "demo", name: "trips", columns: { vendor_id: "string", fare_amount: "double", payment_type: "string", lat: "double", lon: "double" } },
      { id: 1, schema: "demo", name: "pts", columns: { lat: "double", lon: "double" } },
    ],
    maxBarGroupBySeriesCap: 12,
  };
}
export const addWidgetOp = (tempId: number, type = "records", title = "AI widget", config: Record<string, unknown> = {}) => ({
  op: "add_widget", tempId, type, title, config,
});
export const addChartOp = (
  tempId: number,
  type: string,
  title: string,
  config: Record<string, unknown>,
  layout?: { x: number; y: number; w: number; h: number },
) => ({ op: "add_widget", tempId, type, title, config, ...(layout ? { layout } : {}) });
export const setLayoutOp = (items: { id: number; x: number; y: number; w: number; h: number }[]) => ({ op: "set_layout", items });
export const changeTypeOp = (id: number, type: string) => ({ op: "change_widget_type", id, type });
export const setTitleOp = (id: number, title: string) => ({ op: "set_widget_title", id, title });
export const removeWidgetOp = (id: number) => ({ op: "remove_widget", id });
export const patchWidgetOp = (id: number, configPatch: Record<string, unknown>) => ({
  op: "patch", action: { target: { kind: "widget", id }, configPatch },
});
export const patchLayerOp = (id: number, configPatch: Record<string, unknown>) => ({
  op: "patch", action: { target: { kind: "layer", id }, configPatch },
});
export const addLayerOp = (tempId: number, widgetId: number) => ({
  op: "add_layer", tempId, widgetId, tableId: 1, renderMode: "heatmap", spatialMode: "latlon", latColumn: "lat", lonColumn: "lon",
});
export const removeLayerOp = (id: number) => ({ op: "remove_layer", id });

export function runTurns(baseline: SessionBaseline, opLists: unknown[][]) {
  return opLists.map((ops, i) => useAiSessionStore.getState().applyTurn({ prompt: `turn ${i + 1}`, ops }, baseline));
}

export const applyFilterRaw = (
  source: { kind: "table" | "dynamicView"; id: number },
  column: string,
  value: unknown = "Cash",
  operator = "eq",
) => ({
  op: "apply_filter",
  source,
  filters: [{ column, operator, ...(operator === "isNull" ? {} : { value }) }],
});
export const clearFilterRaw = (source?: { kind: "table" | "dynamicView"; id: number }, column?: string) => ({
  op: "clear_filter",
  ...(source ? { source } : {}),
  ...(column ? { column } : {}),
});
