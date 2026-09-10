---
phase: 92-mapchartrenderer-wiring
plan: "02"
subsystem: charts
tags: [combination-views, map-wms, read-path-flip, v1.18, frontend-only, filter-selection, READ-V118-02, COMBO-V118-04]

# Dependency graph
requires:
  - phase: 92-01
    provides: "l:<layerId> vizKey contract in filterCombinationStore + useCombinationOrchestrator layers extension"
  - phase: 89-store-server-foundation
    provides: filterCombinationStore (read API: vizToHash, registry, CombinationEntry)
  - phase: 88-foundation-pure-logic-types
    provides: NOFILTER_SENTINEL, isViewExpired structural compatibility
provides:
  - MapChartRenderer reads combo views at BOTH buildWmsParams sites (Effect 2 ADD/REMOVE + Effect 3 updateParams)
  - comboViewsKey per-layer primitive selector in both dep arrays (replaces viewsKey)
  - filterCombinationStore vi.mock + Phase 92 COMBO-V118-04 spec block (92-A..D)
  - READ-V118-02 complete (map WMS bound to combination views by name)
affects:
  - Phase 93 (filterScope config UI: MapChartRenderer already reads it via combo store; no further wiring needed for the render path)
  - Phase 94 (dv-bound layer wiring: unchanged here — dvFilterViewsKey/resolvedDvEntry path intact)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "comboViewsKey primitive selector (S-02): per-layer string key scoped to includedLayers table-bound only; replaced viewsKey; joins l:<id>:viewName:materializeVersion:materializing segments"
    - "BOTH buildWmsParams sites swapped atomically: Effect 2 ADD/REMOVE (~line 1229) + Effect 3 updateParams (~line 1477) both read vizToHash[layerVizKey] → registry[comboHash]"
    - "suspend gate in Effect 3: comboEntry?.materializing replaces entry?.materializing (filterViewStore path)"
    - "undefined/NOFILTER → rawTableRef: viewName undefined → viewName || rawTableRef = rawTableRef (|| not ?? — empty-string fallback preserved)"
    - "pure-consumer lock maintained: only useFilterCombinationStore + NOFILTER_SENTINEL imports added (both read-only); Test 16-E static assertion remains green"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx

key-decisions:
  - "Both buildWmsParams sites swapped atomically in Task 1 — the recurring missed-path gotcha was explicitly guarded against (PITFALL 1 from RESEARCH.md)"
  - "uniqueTableIds useMemo deleted as dead code once viewsKey removed — no longer needed"
  - "Spec migration scope expanded beyond plan description (Rule 1 auto-fix): Tests 16-B and Cal-TABLE also migrated since they test Effect 2 initial construction which now reads combo store, not filterViewStore"
  - "filterViewStore.views[tableId] WMS read eliminated entirely from both Effect 2 and Effect 3 — filterViewStore retained only for dvViews slice (dv-filter path) and info popup query path"

# Metrics
duration: 10min
completed: "2026-06-28"
---

# Phase 92 Plan 02: MapChartRenderer WMS Read-Path Flip Summary

**Both buildWmsParams call sites (Effect 2 ADD/REMOVE + Effect 3 updateParams) swapped to filterCombinationStore per-layer combo view reads; comboViewsKey primitive selector replaces viewsKey in both dep arrays; COMBO-V118-04 correctness spec block added; READ-V118-02 complete**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-28T13:43:26Z
- **Completed:** 2026-06-28T13:52:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `useFilterCombinationStore` + `NOFILTER_SENTINEL` imports (read-only) to MapChartRenderer.tsx
- Deleted `uniqueTableIds` useMemo (dead code once viewsKey removed)
- Replaced `viewsKey` selector with `comboViewsKey` per-layer primitive selector (S-02 compliant: filtered to table-bound layers, per-layer segments, joined string)
- Effect 2 (~line 1229): replaced `useFilterViewStore.getState().views[tableId]` with `useFilterCombinationStore.getState().vizToHash[layerVizKey]` + `registry[comboHash]` read
- Effect 3 (~line 1477): same combo read + suspend gate changed from `entry?.materializing` to `comboEntry?.materializing`
- Both dep arrays updated: `viewsKey` → `comboViewsKey` (Effect 2 ~line 1421, Effect 3 ~line 1498)
- dv-bound layer path (dvFilterViewsKey/resolvedDvEntry/dynamicViewsKey) left entirely untouched
- Info popup path (~line 1705 `views[layer.table_id]`) left untouched (explicitly excluded from filter scope)
- Added `_comboVizToHash`/`_comboRegistry` module-level state + `vi.mock("../../store/filterCombinationStore")` in spec
- Migrated 8 existing tests to combo store (Tests 16-B, 16-D, Spec 17-02-1/2/3, Spec 17-03 follow-up, Cal-TABLE)
- Added Phase 92 COMBO-V118-04 describe block: Tests 92-A (combo viewName flows to updateParams), 92-B (undefined/NOFILTER → base table, 2 sub-cases), 92-C (suspend gate), 92-D (filterViewStore not consulted)
- Added combo state reset to Phase 35, Phase 63.1, Phase 68 beforeEach blocks (prevent state leak from 92-D's populated combo state)

## Task Commits

1. **Task 1: Replace viewsKey with comboViewsKey + swap BOTH buildWmsParams sites** — `518a057` (feat)
2. **Task 2: Add filterCombinationStore mock + migrate tests + COMBO-V118-04 block** — `1527fc5` (feat)

## Files Created/Modified

- `packages/web/src/components/charts/MapChartRenderer.tsx` — 3 new imports, uniqueTableIds removed, viewsKey→comboViewsKey selector, Effect 2 + Effect 3 view-resolution blocks replaced, both dep arrays updated
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` — combo mock state + vi.mock factory, 8 tests migrated, Phase 92 COMBO-V118-04 describe block (6 tests), combo resets in 5 beforeEach blocks

## Key Contracts Delivered

- **READ-V118-02 complete:** `filterCombinationStore.vizToHash["l:<layerId>"]` → `registry[hash].viewName` is now the WMS view name for all table-bound map layers. Filters never travel in the WMS request — only the view name changes.
- **NOFILTER/first-tick fallback:** `undefined` hash or hash ending `:NOFILTER` → `comboEntry = undefined` → `viewName = undefined` → `viewName || rawTableRef = rawTableRef` (base table, byte-identical to pre-filter v1.17 behavior).
- **COMBO-V118-04 correctness:** With no filterScope configured (Phase 92 state), all layers on the same table produce the same orchestrator hash → same combo view → WMS LAYERS param differs from v1.17 only in view name suffix (`_c<hash8>`); tile content byte-identical.
- **Pure-consumer lock (Test 16-E):** MapChartRenderer contains zero materialize-trigger imports. Only `useFilterCombinationStore` and `NOFILTER_SENTINEL` added — both read-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Expanded spec migration scope to include Tests 16-B and Cal-TABLE**
- **Found during:** Task 2 spec execution
- **Issue:** Plan described migrating only Tests 16-D and 17-02-1/2/3. But Tests 16-B (Effect 2 initial construction with active view) and Cal-TABLE (same path via Effect 2) also used `_filterViewState.views` which Effect 2 no longer reads. They would fail with LAYERS=rawTableRef instead of expected viewName.
- **Fix:** Migrated both tests to populate `_comboVizToHash`/`_comboRegistry` instead of `_filterViewState.views`. Test 16-B renamed to reflect combo path; Cal-TABLE comment updated to reflect orchestrator-materialized combo view.
- **Files modified:** `packages/web/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** 1527fc5

**2. [Rule 1 - Bug] State leak from Test 92-D's combo state into Phase 35 + Phase 63.1 + Phase 68 tests**
- **Found during:** Task 2 — initial spec run showed 4 failures including Phase 35 Test 5 + Phase 63.1 Test F
- **Issue:** `_comboVizToHash` and `_comboRegistry` are module-level `let` variables. Test 92-D populates `_comboVizToHash = { "l:1": ... }`. Without resets in subsequent describe blocks' beforeEach, Phase 35 + Phase 63.1 tests inherited that combo state and got `_kbi_combo_t10_c92d0001` where they expected `public.t10`.
- **Fix:** Added `_comboVizToHash = {}` + `_comboRegistry = {}` to beforeEach in Phase 35, Phase 63.1, and Phase 68 describe blocks.
- **Files modified:** `packages/web/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** 1527fc5

**3. [Rule 1 - Bug] Tests 92-A and 92-D used wrong render pattern (render-with-source-already-set)**
- **Found during:** Task 2 — initial run showed 92-A + 92-D failing with "updateParams not called"
- **Issue:** Both tests tried to set `filterVersion=1` before the first render, expecting Effect 3 to fire. But `imageSourcesRef.current.get(layer.id)` is `undefined` until Effect 2 runs — Effect 3 skips the layer with `if (!source) continue`. No source exists at first Effect 3 fire.
- **Fix:** Changed both tests to render first with empty combo state, await, then populate combo state and rerender (same pattern as Test 16-D). comboViewsKey changes on rerender → Effect 3 re-fires with source present.
- **Files modified:** `packages/web/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** 1527fc5

## Self-Check

Verified files exist on disk:
- `packages/web/src/components/charts/MapChartRenderer.tsx` — FOUND
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` — FOUND
- Task commits 518a057, 1527fc5 — present in git log

Acceptance criteria verification:
- `comboViewsKey` selector: 1 occurrence (FOUND)
- `vizToHash[layerVizKey]` sites: 2 (BOTH sites — FOUND)
- `useFilterViewStore.getState().views[tableId]` WMS reads: 0 (ELIMINATED)
- `uniqueTableIds`: 0 (DELETED)
- `comboViewsKey` total: 6 (selector + both dep arrays + comments — FOUND)
- No bare `, viewsKey,` in dep arrays: 0 (CLEAN)
- `dvFilterViewsKey` present: YES (dv path intact)
- `dynamicViewsKey` present: YES (dv path intact)
- Pure consumer lock: 0 forbidden tokens
- Server diff: EMPTY
- Full vitest suite: 2891/2891 pass
- tsc: clean
- theme-guard: 128/128 pass

## Self-Check: PASSED

---
*Phase: 92-mapchartrenderer-wiring*
*Completed: 2026-06-28*
