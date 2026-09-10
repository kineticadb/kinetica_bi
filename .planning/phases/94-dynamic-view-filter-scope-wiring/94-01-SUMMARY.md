---
phase: 94-dynamic-view-filter-scope-wiring
plan: "01"
subsystem: frontend-filter-engine
tags: [dv-combination, orchestrator, wms, widget-renderer, combo-store, phase-94]
dependency_graph:
  requires:
    - 93-filter-scope-config-ui (filterSelection per-widget config)
    - 90-combination-orchestrator (table-path precedent; stableComboHash, markMaterializing API)
    - 91-widgetrenderer-wiring (table-path combo-store read-path)
    - 92-mapchartrenderer-wiring (table-path comboViewsKey selector)
  provides:
    - dv-bound widget/layer filter-combination materialization via orchestrator
    - dv-combo read-path in AggregatedWidgetRenderer and MapChartRenderer
  affects:
    - useCombinationOrchestrator (dv enumeration loops added)
    - WidgetRenderer (Effect 1 dv-branch removed; effectiveViewName flipped)
    - MapChartRenderer (dvFilterViewsKey replaced by dvComboViewsKey)
tech_stack:
  added: []
  patterns:
    - stableComboHash("dv", dvId, resolved) — column-only, no shapes arg
    - dvComboViewsKey — useFilterCombinationStore primitive selector for dv-bound layers
    - vizToHash["l:<id>"] — layer-scoped vizKey for combo store (mirrors "w:<id>" for widgets)
    - NOFILTER_SENTINEL endsWith guard on dvComboHash before registry lookup
key_files:
  created: []
  modified:
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/hooks/useCombinationOrchestrator.spec.ts
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
decisions:
  - "dv path is column-only (no spatial arg to stableComboHash): server rejects dv+spatial with 400; orchestrator never folds shapes into a dv hash"
  - "vizKey for dv-bound WIDGET is w:<id> (not dv:<id>): the dv: prefix is used only in dvWidgetsKey/dvLayersKey memo strings, never as a vizToHash key"
  - "markDvMaterializing retained in dispatchDrillDown click handler: RecordsTableRenderer legacy island still reads filterViewStore.dvViews for its own suspend gate"
  - "useFilterViewStore import kept in MapChartRenderer: still used by info-query table path (Effect 4)"
  - "RecordsTableRenderer dv-filter Effect untouched: authorized legacy island per plan — it calls materializeFilter/dropFilterView directly for its own dv path"
metrics:
  duration: "multi-session (context boundary between sessions)"
  completed_date: "2026-06-29"
  tasks_completed: 3
  files_modified: 6
---

# Phase 94 Plan 01: Dynamic View Filter-Scope Engine Wiring (FSCOPE-V118-03) Summary

**One-liner:** Orchestrator dv-combo enumeration (stableComboHash("dv", dvId, resolved)) + WidgetRenderer Effect 1 dv-branch removal + dv read-path flip to filterCombinationStore in both AggregatedWidgetRenderer and MapChartRenderer.

## What Was Built

This plan completed the FRONTEND engine half of FSCOPE-V118-03: wiring dv-bound widgets and map layers through the combination orchestrator (sole-materialize-trigger discipline) and flipping their read-paths from the legacy `filterViewStore.dvViews` slice to `filterCombinationStore`.

### Task 1 — Orchestrator dv Enumeration (commit c5207cb)

Extended `useCombinationOrchestrator.ts` to:
- Enumerate dv-bound widgets (`dvWidgetsKey` useMemo — isTriggerType + dynamicViewId set) and dv-bound layers (`dvLayersKey` useMemo — dynamic_view_id !== null)
- For each dv, group all viz (widgets + layers) into a `byDv: Map<number, Map<string, DvHashEntry>>` by calling `resolveFilterSet(viz.filterSelection, dvFilters[dvId])` and `stableComboHash("dv", dvId, resolved)` — NO shapes arg (dv path is column-only)
- Gate on `useDynamicViewStore.getState().views[dvId]?.status !== "materialized"` before materializing
- NOFILTER_SENTINEL path (Case C): set `vizKeyToHash.set("w:"+w.id, undefined)` and continue
- STEP D dv dispatch: `markMaterializing(hash, dashboardId, "dv", dvId!)` then `materializeFilter({ dashboardId, dynamicViewId: dvId!, filters: resolved, combinationKey: hash })` — no spatial args
- STEP E: `currentVizKeys` now includes ALL layers (including dv-bound) for release-on-removal tracking
- Added `dynamicViewVersion` to dep array (bumps only on dv store writes, no feedback loop)

Spec covers: Case A (table-bound regression), Case B (dv-with-filter), Case C (dv-without-filter/NOFILTER), dv-layer enumeration, shared refCount, no-spatial-on-dv, SOLE-TRIGGER-DV grep gate.

### Task 2 — WidgetRenderer Effect 1 dv-branch Removal (commit 1f3ca8a)

Removed from `WidgetRenderer.tsx` (AggregatedWidgetRenderer):
- Entire Effect 1 (the dv-branch setTimeout that called `markDvMaterializing` + `materializeFilter` + `setDvView`/`clearDvView`)
- `materializeAbortRef` useRef (dv-branch-only)
- `dvFilterEntry`, `dvFilterViewName`, `dvFilterMaterializing` selectors (retired — `filterViewStore.dvViews` read-path)

Added/updated:
- `effectiveViewName` dv branch now reads `filterCombinationStore.getState().vizToHash[vizKey]` → `registry[hash].viewName`, falling back to raw `dvViewName` (Case C)
- Effect 2 dv suspend gate reads `comboEntry?.materializing` (same S-02 imperative pattern as table gate, since vizKey="w:<id>" for both paths)
- Dep array: removed `dvFilterViewName` + `dvFilterMaterializing`; `comboKey`/`combinationVersion` now drive the dv-combo path

Retained (authorized exceptions):
- `markDvMaterializing` in `dispatchDrillDown` click handler (RecordsTableRenderer legacy island reads `dvViews` for its own suspend gate)
- `materializeFilter`/`dropFilterView` imports (RecordsTableRenderer Effect still calls them directly)
- RecordsTableRenderer dv-filter Effect unchanged

Spec updates: Phase 63 FROM-swap precedence tests repointed to use `mockVizToHash`/`mockRegistry`; Phase 63 materialize-trigger tests repointed to assert WidgetRenderer NEVER calls `materializeFilter` for dv path; dv-drill dispatch tests updated to reflect Phase 94 semantics.

### Task 3 — MapChartRenderer dvComboViewsKey (commit 037a6fd)

In `MapChartRenderer.tsx`:
- Replaced `dvFilterViewsKey` (useFilterViewStore selector over `dvViews`) with `dvComboViewsKey` (useFilterCombinationStore selector over `vizToHash["l:<id>"]` → registry entries) — same S-02 primitive joined-string pattern as `comboViewsKey`
- Effect 2 `resolvedDvEntry` resolution: replaced `useFilterViewStore.getState().dvViews[dvId]` with `useFilterCombinationStore.getState().vizToHash["l:"+layer.id]` → `registry[dvComboHash]`
- Effect 3 `resolvedDvEntry` resolution: identical replacement
- Both dep arrays updated: `dvFilterViewsKey` → `dvComboViewsKey`
- `useFilterViewStore` import retained (still used in info-query table path, Effect 4)

Spec updates: Phase 63.1 Tests A/E/G/H repointed from `_filterViewState.dvViews` to `_comboVizToHash`/`_comboRegistry`; Phase 68 Cal-DV test repointed; new Phase 94 describe block added (Tests 94-A/B/C/D: combo entry, NOFILTER fallback, materializing guard, per-layer isolation).

## Verification Results

- `npx tsc --noEmit` — CLEAN
- `npx vitest run` — 127/127 test files, 2949/2949 tests (1 error: InfoPopup.spec.tsx in cross-mode contamination — known TD-V16-TEST-ISOLATION, passes in isolation)
- `npx vitest run src/styles/theme-guard.spec.ts` — 130/130 green
- `git diff --name-only -- packages/server` — EMPTY (zero server diff)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Notable Implementation Decisions

**1. [Decision] markDvMaterializing retained in dispatchDrillDown**
- **Found during:** Task 2
- **Issue:** `markDvMaterializing` at line 159 is called by the drill-click handler (`dispatchDrillDown`), not by Effect 1. RecordsTableRenderer (authorized legacy island, same file) still reads `filterViewStore.dvViews[dvId].materializing` for its own suspend gate.
- **Resolution:** Retained call — it writes to `dvViews` which RecordsTableRenderer reads. AggregatedWidgetRenderer Effect 2's dv suspend gate was updated to read `comboEntry.materializing` instead.

**2. [Decision] stale comment at file-top updated**
- **Found during:** Task 2
- **Fix:** Updated line 44 comment from "Effect 1 is UNCHANGED" to "Effect 1 REMOVED — orchestrator is now sole trigger."

**3. [Note] 94-02 completed before 94-01**
- Plan 94-02 (env-flag/UI half) was completed in a prior session before 94-01 resumed. There is no functional conflict — the plans are independent halves (frontend engine vs. env-flag plumbing). Both stacks are now complete for FSCOPE-V118-03.

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commit c5207cb (Task 1 — orchestrator dv enumeration): FOUND
- Commit 1f3ca8a (Task 2 — WidgetRenderer Effect 1 dv-branch removal): FOUND
- Commit 037a6fd (Task 3 — MapChartRenderer dvComboViewsKey): FOUND
