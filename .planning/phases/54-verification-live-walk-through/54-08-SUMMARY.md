---
phase: 54
plan: "08"
subsystem: map-info-popup
tags: [track-mode, info-popup, spatial-columns, gap-closure, tdd]
dependency_graph:
  requires: [TRACKFIX-V19-01]
  provides: [TRACKFIX-V19-07]
  affects: [MapChartRenderer, InfoSelectionView, spatialColumns]
tech_stack:
  added: []
  patterns: [tdd-red-green, optional-param-threading]
key_files:
  created: []
  modified:
    - packages/web/src/lib/spatialColumns.ts
    - packages/web/src/lib/spatialColumns.spec.ts
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/InfoSelectionView.tsx
key_decisions:
  - "trackConfigJson as optional 2nd param with undefined-fallback preserves all existing tests without modification — no breaking change to the 11 existing track-branch tests"
  - "Precedence: explicit 2nd arg > cfg.track_config fallback — allows call sites to supply the correct top-level DTO value while backward-compat path remains via undefined sentinel"
metrics:
  duration: "8min"
  completed: "2026-06-08T03:16:00Z"
---

# Phase 54 Plan 08: TRACKFIX-V19-07 — Map Info Popup on Track-Mode Layers

**One-liner:** Thread `layer.track_config` (top-level DTO field) into `buildSpatialColumns` via a new optional 2nd parameter so track-mode info clicks fire instead of silently short-circuiting.

## What Was Done

### Root Cause (GAP-54-08)

`buildSpatialColumns(cfg)` read `track_config` from `cfg` (i.e., `layer.config`), but `track_config` is a **top-level `DashboardLayerDto` column**, not a key inside `layer.config`. At all 3 info-handler call sites, `cfg = layer.config as Partial<MapWidgetConfig>` was passed without `track_config` merged in:

- `cfg.track_config` → `undefined`
- `coalesceTrackConfig(null)` → `{ enabled: false }`
- `!tc.xCol` → `return null`
- info fan-out: `errorCount++; continue;`
- Result: "Failed to fetch info" toast, NO network call

This is the same class of bug as GAP-54-01 (TRACKFIX-V19-01), which was fixed for the WMS render path at `~1041` by merging `{ ...cfg, track_config: layer.track_config }`. The info-query path was missed.

### Fix

**`spatialColumns.ts`** — Added optional `trackConfigJson?: string | null` second parameter to `buildSpatialColumns`. When non-undefined, it takes precedence over `cfg.track_config`; when `undefined`, falls back to the type-asserted `cfg.track_config` for backward compatibility with existing tests.

**3 call sites threaded:**

| File | Location | Change |
|------|----------|--------|
| `MapChartRenderer.tsx` | ~1467 info click fan-out | `buildSpatialColumns(cfg, layer.track_config)` |
| `InfoSelectionView.tsx` | ~185 `handleLayerSwitch` (dropdown switch) | `buildSpatialColumns(cfg, layer.track_config)` |
| `InfoSelectionView.tsx` | ~261 `loadNextPage` (Load-more) | `buildSpatialColumns(cfg, layer.track_config)` |

### TDD Sequence

- **RED**: Added 4 new specs in `54-08 repro` describe block. Key failing test: `"RED→GREEN: track mode with track_config as 2nd arg returns { lonCol, latCol } even when cfg has no track_config"` — returned `null` (bug) instead of `{ lonCol: "X", latCol: "Y" }`. Commit: `70991f5`
- **GREEN**: Signature change made all 4 new specs + all 13 existing specs pass (17 total). Call-site threading committed. Commit: `00d9ec7`

## Verification

- `npx vitest run packages/web/src/lib/spatialColumns.spec.ts` → 17/17 passing
- `npm run test` (full suite) → 1649/1649 passing (baseline was 1645 before adding 4 new specs; no new failures)
- `npx tsc -p packages/web/tsconfig.json --noEmit` → clean

## Deviations from Plan

None — plan executed exactly as specified. The existing tests using `cfg.track_config` continued to pass via the `undefined` fallback path, requiring no modifications to the 11 pre-existing track-branch tests.

## Self-Check: PASSED

- `packages/web/src/lib/spatialColumns.ts` — modified (confirmed)
- `packages/web/src/lib/spatialColumns.spec.ts` — modified (confirmed)
- `packages/web/src/components/charts/MapChartRenderer.tsx` — modified (confirmed)
- `packages/web/src/components/charts/InfoSelectionView.tsx` — modified (confirmed)
- Commit `70991f5` — exists (test+fix: spatialColumns)
- Commit `00d9ec7` — exists (feat: 3 call-site wiring)
