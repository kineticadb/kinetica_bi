---
phase: 116-table-deep-links
plan: 04
subsystem: web-ui
tags: [deep-links, history-api, url-sync, tables, react, precedence]

requires:
  - phase: 116-table-deep-links (Plan 02)
    provides: "hooks/useDeepLinkTable.ts — the five-state table deep-link resolution machine"
  - phase: 116-table-deep-links (Plan 03)
    provides: "DatasetsPage.tsx wired to lib/tableUrl.ts, including the initialOpenTable mount-only lazy capture"
provides:
  - "App.tsx wired to useDeepLinkTable: loading hold, initialOpenTable handoff, unavailable banner, explicit dashboard-wins precedence guard"
  - "App.tableDeeplink.spec.tsx — 12 App-level table deep-link tests, all 64 protected Phase 113/114/115 App tests unmodified"
affects:
  - "116-05 — the logged-out/OIDC-round-trip journey (ReturnTo extension, handleSignInCommit) builds on the tableReturnToWonElsewhereRef declared here"
  - "116-06 — any remaining wiring/UAT work reads this plan's precedence effect as the reference implementation"

tech-stack:
  added: []
  patterns:
    - "Sibling effect over shared effect (mirrors the dashboard open effect exactly; the existing dashboard effect has a 0-line diff) — the new table effect alone carries the whole dashboard-wins precedence rule"

key-files:
  created:
    - packages/web/src/App.tableDeeplink.spec.tsx
  modified:
    - packages/web/src/App.tsx

key-decisions:
  - "Dashboard-wins precedence implemented as a single guard clause in the NEW table effect only (`if (deepLink.status !== \"none\") { strip stale ?table=; burn the one-shot; return; }`) — the existing dashboard effect at App.tsx:374-391 has a verified 0-line diff, per the plan's explicit instruction not to add a symmetric guard there"
  - "tableDeepLinkConsumedRef and tableReturnToWonElsewhereRef are NEW, parallel refs — not a reuse of the dashboard's deepLinkConsumedRef/returnToWonElsewhereRef. Sharing would let whichever entity resolves to 'opened' first permanently suppress the other's independent deep link for the rest of the session"
  - "No TLINK-V121-* requirement marked complete by this plan, per explicit success-criteria instruction, even though this plan's frontmatter lists [TLINK-V121-02, TLINK-V121-04] — plans 05-06 remain and the logged-out/OIDC journey is not yet wired"

requirements-completed: []

duration: 9min
completed: 2026-09-14
---

# Phase 116 Plan 04: App.tsx Table Deep-Link Wiring Summary

Wired `useDeepLinkTable` into `App.tsx` as a set of purely additive branches — new imports, new
parallel refs, a new table-open effect carrying an explicit dashboard-wins precedence guard, one
`||` added to the existing loading-hold condition, and one prop added to the `DatasetsPage` render
line — then proved the wiring with a new 12-test App-level spec, with all three mandated mutation
probes executed for real (two reddened as required, the third honestly did not, matching Plan 03's
precedent for the same layer-boundary reason).

## Performance

- **Duration:** ~9 min
- **Started:** 2026-09-14T13:17Z (session start, after Plan 03's commit)
- **Completed:** 2026-09-14T13:26:25Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `App.tsx` now resolves `?table=<id>[&mode=edit]` end to end: holds the app-level `Loading…`
  shell while the link resolves, hands the resolved table to `DatasetsPage` as `initialOpenTable`
  via the same consumed-once ref pattern the dashboard path uses, and lands failures on the tables
  list with a dismissible, non-leaking banner reusing the existing `onboarding-banner`/
  `banner-dismiss` classes — no new className introduced.
- `?dashboard=` vs `?table=` precedence is now explicit and tested: DASHBOARD WINS. The rule lives
  entirely in the new table effect's guard clause (`deepLink.status !== "none"`); the existing
  dashboard effect at `App.tsx:374-391` is untouched (confirmed 0-line diff).
- `tableDeepLinkConsumedRef` and `tableReturnToWonElsewhereRef` declared as NEW, parallel one-shot
  refs — never a reuse of the dashboard's `deepLinkConsumedRef`/`returnToWonElsewhereRef`.
- New `App.tableDeeplink.spec.tsx` — 12 tests, all titled `TLINK-116:`, covering the loading hold,
  view/edit mode resolution, the `mode=banana` fallback-to-view case, the unavailable banner
  (shown / names nothing / dismissible), a transport failure, the one-shot handoff surviving a
  navigate-away-and-back, an unauthenticated arrival, and the two dashboard-wins precedence tests
  (`?dashboard=7&table=12` opens the dashboard only, and strips the stale `?table=`).
- All 64 Phase 113/114/115 protected App tests (`App.spec.tsx`, `App.deeplink.spec.tsx`,
  `App.passwordDeepLink.spec.tsx`, `App.signincommit.spec.tsx`) pass unmodified —
  `git diff --numstat` over those four files is empty.
- Full suite: 172 files / 3875 tests, 100% passing (baseline after Plan 03 was 171 files / 3863
  tests; this plan added exactly 1 file / 12 tests). `theme-guard.spec.ts`: 150 passed.
  `packages/server` diff: empty. `packages/web/src/components/DashboardsPage.tsx`,
  `lib/dashboardUrl.ts`, `hooks/useDeepLinkDashboard.ts`: all empty diffs.

## Task Commits

1. **Task 1: Wire useDeepLinkTable into App.tsx** — `cf1488a` (feat)
2. **Task 2: Create App.tableDeeplink.spec.tsx** — `15bbdb0` (test)

_No separate RED/GREEN split — Task 1 is the App.tsx wiring (verified against the pre-existing
protected suite, which does not need a new test to prove it still passes); Task 2 IS the new test
file, written and immediately green against the Task 1 code. Both tasks were `tdd="true"` in the
plan; each task's own action already produced the final artifact in one commit, matching the same
shape 116-03's summary documented for its own two tasks._

## Files Created/Modified
- `packages/web/src/App.tsx` — added the `useDeepLinkTable`/`hasTableParam`/`clearTableUrl`/
  `restoreTableUrl` imports, the `deepLinkTable` hook call, `deepLinkTableBannerDismissed` state,
  the two new parallel refs, the `initialOpenTable` consumed-once handoff, the new table-open
  effect (dashboard-wins precedence), the extended loading-hold condition, the new unavailable
  banner block, and the `initialOpenTable` prop on the `DatasetsPage` render line.
- `packages/web/src/App.tableDeeplink.spec.tsx` — new, 12 tests, mirrors
  `App.deeplink.spec.tsx`'s mock harness with a lazy-capture `DatasetsPage` stub and a
  `listTables: vi.fn()` addition to the `api/client` mock.

## Decisions Made

1. **Dashboard-wins precedence lives entirely in the new table effect.** Per the plan's explicit
   `RED_FLAG` instruction, the existing dashboard open effect (`App.tsx:374-391`) was NOT touched
   — verified via `git diff --numstat` showing zero changes to that region across both commits.
   The guard (`if (deepLink.status !== "none") { strip stale ?table=; burn one-shot; return; }`)
   is one-sided by design.
2. **Parallel, not shared, one-shot refs.** `tableDeepLinkConsumedRef` and
   `tableReturnToWonElsewhereRef` are declared fresh, following the exact `useRef(false)`,
   flip-inside-an-effect idiom the dashboard refs use — never reused or generalized, per
   116-RESEARCH §Q4's named hazard.

## Deviations from Plan

None — plan executed exactly as written. Every acceptance-criteria grep anchor in the plan was
re-verified at the stated BEFORE count in this session before the edit, and at the stated AFTER
count (or higher, where the plan used `≥`) after it. No protected spec file required editing.

## Mutation Probe Results (Task 2, all executed for real)

**Probe 1 — the precedence guard.** Temporarily deleted the
`if (deepLink.status !== "none") { ...; return; }` guard from the new table effect. Re-ran
`App.tableDeeplink.spec.tsx`: **2 failed, 10 passed** — reddened exactly tests 11 and 12 (the
dashboard-opens-only test failed because `page-datasets` rendered alongside `page-dashboards`; the
stale-param-stripped test failed because `?table=12` remained in `window.location.search`).
Reverted; confirmed via `git diff --stat -- src/App.tsx` (empty against the committed file).

**Probe 2 — the loading-hold / no-flash contract.** Temporarily reverted the loading-hold line
back to `if (deepLink.status === "pending")` (dropping the `|| deepLinkTable.status === "pending"`
clause). Re-ran the spec: **1 failed, 11 passed** — reddened test 1 (the app rendered
`page-datasets` instead of holding on `Loading…` while `listTables` never resolved). Reverted;
confirmed via `git diff --stat -- src/App.tsx` (empty).

**Probe 3 — the stub trap, inverted.** Temporarily replaced this spec's `DatasetsPage` stub with a
plain prop-reflector (reading `initialOpenTable` directly instead of via
`useState(() => initialOpenTable)`), WITHOUT touching `App.tsx`. Re-ran the spec:
**12 passed, 0 failed — did NOT redden.** Recorded honestly rather than manufactured. This matches
116-03-SUMMARY's own probe 3 finding for the same reason: the eager-vs-lazy distinction at the
`DatasetsPage`-stub layer only produces an observable difference through `App.tsx`'s own re-render
churn when SOME other effect forces a second render between the prop being set and the assertion
running (as `App.deeplink.spec.tsx:27-32`'s original finding required a `setDashboardViewMode`
call in the SAME effect flush to manufacture that second render). This plan's table-open effect
calls only `setPage` and `restoreTableUrl` — no second state setter fires in the same flush after
`initialOpenTable` is first computed — so no intermediate render exists for a plain-prop stub to
observe a stale value on. The lazy-capture stub is still the CORRECT contract to mirror (it matches
the real `DatasetsPage.tsx:43-47` implementation exactly, and is the only shape that can never be
wrong regardless of App's internal render timing), but this specific inversion probe does not
discriminate at this layer with this plan's effect shape. Reverted to the lazy-capture stub
regardless — confirmed via `diff` against the pre-mutation file (byte-identical).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `App.tsx` now resolves table deep links end to end for the authenticated-at-boot journey; the
  loading hold, the `initialOpenTable` handoff, the unavailable banner, and the dashboard-wins
  precedence are all wired and tested.
- Plan 05 can extend `ReturnTo`/`handleSignInCommit` for the logged-out/OIDC-round-trip journey,
  reading `tableReturnToWonElsewhereRef` (already declared here, currently always `false` until
  Plan 05's restore effect writes it) and passing a `storedTable` argument into `useDeepLinkTable`.
- No blockers. `git diff --numstat` confirms zero touch to any Phase 113/114/115 protected file,
  to `DashboardsPage.tsx`/`dashboardUrl.ts`/`useDeepLinkDashboard.ts`, and to `packages/server`.

---
*Phase: 116-table-deep-links*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: `packages/web/src/App.tableDeeplink.spec.tsx`
- FOUND: `.planning/phases/116-table-deep-links/116-04-SUMMARY.md`
- FOUND commit `cf1488a` (Task 1 — `feat(116-04): wire useDeepLinkTable into App.tsx`)
- FOUND commit `15bbdb0` (Task 2 — `test(116-04): add App.tableDeeplink.spec.tsx`)
