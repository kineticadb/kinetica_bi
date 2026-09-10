---
phase: 80-token-foundation-aurora-default-theme
plan: 01
subsystem: ui
tags: [css-tokens, design-system, theming, aurora, violet, dark-mode, light-mode]

# Dependency graph
requires: []
provides:
  - Full Aurora token vocabulary in global.css :root (dark) + :root[data-theme="light"] (light)
  - Two-tier accent rule live in both modes (--accent fills / --accent-text readable text)
  - Structural token scales: type ramp, 4px spacing, 4-step radius, elevation, motion
  - global.css + Topbar.css + ProfilePage.css + RolesPage.css fully migrated off literals
affects: [80-02, 80-03, 81, 82, 83]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CSS custom-property token system: :root defines dark values; :root[data-theme=light] overrides color tokens only; spacing/type/motion scales are mode-independent"
    - "Two-tier accent: --accent for fills, --accent-text for readable accent-colored text (lighter on dark #c4b5fd, darker on light #6d28d9)"
    - "theme-guard-ignore pragma: inline /* theme-guard-ignore: <reason> */ comment opts a line out of the structural literal guard"
    - "Structural layout constants (icon sizes, pane widths, pill radii) carry pragmas rather than being force-mapped to tokens"

key-files:
  created: []
  modified:
    - packages/web/src/styles/global.css
    - packages/web/src/components/Topbar.css
    - packages/web/src/components/ProfilePage.css
    - packages/web/src/components/RolesPage.css

key-decisions:
  - "Aurora dark palette: #7f40ed violet on #0a0a12 near-black; --accent-text #c4b5fd (two-tier rule)"
  - "Light mode: warm off-white #eceaf3 page / #f6f5fb panel; --accent-text #6d28d9 (darker, WCAG-readable)"
  - "Font tokens use 'Manrope' (not 'Manrope Variable') until 80-02 adds fontsource; --font-body / --font-display tokens defined now"
  - "Chart tokens --color-chart-grid / --color-chart-axis defined in :root for getComputedStyle reads in useChartAxisColors hook"
  - "Spacing normalizes to 4px rhythm; radius to 4-step scale; type to compact ramp — minor intentional pixel shifts acceptable"
  - "1px/2px hairline borders + % + fr + unitless values are allowed primitives; structural layout constants (pane widths, icon sizes) carry theme-guard-ignore pragmas"

patterns-established:
  - "Token naming: --text-2xs..2xl (type), --space-1..10 (spacing), --radius-sm/md/lg/default (radius), --duration-fast/base/slow (motion)"
  - "Mode-specific token overrides: light :root only redefines color tokens, never structural scales"
  - "pragma pattern: /* theme-guard-ignore: <reason> */ required for any structural literal survivor"

requirements-completed: [TOKENS-V116-01, TOKENS-V116-02, TOKENS-V116-04, THEME-V116-01, THEME-V116-02]

# Metrics
duration: 8min
completed: 2026-06-23
---

# Phase 80 Plan 01: Token Foundation + Aurora Theme Migration Summary

**Aurora dark/light token vocabulary live in global.css :root blocks; all 178 font-size, 96 border-radius, and ~173 spacing literals migrated to var(--token) across global.css + Topbar/Profile/Roles CSS with zero raw survivors (pragma-justified structural constants only)**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-23T16:42:22Z
- **Completed:** 2026-06-23T16:50:22Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced green-anchored `:root` with full Aurora token vocabulary: violet `#7f40ed` on near-black `#0a0a12`, glassmorphic panel, two-tier accent, typography ramp, 4px spacing rhythm, 4-step radius scale, elevation shadows, motion tokens
- Light mode palette: warm off-white `#eceaf3`/`#f6f5fb` + darker `--accent-text: #6d28d9` (WCAG-compliant)
- Migrated 178 `font-size: Npx` → `var(--text-*)`, 96 `border-radius: Npx` → `var(--radius-*)`, ~173 spacing literals → `var(--space-*)`, all font-weights and transition durations tokenized
- All 3 component CSS files (Topbar.css, ProfilePage.css, RolesPage.css) fully token-driven
- Aurora body gradient retuned to violet/blue/magenta washes; `font-family: var(--font-body)` wired

## Task Commits

Each task was committed atomically:

1. **Task 1: Define full token vocabulary in :root (dark) + :root[data-theme="light"]** - `30db1ee` (feat)
2. **Task 2: Migrate all structural literals across global.css + 3 component CSS files** - `cd2db96` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified
- `packages/web/src/styles/global.css` — Full Aurora token vocabulary in both :root blocks; 178 font-size + 96 border-radius + ~173 spacing literals migrated to tokens
- `packages/web/src/components/Topbar.css` — Token-driven; structural icon/layout constants carry theme-guard-ignore pragmas
- `packages/web/src/components/ProfilePage.css` — Token-driven; layout max-width + pill radius carry pragmas
- `packages/web/src/components/RolesPage.css` — Token-driven; 1px hairlines (allowed primitives) + native checkbox size carry pragmas

## Decisions Made
- Font tokens set to `"Manrope"` (not `"Manrope Variable"`) until 80-02 self-hosts via fontsource; avoids silent fallback to system font mid-phase
- `--color-chart-grid` / `--color-chart-axis` defined in `:root` for `getComputedStyle` reads in `useChartAxisColors()` hook in 80-02
- Spinner animation duration (`0.8s`) pragm'd — it's a visual period, not a UI transition token
- `body font-size` stays at 13px via `var(--text-base)` + pragma comment (intentional baseline vs --text-base=12px; noted as documented one-off)
- 1px/2px hairline borders are allowed structural primitives per guard rules — no pragma needed for `border: 1px solid var(--border)` pattern

## Deviations from Plan

None - plan executed exactly as specified. The `body font-size` baseline note (13px vs --text-base 12px) was anticipated in the plan notes and documented with a pragma.

## Issues Encountered
None — tsc clean, vitest 111/111 files + 2594/2594 tests pass, theme-guard 52/52 green.

## User Setup Required
None - no external service configuration required. Dark/light mechanism (store/theme.ts, FOUC guard, data-theme, localStorage key) left untouched as specified.

## Next Phase Readiness
- Full token foundation in place — changing any `:root` token re-skins the app coherently in both modes
- 80-02 can safely wire `@fontsource-variable/manrope` + `@fontsource-variable/space-grotesk`, update `--font-body`/`--font-display` values, and add `useChartAxisColors` + `AURORA_CHART_PALETTE`
- 80-03 can extend theme-guard to cover structural literals using the exact pattern documented in RESEARCH.md Pattern 4

## Self-Check: PASSED

- `packages/web/src/styles/global.css` EXISTS
- `packages/web/src/components/Topbar.css` EXISTS
- `packages/web/src/components/ProfilePage.css` EXISTS
- `packages/web/src/components/RolesPage.css` EXISTS
- Commit `30db1ee` EXISTS (Task 1)
- Commit `cd2db96` EXISTS (Task 2)
- `grep -q -- "--accent: #7f40ed"` PASSES
- `grep -q -- "--accent-text: #c4b5fd"` PASSES
- `grep -coE "font-size: *[0-9]+px" global.css` = 0 PASSES
- `npx tsc --noEmit` CLEAN
- `npx vitest run` 111/111 files + 2594/2594 tests PASS

---
*Phase: 80-token-foundation-aurora-default-theme*
*Completed: 2026-06-23*
