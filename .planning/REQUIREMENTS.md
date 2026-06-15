# Requirements: Kinetica BI — v1.12 Drill-Down on Dynamic-View-Backed Widgets

**Defined:** 2026-06-15
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, without writing SQL.

**Milestone goal:** Restore click-through exploration for widgets bound to a **dynamic view**. Today, drilling on a dv-backed chart/table mis-applies the filter to the underlying SOURCE TABLE (`dispatchDrillDown` keys by `tableId`; the dv-bound widget reads the raw dv view and never reflects the click). Make a drill-down filter the **dynamic view's data**, isolated to widgets bound to that same dv.

**Locked decisions (2026-06-15):**
- **DV-isolated scope:** drilling a dv-backed widget filters ONLY that dynamic view — the clicked widget + other widgets bound to the SAME dv update; source-table widgets and other dvs are untouched (a dv is its own data scope, mirroring how table-backed drilling filters all widgets on that table).
- **Filter the dv's materialized view in place:** the drill-down filter materializes `FROM <dv_view> WHERE <clicked filter>` — a filtered sub-view of the dynamic view's own materialized view — NOT a new filter on the source table.
- **Preserve invariants:** `AggregatedWidgetRenderer` remains the SOLE materialize trigger; the existing table-backed drill-down path is unchanged; no new server routes (extend `POST /api/filter/materialize`); frontend-vitest 100% + web/server tsc clean + server set-based known-flaky gate (⊆ TD-V16-TEST-ISOLATION); decoupled from the v1.11 action engine.
- **No new domain research** — fix in our own filter/dynamic-view pipeline, root-caused this session.

## v1 Requirements

### Dynamic-View Drill-Down

- [ ] **DVDRILL-V112-01**: Clicking a drill-eligible element (pie slice / bar / line or scatter point / table or records row) on a widget bound to a dynamic view applies a drill-down filter to the **dynamic view's data** — NOT a filter on the underlying source table. Works for all drill-capable widget types.
- [ ] **DVDRILL-V112-02**: A dynamic-view drill-down updates LIVE — the clicked widget AND every other widget bound to the SAME dynamic view re-render to the filtered slice. Widgets bound to the source table or to a DIFFERENT dynamic view are NOT affected (dv-isolated scope).
- [ ] **DVDRILL-V112-03**: The dv drill-down materializes a filtered view `FROM <dynamic-view materialized view> WHERE <filter>` via the existing `POST /api/filter/materialize` path extended to accept a dynamic-view source (no new route); `AggregatedWidgetRenderer` remains the sole materialize trigger. *(Server portion done in Phase 62; client wiring in Phase 63.)*
- [ ] **DVDRILL-V112-04**: A dv-backed widget's data read FROM-swaps to the **filtered-dv view** when a dv filter is active and falls back to the raw dynamic-view view when it is cleared (precedence: filtered-dv → dv); over-threshold / not-yet-materialized dv states still behave safely (no crash, existing empty/pending UX preserved).
- [ ] **DVDRILL-V112-05**: Filter state is keyed so a dynamic-view id can NEVER collide with a table id (composite / kind-scoped key or a dv-scoped slice); a dv drill-down shows a removable filter chip identifying the dynamic view + clicked value, removing it reverts the dv widgets to the unfiltered dynamic view, and dv filters reset on dashboard-switch + logout (consistent with the table-filter lifecycle).

### Verification

- [ ] **VERIFY-V112-01**: Live operator UAT — drilling a dv-backed pie (and at least one other chart type) filters the dynamic view's data live; same-dv widgets update while source-table widgets stay unaffected; the chip clears back to the unfiltered dv; the sole-materialize-trigger invariant holds; automated gates green (frontend vitest 100% from `packages/web`, web + server `tsc` clean, server vitest set-based gate ⊆ TD-V16-TEST-ISOLATION).

## v2 Requirements

Deferred to a future milestone.

### Broader dynamic-view interactivity

- **DVX-V2-01**: Spatial (bbox/lasso/circle) filtering of a dynamic-view-backed MAP layer (this milestone is chart/table drill-down only).
- **DVX-V2-02**: Cross-scope propagation — a dv drill-down also filtering source-table or sibling-dv widgets (explicitly rejected for v1.12 as semantically muddy).
- **DVX-V2-03**: Drill-down across nested dynamic views (a dv whose source is another dv).

## Out of Scope

Explicitly excluded for v1.12.

| Feature | Reason |
|---------|--------|
| Changing the table-backed drill-down path | It works; v1.12 only adds the dv-backed path alongside it. |
| New server routes / WebSocket | Extend the existing `POST /api/filter/materialize` to accept a dv source; no new infra. |
| DV drill filtering source-table or other-dv widgets | Locked scope decision: dv drill is isolated to the same dynamic view. |
| Spatial filter on dv-backed map layers | Chart/table drill-down only this milestone (→ DVX-V2-01). |
| Editing the dynamic-view template via drill-down | Drill-down filters the dv's data; it never mutates the dv definition. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DVDRILL-V112-01 | Phase 63 | Pending |
| DVDRILL-V112-02 | Phase 63 | Pending |
| DVDRILL-V112-03 | Phase 62 (server) + Phase 63 (client) | In Progress (server done; client → Phase 63) |
| DVDRILL-V112-04 | Phase 63 | Pending |
| DVDRILL-V112-05 | Phase 63 | Pending |
| VERIFY-V112-01 | Phase 64 | Pending |

**Coverage:**
- v1 requirements: 6 total
- Mapped to phases: 6 (roadmap created 2026-06-15 — Phases 62-64)
- Unmapped: 0

**Phase mapping notes:**
- Phase 62 (SERVER-ONLY) — DVDRILL-V112-03 server portion (extend `POST /api/filter/materialize` to accept a dv source; `FROM <dv_view> WHERE <filter>`).
- Phase 63 (FRONTEND-ONLY) — DVDRILL-V112-01/02/04/05 + the client side of -03 (dv-safe filter keying, dv-aware drill dispatch, filtered-dv read-path swap, chips + lifecycle reset).
- Phase 64 (VERIFICATION + LIVE UAT) — VERIFY-V112-01.

---
*Requirements defined: 2026-06-15*
*Last updated: 2026-06-15 — v1.12 roadmap created (Phases 62-64); traceability mapped*
