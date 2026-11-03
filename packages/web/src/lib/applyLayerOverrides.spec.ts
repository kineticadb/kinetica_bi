import { describe, it, expect } from "vitest";
import { applyLayerOverrides, translateLayerOverlay } from "./applyLayerOverrides";
import type { DashboardLayerDto } from "../api/client";

const layer = (config: Record<string, unknown> = {}): DashboardLayerDto =>
  ({ id: 1, dashboard_id: 1, table_id: 2, layer_type: "KineticaWms", position: 0, config } as unknown as DashboardLayerDto);

describe("SEAM — layer overlay translation (D-19)", () => {
  it("SEAM-6: opacity 0-1 becomes POINTOPACITY 0-100; no opacity returns the same reference", () => {
    expect(translateLayerOverlay({ opacity: 0.5, visible: false })).toEqual({ POINTOPACITY: 50, visible: false });
    expect("opacity" in translateLayerOverlay({ opacity: 0.5 })).toBe(false);
    expect(translateLayerOverlay({ opacity: 0 })).toEqual({ POINTOPACITY: 0 });
    const p = { visible: true };
    expect(translateLayerOverlay(p)).toBe(p);
  });
  it("SEAM-7: applyLayerOverrides merges POINTOPACITY and leaves pointOpacity alone", () => {
    const l = layer({ POINTOPACITY: 100, pointOpacity: 0.8 });
    const [out] = applyLayerOverrides([l], { 1: { config: { opacity: 0.25 } } });
    const cfg = out.config as Record<string, unknown>;
    expect(cfg.POINTOPACITY).toBe(25);
    expect(cfg.pointOpacity).toBe(0.8);
    expect("opacity" in cfg).toBe(false);
    expect(applyLayerOverrides([l], {})[0]).toBe(l);
  });
});
