---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
plan: 06
subsystem: web-charts
tags: [row-limit, heatmap, truncation-banner, limit-plus-one, has_more_records]
requires: [127-01, 127-03, 127-04]
provides: [heatmap-truncation-prop, chart-limited-note]
key-files:
  modified:
    - packages/web/src/components/charts/HeatmapRenderer.tsx
    - packages/web/src/components/charts/HeatmapRenderer.spec.tsx
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - Heatmap LIMIT bump lives inside runChartQuery so both view-not-found retry paths are covered
  - Uncut non-heatmap charts return the renderer directly (no wrapper), so they render exactly as before
metrics:
  tasks: 2
  completed: 2026-10-02
---

# Phase 127 Plan 06: Heatmap truncation banner + generic chart limited note

The heatmap banner now fires only when more cells really exist (own LIMIT+1 probe or server `has_more_records`), states the cells actually shown, and names the right limit in its tooltip. Every other aggregated chart shows "Limited to N rows" when the server cut it.

## Commits
- c0947a5 Task 1: HeatmapRenderer banner driven by `truncation` prop
- 8743562 Task 2: AggregatedWidgetRenderer: bump, has_more capture, slice, chart-limited-note

## Specs rewritten (old behaviour encoded false positives)
- HeatmapRenderer.spec "warns when the result reaches the shared cell cap" -> `RLHM-exact-full` (asserts NO banner; the old test asserted the D-14 false positive).
- HeatmapRenderer.spec describe "truncation notice tracks the EFFECTIVE limit" (6 row-count-vs-limit tests) -> describe "truncation banner is driven by the truncation prop": `RLHM-result-limit`, `RLHM-deploy-max`, `RLHM-compact`, `RLHM-no-prop`.
- WidgetRenderer.spec `data-extra-props` toBe("") -> toBe("truncation") (drill props still must not leak). Mocked HeatmapRenderer also exposes `data-truncation`.

## RED / probes
- Task 1 at HEAD: RLHM-exact-full, RLHM-deploy-max, RLHM-no-prop failed. Probe (gate `|| data.length >= 5000`) -> RLHM-exact-full and RLHM-no-prop fail.
- Task 2 against pre-change WidgetRenderer: RLHM-wire-bump, -over, -server-cut, -retry, RLCHART-limited and the data-extra-props assertion failed.
- Probes (restored from backup): (a) skip bump -> wire-bump, wire-over, wire-retry fail; (b) remove slice -> wire-over fails; (c) ownLimit null -> wire-over fails; (d) force setChartLimitedRows(null) -> RLCHART-limited fails.

## Deviations
- RLHM-wire-retry uses a real view-not-found fixture (stale combo view reject, then base-table retry); both calls asserted to end `LIMIT 5001`. No deviation from plan intent.
- None otherwise (no Rule 1-4 fixes).

## Acceptance criteria discrimination
All grep criteria measured 0/failing before and pass after (bumpTrailingLimit 2, truncation={heatmapTruncation} 1, chart-limited-note 1, RLHM-wire-/RLCHART- 8, old data-extra-props "" 0). The `grep -c "HEATMAP_CELL_LIMIT"` not required. RLHM-compact's "<45 chars" check is weak on its own but the text is `Truncated to the top N cells`.

## Verification
web `tsc --noEmit` clean; full web vitest 186 files / 4217 tests pass; theme-guard green. Only existing class `config-hint` used; no new `var(--x)`, no hex.

## For the 127-07 human checkpoint (not automatically verifiable)
- Live heatmap at Result limit 2,500 and 5,000: full 5,000 grid shows no banner; over-limit and server-cut grids show the banner with the right N.
- Tooltip wording for result-limit vs deployment-max.
- Legibility of the heatmap banner and the new "Limited to N rows" strip (bar/line/pie/etc.) in light and dark mode; the strip must not squash the chart (wrapper is flex column, chart in flex:1 minHeight:0 box).
- Note: the new chart-limited-note inherits `config-hint` colouring; sibling notices from 127-05 reference `var(--text-muted)` (undefined token; 127-05 follow-up fixed to `--muted` per commit e09881a). None added here.

## Self-Check: PASSED
