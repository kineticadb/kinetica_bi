---
phase: 120-import
plan: 01
subsystem: api
tags: [dashboard-export-import, id-remapping, sqlite, better-sqlite3, typescript]

# Dependency graph
requires:
  - phase: 119-export
    provides: "dashboardExportRefs.ts's collect* functions and the eight-reference-kind inventory (REF-1..8 + the filter_scope sixth site)"
provides:
  - "visitWidgetConfigRefs / visitFilterSelectionRefs — the single traversal enumerating all eight reference sites, driven by both collect (identity visitor) and remap (map-or-strip visitor)"
  - "remapWidgetConfigRefs / remapFilterSelection — pure, non-mutating remappers producing RemapOutcome { config, stripped, layerFilterWidened }"
  - "getTableBySchemaName(schema, name) — deterministic (oldest-row-wins) application-level table matching accessor, no schema change"
affects: ["120-02", "120-03", "120-04", "120-05"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One traversal, two visitors: a single hand-written enumeration of reference sites, driven by an identity visitor for collect and a map-or-strip visitor for remap — a ninth reference kind requires exactly one new block and both directions pick it up automatically"
    - "Unmapped reference = STRIP + report, never `?? oldId` fallback (Pitfall 3)"
    - "Sentinel-safe array rewriting: `asId()`-gate before any array element is touched, non-numeric entries pass through completely untouched, in original position"

key-files:
  created:
    - packages/server/tests/lib.dashboardImportRefs.spec.ts
  modified:
    - packages/server/src/lib/dashboardExportRefs.ts
    - packages/server/src/db.ts

key-decisions:
  - "Design A (single shared visitor) held for the full plan — no fallback to Design B was needed. Both Phase 119 regression specs (lib.dashboardExportRefs.spec.ts, routes.dashboard-export.spec.ts) stayed green with ZERO edits throughout."
  - "IMP-TRAP8 test interpreted as two DIFFERENT options in one options[] array (one legacy-shaped, one actions[]-shaped) rather than one option literally carrying both fields simultaneously — the shared getOptionActionsLike() reader is exclusive-OR (actions[] takes priority over legacy action when both are present on the SAME option), matching Phase 119's own collect-side semantics; a single option with both fields would only have actions[] processed by design, not a defect."
  - "Two doc-comments were rephrased mid-task after they were found to literally quote the same token sequence their own acceptance-criteria grep counted (the `ORDER BY id ASC LIMIT 1` prose restatement, and a `?? site.id` / `|| site.id` prose restatement) — caught by running the greps before committing, per CLAUDE.md's verifiable-acceptance-criteria rule."

requirements-completed: [DXIM-V124-05, DXIM-V124-06]

# Metrics
duration: 10min
completed: 2026-09-17
---

# Phase 120 Plan 01: Shared Reference Visitor + Remap + Table Matching Summary

**Collapsed Phase 119's eight hand-written collect branches into one visitor traversal (`visitWidgetConfigRefs`/`visitFilterSelectionRefs`), added a map-or-strip remap side (`remapWidgetConfigRefs`/`remapFilterSelection`) driven by the SAME traversal, and added `getTableBySchemaName` for import's table-matching — making collect/remap drift structurally impossible.**

## Performance

- **Duration:** ~10 min (commits span 2026-09-16T22:37:22 → 22:41:28 local; file reads preceded the first commit)
- **Completed:** 2026-09-17
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `visitWidgetConfigRefs` is now the ONLY place the eight reference sites (REF-1..8) are enumerated; `collectWidgetConfigRefs`/`collectFilterSelectionRefs` drive it with an identity visitor, `remapWidgetConfigRefs`/`remapFilterSelection` drive it with a map-or-strip visitor
- Both Phase 119 regression spec files (`lib.dashboardExportRefs.spec.ts`, `routes.dashboard-export.spec.ts`) pass **unmodified**, proving the collector's output is byte-identical after the refactor
- All three rewrite traps implemented and each probe-verified: REF-6 empty-array sentinel (never expanded to the full layer list; `layerFilterWidened` surfaces the unfixable all-unmapped-elements case), REF-7 `__spatial_draws__` sentinel (survives byte-identical, never coerced), REF-8 legacy singular `options[].action` (rewritten identically to `actions[]`)
- Unmapped references are STRIPPED and reported in `RemapOutcome.stripped` (kind + OLD id) — never left pointing at a pre-existing record in the target environment (Pitfall 3)
- `getTableBySchemaName` added with a documented, deliberate limitation (oldest-row-wins tie-break; no schema change)
- 10/10 mutation probes fired and reverted; source confirmed byte-identical to the committed state afterward

## Task Commits

1. **Task 1: Collapse collect into a single visitor traversal** - `542e802` (refactor)
2. **Task 2: remapWidgetConfigRefs + remapFilterSelection + per-kind unit tests** - `e71dd93` (feat, TDD: test file written RED first in the same commit as the GREEN implementation — both existed only in the working tree until verified together)
3. **Task 3: getTableBySchemaName accessor + 10 mutation probes** - `dc84698` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Final Exported Symbol List

From `packages/server/src/lib/dashboardExportRefs.ts` (Plans 02/03 import these verbatim):

```
RefKind, ExportRefs, RefIdMaps, RefVisitor, VisitNotes, RemapOutcome, StrippedRef,
emptyExportRefs, emptyRefIdMaps, mergeExportRefs,
collectFilterSelectionRefs, collectWidgetConfigRefs, collectLayerRefs, collectDynamicViewRefs,
visitWidgetConfigRefs, visitFilterSelectionRefs,
remapWidgetConfigRefs, remapFilterSelection
```

This matches the plan's `must_haves.artifacts.exports` list exactly.

From `packages/server/src/db.ts`: `getTableBySchemaName(schema, name)`.

## Design A vs Design B

**Design A (single shared visitor) held for the entire plan.** No fallback to Design B was needed —
both Phase 119 regression specs stayed green with zero edits throughout Task 1's refactor and
Task 2's remap addition.

## Mutation Probe Table (10/10 fired)

| # | Mutation | Test(s) reddened | Fired? |
|---|---|---|---|
| P1 | `remapWidgetConfigRefs`'s success branch returns `site.id` instead of `mapped` (no-op remapper) | `IMP-REF1` + 14 other tests (15 total) | YES |
| P2 | Deleted the REF-2 `dynamicViewId` block from `visitWidgetConfigRefs` | `IMP-REF2`, `IMP-STRIP` | YES |
| P3 | Deleted the REF-3 `sourceMapWidgetId` block | `IMP-REF3`, `IMP-STRIP` | YES |
| P4 | Deleted the REF-4 scalar `metricId` block | `IMP-REF4`, `IMP-STRIP` | YES |
| P5 | Deleted the REF-5 `metrics[]` loop | `IMP-REF5`, `IMP-STRIP5` | YES |
| P6 | REF-6 "helpful expansion": empty `includedLayerIds` materialised to `[...maps.layer.values()]` | `IMP-TRAP6: an EMPTY includedLayerIds array stays []...` | YES |
| P7 | REF-7 naive `arr.map(e => visit(...))` with no `asId` gate | Both `IMP-TRAP7` tests + `IMP-STRIP7` | YES |
| P8 | Narrowed `getOptionActionsLike` to only `actions[]`, dropping the legacy fallback | `IMP-REF8: the LEGACY singular...`, `IMP-TRAP8`, `IMP-STRIP8` (legacy) | YES |
| P9 | Pitfall 3: miss branch returns `site.id` instead of `undefined` (fallback to old id) | 7 of 8 `IMP-STRIP*` tests (the 8th, `IMP-STRIP`, only asserts `.stripped`, which is still populated correctly under this mutation and so does not redden — expected, not a gap) | YES |
| P10 | `getTableBySchemaName`'s `ORDER BY id ASC` → `ORDER BY id DESC` | `TBLMATCH: getTableBySchemaName returns the OLDEST row when duplicates exist` | YES |

**10/10 probes fired.** No test required strengthening. Each mutation was applied to the source,
verified red, then reverted via `git checkout --`; `git diff --exit-code` confirmed byte-identical
source after every revert and again after the full sequence.

## No Ninth Reference Kind Found

No reference kind beyond the eight named in 119/120-RESEARCH.md was encountered. The traversal's
structure (one block per REF-n, driven generically) means a future ninth kind is a one-block
addition to `visitWidgetConfigRefs`, picked up automatically by both `collect*` and `remap*`.

## Files Created/Modified
- `packages/server/src/lib/dashboardExportRefs.ts` - Added `RefVisitor`/`VisitNotes` types, `visitWidgetConfigRefs`, `visitFilterSelectionRefs`, `cloneJson`; rewired the four `collect*` functions to drive the visitor with an identity callback; added `RefIdMaps`/`StrippedRef`/`RemapOutcome`/`emptyRefIdMaps`/`remapWidgetConfigRefs`/`remapFilterSelection`
- `packages/server/src/db.ts` - Added `getTableBySchemaName(schema, name)` immediately after `getTable`
- `packages/server/tests/lib.dashboardImportRefs.spec.ts` - New file: 27 tests (9 `IMP-REF*`, 5 `IMP-TRAP*`, 8 `IMP-STRIP*`, 3 `IMP-PURE*`, 2 `TBLMATCH*`) plus the 10-probe record in its header comment

## Decisions Made
- Design A held throughout; no Design-B fallback needed (see above)
- `IMP-TRAP8`'s "an option carrying BOTH shapes" interpreted at the options-ARRAY level (one legacy option + one actions[] option) rather than one option object literally holding both fields — matches `getOptionActionsLike`'s existing exclusive-OR precedence, mirrored unchanged from Phase 119
- Rephrased two doc comments mid-task after discovering they self-tripped their own acceptance-criteria greps (a live instance of the CLAUDE.md "Writing verifiable acceptance criteria" warning, caught by running the greps before committing rather than after)

## Deviations from Plan

None beyond the two self-tripped-criterion doc-comment rewordings above (Rule 3 — blocking issue for the criteria to be checkable; fixed inline, re-verified, no test or behavior change).

## Issues Encountered

**Self-tripping acceptance criteria (caught before commit, per CLAUDE.md).** Two doc comments I wrote
initially quoted the exact token sequence their own grep-based acceptance criterion counted:
1. `getTableBySchemaName`'s comment restated the literal SQL fragment `ORDER BY id ASC LIMIT 1`,
   making the "After: exactly 1" criterion read 2. Reworded to describe the tie-break in prose without
   repeating the exact SQL string.
2. `remapWidgetConfigRefs`'s comment restated `?? site.id` / `|| site.id` literally, which the
   negative-space "no fallback anywhere" grep guard would have (correctly, but confusingly) flagged.
   Reworded to describe the rule without using either operator+identifier sequence.

Both were caught by running the exact acceptance-criteria commands before committing, exactly as
CLAUDE.md instructs — no code behavior changed, only comment wording.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plans 02-05 (import orchestrator, transaction, validation, report, route) can now import
`remapWidgetConfigRefs`, `remapFilterSelection`, `RefIdMaps`, `emptyRefIdMaps`, `RemapOutcome`,
`StrippedRef`, and `getTableBySchemaName` directly from this plan's output. No DXIM requirement
beyond DXIM-V124-05/-06 was marked complete — closure remains Plan 05's responsibility per this
plan's explicit scope boundary.

**Process note (per plan's own warning 8):** `gsd-tools state advance-plan` and
`roadmap update-plan-progress` were expected to fail to parse this project's STATE.md/ROADMAP.md
formats (all four Phase 119 waves hit this). STATE.md and ROADMAP.md were updated manually in the
existing style instead; see the STATE.md/ROADMAP.md diffs in the plan-metadata commit that follows
this SUMMARY.

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/dashboardExportRefs.ts`
- FOUND: `packages/server/src/db.ts`
- FOUND: `packages/server/tests/lib.dashboardImportRefs.spec.ts`
- FOUND: `.planning/phases/120-import/120-01-SUMMARY.md`
- FOUND commit: `542e802` (Task 1)
- FOUND commit: `e71dd93` (Task 2)
- FOUND commit: `dc84698` (Task 3)

---
*Phase: 120-import*
*Completed: 2026-09-17*
