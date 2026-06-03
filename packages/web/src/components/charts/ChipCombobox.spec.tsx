/**
 * Phase 22 (CONFIG-V14-03) — ChipCombobox spec
 *
 * Tests:
 *   C1:  renders ALL options as chip buttons with className info-popup-config-chip
 *   C2:  when selected === null, EVERY chip has the 'selected' className
 *   C3:  when selected === ["lat", "lon"] and options include "vendor_id", only lat/lon chips are selected
 *   C4:  clicking a selected chip in selected===null state fires onChange with allOptions except clicked
 *   C5:  clicking an unselected chip when selected===["lat"] fires onChange(["lat", clicked])
 *   C6:  clicking a selected chip when selected===["lat", "lon"] fires onChange with array minus that chip
 *   C7:  when disabled===true, every chip has aria-disabled="true" and disabled attribute; clicking does NOT call onChange
 *   C8:  chips render only option.value text (NOT typeLabel)
 *   C9:  container has aria-label={ariaLabel} when prop set; defaults to "Selectable chips" when absent
 *   C10: chip order in DOM matches options array order (caller sorts)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChipCombobox from "./ChipCombobox";

const sampleOptions = [
  { value: "lat" },
  { value: "lon" },
  { value: "vendor_id", typeLabel: "VARCHAR" },
];

describe("ChipCombobox", () => {
  let onChange: (next: string[] | null) => void;

  beforeEach(() => {
    onChange = vi.fn() as unknown as (next: string[] | null) => void;
  });

  it("C1: renders ALL options as chip buttons with className info-popup-config-chip", () => {
    render(
      <ChipCombobox options={sampleOptions} selected={null} onChange={onChange} />,
    );
    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(3);
    chips.forEach((chip) => {
      expect(chip.className).toContain("info-popup-config-chip");
    });
  });

  it("C2: when selected === null, EVERY chip has the selected className", () => {
    render(
      <ChipCombobox options={sampleOptions} selected={null} onChange={onChange} />,
    );
    const chips = screen.getAllByRole("button");
    chips.forEach((chip) => {
      expect(chip.className).toContain("selected");
    });
  });

  it("C3: when selected === [lat, lon], only lat and lon chips have selected className", () => {
    render(
      <ChipCombobox
        options={sampleOptions}
        selected={["lat", "lon"]}
        onChange={onChange}
      />,
    );
    const chips = screen.getAllByRole("button");
    const latChip = chips.find((c) => c.textContent === "lat")!;
    const lonChip = chips.find((c) => c.textContent === "lon")!;
    const vendorChip = chips.find((c) => c.textContent === "vendor_id")!;

    expect(latChip.className).toContain("selected");
    expect(lonChip.className).toContain("selected");
    expect(vendorChip.className).not.toContain("selected");
  });

  it("C4: clicking a selected chip in selected===null fires onChange with all options except clicked", () => {
    render(
      <ChipCombobox options={sampleOptions} selected={null} onChange={onChange} />,
    );
    const chips = screen.getAllByRole("button");
    const lonChip = chips.find((c) => c.textContent === "lon")!;
    fireEvent.click(lonChip);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["lat", "vendor_id"]);
  });

  it("C5: clicking an unselected chip when selected===lat fires onChange([lat, clicked])", () => {
    render(
      <ChipCombobox
        options={sampleOptions}
        selected={["lat"]}
        onChange={onChange}
      />,
    );
    const chips = screen.getAllByRole("button");
    const vendorChip = chips.find((c) => c.textContent === "vendor_id")!;
    fireEvent.click(vendorChip);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["lat", "vendor_id"]);
  });

  it("C6: clicking a selected chip when selected===[lat, lon] fires onChange with array minus that chip", () => {
    render(
      <ChipCombobox
        options={sampleOptions}
        selected={["lat", "lon"]}
        onChange={onChange}
      />,
    );
    const chips = screen.getAllByRole("button");
    const latChip = chips.find((c) => c.textContent === "lat")!;
    fireEvent.click(latChip);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["lon"]);
  });

  it("C7: when disabled===true, every chip has aria-disabled=true and disabled; click does NOT call onChange", () => {
    render(
      <ChipCombobox
        options={sampleOptions}
        selected={null}
        onChange={onChange}
        disabled={true}
      />,
    );
    const chips = screen.getAllByRole("button");
    chips.forEach((chip) => {
      expect(chip).toHaveAttribute("aria-disabled", "true");
      expect(chip).toBeDisabled();
    });
    fireEvent.click(chips[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("C8: chips render only option.value text (NOT typeLabel)", () => {
    render(
      <ChipCombobox options={sampleOptions} selected={null} onChange={onChange} />,
    );
    const chips = screen.getAllByRole("button");
    const vendorChip = chips.find((c) => c.textContent === "vendor_id")!;
    expect(vendorChip.textContent).toBe("vendor_id");
    expect(vendorChip.textContent).not.toContain("VARCHAR");
  });

  it("C9: container has aria-label when prop set; defaults to Selectable chips when absent", () => {
    const { rerender } = render(
      <ChipCombobox
        options={sampleOptions}
        selected={null}
        onChange={onChange}
        ariaLabel="Info popup columns"
      />,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("aria-label", "Info popup columns");

    rerender(
      <ChipCombobox options={sampleOptions} selected={null} onChange={onChange} />,
    );
    expect(screen.getByRole("group")).toHaveAttribute(
      "aria-label",
      "Selectable chips",
    );
  });

  it("C10: chip order in DOM matches options array order (caller sorts)", () => {
    render(
      <ChipCombobox options={sampleOptions} selected={null} onChange={onChange} />,
    );
    const chips = screen.getAllByRole("button");
    expect(chips[0].textContent).toBe("lat");
    expect(chips[1].textContent).toBe("lon");
    expect(chips[2].textContent).toBe("vendor_id");
  });
});
