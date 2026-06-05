import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  BUILTIN_ROLES,
  DEFAULT_ROLE_MAPPINGS,
} from "../src/lib/permissions";

// ─── Task 1: Catalog + ALL_PERMISSIONS + BUILTIN_ROLES ────────────────────────

const EXPECTED_PERMISSION_STRINGS = [
  "dashboards:view",
  "dashboards:create",
  "dashboards:edit",
  "dashboards:delete",
  "widgets:configure",
  "layers:manage",
  "dynamic_views:manage",
  "data_filters:configure",
  "users:view",
  "users:assign_roles",
  "roles:view",
  "roles:manage_permissions",
  "roles:create_custom",
  "roles:delete_custom",
  "audit:view",
  "datasets:manage",
] as const;

describe("PERMISSIONS catalog", () => {
  it("has exactly 16 entries", () => {
    expect(Object.keys(PERMISSIONS).length).toBe(16);
  });

  it("contains exactly the 16 expected permission strings (independent lock)", () => {
    const actual = Object.values(PERMISSIONS).sort();
    const expected = [...EXPECTED_PERMISSION_STRINGS].sort();
    expect(actual).toEqual(expected);
  });

  it("every string follows noun:verb shape (/^[a-z_]+:[a-z_]+$/)", () => {
    const pattern = /^[a-z_]+:[a-z_]+$/;
    for (const perm of Object.values(PERMISSIONS)) {
      expect(perm).toMatch(pattern);
    }
  });
});

describe("ALL_PERMISSIONS", () => {
  it("has length 16", () => {
    expect(ALL_PERMISSIONS.length).toBe(16);
  });

  it("contains every value in PERMISSIONS (no omissions)", () => {
    const permValues = Object.values(PERMISSIONS);
    for (const perm of permValues) {
      expect(ALL_PERMISSIONS).toContain(perm);
    }
  });

  it("has no duplicates", () => {
    const unique = new Set(ALL_PERMISSIONS);
    expect(unique.size).toBe(ALL_PERMISSIONS.length);
  });

  it("contains 'datasets:manage' (16th permission, Phase 47 addition)", () => {
    expect(ALL_PERMISSIONS).toContain("datasets:manage");
  });
});

describe("BUILTIN_ROLES", () => {
  it('deep-equals ["admin", "user_admin", "designer", "analyst"] in that exact order', () => {
    expect([...BUILTIN_ROLES]).toEqual(["admin", "user_admin", "designer", "analyst"]);
  });
});

// ─── Task 2: DEFAULT_ROLE_MAPPINGS ────────────────────────────────────────────

// Independently-hardcoded expected sets (do NOT derive from PERMISSIONS —
// independent lock catches typos in the source).

const EXPECTED_ADMIN_PERMS = [
  "dashboards:view",
  "dashboards:create",
  "dashboards:edit",
  "dashboards:delete",
  "widgets:configure",
  "layers:manage",
  "dynamic_views:manage",
  "data_filters:configure",
  "users:view",
  "users:assign_roles",
  "roles:view",
  "roles:manage_permissions",
  "roles:create_custom",
  "roles:delete_custom",
  "audit:view",
  "datasets:manage",
];

const EXPECTED_DESIGNER_PERMS = [
  "dashboards:view",
  "dashboards:create",
  "dashboards:edit",
  "dashboards:delete",
  "widgets:configure",
  "layers:manage",
  "dynamic_views:manage",
  "data_filters:configure",
  "datasets:manage",
];

const EXPECTED_USER_ADMIN_PERMS = [
  "users:view",
  "users:assign_roles",
  "roles:view",
  "roles:manage_permissions",
  "roles:create_custom",
  "dashboards:view",
];

const EXPECTED_ANALYST_PERMS = ["dashboards:view"];

describe("DEFAULT_ROLE_MAPPINGS", () => {
  it("admin deep-equals ALL_PERMISSIONS (all 16) — compared as sorted sets", () => {
    const actual = [...DEFAULT_ROLE_MAPPINGS.admin].sort();
    const expected = [...ALL_PERMISSIONS].sort();
    expect(actual).toEqual(expected);
  });

  it("admin has exactly 16 permissions (independently locked)", () => {
    const actual = [...DEFAULT_ROLE_MAPPINGS.admin].sort();
    const expected = [...EXPECTED_ADMIN_PERMS].sort();
    expect(actual).toEqual(expected);
  });

  it("designer is exactly the 9 design permissions — no users:*, roles:*, audit:*", () => {
    expect(DEFAULT_ROLE_MAPPINGS.designer.length).toBe(9);
    const actual = [...DEFAULT_ROLE_MAPPINGS.designer].sort();
    const expected = [...EXPECTED_DESIGNER_PERMS].sort();
    expect(actual).toEqual(expected);
    // Ensure no users:*, roles:*, or audit:* bleed in
    for (const perm of DEFAULT_ROLE_MAPPINGS.designer) {
      expect(perm).not.toMatch(/^(users:|roles:|audit:)/);
    }
  });

  it("user_admin has exactly 6 permissions and does not include roles:delete_custom", () => {
    expect(DEFAULT_ROLE_MAPPINGS.user_admin.length).toBe(6);
    const actual = [...DEFAULT_ROLE_MAPPINGS.user_admin].sort();
    const expected = [...EXPECTED_USER_ADMIN_PERMS].sort();
    expect(actual).toEqual(expected);
    expect(DEFAULT_ROLE_MAPPINGS.user_admin).not.toContain("roles:delete_custom");
    // Does NOT include write dashboard permissions
    expect(DEFAULT_ROLE_MAPPINGS.user_admin).not.toContain("dashboards:create");
    expect(DEFAULT_ROLE_MAPPINGS.user_admin).not.toContain("dashboards:edit");
    expect(DEFAULT_ROLE_MAPPINGS.user_admin).not.toContain("dashboards:delete");
    expect(DEFAULT_ROLE_MAPPINGS.user_admin).not.toContain("widgets:configure");
  });

  it("analyst is exactly [\"dashboards:view\"] (length 1)", () => {
    expect(DEFAULT_ROLE_MAPPINGS.analyst.length).toBe(1);
    const actual = [...DEFAULT_ROLE_MAPPINGS.analyst].sort();
    const expected = [...EXPECTED_ANALYST_PERMS].sort();
    expect(actual).toEqual(expected);
  });

  it("every permission in every role mapping is a member of ALL_PERMISSIONS (no orphan strings)", () => {
    const allPermsSet = new Set(ALL_PERMISSIONS);
    for (const role of BUILTIN_ROLES) {
      for (const perm of DEFAULT_ROLE_MAPPINGS[role]) {
        expect(allPermsSet.has(perm)).toBe(true);
      }
    }
  });

  it("roles:delete_custom appears ONLY in the admin mapping", () => {
    expect(DEFAULT_ROLE_MAPPINGS.admin).toContain("roles:delete_custom");
    expect(DEFAULT_ROLE_MAPPINGS.designer).not.toContain("roles:delete_custom");
    expect(DEFAULT_ROLE_MAPPINGS.user_admin).not.toContain("roles:delete_custom");
    expect(DEFAULT_ROLE_MAPPINGS.analyst).not.toContain("roles:delete_custom");
  });
});
