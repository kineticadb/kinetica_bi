# Milestones

## v1.20 Filter Panel (Shipped: 2026-08-27)

**Phases completed:** 8 phases (105–110, incl. inserted 109.1 + 109.2), 12 plans

**Delivered:** A presentation layer over the existing filter system — active filters can render in a collapsible right-side panel instead of the top bar, showing which widgets each filter touches and highlighting them on the canvas, with one-click clear-all. 19/19 requirements; operator UAT PASS on all 8 groups. Tag `v1.20`.

**Key accomplishments:**

- **Reverse-mapping pure lib** (Phase 105) — `computeReverseFilterMap` inverts `resolveFilterSet`/`resolveSpatialShapes` across BOTH read paths (chart widgets + map layers → owning map widget) and all filter kinds, so the per-filter "applies to" list can never drift from the actual read paths.
- **Display-mode persistence** (Phase 106) — `dashboards.filter_display_mode` column via PRAGMA-guarded idempotent migration + coalesced DTO field + validated PATCH allow-list; the milestone's ONLY server touch, defaulting to `topbar` so unconfigured dashboards stay byte-identical.
- **Filter panel + chips** (Phase 107) — collapsible right drawer XOR-switched against the top bar, with grouped chips, per-chip remove, per-group clear, provenance, empty state, and a collapsed rail + count badge. A single shared `FilterChip` (topbar + panel variants) replaced all three prior top-bar chip implementations. The panel is an in-flow flex sibling, so `react-grid-layout` reflows for free.
- **Applies-to list + on-canvas highlight** (Phase 108) — each chip shows "applies to N widgets" with an expandable list; hover rings the affected widgets, click scrolls to and flashes them. New session-only `filterHighlightStore` (12th store in the reset chain) + a `WidgetCard` extraction with scoped-selector re-render isolation.
- **Global clear-all** (Phase 109) — one action clears every table filter, dv filter, and spatial draw by mutating INPUT stores only; the untouched orchestrator ref-count DROPs the combination views. Grep-gated that the handler imports no `materializeFilter`/`dropCombinationView`.
- **Filter scope for custom-panel charts** (Phases 109.1 + 109.2, inserted mid-milestone) — Calendar Heatmap, Timeline, and Numeric Line gained the per-visualization filter-scope control AND were wired into the engine that honors it: removed from `NON_TRIGGER_TYPES` in both the orchestrator and the reverse-map, calendar's dead `filterViewStore`/`respondToFilters` read path swapped to the `filterCombinationStore.vizToHash` pattern, and the legacy `respondToFilters` toggle retired.
- **Designer settings UI + milestone verification** (Phase 110) — `canEdit`-gated Settings modal with a save-on-change Top-bar/Right-panel segmented toggle that flips the surface live with no reload, riding the existing `dashboards:edit` (no new RBAC permission). Verified green on both stacks (web vitest 154 files / 3439 tests; server SET-BASED ⊆ TD-V16-TEST-ISOLATION) plus a blocking operator walk-through of all 8 groups including light/dark and narrow-viewport visual checks.

**Notes:** Two map-area changes shipped alongside (not v1.20 requirements): the basemap default moved to OpenStreetMap after CARTO began watermarking unauthenticated tiles — adding an optional `VITE_CARTO_API_KEY` plus per-widget/per-theme basemap CSS with Dark map / Light Gray Map / None presets; and a **filtered-view bug fix in the map info click**, which had been resolving its FROM target from the pre-v1.18 `filterViewStore` that Phase 91 stopped populating, so clicking a filtered tile silently returned base-table records. Both are covered by the Phase 110 UAT (groups 6 and 8).

**Stats:** 71 commits since `v1.19`; 56 files changed in `packages/` (+6358 / −491); 2026-07-08 → 2026-08-27.

---

## v1.19 Visualization Customization (Shipped: 2026-07-08)

**Phases completed:** 8 phases (97–104), 19 plans

**Delivered:** Per-visualization control over data + presentation without touching the shared filter/materialize engine. 27/27 requirements; operator UAT PASS on all features. Tag `v1.19`.

**Key accomplishments:**

- **Calendar smart domain control** (Phase 97) — single smart time-granularity dropdown (month/week/day/hour → auto domain+subdomain) alongside the existing two-dropdown UI; designer-restrictable options.
- **Per-visualization custom WHERE clause** (Phase 98) — freeform raw-SQL predicate ANDed into each plain-SQL widget's read query on top of active filters (against the view it already reads — never a new materialize path; map/WMS excluded; invalid WHERE errors that widget only).
- **Custom metrics** (Phases 99–100) — per-table labeled SQL aggregate expressions, server-persisted with CRUD (read-ungated / write `datasets:manage`, no new RBAC permission), Tables-area editor, and metric-picker integration emitting the expression directly (no extra aggregation wrapper).
- **Smart / Logarithmic Y-axis** (Phase 101) — per-widget Y-axis scale mode (Zero-based default / Smart / Logarithmic) on line, timeline, and bar charts.
- **Multi-column group-by on bar** (Phase 102) — N grouping columns with a clustered-vs-stacked toggle and an env-var series cap (truncate + warn); single/none renders byte-identical.
- **Synchronized map viewports** (Phase 104, added post-verification) — sync-enabled maps pan/zoom together per-dashboard with an echo-loop guard; default OFF and byte-identical when unset.
- **Milestone verification** (Phase 103) — green automated gates on both stacks + live operator walk-through; re-verified 2026-07-08 to cover the added Phase 104. A pre-existing multi-map info-popup scoping bug surfaced during 104 UAT was fixed (`activeWidgetId` scoping) + regression-tested.

**Notes:** Two out-of-scope UI improvements shipped alongside (not v1.19 requirements): a bar-chart "Min Bar Size" option (scroll-on-overflow) and an aggregated multi-column-group-by Data Table + value-axis width fix.

---

## v1.18 Per-Visualization Filter Selection (Shipped: 2026-06-30)

**Phases completed:** 10 phases, 20 plans, 24 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.17 Chart Number Formatting (Shipped: 2026-06-27)

**Phases completed:** 3 phases (85–87), 3 plans

**Delivered:** Readable large numbers on charts + in formatted columns — an SI "smart abbreviation" number format (k/M/G/T via d3 `~s`) added to the v1.15 column formatter + Column Format editor, and a hybrid per-widget Y-axis number-format option on timeline, line, and bar charts (defaults to the bound column's format, overridable, ticks-only). FRONTEND-ONLY (zero server diff). 32 commits, 27 files, +1.2k/−0.25k over 2 days. 6/6 requirements; operator UAT **6/6 PASS** with 8 polish gaps fixed in-session. Tag `v1.17`.

**Key accomplishments:**

- **SI smart-abbreviation format (Phase 85, FMT-V117-01/02):** added `FormatSpecSI { kind:"si"; decimals }` to `columnFormatter.ts` using the verified d3 spec `` `.${decimals+1}~s` `` (1,234,567 → "1.2M"; sub-kilo unabbreviated; raw-value fallback preserved); surfaced as "Smart abbreviation (k / M / G / T)" in the Column Format editor with live preview. Propagates to all 8 existing column-config surfaces for free via the single `resolveFormatter → buildFormatter` gateway — no per-surface wiring. No new dep (`d3-format` already present).
- **Per-widget Y-axis number format (Phase 86, AXIS-V117-01/02/03):** extracted the shared `FormatSpecEditor` from the Column Format editor; added an optional `yAxisFormat?: FormatSpec` config field + control to the timeline + numeric-line panels; renderer hybrid resolution (per-widget override → bound metric column's `resolveFormatter` → identity, `configVersion`-reactive) applied to the value-axis **tick labels only** (recharts `tickFormatter`) — tooltips/data labels untouched.
- **Bar chart value-axis format (Phase 87, UAT-added):** generalized the `formatSpec` ConfigField type so the bar chart got the same value-axis number-format control; content-sized value axis (SI labels reclaim plot space); axis titles made semantic so they follow the data when flipping vertical↔horizontal.
- **Verification + live UAT (Phase 87, VERIFY-V117-01):** green gates (web vitest 2809/2809, web+server tsc clean, theme-guard 128, zero `packages/server` diff) + a blocking 6-scenario operator walk-through — **6/6 PASS**.

**In-session UAT fixes (caught during the live walk, all committed):**

- Bar charts fill their card (absolute-inset wrapper + `.widget-body min-height:0` — flexbox `min-height:auto` was collapsing the percentage-height chart) — `630ca84`/`179fdec`/`55d572f`/`a12fcbc`.
- Bar chart axis titles follow orientation on flip; tightened axis-title gap; trimmed chrome; 11px axis fonts — `f8dfd49`/`46ab296`/`23fb1d3`/`1dfaf8b`/`55d572f`.
- Chart tooltip font tokenized + shrunk to `var(--text-xs)` (10px) — `193df99`/`fe0017a`/`2e99cc3`.
- Login page tokens (cyan `--accent-2` focus → `--accent`; bg → `--input-bg`; error → `--danger`) + compacted to dashboard density + smaller card — `e8db14a`/`3f93119`/`9394eb7`.
- Filter chips follow a re-branded `--accent` (were hardcoded violet) via `color-mix`; edit-roles popover opaque (`--panel-solid`); calendar legend gap tightened — `918cd48`/`e8db14a`.

---

## v1.16 White-Label Theming (Shipped: 2026-06-26)

**Phases completed:** 5 phases (80–84), 13 plans

**Delivered:** Full white-label theming — a permission-gated runtime admin UI to brand logo + app name, color palette (dark + light), typography, "feel" levers, and sanitized custom CSS, applied live with no redeploy and no flash-of-default on reload — on a refreshed, distinctive **Aurora** default theme. 70 commits, 74 files, +7.2k/−1.3k over 5 days (2026-06-22 → 2026-06-26). 23/23 requirements; live operator UAT **14/14 PASS** (2 gaps caught + fixed in-session with regression tests). FRONTEND + SERVER. Tag `v1.16`.

**Key accomplishments:**

- **Token foundation + Aurora default (Phase 80, TOKENS/THEME-V116):** full structural token vocabulary in `:root` (color, type ramp, 4px spacing, 4-step radius, elevation, motion) for dark + `[data-theme="light"]`; all existing styles migrated off literals so one token re-skins the app; the two-tier accent rule (`--accent` fills / `--accent-text` readable text); Aurora dark+light (violet `#7f40ed` on near-black, Manrope + Space Grotesk, hex-mesh + aurora-glow); `useChartAxisColors()` reads chart tokens via `getComputedStyle` + colorblind-aware `AURORA_CHART_PALETTE`; theme-guard extended to scan `global.css` + structural px/ms literals with a pragma escape.
- **Brand config server foundation (Phase 81, BRANDFND-01/02, SECA-V116-01, CSS-V116-02):** `brand_config` singleton SQLite table (`id=1` CHECK, JSON blob + logo bytes) seeded idempotently; the 18th permission `branding:manage` (byte-parity web/server) gating writes while `GET /api/branding` stays unauthenticated (login renders branded); multer logo upload with MIME + magic-byte + size validation and DOMPurify SVG sanitize; PostCSS AST custom-CSS sanitizer (strips `url()`/`@import`/`@font-face`/`expression()`/`javascript:`/`behavior`/`-moz-binding`, 64KB cap, unicode-escape bypass closed) run before storage.
- **Client token pipeline + FOUC + identity (Phase 82, BRANDFND-03/04, BRANDUI-01):** zustand brand store with unauthenticated bootstrap, `setProperty`/`removeProperty` runtime token application, `kbi-brand-tokens` localStorage cache feeding an inline `<head>` FOUC guard (no flash of default on reload), `BroadcastChannel` cross-tab propagation, and a `textContent` custom-CSS injector; logo/app-name/favicon drawn from the store across topbar, sidebar, login, and tab icon.
- **Branding admin UI (Phase 83, BRANDUI-02..07, CSS-V116-01, SECA-V116-02):** a single permission-gated settings page — color pickers (react-colorful) for dark+light with live WCAG pass/fail badges, curated self-hosted font pickers, five segmented "feel" levers (density / radius / glow / type-scale / motion), live preview card, Save + Reset-to-Aurora, sanitized custom-CSS editor, optional dark-mode logo override (BRANDUI-06) and optional dedicated favicon (BRANDUI-07).
- **Verification + live UAT (Phase 84, VERIFY-V116-01):** green automated gates on both stacks (web vitest 2772/2772, web+server `tsc` clean, theme-guard 126, server set-based ⊆ TD-V16-TEST-ISOLATION) + a blocking operator walk-through of all 14 scenarios (Aurora dark+light, live re-skin, WCAG warn, fonts, feel, logo/favicon upload + validation, custom-CSS sanitize+persist, no-FOUC reload, reset, cross-tab, non-permitted-user block) — **14/14 PASS**.

**In-session UAT fixes (caught during the live walk, all with regression tests):**

- `6643ab8` Test 10 — custom-CSS sanitizer wiped the WHOLE stylesheet on any syntax error (strict `postcss.parse` → `catch` → `""`); switched to `postcss-safe-parser` (per-rule recovery) + empty-rule cleanup so only the offending part is stripped.
- `6643ab8` Test 14 — branding page was reachable by a non-permitted user (render gated only on page state, not permission, while the server already 403'd PUT); added three client gates in `App.tsx` (RETURN_TO restore, guard effect, render branch).
- `3732f69` Tests 5/6 — added an active-theme WCAG pass/fail summary + body/muted/danger samples to the preview card; fixed the accent-text badge that paired against the accent fill (false FAIL) → repointed to accent-text vs bg.
- Earlier in-walk: branding buttons rendered as browser-default chrome (invented `ds-btn*` classes resolving to no CSS) → swapped to the app's real `btn-primary btn-sm` / `ghost-sm` paired-action convention; documented the convention in `CLAUDE.md`.

---

## v1.15 Column Formatting & View Lifecycle (Shipped: 2026-06-22)

**Phases completed:** 6 phases (74–79), 11 plans

**Delivered:** Client-side per-table column display config (custom labels + value formatting) applied across every render surface, plus robust materialized-view TTLs (env-configurable default + a client keep-alive touch). 31 commits, 43 files, ~5.4k insertions over 3 days. 16/16 requirements; live operator UAT attested PASS. Tag `v1.15`. NOTE: Phase 74 PIVOTED from a runtime app-settings store/UI/permission to deploy-time env vars (operator decision).

**Key accomplishments:**

- **Env-driven TTL defaults (Phase 74, SETTINGS-V115-01/02/03):** `DEFAULT_VIEW_TTL_MINUTES` (5) + `TTL_KEEPALIVE_LEAD_MINUTES` (1) read once at boot via `readPositiveIntEnv` (fallback+warn, not fail-fast; AP-5); replaced hardcoded `TTL=5` at all THREE materialize sites + their `expiresAt`; `ttlKeepaliveLeadMinutes` exposed on `/api/auth/me` → web auth store. NO app_settings table / CRUD / permission / settings UI (dropped in the pivot).
- **Column display config foundation (Phase 75, COLCFG-V115-01/02/03):** `column_display_config` table (composite PK `table_id`+`column_name`, JSON-in-TEXT `format_spec`) + per-column-upsert CRUD (read ungated, write `datasets:manage`); pure `columnFormatter.ts` (`FormatSpec` union, `buildFormatter`, never throws — percent preset appends literal `%` NOT d3 ×100; hand-rolled UTC dates, no d3-time-format) + new `d3-format` web dep; `columnDisplayConfigStore` mirroring dynamicViewStore with `resolveLabel`/`resolveFormatter`.
- **Column Formatting editor UI (Phase 76, COLEDIT-V115-01/02/03):** two-pane `ColumnFormatEditorModal` from the Tables area — per-column label (clear→raw) + format-kind picker (None/Number/Date/Advanced-d3) + live preview on a fixed sample + per-column save; theme-tokens-only.
- **Apply at render surfaces (Phase 77, COLAPPLY-V115-01/02/03/04):** shared `ColumnFormatTooltip` across all chart renderers; records-table header=label/cell=formatted; chart tooltip value-format + axis-title/series-legend labels; map info popups (template + KV) via a pure `renderInfoTemplate` callback; map layers legend exclusion locked by guard test.
- **View TTL keep-alive (Phase 78, TTLKEEP-V115-01):** dashboard-level `useViewKeepAlive` hook — read-only `SELECT 1 … LIMIT 1` touch per live filter/dynamic view, scheduled `lead` before expiry, re-armed via a captured window `W` (avoids the fixed-`expiresAt` tight-loop), clean teardown; static guard proves no materialize/drop import.
- **Verification + Live UAT (Phase 79, TTLKEEP-V115-02 + VERIFY-V115-01):** green automated gates both stacks (web vitest 2590/2590, web+server tsc clean, theme-guard, server set-based ⊆ TD-V16-TEST-ISOLATION) + a blocking operator walk-through across all surfaces; live behavioral test confirmed a read RESETS the Kinetica view TTL (keep-alive sufficient; re-materialize fallback not needed).

**In-session UAT fixes (caught during the live walk):**

- `01245b6` missing `ColumnFormatEditorModal` CSS (modal rendered as a flat list — theme-guard scans only `src/components/`, not `src/styles/global.css`).
- `59f1d96` unsaved columns default to **None** (type-inferred default seeded the baseline so the shown default could never be Saved).
- `df4fe21` Data Filter dropdowns re-fetch their value universe when the async `tables` registry loads after mount (spurious "No matches" race).
- `e51ab8d` single-series chart tooltips show the metric label (not the redundant slice name); pie slice labels formatted.
- `84b90a3` on-bar value labels run through the metric formatter (consistency).
- `264c4ca` Data Filter multi-select popover portaled to `document.body` (was clipped by the widget's overflow / react-grid-layout transform).

**Carried tech debt:** TD-V16-TEST-ISOLATION (server set-gate, openid-client/env-stub flaky files); deferred — runtime app-settings store (env-var pivot), dv-bound source-table label lookup, aggregation-aware number formatting, per-dashboard format overrides, conditional/value-based formatting (all in v1.15 Out-of-Scope).

---

## v1.14 Class-Break & Chart Config Refinements (Shipped: 2026-06-19)

**Phases completed:** 4 phases (70, 71, 72, 73), 6 plans

**Delivered:** Three targeted refinements to map class-break rendering and the time/numeric line charts, plus five review-gap fixes / one feature surfaced during the live walk-through. FRONTEND-ONLY: zero server diff across all 19 commits. 11/11 feature requirements + VERIFY-V114-01; live operator UAT attested 12/12 PASS. Tag `v1.14`.

**Key accomplishments:**

- **Numeric `<other>` catch-all (Phase 70, CBOTHER-V114-01/02/03):** class-break numeric breaks emit a literal `<other>` into `CB_VALS` (`1:3,3:5,<other>`), default-ON for new/edited configs only (already-saved layers preservation-locked by regression test), with its own per-break color in form + legend.
- **SHAPE\* hidden for lat/lon points (Phase 71, SHAPE-V114-01/02/03):** SHAPEFILL/LINE color + line-width hidden in both the layer raster form and the per-break cb-raster panel when `spatialMode === "latlon"`, AND suppressed in WMS emission (raster + classbreak branches) so stale saved values can't leak — leak-prevention regression-locked; point styling + antialiasing untouched.
- **Group-by for Timeline + Numeric-Line (Phase 72, GROUP-V114-01..04):** optional group-by dimension → one color-coded series per group over a single metric (UI-enforced mutual exclusion), top-12 cap with a "showing top N" affordance, palette-cycled colors; ungrouped path byte-identical (backward-compat locked). Shared `groupedSeries.ts` (selectTopSeries + pivotSeriesRows).
- **Verification + Live UAT (Phase 73, VERIFY-V114-01):** green automated gates both stacks (frontend vitest 2451/2451, web+server tsc clean, theme-guard 50/50, zero server diff) + a blocking 12-item operator walk-through attested PASS.

**In-session review fixes / feature (caught during the live walk):**

- `7aff988` numeric `<other>` legend row renders `<other>` not "0 – 0".
- `171ef00` grouped charts surface the Color palette picker + hide the now-irrelevant per-metric swatch.
- `8092d6c` standalone Legend widget honors action-engine layer overlays (sync with the in-map legend) — shared `lib/applyLayerOverrides.ts` routes both MapChartRenderer + LegendRenderer.
- `0265bce` calendar week-drill honors Kinetica's actual `DATE_TRUNC('week')` anchor (not hardcoded Monday) — fixes the cell-COUNT-vs-filtered-records mismatch (anchor-agnostic; closes the deferred CALUX week-anchor risk for the drill path).
- `4b4d43c` Radio Dashboard Control "Toggle buttons" display style (opt-in, default radio; reuses existing button look).

**Carried tech debt:** TD-V16-TEST-ISOLATION (server set-gate), TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer names), CALX-V2-* (calendar v2 backlog).

---

## v1.13 Calendar Heatmap Visualization (Shipped: 2026-06-18)

**Phases completed:** 7 phases (65, 66, 67, 68, 68.1, 68.2, 69), 22 plans

**Delivered:** A configurable Calendar Heatmap widget — GitHub-style time-bucketed grids across 8 domain×subdomain combinations, color-scaled, drillable cells that filter the whole dashboard (including WMS map tiles) to a time slice, for both table- and dynamic-view-backed bindings. FRONTEND-ONLY: zero server diff (calendar runs through the existing `/api/sql` + `/api/filter/materialize`).

**Key accomplishments:**

- **SQL foundation (Phase 65):** Pure, fully-tested `buildCalendarSql` (two-level `DATE_TRUNC` aggregation) + `computeCellBounds` (half-open buckets → inclusive BETWEEN, UTC-only); FROM target resolved before building the SQL string (no `fromSwap`). Live `DATE_TRUNC` unit/week-anchor spike auth-gated → annotated NOT-RUN, carried forward.
- **Config (Phase 66):** Calendar chart type + config panel — table/dv binding, timestamp column, metric+aggregation, dependent domain/subdomain dropdowns enforcing the 8 valid combos, palette, and a cell-count cap at config-save guarding against runaway grids (year×hour on wide data).
- **Renderer (Phase 67):** Read-only SVG heatmap — client-side gap-fill (useMemo), reactive 5-bucket color scale derived from data, theme-token greys for empty cells, both-axis sparse labels, per-cell tooltips; re-fetches on the filter-aware dep set.
- **Drill (Phase 68):** Cell click applies a timestamp BETWEEN filter (table-bound → `filters[tableId]`; dv-bound → `dvFilters[dvId]`, dv-isolated), removable human-readable chip, propagation to all consumer read-paths incl. WMS map tiles; `AggregatedWidgetRenderer`-as-sole-materialize-trigger preserved + statically asserted (no `materializeFilter`/`dropFilterView`/`fromSwap` import).
- **UX (Phase 68.1):** Wrapped GitHub-style domain-group blocks (compact in both dimensions) + config-gated, view-local on-widget domain/subdomain dropdowns (reset on reload, never persisted).
- **Correctness (Phase 68.2):** Per-group date-range gap-fill (in-range grey / out-of-range blank, no global cross-fill) + anchor-agnostic week handling via `inferWeekAnchorDow` (inferred from data, not assumed Monday) + week×hour 7×24 punchcard — fixing phantom-column and all-grey artifacts found in live review.
- **Verification (Phase 69):** Automated gates green (frontend vitest 2377/2377 from `packages/web`, web + server `tsc` clean, server vitest set-based ⊆ TD-V16-TEST-ISOLATION ≡ Phase 64 baseline) + blocking live operator full-matrix UAT attested PASS. Three dv/filter gaps caught in the walk (dv over-threshold infinite-loading, re-fetch flicker, OFF-still-re-fetches) fixed in-session repro-test-driven (`d60f3b1`) + re-walked PASS. CALUX-V113-03 week-anchor clause closed via the empirical-inference disposition (live spike best-effort, non-blocking).

---

## v1.12 Drill-Down on Dynamic-View-Backed Widgets (Shipped: 2026-06-16)

**Phases completed:** 4 phases (62, 63, 63.1, 64), 10 plans

**Delivered:** Restored click-through exploration for dynamic-view-backed widgets — drilling a dv-backed chart/table/map now filters the dynamic view's own data (not the source table), isolated to widgets on that same dv.

**Key accomplishments:**

- **Server (Phase 62):** Extended `POST/DELETE /api/filter/materialize` to build a filtered sub-view `FROM <dv materialized-view> WHERE <filter>` via a `dynamicViewId` body field + distinct `_kbi_filt_…_dv<id>_s<s>` view name — no new route; table path byte-compatible.
- **Client (Phase 63):** dv-scoped filter slices (`dvFilters`/`dvViews`) keyed so a dv id can never collide with a table id; dv-aware drill dispatch (routes to the dv, never the source table); filtered-dv read-path FROM-swap in both chart + records renderers; kind-scoped API cache keys; removable dv-name chips + dashboard-switch/logout lifecycle reset.
- **Map gap closure (Phase 63.1):** Caught in live UAT — a dv-backed WMS map layer kept rendering the unfiltered dv view. Wired `MapChartRenderer` to FROM-swap to the filtered-dv view at both `buildWmsParams` call sites + a new `dvFilterViewsKey` subscription; map now updates live in lock-step with dv charts (client-only; sole-materialize-trigger preserved).
- **Verification (Phase 64):** Automated gates green (frontend vitest 2141/2141 from `packages/web`, web + server `tsc` clean, server vitest set-based ⊆ TD-V16-TEST-ISOLATION) + blocking live operator UAT attested PASS (incl. the original pie-on-dv bug fixed and the dv-isolated scope: source-table widgets stay unaffected).
- **Invariants held throughout:** `AggregatedWidgetRenderer` remains the sole materialize trigger; the table-backed drill-down path is byte-unchanged; no new server routes; decoupled from the v1.11 action engine.

---

## v1.11 Programmable Widgets (Cross-Widget Control) (Shipped: 2026-06-15)

**Phases completed:** 7 phases (58, 58.1, 59, 60, 60.1, 60.2, 61), 16 plans

**Delivered:** Widgets can programmatically reconfigure other widgets. A generic, serializable, allow-list-guarded action engine + a first control widget (Radio Dashboard Control) where each option applies a config action to a target — live, transient, and decoupled from the filter/materialize pipeline.

**Key accomplishments:**

- **Action engine + safety contract** (58/58.1) — serializable `{ target, configPatch }` envelope (zod), single dispatch routing to 3 target kinds (widget.config / map-layer / dynamic-view), a versioned allow-list as the AI-safety contract, dangling-target safety, and a day-0 live-re-render canary; statically proven decoupled from filter/materialize (SAFETY-V111-02).
- **Radio Dashboard Control widget** (59/60) — net-new control type; author N options each binding a same-dashboard target + allow-listed field; selecting applies LIVE via a session-only overlay (no PATCH); reload resets to the configured default (transient-for-everyone).
- **Full-form side-by-side layer editor** (60.1, RADIOUX-V111-01) — reuses the entire `KineticaWmsLayerForm` (render mode + class-break builder + info popup) in the radio config panel via a full-config snapshot overlay + denylist validation; replaced the unusable raw-JSON editor.
- **Multi-target options** (60.2, RADIOMULTI-V111-01) — one option drives multiple targets via a single contribution write; option-level switch-replace drops stale targets; back-compat with legacy single-target options.
- **MCP/AI future seam documented** (SEAM-V111-01) — `applyWidgetAction` + envelope documented as the hook a future AI chat widget / MCP server reuses (none built this milestone).
- **Theming hardening** (cross-cutting) — semantic tokens (`--danger`/`--warning`/`--on-accent`), shared `lib/chartTheme.ts`, and a CI hex-guard (`theme-guard.spec.ts`) that fails the build on hardcoded colors in components.
- **Verified** (61, VERIFY-V111-01) — live operator UAT passed all 23 items + automated gates green (frontend 2087/2087, web+server tsc clean, server set-gate ⊆ TD-V16-TEST-ISOLATION). Frontend-only milestone (zero server diff). 13/13 requirements satisfied; GAP-61-01/02 fixed inline.

---

## v1.10 Per-Dashboard View Permissions (Shipped: 2026-06-10)

**Phases completed:** 3 phases (55-57), 7 plans (+ live UAT checkpoint)
**Timeline:** 2026-06-09 → 2026-06-10 (2 days)
**Audit status:** Phase 57 live operator walk-through (deployed Kinetica, password mode) `overall_status: passed`. 15/15 requirements complete. Frontend vitest 1725/1725; web + server tsc clean; server vitest within the TD-V16-TEST-ISOLATION known-flaky set; dashboard-access specs 98/98.

### Delivered

Per-dashboard view access layered on top of the global `dashboards:view` permission, so analysts can be assigned only the dashboards they need. View access is granted to specific **users (lowercased username, pre-provisioning supported) and/or roles** (union semantics), stored in a new app-local `dashboard_access_grants` table. **Admins + designers bypass** (see/open all — keyed on the new `dashboards:manage_access` permission, so any custom role granted it also bypasses); view-only roles (analyst) are restricted to their grants; newly created dashboards are **private-by-default**. Enforcement is **server-authoritative**: `GET /api/dashboards` is filtered, the dashboard-scoped GET routes (widgets/tables/layers/dynamic-views/views) return the existing 404 "Dashboard not found." on denial (existence hidden), and grant CRUD routes are gated by `dashboards:manage_access` with dual-sink audit. The operator-facing layer is a `DashboardAccessModal` (user + role grant lists, type-toggle add-row, free-text pre-provisioning) reached from a `manage_access`-gated "Manage access" list-row button (hide-don't-disable), plus a server-driven filtered list, a friendly empty state, and an inline "no access" panel on a 404 open. Intentionally revised the v1.8 "shared workspace — no dashboard ownership" decision. App-level visibility layer only — Kinetica per-user credentials remain the data-access authority.

### Key Accomplishments

- **Access model + server enforcement (55)** — 17th permission `dashboards:manage_access` (designer default, once-only `rbac_seed_history` seed); `dashboard_access_grants` table (user+role, pre-provisioning, explicit cascade on dashboard delete since the FK PRAGMA is off); `canViewDashboard` resolver (bypass→user grant→role grant union, private-by-default); list filter; 404 open-gating across 5 scoped routes (incl. a previously-unguarded dynamic-views route); grant CRUD + dual-sink audit. Zero web changes. Verified 7/7.
- **Access-management UI + list/open UX (56)** — grant CRUD client fns (DELETE-with-body) + web `PERMISSIONS` 17th-entry parity; `DashboardAccessModal`; `manage_access`-gated list-row button (hide-don't-disable true-negative spec); server-driven list (no client filter) + "shared with you" empty state; inline no-access 404 panel. Zero server changes. Verified 6/6.
- **Verification + live UAT (57)** — operator walk-through across analyst / manage_access / admin / designer personas attested all PASS, including the pre-provisioning headline (grant before first login) and revoke immediate-effect; automated gates ALL PASS. §1.3 URL deep-linking re-scoped as DEFERRED (no dashboard URL routing in v1.10); no-access panel verified via the revoke-then-open 404 path.

### Tech Debt

- **Carried:** TD-V16-TEST-ISOLATION (server suite cross-mode flakiness; set-based gate in use), TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04 (legend layer-name).
- **Deferred to v2.0 (DACL-V2-\*):** per-dashboard EDIT grants, dashboard ownership/transfer, link-based public sharing. Dashboard URL deep-linking (separate backlog item) surfaced during the UAT.

### Note

Mid-milestone, `origin/master` gained an independent docker/k3s deploy track (PR #1, tags v1.9.1/v1.9.2, author pheer). v1.10 was merged with it cleanly (one auto-resolved overlap in `client.ts`: their `||`→`??` same-origin API-base fix coexists with the new grant client fns).

---

## v1.9 Better Track Rendering (Shipped: 2026-06-08)

**Phases completed:** 3 phases (52-54), 12 plans + 7 gap-closure plans (54-04..54-10)
**Timeline:** 2026-06-06 → 2026-06-08 (3 days)
**Code delta:** +3,676 / −1,174 across 34 files (`v1.8`..`v1.9`, 35 commits)
**Audit status:** Phase 54 live-walk-through verification `overall_status: passed`. 20/20 requirements complete (11 milestone + 9 TRACKFIX gap requirements). Frontend vitest 1665/1665 (100%); web + server tsc clean; server vitest within TD-V16-TEST-ISOLATION known-flaky set; track-spec group 330/330; **zero server diffs across the entire milestone** (frontend-only). GAP-54-04 (legend layer-name) deferred as a post-milestone quick task.

### Delivered

Track rendering became a first-class, discoverable workflow in the map-layer form. Track is now a selectable spatial mode (alongside lat/lon, WKT, WKB) — auto-suggested when a table matches the TRACKID + x + y + ordering column shape — that drives four typed column pickers (x/y numeric incl. DOUBLE-precision, trackID non-geometry, ordering datetime+numeric) with TRACKID/TIMESTAMP defaults, narrows render modes to Raster + Class Break (heatmap excluded, silent coercion), and surfaces the full 8-param TRACK_* style matrix (head/line/marker color+shape+size) with alpha-aware color pickers that round-trip through save/reload. The v1.7 auto-detect sub-section + "Treat as track table" override checkbox were deleted cleanly (zero production usage). A live operator walk-through against the deployed Kinetica instance verified the flow end-to-end and surfaced 9 track-rendering gaps — all rooted in frontend data-shape / translation / trigger issues (the server spatial code was confirmed correct throughout) — each closed via repro-test-driven gap closure.

### Key Accomplishments

- **Track spatial mode foundation (52)** — `SpatialMode` form union widened to `"track"`; `isTrackTable` column-shape detection + auto-suggest; four typed pickers with isValid gating; `track_config` persistence (xCol/yCol/trackIdAttr/trackOrderAttr); track→latlon translation at the WMS X_ATTR/Y_ATTR wire + all 3 info-query cast sites; wire contracts (SpatialTarget + server) kept 3-mode. Also fixed (`5e3514b`) Kinetica `"double precision"` numeric-type recognition project-wide so DOUBLE x/y columns appear in pickers.
- **Render narrowing + param surfaces + color cutover (53)** — render-mode picker narrows under Track with silent heatmap→raster coercion; new TRACK STYLE section (color-input+alpha idiom) replaces RASTER PARAMS under Track+Raster; CbConfigForm gained an additive `trackContext` prop hiding per-break advanced panels under Track+Class Break; AARRGGBB color round-trip persistence; WMS emission byte-locked to the Phase 37 spike contract.
- **Live walk-through + 9 gap closures (54)** — `track_config`/`cb_config` read top-level (not off `layer.config`) at the isConfigComplete + buildSpatialColumns + spatial-target sites (no-WMS / failed-info / no-filter bugs); POINT*/SHAPE* suppression under track; full 8-param TRACK_* surface with distinct TRACKHEADSHAPES/TRACKMARKERSHAPES + marker controls; per-break categorical CB track coloring (one break color drives all three track color params positionally); track→latlon spatial-target translation in MapConfigPanel; new dashboard-scope `useMapOnlySpatialMaterialize` hook firing materialize for map-only dashboards while preserving the Phase 30 sole-trigger invariant.

### Tech Debt

- **Resolved:** TD-V15-MAP-ONLY-TRIGGER (closed by GAP-54-10's dashboard-scope materialize hook).
- **Carried:** TD-V16-TEST-ISOLATION (server suite cross-mode contamination, set-based gate in use), TD-V17-LIVE-UAT (v1.7 walk-through), TD-V14-WKB-SPIKE (true WKB-binary spatial mode), GAP-54-04 (legend shows "Layer N" not layer name — pre-existing, non-track; post-milestone quick task).
- **Deferred to v2.0:** TRACK-V20-01 (per-TRACKID coloring — per-break categorical CB coloring delivered), TRACK-V20-02 (track live preview), SYMBOLROTATIONS/WORLDLAYERS track params, embeddable dashboards.

### Recurring Lesson

`track_config` and `cb_config` are TOP-LEVEL `DashboardLayerDto` fields, NOT inside `layer.config` — 4 of the 9 gaps traced to consumers reading `config.track_config` → silently `undefined` → feature no-ops. Fix pattern: thread them as explicit params from `layer.<field>` (mirror `buildWmsParams`' `layerJsonFields`). Captured in memory `track-config-toplevel-field`.

---

## v1.8 Roles & Permissions (RBAC) (Shipped: 2026-06-06)

**Phases completed:** 9 (46-51 incl. 3 inserted: 50.1, 50.2, 50.3), 22 plans, 63 commits
**Timeline:** 2026-06-05 → 2026-06-06 (2 days)
**Code delta:** +8,038 / −415 across 73 files
**Audit status:** Milestone-gate Phase 51 `overall_status: passed` — **first milestone with a full formal close**: 42/42 live operator UAT attestations (all 5 personas), 6/6 automated gates, 25/25 requirements complete, zero gaps. Verification: `.planning/milestones/v1.8-phases/.../51-VERIFICATION.md` (or phases/ if not archived).

### Delivered

App-level RBAC over the existing per-user Kinetica/OIDC auth. A 16-permission code-defined catalog with DB-stored, editable role→permission mappings; 4 built-in roles (admin / user_admin / designer / analyst) + user-defined custom roles with union semantics for multi-role users; unassigned users default to analyst (zero-lockout rollout); the Kinetica `admin` account is always app admin via env-overridable bootstrap. Enforcement is server-authoritative: `requirePermission` guards 22 mutation routes + 7 net-new management routes, while the analyst-passthrough boundary (filter/materialize, sql, info-query, wms, top-values…) keeps click-through exploration — the product's core value — fully ungated and regression-asserted. The UI is role-aware (hide-don't-disable; grid inert via dragConfig; self-healing 403s with toast + debounced /me re-sync), with net-new Users and Roles management pages, a Profile page + logout, and dual-sink audit (OBS-1 log + rbac_audit table) on every role mutation.

### Key Accomplishments

- **Schema + data layer (46)** — `roles`/`role_permissions`/`user_roles` + `rbac_seed_history` (operator removals of default mappings survive restarts while new catalog permissions seed exactly once); `getEffectivePermissions` with bootstrap short-circuit, analyst fallback from LIVE mappings, case-insensitive lowercased usernames; OIDC bootstrap-admin boot warning
- **Server enforcement (47)** — `requirePermission` factory (403 + `PERMISSION_DENIED` + missing permission named + OBS-1 denial log); 22 route guards; ANALYST-PASSTHROUGH BOUNDARY documented in code with positive analyst-reachability supertests; `datasets:manage` 16th permission; `known_users` login upserts; 21 spec files migrated via `createAdminSession()` with the suite provably at baseline
- **Role-aware UI (48)** — /me widened; client permissions mirror with byte-parity spec; `hasPermission`; DashboardsPage/widget-grid/Sidebar gating; Topbar real identity; PERMISSION_DENIED self-healing (window-event indirection avoiding the client↔store import cycle)
- **Users page (49)** — table + chips + Edit-roles popover + bulk assign; `known_users`-backed last-seen; bootstrap lock row (synthesized server-side); app-shell onboarding banner; SAFE-V18-01 last-admin guard (server-only authority, verbatim 400)
- **Roles page (50)** — two-pane permission-matrix editor (draft+Save+built-in confirm+dirty guard); inline slug-validated custom-role create; holders_count delete-block; 3 role-based escalation guards (admin-assign / admin-mapping-edit / unheld-grant, verbatim 403s) with UI mirrors; `emitRbacAudit` dual-sink in all 5 mutation handlers
- **Operator-driven pre-UAT hardening (50.1-50.3 + follow-ups)** — Profile page + logout (Topbar user menu; chips relocated); users-table flexed-td misalignment, SQLite-UTC negative-time, permission descriptions; light-mode theming sweep (RolesPage's 43 non-existent `--color-*` vars, role-chip contrast, popover clipping, login banners); **login-shape fix** (`def616b` — POST /api/auth/login now carries roles+permissions, mirroring /me; fresh logins get the correct UI without refresh)
- **Verification (51)** — TD-V17-DASHPAGE-SPEC closed → frontend at **TRUE 100% green (1568/1568)** for the first time; live 5-persona UAT walk-through fully attested

### Test Coverage at Close

- Frontend vitest: **1568/1568** (100%); web tsc clean (2 pre-existing spec-type errors from v1.7-era also fixed en route)
- Server: 147/147 deterministic RBAC specs across 9 groups; set-based gate clean (failing files ⊆ 14 known-flaky TD-V16 list); server tsc clean; both builds clean

### Tech-Debt Ledger

- **CLOSED:** TD-V17-DASHPAGE-SPEC (stale assertion), TD-03 (closed during the 2026-06-04 restructure, recorded under v1.7)
- **Carried:** TD-V16-TEST-ISOLATION (~106 red, cross-mode contamination — v1.9 candidate), TD-V17-LIVE-UAT (v1.7 classbreak/track/legend walk-through), TD-V14-WKB-SPIKE, TD-V15-MAP-ONLY-TRIGGER
- **v1.9 seeds:** audit log viewer UI (rbac_audit table already accumulating), custom-role duplication, OIDC group→role mapping, CSS-variable lint (would have caught the RolesPage theming bug), embeddable/public dashboards via embed identity, legend-widget `--color-*` theming fix

---

## v1.7 WMS Class Break, Track & Legend (Shipped: 2026-06-05)

**Phases completed:** 8 of 9 (37-42, 44, 45 — Phase 43 verification NOT run), 19 plans
**Timeline:** 2026-05-19 → 2026-05-29 (core scope in 4 days; phases 44-45 added post-roadmap)
**Audit status:** Pragmatic close (operator-directed, 2026-06-05) — matches v1.2-v1.5 precedent. **Phase 43 (Verification + Live UAT) was never started**; per-phase verification passed for every shipped phase (37-42, 44, 45 each closed `passed` with their own VERIFICATION.md), but the milestone-level live walk-through (classbreak + track + legend end-to-end against deployed Kinetica) is deferred as **TD-V17-LIVE-UAT**.

### Delivered

The LayersModal now covers the full Kinetica WMS render-style surface. Operators configure **Class Break** as a third render mode (numeric + categorical breaks with `<other>` bucket, per-break label/color/advanced params, quantile **Auto-suggest** via net-new `POST /api/quantile`), **Track styling** as a sub-mode under raster/classbreak (auto-detected via TRACKID + x + y + TIMESTAMP column shape with operator override), and a reusable **Layers Legend Panel** that ships both as a floating in-map overlay (MapConfigPanel toggle, corner-anchored, collapsible) and as a standalone **Legend** dashboard widget bound to a map widget. Post-roadmap, two net-new widget types shipped: **Data Filter** (form-control filters — text/dropdown/multi-select/range/date/boolean — dispatching into `useFilterStore` via new `setBulkFilters` with `IN`/`BETWEEN` operator support end-to-end) and **Timeline Chart** (multi-metric auto-binned time series with drag-to-filter BETWEEN zoom).

### Key Accomplishments

- **CB/Track WMS spike (Phase 37)** — locked CB param lanes (Lane B `CB_ATTR`/`CB_VALS` basic; Lane C comma-separated under `STYLES=cb_raster` for advanced+track), 8-char AARRGGBB color standard, NTILE `PARTITION BY 0` quantile syntax
- **Schema + WMS engine (Phase 38)** — `dashboard_layers.cb_config`/`track_config` JSON columns; `wmsUrlBuilder` Lane C rewrite (fixed v1.2 6-char color bug); `POST /api/quantile`; `lib/trackDetect.ts`
- **Classbreak form UI (Phase 39)** — 3-mode render picker (contour removed); break-row builder with per-row advanced params; categorical `<other>` + cardinality probe (warn>100/cap>256); Auto-suggest with N-slider + confirm
- **Track sub-section (Phase 40)** — `TrackSubSection` under raster OR classbreak; auto-detect + override; head/trail styling persisted
- **Legend (Phases 41-42)** — pure-presentational `<LayersLegendPanel />` (zero store subscriptions; `legendKey` primitive selector); React-tree in-map overlay (NOT OL addOverlay); standalone `legend` chart type with orphan empty-state
- **Data Filter widget (Phase 44)** — `ActiveFilter.operator` discriminator (`eq`/`in`/`between`/`isNull`); `setBulkFilters` single-version-bump action; server `IN (...)`/`BETWEEN` WHERE emission; filter cap 10→25; live operator UAT passed
- **Timeline Chart widget (Phase 45)** — auto-bin interval ladder (year→minute + FLOOR-epoch sub-hour); up to 4 metrics with alternating Y-axes; drag-to-filter dispatching BETWEEN via `setBulkFilters`; persistent `<ReferenceArea>` filter band

### Test Coverage at Close

- Frontend vitest: **1492/1493** (1 pre-existing `DashboardsPage.spec.tsx` button-order failure, verified pre-existing against pristine baseline 2026-06-04); tsc clean
- Server vitest: **582/689** (106 failures = TD-V16-TEST-ISOLATION cross-mode contamination + TD-V11-04 `Issuer` mock divergence — verified identical on pristine baseline; NOT v1.7 regressions); tsc clean

### Repo Restructure (2026-06-04/05, outside GSD phases)

Repository flattened from double-nested `kinetica_bi/kinetica_bi/` to **npm-workspaces monorepo**: frontend → `packages/web/`, backend → `packages/server/`, root `package.json` is a code-free orchestrator. `server/src/env.ts` added as first import so dotenv loads before module-level env validation — **closes TD-03 from v1.0** (the `SESSION_ENCRYPTION_KEY` boot crash). Git history squashed to a single `Initial commit` (commit hashes/tags referenced in older planning docs no longer resolve). Path references in pre-v1.8 planning docs use the old `kinetica_bi/...` prefix — read them as `packages/web/...` / `packages/server/...`.

### Carry-over to v1.8

- **TD-V17-LIVE-UAT** (NEW) — Phase 43 milestone-level live walk-through never run (classbreak + track visual confirmation, legend parity). Track tile visual confirmation was already a Phase 43 precondition from the Phase 37 spike (empty `demo.track` fixture).
- **TD-V17-DASHPAGE-SPEC** (NEW) — 1 frontend spec red: `DashboardsPage.spec.tsx` "Dynamic Views button after Map Layers" button-order assertion.
- **TD-V16-TEST-ISOLATION** (inherited) — server cross-mode suite contamination (~106 red); also subsumes TD-V11-04 + TD-V13-01.
- **TD-V14-WKB-SPIKE**, **TD-V15-MAP-ONLY-TRIGGER**, **TD-V15-LIVE-UAT** (inherited) — unchanged.

---

## v1.6 Dynamic Views (Shipped: 2026-05-19)

**Phases completed:** 5 phases (32-36), 18 plans, 52 milestone commits
**Timeline:** 2026-05-14 → 2026-05-18 (5 days — heavy live-UAT polish cycle after the core code landed in 2 days)
**Audit status:** Closed with formal `/gsd:audit-milestone` run — status `gaps_found` (14/15 requirements satisfied; 1 unsatisfied: VERIFY-V16-01). Operator-directed accept-tech-debt close. The unsatisfied requirement is the verification gate itself, failing on pre-existing cross-mode server-test isolation tech-debt (NOT a Phase 32 regression — Phase 32 dynamic-view specs pass 86/86 in their assigned auth mode). Audit detail: `.planning/milestones/v1.6-MILESTONE-AUDIT.md`. Phase 36 verification status `failed` via source-only attestation + hard-gate enforcement (`36-VERIFICATION.md`); live operator UAT explicitly skipped this cycle per the v1.5 Phase 31 precedent — operator exercised the build continuously during development and each surfaced gap was closed inline.

### Delivered

Operators now define dashboard-scoped "dynamic views" — saved SQL templates with a `{view}` token that re-materializes on top of the v1.3 filter view whenever filters change, guarded by a max-records threshold. Visualizations (aggregated charts, records tables, and per-map-layer WMS sources) bind to a dynamic view as their data source via a ChartConfigPanel/LayersModal Dynamic Views optgroup; renderers FROM-swap (or LAYERS-swap) against the materialized dv name. When the underlying filtered source exceeds the threshold (or no filter is applied), the dynamic view is dropped and dependent widgets render an "Too much data — narrow your filters to enable this view." empty state with a Retry button. The materialize chain cascades: filter-view CREATE → row-count check → dynamic-view CREATE/DROP → widget re-render, with per-dv AbortController dedup and a cold-start no_filter fast-path that avoids any HTTP fan-out on first dashboard load. Lifecycle reset on logout / dashboard switch drops all materialized dynamic views (6th store in the canonical reset chain).

### Key Accomplishments

- **Server foundation (Phase 32)** — `dashboard_dynamic_views` SQLite table (idempotent PRAGMA-guarded migration mirroring v1.4 Phase 19 pattern); 3 pure helpers: `substituteViewToken` (case-insensitive `{view}` token replacement with absence detection), `buildDynamicViewName` (deterministic `_kbi_dv_u{userId}_d{dashboardId}_d{dvId}_s{slug}` naming), `createOrReplaceMaterialized` (TM/SMc:1078 race-recovery retry, shared with v1.3 filter-view materialize). 7 new endpoints: CRUD (`POST/GET/PUT/DELETE /api/dashboards/:id/dynamic-views`) + runtime (`POST /api/dynamic-view/preview`, `POST /api/dynamic-view/materialize`, `POST /api/dynamic-view/:id/drop`, `DELETE /api/dynamic-view/:id`). 86/86 supertest cases pass in both `AUTH_MODE=password` and `AUTH_MODE=oidc` across 7 spec files.
- **Frontend store + 6th lifecycle reset (Phase 33)** — `useDynamicViewStore` Zustand slice with `{ views: Record<id, { viewName, status, expiresAt?, error? }>, dynamicViewVersion }` shape and 5 locked actions (`setView`, `markPending`, `setError`, `clearView`, `reset`). 7 client helpers (`listDynamicViews`, `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView`) with `AbortSignal` threaded everywhere. Reset wired as the 6th store in the canonical lifecycle order at `App.tsx:80-106` (UNAUTHORIZED) + `DashboardsPage.tsx:419-444` (DashboardOpen) — both snapshot `status === "materialized"` entries and fire `dropDynamicView(dvId).catch(() => {})` per-row BEFORE calling `reset()`.
- **Management UI (Phase 34)** — `DynamicViewsModal.tsx` (979 LOC, 51 spec tests) — two-pane portal mirroring LayersModal: left list of existing views with per-row status badge (scoped `useDynamicViewStore.views[id].status` subscriber covering materialized/pending/over_threshold/error) and inline delete-confirm; right pane with form (name, source-table picker from associatedTables, CodeMirror SQL editor via `@codemirror/lang-sql@^6.10.0` with cursor-position `Insert {view}` button — first cursor-position implementation in codebase using `view.dispatch({ changes: { from: view.state.selection.main.head, insert: "{view}" } })`, max_records clamp-on-blur min 1 default 10000) + Preview button + 5-state Preview output panel (idle/loading/success-with-rows/success-0-rows/error) using `PreviewState` discriminated union with `source: "validation" | "server"` tagging. Save handler executes `buildDynamicViewName → markPending → materializeDynamicView → setView/setError` with locked columns_json carry rule. 4 distinct AbortController refs for mount-time list / preview / save / delete; dirty-state confirm on close. Wired to 4th action-bar button "Dynamic Views" on `DashboardsPage.tsx`.
- **Widget binding + cascading materialize (Phase 35)** — `useDynamicViewMaterializeChain` dashboard-scope orchestrator hook subscribes to `filterViewStore.materializeVersion` per-table; on bump it fires `markPending → materializeDynamicView → setView/setError` per dv with per-id AbortController dedup and a cold-start fast-path (`matVer===0 → setView no_filter directly without HTTP`). `buildWmsParams` extended from 2-case to 4-case precedence (dv-materialized → null skip → filter-view → bare). `dashboard_layers.dynamic_view_id INTEGER` schema migration (Plan 35-01) propagates through DTO → LayersModal Data Source picker → PATCH route → OL ImageWMS LAYERS-swap (Plan 35-06). ChartConfigPanel Data Source picker gains a Dynamic Views optgroup with dual-write `{ dynamicViewId, tableId }` (Plan 35-04). AggregatedWidgetRenderer + RecordsTableRenderer + MapChartRenderer FROM-swap (or LAYERS-swap for maps) against the resolved dv name (Plans 35-02, 35-05). Over-threshold widgets render "Too much data — narrow your filters to enable this view." with a context-threaded Retry button bound to the orchestrator's `retryDynamicView(id)` (force=true bypasses cold-start + last-seen guards). 24 supertest cases for preview/materialize/delete runtime routes (Plan 35-03).
- **UX polish (live-UAT cycle)** — Per-layer zoom-range visibility with dual-handle slider (`ZoomRangeSlider.tsx`); expanded colormap catalog (73 entries, Kinetica-docs-only after cividis/turbo removal); REVERSE_COLORMAP toggle with OL `updateParams` merge fix (always emits explicit TRUE|FALSE); MIN_LEVEL/MAX_LEVEL inputs removed (not in Kinetica heatmap WMS); info-query routing for dv-bound layers fires against dv viewName (not filter-view); server-side STXY_DISTANCE → ST_DISTANCE auto-retry on GEOMETRY columns; info popup default height tightened 400→250px; popup positioning prefers below-cursor when there's space; per-widget error boundary; fresh-layer default config emits all camelCase fields so styles take effect on first creation; in-flight Promise cache for `materializeFilter` + `dropFilterView` (dedup of concurrent calls); `throwForStatus` preserves verbatim Kinetica server 400 messages.
- **Verification (Phase 36)** — Three-plan source-only audit: 36-01 source matrix (20/23 PASS, 3 DEFERRED for live-UAT scenarios per Phase 31 precedent, 0 FAIL across Phases 32-35); 36-02 test gates (frontend vitest 1016/1016 green; frontend tsc clean; server tsc clean; server vitest RED in both modes due to cross-mode test isolation tech-debt — NOT a Phase 32 regression); 36-03 compiled `36-VERIFICATION.md` with hard-gate enforcement (refused to mark `status: passed` against red 36-02 gate). VERIFY-V16-01 stays `[ ]` with HTML comment citing failure mode.

### Issues Resolved Mid-Cycle (Live-UAT Bug Fixes; No Formal Phase 36.x)

| Commit | Description |
|---|---|
| `6873e65` | `columns_json` carry on CREATE path (was silently null after first save) — modal Save handler sends `columns_json` when `previewRanSinceLastSave && formColumnsJson !== null`; auto-Preview on Save when null |
| `4635a09` | Info-query routing for dv-bound map layers — `queryViewName` branches on `layer.dynamic_view_id` and reads from `useDynamicViewStore` before falling back to filter-view path |
| `56cf519` | `isTableNotFoundError` extended to match `S/SDc:1513` + "Object 'X' not found" (was only matching `TM/SMc:1078`); preview/materialize now correctly route to no-filter branch |
| `9345564` | `REVERSE_COLORMAP=TRUE` persisted after uncheck — OL `updateParams` merges, so always emit explicit TRUE/FALSE (not undefined) |
| In-flight dedup | `materializeFilter` + `dropFilterView` Promise cache keyed by `${dashboardId}:${tableId}` (dedupes concurrent calls from AggregatedWidgetRenderer + RecordsTableRenderer) |
| Popup DOM tracking | Popup container moved to FIRST child of `widget-map` (OL `addOverlay` physically `appendChild`-s the element, breaking React's child tracking) — fixed Uncaught NotFoundError on map widget creation |
| Cold-start gate | `useDynamicViewMaterializeChain` cold-start fast-path: when `matVer===0`, `setView` directly with `over_threshold/no_filter` instead of going through HTTP — fixes stuck "Loading..." on first dashboard load |
| Cascade gate | Cascade gate changed from magnitude-based to change-based (`if (currentMatVer === lastSeen) return`) — fixes dv staying at "materialized" after clearing filter |

### Test Coverage at Close

- Frontend vitest: **1016/1016** green across 47 spec files; tsc clean
- Phase 32 dynamic-view supertest: **86/86** green in both `AUTH_MODE=password` and `AUTH_MODE=oidc` (7 spec files)
- Server tsc: clean exit
- **Pre-existing server vitest tech-debt:** `AUTH_MODE=password` exit=1 (566 passed / 46 failed); `AUTH_MODE=oidc` exit=1 (507 passed / 105 failed) — failures are cross-mode contamination (oidc-specific specs failing under password mode + vice-versa + 1 `routes.info-query.spec.ts` timeout). Not a v1.6 regression — root cause is each mode's specs leaking into the OTHER mode's run.

### Known Gaps (Carried Forward as Tech-Debt)

- **VERIFY-V16-01** — verification gate stays `[ ]`. Per `/gsd:audit-milestone` decision, accepted as tech-debt and carried to v1.7. Root cause is server vitest cross-mode isolation, NOT a Phase 32 regression.

### Carry-over to v1.7

- **Server test isolation** (NEW) — `AUTH_MODE` cross-mode contamination causes ~150 spurious failures per run when executing the full suite under a single mode. Root cause of VERIFY-V16-01 fail. Fix path: per-spec `AUTH_MODE` gating or mode-aware `beforeEach` skip so each mode-run ignores the other mode's specs. Also closes the v1.3 carry-ins TD-V11-04 + TD-V13-01 if rolled into a single test-isolation pass.
- **`routes.info-query.spec.ts` timeout** (NEW) — 1 spec hangs past default vitest timeout; needs investigation under the test-isolation work item above.
- **TD-V14-WKB-SPIKE** (inherited from v1.4/v1.5) — true WKB-binary spatial mode end-to-end. Kinetica-GEOMETRY sub-case closed in v1.4; raw-binary WKB column path still deferred.
- **TD-V15-MAP-ONLY-TRIGGER** (inherited from v1.5) — map-only dashboard spatial-filter materialize gap.
- **Live UAT for v1.6 e2e.1–3** — explicitly DEFERRED per Phase 31 precedent. Operator exercised the build continuously during development; formal walk-through not run.

---

## v1.5 Spatial filtering on map (Shipped: 2026-05-14)

**Phases completed:** 7 phases (25-31), 16 plans, 104 commits
**Timeline:** 2026-05-11 → 2026-05-14 (4 days — heavy follow-up polish cycle after the core code landed in 3 days)
**Audit status:** Closed without formal `/gsd:audit-milestone` run — operator-directed pragmatic close (matches v1.2 / v1.3 / v1.4). Phase 31 verification status `passed` via source-only attestation 2026-05-14; live operator UAT explicitly skipped this cycle (caveat captured in `.planning/milestones/v1.5-phases/31-verification/31-VERIFICATION.md`).

### Delivered

Users now draw bbox / lasso / circle shapes directly on map widgets to filter the dashboard to that spatial region. Drawing on any map sends the shape to a dashboard-scoped Zustand store; every map in the dashboard renders the shape simultaneously as a Vector overlay; persistent measurement labels ("5km × 3km", "2.5 km", "12.4 km²") render at each shape's centroid (toggleable per-widget). The v1.3 materialize pipeline carries the spatial WHERE clause server-side via `STXY_WITHIN` (latlon) or `ST_INTERSECTS` (WKT) composed with any existing column filters; the resulting view name flows through `useFilterViewStore` and the `_mv` cache-buster, so WMS tiles re-render with spatially-filtered data and aggregated charts / records-tables FROM-swap automatically. FilterBar shows spatial chips inside each targeted table's row; chip × removes the shape and re-materializes; per-table Clear All globally nukes shapes that target the row. WKB-binary spatial mode remains deferred (TD-V14-WKB-SPIKE) — UI gates it client-side, server returns 501 as defense-in-depth.

### Key Accomplishments

- **Server-side spatial WHERE composition (Phase 26)** — Pure module `kinetica_bi/server/src/lib/spatialWhereClause.ts` with `buildSpatialOrBlock` (STXY_WITHIN / ST_INTERSECTS OR-chain wrapped in mandatory outer parens per V15-P-07) + `composeWhereClause` (4-case composer: col-only / spatial-only / both / neither). `POST /api/filter/materialize` extended to accept `{ spatialFilters?, spatialTarget? }` alongside v1.3 column filters; full v1.3 backward compat preserved. Race-recovery retry on Kinetica `TM/SMc:1078` "CREATE OR REPLACE" failure (commit `10e36a5`).
- **Frontend spatial-filter store + per-map targets (Phases 27–28)** — `useSpatialFilterStore` Zustand slice (`shapes`, `spatialFilterVersion`, `shapeCounter`) with 4 locked actions; auto-generated labels `{Type} {N}` via session-wide monotonic counter; reset wired as the 5th store in the canonical lifecycle order. `MapWidgetConfig.spatialTargets: SpatialTarget[]` with byte-parity to server contract + `MapConfigPanel` "Spatial filter targets" section. `isSpatialTargetEligible` is the SINGLE SOURCE OF TRUTH for the 3-gate WKB block (config / materialize / server).
- **Draw + shape (Phase 29)** — `MapDrawToolbar` React overlay with 5 mode buttons + Trash via Font Awesome. V15-P-01 mode-guard shipped as the FIRST line of MapChartRenderer Effect 6 (STATE.md FIRST-CODE-CHANGE lock honored). OL Draw via Effect 8 keyed on `drawMode`; live measurement tooltip during drag; drawend pipeline (degenerate-extent reject + lasso Douglas-Peucker simplify + WKT EPSG:4326 serialize + sphere measurement + sketch-feature dedup + previous-mode restore); ESC abort; click+Delete removal with selection-aware style ring. Trailing-singleclick suppression so the click that completes a draw doesn't pop the info popup.
- **Materialize trigger + FilterBar chips (Phase 30)** — `aggregateSpatialTargetsByTable(widgets)` pure helper resolves widget targets → `Map<tableId, SpatialTarget>` with widget-id-ascending tiebreaker; `DashboardContext` extended to expose `widgets[]` so any consumer can read targets without prop-drilling. `AggregatedWidgetRenderer` Effect 1 gains `spatialFilterVersion` as the 5th dep + combined-payload `materializeFilter` call; `RecordsTableRenderer` also fires materialize (lock-relaxation) so spatial works on dashboards without an aggregated chart on the spatial-target table. FilterBar spatial chips render inside each targeted table-row alongside column chips; chip text format `{label} ({measurement})` from ROADMAP verbatim.
- **UX polish (mid-cycle)** — Custom MapZoomToolbar replacing OL's default control; collapsible left sidebar with FA icons; per-widget `showShapeMeasurements` toggle; per-color alpha on POINTCOLORS / SHAPELINECOLORS / SHAPEFILLCOLORS (8-char AARRGGBB); FA-icon sweep across Toast, FilterBar dismiss, InfoPopup close, LayersModal, widget actions, classbreak builder, spatial-targets section; flushed dashboard header; bignumber widget no longer requires Group By; default info-popup click radius tightened 20px → 3px.

### Issues Resolved Mid-Cycle (No Formal Phase 31.x)

| Commit | Description |
|---|---|
| `d6bfe39` | WKT-mode column picker includes Kinetica geometry types (was excluding the actual `WKT` column on real Kinetica tables) |
| `079ef0e` | Spatial-target auto-suggest defaults geometry columns to WKT (not deferred WKB) |
| `8aa0dfb` | RecordsTableRenderer fires materialize so spatial filter works without an aggregated chart on the same table |
| `55e0042` | Trailing singleclick after drawend doesn't pop the info popup |
| `10e36a5` | Materialize retry on Kinetica `TM/SMc:1078` "CREATE OR REPLACE" race (DROP+CREATE fallback) |

### Test Coverage at Close

- Frontend vitest: **775/775** green; tsc clean
- Server impacted-spec vitest: **50/50** green (`routes.filter-materialize.spec.ts` + `routes.filter-materialize-spatial.spec.ts`); tsc clean
- Pre-existing tech debt: 104 server tests red (TD-V11-04 OIDC mock divergence ~60 + TD-V13-01 fetch-mock brittleness ~44) — neither is a v1.5 regression

### Carry-over to v1.6

- **TD-V14-WKB-SPIKE** — true WKB-binary spatial mode end-to-end (inherited from v1.4). Spike runner preserved; re-run path documented in `18-SPIKE-NOTES.md`.
- **Map-only-dashboard spatial trigger** — a dashboard with no aggregated chart AND no records table on a spatial-target table still wouldn't fire materialize when shapes change. Rare configuration; Map-side trigger deferred.
- **Live UAT for v1.5** — explicitly skipped this cycle. Open in case a production-only bug surfaces.
- **TD-V11-04** (OIDC mock divergence) and **TD-V13-01** (fetch-mock brittleness) — carried forward from v1.3; ~104 server tests red. Production OIDC + routes verified manually each cycle.

---

## v1.4 Map Info Popup (Shipped: 2026-05-11)

**Phases completed:** 7 phases, 23 plans, 122 commits
**Timeline:** 2026-05-07 → 2026-05-11 (5 days — heavy wave-parallel execution)
**Code delta:** +23,669 / −245 across 113 files
**Audit status:** Closed without formal `/gsd:audit-milestone` run — operator-directed pragmatic close (matches the v1.2/v1.3 pattern). Phase 24 verification closed with `overall_status: passed` via live operator attestation 2026-05-11. 19/20 requirements `Complete`; 1 `Deferred` (SPATIAL-V14-03 via TD-V14-WKB-SPIKE, inherited from Phase 18). Four UAT-discovered gaps in the Phase 24 cycle all closed with code fixes + regression specs + live re-walk attestation.

### Delivered

Map widgets are now actively interrogable. Users click any point on a map and a popup opens showing nearest records from each enabled layer — with layer switching, pagination, HTML template rendering, edge-aware positioning, dismiss, and per-layer + per-widget kill switches. A net-new "Info Card" chart type mirrors the popup as a widget on the dashboard, with full UX parity (in-widget layer dropdown switching, Load more) backed by a shared `<InfoSelectionView />` and a `useLastInfoClickContextStore` that replays the last spatial click context so the card can re-fetch without a `mapRef`. The selection lives in a session-scoped `useInfoSelectionStore` Zustand slice that resets on dashboard-switch and logout (mirrors `useFilterStore` lifecycle). Backend `POST /api/info/query` ships with two spatial modes (lat/lon, WKT) + server-side radiusPx→ground conversion. The third mode (WKB-binary) is deferred to v1.5; its Kinetica-GEOMETRY sub-case is closed in production via Session Fix #1 (`ST_DISTANCE(<col>, ST_GEOMFROMTEXT('POINT(x y)'))`).

### Key Accomplishments

- **Server-side spatial query primitive (Phase 18)** — Net-new `POST /api/info/query` endpoint with two production modes (lat/lon via `STXY_DISTANCE`, WKT via `ST_DISTANCE`+`ST_GEOMFROMTEXT`) + server-side `radiusPx→ground` conversion (Web-Mercator latitude scaling). Spike runner (`scripts/wkb-spike.ts`) preserved at commit `d458408` for future WKB-binary re-run. SPATIAL-V14-03 (WKB-binary) deferred to TD-V14-WKB-SPIKE (`NONE_ESCALATE → TECH_DEBT`) — no WKB-binary column reachable at spike time; Kinetica-GEOMETRY sub-case closed live via Session Fix #1.
- **Info-popup config schema (Phase 19)** — `dashboard_layers` table extended with `infoEnabled`, `infoTemplate`, `infoColumns`, `infoCustomTitle` fields; `WidgetDto.config` (map type) extended with `infoEnabled`, `infoClickRadiusPx`, `infoPopupWidthPx`, `infoPopupHeightPx`. Safe migration on existing dashboards (defaults applied, NULL-tolerant reads). Frontend types and Zod schemas updated in lockstep.
- **Info-selection store + lifecycle reset (Phase 20)** — `useInfoSelectionStore` Zustand slice with per-layer pagination state, active-layer pointer, in-flight `loading`/`error` per layer; dashboard-switch + logout reset wired in `DashboardsPage` + `AppLayout`; layer-switch automatically resets the destination layer's pagination cursor. Mirrors `useFilterStore` lifecycle exactly.
- **Map-click popup (Phase 21 — POPUP-V14-01..06)** — `MapChartRenderer` Effect 6 singleclick handler that fans out one `POST /api/info/query` per enabled layer, dedupes results into the store, and opens an OL `Overlay` anchored to the click point. Popup component supports layer dropdown switching, Prev/Next pagination, HTML template rendering (`info_template` field), key-value fallback when no template, edge-aware positioning (auto-flip near viewport edges), close-X, and per-layer kill switch (`infoEnabled: false` excludes the layer from the fan-out). Per-widget kill switch (`config.infoEnabled: false`) suppresses the click handler entirely. Configurable popup dimensions + click radius via the config UI.
- **Per-layer + per-widget config UI (Phase 22 — CONFIG-V14-01..04)** — `LayerConfigPanel` "Info Popup" tab (enable toggle, column picker, full-HTML template editor, custom title); `MapConfigPanel` "Info Popup" section (enable toggle, click radius px, popup width/height px). All fields persist via the existing 300ms-debounced auto-save path.
- **Info Card chart type (Phase 23 — CARD-V14-01..04)** — Net-new `info-card` chart type registration; `InfoCardRenderer` reads `useInfoSelectionStore` for the configured layer, renders via the shared `<InfoSelectionView />` (extracted from the popup in Phase 23-01), and uses `useLastInfoClickContextStore` (Phase 23-02) to replay the most-recent click's spatial coords for on-demand Load more / layer-switch fetches — since the card has no `mapRef`. Phase 23 also relaxed the pure-consumer lock: the click handler in `MapChartRenderer` remains the SOLE multi-layer fan-out entry, but popup + card single-layer dropdown-switch + Load-more fetches now go via the shared view (XWIDGET-V2-01 explicitly deferred — only Info Card consumes the store; other chart types still cannot fetch info-queries).
- **End-to-end verification + 4-gap closure cycle (Phase 24 — VERIFY-V14-01)** — Operator UAT walkthrough covering all 3 spatial modes (lat/lon, WKT, Kinetica-GEOMETRY/WKB-route), both auth modes (password + OIDC live), all 7 Phase 23 session fixes (bbox projection, viewName filter-view alignment, Kinetica-GEOMETRY SQL, single-record nav, popup resize, edge-aware positioning, close-X overlap), the Info Card, per-layer + per-widget kill switches, dashboard-switch + logout selection reset, and TD-V12-04 closure (viewName routing verified). Four gaps surfaced during UAT and were all closed with code fixes + regression specs + live operator re-walk attestation 2026-05-11: **GAP-24-01-A** (HIGH — `18387fa`, OL source listener unsubscribe before `removeLayer`), **GAP-24-01-B** (MEDIUM — `10721fb`, MapConfigPanel `useEffect+useRef` re-sync), **GAP-24-02-A** (HIGH — `7b21520`, `mountedRef` cleanup-gate guarding XHR + listener + Effect 6 async paths), **GAP-24-06-A** (HIGH — `543f624`, re-arm `mountedRef.current = true` at top of Effect 1 to survive React 18 StrictMode's mount-cleanup-mount cycle in dev).

### Known Gaps (carried to v1.5)

| ID | Severity | Item |
|----|----------|------|
| TD-V14-WKB-SPIKE | Low | **WKB-binary spatial mode not exercised end-to-end.** Inherited from Phase 18 close-out (2026-05-08). SPATIAL-V14-03 deferred `NONE_ESCALATE → TECH_DEBT` because no WKB-binary column was reachable at spike time. The Kinetica-GEOMETRY sub-case (server uses `ST_DISTANCE(<col>, ST_GEOMFROMTEXT('POINT(x y)'))` when `spatialMode='wkb'` and the column is WKT-typed Kinetica geometry) IS verified live (STEP 24-01/2.1, 2026-05-11). Spike runner preserved at commit `d458408` (production-payload-parity). Re-run path: when a true WKB-binary column becomes reachable, run `npm run wkb-spike` with corrected env vars and update `18-SPIKE-NOTES.md`, `spatialQuery.ts`, and the `info/query` endpoint to replace the 501 path with a real wkb-mode handler. |

### Test health at close

- **Frontend vitest:** 523/523 ✓ (across 34 test files; v1.3 close was 347/347 — v1.4 added ~176 new spec assertions including 16 GAP-cycle regression specs)
- **Frontend `tsc --noEmit`:** clean ✓
- **Backend supertest:** Untouched in v1.4 (no server-side regressions vs v1.3 baseline); pre-existing TD-V11-04 + TD-V13-01 carry over from v1.3.

### Cross-Phase Integration

Phase 18 → 19: `/api/info/query` payload shape (spatialMode + radiusPx + filters) informs which fields `dashboard_layers` and map widget config must persist. Phase 19 → 20: store types derive from the config schema (per-layer arrays keyed by `layerId`). Phase 20 → 21: popup component subscribes to the store via per-layer selectors; click handler writes via `setSelection` + `setLoading`; lifecycle effects in DashboardsPage call `reset` on dashboard-switch. Phase 21 → 22: config UI sets exactly the fields the popup reads at runtime (no shape drift); auto-save path is the existing 300ms debounce shared with Layers panel. Phase 22 → 23: Info Card reuses `<InfoSelectionView />` and `useLastInfoClickContextStore` from Phase 23-01/23-02; the pure-consumer lock relaxation is documented and the multi-layer fan-out boundary preserved. Phase 23 → 24: verification confirms the full chain end-to-end across all spatial × auth × kill-switch axes; 4 UAT gaps closed inline before milestone close.

### v1.4 Session Fixes (Phase 23 close-out, all verified Phase 24)

1. **bbox projection** — `mapBbox` now EPSG:4326 (was EPSG:3857); `EPSG:3857→4326` transform confirmed live.
2. **viewName filter-view alignment** — `POST /api/info/query` routes via `_kbi_filt_…` view when filter active; absent when cleared (TD-V12-04 closure evidence).
3. **Kinetica-GEOMETRY SQL** — `spatialMode='wkb'` with WKT-typed geometry column uses `ST_DISTANCE`+`ST_GEOMFROMTEXT` server-side.
4. **Single-record nav** — Prev/Next pagination resets on layer switch.
5. **Popup resize** — `infoPopupWidthPx`/`infoPopupHeightPx` config-driven (live-verified after GAP-24-01-B closure).
6. **Edge-aware positioning** — Popup auto-flips near viewport edges.
7. **Close-X overlap fix** — Close button no longer overlaps content header.

---

## v1.3 Unified Dashboard Filtering (Shipped: 2026-05-07)

**Phases completed:** 5 phases, 14 plans + 3 gap-closure cycles, 86 commits
**Timeline:** 2026-05-06 → 2026-05-07 (2 days)
**Code delta:** +19,627 / −614 across 81 files (~14.2k → ~16.0k LOC TypeScript)
**Audit status:** Closed without formal `/gsd:audit-milestone` run — operator-directed pragmatic close (`overall_status: tech_debt`). 33/34 requirements `[x]`; 1 partial (VERIFY-V13-01 reference SQL committed; fixture not exercised in UAT). Three known gaps deferred to v1.4 (see below).

### Delivered

Click-through data exploration now works end-to-end. Users drill into any chart element and the entire dashboard — all charts, records-tables, and map tiles — filters to that slice of data via a server-side transient Kinetica materialized view. The v1.2 broken WMS-QUERY approach and client-side WHERE-injection dead code are fully replaced. OIDC mode confirmed end-to-end by operator attestation (S2.b closed). Frontend vitest 347/347 green; `tsc --noEmit` clean; backend v1.3 supertest (routes.filter-materialize) 23/23 green.

### Key Accomplishments

- **Server-side materialize primitive (Phase 13)** — Net-new `POST + DELETE /api/filter/materialize` endpoint wired into `createApp()` under `/api/*` requireAuth. Pure utility modules `lib/viewNaming.ts` (view-name builder with OIDC sanitization: `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`) + `lib/whereClause.ts` (server-side SQL-safe WHERE builder). Stateless: no SQLite row for transient views — Kinetica 5-min sliding TTL is sole cleanup. 23/23 supertest covering both AUTH_MODE=password and AUTH_MODE=oidc sessions. Spike findings S1-S4 all resolved: WMS LAYERS=view PASS, DDL permission PASS, expired-view error verbatim, schema-qualification both forms work.
- **useFilterViewStore Zustand slice + client helpers (Phase 14)** — New `useFilterViewStore` (per-tableId `views` map: `viewName`/`expiresAt`/`materializing`/`materializeVersion`; reference-stable per-tableId updates; 5 actions: `setView`, `clearView`, `markMaterializing`, `clearMaterializing`, `bumpMaterializeVersion`, `reset`) + `materializeFilter` / `dropFilterView` client helpers in `client.ts`. Ships Phase 14 as dormant plumbing — no production callers until Phase 15.
- **FROM-swap chart filtering + dead-code deletion (Phase 15)** — `AggregatedWidgetRenderer` is the sole materialize trigger (300ms debounce, dedicated `materializeAbortRef`, `markMaterializing → materializeFilter → setView` sequence). New `fromSwap.ts` helper, new `FilteringBadge` component, new `kineticaErrors.isViewNotFoundError`. `RecordsTableRenderer` pure FROM-swap consumer (dep array widened to `[table, viewName]`). Dual-path TTL recovery: proactive (`expiresAt` check) + reactive (`isViewNotFoundError` max-1-retry). Atomic dead-code deletion of 4 functions (`injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter`). Logout + dashboard-switch effects extended with snapshot-loop-DROP-reset. 318/318 vitest green.
- **LAYERS-swap map filtering + `_mv` cache-buster (Phase 16) — closes TD-V12-01** — `wmsUrlBuilder.buildWmsParams` 2-arg signature: `LAYERS=<view_name>` when `viewName` present, `LAYERS=<schema.table>` otherwise; `QUERY`/`FILTER_PARAM` block fully deleted; `_v` cache-buster renamed `_mv` (sourced from `materializeVersion`). `MapChartRenderer` Effects 2+3 LAYERS-swap with `viewsKey` selector primitive, proactive `isViewExpired` fallback (60s skew). New `MapFilteringBadge` component. Pure-consumer lock holds (zero writer-method refs verified by spec module-source grep). v1.2 OL lifecycle locks preserved byte-for-byte. 332/332 vitest green.
- **End-to-end verification + 3 gap-closure cycles (Phase 17)** — Full UAT walkthrough: 4 user flows, 8 chart types, 4 edge cases, TTL recovery (proactive + reactive + max-1-retry cap), OIDC S2.b closed by operator live test. Three gap-closure plans (17-02/17-03/17-04) shipped before UAT: pre-materialize double-fire race, synchronous `markMaterializing` in `dispatchDrillDown`, `FilterBar` chip rendering for tables without a persisted views row. Screenshots committed. Final: 347/347 vitest green.

### Known Gaps (carried to v1.4)

| ID | Severity | Item |
|----|----------|------|
| TD-V12-04 | Low | **Visible filter narrowing fixture-based demo not exercised.** Operator used `demo.nyctaxi` for UAT (dense urban data makes tile narrowing subtle at city zoom — exactly the problem TD-V12-04 was created to solve). Filter behavior is functionally verified end-to-end; screenshots committed. Reference DDL at `kinetica_bi/server/scripts/test-fixtures/v13-filter-fixture.sql`. Resolve in v1.4: materialize fixture, walk flows 1-2, capture unambiguous before/after screenshots. |
| TD-V11-04 | Medium | **OIDC test mocks diverged from production `new Issuer(meta)` call** (commit 22def0a, 2026-05-04). 6 backend test files declare `const Issuer = { discover: vi.fn() }` (plain object, no constructor support); `oidc.ts:82` calls `new Issuer(meta)` causing `TypeError: Issuer is not a constructor` in ~60 tests. Affected: `auth.oidc.spec.ts`, `auth.routes.spec.ts`, `boot.hardening.spec.ts`, `boot.wipe.spec.ts`, `bootstrap.spec.ts`, `oidc.module.spec.ts`. Not a v1.3 regression — latent since commit 22def0a. Production OIDC works (manually verified by operator). Fix: update mock to support constructor + static-discover pattern. |
| TD-V13-01 | Medium | **Backend route test fetch-mock brittleness under Node 24 / vitest 4.** 6 backend test files fail with `TypeError: Cannot read properties of undefined (reading 'headers')` on `fetchMock.mock.calls[0]` destructuring. Kinetica `/version` boot probe in `createApp()` receives non-Response objects. Pre-existing — not caused by v1.3 work. Affected: `routes.materialize.spec.ts`, `routes.sql.spec.ts`, `routes.wms.spec.ts`, `routes.discovery.spec.ts`, `errorMiddleware.spec.ts`, `kinetica.creds.routes.spec.ts`. ~44 tests red. Production routes work. Fix: investigate Node 24 / vitest 4 / undici fetch compat; update `createApp()` boot probe mock strategy. |

**Test health at close:**

- Frontend vitest: 347/347 ✓
- Frontend `tsc --noEmit`: clean ✓
- Backend v1.3 supertest (routes.filter-materialize.spec.ts): 23/23 ✓
- Backend full suite: 312/417 (104 failures predate v1.3 — TD-V11-04 + TD-V13-01)

### Cross-Phase Integration

Phase 13 → 14: `POST /api/filter/materialize` JSON contract (`{ viewName, expiresAt }`) consumed by `materializeFilter()` client helper; `DELETE` contract (`{ dropped: true }`) consumed by `dropFilterView()`. Phase 14 → 15: `useFilterViewStore` consumed by `AggregatedWidgetRenderer` (sole materialize trigger); `RecordsTableRenderer` and `MapChartRenderer` are pure consumers of the resolved view name. Phase 15 → 16: `viewsKey` selector in `MapChartRenderer` subscribes to `materializeVersion` per included tableId; Effect 3 fires LAYERS-swap on both `filterVersion` tick and post-materialize `setView`. Phase 16 → 17: verification confirms the full chain end-to-end, closes TD-V12-01 and partially TD-V12-04 (functional confirmation; visual demo deferred).

---

## v1.2 Interactive Dashboards (Shipped: 2026-05-06)

**Phases completed:** 4 phases, 24 plans, 139 commits (25 `feat()`)
**Timeline:** 2026-05-04 → 2026-05-06 (3 days)
**Code delta:** +28,492 / −244 across 113 files (TypeScript / TSX, ~14.2k LOC in `kinetica_bi/{src,server/src}` at close)
**Audit status:** Closed without formal `/gsd:audit-milestone` run — operator-directed pragmatic close. 12/12 tracked requirements (FILT/DRILL/MAP) marked `[x]`; LAYER-01..13 (Phase 12) tracked in plan frontmatter only. Two known gaps deferred to v1.3 (see below).

### Delivered

Click-through data exploration over Kinetica-backed dashboards. Users now click any element on a bar/line/pie/scatter/table chart to add an equality filter that propagates to every chart (and every map widget) on the same Kinetica table — with visual confirmation, in-flight cancellation, and SQL-safe value escaping. A new `map` chart type renders Kinetica WMS tiles via OpenLayers with four render modes (raster / heatmap / classbreak / contour) and three spatial-column modes (lat-lon / WKT / Kinetica WKB), wired into the same filter pipeline. A dashboard-scope Layers panel lets users compose N stacked ImageWMS layers per map widget — with drag-reorder, opacity, classbreak builder, missing-table state, and per-layer auto-save — backed by a new SQLite `dashboard_layers` table.

### Key Accomplishments

- **Filter Foundation (Phase 9)** — `useFilterStore` Zustand slice with table-scoped selectors (PITFALL C-02 locked), primitive `filterVersion` dep (PITFALL S-02), 10-filter cap, last-click-wins replace; SQL-safe `buildEqualityFilter` + `escapeKineticaStringLiteral` + `IS NULL` rewrite; `runSql(query, signal?)` AbortSignal wiring; `injectWhereClause(baseSql, whereClause)` utility; `AggregatedWidgetRenderer` filter subscription with AbortController cancellation, AbortError silencing, and dashboard-switch / logout reset hooks.
- **Existing-Chart Drill-Down (Phase 10)** — Click handlers across 6 chart types (bar/line/pie/scatter/table/records) with `dispatchDrillDown` helper that pre-checks store for dedupe/replace before toast (first-add only); per-Cell `fillOpacity` dim-peers with 300ms transient on bar/pie/scatter (PITFALL C-03); `cursor: pointer` gating on `supportsDrillDown && drillDownColumn`; `widget-table-row-active` row-tint for table/records; interactive filter bar with dismissable badges + Clear All; column-type filter (geometry + large-text columns excluded from drill-down picker); `drillDownColumn` + `drillDownColumnType` persisted in widget config.
- **Map Chart (Phase 11)** — OpenLayers WMS map widget integrated as a new chart type. Backend `/api/wms` proxy with `Cache-Control: no-store` + `/api/wms/capabilities` route. Frontend: `useWmsCapabilitiesStore` boot wiring; `wmsUrlBuilder.buildWmsParams` covering 4 render modes × 3 spatial modes (raster / heatmap / classbreak / contour × lat-lon / WKT / WKB); `MapChartRenderer` with 3-effect OL lifecycle (Map create / source attach / filter invalidate), ImageWMS source on `EPSG:3857`, ResizeObserver, XHR+base64 imageLoadFunction, basemap swap, error overlay, and (later removed in P12) zoom-to-data; `MapConfigPanel` shell with auto-suggest spatial mode, mode-specific param groups, ClassbreakParamsGroup with cardinality-probe state machine + 256-cap; gap-closure plan 11-10 restored ChartConfigPanel CustomConfigPanel wrap (Title + Data Source) and persisted `tableRef`/`tableId`.
- **Dashboard Layers Panel (Phase 12)** — Hard cutover from single-WMS-per-widget (Phase 11) to N-stacked-ImageWMS-layers-per-widget (Phase 12). New `dashboard_layers` SQLite table + Express CRUD + `/reorder` endpoint with supertest coverage; `DashboardLayerDto` + 5 frontend client functions + `useDashboardLayersStore` Zustand slice; `LayersModal` two-pane component (left: list with drag-reorder, duplicate/delete-confirm, missing-table badge, opacity slider; right: extracted `KineticaWmsLayerForm`); `DashboardsPage` Layers button + 300ms-debounced auto-save; `MapChartRenderer` reworked for N stacked ImageWMS layers ordered by `position` with `widget.config.includedLayerIds` multi-select; `MapConfigPanel` shrunk to title + basemap + layer-inclusion picker; `.widget-map-reconfigure` overlay for Phase 11 widgets (no auto-migration); `.widget-map-empty` overlay for zero-included-layers state; `bboxHelper` + zoom-to-data button deleted as dead code.

### Known Gaps (carried to v1.3 backlog)

| ID | Severity | Item |
|----|----------|------|
| TD-V12-01 | Material (functional) | **GAP-12-C3 / FILT-04 partial — superseded.** WMS tile filter narrowing never validated end-to-end. Renderer fires `imageWmsSource.updateParams({ QUERY, _v })` correctly with cache-bust, but Kinetica returns identical tiles with/without the param. Phase 11 spike accepted `QUERY` without error but did not visually verify tile narrowing; Phase 12-06 verification confirmed the issue persists. Plan 12-07 was scoped to fix via param-name spike (`QUERY` vs `CQL_FILTER` vs `FILTER` vs `WHERE`); operator decision (2026-05-06) was to abandon WMS-QUERY-based filtering wholesale and rework filtering in v1.3. Spike scaffolding reverted in commit `8e60d2c`; GAP-12-C3 + 12-07-PLAN.md marked `superseded` in commit `87c0063`. |
| TD-V12-02 | Documentation | **LAYER-01..13 not surfaced in REQUIREMENTS.md.** Phase 12 was scoped via 13 `LAYER-*` requirement IDs in PLAN frontmatter (LAYER-01-backend-schema through LAYER-13-integration-verify), all delivered per phase 12 SUMMARYs, but were never added to the milestone's `REQUIREMENTS.md` traceability table — that file only tracks the 12 FILT/DRILL/MAP requirements scoped at milestone start. Functional impact: zero (everything shipped). Process impact: requirements traceability table is an undercount; future milestones should add new-phase requirements to REQUIREMENTS.md before phase planning. |
| TD-V12-03 | Informational | **Phase 11 → Phase 12 widget shape drift.** Phase 11 single-WMS map widgets (`spatialMode` set, no `includedLayerIds`) render the `.widget-map-reconfigure` overlay rather than auto-migrating. Existing dashboards with Phase-11-shape map widgets need manual reconfigure via the Layers panel. Decision was deliberate (hard cutover) per LAYER-12-old-config-cutover; tracked here for posterity. |
| TD-V12-04 | Informational | **Filter on high-density tables visually unverifiable.** Even with a working filter param, millions-of-rows tables (e.g., `demo.nyctaxi` at city scale) produce tiles indistinguishable from unfiltered at dashboard zoom levels. Future filter verification needs a dedicated low-cardinality / spatially-spread test fixture. Intersects with TD-V12-01. |

### Cross-Phase Integration (informal summary)

Phase 9 → 10: `useFilterStore.addFilter` consumed by all 6 drill-down chart click handlers. Phase 9 → 11: `MapChartRenderer` Effect 3 subscribes to `filterVersion` and calls `imageWmsSource.updateParams({ QUERY, _v })`. Phase 11 → 12: `MapChartRenderer`'s 3-effect lifecycle reused as N-layer stacked source pattern; `wmsUrlBuilder.buildWmsParams` reused per-layer with table-resolved `LAYERS` param; `KineticaWmsLayerForm` extracted from `MapConfigPanel` for shared use in `LayersModal` and (now-shrunk) `MapConfigPanel`. Pre-existing AbortController + dashboard-switch reset patterns from Phase 9 carried through to per-layer subscriptions in Phase 12.

---

## v1.1 OIDC SSO Support (Shipped: 2026-05-02)

**Phases completed:** 5 phases, 19 plans, 90 commits (21 `feat()`)
**Timeline:** 2026-04-30 → 2026-05-01 (2 days)
**Code delta:** +4,067 / −169 across 36 files (TypeScript)
**Audit status:** `passed` (21/21 requirements satisfied; 0 critical gaps; 4 informational tech-debt items — 2 surfaced during initial audit, 2 surfaced during 2026-05-04 operator dev deployment)

### Delivered

Kinetica BI now supports Generic OIDC Authorization Code flow as an alternative authentication path alongside the existing v1.0 Kinetica password mode. A single deployment runs in one mode or the other via `AUTH_MODE`; both modes converge on the same AES-256-GCM session store. The schema, helpers, frontend, and boot sequence all branch cleanly on a single `credentialType` discriminant — no per-route `process.env` reads, no stateless tokens in cookies, no IdP RP-initiated logout.

### Key Accomplishments

- **Schema + SessionStore foundation (Phase 4)** — Added `credential_type TEXT NOT NULL DEFAULT 'password'` + 3 `id_token_*` BLOB columns to `sessions` with PRAGMA-guarded ALTER migration; renamed `encryptPassword`→`encryptSecret`; switched `createSession` to options-object; extended `AuthedRequest` with flat `credentialType` + dual `creds.password`/`creds.token` (always-string); 215 tests passing
- **OIDC module + 3 routes (Phase 5)** — Built `src/oidc.ts` on `openid-client@^5.7.1` with `validateOidcEnv`, `initOidcClient`, `buildAuthorizationUrl`, `exchangeCode`, `extractUsername`, `mapOidcError`; mounted `GET /api/auth/oidc/start`, `GET /api/auth/oidc/callback`, `GET /api/auth/config`; `POST /api/auth/login` returns 400 in OIDC mode; converted `createApp` and `buildTestApp` to async with cascade across 7 spec files; locked critical PITFALLS (C-01..C-07, T-02..T-06, O-01); 285 tests passing
- **Per-call Bearer/Basic discriminant + observability (Phase 6)** — `buildAuthHeader(req)` branches on `credentialType === 'oidc'` (zero `if (creds.password)` discriminants — PITFALL I-01 locked); `auth_mode` field added to per-call audit log via explicit-key `JSON.stringify`; `tryDecodeAccessTokenExp` decode-only helper + proactive OIDC token-exp drop in `getSession` (30s clock skew, symmetric with Phase 5); `oidc_boot` JSON log + fire-and-forget `/version` reachability probe; `oidc_opaque_access_token` warn at callback (PITFALL T-05); 328 tests passing
- **Frontend AUTH_MODE awareness (Phase 7)** — Stood up Vitest+jsdom+RTL test infra with Zustand store-reset shim; `LoginPage` early-returns OIDC branch with `<a href={\`${API_BASE}/api/auth/oidc/start\`}>Sign in with SSO</a>`; `/api/auth/me` exposes `authMode`; `fetchAuthConfig` + sequential bootstrap (latest-write-wins); `App.tsx` UNAUTHORIZED handler writes `sessionStorage["kbi_returnTo"]` (OIDC-only) and restores via mount effect on `status === 'authenticated'` (single-use, page-enum guarded); 35 frontend RTL tests + 15 server tests passing
- **Boot wipe + structured fail-fast + DBA runbook (Phase 8)** — `wipeSessionsOnModeChange()` runs in `createApp()` between authMode validation and OIDC init; transactional `DELETE FROM sessions WHERE credential_type = ?` (PITFALL M-01 locked); JWT cookie `v` field NOT bumped (PITFALL I-05); bootstrap IIFE catch swapped to structured `boot_failed` JSON log with separate `message` + `stack` fields; appended Phase 8 Delta to `DEPLOY-RUNBOOK.md` covering Kinetica DBA-task trust config, AUTH_MODE-change behavior, secret rotation, and PITFALLS O-04/I-06 verbatim re-auth-loop diagnostic line; 337 tests passing

### Known Gaps (carried to v1.2+ backlog)

| ID | Severity | Item |
|----|----------|------|
| TD-V11-01 | Informational | Dev-mode OIDC e2e workflow gap: no Vite proxy + no `kinetica_bi/.env.example` with `VITE_API_URL`. **Partially addressed 2026-05-04:** `WEB_REDIRECT_BASE` env var added to `index.ts` so the 8 post-callback redirects in the OIDC handler can prefix an absolute origin (set to `http://localhost:5173` in dev `.env`, empty in prod). This unblocks the dev OIDC flow without restructuring the split-port setup. Still TODO: add Vite proxy entry for `/api → :4000` and a frontend `.env.example` so dev API calls don't need cross-origin CORS. |
| TD-V11-02 | Informational | Pre-existing Phase 6 TODO at `kinetica_bi/server/src/index.ts:152` — `KINETICA_HEALTHCHECK_PATH` could be env-configurable. Explicitly deferred to v2 in CONTEXT.md. No functional impact. |
| TD-V11-03 | Informational (security-flagged) | RFC 9207 iss-check workaround in `kinetica_bi/server/src/oidc.ts:75-82`: openid-client@5 enforces "auth response must include `iss` query param" when the IdP's discovery doc advertises support. Operator's IdP (custom `oidc-provider`-based app) advertises `authorization_response_iss_parameter_supported: true` but doesn't actually emit `iss` on the redirect. Workaround: rebuild the `Issuer` from a metadata clone with the flag flipped to false (suppresses the check entirely). **This disables an OAuth Mix-Up Attack mitigation — dev workaround only; revisit before any prod deployment.** Proper fix: either (a) update the IdP to emit `iss` on auth responses, or (b) update the IdP's discovery doc to drop the advertisement. Tracked discovery: 2026-05-04 operator dev session. |
| TD-V11-04 | Informational (out-of-repo) | IdP consent handler grant-reuse pattern (separate `kinetica-idp` codebase, not in this repo). Original handler created a fresh `provider.Grant({...})` on every consent click, losing previously-granted scopes. Caused infinite consent loop alternating between requested scopes (`openid` ↔ `profile`). Fix landed 2026-05-04: load existing grant via `details.grantId` if present, fall back to `new Grant()` only on first iteration; only attach `consent.grantId` to `interactionFinished` result for new grants. Recorded here for posterity since the bug surfaced during v1.1 OIDC operator deployment; the fix lives in the IdP repo. |

### Cross-Phase Integration (audit summary)

All 12 cross-phase boundaries WIRED with code evidence (P4 schema → P5 createSession → P6 buildAuthHeader → P7 frontend; P5 validateOidcEnv → P8 boot_failed catch; P4 credential_type col → P8 wipe; full E2E mid-session reauth flow with sessionStorage return-to-page). All 5 anti-pattern categories scan clean (AP-2, AP-5, I-01, I-05, emitAudit explicit-key). 9/9 E2E flows complete in production configuration.

---

## v1.0 Authentication & Per-User Access (Shipped: 2026-04-29)

**Phases completed:** 3 phases, 16 plans, ~50+ commits, 211 tests passing
**Timeline:** 2026-04-27 → 2026-04-29 (~3 days)
**Audit status:** `tech_debt` (19/19 requirements satisfied; 5 deferred items tracked)

### Delivered

The Kinetica BI server now enforces per-user Kinetica permissions on every downstream call. The shared admin Basic auth fallback is gone; mid-session auth failures route the user cleanly to a re-login screen; permission denials surface inline without logging anyone out.

### Key Accomplishments

- **Encrypted server-side session store (Phase 1)** — AES-256-GCM `sessions` table; opaque `sid` cookies (`{ sub, sid, v: 1 }`); 8h TTL with hourly GC sweep; 9-step `requireAuth` dispatch; 56 tests
- **Per-user Kinetica credential passthrough (Phase 2)** — split `kineticaSql(req, ...)` + `kineticaWms(req, ...)` helpers; typed errors (`KineticaAuthError`/`KineticaPermissionError`/`KineticaUpstreamError`); JSON audit log per call (OBS-01); spike-driven 400+access-denied → `KineticaPermissionError`; module-level admin consts deleted; +149 tests (205 total)
- **Global error middleware + frontend dispatch (Phase 3)** — Express 4-arg middleware mounted pre-404 maps typed errors to 401-REAUTH / 403 / 502; `apiFetch` body-peeks on `code: "REAUTH_REQUIRED"`; client-side error classes; `useApiQuery` hook + Toast + LoginPage banner; `useAuthStore.reason` discriminator
- **Admin credential removal complete (Phase 3)** — `KINETICA_USERNAME`/`KINETICA_PASSWORD` deleted from `index.ts` consts, `.env.example`, `README.md`, all test specs (replaced with `"admin-env-user"` sentinel); `requireConfig` narrowed to `KINETICA_URL` only; `git grep` audit returns zero matches outside `.planning/`
- **Bootstrap quality fix (Phase 3)** — `app.listen()` + `startSessionSweep()` gated behind `NODE_ENV !== "test"`; closes the latent EADDRINUSE noise that surfaced during Phase 2 verification; structural regression test prevents recurrence

### Known Gaps (carried into v1.1+ backlog)

| ID | Severity | Item |
|----|----------|------|
| TD-01 | Low (gate before prod) | 16 manual UAT checks deferred — see `phases/03-auth-failure-ux-admin-credential-removal/03-UAT.md` (UX-01, UX-02, ADMN-04 live verification). User explicitly approved Phase 3 trusting the mechanical wiring. Run before any production deploy. |
| TD-02 | **Medium** | `kinetica_bi/server/.env` was tracked in git history (real Kinetica admin credentials in past commits). Untracked going forward via `git rm --cached`. **Rotate `KINETICA_PASSWORD` before any public push of this repository.** |
| TD-03 | Low | Dev-experience: `sessionStore.ts:25` reads `SESSION_ENCRYPTION_KEY` at module-top before `dotenv.config()` runs in `index.ts:42`. Dev startup currently requires `set -a; source .env; set +a` before `npm run dev`. Move `dotenv.config()` to module top OR use Node's `--env-file=.env` flag. |
| TD-04 | Low | 22 of 28 frontend `client.ts` helpers not yet migrated to `useApiQuery` — those paths could still produce stuck spinners on edge-case errors. Migrate opportunistically as those call sites are touched. |
| TD-05 | Low | `ROADMAP.md` may show doc drift (e.g., Phase 2 row "5/6 In Progress" despite code complete) — cosmetic only, code state is authoritative. |

### Cross-Phase Integration (audit summary)

All 7 cross-phase seams verified clean (req.user.creds chain, typed-error → middleware, audit log → response, frontend dispatch, useApiQuery + Toast + LoginPage, requireConfig narrowing). 7/7 E2E flows have unbroken code paths (4 live-verified, 3 deferred to UAT).

---
