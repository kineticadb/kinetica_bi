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
- 🚧 **v1.15 Column Formatting & View Lifecycle** — Phases 74-79 (in progress)

---

## 🚧 v1.15 Column Formatting & View Lifecycle (In Progress)

**Milestone Goal:** Give operators client-side control over how table columns are displayed (custom labels + value formatting), and make materialized-view TTLs robust for long-idle dashboards (keep-alive touch + env-configurable TTL defaults).

> **Revised 2026-06-19:** Phase 74 was descoped from a runtime app-settings store/UI/permission to **environment-variable config**. The `app_settings` SQLite table, settings CRUD endpoints, and the `app:manage_settings` permission are NO LONGER part of this milestone. The only new SQLite table is `column_display_config` (Phase 75). The runtime app-settings store is captured as a deferred idea in `74-CONTEXT.md`.

**NOT frontend-only** — this is the first server-touching milestone since v1.12. It adds one new SQLite table (`column_display_config`), column-config CRUD endpoints, env-driven TTL wiring into all three materialize sites, and a **new web dependency** (`d3-format` for advanced number formatting). Three feature areas with a clean dependency spine:

- **Env-driven TTL defaults** (Phase 74) is a FOUNDATION — TTL config moves from a hardcoded `5` to two boot-read env vars (`DEFAULT_VIEW_TTL_MINUTES`, `TTL_KEEPALIVE_LEAD_MINUTES`). It must land first because the TTL keep-alive (Phase 78) reads `ttlKeepaliveLeadMinutes` from `/api/me`, and the configurable `DEFAULT_VIEW_TTL_MINUTES` flows into all three materialize sites' `expiresAt`.
- **Column display config foundation** (Phase 75) — server table + CRUD + a PURE client formatter lib + a client store/helpers — is the foundation for both the editor UI (Phase 76) and the apply-at-surfaces work (Phase 77), which are independent of each other once it lands.
- **TTL keep-alive** (Phase 78) depends only on the env-driven TTL foundation (Phase 74), so it can run in parallel with the column work.
- **Verification + Live UAT** (Phase 79) gates the whole milestone and carries the live TTL-reset confirmation.

**Execution spine:** 74 → {75, 78} can start once 74 lands (78 needs only the env-exposed lead value; 75 is independent of 74). 76 and 77 both depend on 75 and are parallel-safe with each other. 79 verifies after everything lands.

### Phase 74: Env-Driven TTL Defaults
> **Revised 2026-06-19** — descoped from a runtime app-settings store/UI/permission to **environment-variable config**. The original goal (admin-managed KV store, CRUD endpoints, `app:manage_settings` permission, admin Settings UI) was dropped in favor of deploy-time env vars read once at boot. See `.planning/phases/74-app-settings-infrastructure-ttl-defaults/74-CONTEXT.md`.

**Goal**: Make the materialized-view TTL and the keep-alive lead-time **deploy-time configurable via environment variables** (read once at boot, `AUTH_MODE`-style), replacing the hardcoded `TTL = 5` across all three materialize sites, and expose the keep-alive lead value to the client for Phase 78.
**Depends on**: Nothing (foundation — unblocks Phase 78)
**Requirements**: SETTINGS-V115-01, SETTINGS-V115-02, SETTINGS-V115-03
**Stack**: BOTH stacks (server-heavy, much smaller than original). Server: capture `DEFAULT_VIEW_TTL_MINUTES` (default 5) + `TTL_KEEPALIVE_LEAD_MINUTES` (default 1) as boot consts in `packages/server/src/index.ts` (mirroring `AUTH_MODE` at `index.ts:136`, per ARCHITECTURE.md AP-5 — never re-read `process.env` after boot); invalid/missing value → fall back to default + boot warning. Replace `ttl: 5` and the `expiresAt` arithmetic at ALL THREE materialize sites — `index.ts:967` (filter-on-dynamic-view), `:1053` (filter-materialize), `:1716` (dynamic-view materialize) — passing the const through the shared `packages/server/src/lib/materializedView.ts:35` helper (`TTL = ${ttl}`). Add `ttlKeepaliveLeadMinutes` top-level to the `GET /api/me` response (`index.ts:348`, next to `authMode`). Web: read `ttlKeepaliveLeadMinutes` from the `/api/me` bootstrap for Phase 78. NO SQLite table, NO CRUD endpoints, NO new permission, NO settings UI, NO web `PERMISSIONS` change.
**Success Criteria** (what must be TRUE):
  1. `DEFAULT_VIEW_TTL_MINUTES` and `TTL_KEEPALIVE_LEAD_MINUTES` are read once at boot with defaults 5 and 1; a missing, non-numeric, zero, or negative value falls back to its default and logs a boot warning (the app still starts).
  2. With `DEFAULT_VIEW_TTL_MINUTES` set, newly created filter-views AND dynamic-views (all three materialize sites, including the filter-on-dynamic-view branch at `index.ts:967`) are materialized with the configured TTL (not the old hardcoded 5), and each endpoint's `expiresAt`/`expires_at` reflects the configured value; the client's expiry tracking shows the new value.
  3. `TTL_KEEPALIVE_LEAD_MINUTES` (default 1) is exposed top-level on `GET /api/me` as `ttlKeepaliveLeadMinutes` and is read by the client for the Phase 78 keep-alive to consume.
**Plans**: 2 plans
- [ ] 74-01-PLAN.md — Server: capture DEFAULT_VIEW_TTL_MINUTES + TTL_KEEPALIVE_LEAD_MINUTES boot consts (fallback+warn), wire const into all 3 materialize sites, expose ttlKeepaliveLeadMinutes on /api/me + tests
- [ ] 74-02-PLAN.md — Web: plumb ttlKeepaliveLeadMinutes through MeResponse / fetchMe / auth store for Phase 78 + test

### Phase 75: Column Display Config Foundation
**Goal**: Persist a GLOBAL per-table column display config (custom label + format spec, keyed by `table_id` + `column_name`) server-side with CRUD endpoints, and build the PURE client-side formatting library plus a client store/helpers that resolve a column's display label and value formatter — the foundation reused by both the editor UI (Phase 76) and every render surface (Phase 77). Formatting is CLIENT-SIDE ONLY and never alters the SQL sent to Kinetica.
**Depends on**: Nothing (foundation — unblocks Phases 76 + 77)
**Requirements**: COLCFG-V115-01, COLCFG-V115-02, COLCFG-V115-03
**Stack**: BOTH stacks. Server: `column_display_config` table in `db.ts` SCHEMA_DDL (`table_id` + `column_name` → `display_label`, `format_spec`) + CRUD endpoints in `index.ts` (read ungated for any authenticated viewer so render surfaces resolve labels; write gated — confirm gating at plan time, likely `datasets:manage` or designer). Web: NEW dependency `d3-format` in `packages/web`; a pure formatter lib (numbers: thousands separators / fixed decimals / currency symbol / percent + advanced d3-format string; dates: presets + custom pattern; invalid/empty → raw fallback) — no store/DOM/SQL coupling, fully unit-tested; a client store + helpers (`resolveLabel(col) → label ?? rawName`, `resolveFormatter(col) → fn ?? identity`) loading a table's config (`TableDto.columns` is `Record<string,string>`; `inferDataTypeFromColumn` at `packages/web/src/lib/columnTypes.ts:85` drives format-kind defaults).
**Success Criteria** (what must be TRUE):
  1. A column display config (label + format spec, keyed by `table_id` + `column_name`) can be created, read, updated, and deleted via server endpoints; the config is GLOBAL per table and the same stored config is returned regardless of which dashboard requests it.
  2. The pure formatter library formats a sample value correctly for every supported kind — numbers (commas, fixed decimals, currency with a configurable symbol, percent, and an advanced d3-format string) and dates (preset formats + a custom pattern) — and an invalid or empty spec returns the raw value unchanged; the library never constructs or mutates SQL.
  3. Given a table's loaded config, the client helpers resolve any column's display label (falling back to the raw column name when no label is set) and its value formatter (falling back to an identity passthrough when no/invalid format spec is set).
  4. The `d3-format` dependency is added to `packages/web` only and the formatter library imports it without any server-side or SQL-path coupling.
**Plans**: 3 plans
- [x] 75-01-PLAN.md — Server: column_display_config table + CRUD helpers in db.ts; 3 endpoints in index.ts (read ungated, write datasets:manage) + supertest (wave 1)
- [ ] 75-02-PLAN.md — Web: add d3-format dep + pure columnFormatter lib (FormatSpec union, buildFormatter w/ percent-no-x100, hand-rolled UTC dates, raw-fallback) fully unit-tested (wave 1)
- [ ] 75-03-PLAN.md — Web: columnDisplayConfigStore (Zustand, configVersion) + resolveLabel/resolveFormatter helpers + api/client fetch helpers + lifecycle reset (wave 2, depends 75-01+75-02)

### Phase 76: Column Formatting Editor UI
**Goal**: Operators can open a per-table Column Formatting editor from the Tables area that lists the table's columns with detected types, set a custom display label per column (clearing reverts to the raw name), and choose a format per column — number / date / advanced d3-format — with a LIVE PREVIEW of a sample value, saving to the global per-table config.
**Depends on**: Phase 75 (config foundation: server CRUD + formatter lib + store/helpers)
**Requirements**: COLEDIT-V115-01, COLEDIT-V115-02, COLEDIT-V115-03
**Stack**: FRONTEND-ONLY (`packages/web`) — reached from the top-bar "Tables" area (`dashboard_tables` junction context at `db.ts:33`; `TableDto` CRUD at `client.ts:229`); reuses the Phase 75 formatter lib for the live preview and the Phase 75 client CRUD helpers to persist. Flag any server diff (none expected — Phase 75 owns the server surface).
**Success Criteria** (what must be TRUE):
  1. An operator can open a Column Formatting editor for a specific table (reached from the Tables area) that lists every column in the table alongside its detected data type.
  2. Per column, the operator can set a custom display label (e.g. `Device_Manufacturer` → "Device Manufacturer"); clearing the label field reverts that column to its raw column name.
  3. Per column, the operator can pick a format — number (commas / decimal places / currency symbol / percent), date (preset or custom pattern), or an advanced d3-format string — and a LIVE PREVIEW shows a sample value rendered with the current selection before saving.
  4. Saving persists the labels + format specs to the GLOBAL per-table config (Phase 75 endpoints), so the same settings apply to every dashboard using that table.
**Plans**: 2 plans
- [ ] 76-01-PLAN.md — ColumnFormatEditorModal: two-pane editor (column list + per-column label/format controls + live preview + Save to global config)
- [ ] 76-02-PLAN.md — "Format columns" entry-point button + modal mount on TableDetail (Tables area)

### Phase 77: Apply Labels + Formatting at Render Surfaces
**Goal**: Inject the resolved display label + value formatter into the Records Table (headers = label, cells = formatted), chart tooltips AND chart axis titles / in-chart series legends (tooltip values formatted), and map info popups (template `{column}` substitution + key/value modes) — while explicitly leaving the map layers legend (`LayersLegendPanel`) UNAFFECTED.
**Depends on**: Phase 75 (config foundation: store/helpers + formatter lib)
**Requirements**: COLAPPLY-V115-01, COLAPPLY-V115-02, COLAPPLY-V115-03, COLAPPLY-V115-04
**Stack**: FRONTEND-ONLY (`packages/web`). Records Table: `WidgetRenderer.tsx:2134` headers + `:2185` cells. Charts: Recharts tooltip via a custom Tooltip content component (`RECHARTS_TOOLTIP_PROPS` at `chartTheme.ts:20`) + axis-title / series-label wiring across the chart renderers. Map info popups: `renderInfoTemplate.ts:43` template + KV modes, `InfoSelectionView.tsx:370`. Legend EXCLUSION asserted by test (`LayersLegendPanel` does NOT apply column label/format). Flag any server diff (none expected). `AggregatedWidgetRenderer` remains the SOLE materialize trigger (this is read-path label/format injection only — no new materialize calls).
**Success Criteria** (what must be TRUE):
  1. On the Records Table visualization, column headers show the custom display label and cell values are rendered through the column's formatter (raw fallback for columns with no config).
  2. Chart tooltips show the custom label and a formatted value per the column's format spec, AND chart axis titles + in-chart series legends show the custom label.
  3. Map info popups show the custom label + formatted value in BOTH the template `{column}` substitution mode and the key/value mode.
  4. The map layers legend (`LayersLegendPanel`) continues to render layer/break config with NO column label or formatting applied — and this exclusion is locked by an explicit test.
**Plans**: TBD

### Phase 78: View TTL Keep-Alive Touch
**Goal**: While a dashboard is open, the client fires a lightweight "get first records" touch on each live materialized view (filter-views + dynamic-views) a configurable lead-time (`ttl_keepalive_lead_minutes`) before its `expiresAt`, re-arming after each touch, so an idle dashboard never hits an expired view.
**Depends on**: Phase 74 (provides `ttl_keepalive_lead_minutes` + the configurable `expiresAt`)
**Requirements**: TTLKEEP-V115-01
**Stack**: FRONTEND-ONLY (`packages/web`) — a dashboard-level client hook mounted alongside `useDynamicViewMaterializeChain` in DashboardOpen (`DashboardsPage.tsx:378-422`). It reads each live view's `expiresAt` from `filterViewStore` (filter-views) + `dynamicViewStore` (dynamic-views — both already track `expiresAt`), schedules a touch `ttl_keepalive_lead_minutes` before expiry, fires a lightweight get-first-records read, and re-arms. `AggregatedWidgetRenderer` remains the SOLE materialize trigger — the touch is a READ, never a materialize (statically assert the hook does not import `materializeFilter`/`materializeDynamicView`). Server: the touch uses the existing get-records read-path; flag any server diff (none expected). Live TTL-reset confirmation is performed in Phase 79.
**Success Criteria** (what must be TRUE):
  1. With a dashboard open and at least one live materialized view (a filter-view and/or a dynamic-view), the client schedules a touch to fire `ttl_keepalive_lead_minutes` minutes before that view's `expiresAt`, reading the lead-time from the Phase 74 app setting.
  2. The touch is a lightweight get-first-records READ against the live view (filter-views via `filterViewStore`, dynamic-views via `dynamicViewStore`) — the hook never imports or calls a materialize/drop function, and `AggregatedWidgetRenderer` remains the sole materialize trigger (statically asserted).
  3. After a touch fires, the keep-alive re-arms for the next interval, so a dashboard left open across multiple TTL windows keeps touching each live view.
  4. The keep-alive tears down cleanly on dashboard switch / unmount (no orphaned timers firing against a closed dashboard's views).
**Plans**: TBD

### Phase 79: Verification + Live UAT
**Goal**: Prove the whole v1.15 milestone end-to-end via green automated gates on BOTH stacks plus a blocking live operator walk-through, INCLUDING the live confirmation that reading a materialized view resets its Kinetica TTL (re-materialize documented as the fallback if it does not), then compile the verification record. Mirrors v1.14 Phase 73 / v1.13 Phase 69 / v1.12 Phase 64.
**Depends on**: Phases 74, 75, 76, 77, 78
**Requirements**: TTLKEEP-V115-02, VERIFY-V115-01
**Stack**: BOTH stacks + operator. Server: supertests in BOTH auth modes (password + oidc) + server `tsc` clean + server vitest SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky — NEVER a fixed pass-count). Web: frontend vitest 100% from `packages/web` + web `tsc` clean + theme-guard.spec.ts green (no raw hex). `AggregatedWidgetRenderer` remains the SOLE materialize trigger.
**Success Criteria** (what must be TRUE):
  1. Automated gates are green: server supertests pass in BOTH auth modes, web + server `tsc` clean as separate gates, server vitest set-based ⊆ TD-V16-TEST-ISOLATION, frontend vitest 100% from `packages/web`, theme-guard.spec.ts passing.
  2. A blocking live operator walk-through attests PASS for column formatting + labels end-to-end against deployed Kinetica: editor live preview + save, then labels/formatting visible on Records Table, chart tooltips + axes + series legends, and map info popups (template + KV) — with the map layers legend confirmed UNCHANGED.
  3. The live walk-through attests PASS for the app-settings flow: an `app:manage_settings`-permitted user edits `default_view_ttl_minutes` + `ttl_keepalive_lead_minutes`, and newly materialized views use the configured TTL; a non-permitted user is blocked.
  4. It is verified against the deployed Kinetica that reading a materialized view resets its TTL (so the Phase 78 touch keeps it alive); if a read does NOT reset TTL, the re-materialize fallback is documented as the disposition (TTLKEEP-V115-02).
  5. The verification record is compiled (79-VERIFICATION.md) and any UAT-surfaced gaps are fixed in-session (repro-test-driven) and re-walked PASS.
**Plans**: TBD

---

## Progress

**Execution Order:** 74 (foundation) → 75 (independent of 74) and 78 (needs 74) → 76 + 77 (both need 75, parallel-safe) → 79 verifies after all land.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1–54  | v1.0–v1.9 | — | Complete (archived) | 2026-04-29 → 2026-06-08 |
| 55–57 | v1.10 | — | Complete | 2026-06-10 |
| 58–61 incl. 58.1 | v1.11 | — | Complete | 2026-06-15 |
| 62–64 incl. 63.1 | v1.12 | — | Complete | 2026-06-16 |
| 65–69 incl. 68.1/68.2 | v1.13 | — | Complete | 2026-06-18 |
| 70–73 | v1.14 | — | Complete | 2026-06-19 |
| 74. app-settings-infra-ttl-defaults | v1.15 | 0/2 | Not started | - |
| 75. column-display-config-foundation | v1.15 | 1/3 | In progress | - |
| 76. column-formatting-editor-ui | v1.15 | 0/TBD | Not started | - |
| 77. apply-labels-formatting-render-surfaces | v1.15 | 0/TBD | Not started | - |
| 78. view-ttl-keep-alive-touch | v1.15 | 0/TBD | Not started | - |
| 79. verification-live-uat | v1.15 | 0/TBD | Not started | - |

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
