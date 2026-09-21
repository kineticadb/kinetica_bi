---
phase: 121-ui-cross-environment-verification
plan: 03
subsystem: web-ui
tags: [react, permissions, dashboard-export, dashboard-import, rbac, dxim]

# Dependency graph
requires:
  - phase: 121-01
    provides: "downloadDashboardExport(dashboard) + importDashboardFile(file) + ImportReportDto family in packages/web/src/api/client.ts"
  - phase: 121-02
    provides: "ImportDashboardModal — file picker + POST trigger + full ImportReportDto presentation"
provides:
  - "DashboardsPage per-row Export button (unconditional — mirrors the export route's canViewDashboard-only gate)"
  - "DashboardsPage page-level Import dashboard control gated on canImport = canCreate AND hasPermission(DATASETS_MANAGE)"
  - "ImportDashboardModal mounted from DashboardsPage; onImported -> refetch() live-refreshes the list"
  - "The + New Dashboard btn-primary -> btn-primary btn-sm class swap, now that it shares ds-actions with Import"
affects: ["121-04"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side permission gate mirrors a server route's AND-composition exactly (canCreate && hasPermission(DATASETS_MANAGE)), proven by two single-permission negative fixtures rather than a single neither-permission fixture — closes the discrimination gap Phase 120 Wave 4 hit"
    - "Asymmetric gating on purpose: Export unconditional (route gates on canViewDashboard only, list already server-filtered), Import AND-gated — pinned by a dedicated UIWIRE-export-analyst test so a future 'tidy-up' does not over-restrict Export"

key-files:
  created:
    - packages/web/src/components/DashboardsPage.exportimport.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx

key-decisions:
  - "canImport = canCreate && hasPermission(PERMISSIONS.DATASETS_MANAGE) — a genuine AND mirroring the import route's own gate (index.ts:809-812) byte-for-byte, so the control is hidden rather than offered-then-refused. Proven by two inline single-permission fixtures (create-only, manage-only) built via useAuthStore.setState (seedAuthStore.ts NOT edited, per constraint)."
  - "Export renders unconditionally per row with no client-side permission check — the export route gates on canViewDashboard only, and the list is already server-filtered by it. UIWIRE-export-analyst pins this deliberate asymmetry with Import."
  - "+ New Dashboard changed from btn-primary to btn-primary btn-sm — a DELIBERATE, in-scope consequence of CLAUDE.md's primary-in-an-action-pair rule now that it shares the ds-actions row with Import dashboard. The only styling change this whole phase authorizes."
  - "onImported={() => refetch()} rather than a local list prepend — the import report carries only dashboardId/dashboardName, not a full DashboardDto, so a live re-fetch is the only way to get a well-formed row."

requirements-completed: []  # Per CRITICAL WARNING #9: this plan does NOT touch DXIM requirement status
  # either way. Plan 121-04 owns the operator round-trip outcome and is the only plan authorized to
  # mark DXIM-V124-01/-03/-10 complete or REOPEN them on failure.

# Metrics
duration: ~35min
completed: 2026-09-17
---

# Phase 121 Plan 03: Dashboard Export/Import UI Wiring Summary

**Wired Plan 01's client functions and Plan 02's modal into `DashboardsPage.tsx`: an unconditional per-row Export button, and a page-level Import control gated on a genuine `dashboards:create AND datasets:manage` client-side mirror of the import route's own AND gate.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 completed (2 committed, 1 zero-diff)
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- Every dashboard row now carries an `Export` button (`ghost-sm`, last child of the row's existing `ds-actions` span) that calls `downloadDashboardExport(dash)` — unconditional, because the export route gates on `canViewDashboard` only and the list is already server-filtered by it (`GET /api/dashboards`, `index.ts:784-789`).
- A page-level `Import dashboard` control appears only for operators holding BOTH `dashboards:create` AND `datasets:manage` — `canImport = canCreate && hasPermission(PERMISSIONS.DATASETS_MANAGE)`, a byte-for-byte mirror of the import route's own composed gate (`index.ts:809-812`). Two single-permission negative fixtures (create-only, manage-only) prove the AND rather than an OR — the exact discrimination gap Phase 120 Wave 4 previously missed with a neither-permission-only fixture.
- `ImportDashboardModal` is mounted conditionally on `showImportModal`; `onImported={() => refetch()}` re-fetches the dashboard list so the newly imported dashboard appears live, without a page reload.
- `+ New Dashboard` changed from a standalone `btn-primary` to `btn-primary btn-sm`, now that it shares the `ds-actions` action-pair row with `Import dashboard` — the single, deliberate, in-scope styling change this entire phase authorizes (CLAUDE.md's primary-in-an-action-pair rule).
- 13 `UIWIRE-` tests, all green on the first attempt, including both AND-gate negative probes and runtime proofs of the class swap and the shared `ds-actions` parent.
- 6/6 mutation probes fired clean and reverted byte-identical on the FIRST attempt (no fixture strengthening needed) — including the M1/M2 pair that specifically targets the AND-vs-OR discrimination this plan's critical warning called out.

## Task Commits

Each task was committed atomically:

1. **Task 1: Export button per row + permission-gated Import control + modal mount** - `6a33e9b` (feat)
2. **Task 2: DashboardsPage.exportimport.spec.tsx** - `0f7e90d` (test)
3. **Task 3: Mutation probes + full web gates** - no commit (net zero diff — all 6 probes reddened their targeted test(s) on the first attempt with the tests as originally written; `DashboardsPage.tsx` confirmed byte-identical to HEAD after every probe's revert)

## Files Created/Modified

- `packages/web/src/components/DashboardsPage.tsx` — Added `downloadDashboardExport` + `ImportReportDto` imports, `ImportDashboardModal` import, `refetch` destructured from `useApiQuery`, `canImport` gate + `showImportModal`/`exportError` state, page-level actions slot restructured into a `ds-actions` div (`+ New Dashboard` now `btn-primary btn-sm`, conditional `Import dashboard`), per-row unconditional `Export` button + `exportError` rendering beside `deleteError`, and the `ImportDashboardModal` conditional mount beside the existing `DashboardAccessModal` mount.
- `packages/web/src/components/DashboardsPage.exportimport.spec.tsx` — New spec (13 `UIWIRE-` tests) covering export visibility (designer + analyst), the export click/error paths, both AND-gate negative fixtures, the Import modal open/refetch/close wiring (via a mocked `ImportDashboardModal` capturing props on `globalThis.__lastIDMProps`), and runtime proofs of the class swap + shared `ds-actions` parent.

## Decisions Made

- `canImport` is a genuine client-side AND, never an OR — proven not just by the two happy-path tests (designer sees it, analyst doesn't) but by two dedicated single-permission fixtures built inline via `useAuthStore.setState` (not by editing `seedAuthStore.ts`, per constraint 4).
- Export stays permission-free by design; `UIWIRE-export-analyst` and mutation probe M6 both guard against a future contributor "fixing" it into a gated control the server does not require.
- The exact acceptance-criteria BEFORE value for `grep -c "refetch"` (A8) was found to be 1, not the plan's stated 0 (`viewsQuery.refetch()` already existed at line 1006) — a minor plan inaccuracy, not a self-tripping criterion, since the AFTER requirement (`>= 2`) still held and the count landed at 4. Not treated as a deviation requiring a Rule 1-4 fix; noted here for the record.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-3 auto-fixes were needed; no Rule 4 architectural questions arose.

## Mutation Probe Table (6/6, per CLAUDE.md's verifiable-acceptance-criteria rule)

| # | Mutation | Must redden | Result |
|---|---|---|---|
| M1 | `const canImport = canCreate;` (drop the `DATASETS_MANAGE` half of the AND) | `UIWIRE-import-create-only:` | Reddened `UIWIRE-import-create-only` only. Reverted, byte-identical. |
| M2 | `const canImport = hasPermission(PERMISSIONS.DATASETS_MANAGE);` (drop the `canCreate` half) | `UIWIRE-import-manage-only:` | Reddened `UIWIRE-import-manage-only` only. Reverted, byte-identical. |
| M3 | Delete the per-row `Export` button | `UIWIRE-export-visible:`, `UIWIRE-export-analyst:`, `UIWIRE-export-click:`, `UIWIRE-export-error:` | Reddened all four exactly. Reverted, byte-identical. |
| M4 | Revert `+ New Dashboard` to bare `className="btn-primary"` | `UIWIRE-newdash-class:` | Reddened `UIWIRE-newdash-class` only. Reverted, byte-identical. |
| M5 | Change `onImported={() => refetch()}` to `onImported={() => {}}` | `UIWIRE-import-refetch:` | Reddened `UIWIRE-import-refetch` only. Reverted, byte-identical. |
| M6 | Gate Export behind `{canEdit && …}` | `UIWIRE-export-analyst:` | Reddened `UIWIRE-export-analyst` only. Reverted, byte-identical. |

**6/6 fired clean on the first attempt — no test strengthening required this plan.** M1/M2 in particular are the pair CLAUDE.md's critical warning named explicitly: a single-permission mutation must be caught by a single-permission fixture, not by a neither-permission (analyst) fixture that cannot discriminate AND from OR — both fired correctly against the dedicated create-only/manage-only fixtures.

## Confirmed Gate Numbers

- `cd packages/web && npx tsc --noEmit` → clean, zero output.
- `cd packages/web && npx vitest run` → **179 files, 4067 tests, 0 failed** (baseline after Plan 02 was 178 files / 4054 tests; this plan added exactly 1 file / 13 tests — matches the plan's predicted 179 files exactly).
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **152 tests, 0 failed** (unchanged — this plan added no new component `.tsx` file, only edited an existing one).
- `git status --porcelain packages/web/src/styles/global.css` → empty.
- `ls packages/web/src/components/*.css` → unchanged (4 pre-existing files).
- `git diff --numstat HEAD -- packages/server` → empty (run from repo root).
- className-vocabulary guard on `DashboardsPage.tsx` → printed nothing (zero invented classNames).

## Issues Encountered

None beyond the minor BEFORE-value discrepancy on acceptance criterion A8, documented above under Decisions Made.

## User Setup Required

None — no external service configuration required.

## Tooling note

`gsd-tools state advance-plan` / `roadmap update-plan-progress` cannot parse this project's file formats (per this plan's own critical warning #8). `STATE.md` and `ROADMAP.md` were edited manually in the existing style.

## Next Phase Readiness

- Both UI entry points (per-row Export, permission-gated Import) are live in `DashboardsPage.tsx`, the modal is wired with a live-refresh `onImported` callback, and the whole phase has now added ZERO new CSS — the only visual risk carried into Plan 04 is class MISUSE, not new styling.
- Carried forward from Plan 02: `TD-V123-THEMEGUARD-HOLE` (the reused `.error` class is a pre-existing raw hex in the allowlisted `global.css`; theme-guard never checks absence there) — both new surfaces (the import modal and the two new buttons) still need human eyes in BOTH light and dark themes as part of Plan 04's `checkpoint:human-verify`.
- No blockers. `packages/server` carries zero diff — this plan is confirmed web-only as required.
- Per critical warning #9 and CLAUDE.md's own instruction: no DXIM requirement has been marked complete or reopened by this plan. Plan 04 owns the operator round-trip outcome and all DXIM-V124-01/-03/-10 requirement-closure decisions, including reopening any of them on a FAILED round trip.

## Self-Check: PASSED

- FOUND: `packages/web/src/components/DashboardsPage.tsx`
- FOUND: `packages/web/src/components/DashboardsPage.exportimport.spec.tsx`
- FOUND: `.planning/phases/121-ui-cross-environment-verification/121-03-SUMMARY.md`
- FOUND commit: `6a33e9b` (Task 1)
- FOUND commit: `0f7e90d` (Task 2)

All claimed artifacts and commits verified present on disk / in git history.

---
*Phase: 121-ui-cross-environment-verification*
*Completed: 2026-09-17*
