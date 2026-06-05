import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import type { WidgetDto, DashboardLayerDto } from "../../api/client";
import { DashboardContextProvider } from "../DashboardContext";

// Captured props from mocked LayersLegendPanel
let lastLayersLegendPanelProps: {
  layers: unknown[];
  showChevron?: boolean;
  collapsed: boolean;
  corner: string;
} | null = null;
vi.mock("../LayersLegendPanel", () => ({
  LayersLegendPanel: (props: any) => {
    lastLayersLegendPanelProps = props;
    return <div data-testid="mocked-layers-legend-panel" />;
  },
}));

// Zustand store mock — provides hook + getState
const _storeState: { layers: DashboardLayerDto[] } = { layers: [] };
vi.mock("../../store/dashboardLayersStore", () => {
  const hook = (selector: (s: { layers: DashboardLayerDto[] }) => unknown) =>
    selector(_storeState);
  (hook as any).getState = () => _storeState;
  (hook as any).setState = (patch: Partial<typeof _storeState>) => {
    Object.assign(_storeState, patch);
  };
  return { useDashboardLayersStore: hook };
});

// Import LegendRenderer AFTER the mocks
import LegendRenderer from "./LegendRenderer";

function makeWidget(overrides: Partial<WidgetDto>): WidgetDto {
  return {
    id: 100,
    dashboard_id: 1,
    title: "Legend",
    type: "legend",
    position: 0,
    config: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeLayer(
  id: number,
  extras: Partial<DashboardLayerDto> = {},
): DashboardLayerDto {
  return {
    id,
    dashboard_id: 1,
    table_id: 1,
    layer_index: 0,
    config: {},
    cb_config: null,
    info_enabled: 1,
    dynamic_view_id: null,
    ...extras,
  } as DashboardLayerDto;
}

function renderWithContext(
  widget: WidgetDto,
  widgets: WidgetDto[],
  onConfigureWidget?: (w: WidgetDto) => void,
) {
  return render(
    <DashboardContextProvider
      dashboardId={1}
      widgets={widgets}
      dynamicViews={[]}
      retryDynamicView={() => {}}
    >
      <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />
    </DashboardContextProvider>,
  );
}

beforeEach(() => {
  _storeState.layers = [];
  lastLayersLegendPanelProps = null;
});

describe("LegendRenderer (Phase 42 / WIDGET-V17-01..05)", () => {
  it("Test 1: orphan UI when sourceMapWidgetId is undefined", () => {
    const legendWidget = makeWidget({ id: 100, type: "legend", config: {} });
    const mapA = makeWidget({ id: 1, type: "map", title: "Map A" });
    renderWithContext(legendWidget, [mapA, legendWidget]);
    expect(
      screen.getByText("Source map widget not found. Reconfigure the legend."),
    ).toBeTruthy();
    // Reconfigure button hidden when onConfigureWidget is undefined (GATE-V18-04 clean-hide)
    expect(screen.queryByRole("button", { name: "Reconfigure" })).toBeNull();
    expect(screen.queryByTestId("mocked-layers-legend-panel")).toBeNull();
  });

  it("Test 2: orphan UI when bound widget id not in widgets list (deleted)", () => {
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 999 },
    });
    const otherMap = makeWidget({ id: 1, type: "map" });
    renderWithContext(legendWidget, [otherMap, legendWidget]);
    expect(
      screen.getByText("Source map widget not found. Reconfigure the legend."),
    ).toBeTruthy();
  });

  it("Test 3: orphan UI when bound widget is non-map (defensive)", () => {
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 5 },
    });
    const barWidget = makeWidget({ id: 5, type: "bar" });
    renderWithContext(legendWidget, [barWidget, legendWidget]);
    expect(
      screen.getByText("Source map widget not found. Reconfigure the legend."),
    ).toBeTruthy();
  });

  it("Test 4: Reconfigure button calls onConfigureWidget(legendWidget)", () => {
    const onConfigure = vi.fn();
    const legendWidget = makeWidget({ id: 100, type: "legend", config: {} });
    renderWithContext(legendWidget, [legendWidget], onConfigure);
    const btn = screen.getByRole("button", { name: "Reconfigure" });
    fireEvent.click(btn);
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onConfigure).toHaveBeenCalledWith(legendWidget);
  });

  it("Test 5: happy path — bound map with no includedLayerIds renders all store layers", () => {
    _storeState.layers = [makeLayer(10), makeLayer(20)];
    const mapA = makeWidget({ id: 1, type: "map", config: {} });
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 1 },
    });
    renderWithContext(legendWidget, [mapA, legendWidget]);
    expect(screen.getByTestId("mocked-layers-legend-panel")).toBeTruthy();
    expect(
      (
        lastLayersLegendPanelProps?.layers as Array<{
          layer: DashboardLayerDto;
        }>
      )?.length,
    ).toBe(2);
    expect(screen.queryByText(/Source map widget not found/)).toBeNull();
  });

  it("Test 6: happy path — bound map with includedLayerIds filters layers", () => {
    _storeState.layers = [makeLayer(42), makeLayer(99)];
    const mapA = makeWidget({
      id: 1,
      type: "map",
      config: { includedLayerIds: [42] },
    });
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 1 },
    });
    renderWithContext(legendWidget, [mapA, legendWidget]);
    const layers = lastLayersLegendPanelProps?.layers as Array<{
      layer: DashboardLayerDto;
    }>;
    expect(layers.length).toBe(1);
    expect(layers[0].layer.id).toBe(42);
  });

  it("Test 7: LayersLegendPanel receives showChevron=false, collapsed=false, corner='top-right'", () => {
    _storeState.layers = [makeLayer(10)];
    const mapA = makeWidget({ id: 1, type: "map", config: {} });
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 1 },
    });
    renderWithContext(legendWidget, [mapA, legendWidget]);
    expect(lastLayersLegendPanelProps?.showChevron).toBe(false);
    expect(lastLayersLegendPanelProps?.collapsed).toBe(false);
    expect(lastLayersLegendPanelProps?.corner).toBe("top-right");
  });

  it("Test 8: live cb_config update propagates via legendKey", () => {
    _storeState.layers = [makeLayer(10, { cb_config: null })];
    const mapA = makeWidget({ id: 1, type: "map", config: {} });
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 1 },
    });
    const { rerender } = renderWithContext(legendWidget, [mapA, legendWidget]);
    const initialLayer = (
      lastLayersLegendPanelProps?.layers as Array<{ layer: DashboardLayerDto }>
    )[0].layer;
    expect(initialLayer.cb_config).toBeNull();
    // Simulate store mutation
    _storeState.layers = [
      makeLayer(10, {
        cb_config:
          '{"attr":"x","valsType":"numeric","breaks":[{"value":10,"color":"FFFF0000"}]}',
      }),
    ];
    rerender(
      <DashboardContextProvider
        dashboardId={1}
        widgets={[mapA, legendWidget]}
        dynamicViews={[]}
        retryDynamicView={() => {}}
      >
        <LegendRenderer widget={legendWidget} />
      </DashboardContextProvider>,
    );
    const updatedLayer = (
      lastLayersLegendPanelProps?.layers as Array<{ layer: DashboardLayerDto }>
    )[0].layer;
    expect(updatedLayer.cb_config).toContain("FFFF0000");
  });

  it("Test 9: empty store layers + bound map renders LayersLegendPanel (NOT orphan)", () => {
    _storeState.layers = [];
    const mapA = makeWidget({ id: 1, type: "map", config: {} });
    const legendWidget = makeWidget({
      id: 100,
      type: "legend",
      config: { sourceMapWidgetId: 1 },
    });
    renderWithContext(legendWidget, [mapA, legendWidget]);
    expect(screen.getByTestId("mocked-layers-legend-panel")).toBeTruthy();
    expect(screen.queryByText(/Source map widget not found/)).toBeNull();
    expect((lastLayersLegendPanelProps?.layers as unknown[]).length).toBe(0);
  });

  it("Test 10: source uses legendKey primitive selector formula", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "LegendRenderer.tsx"),
      "utf-8",
    );
    // Verify the exact selector formula (mirror of MapChartRenderer:533-540)
    expect(source).toMatch(/const legendKey = useDashboardLayersStore/);
    expect(source).toMatch(/\$\{l\.id\}:\$\{.*renderMode/);
    expect(source).toMatch(/l\.cb_config \?\? "null"/);
    // Anti-pattern check: must NOT subscribe to s.layers array directly
    expect(source).not.toMatch(/useDashboardLayersStore\(\(s\) => s\.layers\)/);
    expect(source).not.toMatch(/useDashboardLayersStore\(s => s\.layers\)/);
  });

  it("Test 11: global.css contains .legend-widget-* selectors", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "styles", "global.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.legend-widget-body/);
    expect(css).toMatch(/\.legend-widget-orphan/);
    expect(css).toMatch(/\.legend-widget-orphan-message/);
    expect(css).toMatch(/\.legend-widget-orphan-reconfigure/);
  });
});
