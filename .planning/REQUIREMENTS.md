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

- [ ] **SSYNC-V125-01**: From the Datasets page, an operator can check a single registered table for schema changes against live Kinetica, on demand — no background polling and no added round-trip on dashboard load
- [x] **SSYNC-V125-02**: The check reports every column that exists in Kinetica but not in the app's snapshot (added), every column in the snapshot but no longer in Kinetica (removed), and every column whose Kinetica data type no longer matches the stored type (retyped) — automated 2026-09-21 (Phase 122). `parseColumnFingerprints` builds a per-column fingerprint combining the Avro base type from `type_schemas` with the width/temporal refinements from `properties` — the live spike proved neither source alone suffices; `diffColumnFingerprints` returns `added`/`removed`/`retyped` with both stored and live type on retypes. Precise enough for `int`->`double` AND `varchar(8)`->`varchar(32)`, the operator's two stated cases.
- [x] **SSYNC-V125-03**: When the table itself is no longer found in Kinetica, the operator is told the table is missing — reported distinctly from a column diff, and stated so it covers both a deleted table and one renamed in Kinetica, which are indistinguishable from outside — automated 2026-09-21 (Phase 122). `/show/table` is called with `no_error_if_not_exists: "true"`; the authoritative signal is an empty `table_names` on an HTTP 200/`status:OK` response, which a connection failure structurally cannot produce (it throws before any outcome is built and surfaces as 502 via `errorMiddleware`). `tableMissingResult` omits the diff-group keys entirely rather than emptying them. Wording covers a deleted table and one renamed in Kinetica, which are indistinguishable from outside.
- [x] **SSYNC-V125-04**: A renamed column is reported as one removal plus one addition; the app never guesses that two columns are the same column — automated 2026-09-21 (Phase 122). A renamed column returns as one removal plus one addition. Enforced by a forbidden-token test and mutation probe M6; zero hits tree-wide for `possibleRename`/`similarity`/`levenshtein`/`ordinal_position`/`pairRename`. `ORDINAL_POSITION` is available from Kinetica and is deliberately unused — it is positional, not identity.
- [x] **SSYNC-V125-05**: Running a check changes nothing — no stored schema, no widget, no layer, no metric — until the operator explicitly applies it — automated 2026-09-21 (Phase 122). The route performs no write, and no writer for `columns_fingerprint` exists anywhere in the tree (Phase 125 adds the first). Proven by a byte-identical row-snapshot over `tables`, `widgets`, `dashboard_layers`, `custom_metrics` and `column_display_config` across all three 200 outcomes — with all five seeded and each asserted non-empty before comparison, because on a fresh `:memory:` DB an unseeded table compares equal to itself and proves nothing (caught by the plan checker pre-execution). Mutation probe M6 inserts an `updateTable` and reddens it.

### Impact report

- [ ] **SSYNC-V125-06**: Before applying, the operator sees every widget that references a removed or retyped column through a structured config field, named by widget title and dashboard
- [x] **SSYNC-V125-07**: The report includes map layers affected through their own config (lat/lon/WKT columns, `cb_config.attr`, `track_config`) **and** through the `configPatch` copies embedded in radio-group widget actions, which are separate records that override the layer at click time — automated 2026-09-23 (Phase 123). `resolveConfigPatchTableId` walks both the plural `options[].actions[]` and legacy singular `options[].action` shapes; each `configPatch` finding is owned by the radio-group widget but scoped to the TARGET record's table, distinct from the layer's own matching finding. All 12 real dev-DB copies (11 `cb_config` + 1 `track_config`) reconcile. Proven by the 40/40 coverage guard (`packages/server/tests/lib.columnRefs.spec.ts`, "site coverage — criterion 1") and a deliberate-deletion probe.
- [x] **SSYNC-V125-08**: The report lists every custom metric, widget `customWhere`, frozen widget `sql` and dynamic-view `template_sql` whose raw SQL may reference an affected column, marked as *possibly* affected rather than confirmed — automated 2026-09-23 (Phase 123). All five `FREE_SQL_SITES` are scanned with the locked whole-identifier, case-insensitive, literal-skipping regex, each carrying `confidence: "heuristic"` or `"low-confidence"` and `tableScope: "free-sql"` (never a table claim). Proven by `packages/server/src/lib/columnRefs.ts`'s `scanFreeSql`/`emitFreeSql` and their dedicated tests.
- [ ] **SSYNC-V125-09**: The report distinguishes references the app resolved exactly (structured fields) from references it matched heuristically in free SQL, so the operator knows which findings are certain
- [ ] **SSYNC-V125-10**: The report lists every column-formatting rule (`column_display_config`) bound to a removed or renamed column — the case that today degrades silently, with no error anywhere
- [ ] **SSYNC-V125-11**: Added columns are presented separately from breaking changes, since they break nothing and only need to become selectable in config panels
- [ ] **SSYNC-V125-12**: A retyped column's report states the old and new type and flags that widgets carrying a frozen `drillDownColumnType` will keep filtering with the stale type until reconfigured

### Applying

- [ ] **SSYNC-V125-13**: The operator can apply the refreshed schema, after which config panels offer the current Kinetica columns
- [ ] **SSYNC-V125-14**: Applying updates only the table's stored schema — no widget, layer, custom metric or formatting rule is rewritten
- [ ] **SSYNC-V125-15**: Applying is never blocked by a breaking change; the operator decides with the report in front of them

### Sync history

- [ ] **SSYNC-V125-16**: Each applied sync is recorded per table and remains available afterwards, so the operator has a durable worklist while fixing dashboards instead of a modal they must screenshot
- [ ] **SSYNC-V125-17**: A history entry records when the sync ran, what changed, and what the impact report said at that time
- [ ] **SSYNC-V125-18**: An operator can view a table's sync history from Datasets and clear entries they have finished acting on

### Access

- [ ] **SSYNC-V125-19**: Checking, applying and clearing history require the same permission that governs dataset management today; a user without it cannot reach them in the UI or through the API

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
| SSYNC-V125-01 | Phase 126 — Datasets UI, Access Gating & Operator Verification | Pending |
| SSYNC-V125-02 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-03 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-04 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-05 | Phase 122 — Schema Diff & Table-Missing Detection | Complete (automated 2026-09-21) |
| SSYNC-V125-06 | Phase 124 — Impact Report | Pending |
| SSYNC-V125-07 | Phase 123 — Column Reference Enumeration | Complete |
| SSYNC-V125-08 | Phase 123 — Column Reference Enumeration | Complete |
| SSYNC-V125-09 | Phase 124 — Impact Report | Pending |
| SSYNC-V125-10 | Phase 124 — Impact Report | Pending |
| SSYNC-V125-11 | Phase 124 — Impact Report | Pending |
| SSYNC-V125-12 | Phase 124 — Impact Report | Pending |
| SSYNC-V125-13 | Phase 125 — Apply & Sync History | Pending |
| SSYNC-V125-14 | Phase 125 — Apply & Sync History | Pending |
| SSYNC-V125-15 | Phase 125 — Apply & Sync History | Pending |
| SSYNC-V125-16 | Phase 125 — Apply & Sync History | Pending |
| SSYNC-V125-17 | Phase 125 — Apply & Sync History | Pending |
| SSYNC-V125-18 | Phase 126 — Datasets UI, Access Gating & Operator Verification | Pending |
| SSYNC-V125-19 | Phase 126 — Datasets UI, Access Gating & Operator Verification | Pending |

**Coverage:**
- v1.25 requirements: 19 total
- Mapped to phases: 19 ✓
- Unmapped: 0
- **Complete: 4** (SSYNC-V125-02/-03/-04/-05, Phase 122, 2026-09-21)
- Every requirement maps to exactly one phase; no requirement appears in two phases.

**Per-phase counts:** Phase 122 → 4 (`-02`, `-03`, `-04`, `-05`) · Phase 123 → 2 (`-07`, `-08`) · Phase 124 → 5 (`-06`, `-09`, `-10`, `-11`, `-12`) · Phase 125 → 5 (`-13`, `-14`, `-15`, `-16`, `-17`) · Phase 126 → 3 (`-01`, `-18`, `-19`). 4+2+5+5+3 = 19.

---
*Requirements defined: 2026-09-21 · Traceability populated at roadmap creation: 2026-09-21 (Phases 122-126)*
