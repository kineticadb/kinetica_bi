/**
 * FilterSelectionPanel spec — Phase 93 plan 01 + Phase 96 gap-closure (96-02)
 *
 * Tests cover:
 *  - Default (value=undefined): shows "Filter Scope" + unchecked Customize + accept-all hint; no checklist
 *  - Checking Customize (allowSpatial=true) fires onChange with ALL source ids + SPATIAL_DRAWS_SENTINEL (GAP 4)
 *  - Checking Customize (allowSpatial=false, dv-bound) fires onChange with only widget ids, NO sentinel (GAP 4+5)
 *  - allowSpatial=false hides the spatial draws row (GAP 5)
 *  - allowSpatial=true (default) shows the spatial draws row
 *  - Allowlist mode: checklist shows ONLY filter-producing widget types (not records/legend/map/etc.)
 *  - Spatial draws (map) sentinel row renders in allowlist mode when allowSpatial=true (default)
 *  - Checking/unchecking the spatial sentinel adds/removes SPATIAL_DRAWS_SENTINEL from the array
 *  - selfWidgetId excludes that widget from the list; sentinel is exempt from self-exclusion
 *  - Checking a source row fires onChange adding the id; unchecking removes it
 *  - Empty allowedSourceWidgetIds in allowlist mode shows accept-none warning
 *  - ONLY spatial sentinel selected: NO accept-none warning (a source IS selected)
 *  - Unchecking Customize fires onChange(undefined)
 *  - Orphan: numeric id not in widgets renders danger hint; string sentinel is NOT orphaned
 *  - accept-none warning fires when manually unchecking all sources (allowSpatial=false path)
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FilterSelectionPanel } from "./FilterSelectionPanel";
import { SPATIAL_DRAWS_SENTINEL } from "./filterSourceTypes";
import type { FilterSelectionConfig } from "../../types/filterSelection";
import type { WidgetDto } from "../../api/client";

// ──────────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeWidget(id: number, type: string, title = `Widget ${id}`): WidgetDto {
  return {
    id,
    dashboard_id: 1,
    title,
    type,
    position: id,
    config: {},
    created_at: "",
    updated_at: "",
  };
}

const MIXED_WIDGETS: WidgetDto[] = [
  makeWidget(1, "bar", "Revenue Bar"),
  makeWidget(2, "records", "Records Table"),
  makeWidget(3, "legend", "Map Legend"),
  makeWidget(4, "datafilter", "Global Filter"),
  makeWidget(5, "map", "Main Map"),
];

// ──────────────────────────────────────────────────────────────────────────────
// 1. Default (value = undefined) renders accept-all state
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — default (accept-all)", () => {
  it("renders 'Filter Scope' header", () => {
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    expect(screen.getByText("Filter Scope")).toBeTruthy();
  });

  it("renders an unchecked Customize checkbox", () => {
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    const checkbox = screen.getByRole("checkbox", { name: /customize/i });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("renders the accept-all hint", () => {
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    expect(screen.getByText(/accept all filters/i)).toBeTruthy();
  });

  it("does NOT render a checklist in default mode", () => {
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={vi.fn()}
        widgets={MIXED_WIDGETS}
      />
    );
    // No source checkboxes should appear
    const checkboxes = screen.getAllByRole("checkbox");
    // Only the Customize toggle
    expect(checkboxes).toHaveLength(1);
  });

  it("checking Customize (no widgets) fires onChange with sourceMode=allowlist; only sentinel in allowedSourceWidgetIds (default allowSpatial=true)", () => {
    const onChange = vi.fn();
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={onChange}
        widgets={[]}
      />
    );
    const checkbox = screen.getByRole("checkbox", { name: /customize/i });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.sourceMode).toBe("allowlist");
    // No widget sources, allowSpatial=true → only the sentinel
    expect(arg.allowedSourceWidgetIds).toContain(SPATIAL_DRAWS_SENTINEL);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Allowlist mode — source list filters to filter-producing types only
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — allowlist source filtering", () => {
  const allowlistValue: FilterSelectionConfig = {
    sourceMode: "allowlist",
    allowedSourceWidgetIds: [],
  };

  it("shows bar widget but NOT records, legend, or map", () => {
    render(
      <FilterSelectionPanel
        value={allowlistValue}
        onChange={vi.fn()}
        widgets={MIXED_WIDGETS}
      />
    );
    expect(screen.getByText(/Revenue Bar/)).toBeTruthy();
    expect(screen.getByText(/Global Filter/)).toBeTruthy();
    expect(screen.queryByText(/Records Table/)).toBeNull();
    expect(screen.queryByText(/Map Legend/)).toBeNull();
    expect(screen.queryByText(/Main Map/)).toBeNull();
  });

  it("Customize checkbox is CHECKED in allowlist mode", () => {
    render(
      <FilterSelectionPanel
        value={allowlistValue}
        onChange={vi.fn()}
        widgets={MIXED_WIDGETS}
      />
    );
    const customize = screen.getByRole("checkbox", { name: /customize/i });
    expect((customize as HTMLInputElement).checked).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Spatial draws sentinel
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — spatial draws sentinel", () => {
  const allowlistEmpty: FilterSelectionConfig = {
    sourceMode: "allowlist",
    allowedSourceWidgetIds: [],
  };

  it("renders 'Spatial draws (map)' row even when widgets list is EMPTY", () => {
    render(
      <FilterSelectionPanel
        value={allowlistEmpty}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    expect(screen.getByText(/spatial draws \(map\)/i)).toBeTruthy();
  });

  it("spatial draws row is unchecked when sentinel not in allowedSourceWidgetIds", () => {
    render(
      <FilterSelectionPanel
        value={allowlistEmpty}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    const sentinelCheckbox = screen.getByRole("checkbox", { name: /spatial draws/i });
    expect((sentinelCheckbox as HTMLInputElement).checked).toBe(false);
  });

  it("spatial draws row is CHECKED when sentinel is in allowedSourceWidgetIds", () => {
    const valueWithSentinel: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL as unknown as number],
    };
    render(
      <FilterSelectionPanel
        value={valueWithSentinel}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    const sentinelCheckbox = screen.getByRole("checkbox", { name: /spatial draws/i });
    expect((sentinelCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it("checking spatial draws row fires onChange with sentinel in allowedSourceWidgetIds", () => {
    const onChange = vi.fn();
    render(
      <FilterSelectionPanel
        value={allowlistEmpty}
        onChange={onChange}
        widgets={[]}
      />
    );
    const sentinelCheckbox = screen.getByRole("checkbox", { name: /spatial draws/i });
    fireEvent.click(sentinelCheckbox);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.allowedSourceWidgetIds).toContain(SPATIAL_DRAWS_SENTINEL);
  });

  it("unchecking spatial draws row removes sentinel from allowedSourceWidgetIds", () => {
    const onChange = vi.fn();
    const valueWithSentinel: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL as unknown as number],
    };
    render(
      <FilterSelectionPanel
        value={valueWithSentinel}
        onChange={onChange}
        widgets={[]}
      />
    );
    const sentinelCheckbox = screen.getByRole("checkbox", { name: /spatial draws/i });
    fireEvent.click(sentinelCheckbox);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.allowedSourceWidgetIds).not.toContain(SPATIAL_DRAWS_SENTINEL);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. selfWidgetId exclusion
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — selfWidgetId exclusion", () => {
  const allowlistEmpty: FilterSelectionConfig = {
    sourceMode: "allowlist",
    allowedSourceWidgetIds: [],
  };

  it("excludes the widget whose id === selfWidgetId from the source list", () => {
    render(
      <FilterSelectionPanel
        value={allowlistEmpty}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar", "Self Bar"), makeWidget(2, "bar", "Other Bar")]}
        selfWidgetId={1}
      />
    );
    expect(screen.queryByText(/Self Bar/)).toBeNull();
    expect(screen.getByText(/Other Bar/)).toBeTruthy();
  });

  it("spatial draws sentinel still renders when selfWidgetId is provided", () => {
    render(
      <FilterSelectionPanel
        value={allowlistEmpty}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar", "Self Bar")]}
        selfWidgetId={1}
      />
    );
    expect(screen.getByText(/spatial draws \(map\)/i)).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Checking / unchecking a source row
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — toggle source rows", () => {
  it("checking a source row adds its id to allowedSourceWidgetIds", () => {
    const onChange = vi.fn();
    const allowlistEmpty: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [],
    };
    render(
      <FilterSelectionPanel
        value={allowlistEmpty}
        onChange={onChange}
        widgets={[makeWidget(10, "bar", "Revenue Bar")]}
      />
    );
    const sourceCheckbox = screen.getByRole("checkbox", { name: /Revenue Bar/i });
    fireEvent.click(sourceCheckbox);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.allowedSourceWidgetIds).toContain(10);
  });

  it("unchecking a source row removes its id from allowedSourceWidgetIds", () => {
    const onChange = vi.fn();
    const allowlistWithBar: FilterSelectionConfig = {
      sourceMode: "allowlist",
      allowedSourceWidgetIds: [10],
    };
    render(
      <FilterSelectionPanel
        value={allowlistWithBar}
        onChange={onChange}
        widgets={[makeWidget(10, "bar", "Revenue Bar")]}
      />
    );
    const sourceCheckbox = screen.getByRole("checkbox", { name: /Revenue Bar/i });
    fireEvent.click(sourceCheckbox);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.allowedSourceWidgetIds).not.toContain(10);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Accept-none warning
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — accept-none warning", () => {
  it("shows accept-none warning when allowlist is empty (no sources selected)", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar")]}
      />
    );
    expect(screen.getByText(/no sources selected/i)).toBeTruthy();
  });

  it("does NOT show accept-none warning when ONLY spatial sentinel is checked", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL as unknown as number] }}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    expect(screen.queryByText(/no sources selected/i)).toBeNull();
  });

  it("does NOT show accept-none warning when a live widget is checked", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [1] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar")]}
      />
    );
    expect(screen.queryByText(/no sources selected/i)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Unchecking Customize reverts to accept-all (fires onChange(undefined))
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — uncheck Customize", () => {
  it("fires onChange(undefined) when Customize is unchecked", () => {
    const onChange = vi.fn();
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={onChange}
        widgets={[]}
      />
    );
    const checkbox = screen.getByRole("checkbox", { name: /customize/i });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Orphan handling
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — orphan handling", () => {
  it("renders a danger hint for a numeric id not present in widgets", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [999] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar")]}
      />
    );
    // Should show orphan warning containing the orphan id
    expect(screen.getByText(/deleted widget.*999|999.*deleted widget/i)).toBeTruthy();
  });

  it("does NOT render orphan warning for SPATIAL_DRAWS_SENTINEL (string)", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [SPATIAL_DRAWS_SENTINEL as unknown as number] }}
        onChange={vi.fn()}
        widgets={[]}
      />
    );
    expect(screen.queryByText(/deleted widget/i)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. Empty source list (all filter-producing widgets excluded by selfWidgetId or absent)
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — empty source list", () => {
  it("shows 'No filter-producing widgets' hint when all widgets are non-producing types", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "legend"), makeWidget(2, "map")]}
      />
    );
    expect(screen.getByText(/no filter-producing widgets/i)).toBeTruthy();
  });

  it("spatial draws sentinel still renders even when source list is empty", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "legend")]}
      />
    );
    expect(screen.getByText(/spatial draws \(map\)/i)).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. GAP 4 — Customize-on defaults to ALL-CHECKED (accept-all start state)
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — GAP 4: Customize-on pre-checks all sources", () => {
  it("enabling Customize pre-checks both sibling widget ids AND sentinel (allowSpatial=true default)", () => {
    const onChange = vi.fn();
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={onChange}
        widgets={[makeWidget(1, "bar", "Revenue Bar"), makeWidget(2, "datafilter", "Global Filter")]}
      />
    );
    const customize = screen.getByRole("checkbox", { name: /customize/i });
    fireEvent.click(customize);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.sourceMode).toBe("allowlist");
    // Both widget ids AND the sentinel pre-checked
    expect(arg.allowedSourceWidgetIds).toContain(1);
    expect(arg.allowedSourceWidgetIds).toContain(2);
    expect(arg.allowedSourceWidgetIds).toContain(SPATIAL_DRAWS_SENTINEL);
    // No accept-none warning rendered (since arg represents all-checked start state)
  });

  it("all source checkboxes start CHECKED when Customize is enabled (no warning shown)", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [1, 2, SPATIAL_DRAWS_SENTINEL as unknown as number] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar", "Revenue Bar"), makeWidget(2, "datafilter", "Global Filter")]}
      />
    );
    const revenueCheckbox = screen.getByRole("checkbox", { name: /Revenue Bar/i });
    const filterCheckbox = screen.getByRole("checkbox", { name: /Global Filter/i });
    const sentinelCheckbox = screen.getByRole("checkbox", { name: /spatial draws/i });
    expect((revenueCheckbox as HTMLInputElement).checked).toBe(true);
    expect((filterCheckbox as HTMLInputElement).checked).toBe(true);
    expect((sentinelCheckbox as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(/no sources selected/i)).toBeNull();
  });

  it("enabling Customize with allowSpatial=false pre-checks widget ids ONLY (no sentinel)", () => {
    const onChange = vi.fn();
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={onChange}
        widgets={[makeWidget(3, "bar", "DV Widget"), makeWidget(4, "datafilter", "DV Filter")]}
        allowSpatial={false}
      />
    );
    const customize = screen.getByRole("checkbox", { name: /customize/i });
    fireEvent.click(customize);
    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    expect(arg.sourceMode).toBe("allowlist");
    expect(arg.allowedSourceWidgetIds).toContain(3);
    expect(arg.allowedSourceWidgetIds).toContain(4);
    // Spatial sentinel must NOT be included for dv-bound
    expect(arg.allowedSourceWidgetIds).not.toContain(SPATIAL_DRAWS_SENTINEL);
  });

  it("accept-none warning still fires when user manually unchecks all sources (allowSpatial=false)", () => {
    // Start with only one widget checked; uncheck it → empty allowlist
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(5, "bar", "Only Widget")]}
        allowSpatial={false}
      />
    );
    // Empty allowlist + no sentinel = warning shown
    expect(screen.getByText(/no sources selected/i)).toBeTruthy();
  });

  it("selfWidgetId-excluded sources are NOT included in the pre-checked set", () => {
    const onChange = vi.fn();
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={onChange}
        widgets={[makeWidget(1, "bar", "Self Bar"), makeWidget(2, "bar", "Other Bar")]}
        selfWidgetId={1}
      />
    );
    const customize = screen.getByRole("checkbox", { name: /customize/i });
    fireEvent.click(customize);
    const arg = onChange.mock.calls[0][0] as FilterSelectionConfig;
    // Widget 1 is self — excluded from source list → not pre-checked
    expect(arg.allowedSourceWidgetIds).not.toContain(1);
    // Widget 2 is a valid source
    expect(arg.allowedSourceWidgetIds).toContain(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 11. GAP 5 — Suppress spatial row for dv-bound vizs (allowSpatial=false)
// ──────────────────────────────────────────────────────────────────────────────

describe("FilterSelectionPanel — GAP 5: allowSpatial=false hides the spatial row", () => {
  it("does NOT render the 'Spatial draws (map)' row when allowSpatial=false", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar", "DV Bar")]}
        allowSpatial={false}
      />
    );
    expect(screen.queryByText(/spatial draws \(map\)/i)).toBeNull();
  });

  it("does NOT render the spatial row even in accept-all mode when allowSpatial=false", () => {
    render(
      <FilterSelectionPanel
        value={undefined}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar", "DV Bar")]}
        allowSpatial={false}
      />
    );
    expect(screen.queryByText(/spatial draws \(map\)/i)).toBeNull();
  });

  it("DOES render the 'Spatial draws (map)' row when allowSpatial=true (explicit)", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar")]}
        allowSpatial={true}
      />
    );
    expect(screen.getByText(/spatial draws \(map\)/i)).toBeTruthy();
  });

  it("DOES render the sentinel row when allowSpatial is omitted (default=true)", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar")]}
      />
    );
    expect(screen.getByText(/spatial draws \(map\)/i)).toBeTruthy();
  });

  it("accept-none warning fires when allowSpatial=false and allowlist is empty (no live widget, no sentinel)", () => {
    render(
      <FilterSelectionPanel
        value={{ sourceMode: "allowlist", allowedSourceWidgetIds: [] }}
        onChange={vi.fn()}
        widgets={[makeWidget(1, "bar")]}
        allowSpatial={false}
      />
    );
    expect(screen.getByText(/no sources selected/i)).toBeTruthy();
  });
});
