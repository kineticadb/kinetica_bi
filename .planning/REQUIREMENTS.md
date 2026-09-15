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
- **DLINK-F4**: Linkable URLs for Roles and Settings pages — the Tables half was delivered in v1.21 Phase 116, the Dashboard-settings half in v1.22 Phase 117; Roles and Settings remain the only deferred parts.
- **TLINK-F1**: Unsaved-edit leave guard for the table edit form — scoped out by operator decision in Phase 116. Phase 117 confirmed the same default for the dashboard edit form (`grep -c "window.confirm" DashboardsPage.tsx` → 1, the pre-existing Delete confirm, unchanged; `grep -rc "dashboardEditGuard"` → 0) — keeping "both or neither" true. **If a guard is ever added, do it for BOTH forms in the same phase** — a guard on one and not the other is worse than none, because it teaches an inconsistent expectation.
- **TLINK-F2**: Revisit the table unavailable-message copy if per-table view permissions are ever added

## Carried Tech Debt (from v1.21, still open)

| ID | Item |
|----|------|
| **TLINK-F4 (resolved 2026-09-15, Phase 117 research §Q1)** | Phase 116 deferred this because dashboards had no mode vocabulary, so a shared core would have needed one entity to invent a concept it didn't have. **Phase 117 closes that gap — dashboards now have a three-value mode vocabulary (`open`/`view`/`edit`) — and a clean extraction shape now exists (117-RESEARCH §Q1, "Shape A": a generic `lib/deepLinkUrl.ts` factory behind thin, name-preserving wrappers).** Phase 117 deliberately did NOT perform the extraction. Measured: the feature already put the dashboard family's **132** tests in play unconditionally, because `buildDashboardUrl`'s arity, `DeepLinkState`'s shape and `initialOpenDashboard`'s prop type all had to change regardless; extracting would have ADDED the already-shipped table family's **100** tests purely for de-duplication, inside the one phase whose highest-stakes requirement (DSET-V122-08) is "do not regress a URL that is live in the wild". Zero of DSET-V122-01..08 required touching a table file, and none was touched. **Shape B (a generic hook core) is NOT recommended even if Shape A is adopted**: the two hooks' unavailable-message reachability differs for a real security reason — dashboards are permission-filtered server-side so "not permitted" is reachable and the combined two-clause message is honest; tables are not, so theirs is deliberately narrowed to one clause. **If a fourth linkable entity or mode is ever proposed, OR a dedicated tech-debt phase is scheduled, extract Shape A then.** The objection that blocked this twice is now gone; only the timing was deferred, not the decision. |
| **DSET-F2** | The `?mode=` query-param key is now shared by `lib/dashboardUrl.ts` and `lib/tableUrl.ts`. `clearDashboardUrl()` deletes it unconditionally, so a hand-crafted `?dashboard=5&table=12&mode=edit` loses the TABLE's qualifier when the dashboard leaves. No UI path produces that URL (dashboard-wins precedence means only one entity ever drives navigation), so this is ACCEPTED and pinned by a regression test in `lib/dashboardUrl.spec.ts` rather than fixed. If a third `?mode=` consumer is ever added, namespace the keys. |
| **DSET-F3** | `DashboardDetail`/`DashboardEdit` each carry their own deferred unmount-clear timer whose guard is scoped on id AND mode, because both screens can unmount during an IN-PLACE mode change on the same id. `DatasetsPage` solved the same hazard differently — one timer on the PAGE. Two shapes for one problem across two files; unify if either is ever refactored. |
| **DSET-F4** | `App.tsx`'s `dashboardViewMode` (Phase-7 era) is write-only from `DashboardsPage`'s perspective — set on every `setView`, consumed only by the `UNAUTHORIZED_EVENT` ReturnTo payload, never fed back in. Phase 117 left it untouched deliberately (its restore path goes entirely through `deepLink`/`ReturnTo.dashboardMode`). Investigate whether it still earns its place. |
| **TLINK-F3** | Sidebar "Datasets" is a no-op while a table is open; the "Dashboards" twin has the same flaw (`App.tsx` `onSelect` calls `setPage`, a no-op when already on that page). Found in Phase 113 UAT, still open. |
| theme-guard hole | `theme-guard.spec.ts` exempts `global.css` WHOLESALE from its hex scan, so colour literals in that file's rules pass both its checks. This is the hole that let Phase 114's `.onboarding-banner` light-mode defect ship. Narrowing the exemption to `:root` blocks only is a test-infrastructure fix, never scheduled. |
| OIDC never browser-verified | The `kbi_returnTo` sessionStorage carry — the entire reason that storage exists — is covered by automated tests and mutation probes but has NEVER been observed working in a browser. v1.21 AND v1.22 UAT rounds all ran in password mode (`AUTH_MODE=password`). Re-verify on the next OIDC deployment. |
| Toothless grep criteria | **TWELVE occurred across Phases 115-116. Phase 117 Plans 01-05 counted EIGHT more, measured directly from each plan's own "Toothless acceptance criteria found and reported" section (Plan 01: 3, Plan 02: 2, Plan 03: 1, Plan 04: 2, Plan 05: 0 — one Plan 05 candidate was checked and confirmed NOT toothless), running total TWENTY across Phases 115-117.** Plan 06 itself found a NINTH: this file's own Traceability table's "Pending" row count was written as 8 by the plan but reads 7 (`grep -c "| Pending |"`, DSET-V122-06's row carries trailing prose that the exact-match pattern doesn't count) — reported here rather than reworded to force the match, bringing Phase 117's total to NINE and the running total to TWENTY-ONE. Every one of these was reported and verified directly per CLAUDE.md's "Writing verifiable acceptance criteria" rather than gamed by editing code/comments to force a grep to pass. Separately: TWENTY mutation probes were run across Plans 01-05 (4+3+4+3+6, one per plan's own count), and every one reddened the suite as intended — zero non-firing (toothless) probes. **Still unfixed as a planner-side defect: never anchor a criterion on text a plan instructs someone to write, and always run the grep/count before writing down its expected number.** |

## Out of Scope

| Feature | Reason |
|---------|--------|
| `react-router` (or any routing dependency) | The app has no routing; syncing a URL param to `App.tsx` page state via the native History API delivers the same result. Locked 2026-09-09, unchanged. |
| Server changes | v1.21 was frontend-only and nothing here needs the server. `packages/server` stays untouched. |
| Changing what bare `?dashboard=<id>` means | It means "open the running dashboard" and it is live in the wild. DSET-V122-08 exists to protect this. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DSET-V122-01 | Phase 117 | Pending (code+tests landed in 117-02, App-level arrival proof in 117-05; stays Pending until the 117-06 operator UAT checkpoint confirms it live, per this project's convention that Complete means code + tests + live verification) |
| DSET-V122-02 | Phase 117 | Pending (code+tests landed in 117-02; stays Pending until 117-06 operator UAT confirms the edit link live) |
| DSET-V122-03 | Phase 117 | Pending (App.tsx mode threading landed in 117-04, App-level no-flash proof in 117-05 Task 1; the actual no-flash claim is structurally provable by jsdom but not eye-provable — stays Pending until 117-06 operator UAT observes it in a real browser) |
| DSET-V122-04 | Phase 117 | Pending (combined-message logic re-verified unchanged in 117-04/117-05; banner legibility in both themes is not grep-provable — stays Pending until 117-06 operator UAT) |
| DSET-V122-05 | Phase 117 | Pending (Back/no-eject wiring landed in 117-02; stays Pending until 117-06 operator UAT confirms live) |
| DSET-V122-06 | Phase 117 | Pending (code+tests landed in 117-03; stays Pending until the 117-06 operator UAT, per this project's convention that Complete means code + tests + live verification) |
| DSET-V122-07 | Phase 117 | Pending (App.tsx ReturnTo/mode threading landed in 117-04; stays Pending until 117-06 operator UAT — Group G is password-mode only on this instance, so the OIDC half cannot be exercised live and will be recorded as such, not as a pass) |
| DSET-V122-08 | Phase 117 | Pending (dedicated audit landed in 117-05 Task 3 — mutation-probe-verified at the lib/hook/page/App layers, 220 tests strictly superset of the 132-test pre-Phase-117 baseline — stays Pending until 117-06 operator UAT checks A2/A4 confirm the bare link live, per this project's convention that a live-in-the-wild URL's protection is not Complete on suite evidence alone) |

**Coverage:**
- v1.22 requirements: 8 total
- Mapped to phases: 8 (Phase 117)
