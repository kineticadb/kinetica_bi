# Requirements: Kinetica BI — v1.16 White-Label Theming

**Defined:** 2026-06-23
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

Make the app white-labelable: a permitted admin brands it live (logo/name, colors, typography, custom CSS) from a runtime admin UI, on top of a distinctive default Kinetica theme ("Aurora"). Styling approach (research-locked): EXTEND the existing CSS-custom-property token system — no Tailwind/Shadcn. Chosen design direction + token baseline: `.planning/design/CHOSEN-DIRECTION.md`. Research: `.planning/research/SUMMARY.md`.

## v1 Requirements (v1.16)

### Design Token System (TOKENS)

- [x] **TOKENS-V116-01**: The full design-token vocabulary is defined in `:root` (extending today's color tokens) across all categories — color, typography (family/display/scale/weight/line-height/tracking), spacing scale + layout, radius scale + border, elevation/shadow, and motion (duration/easing) — for both dark and light modes.
- [x] **TOKENS-V116-02**: The existing styles (`global.css` + the 3 component CSS files + any inline component styles) are migrated off hardcoded literals onto the structural tokens, in waves, so changing a token re-skins the whole app consistently.
- [x] **TOKENS-V116-03**: A guard (extending the existing color-only theme-guard) prevents regressions — non-token spacing/type/radius/motion literals don't creep back into migrated component code.
- [x] **TOKENS-V116-04**: The two-tier accent rule holds — a saturated brand color (`--accent`) is used only for fills; accent-colored text/icons use a contrast-safe variant (`--accent-text`, lighter on dark / darker on light).

### Default Kinetica Theme (THEME)

- [x] **THEME-V116-01**: A refreshed, distinctive default theme ("Aurora") ships out of the box — Kinetica violet `#7f40ed` on near-black, hex-mesh + aurora-glow treatment, Manrope + Space Grotesk, compact density — matching the approved baseline, in dark mode.
- [x] **THEME-V116-02**: A coherent light-mode palette is derived from the same brand identity (including the darker `--accent-text` for light), and the existing dark/light toggle continues to work.
- [x] **THEME-V116-03**: Chart (recharts) and map (OpenLayers/WMS) colors integrate with the theme — accents follow the brand where appropriate while data-series colors remain visually distinct (not all one hue); the map layers legend is unaffected by branding.

### Brand Config Foundation (BRANDFND)

- [x] **BRANDFND-01**: A server-side brand configuration store persists the active branding (color tokens light+dark, fonts, radius/density/glow, app name, logo reference, custom CSS) as a single global brand.
- [x] **BRANDFND-02**: A new permission gates branding management; reads are available unauthenticated (the login page must render branded), writes require the permission and return the standard 403 for non-permitted users.
- [x] **BRANDFND-03**: The client fetches the active brand at startup and applies it at runtime by setting CSS custom properties (no rebuild/redeploy); a brand change by an admin propagates to other users/tabs without a hard refresh.
- [x] **BRANDFND-04**: Branding is applied before first paint (no flash of the default theme on load / reload).

### Branding Admin UI (BRANDUI)

- [x] **BRANDUI-01**: A permission-gated Branding settings page lets an admin set the app name and upload a brand logo (used in topbar, sidebar, login, and favicon).
- [x] **BRANDUI-02**: The admin can edit the color palette for both dark and light modes via color pickers, with a live WCAG contrast indicator for critical pairs (text/background, on-accent/accent).
- [x] **BRANDUI-03**: The admin can choose body + display fonts from a curated, self-hosted list.
- [x] **BRANDUI-04**: The admin can adjust the "feel" levers — corner radius, density (Compact/Comfortable/Spacious), and the ambient glow on/off — plus coarse controls for type-scale (base size + ratio), spacing density, and motion speed.
- [x] **BRANDUI-05**: The page shows a live preview of branding changes before saving, and supports Save and Reset-to-Kinetica-default.
- [x] **BRANDUI-06**: The admin can upload an OPTIONAL dark-mode logo override in addition to the required primary logo; the client shows the dark variant in dark mode when present, else the primary, else the bundled default. (Added 2026-06-24 — uploaded logos are opaque `<img>`s and can't be auto-recolored per theme like the inline default. Spans server schema/endpoint + client selection + Phase-83 UI.)

### Custom CSS Override (CSS)

- [x] **CSS-V116-01**: A permitted admin can inject custom CSS to fine-tune appearance beyond the token palette, persisted with the brand config and applied at runtime.
- [ ] **CSS-V116-02**: Injected CSS is sanitized (server-side, AST-based) to neutralize exfiltration/XSS vectors (`url()`/`@import`/`expression()`/`javascript:` etc.) and scoped so it cannot break the app shell or the branding admin UI itself.

### Security & Accessibility (SECA)

- [x] **SECA-V116-01**: Logo/asset uploads are validated (MIME + magic-byte type check, size limit) and SVGs are sanitized; logos render as images (never inline-executed).
- [x] **SECA-V116-02**: The branding UI surfaces accessibility guardrails — contrast ratios computed live with pass/fail feedback so a customer cannot unknowingly ship an illegible palette (dark AND light).

### Verification (VERIFY)

- [ ] **VERIFY-V116-01**: The milestone is proven via green automated gates on both stacks (server supertests both auth modes + server `tsc` + server vitest set-based ⊆ TD-V16-TEST-ISOLATION; frontend vitest 100% from `packages/web` + web `tsc` + theme-guard incl. the extended structural guard) AND a blocking live operator walk-through (default Aurora theme dark+light; brand a logo/name/colors/fonts/feel live with no-FOUC apply + reset; custom-CSS sanitized+scoped; WCAG feedback; logo-upload validation; non-permitted user blocked), with a compiled verification record and in-session repro-test-driven gap fixes re-walked PASS.

## Future Requirements (deferred)

- **BRAND-V2-01**: Per-tenant / per-customer branding (multiple brands in one deployment). v1 is a single global brand; the store schema leaves a nullable tenant stub so this is additive later.
- **BRAND-V2-02**: Brand import/export (share a theme as a file between deployments).
- **THEME-V2-01**: Multiple selectable preset themes beyond Aurora + custom.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Tailwind / Shadcn migration | Research-rejected: multi-week rewrite of ~50 components, no user payoff, and Shadcn's default look is the cookie-cutter aesthetic we're avoiding. Extend the CSS-token system instead. |
| Per-tenant branding (multi-brand) | No tenant model today; v1 ships a single global brand (schema stub left for later). |
| Arbitrary per-token raw editing of type-scale/spacing/motion in the UI | Layout-break risk; exposed via coarse controls only. Per-value tweaks reachable via the custom-CSS escape hatch. |
| Customer-supplied arbitrary font URLs | SSRF + GDPR risk; curated self-hosted font list only. |
| Re-theming the map's per-layer WMS class-break colors via brand tokens | Those are designer data per layer, not app chrome — correct by design. |

## Traceability

Populated 2026-06-23 (roadmap created).

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOKENS-V116-01 | Phase 80 | Complete |
| TOKENS-V116-02 | Phase 80 | Complete |
| TOKENS-V116-03 | Phase 80 | Complete |
| TOKENS-V116-04 | Phase 80 | Complete |
| THEME-V116-01 | Phase 80 | Complete |
| THEME-V116-02 | Phase 80 | Complete |
| THEME-V116-03 | Phase 80 | Complete |
| BRANDFND-01 | Phase 81 | Complete |
| BRANDFND-02 | Phase 81 | Complete |
| SECA-V116-01 | Phase 81 | Complete |
| CSS-V116-02 | Phase 81, 83 | Partial (81: AST sanitize ✓; 83: @scope) |
| BRANDFND-03 | Phase 82 | Complete |
| BRANDFND-04 | Phase 82 | Complete |
| BRANDUI-01 | Phase 82 | Complete |
| BRANDUI-02 | Phase 83 | Complete |
| BRANDUI-03 | Phase 83 | Complete |
| BRANDUI-04 | Phase 83 | Complete |
| BRANDUI-05 | Phase 83 | Partial (83-01: live-preview + Save/Reset skeleton + dirty-tracking + leave-revert; full Save/Reset in 83-03) |
| BRANDUI-06 | Phase 83 | Pending (optional dark-logo override; BOTH-stack) |
| CSS-V116-01 | Phase 83 | Complete |
| SECA-V116-02 | Phase 83 | Complete |
| VERIFY-V116-01 | Phase 84 | Pending |

**Coverage:**
- v1.16 requirements: 21 total
- Mapped to phases: 21/21 ✓
- Unmapped: 0

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-23 after roadmap creation (21/21 requirements mapped to phases 80-84)*
