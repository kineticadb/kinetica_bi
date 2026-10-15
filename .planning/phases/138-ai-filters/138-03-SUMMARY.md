---
phase: 138-ai-filters
plan: 03
subsystem: web-session-layer
tags: [ai, filters, session, fold, store]
requires: [138-01]
provides: [isFilterOp, FilterDelta, setAiFilterSink, attachEntryFilterDeltas, appendFilterNotes, value-free ask snapshot filters]
affects: [138-05, 138-06, 138-07]
key-files:
  modified:
    - packages/web/src/lib/aiSession/types.ts
    - packages/web/src/lib/aiSession/foldSession.ts
    - packages/web/src/lib/aiSession/foldSession.spec.ts
    - packages/web/src/store/aiSessionStore.ts
    - packages/web/src/components/AiChangeBar.spec.tsx
    - packages/web/src/lib/aiSession/buildAskRequest.ts
    - packages/web/src/lib/aiSession/buildAskRequest.spec.ts
    - packages/web/src/test/aiSessionHarness.ts
  created:
    - packages/web/src/store/aiSessionStore.filter.spec.ts
requirements-completed: [AIACT-V20-09 (session-layer part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 03: Session layer for filter ops Summary

The client session layer now evaluates filter ops purely (column, source and 25-cap checks against apply-time filter state), ignores them for lock, bar and leave warning, carries per-entry filter deltas through the squash, announces cursor moves to a registered filter sink, and sends value-free filter state in the ask snapshot.

## Commits
- b33e5e0: types, fold evaluation, isFilterOp, harness builders, FOLDF-1..8 (Task 1)
- Task 2 commit: store lock selector, deltas/notes setters, setAiFilterSink + cursor notification, LOCKF-1..6, LOCKF-8
- fix commit: LOCKF-2 call signature (computeChangeCounts takes `{widgets, layers}`); the Task 2 commit carried a tsc error that the fix removes
- Task 3 commit: buildAskSnapshot filters, SNAPF-1..4

## Verification
- web tsc clean; full `vitest run --maxWorkers=4`: 234 files passed, 1 skipped, 4786 tests; theme-guard 172 pass; decoupling spec green.
- Banned decoupling strings: 0 in foldSession.ts and aiSessionStore.ts. `.value` count in buildAskRequest.ts: 0.

## Deviations from Plan
- Red-first was NOT strictly followed: implementation was written before the specs in Tasks 1-3 (no failing run captured). Discrimination checked by reasoning instead (e.g. FOLDF-8 would be skipped if prior entries seeded the cap; LOCKF-1 would fail with the old isApplied).
- Task 2 commit contained a tsc error in LOCKF-2 (wrong computeChangeCounts arity; a failed sed on macOS masked it); fixed in a follow-up commit.
- LOCKF-8 asserts `container.innerHTML === ""` rather than role query.
- Non-discriminating criteria: none found; plan pre-checks held.

## Notes for downstream
- `evaluateTurn` does not replay prior filter entries; callers (138-05/07) must pass `TurnInput.currentFilters` read from filterStore at apply time.
- Sink fires after state is set; `reset()` deliberately does not notify it.

## Self-Check: PASSED
