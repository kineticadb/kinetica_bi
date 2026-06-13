/**
 * Phase 59 Plan 02 — Task 2 (TDD)
 * Tests for RadioGroupConfigPanel + radiogroup registry entry.
 *
 * Coverage:
 *   - registers: getChartType("radiogroup") resolves with CustomConfigPanel after registerAllChartTypes()
 *   - option add/remove: add appends a row; remove splices it out
 *   - target picker lists same-dashboard widgets, map layers, and dynamic views (from props/store/fetch)
 *   - Capture: clicking "Capture from target" calls captureAllowListedSubset + writes configPatch
 *   - JSON edit: valid JSON updates configPatch; invalid JSON shows inline error and does NOT corrupt config
 *   - orientation toggle: switches config.orientation
 *   - defaultOptionId: selecting an option sets it; (none) clears it
 *   - title: input sets config.title
 *   - save-time validation: valid config calls isValid(true); empty/out-of-list calls isValid(false)
 *   - props.widgets (NOT useDashboardContext): widgets come from props
 *
 * Phase 60.1 Plan 03 additions — full-form side-by-side layer editor (60.1 RE-SCOPE):
 *   - layer target renders full KineticaWmsLayerForm side-by-side (RENDER MODE present,
 *     SPATIAL MODE + DATA SOURCE absent); radio-layer-form-${idx} wrapper asserted
 *   - editing render mode updates the snapshot (no data-binding keys in emitted configPatch)
 *   - editing INFO POPUP updates top-level info_enabled in the snapshot
 *   - Advanced JSON still present + round-trips; invalid JSON shows error
 *   - non-surfaced keys like track_config survive a structured-editor write (MERGE / adapter round-trip)
 *   - widget/dv targets: JSON textarea rendered directly (unchanged, no structured editor)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { registerAllChartTypes } from "./definitions";
import { getChartType } from "./registry";
import RadioGroupConfigPanel from "./RadioGroupConfigPanel";
import type { ConfigPanelProps } from "./registry";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import type { DashboardLayerDto, WidgetDto } from "../../api/client";

// ---------------------------------------------------------------------------
// Mock listDynamicViews from client.ts
// ---------------------------------------------------------------------------

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    listDynamicViews: vi.fn().mockResolvedValue({
      dynamic_views: [
        { id: 99, dashboard_id: 10, name: "My DV", source_table_id: 1,
          template_sql: "SELECT 1", max_records: 0, columns_json: null,
          created_at: "", updated_at: "" },
      ],
    }),
  };
});

// Mock captureAllowListedSubset so we can spy on it
vi.mock("../../lib/radioGroupCapture", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/radioGroupCapture")>();
  return {
    ...actual,
    captureAllowListedSubset: vi.fn().mockReturnValue({ renderMode: "classbreak" }),
  };
});

// Mock CbConfigForm — lightweight stub that renders known selectors (CB column + Add break button)
// and calls isValid via an effect when config.cb_config parses to zero breaks (mirrors real
// CbConfigForm behaviour). Uses useEffect (imported from react) to avoid render-loop.
vi.mock("./CbConfigForm", async () => {
  const { useEffect } = await import("react");
  return {
    default: vi.fn(({ config, onChange, isValid }: {
      config: Record<string, unknown>;
      onChange: (c: Record<string, unknown>) => void;
      isValid?: (v: boolean) => void;
    }) => {
      // Determine whether this config has zero breaks
      let breaks: unknown[] = [];
      try {
        const parsed = JSON.parse((config.cb_config as string) ?? "{}") as Record<string, unknown>;
        if (Array.isArray(parsed.breaks)) breaks = parsed.breaks as unknown[];
      } catch {
        // ignore parse failures
      }
      const breaksLength = breaks.length;

      // Fire isValid in an effect (mirrors real CbConfigForm; breaks.length < 2 → invalid)
      useEffect(() => {
        if (isValid) isValid(breaksLength >= 2);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [breaksLength]);

      const handleAddBreak = () => {
        const existingBreaks = breaks as Record<string, unknown>[];
        const nextBreaks = [...existingBreaks, { value: "new", min: 0, max: 1 }];
        const nextCbConfig = JSON.stringify({ breaks: nextBreaks });
        onChange({ ...config, cb_config: nextCbConfig });
      };

      return (
        <div data-testid="cb-config-form-stub">
          {/* Real CbConfigForm selectors — confirmed in read_first */}
          <select aria-label="CB column">
            <option value="">— select column —</option>
          </select>
          <button type="button" aria-label="+ Add break" onClick={handleAddBreak}>
            + Add break
          </button>
        </div>
      );
    }),
  };
});

import { captureAllowListedSubset } from "../../lib/radioGroupCapture";

// Mock KineticaWmsLayerForm — renders stable test markers and fires callbacks via user interactions.
// Uses useEffect (NOT synchronously in render) to avoid the infinite-render loop pitfall.
// The mock renders:
//   - id="map-render-mode-label" marker → asserts RENDER MODE is shown
//   - a button to trigger onChange (simulates render mode change to "classbreak")
//   - a button to trigger onChangeInfoConfig (simulates info_enabled toggle)
//   - "SPATIAL MODE" marker only if !hideSpatialMode (to assert it's absent when hideSpatialMode=true)
//   - "DATA SOURCE" marker only if props.layer && props.onDataSourceChange (absent when suppressed)
vi.mock("./KineticaWmsLayerForm", async () => {
  const { useEffect } = await import("react");
  return {
    default: vi.fn((props: {
      config: Record<string, unknown>;
      onChange: (c: Record<string, unknown>) => void;
      onChangeInfoConfig?: (patch: Record<string, unknown>) => void;
      isValid?: (v: boolean) => void;
      hideSpatialMode?: boolean;
      layer?: Record<string, unknown> | null;
      onDataSourceChange?: ((patch: unknown) => void) | null;
      infoEnabled?: number;
    }) => {
      // Signal validity in an effect (not render-time) to avoid infinite loops
      useEffect(() => {
        props.isValid?.(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return (
        <div data-testid="kinetica-wms-layer-form-mock">
          {/* RENDER MODE marker — always present */}
          <span id="map-render-mode-label">RENDER MODE</span>
          {/* SPATIAL MODE marker — only when NOT suppressed */}
          {!props.hideSpatialMode && (
            <span id="map-spatial-mode-label">SPATIAL MODE</span>
          )}
          {/* DATA SOURCE marker — only when both layer + onDataSourceChange are passed */}
          {props.layer && props.onDataSourceChange && (
            <span>DATA SOURCE</span>
          )}
          {/* Button to simulate a render mode change */}
          <button
            type="button"
            aria-label="mock-change-rendermode"
            onClick={() =>
              props.onChange({ ...props.config, renderMode: "classbreak" })
            }
          >
            Change render mode
          </button>
          {/* Button to simulate an INFO POPUP toggle */}
          <button
            type="button"
            aria-label="mock-change-info"
            onClick={() =>
              props.onChangeInfoConfig?.({ info_enabled: 0 })
            }
          >
            Toggle info
          </button>
        </div>
      );
    }),
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockWidget1: WidgetDto = {
  id: 1,
  dashboard_id: 10,
  title: "My Map",
  type: "map",
  position: 0,
  config: { show_popup: true },
  created_at: "",
  updated_at: "",
};

const mockWidget2: WidgetDto = {
  id: 2,
  dashboard_id: 10,
  title: "My Bar",
  type: "chart",
  position: 1,
  config: {},
  created_at: "",
  updated_at: "",
};

const mockLayer: DashboardLayerDto = {
  id: 5,
  dashboard_id: 10,
  table_id: 1,
  layer_type: "KineticaWms",
  position: 0,
  config: { renderMode: "classbreak", title: "Streets" },
  info_enabled: 0,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: '{"breaks":[]}',
  track_config: null,
  created_at: "",
  updated_at: "",
};

const DEFAULT_CONFIG: Record<string, unknown> = {
  orientation: "vertical",
  options: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<ConfigPanelProps> = {},
): ConfigPanelProps {
  return {
    config: { ...DEFAULT_CONFIG },
    onChange: vi.fn(),
    isValid: vi.fn(),
    widgets: [mockWidget1, mockWidget2],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// REGISTERS test (lives in this spec per plan instruction)
// ---------------------------------------------------------------------------

describe("radiogroup registry", () => {
  it("registers with CustomConfigPanel and usesDataSource:false after registerAllChartTypes()", () => {
    registerAllChartTypes();
    const def = getChartType("radiogroup");
    expect(def).toBeDefined();
    expect(def?.CustomConfigPanel).toBeDefined();
    expect(def?.usesDataSource).toBe(false);
    expect(def?.type).toBe("radiogroup");
    expect(def?.label).toBe("Radio Group");
  });
});

// ---------------------------------------------------------------------------
// Option add / remove
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — option add/remove", () => {
  it("clicking Add option calls onChange with one option appended", () => {
    const onChange = vi.fn();
    render(
      <RadioGroupConfigPanel
        config={{ orientation: "vertical", options: [] }}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add option/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const nextConfig = onChange.mock.calls[0][0] as Record<string, unknown>;
    const options = nextConfig.options as unknown[];
    expect(options).toHaveLength(1);
    const opt = options[0] as {
      id: string;
      label: string;
      action: { target: { kind: string; id: number }; configPatch: Record<string, unknown> };
    };
    expect(opt.id).toBeTruthy();
    expect(opt.label).toBe("");
    expect(opt.action.target.kind).toBe("widget");
    expect(opt.action.configPatch).toEqual({});
  });

  it("clicking Remove on a row removes it via onChange", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        { id: "opt-a", label: "A", action: { target: { kind: "widget", id: 1 }, configPatch: { show_popup: true } } },
        { id: "opt-b", label: "B", action: { target: { kind: "widget", id: 2 }, configPatch: { metric: "count" } } },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1, mockWidget2]}
      />,
    );

    // Remove first option
    fireEvent.click(screen.getByRole("button", { name: /remove option 1/i }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as { options: unknown[] };
    expect(next.options).toHaveLength(1);
    const remaining = next.options[0] as { id: string };
    expect(remaining.id).toBe("opt-b");
  });
});

// ---------------------------------------------------------------------------
// Target picker: lists widgets, layers, dynamic views
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — target picker", () => {
  beforeEach(() => {
    useDashboardLayersStore.setState({ layers: [mockLayer] });
  });

  afterEach(() => {
    useDashboardLayersStore.setState({ layers: [] });
  });

  it("renders optgroups for widgets, layers, and dynamic views", async () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Test",
          action: { target: { kind: "widget", id: 1 }, configPatch: {} },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1, mockWidget2]}
      />,
    );

    // Wait for dynamic views to load
    await waitFor(() => {
      expect(screen.getByText("My DV")).toBeTruthy();
    });

    // Widgets should be listed
    expect(screen.getByText("My Map")).toBeTruthy();
    expect(screen.getByText("My Bar")).toBeTruthy();
    // Layer should be listed
    expect(screen.getByText("Streets")).toBeTruthy();
    // DV listed
    expect(screen.getByText("My DV")).toBeTruthy();
  });

  it("target change resets configPatch to {}", async () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Test",
          action: { target: { kind: "widget", id: 1 }, configPatch: { show_popup: true } },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1, mockWidget2]}
      />,
    );

    // Change target to a layer
    const targetSelect = screen.getByRole("combobox", { name: /option 1 target/i });
    fireEvent.change(targetSelect, { target: { value: `layer:${mockLayer.id}` } });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as { options: Array<{ action: { configPatch: unknown } }> };
    expect(next.options[0].action.configPatch).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Capture from target
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — Capture from target", () => {
  beforeEach(() => {
    useDashboardLayersStore.setState({ layers: [mockLayer] });
    vi.clearAllMocks();
    // Re-set the mock return value after clearAllMocks
    (captureAllowListedSubset as ReturnType<typeof vi.fn>).mockReturnValue({
      renderMode: "classbreak",
    });
  });

  afterEach(() => {
    useDashboardLayersStore.setState({ layers: [] });
  });

  it("clicking Capture calls captureAllowListedSubset and writes patch via onChange", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Class Break",
          action: { target: { kind: "layer", id: mockLayer.id }, configPatch: {} },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /capture from target for option 1/i }),
    );

    expect(captureAllowListedSubset).toHaveBeenCalledOnce();
    const callArg = (captureAllowListedSubset as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { target: { kind: string; id: number }; layer: DashboardLayerDto };
    expect(callArg.target).toEqual({ kind: "layer", id: mockLayer.id });
    expect(callArg.layer).toEqual(mockLayer);

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as {
      options: Array<{ action: { configPatch: unknown } }>;
    };
    expect(next.options[0].action.configPatch).toEqual({ renderMode: "classbreak" });
  });
});

// ---------------------------------------------------------------------------
// JSON editor
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — JSON editor", () => {
  it("editing JSON textarea with valid JSON updates configPatch", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Test",
          action: { target: { kind: "widget", id: 1 }, configPatch: {} },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: /option 1 config patch json/i });
    fireEvent.change(textarea, {
      target: { value: '{"show_popup": true}' },
    });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as {
      options: Array<{ action: { configPatch: unknown } }>;
    };
    expect(next.options[0].action.configPatch).toEqual({ show_popup: true });
  });

  it("editing JSON textarea with invalid JSON shows parse error and does NOT call onChange", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Test",
          action: { target: { kind: "widget", id: 1 }, configPatch: { show_popup: true } },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: /option 1 config patch json/i });
    fireEvent.change(textarea, { target: { value: "{bad json" } });

    // Should show an error
    expect(screen.getByTestId("json-error-0")).toBeTruthy();
    // Should NOT have called onChange (config not corrupted)
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Orientation toggle
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — orientation toggle", () => {
  it("switching orientation calls onChange with updated orientation", () => {
    const onChange = vi.fn();
    render(
      <RadioGroupConfigPanel
        config={{ orientation: "vertical", options: [] }}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    const select = screen.getByRole("combobox", { name: /radio group orientation/i });
    fireEvent.change(select, { target: { value: "horizontal" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as { orientation: string };
    expect(next.orientation).toBe("horizontal");
  });
});

// ---------------------------------------------------------------------------
// defaultOptionId
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — defaultOptionId", () => {
  it("selecting an option sets defaultOptionId", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        { id: "opt-a", label: "Alpha", action: { target: { kind: "widget", id: 1 }, configPatch: { show_popup: true } } },
        { id: "opt-b", label: "Beta", action: { target: { kind: "widget", id: 2 }, configPatch: { metric: "count" } } },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1, mockWidget2]}
      />,
    );

    const select = screen.getByRole("combobox", { name: /default option/i });
    fireEvent.change(select, { target: { value: "opt-b" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as { defaultOptionId: string };
    expect(next.defaultOptionId).toBe("opt-b");
  });

  it("selecting (none) clears defaultOptionId", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      defaultOptionId: "opt-a",
      options: [
        { id: "opt-a", label: "Alpha", action: { target: { kind: "widget", id: 1 }, configPatch: { show_popup: true } } },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    const select = screen.getByRole("combobox", { name: /default option/i });
    fireEvent.change(select, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as { defaultOptionId: string | undefined };
    expect(next.defaultOptionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Title input
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — title", () => {
  it("setting title calls onChange with config.title", () => {
    const onChange = vi.fn();
    render(
      <RadioGroupConfigPanel
        config={{ orientation: "vertical", options: [] }}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    const titleInput = screen.getByRole("textbox", { name: /radio group title/i });
    fireEvent.change(titleInput, { target: { value: "View Mode" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as { title: string };
    expect(next.title).toBe("View Mode");
  });
});

// ---------------------------------------------------------------------------
// Save-time validation
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — save-time validation", () => {
  it("calls isValid(true) when all options have valid configPatch + non-empty labels", async () => {
    const isValid = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Class Break",
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: { renderMode: "classbreak" },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={isValid}
        widgets={[mockWidget1]}
      />,
    );

    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      expect(calls.some((v) => v === true)).toBe(true);
    });
  });

  it("calls isValid(false) when options is empty", async () => {
    const isValid = vi.fn();
    render(
      <RadioGroupConfigPanel
        config={{ orientation: "vertical", options: [] }}
        onChange={vi.fn()}
        isValid={isValid}
        widgets={[mockWidget1]}
      />,
    );

    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      expect(calls.some((v) => v === false)).toBe(true);
    });
  });

  it("calls isValid(false) when an option has empty configPatch", async () => {
    const isValid = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Empty",
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: {}, // EMPTY — should fail validation
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={isValid}
        widgets={[mockWidget1]}
      />,
    );

    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      expect(calls.some((v) => v === false)).toBe(true);
    });
  });

  it("calls isValid(false) when an option label is empty", async () => {
    const isValid = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "", // EMPTY label — should fail
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: { renderMode: "classbreak" },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={isValid}
        widgets={[mockWidget1]}
      />,
    );

    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      expect(calls.some((v) => v === false)).toBe(true);
    });
  });

  it("calls isValid(false) when configPatch contains a data-binding key (blocked by denylist)", async () => {
    // Phase 60.1 RE-SCOPE: layer targets use the denylist validator (validateLayerSnapshot).
    // Unknown style keys (e.g. nonexistent_field_xyz) are now ACCEPTED.
    // Data-binding/spatial keys (e.g. table_id, spatialMode) are ALWAYS blocked.
    const isValid = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Bad",
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: { table_id: 99 }, // data-binding key — blocked by denylist
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={isValid}
        widgets={[mockWidget1]}
      />,
    );

    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      expect(calls.some((v) => v === false)).toBe(true);
    });
  });

  it("shows inline validation reasons when option has a data-binding key (denylist blocked)", async () => {
    // Phase 60.1 RE-SCOPE: layer targets use denylist; data-binding keys (spatialMode, table_id, etc.)
    // are always blocked and produce inline validation errors. Unknown style keys pass.
    useDashboardLayersStore.setState({ layers: [mockLayer] });

    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Bad",
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: { spatialMode: "latlon" }, // spatial key — blocked by denylist
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
      />,
    );

    // Validation errors should appear in the DOM
    await waitFor(() => {
      expect(screen.getByTestId("validation-errors-0")).toBeTruthy();
    });

    useDashboardLayersStore.setState({ layers: [] });
  });
});

// ---------------------------------------------------------------------------
// Reads widgets from props (NOT useDashboardContext)
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — reads props.widgets (NOT context)", () => {
  it("renders widget labels from props.widgets", () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Test",
          action: { target: { kind: "widget", id: 1 }, configPatch: {} },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1, mockWidget2]}
      />,
    );

    // Both widget titles from props appear in the target picker
    expect(screen.getByText("My Map")).toBeTruthy();
    expect(screen.getByText("My Bar")).toBeTruthy();
  });

  it("works with props.widgets = [] (no widgets on dashboard)", () => {
    render(
      <RadioGroupConfigPanel
        config={{ orientation: "vertical", options: [] }}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[]}
      />,
    );

    // Should render without error
    expect(screen.getByRole("button", { name: /add option/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Orphan-target warning (SC3 gap-closure)
// ---------------------------------------------------------------------------

describe("RadioGroupConfigPanel — orphan-target warning", () => {
  afterEach(() => {
    useDashboardLayersStore.setState({ layers: [] });
  });

  it("renders orphan-target-warning when the configured widget target id is absent from props.widgets", () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-orphan",
          label: "Gone",
          action: {
            // widget id 999 is NOT in props.widgets (only mockWidget1 id=1 is present)
            target: { kind: "widget", id: 999 },
            configPatch: { show_popup: true },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]} // id=1 only — id=999 is absent
      />,
    );

    expect(screen.getByTestId("orphan-target-warning-0")).toBeTruthy();
  });

  it("does NOT render orphan-target-warning when the configured widget target id resolves in props.widgets", () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-valid",
          label: "Valid",
          action: {
            target: { kind: "widget", id: mockWidget1.id }, // id=1 IS in props.widgets
            configPatch: { show_popup: true },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1, mockWidget2]}
      />,
    );

    expect(screen.queryByTestId("orphan-target-warning-0")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Structured layer editor (Phase 60.1 Plan 03 — full-form side-by-side)
// ---------------------------------------------------------------------------

const mockLayerForStructured: DashboardLayerDto = {
  id: 7,
  dashboard_id: 10,
  table_id: 20,
  layer_type: "KineticaWms",
  position: 0,
  config: { renderMode: "raster", title: "Roads" },
  info_enabled: 0,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "",
  updated_at: "",
};

// The tables prop — matches mockLayerForStructured.table_id = 20
const mockTables: ConfigPanelProps["tables"] = [
  { id: 20, name: "roads", schema: "demo", columns: { CATEGORY: "string", VALUE: "double" } },
];

describe("RadioGroupConfigPanel — structured layer editor (60.1)", () => {
  beforeEach(() => {
    useDashboardLayersStore.setState({ layers: [mockLayerForStructured, mockLayer] });
  });

  afterEach(() => {
    useDashboardLayersStore.setState({ layers: [] });
    cleanup();
  });

  it("1. layer target renders the full form side-by-side (RENDER MODE present, SPATIAL MODE + DATA SOURCE absent)", () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "raster" },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // Full-form wrapper must be present (data-testid from RadioLayerConfigEditor)
    expect(screen.getByTestId("radio-layer-form-0")).toBeTruthy();
    // RENDER MODE must be shown (mock renders id="map-render-mode-label")
    expect(document.getElementById("map-render-mode-label")).toBeTruthy();
    // SPATIAL MODE must be ABSENT (hideSpatialMode=true — mock does NOT render it)
    expect(document.getElementById("map-spatial-mode-label")).toBeNull();
    // DATA SOURCE must be ABSENT (no layer/onDataSourceChange passed — mock does NOT render it)
    expect(screen.queryByText("DATA SOURCE")).toBeNull();
    // Two-pane wrapper is in the DOM
    expect(document.querySelector(".radiogroup-layer-editor")).toBeTruthy();
    // Advanced JSON disclosure still present for layer targets
    expect(screen.getByText(/Advanced \(raw JSON\)/i)).toBeTruthy();
  });

  it("2. editing render mode updates the snapshot (no data-binding keys in emitted configPatch)", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "raster" },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // Click the mock's render-mode button (triggers onChange with renderMode: "classbreak")
    fireEvent.click(screen.getByRole("button", { name: /mock-change-rendermode/i }));

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      options: Array<{ action: { configPatch: Record<string, unknown> } }>;
    };
    const emittedPatch = lastCall.options[0].action.configPatch;

    // renderMode must be present in the emitted patch
    expect(emittedPatch.renderMode).toBe("classbreak");
    // NO data-binding / spatial keys in the snapshot (layerFormToSnapshot strips them)
    expect(emittedPatch.table_id).toBeUndefined();
    expect(emittedPatch.dynamic_view_id).toBeUndefined();
    expect((emittedPatch as Record<string, unknown>).spatialMode).toBeUndefined();
    expect((emittedPatch as Record<string, unknown>).latColumn).toBeUndefined();
  });

  it("3. editing INFO POPUP updates the snapshot's top-level info_enabled", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "raster", info_enabled: 1 },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // Click the mock's info button (triggers onChangeInfoConfig with { info_enabled: 0 })
    fireEvent.click(screen.getByRole("button", { name: /mock-change-info/i }));

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      options: Array<{ action: { configPatch: Record<string, unknown> } }>;
    };
    const emittedPatch = lastCall.options[0].action.configPatch;

    // top-level info_enabled must be 0 (folded in by layerFormToSnapshot via the info patch)
    expect(emittedPatch.info_enabled).toBe(0);
  });

  it("4. Advanced JSON present and round-trips; invalid JSON shows error and does not call onChange", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "raster", track_config: "x" },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // Open the Advanced disclosure by clicking summary
    const summaryEl = screen.getByText(/Advanced \(raw JSON\)/i);
    fireEvent.click(summaryEl);

    // JSON textarea is now reachable
    const textarea = screen.getByRole("textbox", { name: /option 1 config patch json/i });
    expect(textarea).toBeTruthy();

    // Valid JSON round-trip: write a JSON with a non-surfaced key
    fireEvent.change(textarea, {
      target: { value: '{"renderMode":"raster","track_config":"x"}' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const nextCall = onChange.mock.calls[0][0] as {
      options: Array<{ action: { configPatch: Record<string, unknown> } }>;
    };
    expect(nextCall.options[0].action.configPatch).toEqual({ renderMode: "raster", track_config: "x" });

    onChange.mockClear();

    // Invalid JSON: error shown, onChange NOT called
    fireEvent.change(textarea, { target: { value: "{invalid json" } });
    expect(screen.getByTestId("json-error-0")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("5. non-surfaced key track_config survives a structured-editor write (MERGE + adapter round-trip)", () => {
    const onChange = vi.fn();
    // Start with a configPatch that already carries track_config (non-surfaced key)
    // snapshotToLayerForm lifts track_config into the form config blob, so layerFormToSnapshot
    // will write it back to the snapshot top-level (not stripped by STRIP set).
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "raster", track_config: "keepme" },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={onChange}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // Drive a structured change (the mock emits onChange with config that includes track_config)
    fireEvent.click(screen.getByRole("button", { name: /mock-change-rendermode/i }));

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      options: Array<{ action: { configPatch: Record<string, unknown> } }>;
    };
    const emittedPatch = lastCall.options[0].action.configPatch;

    // track_config must survive — it's in the existing configPatch and the MERGE preserves it.
    // The panel merges: { ...option.action.configPatch, ...nextPatch }
    // nextPatch from layerFormToSnapshot includes track_config (lifted by snapshotToLayerForm
    // and passed through the mock's config spread, then written back by layerFormToSnapshot).
    // Either way, the MERGE ensures track_config is present.
    expect(emittedPatch.track_config).toBe("keepme");
    // renderMode also updated
    expect(emittedPatch.renderMode).toBe("classbreak");
  });

  it("6. widget target unchanged — JSON textarea rendered directly (no Advanced disclosure, no radio-layer-form)", () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-widget",
          label: "Test",
          action: { target: { kind: "widget", id: mockWidget1.id }, configPatch: { show_popup: true } },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // No radio-layer-form wrapper for widget targets
    expect(screen.queryByTestId("radio-layer-form-0")).toBeNull();
    // JSON textarea is rendered directly (NOT inside an Advanced disclosure)
    expect(screen.getByRole("textbox", { name: /option 1 config patch json/i })).toBeTruthy();
    // No Advanced summary for widget targets
    expect(screen.queryByText(/Advanced \(raw JSON\)/i)).toBeNull();
    // No two-pane wrapper
    expect(document.querySelector(".radiogroup-layer-editor")).toBeNull();
  });

  it("7. dynamicView target unchanged — JSON textarea rendered directly (no Advanced disclosure)", async () => {
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-dv",
          label: "My DV Option",
          action: { target: { kind: "dynamicView", id: 99 }, configPatch: { some_field: true } },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={config}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // Wait for dynamic views to load
    await waitFor(() => {
      expect(screen.getByText("My DV")).toBeTruthy();
    });

    // No radio-layer-form wrapper for dv targets
    expect(screen.queryByTestId("radio-layer-form-0")).toBeNull();
    // JSON textarea is rendered directly
    expect(screen.getByRole("textbox", { name: /option 1 config patch json/i })).toBeTruthy();
    // No Advanced summary for dv targets
    expect(screen.queryByText(/Advanced \(raw JSON\)/i)).toBeNull();
  });
});
