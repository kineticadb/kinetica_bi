import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import { LayersLegendPanel, type ResolvedLegendLayer } from "./LayersLegendPanel";
import type { DashboardLayerDto } from "../api/client";
import { useColumnDisplayConfigStore } from "../store/columnDisplayConfigStore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let layerIdCounter = 1;

function makeLayer(overrides: Partial<DashboardLayerDto> = {}): DashboardLayerDto {
  return {
    id: layerIdCounter++,
    dashboard_id: 1,
    table_id: 1,
    layer_type: "KineticaWms",
    position: 0,
    config: { renderMode: "raster" },
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeResolvedLayer(layerOverrides: Partial<DashboardLayerDto> = {}): ResolvedLegendLayer {
  return { layer: makeLayer(layerOverrides), visible: true };
}

function defaultProps() {
  return {
    layers: [] as ResolvedLegendLayer[],
    corner: "top-right" as const,
    collapsed: false,
    onToggleCollapse: vi.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LayersLegendPanel", () => {
  it("shows the operator-set config.name as the layer label; falls back to 'Layer {id}' when unset", () => {
    const named = makeResolvedLayer({ id: 7, config: { renderMode: "raster", name: "Pickups" } });
    const unnamed = makeResolvedLayer({ id: 9, config: { renderMode: "raster" } });
    render(<LayersLegendPanel {...defaultProps()} layers={[named, unnamed]} />);
    expect(screen.getByText("Pickups")).toBeTruthy();
    expect(screen.getByText("Layer 9")).toBeTruthy();
  });

  it("Test 1 (empty layers): renders header 'Layers' + empty state message", () => {
    render(<LayersLegendPanel {...defaultProps()} layers={[]} />);
    expect(screen.getByText("Layers")).toBeTruthy();
    expect(screen.getByText("No layers configured on this widget.")).toBeTruthy();
    const emptyEl = screen.getByText("No layers configured on this widget.");
    expect(emptyEl.className).toContain("layers-legend-panel-empty");
  });

  it("Test 2 (raster layer): renders no mode chip and no break rows", () => {
    const layer = makeResolvedLayer({ config: { renderMode: "raster" } });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    // Mode chip removed — render mode is no longer surfaced in the legend.
    const chip = container.querySelector(".layers-legend-panel-mode-chip");
    expect(chip).toBeNull();
    const breakRows = container.querySelectorAll(".layers-legend-panel-break-row");
    expect(breakRows).toHaveLength(0);
  });

  it("Test 3 (heatmap layer): renders no mode chip and no break rows", () => {
    const layer = makeResolvedLayer({ config: { renderMode: "heatmap" } });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    const chip = container.querySelector(".layers-legend-panel-mode-chip");
    expect(chip).toBeNull();
    const breakRows = container.querySelectorAll(".layers-legend-panel-break-row");
    expect(breakRows).toHaveLength(0);
  });

  it("Test 4 (classbreak layer with breaks): renders no chip + 2 break rows with label/value fallback", () => {
    const cbConfig = JSON.stringify({
      attr: "fare",
      valsType: "numeric",
      breaks: [
        { value: 10, color: "FFFF0000", label: "Low" },
        { value: 20, color: "FF00FF00", label: "" },
      ],
    });
    const layer = makeResolvedLayer({
      config: { renderMode: "classbreak" },
      cb_config: cbConfig,
    });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    const chip = container.querySelector(".layers-legend-panel-mode-chip");
    expect(chip).toBeNull();
    const breakRows = container.querySelectorAll(".layers-legend-panel-break-row");
    expect(breakRows).toHaveLength(2);
    // Row 1: label preferred
    expect(breakRows[0].textContent).toContain("Low");
    // Row 2: label empty → value fallback
    expect(breakRows[1].textContent).toContain("20");
  });

  it("Test 5 (classbreak with null cb_config): renders no chip + empty hint", () => {
    const layer = makeResolvedLayer({
      config: { renderMode: "classbreak" },
      cb_config: null,
    });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    const chip = container.querySelector(".layers-legend-panel-mode-chip");
    expect(chip).toBeNull();
    const emptyHint = container.querySelector(".layers-legend-panel-empty");
    expect(emptyHint).toBeTruthy();
    expect(emptyHint!.textContent).toContain("No breaks configured");
  });

  it("Test 6 (<other> row verbatim): renders literal '<other>' text, not titlecased", () => {
    const cbConfig = JSON.stringify({
      attr: "category",
      valsType: "categorical",
      breaks: [{ value: "<other>", color: "FF888888", label: "" }],
    });
    const layer = makeResolvedLayer({
      config: { renderMode: "classbreak" },
      cb_config: cbConfig,
    });
    render(<LayersLegendPanel {...defaultProps()} layers={[layer]} />);
    // getByText with exact string match — must render literal, no titlecasing
    expect(screen.getByText("<other>")).toBeTruthy();
  });

  it("Test 6b (numeric <other> verbatim): renders '<other>', NOT '0 – 0', for a numeric sink bucket with min/max = 0", () => {
    // v1.14 Phase 70 follow-up: numeric <other> rows carry min/max = 0 (createDefaultBreak
    // default). Before the fix this fell through to the "min – max" branch and rendered "0 – 0".
    const cbConfig = JSON.stringify({
      attr: "val",
      valsType: "numeric",
      includeOtherBucket: true,
      breaks: [
        { value: 0, min: 0, max: 10, color: "FF00FF00", label: "" },
        { value: "<other>", min: 0, max: 0, color: "FFFF00FF", label: "" },
      ],
    });
    const layer = makeResolvedLayer({
      config: { renderMode: "classbreak" },
      cb_config: cbConfig,
    });
    render(<LayersLegendPanel {...defaultProps()} layers={[layer]} />);
    expect(screen.getByText("<other>")).toBeTruthy();
    expect(screen.queryByText("0 – 0")).toBeNull();
  });

  it("Test 7 (color swatch present): each break row has a swatch with backgroundColor", () => {
    const cbConfig = JSON.stringify({
      attr: "val",
      valsType: "numeric",
      breaks: [{ value: 1, color: "FFFF0000", label: "High" }],
    });
    const layer = makeResolvedLayer({
      config: { renderMode: "classbreak" },
      cb_config: cbConfig,
    });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    const swatch = container.querySelector(".layers-legend-panel-swatch") as HTMLElement;
    expect(swatch).toBeTruthy();
    expect(swatch.style.backgroundColor).toBeTruthy();
  });

  it("Test 8 (collapsed body hidden): body element not in DOM when collapsed=true", () => {
    render(<LayersLegendPanel {...defaultProps()} collapsed={true} layers={[makeResolvedLayer()]} />);
    const body = document.querySelector(".layers-legend-panel-body");
    // Body should not be rendered when collapsed
    expect(body).toBeNull();
  });

  it("Test 9 (header click fires toggle): clicking header calls onToggleCollapse once", async () => {
    const onToggleCollapse = vi.fn();
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} onToggleCollapse={onToggleCollapse} />
    );
    const header = container.querySelector(".layers-legend-panel-header") as HTMLElement;
    await userEvent.click(header);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("Test 10 (chevron icon): expanded shows ▾, collapsed shows ▸", () => {
    const { rerender, getByRole } = render(
      <LayersLegendPanel {...defaultProps()} collapsed={false} />
    );
    const button = getByRole("button");
    expect(button.textContent).toBe("▾");

    rerender(<LayersLegendPanel {...defaultProps()} collapsed={true} />);
    const button2 = getByRole("button");
    expect(button2.textContent).toBe("▸");
  });

  it("Test 11 (corner modifier class): corner='bottom-left' applies .layers-legend-panel--bottom-left to root", () => {
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} corner="bottom-left" />
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain("layers-legend-panel--bottom-left");
  });

  it("Test 12 (a11y): root has role='region' + aria-label; button has aria-expanded + aria-controls", () => {
    const { getByRole } = render(
      <LayersLegendPanel {...defaultProps()} collapsed={false} />
    );
    const region = getByRole("region");
    expect(region.getAttribute("aria-label")).toBe("Map layer legend");
    const button = getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const bodyId = button.getAttribute("aria-controls");
    expect(bodyId).toBeTruthy();
    // body element should have that id — use getElementById to handle : characters in useId() output
    const body = document.getElementById(bodyId!);
    expect(body).toBeTruthy();
    expect(body!.className).toContain("layers-legend-panel-body");
  });

  it("Test 13 (contour render-mode legacy): renders no chip + no break rows + does not crash", () => {
    const layer = makeResolvedLayer({ config: { renderMode: "contour" } });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    const chip = container.querySelector(".layers-legend-panel-mode-chip");
    expect(chip).toBeNull();
    const breakRows = container.querySelectorAll(".layers-legend-panel-break-row");
    expect(breakRows).toHaveLength(0);
  });

  it("Test 14 (no Zustand imports): component source does not import from dashboardLayersStore", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "./LayersLegendPanel.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*dashboardLayersStore["']/);
    expect(src).not.toMatch(/useDashboardLayersStore/);
  });

  it("Test 15 (renderMode fallback): config with no renderMode renders no chip and does not crash", () => {
    const layer = makeResolvedLayer({ config: {} });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    const chip = container.querySelector(".layers-legend-panel-mode-chip");
    expect(chip).toBeNull();
  });

  it("Test 16 (label fallback chain): undefined label shows value; empty string label shows value; non-empty label preferred", () => {
    const cbConfig = JSON.stringify({
      attr: "x",
      valsType: "numeric",
      breaks: [
        { value: 42, color: "FF000000", label: undefined },
        { value: "categoryA", color: "FF111111", label: "" },
        { value: 99, color: "FF222222", label: "Custom Label" },
      ],
    });
    const layer = makeResolvedLayer({
      config: { renderMode: "classbreak" },
      cb_config: cbConfig,
    });
    render(<LayersLegendPanel {...defaultProps()} layers={[layer]} />);
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("categoryA")).toBeTruthy();
    expect(screen.getByText("Custom Label")).toBeTruthy();
  });
});

describe("Phase 42 showChevron prop", () => {
  it("Test 12 (showChevron default — undefined): chevron present, aria-expanded, header click calls toggle", async () => {
    const mockToggle = vi.fn();
    const layer = makeResolvedLayer({ id: 99 });
    const { container } = render(
      <LayersLegendPanel
        layers={[layer]}
        corner="top-right"
        collapsed={false}
        onToggleCollapse={mockToggle}
      />
    );
    // Chevron button is present
    const button = container.querySelector("button") as HTMLElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // Clicking header div calls toggle
    const header = container.querySelector(".layers-legend-panel-header") as HTMLElement;
    await userEvent.click(header);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it("Test 13 (showChevron=true explicit): identical to default — chevron present, click-toggles work", async () => {
    const mockToggle = vi.fn();
    const layer = makeResolvedLayer({ id: 100 });
    const { container } = render(
      <LayersLegendPanel
        layers={[layer]}
        corner="top-right"
        collapsed={false}
        onToggleCollapse={mockToggle}
        showChevron={true}
      />
    );
    const button = container.querySelector("button") as HTMLElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const header = container.querySelector(".layers-legend-panel-header") as HTMLElement;
    await userEvent.click(header);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it("Test 14 (showChevron=false — no chevron): no chevron button, no onClick, header does not call toggle", () => {
    const mockToggle = vi.fn();
    const layer = makeResolvedLayer({ id: 101 });
    const { container } = render(
      <LayersLegendPanel
        layers={[layer]}
        corner="top-right"
        collapsed={false}
        onToggleCollapse={mockToggle}
        showChevron={false}
      />
    );
    const header = container.querySelector(".layers-legend-panel-header") as HTMLElement;
    expect(header).toBeTruthy();
    // No chevron button
    expect(header.querySelector("button")).toBeNull();
    // No aria-expanded on header
    expect(header.getAttribute("aria-expanded")).toBeNull();
    // No role=button on header
    expect(header.getAttribute("role")).not.toBe("button");
    // Cursor default
    expect((header.style as CSSStyleDeclaration).cursor).toBe("default");
    // Clicking header does not fire toggle
    fireEvent.click(header);
    expect(mockToggle).not.toHaveBeenCalled();
  });

  it("Test 15 (showChevron=false — body always rendered): collapsed=true still renders body when showChevron=false", () => {
    const mockToggle = vi.fn();
    const layer = makeResolvedLayer({ config: { renderMode: "raster", name: "layer-A" }, id: 102 });
    render(
      <LayersLegendPanel
        layers={[layer]}
        corner="top-right"
        collapsed={true}
        onToggleCollapse={mockToggle}
        showChevron={false}
      />
    );
    // Body IS rendered even though collapsed=true
    const body = document.querySelector(".layers-legend-panel-body");
    expect(body).toBeTruthy();
  });
});

describe("onToggleVisible eye toggle", () => {
  it("renders no eye button when onToggleVisible is omitted (read-only legend)", () => {
    const layer = makeResolvedLayer({ id: 200 });
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={[layer]} />
    );
    expect(container.querySelector(".layers-legend-panel-eye")).toBeNull();
  });

  it("renders an eye button per layer when onToggleVisible is provided", () => {
    const onToggleVisible = vi.fn();
    const layers = [makeResolvedLayer({ id: 201 }), makeResolvedLayer({ id: 202 })];
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={layers} onToggleVisible={onToggleVisible} />
    );
    expect(container.querySelectorAll(".layers-legend-panel-eye")).toHaveLength(2);
  });

  it("visible layer → 'Hide layer' label; clicking requests visible=false", async () => {
    const onToggleVisible = vi.fn();
    const layers = [{ layer: makeLayer({ id: 203 }), visible: true }];
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={layers} onToggleVisible={onToggleVisible} />
    );
    const eye = container.querySelector(".layers-legend-panel-eye") as HTMLElement;
    expect(eye.getAttribute("aria-label")).toBe("Hide layer");
    expect(eye.className).not.toContain("hidden");
    await userEvent.click(eye);
    expect(onToggleVisible).toHaveBeenCalledWith(203, false);
  });

  it("hidden layer → 'Show layer' label + dimmed block; clicking requests visible=true", async () => {
    const onToggleVisible = vi.fn();
    const layers = [{ layer: makeLayer({ id: 204 }), visible: false }];
    const { container } = render(
      <LayersLegendPanel {...defaultProps()} layers={layers} onToggleVisible={onToggleVisible} />
    );
    const eye = container.querySelector(".layers-legend-panel-eye") as HTMLElement;
    expect(eye.getAttribute("aria-label")).toBe("Show layer");
    expect(eye.className).toContain("hidden");
    const block = container.querySelector(".layers-legend-panel-layer-block") as HTMLElement;
    expect(block.className).toContain("hidden");
    await userEvent.click(eye);
    expect(onToggleVisible).toHaveBeenCalledWith(204, true);
  });

  it("clicking the eye does not bubble to the header collapse toggle", async () => {
    const onToggleCollapse = vi.fn();
    const onToggleVisible = vi.fn();
    const layers = [{ layer: makeLayer({ id: 205 }), visible: true }];
    const { container } = render(
      <LayersLegendPanel
        {...defaultProps()}
        onToggleCollapse={onToggleCollapse}
        layers={layers}
        onToggleVisible={onToggleVisible}
      />
    );
    const eye = container.querySelector(".layers-legend-panel-eye") as HTMLElement;
    await userEvent.click(eye);
    expect(onToggleVisible).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });
});

// ── COLAPPLY-V115-04: Legend exclusion guard ───────────────────────────────────────────────────

describe("COLAPPLY-V115-04: layers legend is NOT affected by column display config", () => {
  it("renders break label/value UNCHANGED when a saved display label and format exist for that column/value", () => {
    // Seed the store with a display label AND a number format for a column "fare"
    // and a break value of 10 that appears in the legend.
    // The legend's break text should come from cb_config (breakDisplayText) verbatim,
    // NOT from resolveLabel or resolveFormatter.
    const TABLE_ID_LEGEND = 999;
    act(() => {
      useColumnDisplayConfigStore.getState().upsertColumn(
        TABLE_ID_LEGEND,
        "fare",
        "Fare Amount",
        { kind: "number", thousandsSep: true, decimals: 2, currency: "$", percent: false },
      );
    });

    const cbConfig = JSON.stringify({
      attr: "fare",
      valsType: "numeric",
      breaks: [
        { value: 10, min: 0, max: 10, color: "FFFF0000", label: "Low Fare" },
        { value: 20, min: 10, max: 20, color: "FF00FF00", label: "" },
      ],
    });
    const layer = makeLayer({
      id: 501,
      table_id: TABLE_ID_LEGEND,
      config: { renderMode: "classbreak" },
      cb_config: cbConfig,
    });
    const resolved: ResolvedLegendLayer = { layer, visible: true };

    render(<LayersLegendPanel {...defaultProps()} layers={[resolved]} />);

    // Break row 1: label "Low Fare" — raw cb_config label, NOT "Fare Amount" (the display-config label)
    expect(screen.getByText("Low Fare")).toBeInTheDocument();
    expect(screen.queryByText("Fare Amount")).toBeNull();

    // Break row 2: label empty → falls back to numeric range "10 – 20" (raw boundaries)
    // NOT formatted as "$10.00 – $20.00" or any currency-formatted value
    expect(screen.getByText("10 – 20")).toBeInTheDocument();
    expect(screen.queryByText("$10.00")).toBeNull();
    expect(screen.queryByText("$20.00")).toBeNull();
  });

  it("COLAPPLY-V115-04: LayersLegendPanel.tsx contains no resolveLabel/resolveFormatter/columnDisplayConfig wiring", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "./LayersLegendPanel.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/resolveLabel/);
    expect(src).not.toMatch(/resolveFormatter/);
    expect(src).not.toMatch(/columnDisplayConfig/);
    expect(src).not.toMatch(/tableId/);
  });
});

// ── GAP 6 / COMM-V118-02 + GAP 3 legend portion: per-layer filter indicator ────────────────

describe("COMM-V118-02: per-layer filter-scope indicator in LayersLegendPanel", () => {
  it("shows 'X of Y filters' badge when filterSummary.appliedCount < filterSummary.totalCount", () => {
    const layer = makeResolvedLayer({ id: 600 });
    const entry: ResolvedLegendLayer = {
      ...layer,
      filterSummary: { appliedCount: 1, totalCount: 3 },
    };
    render(<LayersLegendPanel {...defaultProps()} layers={[entry]} />);
    expect(screen.getByText("1 of 3 filters")).toBeInTheDocument();
    const badge = screen.getByText("1 of 3 filters");
    expect(badge).toHaveClass("widget-filter-badge");
    expect(badge.getAttribute("role")).toBe("status");
  });

  it("does NOT render indicator when filterSummary.appliedCount === filterSummary.totalCount (accept-all)", () => {
    const layer = makeResolvedLayer({ id: 601 });
    const entry: ResolvedLegendLayer = {
      ...layer,
      filterSummary: { appliedCount: 2, totalCount: 2 },
    };
    render(<LayersLegendPanel {...defaultProps()} layers={[entry]} />);
    expect(screen.queryByText(/of \d+ filters/)).toBeNull();
  });

  it("does NOT render indicator when filterSummary is undefined", () => {
    const layer = makeResolvedLayer({ id: 602 });
    // no filterSummary field — normal case (no filter computed)
    render(<LayersLegendPanel {...defaultProps()} layers={[layer]} />);
    expect(screen.queryByText(/of \d+ filters/)).toBeNull();
  });

  it("indicator uses aria-label with applied/total counts", () => {
    const layer = makeResolvedLayer({ id: 603 });
    const entry: ResolvedLegendLayer = {
      ...layer,
      filterSummary: { appliedCount: 2, totalCount: 4 },
    };
    render(<LayersLegendPanel {...defaultProps()} layers={[entry]} />);
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("aria-label")).toContain("2 of 4 filters");
  });

  it("LayersLegendPanel source uses widget-filter-badge class for the indicator", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "./LayersLegendPanel.tsx"),
      "utf8",
    );
    expect(src).toContain("widget-filter-badge");
    expect(src).toContain("filterSummary");
  });
});
