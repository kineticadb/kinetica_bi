---
phase: 26-server-spatial-where
plan: 2
subsystem: api
tags: [kinetica, spatial, sql, where-clause, typescript, express, vitest]

# Dependency graph
requires:
  - phase: 26-server-spatial-where
    provides: spatialWhereClause.ts with composeWhereClause + SpatialFilter/SpatialTarget types (Plan 01)
  - phase: 13-spikes-and-endpoint
    provides: POST /api/filter/materialize handler (v1.3 contract, index.ts:684)
provides:
  - Extended POST /api/filter/materialize accepting { filters, spatialFilters?, spatialTarget? }
  - 5-step validation chain with WKB 501 early-return before builder call
  - composeWhereClause call replacing buildServerWhereClause in materialize handler
  - Backward-compatible with v1.3 filters-only callers (23/23 spec still green)
affects:
  - 26-03-supertest-coverage (adds spatial scenario supertests against this endpoint)
  - 30-materialize-trigger-wiring (Phase 30 client sends spatialFilters + spatialTarget in body)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "5-step validation chain: dashboardId/tableId numeric → empty-input 400 → pair-completeness 400 → tableId mismatch 400 → WKB 501"
    - "WKB 501 early-return BEFORE composeWhereClause call — mirrors Phase 18 intent at index.ts:776-783"
    - "Defensive null coercion: filtersArr = Array.isArray(filters) ? filters : [] handles explicit null from callers"
    - "spatialTarget ?? null passed as third arg to composeWhereClause — explicit null-vs-missing distinction"

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/index.ts

key-decisions:
  - "WKB 501 fires BEFORE composeWhereClause call — static guarantee that throwing stub in spatialWhereClause.ts is unreachable from production traffic; mirroring Phase 18 intent comments"
  - "Empty-input 400 only fires when BOTH column AND spatial absent — backward compat lock; v1.3 filters-only callers still pass through unchanged"
  - "Pair-completeness check placed AFTER empty-input check — empty-input 400 takes priority when both sides are missing"
  - "buildServerWhereClause import retained in index.ts — still used in the persisted-view endpoint (lines 641-642); only the materialize handler call site was replaced"

patterns-established:
  - "V15-P-07: composeWhereClause receives spatialFilters ?? [] and spatialTarget ?? null — caller normalises before builder call"
  - "Audit-log op: 'MATERIALIZE' unchanged — spatial WHERE is a different clause, same operation class"

requirements-completed:
  - WHERE-V15-03

# Metrics
duration: 2min
completed: 2026-05-12
---

# Phase 26 Plan 2: Materialize Endpoint Summary

**`POST /api/filter/materialize` extended with spatialFilters + spatialTarget body fields, 5-step validation chain (WKB 501 before builder), and composeWhereClause replacing buildServerWhereClause**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-12T14:43:37Z
- **Completed:** 2026-05-12T14:44:51Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Extended `kinetica_bi/server/src/index.ts` POST /api/filter/materialize handler (lines 685-776) with spatial body fields and 5-step validation
- Import added: `composeWhereClause`, `SpatialFilter`, `SpatialTarget` from `./lib/spatialWhereClause`
- 5-step validation chain implemented with exact error messages locked in 26-CONTEXT.md
- WKB 501 early-return fires BEFORE composeWhereClause call with exact Phase 18 body: `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }`
- 23/23 v1.3 routes.filter-materialize.spec.ts still green (backward compat preserved)
- 17/17 lib.spatialWhereClause.spec.ts still green (no regression)
- tsc --noEmit clean

## Task Commits

1. **Task 1: Extend POST /api/filter/materialize handler body parsing + 5-step validation + composeWhereClause call** - `0284b55` (feat)

**Plan metadata:** (see below)

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` — Extended POST /api/filter/materialize handler at lines 685-776; import added at line 18

## Modified Handler Location

- **POST /api/filter/materialize handler:** `index.ts:685-776` (lines 685-776)
- **DELETE handler unchanged:** `index.ts:778-800` (byte-for-byte as before)

## Validation Chain (5 steps with exact error messages)

| Step | Check | HTTP Status | Error Message |
|------|-------|-------------|---------------|
| 1 | `typeof dashboardId !== "number"` OR `typeof tableId !== "number"` | 400 | `"dashboardId and tableId are required numbers."` |
| 2 | `!hasFilters && (!hasSpatial \|\| !spatialTarget)` (both absent) | 400 | `"filters or (spatialFilters + spatialTarget) must be non-empty (use DELETE to clear)."` |
| 3a | `hasSpatial && !spatialTarget` | 400 | `"spatialTarget is required when spatialFilters are provided."` |
| 3b | `spatialTarget && !hasSpatial` | 400 | `"spatialFilters are required when spatialTarget is provided."` |
| 4 | `spatialTarget.tableId !== tableId` | 400 | `"spatialTarget.tableId must match body.tableId."` |
| 5 | `spatialTarget?.spatialMode === "wkb"` | 501 | `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }` |

## 501 Body Shape (verbatim Phase 18 contract)

```json
{ "error": "WKB mode deferred", "td": "TD-V14-WKB-SPIKE" }
```

## Test Results

- `lib.spatialWhereClause.spec.ts`: **17/17 green** (Plan 01 spec — no regression)
- `routes.filter-materialize.spec.ts`: **23/23 green** (v1.3 backward compat preserved)
- `npx tsc --noEmit`: **exit 0** (no TypeScript errors)

## Decisions Made

- **WKB 501 fires BEFORE composeWhereClause:** The endpoint short-circuits at step 5 before invoking the builder. The throwing stub in `spatialWhereClause.ts` is a static guarantee that the WKB code path cannot silently produce SQL — not a runtime error path in production. Mirrors Phase 18 intent at `index.ts:776-783`.

- **Empty-input backward compat:** Step 2 only fires when BOTH column AND spatial are absent. A v1.3 caller sending `{ filters: [...] }` still receives 200 — only callers with truly empty/absent both are rejected. This is a deliberate change from the old single `!Array.isArray(filters) || filters.length === 0` check.

- **`buildServerWhereClause` import retained:** The import at line 17 still exists in `index.ts` because it is referenced by the persisted-view endpoint earlier in the file (the v1.3 persisted-view handler around line 641). Only the materialize-route call site was replaced by `composeWhereClause`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — both edits applied cleanly, TypeScript compiled without errors, and all specs passed on first attempt.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `POST /api/filter/materialize` is ready for Plan 03 (supertest coverage) to assert all 5 validation cases plus spatial/combined/column-only/WKB scenarios
- WHERE-V15-03 requirement satisfied: endpoint accepts `{ filters, spatialFilters?, spatialTarget? }`, builds combined WHERE via `composeWhereClause`, WKB returns 501 BEFORE builder call
- Phase 30 contract locked: body shape `{ dashboardId, tableId, filters, spatialFilters?, spatialTarget? }` is stable

---
*Phase: 26-server-spatial-where*
*Completed: 2026-05-12*
