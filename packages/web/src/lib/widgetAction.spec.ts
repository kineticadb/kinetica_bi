/**
 * Phase 58 Plan 01 — Task 1 TDD spec for the serializable widget-action envelope.
 * Covers: JSON round-trip, valid parse, and 5 schema-rejection cases.
 */
import { describe, it, expect } from "vitest";
import { WidgetActionSchema, type WidgetAction } from "./widgetAction";

describe("WidgetActionSchema", () => {
  // --- Positive: valid envelope parses ---
  it("parses a valid widget action envelope", () => {
    const action = {
      target: { kind: "widget", id: 42 },
      configPatch: { title: "New Title" },
    };
    const result = WidgetActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it("parses a valid layer action envelope", () => {
    const action = {
      target: { kind: "layer", id: 7 },
      configPatch: { render_mode: "heatmap" },
    };
    const result = WidgetActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  it("parses a valid dynamicView action envelope", () => {
    const action = {
      target: { kind: "dynamicView", id: 1 },
      configPatch: { enabled: true },
    };
    const result = WidgetActionSchema.safeParse(action);
    expect(result.success).toBe(true);
  });

  // --- JSON round-trip: no closures/refs survive ---
  it("deep-equals original action after JSON.parse(JSON.stringify(...))", () => {
    const action: WidgetAction = {
      target: { kind: "layer", id: 3 },
      configPatch: { render_mode: "classbreak", visible: true, opacity: 0.8 },
    };
    const roundTripped = JSON.parse(JSON.stringify(action)) as WidgetAction;
    expect(roundTripped).toEqual(action);
  });

  it("JSON round-trip of configPatch with nested value preserves structure", () => {
    const action: WidgetAction = {
      target: { kind: "widget", id: 99 },
      configPatch: { nested: { a: 1, b: "two" } },
    };
    const roundTripped = JSON.parse(JSON.stringify(action)) as unknown;
    expect(roundTripped).toEqual(action);
  });

  // --- Rejection 1: missing target ---
  it("rejects envelope with missing target", () => {
    const result = WidgetActionSchema.safeParse({
      configPatch: { foo: "bar" },
    });
    expect(result.success).toBe(false);
  });

  // --- Rejection 2: missing configPatch ---
  it("rejects envelope with missing configPatch", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "widget", id: 1 },
    });
    expect(result.success).toBe(false);
  });

  // --- Rejection 3: target.kind not in the 3-value enum ---
  it("rejects envelope with invalid target.kind", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "dashboard", id: 1 },
      configPatch: {},
    });
    expect(result.success).toBe(false);
  });

  // --- Rejection 4: non-integer id ---
  it("rejects envelope with non-integer id (float)", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "widget", id: 1.5 },
      configPatch: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects envelope with non-positive id (zero)", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "layer", id: 0 },
      configPatch: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects envelope with non-positive id (negative)", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "dynamicView", id: -5 },
      configPatch: {},
    });
    expect(result.success).toBe(false);
  });

  // --- Rejection 5: configPatch is not an object ---
  it("rejects envelope when configPatch is a string", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "widget", id: 1 },
      configPatch: "not-an-object",
    });
    expect(result.success).toBe(false);
  });

  it("rejects envelope when configPatch is an array", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "widget", id: 1 },
      configPatch: ["a", "b"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects envelope when configPatch is null", () => {
    const result = WidgetActionSchema.safeParse({
      target: { kind: "widget", id: 1 },
      configPatch: null,
    });
    expect(result.success).toBe(false);
  });
});
