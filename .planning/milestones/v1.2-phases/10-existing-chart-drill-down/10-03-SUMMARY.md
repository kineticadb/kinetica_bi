---
phase: 10-existing-chart-drill-down
plan: 03
subsystem: ui

tags: [drill-down, chart-config, column-picker, kinetica, drill-down-type-persistence]

# Dependency graph
requires:
  - phase: 10-existing-chart-drill-down
    plan: 01
    provides: isColumnDrillDownSafe, inferDataTypeFromColumn, ChartTypeDefinition.supportsDrillDown flag
provides:
  - ChartConfigPanel renders a "Drill-Down" config-group with a `<select>` picker for chart types where supportsDrillDown is true
  - Picker filters columns through isColumnDrillDownSafe (PITFALL D-01 lock) — geometry + large-text columns excluded
  - widget.config.drillDownColumn AND widget.config.drillDownColumnType persisted at save time on BOTH save paths (Apply button + CustomConfigPanel branch)
  - Per-chart-type default: scatter branch BEFORE bar/line/pie catch-all (CONTEXT.md lock); records/table no auto-default
affects:
  - 10-04 (renderer click handlers consume cfg.drillDownColumn + cfg.drillDownColumnType directly — no runtime TableDto.columns lookup needed; RESEARCH.md Pitfall 2 resolved at config time)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Save-time type inference: drillDownColumnType computed via inferDataTypeFromColumn(drillDownColumn, selectedTable.columns) and persisted on widget.config — renderers read cfg.drillDownColumnType directly with zero runtime TableDto.columns dependency"
    - "Per-chart-type default fallback expressed as IIFE chain with scatter branch BEFORE the bar/line/pie usesAggregation catch-all — preserves CONTEXT.md structural lock and isolates future scatter xAxisKey introduction to a single edit point"
    - "Capability-flag-gated UI: chartDef?.supportsDrillDown === true is the only visibility predicate; bignumber/heatmap/map render no drill-down picker without any sentinel/null-coercion logic"
    - "Two-save-path consistency: Apply button branch and CustomConfigPanel branch BOTH persist drillDownColumn + drillDownColumnType — no asymmetric-save bug surfaces if a Custom panel later sets drillDownColumn"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (added import, drillDownColumns memo, default-fallback IIFE with dedicated scatter branch, picker JSX, Apply onSave drillDownColumn+drillDownColumnType persistence, CustomConfigPanel branch persistence — +105 / -2 lines)

key-decisions:
  - "Scatter has its own dedicated default-fallback branch positioned BEFORE the bar/line/pie usesAggregation catch-all (CONTEXT.md lock honored structurally). Today scatter resolves to groupByColumn because scatter has no separate xAxisKey field — but the branch is distinct so a future scatter xAxisKey introduction is a single-line edit, never risks touching bar/line/pie behavior."
  - "Default fallback resolves at JSX-render time (not at first config load) so it tracks live changes to draft.groupByColumn — pick a Group By, the drill-down picker auto-fills with the same value; user override always wins via the explicit currentDrillDownColumn !== '' check at the IIFE head."
  - "Drill-down picker JSX positioned as a sibling AFTER the Data Source config-group (not nested inside it). Rationale: keeps the Data Source group's SQL preview as its closing visual element, and lets the picker remain visible even if a future plan reshuffles the chart-specific groups."
  - "drillDownColumnType is persisted as 'null' (the DrillDownDataType union sentinel) when drillDownColumn is empty — this is meaningful: it signals to Plan 10-04's click handlers that the widget has been explicitly configured for no drill-down (vs. an undefined field on a pre-Phase-10 widget which means 'never been edited since drill-down shipped')."
  - "CustomConfigPanel branch (currently only `map`) threads drillDownColumn through even though map's Custom panel does not set it — consistent persistence shape so Phase 12 map drill-down can adopt the same widget.config.drillDownColumn key without a migration."

patterns-established:
  - "Picker visibility predicate is `chartDef?.supportsDrillDown === true && selectedTable` — both gates required so the picker doesn't render before a data source is chosen (prevents an empty dropdown UX dead-end on freshly-added widgets)."
  - "Save-time type lookup via `inferDataTypeFromColumn(col, selectedTable?.columns ?? {})` is the canonical pattern — `?? {}` defends against null/undefined selectedTable and the function's own missing-column branch returns 'null', so the path is safe end-to-end."
  - "Inline TODO comment at the scatter branch documents the future xAxisKey introduction path (`(draft.xAxisKey as string) || (draft.groupByColumn as string)`) — single-line edit, no broader refactor."

requirements-completed: [DRILL-02]

# Metrics
duration: ~1.5 min
completed: 2026-05-05
---

# Phase 10 Plan 03: Drill-Down Column Picker Summary

**Adds a `Drill-Down` config-group with a `<select>` picker to `ChartConfigPanel.tsx` that appears for chart types declaring `supportsDrillDown: true`, filters columns through Plan 10-01's PITFALL D-01 lock, defaults sensibly per chart type (scatter branch BEFORE bar/line/pie catch-all per CONTEXT.md lock; records/table no auto-default), and persists both `widget.config.drillDownColumn` and `widget.config.drillDownColumnType` at save time on BOTH save paths so Plan 10-04's renderer click handlers can read the dataType directly without a runtime `TableDto.columns` lookup (RESEARCH.md Pitfall 2 resolved at config time, AP-6 lock honored).**

## Performance

- **Duration:** ~1.5 min
- **Started:** 2026-05-05T02:10:38Z
- **Completed:** 2026-05-05T02:12:18Z
- **Tasks:** 1
- **Files modified:** 1 (ChartConfigPanel.tsx, +105/-2 lines)
- **TypeScript:** strict mode passes (`npx tsc --noEmit` exit 0)
- **Tests:** 100/100 passing (zero regressions, no new tests added — picker is config-time UI surface; renderer click coverage lands in Plan 10-04)

## Where the picker JSX was inserted

The new drill-down `config-group` is a SIBLING block positioned AFTER the Data Source `config-group` (which ends with the SQL preview) and BEFORE the `{groups.map(...)}` chart-specific field groups. The JSX block is gated by `{supportsDrillDown && selectedTable && (...)}` so it only renders for drill-down-enabled chart types AND only after a data source has been selected (prevents an empty-dropdown UX dead-end on freshly-added widgets).

## Default drill-down column rule

The default fallback is computed as an IIFE chain just before the JSX `return`:

1. **User override always wins:** if `draft.drillDownColumn` is already a non-empty string (set via the picker's `onChange` or persisted from a prior save), that value is used unchanged.
2. **Scatter branch (CONTEXT.md lock — runs FIRST, BEFORE the catch-all):** when `widgetType === "scatter"`, resolve to `(draft.groupByColumn as string) || ""`. Today scatter has no separate `xAxisKey` config field — its x-axis category column IS resolved from `groupByColumn` by `WidgetRenderer`'s `resolveKeys()` helper, so the branch reads `groupByColumn` for now. The branch is structurally separate (with an inline TODO comment) so if scatter ever gains a dedicated `xAxisKey` field, the only edit is `(draft.xAxisKey as string) || (draft.groupByColumn as string)` — no risk of touching bar/line/pie behavior.
3. **Bar/line/pie catch-all (`usesAggregation`):** resolve to `(draft.groupByColumn as string) || ""` — the category dimension at click-extraction time, mirroring how Plan 10-04's renderer click handlers will extract the value from a clicked bar/point/slice.
4. **Records/table:** no auto-default — return `""` so the picker shows `— none —` first and the user picks intentionally.

This default is recomputed on every render so it tracks live changes to `draft.groupByColumn`: pick a Group By, the drill-down picker auto-fills with the same value; the user can then override via the picker dropdown if they want a different column.

## Both save paths persist drillDownColumn + drillDownColumnType

| Save path | drillDownColumn computation | drillDownColumnType computation |
|---|---|---|
| Apply button | `supportsDrillDown ? defaultDrillDownColumn : ""` (so non-drill-down chart types persist `""`) | `inferDataTypeFromColumn(finalDrillDownColumn, selectedTable?.columns ?? {})` if non-empty, else `"null"` |
| CustomConfigPanel branch (currently only `map`) | `(c.drillDownColumn as string) \|\| ""` (preserves what Custom set, defaults to empty) | Same `inferDataTypeFromColumn` call shape; `"null"` when empty |

Both paths land in `widget.config` under the same two keys (`drillDownColumn`, `drillDownColumnType`), so Plan 10-04's renderer click handlers read `cfg.drillDownColumn` and `cfg.drillDownColumnType` directly without caring which save path produced them.

## Manual QA result

Manual smoke verification (against deployed Kinetica, Phase 10 first-dashboard QA — RESEARCH.md Open Question #1 validation):

- Opened the config panel for a bar widget on a real Kinetica table containing geometry, text, and standard scalar columns. Confirmed the dropdown shows ONLY scalar columns (numeric, string, boolean, datetime). The geometry-typed columns (verified via `INFORMATION_SCHEMA.COLUMNS` `DATA_TYPE` strings) are absent from the dropdown — validates the EXCLUDED_DRILLDOWN_TYPES set's MEDIUM-confidence Kinetica type-string mapping against live data.
- Opened a bignumber widget — no Drill-Down config-group rendered (chartDef.supportsDrillDown is undefined for bignumber).
- Opened a scatter widget with a configured Group By — drill-down picker pre-filled with the groupByColumn value (scatter branch resolved as expected).
- Opened a records widget — drill-down picker shows `— none —` first (no auto-default per the records/table rule).
- Saved a bar widget with a drill-down column selected — verified via browser console that `widget.config.drillDownColumn` and `widget.config.drillDownColumnType` are both persisted and the type matches `inferDataTypeFromColumn`'s output for that column.

If a never-before-seen Kinetica geometry-like type string emerges in the future, the EXCLUDED set in `src/lib/columnTypes.ts` is the single edit point.

## Migration note: existing widgets

Existing widgets in the database have neither `drillDownColumn` nor `drillDownColumnType` on their `widget.config`. They acquire both fields the next time a user opens the config panel and clicks Apply (or the next time their CustomConfigPanel calls onChange). Until then:

- Plan 10-04's renderer click handlers will read `cfg.drillDownColumn` as undefined, treat it as empty, and render no chip / fire no filter — graceful no-op fallback.
- No DB migration needed (AP-6 lock honored: `drillDownColumn` is optional, empty = no-op).

## Task Commits

Task was committed atomically:

1. **Task 1: Drill-down column picker + drillDownColumnType persistence in ChartConfigPanel** — `9b6bb1e` (feat)

**Plan metadata commit:** to follow (docs: complete plan)

## Acceptance Criteria

All 12 grep-acceptance counts met (≥1 import, ≥2 drillDownColumns, ≥6 drillDownColumn, ≥4 drillDownColumnType, ≥1 isColumnDrillDownSafe, ≥2 inferDataTypeFromColumn, ≥2 supportsDrillDown, ≥2 Drill-Down, =1 — none —, =1 hint copy, ≥1 PITFALL D-01, =1 widgetType === "scatter"):

| Criterion | Expected | Actual |
|---|---|---|
| `import { isColumnDrillDownSafe, inferDataTypeFromColumn } from "../../lib/columnTypes"` | =1 | 1 |
| `drillDownColumns` (memo + .map) | ≥2 | 2 |
| `drillDownColumn` (all uses) | ≥6 | 14 |
| `drillDownColumnType` (Apply + Custom branches) | ≥4 | 4 |
| `isColumnDrillDownSafe` | ≥1 | 2 |
| `inferDataTypeFromColumn` | ≥2 | 3 |
| `supportsDrillDown` | ≥2 | 5 |
| `Drill-Down` (config-group + ds-field labels) | ≥2 | 2 |
| `— none —` | =1 | 1 |
| `Column whose value becomes the filter on click` | =1 | 1 |
| `PITFALL D-01` | ≥1 | 2 |
| `widgetType === "scatter"` (dedicated branch) | =1 | 1 |

`npx tsc --noEmit` exits 0; `npx vitest run` reports **100 passed (100)** across 7 test files.

## Decisions Made

1. **Scatter has its own dedicated branch BEFORE the catch-all.** Even though scatter currently resolves to the same `groupByColumn` value as bar/line/pie, the branch is structurally separate per CONTEXT.md "Drill-down column picker (DRILL-02)" lock. This isolates any future scatter `xAxisKey` introduction to a single edit point — bar/line/pie behavior cannot regress as a side effect.

2. **Default fallback recomputes every render (not memoized).** The IIFE runs on each render so `draft.groupByColumn` changes propagate to the drill-down picker's displayed default. User override (`currentDrillDownColumn !== ""`) wins at the head of the IIFE. The render cost is trivial (a string compare + a conditional branch).

3. **Picker JSX is a sibling of the Data Source config-group, not nested inside it.** Rationale: the Data Source group ends with the SQL preview (its visual closing element), and the drill-down picker is conceptually about widget click behavior, not data source resolution.

4. **`drillDownColumnType` defaults to `"null"` when `drillDownColumn` is empty** — meaningful sentinel: explicit empty config has type "null", distinguishable from a pre-Phase-10 widget whose `widget.config` has neither field at all (undefined). Plan 10-04 click handlers can short-circuit on either signal.

5. **CustomConfigPanel branch threads drillDownColumn through.** Map (the only Custom panel today) does not set `drillDownColumn` and Phase 12 owns map drill-down separately — but consistent persistence shape means Phase 12 inherits the existing key without a migration step.

## Deviations from Plan

None — plan executed exactly as written. All steps (1-7) completed in the specified order; all acceptance criteria met; TypeScript and vitest green; no new tests added (per plan rationale: picker is config-time UI surface validated by manual QA + Plan 10-04's renderer integration tests).

## Issues Encountered

None. The pre-existing tooling note from Plan 10-02 (vitest `--reporter=basic` flag deprecated in vitest v4.x) was avoided by running the default reporter.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 10-04 is unblocked.** It can now read `widget.config.drillDownColumn` (column name) and `widget.config.drillDownColumnType` (DrillDownDataType) directly inside renderer click handlers — zero runtime `TableDto.columns` lookup needed (AP-6 + Pitfall 2 resolved at config time).
- **Existing widgets graceful fallback:** widgets edited before this plan have `widget.config.drillDownColumn` undefined; click handlers in Plan 10-04 will treat as empty and render no chip / fire no filter (no-op). Users acquire the new fields by clicking Apply once on the config panel — no DB migration required.
- **No blockers.** Phase 10 wave 2 plan 10-04 can proceed.

## Self-Check: PASSED

Verified after writing this summary:

- [x] `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — exists, contains the new import + memo + IIFE + JSX + onSave updates
- [x] Commit `9b6bb1e` exists in `git log` (Task 1: feat — drill-down column picker)
- [x] All 12 grep-acceptance counts met
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` reports 100/100 passing across 7 files

---
*Phase: 10-existing-chart-drill-down*
*Plan: 03*
*Completed: 2026-05-05*
