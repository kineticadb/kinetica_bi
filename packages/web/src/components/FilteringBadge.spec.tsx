import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilteringBadge } from "./FilteringBadge";
import { useFilterViewStore } from "../store/filterViewStore";

describe("FilteringBadge", () => {
  it("returns null when tableId is undefined", () => {
    const { container } = render(<FilteringBadge tableId={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when no entry exists for the tableId", () => {
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when entry exists but materializing=false", () => {
    useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 9999999 }, 100);
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Filtering...' text when materializing=true", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    render(<FilteringBadge tableId={1} />);
    expect(screen.getByText("Filtering...")).toBeInTheDocument();
  });

  it("renders the spinner glyph (widget-filtering-spinner class) when materializing", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.querySelector(".widget-filtering-spinner")).not.toBeNull();
  });

  it("uses the .widget-filtering-badge class on the outer span", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.querySelector(".widget-filtering-badge")).not.toBeNull();
  });

  it("spinner has aria-hidden=true (a11y — don't double-announce 'Filtering...')", () => {
    useFilterViewStore.getState().markMaterializing(1, 100);
    const { container } = render(<FilteringBadge tableId={1} />);
    const spinner = container.querySelector(".widget-filtering-spinner");
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  });

  it("scoped selector — mutating views[2] does NOT cause widget for tableId=1 to re-render with badge", () => {
    // tableId=1 absent; render badge for it
    const { container } = render(<FilteringBadge tableId={1} />);
    expect(container.firstChild).toBeNull();
    // Mutate a DIFFERENT tableId
    useFilterViewStore.getState().markMaterializing(2, 200);
    // tableId=1's badge still null
    expect(container.firstChild).toBeNull();
  });
});
