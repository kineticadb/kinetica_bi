---
phase: 138-ai-filters
plan: 07
subsystem: web-ai-filter-ui
tags: [ai, filters, chat, chips, dev-harness]
requires: [138-03, 138-04, 138-05]
provides: [chat filterNotes + zero-row clear offer, AI tag at all chip sites, snapshot filters, DEV harness filter/clearFilter/highlight/filterState]
affects: [138-08]
key-files:
  modified:
    - packages/web/src/components/charts/AiChat.tsx
    - packages/web/src/components/charts/AiChat.spec.tsx
    - packages/web/src/lib/aiSession/chatText.ts
    - packages/web/src/lib/aiSession/chatText.spec.ts
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/lib/aiSession/devHarness.ts
    - packages/web/src/lib/aiSession/devHarness.spec.ts
  created:
    - packages/web/src/components/DashboardsPage.aiFilter.spec.tsx
requirements-completed: [AIACT-V20-09 (UI/harness part only; phase-level completion owned by 138-08)]
completed: 2026-10-15
---

# Phase 138 Plan 07: AI filter UI and DEV harness Summary

Chat renders client filter notes and a one-click "Clear this filter" for zero-row filters, filter tools have plain-word progress/skip copy, every column-chip site passes `aiApplied`, the ask snapshot carries current filters, and the DEV harness can drive filters, the outline and report filter state with no provider quota.

## Commits
- c754a90: chat filter notes, zero-row clear offer, filter tool copy (Task 1)
- 0675336: AI tag on every filter chip site, snapshot filters, baseline dv names (Task 2)
- a355614: DEV harness filter/clearFilter/highlight/filterState + tables getter wiring (Task 3)

## Red-first evidence (all behavioural)
- Task 1: CHATF-1 `expected [] to deeply equal ['Note one.','Note two.']`; CHATF-2 `Unable to find ... button "Clear the payment_type filter"`; CHATF-5 `expected 'x' to be 'Applying a filter…'` (3 failed, 16 passed). CHATF-3/4 pass before the change by design (absence / existing revert behaviour; CHATF-4 is a regression guard, non-discriminating).
- Task 2: DASHF-1..3 all failed with `expected undefined to be 'AI'` (3 failed).
- Task 3: stubbed the new harness members first (no-ops), then HARNF-1..7 failed on behaviour (applyTurn called 0 times, undefined warn, highlight ids [], help text missing). 7 failed, 16 passed. Then implemented; 23/23.

## Verification
- web tsc clean (after 138-06's transient applyAiTurn errors resolved; none were in my files).
- Full `vitest run --maxWorkers=4`: 239 files passed, 1 skipped, 1 failed; the single failure is `askRunner.spec.ts RUNF-1 (138-06)`, 138-06's in-progress spec in the shared tree, not touched by this plan. theme-guard 172 passed.
- No CSS changes (`git diff --stat` on styles and AiWidget.css empty). Only existing classes used (`ai-chat-note muted`, `ai-chat-turn-actions`, `ghost-sm`, `widget-filter-badge` via FilterChip).
- Acceptance greps: `aiApplied={f.aiApplied}` = 2, `aiApplied: f.aiApplied` = 2, `filters: useFilterStore.getState()` = 1, `dynamicViewNames:` = 1, `aiBaselineRef.current?.tables` = 1. Pre-checks were 0 before the work.

## Deviations from Plan
- Task 2 committed with the harness third argument deferred to Task 3 (the harness signature did not yet accept it; keeps each commit tsc-clean). The wiring landed in the Task 3 commit.
- CHATF-4 uses a clarification-bearing turn with an applied entry (stronger than a plain filter-only turn since `showRevert` hinges on `changedSomething`); it passed pre-change (non-discriminating regression guard).

## Not verified here (for 138-08 operator check)
- Legibility of the AI tag, chat notes and clear button in light and dark mode.
- Real zero-row clear offer and D-18 note wording in a live session; map tiles narrowing against real Kinetica (SC4).
- The harness's `filter()` result depends on 138-06's `applyTurn` routing through the filter path; confirm live.

## Self-Check: PASSED
All files exist; commits c754a90, 0675336, a355614 in git log.
