---
phase: 129-export-routes-resumable-download-history-privacy
verified: 2026-10-07T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
human_verification:
  - test: "Proxy-path resume: curl -C - against the deployed :8080 nginx origin, with -H 'Accept-Encoding: gzip' on the 206 step"
    expected: "206 Partial Content passes through nginx; the resumed file is byte-identical"
    why_human: "Operator reported 'not exercised: proxy not running'. docker/nginx.conf was reviewed statically only. Recorded as open debt in STATE; closes at Phase 131 criterion 5."
---

# Phase 129 Verification Report

**Goal:** A finished export is only served as a complete, closed file over a Range-resumable download. Every route checks ownership against an unguessable id. No new RBAC permission is needed beyond the dashboard view gate.
**Status:** human_needed. All automated checks pass. The one open item is the accepted proxy-resume debt.
**Re-verification:** No, initial verification.

## Success criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Range gets 206 on a complete export; a running job is refused | VERIFIED | `packages/server/src/exportRoutes.ts` download route uses `res.download` (send@0.19.2 handles Range, 206 and 416). The status gate returns 409 for every non-complete job, with no Range-specific branch. `tests/routes.exports.download.spec.ts` passes. |
| 2 | Non-owner is rejected on every :id route; ids are UUIDs | VERIFIED | `loadOwnedJob` -> `findOwnedExportJob` in `src/lib/exportJobAccess.ts`. It checks `EXPORT_UUID_RE` first, then the owner, case-insensitively. It is used by GET :id, cancel, DELETE and download. Malformed, unknown and not-yours ids all get the same 404 body. |
| 3 | No new permission | VERIFIED | `git diff ba8af45 -- packages/server/src/lib/permissions.ts packages/server/src/rbacDb.ts` is empty. Routes are registered at `index.ts:1268`, below the requireAuth-only boundary comment, with no `requirePermission`. The test `EXPRT129-analyst-grant-only` exists at `tests/routes.exports.spec.ts:135` and passes. |
| 4 | Only status "complete" is served | VERIFIED | The route order is owner (404), then `status !== "complete"` (409), then `resolveServableExportFile` (410), then send. The file check requires the basename to be `<id>.csv` or `<id>.csv.gz`, the directory to be the export directory, and the size to equal `fileBytes`. |

## Operator decisions

| ID | Decision | Result |
|---|---|---|
| O-1 | Identical 404; 409; 410; 416 | OK. The 404 uses a single `NOT_FOUND` constant. 409 covers any non-complete job. 410 covers a missing file or size mismatch, including ENOENT in the send callback. 416 is mapped from the send error and carries its Content-Range header. |
| O-2 | DELETE on a running job cancels, then deletes | OK. `ACTIVE` jobs get `cancelExport`, then the files are removed and `deleteExportJob` runs, returning 204. |
| O-3 | `enableCsvDownload === false` gives 403 on start, after the view gate | OK. The 404 widget/view check comes first, then the 403. |
| O-4 | Ownership only on :id routes | OK. There is no `canViewDashboard` call in the :id handlers. |
| O-5 | `options.gzip` accepted | OK. It is validated as a boolean. |
| O-6 | No concurrency cap | OK. No cap exists in the routes. |
| O-7 | Filename `export-<date>-<id8>.csv[.gz]` | OK. Built by `exportDownloadName`. |

## Requirements coverage

| ID | Plans | REQUIREMENTS.md | Status |
|---|---|---|---|
| EXPRT-V126-11 | 129-01, 03, 04 | ticked `[x]`, table says "Complete (proxy-path resume not exercised)" | SATISFIED (proxy leg is human debt) |
| EXPRT-V126-13 | 129-01, 02, 03, 04 | ticked `[x]` | SATISFIED |
| EXPRT-V126-17 | 129-02, 03, 04 | ticked `[x]` | SATISFIED |
| EXPRT-V126-05 / 07 | 129-02 (route half) | unticked `[ ]`, table says "In progress ... completes in Phase 131" | Correctly NOT ticked |

All three phase requirement IDs are accounted for. No orphaned requirements.

## Gates (run by me)

- `npx tsc --noEmit` is clean (exit 0).
- `npm run test:gate` PASSED. 1671 of 1724 tests passed. 8 files failed, all in the documented known set (TD-V11-04 OIDC, db.smoke, routes.wms). None are export files.
- `tests/routes.exports.spec.ts` and `tests/routes.exports.download.spec.ts` passed in isolation: 30 of 30 tests.
- `git status` is clean. `_kbi_exp_` appears only in `src/lib/exportSql.ts` and the spikes (naming and cleanup code), with no leftovers referenced. A credential grep over the spikes found nothing.

## Anti-patterns

None blocking. No stubs were found in `exportRoutes.ts` or `exportJobAccess.ts`.

## Notes for the orchestrator

- STATE.md frontmatter says `status: phase_129_complete` and `stopped_at` says "awaiting verification". This is consistent with the pre-verification state. Finalize it now.
- The ROADMAP.md phase list still shows `- [ ] Phase 129` and the progress table needs a bookkeeping update. The plan checkboxes were not checked by me. The orchestrator should tick Phase 129.
- Accepted, not a gap: probe D6 (file vanishes between stat and send's open) is not deterministically testable. The route handles ENOENT by returning 410.

## Human verification required

1. **Proxy-path Range resume.** Run `curl -C -` against the deployed :8080 nginx origin with `-H 'Accept-Encoding: gzip'` on the 206 step. A 206 should pass through and the resumed file should be byte-identical. This was not run live because the proxy was not running. It is open debt closing at Phase 131 criterion 5.

_Verifier: Claude (gsd-verifier)_
