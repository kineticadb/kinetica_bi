# Requirements: Kinetica BI — v1.22 Dashboard Settings Links

**Defined:** 2026-09-15
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

## v1.22 Requirements

### Dashboard Settings Links

Requested by the operator on 2026-09-15: *"I want to also have the same url feature for the view and edit dashboards so we should be able to use the same decisions from the last feature with its phases."*

Every behavioural decision is INHERITED verbatim from the Dashboard Links (Phases 113-115) and
Table Links (Phase 116) work — see `.planning/phases/117-dashboard-settings-links/117-CONTEXT.md`.

**The gap this closes.** `DashboardsPage` has FIVE view modes — `list | view | edit | create | open`.
Phases 113-115 wired exactly one of them: `open`, the running dashboard (`?dashboard=<id>`). The
`view` and `edit` **settings** screens (`DashboardDetail` / `DashboardEdit`,
`DashboardsPage.tsx:180`/`:189`) have no URL at all. Phase 116 gave tables exactly this capability;
dashboards never got it.

- [ ] **DSET-V122-01**: Opening a dashboard's view (settings) screen puts a link to it in the browser address bar
- [ ] **DSET-V122-02**: Opening a dashboard's edit screen puts a link to it in the address bar, distinct from the view link
- [ ] **DSET-V122-03**: Visiting a dashboard settings link opens that screen directly, in the mode the link names, without passing through the dashboard-list page
- [ ] **DSET-V122-04**: Visiting a settings link for a dashboard that no longer exists, or that the user is not permitted to see, shows a clear message rather than a blank or broken page
- [ ] **DSET-V122-05**: Browser Back from a dashboard settings screen returns to the dashboard list, and an arrival with no prior history entry does not eject the user from the app
- [ ] **DSET-V122-06**: Leaving a settings screen removes it from the address bar, so the link never describes a view the user is no longer on
- [ ] **DSET-V122-07**: Visiting a dashboard settings link while not authenticated routes to login, then lands on that screen once authenticated
- [ ] **DSET-V122-08**: A bare `?dashboard=<id>` link continues to open the RUNNING dashboard exactly as it does today — existing links, bookmarks and tests are unaffected

## Future Requirements

Acknowledged, deliberately not in v1.22.

- **DSET-F1**: Linkable `create` screens (dashboard or table) — nothing to identify until the record exists
- **DLINK-F1**: Explicit "Copy link" button — the address bar remains sufficient
- **DLINK-F2**: URL encodes active filter state — holds the v1.4 exclusion; revisit on a customer ask
- **DLINK-F3**: URL encodes each map's viewport
- **DLINK-F4**: Linkable URLs for Roles and Settings pages — the Tables half was delivered in v1.21 Phase 116; Roles and Settings remain deferred
- **TLINK-F1**: Unsaved-edit leave guard for the table edit form — scoped out by operator decision in Phase 116. **If this phase adds one for the dashboard edit form, do it for BOTH or neither** — a guard on one and not the other is worse than none, because it teaches an inconsistent expectation.
- **TLINK-F2**: Revisit the table unavailable-message copy if per-table view permissions are ever added

## Carried Tech Debt (from v1.21, still open)

| ID | Item |
|----|------|
| **TLINK-F4** | `lib/tableUrl.ts` / `hooks/useDeepLinkTable.ts` are structural DUPLICATES of their dashboard siblings. v1.21 could not collapse them because Phase 116's gate required every dashboard test to pass unmodified. **v1.22 is the first phase whose gate permits touching those specs — this is the moment that decision was deferred to.** See the Phase 117 context for the live trade-off. |
| **TLINK-F3** | Sidebar "Datasets" is a no-op while a table is open; the "Dashboards" twin has the same flaw (`App.tsx` `onSelect` calls `setPage`, a no-op when already on that page). Found in Phase 113 UAT, still open. |
| theme-guard hole | `theme-guard.spec.ts` exempts `global.css` WHOLESALE from its hex scan, so colour literals in that file's rules pass both its checks. This is the hole that let Phase 114's `.onboarding-banner` light-mode defect ship. Narrowing the exemption to `:root` blocks only is a test-infrastructure fix, never scheduled. |
| OIDC never browser-verified | The `kbi_returnTo` sessionStorage carry — the entire reason that storage exists — is covered by automated tests and mutation probes but has NEVER been observed working in a browser. Both v1.21 UAT rounds ran in password mode (`AUTH_MODE=password`). Re-verify on the next OIDC deployment. |
| Toothless grep criteria | TWELVE occurred across Phases 115-116, every one from a plan anchoring a grep on prose the plan itself mandated in a code comment. A planner-side defect. **Fix it in this milestone's plans: never anchor a criterion on text a plan instructs someone to write.** |

## Out of Scope

| Feature | Reason |
|---------|--------|
| `react-router` (or any routing dependency) | The app has no routing; syncing a URL param to `App.tsx` page state via the native History API delivers the same result. Locked 2026-09-09, unchanged. |
| Server changes | v1.21 was frontend-only and nothing here needs the server. `packages/server` stays untouched. |
| Changing what bare `?dashboard=<id>` means | It means "open the running dashboard" and it is live in the wild. DSET-V122-08 exists to protect this. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DSET-V122-01 | Phase 117 | Pending |
| DSET-V122-02 | Phase 117 | Pending |
| DSET-V122-03 | Phase 117 | Pending |
| DSET-V122-04 | Phase 117 | Pending |
| DSET-V122-05 | Phase 117 | Pending |
| DSET-V122-06 | Phase 117 | Pending |
| DSET-V122-07 | Phase 117 | Pending |
| DSET-V122-08 | Phase 117 | Pending |

**Coverage:**
- v1.22 requirements: 8 total
- Mapped to phases: 8 (Phase 117)
