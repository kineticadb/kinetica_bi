// Phase 136 Plan 11: client-side end-to-end scripted session (real store + fold, no React render).
// Proves roadmap criterion 1 on the client: add/edit/retype/remove a chart, add/restyle/remove a
// heatmap layer, set_layout, the saved-removal approval, full undo/redo, WMS params and palette.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { applySessionToLayers, applySessionToWidgets } from "./applySession";
import { EMPTY_DERIVED, AI_SOURCE_ID } from "./constants";
import { applyLayerOverrides } from "../applyLayerOverrides";
import { buildWmsParams, type MapWidgetConfig } from "../wmsUrlBuilder";
import { AURORA_CHART_PALETTE } from "../chartTheme";
import {
  baselineFixture, addChartOp, patchWidgetOp, changeTypeOp, removeWidgetOp, patchLayerOp, removeLayerOp, setLayoutOp,
} from "../../test/aiSessionHarness";

const st = () => useAiSessionStore.getState();
const baseline = baselineFixture();
const heatOp = {
  op: "add_layer", tempId: -2, widgetId: 42, tableId: 5, renderMode: "heatmap", spatialMode: "latlon",
  latColumn: "lat", lonColumn: "lon", style: { colormap: "plasma", valueColumn: "fare_amount", opacity: 0.5 },
};

function play() {
  const turns = [
    [addChartOp(-1, "bar", "Fares by vendor", { tableId: 5, metric: "fare_amount", aggregation: "avg", groupByColumn: "vendor_id", color: "teal" }, { x: 0, y: 100, w: 18, h: 30 })],
    [patchWidgetOp(-1, { aggregation: "max", color: "amber" }), changeTypeOp(-1, "line")],
    [removeWidgetOp(50)],
    [removeWidgetOp(50)],
    [heatOp],
    [patchLayerOp(-2, { blurRadius: 12 }), patchLayerOp(7, { colormap: "viridis" })],
    [removeLayerOp(-2)],
    [setLayoutOp([{ id: 42, x: 0, y: 200, w: 18, h: 30 }])],
  ];
  return turns.map((ops, i) => {
    if (i === 3) st().approveRemoval();
    return st().applyTurn({ prompt: `t${i}`, ops }, baseline);
  });
}

describe("structural ops end-to-end (E2EW6)", () => {
  beforeEach(() => st().reset());
  afterEach(() => st().reset());

  it("E2EW6-1/2: scripted session applies each turn with the expected derived effect", () => {
    const r = play();
    expect(r.map((t) => t.entries.map((e) => e.result.status))).toEqual([
      ["applied"], ["applied", "applied"], ["skipped"], ["applied"], ["applied"], ["applied", "applied"], ["applied"], ["applied"],
    ]);
    expect(r[2].entries[0].result).toMatchObject({ reason: "needs_confirmation" });
    // turn 0
    st().setCursor(0, baseline);
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-1]);
    expect(st().derived.addedWidgets[0].config.layout).toEqual({ x: 0, y: 100, w: 18, h: 30 });
    // turn 1: retyped + edited
    st().setCursor(1, baseline);
    const w = st().derived.addedWidgets[0];
    expect(w.type).toBe("line");
    expect(String(w.config.sql)).toMatch(/^SELECT /);
    expect(String(w.config.sql)).toMatch(/MAX\(/i);
    // turn 2: skipped, nothing removed
    st().setCursor(2, baseline);
    expect(st().derived.removedWidgetIds.size).toBe(0);
    // turn 3: removed
    st().setCursor(3, baseline);
    expect(st().derived.removedWidgetIds.has(50)).toBe(true);
    // turn 4: AI heatmap
    st().setCursor(4, baseline);
    expect(st().derived.addedLayers.map((l) => l.id)).toEqual([-2]);
    // turn 5: restyle + flagged saved layer
    st().setCursor(5, baseline);
    expect(st().derived.aiEditedLayerIds.has(7)).toBe(true);
    // turn 6: AI layer removed
    st().setCursor(6, baseline);
    expect(st().derived.addedLayers).toHaveLength(0);
    // turn 7: layout moves the saved map
    st().setCursor(7, baseline);
    expect(st().derived.layout[42]).toEqual({ x: 0, y: 200, w: 18, h: 30 });
  });

  it("E2EW6-3: undo to the saved dashboard clears everything; redo restores; mid-point is consistent", () => {
    play();
    st().setCursor(-1, baseline);
    const d = st().derived;
    expect(d.addedWidgets).toEqual(EMPTY_DERIVED.addedWidgets);
    expect(d.removedWidgetIds.size).toBe(0);
    expect(d.addedLayers).toHaveLength(0);
    expect(d.removedLayerIds.size).toBe(0);
    expect(Object.keys(d.widgetMeta)).toHaveLength(0);
    expect(Object.keys(d.layout)).toHaveLength(0);
    expect(d.aiEditedWidgetIds.size).toBe(0);
    expect(d.aiEditedLayerIds.size).toBe(0);
    expect(useWidgetActionStore.getState().contributions[AI_SOURCE_ID]).toBeUndefined();
    expect(Object.keys(useWidgetActionStore.getState().widgetOverrides)).toHaveLength(0);
    expect(Object.keys(useWidgetActionStore.getState().layerOverrides)).toHaveLength(0);

    st().setCursor(7, baseline);
    expect(st().derived.addedWidgets).toHaveLength(1);
    expect(st().derived.removedWidgetIds.has(50)).toBe(true);
    expect(st().derived.layout[42]).toBeDefined();

    st().setCursor(3, baseline);
    expect(st().derived.addedLayers).toHaveLength(0);
    expect(st().derived.removedWidgetIds.has(50)).toBe(true);
    expect(applySessionToWidgets([...baseline.widgets], st().derived).some((x) => x.id === 50)).toBe(false);
  });

  it("E2EW6-4: effective AI heatmap layer yields heatmap WMS params; saved layer overlay carries the restyle", () => {
    play();
    st().setCursor(4, baseline);
    st().setCursor(5, baseline);
    // layer -2 was added at turn 4 and restyled at turn 5; replay to a cursor where it is live
    const effective = applySessionToLayers([...baseline.layers], st().derived);
    const ai = effective.find((l) => l.id === -2)!;
    expect(ai).toBeDefined();
    const cfg = ai.config as Record<string, unknown>;
    expect(cfg.POINTOPACITY).toBe(50);
    const params = buildWmsParams({ ...cfg, tableId: 5, tableRef: "demo.trips" } as unknown as MapWidgetConfig, undefined);
    expect(params.STYLES).toBe("heatmap");
    expect(params.COLORMAP).toBe("plasma");
    expect(params.BLUR_RADIUS).toBe("12");
    expect((params as Record<string, string>).VAL_ATTR).toBe("fare_amount");

    const overlaid = applyLayerOverrides(effective, useWidgetActionStore.getState().layerOverrides);
    expect((overlaid.find((l) => l.id === 7)!.config as Record<string, unknown>).colormap).toBe("viridis");
  });

  it("E2EW6-5: AI-added widget colours are palette colours and SQL is app-generated", () => {
    play();
    for (const cursor of [0, 1]) {
      st().setCursor(cursor, baseline);
      for (const w of st().derived.addedWidgets) {
        for (const k of ["color", "color1", "color2", "color3", "color4", "color5", "color6", "barColor"]) {
          const v = w.config[k];
          if (v !== undefined) expect(AURORA_CHART_PALETTE).toContain(v);
        }
        for (const bad of ["customWhere", "dynamicViewId", "metricId"]) expect(w.config).not.toHaveProperty(bad);
        expect(String(w.config.sql)).toMatch(/^SELECT /);
      }
    }
    st().setCursor(1, baseline);
    expect(st().derived.addedWidgets[0].config.color).toBe(AURORA_CHART_PALETTE[3]); // amber
  });
});
