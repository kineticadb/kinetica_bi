import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAiSessionStore } from "../store/aiSessionStore";
import { baselineFixture, addWidgetOp } from "../test/aiSessionHarness";
import { requestLeave } from "./aiLeaveGuard";

beforeEach(() => useAiSessionStore.getState().reset());

describe("aiLeaveGuard", () => {
  it("AIDLG-1: clean session proceeds synchronously, no pendingLeave", () => {
    const fn = vi.fn();
    requestLeave(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(useAiSessionStore.getState().pendingLeave).toBeNull();
  });

  it("AIDLG-2: op-less turn (all skipped) still proceeds immediately", () => {
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [{ op: "remove_widget", id: 99999 }] }, baselineFixture());
    const fn = vi.fn();
    requestLeave(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("AIDLG-3a: applied turn defers proceed into pendingLeave", () => {
    useAiSessionStore.getState().applyTurn({ prompt: "x", ops: [addWidgetOp(-1)] }, baselineFixture());
    const fn = vi.fn();
    requestLeave(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(useAiSessionStore.getState().pendingLeave).not.toBeNull();
  });
});
