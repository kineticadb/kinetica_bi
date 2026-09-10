# Phase 80: Token Foundation + Aurora Default Theme — Research

**Researched:** 2026-06-23
**Domain:** CSS design-token systems, web-font self-hosting, recharts theme-reactive colors
**Confidence:** HIGH (primary unknowns resolved via official docs + npm registry; recharts behavior confirmed by project's own prior research notes + recharts discussion #6928)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Aurora identity; Kinetica violet `#7f40ed` on near-black `#0a0a12`; Manrope body + Space Grotesk display; compact density; dark-mode token values from the mockup; two-tier accent rule (`--accent` fills / `--accent-text` readable text); extend the CSS-custom-property token system — NO Tailwind / Shadcn.
- Light-mode Aurora palette: warm off-white panels (`≈ #f6f5fb`) on darker page (`≈ #eceaf3`); `--accent` stays `#7f40ed` for fills; `--accent-text` darker on light (`≈ #6d28d9` / `#5b21b6`); keep hex mesh + faint violet glow wash in light mode.
- Default categorical palette: series-1 = Kinetica violet, then clearly-distinct colorblind-aware hues (blue, teal, amber, pink…); separate dark + light values for axis/grid/accent/series.
- Axis/grid/accent become theme-token-aware; `useChartAxisColors()` + `DEFAULT_CHART_PALETTE` refactored to derive from theme/tokens.
- Existing per-chart color overrides and per-value class-break coloring remain as-is.
- Token migration: ALL tokens defined AND all of `global.css` + 3 component CSS files migrated this phase; normalize to clean scales (4px spacing, ~4-step radius, type ramp, 400/500/600/700 weights, `--duration-*`).
- Dark/light mechanism unchanged: `data-theme` on `<html>`, `kinetica-bi-theme` localStorage, existing `index.html` FOUC guard, `store/theme.ts` `applyTheme`.
- Theme-guard extended: curated forbid-list (px font-sizes, radii, padding/margin/gap, ms durations) + allow structural primitives (0, 1px/2px, %, 1fr, unitless); scope = components + `global.css`; file allowlist + inline `/* theme-guard-ignore: <reason> */` pragma.

### Claude's Discretion
- Exact light-mode hex values (within "warm off-white bg + darker `--accent-text`, WCAG-checked").
- Exact token names/scale steps and curated chart hue set (violet lead).
- How to split work across plans 80-01/02/03.
- Precise forbid/allow regex set + allowlist entries for the extended guard.

### Deferred Ideas (OUT OF SCOPE)
- Chart series palette as a separate brandable control in the admin UI.
- Brand server store / runtime apply / FOUC-for-brand / identity wiring (Phases 81–82).
- Branding admin UI + custom CSS (Phases 83+, CSS sanitize/scope).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TOKENS-V116-01 | Full design-token vocabulary in `:root` (color, type, spacing, radius, elevation, motion) dark + light | Token structure section; existing `:root` shape confirmed in global.css |
| TOKENS-V116-02 | Existing styles (global.css + 3 component CSS) migrated off hardcoded literals onto structural tokens | Migration scope analysis; normalize-to-scale guidance |
| TOKENS-V116-03 | Extended theme-guard prevents structural-literal regressions | Guard extension pattern (regex forbid/allow + pragma) documented |
| TOKENS-V116-04 | Two-tier accent rule holds across dark + light | Locked in CHOSEN-DIRECTION.md; WCAG guidance in color section |
| THEME-V116-01 | Aurora dark theme ships — violet on near-black, hex mesh + aurora glow, Manrope + Space Grotesk, compact | Font loading mechanism researched (Unknown 1 resolved) |
| THEME-V116-02 | Coherent light-mode palette derived from same brand identity, toggle continues to work | Existing dark/light mechanism confirmed; light accent derivation in constraints |
| THEME-V116-03 | Chart colors integrate with theme — accents follow brand, series remain distinct | recharts CSS-var limitation confirmed (Unknown 2 resolved) |
</phase_requirements>

---

## Summary

This phase has two genuine technical unknowns, both now resolved. All design decisions are locked upstream. The implementation is a controlled CSS refactor + font addition + chart hook extension with no new build infrastructure.

**Unknown 1 — Space Grotesk font loading.** Manrope is currently loaded via Google Fonts CDN (`index.html` `<link>` tags). This is a GDPR problem (Munich court rulings 2022 + 2023 established that dynamic Google Fonts loading transmits visitor IPs to Google without lawful basis). For an on-prem / enterprise / air-gapped BI tool, the CDN approach is also fragile. **Recommendation: self-host BOTH fonts via `@fontsource-variable` packages, migrating Manrope off Google Fonts CDN at the same time.** The variable font packages (a single WOFF2 file per style covers the full 300–700 weight range) are the most efficient mechanism; fontsource defaults to `font-display: swap`; the import goes in `main.tsx` alongside `./styles/global.css`; the CSS font-family reference changes from `"Manrope"` to `"Manrope Variable"` and from `"Space Grotesk"` to `"Space Grotesk Variable"`.

**Unknown 2 — recharts theme-reactive colors.** Confirmed: recharts 2.x renders axis/grid/tick colors as SVG presentation attributes (`stroke=`, `fill=`). SVG presentation attributes do NOT inherit CSS custom property values (only CSS properties do — `stroke` as a CSS property on an element would inherit, but recharts passes these as element attributes, not CSS). This is a browser/SVG spec issue, not a recharts bug. The existing `useChartAxisColors()` hook is the correct architectural response — read the theme store in React, return resolved JS hex values, pass them as props. The extension for Phase 80 is: resolve color values from CSS custom properties at runtime via `getComputedStyle(document.documentElement).getPropertyValue('--token-name').trim()` inside the hook (after the DOM is available), OR maintain a TS token mirror. Both approaches are viable; the tradeoff is documented below.

**Primary recommendation:** Self-host via `@fontsource-variable`; extend `useChartAxisColors()` with `getComputedStyle` reads for the per-mode axis/grid/accent values, and define the categorical palette as a TS constant (not CSS-var-resolved) since series colors are the same across light/dark modes and must be resolved synchronously at render time.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fontsource-variable/space-grotesk` | 5.2.10 | Self-hosted Space Grotesk WOFF2, weights 300–700 | Single WOFF2 variable font; no CDN call; offline-safe; fontsource is the de-facto self-hosting standard for Google Fonts origin fonts |
| `@fontsource-variable/manrope` | 5.2.8 | Self-hosted Manrope WOFF2, weights 300–800 | Replaces current Google Fonts CDN `<link>` in `index.html`; same font, same weights, no external request |

Both are already in the npm registry as of the search date (versions confirmed via `npm view`). No other new dependencies for Phase 80. recharts, vitest, vite are all already installed.

**Installation:**
```bash
npm install @fontsource-variable/space-grotesk @fontsource-variable/manrope
```
(Run from repo root or `packages/web` depending on workspace resolution — the packages land in the workspace root `node_modules`.)

**Version verification (confirmed 2026-06-23):**
- `@fontsource/space-grotesk` static: 5.2.10
- `@fontsource-variable/space-grotesk`: 5.2.10
- `@fontsource-variable/manrope`: 5.2.8

---

## Architecture Patterns

### Pattern 1: Font Loading Migration (Google Fonts CDN → fontsource)

**Current state (index.html):**
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

**After migration — remove all three `<link>` tags from index.html entirely.**

**In `packages/web/src/main.tsx` (add two import lines alongside the existing `./styles/global.css` import):**
```typescript
// Source: https://fontsource.org/fonts/space-grotesk/install
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./styles/global.css";
```

The variable font `wght.css` imports a single WOFF2 file covering the full weight range (300–700 / 300–800). It replaces per-weight static imports. Vite processes the `url()` references inside the fontsource CSS and includes the WOFF2 files in the build output — they are served from the app's own origin, never from Google.

**In `global.css` `:root`, update the font-family stack:**
```css
/* Body */
font-family: "Manrope Variable", "Segoe UI", system-ui, -apple-system, sans-serif;

/* Display (heading / large text) — new token */
--font-display: "Space Grotesk Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
```

Note the font-family name changes from `"Manrope"` to `"Manrope Variable"` and from `"Space Grotesk"` to `"Space Grotesk Variable"` — fontsource variable packages register under the `<Name> Variable` family name. If the CSS continues to reference `"Manrope"` after migrating, the browser falls back to the system font.

**Why not static @fontsource/manrope + @fontsource/space-grotesk?**
The static packages require separate imports per weight (`/400.css`, `/500.css`, `/700.css`), yielding 3–4 WOFF2 files each. Variable fonts cover the full range in one file. This is what fontsource docs recommend for multiple-weight usage. The only case for static is targeting a browser that doesn't support variable fonts — all browsers this project targets (Chrome, Edge, Firefox, Safari) have supported variable fonts since 2018.

**font-display: swap** — fontsource defaults to `swap` in its generated `@font-face` declarations. FOUT (flash of unstyled text) is visible for ~100ms on first cold load but the fallback chain (`"Segoe UI", system-ui`) is close enough to the target metric that layout shift is minimal. This is the same behavior the Google Fonts CDN link was providing (`?display=swap`).

**Air-gapped / offline deploy** — all WOFF2 files are bundled into the Vite output at build time. No network request at runtime. This is a hard requirement for on-prem enterprise deployments.

**GDPR** — no external request; no IP address transmitted to Google. Satisfies the Munich court ruling requirement (self-hosting is the explicit approved solution per both 2022 and 2023 rulings).

---

### Pattern 2: recharts Theme-Reactive Colors

**The limitation (confirmed):** recharts 2.x/2.15.4 passes axis/grid colors as SVG presentation attributes (e.g. `<CartesianGrid stroke="#1f2937" />`). SVG presentation attributes do not resolve CSS custom properties — `stroke="var(--border)"` produces a broken/invisible line because the browser does not evaluate `var()` inside an attribute value. Only CSS properties on elements (set via `style` attribute or stylesheet) resolve CSS vars. This is the browser/SVG spec, not a recharts limitation — it is documented in recharts discussion #6928 ("Support css variables for colors — SVG presentation attributes are a known limitation").

The installed version (2.15.4, under the `^2.10.3` constraint) does not change this. recharts 3.x (separate major release) does not fix this SVG limitation either — it still relies on JS-passed props for SVG colors.

**The existing pattern in `useChartAxisColors()` is architecturally correct.** It reads the theme store, returns JS hex values, and those values are passed as props to recharts components. Phase 80 extends this pattern.

**Two implementation options for reading token values in the hook:**

**Option A — `getComputedStyle` reads (recommended for axis/grid/accent):**
```typescript
// Source: MDN Web API + recharts discussion #6928 pattern
import { useThemeStore } from "../store/theme";

export function useChartAxisColors(): ChartAxisColors {
  const theme = useThemeStore((s) => s.theme);
  // Re-derives on every theme change. getComputedStyle(:root) is synchronous and
  // fast — it reads the already-computed cascade, not a layout recalc.
  // Called at render time (not in an effect) because the DOM is available by then.
  const root = document.documentElement;
  const get = (v: string) =>
    getComputedStyle(root).getPropertyValue(v).trim();
  return {
    grid:      get("--color-chart-grid"),
    axis:      get("--color-chart-axis"),
    emptyCell: get("--color-chart-grid"),
    accent:    get("--accent-2"),
  };
}
```

This reads whatever the current `:root` or `:root[data-theme="light"]` has resolved for those tokens. The hook re-runs when the theme store value changes (because of the `useThemeStore` subscription), so the resolved values are always current. `getComputedStyle` on the root element is a synchronous O(1) read of the already-computed style; it does not trigger layout.

**Option B — TS token mirror (recommended for series palette):**
```typescript
// packages/web/src/lib/chartTokens.ts
export const CHART_TOKENS = {
  dark: {
    grid:   "#1a1830",  // --color-chart-grid dark
    axis:   "#6b6490",  // --color-chart-axis dark
    accent: "#38bdf8",  // --accent-2 dark
  },
  light: {
    grid:   "#e6e3f5",  // --color-chart-grid light
    axis:   "#7c6faa",  // --color-chart-axis light
    accent: "#0284c7",  // --accent-2 light
  },
} as const;

// Categorical series palette — same for dark + light (hue is the discriminator,
// not brightness; both backgrounds are far from the series hues)
export const AURORA_CHART_PALETTE = [
  "#7f40ed",  // series-1: Kinetica violet (brand anchor)
  "#38bdf8",  // series-2: sky blue (--accent-2)
  "#2dd4bf",  // series-3: teal
  "#f59e0b",  // series-4: amber
  "#f472b6",  // series-5: pink
  "#a3e635",  // series-6: lime
] as const;
```

**Tradeoff — getComputedStyle vs TS mirror:**

| | getComputedStyle reads | TS token mirror |
|---|---|---|
| Single source of truth | Yes — CSS is authoritative | No — duplicates values; must keep in sync |
| Works before DOM ready | No — needs `document.documentElement` | Yes — pure constant |
| Picks up runtime brand overrides (Phase 82) | Yes automatically | No — mirror must be regenerated |
| Good for series palette | No — series colors don't vary per theme; reading 6 CSS vars per render is unnecessary | Yes — define once as const |
| Good for axis/grid/accent | Yes — these DO vary per theme and will vary per brand in Phase 82 | Workable but requires manual sync |

**Recommendation:** Use `getComputedStyle` for axis/grid/accent (they vary per theme + will vary per brand token in Phase 82 — the hook automatically picks up the brand-applied values with no code change). Use a TS const for the categorical series palette (series hues don't flip per theme; defining them as a TS const makes them fast, testable, and easy to scan for colorblind-contrast review).

**Series palette — colorblind-aware design note (locked in CONTEXT.md):**
The `AURORA_CHART_PALETTE` above uses hue + luminance discrimination. Violet (`#7f40ed`) and sky blue (`#38bdf8`) differ in hue and luminance; teal (`#2dd4bf`) and amber (`#f59e0b`) are a warm/cool pair. This set is distinguishable for deuteranopia/protanopia because the series never relies on red-vs-green alone. The exact hue values are Claude's discretion per the CONTEXT.md — the implementer should verify the final set with a colorblind simulator (e.g. Coblis or Chrome DevTools vision deficiencies).

---

### Pattern 3: Token Structure in global.css

The existing `:root` block already defines color tokens correctly (the Aurora migration replaces values, not the mechanism). The Phase 80 addition is the **structural token categories** that do not yet exist. Recommended token names for the planner:

```css
/* Typography */
--font-body: "Manrope Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
--font-display: "Space Grotesk Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
--text-2xs: 9px;   --text-xs: 10px;  --text-sm: 11px;
--text-base: 12px; --text-lg: 14px;  --text-2xl: 21px;
--font-weight-normal: 400; --font-weight-medium: 500;
--font-weight-semibold: 600; --font-weight-bold: 700;
--leading-tight: 1.25; --leading-normal: 1.5;
--tracking-tight: -0.01em; --tracking-normal: 0;

/* Spacing (4px rhythm) */
--space-1: 4px;  --space-2: 8px;   --space-3: 10px;  --space-4: 12px;
--space-5: 16px; --space-6: 20px;  --space-8: 24px; --space-10: 32px;

/* Radius */
--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
--radius: 13px; /* default per mockup */

/* Elevation */
--shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
--shadow-md: 0 4px 12px rgba(0,0,0,0.4);
--shadow-lg: var(--shadow);  /* existing --shadow preserved as alias */

/* Motion */
--duration-fast: 100ms; --duration-base: 200ms; --duration-slow: 300ms;
--ease-standard: cubic-bezier(.2,.7,.2,1);

/* Chart-specific (resolved by useChartAxisColors via getComputedStyle) */
--color-chart-grid: …;   /* dark: low-contrast near-black; light: near-white */
--color-chart-axis: …;   /* dark: muted purple-grey; light: muted mid-grey */
```

The mockup token values (CHOSEN-DIRECTION.md) are the authoritative source for dark mode; light mode values are Claude's discretion within the warm-off-white + WCAG-checked constraint.

---

### Pattern 4: Theme-Guard Extension

**Current guard (theme-guard.spec.ts):**
- Scans `src/components/**/*.tsx` (excl. spec) + component `*.css`
- Detects `#RGB` / `#RRGGBB` hex literals
- File-level ALLOWLIST with justifications

**Extension for Phase 80 (three changes):**

**Change 1 — Add global.css to the scanned set.** The current `collectThemed()` only walks `COMPONENTS_DIR`. Add a second path: `resolve(process.cwd(), "src/styles/global.css")` as a direct single-file addition to the collected list (it's not a directory to walk). Treat it like any other scanned file — no ALLOWLIST entry needed since after migration it should have zero structural literals.

**Change 2 — Add structural-literal regex.** A second guard test (separate `describe` block or additional `it` within the same spec) using:

```typescript
// Forbid: px values that SHOULD be tokens.
// Pattern: a digit string ending in "px" that is NOT 0px, 1px, or 2px.
// Excludes: "0", "1px", "2px" (hairlines), %, fr, unitless.
// Inline opt-out: lines containing "/* theme-guard-ignore:" are skipped.
const STRUCTURAL_LITERAL_RE =
  /\b(?!0\b|0px\b|1px\b|2px\b)\d+(\.\d+)?px\b/;

// Forbid: ms duration literals that should be --duration-* tokens.
const DURATION_LITERAL_RE = /\b\d+ms\b/;
```

Apply these to the same file set. Skip any line that matches `theme-guard-ignore`.

**Change 3 — Inline pragma.** Lines containing `/* theme-guard-ignore: <reason> */` are excluded from structural-literal scanning. The pragma requires a reason string (enforced by the regex requiring non-empty text after the colon) to prevent `/* theme-guard-ignore */` lazy usage.

**Allowlist for structural guard:** The structural guard does NOT use the file-level ALLOWLIST (all files in scope should have zero structural literals post-migration). Instead it uses the inline pragma for one-off legitimate values (e.g. an OpenLayers canvas size of `512px` that is geometry, not UI spacing). The existing file-level ALLOWLIST continues for the hex color guard only.

**Note on false positives to pre-empt:**
- `border: 1px solid var(--border)` — 1px is in the allow list
- `border-radius: 50%` — `%` is not matched
- `flex: 0 0 212px` — 212px is a layout constant for the sidebar; add `/* theme-guard-ignore: sidebar fixed width, not a component spacing token */` or use `--sidebar-width: 212px` token
- `transform: translateY(-2px)` — 2px is in the allow list
- SVG `viewBox="0 0 16 16"` — unitless integers, not matched

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Web font self-hosting | Manual `@font-face` + copy WOFF2 files to `public/` | `@fontsource-variable/space-grotesk` + `@fontsource-variable/manrope` | fontsource manages subset generation, `font-display`, correct `format()` hints, unicode-range splits, and keeps files updated via npm version bumps |
| CSS variable resolution in SVG | Injecting CSS stylesheet rules that set SVG attributes | `getComputedStyle(document.documentElement).getPropertyValue()` in the React hook | The hook already owns this concern; CSS rules cannot set SVG presentation attributes regardless |
| Color contrast calculation | Custom WCAG formula | Use existing colord (already a Phase 81 dep) or a browser devtools check during implementation | Floating-point WCAG math has edge cases; the formulas are well-established |

---

## Common Pitfalls

### Pitfall 1: Font-Family Name Mismatch After Migrating to Variable Fonts
**What goes wrong:** `global.css` still references `font-family: "Manrope"` after migrating to `@fontsource-variable/manrope`. The browser finds no `"Manrope"` family (the variable package registers as `"Manrope Variable"`) and falls back to the system font silently.
**Why it happens:** The variable fontsource packages use a different family name (`<Name> Variable`) to avoid conflicting with static instances.
**How to avoid:** Update every `font-family` reference — `:root` property, any `--font-body` / `--font-display` token values, and any component inline styles — from `"Manrope"` to `"Manrope Variable"` and from `"Space Grotesk"` to `"Space Grotesk Variable"`.
**Warning signs:** Dev tools font panel shows the system font rather than Manrope/Space Grotesk; the compact metric of Space Grotesk display headings looks wrong.

### Pitfall 2: getComputedStyle Returns Empty String Before DOM Token Paint
**What goes wrong:** `getComputedStyle(document.documentElement).getPropertyValue("--color-chart-grid")` returns `""` if called before the CSS is parsed (e.g. in a module-level constant initialization).
**Why it happens:** CSS modules parse asynchronously relative to JS module execution at startup.
**How to avoid:** Only call `getComputedStyle` inside a React render function or hook (not at module level). The existing `useChartAxisColors()` hook is already called inside React components — this is fine. Do NOT hoist the resolution to a module-level const.
**Warning signs:** Chart axis/grid lines disappear on first render, then appear after a re-render.

### Pitfall 3: theme-guard Structural Regex Matching Inside CSS Calc/Grid Track Values
**What goes wrong:** The structural forbid regex `\b\d+px\b` matches inside legitimate `calc()` expressions, `grid-template-columns`, or border shorthand (e.g. `1px solid`).
**Why it happens:** `\b` word-boundary matching doesn't understand CSS context.
**How to avoid:** Tune the allow-list to include `1px` and `2px` (already specified above). For `calc()` expressions with token arithmetic (`calc(var(--space-2) + 4px)` where `4px` is a one-off adjustment), use the inline pragma. Document that `calc()` with one-off px offsets is acceptable with a reason comment.
**Warning signs:** Guard fails on `border: 1px solid` or `grid-gap: 2px` which are legitimate primitives.

### Pitfall 4: recharts Tooltip `contentStyle` Uses CSS Vars — Keep It
**What goes wrong:** The `RECHARTS_TOOLTIP_PROPS.contentStyle` in `chartTheme.ts` already uses `var(--panel)`, `var(--border)`, `var(--text)`. These work because the Tooltip renders as an HTML `<div>`, not an SVG element. HTML elements DO resolve CSS custom properties.
**Why it matters:** Do not "fix" the tooltip to use JS-resolved colors — it would break the brand token pipeline in Phase 82. Only SVG presentation attributes need JS resolution.
**Warning signs:** A refactor that flattens all chart colors to JS hex in one pass would remove the CSS var wiring from the tooltip.

### Pitfall 5: Forgetting to Remove the Google Fonts `<link>` Tags
**What goes wrong:** After adding fontsource imports, the Google Fonts CDN links are left in `index.html`. The browser makes the external request anyway (GDPR exposure) and both font versions may coexist, causing unexpected fallback resolution.
**How to avoid:** Remove all three lines from `index.html` (preconnect google, preconnect gstatic, the stylesheet link) in the same commit that adds the fontsource imports.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Google Fonts CDN `<link>` in `index.html` | `@fontsource-variable` npm import in `main.tsx` | Phase 80 | Eliminates GDPR risk, enables offline/air-gapped deploys, no external network request at runtime |
| Static font weights (4 WOFF2 files) | Variable font (1 WOFF2 file, wght axis 300–700) | fontsource v5 (current) | Smaller total bundle; smoother intermediate weights |
| `DEFAULT_CHART_PALETTE` green-anchored (`#22c55e` lead) | `AURORA_CHART_PALETTE` violet-anchored (`#7f40ed` lead) | Phase 80 | Brand consistency; violet series-1 aligns with the Aurora identity |
| `useChartAxisColors()` hardcoded per-theme hex (slate-200, slate-500, etc.) | `useChartAxisColors()` reads `--color-chart-*` tokens via `getComputedStyle` | Phase 80 | Axis/grid colors automatically follow brand overrides applied in Phase 82 |

---

## Open Questions

1. **Sidebar width as a token or structural constant?**
   - What we know: The mockup specifies 212px; the current CSS likely has this as a literal.
   - What's unclear: Should `--sidebar-width: 212px` be a token (brandable in the admin UI later) or a structural constant (never brandable)?
   - Recommendation: Define as `--sidebar-width: 212px` in `:root` with a comment marking it structural (not brandable). This satisfies the theme-guard without making it part of the public brand API.

2. **Manrope weights in use today vs variable range.**
   - What we know: The Google Fonts link specifies `wght@400;500;600;700`; `@fontsource-variable/manrope` covers 300–800.
   - What's unclear: Whether any component uses weight 800 (bold display headings).
   - Recommendation: The variable font covers all weights in one file — no action needed. Use `@fontsource-variable/manrope/wght.css` and all current + future weights work automatically.

3. **`DEFAULT_BAR_COLOR` / `DEFAULT_LINE_COLOR` / `DEFAULT_AREA_COLOR` constants.**
   - What we know: These are separate single-series fallback constants in `chartTheme.ts` (`#22c55e`, `#38bdf8`, etc.) that would need updating to violet-led aurora values.
   - What's unclear: Whether these should index into `AURORA_CHART_PALETTE[0]` or be defined separately.
   - Recommendation: Redefine as `AURORA_CHART_PALETTE[0]` (violet), `[1]` (sky), etc. — keeps them consistent with the palette automatically.

---

## Validation Architecture

Nyquist validation is explicitly disabled (`workflow.nyquist_validation: false` in `.planning/config.json`). No test-map section required.

**Brief test approach note for completeness:** Phase 80 test coverage comes from:
1. `theme-guard.spec.ts` — extended in this phase to catch structural literals; its green run is the primary CI gate for TOKENS-V116-02 and -03.
2. `web tsc` — type-checks the updated `chartColors.ts` and `chartTheme.ts` hook signatures.
3. Visual smoke test: open the app in dark + light mode; verify Space Grotesk renders on display headings; verify chart axes/gridlines flip color with the theme toggle.

---

## Sources

### Primary (HIGH confidence)
- npm registry `npm view @fontsource-variable/space-grotesk` — version 5.2.10, confirmed 2026-06-23
- npm registry `npm view @fontsource-variable/manrope` — version 5.2.8, confirmed 2026-06-23
- https://fontsource.org/fonts/space-grotesk/install — exact install command, import syntax, font-family name `"Space Grotesk Variable"`
- https://fontsource.org/docs/getting-started/display — fontsource defaults to `font-display: swap`; WOFF2 confirmed as the file format
- https://fontsource.org/docs/getting-started/install — Vite bundler handling of `url()` in fontsource CSS; no manual config needed
- `packages/web/index.html` (read directly) — confirmed Manrope is loaded via Google Fonts CDN (`fonts.googleapis.com` + `fonts.gstatic.com` links)
- `packages/web/node_modules/recharts/package.json` (read directly) — confirmed installed version 2.15.4
- recharts discussion #6928 (https://github.com/recharts/recharts/discussions/6928) — confirmed CSS variable support for SVG presentation attributes is a known limitation, not planned for recharts 2.x
- `packages/web/src/styles/theme-guard.spec.ts` (read directly) — confirmed existing ALLOWLIST + file-collector + HEX_RE patterns to extend
- `packages/web/src/lib/chartColors.ts` (read directly) — confirmed existing hook shape: reads theme store, returns hex object
- `packages/web/src/lib/chartTheme.ts` (read directly) — confirmed `DEFAULT_CHART_PALETTE` and per-type defaults

### Secondary (MEDIUM confidence)
- German court ruling coverage (The Hacker News, The Register, LLP Law) — corroborates GDPR concern; Munich LG ruling Jan 2022 + March 2023 confirmation
- https://github.com/recharts/recharts/discussions/6928 — recharts maintainer response confirming SVG attribute limitation; CSS vars described as "known limitation we can investigate incrementally"
- MDN `getComputedStyle` — standard API; `getPropertyValue()` for CSS custom properties is well-documented

### Tertiary (LOW confidence)
- None. No findings relied on unverified single sources.

---

## Metadata

**Confidence breakdown:**
- Font loading mechanism: HIGH — confirmed by direct file read (index.html) + npm registry + official fontsource docs
- recharts CSS var limitation: HIGH — confirmed by direct codebase read (chartColors.ts already works around it) + recharts maintainer discussion
- Theme-guard extension pattern: HIGH — confirmed by direct spec read (exact patterns to extend are visible in the file)
- Light-mode token values: not researched (locked as Claude's discretion per CONTEXT.md)
- Series palette hues: not researched (locked as Claude's discretion per CONTEXT.md)

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (fontsource versions are stable; recharts 2.x SVG limitation is architectural; no fast-moving surface)
