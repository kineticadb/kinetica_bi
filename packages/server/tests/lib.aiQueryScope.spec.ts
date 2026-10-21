import { describe, it, expect } from "vitest";
import { buildQueryScope, savedViewAlias, aiViewAlias, type QueryScopeInput } from "../src/lib/ai/queryScope";
import { buildDynamicViewName } from "../src/lib/dynamicViewName";

const AI0 = "_kbi_ai_uann_sabcd1234_n0a1b2c3d_101";
const AI2 = "_kbi_ai_uann_sabcd1234_n0a1b2c3d_101_g2";
const base = (): QueryScopeInput => ({
  username: "Ann",
  dashboardId: 1,
  dashboardTables: [{ id: 5, schema: "demo", name: "trips" }, { id: 6, schema: "", name: "zones" }],
  savedViews: [{ id: 7, name: "Fares by vendor", columns: [{ name: "vendor", type: "string" }] }],
  aiViews: [
    { viewName: AI0, dashboardId: 1, tempId: -101, gen: 0 },
    { viewName: AI2, dashboardId: 1, tempId: -101, gen: 2 },
    { viewName: "_kbi_ai_uann_sabcd1234_n0a1b2c3d_102", dashboardId: 2, tempId: -102, gen: 0 },
  ],
  aiViewNames: new Map([[-101, "Trips by hour"]]),
});
const dv7 = buildDynamicViewName({ userId: "Ann", dashboardId: 1, dynamicViewId: 7 });

describe("buildQueryScope", () => {
  it("QSC-1 table names lower-cased, bare when schema empty", () => {
    const s = buildQueryScope(base());
    expect([...s.tableNames].sort()).toEqual(["demo.trips", "zones"]);
    expect(s.tableIdByName.get("demo.trips")).toBe(5);
  });
  it("QSC-2 aliases map to physical names; highest gen wins; other dashboards excluded", () => {
    const s = buildQueryScope(base());
    expect(s.aliases.get("dv_7")).toBe(dv7);
    expect(s.aliases.get("aidv_101")).toBe(AI2);
    expect(s.aliases.has("aidv_102")).toBe(false);
  });
  it("QSC-3 pass1 uses aliases, pass2 uses physical names", () => {
    const s = buildQueryScope(base());
    expect([...s.pass1Allowed].sort()).toEqual(["aidv_101", "demo.trips", "dv_7", "zones"]);
    expect([...s.pass2Allowed].sort()).toEqual(["demo.trips", dv7.toLowerCase(), AI2.toLowerCase(), "zones"].sort());
    expect(s.pass1Allowed.has(dv7.toLowerCase())).toBe(false);
    expect(s.pass2Allowed.has("dv_7")).toBe(false);
  });
  it("QSC-4 views expose aliases and display names only", () => {
    const s = buildQueryScope(base());
    expect(s.views).toEqual([
      { alias: "dv_7", name: "Fares by vendor", columns: [{ name: "vendor", type: "string" }] },
      { alias: "aidv_101", name: "Trips by hour" },
    ]);
    const j = JSON.stringify(s.views);
    expect(j).not.toContain("_kbi_");
    expect(j.toLowerCase()).not.toContain("ann");
  });
  it("QSC-5 AI view without snapshot name gets default display name", () => {
    const s = buildQueryScope({ ...base(), aiViewNames: undefined });
    expect(s.views.find((v) => v.alias === "aidv_101")?.name).toBe("AI view 101");
  });
  it("QSC-6 case-insensitive table collision drops both", () => {
    const i = base();
    const s = buildQueryScope({ ...i, dashboardTables: [{ id: 5, schema: "demo", name: "Trips" }, { id: 8, schema: "DEMO", name: "trips" }] });
    expect(s.tableNames.has("demo.trips")).toBe(false);
    expect(s.pass1Allowed.has("demo.trips")).toBe(false);
  });
  it("QSC-7 alias helpers", () => {
    expect(savedViewAlias(7)).toBe("dv_7");
    expect(aiViewAlias(-101)).toBe("aidv_101");
    expect(aiViewAlias(101)).toBe("aidv_101");
  });
});
