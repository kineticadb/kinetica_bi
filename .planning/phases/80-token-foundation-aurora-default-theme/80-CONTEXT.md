# Phase 80: Token Foundation + Aurora Default Theme - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

FRONTEND-ONLY (`packages/web`). Define the FULL structural design-token vocabulary in `global.css` `:root` (color + typography + spacing + radius + elevation + motion, dark AND light), migrate the existing styles onto it, ship the approved **Aurora** default theme (dark + light), make chart axis/grid/accent + the default series palette theme-aware, and extend the theme-guard to cover structural-token literals.

**Requirements:** TOKENS-V116-01/02/03/04, THEME-V116-01/02/03.
**NOT in scope:** the brand server store / runtime apply / admin UI / custom CSS (Phases 81–83); rebuilding the EXISTING per-widget color pickers or per-value class-break coloring (those already exist and remain untouched).

**Already LOCKED upstream (do NOT re-litigate)** — see `.planning/design/CHOSEN-DIRECTION.md`:
Aurora identity; violet `#7f40ed` on near-black `#0a0a12`; Manrope body + Space Grotesk display; compact density; the dark-mode token values from the mockup; the two-tier accent rule (`--accent` fills / `--accent-text` readable text); extend the CSS-custom-property token system (NO Tailwind/Shadcn).

</domain>

<decisions>
## Implementation Decisions

### Light-mode Aurora palette
- **Background:** WARM off-white — soft near-white panels (≈ `#f6f5fb`, faint violet-warm tint) on a slightly darker page (≈ `#eceaf3`). Not pure white. (Keeps the violet identity; matches today's `--bg`/`--panel` light split.)
- **Accent (two-tier, inverted for light):** `--accent` stays the brand violet `#7f40ed` for FILLS (buttons/swatches/borders); `--accent-text` goes DARKER on light (≈ `#6d28d9` / `#5b21b6`) so accent text/numbers stay readable on the off-white. WCAG-checked. (Exact light values are Claude's discretion within this rule.)
- **Treatment:** KEEP the hex mesh + a faint violet glow wash in light mode, much subtler (very low opacity) — preserves the distinctive Aurora identity across both modes (not a generic flat light theme).

### Chart / data-viz palette
- **Default categorical palette = brand-led:** series-1 = Kinetica violet, then a curated set of clearly-DISTINCT, colorblind-aware hues (blue, teal, amber, pink, …). Accessible + visually separable — never monochromatic. This is the DEFAULT/fallback when a widget hasn't set its own colors.
- **Per-mode tuned:** separate dark + light values for axis / grid / accent / series so charts stay legible on both backgrounds (mirrors today's `chartColors.ts` dark/light split; series hues adjusted per background).
- **Axis/grid/accent become theme-token-aware** (no hardcoded SVG presentation hex that ignores theme flips) — `useChartAxisColors()` + `DEFAULT_CHART_PALETTE` refactored to derive from theme/tokens.
- **EXISTING per-chart color override + per-value (class-break/categorical) coloring REMAIN as-is** — operators/customers already pick independent colors per chart and per value via the config panels; this phase does NOT rebuild or remove that. The brand-led palette is only the default.
- **NOT separately brandable in the admin UI this milestone** — the chart series palette is a fixed curated default (per-chart overrides cover customization). The brandable accent flows through tokens so series-1/accent track the brand.

### Token migration scope (this phase)
- **Define ALL tokens AND migrate everything now:** full token vocabulary in `:root` (dark+light) + migrate all of `global.css` (~4,440 lines, ~460 literals) AND the 3 component CSS files (`Topbar.css`, `ProfilePage.css`, `RolesPage.css`) + any inline component styles onto the tokens this phase. Styling is centralized (mostly one file) so this is tractable; later phases then build on a fully token-driven base.
- **NORMALIZE to clean scales** (don't preserve every exact literal): snap the messy clusters to defined scales — radius `2/3/4/6/8/10/12/14/16` → a ~4-step scale (`--radius-sm/md/lg` + default); font-size `9–22` → a defined ramp (`--text-2xs…--text-2xl`); paddings/margins → the 4px spacing rhythm (`--space-*`); weights → `400/500/600/700`; durations → `--duration-*`. Minor intentional pixel shifts are acceptable for a tighter, consistent system. Keep the compact defaults from the mockup.

### Theme-guard (extended)
- **Curated forbid-list, not all-px:** fail the build on literals that SHOULD be tokens — px font-sizes, border-radii, paddings/margins/gaps, ms durations — but ALLOW structural primitives: `0`, `1px`/`2px` hairline borders, `50%`/`100%`/other %, `1fr`, flex/grid track values, line-heights as unitless. Catches drift without fighting legitimate layout CSS.
- **Scope = components + `global.css`:** extend the existing `src/components/` scan to ALSO cover `global.css` (where the literals live). Both must use tokens for structural values. (Keep the existing no-raw-hex color check too.)
- **Exceptions = file allowlist + inline pragma:** keep the existing file-level ALLOWLIST pattern AND add a line-level opt-out comment (e.g. `/* theme-guard-ignore: <reason> */`) for one-off legit literals, each requiring a justification.

### Claude's Discretion
- Exact light-mode hex values (within "warm off-white bg + darker `--accent-text`, WCAG-checked").
- The exact token names/scale steps and the curated chart hue set (violet lead).
- How to split the work across plans 80-01/02/03 (the roadmap's split is a starting point).
- The precise forbid/allow regex set + allowlist entries for the extended guard.

</decisions>

<specifics>
## Specific Ideas
- The mockup `.planning/design/direction-A-aurora.html` is the visual source of truth for dark mode — match its compact spacing, type scale, radius, glow, hex mesh, and the two-tier accent.
- Light mode is the "softer, still-branded" face (warm off-white + subtle glow), NOT a flat generic light theme.
- Reuse the existing dark/light mechanism verbatim (`data-theme` on `<html>`, `kinetica-bi-theme` localStorage, the `index.html` inline FOUC guard, `store/theme.ts`) — only the token VALUES and coverage change.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design baseline (the source of truth)
- `.planning/design/CHOSEN-DIRECTION.md` — locked Aurora identity + dark token values + the two-tier accent rule + brandable-vs-structural split.
- `.planning/design/direction-A-aurora.html` — the approved dark-mode mockup (open in a browser).
- `.planning/research/SUMMARY.md` (+ STACK/ARCHITECTURE/PITFALLS) — styling-system decision (extend tokens), chart/recharts CSS-var limitation, FOUC, contrast guidance.

### Code to modify / mirror
- `packages/web/src/styles/global.css` (~4,440 lines) — the token `:root` (dark) + `:root[data-theme="light"]` blocks + all the literals to migrate/normalize.
- `packages/web/src/components/Topbar.css`, `ProfilePage.css`, `RolesPage.css` — the 3 component CSS files to migrate.
- `packages/web/src/store/theme.ts` + `packages/web/index.html` (inline FOUC guard) — existing dark/light mechanism (`data-theme`, `kinetica-bi-theme`); reuse as-is.
- `packages/web/src/lib/chartColors.ts` (`useChartAxisColors` — hardcoded per-theme hex at `:19-20`) + `packages/web/src/lib/chartTheme.ts` (`DEFAULT_CHART_PALETTE` at `:30`) — refactor to theme/token-aware.
- `packages/web/src/styles/theme-guard.spec.ts` — extend (COMPONENTS_DIR scan + ALLOWLIST pattern at `:25/:32`, the `.tsx`/`.css` collector at `:60`, `HEX_RE` at `:71`) to also cover `global.css` and structural-token literals + the inline pragma.

### Requirements
- `.planning/REQUIREMENTS.md` — TOKENS-V116-01/02/03/04, THEME-V116-01/02/03.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Dark/light system already works: `data-theme` attr on `<html>`, `kinetica-bi-theme` localStorage, `index.html` inline FOUC guard, `store/theme.ts` `applyTheme`. Only token values/coverage change.
- The color theme-guard (`theme-guard.spec.ts`) is the exact pattern to extend for structural tokens (file collector + ALLOWLIST + per-file assertion).
- `chartColors.ts` already splits dark/light — extend that shape for brand-aware + per-mode series.

### Established Patterns
- CSS custom-property tokens in `:root` / `:root[data-theme="light"]`; components consume `var(--…)` via shared classes (`.btn-primary`, `.ds-field`, `.config-toggle`, `.modal-*`, `.config-group`).
- Theme-guard ALLOWLIST entries carry a one-line justification comment.

### Integration Points
- `global.css` `:root` (both modes) — the single biggest surface.
- `chartColors.ts` / `chartTheme.ts` — chart color derivation.
- `theme-guard.spec.ts` — CI enforcement.
- No server, no new deps this phase (fonts — Manrope already loaded; Space Grotesk to be added as a web font).

</code_context>

<deferred>
## Deferred Ideas
- Making the chart series palette a separate brandable control in the admin UI — deferred (per-chart overrides already cover it; revisit only if customers ask).
- Brand server store / runtime apply / FOUC-for-brand / identity wiring — Phases 81–82.
- Branding admin UI + custom CSS — Phases 83 (+ CSS sanitize/scope). Phase 80 ships the static default theme only.
</deferred>

---

*Phase: 80-token-foundation-aurora-default-theme*
*Context gathered: 2026-06-23*
