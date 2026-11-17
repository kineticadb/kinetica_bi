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
import { describe, it, expect, vi, afterEach } from "vitest";
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

describe("FilterChip AI tag (138 D-14)", () => {
  it("CHIPAI-5: topbar without aiApplied is byte-identical to aiApplied=false and has no badge", () => {
    const base = { variant: "topbar" as const, text: "a = 1", removeAriaLabel: "rm", onRemove: vi.fn() };
    const a = render(<FilterChip {...base} />);
    const htmlA = a.container.innerHTML;
    a.unmount();
    const b = render(<FilterChip {...base} aiApplied={false} />);
    expect(b.container.innerHTML).toBe(htmlA);
    expect(b.container.querySelector(".widget-filter-badge")).toBeNull();
  });

  it("CHIPAI-6: topbar aiApplied renders one AI tag between text and dismiss", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <FilterChip variant="topbar" text="a = 1" removeAriaLabel="rm" onRemove={onRemove} aiApplied />
    );
    const badges = container.querySelectorAll(".filter-bar-chip .widget-filter-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("AI");
    expect(badges[0].getAttribute("title")).toBe("Applied by the AI assistant");
    expect(badges[0].nextElementSibling?.className).toBe("filter-bar-chip-dismiss");
    fireEvent.click(screen.getByRole("button", { name: "rm" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("CHIPAI-7: panel aiApplied shows tag + fallback provenance; explicit provenance wins", () => {
    const base = { variant: "panel" as const, text: "a = 1", removeAriaLabel: "rm", onRemove: vi.fn(), aiApplied: true };
    const a = render(<FilterChip {...base} />);
    expect(a.container.querySelectorAll(".filter-panel-chip-row .widget-filter-badge")).toHaveLength(1);
    expect(a.container.querySelector(".filter-panel-chip-provenance")?.textContent).toBe("from AI assistant");
    a.unmount();
    const b = render(<FilterChip {...base} provenance="from Fares" />);
    expect(b.container.querySelector(".filter-panel-chip-provenance")?.textContent).toBe("from Fares");
    expect(b.container.querySelectorAll(".widget-filter-badge")).toHaveLength(1);
  });

  // Quick 261117-hls: the on-canvas highlight must never outlive the hover / keyboard focus that
  // started it ("stuck" purple outlines).
  describe("highlight never gets stuck (HLS)", () => {
    const origMatches = Element.prototype.matches;
    let focusVisible = false;
    const setup = () => {
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, sel: string) {
        return sel === ":focus-visible" ? focusVisible : origMatches.call(this, sel);
      });
      const state = { on: false };
      const r = render(
        <FilterChip variant="panel" text="payment_type = 'Credit'" removeAriaLabel="Remove filter" onRemove={vi.fn()}
          appliesTo={[{ widgetId: 1, widgetTitle: "Sales" }]} onHighlight={() => { state.on = true; }} onClearHighlight={() => { state.on = false; }} />,
      );
      const chip = document.querySelector(".filter-panel-chip")!;
      const applies = screen.getByText(/applies to 1 widgets/);
      const chevron = screen.getByLabelText("Expand applies-to list");
      return { state, r, chip, applies, chevron };
    };
    afterEach(() => { vi.restoreAllMocks(); focusVisible = false; });

    it("HLS-1 a mouse-clicked button that regains focus (returning to the tab) does not re-highlight", () => {
      const { state, chip, applies } = setup();
      fireEvent.mouseEnter(chip);
      fireEvent.focus(applies);            // click → focus (not :focus-visible)
      fireEvent.mouseLeave(chip);
      expect(state.on).toBe(false);
      fireEvent.blur(applies);             // switch tab away …
      fireEvent.focus(applies);            // … and back: the browser re-focuses the button
      expect(state.on).toBe(false);
    });

    it("HLS-2 removing the chip while it is hovered clears the highlight", () => {
      const { state, chip, r } = setup();
      fireEvent.mouseEnter(chip);
      expect(state.on).toBe(true);
      r.unmount();
      expect(state.on).toBe(false);
    });

    it("HLS-3 keyboard focus still highlights, and leaving the chip clears it", () => {
      focusVisible = true;
      const { state, applies } = setup();
      fireEvent.focus(applies);
      expect(state.on).toBe(true);
      fireEvent.blur(applies, { relatedTarget: document.body });
      expect(state.on).toBe(false);
    });

    it("HLS-4 focus moving inside the chip, or blurring while still hovered, keeps the highlight", () => {
      focusVisible = true;
      const { state, chip, applies, chevron } = setup();
      fireEvent.focus(applies);
      fireEvent.blur(applies, { relatedTarget: chevron });
      fireEvent.focus(chevron);
      expect(state.on).toBe(true);
      fireEvent.mouseEnter(chip);
      fireEvent.blur(chevron, { relatedTarget: document.body });
      expect(state.on).toBe(true);       // the mouse is still over it
      fireEvent.mouseLeave(chip);
      expect(state.on).toBe(false);
    });
  });
});
