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
- 🚧 **v1.21 Dashboard Links & Map Default View** — Phases 111-115 (in progress)

---

## 🚧 v1.21 Dashboard Links & Map Default View (In Progress)

**Milestone Goal:** Remove two navigation frictions — a map that always opens on the whole world, and a dashboard reachable only by clicking through the list page. Frontend-only (`packages/web`); no server changes.

**Two independent tracks, parallel-safe** (different files, no shared state — do not serialize them for no reason):
- **Map Default View** (Phases 111 → 112): designer saves/clears a map widget's zoom+center as its default; that default is applied on load.
- **Dashboard Links** (Phases 113 → 114 → 115): the address bar tracks the open dashboard via the native History API (no router dependency); a pasted link opens that dashboard directly, including through login and permission/not-found error states.

Within each track phases are sequential (apply-on-load needs the saved field to exist first; inbound deep-link parsing needs the URL format the outbound sync established; the auth flow needs inbound parsing to route to). Across tracks, 111/112 and 113/114/115 can be planned and executed in either order or interleaved.

## Phases

- [ ] **Phase 111: Map Default View — Capture & Save** - Designer captures and persists a map widget's zoom+center as its default, from the map's config
- [ ] **Phase 112: Map Default View — Apply on Load** - Maps open at their saved default view (or world view if none saved)
- [ ] **Phase 113: Dashboard URL Sync** - Address bar reflects the open dashboard via the native History API
- [ ] **Phase 114: Deep Link Load & Error States** - A dashboard URL opens that dashboard directly, or shows a clear not-permitted/not-found message
- [ ] **Phase 115: Deep Link Authentication Flow** - A dashboard link works logged-out too, routing through login and landing on the linked dashboard

## Phase Details

### Phase 111: Map Default View — Capture & Save
**Goal**: A designer can capture a map widget's exact current view and persist or clear it as that widget's default, from the map's own config panel.
**Depends on**: Nothing (first phase; independent of the Dashboard Links track)
**Requirements**: MAPVIEW-V121-01, MAPVIEW-V121-04
**Research flag**: HIGHEST-RISK phase in the milestone. `mapViewportSyncStore` is NOT reusable (see Implementation constraints in REQUIREMENTS.md) — the config panel needs its own path to the live view (zoom/center) of the specific map instance it is configuring, keyed by `widgetId`, independent of the per-map "Sync viewport" toggle. Resolve this mechanism before/at plan time for this phase.
**Success Criteria** (what must be TRUE):
  1. From a map widget's config panel, the designer can save the map's exact current zoom and center as that widget's default view, with visible confirmation that the save happened.
  2. The designer can clear a previously saved default view from the same config panel; the control then clearly shows no default is set.
  3. Saving or clearing one map widget's default view does not alter any other map widget's saved default or its current on-screen view.
**Plans**: TBD

### Phase 112: Map Default View — Apply on Load
**Goal**: A map widget opens at its designer-chosen default view instead of always at the world view — without resurrecting auto-fit-to-data (deliberately removed in Phase 12-02).
**Depends on**: Phase 111 (needs the saved-default field to exist)
**Requirements**: MAPVIEW-V121-02, MAPVIEW-V121-03, MAPVIEW-V121-05, MAPVIEW-V121-06
**Success Criteria** (what must be TRUE):
  1. A map widget with a saved default view opens already at that zoom and center — no visible world-view flash beforehand.
  2. A map widget with no saved default view opens exactly as it does today: world view, `center [0,0]`, `zoom 2`.
  3. Reloading the dashboard (browser refresh) reopens each map at its saved default view — the save survives a reload.
  4. Two map widgets on the same dashboard with different saved defaults each open at their own view, independent of one another.
**Plans**: TBD

### Phase 113: Dashboard URL Sync
**Goal**: The browser address bar always reflects which dashboard, if any, is open — kept in sync via the native History API, no new dependency.
**Depends on**: Nothing (independent of the Map Default View track)
**Requirements**: DLINK-V121-01, DLINK-V121-06, DLINK-V121-07
**Success Criteria** (what must be TRUE):
  1. Opening any dashboard immediately updates the browser address bar to a URL identifying that dashboard.
  2. Pressing Back while a dashboard is open returns to the dashboard list, both on screen and in the address bar.
  3. Navigating from an open dashboard back to the dashboard list clears the dashboard identifier from the address bar — the URL never describes a view the user is no longer on.
**Plans**: TBD

### Phase 114: Deep Link Load & Error States
**Goal**: Visiting or pasting a dashboard URL opens that dashboard directly — or, if it can't, shows a clear message instead of a blank or broken page.
**Depends on**: Phase 113 (establishes the URL/param format this phase parses on load)
**Requirements**: DLINK-V121-02, DLINK-V121-04, DLINK-V121-05
**Success Criteria** (what must be TRUE):
  1. Loading the app directly at a dashboard URL opens straight into that dashboard, without the dashboard-list page appearing first.
  2. Visiting a link to a dashboard the signed-in user is not permitted to view shows a clear "not permitted" message — never a blank/broken page and never the dashboard's content (per v1.10 view permissions; must not leak existence or contents).
  3. Visiting a link to a dashboard that no longer exists shows a clear "not found" message.
**Plans**: TBD

### Phase 115: Deep Link Authentication Flow
**Goal**: A dashboard link works even for a visitor who isn't logged in yet — it routes through login and lands them on the dashboard from the link, not the dashboard list.
**Depends on**: Phase 114 (needs inbound URL parsing to exist so there's a target to return to)
**Requirements**: DLINK-V121-03
**Success Criteria** (what must be TRUE):
  1. Visiting a dashboard link while not authenticated routes to the login page rather than erroring.
  2. After completing authentication, the user lands directly on the dashboard from the original link — reusing/extending the existing Phase 7 sessionStorage return-to-page mechanism, not a second mechanism.
**Plans**: TBD

## Progress

**Execution Order:**
Within v1.21, phases execute in numeric order (111 → 112 → 113 → 114 → 115); the 111-112 pair and the 113-115 chain are independent tracks and may be planned/executed in either order relative to each other.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 111. Map Default View — Capture & Save | 0/TBD | Not started | - |
| 112. Map Default View — Apply on Load | 0/TBD | Not started | - |
| 113. Dashboard URL Sync | 0/TBD | Not started | - |
| 114. Deep Link Load & Error States | 0/TBD | Not started | - |
| 115. Deep Link Authentication Flow | 0/TBD | Not started | - |

---

## v1.20 Filter Panel — SHIPPED 2026-08-27

<details>
<summary>✅ v1.20 (Phases 105-110 incl. 109.1 / 109.2) — SHIPPED 2026-08-27 — full phase details archived in milestones/v1.20-ROADMAP.md</summary>

- [x] Phase 105: Reverse-Mapping Pure Lib + Tests
- [x] Phase 106: Display-Mode Persistence
- [x] Phase 107: Panel Shell + Reflow + XOR Switch + Chips
- [x] Phase 108: Applies-To List + On-Canvas Highlight
- [x] Phase 109: Global Clear-All
- [x] Phase 109.1: Filter Scope for Custom-Panel Charts (INSERTED)
- [x] Phase 109.2: Wire Custom-Panel Charts into Filter-Scope Engine and Reverse-Map (INSERTED)
- [x] Phase 110: Designer Settings UI + Verification + Live UAT

**Verification:** 19/19 requirements Complete; both-stack automated gates green (web vitest 154 files / 3439 tests; server SET-BASED ⊆ TD-V16-TEST-ISOLATION); operator UAT PASS on all 8 groups. See `phases/110-*/110-VERIFICATION.md`.

</details>
