/**
 * Focused spec for the `applyZoomRangeToLayer` helper exported from
 * MapChartRenderer.tsx. Verifies the inclusive-to-OL-convention translation +
 * idempotency. Kept in a separate file so we don't have to spin up the full
 * MapChartRenderer test harness (OL mocks, layer store, context, etc.) for
 * a pure-function helper.
 */

import { describe, it, expect, vi } from "vitest";
import { applyZoomRangeToLayer } from "./MapChartRenderer";

// Minimal stub mirroring the slice of ol/layer/Image we use. Keeps the spec
// independent of the OL module (which the renderer mocks heavily elsewhere).
const makeStubLayer = (initialMin = -Infinity, initialMax = Infinity) => {
  let minZ = initialMin;
  let maxZ = initialMax;
  const setMinZoom = vi.fn((v: number) => {
    minZ = v;
  });
  const setMaxZoom = vi.fn((v: number) => {
    maxZ = v;
  });
  return {
    getMinZoom: () => minZ,
    getMaxZoom: () => maxZ,
    setMinZoom,
    setMaxZoom,
  } as any;
};

describe("applyZoomRangeToLayer", () => {
  it("translates inclusive [3, 10] → OL setMinZoom(2), setMaxZoom(10)", () => {
    const layer = makeStubLayer();
    applyZoomRangeToLayer(layer, { minZoom: 3, maxZoom: 10 });
    // OL minZoom is EXCLUSIVE — userMin (3) - 1 = 2.
    expect(layer.setMinZoom).toHaveBeenCalledWith(2);
    // OL maxZoom is INCLUSIVE — pass through.
    expect(layer.setMaxZoom).toHaveBeenCalledWith(10);
  });

  it("undefined minZoom → resolves to -Infinity (no lower constraint) — setMinZoom called when layer was at a constraint", () => {
    // Layer starts at (2, 10) — operator previously had a lower bound. Now they
    // remove it (config.minZoom undefined). Helper sets minZoom back to -Infinity.
    const layer = makeStubLayer(2, 10);
    applyZoomRangeToLayer(layer, { maxZoom: 15 });
    expect(layer.setMinZoom).toHaveBeenCalledWith(-Infinity);
    expect(layer.setMaxZoom).toHaveBeenCalledWith(15);
  });

  it("undefined maxZoom → resolves to Infinity (no upper constraint) — setMaxZoom called when layer was at a constraint", () => {
    const layer = makeStubLayer(-Infinity, 10);
    applyZoomRangeToLayer(layer, { minZoom: 5 });
    expect(layer.setMinZoom).toHaveBeenCalledWith(4);
    expect(layer.setMaxZoom).toHaveBeenCalledWith(Infinity);
  });

  it("both undefined → no setter calls when layer is already at the no-constraint defaults (idempotent)", () => {
    // Layer at OL defaults (-Infinity, Infinity). Apply no constraints → no work.
    const layer = makeStubLayer();
    applyZoomRangeToLayer(layer, {});
    expect(layer.setMinZoom).not.toHaveBeenCalled();
    expect(layer.setMaxZoom).not.toHaveBeenCalled();
  });

  it("both undefined → resolves to defaults — setters fire when layer was previously constrained", () => {
    // Layer at (2, 10) — operator had constraints. Now they reset to no-constraint
    // (config minZoom + maxZoom both undefined). Both setters fire to relax bounds.
    const layer = makeStubLayer(2, 10);
    applyZoomRangeToLayer(layer, {});
    expect(layer.setMinZoom).toHaveBeenCalledWith(-Infinity);
    expect(layer.setMaxZoom).toHaveBeenCalledWith(Infinity);
  });

  it("idempotent: when current value already matches target, setMinZoom NOT called again", () => {
    // Start with a layer already at the target state — [3, 10] translates to (2, 10).
    const layer = makeStubLayer(2, 10);
    applyZoomRangeToLayer(layer, { minZoom: 3, maxZoom: 10 });
    expect(layer.setMinZoom).not.toHaveBeenCalled();
    expect(layer.setMaxZoom).not.toHaveBeenCalled();
  });

  it("partial idempotency: only the changed bound triggers a setter", () => {
    // Layer currently at (-Infinity, 10). Apply { maxZoom: 20 }.
    // setMaxZoom(20) fires (was 10, now 20). setMinZoom(-Infinity) skipped (already -Infinity).
    const layer = makeStubLayer(-Infinity, 10);
    applyZoomRangeToLayer(layer, { maxZoom: 20 });
    expect(layer.setMinZoom).not.toHaveBeenCalled();
    expect(layer.setMaxZoom).toHaveBeenCalledWith(20);
  });

  it("single-zoom-level visibility: minZoom===maxZoom translates to (userMin-1, userMax)", () => {
    // [5, 5] → OL (4, 5). Layer visible when 4 < z <= 5, i.e. ONLY at z=5.
    const layer = makeStubLayer();
    applyZoomRangeToLayer(layer, { minZoom: 5, maxZoom: 5 });
    expect(layer.setMinZoom).toHaveBeenCalledWith(4);
    expect(layer.setMaxZoom).toHaveBeenCalledWith(5);
  });
});
