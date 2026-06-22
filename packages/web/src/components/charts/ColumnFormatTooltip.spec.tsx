/**
 * Phase 77 Plan 02 (COLAPPLY-V115-02): ColumnFormatTooltip unit tests.
 *
 * Tests the shared custom Recharts Tooltip content component that:
 *   - Renders the category label via resolveLabel(tableId, groupByColumn)
 *   - Formats the numeric value via resolveFormatter(tableId, metricColumn)
 *   - Falls back to raw values when tableId is undefined or columns are empty
 *   - Returns null when active=false or payload is empty
 *   - Uses only theme tokens (no raw hex) — theme-guard lock
 *
 * Seeds the real columnDisplayConfigStore via upsertColumn (configVersion reactive tests)
 * or listColumnDisplayConfig spy (for loadConfig-seeded tests). Store auto-resets via
 * the zustand shim in src/test/setup.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ColumnFormatTooltip } from "./ColumnFormatTooltip";
import { useColumnDisplayConfigStore } from "../../store/columnDisplayConfigStore";
import type { FormatSpecNumber } from "../../lib/columnFormatter";

// Mock listColumnDisplayConfig so loadConfig (if called) never makes real HTTP calls.
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listColumnDisplayConfig: vi.fn().mockResolvedValue([]),
  };
});

const NUMBER_SPEC: FormatSpecNumber = {
  kind: "number",
  thousandsSep: true,
  decimals: 2,
  currency: "$",
  percent: false,
};

// Synthetic recharts payload entry
function makeEntry(value: unknown, name = "value", color = "var(--chart-1)") {
  return { name, value, color, payload: { category: "A", value } };
}

describe("ColumnFormatTooltip (COLAPPLY-V115-02)", () => {
  const TABLE_ID = 55;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Behavior 1: returns null when inactive or payload empty
  // ------------------------------------------------------------------
  it("returns null when active=false", () => {
    const { container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={false}
        payload={[makeEntry(100)]}
        label="A"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when payload is empty array", () => {
    const { container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={[]}
        label="A"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when payload is undefined", () => {
    const { container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={undefined}
        label="A"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ------------------------------------------------------------------
  // Behavior 2: renders resolved category label + raw value when no format spec
  // ------------------------------------------------------------------
  it("renders the resolved category label when tableId + groupByColumn are present", () => {
    // Seed a label for groupByColumn
    useColumnDisplayConfigStore
      .getState()
      .upsertColumn(TABLE_ID, "category", "Product Category", null);

    const { getByText } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={[makeEntry(42)]}
        label="Electronics"
      />,
    );

    // The resolved label "Product Category" should appear as a prefix
    expect(getByText(/Product Category/i)).toBeTruthy();
    // The category value (the recharts label) should appear
    expect(getByText(/Electronics/i)).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Behavior 3: formats numeric value via resolveFormatter
  // ------------------------------------------------------------------
  it("formats value via resolveFormatter when metricColumn has a format spec", () => {
    useColumnDisplayConfigStore
      .getState()
      .upsertColumn(TABLE_ID, "amount", null, NUMBER_SPEC);

    const { getByText } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={[makeEntry(1234.5)]}
        label="Widget"
      />,
    );

    // NUMBER_SPEC: prefix="$", useGrouping=true, decimalPlaces=2 → "$1,234.50"
    expect(getByText(/\$1,234\.50/)).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Behavior 4: falls back gracefully when tableId is undefined
  // ------------------------------------------------------------------
  it("falls back to raw value when tableId is undefined", () => {
    const { container } = render(
      <ColumnFormatTooltip
        tableId={undefined}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={[makeEntry(999)]}
        label="Raw"
      />,
    );

    // Should render (not null)
    expect(container.firstChild).not.toBeNull();
    // Raw value 999 should appear as-is
    expect(container.textContent).toContain("999");
  });

  it("falls back to raw value when groupByColumn is empty", () => {
    useColumnDisplayConfigStore
      .getState()
      .upsertColumn(TABLE_ID, "amount", null, NUMBER_SPEC);

    const { container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn=""
        metricColumn="amount"
        active={true}
        payload={[makeEntry(777)]}
        label="Fallback"
      />,
    );

    // Renders (not null), value still formatted via metricColumn
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain("$777.00");
  });

  it("falls back to raw value when metricColumn is empty", () => {
    useColumnDisplayConfigStore
      .getState()
      .upsertColumn(TABLE_ID, "category", "Cat Label", null);

    const { container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn=""
        active={true}
        payload={[makeEntry(42)]}
        label="Cat"
      />,
    );

    expect(container.firstChild).not.toBeNull();
    // Raw value 42 (no formatter applied)
    expect(container.textContent).toContain("42");
  });

  // ------------------------------------------------------------------
  // Behavior 5: multi-entry payload — each entry gets series name prefix
  // ------------------------------------------------------------------
  it("renders multiple payload entries with their name prefix", () => {
    useColumnDisplayConfigStore
      .getState()
      .upsertColumn(TABLE_ID, "amount", null, NUMBER_SPEC);

    const payload = [
      makeEntry(100, "Series A"),
      makeEntry(200, "Series B"),
    ];

    const { getByText } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={payload}
        label="Q1"
      />,
    );

    expect(getByText(/Series A/)).toBeTruthy();
    expect(getByText(/Series B/)).toBeTruthy();
    expect(getByText(/\$100\.00/)).toBeTruthy();
    expect(getByText(/\$200\.00/)).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Behavior 5b: single-series (pie) — value line uses the METRIC label,
  // not Recharts' per-entry name (which for a pie is the redundant category value).
  // ------------------------------------------------------------------
  it("single-series value line uses the metric label, not the redundant slice name", () => {
    // Label + currency format on the metric column "amount".
    useColumnDisplayConfigStore
      .getState()
      .upsertColumn(TABLE_ID, "amount", "Total Revenue", NUMBER_SPEC);

    // Pie payload: Recharts sets entry.name to the slice's CATEGORY value ("NYC")
    // and injects no `label`. The category comes from payload[0].payload[groupByColumn].
    const { getByText, container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="vendor_id"
        metricColumn="amount"
        active={true}
        payload={[
          {
            name: "NYC",
            value: 252191.85,
            color: "var(--chart-1)",
            payload: { vendor_id: "NYC", amount: 252191.85 },
          },
        ]}
      />,
    );

    // Value line shows the metric label + formatted value — NOT "NYC: $252,191.85".
    expect(getByText(/Total Revenue: \$252,191\.85/)).toBeTruthy();
    // "NYC" still appears once (on the category line), never as the value-line prefix.
    expect(container.textContent).not.toMatch(/NYC: \$252,191\.85/);
  });

  // ------------------------------------------------------------------
  // Behavior 6: no raw hex in rendered output (theme tokens only)
  // ------------------------------------------------------------------
  it("renders without inline raw hex color literals (uses theme tokens)", () => {
    const { container } = render(
      <ColumnFormatTooltip
        tableId={TABLE_ID}
        groupByColumn="category"
        metricColumn="amount"
        active={true}
        payload={[makeEntry(50)]}
        label="Test"
      />,
    );

    // Walk inline styles looking for hex
    const allElements = container.querySelectorAll<HTMLElement>("*");
    for (const el of Array.from(allElements)) {
      const style = el.getAttribute("style") ?? "";
      // Hex regex: #RGB or #RRGGBB bounded
      expect(style).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
    }
  });
});
