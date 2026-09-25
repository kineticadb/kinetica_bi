# Defect: two `db.ts` comments assert `foreign_keys` is OFF; it is ON

**Found:** Phase 125-01 (v1.25 Schema Sync), 2026-09-25
**Severity:** Documentation-only today. No incorrect runtime behaviour observed.
**Status:** Open — deliberately NOT fixed in v1.25 (out of phase scope).

## The claim in the code

`packages/server/src/db.ts:231` (inside `SCHEMA_DDL`):

> `-- NOTE: foreign_keys PRAGMA is NOT enabled globally in this app (only WAL is set);`

`packages/server/src/db.ts:583` (in `deleteDashboard`):

> `// foreign_keys PRAGMA is not globally ON in this app (only WAL is set), so ON DELETE`
> `// CASCADE on dashboard_access_grants does not fire automatically`

## Measurement

```
$ node -e "const D=require('better-sqlite3');const d=new D(':memory:');console.log(JSON.stringify(d.pragma('foreign_keys')));"
[{"foreign_keys":1}]
```

better-sqlite3 opens every connection with `PRAGMA foreign_keys = ON`. The app never
turns it off. So FK enforcement — including `ON DELETE CASCADE` — **is** active.

## How it surfaced

Phase 125-01 mandated an explicit history-cleanup block in `deleteTable`, modelled on
`deleteDashboard`'s explicit grant cleanup, with a comment copied from it. Mutation probe
P7 deleted that cleanup block and **no test reddened** — because the declared
`ON DELETE CASCADE` was already doing the work. The test was proving the driver's default,
not the code. The executor strengthened `HIST-cascade` to re-assert with
`foreign_keys = OFF`, corrected its own comment to the measured fact, and correctly left
the two pre-existing comments untouched.

## Why it matters

1. The comments invite future code to assume deletes do NOT cascade, or that an insert
   with a dangling FK will succeed. It will not — `insertTableSyncHistoryEntry` throws
   `FOREIGN KEY constraint failed` on an unknown `table_id`.
2. `deleteDashboard`'s explicit grant delete is redundant, not load-bearing. Harmless to
   keep; dangerous to *remove on the belief the comment is accurate*, since the comment
   says the cascade will not fire.
3. Any test written to prove an explicit-cleanup block works is vacuous unless it disables
   the PRAGMA first. That is exactly the trap P7 caught.

## Suggested fix (future phase)

Correct both comments to state the measured default, and decide explicitly whether
`deleteDashboard`'s redundant cleanup stays (recommend: keep it, re-comment it as
belt-and-braces). Audit for any other "PRAGMA is off" assumption. Do NOT remove any
explicit cleanup without a test that runs with `foreign_keys = OFF`.
