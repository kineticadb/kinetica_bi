---
phase: 95-on-widget-badge-indicator
plan: "01"
subsystem: frontend/filter-scope
tags: [badge, filter-scope, widget-header, pure-fn, tdd]
dependency_graph:
  requires:
    - 88-01 (resolveFilterSet)
    - 93.5-01 (resolveSpatialShapes)
    - 90-01 (filterCombinationStore NOT read — badge is locally computed)
  provides:
    - useFilterScopeSummary hook + computeFilterScopeSummary pure fn
    - WidgetFilterBadge component
    - .widget-filter-badge CSS class
  affects:
    - DashboardsPage widget header (non-map branch)
tech_stack:
  added: []
  patterns:
    - TDD (RED → GREEN per task)
    - Pure fn + thin hook separation (mirrors resolveFilterSet pattern)
    - SCOPED primitive-stable selectors (PITFALL S-02)
    - native title= attribute for hover breakdown (locked decision #5)
key_files:
  created:
    - packages/web/src/lib/useFilterScopeSummary.ts
    - packages/web/src/lib/useFilterScopeSummary.spec.ts
    - packages/web/src/components/WidgetFilterBadge.tsx
    - packages/web/src/components/WidgetFilterBadge.spec.tsx
  modified:
    - packages/web/src/styles/global.css
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx
decisions:
  - REUSED targetsByTable useMemo already in DashboardsPage (line 585) for spatialCapable flag — no duplicate useMemo added
  - computeFilterScopeSummary is pure (no stores) — unit-tested without React; hook wires it to live store reads
  - .widget-filter-badge CSS added BEFORE WidgetFilterBadge.tsx created (theme-guard SC4 requirement)
  - buildBreakdownTitle lives in WidgetFilterBadge.tsx (not in the hook file) per plan spec
metrics:
  duration: "~8 minutes"
  completed: "2026-06-29"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 3
---

# Phase 95 Plan 01: On-Widget Filter Badge Indicator Summary

**One-liner:** "N of M filters" pill badge using resolveFilterSet + resolveSpatialShapes reuse, accent-color tokens, and native title= hover breakdown.

## What Was Built

A per-widget "N of M filters" badge that appears in every non-map chart widget's header when ≥1 active filter is excluded by the widget's `filterSelection` allowlist config. Widgets with accept-all config (the default) show no badge — byte-identical to v1.17 (SC1).

### Task 1: Pure helper + hook

`computeFilterScopeSummary` is a pure function that:
- REUSES `resolveFilterSet` (Phase 88) for column filters — no reimplementation
- REUSES `resolveSpatialShapes` (Phase 93.5) for spatial shapes — no reimplementation
- Accepts `spatialCapable: boolean` so dv-bound and non-spatial-capable tables never count shapes in M
- Returns `{ appliedCount, totalCount, applied, ignored }` where each `IgnoredItem` carries `reason: "source excluded"`

`useFilterScopeSummary` is a thin React hook that wires SCOPED primitive-stable selectors (`filterVersion` + `spatialFilterVersion`) to drive re-renders, then reads arrays via `getState()` inside a `useMemo` (PITFALL S-02).

9 unit tests cover: accept-all, allowlist-exclude, object identity, spatial counted in M, spatial excluded from M, non-spatial-capable table (shapes not in M), dv-bound column-only, empty case, no-mutation.

### Task 2: WidgetFilterBadge + CSS

Step A (CSS first): `.widget-filter-badge` added to `global.css` immediately after `.widget-filtering-badge`, using only theme tokens (`var(--accent)`, `var(--accent-text)`, `var(--radius-sm)`, `var(--text-sm)`, `var(--space-2)`, `var(--font-weight-medium)`) — no raw hex. Theme-guard stays green.

Step B: `WidgetFilterBadge` renders null when `appliedCount >= totalCount` (SC1 guard), otherwise renders `<span className="widget-filter-badge" title={buildBreakdownTitle(summary)}>`. The `buildBreakdownTitle` pure fn (co-located in WidgetFilterBadge.tsx) produces a multi-line string: "Applied: {columns}" + "Ignored (source excluded): {columns/shapes}" (SC3).

6 spec tests: null on accept-all, null on 0-of-0, renders "2 of 3 filters", has `widget-filter-badge` class, title attr contains "source excluded", global.css contains `.widget-filter-badge`.

### Task 3: DashboardsPage integration

Imported `WidgetFilterBadge` and `FilterSelectionConfig` into DashboardsPage.tsx. In the non-map branch (next to `FilteringBadge`), mounts `<WidgetFilterBadge>` with `cfg`, `tableId`, `dynamicViewId`, and `spatialCapable` derived from the existing `targetsByTable` useMemo — no duplicate useMemo added.

Map widgets are entirely excluded from the badge (the `w.type === "map"` branch is untouched; COMM-V2-02 deferred).

2 integration tests added: allowlist-excluding widget shows badge; accept-all widget shows no badge.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | CLEAN |
| `npx vitest run` | 129/129 test files pass, 2968 tests |
| `npx vitest run src/styles/theme-guard.spec.ts` | 132/132 pass |
| `git diff --name-only packages/server` | EMPTY |
| `git diff --name-only \| grep package.json` | EMPTY |

## Success Criteria Verification

| Criteria | Status |
|----------|--------|
| SC1: accept-all widget → no badge (byte-identical) | PASS — `appliedCount >= totalCount` guard returns null |
| SC2: "{N} of {M} filters" with var(--accent)/var(--accent-text), no hex | PASS |
| SC3: hover breakdown applied + ignored + "source excluded" reason | PASS — native title= attribute |
| SC4: .widget-filter-badge in global.css before component use | PASS |
| Spatial draws count for spatial-capable table-bound widgets | PASS |
| Map widget never badged | PASS — excluded in non-map branch |
| Global top filter-bar unchanged | PASS — no filter-bar code touched |
| web vitest 100%; tsc clean; theme-guard green; zero server diff | PASS |

## Deviations from Plan

None — plan executed exactly as written.

The `targetsByTable` useMemo was already present in DashboardsPage at line 585 (pre-existing from Phase 30), so no new `useMemo` was needed — the plan's instruction to "place it near the existing widget-derived memos" was satisfied by reusing the existing memo.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | dfae4b9 | feat(95-01): pure computeFilterScopeSummary + useFilterScopeSummary hook |
| Task 2 | 17e506b | feat(95-01): WidgetFilterBadge component + .widget-filter-badge CSS class |
| Task 3 | 8e48b17 | feat(95-01): mount WidgetFilterBadge in widget header for non-map widgets |
