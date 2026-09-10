---
phase: 98-per-visualization-custom-where-clause
plan: 02
subsystem: ui
tags: [sql-builder, customWhere, vizsql, aggregated-widgets, records-table, registry-definitions]

# Dependency graph
requires: ['98-01']
provides:
  - "7 registry definitions (bar/pie/line/scatter/bignumber/table/records) carry customWhere Advanced textarea field + defaultConfig entry"
  - "ChartConfigPanel.generatedSql injects WHERE (<predicate>) for all three SQL shapes (grouped, scalar, records-style)"
  - "RecordsTableRenderer page-fetch + CSV-export SQL inject WHERE (<predicate>) before ORDER BY/LIMIT"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "whereCustomWhere(draft.customWhere) computed once at top of useMemo, spliced into all real-SELECT returns; placeholder SELECT * FROM paths unchanged"
    - "cw = whereCustomWhere(cfg.customWhere) computed once at RecordsTableRenderer top, spliced at both SQL build sites"
    - "TDD RED → GREEN on each implementation file before committing"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/definitions/bar.ts
    - packages/web/src/components/charts/definitions/pie.ts
    - packages/web/src/components/charts/definitions/line.ts
    - packages/web/src/components/charts/definitions/scatter.ts
    - packages/web/src/components/charts/definitions/bignumber.ts
    - packages/web/src/components/charts/definitions/table.ts
    - packages/web/src/components/charts/definitions/records.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/charts/ChartConfigPanel.spec.tsx
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx

key-decisions:
  - "cw computed once near top of generatedSql useMemo body (after table guard), before the usesAggregation branch split — single computation serves all three SELECT shapes"
  - "SELECT * FROM placeholder returns (incomplete config guard) are NOT modified — customWhere only applies once the real SELECT is produced per plan spec"
  - "cw computed at RecordsTableRenderer component top (not inside each effect closure) so it is available at both SQL build sites without duplication"
  - "AggregatedWidgetRenderer SQL reads baked config.sql (WHERE already embedded at config-save time by Task 2); whereCustomWhere NOT called inside AggregatedWidgetRenderer"
  - "draft.customWhere added to generatedSql dep array so SQL preview + persisted sql recompute when the textarea changes"

requirements-completed: [VIZSQL-V119-01, VIZSQL-V119-02, VIZSQL-V119-03, VIZSQL-V119-04]

# Metrics
duration: 9min
completed: 2026-06-30
---

# Phase 98 Plan 02: Aggregated + Records customWhere Injection Summary

**7 registry definitions gain 'Custom filter (SQL)' Advanced textarea; ChartConfigPanel.generatedSql + RecordsTableRenderer SQL inject WHERE (<predicate>) via whereCustomWhere helper, byte-identical when empty, invalid WHERE flows through existing per-widget error path**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-30T20:56:30Z
- **Completed:** 2026-06-30T21:05:22Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- Added identical `customWhere` Advanced textarea ConfigField + `customWhere: ""` defaultConfig entry to all 7 in-scope registry definitions (bar, pie, line, scatter, bignumber, table, records); excluded types (map, data-filter, info-card, legend, radio-group) untouched
- Imported `whereCustomWhere` from `lib/customWhere` in ChartConfigPanel; computed `cw` once in generatedSql useMemo; spliced into records-style, scalar, and grouped SQL shapes before ORDER BY/GROUP BY/LIMIT; placeholder `SELECT * FROM` guards unchanged; `draft.customWhere` added to dep array
- Imported `whereCustomWhere` in WidgetRenderer; read `cfg.customWhere` at RecordsTableRenderer component top; spliced `cw` at page-fetch SQL (~line 1861) and CSV-export SQL (~line 1740); AggregatedWidgetRenderer path untouched
- 8 new tests: 6 in ChartConfigPanel.spec (grouped/scalar/records WHERE injection + byte-identical), 2 in WidgetRenderer.spec (records page-fetch WHERE injection + byte-identical); all new + pre-existing tests pass (29 + 108)

## Task Commits

1. **Task 1: Add customWhere field to 7 registry definitions** - `3b2d974` (feat)
2. **Task 2: Inject WHERE into generatedSql (TDD)** - `1acf991` (feat)
3. **Task 3: Inject WHERE into RecordsTableRenderer SQL (TDD)** - `3a0544c` (feat)

_Note: Tasks 2 and 3 used TDD — tests written RED first, then implementation GREEN_

## Files Created/Modified
- `packages/web/src/components/charts/definitions/bar.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/definitions/pie.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/definitions/line.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/definitions/scatter.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/definitions/bignumber.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/definitions/table.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/definitions/records.ts` — customWhere field + defaultConfig
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — whereCustomWhere import + cw injection in generatedSql useMemo (all 3 real-SELECT shapes)
- `packages/web/src/components/charts/ChartConfigPanel.spec.tsx` — 6 new Phase 98-02 cases (grouped/scalar/records WHERE + byte-identical)
- `packages/web/src/components/charts/WidgetRenderer.tsx` — whereCustomWhere import + cw at RecordsTableRenderer top + injection at both SQL sites
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` — 2 new Phase 98-02 cases (records page-fetch WHERE + byte-identical)

## Decisions Made
- `cw` computed once near top of `generatedSql` useMemo body, shared by all three SELECT shapes — avoids redundant calls and keeps the dep array change minimal (just `draft.customWhere`)
- `SELECT * FROM ${table} LIMIT 100` placeholder paths are NOT modified — customWhere is undefined or empty when the structured config is incomplete, so the placeholder guard correctly fires first; no behavioral change needed
- `cw` computed at RecordsTableRenderer component top (not inside the page-fetch effect closure) so it is available for the CSV export async handler too — single source of truth within the component
- The count query (`SELECT COUNT(*) AS total FROM ${fromSource}`) does NOT get `${cw}` injected — the plan spec says inject before ORDER BY/LIMIT; the count query has neither. This is intentional: the count reflects the full view (consistent with how filters are applied via the combo store view, not the SELECT itself)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 98-01 and 98-02 are complete; plan 98-03 (timeline/numeric-line/calendar own-SQL builders) is parallel and independently complete
- VIZSQL-V119-01 through V119-04 are all covered by 98-01 + 98-02 + 98-03
- Phase 98 verification (if any) can proceed

## Self-Check: PASSED

All files confirmed modified. Task commits verified in git log:
- `3b2d974` — Task 1 (7 definitions)
- `1acf991` — Task 2 (ChartConfigPanel)
- `3a0544c` — Task 3 (WidgetRenderer)

---
*Phase: 98-per-visualization-custom-where-clause*
*Completed: 2026-06-30*
