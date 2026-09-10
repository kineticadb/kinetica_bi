# Phase 47: Server Middleware + Route Guards - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Every mutating route is permission-gated server-side; RBAC management API routes ship; the existing supertest suite stays at baseline via `createAdminSession()`. Server enforcement becomes the authority BEFORE any frontend work (Phase 48+). NO frontend changes, NO management UI (Phases 48–50).

</domain>

<decisions>
## Implementation Decisions

### Datasets permission (catalog gap closed)
- **NEW 16th permission `datasets:manage`** — gates dataset/table registration: `POST/PATCH/DELETE /api/tables`. Default mapping: **designer + admin**. Added to `PERMISSIONS` in `lib/permissions.ts` and to `DEFAULT_ROLE_MAPPINGS` for designer + admin — Phase 46's `rbac_seed_history` mechanism seeds it exactly once on existing deployments (this is the first real exercise of the upgrade path; spec it).
- **Kinetica schema discovery stays auth-only passthrough**: `GET /api/kinetica/schemas`, `GET /api/kinetica/schemas/:schema/tables`, `GET /api/kinetica/schemas/:schema/tables/:table/columns` — read-only metadata; Kinetica enforces per-user data access; designers/config panels need it freely.
- `GET /api/tables` and `GET /api/tables/:id` (reads) stay auth-only; only mutations gate.

### Users-list source (management API)
- `GET /api/users` returns the **union** of: distinct usernames from a new `known_users` table ∪ usernames in `user_roles`. Shows unassigned users (onboarding-banner count needs this) AND pre-assigned users who haven't logged in yet.
- **NEW `known_users` table** — `(username TEXT PRIMARY KEY, first_seen, last_seen)`, **upserted on every successful login** (both password and OIDC callback paths). Durable login history independent of session GC (sessions die at 8h TTL/logout). Usernames lowercased (Phase 46 convention). Gives Phase 49 last-seen timestamps for free. CREATE TABLE IF NOT EXISTS in SCHEMA_DDL (same pattern as Phase 46 tables).

### 403 response & denial logging
- 403 body **includes the missing permission**: `{ error: <human message>, code: "PERMISSION_DENIED", permission: "<perm string>" }` — single-tenant internal tool; debuggability wins. Phase 48 can render "You need <permission>".
- **Permission denials are audit-logged in this phase** via the existing OBS-01 JSON logger: username, route, op, missing permission, outcome=denied. (Role-CHANGE audit remains Phase 50 / AUDIT-V18-01.)

### Edge-route classifications (locked)
- `POST /api/sql` — **PASSTHROUGH (auth-only)**. It is the chart-data path every widget queries through; gating it breaks the analyst role entirely. Data access enforced by Kinetica per-user credentials. Document PROMINENTLY in the passthrough comment block.
- `POST /api/views/:id/materialize` — **GATED with `dashboards:edit`** (part of the designer saved-views workflow, unlike transient filter-materialize). **Planner/executor MUST verify no viewer-path code calls this route during normal dashboard viewing before locking the guard** — if a viewer path is found, surface it rather than silently gating.
- Full passthrough list (GUARD-V18-03, requireAuth ONLY): `POST/DELETE /api/filter/materialize`, `POST /api/info/query`, `POST /api/top-values`, `POST /api/column-stats`, `POST /api/quantile`, `POST /api/dynamic-view/materialize`, `POST /api/dynamic-view/:id/drop`, `POST /api/dynamic-view/preview` (verify: preview is used by the dv modal — designer surface — but the route itself reads data only; planner's call, document either way), `GET /api/wms`, `GET /api/wms/capabilities`, `POST /api/sql`, `GET /api/kinetica/*`, `GET /api/tables`, `GET /api/tables/:id`, dashboard/widget/layer/dynamic-view GETs.

### Management API routes (this phase, UI in 49/50)
- `GET /api/users` — gated `users:view`
- `POST /api/users/:username/roles` + `DELETE /api/users/:username/roles/:roleName` (assign/revoke) — gated `users:assign_roles`
- `GET /api/roles` (+ mappings) — gated `roles:view`
- `POST /api/roles` — gated `roles:create_custom`; `PUT/PATCH /api/roles/:id/permissions` — gated `roles:manage_permissions`; `DELETE /api/roles/:id` — gated `roles:delete_custom`
- Exact REST shapes are Claude's discretion; SAFE-V18-01/02 guards (last-admin, escalation) are Phases 49/50 scope — do NOT implement here unless trivially natural; the routes may ship with basic validation and gain those guards in their phases. If planner prefers shipping last-admin/escalation guards now alongside the routes, that is acceptable scope-pull-forward — flag it in the plan.

### Claude's Discretion
- requirePermission implementation details (factory signature, composition order specifics)
- Exact REST shapes/payloads for management routes
- createAdminSession() helper design and how the existing 49 spec files get migrated (bulk find-replace vs helper re-export)
- Whether dynamic-view preview gates or passes through (document choice in the boundary comment)
- Audit log field names for denials (consistent with existing OBS-01 shape)

</decisions>

<specifics>
## Specific Ideas

- The passthrough boundary comment block in index.ts is a deliverable, not an afterthought — ROADMAP SC5 requires it visible at the route registrations.
- `datasets:manage` addition doubles as the first live test of the Phase 46 seed-history upgrade path — write the migration spec to prove an existing-DB deployment gains it exactly once.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 47 — 5 success criteria (esp. SC2 analyst-reachability and SC4 baseline 582→634 test gate)
- `.planning/REQUIREMENTS.md` — GUARD-V18-01..05
- `.planning/phases/46-rbac-schema-data-layer/46-CONTEXT.md` — Phase 46 locked decisions incl. seed-history refinement
- `.planning/phases/46-rbac-schema-data-layer/46-VERIFICATION.md` — what Phase 46 actually shipped

### Research
- `.planning/research/ARCHITECTURE.md` — requirePermission factory design, route permission table, anti-patterns
- `.planning/research/PITFALLS.md` — analyst-passthrough risk, test-suite collapse, escalation guards

### Existing code (read before touching)
- `packages/server/src/index.ts` — full route surface (~45 routes; inventory at lines 273–1931); global `app.use("/api", requireAuth)` placement; OBS-01 emitAudit shape
- `packages/server/src/auth.ts` — requireAuth (DO NOT modify)
- `packages/server/src/lib/permissions.ts` + `lib/rbacDb.ts` + `lib/rbacSeed.ts` — Phase 46 primitives (catalog, getEffectivePermissions, seed-history)
- `packages/server/tests/helpers/app.ts` — buildTestApp; `tests/helpers/db.ts` — where createAdminSession lands

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getEffectivePermissions(username, conn?)` from Phase 46 — the middleware calls this per request
- OBS-01 `emitAudit` JSON logger — extend for denial entries
- `buildTestApp()` helper — createAdminSession composes with it
- Phase 46 seed-history — handles the `datasets:manage` catalog addition automatically

### Established Patterns
- Typed error → middleware → `{ error, code }` body (REAUTH_REQUIRED precedent) — PERMISSION_DENIED mirrors it
- `requireConfig` per-route middleware chaining precedent (many routes already chain `requireConfig`) — requirePermission chains the same way
- AUTH_MODE-agnostic supertest pattern (Phase 38 quantile specs) for new management-route tests

### Integration Points
- ~20 mutation routes in index.ts get `requirePermission(...)` inserted in their middleware chain
- Login success paths (password login + OIDC callback) gain the known_users upsert
- `lib/permissions.ts` gains `datasets:manage`; `DEFAULT_ROLE_MAPPINGS` designer+admin updated
- All 49 existing spec files migrate to createAdminSession (same-phase, mandatory — GUARD-V18-05)

</code_context>

<deferred>
## Deferred Ideas

- Last-admin protection (SAFE-V18-01) — Phase 49 (with assign/revoke UI) unless planner pulls forward
- Escalation guards (SAFE-V18-02) — Phase 50
- Role-change audit entries (AUDIT-V18-01) — Phase 50
- Embeddable/public dashboards via embed identity — backlog (from Phase 46 discussion)

</deferred>

---

*Phase: 47-server-middleware-route-guards*
*Context gathered: 2026-06-05*
