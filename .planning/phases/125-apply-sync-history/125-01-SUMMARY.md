---
phase: 125-apply-sync-history
plan: 01
subsystem: server-storage
tags: [sqlite, sync-history, schema-snapshot, ddl, accessors]
requires:
  - packages/server/src/lib/schemaImpact.ts (ImpactReport, Phase 124)
  - packages/server/src/lib/schemaDiff.ts (SchemaDiff groups, Phase 122)
  - packages/server/src/db.ts getTableColumnsFingerprint (Phase 122 read-only accessor)
provides:
  - table_sync_history + table_sync_history_meta DDL
  - SYNC_HISTORY_CAP
  - setTableSchemaSnapshot (FIRST writer for tables.columns_fingerprint)
  - insertTableSyncHistoryEntry / listTableSyncHistory / getTableSyncHistoryEntry / deleteTableSyncHistoryEntry
  - SyncChangeset / TableSyncHistoryEntry / TableSyncHistory types
affects:
  - packages/server/src/db.ts deleteTable (explicit history cleanup)
tech-stack:
  added: []
  patterns: [rbac_audit append-log shape, CREATE TABLE IF NOT EXISTS for new tables, db.transaction for multi-statement atomicity]
key-files:
  created:
    - packages/server/tests/db.syncHistory.spec.ts
  modified:
    - packages/server/src/db.ts
decisions:
  - "Cap enforced DELETE-ON-INSERT inside one db.transaction; sweep orders by id DESC, never ts"
  - "The dropped fact lives in its own table_sync_history_meta table so a per-entry delete cannot erase it"
  - "dropped_count is cumulative and monotonic; a hand delete never decrements it"
  - "better-sqlite3 enables PRAGMA foreign_keys by DEFAULT — measured, contradicting the long-standing deleteDashboard comment"
metrics:
  tasks: 2
  tests_added: 18
  probes: 9
  duration: ~50m
  completed: 2026-09-25
---

# Phase 125 Plan 01: Sync-History Storage Layer Summary

Durable per-table sync history (two SQLite tables, a 20-entry cap enforced transactionally with
a visible drop count) plus `setTableSchemaSnapshot` — the tree's first writer for
`tables.columns` + `tables.columns_fingerprint`, which Phases 122-124 deliberately left absent.

## What shipped

| Task | What | Commits |
| ---- | ---- | ------- |
| 1 | `table_sync_history` + `table_sync_history_meta` DDL, `SYNC_HISTORY_CAP`, `setTableSchemaSnapshot`, `deleteTable` cleanup | `2a7531f` (RED), `9c067b3` (GREEN) |
| 2 | `SyncChangeset` / `TableSyncHistoryEntry` / `TableSyncHistory` + the four accessors | `4cd6855` (RED), `fe4e285` (GREEN) |
| — | Test strengthening after three probes failed to fire | `dfb4ec5` |

18 tests in `packages/server/tests/db.syncHistory.spec.ts`, all green. All fixtures synthetic
(`demo_table`, `other_table`, `demo_schema`, `col_a`, `col_b`); the `ImpactReport` fixture is built
by CALLING `buildImpactReport`, not hand-typed.

## Verbatim Declarations

**Phase 126 is planned against this text.** Reproduced exactly as shipped in
`packages/server/src/db.ts`.

### DDL (inside `SCHEMA_DDL`, after the `brand_config` block)

```sql
  CREATE TABLE IF NOT EXISTS table_sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('baseline','diff')),
    changeset_json TEXT,
    report_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_table_sync_history_table_id ON table_sync_history (table_id, id DESC);

  CREATE TABLE IF NOT EXISTS table_sync_history_meta (
    table_id INTEGER PRIMARY KEY REFERENCES tables(id) ON DELETE CASCADE,
    dropped_count INTEGER NOT NULL DEFAULT 0,
    last_dropped_ts TEXT
  );
```

No PRAGMA-guarded ALTER accompanies these: both are NEW tables, so `CREATE TABLE IF NOT EXISTS`
covers fresh installs and existing deployments alike (the `brand_config` precedent).

### Constant

```ts
export const SYNC_HISTORY_CAP = 20;
```

### Types

```ts
export type SyncChangeset = {
  v: 1;
  added: { column: string; liveType: string }[];
  removed: { column: string; storedType: string }[];
  retyped: { column: string; storedType: string; liveType: string }[];
};

export type TableSyncHistoryEntry = {
  id: number;
  table_id: number;
  ts: string;
  actor: string;
  kind: "baseline" | "diff";
  /** null for a baseline entry -- establishing a first fingerprint has no changeset. */
  changeset: SyncChangeset | null;
  /** null for a baseline entry. Otherwise the ImpactReport exactly as it was built. */
  report: ImpactReport | null;
};

export type TableSyncHistory = {
  /** Newest first, ordered by id DESC. At most SYNC_HISTORY_CAP long. */
  entries: TableSyncHistoryEntry[];
  droppedCount: number;
  lastDroppedTs: string | null;
  /** Echoed so the UI never hardcodes the number. */
  cap: number;
};
```

`ImpactReport` arrives via a TYPE-ONLY import at db.ts:9
(`import type { ImpactReport } from "./lib/schemaImpact";`) — db.ts does not depend on the impact
composer at value level.

### Signatures

```ts
export const setTableSchemaSnapshot = (
  id: number,
  columns: Record<string, string>,
  fingerprintJson: string
): boolean => { ... };

export const insertTableSyncHistoryEntry = (input: {
  tableId: number;
  actor: string;
  kind: "baseline" | "diff";
  changeset: SyncChangeset | null;
  report: ImpactReport | null;
}): { id: number; dropped: number } => { ... };

export const listTableSyncHistory = (tableId: number): TableSyncHistory => { ... };

export const getTableSyncHistoryEntry = (id: number): TableSyncHistoryEntry | undefined => { ... };

export const deleteTableSyncHistoryEntry = (id: number): boolean => { ... };
```

## Mutation probes — 9/9 FIRED

Each probe was applied to the COMMITTED source, the spec re-run, then reverted with
`git checkout --` and `git diff --exit-code -- packages/server/src/db.ts` confirmed clean.

| # | Mutation | Must redden | Outcome |
|---|----------|-------------|---------|
| P1 | `LIMIT ?` bound `SYNC_HISTORY_CAP` → `SYNC_HISTORY_CAP + 5` | `CAP-over` | **FIRED** (also CAP-scoped, DROPPED-count, DROPPED-survives-delete) |
| P2 | delete the `if (dropped > 0)` meta upsert | `DROPPED-count` | **FIRED** (also DROPPED-survives-delete) |
| P3 | cap sweep `ORDER BY id DESC` → `ORDER BY ts DESC` | `CAP-over` | **FIRED after strengthening** |
| P4 | `listTableSyncHistory` `ORDER BY id DESC` → `ORDER BY ts DESC` | `HIST-order` | **FIRED after strengthening** (also CAP-over) |
| P5 | drop `table_id = ? AND` from the cap sweep's outer WHERE | `CAP-scoped` | **FIRED** (also CAP-under, DROPPED-count, DROPPED-survives-delete) |
| P6 | `deleteTableSyncHistoryEntry` deletes by the entry's `table_id` | `HIST-delete-one` | **FIRED** (also DROPPED-survives-delete) |
| P7 | remove the `DELETE FROM table_sync_history_meta` line from `deleteTable` | `HIST-cascade` | **FIRED after strengthening** |
| P8 | `setTableSchemaSnapshot` writes only `columns_fingerprint` | `WRITE-snapshot` | **FIRED** (also HIST-delete-one) |
| P9 | re-serialise the report on read with a sorted-key replacer | `HIST-roundtrip` | **FIRED** |

### Three probes that did NOT fire on the first pass — and how the TESTS were strengthened

No probe was weakened or deleted. Commit `dfb4ec5`.

**P7 → `HIST-cascade`.** Deleting `deleteTable`'s explicit meta cleanup changed nothing, because
**better-sqlite3 opens every connection with `PRAGMA foreign_keys = ON` by default** (measured:
`new Database(":memory:").pragma("foreign_keys")` → `[{"foreign_keys":1}]`). The declared
`ON DELETE CASCADE` was doing the work; the original test proved the driver, not this code. The
long-standing comment on `deleteDashboard` — "foreign_keys PRAGMA is not globally ON in this app"
— is **stale for this driver**, and the plan's mandated comment text repeated that claim. Fixed:
`deleteTable`'s comment now states the measured fact and explains that the explicit statements are
deliberate belt-and-braces. `HIST-cascade` gained a second scenario that sets `foreign_keys = OFF`
(restoring it in a `finally`) so only `deleteTable`'s own statements can clear the rows.
`deleteDashboard`'s own stale comment was left alone — out of this plan's scope.

**P3 → `CAP-over` and P4 → `HIST-order`.** Tied same-second timestamps are NOT sufficient to
discriminate an `ORDER BY ts DESC` implementation: SQLite's sorter leaves tied rows in the order the
`(table_id, id DESC)` index fed them, so the ts-ordered version returned the identical sequence.
Both tests gained a second scenario in which `ts` is **deliberately inverted against `id`** (the
oldest id carries the latest `ts`, written with raw `UPDATE ... SET ts = ?`). Under that data only
an id-ordered sweep evicts the oldest entry, and only an id-ordered read returns newest-first.

## Acceptance criteria — all RUN, actual output recorded

Every "before" value was verified at the current tree (identical to `688ff43` for
`packages/server`) before any code was written; all were 0.

| Task | Criterion | Expected | Actual |
|---|---|---|---|
| 1.1 | `grep -c "CREATE TABLE IF NOT EXISTS table_sync_history" src/db.ts` | 2 | **2** |
| 1.2 | `grep -c "idx_table_sync_history_table_id" src/db.ts` | 1 | **1** |
| 1.3 | `grep -cE "^export const setTableSchemaSnapshot" src/db.ts` | 1 | **1** |
| 1.4 | `grep -cE "^export const SYNC_HISTORY_CAP = 20;$" src/db.ts` | 1 | **1** |
| 1.5 | `grep -cE "DELETE FROM table_sync_history WHERE table_id = \?" src/db.ts` | 1 | **1** |
| 1.6 | `it("WRITE-` ≥2 / `it("HIST-` ≥3, spec green | ≥2 / ≥3 | **2 / 6**, 18/18 green |
| 1.7 | dataset hygiene, ADDED lines only | 0 | **0** |
| 1.8 | `npx tsc --noEmit` | clean | **clean** |
| 1.9 | `git diff --name-only 688ff43 \| grep -c '^packages/web/'` | 0 | **0** |
| 2.1 | `grep -cE "^export const insertTableSyncHistoryEntry"` | 1 | **1** |
| 2.2 | `grep -cE "^export const (list\|get\|delete)TableSyncHistory..."` | 3 | **3** |
| 2.3 | `grep -cE "^export type (SyncChangeset\|TableSyncHistoryEntry\|TableSyncHistory) ="` | 3 | **3** |
| 2.4 | `grep -c "ORDER BY id DESC LIMIT ?" src/db.ts` | ≥1 | **1** |
| 2.5 | `grep -c "ORDER BY ts DESC" src/db.ts` | 0 | **0** |
| 2.6 | `it("CAP-` ≥3 / `it("DROPPED-` ≥2 | ≥3 / ≥2 | **3 / 2** |
| 2.7 | `grep -c 'expect(a.ts).toBe(b.ts)'` | ≥1 | **1** (literal, in `HIST-order`) |
| 2.8 | `grep -c "SELECT report_json FROM table_sync_history"` in spec | ≥1 | **1** |
| 2.9 | dataset hygiene, ADDED lines only | 0 | **0** |
| 2.10 | `npx tsc --noEmit` + `node scripts/test-gate.mjs` | clean + GATE PASSED | **clean + GATE PASSED** |
| 2.11 | web zero diff | 0 | **0** |

### Criteria that could not discriminate

**Criterion 2.5 (`grep -c "ORDER BY ts DESC" src/db.ts` = 0).** Read 0 before the work and 0 after —
it can only fail by a future regression, never by this plan's work. The plan says so explicitly and
pairs it with `HIST-order`, which is the test that actually proves the behaviour. Recorded, not
gamed. Note it is ALSO the weaker of the two: `HIST-order` only became a real proof after the P4
strengthening above.

**Criteria 1.7 / 2.9 (dataset hygiene).** Correctly scoped to ADDED lines, so 0-before-0-after is
the intended shape of a prohibition guard. They can only fail by introducing a banned name, which
is exactly what they guard. Not a defect.

All other criteria read 0 (or failed) before the work and pass now.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's mandated SQL comment text used backticks, which cannot appear
inside `SCHEMA_DDL`'s template literal.**
- **Found during:** Task 1, first `tsc` run (8 `TS1005`/`TS1443` syntax errors).
- **Issue:** The plan's verbatim DDL comment block quotes identifiers with backticks
  (`` `kind` ``, `` `id` ``, `` `ts` ``, …). `SCHEMA_DDL` is a JS template literal, so those 14
  backticks terminated the string.
- **Fix:** Backticks replaced with single quotes inside that comment block only. Prose unchanged.
- **Commit:** `9c067b3`

**2. [Rule 1 - Bug] `deleteTable`'s mandated comment asserted a factually wrong PRAGMA state.**
- **Found during:** probe P7 investigation.
- **Issue:** The comment (copied from `deleteDashboard`, v1.10) claims `foreign_keys` is not ON.
  better-sqlite3 turns it ON by default. Left uncorrected, the next reader would draw the wrong
  conclusion about which statement is doing the cleanup.
- **Fix:** Comment rewritten to state the measured fact and why the explicit statements stay.
- **Commit:** `dfb4ec5`

**3. [Rule 2 - Missing coverage] Three extra tests beyond the plan's `<behavior>` list.**
`HIST-empty` (zeroed cap facts for a table with no entries) and `HIST-corrupt-json` (a malformed
stored payload reads back as `null` instead of throwing — the documented behaviour of
`mapSyncHistoryRow`, which otherwise had no test), plus the strengthening scenarios above.

## Verification

- `cd packages/server && npx tsc --noEmit` → **clean**
- `cd packages/server && npx vitest run tests/db.syncHistory.spec.ts` → **18/18 passed**
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**, failing set = the 8
  documented `KNOWN_FAILING` entries.
  - One of three gate runs additionally flagged `tests/routes.schema-check.spec.ts`, which the gate
    itself re-ran in isolation and confirmed passing (TD-V16-TEST-ISOLATION contamination, allowed).
  - One gate run flagged `tests/layers.spec.ts`; it was verified passing in isolation directly
    (`npx vitest run tests/layers.spec.ts` → 23/23) and did not recur in the two subsequent full
    gate runs. `layers.spec.ts` references neither `deleteTable` nor `table_sync_history`
    (`grep -c` = 0), so it is not implicated by this plan — same TD-V16-TEST-ISOLATION class.
- `git diff --name-only 688ff43 | grep -c '^packages/web/'` → **0**
- All 9 mutation probes fired; `git diff --exit-code -- packages/server/src/db.ts` clean after each.

## For the next wave (125-02)

1. **`insertTableSyncHistoryEntry` THROWS on an unknown `tableId`** — `FOREIGN KEY constraint
   failed`, because `foreign_keys` is ON by default in better-sqlite3 (verified directly). It does
   NOT return a falsy result. The apply route must 404 on an unknown table id BEFORE inserting.
2. **`setTableSchemaSnapshot` returns `false`** for an unknown id and writes nothing — that one is
   safe to call speculatively.
3. **Insert takes `changeset: SyncChangeset | null` and `report: ImpactReport | null`** as OBJECTS,
   not strings. The layer stringifies. A baseline apply passes `null` for both.
4. **`report_json` is `JSON.stringify(report)` verbatim** — do not pre-stringify, re-sort or
   pretty-print upstream; `HIST-roundtrip` asserts byte identity against the raw column.
5. **`insertTableSyncHistoryEntry` returns `{ id, dropped }`** — `dropped` is how many entries THIS
   insert evicted (0 or 1 in practice). Cumulative totals come from `listTableSyncHistory().
   droppedCount`, never from summing these.
6. **`listTableSyncHistory` always returns all four fields**, including `cap`, even for a table with
   no entries. The UI must not hardcode 20.
7. **Any future spec that bulk-wipes `tables`** (`db.exec("DELETE FROM tables")`, as
   `tests/layers.spec.ts` does) now cascades into `table_sync_history` — harmless, but do not be
   surprised by disappearing history rows in such specs.
8. The `tables` row is the ONLY thing `setTableSchemaSnapshot` touches — ROADMAP criterion 2's
   "widgets/layers/metrics byte-identical" proof can lean on that directly.

## Self-Check: PASSED

- `packages/server/src/db.ts` — FOUND (modified)
- `packages/server/tests/db.syncHistory.spec.ts` — FOUND (created)
- Commits `2a7531f`, `9c067b3`, `4cd6855`, `fe4e285`, `dfb4ec5` — all FOUND in `git log`
