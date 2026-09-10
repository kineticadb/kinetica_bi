---
phase: 38-schema-wms-engine-foundation
plan: "02"
subsystem: frontend-lib, frontend-component, frontend-api
tags: [wms-url-builder, classbreak, track, lane-c, tdd, regression-spec, dto-extension]
dependency_graph:
  requires:
    - "38-01: coalesceCbConfig + isCbConfigConfigured from lib/cbConfig.ts"
    - "38-01: PATCH /api/dashboards/:id/layers/:layerId accepts cb_config + track_config"
  provides:
    - "wmsUrlBuilder.ts Lane C cb_raster branch keyed on cb_config (SCHEMA-V17-03)"
    - "wmsUrlBuilder.ts TrackConfig type + coalesceTrackConfig helper"
    - "wmsUrlBuilder.ts Track block DOTRACKS + TRACK_* params (SCHEMA-V17-04)"
    - "wmsUrlBuilder.ts 8-char AARRGGBB color emission via normalizeAARRGGBB (SCHEMA-V17-05)"
    - "wmsUrlBuilder.spec.ts 34 new regression specs locking Lane C + Track + color + _mv + backward-compat"
    - "DashboardLayerDto cb_config: string | null + track_config: string | null (byte-parity with server DashboardLayer)"
    - "updateLayer Pick<> extended with cb_config + track_config"
    - "MapChartRenderer.lastEmittedParamsRef extended fingerprint { p, c, t }"
  affects:
    - "Phase 39: CB form UI reads coalesceCbConfig(layer.cb_config) from typed DashboardLayerDto"
    - "Phase 40: Track form UI reads coalesceTrackConfig(layer.track_config)"
    - "Phase 41: LayersLegendPanel reads cb_config.breaks[].label (client-only)"
    - "Phase 43: UAT includes CB tile visual verification + Track visual (pending demo.track fixture)"
tech_stack:
  added: []
  patterns:
    - "TDD RED→GREEN per task (spec blocks appended before implementation changes)"
    - "Hard cutover with grep-verified absence of Lane A naming (CB_COLUMN_NAME / CB_BREAK_POINT_N / CB_POINTCOLOR_N)"
    - "Inline TrackConfig type single-consumer pattern (Phase 40 extracts if second consumer surfaces)"
    - "Optional 5th arg overload for backward compat with legacy 2-arg / 4-arg callers"
    - "Fingerprint keyed object { p: wmsParams, c: cb_config, t: track_config } for PATCH-coalesced edit detection"
key_files:
  created: []
  modified:
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx
    - kinetica_bi/src/components/charts/InfoPopup.spec.tsx
    - kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
    - kinetica_bi/src/components/LayersModal.spec.tsx
    - kinetica_bi/src/store/dashboardLayersStore.spec.ts
decisions:
  - "STYLES_BY_MODE.classbreak swapped from 'classbreak' to 'cb_raster' — single Lane C path"
  - "TrackConfig type + coalesceTrackConfig kept inline in wmsUrlBuilder.ts — single consumer for v1.7; Phase 40 extracts if 2nd consumer surfaces"
  - "buildWmsParams 5th arg layerJsonFields optional — legacy 2-arg / 4-arg callers unchanged (no overload churn)"
  - "Legacy classbreak describe block in spec replaced with STYLES_BY_MODE swap test + absence-of-Lane-A-naming test"
  - "8 spec files updated with cb_config: null + track_config: null fixtures as Deviation Rule 2 (missing required fields on extended DTO)"
metrics:
  duration: "~9 minutes"
  completed: "2026-05-19"
  tasks: 3
  files: 12
---

# Phase 38 Plan 02: WMS URL Builder Rewrite Summary

**One-liner:** wmsUrlBuilder.ts hard-cutover from Lane A (CB_COLUMN_NAME + CB_BREAK_POINT_N) to Lane C (STYLES=cb_raster + CB_ATTR + CB_VALS + POINTCOLORS via coalesceCbConfig), with TrackConfig + DOTRACKS block, 8-char AARRGGBB color fix, 34 new regression specs, DashboardLayerDto byte-parity extension, and MapChartRenderer fingerprint extension.

## What Was Built

### Task 1 — wmsUrlBuilder.ts rewrite + wmsUrlBuilder.spec.ts regression specs

**Files modified:** `kinetica_bi/src/lib/wmsUrlBuilder.ts`, `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts`

#### STYLES_BY_MODE swap

`STYLES_BY_MODE.classbreak` changed from `"classbreak"` to `"cb_raster"`. This is the Phase 37 Lane C lock — a single CB emission path. The comment was updated to reference 37-SPIKE-NOTES.md ## Decision. Lane B (`STYLES=classbreak` + `CB_POINTCOLORS`) is documented in 37-SPIKE-NOTES.md only; not used in production.

#### Lane C cb_raster branch (replaces deleted Lane A branch)

The existing `} else if (config.renderMode === "classbreak") {` block (Lane A: `CB_COLUMN_NAME` / `CB_BREAK_TYPE` / `CB_BREAK_POINT_N` / `CB_POINTCOLOR_N`) was DELETED and replaced with the Lane C branch:

```typescript
const cb = layerJsonFields ? coalesceCbConfig(layerJsonFields.cb_config) : null;
if (cb && isCbConfigConfigured(cb)) {
  params.CB_ATTR = cb.attr;
  params.CB_VALS = cb.breaks.map((b) => String(b.value)).join(",");
  params.POINTCOLORS = cb.breaks.map((b) => normalizeAARRGGBB(b.color, "FF000000")).join(",");
  // Optional per-break fields emitted only when at least one break sets them
}
```

Hard cutover lock: `config.classbreaks[]` and `config.cbColumn` are NEVER read (confirmed by grep-negative acceptance criteria).

#### TrackConfig type + coalesceTrackConfig helper (inline)

Exported from `wmsUrlBuilder.ts` since it is the sole consumer in Phase 38. Phase 40 form UI may extract to `lib/trackConfig.ts` if a second consumer surfaces.

#### Track block (additive)

Appended after the render-mode branch, before `return params`:

```typescript
if (layerJsonFields?.track_config) {
  const tc = coalesceTrackConfig(layerJsonFields.track_config);
  if (tc.enabled && (config.renderMode === "raster" || config.renderMode === "classbreak")) {
    params.DOTRACKS = "TRUE";
    // Under cb_raster: expand to N = breaks.length; under raster: single-value
    const expand = (v: string) => Array.from({ length: n }, () => v).join(",");
    // ... emit TRACKHEADCOLORS, TRACKLINECOLORS, TRACKHEADSIZES, TRACKLINEWIDTHS, TRACKMARKERSHAPES
  }
}
```

#### buildWmsParams signature extension

Added optional 5th param `layerJsonFields?: { cb_config: string | null; track_config: string | null }`. Existing 2-arg and 4-arg callers are unaffected (backward-compat preserved). The new overload signature was added before the existing 4-arg overload.

#### 8-char AARRGGBB color fix (SCHEMA-V17-05)

`normalizeAARRGGBB(b.color, "FF000000")` replaces the old `b.color.toUpperCase()` — legacy 6-char break colors become `FF + RRGGBB`. Same conformance as the raster + heatmap branches already had.

#### New regression specs (34 new tests)

New describe blocks appended to `wmsUrlBuilder.spec.ts`:

| Describe | Tests | What it locks |
|----------|-------|---------------|
| Lane C cb_raster (SCHEMA-V17-03) | 6 | STYLES=cb_raster, CB_ATTR+CB_VALS+POINTCOLORS, `<other>` verbatim, optional per-break fields, no Lane A/B naming, null fall-through |
| 8-char AARRGGBB regression lock (SCHEMA-V17-05) | 2 | 6-char input → FF+RRGGBB, 8-char input → preserved verbatim |
| Track block (SCHEMA-V17-04) | 4 | single-value under raster, N comma-sep under cb_raster, disabled → no emit, heatmap → no emit |
| backward-compat URL snapshot | 2 | legacy 2-arg raster call → identical URL, legacy classbreaks[] ignored on null cb_config |
| `_mv` cache-bust preservation | 2 | _mv=42 still emits, null track_config → zero Track params |

The existing classbreak describe block was REPLACED with 2 tests covering the STYLES_BY_MODE swap (STYLES=cb_raster) and absence of Lane A naming.

**Total spec count:** 78 tests, 78 passing.

### Task 2 — MapChartRenderer lastEmittedParamsRef fingerprint extension

**File modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`

Both `buildWmsParams` call sites (Effect 2 add path + Effect 3 update path) were extended with the 5th `layerJsonFields` arg:

```typescript
const wmsParams = buildWmsParams(
  wmsConfigInput, materializeVersion,
  dvEntry !== undefined ? { ... } : undefined, dvVersion,
  { cb_config: layer.cb_config, track_config: layer.track_config },
);
```

Both fingerprint locations (Effect 2 construction-time seed + Effect 3 compare) now use the extended formula:

```typescript
const fingerprint = JSON.stringify({ p: wmsParams, c: layer.cb_config, t: layer.track_config });
```

This ensures that when Phase 39/40 form auto-save PATCHes `cb_config` or `track_config`, the store update triggers a fingerprint mismatch → `source.updateParams` re-fires → Kinetica re-renders the tile. Without this, operator changes a CB color and sees no tile update.

### Task 3 — DashboardLayerDto extension + spec fixture updates

**Files modified:** `kinetica_bi/src/api/client.ts`, 8 spec files

`DashboardLayerDto` extended with byte-parity fields mirroring Plan 38-01's server `DashboardLayer`:

```typescript
cb_config: string | null;   // raw JSON string; null = not yet configured
track_config: string | null;
```

`updateLayer` Pick<> extended with `| "cb_config"` and `| "track_config"`.

**Deviation: 8 spec files updated** (Deviation Rule 2 — missing required fields on extended DTO). All `makeLayer()` / `mkLayer()` factory functions had `cb_config: null, track_config: null` added after `dynamic_view_id: null`. No test logic changed — fixture-only additions. All 1051 frontend vitest tests pass after updates.

## Decisions Made

1. **TrackConfig inline in wmsUrlBuilder.ts:** Single consumer rule — Phase 40 form extracts to `lib/trackConfig.ts` when it becomes a second consumer. Avoids premature module extraction.
2. **Legacy classbreak describe block replaced:** The old 6-test block testing `STYLES=classbreak` / `CB_COLUMN_NAME` / `CB_BREAK_POINT_N` was replaced with 2 tests covering the hard-cutover behavior. Preserving passing tests that test DELETED behavior would mask regressions.
3. **Optional 5th arg vs required:** Made optional to preserve backward-compat for the large number of test callers that use the 2-arg or 4-arg form. MapChartRenderer passes it; test helpers don't need to.
4. **Spec fixture updates committed in Task 3:** These are a direct consequence of adding required fields to `DashboardLayerDto` — Deviation Rule 2 auto-fix. 8 files, fixture-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing required fields] DashboardLayerDto fixture updates in 8 spec files**
- **Found during:** Task 3 (after extending DashboardLayerDto)
- **Issue:** 8 spec files construct DashboardLayerDto literal objects without the newly required `cb_config` + `track_config` fields — tsc reported 13 errors
- **Fix:** Added `cb_config: null, track_config: null` to `makeLayer()` / `mkLayer()` factory objects in: `InfoCardRenderer.spec.tsx`, `InfoPopup.spec.tsx`, `InfoSelectionView.spec.tsx`, `KineticaWmsLayerForm.spec.tsx`, `MapChartRenderer.spec.tsx`, `MapConfigPanel.spec.tsx`, `LayersModal.spec.tsx`, `dashboardLayersStore.spec.ts`
- **Files modified:** 8 spec files
- **Commit:** a9d9906

## Success Criteria Verification

- [x] STYLES_BY_MODE.classbreak = "cb_raster" (grep verified)
- [x] coalesceCbConfig imported + called in wmsUrlBuilder.ts (grep verified)
- [x] normalizeAARRGGBB(b.color used for CB colors (grep verified)
- [x] POINTCOLORS emitted in Lane C (grep verified)
- [x] DOTRACKS + TRACKHEADCOLORS + TRACK_ID_ATTR + TRACKMARKERSHAPES in wmsUrlBuilder.ts (grep verified)
- [x] No Lane A naming: CB_POINTCOLOR_, CB_BREAK_POINT_, CB_COLUMN_NAME, CB_BREAK_TYPE (grep-negative verified)
- [x] No legacy field reads: config.classbreaks, config.cbColumn (grep-negative verified)
- [x] TrackConfig type exported from wmsUrlBuilder.ts (grep verified)
- [x] materializeVersion + _mv preserved (grep verified)
- [x] wmsUrlBuilder.spec.ts: 78/78 tests passing
- [x] Full frontend vitest: 1051/1051 tests passing
- [x] Frontend tsc: clean (0 errors)
- [x] DashboardLayerDto cb_config: string | null + track_config: string | null (grep verified)
- [x] updateLayer Pick<> includes cb_config + track_config (grep verified)
- [x] Byte-parity: server types.ts + client.ts both have cb_config: string | null (grep count = 2)
- [x] MapChartRenderer fingerprint: { p: wmsParams, c: layer.cb_config, t: layer.track_config } at 2 sites

## Self-Check

Files exist:
- [x] kinetica_bi/src/lib/wmsUrlBuilder.ts (modified)
- [x] kinetica_bi/src/lib/wmsUrlBuilder.spec.ts (modified)
- [x] kinetica_bi/src/api/client.ts (modified)
- [x] kinetica_bi/src/components/charts/MapChartRenderer.tsx (modified)

Commits exist:
- [x] 77c84c0 feat(38-02): wmsUrlBuilder rewrite — STYLES=cb_raster Lane C + TrackConfig + 8-char color fix
- [x] 66090d6 feat(38-02): MapChartRenderer fingerprint extension for cb_config + track_config
- [x] a9d9906 feat(38-02): DashboardLayerDto extension + test fixture updates for cb_config + track_config

## Self-Check: PASSED
