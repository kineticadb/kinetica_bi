---
phase: 111-map-default-view-capture-save
verified: 2026-09-09T19:15:12Z
status: passed
score: 7/7 must-haves verified
human_verification:
  - test: "Open a map widget's config panel while the map is framed on a known location (e.g. pan/zoom to New York), and read the 'Set as default — zoom X · LAT°N/S, LON°E/W' button label."
    expected: "The coordinates and zoom shown match what was actually framed on the map, are legible against the button's accent fill in both light and dark theme, and the button text does not overflow/wrap awkwardly at typical panel width."
    why_human: "Correctness of the live transform math is unit-tested against real ol/proj, but whether the rendered string is visually legible, doesn't clip, and 'looks right' at a glance (the entire point of the LOCKED decision) requires a human looking at a real browser."
  - test: "Save a default, then reopen the config panel without navigating away, and confirm the 'Current default: zoom ... ' hint line updates immediately to reflect the new save (passive confirmation, no toast)."
    expected: "The hint line flips to the new value on the same render the click causes; no stale display, no flash of old value."
    why_human: "This is a live re-render/re-read behavior across the auto-save debounce path; components are unit-tested in isolation with mocked stores, not through the real end-to-end auto-save timing in a browser."
  - test: "With two map widgets on one dashboard, frame each differently, open widget A's config, confirm its readout reflects A's view (not B's) — MAPVIEW-V121-06 at the whole-app level."
    expected: "Each panel's live readout and Set-as-default label always match the map widget it was opened for, never the other map's view."
    why_human: "Per-widget isolation is unit-tested at the store and component layer with mocked widgetIds; a real two-map dashboard render is the only way to confirm no cross-talk in practice."
---

# Phase 111: Map Default View — Capture & Save Verification Report

**Phase Goal:** A designer can capture a map widget's exact current view and persist or clear it as that widget's default, from the map's own config panel.
**Verified:** 2026-09-09T19:15:12Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A widgetId-keyed store holds one live `{center, zoom}` per map widget, isolated per widget, resettable | ✓ VERIFIED | `mapCurrentViewStore.ts` — `views: Record<number, MapCurrentView \| undefined>`, `publish`/`clear`/`reset`; spec passes (9+ tests incl. per-widget isolation P3, exact-fractional-zoom P4) |
| 2 | Every mounted map publishes its live view continuously (mount + moveend), regardless of the Sync viewport toggle | ✓ VERIFIED | `MapChartRenderer.tsx` Effect 9c: `if (!map) return;` is the ONLY guard, no `syncEnabled`/`dashboardId`/`isSyncDrivenRef` reference in the effect body; `publishCurrent()` called once at mount before `map.on("moveend", ...)` is attached |
| 3 | The control shows a LIVE readout of the view it would capture, not a bare button | ✓ VERIFIED | `MapConfigPanel.tsx` button label is `` `Set as default — zoom ${formatZoom(...)} · ${formatLatLon(...)}` ``, disabled when no live view; never a plain "Save" |
| 4 | Coordinates display human-readable, never raw EPSG:3857 metres | ✓ VERIFIED | `formatLatLon` transforms EPSG:3857→EPSG:4326 and renders `"40.71°N, 74.01°W"`; spec `mapViewFormat.spec.ts` locks the exact NYC fixture string with real (unmocked) `ol/proj` |
| 5 | When a default already exists, both the saved default and the pending replacement are shown | ✓ VERIFIED | `MapConfigPanel.tsx` renders `Current default: zoom … · …` hint line AND the button's own live `Set as default — zoom … · …` label simultaneously; `MapConfigPanel.spec.tsx` Test D5 asserts both strings present |
| 6 | The stored zoom is the exact unrounded fractional value; rounding is display-only | ✓ VERIFIED | `saveDefaultView` in `MapConfigPanel.tsx` writes `zoom: currentView.zoom` verbatim (no `.toFixed`/`Math.round`); `formatZoom` is called only in JSX for display; spec Test D4 asserts `.zoom` strictly `12.437` after save |
| 7 | Clicking Clear removes `config.defaultView` entirely (key deleted, not undefined) | ✓ VERIFIED | `clearDefaultView` does `delete next.defaultView;` then `onChange(next)`; spec Test D7 asserts `hasOwnProperty(..., "defaultView")` is `false` |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/store/mapCurrentViewStore.ts` | widgetId-keyed live-view store (publish/clear/reset) | ✓ VERIFIED | Exists, matches interface exactly, no sync gate, "13th store" documented; spec passes |
| `packages/web/src/lib/mapViewFormat.ts` | EPSG:3857 → human-readable formatting | ✓ VERIFIED | `formatLatLon`/`formatZoom` exist, exact output matches locked fixtures; spec exercises real `ol/proj` |
| `packages/web/src/lib/wmsUrlBuilder.ts` | `MapWidgetConfig.defaultView` optional field | ✓ VERIFIED | `defaultView?: { center: [number, number]; zoom: number };` present exactly once, not wired into WMS param-building |
| `packages/web/src/lib/mapInfoConfig.ts` | `getDefaultView` canonical getter | ✓ VERIFIED | `getDefaultView(config)` returns `config.defaultView` verbatim, no clamping; spec covers absent/undefined/zoom-0 edge cases |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | Effect 9c — always-on publish + unmount clear | ✓ VERIFIED / WIRED | Effect present at line ~2256, imported at line 102, called with `widget.id`; scope fence intact (`center: [0,0]` / `zoom: 2` unchanged at line 1039-1040, zero `defaultView` references in file) |
| `packages/web/src/App.tsx` | logout reset-chain membership (13th store) | ✓ VERIFIED / WIRED | Import line 27, `useMapCurrentViewStore.getState().reset();` line 156, placed after `useFilterHighlightStore` (12th) reset at line 152 |
| `packages/web/src/components/DashboardsPage.tsx` | dashboard-switch reset-chain membership (13th store) | ✓ VERIFIED / WIRED | Import line 58, reset at line 582, placed after `useFilterHighlightStore` reset at line 579 |
| `packages/web/src/components/charts/MapConfigPanel.tsx` | DEFAULT VIEW config-group: live readout, Set-as-default, Clear | ✓ VERIFIED / WIRED | Section present between `VIEWPORT SYNC` and `LAYERS PANEL`; scoped selector `s.views[widgetId]`; save/clear logic correct; only pre-existing `global.css` classes used, no hex, no inline styles |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `mapViewFormat.ts` | `ol/proj` | `transform(center, 'EPSG:3857', 'EPSG:4326')` | ✓ WIRED | Line 18, exact signature match |
| `mapInfoConfig.ts` | `MapWidgetConfig.defaultView` | `getDefaultView` accessor | ✓ WIRED | Returns `config.defaultView` directly |
| `MapChartRenderer.tsx` | `mapCurrentViewStore.ts` | `getState().publish(widget.id, ...)` on mount + moveend | ✓ WIRED | `publishCurrent()` called immediately, then on every `moveend` via `map.on("moveend", publishCurrent)` |
| `MapChartRenderer.tsx` | `mapCurrentViewStore.ts` | `getState().clear(widget.id)` in unmount cleanup | ✓ WIRED | Present in the effect's returned cleanup function alongside `unByKey(key)` |
| `MapConfigPanel.tsx` | `mapCurrentViewStore.ts` | scoped selector `s.views[widgetId]` | ✓ WIRED | `useMapCurrentViewStore((s) => widgetId === undefined ? undefined : s.views[widgetId])` — confirmed NOT `(s) => s.views` (whole-object subscription absent) |
| `MapConfigPanel.tsx` | `config.defaultView` | `onChange({...config, defaultView})` / `delete next.defaultView` | ✓ WIRED | Both save and clear paths present and correct |
| `MapConfigPanel.tsx` | `mapViewFormat.ts` | `formatZoom`/`formatLatLon` in the readout | ✓ WIRED | Both used in both the hint line and the button label |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| MAPVIEW-V121-01 | 111-01, 111-02, 111-03 | Designer can save a map widget's current zoom and center as that widget's default view, from the map's config | ✓ SATISFIED | Full path verified: live view published (111-02) → panel readout + save writes `config.defaultView` with exact unrounded zoom (111-03) → field exists on `MapWidgetConfig` (111-01). `REQUIREMENTS.md` correctly marks this **Complete**. |
| MAPVIEW-V121-04 | 111-01, 111-03 | Designer can clear a saved default view, returning that map to the world view | ~ PARTIALLY SATISFIED (honestly recorded) | The "clear" mechanism itself (delete `config.defaultView` key, panel reverts to "No default — opens at world view" text) IS fully implemented and spec-covered in this phase. The full requirement text ("returning that map to the world view") additionally requires the map to actually re-render at world view after a clear, which depends on Phase 112 reading `getDefaultView()`/falling back to `[0,0]`/zoom 2 on load — not yet built (`MapChartRenderer.tsx` has zero `defaultView` references, confirmed). `REQUIREMENTS.md` records this as **"In Progress (111-01/02/03 done; world-view fallback lands in Phase 112)"** — this is accurate, not overclaimed. |

No orphaned requirements: `REQUIREMENTS.md`'s "Phase 111" rows (MAPVIEW-V121-01, -04) exactly match the `requirements:` frontmatter declared across all three plans; no additional Phase-111-mapped ID was found undeclared.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found in phase-111-modified code. (`MapChartRenderer.tsx`'s pre-existing `TRANSPARENT_PLACEHOLDER` constant at line 926 is unrelated WMS-tile-loading code, not touched by this phase.) |

### Human Verification Required

See frontmatter `human_verification` — three items concerning visual legibility of the live readout, live re-render timing of the "Current default" hint after save, and cross-widget isolation on a real multi-map dashboard. None of these are believed to be broken; they are simply outside what grep/unit-tests can establish, per the task's explicit instruction to flag them.

### Gaps Summary

No gaps. All 7 derived observable truths (including all `111-CONTEXT.md` LOCKED decisions) are verified directly against the code:

- **Live readout, not a bare button** — confirmed (button label always carries the live `zoom … · lat/lon` string, disabled with plain "Set as default" text only when no live view exists).
- **Human-readable coordinates, never raw EPSG:3857** — confirmed (`formatLatLon` is the only place a centre reaches the UI; the underlying `defaultView` field storing EPSG:3857 is never displayed raw).
- **Both saved default and pending replacement shown together** — confirmed (hint line + button label render simultaneously; spec locks this).
- **Stored zoom is exact/unrounded; only display rounds** — confirmed (`saveDefaultView` passes `currentView.zoom` straight through with no `toFixed`/rounding; `formatZoom` is display-only and called nowhere near the save path).
- **Scope fence** — confirmed. `MapChartRenderer.tsx` still constructs its View with `center: [0, 0], zoom: 2` (line 1039-1040) and contains zero occurrences of `defaultView` anywhere in the file.
- **Always-on, ungated publish** — confirmed. Effect 9c's only guard is `if (!map) return;`; no `syncEnabled`/`syncViewport`/`dashboardId`/`isSyncDrivenRef` token appears anywhere in the effect body (only in its explanatory comments, which explicitly warn against adding one).
- **Initial publish at mount** — confirmed. `publishCurrent()` is invoked synchronously inside the effect before `map.on("moveend", ...)` is registered.
- **Scoped store subscription** — confirmed. `MapConfigPanel.tsx` subscribes via `useMapCurrentViewStore((s) => widgetId === undefined ? undefined : s.views[widgetId])`; a whole-store subscription (`(s) => s.views`) is absent.
- **Store cleanup in both chains** — confirmed in both `App.tsx` (logout) and `DashboardsPage.tsx` (dashboard-switch), each placed correctly after the existing 12th-store (`useFilterHighlightStore`) reset, documented as the 13th store.
- **No invented classNames, no hardcoded hex** — confirmed. All 8 classNames introduced in `MapConfigPanel.tsx` (`config-group`, `config-group-label`, `config-hint`, `ds-actions`, `btn-primary`, `btn-sm`, `ghost-sm`, `ghost-danger`) exist in `global.css`; zero hex literals, zero inline `style={{...}}` in the file.
- **Requirements honesty** — `REQUIREMENTS.md` accurately distinguishes MAPVIEW-V121-01 (Complete) from MAPVIEW-V121-04 (In Progress, explicitly noting the world-view-fallback dependency on Phase 112). This is not overclaimed and not underclaimed.

Full verification run from `packages/web`: `npx tsc --noEmit` clean; targeted specs (`mapCurrentViewStore`, `mapViewFormat`, `mapInfoConfig`, `MapChartRenderer`, `MapConfigPanel`, `App`, `DashboardsPage`, `theme-guard`) — 8 files / 595 tests passing; full `npx vitest run` — 161 files / 3641 tests passing, 0 failures.

---

*Verified: 2026-09-09T19:15:12Z*
*Verifier: Claude (gsd-verifier)*
