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
 * Phase 60.1 Plan 02 additions — structured layer editor (60.1):
 *   - layer target shows render-mode select + Advanced (raw JSON) disclosure
 *   - classbreak renders CbConfigForm (real selector asserted via mock stub)
 *   - edits write flat top-level cb_config (no nested config key)
 *   - Advanced JSON still present + round-trips; invalid JSON shows error
 *   - non-surfaced keys like track_config survive a structured-editor write (MERGE)
 *   - zero-break classbreak is invalid: validation reason shown + isValid(false) (CONTEXT line 50)
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

  it("calls isValid(false) when configPatch contains out-of-list keys", async () => {
    const isValid = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Bad",
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: { nonexistent_field_xyz: true }, // out-of-list
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

  it("shows inline validation reasons when option is invalid", async () => {
    useDashboardLayersStore.setState({ layers: [mockLayer] });

    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-1",
          label: "Bad",
          action: {
            target: { kind: "layer", id: mockLayer.id },
            configPatch: { fake_key: 123 }, // out-of-list
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
// Structured layer editor (Phase 60.1)
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
  });

  it("1. layer target shows the render-mode select and Advanced disclosure (not plain JSON textarea)", () => {
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

    // Render-mode select must be present
    expect(screen.getByTestId("radio-layer-rendermode-0")).toBeTruthy();
    // Advanced disclosure summary must be present (JSON is inside collapsed details)
    expect(screen.getByText(/Advanced \(raw JSON\)/i)).toBeTruthy();
    // The "Config Patch (JSON)" label must be inside a <details> element (not directly visible)
    const details = document.querySelector("details.radio-advanced-json");
    expect(details).toBeTruthy();
    const configPatchLabel = details?.querySelector(".ds-field-label");
    expect(configPatchLabel?.textContent).toBe("Config Patch (JSON)");
  });

  it("2. choosing classbreak renders CbConfigForm; raster hides it", () => {
    // Part A: raster mode — cbform testid absent
    const rasterConfig: Record<string, unknown> = {
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

    const { unmount: unmountA } = render(
      <RadioGroupConfigPanel
        config={rasterConfig}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // For raster, cbform testid is absent
    expect(screen.queryByTestId("radio-layer-cbform-0")).toBeNull();
    unmountA();

    // Part B: classbreak mode — CbConfigForm stub renders
    const cbConfig: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "classbreak", cb_config: '{"breaks":[]}' },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={cbConfig}
        onChange={vi.fn()}
        isValid={vi.fn()}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    // CbConfigForm container appears — and the real CbConfigForm selectors are present
    // (our stub renders aria-label="CB column" and aria-label="+ Add break")
    expect(screen.getByTestId("radio-layer-cbform-0")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "CB column" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add break" })).toBeTruthy();
  });

  it("3. editing breaks updates configPatch.cb_config at flat top-level (no nested config key)", () => {
    const onChange = vi.fn();
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "classbreak", cb_config: '{"breaks":[]}' },
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

    // CbConfigForm stub is rendered (classbreak is the initial render mode)
    expect(screen.getByTestId("radio-layer-cbform-0")).toBeTruthy();

    // Click "+ Add break" on the stub — triggers onChange
    fireEvent.click(screen.getByRole("button", { name: "+ Add break" }));

    // The last onChange call should have an option with cb_config at TOP-LEVEL
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      options: Array<{ action: { configPatch: Record<string, unknown> } }>;
    };
    const emittedPatch = lastCall.options[0].action.configPatch;

    // cb_config must be a top-level string key (not nested inside a config key)
    expect(typeof emittedPatch.cb_config).toBe("string");
    expect(emittedPatch.config).toBeUndefined(); // NO nested config key
    // Only allow-listed keys present — no spatialMode, lonColumn, etc.
    const patchKeys = Object.keys(emittedPatch);
    const allowListed = ["renderMode", "cb_config", "visible", "opacity"];
    for (const key of patchKeys) {
      expect(allowListed).toContain(key);
    }
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
    const summaryEl = screen.getByText(/Advanced/i);
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

  it("5. non-surfaced keys like track_config survive a structured-editor write (MERGE)", () => {
    const onChange = vi.fn();
    // Start with a configPatch that already carries track_config (non-surfaced key)
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "classbreak", cb_config: "{}", track_config: "keepme" },
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

    // Drive a render-mode change via the select (from classbreak to raster)
    const rmSelect = screen.getByTestId("radio-layer-rendermode-0");
    fireEvent.change(rmSelect, { target: { value: "raster" } });

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      options: Array<{ action: { configPatch: Record<string, unknown> } }>;
    };
    const emittedPatch = lastCall.options[0].action.configPatch;

    // track_config (non-surfaced key) MUST survive the structured write (MERGE behaviour)
    expect(emittedPatch.track_config).toBe("keepme");
    // The new renderMode is also present
    expect(emittedPatch.renderMode).toBe("raster");
  });

  it("6. zero-break classbreak option is invalid — shows validation reason AND signals isValid(false)", async () => {
    const isValid = vi.fn();
    // Start with a classbreak option with zero breaks (cb_config has empty breaks array)
    const config: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: { renderMode: "classbreak", cb_config: '{"breaks":[]}' },
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
        tables={mockTables}
      />,
    );

    // (a) Validation reason shown: the option row must display the zero-break reason
    await waitFor(() => {
      expect(screen.getByTestId("validation-errors-0")).toBeTruthy();
    });
    expect(screen.getByText(/at least one break/i)).toBeTruthy();

    // (b) The panel's isValid prop must have been called with false (Apply disabled)
    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      expect(calls.some((v) => v === false)).toBe(true);
    });

    // Conversely: a classbreak with ≥2 breaks (stub fires isValid(true)) does NOT add
    // that reason — render with 2 breaks to verify (in a fresh DOM)
    cleanup(); // remove previous render so its DOM nodes don't bleed through
    isValid.mockClear();
    const configValid: Record<string, unknown> = {
      orientation: "vertical",
      options: [
        {
          id: "opt-layer2",
          label: "Roads",
          action: {
            target: { kind: "layer", id: mockLayerForStructured.id },
            configPatch: {
              renderMode: "classbreak",
              cb_config: JSON.stringify({ breaks: [{ value: "a" }, { value: "b" }] }),
            },
          },
        },
      ],
    };

    render(
      <RadioGroupConfigPanel
        config={configValid}
        onChange={vi.fn()}
        isValid={isValid}
        widgets={[mockWidget1]}
        tables={mockTables}
      />,
    );

    await waitFor(() => {
      const calls = isValid.mock.calls.map((c) => c[0] as boolean);
      // Should have called isValid(true) at some point (≥2 breaks, cb is valid)
      expect(calls.some((v) => v === true)).toBe(true);
    });
    // The zero-break reason must not appear for the second (valid) render
    expect(screen.queryAllByText(/at least one break/i)).toHaveLength(0);
  });

  it("7. widget target unchanged — JSON textarea rendered directly (no Advanced disclosure, no render-mode select)", () => {
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

    // No render-mode select for widget targets
    expect(screen.queryByTestId("radio-layer-rendermode-0")).toBeNull();
    // JSON textarea is rendered directly (NOT inside an Advanced disclosure)
    expect(screen.getByRole("textbox", { name: /option 1 config patch json/i })).toBeTruthy();
    // No Advanced summary for widget targets
    expect(screen.queryByText(/Advanced \(raw JSON\)/i)).toBeNull();
  });

  it("7b. dynamicView target unchanged — JSON textarea rendered directly (no Advanced disclosure, no render-mode select)", async () => {
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

    // No render-mode select for dv targets
    expect(screen.queryByTestId("radio-layer-rendermode-0")).toBeNull();
    // JSON textarea is rendered directly
    expect(screen.getByRole("textbox", { name: /option 1 config patch json/i })).toBeTruthy();
    // No Advanced summary for dv targets
    expect(screen.queryByText(/Advanced \(raw JSON\)/i)).toBeNull();
  });
});
