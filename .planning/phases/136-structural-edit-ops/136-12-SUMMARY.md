---
phase: 136-structural-edit-ops
plan: 12
subsystem: planning-verification
tags: [operator-uat, wms, val_attr, light-dark, layout, bookkeeping]
requires: [136-01, 136-02, 136-03, 136-04, 136-05, 136-06, 136-07, 136-08, 136-09, 136-10, 136-11]
provides:
  - "Operator verdicts for the human-only Phase 136 criteria (VAL_ATTR tiles, blur parity, light/dark pills, layout, removal approval, undo)"
  - "Phase 136 marked complete in ROADMAP/REQUIREMENTS/STATE; TD-V20-ALLOWLIST-KEYS resolved in PROJECT"
  - "Follow-ups routed to Phase 137 / 141 / 142"
key-files:
  created:
    - .planning/phases/136-structural-edit-ops/136-12-SUMMARY.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/PROJECT.md
decisions:
  - "Kinetica's default heatmap blur is 5 (tiles byte-identical with and without BLUR_RADIUS=5); the AI default of 5 matches saved heatmaps, no action"
  - "Legend 'AI heat' row/eye, AI bignumber label 'value', and layer-only edits not highlighting the host map are carried to Phase 137 (operator approved routing), not Phase 136 gaps"
  - "All 8 Phase 136 requirements (AIACT-V20-01..06, -10, -11) marked Complete"
metrics:
  tasks: 3
completed: 2026-10-14
---

# Phase 136 Plan 12: Operator verification and Phase 136 bookkeeping Summary

The operator UAT confirmed on real Kinetica that AI heatmap layers render with `VAL_ATTR`, that the AI pills, placement, layout moves, removal approval and undo behave correctly in light and dark mode, and Phase 136 is recorded as complete with its follow-ups routed to 137, 141 and 142.

## Commits
- 8689ff1 docs(136-12): UAT deferred, console steps saved (`136-12-UAT-STEPS.md`)
- de5bc7c docs(136-12): UAT run results (`136-12-UAT-RESULTS.md`) + steps fixes
- (this commit) docs(136-12): phase 136 verification results and bookkeeping

## Task 1: WMS VAL_ATTR tile check (checkpoint, APPROVED 2026-10-14)
- Weighted tile (`VAL_ATTR=fare_amount`, plasma, blur 8, NYC bbox): 200 image/png, visible heat. Control tile (same URL without `VAL_ATTR`): 200 image/png, visible heat. The painted area differs (18.3 % vs 11.0 %), so Kinetica accepts `VAL_ATTR` and it visibly changes the render. **PASS.**
- Blur parity: a saved-style tile without `BLUR_RADIUS` and the same tile with `BLUR_RADIUS=5` are byte-identical, so Kinetica's default is 5 and the AI default (5) matches. No action needed.

## Task 2: visual, layout and undo (checkpoint, APPROVED 2026-10-14)
Claude ran these steps in the operator's own signed-in Chrome (separate profile, operator signed in, no credentials handled, no AI provider called). The operator approved the results. Every step passed:
- Heatmap: AI add and restyle, plus a restyle of a saved layer (23 -> magma), applied and re-requested tiles with the new params. The session-only eye hides and shows the AI layer.
- The "AI edited" and "AI added" pills are legible in light and dark.
- AI-added widgets got 9 / 18 / 36 columns for bignumber / bar / records, were placed below the saved content, and had 0 overlaps. The `set_layout` swap of 117 and 118 worked and pushed the AI widgets down with no overlap.
- Map plus heatmap on a dashboard with no map (simulated by removing map 117 in the session): both were applied, the map was placed 28 columns wide below the 18-column gap (correct per D-08), and the basemaps were correct in light and dark.
- Removal: the first removal of saved content asks for approval. After approval, a second removal does not ask. After `discard()`, it asks again.
- Undo: `revert(-1)` returns exactly the saved dashboard and `forward(8)` restores every change. After `discard()` and a reload, the API shows nothing persisted.
- The optional single live ask was not run (no provider calls in this plan).

## Task 3: bookkeeping (by hand, no gsd-tools mutations)
- REQUIREMENTS.md: AIACT-V20-01, -02, -03, -04, -05, -06, -10, -11 are `[x]` and set to Traceability `Complete`. The footer was prepended with the 2026-10-14 note.
- ROADMAP.md: the Phase 136 checkbox and its 12 plan checkboxes are ticked, a "Completed 2026-10-14" note was added, and the Progress row reads `12/12 | Complete | 2026-10-14`. The Phase 137 plan list was not touched.
- STATE.md: updated the frontmatter `stopped_at`/`last_updated`, Current Focus and Current Position (Phase 136 complete; Phase 137 planned, 12 plans in 5 waves, next execute-phase 137). Replaced the "136-12 PAUSED" wording. Added a "Phase 136 outcomes" paragraph and a "New debt / follow-ups from Phase 136" list. The file grew from 1889 to 1900 lines, and only content was added or reworded.
- PROJECT.md: TD-V20-ALLOWLIST-KEYS is `[x]` with the RESOLVED note.

## Follow-ups recorded
- **To 137 (operator approved routing):**
  - (a) The legend "AI heat" row and legend eye were not exercised because test map 117 has its legend panel off. Check them on a map with the legend enabled in the 137-12 visual check.
  - (b) An AI-added bignumber shows the label "value".
  - (c) Layer-only AI edits do not badge or highlight the host map (AIWID-V20-06).
- **Shape-key repair-counter defect** (found by the 136 verifier): a repaired shape failure stays in `skipped`. Fixed red-first in 137-01.
- **Fix 5233a6e** (RT6-5): radio capture skips `""` values, so saved custom-metric charts no longer capture an invalid `metric: ""`.
- **S6 Gemini spike verdict is stale** against the 12-tool set from 136-05. Re-run it before or at Phase 142, together with the >= 20 clean-trial re-run.
- **Phase 141 Keep** must call the `aiSessionStore` `reset()` so `removalApproved` clears.

## Deviations from Plan
- Task 2 was run by Claude driving the operator's signed-in Chrome instead of by the operator by hand. The operator approved the results.
- One must_have truth was only partly verified: "legend row + legend eye in light and dark". The test map has its legend disabled, so this check is carried to 137-12 with the operator's approval. It is not marked Partial because the AIACT requirements do not depend on the legend.
- `136-VERIFICATION.md` still says `status: human_needed` in its frontmatter. Its human items are now covered by `136-12-UAT-RESULTS.md`. The file was left unchanged because it is outside this task's file list.

## Non-discriminating criteria
- None. The pre-checks were valid before this work: 0 rows read Complete, `RESOLVED in Phase 136` = 0, and the `0/? | Not started` row = 1. Afterwards they read 8 / 1 / 0.

## Self-Check: PASSED
136-12-SUMMARY.md exists. Commits 8689ff1, de5bc7c and 5233a6e exist. The grep criteria read 8 / 1 / 0. STATE.md went from 1889 to 1900 lines.
