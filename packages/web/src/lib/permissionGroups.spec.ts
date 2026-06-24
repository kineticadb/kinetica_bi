import { describe, it, expect } from "vitest";
import { groupPermissionList, NOUN_TO_GROUP, GROUP_ORDER } from "./permissionGroups";

describe("groupPermissionList", () => {
  it("returns [] for empty input", () => {
    expect(groupPermissionList([])).toEqual([]);
  });

  it("buckets known permissions into the correct groups in GROUP_ORDER order", () => {
    const result = groupPermissionList([
      "dashboards:view",
      "dashboards:create",
      "users:view",
      "roles:view",
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ group: "Dashboards", perms: ["dashboards:view", "dashboards:create"] });
    expect(result[1]).toEqual({ group: "Users", perms: ["users:view"] });
    expect(result[2]).toEqual({ group: "Roles", perms: ["roles:view"] });
  });

  it("puts unmapped nouns in an Other bucket appended last", () => {
    const result = groupPermissionList([
      "dashboards:view",
      "dashboards:create",
      "users:view",
      "weird:thing",
    ]);
    // Dashboards before Users, Other last
    const groups = result.map((r) => r.group);
    expect(groups).toEqual(["Dashboards", "Users", "Other"]);
    const otherGroup = result.find((r) => r.group === "Other");
    expect(otherGroup?.perms).toEqual(["weird:thing"]);
  });

  it("preserves input order within a group", () => {
    const result = groupPermissionList([
      "dashboards:delete",
      "dashboards:view",
      "dashboards:create",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].perms).toEqual([
      "dashboards:delete",
      "dashboards:view",
      "dashboards:create",
    ]);
  });

  it("places Design group (widgets/layers/etc.) in correct position", () => {
    const result = groupPermissionList([
      "dashboards:view",
      "widgets:configure",
      "layers:manage",
      "users:view",
    ]);
    const groups = result.map((r) => r.group);
    expect(groups).toEqual(["Dashboards", "Design", "Users"]);
    const design = result.find((r) => r.group === "Design");
    expect(design?.perms).toEqual(["widgets:configure", "layers:manage"]);
  });

  it("handles a single unmapped permission alone", () => {
    const result = groupPermissionList(["unknown:action"]);
    expect(result).toEqual([{ group: "Other", perms: ["unknown:action"] }]);
  });

  it("returns only groups present in the input — no empty groups", () => {
    const result = groupPermissionList(["audit:view"]);
    expect(result).toHaveLength(1);
    expect(result[0].group).toBe("Audit");
  });
});

describe("NOUN_TO_GROUP", () => {
  it("maps all known permission nouns", () => {
    const expectedNouns = [
      "dashboards", "widgets", "layers", "dynamic_views",
      "data_filters", "datasets", "users", "roles", "audit",
    ];
    for (const noun of expectedNouns) {
      expect(NOUN_TO_GROUP[noun]).toBeDefined();
    }
  });
});

describe("GROUP_ORDER", () => {
  it("has the six expected group names in order", () => {
    expect(GROUP_ORDER).toEqual(["Dashboards", "Design", "Users", "Roles", "Audit", "Branding"]);
  });
});
