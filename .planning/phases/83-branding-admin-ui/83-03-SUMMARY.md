---
phase: 83-branding-admin-ui
plan: 03
subsystem: ui
tags: [react, codemirror, css-editor, feel-levers, branding, live-preview, save-reset]

# Dependency graph
requires:
  - phase: 83-01
    provides: BrandingSettingsPage scaffold, applyBrandTokens exported, handleDraftChange pattern, #brand-feel + #brand-css placeholders, strippedNotice state
  - phase: 83-02
    provides: Colors/Fonts sections in BrandingSettingsPage.tsx, BrandingSettingsPage.css with layout
provides:
  - FeelLevers.tsx: 5 segmented-control groups (density/radius/glow/type-scale/motion) dispatching BrandConfigPayload updates
  - BrandPreviewCard.tsx: live-reskinning representative components (button/chip/input/accent-text/nav-item)
  - CustomCssEditor.tsx: CodeMirror @codemirror/lang-css + debounced draft injection via kbi-brand-css-draft (separate from kbi-custom-css) + cleanup on unmount + stripped notice
  - BrandingSettingsPage.tsx: full handleSave (PUT + optional logo POST + stripped diff + brandStore.update) + handleReset (Aurora defaults staged live, isDirty=true); draftLogoFile state
affects: [83-04-dark-logo]

# Tech tracking
tech-stack:
  added: []  # @codemirror/lang-css installed in 83-01; no new deps in 83-03
  patterns:
    - SegGroup generic typed component: reusable segmented-control group with active class
    - kbi-brand-css-draft separate draft style element: never overwrites kbi-custom-css (BrandStyleInjector owns that)
    - Debounced useEffect for CSS draft injection: value change triggers 400ms debounce via timerRef
    - Cleanup useEffect for kbi-brand-css-draft removal on unmount
    - stripped-notice diff: submittedCss !== resp.config.customCss string equality (server returns sanitized CSS)
    - handleSave saving guard (if saving return) + try/finally setSaving(false)

key-files:
  created:
    - packages/web/src/components/settings/FeelLevers.tsx
    - packages/web/src/components/settings/BrandPreviewCard.tsx
    - packages/web/src/components/settings/CustomCssEditor.tsx
    - packages/web/src/components/settings/__tests__/FeelLevers.spec.tsx
    - packages/web/src/components/settings/__tests__/CustomCssEditor.spec.tsx
    - packages/web/src/components/settings/__tests__/BrandingSave.spec.tsx
  modified:
    - packages/web/src/components/settings/BrandingSettingsPage.tsx (FeelLevers/BrandPreviewCard/CustomCssEditor wired; full handleSave/Reset; draftLogoFile state; strippedNotice state; uploadBrandLogo import)
    - packages/web/src/components/settings/BrandingSettingsPage.css (feel-levers, feel-seg, brand-preview-card, custom-css-editor, stripped-notice, section-hint classes)

key-decisions:
  - "SegGroup generic typed helper: reusable across all 4 preset enums (density/radius/motion) + numeric type-scale; avoids duplicated button-group markup"
  - "timerRef for debounce (not useState): stable ref avoids re-render on timer tick; both useEffects (debounce inject + cleanup mount) correctly handle the ref lifecycle"
  - "No branding-page @scope exemption: Reset + Save buttons are token-styled ds-btn classes positioned above editor; page is architecturally exempt via id=branding-admin-exempt marker; flagged for Phase 84 UAT"
  - "stripped-notice diff = simple string inequality on customCss: submittedCss is captured before PUT; savedCss from response; no line-by-line diff needed (server already identifies removed declarations)"

# Metrics
duration: 8min
completed: 2026-06-25
---

# Phase 83 Plan 03: Feel Levers + Custom CSS Editor + Save/Reset Summary

**FeelLevers (density/radius/glow/type-scale/motion segmented controls), BrandPreviewCard (live-reskinning component showcase), CodeMirror CustomCssEditor (debounced kbi-brand-css-draft inject, page-exempt), full handleSave (PUT + logo POST + stripped diff + brandStore.update), and handleReset (Aurora defaults staged) completing the branding page**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-25T14:02:06Z
- **Completed:** 2026-06-25T14:10:16Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- FeelLevers.tsx: 5 segmented control groups (density Compact/Comfortable/Spacious, radius Sharp/Default/Round, glow On/Off, type-scale Small/Medium/Large mapping to 11/12/14px, motion None/Reduced/Default/Fast); active button gets feel-seg-active class; Aurora defaults (null/undefined) mapped correctly
- BrandPreviewCard.tsx: compact card with primary button, ghost button, chip, badge, text input, accent-text label, faux nav-item — all using ds-* classes + CSS tokens so they re-skin live
- Both wired into BrandingSettingsPage id="brand-feel" side-by-side via brand-feel-layout grid
- CustomCssEditor.tsx: CodeMirror @codemirror/lang-css + oneDark when dark; debounced (~400ms) via timerRef; creates/reuses kbi-brand-css-draft via getDraftStyleEl(); cleanup useEffect removes element on unmount; never touches kbi-custom-css; stripped notice rendered as role="alert"
- Full handleSave: saving guard + uploadBrandLogo when draftLogoFile set + updateBrandConfig(draft) + stripped-notice diff (submittedCss !== savedCss) + brandStore.getState().update(config, logoUrl) + setDraftLogoFile(null) + setIsDirty(false)
- Full handleReset: applyBrandTokens({}, theme) + setDraft({}) + setIsDirty(true) — staged Aurora defaults, never calls updateBrandConfig (Pitfall 1 respected)
- 29 new tests (13 FeelLevers + 7 CustomCssEditor + 9 BrandingSave); theme-guard 122/122 green; vitest 2757/2757 pass; tsc clean

## Task Commits

1. **Task 1: FeelLevers + BrandPreviewCard + Feel section wiring** - `8307269` (feat)
2. **Task 2: CustomCssEditor + debounced draft inject + stripped notice** - `6bcc13a` (feat)
3. **Task 3: Full handleSave (PUT + logo POST + stripped diff) + handleReset (Aurora defaults)** - `3a20f42` (feat)

## Files Created/Modified

- `packages/web/src/components/settings/FeelLevers.tsx` — 5 segmented control groups, SegGroup generic helper
- `packages/web/src/components/settings/BrandPreviewCard.tsx` — live-reskinning component preview (no hex)
- `packages/web/src/components/settings/CustomCssEditor.tsx` — CodeMirror + kbi-brand-css-draft + debounce + cleanup + stripped notice
- `packages/web/src/components/settings/BrandingSettingsPage.tsx` — FeelLevers/BrandPreviewCard/CustomCssEditor wired; full handleSave/Reset; draftLogoFile state; uploadBrandLogo import
- `packages/web/src/components/settings/BrandingSettingsPage.css` — feel-levers, feel-seg, brand-preview-card, custom-css-editor, stripped-notice, section-hint layout classes
- `packages/web/src/components/settings/__tests__/FeelLevers.spec.tsx` — 13 tests
- `packages/web/src/components/settings/__tests__/CustomCssEditor.spec.tsx` — 7 tests
- `packages/web/src/components/settings/__tests__/BrandingSave.spec.tsx` — 9 tests

## Decisions Made

- **SegGroup generic typed helper**: eliminates 4 near-identical button-group markup patterns; typed generics (string union + number literal unions) keep type safety
- **timerRef for debounce timer**: stable across renders (no setState re-trigger); both effects correctly clear/remove on cleanup
- **No @scope branding-page exemption**: page is exempt by id="branding-admin-exempt" marker (Phase 84 scoping hook), not by runtime CSS logic; Reset is always reachable as the recovery mechanism
- **Simple string inequality for stripped-notice**: captures submittedCss snapshot before PUT, compares to resp.config.customCss; no line-by-line diff required

## Deviations from Plan

None — plan executed exactly as written. All three TDD cycles (RED → GREEN → verify) completed as specified. `draftLogoFile` state added to BrandingSettingsPage as directed by the plan's Task 3 action note.

## Issues Encountered

- `expect.anything()` in BrandingSave.spec.tsx did not match `null` (vitest asymmetric matchers exclude null/undefined from `anything()`). Fixed with `expect.toSatisfy()` that accepts `null | string`. Behavioral invariant preserved.
- Pre-existing TD-V16-TEST-ISOLATION: InfoPopup.spec.tsx emits 9 console errors in parallel vitest run (401 from shared columnDisplayConfigStore). Tests pass; same issue as 83-02. Does not affect 83-03 work.

## Next Phase Readiness

- 83-04 (Dark Logo server + client): BrandingSettingsPage has `draftLogoFile` state wired; `uploadBrandLogo(file, "dark")` is exported; BrandPreviewCard + feel section complete so page is functionally done

## Self-Check: PASSED

All created files confirmed present on disk. All 3 task commits verified in git history. TSC clean. vitest 2757/2757 pass (theme-guard 122/122).
