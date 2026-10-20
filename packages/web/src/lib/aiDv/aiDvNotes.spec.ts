import { describe, it, expect, beforeEach } from "vitest";
import { notifyAiDvStatus, __resetAiDvNotesForTest } from "./aiDvNotes";
import { useAiSessionStore } from "../../store/aiSessionStore";
import type { DynamicViewRow } from "../../api/client";
import type { Turn } from "../aiSession/types";

const spec = { baseTableId: 5, filters: [{ column: "vendor", op: "eq", value: "SECRETVAL_139" }] } as never;
const row = (over: Partial<DynamicViewRow> = {}, ai: Record<string, unknown> = {}): DynamicViewRow => ({
  id: -3, dashboard_id: 12, source_table_id: 5, name: "Trips by hour", template_sql: "", max_records: 100000,
  columns_json: null, created_at: "", updated_at: "",
  ai: { nonce: "0a1b2c3d", gen: 0, spec, baseLabel: "demo.trips", suggestColumn: { name: "pickup_datetime", kind: "date" }, ...ai },
  ...over,
} as DynamicViewRow);
const turn = (tempId: number): Turn => ({
  id: "t1", prompt: "p", answer: "a", createdAt: 0,
  entries: [{ raw: {}, op: { op: "add_dynamic_view", tempId, name: "Trips by hour", spec } as never, result: { status: "applied" } }],
});
const chat = () => useAiSessionStore.getState().turns[0]?.chat;

beforeEach(() => {
  __resetAiDvNotesForTest();
  useAiSessionStore.getState().reset();
  useAiSessionStore.setState({ turns: [turn(-3)] });
});

describe("notifyAiDvStatus (139-11 D-05)", () => {
  it("NOTEDV-1: no_filter note + date follow-up", () => {
    notifyAiDvStatus(row(), { status: "over_threshold", reason: "no_filter" });
    expect(chat()?.filterNotes).toContain('"Trips by hour" is waiting for a filter: demo.trips has too many rows to build it unfiltered (limit 100,000).');
    expect(chat()?.followUps).toContain("Filter demo.trips to the last 30 days");
  });

  it("NOTEDV-2: exceeds note; string and no suggestion follow-ups", () => {
    notifyAiDvStatus(row(), { status: "over_threshold", reason: "exceeds_max_records", row_count: 250000 });
    expect(chat()?.filterNotes).toContain('"Trips by hour" has too many rows (250,000; limit 100,000). Narrow the filters to show it.');
    __resetAiDvNotesForTest();
    useAiSessionStore.setState({ turns: [turn(-3)] });
    notifyAiDvStatus(row({}, { suggestColumn: { name: "vendor", kind: "string" } }), { status: "over_threshold", reason: "no_filter" });
    expect(chat()?.followUps).toContain("Filter demo.trips by vendor");
    __resetAiDvNotesForTest();
    useAiSessionStore.setState({ turns: [turn(-3)] });
    notifyAiDvStatus(row({}, { suggestColumn: undefined }), { status: "over_threshold", reason: "no_filter" });
    expect(chat()?.followUps).toContain("Narrow the filters on demo.trips");
  });

  it("NOTEDV-3: once per (tempId, gen)", () => {
    const r = { status: "over_threshold", reason: "no_filter" } as const;
    notifyAiDvStatus(row(), r);
    notifyAiDvStatus(row(), r);
    expect(chat()?.filterNotes).toHaveLength(1);
    notifyAiDvStatus(row({}, { gen: 1 }), r);
    expect(chat()?.filterNotes).toHaveLength(2);
  });

  it("NOTEDV-4: no matching turn or saved row is a silent no-op", () => {
    useAiSessionStore.setState({ turns: [turn(-9)] });
    expect(() => notifyAiDvStatus(row(), { status: "over_threshold", reason: "no_filter" })).not.toThrow();
    expect(chat()?.filterNotes).toBeUndefined();
    useAiSessionStore.setState({ turns: [turn(-3)] });
    notifyAiDvStatus(row({ id: 90, ai: undefined }), { status: "over_threshold", reason: "no_filter" });
    expect(chat()?.filterNotes).toBeUndefined();
  });

  it("NOTEDV-5: notes never carry spec filter values", () => {
    notifyAiDvStatus(row(), { status: "over_threshold", reason: "exceeds_max_records", row_count: 5 });
    expect(JSON.stringify(chat())).not.toContain("SECRETVAL_139");
  });
});
