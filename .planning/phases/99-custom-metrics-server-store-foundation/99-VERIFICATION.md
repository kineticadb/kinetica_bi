---
phase: 99-custom-metrics-server-store-foundation
verified: 2026-06-30T20:37:30Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 99: Custom Metrics — Server + Store Foundation Verification Report

**Phase Goal:** A per-table custom-metrics config (label + SQL aggregate expression) is persisted server-side with full CRUD, and a client store exposes it — the foundation the Tables editor and metric pickers build on.
**Verified:** 2026-06-30T20:37:30Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Plan 01 — Server)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Custom metric (label + SQL expression + optional format_spec) persisted server-side per table | VERIFIED | DDL in db.ts line 256: `CREATE TABLE IF NOT EXISTS custom_metrics` with `label TEXT NOT NULL`, `expression TEXT NOT NULL`, `format_spec TEXT` nullable |
| 2 | Any authenticated user can list a table's custom metrics (ungated GET) | VERIFIED | index.ts line 2412: `app.get("/api/tables/:tableId/custom-metrics", requireAuth, ...)` — bare requireAuth, no permission gate; spec line 93 asserts analyst 200 |
| 3 | Only datasets:manage can create/update/delete a custom metric (analyst gets 403) | VERIFIED | index.ts lines 2419-2473: POST/PUT/DELETE each use `...requirePermission(PERMISSIONS.DATASETS_MANAGE)`; spec asserts 403 + code "PERMISSION_DENIED" for analyst on all three |
| 4 | Duplicate label on same table rejected with 409 (incl. rename-to-existing) | VERIFIED | UNIQUE(table_id, label) constraint in DDL; route catches `SQLITE_CONSTRAINT` → 409; spec covers both dup-create and rename-to-existing cases |
| 5 | Empty label or empty expression rejected with 400 | VERIFIED | index.ts: `(label ?? "").trim()` / `(expression ?? "").trim()` — empty-trimmed → 400; spec asserts 400 for whitespace label and whitespace expression |
| 6 | format_spec round-trips identically through create -> list | VERIFIED | mapCustomMetric uses `row.format_spec ? JSON.parse(...) : null` null-guard; spec line 397-423 asserts deep-equal round-trip and null stored as null |
| 7 | No new RBAC permission — catalog stays exactly 18 entries | VERIFIED | permissions.ts has exactly 18 entries (lines 19-36); no custom-metric/metrics:manage string; spec line 431 asserts `Object.values(PERMISSIONS).length).toBe(18)` |

### Observable Truths (Plan 02 — Client Store)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 8 | Web client has typed API fns matching server route shape; client store caches per-table metrics | VERIFIED | client.ts lines 1615-1670: CustomMetricRow type + listCustomMetrics/createCustomMetric/updateCustomMetric/deleteCustomMetric; customMetricsStore.ts exports useCustomMetricsStore + selectMetrics |
| 9 | customMetricsStore.reset() wired into DashboardsPage cleanup chain; no editor UI / CSS added | VERIFIED | DashboardsPage.tsx line 39 imports useCustomMetricsStore; line 541 calls `useCustomMetricsStore.getState().reset()` after columnDisplayConfigStore reset (line 537); no CSS or new components found |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/db.ts` | custom_metrics DDL + CRUD/map fns | VERIFIED | DDL at line 256; mapCustomMetric+list/get/create/update/delete at lines 960-1016 |
| `packages/server/src/types.ts` | CustomMetricRow server type | VERIFIED | Line 121: id, table_id, label, expression, format_spec, created_at, updated_at |
| `packages/server/src/index.ts` | GET ungated + POST/PUT/DELETE gated routes | VERIFIED | Lines 2412-2480 |
| `packages/server/tests/routes.custom-metrics.spec.ts` | dual-auth supertests | VERIFIED | 23/23 tests pass in isolation; asserts PERMISSION_DENIED, ungated GET, lifecycle, 400/409/404, no-op 200, format_spec round-trip, perm catalog 18 |
| `packages/web/src/api/client.ts` | CustomMetricRow + list/create/update/delete | VERIFIED | Lines 1615-1670; GET returns json.data; POST/PUT JSON.stringify body; DELETE no body |
| `packages/web/src/store/customMetricsStore.ts` | id-keyed-rows-per-table store + selectMetrics selector | VERIFIED | Exports useCustomMetricsStore (setConfig/upsertMetric/removeMetric/loadConfig/reset) and selectMetrics at line 123 |
| `packages/web/src/store/customMetricsStore.spec.ts` | store unit tests | VERIFIED | 21/21 tests pass; covers Pitfall-5 byte-identical bumps, strict no-op reference equality, state isolation |
| `packages/web/src/components/DashboardsPage.tsx` | reset() wiring | VERIFIED | Import line 39; reset call line 541, immediately after columnDisplayConfigStore.reset() at line 537 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/server/src/index.ts` | `packages/server/src/db.ts` CRUD fns | import + call in route handlers | WIRED | Lines 92-95 import listCustomMetrics/createCustomMetric/updateCustomMetric/deleteCustomMetric; called in route handlers at lines 2414, 2432, 2458, 2476 |
| POST/PUT/DELETE routes | `rbac.requirePermission(PERMISSIONS.DATASETS_MANAGE)` | spread-array middleware | WIRED | Lines 2420, 2446, 2473 each use `...requirePermission(PERMISSIONS.DATASETS_MANAGE)` |
| `packages/web/src/store/customMetricsStore.ts` | `packages/web/src/api/client.ts` listCustomMetrics | loadConfig fetch | WIRED | Line 33 imports listCustomMetrics; line 106 calls it in loadConfig |
| `packages/web/src/components/DashboardsPage.tsx` | customMetricsStore.reset | dashboard-open cleanup useEffect | WIRED | Line 39 import; line 541 `useCustomMetricsStore.getState().reset()` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| METRIC-V119-01 (server-persistence portion) | 99-01, 99-02 | From the Tables area, a user can define a custom metric (server persistence half) | SATISFIED | custom_metrics DDL + CRUD routes + client API client implement the persistence layer; Tables-area authoring UI is Phase 100 |
| METRIC-V119-02 | 99-01, 99-02 | Custom metrics persisted server-side per table and reused across all dashboards | SATISFIED | Server-side SQLite table; GET endpoint returns per-table rows; client store caches per table_id; no dashboard-scoped boundary |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | — |

No TODO/FIXME/placeholder comments, no empty implementations, no console.log-only handlers, no stub returns found in any phase-99 modified files.

Invariant checks:
- `AggregatedWidgetRenderer` untouched: no custom-metrics references found in AggregatedWidgetRenderer; this phase adds config CRUD only, no materialize path.
- No editor UI component created: grep of `packages/web/src/components/` returned no custom-metric references outside DashboardsPage.tsx.
- No new CSS: no custom-metrics-related classes in any `.css` file.
- App.tsx untouched: no customMetricsStore references in App.tsx.
- No SQL parsing/sandbox: expression is stored and returned verbatim; no validation beyond non-empty trim.

### Human Verification Required

None — all behaviors are verifiable programmatically for this foundation phase (CRUD endpoints, store semantics, wiring). Phase 100 (editor UI + picker integration) will require human walk-through.

### Test Gates

| Gate | Result |
|------|--------|
| `cd packages/server && npx tsc --noEmit` | CLEAN |
| `cd packages/server && npx vitest run tests/routes.custom-metrics.spec.ts` | 23/23 PASS (in isolation) |
| Server full suite — routes.custom-metrics.spec.ts in failing set? | NO — not among failures |
| Server full suite — all failing files in TD-V16-TEST-ISOLATION set? | YES — auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.dynamic-view, routes.filter-materialize-dv, routes.filter-materialize, routes.wms all pass in isolation (cross-mode contamination); routes.info-query and routes.management also pass in isolation (pre-existing cross-mode) |
| `cd packages/web && npx tsc --noEmit` | CLEAN |
| `cd packages/web && npx vitest run src/store/customMetricsStore.spec.ts` | 21/21 PASS |
| `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` | 132/132 PASS |
| `cd packages/web && npx vitest run` | 132 test files, 3087 tests PASS, 0 failed (10 pre-existing InfoCardRenderer 401 unhandled-rejection errors do not fail any test) |

### Permission Catalog Parity

Server `packages/server/src/lib/permissions.ts`: exactly 18 keys (DASHBOARDS_VIEW, DASHBOARDS_CREATE, DASHBOARDS_EDIT, DASHBOARDS_DELETE, DASHBOARDS_MANAGE_ACCESS, WIDGETS_CONFIGURE, LAYERS_MANAGE, DYNAMIC_VIEWS_MANAGE, DATA_FILTERS_CONFIGURE, USERS_VIEW, USERS_ASSIGN_ROLES, ROLES_VIEW, ROLES_MANAGE_PERMISSIONS, ROLES_CREATE_CUSTOM, ROLES_DELETE_CUSTOM, AUDIT_VIEW, DATASETS_MANAGE, BRANDING_MANAGE). No custom-metrics-specific string. Spec asserts this at runtime.

### Gaps Summary

No gaps. All must-haves verified across both plans.

---

_Verified: 2026-06-30T20:37:30Z_
_Verifier: Claude (gsd-verifier)_
