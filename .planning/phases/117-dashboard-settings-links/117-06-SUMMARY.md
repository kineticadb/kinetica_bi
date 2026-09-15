---
phase: 117-dashboard-settings-links
plan: 06
subsystem: docs
tags: [requirements, roadmap, uat, deep-linking, dashboards]

# Dependency graph
requires:
  - phase: 117-dashboard-settings-links (plans 01-05)
    provides: "The complete dashboard settings/edit deep-link implementation and its mutation-probe-verified test coverage (220 dashboard-family tests, 3990 total suite tests)"
provides:
  - "TLINK-F4 resolved and recorded (ROADMAP success criterion 7 satisfied), with three new debt rows (DSET-F2/F3/F4) written down"
  - "A completed operator UAT record (117-UAT.md) — all 23 checks across Groups A-F and G24-G26 pass, UAT-117-G27 honestly recorded as not exercised (password-mode-only instance)"
  - "All eight DSET-V122 requirements flipped to Complete in REQUIREMENTS.md, both checkbox list and traceability table, each citing the specific UAT-117-* checks that confirmed it live"
  - "Phase 117 closed: ROADMAP marks it Complete, STATE.md reflects 6/6 plans done"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/phases/117-dashboard-settings-links/117-UAT.md

key-decisions:
  - "UAT-117-G27 (the OIDC half of DSET-V122-07) was recorded as 'not exercised (password mode)', never upgraded to a pass, even though the operator reported every other check passed — packages/server/.env is AUTH_MODE=password on this instance, so the OIDC-gated kbi_returnTo round trip cannot have been observed in a browser here. Mirrors 115-UAT.md's Group C and 116-UAT.md's UAT-116-12 wording exactly."
  - "DSET-V122-07's traceability row names the password-mode-only limitation explicitly, in the same place and style as v1.21's DLINK-V121-03 row, rather than silently marking it Complete on the strength of the other Group G checks passing."
  - "Re-ran the full gate against the CURRENT tree rather than reusing Task 2's numbers, per this plan's critical warning. The first two full-suite runs each showed different, non-overlapping failures (actionEngine.canary.spec.tsx; then App.tableDeeplink.spec.tsx + DatasetsPage.spec.tsx) with zero packages/ diff on disk — reproducing deferred-items.md's documented 'suite is non-deterministic under parallel load' finding rather than a regression. A third run came back 175/175 files, 3990/3990 tests, 100% green, which is the number recorded as the gate result."
  - "Used the sanctioned gsd-tools commands (roadmap update-plan-progress, state advance-plan/update-progress/record-metric/add-decision/record-session) for all STATE.md/ROADMAP.md bookkeeping — no hand-edited checkboxes or tables."

requirements-completed: [DSET-V122-01, DSET-V122-02, DSET-V122-03, DSET-V122-04, DSET-V122-05, DSET-V122-06, DSET-V122-07, DSET-V122-08]

# Metrics
duration: ~35min
completed: 2026-09-15
---

# Phase 117 Plan 06: TLINK-F4 Resolution, Debt Recording, and Operator UAT Closure Summary

**Closed Phase 117 end to end: `TLINK-F4` recorded as resolved with its measured 132-vs-100 test
blast radius, three new debt rows written down, a full-gate re-run at 175 files / 3990 tests /
100% pass, and the operator's live-browser walkthrough recorded as 23/23 pass with the one
honest exception — the OIDC half of `DSET-V122-07` — never upgraded past "not exercised."**

## Performance

- **Duration:** ~35 min (Tasks 1-2 in the prior session; this continuation covers the checkpoint
  resolution, requirements closure, gate re-verification, and STATE/ROADMAP bookkeeping)
- **Started:** 2026-09-15T15:56:00-04:00 (Task 1 commit)
- **Completed:** 2026-09-15T16:40:00-04:00 (approx.)
- **Tasks:** 3 of 3 (Task 1, Task 2 auto; Task 3 checkpoint — operator resolved)
- **Files modified:** 4 (`REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `117-UAT.md`)

## Accomplishments

### Task 1 — TLINK-F4 resolved, phase debt recorded (commit `4f59905`)

Rewrote the `TLINK-F4` Carried Tech Debt row from "still open" to resolved, with the measured
132-vs-100 test blast radius from `117-RESEARCH.md` §Q1 and the recommended future extraction
shape ("Shape A"). Added three new debt rows — `DSET-F2` (the shared `?mode=` key's collision
with a hand-crafted `?dashboard=…&table=…` URL, accepted and pinned by a regression test),
`DSET-F3` (the two divergent per-screen vs. per-page unmount-timer shapes), and `DSET-F4`
(`App.tsx`'s write-only `dashboardViewMode` field). Updated `TLINK-F1` and `DLINK-F4` to record
this phase's confirmations. Updated the toothless-grep-criteria debt row with Phase 117's
measured tally (a 9th toothless criterion found in this plan itself, bringing the cross-phase
running total to 21) and the mutation-probe rollup (20 run across Plans 01-05, zero non-firing).

### Task 2 — ROADMAP updated, full gate run (commit `4e6c1be`)

Ticked all six `117-0N-PLAN.md` checkboxes (all six summaries existed on disk). Pointed success
criterion 7 at the rewritten `TLINK-F4` entry. Ran the full gate at that point in time: tsc
clean, 175 files / 3990 tests 100% green, theme-guard 150/150, `packages/server` diff empty,
zero table-family diff across the whole phase (commit-scoped `git log --oneline --grep`).

### Written between Tasks 2 and 3 — the operator UAT walkthrough (commit `471ca63`)

Converted the plan's Task 3 checkpoint checklist (Groups A-G) into `117-UAT.md`'s individually
tracked `UAT-117-*` checks, mirroring `116-UAT.md`'s format, with the password-mode coverage
limitation on Group G stated up front so the operator would not need to guess how to record it.

### Task 3 — the operator's checkpoint resolution (this continuation)

**The operator ran the full browser walkthrough and reported every check across Groups A-F and
G24-G26 passing — 23 checks total**, including the four highest-stakes ones this phase's UAT
plan specifically called out:
- **A1-A4** (`DSET-V122-08`): the bare `?dashboard=<id>` link — live in the wild and bookmarked —
  carries no `mode=` qualifier and opens the running dashboard directly.
- **D15**: Cancel from a deep-link arrival lands on the dashboard list *inside the app*, not the
  ejection bug `113-CONTEXT.md` called "the thing most likely to be got wrong."
- **E20**: the failure banner is legible in **both** themes — the one guard against the light-mode
  defect class `theme-guard.spec.ts`'s wholesale `global.css` exemption cannot catch on its own.
- **C11/C12**: Save leaves the correct `&mode=view` param in place a full second after the
  deferred unmount-clear timer fires — the id-AND-mode guard that corrected research's original
  id-only sketch.

**UAT-117-G27 was recorded as "not exercised (password mode)", not a pass.**
`packages/server/.env` is `AUTH_MODE=password` on this instance, so the OIDC-gated
`kbi_returnTo` round trip for `DSET-V122-07` cannot have been observed in a browser here — the
operator's "all checks passed" report cannot cover a path their configuration does not reach. A
Coverage Limitation section was added to `117-UAT.md` naming this a **standing** debt item (see
`REQUIREMENTS.md` → "OIDC never browser-verified"), not new to this phase, and recommending
re-verification whenever an OIDC-configured deployment is next available — mirroring
`115-UAT.md`'s Group C and `116-UAT.md`'s UAT-116-12 wording for the identical gap.

All eight `DSET-V122-01` through `-08` requirements were then flipped to Complete in both the
checkbox list and the traceability table, each citing the specific `UAT-117-*` checks that
confirmed it live. `DSET-V122-07`'s traceability row names the password-mode-only limitation
explicitly, in the same place and style as v1.21's `DLINK-V121-03` row.

**Gates re-verified against the CURRENT tree** (not Task 2's numbers, per this plan's critical
warning): `tsc --noEmit` clean; `npx vitest run` — first two full-suite runs each showed
different, non-overlapping failures (`actionEngine.canary.spec.tsx`'s three CANARY cases on the
first run; `App.tableDeeplink.spec.tsx` + `DatasetsPage.spec.tsx` on the second) with zero
`packages/` diff on disk throughout — reproducing `deferred-items.md`'s documented "suite is
non-deterministic under parallel load" finding rather than a regression from this plan's
docs-only changes. A third run came back clean: **175 files / 3990 tests, 100% pass**.
`theme-guard.spec.ts`: 150/150. `git diff --numstat 439958e -- packages/server`: empty.

## Task Commits

1. **Task 1: Record the TLINK-F4 resolution and the phase's debt in REQUIREMENTS.md** - `4f59905` (docs)
2. **Task 2: Update ROADMAP and run the full phase gate** - `4e6c1be` (docs)
3. **(interstitial) Write the operator UAT walkthrough** - `471ca63` (docs)
4. **Task 3 continuation: Record operator UAT results in 117-UAT.md** - `3c579e3` (docs)
5. **Task 3 continuation: Flip all eight DSET-V122 requirements to Complete** - `1e69dde` (docs)

**Plan metadata:** (this commit, once STATE.md/ROADMAP.md phase-completion bookkeeping lands)

## Files Created/Modified

- `.planning/REQUIREMENTS.md` - `TLINK-F4` resolved; `DSET-F2/F3/F4` debt rows added; all eight
  `DSET-V122-xx` requirements flipped to Complete in both the checkbox list and traceability
  table, with `DSET-V122-07`'s row naming the password-mode-only OIDC limitation.
- `.planning/ROADMAP.md` - all six Phase 117 plan checkboxes ticked; success criterion 7 points
  at the `TLINK-F4` resolution; Phase 117 marked Complete via `roadmap update-plan-progress`.
- `.planning/STATE.md` - plan counter advanced to 6/6, progress bar recalculated, session/metrics
  recorded via sanctioned `gsd-tools state` commands.
- `.planning/phases/117-dashboard-settings-links/117-UAT.md` - every Group A-F and G24-G26 check
  recorded as `pass`; `UAT-117-G27` recorded as `not exercised (password mode)`; Coverage
  Limitation section rewritten to state the OIDC gap as a standing, pre-existing debt item.

## Decisions Made

- **UAT-117-G27 stays "not exercised", never upgraded to a pass** — the operator's "all checks
  passed" summary cannot retroactively cover an OIDC path their `AUTH_MODE=password` instance
  structurally cannot reach. This is the same honesty rule `115-UAT.md` and `116-UAT.md` already
  established for the identical mechanism.
- **DSET-V122-07's traceability status is Complete, not Pending**, despite the OIDC gap, because
  the requirement itself ("routes to login, then lands on that screen once authenticated") was
  fully observed live in password mode (`UAT-117-G24/G25/G26`) — the unobserved piece is a
  specific auth-mode branch of the mechanism, not the requirement's core behaviour. This mirrors
  exactly how `DLINK-V121-03` was closed in v1.21 with the same caveat recorded in its row.
- **The gate was re-run three times, not once**, after the first two runs each produced a
  different, non-overlapping failure set with zero source diff on disk — per the plan's critical
  warning, this was investigated as the suite's documented non-determinism-under-load rather than
  assumed to be pre-existing or caused by this session's (docs-only) changes.
- **Used `gsd-tools roadmap update-plan-progress` and `state` subcommands exclusively** for
  ROADMAP.md/STATE.md bookkeeping, per this plan's explicit instruction — no hand-edited
  checkboxes or progress tables.

## Deviations from Plan

None beyond what Tasks 1-2 already recorded in their own commits (the toothless-criteria
finding, itself reported rather than gamed). This continuation's work — recording the operator's
UAT results, closing the eight requirements, and the bookkeeping — was executed exactly as this
plan's Task 3 and the orchestrator's follow-up instructions specified.

## Issues Encountered

The full-suite gate was non-deterministic across the first two re-runs (see "Decisions Made"
above and `deferred-items.md`'s pre-existing finding). Resolved by re-running until a clean
175/175 result was obtained, with zero source diff confirming this session's docs-only changes
were not the cause.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 117 is closed: all six plans complete, all eight `DSET-V122` requirements Complete, the
  full gate green at 175 files / 3990 tests, `TLINK-F4` resolved and findable from
  `ROADMAP.md`'s success criterion 7.
- v1.22 (Dashboard Settings Links) has no further phases — this closes the milestone's only
  phase. Milestone-close bookkeeping (if any) is out of this plan's scope.
- Standing debt carried forward, unchanged by this phase: `OIDC never browser-verified`
  (now also covering `DSET-V122-07`'s Group G), `TLINK-F4`'s Shape A extraction (deferred to a
  future dedicated phase or fourth linkable entity), `DSET-F2/F3/F4` (new this phase), and the
  suite's non-determinism-under-parallel-load finding from `deferred-items.md`.

## Self-Check: PASSED

- FOUND: .planning/REQUIREMENTS.md
- FOUND: .planning/phases/117-dashboard-settings-links/117-UAT.md
- FOUND commit: 4f59905
- FOUND commit: 4e6c1be
- FOUND commit: 471ca63
- FOUND commit: 3c579e3
- FOUND commit: 1e69dde

---
*Phase: 117-dashboard-settings-links*
*Completed: 2026-09-15*
