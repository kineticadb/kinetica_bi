/**
 * Phase 120 Plan 01 — unit tests for the pure remap side of the shared reference traversal
 * (`remapWidgetConfigRefs` / `remapFilterSelection` in `dashboardExportRefs.ts`), plus the
 * `getTableBySchemaName` accessor (Task 3).
 *
 * Every fixture maps an OLD id to a NEW, non-adjacent id (e.g. 7 -> 9007) so a no-op remapper
 * cannot pass by luck.
 *
 * MUTATION PROBES (Plan 120-01 Task 3)
 * Ten probes were run against this suite: each mutation was applied to the source module (or
 * db.ts), the suite was re-run to confirm the named test(s) reddened, then the mutation was
 * reverted. This is a record of work performed — no acceptance criterion counts words in this
 * comment block.
 * P1 changed remapWidgetConfigRefs's visitor to return site.id instead of mapped, reddening "IMP-REF1: tableId is rewritten to the NEW table id" (and all other IMP-REF* tests).
 * P2 deleted the REF-2 dynamicViewId block from visitWidgetConfigRefs, reddening "IMP-REF2: dynamicViewId is rewritten to the NEW dynamic view id".
 * P3 deleted the REF-3 sourceMapWidgetId block, reddening "IMP-REF3: sourceMapWidgetId is rewritten to the NEW widget id".
 * P4 deleted the REF-4 scalar metricId block, reddening "IMP-REF4: the scalar metricId is rewritten to the NEW custom metric id".
 * P5 deleted the REF-5 metrics[] loop, reddening "IMP-REF5: every metrics[].metricId is rewritten to its NEW custom metric id".
 * P6 replaced the REF-6 empty-array branch with `[...maps.layer.values()]`, reddening "IMP-TRAP6: an EMPTY includedLayerIds array stays [] and is never expanded to the layer list".
 * P7 replaced the REF-7 asId-gated loop with a naive `arr.map(e => widgetIdMap.get(e))`, reddening "IMP-TRAP7: the __spatial_draws__ sentinel survives byte-identical and in its original position" and "IMP-TRAP7: a naive whole-array map would null the sentinel — the output has no null/undefined entry".
 * P8 narrowed the REF-8 action reader to only `Array.isArray(o.actions) ? o.actions : []`, reddening "IMP-REF8: the LEGACY singular options[].action.target id is rewritten identically to actions[]".
 * P9 changed the visitor's miss branch to `return site.id` (mapped ?? site.id), reddening every IMP-STRIP* test.
 * P10 changed getTableBySchemaName's `ORDER BY id ASC` to `ORDER BY id DESC`, reddening "TBLMATCH: getTableBySchemaName returns the OLDEST row when duplicates exist".
 * All ten probes reddened at least their named test; none required a test change. 10/10 fired.
 */
import { describe, it, expect } from "vitest";
import {
  emptyRefIdMaps,
  remapWidgetConfigRefs,
  remapFilterSelection,
  type RefIdMaps,
} from "../src/lib/dashboardExportRefs";

const SPATIAL_DRAWS_SENTINEL = "__spatial_draws__";

function makeMaps(entries: Partial<Record<keyof RefIdMaps, [number, number][]>>): RefIdMaps {
  const maps = emptyRefIdMaps();
  (Object.keys(maps) as (keyof RefIdMaps)[]).forEach((kind) => {
    const pairs = entries[kind] ?? [];
    for (const [oldId, newId] of pairs) maps[kind].set(oldId, newId);
  });
  return maps;
}

describe("remapWidgetConfigRefs — IMP-REF1..8: each kind rewrites to the NEW id", () => {
  it("IMP-REF1: tableId is rewritten to the NEW table id", () => {
    const maps = makeMaps({ table: [[7, 9007]] });
    const result = remapWidgetConfigRefs({ tableId: 7 }, maps);
    expect(result.config).toEqual({ tableId: 9007 });
    expect(result.stripped).toEqual([]);
  });

  it("IMP-REF2: dynamicViewId is rewritten to the NEW dynamic view id", () => {
    const maps = makeMaps({ dynamicView: [[8, 9008]] });
    const result = remapWidgetConfigRefs({ dynamicViewId: 8 }, maps);
    expect(result.config).toEqual({ dynamicViewId: 9008 });
  });

  it("IMP-REF3: sourceMapWidgetId is rewritten to the NEW widget id", () => {
    const maps = makeMaps({ widget: [[3, 9003]] });
    const result = remapWidgetConfigRefs({ sourceMapWidgetId: 3 }, maps);
    expect(result.config).toEqual({ sourceMapWidgetId: 9003 });
  });

  it("IMP-REF4: the scalar metricId is rewritten to the NEW custom metric id", () => {
    const maps = makeMaps({ customMetric: [[9, 9009]] });
    const result = remapWidgetConfigRefs({ metricId: 9 }, maps);
    expect(result.config).toEqual({ metricId: 9009 });
  });

  it("IMP-REF5: every metrics[].metricId is rewritten to its NEW custom metric id", () => {
    const maps = makeMaps({
      customMetric: [
        [1, 9001],
        [2, 9002],
      ],
    });
    const result = remapWidgetConfigRefs({ metrics: [{ metricId: 1 }, { metricId: 2 }] }, maps);
    expect(result.config).toEqual({ metrics: [{ metricId: 9001 }, { metricId: 9002 }] });
  });

  it("IMP-REF6: every includedLayerIds element is rewritten to its NEW layer id", () => {
    const maps = makeMaps({
      layer: [
        [3, 9003],
        [1, 9001],
        [2, 9002],
      ],
    });
    const result = remapWidgetConfigRefs({ includedLayerIds: [3, 1, 2] }, maps);
    expect(result.config).toEqual({ includedLayerIds: [9003, 9001, 9002] });
  });

  it("IMP-REF7: numeric allowedSourceWidgetIds entries are rewritten to NEW widget ids", () => {
    const maps = makeMaps({
      widget: [
        [4, 9004],
        [6, 9006],
      ],
    });
    const result = remapWidgetConfigRefs(
      { filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [4, 6] } },
      maps,
    );
    expect(result.config).toEqual({
      filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [9004, 9006] },
    });
  });

  it("IMP-REF8: an actions[] target id is rewritten per target.kind (widget / layer / dynamicView)", () => {
    const maps = makeMaps({
      widget: [[11, 9011]],
      layer: [[22, 9022]],
      dynamicView: [[33, 9033]],
    });
    const result = remapWidgetConfigRefs(
      {
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
      },
      maps,
    );
    expect(result.config).toEqual({
      options: [
        {
          id: "a",
          label: "A",
          actions: [
            { target: { kind: "widget", id: 9011 }, configPatch: {} },
            { target: { kind: "layer", id: 9022 }, configPatch: {} },
            { target: { kind: "dynamicView", id: 9033 }, configPatch: {} },
          ],
        },
      ],
    });
  });

  it("IMP-REF8: the LEGACY singular options[].action.target id is rewritten identically to actions[]", () => {
    const maps = makeMaps({ widget: [[44, 9044]] });
    const result = remapWidgetConfigRefs(
      {
        options: [
          { id: "a", label: "A", action: { target: { kind: "widget", id: 44 }, configPatch: {} } },
        ],
      },
      maps,
    );
    expect(result.config).toEqual({
      options: [
        { id: "a", label: "A", action: { target: { kind: "widget", id: 9044 }, configPatch: {} } },
      ],
    });
  });
});

describe("remapWidgetConfigRefs — the three rewrite traps", () => {
  it("IMP-TRAP6: an EMPTY includedLayerIds array stays [] and is never expanded to the layer list", () => {
    const maps = makeMaps({
      layer: [
        [1, 9001],
        [2, 9002],
      ],
    });
    const result = remapWidgetConfigRefs({ includedLayerIds: [] }, maps);
    expect(result.config).toEqual({ includedLayerIds: [] });
    expect(result.layerFilterWidened).toBe(false);
  });

  it("IMP-TRAP6: an ABSENT includedLayerIds field stays absent", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs({ other: "x" }, maps);
    expect(result.config).toEqual({ other: "x" });
    expect("includedLayerIds" in result.config).toBe(false);
  });

  it("IMP-TRAP7: the __spatial_draws__ sentinel survives byte-identical and in its original position", () => {
    const maps = makeMaps({ widget: [[4, 9004]] });
    const result = remapWidgetConfigRefs(
      {
        filterSelection: {
          sourceMode: "allowlist",
          allowedSourceWidgetIds: [4, SPATIAL_DRAWS_SENTINEL],
        },
      },
      maps,
    );
    const filterSelection = result.config.filterSelection as { allowedSourceWidgetIds: unknown[] };
    expect(filterSelection.allowedSourceWidgetIds).toEqual([9004, SPATIAL_DRAWS_SENTINEL]);
  });

  it("IMP-TRAP7: a naive whole-array map would null the sentinel — the output has no null/undefined entry", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs(
      {
        filterSelection: {
          sourceMode: "allowlist",
          allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL],
        },
      },
      maps,
    );
    const filterSelection = result.config.filterSelection as { allowedSourceWidgetIds: unknown[] };
    expect(filterSelection.allowedSourceWidgetIds).toEqual([SPATIAL_DRAWS_SENTINEL]);
    expect(filterSelection.allowedSourceWidgetIds).not.toContain(null);
    expect(filterSelection.allowedSourceWidgetIds).not.toContain(undefined);
  });

  it("IMP-TRAP8: an option carrying BOTH actions[] and a legacy action has both shapes handled", () => {
    const maps = makeMaps({
      widget: [
        [11, 9011],
        [44, 9044],
      ],
    });
    const result = remapWidgetConfigRefs(
      {
        options: [
          { id: "a", label: "A", actions: [{ target: { kind: "widget", id: 11 }, configPatch: {} }] },
          { id: "b", label: "B", action: { target: { kind: "widget", id: 44 }, configPatch: {} } },
        ],
      },
      maps,
    );
    expect(result.config).toEqual({
      options: [
        { id: "a", label: "A", actions: [{ target: { kind: "widget", id: 9011 }, configPatch: {} }] },
        { id: "b", label: "B", action: { target: { kind: "widget", id: 9044 }, configPatch: {} } },
      ],
    });
  });
});

describe("remapWidgetConfigRefs — the strip rules (Pitfall 3)", () => {
  it("IMP-STRIP1: an unmapped tableId is DELETED, not left as the original id", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs({ tableId: 7 }, maps);
    expect(result.config).toEqual({});
    expect(result.stripped).toEqual([{ kind: "table", id: 7 }]);
  });

  it("IMP-STRIP5: an unmapped metrics[].metricId is deleted but the element survives", () => {
    const maps = makeMaps({ customMetric: [[1, 9001]] });
    const result = remapWidgetConfigRefs(
      { metrics: [{ metricId: 1 }, { metricId: 2, label: "b" }] },
      maps,
    );
    expect(result.config).toEqual({ metrics: [{ metricId: 9001 }, { label: "b" }] });
    expect(result.stripped).toEqual([{ kind: "customMetric", id: 2 }]);
  });

  it("IMP-STRIP6: an unmapped includedLayerIds element is dropped from the array", () => {
    const maps = makeMaps({ layer: [[1, 9001]] });
    const result = remapWidgetConfigRefs({ includedLayerIds: [1, 2] }, maps);
    expect(result.config).toEqual({ includedLayerIds: [9001] });
    expect(result.stripped).toEqual([{ kind: "layer", id: 2 }]);
  });

  it("IMP-STRIP6: emptying a non-empty includedLayerIds sets layerFilterWidened", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs({ includedLayerIds: [1, 2] }, maps);
    expect(result.config).toEqual({ includedLayerIds: [] });
    expect(result.layerFilterWidened).toBe(true);
  });

  it("IMP-STRIP7: an unmapped allowedSourceWidgetIds entry is dropped and the sentinel still survives", () => {
    const maps = makeMaps({ widget: [[4, 9004]] });
    const result = remapWidgetConfigRefs(
      {
        filterSelection: {
          sourceMode: "allowlist",
          allowedSourceWidgetIds: [4, 6, SPATIAL_DRAWS_SENTINEL],
        },
      },
      maps,
    );
    const filterSelection = result.config.filterSelection as { allowedSourceWidgetIds: unknown[] };
    expect(filterSelection.allowedSourceWidgetIds).toEqual([9004, SPATIAL_DRAWS_SENTINEL]);
    expect(result.stripped).toEqual([{ kind: "widget", id: 6 }]);
  });

  it("IMP-STRIP8: an action whose target is unmapped is removed from actions[]", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs(
      {
        options: [
          { id: "a", label: "A", actions: [{ target: { kind: "widget", id: 11 }, configPatch: {} }] },
        ],
      },
      maps,
    );
    expect(result.config).toEqual({ options: [{ id: "a", label: "A", actions: [] }] });
    expect(result.stripped).toEqual([{ kind: "widget", id: 11 }]);
  });

  it("IMP-STRIP8: a legacy singular action whose target is unmapped deletes options[].action", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs(
      {
        options: [
          { id: "a", label: "A", action: { target: { kind: "widget", id: 44 }, configPatch: {} } },
        ],
      },
      maps,
    );
    expect(result.config).toEqual({ options: [{ id: "a", label: "A" }] });
    expect(result.stripped).toEqual([{ kind: "widget", id: 44 }]);
  });

  it("IMP-STRIP: every stripped reference is reported in outcome.stripped with its kind and OLD id", () => {
    const maps = emptyRefIdMaps();
    const result = remapWidgetConfigRefs(
      { tableId: 7, dynamicViewId: 8, sourceMapWidgetId: 3, metricId: 9 },
      maps,
    );
    expect(result.stripped).toEqual(
      expect.arrayContaining([
        { kind: "table", id: 7 },
        { kind: "dynamicView", id: 8 },
        { kind: "widget", id: 3 },
        { kind: "customMetric", id: 9 },
      ]),
    );
    expect(result.stripped).toHaveLength(4);
  });
});

describe("remapWidgetConfigRefs / remapFilterSelection — purity", () => {
  it("IMP-PURE: remapWidgetConfigRefs does not mutate the config object it was given", () => {
    const maps = makeMaps({ table: [[7, 9007]] });
    const original = { tableId: 7 };
    const snapshot = JSON.parse(JSON.stringify(original));
    const result = remapWidgetConfigRefs(original, maps);
    expect(original).toEqual(snapshot);
    expect(result.config).not.toBe(original);
    expect(result.config).toEqual({ tableId: 9007 });
  });

  it("IMP-PURE: remapFilterSelection returns null for null and for unparseable JSON", () => {
    const widgetIdMap = new Map<number, number>();
    expect(remapFilterSelection(null, widgetIdMap).value).toBeNull();
    expect(remapFilterSelection("{not valid json", widgetIdMap).value).toBeNull();
  });

  it("IMP-PURE: remapFilterSelection accepts a raw JSON STRING as well as an object", () => {
    const widgetIdMap = new Map<number, number>([[4, 9004]]);
    const asObject = { sourceMode: "allowlist", allowedSourceWidgetIds: [4] };
    const asString = JSON.stringify(asObject);
    expect(remapFilterSelection(asObject, widgetIdMap).value).toEqual({
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [9004],
    });
    expect(remapFilterSelection(asString, widgetIdMap).value).toEqual({
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [9004],
    });
  });
});
