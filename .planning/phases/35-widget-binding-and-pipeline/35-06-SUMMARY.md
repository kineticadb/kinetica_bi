---
phase: 35-widget-binding-and-pipeline
plan: 06
subsystem: ui
tags: [map, openlayers, dynamic-views, layers-modal, picker, tdd, vitest, dvv16-13, dvv16-14]

# Dependency graph
requires:
  - phase: 35-01-layers-schema-migration
    provides: "DashboardLayerDto.dynamic_view_id + PATCH route 'key' in attrs discriminant + table_id NOT NULL preserved"
  - phase: 35-02-buildwmsparams-precedence
    provides: "4-arg buildWmsParams 4-case precedence + DynamicViewEntryInput type + null-on-non-materialized contract"
  - phase: 35-03-orchestrator-hook
    provides: "dynamicViews prop conduit through LayersModal (Wave 2 ship)"
  - phase: 33-dynamic-view-store
    provides: "useDynamicViewStore (views[id], dynamicViewVersion) + .getState() snapshot pattern"
provides:
  - "MapChartRenderer.tsx: dynamicViewsKey primitive selector (Pitfall 7 lock) + per-layer dvEntry/dvVersion imperative getState() snapshot + 4-arg buildWmsParams call site (Effects 2 + 3)"
  - "Layer-skip semantics: null wmsParams return → omit from visible OL stack; Effect 2 also removes a previously-materialized layer when status flips to non-materialized mid-session"
  - "'Some layers over threshold' overlay (.map-over-threshold-overlay) surfaces when at least one dv-bound layer is non-materialized"
  - "KineticaWmsLayerForm Data Source picker section: three-optgroup pattern (Tables / Dynamic Views) with mutual-exclusion at picker level (dv:<id> vs raw table-id value-space)"
  - "LayersModal: legacy standalone TABLE select REMOVED (subsumed by KineticaWmsLayerForm's unified picker); dynamicViews prop forwarded to inner form; handleDataSourceChange delegates table picks to handleTableChange (autoSuggest + clear stale columns) and dv picks to a passthrough patch"
  - "DV-V16-13 (per-layer dv binding for MapChart) + DV-V16-14 (over-threshold UX for MapChart) closed"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Primitive-string selector for cross-store dep-array stability (mirrors viewsKey at MapChartRenderer.tsx:411-417; Pitfall 7 lock for dynamic-view consumers)"
    - "Per-layer dvEntry/dvVersion imperative .getState() snapshot inside effect bodies (matches existing filter-view per-layer pattern; PITFALL C-02 carry-forward)"
    - "Layer-skip via null wmsParams return: caller checks `wmsParams === null` and continues; if a previously-materialized layer flips non-materialized, Effect 2 also removes the prior OL ImageLayer to keep the stack clean"
    - "Functional setState reconciliation for derived overlay state (`setHasOverThresholdLayers((prev) => prev === next ? prev : next)`) avoids spurious re-renders when count stays positive across re-fires"
    - "Optional Data Source picker rendering in KineticaWmsLayerForm: picker JSX is gated on `layer` + `onDataSourceChange` props so MapConfigPanel (legacy embed without per-layer DTO) continues to mount cleanly"
    - "dv:<id> value-space discriminator in picker (mirrors Plan 35-04 ChartConfigPanel pattern): mutual-exclusion enforced at single-select level; raw table-id strings and 'dv:N' strings are disjoint value-spaces"

key-files:
  created: []
  modified:
    - "kinetica_bi/src/components/charts/MapChartRenderer.tsx (dynamicViewsKey selector + dvEntry/dvVersion lookups in Effects 2+3 + null-skip + overlay state + JSX overlay)"
    - "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (8 new Phase 35 tests + new dynamicViewStore vi.mock)"
    - "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (4 new props + Data Source picker section at top of config-panel-body)"
    - "kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx (7 new Phase 35 tests covering optgroup render/hide/select/orphan-fallback/back-compat)"
    - "kinetica_bi/src/components/LayersModal.tsx (legacy TABLE select removed; handleDataSourceChange added; dynamicViews + handleDataSourceChange threaded to inner form)"
    - "kinetica_bi/src/components/LayersModal.spec.tsx (2 new Phase 35 pass-through tests + 3 existing tests updated for new 'Layer data source' label)"
    - "kinetica_bi/src/styles/global.css (.map-over-threshold-overlay namespace — top-right corner, warning-yellow, pointer-events disabled)"

key-decisions:
  - "REPLACED the legacy standalone TABLE picker in LayersModal with a unified Data Source picker rendered INSIDE KineticaWmsLayerForm — single-select enforces mutual exclusion at the UI level. This avoids dual-picker UX confusion ('table picker' vs 'data source picker') and matches the plan's locked recommendation."
  - "Data Source picker section in KineticaWmsLayerForm is OPTIONAL — only renders when both `layer` and `onDataSourceChange` props are supplied. MapConfigPanel (legacy embed without per-layer DTO) keeps mounting cleanly. The existing 'no table picker' spec test (Test 7 at KineticaWmsLayerForm.spec.tsx:303) still passes because it doesn't supply `layer`."
  - "table_id stays = dv.source_table_id when binding a layer to a dynamic-view (research finding #4 lock) — the schema's NOT NULL constraint is preserved without migration, drill-down dispatch + filter-bar code paths (which key on tableId) keep working unchanged, and `buildWmsParams` 4-case precedence routes the actual WMS LAYERS-swap to the dv at render time."
  - "Effect 2's layer-add branch is now PRECEDED by the wmsParams null-check; if a previously-added layer's dv flips to non-materialized mid-session, Effect 2's loop removes the stale OL ImageLayer + unsubscribes its listeners (mirrors the existing REMOVE path for layers no longer in `desired`). Stack stays clean — no orphan tile loads, no broken WMS URLs fire."
  - "Functional setState for hasOverThresholdLayers (`setHasOverThresholdLayers((prev) => prev === next ? prev : next)`) — same identity check pattern as the existing opacity / zIndex update gates in Effect 2 (UPDATE step at lines 978-993). Avoids re-renders when count goes 1 → 2 (boolean stays true)."
  - "Doc comment in `dynamicViewsKey` selector originally said 'markPending → setView' which violated the Test 16-E pure-consumer lock spec (`expect(src).not.toMatch(/setView\\b/)`). Replaced with 'markPending → store-write' to keep the grep gate trivial without losing the semantic context."
  - "LayersModal.handleTableChange now ALSO emits `dynamic_view_id: null` alongside table_id — mutual-exclusion at the patch level. The 'key' in attrs discriminant (Plan 35-01) ensures the explicit null clears any prior dv binding server-side."

patterns-established:
  - "Pitfall 7 pattern (per-store primitive selector mirror): the existing v1.3 viewsKey pattern is now templated for the dynamic-view store via dynamicViewsKey. Future v1.x cross-store consumers should mirror this template for any new per-id store dep-array trigger."
  - "Optional-picker-rendering pattern: a per-component Data Source picker that only renders when the caller supplies the layer DTO + handler. Other forms (e.g., MapConfigPanel) can embed the component WITHOUT picker JSX. Reduces prop pollution while keeping the picker logic colocated with the form."
  - "Replace, don't duplicate: when a UX surface is being upgraded with a richer picker (Tables + Dynamic Views), remove the legacy standalone picker to avoid dual-control confusion. Existing test labels are auto-fixed (Rule 1) to track the renamed accessor."

requirements-completed: [DV-V16-13, DV-V16-14]

# Metrics
duration: 41min
completed: 2026-05-15
---

# Phase 35 Plan 06: Map Renderer + Layer Picker Summary

**Map widget completes its dynamic-view binding at both render-time (MapChartRenderer per-layer dv lookup + dynamicViewsKey selector + 4-arg buildWmsParams + layer-skip + over-threshold overlay) and config-time (KineticaWmsLayerForm three-optgroup Data Source picker + LayersModal pass-through + mutual-exclusion at picker level).**

## Performance

- **Duration:** 41 min
- **Started:** 2026-05-15T17:16:02Z
- **Completed:** 2026-05-15T17:57:12Z
- **Tasks:** 3 (3 atomic commits: 1 feat + 1 test + 1 feat)
- **Files modified:** 7 (no files created)
- **Tests added:** 17 new cases (8 MapChartRenderer + 7 KineticaWmsLayerForm + 2 LayersModal)
- **Full frontend suite after change:** 961/961 pass across 44 test files

## Accomplishments

- **MapChartRenderer per-layer dv binding wired:**
  - `dynamicViewsKey` primitive selector mirrors the existing `viewsKey` (sorted-by-id, viewName+status segments per dv-bound layer; Pitfall 7 lock verbatim).
  - Effects 2 + 3 dep arrays both include `dynamicViewsKey` so LAYERS-swap re-fires on dv store changes (pending → materialized hand-off).
  - Per-layer `dvEntry` + `dvVersion` imperative `useDynamicViewStore.getState()` snapshot inside Effect 2 + Effect 3 bodies (matches existing filter-view per-layer pattern).
  - Both effects now call the 4-arg `buildWmsParams` (Plan 35-02 contract); null return = dv-bound + non-materialized → layer omitted.
  - Effect 2's null-skip branch ALSO removes a previously-materialized OL ImageLayer if status flipped mid-session (stack stays clean; no orphan tile loads).
  - `overThresholdCount` counted per effect fire; functional setState reconciles `hasOverThresholdLayers` boolean.

- **"Some layers over threshold" overlay surfaces** when at least one dv-bound layer is non-materialized. CSS `.map-over-threshold-overlay` namespace added (top-right corner, low-key warning-yellow, pointer-events disabled). Silent visual; no toast (per locked status-aware-rendering taxonomy).

- **KineticaWmsLayerForm Data Source picker** added at top of `config-panel-body`:
  - 4 new optional props (`layer`, `associatedTables`, `dynamicViews`, `onDataSourceChange`) — picker only renders when both `layer` and `onDataSourceChange` are supplied (back-compat for MapConfigPanel embed).
  - Single `<select>` with `aria-label="Layer data source"`; two optgroups: `Tables` (always rendered if associatedTables non-empty) + `Dynamic Views` (hidden when dynamicViews prop is empty).
  - Option value-space: plain table id `"10"` vs prefixed dv id `"dv:7"` — mutual-exclusion at picker level (mirrors Plan 35-04 ChartConfigPanel discriminator).
  - dv pick → `onDataSourceChange({ dynamic_view_id: dvId, table_id: dv.source_table_id })` — research finding #4 lock preserved.
  - Plain-table pick → `onDataSourceChange({ dynamic_view_id: null, table_id: <picked> })` — explicit null clears any prior dv binding via Plan 35-01's "key" in attrs discriminant.
  - Orphan defense: `layer.dynamic_view_id` referring to a missing dv → picker falls back to the table-id-bound option as currently selected.

- **LayersModal: legacy standalone TABLE select REMOVED** (subsumed by KineticaWmsLayerForm's unified picker). New `handleDataSourceChange` callback delegates table picks to the existing `handleTableChange` (autoSuggest + clear stale columns + null dv) and dv picks to a passthrough patch. `dynamicViews` prop now forwarded all the way down to the inner form.

- **17 new spec tests** + 3 updated existing tests; **961/961 total tests pass** across 44 test files.

## Task Commits

Each task committed atomically:

1. **Task 1: MapChartRenderer + global.css** — `bf08c63` (feat) — dynamicViewsKey selector, dv lookups in Effect 2+3, layer-skip, overlay, CSS namespace.
2. **Task 2: MapChartRenderer.spec.tsx** — `f10f2e8` (test) — 8 new tests covering materialized / pending / over_threshold / error / mixed / state-transition / version-bump.
3. **Task 3: KineticaWmsLayerForm + LayersModal + specs** — `d39a2c1` (feat) — Data Source picker section, prop pass-through, label updates, 9 new + 3 updated tests.

## Files Created/Modified

**Modified:**

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Import `useDynamicViewStore`; add `dynamicViewsKey` selector (mirrors `viewsKey`); add `hasOverThresholdLayers` state; Effect 2 — per-layer dvEntry/dvVersion lookup, 4-arg `buildWmsParams`, null-skip with stale-layer removal, `overThresholdCount` reconciliation; Effect 3 — same lookup + 4-arg call + null-skip; JSX — `Some layers over threshold` overlay div; dep arrays — `dynamicViewsKey` added.
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Add `_dynamicViewState` shared mock state; add `vi.mock` for `useDynamicViewStore`; append new `describe("Phase 35 per-layer dynamic-view binding (DV-V16-13/14)")` block with 8 tests.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Import `DashboardLayerDto`, `DynamicViewRow`, `TableDto` types; add 4 optional props; add `renderDataSourcePicker()` helper rendering the three-optgroup `<select>`; mount the picker at top of `config-panel-body`.
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — Append new `describe("Phase 35 Data Source picker (DV-V16-13)")` block with 7 tests.
- `kinetica_bi/src/components/LayersModal.tsx` — Remove legacy standalone TABLE `<select>`; add `handleDataSourceChange` callback (delegates table picks to `handleTableChange`); extend `handleTableChange` to emit `dynamic_view_id: null` (mutual exclusion); thread `layer` + `associatedTables` + `dynamicViews` + `handleDataSourceChange` to `KineticaWmsLayerForm`.
- `kinetica_bi/src/components/LayersModal.spec.tsx` — Update 3 existing tests (4, 8, 12) for new `Layer data source` label; append 2 new Phase 35 tests (forwarding + dv-pick payload).
- `kinetica_bi/src/styles/global.css` — Add `.map-over-threshold-overlay` namespace (top-right corner, low-key warning-yellow, pointer-events disabled, `::before` ⚠ glyph).

## Decisions Made

- **Replace, don't duplicate: legacy LayersModal TABLE picker REMOVED.** Plan recommended replacing rather than adding the Data Source picker alongside the existing TABLE select — locked because dual-picker UX is confusing ('table picker' vs 'data source picker') and the unified Data Source picker handles BOTH table + dv binding in a single control with mutual exclusion enforced at the UI level.
- **Data Source picker rendering is OPTIONAL in KineticaWmsLayerForm.** Only renders when both `layer` and `onDataSourceChange` props are supplied. MapConfigPanel (legacy embed without per-layer DTO) keeps mounting cleanly. The existing Test 7 (`does NOT render a table picker`) still passes because it doesn't supply `layer`.
- **table_id stays NOT NULL = dv.source_table_id when dv-bound.** Research finding #4 lock preserved verbatim — schema NOT NULL constraint satisfied without migration; drill-down dispatch + filter-bar code paths (which key on `tableId`) keep working unchanged; `buildWmsParams` 4-case precedence routes the actual WMS LAYERS-swap to the dv at render time.
- **Effect 2 null-skip ALSO removes a previously-materialized OL ImageLayer** if status flips mid-session (e.g., user changes filters → dv re-materialize → over-threshold). Without this, stale tiles would keep rendering on the map after the orchestrator hook reports over_threshold. The same listener-cleanup + layer-remove path used for the standard REMOVE loop is reused here for parity.
- **Functional setState for `hasOverThresholdLayers`** with explicit identity check (`prev === next ? prev : next`) — avoids re-renders when the boolean stays true across multiple effect re-fires (e.g., count goes 1 → 2 → 1 but stays positive throughout). Mirrors the existing opacity / zIndex update gates in Effect 2's UPDATE step.
- **Doc-comment hygiene around the Test 16-E pure-consumer lock.** Initial draft of the `dynamicViewsKey` selector comment said `markPending → setView` which violated `expect(src).not.toMatch(/setView\b/)`. Renamed to `markPending → store-write` — same semantic context, grep gate stays trivial.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 16-E doc-comment trigger ("setView" in dynamicViewsKey description)**

- **Found during:** Task 1 GREEN — first run of MapChartRenderer.spec.tsx after adding the selector.
- **Issue:** Test 16-E asserts `expect(src).not.toMatch(/setView\b/)` to lock the v1.3 pure-consumer invariant (VSTORE-V13-02 / MAP-V13-05). My initial doc comment said "markPending → setView" which made the assertion fail.
- **Fix:** Rewrote the doc comment to use "markPending → store-write" — preserves semantic context, satisfies the grep gate.
- **Files modified:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx`
- **Verification:** MapChartRenderer.spec.tsx → 127/127 (pre-existing) + 8 new = 135/135 pass.
- **Committed in:** `bf08c63` (Task 1)

**2. [Rule 1 - Bug] LayersModal existing tests referenced removed "Layer table" picker**

- **Found during:** Task 3 GREEN — first run of LayersModal.spec.tsx after removing the legacy TABLE select.
- **Issue:** Tests 4, 8, 12 used `screen.getByLabelText("Layer table")` to assert the table picker mounted. Removing the standalone TABLE select per the plan's "replace, don't duplicate" decision means that label no longer exists; the unified Data Source picker has `aria-label="Layer data source"` instead.
- **Fix:** Updated each test's `getByLabelText` call to use the new label, and Test 12's assertion to also check the new `dynamic_view_id: null` field in the patch (mutual-exclusion lock). Test descriptions also updated to mention "Data Source picker" instead of "table dropdown".
- **Files modified:** `kinetica_bi/src/components/LayersModal.spec.tsx`
- **Verification:** LayersModal.spec.tsx → 18/18 (was 16) pass, including the 2 new Phase 35 tests.
- **Committed in:** `d39a2c1` (Task 3)

**3. [Rule 2 - Critical functionality] LayersModal.handleTableChange wasn't clearing dynamic_view_id**

- **Found during:** Task 3 implementation — designing the Data Source picker callback.
- **Issue:** The legacy handleTableChange emitted `{ table_id, config }` but didn't touch `dynamic_view_id`. After Plan 35-01 added the column, a layer that was dv-bound and then re-table-picked would keep its dynamic_view_id non-null — server-side the layer would still render via the dv path (buildWmsParams 4-case precedence), which is wrong UX for a "I picked a plain table" operator action.
- **Fix:** Extended handleTableChange to emit `{ table_id, dynamic_view_id: null, config }` — mutual exclusion at the patch level via Plan 35-01's "key" in attrs discriminant.
- **Files modified:** `kinetica_bi/src/components/LayersModal.tsx`
- **Verification:** Updated Test 12 asserts `patch.dynamic_view_id === null` after picking a new table. Pass.
- **Committed in:** `d39a2c1` (Task 3)

---

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 2). All trivial cascade fixes that pre-existing tests/state revealed once the new code was wired in. No scope creep, no architectural decisions, no behavioral surprises for Wave 3 consumers.

## Issues Encountered

- **Parallel-execution collision with Plan 35-04 agent.** While I was implementing Task 1, the Plan 35-04 agent (running in parallel for Wave 3) created a commit `5fcafc0` whose stat shows it touched `MapChartRenderer.tsx` (+136 lines) and `global.css` (+28 lines) — exactly the files and line counts of MY in-progress changes. The commit message refers ONLY to ChartConfigPanel + DashboardsPage. This appears to be an accidental wide-stage on the 35-04 agent's part. The amended commit at HEAD (`c2e795e`) correctly drops MapChartRenderer + global.css from its scope, but the brief collision means my Task 1 commit `bf08c63` shows up AFTER the 35-04 commit in the linear history. No code-level conflicts arose because the diff I introduced was unique and got correctly attributed to my Task 1 commit; this is purely a git-author-attribution oddity worth noting in case the verifier examines the timeline.
- **No auth gates.** Pure frontend work — no server changes, no env vars, no external service interactions.
- **One unrelated WidgetRenderer.spec act() warning** surfaced during the full suite run, but all 961 tests still pass. Pre-existing behavior in `AggregatedWidgetRenderer` (not touched by this plan); Plan 35-05 may address it separately.

## User Setup Required

None — pure-frontend implementation. No env vars, no migrations, no external service. The new "Some layers over threshold" overlay appears automatically when an operator opens a dashboard whose dv-bound layers haven't yet materialized; the Data Source picker appears automatically in the existing Layers Modal when at least one dynamic-view exists for the dashboard.

## Self-Check: PASSED

All 7 claimed files exist on disk; all 3 claimed commits (`bf08c63`, `f10f2e8`, `d39a2c1`) found in `git log --all`.

All grep acceptance criteria gates pass:

- MapChartRenderer.tsx — `dynamicViewsKey` (8 occurrences), `useDynamicViewStore.getState` (4), `wmsParams === null` (2), `Some layers over threshold` (4), `layer.dynamic_view_id` (6), `viewName ?? rawTableRef` (0 — antipattern absent).
- global.css — `map-over-threshold-overlay` (2 occurrences).
- MapChartRenderer.spec.tsx — `Phase 35 per-layer dynamic-view binding` (2), `dynamic_view_id: 7` (7), `Some layers over threshold` (8).
- KineticaWmsLayerForm.tsx — `Dynamic Views` (3), `dynamic_view_id` (8), `dynamic_view_id: null` (1), `dv.source_table_id` (2).
- LayersModal.tsx — `dynamicViews` (5).
- KineticaWmsLayerForm.spec.tsx — `Phase 35 Data Source picker` (2).

Full frontend suite: 961/961 pass across 44 test files; tsc clean.

## Next Plan Readiness

- **Phase 35 closes** — Plan 35-06 is the last plan in Wave 3 alongside 35-04 (ChartConfigPanel picker, GREEN at `c2e795e`) and 35-05 (AggregatedRenderer + RecordsTable status gates, RED at `7d62056` pending GREEN). When 35-05 completes, Phase 35 (DV-V16-12, DV-V16-13, DV-V16-14) is fully shipped.
- **Phase 36 (VERIFY-V16-01)** can attest map-widget per-layer dv binding end-to-end via UAT: open dashboard with a dv → create a layer bound to the dv via the new Data Source picker → toggle filters to trigger over-threshold cascade → verify the "Some layers over threshold" overlay appears and the layer disappears from the visible stack → narrow filter → verify the layer reappears with LAYERS=<dvViewName> on next materialize.

---
*Phase: 35-widget-binding-and-pipeline*
*Completed: 2026-05-15*
