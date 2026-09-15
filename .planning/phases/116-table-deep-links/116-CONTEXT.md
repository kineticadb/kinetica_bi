# Phase 116: Table Deep Links - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A table's view or edit screen is reachable by URL, exactly as a dashboard is.

**In scope:** TLINK-V121-01 … TLINK-V121-07 — the full link lifecycle for tables: write the URL, read it on boot, handle missing/not-permitted, Back, leave-clears, and the logged-out arrival.

**NOT in scope:** Roles and Settings pages (still `DLINK-F4`, still deferred). The `create` table screen (transient, nothing to link to). Filter/viewport state in any URL (`DLINK-F2`/`F3`, still deferred).

**How this phase was scoped — read this before treating anything here as an open question.**

The operator's instruction was explicit: *"Use all the same decisions we did for the dashboard url link… It should not need much input from me as we are continuing to use the same decisions from the last feature."*

So this CONTEXT.md is **almost entirely inherited**. Phases 113, 114 and 115 each ran a full discuss-phase; their decisions were argued, in several cases revised under review, and operator-verified through UAT. Re-opening them here would be re-litigating settled work. The three source documents are canonical refs below and **must be read in full** — this file records only what carries over and what is new.

**Exactly ONE decision is genuinely new** (the view/edit mode qualifier), because `DatasetsPage` has a four-mode state machine where `DashboardsPage` had two. It is decided below, not left open.

</domain>

<decisions>
## Implementation Decisions

### Inherited verbatim from Phases 113-115 — do NOT re-derive

Each of these was settled for dashboards and applies unchanged to tables. The rationale lives in the named source; do not re-argue it, and do not silently diverge from it.

| Decision | Applies as | Source |
|---|---|---|
| Query param, never a path or hash | `?table=<id>` | 113-CONTEXT §"URL shape" |
| Numeric id, never a name/slug | `TableDto.id` (`api/client.ts:403`) | 113-CONTEXT §"Identifier" |
| Opening pushes exactly ONE history entry, marked as ours | same marker approach | 113-CONTEXT §"Back-button behaviour" |
| In-app Back pops that entry; an arrival with NO entry of ours WRITES the list URL instead of popping | **critical — a naive `history.back()` ejects a deep-link arrival out of the app entirely** | 113-CONTEXT §"Back-button behaviour" |
| URL updates immediately on open, before data loads | same | 113-CONTEXT §"URL update timing" |
| Leaving clears the param via `replaceState` | same | 113-CONTEXT (DLINK-V121-07) |
| ONE combined message for missing-or-not-permitted, never two | see non-leak note below | 114-CONTEXT §"Error message" |
| Hold the app-level `Loading…` while a link resolves — never hand off to the page, whose own spinner renders inside the LIST chrome | same | 114-CONTEXT §"While the link resolves" |
| Failure lands on the list with a dismissible banner, and the param is stripped | same | 114-CONTEXT §"Where the error appears" / §"After a failure" |
| Logged-out arrival → login, param left in the bar | same | 115-CONTEXT §"Two hooks left here" |
| Extend `kbi_returnTo`; **NO second sessionStorage key** | same key, extended shape | 115-CONTEXT §"Mechanism" + ROADMAP §115 criterion 2 |
| Single-use, no TTL | same | 115-CONTEXT §"Lifetime" |
| Write on COMMIT for a fresh paste; at INTERRUPTION for an expiry — **deliberately not unified** | same, and for the same reason | 115-CONTEXT §"Write timing" |
| Login banner reuses the existing `.login-banner`; the session-ended message wins when both apply | copy adapted to tables | 115-CONTEXT §"Login page signalling" |
| Restore the param to the address bar after the OIDC round trip | same | 115-CONTEXT §"After the OIDC round trip" |
| Password mode needs no commit-time write (nothing navigates) | **verify this holds for tables before relying on it** | 115-RESEARCH §Q1 |

### THE ONE NEW DECISION — view vs edit in the URL

`DatasetsPage.tsx:17-21` has four modes: `list | view | edit | create`. Dashboards had only list/open, so no prior phase decided this.

**Locked:**
- `?table=12` → **view** mode
- `?table=12&mode=edit` → **edit** mode
- `create` and `list` are **NOT linkable** — `create` has no id to name, and `list` is the bare URL
- The param is absent-means-view: a bare `?table=12` must open view, never edit
- `mode=` with any unrecognised value (`?table=12&mode=banana`) is treated as **view**, not as a failure. Rationale: the id is the identity and it is valid; refusing to open a real table over a typo in a secondary qualifier is worse for the user than quietly showing the safer of the two modes. This mirrors nothing in 113/114 — it is a new call, made here.

Identity stays in ONE param exactly as dashboards do; the mode is a separate qualifier rather than a compound value (`?table=12-edit`), so `readTableIdFromSearch` can share shape with `readDashboardIdFromSearch`.

**Edit mode carries a real hazard the dashboard work never faced:** the edit screen holds unsaved form state. Leaving it via browser Back is now possible in a way it was not before. The planner must decide — and state — whether Back out of an unsaved edit prompts, and if so, reuse the existing `brandPageGuard.isDirty` / `window.confirm` pattern at `App.tsx:349-352` rather than inventing a second one. Do not leave this unaddressed.

### Generalize, do NOT fork

The dashboard implementation is three files deep and operator-verified. A parallel copy for tables would double the surface and guarantee drift.

- `lib/dashboardUrl.ts` — already generic apart from the hardcoded param name. `buildDashboardUrl` takes a `loc` and an id; `isValidDashboardId` is type-only.
- `hooks/useDeepLinkDashboard.ts` — the five-state machine. Its resolution is a LIST lookup (`listDashboards()`); tables have the exact analogue in `listTables()` (`api/client.ts:413`).
- `App.tsx` — the ReturnTo shape, the pending hold, the consumed-once handoff.

**Success criterion 6 is a hard gate:** every Phase 113/114/115 test must still pass, unmodified. If a refactor requires changing a dashboard test, that is a signal the generalization is wrong — stop and report it, exactly as Phase 115 Plan 03 was required to do before amending the one test it touched.

### Non-leak: verify, do not assume

114-CONTEXT's combined-message decision rests on a specific server fact: there is no `GET /api/dashboards/:id`, and the list endpoint is permission-filtered, so a missing id is genuinely ambiguous. **That reasoning is about dashboards.** Whether `/api/tables` has the same shape is an open question for research — check `packages/server/src/index.ts` for a per-table GET route and for whether table visibility is permission-filtered at all (the sidebar does not gate Datasets: `Sidebar.tsx:29`).

If tables are NOT permission-scoped, then "not permitted" may not be a reachable state, and criterion 3 collapses to "not found" alone. **Say so plainly if that is what the code shows** — do not manufacture a permission case that does not exist, and do not weaken a real one.

### Claude's Discretion

- Whether generalization means renaming the existing modules (`lib/deepLinkUrl.ts`) or adding a table-specific layer over shared primitives. Either is fine; the test-preservation gate decides it.
- The exact param names (`table`, `mode`) — assumed throughout, not sacred.
- Banner copy for the login page and the failure banner.
- Whether one plan or several; whether the unsaved-edit guard is its own plan.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read all three prior CONTEXT files in full. This phase's decisions are mostly THEIR decisions.**

### The inherited decisions (binding, read first)
- `.planning/phases/113-dashboard-url-sync/113-CONTEXT.md` — URL shape, numeric id, the Back-button model incl. the no-prior-entry edge case, update timing
- `.planning/phases/114-deep-link-load-error-states/114-CONTEXT.md` — combined message + its security reasoning, the loading-hold rule, failure-lands-on-list, strip-on-failure
- `.planning/phases/115-deep-link-authentication-flow/115-CONTEXT.md` — the `kbi_returnTo` extension, write timing, login banner, OIDC address-bar restore

### Implementation reality of those decisions
- `.planning/phases/115-deep-link-authentication-flow/115-RESEARCH.md` — §Q1 (password mode needs no code, proven by executed test), §Q5 (`reason` is NOT a usable discriminator — do not reach for it), §Q6 (test-infra pitfalls, the `DashboardsPage` stub trap)
- `.planning/phases/113-dashboard-url-sync/113-UAT.md`, `.planning/phases/114-deep-link-load-error-states/114-UAT.md` — what the operator actually verified

### Requirements & scope
- `.planning/REQUIREMENTS.md` — TLINK-V121-01..07 are this phase; `DLINK-F4` records what stays deferred
- `.planning/ROADMAP.md` §"Phase 116" — goal and the 6 success criteria, incl. the no-regression gate

### Project conventions (binding)
- `CLAUDE.md` — UI conventions (**never invent a className**; theme tokens only) AND §"Writing verifiable acceptance criteria"

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/web/src/lib/dashboardUrl.ts`** — `buildDashboardUrl`, `readDashboardIdFromSearch`, `hasDashboardParam`, `isValidDashboardId`, `openDashboardUrl`, `clearDashboardUrl`, `restoreDashboardUrl`, `leaveDashboardUrl`. Nearly all of it is param-name-agnostic already.
- **`packages/web/src/hooks/useDeepLinkDashboard.ts`** — the five-state machine (`none|pending|opened|unavailable|error`), already auth-aware, already accepts a `storedId` for the post-OIDC path.
- **`packages/web/src/App.tsx`** — `type ReturnTo` (now carrying `dashboardId`), `readPendingDashboardId()`, `expiredHereRef`, `handleSignInCommit`, `returnToWonElsewhereRef`, the `loadingShell`, and the consumed-once `deepLinkConsumedRef` handoff.
- **`api/client.ts:413` `listTables()`** — the table analogue of `listDashboards()`, and `TableDto` (`:403`) already carries `id: number`.
- **`App.tsx:349-352`** — the existing unsaved-changes leave-guard (`brandPageGuard.isDirty` + `window.confirm`). Reuse for the edit-mode hazard; do not write a second one.

### Established Patterns
- **`DatasetsPage.tsx:27`** — `const [view, setView] = useState<View>({ mode: "list" })`, with `onBack={() => setView({ mode: "list" })}` at `:44/:54/:61`. Structurally the same shape `DashboardsPage` had before Phase 113 wired it, so the same wiring applies — but note there are FOUR call sites and they are not all the same exit.
- **`DatasetsPage.tsx:47` and `:64`** — after create and after save, the page transitions to `{ mode: "view", table }`. These are mode CHANGES that must also update the URL, a case dashboards did not have.
- **Navigation is plain React state.** `App.tsx` holds `page`; `type Page` includes `"datasets"`. A table deep link must set `page` to `"datasets"`, the way a dashboard link sets it to `"dashboards"`.

### Integration Points
- `App.tsx` — owns the pending hold, the ReturnTo read/write, and the page switch. This is where a table link and a dashboard link must coexist without either winning by accident. **Define the precedence if both params are somehow present.**
- `DatasetsPage.tsx` — owns the view state machine; needs the popstate listener, the open/leave writers, and an `initialOpenTable`-style mount-time lazy capture mirroring `DashboardsPage.tsx:107`.
- `packages/server/src/index.ts` — read-only. Check the `/api/tables` route shape for the non-leak question above; **do not change the server, v1.21 is frontend-only.**

### Known hazards carried from this chain
- **The `DashboardsPage` test-stub trap** (`App.deeplink.spec.tsx:27-32`): a stub reading the initial-open prop plainly FALSELY FAILS against correct code. Mirror the real mount-time `useState(() => prop)` lazy capture. The researcher hit this despite having read the warning.
- **StrictMode double-invoke** — every one-shot flag needs a ref set inside an effect, never in a render body.
- **theme-guard's `global.css` hole** — it exempts that file wholesale from the hex scan, so colour literals in its rules pass. Any banner work needs human eyes in BOTH themes.
- **Toothless grep criteria** — ten occurred across Phase 115's three waves, every one caused by a plan anchoring a grep on a word the plan itself mandated in a comment. **Do not anchor an acceptance criterion on prose the plan dictates.** Anchor on symbols the work introduces, and run every grep before writing it down.

</code_context>

<specifics>
## Specific Ideas

- The originating request: *"lets make the edit/view tables also work with a url using an ID like the dashboard feature. Use all the same decisions we did for the dashboard url link."*
- This was `DLINK-F4`, deferred during Phase 113's discussion as "only dashboards are linkable in v1.21". The operator has now promoted the Tables half of it. Roles and Settings stay deferred.
- v1.21's PROJECT.md locked scope decision 4 read *"Scope held to these two features. Deliberately not padded from the backlog."* This phase is a deliberate operator override of that decision, not an oversight — recorded here so a later reader does not treat it as scope creep that slipped through.

</specifics>

<deferred>
## Deferred Ideas

- **Linkable Roles and Settings pages** — the remainder of `DLINK-F4`. Still deferred.
- **Linkable `create` screen** — nothing to identify; excluded by the mode decision above.
- **Filter state / map viewport in the URL** — `DLINK-F2`, `DLINK-F3`. Unchanged.
- **"Copy link" button** — `DLINK-F1`. The address bar remains sufficient.
- **Sidebar "Dashboards" no-op while a dashboard is open** (`App.tsx:355`) — pre-existing tech debt from Phase 113 UAT, still open, still not this phase. Note the tables equivalent may have the same flaw; if so, record it, do not fix it here.

</deferred>

---

*Phase: 116-table-deep-links*
*Context gathered: 2026-09-14*
