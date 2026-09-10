---
phase: 16-map-filtering
plan: 01
subsystem: ui
tags: [openlayers, wms, zustand, materialized-view, kinetica, react, vitest]

# Dependency graph
requires:
  - phase: 13-spikes-and-endpoint
    provides: WMS LAYERS=<materialized_view_name> spike PASS (S1); /api/filter/materialize endpoint contract
  - phase: 14-filter-view-store
    provides: useFilterViewStore (views[tableId] = { viewName, expiresAt, materializing, materializeVersion, dashboardId })
  - phase: 15-chart-filtering
    provides: AggregatedWidgetRenderer materialize trigger (sole DDL writer); FilteringBadge chart-side pattern; isViewExpired inline equivalent in WidgetRenderer.tsx
provides:
  - LAYERS=<viewName> swap when filter active for a map layer's tableId
  - LAYERS=<schema.table> raw fallback when no entry / expired entry
  - _mv (materialize-version) cache-buster, conditional emit on materializeVersion !== undefined
  - viewsKey top-level Zustand selector driving Effect 3 re-fires
  - MapFilteringBadge any-of-N tableIds materializing chrome
  - isViewExpired helper (extracted from inline Phase 15 pattern; now reusable)
affects: [phase-17-verification, future-widgetrenderer-refactor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-layer view-store snapshot read at effect re-fire (useFilterViewStore.getState().views[tableId]) mirrors useFilterStore.getState().filterVersion call pattern"
    - "viewsKey stable-string selector pattern: sorted+deduped tableIds joined as `${id}:${viewName ?? ''}:${materializeVersion ?? 0}`"
    - "Vite ?raw module-source grep for module-level lock assertions in vitest specs (no @types/node dependency)"
    - "Caller-substitutes-viewName-into-tableRef pattern keeps wmsUrlBuilder unaware of view-vs-raw distinction"

key-files:
  created:
    - kinetica_bi/src/lib/viewExpiry.ts
    - kinetica_bi/src/lib/viewExpiry.spec.ts
    - kinetica_bi/src/components/MapFilteringBadge.tsx
    - kinetica_bi/src/components/MapFilteringBadge.spec.tsx
  modified:
    - kinetica_bi/src/lib/wmsUrlBuilder.ts
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
    - kinetica_bi/src/components/DashboardsPage.tsx

key-decisions:
  - "buildWmsParams signature changed from (config, filterVersion: number, whereClause: string) to (config, materializeVersion: number | undefined) — type-enforces AP-3 server-side-WHERE-only lock"
  - "_mv emitted conditionally (materializeVersion !== undefined) — no _mv=0 sentinel for no-view path (PT16-A); LAYERS source flip alone drives URL change for OL ImageWMS cache-bust"
  - "viewsKey selector subscribes per-included-tableId scope (not whole s.views) per PITFALL C-02; sorted ascending + deduped for drag-reorder stability"
  - "Effect 3 dep array kept filterVersion AND added viewsKey (PT16-E lock) — removing filterVersion would break pre-materialize re-fires during 300ms debounce window"
  - "MapFilteringBadge uses any-of-N-tableIds materializing semantics (single per-widget badge), not per-layer — matches FilteringBadge UX parity for chart widgets"
  - "Test 16-E (pure consumer lock) uses Vite ?raw query-string import for module-source grep instead of node fs/path (avoids @types/node dependency that's not in tsconfig.types)"
  - "Caller substitutes viewName into tableRef at the build site (wmsConfigInput.tableRef = viewName ?? rawTableRef); builder is unaware of view-vs-raw distinction — keeps narrow MapWidgetConfig type"
  - "Atomic single-PLAN file per user-locked decision (5 internal tasks, 4 atomic commits + this metadata commit) — final green state has tsc 0 + vitest 332/332"

patterns-established:
  - "isViewExpired helper: undefined → false (no expiry), expiresAt=0 → true (markMaterializing placeholder), Date.now() >= expiresAt → true (boundary)"
  - "MapFilteringBadge tableIds prop: number[] (sorted+joined memo key drives selector stability)"
  - "Phase 16 LAYERS-swap: LAYERS resolution is a 3-level decision tree (viewName → rawTableRef → layerName legacy fallback in builder)"
  - "Effect 3 re-fire trigger split: filterVersion (chip-state, pre-materialize) + viewsKey (post-materialize entry mutations); both required by PT16-E"

requirements-completed: [MAP-V13-01, MAP-V13-02, MAP-V13-03, MAP-V13-04, MAP-V13-05, MAP-V13-06]

# Metrics
duration: 11min
completed: 2026-05-07
---

# Phase 16 Plan 01: map-filtering Summary

**LAYERS-swap WMS map filtering: per-layer useFilterViewStore consumer with proactive isViewExpired fallback, _mv cache-buster, viewsKey selector, MapFilteringBadge widget chrome — replaces v1.2 broken LAYERS=<table>&QUERY=<where> pattern with v1.3 LAYERS=<view_name>**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-07T03:45:15Z
- **Completed:** 2026-05-07T03:56:24Z
- **Tasks:** 5 (Tasks 1-5)
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- Type-enforced AP-3 lock: buildWmsParams signature change (3-arg → 2-arg) deletes whereClause arg at compile time; FILT-04 QUERY emit block + FILTER_PARAM constant deleted
- _v=filterVersion cache-buster renamed to _mv=materializeVersion with conditional emit (PT16-A: no _mv=0 sentinel)
- Effects 2+3 LAYERS-swap surgery: per-layer useFilterViewStore.getState().views[tableId] reads, isViewExpired proactive fallback, viewName substituted into tableRef at call site
- viewsKey top-level Zustand selector drives Effect 3 re-fires on entry mutations (post-materialize); filterVersion retained as primary trigger (pre-materialize, PT16-E lock)
- MapFilteringBadge: per-widget any-of-N-tableIds materializing badge wired into DashboardsPage widget header for type==='map'; FilteringBadge preserved for non-map widgets
- v1.2 lifecycle preservation locks (V13-P-06) byte-preserved: M-01 dispose, ResizeObserver, XHR imageLoadFunction, tile-error toast, Effect 1 mount, Effect 4 basemap
- Pure consumer lock (VSTORE-V13-02 / MAP-V13-05): MapChartRenderer.tsx has zero materializeFilter / dropFilterView / setView / markMaterializing / bumpMaterializeVersion / clearView references (verified by Test 16-E module-source grep)

## Task Commits

Each task was committed atomically (5 tasks; final metadata commit captures STATE/ROADMAP):

1. **Task 1: Create isViewExpired helper + spec (Wave 1)** — `bc82eb8` (feat)
2. **Task 2: wmsUrlBuilder.ts signature change + spec rewrite (Wave 1)** — `402198d` (refactor)
3. **Task 3: MapChartRenderer.tsx Effects 2+3 LAYERS-swap surgery (Wave 2)** — `cdb7bbd` (feat)
4. **Task 4: MapChartRenderer spec + MapFilteringBadge + DashboardsPage wiring (Wave 3)** — `11dbbb1` (feat)
5. **Task 5: Final green gate (Wave 4)** — verification-only; no source modifications; final atomic state captured by Task 4 commit (tsc green + vitest 332/332)

**Plan metadata commit:** to be created after STATE/ROADMAP/REQUIREMENTS update.

## Files Created/Modified

- `kinetica_bi/src/lib/viewExpiry.ts` (created, 26 LOC) — isViewExpired(entry) helper; undefined → false, expiresAt=0 → true, Date.now() >= expiresAt → true
- `kinetica_bi/src/lib/viewExpiry.spec.ts` (created, 47 LOC) — 5 boundary tests (undefined, future, past, 0 placeholder, ===)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` (modified, -100/+78; 247 LOC final) — 2-arg signature; QUERY/_v/whereClause/FILTER_PARAM all deleted; _mv conditional emit
- `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` (modified, -100/+78; 465 LOC final) — FILT-04 describe block deleted; LAYERS source decision tree (5 tests) + _mv emission (5 tests) describe blocks added; all existing spatial/render-mode tests retained with 2-arg call form
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (modified, -32/+77; 532 LOC final) — useFilterViewStore + isViewExpired imports; uniqueTableIds + viewsKey selector; Effects 2+3 LAYERS-swap with per-layer view-store snapshot + isViewExpired fallback; Phase 16 TODO comments + whereClause stubs deleted; v1.2 lifecycle locks byte-preserved
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (modified, +147; 812 LOC final) — _filterViewState shared mock + vi.mock filterViewStore; new "Phase 16 LAYERS-swap" describe block with 5 tests (16-A no entry, 16-B active view, 16-C expired entry, 16-D Effect 3 viewsKey re-fire, 16-E pure consumer lock via Vite ?raw)
- `kinetica_bi/src/components/MapFilteringBadge.tsx` (created, 46 LOC) — any-of-N-tableIds materializing primitive-boolean Zustand selector with content-stable memo key
- `kinetica_bi/src/components/MapFilteringBadge.spec.tsx` (created, 74 LOC) — 4 tests (M-A null when none, M-B render when ANY, M-C any-of-N semantics, M-D empty array → null)
- `kinetica_bi/src/components/DashboardsPage.tsx` (modified, +24/-1; 1035 LOC final) — MapFilteringBadge import + conditional render (type==='map' → MapFilteringBadge; else → existing FilteringBadge); mapTableIds derived from layers + cfg.includedLayerIds + visible filter (mirrors MapChartRenderer.tsx:159-171 logic)

## Decisions Made

See frontmatter `key-decisions` for full list. Highlights:

- **Type-enforce AP-3 via signature change** rather than runtime assertions — deleting `whereClause` from `buildWmsParams` means the architectural boundary is checked at compile time
- **_mv conditional emit (PT16-A)** — no `_mv=0` sentinel. When falling through to `LAYERS=<schema.table>`, the URL changes anyway, so cache-bust is automatic
- **viewsKey scope = per-included-tableId, not whole `s.views`** (PITFALL C-02) — sorted+deduped for drag-reorder stability across `includedLayers` re-orders
- **Effect 3 dep array = `[filterVersion, viewsKey, includedLayers, tables]`** (PT16-E) — both triggers required: filterVersion for pre-materialize chip-state changes during 300ms debounce window, viewsKey for post-materialize entry mutations
- **MapFilteringBadge any-of-N semantics** (Claude's Discretion default per 16-CONTEXT) — single per-widget badge driven by ANY included layer's tableId materializing; matches FilteringBadge UX parity
- **Vite ?raw for Test 16-E module-source grep** — avoids node fs/path imports (no `@types/node` in tsconfig.types); evaluates at test-load time as a string

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] file-head doc comment trimmed to satisfy literal grep gate**
- **Found during:** Task 2 (wmsUrlBuilder.ts signature change)
- **Issue:** The plan's prescribed file-head comment block contained the literal tokens `whereClause`, `QUERY`, and `filterVersion` (describing the deletion history). Task 2's acceptance criteria require literal grep counts of 0 for those tokens in the source. Tension within the plan: prescribed comment text vs. literal grep gate.
- **Fix:** Rewrote the file-head doc comment to use prose forms (`SQL-clause arg`, `prior FILT-04 filter emit block`, `filter-version cache-buster`) that preserve the architectural intent without the literal tokens. Executable code unchanged.
- **Files modified:** kinetica_bi/src/lib/wmsUrlBuilder.ts (file-head comment block only)
- **Verification:** Re-ran grep gate — `QUERY:0`, `whereClause:0`, `filterVersion:0`; vitest still passes 53/53.
- **Committed in:** `402198d` (Task 2 commit)

**2. [Rule 3 - Blocking] Effect 3 doc comment rephrased to satisfy pure consumer lock grep**
- **Found during:** Task 3 (MapChartRenderer Effect 3 surgery)
- **Issue:** Plan-prescribed Effect 3 doc comment mentioned `setView` (e.g., "post-materialize, when setView writes a new viewName"). Task 3 acceptance criterion is `grep -cE "...setView\\b..." == 0` — word-boundary grep would still match comment references.
- **Fix:** Rephrased the comment to use store-relative phrasing ("when filterViewStore receives a new viewName / materializeVersion"; "the view-store entry hasn't been written yet"). Behavior unchanged.
- **Files modified:** kinetica_bi/src/components/charts/MapChartRenderer.tsx (Effect 3 doc comment only)
- **Verification:** `grep -cE "materializeFilter|dropFilterView|setView\\b|markMaterializing|bumpMaterializeVersion|clearView" == 0`; tsc green; vitest 21/21 passes.
- **Committed in:** `cdb7bbd` (Task 3 commit)

**3. [Rule 3 - Blocking] Test 16-E switched from node fs/path to Vite ?raw module-source import**
- **Found during:** Task 4 (MapChartRenderer spec extension)
- **Issue:** Plan-prescribed Test 16-E used `await import("fs")` + `await import("path")` + `__dirname` to read MapChartRenderer.tsx for module-level grep. tsc errored: `TS2307: Cannot find module 'fs'` and `TS2304: Cannot find name '__dirname'` — tsconfig.types lacks `node`, and the project does not depend on `@types/node`.
- **Fix:** Switched to Vite's `?raw` query-string import: `(await import("./MapChartRenderer.tsx?raw")).default` — Vite bundles file content as a string at test load time. Same behavior (module-level static grep), no node dependency.
- **Files modified:** kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (Test 16-E body only)
- **Verification:** tsc clean; vitest 26/26 (including Test 16-E) pass.
- **Committed in:** `11dbbb1` (Task 4 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 3 blocking)
**Impact on plan:** All three deviations are tooling/linting-level fixes that preserve architectural intent. No scope creep; no semantic change. The Vite ?raw pattern (#3) is a cleaner long-term Test 16-E pattern than node fs/path (no environment-specific dependencies) and is now an established pattern for module-source grep assertions in this codebase.

## Issues Encountered

None — plan executed in 11 minutes with three minor inline tool-tension fixes (deviations 1-3 above).

## Self-Check

- File `kinetica_bi/src/lib/viewExpiry.ts` — FOUND
- File `kinetica_bi/src/lib/viewExpiry.spec.ts` — FOUND
- File `kinetica_bi/src/components/MapFilteringBadge.tsx` — FOUND
- File `kinetica_bi/src/components/MapFilteringBadge.spec.tsx` — FOUND
- Commit `bc82eb8` — FOUND
- Commit `402198d` — FOUND
- Commit `cdb7bbd` — FOUND
- Commit `11dbbb1` — FOUND
- tsc --noEmit — exit 0
- vitest run — 332/332 pass
- Pure consumer lock — 0 forbidden refs in MapChartRenderer.tsx
- v1.2 lifecycle locks (V13-P-06) — all preserved per grep gate
- Phase 16 deletions (QUERY/_v/whereClause/FILTER_PARAM/Phase 16 TODO) — all 0
- Phase 16 additions (materializeVersion/_mv/useFilterViewStore/isViewExpired/viewsKey/MapFilteringBadge) — all present at expected counts

**Self-Check: PASSED**

## User Setup Required

None — no external service configuration required. Phase 16 is a pure-frontend wiring change against existing endpoints (Phase 13's `/api/filter/materialize`) and stores (Phase 14's `useFilterViewStore`).

## Next Phase Readiness

Phase 17 (verification) can now consume:

- All 6 MAP-V13-* requirements implemented and grep-confirmed
- Manual UAT flows ready:
  1. Filter active for table with map layer → tiles narrow (gated on Phase 17 VERIFY-V13-01 low-cardinality fixture)
  2. "Clear All" → next WMS GetMap carries `LAYERS=<schema.table>` and OMITS `_mv`
  3. Same-name re-materialize → `LAYERS=<same_view_name>` but `_mv` increments
- DEFERRED to Phase 17: SPIKE-V13-02 OIDC-mode probe (S2.b) re-run before milestone close — no OIDC token reachable in spike environment per Phase 13 lock
- Optional follow-up (post-v1.3): refactor `WidgetRenderer.tsx` Phase 15 LIFE-V13-01 inline expiry check to use `viewExpiry.ts` helper

---
*Phase: 16-map-filtering*
*Completed: 2026-05-07*
