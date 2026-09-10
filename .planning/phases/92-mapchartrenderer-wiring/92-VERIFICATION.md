---
phase: 92-mapchartrenderer-wiring
verified: 2026-06-28T10:00:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 92: MapChartRenderer WMS Wiring Verification Report

**Phase Goal:** WMS map layers bind to their per-layer combination view by NAME — both buildWmsParams sites (Effect 2 ADD/REMOVE + Effect 3 updateParams) resolve the per-layer combo view; a comboViewsKey dep-key re-fires layer re-requests; default accept-all renders byte-identically to v1.17. The Phase-90 orchestrator was extended to enumerate map layers. Filters NEVER travel in the WMS request — only the view name.
**Verified:** 2026-06-28T10:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Orchestrator enumerates table-bound layers (l:<id> vizKeys), shares byTable/vizKeyToHash maps, skips dv-bound layers | VERIFIED | `useCombinationOrchestrator.ts` lines 171–193: layer loop after widget loop, skips `dynamic_view_id !== null`, emits `l:${layer.id}` vizKeys into the same `byTable`/`vizKeyToHash` maps |
| 2 | Table-bound layer with default accept-all on the same table as a widget shares ONE combination view | VERIFIED | Both use `resolveFilterSet(undefined, allFilters)` → same hash; spec scenario L3 asserts `vizToHash["w:1"] === vizToHash["l:2"]` and `refCount === 2`; 216 spec tests pass |
| 3 | dv-bound layer (dynamic_view_id !== null) skipped in both orchestrator loop and STEP E currentVizKeys | VERIFIED | Line 175 loop guard + line 365 currentVizKeys guard both check `dynamic_view_id !== null` |
| 4 | STEP E orphan-cleanup guards accept both `w:` and `l:` keys | VERIFIED | Lines 371 and 423: `!vizKey.startsWith("w:") && !vizKey.startsWith("l:")` — both guards updated |
| 5 | layersKey S-02 primitive dep in orchestrator dep array, combinationVersion excluded | VERIFIED | Line 445: `}, [filterVersion, dashboardId, widgetsKey, layersKey, ceiling]` — combinationVersion is comment-only (never in array) |
| 6 | DashboardLayerDto.filterScope? is an optional top-level field | VERIFIED | `client.ts` lines 641–645: field added with v1.18 Phase 92 comment, typed `FilterSelectionConfig \| undefined` |
| 7 | DashboardsPage passes layers to orchestrator (declared before use) | VERIFIED | `DashboardsPage.tsx` line 445: `const layers = useDashboardLayersStore(...)`, line 454: `useCombinationOrchestrator(dashboard.id, widgets, layers)` — declared before call |
| 8 | BOTH buildWmsParams sites (Effect 2 + Effect 3) read combo view via `vizToHash["l:<id>"]` → `registry[hash]` | VERIFIED | Effect 2 (~line 1211): `layerVizKey = \`l:${layer.id}\`` → `getState().vizToHash[layerVizKey]` → `registry[comboHash]`; Effect 3 (~line 1464): identical pattern |
| 9 | `filterViewStore.getState().views[tableId]` eliminated from both WMS Effect 2 and Effect 3 paths | VERIFIED | `grep "views[tableId]"` returns line 1209 (a comment) + line 1711 (info-popup path, explicitly excluded) — zero live WMS reads |
| 10 | comboViewsKey per-layer primitive selector in BOTH Effect 2 and Effect 3 dep arrays | VERIFIED | Effect 2 dep array line 1421: `[...comboViewsKey, dynamicViewsKey, dvFilterViewsKey]`; Effect 3 dep array line 1504: `[filterVersion, comboViewsKey, dynamicViewsKey, dvFilterViewsKey, ...]` |
| 11 | MapChartRenderer is a pure consumer — no materialize-trigger imports; Test 16-E green | VERIFIED | `grep -E "materializeFilter\|dropFilterView\|..."` returns nothing; Test 16-E passes in 216-test suite run |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/hooks/useCombinationOrchestrator.ts` | layers param + layersKey S-02 dep + STEP A layer loop (l: vizKeys) + STEP E guards incl l: | VERIFIED | All present; 3rd param `DashboardLayerDto[]`, `layersKey` useMemo, layer loop at line 171, STEP E guards at lines 371+423 |
| `packages/web/src/api/client.ts` | DashboardLayerDto.filterScope optional top-level field | VERIFIED | Lines 641–645: `filterScope?: import("../types/filterSelection").FilterSelectionConfig` with correct threaded-field comment |
| `packages/web/src/components/DashboardsPage.tsx` | orchestrator mount passes layers as 3rd arg, declared before use | VERIFIED | Layer declared line 445, orchestrator call line 454 with `layers` as 3rd arg |
| `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` | makeLayer factory + Phase 92 describe block (L1-L5) + all existing calls updated to 3-arg | VERIFIED | `makeLayer` at line 73; Phase 92 describe at line 586; all 11 existing scenarios pass `[]` as 3rd arg |
| `packages/web/src/components/charts/MapChartRenderer.tsx` | comboViewsKey selector + both buildWmsParams sites read combo entries + both dep arrays updated + uniqueTableIds removed | VERIFIED | comboViewsKey selector line 556; 6 occurrences total; uniqueTableIds: 0 matches; both dep arrays confirmed |
| `packages/web/src/components/charts/MapChartRenderer.spec.tsx` | filterCombinationStore vi.mock + _comboVizToHash/_comboRegistry + Phase 92 COMBO-V118-04 describe block + Tests 92-A through 92-D + Test 16-E present | VERIFIED | vi.mock at line 404; state vars at lines 61–62; COMBO-V118-04 describe at line 1863; Tests 92-A/B/C/D at lines 1889/1928/1960/1995; Test 16-E at line 1612 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| useCombinationOrchestrator STEP A layer loop | filterCombinationStore.vizToHash["l:<layerId>"] | setVizHash in STEP E | WIRED | STEP A sets `vizKeyToHash.set(\`l:${layer.id}\`, hash)`; STEP E calls `setVizHash(vizKey, newHash)` for all entries in vizKeyToHash including l: keys |
| DashboardsPage DashboardOpen | useCombinationOrchestrator | 3rd arg layers from useDashboardLayersStore | WIRED | Line 454: `useCombinationOrchestrator(dashboard.id, widgets, layers)` — exact match |
| MapChartRenderer Effect 2 (~1211) + Effect 3 (~1464) | filterCombinationStore.vizToHash["l:<id>"] → registry[hash] | comboEntry resolution | WIRED | Both sites: `layerVizKey = \`l:${layer.id}\`` → `vizToHash[layerVizKey]` → `registry[comboHash]`; viewName used in `buildWmsParams` call |
| comboViewsKey selector | Effect 2 dep array (~1421) AND Effect 3 dep array (~1504) | replaces viewsKey in both arrays | WIRED | Confirmed at both dep array lines; no bare `viewsKey` token in any dep array |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| READ-V118-02 | 92-01, 92-02 | Map WMS layers bind to combination view by name; BOTH buildWmsParams sites updated; dep key added | SATISFIED | Both Effect 2 + Effect 3 swapped to combo store; comboViewsKey in both dep arrays; no filterViewStore.views[tableId] in WMS path |
| COMBO-V118-04 | 92-01, 92-02 | Default accept-all renders byte-identical to v1.17 | SATISFIED | Default (undefined filterScope) → `resolveFilterSet(undefined, allFilters)` = allFilters = same hash as pre-v1.18; spec COMBO-V118-04 describe block (Tests 92-A through 92-D) passes; 2891/2891 overall suite passes |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No TODOs, stubs, placeholder returns, or console-log-only implementations found in any modified file |

### Human Verification Required

None. All checks verified programmatically.

### Gaps Summary

No gaps. All must-haves verified against actual code.

---

## Test Gate Results

| Gate | Result |
|------|--------|
| `cd packages/web && npx tsc --noEmit` | CLEAN (no output) |
| `npx vitest run src/components/charts/MapChartRenderer.spec.tsx src/hooks/useCombinationOrchestrator.spec.ts` | 2 files, 216 tests — ALL PASS |
| `npx vitest run src/styles/theme-guard.spec.ts` | 1 file, 128 tests — ALL PASS |
| `npx vitest run` (full suite) | 126 files, 2891 tests — ALL PASS; 1 error in InfoPopup.spec.tsx passes in isolation = known TD-V16-TEST-ISOLATION cross-mode contamination; not introduced by Phase 92 |
| `git diff --name-only packages/server` | EMPTY — zero server changes |

---

_Verified: 2026-06-28T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
