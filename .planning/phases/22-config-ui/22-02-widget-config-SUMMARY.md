---
phase: 22-config-ui
plan: "02"
subsystem: ui
tags: [react, vitest, testing-library, mapconfig, config-panel]

# Dependency graph
requires:
  - phase: 19-config-schema
    provides: "mapInfoConfig.ts helpers (getInfoEnabled, getInfoRadiusPx) and MapWidgetConfig type with infoEnabled/infoRadiusPx fields"
provides:
  - "MapConfigPanel INFO POPUP section with enable/disable toggle and clamp-on-blur radius input"
  - "10 new vitest tests covering render order, toggle propagation, 4 clamp paths, disabled state, and default-fallback rendering"
affects: [22-03-layer-config, 23-info-card]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "clamp-on-blur pattern: local radiusDraft state for free typing; clamp+error only fired on blur (not onChange)"
    - "Phase 19 helpers as sole default source: getInfoEnabled/getInfoRadiusPx called once at render; no duplicated true/20 literals"
    - "aria-disabled string attribute paired with HTML disabled for disabled input state (accessibility pattern)"
    - "Auto-dismiss inline error via setTimeout(() => setRadiusError(null), 3000)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx

key-decisions:
  - "Test 6 (all-on layer checkboxes) scoped to .config-layer-picker to exclude the INFO POPUP enable toggle from getAllByRole('checkbox') — prevents false count mismatch after Phase 22 adds a third checkbox to the form"
  - "10 tests written (not 8 as plan target stated) to cover every clamp permutation explicitly per plan's own notes"
  - "clampRadius treats 50.7 → 51 via Math.round (not Math.floor) per locked spec behavior W8"
  - "handleRadiusBlur always calls onChange when clamped value !== stored infoRadiusPx, even if radiusDraft already showed that value (prevents stale config)"

patterns-established:
  - "INFO POPUP config-group block at very bottom of form (after LAYERS section, before config-panel closing div)"
  - "No clamping during onChange — only setRadiusDraft; clamping deferred to onBlur (clamp-on-blur lock)"

requirements-completed:
  - CONFIG-V14-04

# Metrics
duration: 3min
completed: 2026-05-08
---

# Phase 22 Plan 02: Widget Config Summary

**INFO POPUP section in MapConfigPanel: enable/disable toggle + clamp-on-blur radius input (1-200 px) backed by Phase 19 getInfoEnabled/getInfoRadiusPx helpers, 18/18 vitest tests green**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-08T22:53:40Z
- **Completed:** 2026-05-08T22:56:40Z
- **Tasks:** 2 (TDD: RED commit + GREEN commit)
- **Files modified:** 2

## Accomplishments

- INFO POPUP `config-group` block added at the very bottom of `MapConfigPanel.tsx` (after LAYERS section)
- Enable info popup checkbox toggle wired to `onChange({ ...config, infoEnabled })` — defaults ON via `getInfoEnabled` (no duplicated `true` literal)
- Click radius (px) numeric input with clamp-on-blur: 999→200, 0→1, -5→1, 50.7→51 (Math.round); inline error "Must be 1–200" (en dash) auto-dismissed after 3s
- Radius input disabled + `aria-disabled="true"` when `infoEnabled === false`; no onChange during typing (clamp-on-blur lock)
- 10 new tests (W1-W10) added in sibling describe block; all 18 spec tests pass; tsc clean for modified files

## Task Commits

1. **Task 1 (RED): add failing INFO POPUP section spec** - `41b03a6` (test)
2. **Task 2 (GREEN): implement INFO POPUP section** - `6770771` (feat)

## Files Created/Modified

- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — Added imports (`useState`, `getInfoEnabled`, `getInfoRadiusPx`, `MapWidgetConfig`), INFO POPUP state logic (`widgetCfg`, `infoEnabled`, `infoRadiusPx`, `radiusDraft`, `radiusError`, `clampRadius`, `handleRadiusBlur`), and INFO POPUP JSX block at bottom of return
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — Added 10 new tests in `describe("MapConfigPanel — Phase 22 INFO POPUP section", ...)` block; fixed test 6 to scope checkbox queries to `.config-layer-picker`

## Locked Clamp Paths (4 cases)

| Input | Rounded | Clamped to | infoRadiusPx |
|-------|---------|------------|--------------|
| 999   | 999     | 200 (max)  | 200          |
| 0     | 0       | 1 (min)    | 1            |
| -5    | -5      | 1 (min)    | 1            |
| 50.7  | 51      | 51 (in-range, no clamp) | 51 |

## Default-Flow Assertion

Defaults flow exclusively through Phase 19 helpers:
- `getInfoEnabled({ infoEnabled: widgetCfg.infoEnabled })` → `true` when undefined
- `getInfoRadiusPx({ infoRadiusPx: widgetCfg.infoRadiusPx })` → `20` when undefined
- No `?? true` or `?? 20` literals in the INFO POPUP code section

## Decisions Made

- Test 6 scoped to `.config-layer-picker` to exclude INFO POPUP toggle from `getAllByRole("checkbox")` count — the pre-existing test used `screen.getAllByRole("checkbox")` which now picks up the Phase 22 toggle; scoping restores the original semantic intent
- 10 tests written (plan mentioned "8 new tests" but the plan's own task spec described 10 named tests W1-W10)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test 6 checkbox count after INFO POPUP toggle added**
- **Found during:** Task 2 (implement INFO POPUP section)
- **Issue:** Existing test 6 used `screen.getAllByRole("checkbox")` expecting exactly 2 checkboxes (2 layer toggles). Adding the INFO POPUP enable/disable checkbox raised the count to 3, breaking the test.
- **Fix:** Changed the query to scope to `.config-layer-picker` element using `document.querySelector(".config-layer-picker").querySelectorAll('input[type="checkbox"]')` — preserves the original intent of counting only layer toggles.
- **Files modified:** `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx`
- **Verification:** All 18 tests pass after fix.
- **Committed in:** `6770771` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary correction — new checkbox broke pre-existing test count assertion. Scope-scoped query restores correct semantics.

## Issues Encountered

- Pre-existing TypeScript errors in `ChipCombobox.spec.tsx` (unrelated to this plan's changes) — `vi.fn()` mock type incompatibility with typed callback signature. Out of scope; logged to deferred items.

## Scope Note

This plan does NOT touch `KineticaWmsLayerForm` or `LayersModal` — those are Plan 22-03's surface.

## Next Phase Readiness

- MapConfigPanel now persists `infoEnabled` and `infoRadiusPx` via the existing `onChange(config)` debounce flow (already wired upstream)
- Plan 22-03 can proceed with `KineticaWmsLayerForm` layer-level info config (per-layer `info_enabled`, `info_columns`, `info_template`)
- Phase 23 (Info Card) reads from `useInfoSelectionStore` — no changes needed to MapConfigPanel

---
*Phase: 22-config-ui*
*Completed: 2026-05-08*
