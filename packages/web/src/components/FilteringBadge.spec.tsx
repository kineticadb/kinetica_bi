import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilteringBadge } from "./FilteringBadge";
import { useFilterCombinationStore } from "../store/filterCombinationStore";

// Phase 96-01 GAP fix: FilteringBadge now reads filterCombinationStore (table-combo materializing
// by sourceId) instead of the legacy filterViewStore. Seed combo entries accordingly.
const seedMaterializing = (tableId: number) =>
  useFilterCombinationStore.getState().markMaterializing(`table:${tableId}:seed`, 100, "table", tableId);
const seedResolved = (tableId: number) =>
  useFilterCombinationStore.getState().setEntry(`table:${tableId}:seed`, {
    viewName: `_kbi_filt_v${tableId}`,
    expiresAt: 9999999,
    materializing: false,
    materializeVersion: 0,
    refCount: 1,
    dashboardId: 100,
    sourceType: "table",
    sourceId: tableId,
  });

describe("FilteringBadge", () => {
  beforeEach(() => {
    useFilterCombinationStore.getState().reset();
  });

  it("returns null when tableId is undefined", () => {
    const { container } = render(<FilteringBadge tableId={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when no entry exists for the tableId", () => {
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when entry exists but materializing=false", () => {
    seedResolved(1);
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Filtering...' text when a table-combo for the tableId is materializing", () => {
    seedMaterializing(1);
    render(<FilteringBadge tableId={1} />);
    expect(screen.getByText("Filtering...")).toBeInTheDocument();
  });

  it("renders the spinner glyph (widget-filtering-spinner class) when materializing", () => {
    seedMaterializing(1);
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.querySelector(".widget-filtering-spinner")).not.toBeNull();
  });

  it("uses the .widget-filtering-badge class on the outer span", () => {
    seedMaterializing(1);
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.querySelector(".widget-filtering-badge")).not.toBeNull();
  });

  it("spinner has aria-hidden=true (a11y — don't double-announce 'Filtering...')", () => {
    seedMaterializing(1);
    const { container } = render(<FilteringBadge tableId={1} />);
    const spinner = container.querySelector(".widget-filtering-spinner");
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  });

  it("scoped by sourceId — a materializing combo for table 2 does NOT show the badge for table 1", () => {
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.firstChild).toBeNull();
    seedMaterializing(2);
    expect(container.firstChild).toBeNull();
  });
});
