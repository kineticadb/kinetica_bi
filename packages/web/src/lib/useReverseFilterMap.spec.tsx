/**
 * Phase 108 Plan 01 (FSCOPE-V120-01, display portion): useReverseFilterMap + enumeration specs.
 *
 * The pure core (computeReverseFilterMap) is already covered by computeReverseFilterMap.spec.ts
 * — this file tests only ENUMERATION + live store reads + reference-identity joins, per
 * 108-RESEARCH.md's Q7 test strategy.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReverseFilterMap, enumerateVizDescriptors } from "./useReverseFilterMap";
import { useFilterStore, type ActiveFilter } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useAuthStore } from "../store/auth";
import type { WidgetDto, DashboardLayerDto, TableDto } from "../api/client";

const makeWidget = (id: number, overrides: Partial<WidgetDto> = {}): WidgetDto => ({
  id,
  dashboard_id: 1,
  title: `Widget ${id}`,
  type: "bar",
  position: id,
  config: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeLayer = (id: number, overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto => ({
  id,
  dashboard_id: 1,
  table_id: 5,
  layer_type: "vector",
  position: id,
  config: {},
  info_enabled: 0,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
} as DashboardLayerDto);

const table: TableDto = {
  id: 5,
  name: "trips",
  schema: "demo",
  columns: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  act(() => {
    useFilterStore.getState().reset();
    useSpatialFilterStore.getState().reset();
    useAuthStore.setState({ dvFilterScopeDisabled: false });
  });
});

describe("enumerateVizDescriptors", () => {
  it("emits one vizKind:'widget' descriptor per trigger-type widget, keyed by tableId", () => {
    const widgets = [
      makeWidget(1, { type: "bar", config: { tableId: 5 } }),
      makeWidget(2, { type: "table", config: { tableId: 5 } }), // trigger type — must be included
    ];
    const vizs = enumerateVizDescriptors({
      widgets,
      layers: [],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    expect(vizs).toHaveLength(2);
    expect(vizs.every((v) => v.vizKind === "widget")).toBe(true);
    expect(vizs.map((v) => v.widgetId).sort()).toEqual([1, 2]);
  });

  it("excludes NON_TRIGGER_TYPES widgets (e.g. map, info-card, legend, calendar) from vizKind:'widget'", () => {
    const widgets = [
      makeWidget(1, { type: "map", config: { includedLayerIds: [] } }),
      makeWidget(2, { type: "info-card" }),
      makeWidget(3, { type: "legend" }),
      makeWidget(4, { type: "calendar" }),
    ];
    const vizs = enumerateVizDescriptors({
      widgets,
      layers: [],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    // No layers exist, so the map widget also contributes no "layer" descriptors.
    expect(vizs).toHaveLength(0);
  });

  it("a map layer maps to the OWNING map widget id (not the layer id) + derives a layer name", () => {
    const mapWidget = makeWidget(10, { type: "map", title: "Coverage Map", config: {} });
    const layer = makeLayer(20, { table_id: 5, config: { renderMode: "raster" } });
    const vizs = enumerateVizDescriptors({
      widgets: [mapWidget],
      layers: [layer],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    expect(vizs).toHaveLength(1);
    const [v] = vizs;
    expect(v.vizKind).toBe("layer");
    expect(v.widgetId).toBe(10); // owning map widget, NOT layer id 20
    expect(v.layerId).toBe(20);
    expect(v.layerName).toBe("demo.trips — raster");
    expect(v.widgetTitle).toBe("Coverage Map");
  });

  it("honors config.name override for layer display name", () => {
    const mapWidget = makeWidget(10, { type: "map", config: {} });
    const layer = makeLayer(20, { table_id: 5, config: { name: "Roads" } });
    const vizs = enumerateVizDescriptors({
      widgets: [mapWidget],
      layers: [layer],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    expect(vizs[0].layerName).toBe("Roads");
  });

  it("excludes layers not visible (config.visible === false) and layers not in includedLayerIds", () => {
    const mapWidget = makeWidget(10, { type: "map", config: { includedLayerIds: [21] } });
    const includedLayer = makeLayer(21, { table_id: 5 });
    const excludedLayer = makeLayer(22, { table_id: 5 });
    const hiddenLayer = makeLayer(23, { table_id: 5, config: { visible: false } });
    const vizs = enumerateVizDescriptors({
      widgets: [mapWidget],
      layers: [includedLayer, excludedLayer, hiddenLayer],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    expect(vizs).toHaveLength(1);
    expect(vizs[0].layerId).toBe(21);
  });

  it("reads layer.filter_scope TOP-LEVEL (not layer.config.filter_scope)", () => {
    const mapWidget = makeWidget(10, { type: "map", config: {} });
    const scope = { sourceMode: "allowlist" as const, allowedSourceWidgetIds: [1] };
    const layer = makeLayer(20, {
      table_id: 5,
      filter_scope: scope,
      config: { filter_scope: { sourceMode: "all", allowedSourceWidgetIds: [] } } as unknown as Record<string, unknown>,
    });
    const vizs = enumerateVizDescriptors({
      widgets: [mapWidget],
      layers: [layer],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    expect(vizs[0].cfg).toBe(scope); // top-level scope, not the decoy on config
  });

  it("one layer under multiple owning map widgets emits one descriptor per pair", () => {
    const mapA = makeWidget(10, { type: "map", config: {} });
    const mapB = makeWidget(11, { type: "map", config: {} });
    const layer = makeLayer(20, { table_id: 5 });
    const vizs = enumerateVizDescriptors({
      widgets: [mapA, mapB],
      layers: [layer],
      associatedTables: [table],
      targetsByTable: new Map(),
    });
    expect(vizs).toHaveLength(2);
    expect(vizs.map((v) => v.widgetId).sort()).toEqual([10, 11]);
  });

  it("dv-bound layer: tableId undefined, dynamicViewId set, spatialCapable forced false regardless of targetsByTable", () => {
    const mapWidget = makeWidget(10, { type: "map", config: {} });
    const layer = makeLayer(20, { table_id: 5, dynamic_view_id: 77 });
    const targetsByTable = new Map<number, unknown>([[5, {}]]);
    const vizs = enumerateVizDescriptors({
      widgets: [mapWidget],
      layers: [layer],
      associatedTables: [table],
      targetsByTable,
    });
    expect(vizs[0].tableId).toBeUndefined();
    expect(vizs[0].dynamicViewId).toBe(77);
    expect(vizs[0].spatialCapable).toBe(false);
  });
});

describe("useReverseFilterMap — hook wiring", () => {
  it("maps a known table filter to the expected chart-widget ids", () => {
    const filter: ActiveFilter = { column: "zone", value: "East", dataType: "string", addedAt: 1 };
    act(() => {
      useFilterStore.setState((s) => ({ ...s, filters: { 5: [filter] }, filterVersion: s.filterVersion + 1 }));
    });

    const widgets = [makeWidget(1, { type: "bar", config: { tableId: 5 } })];
    const { result } = renderHook(() =>
      useReverseFilterMap({
        widgets,
        layers: [],
        dynamicViews: [],
        associatedTables: [table],
        targetsByTable: new Map(),
      })
    );

    expect(result.current.filterEntries).toHaveLength(1);
    const entry = result.current.filterEntries[0];
    expect(entry.widgets.map((w) => w.widgetId)).toEqual([1]);
  });

  it("a map layer whose table has the active filter → entry.widgets includes the OWNING map widget id + layerNames", () => {
    const filter: ActiveFilter = { column: "zone", value: "East", dataType: "string", addedAt: 1 };
    act(() => {
      useFilterStore.setState((s) => ({ ...s, filters: { 5: [filter] }, filterVersion: s.filterVersion + 1 }));
    });

    const mapWidget = makeWidget(10, { type: "map", title: "Coverage Map", config: {} });
    const layer = makeLayer(20, { table_id: 5, config: { renderMode: "raster" } });
    const { result } = renderHook(() =>
      useReverseFilterMap({
        widgets: [mapWidget],
        layers: [layer],
        dynamicViews: [],
        associatedTables: [table],
        targetsByTable: new Map(),
      })
    );

    const entry = result.current.filterEntries.find((e) => e.filter === filter);
    expect(entry).toBeDefined();
    expect(entry!.widgets).toHaveLength(1);
    expect(entry!.widgets[0].widgetId).toBe(10);
    expect(entry!.widgets[0].layerNames).toEqual(["demo.trips — raster"]);
  });

  it("dv-bound viz + dvFilterScopeDisabled=true → dv entries revert to accept-all", () => {
    const dvFilter: ActiveFilter = { column: "status", value: "active", dataType: "string", addedAt: 1 };
    act(() => {
      useFilterStore.setState((s) => ({ ...s, dvFilters: { 77: [dvFilter] }, filterVersion: s.filterVersion + 1 }));
      useAuthStore.setState({ dvFilterScopeDisabled: true });
    });

    // Excluding cfg would normally drop this filter — dvFilterScopeDisabled forces accept-all.
    const widgets = [
      makeWidget(1, {
        type: "bar",
        config: {
          dynamicViewId: 77,
          filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [] },
        },
      }),
    ];
    const { result } = renderHook(() =>
      useReverseFilterMap({
        widgets,
        layers: [],
        dynamicViews: [],
        associatedTables: [table],
        targetsByTable: new Map(),
      })
    );

    const entry = result.current.filterEntries.find((e) => e.filter === dvFilter);
    expect(entry).toBeDefined();
    expect(entry!.widgets.map((w) => w.widgetId)).toEqual([1]);

    act(() => {
      useAuthStore.setState({ dvFilterScopeDisabled: false });
    });
  });

  it("entry.filter is the SAME object reference as the seeded ActiveFilter (join-by-identity contract)", () => {
    const filter: ActiveFilter = { column: "zone", value: "West", dataType: "string", addedAt: 1 };
    act(() => {
      useFilterStore.setState((s) => ({ ...s, filters: { 5: [filter] }, filterVersion: s.filterVersion + 1 }));
    });

    const widgets = [makeWidget(1, { type: "bar", config: { tableId: 5 } })];
    const { result } = renderHook(() =>
      useReverseFilterMap({
        widgets,
        layers: [],
        dynamicViews: [],
        associatedTables: [table],
        targetsByTable: new Map(),
      })
    );

    const found = result.current.filterEntries.find((e) => e.filter === filter);
    expect(found).toBeDefined();
  });

  it("a non-trigger widget type (info-card) is NOT enumerated as a vizKind:'widget' entry", () => {
    const filter: ActiveFilter = { column: "zone", value: "East", dataType: "string", addedAt: 1 };
    act(() => {
      useFilterStore.setState((s) => ({ ...s, filters: { 5: [filter] }, filterVersion: s.filterVersion + 1 }));
    });

    const widgets = [makeWidget(1, { type: "info-card", config: { tableId: 5 } })];
    const { result } = renderHook(() =>
      useReverseFilterMap({
        widgets,
        layers: [],
        dynamicViews: [],
        associatedTables: [table],
        targetsByTable: new Map(),
      })
    );

    const entry = result.current.filterEntries.find((e) => e.filter === filter);
    expect(entry).toBeDefined();
    expect(entry!.widgets).toHaveLength(0);
  });
});
