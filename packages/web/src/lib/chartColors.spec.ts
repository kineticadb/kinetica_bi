/**
 * Phase 80 Plan 03 — TDD RED tests for chartColors + chartTheme Aurora refactor.
 *
 * Tests assert:
 *  1. useChartAxisColors() derives colors via getComputedStyle (no hardcoded hex branches)
 *  2. AURORA_CHART_PALETTE exists, violet #7f40ed is index-0, palette has ≥6 entries
 *  3. DEFAULT_CHART_PALETTE re-exports AURORA_CHART_PALETTE values (backward compat)
 *  4. Single-series fallbacks index into AURORA_CHART_PALETTE (not green #22c55e)
 *  5. RECHARTS_TOOLTIP_PROPS still uses CSS vars (not JS hex)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 1. Mock the theme store ──
let mockTheme: string = "dark";
vi.mock("../store/theme", () => ({
  useThemeStore: (selector: (s: { theme: string }) => unknown) =>
    selector({ theme: mockTheme }),
}));

// ── 2. Stub getComputedStyle so reads return deterministic tokens ──
const CSS_VARS: Record<string, string> = {
  "--color-chart-grid": "#1a1830",
  "--color-chart-axis": "#6b6490",
  "--accent-2": "#38bdf8",
};

// Provide the stub before importing the hook (it reads getComputedStyle at call-time, not module-level)
beforeEach(() => {
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation((_el) => {
    return {
      getPropertyValue: (prop: string) => CSS_VARS[prop.trim()] ?? "",
    } as unknown as CSSStyleDeclaration;
  });
});

import type { ChartAxisColors } from "./chartColors";
import { useChartAxisColors } from "./chartColors";

// ── chartTheme imports (not hooks — pure TS values) ──
import {
  AURORA_CHART_PALETTE,
  DEFAULT_CHART_PALETTE,
  DEFAULT_BAR_COLOR,
  DEFAULT_LINE_COLOR,
  DEFAULT_AREA_COLOR,
  DEFAULT_SCATTER_COLOR,
  DEFAULT_TABLE_BAR_COLOR,
  DEFAULT_BIGNUMBER_COLOR,
  RECHARTS_TOOLTIP_PROPS,
} from "./chartTheme";

describe("useChartAxisColors — getComputedStyle derivation", () => {
  it("returns a ChartAxisColors object with all four required keys", () => {
    const colors: ChartAxisColors = useChartAxisColors();
    expect(colors).toHaveProperty("grid");
    expect(colors).toHaveProperty("axis");
    expect(colors).toHaveProperty("emptyCell");
    expect(colors).toHaveProperty("accent");
  });

  it("reads --color-chart-grid from getComputedStyle (:root)", () => {
    const colors = useChartAxisColors();
    expect(colors.grid).toBe("#1a1830");
  });

  it("reads --color-chart-axis from getComputedStyle (:root)", () => {
    const colors = useChartAxisColors();
    expect(colors.axis).toBe("#6b6490");
  });

  it("emptyCell === grid (both read from --color-chart-grid)", () => {
    const colors = useChartAxisColors();
    expect(colors.emptyCell).toBe(colors.grid);
  });

  it("reads --accent-2 for accent", () => {
    const colors = useChartAxisColors();
    expect(colors.accent).toBe("#38bdf8");
  });

  it("does NOT contain any hardcoded slate/hex branches (no #e2e8f0 / #1f2937 / #64748b / #94a3b8)", () => {
    // These are the OLD hardcoded light/dark hex values that must be removed
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const src: string = readFileSync(resolve(process.cwd(), "src/lib/chartColors.ts"), "utf-8");
    expect(src).not.toContain("#e2e8f0");
    expect(src).not.toContain("#1f2937");
    expect(src).not.toContain("#64748b");
    expect(src).not.toContain("#94a3b8");
  });

  it("contains getComputedStyle(document.documentElement) call in the hook source", () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const src: string = readFileSync(resolve(process.cwd(), "src/lib/chartColors.ts"), "utf-8");
    expect(src).toContain("getComputedStyle(document.documentElement)");
  });
});

describe("AURORA_CHART_PALETTE", () => {
  it("exists and is an array", () => {
    expect(Array.isArray(AURORA_CHART_PALETTE)).toBe(true);
  });

  it("has at least 6 entries", () => {
    expect(AURORA_CHART_PALETTE.length).toBeGreaterThanOrEqual(6);
  });

  it("index-0 is the Kinetica violet #7f40ed", () => {
    expect(AURORA_CHART_PALETTE[0]).toBe("#7f40ed");
  });

  it("all entries are valid #RRGGBB hex strings", () => {
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    for (const c of AURORA_CHART_PALETTE) {
      expect(c).toMatch(hexRe);
    }
  });

  it("no two entries are the same hue (palette is distinct)", () => {
    const set = new Set(AURORA_CHART_PALETTE);
    expect(set.size).toBe(AURORA_CHART_PALETTE.length);
  });
});

describe("DEFAULT_CHART_PALETTE backward compat", () => {
  it("has the same values as AURORA_CHART_PALETTE (backward compat re-export)", () => {
    expect(DEFAULT_CHART_PALETTE).toEqual(AURORA_CHART_PALETTE);
  });

  it("is an array (consumers that spread or index it still work)", () => {
    expect(Array.isArray(DEFAULT_CHART_PALETTE)).toBe(true);
  });
});

describe("Single-series fallbacks index AURORA_CHART_PALETTE (not green #22c55e)", () => {
  it("DEFAULT_BAR_COLOR is AURORA_CHART_PALETTE[0] (violet)", () => {
    expect(DEFAULT_BAR_COLOR).toBe(AURORA_CHART_PALETTE[0]);
  });

  it("DEFAULT_LINE_COLOR is AURORA_CHART_PALETTE[1] (sky)", () => {
    expect(DEFAULT_LINE_COLOR).toBe(AURORA_CHART_PALETTE[1]);
  });

  it("DEFAULT_AREA_COLOR is AURORA_CHART_PALETTE[1]", () => {
    expect(DEFAULT_AREA_COLOR).toBe(AURORA_CHART_PALETTE[1]);
  });

  it("DEFAULT_SCATTER_COLOR is AURORA_CHART_PALETTE[2]", () => {
    expect(DEFAULT_SCATTER_COLOR).toBe(AURORA_CHART_PALETTE[2]);
  });

  it("DEFAULT_TABLE_BAR_COLOR is AURORA_CHART_PALETTE[0] (violet)", () => {
    expect(DEFAULT_TABLE_BAR_COLOR).toBe(AURORA_CHART_PALETTE[0]);
  });

  it("DEFAULT_BIGNUMBER_COLOR is AURORA_CHART_PALETTE[0] (violet)", () => {
    expect(DEFAULT_BIGNUMBER_COLOR).toBe(AURORA_CHART_PALETTE[0]);
  });

  it("none of the fallbacks is the old green #22c55e", () => {
    const all = [
      DEFAULT_BAR_COLOR, DEFAULT_LINE_COLOR, DEFAULT_AREA_COLOR,
      DEFAULT_SCATTER_COLOR, DEFAULT_TABLE_BAR_COLOR, DEFAULT_BIGNUMBER_COLOR,
    ];
    for (const c of all) {
      expect(c.toLowerCase()).not.toBe("#22c55e");
    }
  });
});

describe("RECHARTS_TOOLTIP_PROPS keeps CSS vars (not JS hex)", () => {
  it("contentStyle.background is a CSS var, not a hex", () => {
    expect(RECHARTS_TOOLTIP_PROPS.contentStyle.background).toMatch(/var\(/);
  });

  it("contentStyle.color is a CSS var, not a hex", () => {
    expect(RECHARTS_TOOLTIP_PROPS.contentStyle.color).toMatch(/var\(/);
  });

  it("contentStyle.border contains a CSS var, not a hex", () => {
    const border = RECHARTS_TOOLTIP_PROPS.contentStyle.border as string;
    expect(border).toContain("var(");
  });
});
