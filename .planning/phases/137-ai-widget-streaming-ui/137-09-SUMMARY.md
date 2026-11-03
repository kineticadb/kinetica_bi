---
phase: 137-ai-widget-streaming-ui
plan: 09
subsystem: web/aiSession
tags: [ai-widget, change-bar, discard, highlight]
requires: ["137-05", "137-07"]
provides:
  - AiChangeBar (component only; mounted by 137-11)
  - AiDiscardDialog (portalled confirm)
  - widget-card--ai-changed fading outline (nonce-keyed)
  - "AI edited" pill on maps whose layers the AI changed
affects: [137-11, 137-12]
key-files:
  created:
    - packages/web/src/components/AiChangeBar.tsx
    - packages/web/src/components/AiChangeBar.spec.tsx
    - packages/web/src/components/AiDiscardDialog.tsx
    - packages/web/src/components/WidgetCard.aiChanged.spec.tsx
  modified:
    - packages/web/src/components/WidgetCard.tsx
    - packages/web/src/styles/global.css
requirements: [AISES-V20-04, AIWID-V20-06]
metrics:
  tasks: 2
  completed: 2026-10-14
---

# Phase 137 Plan 09: Change bar, Discard confirm, fading outline Summary

Keep/Discard bar (Keep disabled until Phase 141), portalled Discard confirm that cancels any ask then resets, a 3 s fading accent outline on widgets changed by the latest answer, and the "AI edited" pill for maps whose layers changed.

## Commits
- Task 1: AiChangeBar, AiDiscardDialog, `.ai-change-bar*` CSS (see git log, "feat(137-09): AiChangeBar + portalled AiDiscardDialog")
- Task 2: WidgetCard highlight + selectShowsAiEditedPill + keyframes ("feat(137-09): fading AI-changed outline ...")

## Evidence
- Pre-checks (before work, all 0): AiChangeBar/AiDiscardDialog in src = no files; `ai-change-bar` in global.css = 0; `widget-card--ai-changed`/`HL-4` in src = none; `selectShowsAiEditedPill` in WidgetCard.tsx = 0.
- Red-first: HL-1..4 all failed before the WidgetCard change.
- Mutation proofs: removing the AI_HIGHLIGHT_MS `setTimeout` fails HL-2 and HL-3 (and HL-4 in that run, a fixture issue fixed before the commit); reverting the pill source to `aiEditedWidgetIds.has` fails HL-4.
- Gates: web `tsc --noEmit` clean; `vitest run --maxWorkers=4` 230 files passed, 1 skipped, 4729 tests passed; theme-guard 168 passed.
- Class resolution: every class used exists in global.css (ai-change-bar x3 rules, ds-actions, btn-primary, btn-sm, ghost-sm, ghost-danger, modal-*). `autoFocus` count in AiDiscardDialog = 0.
- `.widget-card` uses `box-shadow: var(--shadow)`, so the keyframes use `var(--shadow)` as planned.

## Deviations from Plan
None of substance. Spec fixtures adapted: BAR7-2 calls `approveRemoval()` first (removals of saved widgets are otherwise refused by the evaluator) and uses `setTitleOp` for the edit; HL-4 uses layers with `renderMode: "heatmap"` and `table_id: 1` so the patch is accepted.

## Operator visual check (137-12)
- Bar legibility and accent tint in light and dark; wraps cleanly on narrow widths.
- Disabled Keep tooltip visible on hover; "removed" dotted-underline hover lists names.
- Discard dialog appearance, focus on Cancel, Escape/backdrop close.
- Outline fade over ~3 s on changed widgets in light and dark; reduced-motion shows a steady ring.
- Map pill "AI edited" appears on a map when only its layer changed.

## Self-Check: PASSED
Created files exist; both task commits present in git log.
