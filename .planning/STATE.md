---
gsd_state_version: 1.0
milestone: v1.17
milestone_name: Chart Number Formatting
status: unknown
stopped_at: Completed 86-02-PLAN.md
last_updated: "2026-06-26T19:23:28.794Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 3
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-26 — v1.17 STARTED)

**Core value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.
**Current focus:** Phase 86 — chart-y-axis-number-format

## Current Position

Phase: 86 (chart-y-axis-number-format) — EXECUTING
Plan: 1 of 2

### v1.17 Phase Map

| Phase | Name | Stack | Key Requirements |
|-------|------|-------|------------------|
| 85 | SI Smart-Abbreviation Number Format (formatter + editor) | FRONTEND-ONLY | FMT-V117-01, FMT-V117-02 |
| 86 | Chart Y-Axis Number Format (timeline + line) | FRONTEND-ONLY | AXIS-V117-01, -02, -03 |
| 87 | Verification + Live UAT | BOTH (gates) + operator | VERIFY-V117-01 |

**Dependency spine:** 85 → 86 → 87 (strictly sequential). Phase 86's Y-axis control REUSES the column number-format options including the new SI abbreviation, so Phase 85 must land first. Phase 87 verifies after both feature phases. All FRONTEND-ONLY (`packages/web`) except Phase 87's operator-involved live walk-through.

### v1.17 Scope (locked 2026-06-26)

**FRONTEND-ONLY** chart number formatting. Two features:

1. **SI smart-abbreviation number format (Phase 85):** a "smart abbreviation" choice in the v1.15 `column-display-config` formatter lib (d3-format `~s` → k/M/G/T, e.g. 1,234,567 → "1.2M") honoring the existing decimals control, plus its exposure (live preview + per-column persistence in `column_display_config`) in the Column Format editor. Applies across EVERY existing column-display-config surface (records table, chart tooltips, axis/series labels, map info popups). REUSE the v1.15 formatter — NO duplicated formatting logic.
2. **Per-widget Y-axis number format on timeline + line (Phase 86):** a Y-axis number-format control on the timeline + line config panels reusing the column number-format options (incl. SI). **Hybrid:** defaults to the bound value column's display-config formatter, overridable per-widget; clearing the override falls back to the column default. Applied to the **Y-axis TICK labels only** (recharts `tickFormatter`) in `TimelineRenderer` + the line chart renderer — tooltips/data labels keep their existing v1.15 column-config behavior.

`d3-format` is already a web dep. NO server changes expected (flag any server diff). `AggregatedWidgetRenderer` remains the SOLE materialize trigger — this is pure read-path number formatting, no data-query coupling.

### v1.17 Locked Scope Decisions (operator, 2026-06-26)

- **Abbreviation = SI prefixes (k/M/G/T via d3 `~s`)**, NOT financial K/M/B/T (financial deferred → FMT-V2-01).
- **Y-axis config = HYBRID per-widget override** — defaults from the bound column's display config; clearing the per-widget override falls back to the column default.
- **Apply scope = Y-axis TICK labels ONLY** — the per-widget Y-axis override does NOT change tooltips or data labels (they keep their v1.15 column-config behavior).
- **Frontend-only; reuse the v1.15 formatter lib** — no duplicated formatting logic; no server/SQL change.

### v1.17 Test Gates (every phase)

- **Frontend phases (85, 86):** frontend vitest 100% from `packages/web`; web `tsc` clean; theme-guard.spec.ts green (theme tokens only, no raw hex); server unaffected (flag any server diff).
- **Phase 87 (verification):** ALL of the above + a blocking live operator walk-through (SI abbreviation applies across column-config surfaces; per-widget Y-axis override visible on timeline + line; default-from-bound-column confirmed; ticks-only scope confirmed — tooltips unchanged), with any gaps fixed in-session via repro-test-driven closure and re-walked to PASS.
- **Invariant (all phases):** `AggregatedWidgetRenderer` remains the SOLE materialize trigger — pure read-path number formatting, no data-query coupling.

### v1.17 Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| FMT-V117-01 | Phase 85 | Pending |
| FMT-V117-02 | Phase 85 | Pending |
| AXIS-V117-01 | Phase 86 | Pending |
| AXIS-V117-02 | Phase 86 | Pending |
| AXIS-V117-03 | Phase 86 | Pending |
| VERIFY-V117-01 | Phase 87 | Pending |

**Coverage: 6/6 (100%)**

### v1.17 Open Tech Debt (carried)

TD-V16-TEST-ISOLATION (server set-gate), TD-V14-WKB-SPIKE, GAP-54-04 (legend layer names), CALX-V2-* (calendar v2 backlog).

### v1.16 Phase Map

| Phase | Name | Stack | Key Requirements |
|-------|------|-------|------------------|
| 80 | Token Foundation + Aurora Default Theme | FRONTEND-ONLY | TOKENS-V116-01/02/03/04, THEME-V116-01/02/03 |
| 81 | Brand Config Server Foundation | SERVER-ONLY | BRANDFND-01/02, SECA-V116-01, CSS-V116-02 |
| 82 | Client Token Pipeline + FOUC Prevention + Identity | FRONTEND-ONLY | BRANDFND-03/04, BRANDUI-01 |
| 83 | Branding Admin UI | FRONTEND-ONLY | BRANDUI-02/03/04/05, CSS-V116-01, SECA-V116-02 |
| 84 | Verification + Live UAT | BOTH + operator | VERIFY-V116-01 |

**Dependency spine:** 80 → 81 → 82 → 83 → 84 (strictly sequential; each phase's output is the next phase's input). Phases 80 and 81 CAN run in parallel (80 is frontend-only, 81 is server-only, no shared outputs at execution time), but 82 requires both to be complete.

### v1.16 Scope (locked 2026-06-23)

White-label theming. Config model = **runtime admin UI** (permission-gated; brand persisted server-side, applied live, no redeploy). Brandable: logo + app name, color palette (+ light/dark), typography, custom-CSS override (sanitized/scoped). Plus the "Aurora" distinctive Kinetica default theme. **Styling approach (research-locked 2026-06-22): EXTEND the existing CSS-custom-property token system — no Tailwind/Shadcn.**

### v1.16 Key Architectural Decisions (locked)

- **Styling approach:** Extend CSS custom-property token system. `document.documentElement.style.setProperty()` for runtime token application (inline styles beat stylesheet specificity). `removeProperty()` for reset.
- **Aurora default theme baseline:** Kinetica violet `#7f40ed` on near-black `#0a0a12`, Manrope body + Space Grotesk display, compact density, glassmorphic panels, hex-mesh + aurora-glow body treatment. Full token table in `.planning/design/CHOSEN-DIRECTION.md`.
- **Two-tier accent rule:** `--accent` for fills only; `--accent-text` for readable accent-colored text/icons (`#c4b5fd` on dark, darker variant on light). WCAG guardrails enforce this.
- **Brand config server:** `brand_config` singleton SQLite table (`CHECK(id=1)`, `INSERT OR IGNORE` seed). Precedent: `column_display_config` (v1.15).
- **18th permission:** `branding:manage` — writes gated; `GET /api/branding` unauthenticated (login page needs brand before auth). Precedent: `dashboards:manage_access` (v1.10).
- **FOUC prevention:** inline `<head>` script reads `localStorage("kbi-brand-tokens")` synchronously before any CSS file parses. Extension of the existing dark/light FOUC guard in `index.html`.
- **Cross-tab propagation:** `BroadcastChannel("kbi-brand-updated")` + `window.focus` refetch fallback for suspended tabs.
- **SVG logo safety:** DOMPurify (SVG profile) at upload; always rendered as `<img>` never inline; MIME + magic-byte validation via `file-type`.
- **CSS sanitization:** PostCSS AST at `PUT /api/branding` save time (recommended; strips `url()`, `@import`, `@font-face`, `expression()`). Reserve DOMPurify for SVG/HTML only.
- **Custom CSS scoping:** OPEN DECISION 1 — settle at Phase 81/83 plan time: `@scope (#root)` (Baseline Dec 2025) vs no scoping (trust `branding:manage` boundary). If `@scope` chosen, `:root` overrides via custom CSS are blocked; document as intentional.
- **Chart color integration:** `useChartAxisColors()` extended to read `brandStore` for axis/grid colors (SVG presentation attributes don't resolve CSS vars). WMS map layer class-break colors are explicitly out of scope (per-layer designer data, not chrome).
- **Theme-guard extension:** extended in Phase 80 to cover structural token literals (spacing, type, radius, motion); brand admin components added to ALLOWLIST with justification comments in the same commit that introduces them.
- **New deps:** web — `react-colorful@5.7.0`, `colord@2.9.x`; server — `multer@2.2.0`, `DOMPurify@3.4.x`, `postcss` (+ `file-type`).

### v1.16 Open Decisions (must resolve at plan time)

| Decision | Phase | Options | Recommendation |
|----------|-------|---------|----------------|
| Open Decision 1: Custom CSS scoping | 81 / 83 | A: No scoping (trust permission boundary) / B: `@scope (#root)` (Baseline Dec 2025) / C: Server-side selector prefix `[data-kbi-app]` | Option B if `:root` override not needed from escape hatch; Option A if admins must override tokens via custom CSS |
| Open Decision 2: CSS sanitizer | 81 | PostCSS AST (walk every declaration node) vs regex (known unicode-escape bypass risk) | PostCSS AST — Pitfalls researcher confirmed regex is bypassed by real CVE patterns |

### v1.16 Test Gates (every phase)

- **Frontend phases (80, 82, 83):** frontend vitest 100% from `packages/web`; web `tsc` clean; theme-guard green (extended structural guard from Phase 80 onward).
- **Server phase (81):** supertests in BOTH auth modes (password + oidc); server `tsc` clean; server vitest SET-BASED (failing files ⊆ TD-V16-TEST-ISOLATION — NEVER a fixed pass-count).
- **Phase 84 (verification):** ALL of the above + blocking live operator walk-through.
- **Invariant (all phases):** `AggregatedWidgetRenderer` remains the SOLE materialize trigger — branding is a pure style/identity layer, no data-query coupling.
- **Theme-guard invariant:** brand admin components (`BrandColorPicker.tsx`, etc.) are added to the ALLOWLIST in the SAME commit that introduces them, with explicit one-line justification comments (pattern: `ChartConfigPanel.tsx`).

### v1.16 Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOKENS-V116-01 | Phase 80 | Pending |
| TOKENS-V116-02 | Phase 80 | Pending |
| TOKENS-V116-03 | Phase 80 | Pending |
| TOKENS-V116-04 | Phase 80 | Pending |
| THEME-V116-01 | Phase 80 | Pending |
| THEME-V116-02 | Phase 80 | Pending |
| THEME-V116-03 | Phase 80 | Pending |
| BRANDFND-01 | Phase 81 | Complete |
| BRANDFND-02 | Phase 81 | Complete |
| SECA-V116-01 | Phase 81 | Complete |
| CSS-V116-02 | Phase 81 | Complete |
| BRANDFND-03 | Phase 82 | Pending |
| BRANDFND-04 | Phase 82 | Pending |
| BRANDUI-01 | Phase 82 | Pending |
| BRANDUI-02 | Phase 83 | Pending |
| BRANDUI-03 | Phase 83 | Pending |
| BRANDUI-04 | Phase 83 | Pending |
| BRANDUI-05 | Phase 83 | Pending |
| CSS-V116-01 | Phase 83 | Pending |
| SECA-V116-02 | Phase 83 | Pending |
| VERIFY-V116-01 | Phase 84 | Pending |

**Coverage: 21/21 (100%)**

### v1.15 Scope (locked 2026-06-19)

Three feature areas (phase numbering continues from 74) — NOT frontend-only (server tables/endpoints + new permission):

1. **Client-side column formatting + custom labels (global per-table):** new `column_display_config` table (table_id + column → label + format spec) + CRUD; pure client formatter lib (numbers: commas/decimals/currency/percent + advanced d3-format string; dates: presets + custom pattern); client-side only (no Kinetica SQL change). New dep `d3-format` (web).
2. **Column Formatting editor UI** — per-table editor from the Tables area; per-column label + format with live preview; saves to global config.
3. **Apply labels + formatting** — records-table (headers=label, cells=formatted), chart tooltips + axes + in-chart series legends, map info popups (template + KV). Map layers legend EXCLUDED.
4. **View TTL keep-alive** — dashboard-level touch-query (get first records) a configurable lead-time before expiry, for filter-views + dynamic-views; verify-live that a read resets Kinetica TTL (re-materialize = documented fallback).
5. **App settings infra + 2 settings** — `app_settings` KV table + admin GET/PATCH + new admin-settings permission + admin settings UI; `default_view_ttl_minutes` (replaces hardcoded TTL=5 in both materialize endpoints) + `ttl_keepalive_lead_minutes` (default 1).

Test gates: frontend vitest 100% from `packages/web`; web + server `tsc` clean (separate gates); server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION (never a fixed pass-count). `AggregatedWidgetRenderer` stays sole materialize trigger; theme-tokens-only.

### v1.15 Open Tech Debt (carried)

TD-V16-TEST-ISOLATION (server set-gate), TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer names), CALX-V2-* (calendar v2 backlog).

### v1.15 Phase Map

| Phase | Name | Stack | Key Requirements |
|-------|------|-------|------------------|
| 74 | App-Settings Infrastructure + TTL Defaults | BOTH (server-heavy) | SETTINGS-V115-01, -02, -03 |
| 75 | Column Display Config Foundation | BOTH | COLCFG-V115-01, -02, -03 |
| 76 | Column Formatting Editor UI | FRONTEND-ONLY | COLEDIT-V115-01, -02, -03 |
| 77 | Apply Labels + Formatting at Render Surfaces | FRONTEND-ONLY | COLAPPLY-V115-01, -02, -03, -04 |
| 78 | View TTL Keep-Alive Touch | FRONTEND-ONLY | TTLKEEP-V115-01 |
| 79 | Verification + Live UAT | BOTH + operator | TTLKEEP-V115-02, VERIFY-V115-01 |

**Dependency spine:** Phase 74 is the FOUNDATION (no app-settings infra exists today — everything is env-var driven) and unblocks Phase 78 (which needs `ttl_keepalive_lead_minutes` + the configurable `expiresAt`). Phase 75 is the column-config FOUNDATION (server table+CRUD + pure formatter lib + store/helpers) and unblocks Phases 76 + 77, which are independent of each other. Execution: 74 → {75 (independent of 74), 78 (needs 74)} → {76, 77} (both need 75, parallel-safe) → 79 (verifies after all land).

**This is the first server-touching milestone since v1.12.** Server work: two new SQLite tables (`app_settings` KV + `column_display_config` keyed `table_id`+`column_name`) in `db.ts` SCHEMA_DDL; admin settings GET/PATCH + column-config CRUD endpoints in `index.ts`; `default_view_ttl_minutes` replaces the hardcoded `TTL = 5` at `index.ts:1057` (filter-materialize) + `index.ts:1720` (dynamic-view materialize) via `lib/materializedView.ts:35`; endpoints return `expiresAt` from the configured value.

**NEW PERMISSION (flag):** `app:manage_settings` added to the `lib/permissions.ts` catalog + `rbacSeed.ts` (admin gets it, once-only seed mirroring the v1.10 17th-permission `dashboards:manage_access` pattern; operator removals survive restarts) + mirrored byte-for-byte in the web `PERMISSIONS` list. Admin settings UI mirrors the v1.8 Users/Roles management page pattern (hide-don't-disable).

**NEW WEB DEPENDENCY (flag):** `d3-format` in `packages/web` (Phase 75) — for the advanced number-format string escape hatch in the pure formatter lib; web-only, no server/SQL coupling.

**Test gates (per phase):**

- Server phases (74, 75 server portion, 79): supertests in BOTH auth modes (password + oidc) + server `tsc` clean + server vitest SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky — NEVER a fixed pass-count).
- Frontend phases (75 client portion, 76, 77, 78): frontend vitest 100% from `packages/web` + web `tsc` clean + theme-guard.spec.ts green (theme tokens only, no raw hex).
- Phase 79 gates BOTH stacks + a blocking live operator walk-through (incl. the live TTLKEEP-V115-02 confirmation that a read resets the Kinetica view TTL; re-materialize = documented fallback).
- `AggregatedWidgetRenderer` remains the SOLE materialize trigger throughout — Phase 77 is read-path label/format injection (no new materialize) and Phase 78's keep-alive touch is a READ, not a materialize (statically assert the keep-alive hook never imports `materializeFilter`/`materializeDynamicView`).

### v1.15 Locked Scope Decisions (2026-06-19)

- **Global per-table config:** label + format spec attaches to `table_id` + `column_name`, reused across ALL dashboards using that table (set once, applies everywhere). Per-dashboard overrides deferred.
- **Client-side formatting only:** the formatter is a PURE client library — it NEVER alters the SQL sent to Kinetica. Numbers (commas/decimals/currency/percent + advanced d3-format string) + dates (presets + custom pattern); invalid/empty spec → raw value fallback.
- **Chart labels reach tooltips + axes + in-chart series legends** (not only tooltips). Records-table headers/cells + map info popups (template + KV) also use labels/formatting. The map LAYERS LEGEND (`LayersLegendPanel`) is NEVER affected — locked by an explicit test (COLAPPLY-V115-04).
- **Keep-alive = touch-query (READ) + verify-live:** lead-time exposed as `ttl_keepalive_lead_minutes` (default 1) so it can be moved earlier if a read-reset proves slow; re-materialize is the documented FALLBACK if reads don't reset TTL (validated live in Phase 79).
- **App-settings store is extensible** but only the two TTL settings are in scope this milestone.

### v1.14 Scope (locked 2026-06-18)

Three frontend refinements (phase numbering continues from 70):

1. **Numeric `<other>` bucket** — class-break numeric breaks emit `<other>` catch-all (`1:3,3:5,<other>`); default-ON for new/edited configs only; existing saved numeric layers untouched until re-saved. (`cbConfig.ts`, `wmsUrlBuilder.ts:392`, `CbConfigForm.tsx`)
2. **SHAPE* hidden for lat/lon points** — hide SHAPEFILLCOLOR/SHAPELINECOLOR/SHAPELINEWIDTH when `spatialMode === "latlon"`, in BOTH layer form (`KineticaWmsLayerForm.tsx:1184-1313`) and per-break advanced panel (`CbConfigForm.tsx:948-1056`); applies to point raster + cb raster; ALSO suppress WMS emission (`wmsUrlBuilder.ts:340-349`) so stale saved values don't leak.
3. **Group-by for timeline + numeric-line** — add optional `groupByColumn` mirroring the bar/line/pie pattern (`ChartConfigPanel.tsx:268-321`); single-metric-when-grouped (multi-metric only when no group-by); N-series rendering. (`Timeline*`/`NumericLine*` config panels + renderers + SQL builders)

All three FRONTEND-ONLY expected (`packages/web`): frontend vitest 100% + web tsc clean; flag any server diff. `AggregatedWidgetRenderer` stays the sole materialize trigger.

### v1.14 Open Tech Debt (carried from v1.13)

TD-V16-TEST-ISOLATION (server set-based gate), TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer names), CALX-V2-* (calendar v2 backlog).

### v1.14 Phase Map

| Phase | Name | Stack | Key Requirements |
|-------|------|-------|------------------|
| 70 | Numeric `<other>` Catch-All Bucket | FRONTEND-ONLY | CBOTHER-V114-01, -02, -03 |
| 71 | SHAPE* Hidden for Lat/Lon Point Layers | FRONTEND-ONLY | SHAPE-V114-01, -02, -03 |
| 72 | Group-By for Timeline + Numeric-Line Charts | FRONTEND-ONLY | GROUP-V114-01, -02, -03, -04 |
| 73 | Verification + Live UAT | BOTH + operator | VERIFY-V114-01 |

Phases 70/71/72 are INDEPENDENT (no cross-feature dependency) — any order or parallel. All three are FRONTEND-ONLY (`packages/web`): frontend vitest 100% (run from `packages/web`) + web tsc clean; flag any server diff. Phase 73 verifies BOTH stacks + a blocking live operator walk-through (mirrors v1.13 Phase 69 / v1.12 Phase 64), then compiles the verification record.

Test gates (every phase): frontend vitest 100% from `packages/web`; web + server `tsc` clean as SEPARATE gates; server vitest is a SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky — NEVER a fixed pass-count); theme-guard.spec.ts green (theme tokens only, no raw hex). `AggregatedWidgetRenderer` remains the SOLE materialize trigger (timeline + numeric-line are `usesAggregation:false` and own their SQL lifecycle — not routed through it).

### v1.14 Locked Scope Decisions (2026-06-18)

- **`<other>` default-on, new/edited only:** a missing `<other>` flag on an already-saved numeric config does NOT silently inject `<other>` — `coalesceCbConfig` must preserve current render until the layer is re-saved. Mirrors the categorical `<other>` shipped in v1.7 Phase 39.
- **Group-by collapses to a single metric:** enabling a group-by on timeline/numeric-line restricts to one metric (each series = one group value); multi-metric (1–4) stays available only when no group-by is set; UI enforces the mutual exclusion; renderers apply a top-N group cap.
- **SHAPE* hiding gates BOTH the UI AND the WMS emission:** hide fields when `spatialMode === "latlon"` in `KineticaWmsLayerForm` (layer-level) + `CbConfigForm` (per-break), and suppress SHAPE* param emission in `wmsUrlBuilder` so saved-but-hidden values don't leak. Pattern precedent: v1.9 POINT*/SHAPE* suppression under track mode.

## v1.13 Phase Map

| Phase | Name | Stack | Key Requirements |
|-------|------|-------|-----------------|
| 65 | Calendar SQL Builder + Kinetica Spike | FRONTEND-ONLY (pure lib) | CAL-V113-03 |
| 66 | Chart-Type Definition + Config Panel | FRONTEND-ONLY | CAL-V113-01, CAL-V113-02, CAL-V113-05 (cap) |
| 67 | SVG Calendar Renderer (read-only) | FRONTEND-ONLY | CAL-V113-04, CAL-V113-05 (re-fetch) |
| 68 | Cell-Drill Integration | FRONTEND-ONLY | CALDR-V113-01, CALDR-V113-02, CALDR-V113-03 |
| 69 | Verification + Live UAT | BOTH + operator | VERIFY-V113-01 |

All phases 65-68 are FRONTEND-ONLY (packages/web): frontend vitest 100% + web tsc clean; no server constraint applies. Phase 69 verifies BOTH stacks + a blocking live operator walk-through (mirrors v1.12 Phase 64 / v1.11 Phase 61), then compiles the verification record.

### v1.13 Locked Decisions (from milestone definition + research, 2026-06-16)

- **No new server routes:** calendar uses existing /api/sql + /api/filter/materialize; zero server diff expected through Phase 68.
- **SQL builder before renderer:** buildCalendarSql + computeCellBounds (Phase 65) must be complete and spike-verified before the renderer (Phase 67) is built.
- **No fromSwap() inside CalendarRenderer:** resolve fromTarget before building the SQL string — DATE_TRUNC SQL can contain FROM tokens that a first-FROM regex would clobber (same gotcha as TimelineRenderer line 202).
- **AggregatedWidgetRenderer = SOLE materialize trigger:** CalendarRenderer never imports materializeFilter; static grep asserted in Phase 68 and re-asserted in Phase 69.
- **computeCellBounds returns [cellStartIso, cellEnd = nextBucketStart minus 1ms]:** half-open DATE_TRUNC buckets + inclusive BETWEEN semantics; UTC only (never local-time constructors).
- **Client-side gap-fill via useMemo:** DATE_TRUNC + GROUP BY returns only populated rows; renderer must compute the full expected bucket set and fill missing positions with null (grey cells) — not collapse neighbors.
- **Color scale domain derived reactively:** useMemo(() => computeDomain(data), [data]) — never initialized once at mount; correctly rescales after filter changes.
- **Theme tokens only:** sequential palette exported from chartTheme.ts; empty-cell grey via CSS custom property; no hardcoded hex in CalendarRenderer.tsx or CalendarConfigPanel.tsx — theme-guard.spec.ts gate.
- **dv-isolated drill routing:** dv-bound cell click routes to addDvFilter(dynamicViewId) + markDvMaterializing; table-bound routes to setBulkFilters(tableId) + markMaterializing. Do NOT use dispatchDrillDown for BETWEEN (eq-only).
- **WMS map propagation verified in Phase 68 (not deferred to UAT):** per the v1.12 Phase 63.1 lesson.
- **Cell-count cap enforced at config-save (Phase 66):** guards against domain=year + subdomain=hour on wide datasets.

### Phase 68.1-02 Decisions (locked 2026-06-17)

- **CalendarConfig optional field extension:** `layoutMode?: "wrap" | "strip"` and `showDomainSubdomainControls?: boolean` — optional so Plan 03 renderer reads with `?? DEFAULT_CALENDAR_CONFIG.layoutMode` / `?? false`
- **DISPLAY section position:** inserted after respondToFilters row, before cap-probe hints — all inside the `tableId !== undefined` fragment; section uses `config-group-label` header (mirrors TimelineConfigPanel OPTIONS)
- **Info tooltip pattern:** native `title=` on `<span aria-label="About show domain/subdomain controls">ⓘ</span>` — no shared InfoIcon component (MapConfigPanel §643 precedent)
- **showDomainSubdomainControls default OFF:** opt-in; viewer gets live domain/subdomain dropdowns only when designer explicitly enables the feature

### Phase 68.1-03 Decisions (locked 2026-06-17)

- **`blocks` useMemo before early returns:** `layoutCalendar()` useMemo must precede all early-return render states (loading/error/empty) to prevent React hooks-count violation across conditional renders
- **View-local override pattern:** `const effX = viewerX ?? configX` — effDomain/effSubdomain thread through ALL downstream consumers (SQL, computeCellBounds, formatTimelineTick, handleCellClick); never calls patch/onChange
- **Dependent dropdown reset:** when viewer domain changes, reset viewer subdomain to `VALID_DOMAIN_SUBDOMAIN[newDomain][0]` if current subdomain invalid — mirrors CalendarConfigPanel.handleDomainChange
- **WRAP_WIDTH = 800px:** wrap mode breakpoint; scrollable overflow wrapper handles content wider than container
- **WEEK_START in renderer:** imported from calendarLayout.ts but used only in comment — actual DOW positioning is done by layoutCalendar; Phase 69 flips WEEK_START in calendarLayout.ts in a single edit

### v1.13 Open Tech Debt (carried from v1.12)

TD-V16-TEST-ISOLATION (server set-based gate in use), TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer names).

## v1.12 Phase Map

| Phase | Name | Stack | Key Requirements |
|-------|------|-------|------------------|
| 62 | Server — Materialize From DV View | SERVER-ONLY | DVDRILL-V112-03 (server portion) |
| 63 | Client — DV Drill-Down (keying + routing + read-path + chips/lifecycle) | FRONTEND-ONLY | DVDRILL-V112-01, -02, -04, -05 (+ client -03) |
| 64 | Verification + Live UAT | BOTH + operator | VERIFY-V112-01 |

Phase 62 is SERVER-ONLY (`packages/server`): targeted supertests in both auth modes + server tsc + server vitest SET-BASED known-flaky gate (failing files ⊆ TD-V16-TEST-ISOLATION — NEVER a fixed pass-count). No frontend constraint applies to 62. Phase 63 is FRONTEND-ONLY (`packages/web`): frontend vitest 100% (run from `packages/web`) + web tsc clean; no server constraint applies to 63. Phase 64 verifies BOTH stacks + a blocking live operator walk-through (mirrors v1.9 Phase 54 / v1.10 Phase 57 / v1.11 Phase 61), then compiles the verification record.

### v1.12 Locked Decisions (from milestone definition, 2026-06-15)

- **DV-isolated scope:** drilling a dv-backed widget filters ONLY that dynamic view — clicked + same-dv widgets update; source-table + other-dv widgets untouched (a dv is its own data scope, mirroring table-backed drilling).
- **Filter the dv's materialized view in place:** materialize `FROM <dv materialized-view name> WHERE <clicked filter>` — a filtered sub-view of the dv's OWN materialized view, NOT a new filter on the source table.
- **One server piece:** extend `POST /api/filter/materialize` to accept a dynamic-view source — NO new route, NO new infra.
- **Filter-store keying** must make a dv id un-collidable with a table id (composite / kind-scoped key or a dv-scoped slice) — root cause of the bug (`dispatchDrillDown` always keyed by `tableId`).
- **Read-path precedence** filtered-dv → dv: a dv-bound widget FROM-swaps to the filtered-dv view when a dv filter is active, falls back to the raw dv view when cleared; the dv-bound widget's materialize trigger (today gated OFF when `dynamicViewId` is set) must be re-enabled for the dv path.
- **Preserved invariants:** `AggregatedWidgetRenderer` remains the SOLE materialize trigger; the table-backed drill-down path is UNCHANGED; decoupled from the v1.11 action engine.
- **No new domain research** — root-caused this session in our own filter/dynamic-view pipeline.

### v1.12 Open Tech Debt (carried)

TD-V16-TEST-ISOLATION (server set-based gate in use), TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer names → quick task).

## v1.11 Phase Map

| Phase | Name | Key Requirements |
|-------|------|-----------------|
| 58 | Action Engine + Contract + Allow-List + Canary | ENGINE-V111-01..04, SAFETY-V111-01..02 |
| 59 | Radio-Group Widget — Registry Def + Config Panel | RADIO-V111-01, RADIO-V111-02 |
| 60 | Radio Renderer + Wiring + Persistence + MCP Seam Doc | RADIO-V111-03, SEAM-V111-01 |
| 60.1 | Radio Config UX — Structured Layer-Target Editor (reuse CbConfigForm) (INSERTED) | RADIOUX-V111-01 |
| 60.2 | Radio Dashboard Control — Multi-Target Options (INSERTED, pulled fwd from CTRL-V2-03) | RADIOMULTI-V111-01 |
| 61 | Verification + Live UAT | VERIFY-V111-01 |

Phases 58-60 are FRONTEND-HEAVY — likely zero server changes (new dep `zod@^3.23.8` in `packages/web` only; existing PATCH routes are the entire server surface). Flag any server diff. Frontend vitest must stay 100% (run from `packages/web`); web + server tsc clean as SEPARATE gates; server vitest is a SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky list — NEVER a fixed pass-count). Phase 61 verifies both stacks + a blocking live operator walk-through (mirrors v1.9 Phase 54 / v1.10 Phase 57).

### v1.11 Locked Decisions (from milestone questioning + research, 2026-06-10)

- Action contract = serializable `{ target (kind+id), configPatch }` envelope + zod (the only new dep; also the future MCP `inputSchema`). NOT JSON-Patch, NOT a typed command union.
- Versioned allow-list (`ALLOW_LIST_VERSION`) of patchable fields per target kind / widget type IS the AI-safety contract — ships in Phase 58 foundation, never retrofitted; no free-form `Object.assign`; meta keys (`id`/`tableId`/`type`/`__proto__`) permanently blocked.
- Engine routes to THREE target kinds: (a) widget.config + (b) map-layer config via `useDashboardLayersStore` incl. TOP-LEVEL `track_config`/`cb_config` (primary, verified) and (c) dynamic-view config (`dashboard_dynamic_views`, lighter verification).
- Same-dashboard targeting only; dangling target / absent field fails safe (typed no-op signal, no partial write).
- Read-once-at-mount is the #1 risk (prior GAP-24-01-A, track gaps 54-01..09) → mounted-renderer LIVE-re-render CANARY TEST is a Phase 58 day-0 deliverable; target renderers read live config at render time.
- Decoupled from drill-down/filter + sole-materialize-trigger; static source-grep assertion (DataFilterRenderer Phase 44 precedent) — engine never imports `materializeFilter`/`dropFilterView`/`addFilter`/`setBulkFilters`, never bumps `filterVersion`.
- MCP/AI DESIGNED-FOR + documented only (SEAM-V111-01); NO new server routes / WebSocket / action-log table this milestone.
- Action-engine overlay/state resets on dashboard-switch + logout as the NEXT store in the canonical lifecycle cleanup chain (currently 6 stores — see v1.6 6th-store entry; this adds the 7th).

### UNRESOLVED tensions — resolve at discuss/plan-phase 58, NOT in roadmap

- TENSION 1 (dispatch mechanism): thin `applyWidgetAction()` plain function (STACK) vs `useWidgetActionEngine` orchestrator hook + overlay store (ARCHITECTURE). Both agree on a transient overlay store; disagreement is whether persistence orchestration lives in a named hook (rollback UI, named MCP seam, mirrors `useDynamicViewMaterializeChain`) or inline in `DashboardOpen`. Decide before Phase 58 — affects file shapes directly.
- TENSION 4 (first use case scope): "radio switches map-layer render mode" requires layer-level patch routing to `useDashboardLayersStore` (Option B); a `widget.config`-level field is fully supported by the basic engine (Option A). VERIFY-V111-01 demands a map class-break render-mode switch → Option B routing is in scope (ENGINE-V111-03b). Confirm allow-list content + `track_config`/`cb_config` top-level threading at Phase 58 plan time. May need targeted research before Phase 58 if layer-routing interactions with `buildWmsParams`/`lastEmittedParamsRef` are unclear.

### v1.10 Locked Decisions (from new-milestone questioning, 2026-06-09)

- View-access granted to BOTH users (lowercased username) and roles; union semantics
- Bypass roles (see/open all): admin + designer. View-only roles (analyst) restricted to grants
- Private-by-default: a new dashboard is visible only to bypass roles until granted
- New `dashboards:manage_access` permission (17th), default admin + designer, gates grant/revoke
- Server-authoritative: list filter + open gating + dashboard-scoped data routes; grant changes dual-sink audited
- Security boundary: app-level visibility layer ONLY; Kinetica per-user creds remain the data-access authority (v1.0 model)
- Out of scope: per-dashboard EDIT grants, ownership/transfer, link-based public sharing

Open tech debt: TD-V16-TEST-ISOLATION, TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer names → quick task)

## v1.8 Locked Decisions (from milestone questioning, 2026-06-05)

- 4 built-in roles: admin (everything) / user admin (users + role-permission mappings) / designer (create+edit dashboards) / analyst (view-only interaction)
- Custom roles supported — user admin composes permission sets from a predefined permission catalog; built-in mappings editable too
- App-local role registry in SQLite (username → roles), many-to-many; **multiple roles per user, union of permissions**
- No user creation in app — identity stays Kinetica password / OIDC; "manage users" = role assignment
- Unassigned authenticated users default to **analyst**
- Kinetica `admin` username is ALWAYS app admin (bootstrap; Kinetica's built-in superuser); `APP_ADMIN_USERNAME` env var overrides (for OIDC deployments where IdP claim differs from "admin")
- Shared workspace — NO dashboard ownership column; any designer edits any dashboard
- Server-side route enforcement is authoritative; frontend gating is UX only
- No new npm dependencies — hand-rolled pure TypeScript using existing better-sqlite3 (^12.8.0)
- Roles are NOT stored in session rows — per-request synchronous SQLite lookup via `getEffectivePermissions`
- Permission strings are canonical constants (shared module, both server and client import) to prevent drift

## v1.10 Phase Map

| Phase | Name | Key Requirements |
|-------|------|-----------------|
| 55 | Access Model & Server Enforcement | ACCESS-V110-01..04, ENFORCE-V110-01..04 |
| 56 | Access-Management UI & List/Open UX | GRANTUI-V110-01..03, LISTUX-V110-01..03 |
| 57 | Verification & Live UAT | VERIFY-V110-01 |

Server phase (55) is server-only: supertests + server tsc + server vitest SET-BASED known-flaky gate (failing files ⊆ TD-V16-TEST-ISOLATION list — NEVER a fixed pass-count). UI phase (56) is frontend-only: vitest 100% + web tsc. No frontend constraint applies to 55 and no server constraint to 56.

## v1.8 Phase Map

| Phase | Name | Key Requirements |
|-------|------|-----------------|
| 46 | RBAC Schema + Data Layer | SCHEMA-V18-01, -02, -03 |
| 47 | Server Middleware + Route Guards | GUARD-V18-01..05 |
| 48 | /me Extension + Frontend Store + UI Gating | GATE-V18-01..05 |
| 49 | Users Management UI | USERS-V18-01..04, SAFE-V18-01 |
| 50 | Roles Management UI + Custom Roles + Audit | ROLES-V18-01..04, SAFE-V18-02, AUDIT-V18-01 |
| 51 | Verification + Live UAT | VERIFY-V18-01 |

## REPO RESTRUCTURE NOTE (2026-06-04/05 — read before touching code)

- npm-workspaces monorepo: frontend at `packages/web/`, backend at `packages/server/` (was double-nested `kinetica_bi/kinetica_bi/`)
- ALL pre-v1.8 planning-doc paths `kinetica_bi/src/...` → `packages/web/src/...`; `kinetica_bi/server/...` → `packages/server/...`
- Root scripts: `npm run dev` (web), `npm run dev:server`, `npm run test`, `npm run test:server`, `npm run test:all`, `npm run build`, `npm run build:server`
- `packages/server/src/env.ts` is the FIRST import in `index.ts` (dotenv before module-level env validation — closed TD-03; do not add imports above it)
- Git history squashed to single `Initial commit` — commit hashes/tags in older planning docs no longer resolve
- Known-red tests (pre-existing, verified on pristine baseline): server ~106 (TD-V16-TEST-ISOLATION); frontend 100% green as of v1.8 close (1568/1568 → now 1593+ after quick tasks)

## Performance Metrics

**By Milestone (cumulative):**

| Milestone | Phases | Plans | Timeline | Audit |
|-----------|--------|-------|----------|-------|
| v1.0 Authentication & Per-User Access | 3 | 16 | 2026-04-27 → 2026-04-29 (~3d) | tech_debt (19/19) |
| v1.1 OIDC SSO Support | 5 | 19 | 2026-04-30 → 2026-05-01 (2d) | passed (21/21) |
| v1.2 Interactive Dashboards | 4 | ~24 | 2026-05-01 → 2026-05-06 | pragmatic_close (12/12) |
| v1.3 Unified Dashboard Filtering | 5 | 14+3 gap-closure | 2026-05-06 → 2026-05-07 | pragmatic_close/tech_debt (33/34 req; VERIFY-V13-01 Partial; 3 TDs to v1.4) |
| v1.4 Map Info Popup | 7 | 23 (Phases 18-24) | 2026-05-07 → 2026-05-11 (5d) | passed (19/20 req; 1 Deferred → TD-V14-WKB-SPIKE → v1.5; 4 UAT gaps closed inline) |

**By Plan (v1.3):**

| Phase-Plan | Duration | Tasks | Files | Completed |
|------------|----------|-------|-------|-----------|
| 13-01 spike-runner | 25min | 2 | 1 | 2026-05-06 |
| 13-02 view-utils | 14min | 2 | 4 | 2026-05-06 |
| 13-03 endpoint | 16min | 2 | 2 | 2026-05-06 |
| 14-01 filter-view-store | 2min | 2 | 2 | 2026-05-06 |
| Phase 14-filter-view-store P03 | 2min | 2 tasks | 0 files |
| 15-01 dashboard-context | 3min | 3 | 3 | 2026-05-07 |
| 15-02 materialize-trigger+from-swap | 274min | 6 | 14 | 2026-05-06 |
| Phase 15 P03 | 15 | 2 tasks | 2 files |
| Phase 15 P04 | 5 | 3 tasks | 4 files |
| Phase 15 P05 | 5 | 4 tasks | 4 files |
| Phase 16 P01 | 11min | 5 tasks | 9 files |
| Phase 17-verification P02 | 525796min | 4 tasks | 6 files |
| 18-02 spatial-modules | 5min | 2 (TDD: 4 commits) | 4 | 2026-05-08 |
| 18-03 info-query-endpoint | 9min | 2 (TDD: 2 commits) | 3 | 2026-05-08 |
| Phase 19-config-schema P01 | 15 | 2 tasks | 4 files |
| Phase 19-config-schema P02 | 50 | 2 tasks | 8 files |
| Phase 20-info-selection-store P01 | 3min | 2 tasks | 2 files |
| Phase 20 P02 | 3min | 2 tasks | 4 files |
| 21-01 render-info-template | 1min | 1 task (TDD: 1 commit) | 2 | 2026-05-08 |
| 21-02 info-popup-component | 5min | 2 tasks (TDD: 4 commits) | 4 | 2026-05-08 |
| 21-03 map-renderer-integration | 95min | 2 tasks (TDD: 1 commit) | 4 | 2026-05-08 |
| Phase 22 P01 | 3 | 3 tasks | 5 files |
| Phase 22 P02 | 3 | 2 tasks | 2 files |
| Phase 22 P03 | 6 | 4 tasks | 4 files |
| Phase 23 P01 | 8 | 2 tasks | 5 files |
| Phase 23-info-card P02 | 9 | 3 tasks | 8 files |
| Phase 23 P03 | 12 | 2 tasks | 11 files |
| Phase 23 P04 | 2 min | 3 tasks | 3 files |
| Phase 24-verification P05 | 2 | 2 tasks | 3 files |
| Phase 24-verification P04 | 7 | 3 tasks | 3 files |
| Phase 24-verification P06 | 5min | 3 tasks | 2 files |
| Phase 26 P1 | 3 | 2 tasks | 2 files |
| Phase 26-server-spatial-where P26-02 | 2 | 1 tasks | 1 files |
| Phase 26-server-spatial-where P26-03 | 5min | 1 task | 1 file |
| Phase 27-spatial-filter-store P27-01 | 2min | 3 tasks | 3 files |
| Phase 27 P02 | 5 | 3 tasks | 4 files |
| Phase 28 P01 | 3 | 3 tasks | 3 files |
| Phase 28 P02 | 4 | 3 tasks | 4 files |
| Phase 29-draw-and-shape P01 | 8 | 2 tasks | 7 files |
| Phase 29 P02 | 4min | 2 tasks | 3 files |
| Phase 29 P03 | 30 | 1 tasks | 3 files |
| Phase 29-draw-and-shape P04 | 8min | 2 tasks | 4 files |
| Phase 29-draw-and-shape P05 | 15min | 1 task | 2 files |
| Phase 30-materialize-and-chips P30-01 | 5min | 3 tasks | 9 files |
| Phase 30-materialize-and-chips P30-02 | 7min | 2 tasks | 2 files |
| Phase 30 P03 | 6 | 2 tasks | 2 files |
| Phase 32 P01 | 9 | 3 tasks | 10 files |
| Phase 32 P02 | 4 | 2 tasks | 2 files |
| Phase 32 P03 | 8 | 2 tasks | 3 files |
| Phase 33 P01 | 5 | 2 tasks | 4 files |
| Phase 33-dynamic-view-store P02 | 4 | 2 tasks | 3 files |
| Phase 33-dynamic-view-store P03 | 7 | 3 tasks | 6 files |
| Phase 34 P01 | 5min | 2 tasks | 4 files |
| Phase 34 P02 | 6 | 3 tasks | 3 files |
| Phase 34 P03 | 9 | 1 tasks | 3 files |
| Phase 34 P04 | 19min | 3 tasks | 4 files |
| Phase 35 P02 | 5min | 2 (TDD: 3 commits) tasks | 2 files |
| Phase 35-widget-binding-and-pipeline P01-layers-schema-migration | 8 | 2 (TDD: 4 commits) tasks | 13 files |
| Phase 35-widget-binding-and-pipeline P03-orchestrator-hook | 16min | 2 (TDD: 4 commits) tasks | 7 files |
| Phase 35 P04 | 37min | 2 (TDD: 3 commits) tasks tasks | 3 files files |
| Phase 35 P05 | 40min | 2 tasks | 5 files |
| Phase 35 P06-map-renderer-and-layer-picker | 41min | 3 tasks | 7 files |
| Phase 36 P02 | 19 | 2 tasks | 1 files |
| Phase 36 P01 | 70 | 2 tasks | 1 files |
| Phase 36 P03 | 4 | 2 tasks | 4 files |
| Phase 38 P01 | 6 | 3 tasks | 8 files |
| Phase 38 P02 | 9min | 3 tasks | 12 files |
| Phase 38 P03 | 4 | 3 tasks | 6 files |
| Phase 39-01 foundation-palette-and-cleanup | 12min | 2 tasks | 5 files |
| Phase 39 P02 | 7min | 1 tasks | 2 files |
| Phase 39 P03 | 9min | 3 tasks | 3 files |
| Phase 40 P01 | 6min | 2 tasks | 5 files |
| Phase 40 P02 | 4 | 2 tasks | 3 files |
| Phase 41 P01 | 6 | 3 tasks | 6 files |
| Phase 41 P02 | 8 | 2 tasks | 4 files |
| Phase 42 P01 | 6min | 3 tasks | 10 files |
| Phase 42 P02 | 386 | 3 tasks | 9 files |
| Phase 44 P01 | 9min | 3 tasks | 9 files |
| Phase 44 P02 | 5min | 2 tasks | 4 files |
| Phase 44 P03 | 7min | 2 tasks | 4 files |
| Phase 45 P01 | 8 | 2 tasks | 4 files |
| Phase 45 P02 | 4 | 2 tasks | 4 files |
| Phase 45 P03 | 10min | 2 tasks | 3 files |
| Phase 46-rbac-schema-data-layer P02 | 15 | 2 tasks | 3 files |
| Phase 46-rbac-schema-data-layer P03 | 5 | 2 tasks | 6 files |
| Phase 47 P02 | 3 | 2 tasks | 2 files |
| Phase 47 P03 | 11min | 3 tasks | 8 files |
| Phase 48 P01 | 6 | 4 tasks | 8 files |
| Phase 48 P02 | 2 | 2 tasks | 3 files |
| Phase 48 P04 | 2 | 2 tasks | 4 files |
| Phase 48 P03 | 7 | 3 tasks | 4 files |
| Phase 49 P01 | 3min | 2 tasks (TDD: 4 commits) | 2 files |
| Phase 49 P02 | 6 | 3 tasks | 7 files |
| Phase 49 P03 | 4min | 3 tasks | 3 files |
| Phase 50-roles-management-ui-custom-roles-audit P01 | 10 | 3 tasks | 5 files |
| Phase 50 P02 | 11 | 3 tasks | 7 files |
| Phase 50 P03 | 8min | 2 tasks | 4 files |
| Phase 50.1-profile-page-logout P01 | 10 | 3 tasks | 11 files |
| Phase 50.2 P01 | 5 | 3 tasks | 9 files |
| Phase 50.3 P01 | 4min | 3 tasks | 5 files |
| Phase 51 P03 | 2 | 2 tasks | 2 files |
| Phase 52-track-spatial-mode-foundation P01 | 7 | 3 tasks | 10 files |
| Phase 52-track-spatial-mode-foundation P02 | 7 | 3 tasks | 8 files |
| Phase 53-render-narrowing-param-surfaces-color-cutover P02 | 2min | 2 tasks | 2 files |
| Phase 53 P01 | 5 | 3 tasks | 4 files |
| Phase 54 P01 | 12 | 1 tasks | 1 files |
| Phase 54 P02 | checkpoint-resolved | 2 tasks (1 auto + 1 checkpoint) | 1 file (54-UAT.md) | gaps_found |
| Phase 54 P04 | 3 | 3 tasks | 3 files |
| Phase 54 P06 | 5min | 2 tasks (TDD: 4 commits) | 6 files |
| Phase 54 P07 | 7min | 2 tasks (TDD: 3 commits) + checkpoint | 5 files |
| Phase 54 P08 (gap-54-08) | 8min | 2 tasks (TDD: 2 commits) | 4 files |
| Phase 54 P09 (gap-54-09) | 15min | 2 tasks (TDD: 2 commits) | 2 files |
| Phase 54 P10 (gap-54-10) | 5min | 2 tasks (TDD: 3 commits) + checkpoint | 3 files |
| Phase 55 P01 | 20 | 3 tasks | 7 files |
| Phase 55 P02 | 10min | 3 tasks | 3 files |
| Phase 56-access-management-ui-list-open-ux P01 | 7 | 2 tasks | 9 files |
| Phase 56-access-management-ui-list-open-ux P02 | 4 | 2 tasks | 2 files |
| Phase 57-verification-live-uat P01 | 4 | 1 tasks | 1 files |
| Phase 57-verification-live-uat P02 | checkpoint-resolved | 2 tasks (1 auto + 1 checkpoint) | 1 file (57-UAT.md) — overall_result: passed (2026-06-09) |
| Phase 57 P03 | 8 | 2 tasks | 2 files |
| Phase 58-action-engine-contract-allow-list-canary P01 | 7 | 2 tasks | 6 files |
| Phase 58-action-engine-contract-allow-list-canary P02 | 14min | 3 tasks (+1 deviation fix) | 11 files |
| Phase 58.1-action-engine-foundation-fix P01 | 10min | 3 tasks | 9 files |
| Phase 59-radio-group-widget-registry-def-config-panel P01 | 5min | 2 tasks | 4 files |
| Phase 59 P02 | 4 | 2 tasks | 4 files |
| Phase 60 P01 | 8 | 3 tasks | 7 files |
| Phase 61-verification-live-uat P01 | 3 | 2 tasks | 1 files |
| Phase 60.1-02 P02 | 18 | 3 tasks | 3 files |
| Phase 60.1 P01 | 3 | 3 tasks | 4 files |
| Phase 60.1 P02 | 7 | 3 tasks | 6 files |
| Phase 60.1-radio-config-ux-structured-layer-target-editor-reuse-cbconfigform P03 | 15 | 4 tasks | 5 files |
| Phase 60.2 P01 | 15 | 4 tasks | 9 files |
| Phase 62 P01 | 2min | 2 tasks | 2 files |
| Phase 62 P02 | 6min | 3 tasks | 2 files |
| Phase 63 P01 | 3min | 2 tasks | 4 files |
| Phase 63 P02 | 3 min | 2 tasks | 2 files |
| Phase 63 P03 | 11 min | 3 tasks | 2 files |
| Phase 63 P04 | 7 min | 1 tasks | 2 files |
| Phase 64 P01 | 8min | 2 tasks | 1 files |
| Phase 63.1 P01 | 5 | 3 tasks | 2 files |
| Phase 64 P03 | checkpoint-resolved | 3 tasks (Task 1 attestation + Task 2 compile + Task 3 tick/complete) | 4 files (64-UAT.md, 64-VERIFICATION.md, REQUIREMENTS.md, ROADMAP.md) — overall_status: passed (2026-06-15) |
| Phase 64 P03 | checkpoint-resolved | 3 tasks | 4 files |
| Phase 65 P01 | 6 | 2 tasks | 4 files |
| Phase 65 P02 | 3min | 1 task (NOT-RUN fallback) | 2 files (65-02-SUMMARY.md + calendarBin.ts annotation) |
| Phase 66 P02 | 5min | 1 task | 2 files |
| Phase 66 P04 | 2 | 2 tasks | 3 files |
| Phase 67 P01 | 4min | 3 tasks | 5 files |
| Phase 67 P02 | 5min | 2 tasks | 2 files |
| Phase 67 P03 | 3min | 2 tasks | 2 files |
| Phase 68 P01 | 2min | 1 task (TDD: 2 commits) | 2 files |
| Phase 68-cell-drill-integration P02 | 8 | 2 tasks | 3 files |
| Phase 68-cell-drill-integration P03 | 8min | 2 tasks | 4 files |
| Phase 68-cell-drill-integration P04 | 18min | 2 tasks | 2 files |
| Phase 68.1 P01 | 2min | 1 tasks | 2 files |
| Phase 68.2-calendar-week-anchor-spike-per-group-date-range-gap-fill P02 | 2min | 1 tasks | 1 files |
| Phase 68.2 P01 | 2 | 1 tasks | 2 files |
| Phase 68.2 P03 | 5 | 2 tasks | 4 files |
| Phase 69-verification-live-uat P69-02 | 10 | 1 tasks | 1 files |
| Phase 70 P01 | 4min | 3 tasks | 4 files |
| Phase 71 P01 | 3 | 2 tasks | 4 files |
| Phase 71 P02 | 6min | 1 tasks | 2 files |
| Phase 72 P01 | 3 | 3 tasks | 6 files |
| Phase 72 P02 | 5 | 2 tasks | 4 files |
| Phase 72 P03 | 4 | 2 tasks | 4 files |
| Phase 74-app-settings-infrastructure-ttl-defaults P01 | 6 | 2 tasks | 5 files |
| Phase 75 P02 | 25 | 2 tasks | 4 files |
| Phase 75-column-display-config-foundation P03 | 6 | 2 tasks | 5 files |
| Phase 76-01 P01 | 6 | 3 tasks | 2 files |
| Phase 77-apply-labels-formatting-at-render-surfaces P01 | 36 | 2 tasks | 2 files |
| Phase 77-apply-labels-formatting-at-render-surfaces P02 | 49 | 4 tasks | 8 files |
| Phase 77 P03 | 65 | 3 tasks | 5 files |
| Phase 78-view-ttl-keep-alive-touch P01 | 10 | 2 tasks | 3 files |
| Phase 80 P01 | 8 | 2 tasks | 4 files |
| Phase 80 P03 | 17 | 2 tasks | 6 files |
| Phase 81-brand-config-server-foundation P01 | 2 | 3 tasks | 4 files |
| Phase 82 P01 | 842 | 3 tasks | 6 files |
| Phase 82 P02 | 4min | 1 tasks | 1 files |
| Phase 82-client-token-pipeline-fouc-prevention-identity P03 | 900 | 3 tasks | 4 files |
| Phase 83-branding-admin-ui P02 | 6 | 3 tasks | 8 files |
| Phase 83 P03 | 490 | 3 tasks | 8 files |
| Phase 83-branding-admin-ui P04 | 12 | 4 tasks | 11 files |
| Phase 85 P01 | 370 | 2 tasks | 4 files |
| Phase 86-chart-y-axis-number-format P01 | 326 | 2 tasks | 7 files |
| Phase 86-chart-y-axis-number-format P02 | 271 | 2 tasks | 4 files |

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260607-fk4 | Configurable CSV download on Records Table (filtered view, displayed columns, capped) | 2026-06-07 | 6bc394c | [260607-fk4-add-configurable-csv-download-to-records](./quick/260607-fk4-add-configurable-csv-download-to-records/) |
| 260608-j5k | Map scale bar + fullscreen button (both opt-in config toggles; OL ScaleLine/FullScreen; live-toggle + CSS fix aabd7f7) | 2026-06-08 | aabd7f7 | [260608-j5k-add-a-map-scale-bar-config-option-to-sho](./quick/260608-j5k-add-a-map-scale-bar-config-option-to-sho/) |
| 260608-rbq | Configurable WMS loading indicator on the map (per-layer imageloadstart tracker; default ON) | 2026-06-08 | 1059c88 | [260608-rbq-add-a-configurable-wms-loading-indicator](./quick/260608-rbq-add-a-configurable-wms-loading-indicator/) |

## Accumulated Context

### Roadmap Evolution

- Phase 68.2 inserted after Phase 68.1 (2026-06-17, INSERTED — bug found in live calendar UAT): **Calendar week-anchor spike + per-group date-range gap-fill.** ROOT CAUSE: `gapFillCalendar` (Phase 67, `calendarGapFill.ts:82-99`) builds ONE GLOBAL subdomain axis (all distinct subdomain buckets across the dataset) and fills EVERY domain group with EVERY subdomain key — so a week×day group gets day-cells from OTHER weeks (as nulls), which `layoutDayBlock` positions into phantom columns 1,2,3 → a month-shaped block with only the real week's column filled. Latent since Phase 67 (flat layout cross-filled too); 68.1's wrapping exposed it. ENTANGLED with the unverified Kinetica week anchor: live labels showed week buckets on FRIDAYS (Oct 9/16/23) but `layoutCalendar` assumes `WEEK_START=1` (Monday) — the Phase 65 spike that confirms the anchor was NOT-RUN. Fix does BOTH: (1) run the live Kinetica `DATE_TRUNC` week-anchor spike → set `WEEK_START` correctly (resolves the Phase 65 NOT-RUN item); (2) replace the global axis with per-domain-group date-range gap-fill — each group contains ONLY the subdomain buckets within its own range; in-range missing = GREY tile, out-of-range partial-week slots = BLANK no-tile (operator decisions 2026-06-17). Frontend + a live SQL spike. New req CALUX-V113-03. Runs before Phase 69. NOT yet planned (run /gsd:plan-phase 68.2).

- Phase 68.1 inserted after Phase 68 (2026-06-17, INSERTED — operator feedback from live calendar): **Calendar UX — wrapped layout + on-widget controls.** Two changes from seeing the Phase 67 renderer live: (1) **GitHub week-block wrapping** — the current renderer lays out `columns = domain buckets × rows = subdomain buckets` (Phase 67 CONTEXT design), which produces one very tall column for fine subdomains over few domain groups (e.g. year×day, month×day short range). Replace with GitHub-style wrapped blocks: day subdomains wrap into 7-row week blocks (rows = day-of-week, cols = weeks within the domain group); sensible grids for other subdomains. (2) **Config-gated on-widget domain/subdomain dropdowns** — a config toggle (e.g. "Show domain/subdomain controls", default OFF) that, when ON, renders 2 VIEWER-FACING dropdowns on the widget so the dashboard viewer switches domain/subdomain live (re-fetches; enforces the 8 valid combos via VALID_DOMAIN_SUBDOMAIN/isValidCombo — same gating as the Phase 66 config panel). Distinct from the Phase 66 operator-only set-once config dropdowns. Combined into ONE phase per operator decision. Frontend-only. Sequencing: MUST land before Phase 69 verification so live UAT covers the final UX. NOT yet planned (run /gsd:plan-phase 68.1). New requirements to add (e.g. CALUX-V113-01 layout, CALUX-V113-02 interactive controls).

- v1.12 roadmap created 2026-06-15: Phases 62-64 (Drill-Down on Dynamic-View-Backed Widgets). 62 = server materialize-from-dv-view (DVDRILL-V112-03 server portion; SERVER-ONLY — extend `POST /api/filter/materialize`, no new route). 63 = client dv drill-down — dv-safe filter keying + dv-aware drill dispatch + filtered-dv read-path FROM-swap + removable chips + lifecycle reset (DVDRILL-V112-01/02/04/05 + client side of -03; FRONTEND-ONLY). 64 = verification + live UAT (VERIFY-V112-01; mirrors v1.9 P54 / v1.10 P57 / v1.11 P61). 6/6 requirements mapped, no orphans. Starts at 62 (v1.11 ended at 61). Standard granularity → 3 phases (focused bug-fix-as-feature; server / client / verification split). Locked invariants carried into success criteria: sole-materialize-trigger preserved, dv-isolated scope, table-backed path unchanged, no new server routes.

- Phase 60.2 inserted after Phase 60.1 (2026-06-13, INSERTED — pulled forward from v2): Radio Dashboard Control MULTI-TARGET options (RADIOMULTI-V111-01, pulled forward from CTRL-V2-03). One radio option drives multiple targets at once: `RadioOption.action` → `actions: WidgetAction[]` (mixed widget/layer/dv); select applies all via ONE setControlContribution write; OPTION-level switch-replace (build the full contribution + wholesale replace = stale targets drop for free; do NOT loop per-target merge). Config panel grows a per-option target list (add/remove) reusing each target's editor (layer → 60.1 full form). Back-compat normalizer `getOptionActions` (legacy single `action` → 1-elem array; no DB migration). Overlay store was already multi-target/control-keyed → moderate, mostly-UI lift. Frontend-only. Ships before the 61 gate; 61 walk then exercises a multi-target option. NOT yet planned (run /gsd:plan-phase 60.2).
- Phase 60.1 inserted after Phase 60 (2026-06-12, INSERTED): Radio Config UX — Structured Layer-Target Editor (reuse CbConfigForm). Operator feedback during the Phase 61 walk: the per-option raw "Config Patch (JSON)" textarea is unusable for non-JSON authors, and class-break (`cb_config` nested JSON string) is effectively unauthorable. New req RADIOUX-V111-01. When a radio option targets a map layer, render a render-mode picker + reusable `CbConfigForm` (the LayersModal class-break builder) bridged to the flat allow-listed configPatch via an adapter (mirrors the cb_config top-level↔config.cb_config split in effectiveLayers/deriveOverlays); raw JSON kept as collapsible "Advanced" fallback; widget/dv targets unchanged. Frontend-only. Sequencing: 60.1 ships BEFORE Phase 61 closes — 61's live walk authors a class-break option via this editor. NOT yet planned (run /gsd:plan-phase 60.1).
- Phase 58.1 inserted after Phase 58 (2026-06-10, URGENT): Action-engine foundation fix — allow-list uses wrong field name (`render_mode` vs real nested `config.renderMode`) + the layer overlay flat-spread can't reach nested config; Phase 58 canary only tested top-level track_config/cb_config so the gap shipped. Discovered during Phase 59 planning. Phase 59 plans (59-01/59-02) are WRITTEN but ON HOLD (unverified/unexecuted) — to be re-planned against the corrected allow-list after 58.1.

### Phase 61 Live Walk — PARTIAL + GAP-61-01 (recorded 2026-06-12)

- **Operator live walk-through partial:** §0 (P1/P3/P4), §1 (1.1-1.3), §2 (2.1-2.3), §4 (4.1) all attested PASS (2026-06-11). **NOT yet walked:** P2 (prepare a non-bypass analyst login) + entire §3 (3.1-3.3 — VIEWER-SAFE / TRANSIENT payoff, the headline v1.11 user story; requires the analyst login + a separate browser session). 61-UAT `overall_result` stays PENDING; 61-03 cannot compile `passed` until §3 is attested (gate requires §3 cited for SC1 + all sections PASS).
- **GAP-61-01 (minor, FIXED INLINE, commit f62da07):** in-map Layers legend stayed frozen on the SAVED layer config during a radio-group overlay switch — `legendKey`/`resolveLegendLayers` read the persisted `dashboardLayersStore` while the WMS tiles used overlay-merged `effectiveLayers`. Fix: both now derive from `effectiveLayers` (legendKey via useMemo). Regression-locked (3 new GAP-61-01 specs + updated PITFALL S-02 lock); MapChartRenderer 184/184, frontend 1938/1938, web tsc clean. Recorded RESOLVED in 61-UAT §5 (not deferred to a 61.x phase).
- **GAP-61-02 (major, FIXED INLINE, commit 4afad81):** layer visibility toggle (legend eye button) stopped working after a radio switch. A radio option captures ALL allow-listed layer fields (LAYER_CAPTURE_FIELDS incl. `config.visible`), so the active overlay pinned visible:true; `effectiveLayers` merges the overlay on top of the persisted `dashboardLayersStore`, masking the eye toggle's store write. Operator product decision (2026-06-12): "radio CAN hide a layer, but a live toggle RELEASES it." Fix: new `widgetActionStore.releaseLayerConfigField(layerId, field)` strips a field from every control contribution + re-derives; `useLayerVisibilityToggle` calls it for `"visible"` after the optimistic write so the explicit toggle wins (re-selecting a radio option re-pins — most-recent action wins). Regression-locked (4 store cases + new useLayerVisibilityToggle.spec.ts); frontend 1944/1944, web tsc clean.
- **NEXT (operator):** (1) re-walk §1.1/§1.2 — confirm the eye toggle hides/shows a layer after a radio switch (GAP-61-02); (2) set up P2 (non-bypass analyst login) + walk §3.1/§3.2/§3.3 (viewer-safe payoff). Then finalize 61-UAT overall_result → run 61-03 to compile 61-VERIFICATION.md + tick VERIFY-V111-01 + mark ROADMAP Phase 61 Complete.

### Phase 68 Plan 01 — Datetime-Between Chip Human-Readable Formatting (2026-06-16)

- **formatDatetimeRange added to columnTypes.ts:** pure UTC helper, no imports, no React. Formats datetime BETWEEN bounds as human-readable inclusive range (e.g. "Mar 2 – Mar 8, 2026").
- **sameDay check precedes sub-day logic:** full-day cells (00:00 → 23:59:59.999) collapse to date-only; partial-day cells show hour granularity; multi-day cells show en-dash range.
- **Only the datetime arm of the between branch is changed:** numeric/string between paths verbatim unchanged; eq datetime path unchanged.
- **5 new spec cases green:** no T/Z chars in output, week range has en-dash + both dates + year, single-day collapses, hour range shows "HH:00", numeric between unchanged.
- **CALDR-V113-01 chip-copy half complete:** Plan 68-02 (cell-click dispatch) can now write between datetime filters whose chips display correctly.

### Phase 67 Plan 03 — WidgetRenderer Wiring Complete (2026-06-16)

- **CalendarRenderer wired:** Phase 66 placeholder `<div>` replaced with `<CalendarRenderer widget={effectiveWidget} tables={tables} />`. Import added alongside sibling renderer imports. Branch stays before AggregatedWidgetRenderer fallthrough (sole-materialize-trigger invariant preserved).
- **4 new spec assertions:** routes to CalendarRenderer (sentinel mock), no AggregatedWidgetRenderer fallthrough, tables prop threaded, static-grep confirms CalendarRenderer.tsx has no materializeFilter/dropFilterView imports.
- **Phase 67 complete:** 3/3 plans done; full suite 2255/2255; web tsc clean. CAL-V113-04 integration wired.

### Phase 66 Plan 02 — dynamicViews Threading (2026-06-16)

- **ConfigPanelProps.dynamicViews added as optional:** existing panels (Timeline/DataFilter/Legend/Map) are unaffected — field is optional so no forced prop threading; mirrors the `widgets?` and `tables?` optional pattern.
- **ChartConfigPanel `<Custom>` slot now forwards dynamicViews:** Plan 66-03 CalendarConfigPanel can consume it directly from props to render a dv-aware data-source picker (CAL-V113-01).
- Pre-existing tsc error (`estimateCalendarCells.spec.ts` cannot find module) confirmed as Phase 66-03 spec written ahead of implementation — not caused by these changes.

### Phase 65 Plan 02 — DATE_TRUNC Spike NOT-RUN (2026-06-16)

- **Spike NOT-RUN:** `/api/sql` on `localhost:4000` requires a valid Kinetica session; executor cannot authenticate without reading `packages/server/.env` (security-prohibited). Fallback path executed per plan spec.
- **calendarBin.ts annotated:** `KINETICA_DATE_TRUNC_UNITS` comment updated to NOT YET VERIFIED, FLAGGED for Phase 69 UAT (CAL-V113-03).
- **Exact spike queries recorded** in 65-02-SUMMARY.md for operator to run during Phase 69 live walk-through.
- **Documented assumptions remain in force:** UTC bucketing; Monday/ISO week start (`offset = (getUTCDay() + 6) % 7`).
- **All gates passed:** 2185/2185 vitest green; web tsc clean; no server/components diff.

### Phase 64 Plan 03 — Milestone Gate Compiled (2026-06-15)

- **64-VERIFICATION.md overall_status: passed** — RPereira 2026-06-15. 4/4 ROADMAP SCs verified. SC1: dv-isolated live drill confirmed (dv-backed pie + bar chart); SOURCE-TABLE widget UNAFFECTED (killed bug proven fixed). SC2: table-backed path unchanged; sole-materialize-trigger held; scopes never crossed. SC3/SC4: automated gates ALL PASS (post-63.1 vitest 2141/2141). VERIFY-V112-01 satisfied. ROADMAP Phase 64 Complete. v1.12 ready for /gsd:complete-milestone 1.12.
- **GAP-64-MAP (RESOLVED, Phase 63.1):** UAT found a dv-backed WMS map layer did not FROM-swap to the filtered-dv view on a chart drill. Closed by Phase 63.1 (commits 7751e1e + 0e4c9b3, 63.1-VERIFICATION.md PASS 4/4) before attestation. DVDRILL-V112-02/-04 map path now satisfied.

### Phase 64 Plan 01 Gate Results (recorded 2026-06-16)

- **overall_verdict: ALL PASS** — HEAD 408259d; frontend vitest 2133/2133 (95 files, 0 failures), web tsc exit 0, server tsc exit 0, server set-gate 8 failing files all in TD-V16-TEST-ISOLATION (identical to Phase 61 baseline — no new server regressions from Phase 62 dv extension), targeted v1.12 web specs 257/257 (5 files), targeted v1.12 server specs 55/55 (3 files). Source tree clean — Phases 62 + 63 committed. NOTE: post-63.1 authoritative count is 2141/2141.

### Phase 61 Plan 01 Gate Results (recorded 2026-06-11)

- **overall_verdict: ALL PASS** — HEAD 162e514; frontend vitest 1935/1935 (92 files, 0 failures), web tsc exit 0, server tsc exit 0, server set-gate 8 failing files all in TD-V16-TEST-ISOLATION (unchanged from Phase 57 baseline), targeted v1.11 specs 210/210 (10 files). v1.11 Phases 58-60 confirmed frontend-only (server diff guard empty).

### Key Phase 58 Plan 02 Decisions (locked 2026-06-10)

- **Session overlay store (7th store):** `useWidgetActionStore` with widgetOverrides/layerOverrides/dynamicViewOverrides; reset in DashboardsPage cleanup as 7th store after dynamicViewStore; INVARIANT: ACTION-ENGINE-NO-FILTER enforced by static grep
- **applyWidgetAction dispatch:** resolves target from ActionLookups, validates via validateActionPatch, idempotency-guards via fingerprint, writes overlay; TRANSIENT-ONLY (zero network calls)
- **DashboardContext.applyWidgetAction:** optional field with safe no-op default — non-breaking for existing specs; only production DashboardsPage passes real dispatch closure
- **WidgetRenderer effectiveWidget:** scoped `widgetOverrides[widget.id]` selector merged into effectiveWidget before dispatch by type; depth-1 merge consistent with allow-list granularity
- **MapChartRenderer effectiveLayers:** layerOverrides selector + useMemo AFTER allLayers read; includedLayers reads from effectiveLayers; top-level spread puts track_config/cb_config at DTO top level correctly
- **layerOverrides typed as Record<number, Record<string, unknown>>:** DashboardLayerDto does not have render_mode/visible/opacity at top-level; generic type avoids TS errors while keeping top-level merge semantics
- **Canary map assertion boundary:** jsdom cannot render OL canvas; overlay reach proven via layerOverrides in store + no map.dispose call after overlay write (no remount)

- v1.11 roadmap created 2026-06-10: Phases 58-61 (Programmable Widgets — Cross-Widget Control). 58 = action engine + contract + allow-list + canary (frontend, no UI; ENGINE-V111-01..04 + SAFETY-V111-01..02), 59 = radio-group registry def + config panel (RADIO-V111-01..02), 60 = radio renderer + wiring + persistence + MCP seam doc (RADIO-V111-03 + SEAM-V111-01), 61 = verification + live UAT (VERIFY-V111-01). 11/11 requirements mapped, no orphans. Starts at 58 (v1.10 ended at 57). Standard granularity → 4 phases matches research build order. TENSION 1 (dispatch mechanism) + TENSION 4 (layer-vs-widget first use case) deliberately left to discuss/plan-phase 58.

- v1.10 roadmap created 2026-06-09: Phases 55-57 (Per-Dashboard View Permissions). 55 = access model + server enforcement (server-only), 56 = access-management UI + list/open UX (frontend-only), 57 = verification + live UAT. 15/15 requirements mapped, no orphans.

- v1.9 roadmap created 2026-06-07: Phases 52-54 (Better Track Rendering)

- Phase 50.3 inserted after Phase 50: Light-mode theming fixes (RolesPage non-existent CSS vars, role-chip hardcoded greens) + popover clipping (overflow container) + UAT light-mode pass (URGENT — operator screenshots pre-UAT 2026-06-06)
- Phase 50.2 inserted after Phase 50: Users table layout fix (flexed-td bug) + UTC last-seen parsing fix + permission descriptions (URGENT — operator screenshots pre-UAT 2026-06-06)
- Phase 50.1 inserted after Phase 50: Profile Page + Logout (URGENT — operator-requested pre-UAT 2026-06-06: no logout UI exists; Topbar role chips relocating to a Profile page)

- Phase 44 added: Data Filter widget
- Phase 45 added: Timeline Chart widget
- v1.8 roadmap created 2026-06-05: Phases 46-51 (RBAC)

### Key v1.9 Architecture Decisions (locked at roadmap creation 2026-06-07)

- **TRACKFIX-V19-08 (GAP-54-09, 2026-06-08):** Track spatial-filter targets translate to `{spatialMode:"latlon", lonCol:xCol, latCol:yCol}` at all MapConfigPanel paths (new-row, changeTable already in Phase 52; changeMode repopulation + displayMode coercion added in Phase 54-09). `SpatialTarget` type and `isSpatialTargetEligible` remain byte-unchanged (3-mode wire union). Legacy stored `spatialMode:"track"` rows are coerced to `displayMode:"latlon"` for radio display; `changeMode("latlon")` on a track table repopulates columns from `isTrackTable`.
- **SpatialMode union extension:** `"latlon" | "wkt" | "wkb" | "track"` — track added as a first-class member. All existing `autoSuggestSpatialMode` callers and `isSpatialTargetEligible` must handle the new value explicitly. Track is NOT eligible as a spatial-filter target (isSpatialTargetEligible returns false — mirrors WKB deferral gate; track rows are not lat/lon or geometry targets for bbox/lasso/circle spatial filtering).
- **Column pickers for track mode:** Four fields — x (longitude of track point), y (latitude), track ID (defaults to `TRACKID` when present, case-insensitive), ordering (defaults to `TIMESTAMP` when present, case-insensitive). Defaults apply only at suggestion time; user can change any field.
- **Auto-suggest:** `autoSuggestSpatialMode` extended to detect the track column shape (TRACKID + x + y + TIMESTAMP present, case-insensitive). Auto-suggest sets mode to "track" and pre-fills defaults. User can freely switch to any other mode (no lock-in).
- **Render mode narrowing:** When spatialMode === "track", the render mode picker filters to ["raster", "classbreak"] only. Heatmap option is suppressed (not hidden post-selection — absent from the list entirely).
- **Param surface gating:** Two render paths under track — (a) track+raster: show ONLY track styling params (head color/size/shape, trail color/width); point, shapeline, shapefill param groups rendered with `display:none` or conditional exclusion; (b) track+classbreak: show CB break builder + track params; per-break point/shape advanced fields suppressed.
- **WMS emission:** Track+raster emits `DOTRACKS=TRUE` + `TRACK_*` params. Track+cb_raster emits comma-separated `TRACK_*` under `STYLES=cb_raster` per Phase 37 spike Decision Record. These are regression-locked with lastEmittedParamsRef fingerprint coverage (mirrors Phase 38/39 CB-V17-09 pattern).
- **Color picker:** Replace raw AARRGGBB hex text inputs for track head and trail colors with a proper color picker component (with alpha channel support). The existing 8-char AARRGGBB standard is preserved at the WMS emission level — the picker converts to AARRGGBB internally.
- **Cutover detection:** `track_config.enabled === true` with no `track` spatial mode = old-model layer. These layers show the `.widget-map-reconfigure` overlay (same component and pattern as v1.2 Phase 12 `.widget-map-reconfigure` for Phase 11 layers). Non-track layers and layers already on the new model are unaffected.
- **TrackSubSection removal:** The v1.7 Phase 40 `TrackSubSection` component and `"Treat as track table"` override checkbox are deleted. No compatibility shim needed — the cutover overlay handles old-model layers.
- **No new npm dependencies expected:** Color picker may be hand-rolled (alpha-aware AARRGGBB input) or a thin wrapper; decision deferred to Phase 53 planning. No new backend endpoints expected.
- **Test baseline:** Frontend must remain at 100% green. Server failures must stay ⊆ TD-V16-TEST-ISOLATION known-flaky list. Phase 53 WMS emission regression lock will add targeted vitest specs for the Track+Raster and Track+CB_Raster emission paths.

### Key v1.8 Architecture Decisions (locked at roadmap creation 2026-06-05)

- **No new npm dependencies:** RBAC is pure TypeScript using existing `better-sqlite3` (synchronous reads = no async plumbing in the permission check path). CASL, casbin, accesscontrol all rejected.
- **New server files:** `packages/server/src/lib/rbacDb.ts` (getEffectivePermissions + CRUD helpers), `packages/server/src/lib/rbacSeed.ts` (idempotent boot-time seed), `packages/server/src/rbac.ts` (requirePermission factory). `db.ts` + `index.ts` are the only existing files modified on the server side.
- **requirePermission factory:** Returns `[requireAuth, rbacCheck]` — requireAuth populates `req.user`, rbacCheck reads effective permissions from SQLite and returns 403 with `code: "PERMISSION_DENIED"` or calls `next()`. Mirrors the REAUTH_REQUIRED pattern from v1.0.
- **Analyst-passthrough boundary (GUARD-V18-03):** `POST/DELETE /api/filter/materialize`, `POST /api/info/query`, `GET /api/top-values`, column-stats, quantile, `POST /api/dynamic-view/materialize`, `POST /api/dynamic-view/:id/drop`, `/api/wms`, read-path SQL — all remain `requireAuth` ONLY. A comment block at the route registrations in `index.ts` documents this boundary. Gating any of these on write permissions breaks the core analyst experience.
- **GUARD-V18-05 (test suite migration) is MANDATORY in Phase 47:** `createAdminSession(db)` seeds a session AND grants admin role before the middleware lands. Every spec file that creates sessions must use this helper. Without it, Phase 47 produces 403s on every existing route test. This is a phase-blocking prerequisite, NOT a follow-up task.
- **Roles NOT in session rows:** `getEffectivePermissions(username)` reads from `user_roles` on every permissioned request. better-sqlite3 synchronous join is sub-millisecond at this data volume. No caching. A user whose roles are changed sees the new permissions on their very next request.
- **`useAuthStore` extension (not a new store):** `AuthUser` and `MeResponse` widened with `roles: string[]` + `permissions: string[]`; `hasPermission(perm: string) => boolean` selector added to existing `useAuthStore`. No new store, no new fetch loop, no new reset chain entry.
- **Permission string canonical constants:** A shared module exports a `PERMISSIONS` constants object; both server (requirePermission calls) and client (hasPermission calls) import from it. TypeScript catches typos at compile time. Prevents silent string drift between server enforcement and frontend gating.
- **Bootstrap admin:** `APP_ADMIN_USERNAME` env var (default `"admin"`) always resolves all 15 permissions regardless of DB state — short-circuits before any DB lookup. Server boot emits a structured warning when `AUTH_MODE=oidc` and the var is at the default `"admin"` value (OIDC IdP claim may differ from "admin").
- **SAFE-V18-01 placement:** Last-admin protection lives in Phase 49 with the assign/revoke API — the API rejects role revocations that would leave zero non-bootstrap admins. Bootstrap is always exempt.
- **SAFE-V18-02 placement:** Escalation guards live in Phase 50 with the role management routes — user_admin cannot assign admin role, cannot edit admin role mappings, cannot grant custom role permissions beyond their own effective set.
- **AUDIT-V18-01 placement:** Audit log extension lives in Phase 50 alongside the management routes that mutate state. Extends existing OBS-01 JSON log with actor, target, and before/after state. No new infrastructure.
- **Username source for Users page (Phase 49):** Distinct usernames from the sessions table (session history) union with usernames from `user_roles` table (existing assignments). Phase 49 planning should validate the exact sessions table schema before implementation.
- **Onboarding banner (USERS-V18-04):** Shown to admins when `user_roles` has zero rows for N authenticated usernames (i.e., they are on analyst default). Cleared when all users have explicit assignments.

### Key v1.5 Architecture Decisions (locked at roadmap creation 2026-05-11)

- **Spike is P1 gate (Phase 25):** No `spatialWhereClause.ts` code may be merged until SPIKE-V15-01 returns PASS for both latlon and WKT predicate forms. Mirrors v1.3 S1-S4 and v1.4 Phase 18 spike pattern. Runner script preserved at a known commit so future Kinetica-version re-runs are one-shot.
- **Phase 29 first-task rule:** Effect 6 mode-guard (`if (drawMode !== 'pan' && drawMode !== 'info') return`) is the very first code change in Phase 29 before any OL Draw interaction is added. This prevents V15-P-01 (OL Draw + singleclick popup dual-fire). Mode is read via `useSpatialFilterStore.getState()` (imperative, never stale closure).
- **V15-P-07 parenthesis lock (Phase 26):** `buildSpatialOrBlock` ALWAYS wraps the OR chain in outer parens: `(pred1 OR pred2)`. Unit test asserts exact paren structure for 2-shape + 1-column-filter input BEFORE any multi-shape UI exists. Single-shape bug is invisible; multi-shape breaks column filters silently.
- **V15-P-09 Zustand re-render lock (Phase 27):** Store updates fire ONLY at `drawend` (committed shape). In-progress geometry stays entirely inside OL's native VectorSource during live drawing — never written to Zustand, never triggering cross-map re-renders on `pointermove`.
- **V15-P-04 Mercator distortion lock (Phase 29):** ALL measurements (circle radius, bbox W×H, lasso area) use `ol/sphere.getDistance` / `getArea` (ellipsoidal). NEVER raw EPSG:3857 radius. WKT serialisation always uses `geom.clone()` then `writeGeometry({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })` — clone() is mandatory (transform mutates in place).
- **Sole materialize trigger invariant preserved (Phase 30):** `AggregatedWidgetRenderer` remains the ONLY component that calls `POST /api/filter/materialize`. `MapChartRenderer` draws and writes to the store; it never calls materialize directly. N map widgets × M table widgets would produce N×M DDL calls if this invariant is broken.
- **5th store reset block (Phase 27):** `useSpatialFilterStore.getState().reset()` is added as the 5th call (after filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore) at both `App.tsx` UNAUTHORIZED and `DashboardsPage.tsx` DashboardOpen cleanup. No DROP loop needed — shapes are session-only (no server resource associated).
- **Mixed chips in FilterBar (Phase 30):** Operator-locked decision — spatial chips appear in the SAME row as column-filter chips (not a separate row above). Chip label is `{Type} {N}` with measurement as secondary text: "Bbox 1 (5km × 3km)", "Circle 1 (2.5 km)", "Lasso 1 (12.4 km²)".
- **WKB deferred again (Phase 26 + 28 + 30):** WKB-mode spatial filter targets return HTTP 501 at the server (mirrors v1.4 info-query WKB deferral). `isSpatialTargetEligible` returns false for WKB mode at all three eligibility gates: config-time warning in MapConfigPanel, client-side materialize skip, server-side 501. TD-V14-WKB-SPIKE carry-forward.
- **Toolbar as React overlay, NOT ol/control/Control (Phase 29):** Anti-pattern locked — root-cause family of GAP-24-01-A and GAP-24-02-A. `MapDrawToolbar` is a React-rendered `<div>` absolutely positioned over the map canvas (`position: absolute; z-index: 1001`). CSS `pointer-events: none` on container, `pointer-events: auto` on buttons — prevents accidental OL event swallowing.
- **Lasso simplification mandatory (Phase 29):** `geometry.simplify(map.getView().getResolution() * 2)` called on the cloned geometry BEFORE WKT serialisation at every `drawend`. Near-zero shapes (< 10 px² area) rejected with a toast. Prevents WHERE clause size bombs (V15-P-03).
- **Selection state component-local (Phase 29 Plan 05):** `selectedShapeId` is component-local `useState` in `MapChartRenderer`, NOT in `useSpatialFilterStore`. Store stays unmodified (Phase 27 contract preserved). Selection is ephemeral UI state, not filter state.
- **Selection halo via Style[] (Phase 29 Plan 05):** 4px stroke + 1px `rgba(255,255,255,0.6)` inner halo; implemented as `Style[]` return from the VectorLayer style function. Fill-lighten approach rejected to preserve overlap-additive fill semantics for multi-shape OR-composition.
- **Phase 29 feature-complete (2026-05-12):** All 5 ROADMAP success criteria for v1.5 draw-and-shape satisfied. Phase 30 (materialize-trigger + chips) and Phase 31 (UAT) are unblocked.
- **Phase 30-01: type-only circular import for SpatialTarget (2026-05-13):** `client.ts` imports `SpatialTarget` from `lib/spatialTargets.ts` (which imports `WidgetDto` from `client.ts`). TypeScript resolves type-only cycles safely — no runtime circular dep. `export type { SpatialTarget }` re-export alone does NOT bring the name into local scope; both the local import and the re-export are needed.
- **Phase 30-01: DashboardContextProvider.widgets required, not optional (2026-05-13):** Chose required prop (not optional with default []) to make missing-context errors loud at compile time. Tests must supply `widgets={[]}` — this is cheap and makes the test surface explicit about the context shape.
- **`spatialTargets` stored in `widget.config` JSON blob (Phase 28):** No new SQLite table. `widget.config.spatialTargets: SpatialTarget[]` persisted via existing `PATCH /api/widgets/:id`. Stale-target cleanup is UX-level (MapConfigPanel warns when target table is no longer associated with dashboard).

### Key v1.4 Architecture Decisions (locked at roadmap creation)

- **HTML template policy:** Full HTML allowed in `info_template` — no sanitization. Dashboard authors are privileged users (analogous to saved SQL queries). Risk documented in PROJECT.md Key Decisions. Both Phase 21 (popup) and Phase 23 (Info Card) must use the same shared `renderInfoTemplate` helper so rendering is consistent.
- **Store-before-popup ordering:** `useInfoSelectionStore` (Phase 20) ships before popup (Phase 21) and Info Card (Phase 23) so both are pure view-layer consumers of the store. Store design is not influenced by either consumer's rendering needs.
- **Info Card / popup co-fetch via shared `<InfoSelectionView />` (relaxed Phase 23 2026-05-09):** Both the popup and the Info Card mount `<InfoSelectionView />`, which calls `POST /api/info/query` on dropdown-switch (when `state[newLayerId]` is undefined) and on Load more — using replayed spatial coords from the new sibling `useLastInfoClickContextStore` slice. The map click handler in `MapChartRenderer` remains the SOLE entry point for the initial multi-layer fan-out and the SOLE writer of `useLastInfoClickContextStore`. Other widget types (bar / line / pie / scatter / table / records / bignumber / map) cannot fetch info-queries — only the popup and the card via the shared view can. Pre-Phase-23 lock language ("Info Card never calls POST /api/info/query directly") is OBSOLETE; future readers reference this entry instead. (XWIDGET-V2-01 deferred — non-popup-non-card widgets remain non-fetchers.)
- **radiusPx→ground conversion is server-side:** `mapBbox`, `mapWidthPx`, `mapHeightPx` are sent in the request payload. Server computes the ground-distance threshold. Avoids client-side trigonometry duplication.
- **WKB spike is a P1 gate for Phase 18:** Endpoint code for the WKB branch cannot land until the spike confirms function name, argument types, and whether a conversion wrapper is needed. Spike outcome is committed to `18-SPIKE-NOTES.md` first.
- **Config schema split from config UI:** Phase 19 delivers only schema migrations and TS type updates (CONFIG-V14-01, CONFIG-V14-02). Phase 22 delivers the React UI panels (CONFIG-V14-03, CONFIG-V14-04). This prevents Phase 19 from growing to a two-week phase and keeps the schema stable before any UI work touches it.
- **Lifecycle reset integration points:** `useInfoSelectionStore.reset()` must be added to the same two sites used by `useFilterViewStore`: (1) `DashboardOpen` cleanup effect in `DashboardsPage.tsx`, (2) `App.tsx` unauthenticated effect. These are the canonical reset sites established in v1.3 Phase 15 — not new patterns.
- **Kill switch semantics:** Per-widget `infoEnabled: false` disables the OL click listener entirely (no listener registration). Per-layer `info_enabled = 0` removes the layer from the popup dropdown and skips its `POST /api/info/query` call.
- **Session-only store:** `useInfoSelectionStore` state is not persisted to URL, localStorage, or SQLite. Lost on page refresh. Mirrors `useFilterStore` lifecycle. URL/DB persistence is PERSIST-V2-01/02 (deferred).

### Key v1.3 Architecture Decisions (locked before Phase 13)

- Spike findings (S1-S4) are coupled into Phase 13 with the endpoint — endpoint shape depends on spike outcomes (schema-qualification, permission model)
- Endpoint is net-new `POST /api/filter/materialize` (NOT extending existing `/api/views/:id/materialize`) — stateless; no SQLite row for transient views; Kinetica TTL=5 (sliding) is sole cleanup
- `useFilterViewStore` (new) paired with `useFilterStore` (unchanged) — chips in filterStore, view names in filterViewStore; two stores reset on logout + dashboard-switch
- Dead-code deletion (`injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter`) is atomic with FROM-swap landing in Phase 15 — cannot coexist
- `_mv` (materialize version) cache-buster retained in WMS params; `_v` and `QUERY` removed — same view name gets `CREATE OR REPLACE`'d on filter change, OL caches by URL

### Phase 13 Plan 01 spike findings (locked 2026-05-06)

- **S1 PASS** — WMS LAYERS=`<materialized_view_name>` renders PNG tiles; MAP-V13-* requirements stay in v1.3 scope; Phase 16 LAYERS-swap buildable as planned
- **S2.a PASS (password)** — `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = 5)` succeeded for BI-user `admin` (`info.X-Kinetica-Group: DDL`, `count_affected: 500000`, dispatched internally to `/create/jointable`); Plan 13-03 wires `kineticaSql(req, ddl, { op: "MATERIALIZE" })` directly with no service-account fallback
- **S2.b N/A DEFERRED (OIDC)** — no OIDC token reachable in spike environment; Phase 15/17 must re-probe before v1.3 milestone close
- **S2.c PASS** — `DROP TABLE IF EXISTS` succeeded; idempotent (returns OK with `count_affected: 0` on already-dropped view); endpoint DELETE handler safe to call fire-and-forget
- **S3 RESOLVED** — verbatim error string captured: `SqlEngine: Object '<view-name>' not found (S/SDc:1513)` at HTTP 400. Phase 15 LIFE-V13-02 `isViewNotFoundError()` matches `/SqlEngine: Object '[^']+' not found/i` substring + `(S/SDc:1513)` Kinetica internal code
- **S4 BOTH WORK** — both qualified (`ki_home._kbi_filt_spike_test`) and unqualified (`_kbi_filt_spike_test`) LAYERS forms render PNG tiles; endpoint returns UNQUALIFIED view name (Plan 13-02 view-name builder produces bare `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`, no schema prefix, no `SHOW SCHEMAS` lookup needed)
- **Operator's default schema:** `ki_home` (recorded in case future Plan 13-NN needs it)

## Decisions

### Theming hardening (2026-06-15, tech-debt — recurring theme-drift bugs)

- Root cause of recurring theme bugs (blue radios, dark pie tooltip, RadioGroupConfigPanel referencing non-existent `--text-muted`/`--border-color` tokens via literal fallbacks): tokens existed but were applied inconsistently + no guardrail. Full hardening pass (commits 8418faf/4bcab02/6171b51/646135b + 762ed3e):
  - Added semantic tokens `--danger`/`--warning`/`--success`/`--on-accent` to global.css (dark + light) + `.text-danger/.text-warning/.text-muted/.text-accent` utility classes + global `input[type=radio],input[type=checkbox]{accent-color:var(--accent)}` normalization.
  - `lib/chartTheme.ts` = single home for data-viz literals: `DEFAULT_CHART_PALETTE`, per-chart `DEFAULT_*_COLOR`, `RECHARTS_TOOLTIP_PROPS` (contentStyle). WidgetRenderer/Timeline/NumericLine import it (deduped 5+ inline tooltip copies).
  - Converted all status/chrome hardcoded hex (incl. component .css) → tokens.
  - GUARDRAIL: `src/styles/theme-guard.spec.ts` fails CI on any raw `#hex` in `src/components/**/*.{tsx,css}` outside a minimal justified ALLOWLIST (data-viz/color-tooling: chart definitions, color pickers, draw overlays). Turns "operator catches it in screenshots" → "CI catches it." See [[ui-consistency-conventions]].
  - Frontend-only; full suite 2087/2087, web tsc clean, no server diff.
- [Phase 62]: 62-01: buildFilterViewName gains optional dynamicViewId -> _dv<id> segment (distinct from _t<id> + dv view); both-undefined throws (no silent _tundefined); table path byte-unchanged
- [Phase 62]: POST/DELETE /api/filter/materialize dv path: body/query dynamicViewId materializes FROM the dv's own materialized view (buildDynamicViewName) WHERE column-filters into a distinct _kbi_filt_..._dv<id>_s view; table path byte-unchanged; spatial+dv→400, empty→400, missing/other-dash dv→404; fail-safe on unmaterialized dv; no new route
- [Phase 63]: Parallel dv-keyed filter-store slices (NOT composite re-keying) — table path byte-unchanged, dv/table ids never collide
- [Phase 63.1]: Filtered-dv precedence applied at BOTH Effect 2 + Effect 3 call sites in MapChartRenderer so both OL layer construction AND updateParams re-fire paths emit LAYERS=filtered-dv + _mv=dvFilter.materializeVersion when active dv-filter present
- [Phase 63.1]: dvFilterViewsKey selector mirrors viewsKey but over useFilterViewStore.dvViews — raw dynamicViewsKey does not move on dv-filter apply/clear, so a new subscription was required to unblock the stuck map
- [Phase 64]: 64-VERIFICATION.md overall_status: passed (all 64-01 deterministic gates green + 64-UAT.md overall_result: passed); GAP-64-MAP closed by Phase 63.1 before attestation; final vitest 2141/2141 post-63.1; VERIFY-V112-01 satisfied; Phase 64 Complete
- [Phase 65]: computeCellBounds ISO output = toISOString() YYYY-MM-DDTHH:mm:ss.SSSZ; whereClause BETWEEN-compatible, single-quote-safe
- [Phase 65]: Week start = Monday/ISO (offset=(getUTCDay()+6)%7); documented assumption — Plan 65-02 confirms against live Kinetica
- [Phase 65]: buildCalendarSql: fromTarget pre-resolved by caller; no first-FROM regex swap; combo validation left to Phase 66 config panel
- [Phase 66-01]: SUBDOMAIN_GRANULARITY_MS[month] = 2_419_200_000 (28d) — smallest real month used as divisor to give conservative UPPER BOUND on cell count (more cells estimated, safer for cap enforcement)
- [Phase 66-01]: estimateCalendarCells({rangeMs, subdomain}) only — domain param not needed because subdomain bucket count IS the worst-case cell count; domain re-arranges cells into rows but does not multiply them
- [Phase 66-01]: buildCalendarRangeQuery accepts pre-resolved fromTarget (same contract as buildCalendarSql) — NO schema-prefixing logic inside; EXTRACT(EPOCH FROM ...) returns seconds, caller x1000 for ms
- [Phase 66-03]: CalendarConfigPanel subdomain dropdown renders only VALID_DOMAIN_SUBDOMAIN[domain] options (invalid ones hidden, not greyed); isValidCombo is defense-in-depth for direct config injection
- [Phase 66-03]: Cap probe uses tableRef (source table) as fromTarget for both table-bound AND dv-bound configs at config time; dv view is narrower so source-table span is a safe conservative upper bound; documented in code comment
- [Phase 66-03]: Cap probe failure (network/SQL error) resets capState to idle — cap is a UX guard, not a hard requirement; probe never blocks save on error
- [Phase 66]: usesAggregation:false is a locked invariant for calendar — keeps it out of AggregatedWidgetRenderer (sole-materialize-trigger); never flip this
- [Phase 66]: WidgetRenderer placeholder branch ships in Phase 66; real SVG CalendarRenderer deferred to Phase 67 — short-circuit already in place
- [Phase 67]: toCssColor replicated inside calendarColorScale.ts (not imported from TimelineRenderer) to keep lib pure
- [Phase 67]: emptyCell token uses same concrete hex as grid token on both themes (#e2e8f0 light / #1f2937 dark)
- [Phase 67]: gapFillCalendar exposes cellAt(d,s) O(1) helper for Phase-68 click guard (value === null test)
- [Phase 68-cell-drill-integration]: Toggle-off uses removeFilter/removeDvFilter (targeted column remove), not setBulkFilters with empty batch (which is a store no-op)
- [Phase 68-cell-drill-integration]: CalendarRenderer active-cell accent stroke derived from useChartAxisColors().accent — hex in chartColors.ts (lib/) keeps CalendarRenderer.tsx hex-free for theme-guard
- [Phase 68-cell-drill-integration]: appliedCell useMemo (mirrors TimelineRenderer appliedBand) is the single source of truth for both selected-cell highlight and toggle-off equality test
- [Phase 68-03]: respondToFilters defaults to false (OFF) — calendar is a drill CONTROL; stable full-grid by default; filter-awareness is opt-in via checkbox
- [Phase 68-03]: CalendarRenderer FROM resolution gated: OFF=base-table/raw-dvViewName (ignores fvViewName/dvFilterViewName); ON=Phase-67 full precedence; fvMaterializing suspend gate inside ON branch only
- [Phase 68-03]: Cell clicks (handleCellClick) NOT gated on respondToFilters — clicks always drive filters into stores regardless of toggle
- [Phase 68-04]: No MapChartRenderer.tsx wiring needed — calendar writes the same stores as existing drill (views[tableId]/dvViews[dvId]); existing Phase 63.1 FROM-swap already handles WMS propagation; specs PROVE it
- [Phase 68-04]: Static re-assertion uses import-line extraction (not full-source multiline regex) to avoid false positives from comments mentioning banned symbols in CalendarRenderer.tsx
- [Phase 68.1]: day subdomain rows=7 always (GitHub style); hour cols=6 (6×4); week cols=ceil(sqrt(count)) cap 13; month cols=4 (4×3); parseUTCMs normalizes Kinetica space-separated DATE_TRUNC strings to unambiguous UTC
- [Phase 68.1]: WEEK_START = 1 (Monday-ISO) is the sole week-anchor constant in calendarLayout.ts; Phase 69 flips it in one edit after confirming Kinetica DATE_TRUNC week anchor
- [Phase 68.2-02]: Week-anchor spike NOT-RUN again (Phase 68.2-02): same REAUTH_REQUIRED auth barrier; WEEK_START=1 (Monday-ISO) unchanged; Phase 69 re-flagged as verification owner for CAL-V113-03
- [Phase 68.2-01]: New calendarBuckets.ts module (not calendarBin.ts) for per-group bucket enumeration; fmtUTC (no toISOString) matches SQL DATE_TRUNC space-separator format; month last-day via Date.UTC(y,mo+1,0) day-0 trick
- [Phase 68.2]: gapFillCalendar gains (rows, domain, subdomain) params — minimal extension, preserves GapFillResult shape; per-group cell build via enumerateGroupBuckets
- [Phase 68.2]: subdomainKeys (top-level) = sorted union of all groups expected keys — informational; layout uses per-block cells
- [Phase 69-02]: 69-UAT.md shipped in "pending attestation" (all status: PENDING); 69-01-AUTOMATED-GATES.md not yet present at doc-ship time — automated_gates_verdict set to pending, operator fills §0 P3 at the 69-03 checkpoint
- [Phase 69-02]: Chat-fixes mini-table in traceability maps 344c274/4f4ef7c/90c8f3b/0a9d9f8 → confirming UAT sections; year×day h-scroll noted as expected (auto-scroll is v2 deferral)
- [Phase 70]: Numeric CB_VALS emits literal <other> for the <other> break (b.value === '<other>'), else min:max; no pre-encoding (CBOTHER-V114-01)
- [Phase 70]: <other> toggle moved (not copied) to a shared cbConfig.attr-gated block — renders once per mode; column-change default-on broadened to both valsTypes; preservation invariant (no auto-injection) regression-locked (CBOTHER-V114-02/03)
- [Phase 72]: Numeric-Line group-by: single-metric-when-grouped (non-destructive collapse to metrics[0]); grouped pivot passes numericBuckets:true for numeric bucket sort; one Line per top-N series on a single shared Y-axis with themeColorsFor ramp (no raw hex); drag-to-filter BETWEEN-on-xField preserved
- [Phase 74]: readPositiveIntEnv fallback-not-fail-fast: TTL env vars log warning + fall back to default on invalid; never throw (contrast AUTH_MODE which is critical)
- [Phase 74]: ttlKeepaliveLeadMinutes exposed on GET /api/me (not /api/auth/config); /api/auth/config stays auth-mode-only
- [Phase 74]: Phase 74 pivoted to env-var config: zero app_settings table, CRUD endpoint, new permission, or settings UI
- [Phase 75-01]: column_display_config endpoint URL locked as table-scoped (/api/tables/:tableId/column-display-config) — consumed verbatim by Plan 03 client store
- [Phase 75-01]: ColumnDisplayConfigRow type lives in types.ts (not db.ts) — consistent with DashboardDynamicView convention
- [Phase 75-01]: format_spec stored as opaque JSON-in-TEXT on server; FormatSpec discriminated union is web-side only (columnFormatter.ts in Phase 75-02)
- [Phase 75-01]: GET read endpoint uses requireAuth (not requirePermission) — any authenticated viewer can read for render surfaces (Phase 77)
- [Phase 75]: Percent preset in number formatter appends literal '%' (no ×100); only d3 escape hatch uses d3's '%' type which does ×100 (documented in code)
- [Phase 75]: Date formatting uses hand-rolled UTC getters (extends columnTypes.ts MONTH_NAMES pattern) — no d3-time-format added
- [Phase 75]: FormatSpec discriminated union lives in columnFormatter.ts (pure client type); server stores it as opaque JSON-in-TEXT
- [Phase 75]: resolveLabel/resolveFormatter co-located in columnDisplayConfigStore.ts (store imports disallow placement in pure columnFormatter.ts)
- [Phase 75]: ColumnDisplayConfigRow client type in api/client.ts (not server types.ts); client DTO for fetch helpers + store setConfig
- [Phase 76]: Single-file ColumnFormatEditorModal with sub-components (ColumnEditorForm, NumberControls, DateControls, D3Controls); baseline snapshot for dirty tracking; defaultSpecForKind builder
- [Phase 77-01]: RecordsTableRenderer: guard tableId with ternary (tableId !== undefined ? resolveLabel(tableId, col) : col) for dv-bound fallback; configVersion primitive selector subscription forces re-render; loadConfig useEffect keyed on tableId
- [Phase 77-01]: Test pattern for loadConfig: spy on listColumnDisplayConfig per-test (not upsertColumn-before-render) because setConfig on mount REPLACES store entries
- [Phase 77-02]: ColumnFormatTooltip uses RECHARTS_TOOLTIP_PROPS.contentStyle spread — passes theme-guard without allowlisting
- [Phase 77-02]: vi.mock factory uses require('react') for createElement/cloneElement — hoisted context has no ES module React import
- [Phase 77-02]: configVersion + loadConfig hooks placed before early-returns in Timeline/NumericLine to satisfy React hooks-count invariant
- [Phase 77]: formatValue callback injection into renderInfoTemplate: keeps pure lib store-free; null/undefined guard runs before formatter invocation
- [Phase 77]: COLAPPLY-V115-04 legend guard: two-pronged test (behavioral + static grep) locks LayersLegendPanel from ever receiving column display config wiring
- [Phase 78-view-ttl-keep-alive-touch]: W-based re-arm interval (not fixed expiresAt) avoids tight-loop; MIN_DELAY=1s first-touch floor; MIN_INTERVAL=30s re-arm floor
- [Phase 78-view-ttl-keep-alive-touch]: f:<tableId>/d:<dvId> key namespacing prevents filter-view/dynamic-view ID collision in shared timer+controller+window ref Maps
- [Phase 80]: Aurora dark palette: #7f40ed violet on #0a0a12; --accent-text #c4b5fd two-tier accent for fills vs readable text
- [Phase 80]: Light mode: warm off-white #eceaf3/#f6f5fb; --accent-text #6d28d9 (darker for WCAG readability on light)
- [Phase 80]: Font tokens use 'Manrope' (not Variable) until 80-02 adds fontsource self-hosting
- [Phase 80]: getComputedStyle over TS mirror for axis/grid/accent: CSS is single source of truth, Phase 82 brand overrides picked up automatically
- [Phase 80]: AURORA_CHART_PALETTE as TS const: series hues same dark/light, synchronous resolution required
- [Phase 80]: Property-aware structural guard regex: curated to font-size/radius/padding/margin/gap/ms, allows width/height/layout constants
- [Phase 80]: Variable font family names: Manrope Variable / Space Grotesk Variable — non-variable name silently falls to system font; fontsource-variable packages self-host with no CDN
- [Phase 80]: Two-tier accent-text: --accent for fills (buttons/borders/focus); --accent-text for persistent text/numbers/icons — hover hints remain --accent as transient affordance
- [Phase 81-01]: brand_config is new v1.16 table — CREATE TABLE IF NOT EXISTS sufficient; no ALTER/PRAGMA migration needed
- [Phase 81-01]: BRANDING_MANAGE granted to admin only via ALL_PERMISSIONS auto-inclusion; designer/user_admin/analyst unchanged — branding is operator/admin-level only
- [Phase 81-01]: branding:manage string is byte-identical in server + web permissions.ts (BYTE-PARITY); rbacSeed.ts untouched
- [Phase 81-02]: SVG detection is content-sniff only (first 1KB, <?xml or /<svg[\s>]/i) — fileTypeFromBuffer() returns undefined for SVG (no magic bytes); client MIME irrelevant for SVG/raster routing
- [Phase 81-02]: Mislabeled-SVG bypass (SECA-V116-01) closed: looksSvg check runs before MIME check so any SVG bytes go through DOMPurify regardless of Content-Type: image/png declaration
- [Phase 81-02]: DOMPurify(_brandDomWindow as any) — jsdom Window doesn't exactly satisfy DOMPurify WindowLike type; as any cast correct at runtime
- [Phase 81-02]: PUT /api/branding stores config_json verbatim in 81-02; PostCSS CSS sanitization wired in 81-03 per plan decomposition
- [Phase 81-02]: Cache headers: GET /api/branding no-cache,no-store (reverse-proxy safety); GET /api/branding/logo public,max-age=31536000,immutable (cache-busted by ?v= timestamp)
- [Phase 81-03]: PostCSS@8 does NOT canonicalize unicode escapes in declaration values (u\72l( preserved as-is); resolveCssUnicodeEscapes() pre-normalizes values before pattern-matching to close the bypass — CSS output is still root.toString() after node.remove() only
- [Phase 81-03]: sanitizeCssPostcss output = root.toString() after AST-based node.remove(); no regex replacement of CSS content
- [Phase 81-03]: CSS-V116-02 complete: customCss sanitized BEFORE db.prepare() write (defense before write); @scope wrapping deferred to Phase 83
- [Phase 82]: Used vi.hoisted() for BroadcastChannel mock — vi.stubGlobal is not hoisted, module-level new BroadcastChannel() fires before stub
- [Phase 82]: localStorage kbi-brand-tokens shape: { ...config, logoUrl } — all BrandConfigPayload keys + logoUrl for Plan 82-02 inline FOUC script
- [Phase 82]: BrandStyleInjector mounted in all 3 App render branches (loading/login/authenticated) — custom CSS applies pre-auth
- [Phase 82]: Brand FOUC block placed inside same IIFE as theme block so var t (light/dark) is in scope for token variant selection without re-reading localStorage
- [Phase 82]: Cold-cache brand block is safe no-op: JSON.parse(getItem('kbi-brand-tokens') || 'null') returns null; if-guard prevents any setProperty calls — one frame of Aurora default is accepted
- [Phase 82-client-token-pipeline-fouc-prevention-identity]: Logo rendered as <img> (custom logoUrl or DEFAULT_LOGO fallback) in Sidebar; LoginPage uses appName ?? 'Kinetica BI'; Topbar excluded per locked CONTEXT decision
- [Phase 83-branding-admin-ui]: Aurora hex defaults in BrandingSettingsPage.tsx parent (not BrandColorPicker): single ALLOWLIST entry; component stays generic
- [Phase 83-branding-admin-ui]: CURATED_FONTS = @fontsource-variable self-hosted only (no CDN URLs); 4 options each for body + display
- [Phase 83]: SegGroup generic typed helper: eliminates 4 near-identical button-group markup patterns
- [Phase 83]: kbi-brand-css-draft separate element for CSS draft preview: never overwrites kbi-custom-css owned by BrandStyleInjector
- [Phase 83]: No @scope branding-page exemption: Reset always reachable via header; id=branding-admin-exempt marker for Phase 84
- [Phase 83-04]: Phase-81 SVG/magic-byte validation reused unchanged for dark variant — only target columns + response key differ
- [Phase 83-04]: Optional logoDarkUrl param on brandStore.update() defaults to current store value — no breaking change to 83-03 callers
- [Phase 83-04]: LogoUploader preview swatch via CSS class (logo-uploader-preview--dark/light) — token-only, theme-guard safe
- [Phase 85]: d3 specifier is .~s: +1 offset maps user-facing decimal-places to d3 significant-digit precision; ~ flag trims trailing zeros (1.0M→1M)
- [Phase 85]: SIControls uses only existing CSS classes (config-group, config-group-label, ds-field, ds-field-label, config-hint) — no invented class names per CLAUDE.md
- [Phase 86]: Extracted all 4 *Controls + defaultSpecForKind into FormatSpecEditor.tsx (full extraction); FormatSpecEditor.onChange accepts FormatSpec|null; yAxisFormat:undefined=cleared (never {kind:none})
- [Phase 86-02]: Hybrid yAxisTickFormatter: cfg.yAxisFormat override → buildFormatter; else resolveFormatter(tableId, metricColumn) column-default; else identity. configVersion in deps for reactivity.
- [Phase 86-02]: Single formatter applied to all value axes (not per-metric) — matches AXIS-V117-02 'bound value column' singular language.

### Phase 54-verification-live-walk-through (gap-54-10)

- [54-10 NON_TRIGGER_TYPES allow-list]: Pure-consumer set allow-listed (map/info-card/legend/datafilter/timeline/numericline); everything else treated as trigger — covers records + all AggregatedWidgetRenderer paths including future chart types via the else branch default
- [54-10 TRACKFIX-V19-09]: useMapOnlySpatialMaterialize mounted once in DashboardOpen alongside useDynamicViewMaterializeChain; receives (dashboard.id, widgets); sole-trigger invariant preserved; 1665/1665 green; SERVER-CLEAN
- [Phase 55-access-model-server-enforcement]: Explicit DELETE cascade in deleteDashboard() (not FK PRAGMA) — foreign_keys not globally ON; grant cleanup fires regardless of PRAGMA state
- [Phase 55-access-model-server-enforcement]: Single dashboard_access_grants table with grantee_type discriminator; user grants stored LOWERCASED; role grants stored verbatim; no FK to known_users (pre-provisioning)
- [Phase 55-access-model-server-enforcement]: rbacSeed.ts byte-unchanged — generic seed loop auto-carries DASHBOARDS_MANAGE_ACCESS via DEFAULT_ROLE_MAPPINGS.designer; history-gated once-only seeding preserved
- [Phase 55-02 audit-on-change]: Grant add/remove emit rbac_audit only when row actually changed (inserted=true / removed=true) — idempotent no-ops produce no audit noise
- [Phase 55-02 grant-route-placement]: GET/POST/DELETE /api/dashboards/:id/access placed in dashboard CRUD neighborhood (~line 539), immediately after DELETE /api/dashboards/:id, for locality
- [Phase 55-02 delete-body]: DELETE /api/dashboards/:id/access reads grantee_type+grantee from req.body (not query) for symmetry with POST
- [Phase 56-access-management-ui-list-open-ux]: delete-body-contract-enforced: removeDashboardGrant fires DELETE with JSON body {grantee_type, grantee} — symmetric with POST, mirroring 55-02 decision
- [Phase 56-access-management-ui-list-open-ux]: pre-provisioning-via-free-text: user input is free-text with optional datalist; no gating on known users
- [Phase 56-access-management-ui-list-open-ux]: manage-access-button-placement: button after Delete in .ds-actions, canManageAccess-gated (hide-don't-disable), accessModalDashboard state at DashboardsPage scope
- [Phase 56-access-management-ui-list-open-ux]: no-access-early-return: noAccess detector before layouts in DashboardOpen; ChartCard+dashboard-list wrapper for visual consistency; onBack wires to existing callback
- [Phase 57-verification-live-uat]: server vitest gate is SET-BASED: failing-file set evaluated as subset of TD-V16-TEST-ISOLATION known-flaky list; fixed pass-count never asserted (nondeterministic flakiness in 8 known files)
- [57-02 UAT overall_result: passed]: Live walk 2026-06-09 (RPereira@kinetica.com) — all sections PASS, no gaps; §1.3 deep-link step re-scoped (no URL routing in v1.10; no-access panel verified via revoke-then-open path; deep-linking DEFERRED)
- [Phase 57-03]: overall_status: passed — 57-01 gates ALL PASS AND 57-UAT overall_result: passed; both conditions met
- [Phase 57-03]: §1.3 re-scope: deep-linking by URL DEFERRED (out of v1.10 scope); no-access panel verified via revoke-then-open 404 path — LISTUX-V110-02 satisfied
- [Phase 58-action-engine-contract-allow-list-canary]: zod@^3 in packages/web only — absent from packages/server; validateActionPatch uses Object.keys() enumeration (never spreads untrusted patch before validation) to prevent prototype pollution
- [Phase 58-action-engine-contract-allow-list-canary]: Allow-list seed: map (show_popup/show_scale_bar/show_fullscreen), chart (metric/aggregation enum), records (page_size), layer (render_mode/visible/opacity/track_config TOP-LEVEL/cb_config TOP-LEVEL), dynamicView (enabled)
- [Phase 58.1-action-engine-foundation-fix]: Per-field FieldDescriptor {schema, location} in allow-list — getFieldLocation as single source of truth for field routing (no hardcoded names in router)
- [Phase 58.1-action-engine-foundation-fix]: Pre-write config deep-merge in applyWidgetAction (not in effectiveLayers) — guards against store depth-1 merge clobbering prior nested config keys on repeated patches
- [Phase 58.1-action-engine-foundation-fix]: effectiveLayers DTO-shape split via { config: cfgPatch, ...topLevel } destructure — null-safe, handles overlays with only top-level or only config fields
- [Phase 59-01]: validateRadioOption checks empty configPatch before delegating to validateActionPatch — the empty guard is radio-specific; allow-list handles all other validity
- [Phase 59-01]: captureAllowListedSubset accepts pre-fetched sources (no Zustand reads) — pure function; config panel passes layer/widget/dynamicViewConfig in
- [Phase 59-01]: captureAllowListedSubset derives each field location via getFieldLocation — no hardcoded field→location mapping; allow-list is the single source of truth
- [Phase 59]: RadioGroupConfigPanel reads widgets from props (NOT useDashboardContext) — modal is outside DashboardContextProvider
- [Phase 59]: Target change in config panel resets configPatch to {} — new target invalidates old patch (mirrors DataFilterConfigPanel reset-on-table-change)
- [Phase 60]: widgetActionStore refactored to source-control-keyed contributions; derived overlay maps preserved as state fields for selector subscription compat; switch-replace semantics proven
- [Phase 60.1-01]: cb_config placement move is a symmetric key-name pass-through (not a rename) — same key in flat patch and form blob; LAYER_FORM_PATCH_FIELDS loop handles both directions identically
- [Phase 60.1-01]: track_config excluded from LAYER_FORM_PATCH_FIELDS — surfaced only via Advanced JSON (out of scope for structured editor)
- [Phase 60.1-01]: layerFormConfigToPatch is the SC2 safety boundary — junk keys from CbConfigForm silently dropped; output always passes validateActionPatch("layer", undefined, patch)
- [Phase 60.1-02]: MERGE onChange for structured layer editor: spread existing configPatch then overlay nextPatch so non-surfaced keys (track_config) survive writes
- [Phase 60.1-02]: CbConfigForm mock uses async vi.mock factory + useEffect-based isValid signaling to avoid infinite render loops in controlled-component tests
- [Phase 60.1-01]: DATA_BINDING_KEYS in actionAllowList.ts; validateLayerSnapshot is separate denylist from validateActionPatch; snapshotToLayerForm lifts cb_config into blob matching LayersModal.tsx precedent; layerFormToSnapshot keeps cb_config/track_config top-level
- [Phase 60.1]: splitLayerSnapshot in applyWidgetAction replaces splitLayerPatch for layer targets: LAYER_SNAPSHOT_TOP_LEVEL (cb_config/track_config/info_enabled/info_columns/info_template) top-level; all style keys nested under config
- [Phase 60.1]: validateLayerSnapshot (denylist) used for layer dispatch + save-time validity; validateActionPatch (strict allow-list) kept for widget/dv dispatch + AI/MCP path (SAFETY-V111-02 preserved)
- [Phase 60.1-radio-config-ux-structured-layer-target-editor-reuse-cbconfigform]: hideSpatialMode placed on KineticaWmsLayerForm props (additive, default false) — existing callers unaffected
- [Phase 60.1-radio-config-ux-structured-layer-target-editor-reuse-cbconfigform]: Modal widening via .modal-config:has(.radiogroup-has-layer-editor) CSS selector + marker class on panel root
- [Phase 60.2]: RadioOption.actions/action both optional for back-compat; getOptionActions normalizes both shapes
- [Phase 60.2]: applyWidgetActions builds ONE fresh combined contribution and calls setControlContribution ONCE (option-level switch-replace)
- [Phase 60.2]: validateRadioOption 2nd param accepts string|(id=>string)|undefined union for panel back-compat transition
- [64-02 UAT authored]: 64-UAT.md shipped in "pending attestation" status — §1.3 explicitly names the killed-bug check (source-table widget unaffected during dv drill); §3.2 mandates DevTools Network inspection for dv/table scope separation; gates verdict transcribed from 64-01-AUTOMATED-GATES.md (ALL PASS at HEAD 408259d)

### Phase 49-users-management-ui

- [49-01 GET /api/users]: LEFT JOIN known_users ku2 (alias) used to add last_seen without disrupting the UNION de-dup subquery grouping
- [49-01 bootstrapUsername]: Read at request time via process.env (not module-scope) — consistent with rbacDb.getAppAdminUsername and 46-03 decision
- [49-01 bootstrap synthesis]: users.unshift() injects bootstrap row only when absent from both tables — handles fresh deployments where bootstrap has never logged in
- [49-01 SAFE-V18-01]: Guard COUNT excludes bootstrap via 'username != lower(?)' — works whether or not bootstrap has an explicit user_roles row
- [49-01 SAFE-V18-01]: Verbatim error string locked: "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role." — single source of truth for 49-02/49-03 frontend
- [Phase 49]: hide-don't-disable: assign/revoke controls absent from DOM when user lacks users:assign_roles
- [Phase 49]: revokeRole/assignRole return parsed error body so verbatim SAFE-V18-01 400 can be surfaced as toast and inline popover error
- [Phase 49]: Promise.allSettled for bulk assign — no short-circuit; aggregate toast counts fulfilled vs failed
- [49-03 UsersPage import]: named export { UsersPage } not default — App.tsx import must use braces
- [49-03 banner fetch]: standalone useEffect with AbortController; swallows all errors silently (banner is non-critical)
- [49-03 bannerDismissed]: React state only — no sessionStorage; banner reappears on reload (matches session-dismissable spec)
- [Phase 50]: before_json for role_assigned/revoked uses raw assigned-role-name list (not analyst-fallback) — reflects actual DB rows
- [Phase 50]: createUserAdminSession creates session AFTER buildTestApp() call to avoid auth_mode_change_wipe deleting password sessions in oidc test env
- [Phase 50]: Guard 3 catalog check (400) fires BEFORE escalation check (403) — unknown permission string is always 400 regardless of caller admin status
- [Phase 50]: emitRbacAudit level=info (not warn): audit rows are expected success events, not anomalies
- [Phase 50]: aria-label={perm} added to permission checkboxes for accessibility + vitest getByRole queries
- [Phase 50]: vi.clearAllMocks() in beforeEach prevents updateRolePermissions call-count bleed across tests
- [Phase 50]: holders_count: SELECT COUNT(*) per role in GET /api/roles map (computed on read, not stored); powers delete-blocked UX
- [50-03 RolesPage import]: named export { RolesPage } — import uses braces, consistent with UsersPage pattern
- [50-03 editorIsAdmin]: reads user.roles (not user.permissions) — role membership is the correct predicate; user_admin HAS users:assign_roles but must NOT see admin in assign surfaces
- [50-03 assignableRoles]: derived at render time; chip display of already-assigned roles left untouched — filter applies only to NEW assignment surfaces (popover + bulk dropdown)
- [50-03 bulk default init]: useAuthStore.getState() read synchronously inside fetchData (not stale closure) to pick correct first assignable role for non-admin editors
- [Phase 50.1-01]: groupPermissionList() takes an arbitrary list (not the full catalog) so ProfilePage groups only the user's effective permissions
- [Phase 50.1-01]: Topbar Log out calls useAuthStore.getState().logout() only — no duplicated reset logic; App.tsx UNAUTHORIZED effect is the canonical reset
- [Phase 50.1-01]: ProfilePage reached via Topbar menu only (onNavigateProfile prop); NOT in Sidebar nav; 'profile' added to Page union and ReturnTo allowlist
- [Phase 50.2]: users-cell-flex inner-wrapper pattern: flex moved off td onto inner div; gap:6px works for both username+lock and chips
- [Phase 50.2]: UTC normalization: marker-less SQLite datetime strings appended with T+Z before Date.parse; non-positive diff clamped to 'just now'
- [Phase 50.2]: PERMISSION_DESCRIPTIONS: 16-entry Record in permissionGroups.ts; imported by RolesPage; rendered as muted .roles-perm-desc span
- [Phase 50.3]: Popover fix option (a): overflow: visible on .users-table-wrap — 5-col table needs no h-scroll at normal widths; CSS-only, preserves .users-popover class
- [Phase 50.3]: [50.3-01 token mapping]: --color-selected → rgba(34,197,94,0.14) accent-tinted translucent readable on both themes; --color-danger → #ef4444 theme-neutral
- [Phase 52-track-spatial-mode-foundation]: SpatialMode widened in columnTypes.ts only; wire contracts (spatialTargets.ts, InfoSpatialMode) remain 3-mode; track→latlon translation at all wire boundaries
- [Phase 52-track-spatial-mode-foundation]: MapConfigPanel coerces autoSuggestSpatialMode 'track' to 'latlon' for SpatialTarget — track is not a valid spatial-filter target
- [Phase 52-track-spatial-mode-foundation]: Track mode picker exempt from WMS capabilities gate (mirror classbreak exemption)
- [Phase 52-track-spatial-mode-foundation]: TrackSubSection deleted; no compat shim — cutover overlay handles old-model layers in Phase 53
- [Phase 52-track-spatial-mode-foundation]: MapConfigPanel both autoSuggest sites prefill lonCol/latCol from isTrackTable match (CHECKER ADVISORY FIX)
- [Phase 53]: effectiveRenderMode derived locally for immediate UI update before onChange round-trip on heatmap coercion
- [Phase 53]: TRACK STYLE section placed before RASTER PARAMS for top-to-bottom readability
- [Phase 53]: trackContext gates both chevron button AND advanced panel with single !trackContext predicate
- [Phase 54]: All 8 server failing files confirmed IN TD-V16-TEST-ISOLATION list — no new regressions since Phase 53
- [Phase 54]: Track-spec group (6 files, 297 tests) all green — double-precision specs + Phase 53 WMS emission byte-locks confirmed at post-52/53 baseline
- [54-02 UAT overall_result]: gaps_found — NOT pass, NOT failed; 4 gaps logged; §1/§5/§6 PASS; §2/§3 FAIL; §4 SKIPPED
- [54-02 GAP-54-01]: CRITICAL/blocking — track WMS layer never renders (no WMS request fires); root cause pointer: wmsUrlBuilder.ts DOTRACKS gate (~432-434) or buildWmsParams returning null → MapChartRenderer skips layer; in-scope v1.9; 54.x fix plan required
- [54-02 GAP-54-02]: major; Track+CB does not colorize per-break categorically; scope decision pending — may need live Kinetica WMS spike for cb_raster track coloring
- [54-02 GAP-54-03]: minor/additive; no TRACKLINECOLOR/TRACKLINEWIDTH form controls; scope decision pending
- [54-02 GAP-54-04]: minor/pre-existing; legend shows "Layer {id}" for unnamed layers; LayersLegendPanel.tsx ~213-218 fallback; separate from track work; scope decision pending
- [54-02 5e3514b fix confirmed live]: DOUBLE X/Y columns visible and selectable in x/y pickers — §1.3 PASS; fix is live-attested
- [54-03 status]: BLOCKED until GAP-54-01 resolved via 54.x inline fix plan + §2/§3 re-walk passes
- [Phase 54]: GAP-54-01 fix: merge layer.track_config into isConfigComplete input at Effect 2 call site; builder was never at fault (buildWmsParams already reads top-level track_config correctly)
- [54-06 TRACKFIX-V19-04]: delete params.POINT*/SHAPE* (7 keys) inside enabled-track block using delete operator — robust to both raster and classbreak lanes that may have set them
- [54-06 TRACKFIX-V19-05]: headShape → TRACKHEADSHAPES (fixes OQ-9 misnaming); markerShape → TRACKMARKERSHAPES as distinct param; TRACK_DEFAULTS updated to Kinetica doc defaults (FFFFFFFF/FF00FF00/FF0000FF)
- [54-06 RENDER-V19-04 byte-lock]: Updated to TRACKHEADSHAPES — the byte-lock was locking the old misnaming, which is exactly what this fix corrects
- [54-07 TRACKFIX-V19-06]: cbColors = cb.breaks.map(b => normalizeAARRGGBB(b.color)) when CB configured; colorList() selects cbColors.join(',') or expand(single) fallback; one break color drives all 3 TRACK_* color params positionally
- [54-07 form-gating]: effectiveRenderMode !== 'classbreak' gate wraps 3 color control pairs (head/line/marker); uses effectiveRenderMode not raw renderMode for heatmap-coercion consistency
- [54-07 CbConfigForm confirmed]: trackContext gates only per-row advanced chevron/panel; column/method/auto-suggest/theme/per-break color picker all rendered regardless of trackContext (no code change needed)

### Phase 53-render-narrowing-param-surfaces-color-cutover

- [53-02 EMISSION-GATE]: gate kept on tc.enabled (not spatialMode==="track"); both legacy latlon+enabled and new track+enabled paths pass simultaneously; switching gate would break locked latlon+enabled specs
- [53-02 fingerprint-proof]: fingerprint coverage verified via unit-level emission proxy (changed TRACKHEADCOLORS in wmsParams changes JSON.stringify({p,c,t})); no MapChartRenderer integration test needed
- [53-02 CUTOVER-V19-01 amended]: no overlay or migration added; Phase 52 clean deletion + no-throw locks in spec satisfy the amended truth

### Phase 51-verification-live-uat

- [51-01 spec fix only]: DashboardsPage.tsx toolbar order (Tables → Dynamic Views → Map Layers → Visualizations) is correct; DashboardsPage.spec.tsx assertion was stale from a prior toolbar reorder — no product code changed
- [51-01 rbac deterministic group]: auth.login-rbac.spec.ts included as 9th group per post-plan note (work landed in 50.1/50.2/50.3); all 9 groups pass 147/147
- [51-01 vitest multi-filter]: pipe-separated pattern rejected by vitest — each RBAC spec group run individually; all 9 green
- [51-02 §9.2 OIDC ReturnTo]: recorded as PASS per operator blanket attestation (2026-06-06); checklist wording permits PASS-or-SKIPPED; operator reported all sections pass including §9.2
- [51-02 gaps block]: gaps: [] — operator attested full pass; no 51.x revision required; 51-03 compile unblocked
- [51-02 attestation]: RPereira@kinetica.com blanket pass 2026-06-06; all 36 items (Sections 0-9) PASS; overall_result: PASS; ready_for_51_03: true
- [51-03 overall_status]: passed (not gaps_found) — all 42 UAT items PASS, zero gaps, all 6 automated gates green; five pre-UAT fix rounds closed and re-verified
- [51-03 VERIFY-V18-01]: checkbox and traceability row were pre-set [x]/Complete at phase creation; footer updated to 2026-06-06 milestone-gate-passed
- [51-03 TD-V17-DASHPAGE-SPEC]: CLOSED in 51-01; remaining carried TDs: TD-V17-LIVE-UAT, TD-V16-TEST-ISOLATION, TD-V14-WKB-SPIKE, TD-V15-MAP-ONLY-TRIGGER

### Phase 47-server-middleware-route-guards

- [47-01 createAdminSession]: createAdminSession takes opts? only (no db param) — bootstrap short-circuit bypasses SQLite entirely; session created against module-singleton db using APP_ADMIN_USERNAME||'admin'
- [47-01 test migration]: makeSessionCookie() body rewritten to delegate to createAdminSession(); seedOidcSession() kept with createSession for OIDC credential-type testing in dual-auth-mode specs
- [47-01 datasets:manage]: 16th permission added to PERMISSIONS catalog and DEFAULT_ROLE_MAPPINGS.designer (now 9-permission role); admin auto-includes via ALL_PERMISSIONS spread
- [47-01 datasets:manage]: rbac_seed_history mechanism seeds datasets:manage exactly once on first boot after upgrade; operator-removal of designer mapping survives restart (history contract proven in db.rbacMigration spec)
- [Phase 47]: [47-02 requirePermission]: factory returns RequestHandler[] to force ...spread usage; requireAuth is element 0; test app avoids createApp() for isolation; denial log via console.log JSON.stringify OBS-01 pattern
- [47-03 route guards]: 22 mutation routes gated; requireConfig kept first on materialize/dynamic-views routes (Pitfall 2); ANALYST-PASSTHROUGH BOUNDARY comment block inserted verbatim from research template; OIDC smoke tests updated to use APP_ADMIN_USERNAME for bootstrap short-circuit
- [47-03 management routes]: 7 management routes with inline db.prepare() — no abstraction layer at this scale; PUT /api/roles/:id/permissions validates against Object.values(PERMISSIONS) catalog; SAFE-V18-01/02 deferral comments in handlers
- [47-03 known_users]: Table added to SCHEMA_DDL; dual upsert (password + OIDC) on success path only; GET /api/users uses known_users UNION user_roles for comprehensive user list
- [Phase 48]: 48-01 permissions mirror: zero imports, pure module, values VERBATIM from server catalog — byte-parity enforced by spec
- [Phase 48]: 48-01 hasPermission: uses get().user?.permissions (current state read), never a closed-over variable — Pitfall 3 avoidance
- [Phase 48]: 48-01 fetchMe coalesce: roles ?? [] and permissions ?? [] guards prevent crash on un-upgraded server responses
- [Phase 48]: 48-01 AuthUser widening: existing test fixtures updated to { username, roles: [], permissions: [] } to satisfy TypeScript strict assignment
- [Phase 48]: 48-02 PERMISSION_DENIED: debounced window-event + App.tsx re-sync mirrors REAUTH_REQUIRED/UNAUTHORIZED_EVENT pattern exactly; useToastStore called directly in client.ts (no cycle); raw fetchMe used to prevent 403 re-trigger loop
- [Phase 48]: 48-04 Sidebar gating: filter(item => !item.permission || hasPermission(item.permission)) over static nav array; ungated items always pass; gated hidden when user null or permission absent
- [Phase 48]: 48-04 Topbar identity: user.username.slice(0,2).toUpperCase() for initials (fallback '?'); user.roles.map for chips; user-identity block conditionally rendered only when user non-null
- [Phase 48]: 48-04 useUserStore deletion: git rm after single consumer (Topbar) migrated; zero references remain in src/
- [Phase 48]: 48-03 dragConfig.enabled:false: first-class boolean in react-grid-layout v2.2.2; no per-item fallback needed for grid inertness
- [Phase 48]: 48-03 GATE-V18-04 unreachability: ChartConfigPanel needs NO read-only mode — canConfigure gates both gear button and onConfigureWidget prop; LegendRenderer Reconfigure also hidden
- [Phase 48]: 48-03 LegendRenderer clean-hide: Reconfigure button rendered only when onConfigureWidget is defined (not no-op optional chain)

### Phase 46-rbac-schema-data-layer

- [46-01 permissions catalog]: PERMISSIONS uses SCREAMING_SNAKE_CASE keys with noun:verb string values; `as const` for full type inference; DEFAULT_ROLE_MAPPINGS references PERMISSIONS.* keys (not raw strings) so catalog renames caught at compile time
- [46-01 permissions catalog]: roles:delete_custom defaults to admin only; user_admin explicitly excluded (6 permissions: 5 management + dashboards:view only)
- [46-01 permissions catalog]: analyst has exactly 1 permission (dashboards:view); all filter/drill-down interaction is ungated by design (requireAuth-only territory per Phase 47 analyst-passthrough boundary)
- [46-01 permissions catalog]: ALL_PERMISSIONS = Object.values(PERMISSIONS) — used by admin bootstrap short-circuit (returns new Set(ALL_PERMISSIONS))
- [46-01 permissions catalog]: Spec independently hardcodes all 15 expected strings (never derived from source) to catch source typos — pattern established for all catalog specs
- [Phase 46-02]: permission TEXT not FK: role_permissions.permission is code-catalog string from lib/permissions.ts, no permissions table in v1.8
- [Phase 46-02]: SELECT id after INSERT OR IGNORE not lastInsertRowid — lastInsertRowid is 0 when row ignored by UNIQUE constraint
- [Phase 46-02]: seed never touches user_roles — no bootstrap assignment needed; admin bootstrap short-circuit in Plan 46-03 handles APP_ADMIN_USERNAME
- [Phase 46-rbac-schema-data-layer]: [46-03 rbacDb]: analyst fallback reads live DB role_permissions for analyst role (NOT DEFAULT_ROLE_MAPPINGS constant) — operator-edited analyst mappings take effect immediately for unassigned users
- [Phase 46-rbac-schema-data-layer]: [46-03 rbacDb]: getAppAdminUsername reads process.env at call time (not module-level) — allows test mutation of process.env between cases
- [Phase 46-rbac-schema-data-layer]: [46-03 boot spec]: Standalone boot.rbacAdminWarning.spec.ts uses self-contained constructable Issuer class mock — does NOT depend on pre-existing-red shared OIDC mock tests; fixes 'Issuer is not a constructor' for this spec only

### Phase 45-timeline-chart-widget

- [45-03 TimelineRenderer]: tableId cast to `number` in commitFilter — TypeScript cannot narrow past early-return gates into a nested function body; cast is safe because commitFilter is only callable when renderer is past the `if (tableId === undefined)` gate
- [45-03 TimelineRenderer]: Static-grep test pattern used for Tests 4/5/8 (multi-axis, single-axis, ReferenceArea) — Recharts SVG DOM output is dimension-dependent and unreliable in JSDOM; source assertions verify architectural contract durably (RESEARCH.md §C-08)
- [45-03 TimelineRenderer]: filterVersion in useEffect deps ensures re-fetch when BETWEEN filter is applied (self-narrowing zoom-in effect matches CONTEXT.md decision)

### Phase 27-spatial-filter-store

- [27-01 spatialFilterStore]: shapeCounter kept in Zustand state (not derived from shapes.length) — only way to honor monotonic no-recycle rule after removeShape; post-removal label sequence Bbox 1, Bbox 2, (remove first), Bbox 3 requires independent counter
- [27-01 spatialFilterStore]: removeShape(non-existent id) and clearAll(empty shapes) both return s (state identity) — mirrors filterStore.ts:clearFilters early-return pattern; preserves shapes[] reference for Phase 29 PITFALL S-02 primitive-selector mitigation
- [27-01 spatialFilterStore]: reset() hard-sets spatialFilterVersion=0 (lifecycle wipe, NOT an increment) — prevents spurious Phase 30 AggregatedWidgetRenderer dep-array re-fires on logout/dashboard-switch
- [27-01 spatialFilterStore]: Store ships dormant in Phase 27 (zero production consumer imports); Plan 27-02 adds App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup (STORE-V15-04)
- [Phase 27]: No DROP loop for spatial shapes at either reset site: shapes have no server-side resource (session-only client state) — mirrors infoSelectionStore + lastInfoClickContextStore pattern
- [Phase 27]: Canonical 5-store reset order locked at filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore; 5th position is final for v1.5 milestone
- [Phase 28]: [28-01 spatial-targets-helper TARGET-V15-02]: SpatialMode declared locally in spatialTargets.ts (not imported from ./columnTypes) — mirrors server-side WHERE-V15-01 local declaration choice; zero cross-module import for trivial union; both columnTypes/spatialTargets unions coexist independently
- [Phase 28]: [28-01 spatial-targets-helper]: SpatialTarget byte-parity with server lines 75-81 verified — same 5 fields (tableId, spatialMode, lonCol?, latCol?, spatialCol?), same optionality, no UI-only fields; Phase 30 materializeFilter sends type as-is over wire (zero projection)
- [Phase 28]: [28-01 spatial-targets-helper]: isSpatialTargetEligible established as single source of truth across all 3 v1.5 gates (MAT-V15-03): config-time MapConfigPanel WKB warning (Plan 28-02), materialize-time AggregatedWidgetRenderer skip (Phase 30), server-time 501 (Phase 26). Empty-string columns treated as missing (falsy via Boolean())
- [Phase 28]: [28-01 spatial-targets-helper]: No DEFAULT_SPATIAL_TARGETS constant — [] is inline literal at the one read site (getSpatialTargets), unlike DEFAULT_INFO_ENABLED which is reused across MapConfigPanel + tests. Plan 28-02 consumes isSpatialTargetEligible directly, not a defaults constant
- [Phase 28]: [28-01 spatial-targets-helper]: getSpatialTargets returns same-array-reference passthrough (no defensive copy) — mirrors getInfoEnabled minimal-helper style; reference-equality lock asserted by spec (out === targets) to prevent regression to defensive .slice()
- [Phase 28]: [28-01 spatial-targets-helper]: Tasks 1+3 form type-cycle (Pick<MapWidgetConfig,'spatialTargets'> needs field added by Task 3; MapWidgetConfig.spatialTargets needs SpatialTarget exported by Task 1) — TypeScript handles cyclic type-only imports cleanly once both files land; plan-level tsc verification deferred to after Task 3 commit
- [Phase 28]: [28-01 spatial-targets-helper]: Plan 28-01 ships dormant — grep -r spatialTargets kinetica_bi/src/lib/ returns exactly 3 files (spatialTargets.ts, spatialTargets.spec.ts, wmsUrlBuilder.ts); Plan 28-02 is first UI consumer (MapConfigPanel section)
- [Phase 28]: [28-02 map-config-panel-section TARGET-V15-03]: ConfigPanelProps.tables?: { id, name, schema, columns }[] added as additive optional field — non-map panels unaffected; MapConfigPanel destructures and renders dashboard-scoped table picker per row. Reuses local TableInfo shape from ChartConfigPanel for byte-parity.
- [Phase 28]: [28-02 map-config-panel-section]: Auto-suggest-on-table-change LOCKED — changeTable always runs autoSuggestSpatialMode(newColumns) and writes the suggested mode (NEVER prior). Prior mode may be invalid for new column shape (e.g., latlon → wkt-only table). Mirrors LayersModal.tsx handleTableChange lines 147-165 verbatim. Spec T8b proves the mode-flip behavior.
- [Phase 28]: [28-02 map-config-panel-section]: WKB row UI contract LOCKED — verbatim warning text 'WKB spatial mode not yet supported — deferred' (en-dash U+2014); NO column picker rendered; NO generic 'Incomplete — will not filter' indicator. Spec asserts via screen.getByText for regression catch.
- [Phase 28]: [28-02 map-config-panel-section]: DashboardsPage NO edit needed — ChartConfigPanel was always invoked with tables={associatedTables} (tables?: TableInfo[] is part of Props line 24). New ConfigPanelProps.tables field just makes the threading from <Custom> slot to MapConfigPanel explicit. Persistence rides existing onChange → onSave → PATCH /api/widgets/:id flow; debounce upstream.
- [Phase 28]: [28-02 map-config-panel-section]: SpecTableInfo helper type declared in MapConfigPanel.spec.tsx so makeTables() return type widens columns to Record<string,string>. Without it, TS narrows inline object literals and rejects assignment to ConfigPanelProps.tables?[number] (caught as Rule 3 blocking during tsc; fixed inline).
- [Phase 28]: [28-02 map-config-panel-section]: Phase 28 complete — TARGET-V15-01 (persistence ride-along) + V15-02 (eligibility predicate, closed Plan 28-01) + V15-03 (UI editor with WKB warning + incomplete indicator + auto-suggest) all closed. 17 new spec tests; 570/570 full frontend suite green; tsc clean.
- [Phase 29-draw-and-shape]: [29-01 shapeDraw]: DrawMode union + DRAW_MODES tuple in lib/shapeDraw.ts — avoids circular import with MapDrawToolbar; matches mapInfoConfig.ts minimal-helper pattern
- [Phase 29-draw-and-shape]: [29-01 mode-guard]: drawModeRef.current imperative read in Effect 6 handler (NOT useState closure) — prevents stale-closure trap WITHOUT adding drawMode to Effect 6 deps array
- [Phase 29-draw-and-shape]: [29-01 test-seam]: setdrawmode custom DOM event + data-testid span for vitest specs to drive drawMode before MapDrawToolbar ships; event listener in useEffect([]) ensures cleanup
- [Phase 29]: [29-02 MapDrawToolbar]: faCropSimple used instead of faVectorSquare (not in installed FA solid version); semantic equivalent for bbox rectangle selection button
- [Phase 29]: [29-02 MapDrawToolbar]: Active button icon color = white (#ffffff), not dark (#0b1224) — CONTEXT.md operator-locked decision overrides plan action; green accent on white is WCAG AA
- [Phase 29]: [29-03 VectorLayer]: Tests V1-V18 landed in existing MapChartRenderer.spec.tsx — extended existing OL mocks rather than new sibling spec
- [Phase 29]: [29-03 VectorLayer]: useSpatialFilterStore NOT mocked in spec — real Zustand store used so shapesKey triggers real React re-renders and Effect 7 fires correctly
- [Phase 29-draw-and-shape]: [29-04 buildDrawInteraction]: bbox type:'Circle'+createBox(), circle type:'Circle'+createRegularPolygon(64), lasso type:'Polygon'+freehand:true — all yield Polygon at drawend; factory returns null for pan/info
- [Phase 29-draw-and-shape]: [29-04 isDegenerateExtent]: OR threshold (width < 10×res OR height < 10×res) — rejects thin-sliver shapes; locked recommendation b from 29-RESEARCH.md Open Question 2
- [Phase 29-draw-and-shape]: [29-04 toast kind]: 'Shape too small — try again' fires with kind='info' (ToastKind has no 'warning' — Pitfall 4 in 29-RESEARCH.md confirmed)
- [Phase 30-02]: myTarget excluded from Effect 1 dep array — myTarget changes only when widgets changes, which triggers a re-render that re-creates the effect; adding myTarget to deps would be a redundant double-dep
- [Phase 30-02]: shapes read imperatively via useSpatialFilterStore.getState().shapes inside setTimeout — avoids subscribing to the full shapes array; spatialFilterVersion is the stable primitive dep; stale-closure safe because Effect 1 re-creates on spatialFilterVersion change
- [Phase 30-02]: MapChartRenderer.spec.tsx needed zero repair — it mocks all Zustand stores via factory overrides and never mounts DashboardContextProvider directly
- [Phase 30]: ResizeObserver + OL mocks added to DashboardsPage.spec.tsx to enable JSDOM rendering of map widgets without crashing
- [Phase 30]: Used exact name 'Clear all' in findByRole to distinguish filter-bar-clear from MapDrawToolbar's 'Clear all shapes' button
- [Phase 32]: [32-01 db-schema] dashboard_dynamic_views columns_json stored as TEXT (JSON-encoded); null means never previewed yet; cleared on template_sql change to force re-preview (CONTEXT.md D3)
- [Phase 32]: [32-01 db-schema] max_records DEFAULT 100000 (Claude's discretion); operator can override per row. updateDashboardDynamicView uses '"key" in attrs' discriminant for columns_json so explicit null clears the field but key-omission preserves (mirrors mapDashboardLayer info_* pattern)
- [Phase 32]: [32-01 substituteViewToken] regex /\{\s*view\s*\}/gi resets lastIndex BEFORE .test() to defend against /g state leak across consecutive calls. Plan S7 corrected: backslash adjacent to closing brace breaks the regex match (does NOT silently still-match as plan claimed) — locked actual behaviour + S7b added for surrounding-context match
- [Phase 32]: [32-01 createOrReplaceMaterialized] op typed as KineticaOp (imported from kinetica.ts) instead of bare string — preserves audit-log type safety. POST /api/filter/materialize 37-line inline try/catch replaced with 8-line helper call; 24 existing supertest tests still green (contract preserved before Plan 03 takes second consumer)
- [Phase 32]: [32-02 routes] _dummy_validation_view_name_ placeholder passed to substituteViewToken at create+update time — underscored prefix/suffix makes leak-audit grep trivial; return value is discarded (presence-check only)
- [Phase 32]: [32-02 PUT columns_json] 3-way precedence: caller-supplied (incl explicit null) wins → omit-with-template-change clears → omit-without-change preserves; matches CONTEXT.md D3 Preview-then-Save flow
- [Phase 32]: [32-02 wave-2 anchor] new routes wrapped in '===== Plan 02 / Plan 03 routes append after this line =====' delimited block so Plan 03 preview/materialize/delete can insert directly above v1.4 info-query block without merge conflict
- [Phase 32]: [32-02 OIDC spec scope] 1 happy-path smoke per route (3 oidc tests) — validation matrix is auth-mode-independent so password block carries the full coverage (mirrors routes.filter-materialize.spec.ts shape)
- [Phase 32]: [32-02 updated_at test] real setTimeout(1100ms) — not vi.useFakeTimers — because better-sqlite3 datetime('now') reads OS clock, not Node timer
- [Phase 32]: [32-03 no_filter detection] Session-scoped filter views from POST /api/filter/materialize are NEVER persisted to dashboard_table_views — they exist exclusively as Kinetica materialized views named by buildFilterViewName. So the only authoritative existence check is a Kinetica round-trip. Preview uses SELECT 1 FROM <view> LIMIT 0 as a probe; Materialize uses SELECT COUNT(*) as a combined existence-check + threshold-input (single round-trip). Plan attempted to detect via SQLite row with status === "ready" — incorrect on TWO counts (status enum is pending|created|error, AND no SQLite row exists for these session-scoped views)
- [Phase 32]: [32-03 KineticaOp extension] Added DYNAMIC_PREVIEW + DYNAMIC_MATERIALIZE audit-log op tags so operators can grep dynamic-view workload from filter-view workload in the structured log. Existing MATERIALIZE tag preserved for filter-view route
- [Phase 32]: [32-03 sample_limit clamp] Preview clamps sample_limit to [1, 1000], default 100. 1000 caps cost (oversize preview defeats the "one-shot probe" purpose); default matches CONTEXT.md endpoint example. Claude's discretion — plan unspecified
- [Phase 32]: [32-03 DELETE 404 before DROP] Returning 404 BEFORE firing the Kinetica DROP preserves caller's ability to distinguish "never existed" from "drop failed". Test "returns 404 when id does not exist — no DROP fired" asserts the sequence
- [Phase 32]: [32-03 column types] Kinetica /execute/sql encoded response has NO column-type metadata in any existing consumer (info-query, discovery). Preview decoder defaults column type to "unknown"; transparently picks up column_datatypes if Kinetica ever emits it. Phase 35 ChartConfigPanel can infer types from sampled values if needed
- [Phase 32]: [32-03 isTableNotFoundError] Route-local helper duplicates lib/materializedView.ts § isReplaceRace 2-line predicate. Both consumers (Preview probe, Materialize COUNT) live in index.ts; lifting to a shared module deferred until a 3rd consumer appears
- [Phase 33]: Plan 33-01: Frontend pure-helper byte-parity contract validated via spec round-trip pairs copied from server tests (no cross-tree imports). useDynamicViewStore action semantics locked: setView/markPending/setError always bump dynamicViewVersion; clearView non-existent is strict no-op; reset hard-sets to 0 (not increment). markPending on existing entry keeps prev viewName (locked rule preserves cached deterministic name for retry).
- [Phase 33-dynamic-view-store]: Picked DYNAMIC_DROP audit-op tag (33-CONTEXT line 119) over reusing DYNAMIC_MATERIALIZE — finer audit-log filtering distinguishes lifecycle cleanup from materialize-housekeeping; required extending KineticaOp union.
- [Phase 33-dynamic-view-store]: POST /api/dynamic-view/:id/drop is the missing lifecycle-cleanup primitive that distinguishes operator-initiated DELETE (destructive, removes SQLite row) from session-end DROP (DROP-only, row UNTOUCHED). Mirrors the implicit filter-view DROP semantics, which never needed this split because filter views have no SQLite row.
- [Phase 33-dynamic-view-store]: Phase 33 Plan 03: 7 pure pass-through client helpers (zero useDynamicViewStore imports) + 6th-store reset wiring with materialized-only DROP loop at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen — canonical 6-store reset order locked: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore → dynamicViewStore
- [Phase 34]: throwForStatus generic 4xx/5xx throw now preserves server-extracted message (one-line client.ts fix, Phase 34 DV-V16-09/10). Backward compatible.
- [Phase 34]: Replaced vitest .toMatchObject({message:/regex/}) false-positive in client.spec.ts with try/catch + expect(...).toBe(...) byte-exact assertions for error-message verbatim coverage.
- [Phase 34]: [34-02 DynamicViewsModal] Modal ships dormant (Plan 34-03 wires DashboardsPage 4th button); per-row scoped useDynamicViewStore selectors via ViewListRow sub-component preserve PITFALL S-02/C-02 carry-forward
- [Phase 34]: [34-02 toast kinds] Toast taxonomy locked at 'info'/'error' (no 'warning' — type union doesn't include it); over_threshold reasons surface via badge title attr ('No filter active' / 'Exceeds max records'), not toast kind
- [Phase 34]: [34-02 dashboardId] Passed as PROP (not via DashboardContext) — Phase 30 provider wraps only the widget grid region, NOT modals; mirrors LayersModal mount pattern
- [Phase 34]: [34-02 AbortController evolution] Plan 34-02 ships mount-time abortRef for listDynamicViews only; Plan 34-03 ADDS previewAbortRef + saveAbortRef; Plan 34-04 ADDS deleteAbortRef and migrates handleDelete — avoids cross-cancellation between operations (Pitfall 6)
- [Phase 34]: [34-03 cursor-position insert] First CodeMirror 6 cursor-position dispatch implementation in this codebase — uses captured EditorView ref via onCreateEditor + view.dispatch({changes:{from:view.state.selection.main.head, insert:'{view}'}}). Phase 22's deferred 'insert-at-end' approach is superseded for future editors.
- [Phase 34]: [34-03 previewRanSinceLastSave flag] LOCKED state flag — initialized false; flips true ONLY on Preview success; reset on + New / row select / (Save success in 34-04). Plan 34-04 Save body reads: if (templateChanged && previewRanSinceLastSave && formColumnsJson !== null) body.columns_json = formColumnsJson. Prevents stale columns_json from leaking on edit-template-without-Preview path (BLOCKER #1 resolution).
- [Phase 34]: [34-03 PreviewState error source tag] Discriminated union has source: 'validation' | 'server' field. Validation errors auto-reset to idle when SQL becomes non-empty OR source_table_id becomes set. Server errors PERSIST until next Preview click. DOM data-error-source attr drives spec assertions (MAJOR #4 lock).
- [Phase 34]: [34-03 Preview button stays enabled during loading] Button remains clickable (text flips to 'Running…') so second click aborts in-flight call (P6 requirement). aria-label + data-testid='preview-button' for stable spec selection regardless of visible text.
- [Phase 34]: [34-03 draftSession counter] Lifecycle effect dep array includes a counter bumped on every + New click — guarantees form re-reset when isDraft is already true. Without it, two consecutive + New clicks don't trigger the effect because isDraft doesn't change.
- [Phase 34]: Plan 34-04: BLOCKER #1 columns_json carry rule uses three ANDed predicates (templateChanged && previewRanSinceLastSave && formColumnsJson !== null) in Save UPDATE body; resets previewRanSinceLastSave on Save success
- [Phase 34]: Plan 34-04: 4 AbortController scopes in DynamicViewsModal — mount-time (listDynamicViews) + previewAbortRef + saveAbortRef + deleteAbortRef; cleanup aborts all 3 operation-scoped on unmount
- [Phase 34]: Plan 34-04: Save NOT gated on materialize success — CRUD persistence stays even when materialize fails (over_threshold or error); operator recovers without re-editing
- [Phase 34]: Plan 34-04: DashboardsPage 4th action-bar button 'Dynamic Views' between 'Map Layers' and 'Back'; modal receives dashboardId + associatedTables as PROPS (no DashboardContext)
- [Phase 35]: buildWmsParams: TypeScript overload signatures preserve legacy 2-arg non-null return while widening 4-arg form to Record<string,string>|null (DV-V16-13)
- [Phase 35]: DynamicViewEntryInput (status + viewName only) is the WMS-boundary contract — expiresAt/reason/error stay renderer concerns
- [Phase 35-widget-binding-and-pipeline]: dashboard_layers.dynamic_view_id is a nullable INTEGER soft-FK (no REFERENCES) — layer survives dv deletion, renderer detects orphan; table_id stays NOT NULL with table_id = dv.source_table_id for dv-bound layers
- [Phase 35-widget-binding-and-pipeline]: Use 'dynamic_view_id' in attrs discriminant in updateDashboardLayer so PATCH { dynamic_view_id: null } explicitly clears the binding (consistent with info_* fields); ?? would silently ignore explicit null
- [Phase 35-widget-binding-and-pipeline]: Frontend DashboardLayerDto.dynamic_view_id is non-optional (number | null) — strict contract forces all fixtures to populate the field; prevents silent undefined leakage into PATCH bodies that would skip the discriminant branch
- [Phase 35-widget-binding-and-pipeline]: [35-03 orchestrator] Per-dv last-seen-matVer ref (useRef<Map<number, number>>) added on top of the locked AbortController Map — research skeleton said unnecessary but T7 (cross-dv isolation) requires it; without the guard, bumping table B re-fires every dv on table A — T7 is the authoritative plan contract; research said tracking was unnecessary but matVersionKey changes on ANY table bump and the effect iterates ALL dvs — without per-dv last-seen guard, cross-dv aborts would happen
- [Phase 35-widget-binding-and-pipeline]: [35-03 orchestrator] Late-rejection guard at catch entry: if (ctrl.signal.aborted) return silences both native AbortError and unmount-during-rejection race — Unmount aborts the controller, but the materialize promise's rejection microtask can still fire after unmount; the signal-aborted check is the canonical guard rather than relying solely on err.name === AbortError
- [Phase 35-widget-binding-and-pipeline]: [35-03 orchestrator] DashboardContext.dynamicViews is REQUIRED (not optional with []) — mirrors Phase 30 widgets-required lock; missing-context errors loud at compile time; 4 fixture updates absorbed across DashboardContext/InfoCard/WidgetRenderer specs — Phase 30 STATE.md locked widgets-required pattern with rationale "make missing-context errors loud at compile time"; orphan-detection consumer (Plan 35-05) cannot be silently undefined
- [Phase 35-widget-binding-and-pipeline]: [35-03 orchestrator] WidgetConfigModal + LayersModal dynamicViews prop is OPTIONAL with [] default — downstream picker consumers ship in 35-04/35-06; existing test fixtures stay compile-clean — The conduit-only nature of this plan means modal-side fixtures (LayersModal.spec.tsx with 7 layer factories) shouldn't be forced to learn a prop until the consumer ships
- [Phase 35-widget-binding-and-pipeline]: [35-03 orchestrator] retry(id) uses force=true semantics — skips both last-seen guard and cold-start gate, still uses AbortController Map for dedup; renderer Retry buttons (Plan 35-05) always re-fire even when nothing has changed — Error-state Retry is operator-initiated and represents intent to re-attempt regardless of state; AbortController dedup prevents rapid-click pile-up
- [Phase 35]: [35-04 chartconfig-picker] dv:<id> option-value discriminator-prefix chosen over a parallel kind field on the option — single string, zero collision risk, branch on value.startsWith("dv:") without extra state lookup
- [Phase 35]: [35-04 chartconfig-picker] Dual-write tableId + dynamicViewId on Apply (research correction #3 lock) — drill-down + filter-bar code paths read tableId unchanged; mutual exclusion enforced at picker layer (handleTableChange explicitly deletes dynamicViewId on plain-table pick)
- [Phase 35]: [35-04 chartconfig-picker] JSON.parse(columns_json) happens INSIDE dataSourceOptions builder (not at server boundary or in a hook) — single coercion site, try/catch covers malformed wire-data (same disabled+hint UX as null)
- [Phase 35]: [35-04 chartconfig-picker] Both CustomConfigPanel branch and standard branch get the third optgroup — map's usesDataSource !== false guard at line 220 suppresses entirely for map (Pitfall 8 preserved), but other future custom-panel charts inherit the picker for free
- [Phase 35]: [35-04 chartconfig-picker] Stable hoisted-mock pattern + vi.mocked().mockImplementation re-bind (NOT vi.spyOn re-invocation) is the canonical pattern for ChartConfigPanel tests — third occurrence after Phase 11-10 + 23-03; avoids useEffect([config,chartDef]) infinite loop
- [Phase 35]: Plan 35-05: dv-bound renderer 5-state + orphan + Retry context (DV-V16-13/14). Effect 1 untouched in both renderers (research finding #2 lock); Effect 2 suspend-gate extends to dvStatus=='pending'; render body adds orphan + 4-status gates BEFORE existing chain; DashboardContext extended with retryDynamicView from orchestrator hook.
- [Phase 35]: Plan 35-06: replaced LayersModal standalone TABLE picker with unified Data Source picker inside KineticaWmsLayerForm (single-select enforces mutual exclusion; back-compat via optional prop rendering for MapConfigPanel)
- [Phase 35]: Plan 35-06: dynamicViewsKey primitive selector mirrors viewsKey for Pitfall 7 lock — added to BOTH Effect 2 + Effect 3 dep arrays so MapChartRenderer re-fires on dv store changes (pending → materialized hand-off)
- [Phase 35]: Plan 35-06: Effect 2 null-skip ALSO removes a previously-materialized OL ImageLayer when status flips mid-session (stack stays clean; no orphan tile loads); functional setState reconciles hasOverThresholdLayers boolean once per effect fire
- [Phase 36]: gate_status: red — server vitest exits non-zero in both auth modes due to cross-mode test failures; Phase 32 dynamic-view specs all green (86/86)
- [Phase 36]: 36-01 audit: 16/18 criteria PASS via source inspection; e2e.1-3 DEFERRED (live Kinetica UAT); e2e.4-5 PASS (deterministic reset path)
- [Phase 36]: 36-VERIFICATION.md status: failed — SC2 FAIL due to server vitest cross-mode isolation (pre-existing); Phase 32 dynamic-view specs 86/86 green; VERIFY-V16-01 stays unchecked
- [Phase 38]: Migration block appended after dynamic_view_id guard for chronological ordering; single PRAGMA table_info query reused (count stays 1)
- [Phase 38]: Frontend DashboardLayerDto deferred to Plan 38-02 Task 3 paired with wmsUrlBuilder rewrite
- [Phase 38]: coalesceCbConfig validates parsed JSON has both attr+breaks keys before accepting as CbConfig
- [Phase 38]: trackDetect strict 4-name match only (TRACKID/x/y/TIMESTAMP), no aliases
- [Phase 38]: STYLES_BY_MODE.classbreak='cb_raster' — Lane C single CB path per 37-SPIKE-NOTES.md
- [Phase 38]: TrackConfig inline in wmsUrlBuilder.ts — single consumer; Phase 40 extracts if 2nd consumer surfaces
- [Phase 38]: NTILE SQL template copied verbatim from 37-SPIKE-NOTES.md ## Decision (PARTITION BY 0 form) — no re-derivation; parseQuantileResponse validates finite-number per entry; quantileFn has no in-flight dedup (single-shot per click)
- [Phase 39-01]: Unused imports removed from KineticaWmsLayerForm.tsx after ClassbreakParamsGroup deletion (probeCardinality, useToastStore, FontAwesomeIcon, faXmark, useCallback, useRef) — tsc clean confirms no breakage
- [Phase 39-01]: CbConfigForm.tsx ships as skeleton with isValid(true) on mount — Plan 39-02 replaces with real validity rule (breaks.length >= 2); props tableRef/schema/tableName silenced via void for Plan 39-03 consumption
- [Phase 39-01]: contour hidden from render-mode picker via m !== "contour" filter (CB-V17-01); RenderMode type unchanged; existing contour-mode layers still render contour params block below picker
- [Phase 39-02]: WKB inline message shown whenever hasWkbColumns=true (not gated on eligibleColumns.length===0) — test wins as authoritative spec over plan action description
- [Phase 39-02]: patchCb central write site: all cb_config mutations go through onChange({ ...config, cb_config: JSON.stringify(next) }) — never touches legacy cb-column/classbreak-array fields
- [Phase 39-03]: cardinality loading hint placed OUTSIDE categorical section guard — controlled component timing: probe fires before parent propagates new valsType; hint must be visible during in-flight probe
- [Phase 39-03]: aria-label removed from <other> chip span — non-interactive display element; aria-label causes queryByLabelText false-positive conflicts with the "no value input for <other> row" assertion
- [Phase 39-03]: confirm-overwrite dialog is inline boolean state (showConfirm) — mirrors LayersModal.tsx confirmDeleteId pattern; NOT a portal modal
- [Phase 39-03]: color/label/advanced preservation by index — old[i] fields preserved for i < oldBreaks.length; PALETTE_COLORS[i%len] fallback for new indices; open-ended last row: value='' + label='≥ {lastBoundary}'
- [Phase 39-03]: CB-V17-09 regression test uses buildFingerprint pure-function pattern — does not require mounting MapChartRenderer; locks the {p,c,t} JSON.stringify shape via structural grep + pure-function assertions
- [Phase 40-01]: TrackConfig + coalesceTrackConfig extraction: Phase 38 deferred until 2nd consumer; Phase 40 form UI is that consumer — lib/trackConfig.ts created; wmsUrlBuilder.ts re-exports for back-compat
- [Phase 40-01]: Back-compat re-export requires both local import AND re-export: `export { } from "./trackConfig"` alone doesn't bind the symbol in local scope; separate `import { coalesceTrackConfig } from "./trackConfig"` needed for line-440 callsite
- [Phase 40-01]: useEffect([columns]) dep array excludes patchTrack + config.track_config — auto-seed fires on columns-change only; persisted non-null track_config is the guard preventing overwrite; mirrors CbConfigForm cardinality probe pattern
- [Phase 40-01]: TrackSubSection ships dormant (Plan 40-01); Plan 40-02 mounts in KineticaWmsLayerForm + adds TRACK-V17-03/05 coverage; pattern mirrors Phase 39-01 CbConfigForm skeleton
- [Phase 40]: Single-gate wiring (Pitfall 5 lock): (renderMode === 'raster' || renderMode === 'classbreak') && <TrackSubSection/> as one expression — two separate gates would unmount/remount on mode swap, losing component state
- [Phase 40]: Integration-level host-form spec: CbConfigForm not mocked → TrackSubSection not mocked; real selectors 'TRACK PARAMS' + 'Treat as track table' used for presence/absence assertions
- [Phase 40]: TRACK-V17-05 fingerprint regression mirrors CB-V17-09 exactly: buildFingerprint local helper + fs.readFileSync grep asserts ≥2 production callsites; zero production code changes (Phase 38 t-slot locked)
- [Phase 41]: useId() generates colon-containing IDs invalid for CSS querySelector; spec Test 12 uses document.getElementById() instead
- [Phase 41]: [41-01 LayersLegendPanel] Component JSDoc must not mention store names to avoid grep-based Test 14 false-positive; aarrggbbToCssColor uses rgba() to handle alpha channel
- [Phase 41]: [41-01 legendPanelConfig] getLegendPanelCorner uses LEGEND_PANEL_CORNERS.includes() not ?? so junk-strings fall back to default; chip text 'Class Break' two words matching KineticaWmsLayerForm label
- [Phase 41]: Test 6 toolbar ordering uses role+aria-label selector — MapDrawToolbar mock renders without .map-draw-toolbar class
- [Phase 41]: includedLayerIdsForLegend reads from widgetConfig (Record<string,unknown>) not MapWidgetConfig — the field is not a MapWidgetConfig member
- [Phase 41]: getState() added to dashboardLayersStore mock so resolvedLegendLayers useMemo can call .getState().layers imperatively
- [Phase 42]: [42-01 resolveLegendLayers]: ResolvedLegendLayer local import required alongside re-export — export type { X } from ... alone does NOT bring name into local scope for use in prop types (TypeScript scoping rule; confirmed by TS2304 error)
- [Phase 42]: [42-01 WidgetConfigModal.widgets]: Required prop (not optional) — DashboardsPage always has widgets state; mirrors Phase 30 DashboardContextProvider.widgets required lock for loud compile-time failure on missing context
- [Phase 42]: LegendConfigPanel reads widgets from props (not useDashboardContext) — WidgetConfigModal is outside DashboardContextProvider; hook would throw at runtime
- [Phase 42]: mapWidgetIdsKey primitive string dep avoids referential re-fires on auto-pick useEffect (mirrors legendKey pattern)
- [Phase 42]: void onConfigureWidget removed from WidgetRenderer atomically with legend branch addition (Plan 42-01 placeholder removed when consumer ships)
- [Phase 44]: DataFilterRenderer uses tables-as-prop (DashboardContext does not expose tables) — mirrors InfoCardRenderer pattern
- [Phase 44]: Sole-trigger invariant enforced: DataFilterRenderer never imports materializeFilter — static spec assertion on every CI run
- [Phase 45]: pickInterval walks DATE_TRUNC-native entries only (dateTrunc !== null), returns finest that fits maxIntervals — sub-hour FLOOR-epoch entries in INTERVAL_LADDER for buildTimelineBucket use but not auto-selected by pickInterval
- [Phase 45]: buildTimelineRangeQuery uses EXTRACT(EPOCH FROM MIN/MAX(col)) — NOT columnStatsFn (asserts Number.isFinite but Kinetica returns datetime MIN/MAX as date strings)
- [Phase 45]: COUNT_DISTINCT → COUNT(DISTINCT col) rewrite in buildTimelineSql aggExpr; GROUP BY uses literal alias 'bucket' not full DATE_TRUNC expression
- [Phase 45]: DEFAULT_COLOR_THEME = Set2 — ColorBrewer 8-color qualitative; Tableau-10 is not in the colorbrewer package
- [Phase 45]: [45-02 config-panel] Column pickers use inferDataTypeFromColumn() — DATETIME_TYPES/NUMERIC_TYPES are not exported from columnTypes.ts
- [Phase 45]: [45-02 registry] usesDataSource:false on timeline ChartTypeDefinition suppresses ChartConfigPanel generic Data Source section; TimelineConfigPanel renders its own picker

### Phase 44-data-filter-widget

- [44-01 filter-store]: FILTER_CAP_PER_TABLE exported constant raised 10→25; toast message uses constant interpolation (not literal "25") — single source of truth for cap value across addFilter + setBulkFilters branches
- [44-01 filter-store]: setBulkFilters empty-array path increments filterVersion by 1 — valid "clear-and-apply" gesture; downstream Effect 1 re-fires to remove filter view
- [44-01 where-builder]: empty IN array → "1=0" defensive guard in buildServerWhereClause; widget layer is expected to skip these before dispatch but WHERE builder is last line of defense
- [44-01 chip-text]: buildChipText BETWEEN display does NOT quote strings/datetimes — display-only format matches RESEARCH §D (not SQL-escaped); SQL escaping is in whereClause.ts
- [44-01 server]: /api/quantile n cap left at 256 — only /api/top-values raised to 1000 per FILTER-V17-06 scope; quantile buckets don't need 1000 entries
- [44-02 chart-type]: usesDataSource:false on datafilter ChartTypeDefinition suppresses ChartConfigPanel's generic Data Source section; DataFilterConfigPanel renders its own base-table picker from props.tables
- [44-02 config-panel]: Table change resets filterFields:[] — old column refs are invalid for a new table schema; operator must re-pick columns; this is the correct UX (prevents stale column refs)
- [44-02 config-panel]: kind picker disabled attr when column is '' OR column is missing from the table — prevents committing an invalid kind for an unknown column type
- [44-02 spec]: rerender() pattern used for tests 10-13 (kind-picker constraint assertions) to avoid duplicate DOM elements from multiple render() calls in the same test body — standard controlled-component test pattern

### Phase 25-spatial-predicate-spike

- [25-01 spike-close SPIKE-V15-01]: LATLON predicate locked to `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(?)) = 1`. Both STXY_WITHIN and STXY_CONTAINS returned identical counts across all 3 shapes (490758/490753/490752); (lon, lat) appears first in STXY_WITHIN matching column-pair order; canonical Kinetica reference; Phase 18 confirmed the STXY_WITHIN family. STXY_CONTAINS rejected.
- [25-01 spike-close SPIKE-V15-01]: WKT predicate locked to `ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(?)) = 1`. ST_WITHIN returned 0 rows — correct semantic (no US state fits inside a 1° NYC-area shape) but wrong for v1.5 user intent (features touching drawn shape, not features swallowed by it). ST_INTERSECTS returns 3 (NY, NJ, CT). ST_WITHIN 0-row result is NOT a Kinetica bug.
- [25-01 spike-close]: Server version not captured during operator run. Follow-up via `SHOW SYSTEM PROPERTIES` before Phase 26 ships to record version pinning in Phase 26 PLAN frontmatter.
- [25-01 spike-close]: Phase 26 buildSpatialOrBlock authorized. SPIKE-V15-01 PASS.
- [Phase 26]: [26-01 spatial-where-builder WHERE-V15-01]: SpatialMode defined locally in spatialWhereClause.ts (not imported from spatialQuery.ts) — zero cross-lib import for trivial union; both modules coexist independently
- [Phase 26]: [26-01 spatial-where-builder WHERE-V15-02]: composeWhereClause 4-case composition — (spatial AND col) / spatial-only / col-only / 1=1. Spatial first, column side wrapped in extra parens. V15-P-07 paren invariant locked by 17 unit tests (all .toBe full-string, no .toContain). ST_WITHIN rejected per 25-SPIKE-NOTES §3.2.
- [Phase 26-02]: WKB 501 fires BEFORE composeWhereClause call — production early-return; throwing stub in spatialWhereClause.ts is static guarantee only; mirrors Phase 18 intent at index.ts:776-783
- [Phase 26-02]: Empty-input backward compat: step 2 only fires when BOTH column AND spatial absent — v1.3 filters-only callers still receive 200 unchanged
- [Phase 26-03]: WHERE-clause extraction pattern for OR-count assertions: `statement.slice(statement.indexOf("WHERE ") + 6)` isolates predicate body from DDL keywords — avoids `CREATE OR REPLACE` interference with ` OR ` count
- [Phase 26-03]: Pair-completeness fixture ordering: test for "spatialFilters without spatialTarget" must include a column filter to bypass step-2 (empty-input check) and reach step-3 (pair-completeness check)
- [Phase 26-03]: Phase 26 complete — 66 total spatial-or-spatial-adjacent tests: 23 (v1.3 routes spec) + 17 (Plan 01 unit) + 26 (Plan 03 supertest) all green

### Phase 24-verification

- [24-05 gap-closure GAP-24-01-B]: FIX B (useEffect re-sync with mid-type guard) chosen over FIX A (full controlled-input refactor) — Phase 22 clamp-on-blur pattern is locked; FIX B is minimal diff that honors the existing "Reset when stored config changes externally" line-comment promise. Three useRef(prior)+useEffect blocks (radius/width/height); mid-type guard `if (draft === String(priorRef.current))` is self-synchronizing — after blur, clamp handler writes setDraft(String(value)) which restores draft===String(prior) until next keystroke. No isTyping boolean needed. 5 W-GAP-24-01-B regression specs; vitest 509→514 (+5); tsc exit 0; commit 10721fb.
- OIDC auth mode verified live at STEP 24-02/1.2 (full info-popup E2E under OIDC Authorization Code flow with Bearer-token auth); extends v1.3 OIDC S2.b closure to the v1.4 info-query endpoint.
- Kinetica-GEOMETRY SQL path (ST_DISTANCE + ST_GEOMFROMTEXT) verified live at STEP 24-01/2.1 — Session Fix #1 confirmed working; this is the narrower sub-case of TD-V14-WKB-SPIKE (true WKB-binary still deferred).
- TD-V12-04 CLOSED via STEP 24-02/2.3 evidence: viewName routing verified end-to-end (filter-active → _kbi_filt_... in POST payload; filter-cleared → raw table; rows correctly subset); STEP 24-02/2.4 confirmed sufficient closure without separate fixture materialization.
- Three new gaps captured for v1.4 gap-closure cycle: GAP-24-01-A (HIGH — layer-visibility toggle blanks entire app), GAP-24-01-B (MEDIUM — MapConfigPanel INFO POPUP inputs don't echo saved dimensions), GAP-24-02-A (HIGH — dashboard-switch crash at MapChartRenderer.tsx:483, OL image-load vs React unmount race). All deferred without inline fix per Phase 24 no-fix-inline policy.
- Criterion 3 (dashboard-switch + logout clear info selection) graded tech_debt: logout half PASS at STEP 24-02/2.2; dashboard-switch half DEFERRED at STEP 24-02/2.1 due to GAP-24-02-A (separate crash, not a reset-logic regression — four-store reset code was code-verified in Phase 23).
- Frontend regression: 509/509 vitest green; tsc --noEmit clean (exit 0). Baseline was 496/496 at Phase 23 close; 13 additional tests added across Phases 23-24 gap-closure.
- [Phase 24-verification]: [24-04 gap-closure]: GAP-24-01-A closed — FIX SHAPE A (per-layer sourceListenerCleanupRef capturing exact handler refs at attach time; source.un invoked BEFORE map.removeLayer in Effect 2 REMOVE branch + Effect 1 unmount cleanup). Root cause was stale OL ImageWMS source-listener race: imageloaderror / imageloadend handlers were never unsubscribed when Effect 2's REMOVE loop fired during a visibility-toggle, so in-flight image-loads completing post-removal invoked setTileLoadError against a half-detached source, throwing an uncaught exception that React (no ErrorBoundary in src/) handled by unmounting the root tree → blank dark-blue screen. Fix is orthogonal-and-complementary to GAP-24-02-A's planned mountedRef fix in 24-06. 519/519 vitest green; tsc clean.
- [Phase 24-verification]: [24-06 gap-closure GAP-24-02-A]: mountedRef cleanup-gate (useRef<boolean>(true)) closes the OL async image-load vs React unmount race. Effect 1 cleanup flips ref to false FIRST (before map.setTarget+dispose); xhr.onreadystatechange + handleTileError + handleTileLoadEnd + Effect 6 singleclick (top-of-handler + post-await + catch) all guard with 'if (!mountedRef.current) return;' as first line. Orthogonal and complementary to GAP-24-01-A's sourceListenerCleanupRef (24-04): per-layer listener cleanup detaches eagerly; mountedRef short-circuits anything that still fires (in-flight XHR is unsubscribable). 3 GAP-24-02-A regression specs (Tests L, L2, L3); 522/522 vitest green; tsc clean; commit 7b21520. v1.4 last HIGH-severity gap closed; awaits gsd-verifier re-spawn to upgrade 24-VERIFICATION.md criterion_3 from tech_debt to passed (dashboard-switch half is now live-verifiable).

### Phase 21

- [21-03 map-renderer-integration]: ol/Overlay with autoPan:false, positioning:bottom-left, offset:[0,-8] — manual edge-clamp deferred to Phase 22
- [21-03 map-renderer-integration]: eligibleLayers excludes WKB layers before fan-out — endpoint returns 501 (TD-V14-WKB-SPIKE); preventing error toasts on every click
- [21-03 map-renderer-integration]: EPSG:3857 → EPSG:4326 via ol/proj.transform at click time (PITFALL M-03)
- [21-03 map-renderer-integration]: Tasks 1 and 2 committed together — spec alone won't compile without handler implementations
- [21-03 map-renderer-integration]: Dismiss calls reset() not setActiveLayer(null); setActiveLayer signature is (layerId: number) — null is forbidden
- [21-02 info-popup-component]: infoQuery helper mirrors materializeFilter POST pattern exactly — apiFetch + throwForStatus + AbortSignal threading; 401/403/502 routed through typed-error chain
- [21-02 info-popup-component]: InfoPopup uses two separate scoped selectors (activeLayerId + entry) to prevent PITFALL S-02 fan-out re-renders on unrelated layer mutations
- [21-02 info-popup-component]: No setActiveLayer(null) anywhere in InfoPopup — dismiss calls reset() per locked activeLayerId invariant from Phase 20
- [21-02 info-popup-component]: dangerouslySetInnerHTML with inline no-sanitize comment citing PROJECT.md Key Decision; no DOMPurify or sanitize-html imported
- [21-01 render-info-template]: Empty string template ('') treated as configured template (mode=template, html='') — null is the sole kv-mode discriminator; empty-string is the author's choice to render an empty HTML node
- [21-01 render-info-template]: info_columns empty array ('[]') falls back to all response columns — locked: 'if (Array.isArray(parsed) && parsed.length > 0)' is the guard; empty array, non-array, mixed-type array all fall through to args.columns
- [21-01 render-info-template]: No HTML sanitization; inline docstring cites PROJECT.md no-sanitize lock + STATE.md shared-helper lock with exact file paths; Phase 23 Info Card imports same module with zero refactor
- [21-01 render-info-template]: 13/13 vitest tests green; tsc --noEmit clean; helper 77 lines (< 80), spec 184 lines (> 80)

### Phase 14

- [14-01 filter-view-store]: Phase 14 ships dormant plumbing only — no AggregatedWidgetRenderer, App.tsx, or DashboardsPage.tsx modifications until Phase 15
- [14-01 filter-view-store]: setView is POST-200 ONLY (V13-P-01 lock): markMaterializing is the pre-call action; no optimistic write path
- [14-01 filter-view-store]: clearView uses delete-key semantics (key-absence, not empty-array) mirroring filterStore.clearFilters
- [14-01 filter-view-store]: materializeVersion increments on same-name CREATE OR REPLACE; resets to 1 on new viewName
- [14-01 filter-view-store]: markMaterializing creates placeholder entry if absent (viewName="", expiresAt=0, materializeVersion=0); preserves prior fields if entry exists
- [Phase 14]: materializeFilter + dropFilterView ship DORMANT in Phase 14 — Phase 15 AggregatedWidgetRenderer is the designated first caller
- [Phase 14]: [14-02 client-helpers]: ActiveFilter imported as type-only from filterStore — no client-side type duplication; DELETE returns 200 (not 204) per Phase 13 contract
- [Phase 14]: Topbar.tsx working-tree modification is pre-existing (predates Phase 14); committed footprint uses 'git diff HEAD' form not working-tree form to verify exact 4-file scope
- [Phase 14]: materializeAbortRef references in filterViewStore.ts and client.ts are comment-only (JSDoc pitfall references V13-P-10) — not executable code; dormant-plumbing scope holds

### Phase 13

- Plan 13-02 view-name builder returns UNQUALIFIED names (S4 PASS for both forms; bare is simpler)
- Plan 13-03 endpoint uses `kineticaSql(req, ddl, { op: "MATERIALIZE" })` directly with per-user creds — no service-account fallback in v1.3 (S2.a password PASS)
- Phase 15 LIFE-V13-02 `isViewNotFoundError()` pattern locked: `/SqlEngine: Object '[^']+' not found/i` + Kinetica code `S/SDc:1513` at HTTP 400 (S3 verbatim)
- OIDC-mode DDL probe (S2.b) deferred to Phase 15 LIFE-V13-02 or Phase 17 verification — no token reachable in spike environment; not blocking Phase 13
- [Phase 13-spikes-and-endpoint]: Plan 13-02 view-name builder takes no schema parameter — S4 spike showed both qualified and unqualified WMS LAYERS work; bare unqualified is simpler (no schema lookup, no schema field on response)
- [Phase 13-spikes-and-endpoint]: Server-side ActiveFilter type duplicated in whereClause.ts (not imported from frontend filterStore.ts) — keeps server module frontend-import-free; field-shape parity locked by inline doc-comment
- [Phase 13-spikes-and-endpoint]: Plan 13-03 handlers contain NO try/catch — typed Kinetica errors bubble through asyncHandler -> errorMiddleware. Distinct from /api/views/:id/materialize (persisted) which keeps try/catch only because it persists status='error' to SQLite. Transient views have no row to persist.
- [Phase 13-spikes-and-endpoint]: Plan 13-03 OIDC supertest pattern — hoisted vi.mock("openid-client") with Issuer doubling as constructor + static-discover namespace; matches auth.oidc.spec.ts. resetOidcClientForTests() in beforeEach clears the singleton. OIDC sessions seeded directly via createSession({ credentialType: "oidc", secret: <fake_token>, idToken: <fake_jwt> }) AFTER buildTestApp().
- [Phase 13-spikes-and-endpoint]: Plan 13-03 endpoint contract LOCKED for Phase 14: POST -> { viewName: string, expiresAt: number }; DELETE -> { dropped: true }; view-name regex /^_kbi_filt_u\w+_d\d+_t\w+_s\w{8}$/; both routes under /api requireAuth namespace.

## Blockers/Concerns

- ~~SPIKE-V13-01 P1 gate~~ → RESOLVED: PASS in 13-01 — WMS LAYERS=`<materialized_view_name>` renders PNG tiles; MAP-V13-* stays in v1.3
- ~~SPIKE-V13-02 P1 gate (password mode)~~ → RESOLVED: PASS in 13-01 — per-user CREATE/DROP DDL works; no service-account fallback needed for v1.3
- ~~**DEFERRED:** SPIKE-V13-02 OIDC-mode probe (S2.b)~~ → **CLOSED** — operator confirmed live OIDC end-to-end on 2026-05-07 (drill-down → POST materialize → DELETE clear succeeded under OIDC session creds). No service-account fallback needed.
- v1.1 open (non-blocking): TD-V11-03 RFC 9207 iss-check workaround in `oidc.ts:75-82` — security-flagged; must resolve before production deploy
- **TD-V11-04** (v1.3 surfaced, v1.4): OIDC test mocks (6 files) diverged from `new Issuer(meta)` in commit 22def0a; ~60 backend tests red. Not a v1.3 regression.
- **TD-V13-01** (new, v1.4): Backend route test fetch-mock brittleness under Node 24 / vitest 4 — 6 files, ~44 tests. Pre-existing.
- ~~**TD-V12-04** (confirmed-carried, v1.4): ki_home.v13_filter_fixture not materialized during UAT; operator used demo.nyctaxi. Reference SQL committed.~~ → **CLOSED (2026-05-11)** — viewName routing verified end-to-end at STEP 24-02/2.3; STEP 24-02/2.4 confirmed closure.
- ~~**SPATIAL-V14-03 WKB spike gate (v1.4 Phase 18):**~~ → **RESOLVED → TECH_DEBT (2026-05-08)**: Spike outcome `NONE_ESCALATE` (operator has no WKB-binary column reachable; runner-bug-tainted first run + WKT-typed fixture column prevented productive characterization). SPATIAL-V14-03 deferred as **TD-V14-WKB-SPIKE**. Phase 18 unblocked: ships SPATIAL-V14-01 + V14-02 only. See 18-SPIKE-NOTES.md ## Decision and PROJECT.md "v1.4 carried tech debt".
- **TD-V14-WKB-SPIKE** (carry-forward into v1.5): WKB spike re-run pending until a WKB-binary column becomes reachable. v1.5 WHERE-V15-01, TARGET-V15-03, and MAT-V15-03 all gate WKB at 501. Runner is production-parity (commit d458408); future re-run path documented in 18-SPIKE-NOTES.md.
- ~~**SPIKE-V15-01 P1 gate (v1.5 Phase 25):** Kinetica spatial predicates not yet live-probed against deployed instance.~~ → **CLOSED (2026-05-11, Phase 25-01, commit c01794e)**: 12 probes PASS. LATLON locked: `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(?)) = 1`. WKT locked: `ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(?)) = 1`. Phase 26 buildSpatialOrBlock authorized. ST_WITHIN 0-row result is correct semantic mismatch, not a Kinetica bug. See 25-SPIKE-NOTES.md.
- ~~**GAP-24-01-A** (new, 2026-05-11 — outstanding v1.4 followup): HIGH — layer-visibility toggle blanks entire app. Deferred to v1.4 gap-closure cycle.~~ → **CLOSED (2026-05-11, Phase 24-04, commits 3f2520d/a83fc93/18387fa)**
- ~~**GAP-24-01-B** (new, 2026-05-11 — outstanding v1.4 followup): MEDIUM — MapConfigPanel INFO POPUP inputs don't echo saved infoPopupWidthPx/infoPopupHeightPx.~~ → **CLOSED (2026-05-11, Phase 24-05, commit 10721fb)**
- ~~**GAP-24-02-A** (new, 2026-05-11 — outstanding v1.4 followup): HIGH — dashboard-switch crash at MapChartRenderer.tsx:483.~~ → **CLOSED (2026-05-11, Phase 24-06, commit 7b21520)**
- **TD-V17-LIVE-UAT** (new, v1.8 carry-in): Phase 43 milestone-level live walk-through never run (classbreak + track visual confirmation + legend parity). Pre-existing at v1.8 start.
- **TD-V16-TEST-ISOLATION** (inherited): server cross-mode suite contamination (~106 red). v1.9 Phase 53 must not worsen this; all new regression specs are frontend-only (wmsUrlBuilder/KineticaWmsLayerForm vitest — no new server specs expected).

### Phase 83 Plan 01 Decisions (locked 2026-06-25)

- **brandPageGuard module pattern:** mutable `{ isDirty, revert }` refs in a tiny module read by App.tsx onSelect before setPage — avoids prop-drilling through Sidebar; BrandingSettingsPage syncs refs in useEffect
- **applyBrandTokens exported** from brandStore.ts (was module-private) so BrandingSettingsPage can call it for draft preview without touching localStorage or BroadcastChannel
- **revertToSaved() action** on BrandState: re-applies saved config via applyBrandTokens(get().config, theme) — no network roundtrip on leave; safe for synchronous intercept
- **Leave-guard at onSelect level** (not useEffect cleanup): synchronous intercept before setPage eliminates the leave-revert race (Pitfall 2 from RESEARCH.md)
- **--glow-opacity via calc() in rgba()**: body aurora radial-gradient alphas use calc(N * var(--glow-opacity, 1)) — single token toggle, low risk, no style element injection
- **No theme-guard ALLOWLIST in 83-01**: BrandingSettingsPage scaffold has zero hex literals; 83-02 adds both allowlist entries when react-colorful hex defaults are introduced
- **deps pre-installed**: react-colorful@5.7.0, colord@2.9.3, @codemirror/lang-css@6.3.1 installed in 83-01 so 83-02/83-03 can import directly

## Session Continuity

Last session: 2026-06-26T19:19:44.687Z
Stopped at: Completed 86-02-PLAN.md
Resume file: None
