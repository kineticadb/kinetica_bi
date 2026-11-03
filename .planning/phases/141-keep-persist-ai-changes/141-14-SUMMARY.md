---
phase: 141-keep-persist-ai-changes
plan: 14
subsystem: ai-keep-verification
tags: [uat, gates, bookkeeping, kinetica-7.2.3.12, keep, react-grid-layout]
requires: ["141-01", "141-02", "141-03", "141-04", "141-05", "141-06", "141-07", "141-08", "141-09", "141-10", "141-11", "141-12", "141-13"]
provides:
  - Operator UAT of Keep in a real browser against Kinetica 7.2.3.12 (reload, filters, temp views, tiles, 409, headers, leave dialog, audit, D-20)
  - Three fixes found by the UAT (AI-widget geometry edit, post-Keep layout write storm, btn-primary btn-sm height)
  - AISES-V20-05 and AISES-V20-06 traced; Phase 141 bookkeeping
affects: [142]
tech-stack:
  added: []
  patterns: ["Claude-driven CDP UAT through the DEV harness (no provider call)", "ignore react-grid-layout callbacks whose ids are not the on-screen widgets"]
key-files:
  created:
    - .planning/phases/141-keep-persist-ai-changes/141-14-UAT-STEPS.md
    - .planning/phases/141-keep-persist-ai-changes/141-14-UAT-RESULTS.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/PROJECT.md
decisions:
  - "UAT step 6 (rights UI, forged fetch) skipped by the operator; covered by KEEP-ROUTE forged and partial-rights specs."
  - "Step 9 join note not testable on dashboard 12; deferred to Phase 142 with the 139 step-8 join checks."
  - "Follow-ups (a)-(f) left open, not fixed in this plan."
gaps: []
metrics:
  tasks: 3
  completed: 2026-10-22
---

# Phase 141 Plan 14: Gates, operator UAT and Phase 141 bookkeeping Summary

Keep was verified live against Kinetica 7.2.3.12: it saves in one step with real ids, a reload matches exactly, filters stay applied and re-key to the saved view, temp views are dropped, map tiles follow the saved view on both tile paths, and a change by someone else gives the 409 dialog and overwrites nothing. Three defects found during the UAT were fixed.

## Task 1: gates + UAT steps (174f8d2)
GAP GATE: PASS. Shared 203; web 5047 + theme-guard 176; server GATE PASSED 2608/2663 (8 known failing plus 2 load-only). No provider call by the executor; `packages/server/.env` not read.

## Task 2: operator UAT (resolved)
The operator asked Claude to run it ("go, skip 6"). Results in `141-14-UAT-RESULTS.md`: steps 1-5, 7, 8, 10, 11 PASS (light and dark where visual), step 6 skipped, step 9 not testable (deferred to 142).

## Task 3: results + bookkeeping
Gap gate re-run before any planning-doc edit: `GAP GATE: PASS`, exit 0; UAT-STEPS holds exactly one `GAP GATE: PASS` line. Server gate re-run after the UAT fixes (aiKeepValidate changed): GATE PASSED, 2610/2665 tests, 10 failing files = 8 known (TD-V11-04 OIDC x5, db.smoke drift, routes.wms) + routes.aiDv and routes.exports.download, which pass alone (TD-V16-TEST-ISOLATION). Web after fixes: 5049 passed, tsc clean; Keep server specs 52/52; server tsc clean.

## Deviations from Plan

### Auto-fixed Issues (found at UAT, fixed outside the plan's "defects become a gap plan" default at the operator's direction)

**1. [Rule 1 - Bug] Keep refused every request: AI widget geometry edit**
- **Found during:** Task 2, step 1
- **Issue:** the client bakes on-screen geometry into widgets with no saved layout, including the AI widget; `checkKeepChange` returned 422 for any edit to it.
- **Fix:** allow an `{id, rect}` edit of the AI widget; any other change or removal is still refused. KVAL-4b and KEEP-ROUTE-ai-rect red then green.
- **Commit:** e5bb56e

**2. [Rule 1 - Bug] Layout write storm after Keep saved new widgets at 1×1**
- **Found during:** Task 2, step 1 reload check
- **Issue:** after the list swap, react-grid-layout reported its stale layout and then synthesized 1×1 items; `handleLayoutChange` persisted both and ping-ponged (78 writes, version jump ~88).
- **Fix:** ignore a layout callback whose ids are not exactly the widgets on screen; pass each grid child its rect as `data-grid`. KPAGE-4/5 red then green; re-verified on a fresh copy (3 writes, reload matches).
- **Commit:** eaad490

**3. [Rule 1 - Bug] `btn-primary btn-sm` 2px shorter than `ghost-sm` (pre-existing)**
- **Found during:** Task 2, step 1 and 5 dialogs
- **Fix:** `.btn-primary.btn-sm { border: 1px solid transparent }`; 23/23 measured; theme-guard 176 pass.
- **Commit:** 3aef06f

## Open follow-ups
(a) open tab's AI views not rebuilt after a server restart; (b) blocked-Keep note wraps the bar buttons; (c) ghost-danger "Discard and reload the latest" not danger-looking until hover; (d) legacy-widget bake uses the fallback rect (one extra own-tab PATCH); (e) step 9 join note and step 6 UI not browser-verified; (f) empty answer bubbles for harness turns.

## Self-Check
See bottom of file.

## Self-Check: PASSED

Found: 141-14-UAT-STEPS.md, 141-14-UAT-RESULTS.md, this file. Commits 174f8d2, e5bb56e, eaad490, 3aef06f exist. Gap gate exit 0; STATE.md grew 1967 -> 1988 lines.
