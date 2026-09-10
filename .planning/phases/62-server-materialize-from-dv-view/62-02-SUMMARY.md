---
phase: 62-server-materialize-from-dv-view
plan: 02
subsystem: server-filter-materialize
tags: [server, filter-materialize, dynamic-view, drill-down, supertest, back-compat]
requires:
  - "62-01: buildFilterViewName optional dynamicViewId → _kbi_filt_u<u>_d<dash>_dv<dvId>_s<s>"
provides:
  - "POST /api/filter/materialize body.dynamicViewId — the dv-source contract Phase 63 consumes"
  - "POST dv path: CREATE OR REPLACE MATERIALIZED VIEW <dv-filter-view> AS SELECT * FROM <buildDynamicViewName(...)> WHERE <column filters>"
  - "DELETE /api/filter/materialize ?dynamicViewId= — drops the dv-filter view"
  - "buildServerWhereClause now imported as a value in index.ts"
affects:
  - "packages/web AggregatedWidgetRenderer (Phase 63 — the SOLE client caller of the dv path)"
tech-stack:
  added: []
  patterns:
    - "additive, back-compat route branch (dv path) — table path byte-unchanged"
    - "dual-mode supertest (password describe + oidc-seeded-session describe)"
    - "fail-safe on unmaterialized source: Kinetica error bubbles via asyncHandler→errorMiddleware (no opaque 500)"
    - "server vitest SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION; never a fixed pass-count)"
key-files:
  created:
    - packages/server/tests/routes.filter-materialize-dv.spec.ts
  modified:
    - packages/server/src/index.ts
decisions:
  - "dv path is column-filters only — spatial+dynamicViewId rejected 400 (spatial-on-dv is v2 / DVX-V2-01)"
  - "same-dashboard scoping: dv row must exist AND dvRow.dashboard_id === body.dashboardId, else 404"
  - "re-narrow tableId before the table path (TS can't carry !isDvPath narrowing past the dv early-return) — identical 400 shape, table behavior unchanged"
  - "no new route, no new SQLite table — branch inside the existing POST + DELETE handlers (route count stays 2)"
metrics:
  duration: ~6min
  tasks: 3
  files: 2
  completed: 2026-06-15
requirements: [DVDRILL-V112-03]
---

# Phase 62 Plan 02: Server Materialize From DV View Summary

Extended `POST` and `DELETE /api/filter/materialize` with an additive, back-compat DV PATH: when `body.dynamicViewId` (POST) or `?dynamicViewId=` (DELETE) is present, the server materializes / drops a filtered sub-view of the dynamic view's OWN materialized view (`CREATE OR REPLACE MATERIALIZED VIEW <_kbi_filt_..._dv<id>_s...> AS SELECT * FROM <_kbi_dv_..._<id>> WHERE <column filters>`) instead of filtering the source table — defining the `dynamicViewId` request-body contract Phase 63's `AggregatedWidgetRenderer` will call. The existing table path is byte-unchanged and regression-locked.

## What Was Built

- **POST dv path** (index.ts ~893): added `dynamicViewId?: number` to the body contract; relaxed validation step 1 so `tableId` is required only on the table path (`isDvPath = typeof dynamicViewId === "number"`). The dv branch — placed before the spatial/table-lookup flow — builds `FROM buildDynamicViewName({ userId, dashboardId, dynamicViewId })` `WHERE buildServerWhereClause(filters)` into the distinct `buildFilterViewName({ ..., dynamicViewId })` target via `createOrReplaceMaterialized` (TTL=5), returning the bare dv-filter view name + expiresAt. Rejects spatial+dv (400), empty filters (400), missing/other-dashboard dv (404 via `getDashboardDynamicView` + `dvRow.dashboard_id !== dashboardId`). An unmaterialized dv source fails safe (Kinetica "object not found" bubbles through `asyncHandler → errorMiddleware`; no opaque 500 constructed).
- **DELETE dv path** (index.ts ~1067): reads an optional `dynamicViewId` query param; the dv branch drops `buildFilterViewName({ ..., dynamicViewId })` (the `_dv<id>` filter view); the table path (`tableId` query param) is unchanged. Preserved `route`/`op: "MATERIALIZE"` audit tags.
- **Import fix**: `index.ts` line 28 went from `import type { ActiveFilter } from "./lib/whereClause"` → `import { buildServerWhereClause, type ActiveFilter } from "./lib/whereClause"` (the named function was not previously imported as a value). `getDashboardDynamicView` / `buildDynamicViewName` / `buildFilterViewName` / `createOrReplaceMaterialized` were already imported.
- **Tests** (`tests/routes.filter-materialize-dv.spec.ts`): 9 cases across two `describe` blocks (password + oidc-seeded session). Covers FROM-dv-view + WHERE, the distinct `_dv<id>` filter-view name (asserted distinct from `_t<tableId>` and from the dv view name itself), the table-path byte-unchanged regression, 404 (missing + other-dashboard dv), 400 (spatial+dv, empty filters), and the DELETE dv drop (`DROP TABLE IF EXISTS _kbi_filt_..._dv<id>_s...`, NOT `_t<id>`). OIDC cases assert username sanitization and the `Bearer <token>` credential branch.

## Verification

- `cd packages/server && npx vitest run tests/routes.filter-materialize-dv.spec.ts` → 9/9 passed (both auth modes).
- `cd packages/server && npx vitest run` (SET-BASED gate) → failing-FILE set = `{auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms}` — exactly the TD-V16-TEST-ISOLATION known-flaky list (8 files); `routes.filter-materialize-dv` is NOT in the failing set. No NEW failing files.
- `cd packages/server && npx tsc --noEmit -p tsconfig.json` → exit 0.
- `git diff --name-only -- packages/web` → EMPTY (server-only phase, asserted every task).
- Route count: `grep -cE 'app\.(post|delete)\("/api/filter/materialize"'` → 2 (no new route).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-narrow `tableId` before the table path**
- **Found during:** Task 1
- **Issue:** The original step-1 guard `if (typeof dashboardId !== "number" || typeof tableId !== "number")` narrowed `tableId` to `number` for the whole handler. Relaxing it (so the dv path doesn't require `tableId`) left `tableId` typed `number | undefined` at the table-path `getTable(tableId)` / `buildFilterViewName({ tableId })` calls — `tsc` failed with TS2345 at index.ts(1022). TS cannot carry the `!isDvPath` narrowing past the dv early-return.
- **Fix:** Added a re-narrowing guard `if (typeof tableId !== "number") return res.status(400)...` right where the table path resumes (after the dv early-return). Same 400 error shape as before; table-path behavior identical (the branch is logically unreachable when `!isDvPath`, but satisfies the type-checker).
- **Files modified:** packages/server/src/index.ts
- **Commit:** 87e3827 (folded into Task 1)

## Authentication Gates

None.

## Self-Check: PASSED

- FOUND: packages/server/src/index.ts
- FOUND: packages/server/tests/routes.filter-materialize-dv.spec.ts
- FOUND: .planning/phases/62-server-materialize-from-dv-view/62-02-SUMMARY.md
- FOUND commit: 87e3827 (feat — POST dv branch + import fix)
- FOUND commit: 17d93f4 (feat — DELETE dv branch)
- FOUND commit: 7f36989 (test — dv supertests)
