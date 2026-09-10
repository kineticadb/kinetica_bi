---
phase: 41-layerslegendpanel-in-map-overlay
verified: 2026-05-22T00:00:00Z
status: passed
score: 5/5 success criteria verified; 7/7 REQ-IDs satisfied
re_verification: false
---

# Phase 41: LayersLegendPanel + In-Map Overlay — Verification Report

**Phase Goal:** Every map widget can show a floating Layers Legend Panel overlay that lists all layers and, for classbreak layers, renders color-swatch rows matching the configured breaks — togglable via MapConfigPanel, collapsible per session, React-tree-mounted to avoid the OL addOverlay DOM tracking lesson from v1.6.

**Verified:** 2026-05-22
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `<LayersLegendPanel />` is pure presentational — accepts `layers: ResolvedLegendLayer[]` prop with no internal store subscriptions; callers use `legendKey` primitive selector | VERIFIED | LayersLegendPanel.tsx: zero Zustand imports confirmed (grep returns empty); legendKey at MapChartRenderer.tsx:533 is `.join("|")` primitive string |
| 2 | Toggling "Show Layers Panel" in MapConfigPanel immediately shows/hides overlay; `legendPanelEnabled` persists via PATCH so panel survives reload | VERIFIED | MapConfigPanel.tsx:370-371 fires `onChange({...config, legendPanelEnabled})` → ChartConfigPanel.tsx:423 calls `onSave` → DashboardsPage.tsx:552 calls `updateWidget` → client.ts:342 `PATCH /api/widgets/:id` |
| 3 | Overlay is React child of MapChartRenderer container (NOT OL `addOverlay`); anchored to configurable corner; doesn't block draw-mode clicks | VERIFIED | MapChartRenderer.tsx:1929-1938: JSX-only mount (comment explicitly: "React tree only — NOT OL addOverlay"). CSS line 2947: `pointer-events: auto` on panel bounds only. Corner modifier classes at 8px offsets (global.css:2950-2953) |
| 4 | Header click toggles collapse/expand; collapse state session-only (not SQLite) | VERIFIED | MapChartRenderer.tsx:559 `const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false)` — never written to config or PATCH. onToggleCollapse:1937 flips local state only |
| 5 | While LayersModal open + CB layer being edited, in-map panel reflects live cb_config from store | VERIFIED | legendKey at MapChartRenderer.tsx:537 includes `l.cb_config ?? "null"` — any cb_config mutation changes the primitive string → useMemo at :547 recomputes from `getState().layers` with fresh data |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/legendPanelConfig.ts` | 6 exports: LEGEND_PANEL_CORNERS, LegendPanelCorner type, DEFAULT_LEGEND_PANEL_ENABLED, DEFAULT_LEGEND_PANEL_CORNER, getLegendPanelEnabled, getLegendPanelCorner | VERIFIED | All 6 exports present; 26 lines; correct defaults (false / 'top-right') |
| `src/lib/legendPanelConfig.spec.ts` | 13 tests | VERIFIED | 13 `it(` calls confirmed |
| `src/lib/wmsUrlBuilder.ts` | `legendPanelEnabled?: boolean` + `legendPanelCorner?` fields on MapWidgetConfig | VERIFIED | Lines 138-139: both optional fields present with exact union type |
| `src/components/LayersLegendPanel.tsx` | ~177 lines; pure presentational; ZERO Zustand imports | VERIFIED | 177 lines; grep for `useDashboardLayersStore` returns empty; props-only interface |
| `src/components/LayersLegendPanel.spec.tsx` | 16 tests | VERIFIED | 16 `it(` calls confirmed |
| `src/styles/global.css` | 12+ `.layers-legend-panel*` selectors; z=1000; 4 corner modifiers at 8px | VERIFIED | 13 selector occurrences (grep -c); z-index:1000 at line 2937; 4 corner offsets at top/right/bottom/left:8px (lines 2950-2953) |
| `src/components/charts/MapConfigPanel.tsx` | LAYERS PANEL section: toggle + conditional 4-option corner picker | VERIFIED | Lines 356-396: LAYERS PANEL group, checkbox at :367, conditional corner select at :381-393 with 4 options |
| `src/components/charts/MapConfigPanel.spec.tsx` | 11 new Phase 41 tests | VERIFIED | "LAYERS PANEL section (Phase 41)" describe block contains 11 `it(` calls |
| `src/components/charts/MapChartRenderer.tsx` | legendKey selector + resolvedLegendLayers useMemo + legendCollapsed useState + LayersLegendPanel JSX mount after MapDrawToolbar | VERIFIED | Lines 533-556 (legendKey + useMemo); line 559 (useState); lines 1929-1938 (JSX mount after MapDrawToolbar at :1921) |
| `src/components/charts/MapChartRenderer.spec.tsx` | 14 new Phase 41 tests | VERIFIED | "LayersLegendPanel mount (Phase 41)" describe block: 13 `it(` calls + 1 additional Test 9b = 14 total |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| MapConfigPanel onChange | PATCH /api/widgets/:id | ChartConfigPanel.onSave → updateWidget | WIRED | MapConfigPanel.tsx:371 fires onChange; ChartConfigPanel.tsx:423 calls onSave; DashboardsPage.tsx:552 calls updateWidget; client.ts:342 PATCH |
| legendKey (primitive selector) | resolvedLegendLayers (useMemo) | useMemo [legendKey, includedLayerIdsForLegend] | WIRED | MapChartRenderer.tsx:533-556: legendKey change invalidates memo; getState().layers read at :548 fetches fresh data |
| resolvedLegendLayers | LayersLegendPanel JSX | `layers={resolvedLegendLayers}` prop | WIRED | MapChartRenderer.tsx:1933-1934 |
| getLegendPanelEnabled | LayersLegendPanel mount gate | `{getLegendPanelEnabled(widgetConfig) && <LayersLegendPanel...>}` | WIRED | MapChartRenderer.tsx:1932 |
| legendCollapsed useState | onToggleCollapse handler | `setLegendCollapsed((c) => !c)` | WIRED | MapChartRenderer.tsx:1937 — pure local flip, no PATCH |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PANEL-V17-01 | 41-01 | Pure presentational `<LayersLegendPanel />` — no store subscriptions | SATISFIED | LayersLegendPanel.tsx has zero Zustand imports; Test 14 in spec.tsx asserts this with fs.readFileSync audit |
| PANEL-V17-02 | 41-02 | legendKey primitive selector (PITFALL S-02) | SATISFIED | MapChartRenderer.tsx:533-540: `.join("\|")` primitive; Test 12 in MapChartRenderer.spec.tsx source-locks this |
| PANEL-V17-03 | 41-02 | In-map overlay as React child (NOT OL addOverlay); configurable corner; no interaction block | SATISFIED | JSX mount at :1929-1938; CSS `pointer-events: auto` scoped to panel; 3 pre-existing addOverlay calls are for popup/shapes/draw-tip — legend has none |
| PANEL-V17-04 | 41-01 | `legendPanelEnabled?: boolean` on MapWidgetConfig; persisted via PATCH | SATISFIED | wmsUrlBuilder.ts:138; persistence chain confirmed (onChange → onSave → updateWidget → PATCH) |
| PANEL-V17-05 | 41-02 | MapConfigPanel "Show Layers Panel" toggle | SATISFIED | MapConfigPanel.tsx:363-395: full LAYERS PANEL section with toggle + conditional corner picker |
| PANEL-V17-06 | 41-02 | Collapsible panel; session-only (not persisted) | SATISFIED | MapChartRenderer.tsx:559: `useState<boolean>(false)` — never written to config or PATCH; LayersLegendPanel.tsx:120 `{!collapsed && <div...>}` |
| PANEL-V17-07 | 41-02 | Live cb_config reflected in panel during LayersModal edit | SATISFIED | legendKey includes `l.cb_config` at :537; any store mutation changes key → memo recomputes with `getState().layers` fresh data |

---

### Specific Lock Verification

| Lock | Expected | Status | Evidence |
|------|----------|--------|----------|
| LayersLegendPanel Zustand-free | ZERO `useDashboardLayersStore` imports | PASS | grep returns empty on LayersLegendPanel.tsx |
| No OL addOverlay for legend | Legend panel is React-child only | PASS | MapChartRenderer.tsx: 3 addOverlay calls (lines 1301/1599/1654) all pre-Phase-41 (popup overlay / shape measurement overlays / draw-tip overlay). No 4th call added. Comment at :1930 confirms intent. |
| lastEmittedParamsRef fingerprint unchanged | Phase 41 does not touch WMS emission | PASS | Fingerprint at lines 1152/1242 unchanged: `JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config })` |
| Popup container at position 0 | Phase 35 invariant — first child of .widget-map | PASS | MapChartRenderer.tsx:1844-1868: popup container is first JSX child; Test 5 in MapChartRenderer.spec.tsx asserts `firstChild.classList.contains("info-popup-overlay-element")` |
| legendKey is primitive string | No array selector | PASS | `.join("\|")` at MapChartRenderer.tsx:539; Test 12 source-locks this |
| z=1000 panel / z=1001 toolbars | V15-P-17 lock | PASS | global.css:2937 `z-index: 1000` for panel; :1670/:1683 `z-index: 1001` for draw/zoom toolbars |
| Collapse state session-only | NOT PATCH-persisted | PASS | `useState<boolean>(false)` at :559; `setLegendCollapsed` never appears in onChange/onSave chain |
| `<other>` rendered verbatim | No titlecasing | PASS | LayersLegendPanel.tsx:78: `return String(brk.value)` — no case transformation; Test 6 in spec.tsx asserts `screen.getByText("<other>")` exact match |
| No numeric range computation in CB rows | Rows show label/value only | PASS | LayersLegendPanel.tsx:75-79: `breakDisplayText` returns label or `String(value)` — no arithmetic |
| A11y: role/aria attributes | role="region" + aria-label + aria-expanded + aria-controls | PASS | LayersLegendPanel.tsx:97/105/106; Test 12 in spec.tsx validates all four |

---

### Anti-Patterns Found

None detected. No TODO/FIXME/placeholder comments in Phase 41 files. No stub implementations. No empty handlers.

---

### Human Verification Required

The following behaviors require live UAT (scheduled for Phase 43):

1. **Panel visual rendering in browser**
   - Test: Enable "Show Layers Panel" on a map widget with mixed raster + classbreak layers
   - Expected: Floating panel appears in configured corner, correctly bounded within widget, not overlapping OL attribution/zoom controls
   - Why human: CSS positioning + backdrop-filter + visual layering cannot be verified by unit tests

2. **Draw mode interaction isolation**
   - Test: Enable draw mode while legend panel is visible; attempt polygon draw across panel bounds
   - Expected: OL draw interaction works normally; panel does not block draw clicks outside its CSS bounds
   - Why human: `pointer-events: auto` on panel only blocks events within its visual bounds; OL canvas behind it is unaffected — requires live pointer event testing

3. **Panel survives dashboard reload**
   - Test: Enable panel, close and reopen dashboard, verify panel appears without re-toggling
   - Expected: `legendPanelEnabled: true` is persisted to SQLite via PATCH and loaded on next render
   - Why human: End-to-end persistence requires live server + SQLite round-trip

---

### Gaps Summary

No gaps. All 5 success criteria verified, all 7 requirement IDs satisfied, all specific locks confirmed clean.

---

_Verified: 2026-05-22_
_Verifier: Claude (gsd-verifier)_
