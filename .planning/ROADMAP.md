# Roadmap

> **Shipped milestones (v1.0–v1.10):** details collapsed to `milestones/` per the complete-milestone pattern. See `MILESTONES.md` and `milestones/v1.*-ROADMAP.md` for the archived phase-by-phase records (Phases 1–57).

## Milestones

- ✅ **v1.0 Authentication & Per-User Access** — Phases 1-3 (shipped 2026-04-29) — see `milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 OIDC SSO Support** — Phases 4-8 (shipped 2026-05-02) — see `milestones/v1.1-ROADMAP.md`
- ✅ **v1.2 Interactive Dashboards** — Phases 9-12 (shipped 2026-05-06) — see `milestones/v1.2-ROADMAP.md`
- ✅ **v1.3 Unified Dashboard Filtering** — Phases 13-17 (shipped 2026-05-07) — see `milestones/v1.3-ROADMAP.md`
- ✅ **v1.4 Map Info Popup** — Phases 18-24 (shipped 2026-05-11) — see `milestones/v1.4-ROADMAP.md`
- ✅ **v1.5 Spatial filtering on map** — Phases 25-31 (shipped 2026-05-14) — see `milestones/v1.5-ROADMAP.md`
- ✅ **v1.6 Dynamic Views** — Phases 32-36 (shipped 2026-05-19) — see `milestones/v1.6-ROADMAP.md`
- ✅ **v1.7 WMS Class Break, Track & Legend** — Phases 37-45 (shipped 2026-06-05) — see `milestones/v1.7-ROADMAP.md`
- ✅ **v1.8 Roles & Permissions (RBAC)** — Phases 46-51 incl. 50.1-50.3 (shipped 2026-06-06) — see `milestones/v1.8-ROADMAP.md`
- ✅ **v1.9 Better Track Rendering** — Phases 52-54 (shipped 2026-06-08) — see `milestones/v1.9-ROADMAP.md`
- ✅ **v1.10 Per-Dashboard View Permissions** — Phases 55-57 (shipped 2026-06-10) — see `milestones/v1.10-ROADMAP.md`
- ✅ **v1.11 Programmable Widgets (Cross-Widget Control)** — Phases 58-61 incl. 58.1 / 60.1 / 60.2 (shipped 2026-06-15) — see `milestones/v1.11-ROADMAP.md`
- ✅ **v1.12 Drill-Down on Dynamic-View-Backed Widgets** — Phases 62-64 incl. 63.1 (shipped 2026-06-16) — see `milestones/v1.12-ROADMAP.md`
- ✅ **v1.13 Calendar Heatmap Visualization** — Phases 65-69 incl. 68.1 / 68.2 (shipped 2026-06-18) — see `milestones/v1.13-ROADMAP.md`
- ✅ **v1.14 Class-Break & Chart Config Refinements** — Phases 70-73 (shipped 2026-06-19) — see `milestones/v1.14-ROADMAP.md`
- ✅ **v1.15 Column Formatting & View Lifecycle** — Phases 74-79 (shipped 2026-06-22) — see `milestones/v1.15-ROADMAP.md`
- ✅ **v1.16 White-Label Theming** — Phases 80-84 (shipped 2026-06-26) — see `milestones/v1.16-ROADMAP.md`
- ✅ **v1.17 Chart Number Formatting** — Phases 85-87 (shipped 2026-06-27) — see `milestones/v1.17-ROADMAP.md`
- ✅ **v1.18 Per-Visualization Filter Selection** — Phases 88-96 incl. 93.5 (shipped 2026-06-30) — see `milestones/v1.18-ROADMAP.md`
- ✅ **v1.19 Visualization Customization** — Phases 97-104 (shipped 2026-07-08) — see `milestones/v1.19-ROADMAP.md`
- ✅ **v1.20 Filter Panel** — Phases 105-110 incl. 109.1 / 109.2 (shipped 2026-08-27) — see `milestones/v1.20-ROADMAP.md`
- ✅ **v1.21 Dashboard Links & Map Default View** — Phases 111-116 (shipped 2026-09-14) — see `milestones/v1.21-ROADMAP.md`
- ✅ **v1.22 Dashboard Settings Links** — Phase 117 (shipped 2026-09-15) — see `milestones/v1.22-ROADMAP.md`

- ✅ **v1.23 Zoom-Aware Layer Legend** — Phase 118 (shipped 2026-09-16) — see `milestones/v1.23-ROADMAP.md`

- ✅ **v1.24 Dashboard Export & Import** — Phases 119-121 (shipped 2026-09-21) — see `milestones/v1.24-ROADMAP.md`

- 🚧 **v1.25 Schema Sync** — Phases 122-126 (in progress)

---

## 🚧 v1.25 Schema Sync (In Progress)

**Milestone Goal:** An operator can re-sync a registered table's schema with the live Kinetica table, and see exactly what the change breaks before deciding to apply it. Detect and report only — the app never rewrites a widget, layer, metric or format rule.

**Why there is no refresh path to extend.** `tables.columns` is a single TEXT column holding a flat `Record<columnName, kineticaType>` (`db.ts:23-31`), written exactly once at registration (`index.ts:2432`, `:2438`, `dashboardImport.ts:356`). No refresh path exists anywhere in the codebase; this milestone builds the first one. Live discovery, by contrast, already exists and is the one place Kinetica column metadata is read — `GET /api/kinetica/schemas/:schema/tables/:table/columns` (`index.ts:2583-2619`, `INFORMATION_SCHEMA.COLUMNS` + `/show/table` temporal enrichment via `lib/showTableTypes.ts`). Reuse it; a second discovery path is a defect, not a feature.

**Why reference enumeration is the load-bearing piece.** ~240 column-reference sites across ~110 records in a 7-dashboard dev DB. ~170 are structured and exactly resolvable; ~70 are free SQL and heuristic-only (warn-only by locked decision, permanently). Twelve of the structured ones — 11 `cb_config` + 1 `track_config` — live inside `widgets.config.options[].actions[].configPatch` as JSON-in-JSON (`actionAllowList.ts:101-151`) and override the layer at click time, so a scan of `dashboard_layers` alone misses all twelve. That is v1.24's REF-9 miss-class repeating, and `SSYNC-V125-07` exists precisely for it.

**Architecture note, assessed 2026-09-21.** `dashboardExportRefs.ts`'s one-traversal-two-directions discipline is the right *pattern* but the wrong *module* to extend: `asId` — its whole safety model — has no analogue for strings (widget configs are full of strings that are not columns: `colormap:"viridis"`, `pointShape`, hex colours), so identification must be path-driven, which is strictly more fragile; and column refs are TABLE-SCOPED (a widget binds via `config.tableId` OR `config.dynamicViewId`, and `spatialTargets[]` elements carry their own `tableId`) where id refs are global. Build a sibling `lib/columnRefs.ts` in the same house style, cross-referenced in comments, and leave the export/import path — currently correct — undisturbed.

**Sequential by design.** Each phase consumes the one before it. v1.24's phases were sequential and that worked; no parallelism is invented here.

## Phases

- [ ] **Phase 122: Schema Diff & Table-Missing Detection** - The app can ask live Kinetica what a registered table looks like now and report how it differs, changing nothing
- [ ] **Phase 123: Column Reference Enumeration** - One traversal that finds every place a column name is referenced, structured sites exactly and free SQL heuristically
- [ ] **Phase 124: Impact Report** - A check returns a report naming the widgets, layers, metrics and format rules an operator has to fix
- [ ] **Phase 125: Apply & Sync History** - The refreshed snapshot is stored on confirmation and the changeset persists as a durable worklist
- [ ] **Phase 126: Datasets UI, Access Gating & Operator Verification** - The whole flow driven from Datasets, permission-gated, and run against a real Kinetica table by the operator

## Phase Details

### Phase 122: Schema Diff & Table-Missing Detection
**Goal**: For one registered table, the app can read the live Kinetica column set on demand and report exactly how it differs from the stored snapshot — added, removed, retyped, or the table gone entirely — without writing anything.
**Depends on**: Nothing
**Requirements**: SSYNC-V125-02, SSYNC-V125-03, SSYNC-V125-04, SSYNC-V125-05
**Canonical refs**: `packages/server/src/index.ts:2583-2619` (the existing live-discovery route), `packages/server/src/lib/showTableTypes.ts`, `packages/server/src/db.ts:23-31` (`tables.columns`), `db.ts:118-131` + `:907-922` (dynamic views' prior-art re-read-and-re-store contract)
**Success Criteria** (what must be TRUE):
  1. Checking a registered table whose live Kinetica columns have changed returns three distinct groups — added, removed, retyped — with the retyped entries naming both the stored type and the live type.
  2. Checking a table Kinetica no longer has returns a distinct table-missing outcome, not a diff that reports every column as removed, and its wording covers both a deleted table and one renamed in Kinetica.
  3. A column renamed in Kinetica comes back as one removal plus one addition; no pairing, similarity score or guessed rename appears anywhere in the response.
  4. Running a check leaves the database unchanged — a before/after row snapshot of `tables`, `widgets`, `dashboard_layers`, `custom_metrics` and `column_display_config` is identical.
  5. Live column discovery goes through the existing `INFORMATION_SCHEMA` + `/show/table` path; no second query of Kinetica column metadata is introduced.
**Plans**: 4 plans, 3 waves
- [ ] 122-01-PLAN.md — Pure `/show/table` fingerprint parser (type_schemas base + properties width) + `kineticaShowTable` per-call options (wave 1)
- [ ] 122-02-PLAN.md — `tables.columns_fingerprint` sibling column + read-only accessor; no writer ships in 122 (wave 1)
- [ ] 122-03-PLAN.md — Pure diff engine + the `SchemaCheckResult` contract Phases 124/125 read (wave 2)
- [ ] 122-04-PLAN.md — `GET /api/tables/:id/schema-check` route + four-outcome and byte-identical-DB proof (wave 3)

### Phase 123: Column Reference Enumeration
**Goal**: A single pure traversal answers "what in this app refers to column X of table Y", covering every structured site exactly and every free-SQL site heuristically, with each finding carrying which of the two it was.
**Depends on**: Phase 122 (consumes its changeset shape)
**Requirements**: SSYNC-V125-07, SSYNC-V125-08
**Research flag**: HIGHEST-RISK phase of the milestone. This is where the REF-9 miss-class recurs — a forgotten site produces a report that is confidently incomplete, and a report that silently omits an affected widget is worse than no report, because the operator acts on it. Per-site coverage must be exhaustive and each site must have a test that fails if that site is removed from the traversal.
**Canonical refs**: `packages/server/src/lib/dashboardExportRefs.ts` (the pattern to inherit, not the module to extend), `packages/server/src/lib/actionAllowList.ts:101-151` (`configPatch` allow-list), `packages/web/src/lib/columnTypes.ts` (`normalizeType`, `NUMERIC_TYPES`/`INTEGER_TYPES`/`DATETIME_TYPES`)
**Success Criteria** (what must be TRUE):
  1. Given a table and a column name, the traversal returns every structured reference site in the inventory — widget config `metricColumn`, `groupByColumn`, `groupByColumns[]`, `drillDownColumn`, `timeCol`, `xField`, `deltaField`, `sortField`, the comma-separated `columns` string, `metrics[].column`, `filterFields[].column`, `spatialTargets[]` lon/lat/spatial columns; layer `latColumn`/`lonColumn`/`wktColumn`/`wkbColumn`, `cb_config.attr`, `track_config` (`trackIdAttr`/`trackOrderAttr`/`xCol`/`yCol`), `info_columns`, `info_template` `{column}` placeholders; and `column_display_config.column_name` — each covered by a test that fails if that site is deleted from the traversal.
  2. A `cb_config` or `track_config` embedded in a radio-group widget's `options[].actions[].configPatch` is returned as its own finding, distinct from the layer it patches, so the twelve dev-DB copies a `dashboard_layers`-only scan misses are all found.
  3. Free-SQL sites (`widgets.config.sql`, `config.customWhere`, `custom_metrics.expression`, `dashboard_dynamic_views.template_sql`, `dashboard_table_views.filter_clause`) produce findings marked heuristic rather than exact, and the traversal never rewrites free SQL text.
  4. Findings are table-scoped: a widget bound through `config.dynamicViewId` and a `spatialTargets[]` entry carrying its own `tableId` resolve against the right table, so a same-named column belonging to a different table yields no finding.
  5. `dashboardExportRefs.ts` and the export/import behaviour it drives are unchanged (zero diff to that module), and `columnRefs.ts` carries a comment cross-referencing it so the one-enumeration discipline is visibly inherited rather than re-derived.
**Plans**: TBD

### Phase 124: Impact Report
**Goal**: A check returns a report the operator can act on — every affected widget, layer, metric and format rule named in their own terms, breaking changes separated from harmless ones, and certainty stated rather than implied.
**Depends on**: Phases 122 and 123
**Requirements**: SSYNC-V125-06, SSYNC-V125-09, SSYNC-V125-10, SSYNC-V125-11, SSYNC-V125-12
**Canonical refs**: `packages/web/src/components/ChartConfigPanel.tsx:1063-1065` (where `drillDownColumnType` is frozen at save time, 69 widget configs), `packages/web/src/stores/columnDisplayConfigStore.ts:151-161` (the silent formatting fallback)
**Success Criteria** (what must be TRUE):
  1. A check on a table with a removed or retyped column returns each affected widget identified by its title and its dashboard's name — not by id — alongside the affected map layers.
  2. Every `column_display_config` rule bound to an affected column appears in the report; the case that today degrades with no error anywhere is now stated explicitly.
  3. Added columns appear in their own section and no added column appears among the breaking findings.
  4. A retyped column's entry states the stored type and the live type, and separately flags every widget whose config carries a frozen `drillDownColumnType` for that column, saying those widgets keep filtering with the stale type until reconfigured.
  5. Exactly-resolved findings and heuristic free-SQL findings are distinguishable in the report, and the free-SQL ones are worded as *possibly* affected rather than confirmed.
**Plans**: TBD

### Phase 125: Apply & Sync History
**Goal**: On explicit confirmation the stored snapshot is replaced with the live Kinetica column set and nothing else is touched, and the changeset plus the report survive as a durable per-table worklist.
**Depends on**: Phases 122 and 124 (applies the changeset; records the report as it stood)
**Requirements**: SSYNC-V125-13, SSYNC-V125-14, SSYNC-V125-15, SSYNC-V125-16, SSYNC-V125-17
**Canonical refs**: `packages/server/src/db.ts` (`SCHEMA_DDL`, and the `CREATE TABLE IF NOT EXISTS` + additive-ALTER migration convention used for `column_display_config` and `custom_metrics`)
**Success Criteria** (what must be TRUE):
  1. After applying, reading the table's metadata returns the live Kinetica columns and types — the stale snapshot is gone.
  2. After applying, every `widgets`, `dashboard_layers`, `custom_metrics` and `column_display_config` row is identical to before; a row snapshot shows only the `tables` row changed.
  3. An apply carrying removals or retypes succeeds; no code path refuses it, demands a force flag, or requires the operator to resolve findings first.
  4. Applying records a history entry for that table holding when it ran, the added/removed/retyped changeset, and the impact report as it stood at that moment; the entry is still readable after a server restart.
  5. A history entry can be deleted on its own, leaving the table's other entries and its stored schema untouched.
**Plans**: TBD

### Phase 126: Datasets UI, Access Gating & Operator Verification
**Goal**: The operator drives check, report, apply and history from the Datasets page, only with the permission that already governs dataset management, and confirms against a real Kinetica table that the report tells the truth.
**Depends on**: Phases 122-125
**Requirements**: SSYNC-V125-01, SSYNC-V125-18, SSYNC-V125-19
**Canonical refs**: `packages/web/src/components/DatasetsPage.tsx` (`:395` is the existing live-columns caller), `packages/web/src/components/RolesPage.tsx` + `RolesPage.css` (closest component to mirror), `packages/web/src/styles/global.css` (`btn-primary btn-sm` / `ghost-sm` inside `ds-actions`, `ds-field`, `ds-select`, `config-group`), `packages/web/src/lib/permissions.ts` (`DATASETS_MANAGE`)
**Success Criteria** (what must be TRUE):
  1. From Datasets, an operator can check one table on demand, read the full impact report in the app, and apply it — built from existing `global.css` utility classes with no hardcoded hex (theme-guard green, and a hand-run rgba/wrong-token audit, since the guard only flags `#hex`).
  2. Loading a dashboard issues no schema-check request and no extra Kinetica round-trip; no polling timer or interval exists anywhere in the feature.
  3. A table's sync history is viewable from Datasets and individual entries can be cleared from there, so the worklist outlives the modal.
  4. A user without `datasets:manage` sees no check, apply or history control in the UI, and the check, apply and clear-history endpoints reject that user.
  5. `checkpoint:human-verify` — the operator alters a real Kinetica table (add, drop, rename, retype a column, and separately drop the table) and confirms the report names the right widgets, layers, metrics and formatting rules and misses none. **Report accuracy against a real database is not provable in jsdom**: the output is a document a human acts on, and the failure mode is a confidently incomplete list, which every automated gate reads as a pass. v1.24's equivalent checkpoint found four defects that `tsc`, `vitest` and `theme-guard` all missed, one of whose signature was a comparison PASSING.
**Plans**: TBD

---

## v1.24 Dashboard Export & Import — SHIPPED 2026-09-21
✅ v1.24 (Phases 119-121) — SHIPPED 2026-09-21 — full phase details archived in `milestones/v1.24-ROADMAP.md`
- [x] Phase 119: Export
- [x] Phase 120: Import
- [x] Phase 121: UI + Cross-Environment Verification
**Verification:** 11/11 DXIM-V124 requirements Complete; web vitest 181 files / 4100 tests / 0 failed, web+server tsc clean, theme-guard 152/152, server `scripts/test-gate.mjs` GATE PASSED (set-based, 8 documented failing files). Operator-verified cross-environment 2026-09-18 and re-verified after the gap closure 2026-09-21, between two server processes with separate SQLite databases (`:4000`/`kinetica.db` and `:4001`/`env-b.db`). First milestone since v1.20 to require server work. Milestone audit graded `tech_debt` (no blockers) — see `milestones/v1.24-MILESTONE-AUDIT.md`.
**Known gaps carried, not smoothed over:** (1) **four defects shipped past `tsc`, `vitest` AND `theme-guard`, all four found by one operator checkpoint** — `config.spatialTargets[].tableId` missing from the reference inventory entirely (an imported map would filter against whatever table held that id, rendering confidently wrong data), `max_records: 0` (the documented UNLIMITED sentinel) rejected at the import boundary so no export with an unlimited dynamic view could be imported anywhere, custom metrics loaded for the wrong table, and `widget.config.sql` freezing the resolved metric expression; (2) **the fourth defect's signature was the side-by-side comparison PASSING** — the frozen SQL guarantees target matches source, so a naive A-vs-B check reads as a clean pass; it surfaced only because the operator noticed the config panel disagreeing with the chart. Root cause confirmed PRE-EXISTING by reproducing it in an environment never imported into, which is why the fix went into the renderer rather than import; (3) **a TENTH, text-valued reference kind existed and nine id-valued sweeps could not see it** — an audit that enumerates id fields is structurally blind to a string; a deliberate re-search found no others, but the lesson generalizes; (4) **phases 119 and 120 have no VERIFICATION.md** — never run through `gsd-verifier`, so 8 of 11 requirements appear in no phase verification report; graded `tech_debt` not `gaps_found` because the evidence was re-verified by hand and Phase 121's live round trip verified their output more stringently, but recorded because "green gates plus confident paperwork" is precisely the state the four defects above hid in; (5) **metadata portability only** — both SPAs ran under Vite (nginx same-origin path unverified) and both servers shared one `KINETICA_URL`; REF-3 (standalone Legend) was not re-exercised, that dashboard having no Legend widget; (6) **`gsd-tools` state/roadmap/phase mutation commands are unusable here, now well-evidenced** — `state begin-phase` and `milestone complete` each silently rewrote STATE.md (status reset to `unknown`, `stopped_at` rewound to a stale Phase 120-02 string, twice, from two different commands) and `verify key-links` cannot parse correctly-nested plan frontmatter; all v1.24 bookkeeping was done by hand; (7) 24 mutation probes across Phase 121 and the gap closure, all firing — two whose FIXTURES had to be strengthened rather than the probes weakened, one of them structurally undiscriminating because `fromSwap` and the new metric swap commute.
**Open tech debt:** `loadConfig(...).catch(() => {})` suspends a widget in `Loading...` forever on a rejected fetch — pre-existing and project-wide, now reachable from seven more widget types, the one item worth scheduling; `defect-dv-combination-filter-view.md` still OPEN (dv + filter COMBINATIONS, a v1.6/v1.18 naming seam); `DXIM-F1`-`F5` deferred.

---

<!-- LAYOUT NOTE (2026-09-11): archived milestones live at the END of this file
     and are NOT wrapped in <details>. Both details matter, and they were
     established empirically after a wrong first fix:
       - WRAPPED in <details>  -> `roadmap update-plan-progress` and `phase
         complete` silently no-op (they only rewrite content after the last
         closing details tag, which the archive was sitting after).
       - Archive moved to the TOP -> that fixed the above but broke
         `init plan-phase`'s phase_req_ids extraction, which returned null and
         would have silently skipped the requirements-coverage gate.
     Unwrapped + at the end is the only arrangement where BOTH work. Verified on
     phases 111/112/113. Keep new archives here, unwrapped.
     Also note: update-plan-progress stamps TODAY's date rather than preserving
     the original, so do not re-run it on an already-complete phase. -->

## v1.20 Filter Panel — SHIPPED 2026-08-27
✅ v1.20 (Phases 105-110 incl. 109.1 / 109.2) — SHIPPED 2026-08-27 — full phase details archived in `milestones/v1.20-ROADMAP.md`
- [x] Phase 105: Reverse-Mapping Pure Lib + Tests
- [x] Phase 106: Display-Mode Persistence
- [x] Phase 107: Panel Shell + Reflow + XOR Switch + Chips
- [x] Phase 108: Applies-To List + On-Canvas Highlight
- [x] Phase 109: Global Clear-All
- [x] Phase 109.1: Filter Scope for Custom-Panel Charts (INSERTED)
- [x] Phase 109.2: Wire Custom-Panel Charts into Filter-Scope Engine and Reverse-Map (INSERTED)
- [x] Phase 110: Designer Settings UI + Verification + Live UAT
**Verification:** 19/19 requirements Complete; both-stack automated gates green (web vitest 154 files / 3439 tests; server SET-BASED ⊆ TD-V16-TEST-ISOLATION); operator UAT PASS on all 8 groups. See `phases/110-*/110-VERIFICATION.md`.

## v1.21 Dashboard Links & Map Default View — SHIPPED 2026-09-14
✅ v1.21 (Phases 111-116) — SHIPPED 2026-09-14 — full phase details archived in `milestones/v1.21-ROADMAP.md`
- [x] Phase 111: Map Default View — Capture & Save
- [x] Phase 112: Map Default View — Apply on Load
- [x] Phase 113: Dashboard URL Sync
- [x] Phase 114: Deep Link Load & Error States
- [x] Phase 115: Deep Link Authentication Flow
- [x] Phase 116: Table Deep Links (added mid-milestone at operator request, partially promoting DLINK-F4)
**Verification:** 20/20 requirements Complete; web vitest 175 files / 3902 tests, web+server tsc clean, theme-guard green; frontend-only (`packages/server` unchanged throughout). See `phases/115-*/115-VERIFICATION.md` + `phases/116-*/116-VERIFICATION.md`.
**Known gaps carried, not smoothed over:** (1) scope was deliberately widened mid-milestone — Table Links (Phase 116) was an operator-added feature, not scope creep that slipped through; (2) Phase 116 criterion 6 was only half met — dashboard behaviour is byte-identical (clause 1 held, independently re-verified) but `lib/tableUrl.ts`/`hooks/useDeepLinkTable.ts` are structural duplicates of their dashboard siblings rather than a shared abstraction (clause 2 not met, deliberately — de-duplicating would have forced import-path edits across 132 tests and broken clause 1; recorded as `TLINK-F4`, graded 22/23 by the verifier for this reason); (3) the OIDC auth path (`kbi_returnTo` carry mechanism) was never browser-verified live in either Phase 115 or 116 UAT — both ran in password mode only, covered by automated tests + mutation probes but not seen working live; (4) TD-02 was audited and amended 2026-09-14 (commit `8847551`) — the claimed credential exposure does not exist in this repository's history, almost certainly describes a predecessor repo.

## v1.22 Dashboard Settings Links — SHIPPED 2026-09-15
✅ v1.22 (Phase 117) — SHIPPED 2026-09-15 — full phase details archived in `milestones/v1.22-ROADMAP.md`
- [x] Phase 117: Dashboard Settings Links
**Verification:** 8/8 DSET-V122 requirements Complete; web vitest 175 files / 3990 tests, web tsc clean, theme-guard 150/150; frontend-only (`packages/server` unchanged throughout, zero new dependency, no router). Operator UAT 23/23 checks PASS (UAT-117-G27, the OIDC half, recorded "not exercised" — password-mode-only instance). See `phases/117-*/117-VERIFICATION.md` + `phases/117-*/117-UAT.md`.
**Known gaps carried, not smoothed over:** (1) **the full test suite is non-deterministic under parallel load** — both the phase closeout and the independent verifier each needed THREE full-suite runs to observe one clean pass, reddening on a DIFFERENT file each time (`DatasetsPage.spec.tsx`, `actionEngine.canary.spec.tsx`, `App.tableDeeplink.spec.tsx`, `DashboardContext.spec.tsx` across the two rounds), with zero diff on disk and every failure clearing in isolation — this is the milestone's most significant finding and the operator has scheduled a dedicated investigation as the v1.23 target, see `deferred-items.md`; (2) `TLINK-F4` was RESOLVED, not deferred again — "keep duplicated" by measurement (the feature already touched all 132 dashboard tests unconditionally; extracting a shared core would additionally have put the table family's 100 tests in play, inside the phase whose highest-stakes requirement is not regressing a live URL) — there are now THREE parallel implementations, carried as a standing cost with an explicit reopening condition (a fourth linkable entity or a dedicated tech-debt phase); (3) two of the phase's own planning documents were wrong and both errors were caught before shipping — RESEARCH proposed unmount-clear timers guarded on id alone (would have wiped the URL one macrotask after every `edit→view` Save; shipped scoped on id AND mode instead), and a plan's audit for the highest-stakes requirement used a bare `git diff` with no revision range (a guard that could not fail — every task commits immediately); (4) TWENTY-ONE toothless acceptance criteria occurred across Phases 115-117 (nine found in Phase 117 alone), from prose-anchored greps, arithmetic errors, case-sensitivity mismatches, and a self-contradicting enumeration — all reported rather than satisfied by bending code, but recorded as a planner-side defect worth fixing at the source; (5) the OIDC path has STILL never been browser-verified, three milestones running (`AUTH_MODE=password` on this instance) — carried forward as open verification debt; (6) 20/20 mutation probes reddened as intended — zero non-firing, the positive counterpart to (4).

## v1.23 Zoom-Aware Layer Legend — SHIPPED 2026-09-16
✅ v1.23 (Phase 118) — SHIPPED 2026-09-16 — full phase details archived in `milestones/v1.23-ROADMAP.md`
- [x] Phase 118: Zoom-Aware Layer Legend
**Verification:** 7/7 ZLGND-V123 requirements Complete; web vitest 176 files / 4025 tests, web tsc clean, theme-guard 150/150; client-only (`packages/server` unchanged throughout, zero new dependency). Operator UAT 8/8 checks PASS — nothing recorded as not-exercised, the first phase in this project's recent history where every check was both runnable and run. See `phases/118-*/118-VERIFICATION.md` + `phases/118-*/118-UAT.md`.
**Known gaps carried, not smoothed over:** (1) a pre-existing SHIPPED bug was found and fixed — `MapChartRenderer.tsx`'s info-click gate (`isLayerVisibleAtCurrentZoom`) re-implemented the zoom-range check with raw inclusive bounds, diverging from what OpenLayers actually draws, so a layer visibly on the map at a fractional zoom just below its `minZoom` silently swallowed info-clicks; put in scope by explicit operator decision (overriding the researcher's "log as tech debt" recommendation) and fixed — there is now exactly ONE zoom predicate (`lib/zoomRangeBounds.ts`), confirmed by independent grep that no third implementation survives; (2) theme-guard's wholesale `global.css` hex-scan exemption was confirmed structurally, not just suspected — the guard only ever asserts hex IS present for allowlisted files, never that it is absent, so any hardcoded colour there passes every automated gate unconditionally; compensated this milestone with a hand-run hex+rgba audit (run three times independently — executor, orchestrator, verifier — all 0) plus separate light/dark operator checks; narrowing the exemption to `:root` blocks remains unscheduled and is now a well-evidenced candidate; (3) ~7 self-falsifying acceptance criteria occurred in this phase alone (3 caught before execution, 4 during) — running total across Phases 115-118 is roughly 28-32, the dominant cause being a plan mandating a code comment containing the very token its own grep counts — recorded as a planner-side defect worth fixing at the source, not executor error; (4) the web vitest suite's cross-run non-determinism (carried from v1.22 as `TD-V122-TEST-FLAKE`) was root-caused and fixed this milestone — TWO one-line async-query defects (RTL's unconfigured 1000ms `asyncUtilTimeout` vs vitest's 5000ms `testTimeout`, and one sync-`getBy*`-after-`await findBy*` site), not "cross-mode contamination" as first assumed — fixed in `cde63ae`; before: 0 of 4 full-suite runs clean, after: 4 of 4, and every Phase 118 verification passed on the first attempt with no re-runs; the server's `TD-V16-TEST-ISOLATION` set-based gate carries the same "contamination" attribution, never tested this way — worth re-examining before continuing to trust it; (5) the OIDC path has STILL never been browser-verified, four milestones running.
