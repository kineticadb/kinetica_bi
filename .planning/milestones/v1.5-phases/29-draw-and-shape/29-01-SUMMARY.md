---
phase: 29-draw-and-shape
plan: 01
subsystem: ui
tags: [react, openlayers, font-awesome, draw-mode, zustand, typescript]

# Dependency graph
requires:
  - phase: 27-spatial-filter-store
    provides: useSpatialFilterStore shape + addShape/removeShape/clearAll/reset actions
  - phase: 24-verification
    provides: mountedRef cleanup-gate pattern (GAP-24-02-A) + sourceListenerCleanupRef (GAP-24-01-A)
provides:
  - DrawMode union type + DRAW_MODES readonly tuple + formatDistance + formatArea (lib/shapeDraw.ts)
  - drawMode useState (default 'info') + drawModeRef mirror + previousModeRef in MapChartRenderer
  - V15-P-01 mode-guard as FIRST line of Effect 6's async handler (reads via drawModeRef.current)
  - Cursor management useEffect (crosshair/grab/'') with cleanup return
  - Font Awesome dependencies installed and pinned in package.json
affects:
  - 29-02-map-draw-toolbar (imports DrawMode from lib/shapeDraw.ts; wires setDrawMode prop)
  - 29-03-vector-layer-and-shape-sync (extends MapChartRenderer Effects 1/7)
  - 29-04-draw-interaction-and-pipeline (adds Effect 8; uses previousModeRef for auto-restore)
  - 29-05-selection-and-delete (uses drawMode state for mode-gating of selection clicks)

# Tech tracking
tech-stack:
  added:
    - "@fortawesome/react-fontawesome@^3.3.1 — React FontAwesome icon component"
    - "@fortawesome/fontawesome-svg-core@^7.2.0 — Required peer; provides library/icon registry"
    - "@fortawesome/free-solid-svg-icons@^7.2.0 — Solid icon variants (faHand, faCircleInfo, etc.)"
  patterns:
    - "drawModeRef mirror: useState + useRef pair so useEffect closures read current mode without stale-closure (V15-P-01 pitfall mitigation)"
    - "previousModeRef tracker: captures last non-draw mode (pan/info) for drawend auto-restore (DRAW-V15-02)"
    - "Cursor useEffect: single dep [drawMode]; cleanup return resets cursor on mode-change AND unmount (V15-P-02 pitfall mitigation)"
    - "Test seam: data-testid=draw-mode-debug span + setdrawmode custom event listener for vitest specs before MapDrawToolbar ships"

key-files:
  created:
    - kinetica_bi/src/lib/shapeDraw.ts
    - kinetica_bi/src/lib/shapeDraw.spec.ts
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
    - kinetica_bi/package.json
    - kinetica_bi/package-lock.json

key-decisions:
  - "[29-01 shapeDraw]: DrawMode union + DRAW_MODES tuple live in lib/shapeDraw.ts (not MapChartRenderer.tsx) — avoids circular import when MapDrawToolbar (Plan 02) imports the type; matches mapInfoConfig.ts minimal-helper pattern"
  - "[29-01 mode-guard]: drawModeRef.current read imperatively in Effect 6 handler (NOT useState closure) — prevents stale-closure trap (V15-P-02) WITHOUT adding drawMode to Effect 6 deps array (which would tear down/recreate the singleclick listener on every mode change)"
  - "[29-01 cursor]: cursor useEffect deps on [drawMode]; cleanup return covers mode-change AND unmount paths in one Effect (V15-P-02 pitfall — stale cursor after unmount or error)"
  - "[29-01 test-seam]: setdrawmode custom event + data-testid span added to MapChartRenderer JSX for vitest specs to drive drawMode without MapDrawToolbar existing yet; event listener in useEffect([]) ensures cleanup on unmount"
  - "[29-01 deviation Rule 1]: Added getViewport to WidgetRenderer.spec.tsx ol/Map mock — cursor useEffect calls map.getViewport() which the WidgetRenderer spec's mock lacked, causing TypeError crash in that spec"

patterns-established:
  - "useState + useRef mirror pair: setMode via useState triggers re-renders for cursor/JSX; readMode via ref.current in async Effect handlers to avoid stale closure"
  - "Test seam via custom DOM events: allows vitest to drive internal component state (drawMode) before the real toolbar prop-wiring ships"

requirements-completed:
  - DRAW-V15-02
  - DRAW-V15-03

# Metrics
duration: 8min
completed: 2026-05-12
---

# Phase 29 Plan 01: Mode Guard and Foundation Summary

**DrawMode union + formatDistance/formatArea formatters in lib/shapeDraw.ts; V15-P-01 singleclick mode-guard as FIRST Effect 6 line in MapChartRenderer; drawMode/drawModeRef/previousModeRef state machinery + cursor useEffect; Font Awesome 3.3.1/7.2.0 installed**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-12T19:51:57Z
- **Completed:** 2026-05-12T19:59:30Z
- **Tasks:** 2 (TDD: 4 commits total — test-red, feat-green, feat-Task2, docs)
- **Files modified:** 7

## Accomplishments

- Installed Font Awesome (@fortawesome/react-fontawesome@3.3.1, @fortawesome/fontawesome-svg-core@7.2.0, @fortawesome/free-solid-svg-icons@7.2.0) — new dependency family for Phase 29 toolbar icons
- Created lib/shapeDraw.ts with DrawMode union, DRAW_MODES readonly tuple ['pan','info','bbox','lasso','circle'], formatDistance (km/m switchover at 1000m, 0 decimals below, 1 decimal above), formatArea (km²/m² switchover at 1_000_000 m²) — 17 unit tests green
- Landed V15-P-01 mode-guard as FIRST executable line of Effect 6's async handler; reads via drawModeRef.current (imperative, never stale-closure); Effect 6 deps array unchanged (drawMode NOT added)
- Added drawMode useState (default 'info'), drawModeRef mirror, previousModeRef, drawModeRef-sync useEffect, previousModeRef-tracker useEffect, cursor useEffect (crosshair/grab/''), and test seam to MapChartRenderer
- 12 new M1-M12 tests; full suite 599/599 green; tsc clean

## Task Commits

1. **Task 1: Install Font Awesome + create lib/shapeDraw.ts** - `f03d38f` (feat)
2. **Task 2: drawMode state + mode-guard + cursor effect** - `a09a7eb` (feat)

## Files Created/Modified

- `kinetica_bi/src/lib/shapeDraw.ts` — DrawMode union, DRAW_MODES tuple, formatDistance, formatArea (pure helpers, no OL imports, unit-testable)
- `kinetica_bi/src/lib/shapeDraw.spec.ts` — 17 unit tests for formatDistance/formatArea km/m switchover + DRAW_MODES ordering + DrawMode compile-time checks
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Key additions at exact line numbers:
  - Line 63: `import type { DrawMode } from "../../lib/shapeDraw"`
  - Lines 447-451: drawMode useState (default 'info'), drawModeRef, previousModeRef
  - Lines 591-596: drawModeRef-sync useEffect
  - Lines 614-620: previousModeRef-tracker useEffect
  - Lines 622-635: cursor management useEffect (crosshair/grab/'') + cleanup return
  - Lines 637-649: test-seam useEffect (setdrawmode custom event listener)
  - Lines 888-894: V15-P-01 mode-guard (FIRST line of Effect 6 async handler; reads drawModeRef.current; `if (mode !== "pan" && mode !== "info") return`)
  - Line 1040: Effect 6 deps array UNCHANGED (drawMode absent)
  - Lines 1033-1041 (JSX): data-testid=draw-mode-debug span with data-draw-mode={drawMode}
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Added getViewport to ol/Map mock; Phase 29 M1-M12 describe block (12 tests); lastViewportElement tracking
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — Added getViewport to ol/Map mock (Rule 1 auto-fix)
- `kinetica_bi/package.json` — Font Awesome deps added
- `kinetica_bi/package-lock.json` — Updated lockfile

## Decisions Made

- DrawMode lives in lib/shapeDraw.ts (not MapChartRenderer.tsx) to avoid circular import with MapDrawToolbar (Plan 02)
- drawModeRef.current imperative read in Effect 6 handler avoids widening the deps array (stale-closure pitfall V15-P-02)
- Test seam via custom DOM event (setdrawmode) + data-testid span enables M1-M12 vitest specs before real toolbar ships in Plan 02
- previousModeRef only updates on non-draw modes (pan/info); draw modes skip the tracker — Plan 04 drawend reads previousModeRef to auto-restore

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WidgetRenderer.spec.tsx ol/Map mock missing getViewport**
- **Found during:** Task 2 (after adding cursor useEffect to MapChartRenderer)
- **Issue:** cursor useEffect calls `mapRef.current?.getViewport()` but WidgetRenderer.spec.tsx's ol/Map mock had no `getViewport` method, causing `TypeError: mapRef.current?.getViewport is not a function` — 1 test failing
- **Fix:** Added `this.getViewport = vi.fn(() => ({ style: { cursor: "" } }))` to WidgetRenderer.spec.tsx's MockMap
- **Files modified:** kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
- **Verification:** Full suite 599/599 green after fix
- **Committed in:** a09a7eb (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test mock exposed by new production code)
**Impact on plan:** Minimal; mock-only fix required by the new cursor effect. No scope creep.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (MapDrawToolbar) can import `DrawMode` from `lib/shapeDraw.ts` and `setDrawMode` via prop from MapChartRenderer
- Plan 03 (VectorLayer + shape sync) can extend MapChartRenderer Effect 1 and add Effect 7 using the existing `drawMode` state
- Plan 04 (Draw interaction + pipeline) can add Effect 8 keyed on `drawMode` and use `previousModeRef` for auto-restore on drawend/ESC
- Plan 05 (selection + delete) can use `drawMode` to mode-gate selection clicks (SHAPE-V15-04 lock)
- V15-P-01 mode-guard is closed at the source: bbox/lasso/circle singleclick interception proven by M1-M3 tests

---
*Phase: 29-draw-and-shape*
*Completed: 2026-05-12*
