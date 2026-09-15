---
phase: 117-dashboard-settings-links
plan: 05
subsystem: ui-tests
tags: [react, vitest, deep-linking, dashboards, mutation-testing, regression-audit]

# Dependency graph
requires:
  - phase: 117-dashboard-settings-links (plan 01)
    provides: "DashboardMode type, readDashboardModeFromSearch, three-mode buildDashboardUrl/openDashboardUrl/restoreDashboardUrl in lib/dashboardUrl.ts"
  - phase: 117-dashboard-settings-links (plan 02)
    provides: "DashboardsPage's twelve mode transitions, the { dashboard, mode } stub shape all three App spec files' DashboardsPage mock installs"
  - phase: 117-dashboard-settings-links (plan 04)
    provides: "App.tsx's deepLink.mode threading through the dashboard deep-link effect, handleSignInCommit's conditional payload, and initialOpenDashboard's page prop"
provides:
  - "App-level, black-box proof (through the real App component, real hooks, stubbed children) that ?dashboard=<id>&mode=view/edit/bare all arrive at the correct screen, that the no-flash contract holds structurally, and that the combined failure banner still leaks nothing"
  - "App-level proof that the logged-out OIDC journey round-trips the mode qualifier through the SAME kbi_returnTo key, including backward compatibility with pre-Phase-117 mode-less ReturnTo blobs and an unrecognised stored mode falling back safely"
  - "A recorded, evidence-based audit (not an assumed green suite) that DSET-V122-08's bare-URL contract survived Phase 117 unweakened at the lib, hook, page and two App layers"
affects: [117-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "listTables stub added to App.deeplink.spec.tsx's api/client mock: a dashboard-wins precedence test with a `&table=` param in the URL activates useDeepLinkTable's own network call, which was previously unmocked in that file and would otherwise attempt a real fetch (same class of gotcha the file's existing WMS-probe stub comment documents)."
    - "Commit-scoped git log -p --grep audit (not a bare git diff) for detecting deleted/weakened test assertions after Task Commit Protocol has already committed every edit — the bare form is provably 0 unconditionally on a clean tree, per this plan's own critical-warning correction."

key-files:
  created: []
  modified:
    - packages/web/src/App.deeplink.spec.tsx
    - packages/web/src/App.signincommit.spec.tsx
    - packages/web/src/App.passwordDeepLink.spec.tsx
    - packages/web/src/App.spec.tsx

key-decisions:
  - "Followed 117-RESEARCH §Q5's pre-flight correction verbatim: App.spec.tsx's harness does not stub listDashboards, so a VALID dashboardId paired with a dashboardMode would leave the deep link permanently 'pending' and attempt a real network call. Only the ONE negative case that harness can carry (dashboardMode present, dashboardId absent) was added there; the six positive mode-read-validation cases (view/edit/bare-write, edit-restore, unrecognised-falls-back, absent-mode-backward-compat) were placed in App.signincommit.spec.tsx, which already stubs listDashboards."
  - "Task 1 bullet 7 (the no-flash hold) was written to mirror the EXISTING DEEPLINK-114 loading-hold test's sequencing exactly — a never-settling listDashboards promise, asserting Loading… present and page-dashboards absent, with no flush — rather than inventing a resolve-then-assert pattern, per the plan's explicit instruction not to invent a different flush."
  - "No DSET requirement marked complete, per this plan's own explicit instruction (critical warning 8) — closure remains Plan 06's responsibility after operator UAT."

requirements-completed: []

# Metrics
duration: ~45min
completed: 2026-09-15
---

# Phase 117 Plan 05: App-level arrival, logged-out journey, and bare-URL regression audit Summary

**Proved end-to-end, through the real `App` component, that a dashboard settings link
(`?dashboard=<id>&mode=view|edit`) arrives on the named screen with no list flash, that the
bare `?dashboard=<id>` link everyone already has is untouched, and that the logged-out OIDC
journey carries the mode qualifier through the single `kbi_returnTo` key — then closed with a
recorded, mutation-tested audit rather than a green-suite assumption.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-15T19:28:00Z (approx.)
- **Completed:** 2026-09-15T19:42:41Z
- **Tasks:** 3 completed (Task 3 produced evidence only — no file diff)
- **Files modified:** 4 (all spec files; zero production code diff)

## Accomplishments

### Task 1 — App-level arrival coverage for all three modes

Extended `App.deeplink.spec.tsx` with 11 new `DSET-117:`-titled tests covering all 11 behaviour
bullets: `mode=view`/`mode=edit`/bare arrival resolving to `data-mode="view"`/`"edit"`/`"open"`
respectively; the bare-URL address bar carrying no `mode` substring (two independent
assertions, per the plan's instruction, so a single `toBe` couldn't pass on a dropped param);
the `&mode=view` address bar reading exactly `?dashboard=77&mode=view`; `&mode=banana` falling
back to `"open"` rather than the failure banner; the app-level `Loading…` hold structurally
proven (mirroring the existing `DEEPLINK-114` never-settling-promise pattern, no invented
flush); the combined failure banner + its non-leaking content for a `mode`-carrying miss; the
unauthenticated arrival keeping both params in the bar; and the dashboard-wins precedence rule
re-confirmed with a mode-carrying dashboard link against a stale `?table=`.

One deviation found and fixed during this task: the new precedence test introduces a `&table=`
param, which activates `useDeepLinkTable`'s own network call — this file's `api/client` mock
never stubbed `listTables` (it only ever needed the dashboard path before), so the first run
hit a real fetch and fell back to the login page. Added `listTables: vi.fn(() =>
Promise.resolve([]))` to the mock, mirroring the same class of fix the file's own existing WMS
probe comment documents (Rule 3 — blocking issue).

File: **16 -> 27 passing tests.**

**Mutation Probe A** (hardcode `initialOpenDashboard`'s `mode` to `"open" as const` instead of
`deepLink.mode`): **3 failed** (bullets 1, 2, and 11 — the `view`, `edit`, and precedence
tests). Reverted; `git diff --numstat` on `App.tsx` empty afterward.

**Mutation Probe B** (hardcode `restoreDashboardUrl`'s mode argument to `"view"` instead of
`deepLink.mode`): **3 failed** (bullet 4, plus two pre-existing `AUTHLINK-115` address-bar
tests that this probe also reddened because they assert the exact bare `?dashboard=7`
string). Reverted; diff empty afterward.

### Task 2 — the logged-out journey carries the mode through the one storage key

- `App.signincommit.spec.tsx`: 8 new `DSET-117:` tests — the commit-write payload for
  `mode=view`/`mode=edit`/bare pending links (the last restating, as a deliberate named
  requirement, the shape the two pre-existing closed-shape assertions already protect);
  restore-to-screen for a stored `dashboardMode: "edit"` (landing on `data-mode="edit"` and
  restoring `?dashboard=12&mode=edit` to the bar); an unrecognised stored mode (`"hacker"`)
  falling back to `"open"` rather than failing; a mode-less stored ReturnTo (pre-Phase-117
  shape) also falling back to `"open"`; single-use clearing after a mode-carrying restore; and
  a `kbi_`-prefix key enumeration (`Object.keys(sessionStorage).filter(...)`) proving no second
  storage key is ever written.
- `App.passwordDeepLink.spec.tsx`: 1 new `DSET-117:` test — a password-mode
  `?dashboard=12&mode=edit` arrival writes nothing to `kbi_returnTo` (the URL itself is the
  carrier, as the file's existing bare-link tests already established) and lands on
  `data-mode="edit"` after the in-place authenticated flip.
- `App.spec.tsx`: 1 new `DSET-117:` test, per the pre-flight deviation recorded above — a
  ReturnTo carrying `dashboardMode` with no `dashboardId` renders the dashboards page (no
  `Loading…` wedge) and clears the key.

The two pre-existing closed-shape assertions at `:115`/`:128`
(`toEqual({ dashboardId: 12, page: "dashboards" })`) are byte-identical — verified with
`git diff -U0 | grep -c` returning 0.

Combined: **48 -> 58 passing tests** across the three files.

**Mutation Probe A** (always include `dashboardMode` in the commit payload, dropping the
`d.mode === "open"` conditional): **3 failed** — bullet 3 plus the two pre-existing
closed-shape tests, exactly as the criterion demanded. Reverted (introduced a TS type error
along the way — `DashboardMode` is not assignable to `"view" | "edit" | undefined` — confirming
the conditional exists for a real type reason too, not only the JSON-shape reason the comment
already states).

**Mutation Probe B** (hardcode `readPendingDashboard`'s derived mode to `"open"` always):
**1 failed** (bullet 4, the stored-`edit`-restores-to-edit test). Reverted.

**Mutation Probe C** (hardcode the fallback branch to `"view"` instead of `"open"`): **2
failed** (bullets 5 and 6, the unrecognised-mode and absent-mode fallback tests). Reverted.

### Task 3 — the DSET-V122-08 audit

No code changes — this task produces evidence, recorded here as literal numbers.

**Step 1 (seven-file run):** **220 tests, 0 failed** across
`lib/dashboardUrl.spec.ts`, `hooks/useDeepLinkDashboard.spec.ts`,
`components/DashboardsPage.urlsync.spec.tsx`, `App.spec.tsx`, `App.deeplink.spec.tsx`,
`App.passwordDeepLink.spec.tsx`, `App.signincommit.spec.tsx` — strictly greater than the
132-test pre-Phase-117 baseline.

**Step 2 (deleted `expect(` lines, commit-scoped):**
```
git log -p --grep='(117-0[1-5])' -- <the seven files> | grep -c '^-.*expect('
```
→ **0**. Confirmed run from the repository root (running it from `packages/web` with the same
`packages/web/...`-prefixed paths silently returns 0 unconditionally too, for the identical
path-doubling reason the plan's own critical warning describes for the un-scoped `git diff`
form — re-ran from root to make sure this 0 is the real number, not another toothless 0).

**Step 3 (deleted whole tests, commit-scoped):**
```
git log -p --grep='(117-0[1-5])' -- <the seven files> | grep -c '^-.*it("'
```
→ **5**, non-zero, enumerated and justified below (all five are Plan 04's own recorded
title-only prose renames, not test deletions):

| Deleted `it("` line | Replaced by | Justification |
|---|---|---|
| `AUTHLINK-115: storedId 12 on a bare URL + authenticated + list contains 12 -> opened` | `AUTHLINK-115: stored dashboard 12 on a bare URL + authenticated + list contains 12 -> opened` | Title-only rename (`storedId` → `stored dashboard`), documented in 117-04-SUMMARY.md's "Decisions Made" — retires the stale pre-Phase-117 parameter name from test prose. Body/assertions unchanged (confirmed by Step 2's 0). |
| `AUTHLINK-115: storedId 12 with auth status unknown at boot stays pending until authenticated, then resolves` | `AUTHLINK-115: stored dashboard 12 with auth status unknown at boot stays pending until authenticated, then resolves` | Same rename, same justification. |
| `AUTHLINK-115: URL "?dashboard=7" beats storedId 12 -> resolves 7, not 12` | `AUTHLINK-115: URL "?dashboard=7" beats stored dashboard 12 -> resolves 7, not 12` | Same rename, same justification. |
| `AUTHLINK-115: storedId null/undefined/absent on a bare URL -> none, listDashboards never called` | `AUTHLINK-115: stored dashboard null/undefined/absent on a bare URL -> none, listDashboards never called` | Same rename, same justification. |
| `AUTHLINK-115: invalid storedId shapes (0, -3, 1.5, "12") on a bare URL -> none, listDashboards never called` | `AUTHLINK-115: invalid stored dashboard shapes (0, -3, 1.5, "12") on a bare URL -> none, listDashboards never called` | Same rename, same justification. |

Spot-checked the actual diff hunk for the first pair with `git log -p | grep -A2` to confirm
the `describe`/`it` lines are a matched rename (old line removed, new line with only the prose
changed added immediately after), not a deletion-and-different-replacement.

**Step 4 (fallback mutation probe):** Changed `readDashboardModeFromSearch`'s final
`return "open"` to `return "view"` in `lib/dashboardUrl.ts`. Re-ran the seven-file command:
**5 failing files / 15 failing tests** — `lib/dashboardUrl.spec.ts`,
`hooks/useDeepLinkDashboard.spec.ts`, `App.deeplink.spec.tsx`, `App.passwordDeepLink.spec.tsx`,
`App.signincommit.spec.tsx`. Exceeds the required "at least THREE of the seven files"
threshold (5 of 7). Reverted; `git diff --numstat -- lib/dashboardUrl.ts
hooks/useDeepLinkDashboard.ts components/DashboardsPage.tsx App.tsx` empty afterward, and the
seven-file run confirmed green again (220/220) before proceeding.

**Step 5 (table-family diff):**
```
git diff --name-only -- lib/tableUrl.ts hooks/useDeepLinkTable.ts components/DatasetsPage.tsx \
  lib/tableUrl.spec.ts hooks/useDeepLinkTable.spec.ts components/DatasetsPage.urlsync.spec.tsx \
  App.tableDeeplink.spec.tsx App.tablePasswordDeepLink.spec.tsx
```
→ **no output.** No table file was edited to accommodate the `?mode=` collision Plan 01
recorded and accepted (`lib/dashboardUrl.ts`'s `clearDashboardUrl` header comment) — it remains
the documented, deliberate, un-fixed edge case.

## Full-suite / gate confirmation

- `cd packages/web && npx tsc --noEmit` — clean, exit 0.
- `cd packages/web && npx vitest run` — **175 files / 3990 tests, 100% pass** (baseline after
  Plan 04 was 3969; net **+21**, exactly the new tests: 11 (Task 1) + 8 + 1 + 1 (Task 2) = 21;
  Task 3 added none). The `useDashboardContext must be used inside DashboardContext.Provider`
  stderr line seen during the run is `DashboardContext.spec.tsx`'s own pre-existing intentional
  negative-path console error (also noted in 117-04-SUMMARY.md), not a failure — the summary
  line confirms 3990/3990 passed.
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` — **150/150 green.**
- `git diff --stat -- packages/server` — no output.
- Table-family diff (`App.tableDeeplink.spec.tsx`, `App.tablePasswordDeepLink.spec.tsx`,
  `DatasetsPage.urlsync.spec.tsx`): empty throughout.
- Production-code diff (`App.tsx`, `DashboardsPage.tsx`, `dashboardUrl.ts`,
  `useDeepLinkDashboard.ts`): empty — every mutation probe above was reverted; this plan is
  tests only.

## Task Commits

1. **Task 1: App-level arrival coverage for all three modes** - `32f093d` (test)
2. **Task 2: The logged-out journey carries the mode through the one storage key** - `818d1c9` (test)
3. **Task 3: The DSET-V122-08 audit** - no commit (evidence-only task, zero file diff)

**Plan metadata:** (this commit, once STATE.md/ROADMAP.md are updated below)

## Files Created/Modified

- `packages/web/src/App.deeplink.spec.tsx` - 11 new `DSET-117:` tests; added a `listTables`
  stub to the file's `api/client` mock (Rule 3 fix — the precedence test's `&table=` param
  would otherwise hit a real network call).
- `packages/web/src/App.signincommit.spec.tsx` - 8 new `DSET-117:` tests; added a `DASH_12`
  fixture and a `listDashboards` import.
- `packages/web/src/App.passwordDeepLink.spec.tsx` - 1 new `DSET-117:` test.
- `packages/web/src/App.spec.tsx` - 1 new `DSET-117:` test (the harness's one negative-case
  slot, per the recorded pre-flight deviation).

## Decisions Made

- **Followed the pre-flight correction in the plan's context block exactly**: placed the six
  positive mode-read-validation tests in `App.signincommit.spec.tsx` (which stubs
  `listDashboards`) rather than `App.spec.tsx` (which does not and would wedge on a valid id),
  and gave `App.spec.tsx` exactly the one negative-case test its harness can carry.
- **No DSET requirement marked complete**, per this plan's own explicit instruction — closure
  is Plan 06's responsibility, after operator UAT.
- **Task 3's Step 3 non-zero result (5) was investigated rather than treated as a red flag**:
  cross-referenced against 117-04-SUMMARY.md's own recorded decision (the six-occurrence
  `storedId` → `stored dashboard` prose rename), confirmed each deleted `it(` line is
  immediately followed by an added `it(` line differing only in the renamed noun, and confirmed
  Step 2's 0 (no `expect(` lines touched) is consistent with a prose-only rename.

## Deviations from Plan

### Auto-fixed issues (Rule 3 — blocking issue)

**1. `App.deeplink.spec.tsx`'s `api/client` mock never stubbed `listTables`.**
- **Found during:** Task 1, writing the dashboard-wins-precedence-with-mode test (bullet 11),
  which introduces a `&table=12` param alongside `&dashboard=7&mode=view`.
- **Issue:** That param activates `useDeepLinkTable`'s own resolution effect, which calls the
  real (unmocked) `listTables()`. The first run hit a genuine network request, which failed and
  dispatched `UNAUTHORIZED_EVENT`, logging the test out mid-await — the test found `login-page`
  instead of `page-dashboards`.
- **Fix:** Added `listTables: vi.fn(() => Promise.resolve([]))` to the file's existing
  `api/client` mock, immediately above the pre-existing WMS-probe stub whose own comment
  documents the identical class of gotcha (an unmocked call hitting a real network request
  during an authenticated-mount test).
- **Files modified:** `packages/web/src/App.deeplink.spec.tsx`.
- **Commit:** `32f093d`.

### Toothless-criteria risk checked and confirmed NOT toothless

**2. Step 2/Step 3's commit-scoped `git log -p` commands were run from `packages/web`
first, which returned 0 for both — matching the expected values, but for a suspicious reason
worth recording.**
- **Found during:** Task 3, Step 2.
- **Issue:** The plan's critical warning explicitly names path-doubling as the failure mode
  that makes a superficially-plausible command silently return 0 unconditionally (the bare
  `git diff -U0` case). Running `git log -p -- packages/web/src/...` from inside
  `packages/web/` would resolve those paths as `packages/web/packages/web/src/...`, which do
  not exist — an identical silent-zero trap, just relocated to Step 2/3 instead of the
  `git diff` this plan already corrected.
- **Resolution:** Re-ran both commands from the repository root and separately confirmed with
  `git log --oneline --grep=... -- <files>` that the grep pattern actually matches 7 real
  commits (including this plan's own two Task 1/2 commits) — not an empty match set. Step 2's 0
  and Step 3's 5 are therefore the real, non-toothless numbers.
- **Files affected:** none (verification only, no code or test change).

## Issues Encountered

None beyond the two items above (one auto-fixed test-infrastructure gap, one verification
double-check) — both resolved within this plan's scope.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All four DSET-V122 requirements this plan targets (-03, -04, -07, -08) now have executed,
  mutation-tested App-level coverage; none are marked complete in REQUIREMENTS.md — that
  remains Plan 06's job after operator UAT.
- Full suite: 175 files / 3990 tests, 100% green; theme-guard 150/150 green; zero production
  diff; zero table-family diff; zero server diff.
- Plan 06 can proceed directly to the operator UAT + closure step with this plan's SUMMARY as
  its evidentiary record for DSET-V122-08 specifically (the audit numbers above), rather than
  needing to re-derive them.

## Self-Check: PASSED

- FOUND: packages/web/src/App.deeplink.spec.tsx
- FOUND: packages/web/src/App.signincommit.spec.tsx
- FOUND: packages/web/src/App.passwordDeepLink.spec.tsx
- FOUND: packages/web/src/App.spec.tsx
- FOUND: .planning/phases/117-dashboard-settings-links/117-05-SUMMARY.md
- FOUND commit: 32f093d
- FOUND commit: 818d1c9

---
*Phase: 117-dashboard-settings-links*
*Completed: 2026-09-15*
