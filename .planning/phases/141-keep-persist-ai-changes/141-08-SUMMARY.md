---
phase: 141-keep-persist-ai-changes
plan: 08
subsystem: web
tags: [keep, payload, overlay-merge, fixture]
requires: [141-01]
provides:
  - mergeWidgetOverlay (shared by WidgetRenderer and Keep)
  - buildKeepPayload / countViewToggles
  - packages/shared/src/fixtures/aiKeepPayload.fixture.json (consumed by 141-12)
affects: [141-12, 141-13]
key-files:
  created:
    - packages/web/src/lib/widgetOverlay.ts
    - packages/web/src/lib/widgetOverlay.spec.ts
    - packages/web/src/lib/aiSession/keepPayload.ts
    - packages/web/src/lib/aiSession/keepPayload.spec.ts
    - packages/shared/src/fixtures/aiKeepPayload.fixture.json
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
requirements-completed: []
gaps: []
metrics:
  completed: 2026-10-21
---

# Phase 141 Plan 08: Keep payload builder Summary

Pure `buildKeepPayload` that resolves saved-widget and layer edits through the same functions the renderer uses (extracted `mergeWidgetOverlay`, `applySessionToWidgets`, `applySessionToLayers`, `applyLayerOverrides`), reading only `derived.contribution` (never the radio-merged overlays), plus a committed fold-generated fixture.

## Commits
- cb6dd2c: refactor(141-08): extract mergeWidgetOverlay from WidgetRenderer
- 4b02caf: feat(141-08): buildKeepPayload folds the session into the Keep request

## RED evidence
- Task 1 (stub returning widget unchanged): `Tests 3 failed | 1 passed (4)`. WOV-1 (null overlay returns same object) passes against the stub, so it is vacuous in RED; WOV-2/3/4 discriminate.
- Task 2 (stub returning empty arrays / 0): `Tests 10 failed | 2 passed (12)`. KPAY-1 and KPAY-10 pass against the empty stub (empty and trivially valid), so are vacuous in RED; the other ten are red (including KPAY-11, fixture file absent).

## Verification
- `widgetOverlay.spec` + all 5 `WidgetRenderer*` spec files (unedited): 6 files / 203 tests pass, `--maxWorkers=2`. No `*.spec.tsx` under components/charts appears in this plan's commits.
- keepPayload + applySession + foldSession + foldSession.dv + widgetOverlay: 5 files / 91 tests pass. Web `tsc --noEmit` clean.
- Greps after: `export function mergeWidgetOverlay`=1, `mergeWidgetOverlay(` in WidgetRenderer=1 and in keepPayload=2, `deriveChartConfig(` in WidgetRenderer=0, `applyLayerOverrides(` in keepPayload=2, `widgetOverrides` in keepPayload=0 (invariant; discriminating proof is KPAY-5, which injects a radio contribution of aggregation "min" and asserts it is absent), `KPAY-` in spec=13, fixture node check exits 0.
- Fixture was created with `UPDATE_KEEP_FIXTURE=1` (first creation); the committed run is without the env var and deep-equals the generated payload. Regenerate only deliberately.

## Notes for downstream plans
- Temp ids appear inside `configSet` values, exactly as the renderer sees them: a rebind to an AI view gives `configSet.dynamicViewId = -1`, and an AI layer added to a saved map gives `configSet.includedLayerIds = [9201, -4]`. 141-12 must remap temp ids inside those two config keys (and layers.add/edit `dynamicViewId`) using the idMap. The fixture contains both cases.
- An unbind via `remove_dynamic_view` repoint yields `configUnset: ["dynamicViewId"]` (the fixture's 9104; the repoint does not need a configSet because tableId/table were already equal).
- Layer edits cover config, tableId, dynamicViewId, cb_config, track_config only (the schema's fields); other top-level layer fields have no slot in the contract.
- `buildKeepPayload` throws if a new widget has no displayed rect and no complete config.layout (141-13 reports this as D-12).
- `countViewToggles(derived)` counts non-empty `contribution.dynamicView` entries (D-20).

## Deviations from Plan
None. The test helper `fold` in the spec throws on any skipped scripted op, which caught two invalid set_layout sizes (min 6) while writing the spec.

## Self-Check: PASSED
