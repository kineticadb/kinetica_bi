/**
 * Frontend mirror of packages/server/src/lib/permissions.ts.
 * BYTE-PARITY: values must match server exactly.
 * Parity enforced by spec (independently hardcodes all strings).
 * Pure module — zero imports.
 */

// ─── Permission catalog ───────────────────────────────────────────────────────

export const PERMISSIONS = {
  DASHBOARDS_VIEW:          "dashboards:view",
  DASHBOARDS_CREATE:        "dashboards:create",
  DASHBOARDS_EDIT:          "dashboards:edit",
  DASHBOARDS_DELETE:        "dashboards:delete",
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
  DASHBOARDS_MANAGE_ACCESS: "dashboards:manage_access",
  BRANDING_MANAGE:          "branding:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
