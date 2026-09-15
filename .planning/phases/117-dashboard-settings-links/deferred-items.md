# Deferred Items — Phase 117

Out-of-scope discoveries logged per the executor's deviation-rules scope boundary. Not fixed by
this phase; not caused by this phase's changes.

## Pre-existing parallel-scheduling test contamination (2 files, 5 tests)

**Found during:** 117-01, full-suite verification run (`npx vitest run`, full repo).

Two spec files fail ONLY under the full parallel `npx vitest run`, and pass 100% in isolation:

- `src/components/DatasetsPage.spec.tsx` — 1 failure ("renders a 'Format columns' button on the
  TableDetail screen")
- `src/components/charts/actionEngine.canary.spec.tsx` — 4 failures (all 4 CANARY cases: A1, A3,
  B1, C1)

Verified neither file imports `lib/dashboardUrl.ts` or `lib/tableUrl.ts`
(`grep -n "dashboardUrl\|tableUrl"` on both files returns no matches), and re-running
`npx vitest run src/components/DatasetsPage.spec.tsx src/components/charts/actionEngine.canary.spec.tsx`
in isolation passes 15/15. This is the same class of issue as the repo's known
"Web vitest parallel fake-timer leak" (cross-file contamination under parallel scheduling that
passes in isolation/sequential) — out of scope for this plan's task-related files.

**Action:** none taken. Logged here rather than fixed, per the executor's scope boundary
("Only auto-fix issues DIRECTLY caused by the current task's changes").
