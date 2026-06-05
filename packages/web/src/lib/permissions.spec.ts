/**
 * Byte-parity spec for packages/web/src/lib/permissions.ts.
 *
 * Rule: all 16 expected strings are HARDCODED here as literals — never derived
 * from the source under test. Mirrors the Phase 46 catalog spec rule. Any
 * single-character drift between server and client PERMISSIONS is caught here
 * before it silently bypasses a gate.
 */

import { describe, it, expect } from "vitest";
import { PERMISSIONS } from "./permissions";

describe("PERMISSIONS mirror — byte-parity with server catalog", () => {
  it("has exactly 16 permission keys", () => {
    expect(Object.values(PERMISSIONS).length).toBe(16);
  });

  it("each permission value matches its independently hardcoded string", () => {
    expect(PERMISSIONS.DASHBOARDS_VIEW).toBe("dashboards:view");
    expect(PERMISSIONS.DASHBOARDS_CREATE).toBe("dashboards:create");
    expect(PERMISSIONS.DASHBOARDS_EDIT).toBe("dashboards:edit");
    expect(PERMISSIONS.DASHBOARDS_DELETE).toBe("dashboards:delete");
    expect(PERMISSIONS.WIDGETS_CONFIGURE).toBe("widgets:configure");
    expect(PERMISSIONS.LAYERS_MANAGE).toBe("layers:manage");
    expect(PERMISSIONS.DYNAMIC_VIEWS_MANAGE).toBe("dynamic_views:manage");
    expect(PERMISSIONS.DATA_FILTERS_CONFIGURE).toBe("data_filters:configure");
    expect(PERMISSIONS.USERS_VIEW).toBe("users:view");
    expect(PERMISSIONS.USERS_ASSIGN_ROLES).toBe("users:assign_roles");
    expect(PERMISSIONS.ROLES_VIEW).toBe("roles:view");
    expect(PERMISSIONS.ROLES_MANAGE_PERMISSIONS).toBe("roles:manage_permissions");
    expect(PERMISSIONS.ROLES_CREATE_CUSTOM).toBe("roles:create_custom");
    expect(PERMISSIONS.ROLES_DELETE_CUSTOM).toBe("roles:delete_custom");
    expect(PERMISSIONS.AUDIT_VIEW).toBe("audit:view");
    expect(PERMISSIONS.DATASETS_MANAGE).toBe("datasets:manage");
  });

  it("has no duplicate permission string values", () => {
    const values = Object.values(PERMISSIONS);
    expect(new Set(values).size).toBe(16);
  });
});
