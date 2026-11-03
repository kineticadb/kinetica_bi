---
phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes
plan: 07
subsystem: spikes
tags: [spike, sse, zod, registry]
requirements: [AIPRV-V20-01]
key-files:
  created:
    - packages/web/src/spikes/s3Validators.spike.spec.ts
    - packages/server/src/spikes/sseSpike.ts
    - .planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md
decisions:
  - "S3: derive-for-all FAIL; v2.0 subset bar, line, pie, table, bignumber, records (map flagged separately)"
  - "S2: SSE over POST via fetch ReadableStream; cap stream at AI_TIMEOUT_MS and re-check session per op; nginx needs proxy_buffering off"
metrics:
  tasks: 3
  completed: 2026-10-09
---

# Phase 133 Plan 07: Spikes S2 + S3 Summary

S2 (POST + SSE through real Express middleware) and S3 (registry-derived validators) run and recorded in 133-SPIKES.md; S1/S7 slots pending operator run (133-08).

## Commits
- 11643be S3 harness
- 2e53fcb S2 harness
- e853a19 133-SPIKES.md

## Results
- S2: all of C1-C6 PASS (events at 505/1005/1505 ms; 413 JSON before stream; abort seen in 5 ms). Stream outlives revoked session (6/6 events), so decision is duration cap + per-op session re-check.
- S3: 8 of 16 types have `fields: []`; derive-for-all FAILS. Subset proposed for operator approval at 133-10.

## Deviations from Plan
- S3 harness also writes the JSON report to `S3_REPORT_PATH` when set, because the web vitest setup swallows console output (the report could not otherwise be captured). Not required to run.
- S3 criterion (c) of research (validate real saved widgets.config rows) was not done; the plan's Task 1 did not require it. Noted as reduced confidence.
- Observed: heatmap measured `addable: true` (research expected false). Recorded as measured.
- sseSpike.ts has a couple of dead leftover lines (`streamEventsAfterRevoke`, empty marker branch); harmless.

## Verification notes
- Web full suite: one failure in a single run (ColumnFormatEditorModal T1), passes 11/11 in isolation; also noisy "view.getCenter" logs (map). Unrelated to this plan (parallel-run flake / parallel executors).
- Criterion check: `**Decision:**` count is 4, consequence 4, `## S[1237]` 4, PENDING >=2, proxy_buffering off 1.

## Self-Check: PASSED
All three files exist; commits 11643be, 2e53fcb, e853a19 present.
