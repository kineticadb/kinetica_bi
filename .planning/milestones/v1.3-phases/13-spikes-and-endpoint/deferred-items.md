# Phase 13 — Deferred Items

Items discovered during plan execution that are out-of-scope for the current plan.

## Discovered during Plan 13-02 (view-utils)

### Pre-existing test-suite failures in `kinetica_bi/server/`

**Discovered:** 2026-05-06 during Plan 13-02 final verification.

**What:** Running `cd kinetica_bi/server && npm test` reports 104 failing tests across 12 spec files (e.g. `routes.wms.spec.ts`, `routes.materialize.spec.ts`, `routes.sql.spec.ts`, `kinetica.audit.spec.ts`). The same failures reproduce on commit `97e893e` (the commit BEFORE Plan 13-02 began), confirming they are pre-existing — NOT caused by the new `src/lib/viewNaming.ts` and `src/lib/whereClause.ts` modules.

**Why deferred:** The new pure modules have zero imports from any of the failing files; they cannot have caused the regressions. Plan 13-02's scope was strictly the two pure utility modules. Per GSD execute-plan SCOPE BOUNDARY, pre-existing failures in unrelated files are out-of-scope.

**New-spec status:** All 30 tests in `lib.viewNaming.spec.ts` (14) + `lib.whereClause.spec.ts` (16) PASS, and `npx tsc --noEmit` is clean.

**Recommended follow-up:** Triage the 104 pre-existing failures separately (likely a stale-mock or env-stub regression introduced before Plan 13-01). Plan 13-03 supertest coverage may surface or resolve some of these as part of its endpoint integration work.
