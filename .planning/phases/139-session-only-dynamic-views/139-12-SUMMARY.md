---
phase: 139-session-only-dynamic-views
plan: 12
subsystem: web
tags: [ai, dynamic-view, dashboards-page, filter-ui]
requires: [139-08, 139-09, 139-11]
provides:
  - DashboardsPage feeds toSessionDvRows into the chain's single merge point
  - saved-only AI baseline with dynamicViewSources/dynamicViewColumns
  - ask snapshot dv fields (baseTableId, aggregated, columns)
  - id>0 guard on saved-dv DROP loops (page cleanup + App UNAUTHORIZED)
  - "AI" tag (existing widget-filter-badge) on AI view names in top bar + filter panel
  - AiChangeBar savedDynamicViews prop
affects: [139-13, 139-14]
key-files:
  created:
    - packages/web/src/components/DashboardsPage.aiDv.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/App.tsx
    - packages/web/src/App.spec.tsx
    - packages/web/src/components/FilterPanel.tsx
    - packages/web/src/components/FilterPanel.spec.tsx
    - packages/web/src/components/AiChangeBar.tsx
    - packages/web/src/components/AiChangeBar.spec.tsx
key-decisions:
  - "normalizeDvColumns is a module-local helper in DashboardsPage (accepts parsed array or JSON string)"
  - "No CSS touched; the AI tag reuses widget-filter-badge"
requirements-completed: [AIACT-V20-07, AIACT-V20-08, AISAFE-V20-06]
completed: 2026-10-20
---

# Phase 139 Plan 12: Dashboard wiring for AI views Summary

AI session views now flow through the dashboard's one dynamic-view list (context, orchestrator, renderers), session-removed saved views leave it, the AI baseline stays saved-only, and the saved-dv DROP loops skip negative ids.

## Commits
- 2e56b91: Task 1 `feat(139-12): wire AI views into DashboardsPage merge point, saved-only baseline, id>0 DROP guards`
- 0f3da8d: Task 2 `feat(139-12): AI tag on AI view names in filter UI and change-bar view counts (D-20)`

## Red-first record
- Task 1: DPDV-1..5 and APPDV-UA-1 run before implementation: 6 failed (5 DPDV + APPDV-UA-1; the DPDV-2 failure was `dynamicViewSources` undefined, the rest timed out waiting on the AI view reaching the list/chain). After: 5/5 DPDV green; DashboardsPage.spec, aiSession spec and App.spec green unchanged. One test-side fix: DPDV-5 seeds saved view 90's materialized entry directly, because a capped saved view with no filter takes the over_threshold fast-path in the chain.
- Task 2: UIDV-1, UIDV-2, UIDV-3 run before implementation: 3 failed (null badge, no AI tag, null title). After: 32/32 in the three files.

## Verification
- Ran only my named specs with `--maxWorkers=4` (per orchestrator; full web vitest is 139-14's): FilterPanel, AiChangeBar, DashboardsPage (aiDv, base, aiFilter, aiWidget, aiLock), App, theme-guard: all green (281 tests in the last batch, plus App/aiSession earlier).
- `npx tsc --noEmit`: clean for my files. One error remains in `src/lib/aiSession/devHarness.spec.ts(461)` (implicit any); that file belongs to the parallel 139-13 agent, not touched here. Earlier a `WidgetRenderer.aiDv.spec.tsx` error (also 139-13) had cleared by the next run.
- No CSS file changed (`git diff --name-only` over the plan's commits for `*.css` is empty).
- Acceptance greps after: `toSessionDvRows(` 1, `useDynamicViewMaterializeChain(dashboard.id, widgets, sessionDvRows` 1, `dvId > 0` 1 in DashboardsPage and 1 in App.

## Deviations from Plan
None functionally. The plan's full web gate was narrowed to the plan's own specs by the orchestrator override.

## Notes for UAT (139-14)
- D-20 "Dynamic Views list" item: the Dynamic Views modal button is disabled while AI changes are unsaved (134 D-08 lock), so the modal cannot list AI views during a session. Satisfied by the lock (nothing to label). Operator to confirm.
- The AI badge's alignment/legibility next to the dv name (top bar and panel header, light and dark) is not machine-verifiable; no layout CSS was added, so check visually.
- Carry-over from 139-11: the orchestrator dv key does not include the AI generation; exercise filter + undo + redo on an AI view.

## Self-Check: PASSED
DashboardsPage.aiDv.spec.tsx exists; commits 2e56b91 and 0f3da8d present on branch.
