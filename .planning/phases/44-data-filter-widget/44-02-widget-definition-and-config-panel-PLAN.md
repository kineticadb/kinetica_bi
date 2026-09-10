---
phase: 44-data-filter-widget
plan: 02
type: execute
wave: 2
depends_on: [44-01]
files_modified:
  - kinetica_bi/src/components/charts/definitions/data-filter.ts
  - kinetica_bi/src/components/charts/definitions/index.ts
  - kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx
  - kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx
autonomous: true
requirements:
  - FILTER-V17-07   # data-filter chart type registered in chart-type registry
  - FILTER-V17-08   # DataFilterConfigPanel — multi-row builder (column picker + per-row control-kind picker) backed by `columnTypes.ts` type partitioning
  - FILTER-V17-09   # WKT/geometry column exclusion in column picker (reuse isColumnDrillDownSafe predicate)
  - FILTER-V17-10   # Base-table picker inside DataFilterConfigPanel (usesDataSource: false to suppress ChartConfigPanel's duplicate Data Source section)

must_haves:
  truths:
    - "The widget creation modal lists a new 'Data Filter' option alongside Bar / Line / Pie / etc."
    - "Selecting Data Filter from the visualization picker shows the DataFilterConfigPanel inside ChartConfigPanel — NO generic Data Source section above it (usesDataSource: false)"
    - "DataFilterConfigPanel renders its own base-table picker reading from props.tables"
    - "After picking a base table, the operator can add N filter-field rows; each row has a column picker (filtered by columnTypes type-partitioning) and a control-kind picker scoped to that column's data type"
    - "WKT / geometry / large-text columns NEVER appear in the column picker — reuses isColumnDrillDownSafe"
    - "Config persists shape: { tableId, tableRef, filterFields: Array<{column, kind}> }"
    - "Numeric columns surface 'number-eq' + 'number-range' kinds; string columns surface 'text-eq' + 'text-in' + 'dropdown' + 'multi-select'; datetime surface 'date-eq' + 'date-range'; boolean surface 'boolean-toggle'"
  artifacts:
    - path: "kinetica_bi/src/components/charts/definitions/data-filter.ts"
      provides: "Chart type registry entry — type='datafilter', usesDataSource:false, usesAggregation:false, supportsDrillDown:false, CustomConfigPanel:DataFilterConfigPanel"
      contains: "registerChartType"
    - path: "kinetica_bi/src/components/charts/definitions/index.ts"
      provides: "registerDataFilter() call added to registerAllChartTypes()"
      contains: "registerDataFilter"
    - path: "kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx"
      provides: "Multi-row filter-field builder + base-table picker"
      min_lines: 150
    - path: "kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx"
      provides: "Unit coverage for column-type partitioning + WKT exclusion + row add/remove + control-kind picker constraints"
      min_lines: 100
  key_links:
    - from: "kinetica_bi/src/components/charts/definitions/index.ts"
      to: "kinetica_bi/src/components/charts/definitions/data-filter.ts"
      via: "import + registerDataFilter() call inside registerAllChartTypes()"
      pattern: "registerDataFilter\\(\\)"
    - from: "kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx"
      to: "kinetica_bi/src/lib/columnTypes.ts (isColumnDrillDownSafe + type-partition predicates)"
      via: "import + per-column filter call"
      pattern: "isColumnDrillDownSafe"
---

<objective>
Ship the chart-type registration and the CustomConfigPanel for the Data Filter widget. This plan delivers CONFIG-ONLY surface area:
- A new `datafilter` chart type registered alongside the existing 11 types.
- `DataFilterConfigPanel` — a multi-row N-field builder with base-table picker, per-row column picker (filtered by `columnTypes.ts` predicates), and per-row control-kind picker.
- ZERO runtime data dispatch yet (no Apply, no filter store interaction). Plan 44-03 builds `DataFilterRenderer.tsx` and the Apply pipeline.

After this plan: the operator can pick "Data Filter" from the visualization picker, configure N fields, and save — but the widget renders as a placeholder body (TBD by Plan 44-03). Persistence + visualization-picker-listing must work end-to-end.

Purpose: Decouple config UI from render/dispatch surface. Config panel is testable in isolation against props (no DashboardContext, no filter store) which keeps spec fixtures simple.

Output:
- `definitions/data-filter.ts` — registry entry mirroring `legend.ts` shape.
- `definitions/index.ts` — `registerDataFilter()` call added.
- `DataFilterConfigPanel.tsx` — base-table picker + N-row builder.
- `DataFilterConfigPanel.spec.tsx` — unit coverage.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/44-data-filter-widget/44-CONTEXT.md
@.planning/phases/44-data-filter-widget/44-RESEARCH.md

<!-- Plan 44-01 sibling — gives downstream visibility into the new ActiveFilter shape this plan's config produces -->
@.planning/phases/44-data-filter-widget/44-01-store-and-where-builder-foundation-PLAN.md

<!-- Source files this plan modifies or creates -->
@kinetica_bi/src/components/charts/definitions/legend.ts
@kinetica_bi/src/components/charts/definitions/info-card.ts
@kinetica_bi/src/components/charts/definitions/index.ts
@kinetica_bi/src/components/charts/LegendConfigPanel.tsx
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/lib/columnTypes.ts
@kinetica_bi/src/components/charts/ChartConfigPanel.tsx

<interfaces>
<!-- Key types and contracts extracted verbatim. Executor uses these — does not re-research. -->

From kinetica_bi/src/components/charts/registry.ts (ConfigPanelProps + ChartTypeDefinition):
```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];          // columns from the selected base table
  tables?: {
    id: number;
    name: string;
    schema: string;
    columns: Record<string, string>;
  }[];                                                  // dashboard-scoped table list (associatedTables)
  isValid?: (valid: boolean) => void;
  widgets?: WidgetDto[];
};

export type ChartTypeDefinition = {
  type: string;
  label: string;
  icon: string;
  fields: ConfigField[];                  // declarative form fields (we use [] — CustomConfigPanel replaces)
  defaultConfig: Record<string, unknown>;
  CustomConfigPanel?: ComponentType<ConfigPanelProps>;
  usesAggregation?: boolean;              // false = no SQL
  requiresGroupBy?: boolean;
  usesDataSource?: boolean;               // false = suppress ChartConfigPanel's generic Data Source picker
  supportsDrillDown?: boolean;
};
```

From kinetica_bi/src/components/charts/definitions/legend.ts (CLOSEST PRECEDENT — copy structure):
```typescript
import { registerChartType, type ChartTypeDefinition } from "../registry";
import LegendConfigPanel from "../LegendConfigPanel";

const legend: ChartTypeDefinition = {
  type: "legend",
  label: "Legend",
  icon: "LG",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  supportsDrillDown: false,
  CustomConfigPanel: LegendConfigPanel,
};

export default function register() {
  registerChartType(legend);
}
```

From kinetica_bi/src/components/charts/LegendConfigPanel.tsx (CustomConfigPanel SHAPE — copy the props destructure pattern):
```typescript
import { useEffect } from "react";
import type { ConfigPanelProps } from "./registry";

export default function LegendConfigPanel({
  config,
  onChange,
  widgets,
}: ConfigPanelProps): JSX.Element {
  // ... reads config from props, mutates via onChange({...config, ...patch})
}
```

From kinetica_bi/src/lib/columnTypes.ts (predicates this plan uses):
```typescript
export type DrillDownDataType = "string" | "number" | "boolean" | "datetime" | "null";

// EXCLUDED_DRILLDOWN_TYPES set: "wkt", "wkb", "bytes", "blob", "text", "point", "geometry", "geography"
export function isColumnDrillDownSafe(colType: string): boolean { ... }

export function inferDataTypeFromColumn(
  colName: string,
  columns: Record<string, string>,
): DrillDownDataType { ... }
```

From kinetica_bi/src/components/charts/ChartConfigPanel.tsx (lines 334-405 — CustomConfigPanel slot):
The Custom panel receives `config`, `columns`, `tables`, `widgets`, `isValid`, and `onChange`. ChartConfigPanel calls `onChange` → diffs → debounce → PATCH /api/widgets/:id. Custom panel does NOT call save directly. When `chartDef.usesDataSource === false`, the parent's Data Source section is suppressed entirely (line 357) — Custom panel must render its own table picker.

</interfaces>

<config_shape>
<!-- The persisted widget.config shape for type='datafilter' -->
```typescript
{
  tableId?: number;                        // selected base table id (used by Plan 44-03 for setBulkFilters dispatch + store subscription)
  tableRef?: string;                       // "schema.name" — used by Plan 44-03 for topValuesFn/columnStatsFn API calls
  filterFields?: Array<{
    column: string;                        // column name on the base table
    kind:
      | "text-eq"        // string column, single value, dispatches operator: "eq"
      | "text-in"        // string column, comma-separated values, dispatches operator: "in"
      | "dropdown"       // string column, single value from /api/top-values, dispatches operator: "eq"
      | "multi-select"   // string column, multi values from /api/top-values, dispatches operator: "in"
      | "number-eq"      // numeric column, single value, dispatches operator: "eq"
      | "number-range"   // numeric column, min/max from /api/column-stats, dispatches operator: "between"
      | "date-eq"        // datetime column, single date, dispatches operator: "eq"
      | "date-range"     // datetime column, from/to, dispatches operator: "between"
      | "boolean-toggle";// boolean column, 3-state Any/True/False
  }>;
}
```

Per-column-type allowed kinds (gated by inferDataTypeFromColumn output):
- `string`  → ["text-eq", "text-in", "dropdown", "multi-select"]
- `number`  → ["number-eq", "number-range"]
- `datetime`→ ["date-eq", "date-range"]
- `boolean` → ["boolean-toggle"]
- `null`    → []  (skip — column metadata missing or untypable; show inline warning)
</config_shape>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create data-filter chart type definition + register in chart-type index</name>
  <read_first>
    - kinetica_bi/src/components/charts/definitions/legend.ts (full file — closest precedent for CustomConfigPanel-bearing definition with usesAggregation:false / usesDataSource semantics)
    - kinetica_bi/src/components/charts/definitions/info-card.ts (full file — second precedent for no-SQL widget; note absence of CustomConfigPanel)
    - kinetica_bi/src/components/charts/definitions/index.ts (full file — current registerAllChartTypes() shape; add the new call alphabetically grouped or last per convention)
    - kinetica_bi/src/components/charts/registry.ts (ChartTypeDefinition type)
    - .planning/phases/44-data-filter-widget/44-CONTEXT.md (Widget shape — confirms type 'datafilter', short-circuit renderer pattern)
  </read_first>
  <files>kinetica_bi/src/components/charts/definitions/data-filter.ts, kinetica_bi/src/components/charts/definitions/index.ts</files>
  <action>
    **Step 1 — Create `kinetica_bi/src/components/charts/definitions/data-filter.ts`** mirroring `legend.ts`:

    ```typescript
    /**
     * v1.7 Phase 44 Plan 02 (FILTER-V17-07): Data Filter chart type registry entry.
     *
     * Mirrors v1.7 Phase 42 legend precedent — CustomConfigPanel + no SQL + no drill-down:
     *   - icon: "DF" (2-char text, matches legend's "LG", info-card's "IC")
     *   - usesAggregation: false (widget runs no SQL — it dispatches into useFilterStore on Apply)
     *   - usesDataSource: false (DataFilterConfigPanel renders its OWN base-table picker; suppresses
     *     ChartConfigPanel's generic Data Source section to avoid a duplicate picker)
     *   - supportsDrillDown: false (widget is the filter source, not a drill-down target)
     *   - defaultConfig: { filterFields: [] } — empty rows on creation; operator adds fields manually
     *
     * Short-circuit renderer wired in Plan 44-03 via:
     *   else if (widget.type === "datafilter") body = <DataFilterRenderer widget={widget} />
     */

    import { registerChartType, type ChartTypeDefinition } from "../registry";
    import DataFilterConfigPanel from "../DataFilterConfigPanel";

    const dataFilter: ChartTypeDefinition = {
      type: "datafilter",
      label: "Data Filter",
      icon: "DF",
      fields: [],
      defaultConfig: {
        filterFields: [], // start with no rows; operator clicks "Add filter field" to add rows
      },
      usesAggregation: false,
      usesDataSource: false, // DataFilterConfigPanel renders its own table picker
      supportsDrillDown: false,
      CustomConfigPanel: DataFilterConfigPanel,
    };

    export default function register() {
      registerChartType(dataFilter);
    }
    ```

    **Step 2 — Wire `registerDataFilter()` into `kinetica_bi/src/components/charts/definitions/index.ts`:**

    Add the import next to `registerLegend` (alphabetical or last-position; mirror file's existing convention):

    ```typescript
    import registerDataFilter from "./data-filter";
    ```

    Add the call inside `registerAllChartTypes()` immediately after `registerLegend();`:

    ```typescript
    registerLegend();
    registerDataFilter();   // Phase 44 Plan 02 (FILTER-V17-07): Data Filter widget
    ```

    **No other definitions modified.** The visualization picker (`DashboardsPage.tsx:1025-1058`) reads from `getAllChartTypes()` — it picks up the new type automatically with no other changes.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/definitions/data-filter.ts` exists
    - `grep -c "type: \"datafilter\"" kinetica_bi/src/components/charts/definitions/data-filter.ts` returns 1
    - `grep -c "usesDataSource: false" kinetica_bi/src/components/charts/definitions/data-filter.ts` returns 1
    - `grep -c "usesAggregation: false" kinetica_bi/src/components/charts/definitions/data-filter.ts` returns 1
    - `grep -c "supportsDrillDown: false" kinetica_bi/src/components/charts/definitions/data-filter.ts` returns 1
    - `grep -c "CustomConfigPanel: DataFilterConfigPanel" kinetica_bi/src/components/charts/definitions/data-filter.ts` returns 1
    - `grep -c "filterFields: \\[\\]" kinetica_bi/src/components/charts/definitions/data-filter.ts` returns 1
    - `grep -c "registerDataFilter" kinetica_bi/src/components/charts/definitions/index.ts` returns at least 2 (import + call)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (note: TS will complain about missing DataFilterConfigPanel import until Task 2 lands; task ordering — execute Task 2 immediately after Task 1 OR temporarily stub the panel as `() => <></>` to keep build green between tasks; the executor should sequence Task 1 → Task 2 in the same plan execution so the TS error window is < 1 commit)
  </acceptance_criteria>
  <done>
    `datafilter` chart type registered in the chart-type registry with `usesDataSource: false`, `usesAggregation: false`, `supportsDrillDown: false`, and `CustomConfigPanel: DataFilterConfigPanel`. The visualization picker modal now lists "Data Filter" as a selectable type.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build DataFilterConfigPanel — base-table picker + N-row filter-field builder</name>
  <read_first>
    - kinetica_bi/src/components/charts/LegendConfigPanel.tsx (FULL file — closest precedent for CustomConfigPanel reading from props.widgets; this plan uses props.tables instead but the pattern is identical)
    - kinetica_bi/src/components/charts/CbConfigForm.tsx (N-row builder precedent — read the row add/remove + per-row controls pattern; the Data Filter form mirrors this shape but with simpler per-row controls)
    - kinetica_bi/src/components/charts/registry.ts (ConfigPanelProps shape — config, onChange, columns, tables, widgets, isValid)
    - kinetica_bi/src/lib/columnTypes.ts (isColumnDrillDownSafe lines 58-61, inferDataTypeFromColumn lines 67-79 — both used to filter the column picker)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (lines 334-450 — CustomConfigPanel slot; understand how onChange propagates to PATCH so the panel does NOT call save directly)
    - .planning/phases/44-data-filter-widget/44-CONTEXT.md (Per-column-type control variants section — locked control kinds per type; Decisions section — base table is operator-chosen; column picker excludes WKT/geometry)
    - .planning/phases/44-data-filter-widget/44-RESEARCH.md (§F CustomConfigPanel patterns + §E column metadata)
  </read_first>
  <files>kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx, kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx</files>
  <behavior>
    Spec file `DataFilterConfigPanel.spec.tsx` covers:
    1. `it("renders an empty base-table picker when config.tableId is undefined")` — render with `tables` prop containing 3 tables; assert `<select>` for table picker shows "Select a base table..." placeholder option AND lists all 3 tables.
    2. `it("calls onChange with {tableId, tableRef, filterFields: []} when operator picks a base table")` — render with `tables`; user-event change the table select; assert `onChange` called once with the expected config object (filterFields reset to []).
    3. `it("clears filterFields when the base table changes")` — render with `config: { tableId: 1, tableRef: 's.t1', filterFields: [{column: 'a', kind: 'text-eq'}] }`; user-event change to table id 2; assert `onChange` called with `filterFields: []` (operator MUST re-pick columns; old column refs would be invalid).
    4. `it("does NOT render the row builder until a base table is selected")` — render with `config: {}`; assert NO 'Add filter field' button present in DOM; assert presence of inline hint "Pick a base table first".
    5. `it("renders an 'Add filter field' button when a base table is selected")` — render with `config: { tableId: 1, tableRef: 's.t1', filterFields: [] }` + a `tables` prop where table id 1 has 3 string columns + 2 numeric columns + 1 WKT column.
    6. `it("clicking 'Add filter field' adds a row with empty column and an empty kind")` — assert `onChange` called with `filterFields: [{ column: '', kind: '' }]` after click.
    7. `it("column picker omits WKT / geometry / large-text columns (isColumnDrillDownSafe)")` — render with table containing 3 normal cols + 1 column of type 'wkt' + 1 of type 'geometry' + 1 of type 'point' + 1 of type 'text'; click 'Add filter field'; assert the column picker `<select>` options DO NOT include any of those four; assert options include all three normal columns.
    8. `it("column picker shows all eligible columns from the selected base table")` — assert option count matches eligible-column count exactly.
    9. `it("kind picker is disabled until a column is picked")` — render row with `{column: '', kind: ''}`; assert kind `<select>` has `disabled` attribute.
    10. `it("kind picker offers numeric kinds (number-eq, number-range) when column is numeric")` — render row with a numeric column; assert kind `<select>` options are exactly `[number-eq, number-range]`.
    11. `it("kind picker offers string kinds (text-eq, text-in, dropdown, multi-select) when column is string")` — similar assertion for string column.
    12. `it("kind picker offers date kinds (date-eq, date-range) when column is datetime")`.
    13. `it("kind picker offers boolean-toggle when column is boolean")`.
    14. `it("clicking Remove on a row removes only that row")` — render config with 3 rows; click row[1]'s remove button; assert `onChange` called with `filterFields` length 2 with row[0] + row[2] preserved.
    15. `it("changing a row's column resets that row's kind to ''")` — defensive: switching column type may invalidate the prior kind.
    16. `it("isValid prop is called with false when filterFields is empty OR any row has empty column/kind")` — covers two cases: empty filterFields list AND a partially-filled row.
    17. `it("isValid prop is called with true when all rows have non-empty column and kind")`.
    18. `it("rows for columns no longer present in the table show an inline 'column missing' warning")` — render config with a row whose column doesn't exist in `tables[tableId].columns`; assert visible warning text "Column 'X' not found on base table".
  </behavior>
  <action>
    **Step 1 — Create `kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx`:**

    ```typescript
    /**
     * v1.7 Phase 44 Plan 02 (FILTER-V17-08..10): CustomConfigPanel for the 'datafilter' chart type.
     *
     * Renders:
     *   1. A base-table picker (reads from props.tables — same dashboard-scoped associatedTables that
     *      ChartConfigPanel uses for its generic Data Source section; we render our own picker because
     *      `usesDataSource: false` on the definition suppresses the parent's section).
     *   2. An N-row "filter fields" builder. Each row has:
     *      - a column picker (column names from the base table, filtered by isColumnDrillDownSafe
     *        to exclude WKT/geometry/large-text)
     *      - a control-kind picker, whose options are scoped to the column's inferred DrillDownDataType
     *
     * NO Apply / Clear / data-fetching here — this is config-only. Plan 44-03 ships DataFilterRenderer
     * which consumes config.filterFields and renders the actual operator-facing controls.
     *
     * onChange contract: the panel calls onChange({...config, ...patch}) on every edit;
     * ChartConfigPanel debounces + PATCHes. The panel never calls save directly.
     *
     * isValid contract: the panel calls props.isValid(false) when ANY row has an empty column
     * or empty kind OR filterFields is empty; props.isValid(true) when every row is complete.
     * ChartConfigPanel uses this to disable the modal's Apply button.
     */

    import { useEffect, useMemo } from "react";
    import type { ConfigPanelProps } from "./registry";
    import { isColumnDrillDownSafe, inferDataTypeFromColumn } from "../../lib/columnTypes";

    export type FilterFieldKind =
      | "text-eq"
      | "text-in"
      | "dropdown"
      | "multi-select"
      | "number-eq"
      | "number-range"
      | "date-eq"
      | "date-range"
      | "boolean-toggle";

    type FilterField = {
      column: string;
      kind: FilterFieldKind | ""; // empty until operator picks both column AND kind
    };

    // Per-column-type allowed kinds (locked in 44-CONTEXT.md "Per-column-type control variants").
    const KINDS_BY_DATA_TYPE: Record<string, { value: FilterFieldKind; label: string }[]> = {
      string: [
        { value: "text-eq", label: "Text input (single value, =)" },
        { value: "text-in", label: "Text input with comma-separated values (IN)" },
        { value: "dropdown", label: "Dropdown (single value from base table)" },
        { value: "multi-select", label: "Multi-select (multi values from base table, IN)" },
      ],
      number: [
        { value: "number-eq", label: "Number input (single value, =)" },
        { value: "number-range", label: "Range (min / max, BETWEEN)" },
      ],
      datetime: [
        { value: "date-eq", label: "Single date (=)" },
        { value: "date-range", label: "Date range (from / to, BETWEEN)" },
      ],
      boolean: [
        { value: "boolean-toggle", label: "3-state toggle (Any / True / False)" },
      ],
    };

    export default function DataFilterConfigPanel({
      config,
      onChange,
      tables,
      isValid,
    }: ConfigPanelProps): JSX.Element {
      const tableId = config.tableId as number | undefined;
      const tableRef = config.tableRef as string | undefined;
      const filterFields = (config.filterFields as FilterField[] | undefined) ?? [];
      const allTables = tables ?? [];

      // Resolve the selected base table (for column picker)
      const selectedTable = useMemo(
        () => (tableId !== undefined ? allTables.find((t) => t.id === tableId) : undefined),
        [tableId, allTables],
      );
      const columns = selectedTable?.columns ?? {};

      // Eligible column names (exclude WKT/geometry/large-text via isColumnDrillDownSafe)
      const eligibleColumnNames = useMemo(
        () =>
          Object.entries(columns)
            .filter(([, type]) => isColumnDrillDownSafe(type))
            .map(([name]) => name),
        [columns],
      );

      // Validity: every row needs both column AND kind; filterFields cannot be empty
      const allRowsValid = useMemo(
        () =>
          filterFields.length > 0 &&
          filterFields.every((f) => f.column !== "" && f.kind !== ""),
        [filterFields],
      );

      useEffect(() => {
        isValid?.(allRowsValid);
      }, [allRowsValid, isValid]);

      // ----- Handlers -----

      const handleTableChange = (newValue: string) => {
        if (newValue === "") {
          // operator cleared selection
          onChange({ ...config, tableId: undefined, tableRef: undefined, filterFields: [] });
          return;
        }
        const newTable = allTables.find((t) => `${t.schema}.${t.name}` === newValue);
        if (!newTable) return;
        // Table change clears filterFields — old column refs may be invalid for new table
        onChange({
          ...config,
          tableId: newTable.id,
          tableRef: `${newTable.schema}.${newTable.name}`,
          filterFields: [], // RESET — operator must re-pick columns
        });
      };

      const handleAddRow = () => {
        onChange({
          ...config,
          filterFields: [...filterFields, { column: "", kind: "" }],
        });
      };

      const handleRemoveRow = (idx: number) => {
        onChange({
          ...config,
          filterFields: filterFields.filter((_, i) => i !== idx),
        });
      };

      const handleColumnChange = (idx: number, newColumn: string) => {
        const next = [...filterFields];
        next[idx] = { column: newColumn, kind: "" }; // reset kind — may not be valid for new column type
        onChange({ ...config, filterFields: next });
      };

      const handleKindChange = (idx: number, newKind: FilterFieldKind) => {
        const next = [...filterFields];
        next[idx] = { ...next[idx], kind: newKind };
        onChange({ ...config, filterFields: next });
      };

      // ----- Render -----

      const baseTableValue = selectedTable ? `${selectedTable.schema}.${selectedTable.name}` : "";

      return (
        <div className="config-group" role="group" aria-labelledby="datafilter-config-label">
          <label id="datafilter-config-label" className="config-group-label">
            DATA FILTER CONFIG
          </label>

          {/* Base-table picker — required first selection */}
          <div className="ds-field">
            <span className="ds-field-label">Base table</span>
            <select
              className="ds-select"
              aria-label="Base table"
              value={baseTableValue}
              onChange={(e) => handleTableChange(e.target.value)}
            >
              <option value="">Select a base table...</option>
              {allTables.map((t) => {
                const full = `${t.schema}.${t.name}`;
                return (
                  <option key={t.id} value={full}>
                    {full}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Row builder — gated on having a selected table */}
          {tableId === undefined ? (
            <div className="config-hint">Pick a base table first.</div>
          ) : (
            <>
              <div className="config-group-label" style={{ marginTop: 16 }}>
                FILTER FIELDS
              </div>

              {filterFields.length === 0 && (
                <div className="config-hint">
                  No filter fields configured. Click "Add filter field" below to add one.
                </div>
              )}

              {filterFields.map((row, idx) => {
                const colType = columns[row.column];
                const dataType = colType
                  ? inferDataTypeFromColumn(row.column, columns)
                  : "null";
                const allowedKinds = KINDS_BY_DATA_TYPE[dataType] ?? [];
                const columnMissing = row.column !== "" && colType === undefined;

                return (
                  <div
                    key={idx}
                    className="datafilter-row"
                    data-testid={`datafilter-row-${idx}`}
                    style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}
                  >
                    {/* Column picker */}
                    <select
                      className="ds-select"
                      aria-label={`Filter field ${idx + 1} column`}
                      value={row.column}
                      onChange={(e) => handleColumnChange(idx, e.target.value)}
                    >
                      <option value="">Pick a column...</option>
                      {eligibleColumnNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    {/* Kind picker — disabled until column picked */}
                    <select
                      className="ds-select"
                      aria-label={`Filter field ${idx + 1} control kind`}
                      value={row.kind}
                      onChange={(e) => handleKindChange(idx, e.target.value as FilterFieldKind)}
                      disabled={row.column === "" || columnMissing}
                    >
                      <option value="">Pick a control...</option>
                      {allowedKinds.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>

                    {/* Remove */}
                    <button
                      type="button"
                      className="ds-button-secondary"
                      aria-label={`Remove filter field ${idx + 1}`}
                      onClick={() => handleRemoveRow(idx)}
                    >
                      Remove
                    </button>

                    {columnMissing && (
                      <span className="config-hint" style={{ color: "#c44" }}>
                        Column '{row.column}' not found on base table
                      </span>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                className="ds-button-secondary"
                aria-label="Add filter field"
                onClick={handleAddRow}
              >
                + Add filter field
              </button>
            </>
          )}
        </div>
      );
    }
    ```

    **Step 2 — Create `kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx`:**

    Use the existing `LegendConfigPanel.spec.tsx` as the structural template (vitest + @testing-library/react + user-event). Each `it` block from `<behavior>` becomes a test. Use this fixture helper:

    ```typescript
    import { render, screen } from "@testing-library/react";
    import userEvent from "@testing-library/user-event";
    import { describe, it, expect, vi } from "vitest";
    import DataFilterConfigPanel from "./DataFilterConfigPanel";

    const makeTables = () => [
      {
        id: 1,
        name: "t1",
        schema: "s",
        columns: {
          region: "varchar",
          fare: "double",
          ts: "timestamp",
          active: "boolean",
          geom: "wkt",          // excluded
          shape: "geometry",    // excluded
          loc: "point",         // excluded
          notes: "text",        // excluded (large-text)
        },
      },
      {
        id: 2,
        name: "t2",
        schema: "s",
        columns: {
          status: "varchar",
          score: "int",
        },
      },
    ];

    const renderPanel = (configOverrides = {}, propsOverrides = {}) => {
      const onChange = vi.fn();
      const isValid = vi.fn();
      const props = {
        config: { ...configOverrides },
        onChange,
        tables: makeTables(),
        isValid,
        ...propsOverrides,
      };
      const utils = render(<DataFilterConfigPanel {...props} />);
      return { ...utils, onChange, isValid };
    };
    ```

    Write all 18 tests listed in `<behavior>` using this helper. For tests that need user interaction (4, 5, 6, 7, 9-13, 14, 15), use `userEvent.setup()` and `user.selectOptions(select, value)` / `user.click(button)`. For onChange assertions, use `expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ... }))`.

    For test 18 (column missing warning), render with `config: { tableId: 1, tableRef: 's.t1', filterFields: [{ column: 'nonexistent', kind: 'text-eq' }] }` and assert `screen.getByText(/Column 'nonexistent' not found on base table/)` is in the document.

    For tests 16 + 17 (isValid), use `expect(isValid).toHaveBeenLastCalledWith(false)` / `toHaveBeenLastCalledWith(true)` after the relevant render or interaction. Account for the initial `useEffect` fire that calls `isValid(false)` on mount with empty filterFields.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/components/charts/DataFilterConfigPanel.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` exists
    - File `kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx` exists
    - `grep -c "export type FilterFieldKind" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns 1
    - `grep -c "isColumnDrillDownSafe" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1 (imported AND called)
    - `grep -c "inferDataTypeFromColumn" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1
    - `grep -c "KINDS_BY_DATA_TYPE" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 2
    - `grep -c "\"number-range\"" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1
    - `grep -c "\"text-in\"" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1
    - `grep -c "\"date-range\"" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1
    - `grep -c "\"boolean-toggle\"" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1
    - `grep -c "filterFields: \\[\\]" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns at least 1 (table change resets rows)
    - `grep -c "isValid?.(allRowsValid)" kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` returns 1
    - `grep -c "it(" kinetica_bi/src/components/charts/DataFilterConfigPanel.spec.tsx` returns at least 18
    - `cd kinetica_bi && npx vitest run src/components/charts/DataFilterConfigPanel.spec.tsx` exits 0 with all 18+ tests passing
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - The visualization picker in `DashboardsPage.tsx:1025-1058` lists "Data Filter" (manual verification by running `getAllChartTypes()` programmatically or via spec — at minimum `import { getAllChartTypes } from './registry'; expect(getAllChartTypes().find(t => t.type === 'datafilter')).toBeDefined();` can be added as a final spec)
  </acceptance_criteria>
  <done>
    `DataFilterConfigPanel.tsx` exists as a CustomConfigPanel that renders a base-table picker and an N-row filter-field builder. The column picker excludes WKT/geometry/large-text via `isColumnDrillDownSafe`. The kind picker is scoped to the picked column's inferred type (string → 4 kinds; numeric → 2 kinds; datetime → 2 kinds; boolean → 1 kind). `isValid` callback signals form completeness. Config persists shape `{ tableId, tableRef, filterFields: [{column, kind}] }`. 18+ spec tests pass; tsc clean.
  </done>
</task>

</tasks>

<verification>
**Phase-44 Plan 02 verification:**

```bash
cd kinetica_bi
npx tsc --noEmit
npx vitest run src/components/charts/DataFilterConfigPanel.spec.tsx
npx vitest run src/components/charts/ChartConfigPanel.spec.tsx        # regression — CustomConfigPanel slot still works
npx vitest run src/components/DashboardsPage.spec.tsx                  # regression — visualization picker doesn't crash
```

**Must-haves verification:**
- `grep -c "registerDataFilter" kinetica_bi/src/components/charts/definitions/index.ts` returns ≥2
- File `kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx` exists
- File `kinetica_bi/src/components/charts/definitions/data-filter.ts` exists
- WKT exclusion: spec test 7 passes
- Persisted config shape: spec tests 2 + 3 + 5 + 6 + 14 prove `{tableId, tableRef, filterFields}` is the persisted shape
</verification>

<success_criteria>
- New chart type `datafilter` registered and listed in the visualization picker
- `DataFilterConfigPanel` ships with 18+ passing spec tests
- ChartConfigPanel's existing `CustomConfigPanel` slot mechanism handles the new panel unchanged
- `usesDataSource: false` correctly suppresses the parent's generic Data Source section (visually verified — no duplicate table picker)
- WKT/geometry/large-text columns NEVER appear in the column picker (spec test 7)
- Frontend `npx tsc --noEmit` clean
- No source file outside this plan's `files_modified` was modified
</success_criteria>

<output>
After completion, create `.planning/phases/44-data-filter-widget/44-02-SUMMARY.md` documenting:
- Final `datafilter` ChartTypeDefinition shape (usesDataSource:false, CustomConfigPanel:DataFilterConfigPanel)
- Final config shape: `{ tableId, tableRef, filterFields: Array<{column, kind}> }`
- Per-column-type kind mapping (KINDS_BY_DATA_TYPE table)
- WKT/geometry exclusion path used (isColumnDrillDownSafe)
- isValid signaling behavior (when false / true)
- Any test fixtures or patterns added (makeTables helper, renderPanel helper) that 44-03's renderer spec might reuse
- Note for Plan 44-03: `widget.config` reads from this panel's output — no runtime mutation of the panel's output by the renderer
</output>
