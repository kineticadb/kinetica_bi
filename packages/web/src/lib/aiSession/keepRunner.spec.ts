import { describe, it, expect, beforeEach, vi } from "vitest";
import { KEEP_FAILED_MESSAGE } from "@kinetica-bi/shared";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { useFilterStore } from "../../store/filterStore";
import { useDashboardVersionStore } from "../../store/dashboardVersionStore";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import { useWidgetActionStore } from "../../store/widgetActionStore";
import { baselineFixture, addWidgetOp, setTitleOp, recordsWidget } from "../../test/aiSessionHarness";
import { buildKeepPayload } from "./keepPayload";

const askLog: string[] = [];
vi.mock("./askRunner", () => ({ cancelAsk: () => askLog.push("cancel") }));
import { runKeep, runReloadLatest, rectsFromLayouts, type KeepLists, type KeepRunDeps } from "./keepRunner";

const DASH = 1;
const st = () => useAiSessionStore.getState();
const base = () => baselineFixture({ dynamicViewIds: [9301] });
const lists: KeepLists = { widgets: [], layers: [], tables: [], dynamicViews: [] };
const dvToggle = (id: number) => ({ op: "patch", action: { target: { kind: "dynamicView", id }, configPatch: { enabled: false } } });
const body = { baselineVersion: 5 } as never;
const okResult = (warnings: string[] = ["W"]) => ({
  ok: true as const,
  response: { idMap: { dynamicViews: { "-3": 31 }, widgets: { "-1": 41 }, layers: {} }, version: 6, warnings },
});

function deps(over: Partial<KeepRunDeps> = {}, log: string[] = []): KeepRunDeps {
  return {
    dashboardId: DASH,
    buildPayload: vi.fn(() => body),
    keep: vi.fn(async () => okResult()),
    reloadLists: vi.fn(async () => { log.push("reload"); return lists; }),
    applyLists: vi.fn(() => { log.push("apply"); }),
    ...over,
  };
}

beforeEach(() => {
  askLog.length = 0;
  st().reset();
  useFilterStore.getState().reset();
  useDashboardVersionStore.getState().clear(DASH);
  useInfoSelectionStore.getState().reset();
  useWidgetActionStore.getState().clearControl(Number.MIN_SAFE_INTEGER);
});

const seedSession = () => st().applyTurn({ prompt: "p", answer: "a", ops: [addWidgetOp(-1), setTitleOp(50, "T")] }, base());
const seedBaseline = (v = 5) => useDashboardVersionStore.getState().noteRead(DASH, "widgets", v);

describe("keepRunner", () => {
  it("KRUN-1: no baseline -> error, keep never called", async () => {
    seedSession();
    const d = deps();
    expect(await runKeep(d)).toEqual({ kind: "error", message: KEEP_FAILED_MESSAGE });
    expect(d.keep).not.toHaveBeenCalled();
  });

  it("KRUN-2: success order, version cleared before reload, one synchronous swap block", async () => {
    seedSession();
    seedBaseline(5);
    useFilterStore.setState({ dvFilters: { [-3]: [{ column: "c", value: "x" } as never] } });
    const log: string[] = [];
    const rekey = useFilterStore.getState().rekeyDvFilters;
    useFilterStore.setState({ rekeyDvFilters: (a, b) => { log.push("rekey"); rekey(a, b); } });
    const unsub = useAiSessionStore.subscribe((s, p) => { if (s.savedTurns.length > p.savedTurns.length) log.push("complete"); });
    const d = deps({
      reloadLists: vi.fn(async () => {
        log.push(`reload(baseline=${useDashboardVersionStore.getState().baseline(DASH)})`);
        return lists;
      }),
    }, log);
    d.applyLists = vi.fn(() => { log.push("apply"); });
    const out = await runKeep(d);
    unsub();
    useFilterStore.setState({ rekeyDvFilters: rekey });
    expect(d.buildPayload).toHaveBeenCalledWith(5);
    expect(out).toEqual({ kind: "saved" });
    expect(log).toEqual(["reload(baseline=undefined)", "apply", "rekey", "complete"]);
    expect(useAiSessionStore.getState().turns).toEqual([]);
    const texts = st().savedTurns.filter((i) => i.kind === "note").map((i: any) => i.text);
    expect(texts).toEqual(["Changes saved.", "W"]);
    expect(useFilterStore.getState().dvFilters[31]).toBeDefined();
    expect(useFilterStore.getState().dvFilters[-3]).toBeUndefined();
  });

  it("KRUN-3: temp selection reset, positive kept", async () => {
    seedSession();
    seedBaseline();
    useInfoSelectionStore.setState({ activeLayerId: -2 });
    await runKeep(deps());
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
    seedSession();
    seedBaseline();
    useInfoSelectionStore.setState({ activeLayerId: 77 });
    await runKeep(deps());
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(77);
  });

  it("KRUN-4: conflict leaves the session untouched and does not reload", async () => {
    seedSession();
    seedBaseline();
    const before = { t: st().turns, c: st().cursor, d: st().derived };
    const d = deps({ keep: vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, message: "m" })) });
    expect(await runKeep(d)).toEqual({ kind: "conflict" });
    expect(st().keepBlocked).toBe("conflict");
    expect({ t: st().turns, c: st().cursor, d: st().derived }).toEqual(before);
    expect(d.reloadLists).not.toHaveBeenCalled();
  });

  it.each(["permission", "invalid", "failed"] as const)("KRUN-5: %s -> error with the message, retry allowed", async (kind) => {
    seedSession();
    seedBaseline();
    const turns = st().turns;
    const d = deps({ keep: vi.fn(async () => ({ ok: false as const, kind, message: `msg-${kind}` })) });
    expect(await runKeep(d)).toEqual({ kind: "error", message: `msg-${kind}` });
    expect(st().turns).toBe(turns);
    expect(st().keepBlocked).toBeNull();
    expect(d.keep).toHaveBeenCalledTimes(1);
  });

  it("KRUN-6: refresh failure after commit -> saved_no_refresh, blocked, no completeKeep", async () => {
    seedSession();
    seedBaseline();
    const d = deps({ reloadLists: vi.fn(async () => { throw new Error("net"); }) });
    expect(await runKeep(d)).toEqual({ kind: "saved_no_refresh" });
    expect(st().keepBlocked).toBe("committed");
    expect(st().savedTurns).toEqual([]);
    expect(st().turns.length).toBeGreaterThan(0);
    expect(d.applyLists).not.toHaveBeenCalled();
  });

  it("KRUN-7: buildPayload throws -> D-12 error, keep not called", async () => {
    seedSession();
    seedBaseline();
    const d = deps({ buildPayload: vi.fn(() => { throw new Error("No displayed rect"); }) });
    expect(await runKeep(d)).toEqual({ kind: "error", message: KEEP_FAILED_MESSAGE });
    expect(d.keep).not.toHaveBeenCalled();
  });

  it("KRUN-8: runReloadLatest cancels, discards, clears version, reloads, applies, resets", async () => {
    seedSession();
    seedBaseline();
    st().setKeepBlocked("conflict");
    const log: string[] = [];
    const unsub = useAiSessionStore.subscribe((s, p) => { if (p.turns.length && !s.turns.length) log.push("reset"); });
    const d = deps({}, log);
    useDashboardVersionStore.getState().noteRead(DASH, "layers", 5);
    await runReloadLatest(d);
    unsub();
    expect(askLog).toEqual(["cancel"]);
    expect(log).toEqual(["reset", "reload", "apply"]);
    expect(useDashboardVersionStore.getState().baseline(DASH)).toBeUndefined();
    expect(st().savedTurns).toEqual([]);
    expect(st().keepBlocked).toBeNull();
  });

  it("KRUN-9: keep is called exactly once per runKeep, in every case", async () => {
    for (const r of [
      { ok: false as const, kind: "failed" as const, message: "x" },
      { ok: false as const, kind: "conflict" as const, message: "x" },
      okResult(),
    ]) {
      st().reset();
      seedSession();
      seedBaseline();
      const d = deps({ keep: vi.fn(async () => r as never) });
      await runKeep(d);
      expect(d.keep).toHaveBeenCalledTimes(1);
    }
  });

  it("KRUN-11: D-20 toggles flag the note; no toggles no flag", async () => {
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1), dvToggle(9301)] }, base());
    seedBaseline();
    await runKeep(deps({ keep: vi.fn(async () => okResult([])) }));
    const notes = () => st().savedTurns.filter((i) => i.kind === "note").map((i: any) => i.text);
    expect(notes()).toEqual(["Changes saved. View on/off changes are not saved."]);
    st().reset();
    seedSession();
    seedBaseline();
    await runKeep(deps({ keep: vi.fn(async () => okResult([])) }));
    expect(notes()).toEqual(["Changes saved."]);
  });

  it("KRUN-12: D-20 toggled view stays in this tab after Keep, never in the body; Discard path clears it", async () => {
    st().applyTurn({ prompt: "p", ops: [addWidgetOp(-1), dvToggle(9301)] }, base());
    seedBaseline();
    let sent: unknown;
    const d = deps({
      buildPayload: (v) => buildKeepPayload({
        baselineVersion: v, derived: st().derived, savedWidgets: [recordsWidget(50)], savedLayers: [],
        tempLayerVisibility: {}, rects: { [-1]: { x: 0, y: 0, w: 6, h: 6 } }, overlay: { tables: [], maxBarGroupBySeriesCap: 12 },
      }),
      keep: vi.fn(async (_id, b) => { sent = b; return okResult([]); }),
    });
    expect((await runKeep(d)).kind).toBe("saved");
    expect(JSON.stringify(sent)).not.toContain('"enabled"');
    expect(useWidgetActionStore.getState().dynamicViewOverrides[9301]?.enabled).toBe(false);
    await runReloadLatest(deps());
    expect(useWidgetActionStore.getState().dynamicViewOverrides[9301]).toBeUndefined();
  });

  it("KRUN-10: rectsFromLayouts keys rects by numeric id and drops non-numeric keys", () => {
    expect(
      rectsFromLayouts([
        { i: "12", x: 0, y: 0, w: 6, h: 8 },
        { i: "-1", x: 6, y: 0, w: 6, h: 8 },
        { i: "x", x: 1, y: 1, w: 1, h: 1 },
      ]),
    ).toEqual({ 12: { x: 0, y: 0, w: 6, h: 8 }, [-1]: { x: 6, y: 0, w: 6, h: 8 } });
  });

  it("KRUN-F1: Keep sends the Claude Desktop floor when it is below this tab's reads", async () => {
    seedSession();
    seedBaseline(10);
    st().setKeepBaselineFloor(8);
    const d = deps();
    await runKeep(d);
    expect(d.buildPayload).toHaveBeenCalledWith(8);
  });

  it("KRUN-F2: no floor or a floor at the reads leaves the baseline as today", async () => {
    seedSession();
    seedBaseline(10);
    const d1 = deps();
    await runKeep(d1);
    expect(d1.buildPayload).toHaveBeenCalledWith(10);
    seedSession();
    seedBaseline(10);
    st().setKeepBaselineFloor(10);
    const d2 = deps();
    await runKeep(d2);
    expect(d2.buildPayload).toHaveBeenCalledWith(10);
  });

  it("KRUN-F3: reset() and completeKeep() forget the floor", () => {
    st().setKeepBaselineFloor(8);
    st().reset();
    expect(st().keepBaselineFloor).toBeNull();
    seedSession();
    st().setKeepBaselineFloor(8);
    st().completeKeep();
    expect(st().keepBaselineFloor).toBeNull();
  });
});
