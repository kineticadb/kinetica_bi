// 138-06 Task 2: D-17 zero-row check over the combination view. runSql is ALWAYS injected: no Kinetica call.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import { useFilterCombinationStore } from "../../store/filterCombinationStore";
import { useAiSessionStore } from "../../store/aiSessionStore";
import { stableComboHash } from "../stableComboHash";
import { baselineFixture } from "../../test/aiSessionHarness";
import { checkZeroRowFilters, readFirstCount, type ZeroRowCheckInput } from "./aiFilterZeroRows";

const T5 = { kind: "table" as const, id: 5 };
const fs = () => useFilterStore.getState();
const ss = () => useAiSessionStore.getState();
const entry = (viewName: string, materializing = false) => ({
  viewName, expiresAt: 0, materializing, materializeVersion: 1, refCount: 1, dashboardId: 1, sourceType: "table" as const, sourceId: 5,
});
const VIEW = "ki_home.kbi_combo_ab12";
let turnId = "";
let after: ActiveFilter;
const input = (): ZeroRowCheckInput => ({
  turnId,
  epoch: ss().epoch,
  checks: [{ source: T5, column: "payment_type", after, sourceLabel: "trips" }],
});
const hash = () => stableComboHash("table", 5, fs().filters[5]);
const notes = () => ss().turns.find((t) => t.id === turnId)?.chat?.filterNotes ?? [];
const count = (n: unknown) => vi.fn().mockResolvedValue({ column_headers: ["n"], column_1: [n] });

beforeEach(() => {
  vi.useFakeTimers();
  fs().reset();
  ss().reset();
  useSpatialFilterStore.getState().reset();
  useFilterCombinationStore.getState().reset();
  fs().addFilter(5, { column: "payment_type", value: "Credit", dataType: "string", addedAt: 1, aiApplied: true });
  after = fs().filters[5][0];
  turnId = ss().applyTurn({ prompt: "q", answer: "x", ops: [] }, baselineFixture()).turnId;
});
afterEach(() => vi.useRealTimers());

describe("checkZeroRowFilters", () => {
  it("ZR-1: zero count adds the matched-no-rows note and the clear offer", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    const runSql = count(0);
    await checkZeroRowFilters(input(), { runSql });
    expect(runSql).toHaveBeenCalledTimes(1);
    expect(runSql).toHaveBeenCalledWith(`SELECT COUNT(*) AS n FROM ${VIEW}`);
    expect(notes()).toEqual(["The payment_type filter on trips matched no rows."]);
    expect(ss().turns.find((t) => t.id === turnId)?.chat?.emptyFilters).toEqual([{ source: T5, column: "payment_type" }]);
  });

  it("ZR-2: a non-zero count adds no note", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    const runSql = count(5);
    await checkZeroRowFilters(input(), { runSql });
    expect(runSql).toHaveBeenCalledTimes(1);
    expect(notes()).toEqual([]);
  });

  it("ZR-3: waits for the view to materialize", async () => {
    const runSql = count(0);
    const p = checkZeroRowFilters(input(), { runSql });
    await vi.advanceTimersByTimeAsync(2000);
    expect(runSql).not.toHaveBeenCalled();
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    await p;
    expect(runSql).toHaveBeenCalledTimes(1);
    expect(notes()).toHaveLength(1);
  });

  it("ZR-4: never materialized within timeoutMs -> no query, no note", async () => {
    const runSql = count(0);
    const p = checkZeroRowFilters(input(), { runSql, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(runSql).not.toHaveBeenCalled();
    expect(notes()).toEqual([]);
  });

  it("ZR-5: session reset before the count resolves -> no note", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    let release: (v: unknown) => void = () => {};
    const runSql = vi.fn().mockReturnValue(new Promise((r) => (release = r)));
    const append = vi.spyOn(ss(), "appendFilterNotes");
    const p = checkZeroRowFilters(input(), { runSql });
    await vi.advanceTimersByTimeAsync(0);
    expect(runSql).toHaveBeenCalledTimes(1);
    ss().reset();
    release({ column_headers: ["n"], column_1: [0] });
    await p;
    expect(append).not.toHaveBeenCalled();
  });

  it("ZR-6: user replaced the column's filter before the count -> no note", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    let release: (v: unknown) => void = () => {};
    const runSql = vi.fn().mockReturnValue(new Promise((r) => (release = r)));
    const p = checkZeroRowFilters(input(), { runSql });
    await vi.advanceTimersByTimeAsync(0);
    fs().addFilter(5, { column: "payment_type", value: "Cash", dataType: "string", addedAt: 2 });
    release({ column_headers: ["n"], column_1: [0] });
    await p;
    expect(notes()).toEqual([]);
  });

  it("ZR-7: a drawn shape folds into the table hash -> check skipped", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km" });
    const runSql = count(0);
    await checkZeroRowFilters(input(), { runSql });
    expect(runSql).not.toHaveBeenCalled();
    expect(notes()).toEqual([]);
  });

  it("ZR-8: an unsafe view name is never interpolated", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry("x; drop table y"));
    const runSql = count(0);
    await checkZeroRowFilters(input(), { runSql });
    expect(runSql).not.toHaveBeenCalled();
    expect(notes()).toEqual([]);
  });

  it("ZR-9: readFirstCount shapes; rejection is swallowed", async () => {
    expect(readFirstCount({ column_headers: ["n"], column_1: ["0"] })).toBe(0);
    expect(readFirstCount({ column_headers: ["n"], column_1: [7] })).toBe(7);
    expect(readFirstCount({ data_str: [{ json_encoded_response: JSON.stringify({ column_headers: ["n"], column_1: [3] }) }] })).toBe(3);
    expect(readFirstCount("garbage")).toBeUndefined();
    expect(readFirstCount({ column_headers: ["n"] })).toBeUndefined();
    expect(readFirstCount(null)).toBeUndefined();
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    const runSql = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(checkZeroRowFilters(input(), { runSql })).resolves.toBeUndefined();
    expect(notes()).toEqual([]);
  });

  it("ZR-10: the SQL never carries the filter value", async () => {
    useFilterCombinationStore.getState().setEntry(hash(), entry(VIEW));
    const runSql = count(1);
    await checkZeroRowFilters(input(), { runSql });
    expect(runSql.mock.calls[0][0]).not.toContain("Credit");
  });
});
