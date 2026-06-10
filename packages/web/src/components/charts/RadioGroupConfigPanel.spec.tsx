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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
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
