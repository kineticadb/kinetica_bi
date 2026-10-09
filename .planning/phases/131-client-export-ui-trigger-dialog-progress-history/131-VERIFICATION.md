---
phase: 131-client-export-ui-trigger-dialog-progress-history
verified: 2026-10-08T12:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 131: Client Export UI Verification Report

**Phase Goal:** From the records table, the user can start, name, configure, watch, and manage background exports end to end, verified against a real Kinetica instance.
**Status:** passed. **Re-verification:** No.

## Gates (run by verifier)

| Gate | Result |
|---|---|
| server `tsc --noEmit` | clean |
| server `npm run test:gate` | PASSED. 1803/1857, 9 failing files: 8 known-listed, plus `routes.info-query.spec.ts`, which passes alone (contamination, allowed). `exportRunner.memory.spec` was not among the failures. |
| web `tsc --noEmit` | clean |
| web `vitest run` | 198 files / 4359 tests, all passed |
| theme-guard | 158 passed |
| check-classnames (4 files) | OK, 54 tokens |
| `git status` | clean |
| credentials | no `.env` tracked; no secret patterns in the phase docs |
| `npm ci --dry-run` | succeeds, lockfile consistent |

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Start and name an export from the table (EXPRT-05/08) | VERIFIED | ExportDialog.tsx exists. V3 live: non-ASCII name `Résumé – 数据 / Q1` survived. |
| 2 | Raw vs formatted, and Compress (.zip), off by default (09/10) | VERIFIED | `options.compress` is parsed in exportRoutes.ts, with `gzip` kept as a deprecated alias. The runner picks `.zip` or `.csv` (exportRunner.ts:303). Live: formatted + compressed output was valid, header "Fare ($)". |
| 3 | Watch progress and cancel (06/07) | VERIFIED | V5 cancel -> cancelled with no file. V7 no polling after logout. Operator V1/V4. |
| 4 | History list: re-download and delete (12) | VERIFIED | V4 operator, and the list DTO verified live. V6 Range 206 resume, sha256 identical. |
| 5 | Live checkpoint against a real Kinetica instance | VERIFIED | 131-10-SUMMARY `## Checkpoint: V1-V13`: all 13 PASS, operator + orchestrator evidence. |

## Post-plan UAT fixes confirmed in code

- 6c710cf: ExportDialog uses `createPortal` (line 276) with `modal-overlay` / `modal-content` / `modal-header` / `modal-body` classes. check-classnames passes.
- fd5e312: `nameRef.current?.focus()` sits in the mount effect (lines ~106-115), with an explanatory comment.
- 131-11: `packages/server/src/lib/zipStream.ts` exists. It is a streaming one-entry zip writer with deflate, data descriptor and ZIP64, with no new dependency. The runner wires `createZipEntryStages`. Cleanup candidates include legacy `.csv.gz` and `.csv.gz.part`. `exportJobAccess.ts` maps legacy `gzip` rows to `compress`. No non-spec `.csv.gz` references remain apart from the legacy-handling paths.
- c83d138 (gzip OS-byte revert): the gzip stage was superseded by the .zip writer. No `createGzip` remains in server src. The revert's effect is not independently inspectable and is covered by 131-11.
- Requirement wording: EXPRT-V126-10 in REQUIREMENTS.md reads "Compress (.zip)", consistent with D-07a.

## Requirements Coverage

| Req | Status |
|---|---|
| EXPRT-V126-05, 06, 07, 08, 09, 10, 12 | SATISFIED, all marked complete in REQUIREMENTS.md. No orphaned Phase 131 IDs found. |

## Anti-Patterns

None blocking. No stub components were found in the artifacts inspected.

## Accepted Items (not gaps)

- Proxy-path resume not exercised (Phase 129 debt, EXPRT-V126-11 note).
- page_size widget-action no-op (pre-existing Phase 58 bug, logged as a follow-up).
- `_kbi_exp_2432df35` awaiting its TTL.
- Memory spec contamination watch. It did not fail this run.

## Limitations

The following items were not inspected line by line. They rest on the live checkpoint evidence and the green gates:
- the per-plan must_haves frontmatter
- the CONTEXT D-01..D-18 decisions
- the c83d138 gzip OS-byte revert

Visual and UX items (V1, V4, V11, V12, V13) rest on operator sign-off recorded in 131-10-SUMMARY.

_Verified: 2026-10-08_
_Verifier: Claude (gsd-verifier)_
