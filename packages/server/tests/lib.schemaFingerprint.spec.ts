import { describe, it, expect } from "vitest";
import {
  NON_TYPE_PROPERTIES,
  tablePresence,
  parseColumnFingerprints,
  formatFingerprint,
  parseFingerprintSnapshot,
  serializeFingerprintSnapshot,
  type ColumnFingerprint,
} from "../src/lib/schemaFingerprint";

// Real body, captured live against demo.nyctaxi — 122-SPIKE-NOTES.md Q1/Q2.
// vendor_id/payment_type/store_and_fwd_flag share Avro base "string" but differ
// on char width (char4/char16/char1); passenger_count/rate_code_id/cab_type share
// base "int" but differ on int width (int8/int16).
const NYCTAXI_TYPE_SCHEMA = JSON.stringify({
  type: "record",
  name: "type_name",
  fields: [
    { name: "vendor_id", type: "string" },
    { name: "payment_type", type: "string" },
    { name: "store_and_fwd_flag", type: "string" },
    { name: "passenger_count", type: "int" },
    { name: "rate_code_id", type: "int" },
    { name: "cab_type", type: "int" },
    { name: "trip_distance", type: "float" },
    { name: "pickup_datetime", type: "long" },
    { name: "dropoff_datetime", type: "long" },
  ],
});

const nyctaxiShowTable = {
  table_names: ["demo.nyctaxi"],
  type_ids: ["3030029304301109627"],
  type_schemas: [NYCTAXI_TYPE_SCHEMA],
  properties: [
    {
      vendor_id: ["data", "char4"],
      payment_type: ["data", "char16"],
      store_and_fwd_flag: ["data", "char1"],
      passenger_count: ["data", "int8"],
      rate_code_id: ["data", "int16"],
      cab_type: ["data", "int8"],
      trip_distance: ["data"],
      pickup_datetime: ["data", "timestamp"],
      dropoff_datetime: ["data", "timestamp"],
    },
  ],
};

// Real body — 122-SPIKE-NOTES.md Q5, the no_error_if_not_exists: true probe.
const missingShowTable = {
  table_name: "demo.__schema_spike_missing_table__",
  table_names: [],
  type_schemas: [],
  properties: [],
  info: { WARNING_0: "Could not find the table: '…' (TM/SMc:1046)" },
};

// Real body — 122-SPIKE-NOTES.md Addendum, pg_catalog.pg_views. The ONLY real
// fixture that carries an Avro union type AND a "nullable" property marker.
const pgViewsShowTable = {
  table_names: ["pg_catalog.pg_views"],
  type_schemas: [
    JSON.stringify({
      type: "record",
      name: "type_name",
      fields: [
        { name: "schemaname", type: ["string", "null"] },
        { name: "viewname", type: "string" },
        { name: "viewowner", type: "string" },
        { name: "definition", type: ["string", "null"] },
      ],
    }),
  ],
  properties: [
    {
      schemaname: ["data", "char256", "nullable"],
      viewname: ["data", "char256"],
      viewowner: ["data", "char256"],
      definition: ["data", "nullable"],
    },
  ],
};

describe("schemaFingerprint — pure /show/table body -> per-column type fingerprint parser", () => {
  it("combines type_schemas base with properties width — char4 and char16 differ on identical base 'string'", () => {
    const out = parseColumnFingerprints(nyctaxiShowTable, "demo.nyctaxi");
    expect(out.vendor_id.base).toBe("string");
    expect(out.payment_type.base).toBe("string");
    expect(out.vendor_id).not.toEqual(out.payment_type);
    expect(out.vendor_id.refinements).toEqual(["char4"]);
    expect(out.payment_type.refinements).toEqual(["char16"]);
  });

  it("vendor_id fingerprints as { base: 'string', refinements: ['char4'] }", () => {
    const out = parseColumnFingerprints(nyctaxiShowTable, "demo.nyctaxi");
    expect(out.vendor_id).toEqual({ base: "string", refinements: ["char4"] });
  });

  it("int -> double is a base-type change visible with identical empty refinements", () => {
    const intBody = {
      table_names: ["s.t"],
      type_schemas: [JSON.stringify({ fields: [{ name: "c", type: "int" }] })],
      properties: [{ c: ["data"] }],
    };
    const doubleBody = {
      table_names: ["s.t"],
      type_schemas: [JSON.stringify({ fields: [{ name: "c", type: "double" }] })],
      properties: [{ c: ["data"] }],
    };
    const intFp = parseColumnFingerprints(intBody, "s.t").c;
    const doubleFp = parseColumnFingerprints(doubleBody, "s.t").c;
    expect(intFp.refinements).toEqual([]);
    expect(doubleFp.refinements).toEqual([]);
    expect(intFp.base).toBe("int");
    expect(doubleFp.base).toBe("double");
    expect(intFp).not.toEqual(doubleFp);
  });

  it("int8 and int16 refine the same base 'int' and fingerprint differently", () => {
    const out = parseColumnFingerprints(nyctaxiShowTable, "demo.nyctaxi");
    expect(out.passenger_count.base).toBe("int");
    expect(out.rate_code_id.base).toBe("int");
    expect(out.passenger_count.refinements).toEqual(["int8"]);
    expect(out.rate_code_id.refinements).toEqual(["int16"]);
    expect(out.passenger_count).not.toEqual(out.rate_code_id);
  });

  it("a nullable Avro union ['null','int'] fingerprints as base 'int'", () => {
    const body = {
      table_names: ["s.t"],
      type_schemas: [JSON.stringify({ fields: [{ name: "c", type: ["null", "int"] }] })],
      properties: [{}],
    };
    expect(parseColumnFingerprints(body, "s.t").c.base).toBe("int");
  });

  it("storage and index markers are excluded from the fingerprint (SSYNC-F5 stays deferred)", () => {
    const out = parseColumnFingerprints(pgViewsShowTable, "pg_catalog.pg_views");
    // "nullable" is excluded (SSYNC-F5 deferred) — schemaname keeps its real
    // width marker (char256) but drops "data" and "nullable"; definition has
    // no width marker at all once "data" and "nullable" are stripped.
    expect(out.schemaname).toEqual({ base: "string", refinements: ["char256"] });
    expect(out.definition).toEqual({ base: "string", refinements: [] });
    // Real union body: "null" is filtered from the Avro union, leaving base "string".
    expect(out.schemaname.base).toBe("string");
    expect(out.definition.base).toBe("string");
    for (const marker of NON_TYPE_PROPERTIES) {
      expect(out.schemaname.refinements).not.toContain(marker);
    }
  });

  it("formatFingerprint renders string(char4), int(int8), long(timestamp) and bare float", () => {
    expect(formatFingerprint({ base: "string", refinements: ["char4"] })).toBe("string(char4)");
    expect(formatFingerprint({ base: "int", refinements: ["int8"] })).toBe("int(int8)");
    expect(formatFingerprint({ base: "long", refinements: ["timestamp"] })).toBe("long(timestamp)");
    expect(formatFingerprint({ base: "float", refinements: [] })).toBe("float");
  });

  it("tablePresence: an empty table_names array is 'missing'", () => {
    expect(tablePresence(missingShowTable)).toBe("missing");
  });

  it("tablePresence: a body with no table_names is 'unreadable', never 'missing'", () => {
    expect(tablePresence({})).toBe("unreadable");
    expect(tablePresence(null)).toBe("unreadable");
    expect(tablePresence(undefined)).toBe("unreadable");
    expect(tablePresence({ table_names: "not-an-array" })).toBe("unreadable");
  });

  it("tablePresence: a non-empty table_names is 'present'", () => {
    expect(tablePresence(nyctaxiShowTable)).toBe("present");
    expect(tablePresence(pgViewsShowTable)).toBe("present");
  });

  it("parseFingerprintSnapshot returns null for null, empty string, malformed JSON and an unknown version", () => {
    expect(parseFingerprintSnapshot(null)).toBeNull();
    expect(parseFingerprintSnapshot(undefined)).toBeNull();
    expect(parseFingerprintSnapshot("")).toBeNull();
    expect(parseFingerprintSnapshot("   ")).toBeNull();
    expect(parseFingerprintSnapshot("{not json")).toBeNull();
    expect(parseFingerprintSnapshot(JSON.stringify({ v: 2, columns: {} }))).toBeNull();
    expect(parseFingerprintSnapshot(JSON.stringify({ columns: {} }))).toBeNull();
    expect(parseFingerprintSnapshot(JSON.stringify({ v: 1, columns: "nope" }))).toBeNull();
  });

  it("serializeFingerprintSnapshot round-trips through parseFingerprintSnapshot", () => {
    const columns = parseColumnFingerprints(nyctaxiShowTable, "demo.nyctaxi");
    const serialized = serializeFingerprintSnapshot(columns);
    const roundTripped = parseFingerprintSnapshot(serialized);
    expect(roundTripped).toEqual(columns);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["non-object", 42],
    ["missing type_schemas", { table_names: ["s.t"], properties: [{}] }],
    [
      "type_schemas not parseable JSON",
      { table_names: ["s.t"], type_schemas: ["{not json"], properties: [{}] },
    ],
    [
      "properties not an array",
      { table_names: ["s.t"], type_schemas: [JSON.stringify({ fields: [] })], properties: {} },
    ],
  ])("parseColumnFingerprints returns {} on malformed input: %s", (_label, body) => {
    expect(parseColumnFingerprints(body, "s.t")).toEqual({});
  });
});
