---
phase: 44-data-filter-widget
plan: 03
type: execute
wave: 2
depends_on: [44-01]
files_modified:
  - kinetica_bi/src/components/charts/DataFilterRenderer.tsx
  - kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
autonomous: true
requirements:
  - FILTER-V17-11   # DataFilterRenderer.tsx renders per-kind controls bound to widget.config.filterFields
  - FILTER-V17-12   # Apply button batches stagedValues into setBulkFilters(tableId, [...]) — single materialize cycle
  - FILTER-V17-13   # Clear button calls clearFilters(tableId) — widget-scoped reset of this widget's columns
  - FILTER-V17-14   # Renderer subscribes to useFilterStore.filters[tableId] for chip-dismissal sync (controls reflect external removeFilter)
  - FILTER-V17-15   # markMaterializing called synchronously after setBulkFilters dispatch (mirrors dispatchDrillDown:127-128 pattern)
  - FILTER-V17-16   # WidgetRenderer short-circuits widget.type === "datafilter" → <DataFilterRenderer /> BEFORE AggregatedWidgetRenderer
  - FILTER-V17-17   # Sole-materialize-trigger invariant preserved: DataFilterRenderer NEVER calls materializeFilter directly

must_haves:
  truths:
    - "The Data Filter widget renders N control rows from widget.config.filterFields"
    - "Each control variant maps to its locked operator: text-eq → eq; text-in/dropdown/multi-select → eq or in; number-range → between; date-range → between; boolean-toggle → eq (or skip on Any)"
    - "Pressing Apply dispatches setBulkFilters once with the staged values; filterVersion ticks by exactly 1; downstream widgets re-query via the existing materialize pipeline"
    - "Pressing Clear removes only THIS widget's columns from useFilterStore.filters[tableId] (widget-scoped reset)"
    - "Dismissing a chip externally (filter-bar × button) re-renders the widget's controls so the corresponding field reads as 'not applied'"
    - "Empty multi-select / IN field is SKIPPED at Apply time (never dispatches operator: 'in' with empty array)"
    - "Boolean-toggle in 'Any' state SKIPS that column (never dispatches a filter)"
    - "DataFilterRenderer never calls materializeFilter directly — sole-trigger invariant from Phase 15 / Phase 30 preserved"
    - "Drill-down click on a Bar chart still works end-to-end after this plan (no regression to existing 6 dispatchDrillDown call sites)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/DataFilterRenderer.tsx"
      provides: "Short-circuit renderer for type='datafilter' — per-kind controls + Apply/Clear buttons + topValues/columnStats fetch on mount"
      min_lines: 200
    - path: "kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx"
      provides: "Unit coverage for per-kind controls + Apply dispatch + Clear + empty-IN skip + chip-dismissal sync"
      min_lines: 150
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "Short-circuit branch added for widget.type === 'datafilter'"
      contains: "widget.type === \"datafilter\""
  key_links:
    - from: "kinetica_bi/src/components/charts/DataFilterRenderer.tsx (Apply)"
      to: "kinetica_bi/src/store/filterStore.ts (setBulkFilters)"
      via: "single useFilterStore.getState().setBulkFilters(tableId, batch) call"
      pattern: "setBulkFilters\\(tableId"
    - from: "kinetica_bi/src/components/charts/DataFilterRenderer.tsx (mount)"
      to: "kinetica_bi/src/api/client.ts (topValuesFn / columnStatsFn)"
      via: "useEffect with AbortController against base table"
      pattern: "(topValuesFn|columnStatsFn)"
    - from: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      to: "kinetica_bi/src/components/charts/DataFilterRenderer.tsx"
      via: "else-if branch BEFORE AggregatedWidgetRenderer fallback"
      pattern: "widget\\.type === \"datafilter\""
    - from: "kinetica_bi/src/components/charts/DataFilterRenderer.tsx (Apply)"
      to: "kinetica_bi/src/store/filterViewStore.ts (markMaterializing)"
      via: "synchronous markMaterializing call right after setBulkFilters — mirrors dispatchDrillDown:127-128"
      pattern: "markMaterializing\\(tableId, dashboardId\\)"
---

<objective>
Ship the Data Filter widget's runtime — the renderer that consumes `widget.config.filterFields` from Plan 44-02 and dispatches into the `useFilterStore.setBulkFilters` action from Plan 44-01. After this plan, the widget is end-to-end functional: pick base table → configure fields → Apply → other widgets on the same table re-query through the existing materialized-view pipeline.

Critical invariants enforced:
- **Sole materialize trigger preserved.** The renderer dispatches into `useFilterStore` and lets `AggregatedWidgetRenderer` Effect 1 fire materialize. It NEVER calls `materializeFilter` directly.
- **Drill-down back-compat preserved.** The 6 existing `dispatchDrillDown` call sites (Bar, Line, Pie, Scatter, Table, RecordsTable) continue to construct `ActiveFilter` literals without `operator` — they get `"eq"` by default.
- **Empty IN never reaches the WHERE builder.** The widget skips empty multi-select / IN-text fields before dispatching.
- **markMaterializing called synchronously.** Mirrors `dispatchDrillDown:127-128` so Effect 2's suspend gate engages immediately.

Purpose: Close the end-to-end pipeline. Widget config (Plan 02) + store/where extensions (Plan 01) come together here.

Output:
- `DataFilterRenderer.tsx` — per-kind controls + staged state + Apply/Clear + mount-time value-universe fetch + chip-dismissal sync.
- `DataFilterRenderer.spec.tsx` — coverage for every control kind + Apply/Clear dispatch + empty-IN skip + chip-dismissal regression.
- `WidgetRenderer.tsx` — short-circuit branch.
- `WidgetRenderer.spec.tsx` — drill-down regression for existing call sites + new short-circuit branch coverage.
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

<!-- Sibling plans this depends on or shares contracts with -->
@.planning/phases/44-data-filter-widget/44-01-store-and-where-builder-foundation-PLAN.md
@.planning/phases/44-data-filter-widget/44-02-widget-definition-and-config-panel-PLAN.md

<!-- Source files this plan modifies or creates -->
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/components/charts/LegendRenderer.tsx
@kinetica_bi/src/components/charts/InfoCardRenderer.tsx
@kinetica_bi/src/store/filterStore.ts
@kinetica_bi/src/store/filterViewStore.ts
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/lib/columnTypes.ts

<interfaces>
<!-- Verbatim contracts — executor uses these, does not re-research -->

From kinetica_bi/src/store/filterStore.ts (AFTER Plan 44-01 lands):
```typescript
export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null
       | (string | number)[]
       | [number, number]
       | [string, string];
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  operator?: "eq" | "in" | "between" | "isNull";
  sourceWidgetId?: number;
  addedAt: number;
};

export const FILTER_CAP_PER_TABLE = 25;

// New action signature (Plan 44-01):
setBulkFilters: (tableId: number, filters: ActiveFilter[]) => void;
// - Replaces entries for columns in `filters`; preserves entries for OTHER columns
// - Bumps filterVersion by exactly 1
// - Respects 25-cap; shows toast and truncates batch if exceeded
```

From kinetica_bi/src/api/client.ts (lines 1090-1146 — exact signatures):
```typescript
export type TopValuesArgs = { schema: string; table: string; column: string; n: number };
export type TopValuesResponse = { values: string[] };
export const topValuesFn: (args: TopValuesArgs, signal?: AbortSignal) => Promise<TopValuesResponse>;

export type ColumnStatsArgs = { schema: string; table: string; column: string };
export type ColumnStatsResponse = { min: number; max: number; mean: number; stddev: number };
export const columnStatsFn: (args: ColumnStatsArgs, signal?: AbortSignal) => Promise<ColumnStatsResponse>;
```

From kinetica_bi/src/components/charts/DataFilterConfigPanel.tsx (Plan 44-02 export):
```typescript
export type FilterFieldKind =
  | "text-eq" | "text-in" | "dropdown" | "multi-select"
  | "number-eq" | "number-range"
  | "date-eq" | "date-range"
  | "boolean-toggle";

// widget.config shape produced by the config panel:
// {
//   tableId: number;
//   tableRef: string;           // "schema.name"
//   filterFields: Array<{ column: string; kind: FilterFieldKind }>;
// }
```

From kinetica_bi/src/components/charts/WidgetRenderer.tsx (CURRENT short-circuit pattern, lines 234-250 — copy this shape):
```typescript
let body: ReactElement;
if (widget.type === "map") {
  body = <MapChartRenderer widget={widget} tables={tables} />;
} else if (widget.type === "records") {
  body = <RecordsTableRenderer widget={widget} />;
} else if (widget.type === "info-card") {
  body = <InfoCardRenderer widget={widget} tables={tables} />;
} else if (widget.type === "legend") {
  body = <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />;
} else {
  body = <AggregatedWidgetRenderer widget={widget} />;
}
```

From kinetica_bi/src/components/charts/WidgetRenderer.tsx (dispatchDrillDown — lines 87-129, mirror the markMaterializing pattern for the Apply handler):
```typescript
// Phase 17-03 lock: markMaterializing fires SYNCHRONOUSLY with the dispatch.
// Mirror this exactly in DataFilterRenderer's Apply handler.
useFilterStore.getState().addFilter(tableId, { ... });
useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
```

From kinetica_bi/src/components/charts/LegendRenderer.tsx (DashboardContext pattern — copy this for accessing dashboardId):
```typescript
import { useDashboardContext } from "../DashboardContext";
const { widgets } = useDashboardContext();
// DashboardContext also exposes dashboardId — DataFilterRenderer reads it for markMaterializing
```
</interfaces>

<kind_to_operator_mapping>
Locked mapping from `FilterFieldKind` to dispatched `ActiveFilter`:

| kind | dataType | operator | value shape | empty/Any handling |
|------|----------|----------|-------------|--------------------|
| text-eq | "string" | "eq" | string | empty string → SKIP field |
| text-in | "string" | "in" | (string)[] | parse comma-separated; empty array → SKIP |
| dropdown | "string" | "eq" | string | empty string / placeholder → SKIP |
| multi-select | "string" | "in" | (string)[] | empty array → SKIP |
| number-eq | "number" | "eq" | number | NaN / empty → SKIP |
| number-range | "number" | "between" | [number, number] | either bound missing → SKIP |
| date-eq | "datetime" | "eq" | string (ISO yyyy-mm-dd) | empty → SKIP |
| date-range | "datetime" | "between" | [string, string] | either bound missing → SKIP |
| boolean-toggle | "boolean" | "eq" | true / false | "Any" → SKIP |
</kind_to_operator_mapping>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build DataFilterRenderer — per-kind controls + Apply/Clear + mount-time value-universe fetch + chip-dismissal sync</name>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (dispatchDrillDown lines 87-129 — markMaterializing-after-dispatch pattern to mirror; AggregatedWidgetRenderer Effect 1 ~line 410 — to confirm filterVersion is the trigger)
    - kinetica_bi/src/components/charts/LegendRenderer.tsx (full file — short-circuit renderer pattern with useDashboardContext and primitive selector)
    - kinetica_bi/src/components/charts/InfoCardRenderer.tsx (read mount-time API fetch pattern + AbortController)
    - kinetica_bi/src/components/charts/CbConfigForm.tsx (per-row controls pattern + topValuesFn / columnStatsFn fetch with AbortController — closest precedent for the value-universe API pattern; Phase 39 work)
    - kinetica_bi/src/store/filterStore.ts (AFTER Plan 44-01 lands — ActiveFilter type with operator + setBulkFilters)
    - kinetica_bi/src/store/filterViewStore.ts (markMaterializing signature)
    - kinetica_bi/src/components/DashboardContext.tsx (useDashboardContext exposes widgets AND dashboardId? confirm via grep; DataFilterRenderer needs both)
    - kinetica_bi/src/api/client.ts lines 1090-1146 (topValuesFn + columnStatsFn signatures)
    - .planning/phases/44-data-filter-widget/44-CONTEXT.md (Apply behavior + Reset/Clear sections + Edge-case resolutions for empty IN)
    - .planning/phases/44-data-filter-widget/44-RESEARCH.md (§G Widget Rendering Lifecycle, §C Effect-1 Trigger Sequencing, §D Chip Dismissal + Widget Control Sync, Risk 2 Empty IN, Risk 5 markMaterializing)
  </read_first>
  <files>kinetica_bi/src/components/charts/DataFilterRenderer.tsx, kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx</files>
  <behavior>
    DataFilterRenderer.spec.tsx covers:
    1. `it("renders empty-state message when widget.config.filterFields is empty")` — render widget with `{ config: { tableId: 1, tableRef: 's.t', filterFields: [] } }`; assert "No filter fields configured" hint visible AND no Apply/Clear buttons rendered.
    2. `it("renders empty-state when tableId is missing")` — render with `{ config: { filterFields: [{column:'a', kind:'text-eq'}] } }` (no tableId); assert "Widget not yet configured" hint visible.
    3. `it("renders a text input for text-eq kind")` — single field `{column:'region', kind:'text-eq'}`; assert `<input type="text">` with `aria-label="region"` present.
    4. `it("renders a comma-separated text input for text-in kind")` — placeholder text mentions "comma-separated values"; aria-label includes column name.
    5. `it("renders a select for dropdown kind populated from topValuesFn response")` — mock `topValuesFn` to return `{values:['A','B','C']}`; render with `{column:'region', kind:'dropdown'}`; assert select has options [placeholder, A, B, C].
    6. `it("renders a multi-select for multi-select kind populated from topValuesFn response")` — same mock; assert checkbox-list or `<select multiple>` with 3 options.
    7. `it("renders a number input for number-eq kind")` — assert `<input type="number">`.
    8. `it("renders two number inputs for number-range kind labeled 'min' and 'max', initial values from columnStatsFn")` — mock `columnStatsFn` to return `{min:5, max:50, mean:27, stddev:10}`; assert min input has value 5 and max input has value 50 after mount-fetch resolves.
    9. `it("renders a date input for date-eq kind")` — assert `<input type="date">`.
    10. `it("renders two date inputs for date-range kind")`.
    11. `it("renders a 3-state toggle (Any / True / False) for boolean-toggle kind")` — assert three buttons or a tri-state control; initial state is "Any".
    12. `it("Apply button dispatches setBulkFilters with one ActiveFilter per non-skipped field")` — render 3 fields (text-eq filled with 'EAST', multi-select with ['X','Y'], boolean-toggle on True); click Apply; spy on `useFilterStore.getState().setBulkFilters` and assert it called once with `(tableId, [...3 filters with correct operators...])`:
      - `{column:'region', value:'EAST', dataType:'string', operator:'eq', addedAt:expect.any(Number), sourceWidgetId:widget.id}`
      - `{column:'status', value:['X','Y'], dataType:'string', operator:'in', addedAt:expect.any(Number), sourceWidgetId:widget.id}`
      - `{column:'active', value:true, dataType:'boolean', operator:'eq', addedAt:expect.any(Number), sourceWidgetId:widget.id}`
    13. `it("Apply SKIPS text-eq field with empty string value")` — render text-eq field empty + dropdown filled; click Apply; assert setBulkFilters called with only 1 filter (the dropdown's).
    14. `it("Apply SKIPS multi-select with empty array")` — multi-select unchecked + text-eq filled; assert only text-eq filter dispatched (CRITICAL: empty IN MUST NEVER reach the WHERE builder).
    15. `it("Apply SKIPS number-range with missing bound")` — only min filled; Apply; assert this field skipped.
    16. `it("Apply SKIPS boolean-toggle in 'Any' state")` — toggle never touched; Apply; assert boolean column NOT in dispatched batch.
    17. `it("Apply calls markMaterializing AFTER setBulkFilters synchronously")` — spy on both; assert call order: setBulkFilters before markMaterializing within the same synchronous click handler.
    18. `it("Clear button calls clearFilters(tableId) and resets staged values to defaults")` — pre-apply some filters; click Clear; assert `useFilterStore.getState().clearFilters` called with `tableId`; assert staged values reset (e.g., dropdown shows placeholder again).
    19. `it("externally removing a filter via removeFilter syncs the control to 'not applied' state")` — render with a staged + applied dropdown showing 'EAST'; externally call `useFilterStore.getState().removeFilter(tableId, 'region')`; assert the dropdown control no longer shows "applied" badge / indicator (control reflects store state).
    20. `it("mount fetches topValuesFn for dropdown and multi-select fields, columnStatsFn for number-range fields")` — render widget with one of each; assert topValuesFn called twice (one per dropdown + multi-select) AND columnStatsFn called once.
    21. `it("mount-time API fetches are aborted on unmount")` — mock topValuesFn to capture the signal; render + unmount; assert `signal.aborted === true` after unmount.
    22. `it("does NOT call materializeFilter directly anywhere in the component (sole-trigger invariant)")` — `grep`-based: file MUST NOT import `materializeFilter` from `../../api/client`. Spec asserts via static check (read source file content and assert).
    23. `it("renders a warning row for a configured column that no longer exists on the base table")` — config has filterFields with a column not in tables[tableId].columns; assert inline warning visible AND that field is skipped from dispatch.
  </behavior>
  <action>
    **Create `kinetica_bi/src/components/charts/DataFilterRenderer.tsx`** with the following structure (all helper functions live INSIDE this file unless reused; keep the surface area concentrated):

    ```typescript
    /**
     * v1.7 Phase 44 Plan 03 (FILTER-V17-11..17): Data Filter widget renderer.
     *
     * Short-circuits BEFORE AggregatedWidgetRenderer in WidgetRenderer.tsx. Owns its full lifecycle:
     *   - On mount: fetches value universes (topValuesFn for dropdown/multi-select, columnStatsFn
     *     for number-range) with AbortController cleanup; refs base table (NOT filter view —
     *     value universes stay stable as the operator filters; not cascading per CONTEXT.md).
     *   - Subscribes to useFilterStore.filters[tableId] so external chip dismissals (filter-bar ×)
     *     re-render the controls to reflect "not applied" state.
     *   - Stages all control values in local useState; never auto-applies.
     *   - Apply: builds ActiveFilter[] from staged values (skipping empty/Any fields),
     *     dispatches via setBulkFilters (ONE filterVersion tick) + synchronous markMaterializing.
     *   - Clear: calls clearFilters(tableId) (widget-scoped reset) + resets staged values.
     *
     * SOLE MATERIALIZE TRIGGER INVARIANT (Phase 15 / Phase 30 lock):
     *   Never imports materializeFilter from client.ts. Effect 1 in AggregatedWidgetRenderer fires
     *   materialize off the filterVersion tick driven by setBulkFilters.
     */

    import { useEffect, useMemo, useRef, useState } from "react";
    import type { WidgetDto } from "../../api/client";
    import { topValuesFn, columnStatsFn } from "../../api/client";
    import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
    import { useFilterViewStore } from "../../store/filterViewStore";
    import { useDashboardContext } from "../DashboardContext";
    import { inferDataTypeFromColumn } from "../../lib/columnTypes";
    import type { FilterFieldKind } from "./DataFilterConfigPanel";

    type Props = { widget: WidgetDto };

    type FilterField = { column: string; kind: FilterFieldKind };

    // Staged-value shape per kind:
    //   text-eq / dropdown / date-eq            → string
    //   text-in / multi-select                  → string[]
    //   number-eq                               → string (raw input — parsed to Number at Apply)
    //   number-range                            → { min: string, max: string }
    //   date-range                              → { from: string, to: string }
    //   boolean-toggle                          → "any" | "true" | "false"
    type StagedValue =
      | string
      | string[]
      | { min: string; max: string }
      | { from: string; to: string }
      | "any" | "true" | "false";

    type StagedValues = Record<number, StagedValue>; // keyed by filterFields index

    function defaultStagedFor(kind: FilterFieldKind): StagedValue {
      switch (kind) {
        case "text-eq":
        case "dropdown":
        case "date-eq":
        case "number-eq":
          return "";
        case "text-in":
        case "multi-select":
          return [];
        case "number-range":
          return { min: "", max: "" };
        case "date-range":
          return { from: "", to: "" };
        case "boolean-toggle":
          return "any";
      }
    }

    export default function DataFilterRenderer({ widget }: Props): JSX.Element {
      const cfg = widget.config ?? {};
      const tableId = cfg.tableId as number | undefined;
      const tableRef = cfg.tableRef as string | undefined;
      const filterFields = (cfg.filterFields as FilterField[] | undefined) ?? [];

      const { dashboardId, tables } = useDashboardContext();

      // Resolve base table — needed for columns map (inferDataTypeFromColumn)
      const baseTable = useMemo(
        () => (tableId !== undefined ? tables.find((t) => t.id === tableId) : undefined),
        [tableId, tables],
      );
      const columns = baseTable?.columns ?? {};

      // Parse "schema.name" tableRef into separate schema + table for API calls
      const [schemaName, baseTableName] = (tableRef ?? ".").split(".");

      // ----- Empty-state gates -----
      if (tableId === undefined || tableRef === undefined) {
        return (
          <div className="widget-datafilter widget-datafilter--empty">
            <div className="config-hint">Widget not yet configured. Open the config panel to pick a base table and add filter fields.</div>
          </div>
        );
      }
      if (filterFields.length === 0) {
        return (
          <div className="widget-datafilter widget-datafilter--empty">
            <div className="config-hint">No filter fields configured. Open the config panel to add fields.</div>
          </div>
        );
      }

      // ----- Subscriptions -----

      // External chip-dismissal sync: subscribe to filters[tableId] so removing a chip externally
      // re-renders the controls. PITFALL C-02 lock — scoped selector (not whole map).
      const tableFilters = useFilterStore((s) => s.filters[tableId] ?? []);

      // ----- Staged state -----

      const [staged, setStaged] = useState<StagedValues>(() => {
        const init: StagedValues = {};
        filterFields.forEach((f, idx) => {
          init[idx] = defaultStagedFor(f.kind);
        });
        return init;
      });

      // Value universes (mount-time fetch)
      const [topValues, setTopValues] = useState<Record<number, string[]>>({});
      const [columnStats, setColumnStats] = useState<Record<number, { min: number; max: number }>>({});
      const [universeLoading, setUniverseLoading] = useState(true);
      const [universeError, setUniverseError] = useState<string | null>(null);

      useEffect(() => {
        const ctrl = new AbortController();
        const signal = ctrl.signal;
        let cancelled = false;

        async function fetchUniverses() {
          if (!schemaName || !baseTableName) {
            setUniverseLoading(false);
            return;
          }
          const topPromises: Promise<void>[] = [];
          const statsPromises: Promise<void>[] = [];

          filterFields.forEach((f, idx) => {
            if (columns[f.column] === undefined) return; // column missing — skip universe fetch
            if (f.kind === "dropdown" || f.kind === "multi-select") {
              topPromises.push(
                topValuesFn(
                  { schema: schemaName, table: baseTableName, column: f.column, n: 1000 },
                  signal,
                ).then((r) => {
                  if (!cancelled) setTopValues((prev) => ({ ...prev, [idx]: r.values }));
                }),
              );
            } else if (f.kind === "number-range") {
              statsPromises.push(
                columnStatsFn(
                  { schema: schemaName, table: baseTableName, column: f.column },
                  signal,
                ).then((r) => {
                  if (!cancelled) {
                    setColumnStats((prev) => ({ ...prev, [idx]: { min: r.min, max: r.max } }));
                    // Initialize the staged min/max from server stats
                    setStaged((prev) => ({
                      ...prev,
                      [idx]: { min: String(r.min), max: String(r.max) },
                    }));
                  }
                }),
              );
            }
          });

          try {
            await Promise.all([...topPromises, ...statsPromises]);
            if (!cancelled) setUniverseLoading(false);
          } catch (err) {
            if (!cancelled && (err as Error).name !== "AbortError") {
              setUniverseError((err as Error).message);
              setUniverseLoading(false);
            }
          }
        }

        fetchUniverses();

        return () => {
          cancelled = true;
          ctrl.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [schemaName, baseTableName, JSON.stringify(filterFields.map((f) => `${f.column}:${f.kind}`))]);

      // ----- Per-field "is applied in store" computation (for visual indicator) -----

      const appliedColumns = useMemo(
        () => new Set(tableFilters.map((f) => f.column)),
        [tableFilters],
      );

      // ----- Apply handler -----

      const handleApply = () => {
        const batch: ActiveFilter[] = [];

        filterFields.forEach((f, idx) => {
          const colType = columns[f.column];
          if (colType === undefined) return; // column missing — skip
          const dataType = inferDataTypeFromColumn(f.column, columns);
          const v = staged[idx];
          const base = {
            column: f.column,
            sourceWidgetId: widget.id,
            addedAt: Date.now(),
          };

          switch (f.kind) {
            case "text-eq":
            case "dropdown": {
              const s = typeof v === "string" ? v : "";
              if (s === "") return; // skip empty
              batch.push({ ...base, value: s, dataType: "string", operator: "eq" });
              break;
            }
            case "text-in": {
              // Parse comma-separated string OR accept already-parsed array
              let arr: string[] = [];
              if (Array.isArray(v)) arr = v;
              else if (typeof v === "string") arr = v.split(",").map((s) => s.trim()).filter(Boolean);
              if (arr.length === 0) return; // empty IN — SKIP (locked decision; never reaches WHERE builder)
              batch.push({ ...base, value: arr, dataType: "string", operator: "in" });
              break;
            }
            case "multi-select": {
              const arr = Array.isArray(v) ? v : [];
              if (arr.length === 0) return; // empty IN — SKIP
              batch.push({ ...base, value: arr, dataType: "string", operator: "in" });
              break;
            }
            case "number-eq": {
              const s = typeof v === "string" ? v : "";
              const n = Number(s);
              if (s === "" || !Number.isFinite(n)) return;
              batch.push({ ...base, value: n, dataType: "number", operator: "eq" });
              break;
            }
            case "number-range": {
              const t = typeof v === "object" && v !== null && "min" in v ? v : { min: "", max: "" };
              const lo = Number(t.min);
              const hi = Number(t.max);
              if (t.min === "" || t.max === "" || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
              batch.push({ ...base, value: [lo, hi], dataType: "number", operator: "between" });
              break;
            }
            case "date-eq": {
              const s = typeof v === "string" ? v : "";
              if (s === "") return;
              batch.push({ ...base, value: s, dataType: "datetime", operator: "eq" });
              break;
            }
            case "date-range": {
              const t = typeof v === "object" && v !== null && "from" in v ? v : { from: "", to: "" };
              if (t.from === "" || t.to === "") return;
              batch.push({ ...base, value: [t.from, t.to], dataType: "datetime", operator: "between" });
              break;
            }
            case "boolean-toggle": {
              if (v === "any" || v === undefined) return;
              if (v === "true") batch.push({ ...base, value: true, dataType: "boolean", operator: "eq" });
              if (v === "false") batch.push({ ...base, value: false, dataType: "boolean", operator: "eq" });
              break;
            }
          }
        });

        // Dispatch — single filterVersion tick (Plan 44-01 setBulkFilters)
        useFilterStore.getState().setBulkFilters(tableId, batch);

        // Mirror dispatchDrillDown:127-128 — synchronous markMaterializing so Effect 2 suspend gates engage
        useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
      };

      const handleClear = () => {
        // Widget-scoped reset: only this table's filters cleared (other tables untouched).
        // CONTEXT.md operator-locked: drill-down chips from this same tableId WILL be cleared too —
        // intentional since chips and Data Filter both contribute to filters[tableId]; if the operator
        // wants finer reset, they can dismiss individual chips.
        useFilterStore.getState().clearFilters(tableId);
        // Also reset staged values
        const reset: StagedValues = {};
        filterFields.forEach((f, idx) => {
          reset[idx] = defaultStagedFor(f.kind);
        });
        setStaged(reset);
      };

      // ----- Render -----

      return (
        <div className="widget-datafilter" data-testid="datafilter-renderer">
          {universeError && (
            <div className="config-hint" style={{ color: "#c44" }}>
              Failed to load value universes: {universeError}
            </div>
          )}

          {filterFields.map((f, idx) => {
            const colType = columns[f.column];
            if (colType === undefined) {
              return (
                <div key={idx} className="datafilter-field datafilter-field--missing" data-testid={`datafilter-field-${idx}`}>
                  <span style={{ color: "#c44" }}>
                    Column '{f.column}' not found on base table — skipped
                  </span>
                </div>
              );
            }
            const isApplied = appliedColumns.has(f.column);

            return (
              <div key={idx} className="datafilter-field" data-testid={`datafilter-field-${idx}`}>
                <label className="ds-field-label">
                  {f.column}
                  {isApplied && <span className="datafilter-applied-badge" aria-label="applied"> ●</span>}
                </label>
                {renderControl(f, idx, staged, setStaged, topValues[idx] ?? [], universeLoading)}
              </div>
            );
          })}

          <div className="datafilter-actions" style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="ds-button-primary"
              onClick={handleApply}
              aria-label="Apply"
              data-testid="datafilter-apply"
            >
              Apply
            </button>
            <button
              type="button"
              className="ds-button-secondary"
              onClick={handleClear}
              aria-label="Clear"
              data-testid="datafilter-clear"
            >
              Clear
            </button>
          </div>
        </div>
      );
    }

    // Per-kind control renderer — single function, switch on kind
    function renderControl(
      field: FilterField,
      idx: number,
      staged: StagedValues,
      setStaged: (updater: (prev: StagedValues) => StagedValues) => void,
      topValues: string[],
      universeLoading: boolean,
    ): JSX.Element {
      const v = staged[idx];
      const set = (patch: StagedValue) => setStaged((prev) => ({ ...prev, [idx]: patch }));

      switch (field.kind) {
        case "text-eq":
          return (
            <input
              type="text"
              className="ds-input"
              aria-label={field.column}
              value={typeof v === "string" ? v : ""}
              onChange={(e) => set(e.target.value)}
            />
          );
        case "text-in":
          return (
            <input
              type="text"
              className="ds-input"
              aria-label={`${field.column} (comma-separated values)`}
              placeholder="value1, value2, value3"
              value={typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : ""}
              onChange={(e) => set(e.target.value)}
            />
          );
        case "dropdown":
          return (
            <select
              className="ds-select"
              aria-label={field.column}
              disabled={universeLoading}
              value={typeof v === "string" ? v : ""}
              onChange={(e) => set(e.target.value)}
            >
              <option value="">— any —</option>
              {topValues.map((val) => (
                <option key={val} value={val}>
                  {val}
                </option>
              ))}
            </select>
          );
        case "multi-select": {
          const selected = Array.isArray(v) ? v : [];
          return (
            <div className="datafilter-multiselect" role="group" aria-label={field.column}>
              {topValues.map((val) => {
                const checked = selected.includes(val);
                return (
                  <label key={val} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`${field.column}: ${val}`}
                      onChange={(e) => {
                        if (e.target.checked) set([...selected, val]);
                        else set(selected.filter((x) => x !== val));
                      }}
                    />
                    {" " + val}
                  </label>
                );
              })}
            </div>
          );
        }
        case "number-eq":
          return (
            <input
              type="number"
              className="ds-input"
              aria-label={field.column}
              value={typeof v === "string" ? v : ""}
              onChange={(e) => set(e.target.value)}
            />
          );
        case "number-range": {
          const t = typeof v === "object" && v !== null && "min" in v ? v : { min: "", max: "" };
          return (
            <div className="datafilter-range" role="group" aria-label={`${field.column} range`}>
              <input
                type="number"
                className="ds-input"
                aria-label={`${field.column} min`}
                value={t.min}
                onChange={(e) => set({ ...t, min: e.target.value })}
              />
              <span> to </span>
              <input
                type="number"
                className="ds-input"
                aria-label={`${field.column} max`}
                value={t.max}
                onChange={(e) => set({ ...t, max: e.target.value })}
              />
            </div>
          );
        }
        case "date-eq":
          return (
            <input
              type="date"
              className="ds-input"
              aria-label={field.column}
              value={typeof v === "string" ? v : ""}
              onChange={(e) => set(e.target.value)}
            />
          );
        case "date-range": {
          const t = typeof v === "object" && v !== null && "from" in v ? v : { from: "", to: "" };
          return (
            <div className="datafilter-daterange" role="group" aria-label={`${field.column} date range`}>
              <input
                type="date"
                className="ds-input"
                aria-label={`${field.column} from`}
                value={t.from}
                onChange={(e) => set({ ...t, from: e.target.value })}
              />
              <span> to </span>
              <input
                type="date"
                className="ds-input"
                aria-label={`${field.column} to`}
                value={t.to}
                onChange={(e) => set({ ...t, to: e.target.value })}
              />
            </div>
          );
        }
        case "boolean-toggle": {
          const state = v === "true" || v === "false" || v === "any" ? v : "any";
          return (
            <div className="datafilter-tristate" role="radiogroup" aria-label={field.column}>
              {(["any", "true", "false"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={state === opt}
                  aria-label={`${field.column}: ${opt}`}
                  onClick={() => set(opt)}
                  className={state === opt ? "ds-button-primary" : "ds-button-secondary"}
                >
                  {opt === "any" ? "Any" : opt === "true" ? "True" : "False"}
                </button>
              ))}
            </div>
          );
        }
      }
    }
    ```

    **Create `kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx`** mirroring the InfoCardRenderer.spec.tsx / LegendRenderer.spec.tsx structure. The 23 `it` blocks above. Key mock patterns:

    ```typescript
    import { render, screen, act } from "@testing-library/react";
    import userEvent from "@testing-library/user-event";
    import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
    import DataFilterRenderer from "./DataFilterRenderer";
    import { useFilterStore } from "../../store/filterStore";
    import { useFilterViewStore } from "../../store/filterViewStore";
    import * as client from "../../api/client";
    import * as DashboardContextModule from "../DashboardContext";

    // Mock useDashboardContext to provide widgets + dashboardId + tables
    vi.mock("../DashboardContext", () => ({
      useDashboardContext: vi.fn(),
    }));

    beforeEach(() => {
      useFilterStore.getState().reset();
      vi.mocked(DashboardContextModule.useDashboardContext).mockReturnValue({
        dashboardId: 100,
        widgets: [],
        tables: [
          { id: 1, name: "trips", schema: "ki_home", columns: { region: "varchar", status: "varchar", active: "boolean", fare: "double", ts: "timestamp" } },
        ],
        dynamicViews: [],
        retryDynamicView: vi.fn(),
      } as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const makeWidget = (filterFields: any[] = []): any => ({
      id: 42,
      type: "datafilter",
      title: "DF",
      config: { tableId: 1, tableRef: "ki_home.trips", filterFields },
    });
    ```

    For test 22 (no materializeFilter import — static assertion):
    ```typescript
    it("does NOT import materializeFilter (sole-trigger invariant)", async () => {
      const source = await import("node:fs/promises").then((fs) =>
        fs.readFile("src/components/charts/DataFilterRenderer.tsx", "utf-8"),
      );
      expect(source).not.toMatch(/materializeFilter/);
    });
    ```

    For test 12 (Apply dispatch):
    ```typescript
    it("Apply dispatches setBulkFilters with one ActiveFilter per non-skipped field", async () => {
      vi.spyOn(client, "topValuesFn").mockResolvedValue({ values: ["X", "Y", "Z"] });
      const setBulkSpy = vi.spyOn(useFilterStore.getState(), "setBulkFilters");
      const user = userEvent.setup();
      render(<DataFilterRenderer widget={makeWidget([
        { column: "region", kind: "text-eq" },
        { column: "status", kind: "multi-select" },
        { column: "active", kind: "boolean-toggle" },
      ])} />);
      await screen.findByLabelText("region"); // wait for mount

      await user.type(screen.getByLabelText("region"), "EAST");
      await user.click(screen.getByLabelText("status: X"));
      await user.click(screen.getByLabelText("status: Y"));
      await user.click(screen.getByLabelText("active: true"));
      await user.click(screen.getByTestId("datafilter-apply"));

      expect(setBulkSpy).toHaveBeenCalledTimes(1);
      const [tableId, batch] = setBulkSpy.mock.calls[0];
      expect(tableId).toBe(1);
      expect(batch).toHaveLength(3);
      expect(batch).toContainEqual(expect.objectContaining({ column: "region", value: "EAST", operator: "eq", dataType: "string" }));
      expect(batch).toContainEqual(expect.objectContaining({ column: "status", value: ["X", "Y"], operator: "in", dataType: "string" }));
      expect(batch).toContainEqual(expect.objectContaining({ column: "active", value: true, operator: "eq", dataType: "boolean" }));
    });
    ```

    For test 17 (Apply call order):
    ```typescript
    it("markMaterializing fires synchronously AFTER setBulkFilters within the Apply click handler", async () => {
      const calls: string[] = [];
      vi.spyOn(useFilterStore.getState(), "setBulkFilters").mockImplementation(() => calls.push("setBulkFilters"));
      vi.spyOn(useFilterViewStore.getState(), "markMaterializing").mockImplementation(() => calls.push("markMaterializing"));
      vi.spyOn(client, "topValuesFn").mockResolvedValue({ values: ["X"] });
      const user = userEvent.setup();
      render(<DataFilterRenderer widget={makeWidget([{ column: "region", kind: "text-eq" }])} />);
      await user.type(screen.getByLabelText("region"), "A");
      await user.click(screen.getByTestId("datafilter-apply"));
      expect(calls).toEqual(["setBulkFilters", "markMaterializing"]);
    });
    ```

    Confirm via `grep` that `useDashboardContext` actually exposes `dashboardId` AND `tables`. If `tables` is NOT on DashboardContext, the renderer must accept `tables` as a prop from `WidgetRenderer.tsx` instead (mirror the InfoCardRenderer signature where `tables` is a prop). **Inspect `kinetica_bi/src/components/DashboardContext.tsx` during execution; if `tables` is not exposed, change the renderer signature to `({ widget, tables }: { widget: WidgetDto; tables: TableDto[] })` and update the Task 2 short-circuit branch to pass `tables` accordingly.**
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/components/charts/DataFilterRenderer.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/DataFilterRenderer.tsx` exists
    - File `kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx` exists
    - `grep -c "setBulkFilters" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "markMaterializing" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "materializeFilter" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns 0 (sole-trigger invariant)
    - `grep -c "AbortController" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "topValuesFn" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "columnStatsFn" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "clearFilters(tableId)" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "operator: \"in\"" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 2 (text-in + multi-select)
    - `grep -c "operator: \"between\"" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 2 (number-range + date-range)
    - `grep -c "operator: \"eq\"" kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns at least 1
    - `grep -c "it(" kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx` returns at least 23
    - `cd kinetica_bi && npx vitest run src/components/charts/DataFilterRenderer.spec.tsx` exits 0 with all 23+ tests passing
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    `DataFilterRenderer.tsx` exists and renders all 9 control-kind variants. Apply batches non-skipped fields into a single `setBulkFilters` call; `markMaterializing` fires synchronously after. Clear calls `clearFilters(tableId)` and resets staged. Empty IN / Any boolean / missing range bound fields are SKIPPED. Renderer subscribes to `useFilterStore.filters[tableId]` for chip-dismissal sync. `materializeFilter` is NOT imported (invariant). 23+ spec tests pass; tsc clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire WidgetRenderer short-circuit for type='datafilter' + add drill-down regression coverage</name>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (lines 234-250 — current short-circuit chain; this task adds one branch before AggregatedWidgetRenderer)
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (existing drill-down test structure — the regression assertions for the 6 dispatchDrillDown call sites)
    - .planning/phases/44-data-filter-widget/44-RESEARCH.md (§A call-site audit listing all 6 drill-down call sites — the regression surface for Plan 44-01's ActiveFilter type extension)
    - kinetica_bi/src/components/charts/DataFilterRenderer.tsx (from Task 1 — exported default; if it requires a `tables` prop, the short-circuit branch must pass it)
  </read_first>
  <files>kinetica_bi/src/components/charts/WidgetRenderer.tsx, kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx</files>
  <behavior>
    WidgetRenderer.spec.tsx gains:
    1. `it("short-circuits to <DataFilterRenderer /> for widget.type === 'datafilter'")` — render `<WidgetRenderer widget={{ type:'datafilter', config:{tableId:1, tableRef:'s.t', filterFields:[]} }} />`; assert `data-testid="datafilter-renderer"` is in the document; assert `AggregatedWidgetRenderer` was NOT mounted (no SQL-related DOM elements).
    2. `it("drill-down on a Bar chart still works end-to-end after ActiveFilter type extension")` — render `<WidgetRenderer widget={{ type:'bar', config:{sql:'...', tableId:2, drillDownColumn:'zone'} }} />` and simulate the click that triggers dispatchDrillDown; assert `useFilterStore.getState().addFilter` was called with an ActiveFilter literal WITHOUT `operator` field; assert `filters[2][0].operator` is `undefined` (not auto-defaulted at store level).
    3. `it("dispatchDrillDown ActiveFilter shape unchanged by Phase 44 — back-compat regression")` — static-shape assertion: read the dispatchDrillDown source via fs.readFile and assert the constructed object STILL has exactly 5 keys (column, value, dataType, sourceWidgetId, addedAt) — NO `operator` key was added by mistake.
    4. `it("dispatchDrillDown without operator produces eq SQL via buildServerWhereClause integration")` — integration-style test: dispatch a drill-down filter, capture the dispatched ActiveFilter, pass it through a server-side import of `buildServerWhereClause`, assert the SQL output is `col = 'val'` (NOT `col IN (...)` or similar). This proves the cross-module back-compat.

    NOTE: If WidgetRenderer.spec.tsx doesn't currently exist or test 2/4 are too integration-heavy for the existing spec patterns, fall back to:
    - Test 2: `it("simulating BarRenderer click → dispatchDrillDown → addFilter receives ActiveFilter with operator undefined")` — same assertion, lighter test setup.
    - Test 4: deferred to Plan 44-01's `lib.whereClause.spec.ts` which already covers "operator absent defaults to eq" (test 9 in Plan 44-01 Task 2).
  </behavior>
  <action>
    **Step 1 — Edit `kinetica_bi/src/components/charts/WidgetRenderer.tsx`:**

    Locate the short-circuit chain at lines 234-250 (the `if (widget.type === "map") ... else if (widget.type === "legend") ... else { body = <AggregatedWidgetRenderer /> }` chain). Add a new branch for `datafilter` AFTER `legend` and BEFORE the `else { body = <AggregatedWidgetRenderer /> }` fallback:

    ```typescript
    } else if (widget.type === "legend") {
      body = <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />;
    } else if (widget.type === "datafilter") {
      // Phase 44 Plan 03 (FILTER-V17-16): datafilter short-circuits BEFORE AggregatedWidgetRenderer
      // — it owns its own lifecycle (no SQL, dispatches into useFilterStore on Apply).
      // Sole materialize trigger invariant (Phase 15/30 lock): DataFilterRenderer NEVER calls
      // materializeFilter directly; Effect 1 in AggregatedWidgetRenderer fires off the
      // filterVersion tick produced by setBulkFilters.
      body = <DataFilterRenderer widget={widget} />;
    } else {
      body = <AggregatedWidgetRenderer widget={widget} />;
    }
    ```

    Add the import at the top of the file (next to the other renderer imports — `MapChartRenderer`, `RecordsTableRenderer`, `InfoCardRenderer`, `LegendRenderer`):

    ```typescript
    import DataFilterRenderer from "./DataFilterRenderer";
    ```

    **IF** Task 1 determined that `DataFilterRenderer` needs `tables` as a prop (because `useDashboardContext` doesn't expose `tables`), the branch becomes:
    ```typescript
    } else if (widget.type === "datafilter") {
      body = <DataFilterRenderer widget={widget} tables={tables} />;
    }
    ```
    The executor MUST match this to Task 1's actual signature.

    **Step 2 — Add regression coverage to `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`:**

    Add a new describe block for the datafilter short-circuit + back-compat regression:

    ```typescript
    describe("WidgetRenderer — Phase 44 datafilter short-circuit + back-compat", () => {
      it("short-circuits to <DataFilterRenderer /> for widget.type === 'datafilter'", () => {
        // ... per behavior test 1
      });

      it("Phase 44 ActiveFilter literal back-compat — dispatchDrillDown ActiveFilter has NO operator key", () => {
        // ... per behavior test 3
      });
    });
    ```

    If `WidgetRenderer.spec.tsx` doesn't exist as a separate file, add these tests to the most-relevant existing spec (likely `ChartConfigPanel.spec.tsx` is unrelated; check `kinetica_bi/src/components/charts/__tests__/` or sibling specs for the natural home). At minimum, the spec asserting `dispatchDrillDown` shape unchanged should land in a renderer-adjacent spec.

    Test 3 (back-compat static assertion):
    ```typescript
    it("dispatchDrillDown ActiveFilter literal has exactly 5 keys (no operator added by mistake)", async () => {
      const src = await import("node:fs/promises").then((fs) =>
        fs.readFile("src/components/charts/WidgetRenderer.tsx", "utf-8"),
      );
      // Pull out the dispatchDrillDown function body and assert no `operator:` field was added.
      const dispatchBody = src.slice(src.indexOf("function dispatchDrillDown"), src.indexOf("function parseKineticaResponse"));
      expect(dispatchBody).toContain("column,");
      expect(dispatchBody).toContain("value: value as ActiveFilter[\"value\"]");
      expect(dispatchBody).toContain("dataType,");
      expect(dispatchBody).toContain("sourceWidgetId: widgetId,");
      expect(dispatchBody).toContain("addedAt: Date.now(),");
      expect(dispatchBody).not.toMatch(/\boperator:\s*"/); // no operator field added
    });
    ```

    Test 1 (short-circuit):
    ```typescript
    it("short-circuits to <DataFilterRenderer /> for widget.type === 'datafilter'", () => {
      // Mock DashboardContext if needed (or wrap in DashboardContextProvider with minimal widgets/tables)
      render(
        <DashboardContextProvider value={{ dashboardId: 100, widgets: [], tables: [{ id:1, name:'t', schema:'s', columns:{a:'varchar'} }], dynamicViews: [], retryDynamicView: () => {} }}>
          <WidgetRenderer widget={{ id: 42, type: "datafilter", title: "", config: { tableId: 1, tableRef: "s.t", filterFields: [] } } as any} />
        </DashboardContextProvider>
      );
      expect(screen.getByTestId("datafilter-renderer")).toBeInTheDocument();
      // Confirm AggregatedWidgetRenderer NOT mounted (would render an SQL/loading state)
      expect(screen.queryByText(/Loading.../i)).not.toBeInTheDocument();
    });
    ```

    **Step 3 — Confirm zero changes to dispatchDrillDown:**

    `git diff kinetica_bi/src/components/charts/WidgetRenderer.tsx` should show ONLY:
    - One new `import DataFilterRenderer from "./DataFilterRenderer";` line at the top.
    - One new `else if (widget.type === "datafilter") { ... }` block.
    - NO changes to `dispatchDrillDown` (lines 87-129).
    - NO changes to `AggregatedWidgetRenderer` body.
    - NO changes to `parseKineticaResponse`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/DataFilterRenderer.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "widget.type === \"datafilter\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `grep -c "import DataFilterRenderer" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `grep -c "DataFilterRenderer widget={widget}" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `git diff kinetica_bi/src/components/charts/WidgetRenderer.tsx | grep "^-" | grep -c "operator"` returns 0 (no operator field added/removed in dispatchDrillDown)
    - `git diff kinetica_bi/src/components/charts/WidgetRenderer.tsx | grep "^-" | grep -c "dispatchDrillDown"` returns 0 (dispatchDrillDown function body unchanged)
    - `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx` exits 0 — at least 2 new tests pass + all existing tests still green
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - Full frontend regression: `cd kinetica_bi && npx vitest run` exits 0 with overall pass count unchanged or higher (no new failures from Plan 44-01's ActiveFilter type extension)
  </acceptance_criteria>
  <done>
    `WidgetRenderer.tsx` short-circuits `widget.type === "datafilter"` to `<DataFilterRenderer />` BEFORE the `AggregatedWidgetRenderer` fallback. `dispatchDrillDown` body unchanged. 2+ new spec tests pass (short-circuit + back-compat shape); full frontend vitest still green; tsc clean.
  </done>
</task>

</tasks>

<verification>
**Phase-44 Plan 03 verification (run after all tasks complete):**

```bash
# Frontend: full type check + targeted specs + full regression
cd kinetica_bi
npx tsc --noEmit
npx vitest run src/components/charts/DataFilterRenderer.spec.tsx
npx vitest run src/components/charts/WidgetRenderer.spec.tsx
npx vitest run src/store/filterStore.spec.ts                       # Plan 01 regression
npx vitest run src/components/charts/DataFilterConfigPanel.spec.tsx # Plan 02 regression
npx vitest run                                                      # full regression — overall pass count must not decrease

# Server regression (Plan 01)
cd ../kinetica_bi/server
npx tsc --noEmit
AUTH_MODE=password npx vitest run tests/lib.whereClause.spec.ts tests/routes.filter-materialize.spec.ts
```

**End-to-end smoke (manual verification path):**
1. Start frontend + server (per .planning auto-memory: `set -a; source .env; set +a` before `npm run dev` from a fresh shell in `server/`).
2. Create a new dashboard, associate a Kinetica table with at least one string column + one numeric column.
3. Add a Data Filter widget; configure 2 fields (string column = multi-select, numeric column = range); Save.
4. Add a Bar widget on the same dashboard reading the same table.
5. Pick values in the multi-select + adjust the range; click Apply.
6. Confirm: filter-bar chips appear with `col in ('A', 'B')` and `col between X and Y` text; Bar widget re-queries through the materialized view; chip × dismissal removes the filter AND syncs the Data Filter control to "not applied".

**Must-haves verification:**
- Sole materialize trigger: `grep -c materializeFilter kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns 0
- setBulkFilters dispatch: `grep -c setBulkFilters kinetica_bi/src/components/charts/DataFilterRenderer.tsx` returns ≥1
- WidgetRenderer short-circuit: `grep -c "widget.type === \"datafilter\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
- Drill-down back-compat: WidgetRenderer.spec.tsx test 3 (no `operator:` field in dispatchDrillDown) passes
- Empty IN skipped: DataFilterRenderer.spec.tsx test 14 passes
</verification>

<success_criteria>
- `DataFilterRenderer.tsx` ships with all 9 control-kind variants rendering correctly
- Apply produces exactly ONE filterVersion tick (via setBulkFilters); markMaterializing fires synchronously after
- Clear produces exactly ONE filterVersion tick (via clearFilters); staged values reset to defaults
- Empty IN / Any boolean / missing range bound fields are SKIPPED — never dispatched
- External chip dismissal re-renders the widget controls (subscription works)
- `WidgetRenderer.tsx` short-circuit chain has the new branch
- `dispatchDrillDown` source body unchanged — Phase 44 ActiveFilter type extension is 100% back-compat
- Drill-down on Bar / Line / Pie / Scatter / Table / RecordsTable still works end-to-end (regression suite passes)
- Frontend `npx vitest run` overall pass count ≥ pre-Phase-44 baseline
- Frontend + server `npx tsc --noEmit` clean
- Live UAT (operator end-to-end smoke per <verification>) confirms downstream widgets re-query
</success_criteria>

<output>
After completion, create `.planning/phases/44-data-filter-widget/44-03-SUMMARY.md` documenting:
- Final DataFilterRenderer prop signature (widget only, or widget + tables if Task 1 determined tables-as-prop path)
- Final kind → operator mapping table (with empty/Any skip rules)
- markMaterializing call ordering relative to setBulkFilters (must mirror dispatchDrillDown:127-128)
- Chip-dismissal sync mechanism (subscription to filters[tableId])
- Empty IN edge case handling (skipped at widget layer; defensive `1=0` at server layer from Plan 44-01)
- WidgetRenderer short-circuit branch placement (after legend, before AggregatedWidgetRenderer fallback)
- Drill-down back-compat regression proof (which spec test asserts ActiveFilter literal shape unchanged)
- Live UAT verification steps run and outcomes
- Any unexpected drift between RESEARCH.md predictions and actual behavior
</output>
