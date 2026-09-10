---
phase: 93-filter-scope-config-ui
plan: "01"
subsystem: filter-scope-config-ui
tags: [filter-scope, config-ui, chart-config, tdd, frontend-only]
dependency_graph:
  requires: [phase-88-foundation, phase-89-stores, phase-90-orchestrator, phase-91-widget-wiring, phase-92-map-wiring]
  provides: [FilterSelectionPanel, filterSourceTypes, SPATIAL_DRAWS_SENTINEL, ChartConfigPanel-filterSelection]
  affects: [ChartConfigPanel, DashboardsPage, WidgetConfigModal, filterSelection-type]
tech_stack:
  added: []
  patterns: [tdd-red-green, config-group-section, config-toggle-checklist, spatial-sentinel-store-only]
key_files:
  created:
    - packages/web/src/components/charts/filterSourceTypes.ts
    - packages/web/src/components/charts/FilterSelectionPanel.tsx
    - packages/web/src/components/charts/FilterSelectionPanel.spec.tsx
  modified:
    - packages/web/src/types/filterSelection.ts
    - packages/web/src/components/charts/ChartConfigPanel.tsx
    - packages/web/src/components/DashboardsPage.tsx
decisions:
  - "records type intentionally excluded from FILTER_PRODUCING_TYPES — it is a filter TARGET (receives drill-downs), never a SOURCE"
  - "allowedSourceWidgetIds widened to (number|string)[] for backward-compatible spatial sentinel storage"
  - "SPATIAL_DRAWS_SENTINEL stored in config only (Phase 93); resolver logic deferred to Phase 93.5"
  - "FilterSelectionPanel is pure presentational — no store reads; all state via props"
  - "widgetId threaded as optional so all existing ChartConfigPanel call sites compile unchanged"
metrics:
  duration_seconds: 300
  completed_date: "2026-06-28"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 3
---

# Phase 93 Plan 01: FilterSelectionPanel + filterSourceTypes + ChartConfigPanel Integration Summary

**One-liner:** Shared FilterSelectionPanel component with spatial-draws sentinel + FILTER_PRODUCING_TYPES enumeration (records excluded) integrated into ChartConfigPanel via widgetId self-exclusion threading.

---

## What Was Built

### filterSourceTypes.ts

Explicit enumeration of widget types that actively produce filter events:

```typescript
export const FILTER_PRODUCING_TYPES = new Set([
  "bar", "line", "pie", "scatter", "table",
  "datafilter", "calendar", "timeline", "numericline",
]);
```

**`records` is intentionally excluded.** Research confirmed that `records` has `supportsDrillDown: true` in the registry, but this flag describes its capability as a TARGET (it receives drill-down filters to restrict rows), not as a SOURCE. `records` never emits `ActiveFilter` entries with a `sourceWidgetId`.

**SPATIAL_DRAWS_SENTINEL = `"__spatial_draws__"`** — reserved non-widget id. Phase 93 STORES this in `allowedSourceWidgetIds` only; Phase 93.5's resolver branches on the string vs numeric ids to gate spatial shapes.

### filterSelection.ts (type widening)

`allowedSourceWidgetIds` widened from `number[]` to `(number | string)[]`. Backward-compatible: existing numeric ids remain valid. `DEFAULT_FILTER_SELECTION` unchanged (still `[]`).

### FilterSelectionPanel.tsx — Prop contract (for Plan 02 reuse)

```typescript
type FilterSelectionPanelProps = {
  value: FilterSelectionConfig | undefined;       // undefined = accept-all default
  onChange: (next: FilterSelectionConfig | undefined) => void;
  widgets: WidgetDto[];                           // full dashboard list; filtered internally
  selfWidgetId?: number;                          // chart widgets pass this; layers omit (Plan 02)
};
```

**Rendering behavior:**
- `value === undefined`: unchecked Customize toggle + "Accept all filters" hint; no checklist
- `value.sourceMode === "allowlist"`: checked Customize + source checklist (filter-producing types only, self excluded) + always-present Spatial draws (map) sentinel row
- Accept-none warning: shown when no live widget source AND no sentinel is checked
- Orphan warning: per numeric id in `allowedSourceWidgetIds` not present in `widgets` (sentinel never flagged)

**CSS classes used (all existing global.css):** `config-group`, `config-group-label`, `config-toggle`, `config-hint`. No new class names. Danger text via `style={{ color: "var(--danger)" }}` token only.

### ChartConfigPanel integration

- Added `widgetId?: number` prop (optional — existing call sites unaffected)
- Filter Scope section inserted immediately after both Drill-Down config-groups, before chart-specific field groups
- Gated on `selectedSource` (same condition as Drill-Down) — hidden for widgets without a data source
- `set("filterSelection", next)` writes into `draft`; the existing Apply handler spreads `...draft` into the saved config (no save-path change needed)

### DashboardsPage threading

`widgetId={widget.id}` added to `<ChartConfigPanel>` in `WidgetConfigModal`. `widget` is the `WidgetDto` already in scope.

---

## Spatial Sentinel: Phase Boundary (CRITICAL)

Phase 93 ONLY stores `SPATIAL_DRAWS_SENTINEL` in `widget.config.filterSelection.allowedSourceWidgetIds`. There is:
- NO resolver change
- NO orchestrator change
- NO `useMapOnlySpatialMaterialize` change

Phase 93.5 is the phase where the resolver reads `SPATIAL_DRAWS_SENTINEL` from `allowedSourceWidgetIds` and branches to gate spatial shapes. The sentinel value is forward-compatible: it will simply be read by the Phase 93.5 resolver as-is.

---

## Test Coverage

24 tests in `FilterSelectionPanel.spec.tsx` covering:
- Default accept-all state (header, unchecked Customize, hint, no checklist)
- Customize toggle fires correct onChange payload
- Source filtering (bar + datafilter show; records, legend, map excluded)
- Spatial sentinel always present in allowlist mode including empty widget list
- Sentinel check/uncheck adds/removes `SPATIAL_DRAWS_SENTINEL`
- `selfWidgetId` excludes matched widget; sentinel exempt from exclusion
- Source row check/uncheck fires correct onChange
- Accept-none warning logic (shown on empty, suppressed when sentinel or live widget selected)
- Unchecking Customize fires `onChange(undefined)`
- Orphan numeric id renders danger hint; string sentinel is never orphaned
- Empty source list hint; sentinel still renders

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Verification Results

- `cd packages/web && npx tsc --noEmit` — clean
- `cd packages/web && npx vitest run` — 127 test files, 2917 tests, 100% pass
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` — 130 tests green
- `git diff --name-only packages/server` — EMPTY (frontend-only)
- `grep -n '"records"' filterSourceTypes.ts` — in comment only, NOT in Set literal
- `grep -n "SPATIAL_DRAWS_SENTINEL" filterSourceTypes.ts` — export present at line 45

## Self-Check: PASSED

Files created/modified all exist and commits are recorded.
