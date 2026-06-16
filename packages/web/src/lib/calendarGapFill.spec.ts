/**
 * Phase 67 Plan 01 (CAL-V113-04): vitest coverage for calendarGapFill —
 * 2D domain×subdomain dense-grid gap-fill.
 *
 * RED phase: all tests written before implementation exists.
 */
import { describe, it, expect } from "vitest";
import { gapFillCalendar } from "./calendarGapFill";
import type { CalendarCell, CalendarRow } from "./calendarGapFill";

describe("gapFillCalendar", () => {
  it("returns empty structure for empty input", () => {
    const result = gapFillCalendar([]);
    expect(result.rows).toEqual([]);
    expect(result.domainKeys).toEqual([]);
    expect(result.subdomainKeys).toEqual([]);
  });

  it("produces a dense 2×2 grid from a sparse 2-row input (gap-fill)", () => {
    // Two populated cells at opposite corners; the other two must be null
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: 10 },
      { domain_bucket: "D2", subdomain_bucket: "S2", value: 20 },
    ];
    const result = gapFillCalendar(input);

    // 2 distinct domain keys, 2 distinct subdomain keys
    expect(result.domainKeys).toEqual(["D1", "D2"]);
    expect(result.subdomainKeys).toEqual(["S1", "S2"]);

    // 2 rows (one per domain)
    expect(result.rows).toHaveLength(2);

    // Each row has 2 cells (one per subdomain)
    for (const row of result.rows) {
      expect(row.cells).toHaveLength(2);
    }

    // Total cells = 4 (dense grid — gap positions get value: null)
    const allCells = result.rows.flatMap((r) => r.cells);
    expect(allCells).toHaveLength(4);
  });

  it("preserves populated values at their correct (domain, subdomain) coordinates", () => {
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: 10 },
      { domain_bucket: "D2", subdomain_bucket: "S2", value: 20 },
    ];
    const result = gapFillCalendar(input);

    // D1 row
    const d1Row = result.rows.find((r) => r.domainKey === "D1")!;
    expect(d1Row).toBeDefined();
    const d1s1 = d1Row.cells.find((c) => c.subdomainKey === "S1");
    expect(d1s1?.value).toBe(10);

    // D2 row
    const d2Row = result.rows.find((r) => r.domainKey === "D2")!;
    expect(d2Row).toBeDefined();
    const d2s2 = d2Row.cells.find((c) => c.subdomainKey === "S2");
    expect(d2s2?.value).toBe(20);
  });

  it("fills unpopulated (domain×subdomain) positions with value: null — never collapses neighbors", () => {
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: 10 },
      { domain_bucket: "D2", subdomain_bucket: "S2", value: 20 },
    ];
    const result = gapFillCalendar(input);

    // D1×S2 and D2×S1 must be null (gap positions)
    const d1Row = result.rows.find((r) => r.domainKey === "D1")!;
    const d1s2 = d1Row.cells.find((c) => c.subdomainKey === "S2");
    expect(d1s2?.value).toBeNull();

    const d2Row = result.rows.find((r) => r.domainKey === "D2")!;
    const d2s1 = d2Row.cells.find((c) => c.subdomainKey === "S1");
    expect(d2s1?.value).toBeNull();
  });

  it("sorts domain keys ascending (matching buildCalendarSql ORDER BY)", () => {
    const input = [
      { domain_bucket: "2024-03", subdomain_bucket: "W01", value: 5 },
      { domain_bucket: "2024-01", subdomain_bucket: "W01", value: 3 },
      { domain_bucket: "2024-02", subdomain_bucket: "W01", value: 8 },
    ];
    const result = gapFillCalendar(input);
    expect(result.domainKeys).toEqual(["2024-01", "2024-02", "2024-03"]);
  });

  it("sorts subdomain keys ascending (matching buildCalendarSql ORDER BY)", () => {
    const input = [
      { domain_bucket: "2024", subdomain_bucket: "2024-12", value: 5 },
      { domain_bucket: "2024", subdomain_bucket: "2024-01", value: 3 },
      { domain_bucket: "2024", subdomain_bucket: "2024-06", value: 8 },
    ];
    const result = gapFillCalendar(input);
    expect(result.subdomainKeys).toEqual(["2024-01", "2024-06", "2024-12"]);
  });

  it("each cell carries its source coordinates (domainKey, subdomainKey)", () => {
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: 42 },
    ];
    const result = gapFillCalendar(input);
    const cell = result.rows[0].cells[0];
    expect(cell.domainKey).toBe("D1");
    expect(cell.subdomainKey).toBe("S1");
  });

  it("cellAt helper returns correct value for a populated cell", () => {
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: 99 },
      { domain_bucket: "D1", subdomain_bucket: "S2", value: null },
    ];
    const result = gapFillCalendar(input);
    expect(result.cellAt("D1", "S1")).toBe(99);
  });

  it("cellAt helper returns null for a gap cell", () => {
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: 10 },
      { domain_bucket: "D2", subdomain_bucket: "S2", value: 20 },
    ];
    const result = gapFillCalendar(input);
    expect(result.cellAt("D1", "S2")).toBeNull();
    expect(result.cellAt("D2", "S1")).toBeNull();
  });

  it("handles single domain, single subdomain — trivial 1×1 grid", () => {
    const input = [{ domain_bucket: "2024", subdomain_bucket: "2024-01", value: 7 }];
    const result = gapFillCalendar(input);
    expect(result.domainKeys).toEqual(["2024"]);
    expect(result.subdomainKeys).toEqual(["2024-01"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cells).toHaveLength(1);
    expect(result.rows[0].cells[0].value).toBe(7);
  });

  it("handles value: null in input (explicitly empty bucket from query)", () => {
    const input = [
      { domain_bucket: "D1", subdomain_bucket: "S1", value: null },
    ];
    const result = gapFillCalendar(input);
    expect(result.rows[0].cells[0].value).toBeNull();
  });
});

// Type-level sanity: ensure CalendarCell and CalendarRow are exported
describe("CalendarCell and CalendarRow type exports", () => {
  it("CalendarCell has domainKey, subdomainKey, value", () => {
    const cell: CalendarCell = { domainKey: "D1", subdomainKey: "S1", value: 5 };
    expect(cell.domainKey).toBe("D1");
    expect(cell.subdomainKey).toBe("S1");
    expect(cell.value).toBe(5);
  });

  it("CalendarRow has domainKey and cells array", () => {
    const row: CalendarRow = {
      domainKey: "D1",
      cells: [{ domainKey: "D1", subdomainKey: "S1", value: null }],
    };
    expect(row.domainKey).toBe("D1");
    expect(row.cells).toHaveLength(1);
  });
});
