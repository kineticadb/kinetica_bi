/**
 * Canonical RBAC permission catalog (v1.8 SCHEMA-V18-01).
 *
 * Code-defined — adding a permission requires a release.
 * Role→permission MAPPINGS live in the DB (role_permissions table);
 * this catalog is the set of strings those mappings may reference.
 *
 * MUST be the single source of truth: Phase 47 requirePermission() and
 * Phase 48 useAuthStore.hasPermission() import these same string literals
 * to prevent server/client drift (PITFALLS Pitfall 3).
 *
 * Pure module — zero runtime side effects, no imports, no default export.
 * Mirrors lib/viewNaming.ts style.
 */

// ─── Permission catalog ───────────────────────────────────────────────────────

export const PERMISSIONS = {
  DASHBOARDS_VIEW:          "dashboards:view",
  DASHBOARDS_CREATE:        "dashboards:create",
  DASHBOARDS_EDIT:          "dashboards:edit",
  DASHBOARDS_DELETE:        "dashboards:delete",
  DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access",
  WIDGETS_CONFIGURE:        "widgets:configure",
  LAYERS_MANAGE:            "layers:manage",
  DYNAMIC_VIEWS_MANAGE:     "dynamic_views:manage",
  DATA_FILTERS_CONFIGURE:   "data_filters:configure",
  USERS_VIEW:               "users:view",
  USERS_ASSIGN_ROLES:       "users:assign_roles",
  ROLES_VIEW:               "roles:view",
  ROLES_MANAGE_PERMISSIONS: "roles:manage_permissions",
  ROLES_CREATE_CUSTOM:      "roles:create_custom",
  ROLES_DELETE_CUSTOM:      "roles:delete_custom",
  AUDIT_VIEW:               "audit:view",
  DATASETS_MANAGE:          "datasets:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Flat array of all 17 permission strings — used by the admin bootstrap
// short-circuit (returns new Set(ALL_PERMISSIONS)) and the catalog seed.
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

// ─── Built-in roles ───────────────────────────────────────────────────────────

// The four built-in role names in a stable order.
export const BUILTIN_ROLES = [
  "admin",
  "user_admin",
  "designer",
  "analyst",
] as const;

export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

// ─── Default role→permission mappings ────────────────────────────────────────
//
// Locked defaults from 46-CONTEXT.md. The seed (rbacSeed.ts) INSERT-OR-IGNOREs
// these on every boot so new catalog permissions land on built-in defaults while
// operator edits persist; there is NO reset-to-defaults in v1.8 (deferred v1.9)
// — to repair a broken built-in role, re-apply these mappings manually via the
// matrix.

export const DEFAULT_ROLE_MAPPINGS: Record<BuiltinRole, readonly Permission[]> = {
  // admin: all 17 permissions (bootstrap short-circuit always returns full set)
  admin: [...ALL_PERMISSIONS],

  // designer: full dashboard lifecycle + all design tooling + dataset management +
  // per-dashboard access management. Mental model: "designer designs, admin governs."
  // Everything except users:*, roles:*, audit:*.
  designer: [
    PERMISSIONS.DASHBOARDS_VIEW,
    PERMISSIONS.DASHBOARDS_CREATE,
    PERMISSIONS.DASHBOARDS_EDIT,
    PERMISSIONS.DASHBOARDS_DELETE,
    PERMISSIONS.DASHBOARDS_MANAGE_ACCESS,
    PERMISSIONS.WIDGETS_CONFIGURE,
    PERMISSIONS.LAYERS_MANAGE,
    PERMISSIONS.DYNAMIC_VIEWS_MANAGE,
    PERMISSIONS.DATA_FILTERS_CONFIGURE,
    PERMISSIONS.DATASETS_MANAGE,
  ],

  // user_admin: least-privilege management + analyst-level dashboard view ONLY.
  // Explicitly does NOT include roles:delete_custom (admin only by default).
  // Does NOT include any dashboards:create/edit/delete, widgets:*, layers:*,
  // dynamic_views:*, data_filters:*, or audit:*.
  // People needing both management + design get user_admin + designer via
  // multi-role union (union-of-permissions model).
  user_admin: [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_ASSIGN_ROLES,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
    PERMISSIONS.ROLES_CREATE_CUSTOM,
    PERMISSIONS.DASHBOARDS_VIEW,
  ],

  // analyst: dashboards:view only.
  // All click-through interaction — filters, drill-down, info popups, map draw
  // — stays ungated by design; it is Phase 47 analyst-passthrough /
  // requireAuth-only territory, NOT a permission here.
  analyst: [
    PERMISSIONS.DASHBOARDS_VIEW,
  ],
};
