# Phase 105: Reverse-Mapping Pure Lib + Tests - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A pure, unit-tested library that INVERTS the existing per-widget filter-scope logic: given the dashboard's active filters (column + spatial) and every visualization's filter-selection config, produce — for each active filter — the set of WIDGETS it applies to. This is the foundational computation consumed by Phase 108 (the panel's "applies-to" list + on-canvas highlight) and reused so the per-filter map and the per-widget badge can never drift.

Out of this phase: any React/store wiring, the panel UI, the highlight rendering (those are Phases 107/108). This phase ships pure functions + tests only.
</domain>

<decisions>
## Implementation Decisions

### Reverse-map output granularity (widget-level, layer-annotated)
- The reverse map returns, per active filter, a WIDGET-LEVEL applies-to set. A filter that matches a map LAYER (`l:<id>`) resolves to its OWNING map widget — because on-canvas highlight can only target a widget card (the stable DOM element), not an individual layer.
- For map widgets, each applies-to entry should carry the specific matching LAYER NAME(S) so Phase 108 can render "Coverage Map — Roads layer" while still highlighting the whole card. Chart widgets (`w:<id>`) map directly with no layer annotation.
- Dedup: a filter matching multiple layers of the SAME map widget yields ONE widget entry, with the matched layer names aggregated onto it (not multiple entries for one card).
- "Applies-to count" therefore counts distinct widget cards, not raw vizzes.

### Filter identity / join key
- Operate per active filter (the `ActiveFilter` itself) and per spatial `Shape`, mirroring how the top-bar chips already identify filters — so Phase 108 can join panel chips → applies-to sets without inventing a separate key scheme. Keep the returned association keyed to the same filter objects the panel renders.

### Zero-match filters
- A filter that applies to no widgets returns an EMPTY applies-to set. The lib imposes NO special zero-state contract — Phase 108 decides whether/how to render "applies to 0 widgets." (User chose: just an empty list from the lib.)

### Locked by mirroring existing behavior (do NOT re-decide)
- REUSE `resolveFilterSet` (column filters) + `resolveSpatialShapes` (spatial) as the per-viz forward test; never reimplement scope logic. The reverse map is literally "for each viz, run the forward resolver; if this filter is in the applied set, add this viz's owning widget."
- Cover all filter kinds: equality/in, datetime-between (all are `ActiveFilter`s — operator-agnostic), and spatial shapes.
- Cover BOTH read paths: `w:<id>` chart widgets AND `l:<id>` map layers (translated to owning map widget).
- Honor `dvFilterScopeDisabled` (dv-bound sources revert to accept-all), exactly as `useFilterScopeSummary` does.
- Source of truth for active filters = `useFilterStore` (`filters[tableId]`, `dvFilters[dvId]`) + `useSpatialFilterStore` (`shapes`). Do NOT read `filterCombinationStore` (it is a DERIVED orchestrator-written registry — reading it as source of truth is the documented drift trap).
- PURE: no React, no store imports inside the lib. Live-store wiring is a thin hook added in Phase 108.

### Claude's Discretion
- Exact function name(s), signature, and return type shape (e.g. `Map`/array of `{ filter, widgets: Array<{ widgetId, title, layerNames? }> }`).
- How the caller enumerates the "all vizzes" input (widgets + layers with their cfg + tableId/dvId + spatialCapable). Keep the core fn pure by taking an enumerated viz list as an argument; where that enumeration is sourced (dashboard widgets store + `dashboardLayersStore`, mirroring DashboardsPage `includedLayers`) is a planner call.
- Whether to additionally expose a shared primitive that the Phase 95 per-widget badge could reuse to guarantee no drift, vs. leaving the badge untouched (both read the same resolvers already).
- Test structure/fixtures (the phase's deliverable is the lib + its unit tests).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.20 research (this milestone)
- `.planning/research/SUMMARY.md` — synthesized findings; source-of-truth + reverse-map approach + phase spine.
- `.planning/research/ARCHITECTURE.md` — the reverse-map design (inverse of resolvers; both read paths; layer→owning-widget translation via `includedLayerIds`).
- `.planning/research/PITFALLS.md` — source-of-truth drift, both-read-paths enumeration, silent-CSS/theme-guard blind spots (relevant later), test-isolation.

### Existing forward resolvers to invert (READ FIRST — the reverse map mirrors these)
- `packages/web/src/lib/resolveFilterSet.ts` — column-filter forward resolver (allow-list ∩ active; accept-all when cfg absent/"all").
- `packages/web/src/lib/resolveSpatialShapes.ts` — spatial forward resolver.
- `packages/web/src/lib/useFilterScopeSummary.ts` — `computeFilterScopeSummary` (pure) + hook; the exact forward semantics incl. dv accept-all + `dvFilterScopeDisabled` handling; the reverse map must stay consistent with it.
- `packages/web/src/lib/stableComboHash.ts` — `NOFILTER_SENTINEL` + hashing (context for how vizzes bind; not needed for the pure reverse map but useful background).

### Filter state (source of truth) + viz enumeration
- `packages/web/src/store/filterStore.ts` — `ActiveFilter` type (carries `sourceWidgetId`), `filters[tableId]`, `dvFilters[dvId]`.
- `packages/web/src/store/spatialFilterStore.ts` — `Shape` type, `shapes`.
- `packages/web/src/types/filterSelection.ts` — `FilterSelectionConfig`, `DEFAULT_FILTER_SELECTION` (`sourceMode` "all" vs `allowedSourceWidgetIds`).
- `packages/web/src/components/DashboardsPage.tsx` (~lines 1137–1149) — `includedLayers` enumeration pattern (how layers belong to map widgets) — the model for widget+layer enumeration input.

### Combination model background
- `.planning/milestones/v1.18-ROADMAP.md` — per-visualization filter selection / combination model the scope config comes from.

### Conventions / gates
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/TESTING.md` — code style + test patterns.
- `CLAUDE.md` — test gates (web vitest 100% from packages/web; tsc clean; theme-guard; server set-based).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveFilterSet(cfg, allFilters)` + `resolveSpatialShapes(cfg, shapes)` — the forward per-viz resolvers; the reverse map calls these per viz and inverts. Never reimplement.
- `computeFilterScopeSummary({cfg, activeFilters, activeShapes, spatialCapable})` — the canonical forward summary (already pure, already handles dv accept-all + spatialCapable gating). The reverse map is its structural inverse across all vizzes; consider factoring shared internals so badge + map can't drift.
- `ActiveFilter.sourceWidgetId` — already present; also powers provenance (FPANEL-V120-08) later.

### Established Patterns
- Pure-lib-then-hook split is the house pattern (Phase 88/93.5/95): pure fn in `src/lib/*.ts` with no store imports, thin hook wrapper added where it's consumed. Phase 105 ships ONLY the pure lib + tests; the hook lands in Phase 108.
- `vizKey` scheme is `"w:<widgetId>"` / `"l:<layerId>"` — used across the combination store, badges, and map renderer; the reverse map must translate `l:<id>` → owning map widget.
- Tests are vitest, colocated `*.spec.ts`; pure libs are tested without React (fixture cfg + filter arrays).

### Integration Points
- Consumed by Phase 108 (applies-to list + highlight) via a thin hook; possibly reused by the Phase 95 badge for drift-proofing.
- Input enumeration will come from the dashboard widgets + `dashboardLayersStore` at the hook layer (kept out of the pure core).
</code_context>

<specifics>
## Specific Ideas

- Applies-to list example the user endorsed:
  ```
  Applies to (2):
    • Sales by Region  (chart)
    • Coverage Map — Roads layer
  ```
  i.e. widget-level rows, with the matched layer name shown for map widgets.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Panel rendering, highlight behavior, and the live hook are Phases 107/108 by design.)
</deferred>

---

*Phase: 105-reverse-mapping-pure-lib-tests*
*Context gathered: 2026-07-08*
