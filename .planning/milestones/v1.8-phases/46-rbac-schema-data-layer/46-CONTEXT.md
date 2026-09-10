# Phase 46: RBAC Schema + Data Layer - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The SQLite role registry and all data-access primitives exist and are idempotently seeded — `roles`, `role_permissions`, `user_roles` tables, the code-defined 15-permission catalog, `getEffectivePermissions(username)`, and the bootstrap admin resolution. Every downstream v1.8 phase reads/writes roles through this layer without running its own migrations. NO middleware, NO route guards, NO UI in this phase (those are Phases 47–50).

</domain>

<decisions>
## Implementation Decisions

### Default role→permission mappings (seed data)
- **admin**: all 15 permissions (and the bootstrap short-circuit returns all permissions regardless of DB state)
- **designer**: full dashboard lifecycle — `dashboards:view/create/edit/delete` — plus ALL design tooling: `widgets:configure`, `layers:manage`, `dynamic_views:manage`, `data_filters:configure`. Mental model: "designer designs, admin governs." Everything except `users:*`, `roles:*`, `audit:*`.
- **user_admin**: `users:view`, `users:assign_roles`, `roles:view`, `roles:manage_permissions`, `roles:create_custom` + `dashboards:view` ONLY (analyst-level outside management). Least privilege — people needing both get user_admin + designer via multi-role union.
- **analyst**: `dashboards:view` only. All click-through interaction (filters, drill-down, info popups, map draw) stays ungated by design — it is requireAuth-only territory (Phase 47's analyst-passthrough boundary).
- `roles:delete_custom` defaults to admin only (per research catalog).

### Permission catalog shape
- Keep all **15 fine-grained `noun:verb` permissions** from research (FEATURES.md catalog) — no collapsing. Custom roles need the precision (e.g. "edit but not delete").
- **Include `audit:view` now**, mapped to admin by default — reserves the catalog entry for the v1.9 audit viewer; no UI consumes it in v1.8.
- Catalog is code-defined (a `PERMISSIONS` const); mappings are DB rows.

### Bootstrap admin
- **Single username** via `APP_ADMIN_USERNAME` env var, default `"admin"` (Kinetica's built-in superuser). Additional admins get the role through normal assignment.
- **Case-insensitive username matching** for the bootstrap comparison AND all `user_roles` lookups. Store usernames lowercased in `user_roles`. Rationale: OIDC IdPs are inconsistent about email casing — exact-match silently breaks role assignment.
- Bootstrap short-circuit fires BEFORE any DB lookup; this account can never be locked out and its effective permissions are always "all".
- OIDC + default `"admin"` → **warn and boot** (NOT fail-fast). Structured boot-log warning (mirrors existing `oidc_boot` JSON log style) explaining: OIDC usernames come from IdP claims; set `APP_ADMIN_USERNAME` to a real IdP username, or roles can only be assigned by users already granted admin. Non-fatal because the analyst default means nobody is broken.

### Seed & upgrade semantics
- Seed via INSERT OR IGNORE — operator edits to built-in role mappings SURVIVE restarts (seed never overwrites).
- **REFINED during execution (operator decision 2026-06-05): seed-history mechanism.** Pure every-boot INSERT OR IGNORE would resurrect operator-REMOVED default permissions on restart. Fix: `rbac_seed_history` table records every (role_name, permission) default ever seeded; a default mapping is inserted into `role_permissions` ONLY on its first-ever appearance in history. Result: operator removals survive restarts AND future catalog additions still auto-land exactly once. Implemented in commit `6f9e26f`.
- **Future catalog additions seed into built-in defaults**: when a release adds a new permission to a role's DEFAULT mapping, it has no history row → seeded exactly once. Custom roles never auto-change.
- **No "reset role to defaults" in v1.8** — deferred to v1.9. Defaults should be documented (in code comments / README section) so a broken built-in role can be repaired manually via the matrix.

### Claude's Discretion
- Exact table DDL (column names, indexes, FK style — follow existing db.ts conventions; note dashboard_layers uses soft-FKs without REFERENCES)
- Whether roles table uses `builtin INTEGER` flag vs name-based detection (research suggests `builtin` flag — fine)
- Module layout (`rbacDb.ts` vs extending db.ts — research suggests separate `rbacDb.ts`)
- Spec file naming and structure (mirror `db.rbacMigration.spec.ts` convention from success criteria)
- Handling of orphaned mapping rows if a permission is ever removed from the catalog

</decisions>

<specifics>
## Specific Ideas

- "The first admin should always be the `admin` user because that is the default and admin user in Kinetica" — bootstrap rationale, verbatim from milestone questioning
- Default mappings follow the research catalog table in `.planning/research/FEATURES.md` § Permission Catalog, with the decisions above superseding where they differ

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### RBAC design (this milestone)
- `.planning/research/ARCHITECTURE.md` — integration points with file:line refs, schema DDL proposal, build order, anti-patterns (HIGH confidence, code-grounded)
- `.planning/research/FEATURES.md` § Permission Catalog + § UI Surface → Permission Mapping — the 15-permission catalog and default role mappings this phase seeds
- `.planning/research/PITFALLS.md` — esp. "never store roles in session rows" (per-request lookup), OIDC admin-lockout, test-suite impact
- `.planning/research/STACK.md` — zero-new-dependency decision, schema DDL sketch
- `.planning/REQUIREMENTS.md` — SCHEMA-V18-01..03 (this phase's requirement contract)
- `.planning/ROADMAP.md` § Phase 46 — success criteria (5)

### Existing code patterns to follow
- `packages/server/src/db.ts` — SCHEMA_DDL CREATE TABLE IF NOT EXISTS block (lines ~13-130) + PRAGMA-guarded ALTER precedent (not needed here — new tables only) + seed conventions
- `packages/server/src/env.ts` — env loading happens here FIRST; `APP_ADMIN_USERNAME` read can be module-level in the new rbac module but must not break the env.ts-first import order
- `packages/server/src/index.ts` `oidc_boot` structured log — style to mirror for the OIDC bootstrap warning

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db.ts` SCHEMA_DDL pattern: new tables append to the existing `CREATE TABLE IF NOT EXISTS` block — no PRAGMA-guarded ALTERs needed (wholly new tables)
- Structured JSON boot logging (`oidc_boot` in index.ts) — template for the bootstrap-admin OIDC warning
- Existing spec conventions: `packages/server/tests/` with `db.*.spec.ts` naming; better-sqlite3 in-memory or temp-file DB fixtures

### Established Patterns
- Soft-FK convention: `dashboard_layers.dynamic_view_id` is INTEGER without REFERENCES — RBAC tables may follow the same style
- Pure helpers live in `packages/server/src/lib/` with co-located unit specs; route-facing modules at `packages/server/src/`
- `KineticaOp` audit-tag union extension pattern exists if any logging is added (full audit work is Phase 50)

### Integration Points
- `db.ts` `SCHEMA_DDL` + boot-time seed call site (where `instance.exec(SCHEMA_DDL)` runs)
- New `rbacDb.ts` (or `lib/rbac.ts`) exporting `PERMISSIONS` catalog, `DEFAULT_ROLE_MAPPINGS`, `getEffectivePermissions(username)` — consumed by Phase 47 middleware and Phase 48 /me extension
- `APP_ADMIN_USERNAME` documented in `packages/server/.env.example` + README Environment Variables table

</code_context>

<deferred>
## Deferred Ideas

- **Embeddable/public dashboards via an app-level configured user** (user idea, 2026-06-05): make a dashboard page embeddable in another webpage by assigning it an application-level configured identity (anonymous/embed pseudo-user with a minimal role). New capability — needs its own phase/milestone (auth bypass surface, iframe headers, token strategy). The username→roles schema from this phase supports it naturally (an embed identity is just a username with a custom role). **Note for roadmap backlog / v1.9 candidate.**
- Per-role "reset to defaults" action — v1.9 (decided this discussion)
- `audit:view` consumer (audit log viewer UI) — v1.9 (AUDIT-V19-01)

</deferred>

---

*Phase: 46-rbac-schema-data-layer*
*Context gathered: 2026-06-05*
