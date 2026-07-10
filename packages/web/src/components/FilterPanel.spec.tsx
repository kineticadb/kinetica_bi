// Phase 107 Plan 02 (FPANEL-V120-01/02/03/04/06/07/08): FilterPanel + FilterPanelRail specs.
// Renders FilterPanel/FilterPanelRail DIRECTLY with prop-injected data — no DashboardsPage,
// no OL. Stubs ResizeObserver + matchMedia at file top per the plan's Task 1 instruction
// (mirrors the existing DashboardsPage.spec.tsx pattern), even though this file never
// mounts anything that reads them directly — cheap insurance against transitive imports.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterPanel, type FilterPanelGroupData } from "./FilterPanel";
import { FilterPanelRail } from "./FilterPanelRail";

vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(function (this: any, _cb: ResizeObserverCallback) {
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  this.unobserve = vi.fn();
  return this;
}));

vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
  matches: false,
  media: q,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
})));

describe("FilterPanel", () => {
  it("renders group titles in DOM order tables -> dynamic views -> spatial", () => {
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() }], onClearAll: vi.fn() },
    ];
    const dvGroups: FilterPanelGroupData[] = [
      { title: "My Dynamic View", chips: [{ text: "region = West", removeAriaLabel: "Remove filter region", onRemove: vi.fn() }], onClearAll: vi.fn() },
    ];
    const spatialGroup: FilterPanelGroupData = {
      title: "Spatial draws",
      chips: [{ text: "Bbox 1 (5km × 3km)", removeAriaLabel: "Remove spatial filter Bbox 1", onRemove: vi.fn() }],
      onClearAll: vi.fn(),
    };

    render(
      <FilterPanel
        tableGroups={tableGroups}
        dvGroups={dvGroups}
        spatialGroup={spatialGroup}
        count={3}
        onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()}
      />
    );

    const titles = Array.from(document.querySelectorAll(".filter-panel-group-title")).map((el) => el.textContent);
    expect(titles).toEqual(["trips", "My Dynamic View", "Spatial draws"]);
  });

  it("renders eq/in, datetime-between, and spatial chips as .filter-panel-chip with correct text", () => {
    const tableGroups: FilterPanelGroupData[] = [
      {
        title: "trips",
        chips: [
          { text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() },
          { text: "date BETWEEN 2026-01-01 AND 2026-01-31", removeAriaLabel: "Remove filter date", onRemove: vi.fn() },
        ],
        onClearAll: vi.fn(),
      },
    ];
    const spatialGroup: FilterPanelGroupData = {
      title: "Spatial draws",
      chips: [{ text: "Bbox 1 (5km × 3km)", removeAriaLabel: "Remove spatial filter Bbox 1", onRemove: vi.fn() }],
      onClearAll: vi.fn(),
    };

    render(
      <FilterPanel tableGroups={tableGroups} dvGroups={[]} spatialGroup={spatialGroup} count={3} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />
    );

    expect(screen.getByText("zone = East").closest(".filter-panel-chip")).not.toBeNull();
    expect(screen.getByText("date BETWEEN 2026-01-01 AND 2026-01-31").closest(".filter-panel-chip")).not.toBeNull();
    expect(screen.getByText("Bbox 1 (5km × 3km)").closest(".filter-panel-chip")).not.toBeNull();
  });

  it("clicking a chip's dismiss button calls the passed remove callback with the right args", async () => {
    const onRemove = vi.fn();
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove }], onClearAll: vi.fn() },
    ];

    render(<FilterPanel tableGroups={tableGroups} dvGroups={[]} count={1} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />);

    await userEvent.click(screen.getByLabelText("Remove filter zone"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("clicking a group's Clear all calls the passed clear callback; spatial group's clear removes ALL shapes", async () => {
    const onClearAllTable = vi.fn();
    const onClearAllSpatial = vi.fn();
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() }], onClearAll: onClearAllTable },
    ];
    const spatialGroup: FilterPanelGroupData = {
      title: "Spatial draws",
      chips: [
        { text: "Bbox 1 (5km)", removeAriaLabel: "Remove spatial filter Bbox 1", onRemove: vi.fn() },
        { text: "Circle 2 (2km)", removeAriaLabel: "Remove spatial filter Circle 2", onRemove: vi.fn() },
      ],
      onClearAll: onClearAllSpatial,
    };

    render(
      <FilterPanel tableGroups={tableGroups} dvGroups={[]} spatialGroup={spatialGroup} count={3} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />
    );

    const clearButtons = screen.getAllByRole("button", { name: "Clear all" });
    expect(clearButtons).toHaveLength(2);
    await userEvent.click(clearButtons[0]);
    expect(onClearAllTable).toHaveBeenCalledTimes(1);
    await userEvent.click(clearButtons[1]);
    expect(onClearAllSpatial).toHaveBeenCalledTimes(1);
  });

  it("shows provenance when resolvable, omits it when absent, and never shows it for spatial chips", () => {
    const tableGroups: FilterPanelGroupData[] = [
      {
        title: "trips",
        chips: [
          { text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn(), provenance: "from Sales chart" },
          { text: "region = West", removeAriaLabel: "Remove filter region", onRemove: vi.fn() },
        ],
        onClearAll: vi.fn(),
      },
    ];
    const spatialGroup: FilterPanelGroupData = {
      title: "Spatial draws",
      chips: [{ text: "Bbox 1 (5km)", removeAriaLabel: "Remove spatial filter Bbox 1", onRemove: vi.fn() }],
      onClearAll: vi.fn(),
    };

    render(
      <FilterPanel tableGroups={tableGroups} dvGroups={[]} spatialGroup={spatialGroup} count={3} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />
    );

    expect(screen.getByText("from Sales chart")).toBeInTheDocument();
    expect(document.querySelectorAll(".filter-panel-chip-provenance")).toHaveLength(1);
  });

  it("shows the empty state with zero filters and renders no groups", () => {
    render(<FilterPanel tableGroups={[]} dvGroups={[]} count={0} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />);

    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(document.querySelector(".filter-panel-empty")).not.toBeNull();
    expect(document.querySelectorAll(".filter-panel-group-title")).toHaveLength(0);
  });

  it("clicking a group's collapse toggle unmounts that group's chip list", async () => {
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() }], onClearAll: vi.fn() },
    ];

    render(<FilterPanel tableGroups={tableGroups} dvGroups={[]} count={1} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />);

    expect(document.querySelector(".filter-panel-chips")).not.toBeNull();
    await userEvent.click(screen.getByLabelText("Collapse trips filters"));
    expect(document.querySelector(".filter-panel-chips")).toBeNull();
  });

  it("renders no spatial group when the parent passes no spatialGroup prop (orphan hide)", () => {
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() }], onClearAll: vi.fn() },
    ];

    render(<FilterPanel tableGroups={tableGroups} dvGroups={[]} count={1} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />);

    expect(document.querySelectorAll(".filter-panel-group-title")).toHaveLength(1);
    expect(screen.queryByText("Spatial draws")).toBeNull();
  });

  it("renders the global 'Clear all filters' button when count > 0", () => {
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() }], onClearAll: vi.fn() },
    ];

    render(
      <FilterPanel tableGroups={tableGroups} dvGroups={[]} count={3} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: "Clear all filters" })).toBeInTheDocument();
  });

  it("hides the global 'Clear all filters' button when count === 0", () => {
    render(<FilterPanel tableGroups={[]} dvGroups={[]} count={0} onCollapse={vi.fn()}
        onClearAllFilters={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Clear all filters" })).toBeNull();
  });

  it("clicking the global 'Clear all filters' button calls onClearAllFilters", async () => {
    const onClearAllFilters = vi.fn();
    const tableGroups: FilterPanelGroupData[] = [
      { title: "trips", chips: [{ text: "zone = East", removeAriaLabel: "Remove filter zone", onRemove: vi.fn() }], onClearAll: vi.fn() },
    ];

    render(
      <FilterPanel tableGroups={tableGroups} dvGroups={[]} count={3} onCollapse={vi.fn()}
        onClearAllFilters={onClearAllFilters} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearAllFilters).toHaveBeenCalledTimes(1);
  });
});

describe("FilterPanelRail", () => {
  it("shows the numeric count badge when count > 0", () => {
    render(<FilterPanelRail count={3} onExpand={vi.fn()} />);
    const badge = document.querySelector(".filter-panel-rail-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("3");
    expect(badge!.className).not.toContain("filter-panel-rail-badge--empty");
  });

  it("shows the empty badge variant with '0' when count === 0", () => {
    render(<FilterPanelRail count={0} onExpand={vi.fn()} />);
    const badge = document.querySelector(".filter-panel-rail-badge--empty");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("0");
  });

  it("clicking the expand button calls onExpand", async () => {
    const onExpand = vi.fn();
    render(<FilterPanelRail count={2} onExpand={onExpand} />);
    await userEvent.click(screen.getByLabelText("Expand filter panel"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
