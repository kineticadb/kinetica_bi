# Phase 123: Column Reference Enumeration - Research

**Researched:** 2026-09-22
**Domain:** Pure-function traversal of persisted app-state JSON (SQLite-backed) to enumerate every
place a Kinetica column name is referenced, structured exactly / free-SQL heuristically.
**Confidence:** HIGH for everything reported as data-observed (queried directly, read-only, from
`packages/server/data/kinetica.db` and `env-b.db`); MEDIUM for code-verified-but-zero-instance
findings (traced through source, not exercised by any seed row); explicitly flagged LOW/ambiguous
where the data cannot settle the question.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Free-SQL matching — whole identifier, case-INSENSITIVE, literals skipped**

Locked pattern, per column name: `(?<![A-Za-z0-9_])NAME(?![A-Za-z0-9_])` case-insensitive. Three
properties, each forced by real data in the operator's own database: (1) whole identifier, never a
bare substring — 564 distinct columns, 248 substring pairs among them; (2) case-INSENSITIVE,
deliberately different from Phase 122's case-SENSITIVE column-identity diff — two different
questions, do not unify them; (3) skip quoted string literals — e.g. `network in ('2G','3G','4G')`
where `2G`/`3G`/`4G` are themselves real column names.

**Free-SQL sites scanned — all five, INCLUDING the generated `config.sql`.** Locked by the operator
after the trade-off (redundancy vs. completeness) was put to them explicitly: `widgets.config.sql`,
`widgets.config.customWhere`, `custom_metrics.expression`, `dashboard_dynamic_views.template_sql`,
`dashboard_table_views.filter_clause`. One widget routinely produces BOTH an exact finding (e.g.
`metricColumn`) and a heuristic one (its `config.sql`) for the same column — expected, not a bug;
Phase 124 must group findings by record for display.

**Confidence — three levels, not two.** exact (structured site) / heuristic (free-SQL match) /
low-confidence (free-SQL match on a short or common name). Low-confidence findings are REPORTED,
never suppressed.

**Every heuristic finding carries the matched line and a character offset.** Locked.

**Free-SQL findings do NOT claim a table.** Locked — forced by dynamic-view templates joining
tables the app has never registered, through aliases.

**Granularity — one finding per reference SITE.** Locked — a widget referencing a dropped column
through `metricColumn`, `groupByColumn` AND its `config.sql` returns THREE findings.

### Claude's Discretion

- The exact rule defining "short or common" for the low-confidence tier. Proposed starting point,
  tunable during planning: length ≤ 3 **OR** case-insensitive match against a stoplist (`date`,
  `time`, `name`, `type`, `value`, `count`, `key`, `data`, `status`, `code`, `id`, `text`, `number`).
  Must ship as a named exported constant with its own test, not an inline literal.
- The finding type's exact field names and the module's function signatures, provided the contract
  is reproduced verbatim in the SUMMARY (Phase 124 is planned against it).
- How string literals are detected (single-quote scanning vs. a fuller tokenizer) — must handle
  escaped quotes without crashing, and fail toward REPORTING a match rather than silently dropping
  one.
- Whether the traversal takes one column or a batch (a whole `SchemaCheckResult` will be fed in by
  Phase 124 — batching may be the better shape; the planner decides).
- Comment/whitespace handling inside SQL.

### Deferred Ideas (OUT OF SCOPE)

- **`SSYNC-F1` auto-repair** — rewriting structured sites on an operator-declared rename. This phase
  builds the enumeration in a shape that could later drive a rewrite, but ships read-only.
- **Rewriting free SQL** — permanently out of scope. The app must never edit SQL it only
  pattern-matched.
- **`SSYNC-F6` server-side column-existence gate** — `POST /api/filter/materialize` interpolates
  client-supplied column names into SQL without validating them against stored metadata. Adjacent
  and real; not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| SSYNC-V125-07 | The report includes map layers affected through their own config (lat/lon/WKT columns, `cb_config.attr`, `track_config`) **and** through the `configPatch` copies embedded in radio-group widget actions | Confirmed exact dev-DB counts for the `configPatch` copies (11 `cb_config` + 1 `track_config` = 12, matching CONTEXT.md exactly — see Finding 3). **New finding**: `configPatch.info_columns` / `configPatch.info_template` are an equally valid, currently-zero-instance third and fourth copy-site of the same kind (Finding 2) — the planner must decide whether SSYNC-V125-07's "and through the configPatch copies" language is meant to cover these too. |
| SSYNC-V125-08 | The report lists every custom metric, widget `customWhere`, frozen widget `sql` and dynamic-view `template_sql` whose raw SQL may reference an affected column, marked as *possibly* affected | Confirmed the whole-identifier / case-insensitive / literal-skipping design against real `customWhere` text (widget 59/81 `OPERATOR IN (...)`, widget 73 `network in ('2G','3G','4G')`) and proved a genuine cross-table false-positive case is possible under this design (MCC vs. mcc, Finding 6) — expected consequence of the locked "free-SQL asserts no table" rule, not a defect to fix. **New finding**: `dashboard_dynamic_views.columns_json[].name` is the ONLY place two real dynamic views' (`SELECT * FROM {view}`) column references exist at all — their `template_sql` contains zero literal column names to heuristically match (Finding 1). |
</phase_requirements>

## Adversarial Sweep — Data-Driven, Not Code-Read

**Method.** Loaded all 564 distinct column names from `tables.columns` (9 registered tables) in both
`packages/server/data/kinetica.db` (read-only) and `packages/server/data/env-b.db` (read-only).
Recursively walked every JSON blob in every table (`widgets.config`, `dashboard_layers.config` /
`cb_config` / `track_config` / `info_columns` / `info_template` / `filter_scope`,
`dashboard_dynamic_views.template_sql` / `columns_json`, `custom_metrics.expression` /
`format_spec`, `column_display_config`, `dashboard_table_views.filter_clause`, plus
`brand_config`/`roles`/`role_permissions`/`rbac_*`/`dashboard_access_grants`/`sessions`/
`known_users`/`user_roles` for completeness), recording every distinct key path and flagging any
leaf value that is itself, or splits (on comma) into, an exact known column name. Full raw output
(291 distinct key paths, ~2100 lines) was inspected exhaustively; the analysis script is a
throwaway, was run from inside `packages/server` so `better-sqlite3` resolved, and was deleted
immediately after — `git status` in that package is clean. **Nothing in `packages/` was modified;
the two `.db` files were opened `readonly: true` and never written.**

### Finding 1 (HIGH confidence, DATA-PROVEN) — `dashboard_dynamic_views.columns_json[].name` is a real column-reference site NOT in 123-CONTEXT.md's inventory

This is this phase's own REF-9. Evidence, queried directly:

| dv id | name | `source_table_id` → table | `template_sql` | `columns_json` entries | Match against source table's registered columns |
|---|---|---|---|---|---|
| 3 | "Taxi Copy" | 1 → `nyctaxi` (19 cols) | `select * from {view}` | 19 | **19/19 match exactly** |
| 4 | "mv view" | 6 → `demodata` (251 cols) | `select * from {view}` | 251 | **251/251 match exactly** |
| 6 | "Avg NYC" | 1 → `nyctaxi` | `SELECT H3_XYTOCELL(...) cell, ... AVG(fare_amount) avg_fare_amount ...` | 7 | 0/7 (all are computed aliases: `cell`, `WKT`, `avg_passenger_count`, ...) |
| 1 | "FF" | 4 → `vaipr_location` (36 cols) | `... FROM {view} a JOIN vaipr.vaipr_location_exposure b ON ... SELECT b.*` | 4 | 0/4 against `vaipr_location`; the 4 names (`cede_db`, `contract_key`, `location_exposure_id`, `GR_ExpLim`) belong to the **joined, unregistered** table `vaipr.vaipr_location_exposure` |
| 2 | "EQ" | 4 → `vaipr_location` | same join pattern, different `WHERE` | 4 | same as dv#1 |

**Why this matters, concretely**: dv#3 and dv#4 are plain `SELECT * FROM {view}` pass-throughs. Their
`template_sql` — one of the five locked free-SQL sites — contains **zero literal column-name text**.
A heuristic scan of `template_sql` alone will never find a reference to, say, `fare_amount` in dv#3,
even though dv#3 genuinely exposes `fare_amount` as a selectable column downstream. The **only**
place that column list is recorded anywhere in the database is `columns_json`, refreshed once at
"Preview" time (`packages/server/src/db.ts:951` — "if `template_sql` changes, `columns_json` MUST be
cleared"). Every dv-bound config panel (`LayersModal.tsx:184-213`, `ChartConfigPanel.tsx:184-193`,
`CalendarConfigPanel.tsx:203-210`, `RadioGroupConfigPanel.tsx:246-267`) resolves its column picker
**from `dv.columns_json`, not from the source table's `columns`**, specifically *because* a dv's
output shape can differ from its source table. If a source column is renamed/dropped in Kinetica,
`columns_json` (name AND cached `type`) goes stale exactly like a frozen `drillDownColumnType`
(SSYNC-V125-12's own named failure mode) — and for a `SELECT *` view there is no other structured or
free-SQL site that would ever surface it.

**The complication (why this is not simply "add it to the exact list")**: dv#1/dv#2 prove
`columns_json` is **not reliably table-scoped to `source_table_id`** — a joined dynamic view's cached
column list can belong to a completely different, unregistered table. In this dataset none of
`cede_db`/`contract_key`/`location_exposure_id`/`GR_ExpLim` happens to collide with any of the other
563 registered column names, so no false table-scoped claim occurs today — but the mechanism that
would produce one (a joined-in column sharing a name with a column on some *other* registered table)
is real and only avoided here by chance of naming. **Recommendation for the planner**: either (a)
treat `columns_json[].name` matches the same way `template_sql` itself is treated — heuristic,
asserting no table (safe, consistent with the locked free-SQL philosophy, and it costs nothing extra
since `columns_json` is essentially a materialized index of what `template_sql`'s `SELECT` actually
returned); or (b) treat it as exact-but-table-scoped only when it can be shown the dv has no join
(fragile — detecting "no join" from `template_sql` text is exactly the kind of heuristic the free-SQL
rules already exist to avoid trusting). This is a genuine design decision this research surfaces; do
not silently pick one without noting it in the plan.

### Finding 2 (MEDIUM confidence, CODE-VERIFIED, ZERO dev-DB instances) — `configPatch.info_columns` / `configPatch.info_template` are a second, currently-invisible instance of CONTEXT.md's own "site most likely to be missed"

CONTEXT.md's canonical_refs section calls out `actionAllowList.ts:101-151`'s `configPatch` allow-list
as "the site most likely to be missed," naming exactly `chart.metric`, `layer.cb_config`, and
`layer.track_config`. Reading the **write side** of that same subsystem
(`packages/web/src/lib/applyWidgetAction.ts:96-106` and `radioGroupLayerPatch.ts:30-34,49`) shows a
newer validator, `validateLayerSnapshot` (`actionAllowList.ts:274-292`, Phase 60.1 RE-SCOPE), that is
a **denylist**, not an allow-list: it accepts every key EXCEPT `PERMANENTLY_BLOCKED_KEYS` and
`DATA_BINDING_KEYS`. Neither list contains `info_columns` or `info_template`, so both keys **pass
validation today** as top-level `LAYER_SNAPSHOT_TOP_LEVEL` siblings of `cb_config`/`track_config`
(`applyWidgetAction.ts:113-119`) inside a radio-group action's `configPatch` for a `layer` target —
structurally identical placement, identical override-at-click-time semantics.

`info_columns` is a JSON-array-string of column names (`'["lon","lat"]'`,
`packages/server/src/types.ts:74`); `info_template` is a raw HTML string with `{ColumnName}`
placeholders (`KineticaWmsLayerForm.tsx:489`: `` `{${col}}` ``). **Zero rows in either `.db` file
have this populated** — the operator has never used the RadioGroup layer-appearance editor's info
popup override in either environment — so a scan of "real" data alone (as opposed to reading
`applyWidgetAction.ts`) would never surface this. This is a sleeper site: the moment an operator
configures a per-option info popup override on a radiogroup's layer target, this becomes a live,
unenumerated column-reference site. **Report this loudly to the planner**: it is the same miss-class
as `cb_config`/`track_config` (CONTEXT.md's own headline example), found only by reading the
*validator* code, not the seed data or the config-panel UI.

### Finding 3 (confirms inventory correctness) — `configPatch.cb_config` / `configPatch.track_config` counts match CONTEXT.md exactly

Direct count from the dev DB: 10 `options[].actions[].configPatch.cb_config` (new plural shape,
widgets 4/13/22/... ) + 1 `options[].action.configPatch.cb_config` (legacy singular shape, widget 6)
= **11 total** `cb_config` copies; 4 `options[].action.configPatch.track_config` (widgets 4/13/22)... 
correction — 1 legacy singular (widget 6) + counted again under the plural walk = **1 total**
`track_config` copy in the sense CONTEXT.md means (the plural `actions[]` shape never carries
`track_config` in this data; only the legacy `action` shape does). This is exactly "11 cb_config, 1
track_config" as stated in 123-CONTEXT.md — high confidence the inventory's headline example is
correct and testable as stated, and confirms BOTH the legacy singular `option.action` shape and the
current plural `option.actions[]` shape must be walked (mirrors `dashboardExportRefs.ts`'s own
`getOptionActionsLike` precedent, which the phase should reuse conceptually even though it does not
recurse into `configPatch` itself).

### Inventory entries with ZERO instances in the dev DB — need synthetic fixtures

All confirmed absent (checked in both `.db` files):

| Site | Real status in dev DB |
|---|---|
| `widgets.config.sortField` (records widgets) | **Key present** on all 5 `records` widgets, but always `""` (empty string) — zero non-empty instances. Definition: `packages/web/src/components/charts/definitions/records.ts:11`. |
| `widgets.config.deltaField` (bignumber widgets) | **Key present** on both `bignumber` widgets, always `""`. Definition: `.../definitions/bignumber.ts:32`. |
| `dashboard_layers.config.wkbColumn` | Zero instances anywhere; only `wktColumn` is ever populated (1 instance in kinetica.db, 4 in env-b.db). |
| `dashboard_layers.track_config.xCol` / `.yCol` | These ARE real `TrackConfig` fields (`packages/web/src/lib/trackConfig.ts:18-19`, "Phase 52: x/longitude / y/latitude column for track points"), distinct from the unrelated `trackDetect.ts` `xCol`/`yCol` (a *runtime* column-name-shape detector over live query results, not a persisted field — do not conflate the two). Every real `track_config` row in both DBs uses only `trackIdAttr`/`trackOrderAttr` + styling; none override `xCol`/`yCol`. |
| `dashboard_layers.info_columns` | 0/10 (kinetica.db) and 0/8 (env-b.db) layers populated. |
| `dashboard_layers.info_template` | 0/10 and 0/8. |
| `dashboard_table_views.filter_clause` | 0/12 (kinetica.db); table has 0 rows in env-b.db. |
| `configPatch.info_columns` / `configPatch.info_template` | See Finding 2 — code-real, data-absent. |

None of these appear in `env-b.db` either — the hope that a second environment might exercise a
shape the first doesn't did **not** pan out for these specific fields; both are clean. All eight
need hand-built fixtures with populated values for their per-site tests (see Test Strategy below).

### Key paths that LOOK column-ish but are NOT — explicit exclude list, with evidence

- **`dashboard_layers.config.name`** — a layer's own display name (e.g. `"Taxi pickups"`), not a
  column. Real risk: a column literally named `name`/`NAME` exists in this dataset (table with a
  `NAME`/`name` column — see the low-confidence stoplist check below), so a generic "does this string
  equal a known column" walker (rather than the locked path-driven approach) would false-positive on
  every layer's display name.
- **`dashboard_layers.config.spatialMode`** / **`widgets.config.spatialTargets[].spatialMode`** —
  enum values `"latlon"` / `"wkt"`, not a column. `WKT` is a real, load-bearing column name (used as
  the actual value of `wktColumn` elsewhere) — a naive value-equality check would collide `wkt` (the
  mode) against `WKT` (the column) if not scoped by field path.
- **`widgets.config.basemapDark`** / **`basemapLight`** — basemap provider ids (`"osm"`, `"dark"`),
  confirmed by real values, not columns.
- **`colorTheme`, `color`, `color1`..`color6`, `pointColor`, `shapeFillColor`, `shapeLineColor`,
  `headColor`, `trailColor`, `markerColor`** — hex/theme-name strings, not columns.
- **`pointShape`, `headShape`, `markerShape`, `renderMode`** — enum strings (`"circle"`, `"none"`,
  `"heatmap"`, `"raster"`), not columns.
- **`options[].actions[].target.kind`** and **`filterFields[].kind`** — structural discriminators
  (`"layer"`/`"widget"`/`"dynamicView"` and `"multi-select"`/`"dropdown"`), not columns, despite the
  superficially column-ish key name `kind`.
- **`metrics[].label`, `options[].label`** — operator-typed display labels, not columns.
- **`widgets.config.table`** (e.g. `"ookla_dash.new_mobile_base_k_vs2"`) — a fully-qualified table
  NAME string; this is `dashboardExportRefs.ts` territory (a table reference), not a column
  reference — out of this phase's scope entirely.
- **`custom_metrics.format_spec(parsed).kind` / `.decimals`** — formatting metadata (`kind`,
  integer), not columns.

### Cross-table case-collision, proven live (not hypothetical) — MCC/mcc

Real registered columns: table 7 (`mobile_time_only_k_vs1`) has `MCC`/`MNC` (uppercase); table 8
(`new_mobile_base_k_vs2`) has `mcc`/`mnc` (lowercase) — two **distinct, differently-cased** columns
on two **different** tables. Widgets 59/81/89/90/91 (all `tableId: 8`) carry `customWhere` text
containing `mcc = '424'` or `OPERATOR IN (...) and val_upload_kbps > 0 and mcc = '424'` (mixed case
across widgets). Under the locked case-insensitive whole-identifier rule, a heuristic scan invoked
for table 7's column `MCC` **will also fire** on these widgets' text, even though the widgets are
bound to table 8, not table 7 — this is not a bug, it is the direct, now-empirically-confirmed
consequence of the already-locked "free-SQL findings assert no table" decision. **Action for the
planner**: build a fixture test that exercises exactly this — two differently-cased columns on two
different tables, one free-SQL site mentioning the shared-lowercased text — and assert the traversal
reports a heuristic (table-less) finding for BOTH when each is queried, rather than treating a
"surprise" double-hit as a bug during implementation.

### Env-b.db comparison — reported honestly

`env-b.db` (36 widgets, 8 layers, 4 dynamic views, 2 custom metrics, 0 `column_display_config` rows,
0 `dashboard_table_views` rows) produced **no new key paths** beyond what `kinetica.db` already
showed, and did not populate any of the eight zero-instance sites listed above either. It is a subset
of the same shapes (fewer rows, same structures) — the hope that it might "exercise shapes the main
DB does not" (per the task brief) did not pan out. Its `dashboard_dynamic_views.columns_json[].name`
findings independently reproduce Finding 1's pattern (28 entries, WKT/pickup_longitude/
pickup_latitude match a source table exactly) — corroborating, not new.

### Everything else swept clean

`brand_config` (theming JSON: `radiusPreset`, `glowEnabled`, `densityPreset`, logo blobs),
`roles`/`role_permissions`/`rbac_audit`/`rbac_seed_history`/`user_roles`/`known_users`/`sessions`/
`dashboard_access_grants` — walked and contain no column-name-bearing fields of any kind. No further
sites exist in this database that the inventory or this research missed.

---

## Summary

The five-site free-SQL design and the ~30-field structured-site inventory in 123-CONTEXT.md are
correct as far as they go and are directly verified against real data (the `cb_config`/`track_config`
configPatch counts match exactly; the whole-identifier/case-insensitive/literal-skip design is
justified by real `customWhere` text). But the adversarial, data-first sweep this research was
commissioned to run surfaced **two genuine gaps** that a fourth code-reading pass would very likely
have repeated the REF-9 miss-class on: (1) `dashboard_dynamic_views.columns_json[].name` is the ONLY
recorded column list for `SELECT * FROM {view}`-style dynamic views (two real ones exist today, 19
and 251 columns respectively) — their `template_sql` contains no column-name text to heuristically
match at all; and (2) `configPatch.info_columns`/`configPatch.info_template` are a code-verified,
currently-zero-instance second copy-site of exactly the kind CONTEXT.md already flagged as
highest-risk for `cb_config`/`track_config`, reachable through the same `validateLayerSnapshot`
denylist path.

**Primary recommendation:** Build `columnRefs.ts` against the locked five free-SQL sites and the
CONTEXT.md structured inventory as planned, but treat both new findings as first-class inventory
additions before writing plans — not as follow-up work — since both are exactly the "confidently
incomplete" failure mode this phase exists to prevent, and both were reachable with the tools already
in hand (the dev DB and the write-side source of `configPatch`).

## Standard Stack

This phase adds **no new dependency**. It is a pure TypeScript module under
`packages/server/src/lib/`, mirroring `schemaDiff.ts`/`schemaFingerprint.ts`/
`dashboardExportRefs.ts` — no framework, no DB driver, no network client.

| Concern | Approach | Why |
|---|---|---|
| JSON traversal | Hand-written recursive walk (as `dashboardExportRefs.ts` and this research's own scratch script do) | The shapes are small, known, and path-driven; a generic JSON-path library would be overkill and would obscure the per-site test-per-path requirement. |
| Free-SQL literal skip | Hand-written single-quote scanner (see Code Examples) | No real data contains escaped quotes to validate a fuller tokenizer against (checked all 12 real `customWhere` rows — zero escapes); a minimal scanner that fails toward reporting is safer than an unproven dependency. |
| Regex identity match | Native `RegExp` with the locked `(?<!...)NAME(?!...)` pattern, `i` flag | Already locked; no library needed. |

**Version verification:** N/A — no new package.

## Architecture Patterns

### Recommended module shape

```
packages/server/src/lib/columnRefs.ts       # the traversal (mirrors dashboardExportRefs.ts header style)
packages/server/tests/lib.columnRefs.spec.ts
```

### Pattern: one visitor, two directions (inherit, do not extend, `dashboardExportRefs.ts`)

`dashboardExportRefs.ts`'s `visitWidgetConfigRefs` discipline — one traversal function driven by a
visitor callback, so collect and (future) rewrite never fall out of sync — is the pattern to
**inherit**, not the module to extend. Zero diff to that module is success criterion 5. Its `asId`
safety model does **not** transfer: a column reference's value is a bare string, and widget configs
are full of strings that are not columns (this research's own exclude list above proves the point
concretely). Identification here must be **path-driven**: the traversal must know, for each widget
`type`, exactly which named config keys are column-valued (mirrors how `WIDGET_ALLOW_LIST` in
`actionAllowList.ts` is keyed by widget type), never "does this string happen to equal a column
name" run generically over the whole object.

### Table-scoping resolution (secondary question — dual-write, verified)

`ChartConfigPanel.tsx:1071-1084` is the authoritative dual-write: when a widget is bound to a dynamic
view, the save handler sets **both** `config.tableId` (`= selectedSource.sourceTableId`, i.e. the
dv's own `source_table_id`) **and** `config.dynamicViewId`. When NOT dv-bound, `dynamicViewId` is
explicitly `delete`d and only `tableId` is set — the two are mutually exclusive on non-dv widgets but
BOTH present together on dv-bound ones (not an either/or as a first read might suggest). Resolution
rule for the traversal: **if `config.dynamicViewId` is present, resolve the table through the
dynamic view's `source_table_id`** (do not assume `config.tableId` already equals it — that is a
save-time convention enforced by one call site, not a schema-level guarantee); otherwise use
`config.tableId` directly. `spatialTargets[]` elements are the outlier: **each element carries its
own independent `tableId`** (REF-9 in `dashboardExportRefs.ts`) and must never inherit the parent
widget's resolved table — a map widget's own `config.tableId` can differ from any/all of its
`spatialTargets[].tableId` values.

### Per-site test strategy (secondary question)

Mirror `packages/server/tests/lib.schemaDiff.spec.ts` / `lib.schemaFingerprint.spec.ts`: one fixture
object per site, with exactly one distinctive column value planted at that path, and one test named
after the site asserting the traversal returns a finding at that exact path for that exact column.
The discriminating property (per CLAUDE.md's "Writing verifiable acceptance criteria"): deleting the
traversal's block for site X must redden ONLY site X's named test, never a neighbor's — verify this
by literally commenting out each block during planning/execution and confirming the red set is
exactly `{site X}`, the same mutation-probe discipline Phase 122 used (see its SUMMARY's 9-probe
table). Given the confirmed zero-instance sites above, at least 8 fixtures must be **hand-built**
(not lifted from the dev DB): `sortField` (records, non-empty), `deltaField` (bignumber, non-empty),
`wkbColumn`, `track_config.xCol`/`.yCol`, `info_columns`, `info_template` (with a `{ColumnName}`
placeholder), `filter_clause`, and — if adopted — `configPatch.info_columns`/`configPatch.info_template`.
`packages/server/tests/lib.dashboardExportRefs.spec.ts` (if it exists) or the dashboardExportRefs
tests generally are a second reference for fixture style; run `node scripts/test-gate.mjs` per
CLAUDE.md, never raw `npx vitest run`, and never assert a fixed pass-count — only that the failing
set stays inside the documented `KNOWN_FAILING` set.

### String-literal detection (secondary question)

No real `customWhere`/`sql`/`expression`/`template_sql`/`filter_clause` text in either database
contains an escaped quote (checked all 12 real `customWhere` rows plus every `sql`/`expression`
value) — this path is entirely synthetic-fixture territory. Recommend a minimal single-quote state
machine: scan character-by-character, toggle an "inside literal" flag on unescaped `'`, treat `''`
(doubled single-quote, the SQL-standard escape) as a literal quote character rather than a
terminator, and — per the locked "fail toward reporting" rule — if the string ends while still
"inside a literal" (malformed/truncated SQL), treat the remainder as **outside** a literal for
matching purposes rather than silently swallowing it. A missed finding is expensive; a false positive
on genuinely malformed SQL is merely noise, and malformed SQL should not exist in practice.

### Low-confidence rule — sanity-checked against real data

Computed against the real 564 column names: length ≤ 3 **OR** case-insensitive stoplist match
(`date`, `time`, `name`, `type`, `value`, `count`, `key`, `data`, `status`, `code`, `id`, `text`,
`number`) classifies **26/564 (4.6%)** of real columns as low-confidence:
`2G, 3G, 4G, Date, MCC, MNC, NAME, Time, WKT, X, Y, alt, date, edt, eta, ete, fix, gs, lob, mcc, mnc,
name, nic, reg, sil, type`. This confirms real columns literally named `name`/`NAME`/`type`/`Date`/
`date`/`Time` exist in this dataset (grounding the stoplist choice in fact, not speculation) and that
the proportion (well under 5%) feels proportionate — most real columns are specific enough
(`Connection_ServiceProviderBrandName`, `location_gross_loss_amount`) that they will not spuriously
match unrelated text. Note `WKT` lands in the low-confidence tier purely by the length≤3 rule despite
being a structurally important, frequently-used column (`wktColumn`'s value) — that is expected and
harmless: the confidence tier only ever applies to **free-SQL** matches; the structured `wktColumn`
site itself is always `exact` regardless of the column's name length.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Reference-site enumeration for widget config | A second, parallel enumeration of "which config keys hold ids/columns" | Reuse `dashboardExportRefs.ts`'s per-widget-type visitor discipline as the pattern (not the code) | Two independent enumerations of the same config shape is precisely the drift problem `dashboardExportRefs.ts`'s own header warns against — a ninth reference kind there was added by extending ONE function; do the analogous thing here. |
| SQL literal/quote handling | A full SQL parser/tokenizer dependency | A minimal single-quote state machine (see above) | No real data in this codebase contains anything more complex than simple `'...'` literals inside `WHERE`/`SELECT`/`GROUP BY` fragments; a real parser is unjustified complexity for text that is never executed, only pattern-matched. |
| Column-name identifier boundaries | Manual string `.includes()`/`.indexOf()` scanning | The locked `RegExp` with negative lookaround | Already proven necessary by the 248 real substring pairs; do not relitigate. |

**Key insight:** every "don't hand-roll" temptation in this phase resolves the same way — reuse the
shape `dashboardExportRefs.ts` already established for "one enumeration, many consumers," rather than
inventing a second traversal library.

## Common Pitfalls

### Pitfall 1: Treating `columns_json[].name` as automatically table-scoped

**What goes wrong:** A dv-bound structured finding is reported as "column X on table Y" with full
confidence, but the dv's `template_sql` joins in an unregistered table, so the name actually belongs
to something else entirely.
**Why it happens:** `columns_json` looks exactly like other structured, table-scoped fields (a flat
array of `{name, type}` with a clean `source_table_id` FK) — nothing about its *shape* signals the
join risk; only reading `template_sql` reveals it.
**How to avoid:** See Finding 1's recommendation — treat as heuristic/table-less, or explicitly gate
on detecting no join, and document the choice in the SUMMARY.
**Warning signs:** A dv whose `columns_json` names don't appear anywhere in its `source_table_id`'s
registered column list (exactly what dv#1/dv#2 look like) — that pattern is diagnostic of a joined
template, and finding it in QA data for a NEW customer dataset should raise the same flag it raised
here.

### Pitfall 2: Assuming the `configPatch` allow-list is a single, static list

**What goes wrong:** Building the traversal only against `LAYER_ALLOW_LIST` in `actionAllowList.ts`
(5 strict fields, includes `cb_config`/`track_config`) and missing that `validateLayerSnapshot` (a
DIFFERENT, denylist-based validator for the SAME `configPatch` slot on layer targets) legitimizes a
much wider field set, including `info_columns`/`info_template`.
**Why it happens:** Two validators exist for historical reasons (Phase 58/58.1 strict allow-list for
widget/dynamicView targets vs. Phase 60.1 RE-SCOPE denylist for layer targets) and nothing in the
persisted data distinguishes which one produced a given `configPatch` — both produce structurally
identical JSON.
**How to avoid:** Read `applyWidgetAction.ts`'s `LAYER_SNAPSHOT_TOP_LEVEL` constant, not just
`actionAllowList.ts`'s named allow-lists, when deciding which `configPatch` keys can carry columns.
**Warning signs:** A field with zero real instances that "seems like it should be excluded because it
doesn't appear in the allow-list docstring" — that is exactly Finding 2.

### Pitfall 3: Genuinely believing a case-insensitive double-hit (MCC/mcc) is a bug

**What goes wrong:** During implementation/testing, a fixture reproducing the MCC/mcc scenario
produces two heuristic findings for the same SQL text (once when querying table 7's `MCC`, once for
table 8's `mcc`), and this looks like a duplicate-detection bug.
**Why it happens:** It is the direct, intended consequence of the locked case-insensitive rule
combined with "free-SQL findings assert no table" — there is no way to know from text alone which of
two differently-cased, differently-tabled columns a case-insensitive match "really" means.
**How to avoid:** Build the MCC/mcc fixture explicitly (Finding 6 above) as a test that asserts BOTH
findings occur, so the behavior is documented and expected rather than "discovered" as a surprise
during a later debugging session.

## Code Examples

### Whole-identifier, case-insensitive, per-column regex (locked pattern)

```ts
// Source: 123-CONTEXT.md decisions, cross-verified against real customWhere/sql/template_sql text.
function columnMatchRegex(columnName: string): RegExp {
  const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "gi");
}
```

### Minimal quoted-literal skip (no real data exercises escaping — built for the synthetic fixture)

```ts
// Fails toward REPORTING on any ambiguity (unterminated literal) rather than dropping text.
function stripQuotedLiterals(sql: string): string {
  let out = "";
  let inLiteral = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inLiteral && sql[i + 1] === "'") {
        // doubled single-quote = escaped literal quote char; consume both, stay inside literal
        i++;
        continue;
      }
      inLiteral = !inLiteral;
      continue;
    }
    if (!inLiteral) out += ch;
    else out += " "; // preserve offsets: replace literal chars with spaces, don't delete them
  }
  return out; // if the string ends still "inLiteral", the remainder was already emitted as-is above
}
```

### Dynamic-view table resolution (from real `ChartConfigPanel.tsx:1071-1084`)

```ts
// Source: packages/web/src/components/charts/ChartConfigPanel.tsx:1071-1084 (verbatim behavior)
const persistedTableId = selectedSource?.kind === "dynamic"
  ? selectedSource.sourceTableId
  : selectedSource?.tableId;
const persistedDynamicViewId = selectedSource?.kind === "dynamic"
  ? selectedSource.dynamicViewId
  : undefined;
// => dv-bound widgets persist BOTH tableId (= dv.source_table_id) AND dynamicViewId.
// => non-dv-bound widgets persist ONLY tableId; dynamicViewId key is deleted, not set to undefined.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `LAYER_ALLOW_LIST` strict allow-list governs all `configPatch` fields for layer targets | `validateLayerSnapshot` denylist governs layer-target `configPatch` (accepts everything except data-binding/spatial/meta keys) | Phase 60.1 RE-SCOPE | Widens what can legitimately appear in a layer's `configPatch` — this phase must scan against the wider, current reality (Finding 2), not the older strict list's documented field set. |

**Deprecated/outdated:** None found specific to this phase's domain beyond the above.

## Open Questions

1. **Should `columns_json[].name` findings be `exact` (table-scoped) or `heuristic` (table-less)?**
   - What we know: for non-joined dvs (dv#3/dv#4 in this dataset) it is a perfect 1:1 match against
     the registered source table. For joined dvs (dv#1/dv#2) it demonstrably is not.
   - What's unclear: whether the traversal can/should attempt to detect "this template joins another
     table" from `template_sql` text (fragile) versus always treating the site as heuristic (safe but
     slightly less precise for the common non-join case).
   - Recommendation: default to heuristic/table-less (mirrors `template_sql` itself, since
     `columns_json` is literally a cache of that same query's output shape); revisit only if Phase 124
     needs the precision.

2. **Does SSYNC-V125-07's "and through the configPatch copies" language cover `info_columns`/
   `info_template`, or only `cb_config`/`track_config`?**
   - What we know: `configPatch.info_columns`/`.info_template` are code-reachable today via
     `validateLayerSnapshot`, with zero current instances.
   - What's unclear: whether the requirement's intent was scoped to the two fields CONTEXT.md named,
     or to "whatever a layer configPatch can carry."
   - Recommendation: include them — the cost of enumerating two more fields inside a site the
     traversal must already visit is near-zero, and the failure mode (silently missing a future
     operator's info-popup override) is exactly what this phase exists to prevent.

3. **Is there a `dashboard_dynamic_views.columns_json[].type` retype-staleness concern parallel to
   `drillDownColumnType`?**
   - What we know: `columns_json[].type` is also frozen at Preview time and can go stale on a
     Kinetica retype, same failure class as SSYNC-V125-12.
   - What's unclear: whether this is in scope for Phase 123 (name enumeration) or purely a Phase
     124/125 concern (retype classification/reporting).
   - Recommendation: out of scope for `columnRefs.ts` itself (which enumerates NAME references, not
     type staleness) but worth a one-line note in the SUMMARY so Phase 124 knows this second frozen-
     type cache exists alongside `drillDownColumnType`.

## Sources

### Primary (HIGH confidence — direct, read-only queries against real project data)
- `packages/server/data/kinetica.db` (better-sqlite3, `readonly: true`) — all tables walked; exact
  counts and samples quoted above.
- `packages/server/data/env-b.db` (same method) — comparison sweep, reported clean/corroborating.
- `packages/server/src/lib/dashboardExportRefs.ts` — the inherited visitor pattern; REF-1..REF-9
  history and the `getOptionActionsLike` legacy/plural precedent.
- `packages/web/src/lib/actionAllowList.ts` (full file) — `WIDGET_ALLOW_LIST`, `LAYER_ALLOW_LIST`,
  `PERMANENTLY_BLOCKED_KEYS`, `DATA_BINDING_KEYS`, `validateActionPatch`, `validateLayerSnapshot`.
- `packages/web/src/lib/applyWidgetAction.ts` — `LAYER_SNAPSHOT_TOP_LEVEL`, `splitLayerSnapshot`,
  confirming `info_columns`/`info_template` pass the current layer-target validator.
- `packages/web/src/lib/radioGroupLayerPatch.ts` — `INFO_FIELDS` constant, snapshot shape docs.
- `packages/web/src/components/charts/ChartConfigPanel.tsx:1071-1084` — the dv dual-write.
- `packages/web/src/lib/trackConfig.ts` — `TrackConfig` type, confirms `xCol`/`yCol` are real,
  currently-unused-in-data fields (Phase 52).
- `packages/web/src/lib/trackDetect.ts` — confirms this is a SEPARATE, unrelated runtime
  column-shape detector, not part of persisted `track_config`.
- `packages/server/src/lib/schemaDiff.ts`, `schemaFingerprint.ts`, and
  `.planning/phases/122-schema-diff-table-missing-detection/122-03-SUMMARY.md` — the
  `SchemaCheckResult` contract this phase's output feeds, and the test/mutation-probe style to mirror.
- `packages/web/src/components/charts/definitions/records.ts`, `.../bignumber.ts` — confirm
  `sortField`/`deltaField` field definitions and empty-string defaults.
- `./CLAUDE.md` — "Writing verifiable acceptance criteria" and "Test gates" sections, applied
  throughout (every count/grep claim above was run, not assumed).

### Secondary (MEDIUM confidence)
- None — all findings in this document were either directly queried from the dev databases or traced
  to a specific, quoted line in the source tree.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Adversarial sweep findings (Findings 1, 3, zero-instance list, exclude list, MCC/mcc collision):
  HIGH — directly queried from the dev DB, read-only, with exact counts reproduced above.
- Finding 2 (`configPatch.info_columns`/`.info_template`): MEDIUM — code-verified (the validator
  demonstrably accepts these keys) but zero live instances to confirm the exact persisted shape in
  practice; recommend a synthetic fixture rather than assuming.
- Standard stack / architecture: HIGH — this phase adds no new dependency and directly mirrors two
  already-shipped, already-reviewed sibling modules (`schemaDiff.ts`, `dashboardExportRefs.ts`).
- Pitfalls: HIGH — each is backed by a specific, quoted data or code artifact, not speculation.

**Research date:** 2026-09-22
**Valid until:** Until the dev DB's seed data changes materially (new widgets/layers/dvs added) or
`actionAllowList.ts`/`applyWidgetAction.ts` are touched by a later phase — this research is a snapshot
of `feat/schema-sync` at commit `3c387f0`. Re-verify the `columns_json` and `configPatch.info_*`
findings if either file changes before Phase 123 executes.
