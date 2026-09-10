---
phase: 11-map-chart
plan: 10
subsystem: ui
tags: [react, openlayers, wms, map, config-panel, vitest, gap-closure]
gap_closure: true
status: complete

requires:
  - phase: 11-map-chart-09
    provides: "Integration checkpoint verdict: 1 RED (no table picker) + 4 BLOCKED criteria; locked decision Option A (wrap Custom in shared Title+Data Source scaffold)"
  - phase: 11-map-chart-08
    provides: "Mode-specific param groups + ClassbreakParamsGroup + cardinality probe; MapConfigPanel onChange/isValid contract"
  - phase: 11-map-chart-06
    provides: "MapChartRenderer + Effect 1/2/3 (OL Map lifecycle, ImageWMS source, filter invalidation); wmsUrlBuilder.ts tableRef -> LAYERS param"

provides:
  - "ChartConfigPanel CustomConfigPanel branch now renders Title + Data Source scaffold before MapConfigPanel slot"
  - "tableRef (string) and tableId (number) both persisted on widget.config at auto-save time"
  - "__autoSuggestActive draft flag stripped before persistence (resolves 11-07-SUMMARY caveat)"
  - "MapConfigPanel clears stale latColumn/lonColumn/wktColumn/wkbColumn/cbColumn when columns prop changes (table swap)"
  - "ImageWMS source with EPSG:3857 projection; XHR+base64 imageLoadFunction; ResizeObserver updateSize"
  - "4/5 Phase 11 criteria GREEN; Criterion 3 (filter invalidation) explicitly deferred by user direction"

affects:
  - phase-12 (map drill-down inherits tableRef/tableId persistence shape)
  - phase-11-verification (re-verify Criterion 3 in future cycle)

tech-stack:
  added: []
  patterns:
    - "CustomConfigPanel scaffold: wrap <Custom> in shared Title+Data Source+Apply/Cancel; handleTableChange + hasSources hoisted above branch to avoid TDZ"
    - "Stale-selection-clear: columnsKey = columns.map(c => c.name).join(',') as primitive dep; prevColumnsKeyRef tracks prior key; no-op on equal key"
    - "ImageWMS imageLoadFunction: XHR+arraybuffer+base64 data-URL; withCredentials=true; 1x1 GIF placeholder on error (prevents render loop)"
    - "ResizeObserver on map container calls map.updateSize() on every dimension change including 0->real-size first paint"

key-files:
  created:
    - kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx
  modified:
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx
    - .planning/phases/11-map-chart/11-VERIFICATION.md

key-decisions:
  - "Option A (locked in 11-09): wrap <Custom> in shared scaffold; preserve auto-save chain; rejected Option B (Apply/Cancel fork) to avoid breaking MapConfigPanel save semantics and AP-4 lock"
  - "columnsKey primitive dep (not columns reference) for stale-clear effect — prevents spurious fires from parent re-creating the array on every render (S-02 lock)"
  - "XHR+arraybuffer+base64 for imageLoadFunction over fetch+blob — eliminates blob URL stale-reference issues; synchronous xhr.status read for 401 detection"
  - "ResizeObserver on containerRef.current calls map.updateSize() — only reliable way to handle OL Map constructed in a 0x0 grid layout container"
  - "projection: 'EPSG:3857' on ImageWMS source — required for tile alignment with OSM basemap (user-discovered Fix F, commit a54c9c5)"
  - "Criterion 3 deferred by user direction — filter tile invalidation code path in place (PITFALL M-02 lock); re-verify in future cycle"

patterns-established:
  - "CustomConfigPanel branch scaffold: Title + Data Source sections rendered above <Custom> slot; handleTableChange + hasSources hoisted above the branch"
  - "WMS imageLoadFunction: XHR+arraybuffer+base64 data-URL pattern; 1x1 transparent GIF placeholder on non-OK response"
  - "columnsKey join string as primitive dep for column-change effects (S-02 pattern applied to columns array)"

requirements-completed: [MAP-01, MAP-02, MAP-03, MAP-04]

duration: ~180min (multi-session gap closure with 5 re-verification rounds)
completed: 2026-05-05
---

# Phase 11 Plan 10: Config Panel Table Picker Fix Summary

**ChartConfigPanel custom-panel scaffold restored with table picker + ImageWMS render-loop fixes + EPSG:3857 projection — 4/5 Phase 11 criteria GREEN, Criterion 3 explicitly deferred by user**

## Performance

- **Duration:** ~180 min (multi-session; five verification rounds)
- **Started:** 2026-05-05 (Task 1 execution)
- **Completed:** 2026-05-05
- **Tasks:** 3 (Tasks 1 + 2 executed; Task 3 human-verify completed with 4/5 GREEN + 1 deferred)
- **Files modified:** 7 source files + 2 spec files + 1 VERIFICATION.md

## Accomplishments

- Restored the Title + Data Source scaffold for the `CustomConfigPanel` branch in `ChartConfigPanel.tsx` — map widget config modal now shows a table picker; spatial-column dropdowns populate correctly
- Persisted `tableRef` (string, WMS LAYERS param) and `tableId` (number, filter-store key) at auto-save time; stripped `__autoSuggestActive` flag before persistence (resolves 11-07-SUMMARY caveat)
- Added stale-selection-clear effect in `MapConfigPanel.tsx` — swapping tables clears lat/lon/wkt/wkb/cbColumn selections that no longer exist in the new column list
- Fixed 5 post-verification bugs (Fixes A-E) in `wmsUrlBuilder.ts` and `MapChartRenderer.tsx`: hard-coded LAYERS stub, TileWMS to ImageWMS switch, render-loop, ResizeObserver updateSize, XHR+base64 imageLoadFunction
- User applied Fix F (`projection: 'EPSG:3857'` on ImageWMS source) — tiles now align with OSM basemap; Criterion 1 GREEN
- 261/261 tests passing (+11 new: 5 ChartConfigPanel + 6 MapConfigPanel)

## Task Commits

Each task was committed atomically:

1. **Task 1: ChartConfigPanel scaffold** - `a08c6c7` (feat)
2. **Task 2: MapConfigPanel stale-clear** - `17d5aff` (feat)
3. **Fix A: tableRef to LAYERS** - `e24b05e` (fix)
4. **Fix B: TileWMS to ImageWMS** - `92b7469` (fix)
5. **Fix C: render-loop (placeholder + cleanup)** - `823058c` (fix)
6. **TS fix: basemap on MapWidgetConfig** - `0a69d52` (fix)
7. **Fix D: ResizeObserver + updateSize** - `c63eea0` (fix)
8. **Fix E: XHR + base64 imageLoadFunction** - `4abb3e7` (fix)
9. **Fix F: projection EPSG:3857 on ImageWMS source (user-applied)** - `a54c9c5` (fix)

## Files Created/Modified

- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — CustomConfigPanel branch scaffold restored; handleTableChange/hasSources hoisted; tableRef+tableId persisted; __autoSuggestActive stripped
- `kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` — 5 new tests: Title+DataSource visibility, column population, tableRef/tableId persistence, __autoSuggestActive stripping, Apply/Cancel presence
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — stale-selection-clear useEffect with prevColumnsKeyRef pattern
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — 6 new stale-clear tests
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Fix A: LAYERS from `tableRef` config field (not hard-coded stub); `tableRef` added to `MapWidgetConfig`
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Fixes B/C/D/E/F: ImageWMS, render-loop fix, ResizeObserver, XHR+base64, EPSG:3857 projection
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — Fix B: ImageLayer import update

## Decisions Made

- Option A (locked in 11-09): wrap `<Custom>` in shared Title+Data Source+Apply/Cancel scaffold; preserve existing auto-save chain; rejected Option B (separate Apply/Cancel flow) which would break MapConfigPanel's save semantics and fork the AP-4 lock persistence shape
- `columnsKey = columns.map(c => c.name).join(',')` as primitive dep for stale-clear effect — avoids spurious fires from reference-unstable array re-creation in parent (S-02 pattern)
- XHR+arraybuffer+base64 for imageLoadFunction over fetch+blob — consistent with reference implementation; avoids blob URL stale-reference issues; synchronous `xhr.status` read for 401
- ResizeObserver as the authoritative trigger for `map.updateSize()` — only reliable approach when OL Map is constructed inside a grid layout container that starts at 0x0
- `projection: 'EPSG:3857'` on ImageWMS source required for tile alignment (Fix F user-discovered)
- Criterion 3 (filter tile invalidation) deferred by explicit user direction — PITFALL M-02 lock code path is in place but end-to-end effectiveness requires a future verification cycle

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fix A: wmsUrlBuilder.ts LAYERS param hard-coded to "demo.nyctaxi"**
- **Found during:** Task 3 human-verify walkthrough
- **Issue:** LAYERS param hard-coded to "demo.nyctaxi" stub; `tableRef` persisted by Task 1 was never read
- **Fix:** Added `tableRef?: string` to `MapWidgetConfig`; implemented `tableRef > layerName` precedence in `buildWmsParams`; removed stub
- **Files modified:** `kinetica_bi/src/lib/wmsUrlBuilder.ts`, spec
- **Verification:** WMS request URL shows correct LAYERS value (user-observed)
- **Committed in:** `e24b05e`

**2. [Rule 1 - Bug] Fix B: TileWMS to ImageWMS**
- **Found during:** Task 3 human-verify walkthrough
- **Issue:** `TileWMS` caused tile-seam artifacts; Kinetica WMS renders correctly as a single image
- **Fix:** Switched imports to `ol/source/ImageWMS` + `ol/layer/Image`; updated imageLoadFunction API; updated event names (`imageloadend`, `imageloaderror`)
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`, `WidgetRenderer.tsx`
- **Verification:** Map renders single-image WMS response without seam artifacts
- **Committed in:** `92b7469`

**3. [Rule 1 - Bug] Fix C: ImageWMS render loop (infinite WMS request loop)**
- **Found during:** Task 3 second re-verification attempt
- **Issue A:** `imageLoadFunction` set `image.getImage().src = ""` on non-OK response, causing browser to treat empty string as relative URL and fire another load attempt creating an infinite loop
- **Issue B:** Effect 2 did not return a cleanup that called `imageWmsSource.un()` for `imageloaderror`/`imageloadend` listeners; each config change accumulated new listeners without removing old ones
- **Fix:** Replaced `src=""` with 1x1 transparent GIF data-URL placeholder; added Effect 2 return cleanup unbinding both listeners
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`, spec (+3 tests)
- **Verification:** 255/255 tests passing; no render loop observed
- **Committed in:** `823058c`

**4. [Rule 1 - Bug] Fix D: ResizeObserver + map.updateSize() for zero-dimension container**
- **Found during:** Task 3 third re-verification attempt
- **Issue:** OL Map constructed when grid layout container is 0x0; `map.getSize()` returns [0,0] causing ImageWMS to compute NaN BBOX/WIDTH/HEIGHT; Kinetica rejects request; imageloaderror fires; loop persists
- **Fix:** `ResizeObserver` on `containerRef.current` calls `map.updateSize()` on every dimension change; `requestAnimationFrame` fires one additional `updateSize` after construction for the common case where dimensions are already available at first paint
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`, spec (+3 tests); `WidgetRenderer.spec.tsx` (ResizeObserver stub)
- **Verification:** 258/258 tests passing; map fires valid WMS request on first paint
- **Committed in:** `c63eea0`

**5. [Rule 1 - Bug] Fix E: XHR+arraybuffer+base64 imageLoadFunction**
- **Found during:** Task 3 third re-verification attempt (continued)
- **Issue:** `fetch+blob+URL.createObjectURL` had blob lifecycle issues inconsistent with working reference implementation (`KWmsOlLayer.js`)
- **Fix:** Switched to `XMLHttpRequest` with `responseType='arraybuffer'`; convert response to base64 data-URL inline via `arrayBufferToBase64` helper; `withCredentials=true` preserves session cookie auth
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`, spec (+3 tests)
- **Verification:** 261/261 tests passing; user observed valid WMS image response
- **Committed in:** `4abb3e7`

**6. [User-applied] Fix F: projection EPSG:3857 on ImageWMS source**
- **Found during:** Task 3 final verification round
- **Issue:** Tiles fetched but did not align with OSM basemap; missing `projection` on `ImageWMS` source caused OL to use default EPSG:4326 for BBOX computation while OSM basemap uses EPSG:3857
- **Fix:** User added `projection: 'EPSG:3857'` to the `ImageWMS` source constructor options
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`
- **Verification:** User-verified: Criterion 1 GREEN (tiles align with basemap)
- **Committed in:** `a54c9c5`

---

**Total deviations:** 6 fixes (all Rule 1 bugs uncovered during human UAT)
**Impact on plan:** All fixes were necessary for correct WMS tile rendering. Files outside the original `files_modified` list (`wmsUrlBuilder.ts`, `MapChartRenderer.tsx`, `WidgetRenderer.tsx`) were touched because the table-picker fix made the map widget reachable for the first time, exposing downstream WMS rendering bugs that had never been exercised end-to-end.

## Verification Result

**4/5 criteria GREEN. Criterion 3 deferred per explicit user direction.**

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Spatial picker + tiles align | GREEN |
| 2 | Four render modes, pan/zoom preserved | GREEN |
| 3 | Filter changes invalidate tiles | DEFERRED |
| 4 | Cleanup on unmount, no leak | GREEN |
| 5 | Cache-Control: no-store | GREEN |

Criterion 3 code path is in place (Effect 3 calls `wmsSourceRef.current.updateParams(...)` on filterVersion change; PITFALL M-02 lock preserved). Re-verify in a future cycle against a table with filterable data producing visibly different tile results.

## Self-Check

Must-haves from PLAN.md frontmatter `must_haves.truths`:

- [x] User can open map widget config modal and see a Title input — DONE (Task 1, commit a08c6c7)
- [x] User can open map widget config modal and see a Data Source picker — DONE (Task 1, commit a08c6c7)
- [x] User can select a table and see spatial-column dropdowns populate — DONE (Task 1 + Fix A, commits a08c6c7 + e24b05e)
- [x] Persisted widget.config contains both tableRef (string) AND tableId (number) — DONE (Task 1, commit a08c6c7)
- [x] Table swap clears stale spatial-column selections — DONE (Task 2, commit 17d5aff)
- [x] Render map widget end-to-end — Criterion 1 GREEN (user-verified after Fix F, commit a54c9c5)
- [x] All four render modes without OL Map remount — Criterion 2 GREEN (user-verified)
- [~] Filter changes invalidate tiles — DEFERRED by user direction (not FAILED; code path present via M-02 lock)
- [x] MapChartRenderer cleanup on unmount — Criterion 4 GREEN (user-verified)
- [x] Cache-Control: no-store on /api/wms — Criterion 5 GREEN (user-verified)
- [x] __autoSuggestActive does NOT leak into persisted config — DONE (Task 1 strip pattern; user spot-checked)

Partial verification is intentional per user direction. Plan tasks are all addressed.

## Caveats

- **Criterion 3 (filter-driven tile invalidation) is deferred** — re-verify in a future cycle against a table with filterable spatial data.
- **Dashboard-level layer list (multi-layer map) architecture** is OUT OF SCOPE for Phase 11; intentionally deferred to a future phase.

## Issues Encountered

Multiple re-verification rounds were required (5 total) because the table-picker fix made the map widget reachable for the first time, exposing downstream WMS rendering bugs that had never been exercised end-to-end. Each bug was discovered sequentially during browser UAT — not detectable by unit tests alone (OL Map lifecycle, browser image load behavior, WMS server projection handling).

## Next Phase Readiness

- Phase 12 (map drill-down) can inherit `tableRef`/`tableId` persistence shape and `imageLoadFunction` patterns established here
- Criterion 3 re-verification is the only remaining Phase 11 open item; it does not block Phase 12 planning
- FILT-04 requirement is partially complete (filter wiring code path in place; end-to-end effectiveness unverified)

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
