/**
 * trackConfig.spec.ts — Phase 40 Plan 01 Task 1 vitest unit coverage.
 *
 * Covers all exports of lib/trackConfig.ts: TrackConfig type,
 * coalesceTrackConfig null-coalescer, TRACK_DEFAULTS constant.
 *
 * Mirrors src/lib/cbConfig.spec.ts pattern: one describe
 * block per export, positive + negative cases per helper, pure unit tests
 * (no React, no Zustand, no async).
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  coalesceTrackConfig,
  TRACK_DEFAULTS,
  type TrackConfig,
} from "./trackConfig";

describe("coalesceTrackConfig", () => {
  it("returns { enabled: false } for null input", () => {
    expect(coalesceTrackConfig(null)).toEqual({ enabled: false });
  });

  it("returns { enabled: false } for invalid JSON (JSON.parse throws)", () => {
    expect(coalesceTrackConfig("not valid json")).toEqual({ enabled: false });
  });

  it("returns { enabled: false } for valid JSON that lacks 'enabled' key", () => {
    expect(coalesceTrackConfig("{}")).toEqual({ enabled: false });
  });

  it("returns { enabled: false } for valid JSON with enabled:false", () => {
    expect(coalesceTrackConfig('{"enabled":false}')).toEqual({ enabled: false });
  });

  it("returns full config verbatim for valid JSON with all fields", () => {
    const raw = JSON.stringify({
      enabled: true,
      trackIdAttr: "trackid",
      trackOrderAttr: "ts",
      headColor: "FFAA0000",
      trailColor: "FF0000AA",
      headSize: 10,
      trailSize: 3,
      headShape: "square",
    });
    const result = coalesceTrackConfig(raw);
    expect(result.enabled).toBe(true);
    expect(result.trackIdAttr).toBe("trackid");
    expect(result.trackOrderAttr).toBe("ts");
    expect(result.headColor).toBe("FFAA0000");
    expect(result.trailColor).toBe("FF0000AA");
    expect(result.headSize).toBe(10);
    expect(result.trailSize).toBe(3);
    expect(result.headShape).toBe("square");
  });
});

describe("TRACK_DEFAULTS", () => {
  it("headColor is FFFF0000 (red, fully opaque)", () => {
    expect(TRACK_DEFAULTS.headColor).toBe("FFFF0000");
  });

  it("trailColor is FF0000FF (blue, fully opaque)", () => {
    expect(TRACK_DEFAULTS.trailColor).toBe("FF0000FF");
  });

  it("headSize is 8", () => {
    expect(TRACK_DEFAULTS.headSize).toBe(8);
  });

  it("trailSize is 2", () => {
    expect(TRACK_DEFAULTS.trailSize).toBe(2);
  });

  it("headShape is 'circle'", () => {
    expect(TRACK_DEFAULTS.headShape).toBe("circle");
  });
});

describe("TrackConfig type", () => {
  it("TrackConfig type is exported and structurally compatible", () => {
    // Compile-time check: assignment must type-check
    const tc: TrackConfig = { enabled: true };
    expectTypeOf(tc).toMatchTypeOf<TrackConfig>();
    expectTypeOf(tc.enabled).toBeBoolean();
  });
});
