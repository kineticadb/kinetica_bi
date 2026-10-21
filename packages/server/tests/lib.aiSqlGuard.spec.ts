import { describe, it, expect } from "vitest";
import {
  guardQuery, substituteViewAliases, GUARD_REASONS, GUARD_MAX_SQL_CHARS, functionNotAllowed, tableNotInScope,
} from "../src/lib/ai/sqlGuard.js";

const scope = { allowed: new Set(["demo.trips", "demo.zones", "dv_7", "aidv_101"]) };
const names = (r: Awaited<ReturnType<typeof guardQuery>>) =>
  r.ok ? r.tables.map((t) => (t.schema ? `${t.schema}.${t.name}` : t.name)).sort() : [];

const accept: [string, string, string[]][] = [
  ["SQG-A01", "SELECT * FROM demo.trips", ["demo.trips"]],
  ["SQG-A02", "SELECT vendor, COUNT(*) AS n FROM demo.trips GROUP BY vendor ORDER BY n DESC LIMIT 10", ["demo.trips"]],
  ["SQG-A03", "WITH t AS (SELECT vendor, fare FROM demo.trips) SELECT vendor, AVG(fare) FROM t GROUP BY vendor", ["demo.trips"]],
  ["SQG-A04", "SELECT t.vendor, z.borough FROM demo.trips t JOIN demo.zones z ON t.zone_id = z.id", ["demo.trips", "demo.zones"]],
  ["SQG-A05", "SELECT * FROM demo.trips WHERE zone_id IN (SELECT id FROM demo.zones WHERE borough = 'Queens')", ["demo.trips", "demo.zones"]],
  ["SQG-A06", "SELECT vendor, LAG(fare) OVER (PARTITION BY vendor ORDER BY pickup ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM demo.trips", ["demo.trips"]],
  ["SQG-A07", "SELECT vendor FROM demo.trips UNION SELECT borough FROM demo.zones", ["demo.trips", "demo.zones"]],
  ["SQG-A08", "SELECT vendor FROM demo.trips EXCEPT SELECT borough FROM demo.zones", ["demo.trips", "demo.zones"]],
  ["SQG-A09", "SELECT DATE_TRUNC('hour', pickup) AS h, COUNT(*) FROM demo.trips GROUP BY 1", ["demo.trips"]],
  ["SQG-A10", "SELECT EXTRACT(YEAR FROM pickup), TRIM(vendor), SUBSTRING(vendor FROM 1 FOR 2), pickup AT TIME ZONE 'UTC' FROM demo.trips", ["demo.trips"]],
  ["SQG-A11", "SELECT CAST(fare AS INT), fare::int, INTERVAL '1' DAY, COALESCE(fare, 0) FROM demo.trips", ["demo.trips"]],
  ["SQG-A12", "SELECT APPROX_MEDIAN(fare), APPROX_PERCENTILE(fare, 90) FROM demo.trips", ["demo.trips"]],
  ["SQG-A13a", 'SELECT * FROM "demo"."trips"', ["demo.trips"]],
  ["SQG-A13b", "SELECT * FROM DEMO.TRIPS", ["demo.trips"]],
  ["SQG-A14", "SELECT * FROM demo.trips FETCH FIRST 5 ROWS ONLY", ["demo.trips"]],
  ["SQG-A15a", "SELECT * FROM dv_7", ["dv_7"]],
  ["SQG-A15b", "SELECT * FROM aidv_101 a JOIN demo.trips t ON a.vendor = t.vendor", ["aidv_101", "demo.trips"]],
  ["SQG-A16", "WITH ki_objects AS (SELECT * FROM demo.trips) SELECT * FROM ki_objects", ["demo.trips"]],
  ["SQG-A17", "SELECT ST_X(geom), STXY_DISTANCE(lon, lat, 0, 0) FROM demo.trips", ["demo.trips"]],
  ["SQG-A18", "SELECT * FROM demo.trips WHERE vendor = 'Zürich'", ["demo.trips"]],
];

describe("guardQuery accepts", () => {
  for (const [id, sql, tables] of accept) {
    it(`${id} ${sql.slice(0, 50)}`, async () => {
      const r = await guardQuery(sql, scope);
      expect(r).toMatchObject({ ok: true });
      expect(names(r)).toEqual([...tables].sort());
    });
  }
});

const R = GUARD_REASONS;
const secret = (s: string) => s;
const refuse: [string, string, string][] = [
  ["SQG-R01", "SELECT * FROM demo.trips; DROP TABLE demo.trips", R.badChars],
  ["SQG-R02", "SELECT * FROM demo.trips WHERE vendor = 'a;b'", R.badChars],
  ["SQG-R03", "SELECT * FROM demo.trips -- x", R.badChars],
  ["SQG-R04", "SELECT /* x */ * FROM demo.trips", R.badChars],
  ["SQG-R05", "SELECT * FROM demo.trips WHERE vendor = '--'", R.badChars],
  ["SQG-R06", "SELECT * FROM demo.trips WHERE vendor = 'x\\' OR 1=1", R.badChars],
  ["SQG-R07", "SELECT 1 # 2 FROM demo.trips", R.badChars],
  ["SQG-R08a", "SELECT $1 FROM demo.trips", R.badChars],
  ["SQG-R08b", "SELECT $$x$$ FROM demo.trips", R.badChars],
  ["SQG-R09", "SELECT * FROM `demo`.trips", R.badChars],
  ["SQG-R10a", "SELECT * FROM demo.trips\u0000", R.badChars],
  ["SQG-R10b", "SELECT * FROM demo.trips\u001b", R.badChars],
  ["SQG-R11", "SELECT * FROM demo.trips WHERE vendor IN ('" + "a".repeat(GUARD_MAX_SQL_CHARS) + "')", R.tooLong],
  ["SQG-R12", "   ", R.empty],
  ["SQG-R13a", "INSERT INTO demo.trips VALUES (1)", R.notSelect],
  ["SQG-R13b", "UPDATE demo.trips SET fare = 1", R.notSelect],
  ["SQG-R13c", "DELETE FROM demo.trips", R.notSelect],
  ["SQG-R13d", "CREATE TABLE demo.x AS SELECT * FROM demo.trips", R.notSelect],
  ["SQG-R13e", "DROP TABLE demo.trips", R.notSelect],
  ["SQG-R13f", "EXPLAIN SELECT * FROM demo.trips", R.notSelect],
  ["SQG-R13g", "COPY demo.trips TO 'f'", R.notSelect],
  ["SQG-R14", "SELECT * INTO demo.copy FROM demo.trips", R.into],
  ["SQG-R15", "SELECT * FROM demo.trips FOR UPDATE", R.locking],
  ["SQG-R16", "WITH RECURSIVE r AS (SELECT 1 AS n UNION SELECT n FROM r) SELECT * FROM r", R.recursive],
  ["SQG-R17a", "WITH x AS (DELETE FROM demo.trips RETURNING *) SELECT * FROM x", R.dataModifying],
  ["SQG-R17b", "WITH x AS (INSERT INTO demo.trips VALUES (1) RETURNING *) SELECT * FROM x", R.dataModifying],
  ["SQG-R18a", "SELECT * FROM generate_series(1, 10)", R.tableFunction],
  ["SQG-R18b", "SELECT * FROM demo.trips, LATERAL generate_series(1, 2)", R.tableFunction],
  ["SQG-R19a", "SELECT pg_sleep(10) FROM demo.trips", functionNotAllowed("pg_sleep")],
  ["SQG-R19b", "SELECT myschema.fn(fare) FROM demo.trips", functionNotAllowed("myschema.fn")],
  ["SQG-R20a", "SELECT * FROM ki_catalog.ki_objects", R.system],
  ["SQG-R20b", "SELECT * FROM information_schema.tables", R.system],
  ["SQG-R20c", "SELECT * FROM pg_catalog.pg_class", R.system],
  ["SQG-R20d", "SELECT * FROM demo.trips WHERE EXISTS (SELECT 1 FROM ki_catalog.ki_users)", R.system],
  ["SQG-R21", "SELECT * FROM cat.demo.trips", R.catalog],
  ["SQG-R22", "SELECT 1", R.noTable],
  ["SQG-R23", "SELECT * FROM demo.secret", tableNotInScope("demo.secret")],
  ["SQG-R24", "SELECT * FROM trips", tableNotInScope("trips", "demo.trips")],
  ["SQG-R25", "SELECT * FROM _kbi_dv_ubob_d5_7", tableNotInScope("_kbi_dv_ubob_d5_7")],
  ["SQG-R26", "WITH a AS (SELECT * FROM b), b AS (SELECT * FROM demo.trips) SELECT * FROM a", tableNotInScope("b")],
  ["SQG-R27a", "SELECT * FROM demo.trips WHERE x IN (SELECT id FROM demo.secret)", tableNotInScope("demo.secret")],
  ["SQG-R27b", "SELECT vendor FROM demo.trips GROUP BY vendor HAVING COUNT(*) > (SELECT COUNT(*) FROM demo.secret)", tableNotInScope("demo.secret")],
  ["SQG-R27c", "SELECT * FROM demo.trips ORDER BY (SELECT MAX(a) FROM demo.secret)", tableNotInScope("demo.secret")],
  ["SQG-R27d", "SELECT CASE WHEN EXISTS (SELECT 1 FROM demo.secret) THEN 1 ELSE 0 END FROM demo.trips", tableNotInScope("demo.secret")],
  ["SQG-R27e", "SELECT (SELECT MAX(a) FROM demo.secret) AS m FROM demo.trips", tableNotInScope("demo.secret")],
  ["SQG-R27f", "SELECT * FROM demo.trips t, LATERAL (SELECT * FROM demo.secret s WHERE s.a = t.a) q", tableNotInScope("demo.secret")],
  ["SQG-R27g", "SELECT vendor FROM demo.trips UNION SELECT a FROM demo.secret", tableNotInScope("demo.secret")],
  ["SQG-R27h", "SELECT * FROM demo.trips t LEFT JOIN demo.secret s ON t.a = s.a", tableNotInScope("demo.secret")],
  ["SQG-R28a", "SELECT TOP 5 * FROM demo.trips", R.unparseable],
  ["SQG-R28b", "SELECT * FROM demo.trips LIMIT 5, 10", R.unparseable],
  ["SQG-R28c", "SELECT * FROM demo.trips QUALIFY ROW_NUMBER() OVER () = 1", R.unparseable],
  ["SQG-R28d", "SELECT * FROM TABLE(fn())", R.unparseable],
  ["SQG-R28e", "SELECT * FROM demo.trips PIVOT (SUM(fare) FOR vendor IN ('a'))", R.unparseable],
];

describe("guardQuery refuses", () => {
  for (const [id, sql, reason] of refuse) {
    it(`${id} ${secret(sql).slice(0, 50).replace(/[\u0000-\u001f]/g, "?")}`, async () => {
      expect(await guardQuery(sql, scope)).toEqual({ ok: false, reason });
    });
  }
});

describe("guardQuery reasons never leak SQL", () => {
  for (const [id, sql] of [
    ["SQG-L1", "SELECT * FROM demo.trips QUALIFY 'CANARY_SQG_9z' = 'x'"],
    ["SQG-L2", "DELETE FROM demo.trips WHERE vendor = 'CANARY_SQG_9z'"],
  ]) {
    it(id, async () => {
      const r = await guardQuery(sql, scope);
      expect(r.ok).toBe(false);
      const reason = r.ok ? "" : r.reason;
      expect(reason).not.toContain("CANARY_SQG_9z");
      expect(reason).not.toContain("syntax error at or near");
    });
  }
});

describe("guardQuery columnNames", () => {
  it("SQG-C columnNames lists referenced columns lower-cased", async () => {
    const r = await guardQuery("SELECT vendor, t.Fare FROM demo.trips t", scope);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.columnNames).toEqual(expect.arrayContaining(["vendor", "fare"]));
  });
});

const PH7 = "_kbi_dv_uann_d1_7";
const PH101 = "_kbi_ai_uann_sabcd1234_n0a1b2c3d_101_g1";
const aliases = new Map([["dv_7", PH7], ["aidv_101", PH101]]);
async function sub(sql: string) {
  const g = await guardQuery(sql, scope);
  if (!g.ok) throw new Error(`guard refused: ${g.reason}`);
  return substituteViewAliases(sql, g.tables, aliases);
}

describe("substituteViewAliases", () => {
  it("SQG-S1 replaces a FROM alias", async () => {
    expect(await sub("SELECT * FROM dv_7")).toEqual({ ok: true, sql: `SELECT * FROM ${PH7}` });
  });
  it("SQG-S2 replaces join + subquery aliases only", async () => {
    expect(await sub("SELECT * FROM dv_7 d JOIN demo.trips t ON d.v = t.v WHERE t.z IN (SELECT z FROM aidv_101)")).toEqual({
      ok: true,
      sql: `SELECT * FROM ${PH7} d JOIN demo.trips t ON d.v = t.v WHERE t.z IN (SELECT z FROM ${PH101})`,
    });
  });
  it("SQG-S3 leaves a column alias named like a view", async () => {
    expect(await sub("SELECT vendor AS dv_7 FROM dv_7")).toEqual({ ok: true, sql: `SELECT vendor AS dv_7 FROM ${PH7}` });
  });
  it("SQG-S4 leaves a CTE named like a view", async () => {
    const q = "WITH dv_7 AS (SELECT * FROM demo.trips) SELECT * FROM dv_7";
    expect(await sub(q)).toEqual({ ok: true, sql: q });
  });
  it("SQG-S5 handles multi-byte literals before the reference", async () => {
    expect(await sub("SELECT 'Zürich' AS c FROM aidv_101")).toEqual({ ok: true, sql: `SELECT 'Zürich' AS c FROM ${PH101}` });
  });
  it("SQG-S6 refuses a quoted alias", async () => {
    expect(await sub('SELECT * FROM "dv_7"')).toEqual({ ok: false, reason: GUARD_REASONS.aliasUnresolved });
  });
  it("SQG-S7 round trip: pass 2 accepts physical names; pass 1 would refuse them", async () => {
    const model = "SELECT * FROM dv_7 d JOIN demo.trips t ON d.v = t.v";
    const s = await sub(model);
    expect(s.ok).toBe(true);
    const out = s.ok ? s.sql : "";
    const pass2 = { allowed: new Set(["demo.trips", PH7.toLowerCase(), PH101.toLowerCase()]) };
    expect(await guardQuery(out, pass2)).toMatchObject({ ok: true });
    expect(await guardQuery(out, scope)).toMatchObject({ ok: false });
  });
});
