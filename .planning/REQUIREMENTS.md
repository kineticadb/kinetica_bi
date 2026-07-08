# Requirements: Kinetica BI — v1.20 Filter Panel

**Defined:** 2026-07-08
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

**Milestone framing:** A presentation-layer alternative for viewing and managing a dashboard's active filters — a collapsible right-side filter panel (vs. the current top bar), designer-selected per-dashboard, with full chip parity, a global clear-all, and visibility into which widgets each filter affects. Built entirely over the existing filter state (`useFilterStore` + `useSpatialFilterStore`); the v1.18 combination model and `AggregatedWidgetRenderer` sole-materialize-trigger invariant are UNCHANGED (no new materialize path, no filter-semantics change).

## v1 Requirements

### Display Setting (FSET)

- [ ] **FSET-V120-01**: A designer (with dashboard-edit permission) can choose a dashboard's filter display mode — top bar or right side panel — from a dashboard setting.
- [ ] **FSET-V120-02**: The display-mode choice persists per-dashboard (server-side) and every viewer of that dashboard sees the designer's choice.
- [ ] **FSET-V120-03**: A dashboard with no display mode configured defaults to the existing top-bar behavior, byte-identical to today (backward-compat).

### Filter Panel (FPANEL)

- [ ] **FPANEL-V120-01**: When a dashboard's mode is "panel", its active filters render in a collapsible right-side panel instead of the top bar; the two surfaces are mutually exclusive (never both rendered).
- [ ] **FPANEL-V120-02**: The panel lists all of the dashboard's active filters as chips, covering equality/in, datetime-between, and spatial-draw filters (the same set the top bar shows).
- [ ] **FPANEL-V120-03**: A user can remove an individual filter from the panel (parity with the top bar).
- [ ] **FPANEL-V120-04**: A user can clear a group of filters from the panel (parity with the top bar's per-group clear-all).
- [ ] **FPANEL-V120-05**: The panel can be collapsed and expanded; when collapsed it shows an active-filter count badge (e.g. "Filters 3").
- [ ] **FPANEL-V120-06**: The panel shows an empty state when no filters are active.
- [ ] **FPANEL-V120-07**: The panel groups filters by source (table / dynamic view / spatial draws) for scannability.
- [ ] **FPANEL-V120-08**: Each filter shows its provenance — the source widget it originated from — when that information is available.
- [ ] **FPANEL-V120-09**: The top bar and the panel render filter chips via a single shared chip component (consistent appearance and behavior across both surfaces).

### Filter → Widget Mapping (FSCOPE)

- [ ] **FSCOPE-V120-01**: For each active filter, the panel shows which widgets it applies to (names and/or count), computed across both chart widgets and map layers and all filter kinds (equality/in/date/spatial), honoring per-visualization filter scope.
- [ ] **FSCOPE-V120-02**: Hovering a filter in the panel highlights the widgets it applies to on the dashboard canvas.
- [ ] **FSCOPE-V120-03**: Clicking a filter scrolls to and briefly flashes the affected widget(s) on the dashboard.

### Clear All (FCLEAR)

- [ ] **FCLEAR-V120-01**: A user can clear ALL active dashboard filters — across every table, dynamic view, and spatial draw — with a single action, from the panel (and, ideally, the top bar).

### Verification (VERIFY)

- [ ] **VERIFY-V120-01**: All features verified via green automated gates (web vitest 100% from `packages/web`, web + server `tsc` clean, theme-guard green, server vitest set-based ⊆ TD-V16-TEST-ISOLATION) PLUS a blocking live operator walk-through — including light/dark theme and narrow-viewport visual checks of the panel + highlight (which automated gates cannot catch) — with any gaps fixed in-session and re-walked to PASS.

## v2 Requirements (deferred)

### Filter Panel — later

- **FPANEL-V2-01**: Filter search / quick-find within the panel when there are many filters.
- **FPANEL-V2-02**: Pinned/floating panel or a viewer-level layout override (this milestone is designer-set, per-dashboard).
- **FPANEL-V2-03**: Resizable (drag-width) panel.

## Out of Scope

Explicitly excluded to prevent scope creep (confirmed with operator 2026-07-08):

| Feature | Reason |
|---------|--------|
| In-panel filter authoring / value editing | Panel is a presentation/management surface, not a filter builder; filters originate from drill-down / spatial draws. |
| Editing per-widget filter scope from the panel | Scope authoring already lives in the existing per-visualization config (v1.18 / Phase 93); the panel visualizes it read-only. |
| Saved filter sets / bookmarks | Filters are transient session state; persistence of filter sets is a separate, larger feature. |
| Pending "Apply" batch mode | Filters apply live (click-through model); a staged apply changes the interaction model. |
| AND/OR logic builders | Filter semantics are unchanged this milestone; no boolean-expression UI. |
| Draggable / floating panels | Locked to a docked right-side (or top-bar) layout. |
| New materialize path or filter-semantics change | Presentation layer only — `AggregatedWidgetRenderer` remains the sole materialize trigger; the combination model is unchanged. |

## Traceability

Populated during roadmap creation (phase numbering continues from 104).

| Requirement | Phase | Status |
|-------------|-------|--------|
| FSET-V120-01 | TBD | Pending |
| FSET-V120-02 | TBD | Pending |
| FSET-V120-03 | TBD | Pending |
| FPANEL-V120-01 | TBD | Pending |
| FPANEL-V120-02 | TBD | Pending |
| FPANEL-V120-03 | TBD | Pending |
| FPANEL-V120-04 | TBD | Pending |
| FPANEL-V120-05 | TBD | Pending |
| FPANEL-V120-06 | TBD | Pending |
| FPANEL-V120-07 | TBD | Pending |
| FPANEL-V120-08 | TBD | Pending |
| FPANEL-V120-09 | TBD | Pending |
| FSCOPE-V120-01 | TBD | Pending |
| FSCOPE-V120-02 | TBD | Pending |
| FSCOPE-V120-03 | TBD | Pending |
| FCLEAR-V120-01 | TBD | Pending |
| VERIFY-V120-01 | TBD | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 0 (roadmap pending)
- Unmapped: 17 ⚠️

---
*Requirements defined: 2026-07-08*
*Last updated: 2026-07-08 after initial definition*
