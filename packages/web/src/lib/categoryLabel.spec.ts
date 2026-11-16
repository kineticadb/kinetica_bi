// 142 UAT: a null category (e.g. a LEFT join with no match) showed a blank tick and "null" in the tooltip.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryLabel, BLANK_CATEGORY_LABEL } from "./categoryLabel";

describe("CATLABEL: category display text", () => {
  it("CATLABEL-1 null, undefined and empty or whitespace text read as (blank)", () => {
    expect(BLANK_CATEGORY_LABEL).toBe("(blank)");
    for (const v of [null, undefined, "", "  "]) expect(categoryLabel(v)).toBe("(blank)");
  });
  it("CATLABEL-2 real values are unchanged", () => {
    expect(categoryLabel("NYC")).toBe("NYC");
    expect(categoryLabel(0)).toBe("0");
    expect(categoryLabel(false)).toBe("false");
    expect(categoryLabel(" a ")).toBe(" a ");
  });
  it("CATLABEL-3 bar and line category axes format their ticks with it (structural; looks checked live)", () => {
    const src = readFileSync(resolve(__dirname, "../components/charts/WidgetRenderer.tsx"), "utf-8");
    // Bar axes go through categoryText, which IS categoryLabel unless the bar is time-bucketed
    // (quick 261116-bti: then the bucket is labelled at its interval). The vertical bar axis wraps
    // it (barCategoryTick shortens tilted labels); the line axis uses categoryLabel directly.
    expect(src).toMatch(/const categoryText = \(v: unknown\): string =>\s*timeUnit && v != null \? formatTimelineTick\(String\(v\), timeUnit, \{ withYear: timeWithYear \}\) : categoryLabel\(v\);/);
    expect(src).toMatch(/const barCategoryTick = \(v: unknown\): string => \(barXLayout\.tilt \? truncateBarLabel\(categoryText\(v\)\) : categoryText\(v\)\);/);
    expect(src.match(/<XAxis\s+dataKey=\{xKey\}[^>]*tickFormatter=\{barCategoryTick\}/g)?.length).toBe(1);
    expect(src.match(/<YAxis type="category" dataKey=\{xKey\}[^>]*tickFormatter=\{categoryText\}/g)?.length).toBe(1);
    expect(src.match(/tickFormatter=\{categoryLabel\}/g)?.length).toBe(1);
  });
});
