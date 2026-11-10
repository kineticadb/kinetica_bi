import { describe, it, expect } from "vitest";
import { buildProposalGhosts } from "./proposalGhosts";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { baselineFixture, addWidgetOp, addLayerOp, applyFilterRaw } from "../../test/aiSessionHarness";

const baseline = baselineFixture();
const build = (ops: unknown[], ticked: number[]) => buildProposalGhosts({ baseline, priorEntries: [], ops, ticked, removalApproved: false });
const dv = { op: "add_dynamic_view", tempId: -1, name: "Trips", spec: { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] } };

describe("buildProposalGhosts", () => {
  it("APPRGHOST-1: a ticked add_widget becomes a ghost widget, a filter is not represented", () => {
    const w = { ...addWidgetOp(-1, "records", "Bar A", { tableId: 5 }), layout: { x: 0, y: 0, w: 12, h: 8 } };
    const g = build([w, applyFilterRaw({ kind: "table", id: 5 }, "vendor_id", "V1")], [0, 1])!;
    expect(g.widgets.map((x) => x.id)).toEqual([-1]);
    expect(g.layers).toEqual([]);
    expect(g.rects[-1]).toEqual({ x: 0, y: 0, w: 12, h: 8 });
  });

  it("APPRGHOST-2: nothing ghost-eligible ticked gives null", () => {
    expect(build([addWidgetOp(-1, "records", "A", { tableId: 5 }), applyFilterRaw({ kind: "table", id: 5 }, "vendor_id", "V1")], [1])).toBeNull();
  });

  it("APPRGHOST-3: a widget that needs a view added by the same answer gets no ghost", () => {
    const g = build([dv, addWidgetOp(-2, "records", "On view", { dynamicViewId: -1 }), addWidgetOp(-3, "records", "Plain", { tableId: 5 })], [0, 1, 2])!;
    expect(g.widgets.map((x) => x.id)).toEqual([-3]);
  });

  it("APPRGHOST-4: ghost layers are dimmed to 40% and mapped to their host", () => {
    const g = build([addWidgetOp(-1, "map", "M"), addLayerOp(-2, -1)], [0, 1])!;
    expect(g.widgets.map((x) => x.id)).toEqual([-1]);
    expect(g.layers.map((l) => l.id)).toEqual([-2]);
    expect(g.layers[0].config.POINTOPACITY).toBe(40);
    expect(g.layerHosts).toEqual({ [-2]: -1 });
    const half = build([{ ...addLayerOp(-2, 42), style: { opacity: 0.5 } }], [0])!;
    expect(half.layers[0].config.POINTOPACITY).toBe(20);
    expect(half.layerHosts).toEqual({ [-2]: 42 });
    expect(half.widgets).toEqual([]);
  });

  it("APPRGHOST-5: pure - the store derived state is untouched", () => {
    const before = useAiSessionStore.getState().derived;
    build([addWidgetOp(-1, "records", "A", { tableId: 5 })], [0]);
    expect(useAiSessionStore.getState().derived).toBe(before);
  });
});
