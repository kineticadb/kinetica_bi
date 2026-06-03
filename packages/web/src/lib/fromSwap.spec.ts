import { describe, it, expect } from "vitest";
import { fromSwap } from "./fromSwap";

describe("fromSwap", () => {
  it("replaces FROM <table> with FROM <viewName>", () => {
    expect(fromSwap("SELECT * FROM mytable", "newview")).toBe("SELECT * FROM newview");
  });

  it("returns sql unchanged when viewName is undefined (FILT-V13-03 zero-overhead)", () => {
    expect(fromSwap("SELECT * FROM mytable", undefined)).toBe("SELECT * FROM mytable");
  });

  it("returns sql unchanged when viewName is null", () => {
    expect(fromSwap("SELECT * FROM mytable", null)).toBe("SELECT * FROM mytable");
  });

  it("returns sql unchanged when viewName is empty string", () => {
    expect(fromSwap("SELECT * FROM mytable", "")).toBe("SELECT * FROM mytable");
  });

  it("handles schema-qualified table names (ki_home.taxi)", () => {
    expect(fromSwap("SELECT * FROM ki_home.taxi", "_kbi_filt_v1")).toBe(
      "SELECT * FROM _kbi_filt_v1"
    );
  });

  it("preserves trailing GROUP BY / ORDER BY / LIMIT clauses", () => {
    const base = "SELECT g, COUNT(*) AS value FROM ki_home.taxi GROUP BY g ORDER BY value DESC LIMIT 100";
    const expected = "SELECT g, COUNT(*) AS value FROM _kbi_filt_v1 GROUP BY g ORDER BY value DESC LIMIT 100";
    expect(fromSwap(base, "_kbi_filt_v1")).toBe(expected);
  });

  it("is case-insensitive on the FROM keyword (lowercase from)", () => {
    expect(fromSwap("select * from mytable", "v")).toBe("select * FROM v");
  });

  it("replaces ONLY the FIRST FROM occurrence (defensive against future subqueries)", () => {
    const base = "SELECT * FROM outer WHERE x IN (SELECT y FROM inner)";
    const result = fromSwap(base, "v1");
    expect(result).toBe("SELECT * FROM v1 WHERE x IN (SELECT y FROM inner)");
    // The inner FROM stays bound to `inner`
  });

  it("handles realistic Phase 14 view-name shape (_kbi_filt_u<n>_d<n>_t<n>_s<hex8>)", () => {
    const viewName = "_kbi_filt_u1_d2_t3_sabcdef12";
    expect(fromSwap("SELECT * FROM ki_home.nyctaxi LIMIT 25", viewName)).toBe(
      `SELECT * FROM ${viewName} LIMIT 25`
    );
  });
});
