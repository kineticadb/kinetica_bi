---
phase: 142-generate-audit-viewer-live-provider-proofs
plan: 10
subsystem: live-uat
tags: [uat, gemini, live-provider]
requires: [142-01, 142-02, 142-03, 142-04, 142-05, 142-06, 142-07, 142-08, 142-09]
provides: [142-UAT-STEPS.md, 142-UAT-RESULTS.md (Gemini sections)]
affects: []
key-files:
  created: [.planning/phases/142-generate-audit-viewer-live-provider-proofs/142-UAT-STEPS.md, .planning/phases/142-generate-audit-viewer-live-provider-proofs/142-UAT-RESULTS.md]
  modified: []
requirements: [AIGEN-V20-01, AIGEN-V20-02, AIGOV-V20-05, AIPRV-V20-02, AIWID-V20-05]
gaps: []
---

# Phase 142 Plan 10: Gemini live UAT Summary

Gap gate PASS, gates run, then the Gemini UAT (`gemini-3-flash-preview`, OpenAI-compatible, native tools, free tier) over four quota days (2026-10-23, 26, 27, 28) plus the G10 S6 spike on 2026-10-30. Driven by Claude over CDP in a separate Chrome profile; the operator signed in and edited `.env`. Kinetica 7.2.3.12. Full evidence: `142-UAT-RESULTS.md`.

## Result
| Step | Verdict |
|---|---|
| G0 config | PASS |
| G1 AI activity nav (admin) / 403 (uat_analyst) | PASS light + dark |
| G2 Generate + Keep, designer cannot see an unkept dashboard, AI map opens on the data | PASS after fix 9d91596 |
| G3 Discard / G3b Cancel + one-unkept prompt / G3c logout, boot and restart sweeps | PASS (G3b after fix 0aa5150) |
| G4 add, follow-up, ambiguous ask -> Choices, rename + line, remove + confirm, revert | PASS (remove after fix 21fd377) |
| G5 filter, dynamic view, remove saved view with confirm | PASS light + dark |
| G6 joins (139 step 8/8b, 141 step 9), preflight timeout | PASS |
| G7 Keep after a live ask (joined view) | PASS |
| G8 query mode + `queries_json` | PASS |
| G9 AI activity page, details, queries | PASS light + dark |
| G10 S6 spike | day 1 of 3: 7/7 clean, 80% valid calls, 2nd turn 0/1, inconclusive (needs >= 20 clean trials); day 2/3 pending |

UAT fixes (each red-first): 9d91596, bc97400, dba356f, a758465 / 9570676 / 688ab33, 0aa5150, b601087, f0d6929, 4601291, 21fd377, c5b7879, 285f686, 52919a9, 0150f36.

## Deviations from Plan
- The quota plan stretched from 2-3 days to 4 plus the spike days; the day caps were set by the operator per day.
- G4 used dashboard 21 (no dashboard-12 copy existed). The second "Show fares by type" ambiguous ask was not run; day 2 row 26 already covered an ambiguous ask offering Choices.
- The S6 spike runs one `--runs 1` per quota day; the final verdict is recorded when >= 20 clean trials exist.

## Open observations (not blockers)
- Model: "by hour" read as calendar hour (app gap: no hour-of-day / day-of-week buckets; todo 2026-10-28).
- Model: occasionally sums an already-averaged view column (prompt rule added in 52919a9).
- Model: in query mode a plain question was answered with a chart.
- `?page=ai-activity` deep link lands on Dashboards on a fresh load.

## Self-Check: PASSED (G10 verdict pending the remaining spike days)
