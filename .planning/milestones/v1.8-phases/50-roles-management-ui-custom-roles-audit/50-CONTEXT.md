# Phase 50: Roles Management UI + Custom Roles + Audit - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The Roles page (role × permission mapping editor + custom role create/delete), SAFE-V18-02 escalation guards on the role-management routes, and AUDIT-V18-01 structured audit of role changes. Mounts behind the `roles:view`-gated nav item. The Users page (Phase 49) gets one small retrofit (hide admin role in assign popover for non-admins). Milestone verification is Phase 51.

</domain>

<decisions>
## Implementation Decisions

### Layout: role list + detail editor (two-pane)
- Left pane: roles list — built-ins badged `[built-in]`, custom roles deletable (trash), `[+ New role]` at bottom. Right pane: selected role's name/badge + **16 permission checkboxes grouped by category** (Dashboards / Design / Users / Roles / Audit — derive grouping from the `noun:` prefix).
- Mirrors the LayersModal/DynamicViewsModal two-pane idiom (but as a PAGE like UsersPage, not a modal).
- Approved sketch:
```
ROLES              │  designer  [built-in]
▸ admin [built-in]🔒│  Dashboards
▸ designer ◀       │   ☑ view ☑ create ☑ edit ☑ delete
▸ user_admin       │  Design
▸ analyst          │   ☑ widgets ☑ layers ☑ dynamic_views ☑ data_filters ☑ datasets
▸ regional_viewer  │  Users / Roles / Audit
[+ New role]       │   ☐ ...
                   │  [Save]
```

### Edit semantics: draft + Save
- Checkbox toggles stage locally; **[Save] sends ONE `PUT /api/roles/:id/permissions`** with the full set (route already takes full-set semantics).
- **Built-in role Save shows a confirm**: "Changes affect all users with the <role> role — save?" (window.confirm acceptable per DynamicViewsModal precedent, or inline confirm — Claude's discretion).
- **Dirty-state guard** when switching roles / leaving with unsaved changes (mirrors DynamicViewsModal dirty-close confirm).
- Custom role delete: confirm; server already blocks built-in deletion and held-role deletion (Phase 47 basic validation + verify; strengthen if gaps).

### Custom role creation
- **Inline create**: `[+ New role]` adds an editable name row; detail pane opens with **all 16 unchecked** (no implicit baseline).
- Name rules: **lowercase slug** — letters/digits/underscore, unique (case-insensitive), built-in names reserved. Client validates; server validates authoritatively (verbatim 400 surfaced).

### Audit (AUDIT-V18-01): log + SQLite
- Every role mutation (assign, revoke, mapping save, role create, role delete) emits **BOTH**: an OBS-1 JSON log line AND a row in a new **`rbac_audit`** table: `(id, ts, actor, action, target, before_json, after_json)`.
- Actions enum (suggested): `role_assigned`, `role_revoked`, `mappings_updated`, `role_created`, `role_deleted` — Claude's discretion on exact strings, but consistent between log and table.
- before/after: for mapping saves, the permission arrays; for assign/revoke, the user's role list. Table is CREATE TABLE IF NOT EXISTS in SCHEMA_DDL (no viewer in v1.8 — AUDIT-V19-01 consumes it later).
- Phase 49's assign/revoke handlers gain audit emission in this phase (they predate the audit decision).

### Escalation guards (SAFE-V18-02) — server + UI mirror
- SERVER (authoritative; replaces the Phase 47 deferral comments):
  1. Non-admin cannot assign the admin role (POST /api/users/:username/roles {role: admin} → 403)
  2. Non-admin cannot edit the admin role's mappings (PUT /api/roles/<admin-id>/permissions → 403)
  3. Non-admin cannot grant a custom role permissions they do not themselves hold (PUT containing unheld permission → 403, verbatim message naming the permission)
  - "Non-admin" = caller whose effective permissions lack the admin role (define precisely: caller does not hold the admin ROLE — bootstrap admin and explicit admin-role holders are exempt from all three).
- UI mirrors:
  - Admin role **visible but read-only + lock** in the Roles list for user admins; detail shows disabled checkboxes + "Only admins can modify the admin role."
  - **Unheld permissions render disabled** with tooltip "You can only grant permissions you hold." (deliberate disabled-not-hidden exception — hiding rows would make the matrix inconsistent per editor)
  - **Users page popover/bulk dropdown hides the admin role** for non-admin editors (small Phase 49 retrofit)
- Server remains sole authority — UI mirrors are UX only; verbatim server messages on any rejection.

### Claude's Discretion
- Component naming (RolesPage.tsx), CSS conventions, confirm implementation (window.confirm vs inline)
- Audit helper module shape (emitRbacAudit(db, {...}) writing both log + row)
- Exact action-enum strings; rbac_audit indexes
- Page union value ("roles") and App.tsx wiring (mirror Phase 49's exactly, incl. OIDC ReturnTo)
- Whether GET /api/roles needs a holders-count field for the delete-blocked UX (add if trivial)

</decisions>

<specifics>
## Specific Ideas

- The approved two-pane sketch above is the layout contract.
- Category grouping derives from permission `noun:` prefixes — no hardcoded category table that can drift from the catalog.
- Audit table now = v1.9 viewer's data source accumulates from v1.8 day one (explicit user choice).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/ROADMAP.md` § Phase 50 — 6 success criteria
- `.planning/REQUIREMENTS.md` — ROLES-V18-01..04, SAFE-V18-02, AUDIT-V18-01
- `.planning/phases/49-users-management-ui/49-VERIFICATION.md` — UsersPage + management API as shipped (popover to retrofit; SAFE-V18-01 guard pattern to mirror)
- `.planning/phases/47-server-middleware-route-guards/47-VERIFICATION.md` — role CRUD routes + SAFE-V18-02 deferral comment locations

### Research
- `.planning/research/FEATURES.md` § role-permission mapping editor (HIGH complexity flag) + § Anti-Features (no permission inheritance)
- `.planning/research/PITFALLS.md` § privilege escalation via mapping editor

### Existing code (read before touching)
- `packages/server/src/index.ts` — role CRUD routes (~2018-2150) with SAFE-V18-02 deferral comments; SAFE-V18-01 guard (the pattern to mirror); OBS-1 emit precedents
- `packages/server/src/db.ts` SCHEMA_DDL — where rbac_audit lands
- `packages/web/src/components/UsersPage.tsx` — popover to retrofit + page-shape precedent
- `packages/web/src/components/DynamicViewsModal.tsx` — dirty-state confirm + two-pane precedents
- `packages/web/src/App.tsx` — Page union wiring precedent from Phase 49 (incl. OIDC ReturnTo)
- `packages/web/src/lib/permissions.ts` + `packages/server/src/lib/permissions.ts` — catalog (grouping derives from it)
- `packages/web/src/test/seedAuthStore.ts` — seedUserAdminStore for guard-UX specs

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- SAFE-V18-01 guard shape in the DELETE handler (49-01) — SAFE-V18-02 guards mirror its structure + verbatim-message pattern
- UsersPage table/chips/popover components + CSS — RolesPage reuses idioms
- getEffectiveRoles (rbacDb) — guards need "does caller hold admin role"
- seedAuthStore helpers incl. seedUserAdminStore — guard-UX specs

### Established Patterns
- Draft+Save with dirty confirm (DynamicViewsModal); two-pane list/detail; verbatim server errors inline+toast (Phase 49)
- TDD RED/GREEN for server guards (49-01 precedent)
- Set-based server test gate (14 known-flaky files); frontend baseline 1527/1528 (1 known-red)

### Integration Points
- Server: 3 escalation guards in existing handlers; rbac_audit table + emit helper threaded through 5 mutation handlers (incl. Phase 49's assign/revoke)
- Frontend: RolesPage + App.tsx Page union + UsersPage popover retrofit
- routes.management.spec.ts: escalation cases need a USER_ADMIN session WITH user_roles rows (createAdminSession bootstrap short-circuit can't exercise non-admin paths — build a createUserAdminSession-style helper seeding explicit rows)

</code_context>

<deferred>
## Deferred Ideas

- Audit log viewer UI — v1.9 (AUDIT-V19-01; the rbac_audit table built now feeds it)
- Custom-role duplication — v1.9 (ROLES-V19-01)
- Per-role "reset to defaults" — v1.9 (from Phase 46 discussion)
- Role descriptions/display-names — not requested; note if wanted later
- Embeddable/public dashboards via embed identity — backlog

</deferred>

---

*Phase: 50-roles-management-ui-custom-roles-audit*
*Context gathered: 2026-06-06*
