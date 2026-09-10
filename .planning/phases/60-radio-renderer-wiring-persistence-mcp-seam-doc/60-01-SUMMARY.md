---
phase: 60-radio-renderer-wiring-persistence-mcp-seam-doc
plan: 01
subsystem: action-engine
tags: [store-refactor, switch-replace, radio-widget, overlay, contributions, canary]
dependency_graph:
  requires: [58-02-SUMMARY, 58.1-01-SUMMARY]
  provides: [control-keyed-contributions, derived-overlay-maps, controlId-dispatch]
  affects: [widgetActionStore, applyWidgetAction, DashboardContext, DashboardsPage, actionEngine.canary.spec]
tech_stack:
  added: []
  patterns: [source-control-keyed-contributions, switch-replace, derived-selector-maps, zustand-state-fields]
key_files:
  created: []
  modified:
    - packages/web/src/store/widgetActionStore.ts
    - packages/web/src/store/widgetActionStore.spec.ts
    - packages/web/src/lib/applyWidgetAction.ts
    - packages/web/src/lib/applyWidgetAction.spec.ts
    - packages/web/src/components/charts/actionEngine.canary.spec.tsx
    - packages/web/src/components/DashboardContext.tsx
    - packages/web/src/components/DashboardsPage.tsx
decisions:
  - "Control-keyed contributions: Record<controlId, { widget, layer, dynamicView }> as internal state; derived overlay maps recomputed on every write"
  - "deriveOverlays() pure module-scope helper; layer deep-merges config sub-object; top-level fields shallow-merge"
  - "Consumer-facing read shape (widgetOverrides/layerOverrides/dynamicViewOverrides) kept as STATE FIELDS not getters for selector subscription compatibility"
  - "applyWidgetAction idempotency checks per-control contribution for the target, not the derived overlay"
  - "DashboardContext noopApplyWidgetAction noop default updated to (action, controlId) signature"
metrics:
  duration: 8min
  completed: "2026-06-11"
  tasks: 3
  files_modified: 7
requirements_closed: [RADIO-V111-03]
---

# Phase 60 Plan 01: widgetActionStore Control-Keyed Contributions + Derived Overlay Maps Summary

**One-liner:** Refactored widgetActionStore from target-keyed merge to source-control-keyed contributions with a pure `deriveOverlays()` helper, enabling switch-replace semantics (re-selecting option B drops fields A set that B doesn't) while keeping the consumer-facing read shape unchanged.

## What Was Built

### Task 1: widgetActionStore — control-keyed contributions + derived per-target overlay maps

Rewrote `widgetActionStore.ts` to replace the old target-keyed merge model with source-control-keyed contributions:

- **Internal state:** `contributions: Record<controlId, { widget, layer, dynamicView }>` — each radio widget (control) owns its current contribution wholesale.
- **`setControlContribution(controlId, contribution)`** REPLACES the control's prior contribution (switch-replace semantics). Missing kinds default to `{}`.
- **`clearControl(controlId)`** removes a control's contribution, recomputes derived maps.
- **`deriveOverlays(contributions)`** pure module-scope helper folds all controls (insertion order) into `widgetOverrides`, `layerOverrides`, `dynamicViewOverrides`:
  - widget/dynamicView: shallow-merge `{ ...acc, ...patch }` per control
  - layer: deep-merge config sub-object; top-level fields (track_config, cb_config) shallow-merge
- **Derived maps kept as STATE FIELDS** (not getters) so zustand selector subscriptions in MapChartRenderer/WidgetRenderer continue to fire on changes.
- **Removed:** `applyWidgetOverride`, `applyLayerOverride`, `applyDynamicViewOverride`, `clearOverride` (old merge API).
- **`reset()`** clears contributions + all derived maps (7th store lifecycle invariant preserved).
- **Spec:** 22 tests including switch-replace proof — control sets renderMode + cb_config (option A), then re-sets renderMode only (option B), derived layerOverrides[id] has no cb_config.

### Task 2: applyWidgetAction write-side + DashboardContext widening + spec migration

- **`applyWidgetAction(action, lookups, controlId)`** — new `controlId` param. Write-side builds the control's next contribution for the target (REPLACING that target's entry), preserving other targets. Calls `setControlContribution(controlId, nextContrib)`.
- **Layer split preserved:** `splitLayerPatch(configPatch)` still routes config fields nested under `config`, top-level fields (track_config, cb_config) at top level.
- **Idempotency:** compares per-control contribution for the target using `fingerprint()`; no write if unchanged.
- **DashboardContext:** widened `applyWidgetAction: (action, controlId) => WidgetActionResult`. Noop default, provider prop, and type all updated. 60-02's RadioGroupRenderer will consume this via `useDashboardContext().applyWidgetAction(action, widget.id)`.
- **DashboardsPage:** dispatch closure updated to `(action, controlId) => applyWidgetAction(action, lookups, controlId)`.
- **applyWidgetAction.spec.ts:** all calls gain `controlId` arg; idempotency spies target `setControlContribution`; derived map assertions unchanged (single control = derived overlay equals contribution).
- **actionEngine.canary.spec.tsx:** all `applyWidgetOverride`/`applyLayerOverride` direct store writes replaced with `setControlContribution(CANARY_CONTROL_ID, { widget|layer: { [id]: patch } })`.

### Task 3: Full deterministic gate

- **vitest:** 1918/1918 (above 1914 baseline) — 0 failures
- **tsc --noEmit:** clean
- **Old API stragglers:** 0 (only comments referencing removed names)
- **Server diff:** 0

## Canary Results

| Case | Description | Result |
|------|-------------|--------|
| A1 | Widget overlay reaches WidgetRenderer + no remount | PASS |
| A2 | Widget overlay triggers re-render (effectiveWidget changes) | PASS |
| A3 | reset() clears overlay + widget re-renders from baseline | PASS |
| B1 | Layer overlay reaches MapChartRenderer effectiveLayers (no remount) | PASS |
| B2 | cb_config overlay reaches top-level layer field | PASS |
| B3 | WMS effect re-fires on overlay write | PASS |
| C1 | renderMode overlay reaches config.renderMode via deep-merge | PASS |
| C2 | Baseline config.renderMode = "raster" before any overlay | PASS |
| C3 | renderMode change + no remount (same OL Map instance) | PASS |

## Switch-Replace Proven

Spec `widgetActionStore.spec.ts` — "SWITCH-REPLACE" test:
- Control C1 sets layer 100 → `{ config: { renderMode: "classbreak" }, cb_config: '{"breaks":[...]}' }` (option A)
- Control C1 re-sets layer 100 → `{ config: { renderMode: "raster" } }` (option B)
- Result: `layerOverrides[100]` = `{ config: { renderMode: "raster" } }` — `cb_config` absent (reverted to baseline)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

## Self-Check: PASSED

- widgetActionStore.ts: FOUND
- applyWidgetAction.ts: FOUND
- DashboardContext.tsx: FOUND
- 60-01-SUMMARY.md: FOUND
- Task 1 commit 3b16759: FOUND
- Task 2 commit a8160ad: FOUND
- vitest 1918/1918: VERIFIED
- tsc --noEmit: CLEAN
- Zero server diff: VERIFIED
