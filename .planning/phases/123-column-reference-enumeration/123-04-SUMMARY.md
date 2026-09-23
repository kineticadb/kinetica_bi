---
phase: 123-column-reference-enumeration
plan: 04
subsystem: database
tags: [column-reference-enumeration, schema-sync, pure-lib, configPatch, mutation-probes, requirements-closure]

# Dependency graph
requires:
  - phase: 123-column-reference-enumeration
    provides: "123-01's frozen ColumnRef contract + 40-entry COLUMN_REF_SITES registry; 123-02's resolveWidgetTableId/emitStructured; 123-03's resolveLayerTableId/readJsonString/emitMalformedJsonFallback — all mirrored/reused by this plan's configPatch walk"
provides:
  - "The final 9 site blocks: the traversal is COMPLETE at 40/40"
  - "resolveConfigPatchTableId + getOptionActionsLike — the configPatch target-resolution and both-action-shape walk, exported for Phase 124/125 to understand"
  - "The 40/40 coverage guard (master sentinel fixture) proving no site can be silently deleted from the registry OR the traversal"
  - "SSYNC-V125-07 and SSYNC-V125-08 closed in .planning/REQUIREMENTS.md"
affects: [124-column-impact-report, 125-schema-sync-apply-and-history]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getOptionActionsLike: file-local mirror of dashboardExportRefs.ts's helper of the same name (never imported) — walks both options[].actions[] (plural) and options[].action (legacy singular)"
    - "resolveConfigPatchTableId: dispatches on action.target.kind to resolveLayerTableId/resolveWidgetTableId; a dynamicView-target patch is skipped entirely by the CALLER (never even asked to resolve), since DYNAMIC_VIEW_ALLOW_LIST holds only `enabled`"
    - "One shared fixture reaches all 40 sites: no site block gates on widget.type, so a single synthetic widget/layer/dv/metric/tableView/columnDisplayConfig record set, each field given a UNIQUE sentinel column name, exercises the entire registry in one pass"
    - "Deliberate-deletion proof: the coverage guard was PROVEN to fail (not merely asserted to be capable of failing) by literally deleting a block, observing the redden, and restoring"

key-files:
  created: []
  modified:
    - packages/server/src/lib/columnRefs.ts
    - packages/server/tests/lib.columnRefs.spec.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "widget.config.options[].configPatch.metric is the ONE registry entry ROADMAP criterion 2 does not name — included per 123-CONTEXT.md's statement that chart.metric is a column name, flagged here for the operator (see 'The configPatch.metric Decision' below)"
  - "A dynamicView-target configPatch is skipped ENTIRELY before resolveConfigPatchTableId is even called, not reported as 'unresolved' — DYNAMIC_VIEW_ALLOW_LIST holds exactly one field (enabled), so no column can ever reach it"
  - "resolveConfigPatchTableId dispatches to resolveLayerTableId/resolveWidgetTableId rather than re-implementing table resolution a third time — one function per record kind, reused verbatim"
  - "The master coverage fixture uses ONE shared record set (one widget + one layer + one dv + one metric + one tableView + one columnDisplayConfig row) rather than 40 per-site fixtures, because no site block gates on widget.type — proven by the coverage test passing on first run with zero sentinel collisions"
  - "This plan is the sole owner of .planning/REQUIREMENTS.md for this phase — no other 123-0x plan touches it, per the Phase-122-wave-collision lesson"

requirements-completed: [SSYNC-V125-07, SSYNC-V125-08]

# Metrics
duration: ~100min
completed: 2026-09-23
---

# Phase 123 Plan 04: The configPatch Walk, the 40/40 Coverage Guard, and Requirement Closure Summary

**The final 9 sites (both configPatch action shapes, target-scoped, plus columnDisplayConfig) close the 40-site registry; a sentinel-based master fixture and a deliberate, observed deletion prove the coverage guard can actually fail; SSYNC-V125-07/08 close.**

## Performance

- **Duration:** ~100 min
- **Tasks:** 3 completed
- **Files modified:** 3 (`columnRefs.ts`, `lib.columnRefs.spec.ts`, `.planning/REQUIREMENTS.md`)

## Accomplishments

- Implemented the final 9 `COLUMN_REF_SITES` entries: `configPatch.metric`, `configPatch.cb_config.attr`, `configPatch.track_config.{trackIdAttr,trackOrderAttr,xCol,yCol}`, `configPatch.info_columns`, `configPatch.info_template`, and `columnDisplayConfig.column_name`. **The traversal is now complete at 40/40.**
- `getOptionActionsLike` (file-local, mirrors `dashboardExportRefs.ts`'s helper of the same name, never imported) walks BOTH the plural `options[].actions[]` and legacy singular `options[].action` shapes, reconciling all 12 real dev-DB `configPatch` copies (11 `cb_config` + 1 `track_config`).
- `resolveConfigPatchTableId` (exported) dispatches on `action.target.kind` to `resolveLayerTableId`/`resolveWidgetTableId`; a dynamicView-target patch is skipped entirely by the caller before this function is even invoked for it.
- Every `configPatch` finding is owned by the radio-group WIDGET but SCOPED to the TARGET record's table — proven distinct from the layer's own matching finding (same column, two findings, different `recordKind`).
- `columnDisplayConfig.column_name` emits `recordId: null` for its composite-key row, identified by `(tableId, recordLabel)`.
- Built ONE master sentinel fixture (one widget + one layer + one dv + one metric + one tableView + one columnDisplayConfig row) reaching all 40 sites in a single pass, with zero sentinel collisions on first run.
- **Deliberately deleted** the `widget.config.metricColumn` block, ran the suite, confirmed BOTH the coverage test and that site's own `SITE` test reddened (plus 4 expected collateral tests), then restored it — the literal proof that the coverage guard can fail.
- Ran the full 72-probe mutation sweep (18 new + 54 re-run from Plans 123-01/02/03) against the final 40-site module — **all 72 fired correctly** (2 required fixing a bug in the probe-runner's own string-replacement mechanism, never the tests or the implementation — see "Mutation Probes" below).
- Closed SSYNC-V125-07 and SSYNC-V125-08 in `.planning/REQUIREMENTS.md` with evidence.
- `tsc --noEmit` clean in both packages; server test-gate SET stayed at 8/8 documented `KNOWN_FAILING` (with two transient TD-V16-TEST-ISOLATION contamination hits, each confirmed passing in isolation on re-run — not a regression, see "Gate Reports" below); `dashboardExportRefs.ts` sha256 unchanged; zero `packages/web` diff; web `tsc`/vitest/theme-guard all unchanged (181 files/4100 tests, 152/152).

## Task Commits

1. **Task 1: The configPatch walk — both action shapes, target-scoped** - `92b7919` (feat)
2. **Task 2: configPatch.metric and columnDisplayConfig.column_name** - `f654869` (feat)
3. **Task 3: The 40/40 coverage guard, the probe sweep, and requirement closure** - `ec11651` (test)

## Files Created/Modified

- `packages/server/src/lib/columnRefs.ts` (1466 lines) — added `getOptionActionsLike`, `resolveConfigPatchTableId` (exported), the configPatch loop (8 sites across both action shapes), the `columnDisplayConfig.column_name` loop, and the module header's closing paragraph (40-site inventory, the four things a 41st site needs, the 12 synthetic-only sites).
- `packages/server/tests/lib.columnRefs.spec.ts` (1836 lines) — added 3 describe blocks (`radio-group configPatch copies`, `configPatch.metric and column display config`, `site coverage — criterion 1`), 34 new tests (107 total, up from 84 after Plan 123-03).
- `.planning/REQUIREMENTS.md` — SSYNC-V125-07 and SSYNC-V125-08 marked `[x]` with evidence; traceability table rows changed `Pending` → `Complete`. No other requirement touched.

---

## 1. The Finding Contract — VERBATIM (Phase 124/125 plan against this text)

```ts
/** exact = a structured site (the value IS the column name). heuristic = a free-SQL / cached-name
 *  match. low-confidence = a free-SQL match on a short or common name. Low-confidence findings are
 *  REPORTED, never suppressed (123-CONTEXT.md, locked). */
export type RefConfidence = "exact" | "heuristic" | "low-confidence";

export type ColumnRefRecordKind =
  | "widget" | "layer" | "customMetric" | "dynamicView" | "tableView" | "columnDisplayConfig";

/** "scoped"     -> tableId is a number and the finding belongs to that table.
 *  "free-sql"   -> tableId is null BY DESIGN (the five free-SQL sites + columns_json). The finding
 *                  says "this text mentions the name you asked about" and asserts nothing more.
 *  "unresolved" -> tableId is null because the record's table could not be determined (dangling
 *                  dynamicViewId, dangling configPatch target layer, or no tableId at all). Such a
 *                  finding is ALWAYS reported regardless of the queried table: a missed finding is
 *                  the expensive failure, a surplus one is merely noise. */
export type ColumnRefTableScope = "scoped" | "free-sql" | "unresolved";

export type ColumnRefMatch = {
  /** The full source line containing the match, VERBATIM from the original text (never the
   *  literal-masked copy, and never trimmed) — Phase 124 shows this to the operator. */
  line: string;
  /** 1-based line number within the scanned text. */
  lineNumber: number;
  /** 0-based character offset of the match WITHIN `line`, so Phase 124 can highlight precisely. */
  offset: number;
};

export type ColumnRef = {
  /** The queried column name, echoed exactly as supplied. */
  column: string;
  /** Stable site id; always a member of COLUMN_REF_SITES. */
  site: ColumnRefSite;
  /** The concrete path, e.g. "config.spatialTargets[1].lonCol" or
   *  "config.options[0].action.configPatch.cb_config.attr". This is what makes granularity
   *  one-finding-per-SITE rather than one-per-record. */
  path: string;
  recordKind: ColumnRefRecordKind;
  /** null ONLY for columnDisplayConfig, whose primary key is (table_id, column_name) and which
   *  therefore has no id; identify it as (tableId, recordLabel). */
  recordId: number | null;
  /** Human label for Phase 124: widget.title / layer config.name / metric label / dv name /
   *  view_name / column_name. Empty string when the record carries none. */
  recordLabel: string;
  tableId: number | null;
  tableScope: ColumnRefTableScope;
  confidence: RefConfidence;
  /** One entry per occurrence, ascending. Non-empty for every FREE_SQL_SITES finding, for
   *  layer/configPatch info_template placeholder findings, and for a JSON-string site whose
   *  stored JSON failed to parse (malformed-JSON fallback, Plan 123-03). EMPTY for
   *  value-equality sites (including dynamicView.columns_json[].name, which is table-less but
   *  not text-scanned). */
  matches: ColumnRefMatch[];
};

export type ColumnRefsInput = {
  widgets: Widget[];
  layers: DashboardLayer[];
  dynamicViews: DashboardDynamicView[];
  customMetrics: CustomMetricRow[];
  tableViews: DashboardTableView[];
  columnDisplayConfig: ColumnDisplayConfigRow[];
};

/** One table, N columns — the shape Phase 124 has after a SchemaCheckResult for one table. */
export type ColumnQuery = { tableId: number; columns: string[] };

export function collectColumnRefs(input: ColumnRefsInput, query: ColumnQuery): ColumnRef[];
```

**Shipped exactly as planned — no deviation from 123-01's original sketch.**

### The Complete, Frozen Registry (VERBATIM, 40/40 entries, in order — ALL implemented as of this plan)

```ts
export const COLUMN_REF_SITES = [
  // --- widget structured: table = the widget's RESOLVED table (Plan 123-02) ---
  "widget.config.metricColumn",
  "widget.config.groupByColumn",
  "widget.config.groupByColumns[]",
  "widget.config.drillDownColumn",
  "widget.config.timeCol",
  "widget.config.xField",
  "widget.config.deltaField",
  "widget.config.sortField",
  "widget.config.columns",
  "widget.config.metrics[].column",
  "widget.config.filterFields[].column",
  // --- widget spatial targets: table = the ELEMENT'S OWN tableId, never inherited (Plan 123-02) ---
  "widget.config.spatialTargets[].lonCol",
  "widget.config.spatialTargets[].latCol",
  "widget.config.spatialTargets[].spatialCol",
  // --- radio-group configPatch copies: table = the TARGET record's table (Plan 123-04) ---
  "widget.config.options[].configPatch.metric",
  "widget.config.options[].configPatch.cb_config.attr",
  "widget.config.options[].configPatch.track_config.trackIdAttr",
  "widget.config.options[].configPatch.track_config.trackOrderAttr",
  "widget.config.options[].configPatch.track_config.xCol",
  "widget.config.options[].configPatch.track_config.yCol",
  "widget.config.options[].configPatch.info_columns",
  "widget.config.options[].configPatch.info_template",
  // --- layer structured: table = the layer's RESOLVED table (Plan 123-03) ---
  "layer.config.latColumn",
  "layer.config.lonColumn",
  "layer.config.wktColumn",
  "layer.config.wkbColumn",
  "layer.cb_config.attr",
  "layer.track_config.trackIdAttr",
  "layer.track_config.trackOrderAttr",
  "layer.track_config.xCol",
  "layer.track_config.yCol",
  "layer.info_columns",
  "layer.info_template",
  // --- global per-table column display config (Plan 123-04) ---
  "columnDisplayConfig.column_name",
  // --- free SQL: heuristic / low-confidence, ALWAYS table-less (Plan 123-01) ---
  "widget.config.sql",
  "widget.config.customWhere",
  "customMetric.expression",
  "dynamicView.template_sql",
  "tableView.filter_clause",
  // --- cached dynamic-view column list: heuristic, table-less, value-equality (Plan 123-01) ---
  "dynamicView.columns_json[].name",
] as const;
```

## 2. Carry-Forward for Phase 124 — Grouping

A widget will ROUTINELY produce BOTH an exact finding (e.g. `metricColumn`) and a heuristic one (its `config.sql`) for the SAME column — this is the operator's explicit choice of completeness over a quieter report (123-CONTEXT.md, locked). **Phase 124 must group findings by record for display**, or the operator sees the same widget listed twice. This plan adds a second instance of the same pattern within a single widget: a radio-group widget carrying a `cb_config.attr` `configPatch` copy produces a finding distinct from — but often alongside — its own `config.sql`/`config.metricColumn` findings if it also has chart config, and always distinct from the TARGET layer's own `layer.cb_config.attr` finding (different `recordKind`/`recordId` entirely — these must NOT be grouped together, only findings on the SAME record should be).

## 3. Carry-Forward for Phase 124 — `unresolved` and `recordId: null`

`tableScope: "unresolved"` findings are reported regardless of the queried table and need an honest rendering ("could not determine which table this record is bound to"). This plan adds a SECOND source of `unresolved`: a `configPatch` whose target record (layer or widget) cannot be found (dangling `target.id`) resolves to `unresolved` exactly like a dangling `dynamicViewId` does for `resolveWidgetTableId`/`resolveLayerTableId`.

`recordId` is `null` for `columnDisplayConfig` (composite primary key `table_id, column_name`, no surrogate id) — Phase 124 must not assume `recordId` is always a number; identify such a finding as `(tableId, recordLabel)` instead.

## 4. The Twelve SYNTHETIC-Only Sites — Risk Stated Explicitly

No real row anywhere in either dev database (`kinetica.db`, `env-b.db`) exercises these twelve sites. Their persisted shape is inferred from writer code and type declarations, never observed. **These are the first places to look if production data ever contradicts these tests:**

| # | Site | Why zero-instance |
|---|---|---|
| 1 | `widget.config.deltaField` | Key present on both real `bignumber` widgets, value always `""` |
| 2 | `widget.config.sortField` | Key present on all 5 real `records` widgets, value always `""` |
| 3 | `widget.config.spatialTargets[].spatialCol` | Zero wkt-mode targets and zero `spatialCol` values in either database |
| 4 | `layer.config.wkbColumn` | Only `wktColumn` is ever populated; `TD-V14-WKB-SPIKE` gates WKB at 501 app-wide |
| 5 | `layer.track_config.xCol` | Real `TrackConfig` field (Phase 52); every real row uses only `trackIdAttr`/`trackOrderAttr` |
| 6 | `layer.track_config.yCol` | Same as `xCol` |
| 7 | `layer.info_columns` | 0/10 (kinetica.db), 0/8 (env-b.db) layers populated |
| 8 | `layer.info_template` | Same zero-instance status as `info_columns` |
| 9 | `tableView.filter_clause` | 0/12 rows in kinetica.db; table has 0 rows in env-b.db |
| 10 | `widget.config.options[].configPatch.info_columns` | `validateLayerSnapshot` accepts the key today; no operator has configured it |
| 11 | `widget.config.options[].configPatch.info_template` | Same as `configPatch.info_columns` |
| 12 | `widget.config.options[].configPatch.metric` | Zero widget-target `configPatch`es exist in either database at all |

The other 28 of 40 sites are exercised by at least one real dev-DB row, and 12 of those 28 carry the phase's own real dev-DB `configPatch` copies (11 `cb_config` + 1 `track_config`, plus the real `column_display_config` row for table 6).

## 5. The `configPatch.metric` Decision — Flagged for the Operator

`widget.config.options[].configPatch.metric` is the **one** registry entry that ROADMAP success criterion 2's literal wording does not name (criterion 2 names `cb_config.attr` and `track_config` explicitly; `metric` is absent from its text). It was added by the planner, reviewed by the plan checker (which read `actionAllowList.ts`'s `WIDGET_ALLOW_LIST.chart.metric`, documented in-code as *"The metric column for the chart (safe string; column name)"*), and kept in the shipped registry.

- **Zero instances** of a widget-target `configPatch` exist in either dev database today.
- **Cost of inclusion:** one `emitStructured` block inside a traversal that already visits every `configPatch` object for its other 7 sibling sites — effectively free.
- **Cost of exclusion (if the operator wants the inventory held to exactly criterion 2's literal wording):** remove one `COLUMN_REF_SITES` entry, one code block in `visitColumnRefSites`, two named tests (`SITE ...configPatch.metric:` and its `SCOPE:` companion), and one entry in the master coverage fixture.

**This decision is the operator's, made against a working implementation rather than a hypothetical** — the code and tests exist either way; striking it is a four-point removal, not a redesign.

## 6. Mutation Probes

### This Plan's Own 18 Probes (P1–P18) — All Fired

| # | Mutation | Test that MUST redden | Result |
|---|---|---|---|
| P1 | Delete the `configPatch.cb_config.attr` block | SITE `...configPatch.cb_config.attr`: widget 11's plural patch | ✅ reddened |
| P2 | Delete the `configPatch.track_config.trackIdAttr` block | SITE `...track_config.trackIdAttr`: widget 6's legacy patch | ✅ reddened |
| P3 | Delete the `configPatch.track_config.trackOrderAttr` block | SITE `...track_config.trackOrderAttr` | ✅ reddened |
| P4 | Delete the `configPatch.track_config.xCol` block | SITE `...track_config.xCol` (SYNTHETIC) | ✅ reddened |
| P5 | Delete the `configPatch.track_config.yCol` block | SITE `...track_config.yCol` (SYNTHETIC) | ✅ reddened |
| P6 | Delete the `configPatch.info_columns` block | SITE `...configPatch.info_columns` (SYNTHETIC) | ✅ reddened |
| P7 | Delete the `configPatch.info_template` block | SITE `...configPatch.info_template` (SYNTHETIC) | ✅ reddened |
| P8 | Delete the `configPatch.metric` block | SITE `...configPatch.metric` (SYNTHETIC) | ✅ reddened |
| P9 | Delete the `columnDisplayConfig.column_name` block | SITE `columnDisplayConfig.column_name` | ✅ reddened |
| P10 | Drop the legacy singular `option.action` branch | BOTH SHAPES: plural + legacy both walked | ✅ reddened |
| P11 | Drop the plural `option.actions` branch | SITE `...configPatch.cb_config.attr` (widget 11 is plural) | ✅ reddened |
| P12 | Scope a configPatch finding to the HOST widget instead of the target | SCOPE: scoped to TARGET layer's table, not the host's | ✅ reddened |
| P13 | Attribute a configPatch finding to the target layer (`recordKind: "layer"`) | DISTINCT: same column, two findings, different recordKind | ✅ reddened |
| P14 | Report a dynamicView-target configPatch as unresolved instead of skipping | dynamicView-target yields no finding | ✅ reddened |
| P15 | Give `columnDisplayConfig` findings `recordId: row.table_id` instead of `null` | recordId null / identified by (tableId, recordLabel) | ✅ reddened |
| P16 | Remove a single entry from `COLUMN_REF_SITES` | GOLDEN: registry is exactly the 40 sites, in order | ✅ reddened |
| P17 | Remove a single block from `visitColumnRefSites` (`layer.config.wktColumn`, a SECOND site beyond the required `metricColumn` deletion below) | COVERAGE + SITE `layer.config.wktColumn` | ✅ reddened |
| P18 | Add a generic walk over `configPatch`'s string values | EXCLUDE: configPatch lookalike-key fixture yields zero findings | ✅ reddened |

### The Required Deliberate-Deletion Proof (Task 3 criterion 5)

The `widget.config.metricColumn` block was **literally deleted** from `visitColumnRefSites`, the full spec file was run, and the observed failure output was:

```
 FAIL  tests/lib.columnRefs.spec.ts > widget structured sites — scalars > SITE widget.config.metricColumn: widget 4's metricColumn fare_amount is an exact, table-1-scoped finding
 FAIL  tests/lib.columnRefs.spec.ts > widget table resolution > SCOPE: a dv-bound widget resolves through the dynamic view's source_table_id, not config.tableId
 FAIL  tests/lib.columnRefs.spec.ts > widget table resolution > SCOPE: a non-dv-bound widget resolves through config.tableId
 FAIL  tests/lib.columnRefs.spec.ts > widget table resolution > SCOPE: a widget whose dynamicViewId is dangling is reported with tableScope 'unresolved' regardless of the queried table
 FAIL  tests/lib.columnRefs.spec.ts > widget table resolution > SCOPE: a widget with neither dynamicViewId nor tableId is reported with tableScope 'unresolved'
 FAIL  tests/lib.columnRefs.spec.ts > excluded look-alike keys > EXCLUDE: the exclude fixture DOES yield findings once a real column site is added, proving the fixture reaches the traversal
 FAIL  tests/lib.columnRefs.spec.ts > site coverage — criterion 1 > COVERAGE: every site in COLUMN_REF_SITES produces at least one finding from the master fixture
 FAIL  tests/lib.columnRefs.spec.ts > site coverage — criterion 1 > COVERAGE: the master fixture's finding sites are EXACTLY the registry, with nothing extra
 FAIL  tests/lib.columnRefs.spec.ts > site coverage — criterion 1 > COVERAGE: removing any single site from the traversal is detectable — each site's sentinel column is unique to it
      Tests  9 failed | 98 passed (107)
```

Both required reddenings occurred (`COVERAGE: every site...` and `SITE widget.config.metricColumn: ...`), plus 7 expected collateral failures (4 SCOPE tests + 1 EXCLUDE test that reuse `metricColumn` as their probe field, and 2 more COVERAGE tests that also depend on that site). The block was then restored and the suite re-confirmed green (107/107).

### The 54 Probes Re-Run from Plans 123-01/02/03 Against the Final 40-Site Module

All 54 were re-applied (via a scripted apply → run → revert cycle, never touching git) against the completed module and re-confirmed to fire correctly. **Two required fixing a bug in the probe-runner script itself** (a search-string ambiguity and a template-literal escaping error in the mutation text) — **never** a weakening of the probe or the test; both were caught by inspecting `DID_NOT_REDDEN`/`SEARCH_AMBIGUOUS` runner output, root-caused with a byte-level manual reproduction, fixed in the runner, and re-verified to redden correctly. Per CLAUDE.md's rule, the fix location matters: these were harness bugs, not test or implementation weaknesses, so no test file or `src/lib/columnRefs.ts` line changed as a result.

**Plan 123-01 (17 probes) — all fired:**

| # | Mutation | Named test | Result |
|---|---|---|---|
| P1 | Delete `widget.config.sql` block | SITE widget.config.sql | ✅ |
| P2 | Delete `widget.config.customWhere` block | SITE widget.config.customWhere | ✅ |
| P3 | Delete `customMetric.expression` block | SITE customMetric.expression | ✅ |
| P4 | Delete `dynamicView.template_sql` block | SITE dynamicView.template_sql | ✅ |
| P5 | Delete `tableView.filter_clause` block | SITE tableView.filter_clause | ✅ |
| P6 | Delete `dynamicView.columns_json[].name` block | SITE dynamicView.columns_json[].name | ✅ |
| P7 | Remove one entry from COLUMN_REF_SITES | GOLDEN: registry exactly 40, in order | ✅ (harness fix: disambiguated search anchor, shared text also appears in FREE_SQL_SITES) |
| P8 | Drop the `i` flag from columnMatchRegex | matches case-insensitively: OPERATOR IN | ✅ |
| P9 | Drop the lookaround (bare substring match) | does not match a substring: X does not match | ✅ (harness fix: template-literal escaping bug produced a malformed mutation that failed to transform; root-caused via byte-level reproduction, fixed in the runner) |
| P10 | Skip maskQuotedLiterals entirely | skips quoted literals: network in | ✅ |
| P11 | Make maskQuotedLiterals DELETE literal chars | matches a whole identifier and reports line/offset | ✅ |
| P12 | On unterminated, return no matches | fails toward REPORTING: unterminated literal scanned raw | ✅ |
| P13 | Suppress low-confidence findings | a low-confidence column name is reported, not suppressed | ✅ |
| P14 | Set tableId on free-SQL findings from record's table | every FREE_SQL_SITES finding has tableId null | ✅ |
| P15 | Emit one finding per MATCH, not per site | BOTH exact + config.sql finding, same column | ✅ |
| P16 | columns_json findings get 'low-confidence' for short names | columns_json carries confidence 'heuristic' always | ✅ |
| P17 | Remove the final sort from collectColumnRefs | output deterministic across input reordering | ✅ |

**Plan 123-02 (20 probes) — all fired:**

| # | Mutation | Named test | Result |
|---|---|---|---|
| P1–P8 | Delete `metricColumn`/`groupByColumn`/`drillDownColumn`/`timeCol`/`xField`/`deltaField`/`sortField`/`columns` blocks | each site's own SITE test | ✅ all 8 |
| P9 | Stop splitting config.columns on commas | comma-separated columns string splits and trims | ✅ |
| P10–P12 | Delete `groupByColumns[]`/`metrics[].column`/`filterFields[].column` blocks | each site's own SITE test | ✅ all 3 |
| P13–P15 | Delete `spatialTargets[].lonCol`/`.latCol`/`.spatialCol` blocks | each site's own SITE test | ✅ all 3 |
| P16 | spatialTargets inherit widget's resolved instead of own tableId | SCOPE: spatialTargets resolves against OWN tableId | ✅ |
| P17 | resolveWidgetTableId checks config.tableId FIRST | SCOPE: dv-bound resolves through dv's source_table_id | ✅ |
| P18 | Dangling dynamicViewId falls back to config.tableId | SCOPE: dangling dynamicViewId reported unresolved | ✅ |
| P19 | Make structured matching case-insensitive | structured matching is case-SENSITIVE (MCC/mcc) | ✅ |
| P20 | Generic fallback over every config string value | EXCLUDE: widget lookalike-key fixture yields zero | ✅ |

**Plan 123-03 (17 probes) — all fired:**

| # | Mutation | Named test | Result |
|---|---|---|---|
| P1–P4 | Delete `latColumn`/`lonColumn`/`wktColumn`/`wkbColumn` blocks | each site's own SITE test | ✅ all 4 |
| P5 | Delete `layer.cb_config.attr` block | SITE layer.cb_config.attr | ✅ |
| P6–P9 | Delete `track_config.trackIdAttr`/`.trackOrderAttr`/`.xCol`/`.yCol` blocks | each site's own SITE test | ✅ all 4 |
| P10 | Delete `layer.info_columns` block | SITE layer.info_columns | ✅ |
| P11 | Delete `layer.info_template` block | SITE layer.info_template | ✅ |
| P12 | resolveLayerTableId reads table_id first | SCOPE: dv-bound layer resolves through dv's source_table_id | ✅ |
| P13 | Swallow malformed cb_config silently (coalesceTrackConfig pattern) | malformed JSON still reports, not silence | ✅ |
| P14 | Iterate parsed cb_config object's keys generically | cb_config styling fields never findings (shapeFillColor) | ✅ |
| P15 | info_template matching case-insensitive | info_template matching is case-SENSITIVE | ✅ |
| P16 | null info_columns treated as ALL COLUMNS | null info_columns yields no finding | ✅ |
| P17 | Generic walk over layer.config's string values | EXCLUDE: layer lookalike-key fixture yields zero | ✅ |

**Total: 72/72 probes fired correctly against the final 40-site module.**

## 7. The `columns_json[].type` Note

`dynamicView.columns_json[].type` is a SECOND frozen type cache alongside `drillDownColumnType` (SSYNC-V125-12's own named failure mode) — both are cached at Preview time and can go stale on a Kinetica retype. Out of scope for `columnRefs.ts` (which enumerates NAME references, not type staleness); flagged here, as it was in 123-01-SUMMARY.md, so Phase 124 knows this second stale-type cache exists.

---

## Gate Reports (real numbers, server SET-based)

- `cd packages/server && npx tsc --noEmit` — clean.
- `cd packages/server && npx vitest run tests/lib.columnRefs.spec.ts` — **107/107** (up from 84 after Plan 123-03; +23 this plan: 9 SITE tests + 2 SCOPE + 1 BOTH SHAPES + 1 DISTINCT + 1 dv-skip + 1 malformed-configPatch + 2 configPatch.metric + 3 columnDisplayConfig + 2 EXCLUDE + 3 COVERAGE − adjustments).
- `cd packages/server && node scripts/test-gate.mjs` — **GATE PASSED**, failing set = exactly the 8 documented `KNOWN_FAILING` entries (unchanged from Plan 123-03). Two intermediate runs during this session's work surfaced transient `TD-V16-TEST-ISOLATION` cross-mode contamination on unrelated files (`routes.schema-check.spec.ts` once, `routes.branding.spec.ts`/`routes.dashboard-import.spec.ts` once) — each confirmed **passing in isolation** by the gate script's own re-run logic, consistent with the project's known parallel-scheduling contamination class, and NOT a regression introduced by this plan (`git status` was clean at the time; a subsequent clean run reproduced GATE PASSED with no unlisted failures).
- `cd packages/web && npx tsc --noEmit` — clean; **181 files / 4100 tests** (unchanged); `npx vitest run src/styles/theme-guard.spec.ts` — **152/152** (unchanged).
- `git diff --name-only <base> | grep '^packages/web/'` — 0 lines.
- `shasum -a 256 packages/server/src/lib/dashboardExportRefs.ts` — `52fd42722d68e650673ba281a979cd79734a5f7b1f49d813877040a6fa8cfe9d` (unchanged); `git diff --stat <base> -- .../dashboardExportRefs.ts` — no output.

## Decisions Made

- **`resolveConfigPatchTableId` dispatches to the existing `resolveLayerTableId`/`resolveWidgetTableId`** rather than a third independent table-resolution implementation — one rule, three call sites, per the project's own convention established in Plans 123-02/03.
- **A dynamicView-target configPatch is skipped by the CALLER, not reported as `unresolved` by the resolver** — `resolveConfigPatchTableId` itself still returns a well-defined `unresolved` result for a dv-kind target if ever called directly, but `visitColumnRefSites` never calls it for one, since `DYNAMIC_VIEW_ALLOW_LIST` proves no column can ever reach that slot.
- **The master coverage fixture is ONE shared record set**, not 40 per-site fixtures — confirmed safe by a zero-collision first run, per the plan checker's pre-computed sentinel analysis.
- **Task boundary for commits:** Task 1 shipped the 7 layer-target configPatch sites (holding back `metric`/`columnDisplayConfig` via a temporary revert-then-reapply so its own commit's tests genuinely exercised only its own scope); Task 2 added `metric` + `columnDisplayConfig`; Task 3 added only tests/docs/requirements, no new traversal code.
- **This plan is the sole owner of `.planning/REQUIREMENTS.md`** for the phase — verified no other 123-0x plan's commits touch it (`git log --all -- .planning/REQUIREMENTS.md` shows only this plan's commit for the phase).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A code comment's own prose tripped the `patch.aggregation` grep guard**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** Criterion 6 (`grep -c "patch.aggregation" src/lib/columnRefs.ts` = 0) failed because the explanatory comment above the `metric` block used the literal substring `patch.aggregation` while describing why that sibling field is never read.
- **Fix:** Reworded to "Its sibling `aggregation` key is never read" — identical meaning, no literal match.
- **Files modified:** `packages/server/src/lib/columnRefs.ts`
- **Verification:** grep now returns 0; all 104 tests at that point still passed; `tsc --noEmit` clean.
- **Committed in:** `f654869` (Task 2 commit — fixed before that commit was made)

**2. [Rule 3 - Blocking] A fixture comment's own prose tripped the `SITE ` = 40 count guard**
- **Found during:** Task 3 acceptance-criterion 3 verification
- **Issue:** `grep -cF "SITE " tests/lib.columnRefs.spec.ts` returned 41, not 40 — a comment in the Task-1 fixture block read "...leaking through into the SITE test", an incidental `"SITE "` substring unrelated to any per-site test title.
- **Fix:** Reworded to "...leaking through into the per-site test below" — identical meaning, no literal `"SITE "` substring.
- **Files modified:** `packages/server/tests/lib.columnRefs.spec.ts`
- **Verification:** grep now returns exactly 40; all 107 tests still passed.
- **Committed in:** `ec11651` (Task 3 commit — fixed before that commit was made)

**3. [Harness bug, not a Rule 1/2/3 code fix] Two of the 54 re-run probes needed the probe-runner script itself fixed**
- **Found during:** the 54-probe re-run sweep (Task 3)
- **Issue:** 123-01's P7 (remove a `COLUMN_REF_SITES` entry) used a search string ambiguous between the registry array and the `FREE_SQL_SITES` array (both list `"widget.config.sql", "widget.config.customWhere"` consecutively); 123-01's P9 (drop the lookaround from `columnMatchRegex`) used a JS template-literal-within-template-literal escaping pattern that produced a subtly malformed mutation (an extra backslash), which caused the file to fail to transform rather than exercise the intended behavior — the runner's own extraction of "which named test failed" then saw zero matches and reported it as a non-redden.
- **Fix:** Disambiguated P7's search anchor with the preceding unique comment line; simplified P9's search/replace to target only the `return new RegExp(...)` line (not the unrelated `escaped` assignment), avoiding the nested-escaping trap entirely.
- **Verification:** Both re-run in isolation via a `PROBE_FILTER` env var added to the runner; both now report `REDDENED_AS_EXPECTED` against the real named test. Manually reproduced and confirmed the correct mutation reddens the intended test with a clear, correct assertion diff (documented in this SUMMARY's probe table).
- **No test file or `src/lib/columnRefs.ts` line was changed as a result** — this was purely a bug in a scratch automation script (`/private/tmp/.../scratchpad/run_probes.cjs`), never committed to the repository.

---

**Total deviations:** 2 auto-fixed (both mechanical comment wording, Rule 3), 1 harness-script bug (not a code/test deviation). No scope creep, no behavior change to the shipped module or its tests.

## Issues Encountered

None beyond the three items documented above. The server test-gate's two transient `TD-V16-TEST-ISOLATION` contamination hits (documented under "Gate Reports") are a pre-existing, already-named class of cross-file parallel-scheduling flakiness, not introduced by this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **The traversal is complete: 40/40 `COLUMN_REF_SITES` entries implemented**, golden-tested, and coverage-tested with a proven-to-fail guard.
- SSYNC-V125-07 and SSYNC-V125-08 are closed in `.planning/REQUIREMENTS.md` with evidence.
- Phase 124 can begin planning against the verbatim `ColumnRef` contract above, with all carry-forward notes (grouping-by-record, `unresolved`/`recordId: null` rendering, the 12 synthetic-only sites, the `configPatch.metric` operator decision, and the `columns_json[].type` second stale-type cache) recorded for it.
- `dashboardExportRefs.ts` sha256 unchanged; zero `packages/web` diff — both phase-level success criteria hold across all four plans.
- No blockers.

---
*Phase: 123-column-reference-enumeration*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: `packages/server/src/lib/columnRefs.ts`
- FOUND: `packages/server/tests/lib.columnRefs.spec.ts`
- FOUND: `.planning/REQUIREMENTS.md`
- FOUND: `.planning/phases/123-column-reference-enumeration/123-04-SUMMARY.md`
- FOUND commit: `92b7919` (Task 1)
- FOUND commit: `f654869` (Task 2)
- FOUND commit: `ec11651` (Task 3)
