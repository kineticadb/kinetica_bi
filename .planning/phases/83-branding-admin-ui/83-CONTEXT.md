# Phase 83: Branding Admin UI - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A permission-gated (`branding:manage`) Branding settings page where an admin brands the app end-to-end without a redeploy: set the app name + upload a primary logo (and an optional dark-mode override, BRANDUI-06), edit the dark AND light color palette with live WCAG feedback, pick fonts, adjust "feel" levers (density/radius/glow/type-scale/motion), preview changes live, Save/Reset, and inject sanitized custom CSS.

**Stack: BOTH** — frontend page (`packages/web`) PLUS a small server addition for BRANDUI-06 (optional dark logo: `brand_config.logo_dark_*` columns + dark-variant upload/serve + `logoDarkUrl` in `GET /api/branding`). The Phase-81 `GET/PUT /api/branding` + `POST /api/branding/logo` already exist and are reused. New web deps: `react-colorful`, `colord`, `@codemirror/lang-css`.
</domain>

<decisions>
## Implementation Decisions

### Page layout + live-preview model
- **Single scrolling page** with grouped sections: (1) Logo & app name, (2) Colors, (3) Fonts, (4) Feel levers, (5) Custom CSS. Page header carries **Reset** + **Save**. Scaffold mirrors `RolesPage`/`ProfilePage` patterns.
- **Live whole-app apply**: edits apply to `:root` immediately via `brandStore`/`applyBrandTokens` (`setProperty`), so the WHOLE app (sidebar, topbar, the page itself) re-skins in real time — this IS the primary preview (matches success criterion 1).
- PLUS a **compact preview card** rendering representative components (button, chip, input, badge, nav-item) so component states not otherwise on-screen are visible.
- **Active-theme nuance:** live re-skin reflects the *currently active* theme. Because colors are edited side-by-side (dark+light), editing an off-theme (e.g. light) color while the app is in dark mode won't visibly change the app until the theme is toggled; the preview card / app updates for whichever theme is active. Document this so it's not read as a bug.

### Color editing (dark + light) + WCAG
- **Side-by-side dark & light** columns — all 8 token pairs × 2 modes = 16 pickers visible at once (two columns: Dark | Light).
- Pickers via **react-colorful**; contrast math via **colord**.
- 8 brandable color tokens (per mode): `--accent`, `--accent-2`, `--bg`, `--panel`, `--text`, `--muted`, `--border`, `--danger` (maps to brandStore `primaryColor`/`accent2Color`/`bgColor`/`panelColor`/`textColor`/`mutedColor`/`borderColor`/`dangerColor` and their `light*` variants).
- **WCAG = warn-only, Save NOT blocked.** Show live pass/fail badges on the critical pairs (`--text` on `--bg`, and the two-tier accent rule `--accent-text` on its background + on-accent/accent for button text). Admin is informed → can't ship illegible "unknowingly", but retains control for intentional choices.

### Save / Reset / leaving unsaved
- Edits **live-apply for preview only** — NOT persisted until Save.
- **Save** persists via `PUT /api/branding` (config) + `POST /api/branding/logo` for any newly chosen logo(s). On success, brandStore reflects the saved state (and notifies other tabs — Phase 82 BroadcastChannel).
- **Navigating away with unsaved changes** → confirm prompt; on leave, **revert** the live `:root` changes back to the saved brand (re-apply from brandStore/server). Dirty-tracking mirrors `RolesPage` (`isDirty`/`saving`, Save disabled when `!isDirty`).
- **Reset to Kinetica default** → loads the Aurora default palette/fonts/feel live (staged), but **persists only on Save** (not immediate).

### Logo + optional dark override (BRANDUI-06)
- **Both slots always visible, side by side**: Primary logo (required/used in both modes by default) + Dark-mode override (optional). **Each slot previews on its own mode's background** (primary on the light surface, dark-override on the dark surface) so contrast issues are obvious.
- Client selection at render: `theme === "dark" && logoDarkUrl` → dark override; else `logoUrl` (primary); else inline `DefaultLogo`. (Wire into `Sidebar.tsx` + the FOUC inline script.)
- Uploads reuse the **Phase-81 validation path** (MIME + magic-byte via file-type, DOMPurify SVG sanitize, 256KB cap, `<img>`-only render). BRANDUI-06 server work: add `logo_dark_data`/`logo_dark_mime`/`logo_dark_updated_at` + a dark-variant upload/serve + `logoDarkUrl` in the GET response.
- App-name text field (defaults to "Kinetica BI").

### Custom CSS editor
- **CodeMirror** via `@uiw/react-codemirror` (already installed) + new `@codemirror/lang-css`; `oneDark` theme when dark — mirror `DynamicViewsModal.tsx` / `KineticaWmsLayerForm.tsx` usage.
- **Live as-you-type (debounced)** preview: inject via the existing `BrandStyleInjector` (`textContent`). Raw client-side preview is acceptable — it's the trusted admin's own session.
- On **Save**, the server sanitizes (`sanitizeCssPostcss`, already wired into `PUT /api/branding` in Phase 81) and returns the cleaned CSS; the editor shows a **"stripped declarations" notice** (what was removed: `url()`/`@import`/`@font-face`/`expression()`/etc.).
- **Scoping = UNSCOPED, full power** (Open Decision 1 RESOLVED). Custom CSS may override `:root` tokens and the app shell — a true escape hatch for advanced admins; server sanitizes XSS/exfiltration; Reset recovers any mess.
  - **Safety invariant:** the Branding settings page itself is NOT subjected to the live custom CSS (so the admin can always reach Reset/Save even if their CSS breaks the shell).
  - **Requirement nuance:** this intentionally diverges from CSS-V116-02's literal "scoped so it cannot break the app shell" — we protect the *branding admin UI* (Reset reachable) but allow full shell restyling (Reset is the recovery). Flag for Phase 84 so it's not a false gap.

### Claude's Discretion
- Section ordering within the page; exact preview-card component set; debounce interval for live CSS.
- Feel-lever control types (roadmap says "coarse controls" — density as **Compact/Comfortable/Spacious** presets; radius + glow on/off; type-scale base+ratio; motion-speed). Slider vs segmented control, ranges.
- Curated font list (e.g. Manrope, Space Grotesk + a few self-hosted) for body + display font.
- Extending `BrandConfigPayload` + `applyBrandTokens` to cover display-font + feel-lever tokens (the payload currently has body font + 8 color pairs + appName + customCss only — see code_context).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 83 scope + criteria
- `.planning/ROADMAP.md` §"Phase 83: Branding Admin UI" — goal, 5 success criteria, the 4-plan stub (incl. 83-04 BRANDUI-06), Open Decision 1 (now resolved: unscoped).
- `.planning/REQUIREMENTS.md` — BRANDUI-02/03/04/05/06, CSS-V116-01, CSS-V116-02, SECA-V116-02.
- `.planning/STATE.md` §"v1.16 Key Architectural Decisions (locked)" — setProperty/removeProperty runtime apply, two-tier accent rule (`--accent` fills / `--accent-text` text), react-colorful + colord deps, theme-guard ALLOWLIST rule for brand admin components.

### Client integration (read before building the page)
- `packages/web/src/store/brandStore.ts` — `BrandConfigPayload` shape, `update(config, logoUrl)`, `applyBrandTokens(config, theme)`, `BRAND_STORAGE_KEY`, BroadcastChannel. **Save calls `update()`; the payload must be EXTENDED for display-font + feel levers.**
- `packages/web/src/components/RolesPage.tsx` (+ `.css`) — page scaffold, dirty-tracking, permission-gated nav, Save/Reset footer pattern.
- `packages/web/src/components/DynamicViewsModal.tsx` (~lines 43-46, 849-858) — CodeMirror setup (`@uiw/react-codemirror`, `oneDark`, extensions, onChange).
- `packages/web/src/components/charts/DataFilterConfigPanel.tsx` — `ds-field`/`ds-field-label`/`ds-select`/`config-group` form-field patterns.
- `packages/web/src/components/Sidebar.tsx` (nav array + permission filter; logo render) + `DefaultLogo.tsx` (inline themed default).
- `packages/web/src/components/BrandStyleInjector.tsx` — custom-CSS injection via `textContent` (live-preview path).
- `packages/web/src/styles/global.css` `:root` + `:root[data-theme="light"]` — the brandable token names + the structural feel-lever tokens (radius/spacing/motion) the levers target.

### Server (BRANDUI-06 additions reuse these)
- `packages/server/src/index.ts` (~416-441 GET, 598-617 PUT, 627-679 POST logo) — request/response contracts; the logo upload validation path (file-type magic-byte + DOMPurify SVG) to reuse for the dark variant.
- `packages/server/src/db.ts` (~253-261) — `brand_config` table; add `logo_dark_*` columns following the existing `logo_*` style.
- `packages/server/src/lib/brandCssSanitizer.ts` — `sanitizeCssPostcss` (already wired into PUT); the "stripped declarations" Save-feedback derives from comparing submitted vs returned CSS.

### Memory
- Operator decision on the dark-logo override: see the `optional-dark-logo-override` memory (one required primary + optional dark; BOTH-stack).

[No external (non-.planning) specs — captured in decisions + codebase refs above.]
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `brandStore.update()` + `applyBrandTokens` — Save + live-apply already exist (Phase 82). Page wires Save → `update()`; live edits call the same apply path.
- `BrandStyleInjector.tsx` — custom-CSS live injection via `textContent` (reuse for as-you-type preview).
- `RolesPage` scaffold + dirty-tracking; `ds-field`/`config-group` form classes; `@uiw/react-codemirror` (installed) for the CSS editor.
- `DefaultLogo.tsx` — inline themed default (the fallback when no uploaded logo).

### Established Patterns
- Permission-gated nav via `Sidebar.tsx` `nav.filter(... hasPermission(...))` (hide-don't-disable). Add Branding under Settings gated on `PERMISSIONS.BRANDING_MANAGE`.
- Theme-guard scans `.tsx`/`.css` — brand admin components (color pickers, etc.) must be added to the theme-guard ALLOWLIST in the SAME commit that introduces them, with justification comments (STATE locked rule).
- CodeMirror theme follows app theme (`isDark ? oneDark : undefined`).

### Integration Points / gaps to close
- **`BrandConfigPayload` must be EXTENDED**: today it has 8 color pairs + `fontFamily` (body) + `fontUrl` + `appName` + `customCss`. Phase 83 adds **display font** and **feel-lever** fields (density/radius/glow/type-scale/motion) + (BRANDUI-06) the dark logo is a separate upload (logoDarkUrl), not a payload field. `applyBrandTokens` must map the new fields to their `:root` tokens.
- New client deps: `react-colorful`, `colord`, `@codemirror/lang-css`.
- Server: `brand_config.logo_dark_*` columns + dark-variant upload/serve + `logoDarkUrl` in GET (BRANDUI-06).
- API client (`packages/web/src/api/client.ts`): add `updateBrandConfig()` (PUT) + `uploadBrandLogo()` (POST, with a `variant: 'primary'|'dark'` param).
</code_context>

<specifics>
## Specific Ideas

- The whole app should visibly re-skin as you edit (the "wow"); the page itself restyles too, so WCAG warnings matter for keeping it usable.
- Custom CSS is a real escape hatch — full power, trust the `branding:manage` permission; Reset is the safety net, and the branding page is exempt from custom CSS so Reset is always reachable.
- Both logo slots visible at once, each previewed on the background it'll actually appear on.
</specifics>

<deferred>
## Deferred Ideas

None new — discussion stayed within the Phase 83 boundary. (BRANDUI-06 dark-logo override was already an agreed scope addition, not new here. Per-tenant branding / brand import-export remain v2 per REQUIREMENTS "Future Requirements".)
</deferred>

---

*Phase: 83-branding-admin-ui*
*Context gathered: 2026-06-24*
