# Phase 49: Users Management UI — Research

**Researched:** 2026-06-05
**Domain:** React page component, app-shell banner, server SAFE-V18-01 guard, popover pattern
**Confidence:** HIGH (all findings verified from live source code)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Table + chips + popover layout**: rows = username | role chips | last-seen | actions
- **Role chips with × to revoke**: immediate DELETE call on click; no confirmation dialog
- **"Edit roles" button** per row opens checkbox popover listing all roles from GET /api/roles
- **Last-seen column** from `known_users.last_seen` (humanized, e.g. "5m ago"); "never" for assigned-but-never-logged-in users
- **Routing**: new `Page` union entry `"users"` in App.tsx state router; Sidebar key is already `"users"`
- **Unassigned users**: show muted/outlined "analyst (default)" chip — no ×; tooltip "No roles assigned — analyst by default."
- **Explicit analyst assignment** converts default chip to normal chip with ×
- **Bulk assignment**: row checkboxes + action bar: "Assign role ▾ to N selected" — assign only; N individual POSTs acceptable; aggregate toast "3 assigned, 1 failed: <username — reason>"
- **Onboarding banner**: app-shell banner (above main content, all pages) for users with `users:assign_roles` while ≥1 unassigned user exists; "N users are on the default analyst role — Review in User Management"; session-dismissable; auto-disappears when all users assigned; fetch lazily post-auth
- **Bootstrap admin row**: lock indicator, immutable [admin] chip (no ×), no Edit-roles button, tooltip "Bootstrap admin (APP_ADMIN_USERNAME) — always app admin."
- **SAFE-V18-01**: server rejects (400) revoke leaving zero non-bootstrap admin holders; bootstrap exempt; UI surfaces verbatim server message — inline in popover + error toast for chip-× revokes
- **No client-side admin counting** — server is the single authority

### Claude's Discretion
- Component naming/structure (UsersPage.tsx vs UserManagementPage.tsx)
- CSS class conventions (mirror existing `.layers-modal-*` style naming)
- Popover implementation (existing patterns vs small new primitive — no new deps)
- Humanized relative-time helper (hand-roll tiny helper; no date lib)
- Bulk via N POSTs vs new endpoint
- Empty state when only the bootstrap admin exists
- Search/filter box on the table (add if trivial; not required)

### Deferred Ideas (OUT OF SCOPE)
- Bulk revoke — explicitly out of v1.8
- Escalation guards (SAFE-V18-02) + role-change audit (AUDIT-V18-01) — Phase 50
- Embeddable/public dashboards via embed identity — backlog
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| USERS-V18-01 | Users page lists known usernames with role chips | GET /api/users union query confirmed; response shape documented below |
| USERS-V18-02 | User admin can assign and revoke roles per user | POST/DELETE /api/users/:username/roles shapes confirmed; idempotent revoke verified |
| USERS-V18-03 | Bulk role assignment — select multiple users, assign one role | N individual POSTs pattern confirmed viable; aggregate toast via useToastStore |
| USERS-V18-04 | Admin onboarding banner for unassigned users | App.tsx layout structure confirmed; banner mount point is `<div className="main">` above page content; no existing banner component in app-shell but `login-banner` class + `role="status"` is the precedent |
| SAFE-V18-01 | Server rejects revoke leaving zero non-bootstrap admins | DELETE handler confirmed at line 2059; deferral comment at line 2058; guard replaces that comment |
</phase_requirements>

---

## Summary

Phase 49 is a pure assembly phase — all upstream infrastructure (management API, `hasPermission`, `seedAuthStore`, toast store) ships in Phases 47–48. The task is to: (1) extend the server's DELETE /api/users/:username/roles/:roleName handler with the SAFE-V18-01 last-admin guard; (2) add a `"users"` Page entry to App.tsx and render `<UsersPage>`; (3) build the page component itself (table, chips, popover, bulk select, last-seen); (4) add a session-dismissable banner in App.tsx above the page router.

The GET /api/users endpoint **does not currently return `last_seen`** — it only returns `{ username, roles }`. The planner must include a server-side task to extend the UNION query to join `known_users.last_seen`. The endpoint also does not flag the bootstrap admin; that flag must either be derived client-side (compare username to a `GET /api/auth/me`-sourced bootstrap username) or added server-side. The simplest approach: add `is_bootstrap: boolean` to each row in the GET /api/users response by comparing against `process.env.APP_ADMIN_USERNAME || 'admin'` on the server.

The popover pattern in this codebase uses `useRef<HTMLDivElement>` + `document.addEventListener("mousedown", ...)` guarded by `wrapRef.current.contains(e.target)` — this pattern is proven in `DataFilterRenderer.tsx` and should be replicated for the Edit-roles popover with no new dependencies.

**Primary recommendation:** Three-plan wave structure — (1) server SAFE-V18-01 guard + GET /api/users extension; (2) UsersPage component (table + chips + popover + bulk); (3) App.tsx integration (Page union + banner).

---

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|---|---|---|---|
| React + useState/useEffect/useRef | Already in project | Page component, popover open/close, click-outside | Project standard |
| useAuthStore (hasPermission) | Already in project | Gate assign/revoke controls on `users:assign_roles` | Phase 48 ships this |
| useToastStore | Already in project | Error toasts for chip-× failures, aggregate bulk result | Phase 12+ standard |
| PERMISSIONS constants (client mirror) | Already in project at `src/lib/permissions.ts` | Import `PERMISSIONS.USERS_VIEW`, `PERMISSIONS.USERS_ASSIGN_ROLES` | Phase 48 ships this |
| better-sqlite3 (server) | Already in project | SAFE-V18-01 admin count query | Project standard; no new deps |

### Supporting
| Library/Tool | Version | Purpose | When to Use |
|---|---|---|---|
| clsx | Already in project (used in Sidebar.tsx) | Conditional class names for chips, active states | Use for chip variant styling |
| FontAwesome (faLock, faXmark, faCheck) | Already in project | Lock icon for bootstrap row, × on chips | Already imported in Toast.tsx, Sidebar.tsx |

**Installation:** No new dependencies. Zero new npm installs.

---

## Architecture Patterns

### Recommended Project Structure
```
packages/
├── server/
│   └── src/
│       └── index.ts           # Modify DELETE handler (~line 2059) + GET /api/users (~line 2026)
├── web/
│   └── src/
│       ├── App.tsx             # Add "users" to Page union + render branch + banner
│       ├── components/
│       │   └── UsersPage.tsx   # New page component
│       └── test/
│           └── seedAuthStore.ts  # Add seedUserAdminStore()
```

### Pattern 1: Page Union Extension (App.tsx)

**What:** Add `"users"` to the `type Page` union and a render branch in the JSX.

**Current state (App.tsx line 18):**
```typescript
type Page = "dashboards" | "datasets" | "settings";
```

**What to change:**
```typescript
type Page = "dashboards" | "datasets" | "settings" | "users";
```

The Sidebar at line 27 already emits `key: "users"` for "User Management". The `onSelect` handler at App.tsx line 206 does `setPage(key as Page)` — once `"users"` is in the union, TypeScript accepts it and the render branch handles it.

The OIDC `ReturnTo` restore block (lines 162–166) explicitly checks the page value against the union members. Add `parsed.page === "users"` to that conditional.

**Render branch** (after existing `page === "settings"` block):
```typescript
{page === "users" && <UsersPage />}
```

### Pattern 2: App-Shell Banner Mount

**What:** Session-dismissable banner above the page router, inside `.main` div, for users with `users:assign_roles`.

**App.tsx `.main` div structure (lines 210–217):**
```tsx
<div className="main">
  <Topbar />
  {/* Banner goes here — below Topbar, above page content */}
  {page === "dashboards" && <DashboardsPage ... />}
  {page === "datasets" && <DatasetsPage />}
  ...
</div>
```

**Banner state lives in App.tsx** as two `useState` values: `unassignedCount: number | null` (null = not yet fetched / dismissed) and `bannerDismissed: boolean`. Fetch once after auth using `useEffect` gated on `status === "authenticated" && hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES)`. Dismiss sets `bannerDismissed = true` (session-only — React state, not storage).

**Precedent class name from LoginPage:** `.login-banner` with `role="status"`. App-shell banner should use a new class (e.g. `.onboarding-banner`) styled similarly.

### Pattern 3: Click-Outside Popover (DataFilterRenderer pattern)

**Proven pattern from `DataFilterRenderer.tsx` lines 738–752:**
```typescript
const wrapRef = useRef<HTMLDivElement>(null);
const [open, setOpen] = useState(false);

useEffect(() => {
  if (!open) return;
  const handleMouseDown = (e: MouseEvent) => {
    if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  };
  document.addEventListener("mousedown", handleMouseDown);
  return () => document.removeEventListener("mousedown", handleMouseDown);
}, [open]);
```

Apply this pattern per-row (one `wrapRef` per row's Edit-roles popover). Since only one popover can be open at a time, a single `openPopoverUser: string | null` state at the page level (keyed by username) is cleaner than per-row state — close the previous popover when opening a new one.

### Pattern 4: Chip Styling Precedent

Existing badge/chip classes in the codebase: `.layer-row-badge` (from LayersModal). For role chips use `.role-chip` with modifier `.role-chip--default` for the muted analyst-default chip. This follows the existing `.layer-row-badge` naming convention.

Bootstrap lock indicator: use `faLock` from FontAwesome (already imported in other components). The row gets no Edit-roles button and the chip has no × — render conditionally on `user.is_bootstrap`.

### Pattern 5: SAFE-V18-01 Guard Location

**Exact file/line:** `packages/server/src/index.ts` line 2059 — `app.delete("/api/users/:username/roles/:roleName", ...)` handler. The deferral comment at line 2058 marks the exact insertion point.

**Guard logic:**
1. Look up the role being revoked — is it `"admin"`? If no, skip guard entirely.
2. If yes: count non-bootstrap users currently holding the admin role (AFTER the deletion would occur, i.e., count holders minus 1 if the target currently has admin).
3. If count would reach 0: return 400 with verbatim message (agreed format: `"Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role."`)
4. Otherwise: proceed with DELETE.

Bootstrap username: `(process.env.APP_ADMIN_USERNAME || "admin").toLowerCase()` — same pattern as `createAdminSession()` in test helpers.

### Anti-Patterns to Avoid

- **Client-side admin counting**: CONTEXT.md explicitly forbids this. The server is the single authority. The UI only surfaces the verbatim 400 error message.
- **Importing bootstrap username to the frontend**: Do not. The bootstrap flag (`is_bootstrap`) must come from the server in GET /api/users.
- **Page-level fetch on every render**: Use a single `useEffect` with the users list fetched once on page mount (with AbortController per the DynamicViewsModal 4-controller precedent for cleanup). Refetch after each assign/revoke to keep the list fresh.
- **Adding `"users"` to the `parsed.page` OIDC restore block without adding it to the Page union**: TypeScript will catch this if union is extended first.

---

## API Contract — Verified Source of Truth

### GET /api/users — CURRENT response shape (lines 2026–2044)

```typescript
// Response: { users: Array<{ username: string; roles: string[] }> }
// roles is [] (empty array) for users with no explicit assignments (not null)
```

**Gaps vs Phase 49 needs:**

| Field | Current state | Fix needed |
|-------|-------------|------------|
| `last_seen` | NOT returned | Extend SQL to LEFT JOIN known_users + include in map() |
| `is_bootstrap` | NOT returned | Add flag by comparing username to `APP_ADMIN_USERNAME` in map() |
| Unassigned users | Empty `roles: []` | Client derives "default analyst" from `roles.length === 0` |

**Extended SQL needed:**
```sql
SELECT ku.username,
       ku2.last_seen,
       json_group_array(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS roles
FROM (
  SELECT username FROM known_users
  UNION
  SELECT DISTINCT username FROM user_roles
) AS ku
LEFT JOIN known_users ku2 ON ku2.username = ku.username
LEFT JOIN user_roles ur ON ur.username = ku.username
LEFT JOIN roles r ON r.id = ur.role_id
GROUP BY ku.username
ORDER BY ku.username
```

**Extended TypeScript map:**
```typescript
const bootstrapUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
const users = rows.map((row) => ({
  username: row.username,
  roles: JSON.parse(row.roles) as string[],
  last_seen: row.last_seen ?? null,  // null for assigned-but-never-logged-in users
  is_bootstrap: row.username === bootstrapUsername,
}));
```

### POST /api/users/:username/roles — current (lines 2047–2055)

```typescript
// Request body: { roleName: string }
// Response 200: { ok: true, username: string, roleName: string }
// Response 400: { error: "roleName is required." }
// Response 404: { error: "Role '<name>' not found." }
// Uses INSERT OR IGNORE — idempotent; already-assigned is a no-op (200)
```

### DELETE /api/users/:username/roles/:roleName — current (lines 2059–2066)

```typescript
// Response 200: { ok: true, username: string, roleName: string }
// Response 404: { error: "Role '<name>' not found." }
// Currently idempotent (DELETE WHERE... — no error if row absent)
// SAFE-V18-01 guard to be added before the DELETE executes
```

**After SAFE-V18-01 guard, revoke-last-admin response:**
```typescript
// Response 400: { error: "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role." }
```

### GET /api/roles — current (lines 2069–2086)

```typescript
// Response: { roles: Array<{
//   id: number;
//   name: string;
//   description: string;
//   built_in: boolean;   // true for admin/user_admin/designer/analyst
//   permissions: string[];
// }> }
// Ordered by name. All 4 built-ins always present.
```

The `built_in` boolean is already in the response. The Edit-roles popover can mark built-in roles visually if desired, but this is Claude's discretion.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom alert system | `useToastStore.getState().showToast(msg, kind)` | Already exists; deduplication built in (5s window) |
| Auth store / permission check | New fetch or store | `useAuthStore(s => s.hasPermission)` | Phase 48 ships exactly this |
| Click-outside handling | Event delegation reinvention | `useRef + document.addEventListener("mousedown", ...)` as in DataFilterRenderer.tsx | Proven, zero deps |
| Relative time formatting | date-fns / dayjs | Hand-roll 8-line helper | CONTEXT.md decision; no new deps allowed |
| Role assignment API | Custom endpoint | POST/DELETE `/api/users/:username/roles` | Already exists and gated |

---

## Common Pitfalls

### Pitfall 1: GET /api/users missing `last_seen` and `is_bootstrap`
**What goes wrong:** Page renders without last-seen column and can't show the lock indicator on the bootstrap row.
**Why it happens:** The current endpoint only returns `username` and `roles`.
**How to avoid:** Server task must extend the SQL JOIN + TypeScript map BEFORE the frontend task that consumes the data.
**Warning signs:** TypeScript type mismatch when destructuring the response in UsersPage.tsx.

### Pitfall 2: Bootstrap username hardcoded on the client
**What goes wrong:** The `is_bootstrap` flag is derived in the frontend as `username === "admin"` — breaks when `APP_ADMIN_USERNAME` is set to something else.
**How to avoid:** Server adds `is_bootstrap` to the GET /api/users response. Frontend reads it from the response; never computes it.

### Pitfall 3: OIDC ReturnTo restore block doesn't include "users"
**What goes wrong:** After OIDC re-auth, users who were on the Users page get redirected to dashboards (the fallback) instead of returning to Users.
**How to avoid:** When extending `type Page`, also update the `parsed.page === "..."` conditional in the OIDC restore `useEffect` (App.tsx lines 162–166). Add `|| parsed.page === "users"`.

### Pitfall 4: SAFE-V18-01 guard counts the bootstrap admin
**What goes wrong:** The guard counts the bootstrap admin as an admin holder, allowing revocation of the last non-bootstrap admin (since the bootstrap "still holds admin"). This creates a locked-out state for non-bootstrap users.
**How to avoid:** The admin-holder count query MUST exclude the bootstrap username: `WHERE username != lower(?) AND role_id = adminRoleId`. Bootstrap is always exempt from the count.

### Pitfall 5: DELETE /api/users/:username/roles/:roleName idempotency vs SAFE-V18-01
**What goes wrong:** The current DELETE is idempotent (200 even if row absent). After adding the SAFE-V18-01 guard, if the target doesn't currently hold the admin role, the guard must NOT fire (nothing to revoke = no risk). Guard should only engage when `roleName === "admin"` and the target currently holds the admin role.
**How to avoid:** Check 1: is `roleName === "admin"`? If no, skip guard. Check 2: does the target currently hold admin? If no (row not in user_roles), skip guard. Then count remaining holders.

### Pitfall 6: Banner fetch blocks app bootstrap
**What goes wrong:** Fetching GET /api/users inside the bootstrap effect causes startup latency for all users.
**How to avoid:** Banner fetch fires in a separate `useEffect` gated on `status === "authenticated"` AND `hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES)`. This is a lazy background fetch, not part of the auth bootstrap chain.

### Pitfall 7: Stale popover state after assign/revoke
**What goes wrong:** User assigns a role via the popover; the chip list below the popover still shows the old state.
**How to avoid:** After each successful POST/DELETE, re-fetch GET /api/users (or update local state optimistically). Re-fetch is simpler and more correct given the server-authoritative model.

### Pitfall 8: Bulk assign to already-assigned users
**What goes wrong:** `INSERT OR IGNORE` already handles this on the server — no error. But the aggregate toast should account for partial failures (e.g., role not found). N individual POSTs means N `Promise.allSettled` — surface failures in the toast.
**How to avoid:** Use `Promise.allSettled` (not `Promise.all`) for bulk POSTs. Count fulfilled vs rejected for the aggregate toast message.

---

## Code Examples

### Humanized Relative-Time Helper (hand-rolled, no deps)
```typescript
// Source: CONTEXT.md decision — hand-roll, no date lib
export function humanizeRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
```

### SAFE-V18-01 Guard (server, DELETE handler)
```typescript
// Inside DELETE /api/users/:username/roles/:roleName handler
// After roleRow lookup, before the DELETE statement:
if (roleName === "admin") {
  const bootstrapUsername = (process.env.APP_ADMIN_USERNAME || "admin").toLowerCase();
  // Only engage if target currently holds admin
  const holdsAdmin = db.prepare(
    "SELECT 1 FROM user_roles WHERE username = lower(?) AND role_id = ?"
  ).get(target, roleRow.id);
  if (holdsAdmin) {
    // Count remaining admin holders excluding bootstrap
    const remaining = (db.prepare(
      "SELECT COUNT(*) as cnt FROM user_roles WHERE role_id = ? AND username != lower(?)"
    ).get(roleRow.id, bootstrapUsername) as { cnt: number }).cnt;
    if (remaining <= 1) {
      // remaining = 1 means target is the last one; after revoke it would be 0
      return res.status(400).json({
        error: "Cannot revoke: this is the last admin. At least one non-bootstrap user must hold the admin role."
      });
    }
  }
}
```

### Click-Outside Popover Pattern
```typescript
// Source: packages/web/src/components/charts/DataFilterRenderer.tsx lines 738-752
const [openPopoverUser, setOpenPopoverUser] = useState<string | null>(null);
const popoverRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!openPopoverUser) return;
  const handleMouseDown = (e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
      setOpenPopoverUser(null);
    }
  };
  document.addEventListener("mousedown", handleMouseDown);
  return () => document.removeEventListener("mousedown", handleMouseDown);
}, [openPopoverUser]);
```

### seedUserAdminStore helper (add to seedAuthStore.ts)
```typescript
// Source: packages/web/src/test/seedAuthStore.ts pattern
// user_admin permissions: USERS_VIEW + USERS_ASSIGN_ROLES + ROLES_VIEW +
//   ROLES_MANAGE_PERMISSIONS + ROLES_CREATE_CUSTOM + DASHBOARDS_VIEW
export function seedUserAdminStore(): void {
  useAuthStore.setState({
    status: "authenticated",
    user: {
      username: "testuseradmin",
      roles: ["user_admin"],
      permissions: [
        PERMISSIONS.USERS_VIEW,
        PERMISSIONS.USERS_ASSIGN_ROLES,
        PERMISSIONS.ROLES_VIEW,
        PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
        PERMISSIONS.ROLES_CREATE_CUSTOM,
        PERMISSIONS.DASHBOARDS_VIEW,
      ],
    },
  });
}
```

### App.tsx Banner Integration Point
```tsx
// Inside <div className="main"> in App.tsx, after <Topbar />, before page branches:
{unassignedBannerCount !== null && !bannerDismissed && (
  <div className="onboarding-banner" role="status">
    {unassignedBannerCount} user{unassignedBannerCount !== 1 ? "s are" : " is"} on the default analyst
    role —{" "}
    <button className="banner-link" onClick={() => setPage("users")}>
      Review in User Management
    </button>
    <button
      className="banner-dismiss"
      aria-label="Dismiss"
      onClick={() => setBannerDismissed(true)}
    >
      ×
    </button>
  </div>
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `/api/users` returns only `{ username, roles }` | Must be extended to include `last_seen` + `is_bootstrap` | Phase 49 (this phase) | Server task must precede frontend |
| SAFE-V18-01 is a deferral comment | Must be replaced with guard logic | Phase 49 (this phase) | DELETE handler has the exact insertion point |
| `type Page` = 3 members | Must be extended to 4 (add `"users"`) | Phase 49 (this phase) | Also update OIDC ReturnTo restore block |
| `seedAuthStore.ts` has 3 helpers | Must add `seedUserAdminStore()` | Phase 49 (this phase) | Required for gated-render specs |

---

## Open Questions

1. **Bootstrap admin not in known_users on a fresh install**
   - What we know: `known_users` is populated on successful login. If `APP_ADMIN_USERNAME` has never logged in, there is no row in `known_users` and no row in `user_roles`.
   - What's unclear: Should GET /api/users synthesize a bootstrap row even if the user has never appeared in either table?
   - Recommendation: Yes — synthesize it. The server should check `bootstrapUsername` and add it to the result set if absent, with `last_seen: null` and `roles: []` (displayed as locked admin with no last-seen). This ensures the row is always visible. Implementation: after building the `users` array, check if `bootstrapUsername` is in the list; if not, unshift it with the bootstrap flag set.

2. **Is `roles: []` an accurate "unassigned" signal after the UNION?**
   - What we know: The UNION includes known_users and user_roles. A user in known_users with no user_roles rows gets `roles: []` from the LEFT JOIN + json_group_array FILTER. This is confirmed by the routes.management.spec.ts test at line 74.
   - What's unclear: Nothing — confirmed behavior. Client can rely on `roles.length === 0` to show the default-analyst chip.

3. **Session-dismissable banner: React state vs sessionStorage**
   - What we know: CONTEXT.md says "session-dismissable (× hides until next login)". React `useState` is session-only (lost on reload), which matches the requirement.
   - Recommendation: React `useState` for `bannerDismissed` — no sessionStorage write needed. If the user refreshes, the banner reappears (which re-fetches GET /api/users anyway). This is the simplest correct implementation.

---

## Sources

### Primary (HIGH confidence — live source code)
- `packages/server/src/index.ts` lines 2022–2066 — GET /api/users, POST/DELETE role assignment handlers, SAFE-V18-01 deferral comments
- `packages/server/src/db.ts` lines 186–191 — known_users schema (username TEXT PK, first_seen TEXT, last_seen TEXT)
- `packages/web/src/App.tsx` lines 18, 202–220 — Page union (3 members), app-shell layout (`<div className="main"><Topbar />{page branches}</div>`)
- `packages/web/src/components/Sidebar.tsx` lines 23–29 — nav array, "User Management" key is `"users"`, gated on `PERMISSIONS.USERS_VIEW`
- `packages/web/src/components/charts/DataFilterRenderer.tsx` lines 735–752 — click-outside popover pattern (`wrapRef + document.addEventListener("mousedown")`)
- `packages/web/src/store/toast.ts` — `ToastKind = "permission" | "info" | "error"`, `showToast(message, kind?)` API
- `packages/web/src/store/auth.ts` — `hasPermission(perm: string)` reads `get().user?.permissions`; `setPermissions` in-place update
- `packages/web/src/test/seedAuthStore.ts` — 3 existing helpers; pattern for adding `seedUserAdminStore()`
- `packages/web/src/__mocks__/zustand.ts` — store-reset shim activated by `vi.mock("zustand")` in setup.ts
- `packages/web/src/test/setup.ts` — `vi.mock("zustand")` + `afterEach cleanup + sessionStorage.clear()`
- `packages/server/tests/routes.management.spec.ts` — `createAnalystSession` pattern; beforeEach cleanup of sessions/known_users/user_roles/custom-roles
- `packages/server/src/lib/permissions.ts` — `PERMISSIONS.USERS_VIEW`, `USERS_ASSIGN_ROLES`; `user_admin` default mappings (5 permissions + dashboards:view)
- `packages/web/src/components/LoginPage.tsx` lines 22–24 — `.login-banner` with `role="status"` is the closest banner precedent
- `.planning/phases/47-server-middleware-route-guards/47-VERIFICATION.md` — confirmed GET /api/users is at line 2022; confirmed SAFE-V18-01 deferral at lines 2011, 2058

---

## Metadata

**Confidence breakdown:**
- Server API shapes: HIGH — read from live source, confirmed by verification report and spec file
- App.tsx integration points: HIGH — read from live source, exact line numbers
- Popover pattern: HIGH — live DataFilterRenderer.tsx code, copy-exact
- SAFE-V18-01 guard logic: HIGH — exact insertion point confirmed; guard algorithm is straightforward SQLite query
- last_seen / is_bootstrap gap: HIGH — confirmed by reading the SQL; confirmed missing from current response

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable codebase; all sources are project-internal)
