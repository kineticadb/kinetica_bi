# Requirements: Kinetica BI — v1.21 Dashboard Links & Map Default View

**Defined:** 2026-09-09
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

## v1.21 Requirements

### Map Default View

- [x] **MAPVIEW-V121-01**: Designer can save a map widget's current zoom and center as that widget's default view, from the map's config
- [x] **MAPVIEW-V121-02**: A map with a saved default view opens at that zoom and center
- [x] **MAPVIEW-V121-03**: A map with no saved default view opens exactly as it does today — world view, `center [0,0]`, `zoom 2`
- [x] **MAPVIEW-V121-04**: Designer can clear a saved default view, returning that map to the world view
- [x] **MAPVIEW-V121-05**: A saved default view survives a dashboard reload
- [x] **MAPVIEW-V121-06**: Each map widget's default view is independent of other map widgets on the same dashboard

### Dashboard Links

- [x] **DLINK-V121-01**: Opening a dashboard puts a link to that dashboard in the browser address bar
- [x] **DLINK-V121-02**: Visiting a dashboard link opens that dashboard directly, without passing through the dashboard-list page
- [ ] **DLINK-V121-03**: Visiting a dashboard link while not authenticated routes to login, then lands on that dashboard once authenticated
- [x] **DLINK-V121-04**: Visiting a link for a dashboard the user is not permitted to view shows a clear message, not a blank or broken page
- [x] **DLINK-V121-05**: Visiting a link for a dashboard that no longer exists shows a clear message
- [x] **DLINK-V121-06**: Browser Back from an open dashboard returns to the dashboard list
- [x] **DLINK-V121-07**: Leaving a dashboard removes that dashboard from the address bar, so the link never describes a view the user is no longer on

### Table Links

Added 2026-09-14 at the operator's request, partially promoting DLINK-F4 out of Future. Every
behavioural decision is INHERITED verbatim from the Dashboard Links work (Phases 113-115) — see
`.planning/phases/116-table-deep-links/116-CONTEXT.md`. The only genuinely new decision is the
view/edit mode qualifier (TLINK-V121-07), because `DatasetsPage` has a four-mode view state
machine where `DashboardsPage` had two.

- [ ] **TLINK-V121-01**: Opening a table puts a link to that table in the browser address bar
- [ ] **TLINK-V121-02**: Visiting a table link opens that table directly, without passing through the tables-list page
- [ ] **TLINK-V121-03**: Visiting a table link while not authenticated routes to login, then lands on that table once authenticated
- [ ] **TLINK-V121-04**: Visiting a link for a table that no longer exists, or that the user is not permitted to see, shows a clear message rather than a blank or broken page
- [ ] **TLINK-V121-05**: Browser Back from an open table returns to the tables list
- [ ] **TLINK-V121-06**: Leaving a table removes that table from the address bar, so the link never describes a view the user is no longer on
- [ ] **TLINK-V121-07**: The link distinguishes view mode from edit mode, so a link opens the same mode it was copied from

## Future Requirements

Acknowledged, deliberately not in v1.21.

### Dashboard Links

- **DLINK-F1**: Explicit "Copy link" button in the dashboard UI — the address bar is sufficient for v1.21
- **DLINK-F2**: URL encodes active filter state, for sharing "this dashboard, filtered to this slice" — would reverse the v1.4 exclusion below; revisit on a customer ask
- **DLINK-F3**: URL encodes each map's viewport
- **DLINK-F4**: Linkable URLs for Roles and Settings — PARTIALLY PROMOTED 2026-09-14: the Tables half became TLINK-V121-01..07 (Phase 116) at the operator's request. Roles and Settings remain deferred.

### Map Default View

- **MAPVIEW-F1**: Auto-fit-to-data as an alternative default — deliberately removed in Phase 12-02; this milestone reintroduces an operator-chosen view, not auto-fit
- **MAPVIEW-F2**: Dashboard-level default view applied to every map at once

## Out of Scope

| Feature | Reason |
|---------|--------|
| `react-router` (or any routing dependency) | The app has no routing today; syncing a URL param to the existing `App.tsx` page state via the native History API delivers the same result without a new dependency or an App.tsx restructure. Locked 2026-09-09. |
| Filter state in the URL | Holds the v1.4 exclusion ("URL/DB persistence of info-selection state — session-only is sufficient"). Deferred as DLINK-F2. |
| Map rotation in the saved default view | Rotation is rarely set deliberately; zoom + center is what was asked for. |
| Saving zoom without center | Would reopen a zoomed map over `[0,0]` — the Atlantic. Rejected during scoping. |
| Additional backlog items (collapsible nav, toolbar sizing, full-screen map, font sizes) | Scope deliberately held to the two requested features rather than padded. |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MAPVIEW-V121-01 | Phase 111 | Complete (111-01/02/03 done 2026-09-09) |
| MAPVIEW-V121-02 | Phase 112 | Complete |
| MAPVIEW-V121-03 | Phase 112 | Complete |
| MAPVIEW-V121-04 | Phase 111 | Complete (world-view fallback landed in Phase 112; operator-verified 2026-09-10) |
| MAPVIEW-V121-05 | Phase 112 | Complete |
| MAPVIEW-V121-06 | Phase 112 | Complete |
| DLINK-V121-01 | Phase 113 | Complete (113-01 code + tests; 113-02 operator UAT approved 6/6 2026-09-11) |
| DLINK-V121-02 | Phase 114 | Complete (114-01/02 code + tests; 114-03 operator UAT approved 6 pass / 1 not exercised (loading state too fast to see, structurally proven instead) / 1 defect found+fixed 2026-09-11) |
| DLINK-V121-03 | Phase 115 | Pending |
| DLINK-V121-04 | Phase 114 | Complete (114-01/02 code + tests; 114-03 operator UAT approved 2026-09-11 — identical banner text confirmed for deleted vs not-permitted, non-leak property also structurally enforced) |
| DLINK-V121-05 | Phase 114 | Complete (114-01/02 code + tests; 114-03 operator UAT approved 2026-09-11) |
| DLINK-V121-06 | Phase 113 | Complete (113-01 code + tests; 113-02 operator UAT approved 6/6 2026-09-11) |
| DLINK-V121-07 | Phase 113 | Complete (113-01 code + tests; 113-02 operator UAT approved 6/6 2026-09-11) |
| TLINK-V121-01 | Phase 116 | Pending |
| TLINK-V121-02 | Phase 116 | Pending |
| TLINK-V121-03 | Phase 116 | Pending |
| TLINK-V121-04 | Phase 116 | Pending |
| TLINK-V121-05 | Phase 116 | Pending |
| TLINK-V121-06 | Phase 116 | Pending |
| TLINK-V121-07 | Phase 116 | Pending |

**Coverage:**
- v1.21 requirements: 20 total
- Mapped to phases: 20 (Phases 111-116)
- Unmapped: 0

## Implementation constraints carried into planning

Found by reading the code on 2026-09-09; planners should not re-derive these.

1. **`MapChartRenderer.tsx:1038` hardcodes `center: [0, 0], zoom: 2`.** Phase 12-02 deliberately removed auto-fit-on-mount and the zoom-to-data button, so MAPVIEW is reintroducing an initial view as an operator-controlled default — not resurrecting auto-fit.
2. **`mapViewportSyncStore` is NOT reusable for MAPVIEW-V121-01.** It publishes only when the per-map "Sync viewport" toggle is on (default off, MAPSYNC-V119-06), and it is keyed by `dashboardId`, not `widgetId` — a single last-writer-wins broadcast slot, not a per-map registry. Reading it would give the wrong map's view, or none at all. The config panel needs its own path to the live view of the map being configured.
3. **No routing exists.** No `react-router` in `packages/web/package.json`; zero uses of `useNavigate` / `BrowserRouter` / `useSearchParams` / `window.location` / `history.pushState` in `src/`. Navigation is `page` + `dashboardViewMode` `useState` in `App.tsx`.
4. **DLINK-V121-03 has a precedent to reuse.** Phase 7 (UX-06 / TS-14) already stores top-level page + dashboard view mode in sessionStorage to return the user to their page after OIDC re-auth. The deep-link-then-login flow should extend that rather than invent a second mechanism.
5. **DLINK-V121-04 must respect v1.10 per-dashboard view permissions.** A link to a dashboard the user cannot see must fail with a message; it must not leak the dashboard's existence or contents.

---
*Requirements defined: 2026-09-09*
