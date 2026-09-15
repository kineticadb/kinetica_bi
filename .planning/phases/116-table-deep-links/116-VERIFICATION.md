---
phase: 116-table-deep-links
verified: 2026-09-14T18:56:11Z
status: passed
score: 7/7 must-haves verified (all 6 plan-level must_haves sets satisfied; criterion 6 met on clause 1, deliberately/justifiably deviated on clause 2)
---

# Phase 116: Table Deep Links Verification Report

**Phase Goal:** A table's view or edit screen is reachable by URL, exactly as a dashboard is —
bookmarkable, pasteable, and surviving a logged-out arrival.
**Verified:** 2026-09-14T18:56:11Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from the six PLAN.md `must_haves` blocks)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Table id + mode read/written as `?table=<id>` / `?table=<id>&mode=edit` | ✓ VERIFIED | `lib/tableUrl.ts` exports all 11 required symbols; `readTableIdFromSearch`/`readTableModeFromSearch`/`buildTableUrl` present and unit-tested (50 tests, `TABLE_URL_PARAM`/`TABLE_MODE_PARAM` confirmed) |
| 2 | Opening pushes exactly ONE marked history entry | ✓ VERIFIED | `openTableUrl` calls `pushState({[TABLE_HISTORY_MARKER]:true}, ...)` once; tested |
| 3 | Leaving pops when owned, writes when arrived-on (no ejection) | ✓ VERIFIED | `leaveTableUrl()` branches on `TABLE_HISTORY_MARKER`; both branches covered by dedicated tests (`"popped"`/`"wrote"`) |
| 4 | Edit→view after Save rewrites CURRENT entry without disturbing ownership | ✓ VERIFIED | `setTableMode` uses `replaceState(window.history.state, ...)` — see "Highest-Risk Code" section below; both self-opened and arrived-on paths explicitly tested |
| 5 | `?table=<id>` at boot resolves via listTables() once authenticated | ✓ VERIFIED | `useDeepLinkTable.ts`, list+find pattern, gated on `authStatus === "authenticated"` |
| 6 | Unknown table id → "unavailable", param stripped | ✓ VERIFIED | `clearTableUrl()` called before `setState({status:"unavailable"})` |
| 7 | Transport failure → "error", lands on list, no "deleted" claim | ✓ VERIFIED | `.catch()` branch sets `status:"error"`, distinct from "unavailable"; re-arms on non-authenticated to survive mid-flight logout |
| 8 | Unauthenticated arrival stays pending, param survives | ✓ VERIFIED | Effect returns early when `authStatus !== "authenticated"`; state stays `"pending"` |
| 9 | Resolved outcome carries the mode the link named | ✓ VERIFIED | `{status:"opened", table, mode: pendingMode}` |
| 10 | View/Edit buttons write the URL; Save drops mode qualifier in place | ✓ VERIFIED | `DatasetsPage.tsx`: `openTableUrl(t.id,"view"/"edit")` on buttons; `setTableMode(updated.id,"view")` in `onSaved` |
| 11 | Browser Back returns to tables list | ✓ VERIFIED | popstate listener + `leaveTableUrl` wiring; `App.tableDeeplink.spec.tsx` / `DatasetsPage.urlsync.spec.tsx` cover it |
| 12 | In-app Back pops owned entry / writes list URL for arrived-on | ✓ VERIFIED | `onBack={() => { leaveTableUrl(); setView({mode:"list"}); }}` on both view and edit screens |
| 13 | Leaving Datasets clears `?table=` from the address bar | ✓ VERIFIED | Unmount effect calls `clearTableUrl()` |
| 14 | `initialOpenTable` mounts straight into that mode; list never renders | ✓ VERIFIED | Lazy `useState` initializer reads `initialOpenTable` at mount only — structural no-flash guarantee (mutation probe 03-3 on this exact contract did not redden at this layer; App.tsx's own loading-hold, probe 04-2, does redden and is the layer that actually enforces no-flash — see Assessment) |
| 15 | Visiting `?table=<id>` opens directly, no list flash, App-level Loading… held | ✓ VERIFIED | `App.tsx:575` `if (deepLink.status === "pending" \|\| deepLinkTable.status === "pending") return loadingShell;` — additive `\|\|` only |
| 16 | Missing/errored table lands on tables list with dismissible banner, param stripped | ✓ VERIFIED | `App.tsx:614-618` banner block, `onboarding-banner`/`banner-dismiss` (pre-existing classes) |
| 17 | `?dashboard=` and `?table=` both present → dashboard wins, stale `?table=` stripped | ✓ VERIFIED | New table effect (`App.tsx:493-509`) guarded by `if (deepLink.status !== "none") { clearTableUrl(); return; }`; dashboard effect (`App.tsx:465-482`) is **byte-identical to pre-phase** |
| 18 | Navigating away and back doesn't silently re-open the deep-linked table | ✓ VERIFIED | `tableDeepLinkConsumedRef` one-shot guard on `initialOpenTable` |
| 19 | Logged-out table link → login → lands on table post-auth, mode preserved | ✓ VERIFIED | `ReturnTo` extended with `tableId?`/`tableMode?`; `handleSignInCommit` writes both dashboard and table fields to the SAME key; `restoreTableUrl` re-syncs address bar post-OIDC-redirect |
| 20 | Login banner signals pending table link; session-expired wins outright | ✓ VERIFIED | `LoginPage.tsx` bannerText ternary: `session-expired` → `deepLinkPending` (dashboard) → `deepLinkTablePending` (table) → null; `LoginPage.tableBanner.spec.tsx` (9 tests) explicitly asserts precedence both ways |
| 21 | Password sign-in: no sessionStorage write at all (nothing navigated) | ✓ VERIFIED | `App.tablePasswordDeepLink.spec.tsx` (3 tests) |
| 22 | Exactly ONE `kbi_returnTo` key, no second storage key | ✓ VERIFIED | grep confirms single `RETURN_TO_KEY = "kbi_returnTo"` constant, 2 `setItem` / 4 `getItem` / 1 `removeItem` call sites, all on that one key |
| 23 | Dashboard behaviour (Phases 113-115) unchanged — tests pass, shared code generalized | ⚠️ PARTIAL (documented, justified deviation — see Assessment) | Clause 1 (tests pass, files byte-identical) VERIFIED. Clause 2 ("generalized") explicitly NOT done — recorded as `TLINK-F4` |

**Score:** 22/23 fully verified; 1 partially met with an honestly-recorded, reasoned deviation (see Assessment below). No truth failed outright.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/web/src/lib/tableUrl.ts` | URL readers + 4 writers + `setTableMode` | ✓ VERIFIED | 150 lines; all 11 exports present (`TABLE_URL_PARAM`, `TABLE_MODE_PARAM`, `TABLE_HISTORY_MARKER`, `TableMode`, `isValidTableId`, `readTableIdFromSearch`, `readTableModeFromSearch`, `hasTableParam`, `buildTableUrl`, `openTableUrl`, `clearTableUrl`, `restoreTableUrl`, `setTableMode`, `leaveTableUrl`) |
| `packages/web/src/lib/tableUrl.spec.ts` | Unit coverage, `TLINK-116:` markers | ✓ VERIFIED | 50 `it()` blocks, all prefixed `TLINK-116:` |
| `packages/web/src/hooks/useDeepLinkTable.ts` | 5-state resolution machine | ✓ VERIFIED | 129 lines; exports `DeepLinkTableState`, `DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE`, `useDeepLinkTable` |
| `packages/web/src/hooks/useDeepLinkTable.spec.ts` | State-machine coverage | ✓ VERIFIED | 18 `TLINK-116:` tests |
| `packages/web/src/components/DatasetsPage.tsx` | URL writers, popstate, unmount clear, `initialOpenTable` | ✓ VERIFIED | Contains `initialOpenTable`; all key-link patterns present |
| `packages/web/src/components/DatasetsPage.urlsync.spec.tsx` | Page-level URL-sync coverage | ✓ VERIFIED | 17 `TLINK-116:` tests |
| `packages/web/src/App.tsx` | `useDeepLinkTable` wiring, dashboard-wins guard, loading hold, banner, one-shot handoff | ✓ VERIFIED | Contains `useDeepLinkTable(`; new effect at line 493 is additive |
| `packages/web/src/App.tableDeeplink.spec.tsx` | App-level wiring coverage | ✓ VERIFIED | 12 `TLINK-116:` tests |
| `packages/web/src/App.tsx` (Plan 05 extension) | `ReturnTo.tableId`, `readPendingTable`, commit + restore branches | ✓ VERIFIED | `tableId?: number`, `tableMode?: "view"\|"edit"` present in the `ReturnTo` type |
| `packages/web/src/components/LoginPage.tsx` | Table variant of login banner | ✓ VERIFIED | `deepLinkTablePending` prop, precedence ternary |
| `packages/web/src/App.tableSignincommit.spec.tsx` | Commit-moment + precedence coverage, NEW file | ✓ VERIFIED | 15 `TLINK-116:` tests, `App.signincommit.spec.tsx` untouched |
| `.planning/REQUIREMENTS.md` | `TLINK-F1..F4` deferred entries | ✓ VERIFIED | All four present with full reasoning; all 7 `TLINK-V121-*` marked `[x]`/Complete with UAT citation |
| `.planning/phases/116-table-deep-links/116-UAT.md` | Deferred operator walkthrough | ✓ VERIFIED | 16 `UAT-116-*` checks, all `pass`, Coverage Limitation section present |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `tableUrl.ts` | `window.history` | `pushState`/`replaceState`/`back` | ✓ WIRED | All three call forms present |
| `setTableMode` | current entry's existing state | `replaceState(window.history.state, ...)` | ✓ WIRED | Literal match at `tableUrl.ts:133`, confirmed NOT `null` and NOT a hardcoded marker |
| `useDeepLinkTable.ts` | `api/client listTables` | `listTables().then(list => list.find(...))` | ✓ WIRED | Present |
| `useDeepLinkTable.ts` | `lib/tableUrl.ts` | named imports | ✓ WIRED | `readTableIdFromSearch`, `readTableModeFromSearch`, `clearTableUrl`, `isValidTableId`, `hasTableParam` all imported and used |
| `DatasetsPage` View/Edit buttons | `openTableUrl` | `onClick` | ✓ WIRED | `openTableUrl(t.id, "view"/"edit")` alongside `setView` |
| `TableEdit onSaved` | `setTableMode` | in-place mode change | ✓ WIRED | `setTableMode(updated.id, "view")` |
| `DatasetsPage` popstate handler | `readTableIdFromSearch`-family | `addEventListener("popstate", ...)` | ✓ WIRED | Present, calls `clearTableUrl()` on the mismatch branch |
| `App.tsx` | `hooks/useDeepLinkTable` | `useDeepLinkTable(pendingTableFromStorage)` | ✓ WIRED | Present at `App.tsx:187` |
| `App.tsx` | `DatasetsPage initialOpenTable` prop | JSX prop | ✓ WIRED | `App.tsx:621` |
| new table effect | dashboard deep-link state | `deepLink.status !== "none"` guard | ✓ WIRED | `App.tsx:495`, in the NEW effect only |
| `LoginPage` sign-in commit | `kbi_returnTo` | same `handleSignInCommit`, one key | ✓ WIRED | `RETURN_TO_KEY` single constant, both dashboard and table fields written in the same `setItem` payload |
| `kbi_returnTo` | `useDeepLinkTable` | mount-time `useState` initializer | ✓ WIRED | `pendingTableFromStorage` computed via `readPendingTable`-style initializer, passed straight into the hook |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| TLINK-V121-01 | 01, 03 | Opening a table puts a link in the address bar | ✓ SATISFIED | `openTableUrl` wired to View/Edit buttons |
| TLINK-V121-02 | 02, 03, 04 | Visiting a table link opens it directly, no list page first | ✓ SATISFIED | Loading-hold + lazy `initialOpenTable` initializer |
| TLINK-V121-03 | 05 | Logged-out visit routes through login, lands on table | ✓ SATISFIED (client-side logic; OIDC round trip not live-browser-verified — recorded limitation, not a gap) | `ReturnTo` extension, `handleSignInCommit`, `restoreTableUrl`; 3 mutation probes reddened as required |
| TLINK-V121-04 | 02, 03, 04 | Missing/not-permitted table shows clear message | ✓ SATISFIED (narrowed per TLINK-F2, justified) | `DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE`, single-clause copy |
| TLINK-V121-05 | 01, 03 | Browser Back returns to tables list | ✓ SATISFIED | `leaveTableUrl` + popstate listener |
| TLINK-V121-06 | 01, 03 | Leaving a table clears the address bar | ✓ SATISFIED | `clearTableUrl` on unmount + `leaveTableUrl`'s write branch |
| TLINK-V121-07 | 01, 02, 03 | Link distinguishes view vs. edit mode | ✓ SATISFIED | `TableMode` threaded end-to-end |

No orphaned requirements: all 7 TLINK IDs declared across the six plans' `requirements` frontmatter match exactly the 7 IDs in REQUIREMENTS.md's Table Links section.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `App.tsx` | 623 | `"Section coming soon."` | ℹ️ Info | Pre-existing `settings` page placeholder, unrelated to Phase 116 (Settings deep-links are explicitly out of scope per `DLINK-F4`'s "Roles and Settings remain deferred"). Uses the pre-existing `muted` class. Not a phase-116 defect. |

No TODO/FIXME/HACK/PLACEHOLDER markers, no empty handlers, no stub returns found in any of the five Phase 116 source files (`tableUrl.ts`, `useDeepLinkTable.ts`, `DatasetsPage.tsx`, `App.tsx`, `LoginPage.tsx`).

### Gates Run Against Current Tree

```
cd packages/web && npx tsc --noEmit          → clean, 0 errors
npx vitest run                                → Test Files 175 passed (175) / Tests 3902 passed (3902)
npx vitest run src/styles/theme-guard.spec.ts → 1 file passed, 150 tests passed
```

Protected-set subset run in isolation (the 9 spec files covering the 12-path protected set):
`Test Files 9 passed (9) / Tests 158 passed (158)` — matches the documented pre-phase baseline
exactly (158 protected tests, `61b183f`'s number).

`git diff --numstat 61b183f -- <12 protected paths>` → **empty output** (confirmed twice,
independently of the SUMMARY's claim). All 12 files are byte-identical to the pre-phase baseline.

`git diff --numstat 61b183f -- packages/server` → empty (server untouched).
`git diff --numstat 61b183f -- packages/web/package.json` → empty (untouched).
`git diff 61b183f -- packages/web/src/styles/global.css` → empty (no new class invented).

### Highest-Risk Code: `setTableMode`

Confirmed at `packages/web/src/lib/tableUrl.ts:132-134`:

```ts
export function setTableMode(id: number, mode: TableMode): void {
  window.history.replaceState(window.history.state, "", buildTableUrl(window.location, id, mode));
}
```

This passes `window.history.state` **through**, unmodified — not `null`, not a hardcoded
`{[TABLE_HISTORY_MARKER]: true}` marker, and not stripped. Both required behaviours are covered
by dedicated tests in `tableUrl.spec.ts` (`describe("setTableMode")`):
- `"TLINK-116: setTableMode on a SELF-OPENED entry preserves the marker — leaveTableUrl still pops"`
- `"TLINK-116: setTableMode on an ARRIVED-on entry leaves leaveTableUrl in its write branch"`

Both were also subject to a reverted mutation probe (Plan 01, Probe 1: "Dropped `window.history.state`
read, used `null`" → 2 of 50 tests failed as required, then reverted to green). This is
proportionate coverage for the phase's stated highest-risk, no-dashboard-precedent code.

### Specific Checks Requested

- **`window.confirm` in `DatasetsPage.tsx`**: exactly 1 occurrence (the pre-existing "Delete
  dataset" guard, line 114). No new confirm was added — `TLINK-F1`'s scope-out is honored.
- **sessionStorage keys**: exactly one key, `kbi_returnTo` (`RETURN_TO_KEY` constant), used across
  2 `setItem`, 4 `getItem`, 1 `removeItem` call sites in `App.tsx`. No second key exists.
- **Banner copy**: `DEEP_LINK_TABLE_UNAVAILABLE_MESSAGE` = `"This table isn't available — it may
  have been deleted."` — does NOT carry "...or you may not have access." The dashboard's full
  two-clause string (`"This dashboard isn't available — it may have been deleted, or you may not
  have access."`) occurs in exactly one file repo-wide: `useDeepLinkDashboard.ts`.
- **`global.css`**: zero diff since `61b183f`. Both banner classes used (`onboarding-banner`,
  `banner-dismiss`) pre-existed before this phase (already used by the dashboard's own banner).
- **`packages/server`, `packages/web/package.json`**: both unchanged.
- **Dashboard-wins guard placement**: confirmed present ONLY in the new table effect
  (`App.tsx:493-509`); the pre-existing dashboard effect (`App.tsx:465-482`) carries an explicit
  code comment ("The ReturnTo block itself is untouched") and is byte-identical to baseline.

## Assessment of Criterion 6, Clause 2 ("generalized rather than duplicated")

**Clause 1 (dashboard behaviour unchanged) is fully met**, verified independently rather than
taken on faith: `git diff --numstat` against `61b183f` for all 12 protected paths is empty, and
the exact 158-test protected subset passes when run in isolation, matching the documented baseline
count exactly.

**Clause 2 is honestly NOT met**, and the phase says so itself (`TLINK-F4`). Assessing the
trade-off on its merits:

- **Is the trade-off sound?** Yes. The alternative — renaming/parameterizing `dashboardUrl.ts` and
  `useDeepLinkDashboard.ts` — was verified (not merely asserted) to require touching import paths
  in 7 spec files covering 132 tests, which is itself a modification and would have violated
  clause 1. The two ROADMAP clauses are in direct tension for this codebase's existing shape
  (siblings, no shared base — `DashboardsPage.tsx`/`DatasetsPage.tsx` already set this precedent),
  and clause 1 is the one with an unambiguous, mechanically-verifiable bar (byte-identical files,
  158 tests). Prioritizing the harder-edged constraint over the softer, more subjective one is a
  defensible ordering, and the deviation was made as an explicit, dated operator decision rather
  than discovered as an oversight.
- **Is the duplication faithful?** Yes, closely. Read both `tableUrl.ts` and `dashboardUrl.ts`
  side by side: every constant, type-guard, reader, and writer in one has a structurally identical
  counterpart in the other, including the same comments' reasoning restated per-entity, the same
  `replaceState`-vs-`pushState` discipline, and the same idempotency guarantees. The only real
  additions are `TableMode`/`readTableModeFromSearch`/`setTableMode`, which have no dashboard
  analogue by design (dashboards have no edit mode). `useDeepLinkTable.ts` mirrors
  `useDeepLinkDashboard.ts` with the same five-state shape, same list+find resolution strategy,
  and same re-arm-on-mid-flight-logout behavior.
- **Would a bug in one need fixing in both, and is that risk documented?** Yes to both. A bug in,
  say, `leaveDashboardUrl`'s marker-check logic would need the identical fix mirrored into
  `leaveTableUrl` by hand — there is no shared code path that would catch or propagate the fix
  automatically. `TLINK-F4` states this standing cost explicitly ("the standing cost is that a fix
  to one must be mirrored into the other") and names the trigger for revisiting it (a third
  linkable entity, in a phase whose gate permits touching the existing specs). This is the honest
  form the CLAUDE.md guidance asks for: the deviation is recorded with reasoning, not silently
  dropped, and the discriminating evidence (the 132-test count) was verified against the real
  import graph rather than assumed.

**Conclusion:** criterion 6's first clause is met and independently re-verified; its second clause
is knowingly and reasonably not met, with the trade-off, its risk, and its trigger for revisiting
all recorded in `.planning/REQUIREMENTS.md` under `TLINK-F4`. This is graded as satisfied-with-a-
documented-and-justified deviation, not as a gap — the deviation was a deliberate, reasoned
engineering choice under a genuine two-constraint conflict, not an oversight or a shortcut taken
without acknowledgment.

## Human Verification Required

None outstanding. The operator already ran a live 16/16 UAT walkthrough on 2026-09-14
(`116-UAT.md`), covering every check that group-A app-shell testing can reach. The one recorded
coverage limitation — the OIDC half of `TLINK-V121-03` (the real IdP round trip) was not exercised
in a live browser because `packages/server/.env` runs `AUTH_MODE=password` — is a pre-existing,
identically-shaped limitation to `115-UAT.md`'s for the dashboard side of the same mechanism, and
is not something this verification pass can close either (it requires a live OIDC-configured
deployment). Automated coverage substitutes reasonably well for this specific gap: the client-side
logic exercised by an OIDC round trip (the `tableId`/`tableMode` write onto `kbi_returnTo`, and
`restoreTableUrl`'s re-sync after the redirect strips the query string) is pure, IdP-agnostic
client code, fully exercised by `App.tableSignincommit.spec.tsx` and reinforced by three mutation
probes that reddened as required. What automated coverage cannot substitute for is the real network
round trip through an actual IdP — that remains genuinely unverified and should be re-checked live
per `116-UAT.md`'s own recommendation whenever an OIDC deployment is next available. This is
carried forward as a recorded limitation, not re-reported here as a new gap.

### Gaps Summary

No gaps found. All 7 TLINK requirements are implemented, tested, and wired. All 6 plans' must_haves
are satisfied at the artifact, substantive, and wiring levels. The dashboard-regression half of
criterion 6 was independently re-verified (not taken on the SUMMARY's word) and holds exactly:
zero diff on the 12-file protected set, 158/158 protected tests passing, full 3902-test suite
green, `tsc` clean, theme-guard green. The one deliberate scope deviation (criterion 6's
"generalized" clause) is disclosed, reasoned, and recorded in `TLINK-F4` rather than silently
dropped, and this report assesses that trade-off as sound given the genuine two-constraint
conflict the phase faced. The one coverage limitation (OIDC round trip not live-browser-verified)
is likewise pre-existing, disclosed, and mirrors an identical limitation already accepted for the
dashboard side of the same mechanism in Phase 115.

---

_Verified: 2026-09-14T18:56:11Z_
_Verifier: Claude (gsd-verifier)_
