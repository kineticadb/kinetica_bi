// 138-05 Task 1: AI filter applier writes filterStore exactly like a click / chip.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import type { AiOp } from "@kinetica-bi/shared";
import { useFilterStore } from "../../store/filterStore";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import {
  executeFilterOp,
  undoFilterDeltas,
  redoFilterDeltas,
  clearFilterAsUser,
  currentFilterColumns,
  currentFilter,
} from "./aiFilterApplier";

const T5 = { kind: "table" as const, id: 5 };
const DV90 = { kind: "dynamicView" as const, id: 90 };
const apply = (source: typeof T5 | typeof DV90, filters: unknown[]) => ({ op: "apply_filter", source, filters }) as unknown as AiOp;
const eq = (column: string, value: string | number | boolean) => ({ column, operator: "eq", value, dataType: typeof value === "number" ? "number" : "string" });
const fs = () => useFilterStore.getState();
const user = (column: string, value: string) => ({ column, value, dataType: "string" as const, addedAt: 1 });

beforeEach(() => {
  useFilterStore.getState().reset();
  useSpatialFilterStore.getState().reset();
});

describe("aiFilterApplier", () => {
  it("APF-1: stores a click-shaped filter with aiApplied and no operator/sourceWidgetId", () => {
    const v0 = fs().filterVersion;
    const ds = executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    const stored = fs().filters[5];
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(["addedAt", "aiApplied", "column", "dataType", "value"]);
    expect(stored[0]).toMatchObject({ column: "payment_type", value: "Credit", dataType: "string", aiApplied: true });
    expect(typeof stored[0].addedAt).toBe("number");
    expect(ds).toHaveLength(1);
    expect(ds[0].before).toBeNull();
    expect(ds[0].after).toBe(stored[0]);
    expect(fs().filterVersion).toBe(v0 + 1);
  });

  it("APF-2: click parity (minus addedAt/aiApplied/sourceWidgetId)", () => {
    executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    const { addedAt: _a, aiApplied: _b, ...ai } = fs().filters[5][0];
    const click = { column: "payment_type", value: "Credit", dataType: "string", sourceWidgetId: 3, addedAt: 9 };
    const { sourceWidgetId: _s, addedAt: _c, ...clickRest } = click;
    expect(ai).toEqual(clickRest);
  });

  it("APF-3: in / between / isNull shapes", () => {
    executeFilterOp(
      apply(T5, [
        { column: "a", operator: "in", value: ["a", "b"] },
        { column: "b", operator: "between", value: [1, 5] },
        { column: "c", operator: "isNull" },
      ]),
    );
    const by = (c: string) => fs().filters[5].find((f) => f.column === c)!;
    expect(by("a")).toMatchObject({ operator: "in", value: ["a", "b"] });
    expect(by("b")).toMatchObject({ operator: "between", value: [1, 5] });
    expect(by("c")).toMatchObject({ value: null, dataType: "null" });
    expect("operator" in by("c")).toBe(false);
  });

  it("APF-4: dynamicView source writes dvFilters", () => {
    executeFilterOp(apply(DV90, [eq("zone", "x")]));
    expect(fs().dvFilters[90]).toHaveLength(1);
    expect(fs().filters[90]).toBeUndefined();
  });

  it("APF-5 (D-05): same column replaces; delta.before is the user object", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    const userObj = fs().filters[5][0];
    const ds = executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    expect(fs().filters[5]).toHaveLength(1);
    expect(fs().filters[5][0].value).toBe("Credit");
    expect(ds[0].before).toBe(userObj);
  });

  it("APF-6 (D-06): other columns stack", () => {
    fs().addFilter(5, user("vendor_id", "V1"));
    executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    expect(fs().filters[5].map((f) => f.column).sort()).toEqual(["payment_type", "vendor_id"]);
  });

  it("APF-7: no-op when the same value is already applied", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    const v0 = fs().filterVersion;
    const ds = executeFilterOp(apply(T5, [eq("payment_type", "Cash")]));
    expect(ds).toEqual([]);
    expect(fs().filterVersion).toBe(v0);
  });

  it("APF-8 (D-07): clear column / source / all; shapes untouched", () => {
    fs().addFilter(5, user("a", "1"));
    fs().addFilter(5, user("b", "2"));
    fs().addFilter(6, user("c", "3"));
    fs().addDvFilter(90, user("d", "4"));
    expect(executeFilterOp({ op: "clear_filter", source: T5, column: "a" } as AiOp)).toHaveLength(1);
    expect(fs().filters[5].map((f) => f.column)).toEqual(["b"]);
    fs().addFilter(5, user("a", "1"));
    expect(executeFilterOp({ op: "clear_filter", source: T5 } as AiOp)).toHaveLength(2);
    expect(fs().filters[5] ?? []).toHaveLength(0);
    useSpatialFilterStore.getState().addShape({ type: "polygon", wkt: "POLYGON((0 0,1 0,1 1,0 0))" } as never);
    const ds = executeFilterOp({ op: "clear_filter" } as AiOp);
    expect(ds).toHaveLength(2);
    expect(ds.every((d) => d.after === null && d.before !== null)).toBe(true);
    expect(fs().filters[6] ?? []).toHaveLength(0);
    expect(fs().dvFilters[90] ?? []).toHaveLength(0);
    expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
  });

  it("APF-9 (D-11): undo/redo never clobber later manual filters", () => {
    const d1 = executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    fs().addFilter(5, user("vendor_id", "V1"));
    undoFilterDeltas(d1);
    expect(fs().filters[5].map((f) => f.column)).toEqual(["vendor_id"]);

    useFilterStore.getState().reset();
    const d2 = executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    fs().addFilter(5, user("payment_type", "Card"));
    undoFilterDeltas(d2);
    expect(fs().filters[5][0].value).toBe("Card");

    useFilterStore.getState().reset();
    const d3 = executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    undoFilterDeltas(d3);
    fs().addFilter(5, user("payment_type", "Cash"));
    redoFilterDeltas(d3);
    expect(fs().filters[5][0].value).toBe("Cash");
  });

  it("APF-10: chained undo and redo", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    const d1 = executeFilterOp(apply(T5, [eq("payment_type", "Credit")]));
    const d2 = executeFilterOp(apply(T5, [eq("payment_type", "Card")]));
    undoFilterDeltas(d2);
    undoFilterDeltas(d1);
    expect(fs().filters[5][0].value).toBe("Cash");
    redoFilterDeltas(d1);
    redoFilterDeltas(d2);
    expect(fs().filters[5][0].value).toBe("Card");
  });

  it("APF-11: currentFilterColumns shape; clearFilterAsUser", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    fs().addFilter(5, user("vendor_id", "V1"));
    fs().addDvFilter(90, user("zone", "z"));
    expect(currentFilterColumns()).toEqual({ "table:5": ["payment_type", "vendor_id"], "dynamicView:90": ["zone"] });
    clearFilterAsUser(T5, "payment_type");
    expect(currentFilter(T5, "payment_type")).toBeNull();
    clearFilterAsUser(DV90, "zone");
    expect(currentFilterColumns()).toEqual({ "table:5": ["vendor_id"] });
  });

  it("APF-12: applier source never touches the forbidden modules", () => {
    const src = readFileSync(resolve(__dirname, "aiFilterApplier.ts"), "utf8");
    for (const banned of ["filterViewStore", "materializeFilter", "clearAllFilters", "setBulkFilters", "useSpatialFilterStore", "sourceWidgetId:"]) {
      expect(src.includes(banned), banned).toBe(false);
    }
  });
});
