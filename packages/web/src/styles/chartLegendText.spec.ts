import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Quick 261117-wht: recharts colors legend text with the series color by default, so a pale series
// gets an unreadable label ("DDS" on a light card). Every chart <Legend> must use the shared
// formatter that renders the label in var(--text) (the swatch still shows the series color).
describe("chart legends use the theme text color", () => {
  it("WHT-4: every <Legend> in components/charts passes formatter={legendTextFormatter}", () => {
    const dir = join(__dirname, "../components/charts");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.includes(".spec."))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/<Legend\b[^>]*>/g)) {
        if (!m[0].includes("formatter={legendTextFormatter}")) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
