import { describe, it, expect } from "vitest";
import { CB_COLOR_THEMES, getCbColorTheme, themeColorsFor } from "./cbColorThemes";

describe("cbColorThemes", () => {
  it("includes the full ColorBrewer set (18 sequential, 9 diverging, 8 qualitative = 35)", () => {
    const byGroup = (g: string) => CB_COLOR_THEMES.filter((t) => t.group === g).length;
    expect(CB_COLOR_THEMES).toHaveLength(35);
    expect(byGroup("Sequential")).toBe(18);
    expect(byGroup("Diverging")).toBe(9);
    expect(byGroup("Qualitative")).toBe(8);
    // spot-check schemes that were NOT in the original curated set
    expect(getCbColorTheme("BuGn")?.group).toBe("Sequential");
    expect(getCbColorTheme("PuOr")?.group).toBe("Diverging");
    expect(getCbColorTheme("Set3")?.group).toBe("Qualitative");
  });

  it("exposes themes grouped Sequential / Diverging / Qualitative", () => {
    const groups = new Set(CB_COLOR_THEMES.map((t) => t.group));
    expect(groups.has("Sequential")).toBe(true);
    expect(groups.has("Diverging")).toBe(true);
    expect(groups.has("Qualitative")).toBe(true);
    expect(getCbColorTheme("Blues")?.group).toBe("Sequential");
    expect(getCbColorTheme("nope")).toBeUndefined();
  });

  it("returns 8-char AARRGGBB (FF alpha, uppercase) colors", () => {
    const theme = getCbColorTheme("Blues")!;
    const colors = themeColorsFor(theme, 3);
    expect(colors).toHaveLength(3);
    for (const c of colors) {
      expect(c).toMatch(/^FF[0-9A-F]{6}$/);
    }
    // Blues 3-class first color is deebf7 → FFDEEBF7
    expect(colors[0]).toBe("FFDEEBF7");
  });

  it("uses the palette variant tuned for the exact break count (ColorBrewer per-class)", () => {
    const theme = getCbColorTheme("Blues")!;
    // Blues 5-class differs from 3-class — picking 5 yields the 5-class set
    expect(themeColorsFor(theme, 5)).toEqual([
      "FFEFF3FF", "FFBDD7E7", "FF6BAED6", "FF3182BD", "FF08519C",
    ]);
  });

  it("below the smallest variant, takes the first N of the smallest", () => {
    const theme = getCbColorTheme("Blues")!; // smallest defined = 3
    const two = themeColorsFor(theme, 2);
    expect(two).toHaveLength(2);
    expect(two).toEqual(["FFDEEBF7", "FF9ECAE1"]); // first 2 of the 3-class set
  });

  it("above the largest variant, repeats the largest palette (modulo)", () => {
    const theme = getCbColorTheme("Blues")!; // largest defined = 9
    const eleven = themeColorsFor(theme, 11);
    expect(eleven).toHaveLength(11);
    // color[9] wraps to color[0], color[10] to color[1]
    expect(eleven[9]).toBe(eleven[0]);
    expect(eleven[10]).toBe(eleven[1]);
  });

  it("qualitative themes slice the single ordered array for small N and repeat for large N", () => {
    const set2 = getCbColorTheme("Set2")!;
    const three = themeColorsFor(set2, 3);
    expect(three).toEqual(["FF66C2A5", "FFFC8D62", "FF8DA0CB"]); // first 3 of Set2
    const ten = themeColorsFor(set2, 10); // Set2 has 8 → repeats
    expect(ten).toHaveLength(10);
    expect(ten[8]).toBe(ten[0]);
    expect(ten[9]).toBe(ten[1]);
  });

  it("returns [] for count 0", () => {
    expect(themeColorsFor(getCbColorTheme("Blues")!, 0)).toEqual([]);
  });
});
