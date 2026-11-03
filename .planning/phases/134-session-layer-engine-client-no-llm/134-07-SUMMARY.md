---
phase: 134-session-layer-engine-client-no-llm
plan: 07
subsystem: web/DashboardsPage
tags: [session-layer, edit-lock]
requires: [134-03, 134-05]
provides: [AI edit lock on the open dashboard]
key-files:
  created:
    - packages/web/src/components/DashboardsPage.aiLock.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx
requirements: [AISES-V20-01, AISES-V20-07]
completed: 2026-10-12
---

# Phase 134 Plan 07: Edit lock Summary

One lock source (`useAiEditLock`) is AND-ed into the four permission consts (`rawCanX && !editLocked`); toolbar buttons stay visible but disabled with the "Keep or discard the AI changes first" tooltip, a `config-hint` role=status notice shows while locked, every persisting handler returns early, and modals open at lock time are closed.

## Commits
- 492ff89 test: paired AILOCK specs (red)
- 7bac904 feat: lock wiring

## Red/green record
Against unmodified page: AILOCK-1..5, 6, 7, 8, 9a, 9b, 10 RED (11 failed, each failing at the locked half; unlocked halves reached first and passed); AILOCK-NEG-1, NEG-2, NEG-3 GREEN. After: 14/14 green; DashboardsPage.* + theme-guard 7 files / 307 tests; tsc clean; full web suite 211 files / 4518 tests pass, 1 skipped, no timeouts.

Notes: AILOCK-1..5 are one parameterized block (5 tests). AILOCK-9 is split 9a/9b; AILOCK-1..5 each assert the modal title via `.modal-title` text. During red, failing getByRole/queries print a huge DOM, so red runs needed `--testTimeout=90000` to show the real assertion rather than a 5 s timeout; green runs are fast.

## Acceptance
- Pre-checks: `AILOCK-` 0 in packages/web/src; `rawCanEdit`, `Keep or discard...` 0 in DashboardsPage.tsx before.
- After: `rawCanEdit && !editLocked` 1; `if (isAiEditLocked()) return` 15 (>=14); tooltip string 1 (a `LOCK_TOOLTIP` const used by all five buttons).
- The handler guards are structural belt-and-braces; behavioural proof is AILOCK-1..9 (buttons, controls, modals). The greps do not prove behaviour. I did not mutation-test individual handler guards (no UI route reaches them while locked, by design).

## Deviations
1. NEG-2 first used `show_popup` on a `records` widget; the action allow-list rejects that (`records` only allows `page_size`), so the dispatch was silently skipped (toast only) even unlocked. Fixed the fixture to `page_size`. NEG-3 uses the existing filter-chip dismiss pattern ("Remove filter zone") rather than an add-filter control.
2. No `useAiEditLock` guard was added to `flushPendingPatches` (intentional, per plan).
3. `handleLayerCreate`/auto-create effect: guarded in both places (effect guard is redundant with the handler guard, harmless).

## Human-only (for 134-09)
Visual look of the disabled toolbar buttons and the notice (CSS reuse of `btn-primary:disabled`, `config-hint`); whether the notice crowds the toolbar at narrow widths.

## Self-Check: PASSED
