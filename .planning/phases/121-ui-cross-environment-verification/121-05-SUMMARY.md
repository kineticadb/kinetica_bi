---
phase: 121-ui-cross-environment-verification
plan: 05
subsystem: ui
tags: [zustand, sql-parser, custom-metrics, gap-closure]

# Dependency graph
requires:
  - phase: 100 (METRIC-V119-04)
    provides: resolveMetricExpr / isCustomSelection (customMetricSql.ts) — the null/expression
      contract this plan builds on top of, unchanged
provides:
  - isMetricsHydrated(tableId) — a pure store selector distinguishing "table never loaded" from
    "table loaded, metric absent (deleted)"
  - parseAggregatedSelectList / replaceValueSelectItem / applyLiveMetricExpr (liveMetricSql.ts) —
    a fail-closed, positional select-item swap for the four SQL shapes ChartConfigPanel emits,
    fully unit-proven but imported by nothing yet
affects: [121-06 (wires applyLiveMetricExpr into AggregatedWidgetRenderer)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Depth- and quote-aware character-walk scanner (scanTopLevel) shared by comma-splitting and
      FROM-detection — the correct generalization of the customWhere.ts / fromSwap.ts pure-lib
      idiom for a case where naive regex/split is provably unsafe"
    - "Positional anchor over name-based anchor: the LAST select-list item aliased AS value is the
      unambiguous target even when a real column is itself named 'value'"
    - "Fail-closed resolution ladder: six explicit states (non-custom / no-tableid / unhydrated /
      orphan / unparseable / resolved), each pinned by one named test — never a fallthrough default"

key-files:
  created:
    - packages/web/src/lib/liveMetricSql.ts
    - packages/web/src/lib/liveMetricSql.spec.ts
  modified:
    - packages/web/src/store/customMetricsStore.ts
    - packages/web/src/store/customMetricsStore.spec.ts

key-decisions:
  - "Targeted select-item swap at render time (option b), not a renderer-side SQL rebuild (option
    a) — AggregatedWidgetRenderer has no `tables`/`columnTypeMap` prop, so a rebuild would emit an
    unbucketed heatmap query on the async-load path; a rebuild would also silently re-derive limit
    ladders and customWhere formatting for widgets that are not broken. See PLAN's <design_decision>."
  - "Reworded one docstring line in customMetricsStore.ts (kept the meaning, changed the literal
    text) because the plan's own suggested comment embedded the exact substring one of the plan's
    own acceptance-criteria greps was asserting must NOT appear in the file — see 'Criterion that
    could not discriminate' below."
  - "isMetricsHydrated is a NEW export used only by liveMetricSql.ts this plan — zero call sites in
    components yet, by design (Plan 121-06 wires it)."

requirements-completed: [DXIM-V124-10]

duration: 17min
completed: 2026-09-18
---

# Phase 121 Plan 05: Live Custom-Metric SQL Resolution (pure lib + store) Summary

**A depth- and quote-aware parser (`liveMetricSql.ts`) that swaps a custom metric's frozen
`config.sql` expression for its live definition, plus `isMetricsHydrated` splitting "never loaded"
from "metric deleted" in the metrics store — zero renderer wiring, fully unit-proven.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-09-18T14:36:00-04:00 (approx, first Read)
- **Completed:** 2026-09-18T14:52:35-04:00
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `isMetricsHydrated(tableId)` — 5 new `METRICSTORE-HYDRATED-` tests, 21 pre-existing tests
  untouched (26 total in the file).
- `liveMetricSql.ts` — a shared `scanTopLevel` character-walk scanner (quote + paren depth aware)
  powering both `parseAggregatedSelectList` and `replaceValueSelectItem`, plus
  `applyLiveMetricExpr` implementing all six resolution states from the plan's design table.
- 17 new `LIVEMETRIC-` tests (11 parser + 6 resolution), including one beyond the plan's stated
  minimum (`LIVEMETRIC-parse-comma-inside-string-literal`, explicitly called for in the plan text)
  — 4091 total web tests, up from the 4069 baseline (180 files, up from 179).
- 6/6 mutation probes (P1-P6) reddened their NAMED test on the first attempt — see table below.

## Task Commits

1. **Task 1: isMetricsHydrated — split "never loaded" from "metric deleted"** - `1237997` (feat)
2. **Task 2: liveMetricSql.ts — depth- and quote-aware select-item swap** - `4f393b9` (feat)

**Plan metadata:** (this commit, appended after SUMMARY)

## Files Created/Modified

- `packages/web/src/lib/liveMetricSql.ts` — new pure lib: `parseAggregatedSelectList`,
  `replaceValueSelectItem`, `applyLiveMetricExpr`, `LiveMetricSql` type. 199 lines.
- `packages/web/src/lib/liveMetricSql.spec.ts` — new spec: 17 `it()` blocks, all `LIVEMETRIC-`
  prefixed. 197 lines.
- `packages/web/src/store/customMetricsStore.ts` — added `isMetricsHydrated` selector (15 lines).
- `packages/web/src/store/customMetricsStore.spec.ts` — added a 5-test describe block.

## Decisions Made

- Followed the plan's `applyLiveMetricExpr` control flow verbatim (the six-line if-ladder given in
  `<action>`) — it is the load-bearing ordering (cheap guards before the parser; hydration check
  before resolution).
- See `key-decisions` in frontmatter for the docstring rewording and the renderer-vs-swap
  rationale (already decided by the plan; not re-litigated).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Off-by-one in the top-level `FROM` token length**
- **Found during:** Task 2, first test run (writing the spec before running mutation probes)
- **Issue:** `scanTopLevel`'s FROM-detection compared `str.slice(i, i + 7)` against the 6-character
  literal `" FROM "` — the slice was always one character too long, so the comparison could never
  match except by end-of-string truncation luck. This is exactly the kind of bug the plan's
  mutation-probe discipline exists to catch, except here it was caught by the ordinary (non-probe)
  spec run before probes were even attempted: 9 of 17 tests reddened.
- **Fix:** Changed `i + 7` to `i + 6` (`" FROM ".length === 6`, verified with `node -e`).
- **Files modified:** `packages/web/src/lib/liveMetricSql.ts`
- **Verification:** All 17 spec tests pass after the fix; re-verified with `node -e 'console.log(" FROM ".length)'` → `6`.
- **Committed in:** `4f393b9` (Task 2 commit — the bug was fixed before the task was ever committed,
  so there is no separate "buggy" commit in history).

---

**Total deviations:** 1 auto-fixed (1 bug, caught by the task's own test suite before any commit).
**Impact on plan:** Zero — the bug never reached a commit. No scope creep.

### Criterion that could not discriminate (per CLAUDE.md)

The plan's Task 1 `<action>` block specifies a docstring for `isMetricsHydrated` that literally
contains the text `` selectMetrics(tableId).length > 0 `` as an illustration of the WRONG
predicate to use. The plan's own Task 1 acceptance criterion is:
`grep -c "selectMetrics(tableId).length" packages/web/src/store/customMetricsStore.ts` → `0`.
Copying the plan's suggested comment verbatim makes that grep read `1`, not `0` — the criterion and
the plan's own example code contradict each other. Per CLAUDE.md ("if an executor finds a criterion
that cannot discriminate... verify the real requirement directly"): the REAL requirement is that
`isMetricsHydrated`'s IMPLEMENTATION must not compute hydration via a row-count check — which it
doesn't (it uses `configs[tableId] !== undefined`). I reworded the docstring's illustrative anti-
pattern to "a row-count check against the flattened selector's result" (same meaning, different
substring) so the grep genuinely reads 0 on a clean pass rather than accidentally 0/1 depending on
comment wording. Verified: `grep -c "selectMetrics(tableId).length" ...` → `0` after the reword.

## Issues Encountered

None beyond the FROM-length bug documented above, which was caught and fixed within Task 2 before
any commit.

## Mutation Probe Results (P1-P6)

All six probes were applied to a saved-off copy of `liveMetricSql.ts`, run against the spec, then
reverted (verified byte-identical via `diff` against the backup after each revert and once more at
the end).

| # | Deliberate break | Named test | Result | Collateral |
|---|---|---|---|---|
| P1 | `replaceValueSelectItem` takes the FIRST select item instead of the LAST | `LIVEMETRIC-parse-last-item` | **REDDENED** | 5 others also reddened (single-group, comma-inside-parens, heatmap-bucket, comma-inside-string-literal, resolved-swaps-expression) — expected, since most fixtures have >1 item |
| P2 | split the select list on every comma, ignoring paren depth | `LIVEMETRIC-parse-comma-inside-parens` | **REDDENED** | 1 other (heatmap-bucket, which also has a paren-nested comma) |
| P3 | ignore quote state when scanning for the top-level ` FROM ` | `LIVEMETRIC-parse-from-inside-string-literal` | **REDDENED** | none |
| P4 | orphan (hydrated, id absent) returns `{kind:"pending"}` instead of the stored SQL | `LIVEMETRIC-orphan-returns-stored` | **REDDENED** | none |
| P5 | drop the `isCustomSelection` guard so non-custom SQL goes through the parser | `LIVEMETRIC-noncustom-identity` | **REDDENED** | none |
| P6 | unhydrated returns `{kind:"ready", sql: storedSql}` instead of `{kind:"pending"}` | `LIVEMETRIC-unhydrated-pending` | **REDDENED** | none |

6/6 probes reddened their named test on the first attempt — no test needed strengthening.

## Test Gates (real numbers)

- `cd packages/web && npx tsc --noEmit` → **clean** (0 errors)
- `cd packages/web && npx vitest run` → **180 files / 4091 tests / 0 failed** (baseline was 179
  files / 4069 tests; this plan added 1 new file — `liveMetricSql.spec.ts` — contributing 17 tests,
  plus 5 tests appended to the existing `customMetricsStore.spec.ts`; 17 + 5 = 22, and
  4069 + 22 = 4091, exactly as expected)
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **152/152** (unchanged — this
  plan touched zero CSS/components)
- `cd packages/server && npx tsc --noEmit` → **clean** (0 errors; server untouched)
- `git diff --numstat HEAD -- packages/server` → **empty**
- `git diff --numstat HEAD -- packages/web/src/components` → **empty**
- `grep -rc "liveMetricSql" packages/web/src/components` → **0 everywhere** (nothing wired yet, by
  design — confirmed across the whole components tree, not just spot-checked)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`applyLiveMetricExpr` is exported, fully unit-tested against all six resolution states and all
positional-parser edge cases named in the plan, and imported by nothing. Plan 121-06 can now wire
it into `AggregatedWidgetRenderer` (the ONLY remaining step to close DXIM-V124-10): call
`applyLiveMetricExpr(cfg.sql, cfg.metricId, cfg.tableId)` before the SQL is sent, suspend rendering
on `{kind:"pending"}`, and use `.sql` otherwise. No blockers.

---
*Phase: 121-ui-cross-environment-verification*
*Completed: 2026-09-18*

## Self-Check: PASSED

- FOUND: packages/web/src/lib/liveMetricSql.ts
- FOUND: packages/web/src/lib/liveMetricSql.spec.ts
- FOUND: .planning/phases/121-ui-cross-environment-verification/121-05-SUMMARY.md
- FOUND: commit 1237997 (Task 1)
- FOUND: commit 4f393b9 (Task 2)
