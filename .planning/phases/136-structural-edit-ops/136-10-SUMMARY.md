---
phase: 136-structural-edit-ops
plan: 10
subsystem: web-dashboard-page
tags: [layout, placement, baseline, ai-badge]
requires: [136-01, 136-03, 136-08]
provides:
  - "DashboardsPage layouts memo: derived.layout / drag geometry / config.layout / placeWidget gap-fill"
  - "Session baseline carries tables + maxBarGroupBySeriesCap"
  - "AI added / AI edited badge on WidgetCard (widget-filter-badge)"
key-files:
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.aiSession.spec.tsx
    - packages/web/src/components/WidgetCard.tsx
    - packages/web/src/components/WidgetCard.spec.tsx
completed: 2026-10-13
---

# Phase 136 Plan 10: Grid placement, baseline, AI badge

## Commits
- 9ccd748 Task 1: layouts memo, baseline tables/cap, DEFAULT_LAYER_CONFIG import
- 247fb2c Task 2: AI added / AI edited badge

## Evidence
- DPL6-1..5 added; AISESS-4 updated to `{0,24,36,36}`.
- DPL6-4 mutation: commenting out `tables:` in the baseline fails DPL6-4 only.
- DPL6-2 mutation: removing the `isAiEditLocked()` return in handleLayoutChange fails DPL6-2 and AISESS-3; reverted.
- UI6-1..3 red before implementation, green after.
- Gates: web vitest 4642 passed / 1 skipped; theme-guard 160/160; tsc clean for this plan's files (one error in 136-11's in-flight structuralOps.e2e.spec.ts, `controls` missing on WidgetActionStoreState; not fixed).

## Deviations
- DPL6-4 drives the turn via the dev harness `addWidget` (harness uses the page's own baseline) rather than a new harness method.
- `AISESS-4` expectation changed as the plan said.

## Non-discriminating criteria
- `grep -c "w: 18, h: 24" DashboardsPage.tsx = 0` cannot hold: 2 remain, (a) the `?? { w: 18, h: 24 }` fallback for unknown types in the layouts memo, (b) the pre-existing manual add-widget position at ~1187 (out of scope). The `FF3B82F6` literal is gone (0).
- `grep -c 'className="widget-filter-badge"' WidgetCard.tsx = 2` counts lines; both spans are on one line, so reads 1. Both exist (UI6-1/2 assert them).

## Needs 136-12 human check (not automatable)
- Gap-fill placement looks sensible and per-type sizes feel right in the real grid.
- "AI added" / "AI edited" badge legibility in light and dark, and header wrapping with long titles / other badges.
- AI set_layout moves animate/render correctly in the live grid.

## Self-Check: PASSED
