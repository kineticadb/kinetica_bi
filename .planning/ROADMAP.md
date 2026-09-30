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

- ✅ **v1.25 Schema Sync** — Phases 122-126 (shipped 2026-09-30) — see `milestones/v1.25-ROADMAP.md`

---

## v1.25 Schema Sync — SHIPPED 2026-09-30
✅ v1.25 (Phases 122-126) — SHIPPED 2026-09-30 — full phase details archived in `milestones/v1.25-ROADMAP.md`
- [x] Phase 122: Schema Diff & Table-Missing Detection
- [x] Phase 123: Column Reference Enumeration
- [x] Phase 124: Impact Report
- [x] Phase 125: Apply & Sync History
- [x] Phase 126: Datasets UI, Access Gating & Operator Verification
**Verification:** 19/19 SSYNC-V125 requirements Complete; all five phases carry a passing VERIFICATION.md (126's written during the milestone audit). Web vitest 185 files / 4162 tests, web+server tsc clean, theme-guard 154/154, server `scripts/test-gate.mjs` GATE PASSED (set-based, 1490/1543, 8 documented failing files). Operator-verified against a real Kinetica instance 2026-09-30, 14/14 checks PASS (`phases/126-*/126-UAT.md`). Audit `tech_debt`, no blockers; F1/F2/PG-3 remediated the same day (`milestones/v1.25-MILESTONE-AUDIT.md`).
**Known gaps carried, not smoothed over:** (1) **three defects passed `tsc`, `vitest` AND `theme-guard` and only the operator found them** — the permission gate sealed itself shut (the client re-syncs permissions only on a 403, and a hidden button can never produce one), and the history font was wrong twice; (2) **the milestone audit found a guard recorded as closed that could not fail** — every MIRROR-PARITY test over the web's type Sets compared a hardcoded copy to a hardcoded copy, so a web-side edit reddened nothing; now read from source (`abb1304`), with a control run proving the old spec passed against a web mutation; (3) **same-screen staleness after apply** (audit F1) shipped past the operator checkpoint because the UAT script only checked the Dashboards config panels; fixed in `edd648b` but not yet re-verified live; (4) no automated gate covers colour or font size in `global.css`; (5) five of nine registered tables have been dropped from Kinetica, so most live checks return `table_missing`.
**Open tech debt:** `SSYNC-F1`-`F6` deferred (auto-repair on declared rename, rename-pairing UI, check-all-tables, dashboard staleness indicator, nullability, a server-side column-existence gate on `POST /api/filter/materialize`); `SCHEMA_APPLY_TABLE_MISSING_MESSAGE` kept with no HTTP emitter by operator decision; renderColumnType vs classifyFingerprint marker order proven only over a fixture; `DatasetsPage.spec.tsx` test that passes for the wrong reason (`deferred-items.md`); removing persisted `config.sql` is the named v1.26 candidate; carried: `TD-V16-TEST-ISOLATION`, the theme-guard `global.css` exemption, `loadConfig(...).catch(() => {})`, OIDC never browser-verified.

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
