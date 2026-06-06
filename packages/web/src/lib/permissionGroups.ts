/**
 * permissionGroups.ts — Phase 50.1 / 50.2
 * Shared permission-grouping constants and helper, extracted from RolesPage.tsx
 * for reuse by ProfilePage and any other consumer.
 *
 * PERMISSION_DESCRIPTIONS added in Phase 50.2: human-readable descriptions for
 * all 16 permissions, displayed as muted secondary text in the Roles matrix.
 */

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  "dashboards:view": "Open and view dashboards, including filters, drill-down, and map interactions",
  "dashboards:create": "Create new dashboards",
  "dashboards:edit": "Edit dashboard layout and widgets; add/remove widgets and associated tables",
  "dashboards:delete": "Delete dashboards",
  "widgets:configure": "Open the chart configuration panel and change widget settings",
  "layers:manage": "Add, edit, and reorder map layers (Map Layers)",
  "dynamic_views:manage": "Create and edit dynamic views (saved SQL templates)",
  "data_filters:configure": "Configure the fields of Data Filter widgets",
  "datasets:manage": "Register, edit, and remove datasets (Kinetica tables)",
  "users:view": "View the user list and current role assignments",
  "users:assign_roles": "Assign and revoke user roles",
  "roles:view": "View roles and their permission mappings",
  "roles:manage_permissions": "Edit which permissions each role grants",
  "roles:create_custom": "Create new custom roles",
  "roles:delete_custom": "Delete custom roles",
  "audit:view": "View the audit log (viewer ships in a future release)",
};

export const NOUN_TO_GROUP: Record<string, string> = {
  dashboards: "Dashboards",
  widgets: "Design",
  layers: "Design",
  dynamic_views: "Design",
  data_filters: "Design",
  datasets: "Design",
  users: "Users",
  roles: "Roles",
  audit: "Audit",
};

export const GROUP_ORDER = [
  "Dashboards",
  "Design",
  "Users",
  "Roles",
  "Audit",
] as const;

/**
 * groupPermissionList — bucket an ARBITRARY list of permission strings into
 * ordered groups using NOUN_TO_GROUP + GROUP_ORDER, with an "Other" catch-all
 * for unmapped nouns. Input order within each bucket is preserved.
 *
 * Returns [] for empty input. Never silently drops unmapped permissions.
 */
export function groupPermissionList(
  perms: string[],
): Array<{ group: string; perms: string[] }> {
  if (perms.length === 0) return [];

  const buckets = new Map<string, string[]>();

  for (const perm of perms) {
    const noun = perm.split(":")[0];
    const group = NOUN_TO_GROUP[noun] ?? "Other";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(perm);
  }

  const ordered: Array<{ group: string; perms: string[] }> = [];
  for (const g of GROUP_ORDER) {
    if (buckets.has(g)) {
      ordered.push({ group: g, perms: buckets.get(g)! });
    }
  }
  // Append "Other" last — never silently drop unmapped perms
  if (buckets.has("Other")) {
    ordered.push({ group: "Other", perms: buckets.get("Other")! });
  }

  return ordered;
}
