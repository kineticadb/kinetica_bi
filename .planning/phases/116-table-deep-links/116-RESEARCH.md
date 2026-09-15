# Phase 116: Table Deep Links - Research

**Researched:** 2026-09-14
**Domain:** Generalizing an existing, operator-verified client-side URL-sync/deep-link state machine (React + native History API + sessionStorage) to a second entity with a four-mode view state machine — no new libraries, no server changes
**Confidence:** HIGH (every finding below is a direct read of the current tree, plus one full `npx vitest run` execution; nothing here rests on training-data assumptions about this codebase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Inherited verbatim from Phases 113-115 — do NOT re-derive:**

| Decision | Applies as | Source |
|---|---|---|
| Query param, never a path or hash | `?table=<id>` | 113-CONTEXT §"URL shape" |
| Numeric id, never a name/slug | `TableDto.id` (`api/client.ts:403`) | 113-CONTEXT §"Identifier" |
| Opening pushes exactly ONE history entry, marked as ours | same marker approach | 113-CONTEXT §"Back-button behaviour" |
| In-app Back pops that entry; an arrival with NO entry of ours WRITES the list URL instead of popping | naive `history.back()` ejects a deep-link arrival out of the app entirely | 113-CONTEXT §"Back-button behaviour" |
| URL updates immediately on open, before data loads | same | 113-CONTEXT §"URL update timing" |
| Leaving clears the param via `replaceState` | same | 113-CONTEXT (DLINK-V121-07) |
| ONE combined message for missing-or-not-permitted, never two | see Q2 below — the underlying reasoning does NOT hold for tables, but the wording can still be reused | 114-CONTEXT §"Error message" |
| Hold the app-level `Loading…` while a link resolves — never hand off to the page | same | 114-CONTEXT §"While the link resolves" |
| Failure lands on the list with a dismissible banner, and the param is stripped | same | 114-CONTEXT §"Where the error appears" / §"After a failure" |
| Logged-out arrival → login, param left in the bar | same | 115-CONTEXT §"Two hooks left here" |
| Extend `kbi_returnTo`; **NO second sessionStorage key** | same key, extended shape | 115-CONTEXT §"Mechanism" + ROADMAP §115 criterion 2 |
| Single-use, no TTL | same | 115-CONTEXT §"Lifetime" |
| Write on COMMIT for a fresh paste; at INTERRUPTION for an expiry — deliberately not unified | same, and for the same reason | 115-CONTEXT §"Write timing" |
| Login banner reuses `.login-banner`; session-ended message wins when both apply | copy adapted to tables | 115-CONTEXT §"Login page signalling" |
| Restore the param to the address bar after the OIDC round trip | same | 115-CONTEXT §"After the OIDC round trip" |
| Password mode needs no commit-time write | **confirmed still holds for tables — see Q3/password-mode note below** | 115-RESEARCH §Q1 |

**THE ONE NEW DECISION — view vs edit in the URL (locked, not open for re-derivation):**
- `?table=12` → **view** mode; `?table=12&mode=edit` → **edit** mode
- `create` and `list` are NOT linkable
- absent-`mode` means view; unrecognised `mode=` values are treated as view, not a failure
- identity stays in ONE param; mode is a separate qualifier, not a compound value

### Claude's Discretion

- Whether generalization means renaming the existing modules (`lib/deepLinkUrl.ts`) or adding a table-specific layer over shared primitives — **decided below: sibling layer, see Q1**.
- The exact param names (`table`, `mode`) — assumed throughout, not sacred.
- Banner copy for the login page and the failure banner.
- Whether one plan or several; whether the unsaved-edit guard is its own plan.

### Deferred Ideas (OUT OF SCOPE)

- Linkable Roles and Settings pages (rest of `DLINK-F4`)
- Linkable `create` screen
- Filter state / map viewport in the URL (`DLINK-F2`/`F3`)
- "Copy link" button (`DLINK-F1`)
- Sidebar "Dashboards" no-op while a dashboard is open (`App.tsx` tech debt) — tables may have the same flaw; record, don't fix, if found (confirmed present, see Q4).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| TLINK-V121-01 | Opening a table puts a link in the address bar | Q1 — new `lib/tableUrl.ts`, `openTableUrl(id, mode)` called from the List's View/Edit buttons, mirroring `openDashboardUrl` |
| TLINK-V121-02 | Visiting a table link opens that table directly, no list flash | Q1/Q3 — new `hooks/useDeepLinkTable.ts` sibling hook + `initialOpenTable` prop into `DatasetsPage`, mirroring `useDeepLinkDashboard`/`initialOpenDashboard` |
| TLINK-V121-03 | Logged-out visit routes to login, lands on the table after auth | Q3 — extend `ReturnTo` with `tableId?`/`tableMode?`, mirror `handleSignInCommit`, `readPendingDashboardId`-equivalent, and the OIDC-only write gate; password mode reconfirmed to need no code (see note) |
| TLINK-V121-04 | Missing/not-permitted table shows a clear message | Q2 — **`GET /api/tables/:id` DOES exist and is NOT permission-scoped; "not permitted" is unreachable today.** Recommend keeping list+find resolution and the combined-message wording anyway, for consistency and forward-compatibility, but the security-conflation rationale does not currently apply |
| TLINK-V121-05 | Browser Back from an open table returns to the list | Q1/Q3 — new `TABLE_HISTORY_MARKER`, `leaveTableUrl`, popstate handler in `DatasetsPage`, mirroring `DashboardsPage.tsx:136-147` |
| TLINK-V121-06 | Leaving a table clears the address bar | Q1/Q3 — `leaveTableUrl()` on every `onBack`, plus a deferred unmount-clear mirroring `DashboardsPage.tsx:635-654` (DatasetsPage currently has NO such timer — net-new) |
| TLINK-V121-07 | The link distinguishes view from edit | Q3 — `mode` qualifier in `tableUrl.ts`; a genuinely NEW in-place "same-entity mode change" writer that dashboards never needed (edit→view after Save must `replaceState` while preserving the entry's marker) |

</phase_requirements>

---

## Summary

Three of the four research questions confirm the generalization is straightforward IF you do it as a **sibling layer, not a shared/parameterized core**: a new `lib/tableUrl.ts` and a new `hooks/useDeepLinkTable.ts`, structurally mirroring the dashboard files line-for-line, touching zero existing dashboard source or spec files. `App.tsx` gets new, dashboard-untouched code paths (new refs, new `ReturnTo` fields, a second effect) rather than any modification of the existing dashboard effects — this is what makes "every 113/114/115 test passes unmodified" achievable, and it is empirically grounded: none of the 94 existing tests across the six named spec files assert a closed `ReturnTo` shape (confirmed by direct read of every relevant `describe` block), so two new optional fields are additive and safe.

The one genuinely surprising finding, which changes a piece of inherited reasoning: **`GET /api/tables/:id` already exists** (`packages/server/src/index.ts:2352`, unused by any current client code) and, unlike dashboards, **table visibility has no permission scoping at all** — `GET /api/tables` and `GET /api/tables/:id` sit behind `requireAuth` only (`index.ts:641`), `DATASETS_MANAGE` gates writes exclusively, and neither `Sidebar.tsx` nor `DatasetsPage.tsx` client-gates View/Edit by permission. This means 114-CONTEXT's non-leak rationale (a missing id is ambiguous between "deleted" and "not permitted") **does not hold for tables today** — "not permitted" is an unreachable state. The research still recommends resolving via `listTables()` + find (not the unused `getTableById`), because the list+find approach is what gives the existing dashboard pattern its clean success/absent/network-error trichotomy for free, and distinguishing a genuine 404 from a transport error via `getTableById` would require new, uninherited error-classification code. Report this loudly rather than silently keeping the two-reason banner copy as if it still described two real cases — the copy can stay (harmless, future-proofs a later permission model) but the plan should say explicitly that today only one of its two clauses is reachable.

The other genuinely new piece of engineering (flagged explicitly by 116-CONTEXT and confirmed real by reading the code) is the **edit-mode leave-guard**. Unlike `brandPageGuard`, which only has to intercept a Sidebar click (an event you can cancel before it happens), a browser-Back-driven `popstate` out of a dirty `TableEdit` form cannot be "prevented" — it has already happened by the time the event fires. The standard, and only, SPA technique is to immediately re-push the entry that was just popped (visually "undoing" the back) when the user declines to discard. This is real, testable, but meaningfully more delicate than anything Phase 113-115 built, and the research below gives both a full implementation and a narrower fallback (guard only the in-app Cancel + Sidebar-navigation exits, explicitly leave browser-Back-out-of-edit unguarded) so the planner can make an informed, stated call either way.

**Primary recommendation:** build `lib/tableUrl.ts` and `hooks/useDeepLinkTable.ts` as new sibling files (no shared abstraction, no rename of the dashboard files); extend `ReturnTo` with two new optional fields (`tableId?: number`, `tableMode?: "view" | "edit"`) written/read by brand-new code paths in `App.tsx` that never touch the existing dashboard effects; resolve via `listTables()` + find (not the dead `getTableById`); add a new `tableEditGuard` singleton (mirroring `brandPageGuard`) for the Sidebar-navigation exit, plus an explicit, stated decision on whether to also intercept `popstate` (recommended: yes, via the re-push technique in Q3) for the browser-Back-out-of-unsaved-edit case; and define an explicit "dashboard wins" precedence rule for the (currently unreachable, only hand-craftable) case where both `?dashboard=` and `?table=` are present at once.

---

## Q1 — Cleanest generalization of the three artifacts (zero dashboard test changes)

**Confidence: HIGH.** Verified by reading all three files in full, all six dashboard/deep-link spec files in full, and running the complete suite as a baseline (168 files / 3778 tests, 100% green, executed this session).

### `lib/dashboardUrl.ts` — sibling module, not a rename, not an extracted factory

`dashboardUrl.ts` (109 lines) is already almost entirely param-name-agnostic internally — `buildDashboardUrl(loc, id)` takes the param name only via the module-level `DASHBOARD_URL_PARAM` constant, and every writer (`openDashboardUrl`, `clearDashboardUrl`, `restoreDashboardUrl`, `leaveDashboardUrl`) is a thin composition over it.

Three options, evaluated against the real blast radius:

1. **Rename to `lib/deepLinkUrl.ts` and parameterize.** Rejected. `dashboardUrl.spec.ts` (39 tests) and every consumer (`App.tsx`, `App.deeplink.spec.tsx` [16 tests], `App.signincommit.spec.tsx` [7], `App.passwordDeepLink.spec.tsx` [3], `hooks/useDeepLinkDashboard.ts` + its spec [16], `components/DashboardsPage.tsx` + `DashboardsPage.urlsync.spec.tsx` [13]) import by the current path and current exported names. A rename forces an import-path edit in every one of those files — **that is a modification of the test files**, even if no assertion inside them changes, and it directly violates "every 113/114/115 test must still pass, unmodified." Eliminated on this basis alone.
2. **Extract shared primitives into a factory `dashboardUrl.ts` and `tableUrl.ts` both call**, e.g. `createEntityUrlHelpers(paramName, markerKey)`. Technically possible without touching any spec file (spec files only exercise the public exported names, which a thin re-export layer could preserve exactly). Considered viable but **not recommended**: the amount of shared logic is small (a `URLSearchParams` get/set, `pushState`/`replaceState`), and tables need a `mode` qualifier dashboards have no equivalent for (see Q3) — a generic core would need an "extra data" type parameter threaded through the `pending`/`opened` states for no real payoff at ~90 lines of already-simple code. It would also strip the file's existing per-decision inline comments (`DASHBOARD_HISTORY_MARKER`'s comment, `restoreDashboardUrl`'s OIDC-redirect rationale, etc.) into a generic function where they read oddly, or force duplicating them anyway. This codebase's own precedent — `DashboardsPage.tsx` and `DatasetsPage.tsx` are two fully independent ~1750/~420-line files with no shared base despite being structurally similar CRUD-list-detail pages — is duplication-over-abstraction, not the reverse.
3. **New sibling module `lib/tableUrl.ts`, structurally mirroring `dashboardUrl.ts`, zero edits to `dashboardUrl.ts`.** **Recommended.** `dashboardUrl.ts` is not touched at all (0 lines changed), so `dashboardUrl.spec.ts`'s 39 tests are trivially unaffected. The new file exports `TABLE_URL_PARAM = "table"`, `TABLE_MODE_PARAM = "mode"`, `TABLE_HISTORY_MARKER = "kbiTableEntry"`, `isValidTableId`, `readTableIdFromSearch`, `readTableModeFromSearch` (returns `"view" | "edit"`, defaulting to `"view"` for absent-or-unrecognised — the one new-decision behavior dashboards never needed), `hasTableParam`, `buildTableUrl(loc, id, mode)`, `openTableUrl(id, mode)`, `clearTableUrl()`, `restoreTableUrl(id, mode)`, `leaveTableUrl()`, **plus one genuinely new writer with no dashboard analogue**: an in-place mode-change writer (see Q3) for the edit→view-after-Save transition.

### `hooks/useDeepLinkDashboard.ts` — sibling hook, not a parameterized fetcher

Same reasoning, same conclusion: a new `hooks/useDeepLinkTable.ts`, structurally mirroring the five-state machine, with its own `DeepLinkTableState` union whose `"opened"` variant carries `{ table: TableDto; mode: "view" | "edit" }` instead of just a dashboard. Passing a fetcher into the *existing* hook (`useDeepLinkDashboard(fetcher, storedId)`) was considered and rejected: it changes the hook's call signature, and while a default-parameter could theoretically preserve backward compatibility, the mode dimension means the "opened" payload shape itself needs to differ between dashboards and tables — a generic core would need a second generic parameter for "extra opened-state data," which is more machinery than the ~55 lines of genuinely simple logic being protected are worth. `useDeepLinkDashboard.spec.ts`'s 16 tests call the hook by its current name and signature; a sibling file touches none of them.

### `App.tsx` — new refs and new `ReturnTo` fields, not modified existing ones

See Q3/Q4 for the full design. The governing principle, confirmed safe by direct inspection of every `ReturnTo`-touching test: **no existing test asserts a closed shape on the `kbi_returnTo` payload** (confirmed via `App.spec.tsx:101-235`, all of which use `toHaveProperty`/individual-field checks or construct their OWN fixture object as input, never a `toEqual` on the full parsed object) — **except** `App.signincommit.spec.tsx:108-129`, which DOES use `toEqual({ dashboardId: 12, page: "dashboards" })`. This is safe to extend: `JSON.stringify` drops `undefined`-valued keys, so as long as the new table-commit logic only sets `tableId`/`tableMode` keys when a table link is actually pending (never writes them as explicit `undefined`), these two existing `toEqual` assertions keep passing unmodified, because the parsed object still has exactly `{dashboardId, page}` when there is no table in play. **Do not build the payload with `{ dashboardId, tableId: undefined, page }`-style spreads that rely on this being invisible after `JSON.parse` without verifying it** — build the payload conditionally instead (spread in the table fields only inside an `if`), which is both clearer and removes any dependence on this `undefined`-dropping behavior at all.

**Confirmed test-file blast radius (every file that imports the three files above):**

| File | Test count | Imports touched by this phase | Risk if a sibling-only approach is followed |
|---|---|---|---|
| `lib/dashboardUrl.spec.ts` | 39 | none | zero |
| `hooks/useDeepLinkDashboard.spec.ts` | 16 | none | zero |
| `components/DashboardsPage.urlsync.spec.tsx` | 13 | none | zero |
| `App.spec.tsx` | 38 | `App.tsx` (new code only) | zero, if additions are new branches/effects, not edits to existing ones |
| `App.deeplink.spec.tsx` | 16 | `App.tsx` | zero, same reasoning |
| `App.passwordDeepLink.spec.tsx` | 3 | `App.tsx` | zero |
| `App.signincommit.spec.tsx` | 7 | `App.tsx` | zero (see `toEqual` note above) |
| **Total protected** | **132** | | |

---

## Q2 — The non-leak question for tables (verified, not assumed)

**Confidence: HIGH — direct read of `packages/server/src/index.ts`.**

**`GET /api/tables/:id` EXISTS** (`index.ts:2352-2357`):
```typescript
app.get("/api/tables/:id", (req, res) => {
  const id = Number(req.params.id);
  const table = getTable(id);
  if (!table) return res.status(404).json({ error: "Table not found." });
  return res.json(table);
});
```
This is the opposite of dashboards, where 114-CONTEXT confirmed no such route exists at all. `packages/web/src/api/client.ts:422` already has a client wrapper, `getTableById`, for this route — **but it is dead code: `grep -rn "getTableById"` across `packages/web/src` returns only its own definition, zero call sites.**

**Neither `GET /api/tables` nor `GET /api/tables/:id` is permission-filtered.** Both sit behind the app-wide `app.use("/api", requireAuth)` (`index.ts:641`) and nothing else — no `canViewTable`-style function exists anywhere in `packages/server/src` (confirmed by grep), and the ONLY table-related permission in the system is `PERMISSIONS.DATASETS_MANAGE` (`lib/permissions.ts:35`), which gates exclusively the three write routes (`POST /api/tables`, `PATCH /api/tables/:id`, `DELETE /api/tables/:id`) and the column-display-config/custom-metrics UPSERT routes. There is no `DATASETS_VIEW` permission and no per-table ACL of any kind.

**Client-side confirms the same picture:** `Sidebar.tsx:27-28` — neither `{ label: "Dashboards", key: "dashboards" }` nor `{ label: "Datasets", key: "datasets" }` carries a `permission` field (contrast with `users`/`roles`/`branding`, which do). `DatasetsPage.tsx` has **zero** `hasPermission` calls anywhere in the file (confirmed by grep) — the Edit and Delete buttons render unconditionally for every authenticated user, unlike `DashboardsPage.tsx:246/251`'s `canEdit`/`canDelete` gates. (This is a pre-existing gap — a user can reach the edit FORM and even attempt a save that the server will 403, but that is unrelated to deep links and out of scope here; it does mean a `?table=12&mode=edit` link is exactly as reachable as clicking "Edit" from the list today, no new exposure.)

**Conclusion, stated plainly per the instruction not to manufacture or weaken a case:** for tables, as the code stands today, **"not permitted" is not a reachable state.** Every id either exists (any authenticated user can view/attempt-edit it) or does not exist (real 404). TLINK-V121-04's "or that the user is not permitted to see" clause describes a state the current permission model cannot produce.

**Recommendation:** Do NOT build new server-side permission logic (v1.21 is frontend-only; out of scope regardless). Two honest options for the frontend:
- **(a) Keep the combined message verbatim** ("This table isn't available — it may have been deleted, or you may not have access.") for consistency with the dashboard pattern and because a future `DATASETS_VIEW`/per-table ACL is plausible (the `DATASETS_MANAGE` precedent shows the permission system is already extended for tables in the write direction) — but the plan should say explicitly that only the "deleted" clause is currently reachable, so a reviewer doesn't mistake the copy for evidence of a permission check that doesn't exist.
- **(b) Say "This table no longer exists."** — more honest today, but would need rewording again the moment a view-permission is added, and it is inconsistent with the deliberately-vague dashboard copy for no real gain (an unreachable second clause is harmless; a wrong one is not — and (a)'s clause is not wrong, merely presently vacuous).
Recommend **(a)**, stated explicitly in the plan as a known, deliberate divergence from the reasoning (not the wording) of 114-CONTEXT.

**Resolution mechanism recommendation (ties back to Q1):** use `listTables()` + `.find()`, exactly mirroring `useDeepLinkDashboard`, NOT the existing-but-unused `getTableById`. Reasoning: `useDeepLinkDashboard`'s three-way outcome (found → `"opened"`; resolved-but-absent → `"unavailable"`; rejected promise → `"error"`, silently landing on the list per the already-passing `"DEEPLINK-114: a transport failure lands on the list..."` test) falls out of `Array.prototype.find` for free. Reproducing the same trichotomy via `getTableById` would require inspecting the HTTP status before `throwForStatus` converts it into a generic `Error` (404s are NOT a distinct error class in `throwForStatus` — only 401/403/502 are; `api/client.ts:100-121`), i.e. new, uninherited error-classification code for a marginal efficiency gain (avoiding fetching the full table list on a deep-link mount). Not worth the divergence; use the proven pattern.

---

## Q3 — The view/edit mode qualifier and the unsaved-edit hazard

**Confidence: HIGH on the mode-qualifier design; HIGH on the hazard being real; MEDIUM on which of the two guard strategies to recommend (both are legitimate, the choice is a real tradeoff, not a research gap).**

### Every DatasetsPage transition that must touch the URL

Read directly from `components/DatasetsPage.tsx` (current line numbers):

| Transition | Trigger | Current code | URL action needed |
|---|---|---|---|
| list → view | View button (`:106`) | `setView({ mode: "view", table: t })` | `openTableUrl(t.id, "view")` — **push**, mark |
| list → edit | Edit button (`:109`) | `setView({ mode: "edit", table: t })` | `openTableUrl(t.id, "edit")` — **push**, mark |
| list → create | New Dataset (`:76`) | `setView({ mode: "create" })` | none (create not linkable) |
| create → view | Save succeeds (`:47`) | `setView({ mode: "view", table: created })` | `openTableUrl(created.id, "view")` — **push** (this is the table's first-ever linkable moment, exactly analogous to "opening") |
| create → list | Cancel (`:44`) | `setView({ mode: "list" })` | none (create never touched the URL) |
| view → list | Back (`:54`, inside `TableDetail`) | `setView({ mode: "list" })` | `leaveTableUrl()` |
| edit → list | Cancel (`:61`, inside `TableEdit`) | `setView({ mode: "list" })` | `leaveTableUrl()` — **plus the dirty-check, see below** |
| **edit → view** | **Save succeeds (`:64`, inside `TableEdit`)** | `setView({ mode: "view", table: updated })` | **NOT a leave, NOT a fresh open — an in-place mode change on the SAME history entry.** This is the one transition with no dashboard equivalent at all (`DashboardOpen` never changes "kind" in place — a saved dashboard-detail edit stays in `edit` mode's own screen until an explicit Back). |

**The in-place mode-change writer (new, no dashboard precedent):** the edit→view transition must `replaceState` to drop `&mode=edit` from the CURRENT entry — but it must preserve whatever marker state that entry already had, because that entry could be either (a) one **we** pushed (list → edit click), in which case Back should still POP to the list, or (b) one the user **arrived** on directly via `?table=12&mode=edit` (a fresh deep link into edit mode), in which case Back should still WRITE (not eject), exactly mirroring the deep-link-arrival principle `DashboardsPage.tsx:102-105`'s comment already states for dashboards. The correct implementation reads and re-passes whatever `window.history.state` already is, rather than hardcoding true or null:
```typescript
// lib/tableUrl.ts — NEW, no dashboard analogue. Changes the mode qualifier on the CURRENT
// entry without disturbing whether that entry is "ours" (pushed) or "arrived" (unmarked) —
// leaveTableUrl()'s pop-vs-write branch must see the SAME answer after a Save as it would have
// before it, or a deep-linked-into-edit arrival that then Saves would incorrectly start popping.
export function setTableMode(id: number, mode: TableMode): void {
  window.history.replaceState(window.history.state, "", buildTableUrl(window.location, id, mode));
}
```

### Password-mode re-verification for tables

115-RESEARCH §Q1's finding (`window.location.search` survives an in-place `unauthenticated → authenticated` store flip because there is no navigation) is entity-agnostic — it is a fact about how the password-mode login flow works at the `App`/`useAuthStore` level, not about dashboards specifically. It holds identically for `?table=12&mode=edit`: the URL is untouched by a password sign-in, so `useDeepLinkTable`'s `useState` initializer (reading the URL once at mount) still has the id/mode on the render where `status` flips. **Confirmed by re-reading the mechanism, not re-run as a new spike** — the only entity-specific part of Q1's original test (the `DashboardsPage` stub) is exactly the trap named below for a `DatasetsPage` stub, and the underlying mechanism it protects is unchanged. Recommend a table-specific regression test (`App.tablePasswordDeepLink.spec.tsx` or added to a shared file) mirroring `App.passwordDeepLink.spec.tsx`'s three tests, not skipped on the assumption it "obviously" carries over.

### The unsaved-edit hazard

`TableEdit` (`DatasetsPage.tsx:205-260`) holds local `useState` for `name`, `schema`, `description`. **There is no dirty-tracking of any kind today** — `onBack` (Cancel) calls `setView({ mode: "list" })` directly, no `window.confirm`. `window.confirm` appears exactly once in the whole file, for the unrelated Delete action (`:35`).

Three leave-vectors need a decision, not just one:

1. **In-app Cancel button.** Simplest — `TableEdit` already owns both the dirty state (`name !== table.name || schema !== table.schema || description !== (table.description ?? "")`) and the Cancel handler in the SAME component. No cross-component singleton needed here at all; a plain local `if (dirty && !window.confirm(...)) return;` guard inside the existing `onBack` call suffices.

2. **Sidebar navigation away while `TableEdit` is mounted.** This IS cross-component — `App.tsx`'s `Sidebar onSelect` intercept (`:464-473`) is the only place that can stop a `setPage` call before it happens, and `TableEdit` is nested three components deep from there. This is exactly the shape `brandPageGuard` (`components/settings/brandPageGuard.ts`) exists to solve, and the same pattern generalizes cleanly: a new module-level singleton (e.g. `components/tableEditGuard.ts`, sibling to `brandPageGuard.ts`, NOT touching it), `{ isDirty: boolean, revert: (() => void) | null }`, written by `TableEdit` via an effect (mirroring how `BrandingSettingsPage` writes `brandPageGuard`), read by a NEW branch inside `App.tsx`'s existing `onSelect` intercept:
   ```typescript
   // App.tsx Sidebar onSelect — existing branding branch untouched; new sibling branch added.
   if (page === "branding" && brandPageGuard.isDirty) { /* unchanged */ }
   if (page === "datasets" && tableEditGuard.isDirty) {
     if (!window.confirm("Discard unsaved changes to this table?")) return;
     tableEditGuard.revert?.();
   }
   ```
   This is an ADDITION to the `onSelect` closure, not an edit of the existing `if` — low risk to any existing Sidebar-click test.

3. **Browser Back (`popstate`) out of a dirty edit form.** **This is the case 116-CONTEXT explicitly calls "newly reachable" and demands an explicit, stated answer for — it has no dashboard equivalent because dashboards never link an editable-with-unsaved-state screen.** The fundamental difficulty: a `popstate` event fires AFTER the browser has already moved the history pointer — there is no `preventDefault()` for it. The only working technique (the same one `history`-blocking libraries and React Router's navigation blockers use under the hood) is to detect the unwanted back navigation in the `popstate` handler and, if the user declines to discard, **synchronously re-push the entry that was just left**, which visually "undoes" the back:
   ```typescript
   // DatasetsPage.tsx popstate handler — sketch, mirrors DashboardsPage.tsx:136-147's shape.
   useEffect(() => {
     const onPopState = () => {
       if (view.mode === "edit" && tableEditGuard.isDirty) {
         if (!window.confirm("Discard unsaved changes to this table?")) {
           // Cancel the back: put the edit URL right back, same tick, no intermediate render
           // of the list should be visible.
           window.history.pushState({ [TABLE_HISTORY_MARKER]: true }, "", buildTableUrl(window.location, view.table.id, "edit"));
           return;
         }
         tableEditGuard.isDirty = false;
       }
       // ...existing id/mode-driven view-state reconciliation, mirroring DashboardsPage...
     };
     window.addEventListener("popstate", onPopState);
     return () => window.removeEventListener("popstate", onPopState);
   }, [view]);
   ```
   **Known caveats to flag, not hide:** (a) this re-push is itself a `pushState`, which — if the user then presses Back again — pops back to the SAME point, which is correct, but means a user who repeatedly presses Back while repeatedly declining the confirm will grow the history stack by one entry per attempt; acceptable (matches how every SPA nav-blocker behaves) but worth a code comment so a future reader doesn't "fix" it into an infinite-loop bug. (b) `window.confirm` is synchronous and blocks the event loop, so there is no async race with the pushState — safe. (c) automated (jsdom) tests CAN verify the state-machine behavior (dirty + decline → URL restored, form still mounted; dirty + confirm → URL/view proceed to list) but CANNOT verify the real-browser "does the back button feel broken" UX — route that to `checkpoint:human-verify`.

   **Explicit fallback the planner may choose instead:** guard ONLY vectors 1 and 2 above, and deliberately leave browser-Back-out-of-edit unguarded (a Back press silently discards, exactly like today's zero-guard behavior, just now also popping the URL). This is a legitimate, narrower scope — CONTEXT requires an explicit, stated decision, not necessarily the more thorough one. Given the re-push technique is well-understood and not exotic, this research's recommendation is to implement it, but the fallback is real and should be named as such in the plan if the popstate work is deprioritized.

---

## Q4 — Precedence and coexistence of `?dashboard=` and `?table=`

**Confidence: HIGH on the mechanism; the precedence RULE itself is a judgment call, stated as a recommendation.**

**Today, nothing prevents both params coexisting** — `URLSearchParams` treats `dashboard` and `table` as independent keys; a hand-crafted `?dashboard=7&table=12` is syntactically valid and neither existing nor proposed reader rejects it. Confirmed: no code anywhere checks for the OTHER param's presence.

**What would happen with two independent, uncoordinated effects:** `useDeepLinkDashboard` and `useDeepLinkTable` would each independently resolve to `"opened"`; two separate `App.tsx` effects would each call `setPage(...)` (one `"dashboards"`, one `"datasets"`) in the same commit — React's batching means whichever effect is declared LAST wins the final `page` value, an implicit, fragile outcome that depends on source-order, not stated intent. **This must be made explicit, not left to accidental ordering.**

**Recommendation: dashboard wins.** Arbitrary between the two (there is no product reason to prefer one), but it is the simplest rule to state and test, and it means the EXISTING dashboard effect requires zero changes — only the NEW table effect needs a guard clause:
```typescript
// App.tsx — new table-open effect. Existing dashboard effect (:374-391) is untouched.
useEffect(() => {
  if (tableReturnToWonElsewhereRef.current) return;
  if (deepLink.status === "opened" || deepLink.status === "pending") return; // dashboard wins
  if (deepLinkTable.status === "opened") { setPage("datasets"); restoreTableUrl(deepLinkTable.table.id, deepLinkTable.mode); }
  else if (deepLinkTable.status === "unavailable" || deepLinkTable.status === "error") { setPage("datasets"); }
}, [deepLink, deepLinkTable]);
```
This is the ONLY place a new effect needs to read the EXISTING `deepLink` value — a read, not a write, so it cannot regress any dashboard behavior. Recommend a regression test asserting today's baseline (`grep`-verified 0 occurrences of any code handling this today) plus one new test: both params present → dashboard opens, table does not, and (recommended, for honesty) the stale `?table=` param gets stripped once the dashboard resolves, so the address bar doesn't describe two screens at once.

**`deepLinkConsumedRef` / `returnToWonElsewhereRef` — do NOT generalize them; ADD parallel ones.** Both are dashboard-specific one-shot flags read/written inside dashboard-specific effects. Renaming or widening them to be entity-generic would require editing the code the existing 16+ `App.deeplink.spec.tsx` tests exercise line-by-line — real risk for no benefit. Add `tableDeepLinkConsumedRef` and `tableReturnToWonElsewhereRef` as siblings, following the identical shape (`useRef(false)`, flipped inside an effect, never in render, StrictMode-safe by the same pattern). **What breaks if they are NOT made per-entity (i.e., if a plan tries to reuse the dashboard ones for tables to "save a ref"):** the single existing `deepLinkConsumedRef` would be burned by whichever entity's link resolves to `"opened"` FIRST, permanently suppressing the OTHER entity's otherwise-valid, independent deep link for the rest of the session — a real, silent defect. Two refs, cheaply, avoids this entirely.

**`handleSignInCommit` — one function, extended, not duplicated.** Both dashboard-commit and table-commit logic can live in the SAME `handleSignInCommit` (LoginPage has one `onSignInCommit` callback slot already), each gated on its own `deepLink`/`deepLinkTable` `.status === "pending"` check, writing into the SAME payload object conditionally. If both are pending at commit time (the same hand-crafted-URL edge case), the SAME "dashboard wins" rule applies: write `page: "dashboards"` and the dashboard fields; omit the table fields entirely rather than trying to write both a `page: "dashboards"` and stash `tableId` for later — a stashed-but-page-mismatched `tableId` would immediately trip the existing "elsewhere wins"/read-boundary-rejection logic on the OTHER end anyway (since `tableId` would only be honored when the restored `page === "datasets"`, mirroring the existing `dashboardId` validation at `App.tsx:69`), so simply not writing it is equivalent and clearer.

---

## Q5 — Test infrastructure

**Confidence: HIGH — every count below was executed this session against the current tree.**

### Current baseline (run before any Phase 116 code)
```
Test Files  168 passed (168)
     Tests  3778 passed (3778)
```
(`cd packages/web && npx vitest run`, executed 2026-09-14. A handful of unrelated `useDashboardContext must be used inside DashboardContext.Provider` console errors are printed by a pre-existing, unrelated spec's intentional negative-path test — not failures; the summary line is the authoritative count.)

### Existing spec files and counts (protected — must stay green unmodified)

| File | Tests | Role |
|---|---|---|
| `App.spec.tsx` | 38 | Phase 7 ReturnTo core (§"read+restore+clear") |
| `App.deeplink.spec.tsx` | 16 | Phase 114/115 dashboard deep-link wiring |
| `App.passwordDeepLink.spec.tsx` | 3 | Phase 115 password-mode regression |
| `App.signincommit.spec.tsx` | 7 | Phase 115 commit-write + banner signalling |
| `hooks/useDeepLinkDashboard.spec.ts` | 16 | Phase 114 hook state machine |
| `lib/dashboardUrl.spec.ts` | 39 | Phase 113 URL helpers |
| `components/DashboardsPage.urlsync.spec.tsx` | 13 | Phase 113/114 page-level wiring |
| **Total** | **132** | |

### Where new table tests belong

- **`lib/tableUrl.spec.ts`** (new file) — mirrors `dashboardUrl.spec.ts`'s structure exactly, PLUS new describe blocks for `readTableModeFromSearch` (view/edit/absent/unrecognised) and `setTableMode` (marker-preservation across a mode-only replace — the one behavior with no dashboard analogue, so no existing test to mirror; write it fresh).
- **`hooks/useDeepLinkTable.spec.ts`** (new file) — mirrors `useDeepLinkDashboard.spec.ts`.
- **`components/DatasetsPage.urlsync.spec.tsx`** (new file, NOT added into the existing `DatasetsPage.spec.tsx`, which is scoped to the format/metrics modals and has a lighter mock harness with no OL/ResizeObserver stubs — DatasetsPage does not use OpenLayers, so it also does not need `DashboardsPage.urlsync.spec.tsx`'s heavy `ol/*` mocks; a lighter harness closer to `DatasetsPage.spec.tsx`'s existing one is correct) — mirrors `DashboardsPage.urlsync.spec.tsx`'s test titles for open/back/popstate/unmount-clear, plus new tests for the edit→view in-place mode change and the dirty-guard (Cancel, Sidebar-away, popstate).
- **`App.deeplink.spec.tsx` OR a new `App.tableDeeplink.spec.tsx`** — given the existing file is already large (16 tests, dashboard-only) and CONTEXT explicitly favors a clean, separately-reviewable diff, recommend a **new sibling file** `App.tableDeeplink.spec.tsx`, mirroring its mock harness (same Sidebar/Topbar/Toast/api-client stub shape) with a `DatasetsPage` stub added per the trap below, rather than growing the existing file. This also means the existing file's line count and every existing test index/position is untouched — a smaller, easier-to-review diff for the reviewer to confirm "nothing here changed."
- **`App.signincommit.spec.tsx`** — recommend EXTENDING this file (not a new one) for the table-commit-write tests, since it is already structured exactly around `handleSignInCommit`/`onSignInCommit`, and the new table-commit logic lives in the SAME function (per Q4) — testing it in the same file keeps the dashboard-vs-table precedence tests co-located and comparable.

### The `DatasetsPage` stub trap — reconfirmed, applies identically

115-RESEARCH §Q6 and `App.deeplink.spec.tsx:27-32`'s own comment establish: a test stub for the page component that reads the "initial open X" prop as a **plain prop** (not a mount-time `useState(() => prop)` lazy capture) will **falsely report the deep link broken even when `App.tsx` is completely correct**, because `App`'s own effects (the consumed-ref flip) force a second render in which the live prop value has already moved on. This applies byte-for-byte to a `DatasetsPage` stub for `initialOpenTable`:
```typescript
// CORRECT stub shape for App.tableDeeplink.spec.tsx — mirrors App.deeplink.spec.tsx:33-38.
vi.mock("./components/DatasetsPage", () => ({
  default: ({ initialOpenTable }: { initialOpenTable?: { id: number; mode: string } }) => {
    const [captured] = useState(() => initialOpenTable);
    return <main data-testid="page-datasets" data-deeplink={captured ? String(captured.id) : ""} data-mode={captured?.mode ?? ""}>Datasets</main>;
  },
}));
```
A "dumb prop-reflector" stub (`({ initialOpenTable }) => <main data-deeplink={initialOpenTable?.id} />`) will intermittently or consistently read `undefined` on the assertion-relevant render and fail a correct implementation. Flag this explicitly in the plan, exactly as 115-RESEARCH did — it has now been hit and independently reconfirmed by name in two separate research passes (114's original and 115's spike), so treat it as close to certain to bite a third time if not called out.

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

### Pattern 1: Sibling module over shared abstraction, for entity-specific URL/deep-link layers
**What:** A second, independently-readable file that structurally mirrors the first, rather than a generic parameterized core.
**When to use:** When (a) the existing file's spec suite would otherwise need import-path or signature edits, and (b) the new entity has at least one structural dimension (here: `mode`) the original never needed.
**Example:** `lib/tableUrl.ts` mirrors `lib/dashboardUrl.ts`; `hooks/useDeepLinkTable.ts` mirrors `hooks/useDeepLinkDashboard.ts`.

### Pattern 2: Cross-component dirty-guard singleton (generalizing `brandPageGuard`)
**What:** A plain module-level object (`{ isDirty, revert }`), written by the form component via an effect, read synchronously by the navigation intercept that lives several components away.
**When to use:** Whenever a leave-guard must fire from a parent that does not otherwise hold the child's local state, and there is no router-provided blocker API.
**Example (existing, to mirror not modify):**
```typescript
// components/settings/brandPageGuard.ts — the pattern to mirror in components/tableEditGuard.ts
export const brandPageGuard = { isDirty: false, revert: null as null | (() => void) };
```

### Pattern 3: Undo-via-repush for a `popstate`-driven leave-guard
**What:** Since `popstate` cannot be prevented, a declined confirm is "undone" by synchronously re-pushing the entry the user just left.
**When to use:** ONLY when CONTEXT explicitly calls for guarding the browser-Back-out-of-unsaved-state case (true here, per 116-CONTEXT's explicit instruction not to leave it unaddressed).
**Example:** see Q3's `onPopState` sketch above.

### Anti-Patterns to Avoid
- **Renaming or parameterizing `dashboardUrl.ts`/`useDeepLinkDashboard.ts` in place.** Breaks the "unmodified" test gate via import-path churn even when behavior is unchanged.
- **Reusing `deepLinkConsumedRef`/`returnToWonElsewhereRef` for tables instead of adding parallel refs.** One shared one-shot flag between two independent entities silently suppresses whichever resolves second.
- **Building the `getTableById`-based resolution path.** Requires new, uninherited 404-vs-transport-error classification logic that the list+find pattern gets for free.
- **Writing the combined "may be deleted or not permitted" copy as if it were still describing two real, reachable states for tables**, without noting in the plan that only one currently is.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Determining if a table id from the URL/storage is well-formed | A second regex/parse routine | A local `isValidTableId` in `lib/tableUrl.ts`, structurally identical to `isValidDashboardId` (positive-integer type guard) | Tiny (3 lines) — not worth cross-file extraction risk; duplicate deliberately, per Pattern 1 |
| Preventing a Back-button exit from unsaved state | A custom "block navigation" abstraction from scratch | The re-push-on-decline technique (Q3), the same mechanism every SPA history-blocking library uses under the hood | It is the ONLY working technique for a `popstate`-based leave-guard; reinventing it differently is more likely to be subtly wrong than adopting the known shape |

**Key insight:** every piece Phase 116 needs already has a same-shaped sibling somewhere in the existing five files (`App.tsx`, `hooks/useDeepLinkDashboard.ts`, `lib/dashboardUrl.ts`, `components/settings/brandPageGuard.ts`, `components/DashboardsPage.tsx`) EXCEPT the in-place mode-change writer (Q3) and the popstate-undo guard (Q3) — both are genuinely new, both are called out explicitly above rather than glossed over as "just like dashboards."

## Common Pitfalls

### Pitfall 1: Treating the combined error message's rationale as unchanged
**What goes wrong:** a plan states the 114-CONTEXT non-leak rationale for tables verbatim, without noting `GET /api/tables/:id` exists and is unscoped.
**Why it happens:** the CONTEXT.md for this phase describes the rationale as inherited and asks the planner to "verify, do not assume" — easy to skim past given how much of the rest of the phase genuinely IS a direct port.
**How to avoid:** state explicitly, in the plan, that "not permitted" is presently unreachable for tables (Q2).
**Warning signs:** a plan or PR description that copies 114-CONTEXT's dashboard-specific server citations without re-verifying them against `packages/server/src/index.ts`'s table routes.

### Pitfall 2: The `DatasetsPage` prop-reflector stub (reconfirmed, see Q5)
**What goes wrong:** a test stub reading `initialOpenTable` as a plain prop falsely reports a correct `App.tsx` as broken.
**Why it happens:** `App`'s own consumed-ref-flip effect causes a second render in which the live prop value has moved on.
**How to avoid:** mirror the real component's `useState(() => initialOpenTable)` mount-time capture in any stub.
**Warning signs:** a new deep-link test failing with the id showing up empty on the FINAL assertion despite the app looking correct on inspection — this exact failure mode has now occurred at least once (115-RESEARCH §Q1) and been independently reconfirmed once (114/115's own prior comment); expect it a third time if the warning is skimmed.

### Pitfall 3: The mode-preserving replace on Save
**What goes wrong:** `setTableMode` (edit→view after Save) hardcodes the marker state instead of reading `window.history.state` first, so a deep-linked-into-edit arrival that then saves incorrectly starts "popping" (or vice versa, a self-opened edit that saves incorrectly starts "writing" and silently loses a real history entry).
**Why it happens:** it is the one writer with no dashboard precedent to copy verbatim; easy to write it by analogy to `clearDashboardUrl` (which deliberately drops the marker) or `openDashboardUrl` (which deliberately sets it), when it actually needs to do neither — it must preserve whatever was already there.
**How to avoid:** `window.history.replaceState(window.history.state, "", ...)`, not `replaceState(null, ...)` and not `replaceState({[MARKER]: true}, ...)`.
**Warning signs:** a test that only exercises "open via click → edit → save" (marker always true) and never "arrive via `?table=12&mode=edit` → save" (marker always absent) will not catch this — both paths need a test.

### Pitfall 4: Growing history unboundedly on repeated declined Back-outs
**What goes wrong:** the popstate-undo technique (Q3) re-pushes on every declined confirm; a future reader may "simplify" this into something that doesn't, breaking the undo.
**Why it happens:** re-pushing looks redundant to someone unfamiliar with why `popstate` can't be prevented directly.
**How to avoid:** a code comment at the re-push site explaining WHY (already sketched in Q3).
**Warning signs:** a refactor that removes the `pushState` call "because the URL already says the right thing" — it does not; the browser's actual history pointer has already moved.

## Code Examples

### The dashboard pattern this phase mirrors (unchanged by this phase, shown for reference)
```typescript
// lib/dashboardUrl.ts:62-71 — the shape lib/tableUrl.ts's openTableUrl mirrors,
// with a second `mode` argument threaded into buildTableUrl.
export function openDashboardUrl(id: number): void {
  window.history.pushState(
    { [DASHBOARD_HISTORY_MARKER]: true },
    "",
    buildDashboardUrl(window.location, id),
  );
}
```

### The one writer with no dashboard analogue (new, Q3)
```typescript
// lib/tableUrl.ts — NEW. See Pitfall 3 for why window.history.state must be read, not assumed.
export function setTableMode(id: number, mode: TableMode): void {
  window.history.replaceState(window.history.state, "", buildTableUrl(window.location, id, mode));
}
```

## State of the Art

Not applicable — internal state-machine generalization, not a library/ecosystem question.

## Open Questions

1. **Should the popstate-undo guard (Q3, vector 3) actually be built, or explicitly deferred to the narrower fallback (guard only Cancel + Sidebar-away)?**
   - What we know: both are legitimate, CONTEXT requires an explicit stated answer either way, the technique for building it is well-understood and given in full above.
   - What's unclear: whether the added test/review surface is worth it for what may be a rare interaction (pasting an edit-mode link, making changes, then pressing browser Back specifically — as opposed to clicking Cancel).
   - Recommendation: build it — CONTEXT's own framing ("newly reachable... must decide") reads as expecting real coverage, not a documented gap, and the technique is not exotic. But name the fallback explicitly in the plan regardless, so a reviewer sees it was considered.

2. **Does the combined-message banner copy need to change at all for tables, given "not permitted" is unreachable?**
   - What we know: Q2 recommends keeping the wording verbatim for forward-compatibility.
   - What's unclear: whether the operator would prefer the more honest, narrower copy given it's user-facing text they'll UAT-review.
   - Recommendation: keep verbatim per Q2, but flag it explicitly as a discretion point in the plan rather than silently deciding it.

## Verifiable Acceptance Criteria — grep counts (run BEFORE any Phase 116 code, per CLAUDE.md)

Every count below was executed against the current tree this session (`packages/web/src`, branch `chore/ci-and-release-process`). Per CLAUDE.md: `grep -c` counts **matching LINES**, not occurrences — noted below wherever a line could contain a match more than once.

| Proposed criterion | Command (from `packages/web/src`) | Current count | Verdict |
|---|---|---|---|
| `lib/tableUrl.ts` exports the mode reader | `grep -c "readTableModeFromSearch" lib/tableUrl.ts` | **0** (file doesn't exist yet — `grep` on a missing file errors/returns nothing, which reads as absence) | Usable once the file exists; re-run after the plan names the file to confirm it still doesn't pre-exist under a different name — confirmed no file or symbol named `readTableModeFromSearch` exists anywhere in `packages/web/src` today (`grep -rc` returns 0 for all files) |
| `isValidTableId` exists | `grep -rc "isValidTableId" .` | **0** everywhere | Usable — name is free |
| `TABLE_HISTORY_MARKER` / `kbiTableEntry` exists | `grep -rc "TABLE_HISTORY_MARKER\|kbiTableEntry" .` | **0** everywhere | Usable |
| `useDeepLinkTable` hook exists and is called from `App.tsx` | `grep -c "useDeepLinkTable" App.tsx` | **0** | Usable — before/after delta (0 → 1 call site) |
| `initialOpenTable` prop threaded into `DatasetsPage` | `grep -rc "initialOpenTable" .` | **0** everywhere | Usable |
| A table-specific dirty-guard singleton exists | `grep -rc "tableEditGuard" .` | **0** everywhere | Usable — re-run against whichever name the plan actually picks before locking it in |
| `App.tsx`'s Sidebar `onSelect` gained a `datasets` dirty-check branch | `grep -c "page === \"datasets\" && tableEditGuard" App.tsx` | **0** | Usable — specific enough not to collide with the existing unrelated `page === "datasets"` checks (there are others, e.g. line 495's render branch) |
| `ReturnTo` gained the two new fields | `grep -c "tableId?: number" App.tsx` and `grep -c "tableMode?:" App.tsx` | **0** and **0** | Usable — `dashboardId?: number` already exists as the pattern to mirror, confirmed distinct string |
| `sessionStorage.setItem` call sites stay at exactly 2 (unchanged from Phase 115) | `grep -c "sessionStorage.setItem" App.tsx` | **2** today | **Usable as a STABILITY guard, not a "did we build X" criterion** — Phase 116 should NOT add a third call site (the table commit-write reuses the SAME `handleSignInCommit` function and the SAME single `sessionStorage.setItem` inside it, per Q4) — if this count changes to 3, that is a signal a second write path was created where the design calls for one, extended path |
| A new in-place mode-change writer exists | `grep -c "setTableMode" lib/tableUrl.ts` (once file exists) | **0** everywhere today | Usable — re-run against the actual chosen name before locking it into a plan |
| `getTableById` remains unused (regression guard — confirms the Q2 recommendation was followed) | `grep -rc "getTableById" . \| grep -v "api/client.ts"` | **0** (only its own definition matches, in `api/client.ts`) | Usable as a stability guard: this should STAY 0 after Phase 116, confirming the list+find recommendation (Q2) was actually followed and not quietly abandoned for the simpler-looking per-id fetch |
| `window.confirm` call sites in `DatasetsPage.tsx` increase from the pre-existing Delete confirm | `grep -c "window.confirm" components/DatasetsPage.tsx` | **1** today (the Delete confirm) | **Usable as a before(1)/after(≥2) delta only** — `window.confirm` itself is not a novel string (already present), so a bare existence check is toothless; the delta is what discriminates |
| `onClick` exists in `DatasetsPage.tsx` | `grep -c "onClick" components/DatasetsPage.tsx` | **11** today | **Toothless as a bare existence check — already non-zero.** Any new criterion here MUST anchor on a specific new handler name (e.g. a literal `handleTableSignInCommit`-style identifier), never the bare word `onClick` |
| Baseline full-suite count preserved | `cd packages/web && npx vitest run` | **168 files / 3778 tests, 100% pass** (executed this session, 2026-09-14) | Use as the literal before-number; Phase 116's own PR should report the new totals (168+N files, 3778+M tests) rather than asserting an exact new count in a criterion, since the exact number of new tests is a planning decision, not a discoverable fact yet |

**Unprovable-by-grep requirements, routed to `checkpoint:human-verify` per CLAUDE.md:**
- "The popstate-undo re-push doesn't feel janky in a real browser (no visible flash, no double-back-arrow weirdness)." jsdom can prove the STATE MACHINE is correct (declined confirm → URL/view restored; confirmed → proceeds) but not the felt UX of a real back-button press in Chrome/Firefox/Safari. Route to a UAT checkpoint, exactly as 113-UAT/114-UAT did for the dashboard equivalents.
- "The login-page banner copy for tables reads correctly in both light and dark mode." Same class of risk 115-RESEARCH flagged for the dashboard banner (Phase 114's light-mode `.onboarding-banner` defect passed `tsc`/`vitest`/`theme-guard` silently) — `.login-banner` is the same class already proven safe in both themes for the dashboard copy, but new copy still needs a human look, not a grep.
- "The combined unavailable-table message reads honestly given that only one of its two clauses is currently reachable." This is a judgment call (Q2, Open Question 2), not a grep-provable fact.

## Sources

### Primary (HIGH confidence — direct file reads + one executed full-suite run, this session, 2026-09-14)
- `packages/web/src/lib/dashboardUrl.ts` (full file, 109 lines)
- `packages/web/src/hooks/useDeepLinkDashboard.ts` (full file)
- `packages/web/src/App.tsx` (full file, 511 lines)
- `packages/web/src/components/DashboardsPage.tsx` (relevant sections: 1-350, 620-660)
- `packages/web/src/components/DatasetsPage.tsx` (full file, 423 lines)
- `packages/web/src/components/Sidebar.tsx` (relevant sections, nav config)
- `packages/web/src/components/settings/brandPageGuard.ts` (full file)
- `packages/web/src/components/LoginPage.tsx` (relevant sections)
- `packages/web/src/api/client.ts` (relevant sections: `listDashboards`, `TableDto`, `listTables`, `getTableById`, `createTableEntry`, `throwForStatus`)
- `packages/server/src/index.ts` — `app.use("/api", requireAuth)` (`:641`), the route-placement comment block (`:1140-1160`), `/api/tables` route group (`:2348-2379`), grep for `canViewTable`/`DATASETS_VIEW` (none found), grep for `requirePermission(PERMISSIONS.DATASETS_MANAGE)` (write routes only)
- `packages/server/src/lib/permissions.ts` — `PERMISSIONS.DATASETS_MANAGE` definition, confirmed no `DATASETS_VIEW`
- `App.spec.tsx`, `App.deeplink.spec.tsx`, `App.passwordDeepLink.spec.tsx`, `App.signincommit.spec.tsx`, `hooks/useDeepLinkDashboard.spec.ts`, `lib/dashboardUrl.spec.ts`, `components/DashboardsPage.urlsync.spec.tsx`, `components/DatasetsPage.spec.tsx` (full files, all test titles and mock harnesses read)
- `npx vitest run` from `packages/web`, executed this session: `Test Files 168 passed (168)`, `Tests 3778 passed (3778)`
- `.planning/phases/116-table-deep-links/116-CONTEXT.md`, `113-CONTEXT.md`, `114-CONTEXT.md`, `115-CONTEXT.md`, `115-RESEARCH.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (partial — phase map and current-position sections)

### Secondary / Tertiary
None used — entirely internal-codebase research, no web search needed.

## Metadata

**Confidence breakdown:**
- Q1 (generalization shape): HIGH — every option evaluated against actual import graphs and actual test-file contents, not assumption
- Q2 (non-leak / permission model): HIGH — direct route-table read of `packages/server/src/index.ts`, confirmed by absence-of-permission grep across the whole server `lib/` and `index.ts`
- Q3 (mode qualifier + unsaved-edit hazard): HIGH on the design and the hazard's reality; MEDIUM on the popstate-guard recommendation specifically (a legitimate narrower fallback exists and is named)
- Q4 (precedence/refs): HIGH on the mechanism (confirmed no existing coordination code); the "dashboard wins" RULE itself is a recommendation, not a discovered fact — no prior decision exists to verify it against
- Q5 (test infra): HIGH — every count executed this session
- Grep acceptance criteria: every count executed this session; two identified as toothless-if-used-bare (`onClick`, `window.confirm`) and given delta-based replacements instead

**Research date:** 2026-09-14
**Valid until:** tied to this exact commit; treat as valid for 7 days or until the next commit touching `App.tsx`/`DatasetsPage.tsx`/`dashboardUrl.ts`/`useDeepLinkDashboard.ts`/`packages/server/src/index.ts`'s `/api/tables` routes, whichever comes first — consume in the very next `/gsd:plan-phase` invocation.
