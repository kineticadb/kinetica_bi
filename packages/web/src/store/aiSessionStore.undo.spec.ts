// 151-02: per-step undo in the AI session store (one set(), derived/overlay/dv sink together).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAiSessionStore, setAiDvSink, setAiFilterSink, selectHasUnsavedAiChanges } from "./aiSessionStore";
import { BASE_TURN_ID, SESSION_TURN_CAP } from "../lib/aiSession/constants";
import { buildKeepPayload } from "../lib/aiSession/keepPayload";
import { baselineFixture, addWidgetOp, addLayerOp, setTitleOp, applyFilterRaw } from "../test/aiSessionHarness";
import type { TableDto } from "../api/client";

const st = () => useAiSessionStore.getState();
const base = baselineFixture();
const ref = (turnId: string, entryIndex: number) => ({ turnId, entryIndex });
const ids = () => st().derived.addedWidgets.map((w) => w.id);

beforeEach(() => {
  setAiDvSink(null);
  setAiFilterSink(null);
  st().reset();
});

function threeAdds(labels = ['Added records "A"', 'Added records "B"', 'Added records "C"']) {
  return st().applyTurn(
    { prompt: "p", ops: [addWidgetOp(-1), addWidgetOp(-2), addWidgetOp(-3)], chat: { status: "ok", applied: labels } },
    base,
  );
}

describe("aiSessionStore per-step undo (151)", () => {
  it("UNDOSTORE-1: marks and unmarks one entry; derived follows", () => {
    const { turnId } = threeAdds();
    st().setEntriesUndone([ref(turnId, 1)], true, base);
    expect(st().turns[0].entries[1].undone).toBe(true);
    expect(ids()).toEqual([-1, -3]);
    expect(st().derived.appliedOpCount).toBe(2);
    st().setEntriesUndone([ref(turnId, 1)], false, base);
    expect(ids()).toEqual([-1, -2, -3]);
    expect("undone" in st().turns[0].entries[1]).toBe(false);
  });

  it("UNDOSTORE-2: undone survives revert and forward", () => {
    const { turnId } = threeAdds();
    st().applyTurn({ prompt: "q", ops: [setTitleOp(42, "x")] }, base);
    st().setEntriesUndone([ref(turnId, 0)], true, base);
    st().setCursor(-1, base);
    st().setCursor(1, base);
    expect(st().turns[0].entries[0].undone).toBe(true);
    expect(ids()).toEqual([-2, -3]);
  });

  it("UNDOSTORE-3: one store notification and one dv sink call per undo", () => {
    const { turnId } = threeAdds();
    const onDerived = vi.fn();
    setAiDvSink({ onDerived, onReset: vi.fn() });
    let n = 0;
    const unsub = useAiSessionStore.subscribe(() => n++);
    st().setEntriesUndone([ref(turnId, 1)], true, base);
    unsub();
    expect(n).toBe(1);
    expect(onDerived).toHaveBeenCalledTimes(1);
    expect(onDerived.mock.calls[0][0].addedWidgets.map((w: { id: number }) => w.id)).toEqual([-1, -3]);
    setAiDvSink(null);
  });

  it("UNDOSTORE-4: all undone is not unsaved, including an entry ahead of the cursor; redo restores it", () => {
    const { turnId } = threeAdds();
    const t2 = st().applyTurn({ prompt: "q", ops: [setTitleOp(42, "x")] }, base).turnId;
    expect(selectHasUnsavedAiChanges(st())).toBe(true);
    st().setCursor(0, base);
    st().setEntriesUndone([ref(turnId, 0), ref(turnId, 1), ref(turnId, 2)], true, base);
    expect(selectHasUnsavedAiChanges(st())).toBe(true);
    st().setEntriesUndone([ref(t2, 0)], true, base);
    expect(selectHasUnsavedAiChanges(st())).toBe(false);
    st().setEntriesUndone([ref(t2, 0)], false, base);
    expect(selectHasUnsavedAiChanges(st())).toBe(true);
  });

  it("UNDOSTORE-5: undo drops geometry, userMoved and layer visibility; markUserMoved keeps AI ids only", () => {
    const { turnId } = st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1, "map"), addWidgetOp(-2), addLayerOp(-5, -1)] }, base);
    st().setGeometry(-2, { x: 0, y: 0, w: 4, h: 4 });
    st().markUserMoved([-1, -2, 42]);
    expect(Object.keys(st().userMoved).map(Number).sort()).toEqual([-2, -1]);
    st().setTempLayerVisible(-5, false);
    st().setEntriesUndone([ref(turnId, 1)], true, base);
    expect(st().geometry[-2]).toBeUndefined();
    expect(st().userMoved[-2]).toBeUndefined();
    expect(st().userMoved[-1]).toBe(true);
    st().setEntriesUndone([ref(turnId, 2)], true, base);
    expect(st().tempLayerVisibility[-5]).toBeUndefined();
    st().reset();
    expect(st().userMoved).toEqual({});
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1)] }, base);
    st().markUserMoved([-1]);
    st().applyTurn({ prompt: "q", ops: [setTitleOp(42, "z")] }, base);
    expect(st().userMoved[-1]).toBe(true);
    st().setCursor(-1, base);
    st().applyTurn({ prompt: "r", ops: [setTitleOp(42, "y")] }, base);
    expect(st().userMoved).toEqual({});
    st().applyTurn({ prompt: "s", ops: [addWidgetOp(-7)] }, base);
    st().markUserMoved([-7]);
    st().completeKeep();
    expect(st().userMoved).toEqual({});
  });

  it("UNDOSTORE-6: Keep archives only applied labels and the undone ones separately", () => {
    const { turnId } = threeAdds();
    st().setEntriesUndone([ref(turnId, 1)], true, base);
    st().completeKeep();
    const t = st().savedTurns.find((x) => x.kind === "turn") as { chat: { applied: string[]; undoneLabels?: string[] } };
    expect(t.chat.applied).toEqual(['Added records "A"', 'Added records "C"']);
    expect(t.chat.undoneLabels).toEqual(['Added records "B"']);
  });

  it("UNDOSTORE-7: the 50-turn squash carries the flag and a base entry can be redone", () => {
    const first = st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1)] }, base).turnId;
    st().setEntriesUndone([ref(first, 0)], true, base);
    for (let i = 0; i < SESSION_TURN_CAP; i++) st().applyTurn({ prompt: `t${i}`, ops: [setTitleOp(42, `n${i}`)] }, base);
    expect(st().baseEntries[0].undone).toBe(true);
    expect(ids()).toEqual([]);
    st().setEntriesUndone([ref(BASE_TURN_ID, 0)], false, base);
    expect(ids()).toEqual([-1]);
  });

  it("UNDOSTORE-8: Keep payload carries only the remaining adds", () => {
    const { turnId } = threeAdds();
    st().setEntriesUndone([ref(turnId, 1)], true, base);
    const r = { x: 0, y: 0, w: 4, h: 4 };
    const payload = buildKeepPayload({
      baselineVersion: 7, derived: st().derived, savedWidgets: base.widgets, savedLayers: base.layers, tempLayerVisibility: {},
      rects: { [-1]: r, [-2]: r, [-3]: r }, overlay: { tables: (base.tables ?? []) as unknown as TableDto[], maxBarGroupBySeriesCap: 12 },
    });
    expect(payload.widgets.add.map((w) => w.tempId)).toEqual([-1, -3]);
  });

  it("UNDOSTORE-9: setEntriesUndone never touches the filter sink", () => {
    const onCursorMove = vi.fn();
    setAiFilterSink({ onCursorMove });
    const { turnId } = st().applyTurn({ prompt: "p", ops: [applyFilterRaw({ kind: "table", id: 5 }, "payment_type", "Credit")] }, base);
    st().setEntriesUndone([ref(turnId, 0)], true, base);
    expect(onCursorMove).not.toHaveBeenCalled();
  });
});
