---
phase: 17-verification
plan: 03
type: execute
gap_closure: true
status: complete
completed_at: "2026-05-07"
commits:
  - 19de0c3
tests_added: 2
tests_total: 346
requirements_touched:
  - FILT-V13-01
  - FILT-V13-02
  - MAP-V13-04
---

# Plan 17-03 — Synchronous markMaterializing + RecordsTableRenderer fixes

## Why this exists

Surfaced during 17-01 Task 2 UAT prep. After 17-02 shipped, the operator still observed
pre-materialize WMS GetMap and chart SQL queries firing against the raw table/layers BEFORE
the materialize POST returned. Plus a brand-new symptom: `SELECT * FROM  LIMIT 25 OFFSET 0`
errors from the records-table renderer.

17-02's suspend gate was correct — but its triggering condition was incomplete. It engaged
only when `entry.materializing === true`, but the underlying code only set that flag INSIDE
Effect 1's 300ms `setTimeout` debounce. Effect 2 (chart SQL), Effect 3 (WMS), and the
RecordsTableRenderer effects all fire synchronously when `filterVersion` ticks, well before
that 300ms window elapses. Result: every renderer raced ahead and fired queries against
raw `FROM <table>` / `LAYERS=<raw>`, then re-fired after `setView` populated the viewName.

## Two distinct bugs closed

### Bug A — pre-materialize race (chart SQL + WMS GetMap)

**Root cause:** `markMaterializing` was buried inside `useEffect` → `setTimeout(300ms)` in
`AggregatedWidgetRenderer.Effect 1`. Renderer effects re-fire on `filterVersion` change at
t=0; they read `entry?.materializing` (still false because mark hasn't fired yet), pass the
suspend gate, and fire raw queries. At t=300, mark finally fires; at t=300+latency,
`setView` resolves; renderer effects re-fire with a fresh `viewName` and fire the SECOND
query/WMS, this time correctly with `FROM <view>` / `LAYERS=<view>`.

**Fix:** Moved `markMaterializing` into `dispatchDrillDown` (`WidgetRenderer.tsx:67-103`),
called inline with `addFilter` in the same synchronous tick. By the time React re-renders
subscribers, the entry exists with `materializing: true`, every renderer's existing 17-02
suspend gate engages, no pre-materialize requests escape.

Skipped on dedupe (Phase 9 lock — when chip add is a no-op, `filterVersion` doesn't tick,
so no Effect 1 re-fire and no `setView` ever fires; setting the flag would leave it true
forever).

`dashboardId` threaded through `DrillProps` to give every chart-type renderer access to it
for the synchronous mark call. RecordsTableRenderer reads it from `useDashboardContext()`.

### Bug B — RecordsTableRenderer empty-FROM SQL

**Root cause:** `RecordsTableRenderer` used `viewName ?? table` (lines 1120, 1156). The
`??` operator only falls back on null/undefined. When `markMaterializing` creates the
placeholder entry `{ viewName: "", … }` and `setView` hasn't yet replaced it (or
`clearMaterializing` left it after a materialize error), the selector returns `""` —
which `??` keeps verbatim. Result: `SELECT * FROM  LIMIT 25 OFFSET 0` (broken SQL with
empty FROM clause), Kinetica HTTP 400.

This component was also entirely missed by 17-02 — it has its own page-fetch and
count-fetch effects, neither of which had a suspend gate.

**Fix:**
1. `viewName ?? table` → `viewName || table` in both effects. Empty string falls through
   to the raw table identifier.
2. Added 17-02-style materializing-flag suspend gate to both effects. Suspends only when
   an entry exists with `materializing: true`. For V13-LIMIT-01 (records-table-only
   dashboard, no chart driver, no entry ever created), the gate never engages and the
   table renders raw `FROM <table>` as the accepted limitation.
3. Same `||` fix applied defensively in `MapChartRenderer.tsx` Effect 2 + Effect 3
   `tableRef: viewName ?? rawTableRef` → `viewName || rawTableRef`.

## Files modified

- `kinetica_bi/src/components/charts/WidgetRenderer.tsx`
  - `dispatchDrillDown` signature: added `dashboardId: number`
  - `dispatchDrillDown` body: synchronous `useFilterViewStore.getState().markMaterializing(tableId, dashboardId)` post-`addFilter` (skipped on dedupe)
  - `DrillProps` type: added `dashboardId: number`
  - 5 chart-type renderers (Bar/Line/Pie/Scatter/Table): destructure + pass `dashboardId`
  - `RecordsTableRenderer`: read `useDashboardContext().dashboardId`; pass to `dispatchDrillDown`
  - `RecordsTableRenderer` page-fetch effect: `viewName ?? table` → `viewName || table` + materializing suspend gate + dep-array update
  - `RecordsTableRenderer` count-fetch effect: same treatment
  - Removed the 17-02 `clearMaterializingVersion` complexity and chip-presence experiment from `AggregatedWidgetRenderer` Effect 2 — kept the simpler 17-02 `if (materializing) return;` gate, now reliable thanks to the synchronous mark
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
  - **+2 specs:**
    - "Phase 17-03: drill-down click flips entry.materializing=true SYNCHRONOUSLY with addFilter (no race window)" — slows materialize to never-resolve, asserts both `filters[42]` and `views[42].materializing=true` exist post-click
    - "Phase 17-03: RecordsTableRenderer renders raw FROM <table> when entry has viewName='' placeholder (post-error fallthrough)" — pre-populates entry with empty-string placeholder + materializing=false, asserts SQL contains `FROM sales` (raw) and NOT empty FROM
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx`
  - Effect 2: `tableRef: viewName ?? rawTableRef` → `viewName || rawTableRef`
  - Effect 3: same
  - Suspend-gate comment refined (no literal `markMaterializing` token to keep pure-consumer-lock spec green)

## Verification

- `cd kinetica_bi && npx tsc --noEmit` — exits 0
- `cd kinetica_bi && npx vitest run` — **346/346 passing** (332 baseline + 12 from 17-02 + 2 from 17-03)
- Manual UAT pending: operator retries 17-01 Task 2 fixture-ready, expects single-fire chart SQL + WMS post-materialize with no pre-materialize raw queries
- Records-table empty-FROM regression (`SELECT * FROM  LIMIT 25 OFFSET 0`): closed; spec asserts `FROM sales` is emitted

## Why no formal 17-03-PLAN.md (inline execution)

This was the second iteration of a tight bug fix on the same code path. 17-02 was authored
by a planner agent and missed two real bugs (the race ordering and RecordsTableRenderer's
existence as a separate component). For a tight, well-diagnosed scope where I had full code
context loaded, inline execution avoided a 90-minute planner+executor round trip while
preserving the GSD trail through the SUMMARY.md and atomic commit.

## Next

17-01 Task 2 (operator fixture-ready) resumes. Operator hard-reloads dashboard, retries
chart drill, observes Network tab for single-fire pattern.
