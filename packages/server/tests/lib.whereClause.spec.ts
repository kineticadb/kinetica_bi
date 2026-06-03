import { describe, it, expect } from "vitest";
import {
  escapeKineticaStringLiteral,
  buildServerWhereClause,
  type ActiveFilter,
} from "../src/lib/whereClause";

describe("escapeKineticaStringLiteral", () => {
  it("returns plain alphanumeric input unchanged", () => {
    expect(escapeKineticaStringLiteral("hello")).toBe("hello");
  });

  it("doubles a single quote (SQL standard escape)", () => {
    expect(escapeKineticaStringLiteral("O'Brien")).toBe("O''Brien");
  });

  it("doubles leading single-quote in injection-shaped input", () => {
    expect(escapeKineticaStringLiteral("'; DROP TABLE--")).toBe(
      "''; DROP TABLE--"
    );
  });

  it("returns empty string for empty input", () => {
    expect(escapeKineticaStringLiteral("")).toBe("");
  });

  it("re-escapes already-escaped quotes (symmetric with v1.2)", () => {
    expect(escapeKineticaStringLiteral("a''b")).toBe("a''''b");
  });

  it("doubles every single-quote in a multi-quote input", () => {
    expect(escapeKineticaStringLiteral("'a'b'c'")).toBe("''a''b''c''");
  });
});

describe("buildServerWhereClause", () => {
  it("returns the literal '1=1' fallback for an empty filter list", () => {
    expect(buildServerWhereClause([])).toBe("1=1");
  });

  it("emits column = 'value' for a single string filter", () => {
    const filters: ActiveFilter[] = [
      { column: "zone", value: "East Village", dataType: "string", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("zone = 'East Village'");
  });

  it("escapes single quotes inside string filter values", () => {
    const filters: ActiveFilter[] = [
      { column: "name", value: "O'Brien", dataType: "string", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("name = 'O''Brien'");
  });

  it("emits column = N for a number filter (numeric value, no quotes)", () => {
    const filters: ActiveFilter[] = [
      { column: "fare", value: 12.5, dataType: "number", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("fare = 12.5");
  });

  it("coerces string-shaped numeric value via Number(...)", () => {
    const filters: ActiveFilter[] = [
      { column: "tip", value: "0", dataType: "number", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("tip = 0");
  });

  it("emits column IS NULL for a null-typed filter", () => {
    const filters: ActiveFilter[] = [
      { column: "status", value: null, dataType: "null", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("status IS NULL");
  });

  it("emits column = true / false for boolean filters", () => {
    const filters: ActiveFilter[] = [
      { column: "active", value: true, dataType: "boolean", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("active = true");
  });

  it("emits column = 'iso' for datetime filters (treats value as string literal)", () => {
    const filters: ActiveFilter[] = [
      {
        column: "ts",
        value: "2026-05-06T10:00:00Z",
        dataType: "datetime",
        addedAt: 0,
      },
    ];
    expect(buildServerWhereClause(filters)).toBe(
      "ts = '2026-05-06T10:00:00Z'"
    );
  });

  it("joins two filters with ' AND '", () => {
    const filters: ActiveFilter[] = [
      { column: "col1", value: "a", dataType: "string", addedAt: 0 },
      { column: "col2", value: 5, dataType: "number", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("col1 = 'a' AND col2 = 5");
  });

  it("joins three filters with ' AND ' separators", () => {
    const filters: ActiveFilter[] = [
      { column: "col1", value: "a", dataType: "string", addedAt: 0 },
      { column: "col2", value: 5, dataType: "number", addedAt: 0 },
      { column: "col3", value: null, dataType: "null", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe(
      "col1 = 'a' AND col2 = 5 AND col3 IS NULL"
    );
  });
});

describe("buildServerWhereClause — IN operator (Phase 44 FILTER-V17-04)", () => {
  it("emits col IN ('a', 'b') for operator: 'in' with string array", () => {
    const filters: ActiveFilter[] = [
      { column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("region IN ('EAST', 'WEST')");
  });

  it("escapes single quotes per element in an IN string array", () => {
    const filters: ActiveFilter[] = [
      { column: "name", value: ["O'Brien", "smith"], dataType: "string", operator: "in", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("name IN ('O''Brien', 'smith')");
  });

  it("emits col IN (1, 2, 3) for operator: 'in' with number array — unquoted", () => {
    const filters: ActiveFilter[] = [
      { column: "id", value: [1, 2, 3], dataType: "number", operator: "in", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("id IN (1, 2, 3)");
  });

  it("emits col IN ('a') for operator: 'in' with single-element array", () => {
    const filters: ActiveFilter[] = [
      { column: "region", value: ["EAST"], dataType: "string", operator: "in", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("region IN ('EAST')");
  });

  it("emits 1=0 (no match) for operator: 'in' with empty array — never invalid IN ()", () => {
    const filters: ActiveFilter[] = [
      { column: "region", value: [], dataType: "string", operator: "in", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("1=0");
  });
});

describe("buildServerWhereClause — BETWEEN operator (Phase 44 FILTER-V17-04)", () => {
  it("emits col BETWEEN x AND y for operator: 'between' with number tuple", () => {
    const filters: ActiveFilter[] = [
      { column: "fare", value: [5, 50], dataType: "number", operator: "between", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("fare BETWEEN 5 AND 50");
  });

  it("emits col BETWEEN '...' AND '...' for operator: 'between' on datetime with single-quoted ISO strings", () => {
    const filters: ActiveFilter[] = [
      { column: "ts", value: ["2024-01-01", "2024-12-31"], dataType: "datetime", operator: "between", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("ts BETWEEN '2024-01-01' AND '2024-12-31'");
  });

  it("emits col BETWEEN '...' AND '...' for operator: 'between' on string dataType (with single-quote escape)", () => {
    const filters: ActiveFilter[] = [
      { column: "col", value: ["A''", "Z"], dataType: "string", operator: "between", addedAt: 0 },
    ];
    // Input "A''" (JavaScript: A + ' + ') has 2 single-quotes; escapeKineticaStringLiteral doubles each:
    // A'' → A'''' (4 single-quotes), then wrapped in outer quotes: 'A''''
    expect(buildServerWhereClause(filters)).toBe("col BETWEEN 'A'''''" + " AND 'Z'");
  });
});

describe("buildServerWhereClause — back-compat eq default (Phase 44 FILTER-V17-04)", () => {
  it("ActiveFilter literal with NO operator field produces eq SQL (legacy drill-down compat)", () => {
    const filters: ActiveFilter[] = [
      { column: "zone", value: "East Village", dataType: "string", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("zone = 'East Village'");
  });

  it("operator: 'eq' explicitly set behaves identically to operator absent", () => {
    const filters: ActiveFilter[] = [
      { column: "zone", value: "East Village", dataType: "string", operator: "eq", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe("zone = 'East Village'");
  });

  it("multi-column AND chain mixing operators: eq + in + between composes correctly", () => {
    const filters: ActiveFilter[] = [
      { column: "zone", value: "Midtown", dataType: "string", addedAt: 0 },
      { column: "region", value: ["EAST", "WEST"], dataType: "string", operator: "in", addedAt: 0 },
      { column: "fare", value: [5, 50], dataType: "number", operator: "between", addedAt: 0 },
    ];
    expect(buildServerWhereClause(filters)).toBe(
      "zone = 'Midtown' AND region IN ('EAST', 'WEST') AND fare BETWEEN 5 AND 50"
    );
  });
});
