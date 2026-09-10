---
phase: 35-widget-binding-and-pipeline
plan: 04
subsystem: ui

tags: [react, vitest, dynamic-views, chartconfig, data-source-picker, optgroup, tdd]

# Dependency graph
requires:
  - phase: 35-widget-binding-and-pipeline
    provides: "Plan 35-03 — DashboardOpen-scope useDynamicViewMaterializeChain hook + DashboardContext.dynamicViews + WidgetConfigModal dynamicViews prop conduit (was _-prefixed in this plan's pre-state)"
  - phase: 34-dynamic-view-ui
    provides: "Preview-then-Save populates DynamicViewRow.columns_json on the wire (JSON string of [{name,type}])"
  - phase: 33-dynamic-view-store
    provides: "DynamicViewRow shape + listDynamicViews client helper consumed for the third optgroup data"
  - phase: 32-dynamic-view-foundation
    provides: "DashboardDynamicView server table + 6 CRUD endpoints (no new server work; pure-frontend picker)"
provides:
  - "ChartConfigPanel dynamicViews?: DynamicViewRow[] optional prop (forwarded by WidgetConfigModal in DashboardsPage)"
  - "dataSourceOptions union extended with kind: \"dynamic\" + dynamicViewId + sourceTableId + parsed columnsJson"
  - "Third <optgroup label=\"Dynamic Views\"> rendered in BOTH CustomConfigPanel branch (line ~244-253) AND standard branch (line ~382-390) — hidden when dynamicViews is empty"
  - "dv:<id> discriminator prefix on the option value (mutual exclusion at picker level: schema.table / view_name / dv:<id> value spaces disjoint)"
  - "Dual-write on Apply: persists BOTH widget.config.tableId (= source_table_id) AND widget.config.dynamicViewId — drill-down + filter-bar code paths (which key on tableId) keep working unchanged (research correction #3 lock)"
  - "Column-pickers source flip: allColumns derives from selectedSource.columnsJson when kind=\"dynamic\", from selectedTable.columns otherwise"
  - "dvColumnsMissing disabled state + inline hint \"Run Preview in Dynamic Views to populate columns\" when columns_json is null"
  - "Map widget guard (usesDataSource !== false) preserved unchanged (Pitfall 8 lock from 35-RESEARCH)"
affects: [35-05-renderer-status-gates, 35-06-map-renderer-and-layer-picker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-select discriminator-prefix pattern for <select> value space: schema.table | view_name | dv:<id>. Avoids name-space collisions across three source kinds without runtime kind-tag tracking on the value itself."
    - "Server JSON-string columns_json parsed once in the dataSourceOptions builder (try/catch defensive — malformed JSON treated as null). Downstream consumers receive a typed array."
    - "Dual-write source-of-truth pattern: widget.config carries BOTH dynamicViewId (renderer-primary) AND tableId (legacy-compat) so existing code paths keep working without rewrites. Mutual exclusion enforced at the picker layer, not at the schema."
    - "Per-test mock re-binding via vi.mocked(...).mockImplementation rather than vi.spyOn re-invocation — avoids the useEffect([config, chartDef]) infinite-loop documented in the Phase 11-10 spec at lines 200-213."

key-files:
  created:
    - ".planning/phases/35-widget-binding-and-pipeline/deferred-items.md (Plan 35-05 in-progress tsc errors logged out-of-scope per SCOPE BOUNDARY rule)"
  modified:
    - "kinetica_bi/src/components/charts/ChartConfigPanel.tsx (+207 LOC; dynamicViews prop + builder extension + three-optgroup × 2 branches + handleTableChange dv branch + allColumns flip + dvColumnsMissing disabled state + hint + dual-write Apply onClick)"
    - "kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx (+294 LOC across 2 commits; 9 new Phase 35 describe-block tests)"
    - "kinetica_bi/src/components/DashboardsPage.tsx (1-line addition: dynamicViews={dynamicViews} on ChartConfigPanel mount in WidgetConfigModal — was previously destructured as _dynamicViews/unused; renamed to live binding)"

key-decisions:
  - "Option value discriminator-prefix \"dv:<id>\" chosen over a parallel kind field. Reasons: (1) single string in the <select> value space keeps DOM/React change-events trivial; (2) zero risk of value-space collision because table-fullnames and view-names never start with literal \"dv:\"; (3) handleTableChange can branch on value.startsWith(\"dv:\") without extra state lookup. Plan-locked verbatim — this matches research-finding #11 pattern."
  - "JSON.parse of dv.columns_json happens INSIDE the dataSourceOptions builder (not at server boundary or in a derived hook). Reason: localizes the wire-shape coercion to one site and keeps the option shape ParsedColumns[] typed. try/catch covers malformed wire-data (defensive — same disabled+hint UX as null)."
  - "Dual-write tableId + dynamicViewId on Apply (research correction #3 lock). Concrete reason: DashboardsPage.tsx drill-down dispatch + filter-bar (FilteringBadge / useFilterStore.filters[tableId]) all key on tableId. If we wrote only dynamicViewId for dv-bound widgets, drill-down would silently no-op and the filter bar would not surface dv-widget filters. Mutual exclusion is enforced at the picker layer (handleTableChange explicitly deletes dynamicViewId on plain-pick) so the schema invariant holds without renderer-side guard."
  - "Apply button (standard branch) onClick path explicitly `delete baseConfig.dynamicViewId` when not dv-bound. Spread of `draft` may carry a stale dynamicViewId from a prior selection (handleTableChange already cleans, but defensive deletion at the Apply boundary guarantees the saved payload's invariant)."
  - "Both branches (CustomConfigPanel + standard) get the third optgroup. Reason: the CustomConfigPanel branch is the map widget's path, BUT chartDef.usesDataSource !== false guard at line 220 suppresses the picker entirely for map (verified by Test 9). For NON-map custom panels (none today, but the registry supports them), the third optgroup must be available."
  - "DashboardContext is NOT used as the read-side conduit for dynamicViews in this plan — the WidgetConfigModal prop conduit (Plan 35-03) is used instead. Reason: ChartConfigPanel is mounted inside WidgetConfigModal which is mounted OUTSIDE DashboardContextProvider in DashboardsPage. Threading via prop is the only viable path. Plan 35-05 will use the context's dynamicViews for renderer orphan detection — a different conduit for a different consumer."

patterns-established:
  - "Pattern 1: discriminator-prefix on single-select option values for disjoint source-kind unions. dv:<id> here; the same shape can be reused if a future kind (e.g., dynamic-table) is added — prefix it qt:<id> or similar."
  - "Pattern 2: server-JSON-string columns parsed once at the option-builder boundary, typed array passed to consumers. Avoids per-consumer JSON.parse and centralizes the malformed-wire-data fallback."
  - "Pattern 3: stable mock chartDef object hoisted to module scope + vi.mocked().mockImplementation re-bind in nested tests. Prevents the useEffect([config, chartDef]) infinite loop in vitest. Carry-forward for any future ChartConfigPanel test additions."

requirements-completed: [DV-V16-12]

# Metrics
duration: 37min
completed: 2026-05-15
---

# Phase 35 Plan 04: ChartConfigPanel Three-Optgroup Picker Summary

**Three-optgroup Data Source picker (Tables / Views / Dynamic Views) in ChartConfigPanel with dv:<id> discriminator-prefix selection, dual-write tableId + dynamicViewId on Apply, columns_json-sourced column pickers with disabled+hint state when columns_json is null, and Map widget guard preservation (Pitfall 8 lock).**

## Performance

- **Duration:** 37 min
- **Started:** 2026-05-15T17:11:54Z
- **Completed:** 2026-05-15T17:49:47Z
- **Tasks:** 2 (TDD: 3 atomic commits — 1 test RED + 1 feat GREEN + 1 test expansion)
- **Files modified:** 3 source files (ChartConfigPanel.tsx + ChartConfigPanel.spec.tsx + DashboardsPage.tsx) + 1 deferred-items.md
- **Tests added:** 9 new ChartConfigPanel.spec.tsx cases (7 → 16 total)
- **Full frontend suite after change:** 961/961 pass (44 test files); tsc clean

## Accomplishments

- **Three-optgroup picker** rendered in BOTH the CustomConfigPanel branch (CustomConfigPanel scaffold, lines ~244-253) AND the standard branch (lines ~382-390). Each optgroup hidden when its array is empty (Tables/Views/Dynamic Views).
- **Dual-write on Apply** locked-in: `expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ tableId: 42, dynamicViewId: 7 }) }))` (Test 4 spec assertion verifies the research-correction-#3 invariant).
- **Mutual exclusion at picker level** (Test 5): selecting `public.weather` after dv:7 → `saved.config` lacks `dynamicViewId` AND `tableId === 99` (TABLE_B.id).
- **Column-picker source flip** (Test 6): when dv:7 selected (`columns_json` has `vendor_id` + `avg_fare`), metric picker lists `avg_fare`, group-by picker lists both — source-table columns (lat/lon) are NOT present.
- **Disabled + inline hint** (Test 7): selecting dv:8 (columns_json=null) disables Metric/Group-By/Aggregation and renders "Run Preview in Dynamic Views to populate columns".
- **Existing config load** (Test 8): pre-mounted `widget.config = { dynamicViewId: 7, tableId: 42, table: ... }` shows `dv:7` as the active select value.
- **Map widget exclusion** (Test 9): `chartDef.usesDataSource === false` → entire Data Source section (and thus the Dynamic Views optgroup) absent (Pitfall 8 lock preserved).
- **WidgetConfigModal prop pass-through:** `dynamicViews={dynamicViews}` forwarded to ChartConfigPanel (was `_dynamicViews: _dynamicViews` — placeholder from Plan 35-03's conduit setup).

## Task Commits

Each task was committed atomically following the TDD red → green pattern:

1. **Task 1 RED: failing tests for optgroup render + dual-write** — `67f22a1` (test)
2. **Task 1 GREEN: three-optgroup picker + dual-write + columns_json source flip + WidgetConfigModal pass-through** — `c2e795e` (feat)
3. **Task 2: expand spec to full 9-case Phase 35 picker coverage** — `1f67898` (test)

## Files Created/Modified

**Modified:**
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — Props extended with `dynamicViews?: DynamicViewRow[]`; `dataSourceOptions` union extended with `kind: "dynamic"` + parsed `columnsJson`; both JSX picker sites (CustomConfigPanel branch + standard branch) gain the third optgroup with `dynamicViews.length > 0` conditional; `handleTableChange` detects `dv:<id>` prefix and dual-writes/resets; `allColumns` flips source to `selectedSource.columnsJson`; `dvColumnsMissing` flag disables Metric/Aggregation/Group-By/Drill-Down + renders inline hint; Apply onClick dual-writes `tableId` (= sourceTableId) + `dynamicViewId`; CustomConfigPanel onChange path also dual-writes; Map widget guard (`usesDataSource !== false` at line 220) preserved unchanged.
- `kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` — New `describe("ChartConfigPanel — Phase 35 dynamic-view picker (DV-V16-12)")` block with 9 `it()` cases covering optgroup render, hide-when-empty, three-optgroup co-existence, dual-write Save, mutual exclusion, columns_json column-source flip, disabled+hint when columns_json null, existing-config load, map exclusion. Hoisted `BAR_DEF` + `MAP_DEF_NO_DS_PHASE35` stable chartDef references; `vi.mocked(registry.getChartType).mockImplementation` re-bind pattern (NOT `vi.spyOn` re-invocation) to avoid `useEffect([config, chartDef])` loop.
- `kinetica_bi/src/components/DashboardsPage.tsx` — One-line live-binding rename: `dynamicViews: _dynamicViews` → `dynamicViews` in the WidgetConfigModal destructure + new `dynamicViews={dynamicViews}` prop on the inner `<ChartConfigPanel>` mount.

**Created:**
- `.planning/phases/35-widget-binding-and-pipeline/deferred-items.md` — Logged Plan 35-05's in-progress RED-state tsc errors (WidgetRenderer.spec.tsx + DashboardContext.spec.tsx + InfoCardRenderer.spec.tsx all reference `retryDynamicView` not yet on DashboardContextValue at the time of Plan 35-04 commit). Per SCOPE BOUNDARY rule, NOT fixed here — Plan 35-05 GREEN ships the fix.

## Decisions Made

(See key-decisions in frontmatter — all 6 captured there. Highest-impact summary:)

1. **`dv:<id>` discriminator prefix on option value** — single string keeps event handling trivial, zero collision risk, branch on `value.startsWith("dv:")`.
2. **JSON.parse columns_json at builder boundary** — single coercion site, malformed wire-data treated as null with same disabled+hint UX.
3. **Dual-write tableId + dynamicViewId on Apply** — research correction #3 lock; drill-down + filter-bar continue to read tableId without rewrites.
4. **Defensive `delete baseConfig.dynamicViewId` in Apply path** — guards against stale dynamicViewId from prior selection in the spread.
5. **Both CustomConfigPanel and standard branches get the optgroup** — future-proofs for non-map custom panels even though map's guard suppresses today.
6. **Prop conduit (NOT context) for ChartConfigPanel** — modal is mounted OUTSIDE DashboardContextProvider; prop is the only viable channel.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stable-mock pattern required to prevent useEffect infinite-loop in Test 9**
- **Found during:** Task 2 spec expansion (first run hung indefinitely; multiple vitest worker zombies)
- **Issue:** Test 9 initially used `vi.spyOn(registry, "getChartType").mockImplementation(...)` inside the `it()` block, creating a SECOND spy returning a NEW ChartTypeDefinition object on each call. ChartConfigPanel's `useEffect([config, chartDef])` triggered an infinite re-render loop (identical to the pattern documented at lines 200-213 of the same spec file for the Phase 11-10 tests).
- **Fix:** Hoisted `MAP_DEF_NO_DS_PHASE35` as a stable module-scope reference; switched Test 9 to `vi.mocked(registry.getChartType).mockImplementation(...)` which re-binds the SAME spy installed in `beforeEach` rather than creating a new one.
- **Files modified:** `kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` (Test 9 + hoisted constant)
- **Verification:** Full 16/16 spec passes; no hangs; 961/961 full-suite pass.
- **Committed in:** `1f67898` (Task 2 commit, fix integrated before commit)

**2. [Rule 1 - Bug] Query selector collision: multiple comboboxes after dv selection**
- **Found during:** Task 2 spec expansion (Tests 5 + 8 first-pass failed with "Found multiple elements with the role 'combobox'")
- **Issue:** After selecting a dv with non-null columns_json, the standard branch renders Metric Column + Aggregation + Group By selects in addition to the Data Source picker. Tests 5 and 8 called `screen.getByRole("combobox")` which raises on multi-match.
- **Fix:** Switched both tests to `screen.getAllByRole("combobox")[0]` — the Data Source picker is always the first combobox in the panel (rendered before any other selects).
- **Files modified:** `kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` (Tests 5 + 8 only)
- **Verification:** Both tests pass; assertion semantics unchanged (still verifies the Data Source select's `.value` and `fireEvent.change` propagation).
- **Committed in:** `1f67898` (Task 2 commit, fix integrated before commit)

**3. [Rule 3 - Blocking] Pre-existing dirty index swept unrelated files into Task 1 GREEN commit**
- **Found during:** Task 1 GREEN commit (`git show --stat HEAD` revealed 4 files instead of expected 2)
- **Issue:** `MapChartRenderer.tsx` + `global.css` were ALREADY in the git index from prior concurrent work (Plan 35-06's working-tree state). `git commit` includes the entire staged index, so my 2 deliberately-staged files (`ChartConfigPanel.tsx` + `DashboardsPage.tsx`) were committed alongside Plan 35-06's WIP.
- **Fix:** `git reset --soft HEAD~1` (preserved working tree); `git reset HEAD <unrelated files>` to unstage them; re-committed with only the 2 in-scope files. Final commit `c2e795e` is clean (2 files, 226+/40- LOC).
- **Files modified:** None additional — corrective commit operation only.
- **Verification:** `git show --stat HEAD` post-fix lists only ChartConfigPanel.tsx + DashboardsPage.tsx.
- **Committed in:** `c2e795e` (replaces the abandoned 5fcafc0; clean Task 1 GREEN)

---

**Total deviations:** 3 auto-fixed (1 blocking infrastructure, 1 bug, 1 blocking commit hygiene)
**Impact on plan:** All three are mechanical fixes; none affected the locked picker contract or the dual-write semantics. No scope creep, no architectural drift.

## Issues Encountered

- **Vitest worker zombies after Task 2 first-run hang:** The Test 9 infinite-loop spawned dozens of `vitest/dist/workers/forks.js` processes (visible in `ps aux`); each was actively burning CPU after my command's auto-background timeout. Resolved by `pkill -9 -f vitest`; subsequent runs clean.

- **`getChartType` mock churn pattern:** This is the third documented occurrence (Phase 11-10 + Phase 23-03 + now Plan 35-04) of the same vitest pitfall: returning a NEW object reference from a `getChartType` mock causes ChartConfigPanel's `useEffect([config, chartDef])` to loop. The hoisted-stable-reference pattern is now reinforced across three spec sites. Future ChartConfigPanel spec authors should use `vi.mocked().mockImplementation` re-bind (not `vi.spyOn` re-invocation) when a single test needs a different chartDef.

- **Concurrent in-progress Plan 35-05 changes in working tree:** During Plan 35-04 execution, Plan 35-05 had uncommitted in-tree mods to DashboardContext.tsx + spec files (RED state). At one point my tsc check failed with `retryDynamicView` not on `DashboardContextValue`; subsequent runs were clean as Plan 35-05's GREEN ships landed. Did not affect my plan's correctness; logged to deferred-items.md per scope-boundary rule.

## User Setup Required

None — pure-frontend UI extension. No env vars, no schema changes, no external service config.

## Self-Check: PASSED

Verified post-write:
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` modified — contains `kind: "dynamic"`, `dv:${`, `dynamicViewId`, `columnsJson`, `Run Preview in Dynamic Views`, `usesDataSource !== false`. Confirmed via grep gates above.
- `kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` extended — 16 `it()` blocks (was 7); contains `Phase 35 dynamic-view picker`, `dynamicViewId`, `Run Preview in Dynamic Views`, `columns_json: null`.
- `kinetica_bi/src/components/DashboardsPage.tsx` modified — contains `dynamicViews={dynamicViews}` and `dynamicViews` appears 11 times in the file.
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` optgroup count: 6 (≥ 4 minimum).
- Commits `67f22a1` (test RED), `c2e795e` (feat GREEN), `1f67898` (test expand) all in `git log --oneline -5`.
- `npx vitest run`: 961/961 pass across 44 test files (no regressions).
- `npx tsc --noEmit`: zero errors.
- No `"warning"` toast-kind reference in ChartConfigPanel.tsx.

## Next Plan Readiness

- **Plan 35-05 (renderer-status-gates)** is the direct downstream consumer. Will read `widget.config.dynamicViewId` from this plan's writes; can use the dual-write pattern locked here (tableId stays = sourceTableId, dynamicViewId is primary for FROM-swap) without renderer-side guards on `tableId` presence.
- **Plan 35-06 (map-renderer-and-layer-picker)** uses an analogous three-optgroup picker inside `KineticaWmsLayerForm` for per-layer binding. The discriminator-prefix pattern (`dv:<id>`) + dual-write semantics (`dynamic_view_id` SQLite column + per-layer mutual exclusion) are different conduits but the same UX pattern.
- **No blockers** for downstream plans. ChartConfigPanel's contract is stable; the locked dual-write invariant `tableId === sourceTableId when dynamicViewId set` is the foundation Plan 35-05's renderer can rely on without defensive reads.

---
*Phase: 35-widget-binding-and-pipeline*
*Completed: 2026-05-15*
