---
phase: 19-config-schema
plan: "02"
subsystem: frontend-types
tags: [typescript, frontend, types, config-v14, pure-helpers, vitest]
dependency_graph:
  requires: [CONFIG-V14-01]
  provides: [CONFIG-V14-02]
  affects: [Phase 21 map-click-popup, Phase 22 config-ui, Phase 23 info-card]
tech_stack:
  added: []
  patterns: [optional-fields-for-backward-compat, pure-helper-module, Pick-narrowing-for-getters, nullish-coalescing-default]
key_files:
  created:
    - kinetica_bi/src/lib/mapInfoConfig.ts
    - kinetica_bi/src/lib/mapInfoConfig.spec.ts
  modified:
    - kinetica_bi/src/api/client.ts
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
    - kinetica_bi/src/components/LayersModal.spec.tsx
    - kinetica_bi/src/store/dashboardLayersStore.spec.ts
decisions:
  - "Spec fixture helpers (4 files) updated with info_enabled:1, info_columns:null, info_template:null defaults so DashboardLayerDto required fields compile — mirrors server-side DashboardLayer which has NOT NULL DEFAULT 1 on info_enabled"
  - "13 tests in mapInfoConfig.spec.ts (exceeds plan minimum of 10/6); coverage includes DEFAULT_* constants, default-when-undefined, explicit true/false, explicit values, no-clamp (0/-5), and ROADMAP Phase 19 success criterion 2 legacy regression"
  - "No clamping in getInfoRadiusPx — pure read; Phase 22 MapConfigPanel enforces min=1, max=200 UI bound"
  - "mapInfoConfig.ts is zero-runtime-dependency (only `import type` from wmsUrlBuilder)"
metrics:
  duration: ~50min
  completed: "2026-05-08"
  tasks_completed: 2
  files_modified: 8
---

# Phase 19 Plan 02: Frontend Types Summary

**One-liner:** Frontend `DashboardLayerDto` and `MapWidgetConfig` extended with v1.4 info-popup fields; `mapInfoConfig.ts` pure helpers ship backward-compatible defaults (`infoEnabled=true`, `infoRadiusPx=20`) for pre-Phase-19 widgets; 13/13 vitest pass; 360/360 suite green; tsc clean.

## What Was Built

### 1. DashboardLayerDto Extension (client.ts lines 448-462)

Three new required fields mirror the server-side `DashboardLayer` type (Plan 19-01 `types.ts` lines 56-58) byte-for-byte:

```typescript
info_enabled: number;          // 0|1 (SQLite INTEGER NOT NULL DEFAULT 1)
info_columns: string | null;   // raw JSON-array string; null = all columns
info_template: string | null;  // raw HTML template; null = default key-value table
```

### 2. updateLayer Pick<...> Widening (client.ts line 482)

`Partial<Pick<DashboardLayerDto, ...>>` widened with `"info_enabled" | "info_columns" | "info_template"` so Phase 22 PATCH callers can persist info popup config via the existing update function without type errors.

### 3. MapWidgetConfig Extension (wmsUrlBuilder.ts lines 95-102)

Two optional fields appended before the closing `};`:

```typescript
infoEnabled?: boolean;   // per-widget kill switch — opt-out (absent = enabled)
infoRadiusPx?: number;   // click radius in pixels — absent = 20
```

Both OPTIONAL so pre-Phase-19 stored `widget.config` literals continue to type-check without migration. `buildWmsParams` body untouched — info popup is out-of-band from WMS tile rendering.

### 4. mapInfoConfig.ts (kinetica_bi/src/lib/mapInfoConfig.ts — 58 lines)

New pure module with zero runtime dependencies (only `import type`):

| Export | Type | Behavior |
|--------|------|----------|
| `DEFAULT_INFO_ENABLED` | `true` | locked v1.4 constant |
| `DEFAULT_INFO_RADIUS_PX` | `20` | locked v1.4 constant |
| `getInfoEnabled(config)` | `boolean` | returns `config.infoEnabled ?? true` |
| `getInfoRadiusPx(config)` | `number` | returns `config.infoRadiusPx ?? 20` |

Both helpers take `Pick<MapWidgetConfig, "infoEnabled">` / `Pick<MapWidgetConfig, "infoRadiusPx">` so unrelated MapWidgetConfig fields don't constrain callers. No clamping — Phase 22 UI enforces bounds.

### 5. mapInfoConfig.spec.ts (kinetica_bi/src/lib/mapInfoConfig.spec.ts — 93 lines)

13 tests across 5 describe blocks:

- `DEFAULT_* constants` (2 tests): locked-value assertions
- `getInfoEnabled` (4 tests): no-field, undefined, true, false
- `getInfoRadiusPx` (5 tests): no-field, undefined, explicit values (1/50/200), 0 (no-clamp), -5 (no-clamp)
- `backward-compat regression` (2 tests): legacy `MapWidgetConfig` literal (no info fields) → both helpers return defaults; Phase-22-shaped config with explicit fields → returned as-is

**ROADMAP Phase 19 success criterion 2 regression test** (`"ROADMAP Phase 19 success criterion 2"` grep tag present).

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| mapInfoConfig.spec.ts (new) | 13/13 | PASS |
| Full frontend suite (all) | 360/360 | PASS |
| tsc --noEmit (kinetica_bi) | — | CLEAN |

**Baseline delta:** 347 → 360 (+13 new tests, zero regressions).

## Phase 19 Verification Roll-Up

| Requirement | Plan | Status |
|------------|------|--------|
| CONFIG-V14-01: SQLite schema + CRUD pipeline | 19-01 | DONE (8bbdb6d / 0aa3bd4) |
| CONFIG-V14-02: Frontend type mirror + helpers | 19-02 | DONE (f5f934d / ebe0179) |

Both plans clean. Phase 19 closes. v1.4 advances to Phase 20.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Spec fixture helpers missing new required DashboardLayerDto fields**
- **Found during:** Task 1 tsc --noEmit verification (exit code 2, 4 errors)
- **Issue:** `makeLayer`/`mk` helpers in 4 spec files constructed `DashboardLayerDto` literals without `info_enabled`, `info_columns`, `info_template`. These became required fields once DashboardLayerDto was extended.
- **Fix:** Added `info_enabled: 1, info_columns: null, info_template: null` to each fixture helper, matching the server-side SQLite defaults (`NOT NULL DEFAULT 1`, nullable `TEXT`).
- **Files modified:** `MapChartRenderer.spec.tsx`, `MapConfigPanel.spec.tsx`, `LayersModal.spec.tsx`, `dashboardLayersStore.spec.ts`
- **Commit:** f5f934d (included in Task 1 commit)

## Commits

| Hash | Message |
|------|---------|
| f5f934d | feat(19-02): extend DashboardLayerDto + MapWidgetConfig with v1.4 info popup fields |
| ebe0179 | feat(19-02): add mapInfoConfig.ts pure helpers + spec (CONFIG-V14-02) |

## tsc Status

`cd kinetica_bi && npx tsc --noEmit` — CLEAN (exit 0, no output).

## Self-Check: PASSED

- [x] kinetica_bi/src/api/client.ts — exists, info_enabled field present
- [x] kinetica_bi/src/lib/wmsUrlBuilder.ts — exists, infoEnabled?: boolean present
- [x] kinetica_bi/src/lib/mapInfoConfig.ts — created, 4 exports present
- [x] kinetica_bi/src/lib/mapInfoConfig.spec.ts — created, 13 tests
- [x] Commits f5f934d and ebe0179 — verified in git log
- [x] 13/13 mapInfoConfig spec tests passing — verified via vitest run
- [x] 360/360 full suite passing — verified via vitest run --reporter=verbose
- [x] tsc --noEmit clean — verified (exit 0)
- [x] buildWmsParams untouched — grep confirmed 1 match
- [x] No React components modified — scope boundary held
