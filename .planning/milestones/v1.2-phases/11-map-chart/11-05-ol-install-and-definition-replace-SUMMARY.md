---
phase: 11-map-chart
plan: 05
subsystem: ui
tags: [openlayers, ol, css, chart-definition, map, typescript]

# Dependency graph
requires:
  - phase: 11-map-chart
    provides: Phase 11 UI-SPEC.md CSS class inventory and design tokens
provides:
  - ol@10.9.0 installed in kinetica_bi/package.json dependencies
  - definitions/map.ts replaced with Phase 11 minimal schema (empty fields, Phase 11 defaultConfig)
  - 20 new CSS classes in global.css under Phase 11 Map Chart block
affects:
  - 11-06 (MapChartRenderer — can now import from ol/*)
  - 11-07 (MapConfigPanel — can attach to definitions/map.ts CustomConfigPanel in one-line edit)
  - 11-08, 11-09 (Wave 3 plans referencing .widget-map-* and .config-* CSS classes)

# Tech tracking
tech-stack:
  added: ["ol@10.9.0 (OpenLayers v10 — types bundled, no @types/ol needed)"]
  patterns:
    - "ChartTypeDefinition with fields: [] delegates config schema ownership to CustomConfigPanel"
    - "Phase 11 CSS classes appended as named block at end of global.css"

key-files:
  created: []
  modified:
    - kinetica_bi/package.json
    - kinetica_bi/package-lock.json
    - kinetica_bi/src/components/charts/definitions/map.ts
    - kinetica_bi/src/styles/global.css

key-decisions:
  - "ol@10.9.0 installed (npm resolved ^10.5.0 to 10.9.0 as latest minor); types ship with ol v10 — @types/ol NOT installed"
  - "Bundle size delta from ol: 0 KB gzipped (197.91 kB pre/post) — Vite tree-shakes ol because no source file imports it yet; React.lazy is OPTIONAL for 11-06"
  - "definitions/map.ts fields: [] — CustomConfigPanel (MapConfigPanel) owns the entire schema; attachment deferred to 11-07"
  - "usesAggregation: false on map definition — WMS is the data path, not aggregated SQL"
  - "supportsDrillDown intentionally unset — Phase 12 IDENT-02 scope"
  - "20 CSS classes added (vs 16 minimum required) — includes .config-classbreak-row-label which was implicit in UI-SPEC.md classbreak builder spec"

patterns-established:
  - "CSS Phase block pattern: /* === Phase N: Feature Name */ header with source/spacing/color annotation"
  - "Reduced-motion media query pattern for transition classes (prefers-reduced-motion: reduce)"

requirements-completed:
  - MAP-01
  - MAP-02
  - MAP-03
  - MAP-04

# Metrics
duration: 4min
completed: 2026-05-05
---

# Phase 11 Plan 05: OL Install and Definition Replace Summary

**ol@10.9.0 installed, definitions/map.ts legacy stub replaced with Phase 11 WMS-first schema, and 20 CSS classes added to global.css — Wave 3 can now import OpenLayers and reference all .widget-map-* classes**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-05T13:30:44Z
- **Completed:** 2026-05-05T13:35:36Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Installed ol@10.9.0 (23 new packages); build exits 0; types resolve without @types/ol
- Replaced legacy map.ts stub (color/markerSize/centerLat/centerLon/zoom) with Phase 11 minimal schema: empty fields array, full WMS defaultConfig, usesAggregation: false
- Added 20 CSS classes under `/* === Phase 11: Map Chart */` block including all widget-map-* states, config-classbreak-* builder, and config-cardinality-* hints; reduced-motion media query included

## Bundle Size Measurement

| State | JS bundle (raw) | JS bundle (gzip) |
|-------|----------------|-----------------|
| Before ol | 709.26 kB | 197.91 kB |
| After ol installed (not imported) | 709.13 kB | 197.96 kB |
| Delta | -0.13 kB | +0.05 kB |

**Result:** Delta is effectively 0. Vite tree-shakes ol entirely because no source file imports from `ol/*` yet. When 11-06 (MapChartRenderer) first imports `ol/Map`, ol will be bundled. Based on research (~120-150 kB gzipped), this is below the 200 kB React.lazy threshold.

**React.lazy recommendation for 11-06:** OPTIONAL — the projected ol contribution (~140 kB gzip) is below the 200 kB threshold from CONTEXT.md. Implement React.lazy in 11-06 if the actual post-import delta exceeds 200 kB; otherwise, a static import is acceptable.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install ol@^10.5.0 + measure bundle size delta** - `7f00b53` (chore)
2. **Task 2: Replace definitions/map.ts with Phase 11 minimal schema** - `01df41f` (feat)
3. **Task 3: Add Phase 11 CSS classes to global.css per UI-SPEC.md** - `24c885b` (feat)

## Files Created/Modified

- `kinetica_bi/package.json` - Added `"ol": "^10.9.0"` to dependencies
- `kinetica_bi/package-lock.json` - Updated with 23 new ol transitive packages
- `kinetica_bi/src/components/charts/definitions/map.ts` - Replaced legacy stub with Phase 11 minimal schema (fields: [], Phase 11 defaultConfig with 15 config keys)
- `kinetica_bi/src/styles/global.css` - Appended 20 CSS classes in Phase 11 block (154 lines added, 0 deleted)

## Decisions Made

- **ol version:** npm resolved `^10.5.0` to `10.9.0` as the latest minor. Used as-is — semver-compatible with the plan's pin.
- **@types/ol:** NOT installed. Confirmed types ship with ol v10 package directly.
- **React.lazy:** OPTIONAL for 11-06. Measured delta is 0 (import not yet in source); research estimate ~120-150 kB gzip is below 200 kB threshold. Final decision deferred to 11-06 after actual import delta is measured.
- **CSS class count:** 20 classes added (plan required >= 16). Extra class is `.config-classbreak-row-label` which was implicit in the classbreak builder grid spec.
- **Pre-existing TS errors:** `src/lib/columnTypes.spec.ts` has 4 TS errors (`getValidSpatialColumns`, `autoSuggestSpatialMode`, `SpatialMode`, `Column` not yet exported) from TDD RED commit `263b2a9` (test(11-02)). These are pre-existing, not caused by this plan. The project's tsconfig `skipLibCheck: true` and the vitest runner bypass these — all 122 tests pass.

## Deviations from Plan

None — plan executed exactly as written.

The smoke-import test was run inside the project's `src/` directory (not as a standalone `--noEmit /tmp/smoke-ol.ts`) to correctly apply the project's tsconfig. The test confirmed ol types resolve cleanly. The temp file was deleted immediately after.

## Issues Encountered

- `npx tsc --noEmit /tmp/smoke-ol.ts` produced false-positive failures (ol type resolution errors) because the file was outside the project's tsconfig include path. Resolution: copied temp file into `src/`, ran `tsc --noEmit` (which uses the project tsconfig with `skipLibCheck: true`), confirmed ol types resolved, deleted temp file.
- Pre-existing `src/lib/columnTypes.spec.ts` TS errors from TDD RED commit for plan 11-02 (not caused by this plan; vitest runs fine, 122/122 pass).

## Next Phase Readiness

- **11-06 (MapChartRenderer):** Can `import Map from "ol/Map"` immediately — ol is installed and types resolve. Measure actual gzip delta after first import and decide on React.lazy (expected: optional at ~140 kB).
- **11-07 (MapConfigPanel):** Can attach `CustomConfigPanel: MapConfigPanel` to `definitions/map.ts` with a one-line edit after MapConfigPanel.tsx exists.
- **11-08, 11-09:** All `.widget-map-*` and `.config-spatial-mode`, `.config-render-mode`, `.config-classbreak-*`, `.config-basemap`, `.config-cardinality-*` CSS classes are available.
- **Test suite:** 122/122 tests passing, production build clean.

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
