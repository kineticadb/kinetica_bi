---
phase: 128-export-job-core-live-spike-runner-snapshot-cancel
verified: 2026-10-06T00:00:00Z
status: human_needed
score: 5/5 success criteria verified at the server-primitive level
human_verification:
  - test: "Snapshot isolation under a concurrently changing table"
    expected: "Start an export against a writable table, insert/delete rows in the source mid-run, confirm the CSV equals the state at start and rows_written == COUNT(MV)"
    why_human: "Spike and smoke were read-only (D-02); guarantee is structural (job-private MV, default REFRESH OFF), not tested live"
  - test: "Requirement bookkeeping decision for EXPRT-V126-05 and EXPRT-V126-07"
    expected: "Operator confirms re-opening both checkboxes (see Judgement 1)"
    why_human: "Policy decision on REQUIREMENTS.md wording; verifier must not edit it"
---

# Phase 128: Export Job Core Verification Report

**Phase Goal:** Settle the paging question live, and deliver a batch-loop runner producing an exact, filter-snapshotted, formula-injection-safe export with cancel and session-bound credentials.
**Status:** human_needed. Engineering goal achieved; two items for the human (below).
**Re-verification:** No, initial.

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Written spike decision: mechanism, max_get_records_size, has_more_records | VERIFIED | `128-SPIKE-NOTES.md`: Chosen mechanism `offset`; max_get_records_size 20000 (empirical, SHOW SYSTEM PROPERTIES returned empty); has_more verified on all pages (500k rows, 25 pages); operator approval recorded 2026-10-06 |
| 2 | Export contains exact rows/columns/order/sort at start; snapshot semantics | VERIFIED structurally; live concurrency test not done | `exportSql.ts` builds `snapshotBody` from persisted widget config + validated filters/customWhere (not client SQL), `_kbi_exp_<id8>` view; `exportRunner.ts` creates the MV, `COUNT(*)` from the MV, all pages from the MV, offset advances by rows received, `written !== total` raises RowMismatchError, `.part` renamed only on success. Live smoke: rows_written == COUNT |
| 3 | `= + - @` cells written as literal text, same rule both paths | VERIFIED | `packages/server/src/lib/csvExport.ts` + web `csvExport.ts`; `lib.csvExport.parity.spec.ts` plus web `csvExport.spec.ts` pass (187 tests) |
| 4 | Cancel stops loop, deletes partial file, row terminal cancelled | VERIFIED | `cancelExport` (exportRunner.ts:215), abort checks before each batch, finalize "cancelled"; `lib.exportRunner.cancel.spec.ts`; live smoke cancel case |
| 5 | Session expiry/revoke fails closed to a failed status | VERIFIED | `getSession(sid)` re-derived per batch (`principalForSession`), finalize `session_expired`; `lib.exportRunner.session.spec.ts`; live smoke session-end case |

**Score:** 5/5

## Artifacts and Wiring

| Artifact | Status | Notes |
|---|---|---|
| `packages/server/src/lib/exportSql.ts` (233 lines) | VERIFIED | Imported by exportRunner; spec exists |
| `packages/server/src/lib/exportRunner.ts` (351 lines) | VERIFIED | Uses `createOrReplaceMaterialized`, `kineticaSql`, sessionStore, db export_jobs helpers |
| `packages/server/src/lib/csvExport.ts` | VERIFIED | Parity spec |
| `export_jobs` registry in db.ts | VERIFIED | `db.exportJobs.spec.ts`; terminal-write-once truth |
| `src/spikes/exportPagingSpike.ts`, `exportRunnerSmoke.ts` | VERIFIED | Present; evidence committed |
| Routes / UI | Not in scope | No routes (Phase 129) or UI (Phase 131) by design; runner is only called from specs/smoke |

## Requirements Coverage

All four IDs appear in plan frontmatter (04: 128-01; 05: 128-02/04/05/07; 07: 128-03/05/06/07; 16: 128-03/05/06/07). No orphaned IDs: REQUIREMENTS.md maps exactly 04/05/07/16 to Phase 128.

| ID | Status | Judgement |
|---|---|---|
| EXPRT-V126-04 (formula-injection, BOTH download paths) | SATISFIED | Client path edited; server writer ported; parity spec. Note "both paths" is met: existing in-browser download plus export file writer |
| EXPRT-V126-16 (session end stops export, no stale creds) | SATISFIED at runner level | Fail-closed proven in spec and live smoke. The "logout" trigger is covered through sessionStore deletion; no route-level wiring yet, which is not needed for the semantics |
| EXPRT-V126-05 ("the user can start a background export...") | NOT fully satisfied as worded; checkbox premature | See Judgement 1 |
| EXPRT-V126-07 ("the user can cancel a running export...") | NOT fully satisfied as worded; checkbox premature | See Judgement 1 |

## Judgement 1: premature checkboxes (05 and 07)

Both requirements are worded as user capabilities. In Phase 128 there is no HTTP route to start or cancel (Phase 129) and no UI (Phase 131). `cancelExport(jobId)` and the start/run function exist and are proven by specs and live smoke, so the engine behaviour (exact rows/columns/order/sort, filter snapshot, partial file deletion, terminal cancelled row) is delivered. A user cannot yet do either action. The ROADMAP's Phase 128 success criteria are satisfied (they are phrased as primitives), but the requirement text is not.

Recommended bookkeeping (not applied; REQUIREMENTS.md untouched):
- Revert EXPRT-V126-05 and EXPRT-V126-07 to `[ ]` / "In progress (engine delivered in 128; user-facing completion pending Phases 129/131)".
- Map them to Phase 128 + Phase 129 (route) + Phase 131 (UI) in the traceability table and mark Complete when Phase 131 lands. Optionally add them to the Requirements lines of Phases 129 and 131 in ROADMAP.
- Keep 04 and 16 as Complete.

## Judgement 2: snapshot under concurrent change

Adequately evidenced structurally but not proven live. Code: snapshot MV is created once (`createOrReplaceMaterialized`), COUNT and every page read `FROM <snapshotView>` (exportSql.ts:184,193,208); no read touches the source after creation. Caveat: the code does not emit an explicit `REFRESH OFF`; it relies on Kinetica's documented default for MVs (SPIKE-NOTES line ~129; Q3 showed identical COUNTs). The count check `written === total` would catch drift between the MV and paging. Residual risk is low, but it is listed under human verification: run one export against a table being written to.

## Gates (run by verifier)

- Server: `npx tsc --noEmit` clean. `npm run test:gate`: 1621/1674 passed, 8 failing files all in the known/documented set (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms). GATE PASSED. None are export-related.
- Web: `npx tsc --noEmit` clean; `csvExport.spec.ts` + `theme-guard.spec.ts`: 2 files, 187 tests passed.

## Hygiene

- `git status` clean.
- `_kbi_exp_` appears in tracked files only as the view-name prefix in source, specs, and .planning docs, which is expected. No leftover MV names or data, no committed `.env`, key, or `.csv` files; no credential strings found in the spike files or tracked files (greps for private-key blocks and `KINETICA_PASSWORD=` came back empty).

## Anti-patterns

None blocking found in the runner or SQL builder. Minor, informational: header-probe path used when no columns are configured; offset paging cost grows with table size (516 to 815 ms per 20k page at 500k rows, documented in the spike).

## Gaps Summary

No code gaps. Outstanding: (1) bookkeeping correction for EXPRT-V126-05/-07; (2) optional live concurrent-write snapshot check.

---
_Verified: 2026-10-06_
_Verifier: Claude (gsd-verifier)_
