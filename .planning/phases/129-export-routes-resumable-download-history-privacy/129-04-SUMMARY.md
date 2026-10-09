---
phase: 129-export-routes-resumable-download-history-privacy
plan: 04
subsystem: server/exports
tags: [live-smoke, range-resume, privacy, verification-debt]
requires: [129-01, 129-02, 129-03]
provides:
  - "npm run export-routes-smoke (live R1-R7 over a real HTTP socket against real Kinetica)"
affects: [STATE.md, ROADMAP.md, REQUIREMENTS.md]
tech-stack:
  added: []
  patterns: ["live smoke via createApp() + app.listen(0), real login, in-memory DB, temp EXPORT_DIR"]
key-files:
  created: [packages/server/src/spikes/exportRoutesSmoke.ts]
  modified: [packages/server/package.json]
key-decisions:
  - "EXPRT-V126-11 marked Complete (live R4 passed) with proxy-path resume recorded as open verification debt"
metrics:
  completed: 2026-10-07
---

# Phase 129 Plan 04: Live route smoke, gates and shared docs Summary

Live smoke of the six /api/exports routes against real Kinetica (demo.nyctaxi, 500k rows) passes R1-R7, including a byte-identical interrupted-then-resumed download; the proxy-path `curl -C -` check was not exercised and is recorded as open debt.

## Task 1: Live smoke (commit 7bbc2e0)

demo.nyctaxi, 500k rows, real HTTP socket, real login. R1-R7 all PASS:
- R1: 202, uuid4, complete 500000/500000, 16636920 bytes.
- R2: 200 full; accept-ranges bytes; cache-control private, no-store; content-disposition contains export-.
- R3: 206 `bytes 100-16636919/16636920`.
- R4: interrupted resume from byte 1048576 -> 206, sha256 match.
- R5: 409 while running; cancel 202 -> cancelled; 0 files.
- R6: non-owner 404 on GET, download, cancel and DELETE, deep-equal to a random-UUID probe.
- R7: delete 204, file gone, then 404.

Cleanup: `_kbi_exp_243e08ca`(+_pg) and `_kbi_exp_4542c788`(+_pg) dropped and verified gone.

## Checkpoint: proxy-path resume

- Operator reply: "not exercised: proxy not running" (the deploy nginx container was not up at verification time). Recorded as open verification debt, not a pass.
- Static review of the proxy config (by the orchestrator, not a live test): the proxy is the project's own nginx in the `web` image (`Dockerfile:21-23`, `docker/nginx.conf`, run via local-deploy/docker-compose.yml). (a) `gzip_types` = `text/css application/javascript application/json image/svg+xml`, which excludes `text/csv` and the `.csv.gz` content type, so nginx will not compress exports and break Range. (b) `location /api/` is a plain `proxy_pass http://127.0.0.1:4000` with no `proxy_set_header Range`/`proxy_force_ranges` override, so nginx forwards Range/If-Range and relays upstream 206 by default. (c) proxy_buffering is at its default, which does not break Range.
- Follow-up: run the curl steps (with `-H 'Accept-Encoding: gzip'` on step 4) against the deployed :8080 origin. Also covered by Phase 131 success criterion 5 ("a download resumes after a killed connection instead of restarting").

## Task 3: Gates

- Server `npx tsc --noEmit`: clean.
- Server `npm run test:gate`: GATE PASSED; 1671/1724 tests, 8 failing files, all in the known set (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms). No extra failing file.
- Phase 129 specs in isolation (routes.exports, routes.exports.download, lib.exportJobAccess, db.exportJobs): 4 files, 60 tests passed.
- Web: `git diff --stat ba8af45 -- packages/web` empty, so no web gates needed.

## Doc edits (by hand)

- REQUIREMENTS.md: EXPRT-V126-11/13/17 ticked and Complete in traceability (-11 with suffix "(proxy-path resume not exercised — see STATE)"); -05/-07 status cells set to "In progress — engine 128, routes 129; completes in Phase 131", checkboxes left `[ ]`; footer updated.
- ROADMAP.md: plan lines 129-01..04 ticked; Correction note added under Phase 129 canonical refs; Phase 129 checkbox in `## Phases` untouched.
- STATE.md: frontmatter, Phase 129 outcome paragraph (incl. open debt and the do-not-ship warning), Next line.

## Deviations from Plan

1. [Rule 3 - Blocking] The smoke sets NODE_ENV=test before importing index.ts to avoid its auto-listen on :4000 (EADDRINUSE), then calls createApp() + app.listen(0).
2. Non-discriminating acceptance criterion: `grep -ciE "console\.(log|error)\(.*(PASSWORD|cookie|kbi_session)"` reads 1, not 0. The match is the env-validation message that names the variable KINETICA_PASSWORD without printing its value. The criterion cannot discriminate, so the code was not changed to satisfy it; no credential or cookie value is printed.

## Self-Check: PASSED
