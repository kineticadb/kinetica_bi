---
phase: 36-verification
verified: 2026-05-18
verifier: gsd-executor + operator decision (live UAT skipped per v1.5 Phase 31 precedent)
status: failed
score: "3 ROADMAP Phase 36 success criteria + 18 per-phase criteria (32+33+34+35) — see Per-Phase Rollup"
gate_summary:
  frontend_vitest_exit: 0
  frontend_tsc_exit: 0
  server_vitest_password_exit: 1
  server_vitest_oidc_exit: 1
  server_tsc_exit: 0
inherits_precedent_from: ["v1.4 Phase 24 pragmatic-close", "v1.5 Phase 31 source-only"]
---

# Phase 36 Verification — v1.6 Dynamic Views

## Scope Caveat

**This verification is source-only with automated test-gate proof.** Live operator UAT is explicitly skipped per the v1.5 Phase 31 precedent — the operator has been exercising the v1.6 build interactively throughout the development cycle (post-VERIFY bug fixes have already landed under Phases 32-35 SUMMARY trails) and each surfaced gap has been closed inline.

Source-only attestation covers: code-review of must-haves against the implemented codebase + automated test-suite execution. Production-only behaviours (live Kinetica SQL against the v1.6 dynamic-view CREATE/DROP path under load, multi-tab session interaction, WMS tile invalidation timing on cascade re-materialize) are NOT live-exercised in this cycle. Any production-only bug surfaces in the gap-closure cycle (Phase 36.x) or in v1.7.

## Phase 36 — Success Criteria (verbatim from ROADMAP)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Operator (or source-only audit) confirms: create → preview → save → applies filter → dynamic view materializes → widget renders filtered data; raise filter threshold → dynamic view drops → widget shows over-threshold empty state; clear filters → dynamic view drops; lifecycle reset on logout / dashboard switch drops all materialized dynamic views. | DEFERRED | Source-only audit (Plan 36-01) confirms all five operator scenarios are implemented end-to-end. e2e.4 and e2e.5 (lifecycle reset) are PASS source-inspectable; e2e.1, e2e.2, e2e.3 are DEFERRED per v1.5 Phase 31 source-only attestation precedent. See "End-to-End Scenarios" rollup below. |
| 2 | Frontend vitest green; tsc clean; new server supertest coverage for Phase 32 endpoints green in both auth modes. | FAIL | Plan 36-02 test gate: frontend vitest exit=0 (1016 passed, 47 files); frontend tsc exit=0 (clean); server vitest AUTH_MODE=password exit=1 (566 passed / 46 failed — 7 Phase 32 specs all green 86/86; failures are pre-existing cross-mode isolation: oidc tests failing in password mode + 1 info-query timeout); server vitest AUTH_MODE=oidc exit=1 (507 passed / 105 failed — Phase 32 specs not in failure list; failures are password-mode tests running under oidc mode); server tsc exit=0 (clean). Full breakdown: `36-02-TEST-RESULTS.md`. <!-- SC2 FAIL: server vitest AUTH_MODE=password exit=1, AUTH_MODE=oidc exit=1 — pre-existing cross-mode isolation failures (oidc tests in password mode, password tests in oidc mode) + 1 routes.info-query timeout. Phase 32 specs are 86/86 green. --> |
| 3 | Verification document `36-VERIFICATION.md` produced with PASS / FAIL / DEFERRED per success criterion across all five v1.6 phases. | PASS | This document. See "Per-Phase Rollup" below. |

## Per-Phase Rollup

Transcribed verbatim from `.planning/phases/36-verification/36-01-AUDIT-NOTES.md`. Criterion text taken from ROADMAP.md Phases 32-35 "Success Criteria" blocks.

### Phase 32 — dynamic-view-foundation

| Criterion | Text | Status | Evidence |
|-----------|------|--------|----------|
| 32.1 | New `dashboard_dynamic_views` table exists with columns `id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json, created_at, updated_at`. Idempotent PRAGMA-guarded migration mirrors the v1.4 Phase 19 pattern. | PASS | kinetica_bi/server/src/db.ts:113 CREATE TABLE IF NOT EXISTS dashboard_dynamic_views with all 9 required columns; db.ts:136-141 PRAGMA table_info-guarded ALTER TABLE pattern for sessions migration mirrors v1.4 Phase 19; db.ts:161-166 same PRAGMA pattern for dashboard_layers. tests/db.dynamicViewsMigration.spec.ts asserts idempotency. |
| 32.2 | Pure module `kinetica_bi/server/src/lib/dynamicViewSql.ts` exports `substituteViewToken(template, viewName)` — replaces `{view}` (case-insensitive, whitespace-tolerant) with the supplied identifier; throws if `{view}` is absent (configuration error). | PASS | kinetica_bi/server/src/lib/dynamicViewSql.ts:27 export function substituteViewToken(template, viewName); index.ts:85 import { substituteViewToken, MissingViewTokenError }; index.ts:896-898 validation call; index.ts:1113-1121 MissingViewTokenError catch → 400 response. tests/lib.dynamicViewSql.spec.ts present for case-insensitivity + missing-token error cases. |
| 32.3 | `POST /api/dynamic-view/preview` accepts `{ template_sql, source_view_name, sample_limit }`. Runs `SELECT * FROM ({template_sql_substituted}) LIMIT N` against Kinetica; returns `{ rows, columns }` for the operator's discovery flow. Does NOT create a permanent view. | PASS | kinetica_bi/server/src/index.ts:1054-1162 POST /api/dynamic-view/preview handler; index.ts:1124 builds previewSql = 'SELECT * FROM ({substituted}) LIMIT {sampleLimit}'; index.ts:1158 returns { rows, columns }; index.ts:1054 comment: 'one-shot read; does NOT create a permanent view'. Actual request body uses source_table_id + dashboard_id (endpoint resolves filter-view name internally). |
| 32.4 | `POST /api/dynamic-view/materialize` accepts `{ dynamic_view_id }`. Looks up the row, computes the source filter-view name (via existing `buildFilterViewName`), runs a `SELECT COUNT(*) FROM <source_view>` row-count check, then either: (a) below threshold → `CREATE OR REPLACE MATERIALIZED VIEW`; or (b) at/above threshold → `DROP TABLE IF EXISTS <dynamic_view_name>` and return `{ status: 'over_threshold' }`. Re-uses the TM/SMc:1078 race-recovery retry from Phase 30. | PASS | kinetica_bi/server/src/index.ts:1164-1266 POST /api/dynamic-view/materialize; index.ts:1182-1186 buildDynamicViewName; index.ts:1187-1192 buildFilterViewName; index.ts:1200-1203 SELECT COUNT(*); index.ts:1206-1212 no_filter short-circuit DROP + over_threshold; index.ts:1227-1233 rowCount >= max_records → DROP + over_threshold; index.ts:1249-1256 createOrReplaceMaterialized (Phase 30 retry helper, TTL=5). lib/materializedView.ts:31 owns TM/SMc:1078 race-recovery. |
| 32.5 | `DELETE /api/dynamic-view/:id` drops the materialized view + deletes the row. | PASS | kinetica_bi/server/src/index.ts:1309-1340 DELETE /api/dynamic-view/:id handler; index.ts:1323-1327 buildDynamicViewName then DROP TABLE IF EXISTS via kineticaSqlHelper; index.ts:1331 db.prepare DELETE FROM dashboard_dynamic_views. kinetica_bi/server/src/db.ts:642 DELETE FROM dashboard_dynamic_views row-removal helper. |
| 32.6 | Supertest coverage in both `AUTH_MODE=password` and `AUTH_MODE=oidc` blocks: preview path (column extraction), materialize-below-threshold (200 + viewName), materialize-over-threshold (200 + `over_threshold` status + DROP fired), bare unsubstituted-token (400), 501 / WKB-style errors propagated cleanly. | PASS | tests/routes.dynamic-view.spec.ts:207 AUTH_MODE=password preview; lines 481-660 materialize block; lines 661-732 DELETE block; lines 733-820 AUTH_MODE=oidc smoke. routes.dynamic-view-crud.spec.ts:132 GET AUTH_MODE=password; lines 431+ PUT block. routes.dynamic-view-drop.spec.ts:173 POST /api/dynamic-view/:id/drop AUTH_MODE=password; lines 285-315 AUTH_MODE=oidc smoke. Plan 36-02 confirms Phase 32 specs 86/86 green. |

### Phase 33 — dynamic-view-store

| Criterion | Text | Status | Evidence |
|-----------|------|--------|----------|
| 33.1 | `useDynamicViewStore` Zustand slice: `{ views: Record<number, DynamicViewEntry>, dynamicViewVersion: number, setView, markPending, setError, clearView, reset }` — five mutating actions plus version counter. `dynamicViewVersion` increments monotonically on every state-changing action; `reset()` hard-sets to `{ views: {}, dynamicViewVersion: 0 }`. | PASS | kinetica_bi/src/store/dynamicViewStore.ts:61-76 interface with views, dynamicViewVersion, setView, markPending, setError, clearView, reset; dynamicViewStore.ts:99 setView +1; line 117 markPending +1; line 133 setError +1; line 147 clearView(existing) +1; line 154 reset() hard-sets {views:{}, dynamicViewVersion:0}. dynamicViewStore.spec.ts:173-185 five-mutation version===5 test; lines 190-201 reset-to-0 test. |
| 33.2 | Client helpers in `kinetica_bi/src/api/client.ts`: `listDynamicViews`, `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView` — each threads an optional `AbortSignal`. | PASS | kinetica_bi/src/api/client.ts:883 listDynamicViews(dashboardId, signal?); line 909 createDynamicView(dashboardId, body, signal?); line 938 updateDynamicView(id, ...signal?); line 960 deleteDynamicView(id, signal?); line 982 previewDynamicView({...}, signal?); line 999 materializeDynamicView(id, signal?); line 1023 dropDynamicView(id). All seven helpers present; AbortSignal threading confirmed. |
| 33.3 | `reset()` wired as the 6th call in the lifecycle reset block at `App.tsx` UNAUTHORIZED handler and at `DashboardsPage.tsx` `DashboardOpen` unmount — in both locations a fire-and-forget DROP loop for `status === 'materialized'` entries precedes the `reset()` call. | PASS | kinetica_bi/src/App.tsx:80-106 UNAUTHORIZED handler: lines 99-106 DROP loop + useDynamicViewStore.getState().reset() as 6th call. App.tsx:94-98 comment 'Phase 33 DV-V16-07 (6th store)'. kinetica_bi/src/components/DashboardsPage.tsx:419-444 DashboardOpen cleanup: same 5+1 pattern (lines 437-444 DV DROP loop + reset()). |
| 33.4 | Vitest coverage for `useDynamicViewStore`: empty-state initial shape, error-state write, version-monotonicity (5 mutations = version 5), reset-zeros (version hard-sets to 0 after mutations). | PASS | kinetica_bi/src/store/dynamicViewStore.spec.ts:18-28 initial state — empty views + version 0; lines 114-149 setError tests; lines 173-185 'five mutations produce dynamicViewVersion === 5'; lines 189-201 reset — 'hard-sets state to { views: {}, dynamicViewVersion: 0 } — NOT an increment'. |

### Phase 34 — dynamic-view-ui

| Criterion | Text | Status | Evidence |
|-----------|------|--------|----------|
| 34.1 | New "Dynamic Views" button on dashboard action bar, placed between Map Layers and Back; opens a modal listing all dynamic views for the current dashboard with create (+ New), edit (row click), and delete (trash + confirm) affordances. | PASS | kinetica_bi/src/components/DashboardsPage.tsx:741-747 action bar ordering: line 741 Map Layers button, line 744 'Dynamic Views' button (onClick setShowDynamicViewsModal(true)), line 747 Back button. DashboardsPage.tsx:377 useState showDynamicViewsModal; lines 1009-1013 DynamicViewsModal mount conditional. DynamicViewsModal.tsx:119 describe block confirms modal shell renders list, + New button, row-click selection, and trash+confirm delete. |
| 34.2 | Create / Edit dialog form includes: name (text input), source-table picker (associated tables only), CodeMirror SQL editor with `{view}` token hint, Insert `{view}` button (cursor-position insert), max-records numeric input (min 1, integer), Preview button, Save button. | PASS | kinetica_bi/src/components/DynamicViewsModal.tsx:43-45 imports CodeMirror + @uiw/react-codemirror + @codemirror/lang-sql; line 815 CodeMirror editor + Insert {view} button + hint; line 820 'Insert {"{"}"view{"}"}"'; lines 326-331 Insert {view} handler dispatches CM6 change at cursor pos. DynamicViewsModal.tsx:302-309 clampMaxRecords function (min 1 clamp). kinetica_bi/package.json contains @codemirror/lang-sql and @uiw/react-codemirror. |
| 34.3 | Preview button calls `POST /api/dynamic-view/preview` with the current template SQL and dashboard/source context; result renders in a side panel with `rows` + `columns`; on Save, `columns_json` is persisted following the BLOCKER #1 carry rule: send IFF `templateChanged && previewRanSinceLastSave && formColumnsJson !== null`. | PASS | kinetica_bi/src/components/DynamicViewsModal.tsx:48-49 imports previewDynamicView; lines 118-120 previewRanSinceLastSave state; line 364 setPreviewRanSinceLastSave(true) on Preview success only. Save handler lines 423-458 post-VERIFY auto-Preview block; lines 499-498 CREATE columnsJsonForSave guard; lines 502-536 UPDATE templateChanged && columnsJsonForSave guard. Server-side columns_json at index.ts:602 INSERT + 629 UPDATE. |
| 34.4 | Save persists the dynamic view row to SQLite and immediately triggers re-materialization via the Phase 35 pipeline; Delete fires `DELETE /api/dynamic-view/:id`, removes the store entry, and drops the materialized Kinetica view. | PASS | kinetica_bi/src/components/DynamicViewsModal.tsx:574 markPending(row.id, viewName) immediately after save; lines 576-615 materializeDynamicView call with setView/setError on result; lines 584-615 toast handling. Delete at lines 242-263: deleteDynamicView(id, signal) → useDynamicViewStore.getState().clearView(id) → list filter; server DELETE handler at kinetica_bi/server/src/index.ts:1309-1340 drops Kinetica view + removes SQLite row. |

### Phase 35 — widget-binding-and-pipeline

| Criterion | Text | Status | Evidence |
|-----------|------|--------|----------|
| 35.1 | ChartConfigPanel `Data Source` picker shows existing dashboard dynamic views as a new optgroup alongside Tables and Views (when `usesDataSource: true`); selecting a dynamic view writes `dynamicViewId` into `widget.config` alongside the existing `tableId` field. | PASS | kinetica_bi/src/components/charts/ChartConfigPanel.tsx:30-31 JSDoc '...third optgroup "Dynamic Views"'; line 102 dynamicViewId in option type; lines 122-159 dynamic views optgroup construction with dv.id, dv.name, dv.columns_json; line 150 value: 'dv:{dv.id}'. Lines 206-240 onChange handler: line 223 dynamicViewId: dvId dual-write; line 231 plain-table branch delete next.dynamicViewId (mutual exclusion). DashboardsPage.tsx:1069 dynamicViews? prop threaded to WidgetFormWrapper. |
| 35.2 | AggregatedWidgetRenderer, RecordsTableRenderer, and MapChartRenderer each look up `dynamicViewId` from `widget.config`, resolve the live Kinetica view name from `useDynamicViewStore`, and use the resolved view name in the FROM clause (or WMS layer source) instead of the source table. | PASS | kinetica_bi/src/components/charts/WidgetRenderer.tsx:256 const dynamicViewId = cfg.dynamicViewId; lines 301-303 scoped selector dvEntry = useDynamicViewStore(s => s.views[dynamicViewId]); lines 438-439 viewName source flips to useDynamicViewStore.views[dynamicViewId]?.viewName. WidgetRenderer.tsx:1461 RecordsTableRenderer recordsDvStatus over_threshold gate. MapChartRenderer.tsx:974-996 per-layer dvEntry lookup + buildWmsParams dv viewName arg; lines 1388-1391 queryViewName = dvEntry.viewName for map queries. |
| 35.3 | When the source filter view re-materializes (v1.3 + v1.5 trigger fires), the dynamic view re-materializes too; the pipeline order is: filter-view CREATE → row-count → dv CREATE/DROP → widget FROM-swap re-fires; AbortController serializes per-dynamic-view. | PASS | kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts:11-21 file header documents cold-start gate (matVer > 0), per-dv AbortController Map, and dynamicViewVersion subscription. Line 57 dynamicViewVersion = useDynamicViewStore(s => s.dynamicViewVersion); line 86 matVersionKey = useFilterViewStore(s => ...) for re-materialize trigger. Lines 92-93 cascadeControllersRef = useRef<Map<number, AbortController>>(new Map()); lines 174-192 per-dv abort-old + new AbortController on each cascade fire. |
| 35.4 | When a widget's dynamic view has status `over_threshold`, the widget renders the copy "Too much data — narrow your filters to enable this view." and no SQL is executed; for maps the overlay "Some layers over threshold" appears and layer-WMS calls for over-threshold layers are skipped. | PASS | kinetica_bi/src/components/charts/WidgetRenderer.tsx:467 'if (dvStatus === "over_threshold") return;' (AggregatedWidgetRenderer Effect 2 short-circuit); lines 638-643 over-threshold JSX: 'Too much data — narrow your filters to enable this view.'; line 1461 RecordsTableRenderer 'if (recordsDvStatus === "over_threshold") return;'; line 1616 RecordsTableRenderer over-threshold render. MapChartRenderer.tsx:1905 overlay JSX 'Some layers over threshold'; lines 924-925 layer-skip comment for non-materialized dv layers. |

## End-to-End Scenarios — ROADMAP Phase 36 Success Criterion 1 Detail

| # | Scenario | Status | Evidence |
|---|----------|--------|----------|
| e2e.1 | create → preview → save → applies filter → dynamic view materializes → widget renders filtered data | DEFERRED | DynamicViewsModal.tsx:574 Save handler calls markPending → materializeDynamicView → setView/setError with toast. WidgetRenderer.tsx:256-303 Effect 2 detects materialized dvEntry and uses dvEntry.viewName in FROM clause. useDynamicViewMaterializeChain.ts:86 subscribes to filterViewStore matVer for re-materialize-on-filter-change trigger. Individual code paths confirmed source-only; end-to-end click-through with live Kinetica deferred per v1.5 Phase 31 source-only attestation precedent. |
| e2e.2 | raise filter threshold → dynamic view drops → widget shows over-threshold empty state | DEFERRED | kinetica_bi/server/src/index.ts:1227-1233 materialize endpoint: rowCount >= max_records → DROP TABLE + return over_threshold. useDynamicViewMaterializeChain.ts cascade re-fires on matVer bump → calls materializeDynamicView → receives over_threshold → setView with status over_threshold. WidgetRenderer.tsx:638-643 renders 'Too much data' copy. Server threshold gate and client empty-state confirmed source-only; live threshold-raise flow deferred per v1.4 Phase 24 pragmatic-close precedent. |
| e2e.3 | clear filters → dynamic view drops | DEFERRED | kinetica_bi/server/src/index.ts:1206-1212 materialize endpoint no_filter short-circuit: isTableNotFoundError (filter view TTL'd / never materialized) → DROP TABLE IF EXISTS dynamicViewName + return {status: 'over_threshold', reason: 'no_filter'}. useDynamicViewMaterializeChain.ts matVer subscription re-fires on filter-clear matVer bump. no_filter code path confirmed source-only at index.ts:1206-1212; live filter-clear operator scenario deferred per v1.5 Phase 31 source-only attestation precedent. |
| e2e.4 | lifecycle reset on logout → all materialized dynamic views drop | PASS | kinetica_bi/src/App.tsx:94-106 UNAUTHORIZED handler: comment 'Phase 33 DV-V16-07 (6th store)'; lines 99-105 for-loop over views checking status === 'materialized' + dropDynamicView(dvId).catch(()=>{}); line 106 useDynamicViewStore.getState().reset(). Server DELETE handler at kinetica_bi/server/src/index.ts:1309-1340 (drop path) + POST /api/dynamic-view/:id/drop at index.ts:1282-1315. Source-inspectable; no live UAT required. |
| e2e.5 | lifecycle reset on dashboard switch → all materialized dynamic views drop | PASS | kinetica_bi/src/components/DashboardsPage.tsx:403-444 DashboardOpen cleanup (dashboard unmount / switch): lines 437-443 identical DROP loop (for materialized dvId → dropDynamicView(dvId).catch(()=>{})); line 444 useDynamicViewStore.getState().reset(). Pattern mirrors App.tsx UNAUTHORIZED block per Plan 33-03 spec. Source-inspectable; no live UAT required. |

## v1.6 Phase Summary

| Phase | Title | Status |
|---|---|---|
| 32 | dynamic-view-foundation | passed |
| 33 | dynamic-view-store | passed |
| 34 | dynamic-view-ui | passed |
| 35 | widget-binding-and-pipeline | passed |
| 36 | verification | failed |

(Per-phase status for Phases 32-35 reflects the per-phase rollup tables above: all criteria PASS or PASS-with-DEFERRED-precedent. Phase 36 status: failed — success criterion 2 is FAIL due to server vitest cross-mode isolation failures. Phase 32 dynamic-view specs are 86/86 green.)

## Gap Closures Landed During the Cycle (Out of Band)

Operator interactive testing during the v1.6 cycle surfaced gaps that were closed in-cycle. Commits below are beyond the planned Phase 32-35 task lists:

| Commit | Description |
|---|---|
| `f071ef6` | fix(35): popup default height 250px + align fresh-layer config with wire field names |
| `79cea03` | fix(35): auto-retry info-query with ST_DISTANCE when STXY rejects GEOMETRY |
| `4635a09` | fix(35): info-query routes dv-bound layers through the dynamic-view name |
| `9345564` | fix(heatmap): always emit REVERSE_COLORMAP — OL updateParams merges, doesn't replace |
| `674c511` | fix(heatmap): persist reverseColormap=false explicitly when operator unchecks |
| `8a13c36` | feat(heatmap): drop MIN_LEVEL/MAX_LEVEL, add REVERSE_COLORMAP toggle |
| `9c2e135` | fix(heatmap): drop cividis + turbo from colormap catalog |
| `df75fdd` | feat(heatmap): full Kinetica colormap catalog grouped by category |
| `e79af42` | feat(35): zoom-range gate for info-click fan-out |
| `3329c74` | feat(35): per-layer zoom-range visibility via dual-handle slider |
| `ca5719b` | fix(35): no_filter fast-path populates dv store on mount (no loading-stuck) |
| `2fb86ab` | fix(35): cascade filter-cleared transition through to bound dynamic views |
| `dcbfb41` | fix(35): dedupe concurrent dropFilterView calls by (dashboardId, tableId) |
| `1830c38` | feat(35): auto-hide WMS layers when their source is missing or empty |
| `0ab41c1` | fix(35): dedupe concurrent materializeFilter calls by (dashboardId, tableId) |
| `6dd7def` | fix(35): relocate popup container to first child to prevent reconciler crash |
| `59fcf92` | fix(35): defer XHR-success src assignment + guard detached container |
| `4e7745c` | fix(35): defer OL tile-load setState + per-widget ErrorBoundary |
| `56cf519` | fix(34): recognize S/SDc:1513 + Object-not-found in isTableNotFoundError |
| `6873e65` | fix(34,35): auto-Preview on Save + correct columns_json wire type |
| `67c62ba` | fix(34,35): persist columns_json on CREATE + dv-aware layer name |
| `711db5a` | fix(35): use dv.columns_json for layer columns when dv-bound |

## Carry-over to v1.7

- **TD-V14-WKB-SPIKE** — still open. Re-run path documented in `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`. Affects info-query AND spatial-filter materialize for native WKB-binary columns; resolved 2026-05-11 for WKT-content-in-Kinetica-GEOMETRY case (TD-V14-WKB closed at that scope; TRUE WKB-binary remains carried).
- **Map-only dashboard spatial-trigger gap** (carry-over from v1.5) — dashboard with no chart + no records table on a spatial-target table still wouldn't fire materialize. Map-side trigger not implemented this cycle either; rare configuration.
- **Live UAT for v1.6** — operator-skipped this cycle per the v1.5 Phase 31 precedent; remains open in case a production-only bug surfaces post-ship.
- **Server vitest cross-mode isolation (SC2 FAIL)** — pre-existing cross-mode test isolation failures: oidc-mode tests fail under AUTH_MODE=password (expected configuration mismatch), password-mode tests fail under AUTH_MODE=oidc (expected). Plus 1 timeout in routes.info-query.spec.ts (tests/routes.info-query.spec.ts — latlon SQL shape test). These are pre-existing issues not introduced by v1.6; Phase 32 dynamic-view specs are 86/86 green. Fix tracked as v1.7 server test isolation work.
- **DEFERRED e2e scenarios (e2e.1, e2e.2, e2e.3)** — live operator click-through for the create→materialize→render, over-threshold drop, and filter-clear drop flows deferred per v1.5 Phase 31 source-only precedent. Code paths confirmed source-only; production verification pending v1.7 or a gap-closure cycle.

---

*Verified 2026-05-18 — source-only attestation + automated test-gate proof. v1.6 status: failed (SC2 FAIL — server vitest cross-mode isolation). v1.6 ready for `/gsd:audit-milestone` and `/gsd:complete-milestone` with failed gate noted.*
