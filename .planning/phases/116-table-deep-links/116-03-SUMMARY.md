---
phase: 116-table-deep-links
plan: 03
subsystem: web-ui
tags: [deep-links, history-api, url-sync, tables, react]

requires:
  - phase: 116-table-deep-links (Plan 01)
    provides: "lib/tableUrl.ts — table URL param readers + History-API writers"
provides:
  - "DatasetsPage.tsx wired to lib/tableUrl.ts on all eight mode transitions (list/view/edit/create)"
  - "initialOpenTable prop with a mount-only lazy useState capture (no list flash on deep-link arrival)"
  - "popstate listener (Back returns to list; stale Forward param cleared, never re-opened)"
  - "Deferred unmount clear (StrictMode-safe, instance-scoped, skipped on 401/logout)"
affects:
  - "116-04 — App.tsx wiring will pass initialOpenTable into DatasetsPage and needs the stub-trap lazy-capture contract this plan proved"
  - "116-05/06 — the logged-out/re-auth journey relies on the deferred clear's 401/logout skip"

tech-stack:
  added: []
  patterns:
    - "Mirrors DashboardsPage.tsx's URL-sync wiring shape exactly (mount-only lazy useState, popstate listener, deferred-unmount-clear-with-ref) — no shared abstraction, sibling implementation per 116-RESEARCH Pattern 1"
    - "setTableMode used for the one transition with no dashboard analogue: edit->view in-place mode change on Save, preserving the current entry's marker"

key-files:
  created:
    - packages/web/src/components/DatasetsPage.urlsync.spec.tsx
  modified:
    - packages/web/src/components/DatasetsPage.tsx

key-decisions:
  - "openTableUrl/leaveTableUrl exact-count acceptance criteria (3 / 2) are grep-toothless against this file as written: the plan's own mandated explanatory comments (e.g. 'Note what is NOT here: openTableUrl().') contain the same substring as a real call site and inflate grep -c's line count by one each. Verified the REAL requirement directly instead — actual call sites are exactly 3 for openTableUrl( (View button, Edit button, create->view Save) and exactly 2 for leaveTableUrl() (view->list Back, edit->list Cancel) — and did not edit code or comments to force the grep count, per CLAUDE.md 'never edit code to satisfy a broken check.'"
  - "No TLINK-V121-* requirement marked complete by this plan, per explicit success-criteria instruction, even though this plan's frontmatter lists TLINK-V121-01/05/06/07 — those requirements describe end-to-end behavior not reachable until App.tsx (Plan 04) wires initialOpenTable in."
  - "The DatasetsPage.urlsync.spec.tsx initialOpenTable tests explicitly unmount + flush the deferred-clear macrotask before ending (mirroring DashboardsPage.urlsync.spec.tsx's DEEPLINK-114 pattern) — omitting this caused a real, reproduced test-order failure where a prior test's stale timer cleared a later test's freshly-set ?table=42 (both tests use the same TABLE_DTO id)."

requirements-completed: []

duration: 20min
completed: 2026-09-14
---

# Phase 116 Plan 03: DatasetsPage URL-Sync Wiring Summary

Wired `DatasetsPage.tsx` to `lib/tableUrl.ts` on all eight enumerated mode transitions — including
the two with no dashboard precedent (create→view push, edit→view in-place `setTableMode`) — added
the `initialOpenTable` mount-only lazy capture, the popstate listener, and the deferred
unmount-clear timer, then proved the wiring with a new 17-test page-level spec and three executed
mutation probes (two reddened as required, one honestly did not).

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-14 (session start)
- **Completed:** 2026-09-14T17:14:54Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- Every one of the eight `DatasetsPage` transitions in the plan's transition table now writes (or
  deliberately does not write) the URL exactly as specified, including the two dashboard-less
  cases: `create → view` (Save) pushes via `openTableUrl`, and `edit → view` (Save) does an
  in-place `setTableMode` rewrite that preserves the current entry's marker state.
- `initialOpenTable` prop added with the mount-only `useState(() => …)` lazy capture, mirroring
  `DashboardsPage.tsx:106-108` exactly — a later prop change never re-opens a table, and a
  deep-link arrival mounts straight into view/edit with the list chrome never rendered.
- popstate listener and deferred unmount-clear timer added (net-new to `DatasetsPage` — it had
  neither before), both StrictMode-safe and both correctly skipping the clear when the session has
  ended (401/logout), so a re-auth journey can still see the table id.
- New `DatasetsPage.urlsync.spec.tsx` — 17 tests, all titled `TLINK-116:`, covering
  opening/writing, the in-place mode change (both the self-opened-pop and
  deep-link-arrived-write marker branches), Back/popstate, leaving/unmount, and
  `initialOpenTable`.
- `window.confirm` count in `DatasetsPage.tsx` unchanged at 1 (the pre-existing Delete confirm) —
  the unsaved-edit-form Back guard stayed scoped out per the locked operator decision; `grep -rc
  "tableEditGuard"` is 0 everywhere.
- Zero diff to any Phase 113/114/115 protected file (`DashboardsPage.tsx`,
  `DashboardsPage.urlsync.spec.tsx`, `dashboardUrl.ts`, `useDeepLinkDashboard.ts`) and to the
  pre-existing `DatasetsPage.spec.tsx` — confirmed via `git diff --numstat`, all empty.
- Full suite: 171 files / 3863 tests, 100% passing (baseline after Plans 01+02 was 169 files /
  3828 tests; Plan 02 ran concurrently and added its own file, so the 171/3863 total reflects both
  plans' additions). `theme-guard.spec.ts`: 150 passed. `packages/server` diff: empty.

## Task Commits

1. **Task 1: Wire the URL into every DatasetsPage mode transition + accept initialOpenTable** —
   `1f9b73c` (feat)
2. **Task 2: Create components/DatasetsPage.urlsync.spec.tsx** — `caa550d` (test)

_No TDD split — both tasks were `tdd="true"` in the plan but each task's action already produced
the final code in one commit per the plan's own task boundaries (test-file-only Task 2, code-only
Task 1); no separate RED/GREEN commits were warranted since Task 1 has no accompanying new spec
file of its own (the pre-existing `DatasetsPage.spec.tsx` is verification-only, unmodified) and
Task 2 IS the test file._

## Files Created/Modified
- `packages/web/src/components/DatasetsPage.tsx` — added `initialOpenTable` prop + mount-only lazy
  `useState`, wired `openTableUrl`/`leaveTableUrl`/`setTableMode` into all eight transitions, added
  the popstate listener and the deferred unmount-clear timer (mirrors `DashboardsPage.tsx`'s
  `DashboardOpen` pattern, generalized to the page level since `DatasetsPage` — unlike
  `DashboardOpen` — outlives every table it opens).
- `packages/web/src/components/DatasetsPage.urlsync.spec.tsx` — new, 17 tests, lighter harness
  than `DashboardsPage.urlsync.spec.tsx` (no OpenLayers/ResizeObserver mocks — confirmed
  `DatasetsPage` imports no mapping library).

## Decisions Made

1. **Toothless exact-count criteria, reported not silently satisfied.** Task 1's acceptance
   criteria 2 and 4 (`grep -c "openTableUrl(" ... → exactly 3`, `grep -c "leaveTableUrl()" ...  →
   exactly 2`) actually read **4** and **4** respectively against the file as the plan's own action
   block specifies it — because the plan-mandated explanatory comments (`// Note what is NOT here:
   openTableUrl().` and `// leaveTableUrl()'s unmarked-entry branch...`) are matched by the same
   grep pattern as a real call site. Verified the real requirement by listing every matching line
   with `grep -n` and manually confirming: exactly 3 real `openTableUrl(` CALLS (View button, Edit
   button, create→view Save) and exactly 2 real `leaveTableUrl()` CALLS (view→list Back, edit→list
   Cancel). Did not edit the mandated comments to force the count down — per CLAUDE.md, "never edit
   code to satisfy a broken check." This is the same class of pitfall CLAUDE.md's own "toothless
   grep criteria" table documents, just discovered fresh in this plan's own action block rather
   than in an old acceptance-criteria draft.
2. **Task 2's own header comment tripped its own "no heavy OL mocks" guard** (`grep -c
   "ol/Map\|ResizeObserver" ... → 0`) because the header comment I wrote to explain the *absence*
   of those mocks contained the word "ResizeObserver". Unlike decision 1, this comment was mine
   (not plan-mandated text), so I reworded it to say "heavy map-library mocking block" instead —
   preserves the same explanation without tripping the guard, and the criterion now genuinely
   passes at 0.
3. **Test-order stale-timer hazard, caught by actually running the suite.** The first draft of the
   `initialOpenTable` describe block did not explicitly `unmount()` + flush the deferred-clear
   macrotask at the end of each test (as `DashboardsPage.urlsync.spec.tsx`'s DEEPLINK-114 tests
   do). Running the file surfaced a real failure: test N's `TableEdit`-mode timer (id 42) fired
   during test N+1 (also id 42) and wiped its freshly-set `?table=42`. Fixed by adding the same
   explicit unmount+flush RTL-cleanup-race guard the dashboard spec already uses, rather than
   picking a different (collision-avoiding) table id — the fix matches the documented dashboard
   precedent instead of inventing a new one.

## Deviations from Plan

None requiring a Rule 1-4 classification — no bugs, missing functionality, blocking issues, or
architectural changes were found in the WIRING itself. The two items above (toothless-criteria
report, and the test-order fix) are execution-process findings, not deviations from the plan's
design.

## Mutation Probe Results (Task 2, all executed for real)

**Probe 1 — Pitfall 3, the mode-preserving replace on Save.** Temporarily changed
`DatasetsPage.tsx`'s edit→view Save call from `setTableMode(updated.id, "view")` to
`openTableUrl(updated.id, "view")`. Re-ran `DatasetsPage.urlsync.spec.tsx`: **1 failed, 16
passed** — reddened test 4 ("Save from the edit screen rewrites the bar to `?table=42` and does
NOT change `history.length`", which failed with `history.length` off by one because
`openTableUrl` pushes a spurious second entry). Reverted; suite returned to **17 passed, 0
failed**; confirmed via `git status --short` that the file was byte-identical to the committed
version.

**Probe 2 — the ejection guard.** Temporarily changed `TableDetail`'s `onBack` from
`leaveTableUrl()` to `clearTableUrl()`. Re-ran the spec: **1 failed, 16 passed** — reddened test 5
("after a Save on a SELF-OPENED edit, the in-app Back still POPS (marker preserved)", which failed
because `window.history.back` was never called — `clearTableUrl` replaces in place instead of
popping). Reverted; suite returned to **17 passed, 0 failed**, confirmed clean via `git status
--short`.

**Probe 3 — the no-flash contract (lazy vs eager `useState`).** Temporarily changed the
`useState<View>` initializer from `useState<View>(() => ...)` to the eager `useState<View>(...)`
form. Re-ran the spec: **17 passed, 0 failed — did NOT redden.** This is the EXPECTED, documented
result at the component level per the plan's own acceptance criterion 7 and per
`App.deeplink.spec.tsx:27-32`'s established finding: the eager-vs-lazy distinction only produces an
observable difference through `App.tsx`'s own re-render churn (the consumed-ref flip forcing a
second render where the live prop value has moved on), which this plan's scope does not include —
that coverage belongs to Plan 04. Recorded honestly rather than editing the spec to manufacture a
failure that doesn't exist at this layer.

## Issues Encountered

None beyond the test-order stale-timer fix documented in Decisions Made #3, which was caught and
fixed within Task 2 before commit (not a post-hoc patch).

## Carried-Forward Tech Debt (not fixed, per output instructions)

**Sidebar "Datasets" entry is a no-op while a table is open** — confirmed present, the tables twin
of the pre-existing "Sidebar 'Dashboards' no-op while a dashboard is open" tech debt referenced in
116-CONTEXT (originally `App.tsx:355` for dashboards). `App.tsx`'s `Sidebar onSelect` handler calls
`setPage(key as Page)` unconditionally; since `page === "datasets" && <DatasetsPage />` gates
purely on the `Page` string identity (`App.tsx:495`), clicking "Datasets" while `page` is already
`"datasets"` and a table is open does not remount `DatasetsPage` or reset its internal `view`
state — the click is visually a no-op. Not fixed here, per the same instruction that left the
dashboard equivalent open; both should be addressed together if ever picked up.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `lib/tableUrl.ts` (Plan 01) and `DatasetsPage.tsx` (this plan) are both fully wired and tested;
  `hooks/useDeepLinkTable.ts` (Plan 02) landed concurrently in this same wave.
- Plan 04 (`App.tsx` wiring) can now pass `initialOpenTable` into `DatasetsPage` with full
  confidence in the mount-only lazy-capture contract — this plan proved it holds at the component
  level; Plan 04 additionally needs the `App`-level stub-trap coverage (`App.deeplink.spec.tsx`
  precedent) since that is where the eager-vs-lazy distinction actually bites.
- No blockers. `git diff --numstat` confirms zero touch to any Phase 113/114/115 protected file or
  to `packages/server`.

---
*Phase: 116-table-deep-links*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: `packages/web/src/components/DatasetsPage.urlsync.spec.tsx`
- FOUND: `.planning/phases/116-table-deep-links/116-03-SUMMARY.md`
- FOUND commit `1f9b73c` (Task 1 — `feat(116-03): wire DatasetsPage to lib/tableUrl on every mode transition`)
- FOUND commit `caa550d` (Task 2 — `test(116-03): add DatasetsPage.urlsync.spec.tsx`)
