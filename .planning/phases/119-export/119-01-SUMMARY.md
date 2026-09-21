---
phase: 119-export
plan: 01
subsystem: api
tags: [export, dashboard, pure-function, dependency-walk, sqlite]

# Dependency graph
requires: []
provides:
  - "packages/server/src/lib/dashboardExportRefs.ts — pure reference-extraction walk over widgets.config, dashboard_layers, dashboard_dynamic_views"
  - "ExportRefs / RefKind types and emptyExportRefs / mergeExportRefs / collectFilterSelectionRefs / collectWidgetConfigRefs / collectLayerRefs / collectDynamicViewRefs — exact public surface Plan 02 and Phase 120 import verbatim"
affects: [119-02, 119-03, 119-04, 120-import]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "asId(v) — the single chokepoint where a raw JSON value becomes an id (number, integer, >0); every collector routes through it so the __spatial_draws__ sentinel and non-integer junk are rejected structurally, never by string comparison"
    - "normalize/dedupSorted — every ExportRefs returned by any collector is de-duplicated and ascending-sorted, so callers (and toEqual assertions) never see order- or duplicate-dependent output"

key-files:
  created:
    - packages/server/src/lib/dashboardExportRefs.ts
    - packages/server/tests/lib.dashboardExportRefs.spec.ts
  modified: []

key-decisions:
  - "getOptionActionsLike mirrors radioGroupConfig.ts's getOptionActions exactly: reads actions[] first, falls back to the legacy singular action field — never both, never neither silently dropped"
  - "collectFilterSelectionRefs accepts both a parsed object (widgets.config.filterSelection) and a raw JSON string (dashboard_layers.filter_scope's documented type-lie) via a single try/parse; unparseable JSON returns [] rather than throwing"
  - "REF-6 (includedLayerIds) empty array is explicitly a zero-ref case, not expanded to all layers — enforced by a dedicated probe (P... none needed, a direct test) and stated in both the source comment and the spec"

patterns-established:
  - "Pure lib module contract for Phase 120: no ./db, no express, no new dependency, only a type-only import from ../types — verified by grep in acceptance criteria, not just code review"

requirements-completed: [DXIM-V124-01, DXIM-V124-02]

# Metrics
duration: 5min
completed: 2026-09-16
---

# Phase 119 Plan 01: Dashboard Export Reference Walk Summary

**Pure `dashboardExportRefs.ts` module extracting all eight widget-config reference kinds (table, dynamicView, widget, customMetric scalar+array, layer array, filter-scope widget array with sentinel exclusion, polymorphic RadioGroup action target with legacy-field fallback) plus the layer/dynamic-view FK edges — proven complete by 21 named tests and 10/10 firing mutation probes.**

## Performance

- **Duration:** ~5 min (measured from first to last commit timestamp; wall-clock research/read time not included)
- **Started:** 2026-09-16T23:54:02Z
- **Completed:** 2026-09-16T23:58:30Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both newly created)

## Accomplishments
- Every one of the eight `REF-n` reference kinds named in `119-RESEARCH.md` §Q1 is extracted by a single pure module, each with its own named test (`REF-1:` through `REF-8:`).
- The three named traps are each explicitly handled and test-covered: the `__spatial_draws__` sentinel is rejected structurally by `asId`'s type/positivity check (never coerced, never string-compared); an empty `includedLayerIds` array yields zero layer refs (not "all layers"); the legacy singular `options[].action` field is walked identically to `actions[]` via `getOptionActionsLike`.
- Ten mutation probes (one per branch/trap) were run for real against the committed source, each reddening its named test, then reverted — source file confirmed byte-identical to its Task-1 state afterward (`git diff --exit-code` clean).
- No ninth reference kind was encountered beyond the eight in research — `collectWidgetConfigRefs`'s exhaustive walk plus the "not a reference" list (`tableRef`, `configPatch`, `cb_config`, `track_config`, `columns_json`, `format_spec`) matched research's inventory exactly.

## Task Commits

1. **Task 1 (RED): failing tests for all 8 reference kinds + traps** - `64a0b91` (test)
2. **Task 1 (GREEN): pure reference-extraction module** - `0961754` (feat)
3. **Task 2: 10/10 mutation probes run, recorded, reverted** - `93649f3` (test)

**Plan metadata:** this commit (docs: complete plan) — see below

_Note: Task 1 used the RED→GREEN TDD flow per its `tdd="true"` attribute; Task 2 was a non-TDD auto task that mutated and reverted the already-committed source file, with the probe record appended to the spec file's header comment._

## Files Created/Modified
- `packages/server/src/lib/dashboardExportRefs.ts` - the pure walk: `emptyExportRefs`, `mergeExportRefs`, `collectFilterSelectionRefs`, `collectWidgetConfigRefs`, `collectLayerRefs`, `collectDynamicViewRefs`, plus the private `asId`/`normalize`/`dedupSorted`/`getOptionActionsLike` helpers. Zero DB/Express imports; only `import type { DashboardLayer, DashboardDynamicView } from "../types"`.
- `packages/server/tests/lib.dashboardExportRefs.spec.ts` - 21 tests: one per `REF-n` (12 tests covering all 8 kinds plus the two sub-cases for REF-6/REF-7/REF-8), plus 9 robustness/edge tests (non-object config, string-vs-object filterSelection, unparseable JSON, asId boundary rejection, layer/dv collectors, merge/dedup). Header comment carries the 10-row `MUTATION PROBES` record.

## Decisions Made
- Both `getOptionActionsLike` and `asId` are private (non-exported) — the plan's exact public surface (six named exports) doesn't require them, and keeping them private avoids expanding the load-bearing contract Plan 02/Phase 120 depend on.
- The file-header module comment states the ninth-reference-kind maintenance obligation explicitly ("adding a ninth reference kind... requires updating this module and its spec") rather than only in this SUMMARY, since that's the artifact future engineers will actually be looking at when they add a new chart-type config field.
- Replaced two source-code comments that had originally quoted the literal `"__spatial_draws__"` string with a paraphrase pointing at `filterSourceTypes.ts` — the acceptance criterion (Task 1, criterion 4) requires the literal to appear ZERO times in the source file (proving the sentinel is rejected structurally by `asId`, not by name-matching), and the original comment wording violated its own criterion. Caught via the pre-commit acceptance-criteria run, fixed before committing — no code logic changed, only comment wording.

## Deviations from Plan

None (Rule 1/2/3 auto-fixes) beyond the self-caught comment-wording issue above, which is not a deviation from the plan's actual code contract — it's a correction to my own draft that was applied before the Task 1 commit, so it never shipped in a committed state. No architectural questions arose (no Rule 4 triggers). No auth gates encountered (pure module, no DB, no server boot needed for this plan's tests).

## Issues Encountered
- My first draft of the `MUTATION PROBES` header block used a `" *  * P1 ..."` double-bullet format that did not match the plan's exact required anchor regex (`^ \* P([1-9]|10) `, single leading `* `). Caught by running the plan's own verification command before committing (`grep -cE` returned 0 instead of 10) rather than assuming the acceptance criteria passed; rewrote the block to `" * P1 ..."` format and re-verified all three related greps (`^ \* P10 ` → 1, `^ \* P([1-9]|10) ` → 10, `__spatial_draws__` in spec → 2) before the Task 2 commit.

## User Setup Required

None - no external service configuration required. This plan touches only local, pure TypeScript with no environment/config dependency.

## Next Phase Readiness
- Plan 02 (the assembler that reads dashboards/widgets/layers/dynamic-views from SQLite and calls these collectors) can import `ExportRefs`, `RefKind`, `emptyExportRefs`, `mergeExportRefs`, `collectFilterSelectionRefs`, `collectWidgetConfigRefs`, `collectLayerRefs`, `collectDynamicViewRefs` verbatim — no further changes to this module's public surface are anticipated.
- Phase 120's remapper can consume the same `ExportRefs` inventory artifact once Plan 02 produces it.
- **No DXIM requirement was marked complete in `.planning/REQUIREMENTS.md` by this plan**, per this execution's explicit instruction. This plan's frontmatter names `DXIM-V124-01`/`DXIM-V124-02` as the requirements it contributes to, but the actual user-facing deliverable — a dashboard that can be exported to a JSON file with every widget's full configuration — doesn't exist until the assembler/envelope/route land in Plans 02-04. Only a pure internal library was built here; `requirements mark-complete` was intentionally NOT run (it was run once, found to add `[x]`/`Complete` rows to REQUIREMENTS.md, and reverted via `git checkout -- .planning/REQUIREMENTS.md` before this plan's final commit). Plans 02-04 remain, and whichever of them actually completes end-to-end export should mark DXIM-V124-01/02 complete.

---
*Phase: 119-export*
*Completed: 2026-09-16*

## Self-Check: PASSED

- FOUND: packages/server/src/lib/dashboardExportRefs.ts
- FOUND: packages/server/tests/lib.dashboardExportRefs.spec.ts
- FOUND: .planning/phases/119-export/119-01-SUMMARY.md
- FOUND commit: 64a0b91 (RED — failing tests)
- FOUND commit: 0961754 (GREEN — pure module)
- FOUND commit: 93649f3 (mutation probes recorded)
