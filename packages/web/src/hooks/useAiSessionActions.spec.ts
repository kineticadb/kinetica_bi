// 138-06 Task 3: the session actions (dev harness + DashboardsPage) take the filter-aware path.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFilterStore } from "../store/filterStore";
import { useAiSessionStore, setAiFilterSink } from "../store/aiSessionStore";
import { baselineFixture, applyFilterRaw } from "../test/aiSessionHarness";
import { useAiSessionActions } from "./useAiSessionActions";

vi.mock("../lib/aiOps/aiFilterZeroRows", () => ({
  checkZeroRowFilters: vi.fn().mockResolvedValue(undefined),
  readFirstCount: vi.fn(),
}));

const T5 = { kind: "table" as const, id: 5 };
const fs = () => useFilterStore.getState();
const ss = () => useAiSessionStore.getState();
const baseline = baselineFixture();
const cols = () => (fs().filters[5] ?? []).map((f) => `${f.column}=${String(f.value)}`).sort();

beforeEach(() => {
  fs().reset();
  ss().reset();
});
afterEach(() => setAiFilterSink(null));

describe("useAiSessionActions", () => {
  it("ACTF-1: applyTurn applies filters; setCursor(-1) restores; rendering twice does not double-undo", () => {
    fs().addFilter(5, { column: "vendor_id", value: "V1", dataType: "string", addedAt: 1 });
    const a = renderHook(() => useAiSessionActions(() => baseline));
    renderHook(() => useAiSessionActions(() => baseline));
    a.result.current.applyTurn({ prompt: "q", answer: "x", ops: [applyFilterRaw(T5, "payment_type", "Credit")] });
    expect(cols()).toEqual(["payment_type=Credit", "vendor_id=V1"]);
    a.result.current.setCursor(-1);
    expect(cols()).toEqual(["vendor_id=V1"]);
    a.result.current.setCursor(0);
    expect(cols()).toEqual(["payment_type=Credit", "vendor_id=V1"]);
  });

  it("ACTF-2: discard restores the filter the AI replaced and empties the session", () => {
    fs().addFilter(5, { column: "payment_type", value: "Cash", dataType: "string", addedAt: 1 });
    const a = renderHook(() => useAiSessionActions(() => baseline));
    a.result.current.applyTurn({ prompt: "q", answer: "x", ops: [applyFilterRaw(T5, "payment_type", "Credit")] });
    expect(cols()).toEqual(["payment_type=Credit"]);
    a.result.current.discard();
    expect(cols()).toEqual(["payment_type=Cash"]);
    expect(ss().turns).toHaveLength(0);
  });
});
