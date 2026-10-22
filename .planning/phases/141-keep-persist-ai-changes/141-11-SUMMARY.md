---
phase: 141-keep-persist-ai-changes
plan: 11
subsystem: web-ui
tags: [dialogs, keep, ai-session]
requires: [141-01, 141-04]
provides: [AiKeepDialog, AiKeepConflictDialog, leave-dialog Keep copy]
affects: [141-13]
key-files:
  created:
    - packages/web/src/components/AiKeepDialog.tsx
    - packages/web/src/components/AiKeepConflictDialog.tsx
    - packages/web/src/components/AiKeepDialogs.spec.tsx
  modified:
    - packages/web/src/components/AiLeaveDialog.tsx
    - packages/web/src/components/AiLeaveDialog.spec.tsx
decisions:
  - Leave dialog gates the "Keep them first" copy on raw dashboards:edit
gaps: []
requirements: [AISES-V20-05, AISES-V20-06]
completed: 2026-10-21
---

# Phase 141 Plan 11: Keep dialogs Summary

Portalled Keep confirm (D-09, with D-20 view-toggle note) and 409 conflict (D-08) dialogs copied from the AiDiscardDialog pattern, plus the leave dialog now telling only dashboards:edit users to Keep first.

## Commits
- 35d3ac2 feat(141-11): AiKeepDialog and AiKeepConflictDialog
- b48671a feat(141-11): leave dialog tells only editors to Keep first

## RED evidence
- Task 1 (stubs returning null): `Test Files 1 failed (1) / Tests 5 failed (5)`.
- Task 2: `x AIDLG-3 ... expected 'You have unsaved AI changesLeaving wi...' to contain 'Keep them first if you want to save them.'` -> `1 failed | 7 passed (8)`. AIDLG-8 passed in RED (old copy already contained the neutral sentence and no "Keep"); it is a regression guard for D-03, not a RED driver.

## GREEN
KDLG-1..5, AIDLG-1..8, DashboardsPage.aiLeave, theme-guard: all pass (181 and 191 tests); web tsc clean.

## Deviations
None to code. Criterion note: the plan's post-check `grep -c "not.toMatch(/Keep them first/)" AiLeaveDialog.spec.tsx = 0` cannot hold, because the plan-mandated AIDLG-8 itself contains that assertion (count is 1; the AIDLG-3 occurrence was removed). Real requirement verified directly. Seeded auth via existing `seedDesignerStore`/`seedAnalystStore` helpers; beforeEach resets auth store.

## Not auto-verifiable
Dialog centring/legibility in light and dark -> 141-14 human check.

## Self-Check: PASSED
