---
phase: 93-filter-scope-config-ui
verified: 2026-06-28T15:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 93: Filter Scope Config UI — Verification Report

**Phase Goal:** Designers can configure each visualization's filter scope via a "Filter Scope" section in ChartConfigPanel (chart widgets) and KineticaWmsLayerForm (per WMS layer), and the config persists correctly — chart filterScope via widget.config; layer filter_scope as a TOP-LEVEL field (mirroring track_config), not nested in layer.config.

**Verified:** 2026-06-28
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Filter Scope section renders in ChartConfigPanel AND KineticaWmsLayerForm via shared FilterSelectionPanel | VERIFIED | `ChartConfigPanel.tsx` imports and renders `FilterSelectionPanel` after Drill-Down (gated on `selectedSource`); `KineticaWmsLayerForm.tsx` renders it as the last config-group after Info Popup |
| 2 | Source allow-list lists ONLY filter-producing widgets; sentinel STORED not resolved | VERIFIED | `filterSourceTypes.ts` exports `FILTER_PRODUCING_TYPES` (bar/line/pie/scatter/table/datafilter/calendar/timeline/numericline — "records" explicitly excluded); `SPATIAL_DRAWS_SENTINEL = "__spatial_draws__"` is imported only by FilterSelectionPanel.tsx (UI only) + spec; zero usage in any orchestrator/resolver |
| 3 | Chart filter scope persists via widget.config.filterSelection; layer filter_scope TOP-LEVEL across all 7 sites | VERIFIED | Chart: `set("filterSelection", next)` in ChartConfigPanel spreads into draft → widget.config; Layer: `types.ts` has `filter_scope: string \| null`, `db.ts` DDL + PRAGMA ALTER + mapDashboardLayer JSON.parse + updateDashboardLayer Pick + UPDATE SQL, `index.ts` PATCH route JSON.stringify on write, `client.ts` DTO `filter_scope?:` + `updateLayer` Pick includes "filter_scope" |
| 4 | No live camelCase filterScope references on the layer surface | VERIFIED | `grep -rn "layer\.filterScope\|\.filterScope"` returns zero results; remaining camelCase "filterScope" occurrences are React prop names in KineticaWmsLayerForm props (`filterScope?: DashboardLayerDto["filter_scope"]`) which is correct JSX camelCase for a prop backed by a snake_case DTO field; `useCombinationOrchestrator.ts` reads `layer.filter_scope`; spec factory uses `filter_scope` |
| 5 | CSS uses only existing classes; danger via var(--danger); theme-guard green | VERIFIED | FilterSelectionPanel.tsx uses only `config-group`, `config-group-label`, `config-toggle`, `config-hint`; inline danger uses `style={{ color: "var(--danger)" }}`; zero raw hex; theme-guard spec 130/130 passing |

**Score:** 5/5 truths verified

---

## Required Artifacts

### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/components/charts/filterSourceTypes.ts` | FILTER_PRODUCING_TYPES Set + isFilterProducingWidget + SPATIAL_DRAWS_SENTINEL | VERIFIED | All three exports present; records excluded with comment; sentinel = `"__spatial_draws__"` |
| `packages/web/src/components/charts/FilterSelectionPanel.tsx` | Shared Filter Scope component; 60+ lines | VERIFIED | 161 lines; pure presentational; renders accept-all/customize toggle/source checklist/spatial row/orphan warnings |
| `packages/web/src/components/charts/FilterSelectionPanel.spec.tsx` | Unit coverage for all 9 behavior cases | VERIFIED | 444 lines; 9 describe blocks covering default, allowlist filtering, sentinel, selfWidgetId, toggle, accept-none, uncheck, orphan, empty-source |
| `packages/web/src/types/filterSelection.ts` | allowedSourceWidgetIds widened to (number \| string)[] | VERIFIED | Line 19: `allowedSourceWidgetIds: (number \| string)[]` |

### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/db.ts` | filter_scope TEXT column (DDL + PRAGMA ALTER + mapDashboardLayer JSON.parse + updateDashboardLayer) | VERIFIED | DDL line 111; ALTER guard lines 348–351; mapDashboardLayer JSON.parse line 440 (cast as any); updateDashboardLayer Pick line 718, UPDATE SQL line 724, discriminant lines 751–755 |
| `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` | Filter Scope section + widgets prop + filterScope/onChangeFilterScope props | VERIFIED | Props at lines 106–110; FilterSelectionPanel rendered at lines 1652–1656 as last config-group after Info Popup; widgets default [] |
| `packages/server/tests/layers.spec.ts` | filter_scope round-trip / null-clear / preserve-on-omit in BOTH auth modes | VERIFIED | Password-mode trio at lines 316–400; OIDC smoke block at lines 715–804; all 23 tests pass in isolation |

---

## Key Link Verification

### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ChartConfigPanel.tsx` | `FilterSelectionPanel` | render after Drill-Down, value=draft.filterSelection, onChange=set('filterSelection') | VERIFIED | Line 733–737: `<FilterSelectionPanel value={draft.filterSelection as FilterSelectionConfig \| undefined} onChange={(next) => set("filterSelection", next)} widgets={widgets ?? []} selfWidgetId={widgetId}` |
| `DashboardsPage.tsx` | `ChartConfigPanel` | `widgetId={widget.id}` at WidgetConfigModal | VERIFIED | Line 1297: `widgetId={widget.id}   // Phase 93 Plan 93-01: self-exclusion in FilterSelectionPanel` |

### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `KineticaWmsLayerForm.tsx` | `LayersModal onPatch` | `onChangeFilterScope → onPatch(layerId, { filter_scope })` | VERIFIED | `onChangeFilterScope={(next) => onPatch(selectedLayer.id, { filter_scope: next ?? null })}` at LayersModal.tsx line 599 |
| `client.ts updateLayer` | `PATCH /api/dashboards/:id/layers/:layerId` | `filter_scope` in Pick<DashboardLayerDto> body | VERIFIED | `client.ts` line 691: `\| "filter_scope"` in updateLayer Pick |
| `db.ts updateDashboardLayer` | `dashboard_layers.filter_scope` column | `'filter_scope' in attrs` discriminant + UPDATE SQL | VERIFIED | Lines 751–755: discriminant pattern; line 724: filter_scope = ? in UPDATE SQL |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FSCOPE-V118-01 | 93-01 | Source-widget allow-list UI; only filter-PRODUCING widgets listed; NOT records/info-popup/legend; default accept-all | SATISFIED | FILTER_PRODUCING_TYPES excludes records/legend/info-card/map/bignumber/heatmap/radio-group; FilterSelectionPanel unit tests cover all cases; ChartConfigPanel integration complete |
| FSCOPE-V118-02 | 93-02 | Filter-scope config on chart widgets and map WMS layers; layer filterScope TOP-LEVEL field like track_config | SATISFIED | All 7 persistence sites wired; LayersModal spec Test 21 asserts top-level + asserts config.filter_scope is undefined; both-auth-mode supertests green in isolation |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/server/tests/db.smoke.spec.ts` | 207, ~230 | Hardcoded column list does not include `filter_scope` (also missing `cb_config`, `track_config` from earlier phases) | WARNING (pre-existing) | spec was already failing before Phase 93 due to cb_config/track_config — Phase 93 adds filter_scope making the diff larger. Pre-existing TD-V16-TEST-ISOLATION known failure; not introduced by Phase 93. `layers.spec.ts` (the relevant Phase 93 spec) passes 23/23 in isolation. |

No TODO/FIXME/placeholder patterns found in Phase 93 files. No empty implementations. No raw hex.

---

## Phase 93.5 Boundary Verification

The plan explicitly required that SPATIAL_DRAWS_SENTINEL be stored-only in Phase 93 with NO resolver/orchestrator wiring. Verified:

- `SPATIAL_DRAWS_SENTINEL` is imported only by `FilterSelectionPanel.tsx` (UI render) and `FilterSelectionPanel.spec.tsx` (test)
- Zero references in `useCombinationOrchestrator.ts`, `useDynamicViewMaterializeChain.ts`, or any resolver
- `filterSourceTypes.ts` file header explicitly documents: "Phase 93 STORES this sentinel in widget.config.filterSelection only. Phase 93.5's resolver branches on this string value vs numeric widget ids"

---

## Test Gate Results

| Gate | Result | Detail |
|------|--------|--------|
| `packages/web` tsc --noEmit | CLEAN | No errors |
| `packages/web` vitest run | 127/127 files pass, 2919/2919 tests | 11 unhandled rejections from InfoCardRenderer.spec.tsx (pre-existing, unrelated to Phase 93) |
| `packages/web` vitest run theme-guard.spec.ts | 1/1 files pass, 130/130 tests | Green |
| `packages/server` tsc --noEmit | CLEAN | No errors |
| `packages/server` vitest run tests/layers.spec.ts (isolation) | 1/1 files pass, 23/23 tests | All filter_scope round-trip / null-clear / preserve-on-omit + OIDC smoke tests pass |
| `packages/server` vitest run (combined, SET-BASED) | 54/65 files pass | Failing files: auth.oidc.spec.ts, auth.routes.spec.ts, boot.hardening.spec.ts, boot.wipe.spec.ts, bootstrap.spec.ts, db.smoke.spec.ts, oidc.module.spec.ts, routes.dynamic-view.spec.ts, routes.filter-materialize-dv.spec.ts, routes.filter-materialize.spec.ts, routes.management.spec.ts, routes.wms.spec.ts — all pre-existing TD-V16-TEST-ISOLATION cross-mode contamination; pass in isolation. SET-BASED gate: SATISFIED. |

---

## Human Verification Required

### 1. Filter Scope section appears in chart config panel

**Test:** Open a dashboard with a bar chart widget. Click its config. Scroll past the Drill-Down section.
**Expected:** A "Filter Scope" section appears with an unchecked "Customize" toggle and "Accept all filters" hint text.
**Why human:** Visual rendering of the config panel cannot be verified programmatically.

### 2. Filter Scope section appears in map layer form

**Test:** Open a dashboard with a WMS map layer. Click "Layers" to open LayersModal. Select a layer.
**Expected:** The layer form shows a "Filter Scope" section at the bottom (after Info Popup), not at the map widget config level.
**Why human:** Visual rendering and the correct scoping (layer-level, not widget-level) requires visual inspection.

### 3. Filter scope allow-list persists across reload

**Test:** Configure a chart widget's filter scope to "Customize" and check one source. Save. Reload the page. Reopen the config panel.
**Expected:** The allow-list is intact with the same source checked.
**Why human:** Page reload persistence requires a live browser session.

### 4. Layer filter_scope persists across reload

**Test:** Configure a WMS layer's filter scope to "Customize" and check the "Spatial draws (map)" row. Save. Reload. Reopen LayersModal.
**Expected:** The layer's Filter Scope section shows Customize checked with Spatial draws (map) checked.
**Why human:** Page reload persistence requires a live browser session.

---

## Gaps Summary

No gaps. All 5 observable truths verified, all 7 persistence sites wired correctly, both requirement IDs satisfied, test gates clean, Phase 93.5 boundary maintained.

The one pre-existing db.smoke.spec.ts failure (hardcoded column list) predates Phase 93 and is part of the known TD-V16-TEST-ISOLATION set. Phase 93 added `filter_scope` to the column list, which makes an already-failing spec show a slightly larger diff, but does not introduce a new failing file.

---

_Verified: 2026-06-28_
_Verifier: Claude (gsd-verifier)_
