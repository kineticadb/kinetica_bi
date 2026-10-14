import { describe, it, expect } from "vitest";
import { AskRequestSchema, AI_WIDGET_TYPES, AiClarificationSchema, AskResultEventSchema } from "./aiAsk";

const base = () => ({
  dashboardId: 3,
  question: "q",
  snapshot: { widgets: [], layers: [], dynamicViews: [], filters: [] },
  turns: [],
});
const ok = (b: unknown) => AskRequestSchema.safeParse(b).success;

describe("AskRequestSchema", () => {
  it("ASK-1: minimal body parses", () => {
    expect(ok(base())).toBe(true);
  });

  it("ASK-2: strict everywhere, no slot for row/filter values", () => {
    expect(ok({ ...base(), extra: 1 })).toBe(false);
    expect(ok({ ...base(), snapshot: { ...base().snapshot, extra: [] } })).toBe(false);
    const withSnap = (s: Record<string, unknown>) => ({ ...base(), snapshot: { ...base().snapshot, ...s } });
    const f = { source: { kind: "table", id: 1 }, column: "c", op: "eq" };
    expect(ok(withSnap({ filters: [f] }))).toBe(true);
    expect(ok(withSnap({ filters: [{ ...f, value: "secret" }] }))).toBe(false);
    expect(ok(withSnap({ filters: [{ ...f, values: ["secret"] }] }))).toBe(false);
    const w = { id: 1, type: "bar", title: "t" };
    expect(ok(withSnap({ widgets: [w] }))).toBe(true);
    expect(ok(withSnap({ widgets: [{ ...w, config: {} }] }))).toBe(false);
    expect(ok(withSnap({ widgets: [{ ...w, customWhere: "x" }] }))).toBe(false);
    expect(ok(withSnap({ widgets: [{ ...w, binding: { metric: "m", groupByColumns: ["a"] } }] }))).toBe(true);
    expect(ok(withSnap({ widgets: [{ ...w, binding: { customWhere: "1=1" } }] }))).toBe(false);
    expect(ok(withSnap({ widgets: [{ ...w, binding: { somethingElse: "x" } }] }))).toBe(false);
  });

  it("ASK-3: turn shape and bounds (D-17 answer included)", () => {
    const turn = { question: "q", answer: "a", changes: [{ label: "l", status: "applied" }, { label: "m", status: "skipped", reason: "r" }] };
    expect(ok({ ...base(), turns: [turn] })).toBe(true);
    expect(ok({ ...base(), turns: [{ ...turn, answer: "x".repeat(8001) }] })).toBe(false);
    expect(ok({ ...base(), turns: [{ ...turn, answer: "x".repeat(8000) }] })).toBe(true);
    expect(ok({ ...base(), turns: Array.from({ length: 51 }, () => turn) })).toBe(false);
    expect(ok({ ...base(), turns: Array.from({ length: 50 }, () => turn) })).toBe(true);
    const ch = { label: "l", status: "applied" };
    expect(ok({ ...base(), turns: [{ ...turn, changes: Array.from({ length: 31 }, () => ch) }] })).toBe(false);
    expect(ok({ ...base(), turns: [{ ...turn, changes: Array.from({ length: 30 }, () => ch) }] })).toBe(true);
  });

  it("ASK-4: question and id bounds", () => {
    expect(ok({ ...base(), question: "" })).toBe(false);
    expect(ok({ ...base(), question: "   " })).toBe(false);
    expect(ok({ ...base(), question: "x".repeat(2001) })).toBe(false);
    const withW = (id: number) => ({ ...base(), snapshot: { ...base().snapshot, widgets: [{ id, type: "bar", title: "t" }] } });
    expect(ok(withW(0))).toBe(false);
    expect(ok(withW(-1))).toBe(true);
  });

  it("ASK-5: approved widget subset", () => {
    expect([...AI_WIDGET_TYPES]).toEqual(["bar", "line", "pie", "table", "bignumber", "records", "map"]);
  });
});

describe("Phase 136 ask contract", () => {
  it("ASK6-1: approvals flag", () => {
    expect(ok({ ...base(), approvals: { removeSaved: true } })).toBe(true);
    expect(ok({ ...base(), approvals: { removeSaved: true, other: 1 } })).toBe(false);
    expect(ok(base())).toBe(true);
  });
  it("ASK6-2: SnapWidget dynamicViewId", () => {
    const w = { id: 1, type: "map", title: "t", dynamicViewId: 5 };
    expect(ok({ ...base(), snapshot: { ...base().snapshot, widgets: [w] } })).toBe(true);
    expect(ok({ ...base(), snapshot: { ...base().snapshot, widgets: [{ ...w, dynamicViewId: 0 }] } })).toBe(false);
  });
  it("ASK6-3: AiClarificationSchema", () => {
    const o = [{ id: "1", label: "Map A" }];
    expect(AiClarificationSchema.safeParse({ kind: "confirm_remove", question: "Remove?", options: o }).success).toBe(true);
    expect(AiClarificationSchema.safeParse({ kind: "choose_map", question: "Which?", options: o }).success).toBe(true);
    expect(AiClarificationSchema.safeParse({ kind: "other", question: "?", options: o }).success).toBe(false);
  });
});

describe("Phase 137 result contract", () => {
  const o = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  const res = () => ({ answerId: 1, text: "x", ops: [], skipped: [], clarifications: [], followUps: ["a", "b"], applied: ['Added bar "T"'] });
  it("ASKC-1: choose_option kind", () => {
    expect(AiClarificationSchema.safeParse({ kind: "choose_option", question: "?", options: o }).success).toBe(true);
    expect(AiClarificationSchema.safeParse({ kind: "pick", question: "?", options: o }).success).toBe(false);
  });
  it("ASKC-2: AskResultEventSchema", () => {
    expect(AskResultEventSchema.safeParse(res()).success).toBe(true);
    expect(AskResultEventSchema.safeParse({ ...res(), extra: 1 }).success).toBe(false);
    expect(AskResultEventSchema.safeParse({ ...res(), followUps: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(AskResultEventSchema.safeParse({ ...res(), followUps: ["x".repeat(121)] }).success).toBe(false);
  });
  it("ASKC-3: AI_WIDGET_TYPES excludes ai", () => {
    expect((AI_WIDGET_TYPES as readonly string[]).includes("ai")).toBe(false);
  });
});
