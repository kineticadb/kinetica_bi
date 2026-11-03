import { describe, it, expect } from "vitest";
import { buildViewColumnsProbeSql, parseProbeColumns, createViewColumnsCache } from "../src/lib/viewColumns";

describe("viewColumns (Phase 133, 133-09)", () => {
  it("VC-1: probe SQL is the S1-decided LIMIT 0 select", () => {
    expect(buildViewColumnsProbeSql("_kbi_dv_ua_d1_2")).toBe("SELECT * FROM _kbi_dv_ua_d1_2 LIMIT 0");
  });
  it("VC-2: parseProbeColumns reads column_headers, garbage -> []", () => {
    expect(parseProbeColumns({ column_headers: ["zone", "fare"], column_1: [] })).toEqual(["zone", "fare"]);
    expect(parseProbeColumns(null)).toEqual([]);
    expect(parseProbeColumns("x")).toEqual([]);
    expect(parseProbeColumns({ column_headers: "zone" })).toEqual([]);
    expect(parseProbeColumns({ column_headers: ["a", 5] })).toEqual(["a"]);
  });
  it("VC-3: cache get/set/delete", () => {
    const c = createViewColumnsCache({ ttlMs: 1000 });
    expect(c.get("v")).toBeUndefined();
    c.set("v", ["a"]);
    expect(c.get("v")).toEqual(["a"]);
    c.delete("v");
    expect(c.get("v")).toBeUndefined();
  });
  it("VC-4: entry expires after ttlMs", () => {
    let t = 0;
    const c = createViewColumnsCache({ ttlMs: 1000, now: () => t });
    c.set("v", ["a"]);
    t = 999;
    expect(c.get("v")).toEqual(["a"]);
    t = 1000;
    expect(c.get("v")).toBeUndefined();
  });
  it("VC-5: clear() empties the cache", () => {
    const c = createViewColumnsCache({ ttlMs: 1000 });
    c.set("a", ["x"]);
    c.set("b", ["y"]);
    c.clear();
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeUndefined();
  });
});
