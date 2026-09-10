# Phase 49: Users Management UI - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The Users page: list known users with role chips, assign/revoke roles per user, bulk assign, admin onboarding banner — plus SAFE-V18-01 last-admin protection on the server assign/revoke API. Role/permission MAPPING editing is Phase 50. The page mounts behind the `users:view`-gated Sidebar nav item Phase 48 already shipped.

</domain>

<decisions>
## Implementation Decisions

### Page layout & assign UX
- **Table + chips + popover**: rows = username | role chips | last-seen | actions. Mirrors existing table idioms.
- Each explicitly-assigned role renders as a chip with **× to revoke** (immediate DELETE call).
- **"Edit roles" button** per row opens a small checkbox popover listing all roles (built-in + custom from GET /api/roles); checking/unchecking fires assign/revoke.
- **Last-seen column** from `known_users.last_seen` (humanized, e.g. "5m ago", "3d ago"); users present only via assignment (never logged in) show "never".
- Routing: new `Page` union entry (e.g. `"users"`) in App.tsx's state router; Sidebar item key wired to it.

### Unassigned users
- Show a **muted/outlined "analyst (default)" chip** — no ×, visually distinct from explicit assignments. Tooltip: "No roles assigned — analyst by default."
- Explicitly assigning the analyst role converts it to a normal chip (with ×).

### Bulk assignment
- Row **checkboxes + action bar**: "Assign role ▾ to N selected" — **assign only** (revoke stays per-chip; bulk-revoke NOT in v1.8).
- Server processes per-user; UI toasts aggregate result: "3 assigned, 1 failed: <username — reason>".
- Whether bulk uses N individual POSTs or a new bulk endpoint is Claude's discretion (N posts acceptable; this is an internal tool).

### Onboarding banner (USERS-V18-04)
- **App-shell banner** (above main content, visible on any page) for users **with `users:assign_roles`** while ≥1 unassigned user exists: "N users are on the default analyst role — Review in User Management" (link navigates to the Users page).
- **Session-dismissable** (× hides until next login); auto-disappears when all users have assignments.
- Count source: derived from GET /api/users (users with zero explicit roles). Fetch lazily/cheaply — do not block app bootstrap on it; acceptable to fetch once post-auth for permitted users only.

### Bootstrap admin row
- **Visible with a lock indicator**: immutable [admin] chip (no ×), no Edit-roles button, tooltip "Bootstrap admin (APP_ADMIN_USERNAME) — always app admin."
- GET /api/users should include the bootstrap username (it's in known_users once logged in; if it has never logged in and has no rows, server should still include it flagged as bootstrap — planner verifies the Phase 47 endpoint behavior and extends if needed).

### Last-admin protection (SAFE-V18-01 — server, this phase)
- Server rejects (clear 400, verbatim reusable message) any revoke that would leave **zero non-bootstrap users holding the admin role**... applied at `DELETE /api/users/:username/roles/admin` (and any mapping-edit equivalent is Phase 50's concern). Bootstrap is exempt/uncounted (cannot be removed at all).
- **No client-side admin counting** — server is the single authority. UI surfaces the verbatim server message: inline in the Edit-roles popover next to the blocked checkbox, and as an error toast for chip-× revokes.

### Claude's Discretion
- Component naming/structure (UsersPage.tsx vs UserManagementPage.tsx), CSS class conventions (mirror existing .layers-modal-* style naming)
- Popover implementation (existing patterns vs small new primitive — no new deps)
- Humanized relative-time helper (hand-roll tiny helper; no date lib)
- Bulk via N POSTs vs new endpoint
- Empty state when only the bootstrap admin exists
- Search/filter box on the table (add if trivial; not required)

</decisions>

<specifics>
## Specific Ideas

- Approved layout sketch from discussion:
```
USERNAME      ROLES                        LAST SEEN
admin 🔒      [admin]                      2h ago
rpereira      [designer ×][user_admin ×]   5m ago    [Edit roles]
jchen         [analyst ·default]           3d ago    [Edit roles]
☐ select │ chips × = revoke │ popover = assign
```
- Verbatim server error messages everywhere — single source of truth for guard text.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 49 — success criteria (5)
- `.planning/REQUIREMENTS.md` — USERS-V18-01..04, SAFE-V18-01
- `.planning/phases/47-server-middleware-route-guards/47-VERIFICATION.md` — the management API shapes this page consumes (GET /api/users UNION query, POST/DELETE /api/users/:username/roles, GET /api/roles)
- `.planning/phases/48-me-extension-frontend-store-ui-gating/48-VERIFICATION.md` — hasPermission/seedAuthStore/gated-nav foundations

### Research
- `.planning/research/FEATURES.md` § role assignment UI patterns + last-admin reference behavior (Grafana)
- `.planning/research/PITFALLS.md` — last-admin lockout

### Existing code (read before touching)
- `packages/web/src/App.tsx` — Page union state router (line ~18), banner mount region, post-auth bootstrap
- `packages/web/src/components/Sidebar.tsx` — nav keys from Phase 48 (what key does "User Management" emit?)
- `packages/web/src/components/DatasetsPage.tsx` — closest existing page-shape precedent
- `packages/web/src/components/Toast.tsx` + `store/toast.ts` — toast kinds
- `packages/web/src/test/seedAuthStore.ts` — permission-seeded spec states
- `packages/server/src/index.ts` management routes (~lines 2018-2150) — SAFE-V18-01 deferral comments mark where the guard lands
- `packages/server/tests/routes.management.spec.ts` — extend with last-admin cases

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 47 management API (users list incl. last_seen, assign/revoke, roles list) — page is a pure consumer plus the new last-admin guard
- `hasPermission` + `seedAuthStore` helpers (Phase 48) — gating + spec seeding
- Toast store with "permission"/"error"/"info" kinds; chip styling precedents (`.layer-row-badge`, FilterBar chips)
- App.tsx state router — add one Page union member + render branch

### Established Patterns
- Hide-don't-disable (controls visible only with `users:assign_roles`; viewers with only `users:view` see read-only chips)
- AbortController per operation scope (DynamicViewsModal 4-controller precedent)
- RTL + zustand reset shim + seedAuthStore for gated-render specs

### Integration Points
- App.tsx: Page union, render branch, app-shell banner region
- Server: last-admin guard inside DELETE /api/users/:username/roles handler (replacing the SAFE-V18-01 deferral comment)
- routes.management.spec.ts: last-admin test cases (revoke last non-bootstrap admin → 400; revoke when 2 admins → 200; bootstrap never revocable)

</code_context>

<deferred>
## Deferred Ideas

- Bulk revoke — explicitly out of v1.8 bulk scope
- Search/filter on users table — Claude's discretion if trivial, otherwise defer
- Escalation guards (SAFE-V18-02) + role-change audit (AUDIT-V18-01) — Phase 50
- Embeddable/public dashboards via embed identity — backlog

</deferred>

---

*Phase: 49-users-management-ui*
*Context gathered: 2026-06-05*
