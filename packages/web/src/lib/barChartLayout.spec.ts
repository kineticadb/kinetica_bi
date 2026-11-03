import { describe, it, expect } from "vitest";
import { BAR_LABEL_MAX_CHARS, computeBarXAxisLayout, truncateBarLabel } from "./barChartLayout";
import { LINE_DEFAULT_X_AXIS_HEIGHT } from "./lineChartLayout";

describe("computeBarXAxisLayout", () => {
  it("BARX-1 labels that fit side by side stay flat and all show", () => {
    expect(computeBarXAxisLayout({ n: 5, plotWidthPx: 600, maxLabelChars: 9 })).toEqual({ tilt: false, showAll: true, xAxisHeight: LINE_DEFAULT_X_AXIS_HEIGHT });
  });

  it("BARX-2 five payment types in a narrow chart tilt instead of dropping labels", () => {
    // "No Charge" is 9 chars: 5 bars need ~355px flat; a 300px plot tilts and still shows all five
    const l = computeBarXAxisLayout({ n: 5, plotWidthPx: 300, maxLabelChars: 9 });
    expect(l.tilt).toBe(true);
    expect(l.showAll).toBe(true);
    expect(l.xAxisHeight).toBeGreaterThan(LINE_DEFAULT_X_AXIS_HEIGHT);
  });

  it("BARX-3 too many bars even tilted: let the chart thin the labels", () => {
    expect(computeBarXAxisLayout({ n: 40, plotWidthPx: 300, maxLabelChars: 4 })).toMatchObject({ tilt: true, showAll: false });
  });

  it("BARX-4 long labels are capped so the tilted axis cannot eat the chart", () => {
    const capped = computeBarXAxisLayout({ n: 5, plotWidthPx: 200, maxLabelChars: 80 }).xAxisHeight;
    expect(capped).toBe(computeBarXAxisLayout({ n: 5, plotWidthPx: 200, maxLabelChars: BAR_LABEL_MAX_CHARS }).xAxisHeight);
    expect(truncateBarLabel("Short")).toBe("Short");
    const t = truncateBarLabel("A very long payment type name");
    expect(t).toHaveLength(BAR_LABEL_MAX_CHARS);
    expect(t.endsWith("…")).toBe(true);
  });

  it("BARX-5 unknown width (no ResizeObserver) shows every label, tilting past 8 bars", () => {
    expect(computeBarXAxisLayout({ n: 5, plotWidthPx: 0, maxLabelChars: 9 })).toMatchObject({ tilt: false, showAll: true });
    expect(computeBarXAxisLayout({ n: 12, plotWidthPx: 0, maxLabelChars: 9 })).toMatchObject({ tilt: true, showAll: true });
  });
});
