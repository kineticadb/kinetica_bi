/**
 * Theme guard — static-source assertion preventing hardcoded hex colors from
 * creeping back into components after the theming-hardening refactor.
 *
 * Scans every src/components/**\/*.tsx (excluding *.spec.tsx) for raw hex color
 * literals (#RGB / #RRGGBB). Components must use theme tokens (var(--accent),
 * var(--text), var(--danger), ...) or the text-* utility classes instead.
 *
 * Path resolution mirrors the existing static-assertion specs (e.g.
 * DataFilterRenderer.spec.tsx): paths resolve against process.cwd(), which vitest
 * runs from packages/web. Do NOT invoke vitest with --root from the repo root or
 * these paths break.
 *
 * Legitimate data-visualization / color-tooling literals (series colors, color-input
 * defaults, draw-overlay strokes, AARRGGBB<->hex conversion comments) live in the
 * ALLOWLIST below, each with a one-line justification. lib/chartTheme.ts,
 * lib/colorHex.ts, lib/cbColorThemes.ts are under src/lib/ — outside the scanned
 * component set — so they need no entry here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const COMPONENTS_DIR = resolve(process.cwd(), "src/components");

/**
 * Files allowed to contain raw hex literals because the color IS the data /
 * the tool's job is to author colors. Paths are relative to src/components,
 * POSIX-separated. Each entry carries a justification.
 */
const ALLOWLIST: ReadonlyArray<string> = [
  // Data-viz: bright series-overlay band color painted on the chart (not chrome).
  "charts/TimelineRenderer.tsx",
  "charts/NumericLineRenderer.tsx",
  // Color tooling: the <input type="color"> default value + new color-rule default
  // (a color picker — its whole purpose is to author literal colors).
  "charts/ChartConfigPanel.tsx",
  // Draw-overlay data-viz: bbox/lasso/circle selection-shape fill+stroke colors
  // painted onto the OpenLayers map (data marks, not app chrome).
  "charts/MapChartRenderer.tsx",
  // Color tooling: AARRGGBB<->#RRGGBB conversion helpers; hex appears only in
  // explanatory comments describing the canonical color-storage format.
  "charts/TimelineConfigPanel.tsx",
  "charts/NumericLineConfigPanel.tsx",
];

/** Recursively collect all *.tsx files under dir, excluding *.spec.tsx. */
function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsx(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".spec.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

// Word-bounded hex color literal: #RGB or #RRGGBB. The trailing boundary rejects
// 8-digit AARRGGBB-with-# (none exist in components) while matching 3/6-digit hex.
const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;

describe("theme guard: no hardcoded hex colors in components", () => {
  const files = collectTsx(COMPONENTS_DIR);

  it("finds component source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = relative(COMPONENTS_DIR, file).split("\\").join("/");
    const allowed = ALLOWLIST.includes(rel);

    it(`${rel}${allowed ? " (allowlisted)" : ""} uses theme tokens, not raw hex`, () => {
      const source = readFileSync(file, "utf-8");
      const hasHex = HEX_RE.test(source);
      if (allowed) {
        // Allowlisted files are expected to contain at least one literal; if not,
        // the entry is stale and should be removed to keep the allowlist minimal.
        expect(
          hasHex,
          `${rel} is on the ALLOWLIST but contains no hex literal — remove the stale allowlist entry.`,
        ).toBe(true);
        return;
      }
      expect(
        hasHex,
        `Hardcoded hex color in a component (${rel}) — use a theme token ` +
          `(var(--accent/--text/--danger/...)) or a utility class (.text-danger, .text-muted, ...). ` +
          `If this is a legitimate data-viz/color-tooling literal, add the file to ALLOWLIST ` +
          `in src/styles/theme-guard.spec.ts with a comment.`,
      ).toBe(false);
    });
  }
});
