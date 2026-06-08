/**
 * Phase 39 Plan 02+03: CbConfigForm spec
 *
 * Covers (Plan 02): column picker, break-row builder, per-row advanced chevron,
 * form-level Advanced override checkbox, column-change rules,
 * isValid signaling, legacy-field exclusion.
 *
 * Covers (Plan 03): categorical <other> toggle, probeCardinality wiring,
 * value validation (empty/duplicate), Auto-suggest button + N slider +
 * modal-confirm + AbortController + error UX.
 */

import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CbConfigForm from "./CbConfigForm";

/* ------------------------------------------------------------------ */
/*  Mocks — Plan 39-03 additions                                       */
/* ------------------------------------------------------------------ */

vi.mock("../../store/toast", () => ({
  useToastStore: { getState: vi.fn(() => ({ showToast: vi.fn() })) },
}));

vi.mock("../../lib/cardinalityProbe", () => ({
  probeCardinality: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  quantileFn: vi.fn(),
  topValuesFn: vi.fn(),
  columnStatsFn: vi.fn(),
}));

import { probeCardinality } from "../../lib/cardinalityProbe";
import { useToastStore } from "../../store/toast";
import { quantileFn, topValuesFn, columnStatsFn } from "../../api/client";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const baseColumns = [
  { name: "fare", type: "double" },
  { name: "tip", type: "double" },
  { name: "vendor", type: "varchar" },
  { name: "geom_wkb", type: "BYTES" },
  { name: "geom_wkt", type: "wkt" },
  { name: "lat", type: "double" },
  { name: "lon", type: "double" },
];

const baseConfig: Record<string, unknown> = {
  latColumn: "lat",
  lonColumn: "lon",
};

function makeCbConfig(
  cb: Partial<{
    attr: string;
    valsType: "numeric" | "categorical";
    breaks: Array<Record<string, unknown>>;
    includeOtherBucket: boolean;
  }>,
): Record<string, unknown> {
  return {
    ...baseConfig,
    cb_config: JSON.stringify({
      attr: "",
      valsType: "numeric",
      breaks: [],
      ...cb,
    }),
  };
}

/** Parse the first arg of the first onChange call and extract cb_config */
function parsedCbFromOnChange(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const callArg = onChange.mock.calls[0][0] as Record<string, unknown>;
  return JSON.parse(callArg.cb_config as string) as Record<string, unknown>;
}

/** Parse the first arg of the LAST onChange call and extract cb_config */
function parsedCbFromLastOnChange(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const callArg = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Record<string, unknown>;
  return JSON.parse(callArg.cb_config as string) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe("CbConfigForm", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onChange: ReturnType<typeof vi.fn> & ((config: Record<string, unknown>) => void);
  let showToastSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange = vi.fn() as any;
    showToastSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useToastStore.getState).mockReturnValue({ showToast: showToastSpy as any } as any);
    vi.mocked(probeCardinality).mockReset();
    vi.mocked(quantileFn).mockReset();
    vi.mocked(topValuesFn).mockReset();
    vi.mocked(columnStatsFn).mockReset();
    // Default: categorical column-select fires a top-50 suggestions fetch on mount;
    // give it a benign resolved value so that effect never rejects. Specific tests
    // override with their own mockResolvedValue when they assert the fill.
    vi.mocked(topValuesFn).mockResolvedValue({ values: [] });
  });

  /* ── Column picker ───────────────────────────────────────────────── */

  it("renders column picker with eligible columns", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    const select = screen.getByLabelText("CB column");
    expect(select).toBeInTheDocument();
    // fare and tip are numeric/double, vendor is varchar — all eligible
    expect(within(select as HTMLElement).getByRole("option", { name: "fare" })).toBeInTheDocument();
    expect(within(select as HTMLElement).getByRole("option", { name: "tip" })).toBeInTheDocument();
    expect(within(select as HTMLElement).getByRole("option", { name: "vendor" })).toBeInTheDocument();
  });

  it("excludes WKB-binary columns from picker", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    const select = screen.getByLabelText("CB column") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain("geom_wkb");
  });

  it("excludes WKT spatial columns from picker (filterCbEligibleColumns native behavior)", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    const select = screen.getByLabelText("CB column") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain("geom_wkt");
  });

  it("excludes spatial-bound columns (lat/lon) from picker", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    const select = screen.getByLabelText("CB column") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain("lat");
    expect(optionValues).not.toContain("lon");
  });

  it("shows WKB inline message when WKB columns present", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    expect(
      screen.getByText("WKB columns not supported for classbreak in v1.7"),
    ).toBeInTheDocument();
  });

  it("selecting numeric column emits cb_config with valsType='numeric'", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "fare" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect(cb.attr).toBe("fare");
    expect(cb.valsType).toBe("numeric");
  });

  it("selecting categorical column emits cb_config with valsType='categorical'", () => {
    render(<CbConfigForm config={baseConfig} onChange={onChange} columns={baseColumns} />);
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect(cb.attr).toBe("vendor");
    expect(cb.valsType).toBe("categorical");
  });

  /* ── [+ Add break] ───────────────────────────────────────────────── */

  it("[+ Add break] disabled when no column selected", () => {
    render(<CbConfigForm config={makeCbConfig({ attr: "" })} onChange={onChange} columns={baseColumns} />);
    const btn = screen.getByRole("button", { name: "+ Add break" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("[+ Add break] enabled when column selected; clicking emits cb_config with new default break", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const btn = screen.getByRole("button", { name: "+ Add break" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>).length).toBe(1);
    const b0 = (cb.breaks as Array<Record<string, unknown>>)[0];
    expect(b0.value).toBe(0);
    expect(typeof b0.color).toBe("string");
    expect((b0.color as string).length).toBe(8);
    expect(b0.label).toBe("");
    expect(b0.pointSize).toBe(5);
    expect(b0.pointShape).toBe("circle");
    expect(b0.shapeLineWidth).toBe(1);
    expect(b0.shapeLineColor).toBe("FF000000");
    expect(b0.shapeFillColor).toBe("FFFFFFFF");
  });

  it("remove button on row 1 emits cb_config with breaks.length decreased and row 1 removed", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "A", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 20, color: "FFEF4444", label: "B", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const removeBtn = screen.getByLabelText("Remove break 1");
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>).length).toBe(1);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].value).toBe(20);
  });

  it("editing numeric min/max emits onChange with breaks[i].min/max as numbers", () => {
    const breaks = [
      { value: 0, min: 0, max: 0, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const maxInput = screen.getByLabelText("Max for break 1");
    fireEvent.change(maxInput, { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].max).toBe(42);
  });

  it("editing label emits onChange with breaks[i].label as string", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const labelInput = screen.getByLabelText("Label for break 1");
    fireEvent.change(labelInput, { target: { value: "My label" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].label).toBe("My label");
  });

  it("editing color via text input emits onChange with breaks[i].color normalized to 8-char AARRGGBB", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const colorTextInput = screen.getByLabelText("Color (AARRGGBB hex) for break 1");
    fireEvent.change(colorTextInput, { target: { value: "FF112233" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    const color = (cb.breaks as Array<Record<string, unknown>>)[0].color as string;
    expect(color.length).toBe(8);
    expect(color).toBe("FF112233");
  });

  /* ── Form-level Advanced section ────────────────────────────────── */

  it("advanced header click reveals 'Treat numeric column as categorical' checkbox; checking it flips valsType to categorical", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    // Advanced panel is closed initially
    expect(screen.queryByLabelText("Treat numeric column as categorical")).toBeNull();

    // Click the Advanced header button
    const advBtn = screen.getByRole("button", { name: /Advanced/i });
    fireEvent.click(advBtn);

    // Checkbox appears
    const checkbox = screen.getByLabelText("Treat numeric column as categorical") as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(false);

    // Check it
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect(cb.valsType).toBe("categorical");
  });

  /* ── Column-change rules ─────────────────────────────────────────── */

  it("switching from numeric to varchar column preserves breaks count + colors + labels by index, clears values to ''", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "A", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 20, color: "FFEF4444", label: "B", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    // count preserved (+ otherBucket appended)
    expect(resultBreaks.length).toBeGreaterThanOrEqual(2);
    // colors preserved by index
    expect(resultBreaks[0].color).toBe("FF3B82F6");
    expect(resultBreaks[1].color).toBe("FFEF4444");
    // labels preserved by index
    expect(resultBreaks[0].label).toBe("A");
    expect(resultBreaks[1].label).toBe("B");
    // values cleared to '' (categorical default)
    expect(resultBreaks[0].value).toBe("");
    expect(resultBreaks[1].value).toBe("");
    // valsType updated
    expect(cb.valsType).toBe("categorical");
  });

  it("switching from numeric to numeric column preserves all break fields including values", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "A", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "tip" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    expect(resultBreaks[0].value).toBe(10);
    expect(resultBreaks[0].color).toBe("FF3B82F6");
    expect(resultBreaks[0].label).toBe("A");
  });

  /* ── isValid signaling ──────────────────────────────────────────── */

  it("isValid(true) called when breaks.length >= 2 and all numeric ranges valid (min < max)", () => {
    const isValid = vi.fn();
    const breaks = [
      { value: 0, min: 0, max: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 0, min: 10, max: 20, color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
        isValid={isValid}
      />,
    );
    const calls = isValid.mock.calls.map((c) => c[0]);
    expect(calls.some((v) => v === true)).toBe(true);
    expect(calls.every((v) => v !== false)).toBe(true);
  });

  it("isValid(false) called when breaks.length < 2", () => {
    const isValid = vi.fn();
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        isValid={isValid}
      />,
    );
    const lastCall = isValid.mock.calls[isValid.mock.calls.length - 1];
    expect(lastCall[0]).toBe(false);
  });

  it("isValid(false) called when categorical break has empty string value", () => {
    const isValid = vi.fn();
    const breaks = [
      { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: "", color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks })}
        onChange={onChange}
        columns={baseColumns}
        isValid={isValid}
      />,
    );
    const lastCall = isValid.mock.calls[isValid.mock.calls.length - 1];
    expect(lastCall[0]).toBe(false);
  });

  /* ── Per-row advanced panel ──────────────────────────────────────── */

  it("per-row chevron expands advanced panel showing 5 fields (pointSize, pointShape, shapeLineWidth, shapeLineColor, shapeFillColor)", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    // Panel not visible initially
    expect(screen.queryByTestId("cb-row-advanced-0")).toBeNull();

    // Click toggle button
    const toggleBtn = screen.getByLabelText("Toggle advanced for row 1");
    fireEvent.click(toggleBtn);

    // Panel is now visible
    const panel = screen.getByTestId("cb-row-advanced-0");
    expect(panel).toBeInTheDocument();
    expect(screen.getByLabelText("Point size for break 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Point shape for break 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Shape line width for break 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Shape line color (AARRGGBB hex) for break 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Shape fill color (AARRGGBB hex) for break 1")).toBeInTheDocument();
  });

  it("pointSize input clamps to 1-20 range — 0 → 1, 50 → 20", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle advanced for row 1"));

    const pointSizeInput = screen.getByLabelText("Point size for break 1");

    // Test clamp low: 0 → 1
    fireEvent.change(pointSizeInput, { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    let cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].pointSize).toBe(1);
    onChange.mockClear();

    // Test clamp high: 50 → 20
    fireEvent.change(pointSizeInput, { target: { value: "50" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].pointSize).toBe(20);
  });

  it("pointShape dropdown lists the full Kinetica POINT_SHAPES set", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle advanced for row 1"));
    const shapeSelect = screen.getByLabelText("Point shape for break 1") as HTMLSelectElement;
    const optionValues = Array.from(shapeSelect.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "none", "circle", "dash", "diamond", "dot",
      "hollowcircle", "hollowdiamond", "hollowsquare", "hollowsquarewithplus",
      "pipe", "plus", "square",
    ]);
  });

  it("shapeLineWidth input clamps to 1-20", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle advanced for row 1"));

    const slwInput = screen.getByLabelText("Shape line width for break 1");

    // 0 → 1
    fireEvent.change(slwInput, { target: { value: "0" } });
    let cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].shapeLineWidth).toBe(1);
    onChange.mockClear();

    // 99 → 20
    fireEvent.change(slwInput, { target: { value: "99" } });
    cb = parsedCbFromOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>)[0].shapeLineWidth).toBe(20);
  });

  /* ── Legacy field guard ──────────────────────────────────────────── */

  it("form NEVER writes config.cbColumn or config.classbreaks on any onChange call", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    const cfg = makeCbConfig({ attr: "fare", valsType: "numeric", breaks });
    render(
      <CbConfigForm
        config={cfg}
        onChange={onChange}
        columns={baseColumns}
      />,
    );

    // Add a break
    fireEvent.click(screen.getByRole("button", { name: "+ Add break" }));

    // All onChange calls must not contain cbColumn or classbreaks
    for (const call of onChange.mock.calls) {
      const arg = call[0] as Record<string, unknown>;
      expect("cbColumn" in arg).toBe(false);
      expect("classbreaks" in arg).toBe(false);
    }
  });

  /* ── Plan 39-03: Categorical <other> toggle ────────────────────── */

  it("in categorical mode, [✓] Include <other> bucket checkbox is rendered above the rows", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [], includeOtherBucket: false })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    expect(screen.getByLabelText("Include <other> bucket")).toBeInTheDocument();
  });

  it("in numeric mode, [✓] Include <other> bucket checkbox is NOT rendered", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    expect(screen.queryByLabelText("Include <other> bucket")).toBeNull();
  });

  it("toggling <other> checkbox ON appends a break with value === '<other>' at end of breaks", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ], includeOtherBucket: false })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const checkbox = screen.getByLabelText("Include <other> bucket") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    expect(resultBreaks[resultBreaks.length - 1].value).toBe("<other>");
  });

  it("toggling <other> checkbox ON with <other> row already present does NOT duplicate the row (idempotent)", () => {
    // Render with includeOtherBucket=false BUT <other> row already in breaks (orphaned state)
    // Toggling ON should not add a second <other> row
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "<other>", color: "FF888888", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ], includeOtherBucket: false })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const checkbox = screen.getByLabelText("Include <other> bucket") as HTMLInputElement;
    // Checkbox is unchecked (includeOtherBucket=false); clicking it toggles ON
    // Handler should detect existing <other> row and NOT add another
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    const otherCount = resultBreaks.filter((b) => b.value === "<other>").length;
    expect(otherCount).toBe(1);
  });

  it("toggling <other> checkbox OFF removes breaks with value === '<other>' AND shows NULL warning", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "<other>", color: "FF888888", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ], includeOtherBucket: true })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    // Uncheck the checkbox
    const checkbox = screen.getByLabelText("Include <other> bucket") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    expect(resultBreaks.every((b) => b.value !== "<other>")).toBe(true);
    // Warning message visible (the config has includeOtherBucket=false after toggle)
  });

  it("NULL values warning shown when includeOtherBucket is false in categorical mode", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [], includeOtherBucket: false })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    expect(screen.getByText("NULL values will not appear in the map.")).toBeInTheDocument();
  });

  it("the <other> row's value field is rendered as a read-only chip, NOT an editable input", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "<other>", color: "FF888888", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ], includeOtherBucket: true })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    // The <other> chip should be a span, not an input
    expect(screen.getByTestId("cb-other-chip-1")).toBeInTheDocument();
    // No value input for row 2 (the <other> row)
    expect(screen.queryByLabelText("Value for break 2")).toBeNull();
  });

  it("the remove button on the <other> row is disabled", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "<other>", color: "FF888888", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ], includeOtherBucket: true })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    const removeOtherBtn = screen.getByLabelText("Remove break 2") as HTMLButtonElement;
    expect(removeOtherBtn.disabled).toBe(true);
  });

  /* ── Plan 39-03: probeCardinality wiring ────────────────────────── */

  it("in categorical mode, selecting an attr column fires probeCardinality + shows loading hint", async () => {
    // probeCardinality never resolves in this test (leaves it loading)
    vi.mocked(probeCardinality).mockImplementation(() => new Promise(() => {}));

    render(
      <CbConfigForm
        config={baseConfig}
        onChange={onChange}
        columns={baseColumns}
        tableRef="ki_home.taxi"
      />,
    );
    // vendor is categorical
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });

    await waitFor(() => {
      expect(screen.getByText("Counting distinct values…")).toBeInTheDocument();
    });
    expect(vi.mocked(probeCardinality)).toHaveBeenCalledWith("ki_home.taxi", "vendor", expect.any(AbortSignal));
  });

  it("probeCardinality NOT called when selecting a numeric column", async () => {
    vi.mocked(probeCardinality).mockResolvedValue(5);

    render(
      <CbConfigForm
        config={baseConfig}
        onChange={onChange}
        columns={baseColumns}
        tableRef="ki_home.taxi"
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "fare" } });

    // Wait a tick; probeCardinality should NOT have been called
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(probeCardinality)).not.toHaveBeenCalled();
  });

  it("when probeCardinality returns 50, no toast is fired", async () => {
    vi.mocked(probeCardinality).mockResolvedValue(50);

    render(
      <CbConfigForm
        config={baseConfig}
        onChange={onChange}
        columns={baseColumns}
        tableRef="ki_home.taxi"
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });

    await waitFor(() => {
      expect(vi.mocked(probeCardinality)).toHaveBeenCalled();
    });
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it("when probeCardinality returns 150 (>100 <=256), showToast called with 'permission' kind", async () => {
    vi.mocked(probeCardinality).mockResolvedValue(150);

    render(
      <CbConfigForm
        config={baseConfig}
        onChange={onChange}
        columns={baseColumns}
        tableRef="ki_home.taxi"
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("That's a lot of breakpoints"),
        "permission",
      );
    });
  });

  it("when probeCardinality returns 300 (>256), showToast called with 'error' kind containing 'Kinetica classbreak supports up to 256'", async () => {
    vi.mocked(probeCardinality).mockResolvedValue(300);

    render(
      <CbConfigForm
        config={baseConfig}
        onChange={onChange}
        columns={baseColumns}
        tableRef="ki_home.taxi"
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining("256"),
        "error",
      );
    });
  });

  it("when probeCardinality returns >256, [+ Add break] button is disabled (hard cap)", async () => {
    vi.mocked(probeCardinality).mockResolvedValue(300);

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        tableRef="ki_home.taxi"
      />,
    );

    // Trigger column select to fire probe
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });

    await waitFor(() => {
      expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining("256"), "error");
    });

    // After probe resolves, [+ Add break] should be disabled
    const addBtn = screen.getByRole("button", { name: "+ Add break" }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  /* ── Plan 39-03: Categorical value validation ───────────────────── */

  it("categorical break with empty value shows inline 'Value cannot be empty' error text", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "cat1", color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    expect(screen.getByTestId("cb-row-error-0")).toHaveTextContent("Value cannot be empty");
  });

  it("categorical breaks with duplicate non-empty values show inline 'Duplicate value' error", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "cat1", color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    expect(screen.getByTestId("cb-row-error-0")).toHaveTextContent("Duplicate value");
    expect(screen.getByTestId("cb-row-error-1")).toHaveTextContent("Duplicate value");
  });

  it("the <other> bucket row is whitelisted from duplicate check", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "<other>", color: "FF888888", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ], includeOtherBucket: true })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    // No errors on any row
    expect(screen.queryByTestId("cb-row-error-0")).toBeNull();
    expect(screen.queryByTestId("cb-row-error-1")).toBeNull();
  });

  it("isValid(false) when categorical breaks have duplicate values", () => {
    const isValid = vi.fn();
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "cat1", color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
        isValid={isValid}
      />,
    );
    const lastCall = isValid.mock.calls[isValid.mock.calls.length - 1];
    expect(lastCall[0]).toBe(false);
  });

  it("isValid(true) when all categorical breaks have unique non-empty values", () => {
    const isValid = vi.fn();
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [
          { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: "cat2", color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
        isValid={isValid}
      />,
    );
    const calls = isValid.mock.calls.map((c) => c[0]);
    expect(calls.some((v) => v === true)).toBe(true);
    expect(calls.every((v) => v !== false)).toBe(true);
  });

  it("column-change from numeric to categorical clears values to '', sets includeOtherBucket=true, appends <other> row", () => {
    const breaks = [
      { value: 10, color: "FF3B82F6", label: "A", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 20, color: "FFEF4444", label: "B", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.change(screen.getByLabelText("CB column"), { target: { value: "vendor" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const cb = parsedCbFromOnChange(onChange);
    expect(cb.valsType).toBe("categorical");
    expect(cb.includeOtherBucket).toBe(true);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    // Last break should be <other>
    expect(resultBreaks[resultBreaks.length - 1].value).toBe("<other>");
    // Regular breaks have cleared values
    expect(resultBreaks[0].value).toBe("");
    expect(resultBreaks[1].value).toBe("");
  });

  /* ── Plan 39-03: Auto-suggest button + N slider ─────────────────── */

  it("Auto-suggest button and N slider are visible only when valsType='numeric' AND attr is selected", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    expect(screen.getByLabelText("Auto-suggest breaks")).toBeInTheDocument();
    expect(screen.getByLabelText("N (number of break rows)")).toBeInTheDocument();
  });

  it("Auto-suggest button is present in categorical mode (top-values fill)", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor", valsType: "categorical", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    expect(screen.getByLabelText("Auto-suggest breaks")).toBeInTheDocument();
  });

  it("Auto-suggest button is absent when no attr selected", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    expect(screen.queryByLabelText("Auto-suggest breaks")).toBeNull();
  });

  it("N slider default value is 5, min=2, max=16", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    const slider = screen.getByLabelText("N (number of break rows)") as HTMLInputElement;
    expect(slider.value).toBe("5");
    expect(slider.min).toBe("2");
    expect(slider.max).toBe("16");
    expect(screen.getByTestId("cb-n-value").textContent).toBe("5");
  });

  it("changing N slider updates the displayed value", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    const slider = screen.getByLabelText("N (number of break rows)");
    fireEvent.change(slider, { target: { value: "7" } });
    expect(screen.getByTestId("cb-n-value").textContent).toBe("7");
  });

  it("clicking Auto-suggest with no existing breaks calls quantileFn directly (no modal)", async () => {
    vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] });
    // Phase 44 follow-up: quantile auto-suggest now ALSO parallel-fetches columnStatsFn
    // to close the outer buckets with the column's true min/max (Kinetica CB_VALS requires
    // closed ranges; open-ended buckets are not a valid config).
    vi.mocked(columnStatsFn).mockResolvedValueOnce({ min: 0, max: 50, mean: 25, stddev: 14 });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    // No confirm dialog
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    expect(vi.mocked(quantileFn)).toHaveBeenCalledWith(
      { schema: "ki_home", table: "taxi", column: "fare", n: 5 },
      expect.any(AbortSignal),
    );
    expect(vi.mocked(columnStatsFn)).toHaveBeenCalledWith(
      { schema: "ki_home", table: "taxi", column: "fare" },
      expect.any(AbortSignal),
    );
    expect(onChange).toHaveBeenCalled();
    const cb = parsedCbFromLastOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>).length).toBe(5);
  });

  it("categorical value inputs offer a datalist of top-50 suggested values (still free-text)", async () => {
    vi.mocked(topValuesFn).mockResolvedValue({ values: ["NYC", "YCAB", "VTS"] });

    render(
      <CbConfigForm
        config={makeCbConfig({
          attr: "vendor_id",
          valsType: "categorical",
          breaks: [
            { value: "", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          ],
          includeOtherBucket: false,
        })}
        onChange={onChange}
        columns={baseColumns}
        schema="demo"
        tableName="nyctaxi"
      />,
    );

    // Top-50 fetch fires on mount for the selected categorical column
    expect(vi.mocked(topValuesFn)).toHaveBeenCalledWith(
      { schema: "demo", table: "nyctaxi", column: "vendor_id", n: 50 },
      expect.any(AbortSignal),
    );

    // datalist populates with the suggested values; value input references it (free-text still allowed)
    await waitFor(() => {
      const dl = document.getElementById("cb-value-suggestions");
      expect(dl).not.toBeNull();
      const opts = Array.from(dl!.querySelectorAll("option")).map((o) => o.getAttribute("value"));
      expect(opts).toEqual(["NYC", "YCAB", "VTS"]);
    });
    const valueInput = screen.getByLabelText("Value for break 1");
    expect(valueInput).toHaveAttribute("list", "cb-value-suggestions");
  });

  it("categorical Auto-suggest calls topValuesFn and fills break rows with the top values", async () => {
    vi.mocked(topValuesFn).mockResolvedValue({ values: ["NYC", "YCAB", "VTS"] });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor_id", valsType: "categorical", breaks: [], includeOtherBucket: false })}
        onChange={onChange}
        columns={baseColumns}
        schema="demo"
        tableName="nyctaxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    expect(vi.mocked(topValuesFn)).toHaveBeenCalledWith(
      { schema: "demo", table: "nyctaxi", column: "vendor_id", n: 5 },
      expect.any(AbortSignal),
    );
    expect(vi.mocked(quantileFn)).not.toHaveBeenCalled();
    const cb = parsedCbFromLastOnChange(onChange);
    const rows = cb.breaks as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.value)).toEqual(["NYC", "YCAB", "VTS"]);
    // shape line color matches each break's point color; shape fill = same RGB, CC alpha
    rows.forEach((r) => {
      const color = r.color as string;
      expect(r.shapeLineColor).toBe(color);
      expect(r.shapeFillColor).toBe("CC" + color.slice(2));
    });
  });

  it("selecting a color theme recolors all break rows by index (8-char AARRGGBB)", () => {
    const breaks = [
      { value: 0, min: 0, max: 10, color: "FFAAAAAA", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 0, min: 10, max: 20, color: "FFBBBBBB", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 0, min: 20, max: 30, color: "FFCCCCCC", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.change(screen.getByLabelText("Color theme"), { target: { value: "Blues" } });
    const cb = parsedCbFromLastOnChange(onChange);
    const rows = cb.breaks as Array<Record<string, unknown>>;
    // Blues 3-class set, FF alpha
    expect(rows.map((r) => r.color)).toEqual(["FFDEEBF7", "FF9ECAE1", "FF3182BD"]);
    // shape line color matches point color; shape fill is the same RGB, slightly transparent (CC alpha)
    expect(rows.map((r) => r.shapeLineColor)).toEqual(["FFDEEBF7", "FF9ECAE1", "FF3182BD"]);
    expect(rows.map((r) => r.shapeFillColor)).toEqual(["CCDEEBF7", "CC9ECAE1", "CC3182BD"]);
  });

  it("color theme repeats colors when there are more breaks than palette colors", () => {
    // 11 numeric breaks; Blues max variant is 9 → colors[9],[10] repeat colors[0],[1]
    const breaks = Array.from({ length: 11 }, (_, i) => ({
      value: 0, min: i, max: i + 1, color: "FF000000", label: "",
      pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF",
    }));
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks })}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    fireEvent.change(screen.getByLabelText("Color theme"), { target: { value: "Blues" } });
    const cb = parsedCbFromLastOnChange(onChange);
    const colors = (cb.breaks as Array<Record<string, unknown>>).map((r) => r.color);
    expect(colors).toHaveLength(11);
    expect(colors[9]).toBe(colors[0]);
    expect(colors[10]).toBe(colors[1]);
  });

  it("categorical Auto-suggest appends an <other> row when includeOtherBucket is on", async () => {
    vi.mocked(topValuesFn).mockResolvedValue({ values: ["NYC", "YCAB"] });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "vendor_id", valsType: "categorical", breaks: [], includeOtherBucket: true })}
        onChange={onChange}
        columns={baseColumns}
        schema="demo"
        tableName="nyctaxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    const cb = parsedCbFromLastOnChange(onChange);
    const rows = cb.breaks as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.value)).toEqual(["NYC", "YCAB", "<other>"]);
  });

  it("Equal Interval method calls columnStatsFn and builds N equal-width closed ranges", async () => {
    vi.mocked(columnStatsFn).mockResolvedValue({ min: 0, max: 100, mean: 50, stddev: 10 });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="demo"
        tableName="nyctaxi"
      />,
    );
    // pick Equal Interval, N defaults to 5
    fireEvent.change(screen.getByLabelText("Classification method"), { target: { value: "equal" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    expect(vi.mocked(columnStatsFn)).toHaveBeenCalledWith(
      { schema: "demo", table: "nyctaxi", column: "fare" },
      expect.any(AbortSignal),
    );
    expect(vi.mocked(quantileFn)).not.toHaveBeenCalled();
    const cb = parsedCbFromLastOnChange(onChange);
    const rows = cb.breaks as Array<Record<string, unknown>>;
    // (max-min)/N = 20 → 5 closed bins. Phase 44 follow-up: last bucket max
    // nudged by +0.01 for non-integer columns (fare = double) so rows with
    // value === colMax (100) still fall inside [80, 100.01).
    expect(rows.map((r) => [r.min, r.max])).toEqual([
      [0, 20], [20, 40], [40, 60], [60, 80], [80, 100.01],
    ]);
  });

  it("Standard Deviation method builds 1σ-wide bands centered on the mean, closing outer buckets with column true min/max", async () => {
    vi.mocked(columnStatsFn).mockResolvedValue({ min: -5, max: 105, mean: 50, stddev: 10 });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="demo"
        tableName="nyctaxi"
      />,
    );
    fireEvent.change(screen.getByLabelText("Classification method"), { target: { value: "stddev" } });
    // N=4 → boundaries at mean+(k-2)σ for k=1..3 → 40, 50, 60
    fireEvent.change(screen.getByLabelText("N (number of break rows)"), { target: { value: "4" } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    const cb = parsedCbFromLastOnChange(onChange);
    const rows = cb.breaks as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(4);
    // Phase 44 follow-up: outer buckets now close with the column's true min/max
    // (was previously open-ended). Kinetica CB_VALS requires closed ranges.
    // Last bucket max nudged by +0.01 (fare = double; non-integer) so rows with
    // value === colMax (105) still fall inside [60, 105.01).
    expect(rows.map((r) => [r.min, r.max])).toEqual([
      [-5, 40], [40, 50], [50, 60], [60, 105.01],
    ]);
  });

  it("on Auto-suggest success, N boundaries become N+1 chained min:max ranges", async () => {
    vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] });
    vi.mocked(columnStatsFn).mockResolvedValueOnce({ min: 0, max: 50, mean: 25, stddev: 14 });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    const cb = parsedCbFromLastOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    // 4 boundaries → 5 rows; interior rows chain boundary[i-1]:boundary[i]
    expect(resultBreaks).toHaveLength(5);
    expect(resultBreaks[0].min).toBe(0); // closed-low (column true min, Phase 44 follow-up)
    expect(resultBreaks[0].max).toBe(10);
    expect(resultBreaks[1].min).toBe(10);
    expect(resultBreaks[1].max).toBe(20);
    expect(resultBreaks[2].min).toBe(20);
    expect(resultBreaks[2].max).toBe(30);
    expect(resultBreaks[3].min).toBe(30);
    expect(resultBreaks[3].max).toBe(40);
  });

  it("on Auto-suggest success, last row closes with column true max (Phase 44: Kinetica CB_VALS requires closed ranges)", async () => {
    vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] });
    vi.mocked(columnStatsFn).mockResolvedValueOnce({ min: 0, max: 50, mean: 25, stddev: 14 });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    const cb = parsedCbFromLastOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    const lastBreak = resultBreaks[resultBreaks.length - 1];
    expect(lastBreak.min).toBe(40);
    // Phase 44 follow-up: last bucket max = colMax + 0.01 nudge (fare = double;
    // non-integer) so rows with value === colMax still fall inside [40, 50.01).
    expect(lastBreak.max).toBe(50.01);
  });

  it("color preservation by index — old colors preserved at matching index, new rows get PALETTE_COLORS", async () => {
    vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] });
    vi.mocked(columnStatsFn).mockResolvedValueOnce({ min: 0, max: 50, mean: 25, stddev: 14 });

    const existingBreaks = [
      { value: 5, color: "FFAAAAAA", label: "A", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 10, color: "FFBBBBBB", label: "B", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
      { value: 15, color: "FFCCCCCC", label: "C", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    ];

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: existingBreaks })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );

    // Existing breaks → confirm dialog shows; click Replace to proceed
    fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Replace breaks"));
    });

    const cb = parsedCbFromLastOnChange(onChange);
    const resultBreaks = cb.breaks as Array<Record<string, unknown>>;
    // First 3 colors preserved
    expect(resultBreaks[0].color).toBe("FFAAAAAA");
    expect(resultBreaks[1].color).toBe("FFBBBBBB");
    expect(resultBreaks[2].color).toBe("FFCCCCCC");
    // 4th and 5th rows get PALETTE_COLORS (index 3 and 4)
    expect(typeof resultBreaks[3].color).toBe("string");
    expect(typeof resultBreaks[4].color).toBe("string");
  });

  it("clicking Auto-suggest with existing breaks shows confirm dialog with correct text", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [
          { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: 20, color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Confirm message mentions current break count and slider N
    expect(screen.getByText(/Replace 2 break rows with 5 quantile ranges/)).toBeInTheDocument();
    expect(screen.getByLabelText("Replace breaks")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel auto-suggest")).toBeInTheDocument();
  });

  it("clicking [Cancel] in confirm dialog closes the dialog WITHOUT calling quantileFn", () => {
    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [
          { value: 10, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Cancel auto-suggest"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(quantileFn)).not.toHaveBeenCalled();
  });

  it("clicking [Replace] in confirm dialog calls quantileFn and replaces breaks", async () => {
    vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] });
    vi.mocked(columnStatsFn).mockResolvedValueOnce({ min: 0, max: 50, mean: 25, stddev: 14 });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [
          { value: 5, color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
          { value: 10, color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
        ] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );
    fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Replace breaks"));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(quantileFn)).toHaveBeenCalledWith(
      { schema: "ki_home", table: "taxi", column: "fare", n: 5 },
      expect.any(AbortSignal),
    );
    expect(onChange).toHaveBeenCalled();
    const cb = parsedCbFromLastOnChange(onChange);
    expect((cb.breaks as Array<Record<string, unknown>>).length).toBe(5);
  });

  it("on Auto-suggest failure, shows inline error text AND toast with kind='error'", async () => {
    vi.mocked(quantileFn).mockRejectedValueOnce(new Error("Bad request"));

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("cb-autosuggest-error")).toHaveTextContent("Auto-suggest failed: Bad request");
    });
    expect(showToastSpy).toHaveBeenCalledWith(
      expect.stringContaining("Auto-suggest failed: Bad request"),
      "error",
    );
  });

  it("AbortError from cancelled request is silently consumed — no error text, no toast", async () => {
    vi.mocked(quantileFn).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId("cb-autosuggest-error")).toBeNull();
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  it("form NEVER writes config.cbColumn or config.classbreaks on Auto-suggest path", async () => {
    vi.mocked(quantileFn).mockResolvedValueOnce({ breaks: [10, 20, 30, 40] });

    render(
      <CbConfigForm
        config={makeCbConfig({ attr: "fare", valsType: "numeric", breaks: [] })}
        onChange={onChange}
        columns={baseColumns}
        schema="ki_home"
        tableName="taxi"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Auto-suggest breaks"));
    });

    for (const call of onChange.mock.calls) {
      const arg = call[0] as Record<string, unknown>;
      expect("cbColumn" in arg).toBe(false);
      expect("classbreaks" in arg).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Phase 53 Task 3: trackContext per-break advanced hiding             */
/*  (RENDER-V19-03)                                                     */
/* ------------------------------------------------------------------ */

describe("trackContext per-break advanced hiding (RENDER-V19-03)", () => {
  let onChange: ReturnType<typeof vi.fn> & ((config: Record<string, unknown>) => void);

  const twoBreaks = [
    { value: "cat1", color: "FF3B82F6", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
    { value: "cat2", color: "FFEF4444", label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" },
  ];

  const cbConfigWithBreaks: Record<string, unknown> = {
    ...baseConfig,
    cb_config: JSON.stringify({
      attr: "vendor",
      valsType: "categorical",
      breaks: twoBreaks,
    }),
  };

  beforeEach(() => {
    onChange = vi.fn() as any;
    vi.mocked(useToastStore.getState).mockReturnValue({ showToast: vi.fn() } as any);
    vi.mocked(topValuesFn).mockResolvedValue({ values: [] });
  });

  it("trackContext=true: chevron toggle button absent; no advanced panel even after interaction attempt", () => {
    render(
      <CbConfigForm
        config={cbConfigWithBreaks}
        onChange={onChange}
        columns={baseColumns}
        trackContext={true}
      />,
    );
    // No chevron toggle for any row
    expect(screen.queryByLabelText("Toggle advanced for row 1")).toBeNull();
    expect(screen.queryByLabelText("Toggle advanced for row 2")).toBeNull();
    // No advanced panel
    expect(screen.queryByTestId("cb-row-advanced-0")).toBeNull();
    expect(screen.queryByTestId("cb-row-advanced-1")).toBeNull();
  });

  it("trackContext omitted (default): chevron toggle present; clicking reveals advanced panel", () => {
    render(
      <CbConfigForm
        config={cbConfigWithBreaks}
        onChange={onChange}
        columns={baseColumns}
      />,
    );
    // Chevron exists for row 1
    const toggleBtn = screen.getByLabelText("Toggle advanced for row 1");
    expect(toggleBtn).toBeInTheDocument();
    // Click to expand
    fireEvent.click(toggleBtn);
    // Advanced panel appears
    expect(screen.getByTestId("cb-row-advanced-0")).toBeInTheDocument();
  });

  it("trackContext=true (TRACKFIX-V19-06): per-break color picker PRESENT and editable; advanced chevron ABSENT", () => {
    // Spec: full normal CB builder shown under track+CB — per-break color picker visible/editable.
    // Only the per-row advanced point/shape panel is hidden (trackContext gate). Color picker is NOT gated.
    render(
      <CbConfigForm
        config={cbConfigWithBreaks}
        onChange={onChange}
        columns={baseColumns}
        trackContext={true}
      />,
    );
    // Per-break color picker (RGB swatch) must be PRESENT for each break
    expect(screen.getByLabelText("Color (RGB) for break 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Color (RGB) for break 2")).toBeInTheDocument();
    // Per-break advanced chevron must be ABSENT (trackContext hides only the advanced panel)
    expect(screen.queryByLabelText("Toggle advanced for row 1")).toBeNull();
    expect(screen.queryByLabelText("Toggle advanced for row 2")).toBeNull();
  });
});
