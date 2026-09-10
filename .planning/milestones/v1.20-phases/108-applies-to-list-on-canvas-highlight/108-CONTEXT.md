# Phase 108: Applies-To List + On-Canvas Highlight - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

In the filter panel (Phase 107), each filter shows which widgets it applies to (a count + expandable list), hovering a filter highlights those widgets on the dashboard canvas, and clicking scrolls to + briefly flashes them. Consumes Phase 105's `computeReverseFilterMap` (widget-level applies-to, map layers → owning map widget with layer names) and Phase 107's `FilterPanel`/`FilterChip`/widget cards.

Covers FSCOPE-V120-01 (in-panel display — the computation half landed in Phase 105), FSCOPE-V120-02 (hover→highlight), FSCOPE-V120-03 (click→scroll+flash). Panel-mode only; topbar mode is untouched. NOT here: global clear-all (Phase 109), designer toggle UI (Phase 110).
</domain>

<decisions>
## Implementation Decisions

### Applies-to display (FSCOPE-V120-01)
- Each chip shows a compact **"applies to N widgets"** line; an **expand affordance (chevron)** reveals the widget list. Not always-expanded (keeps the panel tidy with many chips).
- The expanded list shows widget titles; for map widgets, append the matched **layer name(s)** ("Coverage Map — Roads") from `WidgetApplyEntry.layerNames`.
- Zero-match → "applies to 0 widgets", no expand control (Phase 105 returns an empty widgets[]).

### On-canvas highlight (FSCOPE-V120-02)
- Hovering a filter chip highlights ALL widgets it applies to with an **accent outline/ring** on the affected `.widget-card`s (using `var(--accent)`; e.g. a box-shadow ring). Non-affected widgets are NOT dimmed (ring-only).
- Highlight target is the widget CARD (map layers resolve to their owning map widget card — consistent with Phase 105's widget-level output).
- Highlight clears on mouse-leave.

### Interaction mapping (FSCOPE-V120-02/03)
- **Hover chip → highlight all** its widgets (ring).
- **Click chip → scroll to the first (topmost) affected widget + flash all** affected.
- The **individual widget rows in the expanded list are ALSO clickable** → scroll to + flash that specific widget.

### Scroll + flash (FSCOPE-V120-03)
- Smooth-scroll to the **topmost** affected widget (scrollIntoView) and **flash ALL** affected widgets — a brief (~1s) pulse. (When a single row is clicked, scroll+flash just that one.)
- Flash is a short accent pulse (distinct from the steady hover ring); respect `prefers-reduced-motion` (reduce/skip the animation) — Claude's discretion on exact keyframe/duration.

### Architecture (from research — locked)
- New **session-only `filterHighlightStore`** (zustand) holds the currently highlighted widget id(s) (+ a transient "flashing" set with a retrigger nonce). Actions e.g. `setHighlighted(ids)`, `clearHighlighted()`, `flash(ids)`. It MUST be added to BOTH reset chains (DashboardsPage DashboardOpen cleanup + App UNAUTHORIZED handler), like the other transient stores.
- **Extract a `WidgetCard` component** for the `.widget-card` wrapper. Each card subscribes with a SCOPED BOOLEAN selector (`isHighlighted = store has this widget id`) so ONLY cards whose highlight state changed re-render — avoids the re-render storm (research HIGH-risk item). Card holds a ref for `scrollIntoView` and toggles the ring/flash class.
- Deterministic cleanup: the flash timeout is cleared on unmount / re-trigger (no dangling timers) — research HIGH-risk item.
- A live hook (e.g. `useReverseFilterMap`) wraps `computeReverseFilterMap` (Phase 105): enumerate all vizs (widgets + map layers → owning widget) with cfg/tableId/dynamicViewId/spatialCapable/title, read `useFilterStore` + `useSpatialFilterStore` (scoped selectors / version primitives, PITFALL S-02), honor `dvFilterScopeDisabled`. Enumeration mirrors the DashboardsPage `includedLayers` pattern + `useFilterScopeSummary` source-scoping.

### Claude's Discretion
- Exact ring thickness/offset, flash keyframe + duration, chevron/expand affordance styling.
- Whether hovering an expanded widget row also previews-highlights just that one.
- Reduced-motion exact treatment.

### Scope / gates
- Panel-mode only; do NOT alter topbar rendering or the widget grid behavior beyond adding the WidgetCard highlight hook (which is inert when nothing is highlighted → byte-identical when no filter is hovered).
- FRONTEND-ONLY. Gates: web `tsc` clean; web vitest 100%; theme-guard green. CSS TRAP: every new class (ring/flash/applies-to) MUST be added to global.css in the same task, tokens-only (no #hex/rgba; use `color-mix`/tokens). Re-render-storm + timer-cleanup are the two research-flagged risks — cover with tests (scoped-selector subscription; flash timeout cleared) and note visual-only bits for manual verification.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Consumed foundations
- `packages/web/src/lib/computeReverseFilterMap.ts` — the reverse-map (Phase 105): `computeReverseFilterMap({filters,dvFilters,shapes,vizs,dvFilterScopeDisabled})` → `{filterEntries, shapeEntries}` where each entry is `{filter|shape, widgets: WidgetApplyEntry[]}` and `WidgetApplyEntry = {widgetId, widgetTitle, layerNames?}`. Also `VizDescriptor` (the enumerated input shape).
- `.planning/phases/105-reverse-mapping-pure-lib-tests/105-CONTEXT.md` — widget-level + layer-annotation decisions.
- `packages/web/src/components/FilterPanel.tsx` + `FilterChip.tsx` (Phase 107) — where the applies-to line/expander + hover/click handlers wire in.
- `.planning/phases/107-panel-shell-reflow-xor-switch-chips/107-UI-SPEC.md` — reserved the applies-to slot under each chip; tokens/classes to extend.

### Highlight target + enumeration + state
- `packages/web/src/components/DashboardsPage.tsx` — the `.widget-card` render (~line 1108, keyed by widget id) to extract into `WidgetCard`; the `includedLayers` enumeration (~1076-1088) for the viz list; the DashboardOpen cleanup reset chain.
- `packages/web/src/store/filterStore.ts` (`ActiveFilter.sourceWidgetId`, filters/dvFilters) + `spatialFilterStore.ts` (shapes) — source of truth (read via scoped selectors).
- `packages/web/src/lib/useFilterScopeSummary.ts` — the source-scoping + dvFilterScopeDisabled + spatialCapable pattern the live hook mirrors.
- `packages/web/src/store/dashboardLayersStore.ts` — layers for the viz enumeration (layer → owning map widget).
- `packages/web/src/App.tsx` — the UNAUTHORIZED reset chain the new store must join.

### v1.20 research
- `.planning/research/ARCHITECTURE.md` (filterHighlightStore + WidgetCard extraction), `.planning/research/PITFALLS.md` (re-render-storm avoidance, deterministic cleanup, silent-CSS-class trap).

### Gates / conventions
- `CLAUDE.md` — UI conventions (reuse classes, no invented classNames, tokens-only) + test gates.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeReverseFilterMap` (Phase 105) — pure; this phase adds only the live hook + rendering + highlight wiring.
- `FilterChip`/`FilterPanel` (Phase 107) — add the applies-to line/expander + hover/click handlers here (chip variant="panel" only; topbar variant unaffected).
- Transient session-store pattern (infoSelectionStore / mapViewportSyncStore) + the ~11-store reset chains — mirror for `filterHighlightStore`.
- `.widget-card` (DashboardsPage) — extract to `WidgetCard` with a scoped boolean highlight selector + ref.

### Established Patterns
- zustand scoped selectors / version primitives (PITFALL S-02) to avoid fan-out re-renders — critical here (each card subscribes to its own boolean only).
- Theme-tokens-only; theme-guard only flags raw #hex (misses rgba/wrong tokens) → verify visually.

### Integration Points
- Panel (FilterChip/FilterPanel) → filterHighlightStore → WidgetCard (ring/flash) + scrollIntoView. Live hook over computeReverseFilterMap feeds the applies-to lists + the widget-id sets for highlight/flash.
</code_context>

<specifics>
## Specific Ideas

- Applies-to chip shape endorsed:
  ```
  ▸ region = West   ✕
    from: Sales map
    applies to 3 ▾
       • Sales by Region
       • Coverage Map — Roads
       • UL Speed
  ```
- Highlight = accent ring on affected `.widget-card`s; hover chip = ring all, click chip = scroll to topmost + flash all (~1s), list rows individually clickable to scroll+flash one.
</specifics>

<deferred>
## Deferred Ideas

None new. Global clear-all is Phase 109; the designer toggle UI is Phase 110. (Dim-the-others highlight style + hovering expanded rows for per-row preview were considered and set aside / left to discretion, not deferred features.)
</deferred>

---

*Phase: 108-applies-to-list-on-canvas-highlight*
*Context gathered: 2026-07-09*
