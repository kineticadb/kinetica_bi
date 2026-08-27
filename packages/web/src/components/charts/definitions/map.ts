import { registerChartType, type ChartTypeDefinition } from "../registry";
import MapConfigPanel from "../MapConfigPanel";
import { DEFAULT_BASEMAP_LIGHT, DEFAULT_BASEMAP_DARK } from "../../../lib/basemaps";

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
    // Per-theme basemaps: the renderer auto-selects by the active app theme.
    // Both defaults are OSM (free, no API key) — the two entries differ only in
    // their default CSS: plain in light mode, dark-filtered in dark mode.
    // CARTO basemaps remain selectable but need VITE_CARTO_API_KEY (see lib/basemaps.ts).
    basemapLight: DEFAULT_BASEMAP_LIGHT,
    basemapDark: DEFAULT_BASEMAP_DARK,
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
