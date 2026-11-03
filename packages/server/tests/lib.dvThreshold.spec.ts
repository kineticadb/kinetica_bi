import { describe, it, expect } from "vitest";
import {
  decideThreshold,
  decideAfterPreflight,
  isAggregatedTemplate,
  buildOutputCountSql,
  decodeCountResult,
  isTableNotFoundError,
} from "../src/lib/dvThreshold";

describe("dvThreshold (Phase 139 D-02/D-03)", () => {
  it("THR-1: maxRecords 0 always materializes", () => {
    for (const aggregated of [true, false]) {
      expect(
        decideThreshold({ maxRecords: 0, sourceCount: 9e9, sourceKind: "base", aggregated, hasJoins: true }),
      ).toEqual({ kind: "materialize" });
    }
  });

  it("THR-2: under cap materializes; joins force preflight", () => {
    const base = { maxRecords: 100, sourceCount: 99, sourceKind: "filter" as const, aggregated: false };
    expect(decideThreshold(base)).toEqual({ kind: "materialize" });
    expect(decideThreshold({ ...base, hasJoins: true })).toEqual({ kind: "preflight" });
  });

  it("THR-3: non-aggregated at/over cap is over with reason by source kind", () => {
    const base = { maxRecords: 100, sourceCount: 100, aggregated: false };
    expect(decideThreshold({ ...base, sourceKind: "filter" })).toEqual({ kind: "over", reason: "exceeds_max_records" });
    expect(decideThreshold({ ...base, sourceKind: "base" })).toEqual({ kind: "over", reason: "no_filter" });
  });

  it("THR-4: aggregated over cap preflights", () => {
    expect(
      decideThreshold({ maxRecords: 100, sourceCount: 5_000_000, sourceKind: "base", aggregated: true }),
    ).toEqual({ kind: "preflight" });
  });

  it("THR-5: output rule is <=", () => {
    expect(decideAfterPreflight({ maxRecords: 100, outputCount: 100, sourceKind: "base" })).toEqual({ kind: "materialize" });
    expect(decideAfterPreflight({ maxRecords: 100, outputCount: 101, sourceKind: "filter" })).toEqual({
      kind: "over",
      reason: "exceeds_max_records",
    });
    expect(decideAfterPreflight({ maxRecords: 100, outputCount: 101, sourceKind: "base" })).toEqual({
      kind: "over",
      reason: "no_filter",
    });
  });

  it("THR-6: isAggregatedTemplate", () => {
    for (const t of [
      "SELECT vendor, AVG(fare) a FROM {view} GROUP BY vendor",
      "select distinct vendor from {view}",
      "SELECT * FROM {view} ORDER BY x LIMIT 50",
      "SELECT * FROM {view} limit 50;",
    ]) expect(isAggregatedTemplate(t), t).toBe(true);
    for (const t of [
      "SELECT * FROM {view}",
      "SELECT * FROM {view} WHERE note = 'GROUP BY x'",
      "SELECT * FROM {view} -- group by\n",
      "SELECT * /* DISTINCT */ FROM {view}",
      "SELECT * FROM {view} WHERE n = 'it''s distinct'",
    ]) expect(isAggregatedTemplate(t), t).toBe(false);
  });

  it("THR-7: buildOutputCountSql", () => {
    expect(buildOutputCountSql("SELECT a FROM t GROUP BY a", 100)).toBe(
      "SELECT COUNT(*) FROM (SELECT 1 AS kbi_x FROM (SELECT a FROM t GROUP BY a) AS kbi_q LIMIT 101) AS kbi_c",
    );
    expect(() => buildOutputCountSql("SELECT 1", 1.5)).toThrow();
    expect(() => buildOutputCountSql("SELECT 1", -1)).toThrow();
  });

  it("THR-8: decodeCountResult", () => {
    expect(decodeCountResult({ column_1: [7] })).toBe(7);
    expect(decodeCountResult({ column_1: ["12"] })).toBe(12);
    expect(decodeCountResult(null)).toBe(0);
  });

  it("THR-9: isTableNotFoundError", () => {
    for (const m of ["x TM/SMc:1078", "y S/SDc:1513", "Could not find the table z", "Object 'x' not found"])
      expect(isTableNotFoundError(new Error(m)), m).toBe(true);
    expect(isTableNotFoundError(new Error("permission denied"))).toBe(false);
  });
});
