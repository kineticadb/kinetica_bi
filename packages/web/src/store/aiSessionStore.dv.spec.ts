import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useAiSessionStore, setAiDvSink } from "./aiSessionStore";
import { AI_FOLLOWUP_MAX, AI_FOLLOWUP_MAX_CHARS } from "@kinetica-bi/shared";
import { baselineFixture, addWidgetOp } from "../test/aiSessionHarness";

const st = () => useAiSessionStore.getState();

beforeEach(() => {
  setAiDvSink(null);
  st().reset();
});

describe("aiSessionStore dv seam (139)", () => {
  it("STOREDV-1: nonce is 8 hex and regenerates on reset, clearing gen and columns", () => {
    const first = st().dvNonce;
    expect(first).toMatch(/^[a-f0-9]{8}$/);
    st().bumpDvGen(-3);
    st().setDvColumns(-3, [{ name: "trips", type: "long" }]);
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(((b: Uint8Array) => {
      b.set([0xde, 0xad, 0xbe, 0xef]);
      return b;
    }) as typeof crypto.getRandomValues);
    st().reset();
    expect(st().dvNonce).toBe("deadbeef");
    expect(st().dvNonce).not.toBe(first);
    expect(st().dvGen).toEqual({});
    expect(st().dvColumns).toEqual({});
    spy.mockRestore();
  });

  it("STOREDV-2: bumpDvGen increments and caps at 999", () => {
    st().bumpDvGen(-3);
    st().bumpDvGen(-3);
    expect(st().dvGen[-3]).toBe(2);
    for (let i = 0; i < 1100; i++) st().bumpDvGen(-3);
    expect(st().dvGen[-3]).toBe(999);
  });

  it("STOREDV-3: setDvColumns stores negative ids only", () => {
    st().setDvColumns(-3, [{ name: "trips", type: "long" }]);
    st().setDvColumns(7, [{ name: "x", type: "long" }]);
    expect(st().dvColumns[-3]).toEqual([{ name: "trips", type: "long" }]);
    expect(st().dvColumns[7]).toBeUndefined();
  });

  it("STOREDV-4: sink fires after applyTurn and cursor move; onReset fires before the clear", () => {
    const onDerived = vi.fn();
    const seen: { nonce: string }[] = [];
    const onReset = vi.fn(() => seen.push({ nonce: st().dvNonce }));
    setAiDvSink({ onDerived, onReset });
    const b = baselineFixture();
    st().applyTurn({ prompt: "x", ops: [addWidgetOp(-1)] }, b);
    expect(onDerived).toHaveBeenCalledTimes(1);
    expect(onDerived.mock.calls[0][0]).toBe(st().derived);
    st().setCursor(-1, b);
    expect(onDerived).toHaveBeenCalledTimes(2);
    expect(onDerived.mock.calls[1][0]).toBe(st().derived);
    st().setCursor(-1, b); // unchanged cursor: no call
    expect(onDerived).toHaveBeenCalledTimes(2);
    const old = st().dvNonce;
    st().reset();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(seen[0].nonce).toBe(old);
    expect(st().dvNonce).not.toBe(old);
  });

  it("STOREDV-5: null sink -> no calls; re-register replaces", () => {
    const a = { onDerived: vi.fn(), onReset: vi.fn() };
    const c = { onDerived: vi.fn(), onReset: vi.fn() };
    setAiDvSink(a);
    setAiDvSink(null);
    st().reset();
    expect(a.onReset).not.toHaveBeenCalled();
    setAiDvSink(a);
    setAiDvSink(c);
    st().reset();
    expect(a.onReset).not.toHaveBeenCalled();
    expect(c.onReset).toHaveBeenCalledTimes(1);
  });

  it("STOREDV-6: appendFollowUps dedupes, caps count and length; unknown turn is a no-op", () => {
    const { turnId } = st().applyTurn({ prompt: "x", ops: [] }, baselineFixture());
    st().appendFollowUps(turnId, ["Filter trips to the last 30 days"]);
    st().appendFollowUps(turnId, ["Filter trips to the last 30 days", "b", "c", "d"]);
    const f = st().turns[0].chat?.followUps ?? [];
    expect(f).toEqual(["Filter trips to the last 30 days", "b", "c"]);
    expect(f.length).toBeLessThanOrEqual(AI_FOLLOWUP_MAX);
    st().appendFollowUps(turnId, []);
    const long = st().applyTurn({ prompt: "y", ops: [] }, baselineFixture());
    st().appendFollowUps(long.turnId, ["z".repeat(500)]);
    expect(st().turns[1].chat?.followUps?.[0].length).toBe(AI_FOLLOWUP_MAX_CHARS);
    const before = st().turns;
    st().appendFollowUps("nope", ["q"]);
    expect(st().turns).toBe(before);
  });

  it("STOREDV-7: store has no runtime api/client import", () => {
    const src = readFileSync(new URL("./aiSessionStore.ts", import.meta.url), "utf8");
    const bad = src.split("\n").filter((l) => /from "\.\.\/api\/client"/.test(l) && !/^import type/.test(l.trim()));
    expect(bad).toEqual([]);
  });
});
