import { describe, it, expect } from "vitest";
import {
  isColumnDrillDownSafe,
  inferDataTypeFromColumn,
  buildChipText,
  getValidSpatialColumns,
  autoSuggestSpatialMode,
  type SpatialMode,
  type Column,
} from "./columnTypes";

describe("isColumnDrillDownSafe (PITFALL D-01 lock)", () => {
  it("excludes all known Kinetica geometry types (lowercase)", () => {
    expect(isColumnDrillDownSafe("wkt")).toBe(false);
    expect(isColumnDrillDownSafe("wkb")).toBe(false);
    expect(isColumnDrillDownSafe("bytes")).toBe(false);
    expect(isColumnDrillDownSafe("point")).toBe(false);
    expect(isColumnDrillDownSafe("geometry")).toBe(false);
    expect(isColumnDrillDownSafe("geography")).toBe(false);
  });

  it("excludes large-text types", () => {
    expect(isColumnDrillDownSafe("blob")).toBe(false);
    expect(isColumnDrillDownSafe("text")).toBe(false);
  });

  it("is case-insensitive (uppercase Kinetica DATA_TYPE values rejected)", () => {
    expect(isColumnDrillDownSafe("WKT")).toBe(false);
    expect(isColumnDrillDownSafe("WKB")).toBe(false);
    expect(isColumnDrillDownSafe("BYTES")).toBe(false);
  });

  it("strips parameterized suffix (varchar(50) treated as varchar — passes)", () => {
    expect(isColumnDrillDownSafe("varchar(50)")).toBe(true);
    expect(isColumnDrillDownSafe("VARCHAR(2000)")).toBe(true);
    expect(isColumnDrillDownSafe("decimal(10,2)")).toBe(true);
  });

  it("passes common safe types through", () => {
    expect(isColumnDrillDownSafe("int")).toBe(true);
    expect(isColumnDrillDownSafe("integer")).toBe(true);
    expect(isColumnDrillDownSafe("varchar")).toBe(true);
    expect(isColumnDrillDownSafe("double")).toBe(true);
    expect(isColumnDrillDownSafe("boolean")).toBe(true);
    expect(isColumnDrillDownSafe("timestamp")).toBe(true);
    expect(isColumnDrillDownSafe("date")).toBe(true);
  });

  it("conservatively passes unknown types (over-exclusion would hide valid columns)", () => {
    expect(isColumnDrillDownSafe("custom_type")).toBe(true);
    expect(isColumnDrillDownSafe("")).toBe(true);
  });
});

describe("inferDataTypeFromColumn", () => {
  const columns: Record<string, string> = {
    id: "int",
    amount: "decimal(10,2)",
    score: "double",
    name: "varchar(50)",
    description: "varchar",
    created_at: "timestamp",
    event_date: "date",
    active: "boolean",
    flag: "bool",
    small_count: "tinyint",
  };

  it("maps numeric DATA_TYPEs to 'number'", () => {
    expect(inferDataTypeFromColumn("id", columns)).toBe("number");
    expect(inferDataTypeFromColumn("amount", columns)).toBe("number");
    expect(inferDataTypeFromColumn("score", columns)).toBe("number");
    expect(inferDataTypeFromColumn("small_count", columns)).toBe("number");
  });

  it("maps string DATA_TYPEs to 'string'", () => {
    expect(inferDataTypeFromColumn("name", columns)).toBe("string");
    expect(inferDataTypeFromColumn("description", columns)).toBe("string");
  });

  it("maps datetime DATA_TYPEs to 'datetime'", () => {
    expect(inferDataTypeFromColumn("created_at", columns)).toBe("datetime");
    expect(inferDataTypeFromColumn("event_date", columns)).toBe("datetime");
  });

  it("maps boolean DATA_TYPEs to 'boolean'", () => {
    expect(inferDataTypeFromColumn("active", columns)).toBe("boolean");
    expect(inferDataTypeFromColumn("flag", columns)).toBe("boolean");
  });

  it("returns 'null' for missing columns", () => {
    expect(inferDataTypeFromColumn("nonexistent", columns)).toBe("null");
    expect(inferDataTypeFromColumn("", columns)).toBe("null");
  });

  it("returns 'null' for empty-string types", () => {
    expect(inferDataTypeFromColumn("foo", { foo: "" })).toBe("null");
  });

  it("is case-insensitive", () => {
    expect(inferDataTypeFromColumn("a", { a: "INT" })).toBe("number");
    expect(inferDataTypeFromColumn("a", { a: "VARCHAR(20)" })).toBe("string");
    expect(inferDataTypeFromColumn("a", { a: "TIMESTAMP" })).toBe("datetime");
  });
});

describe("buildChipText (DRILL-04 success criterion #5 + Phase 44 FILTER-V17-05)", () => {
  it("formats string values with single quotes", () => {
    expect(buildChipText("region", "EAST", "string")).toBe("region = 'EAST'");
  });

  it("does NOT SQL-escape inside chip text (display only — SQL escape lives in filterStore)", () => {
    // Chip is for human display; embedded quote shows verbatim. The SQL path uses
    // escapeKineticaStringLiteral separately (AP-3 lock).
    expect(buildChipText("name", "O'Brien", "string")).toBe("name = 'O'Brien'");
  });

  it("formats null with IS NULL syntax", () => {
    expect(buildChipText("region", null, "string")).toBe("region IS NULL");
    expect(buildChipText("region", "anything", "null")).toBe("region IS NULL");
  });

  it("formats numbers unquoted", () => {
    expect(buildChipText("count", 42, "number")).toBe("count = 42");
    expect(buildChipText("ratio", 3.14, "number")).toBe("ratio = 3.14");
  });

  it("formats booleans as uppercase TRUE/FALSE", () => {
    expect(buildChipText("active", true, "boolean")).toBe("active = TRUE");
    expect(buildChipText("active", false, "boolean")).toBe("active = FALSE");
  });

  it("formats Date instances as ISO strings with single quotes", () => {
    const d = new Date("2026-05-04T00:00:00.000Z");
    expect(buildChipText("ts", d, "datetime")).toBe("ts = '2026-05-04T00:00:00.000Z'");
  });

  it("formats datetime strings verbatim with single quotes", () => {
    expect(buildChipText("ts", "2026-05-04 12:00:00", "datetime")).toBe(
      "ts = '2026-05-04 12:00:00'",
    );
  });

  // Phase 44 (FILTER-V17-05): new operator-aware tests
  it("buildChipText with operator 'in' on string array formats as `col in ('a', 'b')`", () => {
    expect(buildChipText("region", ["EAST", "WEST"], "string", "in")).toBe(
      "region in ('EAST', 'WEST')"
    );
  });

  it("buildChipText with operator 'in' on number array formats as `col in (1, 2, 3)`", () => {
    expect(buildChipText("id", [1, 2, 3], "number", "in")).toBe("id in (1, 2, 3)");
  });

  it("buildChipText with operator 'in' on empty array formats as `col in ()`", () => {
    expect(buildChipText("region", [], "string", "in")).toBe("region in ()");
  });

  it("buildChipText with operator 'between' on number tuple formats as `col between 5 and 50`", () => {
    expect(buildChipText("fare", [5, 50], "number", "between")).toBe("fare between 5 and 50");
  });

  it("buildChipText with operator 'between' on datetime tuple formats as `col between 2024-01-01 and 2024-12-31`", () => {
    expect(buildChipText("ts", ["2024-01-01", "2024-12-31"], "datetime", "between")).toBe(
      "ts between 2024-01-01 and 2024-12-31"
    );
  });

  it("buildChipText without operator falls back to existing eq behavior — back-compat", () => {
    expect(buildChipText("region", "EAST", "string")).toBe("region = 'EAST'");
  });

  it("buildChipText with operator 'eq' explicit produces same output as operator absent", () => {
    expect(buildChipText("region", "EAST", "string", "eq")).toBe("region = 'EAST'");
  });
});

describe("getValidSpatialColumns + autoSuggestSpatialMode (Phase 11)", () => {
  // ---------------------------------------------------------------------------
  // getValidSpatialColumns
  // ---------------------------------------------------------------------------

  it("latlon mode returns only numeric columns", () => {
    const cols: Column[] = [
      { name: "lat", type: "double" },
      { name: "region", type: "string" },
    ];
    expect(getValidSpatialColumns(cols, "latlon" as SpatialMode)).toEqual([
      { name: "lat", type: "double" },
    ]);
  });

  it("latlon mode accepts multiple numeric types (int, long)", () => {
    const cols: Column[] = [
      { name: "x", type: "int" },
      { name: "y", type: "long" },
    ];
    expect(getValidSpatialColumns(cols, "latlon" as SpatialMode)).toEqual([
      { name: "x", type: "int" },
      { name: "y", type: "long" },
    ]);
  });

  it("wkt mode returns only string/varchar columns (which can host WKT)", () => {
    const cols: Column[] = [
      { name: "geom", type: "varchar" },
      { name: "id", type: "long" },
    ];
    expect(getValidSpatialColumns(cols, "wkt" as SpatialMode)).toEqual([
      { name: "geom", type: "varchar" },
    ]);
  });

  it("wkt mode matches 'WKT' type case-insensitively", () => {
    const cols: Column[] = [{ name: "geom_wkt", type: "WKT" }];
    expect(getValidSpatialColumns(cols, "wkt" as SpatialMode)).toEqual([
      { name: "geom_wkt", type: "WKT" },
    ]);
  });

  it("wkb mode returns Kinetica geometry-typed columns", () => {
    const cols: Column[] = [{ name: "shape", type: "geometry" }];
    expect(getValidSpatialColumns(cols, "wkb" as SpatialMode)).toEqual([
      { name: "shape", type: "geometry" },
    ]);
  });

  it("wkb mode excludes varchar (not a Kinetica geometry type)", () => {
    const cols: Column[] = [{ name: "shape", type: "varchar" }];
    expect(getValidSpatialColumns(cols, "wkb" as SpatialMode)).toEqual([]);
  });

  it("wkt mode ALSO includes Kinetica geometry-typed columns (Phase 26 ST_INTERSECTS works on geometry columns with WKT input)", () => {
    const cols: Column[] = [
      { name: "geom", type: "geometry" },
      { name: "name", type: "varchar" },
      { name: "id", type: "long" },
    ];
    expect(getValidSpatialColumns(cols, "wkt" as SpatialMode)).toEqual([
      { name: "geom", type: "geometry" },
      { name: "name", type: "varchar" },
    ]);
  });

  it("wkt mode includes geography/point/wkb-typed columns too", () => {
    const cols: Column[] = [
      { name: "a", type: "geography" },
      { name: "b", type: "point" },
      { name: "c", type: "wkb" },
      { name: "d", type: "int" },
    ];
    expect(getValidSpatialColumns(cols, "wkt" as SpatialMode)).toEqual([
      { name: "a", type: "geography" },
      { name: "b", type: "point" },
      { name: "c", type: "wkb" },
    ]);
  });

  it("strips parameterized suffix 'varchar(255)' and matches as varchar", () => {
    const cols: Column[] = [{ name: "geom", type: "varchar(255)" }];
    expect(getValidSpatialColumns(cols, "wkt" as SpatialMode)).toEqual([
      { name: "geom", type: "varchar(255)" },
    ]);
  });

  it("returns empty array for any mode when columns list is empty", () => {
    expect(getValidSpatialColumns([], "latlon" as SpatialMode)).toEqual([]);
    expect(getValidSpatialColumns([], "wkt" as SpatialMode)).toEqual([]);
    expect(getValidSpatialColumns([], "wkb" as SpatialMode)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // autoSuggestSpatialMode
  // ---------------------------------------------------------------------------

  it("returns 'wkb' when a geometry-typed column is present (geometry wins over lat/lon)", () => {
    const cols: Column[] = [
      { name: "shape", type: "geometry" },
      { name: "lat", type: "double" },
    ];
    expect(autoSuggestSpatialMode(cols)).toBe("wkb");
  });

  it("returns 'wkb' when only a geography column is present", () => {
    const cols: Column[] = [{ name: "shape", type: "geography" }];
    expect(autoSuggestSpatialMode(cols)).toBe("wkb");
  });

  it("returns 'wkt' when a column type contains 'WKT' (case-insensitive) and no geometry", () => {
    const cols: Column[] = [{ name: "geom", type: "WKT" }];
    expect(autoSuggestSpatialMode(cols)).toBe("wkt");
  });

  it("returns 'latlon' when both lat and lng named numeric columns are present", () => {
    const cols: Column[] = [
      { name: "lat", type: "double" },
      { name: "lng", type: "double" },
    ];
    expect(autoSuggestSpatialMode(cols)).toBe("latlon");
  });

  it("returns 'latlon' for full-name latitude/longitude columns", () => {
    const cols: Column[] = [
      { name: "latitude", type: "float" },
      { name: "longitude", type: "float" },
    ];
    expect(autoSuggestSpatialMode(cols)).toBe("latlon");
  });

  it("returns 'latlon' (fallback) when columns have no spatial hint", () => {
    const cols: Column[] = [{ name: "id", type: "long" }];
    expect(autoSuggestSpatialMode(cols)).toBe("latlon");
  });

  it("returns 'latlon' (fallback) when only lat is present without a lon partner", () => {
    const cols: Column[] = [{ name: "lat", type: "double" }];
    expect(autoSuggestSpatialMode(cols)).toBe("latlon");
  });

  it("returns 'latlon' (fallback) for an empty column list", () => {
    expect(autoSuggestSpatialMode([])).toBe("latlon");
  });

  it("preferWktOverWkb=true → geometry column returns 'wkt' instead of 'wkb'", () => {
    const cols: Column[] = [{ name: "shape", type: "geometry" }];
    expect(autoSuggestSpatialMode(cols, { preferWktOverWkb: true })).toBe("wkt");
  });

  it("preferWktOverWkb=true → geography column returns 'wkt'", () => {
    const cols: Column[] = [{ name: "shape", type: "geography" }];
    expect(autoSuggestSpatialMode(cols, { preferWktOverWkb: true })).toBe("wkt");
  });

  it("preferWktOverWkb=true → still picks 'latlon' when no geometry column and lat/lon present", () => {
    const cols: Column[] = [
      { name: "lat", type: "double" },
      { name: "lng", type: "double" },
    ];
    expect(autoSuggestSpatialMode(cols, { preferWktOverWkb: true })).toBe("latlon");
  });

  it("preferWktOverWkb=false (explicit) preserves the default 'wkb' behavior", () => {
    const cols: Column[] = [{ name: "shape", type: "geometry" }];
    expect(autoSuggestSpatialMode(cols, { preferWktOverWkb: false })).toBe("wkb");
  });
});
