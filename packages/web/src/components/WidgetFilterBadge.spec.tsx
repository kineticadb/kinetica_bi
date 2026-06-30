import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { FilterScopeSummary } from "../lib/useFilterScopeSummary";
import type { ActiveFilter } from "../store/filterStore";

// ─── Mock useFilterScopeSummary ───────────────────────────────────────────────
// Isolates WidgetFilterBadge from store wiring; inject crafted summaries directly.

vi.mock("../lib/useFilterScopeSummary", () => ({
  useFilterScopeSummary: vi.fn(),
}));

import { useFilterScopeSummary } from "../lib/useFilterScopeSummary";
import { WidgetFilterBadge } from "./WidgetFilterBadge";

const mockUseFilterScopeSummary = useFilterScopeSummary as ReturnType<typeof vi.fn>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mkFilter(column: string, sourceWidgetId?: number): ActiveFilter {
  return { column, value: "x", dataType: "string", sourceWidgetId, addedAt: 0 };
}

function summaryAllApplied(n = 3): FilterScopeSummary {
  return {
    appliedCount: n,
    totalCount: n,
    applied: { filters: [], shapes: [] },
    ignored: [],
    fellBack: false,
  };
}

function summaryWithIgnored(applied: number, total: number): FilterScopeSummary {
  const f1 = mkFilter("region", 7);
  const f2 = mkFilter("status", 42); // excluded
  return {
    appliedCount: applied,
    totalCount: total,
    applied: { filters: [f1], shapes: [] },
    ignored: [{ kind: "filter", filter: f2, reason: "source excluded" }],
    fellBack: false,
  };
}

function summaryFellBack(applied: number, total: number): FilterScopeSummary {
  return { ...summaryWithIgnored(applied, total), fellBack: true };
}

const defaultProps = {
  cfg: undefined,
  tableId: 1,
  dynamicViewId: undefined,
  spatialCapable: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WidgetFilterBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // SC1: accept-all (3 of 3) → renders null
  it("renders null when appliedCount === totalCount (accept-all, 3 of 3)", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryAllApplied(3));
    const { container } = render(<WidgetFilterBadge {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  // SC1: accept-all (0 of 0) → renders null
  it("renders null when appliedCount === totalCount === 0 (no active filters)", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryAllApplied(0));
    const { container } = render(<WidgetFilterBadge {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  // SC2: 2 applied of 3 total → renders "2 of 3 filters"
  it("renders element with text '2 of 3 filters' when 2 applied of 3 total", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryWithIgnored(2, 3));
    render(<WidgetFilterBadge {...defaultProps} />);
    expect(screen.getByText("2 of 3 filters")).toBeInTheDocument();
  });

  // SC4: badge element carries className "widget-filter-badge"
  it("badge element has className 'widget-filter-badge'", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryWithIgnored(2, 3));
    render(<WidgetFilterBadge {...defaultProps} />);
    const badge = screen.getByText("2 of 3 filters");
    expect(badge).toHaveClass("widget-filter-badge");
  });

  // SC3: title attribute contains applied filter labels AND ignored filter label with "source excluded"
  it("badge title attribute contains applied filter columns and ignored filter 'source excluded' reason", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryWithIgnored(2, 3));
    render(<WidgetFilterBadge {...defaultProps} />);
    const badge = screen.getByText("2 of 3 filters");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("Applied:");
    expect(title).toContain("Ignored");
    expect(title).toContain("source excluded");
  });

  // Phase 96 UAT (ceiling fallback): fellBack=true → distinct "All filters (limit)" badge
  it("renders 'All filters (limit)' when the widget fell back to the all-filters view", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryFellBack(1, 3));
    render(<WidgetFilterBadge {...defaultProps} widgetId={5} />);
    const badge = screen.getByText("All filters (limit)");
    expect(badge).toHaveClass("widget-filter-badge");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("Combination limit reached");
    expect(title).toContain("showing all 3 filters");
  });

  // fellBack takes precedence over the normal "N of M" label
  it("fellBack badge is shown instead of the configured 'N of M' label", () => {
    mockUseFilterScopeSummary.mockReturnValue(summaryFellBack(1, 3));
    render(<WidgetFilterBadge {...defaultProps} widgetId={5} />);
    expect(screen.queryByText("1 of 3 filters")).toBeNull();
    expect(screen.getByText("All filters (limit)")).toBeInTheDocument();
  });

  // CSS-before-use guard: .widget-filter-badge must exist in global.css
  it("widget-filter-badge class exists in global.css before component uses it", () => {
    const globalCssPath = resolve(__dirname, "../styles/global.css");
    const globalCss = readFileSync(globalCssPath, "utf8");
    expect(globalCss).toContain(".widget-filter-badge");
  });
});

