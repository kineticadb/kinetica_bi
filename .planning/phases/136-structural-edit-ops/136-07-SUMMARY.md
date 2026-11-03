---
phase: 136-structural-edit-ops
plan: 07
subsystem: web-render-seam
tags: [ai, overlay, sql-regeneration, radio, td-v20-allowlist-keys]
requires: [136-01, 136-03]
provides:
  - chart overlay key/value translation (metricColumn, UPPERCASE aggregation, palette colour on real key, metricId null)
  - translateLayerOverlay (opacity 0-1 -> POINTOPACITY 0-100) inside applyLayerOverrides
  - render-time SQL regeneration via deriveChartConfig in WidgetRenderer
  - radio capture reverse transforms
key-files:
  modified: [packages/web/src/lib/widgetOverlayKeys.ts, packages/web/src/lib/applyLayerOverrides.ts, packages/web/src/lib/radioGroupCapture.ts, packages/web/src/components/charts/WidgetRenderer.tsx, packages/web/src/components/charts/actionEngine.canary.spec.tsx]
  created: [packages/web/src/lib/applyLayerOverrides.spec.ts, packages/web/src/components/charts/WidgetRenderer.aiSeam.spec.tsx]
metrics:
  tasks: 2
  completed: 2026-10-13
---

# Phase 136 Plan 07: Render seam for AI/radio overlays

Persisted allow-list names and values are translated in one place to what renderers read, and SQL-affecting overlays regenerate sql and drill columns with the panel's own generator.

## Commits
- c34073f feat(136-07): translate chart and layer overlay keys/values to renderer keys (D-19)
- 749afc0 feat(136-07): regenerate chart SQL for SQL-affecting overlays; radio canary for chart and layer opacity

## Red-first evidence
- Task 1: SEAM-1/2/3/5/6/7/8/9 plus the updated bar capture case failed (9 failed) before implementation; 58 pass after.
- Task 2: SEAM-10, 12, 17 failed with the saved SQL received; SEAM-15 failed. SEAM-16 was green on first run because Task 1 had already translated opacity inside applyLayerOverrides (red evidence for that behaviour is SEAM-7).

## Mutation proofs (reverted)
- SEAM-14: replacing `if (d) Object.assign(merged, d)` with `void d` fails SEAM-10, SEAM-12, SEAM-17, SEAM-15.
- Removing `translateLayerOverlay` from applyLayerOverrides fails the canary SEAM-16.

## Gates
- web tsc clean; full vitest 218 files passed / 1 skipped, 4601 tests passed; theme-guard 160 passed. No flake this run.

## Behaviour change (Pitfall 11)
v1.11 radio options carrying chart metric/aggregation or layer opacity previously did nothing; they now take effect (chart SQL re-runs, layer POINTOPACITY changes). Capture now also reads saved metricColumn/UPPERCASE aggregation and POINTOPACITY.

## Deviations
- Added SEAM-17 (custom-metric widget metric edit switches to real column, Pitfall 2) beyond the plan's list.
- The resolver passed to deriveChartConfig is a closure supplying the widget's tableId, because deriveChartConfig does not pass tableId to buildChartSql (custom-metric widgets with a group-by-only edit would otherwise fall back to `SELECT * ... LIMIT 100`).
- SEAM-13 sets a materialized dv view in the store and asserts the saved SQL FROM-swapped to the view (a non-materialized dv never calls runSql, which would not discriminate).
- Pre-existing noise: actionEngine.canary spec logs "reading 'then'" TypeErrors from the records renderer (OVK-6 mock); not caused by this plan.

## Non-discriminating criteria
- Hex grep on the two lib files reads 0 before and after (SEAM-3 is the real proof). `grep -c "SEAM-" canary` pre-check was 0 and is meaningful.

## Self-Check: PASSED
