---
phase: 126-datasets-ui-access-gating
plan: 01
subsystem: web-api-client
tags: [schema-sync, api-client, dto, http-409, tdd]
requires: []
provides:
  - "packages/web/src/api/client.ts :: checkTableSchema"
  - "packages/web/src/api/client.ts :: applyTableSchema"
  - "packages/web/src/api/client.ts :: listTableSyncHistory"
  - "packages/web/src/api/client.ts :: deleteTableSyncHistoryEntry"
  - "packages/web/src/api/client.ts :: SchemaCheckResponse / SchemaApplyResult / TableSyncHistory / ImpactReport / ColumnFingerprintMap (+ 18 supporting DTO types)"
affects:
  - "126-02, 126-03, 126-04 — every later plan in this phase consumes these types and callers"
tech-stack:
  added: []
  patterns:
    - "HTTP 409 handled as a RETURN VALUE (discriminated union on `outcome`), not an error class"
    - "bare-body JSON parsing (getTableById / createCustomMetric form), no { data } envelope"
    - "204 DELETE never calls .json() (deleteCustomMetric form)"
key-files:
  created:
    - packages/web/src/api/client.schema-sync.spec.ts
  modified:
    - packages/web/src/api/client.ts
decisions:
  - "applyTableSchema returns the server's four-outcome union as a value; 409 is checked BEFORE throwForStatus so the approved stale refusal message survives"
  - "No fourth error class and no useApiQuery change — `outcome` already discriminates and useApiQuery is mount-scoped, wrong for a button-triggered mutation"
  - "ColumnRefSite mirrored as `string`, not the server's 40-member union — display-only on the client"
metrics:
  duration: "~25 min"
  completed: 2026-09-28
  tasks: 2
  commits: 3
---

# Phase 126 Plan 01: Schema-Sync API Layer Summary

The four `packages/web` route callers for the schema-sync surface Phases 122-125 shipped, with
HTTP 409 returned as a modelled `outcome` value instead of a message-destroying bare `Error`.

## What shipped

One new `// --- Schema Sync (v1.25 Phase 126 — SSYNC-V125-01/-18/-19) ---` section appended to
`packages/web/src/api/client.ts` (1767 → 1953 lines, pure append), plus a new spec file.

### Exported signatures — the contracts 126-02 calls

```ts
checkTableSchema(tableId: number): Promise<SchemaCheckResponse>
applyTableSchema(tableId: number, live: ColumnFingerprintMap): Promise<SchemaApplyResult>
listTableSyncHistory(tableId: number): Promise<TableSyncHistory>
deleteTableSyncHistoryEntry(tableId: number, entryId: number): Promise<void>
```

### Exported result types

```ts
type ColumnFingerprint    = { base: string; refinements: string[] };
type ColumnFingerprintMap = Record<string, ColumnFingerprint>;

type SchemaCheckResult =
  | { outcome: "diff"; table: string; hasChanges: boolean;
      added: AddedColumn[]; removed: RemovedColumn[]; retyped: RetypedColumn[];
      live: ColumnFingerprintMap }
  | { outcome: "baseline_required"; table: string; message: string; live: ColumnFingerprintMap }
  | { outcome: "table_missing"; table: string; message: string };
type SchemaCheckResponse = SchemaCheckResult & { impact?: ImpactReport };

type SchemaApplyResult =
  | { outcome: "applied"; kind: "baseline" | "diff"; table: string; tableId: number;
      recorded: true; historyId: number; droppedThisApply: number;
      columns: Record<string, string>; changeset: SyncChangeset | null; message: string }
  | { outcome: "no_changes";    table: string; tableId: number; message: string }
  | { outcome: "stale";         table: string; tableId: number; message: string }
  | { outcome: "table_missing"; table: string; tableId: number; message: string };

type TableSyncHistory = { entries: TableSyncHistoryEntry[]; droppedCount: number;
                          lastDroppedTs: string | null; cap: number };
type TableSyncHistoryEntry = { id: number; table_id: number; ts: string; actor: string;
                               kind: "baseline" | "diff";
                               changeset: SyncChangeset | null; report: ImpactReport | null };
```

Also exported, all mirrored verbatim from the server: `AddedColumn`, `RemovedColumn`,
`RetypedColumn`, `ImpactAdvisoryKind`, `ImpactAdvisory`, `RefConfidence`, `ColumnRefTableScope`,
`ColumnRefRecordKind`, `ColumnRefMatch`, `ColumnRefSite`, `ImpactSeverity`, `ImpactChangeKind`,
`ImpactReference`, `ImpactRecord`, `ImpactColumn`, `ImpactSection`, `ImpactReport`,
`SyncChangeset`.

### Three notes 126-02 must not rediscover

1. **`SchemaCheckResponse.impact` is OPTIONAL and its ABSENCE is load-bearing.** The caller does
   NOT default it. `"impact" in result === false` means "the report was not run"; an `impact` with
   empty sections means "no findings". Probe P6 exists solely to keep that true.
2. **`applyTableSchema` NEVER throws on 409.** `stale` and `table_missing` arrive as ordinary
   return values with the server's operator-facing `message` byte-intact. Branch on `outcome`;
   there is no `ConflictError` to catch. 401/403/502 still throw `ReauthRequiredError` /
   `PermissionError` / `UpstreamError`; 400/404 still throw a bare `Error` carrying the server's
   `{ error }` string.
3. **`cap` and `droppedCount` come from the response.** `CLIENT-history-shape` deliberately uses
   `cap: 5`, not the server default of 20, so any hardcoded 20 downstream is detectable.

### Three deliberate type simplifications

| Server type | Mirrored as | Why |
|---|---|---|
| `ColumnRefSite` (40-member union) | `string` | display-only on the client; a server-side site rename must not become a web compile error |
| `ImpactColumn.storedClass` | `string \| null` | `ColumnTypeClass` is server-internal; the UI renders it indirectly |
| `ImpactColumn.liveClass` | `string \| null` | same |

`?` markers preserved exactly on `SchemaCheckResponse.impact` and `ImpactRecord.staleDrillDownType`.

## Tests

`packages/web/src/api/client.schema-sync.spec.ts` — 11 tests, all passing.

| Test id | Proves |
|---|---|
| `CLIENT-check-url` | GET ends `/api/tables/7/schema-check` |
| `CLIENT-check-bare-body` | 200 resolves to the bare body; `result.impact` defined (no `{data}` unwrap) |
| `CLIENT-check-impact-absent` | `"impact" in result` is `false` for a `baseline_required` body |
| `CLIENT-apply-body` | POST, `Content-Type: application/json`, parsed body `{ live: {...} }` |
| `CLIENT-409-stale` | 409 `stale` RESOLVES; `message` byte-identical to the input |
| `CLIENT-409-missing` | 409 `table_missing` RESOLVES |
| `CLIENT-apply-403` | 403 still rejects with `PermissionError` |
| `CLIENT-apply-400` | 400 rejects with the server's own `error` string |
| `CLIENT-history-shape` | bare body; `cap === 5` (not 20) |
| `CLIENT-204-delete` | 204 resolves `undefined` against a `json` stub that REJECTS |
| `CLIENT-204-delete-url` | DELETE ends `/api/tables/7/sync-history/41` |

TDD order was observed: the spec was committed RED (11/11 failing, `a7fb30c`) before the
implementation (`990ca53`).

## Mutation probes — 6/6 fired, first attempt, no test strengthening needed

Every probe was applied to **committed** source and its presence on disk confirmed with
`git diff --stat` BEFORE the suite ran (the two `NON-RESULT` lessons from 125-04). Every probe was
reverted and `git diff --exit-code -- packages/web/src/api/client.ts` confirmed clean afterwards.

| # | Mutation | On-disk diff | Required to redden | Actually reddened | Count |
|---|---|---|---|---|---|
| P1 | delete the 409 short-circuit line from `applyTableSchema` | `1 -` | `CLIENT-409-stale` + `CLIENT-409-missing` | both, as required | 2 failed / 9 passed |
| P2 | `return (await response.json()) as void;` added to `deleteTableSyncHistoryEntry` | `1 +` | `CLIENT-204-delete` | `CLIENT-204-delete` **and** `CLIENT-204-delete-url` (superset) | 2 failed / 9 passed |
| P3 | `checkTableSchema` returns `((…) as { data: SchemaCheckResponse }).data` | `1 +, 1 -` | `CLIENT-check-bare-body` + `CLIENT-check-impact-absent` | both, as required | 2 failed / 9 passed |
| P4 | `applyTableSchema` body → `JSON.stringify(live)` (wrapper dropped) | `1 +, 1 -` | `CLIENT-apply-body` | `CLIENT-apply-body` | 1 failed / 10 passed |
| P5 | 409 check moved AFTER `throwForStatus` | `1 +, 1 -` | `CLIENT-409-stale` | `CLIENT-409-stale` **and** `CLIENT-409-missing` (superset) | 2 failed / 9 passed |
| P6 | `checkTableSchema` defaults a missing `impact` to `{ v: 1, sections: [] }` | `3 +, 1 -` | `CLIENT-check-impact-absent` | `CLIENT-check-impact-absent` | 1 failed / 10 passed |

No probe was weakened, deleted or re-scoped. No test needed strengthening.

## Acceptance criteria — every one RUN, before and after

| # | Command | Before (measured at `2ccb8c5`) | Required | **Actual after** | Verdict |
|---|---|---|---|---|---|
| 1 | `grep -rF 'applyTableSchema' packages/web/src \| wc -l` | 0 | ≥ 3 | **10** | PASS |
| 2 | `grep -rF 'checkTableSchema' packages/web/src \| wc -l` | 0 | ≥ 3 | **7** | PASS |
| 3 | `grep -rF 'listTableSyncHistory' packages/web/src \| wc -l` | 0 | ≥ 3 | **5** | PASS |
| 4 | `grep -rF 'deleteTableSyncHistoryEntry' packages/web/src \| wc -l` | 0 | ≥ 3 | **6** | PASS |
| 5 | `grep -cF 'status === 409' packages/web/src/api/client.ts` | 0 | exactly 1 | **1** | PASS |
| 6 | `grep -rF 'CLIENT-409-stale' packages/web/src \| wc -l` | 0 | ≥ 1 | **1** | PASS |
| 7 | `grep -rF 'CLIENT-204-delete' packages/web/src \| wc -l` | 0 | ≥ 2 | **2** | PASS |
| 8 | `grep -rF 'SchemaApplyResult' packages/web/src \| wc -l` | 0 | ≥ 3 | **4** | PASS |
| 9 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | 0 | 0 | **0** | PASS |
| 10 | `git diff --name-only 2ccb8c5 \| grep -c '^packages/web/src/hooks/useApiQuery.ts'` | 0 | 0 | **0** | PASS |
| P | `git diff --unified=0 2ccb8c5 -- …/client.ts \| grep '^+[^+]' \| grep -cE 'json\.data\|headers.*Authorization'` | n/a (no added lines) | 0 | **0** | PASS |

The plan's stated before-values were re-measured rather than trusted, and all ten read **0** as
documented — the first plan in this milestone where no stated before-value was stale.

**No criterion failed to discriminate this plan.** Criteria 1-8 all had a genuine before-value of 0
because every anchor is a symbol or test-id this plan introduces. Criteria 9, 10 and the prohibition
criterion are absence assertions whose discriminating power is structural rather than empirical
(they would fire on a real violation); the prohibition criterion is correctly anchored to ADDED
lines only, which is what makes it meaningful against a 1767-line pre-existing file. One residual
note for future planners: criteria 9 and 10 read 0 both before and after by construction, so they
cannot *fail-before*; they are still worth keeping because they are the only mechanical guard on the
milestone's ZERO-server-diff budget, but they prove "nothing broke", not "something was built".

## Gates

| Gate | Result |
|---|---|
| `cd packages/web && npx tsc --noEmit` | clean (exit 0) |
| `cd packages/web && npx vitest run` | **182 files / 4111 tests passed**, 0 failed (baseline 181 / 4100 — exactly +1 file, +11 tests) |
| `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` | **152 passed** — unchanged, as required (no file added under `src/components/`) |
| `git diff --exit-code -- packages/web/src/api/client.ts` after probes | exit 0, no residue |
| `git diff --name-only 2ccb8c5 \| grep -c '^packages/server/'` | 0 |

## Deviations from Plan

None — the plan executed exactly as written. No auto-fix rule was invoked, no auth gate was hit,
no architectural decision arose.

One documentation nuance worth recording: the plan's own `<acceptance_criteria>` warned that
writing "Add NO `Authorization` header" as a code comment would trip the prohibition grep. The
comment was simply not written — the code carries no such header and `apiFetch` forces
`credentials: "include"` at `client.ts:59`, so the comment carried no information the code lacked.

## Commits

| Hash | Message |
|---|---|
| `a7fb30c` | `test(126-01): add failing CLIENT- tests for the four schema-sync route callers` |
| `990ca53` | `feat(126-01): add schema-sync DTOs and the four route callers` |

Task 2 (mutation probes) produced no code change by design — all six mutations were reverted — so
it carries no implementation commit. Its evidence is the probe table above.

## Self-Check: PASSED

- `packages/web/src/api/client.ts` — FOUND (1953 lines; 4 new `export const` route callers)
- `packages/web/src/api/client.schema-sync.spec.ts` — FOUND
- `.planning/phases/126-datasets-ui-access-gating/126-01-SUMMARY.md` — FOUND
- commit `a7fb30c` — FOUND
- commit `990ca53` — FOUND
