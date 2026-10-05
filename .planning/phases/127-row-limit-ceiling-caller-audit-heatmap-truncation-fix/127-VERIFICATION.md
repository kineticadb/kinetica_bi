---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
verified: 2026-10-05T12:40:00Z
status: passed
score: 4/4 success criteria verified
---

# Phase 127 Verification Report

**Goal:** Every app query asking Kinetica for >1,000 rows gets them (audited caller by caller), and a truly truncated heatmap always shows its warning.
**Status:** passed (4/4). Re-verification: No.

## Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Records CSV >1,000 rows downloads up to the CSV cap | VERIFIED | `kinetica.ts` hardcoded `limit: 1000` is gone (grep 0); `DEFAULT_MAX_ROWS_PER_QUERY`/`DEFAULT_MAX_RECORDS_PER_CALL` = 20,000 env-driven, batch split + has_more paging (L156-360). `WidgetRenderer` loop is has_more-driven; csvInBrowserMaxRows carried via /api/auth/me. Operator live check approved. |
| 2 | Written caller classification, all "needed" sites fixed | VERIFIED | `127-CALLER-AUDIT.md` exists (70 lines); discovery routes pin explicit limit (plan 02); notices for Calendar/grouped Timeline/Numeric Line (plan 05). |
| 3 | Heatmap Result Limit 5,000 draws the full grid | VERIFIED | Envelope 20,000 with no 1,000 cap; heatmap banner driven by `detectTruncation` LIMIT+1 probe; operator live check approved at 2,500/5,000. |
| 4 | Truly truncated heatmap shows warning | VERIFIED | `rowTruncation.ts` (`detectTruncation`, `bumpTrailingLimit`) feeds `HeatmapRenderer` `data-testid="heatmap-truncated"` banner with result-limit vs deployment-max reasons; exact-full result shows none (D-14). |

## Requirements Coverage

| ID | Plans | Status |
|----|-------|--------|
| EXPRT-V126-01 | 01, 02, 04, 07 | SATISFIED |
| EXPRT-V126-02 | 01-07 | SATISFIED |
| EXPRT-V126-03 | 03, 06, 07 | SATISFIED |

All three IDs appear in plan frontmatter and are marked Complete in REQUIREMENTS.md (Phase 127). No orphaned requirements: V126-04..17 map to phases 128-131.

## Test Gates (run by verifier)

- Web `tsc --noEmit`: clean (exit 0)
- Web `vitest run`: 186 files / 4219 tests passed
- theme-guard: 154 passed
- Server `tsc --noEmit`: clean (exit 0)
- Server `node scripts/test-gate.mjs`: GATE PASSED; 8 failing files, all in the documented known set (TD-V11-04 OIDC, db.smoke drift, routes.wms)

## CSS / Token Check (diff 76a1896..HEAD, packages/web/src)

- Added `var(--...)`: only `--muted`; defined in global.css.
- Added className: only `config-hint`; defined in global.css (3 occurrences).
- No hardcoded hex flagged by theme-guard.

## Anti-Patterns

None blocking found in changed source.

## Human Verification / Known Gaps

Operator live checkpoint approved (127-07-SUMMARY). Documented skipped items, not required by a ROADMAP criterion: split-call row order live, D-11 live, grouped Numeric Line live (all covered by unit tests). Light/dark visual appearance of the new notices was part of the operator checkpoint; not re-verified here.

Post-checkpoint fixes e09881a, 4ef676b, 7612f92, 6fb1c33 are present in HEAD history and covered by green tests.

---
_Verified: 2026-10-05_
_Verifier: Claude (gsd-verifier)_
