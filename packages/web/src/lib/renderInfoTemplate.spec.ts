// POPUP-V14-04 — shared template-rendering helper (Phase 21 popup + Phase 23 Info Card)

import { describe, it, expect } from "vitest";
import { renderInfoTemplate } from "./renderInfoTemplate";

describe("renderInfoTemplate", () => {
  describe("template mode", () => {
    it("T1: substitutes multiple tokens from row", () => {
      const result = renderInfoTemplate({
        template: "<b>{name}</b> at {city}",
        columns: ["name", "city"],
        row: { name: "Alice", city: "SF" },
      });
      expect(result).toEqual({ mode: "template", html: "<b>Alice</b> at SF" });
    });

    it("T2: substitutes missing column token with empty string (not 'undefined'/'null')", () => {
      const result = renderInfoTemplate({
        template: "Hello {ghost}",
        columns: [],
        row: { name: "Alice" },
      });
      expect(result).toEqual({ mode: "template", html: "Hello " });
      expect((result as { mode: "template"; html: string }).html).not.toContain("undefined");
      expect((result as { mode: "template"; html: string }).html).not.toContain("null");
    });

    it("T3: substitutes null column value with empty string", () => {
      const result = renderInfoTemplate({
        template: "Value: {score}",
        columns: ["score"],
        row: { score: null },
      });
      expect(result).toEqual({ mode: "template", html: "Value: " });
    });

    it("T4: returns plain HTML verbatim when no tokens present", () => {
      const result = renderInfoTemplate({
        template: "<strong>No tokens here</strong>",
        columns: [],
        row: {},
      });
      expect(result).toEqual({
        mode: "template",
        html: "<strong>No tokens here</strong>",
      });
    });

    it("T5: substitutes multiple occurrences of the same token independently", () => {
      const result = renderInfoTemplate({
        template: "{x}{x}",
        columns: ["x"],
        row: { x: "hello" },
      });
      expect(result).toEqual({ mode: "template", html: "hellohello" });
    });

    it("T6: empty string template is treated as configured template (mode='template', html='')", () => {
      const result = renderInfoTemplate({
        template: "",
        columns: ["a"],
        row: { a: "val" },
      });
      expect(result).toEqual({ mode: "template", html: "" });
    });
  });

  describe("kv mode", () => {
    it("KV1: null template + null infoColumns => mode='kv' with all response columns", () => {
      const result = renderInfoTemplate({
        template: null,
        columns: ["a", "b"],
        row: { a: 1, b: "x" },
        infoColumns: null,
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [
          { col: "a", value: 1 },
          { col: "b", value: "x" },
        ],
      });
    });

    it("KV2: infoColumns JSON-array selects only those columns in info_columns order", () => {
      const result = renderInfoTemplate({
        template: null,
        columns: ["a", "b", "c"],
        row: { a: 1, b: 2, c: 3 },
        infoColumns: '["a","c"]',
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [
          { col: "a", value: 1 },
          { col: "c", value: 3 },
        ],
      });
    });

    it("KV3: infoColumns references column not in response => value is undefined (lenient)", () => {
      const result = renderInfoTemplate({
        template: null,
        columns: ["a"],
        row: { a: 1 },
        infoColumns: '["unknown"]',
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [{ col: "unknown", value: undefined }],
      });
    });

    it("KV4: malformed infoColumns JSON falls back to all response columns without throwing", () => {
      expect(() => {
        renderInfoTemplate({
          template: null,
          columns: ["a", "b"],
          row: { a: 1, b: 2 },
          infoColumns: "not valid json{{",
        });
      }).not.toThrow();
      const result = renderInfoTemplate({
        template: null,
        columns: ["a", "b"],
        row: { a: 1, b: 2 },
        infoColumns: "not valid json{{",
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [
          { col: "a", value: 1 },
          { col: "b", value: 2 },
        ],
      });
    });

    it("KV5: empty array infoColumns ('[]') falls back to all response columns", () => {
      const result = renderInfoTemplate({
        template: null,
        columns: ["a", "b"],
        row: { a: 10, b: 20 },
        infoColumns: "[]",
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [
          { col: "a", value: 10 },
          { col: "b", value: 20 },
        ],
      });
    });

    it("KV6: valid JSON but non-array infoColumns falls back to all response columns", () => {
      const result = renderInfoTemplate({
        template: null,
        columns: ["a", "b"],
        row: { a: "foo", b: "bar" },
        infoColumns: '{"not":"array"}',
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [
          { col: "a", value: "foo" },
          { col: "b", value: "bar" },
        ],
      });
    });

    it("KV7: row contains nested object => value preserved as-is (no string coercion in kv mode)", () => {
      const nested = { lat: 40.7, lon: -74.0 };
      const result = renderInfoTemplate({
        template: null,
        columns: ["loc"],
        row: { loc: nested },
        infoColumns: null,
      });
      expect(result).toEqual({
        mode: "kv",
        pairs: [{ col: "loc", value: nested }],
      });
    });
  });

  describe("formatValue callback (COLAPPLY-V115-03)", () => {
    it("FV1: template mode with formatValue — callback is called and its return value is used for substitution", () => {
      const formatValue = (col: string, value: unknown) => `${col}:${String(value).toUpperCase()}`;
      const result = renderInfoTemplate({
        template: "Name={name} Amount={amount}",
        columns: ["name", "amount"],
        row: { name: "alice", amount: 42 },
        formatValue,
      });
      expect(result).toEqual({ mode: "template", html: "Name=name:ALICE Amount=amount:42" });
    });

    it("FV2: template mode WITHOUT formatValue — behavior is identical to today (raw String(v) fallback)", () => {
      const result = renderInfoTemplate({
        template: "Name={name} Amount={amount}",
        columns: ["name", "amount"],
        row: { name: "alice", amount: 42 },
        // formatValue intentionally omitted
      });
      expect(result).toEqual({ mode: "template", html: "Name=alice Amount=42" });
    });

    it("FV3: null/undefined value with formatValue present — still '' (formatter NOT invoked for null/undefined)", () => {
      const formatValue = vi.fn((_col: string, value: unknown) => `FORMATTED:${String(value)}`);
      const result = renderInfoTemplate({
        template: "Score={score} Name={name}",
        columns: ["score", "name"],
        row: { score: null, name: undefined },
        formatValue,
      });
      expect((result as { mode: "template"; html: string }).html).toBe("Score= Name=");
      // Formatter must NOT have been called for null or undefined values
      expect(formatValue).not.toHaveBeenCalled();
    });
  });
});
