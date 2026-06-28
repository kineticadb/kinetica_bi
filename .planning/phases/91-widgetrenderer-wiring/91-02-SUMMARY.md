---
phase: 91-widgetrenderer-wiring
plan: "02"
subsystem: chart-renderers
tags: [filter-combination-store, timeline, numeric-line, read-path, from-swap]
dependency_graph:
  requires:
    - 89-01 (filterCombinationStore registry/vizToHash/clearEntry)
    - 90-03 (orchestrator sets vizToHash entries per widget)
  provides:
    - Timeline + NumericLine table-bound widgets read from filterCombinationStore
  affects:
    - TimelineRenderer.tsx (selector-source swap, proactive expiry)
    - NumericLineRenderer.tsx (selector-source swap, proactive expiry)
tech_stack:
  added: []
  patterns:
    - S-02 primitive-selector subscriptions (vizToHash[vizKey] scoped to one widget)
    - NOFILTER sentinel guard (hash.endsWith(":NOFILTER") → empty string → base table)
    - Imperative getState() for proactive expiry clearEntry
key_files:
  created: []
  modified:
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx
decisions:
  - vizKey = "w:<widget.id>" — matches orchestrator keying from Phase 90 (COMBO-V118-03)
  - useFilterViewStore import retained in both renderers (commitFilter still calls markMaterializing)
  - Three separate primitive selectors (fvViewName/fvExpiresAt/fvMaterializing) instead of one object selector, per S-02 lock
  - NOFILTER check uses h.endsWith(":NOFILTER") matching NOFILTER_SENTINEL constant
metrics:
  duration: "8 minutes"
  completed_date: "2026-06-28"
  tasks_completed: 2
  files_changed: 4
---

# Phase 91 Plan 02: Timeline + NumericLine Renderer Read Flip Summary

Flip the TABLE-BOUND read path of TimelineRenderer and NumericLineRenderer from the legacy `filterViewStore.views[tableId]` selectors to the v1.18 `filterCombinationStore` combination registry — a selector-source-only swap with zero change to downstream FROM-swap logic or commitFilter.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Swap TimelineRenderer filter-view selectors to filterCombinationStore + clearEntry expiry | f1584cc | TimelineRenderer.tsx, TimelineRenderer.spec.tsx |
| 2 | Swap NumericLineRenderer filter-view selectors to filterCombinationStore + clearEntry expiry | 6008dd5 | NumericLineRenderer.tsx, NumericLineRenderer.spec.tsx |

## What Changed

### Both Renderers (identical transformation)

**Imports added:**
- `useFilterCombinationStore` from `../../store/filterCombinationStore`
- `NOFILTER_SENTINEL` from `../../lib/stableComboHash`

**Three selectors replaced (lines 203-207 / 187-191):**
- OLD: `useFilterViewStore((s) => s.views[tableId]?.viewName)` etc.
- NEW: `useFilterCombinationStore((s) => { const h = s.vizToHash[vizKey]; return h && !h.endsWith(":NOFILTER") ? (s.registry[h]?.viewName ?? "") : ""; })` (with identical pattern for expiresAt and materializing)
- `vizKey = "w:<widget.id>"` constant declared before the selectors

**Proactive expiry (lines ~252/230):**
- OLD: `useFilterViewStore.getState().clearView(tableId)`
- NEW: `const h = useFilterCombinationStore.getState().vizToHash[vizKey]; if (h) useFilterCombinationStore.getState().clearEntry(h);`

**Unchanged:**
- All variable names (`fvViewName`, `fvExpiresAt`, `fvMaterializing`) — downstream FROM-swap logic identical
- `useFilterViewStore` import — still used in `commitFilter` (markMaterializing)
- `commitFilter` function bodies — unchanged
- Dep arrays — still list `fvViewName, fvExpiresAt, fvMaterializing`
- dv-bound path — untouched

### Spec Updates (both files)

Added `filterCombinationStore` mock:
- Let-bound `mockVizToHash` / `mockRegistry` / `mockCombinationVersion` reset in `beforeEach`
- Selector-aware mock (supports `(selector) => selector(state)` call pattern)
- `.getState()` mock with `clearEntry` spy

Rewired tests:
- Test 2b (FROM-swap): now populates `mockVizToHash["w:100"]` + `mockRegistry[hash]` with a real combo entry
- Test 2c (suspend): now sets a materializing combo entry (`viewName: "", materializing: true`)
- Test 2d (NOFILTER): new test — `mockVizToHash["w:100"] = "table:1:NOFILTER"` → queries base table

Retained unchanged:
- filterViewStore mock (commitFilter wiring)
- Sole-trigger static assertions (grep for `materializeFilter` in source → 0 count)
- All other existing tests

## Verification Results

- `npx tsc --noEmit`: clean (no errors in Timeline/NumericLine files; pre-existing WidgetRenderer.tsx errors from Plan 91-01 are out of scope)
- `npx vitest run src/components/charts/TimelineRenderer.spec.tsx`: 27 passed
- `npx vitest run src/components/charts/NumericLineRenderer.spec.tsx`: 22 passed
- `npx vitest run src/styles/theme-guard.spec.ts`: 128 passed
- `grep -rl "materializeFilter|dropFilterView" packages/web/src/components/charts/` does NOT list TimelineRenderer.tsx or NumericLineRenderer.tsx
- `git diff --name-only packages/server`: empty (zero server diff)

## Deviations from Plan

None — plan executed exactly as written. The transformation was a mechanical selector-source swap on both files.

## Self-Check: PASSED

Files created/modified exist at expected paths:
- packages/web/src/components/charts/TimelineRenderer.tsx: FOUND
- packages/web/src/components/charts/TimelineRenderer.spec.tsx: FOUND
- packages/web/src/components/charts/NumericLineRenderer.tsx: FOUND
- packages/web/src/components/charts/NumericLineRenderer.spec.tsx: FOUND

Commits exist:
- f1584cc (Task 1): FOUND
- 6008dd5 (Task 2): FOUND
