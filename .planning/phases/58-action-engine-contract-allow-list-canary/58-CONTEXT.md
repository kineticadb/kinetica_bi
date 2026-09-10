# Phase 58: Action Engine + Contract + Allow-List + Canary - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the generic, serializable, allow-list-guarded widget-action engine that LIVE-applies a config patch to any of three target kinds (widget config / map-layer config / dynamic-view config), with the read-once-at-mount trap closed by a day-0 canary test and the filter/materialize systems provably untouched. NO UI this phase (the radio widget is Phase 59). The engine + contract + allow-list is the seam a future AI/MCP layer reuses (Phase 60 documents that; nothing AI/MCP is built).

</domain>

<decisions>
## Implementation Decisions

### Apply model — TRANSIENT FOR EVERYONE (the defining decision)
- A control-widget interaction (runtime) applies the action to a **session-scoped overlay**, LIVE — it does **NOT** persist to the shared saved dashboard and does **NOT** call any config PATCH at runtime.
- Consequences (all good): any viewer (incl. analyst) can interact freely with no permission problem (the gated `PATCH /api/widgets/:id` / layer PATCH are NEVER hit at runtime); the sole-materialize-trigger invariant holds trivially; no last-write-wins races on the shared dashboard.
- The dashboard's saved config is always the BASELINE; the overlay is layered on top at render time and is cleared on reload / dashboard-switch (session lifecycle).

### Persistence — REFINES RADIO-V111-03 / ENGINE-V111-02 (not scope creep — this is the HOW)
- A **runtime** selection is session-only (resets on reload). What PERSISTS is the **designer-configured** radio widget itself: its options, each option's bound action, and an optional **default-selected option** — all saved as part of the radio's own `widget.config` via the normal (gated) config-save path (designers configure; that's fine).
- On dashboard open, the radio applies its configured default option **transiently** so the dashboard presents in the intended initial state. So "persists across reload" = the configured DEFAULT re-applies, NOT a viewer's interaction.
- Downstream note: the planner/verifier must read RADIO-V111-03 / ENGINE-V111-02 through this lens — there is NO runtime PATCH; "persist" refers to the designer-authored config + default, applied transiently on open.

### Dispatch mechanism (resolves the roadmap's open TENSION 1)
- A **session-scoped overlay store** (e.g. `useWidgetActionStore` — `target → configPatch` overlay) mounted at `DashboardOpen` scope (mirrors the `useDynamicViewMaterializeChain` / `useMapOnlySpatialMaterialize` orchestrator-mount precedent), with a single `applyWidgetAction(action)` entry threaded via `DashboardContext`. No runtime PATCH path. (The STACK-vs-ARCHITECTURE debate collapses: transient-only means overlay store + a thin dispatch fn; no persist orchestration to argue about.) Exact store/hook shaping is Claude's discretion within this.

### Target routing (resolves the roadmap's open TENSION 4) + the KEY implementation flag
- Three target kinds: **(a) widget.config** — overlay merged into `widget.config` at render (renderers already read `cfg = widget.config ?? {}` at render time, WidgetRenderer.tsx:286/1411 — live-friendly). **(b) map-layer config** — incl. the TOP-LEVEL `track_config`/`cb_config` `DashboardLayerDto` fields. **(c) dynamic-view config** — lighter (no existing client store-update fn surfaced; exercised once).
- **CRITICAL FLAG for the planner:** `MapChartRenderer` reads layers from `useDashboardLayersStore` (PITFALL S-01 lock, MapChartRenderer.tsx:458-459), NOT from `widget.config`. So for map-layer targets the transient overlay must be readable by the MAP/LAYER RENDER PATH (the layer the map renders must reflect the overlay-merged config — via the layers store selector or an overlay-merge at the map's layer read), not just a widget.config merge. This is the single hardest integration point; the canary test should cover a map-layer target, not only a widget.config target.

### Allow-list — CURATED + VERSIONED
- A versioned allow-list (`ALLOW_LIST_VERSION` constant) defines exactly which fields are patchable per target kind / widget type. Seed it with the demo fields PLUS obvious safe neighbors: map render-mode + the relevant layer fields (incl. `track_config`/`cb_config`), a chart's metric/aggregation, layer visibility/opacity. Tight, reviewed — not "most fields."
- zod-validated; reject unknown keys, wrong-type values, enum violations, and meta/proto keys (`id`, `tableId`, `type`, `__proto__`). The allow-list IS the contract a future AI/MCP layer is bound by.

### Failure UX — SURFACED, NON-BLOCKING
- A rejected (out-of-allow-list) or dangling (deleted target / absent field) action is a safe no-op with a user-visible **toast** ("That control's target is no longer available" / similar) + a console/dev signal. No crash, no partial/corrupt write. The dispatch returns a typed result (e.g. `{ status: "applied" | "target_not_found" | "rejected" }`).

### Decoupling (SAFETY-V111-02)
- The engine never imports any filter-store symbol (`materializeFilter`/`dropFilterView`/`addFilter`/`setBulkFilters`) and never bumps `filterVersion` — enforced by a static source-grep assertion (mirror the Phase 44 `DataFilterRenderer` sole-trigger assertion precedent).

### Canary (ENGINE-V111-02)
- Day-0 deliverable: a mounted-renderer LIVE-re-render test — dispatch an action to a MOUNTED target and assert it re-renders from the changed config with NO remount. Cover at least a widget.config target AND a map-layer target (the latter is where read-once / wrong-store bugs hide).

### Claude's Discretion
- Exact overlay-store shape + selector design; the `applyWidgetAction` signature; the typed result enum names.
- How the overlay merges into the map/layer render path (layers-store selector vs a render-time merge) — pick the cleanest that keeps it live.
- Allow-list data structure (per-type field maps) + exact seed field list within the curated scope above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (this milestone)
- `.planning/research/SUMMARY.md` — synthesized; the two tensions (now resolved above), the contract shape, allow-list, MCP-future, build order.
- `.planning/research/ARCHITECTURE.md` — overlay-store + orchestrator-hook design, the map-layer-store re-render constraint, decoupling.
- `.planning/research/PITFALLS.md` — read-once-at-mount canary, infinite-loop/idempotency guard, allow-list-as-AI-safety, sole-materialize-trigger grep.
- `.planning/research/STACK.md` — `{target, configPatch}` envelope + zod (only new dep, `packages/web`); MCP `inputSchema` shape; do-NOT-add list (no fast-json-patch/immer/new routes).

### Existing code (read before touching)
- `packages/web/src/components/charts/WidgetRenderer.tsx` — `cfg = widget.config ?? {}` at render (286, 1411) — the live-config read pattern target renderers use.
- `packages/web/src/components/charts/MapChartRenderer.tsx:458-459` — PITFALL S-01: layers come from `useDashboardLayersStore`, NOT `widget.config` (the map-target integration flag above).
- `packages/web/src/store/dashboardLayersStore.ts` — `updateLayer(id, patch)` (the layer overlay/merge target).
- `packages/web/src/components/charts/DashboardContext` (`useDashboardContext`) — where `applyWidgetAction` is threaded (DataFilterRenderer.tsx:87 uses it).
- `packages/web/src/components/charts/DataFilterRenderer.tsx` — the sole-materialize-trigger decoupling precedent to mirror for the static grep assertion.
- `packages/web/src/api/client.ts` — `updateWidget` (370) + `updateLayer` (546): the persistence paths used at CONFIG time (NOT runtime); server `PATCH /api/widgets/:id` (index.ts:627) + layer PATCH (714) are the future-MCP surface, untouched this phase.

### Phase contract
- `.planning/ROADMAP.md` §Phase 58 — goal + 5 success criteria.
- `.planning/REQUIREMENTS.md` — ENGINE-V111-01..04, SAFETY-V111-01..02 (read ENGINE-02 / RADIO-03 through the transient-persistence refinement above).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DashboardContext` / `useDashboardContext` — thread `applyWidgetAction` (no prop-drilling); DataFilterRenderer precedent.
- Orchestrator-hook-at-DashboardOpen precedent (`useDynamicViewMaterializeChain`, `useMapOnlySpatialMaterialize`) — the mount pattern for a session-scoped overlay store.
- `dashboardLayersStore.updateLayer` — apply/merge layer-level overlay.
- Render-time `cfg = widget.config ?? {}` reads — overlay merges in here for widget.config targets.
- `zod` (NEW dep, `packages/web` only, ^3) — validate the envelope + allow-list.

### Established Patterns
- Session-lifecycle stores reset on logout/dashboard-switch (filter/filterView precedent) — the overlay store follows this.
- Static source-grep assertion for invariant decoupling (Phase 44 DataFilterRenderer).
- track_config/cb_config are TOP-LEVEL DashboardLayerDto fields ([[track-config-toplevel-field]] memory) — the allow-list + layer routing must respect this.

### Integration Points
- New `widgetAction` lib (envelope type + zod schema + allow-list + `applyWidgetAction`) + a session overlay store.
- `DashboardContext` extended with `applyWidgetAction`.
- Target renderers read overlay-merged config (widget.config renderers: merge at the `cfg` read; map: overlay must reach the layers render path).

### Test-gate reality
- Frontend vitest DETERMINISTIC → 100% (run from `packages/web`). New engine + canary + allow-list rejection tests required. `npx tsc --noEmit -p packages/web` clean (separate gate). Expected ZERO server changes this phase (only `zod` added to packages/web) — flag any server diff.

</code_context>

<specifics>
## Specific Ideas

- Headline use case (drives the allow-list seed + the map-target canary): a radio group switching a map layer's class-break render mode.
- The transient model means a viewer's exploration never mutates the shared dashboard — exactly the safe-exploration behavior wanted; the designer sets the default state.

</specifics>

<deferred>
## Deferred Ideas

- Persisting a viewer's runtime selection / per-user saved state — not v1.11 (transient-for-everyone chosen).
- The radio widget itself (config panel + renderer) — Phase 59/60.
- AI chat widget + MCP server build — v2 (SEAM-V111-01 only documents the hook in Phase 60).
- Additional control widget types, filter-setting actions, cross-dashboard targeting — v2.

</deferred>

---

*Phase: 58-action-engine-contract-allow-list-canary*
*Context gathered: 2026-06-10*
