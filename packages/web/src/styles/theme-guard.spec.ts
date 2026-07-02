/**
 * Theme guard — two-layer static assertion against token-system regressions.
 *
 * Layer 1 (hex colors): prevents hardcoded hex color literals from creeping back into
 * components after the theming-hardening refactor.
 *
 * Layer 2 (structural literals, added Phase 80-03): prevents structural CSS values
 * (font-sizes, border-radii, paddings/margins/gaps, ms durations) from bypassing the
 * token system. Allows 0/1px/2px hairlines, %, fr, unitless line-heights. Supports an
 * inline pragma /* theme-guard-ignore: <reason> *\/ (reason required) for one-off
 * justified exceptions.
 *
 * Scans: src/components/**\/*.tsx (excl. *.spec.tsx) + component *.css + global.css.
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
  // Phase 102 (BARGRP-V119-02): toCssColor helper converts AARRGGBB→#RRGGBB for recharts
  // SVG fill props — data-viz series colors, not app chrome.
  "charts/WidgetRenderer.tsx",
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
  // Token definition source: :root blocks legitimately contain hex color values —
  // these ARE the token system (not literals bypassing it). The structural guard
  // (second describe block below) enforces that properties in rules use var() instead.
  "../styles/global.css",
  // Brand color tooling: BrandingSettingsPage authors the Aurora default-hex map
  // (COLOR_FIELDS fallback values) — its job is to define literal hex color defaults.
  // Also contains the fixed #ffffff on-accent WCAG check literal.
  "settings/BrandingSettingsPage.tsx",
];

/**
 * Recursively collect themed source files under dir: *.tsx (excluding *.spec.tsx)
 * AND component *.css (component stylesheets must use tokens too, e.g. RolesPage.css).
 */
function collectThemed(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectThemed(full));
    } else if (
      entry.isFile() &&
      ((entry.name.endsWith(".tsx") && !entry.name.endsWith(".spec.tsx")) ||
        entry.name.endsWith(".css"))
    ) {
      out.push(full);
    }
  }
  return out;
}

// Word-bounded hex color literal: #RGB or #RRGGBB. The trailing boundary rejects
// 8-digit AARRGGBB-with-# (none exist in components) while matching 3/6-digit hex.
const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;

// Path to global.css — added to both guard scans (Phase 80-03).
const GLOBAL_CSS_PATH = resolve(process.cwd(), "src/styles/global.css");

describe("theme guard: no hardcoded hex colors in components", () => {
  // Include global.css in the hex-color scan so rainbow hex drift there is caught too.
  const files = [...collectThemed(COMPONENTS_DIR), GLOBAL_CSS_PATH];

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

// =============================================================================
// Structural-literal guard (Phase 80-03, TOKENS-V116-03)
//
// Catches drift where a developer writes `padding: 12px` instead of
// `padding: var(--space-4)`, or `transition: 200ms` instead of
// `transition: var(--duration-base)`. CSS properties that SHOULD use tokens
// are forbidden with specific px and ms patterns.
//
// Allow-list (not a ALLOWLIST entry, but the guard's built-in exceptions):
//   0, 1px, 2px  - hairline border / fine-tuning structural primitives
//   %, fr, vh, vw, unitless line-heights - layout/responsive primitives
//   width, height, max-width, etc. - dimensional layout (not structural tokens)
//   :root --custom-prop definitions - token definitions themselves (skipped)
//   Pure comment lines (// * /*) - skipped to avoid false positives in JSDoc
//
// Inline opt-out: /* theme-guard-ignore: <reason> */
//   Requires a non-empty reason (regex enforces \S after the colon-space).
//   Exempts that LINE ONLY from the structural scan.
//   The hex guard uses file-level ALLOWLIST entries (unchanged).
// =============================================================================

/**
 * Forbid structural CSS property declarations with raw px values > 2px.
 * Targets properties that MUST use design tokens: font-size, border-radius,
 * padding[-*], margin[-*], gap, column-gap, row-gap.
 * Does NOT match: width, height, min-*, max-*, top, left, bottom, right,
 * letter-spacing, box-shadow, blur(), transform, flex, grid-template-*, etc.
 * (those are dimensional layout constants, not structural tokens).
 */
const STRUCTURAL_LITERAL_RE =
  /(font-size|border-radius|padding(-top|-right|-bottom|-left|-inline|-block)?|margin(-top|-right|-bottom|-left|-inline|-block)?|gap|column-gap|row-gap)\s*:\s*(?!0\b|0px|1px|2px)\d+(\.\d+)?px\b/;

/**
 * Forbid raw ms duration values in CSS transition/animation property declarations.
 * Matches transition/animation lines containing a bare ms number that should use
 * --duration-fast/base/slow tokens.
 */
const DURATION_LITERAL_RE =
  /(transition|animation(-duration|-delay)?)\s*:[^;]*\b\d+ms\b/;

// Inline opt-out pragma - a non-empty reason is REQUIRED (\S after the colon-space).
// A pragma without a reason does NOT match and does NOT exempt the line.
// A pragma with a reason exempts that line from structural scanning only.
// The hex guard uses the file-level ALLOWLIST (unchanged).
const IGNORE_RE = /\/\*\s*theme-guard-ignore:\s*\S/;

describe("theme guard: no structural px/ms literals in components + global.css", () => {
  // Collect the same file set as the hex guard, plus global.css explicitly.
  const componentFiles = collectThemed(COMPONENTS_DIR);
  const allFiles = [...componentFiles, GLOBAL_CSS_PATH];

  it("finds files to scan (components + global.css)", () => {
    expect(allFiles.length).toBeGreaterThan(0);
    // global.css must be in the set
    expect(allFiles.some((f) => f.endsWith("global.css"))).toBe(true);
  });

  for (const file of allFiles) {
    const rel = relative(COMPONENTS_DIR, file).split("\\").join("/");

    it(`${rel}: no raw structural px/ms literals (or pragma-justified)`, () => {
      const source = readFileSync(file, "utf-8");
      const violations: string[] = [];

      source.split("\n").forEach((line, idx) => {
        // Skip lines with a valid pragma (reason required).
        if (IGNORE_RE.test(line)) return;
        // Skip :root custom-property definitions (e.g. `--text-base: 12px`)
        // — these ARE the token system, not literals bypassing it.
        if (/^\s*--[a-z]/.test(line)) return;
        // Skip pure comment lines to avoid false positives in JSDoc / inline comments
        // that describe px values rather than declare them in CSS.
        const trimmed = line.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        )
          return;

        const matchesPx = STRUCTURAL_LITERAL_RE.test(line);
        const matchesMs = DURATION_LITERAL_RE.test(line);
        if (matchesPx || matchesMs) {
          const kind = matchesPx ? "structural px literal" : "raw ms duration";
          violations.push(
            `  Line ${idx + 1}: [${kind}] ${trimmed}\n` +
              `  → Use a token (var(--space-*/--radius-*/--text-*/--duration-*)) or ` +
              `add /* theme-guard-ignore: <reason> */ to justify this one-off.`,
          );
        }
      });

      expect(
        violations,
        `Structural literal(s) found in ${rel}:\n${violations.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
