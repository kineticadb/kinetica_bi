/**
 * Phase 103: MultiSelectChips unit spec.
 *
 * Covers the `formatOption` prop — the only behaviour added when the component
 * was extracted from DataFilterRenderer.tsx.  All other behaviour is exercised
 * by DataFilterRenderer.spec.tsx (unchanged).
 */

import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelectChips } from "./MultiSelectChips";

describe("MultiSelectChips — formatOption", () => {
  it("renders capitalised labels in chips when formatOption is supplied", () => {
    render(
      <MultiSelectChips
        ariaLabel="Scales"
        options={["month", "week", "day"]}
        value={["month", "week"]}
        onChange={() => {}}
        formatOption={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
      />,
    );

    // Chips should display the formatted label ("Month", "Week"), not the raw value
    expect(screen.getByText("Month")).toBeInTheDocument();
    expect(screen.getByText("Week")).toBeInTheDocument();
  });

  it("renders capitalised labels in the popover option list when formatOption is supplied", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectChips
        ariaLabel="Scales"
        options={["month", "week", "day"]}
        value={["month"]}
        onChange={() => {}}
        formatOption={(s) => s.charAt(0).toUpperCase() + s.slice(1)}
      />,
    );

    // Open the popover
    const combobox = screen.getByRole("combobox", { name: "Scales" });
    await act(async () => { await user.click(combobox); });

    // Popover list should show formatted labels (Month also appears as a chip, so use getAllBy)
    expect(screen.getAllByText("Month").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Week").length).toBeGreaterThanOrEqual(1);
    // "Day" is only in the popover (not selected), so it's unique
    expect(screen.getByText("Day")).toBeInTheDocument();
  });

  it("omitting formatOption falls back to identity — raw option strings are shown", () => {
    render(
      <MultiSelectChips
        ariaLabel="Filters"
        options={["alpha", "beta"]}
        value={["alpha"]}
        onChange={() => {}}
      />,
    );

    // Without formatOption the raw value should appear in the chip
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
