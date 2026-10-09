# Phase 124: Impact Report - Research

**Researched:** 2026-09-23
**Domain:** severity classification of a Kinetica column fingerprint diff; cross-package pure-lib sharing; report shape for a widget/layer/metric impact report
**Confidence:** MEDIUM — the case explicitly named in the objective (long+timestamp) is HIGH confidence (live-spike-verified); three *additional* load-bearing miscues this research found (boolean, decimal, date/time/datetime) are MEDIUM confidence (official-docs-verified, cross-checked against real dev-DB legacy data, but **not** live-fingerprint-verified — no Kinetica instance was reachable during this research) — see "Open Questions".

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Severity — three levels, not two.** A retype only breaks the app when it changes the **type
class** the UI branches on (`number` / `string` / `datetime` / `boolean`, per
`inferDataTypeFromColumn`).

| Level | Means | Examples |
|---|---|---|
| **breaking** | the type class flips, or the column is gone | `int → varchar`; any removed column |
| **changed** | same class, different type — nothing in the app misbehaves, but the data meaning moved | `int → double`, `varchar(8) → varchar(32)` |
| **harmless** | no dependent can break | added columns |

A `breaking` retype must additionally flag every widget carrying a frozen `drillDownColumnType`
for that column (criterion 4) — 69 widget configs carry that field
(`ChartConfigPanel.tsx:1063-1065`).

**A removed column found only in free SQL is BREAKING, flagged unconfirmed** — not demoted to a
separate "possibly affected" area.

**Naming.** The report nudges the operator to fix their naming rather than papering over it.
- Ambiguous titles: default identification is title + dashboard name; widget id appended **only**
  when a title collides within its dashboard, with an advisory to rename and re-run.
- Missing names: fall back to id, state plainly the widget has no name, suggest naming + re-run.
- Layers named from `config.name` (JSON field, may be absent; same fallback rule).
- The advisory appears in BOTH the individual finding AND once at report level.

**Structure — by SEVERITY first, then by column.** Breaking, then changed, then harmless; within
each, grouped by column; within a column, grouped by record. Grouping by record within a column is
REQUIRED (a widget routinely produces both an exact finding and a heuristic one for the same
column — must not appear twice).

**Certainty — tier AND report-ready prose.** Each finding carries `exact` / `heuristic` /
`low-confidence` **and** prose the UI renders verbatim.

### Claude's Discretion
- The report type's exact field names and nesting, provided it is reproduced verbatim in the
  SUMMARY (Phase 125 persists it, Phase 126 renders it).
- Exact advisory wording, within the decisions above.
- How `tableScope: "unresolved"` findings are presented — must be present and honestly labelled,
  phrasing open.
- Whether an unaffected check returns an empty report or an explicit "nothing affected" marker —
  pick one, be consistent; Phase 126 must distinguish "no findings" from "not yet run".
- Whether severity is computed in a new pure lib or inside the existing check route — a `lib/`
  module is the house pattern (`schemaDiff.ts`, `columnRefs.ts`).

### Deferred Ideas (OUT OF SCOPE)
- Auto-repair (`SSYNC-F1`) — report only, never fix.
- `dynamicView.columns_json[].type` — a second frozen type cache; surface if it fits the severity
  model cheaply, otherwise record as a known gap.
- `SSYNC-F6` — server-side column-existence gate. Adjacent, not this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SSYNC-V125-06 | Every widget referencing a removed/retyped column through a structured config field is shown, named by widget title + dashboard | `ColumnRef` contract (`recordKind: "widget"`, `path`, `confidence: "exact"`) gives the structured findings directly; widget→dashboard join needed (see "Naming Resolution" below) |
| SSYNC-V125-09 | Exact vs heuristic (free-SQL) references are distinguishable | `ColumnRef.confidence` (`exact`/`heuristic`/`low-confidence`) is already the tri-level tag; `tableScope` (`scoped`/`free-sql`/`unresolved`) is the complementary signal for how the record's table was determined |
| SSYNC-V125-10 | Every `column_display_config` rule bound to an affected column appears | `ColumnRef` site `columnDisplayConfig.column_name` (`recordId: null`, identify by `(tableId, recordLabel)`) is already enumerated by Phase 123 |
| SSYNC-V125-11 | Added columns presented separately, never among breaking | `SchemaDiff.added: AddedColumn[]` is already a distinct array from `retyped`/`removed`; severity is a pure function of which array a change is drawn from plus (for `retyped`) the class-flip test below |
| SSYNC-V125-12 | Retyped entry states old/new type; flags widgets with frozen `drillDownColumnType` for that column | The fingerprint→class mapping (this doc's lead section) is what "flips" means; the frozen-type cross-reference is answered in "drillDownColumnType Staleness" below |
</phase_requirements>

---

## 1. The fingerprint→class mapping (THE decisive question)

### 1.1 What the two shapes actually are

- **`ColumnFingerprint`** (`schemaFingerprint.ts`): `{ base: string; refinements: string[] }`. `base`
  is the Avro type from `type_schemas` with `"null"` stripped from unions and lowercased.
  `refinements` is the sorted, lowercased `/show/table` `properties` markers with
  `NON_TYPE_PROPERTIES` (`data`, `store_only`, `disk_optimized`, `text_search`, `primary_key`,
  `shard_key`, `dict`, `init_with_now`, `nullable`, `unique`) removed.
- **`inferDataTypeFromColumn(colName, columns: Record<string,string>)`** (`columnTypes.ts:85`):
  looks up a single flat string (an `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE`-shaped value, e.g.
  `"character(256)"`, `"bigint"`, `"real"`) and buckets it into `number`/`string`/`datetime`/
  `boolean`/`null` via `NUMERIC_TYPES`/`BOOLEAN_TYPES`/`DATETIME_TYPES` (lines 42-65) with everything
  unmatched defaulting to `"string"`.

**These are not compatible inputs.** `inferDataTypeFromColumn` cannot be called directly on a
`ColumnFingerprint` — there is no flat string to look up. Phase 124 needs a **new** function,
shaped for the fingerprint, that reproduces the same four-way class taxonomy. It cannot be a
byte-parity port of `inferDataTypeFromColumn` because the input shape differs; it can only reuse
the four *Sets* (`NUMERIC_TYPES`/`BOOLEAN_TYPES`/`DATETIME_TYPES`) as constants. See §2.

### 1.2 Real fingerprint values from 122-SPIKE-NOTES.md, classified

| Real column (nyctaxi / pg_views) | `base` | `refinements` | Correct class | Does base-ONLY get it right? |
|---|---|---|---|---|
| `vendor_id` (char4) | `string` | `["char4"]` | `string` | ✅ yes (string base always defaults to `string`) |
| `payment_type` (char16) | `string` | `["char16"]` | `string` | ✅ yes |
| `store_and_fwd_flag` (char1) | `string` | `["char1"]` | `string` | ✅ yes |
| `passenger_count` / `cab_type` (int8) | `int` | `["int8"]` | `number` | ✅ yes (width refinement, not a class marker) |
| `rate_code_id` (int16) | `int` | `["int16"]` | `number` | ✅ yes |
| `trip_distance` | `float` | `[]` | `number` | ✅ yes |
| **`pickup_datetime` / `dropoff_datetime`** | **`long`** | **`["timestamp"]`** | **`datetime`** | **❌ NO — base-only says `number`. This is the load-bearing case named in the objective.** |
| `pg_views.schemaname` (nullable, char256) | `string` | `["char256"]` | `string` | ✅ yes — union `["string","null"]` correctly strips to base `string`; `nullable` correctly excluded from `refinements` by `NON_TYPE_PROPERTIES` |
| `pg_views.definition` (nullable) | `string` | `[]` | `string` | ✅ yes |

**Answer to sub-question 1:** the ADDENDUM's `pg_catalog.pg_views` union/nullable fixture happens to
classify correctly under a base-only rule, but **only coincidentally** — both its example columns
(`schemaname`, `definition`) are string-base with no class-flipping refinement, so their
classification is `string` regardless of whether refinements are consulted at all. The ADDENDUM
fixture proves the union-stripping and `nullable`-exclusion machinery is safe for classification; it
neither proves nor disproves the load-bearing timestamp case, which only the original `nyctaxi`
fixture exercises. **A base-only rule is provably wrong for exactly the case the objective names**
(`pickup_datetime`: base `long` ∈ `NUMERIC_TYPES` → `"number"`, but the column is a Kinetica
TIMESTAMP and every consumer that branches on `DrillDownDataType` — chip text, equality-filter
quoting, the drill-down time-column picker — needs `"datetime"`). Reclassifying a TIMESTAMP-typed
column as `number`-class would grade a `timestamp → bigint`-shaped retype (or vice-versa) as
`changed`, not `breaking` — silently wrong in exactly the direction 122-SPIKE-NOTES.md's Q4 already
flagged as catastrophic (`lib/showTableTypes.ts` exists specifically to undo this same flattening
one layer up, in the legacy `INFORMATION_SCHEMA` path).

### 1.3 THREE MORE load-bearing miscues this research found (not named in the objective)

I fetched Kinetica 7.1's official docs (`docs.kinetica.com/7.1/concepts/types/` and
`.../7.1/time_series/types/`) to fill in property markers the spike never exercised (the spike only
probed `demo.nyctaxi` and `pg_catalog.pg_views` — neither has a boolean, decimal, or DATE/TIME/
DATETIME column). Per Kinetica's own property table:

| Property | Valid base type(s) per Kinetica 7.1 docs |
|---|---|
| `boolean` | **`int`** — "There is no native boolean base type. Instead, boolean is represented as an `int` column with the `boolean` property applied." |
| `decimal(p,s)` | **`string`** |
| `date` | **`string`** (per `docs.kinetica.com/7.1/time_series/types/`: "DATE: Base Type `string`") |
| `time` | **`string`** ("TIME: Base Type `string`") |
| `datetime` | **`string`** ("DATETIME: Base Type `string`") |
| `timestamp` | `long` (confirms the spike) |
| `ipv4`, `uuid`, `json`, `char1`..`char256`, `array(...)` | `string` (or, for `array`, sometimes `bytes` for `vector(n)`) |
| `wkt` | `string` **or** `bytes` |

Applying the same "does base-only get it right" test:

| Fingerprint shape (not yet spike-verified — inferred from official docs) | Correct class | Base-only result | Verdict |
|---|---|---|---|
| `{ base: "int", refinements: ["boolean"] }` | `boolean` | `number` (`int` ∈ `NUMERIC_TYPES`) | ❌ **WRONG** |
| `{ base: "string", refinements: ["decimal(18,4)"] }` | `number` | `string` (default) | ❌ **WRONG** |
| `{ base: "string", refinements: ["date"] }` | `datetime` | `string` (default) | ❌ **WRONG** |
| `{ base: "string", refinements: ["datetime"] }` | `datetime` | `string` (default) | ❌ **WRONG** |
| `{ base: "string", refinements: ["time"] }` | `datetime` | `string` (default) | ❌ **WRONG** |

**These are not academic edge cases for this deployment.** I inspected `packages/server/data/
kinetica.db` (read-only) and the legacy `tables.columns` (flat `INFORMATION_SCHEMA`-shaped) values
already on disk include, across the real tables registered today: **4 `boolean`, 12
`numeric(18,4)`, 3 `date`, 5 `datetime`** columns (plus 10 `bigint`, of which only one —
`track.TIMESTAMP` — is a disguised TIMESTAMP; the other `bigint` columns in this same database are
genuine non-temporal integer metrics, e.g. a download-throughput-in-kbps style column and several
opaque numeric-id columns — confirming `bigint`/`long` is a genuinely overloaded base in real data
here, not a spike hypothetical). All four of `boolean`, `numeric(*)`, `date`, and `datetime` are
**already classified `boolean`/`number`/`datetime`/`datetime` respectively today**, under the
existing legacy `inferDataTypeFromColumn` path (`NUMERIC_TYPES` contains `"numeric"`/`"decimal"`
tokens directly; `BOOLEAN_TYPES` and `DATETIME_TYPES` cover the other three verbatim). **If the
fingerprint-based classifier used a base-only rule, the very first live retype touching any of these
column shapes would silently disagree with the classification this app already gives that same data
today** — e.g. a genuinely harmless `decimal(18,4) → decimal(10,2)` precision change would report as
`breaking` (string→string is same-class, so it's actually fine either way for decimal→decimal — but
`decimal(18,4) → double` really is same-class/`number`→`number` and a base-only rule would wrongly
call it `breaking` since it sees `string`→`double`), and a `date → varchar` retype (a genuine class
flip, datetime→string) would be **missed** and reported merely as `changed`, the opposite of the
locked "fail toward reporting" philosophy this project applies everywhere else (`columnRefs.ts`,
`schemaDiff.ts`).

**Recommended rule — check refinements for a class-determining marker BEFORE falling back to base:**

```ts
// Order matters. Refinement markers are checked FIRST, regardless of which base
// carries them — this sidesteps needing to know in advance whether Kinetica encodes
// a given temporal/boolean/decimal property on a string or an int/long base (see
// Open Questions: the codebase's own showTableTypes.ts and Kinetica's official docs
// DISAGREE about this for DATE/TIME/DATETIME).
function classifyFingerprint(fp: ColumnFingerprint): DrillDownDataType | "unknown" {
  const { base, refinements } = fp;
  if (refinements.some(r => r === "timestamp" || r === "date" || r === "time" || r === "datetime")) {
    return "datetime";
  }
  if (refinements.includes("boolean")) return "boolean";
  if (refinements.some(r => r.startsWith("decimal("))) return "number";
  if (NUMERIC_TYPES.has(base)) return "number";       // mirrored from columnTypes.ts:42-46
  if (base === "boolean") return "boolean";            // defensive; not known to occur as a literal Avro base
  if (base === "unknown") return "unknown";             // normalizeAvroType's own failure sentinel
  return "string";                                      // string/bytes bases, char*/ipv4/uuid/json/array/wkt refinements, and anything unrecognized
}
```

This rule is **robust to the base-vs-string ambiguity** for temporal/boolean/decimal markers because
it checks the *property marker* first — Kinetica's own model treats these properties as refining
(overriding) whatever the base type alone would imply, so trusting the marker over the base is
correct by construction, not merely a workaround.

**Answer to sub-question 2 (the mapping table):** see the rule above; the base sets to mirror
verbatim are `NUMERIC_TYPES` (columnTypes.ts:42-46: `int, integer, int8, int16, int32, int64, long,
float, double, "double precision", decimal, numeric, smallint, bigint, real, number, tinyint`),
`BOOLEAN_TYPES` (:64: `bool, boolean`), `DATETIME_TYPES` (:65: `timestamp, date, time, datetime`).
Only `NUMERIC_TYPES` is directly reusable as a base-membership test in the fingerprint world (the
`int`/`long`/`float`/`double` entries in it ARE real Avro bases); `BOOLEAN_TYPES`/`DATETIME_TYPES`
are **not** reusable as base-membership tests in the fingerprint world at all — `"boolean"` and
`"timestamp"`/`"date"`/`"time"`/`"datetime"` never appear as `fp.base` values per Kinetica's model
(there is no native boolean base, and only `timestamp` is a `long`-base property; the other three
are `string`-base per the docs) — they only ever appear as **refinement markers**. Any planner
design that tries to test `BOOLEAN_TYPES.has(fp.base)` or `DATETIME_TYPES.has(fp.base)` is testing
against a set that will never match a real fingerprint's `base` field; the membership test belongs
on `refinements`, not `base`.

### 1.4 Fingerprints with NO class (sub-question 3)

- **`base === "unknown"`** — `normalizeAvroType` returns this when `field.type` is a malformed/
  unrecognized Avro shape (e.g. an object without a string `.type`, or a union of only `["null"]`
  with nothing else). Real occurrence rate: **zero** in any spike output; this is a defensive
  sentinel, not an observed value.
- **Geometry/WKT.** Kinetica's `wkt` property is valid on a `string` **or** `bytes` base per the
  docs. Neither spike fixture (`demo.nyctaxi`, `pg_catalog.pg_views`) contains a geometry column, so
  **no real fingerprint for a geometry column has ever been captured** — this is a genuine gap, not
  an oversight of this research. The legacy path already has one: `us_states.WKT` is legacy-typed
  `"geometry"` in this dev DB, which `inferDataTypeFromColumn` today falls through to `"string"`
  (`"geometry"` matches none of `NUMERIC_TYPES`/`BOOLEAN_TYPES`/`DATETIME_TYPES`). **Recommendation:**
  classify a `bytes`-base or `wkt`-refined fingerprint as `"string"` too, for consistency with
  today's legacy behavior and because `EXCLUDED_DRILLDOWN_TYPES` (`columnTypes.ts:29-38`: `wkt, wkb,
  bytes, blob, text, point, geometry, geography`) already keeps these columns out of the
  `drillDownColumn` picker entirely — a WKT/geometry column can never carry a frozen
  `drillDownColumnType` in the first place (criterion 4's cross-reference is structurally moot for
  these), though it CAN still be referenced by `layer.config.wktColumn`/`wkbColumn`/`cb_config.attr`
  and so still needs an honest severity classification for those consumers. Flag this as LOW
  confidence — no live fingerprint of a real geometry column exists to verify against.
- **Bytes/blob.** Same treatment as geometry (`base === "bytes"` with no recognized refinement falls
  to the `"string"` default in the rule above) — same LOW-confidence caveat.

**Recommendation for `"unknown"`:** never silently default it into one of the four real classes.
Treat a retype where either side's `classifyFingerprint` result is `"unknown"` as **breaking**,
regardless of what the other side's class is — this is the same "fail toward reporting, a missed
finding is the expensive failure" rule `columnRefs.ts` and `schemaDiff.ts` apply everywhere else in
this phase's own dependency chain, and it is a direct instruction, not a discretionary choice, per
`CLAUDE.md`'s emphasis on never dressing an unprovable case in false confidence.

### 1.5 Old-format snapshots never reach severity (sub-question 4) — CONFIRMED, HIGH confidence

Traced the full call path in `packages/server/src/index.ts` (`GET /api/tables/:id/schema-check`,
lines ~2476-2517):

```ts
const stored = parseFingerprintSnapshot(getTableColumnsFingerprint(id));
if (!stored) return res.json(baselineRequiredResult(qualified, live));   // <-- exits BEFORE diffResult
return res.json(diffResult(qualified, stored, live));                    // <-- only path that builds `retyped`
```

`parseFingerprintSnapshot` (`schemaFingerprint.ts:214-243`) returns `null` for anything that is not
the exact `{v:1, columns: {...}}` shape — including a `NULL` `columns_fingerprint` column (the
current state of every one of the 9 tables in this dev DB, confirmed by direct read-only query
below), a legacy pre-Phase-122 value, or a corrupt string. `SchemaCheckResult`'s `"diff"` variant —
the only variant carrying a `retyped: RetypedColumn[]` array — is only ever constructed by
`diffResult()`, and `diffResult()` is only ever called after the `!stored` early-return has already
happened. **`RetypedColumn.stored`/`.live` are typed as `ColumnFingerprint`, never `string`** — the
type system itself makes it structurally impossible for a `RetypedColumn` to carry a raw legacy type
string. The only way an old-format value could ever reach a severity classifier is if a future
engineer bypassed `diffResult`/`parseFingerprintSnapshot` entirely and hand-built a `SchemaCheckResult`
— a code-review concern, not a live code path today. **Confirmed: the severity model never sees an
old-format value**, and Phase 124 does not need any defensive handling for it beyond "consume
`SchemaCheckResult.retyped`, which is already guaranteed well-formed."

### 1.6 Verify with real data (sub-question 5) — PARTIALLY POSSIBLE, honestly reported

```
$ sqlite3 -readonly packages/server/data/kinetica.db "SELECT id, name, columns_fingerprint FROM tables;"
1|nyctaxi|
2|us_states|
3|track|
4|vaipr_location|
5|vaipr_location_exposure|
6|demodata|
7|mobile_time_only_k_vs1|
8|new_mobile_base_k_vs2|
9|data_coverage_voice_k_vs6|
```

**Every table's `columns_fingerprint` is empty/NULL.** This is expected and consistent with §1.5 —
Phase 125 (not yet built) is what ever writes this column, so there is currently **no real
stored-vs-live fingerprint pair anywhere in this database to run the classifier against directly.**
I cannot claim to have verified the mapping against a live retype, because none exists yet, and no
live Kinetica instance was reachable during this research session to generate one via the
`schema-fingerprint-spike` script.

What I *could* and did verify: I extracted every distinct legacy `DATA_TYPE` string across all 9
registered tables' `tables.columns` (the flat legacy shape) and ran each through the *current*,
already-shipped `inferDataTypeFromColumn` to get "what class does this app assign this data today":
`bigint`→number, `boolean`→boolean, `character(256)`→string, `date`→datetime, `datetime`→datetime,
`"double precision"`→number, `geometry`→string, `integer`→number, `"numeric(18,4)"`→number,
`real`→number, `smallint`→number, `text`→string, `timestamp`→datetime, `tinyint`→number. I then
checked that my recommended `classifyFingerprint` rule (§1.3) reproduces the **same** class for
every one of these, under the documented (not live-verified) fingerprint shape each legacy type
should correspond to. All 14 agree. This is an internal-consistency check, not a live-data
verification, and is reported as such — see Open Questions for what a real Wave-0 spike still needs
to confirm before this ships.

---

## 2. Mirror vs. move — `inferDataTypeFromColumn`'s reachability from the server

### 2.1 The direction problem

This repo's three existing pure-lib "mirror" pairs all run **canonical-in-server → mirror-in-web**:

| Pair | Canonical (server) | Mirror (web) | Parity mechanism |
|---|---|---|---|
| `permissions.ts` | `packages/server/src/lib/permissions.ts` | `packages/web/src/lib/permissions.ts` | "BYTE-PARITY: values must match server exactly... independently hardcodes all strings" |
| `spatialTargets.ts` (type) | `packages/server/src/lib/spatialWhereClause.ts:54-81` | `packages/web/src/lib/spatialTargets.ts` | Same field names/optionality, no camelCase rename — type duplication is "the established convention" |
| `dynamicViewName.ts` | `packages/server/src/lib/dynamicViewName.ts` (imports `sanitizeForViewName` from server-only `viewNaming.ts`) | `packages/web/src/lib/dynamicViewName.ts` | Web **inlines its own copy** of `sanitizeForViewName` (cannot import the server module either) — parity is enforced by a spec that hardcodes round-trip pairs "pulled directly from `packages/server/tests/lib.dynamicViewName.spec.ts`" |

`inferDataTypeFromColumn` is the **first** case where the canonical implementation lives in
`packages/web` and the *new* consumer is `packages/server` — i.e. the reverse direction. There is no
precedent for it in this codebase, and the prompt is right to flag it as genuinely new.

### 2.2 Infrastructure check — is a real shared package feasible?

```json
// root package.json
"workspaces": ["packages/*"]
```

Confirmed via `grep`: **zero** existing cross-package import statements anywhere in either tree
(only comment-text mentions of the sibling package's path, e.g. in `columnRefs.ts`'s header prose).
`packages/web/tsconfig.json` has no `paths`/`references` pointing at `packages/server` or a shared
package, and vice versa. Introducing a real `packages/shared` workspace is possible in principle
(npm workspaces support it trivially) but is **new infrastructure** this phase would be the first to
require: a third workspace entry, TS project references or path aliases in both `tsconfig.json`s,
and Vite (web's bundler) needs to resolve the shared package's TS source across the workspace
boundary (doable via `resolve.alias` or relying on npm's symlinked `node_modules`, but untested in
this repo). This is a disproportionate infra change for one function, and no other phase in the
v1.25 milestone needs it.

### 2.3 What actually needs to cross the boundary is smaller than the whole file

`packages/web/src/lib/columnTypes.ts` is a 330-line multi-purpose file: the type-class taxonomy
(`NUMERIC_TYPES`/`INTEGER_TYPES`/`BOOLEAN_TYPES`/`DATETIME_TYPES`/`normalizeType`/
`inferDataTypeFromColumn`/`EXCLUDED_DRILLDOWN_TYPES`/`isColumnDrillDownSafe`), chip-text rendering
(`buildChipText`, `formatDatetimeRange` — UI display only, SQL-escaping lives server-side in
`whereClause.ts` per the file's own header comment), and spatial-column helpers
(`getValidSpatialColumns`, `getTrackIdColumns`, `getTrackOrderColumns`, `autoSuggestSpatialMode`,
which import `./trackDetect`). The server has no legitimate use for the chip-text or spatial-picker
exports — mirroring the whole file would drag ~200 lines of UI-only logic (and a second file,
`trackDetect.ts`) into the server tree as permanent dead weight, plus widen the parity-test surface
for no benefit. **What Phase 124 actually needs is the four `Set`s as constants** (`NUMERIC_TYPES` /
`BOOLEAN_TYPES` / `DATETIME_TYPES`, and possibly `INTEGER_TYPES`) — and even those are not
sufficient alone, because (§1.1) the dispatch logic itself must be **new**, fingerprint-shaped code
that does not exist on either side today (`classifyFingerprint`, §1.3).

### 2.4 Three options, presented for the planner (not decided here — CONTEXT.md leaves this axis open)

**Option A — Mirror the whole module, house-pattern style.** Copy `columnTypes.ts` verbatim into
`packages/server/src/lib/`, add a byte-parity spec (à la `dynamicViewName.spec.ts`'s hardcoded
round-trip pairs). *Pro:* maximum consistency with the three existing precedents, zero new
judgment calls about what to include. *Con:* imports ~200 lines of UI-only code server has no use
for; every future UI-only change to `buildChipText`/spatial helpers is a no-op diff the parity test
still has to tolerate or explicitly exclude; the file's own header comments (written for a web
audience: "PITFALL: render path has no `TableDto.columns` in scope") would need rewriting to make
sense in a server file, and the maintenance direction is now **web is canonical but the
web-side author has no reason to know a server mirror exists** unless a project-wide convention
(a header comment banner, or a CI check) enforces looking. This is the same shape of risk the user's
own MEMORY.md already flags for RBAC permissions ("new RBAC permission breaks count assertions...
executors miss it") — a change on the canonical side silently drifting from an unmirrored server
copy is a known failure mode in this project, not a hypothetical.

**Option B — Mirror only the four `Set`s, and write `classifyFingerprint` as genuinely new
server-side code that consumes them.** A small, ~20-line `packages/server/src/lib/columnTypeClass.ts`
(or inline in whatever module computes severity) that reproduces `NUMERIC_TYPES`/`BOOLEAN_TYPES`/
`DATETIME_TYPES` verbatim (byte-parity comment citing `columnTypes.ts:42-65` line numbers, so a
future web-side edit to those specific lines is the trigger a reviewer is told to watch for) plus
the new `classifyFingerprint` dispatch function this phase must write regardless of where the Sets
live. *Pro:* minimal parity surface (3 sets, ~20 string literals, easy to diff by eye against the
cited line range), no dead UI code in the server tree, and it's honest about the fact that the
*novel* code (the fingerprint-shaped dispatcher) was never going to be a mirror of anything — it has
no web-side counterpart to mirror in the first place. *Con:* it is a smaller, less
literally-"the same pattern as before" precedent than Option A, so it's a slightly less obvious
match to grep for next time someone looks for "how does this repo share code between packages."

**Option C — Real shared package (`packages/shared`).** The textbook right answer for a monorepo,
structurally eliminates drift risk entirely (one file, two consumers, TypeScript enforces it). *Pro:*
correct long-term architecture. *Con:* new workspace, new build/tooling wiring in both `tsconfig.json`s
and Vite's config, untested in this repo, and disproportionate to a phase whose stated boundary is
"detect and report" — no other v1.25 phase needs this infrastructure, and CONTEXT.md's own
discretion list treats "new pure lib vs. inside the route" as the only structural question this phase
is expected to settle, not "invent a new workspace."

**This research's lean, stated for the planner to weigh, not decide unilaterally:** Option B. It is
the smallest surface that is still honest about what's actually shared (three enum-like Sets, not a
whole taxonomy) versus what's genuinely new (the fingerprint dispatcher), and it avoids importing
~200 lines of UI-only code server will never call. But Option A is defensible purely on
"consistency with three existing precedents," and the operator may reasonably prefer that
predictability over Option B's smaller footprint — this is the kind of close call CONTEXT.md's
discretion section implies the planner, not this research, should make explicit.

---

## 3. Secondary questions

### 3.1 `drillDownColumnType` staleness — reuse Phase 123's findings, do not re-walk

`columnRefs.ts`'s `COLUMN_REF_SITES` already enumerates `"widget.config.drillDownColumn"` as an
`exact`, structured site (`packages/server/src/lib/columnRefs.ts`, registry entry list, and the
`emitStructured` block reading `cfg.drillDownColumn`). For a given breaking-retyped column, Phase 124
should:

1. Call `collectColumnRefs(input, { tableId, columns: [retypedColumnName] })` (already computed for
   the whole impact walk — no separate call needed).
2. Filter to `site === "widget.config.drillDownColumn"`.
3. For each such `ColumnRef`, look up that widget's `config.drillDownColumnType` (the *frozen* value,
   read directly off the widget row already loaded for `collectColumnRefs`'s `ColumnRefsInput`) and
   surface it verbatim in the finding — e.g. "this widget's drill-down still expects `string`; the
   live column is now `datetime`."

This is a filter over `ColumnRef[]`, not a new traversal — `columnRefs.ts`'s own 123-01/04 SUMMARYs
explicitly flag this as the intended reuse (`"Phase 124 must group findings by record for
display"`), and the `drillDownColumn` site's `path` (`"config.drillDownColumn"`) is stable and
already distinguishes it from every other site.

### 3.2 `dynamicView.columns_json[].type` — record as a known gap, do not silently ignore

Confirmed (123-01-SUMMARY.md, 123-04-SUMMARY.md, both verbatim): this is a **second** frozen-type
cache, structurally identical in spirit to `drillDownColumnType`, but Phase 123's `columnRefs.ts`
only enumerates the **name** reference (`dynamicView.columns_json[].name`, `confidence: "heuristic"`,
table-less) — it does not enumerate or expose `columns_json[].type` at all; that field was
deliberately out of `columnRefs.ts`'s scope ("it enumerates NAME references, not type staleness").
**Whether it "fits the severity model cheaply"**: it does not, for the same reason `drillDownColumn`
does — a per-record scan is needed — but unlike `drillDownColumn`, there is **no existing
`ColumnRef` site** to filter for it; Phase 124 would have to walk `dynamicViews[].columns_json[]`
directly, duplicating traversal logic `columnRefs.ts` does not provide. Given 124-CONTEXT.md's own
instruction ("record it as a known gap rather than silently ignore it"), and given this is real,
extra traversal work with no existing contract to lean on, **this research recommends NOT building
that traversal in Phase 124** and instead having the report emit one clearly-worded, report-level
note (parallel to the naming advisory's report-level summary pattern already locked) stating that
dynamic-view cached column types are a second known stale-type cache this report does not check —
consistent with the "record it as a known gap" instruction without inventing new traversal scope
124-CONTEXT.md did not ask for.

### 3.3 Report shape — constraints implied by Phase 125 (persist) and Phase 126 (render)

- **Serializable.** Phase 125 persists the report (`sync history`), so every field must be JSON-safe
  — no `Map`/`Set`/functions/class instances. `ColumnFingerprint`, `ColumnRef`, `SchemaCheckResult`
  are all already plain JSON-shaped; the report type should stay in that family.
- **Size.** `ColumnRef.matches[]` can carry the full source line verbatim per match (locked, for
  operator visibility) — for a wide `widget.config.sql`/`customWhere`/`template_sql` blob with many
  occurrences of a short/common column name (e.g. `id`, `date`), this can be non-trivial per finding.
  Nothing in scope requires truncation, but the planner should decide whether Phase 125's persisted
  history has a practical size ceiling (not investigated here — out of this phase's stated
  boundary, but worth flagging since the report shape is a contract Phase 125 is "planned against").
- **Distinguish "no findings" from "not yet run."** Locked as Claude's discretion in CONTEXT.md —
  this research did not find a reason to prefer one representation over the other; whichever is
  chosen, `SchemaCheckResult`'s own three-outcome pattern (`diff`/`baseline_required`/
  `table_missing`) is a workable precedent: an impact report could similarly discriminate on an
  explicit field rather than an empty-array default that a client can't distinguish from "haven't
  checked."
- **Stability.** `schemaDiff.ts`'s sort comments are explicit that Phase 125 persists these arrays
  and a locale-dependent order would cause "spurious history churn between machines/locales" — the
  same discipline (byte-stable, non-locale sort; sort once, at the very end) should carry into
  whatever assembles the final report, mirroring `columnRefs.ts`'s `sortColumnRefs`/`dedupeColumnRefs`
  pattern (sort/dedup only at the entry point, never inside a per-site emitter).

### 3.4 Naming resolution — what the report needs loaded

Confirmed against live dev-DB counts (matches 124-CONTEXT.md's stated naming data exactly):
**74 widgets across 7 dashboards**, **4 (dashboard, title) pairs ambiguous**. To resolve names the
report needs, loaded once per check (all already loaded for `ColumnRefsInput`, so no new query):

- `widgets` joined to `dashboards` (for dashboard name) — `dashboard_layers` has **no name column**
  (`.schema dashboard_layers`, confirmed) — a layer's display name is `JSON.parse(layer.config).name`,
  which may be absent (must fall back per the locked rule).
- For the ambiguity check itself: group widgets by `(dashboard_id, title)`, count > 1 ⇒ collision ⇒
  append id + advisory for every widget in that group, per the locked rule.
- `custom_metrics.label` (all 10 distinct today, per CONTEXT.md — still worth a collision check for
  robustness, since the report's own principle is "nudge toward fixing naming," and a future dataset
  could have duplicate metric labels even though this one doesn't).
- `dashboard_layers.config.name` for layers — same missing/duplicate-fallback rule as widget titles;
  no dedicated "layer title" column exists to fall back to besides the layer's own numeric `id`.

### 3.5 Test strategy

`packages/server/tests/lib.schemaDiff.spec.ts` and `lib.columnRefs.spec.ts` are the house pattern:
pure-lib, fixture-based, mutation-probed (every plan in 122/123 ran and reported a full mutation
probe table — this phase should do the same for `classifyFingerprint` and the report assembler).
Server test gate is **SET-BASED**: `node scripts/test-gate.mjs`, never raw `npx vitest run` for a
pass/fail gate, never a fixed pass-count assertion (CLAUDE.md, and confirmed by every 122/123
SUMMARY's own "Gate Reports" section, which report the *set* of `KNOWN_FAILING` files staying
constant, not a fixed total). The known `TD-V16-TEST-ISOLATION` class of parallel-scheduling
cross-file contamination (documented in three separate 123-0x SUMMARYs) means a transient failure
outside this phase's own files, confirmed passing in isolation on re-run, is not this phase's
regression.

**Fixtures should be built from real column shapes where they exist** (the `NUMERIC_TYPES`/
`BOOLEAN_TYPES`/`DATETIME_TYPES` legacy-type cross-check in §1.6 gives 14 real distinct legacy type
strings to derive fixtures from) **and labelled SYNTHETIC where they don't** (per the established
123-0x convention) — most prominently, **every fingerprint shape for `boolean`, `decimal(p,s)`,
`date`, `time`, and `datetime`, plus anything geometry/`bytes`-based, is synthetic**: no live
Kinetica `/show/table` fingerprint of any of these has ever been captured in this project (§1.3-1.4).
This should be stated in the test file's own comments, not just in a SUMMARY, per the project's
established "a site with no real data behind it is where a bug survives" discipline
(`columnRefs.ts`'s own header and multiple inline comments make exactly this point about its
zero-instance sites).

---

## Open Questions

1. **CONTRADICTION FOUND: does DATE/TIME/DATETIME sit on a `string` base or a `long` base?**
   - What we know: Kinetica's own official docs (two independent pages,
     `docs.kinetica.com/7.1/concepts/types/` and `.../7.1/time_series/types/`) both state DATE, TIME,
     and DATETIME are `string`-base properties and only TIMESTAMP is `long`-base.
   - What contradicts it: **this exact codebase's own `packages/server/src/lib/showTableTypes.ts`**
     header comment states plainly: *"Kinetica stores TIMESTAMP / DATE / TIME / DATETIME columns with
     a base storage type of `long`"* — i.e. it claims all four share the `long` base, disagreeing with
     the docs on three of the four.
   - Why it doesn't matter for `showTableTypes.ts` itself: that module never reads `base`/
     `type_schemas` at all — it only reads `properties` marker strings and returns them keyed by
     column name, so its own claim about the base type is unused dead prose, not load-bearing to its
     actual behavior.
   - Why it DOES matter here: the recommended `classifyFingerprint` rule (§1.3) is written to be
     robust to this exact ambiguity (it checks `refinements` for the marker before ever consulting
     `base`), so **the planner does not need to resolve this contradiction to ship a correct rule**
     — but a Wave 0 spike (mirroring 122-SPIKE-NOTES.md's own precedent: "spike output that's only
     'no error' is a trap") should still probe a real Kinetica table carrying a genuine DATE, TIME,
     or DATETIME column (not TIMESTAMP) before this ships, both to settle which of the two
     conflicting claims is correct **and** to catch any THIRD possibility neither source considered
     (e.g. Kinetica could encode these on a base value not documented here at all).
   - Recommendation: treat §1.3's table as MEDIUM confidence pending that spike; do not let this
     phase's plan silently upgrade it to HIGH without the spike, and do not block the phase on
     running it if a live Kinetica instance isn't available in time — the refinement-first rule
     degrades safely either way.

2. **Boolean, decimal, and geometry/bytes fingerprint shapes are entirely unverified against a live
   instance.**
   - What we know: official docs state `boolean` sits on `int`, `decimal(p,s)` sits on `string`, and
     `wkt` sits on `string` or `bytes`.
   - What's unclear: whether Kinetica's live `/show/table` response actually surfaces these exactly
     as documented (the char-width case in 122-SPIKE-NOTES.md's own Q4 is a cautionary tale — the
     *documented* claim about `INFORMATION_SCHEMA` character width was right, but the project's own
     rule is "these are the real bodies" over documentation precisely because doc-only claims proved
     insufficient elsewhere in this same phase's dependency chain).
   - Recommendation: same as above — a Wave 0 spike against a table with a real boolean, decimal, and
     (if available) geometry column, mirroring the `schema-fingerprint-spike` npm script Phase 122
     already built (`packages/server/src/spikes/schemaFingerprintSpike.ts`) rather than inventing a
     new spike mechanism.

3. **Report size ceiling for Phase 125's persisted history** — not investigated (out of this phase's
   stated boundary; flagged in §3.3 for the planner to raise with Phase 125 if it matters).

4. **Whether "no findings" is an empty array or an explicit marker** — locked as Claude's discretion
   in CONTEXT.md; this research found no technical reason to prefer either, so it is left to the
   planner as instructed, with `SchemaCheckResult`'s three-outcome discriminated-union style offered
   as a workable precedent (§3.3).

---

## Addendum — live probe against the deployed instance (2026-09-23, by the orchestrator)

The research above marked the boolean / decimal / date / time / datetime fingerprint shapes MEDIUM
(documentation-derived, not live-verified) and raised a contradiction between this codebase's own
`showTableTypes.ts` header and Kinetica's published docs. Kinetica is reachable locally, so I probed
it. Only the legacy-type → fingerprint MAPPING is recorded here; no table or column names are kept.

### Resolved

| Legacy `DATA_TYPE` | Real `/show/table` fingerprint | Class | Base-only rule correct? |
|---|---|---|---|
| `timestamp` | `base=long`, `refinements=[timestamp]` | `datetime` | **NO** — `long` ∈ NUMERIC_TYPES, so base-only yields `number` |
| `numeric(p,s)` | `base=double`, `refinements=[]` | `number` | yes |

**`numeric(p,s)` corrects a docs-derived claim in the research above.** That section states decimal
sits on base `string`; the real instance returns **`base=double` with no refinement**. So a decimal
column classifies correctly under a base-only rule, and any mapping table asserting otherwise would
have been wrong. Documentation lost to the live body, again.

**The `timestamp` case is reconfirmed and remains the decisive one**: a rule that classifies on
`base` alone grades a `timestamp → bigint` retype as *harmless* when it is catastrophic. Refinements
must be consulted before falling back to base.

### NOT resolved, and why

`boolean`, `date`, `time` and `datetime` could not be probed: **every registered table carrying
those types has been dropped from Kinetica**. `/show/table` returns HTTP 200 with
`table_names: []` for five of the nine registered tables.

That is itself worth recording — it is a live, unplanned demonstration of Phase 122's
`table_missing` outcome, and it means **more than half of this dev database's registered tables
would report as missing on a schema check today**. Phase 126's operator verification should expect
that rather than treat it as a defect.

### What the planner must do about the unresolved half

The recommended rule — **check `refinements` for a class-determining marker before falling back to
`base` membership** — is safe under either reading of the contradiction, because it keys on the
marker regardless of which base carries it. That property is why it should be kept even though the
mapping is only half-verified.

Two honest options, for the planner to choose and state:
1. **Ship the refinement-first rule with the four unverified types covered by name**, and record in
   the SUMMARY that `boolean`/`date`/`time`/`datetime` fingerprints are documentation-derived and
   unverified against a live body. Cheap, and the rule is designed to be robust either way.
2. **Gate a Wave-0 spike on creating one throwaway Kinetica table** carrying all four types, probing
   it, and dropping it. That resolves it definitively — but it WRITES to the operator's Kinetica
   instance, so it needs explicit operator consent and must not be assumed.

Do not silently pick (1) and present it as verified. The distinction between "verified" and
"designed to be safe" is exactly what this milestone has repeatedly found to matter.
