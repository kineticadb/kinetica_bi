# Phase 117: Dashboard Settings Links - Context

**Gathered:** 2026-09-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A dashboard's **view** (settings) and **edit** screens are reachable by URL, exactly as a table's are — while a bare `?dashboard=<id>` link keeps opening the running dashboard as it does today.

**In scope:** DSET-V122-01 … DSET-V122-08.

**NOT in scope:** the `create` screen (nothing to identify until the record exists — `DSET-F1`); Roles and Settings pages (`DLINK-F4`); filter state or map viewport in the URL (`DLINK-F2`/`F3`).

**How this phase was scoped.** The operator's instruction was: *"I want to also have the same url feature for the view and edit dashboards so we should be able to use the same decisions from the last feature with its phases."* So this CONTEXT.md is **almost entirely inherited** from Phases 113-116, whose decisions were argued, revised under review, and operator-verified across two UAT rounds. The canonical refs below must be read in full; this file records only what carries over, what is new, and one decision that was explicitly deferred to this phase.

</domain>

<decisions>
## Implementation Decisions

### The gap, precisely

`DashboardsPage.tsx` has FIVE view modes:

```
type View =
  | { mode: "list" }
  | { mode: "view";   dashboard }   ← DashboardDetail  (:180) — NOT linkable today
  | { mode: "edit";   dashboard }   ← DashboardEdit    (:189) — NOT linkable today
  | { mode: "create" }              ← out of scope
  | { mode: "open";   dashboard }   ← DashboardOpen    (:155) — linkable since Phase 113
```

Phase 113 wired `open` only (`openDashboardUrl(dash.id)` at `:240`). Phase 116 gave **tables** the
view/edit treatment. This phase gives dashboards the same, closing the asymmetry.

`DashboardDetail`/`DashboardEdit` are structurally parallel to `TableDetail`/`TableEdit`, including
the after-save `edit → view` transition (`DashboardsPage.tsx:198`, mirroring `DatasetsPage.tsx:64`).
**Phase 116 is the direct template for this work — read `116-03-PLAN.md` before designing anything.**

### Inherited verbatim — do NOT re-derive

| Decision | Source |
|---|---|
| Query param, never a path or hash | 113-CONTEXT §"URL shape" |
| Numeric id, never a name/slug | 113-CONTEXT §"Identifier" |
| Opening pushes exactly ONE history entry, marked as ours | 113-CONTEXT |
| In-app Back pops that entry; an arrival with NO entry of ours WRITES the list URL instead of popping — **a naive `history.back()` ejects a deep-link arrival out of the app entirely** | 113-CONTEXT §"Back-button behaviour" |
| URL updates immediately on open, before data loads | 113-CONTEXT |
| Leaving clears the param via `replaceState` | 113-CONTEXT (DLINK-V121-07) |
| ONE combined message for missing-or-not-permitted, never two | 114-CONTEXT §"Error message" |
| Hold the app-level `Loading…` while a link resolves — never hand off to the page, whose own spinner renders inside the LIST chrome | 114-CONTEXT |
| Failure lands on the list with a dismissible banner, and the param is stripped | 114-CONTEXT |
| Logged-out arrival → login, param left in the bar | 115-CONTEXT |
| Extend `kbi_returnTo`; **NO second sessionStorage key** | 115-CONTEXT §"Mechanism" |
| Single-use, no TTL | 115-CONTEXT §"Lifetime" |
| Write on COMMIT for a fresh paste; at INTERRUPTION for an expiry — **deliberately not unified** | 115-CONTEXT §"Write timing" |
| Login banner reuses the existing `.login-banner`; session-ended message wins when both apply | 115-CONTEXT |
| Restore the param after the OIDC round trip | 115-CONTEXT |
| `setTableMode`-style in-place mode change must pass `window.history.state` THROUGH — not `null`, not a hardcoded marker | 116-RESEARCH §Q3 / Pitfall 3 |
| Unrecognised mode value falls back to the default screen, NOT an error | 116-CONTEXT |
| `create` is not linkable | 116-CONTEXT |

### THE NEW DECISION — a three-mode scheme where tables had two

Tables needed `view`/`edit`. Dashboards need `open`/`view`/`edit`, and **`open` is already live**.

**Locked:**
- `?dashboard=12` → **open** (the running dashboard) — UNCHANGED, and DSET-V122-08 exists to protect it
- `?dashboard=12&mode=view` → the **view/settings** screen (`DashboardDetail`)
- `?dashboard=12&mode=edit` → the **edit** screen (`DashboardEdit`)
- absent `mode` means **open**, not view
- an unrecognised `mode` value falls back to **open** (the bare-URL default), not an error

**Note the deliberate asymmetry with tables:** bare `?table=12` means *view*, bare `?dashboard=12`
means *open*. Both follow the same principle — **a bare URL opens that entity's primary screen** —
but the primary screen differs. A planner tempted to "harmonise" these by changing what bare
`?dashboard=12` does must not: that URL is live in the wild, bookmarked by users, and asserted by
roughly 160 existing tests. Changing it would be a silent breaking change for everyone holding a
link. Record this reasoning in the code, because it will look like an inconsistency to a future reader.

### THE DEFERRED DECISION, NOW DUE — `TLINK-F4`

v1.21 shipped `lib/tableUrl.ts` and `hooks/useDeepLinkTable.ts` as **structural duplicates** of
`lib/dashboardUrl.ts` and `hooks/useDeepLinkDashboard.ts`. That was forced, not chosen: Phase 116's
success criterion required every Phase 113-115 test to pass **unmodified**, and de-duplicating would
have meant import-path edits across 132 tests. The recorded recommendation was:

> *"If a third linkable entity is ever added, extract the shared core THEN, in a phase whose gate permits touching the existing specs."*

**This is the first phase whose gate permits that.** The situation is not exactly what `TLINK-F4`
anticipated — this is a third *mode* on an existing entity, not a third entity — but it is the
moment the question comes due, and ROADMAP criterion 7 requires the outcome be recorded either way.

**This is genuinely open, and it is the main thing research must settle.** Both answers are defensible:
- **Extract now** — three near-identical implementations is where duplication stops being cheap, and this phase touches the dashboard side anyway.
- **Keep duplicated** — an extraction touching both entities' modules and ~160 tests, in the same phase that adds a feature, couples a refactor to a delivery; doing it as its own phase afterwards is safer.

**Research must recommend one with evidence** — measure the real blast radius as Phase 116's research did (it found 132 tests and that number decided the call). Do not assume; count. If the recommendation is "keep duplicated", `TLINK-F4` must be rewritten with the new reasoning rather than left implying it is still pending.

### Claude's Discretion

- The param name for the mode qualifier (`mode` assumed, matching tables).
- Whether the shared core (if extracted) lives in a new module or one of the existing ones.
- Banner copy for the login page and the failure banner.
- Whether one plan or several.
- Whether the dashboard edit form gets an unsaved-changes guard. **If yes, `TLINK-F1` requires doing it for tables in the same phase** — a guard on one form and not the other teaches an inconsistent expectation. Default to neither, matching the Phase 116 operator decision.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these. This phase's decisions are mostly THEIR decisions.**

### The direct template (read first)
- `.planning/phases/116-table-deep-links/116-CONTEXT.md` — the two-mode scheme this extends to three
- `.planning/phases/116-table-deep-links/116-RESEARCH.md` — §Q1 (the sibling-vs-shared analysis and the 132-test measurement), §Q3 (mode transitions, the unsaved-edit hazard), §Q5 (test infra)
- `.planning/phases/116-table-deep-links/116-03-PLAN.md` — the `DatasetsPage` wiring that `DashboardsPage` now mirrors
- `.planning/phases/116-table-deep-links/116-VERIFICATION.md` — what was verified, and criterion 6's honest half-miss

### The inherited decisions
- `.planning/phases/113-dashboard-url-sync/113-CONTEXT.md` — URL shape, identifier, Back model incl. the no-prior-entry edge case
- `.planning/phases/114-deep-link-load-error-states/114-CONTEXT.md` — combined message + security reasoning, loading-hold, strip-on-failure
- `.planning/phases/115-deep-link-authentication-flow/115-CONTEXT.md` — `kbi_returnTo` extension, write timing, login banner, OIDC restore
- `.planning/phases/115-deep-link-authentication-flow/115-RESEARCH.md` — §Q5 (`reason` is NOT a usable discriminator — do not reach for it)

### Requirements & scope
- `.planning/REQUIREMENTS.md` — DSET-V122-01..08, plus the carried tech-debt table
- `.planning/ROADMAP.md` §"Phase 117" — goal and the 7 success criteria
- `.planning/milestones/v1.21-ROADMAP.md` — the archived v1.21 record

### Project conventions (binding)
- `CLAUDE.md` — UI conventions (**never invent a className**; theme tokens only) AND §"Writing verifiable acceptance criteria"

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/web/src/lib/tableUrl.ts`** — the two-mode implementation, including `setTableMode` (the in-place mode-change writer that passes `window.history.state` through). The dashboard equivalent is a near-copy plus a third mode.
- **`packages/web/src/lib/dashboardUrl.ts`** — already has `openDashboardUrl`/`leaveDashboardUrl`/`clearDashboardUrl`/`restoreDashboardUrl`/`buildDashboardUrl`/`isValidDashboardId`. **`buildDashboardUrl` currently takes `(loc, id)` with no mode** — extending it is the natural seam, but note every existing caller passes two args.
- **`packages/web/src/hooks/useDeepLinkTable.ts`** — the mode-aware resolution hook; `useDeepLinkDashboard.ts` is the mode-unaware one this phase extends.
- **`packages/web/src/App.tsx`** — `ReturnTo` already carries `dashboardId`, `tableId`, `tableMode`. A dashboard mode field is the obvious addition. `handleSignInCommit`, `expiredHereRef`, `returnToWonElsewhereRef`, the loading shell and the dashboard-wins precedence guard all already exist.
- **`App.tsx` dashboard-wins precedence guard** — added in Phase 116 in the TABLE effect only. Re-examine it: the rule may need refining now that `?dashboard=` has modes.

### Established Patterns
- **`DashboardsPage.tsx:240`** — `openDashboardUrl(dash.id)` fires on the Open button only. The View (`:243`) and Edit (`:247`) buttons write nothing today.
- **`DashboardsPage.tsx:198`** — after-save `edit → view` transition. Its table twin (`DatasetsPage.tsx:64`) needed the in-place mode writer; this one will too.
- **`DashboardsPage.tsx:160`** — the `open` exit already calls `leaveDashboardUrl()`. The `view`/`edit` exits at `:172`/`:185`/`:195` call plain `setView({ mode: "list" })` with no URL work.
- **`initialOpenDashboard` mount-time lazy capture** (`DashboardsPage.tsx:107`) — must be extended to carry a mode, mirroring `initialOpenTable`.

### Integration Points
- `DashboardsPage.tsx` — owns the five-mode state machine and the popstate listener.
- `App.tsx` — owns the boot resolution, the pending hold, `ReturnTo`, and the precedence rule.
- `packages/server` — **read-only. v1.22 is frontend-only.**

### Known hazards carried from this chain
- **The page-stub test trap** (`App.deeplink.spec.tsx:27-32`): a stub reading the initial-open prop plainly FALSELY FAILS against correct code. Mirror the real `useState(() => prop)` lazy capture. This has now caught a researcher and been re-warned about in four consecutive phases.
- **`history.back()` on an entry we do not own ejects the user from the app.** Use the `leave*Url` pop-vs-write branch; never call `history.back()` directly.
- **StrictMode double-invoke** — every one-shot flag needs a ref set inside an effect, never in a render body.
- **theme-guard exempts `global.css` wholesale** from its hex scan. Any banner work needs human eyes in BOTH themes.
- **TWELVE toothless grep criteria** occurred across Phases 115-116, every one from a plan anchoring a grep on prose the plan itself mandated in a comment. **Never anchor an acceptance criterion on text a plan instructs someone to write.** Anchor on symbols the work introduces; run every grep before writing it down; remember `grep -c` counts LINES, not occurrences.

</code_context>

<specifics>
## Specific Ideas

- The originating request: *"I want to also have the same url feature for the view and edit dashboards so we should be able to use the same decisions from the last feature with its phases."*
- The operator has now asked for this capability three times across three entities (dashboards-open, tables, dashboards-settings). That repetition is itself the argument for resolving `TLINK-F4` rather than adding a third parallel implementation and deferring again.

</specifics>

<deferred>
## Deferred Ideas

- **Linkable `create` screens** — `DSET-F1`. Nothing to identify until the record exists.
- **Roles and Settings links** — the rest of `DLINK-F4`.
- **Unsaved-edit leave guards** — `TLINK-F1`. If added, must cover BOTH the table and dashboard edit forms in the same phase.
- **Filter state / map viewport in the URL** — `DLINK-F2`, `DLINK-F3`.
- **Sidebar no-op while a record is open** — `TLINK-F3`, affecting both Datasets and Dashboards. Pre-existing, still not this phase.
- **Narrowing theme-guard's `global.css` exemption to `:root` blocks** — test-infrastructure fix.

</deferred>

---

*Phase: 117-dashboard-settings-links*
*Context gathered: 2026-09-15*
