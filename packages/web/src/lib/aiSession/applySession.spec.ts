import { describe, it, expect } from "vitest";
import { applySessionToWidgets, applySessionToLayers, hasSessionChanges } from "./applySession";
import { EMPTY_DERIVED } from "./constants";
import type { SessionDerived } from "./types";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";

const w = (id: number): WidgetDto => ({
  id, dashboard_id: 1, title: "", type: "map", position: 0, config: {}, created_at: "", updated_at: "",
});
const l = (id: number): DashboardLayerDto => ({
  id, dashboard_id: 1, table_id: 1, layer_type: "KineticaWms", position: 0, config: {},
  info_enabled: 0, info_columns: null, info_template: null, dynamic_view_id: null,
  cb_config: null, track_config: null, created_at: "", updated_at: "",
});
const derived = (o: Partial<SessionDerived>): SessionDerived => ({ ...EMPTY_DERIVED, ...o });

describe("applySession", () => {
  it("APPLYS-1: empty derived returns the saved array identity", () => {
    const sw = [w(1)];
    const sl = [l(1)];
    expect(applySessionToWidgets(sw, EMPTY_DERIVED)).toBe(sw);
    expect(applySessionToLayers(sl, EMPTY_DERIVED)).toBe(sl);
  });
  it("APPLYS-2: layer-only changes keep widget array identity", () => {
    const sw = [w(1)];
    const d = derived({ addedLayers: [l(-2)], appliedOpCount: 1 });
    expect(applySessionToWidgets(sw, d)).toBe(sw);
  });
  it("APPLYS-3: widgets removed + added, order kept, input unmutated", () => {
    const sw = [w(41), w(42), w(43)];
    const d = derived({ removedWidgetIds: new Set([42]), addedWidgets: [w(-1)], appliedOpCount: 2 });
    expect(applySessionToWidgets(sw, d).map((x) => x.id)).toEqual([41, 43, -1]);
    expect(sw.map((x) => x.id)).toEqual([41, 42, 43]);
  });
  it("APPLYS-4: layers removed + added", () => {
    const sl = [l(6), l(7), l(8)];
    const d = derived({ removedLayerIds: new Set([7]), addedLayers: [l(-2)], appliedOpCount: 2 });
    expect(applySessionToLayers(sl, d).map((x) => x.id)).toEqual([6, 8, -2]);
    expect(sl.map((x) => x.id)).toEqual([6, 7, 8]);
  });
  it("APPLYS-5: hasSessionChanges", () => {
    expect(hasSessionChanges(EMPTY_DERIVED)).toBe(false);
    const patchOnly = derived({
      contribution: { widget: { 42: { show_popup: true } }, layer: {}, dynamicView: {} },
      appliedOpCount: 1,
    });
    expect(hasSessionChanges(patchOnly)).toBe(true);
  });
});
