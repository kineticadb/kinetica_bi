# Kinetica BI — Project Instructions

Monorepo: `packages/web` (React + Vite + zustand) and `packages/server` (Express + SQLite, ESM).
Read `.planning/codebase/CONVENTIONS.md` for the fuller code-style picture.

## UI Conventions (READ BEFORE WRITING ANY COMPONENT)

This app has **no `<Button>`/design-system component** — UI uses plain elements with **utility classes defined in `packages/web/src/styles/global.css`**. There is **no automatic styling and no build check that a `className` resolves to real CSS** — an invented/misspelled class silently renders as unstyled browser-default chrome and still passes `tsc`, vitest, and theme-guard. So:

**Reuse existing classes. NEVER invent new class names for something that already exists.** Before styling a new element, grep `global.css` (and the nearest component `.css`) for an existing class. Match the closest existing component (e.g. a new settings page mirrors `RolesPage.tsx`).

### Canonical button classes (all in `global.css`)
- **Primary CTA, standalone** (e.g. "Create dashboard"): `className="btn-primary"` — large, accent fill, `align-self: flex-start`.
- **Primary in an action pair** (next to a secondary button): `className="btn-primary btn-sm"` — the **small** variant. Plain `btn-primary` next to `ghost-sm` is the WRONG, mismatched-height combo. `btn-sm` matches `ghost-sm`'s box exactly.
- **Secondary / ghost**: `className="ghost-sm"`. Destructive: `className="ghost-sm ghost-danger"`.
- **Action button row**: wrap buttons in `<div className="ds-actions">` (centers them, no vertical stretch, no-wrap) — the equal-height container. Canonical pairing: `btn-primary btn-sm` + `ghost-sm` inside `ds-actions`. See `DashboardsPage.tsx`.
- A settings page Save/Cancel footer may instead use the page-local `roles-btn-save` / `roles-btn-cancel` pattern (see `RolesPage.css`) — also matched-height.

### Form controls (all in `global.css`)
- Field: `<div className="ds-field"><span className="ds-field-label">…</span><input/select className="ds-select"…/></div>`.
- Section group: `<div className="config-group"><span className="config-group-label">…</span>…</div>`.

### Colors / theming
- **Never hardcode hex** in component CSS/TSX — use the token vars (`var(--accent)`, `var(--text)`, `var(--bg)`, `var(--panel)`, `var(--border)`, `var(--muted)`, `var(--danger)`, `var(--accent-text)`, etc.). `theme-guard.spec.ts` fails the build on raw hex in components (legit exceptions go in its ALLOWLIST with a one-line justification, in the same commit).
- Uploaded/user images render as `<img>` only — never inline SVG / `dangerouslySetInnerHTML` (XSS boundary). The bundled default logo is the one inline-SVG exception (`DefaultLogo.tsx`, trusted first-party, themed via `var(--accent)`/`var(--text)`).

## Test gates
- Web: `cd packages/web && npx tsc --noEmit` clean; `npx vitest run` 100%; `npx vitest run src/styles/theme-guard.spec.ts` green.
- Server: `cd packages/server && npx tsc --noEmit` clean; server vitest is **SET-BASED** — failing files must be ⊆ the known `TD-V16-TEST-ISOLATION` set (cross-mode contamination that passes in isolation); never assert a fixed pass-count.
