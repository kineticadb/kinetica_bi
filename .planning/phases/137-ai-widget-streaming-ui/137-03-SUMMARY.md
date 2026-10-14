---
phase: 137-ai-widget-streaming-ui
plan: 03
subsystem: deploy
tags: [nginx, sse, streaming]
requires: []
provides: ["S2 nginx streaming location for /api/ai/ask"]
affects: [docker/nginx.conf]
key-files:
  created: [packages/server/tests/deploy.nginxStream.spec.ts]
  modified: [docker/nginx.conf, docker/README.md]
requirements: [AIWID-V20-04]
metrics:
  tasks: 1
  completed: 2026-10-14
---

# Phase 137 Plan 03: nginx SSE streaming Summary

Exact-match `location = /api/ai/ask` in the deploy nginx (buffering/cache/gzip off, HTTP/1.1, 300 s idle timeout, proxy headers re-declared), guarded by a red-first text spec plus an `nginx -t` check.

## Task

1. Spec + conf + README (commit 9b99c02).

## Verification

- Red first: against the pre-change conf, NGX-1 and NGX-2 FAILED (2 failed, 2 passed); after the edit all 4 pass.
- NGX-4 RAN (nginx is on PATH at /usr/local/bin/nginx): `nginx -t` reported syntax ok. No server started, no port bound.
- Pre-change greps read 0; after: `location = /api/ai/ask` 1, `proxy_buffering off` 1, `SSE` in README 2, `NGX-` lines in spec 4.
- Server `tsc --noEmit` clean; `test-gate.mjs` PASSED (5 non-listed files passed alone, contamination only, none mine).

## Deviations

None. Generic `location /api/` left unchanged (NGX-3 guards it).

## Self-Check: PASSED
Files and commit 9b99c02 exist.
