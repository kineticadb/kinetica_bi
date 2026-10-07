import { describe, it, expect } from "vitest";
import { buildExportRequest, type ExportRequestInput } from "./exportRequest";
import { aggregateSpatialTargetsByTable } from "./spatialTargets";
import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { WidgetDto } from "../api/client";

const f = (column: string, sourceWidgetId?: number): ActiveFilter => ({
  column, value: "x", dataType: "string", sourceWidgetId, addedAt: 1,
});
const shape = (id: string): Shape => ({ id, type: "bbox", wkt: `POLYGON((${id}))`, label: "Bbox 1", measurement: "1km", addedAt: 1 });
const mapWidget = (): WidgetDto => ({
  id: 50, dashboard_id: 1, title: "Map", type: "map", position: 0, created_at: "", updated_at: "",
  config: { spatialTargets: [{ tableId: 7, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }] },
});
const opts = { gzip: false, format: "raw" as const, name: " My export " };
const base = (over: Partial<ExportRequestInput> = {}): ExportRequestInput => ({
  widgetId: 9, config: { tableId: 7 }, sortField: "", sortDir: "asc", options: opts,
  filters: {}, dvFilters: {}, shapes: [], dashboardWidgets: [], dvScopeDisabled: false, ...over,
});

describe("buildExportRequest", () => {
  it("EXPREQ-table-all: sends all table filters when no scope", () => {
    const f1 = f("a"), f2 = f("b");
    expect(buildExportRequest(base({ filters: { 7: [f1, f2] } })).filters).toEqual([f1, f2]);
  });
  it("EXPREQ-scoped: allowlist scopes filters", () => {
    const f1 = f("a", 11), f2 = f("b", 12);
    const body = buildExportRequest(base({
      config: { tableId: 7, filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [11] } },
      filters: { 7: [f1, f2] },
    }));
    expect(body.filters).toEqual([f1]);
  });
  it("EXPREQ-spatial-both: shapes + eligible target sent together", () => {
    const widgets = [mapWidget()];
    const body = buildExportRequest(base({ shapes: [shape("s1")], dashboardWidgets: widgets }));
    expect(body.spatialFilters).toEqual([{ id: "s1", wkt: "POLYGON((s1))" }]);
    expect(body.spatialTarget).toEqual(aggregateSpatialTargetsByTable(widgets).get(7));
    expect(body.spatialTarget).toBeDefined();
  });
  it("EXPREQ-spatial-neither: one without the other sends neither", () => {
    const a = buildExportRequest(base({ shapes: [shape("s1")] }));
    expect("spatialFilters" in a).toBe(false);
    expect("spatialTarget" in a).toBe(false);
    const b = buildExportRequest(base({ dashboardWidgets: [mapWidget()] }));
    expect("spatialFilters" in b).toBe(false);
    expect("spatialTarget" in b).toBe(false);
  });
  it("EXPREQ-dv: dv wins over table, never spatial", () => {
    const dvF = f("dv"), tF = f("t");
    const body = buildExportRequest(base({
      config: { dynamicViewId: 3, tableId: 7 },
      dvFilters: { 3: [dvF] }, filters: { 7: [tF] },
      shapes: [shape("s1")], dashboardWidgets: [mapWidget()],
    }));
    expect(body.filters).toEqual([dvF]);
    expect("spatialFilters" in body).toBe(false);
    expect("spatialTarget" in body).toBe(false);
  });
  it("EXPREQ-dv-scope-disabled: dvScopeDisabled ignores filterSelection", () => {
    const a = f("a", 11), b = f("b", 12);
    const config = { dynamicViewId: 3, filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [11] } };
    expect(buildExportRequest(base({ config, dvFilters: { 3: [a, b] }, dvScopeDisabled: true })).filters).toEqual([a, b]);
    expect(buildExportRequest(base({ config, dvFilters: { 3: [a, b] }, dvScopeDisabled: false })).filters).toEqual([a]);
  });
  it("EXPREQ-sort: sort keys only when sortField set", () => {
    const s = buildExportRequest(base({ sortField: "fare", sortDir: "desc" }));
    expect(s.sortField).toBe("fare");
    expect(s.sortDir).toBe("desc");
    const n = buildExportRequest(base());
    expect("sortField" in n).toBe(false);
    expect("sortDir" in n).toBe(false);
  });
  it("EXPREQ-options: widgetId copied, name trimmed", () => {
    const b = buildExportRequest(base());
    expect(b.widgetId).toBe(9);
    expect(b.options).toEqual({ gzip: false, format: "raw", name: "My export" });
  });
});
