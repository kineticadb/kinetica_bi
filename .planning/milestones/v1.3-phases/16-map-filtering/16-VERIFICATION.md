---
phase: 16-map-filtering
verified: 2026-05-07T04:03:17Z
status: human_needed
score: 7/7 must-haves verified (automated); 1 must-have additionally requires human visual confirmation
human_verification:
  - test: "Apply a filter by clicking a chart on a dashboard whose map widget shares the same table; observe that map tiles visibly narrow to the filtered subset"
    expected: "Map tiles re-render and only the matching spatial points/shapes remain visible (gated on SPIKE-V13-01 PASS, deferred to Phase 17 with low-cardinality fixture)"
    why_human: "Visual outcome — tile pixel content cannot be asserted programmatically without running the live Kinetica WMS endpoint and inspecting rendered PNGs"
  - test: "Open browser DevTools Network tab on a dashboard with map+chart sharing a table; click filter; clear filter; confirm WMS request URLs"
    expected: "While filtered: LAYERS=_kbi_filt_<...>&_mv=<n> ; after clear: LAYERS=<schema.table> with NO _mv param"
    why_human: "Network-tab inspection requires a live browser session against the dev server + Kinetica WMS proxy"
  - test: "Re-trigger the same filter (or change filter value on same table) and confirm a new WMS GetMap is fetched even though LAYERS string is unchanged"
    expected: "_mv value increments in the request URL; OL ImageWMS issues a fresh tile request (no cached tile shown)"
    why_human: "Requires observing OL cache behavior + URL changes during a real filter interaction"
  - test: "Confirm v1.2 lifecycle preservation in StrictMode dev build: no double Map construction, no blank-tile flash on filter clear, ResizeObserver.updateSize fires on grid-cell mount"
    expected: "console shows single 'Map mounted' (or no double-mount), filter clear keeps prior tiles in place until new ones load, ResizeObserver triggers updateSize when widget moves into view"
    why_human: "Real-time DOM/OL behavior in StrictMode dev build cannot be asserted via static analysis"
---

# Phase 16: map-filtering Verification Report

**Phase Goal:** Map tiles narrow to filtered data when a filter is active (closes TD-V12-01); `QUERY` param is gone from all WMS requests; `_mv` cache-buster ensures OL re-fetches on every materialize
**Verified:** 2026-05-07T04:03:17Z
**Status:** human_needed (all automated checks pass; visual/network-tab + StrictMode runtime checks deferred to Phase 17 UAT)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                  | Status            | Evidence                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | When a filter is active for a table with a map layer, WMS GetMap carries `LAYERS=<view_name>` from `useFilterViewStore.views[tableId].viewName` | ✓ VERIFIED        | `MapChartRenderer.tsx:351-364` reads `useFilterViewStore.getState().views[tableId]`, checks `isViewExpired`, substitutes `viewName` into `tableRef`, calls `buildWmsParams(wmsConfigInput, materializeVersion)`. Spec test 16-B confirms |
| 2   | When no filter active OR entry expired, request carries `LAYERS=<schema.table>` (rawTableRef) AND `_mv` is OMITTED                     | ✓ VERIFIED        | `wmsUrlBuilder.ts:145-147` emits `_mv` only `if (materializeVersion !== undefined)`; `MapChartRenderer.tsx:354` sets `materializeVersion = undefined` when expired/no-entry. Specs 16-A and 16-C confirm |
| 3   | When same view re-materializes (CREATE OR REPLACE same name), `setView` auto-bumps `materializeVersion`; next build emits new `_mv`; OL re-fetches | ✓ VERIFIED        | `viewsKey` selector at `MapChartRenderer.tsx:187-193` includes `materializeVersion`; Effect 3 dep array contains `viewsKey`; Spec test 16-D asserts `source.updateParams` called with new `_mv`           |
| 4   | `wmsUrlBuilder.ts` no longer references QUERY, FILTER_PARAM, _v, whereClause, or filterVersion; tsc passes                             | ✓ VERIFIED        | `grep -nE "QUERY\|FILTER_PARAM\|whereClause\|filterVersion" wmsUrlBuilder.ts` → 0 matches; `tsc --noEmit` exits 0                                                                                          |
| 5   | `MapChartRenderer.tsx` is pure consumer — never imports `materializeFilter`/`dropFilterView`; never calls `setView`/`markMaterializing`/`bumpMaterializeVersion`/`clearView` | ✓ VERIFIED        | `grep -nE "materializeFilter\|dropFilterView\|setView\|markMaterializing\|bumpMaterializeVersion\|clearView" MapChartRenderer.tsx` → 0 matches; spec test 16-E asserts via Vite `?raw` module-source grep |
| 6   | v1.2 lifecycle locks (M-01 dispose, ResizeObserver, XHR imageLoadFunction, tile-error toast, Effect 1 mount, Effect 4 basemap) preserved | ⚠️ AUTOMATED-OK   | Source-level checks pass: `map.setTarget(undefined)` + `map.dispose()` at line 291-292; `ResizeObserver` at 278; `XMLHttpRequest` + `arraybuffer` at 225-228; `imageloaderror`/`imageloadend` at 390-391; "Map tiles failed to load." toast at 383; Effect 4 `setSource` at 477. Byte-equivalence in StrictMode dev build needs human |
| 7   | Map widget header shows "Filtering..." badge when ANY included layer's tableId has `materializing=true`                                | ✓ VERIFIED        | `DashboardsPage.tsx:771-775` renders `<MapFilteringBadge tableIds={mapTableIds} />` when `w.type === 'map'`; mapTableIds derived via includedLayerIds + visibility filter; `MapFilteringBadge.tsx:33-37` uses any-of-N selector. Spec tests M-A..M-D pass |

**Score:** 7/7 truths VERIFIED (automated)
**Note:** Truth 1 has a downstream visual confirmation (tiles narrow) that is gated on Phase 17 UAT with low-cardinality fixture. Truth 6 byte-equivalence in StrictMode dev build is flagged for human runtime check.

### Required Artifacts

| Artifact                                                       | Expected                                                                                                                | Status     | Details                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `kinetica_bi/src/lib/viewExpiry.ts`                            | `isViewExpired(entry)` helper                                                                                            | ✓ VERIFIED | 26 LOC; exports `isViewExpired`; correct semantics (undefined→false, expiresAt=0→true, Date.now()>=exp→true) |
| `kinetica_bi/src/lib/viewExpiry.spec.ts`                       | Spec for isViewExpired                                                                                                  | ✓ VERIFIED | 5 tests covering all boundary cases                                                                            |
| `kinetica_bi/src/lib/wmsUrlBuilder.ts`                         | 2-arg `buildWmsParams(config, materializeVersion)`; QUERY/FILTER_PARAM/whereClause/_v/filterVersion deleted; conditional `_mv` emit | ✓ VERIFIED | Signature at line 128-131 (2 args); QUERY/FILTER_PARAM/whereClause/filterVersion grep counts = 0; conditional `_mv` at 145-147 |
| `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts`                    | FILT-04 block deleted; LAYERS source decision tree + _mv emission describes added                                       | ✓ VERIFIED | New describes "LAYERS source decision tree" (line 55) and "_mv emission" (line 86); 10 _mv references; QUERY-not-emitted assertions retained |
| `kinetica_bi/src/components/charts/MapChartRenderer.tsx`        | Effects 2+3 wired to useFilterViewStore per-layer with isViewExpired fallback; Effect 3 dep array includes viewsKey      | ✓ VERIFIED | useFilterViewStore + isViewExpired imports at 44-45; viewsKey selector at 187-193; Effect 2 (line 351), Effect 3 (line 453) read view-store snapshots; Effect 3 deps `[filterVersion, viewsKey, includedLayers, tables]` at 471 |
| `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` | Extended spec with `_filterViewState` mock + LAYERS-swap + expiry fallback + _mv emission tests + pure-consumer-lock test | ✓ VERIFIED | "Phase 16 LAYERS-swap" describe block at line 684 with tests 16-A through 16-E                                |
| `kinetica_bi/src/components/MapFilteringBadge.tsx`              | Any-of-N tableIds materializing primitive-boolean selector                                                              | ✓ VERIFIED | 46 LOC; sorted+joined memo key; `s.views[id]?.materializing === true` ANY check                              |
| `kinetica_bi/src/components/MapFilteringBadge.spec.tsx`        | Tests for any-of-N semantics                                                                                            | ✓ VERIFIED | 4 tests (M-A through M-D)                                                                                     |
| `kinetica_bi/src/components/DashboardsPage.tsx`                | Conditional render of `<MapFilteringBadge tableIds={...}>` for `type==='map'` widgets                                    | ✓ VERIFIED | Import at line 42; conditional render at 771-775; mapTableIds derived from includedLayerIds + visible filter at 754-766 |

### Key Link Verification

| From                                            | To                                                       | Via                                                                                                | Status   | Details                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `MapChartRenderer.tsx`                          | `kinetica_bi/src/store/filterViewStore.ts`               | `useFilterViewStore((s) => viewsKey)` at top + `useFilterViewStore.getState().views[layer.table_id]` in Effects 2/3 | ✓ WIRED | Top-level selector at line 187-193; `getState()` reads at 351 (Effect 2) + 453 (Effect 3)                |
| `MapChartRenderer.tsx`                          | `kinetica_bi/src/lib/viewExpiry.ts`                       | `isViewExpired(entry)` call inside Effects 2/3                                                     | ✓ WIRED  | Imported at line 45; called at 352 (Effect 2) + 454 (Effect 3)                                           |
| `MapChartRenderer.tsx`                          | `kinetica_bi/src/lib/wmsUrlBuilder.ts`                    | `buildWmsParams(wmsConfigInput, materializeVersion)` 2-arg call                                    | ✓ WIRED  | Called at line 364 (Effect 2 ADD branch) + 465 (Effect 3 updateParams branch); both 2-arg form           |
| `DashboardsPage.tsx`                            | `kinetica_bi/src/components/MapFilteringBadge.tsx`       | import + render in widget card header for `type === 'map'`                                          | ✓ WIRED  | Import at line 42; rendered conditionally at 771-775                                                      |
| `MapFilteringBadge.tsx`                         | `kinetica_bi/src/store/filterViewStore.ts`               | `useFilterViewStore((s) => tableIds.some(...))` primitive boolean selector                          | ✓ WIRED  | Selector at line 33-37; primitive boolean returned                                                        |

All 5 key links VERIFIED.

### Requirements Coverage

| Requirement   | Source Plan | Description                                                                                                                                                                                                                                                                                                | Status      | Evidence                                                                                                                                                                                                                                                                  |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MAP-V13-01    | 16-01-PLAN  | When filters are active for a table, map layers use `LAYERS=<view_name>` instead of `LAYERS=<table>` (gated on SPIKE-V13-01 passing)                                                                                                                                                                       | ✓ SATISFIED | Truth 1 + Spec 16-B + Effect 2/3 viewName substitution at MapChartRenderer.tsx:353,361                                                                                                                                                                                    |
| MAP-V13-02    | 16-01-PLAN  | When filters NOT active, map layers fall back to `LAYERS=<table>`                                                                                                                                                                                                                                          | ✓ SATISFIED | Truth 2 + Spec 16-A + isViewExpired fallback path at MapChartRenderer.tsx:352-353                                                                                                                                                                                          |
| MAP-V13-03    | 16-01-PLAN  | `wmsUrlBuilder.ts` `QUERY`/`FILTER_PARAM` block fully removed; `_v` renamed to `_mv` from `useFilterViewStore.materializeVersion[tableId]`                                                                                                                                                                  | ✓ SATISFIED | wmsUrlBuilder.ts grep counts: QUERY=0, FILTER_PARAM=0, whereClause=0, filterVersion=0; conditional `_mv` emit at lines 145-147                                                                                                                                            |
| MAP-V13-04    | 16-01-PLAN  | `MapChartRenderer` Effect 3 dep array changed to use stable `viewsKey` derived from `useFilterViewStore`; Effect 1 + Effect 2 source-attach unchanged; v1.2 PITFALL locks preserved verbatim with explicit lock comments                                                                                  | ✓ SATISFIED | viewsKey at line 187-193; Effect 3 deps `[filterVersion, viewsKey, includedLayers, tables]` at line 471; M-01/M-02/M-03/S-02 lock comments still present at 5/7/9/10                                                                                                       |
| MAP-V13-05    | 16-01-PLAN  | Map widgets are PURE CONSUMERS of `useFilterViewStore` — never trigger materialize                                                                                                                                                                                                                          | ✓ SATISFIED | Truth 5 + Spec 16-E module-source grep returns 0 forbidden refs                                                                                                                                                                                                            |
| MAP-V13-06    | 16-01-PLAN  | `wmsUrlBuilder.spec.ts` FILT-04 block deleted; `_v` test cases updated to `_mv`; new tests assert `LAYERS=<view>` substitution                                                                                                                                                                              | ✓ SATISFIED | New describe blocks "LAYERS source decision tree" (line 55) and "_mv emission" (line 86); 10 `_mv` references; QUERY-never-emitted regression assertion at line 107                                                                                                       |

All 6 requirement IDs accounted for in PLAN frontmatter and REQUIREMENTS.md (status `Complete` for each); zero ORPHANED requirements.

### Anti-Patterns Found

| File                                  | Line   | Pattern                                                       | Severity | Impact                                                                                                                                                                                          |
| ------------------------------------- | ------ | ------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MapChartRenderer.tsx`                | 215    | `TRANSPARENT_PLACEHOLDER` constant name contains "PLACEHOLDER" | ℹ️ Info  | False positive — this is a 1×1 transparent GIF data URI used as the legitimate fallback when WMS tile fetch fails (v1.1 lifecycle pattern, not a stub). No action needed.                       |

No blocker-severity or warning-severity anti-patterns found. No TODO/FIXME/XXX/HACK comments in any of the 9 modified files. No empty implementations, no console.log-only handlers, no `return null` stubs.

### Test Suite Status

- **tsc --noEmit:** exit 0 (no type errors)
- **vitest run:** 25 test files pass, 332/332 tests pass
  - Suite duration 7.97s
  - Includes new Phase 16 tests: viewExpiry.spec.ts (5), MapFilteringBadge.spec.tsx (4), MapChartRenderer.spec.tsx Phase 16 LAYERS-swap describe (5), wmsUrlBuilder.spec.ts new "LAYERS source decision tree" + "_mv emission" describe blocks (10)
- **Stderr noise:** intentional — DashboardContext.spec.tsx exercises the explicit-throw path of `useDashboardContext`. Suite still 332/332 green.

### Commit Verification

All 4 task-commit hashes claimed in SUMMARY exist in `git log`:

| SUMMARY-claimed | Actual                                                              | Status   |
| --------------- | ------------------------------------------------------------------- | -------- |
| `bc82eb8`       | `bc82eb8 feat(16-01): add isViewExpired helper for proactive TTL fallback` | ✓ FOUND |
| `402198d`       | `402198d refactor(16-01): wmsUrlBuilder buildWmsParams 2-arg signature + _mv` | ✓ FOUND |
| `cdb7bbd`       | `cdb7bbd feat(16-01): MapChartRenderer Effects 2+3 LAYERS-swap + viewsKey selector` | ✓ FOUND |
| `11dbbb1`       | `11dbbb1 feat(16-01): MapFilteringBadge + MapChartRenderer specs + DashboardsPage wire` | ✓ FOUND |

Plus a metadata commit `6363a1e docs(16-01): complete map-filtering plan` already on HEAD before verification (added STATE/ROADMAP/REQUIREMENTS updates).

### Human Verification Required

See frontmatter `human_verification:` for the 4 manual checks. Summary:

1. **Visual filter narrowing** — observe map tiles narrow to filtered subset on filter apply (gated on Phase 17 SPIKE-V13-01 fixture; Truth 1 visual side)
2. **Network-tab WMS URL inspection** — confirm `LAYERS=_kbi_filt_<...>&_mv=<n>` while filtered and `LAYERS=<schema.table>` (no `_mv`) after Clear All (Truth 2 + Truth 3 network side)
3. **Same-name re-materialize cache-bust** — confirm `_mv` increments on filter change with same view name; OL re-fetches (Truth 3 runtime side)
4. **v1.2 lifecycle preservation in StrictMode dev build** — single Map construction, no blank-tile flash on clear, ResizeObserver triggers updateSize on grid-cell mount (Truth 6 runtime side)

These are all on the Phase 17 UAT roadmap (per SUMMARY "Next Phase Readiness"); deferred from this verification per Phase-17 plan structure.

### Gaps Summary

**No blocking gaps.** All 7 must-have truths, all 9 artifacts, all 5 key links, all 6 MAP-V13-* requirements, and all 4 task commits verify as expected. Test suite green (332/332). TypeScript clean. Pure-consumer lock holds. v1.2 lifecycle locks preserved at the source level.

The phase goal — "Map tiles narrow to filtered data when a filter is active; QUERY param gone; _mv ensures cache-bust" — is fully implemented at the code level. The remaining 4 items requiring human confirmation are all observable runtime behaviors (network URLs, OL cache behavior, StrictMode double-mount) that cannot be asserted from static analysis. They are all claimed by Phase 17 UAT per the existing roadmap.

**Recommendation:** Proceed to Phase 17 UAT. No re-execution of Phase 16 needed.

---

_Verified: 2026-05-07T04:03:17Z_
_Verifier: Claude (gsd-verifier)_
