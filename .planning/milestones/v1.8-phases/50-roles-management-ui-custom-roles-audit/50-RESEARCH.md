# Phase 50: Roles Management UI + Custom Roles + Audit — Research

**Researched:** 2026-06-06
**Domain:** RBAC role management — server escalation guards, audit log extension, React two-pane page
**Confidence:** HIGH (all findings directly from live code; zero unverified claims)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Layout:** Two-pane PAGE (not modal). Left: role list with built-ins badged `[built-in]`, custom roles with trash delete, `[+ New role]` at bottom. Right: selected role name/badge + 16 permission checkboxes grouped by category (Dashboards / Design / Users / Roles / Audit) derived from noun: prefix.
- **Edit semantics:** Draft + Save. Checkbox toggles stage locally; one `PUT /api/roles/:id/permissions` sends the full set. Built-in role Save shows a confirm ("Changes affect all users with the <role> role — save?"). Dirty-state guard on role switch and page leave.
- **Custom role creation:** Inline — `[+ New role]` adds editable name row; detail pane opens with all 16 unchecked. Name rules: lowercase slug (letters/digits/underscore), unique case-insensitive, built-in names reserved. Client validates; server validates authoritatively (verbatim 400 surfaced).
- **Audit (AUDIT-V18-01):** Every role mutation (assign, revoke, mapping save, role create, role delete) emits BOTH an OBS-01 JSON log line AND a row in `rbac_audit` table: `(id, ts, actor, action, target, before_json, after_json)`. Actions enum: `role_assigned`, `role_revoked`, `mappings_updated`, `role_created`, `role_deleted` (Claude's discretion on exact strings but consistent). Phase 49's assign/revoke handlers gain audit emission in this phase.
- **Escalation guards (SAFE-V18-02):** Three server-authoritative guards:
  1. Non-admin cannot assign the admin role (`POST /api/users/:username/roles {role: admin}` → 403)
  2. Non-admin cannot edit the admin role's mappings (`PUT /api/roles/<admin-id>/permissions` → 403)
  3. Non-admin cannot grant a custom role permissions they do not themselves hold (403, verbatim message naming the permission)
  "Non-admin" = caller does not hold the admin ROLE (not just admin permissions). Bootstrap admin and explicit admin-role holders exempt from all three.
- **UI mirrors (UX only, server is authority):**
  - Admin role visible but read-only + lock for user admins; disabled checkboxes + "Only admins can modify the admin role."
  - Unheld permissions render disabled with tooltip "You can only grant permissions you hold." (disabled-not-hidden to keep matrix consistent)
  - Users page popover/bulk dropdown hides the admin role for non-admin editors (Phase 49 retrofit)

### Claude's Discretion

- Component naming (RolesPage.tsx), CSS conventions
- Confirm implementation (window.confirm vs inline — window.confirm is precedented by DynamicViewsModal)
- Audit helper module shape (emitRbacAudit(db, {...}) writing both log + row)
- Exact action-enum strings; rbac_audit indexes
- Page union value ("roles") and App.tsx wiring (mirror Phase 49's exactly, incl. OIDC ReturnTo)
- Whether GET /api/roles needs a holders-count field for the delete-blocked UX (add if trivial)

### Deferred Ideas (OUT OF SCOPE)

- Audit log viewer UI — v1.9 (AUDIT-V19-01)
- Custom-role duplication — v1.9 (ROLES-V19-01)
- Per-role "reset to defaults" — v1.9
- Role descriptions/display-names — not requested
- Embeddable/public dashboards via embed identity — backlog
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ROLES-V18-01 | Roles page shows built-in + custom roles with role × permission matrix | GET /api/roles response shape confirmed; RoleDto type already in client.ts; category grouping from noun: prefix in PERMISSIONS catalog |
| ROLES-V18-02 | Role→permission mappings editable for ALL roles including built-ins; built-in edit shows warning | PUT /api/roles/:id/permissions is full-set replace, validates against catalog, no built-in block; dirty-confirm pattern from DynamicViewsModal |
| ROLES-V18-03 | User admin can create custom roles composing any subset of the permission catalog | POST /api/roles confirmed shape; name uniqueness 409; inline create pattern needed |
| ROLES-V18-04 | Custom roles deletable only when no users hold them; built-in roles undeletable/unrenameable | DELETE /api/roles/:id: built-in block exists (400); held-role block MISSING — gap that Phase 50 must fill |
| SAFE-V18-02 | Escalation guards: non-admin cannot assign admin role, edit admin mappings, or grant unheld permissions | All three guards MISSING from live code (deferral comments at index.ts:2016, :2174, :2182); caller identity via req.user!.creds.username; admin-role check via getEffectiveRoles() |
| AUDIT-V18-01 | Role assignment/revocation and mapping edits emit structured audit-log entries (OBS-01 + rbac_audit table) | OBS-01 shape confirmed from rbac.ts; rbac_audit table does NOT yet exist in SCHEMA_DDL; 5 mutation handlers need emission added |
</phase_requirements>

---

## Summary

Phase 50 adds the Roles page (role × permission matrix editor, custom role CRUD), three server escalation guards (SAFE-V18-02), and a structured audit trail (AUDIT-V18-01) extending the existing OBS-01 JSON log into a new `rbac_audit` SQLite table. All required server primitives exist from Phases 46–49: GET/POST/PUT/DELETE role routes, `getEffectiveRoles`, `requirePermission`, `RoleDto` type, and the OBS-01 console.log pattern. Three gaps must be filled: (1) held-role check on DELETE /api/roles/:id, (2) all three SAFE-V18-02 guards, and (3) rbac_audit table + emission in 5 mutation handlers.

The frontend is a new `RolesPage.tsx` page component (not a modal) wired into App.tsx following the Phase 49 pattern exactly. The dirty-state confirm is `window.confirm("Discard unsaved changes?")` — the DynamicViewsModal precedent. The UsersPage popover gets one small retrofit: filter the admin role from the role list for callers who lack the admin role, using `useAuthStore.user.roles.includes("admin")`.

The test story requires a new `createUserAdminSession()` server helper seeding explicit `user_roles` rows — the `createAdminSession()` bootstrap short-circuit cannot exercise non-admin paths.

**Primary recommendation:** Structure as 3 waves: (50-01) server guards + held-role gap + rbac_audit table + emission helper + 5 handler audits; (50-02) RolesPage component + client API wrappers + seedRolesAdminStore helper; (50-03) App.tsx wiring + UsersPage popover retrofit.

---

## Standard Stack

### Core (no new dependencies — project locked decision)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | rbac_audit DDL + row inserts | Already the sole DB layer; synchronous API matches the no-async-permission-check contract |
| React + Zustand | existing | RolesPage component state | All management pages use this pattern |
| FontAwesome | existing | Lock icon (faLock), trash icon (faTrash) — confirmed in UsersPage.tsx imports | Consistent with existing icon system |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| clsx | existing | Conditional className for disabled/locked states | Used in UsersPage.tsx; same pattern for RolesPage |

**Installation:** No new packages. Zero new npm dependencies — project-locked decision.

---

## Architecture Patterns

### Recommended Project Structure

New files this phase:

```
packages/server/src/
├── lib/
│   └── rbacAudit.ts          # emitRbacAudit helper (writes OBS-01 log + rbac_audit row)
└── (db.ts extended — rbac_audit table in SCHEMA_DDL)
└── (index.ts extended — 3 guards + 5 audit emission points)

packages/web/src/
├── components/
│   └── RolesPage.tsx         # New page component (two-pane layout)
│   └── RolesPage.spec.tsx    # Vitest + testing-library spec
└── api/
    └── client.ts             # Extended: listRoles already exists; add createRole, deleteRole, updateRolePermissions
```

### Pattern 1: Caller Identity for Guards

The caller's username is accessed as `req.user!.creds.username` inside any handler that follows `...requirePermission(...)`. The `requirePermission` factory (rbac.ts) chains `requireAuth` as element 0, which populates `req.user`. This is confirmed at index.ts:2019 and rbac.ts:47.

To determine "does caller hold the admin role" (the gate for all three SAFE-V18-02 guards):

```typescript
// Source: packages/server/src/lib/rbacDb.ts lines 112-136 + index.ts:2019
const callerRoles = getEffectiveRoles(req.user!.creds.username);
const callerIsAdmin = callerRoles.includes("admin");
```

`getEffectiveRoles` handles the bootstrap short-circuit (returns `["admin"]` for the bootstrap user), so bootstrap admins pass all three guards automatically. For a user_admin caller with explicit `user_roles` rows, `getEffectiveRoles` returns `["user_admin"]` — not including admin — and the guard fires.

Note: `getEffectiveRoles` is NOT currently imported in `index.ts`. Only `getEffectiveRolesAndPermissions` is imported at line 105. The Phase 50 server plan must add `getEffectiveRoles` to that import.

### Pattern 2: OBS-01 Audit Log Shape

The existing OBS-01 pattern (from rbac.ts:51-68) uses `console.log(JSON.stringify({...}))` with fields `{ ts, level, event, ... }`. The rbac_audit helper should mirror this exactly:

```typescript
// Source: packages/server/src/rbac.ts lines 51-68 (permission_denied log shape)
// rbacAudit.ts — emit BOTH log line AND SQLite row
export function emitRbacAudit(db: Database, entry: {
  actor: string;
  action: "role_assigned" | "role_revoked" | "mappings_updated" | "role_created" | "role_deleted";
  target: string;
  before_json: string | null;
  after_json: string | null;
}): void {
  const ts = new Date().toISOString();
  // OBS-01 JSON log line (jq-searchable)
  console.log(JSON.stringify({ ts, level: "info", event: "rbac_audit", ...entry }));
  // SQLite row
  db.prepare(
    "INSERT INTO rbac_audit (ts, actor, action, target, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(ts, entry.actor, entry.action, entry.target, entry.before_json, entry.after_json);
}
```

### Pattern 3: PUT /api/roles/:id/permissions — Full-Set Replace Semantics

Confirmed at index.ts:2164-2168: DELETE all existing role_permissions for roleId, then INSERT the new set. The before_json for audit is the old permissions array captured BEFORE the DELETE.

### Pattern 4: GET /api/roles — Current Response Shape (no holders count)

Confirmed at index.ts:2101-2119. Response:
```typescript
{ roles: Array<{ id: number; name: string; description: string; built_in: boolean; permissions: string[] }> }
```

**No holders count is returned.** For the delete-UX, the server can add a `SELECT COUNT(*) FROM user_roles WHERE role_id = ?` check inline in the DELETE handler (trivial, same pattern as SAFE-V18-01's COUNT query). Alternatively, GET /api/roles can be extended with a `holders_count: number` field — Claude's discretion. Recommendation: add the count check server-side inside DELETE only (less surface area), return 409 with a clear message when holders > 0.

### Pattern 5: POST /api/roles — Name Validation Gap

The current POST /api/roles (index.ts:2122-2148) validates:
- name is required (400)
- permissions is an array (400)
- name already exists (409)

**Missing validations that Phase 50 must add (per CONTEXT.md locked decisions):**
- Lowercase slug format: must match `/^[a-z0-9_]+$/` (letters/digits/underscore)
- Built-in name reservation: must not be one of `["admin", "user_admin", "designer", "analyst"]`
- Case-insensitive uniqueness: SQLite's `UNIQUE` constraint on `roles.name` is case-sensitive by default; existing check `SELECT id FROM roles WHERE name = ?` is case-sensitive. Add `WHERE lower(name) = lower(?)` or normalize to lowercase before insert.

### Pattern 6: DynamicViewsModal Dirty-State Confirm

Confirmed at DynamicViewsModal.tsx:226-232:
```typescript
// Source: packages/web/src/components/DynamicViewsModal.tsx lines 226-232
const handleCloseRequest = () => {
  if (isDirty) {
    const ok = window.confirm("Discard unsaved changes?");
    if (!ok) return;
  }
  onClose();
};
```
RolesPage uses `window.confirm` for both the role-switch-with-dirty guard and the built-in-save confirm. This is the established precedent.

### Pattern 7: App.tsx Page Union Wiring (Phase 49 Precedent)

Confirmed at App.tsx:20 and lines 168-174, 253:
```typescript
// Source: packages/web/src/App.tsx lines 20, 170-173, 253
type Page = "dashboards" | "datasets" | "settings" | "users";
// Phase 50 adds "roles" to this union

// OIDC ReturnTo guard (App.tsx:168-173):
if (parsed.page === "dashboards" || parsed.page === "datasets" ||
    parsed.page === "settings" || parsed.page === "users") {
  setPage(parsed.page);
}
// Phase 50 adds || parsed.page === "roles"

// Render branch (App.tsx:253):
{page === "users" && <UsersPage />}
// Phase 50 adds:
{page === "roles" && <RolesPage />}
```

### Pattern 8: Category Grouping from noun: Prefix

The PERMISSIONS catalog (packages/server/src/lib/permissions.ts) uses `"noun:verb"` format. Grouping algorithm: split each permission string on `:`, take the noun as the group key. Confirmed mapping:
- `"dashboards"` → Dashboards group: view, create, edit, delete
- `"widgets"` → Design group: configure
- `"layers"` → Design group: manage
- `"dynamic_views"` → Design group: manage
- `"data_filters"` → Design group: configure
- `"datasets"` → Design group: manage
- `"users"` → Users group: view, assign_roles
- `"roles"` → Roles group: view, manage_permissions, create_custom, delete_custom
- `"audit"` → Audit group: view

The CONTEXT.md groups "Design" as widgets + layers + dynamic_views + data_filters + datasets (5 items). This is not derivable from the noun prefix alone — `widgets` and `datasets` are separate nouns. The planner should hardcode the 5-noun Design grouping or define a `NOUN_TO_GROUP` mapping constant. **This is a gap: pure noun-prefix grouping gives 7 groups, not 5.** The CONTEXT.md says "derive grouping from the noun: prefix" but the approved sketch groups `widgets/layers/dynamic_views/data_filters/datasets` all under "Design". Use a mapping constant in RolesPage.tsx.

### Pattern 9: createUserAdminSession Server Test Helper

`createAdminSession` (tests/helpers/db.ts:13-19) uses the bootstrap short-circuit (no user_roles row). For SAFE-V18-02 escalation guard tests, a session whose username has an explicit `user_roles` row for `user_admin` role is needed.

**No createUserAdminSession helper exists yet.** Must be built in the 50-01 server plan:
```typescript
// Pattern mirrors createAnalystSession in routes.management.spec.ts:34-43
const createUserAdminSession = (username = "test_user_admin") => {
  const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'user_admin'").get() as { id: number };
  db.prepare("INSERT OR IGNORE INTO user_roles (username, role_id) VALUES (lower(?), ?)").run(username, roleRow.id);
  const sid = createSession({ username, secret: "useradmin-test-secret", kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { cookie: `kbi_session=${token}` };
};
```
This helper seeds an explicit user_roles row so `getEffectiveRoles(username)` returns `["user_admin"]` (not `["analyst"]` fallback, not bootstrap admin short-circuit).

### Anti-Patterns to Avoid

- **Using createAdminSession for escalation guard tests:** The bootstrap short-circuit in `getEffectiveRoles` returns `["admin"]` unconditionally for APP_ADMIN_USERNAME. The SAFE-V18-02 guards must fire ONLY for non-admin callers. Tests must use a `createUserAdminSession` helper with explicit user_roles row.
- **Checking permissions instead of roles for guard:** Guard 1 and Guard 2 check whether the caller holds the admin ROLE (not whether they have a specific permission). `getEffectiveRoles(username).includes("admin")` is the correct predicate, not `getEffectivePermissions(username).has("roles:manage_permissions")`. An operator could in theory grant admin-level permissions to a non-admin role; the guard is role-based per CONTEXT.md.
- **Case-sensitive name uniqueness in POST /api/roles:** The existing `SELECT id FROM roles WHERE name = ?` is case-sensitive. Add a `lower()` normalize before insert AND in the uniqueness check to match CONTEXT.md "unique (case-insensitive)" requirement.
- **Grouping by noun prefix naively:** `widgets:configure` and `datasets:manage` would form their own 1-item groups with naive noun splitting. Use a `NOUN_TO_GROUP` constant in RolesPage.tsx.
- **Forgetting to import getEffectiveRoles in index.ts:** Currently only `getEffectiveRolesAndPermissions` and `getAppAdminUsername` are imported from rbacDb. Phase 50 must extend the import.
- **Emitting audit AFTER the mutation can fail:** Capture before_json BEFORE the mutation, emit after_json only when mutation succeeds (transaction or sequential logic). If the INSERT fails, no audit row is emitted — this is acceptable (the log line can still be emitted on error for observability).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-request permission sync | Cache layer, session refresh | getEffectivePermissions synchronous read (already exists) | Sub-millisecond SQLite read; no async plumbing needed |
| Role-name slug validation | Custom regex engine | `/^[a-z0-9_]+$/` test + `BUILTIN_ROLES.includes()` check | One-liner; server validates authoritatively |
| Audit schema migration | Separate migration runner | Append `CREATE TABLE IF NOT EXISTS rbac_audit` to SCHEMA_DDL in db.ts | Established idempotent pattern; all v1.8 tables use this approach |
| Dirty-state "unsaved changes" modal | Custom modal component | `window.confirm()` | Established precedent from DynamicViewsModal.tsx:228 |

---

## Common Pitfalls

### Pitfall 1: Guard Bypassed by Bootstrap Short-Circuit in Tests

**What goes wrong:** Test uses `createAdminSession()` to verify that a user_admin caller is blocked by an escalation guard. But `createAdminSession()` uses `APP_ADMIN_USERNAME` which short-circuits `getEffectiveRoles` to `["admin"]` — so the guard never fires. Test always passes even if the guard is broken.

**Root cause:** `createAdminSession` was designed for "authorized admin caller" scenarios; it bypasses all DB role lookups by design (GUARD-V18-05 requirement from Phase 47).

**How to avoid:** Use `createUserAdminSession` (seeding explicit user_roles row) for escalation guard tests. Use `createAdminSession` only for tests where the caller SHOULD pass the guard.

**Warning signs:** An escalation guard test that uses `createAdminSession` and expects a 403 — it will always get 200/201.

### Pitfall 2: rbac_audit Table Missing from SCHEMA_DDL

**What goes wrong:** `emitRbacAudit` calls `db.prepare("INSERT INTO rbac_audit ...")` but the table was never created — crashes on first audit emission in production.

**Root cause:** Forgetting that ALL schema must be in `SCHEMA_DDL` in db.ts, not in a separate migration.

**How to avoid:** Add `CREATE TABLE IF NOT EXISTS rbac_audit (...)` to SCHEMA_DDL in db.ts. Verify with a migration spec test (same pattern as `db.rbacMigration.spec.ts`).

**Warning signs:** `no such table: rbac_audit` error in server log after first role mutation.

### Pitfall 3: Permission Grouping Inconsistency Between Matrix and Catalog

**What goes wrong:** A new permission is added to the catalog but the `NOUN_TO_GROUP` map in RolesPage.tsx is not updated — the checkbox renders without a group header, or is silently dropped.

**Root cause:** Hard-coded group map diverges from the catalog.

**How to avoid:** In RolesPage.tsx, assert at render-time that every PERMISSIONS value has a group mapping — render ungrouped checkboxes under an "Other" fallback rather than dropping them silently.

### Pitfall 4: SAFE-V18-02 Guard 3 — Before Catalog Validation

**What goes wrong:** Guard 3 (caller cannot grant permissions they don't hold) is checked BEFORE the catalog validation. An invalid permission string would produce a misleading 403 ("you don't hold unknown:foo") rather than the correct 400 ("unknown permission").

**Root cause:** Guard ordering in PUT /api/roles/:id/permissions handler.

**How to avoid:** Run catalog validation FIRST (400 for unknown permissions — already exists at index.ts:2159-2163), THEN run the escalation guard (403 for unheld permissions).

### Pitfall 5: Held-Role Delete Block Must Use a COUNT Query, Not CASCADE

**What goes wrong:** Deleting a custom role that users still hold without blocking — SQLite ON DELETE CASCADE in `user_roles` would silently remove the user's role assignment. But if the block check is omitted, users lose roles without any error.

**Root cause:** The CONTEXT.md says "server already blocks held-role deletion (Phase 47 basic validation + verify; strengthen if gaps)" — but reading the live code (index.ts:2182), the held-role check comment says "deferred to Phase 50."

**How to avoid:** Add `SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = ?` before the DELETE; return 409 (or 400) when cnt > 0. The message should name the count: "Cannot delete: N users currently hold this role."

---

## Code Examples

### Guard 3 Implementation Template

```typescript
// Source: derived from index.ts:2150-2171 (PUT /api/roles/:id/permissions handler)
// Add AFTER catalog validation, BEFORE the DELETE+INSERT mutation
app.put("/api/roles/:id/permissions", ...requirePermission(PERMISSIONS.ROLES_MANAGE_PERMISSIONS), (req, res) => {
  const roleId = Number(req.params.id);
  // ... existing validation (roleId, roleRow lookup, newPerms array, catalog check) ...

  // SAFE-V18-02 Guard 2: non-admin cannot edit the admin role's mappings
  const actor = req.user!.creds.username;                          // caller identity (index.ts:2019 pattern)
  const callerRoles = getEffectiveRoles(actor);                   // must add getEffectiveRoles to import
  const callerIsAdmin = callerRoles.includes("admin");
  if (!callerIsAdmin && roleRow.name === "admin") {
    return res.status(403).json({ error: "Only admins can edit the admin role's permissions." });
  }

  // SAFE-V18-02 Guard 3: non-admin cannot grant unheld permissions
  if (!callerIsAdmin) {
    const callerPerms = getEffectivePermissions(actor);           // getEffectivePermissions already imported via rbac.ts
    const unheld = newPerms.filter((p) => !callerPerms.has(p as Permission));
    if (unheld.length > 0) {
      return res.status(403).json({ error: `Cannot grant permissions you do not hold: ${unheld.join(", ")}` });
    }
  }

  // ... existing DELETE + INSERT logic ...
});
```

### SCHEMA_DDL rbac_audit Addition

```sql
-- Source: db.ts SCHEMA_DDL pattern (existing v1.8 tables at db.ts:132-164)
CREATE TABLE IF NOT EXISTS rbac_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_ts ON rbac_audit (ts);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit (actor);
```

### RolesPage Dirty-Guard on Role Switch

```typescript
// Source: DynamicViewsModal.tsx:226-232 (window.confirm pattern)
const handleSelectRole = (roleId: number) => {
  if (isDirty) {
    const ok = window.confirm("Discard unsaved changes?");
    if (!ok) return;
  }
  setSelectedRoleId(roleId);
  // reset draft state
};
```

### Audit Emission in Assign/Revoke Handlers (Phase 49 Retrofit)

```typescript
// Source: index.ts:2064-2065 (POST /api/users/:username/roles handler, after successful INSERT)
// Before the INSERT, capture before: empty array or existing roles
// After the INSERT, capture after: new role list
emitRbacAudit(db, {
  actor: req.user!.creds.username,
  action: "role_assigned",
  target: target,
  before_json: JSON.stringify(beforeRoles),
  after_json: JSON.stringify(afterRoles),
});
```

### seedUserAdminStore for Frontend Tests (already exists)

```typescript
// Source: packages/web/src/test/seedAuthStore.ts lines 79-95 — already complete
// seedUserAdminStore() seeds: USERS_VIEW, USERS_ASSIGN_ROLES, ROLES_VIEW,
// ROLES_MANAGE_PERMISSIONS, ROLES_CREATE_CUSTOM, DASHBOARDS_VIEW
// Does NOT include ROLES_DELETE_CUSTOM (admin only by default)
```

For RolesPage guard-UX specs needing "admin caller" state, use `seedAdminStore()` (already in seedAuthStore.ts:62-71 with all 16 permissions).

A `seedRolesAdminStore()` is NOT needed — `seedUserAdminStore()` already covers the user_admin case and `seedAdminStore()` covers the full-admin case.

---

## State of the Art (What Phases 46-49 Shipped)

| Item | Current State | Phase 50 Change |
|------|--------------|-----------------|
| GET /api/roles | Returns `{ id, name, description, built_in, permissions[] }` — no holders_count | Add holders_count inline or add COUNT check in DELETE only |
| POST /api/roles | Name required + array required + 409 duplicate | Add slug validation + case-insensitive uniqueness + built-in name reservation |
| PUT /api/roles/:id/permissions | Full-set replace + catalog validation | Add SAFE-V18-02 Guards 2 + 3 + audit emission |
| DELETE /api/roles/:id | Blocks built-in (400) | Add held-role block (COUNT > 0 → 409) + audit emission |
| POST /api/users/:username/roles | Assigns role | Add SAFE-V18-02 Guard 1 (admin role block for non-admins) + audit emission |
| DELETE /api/users/:username/roles/:roleName | Revokes role + SAFE-V18-01 | Add audit emission |
| rbac_audit table | Does NOT exist | Add to SCHEMA_DDL in db.ts |
| RolesPage component | Does not exist | New RolesPage.tsx + spec |
| App.tsx Page union | `"dashboards" \| "datasets" \| "settings" \| "users"` | Add `"roles"` + render branch + OIDC ReturnTo case |
| UsersPage popover roles list | Shows ALL roles to ALL editors | Filter admin role out for non-admin editors (small retrofit) |
| seedUserAdminStore | Exists in seedAuthStore.ts | Reused for RolesPage guard-UX specs |
| createUserAdminSession (server) | Does NOT exist | New helper in routes.management.spec.ts or helpers/db.ts |

---

## Open Questions

1. **Should rbac_audit table rows be surfaced in GET /api/roles or a new GET /api/audit endpoint?**
   - What we know: AUDIT-V19-01 (viewer UI) is deferred to v1.9. The table accumulates from v1.8 day one.
   - What's unclear: Does Phase 50 need any GET endpoint for the audit log? CONTEXT.md says "No viewer in v1.8."
   - Recommendation: No GET endpoint in Phase 50. Table only. Phase 51 verification checks the log lines, not the table rows.

2. **Holders count: extend GET /api/roles response or check only in DELETE handler?**
   - What we know: CONTEXT.md says "add if trivial" under Claude's Discretion.
   - What's unclear: Whether the RolesPage delete UX needs to pre-display a "N users hold this role" count (helpful) or just show an error after clicking delete (simpler).
   - Recommendation: Add `holders_count` to GET /api/roles response — one extra `SELECT COUNT(*)` per role at list time. This enables the UI to show a disabled trash icon with a tooltip, matching the locked CONTEXT.md sketch.

3. **UsersPage popover admin-role filter: use user.roles or a separate ROLES_MANAGE permission?**
   - What we know: `useAuthStore.user.roles` contains the caller's role names (from /me); `seedUserAdminStore` does NOT include admin in roles array. The check is `user.roles.includes("admin")`.
   - Recommendation: Use `useAuthStore((s) => s.user?.roles ?? []).includes("admin")` — matches server guard semantics exactly.

---

## Critical Implementation Gaps (Summary)

These are items the live code DOES NOT currently have but CONTEXT.md requires:

| Gap | Location | What's Missing |
|-----|----------|----------------|
| G1 | index.ts DELETE /api/roles/:id | Held-role COUNT check before deletion (SAFE-V18-02 comment at line 2182) |
| G2 | index.ts POST /api/users/:username/roles | SAFE-V18-02 Guard 1: block admin role assign for non-admins (comment at line 2016) |
| G3 | index.ts PUT /api/roles/:id/permissions | SAFE-V18-02 Guard 2: block admin mapping edits for non-admins (comment at line 2174) |
| G4 | index.ts PUT /api/roles/:id/permissions | SAFE-V18-02 Guard 3: block unheld permission grants for non-admins (comment at line 2174) |
| G5 | db.ts SCHEMA_DDL | rbac_audit table creation |
| G6 | index.ts POST /api/roles | Slug format validation + case-insensitive uniqueness + built-in name reservation |
| G7 | All 5 mutation handlers | Audit emission (assign, revoke, mappings PUT, role POST, role DELETE) |
| G8 | App.tsx | "roles" Page union value + render branch + OIDC ReturnTo |
| G9 | components/ | RolesPage.tsx component |
| G10 | tests/helpers/ or spec file | createUserAdminSession server test helper |
| G11 | index.ts imports | `getEffectiveRoles` added to rbacDb import |

---

## Sources

### Primary (HIGH confidence — live code, directly read)

- `packages/server/src/index.ts` lines 2010-2185 — 7 management route handlers, SAFE-V18-02 deferral comments, actor identity pattern
- `packages/server/src/lib/rbacDb.ts` — getEffectiveRoles / getEffectivePermissions / isBootstrapAdmin full implementation
- `packages/server/src/rbac.ts` — requirePermission factory, OBS-01 log shape
- `packages/server/src/db.ts` lines 132-191 — SCHEMA_DDL RBAC tables (no rbac_audit yet)
- `packages/server/src/lib/permissions.ts` — 16-item catalog, DEFAULT_ROLE_MAPPINGS, ALL_PERMISSIONS
- `packages/web/src/lib/permissions.ts` — frontend mirror, confirmed byte-parity
- `packages/web/src/components/UsersPage.tsx` — popover implementation, admin role display (no current filter for non-admins)
- `packages/web/src/components/DynamicViewsModal.tsx` lines 226-232 — dirty-state window.confirm precedent
- `packages/web/src/App.tsx` — Page union "users", ReturnTo guard lines 168-173, render branch line 253
- `packages/web/src/api/client.ts` lines 1180-1242 — RoleDto, UserRow, listRoles, assignRole, revokeRole
- `packages/web/src/store/auth.ts` — AuthUser shape (roles + permissions), hasPermission selector
- `packages/web/src/test/seedAuthStore.ts` — seedUserAdminStore, seedAdminStore confirmed
- `packages/server/tests/helpers/db.ts` — createAdminSession confirmed; NO createUserAdminSession exists
- `packages/server/tests/routes.management.spec.ts` — createAnalystSession pattern (template for createUserAdminSession)
- `.planning/phases/49-users-management-ui/49-VERIFICATION.md` — confirmed all Phase 49 artifacts shipped and wired

### Secondary (HIGH confidence — planning documents)

- `.planning/phases/50-roles-management-ui-custom-roles-audit/50-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — ROLES-V18-01..04, SAFE-V18-02, AUDIT-V18-01 exact text
- `.planning/ROADMAP.md` Phase 50 — 6 success criteria
- `.planning/STATE.md` — v1.8 architecture decisions, no-new-npm-deps lock

---

## Metadata

**Confidence breakdown:**
- Server route gaps (G1-G7, G11): HIGH — confirmed by reading live code
- Frontend component patterns: HIGH — confirmed from UsersPage.tsx, DynamicViewsModal.tsx, App.tsx
- Test helper gap (G10): HIGH — confirmed absence in tests/helpers/db.ts
- rbac_audit schema: HIGH — confirmed absence in SCHEMA_DDL
- Grouping algorithm gap (Design group): HIGH — confirmed by reading PERMISSIONS catalog

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (stable codebase; changes only from Phase 50 implementation itself)

---

**nyquist_validation:** Skipped per config.json `workflow.nyquist_validation: false`.
