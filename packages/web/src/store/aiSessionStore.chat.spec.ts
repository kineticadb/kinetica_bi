import { describe, it, expect, beforeEach } from "vitest";
import { useAiSessionStore, selectHasUnsavedAiChanges } from "./aiSessionStore";
import { baselineFixture } from "../test/aiSessionHarness";

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
});
