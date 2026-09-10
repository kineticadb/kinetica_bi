---
phase: 77-apply-labels-formatting-at-render-surfaces
plan: 01
subsystem: ui
tags: [react, zustand, column-display-config, records-table, formatting, labels]

# Dependency graph
requires:
  - phase: 75-column-display-config-foundation
    provides: resolveLabel, resolveFormatter, useColumnDisplayConfigStore, loadConfig, configVersion
  - phase: 76-column-formatting-editor-ui
    provides: upsertColumn mutations that bump configVersion (live re-render trigger)

provides:
  - RecordsTableRenderer headers render resolveLabel(tableId, col) with raw col fallback
  - RecordsTableRenderer cells render resolveFormatter(tableId, col)(row[col]) with identity fallback
  - configVersion subscription wired in RecordsTableRenderer (primitive selector)
  - loadConfig(tableId) called once per tableId on mount (cache population)
  - dv-bound widgets (tableId undefined) correctly fall back to raw names/values

affects:
  - 77-02-PLAN (chart renderers in WidgetRenderer.tsx — builds on same file, localized edits)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "configVersion primitive-selector subscription pattern (mirrors filterVersion at :394)"
    - "loadConfig useEffect guarded against undefined tableId"
    - "Inline ternary guard: tableId !== undefined ? resolveLabel(tableId, col) : col"
    - "Test pattern: spy on listColumnDisplayConfig to control loadConfig data; upsertColumn for live-update test"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx

key-decisions:
  - "Guard against undefined tableId inline with ternary (not a wrapper helper) — keeps code local and explicit"
  - "loadConfig via useEffect keyed on tableId — store caches, so fires once per table"
  - "Test seeding via listColumnDisplayConfig spy rather than upsertColumn-before-render, because loadConfig fires on mount and calls setConfig which REPLACES store entries (wiping upsertColumn seed)"
  - "configVersion variable is declared via useColumnDisplayConfigStore primitive selector — React re-renders when it changes, re-invoking resolve* getState()-based helpers"

patterns-established:
  - "resolveLabel/resolveFormatter inline in .map() callbacks — no useMemo needed (configVersion re-render does the refresh)"
  - "listColumnDisplayConfig mocked as vi.fn().mockResolvedValue([]) at module level; per-test spy overrides for specific data"

requirements-completed: [COLAPPLY-V115-01]

# Metrics
duration: 36min
completed: 2026-06-20
---

# Phase 77 Plan 01: Records Table Label + Format Injection Summary

**RecordsTableRenderer headers now display resolved column labels (resolveLabel) and cells format values through the column formatter (resolveFormatter), with configVersion-driven live re-render and raw fallback for dv-bound or unconfigured columns**

## Performance

- **Duration:** 36 min
- **Started:** 2026-06-20T19:14:57Z
- **Completed:** 2026-06-20T19:51:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Wired `resolveLabel(tableId, col)` into RecordsTableRenderer headers (sort arrow + onClick preserved)
- Wired `resolveFormatter(tableId, col)(row[col])` into RecordsTableRenderer cells (null-guard preserved)
- Subscribed to `configVersion` (primitive selector) to force re-render when Phase 76 editor mutates config
- Added `loadConfig(tableId)` useEffect to populate cache on mount, guarded against undefined tableId
- 5 behavioral tests covering: label in header, formatted cell value, raw fallback, dv-bound fallback, live configVersion re-render
- Full suite: 2540/2540 tests pass; tsc clean; theme-guard green; no new materialize imports

## Task Commits

1. **Task 1: Wire resolveLabel/resolveFormatter + configVersion into RecordsTableRenderer** - `0744e3b` (feat)
2. **Task 2: Tests — records header label, cell format, raw fallback, configVersion re-render** - `061b3af` (test)

**Plan metadata:** *(see final commit below)*

## Files Created/Modified

- `packages/web/src/components/charts/WidgetRenderer.tsx` — Added import for useColumnDisplayConfigStore/resolveLabel/resolveFormatter; added configVersion subscription; added loadConfig useEffect; updated header render to resolveLabel; updated cell render to resolveFormatter
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` — Added listColumnDisplayConfig to api/client mock; added useColumnDisplayConfigStore + FormatSpecNumber imports; added describe("RecordsTable column display config (COLAPPLY-V115-01)") with 5 tests

## Decisions Made

- **loadConfig test seeding via spy**: `upsertColumn` before render gets wiped because `loadConfig` fires on mount and calls `setConfig` (REPLACE semantics). Solution: spy on `listColumnDisplayConfig` to return the desired rows so `loadConfig`-triggered `setConfig` seeds the store correctly.
- **configVersion live-update test uses upsertColumn directly**: After initial render, `upsertColumn` bumps `configVersion` without needing another `loadConfig` call — this is the exact Phase 76 editor mutation path the feature exercises.
- **Inline ternary guards for undefined tableId**: `tableId !== undefined ? resolveLabel(tableId, col) : col` keeps the dv-bound fallback explicit and co-located with the render call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DynamicViewStatus type mismatch in test**
- **Found during:** Task 2 (test GREEN phase)
- **Issue:** Test used `status: "ready"` and `error: null` / `reason: null` which are invalid for `DynamicViewStatus` type (`"materialized" | "over_threshold" | "pending" | "error"`) and `DynamicViewEntry` fields (optional, not nullable)
- **Fix:** Changed to `status: "materialized"` and removed the null fields
- **Files modified:** WidgetRenderer.spec.tsx
- **Verification:** tsc clean, tests green
- **Committed in:** 061b3af (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type bug in test)
**Impact on plan:** Minor — test type correction only. No scope creep.

## Issues Encountered

The `loadConfig` useEffect fires on mount and calls `setConfig` (REPLACE semantics), which wiped `upsertColumn` seeds placed before render. Solved by switching to `listColumnDisplayConfig` spy pattern per-test so `loadConfig` reads from the mock API.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RecordsTableRenderer fully wired; 77-02 can safely modify the chart renderer sections of WidgetRenderer.tsx (the records changes are localized to lines ~1605-1610, ~1713-1723, and ~2153-2220)
- configVersion subscription pattern established for 77-02 to mirror in chart renderers

---
*Phase: 77-apply-labels-formatting-at-render-surfaces*
*Completed: 2026-06-20*
