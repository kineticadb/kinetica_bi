import { describe, it, expect } from "vitest";
import {
  buildLatLonQuery,
  buildWktQuery,
  buildWkbQuery,
  type SpatialMode,
  type SpatialQueryArgs,
} from "../src/lib/spatialQuery";

describe("buildLatLonQuery (SPATIAL-V14-01 — GEODIST)", () => {
  it("emits the locked GEODIST template with LIMIT 50 OFFSET 0 at page=0", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "events",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    expect(buildLatLonQuery(args)).toBe(
      "SELECT * FROM ki_home.events WHERE GEODIST(lon, lat, -73.95, 40.75) <= 500 ORDER BY GEODIST(lon, lat, -73.95, 40.75) ASC LIMIT 50 OFFSET 0"
    );
  });

  it("emits OFFSET 100 at page=2 (page * 50)", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "events",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 2,
    };
    expect(buildLatLonQuery(args)).toContain("OFFSET 100");
  });

  it("emits ORDER BY <distance_expr> ASC and LIMIT 50 (per SPATIAL-V14-04)", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "events",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    const sql = buildLatLonQuery(args);
    expect(sql).toMatch(/ORDER BY .* ASC/);
    expect(sql).toContain("LIMIT 50");
  });
});

describe("buildWktQuery (SPATIAL-V14-02 — STXY_DISTANCE direct, NO ST_GEOMFROMTEXT)", () => {
  it("emits the locked STXY_DISTANCE template with raw (x, y) — no ST_GEOMFROMTEXT wrap", () => {
    const args: SpatialQueryArgs = {
      schema: "demo",
      table: "shapes",
      spatialColumns: { wktCol: "geom" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 0,
    };
    const sql = buildWktQuery(args);
    expect(sql).toBe(
      "SELECT * FROM demo.shapes WHERE STXY_DISTANCE(geom, -73.95, 40.75) <= 0.01 ORDER BY STXY_DISTANCE(geom, -73.95, 40.75) ASC LIMIT 50 OFFSET 0"
    );
    // Locked decision: raw click point passed directly; no per-query WKT parsing
    expect(sql).not.toContain("ST_GEOMFROMTEXT");
  });

  it("emits OFFSET 50 at page=1 (page * 50)", () => {
    const args: SpatialQueryArgs = {
      schema: "demo",
      table: "shapes",
      spatialColumns: { wktCol: "geom" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 1,
    };
    expect(buildWktQuery(args)).toContain("OFFSET 50");
  });

  it("emits ORDER BY STXY_DISTANCE(...) ASC LIMIT 50", () => {
    const args: SpatialQueryArgs = {
      schema: "demo",
      table: "shapes",
      spatialColumns: { wktCol: "geom" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 0,
    };
    const sql = buildWktQuery(args);
    expect(sql).toMatch(/ORDER BY STXY_DISTANCE\([^)]+\) ASC/);
    expect(sql).toContain("LIMIT 50");
  });
});

describe("buildWkbQuery (SPATIAL-V14-03 — Kinetica geometry column via ST_DISTANCE)", () => {
  it("emits ST_DISTANCE with ST_GEOMFROMTEXT('POINT(x y)') for the click point — NOT STXY_DISTANCE (which rejects geometry columns)", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "us_states",
      spatialColumns: { wkbCol: "WKT" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 0,
    };
    expect(buildWkbQuery(args)).toBe(
      "SELECT * FROM ki_home.us_states WHERE ST_DISTANCE(WKT, ST_GEOMFROMTEXT('POINT(-73.95 40.75)')) <= 0.01 ORDER BY ST_DISTANCE(WKT, ST_GEOMFROMTEXT('POINT(-73.95 40.75)')) ASC LIMIT 50 OFFSET 0"
    );
    // Regression guard: ensure we never go back to STXY_DISTANCE for this mode
    // (Kinetica rejects: "function: 'stxy_distance' has invalid argument list: geometry,...")
    expect(buildWkbQuery(args)).not.toContain("STXY_DISTANCE");
  });

  it("emits OFFSET 100 at page=2 (page * 50)", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "us_states",
      spatialColumns: { wkbCol: "geom" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 2,
    };
    expect(buildWkbQuery(args)).toContain("OFFSET 100");
  });

  it("uses FROM <viewName> when a filter view is provided", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "us_states",
      viewName: "_kbi_filt_ualice_d1_t29_sabcdef00",
      spatialColumns: { wkbCol: "geom" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 0,
    };
    const sql = buildWkbQuery(args);
    expect(sql).toContain("FROM _kbi_filt_ualice_d1_t29_sabcdef00");
    expect(sql).not.toContain("FROM ki_home.us_states");
  });
});

describe("Cross-builder invariants (SPATIAL-V14-04 endpoint contract)", () => {
  it("buildLatLonQuery + buildWktQuery both emit ORDER BY ... ASC (closest first)", () => {
    const baseArgs = {
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    const latLonSql = buildLatLonQuery({
      ...baseArgs,
      schema: "s",
      table: "t",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
    });
    const wktSql = buildWktQuery({
      ...baseArgs,
      schema: "s",
      table: "t",
      spatialColumns: { wktCol: "geom" },
    });
    expect(latLonSql).toMatch(/ORDER BY .* ASC/);
    expect(wktSql).toMatch(/ORDER BY .* ASC/);
  });

  it("buildLatLonQuery + buildWktQuery both embed LIMIT 50 (per-page limit)", () => {
    const baseArgs = {
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    expect(
      buildLatLonQuery({
        ...baseArgs,
        schema: "s",
        table: "t",
        spatialColumns: { lonCol: "lon", latCol: "lat" },
      })
    ).toContain("LIMIT 50");
    expect(
      buildWktQuery({
        ...baseArgs,
        schema: "s",
        table: "t",
        spatialColumns: { wktCol: "geom" },
      })
    ).toContain("LIMIT 50");
  });

  it("does not throw when schema or table contain unusual chars (admin-trusted boundary)", () => {
    // Trust boundary documented in module header: schema/table/column names are
    // admin-supplied via server-side metadata, NOT user input. No quoting / no throw.
    const args: SpatialQueryArgs = {
      schema: "weird.schema",
      table: "table with space",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    expect(() => buildLatLonQuery(args)).not.toThrow();
    expect(typeof buildLatLonQuery(args)).toBe("string");
  });
});

describe("SpatialMode union (type-only export)", () => {
  it("SpatialMode accepts 'latlon' | 'wkt' | 'wkb' (compile-time check)", () => {
    // This compiles iff the union shape is correct — runtime check is a no-op.
    const modes: SpatialMode[] = ["latlon", "wkt", "wkb"];
    expect(modes.length).toBe(3);
  });
});

describe("viewName override (v1.3 filter-view alignment)", () => {
  it("buildLatLonQuery uses FROM <viewName> (unqualified) when viewName is provided", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "events",
      viewName: "_kbi_filt_ualice_d1_t7_s12345678",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    const sql = buildLatLonQuery(args);
    expect(sql).toContain("FROM _kbi_filt_ualice_d1_t7_s12345678 WHERE");
    expect(sql).not.toContain("FROM ki_home.events");
  });

  it("buildWktQuery uses FROM <viewName> (unqualified) when viewName is provided", () => {
    const args: SpatialQueryArgs = {
      schema: "demo",
      table: "shapes",
      viewName: "_kbi_filt_ualice_d2_t9_sabcdef00",
      spatialColumns: { wktCol: "geom" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 0.01,
      page: 0,
    };
    const sql = buildWktQuery(args);
    expect(sql).toContain("FROM _kbi_filt_ualice_d2_t9_sabcdef00 WHERE");
    expect(sql).not.toContain("FROM demo.shapes");
  });

  it("falls through to FROM <schema>.<table> when viewName is undefined", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "events",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    expect(buildLatLonQuery(args)).toContain("FROM ki_home.events");
  });

  it("falls through to FROM <schema>.<table> when viewName is the empty string (treated as absent)", () => {
    const args: SpatialQueryArgs = {
      schema: "ki_home",
      table: "events",
      viewName: "",
      spatialColumns: { lonCol: "lon", latCol: "lat" },
      clickLon: -73.95,
      clickLat: 40.75,
      radiusGroundDistance: 500,
      page: 0,
    };
    expect(buildLatLonQuery(args)).toContain("FROM ki_home.events");
  });
});
