# Phase 122: Schema Diff & Table-Missing Detection - Research

> **SUPERSEDED IN PART — read `122-SPIKE-NOTES.md` first.**
>
> This document answered the five deciding questions from DOCUMENTATION only, at MEDIUM confidence,
> because the live spike could not run (credentials were absent from `.env`). The operator supplied
> credentials on 2026-09-21 and the spike was run against the deployed instance. **Real response
> bodies are in `122-SPIKE-NOTES.md`, and where the two disagree, the spike notes win.**
>
> Status of each documentary claim after live verification:
> - Q1 char width lives in `properties` (`char1`/`char4`/`char16`) — **CONFIRMED**
> - Q2 base types live in `type_schemas`; int width is a separate `properties` axis — **CONFIRMED**
> - Q3 no stable per-column identifier — **CONFIRMED** (`type_ids` is per table type, not per column)
> - Q4 `INFORMATION_SCHEMA.DATA_TYPE` carries no length — **CONFIRMED, AND WORSE THAN STATED**: every
>   char column reports `character(256)` regardless of real width (char1, char4 and char16 all alike),
>   so existing snapshots are actively wrong about width, not merely imprecise
> - Q5 table-not-found — **RESOLVED**: `no_error_if_not_exists: true` returns HTTP 200 / `status: OK`
>   with an empty `table_names`, structurally distinct from any connection failure
>
> One correction to this document's deferred-items reasoning: `IS_NULLABLE` and `ORDINAL_POSITION`
> are already returned by the `INFORMATION_SCHEMA` query the app runs, so `SSYNC-F5` is deferred
> because it is unused, not because it is unobservable.

**Researched:** 2026-09-21
**Domain:** Kinetica `/show/table` + `INFORMATION_SCHEMA.COLUMNS` response shape; server-side pure-lib diffing; SQLite snapshot storage
**Confidence:** MEDIUM (documentary, not live-verified — see "Live Verification Blocked" below, which is the most important thing in this document)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Type comparison — capture full precision, report every change

**Locked: store a richer per-column type fingerprint than today's flat `Record<name, string>`.**

The operator's requirement, in their words: *"types can be int to double or even varchar8 to
varchar32"* — **both must be detected**. Today's snapshot cannot support that:
- `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE` reports the base storage type only
- the app's `normalizeType` (`packages/web/src/lib/columnTypes.ts:67-69`) lowercases and **strips the
  `(N)` length suffix**, so a length change is invisible to every existing comparison

Kinetica exposes no `SHOW CREATE TABLE` DDL through anything this app uses, and nothing in the repo
retrieves DDL — the operator's "compare the DDL" instinct is right in spirit, and the available
equivalent is `/show/table`'s **`type_schemas` + `properties`**, which together carry the precise
per-column type. The app currently discards nearly all of it, keeping only `DATA_TYPE` plus a
temporal override.

Report every precise change. Do NOT normalize away differences before comparing.

Note for the planner, **not a decision to re-litigate**: `int → double` and `varchar(8) → varchar(32)`
do not change what `inferDataTypeFromColumn` returns, so they change nothing in the app's behaviour;
`int → varchar` does, because the filter UI, date bucketing and chart-axis eligibility all branch on
that classification. This phase reports the precise change. **Classifying severity is Phase 124's
job** (SSYNC-V125-12) — do not build severity into the diff here, but do not discard the information
124 will need to compute it.

### Degraded discovery — fail the check, never report a partial diff

**Locked: if `/show/table` fails, the check FAILS. It does not fall back and report a diff.**

The existing discovery route enriches temporal types best-effort with a **silent fallback**
(`packages/server/src/index.ts:2600-2612`): if `/show/table` is unavailable it returns pure
`INFORMATION_SCHEMA` results, where Kinetica TIMESTAMP columns appear as `bigint`. Carried into a
diff, that fallback would report **every temporal column as retyped `timestamp → bigint`** — a
confidently wrong finding produced by an intermittent upstream failure.

Precise types come from `/show/table`, so without it no type finding is trustworthy. Surface it as
the "could not reach Kinetica" outcome rather than a diff the operator might act on.

### Outcomes — three, distinctly

**Locked:**
1. **Changes found** — added / removed / retyped groups
2. **Table not found in Kinetica** — a distinct outcome, NOT a diff reporting every column removed.
   Wording must cover both a deleted table and one renamed in Kinetica; the two are indistinguishable
   from outside, and the app must not imply otherwise
3. **Could not reach Kinetica** — a failed check. Nothing recorded, nothing reported as a finding

A connection blip must never be presentable as "your table was deleted".

### Diff shape — groups plus per-column detail

**Locked:** `added[]` / `removed[]` / `retyped[]`, each entry carrying the column name, and retypes
carrying **both** the stored type and the live type. Unchanged columns are omitted.

This contract is consumed by Phase 124 (impact report) and persisted by Phase 125 (sync history), so
it is the most load-bearing artifact of this phase. Design it as the thing those phases read.

### Renames — one removal plus one addition, always

**Locked (milestone-level, restated here because this phase is where it would be violated):** a
renamed column reports as one removal and one addition. **No pairing, no similarity score, no
ordinal-position heuristic, no "probably renamed" hint anywhere in the response.** Kinetica exposes
no stable per-column identifier, so a rename is undecidable from metadata, and the app does not
invent facts. The operator works from the persisted changeset (Phase 125).

### Column name matching — case-sensitive, exact

**Locked:** `CustomerID` and `customerid` are different columns; a case change reports as one removal
plus one addition. Matches how the app already stores and looks up column names, and avoids
introducing a second class of app-detected "rename" that would sit awkwardly beside the locked
never-guess-renames decision.

### Old snapshots — first check establishes a baseline, it does not diff types

**Locked:** every snapshot already in the database was captured in the lossy format. On such a table
the check does NOT compare types — comparing an old lossy value against a new precise one would
report `varchar → varchar(32)` as a retype when nothing changed, manufacturing a false finding on the
very first run.

Instead the check reports that this table's baseline predates precise capture and needs establishing.
Type comparison begins from the next check.

**Resolved conflict — read this before planning.** "Establish a baseline" must NOT write during the
check: SSYNC-V125-05 and this phase's own success criterion 4 require that running a check leaves
`tables`, `widgets`, `dashboard_layers`, `custom_metrics` and `column_display_config` byte-identical.
The only reading consistent with both is that **the check reports the need and the operator's APPLY
does the write** (Phase 125 owns apply). Phase 122 writes nothing, ever, including baselines.

### Claude's Discretion
- The exact fingerprint representation (a structured object per column vs a canonical string), and
  how it is stored alongside or instead of today's `Record<name, string>` — provided it round-trips
  precisely and old-format snapshots remain distinguishable from new-format ones
- Route shape and naming for the check
- Whether the diff is computed server-side in a pure lib (strongly implied by this project's
  conventions) and that lib's file name
- How `type_schemas` and `properties` are combined into the fingerprint, and the parsing strategy
- Error-mapping specifics for the three outcomes, within the existing `errorMiddleware` conventions
- Whether `tables.columns` gains a sibling column or the existing one changes shape, and any
  migration mechanics

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- **Nullability detection** — `IS_NULLABLE` is never queried today, so a nullable change is
  unobservable without new discovery work. Already recorded as `SSYNC-F5`
- **Checking all registered tables at once** — `SSYNC-F3`; this phase is one table at a time
- **A server-side column-existence gate** — `SSYNC-F6`. `POST /api/filter/materialize` interpolates
  client-supplied column names straight into SQL without validating them against stored metadata
  (`whereClause.ts:14-20` documents a trust boundary `index.ts:1246-1270` does not enforce). Found
  while mapping this milestone; genuinely adjacent, deliberately not in this phase
</user_constraints>

## Live Verification Blocked — read this first

The task brief asserted Kinetica is live at `http://localhost:9191` and that credentials were in
`packages/server/.env`. Both halves of that were checked and the second is **wrong**:

- `KINETICA_URL=http://localhost:9191` is set and **is** reachable — confirmed with an
  unauthenticated probe (`POST /show/table` with no `Authorization` header returned HTTP 401
  `{"status":"ERROR","message":"Insufficient credentials",...}`, so the instance is up and
  enforcing auth).
- `KINETICA_USERNAME` and `KINETICA_PASSWORD` are **commented out and blank** in
  `packages/server/.env` (`# KINETICA_USERNAME=` / `# KINETICA_PASSWORD=`) — unlike the four
  existing spikes' fixture vars (`WKB_PROBE_*`, `CB_*`, `TRACK_*`), which ARE populated.
- This research session's sandbox denies any tool call the classifier reads as credential
  discovery/guessing against a live service (confirmed: even a bare unauthenticated `curl` to
  `/show/table` combined with a second attempt was denied once; a follow-up isolated call to an
  unrelated endpoint was allowed). Per the tool's own guidance on that denial, the correct move is
  to stop and hand the decision back rather than work around it — not to try alternate ways to
  obtain or guess the password.

**Net effect: every answer below to the five numbered questions is DOCUMENTARY (official Kinetica
docs + this repo's own existing code/tests), not confirmed against a real captured body from this
instance.** That is exactly the trap this project's own retrospective warns about ("spike output
that's only 'no error' is a trap") — so rather than assert these findings as HIGH confidence, they
are flagged MEDIUM/LOW below and gated behind a spike script.

**What was produced instead:** a committed, ready-to-run spike script,
`packages/server/src/spikes/schemaFingerprintSpike.ts` (registered as
`npm run schema-fingerprint-spike` in `packages/server/package.json`), built exactly to the house
pattern (`wkbSpike.ts`, `cbTrackSpike.ts`). It probes, against the three fixture tables named in
122-CONTEXT.md (`demo.nyctaxi`, `ki_home.us_states`, `demo.track`) plus a synthetic missing-table
name:
1. `/show/table` full body for a table with short/long text columns (answers Q1)
2. `/show/table` full body for a table with int/double/long columns (answers Q2, and Q3 by
   inspection — does anything id-shaped appear anywhere in the body)
3. `INFORMATION_SCHEMA.COLUMNS` for the same table (answers Q4)
4. `/show/table` for a nonexistent table with default options (answers Q5, half A)
5. `/show/table` for a nonexistent table with `{no_error_if_not_exists: true}` (answers Q5, half B)
6. `INFORMATION_SCHEMA.COLUMNS` for a nonexistent table (answers Q5, half C — see the load-bearing
   finding below)

It was run once in this session: it exits cleanly on the missing-credential guard with no network
call attempted (verified — see transcript), which is itself evidence that `.env` genuinely lacks
usable credentials right now, not a research shortcut.

**Recommendation to the planner: treat running this spike as Phase 122's Wave 0 P0 gate**, exactly
as Phase 18 (`wkbSpike.ts`) and Phase 37 (`cbTrackSpike.ts`) each gated their own Wave 1 on a spike
result — this phase's whole design (the type fingerprint AND the table-missing/unreachable split)
rests on the two open questions below, and the house convention is precisely "spike output drives
architecture, and the output must be the real body, not just HTTP 200." Add real `KINETICA_USERNAME`
/ `KINETICA_PASSWORD` to a local, uncommitted `.env` and run `npm run schema-fingerprint-spike`
before Wave 1 starts; paste the output into a `122-SPIKE-NOTES.md` per house convention.

## Summary

Kinetica has no arbitrary `VARCHAR(N)` — string length is one of a **fixed enum of properties**
(`char1`/`char2`/`char4`/`char8`/`char16`/`char32`/`char64`/`char128`/`char256`, or unbounded
`string` with none of these), documented separately from the column's **base type** (`int`, `long`,
`double`, `string`, ...). Kinetica's `/show/table` response therefore carries the full fingerprint
across TWO fields that must both be captured: `type_schemas` (an Avro record-schema string per
table — the base type per column) and `properties` (a map of column name → property-marker array
per table — the size/subtype refinements). This matches, and is corroborated by, code and tests
already in this repository (`lib/showTableTypes.ts`'s `properties` parsing, and
`tests/lib.showTableTypes.spec.ts`'s existing fixture, which already contains real-shaped markers
`["char4","data"]` and `["int8","data"]`).

**The single most load-bearing finding of this research is NOT about the fingerprint — it's about
outcome #2 vs #3.** Kinetica's own docs state `/show/table` **throws an error by default when the
table doesn't exist** (`no_error_if_not_exists` defaults to `false`). Cross-referenced against this
repo's own `kinetica.ts`, that error lands as `body.status === "ERROR"` → `KineticaUpstreamError` —
**the exact same typed error and HTTP status (502) already used for network failures, 5xx responses,
and malformed bodies.** Under the CURRENT code, calling `kineticaShowTable` for a table Kinetica has
genuinely lost is **indistinguishable by exception type** from "could not reach Kinetica" — the two
outcomes SSYNC-V125-03 exists specifically to keep apart. This must be resolved architecturally (see
"Outcome disambiguation" below), not discovered as a bug after the fact.

**Primary recommendation:** build a pure lib (`lib/schemaFingerprint.ts` for parsing,
`lib/schemaDiff.ts` for comparing) that both `type_schemas` and `properties` feed, tested entirely
with hand-written fixtures shaped like the real body (once the spike confirms the shape) — never a
live Kinetica call in tests, following the exact precedent already in this codebase
(`lib/showTableTypes.ts` / `tests/lib.showTableTypes.spec.ts`). Resolve table-missing detection by
querying `INFORMATION_SCHEMA.COLUMNS` FIRST (it is a catalog SELECT, and does not throw for a
nonexistent table under standard SQL catalog semantics — **this specific claim is UNCONFIRMED for
Kinetica and is Probe 6 in the spike script**) and only calling `/show/table` once existence is
confirmed, so that any actual thrown error from either call can be safely and uniformly reported as
"could not reach Kinetica."

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| SSYNC-V125-02 | Report added / removed / retyped columns, retypes carrying old+new type | `type_schemas` (base type: int/long/double/string) + `properties` (size/subtype: char8..256, int8/int16, timestamp/date/time/datetime) together form the fingerprint; combine via a pure `lib/schemaFingerprint.ts` parser modeled on the existing `parseTemporalColumns` |
| SSYNC-V125-03 | Table-not-found reported distinctly from a column diff, wording covers delete-or-rename | `/show/table` default behavior (`no_error_if_not_exists: false`) throws on a missing table — but that throw is CURRENTLY the same exception type as a connectivity failure; the outcome split requires checking `INFORMATION_SCHEMA.COLUMNS` (or `no_error_if_not_exists: true`) BEFORE trusting any `/show/table` exception as "unreachable" — see "Outcome disambiguation" |
| SSYNC-V125-04 | Renamed column = one removal + one addition, no pairing/guessing | No stable per-column identifier found in any documented `/show/table` field (`type_schemas` fields and `properties` keys are both NAME-keyed, not id-keyed) — corroborates, does not contradict, the CONTEXT.md locked assumption; spike Probe 1/2 is the definitive check (inspect the full real body for anything id-shaped) |
| SSYNC-V125-05 | Check changes nothing in the DB | No storage design proposed here writes; `lib/schemaDiff.ts` is a pure comparison function with no DB access, matching the "pure lib, thin route" house convention |

</phase_requirements>

## The Five Numbered Questions — Answers

### Q1: varchar(8) vs varchar(32) — what differs in the response?

**Kinetica has no `VARCHAR(N)` concept at all.** String columns have a base type (Avro `"string"`)
and an OPTIONAL size-refining property drawn from a **fixed enum**: `char1`, `char2`, `char4`,
`char8`, `char16`, `char32`, `char64`, `char128`, `char256` — each documented as "Text of up to N
characters; optimizes memory, disk, and query performance." A column with none of these properties
is unbounded text (Kinetica's docs describe the default `string` storage as "32 + length" bytes,
i.e. variable-length).

So the operator's "varchar(8) → varchar(32)" is really Kinetica's **`char8` property → `char32`
property**, and it shows up ONLY in the `properties` field, never in `type_schemas` (Avro has no
native fixed-length string primitive — the base type name stays `"string"` either way). Concretely,
per the documented property-list shape (a comma-separated / array-of-strings list per column) and
this repo's own existing fixture for the sibling temporal-parsing code
(`tests/lib.showTableTypes.spec.ts:10`, written by a prior phase against this exact response
family): `vendor_id: ["char4", "data"]`. A retype from 8 to 32 chars would be
`["char8","data"]` → `["char32","data"]` for the same column key.

**Confidence: MEDIUM.** Sourced from Kinetica's official 7.1 docs (`concepts/types`) plus this
repo's own pre-existing, already-tested fixture for the same response family — but NOT a body
captured from this specific instance. Spike Probe 1 confirms.

### Q2: int vs double vs long — what differs?

`INT`, `LONG`, and `DOUBLE` are documented as **base types**, not properties — they are the Avro
primitive type names Kinetica's `type_schemas` Avro record schema carries directly (Avro primitives
are lowercase: `int`, `long`, `double`, `string`, `bytes`, `boolean`, possibly wrapped in a nullable
union `["null","int"]`). By contrast, `int8`/`int16`/`boolean` are documented as **properties that
refine the `int` base type** — i.e. changing precision WITHIN int (e.g. `int` → `int16`) is a
`properties`-only change, exactly parallel to the char-size case above, while `int → double` is a
**base-type change**, visible directly in `type_schemas`' Avro `"type"` field for that column,
independent of `properties`.

**Confidence: MEDIUM-HIGH.** Directly stated by Kinetica's own docs distinction ("int8, int16,
boolean are properties refining the int base type"; Avro's spec independently confirms int/long/
double/string are separate primitive names) — but the exact literal Avro schema string for THIS
Kinetica version/instance was not captured live. Spike Probe 1/2 confirms the literal shape (e.g.
whether nullable columns wrap types in a union, which matters for the parser).

### Q3: any column attribute that would let a rename be detected as a rename?

No such field was found in any documented `/show/table` field. `type_schemas` fields are Avro
record fields, which are matched by **name** (Avro record fields carry `name` + `type`, no separate
persistent id); `properties` is described as "an array of maps with string keys mapping to arrays of
strings" — again name-keyed. Nothing in Kinetica's REST docs, nor in the Go/Java API source
consulted (`ShowTableResponse` struct: `TableNames []string`, `TypeSchemas []string`,
`Properties []map[string][]string`), carries a column id, GUID, or persistent ordinal.

**This does NOT contradict CONTEXT.md's locked assumption — it corroborates it.** No evidence of a
stable identifier was found anywhere. Flagging per the `<do_not>` instruction anyway, because this
is exactly the kind of claim that must be loud if wrong: **if the spike's real body reveals an
id-shaped field anywhere (Probe 1/2's full JSON dump), that is a milestone-level finding and must be
reported to the operator before Phase 122 planning proceeds** — it would not just adjust this phase,
it would reopen a decision locked at the milestone level (SSYNC-V125-04, and the "Out of Scope"
table's "Guessing that a removal + an addition is a rename" row).

**Confidence: MEDIUM** — an absence-of-evidence claim from documentation and API source, not from
inspecting an actual full body from this instance. Spike Probe 1/2 (dump the FULL decoded body, not
just the fields we expect) is the only way to raise this to HIGH confidence, and is exactly what the
script does (`console.log(... JSON.stringify(decodeDataStr(...), null, 2))` — the whole object).

### Q4: what does INFORMATION_SCHEMA.COLUMNS.DATA_TYPE return — does it include length?

**Architecturally, it cannot include a char-size length**, because char-size is documented as a
`properties`-level refinement, not part of the base type INFORMATION_SCHEMA is built to expose — and
this repository's OWN code already treats "INFORMATION_SCHEMA.COLUMNS.DATA_TYPE reports only the
base storage type" as an established, first-party fact
(`lib/showTableTypes.ts`'s header: "a TIMESTAMP column comes back as `bigint`" — the same
base/property split, already proven true for the temporal case by a prior phase, not merely
hypothesized here). By the same architecture, a `char32` string column's `DATA_TYPE` should report
Kinetica's bare base-type name for strings (documented as `"string"`) with no length suffix — this
extends the SAME already-proven pattern from temporal columns to string columns, but the literal
value ("string" vs some SQL-ish alias) was not independently confirmed live.

**Confidence: MEDIUM-HIGH** for "no length is included" (strong architectural inference + directly
analogous first-party precedent); **LOW** for the exact literal string Kinetica reports. Spike Probe
3 confirms the literal value.

### Q5: what does /show/table return for a table that does NOT exist?

**CONFIRMED via Kinetica's official 7.1 REST docs** (`/api/rest/show_table_rest/`): the endpoint
takes an option `no_error_if_not_exists`:
- **default `false`**: "will return an error if the provided input parameter `table_name` does not
  exist" — i.e. `status: "ERROR"` with a message, HTTP-wrapped per the standard envelope.
- **`true`**: "it will return an empty result" — i.e. no error, presumably empty `table_names` /
  `properties` arrays (exact shape not documented; spike Probe 5 confirms).

**Load-bearing consequence for this repo's code** (not from docs — from reading `kinetica.ts`
directly): `kineticaShowTable` (`kinetica.ts:320-328`) treats `!body || body.status === "ERROR"` as
`KineticaUpstreamError` — **the identical typed error and HTTP status (502) used for network
failures, 5xx responses, and any other malformed body.** Under the CURRENT call (`options: {}`, i.e.
`no_error_if_not_exists` left at its default `false`), asking `/show/table` about a table Kinetica
has genuinely lost throws `KineticaUpstreamError` — **exactly the same exception a real connectivity
blip would throw.** Phase 122's three-outcome design (SSYNC-V125-03's "table not found" vs the
locked "could not reach Kinetica" outcome) is NOT satisfiable by catching exceptions from an
unmodified `kineticaShowTable` call alone.

**Confidence: HIGH** for the documented `no_error_if_not_exists` behavior itself (official docs,
explicit and unambiguous). **HIGH** for the code-level collision claim (read directly from this
repo's `kinetica.ts` and `kineticaErrors.ts`, not inferred). See "Outcome disambiguation" below for
the two candidate resolutions — this is squarely Claude's Discretion territory per CONTEXT.md, but
the planner MUST pick one, because doing nothing silently reports every unreachable-Kinetica error as
"table missing" or vice versa, precisely the "confidently wrong finding" class of bug CONTEXT.md's
own "Degraded discovery" decision was written to prevent for the temporal-fallback case.

## Outcome Disambiguation — the actual design problem for SSYNC-V125-03

Two candidate resolutions, presented for the planner (this is discretion, not a re-litigated
decision — CONTEXT.md locks the THREE outcomes and their wording, not the mechanism):

**(a) Pass `{ no_error_if_not_exists: true }` on the `/show/table` call this feature makes.**
Then a missing table returns a clean, non-throwing, empty result — check `table_names`/`properties`
for emptiness to mean "table not found." Every actual thrown error (auth, permission, 5xx, network,
truly malformed body) still means "could not reach Kinetica," with zero ambiguity, because the one
case that used to collide (missing table) no longer throws at all. Cleanest fix, but changes the
options payload the phase's new call sends to `kineticaShowTable` — confirm this doesn't require a
`kineticaShowTable` signature change (it currently hardcodes `options: {}`; the existing signature
takes no per-call options argument, so this needs a small extension or a second thin wrapper).

**(b) Check `INFORMATION_SCHEMA.COLUMNS` first (the query the existing discovery route ALREADY
issues before ever calling `/show/table`), and treat zero returned rows as "table not found" —
never even calling `/show/table` for a table already confirmed absent.** This is architecturally
free (no new call shape, mirrors the existing route's own call order exactly) IF, and only if,
`INFORMATION_SCHEMA.COLUMNS` returns an empty result rather than throwing for a nonexistent table —
**this specific fact is UNCONFIRMED for Kinetica** (general ANSI SQL catalog-view convention says
yes; no Kinetica-specific documentation was found either way). Spike Probe 6 is the definitive check.

**Recommendation: verify (b) via the spike first** (it costs nothing extra — Probe 6 is already in
the script) **since it requires no change to `kineticaShowTable`'s call contract**; fall back to (a)
only if Probe 6 shows `INFORMATION_SCHEMA.COLUMNS` also throws (or otherwise misbehaves) for a
missing table.

**A fourth latent outcome worth naming, not necessarily building:** `KineticaPermissionError` (403)
is currently a DIFFERENT typed error from `KineticaUpstreamError` (502) — "Kinetica is reachable but
this credential can't read this table's schema" is a materially different, more actionable message
than "could not reach Kinetica" (which reads as transient/retry-later). CONTEXT.md's locked three
outcomes don't mention this case explicitly. Recommend collapsing it into the "could not reach
Kinetica" *outcome contract* (keeps the locked three-shape response), but preserving the distinct
error class/message through to whatever the route returns, so a future UI (Phase 126) could
word it differently without another backend change. This is a wording nuance, not scope creep.

## Standard Stack

No new npm dependency is implied by anything in this phase — the feature is composed entirely from
primitives already in this codebase: `kineticaSqlHelper` (INFORMATION_SCHEMA), `kineticaShowTable` +
`parseTemporalColumns` (temporal precedent to extend), and `better-sqlite3` (already the only DB
driver). Confirm no drift before planning:

```bash
cd packages/server && npm ls better-sqlite3 vitest
```

## Architecture Patterns

### Recommended module shape (pure lib + thin route, per this codebase's own convention)

```
packages/server/src/
├── lib/
│   ├── showTableTypes.ts        # EXISTING — temporal-only parser, do not modify
│   ├── schemaFingerprint.ts     # NEW — combine type_schemas + properties into a
│   │                            #   per-column fingerprint; sibling to showTableTypes.ts,
│   │                            #   cross-reference it in a header comment (same discipline
│   │                            #   CONTEXT.md mandates for columnRefs.ts / dashboardExportRefs.ts)
│   └── schemaDiff.ts            # NEW — pure fn: (storedFingerprint, liveFingerprint) ->
│                                #   { added[], removed[], retyped[] }; no I/O, no DB, no Kinetica
├── kinetica.ts                  # EXISTING — kineticaShowTable; may need an options param
│                                #   threaded through if resolution (a) above is chosen
└── index.ts                     # NEW route (sibling to the existing discovery route, see below)
```

### Pattern: extend the temporal-parser precedent, don't replace it

`lib/showTableTypes.ts` already proves the exact shape needed: read `properties[idx][colName]` as
`string[]`, match against known markers. `schemaFingerprint.ts` should follow the identical
structure (same `ShowTableResponse` type shape, same `table_names`-index-matching logic) but combine
BOTH `type_schemas` (parse the Avro JSON string, extract each field's `type`) AND `properties`
(reuse the existing index/lookup logic) into one fingerprint per column — e.g.
`{ baseType: string, properties: string[] }` or a canonical joined string; CONTEXT.md leaves the
exact representation to discretion, provided it "round-trips precisely" and old/new-format snapshots
stay distinguishable.

```typescript
// Source: modeled directly on the EXISTING packages/server/src/lib/showTableTypes.ts
// (parseTemporalColumns), which already solves the identical table_names[i] <-> properties[i]
// index-matching problem for a subset of what this fingerprint needs.
type ShowTableResponse = {
  table_names?: unknown;
  type_schemas?: unknown;   // array<string> — Avro record-schema JSON per table
  properties?: unknown;     // array<map<column_name, string[]>>
};
```

### Route shape — sibling route, NOT a retrofit of the existing discovery route

The existing route (`GET /api/kinetica/schemas/:schema/tables/:table/columns`,
`index.ts:2583-2617`) is called by the New Dataset form (`DatasetsPage.tsx:395`,
`fetchKineticaColumns`) and its contract is **best-effort with silent fallback** — exactly the
pattern Phase 122 must reject for the diff path. Retrofitting the existing route's fallback
behavior to "fail hard" would change registration UX for a caller that was never asked to change.
**Recommend a new, sibling route** (e.g. `POST /api/tables/:id/schema-check`) built on a
`lib/schemaDiff.ts` + `lib/schemaFingerprint.ts` pair that call the EXACT SAME two Kinetica
primitives (`kineticaSqlHelper` for INFORMATION_SCHEMA, `kineticaShowTable` for the fingerprint) —
this satisfies success criterion 5 ("no second query of Kinetica column metadata") because it is a
second ROUTE composing the same two calls, not a third way of asking Kinetica anything.

### Anti-Patterns to Avoid

- **Silent best-effort fallback on the diff path** — explicitly rejected by CONTEXT.md; the existing
  discovery route's `try { ... } catch { console.error(...) }` around `kineticaShowTable`
  (`index.ts:2602-2614`) is the pattern NOT to copy here. A failed `/show/table` on the diff path
  must abort the whole check, not silently narrow it.
- **Comparing a lossy old-format snapshot's type against a new precise fingerprint** — locked as a
  reportable "needs baseline" case, not a diff; requires an explicit format marker (see below), not
  a heuristic guess (e.g. "does this string contain a `(`" is fragile and CONTEXT.md doesn't ask for
  it — an explicit stored marker is cheaper and unambiguous).
- **Any pairing/similarity/ordinal heuristic for renames** — locked out entirely, at the milestone
  level, not just this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Detecting "this snapshot predates precise capture" | A heuristic that inspects the stored type string's shape | An explicit stored format-version marker (e.g. presence/absence of a new sibling column) | CONTEXT.md's own "Old snapshots" decision exists because a string-shape heuristic (`varchar` vs `varchar(32)`) would misfire on legitimate values; an explicit marker is unambiguous and free to check |
| Array/object diffing for added/removed/retyped | A generic deep-diff npm package | A small pure function over two `Record<string, Fingerprint>` objects (three `Object.keys` set operations) | The comparison is genuinely trivial (name-keyed maps, case-sensitive exact match, no nesting) — a generic diff library adds a dependency and an unfamiliar API for a problem that is ~15 lines of native `Set` operations |

**Key insight:** this phase's actual complexity is almost entirely in getting the FINGERPRINT right
(parsing two disjoint Kinetica response fields correctly) and getting the THREE-OUTCOME
classification right (the Q5 collision above) — the diff algorithm itself is intentionally simple by
locked decision (no pairing, no scoring, no heuristics), so there is nothing here worth a library.

## Common Pitfalls

### Pitfall 1: The Q5 collision (table-not-found reads as "could not reach Kinetica")
**What goes wrong:** An unmodified `kineticaShowTable` call throws `KineticaUpstreamError` for BOTH
a missing table and a real connectivity failure.
**Why it happens:** `/show/table` returns `status: "ERROR"` for a missing table by default, and
`kinetica.ts` maps ALL `status === "ERROR"` bodies to the same upstream-error class.
**How to avoid:** Resolve via (a) or (b) above BEFORE writing any diff logic — this is a Wave 0/1
design decision, not a detail to discover during testing.
**Warning signs:** A test that mocks `/show/table` to return a missing-table-shaped error body and
expects the "table not found" outcome, but gets "could not reach Kinetica" instead — this SHOULD be
one of the first tests written, precisely because it's the collision this research found.

### Pitfall 2: Silently diffing types against a lossy old snapshot
**What goes wrong:** Comparing today's lossy `Record<name,string>` (e.g. `"varchar"`, `"bigint"`)
against tomorrow's precise fingerprint (e.g. `"string"` + `["char32"]`, or `"long"` + `["timestamp"]`)
manufactures a retype finding for EVERY column on EVERY table's first check, because the strings
never matched to begin with.
**Why it happens:** Different capture pipelines (`INFORMATION_SCHEMA.DATA_TYPE` string vs the new
combined fingerprint) were never meant to be compared value-for-value.
**How to avoid:** Gate type comparison behind an explicit stored format marker; the "needs baseline"
outcome is not a fallback path, it's the FIRST-CLASS behavior for every currently-registered table.
**Warning signs:** Running the check against ANY table registered before this phase ships and
getting a wall of retyped columns instead of "baseline needed" is the signature of this bug.

### Pitfall 3: Treating `KineticaPermissionError` as generically as `KineticaUpstreamError`
**What goes wrong:** A user with valid Kinetica credentials but no read grant on a specific table's
metadata gets the same "could not reach Kinetica" wording as an actual network outage — actionable
information (this is a permissions problem, not a connectivity problem) is thrown away.
**Why it happens:** Both currently collapse under "any non-2xx that isn't 401" style handling.
**How to avoid:** Preserve the distinct error class through to whatever this route returns, even
while keeping the response CONTRACT to the locked three outcomes.
**Warning signs:** An operator reports "checking my table always fails" and the only diagnostic is a
generic message that gives no hint whether the fix is "wait and retry" or "ask for a grant."

## Code Examples

### The existing sibling parser this phase should extend the pattern of

```typescript
// Source: packages/server/src/lib/showTableTypes.ts (existing, verbatim) — the model to follow
// for schemaFingerprint.ts's table_names[i] <-> properties[i] index-matching logic.
export function parseTemporalColumns(
  body: unknown,
  tableName: string,
): Record<string, TemporalType> {
  const out: Record<string, TemporalType> = {};
  if (!body || typeof body !== "object") return out;
  const resp = body as ShowTableResponse;
  const props = resp.properties;
  if (!Array.isArray(props) || props.length === 0) return out;
  let idx = 0;
  if (Array.isArray(resp.table_names)) {
    const found = resp.table_names.findIndex((n) => n === tableName);
    if (found >= 0) idx = found;
  }
  const colProps = props[idx];
  if (!colProps || typeof colProps !== "object") return out;
  for (const [col, list] of Object.entries(colProps as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const lower = list.map((p) => String(p).toLowerCase());
    const match = TEMPORAL_PROPERTIES.find((t) => lower.includes(t));
    if (match) out[col] = match;
  }
  return out;
}
```

### The existing fixture already shaped like a real `properties` body

```typescript
// Source: packages/server/tests/lib.showTableTypes.spec.ts (existing, verbatim) — proof this
// exact response family (table_names[i] <-> properties[i], property arrays like ["char4","data"]
// and ["int8","data"]) is already trusted and tested in this codebase, ahead of this phase.
const nyctaxiShowTable = {
  table_names: ["demo.nyctaxi"],
  properties: [
    {
      vendor_id: ["char4", "data"],
      pickup_datetime: ["timestamp", "data"],
      passenger_count: ["int8", "data"],
      trip_distance: ["data"],
    },
  ],
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `tables.columns` flat `Record<name, DATA_TYPE-string>`, captured once at registration | A richer per-column fingerprint from `type_schemas` + `properties`, captured on every applied sync (Phase 125) | This phase defines the shape; Phase 125 wires the write | Enables precise retype detection (`int→double`, `char8→char32`) that the flat shape structurally cannot express |

No external ecosystem "state of the art" applies here — this is entirely internal-format evolution,
not a library/framework currency question.

## Open Questions

1. **Does `INFORMATION_SCHEMA.COLUMNS` throw or return zero rows for a nonexistent table, on this
   specific Kinetica version?**
   - What we know: standard ANSI SQL catalog-view convention says "zero rows, no error"; Kinetica's
     own `/show/table` explicitly documents an error-by-default for a missing table via a DIFFERENT
     mechanism (not a catalog SELECT).
   - What's unclear: whether Kinetica's SQL layer treats `INFORMATION_SCHEMA.COLUMNS` as a true
     catalog view (never throws) in every deployed version, or whether some configuration/version
     could make it error.
   - Recommendation: Spike Probe 6 (`INFO-SCHEMA-MISSING`) is the definitive check; this is the
     single fact the Q5 disambiguation design most depends on.

2. **Exact literal Avro type-schema string shape for THIS Kinetica version** (does it wrap nullable
   columns as `["null","int"]` unions? are geometry/WKT/WKB columns represented as `"bytes"` or a
   Kinetica-specific type name that the fingerprint parser must special-case?).
   - What we know: Avro spec + Kinetica's documented base-type list (int/long/double/string/bytes).
   - What's unclear: the literal wire format for nullable and geospatial columns specifically.
   - Recommendation: Spike Probe 1/2's full JSON dump answers this directly; until then, the
     `schemaFingerprint.ts` parser should be written defensively (tolerate unexpected `type` shapes
     rather than throwing) and revised once real output is captured.

3. **Whether `no_error_if_not_exists` is even honored by this Kinetica version/deployment** (docs
   describe it as a documented REST option, but this instance's exact server version was not
   determined in this session).
   - Recommendation: Spike Probe 4 vs Probe 5 side-by-side comparison confirms directly.

## Sources

### Primary (HIGH confidence)
- `packages/server/src/kinetica.ts:263-349` (`kineticaShowTable`) — read directly, not inferred; the
  Q5 collision claim comes from this file's actual error-classification logic.
- `packages/server/src/kineticaErrors.ts` — the three typed error classes and their fixed HTTP
  statuses, read directly.
- `packages/server/src/lib/showTableTypes.ts` and `packages/server/tests/lib.showTableTypes.spec.ts`
  — existing, already-tested code/fixtures for the exact response family this phase extends.
- `packages/server/src/index.ts:2583-2617` — the existing discovery route's call order and silent-
  fallback pattern, read directly.
- https://docs.kinetica.com/7.1/api/rest/show_table_rest/ — `no_error_if_not_exists` option
  semantics, `table_names`/`type_schemas`/`properties` field descriptions, response wrapper
  (`status`/`message`/`data_type`).

### Secondary (MEDIUM confidence)
- https://docs.kinetica.com/7.1/concepts/types/ — char1..char256 property enum, int8/int16/boolean
  as int-refining properties, base-type vs property distinction (WebFetch summary of the live page,
  not independently re-verified against a second source).
- https://github.com/kineticadb/kinetica-api-java `Type.java` and Go `ShowTableResponse` struct
  (found via WebSearch, described secondhand by the search summary, not fetched directly) —
  corroborates `type_schemas: string[]` (Avro) / `properties: map<string,string[]>[]` shape and the
  name-keyed (no id) structure.

### Tertiary (LOW confidence)
- The literal Avro schema string format for nullable/geospatial columns — pieced together from
  general Avro spec knowledge + a WebSearch summary describing a schema-string template
  (`{"type":"record","name":"{_label}","fields":[...]}`) from a secondary source, not confirmed
  against Kinetica's actual generated output.
- The exact literal value `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE` reports for `char32`/unbounded
  string columns — architecturally inferred, not observed.

## Metadata

**Confidence breakdown:**
- Fingerprint mechanics (Q1/Q2): MEDIUM — official docs + this repo's own precedent code/tests
  converge, but no live body from this instance was captured this session.
- Outcome disambiguation (Q5) collision claim: HIGH — read directly from this repo's own
  `kinetica.ts`/`kineticaErrors.ts`; the missing-table-throws-by-default fact: HIGH (explicit,
  unambiguous official docs); the chosen resolution mechanism: MEDIUM, pending spike Probe 6.
- Rename-undecidability (Q3): MEDIUM — absence-of-evidence from docs/API source, not from a full
  real-body inspection.
- Architecture/route-shape recommendations: MEDIUM-HIGH — grounded directly in this repo's existing
  conventions (pure-lib/thin-route, `lib/showTableTypes.ts` precedent), independent of the live-data
  gap above.

**Blocking gate for Wave 0/1:** run `cd packages/server && npm run schema-fingerprint-spike` with
real credentials in a local, uncommitted `.env`, and capture the output before finalizing the
fingerprint parser's exact field-handling and the outcome-disambiguation mechanism.

**Research date:** 2026-09-21
**Valid until:** Kinetica response-shape facts are stable across versions typically (30+ days); the
credential/environment gap is immediate and should be closed before Wave 0 starts, not later.
