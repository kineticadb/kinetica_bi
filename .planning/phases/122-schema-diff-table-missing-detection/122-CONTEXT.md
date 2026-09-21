# Phase 122: Schema Diff & Table-Missing Detection - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

For ONE registered table, read the live Kinetica column set on demand and report exactly how it
differs from the stored snapshot — added, removed, retyped, or the table gone entirely — **without
writing anything**.

Out of this phase: the impact report on widgets/layers/metrics (Phase 124), applying the refreshed
snapshot and sync history (Phase 125), and the Datasets UI (Phase 126). This phase is the detection
engine and its contract.

</domain>

<decisions>
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Live Kinetica discovery — reuse this, do not build a second path
- `packages/server/src/index.ts:2583-2619` — the ONLY route reading live Kinetica column metadata
  (`INFORMATION_SCHEMA.COLUMNS` + `/show/table` temporal enrichment). Phase 122 success criterion 5
  forbids a second discovery path
- `packages/server/src/lib/showTableTypes.ts` — the temporal-property parser, and the documented
  reason it exists (TIMESTAMP stored as base `long`/`bigint`). Its header explains what
  `/show/table` carries
- `packages/server/src/kinetica.ts:263-330` — `kineticaShowTable`, and the typed errors it throws
  (`KineticaAuthError` / `KineticaPermissionError` / `KineticaUpstreamError`) — these underpin the
  three-outcome decision

### Schema storage
- `packages/server/src/db.ts:23-31` — the `tables` DDL; `columns` is a single TEXT column
- `packages/server/src/types.ts:13-21` — `Table.columns: Record<string, string>`, the current lossy
  shape: no nullable, no ordinal, no synced-at
- `packages/server/src/db.ts:560-568` (`mapTable`), `:600-604` (`createTable`), `:606-621`
  (`updateTable`, partial-safe)

### Prior art — the closest existing "re-read columns and re-store" contract
- `packages/server/src/db.ts:118-131` and `:907-922` — dynamic views rewrite `columns_json` on every
  successful Preview and clear it when `template_sql` changes. The model to copy

### Type semantics — what a retype actually breaks (Phase 124 consumes this; 122 must not discard it)
- `packages/web/src/lib/columnTypes.ts` — `normalizeType` (:67-69, strips `(N)`),
  `inferDataTypeFromColumn` (:85), `NUMERIC_TYPES` (:42-46), `INTEGER_TYPES` (:51-55),
  `DATETIME_TYPES` / `BOOLEAN_TYPES` (:64-65)

### Milestone scope and hazards
- `.planning/PROJECT.md` § "Current Milestone: v1.25 Schema Sync" — five locked scope decisions and
  the known-hazards list
- `.planning/REQUIREMENTS.md` — SSYNC-V125-02/-03/-04/-05 are this phase's requirements
- `.planning/ROADMAP.md` § "Phase 122" — the five success criteria

### Project conventions
- `./CLAUDE.md` — § "Writing verifiable acceptance criteria" (run every grep criterion BEFORE
  committing to it) and § "Test gates". Server tests are SET-BASED: use
  `cd packages/server && node scripts/test-gate.mjs`, never a raw `npx vitest run`, and never assert
  a fixed server pass-count

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kineticaShowTable` + `parseTemporalColumns` — already the authoritative live-metadata readers.
  The precise fingerprint should extend this path rather than open a new one
- The typed Kinetica error family already distinguishes auth / permission / upstream failures, which
  maps cleanly onto the "could not reach Kinetica" outcome
- `updateTable` is partial-safe (`attrs.columns ?? existing.columns`), so a snapshot-shape change
  does not force every caller to pass columns

### Established Patterns
- Pure libs under `packages/server/src/lib/` compute; routes stay thin (`dashboardExport.ts`,
  `dashboardImport.ts`, `whereClause.ts`). A `lib/` diff module is the idiomatic shape here
- Best-effort enrichment with silent fallback is an existing pattern — and this phase deliberately
  REJECTS it for the diff path, because silence here produces confidently wrong findings

### Integration Points
- The discovery route is currently called by exactly one non-test web caller, the New Dataset form
  (`packages/web/src/components/DatasetsPage.tsx:395`). Registration is where new-format fingerprints
  will first be captured
- `dashboardImport.ts:337-339` deliberately never overwrites `columns` on a matched existing table —
  imported dashboards must not silently change a table's snapshot. A schema-sync feature must respect
  the same boundary

</code_context>

<specifics>
## Specific Ideas

- Operator, verbatim: *"best thing to do is compare the table ddl for the original to the new one.
  types can be int to double or even varchar8 to varchar32"* — the intent is **precise** type
  comparison, not classification-level. Kinetica exposes no DDL text to this app, so the
  implementation route is `/show/table`'s `type_schemas` + `properties`; the requirement it encodes
  is that both of those example changes are detected and reported exactly
- A connection failure must never be presentable as "your table was deleted"
- No similarity scoring, ordinal heuristics or "possible rename" hints — anywhere

</specifics>

<deferred>
## Deferred Ideas

- **Nullability detection** — `IS_NULLABLE` is never queried today, so a nullable change is
  unobservable without new discovery work. Already recorded as `SSYNC-F5`
- **Checking all registered tables at once** — `SSYNC-F3`; this phase is one table at a time
- **A server-side column-existence gate** — `SSYNC-F6`. `POST /api/filter/materialize` interpolates
  client-supplied column names straight into SQL without validating them against stored metadata
  (`whereClause.ts:14-20` documents a trust boundary `index.ts:1246-1270` does not enforce). Found
  while mapping this milestone; genuinely adjacent, deliberately not in this phase

</deferred>

---

*Phase: 122-schema-diff-table-missing-detection*
*Context gathered: 2026-09-21*
