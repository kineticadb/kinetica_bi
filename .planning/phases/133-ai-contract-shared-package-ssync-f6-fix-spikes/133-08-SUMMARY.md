---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 08
subsystem: spikes
tags: [spike, kinetica, s1, s7, non-admin]
requires: [133-07]
provides:
  - S1 decision (ad-hoc inline dv path viable as non-admin)
  - Dv column source SQL for 133-09
  - S7 capability findings and job-cancel decision
affects: [133-09, 133-10, 137, 139, 140]
key-files:
  created:
    - packages/server/src/spikes/adhocDvSpike.ts
    - packages/server/src/spikes/kineticaCapsSpike.ts
  modified:
    - .planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md
decisions:
  - "S1: ad-hoc inline path; no Keep-only fallback; AIACT-V20-07 unchanged"
  - "Dv column source: SELECT * FROM <view> LIMIT 0 -> column_headers"
  - "Grants do not make the user read-only: Phase 140 guard fully app-side"
  - "Cancel = tag statement with comment, find in /admin/show/jobs, cancel via /admin/alter/jobs"
metrics:
  completed: 2026-10-09
---

# Phase 133 Plan 08: S1/S7 live spikes Summary

Ran S1 (session-only dynamic views) and S7 (Kinetica capabilities) live as non-admin `uat_analyst`: ad-hoc dv path is viable, grants do not enforce read-only, EXPLAIN has no cost estimate, and the only real cancel is tag -> find -> `/admin/alter/jobs`.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 | S1 code-half spec + S1/S7 live harnesses | 4ad3d56 |
| 2 | Operator live runs (checkpoint:human-action) | n/a (operator, 2026-10-09) |
| 3 | Record S1/S7 results in 133-SPIKES.md | see final commit |

## Operator run

User `uat_analyst`, confirmed NON-ADMIN (D-12). Kinetica http://172.31.0.22:8082/gpudb-0, source `demo.nyctaxi`. Full evidence is in 133-SPIKES.md.

- S1: all PASS (create, count, view-of-view n=464, WMS PNG 200, LIMIT 0 column_headers, TTL reaped within 150 s at TTL=1 min, drop). D-13 => ad-hoc inline path.
- S7: create view OK; CREATE TABLE and INSERT into source allowed (not read-only by grants); DELETE refusal was an engine error (inconclusive); EXPLAIN returns plan rows only; column resolution case-insensitive; abort does not stop Kinetica jobs; tag/find/cancel of own job works as non-admin.

## Deviations from Plan

### Orchestrator edits to the S7 harness during the checkpoint

1. **8a56908** - default slow query bounded (`SELECT COUNT(*) FROM (SELECT * FROM src LIMIT 20000) a, (SELECT * FROM src LIMIT 2000) b`) plus a 90 s client cap. The original unbounded self-join ran over 5 min on the small UAT instance and kept running server-side after the script was killed; operator cancelled leftover jobs 82268, 82300, 82303 in GAdmin.
2. **a71be21** - added S7.6 (tag -> find -> cancel as non-admin) and `--skip-slow`. Operator design.
3. **9026595** - S7.6 polls `/admin/show/jobs` from submit time (first run saw jobs=0 at about 3 s, inconclusive).

### Untested / incomplete

S7.1b (SPIKE_SCHEMA unset), S7.2c (`options.timeout`), S7.3d (ALTER), and a true grant-based DELETE denial were not exercised. S7.2 slow-query result came from run 1 of the original harness only.

## Items for the 133-10 checkpoint

- **NEW TECH DEBT:** v1.26 export cancel (`cancelExport`, `packages/server/src/lib/exportRunner.ts:272`) only calls `ac.abort()`; it likely leaves Kinetica jobs running. Not fixed here.
- Phase 137 (AIWID-V20-04) and Phase 140 must use the tag/find/cancel mechanism.
- S1 TTL sliding-vs-fixed not distinguished.
- Bookkeeping (STATE/ROADMAP/REQUIREMENTS) intentionally untouched per instructions; 133-10 owns it.

## Self-Check: PASSED
