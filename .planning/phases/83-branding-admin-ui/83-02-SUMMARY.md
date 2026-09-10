---
phase: 83-branding-admin-ui
plan: 02
subsystem: ui
tags: [react, wcag, colord, react-colorful, color-pickers, fonts, branding, theme-guard]

# Dependency graph
requires:
  - phase: 83-01
    provides: BrandConfigPayload (9 color pairs + accentTextColor/lightAccentTextColor + displayFontFamily), exported applyBrandTokens, handleDraftChange pattern, BrandingSettingsPage scaffold with #brand-colors + #brand-fonts placeholders
provides:
  - wcag.ts: contrastRatio(bg, fg) + passesAA(ratio, threshold) using colord a11y plugin
  - WcagBadge.tsx: warn-only pass/fail contrast badge (wcag-pass/wcag-fail CSS token classes)
  - BrandColorPicker.tsx: HexColorPicker wrapper with label + hex readout (no hex literals; fallback is a prop)
  - BrandingSettingsPage.tsx Colors section: 18 pickers (9 dark + 9 light) in side-by-side columns
  - BrandingSettingsPage.tsx Fonts section: body + display curated selects bound to fontFamily/displayFontFamily
  - WCAG critical-pair badges in BOTH dark AND light columns (text/bg, accent-text/accent, on-accent/accent)
  - DARK_DEFAULTS + LIGHT_DEFAULTS Aurora hex map (theme-guard ALLOWLISTED in BrandingSettingsPage.tsx)
  - CURATED_BODY_FONTS + CURATED_DISPLAY_FONTS: @fontsource-variable self-hosted only, no CDN URLs
affects: [83-03-feel-css, 83-04-dark-logo]

# Tech tracking
tech-stack:
  added: []  # react-colorful + colord installed in 83-01; no new deps
  patterns:
    - COLOR_FIELDS array pattern: 9 {token, label, darkField, lightField} rows drive both columns declaratively
    - Aurora hex defaults map (DARK_DEFAULTS/LIGHT_DEFAULTS) in parent file (on ALLOWLIST); BrandColorPicker itself has no hex literals
    - WcagBadge warn-only: ratio rendered as badge, no Save blocking, no input disabling
    - Critical pairs checked: text/bg + accent-text/accent + #ffffff/accent (on-accent) in both dark + light
    - CURATED_FONTS pattern: {label, css} array; css is full font-family stack string

key-files:
  created:
    - packages/web/src/components/settings/wcag.ts
    - packages/web/src/components/settings/WcagBadge.tsx
    - packages/web/src/components/settings/BrandColorPicker.tsx
    - packages/web/src/components/settings/__tests__/wcag.spec.ts
    - packages/web/src/components/settings/__tests__/BrandColorSection.spec.tsx
  modified:
    - packages/web/src/components/settings/BrandingSettingsPage.tsx (Colors + Fonts sections filled)
    - packages/web/src/components/settings/BrandingSettingsPage.css (wcag-pass/fail + color-picker + columns + fonts layout)
    - packages/web/src/styles/theme-guard.spec.ts (ALLOWLIST entry for BrandingSettingsPage.tsx)

key-decisions:
  - "Aurora hex defaults live in BrandingSettingsPage.tsx (parent), not BrandColorPicker.tsx: component stays generic (no hex literals), parent is the right source-of-truth for defaults; single ALLOWLIST entry"
  - "CURATED_FONTS includes only already-installed @fontsource-variable packages (manrope + space-grotesk) plus generic system-ui and Georgia fallbacks — no CDN URLs per BRANDUI-03"
  - "Fonts section implemented in same Task 2 commit as Colors: both fill BrandingSettingsPage.tsx, logically coupled, no point splitting"
  - "#ffffff on-accent literal in BrandingSettingsPage.tsx (not a separate file): keeps it in the ALLOWLISTED parent, correct per plan note"

# Metrics
duration: 6min
completed: 2026-06-25
---

# Phase 83 Plan 02: Colors + Fonts Branding UI Summary

**18 react-colorful pickers in dark|light columns with warn-only WCAG critical-pair badges in both columns, curated self-hosted font selects for body + display, all wired to live draft preview via applyBrandTokens; theme-guard ALLOWLISTED with justification**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-25T13:53:17Z
- **Completed:** 2026-06-25T14:00:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- wcag.ts: colord a11y plugin wired once at module level; contrastRatio + passesAA exported with threshold param
- WcagBadge: warn-only badge using wcag-pass (var(--success)) / wcag-fail (var(--danger)) CSS token classes; no Save blocking
- BrandColorPicker: HexColorPicker wrapper with label + hex readout; no hex literals (fallback passed as prop from parent)
- Colors section: 18 pickers (9 dark + 9 light) in two-column grid; DARK_DEFAULTS / LIGHT_DEFAULTS Aurora hex map in BrandingSettingsPage.tsx (ALLOWLISTED); critical-pair WCAG badges rendered in BOTH columns
- Fonts section: CURATED_BODY_FONTS + CURATED_DISPLAY_FONTS selects (4 options each); only @fontsource-variable self-hosted families + generic fallbacks; fontFamily + displayFontFamily bound via handleDraftChange for live apply
- theme-guard: BrandingSettingsPage.tsx added to ALLOWLIST with justification comment; guard green (118 tests)
- Active-theme nuance documented inline (brand-theme-note); Save never blocked by contrast badge

## Task Commits

1. **Task 1: wcag.ts + WcagBadge + BrandColorPicker + ALLOWLIST** - `b95636b` (feat)
2. **Task 2: 18-picker dark|light color section + WCAG badges** - `0f20383` (feat)
3. **Task 3: Fonts section** — implemented in Task 2 commit (same file, same edit)

## Files Created/Modified

- `packages/web/src/components/settings/wcag.ts` — colord a11y extend once; contrastRatio + passesAA
- `packages/web/src/components/settings/WcagBadge.tsx` — warn-only WCAG contrast badge
- `packages/web/src/components/settings/BrandColorPicker.tsx` — HexColorPicker wrapper (no hex literals)
- `packages/web/src/components/settings/__tests__/wcag.spec.ts` — 7 tests: contrastRatio black/white ~21, identical 1.0, passesAA boundary
- `packages/web/src/components/settings/__tests__/BrandColorSection.spec.tsx` — 5 tests: 18 pickers, dark+light headers, badges in both cols, theme note
- `packages/web/src/components/settings/BrandingSettingsPage.tsx` — Colors section (18 pickers, WCAG badges) + Fonts section (2 selects) + DARK/LIGHT_DEFAULTS hex map
- `packages/web/src/components/settings/BrandingSettingsPage.css` — wcag-pass/fail + brand-color-picker + color-columns + font-field layout (tokens only)
- `packages/web/src/styles/theme-guard.spec.ts` — ALLOWLIST entry for settings/BrandingSettingsPage.tsx with justification

## Decisions Made

- **Aurora hex defaults in parent (BrandingSettingsPage.tsx), not in BrandColorPicker.tsx**: BrandColorPicker is a generic reusable component with no hex literals; parent is the source-of-truth for defaults. Single ALLOWLIST entry covers all hex.
- **Fonts section in Task 2 commit**: BrandingSettingsPage.tsx was being edited for colors; filling both sections in one coherent commit avoids a partial state where the file is mid-edit.
- **CURATED_FONTS = self-hosted only**: Only @fontsource-variable/manrope + @fontsource-variable/space-grotesk are installed; curated list includes those plus system-ui + Georgia generic fallbacks. No CDN URLs.

## Deviations from Plan

None — plan executed exactly as written. Task 3 (Fonts section) was implemented within the Task 2 edit of BrandingSettingsPage.tsx since both tasks modify the same file and are logically coherent.

## Issues Encountered

- InfoPopup.spec.tsx emits 1 error during full parallel vitest run (401 from listColumnDisplayConfig in shared store state). This is TD-V16-TEST-ISOLATION (pre-existing); the test passes when run in isolation. All 116 test files + 2722 tests pass.

## Next Phase Readiness

- 83-03 (Feel + CSS): #brand-feel and #brand-css section placeholders ready; applyBrandTokens feel-lever helpers already wired in 83-01; @codemirror/lang-css installed
- 83-04 (Dark Logo server): BrandingResponse.logoDarkUrl + uploadBrandLogo("dark") typed and exported

## Self-Check: PASSED

All created files confirmed present on disk. All task commits verified in git history. TSC clean. vitest 2722/2722 tests pass (116 files); theme-guard 118/118.
