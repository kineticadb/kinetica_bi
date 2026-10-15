// 138-06 Task 1: one apply path for every AI turn (real stores; zero-row check injected).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFilterStore } from "../../store/filterStore";
import { useSpatialFilterStore } from "../../store/spatialFilterStore";
import { useAiSessionStore, selectShowsAiEditedPill, hasUnsavedAiChanges } from "../../store/aiSessionStore";
import { baselineFixture, mapWidget, recordsWidget, savedLayer, applyFilterRaw, clearFilterRaw, addWidgetOp, setTitleOp } from "../../test/aiSessionHarness";
import { computeChangeCounts } from "../aiSession/changeCounts";
import { buildAskTurns } from "../aiSession/buildAskRequest";
import type { WidgetDto } from "../../api/client";
import { applyAiTurn } from "./applyAiTurn";

const T5 = { kind: "table" as const, id: 5 };
const fs = () => useFilterStore.getState();
const ss = () => useAiSessionStore.getState();
const bar = (id: number, config: Record<string, unknown> = {}): WidgetDto => ({
  id, dashboard_id: 1, title: `bar ${id}`, type: "bar", position: 0, config: { tableId: 5, ...config }, created_at: "", updated_at: "",
});
const scoped = (id: number) => bar(id, { filterSelection: { sourceMode: "allowlist", allowedSourceWidgetIds: [60] } });
const mk = (extra: WidgetDto[] = []) =>
  baselineFixture({
    widgets: [mapWidget(42), bar(60), recordsWidget(50, { tableId: 5 }), scoped(61), ...extra],
    layers: [savedLayer(7, { config: { renderMode: "heatmap" } })],
  });
const user = (column: string, value: string) => ({ column, value, dataType: "string" as const, addedAt: 1 });
const credit = [applyFilterRaw(T5, "payment_type", "Credit")];
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const lastTurn = () => ss().turns[ss().turns.length - 1];

let baseline = mk();
beforeEach(() => {
  fs().reset();
  ss().reset();
  useSpatialFilterStore.getState().reset();
  baseline = mk();
});

describe("applyAiTurn", () => {
  it("AAT-1 (D-15): filter applied, deltas attached, narrowed hosts outlined, scoped excluded, no unsaved", () => {
    const checkZeroRows = vi.fn().mockResolvedValue(undefined);
    applyAiTurn({ prompt: "only credit", answer: "Done.", ops: credit }, baseline, { checkZeroRows });
    const f = fs().filters[5];
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ column: "payment_type", value: "Credit", aiApplied: true });
    expect(lastTurn().entries[0].filterDeltas).toHaveLength(1);
    expect(sorted(ss().highlight.ids)).toEqual([42, 50, 60]);
    expect(hasUnsavedAiChanges()).toBe(false);
  });

  it("AAT-2 (D-15): no AI edited pill for filter-only changes", () => {
    applyAiTurn({ prompt: "q", answer: "Done.", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    for (const id of [42, 50, 60]) expect(selectShowsAiEditedPill(ss(), id)).toBe(false);
    expect(ss().derived.aiEditedWidgetIds.size).toBe(0);
  });

  it("AAT-3 (D-16): note says what and how many; never in answer", () => {
    applyAiTurn({ prompt: "q", answer: "Done.", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().chat?.filterNotes?.[0]).toBe("Filtered trips to payment_type = 'Credit' (3 widgets).");
    expect(lastTurn().answer).toBe("Done.");
  });

  it("AAT-4 (D-06): untouched user filter is named as still on", () => {
    fs().addFilter(5, user("vendor_id", "V1"));
    applyAiTurn({ prompt: "q", answer: "Done.", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().chat?.filterNotes).toContain("Your vendor_id filter is still on.");
  });

  it("AAT-5 (D-07): clear-all counts widened widgets from the pre map and says shapes stay", () => {
    fs().addFilter(5, user("payment_type", "Cash"));
    useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km" });
    applyAiTurn({ prompt: "q", answer: "Cleared.", ops: [clearFilterRaw()] }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().chat?.filterNotes).toEqual(["Cleared all filters (3 widgets).", "Drawn map shapes were left on."]);
    expect(sorted(ss().highlight.ids)).toEqual([42, 50, 60]);
    expect(fs().filters[5] ?? []).toHaveLength(0);
  });

  it("AAT-6 (D-08): the 25 cap skips with a note and leaves the store untouched", () => {
    for (let i = 0; i < 25; i++) fs().addFilter(5, user(`c${i}`, "x"));
    const before = fs().filters[5];
    const v = fs().filterVersion;
    applyAiTurn({ prompt: "q", answer: "x", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().entries[0].result).toMatchObject({ status: "skipped", reason: "filter_cap" });
    expect(fs().filters[5]).toBe(before);
    expect(fs().filterVersion).toBe(v);
    expect(lastTurn().chat?.filterNotes).toContain("Skipped a filter on trips: it already has 25 filters. Clear some first.");
  });

  it("AAT-7 (D-17 hook): zero-row check gets the stored object; not called for clear-only", () => {
    const checkZeroRows = vi.fn().mockResolvedValue(undefined);
    const { turnId } = applyAiTurn({ prompt: "q", answer: "x", ops: credit }, baseline, { checkZeroRows });
    expect(checkZeroRows).toHaveBeenCalledTimes(1);
    expect(checkZeroRows).toHaveBeenCalledWith({
      turnId,
      epoch: ss().epoch,
      checks: [{ source: T5, column: "payment_type", after: fs().filters[5][0], sourceLabel: "trips" }],
    });
    expect(checkZeroRows.mock.calls[0][0].checks[0].after).toBe(fs().filters[5][0]);
    applyAiTurn({ prompt: "q2", answer: "x", ops: [clearFilterRaw()] }, baseline, { checkZeroRows });
    expect(checkZeroRows).toHaveBeenCalledTimes(1);
  });

  it("AAT-8: re-applying an identical filter is a no-op with an honest note", () => {
    applyAiTurn({ prompt: "q", answer: "x", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    const v = fs().filterVersion;
    applyAiTurn({ prompt: "q2", answer: "x", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().entries[0].filterDeltas).toBeUndefined();
    expect(lastTurn().chat?.filterNotes).toContain("trips was already filtered to payment_type = 'Credit'.");
    expect(fs().filterVersion).toBe(v);
  });

  it("AAT-9 (D-09): mixed turn outlines added widget plus narrowed ones and counts as unsaved", () => {
    applyAiTurn({ prompt: "q", answer: "x", ops: [addWidgetOp(-1, "records", "New", { tableId: 5 }), ...credit] }, baseline, { checkZeroRows: vi.fn() });
    expect(ss().highlight.ids).toContain(-1);
    expect(ss().highlight.ids).toEqual(expect.arrayContaining([42, 50, 60]));
    expect(hasUnsavedAiChanges()).toBe(true);
    expect(computeChangeCounts(ss().derived, { widgets: baseline.widgets, layers: baseline.layers }).added).toBe(1);
  });

  it("AAT-10 (privacy): notes never reach the provider history", () => {
    applyAiTurn({ prompt: "q", answer: "Done.", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().chat?.filterNotes?.join(" ")).toContain("Credit");
    expect(JSON.stringify(buildAskTurns(ss().turns, ss().cursor))).not.toContain("Credit");
  });

  it("AAT-11 (137 gap 8): a structural-only turn outlines through the shared path", () => {
    applyAiTurn({ prompt: "q", answer: "x", ops: [setTitleOp(60, "T")] }, baseline, { checkZeroRows: vi.fn() });
    expect(ss().highlight.ids).toEqual([60]);
  });

  it("AAT-12 (D-18): scoped widgets are named once, never outlined or counted", () => {
    applyAiTurn({ prompt: "q", answer: "x", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    const notes = lastTurn().chat?.filterNotes ?? [];
    expect(notes.filter((n) => n.includes("own filter selection"))).toEqual(["1 widget with its own filter selection was not filtered."]);
    expect(ss().highlight.ids).not.toContain(61);
    expect(notes[0]).toContain("(3 widgets)");
    expect(lastTurn().answer).toBe("x");
    expect(fs().filters[5][0].sourceWidgetId).toBeUndefined();

    fs().reset();
    ss().reset();
    baseline = mk([scoped(62)]);
    applyAiTurn({ prompt: "q", answer: "x", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect(lastTurn().chat?.filterNotes).toContain("2 widgets with their own filter selection were not filtered.");

    fs().reset();
    ss().reset();
    baseline = baselineFixture({ widgets: [mapWidget(42), bar(60), recordsWidget(50, { tableId: 5 })], layers: [savedLayer(7)] });
    applyAiTurn({ prompt: "q", answer: "x", ops: credit }, baseline, { checkZeroRows: vi.fn() });
    expect((lastTurn().chat?.filterNotes ?? []).some((n) => n.includes("own filter selection"))).toBe(false);
  });
});
