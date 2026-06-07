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

// ─── CUTOVER-V19-01 (amended): stale old-shape track_config coalesces without error ───
//
// Phase 52 deleted the v1.7 old model (TrackSubSection / "Treat as track table" checkbox).
// Phase 53-02 verifies-by-spec that a stale DB row with the OLD shape (enabled:true but
// no xCol/yCol — written by v1.7 Phase 40 before Phase 52 added those fields) is handled
// gracefully: coalesceTrackConfig passes the object through verbatim (it has "enabled"),
// leaving xCol/yCol as undefined. The layer renders harmlessly — no throw, no crash.
//
// The amended CUTOVER-V19-01 removes the overlay (deleted in Phase 52); these no-throw
// locks are the verification that clean deletion + harmless rendering satisfy the truth.

describe("coalesceTrackConfig — stale old-shape config (CUTOVER-V19-01)", () => {
  it("old-shape JSON (enabled:true, no xCol/yCol) does not throw and returns object with enabled===true", () => {
    // v1.7 Phase 40 model shape: enabled + track attrs + colors, but no xCol/yCol
    // (those were added by Phase 52). A stale DB row written before Phase 52 has this shape.
    const oldShapeJson = '{"enabled":true,"trackIdAttr":"TRACKID","trackOrderAttr":"TIMESTAMP","headColor":"FFFF0000"}';
    let result: TrackConfig | undefined;
    expect(() => { result = coalesceTrackConfig(oldShapeJson); }).not.toThrow();
    expect(result!.enabled).toBe(true);
    // xCol/yCol absent from old-shape — must be undefined (not throw)
    expect(result!.xCol).toBeUndefined();
    expect(result!.yCol).toBeUndefined();
  });

  it("garbage/legacy JSON without 'enabled' key returns { enabled: false } without throwing", () => {
    // JSON valid but missing the 'enabled' key — coalesceTrackConfig falls back to { enabled: false }.
    const legacyJson = '{"trackIdAttr":"TRACKID","headColor":"FFFF0000"}';
    let result: TrackConfig | undefined;
    expect(() => { result = coalesceTrackConfig(legacyJson); }).not.toThrow();
    expect(result!.enabled).toBe(false);
  });
});
