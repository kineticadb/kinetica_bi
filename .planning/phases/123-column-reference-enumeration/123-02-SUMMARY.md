---
phase: 123-column-reference-enumeration
plan: 02
subsystem: database
tags: [column-reference-enumeration, schema-sync, pure-lib, table-scoping, spatial-targets]

# Dependency graph
requires:
  - phase: 123-column-reference-enumeration
    provides: "123-01's frozen ColumnRef contract, 40-entry COLUMN_REF_SITES registry, and the one-enumeration visitColumnRefSites traversal to extend"
provides:
  - "resolveWidgetTableId — the single dv-dual-write table-resolution rule (dv.source_table_id authority over cached config.tableId, dangling dv -> unresolved), exported for Plans 123-03/04 to mirror"
  - "emitStructured — the shared exact/case-sensitive structured-site emitter all widget.config.* sites use"
  - "14 structured widget-config sites implemented: 8 scalar/CSV (Task 1) + 6 array incl. spatialTargets' own-tableId scoping (Task 2)"
  - "The widget half of the exclude-list guard (EXCLUDED_LOOKALIKE_KEYS test suite) proving path-driven, not value-driven, identification"
affects: [124-column-impact-report, 125-schema-sync-apply-and-history, 123-03, 123-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveWidgetTableId: dv is the authority over cached config.tableId, checked FIRST; dangling dv -> unresolved (fail toward reporting), never fall back to the cache"
    - "spatialTargets[] elements resolve against their OWN tableId, computed independently per element, never inherited from the parent widget's resolved table (the REF-9 shape)"
    - "emitStructured: exact, case-SENSITIVE value===column equality — deliberately asymmetric with free-SQL's case-insensitive scanFreeSql from 123-01"

key-files:
  created: []
  modified:
    - packages/server/src/lib/columnRefs.ts
    - packages/server/tests/lib.columnRefs.spec.ts

key-decisions:
  - "resolveWidgetTableId checks config.dynamicViewId FIRST (dv is authority), config.tableId only as fallback — the dv/tableId agreement seen in every real dev-DB row is a save-time convention (ChartConfigPanel.tsx:1071-1084), not a schema guarantee"
  - "spatialTargets[] elements get an independently-computed own tableId/tableScope per element, resolved via the same asPositiveInt shape as resolveWidgetTableId but never reusing the widget's resolved value"
  - "spatialTargets[].lonCol/latCol/spatialCol are read unconditionally, never gated on the element's own spatialMode field, so a mode/field mismatch in stored data is never silently unreportable"
  - "widget.config.columns (CSV) is split on ',', trimmed, and each token compared exactly — still case-sensitive, still one ColumnRef per site (repeated tokens collapse via existing de-dup)"
  - "Local asPositiveInt/isPlainObject predicates re-implemented rather than importing dashboardExportRefs.ts's asId/isPlainObject, preserving the phase's zero-diff success criterion on that file"

patterns-established:
  - "Two-loop widget traversal: Task 1's scalar/CSV loop and Task 2's array loop are separate for-loops over input.widgets (each recomputing resolveWidgetTableId once) so each task's commit is a pure addition, never an edit to a block the previous commit's own tests already cover"

requirements-completed: [SSYNC-V125-07]

# Metrics
duration: ~65min
completed: 2026-09-23
---

# Phase 123 Plan 02: Widget Structured + Spatial Sites Summary

**14 structured `widget.config.*` column-reference sites (8 scalar/CSV + 6 array, including `spatialTargets[]`'s own-tableId scoping) plus `resolveWidgetTableId`, the single dv-dual-write table-resolution rule Plans 123-03/04 will mirror.**

## Performance

- **Duration:** ~65 min
- **Tasks:** 3 completed
- **Files modified:** 2 (both already existed from Plan 123-01)

## Accomplishments

- Shipped `resolveWidgetTableId` (exported, verbatim signature below) implementing the three-step dv-authority-over-cache rule, plus `emitStructured`, the shared exact/case-sensitive structured-site emitter.
- Implemented all 14 of this plan's `COLUMN_REF_SITES` entries: `metricColumn`, `groupByColumn`, `groupByColumns[]`, `drillDownColumn`, `timeCol`, `xField`, `deltaField`, `sortField`, `columns` (CSV), `metrics[].column`, `filterFields[].column`, `spatialTargets[].lonCol`/`.latCol`/`.spatialCol`.
- `spatialTargets[]` elements resolve against their OWN `tableId` — never the parent widget's — verified against widget 1's real fixture (two targets on tables 1 and 3, widget itself has no `config.tableId` at all).
- Added the widget half of the exclude-list guard: planting a real column name (`vendor_id`) under all 28 `EXCLUDED_LOOKALIKE_KEYS` yields zero findings, paired with a companion assertion proving the same fixture DOES fire once `metricColumn` is added (the anti-toothless pattern CLAUDE.md requires).
- 30 new tests (62 total, up from 32 after Plan 123-01); all 20 mutation probes fired and reddened their named test with no unexpected miss.
- `tsc --noEmit` clean in both packages; server test-gate SET unchanged (8/8 documented `KNOWN_FAILING`, 1302/1355 passing); `dashboardExportRefs.ts` sha256 unchanged; zero `packages/web` diff.

## Task Commits

1. **Task 1: resolveWidgetTableId and the eight scalar/CSV widget sites** - `ab2a095` (feat)
2. **Task 2: The six array widget sites, including spatialTargets' own tableId** - `66b778e` (feat)
3. **Task 3: The exclude-list guard** - `b4ce8ff` (test)

**Plan metadata:** pending — see final commit in this response.

## Files Created/Modified

- `packages/server/src/lib/columnRefs.ts` — added `asPositiveInt`, `isPlainObject`, `resolveWidgetTableId` (exported), `emitStructured`, the 8-site scalar/CSV loop, the 6-site array loop (incl. `spatialTargets[]`'s own-scoping), and a module-header note on the path-driven guarantee.
- `packages/server/tests/lib.columnRefs.spec.ts` — added `makeInput`, 3 new `describe` blocks (`widget structured sites — scalars`, `widget table resolution`, `widget structured sites — arrays`, `excluded look-alike keys`), 30 new tests.

## `resolveWidgetTableId` — verbatim (Plans 123-03/04 mirror this; Phase 124 explains `unresolved` to the operator)

```ts
export const resolveWidgetTableId = (
  config: Record<string, unknown>,
  dynamicViews: DashboardDynamicView[],
): { tableId: number | null; tableScope: ColumnRefTableScope } => {
  const dvId = asPositiveInt(config.dynamicViewId);
  if (dvId !== undefined) {
    const dv = dynamicViews.find((d) => d.id === dvId);
    if (dv) return { tableId: dv.source_table_id, tableScope: "scoped" };
    return { tableId: null, tableScope: "unresolved" };   // dangling dv -> NEVER fall back to config.tableId
  }
  const tableId = asPositiveInt(config.tableId);
  if (tableId !== undefined) return { tableId, tableScope: "scoped" };
  return { tableId: null, tableScope: "unresolved" };
};
```

Rules, in order (do not reorder): (1) `config.dynamicViewId` present and resolves -> the dv's `source_table_id` wins, even when it disagrees with the cached `config.tableId` (Task 1's dv-bound SCOPE test, using dv 1 with `source_table_id: 4` against a widget carrying `tableId: 1`, proves the dv wins). (2) `config.dynamicViewId` present but dangling -> `unresolved`, reported regardless of the queried table — never silently falls back to the cache. (3) No `dynamicViewId` -> `config.tableId` directly. (4) Neither -> `unresolved`.

`spatialTargets[]` elements do **not** use this function's output — each element computes its own `{ tableId, tableScope }` independently from its own `el.tableId` field (same `asPositiveInt` shape, `unresolved` if absent), and this own-resolution is used for that element's `lonCol`/`latCol`/`spatialCol` findings regardless of what the parent widget resolved to.

## Real vs. SYNTHETIC fixtures (risk noted per the plan's `<output>` requirement)

| Site | Fixture | Status |
|---|---|---|
| `metricColumn`, `groupByColumn`, `drillDownColumn` | widget 4 (real, table 1) | REAL |
| `timeCol` | widget 24 (real, table 6) | REAL |
| `xField` | widget 104 (real, table 1) | REAL |
| `columns` (single token) | widget 69 (real, table 8) | REAL |
| `groupByColumns[]` | widget 60 (real, table 8) | REAL |
| `metrics[].column` | widget 24 (real, table 6) | REAL |
| `filterFields[].column` | widget 25 (real, table 6) | REAL |
| `spatialTargets[].lonCol`/`.latCol` | widget 1 (real, tables 1 & 3) | REAL |
| `deltaField` | synthetic bignumber widget | **SYNTHETIC** — every real bignumber widget has `deltaField: ""` |
| `sortField` | synthetic records widget | **SYNTHETIC** — every real records widget has `sortField: ""` |
| `columns` (multi-token split) | synthetic `"emirate, operator ,cluster"` | **SYNTHETIC** — the only real value (widget 69) is a single token |
| dangling-dv table resolution | synthetic widget, `dynamicViewId: 4242` | **SYNTHETIC** — every real dv reference in the dev DB resolves |
| `spatialTargets[].spatialCol` | synthetic wkt-mode target | **SYNTHETIC** — zero wkt-mode targets and zero `spatialCol` values in either database |

`spatialTargets[].spatialCol` was confirmed zero-instance **during PLANNING** (a read-only `select count(*) from widgets where config like '%spatialCol%'` returned 0, as did a `"spatialMode":"wkt"` query), not by 123-RESEARCH.md's own zero-instance table — making it a **ninth** zero-instance site on top of the eight the research listed. The risk stated in the plan holds: a site with no real data behind it is where a bug survives a suite built from real fixtures, which is why the mode/field-gating trap (reading `el.spatialMode` to decide which column field to check) was explicitly avoided rather than merely tested against.

## Mutation Probes (20/20 verified)

Each probe was applied to the committed source, the named test confirmed to redden (with expected collateral noted), then reverted via `git checkout -- src/lib/columnRefs.ts` before the next probe. No probe required weakening; none required editing a probe to make it fire.

| # | Mutation | Named test | Result |
|---|----------|-----------|--------|
| P1 | Delete the `metricColumn` block | SITE widget.config.metricColumn: ... | reddened (+5 collateral: 4 SCOPE tests and 1 EXCLUDE test that reuse `metricColumn` as their probe column, expected) |
| P2 | Delete the `groupByColumn` block | SITE widget.config.groupByColumn: ... | reddened, no collateral (run with `-t` filter in isolation) |
| P3 | Delete the `drillDownColumn` block | SITE widget.config.drillDownColumn: ... | reddened, no collateral |
| P4 | Delete the `timeCol` block | SITE widget.config.timeCol: ... | reddened, no collateral |
| P5 | Delete the `xField` block | SITE widget.config.xField: ... | reddened, no collateral |
| P6 | Delete the `deltaField` block | SITE widget.config.deltaField: ... (SYNTHETIC) | reddened, no collateral |
| P7 | Delete the `sortField` block | SITE widget.config.sortField: ... (SYNTHETIC) | reddened, no collateral |
| P8 | Delete the `columns` block | SITE widget.config.columns: ... | reddened, no collateral |
| P9 | Stop splitting `config.columns` on commas | the comma-separated columns string splits and trims: ... | reddened, no collateral |
| P10 | Delete the `groupByColumns[]` block | SITE widget.config.groupByColumns[]: ... | reddened, no collateral |
| P11 | Delete the `metrics[].column` block | SITE widget.config.metrics[].column: ... | reddened, no collateral |
| P12 | Delete the `filterFields[].column` block | SITE widget.config.filterFields[].column: ... | reddened, no collateral |
| P13 | Delete the `spatialTargets[].lonCol` block | SITE widget.config.spatialTargets[].lonCol: ... | reddened, no collateral |
| P14 | Delete the `spatialTargets[].latCol` block | SITE widget.config.spatialTargets[].latCol: ... | reddened, no collateral |
| P15 | Delete the `spatialTargets[].spatialCol` block | SITE widget.config.spatialTargets[].spatialCol: ... (SYNTHETIC) | reddened, no collateral |
| P16 | Make spatialTargets elements inherit the widget's `resolved` instead of their own `tableId` | SCOPE: a spatialTargets element resolves against its OWN tableId, never the widget's | reddened (widget 1 has no `config.tableId` -> inherited `resolved` is `unresolved` -> `tableId: null` where `3` was expected) |
| P17 | In `resolveWidgetTableId`, check `config.tableId` FIRST | SCOPE: a dv-bound widget resolves through the dynamic view's source_table_id, not config.tableId | reddened (finding vanished for table 4, the dv's true table, because `config.tableId: 1` won instead) |
| P18 | On a dangling `dynamicViewId`, fall back to `config.tableId` | SCOPE: a widget whose dynamicViewId is dangling is reported with tableScope 'unresolved' ... | reddened (finding became `scoped` to the cached `tableId: 1` and vanished for the queried table 7) |
| P19 | Make structured matching case-insensitive | structured matching is case-SENSITIVE: querying MCC does not match a widget whose groupByColumn is mcc | reddened (a spurious `scoped`/`exact` finding appeared) |
| P20 | Add a generic fallback comparing every string value in `config` against the queried column | EXCLUDE: a widget config with the queried column name planted under EVERY excluded key yields zero findings | reddened (a spurious finding appeared at a fabricated `config.__generic__` path) |

## Non-Discriminating Acceptance Criterion (per CLAUDE.md — reported, not gamed)

**Task 2, acceptance criterion 4** (the `node -e` check that the `spatialTargets` block does not branch on `el.spatialMode`):

```
node -e "const s=...readFileSync('src/lib/columnRefs.ts','utf8');
const i=s.indexOf('spatialTargets'); const j=s.indexOf('spatialCol');
process.exit(i>=0 && j>i && !/spatialTargets[\s\S]{0,1500}el\.spatialMode/.test(s) ? 0 : 1)"
```

This exits **0** (passes) as written, but the reason it passes is not fully load-bearing: `s.indexOf('spatialTargets')` finds the **first** occurrence of that substring, which is inside `COLUMN_REF_SITES`'s own registry entry text (`"widget.config.spatialTargets[].lonCol"`, index 4218) — not the actual `if (Array.isArray(cfg.spatialTargets))` implementation block, which lives at index 30054, roughly 26,000 characters later and entirely outside the checked 1500-character window. The check's window never reaches the real block it is meant to guard.

**Real requirement verified directly:** `grep -c "el.spatialMode" src/lib/columnRefs.ts` (and a plain string search across the whole file) confirms `el.spatialMode` never appears anywhere in the file — the `spatialTargets[]` block reads `el.lonCol`, `el.latCol` and `el.spatialCol` unconditionally, exactly as the plan's `<action>` specifies, with no branch on the element's own spatial-mode field. This is additionally exercised by the EXCLUDE test ("a wkt-mode spatialTargets element yields a finding for spatialCol but NOT for spatialMode"), which asserts the block fires on `spatialCol` and produces no separate finding attributable to `spatialMode`.

## Decisions Made

- **`resolveWidgetTableId` exported** (not file-local) because Plans 123-03/04 mirror its exact rule and there must be exactly one implementation project-wide, per the plan's own instruction.
- **`asPositiveInt`/`isPlainObject` re-implemented locally**, not imported from `dashboardExportRefs.ts`, preserving that file's zero-diff phase success criterion (verified: sha256 unchanged across all three commits).
- **Two separate for-loops over `input.widgets`** (Task 1's scalar/CSV sites, Task 2's array sites) rather than one combined loop, so each task's commit is a pure addition that never edits a block the previous commit's own tests already cover — mirrors Plan 123-01's task-boundary-by-commit convention.
- **`spatialTargets[]` never reads `el.spatialMode`** to decide which field to check; all three fields are read unconditionally, per the plan's explicit instruction that gating on mode would make a mode/field mismatch in stored data silently unreportable.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes were needed; no architectural questions arose.

## Issues Encountered

None beyond the one non-discriminating acceptance criterion documented above, which was investigated and the real requirement verified directly per CLAUDE.md, rather than gamed or used to justify a code change.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `resolveWidgetTableId` and `emitStructured` are ready for Plan 123-03 (layer structured sites) and Plan 123-04 (`configPatch` copies + `columnDisplayConfig`) to mirror/reuse conceptually.
- The widget half of the exclude-list guard (`makeInput`, the planted-fixture pattern, the anti-toothless companion assertion) is in place for Plan 123-03 to extend with a `layers` fixture and Plan 123-04 with a `configPatch` fixture.
- `COLUMN_REF_SITES` remains at all 40 entries (golden-tested, unchanged); 14 more are now implemented (20 of 40 total after this plan: 6 from 123-01 + 14 from this plan).
- `dashboardExportRefs.ts` sha256 unchanged; zero `packages/web` diff — both phase-level success criteria hold.
- No blockers.

---
*Phase: 123-column-reference-enumeration*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/columnRefs.ts`
- FOUND: `packages/server/tests/lib.columnRefs.spec.ts`
- FOUND: `.planning/phases/123-column-reference-enumeration/123-02-SUMMARY.md`
- FOUND commit: `ab2a095` (Task 1)
- FOUND commit: `66b778e` (Task 2)
- FOUND commit: `b4ce8ff` (Task 3)
