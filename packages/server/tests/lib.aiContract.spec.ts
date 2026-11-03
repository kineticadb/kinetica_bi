import { describe, it, expect } from "vitest";
import { parseAiOp, AI_OP_KINDS, AI_CONTRACT_VERSION } from "../src/lib/aiContract.js";

describe("aiContract (shared seam)", () => {
  it("AIC-1 rejects an unknown op", () => {
    expect(parseAiOp({ op: "drop_table" }).ok).toBe(false);
  });
  it("AIC-2 accepts a valid remove_widget", () => {
    expect(parseAiOp({ op: "remove_widget", id: 7 }).ok).toBe(true);
  });
  it("AIC-3 contract version is v4", () => {
    expect(AI_CONTRACT_VERSION).toBe("v4");
  });
  it("AIC-4 has 12 op kinds", () => {
    expect(AI_OP_KINDS.length).toBe(12);
  });
});
