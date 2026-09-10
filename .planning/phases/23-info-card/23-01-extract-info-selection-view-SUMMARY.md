---
phase: 23-info-card
plan: 01
plan_id: "23-01"
subsystem: charts
tags: [refactor, info-popup, info-card, css-rename]
requirements:
  - CARD-V14-03
dependencies:
  requires:
    - "21-02 InfoPopup component (Phase 21)"
    - "21-01 renderInfoTemplate helper (Phase 21)"
    - "20-01 useInfoSelectionStore (Phase 20)"
  provides:
    - "InfoSelectionView shared body component (consumed by Plan 23-03 InfoCard)"
    - ".info-selection-* CSS namespace (body classes — popup AND card)"
  affects:
    - "kinetica_bi/src/components/charts/InfoPopup.tsx (slimmed to chrome wrapper)"
    - "kinetica_bi/src/components/charts/InfoPopup.spec.tsx (4 chrome tests; 16 body tests removed)"
    - "kinetica_bi/src/styles/global.css (11 body selectors renamed)"
tech-stack:
  added: []
  patterns:
    - "Shared body component + chrome wrappers (Pattern 1 from 23-RESEARCH.md)"
    - "CSS namespace split: .info-selection-* (body, shared) vs .info-popup-* (chrome, popup-only)"
key-files:
  created:
    - "kinetica_bi/src/components/charts/InfoSelectionView.tsx (183 lines)"
    - "kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx (327 lines, 16 tests)"
  modified:
    - "kinetica_bi/src/components/charts/InfoPopup.tsx (slimmed 183 → 76 lines)"
    - "kinetica_bi/src/components/charts/InfoPopup.spec.tsx (slimmed 398 → 110 lines, 20 → 4 tests)"
    - "kinetica_bi/src/styles/global.css (11 body selectors renamed; 1 new declaration: position:relative on .info-popup, absolute positioning on .info-popup-close)"
decisions:
  - "Cross-phase column sort relocated INTO InfoSelectionView so card and popup share single source of truth (was inline in InfoPopup pre-refactor)"
  - "Popup wrapper supplies onActiveLayerIneligible=onClose; card wrapper (Plan 23-03) will supply onActiveLayerIneligible=()=>store.reset() — same behavior, two surfaces"
  - "Plan 23-01 keeps fetch handlers (onLayerSwitch, onLoadMore) caller-supplied (popup wrapper threads MapChartRenderer's handlers unchanged); Plan 23-03 will internalize fetch logic after Plan 23-02 supplies useLastInfoClickContextStore"
  - "Close-X CSS positioned absolutely (top-right of .info-popup) since chrome no longer shares the .info-selection-header flex row with the dropdown — preserves visual layout while keeping JSX hierarchy clean"
metrics:
  duration_min: 8
  tasks_completed: 2
  files_changed: 5
  tests_total: 20
  tests_view: 16
  tests_popup_chrome: 4
  completed: "2026-05-09"
---

# Phase 23 Plan 01: Extract InfoSelectionView Summary

Extracted the popup body (dropdown header + records list + Load-more footer + cross-phase column sort + auto-eligibility-leave callback + PITFALL S-02 scoped selectors) from `InfoPopup.tsx` into a new shared `<InfoSelectionView />` component, slimmed `InfoPopup.tsx` to a chrome wrapper, and renamed body CSS classes from `.info-popup-*` to `.info-selection-*`.

## Extraction Site

**Source:** `kinetica_bi/src/components/charts/InfoPopup.tsx` (pre-refactor, 183 lines).

**Lines moved into `InfoSelectionView.tsx`:**

| Pre-refactor lines | Migrated chunk | New location in view |
|--------------------|----------------|----------------------|
| 26-29 | `useEffect`, `useMemo`, store/helper imports | View top |
| 45-52 | scoped selectors (activeLayerId, entry) + activeLayer derivation | View body |
| 67-75 | eligibleIds memo + auto-leave effect (renamed `onClose` → `onActiveLayerIneligible`) | View body |
| 77 | early-return guard `(activeLayerId === null || activeLayer === null)` | View body |
| 79-82 | `handleDropdownChange` | View body |
| 89-101 | `<div.info-popup-header>` + `<select.info-popup-layer-select>` JSX | Renamed `.info-selection-header` / `.info-selection-layer-select`, view JSX |
| 110-161 | `<div.info-popup-body>` + all 4 sub-modes (loading/empty/error/rows) + per-row template/kv branching + `formatKvValue` helper | Renamed `.info-selection-*`, view JSX + bottom-of-file helper |
| 162-172 | `<div.info-popup-footer>` + Load-more button | Renamed `.info-selection-footer` / `.info-selection-load-more`, view JSX |

**Lines retained in `InfoPopup.tsx` (post-refactor, 76 lines):**

- Imports: `useEffect`, `useInfoSelectionStore`, `InfoSelectionView`, `DashboardLayerDto` (renderInfoTemplate import deleted; useMemo import deleted).
- `Props` interface (unchanged — caller contract preserved).
- Single scoped selector for `activeLayerId` (drives chrome-render suppression + ESC dep array; no `entry` selector — that lives in the view).
- ESC handler `useEffect` (unchanged).
- Render-suppress guard `if (activeLayerId === null) return null`.
- Chrome JSX: `.info-popup-backdrop` (click-to-close), `.info-popup` (stop-propagation), `.info-popup-close` (close X), `<InfoSelectionView ... onActiveLayerIneligible={onClose} />`.

## Test Count Migration

| Spec | Before (Phase 21) | After (Phase 23 P01) |
|------|-------------------|----------------------|
| `InfoPopup.spec.tsx` | 20 tests (H1-H7, B1-B7, L1-L3, A1-A2, S1) | 4 tests (H1, H4, H5, H6 chrome only) |
| `InfoSelectionView.spec.tsx` | — (didn't exist) | 16 tests (V1-V16) |
| Total | 20 | 20 |

**V16 is NEW** (cross-phase column-sort regression): asserts that `entry.columns = ["zebra","apple","mango"]` renders kv-mode `<th>` order as `apple → mango → zebra` (alphabetical via localeCompare). Lives in the view spec because the sort lives in the view.

## CSS Rename Diff

**Renamed (11 body selectors)** — `.info-popup-*` → `.info-selection-*`:

| Old | New |
|-----|-----|
| `.info-popup-header` | `.info-selection-header` |
| `.info-popup-layer-select` | `.info-selection-layer-select` |
| `.info-popup-body` | `.info-selection-body` |
| `.info-popup-loading` | `.info-selection-loading` |
| `.info-popup-empty` | `.info-selection-empty` |
| `.info-popup-error` | `.info-selection-error` |
| `.info-popup-rows` | `.info-selection-rows` |
| `.info-popup-row` | `.info-selection-row` |
| `.info-popup-row-kv` (+ `th` / `td` variants) | `.info-selection-row-kv` |
| `.info-popup-footer` | `.info-selection-footer` |
| `.info-popup-load-more` (+ `:disabled`) | `.info-selection-load-more` |
| (template-marker class) `.info-popup-row-template` | `.info-selection-row-template` |

**Preserved (popup chrome — 4 selectors):**

- `.info-popup-backdrop`
- `.info-popup` (also added `position: relative` for absolute close-X positioning)
- `.info-popup-close` (added `position: absolute; top: 6px; right: 6px; z-index: 1` since close-X no longer shares header flex row with dropdown)
- `.info-popup-overlay-element` (ol/Overlay element wrapper)

**Out of scope** — Phase 22 `.info-popup-config-*` form classes (lines 2008-2095) NOT touched (different concern: layer/widget config form, not popup body).

## AbortController Status

`abortControllerRef` for the on-demand info query lives in `MapChartRenderer.tsx` (Phase 21-03). **Plan 23-01 does NOT move it.** Per the plan's `<output>` clause: "AbortController status (still in MapChartRenderer for now — Plan 23-03 will move)."

`MapChartRenderer.tsx` continues to own:
- `handleLayerSwitch(layerId)` — POST `/api/info/query` + `setActiveLayer`
- `handleLoadMore()` — POST `/api/info/query` page+1 + `appendPage`
- `handleClose()` — `reset()` + `Overlay.setPosition(undefined)`

These are threaded into `<InfoPopup>` via the existing `onLayerSwitch` / `onLoadMore` / `onClose` props, which the popup wrapper threads down into `<InfoSelectionView>` (with `onClose` re-bound to the new `onActiveLayerIneligible` slot). Plan 23-03 will move these handlers into the view after Plan 23-02 supplies the `useLastInfoClickContextStore` slice (which carries the `clickLat` / `clickLon` / `mapBbox` / `mapWidthPx` / `mapHeightPx` / `radiusPx` from the most recent map click into the card surface, where there's no click event to source them from directly).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added position context for chrome close-X**

- **Found during:** Task 1 (CSS rename)
- **Issue:** Pre-refactor, `.info-popup-close` lived inside `.info-popup-header` flex row alongside the dropdown — no absolute positioning needed. Post-refactor (Task 2), the close-X moves OUTSIDE `<InfoSelectionView />` (chrome only) and `<InfoSelectionView />` renders its own `.info-selection-header` containing only the dropdown. Without absolute positioning, the close-X would either disappear above the header or push the header down.
- **Fix:** Added `position: relative` to `.info-popup` and `position: absolute; top: 6px; right: 6px; z-index: 1` to `.info-popup-close` in Task 1 (atomic with the rename so the chrome layout was correct as soon as the view was extracted in Task 2).
- **Rationale:** The plan's `<action>` for Task 2 explicitly anticipates this: "VERIFY by reading lines 1961-1969 of `kinetica_bi/src/styles/global.css`...if not absolutely positioned, add the absolute positioning."
- **Files modified:** `kinetica_bi/src/styles/global.css`
- **Commit:** `3532a12`

### Plan-deviation None

The plan execution otherwise matched the spec verbatim — same prop interface, same JSX structure, same test migration table, same commit-message convention.

## Self-Check: PASSED

- File `kinetica_bi/src/components/charts/InfoSelectionView.tsx` — FOUND (183 lines)
- File `kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx` — FOUND (327 lines, 16 tests)
- File `kinetica_bi/src/components/charts/InfoPopup.tsx` — FOUND (76 lines, slim)
- File `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` — FOUND (110 lines, 4 tests)
- Commit `3532a12` (Task 1 CSS rename) — FOUND
- Commit `8472353` (Task 2 extraction + spec split) — FOUND
- `npx vitest --run` — 478/478 GREEN
- `npx tsc --noEmit` — clean
