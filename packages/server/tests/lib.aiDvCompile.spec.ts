import { describe, it, expect } from "vitest";
import type { AiDvSpec } from "@kinetica-bi/shared";
import { validateAiDvSpec, compileAiDvSpec, AiDvCompileError, type AiDvTable, type AiDvLimits } from "../src/lib/aiDvCompile";
import { substituteViewToken } from "../src/lib/dynamicViewSql";

const T5: AiDvTable = {
  tableId: 5,
  ref: "demo.trips",
  columns: [
    { name: "vendor", type: "string" },
    { name: "fare", type: "double" },
    { name: "zone_id", type: "int" },
    { name: "pickup_datetime", type: "timestamp" },
    { name: "pickup_date", type: "date" },
    { name: "pickup_time", type: "time" },
    { name: "geom", type: "geometry" },
    { name: "notype" },
  ],
};
const T6: AiDvTable = {
  tableId: 6,
  ref: "demo.zones",
  columns: [
    { name: "id", type: "int" },
    { name: "borough", type: "string" },
    { name: "code", type: "string" },
  ],
};
const LIM: AiDvLimits = { maxRecords: 100000, maxJoins: 2 };
const summary = (over: Partial<AiDvSpec> = {}): AiDvSpec => ({
  baseTableId: 5,
  groupBy: [{ column: "vendor" }],
  aggregates: [{ fn: "count", as: "trips" }],
  ...over,
});
const reasons = (v: ReturnType<typeof validateAiDvSpec>) => (v.ok ? [] : v.reasons);

describe("validateAiDvSpec", () => {
  it("CMP-1: a valid summary passes", () => {
    expect(validateAiDvSpec(summary(), [T5], LIM)).toEqual({ ok: true });
  });

  it("CMP-2: unknown columns are reported per table", () => {
    const a = validateAiDvSpec(summary({ groupBy: [{ column: "fair" }] }), [T5], LIM);
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.reasons).toContain("column `fair` not found on demo.trips");
      expect(a.missing).toEqual([{ from: 0, tableId: 5, column: "fair" }]);
    }
    const b = validateAiDvSpec(
      { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] }], columns: [{ from: 1, column: "boro" }] },
      [T5, T6],
      LIM,
    );
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reasons).toContain("column `boro` not found on demo.zones");
      expect(b.missing[0]).toEqual({ from: 1, tableId: 6, column: "boro" });
    }
  });

  it("CMP-3: numeric aggregates need numeric columns", () => {
    const avg = validateAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "avg", column: "vendor", as: "a" }] }, [T5], LIM);
    expect(reasons(avg)).toContain("column vendor is not numeric");
    expect(validateAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "min", column: "vendor", as: "a" }] }, [T5], LIM).ok).toBe(true);
    expect(validateAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "count_distinct", column: "vendor", as: "a" }] }, [T5], LIM).ok).toBe(true);
  });

  it("CMP-4: bucket rules", () => {
    const b = (column: string, bucket: "hour" | "day" | "week") =>
      validateAiDvSpec({ baseTableId: 5, groupBy: [{ column, bucket }], aggregates: [{ fn: "count", as: "n" }] }, [T5], LIM);
    expect(b("pickup_datetime", "hour").ok).toBe(true);
    expect(reasons(b("pickup_date", "hour"))).toContain("column pickup_date is a date; use day, week, month or year");
    expect(b("pickup_date", "week").ok).toBe(true);
    expect(reasons(b("pickup_time", "day"))).toContain("column pickup_time is a time of day and can't be bucketed");
    expect(reasons(b("fare", "day"))).toContain("column fare is not a date or time column");
    expect(reasons(b("notype", "day"))).toContain("column notype is not a date or time column");
  });

  it("CMP-5: join rules", () => {
    const j = (left: string, right: string) =>
      validateAiDvSpec(
        { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left, right }] }], columns: [{ column: "vendor" }] },
        [T5, T6],
        LIM,
      );
    expect(j("zone_id", "id").ok).toBe(true);
    expect(reasons(j("zone_id", "borough"))).toContain("join 1: zone_id and borough have different types");
    expect(reasons(j("geom", "id"))).toContain("column geom can't be a join key");
    const three: AiDvSpec = {
      baseTableId: 5,
      joins: [1, 2, 3].map(() => ({ tableId: 6, type: "inner" as const, on: [{ left: "zone_id", right: "id" }] })),
      columns: [{ column: "vendor" }],
    };
    expect(reasons(validateAiDvSpec(three, [T5, T6, T6, T6], LIM))).toContain("a view can join at most 2 tables");
  });

  it("CMP-6: filters coerce per column type and never echo values", () => {
    const r = validateAiDvSpec(
      summary({ filters: [{ column: "fare", operator: "eq", value: "abc" }] }),
      [T5],
      LIM,
    );
    expect(reasons(r)).toContain("column fare needs a number");
    const s = validateAiDvSpec(
      summary({ filters: [{ column: "fare", operator: "eq", value: "SECRETVAL_139" }, { column: "nope", operator: "eq", value: "SECRETVAL_139" }] }),
      [T5],
      LIM,
    );
    expect(JSON.stringify(s)).not.toContain("SECRETVAL_139");
  });

  it("CMP-7: limit over the ceiling", () => {
    expect(reasons(validateAiDvSpec({ baseTableId: 5, columns: [{ column: "vendor" }], limit: 200000 }, [T5], LIM))).toContain(
      "limit 200000 is over the 100000-row ceiling",
    );
  });

  it("CMP-8: tables must be [base, ...joins]", () => {
    const spec: AiDvSpec = { baseTableId: 5, joins: [{ tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] }], columns: [{ column: "vendor" }] };
    expect(() => validateAiDvSpec(spec, [T5], LIM)).toThrow("tables must be [base, ...joins]");
  });

  it("CMP-9: spec shape failures are reported", () => {
    const r = validateAiDvSpec({ baseTableId: 5, columns: [{ column: "vendor" }], groupBy: [{ column: "vendor" }] }, [T5], LIM);
    expect(reasons(r)).toContain("use columns for a row view, or groupBy/aggregates for a summary, not both");
  });

  it("CMP-10: all reasons together, capped at 10, shape first", () => {
    const r = validateAiDvSpec(
      {
        baseTableId: 5,
        columns: [{ column: "fair" }],
        groupBy: [{ column: "fare", bucket: "day" }],
        aggregates: [{ fn: "avg", column: "vendor", as: "a" }],
        filters: [{ column: "fare", operator: "eq", value: "abc" }],
        limit: 200000,
      },
      [T5],
      LIM,
    );
    const rs = reasons(r);
    expect(rs.length).toBeGreaterThanOrEqual(4);
    expect(rs.length).toBeLessThanOrEqual(10);
    expect(rs[0]).toContain("not both");
    expect(rs.indexOf("column `fair` not found on demo.trips")).toBeLessThan(rs.indexOf("column vendor is not numeric"));
    expect(rs.indexOf("column vendor is not numeric")).toBeLessThan(rs.indexOf("column fare needs a number"));
  });
});

const JOIN: AiDvSpec = {
  baseTableId: 5,
  joins: [{ tableId: 6, type: "left", on: [{ left: "zone_id", right: "id" }] }],
  columns: [{ column: "vendor" }, { from: 1, column: "borough" }],
  filters: [{ column: "vendor", operator: "eq", value: "CMT" }],
  limit: 500,
};

describe("compileAiDvSpec", () => {
  it("CMP-11: summary exact SQL", () => {
    const c = compileAiDvSpec(
      {
        baseTableId: 5,
        groupBy: [{ column: "pickup_datetime", bucket: "hour", as: "pickup_hour" }],
        aggregates: [
          { fn: "count", as: "trips" },
          { fn: "percentile", column: "fare", p: 90, as: "fare_p90" },
          { fn: "median", column: "fare", as: "fare_median" },
        ],
        sort: [{ by: "trips", dir: "desc" }],
      },
      [T5],
      LIM,
    );
    expect(c.template).toBe(
      `SELECT DATE_TRUNC('HOUR', t0."pickup_datetime") AS "pickup_hour", COUNT(*) AS "trips", APPROX_PERCENTILE(t0."fare", 90) AS "fare_p90", APPROX_MEDIAN(t0."fare") AS "fare_median" FROM {view} AS t0 GROUP BY DATE_TRUNC('HOUR', t0."pickup_datetime") ORDER BY "trips" DESC`,
    );
    expect(c.columns).toEqual([
      { name: "pickup_hour", type: "datetime" },
      { name: "trips", type: "long" },
      { name: "fare_p90", type: "double" },
      { name: "fare_median", type: "double" },
    ]);
    expect(c.aggregated).toBe(true);
    expect(c.maxRecords).toBe(100000);
  });

  it("CMP-12: row view with join and filter exact SQL", () => {
    const c = compileAiDvSpec(JOIN, [T5, T6], LIM);
    expect(c.template).toBe(
      `SELECT t0."vendor" AS "vendor", t1."borough" AS "borough" FROM {view} AS t0 LEFT JOIN demo.zones AS t1 ON t0."zone_id" = t1."id" WHERE t0."vendor" = 'CMT' LIMIT 500`,
    );
    expect(c.aggregated).toBe(false);
    expect(c.columns).toEqual([{ name: "vendor", type: "string" }, { name: "borough", type: "string" }]);
  });

  it("CMP-13: joinRefs override the join FROM only for session", () => {
    const ref = "_kbi_filt_ualice_d12_t6_s01234567_cabcdef12";
    expect(compileAiDvSpec(JOIN, [T5, T6], LIM, { joinRefs: [ref] }).template).toContain(`LEFT JOIN ${ref} AS t1`);
    expect(compileAiDvSpec(JOIN, [T5, T6], LIM).template).toContain("LEFT JOIN demo.zones AS t1");
  });

  it("CMP-14: every bucket unit in select and GROUP BY", () => {
    for (const u of ["minute", "hour", "day", "week", "month", "year"] as const) {
      const t = compileAiDvSpec(
        { baseTableId: 5, groupBy: [{ column: "pickup_datetime", bucket: u }], aggregates: [{ fn: "count", as: "n" }] },
        [T5],
        LIM,
      ).template;
      const expr = `DATE_TRUNC('${u.toUpperCase()}', t0."pickup_datetime")`;
      expect(t.split(expr).length).toBe(3);
    }
  });

  it("CMP-15: aggregate forms", () => {
    const t = compileAiDvSpec(
      {
        baseTableId: 5,
        aggregates: [
          { fn: "count", column: "fare", as: "a" },
          { fn: "count_distinct", column: "vendor", as: "b" },
          { fn: "sum", column: "fare", as: "c" },
          { fn: "avg", column: "fare", as: "d" },
          { fn: "min", column: "fare", as: "e" },
          { fn: "max", column: "fare", as: "f" },
        ],
      },
      [T5],
      LIM,
    ).template;
    for (const s of ['COUNT(t0."fare")', 'COUNT(DISTINCT t0."vendor")', 'SUM(t0."fare")', 'AVG(t0."fare")', 'MIN(t0."fare")', 'MAX(t0."fare")']) {
      expect(t).toContain(s);
    }
    expect(t).not.toContain("COUNT_DISTINCT(");
    expect(t).not.toContain("GROUP BY");
  });

  it("CMP-16: values escaped, in/between forms quoted", () => {
    const t = compileAiDvSpec(
      summary({
        filters: [
          { column: "vendor", operator: "eq", value: "O'Brien" },
          { column: "vendor", operator: "in", value: ["a", "b'c"] },
          { column: "fare", operator: "between", value: [1, 9] },
        ],
      }),
      [T5],
      LIM,
    ).template;
    expect(t).toContain(`t0."vendor" = 'O''Brien'`);
    expect(t).toContain(`t0."vendor" IN ('a', 'b''c')`);
    expect(t).toContain(`t0."fare" BETWEEN 1 AND 9`);
  });

  it("CMP-17: Keep-compat property over varied specs", () => {
    const specs: AiDvSpec[] = [
      JOIN,
      { baseTableId: 5, columns: [{ column: "vendor", as: "v" }, { column: "fare" }] },
      summary(),
      summary({ filters: [{ column: "fare", operator: "between", value: [1, 5] }, { column: "vendor", operator: "isNull" }] }),
      { baseTableId: 5, aggregates: [{ fn: "median", column: "fare", as: "m" }, { fn: "max", column: "pickup_datetime", as: "mx" }] },
      { baseTableId: 5, groupBy: [{ column: "pickup_date", bucket: "month" }], aggregates: [{ fn: "avg", column: "fare", as: "af" }], sort: [{ by: "af", dir: "asc" }] },
      { ...JOIN, joins: [{ tableId: 6, type: "inner", on: [{ left: "zone_id", right: "id" }] }], limit: undefined },
      { baseTableId: 5, joins: [{ tableId: 6, type: "left", on: [{ left: "zone_id", right: "id" }] }], groupBy: [{ from: 1, column: "borough" }], aggregates: [{ fn: "count_distinct", column: "vendor", as: "nv" }] },
    ];
    const known = new Set([...T5.columns, ...T6.columns].map((c) => c.name));
    for (const spec of specs) {
      const tbls = spec.joins ? [T5, T6] : [T5];
      const c = compileAiDvSpec(spec, tbls, LIM);
      expect(c.template.split("{view}").length).toBe(2);
      expect(() => substituteViewToken(c.template, "_dummy_validation_view_name_")).not.toThrow();
      const outs = new Set(aiOut(spec));
      for (const m of c.template.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) expect(known.has(m[1]) || outs.has(m[1])).toBe(true);
      // no bare quoted identifier outside alias-qualified refs / AS aliases / ORDER BY output names
      const body = c.template.replace(/'[^']*'/g, "''").replace(/ AS "[A-Za-z_][A-Za-z0-9_]*"/g, "").split(" ORDER BY ")[0];
      expect(body).not.toMatch(/(?<!\.)"[A-Za-z_][A-Za-z0-9_]*"/);
      expect(body.match(/t\d+\."[A-Za-z_][A-Za-z0-9_]*"/g)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("CMP-18: invalid spec throws AiDvCompileError with the validation reasons", () => {
    const spec = summary({ groupBy: [{ column: "fair" }] });
    const v = validateAiDvSpec(spec, [T5], LIM);
    try {
      compileAiDvSpec(spec, [T5], LIM);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AiDvCompileError);
      expect((e as AiDvCompileError).reasons).toEqual(v.ok ? [] : v.reasons);
    }
  });

  it("CMP-19: output types", () => {
    const c = compileAiDvSpec(
      { baseTableId: 5, aggregates: [{ fn: "min", column: "pickup_datetime", as: "a" }, { fn: "max", column: "vendor", as: "b" }] },
      [T5],
      LIM,
    );
    expect(c.columns).toEqual([{ name: "a", type: "timestamp" }, { name: "b", type: "string" }]);
    expect(compileAiDvSpec({ baseTableId: 5, columns: [{ column: "notype" }] }, [T5], LIM).columns).toEqual([{ name: "notype", type: "unknown" }]);
  });

  it("CMP-20: percentile literal", () => {
    const t = compileAiDvSpec({ baseTableId: 5, aggregates: [{ fn: "percentile", column: "fare", p: 99.5, as: "p" }] }, [T5], LIM).template;
    expect(t).toContain('APPROX_PERCENTILE(t0."fare", 99.5)');
  });
});

import { aiDvOutputNames } from "@kinetica-bi/shared";
const aiOut = (s: AiDvSpec) => aiDvOutputNames(s);
