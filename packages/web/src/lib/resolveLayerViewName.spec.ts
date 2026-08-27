/**
 * lib/resolveLayerViewName — the FROM target shared by a map layer's WMS tile
 * path and its info-click path.
 *
 * The regression this guards: the info paths used to read the pre-v1.18
 * `filterViewStore.views[tableId]`, which Phase 91 stopped populating, so a
 * table-bound info click always resolved to `viewName: undefined` and the server
 * queried the BASE TABLE while the tiles showed filtered rows. These tests pin
 * that an active combination view is returned instead.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resolveLayerViewName } from "./resolveLayerViewName";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import type { CombinationEntry } from "../store/filterCombinationStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { NOFILTER_SENTINEL } from "./stableComboHash";
import type { DashboardLayerDto } from "../api/client";

const makeLayer = (over: Partial<DashboardLayerDto> = {}): DashboardLayerDto =>
  ({
    id: 7,
    dashboard_id: 1,
    table_id: 42,
    dynamic_view_id: null,
    position: 0,
    config: {},
    ...over,
  }) as DashboardLayerDto;

const entry = (over: Partial<CombinationEntry> = {}): CombinationEntry => ({
  viewName: "_kbi_comb_abc",
  expiresAt: Date.now() + 600_000,
  materializing: false,
  materializeVersion: 3,
  refCount: 1,
  dashboardId: 1,
  sourceType: "table",
  sourceId: 42,
  ...over,
});

const bindLayerToCombination = (layerId: number, hash: string, e: CombinationEntry) => {
  useFilterCombinationStore.getState().setEntry(hash, e);
  useFilterCombinationStore.getState().setVizHash(`l:${layerId}`, hash);
};

beforeEach(() => {
  useFilterCombinationStore.getState().reset();
  useDynamicViewStore.setState({ views: {} });
});

describe("table-bound layers", () => {
  it("returns the active combination view — NOT the base table (the info-click regression)", () => {
    bindLayerToCombination(7, "table:42:h1", entry());
    expect(resolveLayerViewName(makeLayer())).toEqual({
      kind: "view",
      viewName: "_kbi_comb_abc",
      materializeVersion: 3,
    });
  });

  it("falls through to the source table when the layer has no combination bound", () => {
    expect(resolveLayerViewName(makeLayer())).toEqual({
      kind: "view",
      viewName: undefined,
      materializeVersion: undefined,
    });
  });

  it("treats a NOFILTER hash as no view (never in the registry)", () => {
    useFilterCombinationStore.getState().setVizHash(`l:7`, `table:42:${NOFILTER_SENTINEL}`);
    expect(resolveLayerViewName(makeLayer()).kind).toBe("view");
    expect((resolveLayerViewName(makeLayer()) as { viewName?: string }).viewName).toBeUndefined();
  });

  it("falls through to the source table when the combination view has expired", () => {
    bindLayerToCombination(7, "table:42:h1", entry({ expiresAt: Date.now() - 1 }));
    expect((resolveLayerViewName(makeLayer()) as { viewName?: string }).viewName).toBeUndefined();
  });

  it("keeps a preserved viewName during a refresh so records match the visible tiles", () => {
    // markMaterializing preserves a prior viewName; the WMS path keeps rendering it,
    // so the info click must agree rather than dropping to the base table.
    bindLayerToCombination(7, "table:42:h1", entry({ materializing: true }));
    expect((resolveLayerViewName(makeLayer()) as { viewName?: string }).viewName).toBe(
      "_kbi_comb_abc",
    );
  });

  it("falls through while materializing with no prior view yet", () => {
    bindLayerToCombination(7, "table:42:h1", entry({ viewName: "", expiresAt: 0, materializing: true }));
    expect((resolveLayerViewName(makeLayer()) as { viewName?: string }).viewName).toBeUndefined();
  });

  it("reads the combination bound to THIS layer, not another one", () => {
    bindLayerToCombination(9, "table:42:other", entry({ viewName: "_kbi_comb_other" }));
    expect((resolveLayerViewName(makeLayer({ id: 7 })) as { viewName?: string }).viewName).toBeUndefined();
  });
});

describe("dv-bound layers", () => {
  const dvLayer = makeLayer({ dynamic_view_id: 5 });

  it("prefers the dv COMBINATION view over the raw dv view", () => {
    useDynamicViewStore.setState({
      views: { 5: { viewName: "_kbi_dv_raw", status: "materialized" } },
    } as never);
    bindLayerToCombination(7, "dv:5:h9", entry({ sourceType: "dv", sourceId: 5, viewName: "_kbi_dv_comb" }));
    expect((resolveLayerViewName(dvLayer) as { viewName?: string }).viewName).toBe("_kbi_dv_comb");
  });

  it("falls back to the raw dv view when no dv combination is active", () => {
    useDynamicViewStore.setState({
      views: { 5: { viewName: "_kbi_dv_raw", status: "materialized" } },
    } as never);
    expect((resolveLayerViewName(dvLayer) as { viewName?: string }).viewName).toBe("_kbi_dv_raw");
  });

  it("ignores a dv combination entry that is still materializing", () => {
    useDynamicViewStore.setState({
      views: { 5: { viewName: "_kbi_dv_raw", status: "materialized" } },
    } as never);
    bindLayerToCombination(7, "dv:5:h9", entry({ viewName: "", materializing: true }));
    expect((resolveLayerViewName(dvLayer) as { viewName?: string }).viewName).toBe("_kbi_dv_raw");
  });

  it("signals skip when the dv is not materialized — never queries the source table", () => {
    useDynamicViewStore.setState({
      views: { 5: { viewName: "_kbi_dv_raw", status: "pending" } },
    } as never);
    expect(resolveLayerViewName(dvLayer)).toEqual({ kind: "skip-dv-not-materialized" });
  });

  it("signals skip when the dv has no entry at all", () => {
    expect(resolveLayerViewName(dvLayer)).toEqual({ kind: "skip-dv-not-materialized" });
  });
});
