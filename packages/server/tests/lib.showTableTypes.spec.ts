import { describe, it, expect } from "vitest";
import { parseTemporalColumns } from "../src/lib/showTableTypes";

// Mirrors the Kinetica /show/table response shape: properties[i] is a map of
// column name → property markers, aligned with table_names[i].
const nyctaxiShowTable = {
  table_names: ["demo.nyctaxi"],
  properties: [
    {
      vendor_id: ["char4", "data"],
      pickup_datetime: ["timestamp", "data"],
      dropoff_datetime: ["timestamp", "data"],
      passenger_count: ["int8", "data"],
      trip_distance: ["data"],
      pickup_longitude: ["data"],
    },
  ],
};

describe("parseTemporalColumns — recovers temporal sub-types /show/table carries but INFORMATION_SCHEMA drops", () => {
  it("maps timestamp-property columns to 'timestamp'", () => {
    const out = parseTemporalColumns(nyctaxiShowTable, "demo.nyctaxi");
    expect(out).toEqual({
      pickup_datetime: "timestamp",
      dropoff_datetime: "timestamp",
    });
  });

  it("returns only temporal columns (non-temporal columns absent)", () => {
    const out = parseTemporalColumns(nyctaxiShowTable, "demo.nyctaxi");
    expect(out).not.toHaveProperty("vendor_id");
    expect(out).not.toHaveProperty("passenger_count");
    expect(out).not.toHaveProperty("trip_distance");
  });

  it("recognizes date / time / datetime markers, each mapped to its canonical string", () => {
    const body = {
      table_names: ["s.t"],
      properties: [
        {
          d: ["date", "data"],
          t: ["time", "data"],
          dt: ["datetime", "data"],
          ts: ["timestamp"],
        },
      ],
    };
    expect(parseTemporalColumns(body, "s.t")).toEqual({
      d: "date",
      t: "time",
      dt: "datetime",
      ts: "timestamp",
    });
  });

  it("is case-insensitive on property markers", () => {
    const body = { table_names: ["s.t"], properties: [{ a: ["TIMESTAMP"], b: ["Date"] }] };
    expect(parseTemporalColumns(body, "s.t")).toEqual({ a: "timestamp", b: "date" });
  });

  it("picks the index in properties matching table_names; falls back to index 0", () => {
    const body = {
      table_names: ["other.tbl", "demo.nyctaxi"],
      properties: [
        { ignore_me: ["timestamp"] },
        { pickup_datetime: ["timestamp"] },
      ],
    };
    expect(parseTemporalColumns(body, "demo.nyctaxi")).toEqual({ pickup_datetime: "timestamp" });
    // Unknown table name → index 0
    expect(parseTemporalColumns(body, "nope.nope")).toEqual({ ignore_me: "timestamp" });
  });

  it("precedence: 'timestamp' wins when multiple temporal markers co-occur", () => {
    const body = { table_names: ["s.t"], properties: [{ c: ["date", "timestamp"] }] };
    expect(parseTemporalColumns(body, "s.t")).toEqual({ c: "timestamp" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["non-object", 42],
    ["missing properties", { table_names: ["s.t"] }],
    ["empty properties array", { table_names: ["s.t"], properties: [] }],
    ["non-array property list", { table_names: ["s.t"], properties: [{ c: "timestamp" }] }],
    ["properties entry not an object", { table_names: ["s.t"], properties: [null] }],
  ])("returns {} on malformed input: %s", (_label, body) => {
    expect(parseTemporalColumns(body, "s.t")).toEqual({});
  });
});
