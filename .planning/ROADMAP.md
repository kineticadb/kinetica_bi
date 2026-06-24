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
- 🚧 **v1.16 White-Label Theming** — Phases 80-84 (in progress)

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

## v1.16 White-Label Theming — IN PROGRESS

**Milestone Goal:** Make the application white-labelable — a permitted admin can brand the app (logo + name, color palette, typography, custom CSS) from a runtime admin UI, applied live without a redeploy, on top of a polished distinctive default "Aurora" Kinetica theme.

**Stack:** BOTH (server: `brand_config` SQLite table + 4 branding API routes + sanitizers; web: extended token system + `brandStore` + `BrandingSettingsPage`). New deps: web — `react-colorful`, `colord`; server — `multer`, `DOMPurify`, `postcss`.

**Canonical refs:**
- `.planning/design/CHOSEN-DIRECTION.md` (Aurora token baseline — locked)
- `.planning/research/SUMMARY.md` (architecture + pitfalls + open decisions)
- `packages/web/src/styles/global.css` (token migration target, ~4,440 lines)
- `packages/server/src/db.ts` + `lib/permissions.ts` (v1.15 `column_display_config` + RBAC precedents)
- `packages/web/src/styles/theme-guard.spec.ts` (extended structural guard)

**Open decisions to settle at plan time (flagged per phase):**
- Open Decision 1 (Phase 81/83): Custom CSS scoping — `@scope (#root)` vs no scoping (see SUMMARY.md §Open Decisions)
- Open Decision 2 (Phase 81): CSS sanitizer — PostCSS AST (recommended) vs regex (see SUMMARY.md §Open Decisions)

### Phases

- [ ] **Phase 80: Token Foundation + Aurora Default Theme** — Define full token vocabulary, migrate global.css, ship Aurora dark+light, extend theme-guard
- [x] **Phase 81: Brand Config Server Foundation** — `brand_config` table, 18th permission, 4 API routes, logo upload + SVG sanitization, CSS sanitization at save time
- [ ] **Phase 82: Client Token Pipeline + FOUC Prevention + Identity** — `brandStore`, FOUC-free inline bootstrap, live token apply, logo/name/favicon wiring across all surfaces
- [ ] **Phase 83: Branding Admin UI** — `BrandingSettingsPage` with color pickers, WCAG badges, font picker, feel levers, live preview, Save/Reset, custom CSS editor
- [ ] **Phase 84: Verification + Live UAT** — Green automated gates both stacks + blocking operator walk-through; compiled verification record

## Phase Details

### Phase 80: Token Foundation + Aurora Default Theme
**Goal**: The full structural token vocabulary is defined and enforced; Aurora dark + light mode ships as the default theme; chart colors and the theme-guard both cover the new structural tokens.
**Depends on**: Nothing (first v1.16 phase; builds on existing CSS-token system)
**Stack**: FRONTEND-ONLY (`packages/web`)
**Requirements**: TOKENS-V116-01, TOKENS-V116-02, TOKENS-V116-03, TOKENS-V116-04, THEME-V116-01, THEME-V116-02, THEME-V116-03
**Success Criteria** (what must be TRUE):
  1. The Aurora dark-mode theme matches the approved baseline: violet `#7f40ed` on near-black `#0a0a12`, Manrope body + Space Grotesk display, compact density — every token in `.planning/design/CHOSEN-DIRECTION.md` is present in `global.css` `:root`.
  2. Toggling dark/light re-skins the entire app coherently: panels, buttons, inputs, chips, and text all flip to the light-mode palette with a readable darker `--accent-text` on light backgrounds (two-tier accent rule holds in both modes).
  3. Recharts axis/grid colors update when the theme flips (no hardcoded SVG presentation attributes); chart series colors remain visually distinct and not monochromatic.
  4. The extended theme-guard fails the build if any non-token spacing, typography, radius, or motion literal is introduced into a migrated component file (regressions caught at CI, not in review).
  5. Changing a structural token in `global.css` `:root` re-skins the whole app without touching any individual component file — verified by spot-checking 3+ components.
**Plans**: 3 plans (Wave 1: 80-01; Wave 2: 80-02 + 80-03 parallel-safe — both depend only on 80-01; sole shared file is global.css's :root blocks)

Plans:
- [ ] 80-01-PLAN.md — Full token vocabulary in `:root` (dark) + `:root[data-theme="light"]` (light) with exact Aurora dark + warm off-white light values + two-tier accent; migrate all structural literals across global.css + the 3 component CSS files onto the tokens (normalized to clean scales) [TOKENS-V116-01/02/04, THEME-V116-01/02]
- [ ] 80-02-PLAN.md — Aurora visual polish: self-host Manrope + Space Grotesk via @fontsource-variable (remove Google Fonts CDN), Space Grotesk display headings, hex-mesh + aurora-glow body treatment (dark vivid / light subtle), apply `--accent-text` two-tier rule; ends in a visual-verify checkpoint [THEME-V116-01/02, TOKENS-V116-04]
- [ ] 80-03-PLAN.md — Chart + theme-guard integration: `useChartAxisColors` reads `--color-chart-*` via getComputedStyle (theme-flip + brand-ready); violet-led colorblind-aware `AURORA_CHART_PALETTE`; extend theme-guard to scan global.css + forbid structural literals (px/ms) with allow-primitives + inline pragma [THEME-V116-03, TOKENS-V116-03]

---

### Phase 81: Brand Config Server Foundation
**Goal**: The server-side brand persistence layer exists and is hardened — the branding API routes are live, the 18th permission gates writes, the login page can fetch brand before authentication, and logo + custom CSS save paths are sanitized against XSS/exfiltration vectors before any client code touches them.
**Depends on**: Phase 80 (token names must be stable before the server stores them)
**Stack**: SERVER-ONLY (`packages/server`); new deps: `multer`, `DOMPurify`, `postcss` (+ `file-type` for MIME validation)
**Requirements**: BRANDFND-01, BRANDFND-02, SECA-V116-01, CSS-V116-02
**Open decisions resolved at plan time**: Open Decision 2 → PostCSS AST (regex rejected — unicode-escape CVE bypass per PITFALLS.md); MIME magic-byte validation → `file-type@19` (ESM-native, Node 24-compatible)
**Success Criteria** (what must be TRUE):
  1. `GET /api/branding` returns the active brand config (all token overrides, app name, logo reference, custom CSS) with no authentication required — a `curl` with no session cookie returns 200 with JSON.
  2. `PUT /api/branding` with a valid session but without `branding:manage` returns 403; with the permission it saves and a subsequent `GET /api/branding` reflects the change.
  3. Uploading an SVG logo that contains a `<script>` tag is rejected or the script is stripped before storage; the stored value renders safely as an `<img>` tag (never inline or `dangerouslySetInnerHTML`).
  4. Submitting custom CSS containing `url(https://attacker.com)` or `@import` to `PUT /api/branding` stores a sanitized version with those declarations removed — verified via supertest.
  5. `GET /api/branding` carries `Cache-Control: no-cache, no-store` so a reverse proxy cannot serve a stale brand to the login page.
**Plans**: 3 plans (Wave 1: 81-01 foundation; Wave 2: 81-02 routes — depends on 81-01; Wave 3: 81-03 CSS sanitizer + both-auth-mode tests — depends on 81-02. Strictly sequential: routes need the table+permission, the CSS sanitizer wires into the PUT route.)

Plans:
- [x] 81-01-PLAN.md — `brand_config` singleton DDL + `INSERT OR IGNORE` seed in db.ts + `BRANDING_MANAGE` 18th permission (server + web `lib/permissions.ts` byte-parity mirror; `rbacSeed.ts` needs NO change) + bump `lib.permissions.spec.ts` lock 17→18 [BRANDFND-01, BRANDFND-02]
- [x] 81-02-PLAN.md — 4 branding API routes: `GET /api/branding` + `GET /api/branding/logo` (unauthenticated, before requireAuth wall), `PUT /api/branding` + `POST /api/branding/logo` (gated on `branding:manage`); multer + `file-type@19` magic-byte MIME check + DOMPurify SVG sanitization; route supertests (password mode) [BRANDFND-01, BRANDFND-02, SECA-V116-01]
- [x] 81-03-PLAN.md — `brandCssSanitizer.ts` (PostCSS AST walk, 64KB cap) wired into PUT before storage; unit spec + CSS-vector integration tests + AUTH_MODE=oidc smoke block (both-auth-mode gate) [CSS-V116-02, SECA-V116-01]

---

### Phase 82: Client Token Pipeline + FOUC Prevention + Identity
**Goal**: Brand tokens flow from server to browser at startup; the app never flashes the default Kinetica theme on load/reload; logo, app name, and favicon are drawn from the brand store across every surface; brand changes by an admin propagate to other open tabs without a hard refresh.
**Depends on**: Phase 81 (server routes must exist for the client to bootstrap from)
**Stack**: FRONTEND-ONLY (`packages/web`)
**Requirements**: BRANDFND-03, BRANDFND-04, BRANDUI-01
**Success Criteria** (what must be TRUE):
  1. On a throttled (Slow 3G) hard reload with a custom brand set, the custom brand colors are visible from the very first painted frame — no flash of the default Kinetica violet before brand loads.
  2. After an admin saves a new primary color, other open tabs (on a different browser or incognito) pick up the change within seconds — without the user manually refreshing.
  3. The sidebar (expanded) and login page display the uploaded logo as an `<img>` element (never inline SVG / `dangerouslySetInnerHTML`); app name replaces every "Kinetica BI" hardcoded string; the browser tab favicon reflects the brand. (Topbar logo excluded per 82-CONTEXT decision 2026-06-24 — deferred; Topbar has no brand mark today.)
  4. `localStorage("kbi-brand-tokens")` is populated after every authoritative brand fetch, and the `index.html` inline script reads it synchronously before any stylesheet parses — confirmed by inspecting the DOM before React hydration.
**Plans**: 3 plans

Plans:
- [ ] 82-01-PLAN.md — Foundation: `brandStore.ts` (bootstrap/applyBrandTokens setProperty+removeProperty, localStorage cache, BroadcastChannel + window.focus refetch, theme subscription, document.title), `fetchBranding()` client fn, `BrandStyleInjector.tsx` (textContent), App.tsx wiring [BRANDFND-03]
- [ ] 82-02-PLAN.md — FOUC: extend the `index.html` inline `<head>` IIFE to read `kbi-brand-tokens` + apply token `setProperty` + inject font/favicon `<link>` before first paint [BRANDFND-04]
- [ ] 82-03-PLAN.md — Identity wiring: `Sidebar.tsx` logo `<img>` (custom or bundled `logo-default.svg`) + `LoginPage.tsx` appName (both branches) + `Sidebar.spec.tsx` update; Topbar intentionally excluded [BRANDUI-01]

---

### Phase 83: Branding Admin UI
**Goal**: A permitted admin can brand the app end-to-end from a single settings page — picking colors with live WCAG feedback, choosing fonts, adjusting feel levers, previewing changes live before saving, and injecting sanitized custom CSS — all without a redeploy.
**Depends on**: Phase 82 (token pipeline must work before the UI can preview live changes)
**Stack**: FRONTEND-ONLY (`packages/web`); new deps: `react-colorful`, `colord`
**Requirements**: BRANDUI-02, BRANDUI-03, BRANDUI-04, BRANDUI-05, CSS-V116-01, SECA-V116-02
**Open decisions to resolve at plan time**: Open Decision 1 (custom CSS scoping — `@scope (#root)` vs no scoping); whether `:root` token overrides via custom CSS are allowed or blocked if `@scope` is chosen
**Success Criteria** (what must be TRUE):
  1. An admin changing the primary accent color in the color picker sees every button, focus ring, and active-state swatch update live on the page before hitting Save — without a page reload or API call.
  2. Setting a color combination that fails WCAG AA contrast (e.g. light text on light background) shows a visible FAIL badge next to the affected token pair in both dark and light mode simultaneously — the admin cannot unknowingly ship an illegible palette.
  3. An admin can pick a body font and a display font from the curated list; switching fonts updates the live preview instantly and the selection persists through Save + reload.
  4. Adjusting the density lever (Compact / Comfortable / Spacious) visibly changes the spacing rhythm across the preview; corner-radius and glow on/off controls produce observable visual changes.
  5. Pasting CSS with a `url()` data-exfiltration pattern into the custom CSS editor and saving is rejected server-side (sanitized); the admin sees the stored CSS (minus the blocked declaration) after save — the escape hatch works for legitimate selectors and is blocked for known attack vectors.
**Plans**: TBD

Plans:
- [ ] 83-01: `BrandingSettingsPage.tsx` scaffold — Settings nav entry (gated on `branding:manage`, hide-don't-disable), page layout, color picker section (react-colorful) with WCAG contrast badges (colord), font picker with curated list
- [ ] 83-02: Feel levers + live preview panel — density/radius/glow/type-scale/motion-speed controls; live preview component showing button, chip, nav item, input, badge with real-time `setProperty` updates; Save + Reset-to-Kinetica-default
- [ ] 83-03: Custom CSS editor (CodeMirror 6 CSS mode, reusing existing `@codemirror/lang-sql` dep pattern), theme-guard ALLOWLIST updated with justification comments for brand admin components

---

### Phase 84: Verification + Live UAT
**Goal**: The entire v1.16 milestone is proven correct — automated gates green on both stacks and a blocking live operator walk-through attests every brandable capability end-to-end with a compiled verification record.
**Depends on**: Phase 83 (all features must be complete)
**Stack**: BOTH + operator
**Requirements**: VERIFY-V116-01
**Success Criteria** (what must be TRUE):
  1. All automated gates pass: frontend vitest 100% from `packages/web`; web `tsc` clean; server `tsc` clean; server vitest SET-BASED (failing files ⊆ TD-V16-TEST-ISOLATION); theme-guard green including the extended structural-token guard.
  2. The live operator walk-through attests: Aurora default theme renders correctly in dark and light mode out-of-the-box; an admin can brand logo/name/colors/fonts/feel live with no FOUC on apply + reload; Reset restores the Kinetica defaults cleanly.
  3. Custom CSS sanitization is verified live: injecting a `url()` exfiltration pattern is blocked; a legitimate CSS rule (e.g. `button { letter-spacing: 0.05em }`) applies and persists through reload.
  4. A user without `branding:manage` cannot access the Branding settings page and `PUT /api/branding` returns 403.
  5. Any gaps surfaced during the live walk-through are fixed in-session with repro-test-driven closure and re-walked to PASS before the verification record is compiled.
**Plans**: TBD

Plans:
- [ ] 84-01: Automated gate run + gap triage (both stacks, theme-guard, server supertests both auth modes)
- [ ] 84-02: Live operator walk-through — default Aurora dark+light; brand logo/name/colors/fonts/feel live; no-FOUC verify; custom-CSS sanitize+scope; WCAG feedback; logo-upload validation; non-permitted user blocked
- [ ] 84-03: Compile 84-VERIFICATION.md; fix any in-session gaps; re-walk PASS

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
| 80 | v1.16 | 0/3 | Not started | - |
| 81 | v1.16 | 3/3 | Complete | BRANDFND-01/02, SECA-V116-01, CSS-V116-02 |
| 82 | v1.16 | 0/3 | Not started | - |
| 83 | v1.16 | 0/3 | Not started | - |
| 84 | v1.16 | 0/3 | Not started | - |

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
