---
phase: 136-structural-edit-ops
plan: 02
subsystem: web-map
tags: [heatmap, wms, VAL_ATTR, layer-editor]
requires: []
provides:
  - "MapWidgetConfig.valueColumn -> VAL_ATTR (heatmap only, plain identifier only)"
  - "Value column select in the layer editor; exported COLORMAP_CATALOG"
  - "HMAP-1..6 specs covering both MapChartRenderer buildWmsParams sites"
affects: [136-12]
key-files:
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/wmsUrlBuilder.spec.ts
    - packages/web/src/components/charts/KineticaWmsLayerForm.tsx
    - packages/web/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
metrics:
  completed: 2026-10-13
---

# Phase 136 Plan 02: Heatmap value column to VAL_ATTR Summary

Heatmap weight column is emitted as `VAL_ATTR` (identifier-validated, undefined when unset so legacy requests stay byte-identical), editable via a numeric-only "Value column" select, with specs proving both MapChartRenderer WMS sites carry heatmap params.

## Commits
- 60ce6b2 feat(136-02): heatmap value column -> VAL_ATTR and editor control
- aa95c21 test(136-02): AI-shaped heatmap layers render through both buildWmsParams sites

## Verification
- Legacy byte-identity literal captured from pre-change code (VALATTR-2) and pasted into the spec.
- Mutation proofs: removing the identifier regex fails VALATTR-5; renaming the VAL_ATTR assignment fails HMAP-1, HMAP-2, HMAP-6. Both reverted.
- `ds-select` count 13 -> 14 (+1). MapChartRenderer.tsx unchanged (no renderer gap found).
- tsc clean; theme-guard green; full web vitest 4554 pass, 1 fail (WidgetRenderer.line L132-21, known parallel flake; passes in isolation).

## Deviations from Plan
- HMAP fixtures use table_id 10 (public.t10, existing in defaultTables) instead of 4. HMAP-2 injects the negative-id layer directly into the mocked layers store rather than via session ops (add_layer op carries no table_id yet; avoids dependency on 136-01).
- Acceptance criterion `grep -c "params.VAL_ATTR" wmsUrlBuilder.ts = 1` does not match literally: params is `Record<string,string>` so the assignment needs a cast, `(params as Record<string, string | undefined>).VAL_ATTR =`. Real requirement verified by specs and mutation proof. Criterion is weak as a style check, not a behavioural one.

## Open
- Operator GetMap check of VAL_ATTR on the real server (MEDIUM confidence) remains for 136-12.

## Self-Check: PASSED
Commits 60ce6b2 and aa95c21 exist; all five files modified.
