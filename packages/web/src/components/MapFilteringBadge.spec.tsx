/**
 * Phase 16 (MAP-V13-04): MapFilteringBadge spec.
 * Phase 96-01 GAP fix: migrated to read filterCombinationStore (table-combo materializing by
 * sourceId) instead of the legacy filterViewStore.
 *
 * Asserts: any-of-N-tableIds materializing semantics; null-rendering when none materialize;
 * empty tableIds renders null.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const _comboState: {
  registry: Record<string, {
    viewName: string;
    expiresAt: number;
    materializing: boolean;
    materializeVersion: number;
    refCount: number;
    dashboardId: number;
    sourceType: "table" | "dv";
    sourceId: number;
  }>;
} = { registry: {} };

vi.mock("../store/filterCombinationStore", () => {
  const hook = (selector: (s: any) => any) => selector({ registry: _comboState.registry });
  (hook as any).getState = () => ({ registry: _comboState.registry });
  return { useFilterCombinationStore: hook };
});

import { MapFilteringBadge } from "./MapFilteringBadge";

// Build a registry seeded with one table-combo entry per tableId.
const seed = (entries: Array<{ tableId: number; materializing: boolean }>) => {
  _comboState.registry = {};
  for (const { tableId, materializing } of entries) {
    _comboState.registry[`table:${tableId}:seed`] = {
      viewName: materializing ? "" : `_kbi_filt_t${tableId}_sabc`,
      expiresAt: Date.now() + 60_000,
      materializing,
      materializeVersion: 1,
      refCount: 1,
      dashboardId: 1,
      sourceType: "table",
      sourceId: tableId,
    };
  }
};

describe("MapFilteringBadge — any-of-N-tableIds materializing", () => {
  beforeEach(() => {
    _comboState.registry = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test M-A: renders nothing when no entries are materializing", () => {
    seed([{ tableId: 10, materializing: false }, { tableId: 11, materializing: false }]);
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test M-B: renders the badge when ANY of the tableIds has materializing=true", () => {
    seed([{ tableId: 10, materializing: true }]);
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    const badge = container.querySelector(".widget-filtering-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("Filtering...");
  });

  it("Test M-C: renders the badge when one tableId materializes and another does not (any-of-N semantics)", () => {
    seed([
      { tableId: 10, materializing: false },
      { tableId: 11, materializing: true },
    ]);
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    expect(container.querySelector(".widget-filtering-badge")).not.toBeNull();
  });

  it("Test M-D: renders nothing when tableIds is empty", () => {
    seed([{ tableId: 10, materializing: true }]);
    const { container } = render(<MapFilteringBadge tableIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test M-E: a materializing combo for a tableId NOT in the map's set does not show the badge", () => {
    seed([{ tableId: 99, materializing: true }]);
    const { container } = render(<MapFilteringBadge tableIds={[10, 11]} />);
    expect(container.firstChild).toBeNull();
  });
});
