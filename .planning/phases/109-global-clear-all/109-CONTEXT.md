# Phase 109: Global Clear-All - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

A single action clears EVERY active filter across the whole dashboard — all table filters, all dynamic-view filters, and all spatial draws — by mutating ONLY the input stores; the combination orchestrator ref-count DROPs the now-unused views. Lives in the filter panel's reserved header slot. Requirement FCLEAR-V120-01.

NOT here: the designer display-mode toggle UI (Phase 110). This is the last feature phase before verification.
</domain>

<decisions>
## Implementation Decisions

### Placement — panel only
- One global "Clear all filters" action in the filter panel's header (the reserved `.filter-panel-header-actions` slot, currently just the collapse button). The top bar KEEPS its existing per-group "Clear all" controls and does NOT get a global clear this phase (the requirement's "ideally the top bar" is treated as a nice-to-have, deferred).

### Behavior — immediate, no confirmation
- Clicking clears instantly (no confirm dialog). Filters are transient + cheap to re-apply (drill/draw again), matching the low-friction click-through model.

### Visibility + label
- The global button renders ONLY when there is at least one active filter (hidden when the dashboard has none). Reuse the existing active-filter count the panel already has (`count`).
- Label: **"Clear all filters"** — distinct from the per-group **"Clear all"** buttons so the two aren't confused. (Per-group clears remain unchanged.)

### Clear mechanics (locked by research — sole-materialize-trigger invariant)
- The handler mutates INPUT stores only: loop `clearFilters(tableId)` over every tableId in `filterStore.filters`, `clearDvFilters(dvId)` over every dvId in `filterStore.dvFilters`, and call `spatialFilterStore.clearAll()`.
- Do NOT call `filterStore.reset()` live (it zeroes the version counter — that's a lifecycle wipe, not a mutation signal). Do NOT call materialize/drop from the handler — the orchestrator observes the emptied stores and ref-count DROPs the combination views (existing DROP-at-0 path). This preserves `AggregatedWidgetRenderer`/orchestrator as the sole materialize/DROP trigger.
- No-op safe: clicking with zero filters (shouldn't happen since the button is hidden) must be a harmless no-op.

### Claude's Discretion
- Exact button styling/class (reuse an existing button class vs a small header-action treatment) + optional icon; keep tokens-only, no invented classes.
- Whether the global-clear closure lives inline in DashboardsPage or as a tiny shared helper.

### Scope / gates
- FRONTEND-ONLY. Panel-mode only surface; do NOT change top-bar rendering. Gates: web tsc clean; web vitest 100% (default PARALLEL run — a global `afterEach(vi.useRealTimers())` isolation guard now exists in test/setup.ts; keep new specs timer-clean); theme-guard green (tokens only). Test: clicking clears all three stores (filters + dvFilters + shapes); button hidden at zero filters; grep-assert the handler contains no materialize/drop call (sole-trigger invariant).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Where it renders
- `packages/web/src/components/FilterPanel.tsx` — the `.filter-panel-header-actions` slot (comment at ~line 14 notes it currently renders only the collapse button); `FilterPanelProps` (add an `onClearAllFilters`/`count`-gated button); the per-group `.filter-bar-clear` "Clear all" pattern to visually align with.
- `.planning/phases/107-panel-shell-reflow-xor-switch-chips/107-UI-SPEC.md` — reserved the header-actions slot for this global clear-all.

### Clear mechanics + invariant
- `packages/web/src/store/filterStore.ts` — `filters` (by tableId), `dvFilters` (by dvId), `clearFilters(tableId)`, `clearDvFilters(dvId)`; do NOT use `reset()` live.
- `packages/web/src/store/spatialFilterStore.ts` — `clearAll()` (increments version, empties shapes; no-op when already empty) vs `reset()` (lifecycle wipe — do not use here).
- `packages/web/src/hooks/useCombinationOrchestrator.ts` — the DROP-at-0 ref-count path that fires when stores empty (the handler must NOT call materialize/drop itself).
- `packages/web/src/components/DashboardsPage.tsx` — where the panel is rendered + the active-filter reads (`allStoreFilters`/`allDvFilters`/shapes) live; build the global-clear closure here and pass it to FilterPanel.
- `.planning/research/ARCHITECTURE.md` — the global clear-all design (input-store mutations only; never reset() live; orchestrator DROPs).

### Gates / conventions
- `CLAUDE.md` — UI conventions (reuse classes, tokens only) + test gates.
- `.planning/phases/108-.../108-CONTEXT.md` + memory: web vitest parallel fake-timer isolation (keep new specs timer-clean).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Per-group clear already wired (`.filter-bar-clear` + `onClearAll` in FilterPanel groups) — the global button reuses the same store actions, just looped across all sources.
- `spatialFilterStore.clearAll()` already exists and is version-safe.
- The panel already receives the active-filter `count` — reuse it to gate the button's visibility.

### Established Patterns
- Input-store mutation → orchestrator ref-count DROP (never call materialize/drop from UI). Version counters must increment (clearFilters/clearDvFilters/clearAll do), so avoid reset() live.
- Tokens-only styling; no invented classNames (they pass all gates but render unstyled).

### Integration Points
- FilterPanel header-actions slot ← DashboardsPage global-clear closure. No server, no new store.
</code_context>

<specifics>
## Specific Ideas

- Header shape endorsed:
  ```
  Filters (3)     [ Clear all filters ]      (global — only when filters active)
  ▸ region = West ...            Clear all   (per-group — unchanged)
  ```
- Immediate clear on click; button hidden when zero filters.
</specifics>

<deferred>
## Deferred Ideas

- A global clear-all in the TOP BAR (not just the panel) — the requirement's "ideally the top bar" nice-to-have; deferred to keep this phase panel-scoped and avoid top-bar regression surface.
- A confirm/undo for clear-all — considered and set aside (immediate, low-friction chosen).
</deferred>

---

*Phase: 109-global-clear-all*
*Context gathered: 2026-07-10*
