---
phase: 138-ai-filters
plan: 06
subsystem: web-ai-filter-apply-path
tags: [ai, filters, apply, zero-rows, discard]
requires: [138-03, 138-05]
provides: [applyAiTurn, checkZeroRowFilters, readFirstCount]
affects: [138-07, 138-08]
key-files:
  created:
    - packages/web/src/lib/aiOps/applyAiTurn.ts
    - packages/web/src/lib/aiOps/applyAiTurn.spec.ts
    - packages/web/src/lib/aiOps/aiFilterZeroRows.ts
    - packages/web/src/lib/aiOps/aiFilterZeroRows.spec.ts
    - packages/web/src/hooks/useAiSessionActions.spec.ts
    - packages/web/src/components/AiDiscardDialog.spec.tsx
  modified:
    - packages/web/src/lib/aiSession/askRunner.ts
    - packages/web/src/lib/aiSession/askRunner.spec.ts
    - packages/web/src/hooks/useAiSessionActions.ts
    - packages/web/src/components/AiDiscardDialog.tsx
requirements-completed: [AIACT-V20-09 (apply-path wiring part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 06: One apply path for AI turns Summary

`applyAiTurn` is now the single apply path for real answers (askRunner) and harness turns (useAiSessionActions): it records the turn, runs applied filter ops through the click-path applier, attaches deltas, outlines changed plus narrowed widgets, writes value-bearing notes only to `TurnChat.filterNotes`, and starts a client-side zero-row COUNT. Discard (bar and harness) restores filters.

## Commits
- d8e12b6 feat(138-06) applyAiTurn (with a type-level stub of aiFilterZeroRows.ts so this commit is tsc-clean)
- 589587e feat(138-06) zero-row check over the combination view (D-17)
- 5060721 feat(138-06) wire askRunner, session actions and Discard

## Red-first evidence
- Task 1: stub `applyAiTurn` (only `store.applyTurn`) created first. Spec run: 11 failed / 1 passed, failing on behaviour (e.g. AAT-11 `expected [] to deeply equal [60]`, AAT-12 `expected [] to deeply equal [...]`, AAT-10 notes undefined). The one pass was AAT-2 (no AI-edited pill): a negative assertion that is true under the stub too, so it is non-discriminating on its own; AAT-1/3 cover the outline and notes. Then implemented: 12/12.
- Task 2: stub (no-op `checkZeroRowFilters`, `readFirstCount` returning undefined). Spec run: 5 failed (ZR-1, 2, 3, 9, 10) / 5 passed. The 5 passes (ZR-4..8) are negative "no note / no query" assertions that a no-op satisfies. ZR-5 was strengthened after the run (it first asserted on an already-emptied turn list, which was vacuous) to spy on `appendFilterNotes` after confirming the COUNT started. After implementing: 10/10.
- Task 3: specs written against the old wiring. Run: 4 failed, all behavioural: DISF-1 `expected 'Credit' to be 'Cash'`, ACTF-1 (filter not applied), ACTF-2 (`Cash` not restored vs Credit), RUNF-1 (no filterNotes). After wiring: 22/22 across askRunner, useAiSessionActions, AiDiscardDialog, AiChangeBar.

## Verification
- web tsc clean (including 138-07's files by the time of the final run).
- Full `vitest run --maxWorkers=4`: 241 passed, 1 skipped, 1 failed. The failure was in `WidgetRenderer.line.spec.tsx` and differed between runs (L132-7, then L132-12 on a re-run alongside theme-guard); the file passes in isolation (28/28). Treated as load-induced flake, unrelated to these changes.
- theme-guard: 172/172.
- Acceptance greps after: `export function applyAiTurn` 1; `AAT-` in spec 12+ ; `AAT-12` once; `skippedScoped` in applyAiTurn.ts 1; `appendFilterNotes` >= 1; `answer: |.answer =` in applyAiTurn.ts 0; `materializeFilter` in aiFilterZeroRows.ts 0; askRunner `setHighlight`/`effIds` 0; AiDiscardDialog and useAiSessionActions `reset()` 0.
- Pre-checks: `applyAiTurn|AAT-|checkZeroRowFilters|readFirstCount|ZR-1|RUNF-|ACTF-|DISF-` were 0 before. Non-discriminating criteria found: none in the greps; AAT-2 and ZR-4..8 are non-discriminating as RED probes only (explained above) and were covered by direct behavioural assertions elsewhere.

## Decisions / behaviour notes
- D-18 scoped count: counted only for apply ops that produced deltas, and only for vizs on the same source that are not in the op's narrowed set and whose effective cfg has `sourceMode` other than "all" (dv ignored when `dvFilterScopeDisabled`). No sourceWidgetId is ever stamped (AAT-12 asserts undefined).
- Narrowed set uses the dashboard AFTER the turn (removed widgets dropped, added widgets/layers included). Replacement and clear use the PRE map for the old filter object, so widened widgets are counted and outlined.
- `stillOn` lists up to 5 columns still filtered on any source and not touched by this turn, only when at least one apply/clear note exists.
- Zero-row check is skipped for table sources while any drawn shape exists (shapes fold into the table hash; documented in the file header).
- `checkZeroRows` call is wrapped so a mock returning undefined cannot throw.

## Deviations from Plan
- AAT-11 uses `setTitleOp` rather than a title configPatch (a configPatch title is not a real widget title edit).
- RUNF-1 mocks `aiFilterZeroRows` file-wide in askRunner.spec.ts; existing tests unaffected.
- Commit 1 includes a stub `aiFilterZeroRows.ts` (type exports) so each commit is tsc-clean; Task 2 replaces it.
- 138-07 commits landed between my commits; I staged only my own files by explicit path.

## Not verified here
- "No visible flash" and outline appearance, and the chat rendering of notes / clear offer (138-07 UI), need operator check in 138-08. The zero-row COUNT against real Kinetica is mocked everywhere (`runSql` injected).

## Self-Check: PASSED
