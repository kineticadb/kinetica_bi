---
phase: 80-token-foundation-aurora-default-theme
plan: 03
subsystem: ui
tags: [css-tokens, design-system, theming, aurora, chart-colors, theme-guard, getComputedStyle]

# Dependency graph
requires: [80-01]
provides:
  - useChartAxisColors() reads --color-chart-grid/axis/--accent-2 via getComputedStyle
  - AURORA_CHART_PALETTE (violet-led, colorblind-aware) + DEFAULT_CHART_PALETTE re-export
  - Extended theme-guard: scans global.css + structural literal (px/ms) guard + pragma
affects: [82, 83]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getComputedStyle(document.documentElement).getPropertyValue(--token) in render hooks for theme + brand-reactive SVG colors"
    - "AURORA_CHART_PALETTE TS const (violet lead, colorblind-aware): series hues same dark/light, only axis/grid/accent flip"
    - "Property-aware structural guard regex: targets font-size/border-radius/padding/margin/gap, allows 0/1px/2px, skips :root defs and comment lines"
    - "theme-guard-ignore pragma: reason-required inline exemption (bare pragma without reason does NOT match)"
    - "Global CSS var stub in test/setup.ts: jsdom needs non-empty values for --color-chart-* in render tests"

key-files:
  created:
    - packages/web/src/lib/chartColors.spec.ts
  modified:
    - packages/web/src/lib/chartColors.ts
    - packages/web/src/lib/chartTheme.ts
    - packages/web/src/styles/global.css
    - packages/web/src/styles/theme-guard.spec.ts
    - packages/web/src/test/setup.ts

key-decisions:
  - "getComputedStyle over TS mirror for axis/grid/accent: CSS is single source of truth + Phase 82 brand overrides automatically picked up"
  - "AURORA_CHART_PALETTE as TS const (not CSS vars): series hues don't flip per theme, must resolve synchronously at render time"
  - "Property-aware structural guard regex (not naive all-px): only flags CSS properties that should be tokens (font-size/radius/padding/margin/gap/duration); allows width/height/max-width/letter-spacing/transform etc."
  - "Comment-line skipping in structural guard: prevents JSDoc references to px values (e.g. 'margin-left: 8px in CSS') from being false-positives"
  - "Global CSS var stub in setup.ts: CalendarRenderer Test 18 checks stroke != '' on active cell; old hardcoded hook returned hex; new getComputedStyle returns '' in jsdom without stub"
  - "global.css added to hex guard ALLOWLIST: token definitions legitimately contain hex values; structural guard separately enforces no raw px in CSS rules"

patterns-established:
  - "Single source of truth: CSS :root tokens + getComputedStyle in hook = brand overrides flow through for free in Phase 82"
  - "Test infrastructure for CSS vars in jsdom: vi.stubGlobal getComputedStyle in setup.ts with Aurora dark-mode defaults"

requirements-completed: [THEME-V116-03, TOKENS-V116-03]

# Metrics
duration: 17min
completed: 2026-06-23
---

# Phase 80 Plan 03: Chart Theme-Aware Colors + Extended Structural Guard Summary

**useChartAxisColors() now derives axis/grid/accent from CSS :root tokens via getComputedStyle — colors flip with theme and will follow brand overrides in Phase 82 with zero code change; AURORA_CHART_PALETTE (violet #7f40ed lead) replaces the green-anchored DEFAULT palette; theme-guard extended to scan global.css + forbid structural px/ms literals with a reason-required pragma escape hatch**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-06-23T16:53:49Z
- **Completed:** 2026-06-23T17:11:01Z
- **Tasks:** 2
- **Files modified:** 5 (+ 1 created)

## Accomplishments

- Refactored `useChartAxisColors()` to read `--color-chart-grid`, `--color-chart-axis`, `--accent-2` from `:root` via `getComputedStyle(document.documentElement).getPropertyValue(v)` — axis/grid/accent automatically track theme AND future brand overrides (Phase 82) with no code change
- Removed hardcoded per-theme hex branches (`#e2e8f0`/`#1f2937`/`#64748b`/`#94a3b8`); `ChartAxisColors` return shape unchanged so all consumers compile identically
- Defined `AURORA_CHART_PALETTE` (violet `#7f40ed` → sky `#38bdf8` → teal → amber → pink → lime): colorblind-aware distinct hues; `DEFAULT_CHART_PALETTE` re-exports the Aurora values for backward compatibility
- Reindexed all single-series fallbacks (`DEFAULT_BAR_COLOR`, `DEFAULT_LINE_COLOR`, etc.) to `AURORA_CHART_PALETTE[0/1/2]`; none is the old green `#22c55e`
- Kept `RECHARTS_TOOLTIP_PROPS` using CSS vars (`var(--panel)`, `var(--border)`, `var(--text)`) — tooltip renders as HTML div where `var()` resolves; do NOT flatten to hex
- Extended `theme-guard.spec.ts` with a second describe block for structural literals: scans components + global.css, property-aware regex (font-size/border-radius/padding/margin/gap, ms durations), allows 0/1px/2px, skips `:root` custom-property definitions + pure comment lines
- Added `global.css` to both the hex guard (ALLOWLIST) and structural guard file sets
- Added 3 pragma comments to global.css for legitimate compact-chip vertical padding values (3px/5px between --space-1 and --space-2 steps)
- Added global CSS var stub to `test/setup.ts` so jsdom renders non-empty stroke attrs (CalendarRenderer Test 18 checks active-cell `stroke != ''`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Aurora chart palette + getComputedStyle token reads** - `3ede7c9` (feat)
2. **Task 2: Extend theme-guard — scan global.css + structural literals + pragma** - `f79b01c` (feat)

## Files Created/Modified

- `packages/web/src/lib/chartColors.ts` — Hook refactored to getComputedStyle; no hardcoded hex; same ChartAxisColors shape
- `packages/web/src/lib/chartTheme.ts` — AURORA_CHART_PALETTE defined; DEFAULT_CHART_PALETTE re-exports it; fallbacks indexed into palette
- `packages/web/src/lib/chartColors.spec.ts` — NEW: TDD spec (24 tests) covering getComputedStyle derivation, palette entries, backward compat, and CSS var preservation in tooltip
- `packages/web/src/styles/theme-guard.spec.ts` — Extended: global.css in hex guard ALLOWLIST + GLOBAL_CSS_PATH const + structural guard describe block (106 tests total, up from 52)
- `packages/web/src/styles/global.css` — 3 pragma comments added for compact-chip vertical padding (3px/5px); no tokens changed
- `packages/web/src/test/setup.ts` — Global getComputedStyle stub providing Aurora dark-mode CSS var defaults for jsdom test environment

## Decisions Made

- Used `getComputedStyle` (Option A from RESEARCH) for axis/grid/accent because they vary per theme AND will vary per brand in Phase 82
- Used TS const `AURORA_CHART_PALETTE` (Option B from RESEARCH) for series colors because they don't flip per theme and need synchronous resolution
- Property-aware structural regex (not naive `\b\d+px\b`) to avoid false positives on width/height/max-width/letter-spacing/box-shadow values — those are dimensional layout constants, not structural tokens
- Skipping pure comment lines in structural guard (lines starting with `//`, `*`, `/*`) to avoid false positives in JSDoc comments that describe CSS values (e.g. `margin-left: 8px in CSS`)
- Global CSS var stub in setup.ts (not per-test override) because CalendarRenderer Test 18 pre-dates the getComputedStyle refactor and needs non-empty values for stroke assertions

## Probe Result: Guard Fails on Structural Literal

**Temporary probe inserted:** `padding: 17px; /* PROBE: intentional literal to test the guard fails */` into `Topbar.css` line 7.

**Guard FAILED with:**
```
FAIL  theme guard: no structural px/ms literals in components + global.css > Topbar.css: no raw structural px/ms literals (or pragma-justified)
AssertionError: Structural literal(s) found in Topbar.css:
  Line 7: [structural px literal] padding: 17px; /* PROBE: intentional literal to test the guard fails */
  -> Use a token (var(--space-*/--radius-*/--text-*/--duration-*)) or add /* theme-guard-ignore: <reason> */ to justify this one-off.
```

**Probe removed.** Guard returns GREEN (106/106 tests pass).

**Guard allows correctly (no false positives):**
- `border: 1px solid var(--border)` — 1px is in allow-list
- `border-radius: 50%` — % not matched
- `grid-template-columns: 1fr 1fr` — fr not matched
- `width: 28px; height: 28px` — width/height not in target properties
- `@media (max-width: 900px)` — max-width not a target property
- `letter-spacing: 0.4px` — letter-spacing not in target properties
- `box-shadow: 0 0 0 6px rgba(...)` — box-shadow not a target property
- `transform: translateY(8px)` — transform not a target property

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CalendarRenderer Test 18 broke after getComputedStyle refactor**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test 18 checks active cell has `stroke !== ""`. Old hook returned hardcoded `#0284c7` (non-empty). New hook reads `getComputedStyle` which returns `""` in jsdom. `stroke=""` fails the `!= ""` check.
- **Fix:** Added global `getComputedStyle` stub to `test/setup.ts` providing Aurora dark-mode CSS var defaults (non-empty hex values) for jsdom. Individual specs can override with `vi.spyOn`.
- **Files modified:** `packages/web/src/test/setup.ts`
- **Commit:** `3ede7c9` (included in Task 1)

**2. [Rule 1 - Bug] Non-ASCII em-dash in spec comment caused parse error**
- **Found during:** Task 2 spec writing
- **Issue:** `// ─────────` lines with U+2500 BOX DRAWINGS characters caused oxc parser to reject the file.
- **Fix:** Replaced with `// =====` ASCII separator lines.
- **Files modified:** `packages/web/src/styles/theme-guard.spec.ts`

**3. [Rule 1 - Bug] `/* theme-guard-ignore */` in JSDoc closed outer `/** */` comment**
- **Found during:** Task 2 spec writing
- **Issue:** Embedding `*/` inside a `/** */` JSDoc block ended the outer comment, producing parse errors for the bare text on following lines.
- **Fix:** Changed JSDoc blocks to `//` line comments.
- **Files modified:** `packages/web/src/styles/theme-guard.spec.ts`

**4. [Rule 2 - Missing correctness] Property-aware structural guard vs naive all-px regex**
- **Found during:** Task 2 analysis — naive `\b\d+px\b` flagged 190 lines in global.css
- **Issue:** Plan's RESEARCH regex was a starting point; applying it naively to global.css flags `width: 28px`, `height: 38px`, `max-width: 600px`, `@media (max-width: 900px)`, etc. — all legitimate dimensional layout constants. Adding 190+ pragmas is not practical.
- **Fix:** Designed a property-aware regex targeting only CSS properties that SHOULD use tokens (font-size, border-radius, padding[-*], margin[-*], gap, column-gap, row-gap, transition/animation for ms). Width/height/max-*/positioning/letter-spacing/box-shadow are allowed without pragma. This matches the CONTEXT.md "curated forbid-list" intent.
- **Result:** Only 3 global.css lines flagged (3px/5px chip padding fine-tuning) — all given pragmas with real reasons. 0 false positives in components.

## Issues Encountered

None beyond the auto-fixed deviations above. tsc clean, 112/112 test files pass, 2672/2672 tests pass.

## Next Phase Readiness

- Phase 82 can read brand-applied token overrides from `document.documentElement.style.setProperty('--color-chart-grid', brandValue)` and `useChartAxisColors()` automatically picks them up with no code change
- Extended theme-guard catches structural literal regressions in CI — any new component using `padding: 12px` instead of `var(--space-4)` will fail the build
- `AURORA_CHART_PALETTE` is the brand anchor for chart series — Phase 82 can expose series-1 (`[0]`) as a brandable token if desired

## Self-Check: PASSED

- `packages/web/src/lib/chartColors.ts` EXISTS
- `packages/web/src/lib/chartTheme.ts` EXISTS
- `packages/web/src/lib/chartColors.spec.ts` EXISTS
- `packages/web/src/styles/theme-guard.spec.ts` EXISTS
- `packages/web/src/styles/global.css` EXISTS
- `packages/web/src/test/setup.ts` EXISTS
- Commit `3ede7c9` EXISTS (Task 1)
- Commit `f79b01c` EXISTS (Task 2)
- `grep "getComputedStyle(document.documentElement)" chartColors.ts` PASSES
- `grep "AURORA_CHART_PALETTE" chartTheme.ts` PASSES
- `grep '"#7f40ed"' chartTheme.ts` PASSES
- `grep "global.css" theme-guard.spec.ts` PASSES
- `grep "theme-guard-ignore" theme-guard.spec.ts` PASSES
- `npx tsc --noEmit` CLEAN
- `npx vitest run` 112/112 files + 2672/2672 tests PASS

---
*Phase: 80-token-foundation-aurora-default-theme*
*Completed: 2026-06-23*
