// 151-02: undoAiOps / redoAiOps - store first, filter writes after, via the guarded applier.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AI_FILTER_CAP_PER_TABLE } from "@kinetica-bi/shared";
import { useFilterStore } from "../../store/filterStore";
import { useAiSessionStore, setAiFilterSink } from "../../store/aiSessionStore";
import { baselineFixture, applyFilterRaw, addWidgetOp, mapWidget, recordsWidget } from "../../test/aiSessionHarness";
import { executeFilterOp, currentFilterColumns } from "./aiFilterApplier";
import { installAiFilterEffects, discardAiSession } from "./aiFilterEffects";
import { planUndo } from "../aiSession/undoPlan";
import { undoAiOps, redoAiOps } from "./undoAiOp";
import type { SessionBaseline } from "../aiSession/types";
import type { WidgetDto } from "../../api/client";

const baseline = baselineFixture();
const T5 = { kind: "table" as const, id: 5 };
const fs = () => useFilterStore.getState();
const ss = () => useAiSessionStore.getState();
const user = (column: string, value: string) => ({ column, value, dataType: "string" as const, addedAt: 1 });
const cols = () => (fs().filters[5] ?? []).map((f) => `${f.column}=${String(f.value)}`).sort();
const ref = (turnId: string, entryIndex: number) => ({ turnId, entryIndex });

function aiTurn(ops: unknown[], b: SessionBaseline = baseline) {
  const { turnId, entries } = ss().applyTurn({ prompt: "q", ops, currentFilters: currentFilterColumns() }, b);
  entries.forEach((e, i) => {
    if (e.result.status === "applied" && e.op) {
      const d = executeFilterOp(e.op);
      if (d.length) ss().attachEntryFilterDeltas(turnId, i, d);
    }
  });
  return turnId;
}

beforeEach(() => {
  fs().reset();
  ss().reset();
  installAiFilterEffects();
});
afterEach(() => setAiFilterSink(null));

describe("undoAiOp (151)", () => {
  it("UNDOFLT-1: undo removes only that column; user filters stay", () => {
    fs().addFilter(5, user("vendor_id", "V1"));
    const t = aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    expect(cols()).toEqual(["payment_type=Credit", "vendor_id=V1"]);
    undoAiOps([ref(t, 0)], baseline);
    expect(cols()).toEqual(["vendor_id=V1"]);
    expect(ss().turns[0].entries[0].undone).toBe(true);
  });

  it("UNDOFLT-2: Revert then Forward does not re-apply an undone filter", () => {
    const t = aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    undoAiOps([ref(t, 0)], baseline);
    ss().setCursor(-1, baseline);
    ss().setCursor(0, baseline);
    expect(cols()).toEqual([]);
  });

  it("UNDOFLT-3: Discard does not clobber a filter the user set after the undo", () => {
    const t = aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    undoAiOps([ref(t, 0)], baseline);
    fs().addFilter(5, user("payment_type", "Cash"));
    discardAiSession();
    expect(cols()).toEqual(["payment_type=Cash"]);
  });

  it("UNDOFLT-4: redo re-applies the filter with fresh deltas", () => {
    const t = aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    undoAiOps([ref(t, 0)], baseline);
    expect(redoAiOps(ref(t, 0), baseline)).toEqual({ ok: true });
    expect(cols()).toEqual(["payment_type=Credit"]);
    const e = ss().turns[0].entries[0];
    expect(e.undone).toBeUndefined();
    expect(e.filterDeltas?.length).toBe(1);
  });

  it("UNDOFLT-5: a redo refused by revalidation changes nothing and says why", () => {
    const t0 = aiTurn([addWidgetOp(-1)]);
    undoAiOps([ref(t0, 0)], baseline);
    aiTurn([addWidgetOp(-1)]);
    const before = ss().turns;
    const r = redoAiOps(ref(t0, 0), baseline);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.startsWith("Can't be redone now:")).toBe(true);
    expect(ss().turns).toBe(before);
  });

  it("UNDOFLT-6: view + chart undo across turns, then redo of the chart brings both back", () => {
    const bar: WidgetDto = { id: 42, dashboard_id: 1, title: "bar", type: "bar", position: 0, config: {}, created_at: "", updated_at: "" };
    const b0 = baselineFixture({ widgets: [bar, mapWidget(43), recordsWidget(50)], layers: [], dynamicViewIds: [90] });
    const b: SessionBaseline = { ...b0, dynamicViewSources: { 90: 5 }, dynamicViewColumns: { 90: [{ name: "trips", type: "long" }] }, dynamicViewNames: { 90: "Saved view" } };
    const spec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
    const dv = { op: "add_dynamic_view", tempId: -3, name: "Trips by type", spec, columns: [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }], maxRecords: 1000, aggregated: true };
    const chart = { op: "add_widget", tempId: -4, type: "bar", title: "dv bar", config: { dynamicViewId: -3, metric: "trips", aggregation: "sum", groupByColumn: "payment_type" } };
    const t0 = aiTurn([dv], b);
    const t1 = aiTurn([chart], b);
    expect(ss().derived.addedWidgets.map((w) => w.id)).toEqual([-4]);
    const plan = planUndo(b, { baseEntries: ss().baseEntries, turns: ss().turns }, ref(t0, 0))!;
    expect(plan.refs).toHaveLength(2);
    undoAiOps(plan.refs, b);
    expect(ss().derived.addedWidgets).toEqual([]);
    expect(ss().derived.addedDynamicViews ?? []).toEqual([]);
    expect(redoAiOps(ref(t1, 0), b)).toEqual({ ok: true });
    expect(ss().derived.addedWidgets.map((w) => w.id)).toEqual([-4]);
    expect((ss().derived.addedDynamicViews ?? []).length).toBe(1);
  });

  it("UNDOFLT-7: a redo the filter store refuses rolls back and reports a reason", () => {
    const t = aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    undoAiOps([ref(t, 0)], baseline);
    for (let i = 0; i < AI_FILTER_CAP_PER_TABLE; i++) fs().addFilter(5, user(`c${i}`, "x"));
    const before = cols();
    const r = redoAiOps(ref(t, 0), baseline);
    expect(r.ok).toBe(false);
    expect(ss().turns[0].entries[0].undone).toBe(true);
    expect(cols()).toEqual(before);
  });
});
