---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 05
subsystem: server
tags: [ai-generate, lifecycle, sweeps, routes]
requires: [142-01, 142-02]
provides:
  - POST /api/dashboards/generate and POST /api/dashboards/:id/discard-generated
  - lib/aiGenerate.ts (create, one shared discard helper, boot/TTL/logout sweeps, AI_GENERATED_TTL_HOURS reader)
  - dropViewsForDashboard
affects: [142-09, 142-11]
key-files:
  created:
    - packages/server/src/lib/aiGenerate.ts
    - packages/server/src/aiGenerateRoutes.ts
    - packages/server/tests/lib.aiGenerate.spec.ts
    - packages/server/tests/routes.aiGenerate.spec.ts
    - packages/server/tests/boot.generatedSweep.spec.ts
  modified:
    - packages/server/src/lib/aiSessionViews.ts
    - packages/server/src/index.ts
    - packages/server/tests/lib.aiSessionViews.spec.ts
    - packages/server/tests/routes.versionStamp.spec.ts
requirements-completed: [AIGEN-V20-01, AIGEN-V20-02]
completed: 2026-10-23
gaps: []
---

# Phase 142 Plan 05: Generated-dashboard lifecycle Summary

Server-owned lifecycle of a generated dashboard: one transactional create (dashboard, table link, AI widget at {24,0,12,40}, pending marker; one per user, race-proof via the unique index), one `discardGeneratedDashboard` helper (drops AI session views as each session's user, bounded, then deletes rows in a transaction guarded by the pending flag; ai_audit rows stay) used by Discard, DELETE of a pending dashboard, logout, boot sweep and the hourly TTL sweep (`AI_GENERATED_TTL_HOURS`, default 24, 0 = off).

## Commits
- ef04ff3: dropViewsForDashboard + aiGenerate.ts lifecycle helpers (Task 1)
- c274a3b: routes, DELETE/logout/boot/hourly wiring in index.ts, versionStamp classification (Tasks 2 and 3 code)
- 73a0898: boot.generatedSweep.spec.ts wiring guards (Task 3)

## RED runs
- Task 1 (lib.aiGenerate): the impl and REGV-D specs were written in the same step, so REGV-D1..3 were not observed red separately (they exercise a new export that did not exist, so they would have failed on import). GENLIFE specs were not run before aiGenerate.ts existed either.
- Task 2/3: with specs written and no implementation, 11 of 12 failed (GENSWEEP-1..3, GENROUTE-1..8). GENROUTE-9 passed pre-implementation (logout never fails trivially when nothing runs); it only becomes a real guard once discardPendingForUser is wired, which GENROUTE-8 proves.

## Verification
Sequential targeted run: lib.aiSessionViews, lib.aiGenerate, routes.aiGenerate, routes.versionStamp (VSTAMP-8 green with the two exempt entries), boot.generatedSweep, routes.aiDv.lifecycle, routes.generatedVisibility, plus routes.dashboard-access: all green (56 tests in the 7-file run). `npx tsc --noEmit` clean. `tests/bootstrap.spec.ts`: the AIDV-boot / AIAUDIT-boot tests pass; 5 failures are the known OIDC set (TD-V11-04).

## Deviations from Plan
- Tasks 2 and 3 both edit index.ts; its edits were made in one pass and committed together in c274a3b (only the boot spec is in the Task 3 commit).
- GENLIFE-3: the race is simulated by inserting the conflicting row inside the transaction (spying on `db.prepare`), so that row rolls back with the transaction; the test asserts a `GeneratePendingError` is thrown (no raw SqliteError) rather than the racing row surviving.
- List/widget GET responses are wrapped as `{ data: [...] }`; specs assert on `.body.data`.
- Explicit `requireAuth` added in the route registrations although `/api` already has a global `requireAuth` (harmless, matches the plan).

## Non-discriminating criteria
- GENROUTE-9 (see RED runs) is weak on its own; its value comes from GENROUTE-8 plus the spy.
- GENSWEEP-1 initially failed on an incidental `app.listen` in a comment and the first `NODE_ENV` gate match; fixed the test anchors (`app.listen(port`, last gate occurrence), not the code.

## Self-Check: PASSED
Files and commits ef04ff3, c274a3b, 73a0898 verified present.
