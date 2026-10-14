import { describe, it, expect, beforeEach } from "vitest";
import { useAiSessionStore, selectHasUnsavedAiChanges, selectShowsAiEditedPill } from "./aiSessionStore";
import { baselineFixture, mapWidget, savedLayer, patchLayerOp, setTitleOp } from "../test/aiSessionHarness";

const st = () => useAiSessionStore.getState();
const baseline = baselineFixture();

describe("aiSessionStore chat/run slices (137-07)", () => {
  beforeEach(() => st().reset());

  it("STC-1: chat is stored on the turn; an op-less turn does not lock", () => {
    st().applyTurn({ prompt: "q", answer: "a", ops: [], chat: { status: "ok", followUps: ["f"] } }, baseline);
    expect(st().turns[0].chat).toEqual({ status: "ok", followUps: ["f"] });
    expect(selectHasUnsavedAiChanges(st())).toBe(false);
  });

  it("STC-2: startRun / updateRun / endRun", () => {
    st().startRun("q");
    expect(st().run).toMatchObject({ status: "running", question: "q", line: "Thinking…" });
    expect(typeof st().run.startedAt).toBe("number");
    st().updateRun("Adding a chart…", 7);
    expect(st().run).toMatchObject({ line: "Adding a chart…", waitSeconds: 7 });
    st().endRun();
    expect(st().run.status).toBe("idle");
  });

  it("STC-3: reset bumps epoch and clears run/draft/highlight/turns", () => {
    const e0 = st().epoch;
    st().startRun("q");
    st().setDraft("x");
    st().setHighlight([3]);
    st().applyTurn({ prompt: "p", ops: [], chat: { status: "ok" } }, baseline);
    st().reset();
    expect(st().epoch).toBe(e0 + 1);
    expect(st().run.status).toBe("idle");
    expect(st().draft).toBe("");
    expect(st().highlight).toEqual({ ids: [], nonce: 0 });
    expect(st().turns).toEqual([]);
    expect(st().removalApproved).toBe(false);
  });

  it("STC-4: setHighlight bumps nonce each call", () => {
    st().setHighlight([3, -1]);
    const n1 = st().highlight.nonce;
    st().setHighlight([3, -1]);
    expect(st().highlight.ids).toEqual([3, -1]);
    expect(st().highlight.nonce).toBe(n1 + 1);
  });

  it("STC-5: markChoicePicked sets pickedChoice; out of range is a no-op", () => {
    st().applyTurn({ prompt: "p", ops: [], chat: { status: "ok" } }, baseline);
    st().markChoicePicked(0, { clarificationIndex: 0, optionId: "yes" });
    expect(st().turns[0].chat?.pickedChoice).toEqual({ clarificationIndex: 0, optionId: "yes" });
    const before = st().turns;
    st().markChoicePicked(5, { clarificationIndex: 0, optionId: "yes" });
    expect(st().turns).toBe(before);
  });

  it("HOST7-6: selectShowsAiEditedPill covers layer-host maps and direct edits", () => {
    const b = baselineFixture({
      widgets: [mapWidget(117, { includedLayerIds: [23] }), mapWidget(118, { includedLayerIds: [99] })],
      layers: [savedLayer(23, { config: { renderMode: "heatmap" } }), savedLayer(99, { config: { renderMode: "heatmap" } })],
    });
    st().applyTurn({ prompt: "p", ops: [patchLayerOp(23, { colormap: "magma" })] }, b);
    expect(selectShowsAiEditedPill(st(), 117)).toBe(true);
    expect(selectShowsAiEditedPill(st(), 118)).toBe(false);
    st().applyTurn({ prompt: "p2", ops: [setTitleOp(118, "New")] }, b);
    expect(selectShowsAiEditedPill(st(), 118)).toBe(true);
    st().setCursor(-1, b);
    expect(selectShowsAiEditedPill(st(), 117)).toBe(false);
    expect(selectShowsAiEditedPill(st(), 118)).toBe(false);
  });
});
