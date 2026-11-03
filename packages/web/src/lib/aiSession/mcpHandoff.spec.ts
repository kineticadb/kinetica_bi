import { describe, it, expect } from "vitest";
import type { AiOp } from "@kinetica-bi/shared";
import { removesSavedContent } from "./mcpHandoff";

describe("removesSavedContent", () => {
  it("MCPH-1 a removal of a saved widget, layer or view (positive id) counts; temp ids and other ops do not", () => {
    expect(removesSavedContent([{ op: "remove_widget", id: 272 }] as AiOp[])).toBe(true);
    expect(removesSavedContent([{ op: "remove_layer", id: 9 }] as AiOp[])).toBe(true);
    expect(removesSavedContent([{ op: "remove_dynamic_view", id: 4 }] as AiOp[])).toBe(true);
    expect(removesSavedContent([{ op: "remove_widget", id: -2 }] as AiOp[])).toBe(false);
    expect(removesSavedContent([{ op: "set_widget_title", id: 5, title: "x" }] as AiOp[])).toBe(false);
    expect(removesSavedContent([])).toBe(false);
  });
});
