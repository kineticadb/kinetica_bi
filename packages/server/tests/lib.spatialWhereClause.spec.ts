import { describe, it, expect } from "vitest";
import {
  buildSpatialOrBlock,
  composeWhereClause,
  SpatialFilterWkbDeferredError,
  type SpatialFilter,
  type SpatialTarget,
} from "../src/lib/spatialWhereClause";
import type { ActiveFilter } from "../src/lib/whereClause";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const latlonTarget: SpatialTarget = {
  tableId: 1,
  spatialMode: "latlon",
  lonCol: "lon",
  latCol: "lat",
};
const wktTarget: SpatialTarget = {
  tableId: 1,
  spatialMode: "wkt",
  spatialCol: "geom",
};
const wkbTarget: SpatialTarget = {
  tableId: 1,
  spatialMode: "wkb",
  spatialCol: "geom",
};
const s1: SpatialFilter = { id: "s1", wkt: "w1" };
const s2: SpatialFilter = { id: "s2", wkt: "w2" };
const s3: SpatialFilter = { id: "s3", wkt: "w3" };
const colFilter: ActiveFilter = {
  column: "zone",
  value: "East Village",
  dataType: "string",
  addedAt: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildSpatialOrBlock — V15-P-07 paren correctness", () => {
  it("returns empty string for zero shapes", () => {
    expect(buildSpatialOrBlock([], latlonTarget)).toBe("");
  });

  it("single shape wraps in outer parens (V15-P-07 invariant — single-shape bug is invisible)", () => {
    expect(buildSpatialOrBlock([s1], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"
    );
  });

  it("two shapes: outer parens + single space around OR", () => {
    expect(buildSpatialOrBlock([s1, s2], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1)"
    );
  });

  it("three shapes: two OR separators, outer parens", () => {
    expect(buildSpatialOrBlock([s1, s2, s3], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w3')) = 1)"
    );
  });

  it("wkt mode uses ST_INTERSECTS (NOT ST_WITHIN — 25-SPIKE-NOTES §3.2)", () => {
    expect(buildSpatialOrBlock([s1], wktTarget)).toBe(
      "(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('w1')) = 1)"
    );
  });

  it("escapes single quotes in shape.wkt via SQL standard doubling", () => {
    const shape: SpatialFilter = { id: "s1", wkt: "O'Brien" };
    expect(buildSpatialOrBlock([shape], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('O''Brien')) = 1)"
    );
  });

  it("wkb mode throws SpatialFilterWkbDeferredError (TD-V14-WKB-SPIKE)", () => {
    expect(() => buildSpatialOrBlock([s1], wkbTarget)).toThrow(SpatialFilterWkbDeferredError);
    expect(() => buildSpatialOrBlock([s1], wkbTarget)).toThrow("WKB mode deferred — TD-V14-WKB-SPIKE");
  });

  it("latlon target missing lonCol/latCol throws coherent Error", () => {
    const badTarget: SpatialTarget = { tableId: 1, spatialMode: "latlon" };
    expect(() => buildSpatialOrBlock([s1], badTarget)).toThrow(/lonCol/);
  });

  it("wkt target missing spatialCol throws coherent Error", () => {
    const badTarget: SpatialTarget = { tableId: 1, spatialMode: "wkt" };
    expect(() => buildSpatialOrBlock([s1], badTarget)).toThrow(/spatialCol/);
  });
});

describe("composeWhereClause — 4-case composition", () => {
  it("neither: empty filters + empty shapes returns 1=1", () => {
    expect(composeWhereClause([], [], null)).toBe("1=1");
  });

  it("column-only: returns col_AND_chain with NO extra wrapping", () => {
    expect(composeWhereClause([colFilter], [], null)).toBe("zone = 'East Village'");
  });

  it("spatial-only: returns (spatial_OR_chain) bare (already outer-parenthesized)", () => {
    expect(composeWhereClause([], [s1], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"
    );
  });

  it("combined (1 shape + 1 col): (spatial) AND (col) — col side wrapped in parens", () => {
    expect(composeWhereClause([colFilter], [s1], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1) AND (zone = 'East Village')"
    );
  });

  // LOAD-BEARING V15-P-07 regression — 2 shapes + 1 column filter.
  // This is the load-bearing assertion that locks out the single-shape-invisible
  // bug class. Do NOT weaken to .toContain or substring matching.
  it("V15-P-07 load-bearing: 2-shape + 1-col returns EXACT combined string", () => {
    expect(composeWhereClause([colFilter], [s1, s2], latlonTarget)).toBe(
      "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')"
    );
  });

  it("zero shapes with target present is equivalent to column-only", () => {
    expect(composeWhereClause([colFilter], [], latlonTarget)).toBe("zone = 'East Village'");
  });

  it("zero shapes + zero filters + non-null target returns 1=1", () => {
    expect(composeWhereClause([], [], latlonTarget)).toBe("1=1");
  });
});

describe("composeWhereClause — wkb mode pass-through to builder", () => {
  it("wkb mode bubbles SpatialFilterWkbDeferredError from builder", () => {
    expect(() => composeWhereClause([], [s1], wkbTarget)).toThrow(SpatialFilterWkbDeferredError);
  });
});
