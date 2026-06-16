// Phase 66 Plan 03 (CAL-V113-02): CalendarConfigPanel specs.
// Mirrors TimelineConfigPanel.spec.tsx layout. Uses @testing-library/react + vitest.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import CalendarConfigPanel, {
  DEFAULT_CALENDAR_CONFIG,
  type CalendarConfig,
} from "./CalendarConfigPanel";
import { CELL_LIMIT, VALID_DOMAIN_SUBDOMAIN } from "../../lib/calendarBin";

// Mock runSql so the cap probe is deterministic in tests.
vi.mock("../../api/client", () => ({
  runSql: vi.fn(),
}));

import { runSql } from "../../api/client";
const mockRunSql = runSql as Mock;

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const TABLES: NonNullable<Parameters<typeof CalendarConfigPanel>[0]["tables"]> = [
  {
    id: 1,
    name: "events",
    schema: "demo",
    columns: {
      ts: "timestamp",
      amt: "double",
      category: "varchar",
    },
  },
];

// DynamicViewRow shape from src/api/client.ts
const DYNAMIC_VIEWS: NonNullable<
  Parameters<typeof CalendarConfigPanel>[0]["dynamicViews"]
> = [
  {
    id: 7,
    dashboard_id: 99,
    source_table_id: 1, // events table
    name: "events_dv",
    template_sql: "SELECT * FROM demo.events",
    max_records: 1000,
    columns_json: [
      { name: "ts", type: "timestamp" },
      { name: "amt", type: "double" },
    ] as unknown as null, // typed as null in DynamicViewRow but runtime is array
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

/* ------------------------------------------------------------------ */
/*  runSql response envelope                                           */
/*  Matches decodeSqlResponse shape: {column_headers, column_1, ...}  */
/* ------------------------------------------------------------------ */

/** Build a probe response where lo/hi are EPOCH SECONDS. */
function makeSqlResponse(lo: number, hi: number): unknown {
  return {
    column_headers: ["lo", "hi"],
    column_1: [lo],
    column_2: [hi],
  };
}

/* ------------------------------------------------------------------ */
/*  renderPanel helper                                                 */
/* ------------------------------------------------------------------ */

function renderPanel(
  initial: Partial<CalendarConfig> = {},
  opts?: {
    isValid?: (b: boolean) => void;
    dynamicViews?: typeof DYNAMIC_VIEWS;
  },
) {
  const onChange = vi.fn();
  const isValid = opts?.isValid ?? vi.fn();
  const dynamicViews = opts?.dynamicViews ?? DYNAMIC_VIEWS;
  const utils = render(
    <CalendarConfigPanel
      config={{ ...DEFAULT_CALENDAR_CONFIG, ...initial } as Record<string, unknown>}
      onChange={onChange}
      tables={TABLES}
      dynamicViews={dynamicViews}
      isValid={isValid}
    />,
  );
  return { onChange, isValid, ...utils };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("CalendarConfigPanel", () => {
  beforeEach(() => {
    // Default: return a very narrow range (2 days) — will NOT trigger cap.
    // lo = 0 epoch sec, hi = 2 days in seconds = 172800
    mockRunSql.mockResolvedValue(makeSqlResponse(0, 172_800));
  });

  it("Test 1: renders data-source dropdown listing BOTH the table AND the dynamic view", () => {
    renderPanel({});
    const select = screen.getByLabelText("Data source");
    expect(select).toBeInTheDocument();
    // Table option
    expect(screen.getByText("demo.events")).toBeInTheDocument();
    // DV option
    expect(screen.getByText("events_dv")).toBeInTheDocument();
  });

  it("Test 2: selecting the dynamic view calls onChange with dynamicViewId:7, tableId:1, tableRef:'demo.events'", () => {
    const { onChange } = renderPanel({});
    fireEvent.change(screen.getByLabelText("Data source"), {
      target: { value: "dv:7" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        dynamicViewId: 7,
        tableId: 1,
        tableRef: "demo.events",
      }),
    );
  });

  it("Test 3: selecting a table after a dv selection clears dynamicViewId (undefined)", () => {
    // Start with a dv binding already set.
    const { onChange } = renderPanel({ dynamicViewId: 7, tableId: 1, tableRef: "demo.events" });
    fireEvent.change(screen.getByLabelText("Data source"), {
      target: { value: "demo.events" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 1,
        tableRef: "demo.events",
        dynamicViewId: undefined,
      }),
    );
  });

  it("Test 4: timestamp dropdown lists only datetime columns (ts present; amt/category absent)", () => {
    renderPanel({ tableId: 1, tableRef: "demo.events" });
    const sel = screen.getByLabelText("Timestamp column") as HTMLSelectElement;
    const opts = Array.from(sel.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toContain("ts");
    expect(opts).not.toContain("amt");
    expect(opts).not.toContain("category");
  });

  it("Test 5: metric column dropdown includes the * option and numeric columns (amt); aggregation includes COUNT", () => {
    renderPanel({ tableId: 1, tableRef: "demo.events" });

    const metricSel = screen.getByLabelText("Metric column") as HTMLSelectElement;
    const metricOpts = Array.from(metricSel.querySelectorAll("option")).map((o) => o.value);
    expect(metricOpts).toContain("*");
    expect(metricOpts).toContain("amt");
    // varchar (category) is not numeric → excluded
    expect(metricOpts).not.toContain("category");

    const aggSel = screen.getByLabelText("Aggregation") as HTMLSelectElement;
    const aggOpts = Array.from(aggSel.querySelectorAll("option")).map((o) => o.value);
    expect(aggOpts).toContain("COUNT");
  });

  it("Test 6: domain=week shows ONLY day+hour in subdomain; month and week NOT present as subdomain options", () => {
    renderPanel({
      tableId: 1,
      tableRef: "demo.events",
      domain: "week",
      subdomain: "day",
    });

    const subSel = screen.getByLabelText("Subdomain") as HTMLSelectElement;
    const subOpts = Array.from(subSel.querySelectorAll("option")).map((o) => o.value);

    // VALID_DOMAIN_SUBDOMAIN.week = ["day", "hour"]
    expect(subOpts).toEqual(expect.arrayContaining(["day", "hour"]));
    expect(VALID_DOMAIN_SUBDOMAIN.week).toContain("day");
    expect(VALID_DOMAIN_SUBDOMAIN.week).toContain("hour");
    // month and week are NOT valid subdomains for domain=week
    expect(subOpts).not.toContain("month");
    expect(subOpts).not.toContain("week");
  });

  it("Test 7: changing domain to 'day' resets subdomain to 'hour' (VALID_DOMAIN_SUBDOMAIN.day[0])", () => {
    // Start with domain=month, subdomain=day (both valid for month).
    // Switching to domain=day makes subdomain=day invalid → should reset to hour.
    const { onChange } = renderPanel({
      tableId: 1,
      tableRef: "demo.events",
      domain: "month",
      subdomain: "day",
    });

    fireEvent.change(screen.getByLabelText("Domain"), {
      target: { value: "day" },
    });

    // VALID_DOMAIN_SUBDOMAIN.day = ["hour"]; "day" is not in it → reset to "hour"
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "day",
        subdomain: VALID_DOMAIN_SUBDOMAIN.day[0], // "hour"
      }),
    );
  });

  it("Test 8: defaults — domain=month, subdomain=day, aggregation=COUNT, palette=Greens selected", () => {
    renderPanel({
      tableId: 1,
      tableRef: "demo.events",
      timeCol: "ts",
    });

    expect((screen.getByLabelText("Domain") as HTMLSelectElement).value).toBe("month");
    expect((screen.getByLabelText("Subdomain") as HTMLSelectElement).value).toBe("day");
    expect((screen.getByLabelText("Aggregation") as HTMLSelectElement).value).toBe("COUNT");
    expect((screen.getByLabelText("Color palette") as HTMLSelectElement).value).toBe("Greens");
  });

  it("Test 9 (CAP BLOCK): probe returns wide range → isValid(false) + 'exceeds' message visible", async () => {
    // lo=0, hi=1.5e9 seconds (~47 years). With subdomain=hour:
    //   rangeMs = (1.5e9 - 0) * 1000 = 1.5e12 ms
    //   SUBDOMAIN_GRANULARITY_MS.hour = 3_600_000
    //   estimate = ceil(1.5e12 / 3_600_000) = 416_667 >> CELL_LIMIT (10000)
    mockRunSql.mockResolvedValue(makeSqlResponse(0, 1_500_000_000));

    const isValid = vi.fn();
    renderPanel(
      {
        tableId: 1,
        tableRef: "demo.events",
        timeCol: "ts",
        domain: "year",
        subdomain: "hour",
      },
      { isValid },
    );

    // Wait for the probe to complete and the "exceeds" message to appear.
    await screen.findByText(/exceeds/i);
    expect(isValid).toHaveBeenCalledWith(false);
    // CELL_LIMIT reference should appear in the message
    expect(screen.getByText(/exceeds/i).textContent).toContain(
      CELL_LIMIT.toLocaleString(),
    );
  });

  it("Test 10 (CAP OK): narrow range → isValid eventually called with true (no cap message)", async () => {
    // lo=0, hi=172800 (2 days in seconds). With domain=month/subdomain=day:
    //   rangeMs = 172800 * 1000 = 172_800_000 ms
    //   estimate = ceil(172_800_000 / 86_400_000) = 2 << CELL_LIMIT
    mockRunSql.mockResolvedValue(makeSqlResponse(0, 172_800));

    const isValid = vi.fn();
    renderPanel(
      {
        tableId: 1,
        tableRef: "demo.events",
        timeCol: "ts",
        domain: "month",
        subdomain: "day",
      },
      { isValid },
    );

    await waitFor(() => {
      expect(isValid).toHaveBeenCalledWith(true);
    });
    expect(screen.queryByText(/exceeds/i)).not.toBeInTheDocument();
  });

  it("Test 11 (INVALID COMBO defense-in-depth): domain=day + subdomain=year → isValid(false)", () => {
    // domain=day only allows subdomain=hour. Rendering with subdomain=year is
    // impossible through the UI (invalid options are hidden), but we test the
    // defense-in-depth isValidCombo guard directly.
    const isValid = vi.fn();
    renderPanel(
      {
        tableId: 1,
        tableRef: "demo.events",
        timeCol: "ts",
        domain: "day",
        subdomain: "year" as unknown as "hour", // force impossible combo
      },
      { isValid },
    );

    expect(isValid).toHaveBeenCalledWith(false);
  });
});
