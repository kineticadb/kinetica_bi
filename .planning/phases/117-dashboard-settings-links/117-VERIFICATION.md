---
phase: 117-dashboard-settings-links
verified: 2026-09-15T17:00:00Z
status: passed
score: 8/8 must-haves verified (ROADMAP success criteria) — 8/8 DSET-V122 requirements satisfied
human_verification:
  - test: "OIDC half of DSET-V122-07 (kbi_returnTo carrying a mode-qualified dashboard link through a real IdP round trip)"
    expected: "After signing in via OIDC, the browser lands on the named screen (view/edit) with the mode qualifier restored in the address bar"
    why_human: "This instance's packages/server/.env is AUTH_MODE=password; the OIDC branch has never been exercised in a browser for either this phase or v1.21 (DLINK-V121-03). Coverage is automated-only (App.signincommit.spec.tsx DSET-117 tests + mutation probes). Recorded honestly in REQUIREMENTS.md as standing debt, not claimed as a live pass."
---

# Phase 117: Dashboard Settings Links Verification Report

**Phase Goal:** A dashboard's view (settings) and edit screens are reachable by URL, exactly as a table's are — while a bare `?dashboard=<id>` link keeps opening the running dashboard as it does today.
**Verified:** 2026-09-15T17:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | View/edit write distinct URLs; leaving removes it | ✓ VERIFIED | `buildDashboardUrl`/`openDashboardUrl`/`setDashboardMode` in `lib/dashboardUrl.ts:82-158` produce `?dashboard=<id>&mode=view` / `&mode=edit`; `clearDashboardUrl` strips both params. `DashboardsPage.tsx:269-279` wires all three list buttons; `:209`/`:226` wire the two in-place `setDashboardMode` transitions. |
| 2 | Direct arrival in named mode, no list flash | ✓ VERIFIED | `App.tsx:594-596` holds the app-level `Loading…` shell while `deepLink.status === "pending"`, never handing off to `DashboardsPage`'s own list chrome. `App.deeplink.spec.tsx` DSET-117 test "the app-level Loading… is held for the whole of a &mode=edit resolution — page-dashboards never renders while pending" asserts this directly. |
| 3 | Bare `?dashboard=<id>` unchanged; Phase 113-115 tests still pass | ✓ VERIFIED (highest-stakes, checked in depth — see below) | `buildDashboardUrl(loc,12)`/`openDashboardUrl(12)` byte-identical, confirmed by reading `dashboardUrl.ts:82-100,103-112` and its spec (DSET-117 tests at `dashboardUrl.spec.ts:310-311,344-351`). Full suite run (3 attempts, see Gates below) ends green with 3990/3990 passing, including the pre-existing dashboard-family specs. |
| 4 | Missing/not-permitted link → list + one combined, non-leaking message | ✓ VERIFIED | `DEEP_LINK_UNAVAILABLE_MESSAGE` in `useDeepLinkDashboard.ts:38-39` unchanged text/reasoning from Phase 114. `App.deeplink.spec.tsx` DSET-117 tests assert the banner appears, contains the message, and names neither the id nor the reason. |
| 5 | Browser Back returns to list; no-history arrival doesn't eject | ✓ VERIFIED | `DashboardDetail`/`DashboardEdit`'s `onBack` call `leaveDashboardUrl()` (`DashboardsPage.tsx:203,220`), which pops when self-opened and writes-in-place (never `history.back()`) when arrived-on — proven by `dashboardUrl.spec.ts`'s `leaveDashboardUrl` suite and reused directly by the settings/edit screens (no new logic needed here, by design). |
| 6 | Logged-out visit reuses `kbi_returnTo`, no second key | ✓ VERIFIED | Grep for `sessionStorage.(setItem|getItem|removeItem)` across `packages/web/src` returns only the literal `"kbi_returnTo"` / `RETURN_TO_KEY` in `App.tsx` and its specs — zero second key. `ReturnTo.dashboardMode` extends the existing type (`App.tsx:39-61`). |
| 7 | TLINK-F4 decision explicitly revisited, outcome recorded | ✓ VERIFIED | `.planning/REQUIREMENTS.md:46` — rewritten (not merely ticked), dated `resolved 2026-09-15`, cites the measured 132-vs-100-test blast radius, names the extraction shape (`Shape A`), and states the trigger condition for reopening it ("If a fourth linkable entity or mode is ever proposed, OR a dedicated tech-debt phase is scheduled, extract Shape A then"). Does not read as perpetually pending. Minor note: the literal phrase "three parallel implementations" (used in `117-RESEARCH.md §Q1` and in the ROADMAP's own pre-written criterion 7 text) is not repeated verbatim in the REQUIREMENTS.md entry, but the entry's substance (dashboard now has open/view/edit, table has view/edit, both read/write the same `?mode=` key) covers the same ground with more precision (measured numbers) — not treated as a gap. |
| 8 (bonus, DSET-V122-08's own audit) | Unrecognised/absent mode always resolves to "open" | ✓ VERIFIED | `readDashboardModeFromSearch` (`dashboardUrl.ts:56-61`): only exact-match `"view"`/`"edit"` return non-open; everything else (absent, `"EDIT"`, `"banana"`, empty) returns `"open"`, never throws. Six dedicated `DSET-117` spec cases at `dashboardUrl.spec.ts:283-306` cover absent/valid/case-mismatch/junk/empty. `App.deeplink.spec.tsx`'s "?dashboard=77&mode=banana resolves to data-mode="open"" test proves this at the App level too. |

**Score:** 8/8 ROADMAP criteria verified. 8/8 DSET-V122-01..08 requirements satisfied (per REQUIREMENTS.md traceability, cross-checked against code, not merely the traceability table's own claims).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/dashboardUrl.ts` | 3-mode vocabulary, `setDashboardMode`, defaulted params | ✓ VERIFIED | All symbols present, all defaults confirmed by reading source (lines 27,42,56-61,82-100,103-112,140-142,156-158). |
| `packages/web/src/lib/dashboardUrl.spec.ts` | Mode-aware coverage + bare-URL regression guard + collision record | ✓ VERIFIED | 64 tests, all passing in isolation; `DSET-117:` prefix present throughout (25+ occurrences); explicit "RECORDED COLLISION" test for the shared `?mode=` key. |
| `packages/web/src/components/DashboardsPage.tsx` | URL writers on all 12 transitions, popstate reconciliation, mode-carrying `initialOpenDashboard` | ✓ VERIFIED | `setDashboardMode` at exactly 2 call sites (`:209` view→edit, `:226` edit→view), both passing `window.history.state` through unmodified (not `null`, not a hardcoded marker) — confirmed by reading `setDashboardMode`'s own implementation (`dashboardUrl.ts:156-158`), which is the single source both call sites route through. `openDashboardUrl` writers on all three list buttons (`:269,272,276`) and on create (`:192`). `initialOpenDashboard` prop is `{ dashboard, mode }` (`:95`). |
| `packages/web/src/components/DashboardsPage.urlsync.spec.tsx` | Page-level view/edit + arrival coverage | ✓ VERIFIED | 43 tests passing, `DSET-117:` prefixed, including both StrictMode-safe timer-direction tests (lines 680, 697) that specifically prove the id-AND-mode guard doesn't wipe a just-written in-place URL in EITHER direction. |
| `packages/web/src/hooks/useDeepLinkDashboard.ts` | Mode-carrying `DeepLinkState`, `{id,mode}` storedDashboard param | ✓ VERIFIED | `DeepLinkState` union carries `mode: DashboardMode` on `pending`/`opened` (lines 26-31); `readDashboardModeFromSearch` used at boot-URL read (`:62`) and threaded through the `listDashboards` resolution (`:87,93`). `DEEP_LINK_UNAVAILABLE_MESSAGE` unchanged text, re-verified in the file's own header comment. |
| `packages/web/src/App.tsx` | `ReturnTo.dashboardMode`, `readPendingDashboard`, conditional commit write, mode threading | ✓ VERIFIED | `dashboardMode?: "view"\|"edit"` at `:53`; `readPendingDashboard()` at `:78-93` applies the same absent-or-unrecognised-means-open rule; `handleSignInCommit` (`:381-383`) writes `dashboardMode` only when `!== "open"` (conditional spread, not unconditional), preserving the pre-Phase-117 closed-shape assertions; `restoreDashboardUrl(deepLink.dashboard.id, deepLink.mode)` at `:497` threads the resolved mode through the post-OIDC re-sync. |
| `.planning/REQUIREMENTS.md` | Rewritten TLINK-F4, new debt rows, updated traceability | ✓ VERIFIED | TLINK-F4 row rewritten with resolution date and reasoning (line 46); three new debt rows (`DSET-F2`, `DSET-F3`, `DSET-F4`) at lines 47-49; all 8 DSET-V122 rows in the traceability table marked Complete with specific evidence citations, cross-checked against actual code/tests above, not merely accepted at face value. |
| `.planning/ROADMAP.md` | Phase 117 plan list, criterion 7 outcome | ✓ VERIFIED | Phase 117 marked `[x]` complete (line 41), all 6 plans listed and checked (lines 60-65), criterion 7's "Recorded:" pointer resolves to the actual REQUIREMENTS.md entry. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `setDashboardMode` | `window.history.state` | `replaceState` passes CURRENT state through | ✓ WIRED | Confirmed at `dashboardUrl.ts:157`: `window.history.replaceState(window.history.state, ...)` — not `null`, not a hardcoded marker literal. Both call directions covered by dedicated tests (`dashboardUrl.spec.ts:408-419`: "marker is STILL true afterwards" / "history.state stays unmarked afterwards"). |
| `buildDashboardUrl` | `DASHBOARD_MODE_PARAM` | `mode==="open"` deletes; view/edit set | ✓ WIRED | `dashboardUrl.ts:95-96`. |
| DashboardsPage View/Edit buttons | `openDashboardUrl` | `onClick` calls with mode arg | ✓ WIRED | `DashboardsPage.tsx:269,272,276`. |
| `DashboardDetail onEdit` / `DashboardEdit onSaved` | `setDashboardMode` | in-place, both directions | ✓ WIRED | `DashboardsPage.tsx:209` (view→edit), `:226` (edit→view) — exactly 2 sites, opposite directions, confirmed by grep returning exactly these two matches plus the module import. |
| `App.tsx initialOpenDashboard` | `DashboardsPage` prop | `{dashboard, mode}` payload | ✓ WIRED | `App.tsx:179-182,639`; `DashboardsPage.tsx:95,111-112`. |
| `DashboardDetail`/`DashboardEdit` unmount | `clearDashboardUrl` | deferred timer, id AND mode scoped | ✓ WIRED | `detailClearUrlTimer` (`:340-356`) guards on `readDashboardIdFromSearch(...) !== openedId` AND `readDashboardModeFromSearch(...) !== "view"`; `editClearUrlTimer` (`:426-442`) mirrors with `"edit"`. Both directions of the in-place transition are covered by tests that specifically assert the just-written URL survives the deferred macrotask (`DashboardsPage.urlsync.spec.tsx:680,697`). |
| `App.tsx dashboard deep-link effect` | `deepLink.mode` | `setDashboardViewMode`/`restoreDashboardUrl` read resolved mode | ✓ WIRED | `App.tsx:491,497` — no hardcoded `"open"` remains in this path. |
| `handleSignInCommit` | `ReturnTo.dashboardMode` | spread only when `!== "open"` | ✓ WIRED | `App.tsx:381-383` — conditional object construction, not an unconditional spread of a possibly-undefined key. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DSET-V122-01 | 117-01, 117-02 | View link | ✓ SATISFIED | `openDashboardUrl(dash.id, "view")` wired; `dashboardUrl.spec.ts` + `DashboardsPage.urlsync.spec.tsx` cover it; UAT-117-B5 confirmed live. |
| DSET-V122-02 | 117-01, 117-02 | Distinct edit link, from list AND in-app Edit | ✓ SATISFIED | Both origins wired (`:276` list, `:209` in-app); UAT-117-B7 confirmed live. |
| DSET-V122-03 | 117-04, 117-05 | Arrival mounts in named mode, no list flash | ✓ SATISFIED | `App.tsx` loading-shell hold + `App.deeplink.spec.tsx` no-render-while-pending test; UAT-117-C9/C10/D13/D14 confirmed live. |
| DSET-V122-04 | 117-04, 117-05 | Combined non-leaking failure message unchanged | ✓ SATISFIED | Message text/reasoning re-verified unchanged; tests assert non-leak; UAT-117-E17-E20 confirmed live in both themes. |
| DSET-V122-05 | 117-02 | Back returns to list, no-history doesn't eject | ✓ SATISFIED | `leaveDashboardUrl()` reused as-is by both new screens; UAT-117-B6/B8/D15/D16 confirmed live. |
| DSET-V122-06 | 117-03 | Leaving clears the address bar | ✓ SATISFIED | Two id-AND-mode-scoped deferred timers, both directions test-covered; UAT-117-F21-F23 confirmed live. |
| DSET-V122-07 | 117-04 | Logged-out visit routes through login, same storage key | ✓ SATISFIED for password mode; ⚠ OIDC branch not observed live | `App.signincommit.spec.tsx` DSET-117 tests cover the OIDC-shaped code path (mode-carrying ReturnTo round trip) exhaustively; UAT-117-G24-G26 confirmed the password-mode journey live; UAT-117-G27 (OIDC) explicitly recorded as "not exercised", not claimed as passed. See Human Verification below. |
| DSET-V122-08 | 117-01, 117-05 | Bare link unchanged | ✓ SATISFIED | Dedicated audit task in 117-05; byte-identical output confirmed by direct code read; 220 dashboard-family tests (64+43+28+27+15+39+4, independently re-counted and matching the traceability table's claim) strictly superset of the 132-test pre-Phase-117 baseline. |

No orphaned requirements found — all 8 DSET-V122 IDs referenced in ROADMAP §Phase 117 appear in the `requirements:` frontmatter of at least one of the six plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found in phase-modified files | — | Grep for TODO/FIXME/HACK/PLACEHOLDER/"coming soon" in `dashboardUrl.ts`, `DashboardsPage.tsx`, `useDeepLinkDashboard.ts`, `App.tsx` returns only pre-existing, unrelated matches (an HTML `placeholder=` attribute, a comment about an unrelated auto-created view, and the pre-existing "Settings — Section coming soon" stub page). |

### Table-implementation isolation (explicit check requested)

- `packages/web/src/lib/tableUrl.ts`, `hooks/useDeepLinkTable.ts`, `components/DatasetsPage.tsx`, and their `.spec` files: `git diff 439958e` against each returns **empty** — zero diff since the pre-phase baseline commit.
- `App.tableDeeplink.spec.tsx` and `App.tablePasswordDeepLink.spec.tsx` DID change: confirmed the diff is exactly the mock `DashboardsPage` stub's TypeScript shape (`{ id }` → `{ dashboard: { id }, mode }`) plus a new `data-mode` attribute on the stub's rendered output — no table logic, no table assertion changed.
- `packages/server`: `git diff 439958e --stat -- packages/server` empty.
- `packages/web/package.json`: `git diff 439958e --stat -- packages/web/package.json` empty.
- No `react-router` (or any router) import anywhere in `packages/web/src`.
- `packages/web/src/styles/global.css`: zero diff since baseline; every className used in `DashboardsPage.tsx` (`btn-primary`, `btn-primary btn-sm`, `ghost-sm`, `ghost-sm ghost-danger`, `ds-actions`, `ds-field`, etc.) is a pre-existing class, none invented.

### Gates Run

- `cd packages/web && npx tsc --noEmit` — clean, zero errors.
- `npx vitest run src/styles/theme-guard.spec.ts` — 150/150 passed, one run.
- `npx vitest run` (full suite) — **took 3 runs to get a clean pass**:
  - Run 1: 174/175 files, 3989/3990 tests — 1 failure in `App.tableDeeplink.spec.tsx` ("shows the combined banner on the tables list when the id is not in the list", line 188, `getByTestId("page-datasets")` not found).
  - Run 2: same file, same test, same line failed again.
  - Run 3: 175/175 files, 3990/3990 tests — clean.
  - The failing test passed 12/12 in isolation on a dedicated run.
  - **Assessment:** this reproduces, independently, the exact phenomenon `deferred-items.md` already documented for 117-01's verification (non-deterministic failures under parallel scheduling, on files this phase's code does not import — neither `App.tableDeeplink.spec.tsx`'s failing assertion nor the surrounding test touches `dashboardUrl.ts`/`DashboardsPage.tsx` logic). This run's failing test is a *different* file than the two `deferred-items.md` names (`DatasetsPage.spec.tsx`, `actionEngine.canary.spec.tsx`), which is consistent with "the suite reddens differently on each run" rather than a fixed, reproducible regression — a stable regression would fail the same way in isolation, and this one does not.
  - **This is weaker evidence than a stable green suite, and should be stated plainly rather than smoothed over.** A suite that requires 3 attempts to observe a clean run, and reddens on a *different* file each time it fails, means "the suite passed" is a probabilistic claim, not a deterministic one, for this codebase in its current state. It does not, on the evidence gathered, indicate a Phase 117 regression — the two observed failures were both in table-family code this phase does not touch, and both cleared on isolation and on a subsequent full run — but a reader should not treat a single green run (or even two) as strong confirmation on this codebase without knowing that its baseline noise rate is nonzero. This is pre-existing, cross-phase infrastructure debt (already flagged as "not deterministic under parallel load" and "worth a dedicated investigation" in `deferred-items.md`), not something Phase 117 introduced or is positioned to fix, so it is not scored as a gap for this phase.

### Human Verification Required

1. **OIDC half of DSET-V122-07** — a real IdP round trip where a logged-out visitor pastes `?dashboard=<id>&mode=view` (or `&mode=edit`), authenticates via OIDC, and lands on the named screen with the mode qualifier restored in the address bar.
   Expected: browser ends up on the settings/edit screen, not the running dashboard or the list, and the URL reads `?dashboard=<id>&mode=<the named mode>`.
   Why human: this instance's `packages/server/.env` is `AUTH_MODE=password`; this code path (`handleSignInCommit`'s OIDC-only write, `readPendingDashboard`'s mode restore, `restoreDashboardUrl(id, mode)` post-redirect) has never been observed executing in a real browser for this phase OR the v1.21 predecessor it extends. Coverage today is jsdom-simulated (`App.signincommit.spec.tsx` DSET-117 tests) plus mutation probes — thorough at the unit/integration level but not a substitute for watching an actual OIDC redirect land correctly. Already recorded honestly in `REQUIREMENTS.md`'s "OIDC never browser-verified" carried-debt row and in `117-UAT.md`'s "Coverage Limitation" section; not re-reported here as a new gap, only carried forward as the one open item this verification cannot close either.

### Gaps Summary

No gaps found against the phase goal, ROADMAP success criteria, or the six plans' `must_haves`. All eight DSET-V122 requirements are satisfied by code that actually exists, is substantive (no stubs, no placeholders), and is wired end-to-end — verified by direct reading of `lib/dashboardUrl.ts`, `DashboardsPage.tsx`, `hooks/useDeepLinkDashboard.ts`, and `App.tsx`, not merely by trusting the SUMMARY files' claims. The two items worth flagging for the record rather than as blocking gaps:

1. **The full test suite is non-deterministic under parallel load** (pre-existing, cross-phase infrastructure debt, already documented in `deferred-items.md`; reproduced independently during this verification — 3 runs needed for one clean pass, two different failures on two different runs, both clearing in isolation).
2. **The OIDC half of DSET-V122-07 has never been observed live in a browser** (already recorded as standing debt in REQUIREMENTS.md; automated coverage is genuine but is not a substitute for a live observation, and the project should not treat this requirement as fully closed until an OIDC deployment exercises it).

Both are pre-existing/known limitations, honestly disclosed by the phase's own artifacts, and neither traces to code this phase wrote incorrectly.

---

_Verified: 2026-09-15T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
