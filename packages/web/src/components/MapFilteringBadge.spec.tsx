/**
 * Phase 16 (MAP-V13-04): MapFilteringBadge spec.
 *
 * Asserts: any-of-N-tableIds materializing semantics; null-rendering when none materialize;
 * empty tableIds renders null.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const _filterViewState: {
  views: Record<number, {
    viewName: string;
    expiresAt: number;
    materializing: boolean;
    materializeVersion: number;
    dashboardId: number;
  }>;
} = { views: {} };

vi.mock("../store/filterViewStore", () => {
  const hook = (selector: (s: any) => any) => selector({ views: _filterViewState.views });
  (hook as any).getState = () => ({ views: _filterViewState.views });
  return { useFilterViewStore: hook };
});

import { MapFilteringBadge } from "./MapFilteringBadge";

const entry = (overrides: Partial<{ materializing: boolean }> = {}) => ({
  viewName: "_kbi_filt_u1_d1_tX_sabc",
  expiresAt: Date.now() + 60_000,
  materializing: false,
  materializeVersion: 1,
  dashboardId: 1,
  ...overrides,
});

describe("MapFilteringBadge — any-of-N-tableIds materializing", () => {
  beforeEach(() => {
    _filterViewState.views = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test M-A: renders nothing when no entries are materializing", () => {
    _filterViewState.views = {};
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test M-B: renders the badge when ANY of the tableIds has materializing=true", () => {
    _filterViewState.views = { 10: entry({ materializing: true }) };
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    const badge = container.querySelector(".widget-filtering-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("Filtering...");
  });

  it("Test M-C: renders the badge when one tableId materializes and another does not (any-of-N semantics)", () => {
    _filterViewState.views = {
      10: entry({ materializing: false }),
      11: entry({ materializing: true }),
    };
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    expect(container.querySelector(".widget-filtering-badge")).not.toBeNull();
  });

  it("Test M-D: renders nothing when tableIds is empty", () => {
    _filterViewState.views = { 10: entry({ materializing: true }) };
    const { container } = render(<MapFilteringBadge tableIds={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
