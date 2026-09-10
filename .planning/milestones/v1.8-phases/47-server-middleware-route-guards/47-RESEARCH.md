# Phase 47: Server Middleware + Route Guards — Research

**Researched:** 2026-06-05
**Domain:** Express middleware, SQLite RBAC, supertest migration, OBS-01 audit log extension
**Confidence:** HIGH — all findings from direct live-code reads; no training-data assumptions

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Datasets permission (catalog gap closed)**
- NEW 16th permission `datasets:manage` — gates dataset/table registration: `POST/PATCH/DELETE /api/tables`. Default mapping: designer + admin. Added to `PERMISSIONS` in `lib/permissions.ts` and to `DEFAULT_ROLE_MAPPINGS` for designer + admin. Phase 46 `rbac_seed_history` mechanism seeds it exactly once on existing deployments.
- Kinetica schema discovery stays auth-only passthrough: `GET /api/kinetica/schemas`, `GET /api/kinetica/schemas/:schema/tables`, `GET /api/kinetica/schemas/:schema/tables/:table/columns`
- `GET /api/tables` and `GET /api/tables/:id` stay auth-only; only mutations gate.

**Users-list source (management API)**
- `GET /api/users` returns the union of distinct usernames from a new `known_users` table (upserted on every successful login) AND usernames in `user_roles`.
- NEW `known_users` table: `(username TEXT PRIMARY KEY, first_seen, last_seen)`, upserted on every successful login (both password and OIDC paths). Usernames lowercased. CREATE TABLE IF NOT EXISTS in SCHEMA_DDL.

**403 response & denial logging**
- 403 body includes the missing permission: `{ error: <human message>, code: "PERMISSION_DENIED", permission: "<perm string>" }`
- Permission denials are audit-logged via the existing OBS-01 JSON logger: username, route, op, missing permission, outcome=denied.

**Edge-route classifications (locked)**
- `POST /api/sql` — PASSTHROUGH (auth-only). Core chart-data path; data access enforced by Kinetica per-user credentials.
- `POST /api/views/:id/materialize` — GATED with `dashboards:edit`. Planner/executor MUST verify no viewer-path code calls this route before locking.
- Full passthrough list (requireAuth ONLY): `POST/DELETE /api/filter/materialize`, `POST /api/info/query`, `POST /api/top-values`, `POST /api/column-stats`, `POST /api/quantile`, `POST /api/dynamic-view/materialize`, `POST /api/dynamic-view/:id/drop`, `POST /api/dynamic-view/preview` (verify: preview is used by the dv modal — designer surface — but the route itself reads data only; planner's call, document either way), `GET /api/wms`, `GET /api/wms/capabilities`, `POST /api/sql`, `GET /api/kinetica/*`, `GET /api/tables`, `GET /api/tables/:id`, dashboard/widget/layer/dynamic-view GETs.

**Management API routes (this phase, UI in 49/50)**
- `GET /api/users` — gated `users:view`
- `POST /api/users/:username/roles` + `DELETE /api/users/:username/roles/:roleName` — gated `users:assign_roles`
- `GET /api/roles` (+ mappings) — gated `roles:view`
- `POST /api/roles` — gated `roles:create_custom`; `PUT/PATCH /api/roles/:id/permissions` — gated `roles:manage_permissions`; `DELETE /api/roles/:id` — gated `roles:delete_custom`
- Exact REST shapes are Claude's discretion; SAFE-V18-01/02 guards are Phases 49/50 scope.

### Claude's Discretion
- requirePermission implementation details (factory signature, composition order specifics)
- Exact REST shapes/payloads for management routes
- createAdminSession() helper design and how the existing 49 spec files get migrated (bulk find-replace vs helper re-export)
- Whether dynamic-view preview gates or passes through (document choice in the boundary comment)
- Audit log field names for denials (consistent with existing OBS-01 shape)

### Deferred Ideas (OUT OF SCOPE)
- Last-admin protection (SAFE-V18-01) — Phase 49 (with assign/revoke UI) unless planner pulls forward
- Escalation guards (SAFE-V18-02) — Phase 50
- Role-change audit entries (AUDIT-V18-01) — Phase 50
- Embeddable/public dashboards via embed identity — backlog
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GUARD-V18-01 | `requirePermission(perm)` factory composes after `requireAuth`; 403 with typed code on denial | Factory design confirmed: returns `[requireAuth, rbacCheck]`; REAUTH_REQUIRED precedent in `errorMiddleware`; `getEffectivePermissions` ready in `rbacDb.ts` |
| GUARD-V18-02 | All config-mutation routes permission-gated: dashboards CRUD, widgets CRUD + config PATCH, tables association, views CRUD, dynamic-views CRUD, dashboard-layers CRUD + reorder | Full route inventory below; 22 mutation routes identified with exact permission assignments |
| GUARD-V18-03 | Analyst interaction routes remain `requireAuth` ONLY; passthrough boundary documented in code | 13 passthrough routes confirmed; `POST /api/views/:id/materialize` viewer-path verification complete (no viewer path calls it) |
| GUARD-V18-04 | RBAC management routes gated on correct permissions | 7 new routes specified with exact permission strings from `PERMISSIONS` catalog |
| GUARD-V18-05 | Existing test suite migrated via `createAdminSession()` in same phase | 21 spec files use `createSession`; common idiom identified; 13 currently-failing specs identified |
</phase_requirements>

---

## Summary

Phase 47 is a surgical wiring phase. All foundation primitives already exist from Phase 46: `getEffectivePermissions` in `rbacDb.ts`, the `PERMISSIONS` catalog in `lib/permissions.ts`, the `rbac_seed_history` mechanism in `rbacSeed.ts`, and the seeded role rows. The planner needs to orchestrate three parallel work streams: (1) write `rbac.ts` with the `requirePermission` factory, (2) modify `index.ts` to wire guards on ~22 mutation routes, add 7 management routes, add the passthrough comment block, and extend `POST /api/auth/login` + OIDC callback with the `known_users` upsert, and (3) add `createAdminSession()` to `tests/helpers/db.ts` and migrate all 21 spec files that call `createSession`.

The test-suite migration (stream 3) is the most mechanical but highest-risk work — it must land in the same wave as the guards or the test baseline collapses. The 13 spec files currently failing (TD-V16-TEST-ISOLATION, all OIDC-discovery-timeout related) must not get worse; of those, 8 use `createSession` and will need migration. The 8 other currently-passing files that use `createSession` and hit mutation routes must also be migrated.

**Primary recommendation:** Plan as two waves minimum — Wave 0: `createAdminSession()` helper + spec migration (zero functional change, baseline preserved); Wave 1: `requirePermission` factory + route guards + management routes + passthrough comment block + `known_users` upsert.

---

## Standard Stack

### Core (all Phase 46 — already present, no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^12.8.0 | Synchronous SQLite reads in `requirePermission` | Already wired; v1.8 locked decision: no new npm deps |
| `jsonwebtoken` | (existing) | JWT signing in `createAdminSession` helper | Already in tests/auth pattern |
| `express` | (existing) | `RequestHandler[]` return from factory | Existing |
| `vitest` + `supertest` | (existing) | Spec validation | Existing |

**Installation:** No new packages. Everything builds on Phase 46 primitives.

**New files this phase:**
- `packages/server/src/rbac.ts` — `requirePermission` factory (new)
- `packages/server/tests/helpers/db.ts` — add `createAdminSession()` to existing file

**Modified files:**
- `packages/server/src/index.ts` — guards, management routes, passthrough comment, `known_users` upsert
- `packages/server/src/db.ts` — `known_users` table in `SCHEMA_DDL`
- `packages/server/src/lib/permissions.ts` — add `DATASETS_MANAGE` to `PERMISSIONS` and `DEFAULT_ROLE_MAPPINGS`
- All 21 `tests/*.spec.ts` files using `createSession`

---

## Architecture Patterns

### requirePermission Factory (new file: `packages/server/src/rbac.ts`)

```typescript
// Source: ARCHITECTURE.md Q1 + STATE.md v1.8 locked decisions
import { requireAuth, type AuthedRequest } from "./auth";
import { getEffectivePermissions } from "./lib/rbacDb";
import type { NextFunction, Response, RequestHandler } from "express";
import type { Permission } from "./lib/permissions";

export const requirePermission = (permission: Permission): RequestHandler[] => [
  requireAuth,
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    const username = req.user!.creds.username;
    const perms = getEffectivePermissions(username);
    if (!perms.has(permission)) {
      // OBS-01 denial audit (CONTEXT.md § 403 response & denial logging)
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "permission_denied",
        username,
        permission,
        route: req.path,
        method: req.method,
        outcome: "denied",
      }));
      return res.status(403).json({
        error: `Permission denied: ${permission} is required`,
        code: "PERMISSION_DENIED",
        permission,
      });
    }
    return next();
  },
];
```

Key design points:
- Returns `RequestHandler[]` (spread into route args) — same pattern as the existing `requireConfig` which is a single `RequestHandler` but used identically: `app.post("/route", requireConfig, handler)` becomes `app.post("/route", ...requirePermission(PERMISSIONS.X), handler)`
- `requireAuth` is the first element — ensures `req.user` is populated before rbacCheck runs (PITFALLS P14)
- Calls `getEffectivePermissions(username)` with no conn arg — uses the module-level `db` singleton, matching the production pattern
- 403 body includes `permission` field (CONTEXT.md locked decision)
- OBS-01 JSON denial log mirrors existing `kinetica.ts` audit shape (see OBS-01 shape section below)

### Per-Route Middleware Chaining Precedent

The existing precedent for per-route middleware is `requireConfig`:

```typescript
// Existing pattern (index.ts line 254-259):
const requireConfig = (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.KINETICA_URL) {
    return res.status(500).json({ error: "Missing KINETICA_URL environment variable." });
  }
  return next();
};

// Used as:
app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => { ... }));

// For requirePermission (spreads since it returns an array):
app.post("/api/dashboards", ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), (req, res) => { ... });

// When BOTH requireConfig AND requirePermission needed:
app.post("/api/views/:id/materialize", requireConfig, ...requirePermission(PERMISSIONS.DASHBOARDS_EDIT), asyncHandler(...));
```

Note: The global `app.use("/api", requireAuth)` at line 477 remains UNCHANGED. `requirePermission` embeds its own `requireAuth` call, which is idempotent — calling `requireAuth` twice is safe since it calls `loadSessionForRequest` and `next()` on success.

### createAdminSession() Helper Design

The helper lands in `packages/server/tests/helpers/db.ts`. It must:
1. Create a session row via `createSession` (existing pattern)
2. Grant the admin role via `user_roles` INSERT — or use APP_ADMIN_USERNAME so the bootstrap short-circuit fires without any `user_roles` row

**Recommended approach — use bootstrap admin username:**

```typescript
// packages/server/tests/helpers/db.ts (add to existing file)
import jwt from "jsonwebtoken";
import { createSession } from "../../src/sessionStore";
import { db } from "../../src/db";

// Returns { cookie } for use in supertest .set("Cookie", cookie) calls.
// Uses APP_ADMIN_USERNAME (default "admin") so getEffectivePermissions short-circuits
// to ALL_PERMISSIONS — no user_roles row needed.
export const createAdminSession = (opts?: { kineticaUrl?: string }) => {
  const kineticaUrl = opts?.kineticaUrl ?? process.env.KINETICA_URL!;
  const username = process.env.APP_ADMIN_USERNAME || "admin";
  const sid = createSession({ username, secret: "admin-test-secret", kineticaUrl });
  const token = jwt.sign({ sub: username, sid, v: 1 }, process.env.AUTH_SECRET!, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};
```

This approach:
- Zero `user_roles` row required — `isBootstrapAdmin("admin")` returns `true` → `getEffectivePermissions` returns `ALL_PERMISSIONS`
- Matches the exact JWT construction already used in every spec file's existing helper (see routes.materialize.spec.ts pattern above)
- Replaces the per-file `createSession` + jwt.sign 2-liner with a one-liner import

**Migration pattern per spec file (21 files):**

```typescript
// Before (existing in every route spec):
import { createSession } from "../src/sessionStore";
const sid = createSession({ username: "testuser", secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
cookie = `kbi_session=${token}`;

// After:
import { createAdminSession } from "./helpers/db";
const { cookie } = createAdminSession();
```

Total `createSession` call sites to migrate (excluding `sessionStore.*.spec.ts` and `boot.wipe.spec.ts` which test the session store directly and must NOT be changed): **39 call sites across 21 spec files**.

### known_users Upsert Integration Points

**Location 1: Password login** — `packages/server/src/index.ts` line 297 (POST /api/auth/login), after `createSession` succeeds:

```typescript
// After: const sid = createSession({ username, secret: password, kineticaUrl });
db.prepare(
  `INSERT INTO known_users (username, first_seen, last_seen)
   VALUES (lower(?), datetime('now'), datetime('now'))
   ON CONFLICT(username) DO UPDATE SET last_seen = datetime('now')`
).run(username);
```

**Location 2: OIDC callback** — `packages/server/src/index.ts` line 465-471 (POST /api/auth/oidc/callback), after `createSession` + before `issueSessionCookie`:

```typescript
// After: const sid = createSession({ username, secret: accessToken, kineticaUrl, credentialType: "oidc", idToken });
db.prepare(
  `INSERT INTO known_users (username, first_seen, last_seen)
   VALUES (lower(?), datetime('now'), datetime('now'))
   ON CONFLICT(username) DO UPDATE SET last_seen = datetime('now')`
).run(username);
```

`known_users` schema (add to `SCHEMA_DDL` in `db.ts`):
```sql
CREATE TABLE IF NOT EXISTS known_users (
  username TEXT PRIMARY KEY,   -- LOWERCASED (Phase 46 convention)
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No `seedRbac` changes needed — `known_users` is populated at runtime, not at boot.

### datasets:manage Addition

Three changes to `packages/server/src/lib/permissions.ts`:

1. Add to `PERMISSIONS` object:
```typescript
DATASETS_MANAGE: "datasets:manage",
```

2. Add to `DEFAULT_ROLE_MAPPINGS.designer`:
```typescript
PERMISSIONS.DATASETS_MANAGE,
```

3. Add to `DEFAULT_ROLE_MAPPINGS.admin` (already gets `ALL_PERMISSIONS` spread, so auto-included).

The `rbac_seed_history` mechanism seeds this exactly once on first boot after the code lands — no manual migration needed (this is the first live exercise of the upgrade path per CONTEXT.md specifics).

---

## Route Inventory — Complete Verdict Table

All routes in `packages/server/src/index.ts` with line numbers, current middleware chains, and Phase 47 verdict.

### AUTH routes (lines 278–474) — PUBLIC or already covered

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/health` | 273 | none | PUBLIC — no change |
| `POST /api/auth/login` | 278 | none | PUBLIC — add `known_users` upsert |
| `POST /api/auth/logout` | 305 | none | PUBLIC — no change |
| `GET /api/auth/me` | 315 | loadSessionForRequest (not requireAuth) | PUBLIC-ish — no guard change |
| `GET /api/auth/config` | 332 | none | PUBLIC — no change |
| `GET /api/auth/oidc/start` | 339 | none | PUBLIC — no change |
| `GET /api/auth/oidc/callback` | 359 | none | PUBLIC — add `known_users` upsert |

**Global gate:** `app.use("/api", requireAuth)` at line 477 covers ALL routes below this point.

### DASHBOARDS (lines 480–503) — GUARD mutations

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/dashboards` | 480 | requireAuth (global) | PASSTHROUGH — analyst reads |
| `POST /api/dashboards` | 484 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_CREATE` |
| `PATCH /api/dashboards/:id` | 491 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |
| `DELETE /api/dashboards/:id` | 498 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_DELETE` |

### WIDGETS (lines 506–540)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/dashboards/:id/widgets` | 506 | requireAuth | PASSTHROUGH |
| `POST /api/dashboards/:id/widgets` | 512 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |
| `PATCH /api/widgets/:id` | 528 | requireAuth | GATE: `PERMISSIONS.WIDGETS_CONFIGURE` |
| `DELETE /api/widgets/:id` | 535 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |

Note: `PATCH /api/widgets/:id` is the config-save path — gated on `WIDGETS_CONFIGURE` per GUARD-V18-02 ("widgets CRUD + config PATCH"). `POST` (create) and `DELETE` (destroy) are dashboard shape mutations → `DASHBOARDS_EDIT`.

### DASHBOARD-TABLE ASSOCIATIONS (lines 543–565)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/dashboards/:id/tables` | 543 | requireAuth | PASSTHROUGH |
| `POST /api/dashboards/:id/tables` | 549 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |
| `DELETE /api/dashboards/:dashboardId/tables/:tableId` | 559 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |

### DASHBOARD LAYERS (lines 572–649)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/dashboards/:id/layers` | 572 | requireAuth | PASSTHROUGH |
| `POST /api/dashboards/:id/layers` | 578 | requireAuth | GATE: `PERMISSIONS.LAYERS_MANAGE` |
| `PATCH /api/dashboards/:id/layers/reorder` | 595 | requireAuth | GATE: `PERMISSIONS.LAYERS_MANAGE` |
| `PATCH /api/dashboards/:id/layers/:layerId` | 611 | requireAuth | GATE: `PERMISSIONS.LAYERS_MANAGE` |
| `DELETE /api/dashboards/:id/layers/:layerId` | 644 | requireAuth | GATE: `PERMISSIONS.LAYERS_MANAGE` |

### DASHBOARD-TABLE VIEWS (lines 652–731)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/dashboards/:id/views` | 652 | requireAuth | PASSTHROUGH |
| `POST /api/dashboards/:id/views` | 658 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |
| `PATCH /api/views/:id` | 674 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |
| `DELETE /api/views/:id` | 683 | requireAuth | GATE: `PERMISSIONS.DASHBOARDS_EDIT` |
| `POST /api/views/:id/materialize` | 696 | requireAuth + requireConfig | GATE: `PERMISSIONS.DASHBOARDS_EDIT` — see viewer-path verification below |

### FILTER MATERIALIZE (lines 748–871) — ANALYST PASSTHROUGH

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `POST /api/filter/materialize` | 748 | requireAuth + requireConfig | PASSTHROUGH — core analyst path |
| `DELETE /api/filter/materialize` | 849 | requireAuth + requireConfig | PASSTHROUGH — analyst clears filter |

### QUANTILE / TOP-VALUES / COLUMN-STATS (lines 884–1015) — PASSTHROUGH (confirmed per CONTEXT.md)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `POST /api/quantile` | 884 | requireAuth + requireConfig | PASSTHROUGH — CONTEXT.md locked: auth-only passthrough |
| `POST /api/top-values` | 938 | requireAuth + requireConfig | PASSTHROUGH — Data Filter widget, analyst-reachable |
| `POST /api/column-stats` | 988 | requireAuth + requireConfig | PASSTHROUGH — chart config panel, analyst-reachable |

Note: ARCHITECTURE.md originally proposed gating `/api/quantile` with `layer:write` or `dynamic_view:write`, but CONTEXT.md locks the full passthrough list including `POST /api/quantile`. CONTEXT.md takes precedence — leave as requireAuth only.

### DYNAMIC VIEWS (lines 1034–1560)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/dashboards/:dashboardId/dynamic-views` | 1034 | requireAuth + requireConfig | PASSTHROUGH |
| `POST /api/dashboards/:dashboardId/dynamic-views` | 1047 | requireAuth + requireConfig | GATE: `PERMISSIONS.DYNAMIC_VIEWS_MANAGE` |
| `PUT /api/dynamic-views/:id` | 1124 | requireAuth + requireConfig | GATE: `PERMISSIONS.DYNAMIC_VIEWS_MANAGE` |
| `POST /api/dynamic-view/preview` | 1241 | requireAuth + requireConfig | PASSTHROUGH — CONTEXT.md locked (reads data only; designer surface but no write) |
| `POST /api/dynamic-view/materialize` | 1351 | requireAuth + requireConfig | PASSTHROUGH — analyst triggers on filter change |
| `POST /api/dynamic-view/:id/drop` | 1502 | requireAuth + requireConfig | PASSTHROUGH — analyst lifecycle cleanup (PITFALLS P13) |
| `DELETE /api/dynamic-view/:id` | 1531 | requireAuth + requireConfig | GATE: `PERMISSIONS.DYNAMIC_VIEWS_MANAGE` |

### INFO QUERY (line 1600)

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `POST /api/info/query` | 1600 | requireAuth + requireConfig | PASSTHROUGH |

### TABLES (lines 1799–1831) — GATE mutations with datasets:manage

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/tables` | 1800 | requireAuth | PASSTHROUGH |
| `GET /api/tables/:id` | 1804 | requireAuth | PASSTHROUGH |
| `POST /api/tables` | 1811 | requireAuth | GATE: `PERMISSIONS.DATASETS_MANAGE` |
| `PATCH /api/tables/:id` | 1819 | requireAuth | GATE: `PERMISSIONS.DATASETS_MANAGE` |
| `DELETE /api/tables/:id` | 1826 | requireAuth | GATE: `PERMISSIONS.DATASETS_MANAGE` |

### KINETICA DISCOVERY (lines 1835–1890) — all PASSTHROUGH per CONTEXT.md locked decision

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/kinetica/schemas` | 1835 | requireAuth + requireConfig | PASSTHROUGH |
| `GET /api/kinetica/schemas/:schema/tables` | 1845 | requireAuth + requireConfig | PASSTHROUGH |
| `GET /api/kinetica/schemas/:schema/tables/:table/columns` | 1856 | requireAuth + requireConfig | PASSTHROUGH |

### WMS (lines 1894–1927) — PASSTHROUGH

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `GET /api/wms` | 1894 | requireAuth + requireConfig | PASSTHROUGH |
| `GET /api/wms/capabilities` | 1911 | requireAuth + requireConfig | PASSTHROUGH |

### SQL PROXY (line 1931) — PASSTHROUGH

| Route | Line | Current Chain | Verdict |
|-------|------|--------------|---------|
| `POST /api/sql` | 1931 | requireAuth + requireConfig | PASSTHROUGH — CONTEXT.md locked |

### NEW MANAGEMENT ROUTES (Phase 47 additions — append before `errorMiddleware`)

| Route | Guard | Rationale |
|-------|-------|-----------|
| `GET /api/users` | `PERMISSIONS.USERS_VIEW` | List known+assigned users |
| `POST /api/users/:username/roles` | `PERMISSIONS.USERS_ASSIGN_ROLES` | Assign role |
| `DELETE /api/users/:username/roles/:roleName` | `PERMISSIONS.USERS_ASSIGN_ROLES` | Revoke role |
| `GET /api/roles` | `PERMISSIONS.ROLES_VIEW` | List roles + mappings |
| `POST /api/roles` | `PERMISSIONS.ROLES_CREATE_CUSTOM` | Create custom role |
| `PUT /api/roles/:id/permissions` | `PERMISSIONS.ROLES_MANAGE_PERMISSIONS` | Edit role permission set |
| `DELETE /api/roles/:id` | `PERMISSIONS.ROLES_DELETE_CUSTOM` | Delete custom role |

`GET /api/users` implementation: `SELECT username FROM known_users UNION SELECT DISTINCT username FROM user_roles ORDER BY username`

---

## Viewer-Path Verification: POST /api/views/:id/materialize

**Finding:** CONFIRMED SAFE — no viewer path calls `POST /api/views/:id/materialize`.

Evidence from live code:
- `packages/web/src/api/client.ts` line 427: `materializeView` function defined
- **Zero call sites** in the entire `packages/web/src/` tree outside `client.ts` itself — `grep -rn "materializeView" packages/web/src/ | grep -v "spec"` returns only the definition line
- The function exists in `client.ts` as a vestigial export from earlier phases (likely the persisted-view management flow). No component imports or calls it during normal dashboard viewing.
- `POST /api/dynamic-view/preview` IS called from `DynamicViewsModal.tsx` lines 369 and 447 — this is the designer-surface DV creation modal, not a viewer path.

**Conclusion:** Gate `POST /api/views/:id/materialize` with `PERMISSIONS.DASHBOARDS_EDIT` as locked in CONTEXT.md.

---

## Dynamic-View Preview Verdict

**Decision recommendation (Claude's discretion):** PASSTHROUGH (requireAuth only)

Reasoning: CONTEXT.md lists `POST /api/dynamic-view/preview` explicitly in the passthrough list with the note "verify: preview is used by the dv modal — designer surface — but the route itself reads data only; planner's call, document either way." The route performs a read-only Kinetica SELECT — it does not create any SQLite row or persistent Kinetica resource. Gating it would block designers who have `DYNAMIC_VIEWS_MANAGE` but are collaborating from a session that falls back to analyst (edge case). The comment block in `index.ts` should explicitly document: "POST /api/dynamic-view/preview — PASSTHROUGH (auth-only): reads data only; the DynamicViewsModal is a designer surface but this endpoint itself creates nothing; gating it adds no security value."

---

## OBS-01 emitAudit Shape (for denial log parity)

The existing OBS-01 audit format (from `packages/server/src/kinetica.ts` lines 83–106):

```typescript
// Existing shape — emitted via console.log(JSON.stringify({ ... }))
{
  ts: string,           // new Date().toISOString()
  request_id: string,   // per-request uuid
  username: string,
  route: string,        // e.g. "POST /api/sql"
  op: KineticaOp,       // "SQL" | "MATERIALIZE" | "DISCOVERY" | etc.
  outcome: string,      // "success" | "auth-error" | "permission-error" | "upstream-error"
  status: number,
  duration_ms: number,
  auth_mode: "password" | "oidc",
}
```

The denial log entry in `requirePermission` should mirror this shape as closely as practical — using `console.log` (same channel), JSON.stringify, and the same field names where applicable. It does NOT have `request_id` (no req-scoped uuid in the middleware) or `duration_ms` (no Kinetica call). Recommended denial shape:

```typescript
console.log(JSON.stringify({
  ts: new Date().toISOString(),
  level: "warn",
  event: "permission_denied",
  username,          // string
  route: req.path,   // e.g. "/api/dashboards"
  method: req.method,
  permission,        // the missing permission string
  outcome: "denied",
}));
```

Note: The existing boot-log entries (OIDC warning at lines 200–211, auth_mode_change_wipe at line 157) use `level: "warn"` and `event:` fields — the denial log follows the same boot-log style rather than the kinetica.ts audit log style, since denials are app-layer events not Kinetica-call events.

---

## Test-Suite Migration Survey

### Current baseline (confirmed from test run)

- **Total tests:** 741 (622 passing, 118 failing, 1 skipped)
- **Currently failing:** 118 tests across 13 spec files — ALL due to OIDC `Issuer.discover` timeout (TD-V16-TEST-ISOLATION, pre-existing, unrelated to RBAC)
- **Pre-v1.8 passing baseline:** 622 (ROADMAP SC4 requires "no worse than 582/689" — current baseline is higher; the 622 target must be maintained)

### Spec files requiring createAdminSession migration

**21 spec files call `createSession`** — 39 total call sites. Files:

```
auth.cookie.spec.ts          — tests auth cookie behavior; createSession used for cookie validation
auth.requireAuth.spec.ts     — tests requireAuth middleware; needs session but tests 401 paths too
auth.oidc.spec.ts            — CURRENTLY FAILING (OIDC timeout); has createSession; needs migration anyway
auth.routes.spec.ts          — CURRENTLY FAILING; has createSession
boot.wipe.spec.ts            — CURRENTLY FAILING; tests session wipe on auth-mode change; DO NOT migrate
                               (createSession here is testing session deletion behavior, not route access)
errorMiddleware.spec.ts      — CURRENTLY FAILING; has createSession
kinetica.creds.routes.spec.ts— CURRENTLY FAILING; has createSession for route-credential tests
layers.spec.ts               — PASSING; hits gated POST /api/dashboards/:id/layers → MUST migrate
routes.dashboard-layers-patch.spec.ts — PASSING; hits gated PATCH → MUST migrate
routes.discovery.spec.ts     — CURRENTLY FAILING; has createSession
routes.dynamic-view-crud.spec.ts — PASSING; hits gated POST/PUT → MUST migrate
routes.dynamic-view-drop.spec.ts — PASSING; hits POST /api/dynamic-view/:id/drop (passthrough) → migrate for consistency
routes.dynamic-view.spec.ts  — PASSING; hits gated routes → MUST migrate
routes.filter-materialize.spec.ts — PASSING; hits passthrough → migrate for consistency
routes.filter-materialize-spatial.spec.ts — PASSING; hits passthrough → migrate for consistency
routes.info-query.spec.ts    — PASSING; hits passthrough → migrate for consistency
routes.materialize.spec.ts   — CURRENTLY FAILING; has createSession
routes.quantile.spec.ts      — PASSING; hits passthrough → migrate for consistency
routes.sql.spec.ts           — CURRENTLY FAILING; has createSession
routes.wms.cache-control.spec.ts — PASSING; hits passthrough → migrate for consistency
routes.wms.capabilities.spec.ts — PASSING; migrate for consistency
routes.wms.spec.ts           — CURRENTLY FAILING; has createSession
sessionStore.crud.spec.ts    — tests sessionStore internals directly; DO NOT migrate
```

**Critical distinction:** `boot.wipe.spec.ts` and `sessionStore.crud.spec.ts` use `createSession` to test the session layer itself — these must NOT be migrated to `createAdminSession`. All others should be.

**Files that hit gated mutation routes and WILL break without migration:**
- `layers.spec.ts` — `POST /api/dashboards`, `POST /api/dashboards/:id/layers`, etc.
- `routes.dashboard-layers-patch.spec.ts` — `PATCH /api/dashboards/:id/layers/:layerId`
- `routes.dynamic-view-crud.spec.ts` — `POST /api/dashboards/:dashboardId/dynamic-views`, `PUT /api/dynamic-views/:id`, `DELETE /api/dynamic-view/:id`
- `routes.dynamic-view.spec.ts` — `POST /api/dynamic-view/materialize` (passthrough, but also creates resources via gated CRUD)
- `routes.materialize.spec.ts` — `POST /api/views/:id/materialize` (now gated)
- All other route specs that call `POST /api/tables`, `POST /api/dashboards`, etc.

### Interaction with TD-V16-TEST-ISOLATION failing files

Of the 13 currently-failing spec files, **8 use `createSession`** and need migration:
`auth.oidc.spec.ts`, `auth.routes.spec.ts`, `errorMiddleware.spec.ts`, `kinetica.creds.routes.spec.ts`, `routes.discovery.spec.ts`, `routes.materialize.spec.ts`, `routes.sql.spec.ts`, `routes.wms.spec.ts`

These files will remain failing (OIDC timeout) after the migration — that is expected and acceptable. The migration must not introduce any NEW failures in them beyond the pre-existing timeout failures.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Permission resolution | Custom role-query logic in `requirePermission` body | `getEffectivePermissions(username)` from `rbacDb.ts` | Already tested, handles bootstrap short-circuit + analyst fallback + union semantics |
| Permission string literals | Ad-hoc strings in route handlers | `PERMISSIONS.*` from `lib/permissions.ts` | TypeScript catches typos; prevents server/client drift (PITFALLS P3) |
| Session creation in tests | New jwt.sign inline pattern | `createAdminSession()` from `tests/helpers/db.ts` | One source of truth; all 39 call sites become 1-liners |
| known_users upsert dedup | SELECT then INSERT | `INSERT INTO known_users ... ON CONFLICT(username) DO UPDATE SET last_seen` | SQLite UPSERT is atomic and idempotent |
| Management route data | Raw SQL in handler bodies | `db.prepare(...)` inline statements matching existing db.ts style | No new abstraction layer needed for 7 CRUD routes at this scale |

---

## Common Pitfalls

### Pitfall 1: Forgetting `...` spread on requirePermission
**What goes wrong:** `app.post("/api/dashboards", requirePermission("dashboards:create"), handler)` — TypeScript accepts a `RequestHandler[]` as a second arg but Express ignores array args; the guard never fires.
**How to avoid:** Always spread: `app.post("/api/dashboards", ...requirePermission(PERMISSIONS.DASHBOARDS_CREATE), handler)`.
**Warning signs:** Route tests pass when they should fail with 403.

### Pitfall 2: Order matters — requireConfig before requirePermission
**What goes wrong:** Placing `requirePermission` before `requireConfig` means an admin without `KINETICA_URL` gets a 403 instead of a 500.
**How to avoid:** Keep existing `requireConfig` first: `app.post("/api/views/:id/materialize", requireConfig, ...requirePermission(...), asyncHandler(...))`.

### Pitfall 3: boot.wipe.spec.ts must NOT be migrated
**What goes wrong:** `boot.wipe.spec.ts` uses `createSession` to test that sessions with the wrong `credential_type` are deleted on boot. Migrating it to `createAdminSession` would create admin sessions which are immune to credential-type filtering and break the test semantics.
**How to avoid:** Only migrate spec files that call `createSession` to obtain a cookie for route requests — not files that test session-store behavior.

### Pitfall 4: known_users upsert before issueSessionCookie
**What goes wrong:** The upsert must run even when the Kinetica URL is unavailable or the session creation fails.
**How to avoid:** Wrap in try/catch or place after successful session creation (at the same location as the existing `issueSessionCookie` call), and only run if `createSession` did not throw.

### Pitfall 5: datasets:manage not seeded by rbacSeed on first boot after upgrade
**What goes wrong:** Adding `DATASETS_MANAGE` to `PERMISSIONS` and `DEFAULT_ROLE_MAPPINGS` but not noting that the first boot after this code lands seeds it via `rbac_seed_history`. Operators running the migration spec to verify must do so with a fresh DB (no prior `rbac_seed_history` rows for this permission).
**How to avoid:** The `rbac_seed_history` mechanism handles this automatically — no special migration code needed. The migration spec for datasets:manage should verify: (a) fresh DB gets `datasets:manage` in `role_permissions` for designer and admin after boot; (b) existing DB with `rbac_seed_history` row already present does NOT double-seed.

### Pitfall 6: Management routes using username from path vs session
**What goes wrong:** `POST /api/users/:username/roles` uses `req.params.username` as the target user. Implementations might accidentally use `req.user!.creds.username` (the caller) as the target.
**How to avoid:** Target is always `req.params.username.toLowerCase()` for `user_roles` inserts; actor is `req.user!.creds.username` (for future audit logging in Phase 50).

---

## Code Examples

### Exact session-creation idiom (from routes.materialize.spec.ts, confirmed)

```typescript
// Current per-spec session helper pattern (lines ~35-40 in routes.materialize.spec.ts):
const createTestSession = (username: string = "testuser") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};
```

The `createAdminSession` helper replicates this exactly but uses `APP_ADMIN_USERNAME || "admin"` as the username, ensuring the bootstrap short-circuit fires.

### Existing requireConfig pattern (confirmed from index.ts line 254)

```typescript
const requireConfig = (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.KINETICA_URL) {
    return res.status(500).json({ error: "Missing KINETICA_URL environment variable." });
  }
  return next();
};
// Usage:
app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => { ... }));
```

`requirePermission` slots in the same position.

### REAUTH_REQUIRED precedent (errorMiddleware, index.ts line 1979)

```typescript
// Source: index.ts line 1979 (errorMiddleware)
res.status(401).json({ error: err.message, code: "REAUTH_REQUIRED" });

// Phase 47 mirrors this shape:
res.status(403).json({
  error: `Permission denied: ${permission} is required`,
  code: "PERMISSION_DENIED",
  permission,  // NEW field per CONTEXT.md locked decision
});
```

### GET /api/users query (management route)

```typescript
// Union of known_users + user_roles per CONTEXT.md locked decision:
const users = db.prepare(`
  SELECT ku.username,
         json_group_array(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS roles
  FROM (
    SELECT username FROM known_users
    UNION
    SELECT DISTINCT username FROM user_roles
  ) AS ku
  LEFT JOIN user_roles ur ON ur.username = ku.username
  LEFT JOIN roles r ON r.id = ur.role_id
  GROUP BY ku.username
  ORDER BY ku.username
`).all() as Array<{ username: string; roles: string }>;
// roles is JSON string — parse in handler: JSON.parse(row.roles)
```

---

## Passthrough Comment Block Template

Required by ROADMAP SC5 — must appear at the analyst-passthrough route registrations in `index.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════════════
// ANALYST-PASSTHROUGH BOUNDARY (GUARD-V18-03)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Routes below this comment are gated by requireAuth ONLY — NO requirePermission.
// These are the "analyst interaction" routes: every authenticated user can reach
// them regardless of their assigned role or the analyst-passthrough fallback.
//
// WHY each route is here:
//   POST /api/filter/materialize   — click-through drill-down; the core product value.
//                                    Session-scoped view name (username+sid) prevents
//                                    cross-user leakage. Gating this on ANY write
//                                    permission breaks the analyst role entirely.
//   DELETE /api/filter/materialize — analyst clears their own session filter.
//   POST /api/dynamic-view/materialize — fires on every filter change for widgets
//                                    bound to a dynamic view; analysts trigger this.
//   POST /api/dynamic-view/:id/drop — lifecycle cleanup at logout/dashboard-switch;
//                                    called automatically, not by user intent.
//                                    DISTINCT from DELETE /api/dynamic-view/:id which
//                                    deletes the saved config and requires DYNAMIC_VIEWS_MANAGE.
//   POST /api/dynamic-view/preview — reads data only; no persistent resource created.
//                                    Designer surface (DynamicViewsModal) but auth-only
//                                    route since it performs no writes.
//   POST /api/info/query           — spatial nearest-neighbor read; map popup interaction.
//   POST /api/top-values           — column cardinality probe for Data Filter widget dropdowns.
//   POST /api/column-stats         — chart config column stats; visible to all roles.
//   POST /api/quantile             — NTILE query backing class-break auto-suggest.
//   POST /api/sql                  — general Kinetica passthrough for all widget renders.
//                                    DATA ACCESS enforced by Kinetica per-user creds.
//   GET  /api/wms                  — map tile proxy; analyst views maps.
//   GET  /api/wms/capabilities     — WMS metadata; all roles may view maps.
//   GET  /api/kinetica/*           — schema/table/column discovery; auth-only per CONTEXT.
//   GET  /api/tables               — app table registry reads.
//   GET  /api/tables/:id           — single table read.
//
// If adding a new route, ask: "Can an analyst (dashboards:view only) need this?"
//   YES → place here with requireAuth (or requireAuth + requireConfig) only.
//   NO  → place in the guarded section with requirePermission(...).
// ═══════════════════════════════════════════════════════════════════════════════
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `packages/server/vitest.config.ts` |
| Quick run command | `npm run test:server -- --reporter=verbose 2>&1 \| grep -E "PASS|FAIL|Tests"` |
| Full suite command | `npm run test:server` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GUARD-V18-01 | `requirePermission` returns 403+code for non-admin session, 200 for admin | unit + integration | `npm run test:server -- --reporter=verbose 2>&1 \| grep rbac` | No — Wave 0 |
| GUARD-V18-01 | Unauthenticated request to gated route returns 401 (not 500, not 403) | integration | new spec | No — Wave 0 |
| GUARD-V18-02 | POST /api/dashboards without permission → 403 PERMISSION_DENIED | integration | new spec | No — Wave 0 |
| GUARD-V18-02 | POST /api/dashboards with admin session → 200/201 | integration | existing layers.spec.ts after migration | Partial |
| GUARD-V18-03 | Analyst session → POST /api/filter/materialize → 200 (not 403) | integration | routes.filter-materialize.spec.ts after migration | Partial |
| GUARD-V18-03 | Analyst session → POST /api/dynamic-view/:id/drop → 200 | integration | routes.dynamic-view-drop.spec.ts after migration | Partial |
| GUARD-V18-04 | GET /api/users without users:view → 403 | integration | new mgmt spec | No — Wave 0 |
| GUARD-V18-04 | POST /api/roles without roles:create_custom → 403 | integration | new mgmt spec | No — Wave 0 |
| GUARD-V18-05 | All existing passing specs still pass after guard landing | regression | `npm run test:server` baseline | Partial — migration needed |

### Sampling Rate
- **Per task commit:** `npm run test:server -- --reporter=verbose 2>&1 | grep -E "Tests|FAIL"`
- **Per wave merge:** `npm run test:server`
- **Phase gate:** Full suite ≥ 622 passing before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/routes.rbac.spec.ts` — covers GUARD-V18-01 (factory unit), GUARD-V18-02 (mutation gates), GUARD-V18-03 (passthrough assertions), GUARD-V18-04 (management route gates)
- [ ] `tests/helpers/db.ts` — add `createAdminSession()` export
- Framework: already installed; no new setup needed

---

## Open Questions

1. **datasets:manage in ARCHITECTURE.md catalog vs CONTEXT.md addition**
   - What we know: ARCHITECTURE.md (milestone research) uses a different permission catalog (11 coarser permissions like "dashboard:write"). Phase 46 shipped with 15 fine-grained permissions in `PERMISSIONS`. CONTEXT.md adds a 16th: `datasets:manage`.
   - What's unclear: ARCHITECTURE.md's catalog is superseded by the live `lib/permissions.ts`. No conflict — ARCHITECTURE.md was pre-Phase-46 planning doc.
   - Recommendation: Use only `lib/permissions.ts` as the source of truth. ARCHITECTURE.md's route permission table is a reference only, not the implementation target.

2. **GET /api/roles shape for Phase 49 compatibility**
   - What we know: CONTEXT.md says "exact REST shapes are Claude's discretion."
   - What's unclear: Phase 49 will build the Users Management UI that calls `GET /api/users` and `POST/DELETE /api/users/:username/roles`. Shapes chosen here lock the Phase 49 contract.
   - Recommendation: Return arrays with full detail from the start. `GET /api/roles` → `{ roles: [{ id, name, description, built_in, permissions: string[] }] }`. `GET /api/users` → `{ users: [{ username, roles: string[] }] }`. Document the shape in the management route handler comments.

3. **createAdminSession — pass db instance or use module singleton?**
   - What we know: `getEffectivePermissions` accepts an optional `conn` parameter; tests using `buildInMemoryDb()` pass their own db. The bootstrap admin short-circuit (`isBootstrapAdmin`) fires before any DB lookup.
   - Recommendation: Since `createAdminSession` uses the bootstrap admin username, no DB connection is needed at all — the short-circuit bypasses SQLite entirely. The helper signature is `createAdminSession(opts?: { kineticaUrl?: string })` with no db parameter. Tests that need non-admin role sessions (new RBAC-specific specs) will need to seed `user_roles` manually with the module-level `db`.

---

## Sources

### Primary (HIGH confidence)
- `packages/server/src/index.ts` — full route surface (lines 273–1943), direct read; all line numbers verified
- `packages/server/src/lib/permissions.ts` — PERMISSIONS catalog (15 items), DEFAULT_ROLE_MAPPINGS, direct read
- `packages/server/src/lib/rbacDb.ts` — getEffectivePermissions, isBootstrapAdmin, direct read
- `packages/server/src/lib/rbacSeed.ts` — seed-history mechanism, direct read
- `packages/server/src/db.ts` — SCHEMA_DDL, createDb, seedRbac call, direct read
- `packages/server/src/auth.ts` — issueSessionCookie, requireAuth, COOKIE_NAME, direct read
- `packages/server/src/kinetica.ts` — emitAudit shape (lines 83–106), OBS-01 format, direct read
- `packages/server/tests/helpers/app.ts` — buildTestApp, direct read
- `packages/server/tests/helpers/db.ts` — buildInMemoryDb, direct read
- `packages/server/tests/setup.ts` — test environment setup, direct read
- `packages/web/src/api/client.ts` — materializeView (lines 427-428), previewDynamicView, confirmed no-viewer-path

### Secondary (MEDIUM confidence — planning docs, verified against live code)
- `.planning/phases/47-server-middleware-route-guards/47-CONTEXT.md` — locked decisions, all cross-checked against live code
- `.planning/research/ARCHITECTURE.md` — superseded by Phase 46 live implementation for catalog; route group patterns still valid
- `.planning/research/PITFALLS.md` — P1–P14 all verified as still applicable

### Tertiary
- Test run output (`npm run test:server`) — confirmed 13 failing files, 622 passing baseline, OIDC timeout root cause

---

## Metadata

**Confidence breakdown:**
- Route inventory: HIGH — all line numbers from direct source read; no interpolation
- Test-suite migration: HIGH — file list from direct grep; call site count confirmed
- Factory design: HIGH — matches existing requireAuth/requireConfig patterns exactly
- Management route shapes: MEDIUM — CONTEXT.md says "Claude's discretion"; shapes proposed are conventional REST
- known_users upsert: HIGH — exact line locations confirmed from source read

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable Express/SQLite patterns; permissions catalog locked in Phase 46)
