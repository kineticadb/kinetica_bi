---
phase: 139-session-only-dynamic-views
plan: 02
subsystem: server
tags: [dynamic-views, threshold, preflight, kinetica]
requires: []
provides:
  - "lib/dvThreshold.ts pure decision module (reused by 139-05)"
  - "tag/signal pass-through in createOrReplaceMaterialized"
  - "aggregated flag on GET /api/dashboards/:id/dynamic-views"
affects: [139-05, 139-11]
tech-stack:
  added: []
  patterns: ["source gate first, tagged cancellable output preflight only for aggregated templates"]
key-files:
  created:
    - packages/server/src/lib/dvThreshold.ts
    - packages/server/tests/lib.dvThreshold.spec.ts
  modified:
    - packages/server/src/lib/materializedView.ts
    - packages/server/tests/lib.materializedView.spec.ts
    - packages/server/src/index.ts
    - packages/server/tests/routes.dynamic-view.spec.ts
key-decisions:
  - "Output rule is <= max_records; source rule stays strict >="
  - "Tag/signal passed to createOrReplaceMaterialized only on the preflight path; non-aggregated DDL call unchanged"
requirements-completed: [AIACT-V20-07]
duration: 20min
completed: 2026-10-20
---

# Phase 139 Plan 02: Aggregated saved-view threshold Summary

Saved aggregated dynamic views (GROUP BY / DISTINCT / trailing LIMIT) over the source cap now build when their output fits (`<= max_records`), filtered or not, via a tagged, client-disconnect-cancellable output-count preflight. Non-aggregated templates are unchanged and run no preflight.

## Commits
- Task 1: dvThreshold module + tag/signal pass-through (`feat(139-02): dvThreshold decision module ...`)
- Task 2: route rewiring + specs (`feat(139-02): saved dynamic-view materialize uses aggregated output preflight ...`)

## Fixture changes (Pitfall 7, deliberate)
Both pinned over-threshold tests ("over threshold — drops dynamic view ..." and "no filter view + capped base over cap ...") now seed `template_sql: "SELECT * FROM {view}"`, with the comment `// 139 D-03: non-aggregated fixture (pins the unchanged source rule)`. Their expected statement lists are unchanged.

## Deviations from Plan
- Note: the output preflight tag also prefixes the CREATE DDL (`/* kbi-ai:dvp-... */ CREATE OR REPLACE ...`) on the preflight path, because kineticaSql's tag option prefixes every statement. RDV-1 asserts this. This is the intended D-08 behaviour so the build job is cancellable too.
- Strict red-first was not observed for Task 1 (lib specs written together with implementation); RDV-1/RDV-3 not run against pre-change handler.
- Did not run `node scripts/test-gate.mjs` (orchestrator: 139-14 runs full gates); ran targeted specs + `tsc --noEmit` only.

## Issues / env leak
Under the dev `packages/server/.env` (`DEFAULT_VIEW_TTL_MINUTES=3`), 3 pre-existing tests in routes.dynamic-view.spec.ts fail on TTL assertions (happy path expires_at, base-under-cap regex, oidc smoke). With `DEFAULT_VIEW_TTL_MINUTES=5` set in the environment all 73 tests across routes.dynamic-view / -crud / -drop pass. Code not changed for this.

Acceptance-criteria notes: pre-checks held (all new symbols/counts were 0 before). Verified after: `const isTableNotFoundError` count 0 in index.ts, `decideThreshold(` present, `isAggregatedTemplate(` >= 2, RDV- >= 6, fixture comment = 2.

## Self-Check: PASSED
- dvThreshold.ts, lib.dvThreshold.spec.ts, SUMMARY present; both commits exist in git log.
