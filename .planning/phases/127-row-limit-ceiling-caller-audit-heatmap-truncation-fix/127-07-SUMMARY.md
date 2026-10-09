---
phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix
plan: 07
subsystem: planning-audit
tags: [row-limit, caller-audit, live-verification, shared-docs]
requires: [127-01, 127-02, 127-03, 127-04, 127-05, 127-06]
provides: [127-CALLER-AUDIT.md, phase-127-closeout]
key-files:
  created:
    - .planning/phases/127-row-limit-ceiling-caller-audit-heatmap-truncation-fix/127-CALLER-AUDIT.md
  modified:
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
decisions:
  - /api/auth/me now also carries maxRowsPerQuery (reusable by Phase 128+)
  - Row-order stability across split kineticaSql calls carried to Phase 128 live spike as an open question
metrics:
  tasks: 3
  completed: 2026-10-05
---

# Phase 127 Plan 07: Caller audit, live verification, phase close-out

Wrote the ROADMAP criterion-2 caller audit (every runSql / kineticaSqlHelper / kineticaSql site classified, each "needed" row linked to its fix and test), ran the consolidated live check against real Kinetica (approved), and closed out ROADMAP / REQUIREMENTS / STATE by hand.

## Tasks
1. Caller audit - commit beb161a (127-CALLER-AUDIT.md).
2. Live verification checkpoint - operator APPROVED 2026-10-05.
3. Shared docs updated by hand (no gsd-tools mutation commands): ROADMAP Phase 127 plans list + checklist ticked; EXPRT-V126-01/02/03 marked Complete; STATE shows Phase 127 complete, next Phase 128.

## Live verification results (operator)
1. CSV over 1,000 rows - PASS.
2. CSV cap message + CSV_INBROWSER_MAX_ROWS ceiling - PASS.
3. Heatmap banner (no false positive at exact limit; Result-limit and deploy-max tooltips) - PASS.
4. Split-call row order - SKIPPED by operator. Row-order stability across split calls without a unique ORDER BY remains UNVERIFIED; carried to Phase 128's live spike.
5. KINETICA_MAX_RECORDS_PER_CALL above server max_get_records_size (D-11) - SKIPPED; unit tests only.
6. Notices legible in light and dark at KINETICA_MAX_ROWS_PER_QUERY=3 - PASS for records table, bar chart, Calendar, grouped Timeline, heatmap; vanish when override removed. Grouped Numeric Line not checked live (shares Timeline code path). Bar chart legend oddity at max=3 confirmed not a bug (only 3 rows returned; "Showing top N series" is the pre-existing MAX_BAR_GROUP_BY_SERIES=2 dev override).
7. .env restored by operator.

## Deviations from Plan

### Defects found at checkpoint/review and fixed by the orchestrator
- **e09881a fix(127-05):** `var(--text-muted)` was an undefined token (real token `--muted`) on Timeline/NumericLine/Calendar row notes and pre-existing Phase-72 series notes; inline color fell back to inherit.
- **4ef676b fix(127-04):** records table skipped rows when KINETICA_MAX_ROWS_PER_QUERY < page size (Next went 1-3 to 26-28). /api/auth/me now carries maxRowsPerQuery; the table clamps page size; note reads "Limited to N rows per page". Tests RLREC-page-clamp, RLME-maxrows-default, RLME-maxrows-env.
- **7612f92 fix(127-04):** /me is read once at bootstrap so a stale tab still skipped rows. The table now learns the page cap from a server-cut page (has_more_records + fewer rows than asked). Test RLREC-learned-cap (mutation-probed). Removed the unreachable per-page fallback.
- **6fb1c33 fix(127-06):** heatmap Result limit hint now says it warns "when more cells exist than this limit" rather than when a result "reaches" it.

Gates after fixes: web tsc clean; web vitest 186 files / 4219 tests pass; theme-guard 154 pass; server tsc clean; server test-gate PASSED (failures only in the documented TD-V16-TEST-ISOLATION set).

## Open items
- Split-call row-order stability without unique ORDER BY: unverified, Phase 128 spike.
- D-11 and grouped Numeric Line: not verified live.

## Self-Check: PASSED
