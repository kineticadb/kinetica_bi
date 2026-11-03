---
phase: 137-ai-widget-streaming-ui
plan: 02
subsystem: server-ai
tags: [ai, lock, deadline, kinetica-jobs, abort]
requires: []
provides: [hard AI deadline releasing AI_BUSY lock, tagged abortable Kinetica probes, cancelKineticaJobsByTag]
affects: [aiRoutes, kinetica, liveSchema, runAnswer]
key-files:
  created: [packages/server/src/lib/kineticaJobs.ts, packages/server/tests/lib.kineticaJobs.spec.ts, packages/server/tests/routes.aiAsk.deadline.spec.ts]
  modified: [packages/server/src/aiRoutes.ts, packages/server/src/kinetica.ts, packages/server/src/lib/ai/runAnswer.ts, packages/server/src/lib/ai/liveSchema.ts, packages/server/tests/kinetica.sql.spec.ts, packages/server/tests/lib.aiLiveSchema.spec.ts]
decisions:
  - "tagSql lives in kineticaJobs.ts; kinetica.ts imports it. kineticaJobs imports only types from kinetica.ts and keeps a local 8-line auth-header builder, so there is no runtime import cycle."
metrics:
  completed: 2026-10-14
---

# Phase 137 Plan 02: W1 lock deadline, abortable tagged probes, job cancel

A hard deadline (AI_TIMEOUT_MS + grace) now always releases the per-user AI lock, schema probes carry the answer's abort signal and a `/* kbi-ai:<requestId> */` tag, and Cancel or the deadline best-effort cancels tagged Kinetica jobs.

## Commits
- 1ae4e25 feat(137-02): kineticaJobs tag/cancel and signal+tag on kineticaSql
- 95f03cb feat(137-02): hard deadline releases AI lock; tagged abortable probes; cancel jobs on abort

## What was built
- `lib/kineticaJobs.ts`: `tagSql`, `AI_JOB_TAG_PREFIX`, `cancelKineticaJobsByTag` (show/jobs, match `query_text`, one alter/jobs cancel; tag validated `^[A-Za-z0-9-]{1,64}$`; never throws; logs only "[ai] job cancel failed").
- `kineticaSql`: optional `signal` and `tag`; AbortError mapped to `KineticaUpstreamError("Kinetica request aborted")` with no URL/SQL.
- `aiRoutes.ts`: `release()` guarded by `inflight.get(key) === ac`, `finalizeOnce`, hard-deadline race started before `runAnswer`, single `AI_TIMEOUT` SSE error, `__setAiGraceMsForTest`, cancelJobs on connection close and deadline.
- `liveSchema.ts`/`runAnswer.ts`: signal and tag threaded into probes.

## TDD record
Red before implementation: lib.kineticaJobs (module missing), KSQL-SIG-1/KSQL-TAG-1, LS-SIG-1, and W1-1..W1-4 all failed. W1-1 and W1-3 were red before the aiRoutes edit (the route specs failed at the missing `__setAiGraceMsForTest` export, then passed after the deadline logic landed; they genuinely exercise never-settling provider and never-settling probe). All green afterwards.

## Verification
- tsc clean. kineticaJobs, kinetica.sql, aiLiveSchema, deadline, audit, preflight specs green.
- `node scripts/test-gate.mjs`: GATE PASSED. Failures seen (lib.exportRunner.memory, routes.branding, routes.exports.caps, routes.materialize) all pass alone (TD-V16-TEST-ISOLATION / load-sensitive; the memory spec takes ~65 s). One earlier gate run flagged routes.aiAsk.deadline.spec.ts for the `detail` vs `outcome_detail` column name; fixed in the spec before commit.
- Acceptance greps: `inflight.get(key) === ac` = 1, `tag: input.requestId` = 1, `signal: input.signal` = 2 in runAnswer.ts.

## Deviations
- [Rule 1] Spec asserted `rows[0].detail`; the ai_audit column is `outcome_detail`. Fixed in the new spec.
- Pre-check grep `grep -rc "kbi-ai" packages/server` would also count node_modules/.env; not meaningful, real requirement verified by KJ-1/KSQL-TAG-1.
- No other files outside files_modified touched. STATE/ROADMAP/REQUIREMENTS untouched (parallel rules).

## Self-Check: PASSED
Files exist (kineticaJobs.ts, both new specs); commits 1ae4e25 and 95f03cb exist.
