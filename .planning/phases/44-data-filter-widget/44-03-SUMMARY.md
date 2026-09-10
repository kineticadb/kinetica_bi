---
phase: 44-data-filter-widget
plan: 03
subsystem: renderer + widget-router wiring
tags: [renderer, widget-routing, filter, zustand, apply-pipeline, tdd, vitest]
dependency_graph:
  requires:
    - 44-01 (ActiveFilter type, setBulkFilters, markMaterializing, FILTER_CAP_PER_TABLE)
    - 44-02 (FilterFieldKind type, DataFilterConfigPanel, data-filter.ts registry entry)
  provides:
    - DataFilterRenderer.tsx — per-kind controls + Apply/Clear + mount-time value-universe fetch + chip-dismissal sync (FILTER-V17-11..15, 17)
    - WidgetRenderer.tsx datafilter short-circuit branch (FILTER-V17-16)
  affects:
    - WidgetRenderer.tsx — new else-if branch before AggregatedWidgetRenderer fallback
    - AggregatedWidgetRenderer (unmodified — filterVersion tick from setBulkFilters drives its Effect 1)
    - dispatchDrillDown (unmodified — back-compat preserved)
tech_stack:
  added: []
  patterns:
    - TDD (RED-GREEN per task; 23 + 3 spec tests written before implementation)
    - tables-as-prop pattern (mirrors InfoCardRenderer — DashboardContext does not expose tables)
    - AbortController cleanup on unmount (mirrors CbConfigForm/InfoCardRenderer)
    - Primitive Zustand selector for chip-dismissal sync (PITFALL C-02 lock)
    - markMaterializing synchronous after setBulkFilters (mirrors dispatchDrillDown:127-128)
key_files:
  created:
    - kinetica_bi/src/components/charts/DataFilterRenderer.tsx
    - kinetica_bi/src/components/charts/DataFilterRenderer.spec.tsx
  modified:
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - "DashboardContext does not expose tables — DataFilterRenderer accepts tables as prop (mirrors InfoCardRenderer). WidgetRenderer.tsx passes tables={tables} in the new datafilter branch."
  - "Sole-trigger invariant confirmed: DataFilterRenderer imports topValuesFn/columnStatsFn from client.ts but NOT materializeFilter. Static spec assertion (test 22) enforces this on every CI run."
  - "boolean-toggle staged value uses string literals 'any'/'true'/'false' (not boolean primitives) to allow a clean union with other StagedValue shapes in the Record without TypeScript union widening issues."
  - "text-in staged value is raw string (user types comma-separated); parsed to string[] at Apply time — avoids controlled-component complexity of maintaining a string[] for a text input."
  - "markMaterializing called synchronously after setBulkFilters in Apply handler — exact mirror of dispatchDrillDown:127-128. Closes V17-03 race window where Effect 2 (chart SQL) could fire before materialize guard engaged."
  - "universeError does not block Apply — operator can still apply filter values even if value-universe fetch fails (e.g. dropdown shows empty but text-eq still works). Loading state only disables dropdown when universeLoading AND topValues empty."
metrics:
  duration: 7min
  tasks: 2
  files_modified: 4
  completed: "2026-05-28"
---

# Phase 44 Plan 03: Renderer and Apply Pipeline Summary

DataFilterRenderer ships end-to-end: per-kind controls (9 variants), Apply dispatching into setBulkFilters with markMaterializing, Clear resetting widget-scoped filters, mount-time topValuesFn/columnStatsFn fetches with AbortController cleanup, and chip-dismissal sync via useFilterStore subscription. WidgetRenderer short-circuits widget.type==="datafilter" before AggregatedWidgetRenderer. dispatchDrillDown body unchanged — drill-down back-compat preserved.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DataFilterRenderer — per-kind controls + Apply/Clear + mount-time fetch + chip-dismissal sync | 85c63db | DataFilterRenderer.tsx, DataFilterRenderer.spec.tsx |
| 2 | WidgetRenderer short-circuit for type='datafilter' + drill-down regression coverage | 1b19525 | WidgetRenderer.tsx, WidgetRenderer.spec.tsx |

## Final DataFilterRenderer Prop Signature

```typescript
// tables-as-prop path (DashboardContext does NOT expose tables)
export default function DataFilterRenderer({ widget, tables }: {
  widget: WidgetDto;
  tables: TableDto[];    // passed from WidgetRenderer.tsx, same as InfoCardRenderer
}): JSX.Element
```

## Final Kind → Operator Mapping Table

| kind | dataType | operator | value shape | empty/Any handling |
|------|----------|----------|-------------|--------------------|
| text-eq | "string" | "eq" | string | empty string → SKIP |
| text-in | "string" | "in" | string[] (parsed from comma-sep raw string) | empty array → SKIP |
| dropdown | "string" | "eq" | string | empty/placeholder → SKIP |
| multi-select | "string" | "in" | string[] | empty array → SKIP (CRITICAL: never dispatched) |
| number-eq | "number" | "eq" | number | NaN / empty → SKIP |
| number-range | "number" | "between" | [number, number] | either bound missing → SKIP |
| date-eq | "datetime" | "eq" | string (ISO yyyy-mm-dd) | empty → SKIP |
| date-range | "datetime" | "between" | [string, string] | either bound missing → SKIP |
| boolean-toggle | "boolean" | "eq" | true / false | "any" → SKIP |

## markMaterializing Call Order

```typescript
// Apply handler — synchronous sequence mirrors dispatchDrillDown:127-128 exactly:
useFilterStore.getState().setBulkFilters(tableId, batch);  // ONE filterVersion tick
useFilterViewStore.getState().markMaterializing(tableId, dashboardId);  // SYNCHRONOUS
```

Spec test 17 asserts `calls === ["setBulkFilters", "markMaterializing"]` via call-order tracking.

## Chip-Dismissal Sync Mechanism

```typescript
// PITFALL C-02 lock: scoped selector — never subscribe to full filters map
const tableFilters = useFilterStore((s) => s.filters[tableId] ?? []);

// appliedColumns derived from subscription
const appliedColumns = useMemo(
  () => new Set(tableFilters.map((f) => f.column)),
  [tableFilters],
);
```

When the operator clicks × on a chip in the FilterBar, `removeFilter(tableId, column)` fires → `filterVersion` ticks → the subscription above re-renders DataFilterRenderer → `appliedColumns` no longer contains the dismissed column → the applied badge (●) disappears from that field's label.

## Empty IN Edge Case Handling

Widget layer (DataFilterRenderer.tsx):
- `text-in`: raw string split on comma → empty array → `return` before push (field skipped)
- `multi-select`: `Array.isArray(v) ? v : []` → length 0 → `return` before push (field skipped)

Server layer (defense-in-depth from Plan 44-01):
- `buildServerWhereClause` emits `1=0` for operator `"in"` with empty array — ensures no invalid `col IN ()` SQL even if the widget layer guard fails.

## WidgetRenderer Short-Circuit Branch Placement

```typescript
} else if (widget.type === "legend") {
  body = <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />;
} else if (widget.type === "datafilter") {
  // FILTER-V17-16: datafilter before AggregatedWidgetRenderer
  body = <DataFilterRenderer widget={widget} tables={tables} />;
} else {
  body = <AggregatedWidgetRenderer widget={widget} />;
}
```

Position: AFTER "legend", BEFORE the `AggregatedWidgetRenderer` fallback.

## Drill-Down Back-Compat Regression Proof

Spec test in `WidgetRenderer.spec.tsx` (Phase 44 describe block, test 3):
```typescript
it("Phase 44 ActiveFilter literal back-compat — dispatchDrillDown has NO operator key (static assertion)")
```

The test reads the source of `WidgetRenderer.tsx`, extracts the `dispatchDrillDown` function body (between its header and `parseKineticaResponse`), and asserts:
1. The 5 expected keys ARE present: `column,`, `value: value as ActiveFilter`, `dataType,`, `sourceWidgetId: widgetId,`, `addedAt: Date.now(),`
2. NO `operator:` key was added (regex `/\boperator:\s*"/` must NOT match)

## Test Coverage Summary

| Spec | Tests | Result |
|------|-------|--------|
| DataFilterRenderer.spec.tsx | 23 | All PASS |
| WidgetRenderer.spec.tsx | 63 total (61 pre-existing + 2 new) | All PASS |
| Full frontend `npx vitest run` | 1389 | All PASS |
| Server regression (whereClause + filter-materialize) | 54 | All PASS |

## Deviations from Plan

None — plan executed exactly as designed with one non-breaking implementation decision:

**[Decision] text-in staged as raw string (not string[])**
- **Reason:** A text `<input type="text">` naturally holds a string value; storing it as `string[]` would require a second controlled component or onChange parser. The raw string is parsed at Apply time only — simpler, same behavior.
- **Impact:** The `defaultStagedFor("text-in")` returns `""` (string) instead of `[]`. The Apply handler handles both `string` and `string[]` shapes (code has: `const raw = typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : ""`).
- **Spec impact:** None — spec tests don't check `text-in` staged type directly.

## Self-Check: PASSED

All created/modified files confirmed present on disk. All 2 task commits confirmed in git log (85c63db, 1b19525). 1389/1389 frontend tests pass. 54/54 server tests pass. 0 production-file TypeScript errors. Sole-trigger invariant confirmed: `grep -c "materializeFilter" DataFilterRenderer.tsx` returns 0.
