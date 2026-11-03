import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAiSessionStore, setAiDvSink, setAiFilterSink, selectHasUnsavedAiChanges } from "./aiSessionStore";
import { useWidgetActionStore } from "./widgetActionStore";
import { AI_SOURCE_ID, AI_KEPT_VIEW_TOGGLES_SOURCE_ID, EMPTY_DERIVED } from "../lib/aiSession/constants";
import { AI_CHAT_COPY, keepConfirmBody } from "../lib/aiSession/chatText";
import { baselineFixture, addWidgetOp, setTitleOp, removeWidgetOp } from "../test/aiSessionHarness";

const st = () => useAiSessionStore.getState();
const wa = () => useWidgetActionStore.getState();
const base = baselineFixture();
const dvToggle = (id: number) => ({ op: "patch", action: { target: { kind: "dynamicView", id }, configPatch: { enabled: false } } });

beforeEach(() => {
  setAiDvSink(null);
  setAiFilterSink(null);
  st().reset();
});

function twoTurns() {
  st().applyTurn({ prompt: "p1", answer: "a1", ops: [addWidgetOp(-1)] }, base);
  st().applyTurn({ prompt: "p2", answer: "a2", ops: [setTitleOp(42, "New")] }, base);
}

describe("aiSessionStore completeKeep (141)", () => {
  it("KSTORE-1: archives turns, clears history and the unsaved lock", () => {
    twoTurns();
    expect(selectHasUnsavedAiChanges(st())).toBe(true);
    st().completeKeep();
    expect(selectHasUnsavedAiChanges(st())).toBe(false);
    expect(st().turns).toEqual([]);
    expect(st().cursor).toBe(-1);
    expect(st().savedTurns.map((i) => i.kind)).toEqual(["turn", "turn", "note"]);
    const [a, b, n] = st().savedTurns as any[];
    expect([a.prompt, a.answer, b.prompt, b.answer]).toEqual(["p1", "a1", "p2", "a2"]);
    expect(n.text).toBe("Changes saved.");
    expect(st().derived).toBe(EMPTY_DERIVED);
  });

  it("KSTORE-2: only turns up to the cursor are archived", () => {
    twoTurns();
    st().setCursor(0, base);
    st().completeKeep();
    expect(st().savedTurns.filter((i) => i.kind === "turn")).toHaveLength(1);
  });

  it("KSTORE-3: warnings become extra notes", () => {
    twoTurns();
    st().completeKeep({ warnings: ["1 radio action still points at a removed widget"] });
    const notes = st().savedTurns.filter((i) => i.kind === "note") as { text: string }[];
    expect(notes.map((x) => x.text)).toEqual(["Changes saved.", "1 radio action still points at a removed widget"]);
  });

  it("KSTORE-4: clears approval, highlight, geometry, visibility, overlay; keeps nextTempId", () => {
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1), removeWidgetOp(50)] }, base);
    const id = st().allocateTempId();
    st().approveRemoval();
    st().setHighlight([42]);
    st().setGeometry(-1, { x: 0, y: 0, w: 1, h: 1 });
    st().setTempLayerVisible(-2, true);
    st().applyTurn({ prompt: "q", ops: [setTitleOp(42, "x")] }, base);
    const epoch = st().epoch;
    const nonce = st().dvNonce;
    const next = st().nextTempId;
    st().completeKeep();
    expect(st().removalApproved).toBe(false);
    expect(st().highlight.ids).toEqual([]);
    expect(st().geometry).toEqual({});
    expect(st().tempLayerVisibility).toEqual({});
    expect(wa().contributions[AI_SOURCE_ID]).toBeUndefined();
    expect(st().epoch).toBe(epoch + 1);
    expect(st().dvNonce).not.toBe(nonce);
    expect(st().nextTempId).toBe(next);
    expect(id).toBeLessThan(0);
  });

  it("KSTORE-5: dv sink reset once; filter sink never moved", () => {
    twoTurns();
    const onReset = vi.fn();
    const onCursorMove = vi.fn();
    setAiDvSink({ onDerived: vi.fn(), onReset });
    setAiFilterSink({ onCursorMove });
    st().completeKeep();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onCursorMove).not.toHaveBeenCalled();
  });

  it("KSTORE-6: a second keep cycle appends", () => {
    twoTurns();
    st().completeKeep();
    st().applyTurn({ prompt: "p3", ops: [setTitleOp(42, "Z")] }, base);
    st().completeKeep();
    const k = st().savedTurns.map((i) => i.kind);
    expect(k).toEqual(["turn", "turn", "note", "turn", "note"]);
  });

  it("KSTORE-7: reset clears savedTurns and keepBlocked; completeKeep clears keepBlocked", () => {
    twoTurns();
    st().completeKeep();
    st().setKeepBlocked("conflict");
    expect(st().keepBlocked).toBe("conflict");
    st().reset();
    expect(st().keepBlocked).toBeNull();
    expect(st().savedTurns).toEqual([]);
    twoTurns();
    st().setKeepBlocked("committed");
    st().completeKeep();
    expect(st().keepBlocked).toBeNull();
  });

  it("KSTORE-8: copy", () => {
    expect(AI_CHAT_COPY.keepConfirmTitle).toBe("Save AI changes?");
    expect(keepConfirmBody({ added: 3, edited: 2, removed: 1 })).toBe("3 added · 2 edited · 1 removed. Filters are not saved.");
    expect(AI_CHAT_COPY.keepSaved).toBe("Changes saved.");
    expect(AI_CHAT_COPY.keepEditorsOnly).toBe("Only editors can save AI changes");
    expect(AI_CHAT_COPY.keepSaving).toBe("Saving…");
    expect(AI_CHAT_COPY.conflictReload).toBe("Discard and reload the latest");
    expect(AI_CHAT_COPY.conflictStay).toBe("Stay");
    expect(AI_CHAT_COPY.viewTogglesNotSaved).toBe("View on/off changes are not saved.");
    expect(AI_CHAT_COPY.leaveBodyNeutral).toBe("Leaving will discard the changes the AI made to this dashboard.");
    expect(AI_CHAT_COPY.leaveBody).toBe("Leaving will discard the changes the AI made to this dashboard. Keep them first if you want to save them.");
  });

  it("KSTORE-9: D-20 note text", () => {
    twoTurns();
    st().completeKeep({ viewTogglesNotSaved: true });
    expect((st().savedTurns.at(-1) as { text: string }).text).toBe("Changes saved. View on/off changes are not saved.");
  });

  it("KSTORE-10: D-20 view toggles survive Keep, merge across sessions, cleared by reset", () => {
    const b = baselineFixture({ dynamicViewIds: [9301, 9302] });
    st().applyTurn({ prompt: "t", ops: [dvToggle(9301)] }, b);
    st().completeKeep();
    expect(wa().dynamicViewOverrides[9301]?.enabled).toBe(false);
    expect(wa().contributions[AI_KEPT_VIEW_TOGGLES_SOURCE_ID]).toBeDefined();
    expect(wa().contributions[AI_SOURCE_ID]).toBeUndefined();
    st().applyTurn({ prompt: "t2", ops: [dvToggle(9302)] }, b);
    st().completeKeep();
    expect(wa().dynamicViewOverrides[9301]?.enabled).toBe(false);
    expect(wa().dynamicViewOverrides[9302]?.enabled).toBe(false);
    st().reset();
    expect(wa().dynamicViewOverrides[9301]).toBeUndefined();
    expect(wa().contributions[AI_KEPT_VIEW_TOGGLES_SOURCE_ID]).toBeUndefined();
    twoTurns();
    st().completeKeep();
    expect(wa().contributions[AI_KEPT_VIEW_TOGGLES_SOURCE_ID]).toBeUndefined();
  });
});
