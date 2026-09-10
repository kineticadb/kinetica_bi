---
phase: 11
status: human_needed
verified: 2026-05-05
verified_by: human-uat
deferred_criteria: [3]
---

# Phase 11 — End-to-End Verification

**Verification date:** 2026-05-05
**Verifier:** RPereira@kinetica.com

---

## Verdict

**4/5 criteria GREEN — Criterion 3 deferred per user direction (filter-tile invalidation deferred to a future verification cycle).**

---

## Per-Criterion Status

| # | Criterion | Status | Evidence / Notes |
|---|-----------|--------|------------------|
| 1 | Spatial picker + tiles align | GREEN | User-verified after adding `projection: 'EPSG:3857'` to ImageWMS source (commit a54c9c5). LAYERS=`<schema.table>`, valid BBOX/WIDTH/HEIGHT, single-image render. Table picker now visible in map config modal (ChartConfigPanel scaffold restored, 11-10 Task 1). |
| 2 | Four render modes, pan/zoom preserved | GREEN | User-verified. Mode switch does not remount OL Map; pan/zoom position preserved across mode transitions. |
| 3 | Filter changes invalidate tiles | **DEFERRED** | User explicitly deferred verification. Code path unchanged from Phase 11-06 — Effect 3 calls `wmsSourceRef.current.updateParams(...)` on filterVersion change (PITFALL M-02 lock preserved). Re-verify in a future cycle. |
| 4 | Cleanup on unmount, no leak | GREEN | User-verified. OL Map disposed on unmount; no console warnings; ResizeObserver disconnected. |
| 5 | Cache-Control: no-store | GREEN | User-verified. `/api/wms` response headers contain `Cache-Control: no-store` on all tile requests. |

---

## What Was Fixed in 11-10

Commits in chronological order:

| Commit | Summary |
|--------|---------|
| `a08c6c7` | Task 1: Restored Title + Data Source scaffold for CustomConfigPanel branch; persists `tableRef` + `tableId`; strips `__autoSuggestActive`; 5 new ChartConfigPanel specs GREEN. |
| `17d5aff` | Task 2: MapConfigPanel stale-selection-clear effect on table swap; 6 new MapConfigPanel specs GREEN. |
| `e24b05e` | Fix A: wmsUrlBuilder.ts LAYERS param hard-coded to "demo.nyctaxi" stub — replaced with `tableRef` field from widget config (Rule 1 bug, found during Task 3 walkthrough). |
| `92b7469` | Fix B: MapChartRenderer TileWMS → ImageWMS switch; eliminates tile-seam artifacts; updates load-function API and event names (Rule 1 bug). |
| `823058c` | Fix C: ImageWMS render loop — replaced `image.src = ""` with 1x1 transparent GIF placeholder; added Effect 2 cleanup unbinding imageloaderror/imageloadend listeners (Rule 1 bug). |
| `0a69d52` | TS fix: added `basemap` field to `MapWidgetConfig` type; resolved type error surfaced by Fix A/B work. |
| `c63eea0` | Fix D: ResizeObserver + `map.updateSize()` — OL Map constructed with zero pixel dimensions (0×0 container in grid layout) produced NaN BBOX/WIDTH/HEIGHT; observer calls `updateSize()` on first real-size paint (Rule 1 bug). |
| `4abb3e7` | Fix E: Switched `imageLoadFunction` from fetch+blob to XHR+arraybuffer+base64; eliminates blob URL stale-reference issues; preserves session cookie auth; 401 dispatches UNAUTHORIZED_EVENT (Rule 1 bug). |
| `a54c9c5` | Fix F: Added `projection: 'EPSG:3857'` to ImageWMS source (user-applied); tiles now align with OSM basemap — completing Criterion 1. |

---

## Caveats / Follow-ups

- Criterion 3 (filter-driven tile invalidation) is deferred — re-verify in a future cycle. Code path via `wmsSourceRef.current.updateParams(...)` on filterVersion change is in place (PITFALL M-02 lock); end-to-end effectiveness requires a table with filterable data that produces visibly different tile results.
- `__autoSuggestActive` draft flag confirmed stripped before persistence (Fix A in Task 1; `{ __autoSuggestActive: _drop, ...persistedConfig }` pattern in ChartConfigPanel.tsx CustomConfigPanel branch).
- Dashboard-level layer list (multi-layer map) architecture is OUT OF SCOPE for Phase 11; intentionally deferred to a future phase.
