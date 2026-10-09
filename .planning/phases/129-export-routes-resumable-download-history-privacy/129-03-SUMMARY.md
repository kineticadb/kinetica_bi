---
phase: 129-export-routes-resumable-download-history-privacy
plan: 03
subsystem: server/exports
tags: [exports, download, range, privacy]
requires: [129-01, 129-02]
provides: [GET /api/exports/:id/download]
affects: [129-04]
key-files:
  modified:
    - packages/server/src/exportRoutes.ts
  created:
    - packages/server/tests/routes.exports.download.spec.ts
metrics:
  tasks: 2
  completed: 2026-10-07
---

# Phase 129 Plan 03: Resumable download route Summary

GET /api/exports/:id/download gates owner (404), complete (409), file integrity (410), then delegates to res.download (send@0.19.2) for 200/206/416/If-Range, with `Cache-Control: private, no-store` and the `exportDownloadName` filename. The route never reads the Range header.

## Route table
| Method | Path | Success | Refusals |
|---|---|---|---|
| POST | /api/exports | 202 | 400, 403, 404, 500 |
| GET | /api/exports | 200 | - |
| GET | /api/exports/:id | 200 | 404 |
| POST | /api/exports/:id/cancel | 202 | 404, 409 |
| DELETE | /api/exports/:id | 204 | 404 |
| GET | /api/exports/:id/download | 200 / 206 | 404 (not owner/unknown/malformed), 409 `{status}` (not complete, Range or not), 410 (file missing/mismatch/foreign/.part), 416 (unsatisfiable Range) |

## Commits
- a777816: download route
- Task 2 commit: routes.exports.download.spec.ts (16 EXPRT129-dl- tests) plus the 416 fix in exportRoutes.ts

## Deviations
**[Rule 1 - Bug] 416 returned as 500.** send reports an unsatisfiable Range through the res.download callback (error with statusCode 416 and a Content-Range header). The plan's callback mapped every non-ENOENT error to 500. Found by EXPRT129-dl-416. The callback now applies the error headers and answers 416.

## Discrimination probes (exportRoutes.ts restored after each)
- D1 status gate removed -> dl-not-complete and dl-range-on-running red.
- D2 integrity gate stubbed -> dl-size-mismatch and dl-foreign-file red.
- D3 `cacheControl: true` alone did NOT fire (send only sets its default when no Cache-Control exists, so it is an equivalent mutation). Removing our `setHeader("Cache-Control")` together with it -> dl-full red.
- D4 res.download replaced by pipe -> 9 tests red (all Range/206/416/If-Range/resume/gzip/e2e).
- D5 loadOwnedJob replaced by raw getExportJob -> dl-noleak red. (A first attempt matched the path string in the header comment and mutated nothing; redone correctly.)
- D6 ENOENT branch removed -> did NOT fire. Honest limit: it needs a file vanishing between our stat and send's open, not reproducible deterministically in a fast test. dl-missing-file covers only the pre-stat case.

## Verification
tsc clean; download spec 16/16 and routes.exports 14/14 green; `npm run test:gate` PASSED (routes.filter-materialize failed in the full run, passes alone: contamination). New specs are not in KNOWN_FAILING. Shared docs untouched; no requirement marked complete.

Honest limit: Range resumption through the real deployment proxy is not provable here (for Plan 129-04 to route to a human-verify checkpoint).

## Self-Check: PASSED
