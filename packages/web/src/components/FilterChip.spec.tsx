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
 *
 * Phase 108 Plan 02 (FSCOPE-V120-01/02/03) additions — panel variant ONLY:
 *   6. appliesTo with 1 entry renders "applies to 1 widgets" + a chevron toggle
 *      (aria-expanded false initially).
 *   7. appliesTo=[] renders "applies to 0 widgets" and NO chevron/toggle.
 *   8. clicking the chevron expands -> one `.applies-to-row` per entry; a map
 *      entry with layerNames renders "title — layer1, layer2".
 *   9. mouseEnter/mouseLeave call onHighlight/onClearHighlight.
 *  10. clicking the "applies to" button calls onActivate; the dismiss button
 *      still calls onRemove and does NOT trigger onActivate (stopPropagation).
 *  11. clicking an expanded row calls onActivateWidget(entry.widgetId).
 *  12. topbar-variant assertions (above) stay green — no new prop is read there.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { FilterChip } from "./FilterChip";
import type { WidgetApplyEntry } from "../lib/computeReverseFilterMap";

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

describe("FilterChip panel variant — applies-to + hover/click (Phase 108 Plan 02)", () => {
  const oneEntry: WidgetApplyEntry[] = [{ widgetId: 1, widgetTitle: "Sales" }];
  const mapEntry: WidgetApplyEntry[] = [
    { widgetId: 2, widgetTitle: "Coverage Map", layerNames: ["Roads", "Rail"] },
  ];

  it("appliesTo with 1 entry renders 'applies to 1 widgets' + a chevron toggle (aria-expanded false)", () => {
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        appliesTo={oneEntry}
      />
    );
    expect(screen.getByText("applies to 1 widgets")).toBeInTheDocument();
    const toggle = screen.getByLabelText("Expand applies-to list");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("appliesTo=[] renders 'applies to 0 widgets' and NO chevron/toggle", () => {
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        appliesTo={[]}
      />
    );
    expect(screen.getByText("applies to 0 widgets")).toBeInTheDocument();
    expect(screen.queryByLabelText("Expand applies-to list")).toBeNull();
    expect(screen.queryByLabelText("Collapse applies-to list")).toBeNull();
  });

  it("clicking the chevron expands -> renders one .applies-to-row per entry; map entry shows title — layers", async () => {
    const user = userEvent.setup();
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        appliesTo={mapEntry}
      />
    );
    expect(document.querySelector(".applies-to-row")).toBeNull();
    await user.click(screen.getByLabelText("Expand applies-to list"));
    const rows = document.querySelectorAll(".applies-to-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toBe("Coverage Map — Roads, Rail");
    expect(screen.getByLabelText("Collapse applies-to list")).toHaveAttribute("aria-expanded", "true");
  });

  it("mouseEnter calls onHighlight; mouseLeave calls onClearHighlight", () => {
    const onHighlight = vi.fn();
    const onClearHighlight = vi.fn();
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        appliesTo={oneEntry}
        onHighlight={onHighlight}
        onClearHighlight={onClearHighlight}
      />
    );
    const chip = document.querySelector(".filter-panel-chip")!;
    fireEvent.mouseEnter(chip);
    expect(onHighlight).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(chip);
    expect(onClearHighlight).toHaveBeenCalledTimes(1);
  });

  it("clicking the applies-to button calls onActivate; dismiss button calls onRemove and does NOT trigger onActivate", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onActivate = vi.fn();
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={onRemove}
        appliesTo={oneEntry}
        onActivate={onActivate}
      />
    );
    await user.click(screen.getByText("applies to 1 widgets"));
    expect(onActivate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Remove filter region" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1); // unchanged — dismiss never activates
  });

  it("clicking an expanded row calls onActivateWidget(entry.widgetId) with the correct id", async () => {
    const user = userEvent.setup();
    const onActivateWidget = vi.fn();
    render(
      <FilterChip
        variant="panel"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        appliesTo={mapEntry}
        onActivateWidget={onActivateWidget}
      />
    );
    await user.click(screen.getByLabelText("Expand applies-to list"));
    await user.click(screen.getByText("Coverage Map — Roads, Rail"));
    expect(onActivateWidget).toHaveBeenCalledWith(2);
  });

  it("parity: topbar variant renders no applies-to line and ignores hover/activate props", () => {
    const onHighlight = vi.fn();
    render(
      <FilterChip
        variant="topbar"
        text="region = West"
        removeAriaLabel="Remove filter region"
        onRemove={vi.fn()}
        appliesTo={oneEntry}
        onHighlight={onHighlight}
      />
    );
    expect(screen.queryByText(/applies to/)).toBeNull();
    const chip = screen.getByText("region = West").closest("span")!;
    fireEvent.mouseEnter(chip);
    expect(onHighlight).not.toHaveBeenCalled();
  });
});
