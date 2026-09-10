---
phase: 54-verification-live-walk-through
plan: "04"
subsystem: map-renderer
tags: [gap-closure, tdd, track-rendering, wms, bug-fix]
dependency_graph:
  requires: []
  provides: [GAP-54-01-fix, TRACKFIX-V19-01]
  affects: [MapChartRenderer, wmsUrlBuilder]
tech_stack:
  added: []
  patterns: [TDD-RED-GREEN, call-site-merge-pattern]
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
decisions:
  - "Fix is call-site only: merge { ...cfg, track_config: layer.track_config } before isConfigComplete gate; isConfigComplete signature/internals unchanged"
  - "buildWmsParams was never at fault — Task 1A confirmed it already reads layer.track_config correctly at ~line 1079"
  - "No Effect 3 changes needed — only one isConfigComplete call site exists in MapChartRenderer (~line 1037)"
metrics:
  duration: "~2.5 minutes"
  completed: "2026-06-07"
  tasks_completed: 3
  files_modified: 3
  tests_added: 3
---

# Phase 54 Plan 04: GAP-54-01 Track Layer Render Fix Summary

One-liner: Merged `layer.track_config` into `isConfigComplete` input at Effect 2 gate so track layers no longer short-circuit before ImageWMS construction.

## Confirmed Root Cause

`track_config` is a TOP-LEVEL `DashboardLayerDto` column (`layer.track_config`), NOT a key inside `layer.config`. At persist time, LayersModal splits `track_config` out to the top-level DTO field via `onPatch`. So `layer.config.track_config` is always `undefined` at render time.

In MapChartRenderer Effect 2, line ~1037 calls `isConfigComplete(cfg)` where `cfg = layer.config`. The track branch in `isConfigComplete` (line 152) reads `config.track_config`, which coalesces to `{ enabled: false }` with no xCol/yCol → returns `false` → `continue` → **zero ImageWMS sources constructed → no WMS requests fire**.

Ironically, line ~1079 correctly passes `track_config: layer.track_config` to `buildWmsParams`, but that code was unreachable because line ~1037 already skipped the layer.

This is why latlon layers render (latColumn/lonColumn ARE in `layer.config`) and track layers do not (columns live on the top-level `track_config` field, invisible to `isConfigComplete`'s `cfg`-only read).

## Task 1A Result: buildWmsParams Was Never at Fault

The `buildWmsParams` unit test (Track block — saved track layer regression) **PASSED before any fix**, confirming the builder already reads `layer.track_config` correctly via its 5th arg `layerJsonFields.track_config`. The bug was entirely in the render path's isConfigComplete gate.

## Task 1B Result: Render-Path Repro Confirmed

The render-path test `TRACKFIX-V19-01: a saved track layer (track_config on top-level DTO field) constructs an ImageWMS source with DOTRACKS=TRUE` **FAILED before the fix** with:
```
AssertionError: expected 0 to be greater than or equal to 1
```
Zero ImageWMS instances — exact reproduction of GAP-54-01.

## Fix Applied (Task 2)

Single call-site change in `MapChartRenderer.tsx` Effect 2 (~line 1036-1037):

```ts
// Before (bug):
const cfg = layer.config as Record<string, unknown>;
if (!isConfigComplete(cfg as Partial<MapWidgetConfig>)) continue;

// After (fix):
const cfg = layer.config as Record<string, unknown>;
// GAP-54-01 (TRACKFIX-V19-01): track_config is a TOP-LEVEL DashboardLayerDto column,
// not a key inside layer.config. isConfigComplete's track branch reads config.track_config,
// so merge the top-level field in before the gate — mirrors LayersModal:557-561 (form
// edit merge) and the buildWmsParams call at ~1079 (already reads layer.track_config).
const cfgForGate = { ...cfg, track_config: layer.track_config };
if (!isConfigComplete(cfgForGate as Partial<MapWidgetConfig>)) continue;
```

`isConfigComplete` function signature and internal logic are unchanged — it correctly reads `config.track_config`; the caller was feeding it the wrong object.

## Task 3: Regression Gate

- Full web suite: **1617/1617** passed (1614 baseline + 3 new track tests)
- web tsc: **clean** (no errors)
- No pre-existing tests broke

## Deviations from Plan

None — plan executed exactly as written. Task 1A passed as predicted (builder not at fault). Task 1B failed as predicted (render path reproduction). Task 2 fix made Task 1B green. Full suite + tsc clean.

## Self-Check

Files modified:
- packages/web/src/components/charts/MapChartRenderer.tsx: fix applied
- packages/web/src/components/charts/MapChartRenderer.spec.tsx: 2 new track tests
- packages/web/src/lib/wmsUrlBuilder.spec.ts: 1 new track regression test

Commits:
- 138f5dc: test(54-04): add failing reproduction test for GAP-54-01 track layer render
- 3916896: feat(54-04): fix GAP-54-01 — track layers now render via correct isConfigComplete input

## Self-Check: PASSED
