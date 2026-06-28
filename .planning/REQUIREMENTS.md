# Requirements: Kinetica BI — v1.18 Per-Visualization Filter Selection

**Defined:** 2026-06-27
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

> v1.18 lets each visualization choose which active filters it applies (instead of every widget sharing one view of all filters), while keeping Kinetica view creation minimal by materializing **one view per UNIQUE filter combination** and binding each visualization to the view it needs. **Opt-out (accept-all) default → byte-identical to v1.17** for unconfigured dashboards. Research-locked design (`.planning/research/SUMMARY.md`): reuse the existing `fingerprint()` dedup pattern (no new deps), a ref-counted `combinationViews` slice + a combination-orchestrator, both read paths wired, bounded view creation. Small SERVER touch (additive `combinationKey?` materialize param + env-config plumbing) — NOT frontend-only.

## v1 Requirements

### Filter Scope Configuration (FSCOPE)

- [x] **FSCOPE-V118-01**: A user can configure, per visualization, which active filters it applies — via a **source-widget allow-list** that lists only filter-PRODUCING widgets (chart drill-downs, the DataFilter widget, map spatial draws) and NOT non-source widgets (records table, map info popup, legend). Defaults to **accept-all** (opt-out) — no config means every filter applies.
- [x] **FSCOPE-V118-02**: Filter-scope config is available on **chart widgets** and **map WMS layers**; for layers it is a TOP-LEVEL `filterScope` field (threaded like `track_config`, never read off `layer.config`).
- [ ] **FSCOPE-V118-03**: **Dynamic views** also support a filter-scope config, gated behind a **deploy-time disable switch** (env flag exposed to the client) so a deployment can hide the dynamic-view filter-scope UI when not wanted.

### View Deduplication & Lifecycle (COMBO)

- [x] **COMBO-V118-01**: The app computes each visualization's RESOLVED filter set (source allow-list ∩ active filters), derives a stable dedup key, and materializes **one Kinetica view per UNIQUE combination** across all visualizations — no duplicate WHERE clauses / no redundant views. Each visualization reads only the view matching its filter set.
- [x] **COMBO-V118-02**: Combination views are **ref-counted and shared** (N visualizations on the same combination share one view), **dropped when no visualization uses them**, **cleared on dashboard switch / logout** (the new store joins the lifecycle reset chain at both `App.tsx` and `DashboardsPage`), and **kept alive** while in use (extending the v1.15 keep-alive touch).
- [x] **COMBO-V118-03**: The number of unique combination-views per table is **bounded by a deploy-time env var** (default ~10, read once at boot with fallback+warn, mirroring v1.15's TTL env vars); when the ceiling is exceeded, additional combinations **fall back to the full all-filters view** (correct data, less customization) and a warning is surfaced.
- [x] **COMBO-V118-04**: With **default (accept-all)** config, rendering is **byte-identical to v1.17** — one view per table, every widget on it, no dashboard migration. (Correctness gate for the renderer-wiring phases.)

### Spatial Filters (SPATIAL)

- [ ] **SPATIAL-V118-01**: Spatial (map-draw) filters participate in the per-combination view model — each visualization's RESOLVED set and dedup hash incorporate the spatial shapes it accepts (per the source allow-list's **spatial-draws** entry); the combination orchestrator includes `spatialFilters` + `spatialTarget` in the materialize for combos that have accepted shapes (the server **already** composes spatial ∧ column WHERE via `composeWhereClause`, and view-naming already supports the `_c{hash8}` combo suffix); and the existing per-table spatial materialize paths (`useMapOnlySpatialMaterialize`) are reconciled so spatial is **neither dropped** for tables shared between a chart and a map **nor double-materialized**. With **default (accept-all)** config, spatial stays applied to all spatial-capable widgets — byte-identical to v1.5/v1.17 behavior.

### Read-Path Binding (READ)

- [x] **READ-V118-01**: Standard chart widgets (`WidgetRenderer`/`AggregatedWidgetRenderer`, `TimelineRenderer`, `NumericLineRenderer`) bind to their combination's view via the FROM-swap read path.
- [x] **READ-V118-02**: Map **WMS layers** bind to their combination's view by pointing the WMS request at the correct per-combination materialized **view name** — filters are NEVER passed in the WMS request itself, so the only change is which view the layer reads from. Update BOTH `buildWmsParams` call sites to resolve the combination view name + add the combination key to their dependency keys so the layer re-requests when its bound view changes (the recurring missed-path gotcha).

### Communication (COMM)

- [ ] **COMM-V118-01**: Each visualization surfaces an **on-widget indicator** of which active filters it is applying vs ignoring — a badge ("N of M filters") shown ONLY when ≥1 active filter is being ignored (no badge in the default accept-all case), with a hover breakdown of applied/ignored filters. The existing top filter-bar (global active filters) is unchanged.

### Verification (VERIFY)

- [ ] **VERIFY-V118-01**: The milestone is proven via green automated gates (frontend vitest 100% from `packages/web`; web `tsc` clean; server `tsc` clean + supertests in BOTH auth modes for the touched materialize/env endpoints; server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION; theme-guard green) AND a blocking live operator walk-through (per-viz filter selection on chart widgets + WMS layers + dynamic views; dedup to shared views confirmed; ceiling fallback; on-widget badge; default-accept-all unchanged; cleanup on dashboard switch/logout), with any gaps fixed in-session and re-walked to PASS.

## Future Requirements (deferred)

- **FSCOPE-V2-02**: Per-column / per-individual-filter exclusion within a visualization (beyond the source-widget allow-list). Dropped from v1.18 — the source-widget allow-list is sufficient and avoids the novel per-column granularity; revisit if a customer needs it.
- **COMM-V2-01**: Annotate each top filter-bar chip with "(ignored by N widgets)".
- **PERF-V2-01**: Per-widget dependency key instead of the global `filterVersion` counter (re-render optimization), if profiling warrants.
- **FSCOPE-V2-01**: Filter scope on additional visualization types if any new ones are added.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-dashboard filter sharing / scoping | This milestone is within-dashboard per-visualization selection only. |
| Changing the drill-down equality/BETWEEN filter semantics | v1.18 changes WHICH filters a viz applies, not how filters are produced. |
| Server-side WHERE-injection per query | The materialized-view model is retained and extended (one view per combination), not replaced with inline WHERE. |
| Filter scope on non-target widgets (map info popup, legend) | The info popup is transient; the legend mirrors a map. Records table IS a filter target but never a filter SOURCE. |
| Per-token raw editing of the dedup hash / view names | Internal; not user-facing. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FSCOPE-V118-01 | Phase 93 | Complete |
| FSCOPE-V118-02 | Phase 93 | Complete |
| FSCOPE-V118-03 | Phase 94 | Pending |
| COMBO-V118-01 | Phase 90 | Complete |
| COMBO-V118-02 | Phase 89 | Complete |
| COMBO-V118-03 | Phase 90 | Complete |
| COMBO-V118-04 | Phase 91 | Complete |
| SPATIAL-V118-01 | Phase 93.5 | Pending |
| READ-V118-01 | Phase 91 | Complete |
| READ-V118-02 | Phase 92 | Complete |
| COMM-V118-01 | Phase 95 | Pending |
| VERIFY-V118-01 | Phase 96 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-27*
*Last updated: 2026-06-28 — SPATIAL-V118-01 added (spatial folded into the combination model); Phase 93.5 inserted*
