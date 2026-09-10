---
phase: 09-filter-foundation
plan: 02
subsystem: api
tags: [typescript, abort-controller, react, widget-config]

# Dependency graph
requires:
  - phase: 03-dashboard-tables
    provides: tableId in dataSourceOptions (already wired through ChartConfigPanel.dataSourceOptions)
  - phase: 04-widget-config
    provides: ChartConfigPanel onSave wiring (the call sites we modified)
provides:
  - "runSql(sql, options?, signal?) — third optional AbortSignal parameter for cancellable SQL fetches"
  - "widget.config.tableId — number persisted at config-save time, available to renderers without table-name lookup"
affects: [09-03-filter-subscription, 09-filter-foundation, 10-drilldown, 11-map-filtering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive API parameter pattern (optional, default-undefined trailing param) — zero existing callers affected"
    - "AbortSignal threading through fetch RequestInit — caller is responsible for silencing AbortError"
    - "tableId as stable subscription key persisted in widget.config (AP-4 lock from CONTEXT.md)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx

key-decisions:
  - "runSql accepts AbortSignal as optional third param — additive, no breaking change to 32 existing API exports"
  - "AbortError is NOT caught/silenced in runSql — propagates to caller (Plan 09-03's AggregatedWidgetRenderer) which has the abort context"
  - "tableId is included on BOTH onSave call sites (standard Apply button AND CustomConfigPanel branch) for uniform downstream guarantees"
  - "selectedSource?.tableId passes undefined when no source picked — defensive handling left to AggregatedWidgetRenderer (matches existing pattern)"

patterns-established:
  - "Additive optional-param API extension: append AbortSignal as trailing optional, thread into fetch init — keeps signature changes zero-impact"
  - "Widget config persistence of subscription keys: store tableId at save time so renderers don't need runtime lookup"

requirements-completed: [FILT-02]

# Metrics
duration: 2min
completed: 2026-05-04
---

# Phase 09 Plan 02: Filter Foundation Prereqs Summary

**runSql gains optional AbortSignal third param (32 callers untouched) + ChartConfigPanel persists tableId in widget.config at save time, unblocking Plan 09-03's filter subscription**

## Performance

- **Duration:** 2 min (101 seconds wall-clock)
- **Started:** 2026-05-04T19:20:55Z
- **Completed:** 2026-05-04T19:22:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `runSql` signature extended with `signal?: AbortSignal` as additive third parameter — Plan 09-03 can now wire `AbortController` cancellation in `AggregatedWidgetRenderer` without restructuring existing callers
- `widget.config.tableId` is now persisted at save time from BOTH onSave call sites in `ChartConfigPanel` (standard Apply button + CustomConfigPanel branch) — resolves Pitfall 5 from RESEARCH.md and AP-4 lock from CONTEXT.md
- Zero existing callers affected: TypeScript strict mode passes, 35/35 vitest tests pass, no behavior changes to current code paths
- Inline comments mark FILT-02 / AP-4 intent for future readers (one in each file)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `signal?: AbortSignal` to runSql** — `9063584` (feat)
2. **Task 2: Save tableId to widget.config in ChartConfigPanel.onSave** — `5235c87` (feat)

**Plan metadata:** _(separate final commit, see git log)_

## Files Created/Modified

- `kinetica_bi/src/api/client.ts` — `runSql` gained third optional param `signal?: AbortSignal` threaded into apiFetch RequestInit; AbortError propagates to caller
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — Two onSave call sites now spread `tableId: selectedSource?.tableId` into config payload; inline FILT-02/AP-4 comment near `selectedSource` useMemo

## Decisions Made

- **AbortError NOT silenced in runSql:** The plan explicitly directs that `runSql` must not catch AbortError — the caller (Plan 09-03's AggregatedWidgetRenderer) is the one that issued the abort and is the right place to identify and silence it. This matches CONTEXT.md guidance ("AbortError is caught and silenced in the caller, NOT routed to the typed-error chain").
- **Comment placement:** Inline comment placed above `selectedSource` useMemo declaration (line 86) rather than above the Props type. Both placements were acceptable per plan; chose useMemo location since it contextually marks the source of the tableId value being persisted.
- **CustomConfigPanel branch also gets tableId:** Plan called for tableId on BOTH onSave call sites — applied uniformly so CustomConfigPanel-using charts are filter-ready by default with no per-chart special-casing.

## Deviations from Plan

None — plan executed exactly as written. All four files-of-instruction edits (one signature change, one apiFetch init addition, two onSave payload spreads, one comment) match the verbatim "Replace with EXACTLY this" blocks in the plan.

## Issues Encountered

None. Both tasks executed first-try with all acceptance criteria green:

- `grep -c "signal?: AbortSignal" client.ts` = 1 ✓
- `grep -c "signal" client.ts` = 2 ✓ (param + threaded)
- `grep -c "FILT-02" client.ts` = 1 ✓
- `grep -c "export const " client.ts` = 32 ✓ (unchanged baseline)
- `grep -c "tableId: selectedSource" ChartConfigPanel.tsx` = 2 ✓
- `grep -c "FILT-02" ChartConfigPanel.tsx` = 1 ✓
- `grep -c "AP-4" ChartConfigPanel.tsx` = 1 ✓
- `grep -c "onSave({" ChartConfigPanel.tsx` = 2 ✓ (modified existing, added none)
- `npx tsc --noEmit` exits 0 ✓
- `npm test` 35/35 passing ✓

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 09-03 (`AggregatedWidgetRenderer` filter subscription) is **fully unblocked**:

1. `runSql(sql, undefined, controller.signal)` is now a valid call signature for AbortController-driven cancellation on filter changes
2. `widget.config.tableId` will be a `number` (or `undefined` if no source picked) for any widget saved via ChartConfigPanel after this commit — no runtime table-name → tableId lookup required
3. Both changes are surgical and additive — Plan 09-01 (filter store creation) is independent of these and can land in Wave 1 in parallel

## Self-Check: PASSED

- [x] `kinetica_bi/src/api/client.ts` exists and contains `signal?: AbortSignal`
- [x] `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` exists and contains two `tableId: selectedSource` occurrences
- [x] Commit `9063584` (Task 1) exists in git log
- [x] Commit `5235c87` (Task 2) exists in git log
- [x] `tsc --noEmit` exits 0
- [x] All 35 existing vitest tests pass

---
*Phase: 09-filter-foundation*
*Completed: 2026-05-04*
