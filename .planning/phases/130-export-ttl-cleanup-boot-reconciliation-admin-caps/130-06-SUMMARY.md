---
phase: 130-export-ttl-cleanup-boot-reconciliation-admin-caps
plan: 06
subsystem: exports
tags: [smoke, live-verification, caps, sweep, docs]
requires: [130-01, 130-02, 130-03, 130-04, 130-05]
provides:
  - live smoke R8 (sweep vs held-open download), R9 (row cap), R10 (concurrency cap)
  - Phase 130 closed: EXPRT-V126-14 and -15 Complete
affects: [Phase 131 export UI]
key-files:
  modified:
    - packages/server/src/spikes/exportRoutesSmoke.ts
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
decisions:
  - "A cancelled run's in-flight Kinetica call no longer counts against the per-user concurrency cap (accepted trade-off of b260084)"
metrics:
  completed: 2026-10-07
---

# Phase 130 Plan 06: Live smoke, gates and shared docs Summary

Live smoke steps R8-R10 against real Kinetica (demo.nyctaxi, 500k rows) prove the expiry sweep skips a held-open download, the row cap and concurrency cap fire, and the operator approved criterion 3. Shared docs updated by hand.

## Task 1: Smoke R8/R9/R10 (936295e)

Added `sweep-vs-open-download`, `row-cap-live`, `concurrency-live` to `exportRoutesSmoke.ts`. Final live result after the review fixes (run by the orchestrator, 2026-10-07): R1-R10 all PASS.

- R8: `open=true expired_get=410 skipped=1 file_kept=true sha_match=true after_close_deleted=true new_get=404 bytes=16636920`
- R9: row_cap, `rows_written=0`, no file
- R10: 202 then 429 `concurrency_cap`
- All `_kbi_exp_*` snapshot views dropped and verified gone.

## Checkpoint: sweep vs open download

Operator response (2026-10-07), verbatim: **"approved"**

The operator approved after seeing the R8 result re-run live against the fixed code, and the restart test below. ROADMAP criterion 3 is operator-verified; no open debt for it.

The optional restart reconcile was also exercised live: real server via the bootstrap IIFE, throwaway DB_PATH/EXPORT_DIR, port 4117. kill -9 mid-export of 500k rows, then restart. The job became failed/`server_restarted` with "Export stopped: the server restarted. Start it again."; its `.part` was deleted; a stray `<uuid>.csv` was removed and `notes.txt` was left alone. Boot log: "[export] reconcile: 1 interrupted jobs failed, 1 orphan files removed" plus "left 1 unrecognised file(s) in EXPORT_DIR untouched". The leftover snapshot was dropped manually (D-06 TTL backstop).

## Post-checkpoint review fixes

The orchestrator ran two code reviews and live testing after the checkpoint and committed fixes:

- **b260084 (server)**
  - (a) Cancel frees the concurrency slot at once. Runs whose controller is aborted are excluded from the count (new db helper `listActiveExportJobIdsForUser`; test EXPCAP-conc-cancel-immediate).
  - (b) `trackExportDownload` skips an already-closed response (`res.destroyed`; EXPSWEEP-tracker-already-closed).
  - (c) The size-cap message now says "after about N rows" (the row count runs a stream buffer ahead of bytes on disk).
- **8bea0f3 (web)**: password `login()` now loads `/me` deploy config (exportLimits plus the pre-existing csvInBrowserMaxRows, maxRowsPerQuery, dvFilterScopeDisabled, maxBarGroupBySeriesCap, ttlKeepaliveLeadMinutes), which previously stayed at defaults until a reload. Shared `meToState()` with bootstrap (LOGINME-refresh, LOGINME-me-fails).
- **a0fa0f5**
  - (a) EXPORT_TTL_HOURS is capped at 87600 (`EXPORT_MAX_TTL_HOURS`). Larger values overflowed the JS Date range, so `toISOString()` threw a RangeError on every DTO and list/status returned 500 (EXPACC130-ttl-overflow).
  - (b) login applies /me in one set before flipping to authenticated (LOGINME-single-set).
  - (c) A pre-open abort check in the runner. Not a bug fix: EXPRUN-abort-before-open is a regression guard only.
- **Accepted trade-off of (a) in b260084:** a cancelled run's in-flight Kinetica call (normally <1s; up to Node fetch's ~5-min default timeout if Kinetica stalls) no longer counts against the cap.
- Each fix's test was shown red without the fix and green with it (except the labelled regression guard).

Live evidence after the fixes: HTTP edge cases on the real server with EXPORT_TTL_HOURS=99999999999, EXPORT_MAX_CONCURRENT_PER_USER=abc, EXPORT_MAX_ROWS=0, EXPORT_MAX_FILE_MB=-5 gave one warn each with the correct fallback; /me exportLimits `{null,null,2}`; list 200 with a 24h expiresAt; 5 simultaneous starts gave 202,202,429,429,429; cancel then immediate start gave 202.

## Task 3: Gates (run at close, HEAD a0fa0f5)

- Server `npx tsc --noEmit`: clean.
- Server `npm run test:gate`: GATE PASSED, 1741/1794 tests, 8 failing files, exactly the known set (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms); no contamination-only files this run.
- Targeted specs (exportCaps, exportCleanup, exportRunner, routes.exports, db.exportJobs, exportJobAccess, auth.me, boot.exportReconcile): 15 files, 174 tests pass.
- `bootstrap.spec.ts -t "bootstrap gate"`: 2 passed.
- Web `npx tsc --noEmit`: clean. `npx vitest run`: 188 files, 4244 tests pass. theme-guard: 154 pass.

## Consolidated probes (A-R, each red then reverted green)

- A: check moved after insert into run -> 5 EXPCAP-conc tests red
- B: `>=` to `>` -> 5 conc tests red
- C: case-sensitive count SQL -> EXPCAP-conc-case-insensitive red
- D: RowCapError check moved after writeCsv -> EXPCAP-row-over red
- E: byteCap before createGzip -> EXPCAP-size-gzip-measures-compressed red
- F: SizeCapError.name = "AbortError" -> EXPCAP-size-raw, size-gzip-over red
- G: remove open-download skip -> EXPSWEEP-open-download red
- H: `close` to `finish` -> EXPSWEEP-tracker-refcount, open-download red
- I: remove `released` guard -> EXPSWEEP-tracker-refcount, open-download red
- J: job-id-prefix keep rule -> EXPBOOT-orphans red
- K: drop `!d.isFile()` -> EXPBOOT-foreign-untouched red
- L: drop `isExportRunLive` filter -> EXPBOOT-skip-live red
- M: delete `trackExportDownload` -> EXPSWEEP-held-download red
- N: delete `isExportExpired` gate -> EXPSWEEP-expired-410, held-download red
- O: reconcile inside createApp -> EXPBOOT-not-in-createApp and EXPBOOT-iife red
- P: drop `exportLimits` from /me -> 3 EXPLIM-me tests red
- Q: remove `exportLimits:` in fetchMe -> both EXPLIM-fetchMe specs red
- R: remove `exportLimits` in bootstrap -> EXPLIM-store-bootstrap red

(Plan 130-01 also ran five formatting/SQL/timezone probes outside the A-R lettering.)

## Doc edits (by hand)

- REQUIREMENTS: EXPRT-V126-14 and -15 ticked and Complete; -05/-07 untouched (Phase 131).
- ROADMAP: six 130-0N plan lines ticked; Phase 130 checkbox in `## Phases` untouched.
- STATE: Phase 130 outcome paragraph, do-not-ship warning resolved, debt carried forward, Phase 131 seams recorded.

## Deviations from Plan

None in this plan's own work. Fixes after the checkpoint came from orchestrator review, recorded above.

## Self-Check: PASSED
