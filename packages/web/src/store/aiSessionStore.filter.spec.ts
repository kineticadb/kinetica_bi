import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAiSessionStore, selectHasUnsavedAiChanges, hasUnsavedAiChanges, setAiFilterSink } from "./aiSessionStore";
import { SESSION_TURN_CAP } from "../lib/aiSession/constants";
import { computeChangeCounts } from "../lib/aiSession/changeCounts";
import { baselineFixture, applyFilterRaw, addWidgetOp } from "../test/aiSessionHarness";
import type { FilterDelta } from "../lib/aiSession/types";

const st = () => useAiSessionStore.getState();
const T5 = { kind: "table" as const, id: 5 };
const delta = (column = "payment_type"): FilterDelta => ({ source: T5, column, before: null, after: null });

beforeEach(() => {
  setAiFilterSink(null);
  st().reset();
});

describe("aiSessionStore filter ops (138)", () => {
  it("LOCKF-1: filter-only answer is a turn but never locks", () => {
    const b = baselineFixture();
    const { entries } = st().applyTurn({ prompt: "only cash", ops: [applyFilterRaw(T5, "payment_type")] }, b);
    expect(entries[0].result.status).toBe("applied");
    expect(hasUnsavedAiChanges()).toBe(false);
    expect(selectHasUnsavedAiChanges(st())).toBe(false);
    expect(st().derived.appliedOpCount).toBe(0);
    expect(st().turns.length).toBe(1);
  });

  it("LOCKF-2: a mixed turn locks and filter ops do not change counts", () => {
    const b = baselineFixture();
    st().applyTurn({ prompt: "x", ops: [addWidgetOp(-1), applyFilterRaw(T5, "payment_type")] }, b);
    expect(hasUnsavedAiChanges()).toBe(true);
    const c = computeChangeCounts(st().derived, b.widgets, b.layers);
    expect(c).toMatchObject({ added: 1, edited: 0, removed: 0 });
  });

  it("LOCKF-3: currentFilters reaches evaluateTurn (cap)", () => {
    const names = Array.from({ length: 25 }, (_, i) => (i === 0 ? "payment_type" : `c${i}`));
    const { entries } = st().applyTurn(
      { prompt: "x", ops: [applyFilterRaw(T5, "vendor_id")], currentFilters: { "table:5": names } },
      baselineFixture(),
    );
    expect(entries[0].result).toMatchObject({ status: "skipped", reason: "filter_cap" });
  });

  it("LOCKF-4: attachEntryFilterDeltas and appendFilterNotes", () => {
    const { turnId } = st().applyTurn({ prompt: "x", ops: [applyFilterRaw(T5, "payment_type")] }, baselineFixture());
    st().attachEntryFilterDeltas(turnId, 0, [delta()]);
    expect(st().turns[0].entries[0].filterDeltas).toHaveLength(1);
    const before = st().turns;
    st().attachEntryFilterDeltas("nope", 0, [delta()]);
    st().attachEntryFilterDeltas(turnId, 9, [delta()]);
    expect(st().turns).toBe(before);

    st().appendFilterNotes(turnId, ["a"]);
    st().appendFilterNotes(turnId, ["b"], [{ source: T5, column: "payment_type" }]);
    const chat = st().turns[0].chat!;
    expect(chat.filterNotes).toEqual(["a", "b"]);
    expect(chat.emptyFilters).toHaveLength(1);
    expect(chat.status).toBe("ok");
    st().appendFilterNotes("nope", ["z"]);
    expect(st().turns[0].chat!.filterNotes).toEqual(["a", "b"]);
  });

  it("LOCKF-4b: appendFilterNotes keeps existing chat fields", () => {
    const { turnId } = st().applyTurn(
      { prompt: "x", ops: [], chat: { status: "ok", followUps: ["f"] } },
      baselineFixture(),
    );
    st().appendFilterNotes(turnId, ["n"]);
    expect(st().turns[0].chat).toMatchObject({ status: "ok", followUps: ["f"], filterNotes: ["n"] });
  });

  it("LOCKF-5: cursor moves notify the sink", () => {
    const b = baselineFixture();
    const spy = vi.fn();
    setAiFilterSink({ onCursorMove: spy });
    st().applyTurn({ prompt: "1", ops: [applyFilterRaw(T5, "payment_type")] }, b);
    st().applyTurn({ prompt: "2", ops: [applyFilterRaw(T5, "vendor_id")] }, b);
    st().setCursor(-1, b);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1, -1, st().turns, st().baseEntries);
    st().setCursor(-1, b);
    expect(spy).toHaveBeenCalledTimes(1);
    st().setCursor(1, b);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1].slice(0, 2)).toEqual([-1, 1]);
    setAiFilterSink(null);
    st().setCursor(0, b);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("LOCKF-6: deltas survive the squash", () => {
    const b = baselineFixture();
    const { turnId } = st().applyTurn({ prompt: "0", ops: [applyFilterRaw(T5, "payment_type")] }, b);
    st().attachEntryFilterDeltas(turnId, 0, [delta()]);
    for (let i = 0; i < SESSION_TURN_CAP; i++) st().applyTurn({ prompt: `t${i}`, ops: [] }, b);
    expect(st().baseEntries.some((e) => e.filterDeltas?.length === 1)).toBe(true);
  });
});
