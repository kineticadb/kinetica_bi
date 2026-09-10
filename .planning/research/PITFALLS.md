# Pitfalls Research

**Domain:** Dashboard Filter Panel (v1.20) — a per-dashboard, collapsible right-side surface that renders/manages the SAME active-filter state as the existing top bar, with global clear-all + filter→widget mapping/highlight, layered on the v1.18 combination-materialize pipeline.
**Researched:** 2026-07-08
**Confidence:** HIGH — findings verified against the live codebase: `filterStore.ts` (source of truth), `spatialFilterStore.ts`, `filterCombinationStore.ts` (derived registry + S-02 lock), `DashboardsPage.tsx` (existing top-bar render + `ResponsiveGridLayout` + `useContainerWidth` + 11-store cleanup chain), `FilteringBadge.tsx` (the prior stale-store bug), `useFilterScopeSummary.ts` / `resolveFilterSet.ts` / `resolveSpatialShapes.ts` (the reverse-map engine to reuse), `MapChartRenderer.tsx` (2nd read path), and MEMORY (filtering-badges-read-combination-store, map-wms-is-separate-read-path, css-bugs-evade-tests, theme-guard-misses-rgba).

> **Phase numbering note:** v1.20 continues from Phase 105 (Phase 104 was consumed by v1.19 map-viewport-sync). Pitfalls below are mapped to *descriptive* v1.20 phases (Persistence, Panel-Render, Reverse-Map, Highlight, Clear-All, Verification) — bind them to concrete numbers when the roadmap is drawn.

---

## The one-paragraph mental model (read this first)

The **source of truth for active filters is `useFilterStore`** (`filters` keyed by `tableId`, `dvFilters` keyed by `dvId`, both driven by the single `filterVersion` counter) **plus `useSpatialFilterStore`** (`shapes` + `spatialFilterVersion`). The existing top bar in `DashboardsPage.tsx` (lines ~967–1100) reads those stores directly and mutates them through `removeFilter` / `removeDvFilter` / `clearFilters` / `clearDvFilters` / `removeShape`. **`filterCombinationStore` is a DERIVED registry of Kinetica view-names — NOT a filter store**, and `views[].filter_clause` is a *server-persisted static WHERE* shown as read-only text, unrelated to drill filters. **`useCombinationOrchestrator` + `AggregatedWidgetRenderer` are the SOLE triggers** of `materialize`/`DROP`. The filter panel is a **pure presentation + mutation-dispatch surface over the same three stores** — it must read from and write to them exactly as the top bar does, and it must let a `filterVersion` tick propagate to the orchestrator to create/drop views. Every pitfall below is a way of accidentally breaking one of those sentences.

---

## Critical Pitfalls

### Pitfall 1: Panel reads/writes filter state a DIFFERENT way than the top bar (dual source of truth → drift + stale chips)

**What goes wrong:**
The panel introduces its own local `useState`/new store for "active filters" (or reads the *derived* `filterCombinationStore.registry` to decide what chips to show) instead of reading `filterStore.filters` / `filterStore.dvFilters` / `spatialFilterStore.shapes` directly. Result: chips in the panel disagree with the top bar / on-widget badges, a chip dismissed in the panel doesn't clear the actual filter (or clears the view-name entry but not the filter), and drill-downs made by clicking a chart never appear in the panel.

**Why it happens:**
The combination store *looks* like "the list of active filters" (it is keyed per-viz and holds view metadata), and it's tempting to render chips from it. There is direct precedent for this exact class of bug: **`FilteringBadge.tsx` originally read the legacy `filterViewStore` and got stuck "Filtering…" forever** because, post-v1.18, nothing writes that store anymore (see the file's own Phase-96 gap comment; MEMORY: *filtering-badges-read-combination-store*). Any new surface that picks the wrong store inherits the same permanent-staleness failure.

**How to avoid:**
- The panel's chip list is built from the **same three sources the top bar uses**: `filterStore.filters` (per table), `filterStore.dvFilters` (per dv), `spatialFilterStore.shapes`, and optionally `views[].filter_clause` as read-only text. Extract the top bar's chip-assembly block (DashboardsPage ~945–1099) into ONE shared builder and render both surfaces from it — do not fork the logic.
- Every panel mutation calls the **existing actions**: `removeFilter(tableId, column)`, `removeDvFilter(dvId, column)`, `clearFilters(tableId)`, `clearDvFilters(dvId)`, `removeShape(id)`. No new mutation path.
- Render chip text with the existing `buildChipText(column, value, dataType, operator)` from `columnTypes` — never `String(value)` (that mangles `in` arrays and `between` tuples).
- NEVER derive the chip list from `filterCombinationStore` (that's view-names, not filters).

**Warning signs:**
Panel shows a chip the top bar doesn't (or vice-versa); dismissing a chip updates the panel but the chart data doesn't change; a chart-click drill-down chip never shows in the panel; a `grep` finds the panel importing `filterCombinationStore` for anything other than *materializing* spinner state.

**Phase to address:** Panel-Render (extract + share the chip-assembly builder first, before any panel-specific rendering).

---

### Pitfall 2: Filter→widget reverse-map misses a read path or filter kind (WidgetRenderer vs MapChartRenderer; equality vs datetime vs spatial)

**What goes wrong:**
The "which widgets does this filter affect?" list/count (and the hover-highlight target set) is computed by only walking chart widgets — so **map WMS layers** (a separate read path) are never highlighted/counted, **dv-bound** widgets are mis-scoped, **spatial draws** aren't represented as an affecting "filter", or **datetime `between` filters** are dropped because the mapping code special-cased equality filters. The panel then lies: it says "affects 2 widgets" when the drilled filter actually narrows a map layer and a timeline too.

**Why it happens:**
v1.18 has **two independent read paths** — `WidgetRenderer`/`AggregatedWidgetRenderer` (FROM-swap, viz key `w:<id>`) and `MapChartRenderer` (WMS `buildWmsParams` at *two* call sites, viz key `l:<id>`, dep key `comboViewsKey`) — and this split has already bitten every filter feature (MEMORY: *map-wms-is-separate-read-path*; v1.12 Phase 63.1 and v1.18 Phase 92 both existed solely to wire the map path). Layer filter scope lives in a **top-level `layer.filterScope`** field, not `layer.config` (MEMORY: *track-config-toplevel-field*). Filters carry an `operator` (`eq`/`in`/`between`) and datetime filters use `[string,string]` tuples; spatial draws live in a totally different store.

**How to avoid:**
- **Reuse the existing resolver, do not reinvent it.** The forward map already exists: `resolveFilterSet(cfg, activeFilters)` + `resolveSpatialShapes(cfg, shapes)` + `computeFilterScopeSummary(...)` (in `useFilterScopeSummary.ts`). The panel's *inverse* map is: for each active filter/shape, iterate ALL vizzes and include a viz iff the item is in that viz's resolved applied-set. Build the per-viz `cfg` exactly as `useFilterScopeSummary` does.
- **Enumerate BOTH read paths:** chart/records/timeline/calendar widgets (`config.tableId` + `config.filterSelection`, key `w:<id>`), dv-bound widgets (`config.dynamicViewId`), AND every map layer (`layer.filterScope` top-level, key `l:<id>`, `spatialCapable` via `targetsByTable.has(tableId)`).
- **Cover every filter kind:** equality/`in`/`between` all flow through `resolveFilterSet` uniformly (keyed by `sourceWidgetId`), so don't branch on `operator`; spatial shapes flow through `resolveSpatialShapes`; treat both as first-class "filters" in the affects-list.
- **Honor the dv disable flag:** when `authStore.dvFilterScopeDisabled` is set, dv-bound vizzes resolve accept-all (pass `cfg=undefined`) — mirror `useFilterScopeSummary` exactly, or dv widgets get mis-highlighted.

**Warning signs:**
Hovering a filter highlights charts but never a map layer; the affects-count omits dv or map widgets; a datetime/spatial chip shows "affects 0 widgets"; the reverse-map contains its own `sourceWidgetId` matching logic instead of calling `resolveFilterSet`.

**Phase to address:** Reverse-Map (build the shared inverse-mapping helper on top of `resolveFilterSet`/`resolveSpatialShapes`; unit-test all three filter kinds × both read paths × dv-disabled).

---

### Pitfall 3: Side panel doesn't make `ResponsiveGridLayout` reflow (widgets overflow/clip) — or thrashes it on collapse

**What goes wrong:**
Opening the right panel either (a) overlaps/clips the rightmost widgets because the grid still thinks it has the full width, or (b) causes a layout-recompute storm during the open/close animation, dropping frames and sometimes losing scroll position or in-progress drag state.

**Why it happens:**
The grid width comes from `useContainerWidth()` (a ResizeObserver hook) applied to `containerRef` (DashboardsPage line 1118), gated by `mounted`, and fed to `<ResponsiveGridLayout width={width} …>`. Two traps: **(1)** if the panel is rendered *inside* `containerRef` (or as a `position:fixed`/absolute overlay that doesn't shrink the measured element), the measured width never changes → no reflow → clipping. **(2)** if the panel/container has a CSS `width`/`transition` animation, ResizeObserver fires on *every animation frame* → `width` state churns → grid recomputes each frame (thrash), and if the panel toggle causes the grid subtree to unmount/remount, drag+scroll state is lost.

**How to avoid:**
- Put the panel as a **flex sibling** of the `containerRef` grid wrapper so that when the panel occupies space, the grid element genuinely shrinks and ResizeObserver reports the smaller width (auto-reflow, no manual width math).
- **Never remount the grid** on collapse — toggle the panel with a CSS class only; keep `<ResponsiveGridLayout>` mounted and keyed stably (`key={String(w.id)}` per item stays).
- If animating the panel, animate a **transform / non-layout property** (or debounce the width read), so the ResizeObserver isn't fired mid-transition; or snap width at animation end. Confirm the grid recomputes exactly **once** per open and once per close.
- Preserve `handleLayoutChange` semantics — a reflow is a *width* change, not a *layout* change; ensure the collapse doesn't accidentally persist a squished layout to the server.

**Warning signs:**
Rightmost widget is cut off with the panel open; visible relayout stutter while the panel slides; scroll jumps to top on collapse; the server-persisted layout changes after merely toggling the panel.

**Phase to address:** Panel-Render (layout/reflow is the core of standing the panel up).

---

### Pitfall 4: Global "clear all dashboard filters" orphans Kinetica views or violates the sole-materialize-trigger invariant

**What goes wrong:**
Two opposite failure modes: **(A)** the clear-all directly calls `dropCombinationView` / `clearEntry` / `materializeFilter` to "tidy up", double-dropping or dropping views the orchestrator will drop again, and breaking the sole-trigger grep gate; or **(B)** the clear-all mutates some state that does NOT advance `filterVersion`, so the orchestrator never recomputes, refCounts never hit 0, and the materialized Kinetica views are **orphaned** (held open until TTL, memory pressure).

**Why it happens:**
The existing per-row "Clear all" (DashboardsPage ~1026–1053) already does the right thing for *one* table (`clearFilters(tableId)` + a `removeShape` loop) and it's tempting to generalize by reaching into the view registry directly. But **DROP is the orchestrator's job**: clearing `filterStore`/`spatialFilterStore` ticks `filterVersion`/`spatialFilterVersion` → orchestrator recomputes combos → `release`→`refCount 0`→ orchestrator fires the network DELETE. Any renderer/panel that DROPs directly breaks the invariant the whole milestone is constrained to preserve ("`AggregatedWidgetRenderer` remains the SOLE materialize trigger").

**How to avoid:**
- Implement clear-all as **store mutations only**: loop `Object.keys(filterStore.filters)` → `clearFilters(tid)`; loop `Object.keys(filterStore.dvFilters)` → `clearDvFilters(dvId)`; `spatialFilterStore.clearAll()`. That's it. The orchestrator handles every DROP.
- **Do NOT touch `views[].filter_clause`** (server-persisted static WHERE — not a user drill filter) and **do NOT touch `filterCombinationStore`** from the panel.
- Prefer a single batched sequence so it lands as few `filterVersion` ticks as reasonable (mirror the top bar's per-row clear; the orchestrator dedups anyway).
- Add a grep-gate assertion in the clear-all spec: the panel module imports **none** of `materializeFilter`/`dropFilterView`/`dropCombinationView`/`clearEntry`.

**Warning signs:**
After clear-all, Kinetica still shows live `_c{hash}` views (orphans); the sole-trigger grep gate turns red; console shows double DELETEs; clear-all leaves a spatial draw on the map or a dv chip behind.

**Phase to address:** Clear-All (own the global action; verify via network-tab that every combo view DROPs and no direct materialize/drop import exists).

---

### Pitfall 5: On-canvas highlight-on-hover triggers a re-render storm across all widgets and/or leaks

**What goes wrong:**
Hovering a filter chip writes the "highlighted widget ids" into a store that every widget subscribes to as a whole object, so *one* hover re-renders *every* widget (and their charts/maps re-run expensive renders). Or the highlight never clears on `mouseleave`/panel-collapse/unmount, leaving widgets stuck highlighted.

**Why it happens:**
The natural implementation is a shared highlight set, and the natural subscription is `useStore(s => s.highlightedIds)` — which returns a new Set reference on every hover and defeats Zustand's shallow short-circuit. `filterCombinationStore` itself documents this exact anti-pattern (**PITFALL S-02**: "NEVER subscribe to the whole `registry`; project to a primitive"). Maps are especially expensive to re-render (OpenLayers), so a per-hover storm is very visible there.

**How to avoid:**
- Prefer a **CSS-only highlight**: on hover, toggle a class/`data-highlight-target` on the already-rendered `.widget-card` DOM nodes (they're keyed by `w.id`), or set a single parent class and let CSS `:not()` dim the rest — **zero React re-renders**.
- If a store is used, each widget subscribes with a **scoped primitive selector**: `useHighlightStore(s => s.hoveredFilterId !== null && s.affects(w.id))` returning a boolean, so only actually-affected widgets re-render (S-02 pattern).
- **Cleanup is mandatory:** clear on `onMouseLeave`, on panel collapse, and in an unmount effect; include highlight-store `reset()` in BOTH cleanup chains (App.tsx logout + DashboardsPage dashboard-switch) alongside the existing 11 stores.
- Debounce is optional; determinism of cleanup is not.

**Warning signs:**
React DevTools shows all widgets re-rendering on a single hover; map tiles flicker/re-request on hover; a widget stays highlighted after the pointer leaves or after switching dashboards.

**Phase to address:** Highlight (implement CSS-first; add scoped-selector spec + a cleanup/leak spec).

---

### Pitfall 6: Invented/misspelled CSS class silently ships unstyled (passes tsc, vitest, AND theme-guard)

**What goes wrong:**
The panel uses new class names like `filter-panel`, `filter-panel-collapsed`, `filter-panel-chip`, a collapse toggle, etc. If any class name isn't actually defined in `global.css`, it renders as unstyled browser-default chrome — and **every automated gate stays green** (there is no build check that a className resolves to real CSS; MEMORY: *css-bugs-evade-tests-and-theme-guard*). The panel looks broken only in the live UAT.

**Why it happens:**
CLAUDE.md is explicit: no design-system `<Button>`, class-to-CSS binding is unchecked, and a typo silently degrades. Nobody notices because tests assert `className="filter-panel"` is present, not that it's styled.

**How to avoid:**
- **Add every new class to `global.css` BEFORE first use**, and grep-confirm each panel class exists (the milestone already used this discipline for `.widget-filter-badge` in Phase 95 — mirror it).
- **Reuse existing classes for chip parity:** the panel chips should reuse `filter-bar-chip` / `filter-bar-chip-dismiss` / `filter-bar-clear` (they already carry the theme tokens) rather than reinventing chip styling. Match the closest existing surface for the drawer shell.
- Add a lightweight spec that asserts each *new* panel class name appears in `global.css` (string check), so a typo reddens a gate.
- **Verify visually in live UAT** — green tests are not evidence of styling.

**Warning signs:**
Panel renders with default fonts/borders/unstyled buttons; a class appears in TSX but a `grep` of `global.css` finds no rule; UAT is the first place the panel looks wrong.

**Phase to address:** Panel-Render (class-exists discipline) + Verification (visual UAT).

---

### Pitfall 7: Theme-guard blind spots — light-mode/contrast bugs ship green

**What goes wrong:**
The panel introduces `rgba(...)` overlays (drawer scrim, hover states) or picks a wrong token (e.g. accent text that isn't legible on the accent fill), producing an invisible-in-light-mode or low-contrast panel. `theme-guard.spec.ts` **only flags raw `#hex`** — it misses `rgba()` and semantically-wrong tokens (MEMORY: *theme-guard-misses-rgba-and-wrong-tokens*).

**Why it happens:**
Developers trust theme-guard as a complete contrast check; it's only a hex linter. A drawer naturally wants a translucent scrim (`rgba`) and accent-filled chips (needs the on-accent text token).

**How to avoid:**
- Use `var(--*)` tokens for all colors; for translucency use `color-mix(in srgb, var(--token) X%, transparent)` rather than raw `rgba(...)`, and use the on-accent text token (per the app's `--on-accent`/color-mix convention) for text on accent fills.
- Manually **toggle light + dark mode** on the panel during UAT; theme-guard will not catch these.

**Warning signs:**
Panel scrim/chips invisible or unreadable in light mode; `rgba(` present in the panel CSS; text-on-accent fails contrast while all gates are green.

**Phase to address:** Panel-Render (token discipline) + Verification (dark+light UAT walk).

---

### Pitfall 8: Backward-compat break — dashboards with no display-mode don't default to the exact top-bar behavior, or BOTH surfaces render

**What goes wrong:**
Existing dashboards (which have **no** filter-display setting today — no such field exists yet) suddenly show the new panel, or lose their top bar, or worse render **both** the top bar and the side panel — producing duplicate chips, two "Clear all" buttons, and double-fired remove handlers.

**Why it happens:**
There is currently **no `displayMode`/`filter_display` field anywhere** (grep confirms). Adding one requires a default, and it's easy to (a) default to the new mode, breaking existing dashboards, or (b) render the panel additively without gating the old top bar off, so both mount.

**How to avoid:**
- Persist the setting at the **dashboard level** (not `widget.config`), with an **absent value defaulting to `"top"`** — old dashboards must be byte-identical to today.
- Render **top bar XOR side panel** from a single switch on the resolved mode; never mount both. One code path owns "where do chips go".
- Because both surfaces share the *same* stores and actions (Pitfall 1), the switch is purely presentational — no state duplication.
- Add a spec: a dashboard with no display-mode renders the top bar and does not render the panel; and the two never coexist.

**Warning signs:**
Two sets of chips / two "Clear all" buttons on screen; removing a chip fires twice; an existing dashboard opens in panel mode; the display-mode column has no default and reads `null` as "panel".

**Phase to address:** Persistence (define dashboard-level field + default) + Panel-Render (XOR switch).

---

### Pitfall 9: Narrow-viewport / responsive collapse of the side panel squeezes the grid to unusability

**What goes wrong:**
A fixed-width (~300px) panel on a small viewport eats most of the available width; `ResponsiveGridLayout` drops to its `xxs` (0-width breakpoint) column count and widgets become a squished single column behind an ever-present panel. Or the collapse toggle is only reachable when the panel is already open.

**Why it happens:**
Breakpoints are `{lg:1200, md:996, sm:768, xs:480, xxs:0}` with cols down to `xxs:6`; `useContainerWidth` measures *actual* px, so a 300px panel on a 480px screen leaves the grid ~180px → xxs. The panel was designed for desktop widths.

**How to avoid:**
- On narrow viewports, make the panel an **overlay drawer** (doesn't subtract grid width) or **auto-collapse** to a thin rail with an always-visible expand affordance; don't let it permanently steal a large fixed fraction.
- Ensure the collapse/expand control is reachable in *both* states (a persistent rail/handle).
- Test at `sm`/`xs`/`xxs` widths that the grid keeps a usable column count with the panel present.

**Warning signs:**
On a laptop-half or tablet width the dashboard collapses to one squished column; the expand control disappears when collapsed; horizontal scrollbar appears with the panel open.

**Phase to address:** Panel-Render (responsive/collapse behavior) + Verification (narrow-width UAT).

---

### Pitfall 10: "Filtering…" / materializing feedback and empty/edit states go stale or missing in the panel

**What goes wrong:**
The panel doesn't reflect the in-flight materialize spinner (so a chip looks applied before its view exists), or it has no empty state ("No active filters") and no representation for spatial draws / static WHERE, so the panel looks broken or blank exactly when the top bar had a clear affordance.

**Why it happens:**
The materializing signal lives in `filterCombinationStore` (per-viz `materializing`) and is read correctly ONLY via a **primitive selector** (`FilteringBadge` iterates the registry returning a boolean — S-02 lock). It's easy to skip this in the panel, or to forget that the top bar shows three distinct things (column chips, spatial chips, static `WHERE` text) that the panel must also represent.

**How to avoid:**
- Reuse `FilteringBadge`/`MapFilteringBadge` (or their primitive-selector pattern) inside the panel for consistency; never subscribe to the whole registry.
- Represent all three top-bar concepts: column chips (`buildChipText`), spatial chips (`${label} (${measurement})`), and read-only static `WHERE` text; add an explicit empty state.

**Warning signs:**
Panel never shows "Filtering…"; spatial draws or static WHERE clauses are missing from the panel; blank panel with active filters present.

**Phase to address:** Panel-Render.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Render panel chips from `filterCombinationStore` instead of `filterStore`/`spatialFilterStore` | Fewer selectors to wire | Permanent stale-chip drift (the exact `FilteringBadge` bug) | **Never** |
| Fork the top-bar chip-assembly logic into a second copy for the panel | Ship the panel faster | Two surfaces diverge over time; every future filter kind must be added twice | **Never** — extract one shared builder |
| Panel clear-all directly DROPs combination views | "Tidy" cleanup feels safe | Breaks sole-materialize-trigger gate; double-drops/orphans | **Never** |
| Store display-mode in `widget.config` instead of dashboard row | No server/schema change | Wrong scope (it's a dashboard choice, all viewers); migration mess | **Never** |
| Highlight via whole-object store subscription | Trivial to write | Per-hover re-render storm across all widgets/maps | **Never** — scoped selector or CSS-only |
| Skip the "class exists in global.css" check for new panel classes | Less test code | Unstyled panel ships green; caught only at UAT | Only if reusing existing classes exclusively |
| Overlay panel with `position:fixed` to dodge reflow work | No width math | Widgets clip behind panel; grid never reflows | Only as the *deliberate* narrow-viewport overlay mode (Pitfall 9), not desktop |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `filterStore` (source of truth) | Reading derived stores for the chip list | Read `filters`/`dvFilters` + `spatialFilterStore.shapes`; mutate via existing actions only |
| `filterCombinationStore` | Subscribing to whole `registry` (re-render storm) or DROPping from the panel | Primitive selectors only (S-02); let the orchestrator DROP |
| `MapChartRenderer` (2nd read path) | Reverse-map only walks chart widgets | Enumerate `l:<id>` layers via top-level `layer.filterScope`; reuse `resolveFilterSet` |
| `useCombinationOrchestrator` | Panel materializes/drops directly | Panel only ticks `filterVersion` via store mutations; orchestrator owns all network materialize/DROP |
| `ResponsiveGridLayout` + `useContainerWidth` | Panel inside `containerRef` / overlay → no reflow; animated width → thrash | Panel as flex sibling that shrinks the measured element; animate transform, not layout |
| dv filter scope | Ignoring `authStore.dvFilterScopeDisabled` in the reverse-map | Mirror `useFilterScopeSummary`: dv + disabled ⇒ resolve accept-all |
| Store cleanup chains | New highlight/panel store not reset on dashboard switch/logout | Add `reset()` to BOTH chains (App.tsx + DashboardsPage), like the existing 11 stores |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Whole-store subscription for highlight | All widgets re-render on one hover; map flicker | Scoped primitive selector / CSS-only highlight | Any dashboard with a map or many widgets |
| ResizeObserver firing during panel width animation | Layout recompute every frame; janky slide | Animate transform, or debounce/snap width | Every panel open/close |
| Reverse-map recomputed on every render for every chip | Sluggish panel with many filters/widgets | Memoize the inverse map on `filterVersion`+`spatialFilterVersion`+widgets/layers | Dashboards with many widgets × many active filters |
| Panel re-rendering on `combinationVersion` churn | Panel re-renders on every materialize tick | Subscribe only to filter/spatial versions for chip list; combo store only for spinner (primitive) | Frequent drill-downs |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Rendering filter values / labels via `dangerouslySetInnerHTML` or inline SVG | XSS via user/data-derived chip text | Render as text nodes only (CLAUDE.md XSS boundary); reuse `buildChipText` |
| Assuming clear-all also clears server-persisted static WHERE | User thinks data is unfiltered when a persisted `filter_clause` still applies | Keep static WHERE visibly labeled as read-only/persisted; do not touch it on clear-all |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Panel and top bar both visible | Duplicate chips, double clear buttons, confusion | Top XOR panel from one switch (Pitfall 8) |
| "Clear all" ambiguous scope (one table vs whole dashboard) | User clears less/more than expected; orphaned draws | Label global clear-all explicitly; confirm it clears columns + dv + spatial across all tables |
| Highlight with no cleanup | Widgets stuck highlighted after hover/navigation | Deterministic clear on leave/collapse/unmount |
| Panel eats the canvas on small screens | Dashboard unusable at tablet width | Overlay/auto-collapse on narrow viewports |
| No empty state | Blank panel looks broken | Explicit "No active filters" state |

## "Looks Done But Isn't" Checklist

- [ ] **Chip parity:** panel dismiss + clear behave identically to the top bar — verify by dismissing the SAME chip in each mode and confirming identical data change and identical store mutation.
- [ ] **Both read paths mapped:** hovering a filter highlights affected **map layers** and **dv-bound** widgets, not just charts — verify with a dashboard containing a chart + a WMS layer + a dv widget on the same table.
- [ ] **Datetime + spatial filters:** a `between` (calendar-drill) chip and a spatial draw each show correct chip text AND a correct affects-count — verify both kinds explicitly.
- [ ] **Grid reflow:** rightmost widget fully visible with panel open; grid recomputes exactly once per toggle; server layout unchanged by toggling — verify in network + visually.
- [ ] **Clear-all leaves no orphans:** after global clear, network tab shows every `_c{hash}` view DROPped and no chips/draws remain — verify against Kinetica.
- [ ] **Sole-trigger intact:** `grep` shows the panel imports no `materialize*`/`drop*View`/`clearEntry` — verify grep gate green.
- [ ] **Backward-compat:** an existing (pre-v1.20) dashboard opens in top-bar mode, byte-identical — verify a saved dashboard.
- [ ] **CSS real:** every new panel class exists in `global.css`; panel styled in BOTH light and dark — verify visually, not via green tests.
- [ ] **Highlight cleanup:** switch dashboards mid-hover → no stuck highlight; highlight store in both reset chains — verify.
- [ ] **Materializing feedback:** panel shows "Filtering…" while a combo view is in flight — verify via primitive selector (no whole-registry subscribe).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Panel read from wrong (derived) store | MEDIUM | Repoint chip list to `filterStore`/`spatialFilterStore`; add a regression spec (mirror the `FilteringBadge` fix) |
| Reverse-map missed map/dv/datetime/spatial | MEDIUM | Route the map through `resolveFilterSet` via `l:<id>` + top-level `layer.filterScope`; add per-kind × per-path unit tests |
| Clear-all orphaned views | LOW | Replace direct DROP calls with store mutations only; verify orchestrator DROPs via network tab |
| Highlight re-render storm | LOW–MEDIUM | Switch to CSS-only or scoped boolean selector; add DevTools render-count spec |
| Grid clipping/thrash | MEDIUM | Move panel to a flex sibling of `containerRef`; stop remounting the grid; animate transform not width |
| Unstyled panel shipped | LOW | Add missing classes to `global.css`; add class-exists spec |
| Both surfaces render | LOW | Gate top-bar off in panel mode; add XOR spec |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase (v1.20) | Verification |
|---------|--------------------------|--------------|
| 1 — Dual source-of-truth drift | Panel-Render (shared chip builder) | Dismiss-same-chip parity spec; grep panel doesn't read combo store for chips |
| 2 — Reverse-map misses paths/kinds | Reverse-Map | Unit: 3 filter kinds × {chart, map layer, dv} × dv-disabled |
| 3 — Grid reflow/thrash | Panel-Render | Visual: no clipping; layout-change fires once; server layout unchanged |
| 4 — Clear-all orphans / sole-trigger | Clear-All | Network: all combo views DROP; grep: no materialize/drop imports |
| 5 — Highlight storm/leak | Highlight | DevTools render-count spec; cleanup-on-switch spec |
| 6 — Silent CSS class | Panel-Render + Verification | class-exists-in-global.css spec; visual UAT |
| 7 — Theme-guard blind spots | Panel-Render + Verification | Dark+light UAT; no `rgba(` in panel CSS |
| 8 — Backward-compat / both render | Persistence + Panel-Render | Old dashboard = top-bar byte-identical; XOR spec |
| 9 — Narrow-viewport squeeze | Panel-Render + Verification | Usable grid at sm/xs/xxs with panel present |
| 10 — Stale/missing panel states | Panel-Render | "Filtering…" via primitive selector; spatial + static WHERE + empty state present |

## Sources

- Codebase (HIGH — read directly): `packages/web/src/store/filterStore.ts`, `spatialFilterStore.ts`, `filterCombinationStore.ts`; `components/DashboardsPage.tsx` (top-bar render ~945–1100, `ResponsiveGridLayout`/`useContainerWidth` ~487/1118–1212, 11-store cleanup ~520–558); `components/FilteringBadge.tsx` (prior stale-store bug); `components/WidgetFilterBadge.tsx` + `lib/useFilterScopeSummary.ts` / `resolveFilterSet.ts` / `resolveSpatialShapes.ts` (reverse-map engine); `components/charts/MapChartRenderer.tsx` (2nd read path, `l:<id>`, `comboViewsKey`).
- Project docs (HIGH): `CLAUDE.md` (UI/CSS trap, theme-guard limits, test gates), `.planning/PROJECT.md` (v1.20 goal + constraints), `.planning/milestones/v1.18-ROADMAP.md` (combination model, both-read-path wiring, sole-materialize-trigger).
- User MEMORY (HIGH — operator-observed): filtering-badges-read-combination-store; map-wms-is-separate-read-path; css-bugs-evade-tests-and-theme-guard; theme-guard-misses-rgba-and-wrong-tokens; track-config-toplevel-field; parallel-executors-roadmap-collision.

---
*Pitfalls research for: Dashboard Filter Panel (v1.20) on Kinetica BI*
*Researched: 2026-07-08*
