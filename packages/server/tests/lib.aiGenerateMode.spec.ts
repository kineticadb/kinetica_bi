import { describe, it, expect } from "vitest";
import { placeGenerateBands, type AiOp } from "@kinetica-bi/shared";
import {
  GENERATE_TOO_FEW_MESSAGE, applyGenerateBands, buildGenerateRecipe, countDataWidgetAdds, generateLimits, generateNudge,
} from "../src/lib/ai/generateMode";

const add = (tempId: number, type: string, layout?: { x: number; y: number; w: number; h: number }): AiOp =>
  ({ op: "add_widget", tempId, type, title: `w${tempId}`, config: {}, ...(layout ? { layout } : {}) }) as AiOp;

describe("generateMode", () => {
  it("GENMODE-1 limits", () => {
    expect(generateLimits({ maxToolSteps: 8, maxNewWidgets: 6 })).toEqual({ maxToolSteps: 20, maxNewWidgets: 8 });
    expect(generateLimits({ maxToolSteps: 30, maxNewWidgets: 30 })).toEqual({ maxToolSteps: 30, maxNewWidgets: 8 });
    expect(generateLimits({ maxToolSteps: 50, maxNewWidgets: 2 }).maxToolSteps).toBe(50);
    expect(generateLimits({ maxToolSteps: 80, maxNewWidgets: 2 }).maxToolSteps).toBe(50);
  });
  it("GENMODE-2 recipe", () => {
    const s = buildGenerateRecipe("schema");
    for (const f of ["between 4 and 8", "bignumber", "line", "records", "add_layer", "heatmap", "Do not call set_layout", "column names and types"]) {
      expect(s).toContain(f);
    }
    expect(s).not.toContain("get_column_profile");
    expect(buildGenerateRecipe("query")).toContain("get_column_profile");
    expect(s).not.toContain("12 tools");
    expect(buildGenerateRecipe("query")).not.toContain("12 tools");
  });
  it("GENMODE-3 nudge", () => {
    expect(generateNudge(2)).toBe("Only 2 widgets were added. A starter dashboard needs at least 4: add more widgets from the recipe now, then reply.");
    expect(generateNudge(1)).toContain("1 widget was added");
  });
  it("GENMODE-4 count", () => {
    const ops = [add(-1, "bar"), { op: "add_layer", tempId: -9, widgetId: -1, tableId: "t", renderMode: "heatmap" } as unknown as AiOp, add(-2, "map")];
    expect(countDataWidgetAdds(ops)).toBe(2);
  });
  it("GENMODE-5 rewrite", () => {
    const layer = { op: "add_layer", tempId: -9, widgetId: -2, tableId: "t", renderMode: "heatmap" } as unknown as AiOp;
    const ops: AiOp[] = [
      add(-1, "bignumber", { x: 0, y: 50, w: 9, h: 14 }), layer, add(-2, "map", { x: 3, y: 3, w: 28, h: 45 }),
      { op: "set_layout", items: [{ id: -1, x: 0, y: 0, w: 9, h: 14 }] } as AiOp, add(-3, "records"),
    ];
    const snap = JSON.stringify(ops);
    const out = applyGenerateBands(ops);
    const rects = placeGenerateBands([{ key: -1, type: "bignumber" }, { key: -2, type: "map" }, { key: -3, type: "records" }]);
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.op)).toEqual(["add_widget", "add_layer", "add_widget", "add_widget"]);
    expect(out[1]).toBe(layer);
    expect((out[0] as { layout: unknown }).layout).toEqual(rects[-1]);
    expect((out[2] as { layout: unknown }).layout).toEqual(rects[-2]);
    expect((out[3] as { layout: unknown }).layout).toEqual(rects[-3]);
    expect(JSON.stringify(ops)).toBe(snap);
  });
  it("GENMODE-6 constant", () => {
    expect(GENERATE_TOO_FEW_MESSAGE).toBe("Couldn't build a starter dashboard from this table. Try again, or ask for specific charts.");
  });
});
