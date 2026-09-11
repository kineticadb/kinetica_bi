# Phase 114: Deep Link Load & Error States - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Visiting or pasting a dashboard URL opens that dashboard directly — or, when it can't, explains why without leaving the user on a blank or broken page.

**In scope:** DLINK-V121-02 (a URL opens the dashboard directly), DLINK-V121-04 (not-permitted), DLINK-V121-05 (not-found).

**NOT in scope:** the logged-out flow — visiting a link while unauthenticated routes through login and lands on the target — is **Phase 115**, which extends Phase 7's `sessionStorage` ReturnTo mechanism. Phase 114 assumes an authenticated session.

</domain>

<decisions>
## Implementation Decisions

### ⚠️ A ROADMAP SUCCESS CRITERION NEEDS AMENDING — read this first

ROADMAP §Phase 114 criterion 2 asks for a distinct **"not permitted"** message, and criterion 3 for a distinct **"not found"** message. **The backend cannot distinguish these, by deliberate design**, so that is not implementable without undoing a security property:

- There is **no `GET /api/dashboards/:id` route at all** (`packages/server/src/index.ts` — only `GET /api/dashboards`, the list).
- The list is permission-filtered server-side: `const visible = all.filter((d) => canViewDashboard(username, d.id))` (`index.ts:783`).
- Every per-dashboard sub-resource answers BOTH cases identically:
  `if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });`
  (`index.ts:879`, and again at `:918`, `:949`, `:1043`).

That conflation is v1.10's non-leak design: a stranger pasting ids must not be able to learn which ones are real. Criterion 2's own second half says "must not leak existence or contents" — so criterion 2 contradicts itself, and the security half wins.

**Operator decision: ONE combined message.** The criterion should be amended to match reality rather than the security design weakened to match the criterion. Whoever updates ROADMAP.md should reword criteria 2 and 3 into a single criterion about an honest combined message.

### Error message — one combined, non-leaking message

- Wording along the lines of: **"This dashboard isn't available — it may have been deleted, or you may not have access."**
- Honest about a genuine ambiguity rather than guessing; preserves the non-leak property; needs **no server change**, keeping v1.21 frontend-only.
- Rejected: two distinct messages (needs a new server route AND tells anyone pasting ids which are real). Also rejected: combined-for-most, distinct-for-admins — two code paths and a server route for a narrow benefit.

### While the link resolves — keep the app-level "Loading…"

- A deep link must boot, authenticate, and fetch the dashboard list before it can open anything. During that window the app keeps showing the **existing** full-screen `Loading…` from `App.tsx:281-282` (`<div className="login-shell"><div className="muted">Loading…</div>`), rather than handing off to the dashboards page.
- **Why this matters:** `DashboardsPage:202` renders its own `Loading dashboards…` INSIDE the list-page chrome, so using the normal path would put the dashboard-list page on screen — exactly what criterion 1 forbids. The user must see one continuous loading state, never a flash of the wrong page.
- Rejected: a dashboard-shaped skeleton (new UI in a milestone that has added none, and it would briefly lie if the link is invalid). Rejected: letting the list appear briefly (the flash criterion 1 exists to prevent).

### Where the error appears — the list, with a banner

- A failed link lands the user on the **dashboard list** with a dismissible banner carrying the combined message. They end up somewhere useful with an obvious next action instead of at a dead end, and it reuses a page that already exists.
- **Note for the planner and the verifier:** this does NOT violate criterion 1. That criterion governs the SUCCESS path ("opens straight into that dashboard, without the dashboard-list page appearing first"). A link that cannot be opened has nowhere better to land. State this distinction explicitly in the plan so it is not later mistaken for a gap.
- Rejected: a full-page error (new UI; a dead end unless it carries a way back, at which point the banner is strictly better). Rejected: a toast (the app has one mounted, but toasts vanish — a user who looks away loses the only explanation and concludes the feature is broken).

### After a failure — strip the param

- When the banner is shown, clear `?dashboard=<id>` from the address bar via `replaceState`, so the URL matches what is on screen.
- Consistent with **DLINK-V121-07**, which Phase 113 spent two review rounds enforcing on every other exit path; leaving it would make the URL describe a view the user is demonstrably not on, and a refresh would silently replay the same error.
- Accepted cost: the failed id is no longer in the URL, so the user cannot trivially retry it or forward it to someone with access.
- Rejected: naming the id in the banner text to preserve it — wordier, and the operator chose the clean strip.

### Claude's Discretion

- Exact banner copy, and whether it is dismissible or persists until navigation.
- Which class the banner reuses — `App.tsx` already renders a `bannerDismissed`-gated banner, so there is likely an existing pattern; find it rather than inventing one.
- How the pending-deep-link state is represented (a flag on App, a small hook, etc.) as long as it is testable without a router.
- Whether an invalid/non-numeric param (`?dashboard=abc`) is treated as "no deep link" or as a failure that shows the banner — pick one and be consistent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs or ADRs — this project keeps decisions in the planning docs.

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DLINK-V121-02/-04/-05 are this phase
- `.planning/ROADMAP.md` §"Phase 114" — goal and success criteria, **criteria 2 and 3 need amending per the note above**
- `.planning/phases/113-dashboard-url-sync/113-CONTEXT.md` — the URL format and History-API decisions this phase consumes
- `.planning/phases/113-dashboard-url-sync/113-UAT.md` — what the operator verified about URL behaviour, and the carried sidebar tech debt

### Project conventions (binding)
- `CLAUDE.md` — UI conventions (never invent a className; theme tokens only) AND §"Writing verifiable acceptance criteria" (a grep guard must read 0 before the work is done)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/web/src/lib/dashboardUrl.ts` (Phase 113) — `readDashboardIdFromSearch`, the URL builders, and `clearDashboardUrl`. **`clearDashboardUrl` is exactly what the strip-on-failure decision needs**; do not write a second one.
- `App.tsx:281-282` — the existing full-screen `Loading…` state to hold during resolution.
- `App.tsx` renders a `bannerDismissed`-gated banner already — find and reuse that pattern for the failure banner rather than inventing UI.
- `useApiQuery` — the established fetch-with-loading/error hook (`DashboardsPage.tsx:90` uses it for `listDashboards`).

### Established Patterns
- **Dashboards are fetched as a LIST, never individually.** `listDashboards()` hits `GET /api/dashboards`, which is already permission-filtered. Resolving a deep link therefore means finding the id within that list — and an id that is absent is indistinguishable between "deleted" and "not permitted", which is precisely why the combined message is the honest one. **This also keeps the phase frontend-only**, as v1.21 requires.
- `DashboardsPage.tsx:92` — `const [view, setViewState] = useState<View>({ mode: "list" })`. Opening a dashboard from a deep link means arriving at `{ mode: "open", dashboard }` without the user clicking.
- Phase 113 wired `openDashboardUrl` / `leaveDashboardUrl` / `clearDashboardUrl` into the open, in-app-back, popstate and unmount paths. A deep-link arrival must NOT double-push a history entry — Phase 113's `kbiDashboardEntry` marker distinguishes an entry the app pushed from one the user arrived on, and 113's in-app Back already handles the no-entry-to-pop case by writing the list URL.

### Integration Points
- `App.tsx` — owns auth bootstrap and the `Loading…` gate; a pending deep link has to suppress the normal page render until resolved. **Phase 113 did not modify App.tsx at all; this phase almost certainly must.**
- `DashboardsPage.tsx` — owns the list fetch and the open/list view state; this is where a resolved id becomes `{ mode: "open" }`.
- `packages/server/src/index.ts:779-785, 879` — read-only for this phase. Understand the 404 conflation; do not change it.

</code_context>

<specifics>
## Specific Ideas

- The originating request: *"Need a way to provide a url to a dashboard. Right now you have to navigate from the dashboard list page."* **This phase is the one that actually delivers that** — Phase 113 only made the address bar reflect the open dashboard.
- During Phase 113's UAT the operator reported check 4 as a FAIL because pasting a URL landed on the list rather than opening the dashboard. That was correct behaviour for 113 and is exactly what 114 fixes. Worth remembering when writing 114's UAT: the operator has already told us what they expect to see.

</specifics>

<deferred>
## Deferred Ideas

- **Logged-out deep link** (route through login, land on the target) — Phase 115, extending Phase 7's `RETURN_TO_KEY` sessionStorage mechanism. Note `type ReturnTo` currently carries only `{ page, dashboardViewMode }` and no dashboard id, so 115 will have to extend that shape.
- **Distinguishing not-found from not-permitted** — would need a new `GET /api/dashboards/:id` and a deliberate decision to leak existence. Rejected here; revisit only if a customer explicitly asks and accepts the tradeoff.
- **"Request access" affordance** on the failure banner — a natural follow-on, but a new capability (and it would leak existence by implication). Not in v1.21.
- **Sidebar "Dashboards" link is a no-op while a dashboard is open** — pre-existing tech debt found during Phase 113 UAT (`App.tsx:248` calls `setPage("dashboards")`, a no-op when already on that page). Unrelated to deep links, but this phase touches `App.tsx`, so whoever works there may be tempted; it is NOT in scope.

</deferred>

---

*Phase: 114-deep-link-load-error-states*
*Context gathered: 2026-09-11*
