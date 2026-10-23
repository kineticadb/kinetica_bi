import { describe, it, expect, beforeEach } from "vitest";
import { setGenerateIntent, takeGenerateIntent, GENERATE_DEFAULT_QUESTION, __resetGenerateIntentForTest } from "./generateIntent";

describe("generateIntent", () => {
  beforeEach(() => __resetGenerateIntentForTest());

  it("GENINT-1: take-once", () => {
    setGenerateIntent(3, "Focus on tips");
    expect(takeGenerateIntent(3)).toEqual({ question: "Focus on tips" });
    expect(takeGenerateIntent(3)).toBeNull();
  });
  it("GENINT-2: other dashboard does not take or clear", () => {
    setGenerateIntent(3, "q");
    expect(takeGenerateIntent(4)).toBeNull();
    expect(takeGenerateIntent(3)).toEqual({ question: "q" });
  });
  it("GENINT-3: blank question becomes the default", () => {
    expect(GENERATE_DEFAULT_QUESTION).toBe("Create a starter dashboard for this table.");
    setGenerateIntent(1, "   ");
    expect(takeGenerateIntent(1)).toEqual({ question: GENERATE_DEFAULT_QUESTION });
  });
  it("GENINT-4: replace and reset", () => {
    setGenerateIntent(1, "a");
    setGenerateIntent(2, "b");
    expect(takeGenerateIntent(1)).toBeNull();
    expect(takeGenerateIntent(2)).toEqual({ question: "b" });
    setGenerateIntent(5, "c");
    __resetGenerateIntentForTest();
    expect(takeGenerateIntent(5)).toBeNull();
  });
});
