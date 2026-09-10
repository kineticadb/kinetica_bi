---
phase: 96
plan: "01"
subsystem: combination-orchestrator
tags: [orchestrator, records-migration, ceiling-fix, dv-disable, gap-closure]
dependency_graph:
  requires: [useCombinationOrchestrator, filterCombinationStore, WidgetRenderer, useAuthStore]
  provides: [ceiling-fallback-resolved, records-combo-consumer, dv-disable-data-path]
  affects: [WidgetRenderer.tsx, useCombinationOrchestrator.ts]
tech_stack:
  added: []
  patterns:
    - STEP B orphan-clear loop (ceiling remap gap fix)
    - dvFilterScopeDisabled imperative read at effect fire-time (S-02 pattern)
    - RecordsTableRenderer combo-store read via vizToHash (mirrors AWR effectiveViewName)
key_files:
  modified:
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/hooks/useCombinationOrchestrator.spec.ts
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - GAP 1 fix entirely in STEP B (not STEP D) to avoid breaking race-guard Scenario 7
  - records removed from NON_TRIGGER_TYPES; RecordsTableRenderer is now pure combo consumer
  - dvScopeDisabled read imperatively (getState()) per S-02, not in deps array
metrics:
  duration: "~3h (across two sessions)"
  completed_date: "2026-06-29"
  tasks_completed: 4
  files_modified: 4
---

# Phase 96 Plan 01: Orchestrator Gap-Closure Summary

Three orchestrator gaps closed (ceiling-fallback BLOCKER + records combination-model migration + dv-disable data-path) plus a diagnose-only task confirming the dv base re-materialize is benign.

## What Was Built

### GAP 1 (BLOCKER, Test 10) — Ceiling Fallback Stuck Spinner Fix

**Root cause**: Two failure modes in STEP B ceiling remap:
1. Removed hashes with `materializing:true` and no controller were never cleared, leaving vizs in a permanent "Filtering…" state.
2. The fallback hash could have a stale `materializing:true` placeholder from a prior tick; STEP D's `if (liveEntry) continue` skipped the POST, leaving vizs stuck.

**Fix**: Added two cleanup passes in STEP B (before STEP D runs):
- `removedHashes` loop: after remap, for each removed hash with `materializing:true` and no controller, call `clearEntry(removedHash)`.
- Fallback placeholder fix: before adding fallback to hashMap, if `registry[fallbackHash]?.materializing && !controllersRef.current.has(fallbackHash)`, call `clearEntry(fallbackHash)`.

This was kept entirely in STEP B (not STEP D) to avoid interfering with the race-guard in Scenario 7 (which pre-seeds `materializing:true` with no controller expecting no POST, and would break if STEP D fell through).

### GAP 2 (MAJOR, Test 1) — Records Combination-Model Migration

**Root cause**: `NON_TRIGGER_TYPES` included "records", so the orchestrator never enumerated records widgets. `RecordsTableRenderer` ran its own `materializeFilter`/`dropFilterView` trigger, producing a redundant duplicate view when a records + chart widget were on the same table.

**Fix**:
- Removed "records" from `NON_TRIGGER_TYPES` with a Phase 96-01 comment.
- Deleted `RecordsTableRenderer`'s entire materialize-trigger effect (~80 lines).
- Migrated `RecordsTableRenderer` to read `filterCombinationStore` via `vizToHash["w:<id>"]` (mirrors `AggregatedWidgetRenderer`'s effectiveViewName pattern).
- Updated `handleDownloadCsv` and page/count fetch effects to use imperative combo store reads.
- Updated `SOLE-TRIGGER GATE` in orchestrator spec to grep `WidgetRenderer.tsx`'s `RecordsTableRenderer` section for absent `materializeFilter`/`dropFilterView` calls.

### GAP 3 (MAJOR, Test 7) — dvFilterScopeDisabled Data-Path

**Root cause**: The orchestrator read `w.config.filterSelection` and `layer.filter_scope` unconditionally, so even when `dvFilterScopeDisabled: true` was set (disabling the filter scope UI), saved scope configurations still restricted which dv filters applied.

**Fix**: Read `dvFilterScopeDisabled` imperatively at the top of the `setTimeout` body (S-02 pattern: `const dvScopeDisabled = useAuthStore.getState().dvFilterScopeDisabled`). Applied to both dv widget loop and dv layer loop: `const cfg = dvScopeDisabled ? undefined : (w.config.filterSelection ...)`. `resolveFilterSet(undefined, dvFilters)` = accept-all = all dvFilters included.

### Task 4 (DIAGNOSE-ONLY) — dv Base Re-Materialize

Confirmed benign by code inspection of `useDynamicViewMaterializeChain.ts`. The cascade effect deps use `materializeVersion` (from `filterViewStore` per `sourceTableId`), NOT `filterVersion` or `spatialFilterVersion`. The dv base view does not re-materialize on base-table filter changes; no fix was needed.

## Test Coverage

- **useCombinationOrchestrator.spec.ts**: 37 tests pass (was 33 before, +4 new: CEILING-NO-STUCK, ORPHANED-CLEARED, DV-DISABLE, DV-DISABLE-flag-off)
- **WidgetRenderer.spec.tsx**: 106 tests pass (7 previously-failing RecordsTableRenderer tests updated to seed combo store)
- **Full suite**: 2991 tests pass across 130 files; theme-guard 132/132 green; tsc clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SC6/SC6b/SC6c in orchestrator spec not updated to match new behavior**
- Found during: Task 2 execution
- Issue: The spec still asserted records was NOT enumerated (old NON_TRIGGER_TYPES behavior). After removing "records" from NON_TRIGGER_TYPES, SC6 and SC6b failed.
- Fix: Updated SC6 (records IS enumerated → ONE POST; vizToHash set), SC6b (ONE shared POST; refCount 2), added SC6c (same hash; ONE POST)
- Commit: 936f224

**2. [Rule 1 - Bug] SOLE-TRIGGER GATE used wrong function boundary string**
- Found during: Verification
- Issue: Gate looked for `"function RecordsTableRenderer("` but it's an arrow function `"const RecordsTableRenderer ="`.
- Fix: Updated boundary string
- Commit: 936f224

**3. [Rule 1 - Bug] Phase 94 beforeEach missing dvFilterScopeDisabled reset**
- Found during: Task 3
- Issue: State leak risk — new DV-DISABLE tests set `dvFilterScopeDisabled: true` without reset, could affect subsequent tests.
- Fix: Added `dvFilterScopeDisabled: false` to Phase 94 `beforeEach` and an `afterEach` reset.
- Commit: 936f224

## Commits

- `936f224`: feat(96-01): close orchestrator gaps — ceiling fix, records migration, dv-disable data-path

## Self-Check: PASSED

- FOUND: useCombinationOrchestrator.ts
- FOUND: WidgetRenderer.tsx
- FOUND: WidgetRenderer.spec.tsx
- FOUND: useCombinationOrchestrator.spec.ts
- FOUND: commit 936f224
