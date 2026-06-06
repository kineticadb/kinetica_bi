/**
 * permissionGroups.ts — Phase 50.1
 * Shared permission-grouping constants and helper, extracted from RolesPage.tsx
 * for reuse by ProfilePage and any other consumer.
 */

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
