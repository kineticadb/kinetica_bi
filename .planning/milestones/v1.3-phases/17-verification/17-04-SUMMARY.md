---
phase: 17-verification
plan: 04
type: execute
gap_closure: true
status: complete
completed_at: "2026-05-07"
commits:
  - 879a6f4
tests_added: 0
tests_total: 346
requirements_touched:
  - FILT-V13-01
  - FILT-V13-02
---

# Plan 17-04 — FilterBar chips for tableIds without a persisted views row

## Why this exists

Surfaced during 17-01 Task 2 UAT. After 17-02 and 17-03 shipped (synchronous mark + suspend
gates fully closed), the operator performed a chart drill-down on a dashboard where the
widget's tableId had no corresponding row in the SQLite `views` table (i.e., the table was
associated to a widget directly — a v1.3 FROM-swap dashboard — without a legacy static
WHERE-clause view row). The filter applied correctly (chart + map tiles narrowed as expected)
but the FilterBar rendered no chip for that filter, leaving the user with no way to see or
dismiss the active filter via the UI.

## Root cause

`DashboardOpen`'s filter-bar rendering code in `DashboardsPage.tsx` iterated exclusively
over `views[]` (SQLite persisted view rows with `filter_clause` and `table_id`). In v1.3's
FROM-swap world, a chart drill-down adds an entry to `useFilterStore` keyed by `tableId`,
but if that `tableId` has no corresponding SQLite `views` row (no static WHERE-clause was
ever configured), the `views.map(...)` loop never emitted a chip row for it.

The check `hasAnyStoreFilters` correctly detected that store filters existed (preventing the
bar from being hidden entirely), but the per-table chip rows were still derived from
`views.map(...)`, which silently skipped tables absent from `views[]`.

## Fix

`DashboardsPage.tsx` — `DashboardOpen` component filter-bar section:

1. **Build a unified `tableIdsWithFilters: Set<number>`** from the UNION of:
   - `views[]` entries with a non-empty `filter_clause`
   - `Object.entries(allStoreFilters)` entries with at least one chip

2. **Render chips by iterating `Array.from(tableIdsWithFilters)`** instead of `views.map(...)`.
   For each `tableId`:
   - Look up the optional `view` row: `views.find(v => v.table_id === tableId)`
   - Look up `srcTable` from `associatedTables` for the display name (unchanged)
   - Fall back to `view?.view_name ?? \`table ${tableId}\`` when `srcTable` is absent (edge case)
   - Guard: `if (!hasStaticClause && !hasStoreFilters) return null` (defensive dedup)
   - `key={tableId}` (was `key={v.id}`) — stable unique key regardless of views row presence

No store changes. No endpoint changes. No test infrastructure changes — the bug manifested
only when `associatedTables` was populated but `views[]` was empty or did not include the
drilled table, a scenario not previously covered by vitest due to its reliance on full
`DashboardOpen` render tree integration.

## Files modified

- `kinetica_bi/src/components/DashboardsPage.tsx`
  - Filter-bar rendering refactored: `views.map(...)` → `Array.from(tableIdsWithFilters).map(...)`
  - `tableIdsWithFilters` set built from union of `views[].filter_clause` + `allStoreFilters` keys
  - Display name fallback: `view?.view_name ?? \`table ${tableId}\``
  - `key={v.id}` → `key={tableId}`
  - Extended code comment documenting the v1.3 FROM-swap motivation

## Verification

- `cd kinetica_bi && npx tsc --noEmit` — exits 0
- `cd kinetica_bi && npx vitest run` — 346/346 passing (no regressions)
- Manual UAT: operator retried chart drill on the test fixture; chip appeared in FilterBar;
  clicking × dismissed the chip and map tiles reverted to raw table; Clear All behaved correctly

## Why no formal 17-04-PLAN.md (inline execution)

Tight, well-isolated one-file fix with clear root cause and small diff (25 additions,
9 deletions, all in one function). Creating a planner agent for a single-component UI fix
on a known code path would have added ~60 min of overhead. Inline execution with a gap-
closure SUMMARY.md preserves the GSD trail while minimizing cycle time.

## Next

17-01 Task 2 (operator fixture-ready + FilterBar chips confirmed working) can resume.
All three pre-materialize races and the chip-visibility gap are now closed. The UAT path
should be clean for full end-to-end walkthrough.
