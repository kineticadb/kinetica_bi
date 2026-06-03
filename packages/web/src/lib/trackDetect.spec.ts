/**
 * trackDetect.spec.ts — Phase 38 Plan 01 Task 3 vitest unit coverage.
 *
 * Covers all behavior cases for lib/trackDetect.ts:isTrackTable.
 * Strict 4-name case-insensitive match: TRACKID, x, y, TIMESTAMP.
 * NO alias support. Returns TrackColumns (preserving original casing)
 * when all 4 present; null otherwise. Extras ignored.
 *
 * 8 test cases covering: exact match, case variations, missing each of
 * the 4 required fields, empty array, extras-present, and alias rejection.
 */
import { describe, it, expect } from "vitest";
import { isTrackTable } from "./trackDetect";

describe("isTrackTable", () => {
  it("returns TrackColumns when all 4 columns present (exact canonical casing)", () => {
    const result = isTrackTable([
      { name: "TRACKID" },
      { name: "x" },
      { name: "y" },
      { name: "TIMESTAMP" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      trackIdCol: "TRACKID",
      xCol: "x",
      yCol: "y",
      orderCol: "TIMESTAMP",
    });
  });

  it("matches case-insensitively and preserves original casing in return value", () => {
    const result = isTrackTable([
      { name: "trackid" },
      { name: "X" },
      { name: "Y" },
      { name: "timestamp" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      trackIdCol: "trackid",
      xCol: "X",
      yCol: "Y",
      orderCol: "timestamp",
    });
  });

  it("returns null when TRACKID is missing", () => {
    const result = isTrackTable([
      { name: "x" },
      { name: "y" },
      { name: "TIMESTAMP" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when x is missing", () => {
    const result = isTrackTable([
      { name: "TRACKID" },
      { name: "y" },
      { name: "TIMESTAMP" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when y is missing", () => {
    const result = isTrackTable([
      { name: "TRACKID" },
      { name: "x" },
      { name: "TIMESTAMP" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when TIMESTAMP is missing", () => {
    const result = isTrackTable([
      { name: "TRACKID" },
      { name: "x" },
      { name: "y" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null for empty columns array", () => {
    expect(isTrackTable([])).toBeNull();
  });

  it("returns matched 4 columns when extra columns are present (extras silently ignored)", () => {
    const result = isTrackTable([
      { name: "TRACKID" },
      { name: "x" },
      { name: "y" },
      { name: "TIMESTAMP" },
      { name: "DRIVER_ID" },
      { name: "SPEED" },
    ]);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      trackIdCol: "TRACKID",
      xCol: "x",
      yCol: "y",
      orderCol: "TIMESTAMP",
    });
  });

  it("returns null for alias column names — strict 4-name match only (no track_id / lat / lon)", () => {
    // track_id is NOT trackid; lat is NOT y; lon is NOT x — strict match locked
    const result = isTrackTable([
      { name: "track_id" },
      { name: "lat" },
      { name: "lon" },
      { name: "timestamp" },
    ]);
    expect(result).toBeNull();
  });
});
