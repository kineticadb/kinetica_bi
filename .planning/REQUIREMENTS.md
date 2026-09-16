# Requirements: Kinetica BI — v1.23 Zoom-Aware Layer Legend

**Defined:** 2026-09-16
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

## v1.23 Requirements

### Zoom-Aware Layer Legend

Requested by the operator 2026-09-16, verbatim:

> *"Lets make it more apparent which are the active layers on the layers panel. There are
> configurations for each layer to show at different zoom levels but as you zoom in and out you
> cannot tell which layer is actively being shown on the map. It would be nice to know which is the
> active one and all the layers that are not active on the current zoom level should be clear."*

**The gap.** Layers carry an inclusive `[minZoom, maxZoom]` range in `layer.config`, applied to the
OL layer by `applyZoomRangeToLayer` (`MapChartRenderer.tsx:201`). As the operator zooms, layers drop
in and out of the map — but `LayersLegendPanel` renders every configured layer identically regardless
of whether it is currently drawing. The panel therefore describes the *configuration*, not the *map*.

- [ ] **ZLGND-V123-01**: The legend panel visually distinguishes layers currently drawing on the map from those that are not
- [ ] **ZLGND-V123-02**: A layer that is not drawing because the current zoom is outside its configured range is visually distinct from one the operator has toggled off with the eye control — the two states must not look the same
- [ ] **ZLGND-V123-03**: A zoom-limited layer shows its configured zoom range, so the operator can see what zoom would bring it back
- [ ] **ZLGND-V123-04**: The indication updates live as the operator zooms, without a reload or a panel re-open
- [ ] **ZLGND-V123-05**: The panel's notion of "currently drawing" matches what OpenLayers actually renders, including the inclusive-vs-exclusive `minZoom` translation — the panel must never mark a layer active at a zoom where the map is not drawing it
- [ ] **ZLGND-V123-06**: The standalone Legend widget (Phase 42) shows the same indication for the map widget it is bound to, and degrades gracefully to today's appearance when that map's live zoom is unavailable
- [ ] **ZLGND-V123-07**: A layer with no configured zoom range continues to render exactly as it does today — no new styling, since it is always active

## Locked decisions (operator, 2026-09-16)

1. **Distinct treatments for the two inactive reasons.** Eye-off keeps today's `hidden` styling.
   Zoom-inactive gets its own dimmed treatment. Rationale: one state the operator chose, one that
   resolves itself by zooming — showing them identically would replace one ambiguity with another.
2. **Show the configured range on zoom-limited rows** (e.g. "zoom 8-14"). The data is already in
   `layer.config`; this turns "why is this faded" into an actionable fact.

## Future Requirements

Acknowledged, deliberately not in v1.23.

- **ZLGND-F1**: Click a zoom-limited row to zoom the map into that layer's range
- **ZLGND-F2**: Show the map's live zoom level in the panel header (considered and not chosen — per-row ranges were preferred)
- **ZLGND-F3**: Warn at config time when a layer's zoom range cannot be satisfied by the map's own min/max zoom

## Carried Tech Debt (still open)

| ID | Item |
|----|------|
| **TLINK-F4** | `lib/tableUrl.ts` / `lib/dashboardUrl.ts` and their hooks are THREE parallel implementations. Extract the shared core when a fourth linkable entity appears, in a phase whose gate permits touching those specs. |
| **TLINK-F3** | Sidebar "Datasets"/"Dashboards" are no-ops while a record is open (`App.tsx` `onSelect` calls `setPage`, a no-op when already on that page). Found in Phase 113 UAT, still open. |
| theme-guard hole | `theme-guard.spec.ts` exempts `global.css` WHOLESALE from its hex scan, so colour literals in that file's rules pass both checks. This is the hole that let Phase 114's `.onboarding-banner` light-mode defect ship. **Directly relevant to this milestone** — any new dimmed/inactive styling lands in exactly that blind spot and needs human verification in both themes. |
| OIDC never browser-verified | The `kbi_returnTo` carry has never been observed across a real IdP redirect; three milestones running (`AUTH_MODE=password` locally). |
| Sync-after-async spec sites | ~105 sites match "sync `getBy*` after `await findBy*`" across 12 spec files. Most are safe; only those asserting on a later React commit break. Fix opportunistically, not as a sweep. See `.planning/v123-flake-investigation-notes.md`. |
| Server `TD-V16-TEST-ISOLATION` | The server's permanent known-failing set is attributed to "cross-mode contamination" — an attribution never tested the way the web suite's just was. The web equivalent turned out to be two one-line async-query defects, not contamination. Worth re-testing before trusting the set-based gate. |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Changing zoom-range CONFIGURATION | This milestone makes existing config legible; `ZoomRangeSlider` and `KineticaWmsLayerForm` are unchanged. |
| Server changes | Everything needed is client-side: `layer.config` already carries the range, `mapCurrentViewStore` already carries live zoom. |
| Auto-zooming the map | Deferred as `ZLGND-F1`. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ZLGND-V123-01 | Phase 118 | Pending |
| ZLGND-V123-02 | Phase 118 | Pending |
| ZLGND-V123-03 | Phase 118 | Pending |
| ZLGND-V123-04 | Phase 118 | Pending |
| ZLGND-V123-05 | Phase 118 | Pending |
| ZLGND-V123-06 | Phase 118 | Pending |
| ZLGND-V123-07 | Phase 118 | Pending |

**Coverage:**
- v1.23 requirements: 7 total
- Mapped to phases: 7 (Phase 118)
