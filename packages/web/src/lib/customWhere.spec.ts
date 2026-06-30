/**
 * Tests for customWhere.ts — shared pure helper for splicing user-supplied
 * raw-SQL WHERE predicates into query fragments.
 *
 * RED phase: these tests are written before the implementation exists.
 */
import { describe, it, expect } from "vitest";
import { andCustomWhere, whereCustomWhere } from "./customWhere";

describe("andCustomWhere", () => {
  it("non-empty predicate → exact ' AND (<predicate>)' with leading space", () => {
    expect(andCustomWhere("status = 'active'")).toBe(" AND (status = 'active')");
  });

  it("undefined input → empty string (no-op)", () => {
    expect(andCustomWhere(undefined)).toBe("");
  });

  it("empty string '' → empty string (no-op)", () => {
    expect(andCustomWhere("")).toBe("");
  });

  it("whitespace-only '   ' → empty string (no-op)", () => {
    expect(andCustomWhere("   ")).toBe("");
  });

  it("predicate with leading/trailing spaces is trimmed to inner content", () => {
    expect(andCustomWhere("  status = 'active'  ")).toBe(" AND (status = 'active')");
  });

  it("OR-containing predicate is wrapped as ' AND (a = 1 OR b = 2)'", () => {
    expect(andCustomWhere("a = 1 OR b = 2")).toBe(" AND (a = 1 OR b = 2)");
  });
});

describe("whereCustomWhere", () => {
  it("non-empty predicate → exact ' WHERE (<predicate>)' with leading space", () => {
    expect(whereCustomWhere("status = 'active'")).toBe(" WHERE (status = 'active')");
  });

  it("undefined input → empty string (no-op)", () => {
    expect(whereCustomWhere(undefined)).toBe("");
  });

  it("empty string '' → empty string (no-op)", () => {
    expect(whereCustomWhere("")).toBe("");
  });

  it("whitespace-only '   ' → empty string (no-op)", () => {
    expect(whereCustomWhere("   ")).toBe("");
  });

  it("predicate with leading/trailing spaces is trimmed to inner content", () => {
    expect(whereCustomWhere("  region = 'West'  ")).toBe(" WHERE (region = 'West')");
  });

  it("OR-containing predicate is wrapped as ' WHERE (a = 1 OR b = 2)'", () => {
    expect(whereCustomWhere("a = 1 OR b = 2")).toBe(" WHERE (a = 1 OR b = 2)");
  });
});
