/**
 * Phase 52: spatialColumns.spec.ts — unit tests for buildSpatialColumns helper.
 *
 * Covers the three original modes (latlon, wkt, wkb) for regression safety,
 * plus the Phase 52 track branch that translates track_config xCol/yCol to
 * a latlon-shaped SpatialColumns result.
 */

import { describe, it, expect } from "vitest";
import { buildSpatialColumns } from "./spatialColumns";
import type { MapWidgetConfig } from "./wmsUrlBuilder";

describe("buildSpatialColumns (Phase 23 original modes)", () => {
  it("latlon mode returns { lonCol, latCol } when both columns set", () => {
    const cfg: Partial<MapWidgetConfig> = {
      spatialMode: "latlon",
      lonColumn: "longitude",
      latColumn: "latitude",
    };
    expect(buildSpatialColumns(cfg)).toEqual({ lonCol: "longitude", latCol: "latitude" });
  });

  it("latlon mode returns null when either column is missing", () => {
    expect(buildSpatialColumns({ spatialMode: "latlon", lonColumn: "lon" })).toBeNull();
    expect(buildSpatialColumns({ spatialMode: "latlon", latColumn: "lat" })).toBeNull();
    expect(buildSpatialColumns({ spatialMode: "latlon" })).toBeNull();
  });

  it("wkt mode returns { wktCol } when column set", () => {
    const cfg: Partial<MapWidgetConfig> = { spatialMode: "wkt", wktColumn: "shape_wkt" };
    expect(buildSpatialColumns(cfg)).toEqual({ wktCol: "shape_wkt" });
  });

  it("wkt mode returns null when wktColumn missing", () => {
    expect(buildSpatialColumns({ spatialMode: "wkt" })).toBeNull();
  });

  it("wkb mode returns { wkbCol } when column set", () => {
    const cfg: Partial<MapWidgetConfig> = { spatialMode: "wkb", wkbColumn: "geom" };
    expect(buildSpatialColumns(cfg)).toEqual({ wkbCol: "geom" });
  });

  it("wkb mode returns null when wkbColumn missing", () => {
    expect(buildSpatialColumns({ spatialMode: "wkb" })).toBeNull();
  });

  it("unknown/undefined spatialMode returns null", () => {
    expect(buildSpatialColumns({})).toBeNull();
    expect(buildSpatialColumns({ spatialMode: undefined })).toBeNull();
  });
});

describe("buildSpatialColumns — track branch (Phase 52)", () => {
  it("track mode returns { lonCol: xCol, latCol: yCol } when track_config has both xCol + yCol", () => {
    const trackConfig = JSON.stringify({ enabled: true, xCol: "x", yCol: "y" });
    const cfg = {
      spatialMode: "track" as const,
      track_config: trackConfig,
    };
    expect(buildSpatialColumns(cfg as Partial<MapWidgetConfig>)).toEqual({
      lonCol: "x",
      latCol: "y",
    });
  });

  it("track mode returns null when track_config is null", () => {
    const cfg = { spatialMode: "track" as const, track_config: null };
    expect(buildSpatialColumns(cfg as Partial<MapWidgetConfig>)).toBeNull();
  });

  it("track mode returns null when track_config lacks xCol", () => {
    const trackConfig = JSON.stringify({ enabled: true, yCol: "y" });
    const cfg = { spatialMode: "track" as const, track_config: trackConfig };
    expect(buildSpatialColumns(cfg as Partial<MapWidgetConfig>)).toBeNull();
  });

  it("track mode returns null when track_config lacks yCol", () => {
    const trackConfig = JSON.stringify({ enabled: true, xCol: "x" });
    const cfg = { spatialMode: "track" as const, track_config: trackConfig };
    expect(buildSpatialColumns(cfg as Partial<MapWidgetConfig>)).toBeNull();
  });

  it("track mode returns null when track_config is invalid JSON (parse failure → {enabled:false})", () => {
    const cfg = { spatialMode: "track" as const, track_config: "INVALID_JSON" };
    expect(buildSpatialColumns(cfg as Partial<MapWidgetConfig>)).toBeNull();
  });

  it("track mode uses original-cased column names from track_config (preserves case)", () => {
    const trackConfig = JSON.stringify({ enabled: false, xCol: "X_LON", yCol: "Y_LAT" });
    const cfg = { spatialMode: "track" as const, track_config: trackConfig };
    expect(buildSpatialColumns(cfg as Partial<MapWidgetConfig>)).toEqual({
      lonCol: "X_LON",
      latCol: "Y_LAT",
    });
  });
});
