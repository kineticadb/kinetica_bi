---
phase: 139-session-only-dynamic-views
plan: 13
subsystem: web-ai-session
tags: [regression-specs, map, widget, dev-harness, uat-tooling]
requires: ["139-08", "139-09", "139-11"]
provides:
  - MAPDV-1..4 and WRDV-1..4 regression proofs for negative dynamic_view_id read paths
  - DEV harness commands for AI views (HARNDV-1..7)
affects: [139-14]
tech-stack:
  added: []
  patterns: ["spec harness copied from the sibling renderer spec; mutation-proven regression specs"]
key-files:
  created:
    - packages/web/src/components/charts/MapChartRenderer.aiDv.spec.tsx
    - packages/web/src/components/charts/WidgetRenderer.aiDv.spec.tsx
  modified:
    - packages/web/src/lib/aiSession/devHarness.ts
    - packages/web/src/lib/aiSession/devHarness.spec.ts
decisions:
  - "No production renderer change: both map sites and WidgetRenderer already handle a negative id."
  - "Harness addDynamicView stamps only `aggregated` (via aiDvIsAggregated); columns/maxRecords are left to the chain, since the harness has no gateway."
metrics:
  tasks: 2
  completed: 2026-10-20
---

# Phase 139 Plan 13: Negative-id read-path regressions + AI view DEV harness Summary

Map (both `buildWmsParams` sites) and widget renderers are proven to resolve an AI view with a negative id, and the DEV harness can add, bind, remove, list and peek AI views from the console with no provider call.

## Commits
- d81beb6 test(139-13): map + widget regression specs (Task 1)
- 5271db1 feat(139-13): DEV harness commands for AI views (Task 2)

## Task 1: renderer specs

**Map sites** (both exercised, distinct triggers):
- Site 1 = Effect 2, ImageWMS construction (~L1325). Trigger: first render with a materialized `-3`; asserts constructor `params.LAYERS` = AI view name and `_mv` (MAPDV-1).
- Site 2 = Effect 3, `updateParams` (~L1585). Trigger: an already-constructed source whose store entry for `-3` is re-materialized under a new `viewName`; asserts `updateParams` LAYERS = the new name (MAPDV-2).
- MAPDV-3: pending builds no ImageWMS (no base-table tile request), pending -> materialized constructs one with the AI name. MAPDV-4: over_threshold shows the "Some layers over threshold" overlay and builds nothing.

**Widget:** WRDV-1 materialized (not orphan, runSql FROM is the AI view and not the base table), WRDV-2 dangling id gives the orphan placeholder, WRDV-3 both over-threshold copies, WRDV-4 repointed (`dynamicViewId: undefined`) is table-bound and ignores a stale AI store entry.

**Mutation proofs** (temporary, restored, never committed; `git status` clean for both renderers):
- Site 1 `views[layer.dynamic_view_id]` -> `views[Math.max(id,0)]`: MAPDV-1, 3, 4 fail.
- Site 2 same mutation: MAPDV-2 fails (only site 2 test).
- WidgetRenderer dv selector gated to `dynamicViewId > 0`: WRDV-1 and WRDV-3 fail.
- All restored; 4/4 pass each file.

## Task 2: DEV harness

Added `addDynamicView(name, spec, tempId?)`, `bindWidget`, `bindLayer`, `addChartOnView` (no tableId), `removeDynamicView`, `aiViews()`, `listAiViews()`, `peekAiView()`; all ops go through `run()` -> `actions.applyTurn`. `help()` lists them with an hour-bucket + APPROX median example, the "harness removal does not repoint dependents" note and the D-26 "record the Kinetica version first" reminder. HARNDV-4 runs through the real session store; HARNDV-7 asserts no `fetch` and no `runSql` is made by the mutating commands.

## Deviations from Plan

### Gate scope (orchestrator override)
The plan's Task 2 verify runs the full web vitest. Per the orchestrator override this was NOT run here (139-14 owns it). Run instead: `npx tsc --noEmit` (clean), the 3 new/changed specs, and `src/styles/theme-guard.spec.ts` + all of `src/lib/aiSession` (12 files, 327 tests green).

### Criterion notes
- WRDV-4 uses the existing harness SQL (`ki_home.taxi`) rather than `demo.trips`; same property (table-bound FROM, no dv gate).
- HARNDV-4 initially failed because `pickup_datetime` is not a column of the baseline fixture table 5 (fold correctly skips `column_not_found`); the spec's view now groups by `payment_type`. Test-only fix.
- Not provable in jsdom, routed to 139-14 UAT: real map tiles following a materialized AI view; legibility/visual state of the over-threshold overlay.
- The harness-added `add_dynamic_view` op carries no stamped `columns`; peek/`aiViews` still work, but column-type checks that depend on stamped columns only see real values for chain/gateway-driven turns.

## Self-Check: PASSED
- FOUND: MapChartRenderer.aiDv.spec.tsx (MAPDV- count 4+), WidgetRenderer.aiDv.spec.tsx (WRDV- 4+), devHarness.ts, devHarness.spec.ts (HARNDV- 7+)
- FOUND commits d81beb6, 5271db1
