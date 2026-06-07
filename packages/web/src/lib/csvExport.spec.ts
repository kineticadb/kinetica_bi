import { describe, it, expect } from "vitest";
import {
  escapeCsvField,
  rowsToCsv,
  sanitizeFilenamePart,
  buildCsvFilename,
} from "./csvExport";

describe("escapeCsvField", () => {
  it("passes through a plain field with no special chars", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("wraps fields containing a comma in double quotes", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("wraps fields containing a double-quote and doubles the quote", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps fields containing a newline in double quotes", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("returns empty string for null", () => {
    expect(escapeCsvField(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("coerces numbers to string before escaping", () => {
    expect(escapeCsvField(42)).toBe("42");
  });

  it("coerces boolean to string before escaping", () => {
    expect(escapeCsvField(true)).toBe("true");
  });
});

describe("rowsToCsv", () => {
  it("produces correct header line from columns", () => {
    const csv = rowsToCsv([], ["col_a", "col_b"]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("col_a,col_b");
  });

  it("emits only the given columns (extra row keys excluded)", () => {
    const rows = [{ col_a: "x", col_b: "y", extra: "ignore" }];
    const csv = rowsToCsv(rows, ["col_a", "col_b"]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("x,y");
    expect(lines[1]).not.toContain("ignore");
  });

  it("respects column order (reversed columns → reversed output)", () => {
    const rows = [{ col_a: "1", col_b: "2" }];
    const csvNormal = rowsToCsv(rows, ["col_a", "col_b"]);
    const csvReversed = rowsToCsv(rows, ["col_b", "col_a"]);
    expect(csvNormal.split("\r\n")[1]).toBe("1,2");
    expect(csvReversed.split("\r\n")[1]).toBe("2,1");
  });

  it("emits empty cell for missing key in row", () => {
    const rows = [{ col_a: "x" }];
    const csv = rowsToCsv(rows, ["col_a", "col_b"]);
    expect(csv.split("\r\n")[1]).toBe("x,");
  });

  it("joins lines with CRLF", () => {
    const rows = [{ a: "1" }, { a: "2" }];
    const csv = rowsToCsv(rows, ["a"]);
    expect(csv).toContain("\r\n");
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 data rows
  });
});

describe("sanitizeFilenamePart", () => {
  it("replaces forward slash with dash", () => {
    expect(sanitizeFilenamePart("path/to")).toBe("path-to");
  });

  it("replaces backslash with dash", () => {
    expect(sanitizeFilenamePart("path\\to")).toBe("path-to");
  });

  it("replaces colon with dash", () => {
    expect(sanitizeFilenamePart("C:file")).toBe("C-file");
  });

  it("collapses whitespace runs to single dash", () => {
    expect(sanitizeFilenamePart("my  report")).toBe("my-report");
  });

  it("returns 'table' for empty result", () => {
    expect(sanitizeFilenamePart("")).toBe("table");
    expect(sanitizeFilenamePart("///")).toBe("table");
  });
});

describe("buildCsvFilename", () => {
  it("formats filename with sanitized title and LOCAL time zero-padded", () => {
    // June = month index 5; new Date(year, monthIndex, day, h, m, s)
    const fixedDate = new Date(2026, 5, 7, 9, 8, 5);
    const filename = buildCsvFilename("My Report", fixedDate);
    expect(filename).toBe("My-Report-20260607-090805.csv");
  });

  it("sanitizes the title part", () => {
    const fixedDate = new Date(2026, 5, 7, 9, 8, 5);
    const filename = buildCsvFilename("weird/name:file", fixedDate);
    expect(filename).toBe("weird-name-file-20260607-090805.csv");
  });
});
