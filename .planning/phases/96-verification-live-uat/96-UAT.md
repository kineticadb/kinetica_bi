---
status: resolved
phase: 96-verification-live-uat
source: [88..95 milestone feature SUMMARYs; deferred live items from 93/93.5/94/95]
started: 2026-06-29T00:00:00Z
updated: 2026-06-29T00:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Default accept-all unchanged (v1.17 parity)
expected: No filter-scope configured anywhere → drilling filters all widgets on the table together; NO badge anywhere; one materialize POST per table per filter change.
result: issue
reported: "1 column filter → 2 materialize POSTs on the table (one legacy no-combinationKey view _sbd8c718b, one combination view _sbd8c718b_cd1c06e3b with identical WHERE) + 1 dv base materialize. Dashboard has a Records Table + a dv-backed widget. The records table fires its own legacy materialize; dv base materialize fired on filter click per user."
severity: major

### 2. Per-viz filter selection — chart widget
expected: Open a chart widget's config → "Filter Scope" section → enable "Customize" → uncheck one source widget from the allow-list. Save. That chart now ignores filters produced by the excluded source while a sibling chart (accept-all) still applies them — the two show different filtered data simultaneously on the same dashboard.
result: issue
reported: "Exclude-a-source mechanic works (functional pass), BUT enabling Customize starts with NOTHING checked → 'No sources selected — ignores all filters', which contradicts 'all filters applied by default'. User decision (2026-06-29): keep allow-list semantics but DEFAULT TO ALL-CHECKED when Customize is enabled (pre-check every current source incl. the spatial-draws sentinel), so the start state == accept-all and the user unchecks to exclude."
severity: minor

### 3. Chart filter-scope persists on reload
expected: After configuring a chart's filter scope (test 2), reload the page / reopen the dashboard. The chart's config panel re-opens with the same allow-list intact (persisted via widget.config).
result: pass

### 4. Per-layer filter scope — WMS map layer
expected: Open a map layer's form → "Filter Scope" section (per layer, not the map widget) → set an allow-list. Save + reload. A layer with an allow-list shows different map tiles than an all-filters layer on the same table; the config survives reload (layer.filter_scope persisted top-level).
result: pass
note: "User additionally requested a per-layer 'X of Y filters applied' indicator in the LayersLegendPanel (promotes deferred COMM-V2-02 into v1.18) — logged as a scope-addition gap."

### 5. Spatial draws in the combination model
expected: On a table shown on BOTH a chart and a map, draw a spatial shape. With default accept-all, both the chart and the map reflect the spatial filter (spatial is NOT dropped). A widget whose allow-list EXCLUDES the "Spatial draws (map)" source ignores the draw while an accept-all sibling honors it.
result: pass

### 6. dv-bound widget filter scope
expected: A dynamic-view-backed widget's config shows the Filter Scope section with a source list restricted to same-dv sibling widgets. Configuring it makes the dv-bound widget apply scope against the dv's filters (dvFilters), independent of base-table filters.
result: pass

### 7. DISABLE_DV_FILTER_SCOPE deploy flag
expected: With the server env var DISABLE_DV_FILTER_SCOPE=true (restart server), the "Filter Scope" section is HIDDEN for dv-bound widgets/layers only. Table-bound/chart filter-scope UI is unaffected. (With the var absent/unset, the dv UI is shown.)
result: issue
reported: "UI gating works (editor correctly hidden for dv-bound vizs when flag set; .env needed a clean restart since tsx watch doesn't reload on .env edits — that part is fine). BUT a previously-saved dv filter scope is STILL APPLIED to the data while the flag is on. User decision (2026-06-29): the flag must FULLY DISABLE — dv-bound vizs revert to accept-all (ignore saved filterSelection, no badge/indicator) when DISABLE_DV_FILTER_SCOPE=true."
severity: major

### 8. On-widget "N of M filters" badge
expected: A widget ignoring ≥1 active filter shows a badge reading e.g. "2 of 3 filters" in its header (accent-colored). A widget accepting all filters shows NO badge. Hovering the badge shows a breakdown of applied vs ignored filters, with "source excluded" noted for ignored ones.
result: pass

### 9. Combination dedup — shared view
expected: Two widgets configured with the SAME resolved filter set (same allow-list outcome) on the same table share ONE materialized combination view — a single materialize POST covers both (verify in the network tab: not one POST per widget for the same combination).
result: pass

### 10. Ceiling fallback
expected: When the number of unique combination-views for one table would exceed MAX_COMBINATION_VIEWS_PER_TABLE (set a low value like 2 via env to test easily), additional combinations fall back to the full all-filters view (data still correct, less customization) and a warning is surfaced (toast/console).
result: issue
reported: "With MAX_COMBINATION_VIEWS_PER_TABLE=2 + a filter applied (multiple distinct scopes on the table from prior tests), widgets are STUCK on the 'Filtering…' spinner indefinitely while the chart DATA rendered fine, and NO materialize request is in flight. The per-viz materializing state never clears for vizs affected by the ceiling remap."
severity: blocker

### 11. Cleanup on dashboard switch / logout
expected: Switch dashboards (or log out). Combination views for the previous dashboard are dropped (ref-count → 0 → DROP); no leaked/orphaned views accumulate. Returning to the dashboard re-materializes cleanly.
result: pass

## Summary

total: 11
passed: 7
issues: 4
pending: 0
skipped: 0
scope_additions: 1

## Resolution Log (gap closure — 96-01/02/03 + follow-up fixes)

Re-walk results (2026-06-29):
- ✅ Test 1 (records dedup + stuck "Filtering…") — RESOLVED. Records migrated into the combination model (96-01); the stuck badge root cause was deeper: FilteringBadge/MapFilteringBadge read the legacy filterViewStore which v1.18 no longer clears — migrated both to the combination store (commit 076c9e0).
- ✅ Test 2 (Customize defaults all-checked) — RESOLVED (96-02).
- ✅ Test 7 (dv full-disable + no spatial source for dv) — RESOLVED (96-01 data-path + 96-03 badge/legend + 96-02 spatial suppression).
- ✅ COMM-V118-02 (per-layer legend "X of Y filters") — RESOLVED (96-03).
- ✅ dv-base re-materialize — CONFIRMED not filter-triggered (diagnose-only; no fix).
- ✅ Self-filter option (UAT-surfaced refinement of FSCOPE-V118-01) — RESOLVED (commit 64fecbc). Customizing a widget's scope silently dropped its OWN drill clicks (self excluded from the list); now an explicit "This widget's own selections" row, default ON. Checked → applies own drill (v1.17 parity); unchecked → filter-control pattern (drills others, shows full data).
- ✅ Test 10 (ceiling) — the cap + fallback + warning WORK (confirmed via network: with cap=2 and 3 distinct combos, only the kept combo + fallback materialize; the over-ceiling widget's own combo is never created → it reads the all-filters fallback; the "exceed the limit (2)" toast fires). The original stuck-spinner was the badge-store bug (076c9e0). Operator confirmed the toast + 3 cumulative materialize POSTs (one stale intermediate).
- ✅ Fallback-badge refinement (UAT decision 2026-06-30) — fallen-back widgets now show "All filters (limit)" (commit 45dbd43). Operator CONFIRMED visually (Bar Chart 4 badge + tooltip "Combination limit reached — showing all 3 filters (configured scope: 1 of 3)").

## Final Automated Gate Result (VERIFY-V118-01 SC1) — 2026-06-30

- WEB: tsc clean; vitest 3000/3000 (130 files); theme-guard 132/132. ✅
- SERVER: tsc clean. Vitest run in a CLEAN env (dev .env set aside) → failures are ALL pre-existing/isolation, ZERO v1.18-introduced:
  - TD-V11-04 OIDC Issuer-mock set: auth.oidc, auth.routes, boot.wipe, bootstrap, oidc.module (documented pre-existing since v1.3, STATE.md line 1332).
  - db.smoke: schema-snapshot drift (pre-existing TD; cb_config/track_config + the v1.18 filter_scope column — the FILE was already failing pre-v1.18).
  - TD-V16-TEST-ISOLATION (pass alone, fail in full run): routes.dashboard-layers-patch (5/5 alone — the Phase-93 filter_scope PATCH spec), routes.info-query (28/28 alone).
  - routes.wms (2 tests): PRE-EXISTING — untouched since the v1.17 tag (git log v1.17..HEAD empty for the WMS route+spec); a fetchMock credential-test harness issue, NOT v1.18.
  - NOTE: with the DEV .env loaded, routes.filter-materialize / routes.dynamic-view / routes.filter-materialize-dv ALSO fail — but ONLY because .env sets DEFAULT_VIEW_TTL_MINUTES=3 (tests expect the code default 5); they PASS with the default restored. Environmental, not a regression.
  - All v1.18-specific server specs PASS: routes.filter-materialize-combo, layers (31/31 isolation), dashboard-layers-patch (alone), dynamic-view/filter-materialize (clean env).

VERIFY-V118-01: SATISFIED — green automated gates (to the repo's documented set-based bar) + blocking live operator walk-through PASS (all 4 gaps + 2 scope additions fixed in-session and re-walked).

Follow-up tech debt (NOT v1.18): routes.wms 2 credential-forwarding tests fail independent of v1.18 (pre-existing); consider a separate todo.

## Gaps

- truth: "Default accept-all renders byte-identical to v1.17 — one materialized view per table, shared by every widget on it (COMBO-V118-04 / COMBO-V118-01)."
  status: failed
  reason: "User reported: a single column filter produced TWO materialize POSTs for the same table — RecordsTableRenderer's legacy per-table view (no combinationKey, _kbi_filt..._t6_sbd8c718b) AND the orchestrator's combination view (_sbd8c718b_cd1c06e3b) with the IDENTICAL all-filters WHERE clause. v1.17 shared ONE view across records+charts; v1.18 default now creates two redundant views whenever a Records Table shares a table with a combo-model widget."
  severity: major
  test: 1
  root_cause: "RecordsTableRenderer (WidgetRenderer.tsx ~1849 dv-branch / ~1891 table-branch) was deliberately left on the legacy filterViewStore read+materialize path (scoped out in Phase 91; excluded from orchestrator enumeration via NON_TRIGGER_TYPES in Phase 93.5). It never joined the combination model, so it materializes its own per-table view instead of sharing the accept-all combination view."
  artifacts:
    - path: "packages/web/src/components/charts/WidgetRenderer.tsx"
      issue: "RecordsTableRenderer reads filterViewStore.views[tableId]/dvViews and runs its own materializeFilter trigger (no combinationKey) instead of reading filterCombinationStore"
    - path: "packages/web/src/hooks/useCombinationOrchestrator.ts"
      issue: "'records' is in NON_TRIGGER_TYPES, so the orchestrator does not enumerate records widgets into the combination registry"
  missing:
    - "Migrate RecordsTableRenderer (table + dv paths) to READ the combination store (effectiveViewName via vizToHash), mirroring AggregatedWidgetRenderer (Phase 91)"
    - "Remove RecordsTableRenderer's own materializeFilter/dropFilterView triggers (the legacy island)"
    - "Re-include 'records' in orchestrator enumeration (remove from NON_TRIGGER_TYPES) so records ref-counts + shares the accept-all combination view (records has no filter-scope config → always resolves to all filters → shares the chart combo view)"
    - "Re-walk Test 1: confirm ONE materialize POST per table when a records table + chart share a table under accept-all"
  debug_session: ""

- truth: "A base-table column filter does not re-materialize an unrelated dynamic view's base view."
  status: failed
  reason: "User observed the dv base materialize (dynamic_view_id:4 → _kbi_dv_uadmin_d7_4) fire on the column-filter click. Code review shows useDynamicViewMaterializeChain deps are [dashboardId, dynamicViewVersion] (not filterVersion), so this MAY be a page-load artifact rather than filter-triggered — CONFIRM during diagnosis whether it actually re-fires per base-table filter."
  severity: minor
  test: 1
  root_cause: ""
  artifacts:
    - path: "packages/web/src/hooks/useDynamicViewMaterializeChain.ts"
      issue: "Confirm whether the dv base materialize re-fires on base-table filterVersion changes (it should not)"
  missing:
    - "Diagnose: is the dv base materialize filter-triggered (bug) or a page-load/keep-alive artifact (benign)? Fix only if filter-triggered."
  debug_session: ""

- truth: "Enabling 'Customize' in the Filter Scope panel starts from the accept-all state (all sources applied), so the designer unchecks to exclude."
  status: failed
  reason: "User reported: enabling Customize starts with NOTHING checked ('No sources selected — ignores all filters'), contradicting 'all filters applied by default'. User chose to keep allow-list semantics but default to ALL-CHECKED on enable."
  severity: minor
  test: 2
  root_cause: "FilterSelectionPanel initializes allowedSourceWidgetIds to [] when Customize is toggled on (empty allow-list = ignore all)."
  artifacts:
    - path: "packages/web/src/components/charts/FilterSelectionPanel.tsx"
      issue: "Customize-on handler sets sourceMode 'allowlist' with an EMPTY allowedSourceWidgetIds"
  missing:
    - "On Customize-enable, pre-populate allowedSourceWidgetIds with ALL currently-listed source ids (every filter-producing source rendered in the panel + the SPATIAL_DRAWS_SENTINEL) so the start state equals accept-all"
    - "Keep the 'No sources selected — ignores all filters. Uncheck Customize to accept all.' warning for the manually-unchecked-everything case"
    - "Apply at BOTH config surfaces (chart ChartConfigPanel + layer KineticaWmsLayerForm); for dv-bound vizs pre-check the same-dv source set"
    - "Re-walk Test 2: enabling Customize shows all sources checked; unchecking one excludes that source"
  debug_session: ""

- truth: "Each WMS map layer surfaces an 'X of Y filters' indicator in the LayersLegendPanel when it is ignoring ≥1 active filter (promotes deferred COMM-V2-02 into v1.18)."
  status: failed
  reason: "User request (2026-06-29): the legend is the right place to show a per-layer applied-filters indicator — mirror the widget badge ('X of Y filters') on each layer row in the legend."
  severity: minor
  test: 4
  root_cause: "Not implemented — COMM-V2-02 was deferred; map/per-layer indicators were out of Phase-95 scope."
  artifacts:
    - path: "packages/web/src/components/charts/LayersLegendPanel.tsx"
      issue: "No per-layer filter-scope indicator"
  missing:
    - "Per layer row in LayersLegendPanel, compute the layer's applied/ignored summary (reuse computeFilterScopeSummary semantics: layer.filter_scope vs the layer's table active filters + spatial shapes; dv-bound layers use dvFilters, no spatial)"
    - "Show 'X of Y filters' only when the layer ignores ≥1 filter (mirror WidgetFilterBadge visibility); reuse theme tokens / the widget-filter-badge class; no invented classes"
    - "Re-walk: a layer with a scope shows 'X of Y filters' in the legend; an accept-all layer shows none"
  debug_session: ""

- truth: "DISABLE_DV_FILTER_SCOPE=true FULLY disables dv filter scope — dv-bound vizs revert to accept-all (saved scopes not applied), not just the editor hidden."
  status: failed
  reason: "User reported: with the flag on, the editor is correctly hidden BUT a previously-saved dv filter scope is still applied to the dv-bound widget's data. User chose full-disable semantics."
  severity: major
  test: 7
  root_cause: "Phase 94 implemented UI gating only. The orchestrator still reads dv-bound vizs' filterSelection and resolves/materializes their saved scope regardless of dvFilterScopeDisabled."
  artifacts:
    - path: "packages/web/src/hooks/useCombinationOrchestrator.ts"
      issue: "dv-bound viz resolution does not honor dvFilterScopeDisabled — applies saved filterSelection even when the deploy flag disables the feature"
  missing:
    - "When dvFilterScopeDisabled (read from auth store), the orchestrator treats dv-bound widgets/layers as ACCEPT-ALL (ignore saved filterSelection → resolve to all dvFilters), so they share the all-dv-filters combination view"
    - "dv-bound widget badge (useFilterScopeSummary) + legend indicator (COMM-V118-02) show NOTHING for dv vizs when the flag is set (accept-all)"
    - "Note: the orchestrator is client-side and reads the flag from the auth store; ensure the dep/selector wiring picks up dvFilterScopeDisabled"
    - "Re-walk Test 7: with flag on, a dv widget that previously had a scope now applies ALL dv filters (old scope neutralized) and shows no badge"
  debug_session: ""

- truth: "The 'Spatial draws (map)' source does NOT appear in a dv-bound viz's Filter Scope source list (dv + spatial is server-rejected / deferred)."
  status: failed
  reason: "User screenshot showed 'Spatial draws (map)' listed as a source for a dv-bound widget. dv+spatial is deferred (server 400), so the sentinel is inert/misleading for dv vizs."
  severity: minor
  test: 7
  root_cause: "FilterSelectionPanel always renders the SPATIAL_DRAWS_SENTINEL row in allowlist mode, including for dv-bound vizs where spatial cannot apply."
  artifacts:
    - path: "packages/web/src/components/charts/FilterSelectionPanel.tsx"
      issue: "Spatial-draws sentinel row rendered even for dv-bound vizs"
  missing:
    - "Suppress the 'Spatial draws (map)' source row when the viz is dv-bound (pass an isDvBound/allowSpatial flag from ChartConfigPanel + KineticaWmsLayerForm)"
    - "Re-walk: a dv-bound widget's Filter Scope source list shows only same-dv sibling widgets, NO spatial entry"
  debug_session: ""

- truth: "When the per-table combination ceiling is exceeded, over-ceiling vizs fall back to the all-filters view, render data, and DO NOT get stuck in a materializing/'Filtering…' state (COMBO-V118-03)."
  status: failed
  reason: "User reported (MAX_COMBINATION_VIEWS_PER_TABLE=2): on applying a filter with multiple distinct scopes on the table, widgets are stuck on the 'Filtering…' spinner forever while chart data rendered and NO materialize request is in flight. The per-viz materializing flag never clears for vizs affected by the ceiling remap."
  severity: blocker
  test: 10
  root_cause: "DIAGNOSE: in useCombinationOrchestrator STEP B (ceiling remap, ~lines 341-418), over-ceiling hashes are removed from hashMap/desired and their widgets remapped to fallbackHash via vizKeyToHash. A hash that a PRIOR tick already markMaterializing'd (registry entry materializing:true) can be dropped from `desired` so its setEntry(materializing:false) never fires for a viz still reading it; and/or the fallback/kept entry the viz is remapped to is left materializing:true with no in-flight POST (STEP D liveEntry `continue` at ~466-472 skips re-dispatch but nothing clears a stuck materializing flag). Net: a viz's bound hash stays materializing forever."
  artifacts:
    - path: "packages/web/src/hooks/useCombinationOrchestrator.ts"
      issue: "Ceiling remap (STEP B ~341-418) + dispatch (STEP D ~459-556) can leave a viz bound to a hash whose materializing flag never resolves (orphaned markMaterializing / no fallback POST fired)"
  missing:
    - "Ensure every hash a viz is bound to after ceiling remap has a registry entry that resolves materializing:false (fallback hash must be dispatched OR already-materialized; never left as a bare markMaterializing with no in-flight POST)"
    - "Clear/clean orphaned materializing entries for hashes removed from `desired` by the ceiling remap (so a stuck spinner can't persist)"
    - "Confirm the ceiling warning toast actually fires once per over-ceiling table"
    - "Add an orchestrator spec scenario: >ceiling distinct combinations on a table → over-ceiling vizs end NON-materializing, bound to the fallback view; no permanent materializing state"
    - "Re-walk Test 10: with ceiling=2 and 3+ scopes, over-ceiling widgets show data on the fallback view, NO stuck spinner, and the warning toast appears"
  debug_session: ""
