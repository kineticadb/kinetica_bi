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

---

## v1.15 Column Formatting & View Lifecycle — SHIPPED 2026-06-22

<details>
<summary>✅ v1.15 (Phases 74-79) — SHIPPED 2026-06-22 — full phase details archived in milestones/v1.15-ROADMAP.md</summary>

Client-side per-table column display config (custom labels + value formatting) applied across records-table, chart tooltips/axes/series, and map info popups (layers legend excluded), plus env-configurable materialized-view TTL defaults and a client keep-alive touch. Phase 74 pivoted to env vars (no app-settings store/UI/permission). Full detail + requirements in `milestones/v1.15-ROADMAP.md` / `milestones/v1.15-REQUIREMENTS.md`.

- [x] Phase 74: Env-Driven TTL Defaults (2/2 plans) — SETTINGS-V115-01/02/03
- [x] Phase 75: Column Display Config Foundation (3/3 plans) — COLCFG-V115-01/02/03
- [x] Phase 76: Column Formatting Editor UI (2/2 plans) — COLEDIT-V115-01/02/03
- [x] Phase 77: Apply Labels + Formatting at Render Surfaces (3/3 plans) — COLAPPLY-V115-01/02/03/04
- [x] Phase 78: View TTL Keep-Alive Touch (1/1 plan) — TTLKEEP-V115-01
- [x] Phase 79: Verification + Live UAT (operator-attested PASS) — TTLKEEP-V115-02, VERIFY-V115-01

Six in-session UAT fixes (modal CSS, default-None, DataFilter load-race + popover-portal, chart tooltip/pie/bar label formatting).

</details>

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1–54  | v1.0–v1.9 | — | Complete (archived) | 2026-04-29 → 2026-06-08 |
| 55–57 | v1.10 | — | Complete | 2026-06-10 |
| 58–61 incl. 58.1 | v1.11 | — | Complete | 2026-06-15 |
| 62–64 incl. 63.1 | v1.12 | — | Complete | 2026-06-16 |
| 65–69 incl. 68.1/68.2 | v1.13 | — | Complete | 2026-06-18 |
| 70–73 | v1.14 | — | Complete | 2026-06-19 |
| 74–79 | v1.15 | 11/11 | Complete | 2026-06-22 |

---

## v1.14 Class-Break & Chart Config Refinements — SHIPPED 2026-06-19

<details>
<summary>✅ v1.14 (Phases 70-73) — SHIPPED 2026-06-19 — full phase details archived in milestones/v1.14-ROADMAP.md</summary>

- [x] Phase 70: Numeric `<other>` Catch-All Bucket (1 plan) — CBOTHER-V114-01/02/03
- [x] Phase 71: SHAPE* Hidden for Lat/Lon Point Layers (2 plans) — SHAPE-V114-01/02/03
- [x] Phase 72: Group-By for Timeline + Numeric-Line Charts (3 plans) — GROUP-V114-01/02/03/04
- [x] Phase 73: Verification + Live UAT (operator-attested 12/12 PASS) — VERIFY-V114-01

Three FRONTEND-ONLY refinements + five in-session review fixes / one feature (legend `<other>` label, grouped palette, legend↔map overlay sync, calendar week-anchor drill, radio toggle-buttons). 19 commits, zero server diff. See `milestones/v1.14-ROADMAP.md`.

</details>

---

## v1.12 Drill-Down on Dynamic-View-Backed Widgets — SHIPPED 2026-06-16

<details>
<summary>✅ v1.12 (Phases 62-64 incl. 63.1) — SHIPPED 2026-06-16 — full phase details archived</summary>

Restored click-through exploration for dynamic-view-backed widgets: drilling a dv-backed chart/table/map filters the dynamic view's own data (not the source table), isolated to widgets on that same dv. Full phase-by-phase detail, success criteria, and plan lists are archived in `milestones/v1.12-ROADMAP.md`; requirements in `milestones/v1.12-REQUIREMENTS.md`.

- [x] Phase 62: Server — Materialize From DV View (2/2 plans) — completed 2026-06-15
- [x] Phase 63: Client — DV Drill-Down (4/4 plans) — completed 2026-06-15
- [x] Phase 63.1: Map-Layer DV-Filter FROM-Swap (gap closure, 1/1 plan) — completed 2026-06-15
- [x] Phase 64: Verification + Live UAT (3/3 plans) — completed 2026-06-16

</details>

---

## v1.13 Calendar Heatmap Visualization — SHIPPED 2026-06-18

<details>
<summary>✅ v1.13 (Phases 65-69 incl. 68.1 / 68.2) — SHIPPED 2026-06-18 — full phase details archived</summary>

A configurable Calendar Heatmap widget: GitHub-style time-bucketed grids across 8 domain×subdomain combinations, color-scaled, with drillable cells that filter the whole dashboard (incl. WMS map tiles) to a time slice, for both table- and dynamic-view-backed bindings. FRONTEND-ONLY (zero server diff). Full phase-by-phase detail, success criteria, and plan lists are archived in `milestones/v1.13-ROADMAP.md`; requirements in `milestones/v1.13-REQUIREMENTS.md`.

- [x] Phase 65: Calendar SQL Builder + Kinetica Spike (2/2 plans) — completed 2026-06-16
- [x] Phase 66: Chart-Type Definition + Config Panel (4/4 plans) — completed 2026-06-16
- [x] Phase 67: SVG Calendar Renderer (read-only) (3/3 plans) — completed 2026-06-16
- [x] Phase 68: Cell-Drill Integration (4/4 plans) — completed 2026-06-16
- [x] Phase 68.1: Calendar UX — wrapped GitHub week-block layout + config-gated on-widget controls (INSERTED, 3/3 plans) — completed 2026-06-17
- [x] Phase 68.2: Calendar week-anchor spike + per-group date-range gap-fill (INSERTED, 3/3 plans) — completed 2026-06-17
- [x] Phase 69: Verification + Live UAT (3/3 plans) — completed 2026-06-18 — 69-VERIFICATION.md passed (4/4 SCs); 3 dv/filter gaps fixed in-session (d60f3b1) + re-walked PASS

</details>
