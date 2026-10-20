import { describe, it, expect } from "vitest";
import { applySessionToWidgets, applySessionToLayers, applySessionToDynamicViews, hasSessionChanges } from "./applySession";
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

describe("applySession phase 136", () => {
  it("APPLYS6-1: widgetMeta applies type/title/config to saved widgets, ref-stable when empty", () => {
    const sw = [w(11), w(12)];
    const d = derived({
      widgetMeta: { 12: { type: "line", title: "Fares", config: { sql: "S2" } } },
      appliedOpCount: 1,
    });
    const out = applySessionToWidgets(sw, d);
    expect(out[0]).toBe(sw[0]);
    expect(out[1]).toMatchObject({ id: 12, type: "line", title: "Fares", config: { sql: "S2" } });
    expect(applySessionToWidgets(sw, EMPTY_DERIVED)).toBe(sw);
  });
  it("APPLYS6-2: temp layer visibility applies to negative ids only, ref-stable when empty", () => {
    const sl = [l(7), l(-3), l(-4)];
    const out = applySessionToLayers(sl, derived({ appliedOpCount: 1, addedLayers: [] }), { [-3]: false });
    expect(out[1].config.visible).toBe(false);
    expect(out[0]).toBe(sl[0]);
    expect(out[2]).toBe(sl[2]);
    expect(applySessionToLayers(sl, EMPTY_DERIVED, {})).toBe(sl);
    expect(applySessionToLayers(sl, EMPTY_DERIVED, { 7: false })).toBe(sl);
  });
  it("APPLYS6-3: hasSessionChanges covers layout, widgetMeta and aiEditedLayerIds", () => {
    expect(hasSessionChanges(derived({ layout: { 1: { x: 0, y: 0, w: 6, h: 6 } } }))).toBe(true);
    expect(hasSessionChanges(derived({ widgetMeta: { 1: { title: "t" } } }))).toBe(true);
    expect(hasSessionChanges(derived({ aiEditedLayerIds: new Set([7]) }))).toBe(true);
  });
});

describe("applySession dynamic views (139)", () => {
  it("APPDV-1: applySessionToDynamicViews keeps identity, or filters removed saved views", () => {
    const saved = [{ id: 90 }, { id: 91 }];
    expect(applySessionToDynamicViews(saved, EMPTY_DERIVED)).toBe(saved);
    expect(applySessionToDynamicViews(saved, derived({ removedDynamicViewIds: new Set([90]) }))).toEqual([{ id: 91 }]);
  });
  it("APPDV-2: layerBinding rewrites only bound saved layers", () => {
    const sl = [l(7), l(8)];
    const out = applySessionToLayers(sl, derived({ layerBinding: { 7: { table_id: 5, dynamic_view_id: -3 } } }));
    expect(out[0]).toMatchObject({ id: 7, table_id: 5, dynamic_view_id: -3 });
    expect(out[1]).toBe(sl[1]);
    expect(sl[0].dynamic_view_id).toBeNull();
  });
  it("APPDV-3: hasSessionChanges sees each new field alone", () => {
    const dv = { id: -3, name: "v", spec: { baseTableId: 5 }, baseTableId: 5, columns: [], aggregated: false };
    expect(hasSessionChanges(derived({ addedDynamicViews: [dv as never] }))).toBe(true);
    expect(hasSessionChanges(derived({ removedDynamicViewIds: new Set([90]) }))).toBe(true);
    expect(hasSessionChanges(derived({ layerBinding: { 7: { table_id: 5, dynamic_view_id: null } } }))).toBe(true);
    expect(hasSessionChanges(EMPTY_DERIVED)).toBe(false);
  });
});
