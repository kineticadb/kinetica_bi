/**
 * Phase 59 Plan 01 — Task 2 (TDD RED)
 * Unit tests for radioGroupCapture.ts — location-aware captureAllowListedSubset.
 *
 * CRITICAL proof: a single capture of a LAYER target with BOTH nested config.renderMode
 * AND top-level track_config returns both keys read from the correct sources.
 */
import { describe, it, expect } from "vitest";
import { captureAllowListedSubset } from "./radioGroupCapture";
import type { DashboardLayerDto, WidgetDto } from "../api/client";

// ---------------------------------------------------------------------------
// Helpers — DashboardLayerDto factory
// ---------------------------------------------------------------------------

function makeLayer(
  overrides: Partial<DashboardLayerDto> & { config?: Record<string, unknown> }
): DashboardLayerDto {
  return {
    id: 1,
    dashboard_id: 10,
    table_id: 2,
    layer_type: "KineticaWms",
    position: 0,
    config: {},
    info_enabled: 0,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function makeWidget(type: string, config: Record<string, unknown>): WidgetDto {
  return {
    id: 5,
    dashboard_id: 10,
    title: "My Widget",
    type,
    position: 0,
    config,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

// ---------------------------------------------------------------------------
// LAYER target — nested config fields (renderMode/visible/opacity)
// ---------------------------------------------------------------------------

describe("captureAllowListedSubset — layer target (nested config)", () => {
  it("captures renderMode from layer.config (nested)", () => {
    const layer = makeLayer({ config: { renderMode: "classbreak" } });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.renderMode).toBe("classbreak");
  });

  it("captures visible and opacity from layer.config", () => {
    const layer = makeLayer({ config: { visible: true, opacity: 0.5 } });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.visible).toBe(true);
    expect(result.opacity).toBe(0.5);
  });

  it("skips a non-allow-listed field in layer.config (other)", () => {
    const layer = makeLayer({ config: { renderMode: "raster", other: "x" } });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.renderMode).toBe("raster");
    expect(result.other).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LAYER target — top-level fields (track_config / cb_config)
// ---------------------------------------------------------------------------

describe("captureAllowListedSubset — layer target (top-level)", () => {
  it("captures cb_config from the TOP-LEVEL layer field (not layer.config.cb_config)", () => {
    const layer = makeLayer({ cb_config: '{"color":"red"}' });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.cb_config).toBe('{"color":"red"}');
  });

  it("captures track_config from the TOP-LEVEL layer field", () => {
    const layer = makeLayer({ track_config: '{"enabled":true}' });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.track_config).toBe('{"enabled":true}');
  });

  it("skips track_config when it is null (no value to snapshot)", () => {
    const layer = makeLayer({ track_config: null });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.track_config).toBeUndefined();
  });

  it("skips cb_config when it is null", () => {
    const layer = makeLayer({ cb_config: null });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.cb_config).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CRITICAL: single capture returns BOTH nested config.renderMode AND top-level track_config
// ---------------------------------------------------------------------------

describe("captureAllowListedSubset — CRITICAL combined nested+top-level test", () => {
  it("returns BOTH renderMode (from nested layer.config) AND track_config (from top-level) in one capture", () => {
    const layer = makeLayer({
      config: { renderMode: "raster" },
      track_config: '{"TRACK":true}',
    });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    // Nested config field — must come from layer.config.renderMode
    expect(result.renderMode).toBe("raster");
    // Top-level field — must come from layer.track_config (NOT layer.config.track_config)
    expect(result.track_config).toBe('{"TRACK":true}');
  });

  it("full scenario: renderMode + visible + opacity + cb_config + track_config all captured correctly", () => {
    const layer = makeLayer({
      config: { renderMode: "classbreak", visible: true, opacity: 0.5, other: "x" },
      cb_config: '{"color":"blue"}',
      track_config: '{"TRACKID":"id"}',
    });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.renderMode).toBe("classbreak");
    expect(result.visible).toBe(true);
    expect(result.opacity).toBe(0.5);
    expect(result.cb_config).toBe('{"color":"blue"}');
    expect(result.track_config).toBe('{"TRACKID":"id"}');
    // Non-allow-listed field is excluded
    expect(result.other).toBeUndefined();
  });

  it("scenario from plan: renderMode classbreak + cb_config + track_config null → only 2 keys", () => {
    // From plan <behavior> bullet 1
    const layer = makeLayer({
      config: { renderMode: "classbreak", visible: true, opacity: 0.5, other: "x" },
      cb_config: '{"cb":"data"}',
      track_config: null,
    });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(result.renderMode).toBe("classbreak");
    expect(result.visible).toBe(true);
    expect(result.opacity).toBe(0.5);
    expect(result.cb_config).toBe('{"cb":"data"}');
    // track_config is null → must be excluded (no value to snapshot)
    expect(result.track_config).toBeUndefined();
    expect(result.other).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WIDGET target — widget.config fields
// ---------------------------------------------------------------------------

describe("captureAllowListedSubset — widget target (widget.config)", () => {
  it("captures show_popup and show_scale_bar from widget.config for a map widget", () => {
    const widget = makeWidget("map", { show_popup: true, show_scale_bar: false, foo: 1 });
    const result = captureAllowListedSubset({
      target: { kind: "widget", id: 5 },
      widgetType: "map",
      widget,
    });
    expect(result.show_popup).toBe(true);
    expect(result.show_scale_bar).toBe(false);
    // Non-allow-listed field foo must be excluded
    expect(result.foo).toBeUndefined();
  });

  it("captures show_fullscreen from map widget.config", () => {
    const widget = makeWidget("map", { show_fullscreen: true });
    const result = captureAllowListedSubset({
      target: { kind: "widget", id: 5 },
      widgetType: "map",
      widget,
    });
    expect(result.show_fullscreen).toBe(true);
  });

  it("captures metric and aggregation from chart widget.config", () => {
    const widget = makeWidget("chart", { metric: "revenue", aggregation: "sum" });
    const result = captureAllowListedSubset({
      target: { kind: "widget", id: 5 },
      widgetType: "chart",
      widget,
    });
    expect(result.metric).toBe("revenue");
    expect(result.aggregation).toBe("sum");
  });

  it("captures page_size from records widget.config", () => {
    const widget = makeWidget("records", { page_size: 50, irrelevant: "x" });
    const result = captureAllowListedSubset({
      target: { kind: "widget", id: 5 },
      widgetType: "records",
      widget,
    });
    expect(result.page_size).toBe(50);
    expect(result.irrelevant).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No allow-listed fields present → returns empty patch
// ---------------------------------------------------------------------------

describe("captureAllowListedSubset — empty patch edge cases", () => {
  it("returns empty patch when layer has no allow-listed fields in config", () => {
    const layer = makeLayer({ config: {}, track_config: null, cb_config: null });
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
      layer,
    });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns empty patch when no layer provided", () => {
    const result = captureAllowListedSubset({
      target: { kind: "layer", id: 1 },
    });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("returns empty patch for widget target with no allow-listed fields in config", () => {
    const widget = makeWidget("map", { foo: 1, bar: 2 });
    const result = captureAllowListedSubset({
      target: { kind: "widget", id: 5 },
      widgetType: "map",
      widget,
    });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dynamicView target
// ---------------------------------------------------------------------------

describe("captureAllowListedSubset — dynamicView target", () => {
  it("returns empty patch by default (dv rows have no config blob)", () => {
    const result = captureAllowListedSubset({
      target: { kind: "dynamicView", id: 99 },
    });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("captures enabled from dynamicViewConfig if provided", () => {
    const result = captureAllowListedSubset({
      target: { kind: "dynamicView", id: 99 },
      dynamicViewConfig: { enabled: true },
    });
    expect(result.enabled).toBe(true);
  });

  it("returns empty patch when dynamicViewConfig has no allow-listed fields", () => {
    const result = captureAllowListedSubset({
      target: { kind: "dynamicView", id: 99 },
      dynamicViewConfig: { other: "x" },
    });
    expect(Object.keys(result)).toHaveLength(0);
  });
});
