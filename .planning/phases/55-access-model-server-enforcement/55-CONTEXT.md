# Phase 55: Access Model & Server Enforcement - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Model per-dashboard VIEW access and enforce it server-side so the server is the single authority for which dashboards a user can list, open, and load data for. Delivers: a `dashboards:manage_access` permission (17th catalog entry), an app-local grant store (users + roles), a `canViewDashboard` resolver, a server-filtered `GET /api/dashboards`, open-gating on dashboard-scoped routes, grant CRUD routes gated by `manage_access`, and dual-sink audit on grant changes. The access-management UI, the filtered-list UX, and the "no access" state are Phase 56. Live UAT is Phase 57.

</domain>

<decisions>
## Implementation Decisions

### Denial semantics (open / scoped fetch)
- A user who may not view a dashboard gets **404 Not Found** (not 403) on the dashboard record and its scoped routes — hides existence; unauthorized users cannot probe which dashboards exist.
- Reuse the EXISTING `if (!getDashboard(id)) return res.status(404).json({ error: "Dashboard not found." })` guard path on the dashboard-scoped routes — access denial collapses into the same "not found" response (one code path, identical body), so there's no observable difference between "doesn't exist" and "you can't see it".

### Enforcement boundary (which routes gate)
- **Gate dashboard-scoped routes ONLY:** the dashboard record (`GET /api/dashboards/:id` if present) + `GET /api/dashboards/:id/widgets`, `/tables`, `/layers`, `/dynamic-views`, `/views` (every route keyed by a dashboard id).
- **Do NOT gate the table-scoped passthrough routes** — `/api/sql`, `/api/wms`, `/api/info/query`, `/api/filter/materialize`. These stay analyst-passthrough; a table appears on many dashboards (no reliable 1:1 dashboard mapping), and **Kinetica per-user credentials remain the data-access authority** (v1.0 model). Per-dashboard access is an app-level *visibility* layer, not a data-security boundary. The planner must NOT try to scope these routes by dashboard.

### Bypass mechanism (admin + designer see all)
- Bypass = the user holds the **`dashboards:manage_access`** permission (via `getEffectivePermissions(username).has(...)`). This covers admin + designer by default (their seeded mappings) AND any custom role granted `manage_access` ("if you manage sharing, you can see it"). No hardcoded role-name checks.
- `isBootstrapAdmin` already short-circuits `getEffectivePermissions` to ALL_PERMISSIONS, so the bootstrap admin always bypasses.

### `canViewDashboard(username, dashboardId)` resolver
- Returns true if: (a) `getEffectivePermissions(username)` includes `dashboards:manage_access` (bypass), OR (b) a direct user grant exists for the lowercased username, OR (c) any of `getEffectiveRoles(username)` matches a role grant on that dashboard. Union semantics, mirroring the rbacDb resolver pattern.
- A dashboard with NO grants is viewable only by bypass holders → **private-by-default** falls out naturally (no special-casing).

### Grant model
- Grant to **both** users (lowercased username) and roles, union semantics.
- **Pre-provisioning allowed:** a grant may target any username string (need NOT exist in `known_users` yet) or any role — analysts can be assigned before first login; the grant resolves on their first session. (Validating role existence is Claude's discretion; user-grant strings are free-form lowercased.)
- New app-local SQLite table (e.g. `dashboard_access_grants`), `CREATE TABLE IF NOT EXISTS` (idempotent, matches existing db.ts style), keyed by dashboard id + grantee; grants are removed when their dashboard is deleted (cascade via FK `ON DELETE CASCADE` or an explicit delete in the dashboard-delete handler — Claude's discretion).

### Permission seeding (17th permission)
- Add `DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access"` to the `PERMISSIONS` catalog. admin gets it automatically (ALL_PERMISSIONS); add an explicit `designer` entry in `DEFAULT_ROLE_MAPPINGS`.
- Seed via the existing **`rbac_seed_history` once-only** mechanism (seedRbac / rbacSeed.ts) so it seeds exactly once and an operator who later removes the default designer mapping keeps it removed across restarts.

### Grant mutation + audit
- Grant list/add/remove routes gated by `requirePermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS)`.
- Every add/remove emits the dual-sink audit via `emitRbacAudit(db, {...})` (rbac_audit row + OBS-1 log line), consistent with the v1.8 mutation handlers.

### Claude's Discretion
- Exact grant table column names/shape (single table with a grantee_type discriminator vs two tables) — pick what's cleanest; must support both user and role grants + cascade.
- Cascade mechanism (FK ON DELETE CASCADE vs explicit delete in handler).
- Whether to validate that a granted role exists at grant time (vs storing free-form).
- Exact grant route shapes/paths (e.g. `/api/dashboards/:id/access` GET/POST/DELETE) and request/response bodies.
- `canViewDashboard` query strategy (per-call SQL vs batched for the list filter).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external spec/ADR docs exist in this project — the v1.8 RBAC code IS the contract to mirror.

### RBAC model to extend
- `packages/server/src/lib/permissions.ts` — `PERMISSIONS` catalog (16 entries; add 17th), `ALL_PERMISSIONS`, `BUILTIN_ROLES`, `DEFAULT_ROLE_MAPPINGS` (admin = ALL; add designer→manage_access).
- `packages/server/src/lib/rbacDb.ts` — `getEffectivePermissions(username)`, `getEffectiveRoles(username)`, `isBootstrapAdmin(username)` (bootstrap short-circuit). Mirror these for `canViewDashboard`.
- `packages/server/src/lib/rbacSeed.ts` + `packages/server/src/db.ts` §rbac_seed_history (lines ~166-184) — once-only seeding contract for the new default mapping.
- `packages/server/src/rbac.ts` — `requirePermission(permission)` middleware factory (gate the grant routes).

### Enforcement integration points
- `packages/server/src/index.ts` — `GET /api/dashboards` (line ~508, currently un-gated → add server-side filter); dashboard-scoped GETs (`/:id/widgets` ~534, `/:id/tables` ~571, `/:id/layers` ~600, dynamic-views, views) all use the `if (!getDashboard(id)) return 404` guard → extend with `canViewDashboard`. `emitRbacAudit(db, {...})` call sites (~2085+) for the audit pattern.
- `packages/server/src/db.ts` — `dashboards` table (line ~15, no owner column); table-creation + idempotent-migration style to mirror for the new grant table.

### Phase contract
- `.planning/ROADMAP.md` §Phase 55 — goal + 6 success criteria.
- `.planning/REQUIREMENTS.md` — ACCESS-V110-01..04, ENFORCE-V110-01..04.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getEffectivePermissions` / `getEffectiveRoles` / `isBootstrapAdmin` (rbacDb.ts) — directly compose `canViewDashboard`.
- `requirePermission` factory (rbac.ts) — gate grant routes with the new permission.
- `emitRbacAudit` dual-sink — reuse verbatim for grant add/remove auditing.
- `rbac_seed_history` + `seedRbac` (rbacSeed.ts) — the once-only default-mapping seeding mechanism; the 17th permission's designer mapping rides it.
- The existing `getDashboard(id)` 404 guard on every dashboard-scoped route — the natural insertion point for access enforcement.

### Established Patterns
- Server-authoritative enforcement; UI gating is UX-only (v1.8 lock).
- Usernames stored LOWERCASED in RBAC tables (user_roles); grant user-keys must match.
- `CREATE TABLE IF NOT EXISTS` idempotent schema in db.ts (covers fresh + existing deployments; no destructive migrations).
- ANALYST-PASSTHROUGH BOUNDARY (index.ts ~796): data routes stay ungated — do not regress this.

### Integration Points
- `GET /api/dashboards` list filter (the one currently-ungated read).
- A `requireDashboardAccess(:id)` middleware (or inline check) on dashboard-scoped GETs, returning the existing 404 body on denial.
- New grant CRUD routes + new grant table in db.ts.

### Test-gate reality
- Server vitest is nondeterministically flaky (TD-V16-TEST-ISOLATION, ~106 known-flaky failures across ~14 files). Use a SET-BASED gate (failing files ⊆ known-flaky list), NEVER a fixed pass-count. New enforcement needs supertests; server + web tsc must stay clean. vitest doesn't type-check (esbuild) → run tsc gates alongside.

</code_context>

<specifics>
## Specific Ideas

- "Assign analysts to only the dashboards they need" — the driving use case; pre-provisioning (grant before first login) directly serves it.
- Private-by-default must produce ZERO accidental exposure: a brand-new dashboard is invisible to analysts until explicitly granted.

</specifics>

<deferred>
## Deferred Ideas

- Per-dashboard EDIT grants (DACL-V2-01) — edit stays governed by the global designer role this milestone.
- Dashboard ownership / creator column / transfer (DACL-V2-02).
- Link-based / public unauthenticated sharing (DACL-V2-03).
- Folders / dashboard grouping — unrelated organization feature.

</deferred>

---

*Phase: 55-access-model-server-enforcement*
*Context gathered: 2026-06-09*
