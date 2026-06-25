---
phase: 83-branding-admin-ui
plan: 01
subsystem: ui
tags: [react, zustand, css-custom-properties, branding, react-colorful, colord, codemirror]

# Dependency graph
requires:
  - phase: 82-client-token-pipeline
    provides: brandStore (update/bootstrap/applyBrandTokens), BroadcastChannel cross-tab sync, BrandConfigPayload type
  - phase: 81-brand-config-server
    provides: PUT /api/branding, POST /api/branding/logo, GET /api/branding routes + sanitizeCssPostcss
provides:
  - Extended BrandConfigPayload (9 new fields: displayFontFamily/Url, accentTextColor/lightAccentTextColor, densityPreset, radiusPreset, glowEnabled, typeScaleBase, motionSpeed)
  - BrandingResponse.logoDarkUrl (BRANDUI-06 type prep)
  - updateBrandConfig() + uploadBrandLogo() API client functions
  - export applyBrandTokens + 4 feel-lever helpers (applyDensityPreset/RadiusPreset/MotionPreset/TypeScalePreset)
  - revertToSaved() action on BrandState
  - --glow-opacity CSS token interpolated into dark + light body aurora radial-gradient alphas
  - BrandingSettingsPage scaffold (5 section placeholders, dirty-tracking, Save/Reset header, live preview)
  - brandPageGuard module (isDirty + revert refs for App.tsx leave-guard intercept)
  - Branding nav entry in Sidebar gated on PERMISSIONS.BRANDING_MANAGE (hide-don't-disable)
  - App.tsx state-based leave-guard (onSelect intercept, window.confirm, brandPageGuard.revert)
affects: [83-02-colors-fonts, 83-03-feel-css, 83-04-dark-logo]

# Tech tracking
tech-stack:
  added:
    - react-colorful@5.7.0 (hex color pickers — pre-installed for 83-02)
    - colord@2.9.3 (WCAG contrast math — pre-installed for 83-02)
    - "@codemirror/lang-css@6.3.1" (CSS editor extension — surfaced from lock for 83-03)
  patterns:
    - brandPageGuard module pattern (mutable refs read by App.tsx before setPage — avoids prop-drilling)
    - Leave-guard intercept at onSelect level (not useEffect cleanup) to avoid leave-revert race
    - applyBrandTokens exported for live draft preview without store write (draft preview != save)
    - Feel-lever helper fns (pure, no imports) called from applyBrandTokens
    - --glow-opacity CSS token in :root interpolated into rgba() alpha via calc()

key-files:
  created:
    - packages/web/src/components/settings/BrandingSettingsPage.tsx
    - packages/web/src/components/settings/BrandingSettingsPage.css
    - packages/web/src/components/settings/brandPageGuard.ts
  modified:
    - packages/web/src/api/client.ts (BrandConfigPayload extended, BrandingResponse.logoDarkUrl, updateBrandConfig, uploadBrandLogo)
    - packages/web/src/store/brandStore.ts (export applyBrandTokens, 4 helper fns, revertToSaved action)
    - packages/web/src/styles/global.css (--glow-opacity token, radial-gradient alpha interpolation)
    - packages/web/src/components/Sidebar.tsx (Branding nav entry with PERMISSIONS.BRANDING_MANAGE)
    - packages/web/src/App.tsx (Page union, page allowlist, guarded onSelect, BrandingSettingsPage render branch)
    - package.json + package-lock.json (3 new deps)

key-decisions:
  - "brandPageGuard module pattern (not React context/prop) for leave-guard: simpler than threading a ref/callback through Sidebar; App.tsx reads isDirty + revert before setPage"
  - "applyBrandTokens exported (not a store action) so BrandingSettingsPage calls it for draft preview without touching localStorage or BroadcastChannel"
  - "revertToSaved() added to BrandState: re-applies saved config to :root — avoids a network round-trip on leave (no re-fetch)"
  - "--glow-opacity approach for glow toggle: single token interpolated via calc() into existing rgba() stops — lower risk than injecting/removing a style element"
  - "No theme-guard ALLOWLIST entry in 83-01: BrandingSettingsPage scaffold contains zero hex literals; 83-02 adds the allowlist entry when react-colorful hex defaults are introduced"

patterns-established:
  - "Leave-guard at onSelect level: intercept before setPage to avoid leave-revert race (Pitfall 2 from RESEARCH)"
  - "Draft preview = applyBrandTokens(next, theme); save = useBrandStore.update() — never call update() on a draft change"
  - "Feel-lever helpers: pure functions (no imports), module-level, called from applyBrandTokens; all presets use removeProperty for 'default' so compiled CSS wins"
  - "brandPageGuard.revert set in useEffect (tracks via closure), cleared on cleanup — prevents stale revert refs after unmount"

requirements-completed: [BRANDUI-05]

# Metrics
duration: 7min
completed: 2026-06-25
---

# Phase 83 Plan 01: Branding Admin UI Foundation Summary

**Extended BrandConfigPayload with 9 new fields (display-font, accent-text, 5 feel-levers), exported applyBrandTokens with full token mapping + feel-lever helpers, added --glow-opacity to global.css, scaffolded permission-gated BrandingSettingsPage with state-based leave-guard via brandPageGuard module pattern**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-25T09:41:12Z
- **Completed:** 2026-06-25T09:48:XX Z
- **Tasks:** 4
- **Files modified:** 10

## Accomplishments

- BrandConfigPayload fully extended for all Phase 83 controls (display-font, accent-text dark+light, density/radius/glow/typeScale/motion feel-levers) + BrandingResponse.logoDarkUrl (BRANDUI-06 type prep)
- applyBrandTokens exported with complete feel-lever mapping via 4 pure helper functions; revertToSaved() added to BrandState for clean leave-revert without network roundtrip
- --glow-opacity CSS token added to :root and interpolated into dark + light body aurora radial-gradient alphas via calc()
- BrandingSettingsPage scaffolded with 5 section placeholders, dirty-tracking, live preview via exported applyBrandTokens, Save/Reset header; App.tsx leave-guard intercepts onSelect before setPage (no race); Branding nav entry hidden for users without branding:manage

## Task Commits

1. **Task 1: Install deps + extend BrandConfigPayload + add client mutation fns** - `37b92d6` (feat)
2. **Task 2: Extend brandStore + export applyBrandTokens + revertToSaved + --glow-opacity** - `fc454d2` (feat)
3. **Task 3: Scaffold BrandingSettingsPage + nav entry + App.tsx leave-guard** - `b75cabc` (feat)
4. **Task 4: ROADMAP already correct; web tsc + vitest gates passed** — no separate commit needed (ROADMAP pre-populated)

## Files Created/Modified

- `packages/web/src/api/client.ts` — BrandConfigPayload +9 fields, BrandingResponse.logoDarkUrl, updateBrandConfig/uploadBrandLogo exported
- `packages/web/src/store/brandStore.ts` — export applyBrandTokens, 4 feel-lever helpers, revertToSaved action, extend create() to (set, get)
- `packages/web/src/styles/global.css` — --glow-opacity :root token, dark + light body radial-gradient alpha via calc(N * var(--glow-opacity, 1))
- `packages/web/src/components/settings/BrandingSettingsPage.tsx` — page scaffold, 5 sections, dirty-tracking, Save/Reset, live preview, leave-guard useEffect
- `packages/web/src/components/settings/BrandingSettingsPage.css` — layout using var(--token) only
- `packages/web/src/components/settings/brandPageGuard.ts` — module-level isDirty + revert refs for App.tsx
- `packages/web/src/components/Sidebar.tsx` — faPalette import, Branding nav entry with PERMISSIONS.BRANDING_MANAGE
- `packages/web/src/App.tsx` — Page union + allowlist, guarded onSelect, BrandingSettingsPage import + render branch
- `packages/web/package.json` + `package-lock.json` — react-colorful, colord, @codemirror/lang-css

## Decisions Made

- **brandPageGuard module pattern** over React context/prop: simpler, no prop-drilling through Sidebar; App.tsx reads it directly
- **applyBrandTokens exported** (not wrapped in a previewDraft action): avoids creating a store action that doesn't write state; callers import the fn directly for draft preview
- **No theme-guard ALLOWLIST entry**: scaffold has no hex literals; per plan note, 83-02 adds the allowlist entry when react-colorful hex defaults are introduced
- **Leave-guard at onSelect level** (not useEffect cleanup): synchronous intercept eliminates the leave-revert race documented in RESEARCH Pitfall 2

## Deviations from Plan

None — plan executed exactly as written. The ROADMAP was already pre-populated with the correct Phase 83 plan listing (no update needed for Task 4).

## Issues Encountered

None.

## Next Phase Readiness

- 83-02 (Colors + Fonts): BrandConfigPayload has all 18 color fields + accentTextColor/lightAccentTextColor ready; react-colorful + colord installed; BrandingSettingsPage scaffold has #brand-colors + #brand-fonts section placeholders; handleDraftChange pattern established
- 83-03 (Feel + CSS): feel-lever helpers and token mappings complete; #brand-feel + #brand-css placeholders ready; @codemirror/lang-css installed
- 83-04 (Dark Logo server): BrandingResponse.logoDarkUrl + uploadBrandLogo(file, "dark") already typed and exported

## Self-Check: PASSED

All created files confirmed present on disk. All 3 task commits verified in git history. TSC clean. vitest 114/114 files passed (2706 tests).

---
*Phase: 83-branding-admin-ui*
*Completed: 2026-06-25*
