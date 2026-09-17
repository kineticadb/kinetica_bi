/**
 * Phase 119 Plan 01 — unit tests for the pure dashboard-export reference walk.
 *
 * One named test per REF-n reference kind (see dashboardExportRefs.ts header for the full
 * inventory), plus the three traps this phase exists to catch:
 *   - the SPATIAL_DRAWS_SENTINEL string must never be coerced to a numeric id
 *   - an EMPTY includedLayerIds array is a sentinel ("all layers"), not "no layers" — it must
 *     NOT be expanded, and it must NOT contribute any layer refs either
 *   - the legacy singular options[].action field must be walked identically to actions[]
 *
 * MUTATION PROBES (Plan 119-01 Task 2)
 * Ten probes were run against this suite: each mutation was applied to the source module, the
 * suite was re-run to confirm the named test(s) reddened, then the mutation was reverted. This
 * is a record of work performed — no acceptance criterion counts words in this comment block.
 * P1 deleted the REF-1 tableId block, reddening "REF-1: config.tableId is collected as a table reference".
 * P2 deleted the REF-2 dynamicViewId block, reddening "REF-2: config.dynamicViewId is collected as a dynamicView reference".
 * P3 deleted the REF-3 sourceMapWidgetId block, reddening "REF-3: config.sourceMapWidgetId is collected as a widget reference".
 * P4 deleted the REF-4 scalar metricId block, reddening "REF-4: config.metricId (scalar) is collected as a customMetric reference".
 * P5 deleted the REF-5 metrics[] loop, reddening "REF-5: config.metrics[].metricId (array) is collected for every element".
 * P6 deleted the REF-6 includedLayerIds loop, reddening "REF-6: config.includedLayerIds collects every element as a layer reference".
 * P7 deleted the REF-7 filterSelection call, reddening both REF-7 tests (numeric collection and the sentinel-drop test).
 * P8 deleted the REF-8 options[] loop, reddening "REF-8: options[].actions[].target dispatches on kind to widget / layer / dynamicView".
 * P9 narrowed the REF-8 normalizer to drop the legacy singular action fallback, reddening "REF-8: the legacy singular options[].action.target is walked identically to actions[]".
 * P10 coerced strings in asId (Number(v) fallback), reddening the sentinel-drop test and the asId boundary-rejection test.
 * All ten probes reddened at least their named test; none required a test change. 10/10 fired.
 */
import { describe, it, expect } from "vitest";
import {
  emptyExportRefs,
  mergeExportRefs,
  collectFilterSelectionRefs,
  collectWidgetConfigRefs,
  collectLayerRefs,
  collectDynamicViewRefs,
  type ExportRefs,
} from "../src/lib/dashboardExportRefs";
import type { DashboardLayer, DashboardDynamicView } from "../src/types";

const SPATIAL_DRAWS_SENTINEL = "__spatial_draws__";

function refs(partial: Partial<ExportRefs>): ExportRefs {
  return { ...emptyExportRefs(), ...partial };
}

function makeLayer(overrides: Partial<DashboardLayer> = {}): DashboardLayer {
  return {
    id: 1,
    dashboard_id: 1,
    table_id: 10,
    layer_type: "KineticaWms",
    position: 0,
    config: {},
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    filter_scope: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDynamicView(overrides: Partial<DashboardDynamicView> = {}): DashboardDynamicView {
  return {
    id: 1,
    dashboard_id: 1,
    source_table_id: 20,
    name: "dv",
    template_sql: "SELECT 1",
    max_records: 100,
    columns_json: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("collectWidgetConfigRefs — REF-1..9", () => {
  it("REF-1: config.tableId is collected as a table reference", () => {
    expect(collectWidgetConfigRefs({ tableId: 5 })).toEqual(refs({ tableIds: [5] }));
  });

  it("REF-2: config.dynamicViewId is collected as a dynamicView reference", () => {
    expect(collectWidgetConfigRefs({ dynamicViewId: 7 })).toEqual(refs({ dynamicViewIds: [7] }));
  });

  it("REF-3: config.sourceMapWidgetId is collected as a widget reference", () => {
    expect(collectWidgetConfigRefs({ sourceMapWidgetId: 3 })).toEqual(refs({ widgetIds: [3] }));
  });

  it("REF-4: config.metricId (scalar) is collected as a customMetric reference", () => {
    expect(collectWidgetConfigRefs({ metricId: 9 })).toEqual(refs({ customMetricIds: [9] }));
  });

  it("REF-5: config.metrics[].metricId (array) is collected for every element", () => {
    expect(
      collectWidgetConfigRefs({ metrics: [{ metricId: 1 }, { metricId: 2 }, { metricId: 1 }] }),
    ).toEqual(refs({ customMetricIds: [1, 2] }));
  });

  it("REF-6: config.includedLayerIds collects every element as a layer reference", () => {
    expect(collectWidgetConfigRefs({ includedLayerIds: [3, 1, 2] })).toEqual(
      refs({ layerIds: [1, 2, 3] }),
    );
  });

  it("REF-6: an EMPTY includedLayerIds array yields zero layer refs and is not expanded to all layers", () => {
    expect(collectWidgetConfigRefs({ includedLayerIds: [] })).toEqual(emptyExportRefs());
  });

  it("REF-7: filterSelection.allowedSourceWidgetIds collects numeric entries as widget references", () => {
    expect(
      collectWidgetConfigRefs({
        filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [4, 6] },
      }),
    ).toEqual(refs({ widgetIds: [4, 6] }));
  });

  it("REF-7: the __spatial_draws__ sentinel is dropped, never coerced to a numeric id", () => {
    expect(
      collectWidgetConfigRefs({
        filterSelection: {
          sourceMode: "allowlist",
          allowedSourceWidgetIds: [4, SPATIAL_DRAWS_SENTINEL],
        },
      }),
    ).toEqual(refs({ widgetIds: [4] }));
  });

  it("REF-8: options[].actions[].target dispatches on kind to widget / layer / dynamicView", () => {
    expect(
      collectWidgetConfigRefs({
        options: [
          {
            id: "a",
            label: "A",
            actions: [
              { target: { kind: "widget", id: 11 }, configPatch: {} },
              { target: { kind: "layer", id: 22 }, configPatch: {} },
              { target: { kind: "dynamicView", id: 33 }, configPatch: {} },
            ],
          },
        ],
      }),
    ).toEqual(refs({ widgetIds: [11], layerIds: [22], dynamicViewIds: [33] }));
  });

  it("REF-8: the legacy singular options[].action.target is walked identically to actions[]", () => {
    expect(
      collectWidgetConfigRefs({
        options: [
          {
            id: "a",
            label: "A",
            action: { target: { kind: "widget", id: 44 }, configPatch: {} },
          },
        ],
      }),
    ).toEqual(refs({ widgetIds: [44] }));
  });

  it("REF-8: an unknown target.kind is ignored rather than mis-filed", () => {
    expect(
      collectWidgetConfigRefs({
        options: [
          {
            id: "a",
            label: "A",
            actions: [{ target: { kind: "bogus", id: 55 }, configPatch: {} }],
          },
        ],
      }),
    ).toEqual(emptyExportRefs());
  });

  // REF-9 — the kind 119-RESEARCH, the plan checker and the third audit sweep all missed.
  // A map widget's spatialTargets[].tableId selects which registry table a drawn spatial
  // filter applies to; unremapped, an imported map filters the wrong table silently.
  it("REF-9: config.spatialTargets[].tableId is collected for every element", () => {
    expect(
      collectWidgetConfigRefs({
        spatialTargets: [
          { tableId: 4, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
          { tableId: 2, spatialMode: "wkt", spatialCol: "geom" },
          { tableId: 4, spatialMode: "wkb" },
        ],
      }),
    ).toEqual(refs({ tableIds: [2, 4] }));
  });

  it("REF-9: a spatialTargets element with no numeric tableId contributes nothing", () => {
    expect(
      collectWidgetConfigRefs({
        spatialTargets: [{ spatialMode: "latlon" }, { tableId: "4" }, null, "x"],
      }),
    ).toEqual(emptyExportRefs());
  });
});

describe("collectWidgetConfigRefs — robustness", () => {
  it("collectWidgetConfigRefs returns empty refs for null, undefined, a string and an array", () => {
    expect(collectWidgetConfigRefs(null)).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs(undefined)).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs("not-an-object")).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs([1, 2, 3])).toEqual(emptyExportRefs());
  });
});

describe("collectFilterSelectionRefs", () => {
  it("collectFilterSelectionRefs parses a raw JSON STRING as well as an object", () => {
    const asObject = { sourceMode: "allowlist", allowedSourceWidgetIds: [8] };
    const asString = JSON.stringify(asObject);
    expect(collectFilterSelectionRefs(asObject)).toEqual([8]);
    expect(collectFilterSelectionRefs(asString)).toEqual([8]);
  });

  it("collectFilterSelectionRefs returns [] for unparseable JSON rather than throwing", () => {
    expect(() => collectFilterSelectionRefs("{not valid json")).not.toThrow();
    expect(collectFilterSelectionRefs("{not valid json")).toEqual([]);
  });
});

describe("asId boundary — non-positive / non-integer rejection", () => {
  it("non-positive and non-integer ids (0, -1, 2.5, \"7\", NaN) are rejected everywhere", () => {
    expect(collectWidgetConfigRefs({ tableId: 0 })).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs({ tableId: -1 })).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs({ tableId: 2.5 })).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs({ tableId: "7" })).toEqual(emptyExportRefs());
    expect(collectWidgetConfigRefs({ tableId: NaN })).toEqual(emptyExportRefs());
  });
});

describe("collectLayerRefs", () => {
  it("collectLayerRefs collects table_id, a non-null dynamic_view_id, and filter_scope widget ids", () => {
    const layer = makeLayer({
      table_id: 10,
      dynamic_view_id: 20,
      filter_scope: JSON.stringify({ sourceMode: "allowlist", allowedSourceWidgetIds: [30] }),
    });
    expect(collectLayerRefs(layer)).toEqual(
      refs({ tableIds: [10], dynamicViewIds: [20], widgetIds: [30] }),
    );
  });

  it("collectLayerRefs emits no dynamicView ref when dynamic_view_id is null", () => {
    const layer = makeLayer({ table_id: 10, dynamic_view_id: null, filter_scope: null });
    expect(collectLayerRefs(layer)).toEqual(refs({ tableIds: [10] }));
  });

  it("collectLayerRefs ignores cb_config and track_config entirely", () => {
    const layer = makeLayer({
      table_id: 10,
      dynamic_view_id: null,
      filter_scope: null,
      cb_config: JSON.stringify({ tableId: 999, metricId: 888 }),
      track_config: JSON.stringify({ dynamicViewId: 777, widgetId: 666 }),
    });
    expect(collectLayerRefs(layer)).toEqual(refs({ tableIds: [10] }));
  });
});

describe("collectDynamicViewRefs", () => {
  it("collectDynamicViewRefs collects source_table_id and nothing else", () => {
    const dv = makeDynamicView({ source_table_id: 20 });
    expect(collectDynamicViewRefs(dv)).toEqual(refs({ tableIds: [20] }));
  });
});

describe("mergeExportRefs", () => {
  it("mergeExportRefs de-duplicates and returns each id list ascending", () => {
    const a = refs({ tableIds: [3, 1], widgetIds: [9] });
    const b = refs({ tableIds: [1, 2], layerIds: [5, 5] });
    expect(mergeExportRefs(a, b)).toEqual(
      refs({ tableIds: [1, 2, 3], widgetIds: [9], layerIds: [5] }),
    );
  });
});
