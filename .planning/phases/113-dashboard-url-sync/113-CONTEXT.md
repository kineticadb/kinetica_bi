# Phase 113: Dashboard URL Sync - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

The browser address bar always reflects which dashboard, if any, is open — kept in sync via the native History API, with no routing dependency.

**In scope:** DLINK-V121-01 (opening a dashboard puts a link in the address bar), DLINK-V121-06 (Back returns to the list), DLINK-V121-07 (leaving clears the identifier).

**NOT in scope:** loading a dashboard FROM a URL on app start — that is Phase 114, along with the not-permitted / not-found states. The logged-out deep-link flow is Phase 115. Phase 113 only WRITES the URL and reacts to history navigation; Phase 114 READS it on boot.

</domain>

<decisions>
## Implementation Decisions

### URL shape — query param

`https://<host>/?dashboard=12`

- A **query param**, not a path and not a hash. This follows v1.21's locked decision directly: sync a URL param to `App.tsx`'s existing page state, no router, no App.tsx restructure.
- Works unchanged on every deployment because the server only ever serves `/` — including the plain-`http://` IP host the `local-deploy` kit targets.
- A real path (`/dashboard/12`) was considered and IS technically viable — `docker/nginx.conf:21` already has `try_files $uri /index.html` and Vite's dev server does SPA fallback — but rejected because writing and parsing pathnames on every navigation is most of what a router does, pushing toward the `react-router` dependency v1.21 explicitly declined.
- Hash routing rejected: worst of both, and collides conceptually with in-page anchors.

### Identifier — numeric id

`?dashboard=12`, never a slug.

- Dashboard names are **NOT unique**: `db.ts` declares `name TEXT NOT NULL` with no UNIQUE constraint, and there is no duplicate-name guard on create or rename. A slug-only URL would therefore be genuinely ambiguous — two dashboards named "Sales" produce one URL.
- The numeric id is what the code already uses everywhere, is stable across renames (a link shared last month still resolves after a retitle), and is trivial for Phase 114 to look up.
- An id+slug hybrid (`?dashboard=12-sales-overview`, resolve on the id, treat the slug as decoration) was offered and declined in favour of the simpler form.

### Back-button behaviour — the app's Back IS the browser's Back

- There is no dashboard→dashboard switch in the UI. The only exit from an open dashboard is the "Back to dashboards" button, which calls `setView({ mode: "list" })` (`DashboardsPage.tsx:123/135/148/158`). So the only sequence is list → dashboard → list.
- Opening a dashboard **pushes** one history entry. The in-app "Back to dashboards" button calls **`history.back()`** rather than pushing a second entry, so the app's Back and the browser's Back are the same action and the stack stays shallow: list → A → back → list leaves the user one entry deep, not three.
- Rejected alternative: pushing on every navigation. Uniform and simpler, but the stack grows on each hop, so repeated browser-Back walks backwards re-opening dashboards the user already left — loopy rather than "leaving".
- **Required edge case, and the thing most likely to be got wrong:** a user who arrives directly at `?dashboard=12` (Phase 114's deep link) has NO previous history entry. Calling `history.back()` there would eject them from the application entirely. In that case the Back button must WRITE the list URL instead of popping. Any implementation that does not distinguish these two cases is wrong even if it passes a naive test.

### URL update timing — immediately

- The address bar updates the moment a dashboard is opened, before its widgets finish fetching. View state and URL are then the same thing, with no window in which they disagree and no chance of copying a link that describes the previous screen.
- This matches how the app already behaves: `setView({ mode: "open" })` switches the screen instantly and widgets load into it. A widget whose data fails still leaves the user genuinely ON that dashboard, so the URL keeps telling the truth.
- Rejected: waiting for a "loaded" signal. It would need a definition of loaded that the current code does not have (widgets fetch independently) and creates a lag window where the URL names the wrong screen.

### Claude's Discretion

- The exact param name (`dashboard` assumed throughout, but not sacred).
- Whether the URL-sync logic lives in `App.tsx`, `DashboardsPage.tsx`, or a small dedicated hook/helper — as long as it is testable without a router.
- How `replaceState` vs `pushState` is used for the initial page load.
- Whether the other `View` modes in `DashboardsPage` (create/edit/etc., the other `onBack` call sites) touch the URL at all; DLINK-V121-07 only requires that leaving a dashboard clears the identifier.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs or ADRs exist — this project keeps decisions in the planning docs.

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DLINK-V121-01/-06/-07 are this phase; §"Implementation constraints carried into planning" items 3 and 4 are binding (no routing exists; Phase 7 sessionStorage is the precedent for the later auth flow)
- `.planning/ROADMAP.md` §"Phase 113" — goal and the 3 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.21" — locked scope decisions, notably "no routing dependency" and "dashboard identity only in the URL"

### Project conventions (binding)
- `CLAUDE.md` — UI conventions (never invent a className; theme tokens only) AND §"Writing verifiable acceptance criteria" (a grep guard must read 0 before the work is done; route genuinely unverifiable requirements to a human checkpoint)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `URLSearchParams` + `history.pushState`/`replaceState` + the `popstate` event — all native, no dependency. This is the whole toolkit.
- `docker/nginx.conf:21` — `try_files $uri /index.html` already present. Not needed for the query-param approach, but it is why a path-based URL *would* have worked, and it is worth knowing if DLINK-F4 (linkable Roles/Tables pages) is ever picked up.

### Established Patterns
- **Navigation is plain React state, not routes.** `App.tsx:44-45` holds `const [page, setPage] = useState<Page>("dashboards")` and `const [dashboardViewMode, setDashboardViewMode] = useState("list")`. `type Page` (`App.tsx:30`) has 7 values.
- **`DashboardsPage` has its own view state machine**: `const [view, setViewState] = useState<View>({ mode: "list" })` at `:92`, with several `onBack={() => setView({ mode: "list" })}` call sites (`:123`, `:135`, `:148`, `:158`). Only one of those is the open-dashboard exit; the others are create/edit-style sub-views.
- **A return-to-page mechanism already exists** — Phase 7 (UX-06 / TS-14) writes `{ page, dashboardViewMode }` to `sessionStorage` under a `RETURN_TO_KEY` and restores it after OIDC re-auth (`App.tsx:167-223`). Phase 115 must EXTEND this rather than invent a second mechanism; Phase 113 should avoid doing anything that makes that harder.

### Integration Points
- `App.tsx` — owns `page`/`dashboardViewMode`; a `popstate` listener and the initial read would live at this level or in a helper it calls.
- `DashboardsPage.tsx:92` — owns which dashboard is open; this is where the id to put in the URL comes from.
- There is currently **zero** URL handling in `src/`: no `useNavigate`, `BrowserRouter`, `useSearchParams`, `window.location` or `history.pushState` anywhere. This phase introduces the first.

</code_context>

<specifics>
## Specific Ideas

- The originating request: *"Need a way to provide a url to a dashboard. Right now you have to navigate from the dashboard list page."*
- Backlog phrasing (`.claude/rpToDos.txt`): *"need a way to go straight to a dashboard with a url"*.
- The URL is explicitly a thing people paste to each other — that framing is why the shape decision was treated as the highest-stakes call in this phase.

</specifics>

<deferred>
## Deferred Ideas

- **Explicit "Copy link" button** — `DLINK-F1` in REQUIREMENTS.md Future. The address bar is sufficient for v1.21.
- **Filter state in the URL** — `DLINK-F2`. Holds the v1.4 exclusion on shareable info-selection state; revisit only on a customer ask.
- **Map viewport in the URL** — `DLINK-F3`.
- **Linkable URLs for Roles / Tables / Settings** — `DLINK-F4`. Only dashboards are linkable in v1.21. Note nginx's `try_files` means a future path-based scheme is not blocked by infrastructure.

</deferred>

---

*Phase: 113-dashboard-url-sync*
*Context gathered: 2026-09-11*
