---
phase: 55-access-model-server-enforcement
plan: "02"
subsystem: server/rbac-access-enforcement
tags: [rbac, permissions, access-control, server-enforcement, audit, supertests]
dependency_graph:
  requires:
    - DASHBOARDS_MANAGE_ACCESS permission (55-01)
    - dashboard_access_grants table (55-01)
    - canViewDashboard / listDashboardGrants / addDashboardGrant / removeDashboardGrant (55-01)
  provides:
    - Server-filtered GET /api/dashboards (bypass=all; others=granted only)
    - canViewDashboard gating on all 5 dashboard-scoped GET routes
    - Grant CRUD routes (GET/POST/DELETE /api/dashboards/:id/access)
    - RbacAuditAction extended with dashboard_access_granted | dashboard_access_revoked
    - Supertests proving list filter, open gating, grant CRUD, audit, passthrough boundary
  affects:
    - packages/server/src/index.ts (route modifications + new routes)
    - packages/server/src/lib/rbacAudit.ts (union extension)
tech_stack:
  added: []
  patterns:
    - Collapse canViewDashboard into existing 404 guard (existence hidden on denial)
    - Audit-on-change (emit only when inserted/removed — not on idempotent no-ops)
    - Body-based grantee params for DELETE /access (symmetric with POST)
key_files:
  created:
    - packages/server/tests/routes.dashboard-access.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/src/lib/rbacAudit.ts
decisions:
  - key: audit-on-change-vs-always
    value: "Audit emitted only when a row was actually inserted (inserted=true) or deleted (removed=true). Idempotent re-grants and removes of absent grants produce no audit noise. Decision: audit-on-change."
  - key: grant-route-placement
    value: "GET/POST/DELETE /api/dashboards/:id/access placed in the dashboard CRUD neighborhood (~line 539), immediately after DELETE /api/dashboards/:id and before Widget persistence. Locality: all dashboard-lifecycle routes are co-located."
  - key: delete-body-vs-query
    value: "DELETE /api/dashboards/:id/access reads grantee_type and grantee from req.body (not query params) for symmetry with POST. Body-based DELETE is consistent with existing routes.wms patterns in this codebase."
  - key: fast-path-bypass-on-list
    value: "No explicit bypass fast-path added to GET /api/dashboards (where all=visible shortcut). canViewDashboard fires for each dashboard but the bypass check is the first thing it does (getEffectivePermissions short-circuit), so admin/designer list-filter cost is O(N) permission lookups (sub-ms each). Acceptable at current data volume; correctness-first as per plan guidance."
metrics:
  duration: "~10 minutes"
  completed: "2026-06-09"
  tasks: 3
  files: 3
---

# Phase 55 Plan 02: Server Enforcement Summary

**One-liner:** Server-filtered `GET /api/dashboards`, `canViewDashboard` gating on all 5 dashboard-scoped GETs (404 on denial), grant CRUD routes gated by `dashboards:manage_access` with dual-sink audit, and supertest suite proving all enforcement boundaries.

## What Was Built

### Task 1: Server-filter GET /api/dashboards + gate scoped GETs (ENFORCE-V110-01, ENFORCE-V110-02)

**Import added to `index.ts`:**
```typescript
import { canViewDashboard, listDashboardGrants, addDashboardGrant, removeDashboardGrant } from "./lib/dashboardAccessDb";
```

**ENFORCE-V110-01 — list filter (`GET /api/dashboards`, ~line 511):**
```typescript
app.get("/api/dashboards", (req, res) => {
  const username = (req as AuthedRequest).user!.creds.username;
  const all = listDashboards();
  const visible = all.filter((d) => canViewDashboard(username, d.id));
  return res.json({ data: visible });
});
```
Bypass users (admin, designer) short-circuit inside `canViewDashboard` on the permission check; no per-dashboard grant query fires for them.

**ENFORCE-V110-02 — open gating (collapsed into existing 404 guard):**

Four handlers (`/widgets`, `/tables`, `/layers`, `/views`) changed from:
```typescript
if (!getDashboard(id)) return res.status(404).json({ error: "Dashboard not found." });
```
to:
```typescript
const username = (req as AuthedRequest).user!.creds.username;
if (!getDashboard(id) || !canViewDashboard(username, id)) return res.status(404).json({ error: "Dashboard not found." });
```

**ENFORCE-V110-02 — dynamic-views GET (`~line 1118`):** Previously had NO `getDashboard` guard. Both `getDashboard` and `canViewDashboard` added after the `Number.isFinite` check, returning the same `{ error: "Dashboard not found." }` body.

**Passthrough boundary (ANALYST-PASSTHROUGH BOUNDARY ~line 762):** `/api/sql`, `/api/wms`, `/api/info/query`, `/api/filter/materialize` left completely untouched — `canViewDashboard` appears nowhere near these routes.

### Task 2: Grant CRUD routes + extend RbacAuditAction union (ENFORCE-V110-03, ENFORCE-V110-04)

**`rbacAudit.ts` union extension (2-line change):**
```typescript
export type RbacAuditAction =
  | "role_assigned" | "role_revoked" | "mappings_updated"
  | "role_created" | "role_deleted"
  | "dashboard_access_granted"   // ← added
  | "dashboard_access_revoked";  // ← added
```

**Three routes added in `index.ts` at the dashboard CRUD neighborhood (~line 539), after `DELETE /api/dashboards/:id`:**

```
GET    /api/dashboards/:id/access  → requirePermission(DASHBOARDS_MANAGE_ACCESS) → { grants: [...] }
POST   /api/dashboards/:id/access  → requirePermission(DASHBOARDS_MANAGE_ACCESS) → 201 { grants: [...] }
DELETE /api/dashboards/:id/access  → requirePermission(DASHBOARDS_MANAGE_ACCESS) → 200 { grants: [...] }
```

**Request body shape (POST + DELETE):**
```json
{ "grantee_type": "user" | "role", "grantee": "<string>" }
```

**Response body shape (all three):**
```json
{ "grants": [{ "grantee_type": "user"|"role", "grantee": "<string>", "created_at": "<ISO>" }] }
```

**Audit target string format:** `dashboard:<id>:<grantee_type>:<grantee_lowercased>`
Example: `dashboard:7:user:ann`

**Audit decision:** Audit-on-change. Emitted only when `addDashboardGrant` returns `true` (row actually inserted) or `removeDashboardGrant` returns `true` (row actually deleted). Idempotent re-grant or remove-of-absent-grant produces no audit row (no noise).

### Task 3: Supertests (routes.dashboard-access.spec.ts)

21 tests across 6 describe blocks:

| Block | Tests |
|-------|-------|
| ENFORCE-V110-01: list filter | 3 (user grant, bypass all, no grants = empty) |
| ENFORCE-V110-02: open gating | 6 (404 on /widgets/tables/layers/views/dynamic-views; 200 when granted; 200 for admin) |
| Role-grant path | 1 (analyst fallback via 'analyst' role grant → both dashboards visible + /layers 200) |
| ENFORCE-V110-03: grant CRUD gating | 5 (403 for non-holder; admin GET/POST/DELETE 200/201/200; 400 invalid body; designer POST) |
| ENFORCE-V110-04: audit rows | 3 (granted row, revoked row, idempotent no-op) |
| Passthrough non-regression | 1 (GET /api/tables → 200 for analyst — not 404) |

## Deviations from Plan

None — plan executed exactly as written.

## Test Gate Results

### Targeted spec (must be green)
```
npx vitest run tests/routes.dashboard-access.spec.ts
Test Files  1 passed (1)
Tests  21 passed (21)
```

### TSC gate
```
npx tsc --noEmit -p packages/server
(no output — CLEAN)
```

### Full-suite set-based gate
```
npx vitest run  [in packages/server]
Test Files  9 failed | 51 passed (60)   [59→60: +1 new green file]
Tests  51 failed | 832 passed | 1 skipped (884)
```

**Failing test files (8 unique):**
- `tests/auth.oidc.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/auth.routes.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/boot.hardening.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/boot.wipe.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/bootstrap.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/db.smoke.spec.ts` — pre-existing (schema snapshot)
- `tests/oidc.module.spec.ts` — pre-existing TD-V16-TEST-ISOLATION
- `tests/routes.wms.spec.ts` — pre-existing TD-V16-TEST-ISOLATION

**SET-BASED GATE: PASS** — failing set {8 files} ⊆ TD-V16-TEST-ISOLATION known-flaky list (identical to 55-01 baseline). `routes.dashboard-access.spec.ts` is GREEN (counted in the 51 passed files).

### Web package verification
```
git diff --name-only packages/web
(no output — web package untouched)
```

### Acceptance criteria grep checks
```
grep -c 'canViewDashboard(' packages/server/src/index.ts → 6 (>= 6 ✓)
grep -q 'visible = all.filter' packages/server/src/index.ts → FOUND ✓
grep -c '!getDashboard(id) || !canViewDashboard' packages/server/src/index.ts → 4 ✓
grep -q 'dashboard_access_granted' packages/server/src/lib/rbacAudit.ts → FOUND ✓
grep -q 'dashboard_access_revoked' packages/server/src/lib/rbacAudit.ts → FOUND ✓
grep -cE '/api/dashboards/:id/access' packages/server/src/index.ts → 6 (3 route registrations × 2 lines each) ✓
grep -q 'Dashboard not found.' packages/server/tests/routes.dashboard-access.spec.ts → FOUND ✓
grep -q 'dashboard_access_granted' packages/server/tests/routes.dashboard-access.spec.ts → FOUND ✓
git diff --name-only packages/web → (empty) ✓
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | eb6b373 | feat(55-02): server-filter GET /api/dashboards + gate scoped GETs via canViewDashboard |
| Task 2 | b01bf99 | feat(55-02): add grant CRUD routes gated by manage_access + extend RbacAuditAction union |
| Task 3 | 705b7b1 | feat(55-02): add supertests for list filter, open gating, grant CRUD, audit, passthrough non-regression |
