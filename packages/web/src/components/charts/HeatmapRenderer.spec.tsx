import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import HeatmapRenderer from "./HeatmapRenderer";
import { HEATMAP_CELL_LIMIT } from "../../lib/heatmapGrid";

/** Aggregated contract rows: one per (x,y) intersection plus `value`. */
const rows = [
  { day_name: "Monday", hour_of_day: 0, value: 10 },
  { day_name: "Monday", hour_of_day: 1, value: 20 },
  { day_name: "Tuesday", hour_of_day: 0, value: 30 },
  { day_name: "Tuesday", hour_of_day: 1, value: 40 },
];

const baseConfig = {
  groupByColumns: ["day_name", "hour_of_day"],
  metricColumn: "download_throughput",
  aggregation: "AVG",
};

const cellRects = (): SVGRectElement[] =>
  Array.from(document.querySelectorAll("rect")).filter(
    (r) => r.getAttribute("data-empty") !== "true",
  ) as SVGRectElement[];

/**
 * Render with the container reporting a REAL measured size.
 *
 * jsdom implements neither ResizeObserver nor layout: clientWidth/Height read 0,
 * so HeatmapRenderer's effect bails out and geometry falls back to
 * FALLBACK_W/FALLBACK_H. Stubbing the constructor (so the effect proceeds) plus
 * both dimensions is the only way to exercise the MEASURED path that a real
 * dashboard widget always takes. The component reads clientWidth/Height directly
 * after ro.observe(), so the stub's callback never has to fire.
 *
 * The restore is the subtle part: clientWidth/Height are defined on
 * Element.prototype, NOT HTMLElement.prototype, so defineProperty here ADDS an
 * own property that SHADOWS the real one. A `const d = getOwnPropertyDescriptor(
 * HTMLElement.prototype, ...); if (d) restore(d)` guard therefore never fires,
 * and the stubbed size leaks into every later test in the file. Delete the
 * shadow instead — see the self-check test below, which pins this.
 */
function withMeasuredBox(w: number, h: number, fn: () => void): void {
  class RO {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  const shadow = (prop: "clientWidth" | "clientHeight", value: number): (() => void) => {
    const had = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get: () => value,
    });
    return () => {
      if (had) Object.defineProperty(HTMLElement.prototype, prop, had);
      else Reflect.deleteProperty(HTMLElement.prototype, prop);
    };
  };
  const restore = [shadow("clientWidth", w), shadow("clientHeight", h)];
  try {
    fn();
  } finally {
    restore.forEach((r) => r());
    vi.unstubAllGlobals();
  }
}

/** Numeric SVG attribute read. */
const num = (el: Element, a: string): number => Number(el.getAttribute(a));

/** Every cell rect (populated + empty), which together tile the plot. */
const allRects = (): SVGRectElement[] =>
  Array.from(document.querySelectorAll("rect")) as SVGRectElement[];


describe("HeatmapRenderer", () => {
  afterEach(cleanup);

  it("renders one cell per populated intersection", () => {
    render(<HeatmapRenderer data={rows} config={baseConfig} />);
    expect(screen.getByTestId("heatmap-renderer")).toBeTruthy();
    expect(cellRects()).toHaveLength(4);
  });

  it("draws both axes' tick labels", () => {
    render(<HeatmapRenderer data={rows} config={baseConfig} />);
    const texts = Array.from(document.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("Monday");
    expect(texts).toContain("Tuesday");
    expect(texts).toContain("0");
    expect(texts).toContain("1");
  });

  it("prompts for configuration when fewer than two dimensions are present", () => {
    render(<HeatmapRenderer data={[{ day_name: "Monday", value: 1 }]} config={{}} />);
    expect(screen.getByText(/Pick two Group By columns/i)).toBeTruthy();
  });

  it("reports no numeric values rather than drawing an empty grid", () => {
    render(
      <HeatmapRenderer
        data={[{ day_name: "Monday", hour_of_day: 0, value: null }]}
        config={baseConfig}
      />,
    );
    expect(screen.getByText("No numeric values to plot")).toBeTruthy();
  });

  it("paints an unpopulated intersection as an empty cell, distinct from a value cell", () => {
    // Monday/1 is absent — it must render as a data-empty rect, never as a zero-valued
    // colored cell, or a gap in the data would read as a real low measurement.
    render(
      <HeatmapRenderer
        data={[
          { day_name: "Monday", hour_of_day: 0, value: 10 },
          { day_name: "Tuesday", hour_of_day: 1, value: 40 },
        ]}
        config={baseConfig}
      />,
    );
    expect(document.querySelectorAll('rect[data-empty="true"]')).toHaveLength(2);
    expect(cellRects()).toHaveLength(2);
  });

  it("colors cells across the ramp — the min and max cells differ", () => {
    render(<HeatmapRenderer data={rows} config={baseConfig} />);
    const fills = cellRects().map((r) => r.getAttribute("fill"));
    expect(new Set(fills).size).toBeGreaterThan(1);
    fills.forEach((f) => expect(f).toMatch(/^#[0-9a-f]{6}$/));
  });

  it("reverseColors flips which end of the ramp a high value gets", () => {
    const { unmount } = render(
      <HeatmapRenderer data={rows} config={{ ...baseConfig, reverseColors: false }} />,
    );
    const forward = cellRects().map((r) => r.getAttribute("fill"));
    unmount();
    render(<HeatmapRenderer data={rows} config={{ ...baseConfig, reverseColors: true }} />);
    const reversed = cellRects().map((r) => r.getAttribute("fill"));
    expect(reversed).not.toEqual(forward);
  });

  it("normalizeAcross changes cell colors (per-column vs whole grid)", () => {
    const { unmount } = render(
      <HeatmapRenderer data={rows} config={{ ...baseConfig, normalizeAcross: "heatmap" }} />,
    );
    const whole = cellRects().map((r) => r.getAttribute("fill"));
    unmount();
    render(<HeatmapRenderer data={rows} config={{ ...baseConfig, normalizeAcross: "x" }} />);
    const perColumn = cellRects().map((r) => r.getAttribute("fill"));
    // Per-column normalization gives Monday's 10 and Tuesday's 30 the SAME ramp
    // position (each is its column's min), which the whole-grid scale does not.
    expect(perColumn).not.toEqual(whole);
  });

  it("rendering=pixelated sets crispEdges; smooth does not", () => {
    const { unmount } = render(
      <HeatmapRenderer data={rows} config={{ ...baseConfig, rendering: "pixelated" }} />,
    );
    expect(cellRects()[0].getAttribute("shape-rendering")).toBe("crispEdges");
    unmount();
    render(<HeatmapRenderer data={rows} config={{ ...baseConfig, rendering: "smooth" }} />);
    expect(cellRects()[0].getAttribute("shape-rendering")).toBe("auto");
  });

  it("shows a tooltip on hover carrying both axis values, the metric and a percentage", () => {
    render(<HeatmapRenderer data={rows} config={baseConfig} />);
    fireEvent.mouseEnter(cellRects()[0]);
    const tip = screen.getByTestId("heatmap-tooltip");
    expect(tip.textContent).toContain("day_name");
    expect(tip.textContent).toContain("hour_of_day");
    expect(tip.textContent).toContain("AVG(download_throughput)");
    expect(tip.textContent).toMatch(/%/);
    fireEvent.mouseLeave(cellRects()[0]);
    expect(screen.queryByTestId("heatmap-tooltip")).toBeNull();
  });

  it("showTooltip:false suppresses the hover tooltip", () => {
    render(<HeatmapRenderer data={rows} config={{ ...baseConfig, showTooltip: false }} />);
    fireEvent.mouseEnter(cellRects()[0]);
    expect(screen.queryByTestId("heatmap-tooltip")).toBeNull();
  });

  it("renders the legend by default and hides it on showLegend:false", () => {
    const { unmount } = render(<HeatmapRenderer data={rows} config={baseConfig} />);
    expect(screen.getByTestId("heatmap-legend")).toBeTruthy();
    unmount();
    render(<HeatmapRenderer data={rows} config={{ ...baseConfig, showLegend: false }} />);
    expect(screen.queryByTestId("heatmap-legend")).toBeNull();
  });

  it("draws axis titles when configured", () => {
    render(
      <HeatmapRenderer
        data={rows}
        config={{ ...baseConfig, xAxisLabel: "Day", yAxisLabel: "Hour" }}
      />,
    );
    const texts = Array.from(document.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("Day");
    expect(texts).toContain("Hour");
  });

  it("xScaleInterval thins the x tick labels", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      day_name: `d${i}`,
      hour_of_day: 0,
      value: i + 1,
    }));
    const { unmount } = render(<HeatmapRenderer data={many} config={baseConfig} />);
    const all = Array.from(document.querySelectorAll("text")).filter((t) =>
      t.textContent?.startsWith("d"),
    );
    expect(all).toHaveLength(6);
    unmount();
    render(<HeatmapRenderer data={many} config={{ ...baseConfig, xScaleInterval: "3" }} />);
    const thinned = Array.from(document.querySelectorAll("text")).filter((t) =>
      t.textContent?.startsWith("d"),
    );
    expect(thinned).toHaveLength(2); // indices 0 and 3
  });

  it("warns when the result reaches the shared cell cap, so a holed grid is not silent", () => {
    const capped = Array.from({ length: HEATMAP_CELL_LIMIT }, (_, i) => ({
      day_name: `d${i % 70}`,
      hour_of_day: Math.floor(i / 70),
      value: i,
    }));
    render(<HeatmapRenderer data={capped} config={baseConfig} />);
    expect(screen.getByTestId("heatmap-truncated")).toBeTruthy();
  });

  it("does not warn for a result below the cap", () => {
    render(<HeatmapRenderer data={rows} config={baseConfig} />);
    expect(screen.queryByTestId("heatmap-truncated")).toBeNull();
  });

  it("orders a numeric y axis numerically, not lexically", () => {
    const hours = [0, 1, 2, 10, 11].map((h) => ({
      day_name: "Monday",
      hour_of_day: h,
      value: h + 1,
    }));
    render(<HeatmapRenderer data={hours} config={baseConfig} />);
    // Assert GEOMETRY, not DOM order: ticks are emitted ascending but positioned
    // bottom-up, so a numerically-ordered axis means y-coordinate decreases as the
    // value rises. A lexical sort would place 10 and 11 between 1 and 2.
    const yTicks = Array.from(document.querySelectorAll("text"))
      .filter((t) => ["0", "1", "2", "10", "11"].includes(t.textContent ?? ""))
      .map((t) => ({ label: t.textContent ?? "", y: Number(t.getAttribute("y")) }));
    expect(yTicks).toHaveLength(5);
    const byValue = [...yTicks].sort((a, b) => Number(a.label) - Number(b.label));
    const ys = byValue.map((t) => t.y);
    // Strictly descending y as the value increases.
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    expect(new Set(ys).size).toBe(5);
    expect(byValue.map((t) => t.label)).toEqual(["0", "1", "2", "10", "11"]);
  });

  // Geometry integrity — the class of bug that renders a blank or broken chart
  // while every behavioural assertion above still passes.
  describe("geometry integrity", () => {
    it("emits no NaN/undefined in any SVG numeric attribute", () => {
      render(<HeatmapRenderer data={rows} config={baseConfig} />);
      const svg = document.querySelector("svg")!;
      const bad: string[] = [];
      svg.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          if (/NaN|undefined|Infinity/.test(attr.value)) {
            bad.push(`${el.tagName}.${attr.name}="${attr.value}"`);
          }
        }
      });
      expect(bad).toEqual([]);
      expect(svg.getAttribute("width")).toMatch(/^\d+(\.\d+)?$/);
      expect(svg.getAttribute("height")).toMatch(/^\d+(\.\d+)?$/);
    });

    it("tiles cells contiguously — no gaps or overlaps in the matrix", () => {
      render(<HeatmapRenderer data={rows} config={baseConfig} />);
      const all = Array.from(document.querySelectorAll("rect")) as SVGRectElement[];
      const n = (el: SVGRectElement, a: string) => Number(el.getAttribute(a));
      // 2x2 grid => 4 rects covering the plot with no overlap: total area equals
      // the bounding area of the union.
      expect(all).toHaveLength(4);
      const area = all.reduce((sum, r) => sum + n(r, "width") * n(r, "height"), 0);
      const minX = Math.min(...all.map((r) => n(r, "x")));
      const minY = Math.min(...all.map((r) => n(r, "y")));
      const maxX = Math.max(...all.map((r) => n(r, "x") + n(r, "width")));
      const maxY = Math.max(...all.map((r) => n(r, "y") + n(r, "height")));
      expect(area).toBeCloseTo((maxX - minX) * (maxY - minY), 4);
    });

    it("keeps every cell inside the svg viewport", () => {
      render(<HeatmapRenderer data={rows} config={baseConfig} />);
      const svg = document.querySelector("svg")!;
      const w = Number(svg.getAttribute("width"));
      const h = Number(svg.getAttribute("height"));
      Array.from(document.querySelectorAll("rect")).forEach((r) => {
        const x = Number(r.getAttribute("x"));
        const y = Number(r.getAttribute("y"));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + Number(r.getAttribute("width"))).toBeLessThanOrEqual(w + 0.01);
        expect(y + Number(r.getAttribute("height"))).toBeLessThanOrEqual(h + 0.01);
      });
    });

    it("gives cells a positive size for a single-cell grid", () => {
      render(
        <HeatmapRenderer data={[{ day_name: "Mon", hour_of_day: 0, value: 5 }]} config={baseConfig} />,
      );
      const r = document.querySelector("rect")!;
      expect(Number(r.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(r.getAttribute("height"))).toBeGreaterThan(0);
    });

    // Regression: a FIXED 78px bottom gutter (sized for rotated day names) left
    // ~78px of dead space under the plot whenever the x labels were short.
    const plotBottom = () =>
      Math.max(
        ...Array.from(document.querySelectorAll("rect")).map(
          (r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height")),
        ),
      );

    it("leaves only label-sized space under the plot for short x labels", () => {
      render(<HeatmapRenderer data={rows} config={baseConfig} />);
      const svgH = Number(document.querySelector("svg")!.getAttribute("height"));
      // Short labels ("Monday"/"Tuesday" across wide cells) draw horizontally, so
      // the gutter is roughly one line of text — nothing like the old 78px.
      expect(svgH - plotBottom()).toBeLessThanOrEqual(30);
    });

    it("draws x labels horizontally when they fit across a cell", () => {
      render(<HeatmapRenderer data={rows} config={baseConfig} />);
      const xTick = Array.from(document.querySelectorAll("text")).find(
        (t) => t.textContent === "Monday",
      )!;
      expect(xTick.getAttribute("transform")).toBeNull();
      expect(xTick.getAttribute("text-anchor")).toBe("middle");
    });

    it("rotates x labels when they are too wide for a cell, and reserves room", () => {
      // 30 long categories cannot fit horizontally at any sane cell width.
      const many = Array.from({ length: 30 }, (_, i) => ({
        day_name: `a-very-long-category-${i}`,
        hour_of_day: 0,
        value: i + 1,
      }));
      render(<HeatmapRenderer data={many} config={baseConfig} />);
      const xTick = Array.from(document.querySelectorAll("text")).find((t) =>
        t.textContent?.startsWith("a-very-long-category-"),
      )!;
      expect(xTick.getAttribute("transform")).toMatch(/^rotate\(-90 /);
      expect(xTick.getAttribute("text-anchor")).toBe("end");
      // Rotated labels need a TALLER gutter than horizontal ones, or they clip.
      const svgH = Number(document.querySelector("svg")!.getAttribute("height"));
      expect(svgH - plotBottom()).toBeGreaterThan(30);
    });

    it("reserves extra gutter for axis titles instead of overlapping ticks", () => {
      const { unmount } = render(<HeatmapRenderer data={rows} config={baseConfig} />);
      const bare = Number(document.querySelector("svg")!.getAttribute("height")) - plotBottom();
      unmount();
      render(
        <HeatmapRenderer data={rows} config={{ ...baseConfig, xAxisLabel: "Day" }} />,
      );
      const titled = Number(document.querySelector("svg")!.getAttribute("height")) - plotBottom();
      expect(titled).toBeGreaterThan(bare);
    });

    it("widens the left gutter for long y labels rather than clipping them", () => {
      const longY = [
        { day_name: "Monday", hour_of_day: "a-really-long-y-label", value: 1 },
        { day_name: "Monday", hour_of_day: "b", value: 2 },
      ];
      render(<HeatmapRenderer data={longY} config={baseConfig} />);
      const firstCellX = Number(document.querySelector("rect")!.getAttribute("x"));
      const tick = Array.from(document.querySelectorAll("text")).find(
        (t) => t.textContent === "a-really-long-y-label",
      )!;
      // The tick is right-anchored just inside the plot edge, so the gutter must be
      // wide enough that the label starts at x >= 0.
      expect(firstCellX).toBeGreaterThan(40);
      expect(Number(tick.getAttribute("x"))).toBeLessThanOrEqual(firstCellX);
    });

    it("fills the measured container once the ResizeObserver reports a size", () => {
      // The fallback size is all the other tests in this describe exercise; this
      // proves the grid actually grows to the widget instead of staying at
      // FALLBACK_*. Stubbing now lives in withMeasuredBox, whose restore does not
      // leak the size into the tests below (it previously did).
      withMeasuredBox(1200, 700, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        const svg = document.querySelector("svg")!;
        expect(num(svg, "width")).toBeGreaterThan(900);
        expect(num(svg, "height")).toBeGreaterThan(500);
        // Cells share the extra room rather than leaving the plot area blank.
        expect(num(document.querySelector("rect")!, "width")).toBeGreaterThan(400);
      });
    });

    it("withMeasuredBox restores the fallback size, so it cannot leak into later tests", () => {
      // Guards the isolation bug the helper's doc comment describes: because
      // clientWidth lives on Element.prototype, a naive descriptor-restore is a
      // no-op and every subsequent render silently measures the stubbed size.
      withMeasuredBox(1200, 700, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        expect(num(document.querySelector("svg")!, "width")).toBeGreaterThan(900);
      });
      cleanup();
      render(<HeatmapRenderer data={rows} config={baseConfig} />);
      // Back to FALLBACK_W (480), not the 1200 measured above.
      expect(num(document.querySelector("svg")!, "width")).toBeLessThan(600);
      expect(document.createElement("div").clientWidth).toBe(0);
    });

    it("scrolls rather than shrinking cells to nothing on a high-cardinality axis", () => {
      // 200 x-values cannot fit the fallback width at a readable size, so the svg
      // must grow past it (its wrapper is overflow:auto) instead of collapsing.
      const wide = Array.from({ length: 200 }, (_, i) => ({
        day_name: `d${i}`,
        hour_of_day: 0,
        value: i,
      }));
      render(<HeatmapRenderer data={wide} config={baseConfig} />);
      const svg = document.querySelector("svg")!;
      expect(Number(svg.getAttribute("width"))).toBeGreaterThan(480);
      const r = document.querySelector("rect")!;
      expect(Number(r.getAttribute("width"))).toBeGreaterThanOrEqual(6);
    });
  });

  // The invariants above run at FALLBACK_W/FALLBACK_H (480x320) because jsdom
  // never measures anything. A real dashboard widget ALWAYS takes the measured
  // path, at aspect ratios nothing above covers — a full-width row is wide and
  // short, a quarter tile is small — so re-assert them where they actually apply.
  describe("geometry integrity at measured container sizes", () => {
    const SIZES: [label: string, w: number, h: number][] = [
      ["wide and short (full-width dashboard row)", 1200, 360],
      ["narrow (half-width widget)", 420, 300],
      ["small (quarter tile)", 240, 160],
    ];

    it.each(SIZES)("%s: emits no NaN/undefined in any SVG attribute", (_label, w, h) => {
      withMeasuredBox(w, h, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        const svg = document.querySelector("svg")!;
        const bad: string[] = [];
        svg.querySelectorAll("*").forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            if (/NaN|undefined|Infinity/.test(attr.value)) {
              bad.push(`${el.tagName}.${attr.name}="${attr.value}"`);
            }
          }
        });
        expect(bad).toEqual([]);
        expect(svg.getAttribute("width")).toMatch(/^\d+(\.\d+)?$/);
        expect(svg.getAttribute("height")).toMatch(/^\d+(\.\d+)?$/);
      });
    });

    it.each(SIZES)("%s: tiles cells contiguously — no gaps or overlaps", (_label, w, h) => {
      withMeasuredBox(w, h, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        const all = allRects();
        expect(all).toHaveLength(4); // 2x2 fixture
        const area = all.reduce((sum, r) => sum + num(r, "width") * num(r, "height"), 0);
        const minX = Math.min(...all.map((r) => num(r, "x")));
        const minY = Math.min(...all.map((r) => num(r, "y")));
        const maxX = Math.max(...all.map((r) => num(r, "x") + num(r, "width")));
        const maxY = Math.max(...all.map((r) => num(r, "y") + num(r, "height")));
        // Union area == bounding area only when the tiling has no gap and no overlap.
        expect(area).toBeCloseTo((maxX - minX) * (maxY - minY), 4);
      });
    });

    it.each(SIZES)("%s: keeps every cell inside the svg viewport", (_label, w, h) => {
      withMeasuredBox(w, h, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        const svg = document.querySelector("svg")!;
        const sw = num(svg, "width");
        const sh = num(svg, "height");
        allRects().forEach((r) => {
          expect(num(r, "x")).toBeGreaterThanOrEqual(0);
          expect(num(r, "y")).toBeGreaterThanOrEqual(0);
          expect(num(r, "x") + num(r, "width")).toBeLessThanOrEqual(sw + 0.01);
          expect(num(r, "y") + num(r, "height")).toBeLessThanOrEqual(sh + 0.01);
        });
      });
    });

    it.each(SIZES)("%s: fits the measured box without overflowing it", (_label, w, h) => {
      withMeasuredBox(w, h, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        const svg = document.querySelector("svg")!;
        // A 2-column grid always fits, so the plot must stay within the widget —
        // anything wider is the horizontal-scrollbar bug. The svg and the legend
        // are flex SIBLINGS, so the svg alone being <= w is not enough: the
        // legend's width has to come out of the same box. (Asserting only the svg
        // let a mutation that stopped reserving LEGEND_W pass, because the svg
        // then measured exactly w and pushed the legend outside the widget.)
        const legendW = parseFloat(screen.getByTestId("heatmap-legend").style.width);
        expect(legendW).toBeGreaterThan(0);
        expect(num(svg, "width") + legendW).toBeLessThanOrEqual(w + 0.01);
        expect(num(svg, "height")).toBeLessThanOrEqual(h);
        // ...and must actually USE the box rather than collapsing to a corner.
        expect(num(svg, "width")).toBeGreaterThan(w * 0.5);
        expect(num(svg, "height")).toBeGreaterThan(h * 0.5);
      });
    });

    it.each(SIZES)("%s: legend ramp height matches the plot's vertical extent", (_label, w, h) => {
      withMeasuredBox(w, h, () => {
        render(<HeatmapRenderer data={rows} config={baseConfig} />);
        const all = allRects();
        const plotTop = Math.min(...all.map((r) => num(r, "y")));
        const plotBottom = Math.max(...all.map((r) => num(r, "y") + num(r, "height")));
        const ramp = screen.getByTestId("heatmap-legend-ramp");
        // Regression: a flex-stretched ramp grew to the whole row and pushed the
        // low-end label off-screen. It must track the grid it explains.
        expect(parseFloat(ramp.style.height)).toBeCloseTo(plotBottom - plotTop, 1);
      });
    });

    it("rotates x labels only once the MEASURED cell width is too narrow for them", () => {
      const labels = Array.from({ length: 8 }, (_, i) => ({
        day_name: `category-${i}${i}`,
        hour_of_day: 0,
        value: i + 1,
      }));
      const anchorOf = (): string | null => {
        const t = Array.from(document.querySelectorAll("text")).find(
          (el) => el.textContent === "category-00",
        )!;
        return t.getAttribute("transform");
      };

      // Wide box: ~163px per cell holds an 11-char label horizontally.
      withMeasuredBox(1400, 400, () => {
        render(<HeatmapRenderer data={labels} config={baseConfig} />);
        expect(anchorOf()).toBeNull();
      });
      cleanup();
      // Narrow box: the same labels across ~25px cells must rotate instead of
      // overlapping their neighbours.
      withMeasuredBox(300, 400, () => {
        render(<HeatmapRenderer data={labels} config={baseConfig} />);
        expect(anchorOf()).toMatch(/rotate\(-90/);
      });
    });

    it("scrolls past the measured width rather than shrinking cells below MIN_CELL", () => {
      const wide = Array.from({ length: 200 }, (_, i) => ({
        day_name: `d${i}`,
        hour_of_day: 0,
        value: i,
      }));
      withMeasuredBox(400, 300, () => {
        render(<HeatmapRenderer data={wide} config={baseConfig} />);
        const svg = document.querySelector("svg")!;
        // 200 cells cannot fit 400px at a readable size, so the svg grows past the
        // box and its overflow:auto wrapper scrolls — cells never collapse to 0.
        expect(num(svg, "width")).toBeGreaterThan(400);
        allRects().forEach((r) => expect(num(r, "width")).toBeGreaterThanOrEqual(6));
      });
    });
  });

  it("applies the valueFormat spec to tooltip + legend values", () => {
    render(
      <HeatmapRenderer
        data={[{ day_name: "Monday", hour_of_day: 0, value: 1234567 }]}
        config={{ ...baseConfig, valueFormat: { kind: "si", decimals: 1 } }}
      />,
    );
    expect(screen.getByTestId("heatmap-legend").textContent).toMatch(/1\.2M/);
  });
});
