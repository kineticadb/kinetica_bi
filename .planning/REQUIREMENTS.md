# Requirements: Kinetica BI — v1.24 Dashboard Export & Import

**Defined:** 2026-09-16
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

## v1.24 Requirements

### Dashboard Export & Import

Requested by the operator 2026-09-16, verbatim:

> *"We want to be able to export and import a dashboard. This is valuable to move dashboards across
> environments. The migration should move all the visualizations along with the dashboard but it does
> not need to maintain all the user access and that can be different on different environments. New
> dashboards and visualization ids should be used in case there is already an existing dashboard with
> the old id or visualization ids."*

**Why this is not simply "dump the rows".** A dashboard is the root of a dependency graph, and three
kinds of reference are buried *inside JSON config blobs* rather than in FK columns:

- `widgets.config.tableId` → `tables.id`
- `widgets.config.sourceMapWidgetId` → **another widget's id** (the standalone Legend widget binds to
  a map widget; v1.7 Phase 42)
- widget config → `custom_metrics.id` — and `db.ts` is explicit that this id is load-bearing:
  *"id is an opaque autoincrement key so Phase 100 widget references survive label/expression edits"*

Renumbering on import therefore means rewriting references inside serialized JSON, not just
reassigning primary keys. A widget that keeps a stale id does not error — it silently renders the
wrong table, the wrong metric, or an unbound legend.

- [x] **DXIM-V124-01**: A dashboard can be exported to a JSON file that contains everything needed to recreate it elsewhere — operator-verified 2026-09-16 (Phase 119 export of dashboard id 4, "Test Dashboard": 7 widgets, 4 layers, 3 tables, 0 dangling references). RE-VERIFIED CROSS-ENVIRONMENT 2026-09-18 (Phase 121-04): the same dashboard, extended with a custom metric AND a dynamic view, exported from `:4000`/`data/kinetica.db` and imported into `:4001`/`data/env-b.db` three times — 9 widgets, 2 layers, 3 tables, 2 customMetrics, 1 dynamicView (`max_records: 0`), 3 dashboardTableIds, **0 danglingReferences**.
- [x] **DXIM-V124-02**: The export includes every visualization (widget) on the dashboard, with its full configuration — operator-verified 2026-09-16 (all 7 widgets — heatmap, legend, map, radiogroup, records, table — exported with full config)
- [x] **DXIM-V124-03**: Importing that file into another environment recreates the dashboard and all its visualizations — automated 2026-09-17 (Phase 120: `routes.dashboard-import.spec.ts` ROUTE-201 report-shape tests + `routes.dashboard-import.refs.spec.ts`'s full kitchen-sink round trip through `POST /api/dashboards/import`). **OPERATOR-VERIFIED ACROSS TWO REAL ENVIRONMENTS 2026-09-18** (Phase 121-04): two server processes, two SQLite files, the file moved through the browser. All 9 widgets render the same data as the source; drill-down, filters, map layers (incl. a dv-bound layer) and Radio Group actions all work on the imported copy; no widget config landed as `{}`. REF-2/`dynamicViewId`, REF-4/scalar `metricId` and REF-5/`metrics[].metricId` exercised live for the first time. HOLDS despite the frozen-`config.sql` defect found alongside: import reproduces the source's behaviour faithfully, staleness included, and the defect is confirmed PRE-EXISTING and reproducible in a single environment that has never been imported into — see `defect-frozen-config-sql-metric-expression.md`.
- [x] **DXIM-V124-04**: Import always assigns NEW dashboard and widget ids — importing a file whose original ids collide with existing records must succeed, leaving the existing records untouched — automated 2026-09-17 (Phase 120-03's `NEWID-collision` tests directly insert pre-existing rows at the file's exact ids and prove them byte-identical after import; Phase 120-05's `IMPNEW-decoy` proves every old id in the armed fixture still resolves to an untouched pre-existing record)
- [x] **DXIM-V124-05**: Every id reference inside exported configuration is remapped to the new ids on import — including widget→widget, widget→table, and widget→custom-metric references — so no imported widget points at a pre-existing record by accident — automated 2026-09-17 (`routes.dashboard-import.refs.spec.ts`: `IMPNEW-REF1..REF8` each assert the NEW id and NOT the file's, against a fixture armed so a skipped remap would silently point at a real pre-existing record; `IMPNEW-sweep` re-drives the shipped `collectWidgetConfigRefs` per kind as a catch-all; 12/12 Task-2 mutation probes fired, one per reference kind plus the union edge and the sweep. REOPENED AND RE-CLOSED 2026-09-17 (Phase 121): a NINTH kind, `config.spatialTargets[].tableId` (map widget, v1.5 Phase 28), was missing from the inventory — 119-RESEARCH, the plan checker and the third audit sweep all missed it, and so did `IMPNEW-sweep`, because a catch-all driven by `collectWidgetConfigRefs` cannot detect a kind absent from `collectWidgetConfigRefs`. Added as REF-9 with collect + remap + route-level coverage (`IMPNEW-REF9`), 3 mutation probes fired. LIMITATION: proven in one database — proves remapping, not cross-environment portability; REF-2/`dynamicViewId`, REF-4/scalar `metricId` and REF-5/`metrics[].metricId` have never been exercised outside a fixture — Phase 121 must exercise a real dashboard with a custom metric AND a dynamic view)
- [x] **DXIM-V124-06**: Tables are matched by `schema.name` on import: an existing registry entry is reused, a missing one is created — never duplicated for the same `schema.name` — automated 2026-09-17 (Phase 120-02's `RESOLVE-table` tests + Phase 120-05's `tablesMatched`/`tablesCreated` report assertions against the armed fixture, where every table is genuinely CREATED because the schema was rewritten to `kbi_target`)
- [x] **DXIM-V124-07**: Custom metrics referenced by imported widgets travel with the export and are created in the target if absent, so no imported widget loses its metric — automated 2026-09-17 (Phase 120-02's `RESOLVE-metric` tests, incl. the locked same-label/different-expression conflict policy; Phase 120-05's `IMPNEW-REF4`/`IMPNEW-REF5` extra proofs against the armed fixture where metrics are genuinely CREATED)
- [x] **DXIM-V124-08**: User access grants are NOT exported or imported — the imported dashboard starts with the target environment's own access rules — proven by Phase 119-03's exclusion canaries (access-grant grantee absent from raw response bytes) AND by the operator's own search of the exported file finding no usernames/roles, 2026-09-16
- [x] **DXIM-V124-09**: Import is atomic — a failure partway through leaves no partial dashboard, orphaned widgets, or stray table entries behind — automated 2026-09-17 (Phase 120-03: three SQLite `RAISE(ABORT)` trigger-induced rollbacks at three different points in the two-pass sequence — first widget insert, first layer insert, and the LAST creation step — each asserting a full seven-table row-count snapshot is unchanged; an `ATOMIC-clean` control run confirms no trigger leaked)
- [ ] **DXIM-V124-10**: Import reports what it did — which tables were matched vs created, which custom metrics were created, and the new dashboard id — **REOPENED 2026-09-18 (Phase 121-04 cross-environment checkpoint).** Previously closed automated 2026-09-17 (Phase 120-03's `REPORT-` tests + Phase 120-04's `ROUTE-201` response-shape tests). The live round trip produced `MetricConflict` outside a fixture for the first time, and its message is FALSE: *"Imported widgets now use the EXISTING definition ...; the file's definition was NOT applied."* For the seven `AggregatedWidgetRenderer` chart types (bar, line, pie, scatter, table, bignumber, heatmap) the widget renders the FILE's definition, because `ChartConfigPanel` freezes the resolved metric expression into `widget.config.sql` at Apply time and `WidgetRenderer.tsx:403` renders from that text without ever resolving the metric (`grep -c resolveMetricExpr WidgetRenderer.tsx` → 0). Every item -10 LITERALLY names (tables matched/created, metrics matched/created, dashboard id) was accurate, so a narrow reading survived; operator decision was to reopen rather than ship a known-false user-facing sentence, since the conflict message is precisely the part of -10 that had never been live-checked. Root cause PRE-EXISTING and not import-specific — see `defect-frozen-config-sql-metric-expression.md`.
- [x] **DXIM-V124-11**: A malformed, truncated, or hand-edited export file is rejected with a clear message rather than partially applied — automated 2026-09-17 (Phase 120-02's `VALID-reject`/`VALID-dangle`/`VALID-nowrite` tests — zero DB access during validation — plus Phase 120-04's `MALFORMED-truncated`/`OVERSIZE-limit` body-parser tests turning a prior bare 500 into a typed 400/413). REOPENED AND RE-CLOSED 2026-09-17 (Phase 121 checkpoint): the validator checked `dynamicViews[].max_records` with `asId`, whose `> 0` rule is correct for ids and wrong for a row cap — `0` is the documented UNLIMITED sentinel (`db.ts:128`, `index.ts:1694`/`:2011`) written by the app's own Unlimited checkbox. Every export carrying an unlimited dynamic view was rejected at the import boundary as "must be a positive integer". Found only by the live round trip; no fixture used 0. Fixed with a dedicated `isNonNegativeInt`; 3 boundary tests (0 accepted, negative rejected, fractional rejected), 3 mutation probes fired. Remaining `asId` uses in the validator audited — all genuine ids.

## Locked decisions (operator, 2026-09-16)

1. **Tables: match by `schema.name`, create if missing.** Never duplicate a registry entry for the
   same `schema.name`. Import reports which were matched and which created.
2. **Custom metrics travel; column formatting does NOT.** Metrics are functionally load-bearing —
   widgets reference them by id and break without them. Column display config (labels, number
   formats) is per-table and shared across dashboards; the target environment's existing choices are
   deliberate and must not be overwritten by an import.
3. **Transport is a JSON file download / upload.** Environments may be network-isolated; a file can
   be reviewed, version-controlled, or attached to a ticket. `multer` is already a server dependency
   with an established upload precedent (v1.16 Phase 81 branding logo, magic-byte validated).
4. **Access grants are excluded**, per the operator's own framing — access "can be different on
   different environments".

## Decisions deferred to research / planning

- **Permissions.** Import creates dashboards and may create table registry entries, so it plausibly
  needs both `dashboards:create` AND `datasets:manage` — both of which already exist. **Strongly
  prefer composing existing permissions over introducing a new one:** this project has a documented
  pattern where adding an RBAC permission breaks count assertions across `rbacDb`, `rbacMigration`,
  web `permissions`, and `RolesPage` specs, and needs `permissionGroups` wiring. Research should
  confirm the right combination and flag the ripple if a new permission proves unavoidable.
- **What else must travel.** `dashboard_layers` (map layers, with `table_id` soft FK and their own
  config JSON) and `dashboard_dynamic_views` almost certainly must. `dashboard_table_views` is
  RUNTIME materialized-view state and must NOT. Research must enumerate the full set rather than
  assume this list is complete.
- **Format versioning.** An export file outlives the code that wrote it. Research should recommend a
  schema version field and what import does when it does not recognise one.

## Future Requirements

Acknowledged, deliberately not in v1.24.

- **DXIM-F1**: Bulk export/import of multiple dashboards in one file
- **DXIM-F2**: Server-to-server migration without a file round-trip
- **DXIM-F3**: Export including access grants, for same-environment cloning
- **DXIM-F4**: Dry-run / preview showing what an import would change before applying it
- **DXIM-F5**: Re-import over an existing dashboard (update in place rather than always creating new)

## Carried Tech Debt (still open)

| ID | Item |
|----|------|
| **TD-V123-THEMEGUARD-HOLE** | `theme-guard.spec.ts` allowlists `global.css` and, for allowlisted files, asserts `hasHex === true` — it NEVER checks absence. Any hardcoded colour there passes every automated gate. Shipped one defect already (Phase 114 `.onboarding-banner`). Narrowing the exemption to `:root` blocks is well-evidenced and unscheduled. |
| **TLINK-F4** | `lib/tableUrl.ts` / `lib/dashboardUrl.ts` and their hooks are THREE parallel implementations. Extract the shared core when a fourth linkable entity appears. |
| **TLINK-F3** | Sidebar "Datasets"/"Dashboards" are no-ops while a record is open. Found Phase 113 UAT, still open. |
| Sync-after-async spec sites | ~105 sites match "sync `getBy*` after `await findBy*`". Most are safe; fix opportunistically, not as a sweep. See `.planning/v123-flake-investigation-notes.md`. |
| Server `TD-V16-TEST-ISOLATION` | The server's permanent known-failing set is attributed to "cross-mode contamination" — an attribution never tested the way the web suite's was in v1.23, where the equivalent turned out to be two one-line async-query defects. **This milestone touches server code heavily; worth re-testing that attribution while there.** |
| OIDC never browser-verified | The `kbi_returnTo` carry has never been observed across a real IdP redirect. Four milestones running. |
| Self-falsifying acceptance criteria | ~28-32 across Phases 115-118, dominant cause: a plan mandating a code comment containing the very token its own grep counts. Planner-side defect. |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migrating the Kinetica DATA itself | Export carries dashboard *definitions*. The underlying `schema.name` tables must already exist in the target cluster; that is a database concern, not a BI-app one. |
| Access grants | Operator decision — access differs per environment (DXIM-V124-08). |
| Column display config | Locked decision 2 — shared per-table state; overwriting it would silently change how OTHER dashboards render in the target. |
| Updating an existing dashboard in place | Deferred as `DXIM-F5`. v1.24 always creates new. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DXIM-V124-01 | Phase 119 | Complete (2026-09-16 operator export; re-verified cross-environment 2026-09-18, Phase 121-04) |
| DXIM-V124-02 | Phase 119 | Complete (2026-09-16 operator export) |
| DXIM-V124-03 | Phase 120 | Complete (operator cross-environment round trip 2026-09-18, Phase 121-04 — two ports, two SQLite files) |
| DXIM-V124-04 | Phase 120 | Complete (automated 2026-09-17) |
| DXIM-V124-05 | Phase 120 | Complete (automated 2026-09-17; reopened + re-closed same day for REF-9 `spatialTargets[].tableId`; one-database fixture — see note below) |
| DXIM-V124-06 | Phase 120 | Complete (automated 2026-09-17) |
| DXIM-V124-07 | Phase 120 | Complete (automated 2026-09-17) |
| DXIM-V124-08 | Phase 119 | Complete (2026-09-16 exclusion canaries + operator search) |
| DXIM-V124-09 | Phase 120 | Complete (automated 2026-09-17) |
| DXIM-V124-10 | Phase 120 | **REOPENED 2026-09-18 (Phase 121-04)** — metricConflicts message makes a false claim; see `defect-frozen-config-sql-metric-expression.md` |
| DXIM-V124-11 | Phase 120 | Complete (automated 2026-09-17) |

**Note on Phase 120's closure (recorded here, not smoothed over):** every Phase 120 proof runs
inside ONE database — the armed fixture rewrites `tables[].schema` to force genuine old->new
id maps while staying in one SQLite connection. This proves reference REMAPPING; it does NOT
prove cross-environment PORTABILITY, which is Phase 121's operator round-trip between two real
environments. REF-2 (`dynamicViewId`), REF-4 (scalar `metricId`) and REF-5 (`metrics[].metricId`)
have NEVER been exercised outside a fixture — the operator's Phase 119 export contained no dynamic
views and no custom metrics. **Phase 121 must ask the operator to build a dashboard using a custom
metric AND a dynamic view before the cross-environment round trip**, or those three reference kinds
will still never have run outside a test.

**Coverage:**
- v1.24 requirements: 11 total
- Mapped to phases: 11 (Phases 119-121; -01/-03/-10 also exercised by Phase 121's UI + round-trip)
