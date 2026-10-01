# Feature Research

**Domain:** BI dashboard filter panel / filter sidebar (v1.20 Filter Panel — Kinetica BI)
**Researched:** 2026-07-08
**Confidence:** HIGH (mature-BI patterns are well-documented and stable; combination-model dependencies verified directly against the v1.18 roadmap + DashboardsPage source)

## Scope note

This is a **presentation-layer** milestone. The v1.18 `filterCombinationStore` / combination model,
`resolveFilterSet` / `resolveSpatialShapes` pure functions, and the `AggregatedWidgetRenderer`
sole-materialize-trigger invariant are **UNCHANGED**. Every feature below either (a) renders the SAME
active-filter state a different way, or (b) reads/derives from existing stores. Anything that would
change filter *semantics*, add a *new materialize path*, or *author brand-new filters* is an
anti-feature for this milestone by constraint.

Active filter state today lives in THREE places, all already rendered by the top bar
(`DashboardsPage.tsx` lines ~945–1102):
- **`filterStore.filters[tableId]`** — column drill-down filters (equality + `between`/datetime), per table.
- **`filterStore.dvFilters[dvId]`** — dynamic-view-scoped drill filters, per dv.
- **`spatialFilterStore.shapes`** — global map-draw shapes (polygon/bbox/lasso), mapped to tables via `aggregateSpatialTargetsByTable`.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Every mature BI tool with a filter panel (Superset left native-filter bar, Power BI Filters pane,
Tableau filter cards, Metabase dashboard filters) ships these. Missing = the panel feels broken.
Items marked **(CONFIRMED)** are already locked into v1.20 scope.

| Feature | Why Expected | Complexity | Notes / combination-model dependency |
|---------|--------------|------------|--------------------------------------|
| Collapsible right-side panel **(CONFIRMED)** | Superset/Power BI/Tableau all offer a dockable, collapsible filter surface; frees vertical space vs. top bar | MEDIUM | Pure layout + a persisted per-dashboard mode flag. No store change. Panel READS the same 3 stores the top bar reads today. |
| Per-chip remove + Clear-all **(CONFIRMED — chip parity)** | Universal; "always allow remove-one and clear-all" is the #1 filter-chip UX rule | LOW | Reuse `filterStore.removeFilter/clearFilters`, `removeDvFilter/clearDvFilters`, `spatialFilterStore.removeShape`. Combination views DROP automatically via ref-count when filters clear — no new DROP call. |
| Global "clear ALL dashboard filters" **(CONFIRMED)** | Superset's dashboard-level Clear All resets *everything*; users expect one button, not per-table | LOW–MEDIUM | The current top-bar "Clear all" is **per-row** (per table / per dv). A true global must loop ALL three stores: clear every table in `filters` + every dv in `dvFilters` + `spatialFilterStore.clearAll()`. Orchestrator ref-counts down to 0 → DROPs all combo views. No server work. |
| Heterogeneous chip rendering (equality vs range/date vs spatial) | Users must recognize *what kind* of constraint each chip is; matching the visual to the data type reduces cognitive load | LOW | Already done in the top bar: `buildChipText` for column/between, `"${shape.label} (${shape.measurement})"` for spatial. **Extract into ONE shared chip component** so bar + panel render identically (see Differentiator #2). |
| Per-dashboard display-mode setting (top bar vs. right panel) **(CONFIRMED)** | Designer-chosen presentation is a Tableau/Power BI norm (layout is authored, not per-viewer) | MEDIUM | Needs a small dashboard-config persistence touch (per PROJECT.md, TBD at plan time). `DashboardDto` has no config blob today → likely one nullable column or a reused JSON field. This is the milestone's only likely server diff. |
| Empty state ("No active filters") | The top bar simply *hides* when empty; a persistent panel is always visible, so it MUST have a defined empty state | LOW | Top bar's "hide when empty" logic (the big `if (!hasAny…) return null`) becomes an empty-state render for the panel. Include a hint ("Click a chart to filter"). |
| Active-filter count when collapsed | A collapsed panel hides the chips; standard pattern is a count badge on the toggle ("Filters (3)") so state stays glanceable | LOW | Count = column filters + between + dv filters + spatial shapes. Reuse the same tallies the empty-state check already computes. Strongly recommended even though not explicitly confirmed. |
| Filter → widget mapping: list/count + canvas highlight **(CONFIRMED)** | Power BI marks which visuals a filter affects; Tableau's "Apply to Worksheets" shows scope. Users need to know *what a filter actually touches* | MEDIUM | The headline differentiator, but table-stakes-grade in mature tools. See dependency notes — this is where the v1.18 combination model does the heavy lifting. |

### Differentiators (Competitive Advantage)

These are the "additional good options" the operator asked us to surface. Each is cheap *because*
the v1.18 model already carries the data. Ranked; the top 5 are the strongest recommendations.

| Feature | Value Proposition | Complexity | Notes / dependency |
|---------|-------------------|------------|--------------------|
| **1. Filter-count badge on the collapsed toggle (both modes)** | Restores at-a-glance filter awareness when the panel is collapsed AND gives the top-bar mode a summary too; the single cheapest high-value add | LOW | Pure derived count from the 3 stores. Mirrors the mobile "Filters (3)" pattern. P1. |
| **2. Shared heterogeneous chip component (bar ⇄ panel)** | One chip renderer for equality/between/spatial/dv used by BOTH surfaces → zero drift, consistent theming | LOW–MED | Extract the top-bar chip JSX (lines ~993–1019, 1076–1088) into `FilterChip`. Guards against the exact drift class the codebase has hit before (badges reading a stale store). P1. |
| **3. In-panel grouping by source (table / dynamic view / spatial draws)** | Makes a many-filter panel scannable; matches Superset/Tableau "group time filters together, geo together" guidance | LOW–MED | The data is **already partitioned** this way (`filters` by tableId, `dvFilters` by dvId, `shapes` global). Render vertical sections with headers + per-group clear. Grouping by *column* or *source-widget* is possible but less aligned — see anti-feature note. P2. |
| **4. Click-a-filter → scroll-to + highlight the affected widget(s)** | Extends the confirmed hover-highlight; on a large/scrolled dashboard, hover isn't enough — click to jump | LOW | Build on the confirmed reverse-map + a widgetId→DOM ref map. RGL items are already keyed by widget id. P2. |
| **5. Filter provenance label ("from: <source widget>")** | Disambiguates two identical column chips that came from different drill sources; strengthens the "which widgets" story | LOW–MED | Filters already carry `sourceWidgetId` (used by `resolveFilterSet`). Resolve id→title from the `widgets` list. Spatial shapes carry a `label`. P2. |
| **6. In-panel filter search / type-to-filter the chip list** | Only pays off once a dashboard accumulates many filters; find a chip by column/value | MEDIUM | Client-side substring match over chip text. Defer unless dashboards routinely exceed ~10–15 chips. P3. |
| **7. Applied/ignored breakdown per filter (inverse of Phase 95 badge)** | Phase 95 shows per-widget "N of M filters"; the panel can show the inverse per-filter: "applies to 3 of 5 widgets" with a hover list | MEDIUM | Same reverse-map as #4/confirmed mapping; reuses `resolveFilterSet` + `resolveSpatialShapes`. Natural pairing with the confirmed mapping. P2–P3. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Author a brand-new filter from the panel** (pick column → operator → value) | Superset/Tableau let you add filters directly in the panel | Violates the "no new filter-semantics, no new materialize path" constraint; duplicates the existing **DataFilter widget** + bypasses the drill-down core value; needs a value-picker + validation the panel has no data for | Keep filter *creation* to drill-down / spatial draw / DataFilter widget. Panel manages EXISTING filters only. |
| **Edit filter values in place** (adjust a date range / change an equality value) | "I want to tweak, not remove-and-redo" | Same constraint break (it's authoring); date/equality filters are drill-created artifacts, not editable forms; would need per-type editors | Remove the chip and re-drill / redraw. Revisit post-v1.20 if demanded. |
| **Edit per-widget filter scope FROM the panel** ("apply to which widgets" editing) | The panel *shows* scope, so editing there feels natural | Scope authoring already lives in `ChartConfigPanel` + `KineticaWmsLayerForm` (Phase 93) as the single source of truth; a second editor forks it and risks divergence | Panel VISUALIZES scope (read-only reverse map). Hint/deep-link to the widget's config for editing. |
| **Saved filter sets / bookmarks / presets** | Power BI bookmarks, Superset saved filter state | Filters are **transient per-dashboard by explicit invariant** (v1.3 / v1.13); presets need a new persisted data model + lifecycle that fights the transient design | Out of scope. If ever wanted, it's its own milestone with a data model. |
| **Pending "Apply" button / batch-apply mode** | Some tools defer materialization until "Apply" | The app filters **live** via the per-combination orchestrator; a deferred-apply mode fights the live materialize loop and adds a staging state the stores don't have | Keep live-apply — it's a core-value behavior. |
| **AND/OR logic builder / multi-value editing per chip** | Power-user filtering | Changes filter *semantics* (composition is currently AND via `composeWhereClause`); explicitly forbidden this milestone | None — semantics are locked. |
| **Floating / draggable / pinnable panel positions** | "Let me put it anywhere" | Over-engineering; two authored modes (top bar / right panel) already cover the need; draggable panels add layout persistence + collision headaches | Top-bar vs right-panel per dashboard is sufficient. |
| **Auto-collapse the panel (or a group) after each selection** | Feels tidy | Explicit UX anti-pattern — users lose the ability to review/adjust; every filter-UX source warns against it | Keep panel/groups open; collapse only on explicit user action. |

## Feature Dependencies

```
Right-side panel (CONFIRMED)
    └──requires──> Shared FilterChip component (Diff #2)
                       └──reuses──> existing buildChipText + spatial label + between chip

Filter → widget mapping + canvas highlight (CONFIRMED)
    └──requires──> reverse-map helper  (invert resolveFilterSet / resolveSpatialShapes over widgets+layers)
                       └──reuses──> Phase 88 resolveFilterSet, Phase 93.5 resolveSpatialShapes
    └──enhances──> Click-to-scroll-to-widget (Diff #4)
    └──enhances──> Applied/ignored breakdown per filter (Diff #7, inverse of Phase 95 badge)

Per-dashboard display-mode setting (CONFIRMED)
    └──requires──> small dashboard-config persistence (likely 1 nullable column / JSON field)  [only likely server diff]

Global Clear-all (CONFIRMED)
    └──requires──> loop across filterStore (all tables) + dvFilters + spatialFilterStore
                       └──triggers──> orchestrator ref-count → DROP of all combination views (automatic)

Collapsed count badge (Diff #1) ──independent, LOW──> (pure derived tally)
In-panel grouping (Diff #3) ──uses existing partition──> filters / dvFilters / shapes
Filter provenance label (Diff #5) ──reads──> filter.sourceWidgetId + widgets list
In-panel search (Diff #6) ──filters──> shared chip list
```

### Dependency Notes

- **Filter → widget reverse mapping is the load-bearing derivation.** For each active filter, compute which visualizations "accept" it by running the SAME `resolveFilterSet(cfg, activeFilters)` (and `resolveSpatialShapes` for shapes) each viz already uses, then invert: filter → set of vizIds. Reuse the Phase 88 / 93.5 pure functions and mirror `useFilterScopeSummary` (Phase 95) — build a shared `useFilterWidgetMap` so the per-widget badge and the per-filter map stay consistent. **No server work.** Must cover all THREE source types (table-bound, dv-bound, spatial) across BOTH widgets AND table-bound map layers.
- **Canvas highlight must handle the map-widget-contains-layer case.** A single map widget card holds N layers; a filter may apply to one layer inside it. Highlight the *widget card* when any contained matching layer accepts the filter (reuse the `includedLayers` / layer-enumeration logic in DashboardsPage lines ~1137–1149 and the orchestrator's layer enumeration from Phase 92).
- **Global Clear-all differs from today's per-row Clear-all.** Today each `filter-bar-item` clears its own table/dv (and spatial per operator lock). The new global action is a superset: clear all tables + all dvs + all shapes in one click. Keep the per-group clears too (they map to grouping, Diff #3).
- **Display-mode persistence is the one server touch.** Everything else is frontend-only. Thread it like a normal dashboard field (NOT like a layer top-level field). Confirm whether `dashboards` needs a new column vs. an existing config blob at plan time.

## MVP Definition

### Launch With (v1.20 core — the confirmed scope, made complete)

- [ ] Right-side collapsible filter panel rendering all 3 filter types as chips — the milestone's reason to exist
- [ ] Per-chip remove + per-group clear (chip parity with the top bar)
- [ ] Global "clear ALL dashboard filters" (all tables + dvs + spatial)
- [ ] Per-dashboard display-mode setting (top bar vs right panel), designer-set, viewer-honored
- [ ] Filter → widget mapping (in-panel list/count) + hover-highlight on canvas
- [ ] Empty state + collapsed-toggle count badge (a persistent panel *needs* both)
- [ ] Shared `FilterChip` component used by BOTH the panel and the existing top bar (prevents drift)

### Add After Validation (same milestone if cheap — the strongest "extra options")

- [ ] In-panel grouping by source (table / dynamic view / spatial) with section headers + per-group clear — cheap, big scannability win
- [ ] Click-a-filter → scroll-to + flash the affected widget(s) — cheap extension of the confirmed hover-highlight
- [ ] Filter provenance label ("from <source widget>") using `sourceWidgetId`

### Future Consideration (v2+ / defer)

- [ ] In-panel filter search — only once dashboards routinely carry many chips
- [ ] Applied/ignored breakdown per filter (inverse Phase 95 badge) — nice, but the confirmed mapping + hover-highlight may suffice
- [ ] (Explicitly NOT: saved filter sets, in-panel filter authoring/editing, pending-apply mode — see anti-features)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Right-side collapsible panel (chips, all 3 types) | HIGH | MEDIUM | P1 |
| Per-chip remove + per-group clear | HIGH | LOW | P1 |
| Global clear-all | HIGH | LOW–MED | P1 |
| Per-dashboard display-mode setting | HIGH | MEDIUM (only server touch) | P1 |
| Filter → widget map + hover-highlight | HIGH | MEDIUM | P1 |
| Empty state + collapsed count badge | MEDIUM | LOW | P1 |
| Shared FilterChip component | MEDIUM (drift insurance) | LOW–MED | P1 |
| In-panel grouping by source | MEDIUM | LOW–MED | P2 |
| Click-to-scroll-to-widget | MEDIUM | LOW | P2 |
| Filter provenance label | MEDIUM | LOW–MED | P2 |
| In-panel search | LOW–MED (scales with chip count) | MEDIUM | P3 |
| Applied/ignored breakdown per filter | MEDIUM | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | Superset | Power BI / Tableau | Our Approach (Kinetica BI) |
|---------|----------|--------------------|-----------------------------|
| Panel location | Collapsible LEFT native-filter bar | Power BI right Filters pane; Tableau floating filter cards | Collapsible RIGHT panel, designer-chosen per dashboard (top bar is the other mode) |
| Which visuals a filter affects | Filter scoping ("apply to specific charts") | Power BI marks affected visuals; Tableau "Apply to Worksheets" | Reverse-map from the v1.18 combination model + hover/click canvas highlight (already have the data) |
| Clear all | Dashboard-level Clear All resets everything | Per-visual / per-page + reset | Global clear across tables + dvs + spatial; keep per-group clears too |
| Grouping / scannability | Filters listed; search within multiselect | Group filters into logical sections; search box | Group by source (table/dv/spatial) — data already partitioned; search deferred to P3 |
| Heterogeneous types | Value / range / time / numeric filter types | Basic/advanced/relative-date/top-N cards | equality / between-date / spatial chips via one shared FilterChip renderer |
| Filter authoring | Add/edit filters in panel | Drag fields into pane | **Deliberately NOT** — drill-down / spatial draw / DataFilter widget only (core-value + constraint) |
| Saved states | Backend-stored filter combinations | Bookmarks | **Deliberately NOT** — filters are transient per dashboard by invariant |

## Sources

- [Apply Filters to Multiple Worksheets — Tableau](https://help.tableau.com/current/pro/desktop/en-us/filtering_global.htm)
- [Filter Pane in Power BI — GeeksforGeeks](https://www.geeksforgeeks.org/power-bi/filter-pane-in-power-bi/)
- [Format filters in Power BI reports — Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-report-filter)
- [How to Arrange Filters in Tableau Dashboard — TheBricks](https://www.thebricks.com/resources/guide-how-to-arrange-filters-in-tableau-dashboard)
- [Managing Filters — Preset (Superset) docs](https://docs.preset.io/docs/managing-filters)
- [Dashboard filters — Metabase Documentation](https://www.metabase.com/docs/latest/dashboards/filters)
- [Ability to set the native filter bar position — apache/superset #26624](https://github.com/apache/superset/issues/26624)
- [Filter UX Design Patterns & Best Practices — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering)
- [Getting filters right: UX/UI patterns — LogRocket](https://blog.logrocket.com/ux-design/filtering-ux-ui-design-patterns-best-practices/)
- [Guide to Dashboard Filter Design — Aufait UX](https://www.aufaitux.com/blog/dashboard-filter-design-guide/)
- [Badges vs Pills vs Chips vs Tags — Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/badges-chips-tags-pills/)
- Codebase: `packages/web/src/components/DashboardsPage.tsx` (top-bar chip/clear logic), `.planning/milestones/v1.18-ROADMAP.md` (combination model, `resolveFilterSet`/`resolveSpatialShapes`, Phase 95 badge), `.planning/PROJECT.md` (v1.20 goals + constraints)

---
*Feature research for: BI dashboard filter panel (v1.20 Kinetica BI)*
*Researched: 2026-07-08*
