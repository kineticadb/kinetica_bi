---
phase: 44-data-filter-widget
plan: 01
subsystem: filter-store + where-builder + chip-text
tags: [filter, store, where-clause, chip-text, zustand, server, type-extension]
dependency_graph:
  requires: []
  provides:
    - ActiveFilter type with operator discriminator + widened value union (client + server)
    - setBulkFilters Zustand action (single filterVersion tick for N columns)
    - buildServerWhereClause IN + BETWEEN SQL emission
    - buildChipText extended for in/between display operators
    - DashboardsPage chip rendering unified to single buildChipText source
    - /api/top-values n cap raised to 1000
  affects:
    - AggregatedWidgetRenderer (filterVersion dep — downstream trigger unchanged)
    - POST /api/filter/materialize (WHERE clause now supports IN + BETWEEN DDL)
    - FilterBar chips (now use buildChipText for new operator formats)
tech_stack:
  added: []
  patterns:
    - TDD (RED-GREEN per task)
    - Dependency-isolated server type mirror (whereClause.ts has no frontend imports)
    - Optional param with default for non-breaking function extension (buildChipText 4th param)
key_files:
  created: []
  modified:
    - kinetica_bi/src/store/filterStore.ts
    - kinetica_bi/src/store/filterStore.spec.ts
    - kinetica_bi/server/src/lib/whereClause.ts
    - kinetica_bi/server/tests/lib.whereClause.spec.ts
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts
    - kinetica_bi/src/lib/columnTypes.ts
    - kinetica_bi/src/lib/columnTypes.spec.ts
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/server/src/index.ts
decisions:
  - "Toast message uses FILTER_CAP_PER_TABLE constant interpolation instead of literal '25' string — single source of truth for cap value, makes future cap changes zero-diff"
  - "setBulkFilters empty-array path still increments filterVersion by 1 — 'clear-and-apply' gesture is valid; downstream Effect 1 re-fires to remove the filter view"
  - "buildChipText BETWEEN display does not quote strings/datetimes — matches RESEARCH §D format (display-only, not SQL)"
  - "quantile route n cap left at 256 — only top-values route raised to 1000 per FILTER-V17-06 scope"
metrics:
  duration: 9min
  tasks: 3
  files_modified: 9
  completed: "2026-05-28"
---

# Phase 44 Plan 01: Store and WHERE Builder Foundation Summary

Pure-functions foundation for the Data Filter widget: ActiveFilter type extended with operator discriminator and widened value union on both client and server; setBulkFilters batch action added; buildServerWhereClause extended for IN and BETWEEN SQL emission; chipText consolidated to single source of truth; filter cap raised 10→25; top-values route cap raised 256→1000.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend ActiveFilter type + setBulkFilters + raise filter cap to 25 | 471ae9d | filterStore.ts, filterStore.spec.ts, whereClause.ts |
| 2 | Extend buildServerWhereClause for IN + BETWEEN; add filter-materialize integration coverage | 7aa947c | whereClause.ts, lib.whereClause.spec.ts, routes.filter-materialize.spec.ts |
| 3 | Consolidate chipText + extend buildChipText for in/between + raise /api/top-values n cap to 1000 | 340a7a7 | columnTypes.ts, columnTypes.spec.ts, DashboardsPage.tsx, server/src/index.ts |

## Final ActiveFilter Type Union (Both Sides)

```typescript
export type ActiveFilter = {
  column: string;
  value:
    | string | number | boolean | Date | null  // legacy scalar (operator: "eq" / absent)
    | (string | number)[]                       // operator: "in"
    | [number, number]                          // operator: "between" on numeric
    | [string, string];                         // operator: "between" on datetime/string
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  operator?: "eq" | "in" | "between" | "isNull";
  sourceWidgetId?: number;
  addedAt: number;
};
```

## setBulkFilters Semantics

- Preserve-then-replace: existing entries for columns NOT in the batch are kept (drill-down chips survive a Data Filter Apply unless same column configured on both).
- Cap applies only to new columns: columns already in the store being replaced do NOT count toward the 25-cap.
- Single `set()` call increments `filterVersion` exactly once regardless of batch size.
- Empty batch still increments filterVersion (valid "clear-and-apply" gesture from the Data Filter widget's Apply button with all fields empty).

## buildServerWhereClause IN/BETWEEN Code Path Summary

```
operator = f.operator ?? "eq"

if op === "in":
  - empty array → "1=0"  (defense-in-depth; widget layer should skip empty IN before dispatch)
  - string/datetime elements → single-quoted via escapeKineticaStringLiteral
  - number elements → bare Number(v)
  - output: col IN ('a', 'b') or col IN (1, 2, 3)

if op === "between":
  - numeric → col BETWEEN N AND M (unquoted)
  - string/datetime → col BETWEEN 'lo' AND 'hi' (single-quoted + escaped)

eq/isNull/fall-through → preserved VERBATIM from pre-Phase-44 path
```

## Filter Cap Change (10→25)

- Raised via `FILTER_CAP_PER_TABLE` constant (exported for downstream specs).
- Toast message uses constant interpolation: `Filter limit reached (${FILTER_CAP_PER_TABLE} per table)`.
- Both `addFilter` and `setBulkFilters` respect the same constant.
- UX implication: operators can now configure up to 25 filter columns per table, giving multi-column Data Filter widgets realistic headroom without triggering the cap toast on a normal configuration.

## Top-Values n Cap Change (256→1000)

- `/api/top-values` route validation changed: `body.n > 256` → `body.n > 1000`.
- Error message updated: `"n must be integer in [2, 1000]."`.
- `/api/quantile` route intentionally left at 256 (out of scope for FILTER-V17-06; quantile breaks don't need 1000 buckets).
- No client-side spec updates needed — existing top-values tests use n ≤ 256 (still valid under new cap).

## chipText Consolidation Outcome

- Deleted the local `chipText` arrow function in `DashboardsPage.tsx` (lines 65-85).
- Added `import { buildChipText } from "../lib/columnTypes"` to DashboardsPage.
- Call site updated to `buildChipText(f.column, f.value, f.dataType, f.operator)` — the optional 4th param defaults to `"eq"` so all legacy eq/null chips render identically.
- `DashboardsPage.spec.tsx` regression: 20/20 tests pass — no chip-text snapshot breakage.

## Back-Compat Proof

`WidgetRenderer.spec.tsx` (drill-down regression surface) runs 60 tests without modification. The `dispatchDrillDown` path at `WidgetRenderer.tsx:110` constructs `ActiveFilter` literals with no `operator` field — the `buildServerWhereClause` `?? "eq"` default and the `buildChipText` default-param approach absorb this transparently.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written except for two minor spec-level discrepancies:

**1. [Plan spec mismatch] Toast text grep criterion uses literal vs. constant**
- **Found during:** Task 1 acceptance criteria check
- **Issue:** Plan says `grep -c "Filter limit reached (25"` should return ≥1, but the correct implementation uses `FILTER_CAP_PER_TABLE` constant interpolation in the template literal (not the literal string "25"). The semantic intent is satisfied; the literal grep does not match.
- **Disposition:** Implementation is correct per the plan's action spec. The acceptance criterion grep was a plan-level oversight. No code change needed.

**2. [Out-of-scope pre-existing] `body.n > 256` exists in quantile route**
- **Found during:** Task 3 acceptance criteria check
- **Issue:** Plan acceptance criterion says `grep -c "body.n > 256" kinetica_bi/server/src/index.ts` returns 0, but the quantile route (`/api/quantile`) has its own separate n-cap of 256 which is outside FILTER-V17-06 scope.
- **Disposition:** Correct behavior — quantile route left unchanged. The top-values route was the only target for the cap raise.

## Self-Check: PASSED

All created/modified files confirmed present on disk. All 3 task commits confirmed in git log (471ae9d, 7aa947c, 340a7a7). All 155 frontend tests pass. All 54 server tests pass. Frontend tsc clean. Server tsc clean.
