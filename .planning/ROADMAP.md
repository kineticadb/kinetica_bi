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
