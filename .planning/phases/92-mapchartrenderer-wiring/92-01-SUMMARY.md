---
phase: 92-mapchartrenderer-wiring
plan: "01"
subsystem: hooks
tags: [combination-views, orchestrator, map-layers, layer-enumeration, ref-count, v1.18, frontend-only, filter-selection]

# Dependency graph
requires:
  - phase: 88-foundation-pure-logic-types
    provides: resolveFilterSet, stableComboHash, NOFILTER_SENTINEL, FilterSelectionConfig
  - phase: 89-store-server-foundation
    provides: filterCombinationStore (acquire/release/markMaterializing/setEntry/setVizHash), DashboardLayerDto
  - phase: 90-combination-orchestrator
    provides: useCombinationOrchestrator (widgets-only, now extended to layers)
provides:
  - useCombinationOrchestrator(dashboardId, widgets, layers) extended hook with layer enumeration
  - l:<layerId> vizKey contract for filterCombinationStore (consumed by Plan 02 MapChartRenderer)
  - DashboardLayerDto.filterScope? optional top-level field (consumed by Plan 93 and Plan 02)
  - 16-scenario spec (11 original + 5 new Phase 92 layer scenarios)
  - DashboardOpen mount wired with layers 3rd arg
affects:
  - Phase 92-02 (MapChartRenderer read-path: reads filterCombinationStore.vizToHash["l:<layerId>"])
  - Phase 93 (filterScope: assigns value once SQLite column + config UI added)
  - Phase 94 (dv-bound layer orchestration: skipped here, picked up in Phase 94)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "l:<layerId> vizKey contract: table-bound layers get combination views under l:<id> vizKeys, sharing the byTable/vizKeyToHash maps with w:<id> widget keys"
    - "layersKey S-02 primitive dep: useMemo over table-bound layers sorted by id:table_id — prevents array reference instability"
    - "dv-bound skip: dynamic_view_id !== null → skip in both layer loop and currentVizKeys build — Phase 94 scope"
    - "filterScope TOP-LEVEL optional field: DashboardLayerDto.filterScope? added as optional (undefined until Phase 93 adds SQLite column); no as-any cast needed in orchestrator"
    - "STEP E guards updated: startsWith('w:') → startsWith('w:') || startsWith('l:') for both orphan-cleanup loops"

key-files:
  created: []
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/hooks/useCombinationOrchestrator.ts
    - packages/web/src/hooks/useCombinationOrchestrator.spec.ts
    - packages/web/src/components/DashboardsPage.tsx

key-decisions:
  - "l:<layerId> vizKey contract: map layers use l:<id> vizKeys (not w:<id>), enabling Plan 02 to read filterCombinationStore.vizToHash['l:<id>'] → registry[hash] for WMS view name"
  - "filterScope as optional top-level field in Phase 92: avoids (layer as any) cast; resolveFilterSet(undefined, allFilters) = accept-all; value stays undefined until Phase 93"
  - "widgetIds field in HashEntry keeps its name despite holding layer ids too — internal orchestrator type, rename deferred to cleanup pass per RESEARCH Open Question 1"
  - "Declared-before-use fix: useCombinationOrchestrator call moved after layers declaration in DashboardOpen (was mounted before layers was declared)"

# Metrics
duration: 6min
completed: "2026-06-28"
---

# Phase 92 Plan 01: Combination-Orchestrator Layer Extension Summary

**`useCombinationOrchestrator` extended with `layers: DashboardLayerDto[]` 3rd param, `l:<layerId>` vizKeys, `layersKey` dep, STEP E guards updated for layer cleanup — the PRODUCER half of READ-V118-02 that Plan 02 (MapChartRenderer) consumes**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-28T03:26:11Z
- **Completed:** 2026-06-28T03:32:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Extended `useCombinationOrchestrator(dashboardId, widgets, layers)` with a `DashboardLayerDto[]` third param and a `layersKey` S-02 primitive dep
- Added layer enumeration loop in STEP A: table-bound layers produce `l:<layerId>` vizKeys, share the `byTable`/`vizKeyToHash` maps with widgets, skip dv-bound layers (`dynamic_view_id !== null`)
- Updated STEP E: `currentVizKeys` now includes `l:<layerId>` keys for table-bound layers; both orphan-cleanup `startsWith("w:")` guards now also accept `l:` keys (prevents view leak on layer removal)
- Added `DashboardLayerDto.filterScope?` as an optional top-level field (threaded like `track_config`; undefined until Phase 93 adds the SQLite column and config UI)
- Fixed mount ordering in `DashboardsPage.tsx`: `useCombinationOrchestrator` relocated below `const layers = useDashboardLayersStore(...)` (was called before `layers` was declared)
- 16-scenario spec green: 11 original + 5 new Phase 92 layer scenarios (L1 single-layer combo, L2 dv-layer skip, L3 layer+widget shared/refCount-2, L4 NOFILTER, L5 removal+DROP)

## Task Commits

1. **Task 1: Extend orchestrator + DashboardLayerDto.filterScope?** — `b03213d` (feat)
2. **Task 2: DashboardsPage wiring + layer enumeration spec** — `b14cc55` (feat)

## Files Created/Modified

- `packages/web/src/api/client.ts` — added `filterScope?: FilterSelectionConfig` as optional TOP-LEVEL field on `DashboardLayerDto` (~line 640)
- `packages/web/src/hooks/useCombinationOrchestrator.ts` — extended: `DashboardLayerDto` import, `layers` 3rd param, `layersKey` useMemo, STEP A layer loop, STEP E currentVizKeys + guard updates, dep array `[filterVersion, dashboardId, widgetsKey, layersKey, ceiling]`
- `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` — `DashboardLayerDto` import, `makeLayer` factory, all 11 existing scenarios updated to `[]` 3rd arg, new Phase 92 describe block (L1-L5)
- `packages/web/src/components/DashboardsPage.tsx` — orchestrator call relocated after `layers` declaration; `layers` passed as 3rd arg

## Key Contracts for Plan 02 (MapChartRenderer)

- **`l:<layerId>` vizKey:** `filterCombinationStore.vizToHash["l:<layerId>"]` holds the stableComboHash for each table-bound layer, or `undefined` when no filters are active (NOFILTER). Plan 02 reads this key to resolve which combination view name to use in the WMS request.
- **`filterScope?`:** `DashboardLayerDto.filterScope` is an optional top-level field (`FilterSelectionConfig | undefined`). Plan 02 does NOT need to read `filterScope` — the orchestrator already resolves it into a view; MapChartRenderer just reads the viewName from `registry[hash]`.
- **dv-bound layers:** layers with `dynamic_view_id !== null` have NO `l:` vizKey — they remain on the existing `dynamicViewsKey`/`dvFilterViewsKey` path in MapChartRenderer (unchanged until Phase 94).
- **NOFILTER/first-tick fallback:** when `vizToHash["l:<id>"]` is `undefined`, Plan 02 should use `rawTableRef` (the base schema.table) — same `viewName || rawTableRef` pattern (|| not ??) already in place at Effect 2 line ~1223 and Effect 3 line ~1472.

## Decisions Made

1. **`l:<layerId>` vizKey contract** — map layers use `l:` prefix (not `w:`) so Plan 02 can scope its `comboViewsKey` selector to this map widget's `includedLayers` only. Established in this plan; consumed by Plan 02.

2. **`filterScope?` added as optional top-level field in Phase 92** — eliminates the `(layer as any)` cast. `resolveFilterSet(undefined, allFilters) = accept-all` produces the same hash as all-filters today (COMBO-V118-04 correctness gate: byte-identical WMS render to v1.17 for unconfigured dashboards).

3. **`widgetIds` field in `HashEntry` not renamed** — it now holds both widget ids and layer ids, but renaming to `vizIds` is deferred to avoid churn. Comment added inline.

4. **Mount ordering fix** — `useCombinationOrchestrator` was called at line 449 before `layers` was declared at line 452. Relocated to after `const layers = ...` (line 454) while keeping all hooks unconditional and before any early returns.

## Deviations from Plan

None — plan executed exactly as written.

The plan noted "THREE `startsWith("w:")` guards" but the actual codebase had exactly TWO such guards in STEP E (as the critical_guardrails stated). Both were updated. The positive-form ceiling-remap guards were left unchanged as instructed.

## Self-Check

Verified files exist on disk:
- `packages/web/src/api/client.ts` — FOUND
- `packages/web/src/hooks/useCombinationOrchestrator.ts` — FOUND
- `packages/web/src/hooks/useCombinationOrchestrator.spec.ts` — FOUND
- `packages/web/src/components/DashboardsPage.tsx` — FOUND
- Task commits b03213d, b14cc55 — present in git log

## Self-Check: PASSED

---
*Phase: 92-mapchartrenderer-wiring*
*Completed: 2026-06-28*
