import { describe, it, expect } from "vitest";
import { friendlyProgressLabel, formatElapsed, describeSkipped } from "./chatText";

describe("chatText", () => {
  it("CT-1: friendly progress labels", () => {
    expect(friendlyProgressLabel({ event: "step", data: { n: 1, tool: "add_widget", label: 'Added bar "T"' } })).toBe("Adding a chart…");
    expect(friendlyProgressLabel({ event: "step", data: { n: 1, tool: "describe_table", label: "x" } })).toBe("Reading the table columns…");
    expect(friendlyProgressLabel({ event: "step", data: { n: 1, tool: "mystery", label: "Raw label" } })).toBe("Raw label");
    expect(friendlyProgressLabel({ event: "status", data: { phase: "thinking", label: "Thinking…" } })).toBe("Thinking…");
    expect(friendlyProgressLabel({ event: "status", data: { phase: "waiting_provider", label: "w", seconds: 7 } })).toBe(
      "Waiting for the AI provider, retrying in 7s…",
    );
  });
  it("CT-2: elapsed formatting", () => {
    expect(formatElapsed(9_999)).toBe("");
    expect(formatElapsed(12_400)).toBe(" · 12s");
  });
  it("CT-3: skipped wording", () => {
    expect(describeSkipped({ label: "add_widget", stage: "shape", reasons: ["type: invalid"] })).toBe("Couldn't do: add a chart (type: invalid)");
    expect(describeSkipped({ label: "x", stage: "clarification", reasons: [] })).toBeNull();
    expect(describeSkipped({ label: 'Add bar "T"', stage: "shape", reasons: ["bad"] })).toBe('Couldn\'t do: Add bar "T" (bad)');
    expect(describeSkipped({ label: "unknown_tool", stage: "shape", reasons: [] })).toBe("Couldn't do: make a change");
  });
});
