---
phase: 67-svg-calendar-renderer-read-only
plan: "03"
subsystem: frontend-chart
tags: [calendar, heatmap, wiring, widget-renderer, sole-materialize-trigger, static-invariant]
dependency_graph:
  requires: [67-02-CalendarRenderer, 66-03-calendar-placeholder-branch]
  provides: [WidgetRenderer-calendar-wiring, WidgetRenderer-spec-calendar]
  affects: [68-cell-drill-integration]
tech_stack:
  added: []
  patterns: [short-circuit-before-AggregatedWidgetRenderer, vi.mock-sentinel-pattern, static-source-grep-invariant]
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - "CalendarRenderer mock uses vi.mock sentinel (data-testid=calendar-renderer + data-tables-count) mirroring DataFilterRenderer pattern — avoids loading full fetch/SVG deps in WidgetRenderer spec"
  - "Static invariant asserts on import lines only (not whole source) — mirrors 67-02 decision and DataFilterRenderer.spec.tsx precedent; comments mentioning the names are OK"
  - "3 routing tests added (routes to CalendarRenderer, no AggregatedWidgetRenderer fallthrough, tables prop threaded) + 1 static invariant = 4 new tests"
metrics:
  duration: "3 minutes"
  completed: "2026-06-16"
  tasks: 2
  files: 2
---

# Phase 67 Plan 03: WidgetRenderer Wiring (CalendarRenderer) Summary

**One-liner:** WidgetRenderer.tsx calendar branch now renders `<CalendarRenderer widget tables />` (Phase 66 placeholder removed), with 4 new spec assertions confirming routing and the sole-materialize-trigger invariant.

## Tasks Completed

| Task | Name | Commits | Result |
|------|------|---------|--------|
| 1 | Replace calendar placeholder branch + add import | a871333 | tsc clean; import added; placeholder removed; branch ordering preserved |
| 2 | WidgetRenderer spec — routing + no-materialize-import invariant | 3e1da8a | 84/84 WidgetRenderer tests pass; full suite 2255/2255; tsc clean |

## Changes Made

### WidgetRenderer.tsx

- Added `import CalendarRenderer from "./CalendarRenderer";` alongside sibling renderer imports (line 9, mirrors TimelineRenderer pattern)
- Replaced the Phase 66 placeholder `<div>` body with `<CalendarRenderer widget={effectiveWidget} tables={tables} />`
- Updated the branch comment: notes Phase 67 renderer is live, sole-materialize-trigger note preserved
- Branch position unchanged: `effectiveWidget.type === "calendar"` appears before `body = <AggregatedWidgetRenderer ...>` fallthrough

### WidgetRenderer.spec.tsx

- `vi.mock("./CalendarRenderer", ...)` sentinel renders `data-testid="calendar-renderer"` + `data-widget-id` + `data-tables-count` (mirrors DataFilterRenderer mock at line 2193)
- `makeCalendarWidget()` factory: `type: "calendar"`, `config: { tableId: 7, tableRef: "demo.sales", timeCol: "ts" }`
- `renderCalendarInContext()` helper wraps in DashboardContextProvider (matches existing helper pattern)
- 4 new tests in `describe("WidgetRenderer Phase 67 — calendar short-circuit to CalendarRenderer (CAL-V113-04)")`:
  1. Routes to `<CalendarRenderer />` for `widget.type === 'calendar'`; old placeholder text absent; `widget-id` correct
  2. Calendar type does NOT fall through to AggregatedWidgetRenderer
  3. `tables` prop is threaded through (data-tables-count asserted)
  4. CalendarRenderer.tsx import lines do NOT contain `materializeFilter|dropFilterView` (static invariant)

## Verification

- `npx vitest run src/components/charts/WidgetRenderer.spec.tsx` — 84/84 pass
- `npx vitest run src/styles/theme-guard.spec.ts` — 50/50 pass
- `npx vitest run` — 2255/2255 (102 test files) pass
- `npx tsc --noEmit` — clean

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: packages/web/src/components/charts/WidgetRenderer.tsx (modified — CalendarRenderer import + branch wired)
- FOUND: packages/web/src/components/charts/WidgetRenderer.spec.tsx (modified — 4 new calendar tests)
- FOUND commit a871333 (Task 1 — import + placeholder replacement)
- FOUND commit 3e1da8a (Task 2 — spec routing + static invariant)
