---
phase: 122-schema-diff-table-missing-detection
plan: 04
subsystem: server-api
tags: [schema-sync, kinetica, express, rbac, route]

# Dependency graph
requires:
  - "packages/server/src/lib/schemaFingerprint.ts (tablePresence, parseColumnFingerprints, parseFingerprintSnapshot) — Plan 122-01"
  - "packages/server/src/lib/schemaDiff.ts (diffResult, baselineRequiredResult, tableMissingResult, SchemaCheckResult) — Plan 122-03"
  - "packages/server/src/db.ts (getTableColumnsFingerprint) — Plan 122-02"
  - "packages/server/src/kinetica.ts (kineticaShowTable showOptions) — Plan 122-01"
provides:
  - "GET /api/tables/:id/schema-check — thin, read-only route wiring the three-outcome schema check behind the existing datasets:manage permission"
affects:
  - "Phase 124 (impact report) — will call this route (or its handler logic) and classify SchemaCheckResult.retyped[].stored/live severity"
  - "Phase 125 (apply + sync history) — owns writing tables.columns_fingerprint; this route proves the pre-write read path is correct and non-mutating"
  - "Phase 126 (web UI) — first caller of this route; nothing in packages/web references it yet"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "asyncHandler + NO try/catch: a thrown typed Kinetica error IS the 'could not reach Kinetica' outcome, forwarded to the existing global errorMiddleware (401/403/502) — never caught locally into a 200 payload"
    - "Route composition mirrors the existing /api/tables block: requireConfig, then ...requirePermission(...), then asyncHandler — same order as the sibling discovery routes"

key-files:
  created:
    - packages/server/tests/routes.schema-check.spec.ts
  modified:
    - packages/server/src/index.ts

key-decisions:
  - "Reused the existing DATASETS_MANAGE permission — no new permission string added to lib/permissions.ts, avoiding the rbacDb/rbacMigration/web-permissions/RolesPage count-assertion ripple documented as a known trap"
  - "Exactly one Kinetica call: /show/table with { no_error_if_not_exists: \"true\" }. INFORMATION_SCHEMA is not queried by this route — corroboration only, recorded in the spike notes, never a second source of truth consulted at runtime"
  - "'Could not reach Kinetica' is not a route response shape — it is whatever kineticaShowTable throws, propagated through asyncHandler to errorMiddleware as 401/403/502. The route body has three success shapes only: diff / baseline_required / table_missing"
  - "GET, not POST — read-only semantics made legible by the HTTP method itself"

requirements-completed: [SSYNC-V125-02, SSYNC-V125-03, SSYNC-V125-04, SSYNC-V125-05]

duration: ~50min
completed: 2026-09-21
---

# Phase 122 Plan 04: GET /api/tables/:id/schema-check Route Summary

**One thin, read-only Express route wiring `kineticaShowTable`'s single `/show/table` call through `schemaFingerprint`'s parser and `schemaDiff`'s three-outcome contract, gated by the existing `datasets:manage` permission, with zero writes to any of the five app config tables and zero new Kinetica query paths.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 (Task 1 route, Task 2 TDD spec)
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `GET /api/tables/:id/schema-check` added immediately after the existing `DELETE /api/tables/:id` block, composed exactly like the sibling discovery routes (`requireConfig`, `...requirePermission(PERMISSIONS.DATASETS_MANAGE)`, `asyncHandler`), with no try/catch anywhere in the handler
- 14 integration tests proving: the changed-table diff (operator's real varchar8->varchar32 case), the unchanged-table no-op diff, both `table_missing` tests, an unreachable-Kinetica 502, a present-but-unparseable-body 502, a NEW unreadable-body 502 (added to close an M9 gap — see below), the `baseline_required` NULL-fingerprint case, a rename-is-not-a-pairing test with a forbidden-token guard, the exactly-one-fetch-call proof, the `no_error_if_not_exists` request-body proof, the byte-identical five-table proof across all three 200 outcomes, a 404 for an unknown table id, and the analyst 403 permission gate
- Confirmed via `git diff --name-only e885295 HEAD`: this plan touches exactly `packages/server/src/index.ts` and `packages/server/tests/routes.schema-check.spec.ts` — zero web files, and `schemaFingerprint.ts` / `schemaDiff.ts` / `db.ts` (all shipped green by prior plans) are untouched
- All 10 named mutation probes fired against their intended tests; M9 required strengthening the test suite (adding a fixture), not weakening the probe, exactly as the plan's own contingency instructed

## Route Contract (final, verbatim behavior)

**`GET /api/tables/:id/schema-check`**
Gate: `requireConfig` (KINETICA_URL configured), then `datasets:manage` (existing `PERMISSIONS.DATASETS_MANAGE`, no new permission).

| Condition | Status | Body |
|---|---|---|
| `id` does not match a registered table | 404 | `{ error: "Table not found." }` |
| No `datasets:manage` permission | 403 | `{ error, code: "PERMISSION_DENIED" }` (via `requirePermission`) |
| `kineticaShowTable` throws `KineticaAuthError` | 401 | `{ error, code: "REAUTH_REQUIRED" }` (via `errorMiddleware`) |
| `kineticaShowTable` throws `KineticaPermissionError` | 403 | `{ error }` (via `errorMiddleware`) |
| Network failure, non-2xx, or `status:"ERROR"` from `/show/table` (`KineticaUpstreamError`) | 502 | `{ error }` (via `errorMiddleware`) |
| `tablePresence(body) === "unreadable"` (malformed body, e.g. no `table_names` array) | 502 | `{ error }` — thrown as `KineticaUpstreamError`, never a 200 |
| Table present but no readable column types (`parseColumnFingerprints` returns `{}`) | 502 | `{ error }` — thrown as `KineticaUpstreamError`, never a diff claiming every column removed |
| `tablePresence(body) === "missing"` (empty `table_names` array) | 200 | `SchemaCheckResult` with `outcome: "table_missing"`, `table`, `message` — NO `added`/`removed`/`retyped` keys |
| Table present, live columns readable, `getTableColumnsFingerprint(id)` is NULL / unparseable | 200 | `outcome: "baseline_required"`, `table`, `message`, `live` |
| Table present, live columns readable, stored baseline parses | 200 | `outcome: "diff"`, `table`, `hasChanges`, `added`, `removed`, `retyped`, `live` |

Exactly one outbound Kinetica call: `POST /show/table` with `options: { no_error_if_not_exists: "true" }`. No SQL of any kind is issued by this route (no `INFORMATION_SCHEMA` query, no second column-metadata path). No write of any kind — the route never calls `createTable`/`updateTable`/`deleteTable` or any raw `INSERT`/`UPDATE`/`DELETE`.

**Phase 125 owns the writer.** `tables.columns_fingerprint` has no writer anywhere in the codebase after this plan — the tests establish baselines with raw `UPDATE tables SET columns_fingerprint = ?` directly in test SQL specifically because Phase 122 ships none. Phase 125's apply step is the first and only place that will ever write this column.

## Task Commits

1. **Task 1: Add GET /api/tables/:id/schema-check** - `f4b37d2` (feat)
2. **Task 2: Route spec — four outcomes, the no-write proof, the single-call proof** - `155c9d5` (test)

_No separate plan-metadata commit — this SUMMARY plus STATE/ROADMAP updates are the orchestrator's responsibility per this plan's ownership rule._

## Files Created/Modified

- `packages/server/src/index.ts` — added the route (69 lines: imports + route + doc comment) immediately after the existing `DELETE /api/tables/:id` block
- `packages/server/tests/routes.schema-check.spec.ts` — 14 integration tests (created)

## Non-discriminating acceptance criteria found and handled per CLAUDE.md

Task 1's own mandated verbatim doc-comment / action text (the plan's `<action>` code block, copied exactly) contains one incidental extra occurrence of two of its own grep anchors:

- **Criterion 2** (`grep -c "no_error_if_not_exists" src/index.ts` = 1): the mandated header prose ("ONE Kinetica call, /show/table, with no_error_if_not_exists...") contains the token once in addition to its one functional occurrence in the actual `showOptions` object, giving 2, not 1.
- **Criterion 5** (`grep -c "INFORMATION_SCHEMA" src/index.ts` = 6, unchanged): the mandated header prose ("INFORMATION_SCHEMA is deliberately NOT consulted...") adds one comment-only occurrence, giving 7, not 6.

Both are the same pattern 122-03 hit and documented: the plan's own required literal text defeats its own grep anchor. I verified the real requirements directly instead of editing the plan-mandated comment to dodge the count:
- Real requirement for criterion 2: the `/show/table` request options carry `no_error_if_not_exists: "true"` exactly once in the actual request body. Confirmed by `git diff -U0 src/index.ts | grep "no_error_if_not_exists"` showing exactly one code-level occurrence (`showOptions: { no_error_if_not_exists: "true" }`) plus one prose comment — no second Kinetica call construct exists.
- Real requirement for criterion 5: no second Kinetica column-metadata query path (SQL or otherwise) was introduced. Confirmed by `git diff -U0 src/index.ts | grep -E "kineticaSqlHelper|fetch\(|INFORMATION_SCHEMA\."` returning empty — the only addition mentioning the token is prose, not a query.

No test/criterion was weakened; both real requirements hold and are separately proven by the exactly-one-fetch-call test in Task 2.

## Decisions Made

Followed the plan's action steps and locked decisions verbatim — no discretion exercised beyond what the plan explicitly delegated (fixture construction details for Task 2, which followed the plan's `<behavior>`/`<action>` notes exactly).

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blockers were found in the plan's own design.

### Mutation-probe test strengthening (not a deviation — an explicit plan instruction)

**M9** (`In tablePresence's caller, treat "unreadable" as "missing"`) did **not** redden against the plan's own named test ("unreachable Kinetica: 502 and the body has no outcome field") on the first attempt, exactly as the plan itself flagged as likely. Root cause: that test is a `fetch`-level rejection (a network failure), which `kineticaShowTable` converts to `KineticaUpstreamError` *before* the route ever calls `tablePresence()` — it can never observe the "unreadable" branch. Per CLAUDE.md and the plan's own contingency instruction ("if it does not fire, ADD a test... — strengthen the test, never weaken the probe"), I added a fourteenth test, "unreadable /show/table body (no table_names array at all): 502, never table_missing or a diff", using a body fixture (`{ some_other_field: "..." }`) that is structurally malformed (no `table_names` key at all) rather than merely a network failure. Verified: passes against the real implementation (14/14), then re-applied the M9 mutation and confirmed this new test — and only this test — reddens. No probe was weakened; no existing test was altered.

## Mutation Probe Results

All 10 probes from the plan's table were applied one at a time to a working copy of `src/index.ts` (restored from a pristine backup between each), verified against the real spec, and reverted. Final `src/index.ts` confirmed byte-identical to its pre-mutation state via `diff` after all 10 probes.

| # | Mutation | Named test | Result |
|---|----------|-----------|--------|
| M1 | Drop `showOptions` from the `kineticaShowTable` call | "the /show/table request body carries options.no_error_if_not_exists = 'true'" | **Fired.** Clean, no collateral. |
| M2 | On the `missing` branch, return `diffResult(qualified, {}, {})` instead of `tableMissingResult` | "missing table: 200 outcome 'table_missing' with no added/removed/retyped keys" | **Fired.** Clean, no collateral. |
| M3 | Wrap the `kineticaShowTable` call in `try {} catch { return res.json(diffResult(...)) }` | "unreachable Kinetica: 502 and the body has no outcome field" | **Fired.** Clean, no collateral. |
| M4 | Delete the `Object.keys(live).length === 0` guard | "unparseable /show/table body for a table that IS present: 502, never a diff" | **Fired.** Clean, no collateral. |
| M5 | Treat a null snapshot as `{}` and fall through to `diffResult` | "old-format table (columns_fingerprint NULL): 200 outcome 'baseline_required', not a diff" | **Fired.** Clean, no collateral. |
| M6 | Add `updateTable(id, { description: table.description })` inside the handler | "a check leaves tables, widgets, dashboard_layers, custom_metrics and column_display_config byte-identical" | **Fired.** Clean, no collateral (row `description`/`updated_at` diverge on the seeded/checked table row only). |
| M7 | Remove `...requirePermission(PERMISSIONS.DATASETS_MANAGE)` from the route | "analyst: 403 PERMISSION_DENIED (datasets:manage gate)" | **Fired.** Clean, no collateral (global `requireAuth` still populates `req.user`; only the permission check is bypassed). |
| M8 | Add an `INFORMATION_SCHEMA.COLUMNS` `kineticaSqlHelper` call before `/show/table` | "the check makes exactly one Kinetica call and its URL contains /show/table" | **Fired.** Confirmed via a debug instrumentation run that the mutation caused 2 fetch calls (the injected SQL call plus the real `/show/table` call); the named test reddens because the injected call's mismatched response shape trips the earlier `res.status` assertion first, but the underlying 2-call fact is independently confirmed. |
| M9 | In `tablePresence`'s caller, treat `"unreadable"` as `"missing"` | "unreachable Kinetica: 502 and the body has no outcome field" | **Did NOT fire** on the named test, exactly as the plan flagged as likely (that test is a fetch-level rejection, never reaching `tablePresence`). **Strengthened the test suite** by adding "unreadable /show/table body (no table_names array at all): 502, never table_missing or a diff" — verified passing on the real implementation, then confirmed it reddens under this exact mutation. |
| M10 | Change the route from GET to POST | "changed table: 200 with added, removed and retyped groups, retypes naming both types" | **Fired.** Clean, no collateral (spec's GET request 404s against the now-POST-only route). |

## Test Gates

- `cd packages/server && npx tsc --noEmit` → **clean**.
- `cd packages/server && node scripts/test-gate.mjs` → **GATE PASSED**. 1240/1293 tests passed; exactly the same 8 documented `KNOWN_FAILING` files as the 122-01/02/03 baseline (`auth.oidc`, `auth.routes`, `boot.hardening`, `boot.wipe`, `bootstrap`, `db.smoke`, `oidc.module`, `routes.wms`) — the failing set did not grow. Never asserted a fixed pass-count.
- `cd packages/web && npx tsc --noEmit` → clean (untouched, as expected).
- `cd packages/web && npx vitest run` → **181/181 test files, 4100/4100 tests passed** — matches the plan's documented baseline exactly.
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **152/152 passed** — matches baseline.
- `git diff --name-only e885295 HEAD` → `packages/server/src/index.ts`, `packages/server/tests/routes.schema-check.spec.ts` only.
- `git diff --name-only e885295 HEAD | grep -c '^packages/web/'` → **0**.
- `git diff --name-only e885295 HEAD | grep -E 'schemaFingerprint\.ts|schemaDiff\.ts|src/db\.ts'` → empty (none of the three prior-plan libs touched).

## Issues Encountered

None beyond the two non-discriminating acceptance criteria and the M9 test-strengthening documented above, both handled per CLAUDE.md's explicit guidance without weakening any check or editing implementation code to satisfy a broken grep.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`GET /api/tables/:id/schema-check` is live and fully proven end-to-end (all three 200 outcomes, the 401/403/502 error surface, the no-write guarantee, and the single-Kinetica-call guarantee). This closes Phase 122. Ready for:
- **Phase 124** (impact report) to classify `SchemaCheckResult.retyped[].stored`/`.live` severity from this route's `diff` outcome.
- **Phase 125** (apply + sync history) to write `tables.columns_fingerprint` for the first time — no writer exists anywhere in the codebase yet, confirmed across all four Phase 122 plans.
- **Phase 126** (web UI) to become the first caller of this route — `packages/web` remains completely untouched by all of Phase 122.

No blockers.

## Self-Check

```
FOUND: packages/server/src/index.ts (route present)
FOUND: packages/server/tests/routes.schema-check.spec.ts
FOUND commit: f4b37d2
FOUND commit: 155c9d5
```

## Self-Check: PASSED

---
*Phase: 122-schema-diff-table-missing-detection*
*Completed: 2026-09-21*
