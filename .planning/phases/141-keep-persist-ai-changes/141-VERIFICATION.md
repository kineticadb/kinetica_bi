---
phase: 141-keep-persist-ai-changes
verified: 2026-10-22T00:00:00Z
status: passed
score: 4/4 success criteria verified
---

# Phase 141: Keep (persist AI changes) Verification Report

**Phase Goal:** A user with edit rights saves the AI's changes in one all-or-nothing step that never overwrites someone else's edits.
**Status:** passed (accepted: UAT step 6 skipped by operator, covered by server route specs; step 9 deferred to 142)
**Re-verification:** No

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Add/edit/remove persisted with real ids, all-or-nothing under injected mid-tx failure | VERIFIED | `applyKeep` runs one synchronous `db.transaction` (aiKeepApply.ts); `lib.aiKeepApply.atomic.spec.ts`; UAT step 1 returned real idMap (widgets 128-130, layer 25, dv 8) |
| 2 | No edit rights: Keep not offered; forged Keep rejected server-side | VERIFIED | Server KEEP-ROUTE forged and partial-rights specs in `routes.aiKeep.spec.ts`; Keep UI gated on raw dashboards:edit (plan truth). Browser UI check skipped by operator (accepted) |
| 3 | Dashboard changed since session start: 409, nothing overwritten | VERIFIED | In-tx `cur !== change.baselineVersion` throws KeepConflict (line 53); mutation 1 turned KEEP-APPLY-7 and KEEP-ROUTE-race red; UAT step 5 two-tab 409 |
| 4 | Reload shows saved result; UI says filters not saved | VERIFIED | UAT step 1 light+dark: dialog reads "Filters are not saved.", reload matched exactly after fixes e5bb56e/eaad490/3aef06f |

**Score:** 4/4

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| AISES-V20-05 | 141 plans (11 declare it) | SATISFIED | Truths 1, 2, 4. Marked [x] in REQUIREMENTS.md |
| AISES-V20-06 | 141 plans | SATISFIED | Truth 3. Marked [x] in REQUIREMENTS.md |

Plan frontmatter declares only these two IDs (checked across all 14 plans); no orphaned requirements.

## Extra checks

- (a) `141-14-gap-gate.sh` printed `GAP GATE: PASS`, exit 0.
- (b) Mutations, each restored via git checkout; `git diff --stat` empty at the end:
  1. Removed in-tx version compare: 2 specs red (KEEP-APPLY-7, KEEP-ROUTE-race). Restored: 35/35 green.
  2. Removed stale-id guard in `handleLayoutChange`: KPAGE-4 red (1 failed, 4 passed).
  3. Removed `data-grid` prop: KPAGE-5 red (1 failed, 4 passed).
  Restored keep spec: 5/5 green.
- (c) eaad490 guard compares callback ids to `layouts` (the same `widgets` minus removed plus added set that feeds `effectiveWidgets`, which render the grid children). A normal drag/resize reports exactly those ids, so it passes the guard and persists via `updateWidget`. Code reading supports this and UAT re-verified on dashboard 17. NO existing spec asserts the positive case: KPAGE-4 only covers the stale (negative) callback. Recommendation: add a spec where a full on-screen-id callback with a changed rect calls `updateWidget` (info, not a blocker).

## Anti-Patterns

None blocking. Open minor UAT follow-ups (a)-(f) in 141-14-UAT-RESULTS.md are cosmetic or edge cases.

## Human Verification

Completed by operator UAT 2026-10-22 (Kinetica 7.2.3.12, light and dark). Not browser-verified, accepted: viewer UI (step 6), join note (step 9).

---
_Verified: 2026-10-22_
_Verifier: Claude (gsd-verifier)_
