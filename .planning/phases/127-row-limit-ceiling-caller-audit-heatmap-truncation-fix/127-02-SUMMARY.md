---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
plan: 02
subsystem: server+web auth/me, discovery
tags: [row-limit, csv, env, auth-me]
requires: []
provides: [csvInBrowserMaxRows on /api/auth/me, useAuthStore.csvInBrowserMaxRows, discovery limit pin 20000]
affects: [127-04]
key-files:
  modified:
    - packages/server/src/index.ts
    - packages/server/.env.example
    - packages/server/tests/routes.discovery.spec.ts
    - packages/server/tests/auth.routes.spec.ts
    - packages/web/src/api/client.ts
    - packages/web/src/store/auth.ts
    - packages/web/src/store/auth.spec.ts
  created:
    - packages/server/tests/auth.me.rowLimits.spec.ts
metrics:
  completed: 2026-10-02
---

# Phase 127 Plan 02: CSV ceiling on /me + discovery limit pin Summary

CSV_INBROWSER_MAX_ROWS (default 100000) flows env -> /api/auth/me -> fetchMe -> useAuthStore, and the three INFORMATION_SCHEMA discovery routes pin an explicit 20,000 row limit.

## Commits
- e3b9a8e: server (index.ts, specs, .env.example)
- f7b61ec: web (client.ts, auth.ts, auth.spec.ts)

## Verification
- Server tsc clean; auth.me.rowLimits + routes.discovery 24/24 pass; `node scripts/test-gate.mjs` GATE PASSED (routes.branding is contamination-only, passes alone).
- Web tsc clean; full vitest 186 files / 4183 tests pass.
- Mutation probes (all restored via cp): removing csvInBrowserMaxRows from /me failed RLME-default, RLME-env, RLME-invalid; removing the schemas `extra` pin failed RLDISC-schemas; removing `csvInBrowserMaxRows: me.csvInBrowserMaxRows` from bootstrap failed RLME-store-bootstrap.

## Deviations
None of substance. Notes:
- RLDISC-columns asserts exactly one `/execute/sql` call (the columns route also makes a separate /show/table call, so "one fetch call overall" would be wrong).
- RLDISC-warn places `has_more_records: true` inside json_encoded_response, because that is the object the helper returns to the route. If 127-01 surfaces has_more_records differently on the helper result, the route check (`result.has_more_records`) may need adjusting.
- No other web specs needed MeResponse literal updates (tsc clean).
- Plan-text acceptance counts: `csvInBrowserMaxRows` in index.ts is 1 as specified; no non-discriminating criteria found.

## Self-Check: PASSED
