/**
 * Phase 141-03: the shared ref traversal can see negative temp ids (allowNegative) so Keep can
 * collect and remap them. Default behaviour (no opts) is covered by the existing ref specs.
 */
import { describe, expect, it } from "vitest";
import {
  collectSignedWidgetConfigRefs,
  collectWidgetConfigRefs,
  emptyRefIdMaps,
  remapTempFilterSelection,
  remapTempRefs,
  UnmappedTempRefError,
} from "../src/lib/dashboardExportRefs.js";

const SENTINEL = "__spatial_draws__";

const makeConfig = () => ({
  tableId: 5,
  dynamicViewId: -3,
  sourceMapWidgetId: -1,
  metricId: 9,
  includedLayerIds: [-2, 7],
  filterSelection: { sourceMode: "allow", allowedSourceWidgetIds: [-1, SENTINEL, 12] },
  options: [{ actions: [{ target: { kind: "widget", id: -4 } }] }],
  spatialTargets: [{ tableId: 5 }],
});

const makeMaps = () => {
  const maps = emptyRefIdMaps();
  maps.dynamicView.set(-3, 31);
  maps.widget.set(-1, 41);
  maps.widget.set(-4, 44);
  maps.layer.set(-2, 52);
  return maps;
};

describe("negative temp-id ref traversal (141-03)", () => {
  it("NEGREF-1: default collect still reports only positive ids", () => {
    const refs = collectWidgetConfigRefs(makeConfig());
    expect(refs.tableIds).toEqual([5]);
    expect(refs.customMetricIds).toEqual([9]);
    expect(refs.layerIds).toEqual([7]);
    expect(refs.widgetIds).toEqual([12]);
    expect(refs.dynamicViewIds).toEqual([]);
  });

  it("NEGREF-2: signed collect sees every site incl. negatives, without mutating", () => {
    const cfg = makeConfig();
    const sites = collectSignedWidgetConfigRefs(cfg);
    expect(sites).toContainEqual({ kind: "dynamicView", id: -3 });
    expect(sites).toContainEqual({ kind: "layer", id: -2 });
    expect(sites).toContainEqual({ kind: "widget", id: -4 });
    expect(sites.filter((s) => s.kind === "widget" && s.id === -1)).toHaveLength(2);
    expect(sites).toContainEqual({ kind: "table", id: 5 });
    expect(sites).toContainEqual({ kind: "customMetric", id: 9 });
    expect(sites).toContainEqual({ kind: "layer", id: 7 });
    expect(sites).toContainEqual({ kind: "widget", id: 12 });
    expect(cfg).toEqual(makeConfig());
  });

  it("NEGREF-3: remapTempRefs rewrites every temp id, leaves positives and sentinels", () => {
    const cfg = makeConfig();
    const out = remapTempRefs(cfg, makeMaps()) as any;
    expect(out.dynamicViewId).toBe(31);
    expect(out.sourceMapWidgetId).toBe(41);
    expect(out.includedLayerIds).toEqual([52, 7]);
    expect(out.filterSelection.allowedSourceWidgetIds).toEqual([41, SENTINEL, 12]);
    expect(out.options[0].actions[0].target.id).toBe(44);
    expect(out.tableId).toBe(5);
    expect(out.metricId).toBe(9);
    expect(out.spatialTargets).toEqual([{ tableId: 5 }]);
    expect(cfg).toEqual(makeConfig());
  });

  it("NEGREF-4: unmapped temp id throws UnmappedTempRefError", () => {
    const maps = makeMaps();
    maps.layer.delete(-2);
    let err: unknown;
    try {
      remapTempRefs(makeConfig(), maps);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnmappedTempRefError);
    expect((err as UnmappedTempRefError).kind).toBe("layer");
    expect((err as UnmappedTempRefError).id).toBe(-2);
    expect((err as Error).message).toBe("unmapped temporary layer id -2");
  });

  it("NEGREF-5: negative table / customMetric ids throw", () => {
    expect(() => remapTempRefs({ tableId: -5 }, makeMaps())).toThrow(UnmappedTempRefError);
    expect(() => remapTempRefs({ metricId: -9 }, makeMaps())).toThrow(UnmappedTempRefError);
  });

  it("NEGREF-6: edge cases", () => {
    expect(remapTempRefs({ includedLayerIds: [] }, makeMaps())).toEqual({ includedLayerIds: [] });
    expect(remapTempRefs({ dynamicViewId: 0 }, makeMaps())).toEqual({ dynamicViewId: 0 });
    expect(remapTempRefs({ dynamicViewId: "3" }, makeMaps())).toEqual({ dynamicViewId: "3" });
    expect(remapTempRefs(null, makeMaps())).toEqual({});
  });

  it("NEGREF-7: remapTempFilterSelection", () => {
    const maps = makeMaps();
    expect(
      remapTempFilterSelection(
        JSON.stringify({ sourceMode: "allow", allowedSourceWidgetIds: [-1, 12] }),
        maps.widget,
      ),
    ).toEqual({ sourceMode: "allow", allowedSourceWidgetIds: [41, 12] });
    expect(() =>
      remapTempFilterSelection({ allowedSourceWidgetIds: [-99] }, maps.widget),
    ).toThrow(UnmappedTempRefError);
    expect(remapTempFilterSelection(null, maps.widget)).toBeNull();
    expect(remapTempFilterSelection("{not json", maps.widget)).toBeNull();
  });
});
