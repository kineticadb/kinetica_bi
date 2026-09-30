# Requirements: Kinetica BI — v1.25 Schema Sync

**Defined:** 2026-09-21
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

## Why this milestone exists

`tables.columns` is written exactly once — at registration, from the New Dataset form — and never
again (`db.ts:23-31`; the only writers are `index.ts:2432`, `:2438`, `dashboardImport.ts:356`). No
refresh path exists anywhere in the codebase. When Kinetica changes underneath, the app never
learns: config panels offer stale column lists, widgets query columns that no longer exist, and
`column_display_config` quietly stops applying labels and number formats with no error at all.

**This milestone detects and reports. It does not repair.** Roughly 170 of ~240 column-reference
sites in a 7-dashboard dev DB are structured and *could* be rewritten mechanically; that is
deliberately deferred until the reporting half is proven in the operator's hands.

## v1.25 Requirements

### Detection

- [x] **SSYNC-V125-01**: From the Datasets page, an operator can check a single registered table for schema changes against live Kinetica, on demand — no background polling and no added round-trip on dashboard load — verified 2026-09-30 (Phase 126 Plans 01, 02, 04, 05). The `Schema sync` entry point sits in `TableDetail`'s actions bar (placement ruled on at UAT-126-G9). The check runs only on click: `NOPOLL-check-on-click`, `NOPOLL-no-check-on-mount`, `NOPOLL-datasets-page`, with no `setInterval` anywhere in the feature. `checkTableSchema` is called from `api/client.ts` and `SchemaSyncModal.tsx` only — no dashboard-load path. Live against real Kinetica: UAT-126-G1 to G4 (added, dropped, renamed, retyped) and G5 (whole table dropped) all PASS.
- [x] **SSYNC-V125-02**: The check reports every column that exists in Kinetica but not in the app's snapshot (added), every column in the snapshot but no longer in Kinetica (removed), and every column whose Kinetica data type no longer matches the stored type (retyped) — automated 2026-09-21 (Phase 122). `parseColumnFingerprints` builds a per-column fingerprint combining the Avro base type from `type_schemas` with the width/temporal refinements from `properties` — the live spike proved neither source alone suffices; `diffColumnFingerprints` returns `added`/`removed`/`retyped` with both stored and live type on retypes. Precise enough for `int`->`double` AND `varchar(8)`->`varchar(32)`, the operator's two stated cases.
- [x] **SSYNC-V125-03**: When the table itself is no longer found in Kinetica, the operator is told the table is missing — reported distinctly from a column diff, and stated so it covers both a deleted table and one renamed in Kinetica, which are indistinguishable from outside — automated 2026-09-21 (Phase 122). `/show/table` is called with `no_error_if_not_exists: "true"`; the authoritative signal is an empty `table_names` on an HTTP 200/`status:OK` response, which a connection failure structurally cannot produce (it throws before any outcome is built and surfaces as 502 via `errorMiddleware`). `tableMissingResult` omits the diff-group keys entirely rather than emptying them. Wording covers a deleted table and one renamed in Kinetica, which are indistinguishable from outside.
- [x] **SSYNC-V125-04**: A renamed column is reported as one removal plus one addition; the app never guesses that two columns are the same column — automated 2026-09-21 (Phase 122). A renamed column returns as one removal plus one addition. Enforced by a forbidden-token test and mutation probe M6; zero hits tree-wide for `possibleRename`/`similarity`/`levenshtein`/`ordinal_position`/`pairRename`. `ORDINAL_POSITION` is available from Kinetica and is deliberately unused — it is positional, not identity.
- [x] **SSYNC-V125-05**: Running a check changes nothing — no stored schema, no widget, no layer, no metric — until the operator explicitly applies it — automated 2026-09-21 (Phase 122). The route performs no write, and no writer for `columns_fingerprint` exists anywhere in the tree (Phase 125 adds the first). Proven by a byte-identical row-snapshot over `tables`, `widgets`, `dashboard_layers`, `custom_metrics` and `column_display_config` across all three 200 outcomes — with all five seeded and each asserted non-empty before comparison, because on a fresh `:memory:` DB an unseeded table compares equal to itself and proves nothing (caught by the plan checker pre-execution). Mutation probe M6 inserts an `updateTable` and reddens it.

### Impact report

- [x] **SSYNC-V125-06**: Before applying, the operator sees every widget that references a removed or retyped column through a structured config field, named by widget title and dashboard — automated 2026-09-24 (Phase 124 Plan 04). `GET /api/tables/:id/schema-check` attaches `buildImpactReport`'s output to the `"diff"` outcome, reading `loadColumnRefsInput`'s four table-wide, all-dashboards SELECTs. Proven end-to-end by `routes.schema-check.spec.ts`'s `"IMPACT: a widget on a SECOND dashboard referencing the removed column still appears in the report"` (a per-dashboard loader would fail it) and `"IMPACT: a removed column returns a breaking section naming the affected widget by title and dashboard"` (asserts the actual dashboard name, not the id-fallback phrasing).
- [x] **SSYNC-V125-07**: The report includes map layers affected through their own config (lat/lon/WKT columns, `cb_config.attr`, `track_config`) **and** through the `configPatch` copies embedded in radio-group widget actions, which are separate records that override the layer at click time — automated 2026-09-23 (Phase 123). `resolveConfigPatchTableId` walks both the plural `options[].actions[]` and legacy singular `options[].action` shapes; each `configPatch` finding is owned by the radio-group widget but scoped to the TARGET record's table, distinct from the layer's own matching finding. All 12 real dev-DB copies (11 `cb_config` + 1 `track_config`) reconcile. Proven by the 40/40 coverage guard (`packages/server/tests/lib.columnRefs.spec.ts`, "site coverage — criterion 1") and a deliberate-deletion probe.
- [x] **SSYNC-V125-08**: The report lists every custom metric, widget `customWhere`, frozen widget `sql` and dynamic-view `template_sql` whose raw SQL may reference an affected column, marked as *possibly* affected rather than confirmed — automated 2026-09-23 (Phase 123). All five `FREE_SQL_SITES` are scanned with the locked whole-identifier, case-insensitive, literal-skipping regex, each carrying `confidence: "heuristic"` or `"low-confidence"` and `tableScope: "free-sql"` (never a table claim). Proven by `packages/server/src/lib/columnRefs.ts`'s `scanFreeSql`/`emitFreeSql` and their dedicated tests.
- [x] **SSYNC-V125-09**: The report distinguishes references the app resolved exactly (structured fields) from references it matched heuristically in free SQL, so the operator knows which findings are certain — automated 2026-09-24 (Phase 124 Plan 03, wired live by Plan 04). `certaintyProse` renders "confirmed" only for `exact` confidence and "possibly affected" for `heuristic`/`low-confidence`, verbatim in the wire response.
- [x] **SSYNC-V125-10**: The report lists every column-formatting rule (`column_display_config`) bound to a removed or renamed column — the case that today degrades silently, with no error anywhere — automated 2026-09-24 (Phase 124 Plan 03, wired live by Plan 04). Closed by an EXISTING Phase 123 site (`columnDisplayConfig.column_name`, one of the 40 sites `collectColumnRefs` already enumerated) plus new tests — no new traversal was written. `loadColumnRefsInput` reuses the existing `listColumnDisplayConfig` accessor unchanged.
- [x] **SSYNC-V125-11**: Added columns are presented separately from breaking changes, since they break nothing and only need to become selectable in config panels — automated 2026-09-24 (Phase 124 Plan 03, wired live by Plan 04). Added columns are never ref-walked (`walkedColumns` excludes `check.added`), always land in the `harmless` section with `records: []`, and are proven absent from `breaking`/`changed` by `"IMPACT: an added column appears only in the harmless section"`.
- [x] **SSYNC-V125-12**: A retyped column's report states the old and new type and flags that widgets carrying a frozen `drillDownColumnType` will keep filtering with the stale type until reconfigured — automated 2026-09-24 (Phase 124 Plan 03, wired live by Plan 04). `ImpactColumn.storedType`/`.liveType` carry both rendered types; `staleDrillDownFor` flags a widget's frozen `drillDownColumnType` only under a BREAKING retype, proven live by `"IMPACT: a retyped column's entry states the stored type and the live type"`.

### Applying

- [x] **SSYNC-V125-13**: The operator can apply the refreshed schema, after which config panels offer the current Kinetica columns — automated 2026-09-25 (Phase 125 Plan 04). `POST /api/tables/:id/schema-apply` re-reads Kinetica once and calls `applySchemaSync`, which replaces `tables.columns` and `tables.columns_fingerprint` in one `db.transaction`. `renderColumnsMap` writes the `tables.columns` vocabulary the config panels classify with (a temporal column stores as `timestamp`, not `long(timestamp)`), so the panels offer the live columns rather than flattening every temporal column to a number. Proven end-to-end by `routes.schema-apply.spec.ts`'s `PERSIST-diff`, which applies and then re-runs `GET /api/tables/:id/schema-check` on the SAME live body through the app's own read path and asserts `hasChanges: false`.
- [x] **SSYNC-V125-14**: Applying updates only the table's stored schema — no widget, layer, custom metric or formatting rule is rewritten — automated 2026-09-25 (Phase 125 Plan 03, wired live by Plan 04). Proven by `lib.schemaApply.transaction.spec.ts`'s `ONLYTABLES-` tests: a full-ROW snapshot of `widgets`, `dashboard_layers`, `custom_metrics` and `column_display_config`, each asserted non-empty first, PLUS a SQLite `total_changes()` budget of exactly 2 (one `tables` UPDATE, one history INSERT). The budget is what catches a VALUE-IDENTICAL stray write, which no content comparison can see because `db.ts` declares no update triggers.
- [x] **SSYNC-V125-15**: Applying is never blocked by a breaking change; the operator decides with the report in front of them — automated 2026-09-25 (Phase 125 Plans 03 and 04). Enforced by SHAPE, not by a test alone: `applySchemaSync`'s input type has no force/override parameter and its result union has no refusal arm to disable, so there is nothing to pass. `stale` and `table_missing` are the only refusals. Proven by `PERSIST-breaking`, which applies a changeset carrying an addition, a removal AND a retype through the route and gets 200 `applied`, and guarded by a diff-anchored `\bforce\b` criterion on added non-comment lines.

### Sync history

- [x] **SSYNC-V125-16**: Each applied sync is recorded per table and remains available afterwards, so the operator has a durable worklist while fixing dashboards instead of a modal they must screenshot — automated 2026-09-25 (Phase 125 Plans 01 and 04). `table_sync_history` (capped at 20 per table, with the drop count kept in its own `table_sync_history_meta` row so a per-entry delete cannot erase it) reads back through `GET /api/tables/:id/sync-history`, and a single entry deletes through `DELETE /api/tables/:id/sync-history/:entryId`. Both are gated as strictly as the apply. `DELETE-wrong-table` proves the table id in the path is load-bearing, not decorative.
- [x] **SSYNC-V125-17**: A history entry records when the sync ran, what changed, and what the impact report said at that time — automated 2026-09-25 (Phase 125 Plans 01, 03 and 04). Each entry carries `ts`, `actor` (the authenticated username, `rbac_audit`'s precedent), `kind`, the `SyncChangeset` and the `ImpactReport` exactly as it was built — rebuilt server-side from the re-read live map, never accepted from the client. `READ-after-apply` round-trips all five through the route; `PERSIST-actor` proves the actor is the session's own username and not a constant.
- [x] **SSYNC-V125-18**: An operator can view a table's sync history from Datasets and clear entries they have finished acting on — verified 2026-09-30 (Phase 126 Plans 03, 05). The Sync history tab lists timestamp, actor and counts per row, expands to the full changeset plus the impact report as it stood, deletes in one click with no confirm, and shows the cap notice from the server's own `cap` (`HIST-row-summary`, `HIST-expand`, `HIST-delete-no-confirm`, `HIST-cap-notice`, `HIST-cap-notice-absent`). Live: UAT-126-G11 (worklist, PASS after two operator-found font fixes, `c6bd957` and `49a0410`) and G12 (survives a server restart, PASS).

### Access

- [x] **SSYNC-V125-19**: Checking, applying and clearing history require BOTH `datasets:manage` AND `dashboards:manage_access`; a user missing either cannot reach them in the UI or through the API. **AMENDED 2026-09-28 (Phase 126).** As originally written this named ONE permission — the one that governs dataset management — and that stopped being accurate in Phase 124, which added `dashboards:manage_access` to all four schema-sync routes on purpose (`packages/server/src/index.ts:2500-2501`, `:2577-2578`, `:2664-2665`, `:2682-2683`). The reason is structural: the impact report names widgets and dashboards across EVERY dashboard, and `datasets:manage` alone does not govern cross-dashboard visibility — `canViewDashboard` bypasses on `dashboards:manage_access`, a DIFFERENT permission (`packages/server/src/lib/dashboardAccessDb.ts:11`). Phase 126's UI gate mirrors the server's AND exactly, because gating on `datasets:manage` alone would show controls to a user the server then refuses with a 403 — the precise UI/API disagreement ROADMAP criterion 4 exists to prevent. Relaxing the server gate so the original single-permission wording would hold was considered and REJECTED (`126-CONTEXT.md` § Deferred); it reopens the RBAC exposure Phase 124's plan checker found. **Verified 2026-09-30 (Phase 126 Plans 04, 05).** UI half: a four-combination absence gate — `GATE-both`, `GATE-neither`, `GATE-datasets-only`, `GATE-access-only`, each negative case with a render-reached proof, and `GATE-ungated-siblings` proving `Format columns` / `Custom metrics` stay. API half: closed by Phase 125's `GATE-` route tests. A self-sealing gate (a mid-session grant never revealed the hidden button) was found live and fixed in `c6bd957` with one `/me` re-sync on Datasets mount (`RESYNC-grant`, `RESYNC-revoke`, `RESYNC-failure-is-silent`). Live: UAT-126-G13 PASS.

## Future Requirements

Deferred. Tracked, not in this roadmap.

- **SSYNC-F1**: Auto-repair structured references — on an operator-declared rename, rewrite the ~170 mechanically-rewritable sites in one action
- **SSYNC-F2**: Operator-declared rename mapping UI (pair a removal with an addition)
- **SSYNC-F3**: Check all registered tables at once, rather than one at a time
- **SSYNC-F4**: Surface a staleness indicator on dashboards whose widgets are affected, not only in Datasets
- **SSYNC-F5**: Detect nullability changes (`IS_NULLABLE` is never queried today, so this is unobservable without new discovery work)
- **SSYNC-F6**: A server-side column-existence gate — `POST /api/filter/materialize` currently interpolates client-supplied column names into SQL without checking them against stored metadata (`whereClause.ts:14-20` documents a trust boundary `index.ts:1246-1270` does not enforce)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rewriting widget, layer or metric configs | Locked decision: detect and report only. Repair is `SSYNC-F1`, after the reporting half is proven |
| Guessing that a removal + an addition is a rename | Kinetica exposes no stable per-column identifier, so it is undecidable from metadata. The app will not invent a fact |
| Rewriting free SQL (`config.sql`, `customWhere`, metric expressions, `template_sql`) | Column references there are detectable only heuristically. Warn-only, permanently |
| Removing persisted `config.sql` / generating chart SQL at render time | **v1.26.** The root fix for the frozen-SQL defect family, but blocked on threading the table list into `AggregatedWidgetRenderer` (no `tables` prop; the heatmap branch needs `columnTypeMap`). Phase 121 rejected the same refactor because a rebuild would emit an unbucketed heatmap query over the 5000-cell limit on the async-load path. 42 widgets, 7 chart types |
| Background polling or drift detection on dashboard load | Locked decision: manual per-table check only. No added Kinetica round-trip on the hot path |
| Auto-applying a detected change | The operator decides, with the impact report in front of them |
| Syncing anything other than columns (indexes, shard keys, properties, comments) | Not consumed anywhere in the app today |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SSYNC-V125-01 | Phase 126 — Datasets UI, Access Gating & Operator Verification | Complete |
| SSYNC-V125-02 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-03 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-04 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-05 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-06 | Phase 124 — Impact Report | Complete (automated 2026-09-24) |
| SSYNC-V125-07 | Phase 123 — Column Reference Enumeration | Complete |
| SSYNC-V125-08 | Phase 123 — Column Reference Enumeration | Complete |
| SSYNC-V125-09 | Phase 124 — Impact Report | Complete (automated 2026-09-24) |
| SSYNC-V125-10 | Phase 124 — Impact Report | Complete (automated 2026-09-24) |
| SSYNC-V125-11 | Phase 124 — Impact Report | Complete (automated 2026-09-24) |
| SSYNC-V125-12 | Phase 124 — Impact Report | Complete (automated 2026-09-24) |
| SSYNC-V125-13 | Phase 125 — Apply & Sync History | Complete |
| SSYNC-V125-14 | Phase 125 — Apply & Sync History | Complete |
| SSYNC-V125-15 | Phase 125 — Apply & Sync History | Complete |
| SSYNC-V125-16 | Phase 125 — Apply & Sync History | Complete |
| SSYNC-V125-17 | Phase 125 — Apply & Sync History | Complete |
| SSYNC-V125-18 | Phase 126 — Datasets UI, Access Gating & Operator Verification | Complete |
| SSYNC-V125-19 | Phase 126 — Datasets UI, Access Gating & Operator Verification | Complete |

**Coverage:**
- v1.25 requirements: 19 total
- Mapped to phases: 19 ✓
- Unmapped: 0
- **Complete: 16** (SSYNC-V125-02/-03/-04/-05, Phase 122, 2026-09-21; SSYNC-V125-07/-08, Phase 123, 2026-09-23; SSYNC-V125-06/-09/-10/-11/-12, Phase 124, 2026-09-24; SSYNC-V125-13/-14/-15/-16/-17, Phase 125, 2026-09-25)
- Every requirement maps to exactly one phase; no requirement appears in two phases.

**Per-phase counts:** Phase 122 → 4 (`-02`, `-03`, `-04`, `-05`) · Phase 123 → 2 (`-07`, `-08`) · Phase 124 → 5 (`-06`, `-09`, `-10`, `-11`, `-12`) · Phase 125 → 5 (`-13`, `-14`, `-15`, `-16`, `-17`) · Phase 126 → 3 (`-01`, `-18`, `-19`). 4+2+5+5+3 = 19.

---
*Requirements defined: 2026-09-21 · Traceability populated at roadmap creation: 2026-09-21 (Phases 122-126)*
