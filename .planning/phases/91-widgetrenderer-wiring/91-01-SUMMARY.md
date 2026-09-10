---
phase: 91-widgetrenderer-wiring
plan: "01"
subsystem: charts
tags: [filterCombinationStore, read-path-flip, combo-views, widget-renderer, v1.18, frontend-only]

# Dependency graph
requires:
  - phase: 90-combination-orchestrator/90-03
    provides: useCombinationOrchestrator (vizToHash, registry, combinationVersion population)
  - phase: 89-store-server-foundation/89-01
    provides: filterCombinationStore (CombinationEntry, vizToHash, combinationVersion, clearEntry)
  - phase: 88-foundation-pure-logic-types
    provides: NOFILTER_SENTINEL, stableComboHash, fromSwap falsy-guard
provides:
  - AggregatedWidgetRenderer table-read via filterCombinationStore (packages/web/src/components/charts/WidgetRenderer.tsx)
  - Effect 1 table-materialize branch removed (AggregatedWidgetRenderer only)
  - COMBO-V118-04 spec block proving byte-identical read behavior (packages/web/src/components/charts/WidgetRenderer.spec.tsx)
affects:
  - Phase 92 (MapChartRenderer wiring: same combo-read pattern)
  - Phase 94 (dv-bound path: still on legacy filterViewStore until Phase 94)
  - Phase 95 (FilteringBadge: badge now needs to read from filterCombinationStore for table widgets)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single comboKey primitive selector (viewName:expiresAt:materializing string) + combinationVersion dep — mirrors MapChartRenderer.viewsKey (S-02)"
    - "Imperative comboEntry read inside Effect 2 via getState() — avoids stale closure, mirrors shapes imperative read"
    - "NOFILTER / undefined hash → effectiveViewName = '' → fromSwap falsy-guard → base table (zero overhead)"
    - "LIFE-V13-01: clearEntry(comboHash) replaces clearView(tableId) for proactive expiry"
    - "LIFE-V13-02: clearEntry(comboHash) + base-table fallthrough; NO inline materializeFilter (orchestrator owns re-materialize)"
    - "Effect 1 dep array trimmed to dv-only: [sql, filterVersion, dashboardId, dynamicViewId, dvStatus]"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx

key-decisions:
  - "Single comboKey primitive selector form (locked per plan action §1): one subscription instead of three separate viewName/expiresAt/materializing selectors — avoids triple vizToHash lookup + mirrors established MapChartRenderer pattern"
  - "LIFE-V13-02 retry: clearEntry(comboHash) + raw base-table query (Open Decision 2 → option a): removes second route to materializeFilter in table path; orchestrator re-materializes on next filterVersion tick"
  - "Effect 1 table branch atomically removed with selector swap in same commit — prevents split-brain window between selector source and materialize trigger"
  - "dv-bound path (Effect 1 dv branch, dvSelectors, Effect 2 dv path) completely unchanged through Phase 94"
  - "Phase 30 spatial materialize tests updated: AggregatedWidgetRenderer no longer calls materializeFilter/dropFilterView for table widgets; tests now assert the opposite"

requirements-completed: [READ-V118-01, COMBO-V118-04]

# Metrics
duration: 13min
completed: "2026-06-28"
---

# Phase 91 Plan 01: AggregatedWidgetRenderer Table Read Flip Summary

**Table-bound AggregatedWidgetRenderer reads view name from filterCombinationStore (vizToHash["w:<id>"] → registry[hash].viewName) via single comboKey primitive selector + combinationVersion dep; Effect 1 table-materialize branch removed; LIFE-V13-01/02 retry paths use clearEntry; dv path unchanged; 2881 tests pass.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-28T00:58:54Z
- **Completed:** 2026-06-28T01:12:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

### Task 1: Swap AggregatedWidgetRenderer table selectors + rewire Effect 2; remove Effect 1 table branch

Executed the highest-risk change in v1.18: flipped the table-bound read path of `AggregatedWidgetRenderer` from the legacy `filterViewStore.views[tableId]` to `filterCombinationStore`. Both changes landed atomically to prevent split-brain.

**Selector change (lines 406-428 → replaced):**
- Removed 4 `useFilterViewStore` table selectors (`viewName`, `expiresAt`, `materializing`, `clearMaterializingVersion`)
- Added `vizKey = "w:${widget.id}"` + single `comboKey` primitive selector (`viewName:expiresAt:materializing` string) + `combinationVersion` dep
- Added imports for `useFilterCombinationStore` and `NOFILTER_SENTINEL`

**Effect 1 table branch removed (lines 543-599):**
- Entire table-path materialize block removed (markMaterializing → materializeFilter → setView → dropFilterView for empty filters)
- Effect 1 dep array trimmed from `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion, dvStatus, dynamicViewId]` to `[sql, filterVersion, dashboardId, dynamicViewId, dvStatus]`
- dv branch (lines 517-542) completely unchanged
- `materializeAbortRef` kept (dv branch still uses it)

**Effect 2 rewired:**
- Table suspend gate: `if (materializing) return` → imperative `comboEntry?.materializing` read from `getState()`
- LIFE-V13-01 proactive expiry: `filterViewStore.clearView(tableId)` → `filterCombinationStore.clearEntry(comboHash)`
- `effectiveViewName` table branch: `viewName` → `comboEntry?.viewName ?? ""`
- LIFE-V13-02 retry: removed inline `materializeFilter` loop; now calls `clearEntry(comboHash)` + `runChartQuery(fromSwap(sql, undefined))`
- Effect 2 dep array: `viewName, expiresAt, clearMaterializingVersion` → `comboKey, combinationVersion`

### Task 2: Extend WidgetRenderer.spec.tsx with COMBO-V118-04 block + updated mocks

- Added module-level `filterCombinationStore` selector-aware mock (`mockVizToHash`, `mockRegistry`, `mockCombinationVersion`) with `beforeEach` reset
- Added `describe("COMBO-V118-04 — default accept-all → byte-identical read behavior")` block with 4 tests:
  1. Combo viewName via FROM-swap (proves filterViewStore is NOT consulted for table path)
  2. NOFILTER/undefined hash → base table, no FROM-swap
  3. materializing=true → suspend gate, no runSql fires
  4. dv-bound path unchanged — combo store NOT consulted for dv widgets
- Updated 8 existing describe blocks to use combo store instead of filterViewStore for table-path assertions:
  - FILT-V13-01 (FROM-swap), FILT-V13-04 (badge), toast failure, Phase 17-02 suspend gate, LIFE-V13-01, LIFE-V13-02, Phase 30 spatial tests, Phase 35 DV legacy test
- Updated CalendarRenderer static assertion comment to note Phase 91 authorized callers

## Deviations from Plan

**1. [Rule 1 - Bug] Updated Phase 30 spatial materialize tests**
- **Found during:** Task 2
- **Issue:** The Phase 30 tests (`spatialFilterVersion dep`, `ORPHAN/COMBINED/DROP/ORPHAN-DROP`) expected `materializeFilter` to be called from AggregatedWidgetRenderer Effect 1. After Phase 91 removes the table branch, these tests would fail.
- **Fix:** Rewrote Phase 30 block to assert the new truth: AggregatedWidgetRenderer NEVER calls `materializeFilter` or `dropFilterView` for table-bound widgets. Three new tests verify this invariant.
- **Files modified:** `packages/web/src/components/charts/WidgetRenderer.spec.tsx`
- **Commit:** 312020d

**2. [Rule 1 - Bug] Updated Phase 35 DV "legacy widget" test**
- **Found during:** Task 2
- **Issue:** The "legacy widget (no dynamicViewId) behaves unchanged — uses filter-view path" test populated `filterViewStore.setView` expecting the widget to use it. After Phase 91, the table path reads from `filterCombinationStore`.
- **Fix:** Re-pointed test to populate `mockVizToHash` + `mockRegistry`; asserted combo viewName appears in SQL AND filterViewStore legacy viewName does NOT.
- **Files modified:** `packages/web/src/components/charts/WidgetRenderer.spec.tsx`
- **Commit:** 312020d

## Test Gates

- `npx tsc --noEmit` - CLEAN
- `npx vitest run src/components/charts/WidgetRenderer.spec.tsx` - 104/104 PASS
- `npx vitest run` - 2881/2881 PASS (126 test files)
- `npx vitest run src/styles/theme-guard.spec.ts` - 128/128 PASS
- `git diff --name-only packages/server` - EMPTY (zero server diff)
- Sole-trigger grep: `grep -rl "materializeFilter|dropFilterView" packages/web/src/components/charts/` finds only `WidgetRenderer.tsx` (authorized: dv branch + RecordsTableRenderer) and `CalendarRenderer.tsx` (comments only — not imports)

## Self-Check: PASSED

| Check | Status |
|-------|--------|
| WidgetRenderer.tsx exists | FOUND |
| WidgetRenderer.spec.tsx exists | FOUND |
| SUMMARY.md exists | FOUND |
| feat(91-01) commit 7db8c2f | FOUND |
| test(91-01) commit 312020d | FOUND |
| tsc --noEmit clean | PASSED |
| vitest run 2881/2881 | PASSED |
| theme-guard 128/128 | PASSED |
| zero server diff | PASSED |
