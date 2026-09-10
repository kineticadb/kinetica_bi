---
phase: 83-branding-admin-ui
plan: 04
subsystem: both
tags: [branding, dark-logo, brandui-06, server, sqlite, react, zustand, tdd]

# Dependency graph
requires:
  - phase: 83-01
    provides: BrandingResponse.logoDarkUrl type, uploadBrandLogo(file, variant) API client fn
  - phase: 83-03
    provides: BrandingSettingsPage draftLogoFile state, handleSave/Reset scaffold, LogoSection placeholder
  - phase: 81-brand-config-server
    provides: POST /api/branding/logo Phase-81 SVG/magic-byte validation path (reused)
provides:
  - brand_config.logo_dark_data/logo_dark_mime/logo_dark_updated_at columns (DDL + PRAGMA ALTER)
  - GET /api/branding returns logoDarkUrl
  - GET /api/branding/logo?variant=dark serves dark logo (404 if absent)
  - POST /api/branding/logo accepts variant=dark form field; writes dark columns; returns logoDarkUrl
  - BrandState.logoDarkUrl + update() optional logoDarkUrl param
  - Sidebar.tsx theme-aware effectiveLogoUrl selection (dark variant in dark mode)
  - index.html FOUC favicon dark-logo awareness
  - LogoUploader.tsx component (dual-slot, per-mode preview)
  - BrandingSettingsPage dual logo slots + app-name input + Reset clears both
  - Server supertests for dark-logo routes in both auth modes (29 tests)
  - LogoSection.spec.tsx (11 TDD tests)
affects: [84-verification]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — reuses Phase-81 validation + existing client types
  patterns:
    - PRAGMA-guarded ALTER for brand_config dark columns (mirrors sessions/dashboard_layers pattern)
    - variant=dark form field in multipart POST (multer reads text fields into req.body)
    - Optional logoDarkUrl param on brandStore.update() (defaults to current state — existing callers unaffected)
    - effectiveLogoUrl = (theme==='dark' && logoDarkUrl) ? logoDarkUrl : logoUrl in Sidebar
    - LogoUploader per-mode preview swatch via CSS class (no hex — token-only)
    - TDD: LogoSection.spec.tsx RED→GREEN cycle for dual-slot behavior assertions

key-files:
  created:
    - packages/web/src/components/settings/LogoUploader.tsx
    - packages/web/src/components/settings/__tests__/LogoSection.spec.tsx
  modified:
    - packages/server/src/db.ts (SCHEMA_DDL + PRAGMA-guarded ALTER)
    - packages/server/src/index.ts (BrandConfigRow type, GET branding, GET logo, POST logo)
    - packages/server/tests/routes.branding.spec.ts (dark-logo tests, beforeEach cleanup)
    - packages/web/src/store/brandStore.ts (BrandState.logoDarkUrl, bootstrap, update)
    - packages/web/src/components/Sidebar.tsx (effectiveLogoUrl theme selection)
    - packages/web/index.html (FOUC favicon dark-aware)
    - packages/web/src/components/settings/BrandingSettingsPage.tsx (draftDarkLogoFile, dual slots, app-name, handleSave/Reset)
    - packages/web/src/components/settings/BrandingSettingsPage.css (logo-uploader-*, brand-logo-slots)
    - packages/web/src/components/settings/__tests__/BrandingSave.spec.tsx (getState mock + update() assertion)

key-decisions:
  - "PRAGMA-guarded ALTER for brand_config dark columns: mirrors the sessions table pattern; fresh installs get columns from SCHEMA_DDL; Phase-81 deployments get them via ALTER at boot"
  - "Phase-81 SVG/magic-byte validation reused unchanged: only the target columns + response key differ between primary and dark variants — no validation weakening or duplication"
  - "Optional logoDarkUrl param on brandStore.update(): defaults to current store value so 83-03 handleSave callers are unaffected; no breaking change"
  - "LogoUploader per-mode swatch via CSS class (logo-uploader-preview--dark/light): tokens only, no hex, theme-guard safe"
  - "BrandingSave.spec.tsx auto-fixed (Rule 1): extended getState mock + update() assertion to include logoDarkUrl 3rd arg"

# Metrics
duration: 12min
completed: 2026-06-25
---

# Phase 83 Plan 04: BRANDUI-06 Dark Logo Override Summary

**Optional dark-mode logo override end-to-end: server gains logo_dark_* columns + variant-aware upload/serve + logoDarkUrl in GET (reusing Phase-81 SVG/magic-byte validation); client gains brandStore.logoDarkUrl, Sidebar theme-aware selection, FOUC favicon awareness, and dual-slot Logo section in settings page**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-25T14:14:18Z
- **Completed:** 2026-06-25T14:26:57Z
- **Tasks:** 4
- **Files modified:** 9 + 2 created

## Accomplishments

- Server: `brand_config` schema adds `logo_dark_data/logo_dark_mime/logo_dark_updated_at` to `SCHEMA_DDL` (fresh installs) + PRAGMA-guarded ALTER block for Phase-81 deployments; `BrandConfigRow` extended
- Server routes: `GET /api/branding` selects dark cols + returns `logoDarkUrl`; `GET /api/branding/logo?variant=dark` serves dark columns (404 if absent); `POST /api/branding/logo` branches on `variant=dark` form field to write dark columns + return `{ logoDarkUrl }` — Phase-81 SVG content-sniff + DOMPurify + magic-byte validation REUSED unchanged
- Server tests: 29 tests across both auth modes (password + oidc); dark upload 200 + logoDarkUrl, GET reflects logoDarkUrl, ?variant=dark serve 200, absent→404, no-permission→403, malicious SVG sanitized, primary columns unchanged after dark upload; server tsc clean; failing file set ⊆ TD-V16-TEST-ISOLATION (no new red files)
- Client: `BrandState.logoDarkUrl` added; `bootstrap()` reads `data.logoDarkUrl` + persists to localStorage; `update()` optional 3rd param defaults to current value (no breaking change to 83-03 handleSave)
- `Sidebar.tsx`: imports `useThemeStore`; computes `effectiveLogoUrl = (theme==='dark' && logoDarkUrl) ? logoDarkUrl : logoUrl`; renders `effectiveLogoUrl ? <img> : <DefaultLogo>`
- `index.html` FOUC IIFE: dark-aware favicon selection — `effectiveLogoUrl = (isDark && brand.logoDarkUrl) ? brand.logoDarkUrl : brand.logoUrl`; defensive fallback for old caches
- `LogoUploader.tsx`: file input + preview on per-mode swatch (previewMode prop → CSS class → token-based background); `onFileChosen` callback; visually-hidden input triggered by "Choose file" button
- `BrandingSettingsPage.tsx`: app-name `ds-input` field; dual `LogoUploader` slots (primary/light + dark/dark); `draftDarkLogoFile` state; `handleSave` uploads dark file + threads `logoDarkUrl` into `brandStore.update(config, logoUrl, logoDarkUrl)`; `handleReset` clears both draft files
- 11 TDD LogoSection tests (RED→GREEN): dual slots render, choosing file marks dirty, dark upload calls `uploadBrandLogo(file, "dark")`, Reset clears both; web vitest 2770/2770 pass; theme-guard 126/126 green; both tsc clean

## Task Commits

1. **Task 1: Server dark-logo columns + variant-aware upload/serve + logoDarkUrl in GET** - `1447efc` (feat)
2. **Task 2: Server supertests — dark-logo routes in BOTH auth modes** - `bfba1e7` (test)
3. **Task 3: brandStore.logoDarkUrl + Sidebar theme selection + FOUC favicon** - `bf66cc3` (feat)
4. **Task 4: Dual logo slots + app-name + Reset clears both + LogoSection tests (TDD)** - `6aee1b2` (feat)

## Files Created/Modified

- `packages/server/src/db.ts` — logo_dark_* in SCHEMA_DDL, PRAGMA-guarded ALTER block
- `packages/server/src/index.ts` — BrandConfigRow extended, GET branding, GET logo variant, POST logo variant
- `packages/server/tests/routes.branding.spec.ts` — 8 new dark-logo tests (both auth modes), cleanup extended
- `packages/web/src/store/brandStore.ts` — BrandState.logoDarkUrl, bootstrap/update with logoDarkUrl
- `packages/web/src/components/Sidebar.tsx` — useThemeStore import, effectiveLogoUrl selection
- `packages/web/index.html` — FOUC favicon dark-aware effectiveLogoUrl
- `packages/web/src/components/settings/LogoUploader.tsx` — NEW: per-mode preview swatch component
- `packages/web/src/components/settings/BrandingSettingsPage.tsx` — dual slots, draftDarkLogoFile, app-name input, handleSave/Reset extensions
- `packages/web/src/components/settings/BrandingSettingsPage.css` — logo-uploader-* + brand-logo-slots + brand-appname-field classes
- `packages/web/src/components/settings/__tests__/LogoSection.spec.tsx` — NEW: 11 TDD tests
- `packages/web/src/components/settings/__tests__/BrandingSave.spec.tsx` — getState mock + update() assertion updated

## Decisions Made

- **Phase-81 validation reuse**: variant branching happens AFTER the SVG/magic-byte validation block — only target columns + response key differ; no weakening or duplication
- **Optional logoDarkUrl param on update()**: avoids breaking 83-03 handleSave; defaults to `get().logoDarkUrl` when undefined so existing calls preserve state
- **LogoUploader swatch as CSS class**: `logo-uploader-preview--dark/light` with token-based backgrounds — avoids hex in component source (theme-guard safe)
- **BrandingSave.spec.tsx auto-fixed (Rule 1)**: extending `update()` to 3 args required updating the mock's `getState` return + the `toHaveBeenCalledWith` assertion; behavioral invariant preserved

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BrandingSave.spec.tsx broken by update() 3rd arg extension**
- **Found during:** Task 4 full web vitest run
- **Issue:** `useBrandStore.getState()` mock in BrandingSave.spec.tsx lacked `logoDarkUrl`; `toHaveBeenCalledWith` assertion expected 2 args but now 3 passed
- **Fix:** Added `logoDarkUrl: null` to getState mock; updated assertion to accept optional 3rd arg via `toSatisfy`
- **Files modified:** `packages/web/src/components/settings/__tests__/BrandingSave.spec.tsx`
- **Commit:** `6aee1b2`

## Self-Check: PASSED

All files confirmed present. All 4 task commits verified in git history. TSC clean (server + web). vitest: web 2770/2770 pass; server routes.branding.spec.ts 29/29 pass; server failing-file set = TD-V16-TEST-ISOLATION only.

---
*Phase: 83-branding-admin-ui*
*Completed: 2026-06-25*
