/**
 * lib.aiKeepApply.spec.ts - Phase 141 Plan 06 Task 1 (AISES-V20-05/06): applyKeep, one transaction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  db,
  getDashboardVersion,
  getWidget,
  getDashboardLayer,
  getDashboardDynamicView,
  listWidgets,
  listDashboardLayers,
  listDashboardDynamicViews,
} from "../src/db";
import { applyKeep, KeepConflict, KeepInvalid } from "../src/lib/aiKeepApply";
import { collectSignedWidgetConfigRefs } from "../src/lib/dashboardExportRefs";
import { buildKeepFixture } from "./helpers/aiKeepFixture";

const counts = (D: number) => ({
  widgets: listWidgets(D).length,
  layers: listDashboardLayers(D).length,
  dvs: listDashboardDynamicViews(D).length,
  version: getDashboardVersion(D),
});

const hasNegative = (v: unknown): boolean => {
  if (typeof v === "number") return Number.isInteger(v) && v < 0;
  if (Array.isArray(v)) return v.some(hasNegative);
  if (v && typeof v === "object") return Object.values(v).some(hasNegative);
  return false;
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  db.exec("DROP TRIGGER IF EXISTS kbi_test_abort;");
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled(); // KEEP-APPLY-10
  fetchSpy.mockRestore();
});

describe("applyKeep (KEEP-APPLY-)", () => {
  it("KEEP-APPLY-1: returns before/version/idMap with positive created ids", () => {
    const f = buildKeepFixture();
    const r = applyKeep(f.D, f.change, f.prepared);
    expect(r.before).toBe(f.change.baselineVersion);
    expect(r.version).toBe(getDashboardVersion(f.D));
    expect(r.version).toBeGreaterThan(r.before);
    expect(r.warnings).toEqual(["w1"]);
    expect(r.idMap.dynamicViews["-3"]).toBeGreaterThan(0);
    expect(getDashboardDynamicView(r.idMap.dynamicViews["-3"])?.name).toBe("AI view");
    expect(getDashboardLayer(r.idMap.layers["-2"])?.dashboard_id).toBe(f.D);
    for (const k of ["-1", "-4", "-5"]) expect(getWidget(r.idMap.widgets[k])?.dashboard_id).toBe(f.D);
  });

  it("KEEP-APPLY-2: every temp id rewritten to its real id; no negative survives", () => {
    const f = buildKeepFixture();
    const r = applyKeep(f.D, f.change, f.prepared);
    const dv = r.idMap.dynamicViews["-3"], ly = r.idMap.layers["-2"];
    const map = getWidget(r.idMap.widgets["-1"])!, bar = getWidget(r.idMap.widgets["-4"])!, leg = getWidget(r.idMap.widgets["-5"])!;
    expect(getDashboardLayer(ly)!.dynamic_view_id).toBe(dv);
    expect(map.config.includedLayerIds).toEqual([ly]);
    expect(bar.config.dynamicViewId).toBe(dv);
    expect(bar.config.tableId).toBe(f.T);
    expect(leg.config.sourceMapWidgetId).toBe(map.id);
    expect((leg.config.filterSelection as any).allowedSourceWidgetIds).toEqual([bar.id]);
    expect(getWidget(f.W2)!.config.includedLayerIds).toEqual([f.L1, ly]);
    for (const w of listWidgets(f.D)) {
      expect(hasNegative(w.config)).toBe(false);
      expect(collectSignedWidgetConfigRefs(w.config).some((x) => x.id < 0)).toBe(false);
    }
    for (const l of listDashboardLayers(f.D)) expect(hasNegative({ ...l })).toBe(false);
    for (const v of listDashboardDynamicViews(f.D)) expect(hasNegative({ ...v })).toBe(false);
  });

  it("KEEP-APPLY-3: added widget layout equals rect; edited W1 layout replaced", () => {
    const f = buildKeepFixture();
    const r = applyKeep(f.D, f.change, f.prepared);
    f.change.widgets.add.forEach((a) => expect(getWidget(r.idMap.widgets[String(a.tempId)])!.config.layout).toEqual(a.rect));
    expect(getWidget(f.W1)!.config.layout).toEqual({ x: 6, y: 0, w: 6, h: 8 });
  });

  it("KEEP-APPLY-4: edits merge into the stored rows", () => {
    const f = buildKeepFixture();
    applyKeep(f.D, f.change, f.prepared);
    const w1 = getWidget(f.W1)!;
    expect(w1.config.title_x).toBe("y");
    expect("dynamicViewId" in w1.config).toBe(false);
    expect(w1.config.sql).toBe("SELECT 1");
    expect(w1.title).toBe("Renamed");
    expect(w1.type).toBe("line");
    const l1 = getDashboardLayer(f.L1)!;
    expect(l1.config.POINTOPACITY).toBe(40);
    expect(l1.config.POINTSIZE).toBe(3);
    expect(l1.config.renderMode).toBe("points");
    expect(l1.dynamic_view_id).toBeNull();
    expect("dynamicViewId" in l1.config).toBe(false);
  });

  it("KEEP-APPLY-5: new layer has info_enabled 1 (clickable like a hand-made layer), visible false, table T", () => {
    const f = buildKeepFixture();
    const r = applyKeep(f.D, f.change, f.prepared);
    const l = getDashboardLayer(r.idMap.layers["-2"])!;
    expect(l.info_enabled).toBe(1);
    expect(l.config.visible).toBe(false);
    expect(l.table_id).toBe(f.T);
  });

  it("KEEP-APPLY-6: removals run and removedDynamicViewIds is reported", () => {
    const f = buildKeepFixture();
    const r = applyKeep(f.D, f.change, f.prepared);
    expect(getWidget(f.W3)).toBeUndefined();
    expect(getDashboardDynamicView(f.V70)).toBeUndefined();
    expect(r.removedDynamicViewIds).toEqual([f.V70]);
  });

  it("KEEP-APPLY-7: stale baseline throws KeepConflict and writes nothing", () => {
    const f = buildKeepFixture();
    const before = counts(f.D);
    f.change.baselineVersion = before.version! - 1;
    expect(() => applyKeep(f.D, f.change, f.prepared)).toThrow(KeepConflict);
    expect(counts(f.D)).toEqual(before);
    expect(getWidget(f.W3)).toBeDefined();
  });

  it("KEEP-APPLY-8: unmapped temp id throws KeepInvalid and writes nothing", () => {
    const f = buildKeepFixture();
    f.change.widgets.add[1].config = { dynamicViewId: -9 };
    const before = counts(f.D);
    let err: unknown;
    try { applyKeep(f.D, f.change, f.prepared); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(KeepInvalid);
    expect((err as Error).message).toContain("temporary dynamic view id -9");
    expect(counts(f.D)).toEqual(before);
  });

  it("KEEP-APPLY-9: added widgets are created in request order", () => {
    const f = buildKeepFixture();
    const r = applyKeep(f.D, f.change, f.prepared);
    const ids = f.change.widgets.add.map((a) => r.idMap.widgets[String(a.tempId)]);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});
