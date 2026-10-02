---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
plan: 05
subsystem: web-charts
tags: [row-limit, truncation-notice, timeline, numericline, calendar]
requires: [127-01, 127-03]
provides: [groupedTimelineLimit, groupedNumericLineLimit, overflowProbe, timeline-limited-note, numericline-limited-note, calendar-limited-note]
key-files:
  modified:
    - packages/web/src/lib/buildTimelineSql.ts
    - packages/web/src/lib/buildTimelineSql.spec.ts
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
    - packages/web/src/lib/buildNumericLineSql.ts
    - packages/web/src/lib/buildNumericLineSql.spec.ts
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx
    - packages/web/src/components/charts/CalendarRenderer.tsx
    - packages/web/src/components/charts/CalendarRenderer.spec.tsx
decisions:
  - Ungrouped Timeline/NumericLine only get the deployment-max notice (has_more_records); no own-limit probe because their SQL is byte-locked
metrics:
  tasks: 3
  completed: 2026-10-02
---

# Phase 127 Plan 05: Calendar / grouped Timeline / grouped Numeric Line truncation notices

D-16 implemented: all three renderers show a compact `config-hint` notice only when more rows really exist (limit+1 probe or server `has_more_records`), naming the limit hit. Grouped builders gained an optional `overflowProbe`; default and ungrouped SQL are byte-identical.

## Commits
- d86551a Task 1: grouped Timeline
- 96663f1 Task 2: grouped Numeric Line
- ea18338 Task 3: Calendar

## Mutation probes (restored from backups)
- Timeline: drop `overflowProbe: true` -> RLD16-tl-own-limit fails; drop `.slice(0, own)` -> same test fails (via `data-rows` on a LineChart wrapper).
- NumericLine: same two probes -> RLD16-nl-own-limit fails.
- Calendar: drop `limit: CELL_LIMIT + 1` -> RLD16-cal-probe fails (RLD16-cal-own-limit does not, because it mocks the response; the SQL assertion carries that guard); drop slice -> RLD16-cal-own-limit fails.

## Deviations
- [Rule 3] jsdom draws no recharts SVG, so "chart receives N rows" could not be observed by dot counting. Added a `LineChart` wrapper to the recharts mock in the Timeline and NumericLine specs exposing `data-rows`. Test-only.
- Tests were written alongside the implementation rather than strictly RED-first for the renderers; the mutation probes above demonstrate they discriminate.
- Series-count notes (`*-truncated-note`) untouched; new notices use distinct test ids.

## Verification
- web `tsc --noEmit` clean; full web vitest 186 files / 4211 tests pass; theme-guard green.
- Only new className in the diffs: `config-hint` (existing); colours via `var(--text-muted)`, no hex.

## For the 127-07 human checkpoint (not automatically verifiable)
- Legibility of the three notices in light and dark mode; Calendar note sits above the smart/domain control bar and should not squash the grid; Timeline/NumericLine notes sit below the series note when both appear.

## Self-Check: PASSED
