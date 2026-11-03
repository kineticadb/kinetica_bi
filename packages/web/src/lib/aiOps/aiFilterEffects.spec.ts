// 138-05 Task 2: Revert / Forward / Discard restore filters per column.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useFilterStore } from "../../store/filterStore";
import { useAiSessionStore, setAiFilterSink } from "../../store/aiSessionStore";
import { baselineFixture, applyFilterRaw, clearFilterRaw, addWidgetOp } from "../../test/aiSessionHarness";
import { executeFilterOp, currentFilterColumns } from "./aiFilterApplier";
import { installAiFilterEffects, discardAiSession, deltasOfEntries } from "./aiFilterEffects";
import type { TurnEntry } from "../aiSession/types";

const baseline = baselineFixture();
const T5 = { kind: "table" as const, id: 5 };
const fs = () => useFilterStore.getState();
const ss = () => useAiSessionStore.getState();
const user = (column: string, value: string) => ({ column, value, dataType: "string" as const, addedAt: 1 });
const cols = (id = 5) => (fs().filters[id] ?? []).map((f) => `${f.column}=${String(f.value)}`).sort();

function aiTurn(ops: unknown[]) {
  const { turnId, entries } = ss().applyTurn({ prompt: "q", ops, currentFilters: currentFilterColumns() }, baseline);
  entries.forEach((e, i) => {
    if (e.result.status === "applied" && e.op) {
      const d = executeFilterOp(e.op);
      if (d.length) ss().attachEntryFilterDeltas(turnId, i, d);
    }
  });
}
const setCursor = (i: number) => ss().setCursor(i, baseline);

beforeEach(() => {
  fs().reset();
  ss().reset();
  installAiFilterEffects();
});
afterEach(() => setAiFilterSink(null));

describe("aiFilterEffects", () => {
  it("UNDOF-1: install is idempotent; one revert undoes once", () => {
    installAiFilterEffects();
    installAiFilterEffects();
    fs().addFilter(5, user("vendor_id", "V1"));
    aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    expect(cols()).toEqual(["payment_type=Credit", "vendor_id=V1"]);
    setCursor(-1);
    expect(cols()).toEqual(["vendor_id=V1"]);
  });

  it("UNDOF-2 (D-11): manual filter added after the AI turn survives revert and forward", () => {
    aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    fs().addFilter(5, user("vendor_id", "V1"));
    setCursor(-1);
    expect(cols()).toEqual(["vendor_id=V1"]);
    setCursor(0);
    expect(cols()).toEqual(["payment_type=Credit", "vendor_id=V1"]);
  });

  it("UNDOF-3: revert restores the user's prior value on that column", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    expect(cols()).toEqual(["payment_type=Credit"]);
    setCursor(-1);
    expect(cols()).toEqual(["payment_type=Cash"]);
    setCursor(0);
    expect(cols()).toEqual(["payment_type=Credit"]);
  });

  it("UNDOF-4 (D-07): clear-all is undone and redone", () => {
    fs().addFilter(5, user("a", "1"));
    fs().addFilter(1, user("b", "2"));
    fs().addDvFilter(90, user("c", "3"));
    aiTurn([clearFilterRaw()]);
    expect(currentFilterColumns()).toEqual({});
    setCursor(-1);
    expect(currentFilterColumns()).toEqual({ "table:5": ["a"], "table:1": ["b"], "dynamicView:90": ["c"] });
    setCursor(0);
    expect(currentFilterColumns()).toEqual({});
  });

  it("UNDOF-5 (D-12): discard restores prior state, keeps later manual filters, empties session", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    fs().addFilter(5, user("vendor_id", "V1"));
    discardAiSession();
    expect(cols()).toEqual(["payment_type=Cash", "vendor_id=V1"]);
    expect(ss().turns).toEqual([]);
  });

  it("UNDOF-6: discard after a revert does not undo twice", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    aiTurn([applyFilterRaw(T5, "vendor_id", "V1")]);
    setCursor(-1);
    expect(cols()).toEqual(["payment_type=Cash"]);
    discardAiSession();
    expect(cols()).toEqual(["payment_type=Cash"]);
  });

  it("UNDOF-7: deltas squashed into baseEntries are undone by discard", () => {
    aiTurn([applyFilterRaw(T5, "payment_type", "Credit")]);
    for (let i = 0; i < 50; i++) aiTurn([addWidgetOp(-1 - i)]);
    expect(ss().droppedCount).toBeGreaterThan(0);
    expect(cols()).toEqual(["payment_type=Credit"]);
    discardAiSession();
    expect(cols()).toEqual([]);
  });

  it("UNDOF-8: deltasOfEntries flattens in order and ignores entries without deltas", () => {
    const d = (column: string) => ({ source: T5, column, before: null, after: null });
    const entries = [
      { filterDeltas: [d("a"), d("b")] },
      {},
      { filterDeltas: [d("c")] },
    ] as unknown as TurnEntry[];
    expect(deltasOfEntries(entries).map((x) => x.column)).toEqual(["a", "b", "c"]);
  });
});
