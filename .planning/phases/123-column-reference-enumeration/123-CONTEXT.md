# Phase 123: Column Reference Enumeration - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Phase Boundary

One pure traversal (`packages/server/src/lib/columnRefs.ts`) answering **"what in this app refers to
column X of table Y"** — every structured site exactly, every free-SQL site heuristically, with each
finding carrying which of the two it was.

Out of this phase: the impact report that renders these findings (Phase 124), applying a schema
change and persisting history (Phase 125), and any UI (Phase 126). **This phase rewrites nothing and
reads no live Kinetica** — it is a pure function over stored app state.

**Why it is flagged HIGHEST-RISK:** a forgotten site produces a report that is *confidently
incomplete*. The operator acts on it, fixes what it named, and ships the rest broken. That is
strictly worse than no report. v1.24's REF-9 defect is the precedent: three separate audit sweeps
missed `config.spatialTargets[].tableId` because all three enumerated the same way.

</domain>

<decisions>
## Implementation Decisions

### Free-SQL matching — whole identifier, case-INSENSITIVE, literals skipped

**Locked pattern**, per column name:

```
(?<![A-Za-z0-9_])   NAME   (?![A-Za-z0-9_])        // case-insensitive
```

Three properties, each forced by real data in the operator's own database:

1. **Whole identifier, never a bare substring.** There are **564 distinct columns across registered
   tables and 248 substring pairs** among them — `2G` ⊂ `2G_Layer`, `Date` ⊂ `Meta_CreatedDate`,
   `Connection_Band` ⊂ `Connection_Bandwidth`, `Connection_ServiceProvider` ⊂
   `Connection_ServiceProviderBrandName`. Substring matching would be worse than useless.
   Worked examples for column `X`: matches `SELECT X, Y FROM demo.track`; does NOT match
   `H3_XYTOCELL(...)` (no boundary), `max(fare_amount)` (inside a word), or `X_COORD` (followed by `_`).
2. **Case-INSENSITIVE — deliberately different from Phase 122's diff.** Phase 122 locked
   case-SENSITIVE exact matching for column identity, and that stands. But the operator's own SQL
   does not match their column case: widget 59's `customWhere` reads
   `OPERATOR IN ('Etisalat','Du') and val_upload_kbps > 0` while the column is `operator`. A
   case-sensitive scan would under-report on real widgets that exist today. **These are two
   different questions — "is this the same column?" (sensitive) vs "does this text mention it?"
   (insensitive) — and the plan must not "unify" them.**
3. **Skip quoted string literals.** Widget 73's `customWhere` is
   `network in ('2G', '3G', '4G')` — and `2G`, `3G` and `4G` are all real column names. Without
   literal-skipping that one widget yields three false findings.

### Free-SQL sites scanned — all five, INCLUDING the generated `config.sql`

**Locked by the operator after the trade-off was put to them explicitly.** The five sites:
`widgets.config.sql` (42 in the dev DB), `widgets.config.customWhere` (12),
`custom_metrics.expression` (10), `dashboard_dynamic_views.template_sql` (5),
`dashboard_table_views.filter_clause` (0 populated but real).

The case for dropping `config.sql` was put and **rejected**: it is generated as a pure function of
`table` + `columns` + `metricColumn` + `groupByColumn(s)` + `sortField` + `customWhere` + `limit`,
so nearly every column name in it also appears in a structured field the traversal already resolves
exactly — meaning it contributes most of the heuristic surface while finding little that is new.
The operator chose **completeness over a quieter report**: scan it as a safety net, so drift between
a stale frozen SQL string and its structured fields cannot hide.

**Consequence the planner must carry forward:** one widget will routinely produce BOTH an exact
finding (e.g. `metricColumn`) and a heuristic one (its `config.sql`) for the same column. That is
expected, not a bug. **Phase 124 must group findings by record for display**, or the operator sees
the same widget listed twice. Note this in 123's SUMMARY so 124 is planned against it.

### TWO SITES ADDED 2026-09-22 after the adversarial data sweep (operator-approved)

The inventory in this document and in ROADMAP criterion 1 was derived by READING CODE. A
data-driven sweep — walking every JSON blob in both dev databases and flagging every key path whose
value matches one of the 564 real column names — found two sites that method had missed. This is
the same miss-class as v1.24's REF-9, which three code-reading sweeps missed for the same reason.

**1. `dashboard_dynamic_views.columns_json[].name` — heuristic, TABLE-LESS.**

Verified in the dev DB:

| dv | `template_sql` | `columns_json` |
|---|---|---|
| `Taxi Copy` (src table 1) | `select * from {view}` | **19 real nyctaxi columns** (`vendor_id`, `pickup_datetime`, …) |
| `mv view` (src table 6) | `select * from {view}` | **251 real columns** |
| `FF` / `EQ` (src table 4) | joins `vaipr.vaipr_location_exposure` | columns of that **joined, unregistered** table |
| `Avg NYC` (src table 1) | `SELECT H3_XYTOCELL(...)` | computed aliases (`cell`, `avg_passenger_count`) |

The gap it closes: drop `vendor_id` from table 1 and `Taxi Copy`'s `template_sql` — literally
`select * from {view}` — contains **no column text at all**, so the five free-SQL sites yield zero
findings. But `columns_json` lists it, and every dv-bound config panel (`LayersModal`,
`ChartConfigPanel`, `CalendarConfigPanel`, `RadioGroupConfigPanel`) reads its column list from there
INSTEAD of the source table's. The report would call that view unaffected while it is broken.

**Table-less, not table-scoped** — forced by the provenance being mixed and proven so above. Same
treatment as `template_sql`: report the mention, assert no table.

**2. `configPatch.info_columns` and `configPatch.info_template` — enumerate with SYNTHETIC fixtures.**

Structurally identical to the `cb_config`/`track_config` copies this phase already hunts, and the
newer denylist validator (`applyWidgetAction.ts`'s `validateLayerSnapshot`, Phase 60.1 RE-SCOPE —
which supersedes the stricter `LAYER_ALLOW_LIST` at `actionAllowList.ts:101-151`) accepts both keys
today. `info_columns` is a JSON-array-of-strings of column names; `info_template` is HTML carrying
`{Column}` placeholders.

**Zero instances exist in either database**, so fixtures must be synthetic — and a site with no real
data is exactly where a bug survives a suite built from real fixtures. Flag that explicitly in the
plan rather than treating these two like the sites with live rows behind them.

**Both the plural `options[].actions[]` and the legacy singular `options[].action` shapes must be
walked.** The 12 known `configPatch` copies only reconcile when both are.

### Confidence — three levels, not two

- **exact** — a structured site. The value IS the column name; no interpretation.
- **heuristic** — a free-SQL match under the rules above.
- **low-confidence** — a free-SQL match on a short or common name that matches SQL text far more
  often than it is really referenced.

**Locked: low-confidence findings are REPORTED, not suppressed.** Suppressing them would mean a
genuinely dropped `X`, referenced only in a `customWhere`, goes unreported — the confidently-
incomplete failure this phase exists to prevent. Reporting them undifferentiated would teach the
operator to skim. The third tier lets Phase 124 separate or collapse them visually while the data
stays complete.

Real examples from the operator's tables — short: `X`, `Y`, `gs`, `fix`, `eta`, `alt`, `reg`, `lob`,
`nic`, `sil`, `MCC`, `MNC`, `2G`, `3G`, `4G`; common-word: `Date`, `date`, `NAME`, `name`, `type`,
`Time`.

### Every heuristic finding carries the matched line and a character offset

**Locked.** A finding on `operator` shows `OPERATOR IN ('Etisalat','Du') and val_upload_kbps > 0`,
not merely "widget 59's customWhere mentions it". This is what makes the low-confidence tier
affordable: a wrong hit on `Date` displays `WHERE Meta_CreatedDate > ...` and is dismissed at a
glance instead of costing a context switch into the widget.

Include the character offset of the match as well as the line, so Phase 124 can highlight precisely.

### A real cross-table case collision exists — intended consequence, not a bug

Table 7 has columns `MCC`/`MNC`; table 8 has `mcc`/`mnc`. They are different columns on different
tables. Because free-SQL matching is case-INSENSITIVE (locked above, and required by the operator's
own `OPERATOR`/`operator` data), a scan for one will legitimately also fire on the other table's
widgets' `customWhere` text.

This follows directly from two decisions that are each correct on their own — case-insensitive text
matching, and free-SQL findings asserting no table. Recorded here so it is not "discovered" mid-
implementation and mistaken for a defect. Structured findings remain exactly table-scoped and are
unaffected.

### Free-SQL findings do NOT claim a table

**Locked.** A heuristic finding says "this SQL text mentions the name you asked about" and asserts
nothing about which table the column belongs to. Forced by the data: dynamic-view templates join
tables the app has never registered, through aliases —
`FROM {view} a join vaipr.vaipr_location_exposure b on a.vaipr_location_id = b.vaipr_location_id`.
Attributing a match there to the view's own bound table would often be simply wrong.

**Structured findings remain exactly table-scoped** (success criterion 4): a widget bound through
`config.dynamicViewId`, and a `spatialTargets[]` element carrying its OWN `tableId`, each resolve
against the right table, so a same-named column on a different table yields no finding.

### Granularity — one finding per reference SITE

**Locked.** A widget referencing a dropped column through `metricColumn`, `groupByColumn` AND its
`config.sql` returns **three** findings, each naming its own config field path. Most precise: the
operator sees every place that needs fixing. Phase 124 groups by record for display (see the
`config.sql` consequence above).

### Claude's Discretion

- **The exact rule defining "short or common"** for the low-confidence tier. Proposed starting
  point, tunable during planning: length ≤ 3 **OR** the name case-insensitively matches a small
  stoplist of SQL/common words (`date`, `time`, `name`, `type`, `value`, `count`, `key`, `data`,
  `status`, `code`, `id`, `text`, `number`). A pure length rule is insufficient — `Date`, `name` and
  `type` are all 4 characters. Whatever rule ships must be a named exported constant with its own
  test, not an inline literal.
- The finding type's exact field names and the module's function signatures, provided the contract
  is reproduced verbatim in the SUMMARY (Phase 124 is planned against it).
- How string literals are detected (single-quote scanning vs a fuller tokenizer) — must handle
  escaped quotes without crashing, and fail toward REPORTING a match rather than silently dropping
  one, since a missed finding is the expensive failure here and a false positive is merely noise.
- Whether the traversal takes one column or a batch (a whole `SchemaCheckResult` will be fed in by
  Phase 124 — batching may be the better shape; the planner decides).
- Comment/whitespace handling inside SQL.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The pattern to INHERIT, not the module to extend
- `packages/server/src/lib/dashboardExportRefs.ts` — the one-traversal-two-directions discipline
  (`visitWidgetConfigRefs`, `visitFilterSelectionRefs`, REF-1..REF-9). **Zero diff to this module is
  a success criterion.** `columnRefs.ts` must carry a comment cross-referencing it so the discipline
  is visibly inherited rather than silently re-derived. Its `asId` safety model does NOT transfer:
  a column reference is a string, and widget configs are full of strings that are not columns
  (`colormap:"viridis"`, `pointShape`, `basemapDark`, hex colours), so identification must be
  path-driven — which is strictly more fragile and is exactly why per-site tests are mandatory.

### The site most likely to be missed
- `packages/web/src/lib/actionAllowList.ts:101-151` — the `configPatch` allow-list. `chart.metric`
  is a column name; `layer.cb_config` and `layer.track_config` are whole JSON strings containing
  column names, nested inside a widget config. **12 such copies exist in the dev DB (11 `cb_config`,
  1 `track_config`)** and they overwrite the layer at click time. A scan of `dashboard_layers` alone
  misses every one — success criterion 2 exists solely for this.

### Type semantics (Phase 124 consumes; 123 must not discard)
- `packages/web/src/lib/columnTypes.ts` — `normalizeType`, `inferDataTypeFromColumn`,
  `NUMERIC_TYPES`, `INTEGER_TYPES`, `DATETIME_TYPES`

### Phase 122's shipped contract — this phase's input
- `.planning/phases/122-schema-diff-table-missing-detection/122-03-SUMMARY.md` — the
  `SchemaCheckResult` union, verbatim. Three outcomes; `table_missing` omits the diff-group keys.
- `packages/server/src/lib/schemaDiff.ts`, `packages/server/src/lib/schemaFingerprint.ts`

### Milestone scope and this phase's requirements
- `.planning/PROJECT.md` § "Current Milestone: v1.25 Schema Sync" — the five locked scope decisions
- `.planning/REQUIREMENTS.md` — SSYNC-V125-07 and SSYNC-V125-08 are this phase's
- `.planning/ROADMAP.md` § "Phase 123" — the goal, research flag and five success criteria

### Project conventions
- `./CLAUDE.md` — § "Writing verifiable acceptance criteria" (RUN every grep criterion before
  committing to it) and § "Test gates". Server tests are SET-BASED:
  `cd packages/server && node scripts/test-gate.mjs`, never raw `npx vitest run`, never a fixed
  pass-count.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dashboardExportRefs.ts`'s visitor shape maps cleanly: `(site) => …` gives one enumeration
  serving both "find references" and any future "rewrite references" (`SSYNC-F1`), without a second
  list to forget. Its `cloneJson` + `VisitNotes` side-channel are directly reusable.
- Phase 122's `schemaDiff.ts` / `schemaFingerprint.ts` are pure libs with fixture-based specs —
  the established shape for this kind of module, and the test pattern to mirror.

### Established Patterns
- Pure libs under `packages/server/src/lib/` compute; routes stay thin.
- Fixture tests against REAL data beat invented shapes — this milestone has now twice found that
  documentation-derived assumptions were wrong (`INFORMATION_SCHEMA.DATA_TYPE` reporting
  `character(256)` for every char width; the Avro union form absent from the base-table fixture).
  Build fixtures from the dev DB's actual widget/layer/metric rows.

### Integration Points
- Phase 124 consumes these findings to build the impact report; Phase 125 persists them in sync
  history. The finding type is a CONTRACT — reproduce it verbatim in the SUMMARY.
- This phase reads only stored app state. No Kinetica call, no live schema read.

</code_context>

<specifics>
## Specific Ideas

- Operator's clarifying question, answered and now locked: matching is on the **whole identifier**,
  never the bare character — "a single word vs the character x". The worked `X` examples in the
  decisions above came out of that exchange.
- Operator's DDL observation ("match an entire line if it's a sql ddl so `X VARCHAR(8)`") — none of
  the five scanned sites contain DDL (they hold `WHERE` fragments, aggregate expressions and
  `SELECT` templates), but the useful idea underneath it became the **matched-line-plus-offset**
  decision above.
- Operator chose completeness over a quieter report on `config.sql`, with the redundancy trade-off
  stated explicitly beforehand.

</specifics>

<deferred>
## Deferred Ideas

- **`SSYNC-F1` auto-repair** — rewriting the ~170 structured sites on an operator-declared rename.
  This phase deliberately builds the enumeration in a shape that could later drive a rewrite, but
  ships read-only. Milestone-level locked decision: detect and report only.
- **Rewriting free SQL** — permanently out of scope, not merely deferred. Column references there
  are heuristic by nature; the app must never edit SQL it only pattern-matched.
- **`SSYNC-F6` server-side column-existence gate** — `POST /api/filter/materialize` interpolates
  client-supplied column names into SQL without validating them against stored metadata
  (`whereClause.ts:14-20` documents a trust boundary `index.ts:1246-1270` does not enforce).
  Adjacent and real; not this phase.

</deferred>

---

*Phase: 123-column-reference-enumeration*
*Context gathered: 2026-09-22*
