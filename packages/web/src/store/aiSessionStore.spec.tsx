import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useWidgetActionStore } from "./widgetActionStore";
import fs from "node:fs";
import path from "node:path";
import * as client from "../api/client";
import { useAiSessionStore, hasUnsavedAiChanges } from "./aiSessionStore";
import { EMPTY_DERIVED, SESSION_TURN_CAP } from "../lib/aiSession/constants";
import {
  baselineFixture, addWidgetOp, removeWidgetOp, patchWidgetOp, addLayerOp, runTurns, patchLayerOp,
} from "../test/aiSessionHarness";

vi.mock("../api/client", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual)) out[k] = typeof v === "function" ? vi.fn() : v;
  return out;
});

const st = () => useAiSessionStore.getState();
const baseline = baselineFixture();

describe("aiSessionStore", () => {
  let lsSpy: ReturnType<typeof vi.spyOn>;
  let ssSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    lsSpy = vi.spyOn(Storage.prototype, "setItem");
    ssSpy = lsSpy;
  });
  afterEach(() => vi.restoreAllMocks());

  it("AISTORE-1: a turn applies in one store update", () => {
    let n = 0;
    const unsub = useAiSessionStore.subscribe(() => n++);
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1), patchWidgetOp(42, { show_popup: true })] }, baseline);
    unsub();
    expect(n).toBe(1);
    expect(st().turns).toHaveLength(1);
    expect(st().cursor).toBe(0);
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-1]);
  });

  it("AISTORE-2: no api/client calls and no storage writes", () => {
    runTurns(baseline, [[addWidgetOp(-1)], [removeWidgetOp(50)], [addWidgetOp(-2)]]);
    st().setCursor(0, baseline);
    st().reset();
    for (const [k, v] of Object.entries(client)) {
      if (vi.isMockFunction(v)) expect(v, k).not.toHaveBeenCalled();
    }
    expect(lsSpy).not.toHaveBeenCalled();
    expect(ssSpy).not.toHaveBeenCalled();
  });

  it("AISTORE-3: revert and forward", () => {
    runTurns(baseline, [[addWidgetOp(-1)], [removeWidgetOp(50)], [addWidgetOp(-2)]]);
    st().setCursor(0, baseline);
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-1]);
    expect(st().derived.removedWidgetIds.size).toBe(0);
    expect(st().turns).toHaveLength(3);
    st().setCursor(2, baseline);
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-1, -2]);
    expect(st().derived.removedWidgetIds.has(50)).toBe(true);
    st().setCursor(-1, baseline);
    expect(st().derived).toBe(EMPTY_DERIVED);
  });

  it("AISTORE-4: new turn while reverted drops later turns and prunes geometry", () => {
    runTurns(baseline, [[addWidgetOp(-1)], [removeWidgetOp(50)], [addWidgetOp(-2)]]);
    st().setGeometry(-1, { x: 0, y: 0, w: 1, h: 1 });
    st().setGeometry(-2, { x: 1, y: 1, w: 1, h: 1 });
    st().setCursor(0, baseline);
    st().applyTurn({ prompt: "t4", ops: [addWidgetOp(-5)] }, baseline);
    expect(st().turns.map((t) => t.prompt)).toEqual(["turn 1", "t4"]);
    expect(Object.keys(st().geometry)).toEqual(["-1"]);
  });

  it("AISTORE-5: cap squashes oldest turn into baseEntries", () => {
    runTurns(baseline, Array.from({ length: SESSION_TURN_CAP + 1 }, (_, i) => [addWidgetOp(-(i + 1))]));
    expect(st().turns).toHaveLength(SESSION_TURN_CAP);
    expect(st().droppedCount).toBe(1);
    expect(st().baseEntries).toHaveLength(1);
    st().setCursor(-1, baseline);
    expect(st().derived.addedWidgets.map((w) => w.id)).toEqual([-1]);
    st().setCursor(SESSION_TURN_CAP - 1, baseline);
    expect(st().derived.addedWidgets).toHaveLength(SESSION_TURN_CAP + 1);
  });

  it("AISTORE-6: hasUnsaved ignores op-less turns, survives cursor -1, cleared by reset", () => {
    st().applyTurn({ prompt: "p", ops: [removeWidgetOp(999)] }, baseline);
    expect(hasUnsavedAiChanges()).toBe(false);
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1)] }, baseline);
    expect(hasUnsavedAiChanges()).toBe(true);
    st().setCursor(-1, baseline);
    expect(hasUnsavedAiChanges()).toBe(true);
    st().reset();
    expect(hasUnsavedAiChanges()).toBe(false);
  });

  it("AISTORE-7: a different dashboard resets history first", () => {
    runTurns(baseline, [[addWidgetOp(-1)], [addWidgetOp(-2)]]);
    st().applyTurn({ prompt: "other", ops: [addWidgetOp(-3)] }, baselineFixture({ dashboardId: 2 }));
    expect(st().turns.map((t) => t.prompt)).toEqual(["other"]);
    expect(st().dashboardId).toBe(2);
  });

  it("AISTORE-8: temp ids are monotonic and skip explicitly used ids", () => {
    expect(st().allocateTempId()).toBe(-1);
    expect(st().allocateTempId()).toBe(-2);
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-10), addLayerOp(-11, 42)] }, baseline);
    expect(st().allocateTempId()).toBeLessThanOrEqual(-12);
  });

  it("AISTORE-9: reload clears by construction (no persistence in source)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiSessionStore.ts"), "utf8");
    expect(src).not.toMatch(/persist\(/);
    expect(src).not.toMatch(/localStorage|sessionStorage/);
    runTurns(baseline, [[addWidgetOp(-1)]]);
    expect(lsSpy).not.toHaveBeenCalled();
  });
});

describe("two-store rebuild (AISES-V20-02, D-11)", () => {
  const wa = () => useWidgetActionStore.getState();
  const t1 = () => [patchWidgetOp(42, { show_popup: true }), patchLayerOp(7, { opacity: 0.4 })];
  const t2 = () => [patchWidgetOp(42, { show_scale_bar: true }), patchLayerOp(7, { colormap: "plasma" })];

  it("AISTORE-HAZARD: raw per-source writes replace wholesale (why the AI source is rebuilt from the log)", () => {
    wa().setControlContribution(0, { widget: { 42: { show_popup: true } }, layer: {}, dynamicView: {} });
    wa().setControlContribution(0, { widget: { 42: { show_scale_bar: true } }, layer: {}, dynamicView: {} });
    expect(wa().widgetOverrides[42].show_popup).toBeUndefined();
  });

  it("AISTORE-T2KEEPS-T1: turn 2 keeps turn 1 in the overlay store", () => {
    runTurns(baseline, [t1(), t2()]);
    expect(wa().widgetOverrides[42]).toMatchObject({ show_popup: true, show_scale_bar: true });
    const cfg = (wa().layerOverrides[7] as { config?: Record<string, unknown> }).config;
    expect(cfg).toMatchObject({ opacity: 0.4, colormap: "plasma" });
  });

  it("AISTORE-REVERT-OVERLAY: revert rebuilds overlays from the prefix", () => {
    runTurns(baseline, [t1(), t2()]);
    st().setCursor(0, baseline);
    expect(wa().widgetOverrides[42]).toEqual({ show_popup: true });
    st().setCursor(-1, baseline);
    expect(Object.keys(wa().contributions)).not.toContain("0");
    expect(wa().widgetOverrides[42]).toBeUndefined();
  });

  it("AISTORE-D11-RADIO: AI rebuilds count as most recent (revert and forward too)", () => {
    wa().setControlContribution(7, { widget: { 42: { show_popup: false } }, layer: {}, dynamicView: {} });
    runTurns(baseline, [[patchWidgetOp(42, { show_popup: true })]]);
    expect(wa().widgetOverrides[42].show_popup).toBe(true);
    st().setCursor(-1, baseline);
    expect(wa().widgetOverrides[42].show_popup).toBe(false);
    st().setCursor(0, baseline);
    expect(wa().widgetOverrides[42].show_popup).toBe(true);
  });

  it("AISTORE-RESET-OVERLAY: reset keeps radio contributions, drops AI", () => {
    wa().setControlContribution(7, { widget: { 42: { show_popup: false } }, layer: {}, dynamicView: {} });
    runTurns(baseline, [[patchWidgetOp(42, { show_scale_bar: true })]]);
    st().reset();
    expect(Object.keys(wa().contributions)).toEqual(["7"]);
    expect(wa().widgetOverrides[42]).toEqual({ show_popup: false });
  });

  it("AISTORE-BATCH: no render shows new derived with old overlays", async () => {
    const seen: Array<[number, number]> = [];
    function Probe() {
      const d = useAiSessionStore((s) => s.derived);
      const o = useWidgetActionStore((s) => s.widgetOverrides);
      seen.push([d.appliedOpCount, Object.keys(o).length]);
      return null;
    }
    render(<Probe />);
    runTurns(baseline, [[patchWidgetOp(42, { show_popup: true })]]);
    await act(async () => {});
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContainEqual([1, 0]);
  });
});
