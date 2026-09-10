---
phase: 104-synchronized-map-viewports
verified: 2026-07-07T19:39:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
human_verification:
  - test: "Two sync-enabled maps move together in the browser"
    expected: "Panning or zooming one sync-enabled map causes all other sync-enabled maps on the same dashboard to pan/zoom to the same center+zoom instantly (duration:0). Maps with syncViewport OFF do not move."
    why_human: "OL view.animate behavior + React re-render timing cannot be fully asserted without a running browser; the unit tests mock OL, not the real renderer."
---

# Phase 104: Synchronized Map Viewports — Verification Report

**Phase Goal:** When a sync-enabled map widget pans/zooms, its viewport (center+zoom) is published and every OTHER sync-enabled map on the SAME dashboard pans/zooms to match — so side-by-side maps move together.
**Verified:** 2026-07-07T19:39:00Z
**Status:** PASSED
**Re-verification:** No — initial verification.

**Note on milestone scope:** Phase 104 was added to v1.19 AFTER Phase 103's verification PASS. Phase 103's VERIFICATION.md must be re-run before the v1.19 milestone closes, so it covers the final phase count.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A designer sees a "Sync map viewport" checkbox in the map config panel, default unchecked | VERIFIED | `MapConfigPanel.tsx`: getSyncViewportEnabled (2 hits: import + call), aria-label="Sync map viewport" (1 hit), VIEWPORT SYNC group (2 hits), syncViewport: e.target.checked (1 hit) |
| 2 | The mapViewportSyncStore exposes publish/clear/reset keyed by dashboardId with an originWidgetId-stamped ViewportSnapshot | VERIFIED | Store exists, exports `useMapViewportSyncStore` + `ViewportSnapshot`, has publish/clear/reset; spec passes 10/10 |
| 3 | A map config with no syncViewport field reads as sync-disabled (backward-compat) | VERIFIED | `getSyncViewportEnabled` returns `config.syncViewport ?? DEFAULT_SYNC_VIEWPORT` (false); Test B confirms no moveend listener attached |
| 4 | When a sync-enabled map finishes a pan/zoom, center+zoom is published stamped with its widget.id | VERIFIED | `map.on("moveend")` listener in MapChartRenderer (1 hit); calls `useMapViewportSyncStore.getState().publish(dashboardId, {..., originWidgetId: widget.id})`; Test A asserts publish called with correct center/zoom/originWidgetId |
| 5 | Every OTHER sync-enabled map animates to the published viewport | VERIFIED | Scoped selector `s.viewports[dashboardId]` (line 2193); `originWidgetId === widget.id` self-skip (1 hit); `view.animate({center, zoom, duration: 0})` (1 hit); Test C confirms animate called with duration:0 |
| 6 | A sync-driven move does NOT re-publish (echo-loop guard proven by test) | VERIFIED | `isSyncDrivenRef` declared (line 829), set to true before animate (line 2235), reset INSIDE moveend handler (lines 2207-2208); Test C: fires capturedMoveendHandler after animate → `publish` NOT called |

**Score:** 6/6 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/store/mapViewportSyncStore.ts` | Transient per-dashboard viewport-sync store (publish/clear/reset) | VERIFIED | Exists; exports `useMapViewportSyncStore` + `ViewportSnapshot`; has `publish`, `clear`, `reset`, `originWidgetId` |
| `packages/web/src/store/mapViewportSyncStore.spec.ts` | Pure-logic store unit tests | VERIFIED | Exists; 10 tests all passing |
| `packages/web/src/lib/mapInfoConfig.ts` | `getSyncViewportEnabled` getter + `DEFAULT_SYNC_VIEWPORT` constant | VERIFIED | Both exported; getter uses `config.syncViewport ?? DEFAULT_SYNC_VIEWPORT` |
| `packages/web/src/lib/wmsUrlBuilder.ts` | `syncViewport?: boolean` on `MapWidgetConfig` | VERIFIED | Field present at line 152; NOT emitted in WMS params (only type definition, no param-builder usage) |
| `packages/web/src/components/charts/MapConfigPanel.tsx` | Sync map viewport toggle in a config-group | VERIFIED | VIEWPORT SYNC group with config-group/config-group-label/config-toggle/config-hint classes; getSyncViewportEnabled wired; onChange writes syncViewport |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | Publish effect (moveend), subscribe effect (animate), isSyncDrivenRef echo guard | VERIFIED | 6 isSyncDrivenRef hits (decl + guard read + reset + set-before-animate + comment x2); 1 moveend listener; 1 publish call; scoped selector; duration:0 animate |
| `packages/web/src/components/charts/MapChartRenderer.spec.tsx` | OL-mock tests: publish-when-enabled, no-listen-when-disabled, guard-suppresses-echo | VERIFIED | vi.mock for mapViewportSyncStore present; Tests A/B/C all present and passing (207/207) |
| `packages/web/src/components/DashboardsPage.tsx` | mapViewportSyncStore reset in dashboard-switch cleanup chain | VERIFIED | Import present; `useMapViewportSyncStore.getState().reset()` at line 558 — after `useFilterCombinationStore.getState().reset()` at line 556 |
| `packages/web/src/App.tsx` | mapViewportSyncStore reset in logout cleanup chain | VERIFIED | Import present; `useMapViewportSyncStore.getState().reset()` at line 148 — after `useFilterCombinationStore.getState().reset()` at line 146 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| MapConfigPanel.tsx import | mapInfoConfig.getSyncViewportEnabled | `getSyncViewportEnabled` in import + call | WIRED | 2 hits (import + derivation) |
| MapConfigPanel.tsx onChange | config.syncViewport | `syncViewport: e.target.checked` | WIRED | 1 hit |
| MapChartRenderer.tsx moveend handler | useMapViewportSyncStore.publish | `map.on("moveend") → publish(dashboardId, snap) when syncEnabled && !isSyncDrivenRef` | WIRED | moveend (1), publish call (1), guard check (lines 2207-2208) |
| MapChartRenderer.tsx subscribe effect | map.getView().animate | `s.viewports[dashboardId] → view.animate({center,zoom,duration:0})` | WIRED | Scoped selector line 2193; isSyncDrivenRef.current = true before animate (line 2235) |
| DashboardsPage.tsx + App.tsx cleanup chains | useMapViewportSyncStore.reset | `getState().reset()` after useFilterCombinationStore reset | WIRED | DashboardsPage line 558; App.tsx line 148 — both after filterCombination reset |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MAPSYNC-V119-01 | 104-01 | Per-map config toggle "Sync map viewport" (default OFF) | SATISFIED | MapConfigPanel toggle; getSyncViewportEnabled defaults to false; REQUIREMENTS.md marked [x] |
| MAPSYNC-V119-02 | 104-02 | Sync-enabled map publishes viewport on pan/zoom | SATISFIED | moveend listener + publish call in MapChartRenderer; Test A passes |
| MAPSYNC-V119-03 | 104-02 | Sync-enabled map subscribes and pans/zooms to match | SATISFIED | Scoped selector + view.animate({duration:0}); Test C animate assertion |
| MAPSYNC-V119-04 | 104-02 | Programmatically moved map does not re-publish (echo guard) | SATISFIED | isSyncDrivenRef pattern (set before animate, reset inside moveend); Test C publish NOT called assertion |
| MAPSYNC-V119-05 | 104-02 | Sync scoped per-dashboard; resets on dashboard-switch + logout | SATISFIED | viewports keyed by dashboardId; reset in both DashboardsPage (line 558) and App.tsx (line 148) |
| MAPSYNC-V119-06 | 104-01, 104-02 | No-sync map byte-identical to current behavior | SATISFIED | DEFAULT_SYNC_VIEWPORT=false; syncEnabled gate prevents moveend attachment; Test B no-moveend assertion |

All 6 MAPSYNC-V119 requirement IDs declared in PLAN frontmatter are present in REQUIREMENTS.md and have implementation evidence. No orphaned requirements.

---

## Anti-Patterns Found

None. Scanned MapChartRenderer.tsx, mapViewportSyncStore.ts, MapConfigPanel.tsx, DashboardsPage.tsx, App.tsx.

- No TODO/FIXME/placeholder comments related to Phase 104 additions
- No `return null` / empty stub implementations
- No raw hex colors introduced
- No invented CSS class names (config-group, config-group-label, config-toggle, config-hint all pre-exist in global.css)
- `syncViewport` field does NOT appear in any WMS URL parameter emission path

---

## Sole-Materialize-Trigger Invariant

`grep -rE "materializeFilter|dropFilterView" packages/web/src/components/charts/` finds only pre-existing authorized call sites in `WidgetRenderer.tsx` (with comment noting AggregatedWidgetRenderer does not use them) and `CalendarRenderer.tsx` (comment explicitly notes no import). Phase 104 adds zero new materialize/dropFilterView call sites. Invariant preserved.

---

## Test Gates

| Gate | Result | Details |
|------|--------|---------|
| `npx tsc --noEmit` (web) | PASS | Clean — no output |
| `npx vitest run` (full suite) | PASS | 141 files, 3224 tests; 9 pre-existing InfoCardRenderer 401 unhandled-rejection errors (non-failing noise per CLAUDE.md) |
| `npx vitest run src/styles/theme-guard.spec.ts` | PASS | 138 tests |
| `npx vitest run src/store/mapViewportSyncStore.spec.ts` | PASS | 10 tests |
| `npx vitest run src/components/charts/MapChartRenderer.spec.tsx` | PASS | 207 tests (3 new Phase 104: Test A/B/C) |

---

## Human Verification Required

### 1. Side-by-side map sync in the browser

**Test:** Open a dashboard with two map widgets. In each map's config panel, check "Sync map viewport". Pan or zoom one map.
**Expected:** The other map immediately snaps to the same center and zoom. Panning the second map causes the first to follow. A third map with the toggle OFF does not move when the others pan.
**Why human:** OL `view.animate` behavior and React re-render timing with a real OL Map instance cannot be asserted in unit tests that mock OL. The mock validates call signatures but not the actual pixel-level viewport update.

### 2. No echo / oscillation

**Test:** With two sync-enabled maps, rapidly pan one map back and forth.
**Expected:** No oscillation or feedback loop — maps move together without bouncing between positions.
**Why human:** The isSyncDrivenRef guard is proven by Test C in unit tests, but real OL event ordering (especially with rapid interactions) can differ from the mock. Human observation confirms no oscillation in practice.

---

## Gaps Summary

No gaps. All 6 requirements verified, all artifacts exist and are substantive, all key links wired, all test gates green, no blocker anti-patterns.

---

_Verified: 2026-07-07T19:39:00Z_
_Verifier: Claude (gsd-verifier)_
