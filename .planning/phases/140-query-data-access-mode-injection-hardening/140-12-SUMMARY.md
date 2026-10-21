---
phase: 140-query-data-access-mode-injection-hardening
plan: 12
subsystem: server/spikes
tags: [spike, live-harness, query-mode, guard]
requires: [140-09]
provides: [queryModeSpike harness, query-mode-spike npm script]
affects: [140-13 operator UAT]
key-files:
  created: [packages/server/src/spikes/queryModeSpike.ts]
  modified: [packages/server/package.json]
decisions:
  - "Live-mode imports of queryRunner/kinetica are dynamic (after dotenv) because queryRunner -> exportRunner -> sessionStore throws at import without SESSION_ENCRYPTION_KEY; this keeps --dry-run truly offline with no .env"
metrics:
  tasks: 1
  files: 2
  completed: 2026-10-21
---

# Phase 140 Plan 12: Query-mode live spike Summary

Quota-free operator harness `queryModeSpike.ts` (`npm run query-mode-spike`) that drives the shipping guardQuery, buildQueryScope and createQueryPort against live Kinetica as the non-admin user, with an offline `--dry-run` guard corpus.

## What was built

- `--dry-run`: 23 analyst-style queries (window fns, DATE_TRUNC, APPROX_MEDIAN/PERCENTILE, ST_*/STXY_*, HOUR, DATEDIFF, TIMESTAMPADD, INTERVAL, CAST/::, UNION, CTE, FETCH FIRST, quoted "SCHEMA"."TABLE") plus 10 must-refuse. Exits 1 if any must-refuse is accepted.
- Live Q1..Q8: cap and truncation, timeout cancel (tagged job gone from /admin/show/jobs), user cancel, writes refused with zero kineticaSql calls, dialect corpus live, D-18 error calibration (raw upstream text clipped to 200 chars, local terminal only), quoted-name case, column profile (counts only).
- Never prints password, auth header, or row values. Not imported by src/index.ts (count 0).

## Dry-run result (exit 0, 0 must-refuse violations)

All 23 analyst queries: accepted (including APPROX_*, STXY_*, DATEDIFF, TIMESTAMPADD, INTERVAL, `::`, FETCH FIRST, quoted upper-case names).
Must-refuse, all refused:
| sql | reason |
|---|---|
| INSERT / CREATE TABLE AS / DELETE / UPDATE | only a single SELECT (or WITH ... SELECT) is allowed |
| multi-statement `;` and `--` comment | remove semicolons, comments and ... characters |
| ki_catalog.ki_objects | system and catalog objects are not allowed |
| QUALIFY / TOP | unsupported or invalid syntax |
| other_schema.other_table | table ... is not on this dashboard |

## Verification

- server `tsc --noEmit` clean; `lib.aiProdImports` and `lib.aiNoNetwork` specs green (5 tests).
- Greps (after): `query-mode-spike` in package.json = 1 (was 0); `createQueryPort(` = 1; `Q[1-8] ` = 23; `spikes/queryModeSpike` in index.ts = 0. KINETICA_PASSWORD is used only to build the principal and the Basic auth header for job polling; never logged.
- Live mode was NOT run (per constraints); 140-13 operator runs it.

## Deviations from Plan

**[Rule 3 - Blocking] Dynamic imports for live-mode modules.** Static import of queryRunner threw "SESSION_ENCRYPTION_KEY must be set" in --dry-run. Moved queryRunner/kinetica/kineticaJobs to dynamic imports inside live(). Commit aebcc85.

Note for operator: Q2 job-poll uses the tag `<requestId>-q01`, assuming each Q-check uses a fresh port (it does); Q2/Q3 PASS depends on non-admin being able to see own jobs (133 S7.6 verified).

## Commits

- aebcc85: feat(140-12): queryModeSpike live harness with offline --dry-run corpus

## Self-Check: PASSED
