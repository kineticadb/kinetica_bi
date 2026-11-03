---
phase: 136-structural-edit-ops
plan: 03
subsystem: web-generation-layer
tags: [ai, sql, palette, heatmap, drift-tests]
requires: [136-01, 136-02]
provides:
  - buildChartSql (pure, shared by ChartConfigPanel and the AI path)
  - deriveChartConfig (regenerates sql/drill columns, identifier-hardened)
  - paletteColor / AI_PALETTE_COLORS
  - AI_WIDGET_DEFAULTS (config defaults + SQL flags, single flags definition)
  - DEFAULT_LAYER_CONFIG, makeAiHeatmapLayerConfig
key-files:
  created: [packages/web/src/lib/chartSql.ts, packages/web/src/lib/chartSql.spec.ts, packages/web/src/lib/aiPalette.ts, packages/web/src/lib/aiWidgetDefaults.ts, packages/web/src/lib/layerDefaults.ts, packages/web/src/lib/aiWebCatalog.spec.ts]
  modified: [packages/web/src/components/charts/ChartConfigPanel.tsx]
metrics:
  tasks: 2
  completed: 2026-10-13
---

# Phase 136 Plan 03: Web SQL generator, palette, defaults, heatmap layer builder

The panel's `generatedSql` body was moved verbatim into a pure `buildChartSql`; the AI path gets `deriveChartConfig` on top of the same generator, plus palette, per-type defaults and an AI heatmap layer config builder, all drift-tested.

## Commits
- e2783b5 refactor(136-03): extract buildChartSql; add deriveChartConfig with identifier hardening
- 4611781 feat(136-03): AI palette, widget defaults, heatmap layer defaults with drift specs

## Red-first evidence
- Task 1: CSQL-1..10 run against a throwing stub: 10 failed / 10. The expected literals were written by reading the panel's code (not computed by the new function); they went green unchanged after extraction, and both existing ChartConfigPanel specs pass with zero edits.
- Task 2: spec written before the modules existed: red with "Failed to resolve import ./layerDefaults". Green after (20/20).

## Verification
- web tsc clean; full vitest 216 files passed / 1 skipped, 4585 tests passed; theme-guard + catalogue spec 180 passed. No flakes this run.

## Mutation proofs (reverted)
- Removing the identifier check in deriveChartConfig: CSQL-9 fails (1 failed / 9 passed).
- Adding "cividis" to the ramps list checked by DRIFT6-1 (done in the spec copy, not in shared, to avoid disturbing parallel plan 136-04): DRIFT6-1 fails.

## Deviations
- [Rule 3] DERIVE flags first lived in chartSql.ts, then moved into AI_WIDGET_DEFAULTS (single definition, as the plan allowed); chartSql imports it. `HEATMAP_LIMITS` is exported from chartSql because the panel's limit dropdown still reads it.
- AI_WIDGET_DEFAULTS config omits `sortDir`/`limit` (plan listed them for bar/line/pie/table): they are not keys of any registry `defaultConfig`, which DRIFT6-2 forbids. buildChartSql already defaults them (DESC / 100); later plans pass them explicitly if wanted. records `pageSize` is 25 (the registry default), not 50.
- Unused panel imports removed (whereCustomWhere, buildBucketExpr, isMultiColumnBarGroupBy); the panel keeps HEATMAP_CELL_LIMIT for its limit control.

## Non-discriminating criteria
- `grep -c "AS value FROM" ChartConfigPanel.tsx = 0` reads 1: the remaining hit is a comment (line ~313), not SQL. The real requirement (SQL text moved, panel specs byte-green) was verified directly.
- `grep -c DEFAULT_BASEMAP_LIGHT aiWidgetDefaults.ts = 1` reads 2 (import + use); DRIFT6-4 verifies the actual value.
- Hex greps on new files read 0 before and after by design; PAL-1 is the proof. `grep cividis` in the spec is 1 because of the intentional `not.toContain`.

## Self-Check: PASSED
Files exist and commits e2783b5, 4611781 verified.
