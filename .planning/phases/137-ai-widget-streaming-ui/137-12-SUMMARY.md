---
phase: 137-ai-widget-streaming-ui
plan: 12
subsystem: verification + planning bookkeeping
tags: [uat, light-dark, ai-widget, bookkeeping]
requires: [137-01, 137-02, 137-03, 137-04, 137-05, 137-06, 137-07, 137-08, 137-09, 137-10, 137-11]
provides:
  - "operator UAT verdicts (light + dark) for the AI widget, drawer, change bar, highlights and the 136-12 carry-overs"
  - "Phase 137 requirement trace (8 Complete, AIWID-V20-05 Partial)"
affects: [138, 141, 142]
key-files:
  created:
    - .planning/phases/137-ai-widget-streaming-ui/137-12-UAT-STEPS.md
    - .planning/phases/137-ai-widget-streaming-ui/137-12-UAT-RESULTS.md
    - .planning/phases/137-ai-widget-streaming-ui/137-12-SUMMARY.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/PROJECT.md
    - packages/web/src/components/charts/AiChat.tsx (UAT fix 81117b2)
    - packages/web/src/components/charts/AiWidget.css (UAT fix 81117b2)
    - packages/web/src/components/AiChangeBar.tsx (UAT fix 81117b2)
    - packages/web/src/components/AiLeaveDialog.tsx (UAT fix 81117b2)
decisions:
  - "Operator (step 8): a visible-but-disabled Keep satisfies AISES-V20-04 for Phase 137; Keep is enabled in Phase 141"
  - "AIWID-V20-05 stays Partial: no live ask was run, so provider-produced choices were not observed"
  - "AIGOV-V20-01 closed Complete: widget use/add gate UI + server create/patch guard; the no-access view is unit-tested, not operator-viewed"
  - "UAT visual defects were fixed in this plan (81117b2) and re-verified in the same session, rather than a separate gap-closure plan"
requirements-completed: [AIWID-V20-01, AIWID-V20-02, AIWID-V20-03, AIWID-V20-04, AIWID-V20-06, AIWID-V20-07, AISES-V20-04, AIGOV-V20-01]
requirements-partial: [AIWID-V20-05]
metrics:
  tasks: 3
  completed: 2026-10-15
---

# Phase 137 Plan 12: Gates, operator UAT and bookkeeping Summary

Phase 137 closed: gates green, operator UAT in light and dark (harness only, no provider request) passed steps 1-8 after 7 visual fixes (81117b2, re-verified), and requirements, roadmap, state and project docs were updated by hand.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 | Full gates + `137-12-UAT-STEPS.md` | cb2f2d5 |
| 2 | Operator visual + behaviour check (checkpoint) | 2ebe76a (results), 81117b2 (fixes), 2a60636 (fixes re-verified) |
| 3 | Phase 137 bookkeeping by hand | this plan's docs commit |

## Gates (Task 1, merged tree, 2026-10-14)
- shared `tsc --noEmit` OK; server `tsc --noEmit` OK; server `node scripts/test-gate.mjs` PASSED (set-based, failures within TD-V16-TEST-ISOLATION / contamination only).
- web `tsc --noEmit` OK; web `vitest run --maxWorkers=4` 4755 passed; theme-guard 172 passed.
- After fix 81117b2: web tsc OK; theme-guard 172/172; full web vitest (--maxWorkers=4) green (a px/ms literal flagged by theme-guard was fixed before commit). New tests UAT12-1, UAT12-3, AIDLG-3 fail on the pre-fix components and pass after.
- No AI provider or Kinetica call was made by the executor; `packages/server/.env` was not read. The UAT was run by Claude in the operator's signed-in Chrome; the operator set the AI env vars and signed in.

## Operator UAT (2026-10-15, `137-12-UAT-RESULTS.md`)

| Step | Light | Dark | Verdict |
|---|---|---|---|
| 1 add from picker | PASS | PASS | "AI Assistant" listed, added at 12x40 with hint + 3 starters. No-access half not run (no second user; unit-tested) |
| 2 conversation look | PASS | PASS | after fixes for issues 1-3 |
| 3 progress | PASS | PASS | spinner, elapsed after 10 s, Send -> Cancel; multi-widget sync not checked (unit-tested) |
| 4 small tile + drawer | PASS | PASS | after fixes for issues 4-5; below 900 px not checked |
| 5 highlights + bar | PASS | PASS | after fix for issue 6; Keep disabled with tooltip; revert(-1) keeps bar |
| 5b KPI label / host-map pill | PASS | PASS | "Sum of fare_amount"; layer-only edit -> map pill + outline, edited +1 |
| 5c Layers panel | PASS | PASS | "AI heat" row + eye legible; eye hides/shows AI tiles; saved row unaffected |
| 6 Discard confirm | PASS | PASS | centred, portalled, focus on Cancel |
| 7 leave warning | - | PASS | after fix for issue 7 |
| 8 Keep decision | | | **yes** — disabled Keep acceptable until Phase 141 |
| 9 live ask | | | skipped |

Issues found and fixed in 81117b2 (re-verified light + dark): older choices not greyed; question shown twice; follow-ups/Revert on clarification turns; drawer centred instead of right-anchored (now with slide-in, reduced-motion safe); Send overflowing the small tile; bar copy separator and "0 removed" hover; leave-dialog "Keep them first" copy. Issue 8 (harness never sets the highlight) is a steps-file gap, logged as a follow-up.

## Roadmap success criteria
1. Add widget, inline vs small tile + portalled drawer, no-access gate: verified (drawer < 900 px and no-access view unit-tested only).
2. Question changes dashboard, progress, Cancel, one at a time: progress/Cancel visuals verified via harness; live ask deferred (unit + route tests cover the run).
3. Full answers, follow-ups, Revert, choices: verified via harness; live provider choices deferred to 142 (AIWID-V20-05 Partial).
4. Clear error and unchanged dashboard: inline error + Retry verified; cap/quota paths unit-tested.
5. Highlights and Keep/Discard bar legible in light and dark: verified.

## Requirements
- Complete: AIWID-V20-01, -02, -03, -04, -06, -07, AISES-V20-04 (operator step 8 = yes), AIGOV-V20-01 (was Partial since 135).
- Partial: AIWID-V20-05 (choices UI + choose_option contract done; live model adherence verified in Phase 142 UAT).

## Bookkeeping (Task 3, by hand, no gsd-tools mutation commands)
- REQUIREMENTS.md: 8 checkboxes ticked, 9 traceability rows updated, footer prepended.
- ROADMAP.md: Phase 137 and its 12 plan checkboxes ticked, "Completed 2026-10-15" line added, Progress row `12/12 | Complete | 2026-10-15`.
- STATE.md: frontmatter, Current Position, "Phase 137 outcomes" and "New debt / follow-ups from Phase 137" added; 1900 -> 1915 lines.
- PROJECT.md: Key Decisions row for the reply-trailer follow-ups/choices (D-20), footer updated.

## Deviations from Plan
1. **UAT defects fixed in-plan.** The plan said defects become a gap-closure plan; the 7 visual issues were small CSS/copy fixes, so they were fixed in 81117b2 with red-first tests and re-verified in the same session.
2. **AIGOV-V20-01 Complete without the operator viewing the no-access half** (no second user was available). Closed on the orchestrator's instruction; the gate is covered by unit tests (AIW, DPAI) and the server guard (WCG specs). Recorded in the traceability row.
3. **Leave-dialog copy changed** ("Saving AI changes is coming soon."); Phase 141 must restore Keep-first wording when Keep is enabled (logged in STATE follow-ups).

## Self-Check: PASSED
- FOUND: 137-12-UAT-STEPS.md, 137-12-UAT-RESULTS.md, 137-12-SUMMARY.md.
- FOUND commits: cb2f2d5, 2ebe76a, 81117b2, 2a60636.
