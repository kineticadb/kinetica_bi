# Project Research Summary

**Project:** Kinetica BI — v1.20 Filter Panel
**Domain:** BI dashboard filter panel / filter sidebar (presentation layer over an existing React + Vite + zustand app on an Express/SQLite server)
**Researched:** 2026-07-08
**Confidence:** HIGH

## Executive Summary

v1.20 is a **presentation-layer milestone**: a per-dashboard, collapsible right-side filter panel that renders and manages the SAME active-filter state the existing top bar already renders, plus a global clear-all and a filter→widget "applies to" map with on-canvas highlight. Mature BI tools (Superset native-filter bar, Power BI Filters pane, Tableau filter cards) all ship a dockable filter surface with per-chip remove, clear-all, heterogeneous chip types, and visibility into which visuals a filter affects — so the confirmed scope is squarely table-stakes-grade, and the domain patterns are well-documented and stable. All four researchers independently converged on the same load-bearing conclusion: this milestone adds NO new filter semantics, NO new materialize path, and (per Stack) **zero new npm packages** — every capability already exists in the codebase's conventions.

The recommended approach reuses what is already proven: the left `.sidebar` collapse pattern for the drawer; react-grid-layout's existing `useContainerWidth()` ResizeObserver for automatic grid reflow (which works ONLY if the panel is an in-flow flex sibling that shrinks the grid container, NOT a `position:fixed` overlay); a new session-only zustand highlight store driven by a CSS class toggle; and the existing `resolveFilterSet`/`resolveSpatialShapes` resolvers — inverted — for the filter→widget map. The single server touch is a small BOTH-stack change: the `dashboards` table has no config column today, so add a dashboard-level display-mode field defaulting to `'topbar'` (mirroring the v1.18 `filter_scope` migration) so absent → byte-identical top-bar behavior.

The key risks are all "silent drift" and "silent breakage" classes this codebase has hit before. The panel MUST read/mutate the **same input stores the top bar uses** (`useFilterStore.filters`/`.dvFilters` + `useSpatialFilterStore.shapes`) — treating the DERIVED `filterCombinationStore` as the filter list is the exact permanent-staleness bug `FilteringBadge` already suffered. The reverse-map MUST enumerate BOTH read paths (chart widgets `w:<id>` via WidgetRenderer AND map layers `l:<id>` via MapChartRenderer, translated back to owning map widgets) and all filter kinds (eq/in/between/datetime/spatial), honoring `dvFilterScopeDisabled`. Global clear-all MUST mutate input stores only and let the orchestrator ref-count DROP views (never call materialize/drop from the panel; never `filterStore.reset()` live). And because invented CSS classes and `rgba()`/wrong tokens pass all gates but render broken, the panel needs class-exists discipline + a manual light/dark UAT walk.

## Key Findings

### Recommended Stack

**Add ZERO new npm packages.** (See `STACK.md`.) Every capability the panel needs is already present in the installed stack and the app's established conventions — the only genuine *stack* decision is persistence (a small on-pattern server column). Adding any drawer/panel/highlight library would violate the no-design-system policy, duplicate the working sidebar pattern, and introduce theme drift.

**Core technologies (all EXISTING — reused, not added):**
- **react-grid-layout 2.2.2** (`useContainerWidth()` ResizeObserver): free automatic grid reflow — *iff* the panel is an in-flow layout sibling that shrinks the grid container's measured box (verified in installed dist source).
- **zustand 4.5.2**: a new session-only `filterHighlightStore` (Set of highlighted vizKeys) for transient highlight state, following the `infoSelectionStore`/`spatialFilterStore` pattern — MUST join the ~11-store `reset()` cleanup chain (DashboardsPage unmount + App.tsx logout).
- **CSS custom-property tokens + `global.css` utility classes**: reuse the `.sidebar` collapse (width transition) and the `filter-bar-chip*` classes for chip parity — no design system by policy.
- **better-sqlite3 (server)**: persist the per-dashboard display-mode via a PRAGMA-guarded `ALTER TABLE ADD COLUMN` (the established `db.ts` migration mechanism).

### Expected Features

(See `FEATURES.md`.) This is a presentation-layer milestone — every feature either renders the same active-filter state a different way or derives from existing stores.

**Must have (table stakes — the confirmed scope, made complete):**
- Right-side collapsible panel rendering all 3 filter types (column/between+datetime, dv, spatial) as chips
- Per-chip remove + per-group clear (chip parity with the top bar)
- Global "clear ALL dashboard filters" (all tables + all dvs + all spatial)
- Per-dashboard display-mode setting (top bar vs right panel), designer-set, viewer-honored
- Filter → widget mapping (in-panel list/count) + hover-highlight on canvas
- Empty state ("No active filters") + collapsed-toggle count badge (a persistent panel needs both)
- Shared `FilterChip` component used by BOTH the panel and the top bar (drift insurance)

**Should have (competitive, cheap because the v1.18 model already carries the data — ranked):**
1. Collapsed-toggle count badge (both modes) — the single cheapest high-value add
2. Shared `FilterChip` component (bar ⇄ panel) — zero-drift insurance
3. In-panel grouping by source (table / dv / spatial) — data is already partitioned this way
4. Click-a-filter → scroll-to + flash the affected widget(s) — cheap extension of hover-highlight
5. Filter provenance label ("from <source widget>") — reads existing `sourceWidgetId`

**Defer (v2+):**
- In-panel filter search (only once dashboards routinely carry many chips)
- Applied/ignored breakdown per filter (inverse of the Phase 95 badge)

**Explicitly EXCLUDE (anti-features — out of scope by constraint):**
- In-panel filter authoring / value-editing (authoring stays in drill-down / spatial draw / DataFilter widget)
- Per-widget scope EDITING from the panel (scope authoring stays in Phase 93 config; panel is read-only visualize)
- Saved filter sets / bookmarks / presets (filters are transient per-dashboard by invariant)
- Pending "Apply" batch mode (the app filters live)
- AND/OR logic builders / multi-value editing (changes filter semantics — forbidden)
- Draggable/floating panels; resizable-drag width (two authored modes suffice)

### Architecture Approach

(See `ARCHITECTURE.md`.) `DashboardOpen` in `DashboardsPage.tsx` switches the filter surface **top-bar XOR side-panel** by the resolved display mode; the new `FilterPanel` is an in-flow flex sibling of the `containerRef` grid wrapper so the ResizeObserver auto-reflows. A pure `resolveWidgetsForFilter.ts` lib inverts the existing resolvers to produce the "applies to" set; a session-only `filterHighlightStore` drives per-card highlight via scoped boolean selectors. Global clear-all mutates input stores only; the untouched `useCombinationOrchestrator` remains the sole materialize/DROP trigger.

**Source-of-truth reconciliation (all four agents converged — make this unambiguous):**
- **ACTIVE FILTERS = `useFilterStore` (`.filters` per tableId + `.dvFilters` per dvId) + `useSpatialFilterStore` (`.shapes`).** Plus `views[].filter_clause` as read-only static WHERE text.
- **`filterCombinationStore` is a DERIVED read-path registry** (view-names keyed by content hash), written ONLY by the orchestrator. The panel must read/mutate the SAME input stores the top bar uses — reading the combination store for the chip list is the exact drift bug `FilteringBadge` already hit. (Combination store is fair game only for the primitive-selector "Filtering…" spinner state.)

**Major components:**
1. `FilterPanel` (NEW) — right drawer: chips grouped by table/dv/spatial, per-filter applies-to list/count, per-chip remove, per-group + global clear, collapse toggle.
2. `resolveWidgetsForFilter.ts` (NEW pure lib) — the INVERSE of `resolveFilterSet`/`resolveSpatialShapes`/`useFilterScopeSummary`; enumerates BOTH read paths (`w:<id>` + `l:<id>`→owning map widget) and all filter kinds, honoring `dvFilterScopeDisabled`. Shared so per-widget badge + per-filter map can't drift.
3. `filterHighlightStore` (NEW session store) + `WidgetCard` (NEW extraction) — Set of highlighted vizKeys; each card subscribes with a scoped boolean selector and toggles a `var(--accent)` outline class. Must join both reset() chains.
4. `dashboards.filter_display_mode` (NEW server column) + `DashboardDto`/`updateDashboard` + designer toggle UI — the milestone's only server touch; default `'topbar'`.

### Critical Pitfalls

(Top 5 from `PITFALLS.md`.)

1. **Dual source-of-truth drift** — Panel reads/writes filters differently than the top bar (or renders chips from the derived combination store). *Avoid:* extract ONE shared chip-assembly builder over `filterStore`/`spatialFilterStore`; every mutation calls the existing actions; use `buildChipText`, never `String(value)`.
2. **Reverse-map misses a read path or filter kind** — Only walks chart widgets, so map WMS layers (`l:<id>`, scope on top-level `layer.filterScope`), dv-bound widgets, spatial draws, or datetime `between` filters are dropped. *Avoid:* reuse `resolveFilterSet`/`resolveSpatialShapes`, enumerate BOTH paths + all kinds, mirror `useFilterScopeSummary` for the `dvFilterScopeDisabled` accept-all override.
3. **Global clear-all orphans views or breaks the sole-trigger invariant** — Panel calls `dropCombinationView`/`materializeFilter` directly, or mutates state that doesn't tick `filterVersion` (orphaned Kinetica views). *Avoid:* loop `clearFilters`/`clearDvFilters` + `spatialFilterStore.clearAll()` only; let the orchestrator ref-count DROP. Never `filterStore.reset()` live. Grep-gate: panel imports no `materialize*`/`drop*View`/`clearEntry`.
4. **Highlight re-render storm / leak** — Whole-object store subscription re-renders every widget (map flicker) on each hover; highlight never clears. *Avoid:* CSS-class toggle or scoped boolean selector (S-02); deterministic cleanup on leave/collapse/unmount + `reset()` in BOTH cleanup chains.
5. **Silent CSS breakage** — Invented/misspelled classes and `rgba()`/wrong tokens pass tsc + vitest + theme-guard but render unstyled or light-mode-broken. *Avoid:* add every new class to `global.css` before use (grep-confirm), reuse `filter-bar-chip*`, use `var(--*)`/`color-mix` (not `rgba`), and verify visually in light + dark UAT — green tests are not evidence of styling.

Also flagged: backward-compat (absent mode → top-bar byte-identical; never render both surfaces), and narrow-viewport squeeze (overlay/auto-collapse on small widths).

## Implications for Roadmap

Based on combined research, the suggested phase spine (continuing from Phase 105; Phase 104 was consumed by v1.19 map-viewport-sync). Dependency logic: the reverse-map lib underpins panel content + highlight; persistence gates the mode switch; global clear-all is sequenced last so live combos exist to tear down during UAT.

### Phase 105: Reverse-mapping lib + tests
**Rationale:** Foundation for both panel "applies to" content and highlight targets; pure and testable without React/stores; keeps semantics in lockstep with the orchestrator.
**Delivers:** `resolveWidgetsForFilter.ts` reusing `resolveFilterSet`/`resolveSpatialShapes`.
**Addresses:** Filter → widget mapping (confirmed feature).
**Avoids:** Pitfall 2 — unit-test 3 filter kinds (eq/in/between+datetime, spatial, dv) × both read paths (`w:<id>` chart + `l:<id>` map layer→owning widget) × `dvFilterScopeDisabled`.

### Phase 106: Display-mode persistence (BOTH-stack)
**Rationale:** Isolate the milestone's only server touch early; unblocks the mode switch.
**Delivers:** `dashboards.filter_display_mode` column (CREATE + PRAGMA-guarded ALTER) + `mapDashboard`/`updateDashboard`/`DashboardDto`/client attrs; default `'topbar'`.
**Uses:** better-sqlite3 JSON/scalar column pattern (Stack); mirrors the v1.18 `filter_scope` migration.
**Avoids:** Pitfall 8 — absent value → byte-identical top-bar behavior.

### Phase 107: Panel shell + reflow + XOR mode switch
**Rationale:** Stand up the drawer once persistence gates the mode; layout/reflow is the core risk here.
**Delivers:** flex-row layout, collapsible right drawer (sidebar pattern), top-bar XOR panel switch, active-filter chips (shared builder + `buildChipText` + existing chip classes) with per-chip remove + per-group clear, empty state, collapsed count badge, shared `FilterChip`.
**Uses:** `useContainerWidth` ResizeObserver (in-flow flex sibling, NOT overlay).
**Avoids:** Pitfalls 1, 3, 6, 7, 8, 9, 10 — shared chip builder, auto-reflow, class-exists discipline, token discipline, XOR, narrow-viewport handling, "Filtering…"/spatial/static-WHERE/empty states.

### Phase 108: Applies-to + on-canvas highlight
**Rationale:** Consumes the Phase 105 lib in the UI; highlight is the second-highest risk area.
**Delivers:** `filterHighlightStore`, `WidgetCard` extraction, per-filter "applies to N widgets" list/count, hover/click highlight; `reset()` registered in both cleanup chains.
**Implements:** highlight store + scoped-selector card subscription.
**Avoids:** Pitfall 5 — CSS-first / scoped boolean selector; deterministic cleanup + leak spec.

### Phase 109: Global clear-all
**Rationale:** Sequenced last so live combos exist to tear down during UAT; must prove the invariant.
**Delivers:** input-loop teardown (`clearFilters`/`clearDvFilters`/`clearAll`); the orchestrator DROPs by ref-count.
**Avoids:** Pitfall 4 — grep-gate that the clear-all handler imports no `materializeFilter`/`dropCombinationView`; network-tab verify all `_c{hash}` views DROP; never touch static WHERE.

### Phase 110: Designer settings UI + verification
**Rationale:** Expose the mode toggle to designers and run the full live UAT walk.
**Delivers:** designer mode toggle (gated `dashboards:edit`, no new RBAC permission), theme-token pass, light+dark + narrow-viewport UAT.
**Avoids:** Pitfalls 6 & 7 — visual verification is the only thing that catches silent CSS/contrast bugs.

### Phase Ordering Rationale
- **Lib → persistence → shell → highlight → clear-all → settings/verify** follows the dependency graph: pure lib underpins content (107) and highlight (108); persistence (106) gates the mode switch (107); clear-all (109) needs live combos and must respect the sole-trigger invariant proven by leaving the orchestrator untouched.
- Grouping matches the architecture's component boundaries (each phase = one new file/store plus its wiring), keeping the surface small per phase.
- Sequencing clear-all last lets UAT tear down real materialized views; sequencing persistence early isolates the only server diff for a clean BOTH-stack review.

### Research Flags

Phases likely needing deeper `/gsd:research-phase` attention during planning:
- **Phase 105 (reverse-mapping lib):** HIGHEST RISK. The inverse must exactly mirror `resolveFilterSet`/`resolveSpatialShapes`/`useFilterScopeSummary` across both read paths, all filter kinds, layer→map-widget translation, and the `dvFilterScopeDisabled` override. Get the enumeration exhaustive at plan time.
- **Phase 108 (highlight):** HIGH RISK. Re-render-storm avoidance (scoped selector vs CSS-only), the `WidgetCard` extraction, and deterministic cleanup across both reset chains need careful plan-phase design.

Phases with standard/established patterns (lighter research):
- **Phase 106 (persistence):** well-trodden — directly mirrors the v1.18 `filter_scope` PRAGMA-guarded ALTER migration.
- **Phase 107 (panel shell/reflow):** reuses the proven `.sidebar` collapse + `useContainerWidth` reflow; risk is CSS/UAT discipline, not novel patterns.
- **Phase 109 (clear-all):** a straightforward input-loop over existing actions.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified by direct inspection of installed source (`react-grid-layout` dist), `db.ts`, `client.ts`, `global.css`, `CLAUDE.md` + npm registry. Zero-new-deps conclusion is firm. |
| Features | HIGH | Mature-BI filter-panel patterns are well-documented and stable; combination-model dependencies verified against the v1.18 roadmap + `DashboardsPage` source. |
| Architecture | HIGH | All findings read directly from the current codebase; RGL reflow behavior verified against installed 2.2.2; source-of-truth + reverse-map approach cross-confirmed by all four agents. |
| Pitfalls | HIGH | Each pitfall traced to live code + operator MEMORY (filtering-badges-read-combination-store, map-wms-is-separate-read-path, css-bugs-evade-tests, theme-guard-misses-rgba, track-config-toplevel-field). |

**Overall confidence:** HIGH

### Gaps to Address
- **Exact persistence shape (scalar vs JSON `config` blob):** Stack recommends a JSON `config TEXT DEFAULT '{}'` column for future-proofing; Architecture recommends a single `filter_display_mode TEXT DEFAULT 'topbar'` scalar for minimal surface. Both mirror the v1.18 migration and both default to top-bar. **Decide at Phase 106 plan time** — pick scalar for absolute-minimum surface, or JSON blob if more per-dashboard settings are anticipated soon.
- **CSS-only-bug verification:** Invented classes and `rgba()`/wrong tokens ship green through every automated gate. There is no build check that a `className` resolves to real CSS. **Mitigate** with a class-exists-in-`global.css` string spec + a mandatory manual light+dark (and narrow-viewport) UAT walk in Phase 110 — do not treat green tests as styling evidence.
- **Records-renderer self-materialize edge (minor):** Confirm at plan time (Phase 109) that `RecordsTableRenderer` no longer runs a legacy spatial materialize (Phase 96-01 states records is now a pure combo-store consumer); if any renderer still self-materializes on spatial, clear-all's spatial branch must account for it.

## Sources

### Primary (HIGH confidence)
- Codebase read directly (2026-07-08): `DashboardsPage.tsx`, `WidgetRenderer.tsx`, `MapChartRenderer.tsx`, `filterStore.ts`, `spatialFilterStore.ts`, `filterCombinationStore.ts`, `useCombinationOrchestrator.ts`, `resolveFilterSet.ts`, `resolveSpatialShapes.ts`, `useFilterScopeSummary.ts`, `WidgetFilterBadge.tsx`, `FilteringBadge.tsx`, `spatialTargets.ts`, `global.css`, `server/src/db.ts`, `server/src/index.ts`, `api/client.ts`.
- Installed `react-grid-layout@2.2.2` `dist/chunk-QGXQSZII.js` (`useContainerWidth` → `ResizeObserver`).
- `CLAUDE.md` (no design system; theme-token policy; test gates); `.planning/PROJECT.md` (v1.20 goal + constraints); `.planning/milestones/v1.18-ROADMAP.md` (combination model, both read paths, sole-materialize-trigger).
- Operator MEMORY: filtering-badges-read-combination-store; map-wms-is-separate-read-path; css-bugs-evade-tests-and-theme-guard; theme-guard-misses-rgba-and-wrong-tokens; track-config-toplevel-field; parallel-executors-roadmap-collision.
- npm registry `react-grid-layout` (latest 2.2.3, 2026-03-24).

### Secondary (MEDIUM confidence)
- Domain patterns: Tableau (Apply to Worksheets), Power BI (Filters pane / affected-visual marking), Superset (native-filter bar position + dashboard Clear All), Metabase dashboard filters; filter UX best-practice articles (Pencil & Paper, LogRocket, Aufait UX, Smart Interface Design Patterns).

---
*Research completed: 2026-07-08*
*Ready for roadmap: yes*
