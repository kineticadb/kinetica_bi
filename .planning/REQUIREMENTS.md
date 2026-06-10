# Requirements: Kinetica BI — v1.10 Per-Dashboard View Permissions

**Defined:** 2026-06-09
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, without writing SQL.

**Locked decisions (from milestone questioning, 2026-06-09):** View-access granted to BOTH users (lowercased username) and roles, with union semantics; admin + designer BYPASS (see/open all), view-only roles (analyst) restricted to grants; newly created dashboards are PRIVATE-by-default (only bypass roles until granted); a new `dashboards:manage_access` permission (17th catalog entry, default admin + designer) gates grant/revoke; enforcement is server-authoritative on list + open + dashboard-scoped data routes; grant changes audited via the existing dual-sink. **Security boundary:** this is an app-level *visibility/organization* layer — actual data access stays enforced by each user's Kinetica credentials on every `/api/sql`/`/api/wms`/info call (v1.0 model). Intentionally revises the v1.8 "shared workspace — no dashboard ownership" decision.

## v1 Requirements

Requirements for this milestone (v1.10). Each maps to exactly one roadmap phase.

### Access Model & Permission

- [x] **ACCESS-V110-01**: A `dashboards:manage_access` permission exists in the catalog (17th permission), default-granted to the `admin` and `designer` built-in roles, seeded once-only via the existing `rbac_seed_history` mechanism (operator removals of the default mapping survive restarts; the new permission seeds exactly once)
- [x] **ACCESS-V110-02**: A dashboard's view-access can be granted to specific users (by lowercased username) and/or to roles, persisted in a new app-local SQLite table keyed by dashboard + grantee (user or role), with cascade-on-dashboard-delete
- [x] **ACCESS-V110-03**: A server-side resolver decides whether a user may view a given dashboard — true when the user is `admin` or `designer` (bypass), OR holds a direct user grant, OR holds a grant via ANY of their roles (union semantics mirroring `getEffectivePermissions`)
- [x] **ACCESS-V110-04**: A newly created dashboard has no grants and is therefore visible/openable only to bypass roles until access is explicitly granted (private-by-default)

### Server Enforcement

- [x] **ENFORCE-V110-01**: `GET /api/dashboards` returns only the dashboards the requesting user may view (bypass roles receive all; everyone else receives only granted dashboards) — server-authoritative, not a client-side filter
- [x] **ENFORCE-V110-02**: A user who may not view a dashboard is denied server-side on open — `GET /api/dashboards/:id` and its dashboard-scoped data routes (widgets, tables, layers, dynamic-views, views) return 403/404 for that user
- [x] **ENFORCE-V110-03**: The dashboard access-grant routes (list / add / remove a dashboard's grants) are gated by `dashboards:manage_access`
- [x] **ENFORCE-V110-04**: Every grant add/remove is recorded via the existing dual-sink audit (an `rbac_audit` row + an OBS-1 log line), consistent with v1.8 mutation auditing

### Access Management UI

- [x] **GRANTUI-V110-01**: A user with `dashboards:manage_access` can open an access panel for a dashboard that lists its current user grants and role grants
- [x] **GRANTUI-V110-02**: From that panel the user can add a grant (choose a user or a role) and remove an existing grant, with changes persisted via the grant API
- [x] **GRANTUI-V110-03**: The access-management entry point is hidden in the UI when the user lacks `dashboards:manage_access` (the server remains the authority; UI gating is UX only)

### List & Open UX

- [x] **LISTUX-V110-01**: The dashboard list view shows only the dashboards the user may view (driven by the filtered list endpoint) — analysts no longer see dashboards they have not been granted
- [x] **LISTUX-V110-02**: Navigating directly to a non-permitted dashboard (stale URL / direct nav) shows a clear "you don't have access" state rather than a broken or empty dashboard
- [x] **LISTUX-V110-03**: Admin and designer users continue to see and open all dashboards with no regression to the existing design/governance workflow

### Verification

- [x] **VERIFY-V110-01**: Live operator UAT — an analyst sees and can open only granted dashboards (list + direct nav both enforced); a `manage_access` user grants and revokes both user and role access and the effect is immediate; admin/designer are unaffected; automated gates green (frontend 100%, web+server tsc clean, server set-based known-flaky gate)

## v2 Requirements

Deferred to a future milestone. Tracked but not in this roadmap.

### Dashboard Access (future)

- **DACL-V2-01**: Per-dashboard EDIT grants (grant a specific user/role edit rights to one dashboard, independent of the global designer role)
- **DACL-V2-02**: Dashboard ownership / creator column + ownership transfer
- **DACL-V2-03**: Link-based / token public sharing (view a dashboard via an unauthenticated share link)

## Out of Scope

Explicitly excluded for v1.10. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Per-dashboard EDIT grants | This milestone is about VIEW access; edit stays governed by the global `designer` role. Deferred to DACL-V2-01. |
| Dashboard ownership / creator column / transfer | Grants model covers the analyst-assignment need without ownership semantics; ownership is a larger model change. Deferred to DACL-V2-02. |
| Link-based / public (unauthenticated) sharing | Separate auth surface (anonymous identity); out of the RBAC-extension scope. Deferred to DACL-V2-03. |
| Row/column-level data security | Kinetica per-user credentials already enforce data access on every call (v1.0 model); app-level dashboard ACL is a visibility layer, not a data-security boundary. |
| Folders / dashboard grouping | Organization feature unrelated to access control. |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACCESS-V110-01 | Phase 55 | Complete |
| ACCESS-V110-02 | Phase 55 | Complete |
| ACCESS-V110-03 | Phase 55 | Complete |
| ACCESS-V110-04 | Phase 55 | Complete |
| ENFORCE-V110-01 | Phase 55 | Complete |
| ENFORCE-V110-02 | Phase 55 | Complete |
| ENFORCE-V110-03 | Phase 55 | Complete |
| ENFORCE-V110-04 | Phase 55 | Complete |
| GRANTUI-V110-01 | Phase 56 | Complete |
| GRANTUI-V110-02 | Phase 56 | Complete |
| GRANTUI-V110-03 | Phase 56 | Complete |
| LISTUX-V110-01 | Phase 56 | Complete |
| LISTUX-V110-02 | Phase 56 | Complete |
| LISTUX-V110-03 | Phase 56 | Complete |
| VERIFY-V110-01 | Phase 57 | Complete |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15 ✓
- Unmapped: 0 ✓

**Phase rollup:**
- Phase 55 (Access Model & Server Enforcement): 8 requirements (ACCESS-V110-01..04, ENFORCE-V110-01..04)
- Phase 56 (Access-Management UI & List/Open UX): 6 requirements (GRANTUI-V110-01..03, LISTUX-V110-01..03)
- Phase 57 (Verification & Live UAT): 1 requirement (VERIFY-V110-01)

---
*Requirements defined: 2026-06-09*
*Last updated: 2026-06-09 — roadmap created (Phases 55-57); traceability populated, 15/15 mapped*
