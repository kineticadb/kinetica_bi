import { describe, it, expect } from "vitest";
import { AiOpSchema, AI_OP_KINDS, parseAiOp } from "./aiOp";
import { WidgetActionTargetSchema } from "./widgetAction";

const patch = (id: number, extra: Record<string, unknown> = {}) => ({
  op: "patch",
  action: { target: { kind: "widget", id }, configPatch: { title: "x" }, ...extra },
});
const addWidget = (tempId: number, extra: Record<string, unknown> = {}) => ({
  op: "add_widget", tempId, type: "bar", title: "t", config: {}, ...extra,
});

describe("AiOpSchema", () => {
  it("AIOP-1: patch with saved positive id is ok", () => {
    expect(parseAiOp(patch(5)).ok).toBe(true);
  });
  it("AIOP-2: patch with negative temp id is ok", () => {
    expect(parseAiOp(patch(-3)).ok).toBe(true);
  });
  it("AIOP-3: patch with id 0 is rejected", () => {
    expect(parseAiOp(patch(0)).ok).toBe(false);
  });
  it("AIOP-4: unknown op, empty object and null are rejected", () => {
    expect(parseAiOp({ op: "drop_table" }).ok).toBe(false);
    expect(parseAiOp({}).ok).toBe(false);
    expect(parseAiOp(null).ok).toBe(false);
  });
  it("AIOP-5: add_widget requires a negative tempId", () => {
    expect(parseAiOp(addWidget(4)).ok).toBe(false);
    expect(parseAiOp(addWidget(-1)).ok).toBe(true);
  });
  it("AIOP-6: add_widget rejects extra keys (strict)", () => {
    expect(parseAiOp(addWidget(-1, { sql: "DROP TABLE x" })).ok).toBe(false);
  });
  it("AIOP-7: patch rejects extra keys on action and on target", () => {
    expect(parseAiOp(patch(5, { sql: "x" })).ok).toBe(false);
    expect(
      parseAiOp({
        op: "patch",
        action: { target: { kind: "widget", id: 5, sql: "x" }, configPatch: {} },
      }).ok,
    ).toBe(false);
  });
  it("AIOP-8: op literals match AI_OP_KINDS exactly", () => {
    const literals = AiOpSchema.options.map((o) => o.shape.op.value).sort();
    expect(literals).toEqual([...AI_OP_KINDS].sort());
    expect(AI_OP_KINDS.length).toBe(9);
  });
  it("AIOP-9: web engine target schema stays positive-only", () => {
    expect(WidgetActionTargetSchema.safeParse({ kind: "widget", id: -1 }).success).toBe(false);
  });
  it("AIOP-10: parseAiOp reports path-prefixed errors", () => {
    const r = parseAiOp(addWidget(4));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith("tempId:"))).toBe(true);
  });
});
