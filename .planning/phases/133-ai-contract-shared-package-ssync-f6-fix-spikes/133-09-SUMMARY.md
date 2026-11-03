---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 09
subsystem: server/filter-materialize
tags: [column-guard, dynamic-view, AISAFE-V20-01]
requires: [133-01, 133-06, 133-08]
provides: [viewColumns helpers, dv-path column guard]
key-files:
  created: [packages/server/src/lib/viewColumns.ts, packages/server/tests/lib.viewColumns.spec.ts, packages/server/tests/routes.column-guard.dv.spec.ts]
  modified: [packages/server/src/index.ts, packages/server/tests/routes.filter-materialize-dv.spec.ts, packages/server/tests/routes.filter-materialize-combo.spec.ts, 133-COLUMN-AUDIT.md]
decisions:
  - "dv column source = S1 decision: SELECT * FROM <view> LIMIT 0, read column_headers; never columns_json"
  - "Cache invalidated at start AND after re-materialize, plus drop and DELETE (4 delete sites)"
metrics:
  completed: 2026-10-09
---

# Phase 133 Plan 09: dv-path column guard Summary

The dynamic-view path of POST /api/filter/materialize now rejects filter columns absent from the dv's real materialized view (`Column "region" no longer exists on dynamic view "<name>"`, UNKNOWN_COLUMN) before any CREATE is sent. The column list comes from a `LIMIT 0` probe (S1 decision), cached per view for the TTL.

Commits: b3ca8ed (red specs), 0ebf5b9 (helpers), 8172680 (wiring, fixtures, audit).

## Red evidence (Task 1, unmodified code)
CG-DV1, CG-DV3, CG-DV4 failed; CG-DV2 passed (non-regression).

## Mutation proof
- Commenting out `assertColumnsExist(dvColumns...)` -> CG-DV1 and CG-DV4 red.
- Disabling `viewColumnsCache.set` -> CG-DV3 red.
- Both restored (diff vs. committed index.ts verified clean before commit).

## Verification
- `tsc --noEmit` clean. CG-DV (4), VC (5), routes.filter-materialize-dv, routes.filter-materialize-combo all green (run with DEFAULT_VIEW_TTL_MINUTES=5).
- `node scripts/test-gate.mjs`: GATE PASSED (8 known-failing; routes.schema-check passes alone = contamination).
- Greps: `assertColumnsExist(dvColumns` = 1 (was 0), before `createOrReplaceMaterialized` in the dv branch; `viewColumnsCache.delete(` = 4 (was 0); `columns_json` count in index.ts 22 before and after; `guarded (133-09` in audit = 1; `column_headers` in combo spec now >=1.

## Re-seeded specs (fixtures only; guard not loosened)
- routes.filter-materialize-dv.spec.ts: stubs now `dvProbeAwareFetch()` (a fresh Response per call; `mockResolvedValue` would reuse a consumed body); `findSqlStatement` skips the `LIMIT 0` probe. All CREATE assertions unchanged.
- routes.filter-materialize-combo.spec.ts: the two dv-path tests use the same helper.
- Both are in files_modified. The gate surfaced no other dv-posting spec.

## Deviations
- [Rule 3] Invalidation in POST /api/dynamic-view/materialize is done at the start and again after the CREATE (plan said after success only), to avoid a stale-cache window and cover early-return/dropStale paths; also invalidates on DELETE /api/dynamic-view/:id.
- Local noise: with dev `.env` DEFAULT_VIEW_TTL_MINUTES=3, the dv spec's `TTL = 5` assertion reddens (pre-existing, unrelated); passes with 5.

## Checkpoint note for 133-10
On the dv path the only statement sent before a rejection is the read-only column lookup (at most once per dv per TTL window); the materialize DDL is never sent. If the probe returns no columns (nothing cacheable), the guard rejects every column (fail-closed).

## Audit status / AISAFE-V20-01
Row 3 (dv path) is flipped to guarded. All fixable sites in 133-COLUMN-AUDIT.md are guarded; remaining items are the documented accepted residuals (a)-(d) and Tier C sites. Residual (a)'s "a dv probe could close it" now holds only for filter/materialize; export dv path and info/query on dv views remain regex-only. AISAFE-V20-01 is judged completable by 133-10 on that basis (I did not touch requirements docs).

## Self-Check: PASSED
Files and commits b3ca8ed, 0ebf5b9, 8172680 exist.
