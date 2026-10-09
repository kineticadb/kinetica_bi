---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
plan: 02
subsystem: server-export
tags: [kinetica, spike, paging, export, materialized-view]
requires: []
provides:
  - "Operator-approved pagination decision: offset (snapshot MV + request-level OFFSET + composite ORDER BY)"
  - "Empirical max_get_records_size = 20000; has_more_records is the exhaustion signal"
affects: [128-04, 128-05, 128-06, 128-07, 130, 131]
tech-stack:
  added: []
  patterns: ["job-private _kbi_exp_ snapshot MV with TTL backstop", "composite ORDER BY for deterministic paging"]
key-files:
  created:
    - packages/server/src/spikes/exportPagingSpike.ts
    - .planning/phases/128-export-job-core-live-spike-runner-snapshot-cancel/128-SPIKE-NOTES.md
  modified:
    - packages/server/package.json
key-decisions:
  - "Chosen mechanism: offset (paging_table could not be shown to create any table on this instance)"
  - "Runner always builds a snapshot MV; total_rows from COUNT(*) on the MV"
  - "Export columns = cfg.columns (IDENT_RE-filtered) or all columns in schema order; no hidden-column concept"
  - "Widget-action overrides deferred to Phase 131"
requirements-completed: []
duration: n/a
completed: 2026-10-06
---

# Phase 128 Plan 02: Live Export Paging Spike Summary

Live spike against the real Kinetica instance chose request-level OFFSET paging over a job-private snapshot MV with composite ORDER BY; operator approved on 2026-10-06.

## Tasks
| Task | Name | Commit |
|---|---|---|
| 1 | Spike script + npm script `export-paging-spike` | fec73d1 |
| 2 | Live run + SPIKE-NOTES | 681e8b2 |
| 3 | Operator approval (checkpoint:human-verify) | recorded in SPIKE-NOTES `## Operator decisions` |

## Decisions
See 128-SPIKE-NOTES.md: Q-A/Q-B approved (offset + MV), Q-C configured columns only, Q-D deferred to Phase 131. D-04a/b verified; no Phase 127 fixes.

## Noted risks (accepted)
- Per-page time grows (516 -> 713 -> 815 ms over 25 x 20k pages); 10M-row exports may be long. Consider progress/ETA in Phase 130/131.
- Spike ran as admin; non-admin users lacking CREATE MATERIALIZED VIEW must yield a clear kinetica_error. Untested.

## Deviations from Plan
None - plan executed as written. Shared docs (STATE/ROADMAP/REQUIREMENTS) intentionally not updated; Plan 128-07 owns them, so requirement EXPRT-V126-05 is not marked complete here.

## Self-Check: PASSED
