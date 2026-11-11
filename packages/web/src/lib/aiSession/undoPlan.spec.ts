import { describe, it, expect } from "vitest";
import { evaluateTurn } from "./foldSession";
import { BASE_TURN_ID } from "./constants";
import {
  flattenLive, planUndo, planRedo, revalidateRedo, changeLines, splitAppliedLabels, refKey,
} from "./undoPlan";
import { baselineFixture, addWidgetOp, setLayoutOp, removeWidgetOp, setTitleOp, addLayerOp, mapWidget, recordsWidget } from "../../test/aiSessionHarness";
import type { SessionBaseline, Turn, TurnEntry } from "./types";
import type { WidgetDto } from "../../api/client";

const barWidget = (id: number): WidgetDto => ({
  id, dashboard_id: 1, title: `bar ${id}`, type: "bar", position: 0, config: {}, created_at: "", updated_at: "",
});
const spec = { baseTableId: 5, groupBy: [{ column: "payment_type" }], aggregates: [{ fn: "count", as: "trips" }] };
const stamped = [{ name: "payment_type", type: "string" }, { name: "trips", type: "long" }];
const addDv = (tempId = -3) => ({
  op: "add_dynamic_view", tempId, name: "Trips by type", spec, columns: stamped, maxRecords: 1000, aggregated: true,
});
const addBoundWidget = (tempId: number, dv: number) => ({
  op: "add_widget", tempId, type: "bar", title: "dv bar",
  config: { dynamicViewId: dv, metric: "trips", aggregation: "sum", groupByColumn: "payment_type" },
});
const baseline = (): SessionBaseline => {
  const b = baselineFixture({ widgets: [barWidget(42), recordsWidget(50)], layers: [], dynamicViewIds: [90] });
  return { ...b, dynamicViewSources: { 90: 5 }, dynamicViewColumns: { 90: [{ name: "trips", type: "long" }] }, dynamicViewNames: { 90: "Saved view" } };
};

/** Build turns the way the store does: each turn is evaluated over the earlier turns' entries. */
function build(b: SessionBaseline, lists: unknown[][], opts: { removalApproved?: boolean } = {}): Turn[] {
  const turns: Turn[] = [];
  let prior: TurnEntry[] = [];
  lists.forEach((ops, i) => {
    const entries = evaluateTurn(b, prior, ops, opts);
    turns.push({ id: `t${i}`, prompt: `q${i}`, answer: "", entries, createdAt: i });
    prior = [...prior, ...entries];
  });
  return turns;
}
const mark = (turns: Turn[], refs: { turnId: string; entryIndex: number }[]): Turn[] =>
  turns.map((t) => ({
    ...t,
    entries: t.entries.map((e, i) => (refs.some((r) => r.turnId === t.id && r.entryIndex === i) ? { ...e, undone: true as const } : e)),
  }));
const mkTurn = (id: string, entries: TurnEntry[], applied?: string[]): Turn => ({
  id, prompt: "q", answer: "", entries, createdAt: 0, ...(applied ? { chat: { status: "ok" as const, applied } } : {}),
});
const ref = (turnId: string, entryIndex: number) => ({ turnId, entryIndex });

describe("undo planner (151)", () => {
  it("UNDOPLAN-1: changeLines aligns labels with entries only when lengths match", () => {
    const b = baseline();
    const es = evaluateTurn(b, [], [addWidgetOp(-1), setTitleOp(999, "x"), addWidgetOp(-2)]);
    expect(es[1].result.status).toBe("skipped");
    const withUndone = [es[0], es[1], { ...es[2], undone: true as const }];
    const lines = changeLines(mkTurn("t", withUndone, ["a", "b", "c"]));
    expect(lines.map((l) => l.entryIndex)).toEqual([0, 1, 2]);
    expect(lines.map((l) => l.undoable)).toEqual([true, false, true]);
    expect(lines.map((l) => l.undone)).toEqual([false, false, true]);
    const mis = changeLines(mkTurn("t", [es[0]], ["1", "2", "3", "4", "5", "6", "7", "8"]));
    expect(mis).toHaveLength(8);
    expect(mis.every((l) => l.entryIndex === null && !l.undoable)).toBe(true);
  });

  it("UNDOPLAN-2: undoing one of three independent adds touches only it", () => {
    const b = baseline();
    const turns = build(b, [[addWidgetOp(-1), addWidgetOp(-2), addWidgetOp(-3)]]);
    const plan = planUndo(b, { baseEntries: [], turns }, ref("t0", 1));
    expect(plan).toEqual({ refs: [ref("t0", 1)], dependents: [], removedTempIds: [-2], handEdited: false });
  });

  it("UNDOPLAN-3: a later answer's chart on the view is a dependent, named by turn", () => {
    const b = baseline();
    const turns = build(b, [[addDv(-3)], [addBoundWidget(-4, -3)]]);
    expect(turns[1].entries[0].result.status).toBe("applied");
    const plan = planUndo(b, { baseEntries: [], turns }, ref("t0", 0))!;
    expect(plan.refs).toEqual([ref("t0", 0), ref("t1", 0)]);
    expect(plan.dependents).toEqual([{ ref: ref("t1", 0), turnIndex: 1 }]);
  });

  it("UNDOPLAN-4: turns ahead of the cursor are covered (planUndo ignores the cursor)", () => {
    const b = baseline();
    const turns = build(b, [[addDv(-3)], [addBoundWidget(-4, -3)]]);
    const plan = planUndo(b, { baseEntries: [], turns, cursor: 0 } as never, ref("t0", 0))!;
    expect(plan.refs).toContainEqual(ref("t1", 0));
  });

  it("UNDOPLAN-5: a change that would stop validating without the target is pulled in", () => {
    const b0 = baselineFixture({
      widgets: [mapWidget(42, { layout: { x: 12, y: 0, w: 12, h: 20 } }), recordsWidget(50, { layout: { x: 0, y: 0, w: 12, h: 20 } })],
      layers: [], dynamicViewIds: [],
    });
    const turns = build(b0, [[removeWidgetOp(50)], [setLayoutOp([{ id: 42, x: 0, y: 0, w: 12, h: 20 }])]], { removalApproved: true });
    expect(turns[0].entries[0].result.status).toBe("applied");
    expect(turns[1].entries[0].result.status).toBe("applied");
    const plan = planUndo(b0, { baseEntries: [], turns }, ref("t0", 0))!;
    expect(plan.refs).toEqual([ref("t0", 0), ref("t1", 0)]);
  });

  it("UNDOPLAN-6: planRedo pulls in undone prerequisites only", () => {
    const b = baseline();
    const turns = mark(build(b, [[addDv(-3)], [addBoundWidget(-4, -3)]]), [ref("t0", 0), ref("t1", 0)]);
    const s = { baseEntries: [], turns };
    expect(planRedo(s, ref("t1", 0))!.refs).toEqual([ref("t0", 0), ref("t1", 0)]);
    expect(planRedo(s, ref("t0", 0))!.refs).toEqual([ref("t0", 0)]);
    expect(planRedo(s, ref("nope", 0))).toBeNull();
  });

  it("UNDOPLAN-7: revalidateRedo refuses when the restored session would skip something", () => {
    const b = baseline();
    const a = build(b, [[addWidgetOp(-1)]]);
    const aUndone = mark(a, [ref("t0", 0)]);
    const entriesB = evaluateTurn(b, aUndone.flatMap((t) => t.entries), [addWidgetOp(-1)]);
    expect(entriesB[0].result.status).toBe("applied");
    const turns: Turn[] = [...aUndone, { id: "t1", prompt: "", answer: "", entries: entriesB, createdAt: 1 }];
    const r = revalidateRedo(b, { baseEntries: [], turns }, [ref("t0", 0)]);
    expect(r).toMatchObject({ ok: false, ref: ref("t1", 0), result: { status: "skipped", reason: "duplicate_temp_id" } });
    const clean = mark(build(b, [[addWidgetOp(-1)], [addWidgetOp(-2)]]), [ref("t0", 0)]);
    expect(revalidateRedo(b, { baseEntries: [], turns: clean }, [ref("t0", 0)])).toEqual({ ok: true });
  });

  it("UNDOPLAN-8: handEdited reflects moved/resized items and layer visibility toggles", () => {
    const b = baseline();
    const turns = build(b, [[addWidgetOp(-1)]]);
    expect(planUndo(b, { baseEntries: [], turns, userMoved: { [-1]: true } }, ref("t0", 0))!.handEdited).toBe(true);
    expect(planUndo(b, { baseEntries: [], turns, userMoved: { [-9]: true } }, ref("t0", 0))!.handEdited).toBe(false);
    const withLayer = build(b, [[addWidgetOp(-1, "map"), addLayerOp(-5, -1)]]);
    expect(planUndo(b, { baseEntries: [], turns: withLayer, tempLayerVisibility: { [-5]: false } }, ref("t0", 1))!.handEdited).toBe(true);
    expect(planUndo(b, { baseEntries: [], turns: withLayer, tempLayerVisibility: { [-7]: false } }, ref("t0", 1))!.handEdited).toBe(false);
  });

  it("UNDOPLAN-9: null for skipped, already-undone and unknown refs; base entries use BASE_TURN_ID", () => {
    const b = baseline();
    const turns = build(b, [[addWidgetOp(-1), setTitleOp(999, "x")]]);
    const s = { baseEntries: [], turns };
    expect(planUndo(b, s, ref("t0", 1))).toBeNull();
    expect(planUndo(b, s, ref("nope", 0))).toBeNull();
    expect(planUndo(b, { baseEntries: [], turns: mark(turns, [ref("t0", 0)]) }, ref("t0", 0))).toBeNull();
    const base = evaluateTurn(b, [], [addWidgetOp(-1)]);
    const flat = flattenLive({ baseEntries: base, turns: [] });
    expect(flat.map((f) => refKey(f.ref))).toEqual([`${BASE_TURN_ID}#0`]);
    expect(planUndo(b, { baseEntries: base, turns: [] }, ref(BASE_TURN_ID, 0))!.refs).toEqual([ref(BASE_TURN_ID, 0)]);
  });

  it("UNDOPLAN-10: splitAppliedLabels partitions aligned labels; misaligned falls back to names", () => {
    const b = baseline();
    const es = evaluateTurn(b, [], [addWidgetOp(-1), addWidgetOp(-2), addWidgetOp(-3)]);
    const marked = [es[0], { ...es[1], undone: true as const }, es[2]];
    expect(splitAppliedLabels(mkTurn("t", marked, ["l0", "l1", "l2"]))).toEqual({ applied: ["l0", "l2"], undone: ["l1"] });
    const mis = splitAppliedLabels(mkTurn("t", marked, ["only", "two"]));
    expect(mis.applied).toEqual(["only", "two"]);
    expect(mis.undone).toHaveLength(1);
    expect(mis.undone[0].length).toBeGreaterThan(0);
  });
});
