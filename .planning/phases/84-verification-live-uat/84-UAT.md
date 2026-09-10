---
status: testing
phase: 84-verification-live-uat
source: milestone v1.16 (phases 80-83 SUMMARYs) + VERIFY-V116-01 walk-through checklist
started: 2026-06-25T00:00:00Z
updated: 2026-06-25T00:00:00Z
---

## Current Test

number: 14
name: Non-permitted user blocked
expected: |
  A user WITHOUT branding:manage sees no Branding nav entry / cannot open the
  page, and a direct PUT /api/branding returns 403.
awaiting: complete — all 14 tests passed (2 gaps found + resolved during walk-through)

## Tests

### 1. Automated gates (run by Claude)
expected: web vitest 100% from packages/web; web tsc clean; server tsc clean; server vitest set-based (failing files ⊆ TD-V16-TEST-ISOLATION); theme-guard green
result: pass
note: "web 120 files/2770 tests; web+server tsc clean; theme-guard 126; branding spec 29/29. Server failing files are TD-V16-TEST-ISOLATION victims — ALL pass in isolation (incl. newly-surfaced layers.spec.ts 18/18 + routes.info-query.spec.ts 28/28). No Phase-83/84 regression."

### 2. Aurora default theme — dark mode
expected: Default (no custom brand) renders Aurora dark — violet on near-black, Manrope/Space Grotesk, glass panels + glow, inline default Kinetica logo in sidebar. Polished, nothing broken.
result: pass

### 3. Aurora default theme — light mode
expected: Toggling to light mode re-skins the whole app to the warm off-white Aurora light palette (readable darker --accent-text on light); default logo wordmark flips to dark ink. Coherent, readable.
result: pass

### 4. Branding page access (admin)
expected: As an admin (has branding:manage), a "Branding" entry appears under Settings in the sidebar; clicking it opens the Branding settings page with sections: Logo & name, Colors, Fonts, Feel, Custom CSS, and a Reset/Save header.
result: pass

### 5. Live color edit re-skins the whole app
expected: Changing the accent color picker (active theme column) updates every button / focus ring / active swatch across the WHOLE app live — sidebar, topbar, the page itself — before clicking Save (no reload, no save needed). A preview card also reflects the change.
result: pass

### 6. WCAG warn badge on low-contrast pair
expected: Setting a poor contrast combo (e.g. light text on light background) shows a visible FAIL badge next to the affected pair, in BOTH the dark and light columns. Save is NOT blocked (warn-only).
result: pass

### 7. Fonts — body + display live preview
expected: Picking a body font and a display font from the curated dropdowns updates the live preview/app text immediately; choices are distinct (body vs display).
result: pass

### 8. Feel levers produce visible changes
expected: Changing density (Compact/Comfortable/Spacious) visibly changes spacing rhythm; corner-radius control rounds/squares corners; glow on/off toggles the ambient aurora glow. All observable live.
result: pass

### 9. Logo upload — primary + optional dark override
expected: Uploading a primary logo shows it as an <img> in the sidebar (and login). The optional dark-override slot accepts a second logo; in dark mode the dark variant shows, in light mode the primary shows. Each slot previews on its own mode background. Bad uploads (e.g. oversized / wrong type) are rejected.
result: pass

### 10. Custom CSS — sanitize + persist
expected: A legitimate rule (e.g. `button { letter-spacing: 0.05em }`) applies live and persists through Save + reload. Pasting a `url(https://attacker.com)` or `@import` and saving stores a sanitized version (those stripped) — a "stripped declarations" notice appears after Save.
result: pass
note: "Gap found + fixed mid-test — a CSS syntax error wiped the WHOLE stylesheet (strict postcss.parse → catch → ''). Switched to postcss-safe-parser (tolerant, per-rule recovery) + empty-shell cleanup so only the offending part is stripped. See Gaps."

### 11. Save + no-FOUC hard reload
expected: After Save, a hard reload (ideally throttled) shows the custom brand from the very first painted frame — no flash of the default Aurora violet before brand loads. The favicon reflects the brand.
result: pass

### 12. Reset to Kinetica default
expected: Clicking Reset stages the Aurora defaults live; after Save the app returns cleanly to the default Kinetica theme/logo/fonts/feel (no leftover custom values).
result: pass

### 13. Cross-tab live propagation
expected: With the app open in two tabs, saving a brand change in one tab updates the other tab within a few seconds — no manual refresh.
result: pass

### 14. Non-permitted user blocked
expected: A user WITHOUT branding:manage sees no Branding nav entry / cannot open the page, and a direct PUT /api/branding returns 403.
result: pass
note: "Gap found + fixed — server PUT correctly returned 403, but the branding PAGE itself was reachable (render gated only on page state, not permission). Added client-side gate. See Gaps."

## Summary

total: 14
passed: 14
issues: 0
pending: 0
skipped: 0

## Gaps

- truth: "Branding page buttons (Reset / Save / Choose file) + preview-card buttons use the app's standard button styles"
  status: resolved
  reason: "Operator noticed pre-walkthrough: branding buttons rendered as browser-default gray, not the app's accent/ghost buttons."
  severity: cosmetic
  test: 4
  root_cause: "83-01/03/04 components used invented class names (ds-btn / ds-btn-primary / ds-btn-ghost / ds-btn-sm) defined in NO css → undefined classes fall back to UA default chrome. Passed theme-guard + vitest (neither validates that a className resolves to defined CSS) — the css-bugs-evade-tests failure mode."
  artifacts:
    - path: "packages/web/src/components/settings/BrandingSettingsPage.tsx"
      issue: "Reset/Save used ds-btn-ghost / ds-btn-primary"
    - path: "packages/web/src/components/settings/LogoUploader.tsx"
      issue: "Choose file used ds-btn-ghost ds-btn-sm"
    - path: "packages/web/src/components/settings/BrandPreviewCard.tsx"
      issue: "preview buttons used ds-btn-primary / ds-btn-ghost"
  fix: "Swapped all ds-btn* → the app's real classes. Then matched the app's paired-action sizing convention: a primary next to a ghost uses `btn-primary btn-sm` (NOT plain btn-primary, which is the large standalone CTA with align-self:flex-start) so it equals `ghost-sm` height — same pattern as DashboardsPage .ds-actions rows. Header Save + preview-card primary → `btn-primary btn-sm`; Reset/Choose-file/preview-ghost → `ghost-sm`. Scanned ALL settings classNames — every other one resolves to defined CSS. tsc clean; settings vitest 52/52; theme-guard 126."

- truth: "WCAG accent-text badge reflects the real usage; default Aurora theme passes AA"
  status: resolved
  reason: "Operator (test 6): default theme showed 'Accent Text / Accent FAIL' (1.3:1 dark, 2.9:1 light)."
  severity: major
  test: 6
  root_cause: "The badge checked --accent-text against the ACCENT FILL, but --accent-text is accent-colored text shown on the PAGE BACKGROUND (two-tier rule); on the fill you use --on-accent/#fff. So it paired colors that are never used together → false FAIL on the default palette."
  fix: "Relabeled 'Accent Text / Accent' → 'Accent Text / BG' and repointed the WcagBadge bg to --bg (bgColor/lightBgColor) in both columns (BrandingSettingsPage.tsx). White-on-fill still checked by the separate On-Accent/Accent badge. Default theme now passes AA. Also added body/muted/danger text samples to BrandPreviewCard (test 5). tsc clean; settings vitest 52/52."

- truth: "A CSS issue strips only the offending part; valid rules persist"
  status: resolved
  reason: "Operator (test 10): any issue in custom CSS removed the WHOLE stylesheet, not just the bad part."
  severity: major
  test: 10
  root_cause: "sanitizeCssPostcss used the STRICT postcss.parse inside `try { ... } catch { return '' }`. PostCSS throws CssSyntaxError on any malformed syntax anywhere in the input → catch returned '' → the entire stylesheet was wiped. (Blocked *values* like url() were already stripped per-decl correctly; only the unparseable-syntax path nuked everything.)"
  fix: "Swapped postcss.parse → postcss-safe-parser (tolerant, recovers per-rule so a broken rule no longer discards valid siblings). Added an empty-rule cleanup pass so stripping a rule's only declaration doesn't leave a `{}` shell. Added ambient .d.ts (package ships none). New regression tests: syntax-error-keeps-siblings, strip-bad-decl-keep-good-decl-in-same-rule, strip-blocked-rule-amid-garbage, empty-shell-removed. Server tsc clean; sanitizer spec all green; routes.branding 34/34."
  artifacts:
    - path: "packages/server/src/lib/brandCssSanitizer.ts"
      issue: "strict parse + catch-returns-empty wiped whole CSS on any syntax error"
    - path: "packages/server/src/types/postcss-safe-parser.d.ts"
      issue: "new ambient types for the tolerant parser"

- truth: "A user WITHOUT branding:manage cannot open the branding page"
  status: resolved
  reason: "Operator (test 14): a non-admin could still ACCESS the branding page (Save correctly 403'd, but the page rendered)."
  severity: major
  test: 14
  root_cause: "App.tsx rendered <BrandingSettingsPage /> gated ONLY on `page === 'branding'` state, with no permission check. The Sidebar nav link is hidden for non-permitted users, but the page was still reachable via the sessionStorage RETURN_TO restore (it listed 'branding' as restorable) or a stale page state after a mid-session role change. Server enforced 403 on PUT; the client render path did not gate."
  fix: "Three defensive client gates in App.tsx: (1) RETURN_TO restore no longer restores 'branding' without branding:manage; (2) a guard effect resets page→dashboards if page==='branding' && !hasPermission (covers mid-session role changes); (3) the render branch itself is gated on hasPermission(BRANDING_MANAGE). Added App.spec tests for blocked + allowed paths. web tsc clean; App.spec 32/32."
  artifacts:
    - path: "packages/web/src/App.tsx"
      issue: "branding render + RETURN_TO restore not permission-gated"
