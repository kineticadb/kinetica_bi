---
phase: 139-session-only-dynamic-views
plan: 14
subsystem: ai-dynamic-views-verification
tags: [uat, gates, bookkeeping, kinetica-7.2.3.12]
requires: ["139-01", "139-02", "139-03", "139-04", "139-05", "139-06", "139-07", "139-08", "139-09", "139-10", "139-11", "139-12", "139-13"]
provides:
  - Operator UAT of session-only AI dynamic views against real Kinetica 7.2.3.12 (light and dark)
  - Fix 2cef90c: dv-bound widgets never bind to a table filter combination
  - AISAFE-V20-04 joins amendment; Phase 139 bookkeeping
affects: [140, 141, 142]
tech-stack:
  added: []
  patterns: ["Claude-driven CDP UAT through the DEV harness (no provider call)"]
key-files:
  created:
    - .planning/phases/139-session-only-dynamic-views/139-14-UAT-STEPS.md
    - .planning/phases/139-session-only-dynamic-views/139-14-UAT-RESULTS.md
  modified:
    - packages/web/src/hooks/useCombinationOrchestrator.ts (fix 2cef90c)
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/PROJECT.md
decisions:
  - "UAT steps 8/8b (preflight cancel, join through a filter view) deferred to Phase 142 by the operator: dashboard 12 has one table and no registered table shares a join key with demo.nyctaxi."
  - "Issue 1 (AI-view bar queried the base filter view while pending) fixed now (2cef90c); issues 2 and 3 left open as minor/cosmetic."
metrics:
  tasks: 3
  completed: 2026-10-20
---

# Phase 139 Plan 14: Gates, operator UAT and Phase 139 bookkeeping Summary

Session-only AI dynamic views were verified live against Kinetica 7.2.3.12 in light and dark (median/percentile/DATE_TRUNC, real tiles at both map sites, drill filters, removal, lifecycle by listing views), one race found in UAT was fixed (2cef90c), and the joins/preflight live checks were deferred to Phase 142.

## Task 1: gates + UAT steps (8c720d1)
Run sequentially on the integrated tree, 2026-10-20 (from `139-14-UAT-STEPS.md`):
- shared: tsc OK; vitest 189 passed (9 files)
- server: tsc OK; `test-gate` PASSED (set-based; 8 known-failing files allowed; `lib.exportRunner.memory` and `routes.dashboard-export` pass alone = TD-V16-TEST-ISOLATION). 2365/2420 tests passed
- web: tsc OK; `vitest --maxWorkers=4` 251 files passed, 1 skipped, 4942 tests passed; theme-guard 172 passed
- OIDC "Issuer is not a constructor" failures (bootstrap, auth.routes specs) fail identically on pre-phase commit 4536a0c. Two more failures (auth.routes password-mode `/me`; bootstrap "AUTH_OIDC_ISSUER_URL is missing") appear only when `packages/server/.env` is present and fail the same at 4536a0c: dev-.env leak, not Phase 139 regressions.
- No provider or Kinetica call by the executor in Task 1; `packages/server/.env` was not read (copied unread into a temp worktree for the comparison, then deleted).

## Task 2: operator UAT (resolved)
Operator asked Claude to run it. Claude drove the operator's signed-in Chrome over CDP (harness only, no provider request); the operator signed in twice (incl. after logout); Claude never handled credentials or read `.env`. Full per-step record: `139-14-UAT-RESULTS.md`.

Verdict: steps 0-7, 9-11 PASS (light and dark where visual); step 8/8b DEFERRED to Phase 142 (operator decision); step 12 SKIPPED.
- Kinetica 7.2.3.12: APPROX median/percentile in GROUP BY inside an MV work (p90 > median, no NULL groups); DATE_TRUNC hour/week/day build, bucket type `datetime`, week starts Sunday.
- Real WMS tiles follow an AI view at BOTH `buildWmsParams` sites (initial render, and after a filter change with `_mv` bump).
- D-23 drill filters on AI-view bars work with no 404; undo/redo (fb38e93) browser-verified.
- Lifecycle listing: undo, discard, dashboard switch, logout (3 s after build, not TTL) and restart (boot sweep dropped 2, 0 left to TTL) all left Kinetica empty; cap refuses the 6th view. No TTL-only remainder observed.
- Removal repoint/drop and one-revert restore work; D-25 ask-once and revert verified through the harness.

## Task 3: UAT results + bookkeeping
Written by hand (no gsd-tools mutation commands). REQUIREMENTS: AISAFE-V20-04 amended for joins (D-07); AIACT-V20-07, AIACT-V20-08, AISAFE-V20-04 and AISAFE-V20-06 traced Complete with evidence (join/preflight live checks noted as deferred to 142). ROADMAP: Phase 139 ticked, 14/14. STATE: Phase 139 outcomes + follow-ups; next Phase 140. PROJECT: Key Decisions row.

## Fix made during UAT
**2cef90c fix(139): dv-bound widgets never bind to a table filter combination** — found at UAT step 5. When a base-table filter changed while an AI view was building, the AI-view bar queried the BASE table's filter view (`MAX(fare_median)` on `_kbi_filt_uadmin_d12_t1_...` -> 502 "Column 'fare_median' not found"), then recovered. `useCombinationOrchestrator`'s table loop mapped every trigger widget with a `tableId` (dv-bound widgets carry it by dual-write) to the table combination. Fix: skip widgets with a numeric `dynamicViewId` in that loop. Pre-existing for saved views (Phase 94). DVTBL-1 (AI + saved) red-first; web tsc clean; full web vitest 251 files / 4944 passed / 1 skipped; browser race repro twice after the fix with zero failing requests.

## Gap-fix commits (earlier in the phase, verified by this UAT)
- 6a26b22 apply_filter/clear_filter accept AI (negative-id) dynamic views (Gap A).
- 4b688a9 rebind to a saved dynamic view updates the shadow tableId (Gap B); confirmed live in step 9 (`_kbi_dv_uadmin_d12_7`).
- fb38e93 AI-view generation change replaces stale dv combination entries (Gap C); browser-verified in step 5c.
- a23ef71 apply_filter description now says "dynamic view, saved or AI-created": the Gap A cosmetic text item listed in UAT-STEPS is RESOLVED.

## Open issues and follow-ups
- Issue 2 (minor): while an AI view is undone, its hand drill filter stays as a top-bar chip labelled "dynamic view -101".
- Issue 3 (cosmetic): on redo the bar briefly queries the unfiltered `_g1` view before the dv filter view is rebuilt.
- Step 8/8b deferred to Phase 142 (needs a real fact+dimension pair; 8a needs `AI_DV_PREFLIGHT_TIMEOUT_MS`).
- Copy: "last 30 days" follow-up is date-agnostic; cap message starts lowercase.
- Non-discriminating plan greps reported in earlier SUMMARYs (139-01, 03, 04, 07, 08, 09, 10): specs and this UAT were the proof, not the greps.

## Deviations from Plan
None to plan scope. The plan said defects become a gap-closure plan; the operator chose to fix Issue 1 immediately (2cef90c), outside a numbered plan. The UAT was run by Claude over CDP at the operator's request, which the plan allows. Step 8/8b and step 12 were not run (operator decision / no valid provider model).

## Auth gates
Sign-in (twice) was performed by the operator in the browser; Claude never handled credentials.
