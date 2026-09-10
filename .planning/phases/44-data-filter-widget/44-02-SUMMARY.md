---
phase: 44-data-filter-widget
plan: 02
subsystem: widget-registration + config-panel
tags: [chart-type, registry, config-panel, column-picker, filter-fields, vitest, react]
dependency_graph:
  requires:
    - 44-01 (ActiveFilter type, setBulkFilters, FILTER_CAP_PER_TABLE)
  provides:
    - datafilter chart type registered in chart-type registry (FILTER-V17-07)
    - DataFilterConfigPanel — multi-row filter-field builder (FILTER-V17-08)
    - WKT/geometry/large-text column exclusion via isColumnDrillDownSafe (FILTER-V17-09)
    - Base-table picker with usesDataSource:false suppression (FILTER-V17-10)
    - FilterFieldKind type export (consumed by Plan 44-03 renderer)
  affects:
    - visualization picker modal (DashboardsPage getAllChartTypes auto-includes datafilter)
    - ChartConfigPanel CustomConfigPanel slot (unchanged — existing mechanism)
tech_stack:
  added: []
  patterns:
    - CustomConfigPanel pattern (mirrors LegendConfigPanel precedent)
    - N-row builder with per-row column + kind picker (mirrors CbConfigForm shape)
    - isValid signaling via useEffect dep on derived allRowsValid boolean
    - rerender pattern in vitest for controlled-component kind-picker assertions
key_files:
  created:
    - kinetica_bi/src/components/charts/definitions/data-filter.ts
    - kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx
    - kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx
  modified:
    - kinetica_bi/src/components/charts/definitions/index.ts
decisions:
  - "usesDataSource:false on ChartTypeDefinition suppresses ChartConfigPanel's generic Data Source section; DataFilterConfigPanel renders its own base-table picker from props.tables"
  - "Table change resets filterFields:[] — old column refs are invalid for a new table schema; operator must re-pick columns"
  - "kind picker disabled (disabled attr) when column is '' OR column is missing from the table — prevents committing an invalid kind for an unknown column type"
  - "Tests 10-13 use rerender() pattern to simulate controlled-component state propagation after selectOptions — avoids duplicate DOM elements from multiple render() calls in the same test body"
  - "19 tests total (18 required by plan + 1 bonus getAllChartTypes registry assertion)"
metrics:
  duration: 5min
  tasks: 2
  files_modified: 4
  completed: "2026-05-28"
---

# Phase 44 Plan 02: Widget Definition and Config Panel Summary

Chart type `datafilter` registered in the chart-type registry; `DataFilterConfigPanel` ships as a CustomConfigPanel with base-table picker, N-row filter-field builder, WKT/geometry exclusion, and per-column-type kind constraints.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create data-filter chart type definition + register in chart-type index | 8cd14a7 | definitions/data-filter.ts, definitions/index.ts |
| 2 | Build DataFilterConfigPanel — base-table picker + N-row filter-field builder | cfa65e1 | DataFilterConfigPanel.tsx, DataFilterConfigPanel.spec.tsx |

## Final datafilter ChartTypeDefinition Shape

```typescript
const dataFilter: ChartTypeDefinition = {
  type: "datafilter",
  label: "Data Filter",
  icon: "DF",
  fields: [],
  defaultConfig: { filterFields: [] },
  usesAggregation: false,
  usesDataSource: false,   // suppresses ChartConfigPanel's generic Data Source section
  supportsDrillDown: false,
  CustomConfigPanel: DataFilterConfigPanel,
};
```

## Final Config Shape (persisted to widget.config)

```typescript
{
  tableId?: number;       // base table id — used by Plan 44-03 for setBulkFilters + store subscription
  tableRef?: string;      // "schema.name" — used by Plan 44-03 for topValuesFn/columnStatsFn calls
  filterFields?: Array<{
    column: string;       // column name on the base table
    kind: FilterFieldKind | "";  // empty until operator picks both column AND kind
  }>;
}
```

## Per-Column-Type Kind Mapping (KINDS_BY_DATA_TYPE)

| DrillDownDataType | Allowed kinds |
|-------------------|---------------|
| `string` | `text-eq`, `text-in`, `dropdown`, `multi-select` |
| `number` | `number-eq`, `number-range` |
| `datetime` | `date-eq`, `date-range` |
| `boolean` | `boolean-toggle` |
| `null` | [] (column metadata missing — kind picker shows no options) |

## WKT/Geometry Exclusion Path

Column picker filters via `isColumnDrillDownSafe(colType)` from `columnTypes.ts`. The `EXCLUDED_DRILLDOWN_TYPES` set covers: `wkt`, `wkb`, `bytes`, `blob`, `text`, `point`, `geometry`, `geography`. Spec test 7 asserts all four excluded types are absent from picker options.

## isValid Signaling Behavior

- `isValid(false)` when: `filterFields` array is empty, OR any row has `column === ""`, OR any row has `kind === ""`
- `isValid(true)` when: `filterFields.length > 0` AND every row has both `column !== ""` and `kind !== ""`
- Signal fires via `useEffect` on `allRowsValid` derived value — covers both mount (initial state) and subsequent config changes

## Test Fixtures for Plan 44-03 Renderer Spec Reuse

The `makeTables()` helper in `DataFilterConfigPanel.spec.tsx` creates 3 tables:
- Table id:1 `s.t1` with `region:varchar`, `fare:double`, `ts:timestamp`, `active:boolean` + 4 excluded columns (geom/wkt, shape/geometry, loc/point, notes/text)
- Table id:2 `s.t2` with `status:varchar`, `score:int`
- Table id:3 `s.t3` with `city:varchar`

The `renderPanel(configOverrides, propsOverrides)` helper can be copied directly into `DataFilterRenderer.spec.tsx` with the same fixture tables. Note: tests 10-13 use the `rerender()` pattern (not multiple `render()` calls) to simulate controlled-component kind-picker assertions after column selection.

## Note for Plan 44-03

`widget.config` output from this panel is consumed verbatim by the renderer — no runtime mutation of the config panel's output is expected. The renderer reads:
- `config.tableId` for store dispatch (`setBulkFilters(tableId, ...)`) + store subscription
- `config.tableRef` for `topValuesFn` / `columnStatsFn` API calls (split on `.` → `{schema, table}`)
- `config.filterFields[].column` and `.kind` to render per-field controls

## Deviations from Plan

None — plan executed exactly as written. One minor spec-level fix: tests 10-13 used `rerender()` instead of nested `render()` calls to avoid duplicate DOM elements (the plan's spec action template showed `render()` calls inside test bodies that were already rendered — the rerender approach is functionally equivalent and avoids DOM pollution between assertions).

## Self-Check: PASSED
