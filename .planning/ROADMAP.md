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

- 🚧 **v1.24 Dashboard Export & Import** — Phases 119-121 (in progress)

---

## 🚧 v1.24 Dashboard Export & Import (In Progress)

**Milestone Goal:** A dashboard, with all its visualizations, can be exported to a JSON file and imported into another environment — getting fresh ids, matching tables by `schema.name`, and carrying the custom metrics its widgets depend on.

**Why the id remapping is the hard part.** Three reference kinds live INSIDE serialized JSON config, not in FK columns: `widgets.config.tableId`, `widgets.config.sourceMapWidgetId` (widget→widget, the standalone Legend binding), and widget→`custom_metrics.id`. A widget that keeps a stale id does not error — it silently renders the wrong table, the wrong metric, or an unbound legend.

**First milestone since v1.20 to require server work.** v1.21-v1.23 were all frontend-only.

## Phases

- [x] **Phase 119: Export** - A dashboard and its full dependency graph serialize to a versioned JSON file
- [x] **Phase 120: Import** - That file recreates the dashboard elsewhere with fresh ids, every reference remapped, atomically
- [ ] **Phase 121: UI + Cross-Environment Verification** - Download/upload in the app, and an operator round-trip between two environments

## Phase Details

### Phase 119: Export
**Goal**: A dashboard and everything needed to recreate it — widgets, layers, dynamic views, table definitions, and the custom metrics its widgets reference — serialize to a single versioned JSON file, excluding runtime state and access grants.
**Depends on**: Nothing
**Requirements**: DXIM-V124-01, DXIM-V124-02, DXIM-V124-08
**Canonical refs**: `packages/server/src/db.ts` (the schema and its soft-FK comments), `.planning/REQUIREMENTS.md` §"Decisions deferred to research"
**Success Criteria** (what must be TRUE):
  1. Exporting a dashboard produces a JSON file containing its widgets, layers, dynamic views, referenced table definitions (`schema`, `name`, `columns`), and referenced custom metrics.
  2. The file carries a schema version field.
  3. Runtime state does NOT appear in the export — specifically `dashboard_table_views` (materialized-view bookkeeping).
  4. Access grants do NOT appear in the export (DXIM-V124-08).
  5. The set of exported entities is derived by walking the dependency graph, not by a hand-maintained list — a widget config referencing a custom metric must pull that metric in.
**Plans**: 4/4 plans executed — Phase 119 COMPLETE (operator-verified 2026-09-16)
- [x] 119-01-PLAN.md — The dependency walk as a pure, mutation-probed module (all 8 reference kinds)
- [x] 119-02-PLAN.md — Export envelope + assembler + `GET /api/dashboards/:id/export`
- [x] 119-03-PLAN.md — Kitchen-sink completeness, exclusion canaries, non-leak 404, SET-BASED gate
- [x] 119-04-PLAN.md — Ninth-reference-kind audit + operator export of a real dashboard (checkpoint) — APPROVED; 5/8 reference kinds live-verified, 3/8 automated-only (see 119-04-SUMMARY.md)

### Phase 120: Import
**Goal**: An export file recreates the dashboard in a target environment with fresh ids, every intra-file reference remapped, tables matched by `schema.name`, and nothing left behind if it fails.
**Depends on**: Phase 119 (needs the format to consume)
**Requirements**: DXIM-V124-03, DXIM-V124-04, DXIM-V124-05, DXIM-V124-06, DXIM-V124-07, DXIM-V124-09, DXIM-V124-10, DXIM-V124-11
**Research flag**: HIGHEST-RISK phase of the milestone. The id remapping rewrites references inside serialized JSON; a missed reference fails SILENTLY and renders wrong data rather than erroring.
**Success Criteria** (what must be TRUE):
  1. Importing a file whose dashboard and widget ids collide with existing records succeeds, and leaves those existing records untouched.
  2. Every `tableId`, `sourceMapWidgetId`, and custom-metric reference inside imported widget config points at the NEWLY created/matched record — verified per reference kind, not assumed.
  3. A table whose `schema.name` already exists in the target is reused; one that does not is created; the same `schema.name` is never duplicated.
  4. Custom metrics referenced by imported widgets exist in the target after import, matched by label where already present.
  5. Import is atomic: an induced failure partway through leaves no dashboard, widgets, layers, or table entries behind.
  6. Import returns a report naming the new dashboard id, tables matched vs created, and metrics created.
  7. A malformed, truncated, or hand-edited file is rejected with a clear message and changes nothing.
**Plans**: 5/5 plans executed — Phase 120 COMPLETE (automated; cross-environment UAT is Phase 121)
- [x] 120-01-PLAN.md — Shared visitor traversal + remap primitives + `getTableBySchemaName` (see 120-01-SUMMARY.md)
- [x] 120-02-PLAN.md — Two-tier validation + table/metric resolution with conflict reporting (see 120-02-SUMMARY.md)
- [x] 120-03-PLAN.md — Two-pass create-then-rewrite inside one transaction + atomicity (see 120-03-SUMMARY.md)
- [x] 120-04-PLAN.md — `POST /api/dashboards/import` + body-parser error branches (see 120-04-SUMMARY.md)
- [x] 120-05-PLAN.md — Per-reference-kind NEW-id proofs, 12 mutation probes, SET-BASED gate (see 120-05-SUMMARY.md)

**Verification:** 8/8 requirements (DXIM-V124-03/-04/-05/-06/-07/-09/-10/-11) automated-complete;
`packages/server && npx tsc --noEmit` and `packages/web && npx tsc --noEmit` both clean; server
gate exited 0 — `GATE PASSED`, SET-BASED (no fixed pass-count; 1 file — `auth.login-rbac.spec.ts` —
passed alone as TD-V16-TEST-ISOLATION contamination); `packages/web` carries zero diff from this
phase (base `3aba760`..HEAD); phase-wide mutation-probe tally 39/39 fired (10+6+6+5+12 across
120-01..05). Cross-environment portability and REF-2/-4/-5 outside a fixture are explicitly NOT
proven here — see 120-05-SUMMARY.md and REQUIREMENTS.md's note — that is Phase 121's job.

### Phase 121: UI + Cross-Environment Verification
**Goal**: The operator can export a dashboard from one environment and import it into another entirely from the app, and the imported dashboard renders identically to the original.
**Depends on**: Phases 119 and 120
**Requirements**: DXIM-V124-01, DXIM-V124-03, DXIM-V124-10
**Success Criteria** (what must be TRUE):
  1. A dashboard can be exported to a downloaded file from the dashboard UI, gated on the appropriate existing permission.
  2. An export file can be uploaded and imported from the UI, with the import report surfaced to the operator.
  3. An operator round-trip between two real environments reproduces the dashboard with all visualizations rendering the same data.
  4. Every interactive feature of the imported dashboard still works — drill-down, filters, map layers, and any standalone Legend binding — confirming the id remapping held in practice, not just in tests.
**Plans**: 3/4 plans executed (sequential — each builds on the previous)
- [x] 121-01-PLAN.md — Client API layer: blob download for export, JSON-body POST for import, `ImportReportDto` mirrors (see 121-01-SUMMARY.md)
- [x] 121-02-PLAN.md — `ImportDashboardModal`: file picker + FULL report, every `MetricConflict.message` verbatim (see 121-02-SUMMARY.md)
- [x] 121-03-PLAN.md — `DashboardsPage` wiring: per-row Export, `dashboards:create` AND `datasets:manage` gated Import (see 121-03-SUMMARY.md)
- [ ] 121-04-PLAN.md — **BLOCKING operator round trip between two servers with separate DB files** — a FAIL REOPENS DXIM-V124-01/-03/-10

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
