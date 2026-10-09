# Phase 122 — Spike Notes: real `/show/table` + `INFORMATION_SCHEMA` bodies

**Run:** 2026-09-21, by the operator, against the deployed Kinetica at `http://localhost:9191`
(user `admin`, `AUTH_MODE=password`). `cd packages/server && npm run schema-fingerprint-spike`.
**Fixture table:** `demo.nyctaxi` (19 columns spanning char1/char4/char16, int8/int16, float, and
two timestamp columns).

This file exists because 122-RESEARCH.md answered the five deciding questions from DOCUMENTATION
only and marked itself MEDIUM confidence. These are the real bodies. Where they disagree with
RESEARCH.md, **these win**.

Precedent: Phase 18 (`wkbSpike`) and Phase 37 (`cbTrackSpike`) both gated a wave on real spike
output. RETROSPECTIVE.md lesson #1: *"spike output that's only 'no error' is a trap."*

---

## Q1 — Where does character width live? **`properties`. CONFIRMED.**

```
"vendor_id":          ["data", "char4"]
"payment_type":       ["data", "char16"]
"store_and_fwd_flag": ["data", "char1"]
```

Three different widths on one table, each a distinct `properties` marker. A `varchar(8) → varchar(32)`
change surfaces as `char8` → `char32` **in `properties`, never in `type_schemas`** — the Avro base
type for all three is plain `"string"`.

**The documentary claim was right.** Kinetica has no `VARCHAR(N)`; width is a fixed enum of markers.

## Q2 — Where do numeric base types live? **`type_schemas`. CONFIRMED.**

```
{"name":"passenger_count","type":"int"}
{"name":"trip_distance","type":"float"}
{"name":"pickup_datetime","type":"long"}
{"name":"vendor_id","type":"string"}
```

`int → double` is a base-type change, visible directly in `type_schemas`.

Integer *width* is a separate axis, refining the base type in `properties`:
`cab_type` and `passenger_count` carry `int8`, `rate_code_id` carries `int16` — all with base
`"type":"int"`.

**So a complete fingerprint needs BOTH sources.** Neither alone is sufficient:
`type_schemas` misses char width and int width; `properties` misses the base type.

## Q3 — Is there a stable per-column identifier? **NO. Confirmed, decision holds.**

The response carries `type_ids: ["3030029304301109627"]` — that is one id **per table type**, not per
column. `type_schemas` fields are name-keyed Avro records and `properties` is a name-keyed map.
Nothing survives a rename.

**The locked never-guess-renames decision stands, now on evidence rather than inference.**

## Q4 — Does `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE` carry length? **NO — and it is actively misleading.**

This is the finding that most changes the picture. Real `DATA_TYPE` values for the same columns:

| Column | `/show/table` properties | `INFORMATION_SCHEMA.DATA_TYPE` |
|---|---|---|
| `store_and_fwd_flag` | `char1` | **`character(256)`** |
| `vendor_id` | `char4` | **`character(256)`** |
| `payment_type` | `char16` | **`character(256)`** |
| `passenger_count` | `int8` | `tinyint` |
| `rate_code_id` | `int16` | `smallint` |
| `trip_distance` | (base `float`) | `real` |
| `pickup_datetime` | `timestamp` | `bigint` |

**Every char column — widths 1, 4 and 16 — reports as `character(256)`.** `DATA_TYPE` is not merely
lossy about width; it reports a uniform logical maximum that is wrong for all three.

Two consequences:
1. `varchar(8) → varchar(32)` is **completely invisible** through `INFORMATION_SCHEMA`. The operator's
   requirement is unachievable without `/show/table`. The full-precision decision is vindicated.
2. **Every snapshot already stored is wrong about char width**, recording `character(256)` for a
   `char4` column. This is stronger than "the old format is lossy" — it would produce a *false*
   retype on first comparison. The locked "first check establishes a baseline, does not diff types"
   decision is not merely prudent, it is required for correctness.

Integer width does partially survive (`tinyint`/`smallint`), and `timestamp → bigint` reconfirms
exactly the flattening `lib/showTableTypes.ts` was written to undo.

## Q5 — Table-not-found signature? **Solved, and it resolves the error collision.**

Three probes, three distinct real responses:

**Default options** — HTTP **400**, `status: "ERROR"`:
```json
{"status":"ERROR","message":"No matching table or schema was found: demo.__schema_spike_missing_table__"}
```
This is the body `kinetica.ts:320-327` maps to `KineticaUpstreamError` — the **same exception type**
as a genuine connection failure at `:347`. This is the collision confirmed by code reading before
the spike ran, and it is why the default call cannot satisfy SSYNC-V125-03.

**With `no_error_if_not_exists: true`** — HTTP **200**, `status: "OK"`:
```json
{"table_name":"demo.__schema_spike_missing_table__","table_names":[],"type_schemas":[],
 "properties":[],"info":{"WARNING_0":"Could not find the table: '…' (TM/SMc:1046)"}}
```
Clean, unambiguous, and **structurally distinct from any failure**: a successful call with an empty
`table_names` array. A connection failure cannot produce this.

**`INFORMATION_SCHEMA` for a missing table** — HTTP 200, zero rows, no error. A true catalog view.
An independent corroborating signal.

**Both candidate resolutions work.** `no_error_if_not_exists: true` is the cleaner primary signal
(one call, explicit empty `table_names`); the zero-row `INFORMATION_SCHEMA` result corroborates it.
The planner should pick deliberately and state which is authoritative.

---

## Unplanned finding — nullability is already available

The spike's `INFORMATION_SCHEMA` query returned four columns, not two:

```
column_headers: ["COLUMN_NAME","DATA_TYPE","ORDINAL_POSITION","IS_NULLABLE"]
```

`IS_NULLABLE` came back populated (all `0` on this table). `SSYNC-F5` was deferred on the grounds
that nullability "is not currently observable without new discovery work" — **that premise is wrong**;
it is one column in a query the app already runs. Still deferred (out of scope for v1.25), but the
stated reason should be corrected to "not consumed by the app today" rather than "unobservable".

`ORDINAL_POSITION` is likewise available. **This does NOT enable rename detection** — an ordinal is
positional, not an identity, and pairing on it is precisely the heuristic the milestone forbids.
Recorded so nobody rediscovers it and mistakes it for a rename signal.

---

## What this means for planning

1. The fingerprint must combine `type_schemas` (base type) **and** `properties` (char/int width,
   temporal marker). Neither source alone is sufficient — proven, not assumed.
2. `INFORMATION_SCHEMA.DATA_TYPE` is unusable for width and must not be the fingerprint's basis.
3. `/show/table` with `no_error_if_not_exists: true` gives a clean table-missing signal that a
   connection failure cannot imitate — this is the mechanism for the three-outcome decision.
4. Existing snapshots store `character(256)` where reality is `char4`. Baseline-before-diff is
   required for correctness, not just tidiness.
5. No per-column identity exists. Renames stay drop + add.

---

## Addendum — VIEW probe (2026-09-21, run after the plan checker flagged it as an open risk)

The first spike probed only `demo.nyctaxi`, a BASE TABLE. The plan checker correctly flagged that
`GET /api/kinetica/schemas/:schema/tables` queries `INFORMATION_SCHEMA.TABLES` with **no
`TABLE_TYPE` filter**, so an operator can register a Kinetica VIEW as a "table" — and if
`/show/table` returned nothing usable for a view, single-sourcing on it would break for those
registrations. Probed directly against the live instance.

**This instance holds 17 `BASE TABLE` and 33 `VIEW` entries** — views are not an edge case here.

### `/show/table` on a VIEW works identically — risk CLOSED

`pg_catalog.pg_views`, with `no_error_if_not_exists: "true"`:

```
HTTP 200  status=OK
table_names:        ["pg_catalog.pg_views"]
type_schemas:       present, 4 fields
properties:         4 keys
```

Same shape as a base table. Nothing special is needed for views, and the single-source-on-
`/show/table` decision holds for every registerable entity.

### Two findings the base-table fixture could NOT have surfaced

**1. Nullable columns carry a `"nullable"` property marker.**

```json
["schemaname", ["data", "char256", "nullable"]]
["definition", ["data", "nullable"]]
```

`demo.nyctaxi` has no nullable columns, so this marker never appeared in the original spike. The
plan's `NON_TYPE_PROPERTIES` exclusion list already contains `nullable` — deliberately, so that
`SSYNC-F5` (nullability detection) does not ship by accident as a side effect of fingerprinting.
**That exclusion is now known to be load-bearing rather than theoretical**: without it, making a
column nullable would report as a type change in v1.25, which is out of scope and was never
specified.

**2. Nullable columns use Avro UNION types, not plain strings.**

```json
{"name":"schemaname","type":["string","null"]}
```

Every column on `demo.nyctaxi` had a plain scalar `"type":"string"`. The union form appears only
when a column is nullable — so the plan's rule that `base` is "the Avro type with `"null"` filtered
out of unions" was, until this probe, **untested against any real body carrying a union**. It is
now confirmed to be required rather than defensive: a fingerprint that did not filter unions would
render `["string","null"]` as the base type and report a spurious change the moment a column's
nullability differed between two reads.

**Use `pg_catalog.pg_views` as the union/nullable test fixture** — it is a real body, it exercises
both the union form and the `nullable` marker, and it is present on any Kinetica instance.
