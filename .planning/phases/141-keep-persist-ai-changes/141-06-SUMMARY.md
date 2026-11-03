---
phase: 141-keep-persist-ai-changes
plan: 06
subsystem: server
tags: [keep, transaction, sqlite, atomicity]
requires: [141-01, 141-02, 141-03]
provides: [applyKeep, KeepConflict, KeepInvalid, KeepPreparedInput, KeepApplied]
affects: [141-07, 141-12]
key-files:
  created:
    - packages/server/src/lib/aiKeepApply.ts
    - packages/server/tests/lib.aiKeepApply.spec.ts
    - packages/server/tests/lib.aiKeepApply.atomic.spec.ts
    - packages/server/tests/helpers/aiKeepFixture.ts
gaps: []
requirements: [AISES-V20-05, AISES-V20-06]
completed: 2026-10-21
---

# Phase 141 Plan 06: applyKeep Summary

One synchronous better-sqlite3 transaction that version-checks, creates dv -> layer -> widget placeholders, rewrites temp ids, merges edits, removes last, and rolls back every state table on any failure.

## Commits
- 1417aba feat: applyKeep + KEEP-APPLY-1..10
- 2891ec3 test: KEEP-ATOMIC injected-failure proofs

## RED evidence
- Task 1: stub applyKeep -> `Tests 9 failed (9)` (Error: stub). The fetch-spy check (KEEP-APPLY-10) runs as an afterEach on every test.
- Task 2 discrimination (transaction temporarily replaced by a plain function call, restored, never committed): `Tests 5 failed | 1 passed (6)`. Failed: KEEP-ATOMIC-mid, -pass2, -late (snapshot), -late (W1 unchanged), -retry. KEEP-ATOMIC-first passes without a transaction by construction (nothing is written before the first create); it still guards the version bump and snapshot.
- GREEN: aiKeepApply.spec + atomic.spec + lib.dashboardImport.apply.spec = 39/39 pass (--maxWorkers=2). tsc: no errors in my files.

## Deviations
- [Rule 3] Shared fixture lives in `tests/helpers/aiKeepFixture.ts` (not in the plan's file list) because importing one spec from another would re-run its tests.
- Criterion `grep -c "remapTempRefs(" >= 2` reads 1: both uses go through one local `remap` wrapper that converts UnmappedTempRefError to KeepInvalid. The criterion was structural, not behavioural; behaviour is proven by KEEP-APPLY-2/8. No code changed to satisfy it.
- `tsc --noEmit` shows errors in `src/index.ts` (lines ~1883+), owned by another parallel wave-2 plan; none in aiKeep files.

## Self-Check: PASSED
Files and commits 1417aba, 2891ec3 exist.
