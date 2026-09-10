---
phase: 35-widget-binding-and-pipeline
verified: 2026-05-15T18:05:00Z
status: passed
score: 4/4 ROADMAP success criteria verified + 14/14 locked semantics + 3/3 requirements satisfied
human_verification_recommended:
  - test: "Cascade timing on rapid filter changes"
    expected: "AbortController cancels prior in-flight materialize per-dv; over-threshold overlay surfaces; layer reappears on narrowed filter"
    why_human: "React effect graph timing + WMS tile cache invalidation only observable in a real browser session"
  - test: "Map widget per-layer dv binding round-trip"
    expected: "Operator picks 'dv:7' in LayersModal Data Source picker → server stores dynamic_view_id=7, table_id=dv.source_table_id; layer URL flips to LAYERS=<dvViewName> after materialize"
    why_human: "OL ImageLayer add/remove + PATCH round-trip + WMS URL build all touch real network surfaces"
  - test: "Over-threshold empty state + Retry button"
    expected: "Aggregated widget bound to over_threshold dv renders 'Too much data — narrow your filters to enable this view.' with NO SQL fire. Retry button rebuilds; clicking re-fires orchestrator's retry path."
    why_human: "Status-aware render gate + retry context-flow observable end-to-end only in browser"
  - test: "Orphan widget UX after dv delete"
    expected: "Widget bound to dynamicViewId that no longer exists in listDynamicViews → renders 'This dynamic view was deleted. Reconfigure the widget.'"
    why_human: "DELETE → list refresh → orphan detection round-trip needs live state"
  - test: "Drill-down on dv-bound widget"
    expected: "Click drills to sourceTableId; filter-view materializes; orchestrator detects matVer bump; dv re-materializes; widget refreshes with new dvViewName"
    why_human: "Full cascade pipeline only observable in real browser interaction"
---

# Phase 35: widget-binding-and-pipeline Verification Report

**Phase Goal:** Visualizations can use a dynamic view as their data source. The materialize trigger chain re-fires the dynamic-view check whenever the source filter view changes (filter version bumps). Widgets dependent on an over-threshold dynamic view show a clear empty state.

**Verified:** 2026-05-15T18:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### ROADMAP Success Criteria

| #   | Criterion                                                                                                              | Status     | Evidence                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ChartConfigPanel "Data Source" picker shows Dynamic Views optgroup + writes `dynamicViewId` to widget.config           | PASS       | `ChartConfigPanel.tsx:366` `<optgroup label="Dynamic Views">`; line 204-225 dual-write on `dv:<id>` pick: `dynamicViewId: dvId` + `tableId: dv.source_table_id`; usesDataSource guard at line 339; 16/16 spec tests pass. |
| 2   | AggregatedWidgetRenderer / RecordsTableRenderer / MapChartRenderer read `dynamicViewId`, FROM/LAYERS-swap              | PASS       | `WidgetRenderer.tsx:243` reads `cfg.dynamicViewId`; `:289` scoped useDynamicViewStore selector; `:617-647` 5-state gates with materialized fall-through to fromSwap+runSql. MapChartRenderer Effects 2+3 lines 864-892, 1023-1049 per-layer dv lookup + 4-arg buildWmsParams + null-skip. |
| 3   | Cascading materialize: filter-view re-mat → row-count → dv CREATE/DROP → widget FROM-swap re-fires; AbortController serializes per-dv | PASS       | `useDynamicViewMaterializeChain.ts:60-90` subscribes to filter-view matVer; `:93` per-dv `useRef<Map<number, AbortController>>`; `:104-161` fireCascade with cold-start gate (line 111 `matVer === undefined \|\| matVer === 0`) + per-dv last-seen guard (line 112-113) + AbortController dedup; `:127` markPending → `:129` materializeDynamicView → `:132-144` setView/setError branches. 17/17 hook spec tests pass. |
| 4   | Over-threshold dynamic view → widget shows "Too much data — narrow your filters to enable this view." (no SQL)         | PASS       | `WidgetRenderer.tsx:625-631` (Aggregated) + `:1601-1610` (RecordsTable) render verbatim message inside `widget-placeholder widget-over-threshold` div with no runSql call. Effect 2 short-circuits at `:454` `if (dvStatus === "over_threshold") return;`. MapChartRenderer adds "Some layers over threshold" overlay at line 1672 and skips the layer when `wmsParams === null` (lines 892, 1049). |

**Score:** 4/4 success criteria verified.

### Required Artifacts

| Artifact                                                                | Expected                                                                                          | Status     | Details                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `kinetica_bi/server/src/db.ts`                                          | `dashboard_layers.dynamic_view_id INTEGER` column + PRAGMA-guarded ALTER + updater discriminant   | VERIFIED   | Line 102 CREATE TABLE; line 181-186 PRAGMA migration; line 521 `"dynamic_view_id" in attrs` discriminant. table_id stays NOT NULL (line 87 unchanged). |
| `kinetica_bi/server/src/index.ts`                                       | PATCH `/api/dashboards/:id/layers/:layerId` Pick<> extended with `dynamic_view_id`                | VERIFIED   | Line 597 `"dynamic_view_id"` in Pick<>; pass-through trust model matches `info_*` pattern.            |
| `kinetica_bi/src/api/client.ts`                                         | `DashboardLayerDto.dynamic_view_id: number \| null` non-optional                                 | VERIFIED   | Line 473 non-optional `number \| null`; line 508 in updateLayer Pick<>.                                |
| `kinetica_bi/src/lib/wmsUrlBuilder.ts`                                  | 4-case precedence: dv-materialized → null skip → filter-view → bare table                          | VERIFIED   | `DynamicViewEntryInput` exported at line 169; overload signatures at lines 184-194; case 2 null-return at line 232. 66/66 spec tests pass. |
| `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`               | Dashboard-scope orchestrator hook with cold-start gate, per-dv AbortController, list refresh on dynamicViewVersion | VERIFIED | 7 sections: list state (line 56-74), primitive matVersionKey selector (line 86-90), AbortController Map (line 93), last-seen ref (line 99), fireCascade (line 104-161), cascade effect with Pitfall 2 cleanup (line 164-182), unmount cleanup (line 185-191), retry callback (line 197-204). |
| `kinetica_bi/src/components/DashboardContext.tsx`                       | Extended with `dynamicViews: DynamicViewRow[]` + `retryDynamicView: (id) => void` (REQUIRED)      | VERIFIED   | Line 43-44 both fields required; line 65-66 useMemo on value preserves identity.                       |
| `kinetica_bi/src/components/DashboardsPage.tsx`                         | Hook mounted in DashboardOpen + dynamicViews threaded to context + WidgetConfigModal + LayersModal | VERIFIED   | Line 390 `useDynamicViewMaterializeChain(dashboard.id)` mount; lines 873-874 context provider props; lines 965, 975 modal prop threading. |
| `kinetica_bi/src/components/charts/ChartConfigPanel.tsx`                | Three-optgroup picker (Tables/Views/Dynamic Views) + dual-write dynamicViewId + tableId           | VERIFIED   | Lines 366-371 Dynamic Views optgroup; line 204 `value.startsWith("dv:")` branch; line 217 `dynamicViewId: dvId` + line 220 `tableId = sourceTableId`. 16/16 spec tests pass. |
| `kinetica_bi/src/components/charts/WidgetRenderer.tsx`                  | AggregatedWidget + RecordsTable: scoped dv selectors, Effect 2 viewName flip, 5-state + orphan gates, Effect 1 unchanged | VERIFIED | Aggregated: lines 243, 289-310, 444-456, 610-647. RecordsTable: lines 1591-1610 + mirror code. Effect 1 dep array `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion]` UNCHANGED at line 409. 15 new dv-branch tests + LIFE-V13-02 regression tests pass. |
| `kinetica_bi/src/components/charts/MapChartRenderer.tsx`                | `dynamicViewsKey` primitive selector + per-layer dvEntry/dvVersion getState() snapshot + 4-arg buildWmsParams + null-skip + overlay | VERIFIED | Line 431 dynamicViewsKey; lines 864-869, 1023-1028 per-layer lookups; lines 892, 1049 null-skip; line 1672 overlay JSX; dep arrays at lines 1003, 1059 include dynamicViewsKey. 8 new tests pass. |
| `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`            | Data Source picker section with three optgroups (Tables / Dynamic Views) + dv:<id> discriminator   | VERIFIED   | Lines 587-595 Dynamic Views optgroup conditional on non-empty prop; lines 536-546 orphan-fallback to table-id-bound option; dv pick at line 544 emits `{ dynamic_view_id: dvId, table_id: dv.source_table_id }`. |
| `kinetica_bi/src/components/LayersModal.tsx`                            | dynamicViews prop threading + handleDataSourceChange + handleTableChange emits `dynamic_view_id: null` | VERIFIED   | Line 53 dynamicViews prop; line 189 `dynamic_view_id: null` in handleTableChange (mutual exclusion); line 201-209 handleDataSourceChange; line 386 prop forwarded to inner form. |

**Score:** 12/12 artifacts verified.

### Locked Semantics Spot-Check (14 items)

| #   | Locked Semantic                                                                                            | Status     | Evidence                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cold-start gate `matVer === undefined \|\| matVer === 0` in orchestrator hook                              | VERIFIED   | `useDynamicViewMaterializeChain.ts:111`                                                                                                   |
| 2   | Effect 1 in AggregatedWidget UNCHANGED (research finding #2)                                               | VERIFIED   | `WidgetRenderer.tsx:409` dep array `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion]` verbatim — confirmed by grep.       |
| 3   | `tableId` + `dynamicViewId` coexist on widget.config — ChartConfigPanel dual-write on Apply                | VERIFIED   | `ChartConfigPanel.tsx:217-220` writes both; spec Test 4 asserts `{ tableId: 42, dynamicViewId: 7 }`.                                      |
| 4   | Schema `dashboard_layers.dynamic_view_id INTEGER` added via PRAGMA-guarded ALTER; `table_id` stays NOT NULL | VERIFIED   | `server/src/db.ts:102` CREATE; `:181-186` ALTER; line 87 keeps table_id NOT NULL.                                                          |
| 5   | `buildWmsParams` 4-case precedence (dv-materialized → null skip → filter-view → bare-table)                | VERIFIED   | `wmsUrlBuilder.ts:213-232` (precedence comment + case 2 null-return). 66/66 spec tests pass with explicit case 1/2a/2b/2c/3/4 coverage. |
| 6   | `dynamicViewsKey` primitive selector in MapChartRenderer Effects 2+3 dep arrays                            | VERIFIED   | `MapChartRenderer.tsx:431` selector + line 1003, 1059 dep arrays.                                                                          |
| 7   | Effect 2 suspend-gate extends to `dvStatus === "pending"`                                                  | VERIFIED   | `WidgetRenderer.tsx:447` `if (dynamicViewId !== undefined && dvStatus === "pending") return;`                                              |
| 8   | Per-dv `useRef<Map<number, AbortController>>` in orchestrator                                              | VERIFIED   | `useDynamicViewMaterializeChain.ts:93`                                                                                                    |
| 9   | Toast taxonomy `"info" \| "error"` ONLY — zero `"warning"` toast-kind references                            | VERIFIED   | `grep -n '"warning"' WidgetRenderer.tsx MapChartRenderer.tsx ChartConfigPanel.tsx KineticaWmsLayerForm.tsx useDynamicViewMaterializeChain.ts` returns NO toast-kind matches. (`config-hint-warning` is a CSS class name; security-warning comment unrelated.) |
| 10  | Dynamic-view list source: mount-fetch + refresh on `dynamicViewVersion` bump                               | VERIFIED   | `useDynamicViewMaterializeChain.ts:60-74` useEffect with `[dashboardId, dynamicViewVersion]` deps.                                         |
| 11  | 5-state render mapping (undefined / pending / materialized / over_threshold / error) + orphan path         | VERIFIED   | `WidgetRenderer.tsx:610-647` — orphan first, then 4 dv-status gates, materialized falls through.                                          |
| 12  | Over-threshold message verbatim: "Too much data — narrow your filters to enable this view."                | VERIFIED   | `WidgetRenderer.tsx:629` (Aggregated) + `:1606` (RecordsTable). Single message regardless of reason field.                                 |
| 13  | Orphan message verbatim: "This dynamic view was deleted. Reconfigure the widget."                           | VERIFIED   | `WidgetRenderer.tsx:613` (Aggregated) + `:1591` (RecordsTable).                                                                            |
| 14  | Drill-down behavior: `useFilterStore.filters[sourceTableId]` (existing path; tableId persisted on widget.config makes this work) | VERIFIED | ChartConfigPanel dual-write at line 220 persists `tableId = sourceTableId`; existing drill-down code paths read `widget.config.tableId` and continue to work without changes. |

**Score:** 14/14 locked semantics verified.

### Spec Tests (executed)

| Test Suite                                                                            | Expected      | Status     | Result                                                                                                |
| ------------------------------------------------------------------------------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `kinetica_bi && npx vitest run`                                                       | ~961/961      | PASS       | **961/961 across 44 test files** (Phase 34: ~887; Phase 35 added ~74 new tests across hook/renderer/picker/map/layers specs). |
| `kinetica_bi && npx tsc --noEmit`                                                     | exit 0        | PASS       | Zero errors.                                                                                          |
| `kinetica_bi/server && npx vitest run tests/db.smoke.spec.ts tests/layers.spec.ts`    | 32/32         | PASS       | **32/32** — 14 db.smoke (incl. v1.6 column-order + v1.5→v1.6 migration + round-trip) + 18 layers (incl. 3 password + 2 OIDC for `dynamic_view_id`). |
| `kinetica_bi/server && npx tsc --noEmit`                                              | exit 0        | PASS       | Zero errors.                                                                                          |

**Score:** 4/4 test suites passing.

### Requirements Coverage

| Requirement   | Source Plan(s)                              | Description                                                                                                                                                                                                                              | Status     | Evidence                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DV-V16-12** | 35-04                                       | ChartConfigPanel "Data Source" picker adds a Dynamic Views optgroup (when `usesDataSource: true`). Selecting writes `dynamicViewId` to `widget.config`.                                                                                  | SATISFIED  | `ChartConfigPanel.tsx:339` usesDataSource guard; `:366` optgroup; `:217` dynamicViewId write; spec Tests 4 (dual-write) + 9 (Map-widget exclusion) explicitly cover this.                                                                                                                            |
| **DV-V16-13** | 35-01, 35-02, 35-03, 35-05, 35-06           | Renderers read dynamicViewId, look up from useDynamicViewStore, FROM-swap or LAYERS-swap. Cascading re-materialize on filter-view version bump.                                                                                          | SATISFIED  | (a) schema column for per-layer binding (35-01); (b) buildWmsParams 4-case precedence (35-02); (c) orchestrator hook for cascade (35-03); (d) AggregatedWidget + RecordsTable FROM-swap with status gates (35-05); (e) MapChartRenderer LAYERS-swap with per-layer dv lookup (35-06). All passing tests. |
| **DV-V16-14** | 35-05, 35-06                                | Widgets bound to over_threshold dv render verbatim empty state "Too much data — narrow your filters to enable this view." No SQL executed.                                                                                                | SATISFIED  | `WidgetRenderer.tsx:625-631 + 1601-1610` verbatim message; Effect 2 short-circuit at line 454 + records-table mirror; `MapChartRenderer.tsx:1672` overlay; spec assertions at WidgetRenderer.spec.tsx (15 new) + MapChartRenderer.spec.tsx (8 new) + KineticaWmsLayerForm.spec.tsx (7 new).        |

**Plan-to-requirement coverage union:** {DV-V16-12, DV-V16-13, DV-V16-14} = phase requirement IDs exactly. No orphaned requirements; no plans missing.

### Cross-Plan Consistency

| Check                                                                                                                  | Status     | Evidence                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DynamicViewEntryInput` type from Plan 35-02 consumed by Plan 35-06's MapChartRenderer                                  | VERIFIED   | Plan 35-02 exports the type in `wmsUrlBuilder.ts:169`; Plan 35-06's `MapChartRenderer.tsx:864-892, 1023-1049` invokes the 4-arg overload with the dv entry shape. |
| `dynamicViews` prop from Plan 35-03 consumed by Plans 35-04 (via WidgetConfigModal), 35-06 (via LayersModal)            | VERIFIED   | `DashboardsPage.tsx:965, 975` threads to both modals; ChartConfigPanel `:336-371` + KineticaWmsLayerForm `:587-595` render the prop.                            |
| `retryDynamicView` from Plan 35-03 consumed by Plan 35-05 renderer Retry button                                         | VERIFIED   | `DashboardContext.tsx:44, 65` exposes; `WidgetRenderer.tsx:640` `onClick={() => retryDynamicView(dynamicViewId)}`.                                              |
| `dashboard_layers.dynamic_view_id` schema from Plan 35-01 consumed by Plan 35-06 LayersModal/KineticaWmsLayerForm picker | VERIFIED   | `LayersModal.tsx:189, 209` PATCH body uses field; `KineticaWmsLayerForm.tsx:544-546` emits in handler.                                                          |

**Score:** 4/4 cross-plan integrations verified.

### Anti-Patterns Scan

| File                                                                  | Result                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All Phase 35 modified files                                           | No TODO / FIXME / placeholder / "coming soon" markers found in newly-added lines. Single occurrence of "TODO" in `MapChartRenderer.tsx` predates Phase 35 (Phase 12 era). No empty `return null` / `=> {}` handler stubs in new code. |
| Toast taxonomy                                                        | `grep -n '"warning"'` returns zero matches across orchestrator hook + 4 renderer/picker files. Locked Phase 34 ToastKind union preserved.                                                                                            |
| Console.log stubs                                                     | Zero console.log statements in any Phase 35 modified production source files.                                                                                                                                                         |
| Schema integrity                                                      | `table_id` remains NOT NULL (verified at `db.ts:87`); dv-bound layers set `table_id = dv.source_table_id` (research finding #4 lock).                                                                                                  |

### Key Link Verification

| From                                       | To                                          | Via                                              | Status     | Details                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DashboardsPage` `DashboardOpen`           | `useDynamicViewMaterializeChain`            | direct hook call                                 | WIRED      | Line 390: `const { dynamicViews, retry: retryDynamicView } = useDynamicViewMaterializeChain(dashboard.id);`                                                                          |
| `useDynamicViewMaterializeChain`           | `useFilterViewStore.materializeVersion`     | primitive matVersionKey selector                 | WIRED      | Lines 86-90 sorted-and-joined map of `${tid}:${matVer}`.                                                                                                                              |
| `useDynamicViewMaterializeChain`           | `materializeDynamicView` API client          | per-dv AbortController                           | WIRED      | Line 129; per-dv ctrl from Map at line 119-120.                                                                                                                                       |
| `useDynamicViewMaterializeChain`           | `useDynamicViewStore.setView/setError`       | result-branch dispatch                            | WIRED      | Lines 132-144 (3 branches: materialized/over_threshold/error).                                                                                                                        |
| `ChartConfigPanel` `dv:<id>` option        | `widget.config` dual-write                   | Apply onClick                                     | WIRED      | Lines 217-220 + onSave call with `tableId + dynamicViewId`.                                                                                                                          |
| `AggregatedWidgetRenderer`                 | `useDynamicViewStore.views[dynamicViewId]`  | scoped selector                                   | WIRED      | Line 289 `useDynamicViewStore((s) => dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined)`.                                                                              |
| `MapChartRenderer` Effect 2/3              | `buildWmsParams(4-arg)`                     | per-layer dvEntry/dvVersion getState() snapshot   | WIRED      | Lines 864-892 (Effect 2) + 1023-1049 (Effect 3).                                                                                                                                     |
| `LayersModal` `handleDataSourceChange`     | PATCH route `dynamic_view_id`                | `updateLayer` API client                          | WIRED      | Line 201-209 emits patch; client.ts:508 Pick<>; server route at index.ts:597.                                                                                                         |
| `retryDynamicView` (renderer Retry button) | orchestrator `retry(id)`                     | DashboardContext.retryDynamicView                 | WIRED      | DashboardsPage:874 → DashboardContext:44 → WidgetRenderer.tsx:640 onClick.                                                                                                            |

**Score:** 9/9 key links verified.

### Human Verification Recommended (Live UAT)

Although every locked semantic, artifact, requirement, and cross-plan link is verified at the source level — and the full test suite passes (961 frontend + 32 server) — Phase 35 is the deepest cross-cutting integration of v1.6. The following items would benefit from live UAT before milestone close. Per v1.5 TD-V15-LIVE-UAT precedent (and the Phase 33/34 source-only attestation pattern), the phase status remains **passed**, but these items should be enumerated for Phase 36's verifier (or carried forward as TD-V16-LIVE-UAT):

1. **Cascade timing on rapid filter changes** — AbortController per-dv cancellation, observable React effect graph ordering, WMS tile cache invalidation behavior. Spec-level coverage exists (17 hook tests + 8 map tests) but tile-load + OL layer add/remove are real-browser surfaces.
2. **Map widget per-layer dv binding round-trip via LayersModal** — Operator picks `dv:7` in the Data Source picker → server stores `dynamic_view_id=7`, `table_id=dv.source_table_id` → layer URL flips to `LAYERS=<dvViewName>` after orchestrator materializes. End-to-end client-PATCH-server-WMS-OL chain.
3. **Over-threshold empty state + Retry button** — Aggregated widget bound to an `over_threshold` dynamic view renders the verbatim ROADMAP message ("Too much data — narrow your filters to enable this view.") with NO SQL fired; clicking Retry re-fires the orchestrator's retry path through `DashboardContext.retryDynamicView`.
4. **Orphan widget UX after dv delete** — Operator deletes a dynamic view via DynamicViewsModal → all widgets bound to that dynamicViewId render the verbatim orphan empty state ("This dynamic view was deleted. Reconfigure the widget.").
5. **Drill-down on dv-bound widget** — Click writes to `useFilterStore.filters[sourceTableId]` → filter-view materializes → orchestrator detects matVer bump → dv re-materializes → widget refreshes with new dvViewName. Full cascade pipeline only observable in real browser interaction.
6. **"Some layers over threshold" map overlay** — At least one dv-bound layer goes non-materialized → overlay surfaces (`.map-over-threshold-overlay` top-right corner); layer omitted from visible OL stack; narrow filter → overlay disappears + layer reappears.

These are enumerated for Phase 36 verifier consumption (or TD-V16-LIVE-UAT absorption).

### Gaps Summary

**None.**

All 4 ROADMAP success criteria pass, all 14 locked semantics pass, all 3 requirement IDs are satisfied across 6 plans with full coverage union matching the phase contract, all cross-plan integration links are wired, all 9 critical wiring paths verified, no anti-patterns found, both frontend (961/961) and server (32/32) test suites pass, and tsc is clean for both packages.

Phase 35 closes v1.6's deepest integration milestone (widget binding + cascading materialize pipeline + over-threshold UX). Spec coverage is comprehensive at ~74 new tests across renderer/hook/picker/map/layers specs. The recommended live UAT items above are best-practice validation, not gaps — the source-only attestation is complete.

---

_Verified: 2026-05-15T18:05:00Z_
_Verifier: Claude (gsd-verifier)_
