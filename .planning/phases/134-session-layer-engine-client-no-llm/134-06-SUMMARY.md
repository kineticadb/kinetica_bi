---
phase: 134-session-layer-engine-client-no-llm
plan: 06
subsystem: web/leave-guard
tags: [session-layer, leave-guard, dialog]
requires: [134-03]
provides: [requestLeave, AiLeaveDialog]
key-files:
  created:
    - packages/web/src/lib/aiLeaveGuard.ts
    - packages/web/src/lib/aiLeaveGuard.spec.ts
    - packages/web/src/components/AiLeaveDialog.tsx
    - packages/web/src/components/AiLeaveDialog.spec.tsx
    - packages/web/src/App.aiLeave.spec.tsx
  modified:
    - packages/web/src/App.tsx
requirements: [AISES-V20-07]
completed: 2026-10-12
---

# Phase 134 Plan 06: AI leave guard Summary

`requestLeave(proceed)` plus a portalled "You have unsaved AI changes" dialog, wired into every App.tsx leave path (sidebar, profile, onboarding banner, exports event) with an unconditional AI-session reset in the logout/401 chain.

## Commits
- f9787d0 test: failing guard + dialog specs (red: modules missing)
- 4000c2f feat: guard + dialog
- test: failing App specs (red: AIAPP-1 green control, AIAPP-2..5 red, 4 failed / 1 passed)
- feat: App wiring

## Evidence
- tsc clean; AIDLG + theme-guard green; App*.spec (8 files, 124 tests) green.
- Greps: requestLeave( in App.tsx = 4; <AiLeaveDialog = 1; AI reset = 1 = map-view reset = 1 (single logout chain). Pre-checks were 0.
- className strings in AiLeaveDialog.tsx with global.css rule lines: modal-overlay 825, modal-content 834, modal-header 849, modal-title 857, modal-body 863, ds-actions 953, btn-primary 1094 + btn-sm 1116, ghost-sm 993, ghost-danger 1008. No hex, no new classes.

## Deviations / notes
- Topbar is mocked in App specs, so the profile link and onboarding-banner link wrappers (same requestLeave pattern) are verified by grep/tsc only, not by a runtime spec; the plan's AIAPP set did not cover them.
- Discard and Stay both live in .modal-body's ds-actions (no footer class exists); the dialog has no header Close button.
- Not automatically verifiable: visual look of the dialog (route to 134-09 human check).

## Self-Check: PASSED
