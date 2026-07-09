/**
 * Phase 107 Plan 01 (FPANEL-V120-09): FilterChip spec.
 *
 * Coverage:
 *   1. variant="topbar" renders an outer element with className EXACTLY
 *      "filter-bar-chip", containing the text + a dismiss button with the
 *      supplied aria-label and class "filter-bar-chip-dismiss".
 *   2. Clicking the dismiss button calls onRemove exactly once.
 *   3. variant="topbar" ignores a passed `provenance` prop (parity).
 *   4. variant="panel" renders `.filter-panel-chip` / `.filter-panel-chip-value`
 *      (with title=full text) / `.filter-panel-chip-provenance`.
 *   5. variant="panel" without provenance renders no provenance element.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FilterChip } from "./FilterChip";

describe("FilterChip", () => {
  it("variant=topbar renders exact .filter-bar-chip outer element with text + dismiss button", () => {
    const onRemove = vi.fn();
    render(
      <FilterChip
        variant="topbar"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={onRemove}
      />
    );
    const chip = screen.getByText("region = West").closest("span");
    expect(chip).not.toBeNull();
    expect(chip!.className).toBe("filter-bar-chip");
    const dismiss = screen.getByRole("button", { name: "Remove filter region" });
    expect(dismiss.className).toBe("filter-bar-chip-dismiss");
  });

  it("clicking the dismiss button calls onRemove exactly once", () => {
    const onRemove = vi.fn();
    render(
      <FilterChip
        variant="topbar"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={onRemove}
      />
    );
    const dismiss = screen.getByRole("button", { name: "Remove filter region" });
    dismiss.click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("variant=topbar does not render a provenance prop (parity)", () => {
    render(
      <FilterChip
        variant="topbar"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        provenance="from X"
      />
    );
    expect(screen.queryByText("from X")).toBeNull();
  });

  it("variant=panel renders .filter-panel-chip shell + value (with title) + provenance", () => {
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        provenance="from Sales map"
      />
    );
    const value = screen.getByText("region = West");
    expect(value.className).toBe("filter-panel-chip-value");
    expect(value.getAttribute("title")).toBe("region = West");
    const outer = value.closest(".filter-panel-chip");
    expect(outer).not.toBeNull();
    const provenance = screen.getByText("from Sales map");
    expect(provenance.className).toBe("filter-panel-chip-provenance");
  });

  it("variant=panel without provenance renders no provenance element", () => {
    const { container } = render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
      />
    );
    expect(container.querySelector(".filter-panel-chip-provenance")).toBeNull();
  });
});
