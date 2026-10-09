---
phase: 125-apply-sync-history
plan: 03
subsystem: server-lib
tags: [schema-sync, apply, transaction, sync-history, atomicity, criterion-2]
requires:
  - packages/server/src/db.ts setTableSchemaSnapshot + insertTableSyncHistoryEntry (Plan 125-01)
  - packages/server/src/lib/schemaApply.ts isStaleAgainst + renderColumnsMap (Plan 125-02)
  - packages/server/src/lib/schemaDiff.ts diffResult (Phase 122)
  - packages/server/src/lib/schemaImpact.ts buildImpactReport (Phase 124)
  - packages/server/src/lib/schemaFingerprint.ts parse/serializeFingerprintSnapshot (Phase 122)
provides:
  - SchemaApplyResult (the four outcomes)
  - applySchemaSync (THE write path — one db.transaction)
  - SCHEMA_APPLY_BASELINE_MESSAGE / _NO_CHANGES_MESSAGE / _TABLE_MISSING_MESSAGE / schemaApplyDiffMessage
affects:
  - packages/server/src/lib/schemaApply.ts is no longer a pure module (values-imports db)
tech-stack:
  added: []
  patterns:
    - applyDashboardImport's single-db.transaction atomicity, proven by RAISE(ABORT) triggers
    - full-ROW config-table snapshot (upgrades past dashboardImport's count-based countRows)
    - SQLite total_changes() as a content-independent row-write budget
key-files:
  created:
    - packages/server/tests/lib.schemaApply.transaction.spec.ts
  modified:
    - packages/server/src/lib/schemaApply.ts
decisions:
  - "table_missing is checked FIRST because insertTableSyncHistoryEntry THROWS on an unknown tableId"
  - "staleness is checked before anything is computed, so a stale apply provably writes zero rows rather than relying on a rollback"
  - "the ImpactReport is rebuilt server-side from the re-read live map, never accepted from the client"
  - "SSYNC-V125-15 is enforced by the SHAPE of the input type and the result union — there is no refusal branch to disable"
  - "criterion 2 is proven by full rows PLUS a total_changes() budget, because row content alone cannot see a value-identical write, and no trigger bumps updated_at so a no-op UPDATE leaves every column byte-identical"
metrics:
  tasks: 2
  tests_added: 12
  probes: 11
  duration: ~65m
  completed: 2026-09-25
---

# Phase 125 Plan 03: applySchemaSync — The Write, In One Transaction Summary

`applySchemaSync` — v1.25's only write path — replaces the stored snapshot and appends the
history entry inside one `db.transaction`, plus the proof that it touches the `tables` row and
nothing else. That proof is the point of this plan, and getting it to actually discriminate took
two strengthenings after probe P10 failed to fire.

## What shipped

| Task | What | Commits |
| ---- | ---- | ------- |
| 1 | `SchemaApplyResult`, the four operator-facing messages, `applySchemaSync` | `209a910` (RED), `9245085` (GREEN) |
| 2 | `ONLYTABLES-` non-vacuous full-row snapshot + `ROLLBACK-` atomicity proofs | `743da25` |
| — | Test strengthening after probe P10 did not fire | `305c45d` |

12 tests in `packages/server/tests/lib.schemaApply.transaction.spec.ts`, all green:
4 `ONLYTABLES-`, 2 `BASELINE-`, 2 `ROLLBACK-`, 1 each of `DIFF-`, `NOOP-`, `STALE-`, `MISSING-`.
All fixtures synthetic (`demo_schema.demo_table`, `col_a`, `col_b`, `col_ts`, `col_gone`,
`demo_operator`); no dataset-specific name appears on any added line.

## Verbatim Declarations

**Phase 126 renders all four message constants VERBATIM and is planned against this text.**
Reproduced exactly as shipped in `packages/server/src/lib/schemaApply.ts`.

### The result contract

```ts
export type SchemaApplyResult =
  | {
      outcome: "applied";
      kind: "baseline" | "diff";
      table: string;
      tableId: number;
      recorded: true;
      historyId: number;
      /** How many older entries this apply pushed out of the 20-entry cap. */
      droppedThisApply: number;
      /** The map written to tables.columns, echoed so the caller need not re-read. */
      columns: Record<string, string>;
      changeset: SyncChangeset | null;
      message: string;
    }
  | { outcome: "no_changes"; table: string; tableId: number; message: string }
  | { outcome: "stale"; table: string; tableId: number; message: string }
  | { outcome: "table_missing"; table: string; tableId: number; message: string };
```

### The signature

```ts
export function applySchemaSync(input: {
  tableId: number;
  /** Schema-qualified name, as the check reports it. */
  table: string;
  /** Freshly re-read from Kinetica by the caller. */
  live: ColumnFingerprintMap;
  /** The map the operator's report was built from, echoed back by the client. */
  reportedLive: ColumnFingerprintMap;
  /** Username, matching rbac_audit's actor precedent. */
  actor: string;
}): SchemaApplyResult {
```

### The operator-facing messages

```ts
export const SCHEMA_APPLY_BASELINE_MESSAGE =
  "Baseline established. This table's snapshot predated precise type capture, so there was " +
  "nothing to compare against -- the live column set is now stored exactly, and the next " +
  "check can report type changes.";

export const SCHEMA_APPLY_NO_CHANGES_MESSAGE =
  "Nothing to apply -- the stored snapshot already matches Kinetica. No history entry was " +
  "recorded, because nothing changed.";

export const SCHEMA_APPLY_TABLE_MISSING_MESSAGE =
  "That registered table no longer exists in this app, so there is nothing to apply to.";

export const schemaApplyDiffMessage = (c: SyncChangeset): string =>
  `Applied. The stored snapshot now matches Kinetica: ${c.added.length} added, ` +
  `${c.removed.length} removed, ${c.retyped.length} retyped. The changeset and the impact ` +
  `report as it stood are kept in this table's sync history.`;
```

`SCHEMA_APPLY_STALE_MESSAGE` is unchanged from Plan 125-02 and is returned verbatim as the
`stale` arm's `message`.

## Non-vacuity evidence

The row counts the fixture actually seeds, asserted by `ONLYTABLES-seeded` and re-checked by
`expectNonVacuous(before)` before every `toEqual`:

| Table | Rows seeded | Asserted where |
|---|---|---|
| `widgets` | **1** (config references `col_gone`, the removed column) | `ONLYTABLES-seeded` `toHaveLength(1)` + `expectNonVacuous` |
| `dashboard_layers` | **1** (bound to the table under test) | same |
| `custom_metrics` | **1** (`SUM(col_a)` on the table under test) | same |
| `column_display_config` | **1** (on `col_gone`) | same |

`expectNonVacuous` occurs **6** times (the definition, four `ONLYTABLES-` calls, and
`ONLYTABLES-seeded`'s own). `ONLYTABLES-seeded` additionally names each table with an explicit
`toHaveLength(1)`, so a helper that silently stopped checking one table is still caught.

The impact report is non-vacuous too: `DIFF-report-describes-write` asserts the `col_gone`
section has `records.length > 0`, i.e. the seeded widget genuinely shows up as an affected
record rather than the report being three empty sections.

## Mutation probes — 11/11 FIRED (10 planned + 1 bonus)

Each probe was applied to the COMMITTED source, `tests/lib.schemaApply.transaction.spec.ts`
re-run, then reverted with `git checkout --` and `git diff --exit-code --
packages/server/src/lib/schemaApply.ts` confirmed clean after every single one.

| # | Mutation | Must redden | Outcome |
|---|----------|-------------|---------|
| P1 | remove the `db.transaction(...)` wrapper, call the body directly | `ROLLBACK-history` | **FIRED** (exactly 1 failed) |
| P2 | move the `isStaleAgainst` check to after the write | `STALE-refuses` | **FIRED** (exactly 1) |
| P3 | delete the `!diff.hasChanges` early return | `NOOP-nothing` | **FIRED** (exactly 1) |
| P4 | baseline passes an empty changeset instead of `null` | `BASELINE-recorded` | **FIRED** (exactly 1) |
| P5 | skip `insertTableSyncHistoryEntry` when `removed` is non-empty | `BASELINE-then-diff` or `DIFF-report-describes-write` | **FIRED** — both, +4 |
| P6 | early `return stale` when `changeset.removed.length > 0` | `ONLYTABLES-breaking` | **FIRED** — +5 |
| P7 | `renderColumnsMap` → `Object.fromEntries(... v.base)` | an `ONLYTABLES-`/`RENDER-` assertion on the written map | **FIRED** — `ONLYTABLES-diff` (exactly 1) |
| P8 | write `tables.columns` but pass `""` for the fingerprint | `BASELINE-then-diff` | **FIRED** — +4 |
| P9 | build the report from `diffResult(table, live, stored)` | `DIFF-report-describes-write` | **FIRED** — + `ONLYTABLES-breaking` |
| P10 | stray `UPDATE widgets SET updated_at = datetime('now')` in the transaction | `ONLYTABLES-diff` | **FIRED after strengthening** — see below |
| P10b (bonus) | stray `UPDATE dashboard_layers SET position = position` — a VALUE-IDENTICAL write no content comparison can see | anything | **FIRED** — `ONLYTABLES-diff` / `-baseline` / `-breaking` |

P7's target existed because the plan pre-authorised it: `ONLYTABLES-diff` asserts the written
map's temporal column reads `"timestamp"` (and `col_b` reads `"string(char16)"`), written up
front in the Task-2 commit rather than retrofitted after the probe.

### P10 did NOT fire on the first sweep — what was wrong and what was strengthened

**No probe was weakened or deleted.** Commit `305c45d`.

P10 plants `UPDATE widgets SET updated_at = datetime('now')` inside the apply transaction. On
the first sweep it reddened **nothing**: 12 passed, 0 failed.

The snapshot was NOT vacuous and was NOT count-based — it was faithfully comparing full rows.
The problem was that there was genuinely nothing different to see. `datetime('now')` has
**one-second resolution**, the fixture created the widget in that same second, so the stray
UPDATE wrote back a **byte-identical value**. A row comparison cannot detect a write that
stores the value already there.

Investigating that surfaced a second, worse hole, though NOT the one first recorded here.

CORRECTION (orchestrator, verified against source): the original text of this section claimed
`dashboard_layers` "carries no timestamp column at all". **That is false.** `dashboard_layers`
declares both `created_at` and `updated_at` at `packages/server/src/db.ts:124-125`.

The real mechanism is different and broader. `db.ts` defines **zero** `CREATE TRIGGER`
statements, so nothing auto-bumps `updated_at` on an UPDATE. A stray
`UPDATE dashboard_layers SET position = position` therefore leaves every column byte-identical,
and no content comparison of any kind can see it. The same is true of `widgets`: P10 was
invisible not because a column was missing but because `datetime('now')`'s one-second
resolution rewrote the value already there.

So the hole was real and the remedy below is correct and strictly stronger than what the plan
specified — but it generalises further than the original diagnosis suggested: content
comparison cannot prove "nothing else was written" for ANY table in this schema, because no
table has an update trigger.

Two strengthenings:

1. **`ageSeededRows()`** — after seeding, every row's `created_at`/`updated_at` in `tables`,
   `dashboards`, `widgets`, `custom_metrics` and `column_display_config` is pushed to a fixed
   past instant (`2020-01-01 00:00:00`) with raw SQL. Any `datetime('now')` rewrite is then a
   visible change. This is also the realistic case — nothing applies a schema sync in the same
   second a widget was created. It additionally makes `ONLYTABLES-diff`'s new
   `expect(afterTablesRow.updated_at).not.toBe(AGED_TS)` assertion a real comparison instead of
   one the same one-second resolution would have made vacuous.

2. **`expectRowWriteBudget(expected, fn)`** — asserts the delta in SQLite's own
   `total_changes()`, which counts rows modified on the connection regardless of whether the
   value written differs. Measured budgets, not guessed: **2** for a successful apply (one
   `tables` UPDATE + one `table_sync_history` INSERT; the cap sweep's DELETE matches nothing
   below 20 entries and the meta upsert only runs when something was dropped) and **0** for a
   no-op or a stale refusal. Wired into `ONLYTABLES-diff`, `ONLYTABLES-baseline`,
   `ONLYTABLES-breaking`, `NOOP-nothing` and `STALE-refuses`.

After strengthening, **P10 reddens `ONLYTABLES-diff`** (plus `-baseline` and `-breaking`).
Bonus probe **P10b** — a value-identical write to `dashboard_layers` —
reddens the same three, which neither the row snapshot nor the timestamp ageing could ever have
caught on its own. Criterion 2 is now proven against strictly more than the plan asked for.

## Acceptance criteria — all RUN, actual output recorded

Every "before" value was measured on the current tree before any code was written.

| Task | Criterion | Expected | Actual |
|---|---|---|---|
| 1.1 | `grep -cE "^export function applySchemaSync" src/lib/schemaApply.ts` | 1 | **1** (before: 0) |
| 1.2 | `grep -cE "^export type SchemaApplyResult =" src/lib/schemaApply.ts` | 1 | **1** (before: 0 files under `packages/`) |
| 1.3 | `grep -c "db.transaction(" src/lib/schemaApply.ts` | 1 | **1** (before: 0) |
| 1.4 | `grep -cE "^export const SCHEMA_APPLY_(BASELINE\|NO_CHANGES\|TABLE_MISSING)_MESSAGE"` | 3 | **3** (before: 0) |
| 1.5 | `grep -c "buildImpactReport" src/lib/schemaApply.ts` | ≥1 | **2** (before: 0) |
| 1.6 | NO-FORCE, added non-comment lines, from repo root | 0 | **0** — and proven live, see below |
| 1.7 | no write to widgets/layers/metrics/cdc in this module | no matches | **no matches** |
| 1.8 | `npx tsc --noEmit` | clean | **clean** |
| 1.9 | `git diff --name-only 688ff43 \| grep -c '^packages/web/'` | 0 | **0** |
| 2.1 | `it("ONLYTABLES-` / `ROLLBACK-` / `BASELINE-` / `NOOP-` | ≥4 / ≥2 / ≥2 / ≥1 | **4 / 2 / 2 / 1**, 12/12 green (before: all four prefixes 0 across `tests/`) |
| 2.2 | `grep -c "expectNonVacuous"` | ≥5 | **6** (before: 0 under `packages/`) |
| 2.3 | full-ROW snapshot of all four tables | ≥1 each | **1 / 1 / 1 / 1** (before: 0 across `tests/`) |
| 2.4 | `kbi_test_abort_sync` here ≥3, in dashboardImport spec = 0 | ≥3 / 0 | **4 / 0** (before: 0 under `packages/`) |
| 2.5 | `grep -c "finally"` | ≥1 | **3** |
| 2.6 | `grep -c "COUNT(\*) c FROM table_sync_history"` | ≥2 | **2** — weak criterion, see below |
| 2.7 | no fixed pass count | no matches | **no matches** |
| 2.8 | dataset hygiene, ADDED lines only | 0 | **0**, guard proven live (602 added lines; a planted name drives it 0 → 1) |
| 2.9 | `npx tsc --noEmit` + `node scripts/test-gate.mjs` | clean + GATE PASSED | **clean + GATE PASSED** |
| 2.10 | gate re-run produces "the same result set" | — | **unsatisfiable as written — see below**; the real requirement was verified directly |

### Criteria that could not discriminate, or whose stated premise was wrong

**Criterion 2.10 is UNSATISFIABLE as written.** It demands that re-running
`node scripts/test-gate.mjs` "produce the same result set". The gate is SET-BASED precisely
*because* the extra, non-`KNOWN_FAILING` set rotates between runs — that is the documented
`TD-V16-TEST-ISOLATION` behaviour the gate exists to absorb. Three runs were made and the extra
set was different each time: run 1 flagged `routes.dashboard-import.refs.spec.ts`, run 2 flagged
nothing extra, run 3 flagged `routes.management.spec.ts`. Each was re-run alone by the gate and
passed. A criterion demanding stability from the one thing the gate is built to tolerate cannot
hold.

Per CLAUDE.md, nothing was changed to accommodate it. The **real** requirement — the criterion's
own second sentence, "if `lib.dashboardImport.apply.spec.ts` reddens, a trigger leaked" — was
verified directly and is the thing that matters: across **all three** gate runs,
`lib.dashboardImport.apply.spec.ts` appeared in **no** failing set, and the 8-entry
`KNOWN_FAILING` set was byte-identical in all three. No trigger leaked. The correct form for a
future plan is "`lib.dashboardImport.apply.spec.ts` is absent from the failing set on two
consecutive runs", not "the result set is identical".

**Criterion 2.6 is weakly discriminating.** `grep -c "COUNT(\*) c FROM table_sync_history" ≥ 2`
counts SQL *literals*, not assertion sites. Factoring the query into a `historyCount()` helper —
which is the better way to write it — collapses the literal to ONE occurrence no matter how many
tests assert on it; the grep reads 2 here only because `MISSING-table` happens to carry its own
inline, table-unscoped variant. It cannot distinguish "two tests assert the history count" from
"one helper plus one unrelated query". The real requirement was verified directly:
`NOOP-nothing` and `STALE-refuses` each call `historyCount()` **three** times (capture, compare
to the captured value, and compare to a literal 0). Both also now carry
`expectRowWriteBudget(0, …)`, which is a strictly stronger statement than the history count.

**Criterion 1.6's stated premise is factually wrong, though the criterion itself is sound.** The
plan asserts that the word-boundary form "`\bforce\b` reads 0 file-wide too". Measured: it reads
**3** under `packages/server/src` — `rbac.ts:18` ("force callers to spread it") and
`spikes/cbTrackSpike.ts:626`/`:628` ("force-bad"). None is an override flag. The criterion as
*written* is diff-anchored to added non-comment lines and is correct and live: this plan's header
comment contains the phrase "no force flag" on line 254, so the comment-exclusion filter
(`grep -vE '^\+\s*(\*|//|--)'`) is genuinely load-bearing rather than decorative, and the guard
can still only fail by introducing the word in code.

**Criterion 1.1's stated "before" was stale.** The plan says `applySchemaSync` had 0 occurrences
anywhere under `packages/`; it actually had **2**, both in `schemaApply.ts`'s own header comment
where Plan 125-02 reserved its home. The criterion's *anchored* form
(`^export function applySchemaSync`) did read 0 before the work, so the criterion discriminates
correctly — only the prose was out of date.

**Criteria 1.7, 2.7 and 2.8** are 0-before/0-after prohibition guards, correctly scoped (to this
module, to this file, and to ADDED lines respectively). That is the intended shape. 2.8 was
proven capable of failing by planting a banned name into the diff stream: 0 → 1.

All other criteria read 0 (or failed) before the work and pass now.

## Deviations from Plan

**1. [Rule 2 - Missing critical coverage] The plan's snapshot technique could not prove criterion
2 for one of the four tables it names.**
- **Found during:** mutation probe P10, which did not fire.
- **Issue:** A full-row snapshot cannot see a write that stores the value already present. With
  `datetime('now')`'s one-second resolution that made P10 invisible; and because `db.ts`
  declares no update triggers at all, a value-identical UPDATE to any table is invisible to
  content comparison permanently, not just within the same second.
- **Fix:** `ageSeededRows()` plus `expectRowWriteBudget()` (SQLite `total_changes()`), described
  in full above. Both are additions; no assertion was removed or relaxed.
- **Commit:** `305c45d`

**2. [Rule 1 - Bug] `schemaApply.ts`'s module header still claimed the module was PURE.**
- **Found during:** Task 1, adding the `db` value-import.
- **Issue:** The header (shipped by 125-02) ends "PURE. No `db`, no `express`, no `fetch`." That
  became false the moment `applySchemaSync` landed, and a future reader would draw the wrong
  conclusion about what is safe to import from here.
- **Fix:** Replaced with a "PURITY, precisely" paragraph stating that everything above the
  Plan 125-03 banner is pure and independently testable, that `applySchemaSync` below it is not,
  and that the WRITE still lives in a lib so the route stays thin even though the lib is no
  longer pure. A banner comment marks the boundary in the source.
- **Commit:** `9245085`

**3. [Rule 2 - Missing coverage] Three tests beyond the plan's `<behavior>` list.**
- `MISSING-table` — the `table_missing` outcome. Task 1's `<behavior>` requires it but Task 2's
  test list omitted it, so it would have shipped with no named test.
- `ONLYTABLES-seeded` — named per-table `toHaveLength(1)` assertions on top of
  `expectNonVacuous`, so a helper that silently stopped checking one table is still caught.
- Probe **P10b** — a bonus probe (value-identical write to `dashboard_layers`, which no
  content comparison can see because `db.ts` declares no update triggers) run to confirm the
  new budget guard closes the hole P10 exposed, rather than only the narrower timestamp case.

## Verification

- `cd packages/server && npx tsc --noEmit` → **clean**
- `cd packages/server && npx vitest run tests/lib.schemaApply.transaction.spec.ts` → **12/12 passed**
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**, run THREE times.
  The 8-entry `KNOWN_FAILING` set was identical every run. Extra contamination differed per run
  (`routes.dashboard-import.refs.spec.ts` / none / `routes.management.spec.ts`), each re-run
  alone by the gate and passing — standard TD-V16-TEST-ISOLATION.
- **No trigger leak:** `lib.dashboardImport.apply.spec.ts` appeared in NO failing set across all
  three runs, and `grep -c kbi_test_abort_sync` in that file is **0** — the two spec files cannot
  collide on a trigger name under parallel scheduling.
- `git diff --name-only 688ff43 | grep -c '^packages/web/'` → **0**
- All 11 mutation probes fired on their named targets;
  `git diff --exit-code -- packages/server/src/lib/schemaApply.ts` clean after every one.
- No `gsd-tools` mutation command was run. `ROADMAP.md` and `REQUIREMENTS.md` were NOT touched —
  Plan 125-04 owns them.

## ROADMAP criteria status

| # | Criterion | Proven by |
|---|---|---|
| 1 | after applying, `getTable(id).columns` and `getTableColumnsFingerprint(id)` describe the live column set | `BASELINE-recorded`, `ONLYTABLES-diff` (asserts the exact written map AND `serializeFingerprintSnapshot(LIVE)`) |
| 2 | only the `tables` row changed | `ONLYTABLES-diff` / `-baseline` / `-breaking`: full-ROW snapshot of all four tables, each proven non-empty first, PLUS a `total_changes()` budget of exactly 2. Probes P10 and P10b both fire. |
| 3 | removals + retypes apply, no force, no findings-resolution gate | `ONLYTABLES-breaking`; probe P6 fires. There is no parameter to pass — `tsc` enforces the input type. |
| 4 | the history entry carries `ts`, `actor`, the changeset and the report | `BASELINE-recorded` (ts/actor/nulls), `BASELINE-then-diff`, `DIFF-report-describes-write` |
| — | baseline recorded, no-op not recorded | `BASELINE-recorded` / `NOOP-nothing`; probes P4 and P3 fire |
| — | a failure inside the transaction rolls the snapshot update back | `ROLLBACK-history` + the `ROLLBACK-clean` control; probe P1 fires |

## For the next wave (125-04 — routes)

1. **404 BEFORE calling `applySchemaSync` is NOT required** — the function returns
   `{ outcome: "table_missing" }` for an unknown id, having written nothing, because it calls
   `getTable` first. (`insertTableSyncHistoryEntry` would otherwise THROW `FOREIGN KEY constraint
   failed`.) Map that outcome to a 404.
2. **Suggested status mapping:** `applied` → 200; `no_changes` → 200 (it is not an error — the
   operator asked a reasonable question and got a truthful answer); `stale` → **409 Conflict**
   (optimistic-concurrency, the operator must re-run the check); `table_missing` → 404.
   Every arm carries a `message` meant to be rendered verbatim.
3. **The route must re-read Kinetica itself** and pass the result as `live`. `reportedLive` comes
   from the request body — the `live` map the check response already handed the client.
4. **The route must reject an EMPTY body map before calling this.** `isStaleAgainst({}, {})` is
   `false` and `renderColumnsMap({})` is `{}`; neither refuses, by design (125-02-SUMMARY.md #6).
   An empty `live` from a failed Kinetica read would otherwise wipe `tables.columns`.
5. **Gate the write route at least as strictly as the check route** — `datasets:manage` AND
   `dashboards:manage_access` (125-CONTEXT.md; the check route was widened in Phase 124).
6. **`actor` is the authenticated username**, matching `rbac_audit`'s precedent. There is no
   default and no fallback — the route must supply it.
7. **`droppedThisApply`** is how many entries THIS apply evicted from the 20-cap (0 or 1 in
   practice). Cumulative totals come from `listTableSyncHistory().droppedCount`, never from
   summing these. `cap` is echoed by `listTableSyncHistory` — the UI must not hardcode 20.
8. **`columns` is echoed on the `applied` arm** so the route need not re-read the table to tell
   the client what was written.
9. **`schemaApplyDiffMessage` is a FUNCTION**, not a constant — it takes the changeset. The other
   three are constants.
10. **Do not add a force/override parameter, ever.** SSYNC-V125-15 is enforced by the shape of
    the input type, and criterion 1.6 is a live diff-anchored guard against reintroducing one.

## Self-Check: PASSED

- `packages/server/src/lib/schemaApply.ts` — FOUND (modified)
- `packages/server/tests/lib.schemaApply.transaction.spec.ts` — FOUND (created)
- Commits `209a910`, `9245085`, `743da25`, `305c45d` — all FOUND in `git log`
