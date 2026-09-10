---
plan: 36-01
auditor: gsd-executor (source-only)
audit_date: 2026-05-18
scope: "v1.6 Dynamic Views Phases 32-35 — code-review attestation against ROADMAP success criteria"
inherits_precedent_from: ["v1.4 Phase 24 pragmatic-close", "v1.5 Phase 31 source-only"]
---

# 36-01 Source Audit Notes — v1.6 Dynamic Views

Per-phase, per-criterion PASS / FAIL / DEFERRED matrix with file:line evidence. Produced by 36-01 source-only audit; consumed by 36-03 to compile 36-VERIFICATION.md.

All criterion text below is copied verbatim from `.planning/ROADMAP.md` Phase 32-35 "Success Criteria" blocks (Phase 36 success criterion 3 will be authored by 36-03 itself).

## Phase 32 — dynamic-view-foundation

- criterion_id: 32.1
  text: "New `dashboard_dynamic_views` table exists with columns `id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json, created_at, updated_at`. Idempotent PRAGMA-guarded migration mirrors the v1.4 Phase 19 pattern."
  status: PASS
  evidence: "kinetica_bi/server/src/db.ts:113 CREATE TABLE IF NOT EXISTS dashboard_dynamic_views with all 9 required columns (id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json, created_at, updated_at); db.ts:136-141 PRAGMA table_info-guarded ALTER TABLE pattern for sessions migration mirrors v1.4 Phase 19; db.ts:161-166 same PRAGMA pattern for dashboard_layers. kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts asserts idempotency."
  rationale: "All 9 schema columns present in CREATE TABLE; PRAGMA-guarded pattern confirmed at db.ts lines 136-141 and 161-166."

- criterion_id: 32.2
  text: "Pure module `kinetica_bi/server/src/lib/dynamicViewSql.ts` exports `substituteViewToken(template, viewName)` — replaces `{view}` (case-insensitive, whitespace-tolerant) with the supplied identifier; throws if `{view}` is absent (configuration error)."
  status: PASS
  evidence: "kinetica_bi/server/src/lib/dynamicViewSql.ts:27 export function substituteViewToken(template: string, viewName: string). kinetica_bi/server/src/index.ts:85 import { substituteViewToken, MissingViewTokenError }; index.ts:896-898 validation call substituteViewToken with _dummy_validation_view_name_; index.ts:1113-1121 MissingViewTokenError catch → 400 response. kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts present for case-insensitivity + missing-token error cases."
  rationale: "Function exported at dynamicViewSql.ts:27; throws MissingViewTokenError on absent {view} per index.ts:1118-1120 catch block."

- criterion_id: 32.3
  text: "`POST /api/dynamic-view/preview` accepts `{ template_sql, source_view_name, sample_limit }`. Runs `SELECT * FROM ({template_sql_substituted}) LIMIT N` against Kinetica; returns `{ rows, columns }` for the operator's discovery flow. Does NOT create a permanent view."
  status: PASS
  evidence: "kinetica_bi/server/src/index.ts:1054-1162 POST /api/dynamic-view/preview handler. index.ts:1124 builds previewSql = 'SELECT * FROM ({substituted}) LIMIT {sampleLimit}'; index.ts:1158 returns { rows, columns }. index.ts:1054 comment: 'one-shot read; does NOT create a permanent view'. Note: actual request body uses source_table_id + dashboard_id rather than source_view_name (endpoint resolves filter-view name internally)."
  rationale: "Route registered at index.ts:1056; SELECT * FROM wrap + LIMIT confirmed at line 1124; { rows, columns } response at line 1160; no persistent view created."

- criterion_id: 32.4
  text: "`POST /api/dynamic-view/materialize` accepts `{ dynamic_view_id }`. Looks up the row, computes the source filter-view name (via existing `buildFilterViewName`), runs a `SELECT COUNT(*) FROM <source_view>` row-count check, then either: (a) below threshold → `CREATE OR REPLACE MATERIALIZED VIEW <dynamic_view_name> AS (<substituted_sql>) USING TABLE PROPERTIES (TTL = 5)`; or (b) at/above threshold → `DROP TABLE IF EXISTS <dynamic_view_name>` and return `{ status: 'over_threshold' }`. Re-uses the TM/SMc:1078 race-recovery retry from Phase 30."
  status: PASS
  evidence: "kinetica_bi/server/src/index.ts:1164-1266 POST /api/dynamic-view/materialize. index.ts:1182-1186 buildDynamicViewName call; index.ts:1187-1192 buildFilterViewName call; index.ts:1200-1203 SELECT COUNT(*) FROM {expectedFilterViewName}; index.ts:1206-1212 no_filter short-circuit DROP + over_threshold; index.ts:1227-1233 rowCount >= max_records → DROP + over_threshold; index.ts:1249-1256 createOrReplaceMaterialized (Phase 30 retry helper, TTL=5). kinetica_bi/server/src/lib/materializedView.ts:31 createOrReplaceMaterialized owns TM/SMc:1078 race-recovery."
  rationale: "Full threshold-gate logic confirmed at lines 1200-1256; TM/SMc:1078 retry delegated to materializedView.ts:31 as documented at index.ts:1013."

- criterion_id: 32.5
  text: "`DELETE /api/dynamic-view/:id` drops the materialized view + deletes the row."
  status: PASS
  evidence: "kinetica_bi/server/src/index.ts:1309-1340 DELETE /api/dynamic-view/:id handler; index.ts:1323-1327 buildDynamicViewName then DROP TABLE IF EXISTS via kineticaSqlHelper; index.ts:1331 db.prepare DELETE FROM dashboard_dynamic_views. kinetica_bi/server/src/db.ts:642 DELETE FROM dashboard_dynamic_views row-removal helper."
  rationale: "DELETE handler at index.ts:1311 drops Kinetica view + removes SQLite row atomically."

- criterion_id: 32.6
  text: "Supertest coverage in both `AUTH_MODE=password` and `AUTH_MODE=oidc` blocks: preview path (column extraction), materialize-below-threshold (200 + viewName), materialize-over-threshold (200 + `over_threshold` status + DROP fired), bare unsubstituted-token (400), 501 / WKB-style errors propagated cleanly."
  status: PASS
  evidence: "kinetica_bi/server/tests/routes.dynamic-view.spec.ts:207 describe('POST /api/dynamic-view/preview — AUTH_MODE=password'); lines 481-660 materialize block with below-threshold + over-threshold cases; lines 661-732 DELETE block; lines 733-820 AUTH_MODE=oidc smoke block (preview+materialize+delete happy paths). routes.dynamic-view-crud.spec.ts:132 GET AUTH_MODE=password; lines 431+ PUT block. routes.dynamic-view-drop.spec.ts:173 POST /api/dynamic-view/:id/drop AUTH_MODE=password; lines 285-315 AUTH_MODE=oidc smoke. Plan 36-02 confirms suite-green."
  rationale: "Source-presence audit only — Plan 36-02 owns the actual test execution gate. Both AUTH_MODE blocks confirmed present across all three spec files."

## Phase 33 — dynamic-view-store

- criterion_id: 33.1
  text: "`useDynamicViewStore` Zustand slice: `{ views: Record<number, DynamicViewEntry>, dynamicViewVersion: number, setView, markPending, setError, clearView, reset }` — five mutating actions plus version counter. `dynamicViewVersion` increments monotonically on every state-changing action; `reset()` hard-sets to `{ views: {}, dynamicViewVersion: 0 }`."
  status: PASS
  evidence: "kinetica_bi/src/store/dynamicViewStore.ts:61-76 interface with views, dynamicViewVersion, setView, markPending, setError, clearView, reset. dynamicViewStore.ts:99 setView +1; line 117 markPending +1; line 133 setError +1; line 147 clearView(existing) +1; line 154 reset() hard-sets {views:{}, dynamicViewVersion:0}. dynamicViewStore.ts:26-32 JSDoc locked semantics. kinetica_bi/src/store/dynamicViewStore.spec.ts:173-185 five-mutation test asserts dynamicViewVersion===5; lines 190-201 reset-to-0 test."
  rationale: "All five actions present with version-monotonicity and reset semantics confirmed in both source and spec."

- criterion_id: 33.2
  text: "Client helpers in `kinetica_bi/src/api/client.ts`: `listDynamicViews`, `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView` — each threads an optional `AbortSignal`."
  status: PASS
  evidence: "kinetica_bi/src/api/client.ts:883 listDynamicViews(dashboardId, signal?); line 909 createDynamicView(dashboardId, body, signal?); line 938 updateDynamicView(id, ...signal?); line 960 deleteDynamicView(id, signal?); line 982 previewDynamicView({...}, signal?); line 999 materializeDynamicView(id, signal?); line 1023 dropDynamicView(id). All seven helpers present. client.ts:838-839 comment confirms AbortSignal threading convention per V13-P-10 lock."
  rationale: "All seven helpers confirmed at their export lines; AbortSignal threading confirmed via function signatures."

- criterion_id: 33.3
  text: "`reset()` wired as the 6th call in the lifecycle reset block at `App.tsx` UNAUTHORIZED handler and at `DashboardsPage.tsx` `DashboardOpen` unmount — in both locations a fire-and-forget DROP loop for `status === 'materialized'` entries precedes the `reset()` call."
  status: PASS
  evidence: "kinetica_bi/src/App.tsx:80 (1st) useFilterViewStore.reset(); line 81 (2nd) useFilterStore.reset(); line 85 (3rd) useInfoSelectionStore.reset(); line 89 (4th) useLastInfoClickContextStore.reset(); line 93 (5th) useSpatialFilterStore.reset(); lines 99-106 DROP loop + (6th) useDynamicViewStore.getState().reset(). App.tsx:94-98 comment 'Phase 33 DV-V16-07 (6th store)'. kinetica_bi/src/components/DashboardsPage.tsx:419-444 DashboardOpen cleanup: same 5+1 pattern (lines 419-431 stores 1-5, lines 437-444 DV DROP loop + useDynamicViewStore.getState().reset())."
  rationale: "Sixth-call position confirmed in both App.tsx (line 106) and DashboardsPage.tsx (line 444) with matching DROP loop pattern."

- criterion_id: 33.4
  text: "Vitest coverage for `useDynamicViewStore`: empty-state initial shape, error-state write, version-monotonicity (5 mutations = version 5), reset-zeros (version hard-sets to 0 after mutations)."
  status: PASS
  evidence: "kinetica_bi/src/store/dynamicViewStore.spec.ts:18-28 describe 'initial state' — empty views + version 0; lines 114-149 setError tests including error-state write; lines 173-185 'five mutations produce dynamicViewVersion === 5' version-monotonicity test; lines 189-201 reset describe — 'hard-sets state to { views: {}, dynamicViewVersion: 0 } — NOT an increment'."
  rationale: "All four coverage axes confirmed in spec; file exists at kinetica_bi/src/store/dynamicViewStore.spec.ts."

## Phase 34 — dynamic-view-ui

- criterion_id: 34.1
  text: "New "Dynamic Views" button on dashboard action bar, placed between Map Layers and Back; opens a modal listing all dynamic views for the current dashboard with create (+ New), edit (row click), and delete (trash + confirm) affordances."
  status: PASS
  evidence: "kinetica_bi/src/components/DashboardsPage.tsx:741-747 action bar ordering: line 741 Map Layers button, line 744 'Dynamic Views' button (onClick setShowDynamicViewsModal(true)), line 747 Back button. DashboardsPage.tsx:377 useState showDynamicViewsModal; lines 1009-1013 DynamicViewsModal mount conditional. kinetica_bi/src/components/DynamicViewsModal.tsx:119 describe block confirms modal shell renders list, + New button, row-click selection, and trash+confirm delete."
  rationale: "Button at DashboardsPage.tsx:744 placed between Map Layers (741) and Back (747); modal wired at lines 1009-1013."

- criterion_id: 34.2
  text: "Create / Edit dialog form includes: name (text input), source-table picker (associated tables only), CodeMirror SQL editor with `{view}` token hint, Insert `{view}` button (cursor-position insert), max-records numeric input (min 1, integer), Preview button, Save button."
  status: PASS
  evidence: "kinetica_bi/src/components/DynamicViewsModal.tsx:43-45 imports CodeMirror + @uiw/react-codemirror + @codemirror/lang-sql; line 815 '{/* CodeMirror editor + Insert {view} button + hint */}'; line 820 'Insert {\"{\"}view{\"}\"}'; lines 326-331 Insert {view} handler dispatches CM6 change at cursor pos. DynamicViewsModal.tsx:302-309 clampMaxRecords function (min 1 clamp); lines 302-306 'Must be at least 1'. DashboardsPage.tsx:33 import DynamicViewsModal. kinetica_bi/package.json contains @codemirror/lang-sql and @uiw/react-codemirror."
  rationale: "CodeMirror import at DynamicViewsModal.tsx:43-44; Insert {view} button at line 820; max_records min-1 clamp at lines 303-306; Preview + Save buttons present in file."

- criterion_id: 34.3
  text: "Preview button calls `POST /api/dynamic-view/preview` with the current template SQL and dashboard/source context; result renders in a side panel with `rows` + `columns`; on Save, `columns_json` is persisted following the BLOCKER #1 carry rule: send IFF `templateChanged && previewRanSinceLastSave && formColumnsJson !== null`."
  status: PASS
  evidence: "kinetica_bi/src/components/DynamicViewsModal.tsx:48-49 imports previewDynamicView; lines 118-120 previewRanSinceLastSave state; line 364 setPreviewRanSinceLastSave(true) on Preview success only. Save handler lines 423-458 post-VERIFY auto-Preview block: templateChanged + !previewRanSinceLastSave check; lines 499-498 CREATE columnsJsonForSave guard; lines 502-536 UPDATE templateChanged && columnsJsonForSave guard. Server-side columns_json at index.ts:602 INSERT + 629 UPDATE."
  rationale: "BLOCKER #1 carry rule implemented at DynamicViewsModal.tsx:423-536; previewRanSinceLastSave flag gated at line 364."

- criterion_id: 34.4
  text: "Save persists the dynamic view row to SQLite and immediately triggers re-materialization via the Phase 35 pipeline; Delete fires `DELETE /api/dynamic-view/:id`, removes the store entry, and drops the materialized Kinetica view."
  status: PASS
  evidence: "kinetica_bi/src/components/DynamicViewsModal.tsx:574 markPending(row.id, viewName) immediately after save; lines 576-615 materializeDynamicView call with setView/setError on result; lines 584-615 toast handling. Delete at lines 242-263: deleteDynamicView(id, signal) → useDynamicViewStore.getState().clearView(id) → list filter; server DELETE handler at kinetica_bi/server/src/index.ts:1309-1340 drops Kinetica view + removes SQLite row."
  rationale: "Save → markPending → materializeDynamicView chain at DynamicViewsModal.tsx:574-615; Delete → deleteDynamicView → clearView at lines 247-249."

## Phase 35 — widget-binding-and-pipeline

- criterion_id: 35.1
  text: "ChartConfigPanel `Data Source` picker shows existing dashboard dynamic views as a new optgroup alongside Tables and Views (when `usesDataSource: true`); selecting a dynamic view writes `dynamicViewId` into `widget.config` alongside the existing `tableId` field."
  status: PASS
  evidence: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx:30-31 JSDoc '...third optgroup \"Dynamic Views\"'; line 102 dynamicViewId in option type; lines 122-159 dynamic views optgroup construction with dv.id, dv.name, dv.columns_json; line 150 value: 'dv:{dv.id}'. Lines 206-240 onChange handler: lines 223 dynamicViewId: dvId dual-write; line 231 plain-table branch delete next.dynamicViewId (mutual exclusion). DashboardsPage.tsx:1069 dynamicViews? prop threaded to WidgetFormWrapper."
  rationale: "Optgroup construction confirmed at ChartConfigPanel.tsx:122-159; dual-write dynamicViewId at line 223; mutual exclusion at line 240."

- criterion_id: 35.2
  text: "AggregatedWidgetRenderer, RecordsTableRenderer, and MapChartRenderer each look up `dynamicViewId` from `widget.config`, resolve the live Kinetica view name from `useDynamicViewStore`, and use the resolved view name in the FROM clause (or WMS layer source) instead of the source table."
  status: PASS
  evidence: "kinetica_bi/src/components/charts/WidgetRenderer.tsx:256 const dynamicViewId = cfg.dynamicViewId; lines 301-303 scoped selector dvEntry = useDynamicViewStore(s => s.views[dynamicViewId]); lines 438-439 viewName source flips to useDynamicViewStore.views[dynamicViewId]?.viewName. WidgetRenderer.tsx:1461 RecordsTableRenderer recordsDvStatus over_threshold gate. kinetica_bi/src/components/charts/MapChartRenderer.tsx:974-996 per-layer dvEntry lookup + buildWmsParams dv viewName arg; lines 1388-1391 queryViewName = dvEntry.viewName for map queries."
  rationale: "All three renderers confirmed: AggregatedWidgetRenderer and RecordsTableRenderer in WidgetRenderer.tsx; MapChartRenderer in MapChartRenderer.tsx."

- criterion_id: 35.3
  text: "When the source filter view re-materializes (v1.3 + v1.5 trigger fires), the dynamic view re-materializes too; the pipeline order is: filter-view CREATE → row-count → dv CREATE/DROP → widget FROM-swap re-fires; AbortController serializes per-dynamic-view."
  status: PASS
  evidence: "kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts:11-21 file header documents cold-start gate (matVer > 0), per-dv AbortController Map, and dynamicViewVersion subscription. Line 57 dynamicViewVersion = useDynamicViewStore(s => s.dynamicViewVersion); line 86 matVersionKey = useFilterViewStore(s => ...) for re-materialize trigger. Lines 92-93 cascadeControllersRef = useRef<Map<number, AbortController>>(new Map()); lines 174-192 per-dv abort-old + new AbortController on each cascade fire."
  rationale: "useDynamicViewMaterializeChain.ts houses cold-start gate, per-id AbortController Map, and filter-view matVer subscription confirming pipeline order."

- criterion_id: 35.4
  text: "When a widget's dynamic view has status `over_threshold`, the widget renders the copy "Too much data — narrow your filters to enable this view." and no SQL is executed; for maps the overlay "Some layers over threshold" appears and layer-WMS calls for over-threshold layers are skipped."
  status: PASS
  evidence: "kinetica_bi/src/components/charts/WidgetRenderer.tsx:467 'if (dvStatus === \"over_threshold\") return;' (AggregatedWidgetRenderer Effect 2 short-circuit); lines 638-643 over-threshold JSX: 'Too much data — narrow your filters to enable this view.'; line 1461 RecordsTableRenderer 'if (recordsDvStatus === \"over_threshold\") return;'; line 1616 RecordsTableRenderer over-threshold render. kinetica_bi/src/components/charts/MapChartRenderer.tsx:1905 overlay JSX 'Some layers over threshold'; lines 924-925 layer-skip comment for non-materialized dv layers."
  rationale: "Exact copy 'Too much data — narrow your filters to enable this view.' confirmed at WidgetRenderer.tsx:642; 'Some layers over threshold' at MapChartRenderer.tsx:1905."

## End-to-End Scenarios (ROADMAP Phase 36 success criterion 1)

- scenario_id: e2e.1
  text: "create → preview → save → applies filter → dynamic view materializes → widget renders filtered data"
  status: DEFERRED
  evidence: "DynamicViewsModal.tsx:574 Save handler calls markPending → materializeDynamicView → setView/setError with toast. WidgetRenderer.tsx:256-303 Effect 2 detects materialized dvEntry and uses dvEntry.viewName in FROM clause. useDynamicViewMaterializeChain.ts:86 subscribes to filterViewStore matVer for re-materialize-on-filter-change trigger."
  rationale: "Individual code paths confirmed source-only; end-to-end operator click-through with live Kinetica deferred per v1.5 Phase 31 source-only attestation precedent."

- scenario_id: e2e.2
  text: "raise filter threshold → dynamic view drops → widget shows over-threshold empty state"
  status: DEFERRED
  evidence: "kinetica_bi/server/src/index.ts:1227-1233 materialize endpoint: rowCount >= max_records → DROP TABLE + return over_threshold. useDynamicViewMaterializeChain.ts cascade re-fires on matVer bump → calls materializeDynamicView → receives over_threshold → setView with status over_threshold. WidgetRenderer.tsx:638-643 renders 'Too much data' copy."
  rationale: "Server threshold gate and client empty-state confirmed source-only; live threshold-raise flow deferred per v1.4 Phase 24 pragmatic-close precedent."

- scenario_id: e2e.3
  text: "clear filters → dynamic view drops"
  status: DEFERRED
  evidence: "kinetica_bi/server/src/index.ts:1206-1212 materialize endpoint no_filter short-circuit: isTableNotFoundError (filter view TTL'd / never materialized) → DROP TABLE IF EXISTS dynamicViewName + return {status: 'over_threshold', reason: 'no_filter'}. useDynamicViewMaterializeChain.ts matVer subscription re-fires on filter-clear matVer bump."
  rationale: "no_filter code path confirmed source-only at index.ts:1206-1212; live filter-clear operator scenario deferred per v1.5 Phase 31 source-only attestation precedent."

- scenario_id: e2e.4
  text: "lifecycle reset on logout → all materialized dynamic views drop"
  status: PASS
  evidence: "kinetica_bi/src/App.tsx:94-106 UNAUTHORIZED handler: comment 'Phase 33 DV-V16-07 (6th store)'; lines 99-105 for-loop over views checking status === 'materialized' + dropDynamicView(dvId).catch(()=>{}); line 106 useDynamicViewStore.getState().reset(). Server DELETE handler at kinetica_bi/server/src/index.ts:1309-1340 (drop path) + POST /api/dynamic-view/:id/drop at index.ts:1282-1315."
  rationale: "Source-inspectable: the UNAUTHORIZED handler at App.tsx:99-106 explicitly iterates materialized views and calls dropDynamicView + reset; no live UAT required."

- scenario_id: e2e.5
  text: "lifecycle reset on dashboard switch → all materialized dynamic views drop"
  status: PASS
  evidence: "kinetica_bi/src/components/DashboardsPage.tsx:403-444 DashboardOpen cleanup (dashboard unmount / switch): lines 437-443 identical DROP loop (for materialized dvId → dropDynamicView(dvId).catch(()=>{})); line 444 useDynamicViewStore.getState().reset(). Pattern mirrors App.tsx UNAUTHORIZED block per Plan 33-03 spec."
  rationale: "Source-inspectable: DashboardsPage.tsx:437-444 explicitly mirrors App.tsx logout reset; no live UAT required."
