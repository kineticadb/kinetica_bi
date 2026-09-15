# Phase 117: Dashboard Settings Links - Research

**Researched:** 2026-09-15
**Domain:** Extending an existing, operator-verified, TWICE-shipped client-side URL-sync/deep-link
state machine (React + native History API + sessionStorage) to a THIRD mode on an entity that
already has a mode-agnostic version of the mechanism — no new libraries, no server changes.
**Confidence:** HIGH (every finding below is a direct read of the current tree, cross-checked
against the actual `packages/server/src/index.ts` route table, plus one full `npx vitest run`
execution; nothing here rests on training-data assumptions about this codebase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The gap, precisely.** `DashboardsPage.tsx` has FIVE view modes: `list | view | edit | create | open`.
Phase 113 wired `open` only. This phase gives `view`/`edit` the same URL treatment tables got in
Phase 116, closing the asymmetry. `DashboardDetail`/`DashboardEdit` are structurally parallel to
`TableDetail`/`TableEdit`, including the after-save `edit → view` transition
(`DashboardsPage.tsx:198`, mirroring `DatasetsPage.tsx:64`).

**Inherited verbatim — do NOT re-derive:**

| Decision | Source |
|---|---|
| Query param, never a path or hash | 113-CONTEXT |
| Numeric id, never a name/slug | 113-CONTEXT |
| Opening pushes exactly ONE history entry, marked as ours | 113-CONTEXT |
| In-app Back pops that entry; an arrival with NO entry of ours WRITES the list URL instead of popping | 113-CONTEXT |
| URL updates immediately on open, before data loads | 113-CONTEXT |
| Leaving clears the param via `replaceState` | 113-CONTEXT (DLINK-V121-07) |
| ONE combined message for missing-or-not-permitted, never two | 114-CONTEXT — **and, unlike tables, this reasoning STILL HOLDS for dashboards: re-verified below, Q2 addendum** |
| Hold the app-level `Loading…` while a link resolves | 114-CONTEXT |
| Failure lands on the list with a dismissible banner, and the param is stripped | 114-CONTEXT |
| Logged-out arrival → login, param left in the bar | 115-CONTEXT |
| Extend `kbi_returnTo`; **NO second sessionStorage key** | 115-CONTEXT |
| Single-use, no TTL | 115-CONTEXT |
| Write on COMMIT for a fresh paste; at INTERRUPTION for an expiry — deliberately not unified | 115-CONTEXT |
| Login banner reuses `.login-banner`; session-ended message wins when both apply | 115-CONTEXT |
| Restore the param after the OIDC round trip | 115-CONTEXT |
| `setTableMode`-style in-place mode writer must pass `window.history.state` THROUGH | 116-RESEARCH §Q3 / Pitfall 3 |
| Unrecognised mode value falls back to the default screen, NOT an error | 116-CONTEXT |
| `create` is not linkable | 116-CONTEXT |

**THE NEW DECISION — a three-mode scheme where tables had two (LOCKED, not open for re-derivation):**
- `?dashboard=12` → **open** (UNCHANGED) — DSET-V122-08 protects this
- `?dashboard=12&mode=view` → **view/settings** (`DashboardDetail`)
- `?dashboard=12&mode=edit` → **edit** (`DashboardEdit`)
- absent `mode` means **open**, not view (deliberate asymmetry with tables, where bare `?table=12` means view — both follow "a bare URL opens that entity's primary screen," but the primary screen differs)
- an unrecognised `mode` falls back to **open**, not an error

**THE DEFERRED DECISION, NOW DUE — `TLINK-F4`:** resolved below in Q1, with a rewritten entry
provided for `.planning/REQUIREMENTS.md`.

### Claude's Discretion

- The param name for the mode qualifier (`mode` assumed, matching tables — confirmed the only sane choice, see Q1's collision note).
- Whether the shared core (if extracted) lives in a new module or one of the existing ones.
- Banner copy for the login page and the failure banner.
- Whether one plan or several.
- Whether the dashboard edit form gets an unsaved-changes guard. If yes, `TLINK-F1` requires doing it for tables in the same phase. **Default to neither, matching the Phase 116 operator decision** — confirmed still the right default below (Q3).

### Deferred Ideas (OUT OF SCOPE)

- Linkable `create` screen (`DSET-F1`)
- Linkable Roles/Settings pages (`DLINK-F4`)
- Unsaved-edit leave guards (`TLINK-F1`) — unless both forms done together
- Filter state / map viewport in the URL (`DLINK-F2`/`F3`)
- Sidebar no-op while a record is open (`TLINK-F3`)
- Narrowing theme-guard's `global.css` exemption

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| DSET-V122-01 | Opening a dashboard's view screen puts a link in the address bar | Q2 — `openDashboardUrl(dash.id, "view")` from the list's View button (`:243`, currently a plain `setView`, no URL work) |
| DSET-V122-02 | Opening the edit screen puts a distinct link | Q2 — `openDashboardUrl(dash.id, "edit")` from the list's Edit button (`:247`), **plus a second, no-table-analogue path**: `DashboardDetail`'s own Edit button (`:186`) triggers an IN-PLACE `view→edit` transition that also needs a URL write (Q3) |
| DSET-V122-03 | Visiting a link opens directly, in the named mode, no list flash | Q2/Q3/Q4 — extend `useDeepLinkDashboard`'s `DeepLinkState` with a `mode` field, extend `initialOpenDashboard` to `{dashboard, mode}`, extend `DashboardsPage`'s mount-time lazy capture to honour it |
| DSET-V122-04 | Missing/not-permitted shows a clear message | Q2 addendum — **re-verified, and unlike tables, the combined message's underlying reasoning is UNCHANGED**: `GET /api/dashboards/:id` still does not exist; `GET /api/dashboards` is still permission-filtered (`index.ts:780`, `canViewDashboard`). No new work beyond what `useDeepLinkDashboard` already does. |
| DSET-V122-05 | Back returns to the list; no-prior-entry doesn't eject | Q2/Q3 — `leaveDashboardUrl()` (unchanged writer) called from `DashboardDetail`'s and `DashboardEdit`'s `onBack`, currently plain `setView` calls with no URL work |
| DSET-V122-06 | Leaving removes it from the address bar | Q3 — **a genuinely new gap**: only `DashboardOpen` has a deferred unmount-clear timer today; `DashboardDetail`/`DashboardEdit` have none and need one each |
| DSET-V122-07 | Logged-out visit routes to login, lands on the screen after auth | Q4 — extend `ReturnTo` with `dashboardMode?: "view"\|"edit"`, extend `readPendingDashboardId`/`handleSignInCommit`/the restore effect/the dashboard-open effect, mirroring the table sibling additions from Phase 116 |
| DSET-V122-08 | Bare `?dashboard=<id>` keeps opening the running dashboard, unmodified | Q2/Q5 — the 13-test `DashboardsPage.urlsync.spec.tsx` "open" suite plus the 132-test dashboard family is the concrete regression surface; none of it exercises view/edit today, so none of it needs to change ASSERTIONS (only some call-site *shapes*, see Q5) |

</phase_requirements>

---

## Summary

The mechanism itself needs no new design: every locked decision from 113-115 (URL shape, marker,
Back model, combined error message, `kbi_returnTo` extension, write timing) ports to dashboards'
view/edit exactly as it ported to tables in Phase 116, and the code that already runs it
(`lib/dashboardUrl.ts`, `hooks/useDeepLinkDashboard.ts`) is not a sibling to write from scratch —
it is the SAME entity's existing, in-production files, which this phase must edit in place
regardless of any other decision, because `open` mode's behaviour (DSET-V122-08) has to keep
working unchanged while `view`/`edit` are added alongside it in the same five-state machine.

**Q1, the question CONTEXT.md calls "the main thing research must settle," has a firm answer:**
measured against the CURRENT tree, extending dashboards to a three-mode scheme touches the SAME
132-test dashboard family Phase 116 already measured (`lib/dashboardUrl.spec.ts` 39,
`hooks/useDeepLinkDashboard.spec.ts` 16, `components/DashboardsPage.urlsync.spec.tsx` 13,
`App.spec.tsx` 38, `App.deeplink.spec.tsx` 16, `App.passwordDeepLink.spec.tsx` 3,
`App.signincommit.spec.tsx` 7) — and it touches ALL of it **unconditionally**, because the feature
itself (not any refactor) requires changing `buildDashboardUrl`'s arity, `DeepLinkState`'s shape,
and `initialOpenDashboard`'s prop type. Extracting a shared core between dashboards and tables NOW
would ADD the table family's 100 tests (`lib/tableUrl.spec.ts` 50, `hooks/useDeepLinkTable.spec.ts`
18, `components/DatasetsPage.urlsync.spec.tsx` 17, `App.tableDeeplink.spec.tsx` 12,
`App.tablePasswordDeepLink.spec.tsx` 3) to the phase's blast radius, PURELY for de-duplication —
none of DSET-V122-01..08 requires touching a single table file. **Recommendation: keep duplicated.**
Extend `dashboardUrl.ts`/`useDeepLinkDashboard.ts`/`DashboardsPage.tsx` in place (mirroring
`tableUrl.ts`'s already-proven three-mode-capable shape), touch zero table files, and land the
extraction as its OWN follow-on phase if it's ever wanted — full reasoning, two concrete extraction
shapes, and a rewritten `TLINK-F4` are in Q1.

**Q2 finds the transition table in CONTEXT.md is incomplete** — verified against the current file
line-by-line, dashboards need **13 URL-touching transitions**, not 8 (tables' count). The extra five
come from: (a) `open` staying separate (it needs zero changes, but that's still one more state to
carry through every switch statement than tables had), and (b) **one transition with no table
analogue at all**: `DashboardDetail` has its own in-app Edit button (`:186`,
`onEdit={() => setView({ mode: "edit", ... })}`) that TableDetail structurally cannot have (116-
RESEARCH's own comment says so: "TableDetail has no Edit affordance"). This is a genuine `view→edit`
IN-PLACE transition — the mirror image of the already-known `edit→view` after-Save transition — and
it means dashboards need the `setTableMode`-style in-place writer called from **two** sites, not one.

**Q3 confirms the mode-preservation writer generalizes cleanly** to both directions, and finds a
second, genuinely new gap CONTEXT.md does not mention: **`DashboardDetail`/`DashboardEdit` have NO
deferred unmount-clear timer today** — only `DashboardOpen` has one (baked into its existing
13-store-reset effect). Two new, small, `DashboardOpen`-mirroring timers are needed.

**Q4 confirms the "dashboard wins" precedence rule needs NO changes** — it operates on
`deepLink.status`, which is mode-agnostic, so adding a third mode to the dashboard side doesn't
touch the table-effect's guard clause at all. What DOES need to change is the dashboard's OWN
effect, which today hardcodes `setDashboardViewMode("open")` on every successful resolution — that
must become `deepLink.mode`.

**Q5 confirms the page-stub trap applies again** (this makes the third consecutive phase to hit it)
and gives the current baseline: **175 files / 3902 tests, 100% green**, executed this session.

**Primary recommendation:** extend `lib/dashboardUrl.ts` in place with a `DashboardMode = "open" |
"view" | "edit"` type, an optional third `mode` parameter on `buildDashboardUrl`/`openDashboardUrl`/
`restoreDashboardUrl` (default `"open"`, so every existing 2-arg call site keeps compiling
unchanged), a `readDashboardModeFromSearch`, and a `setDashboardMode` writer identical in shape to
`tableUrl.ts`'s `setTableMode`; extend `useDeepLinkDashboard.ts`'s `DeepLinkState` with a `mode`
field on `"pending"`/`"opened"`; wire all 13 `DashboardsPage.tsx` transitions per Q2's table; add the
two missing deferred unmount-clear timers per Q3; extend `App.tsx`'s `ReturnTo`/
`readPendingDashboardId`/`handleSignInCommit`/the two dashboard-related effects with `dashboardMode`
per Q4 — all IN THE SAME FILES Phase 113-116 already own, none of it forking into a new module, and
NONE of it touching `lib/tableUrl.ts`, `hooks/useDeepLinkTable.ts`, or `DatasetsPage.tsx`.

---

## Q1 — `TLINK-F4`: extract the shared core now, or keep duplicated? (measured, not asserted)

**Confidence: HIGH.** Every count below is a direct `grep`/`wc -l` against the current tree,
2026-09-15, branch `chore/ci-and-release-process`.

### The situation is NOT what `TLINK-F4` originally anticipated

`TLINK-F4` was written expecting "a third linkable entity" to be the trigger for revisiting
duplication. Phase 117 is not that — it's a third **mode** on the entity that already has the
mechanism's original implementation. This matters because **there is no "sibling module" option
here the way there was for tables in Phase 116.** Tables could get a brand-new `lib/tableUrl.ts`
that touched zero dashboard files, because a table had never had ANY deep-link code before. A
dashboard's `open` mode is not new — `lib/dashboardUrl.ts` and `hooks/useDeepLinkDashboard.ts` ARE
the files that implement it today, in production, and DSET-V122-08 requires `open` to keep working
UNCHANGED while `view`/`edit` are added beside it in the same functions and the same state machine.
**These two files are being edited by this phase no matter what Q1 concludes.** The only real
question is whether that edit ALSO reaches into `lib/tableUrl.ts`/`hooks/useDeepLinkTable.ts` to
collapse them with the dashboard versions.

### The measurement

**Files that import `lib/dashboardUrl.ts` or `hooks/useDeepLinkDashboard.ts` (the "dashboard
family" — touched by this phase regardless of Q1's outcome):**

| File | Tests | Why it's touched by the FEATURE, not by any refactor choice |
|---|---|---|
| `lib/dashboardUrl.spec.ts` | 39 | new mode-aware functions need new test coverage |
| `hooks/useDeepLinkDashboard.spec.ts` | 16 | `DeepLinkState`'s shape gains a `mode` field |
| `components/DashboardsPage.urlsync.spec.tsx` | 13 | `initialOpenDashboard`'s prop TYPE changes from `DashboardDto` to `{dashboard, mode}` — verified: `DashboardsPage.urlsync.spec.tsx:264,280` currently do `initialOpenDashboard={DASH_77}` (a bare `DashboardDto`), which will not compile against the new shape |
| `App.spec.tsx` | 38 | `ReturnTo`'s shape gains `dashboardMode` |
| `App.deeplink.spec.tsx` | 16 | its `DashboardsPage` stub types `initialOpenDashboard?: {id:number}` and reads `captured.id` — must become `captured.dashboard.id` to match the new shape (same page-stub trap as Q5) |
| `App.passwordDeepLink.spec.tsx` | 3 | exercises the same boot-time initializer whose payload shape changes |
| `App.signincommit.spec.tsx` | 7 | `handleSignInCommit`'s payload gains a conditional `dashboardMode` field; 2 of its 7 tests (`:115`, `:128`) assert a CLOSED `toEqual({ dashboardId: 12, page: "dashboards" })` shape — see Q4 for why these stay green |
| **Total, unconditionally in play** | **132** | |

**Files that import `lib/tableUrl.ts` or `hooks/useDeepLinkTable.ts` (the "table family" —
ONLY touched if Q1's answer is "extract a shared core spanning both entities"):**

| File | Tests |
|---|---|
| `lib/tableUrl.spec.ts` | 50 |
| `hooks/useDeepLinkTable.spec.ts` | 18 |
| `components/DatasetsPage.urlsync.spec.tsx` | 17 |
| `App.tableDeeplink.spec.tsx` | 12 |
| `App.tablePasswordDeepLink.spec.tsx` | 3 |
| **Total, ONLY in play under extraction** | **100** |

(`App.spec.tsx` does not import either table module — no double-count. Baseline for both families
combined plus everything else in the suite: **175 files / 3902 tests, 100% green**, Q5.)

### Two concrete extraction shapes, evaluated

**Shape A — generic URL-helper factory, thin re-export wrappers.** A new `lib/deepLinkUrl.ts`
exporting `createUrlHelpers<M extends string>(cfg: { idParam: string; modeParam: string;
historyMarker: string; defaultMode: M; parseMode: (raw: string | null) => M })` returning
`{ isValidId, readIdFromSearch, readModeFromSearch, hasParam, buildUrl, openUrl, clearUrl,
restoreUrl, setMode, leaveUrl }`. `lib/dashboardUrl.ts` and `lib/tableUrl.ts` become ~15-line files
that call the factory once and re-export under their EXISTING names — this is now genuinely
mechanical, because the objection that killed this shape in 116-RESEARCH ("tables need a mode
qualifier dashboards have no equivalent for") no longer holds: dashboards need one too. Because the
public names/signatures can be preserved exactly, this shape is plausible WITHOUT forcing edits to
any spec file beyond what the feature needs anyway. Real cost: an id-validation bug, a marker-
preservation bug, or a query-param-collision bug (see the "mode" namespace note below) now lives in
ONE function serving BOTH entities — a mistake here has a blast radius across dashboards AND
tables, including the 100 already-shipped, already-UAT-verified table tests, inside a phase whose
single highest-stakes protected requirement (DSET-V122-08) is specifically about NOT regressing a
URL that is "live in the wild."

**Shape B — generic hook core too.** Extends Shape A to also genericize
`useDeepLinkDashboard`/`useDeepLinkTable` via `useDeepLinkEntity<T, M>(cfg: {...})`. **Not
recommended even if Shape A is adopted.** The "opened" payload's field name differs
(`dashboard` vs `table`) and — more importantly — the unavailable-message's REACHABILITY differs
for a real, documented business/security reason: dashboards are permission-filtered server-side
(`canViewDashboard`, `index.ts:780`) so "not permitted" is a real, reachable state and the combined
two-clause message is honest; tables are NOT permission-scoped (116-RESEARCH §Q2), so tables'
message is deliberately narrowed to one clause. Each hook's header comment is ~15 lines of
load-bearing "why," specific to that entity's permission model. Forcing both through one generic
hook would either duplicate that reasoning at every call site (defeating the point of extraction)
or flatten it into a parameter that reads as arbitrary out of context. Keep the hooks as separate
files under either Shape A or "keep duplicated."

### Recommendation: KEEP DUPLICATED for this phase

Weighing the trade-off CONTEXT.md asks for directly:

- **The feature does not need it.** Zero of DSET-V122-01..08 requires touching `tableUrl.ts`,
  `useDeepLinkTable.ts`, or `DatasetsPage.tsx`. Everything the eight requirements need lives inside
  files this phase edits regardless.
- **The highest-stakes protected requirement argues for the narrowest surface.**
  DSET-V122-08 exists because the bare URL is live in production and bookmarked. A mistake
  introduced into a SHARED core doesn't just risk a dashboard regression — it risks the ALREADY-
  SHIPPED table feature too (also presumably live in the wild, per the same reasoning). Keeping
  the entity families independent means a mistake in dashboard mode support cannot silently
  regress tables, and vice versa. This is the same logic 116-CONTEXT itself used to justify
  duplication under a LOOSER constraint (avoiding edits to dashboard's OWN tests); it applies with
  MORE force here, because now the risk is to a second entity's shipped behavior, not just its tests.
- **A dedicated follow-on phase is the fairer venue for a refactor.** An extraction phase would
  have a clean, narrow, independently-reviewable diff (`lib/deepLinkUrl.ts` + two thin wrappers,
  zero feature-shaped changes mixed in) and could ship AFTER this phase's operator UAT re-confirms
  dashboard mode links work — de-risking the refactor by not needing to prove a brand-new feature
  and an internal restructuring correct in the same review pass.
- **The counter-argument is real and should not be dismissed:** the codebase now has THREE fully
  worked implementations of "a mode-aware, marked-history-entry, replaceState-preserving URL sync"
  (dashboard: open/view/edit, table: view/edit) once this phase ships, and duplication cost is no
  longer "would need one entity to invent a concept it doesn't have" (116's blocker) — that
  objection is gone. If a FOURTH linkable entity or mode is ever proposed, the case for extraction
  becomes very strong and the "not yet, the objection still applies" excuse will no longer be
  available.

### One collision risk to flag regardless of Q1's outcome

`tableUrl.ts`'s own header comment already warns about this: *"Generic name, owned exclusively by
this module today (grep confirms no other `?mode=` consumer in packages/web/src) — if one is ever
added elsewhere, buildTableUrl's delete/set of this param becomes a collision."* **Phase 117 is
that "elsewhere."** Both `dashboardUrl.ts` (new) and `tableUrl.ts` (existing) will read/write the
SAME literal `"mode"` query-param key from the SAME `window.location.search`. Because "dashboard
wins" precedence (Q4) means only one entity's resolution ever actually drives `setPage`, this
cannot currently produce a WRONG navigation — but `clearTableUrl()`/the new `clearDashboardUrl()`
each unconditionally delete `mode` when clearing their OWN id param, so a hand-crafted
`?dashboard=5&table=12&mode=edit` (no UI path produces this; confirmed by 116-RESEARCH §Q4) would,
if the dashboard leaves, ALSO silently strip the table's `mode=edit` qualifier as a side effect.
This is a genuinely reachable-only-by-hand-editing-the-URL edge case, not a user-facing defect —
**recommend documenting it with a one-line comment at both `clearDashboardUrl()` and
`clearTableUrl()`** (pointing at each other) rather than engineering a cross-module namespace
check for a hand-crafted-URL-only scenario, and write ONE regression test proving today's actual
(accepted) behavior so a future reader sees it was noticed, not missed.

### `TLINK-F4` — rewritten entry for `.planning/REQUIREMENTS.md`

Replace the current `TLINK-F4` row with:

> **TLINK-F4 (resolved 2026-09-15, Phase 117 research):** Phase 116 deferred this because
> dashboards had no mode vocabulary, so a shared core would have needed one entity to invent a
> concept it didn't have. **Phase 117 closes that gap — dashboards now have a three-value mode
> vocabulary (`open`/`view`/`edit`) — and a clean extraction shape now exists (see 117-RESEARCH
> §Q1, "Shape A").** Phase 117 deliberately did NOT perform the extraction: none of DSET-V122-01..08
> required it, and doing it in the same phase as a feature whose single highest-stakes requirement
> (DSET-V122-08) is "do not regress a URL that is live in the wild" would have put the ALREADY-
> SHIPPED table feature's 100 tests in play for a pure refactor. **If a fourth linkable entity/mode
> is ever proposed, OR a dedicated tech-debt phase is scheduled, extract `lib/deepLinkUrl.ts`'s
> generic core then — the objection that blocked this twice is now gone, only the timing was
> deferred, not the decision itself.**

---

## Q2 — The complete transition table, and `buildDashboardUrl`'s least-churn mode extension

**Confidence: HIGH — every line number below is a fresh `grep -n` against the current
`DashboardsPage.tsx` (1756 lines) and `lib/dashboardUrl.ts`.**

### CONTEXT.md's list, verified and completed

CONTEXT.md names `:155, :172, :180, :185, :189, :195, :198, :240, :243, :247, :160` and explicitly
says "do not trust this list." Cross-checked against the file: those line numbers correspond to
real code (the render-branch openers and the button/handler lines), but **the list omits at least
two things**: the `DashboardDetail`→`DashboardEdit` in-app Edit affordance (no table analogue,
found at `:186`) and the `create`→`view` first-linkable-moment push (which tables DID need and
CONTEXT's own dashboard list skips). Full, verified enumeration:

| # | Transition | Trigger (current line) | Current code | URL action needed |
|---|---|---|---|---|
| 1 | list → open | Open button `:240` | `openDashboardUrl(dash.id); setView({mode:"open",...})` | **ALREADY WIRED, UNCHANGED** — bare id, no mode param |
| 2 | list → view | View button `:243` | `setView({ mode: "view", dashboard: dash })` (no URL call) | `openDashboardUrl(dash.id, "view")` — push, marked |
| 3 | list → edit | Edit button `:247` | `setView({ mode: "edit", dashboard: dash })` (no URL call) | `openDashboardUrl(dash.id, "edit")` — push, marked |
| 4 | list → create | New Dashboard `:211` | `setView({ mode: "create" })` | none — create not linkable |
| 5 | create → view | `DashboardCreate.onSaved`, called at `:173-175` | `setView({ mode: "view", dashboard: created })` | `openDashboardUrl(created.id, "view")` — push. **First-ever linkable moment for a fresh dashboard**, exactly analogous to tables' create→view case (116-CONTEXT flagged this for tables; the dashboard list in 117-CONTEXT omits it) |
| 6 | create → list | `DashboardCreate.onBack`, `:172` | `setView({ mode: "list" })` | none |
| 7 | open → list | `DashboardOpen.onBack`, `:160` | `leaveDashboardUrl(); setView({mode:"list"})` | **ALREADY WIRED, UNCHANGED** |
| 8 | view → list | `DashboardDetail.onBack`, `:185` | `setView({ mode: "list" })` (no URL call) | `leaveDashboardUrl()` |
| 9 | **view → edit** | **`DashboardDetail.onEdit`, `:186`** | `setView({ mode: "edit", dashboard: view.dashboard })` | **`setDashboardMode(dashboard.id, "edit")`. NO TABLE ANALOGUE — `TableDetail` has no Edit affordance (116-RESEARCH's own comment says so); `DashboardDetail` does (`canEdit && <button onClick={onEdit}>Edit</button>`, `:296`). In-place, same entry, preserves whatever marker state was already there — the SAME hazard class as #11 below, just the opposite direction.** |
| 10 | edit → list | `DashboardEdit.onBack`, `:195` | `setView({ mode: "list" })` (no URL call) | `leaveDashboardUrl()` |
| 11 | **edit → view** | `DashboardEdit.onSaved`, called at `:196-198` | `setView({ mode: "view", dashboard: updated })` | `setDashboardMode(updated.id, "view")` — in-place. **Reachable from TWO origins** (a fresh list→edit push, OR an in-place view→edit per #9) — one call site handles both, because `setDashboardMode` preserves whatever `window.history.state` already was, exactly like `setTableMode` |
| 12 | *(no UI transition — verified)* | `DashboardOpen.onDashboardUpdated`, `:161-162` | `setView({ mode: "open", dashboard: updated })` | **none — confirms Q3's question below: `open` never transitions to `view`/`edit` in place, and nothing transitions INTO `open` except the list's Open button or a fresh deep-link arrival** |
| 13 | *(new, no prior precedent)* | Unmount of `DashboardDetail`/`DashboardEdit` while a view/edit URL is live | *(nothing today)* | Two NEW deferred unmount-clear timers, mirroring `DashboardOpen`'s existing one — see Q3 |

**Total: 13 URL-touching (or deliberately-not-touching) sites**, vs. tables' 8. The five extra:
`open`'s two already-done sites (kept in the count for completeness, since a planner must still
verify they're untouched), the create→view push CONTEXT's list omitted, the view→edit in-place
transition with no table analogue, and the new unmount-clear requirement.

### `buildDashboardUrl(loc, id)` — least-churn mode extension

Verified: `buildDashboardUrl` is called with exactly 2 arguments at its 3 internal call sites inside
`lib/dashboardUrl.ts` itself (`openDashboardUrl`, `clearDashboardUrl`, `restoreDashboardUrl`) plus
5 direct calls inside `lib/dashboardUrl.spec.ts`. **No caller outside `lib/dashboardUrl.ts` calls it
directly** (`grep -n "buildDashboardUrl("` across `components/DashboardsPage.tsx`,
`hooks/useDeepLinkDashboard.ts`, `App.tsx` returns nothing — all three consume the higher-level
writers, never the builder). The least-churn extension is a third, OPTIONAL, DEFAULTED parameter:

```typescript
export type DashboardMode = "open" | "view" | "edit";

export function buildDashboardUrl(
  loc: { pathname: string; search: string; hash: string },
  id: number | null,
  mode: DashboardMode = "open",   // NEW — defaulted, so all 8 existing 2-arg call sites (3 in the
                                   // module, 5 in the spec) keep compiling with zero edits.
): string {
  const params = new URLSearchParams(loc.search);
  if (id === null) {
    params.delete(DASHBOARD_URL_PARAM);
    params.delete(DASHBOARD_MODE_PARAM);
  } else {
    params.set(DASHBOARD_URL_PARAM, String(id));
    if (mode === "open") params.delete(DASHBOARD_MODE_PARAM);   // open = absence, the bare-URL default
    else params.set(DASHBOARD_MODE_PARAM, mode);
  }
  ...
}
```
This is byte-for-byte the same shape `buildTableUrl` already uses, just with `"open"` (not
`"view"`) as the absence-representing default — confirming CONTEXT's own framing that the
asymmetry is a single swapped constant, not a structural difference.

### The bare-URL regression surface DSET-V122-08 protects

`components/DashboardsPage.urlsync.spec.tsx`'s first `describe` block (lines 117-247, 10 tests,
prefixed `URLSYNC-113:`) exercises `open` mode EXCLUSIVELY — clicking Open, browser Back/Forward,
unmount-clear, StrictMode double-invoke, the stale-unmount-timer guard — and asserts on the address
bar reading exactly `?dashboard=<id>` with no `mode` param anywhere. None of these assertions need
to change (they describe `open`'s behavior, which is unchanged), but the file's imports and
supporting fixtures ARE touched anyway per Q1's table (its second `describe` block, `DEEPLINK-114`,
4 tests, uses `initialOpenDashboard={DASH_77}` and must be updated to the new prop shape). Combined
with the full dashboard family (132 tests, Q1) and the 16 `App.deeplink.spec.tsx` tests (which
also exercise bare-URL dashboard opening end-to-end through `App`), the true regression surface is
the full 132 — every one of them currently passes against `open`-only behavior and must keep
passing after the mode extension.

---

## Q3 — The after-save transition, the NEW view→edit transition, and the mode machine

**Confidence: HIGH on the writer design and both hazards being real; HIGH on "open never
transitions to view/edit in place" (verified by reading `DashboardOpen`'s only state-changing
callback, `onDashboardUpdated`, in full).**

### `setDashboardMode` — one writer, two call sites (not one, as tables had)

Mirrors `tableUrl.ts`'s `setTableMode` exactly — preserves `window.history.state` rather than
hardcoding it, for the identical reason Pitfall 3 documents (a deep-link arrival into `edit` that
then transitions must not start popping; a self-opened `view` that transitions to `edit` in place
must not start writing):

```typescript
// lib/dashboardUrl.ts — mirrors tableUrl.ts's setTableMode. Called from TWO sites (Q2 #9 and #11),
// not one — DashboardDetail's own Edit button makes the view->edit direction reachable in a way
// tables never had (TableDetail has no Edit affordance).
export function setDashboardMode(id: number, mode: DashboardMode): void {
  window.history.replaceState(window.history.state, "", buildDashboardUrl(window.location, id, mode));
}
```

### Does `open` ever transition to `view`/`edit` in place? — NO, verified

`DashboardOpen`'s only mode-adjacent callback is `onDashboardUpdated` (`:161-162`,
`DashboardsPage.tsx`), fired from `DashboardOpen`'s settings-modal save
(`handleChangeDisplayMode`, `:453-456`). It calls `setView({ mode: "open", dashboard: updated })` —
**stays in `open`, never becomes `view`/`edit`.** There is no other code path that changes `view.mode`
away from `"open"` while a `DashboardOpen` is mounted. This confirms the five-mode machine's `open`
branch is a closed island relative to `view`/`edit`: nothing enters it except the list's Open button
or a fresh deep-link arrival, and nothing leaves it except the Back button (`leaveDashboardUrl()`,
unchanged). The mode extension therefore never needs to reconcile `open` against a differing mode
on the same history entry — the popstate handler's existing two-case shape (param absent → list;
param present but not on a dashboard screen → clear stale) extends cleanly to three dashboard-
screen states (`open`/`view`/`edit`) with no third case, by the same reasoning `DatasetsPage.tsx`'s
own comment already gives for tables ("no UI path reaches a differing mode on the same entry" — for
dashboards this now needs slight rewording, since `view↔edit` DOES reach a differing mode on the
same entry via in-place `replaceState`, but never via a `pushState`/`popState` pair, so `popstate`
itself never observes it).

### Two NEW deferred unmount-clear timers (a gap CONTEXT.md does not name)

`DashboardOpen` has its own deferred, StrictMode-safe, auth-aware unmount-clear timer
(`DashboardsPage.tsx:620-654`), baked into the same effect that resets 13 Zustand stores on
dashboard switch/unmount. **`DashboardDetail` and `DashboardEdit` have NO equivalent today** —
verified by reading both components in full (lines 277-424): neither imports `useRef`, neither has
an unmount effect, neither calls `clearDashboardUrl`. Before this phase, this was correct — neither
mode was linkable, so there was nothing to clear. After this phase, DSET-V122-06 requires it:
navigating away from Datasets/Settings/etc. while `DashboardDetail`/`DashboardEdit` is mounted must
strip `?dashboard=<id>&mode=<view|edit>` from the bar. **Do NOT fold this into `DashboardOpen`'s
existing timer** — that effect is entangled with the 13-store reset and is keyed to
`DashboardOpen`'s own mount lifecycle; touching it risks regressing a large, unrelated, load-bearing
effect. The lowest-risk shape is two small, NEW, `DashboardOpen`-timer-mirroring effects, one each
inside `DashboardDetail` and `DashboardEdit` (they are simple, stateless-ish components — adding a
`useRef`+`useEffect` pair to each is a small, self-contained, easily-reviewed diff):

```typescript
// Inside DashboardDetail AND DashboardEdit — same shape, twice. Mirrors DashboardOpen's own
// deferred-clear timer (:620-654) but WITHOUT its store-reset entanglement — these two screens
// carry no per-dashboard server-side state to tear down, only the URL.
const clearUrlTimer = useRef<number | null>(null);
useEffect(() => {
  if (clearUrlTimer.current !== null) { clearTimeout(clearUrlTimer.current); clearUrlTimer.current = null; }
  const openedId = dashboard.id;
  return () => {
    clearUrlTimer.current = window.setTimeout(() => {
      if (useAuthStore.getState().status !== "authenticated") return;
      if (readDashboardIdFromSearch(window.location.search) !== openedId) return;
      clearDashboardUrl();
    }, 0);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount-lifetime effect
}, []);
```

### The unsaved-edit hazard — re-confirmed as OUT of scope, matching Phase 116's own precedent

`DashboardEdit` (`:322-372`) holds local `useState` for `name`/`description`, exactly like
`TableEdit` did before Phase 116's operator decision. **No dirty-tracking exists today**
(`window.confirm` appears exactly once in the whole file — the pre-existing Delete confirm,
`grep -c "window.confirm" components/DashboardsPage.tsx` → **1**). Per CONTEXT's own framing
("Default to neither, matching the Phase 116 operator decision"), and per Phase 116's recorded
operator reasoning (a Back-out-of-edit that lands on the list is "strictly better" than today's
behaviour of ejecting the user from the app entirely, and building a guard is form-state work
outside URL scope), this phase should NOT build `dashboardEditGuard`, NOT add a new
`window.confirm`, and NOT intercept `popstate` for dirty state. Confirmed no existing plan or
requirement forces it. `grep -rc "dashboardEditGuard"` → **0**, everywhere — should stay 0.

---

## Q4 — `App.tsx` precedence and `ReturnTo`

**Confidence: HIGH — every claim below is a direct read of the current `App.tsx` (636 lines).**

### The "dashboard wins" precedence rule needs NO changes

The rule lives entirely in the table-side effect (`App.tsx`'s table-open effect, `:493-510`) and is
keyed on `deepLink.status !== "none"` — a check against the dashboard hook's STATUS, not its mode.
Adding a `mode` field to `DeepLinkState`'s `"pending"`/`"opened"` variants does not change what
`.status` can be (`"none" | "pending" | "opened" | "unavailable" | "error"`, unchanged), so this
guard clause is untouched by Q1-Q3's work. **Verified, not assumed**: re-read the full effect body —
every branch condition it has ever needed is a `.status` check.

### What DOES need to change: the dashboard's OWN effect

`App.tsx:462-475` (approximate; the effect immediately following the table-open effect's
declaration-order comment) currently hardcodes the mode on success:

```typescript
// CURRENT — hardcodes "open" unconditionally:
if (deepLink.status === "opened") {
  setPage("dashboards");
  setDashboardViewMode("open");                    // must become deepLink.mode
  restoreDashboardUrl(deepLink.dashboard.id);       // must become restoreDashboardUrl(deepLink.dashboard.id, deepLink.mode)
}
```
This is the direct consequence of `DeepLinkState` gaining a `mode` field (Q1/Q3) — not a new design
decision, a mechanical follow-on.

### `ReturnTo` extension — safe, verified against the actual closed-shape assertion

`type ReturnTo` gains `dashboardMode?: "view" | "edit"` (absent = open, mirroring the URL's own
absent-means-open rule). **The one existing closed-shape assertion this must not break**:
`App.signincommit.spec.tsx:115,128` — `expect(readReturnTo()).toEqual({ dashboardId: 12, page:
"dashboards" })`. Verified: both tests seed `window.history.replaceState(null, "", "/?dashboard=12")`
— a BARE url, which resolves `deepLink.mode` to `"open"`. **As long as `handleSignInCommit` builds
the payload conditionally** (spreads `dashboardMode` into the object only when `deepLink.mode !==
"open"`, exactly the pattern 115-RESEARCH already established for `tableMode`/`dashboardId`'s
undefined-key handling — "build conditionally, NOT as a spread with undefined-valued keys," per
the existing code comment at `App.tsx:358-360`), these two tests keep passing UNMODIFIED, because
the parsed object for an `open`-mode commit is still exactly `{dashboardId, page}`.

`readPendingDashboardId` needs the same extension `readPendingTable` already demonstrates for
tables: read `parsed.dashboardMode`, validate against the same absent/unrecognised-means-"open"
rule the URL reader uses (`parsed.dashboardMode === "edit" ? "edit" : parsed.dashboardMode ===
"view" ? "view" : "open"`), and thread it into `useDeepLinkDashboard`'s `storedDashboard` parameter
(which itself needs to become `{id, mode} | null`, mirroring `useDeepLinkTable`'s `storedTable`
parameter exactly).

### Grep-verified current state

- `grep -rc "dashboardMode"` in `App.tsx`/specs → **0** (the identifier is completely free; note
  `dashboardViewMode`, the Phase-7-era vestigial string tracker, is a DIFFERENT, pre-existing
  identifier — do not confuse the two, and do not let a bare `grep -c "dashboardMode"` accidentally
  match `dashboardViewMode` as a substring; anchor with a word boundary or exact field syntax).
- `grep -c "buildDashboardUrl("` in `App.tsx`, `hooks/useDeepLinkDashboard.ts`,
  `components/DashboardsPage.tsx` → **0 in all three** (confirms no direct caller outside
  `lib/dashboardUrl.ts` needs updating for the arity change).

---

## Q5 — Test infrastructure

**Confidence: HIGH — every count executed this session against the current tree.**

### Current baseline (before any Phase 117 code)
```
Test Files  175 passed (175)
     Tests  3902 passed (3902)
```
(`cd packages/web && npx vitest run`, executed 2026-09-15. The same pre-existing, unrelated
`useDashboardContext must be used inside DashboardContext.Provider` console errors from an
intentional negative-path test print during the run — not failures; the summary line is
authoritative. Note the working tree has unrelated uncommitted changes — heatmap chart work,
per `git status` — already included in this baseline; none of it touches dashboard/table
deep-link files.)

### Spec files this phase is expected to touch (the dashboard family, Q1's 132)

| File | Tests | Nature of the touch |
|---|---|---|
| `lib/dashboardUrl.spec.ts` | 39 | + new describe blocks for `readDashboardModeFromSearch`, `setDashboardMode`, mode-aware `buildDashboardUrl` |
| `hooks/useDeepLinkDashboard.spec.ts` | 16 | + `mode` field coverage on `pending`/`opened`, + `storedDashboard` param tests mirroring `useDeepLinkTable.spec.ts`'s `storedTable` block |
| `components/DashboardsPage.urlsync.spec.tsx` | 13 | fixture shape fix (`initialOpenDashboard={DASH_77}` → `{dashboard: DASH_77, mode: "..."}`) + new describe blocks for the 13-transition table (Q2) |
| `App.spec.tsx` | 38 | `ReturnTo`-shape tests get a `dashboardMode` junk-value block, mirroring the existing `page`/`dashboardId` corrupt-value template (`:169-186`) |
| `App.deeplink.spec.tsx` | 16 | stub fix (`captured.id` → `captured.dashboard.id`) — same page-stub trap as below |
| `App.passwordDeepLink.spec.tsx` | 3 | regression re-confirmation that password mode still needs no code for the new mode dimension |
| `App.signincommit.spec.tsx` | 7 | + `dashboardMode` commit-write tests; the 2 closed-shape `toEqual` tests stay unmodified (Q4) |

### Where new dashboard-mode tests belong

No new spec FILES are needed — this phase extends the SAME 7 files above, in place, exactly the
way the feature itself requires (Q1). This is a structural difference from Phase 116 (which created
brand-new sibling files) and is the direct consequence of "keep duplicated" meaning "duplicate the
FILE STRUCTURE, not create new files for an entity that already has files."

### The page-stub trap — reconfirmed, THIRD consecutive phase to need this warning

`App.deeplink.spec.tsx:27-32`'s own comment, 115-RESEARCH §Q1, and 116-RESEARCH §Q5/Pitfall 2 have
each independently hit and re-documented this. It applies here in a NEW form: not just "must be a
mount-time lazy capture," but **the prop's SHAPE is changing**, so the stub itself needs editing,
not just verifying:

```typescript
// CURRENT stub (App.deeplink.spec.tsx, App.signincommit.spec.tsx) — WRONG shape after this phase:
vi.mock("./components/DashboardsPage", () => ({
  default: ({ initialOpenDashboard }: { initialOpenDashboard?: { id: number } }) => {
    const [captured] = useState(() => initialOpenDashboard);
    return <main data-testid="page-dashboards" data-deeplink={captured ? String(captured.id) : ""}>Dashboards</main>;
  },
}));

// REQUIRED shape — mirrors DatasetsPage's own stub trap fix from Phase 116/115-RESEARCH exactly,
// but for the NEW {dashboard, mode} prop shape:
vi.mock("./components/DashboardsPage", () => ({
  default: ({ initialOpenDashboard }: { initialOpenDashboard?: { dashboard: { id: number }; mode: string } }) => {
    const [captured] = useState(() => initialOpenDashboard);
    return (
      <main data-testid="page-dashboards"
            data-deeplink={captured ? String(captured.dashboard.id) : ""}
            data-mode={captured?.mode ?? ""}>
        Dashboards
      </main>
    );
  },
}));
```
A "dumb prop-reflector" stub, OR a stub that keeps reading `captured.id` against the new
`{dashboard, mode}` shape, will either fail to compile (TypeScript catches the shape mismatch,
which is actually the SAFEST failure mode here) or silently read `undefined` at runtime if the
stub is loosely typed — flag this explicitly in the plan, exactly as the prior two research passes
did, because CLAUDE.md's own memory log shows this has been hit even by researchers who had already
read the warning.

</phase_requirements>

## Standard Stack

No new libraries. Pure application code inside the existing stack.

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| React | existing project version | Component tree, hooks | Already in use |
| Native History API | browser built-in | `pushState`/`replaceState`/`popstate` | Locked milestone decision — no router |
| Native `sessionStorage` | browser built-in | `kbi_returnTo` extension | Locked Phase 7/115 precedent |

No `npm install` needed.

## Architecture Patterns

### Pattern 1: Extend the entity's OWN files in place, don't fork a sibling, when the entity already owns the mechanism
**What:** Unlike Phase 116 (a brand-new entity got brand-new sibling files), Phase 117 adds a mode
to an entity whose files already exist and already implement one mode of the same mechanism.
**When to use:** When the "new" capability is a variant on an EXISTING entity's behavior, not a
wholly new entity — there is no sibling-file escape hatch available, because the base case
(dashboards' `open` mode) IS the file being extended.
**Example:** `lib/dashboardUrl.ts` gains `DashboardMode`, a defaulted third param on
`buildDashboardUrl`, and `setDashboardMode` — all inside the existing file, not a new one.

### Pattern 2: A generic mode-writer that preserves `window.history.state`, called from BOTH directions of an in-place transition
**What:** `setDashboardMode`/`setTableMode`'s `replaceState(window.history.state, ...)` shape
generalizes to any number of call sites on the SAME entity, as long as each call passes through
the CURRENT state rather than assuming it.
**When to use:** Whenever an entity's mode can change without a fresh navigation, in either direction.
**Example:** Q3's two call sites (`DashboardDetail.onEdit` and `DashboardEdit.onSaved`) both call
the SAME `setDashboardMode`, one for each direction of the `view↔edit` transition.

### Pattern 3: A deferred, StrictMode-safe unmount-clear timer, kept OUT of an unrelated heavyweight effect
**What:** `DashboardOpen`'s unmount-clear timer is entangled with its 13-store reset effect for
historical reasons (it was the only linkable mode). New linkable screens should get their OWN
small timer, not be folded into an existing large effect that has nothing to do with URL cleanup.
**When to use:** Whenever a new linkable screen is added to a page that already has ONE such timer
on a DIFFERENT screen.
**Example:** Q3's two new timers inside `DashboardDetail`/`DashboardEdit`.

### Anti-Patterns to Avoid
- **Extracting a shared core across dashboards AND tables in this phase.** Technically cleaner than
  it was in Phase 116, but couples a cross-cutting refactor to a feature whose single highest-stakes
  requirement is "do not regress a URL that is live in the wild" — see Q1.
- **Folding the new view/edit unmount-clear timers into `DashboardOpen`'s existing store-reset
  effect.** That effect is large, unrelated, and load-bearing; touching it for URL cleanup risks
  regressing 13 Zustand store resets that have nothing to do with this phase.
- **Hardcoding `setDashboardMode`'s `replaceState` history-state argument** (`null` or
  `{[MARKER]:true}`) instead of passing `window.history.state` through — see Pitfall 1 below,
  which now applies at TWO call sites instead of tables' one.
- **A dumb prop-reflector stub for `initialOpenDashboard`** in any spec touching `App.tsx` —
  the THIRD consecutive phase where this exact trap has been named.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Preserving marker state across an in-place mode change, in either direction | A second, direction-specific writer for `view→edit` vs `edit→view` | ONE `setDashboardMode(id, mode)`, called from both sites | The marker-preservation logic is identical regardless of direction; only the target mode differs, which is already a parameter |
| Detecting whether the current history entry is "ours" | A new marker scheme for view/edit | The SAME `DASHBOARD_HISTORY_MARKER` `open` already uses — the marker is entry-level, not mode-level, so it needs no change at all |

**Key insight:** almost every piece Phase 117 needs already has a proven, same-shaped precedent
somewhere in the five files this chain has built (`dashboardUrl.ts`'s own `open`-mode functions,
`tableUrl.ts`'s already-mode-aware equivalents, `DashboardOpen`'s unmount timer, `DatasetsPage.tsx`'s
top-level popstate reconciliation) — the only two pieces with NO precedent anywhere are the
view→edit in-place transition (Q2 #9) and its consequence, a writer needed at two call sites
instead of one (Q3) — both called out explicitly here rather than glossed over as "just like tables."

## Common Pitfalls

### Pitfall 1: The mode-preserving replace, now at TWO call sites instead of one
**What goes wrong:** `setDashboardMode` hardcodes the marker state at either call site instead of
reading `window.history.state` first — e.g., the `DashboardDetail.onEdit` call site (view→edit) is
written by analogy to `openDashboardUrl` (which deliberately SETS the marker) instead of preserving
whatever was already there.
**Why it happens:** tables only ever needed this writer in ONE place (edit→view after Save); a
planner copying that precedent by rote may miss that dashboards need the SAME writer at a SECOND,
structurally different call site (an in-app button click, not a form-save success handler).
**How to avoid:** `window.history.replaceState(window.history.state, "", ...)` at BOTH sites — never
`replaceState(null, ...)` and never `replaceState({[MARKER]:true}, ...)`.
**Warning signs:** a test suite that only exercises "list→edit push→Save" (marker always true) and
never "list→view push→in-app Edit click→Save" or "deep-link arrival into view→in-app Edit click"
(marker absent) will not catch a hardcoded value at the `:186` call site.

### Pitfall 2: Treating `DashboardOpen`'s existing unmount timer as reusable for view/edit
**What goes wrong:** a plan tries to generalize `DashboardOpen`'s deferred-clear effect (`:620-654`)
to also cover `DashboardDetail`/`DashboardEdit`, entangling URL cleanup with the unrelated 13-store
reset.
**Why it happens:** it looks like "the existing unmount-clear logic" and DRY instinct suggests
reusing it rather than duplicating a small timer twice.
**How to avoid:** two new, small, independent timers (Q3's code block) — same SHAPE as
`DashboardOpen`'s, but not the SAME effect.
**Warning signs:** a diff that touches `DashboardOpen`'s existing 13-store-reset effect when the
requirement in play (DSET-V122-06) has nothing to do with store resets.

### Pitfall 3: The `?mode=` query-param namespace collision with tables
**What goes wrong:** a hand-crafted `?dashboard=5&table=12&mode=edit` URL, when the dashboard
leaves, has its `clearDashboardUrl()` call ALSO strip the table's `mode=edit` qualifier, because
both entities read/write the same literal `"mode"` key.
**Why it happens:** `tableUrl.ts`'s own header comment predicted this exact scenario ("if one is
ever added elsewhere") — Phase 117 is that "elsewhere," and it's easy to add the dashboard's mode
param without re-reading that specific warning.
**How to avoid:** document it with a one-line cross-referencing comment at both `clearDashboardUrl`
and `clearTableUrl`; write one regression test proving today's accepted behavior. Do NOT build a
cross-module namespace-aware clear function for a scenario with no UI path.
**Warning signs:** none observable in normal testing — this only manifests via a hand-crafted URL,
so it will not be caught by any UI-driven test; it must be deliberately tested or deliberately
accepted-and-documented.

### Pitfall 4: The page-stub trap, third occurrence, now compounded by a shape change
**What goes wrong:** a stub for `DashboardsPage` in `App.deeplink.spec.tsx`/`App.signincommit.spec.tsx`
keeps reading `initialOpenDashboard` as a bare `{id: number}` (its CURRENT shape) instead of
updating to `{dashboard: {id: number}, mode: string}` (its NEW shape), on top of the pre-existing
lazy-capture requirement.
**Why it happens:** the shape-change and the lazy-capture-contract are two separate things to get
right simultaneously; a fix for one without the other still fails.
**How to avoid:** the corrected stub in Q5, which does both at once.
**Warning signs:** a TypeScript compile error is the GOOD outcome here (catches the shape mismatch
immediately); a loosely-typed stub that compiles but reads `undefined` at runtime is the dangerous
outcome, since it may pass some assertions by coincidence (e.g., `data-deeplink=""` matching an
"absent" test) while failing the "present" ones confusingly.

## Code Examples

### The existing table pattern this phase's dashboard side finally catches up to
```typescript
// lib/tableUrl.ts — the ALREADY-SHIPPED, proven shape. lib/dashboardUrl.ts's extension is
// structurally identical, with THREE mode values instead of two and "open" (not "view") as the
// absence-representing default.
export function buildTableUrl(
  loc: { pathname: string; search: string; hash: string },
  id: number | null,
  mode: TableMode = "view",
): string {
  const params = new URLSearchParams(loc.search);
  if (id === null) { params.delete(TABLE_URL_PARAM); params.delete(TABLE_MODE_PARAM); }
  else {
    params.set(TABLE_URL_PARAM, String(id));
    if (mode === "edit") params.set(TABLE_MODE_PARAM, "edit");
    else params.delete(TABLE_MODE_PARAM);
  }
  const qs = params.toString();
  return `${loc.pathname}${qs ? `?${qs}` : ""}${loc.hash}`;
}
```

### The one writer needed at two call sites (Q3, no table precedent for the SECOND site)
```typescript
// lib/dashboardUrl.ts — NEW. Called from DashboardDetail.onEdit (view->edit, Q2 #9) AND
// DashboardEdit.onSaved (edit->view, Q2 #11). See Pitfall 1 for why window.history.state must be
// read, not assumed, at BOTH sites.
export function setDashboardMode(id: number, mode: DashboardMode): void {
  window.history.replaceState(window.history.state, "", buildDashboardUrl(window.location, id, mode));
}
```

## State of the Art

Not applicable — internal state-machine extension, not a library/ecosystem question.

## Open Questions

1. **Should the `?mode=` namespace collision (Pitfall 3) get a regression test in THIS phase, or
   is documenting it sufficient?**
   - What we know: no UI path produces the colliding URL; the failure mode is silent and
     low-severity (a stale param gets stripped a moment early).
   - What's unclear: whether the operator considers a hand-crafted-URL edge case worth a dedicated
     test versus a comment.
   - Recommendation: one cheap regression test (asserting today's actual, accepted behavior) plus
     the cross-referencing comment — matches the "assert, don't guess" discipline used for
     dashboard-wins precedence testing in 116-RESEARCH §Q4.

2. **Does `App.tsx`'s `dashboardViewMode` (the Phase-7-era vestigial string, distinct from the new
   `deepLink.mode`) need any attention in this phase?**
   - What we know: it's read/written for the OIDC-expiry ReturnTo capture, set via
     `onViewChange={setDashboardViewMode}` on every `DashboardsPage.setView` call, but never fed
     back INTO `DashboardsPage` as a prop — it appears to be write-only from `DashboardsPage`'s
     perspective today, consumed only by the `UNAUTHORIZED_EVENT` payload write.
   - What's unclear: whether restoring `dashboardViewMode` after an expiry was ever meant to
     actually reopen a specific view (it currently doesn't — there's no code path that reads it
     back into `DashboardsPage`'s state).
   - Recommendation: leave it exactly as-is; it's out of this phase's scope (DSET-V122-07's
     restore path goes entirely through `deepLink`/`ReturnTo.dashboardMode`, not through this
     field) and touching it risks disturbing Phase-7-era behavior unrelated to deep links.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing project config) |
| Config file | `packages/web/vite.config.ts` / `packages/web/vitest.setup.ts` (existing, unchanged) |
| Quick run command | `cd packages/web && npx vitest run src/lib/dashboardUrl.spec.ts src/hooks/useDeepLinkDashboard.spec.ts src/components/DashboardsPage.urlsync.spec.tsx` |
| Full suite command | `cd packages/web && npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DSET-V122-01 | View button writes `?dashboard=<id>&mode=view` | unit (component) | `npx vitest run src/components/DashboardsPage.urlsync.spec.tsx -t "DSET-117"` | ✅ extend existing file |
| DSET-V122-02 | Edit button writes `&mode=edit`; DashboardDetail's own Edit does too, in place | unit (component) | same file | ✅ extend existing file |
| DSET-V122-03 | A view/edit link mounts straight into that mode, no list flash | unit (App) | `npx vitest run src/App.deeplink.spec.tsx` | ✅ extend existing file |
| DSET-V122-04 | Missing/not-permitted shows the combined message | unit (hook) | `npx vitest run src/hooks/useDeepLinkDashboard.spec.ts` | ✅ existing coverage largely applies unchanged, per Q2 addendum |
| DSET-V122-05 | Back returns to the list; no-prior-entry doesn't eject | unit (component) | `npx vitest run src/components/DashboardsPage.urlsync.spec.tsx` | ✅ extend existing file |
| DSET-V122-06 | Leaving view/edit clears the address bar | unit (component) | same file, new describe block for the two new unmount timers | ✅ extend existing file |
| DSET-V122-07 | Logged-out visit routes to login, lands on the mode after auth | unit (App) | `npx vitest run src/App.signincommit.spec.tsx src/App.passwordDeepLink.spec.tsx` | ✅ extend existing files |
| DSET-V122-08 | Bare `?dashboard=<id>` keeps opening the running dashboard | unit (regression) | `npx vitest run` (full suite — the 132-test dashboard family is the guard) | ✅ existing coverage, must stay green |

### Sampling Rate
- **Per task commit:** the quick run command above
- **Per wave merge:** full suite command
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus `npx tsc --noEmit` and
  `npx vitest run src/styles/theme-guard.spec.ts` per CLAUDE.md

### Wave 0 Gaps
None — existing test infrastructure (the 7-file dashboard family) covers all phase requirements;
this phase extends those files in place rather than needing new test scaffolding or a new
framework/config.

## Verifiable Acceptance Criteria — grep counts (run BEFORE any Phase 117 code, per CLAUDE.md)

Every count below was executed against the current tree this session (`packages/web/src`, branch
`chore/ci-and-release-process`, 2026-09-15). Per CLAUDE.md: `grep -c` counts **matching LINES**, not
occurrences — noted below wherever that distinction matters, and TWO already-non-zero counts are
flagged as toothless-if-used-bare, with delta-based replacements given.

| Proposed criterion | Command (from `packages/web/src`) | Current count | Verdict |
|---|---|---|---|
| `DashboardMode` type exists | `grep -rc "DashboardMode" .` | **0** everywhere | Usable — name is free |
| `setDashboardMode` writer exists | `grep -rc "setDashboardMode" .` | **0** everywhere | Usable |
| `readDashboardModeFromSearch` exists | `grep -rc "readDashboardModeFromSearch" .` | **0** everywhere | Usable |
| `DASHBOARD_MODE_PARAM` constant exists | `grep -rc "DASHBOARD_MODE_PARAM" .` | **0** everywhere | Usable |
| `ReturnTo` gained `dashboardMode` | `grep -c "dashboardMode?:" App.tsx` | **0** | Usable — anchor on the field declaration with `?:` so it can't accidentally match `dashboardViewMode` as a substring (that identifier is pre-existing and unrelated, see Q4) |
| `deepLink.mode` is read somewhere in `App.tsx` | `grep -c "deepLink.mode" App.tsx` | **0** | Usable |
| `openDashboardUrl(` calls in `DashboardsPage.tsx` | `grep -c "openDashboardUrl(" components/DashboardsPage.tsx` | **2** (1 real call at `:240`, 1 in a COMMENT at `:102` — `grep -c` counts lines, and the comment line contains the substring) | **Toothless as a bare "≥1" check — already non-zero, and the count includes prose, not just code.** Use a delta: BEFORE 2 (1 comment + 1 real), AFTER should be **4** (same comment, plus 3 real call sites: list Open unchanged, list View NEW, create→view NEW) |
| `leaveDashboardUrl(` calls in `DashboardsPage.tsx` | `grep -c "leaveDashboardUrl(" components/DashboardsPage.tsx` | **2** (1 real call at `:160`, 1 in a comment at `:104`) | **Toothless as a bare check for the same reason.** Delta: BEFORE 2, AFTER should be **4** (comment + open's existing call + 2 NEW calls: view→list, edit→list) |
| `setDashboardMode(` calls in `DashboardsPage.tsx` | `grep -c "setDashboardMode(" components/DashboardsPage.tsx` | **0** (function doesn't exist yet) | Usable. AFTER should be **exactly 2** — `DashboardDetail.onEdit` and `DashboardEdit.onSaved`. NOT 1 (means the view→edit in-place site, Q2 #9, was missed — the easiest transition in this whole phase to overlook, since it has zero table precedent) |
| `mode: "edit"` appears in `DashboardsPage.tsx` | `grep -c 'mode: "edit"' components/DashboardsPage.tsx` | **3** (the `View` type union declaration, `DashboardDetail.onEdit`'s existing `setView` call, the list's existing Edit button's `setView` call) | **Already non-zero and STAYS non-zero for reasons unrelated to this phase's work — the five-mode state machine, including `edit`, already existed before Phase 117.** Do NOT use this as an acceptance criterion at all; it cannot discriminate "URL wiring added" from "the pre-existing mode already there." Anchor on `openDashboardUrl(` / `setDashboardMode(` deltas instead. |
| `window.confirm` in `DashboardsPage.tsx` | `grep -c "window.confirm" components/DashboardsPage.tsx` | **1** (pre-existing Delete confirm) | **Usable as a STABILITY guard, matching Phase 116's own criterion 7** — should stay exactly 1 after this phase (no unsaved-edit guard added, per Discretion default) |
| `dashboardEditGuard` singleton does NOT exist | `grep -rc "dashboardEditGuard" .` | **0** everywhere | Usable as a stability guard — should stay 0 |
| `initialOpenDashboard` prop shape changed | `grep -c "initialOpenDashboard?: {" components/DashboardsPage.tsx` (or the exact chosen type annotation) | **0** (current signature is `initialOpenDashboard?: DashboardDto`) | Usable, but re-run against whatever exact type annotation the plan settles on before locking it in — the CURRENT annotation text is `initialOpenDashboard?: DashboardDto;` (`grep -c "initialOpenDashboard?: DashboardDto" components/DashboardsPage.tsx` → **1**, confirming the BEFORE state to change away from) |
| `getTableById`/table-family files stay untouched (regression guard confirming Q1's "keep duplicated" recommendation was followed) | `git diff --name-only -- packages/web/src/lib/tableUrl.ts packages/web/src/hooks/useDeepLinkTable.ts packages/web/src/components/DatasetsPage.tsx` | **(run at review time — should be EMPTY)** | Usable as a stability guard: any output here means the "keep duplicated" recommendation was silently abandoned for a cross-entity extraction mid-phase, which CONTEXT.md requires being an explicit, stated decision if it happens |
| Baseline full-suite count preserved | `cd packages/web && npx vitest run` | **175 files / 3902 tests, 100% pass** (executed this session, 2026-09-15) | Use as the literal before-number; the phase's own summary should report the new totals (175+N files if new spec files are added — Q5 recommends none — or 175 files / 3902+M tests) rather than asserting an exact new count in a criterion |

**Unprovable-by-grep requirements, routed to `checkpoint:human-verify` per CLAUDE.md:**
- "Clicking Edit inside the dashboard settings/view screen visibly and immediately becomes the
  edit form, with no flash of the list." jsdom can prove the STATE MACHINE is correct (URL changes,
  `view.mode` changes) but not the felt UX of the in-place transition in a real browser.
- "The failure banner and login banner copy for dashboard settings links reads correctly in both
  light and dark mode." Same class of risk 114/115-RESEARCH flagged (the `.onboarding-banner`
  light-mode defect passed `tsc`/`vitest`/`theme-guard` silently) — this phase likely reuses the
  EXISTING banner components unchanged (no new copy needed per CONTEXT's discretion note), which
  makes this LOW risk, but if any new copy is added it needs a human look, not a grep.
- "A hand-crafted `?dashboard=5&table=12&mode=edit` URL behaves acceptably" (Pitfall 3) — the
  MECHANISM is testable (a regression test can assert today's actual behavior), but whether that
  behavior is "acceptable" for an edge case with no UI path is a judgment call, not a provable fact.

## Sources

### Primary (HIGH confidence — direct file reads + one executed full-suite run, this session, 2026-09-15)
- `packages/web/src/lib/dashboardUrl.ts` (full file, 111 lines)
- `packages/web/src/lib/tableUrl.ts` (full file, 141 lines)
- `packages/web/src/hooks/useDeepLinkDashboard.ts` (full file)
- `packages/web/src/hooks/useDeepLinkTable.ts` (full file)
- `packages/web/src/App.tsx` (full file, 636 lines)
- `packages/web/src/components/DashboardsPage.tsx` (full file read in sections: 1-480, 600-660, 1150-1220 — 1756 lines total)
- `packages/web/src/components/DatasetsPage.tsx` (relevant sections: 1-140)
- `packages/web/src/components/LoginPage.tsx` (relevant sections: 1-70)
- `packages/web/src/lib/permissions.ts` — `DASHBOARDS_EDIT`, `DASHBOARDS_MANAGE_ACCESS` definitions
- `packages/server/src/index.ts` — grep for `app.get("/api/dashboards`, `app.patch("/api/dashboards` (confirmed: still no per-id GET route; PATCH still gated on `PERMISSIONS.DASHBOARDS_EDIT`)
- `lib/dashboardUrl.spec.ts`, `hooks/useDeepLinkDashboard.spec.ts`, `components/DashboardsPage.urlsync.spec.tsx`, `App.spec.tsx`, `App.deeplink.spec.tsx`, `App.passwordDeepLink.spec.tsx`, `App.signincommit.spec.tsx`, `lib/tableUrl.spec.ts`, `hooks/useDeepLinkTable.spec.ts`, `components/DatasetsPage.urlsync.spec.tsx`, `App.tableDeeplink.spec.tsx`, `App.tablePasswordDeepLink.spec.tsx` (test-count enumeration + relevant sections read in full for `components/DashboardsPage.urlsync.spec.tsx` and `App.signincommit.spec.tsx`)
- `npx vitest run` from `packages/web`, executed this session: `Test Files 175 passed (175)`, `Tests 3902 passed (3902)`
- `.planning/phases/117-dashboard-settings-links/117-CONTEXT.md`, `116-CONTEXT.md`, `116-RESEARCH.md`, `116-03-PLAN.md`, `113-CONTEXT.md`, `114-CONTEXT.md`, `115-CONTEXT.md`, `115-RESEARCH.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Secondary / Tertiary
None used — entirely internal-codebase research, no web search needed.

## Metadata

**Confidence breakdown:**
- Q1 (TLINK-F4 decision): HIGH — every count is a direct import-graph + test-count measurement against the current tree, not an estimate
- Q2 (transition table + buildDashboardUrl extension): HIGH — every line number verified by fresh `grep -n` against the current file
- Q3 (mode-preservation writer + unmount-clear gap): HIGH on both hazards being real (verified by reading `DashboardDetail`/`DashboardEdit`/`DashboardOpen` in full); HIGH on "open never transitions in place" (verified by reading the only relevant callback)
- Q4 (precedence + ReturnTo): HIGH — the precedence guard's mode-agnosticism confirmed by reading its full condition set; the `toEqual` safety confirmed by reading the exact test fixtures
- Q5 (test infra): HIGH — every count executed this session
- Grep acceptance criteria: every count executed this session; two identified as toothless-if-used-bare (`openDashboardUrl(`, `leaveDashboardUrl(` — comment-line pollution) and one as unconditionally toothless (`mode: "edit"` — pre-existing regardless of this phase's work), each given a delta-based or comment-excluding replacement

**Research date:** 2026-09-15
**Valid until:** tied to this exact commit; treat as valid for 7 days or until the next commit
touching `App.tsx`/`DashboardsPage.tsx`/`dashboardUrl.ts`/`useDeepLinkDashboard.ts`/`tableUrl.ts`/
`useDeepLinkTable.ts`/`packages/server/src/index.ts`'s `/api/dashboards` routes, whichever comes
first — consume in the very next `/gsd:plan-phase` invocation.
