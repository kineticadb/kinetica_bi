---
phase: 121-ui-cross-environment-verification
plan: 02
subsystem: web-ui
tags: [react, modal, dashboard-import, dxim, ui]

# Dependency graph
requires:
  - phase: 121-01
    provides: "importDashboardFile(file) + ImportReportDto family in packages/web/src/api/client.ts"
provides:
  - "ImportDashboardModal — file picker + POST trigger + full ImportReportDto presentation, reused by Plan 03's DashboardsPage wiring"
affects: ["121-03", "121-04"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase single modal shell (report === null ? pick : report) inside one modal-overlay/modal-content, mirroring DashboardAccessModal's chrome — zero new CSS"
    - "Every server-authored operator-facing string (MetricConflict.message, warnings[]) rendered verbatim with no .length/.slice() summarization — the report-fidelity pattern this component exists to prove"

key-files:
  created:
    - packages/web/src/components/ImportDashboardModal.tsx
    - packages/web/src/components/ImportDashboardModal.spec.tsx
  modified: []

key-decisions:
  - "No new component CSS file and zero edits to global.css — every className used (modal-overlay, modal-content, modal-header, modal-title, modal-body, modal-section-title, modal-section-title-spaced, datasets-table, ds-row, ds-field, ds-field-label, ds-actions, btn-primary, btn-sm, ghost-sm, error, muted) was confirmed present in global.css before use; className-vocabulary guard printed nothing."
  - "metricConflicts.length appears exactly once in the component — the `> 0` visibility guard — never as a rendered count; proven by acceptance criterion B3 and by mutation probe M2 (the load-bearing probe: replacing {c.message} with a count summary reddens IMPRPT-conflict-verbatim, confirming the test actually discriminates the DXIM-V124-10 failure mode)."

requirements-completed: []  # Per CRITICAL WARNING #8: this plan does NOT touch DXIM requirement status
  # either way. Plan 121-04 owns the operator round-trip outcome and is the only plan authorized to
  # mark DXIM-V124-10 complete or reopen it.

# Metrics
duration: ~30min
completed: 2026-09-17
---

# Phase 121 Plan 02: ImportDashboardModal — File Picker + Full Import Report Summary

**Built `ImportDashboardModal.tsx` — a two-phase modal (pick file -> read report) that renders every `MetricConflict.message` and `warnings[]` string verbatim, with matched-vs-created dispositions for both tables and custom metrics, using zero new CSS.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 completed (2 committed, 1 zero-diff)
- **Files created:** 2

## Accomplishments

- `ImportDashboardModal` reuses `DashboardAccessModal.tsx`'s exact chrome (`modal-overlay` > `modal-content` > `modal-header` + `modal-body`, `datasets-table`/`ds-row` sections) — the plan's confirmed closed class set, no invented classNames, no new `.css` file, `global.css` untouched.
- Phase A (picker): `<input type="file">` wrapped in the standard `.ds-field` shape, `btn-primary btn-sm` + `ghost-sm` inside `.ds-actions` for the matched-height action pair per CLAUDE.md's canonical pattern.
- Phase B (report): created counts (dashboard id, widgets/layers/dynamic views), tables and custom metrics split into matched-vs-created rows, metric conflicts (only when non-empty) rendering `c.message` verbatim in `.error` divs, warnings rendered verbatim in `.muted` divs, stripped references and pre-flight dangling references each in their own conditional section, and a `Done` button.
- 14 `IMPRPT-` tests (>= 12 required), all green — including the load-bearing `IMPRPT-conflict-verbatim`, which asserts the FULL server-shaped conflict sentence via exact-text `getByText` match and a negative assertion that no `1 conflict` count-summary text ever appears.
- 5/5 mutation probes fired and reverted cleanly (`git diff --exit-code` confirmed byte-identical after each) — including M2, the probe that directly simulates the DXIM-V124-10 failure mode (rendering a count instead of the message), which correctly reddened `IMPRPT-conflict-verbatim`.
- Full web gates green: `tsc --noEmit` clean, `npx vitest run` 178 files / 4054 tests / 0 failed, `theme-guard.spec.ts` 152/152 (up from the confirmed 150 baseline — exactly +2 from this one new non-spec `.tsx`), `global.css` diff empty, `packages/server` diff empty.

## Task Commits

1. **Task 1: Build ImportDashboardModal (picker state -> POST -> report)** - `325ada9` (feat)
2. **Task 2: ImportDashboardModal.spec.tsx** - `4bc1d54` (test)
3. **Task 3: Mutation probes + gates** - no commit (net zero diff — all 5 probes reddened their targeted test(s) on the first attempt with the tests as originally written; no fixture strengthening or component code change was required, so there was nothing new to stage)

## Files Created/Modified

- `packages/web/src/components/ImportDashboardModal.tsx` - New component (209 lines). Props `{ onClose, onImported }`; state `file`/`busy`/`error`/`report`; `handleImport` POSTs via `importDashboardFile` and calls `onImported(report)` on success, leaving `report` null on failure so the picker stays available with the server's own error message.
- `packages/web/src/components/ImportDashboardModal.spec.tsx` - New spec (230 lines, 14 `IMPRPT-` tests) covering picker enable/disable, the POST call arguments, created counts, table/metric matched-vs-created disposition, verbatim conflict message + negative count-summary assertion, hidden-when-empty conflicts section, verbatim warnings (including the real widened-filter `ALL LAYERS` sentence), stripped references, error/rollback message passthrough, `onImported` call semantics, and the header Close button.

## Decisions Made

- Zero new CSS confirmed both structurally (no `.css` file created; `git diff --numstat -- packages/web/src/styles/global.css` empty) and via the className-vocabulary guard (every static `className="..."` literal in the new file resolves to a real selector in `global.css`).
- `metricConflicts.length` appears exactly once — the `> 0` visibility guard for the conflicts section — never as a displayed count. Acceptance criterion B3 (`grep -c "metricConflicts.length"` <= 1) confirmed this before commit.
- The plan's suggested `handleImport` shape (`setBusy(true); setError(null);` ... `finally { setBusy(false); }`) was followed exactly; no deviation was needed to avoid a self-tripping acceptance criterion in this plan (unlike Plan 121-01, which hit one).

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-3 auto-fixes were needed; no Rule 4 architectural questions arose.

## Mutation Probe Table (5/5, per CLAUDE.md's verifiable-acceptance-criteria rule)

| # | Mutation | Must redden | Result |
|---|---|---|---|
| M1 | Delete the entire metric-conflicts block | `IMPRPT-conflict-verbatim:` | Reddened `IMPRPT-conflict-verbatim` only (timeout waiting for the message that no longer renders). Reverted, byte-identical. |
| M2 | Replace `{c.message}` with `` {`${report.metricConflicts.length} conflict(s)`} `` | `IMPRPT-conflict-verbatim:` (both assertions) | Reddened `IMPRPT-conflict-verbatim` only — the exact DXIM-V124-10 failure mode this component exists to prevent. Reverted, byte-identical. |
| M3 | Delete the `warnings` section | `IMPRPT-warnings:` | Reddened `IMPRPT-warnings` only. Reverted, byte-identical. |
| M4 | Render only `tablesCreated`, dropping the `tablesMatched` map | `IMPRPT-tables:` | Reddened `IMPRPT-tables` only. Reverted, byte-identical. |
| M5 | In `handleImport`'s catch, swallow the error (`setError("Import failed")`) instead of `(err as Error).message` | `IMPRPT-error:` AND `IMPRPT-rollback:` | Reddened both as required, plus `IMPRPT-onImported` (which also asserts on a literal rejection message in its second half) — an expected side effect, not a discrimination failure. Reverted, byte-identical. |

**5/5 fired clean on the first attempt — no test strengthening required this plan.**

## Recorded FINDING for Plan 04 (visual/theme check)

`.error` (`global.css:1098`) is a raw `#ef4444`, PRE-EXISTING and not introduced by this plan. `theme-guard.spec.ts` allowlists `global.css` and only asserts `hasHex === true` there — it NEVER checks absence for allowlisted files — so the metric-conflict rows (which reuse `.error`) need a human visual check in BOTH light and dark themes before Plan 04's operator UAT is considered complete. This is `TD-V123-THEMEGUARD-HOLE`, carried forward from this plan's own critical warnings; Plan 04 should pick it up as part of its `checkpoint:human-verify`.

## Confirmed Gate Numbers

- `cd packages/web && npx tsc --noEmit` -> clean, zero output.
- `cd packages/web && npx vitest run` -> **178 files, 4054 tests, 0 failed** (baseline after Plan 01 was 177 files / 4040 tests; this plan added exactly 1 file / 14 tests from `ImportDashboardModal.spec.tsx`; the observed +2 beyond 4054-4040-14=0 arithmetic mismatch note: 4040+14=4054 exactly — matches).
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` -> **152 tests, 0 failed** (up from the confirmed 150 baseline — exactly +2, matching one new non-spec `.tsx` under `src/components/`).
- `git diff --numstat -- packages/web/src/styles/global.css` -> empty.
- `git diff --numstat HEAD -- packages/server` -> empty.
- `ls packages/web/src/components/*.css` -> unchanged (4 pre-existing files: `CustomMetricsEditorModal.css`, `ProfilePage.css`, `RolesPage.css`, `Topbar.css`).
- className-vocabulary guard on `ImportDashboardModal.tsx` -> printed nothing.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Tooling note

`gsd-tools state advance-plan` / `roadmap update-plan-progress` cannot parse this project's file formats (per this plan's own critical warning #7). `STATE.md` and `ROADMAP.md` were edited manually in the existing style.

## Next Phase Readiness

- `ImportDashboardModal` is exported and ready for Plan 121-03 to wire into `DashboardsPage.tsx` (Import button opening the modal, `onImported` triggering a dashboard-list refetch, and the `btn-primary` -> `btn-primary btn-sm` swap that plan owns).
- No blockers. `packages/server` carries zero diff — this plan is confirmed web-only as required.
- Per critical warning #8 and CLAUDE.md's own instruction: no DXIM requirement has been marked complete or reopened by this plan. Plan 04 owns the operator round-trip outcome and all DXIM-V124-10 (and -01/-03) requirement-closure decisions.
- The `TD-V123-THEMEGUARD-HOLE` finding above (raw-hex `.error` class, allowlisted so never flagged) is carried forward for Plan 04's human-verify checkpoint.

## Self-Check: PASSED

- FOUND: `packages/web/src/components/ImportDashboardModal.tsx`
- FOUND: `packages/web/src/components/ImportDashboardModal.spec.tsx`
- FOUND: `.planning/phases/121-ui-cross-environment-verification/121-02-SUMMARY.md`
- FOUND commit: `325ada9` (Task 1)
- FOUND commit: `4bc1d54` (Task 2)

---
*Phase: 121-ui-cross-environment-verification*
*Completed: 2026-09-17*
