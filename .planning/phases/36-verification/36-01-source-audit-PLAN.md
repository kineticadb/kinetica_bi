---
phase: 36-verification
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/36-verification/36-01-AUDIT-NOTES.md
autonomous: true
requirements:
  - VERIFY-V16-01

must_haves:
  truths:
    - "Auditor inventoried every artifact actually shipped under Phases 32, 33, 34, and 35 by reading each phase's PLAN.md + CONTEXT.md + per-plan SUMMARY.md from .planning/phases/3[2-5]-*/ and cross-referenced source files in kinetica_bi/server/src/ + kinetica_bi/src/."
    - "Per-criterion PASS / FAIL / DEFERRED decisions for Phase 32 success criteria 1-6 are written to 36-01-AUDIT-NOTES.md with file:line evidence (server table/migration, substituteViewToken helper, preview/materialize/delete routes, supertest spec presence)."
    - "Per-criterion PASS / FAIL / DEFERRED decisions for Phase 33 success criteria 1-4 are written to 36-01-AUDIT-NOTES.md with file:line evidence (useDynamicViewStore shape + 5 actions + dynamicViewVersion monotonicity, client.ts helpers with AbortSignal, lifecycle reset wired as 6th call at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen, store vitest coverage)."
    - "Per-criterion PASS / FAIL / DEFERRED decisions for Phase 34 success criteria 1-4 are written to 36-01-AUDIT-NOTES.md with file:line evidence (Dynamic Views action-bar button on DashboardsPage, DynamicViewsModal create/edit/delete affordances, CodeMirror SQL editor + Insert {view} button + max_records clamp + Preview button + Save button, Preview → /preview endpoint + columns_json persistence)."
    - "Per-criterion PASS / FAIL / DEFERRED decisions for Phase 35 success criteria 1-4 are written to 36-01-AUDIT-NOTES.md with file:line evidence (ChartConfigPanel Dynamic Views optgroup + dynamicViewId write, three renderers FROM/LAYERS-swap, useDynamicViewMaterializeChain cascade pipeline + per-id AbortController, over-threshold empty-state copy 'Too much data — narrow your filters to enable this view.')."
    - "End-to-end operator scenarios from ROADMAP success criterion 1 (create → preview → save → applies filter → materialize; raise threshold → drop → empty state; clear filters → drop; lifecycle reset on logout / dashboard switch) are mapped to source files + statuses (PASS via source inspection / DEFERRED via 'requires live UAT' note matching v1.4 / v1.5 pragmatic-close precedent)."
    - "Each FAIL or DEFERRED row carries a one-line rationale tied to source evidence (or, for DEFERRED, the precedent it inherits — e.g. v1.5 Phase 31 source-only attestation)."
  artifacts:
    - path: ".planning/phases/36-verification/36-01-AUDIT-NOTES.md"
      provides: "Per-phase PASS/FAIL/DEFERRED audit matrix for v1.6 Phases 32-35, consumed by 36-03 to author 36-VERIFICATION.md"
      contains: "## Phase 32"
  key_links:
    - from: "Auditor source-only inspection"
      to: "36-03 verification-doc compilation"
      via: "36-01-AUDIT-NOTES.md per-phase status matrix"
      pattern: "status: (PASS|FAIL|DEFERRED)"
---

<objective>
Compile a source-only audit of every shipped artifact across v1.6 Phases 32-35, producing a per-criterion PASS / FAIL / DEFERRED matrix with file:line evidence. This plan does NOT run tests (Plan 36-02 owns that gate); it does NOT author the final verification document (Plan 36-03 owns that). It produces the audit notes that 36-03 transcribes into 36-VERIFICATION.md.

Purpose: VERIFY-V16-01 demands source-attestation of the four ROADMAP success criteria across all five v1.6 phases. The criteria are heavy on operator scenarios (create → preview → materialize → over-threshold → reset) and the pragmatic-close precedent from v1.4 / v1.5 says inspectable items PASS and items requiring live UAT are marked DEFERRED with a precedent reference. The auditor's job here is to do the heavy reading and produce a structured matrix so 36-03 can assemble the verification doc fast.

Output:
  - .planning/phases/36-verification/36-01-AUDIT-NOTES.md — YAML-fronted structured doc, one block per phase (32, 33, 34, 35), one row per success criterion, with status + evidence + rationale.

No production code is modified in this plan.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/31-verification/31-VERIFICATION.md
@.planning/phases/24-verification/24-VERIFICATION.md
@.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md
@.planning/phases/32-dynamic-view-foundation/32-VERIFICATION.md
@.planning/phases/33-dynamic-view-store/33-VERIFICATION.md
@.planning/phases/34-dynamic-view-ui/34-VERIFICATION.md
@.planning/phases/35-widget-binding-and-pipeline/35-VERIFICATION.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Audit Phases 32 + 33 shipped artifacts and record per-criterion status</name>
  <files>.planning/phases/36-verification/36-01-AUDIT-NOTES.md</files>
  <read_first>
    - .planning/REQUIREMENTS.md (grep for DV-V16-01..07 + VERIFY-V16-01)
    - .planning/ROADMAP.md (Phase 32 + Phase 33 Success Criteria blocks — used verbatim as the rows to fill)
    - .planning/phases/32-dynamic-view-foundation/32-CONTEXT.md (locked decisions D1-D7)
    - .planning/phases/32-dynamic-view-foundation/32-01-db-schema-and-helpers-PLAN.md
    - .planning/phases/32-dynamic-view-foundation/32-01-db-schema-and-helpers-SUMMARY.md
    - .planning/phases/32-dynamic-view-foundation/32-02-crud-endpoints-PLAN.md
    - .planning/phases/32-dynamic-view-foundation/32-02-crud-endpoints-SUMMARY.md
    - .planning/phases/32-dynamic-view-foundation/32-03-preview-materialize-delete-PLAN.md
    - .planning/phases/32-dynamic-view-foundation/32-03-preview-materialize-delete-SUMMARY.md
    - .planning/phases/32-dynamic-view-foundation/32-VERIFICATION.md
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md
    - .planning/phases/33-dynamic-view-store/33-01-store-and-naming-helper-PLAN.md
    - .planning/phases/33-dynamic-view-store/33-01-SUMMARY.md
    - .planning/phases/33-dynamic-view-store/33-02-server-drop-endpoint-PLAN.md
    - .planning/phases/33-dynamic-view-store/33-02-SUMMARY.md
    - .planning/phases/33-dynamic-view-store/33-03-client-helpers-and-lifecycle-PLAN.md
    - .planning/phases/33-dynamic-view-store/33-03-SUMMARY.md
    - .planning/phases/33-dynamic-view-store/33-VERIFICATION.md
    - kinetica_bi/server/src/db.ts (CREATE TABLE dashboard_dynamic_views + PRAGMA-guarded migration)
    - kinetica_bi/server/src/lib/dynamicViewSql.ts (substituteViewToken + buildDynamicViewName)
    - kinetica_bi/server/src/lib/materializedView.ts (createOrReplaceMaterialized shared helper)
    - kinetica_bi/server/src/index.ts (route registrations — GET/POST /api/dashboards/:dashboardId/dynamic-views, PUT /api/dynamic-views/:id, POST /api/dynamic-view/preview, POST /api/dynamic-view/materialize, DELETE /api/dynamic-view/:id, POST /api/dynamic-view/:id/drop)
    - kinetica_bi/server/tests/routes.dynamic-view.spec.ts (preview / materialize / delete supertest)
    - kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts (GET/POST/PUT CRUD supertest)
    - kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts (drop-only supertest)
    - kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts
    - kinetica_bi/server/tests/lib.dynamicViewSql.spec.ts
    - kinetica_bi/server/tests/lib.dynamicViewName.spec.ts
    - kinetica_bi/server/tests/lib.materializedView.spec.ts
    - kinetica_bi/src/lib/dynamicViewName.ts (byte-parity client helper)
    - kinetica_bi/src/stores/useDynamicViewStore.ts (Zustand slice — shape + 5 actions + dynamicViewVersion)
    - kinetica_bi/src/api/client.ts (listDynamicViews, createDynamicView, updateDynamicView, deleteDynamicView, previewDynamicView, materializeDynamicView, dropDynamicView)
    - kinetica_bi/src/App.tsx (UNAUTHORIZED lifecycle reset block — confirm useDynamicViewStore.reset() is the 6th call)
    - kinetica_bi/src/components/dashboards/DashboardsPage.tsx (DashboardOpen cleanup block — confirm useDynamicViewStore.reset() wired)
    - kinetica_bi/src/stores/__tests__/useDynamicViewStore.test.ts (or equivalent .spec.ts; vitest coverage for empty-state, error-state, version-monotonicity, reset zeroing)
  </read_first>
  <action>
    Create `.planning/phases/36-verification/36-01-AUDIT-NOTES.md` with this YAML header and the Phase 32 + Phase 33 audit blocks below. Use the EXACT criterion text from ROADMAP.md (do NOT paraphrase) so 36-03 can transcribe verbatim into 36-VERIFICATION.md. Each row's `status` MUST be one of `PASS`, `FAIL`, or `DEFERRED`. Each row's `evidence` MUST cite at least one file path (and ideally a line reference) confirming the implementation. Each `rationale` is a one-liner.

    File header (write first):

    ```yaml
    ---
    plan: 36-01
    auditor: gsd-executor (source-only)
    audit_date: <today YYYY-MM-DD>
    scope: "v1.6 Dynamic Views Phases 32-35 — code-review attestation against ROADMAP success criteria"
    inherits_precedent_from: ["v1.4 Phase 24 pragmatic-close", "v1.5 Phase 31 source-only"]
    ---

    # 36-01 Source Audit Notes — v1.6 Dynamic Views

    Per-phase, per-criterion PASS / FAIL / DEFERRED matrix with file:line evidence. Produced by 36-01 source-only audit; consumed by 36-03 to compile 36-VERIFICATION.md.

    All criterion text below is copied verbatim from `.planning/ROADMAP.md` Phase 32-35 "Success Criteria" blocks (Phase 36 success criterion 3 will be authored by 36-03 itself).
    ```

    Then append the Phase 32 block. Use the six Phase 32 ROADMAP criteria verbatim. For EACH criterion:

    ```yaml
    ## Phase 32 — dynamic-view-foundation

    - criterion_id: 32.1
      text: "New `dashboard_dynamic_views` table exists with columns `id, dashboard_id, source_table_id, name, template_sql, max_records, columns_json, created_at, updated_at`. Idempotent PRAGMA-guarded migration mirrors the v1.4 Phase 19 pattern."
      status: <PASS|FAIL|DEFERRED>
      evidence: "kinetica_bi/server/src/db.ts <line> CREATE TABLE; <line> PRAGMA table_info-guarded ALTER pattern. kinetica_bi/server/tests/db.dynamicViewsMigration.spec.ts asserts idempotency."
      rationale: "<one-liner>"

    - criterion_id: 32.2
      text: "Pure module `kinetica_bi/server/src/lib/dynamicViewSql.ts` exports `substituteViewToken(template, viewName)` — replaces `{view}` (case-insensitive, whitespace-tolerant) with the supplied identifier; throws if `{view}` is absent (configuration error)."
      status: ...
      evidence: "kinetica_bi/server/src/lib/dynamicViewSql.ts substituteViewToken implementation; tests/lib.dynamicViewSql.spec.ts case-insensitivity + missing-token error cases."
      rationale: ...

    - criterion_id: 32.3
      text: "`POST /api/dynamic-view/preview` accepts `{ template_sql, source_view_name, sample_limit }`. Runs `SELECT * FROM ({template_sql_substituted}) LIMIT N` against Kinetica; returns `{ rows, columns }` for the operator's discovery flow. Does NOT create a permanent view."
      status: ...
      evidence: ...
      rationale: ...

    - criterion_id: 32.4
      text: "`POST /api/dynamic-view/materialize` accepts `{ dynamic_view_id }`. Looks up the row, computes the source filter-view name (via existing `buildFilterViewName`), runs a `SELECT COUNT(*) FROM <source_view>` row-count check, then either: (a) below threshold → `CREATE OR REPLACE MATERIALIZED VIEW <dynamic_view_name> AS (<substituted_sql>) USING TABLE PROPERTIES (TTL = 5)`; or (b) at/above threshold → `DROP TABLE IF EXISTS <dynamic_view_name>` and return `{ status: 'over_threshold' }`. Re-uses the TM/SMc:1078 race-recovery retry from Phase 30."
      status: ...
      evidence: ...
      rationale: ...

    - criterion_id: 32.5
      text: "`DELETE /api/dynamic-view/:id` drops the materialized view + deletes the row."
      status: ...
      evidence: ...
      rationale: ...

    - criterion_id: 32.6
      text: "Supertest coverage in both `AUTH_MODE=password` and `AUTH_MODE=oidc` blocks: preview path (column extraction), materialize-below-threshold (200 + viewName), materialize-over-threshold (200 + `over_threshold` status + DROP fired), bare unsubstituted-token (400), 501 / WKB-style errors propagated cleanly."
      status: ...
      evidence: "kinetica_bi/server/tests/routes.dynamic-view.spec.ts (preview + materialize + delete cases, both AUTH_MODE blocks). Plan 36-02 confirms suite-green."
      rationale: "Source-presence audit only — Plan 36-02 owns the actual test execution gate. If specs are present and reference both auth modes in describe blocks, PASS here pending 36-02 green."
    ```

    Then append the Phase 33 block with the four Phase 33 ROADMAP criteria verbatim. For each:

    - 33.1: `useDynamicViewStore` Zustand slice shape + 5 actions + `dynamicViewVersion` monotonic counter — cite store file path + actions + version-counter increment site.
    - 33.2: client helpers in `client.ts` with AbortSignal threaded — cite each helper export.
    - 33.3: `reset()` wired as 6th call in lifecycle reset at `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen — cite exact files + ordering.
    - 33.4: store vitest coverage (empty / error / version-monotonicity / reset-zeros) — cite store spec file path.

    For ANY criterion that cannot be confirmed from source (e.g. live operator behaviour with running Kinetica), mark `DEFERRED` and add a rationale citing the v1.4 Phase 24 / v1.5 Phase 31 pragmatic-close precedent ("source-attestation acceptable; live UAT skipped per operator precedent").

    Cross-check helpers (run before writing each `evidence` field):
      - `grep -n "CREATE TABLE.*dashboard_dynamic_views" kinetica_bi/server/src/db.ts`
      - `grep -n "PRAGMA table_info" kinetica_bi/server/src/db.ts | head`
      - `grep -n "substituteViewToken\|buildDynamicViewName" kinetica_bi/server/src/lib/dynamicViewSql.ts kinetica_bi/server/src/index.ts`
      - `grep -n "createOrReplaceMaterialized" kinetica_bi/server/src/lib/materializedView.ts kinetica_bi/server/src/index.ts`
      - `grep -n "/api/dynamic-view" kinetica_bi/server/src/index.ts`
      - `grep -n "useDynamicViewStore" kinetica_bi/src/stores/useDynamicViewStore.ts kinetica_bi/src/App.tsx kinetica_bi/src/components/dashboards/DashboardsPage.tsx`
      - `grep -n "listDynamicViews\|createDynamicView\|updateDynamicView\|deleteDynamicView\|previewDynamicView\|materializeDynamicView\|dropDynamicView" kinetica_bi/src/api/client.ts`
      - `grep -n "dynamicViewVersion" kinetica_bi/src/stores/useDynamicViewStore.ts`
      - `grep -n "AUTH_MODE.*oidc\|AUTH_MODE.*password" kinetica_bi/server/tests/routes.dynamic-view.spec.ts kinetica_bi/server/tests/routes.dynamic-view-crud.spec.ts kinetica_bi/server/tests/routes.dynamic-view-drop.spec.ts`

    Use grep output to populate `evidence` fields with file paths AND specific line numbers (run e.g. `grep -n` not `grep -l`).

    Executor is forbidden from modifying any file under `kinetica_bi/src/` or `kinetica_bi/server/src/` in this plan.
  </action>
  <verify>
    <automated>test -f .planning/phases/36-verification/36-01-AUDIT-NOTES.md && grep -c "^- criterion_id: 32\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md | awk '{ if ($1 == 6) exit 0; else exit 1 }' && grep -c "^- criterion_id: 33\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md | awk '{ if ($1 == 4) exit 0; else exit 1 }' && ! grep -E "^  status: $|^  status: <" .planning/phases/36-verification/36-01-AUDIT-NOTES.md</automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/phases/36-verification/36-01-AUDIT-NOTES.md` exists with the required YAML header (plan, auditor, audit_date, scope, inherits_precedent_from).
    - File contains EXACTLY 6 criterion rows under `## Phase 32` (criterion_id 32.1 through 32.6), each with `status` set to one of `PASS`, `FAIL`, `DEFERRED` (no placeholder `<...>` text remaining).
    - File contains EXACTLY 4 criterion rows under `## Phase 33` (criterion_id 33.1 through 33.4), each with status set.
    - Every `evidence:` field cites at least one file path under `kinetica_bi/` (grep: `grep -c "evidence:.*kinetica_bi/" .planning/phases/36-verification/36-01-AUDIT-NOTES.md` returns >= 10).
    - Every criterion text matches its corresponding ROADMAP wording (verify by running `grep "dashboard_dynamic_views table exists" .planning/phases/36-verification/36-01-AUDIT-NOTES.md` returns at least 1 match and similar spot-checks for criteria 32.2, 33.1).
    - Every DEFERRED row's `rationale:` references either "v1.4 Phase 24" or "v1.5 Phase 31" pragmatic-close precedent — grep: `grep -B0 -A0 "status: DEFERRED" .planning/phases/36-verification/36-01-AUDIT-NOTES.md` cross-referenced against rationale fields.
    - No production source file under `kinetica_bi/src/` or `kinetica_bi/server/src/` was modified — confirm with `git status kinetica_bi/`.
  </acceptance_criteria>
  <done>36-01-AUDIT-NOTES.md exists with 6 Phase 32 rows + 4 Phase 33 rows, each with a non-placeholder status and file-path-bearing evidence.</done>
</task>

<task type="auto">
  <name>Task 2: Audit Phases 34 + 35 shipped artifacts and record per-criterion status + end-to-end scenarios</name>
  <files>.planning/phases/36-verification/36-01-AUDIT-NOTES.md</files>
  <read_first>
    - .planning/phases/36-verification/36-01-AUDIT-NOTES.md (file written by Task 1 — appending only)
    - .planning/REQUIREMENTS.md (grep DV-V16-08..14)
    - .planning/ROADMAP.md (Phase 34 + Phase 35 Success Criteria blocks)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md
    - .planning/phases/34-dynamic-view-ui/34-01-dependency-and-client-fix-PLAN.md
    - .planning/phases/34-dynamic-view-ui/34-01-SUMMARY.md
    - .planning/phases/34-dynamic-view-ui/34-02-modal-shell-and-left-list-PLAN.md
    - .planning/phases/34-dynamic-view-ui/34-02-SUMMARY.md
    - .planning/phases/34-dynamic-view-ui/34-03-form-and-preview-PLAN.md
    - .planning/phases/34-dynamic-view-ui/34-03-SUMMARY.md
    - .planning/phases/34-dynamic-view-ui/34-04-save-and-wiring-PLAN.md
    - .planning/phases/34-dynamic-view-ui/34-04-save-and-wiring-SUMMARY.md
    - .planning/phases/34-dynamic-view-ui/34-VERIFICATION.md
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md
    - .planning/phases/35-widget-binding-and-pipeline/35-01-layers-schema-migration-PLAN.md
    - .planning/phases/35-widget-binding-and-pipeline/35-01-SUMMARY.md
    - .planning/phases/35-widget-binding-and-pipeline/35-02-buildwmsparams-precedence-PLAN.md
    - .planning/phases/35-widget-binding-and-pipeline/35-02-SUMMARY.md
    - .planning/phases/35-widget-binding-and-pipeline/35-03-orchestrator-hook-PLAN.md
    - .planning/phases/35-widget-binding-and-pipeline/35-03-SUMMARY.md
    - .planning/phases/35-widget-binding-and-pipeline/35-04-chartconfig-picker-PLAN.md
    - .planning/phases/35-widget-binding-and-pipeline/35-04-SUMMARY.md
    - .planning/phases/35-widget-binding-and-pipeline/35-05-renderer-status-gates-PLAN.md
    - .planning/phases/35-widget-binding-and-pipeline/35-05-SUMMARY.md
    - .planning/phases/35-widget-binding-and-pipeline/35-06-map-renderer-and-layer-picker-PLAN.md
    - .planning/phases/35-widget-binding-and-pipeline/35-06-SUMMARY.md
    - .planning/phases/35-widget-binding-and-pipeline/35-VERIFICATION.md
    - kinetica_bi/src/components/dashboards/DashboardsPage.tsx (Dynamic Views action-bar button placement between Map Layers and Back; DynamicViewsModal mount conditional)
    - kinetica_bi/src/components/dynamicViews/DynamicViewsModal.tsx (modal shell + left list + form + Preview + Save + Delete)
    - kinetica_bi/src/components/dynamicViews/DynamicViewsModal.spec.tsx (~41 vitest tests)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (Dynamic Views optgroup at usesDataSource branch; dual-write tableId + dynamicViewId on dv pick)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (AggregatedWidgetRenderer + RecordsTableRenderer status-aware gates; over-threshold copy)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (per-layer dv lookup + 4-arg buildWmsParams + layer-skip + "Some layers over threshold" overlay)
    - kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts (orchestrator: cold-start gate + per-id AbortController Map + version-watcher + retry callback)
    - kinetica_bi/src/lib/buildWmsParams.ts (4-case precedence)
    - kinetica_bi/src/components/layers/LayersModal.tsx (or KineticaWmsLayerForm) — Data Source picker section for Tables + Dynamic Views
    - kinetica_bi/server/src/db.ts (dashboard_layers.dynamic_view_id INTEGER NULL column + PRAGMA-guarded ALTER)
    - kinetica_bi/server/src/index.ts (PATCH /api/dashboards/:id/layers/:layerId extended with dynamic_view_id)
  </read_first>
  <action>
    APPEND to the existing `.planning/phases/36-verification/36-01-AUDIT-NOTES.md` file (do NOT overwrite — Task 1 wrote the header + Phase 32 + Phase 33 blocks). Add the Phase 34, Phase 35, and end-to-end scenario blocks.

    Phase 34 block — use the FOUR Phase 34 ROADMAP criteria verbatim. For each row:

    - 34.1: New "Dynamic Views" button on dashboard action bar alongside Tables / Visualizations / Map Layers; opens modal listing dashboard dynamic views with edit / delete affordances. Cite `DashboardsPage.tsx` button placement and modal mount.
    - 34.2: Create / Edit dialog includes name, source-table picker (associated tables only), CodeMirror SQL editor with `{view}` token hint, max-records numeric input (min 1), Preview button, Save button. Cite `DynamicViewsModal.tsx` form section + `@codemirror/lang-sql` import + Insert {view} button + max_records clamp logic.
    - 34.3: Preview button calls `POST /api/dynamic-view/preview` with substituted SQL against current filter-view (or source-table name if no filter view); renders rows + columns in side panel; Save persists `columns_json`. Cite Preview handler + Save handler in `DynamicViewsModal.tsx` (look for `previewDynamicView` call + `columns_json` Save body construction with the BLOCKER #1 rule: `columns_json IFF templateChanged && previewRanSinceLastSave && formColumnsJson !== null`).
    - 34.4: Save persists + immediately triggers materialize via Phase 35 pipeline; Delete fires `DELETE /api/dynamic-view/:id` + removes row + drops materialized view. Cite Save handler (markPending → materializeDynamicView → setView/setError + toast) and Delete handler (deleteDynamicView → clearView + DROP).

    Phase 35 block — use the FOUR Phase 35 ROADMAP criteria verbatim. For each row:

    - 35.1: ChartConfigPanel "Data Source" picker shows existing dashboard dynamic views as new optgroup alongside Tables and Views (when `usesDataSource: true`); selecting a dynamic view writes `dynamicViewId` to `widget.config`. Cite `ChartConfigPanel.tsx` optgroup + dual-write code path.
    - 35.2: AggregatedWidgetRenderer / RecordsTableRenderer / MapChartRenderer read `dynamicViewId`, look up resolved view name from `useDynamicViewStore`, FROM-swap (or LAYERS-swap for maps). Cite all three renderer files + scoped store selectors.
    - 35.3: When source filter view re-materializes (v1.3 + v1.5 trigger fires), dynamic view re-materializes too; pipeline order: filter-view CREATE → row-count → dv CREATE/DROP → widget FROM-swap re-fires; AbortController serializes per-dynamic-view. Cite `useDynamicViewMaterializeChain.ts` cold-start gate + per-id AbortController Map + version-watcher.
    - 35.4: When a widget's dv has status `over_threshold`, widget renders "Too much data — narrow your filters to enable this view." No SQL executed. Cite the exact copy string in `WidgetRenderer.tsx` AggregatedWidgetRenderer + RecordsTableRenderer and the Effect 2 short-circuit; for MapChartRenderer cite the "Some layers over threshold" overlay + null-skip path.

    End-to-end scenario block — ROADMAP Phase 36 success criterion 1 enumerates five operator scenarios. Add a `## End-to-End Scenarios` section with one row per scenario:

    ```yaml
    ## End-to-End Scenarios (ROADMAP Phase 36 success criterion 1)

    - scenario_id: e2e.1
      text: "create → preview → save → applies filter → dynamic view materializes → widget renders filtered data"
      status: <PASS via source / DEFERRED via no-live-UAT>
      evidence: "DynamicViewsModal.tsx Save handler chains createDynamicView → buildDynamicViewName → markPending → materializeDynamicView → setView. WidgetRenderer.tsx Effect 2 detects materialized state and runs FROM-swap. useDynamicViewMaterializeChain.ts subscribes to filter-view matVer for re-materialize-on-filter-change."
      rationale: "Code path complete and unit-tested; live operator click-through deferred per v1.5 Phase 31 precedent."

    - scenario_id: e2e.2
      text: "raise filter threshold → dynamic view drops → widget shows over-threshold empty state"
      status: ...
      evidence: ...
      rationale: ...

    - scenario_id: e2e.3
      text: "clear filters → dynamic view drops"
      status: ...
      evidence: "32-CONTEXT D2 no-filter behaviour; materialize endpoint short-circuit when no filter-view row exists returns `over_threshold` with `reason: 'no_filter'`. Verified in routes.dynamic-view.spec.ts no-filter case."
      rationale: ...

    - scenario_id: e2e.4
      text: "lifecycle reset on logout → all materialized dynamic views drop"
      status: ...
      evidence: "App.tsx UNAUTHORIZED handler calls useDynamicViewStore.reset() (6th canonical call) AND the materialized-only DROP loop (Plan 33-03)."
      rationale: ...

    - scenario_id: e2e.5
      text: "lifecycle reset on dashboard switch → all materialized dynamic views drop"
      status: ...
      evidence: "DashboardsPage.tsx DashboardOpen cleanup invokes the same reset + DROP loop."
      rationale: ...
    ```

    Cross-check helpers (run before populating each `evidence`):
      - `grep -n "Dynamic Views\|dynamicViews" kinetica_bi/src/components/dashboards/DashboardsPage.tsx`
      - `grep -n "lang-sql\|@codemirror" kinetica_bi/src/components/dynamicViews/DynamicViewsModal.tsx kinetica_bi/package.json`
      - `grep -n "Insert {view}\|substituteViewToken\|{view}" kinetica_bi/src/components/dynamicViews/DynamicViewsModal.tsx`
      - `grep -n "previewDynamicView\|materializeDynamicView\|deleteDynamicView" kinetica_bi/src/components/dynamicViews/DynamicViewsModal.tsx`
      - `grep -n "Dynamic Views\|optgroup" kinetica_bi/src/components/charts/ChartConfigPanel.tsx`
      - `grep -n "dynamicViewId\|useDynamicViewStore" kinetica_bi/src/components/charts/WidgetRenderer.tsx`
      - `grep -n "Too much data" kinetica_bi/src/components/charts/WidgetRenderer.tsx`
      - `grep -n "Some layers over threshold" kinetica_bi/src/components/charts/MapChartRenderer.tsx`
      - `grep -n "AbortController\|cold-start\|matVer" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`
      - `grep -n "dynamic_view_id" kinetica_bi/server/src/db.ts kinetica_bi/server/src/index.ts`
      - `grep -n "useDynamicViewStore" kinetica_bi/src/App.tsx kinetica_bi/src/components/dashboards/DashboardsPage.tsx`

    Executor is forbidden from modifying any file under `kinetica_bi/src/` or `kinetica_bi/server/src/` in this plan.
  </action>
  <verify>
    <automated>grep -c "^- criterion_id: 34\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md | awk '{ if ($1 == 4) exit 0; else exit 1 }' && grep -c "^- criterion_id: 35\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md | awk '{ if ($1 == 4) exit 0; else exit 1 }' && grep -c "^- scenario_id: e2e\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md | awk '{ if ($1 == 5) exit 0; else exit 1 }' && ! grep -E "^  status: $|^  status: <" .planning/phases/36-verification/36-01-AUDIT-NOTES.md</automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/phases/36-verification/36-01-AUDIT-NOTES.md` contains EXACTLY 4 rows under `## Phase 34` (criterion_id 34.1 through 34.4), each with status set to one of PASS / FAIL / DEFERRED.
    - File contains EXACTLY 4 rows under `## Phase 35` (criterion_id 35.1 through 35.4), each with status set.
    - File contains EXACTLY 5 rows under `## End-to-End Scenarios` (scenario_id e2e.1 through e2e.5), each with status set.
    - Phase 34 criterion 34.2 evidence cites `@codemirror/lang-sql` OR `CodeMirror` AND mentions `kinetica_bi/src/components/dynamicViews/DynamicViewsModal.tsx`.
    - Phase 35 criterion 35.4 evidence quotes the exact string `"Too much data"` AND cites `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — grep: `grep "Too much data" .planning/phases/36-verification/36-01-AUDIT-NOTES.md` returns at least 1 hit.
    - Phase 35 criterion 35.3 evidence cites `useDynamicViewMaterializeChain.ts` AND mentions `AbortController`.
    - Every scenario_id row's `evidence` cites at least one production source file under `kinetica_bi/src/` or `kinetica_bi/server/src/`.
    - Combined file now has >= 19 rows (6 + 4 + 4 + 4 + 5 + at least 1 explicit Phase 36 referent).
    - No production source file was modified — confirm with `git status kinetica_bi/`.
  </acceptance_criteria>
  <done>36-01-AUDIT-NOTES.md complete with all 18 criterion rows + 5 scenario rows; ready for 36-03 to transcribe.</done>
</task>

</tasks>

<verification>
After both tasks complete:
  - File `.planning/phases/36-verification/36-01-AUDIT-NOTES.md` exists.
  - `grep -c "^- criterion_id:" .planning/phases/36-verification/36-01-AUDIT-NOTES.md` returns 18 (Phase 32 = 6, Phase 33 = 4, Phase 34 = 4, Phase 35 = 4).
  - `grep -c "^- scenario_id:" .planning/phases/36-verification/36-01-AUDIT-NOTES.md` returns 5.
  - No `status:` field is empty or contains placeholder syntax (`<...>`).
  - Every `evidence:` field cites at least one file path under `kinetica_bi/`.
  - `git status kinetica_bi/` shows no modified production source files attributable to this plan.
</verification>

<success_criteria>
- VERIFY-V16-01 partial coverage: source-only audit matrix produced for Phases 32-35 ROADMAP success criteria plus the five end-to-end operator scenarios from Phase 36 criterion 1.
- Audit matrix is in a structured YAML form 36-03 can transcribe verbatim into 36-VERIFICATION.md.
- Each FAIL or DEFERRED row carries a one-line rationale tied to source evidence or the v1.4 / v1.5 pragmatic-close precedent.
</success_criteria>

<output>
After both tasks complete, create `.planning/phases/36-verification/36-01-SUMMARY.md` summarizing the per-phase PASS / FAIL / DEFERRED counts and listing any DEFERRED rows (so 36-03 can carry them into the final caveat block).
</output>
