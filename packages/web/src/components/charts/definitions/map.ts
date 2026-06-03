import { registerChartType, type ChartTypeDefinition } from "../registry";
import MapConfigPanel from "../MapConfigPanel";

// Phase 12: Map chart type — Phase 12 hard cutover.
// CONTEXT.md "Decisions § Lift boundary":
//   STAYS ON WIDGET: title, basemap, includedLayerIds
//   MOVED TO LAYER:  all spatial/render config (now in dashboard_layers.config)
//
// - usesAggregation: false — WMS is the data path, NOT aggregated SQL.
// - supportsDrillDown intentionally unset — Phase 12 lock; map drill-down is v1.3 (IDENT-V13-*).
// - defaultConfig: title + basemap only; includedLayerIds absent (undefined = all-on lazy/inclusive).

const map: ChartTypeDefinition = {
  type: "map",
  label: "Map",
  icon: "M",
  fields: [], // Empty — CustomConfigPanel (MapConfigPanel) owns the entire config schema.
  defaultConfig: {
    title: "Map",
    // Per-theme basemaps: the renderer auto-selects by the active app theme. A light
    // basemap (Voyager) in light mode, dark (Dark Matter) in dark mode.
    basemapLight: "voyager",
    basemapDark: "dark",
    // includedLayerIds intentionally absent — undefined = lazy/inclusive (all dashboard layers ON).
  },
  usesAggregation: false,
  // Map manages its own data via per-layer dashboard_layers rows (Phase 12).
  // No single-table "Data Source" dropdown belongs in the map config panel.
  usesDataSource: false,
  CustomConfigPanel: MapConfigPanel,
  // supportsDrillDown intentionally unset — Phase 12 lock; drill-down deferred to v1.3.
};

export default function register() {
  registerChartType(map);
}
