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

## Writing verifiable acceptance criteria

A grep-based acceptance criterion is only meaningful if it **reads 0 (or fails) BEFORE the work is done**. Verify the current count first, in the same breath as writing the criterion.

Real examples from Phase 111/112 planning, all of which passed before any code was written and so proved nothing:

| Criterion | Why it was toothless |
|---|---|
| `grep -c "id: 11"` → `≥1` | `id: 11` already occurred **14** times in that spec's unrelated fixtures |
| `grep -c "mock.calls[1][0]"` → `≥1` | already occurred **4** times |
| `grep -c "Test G:"` → `1` | already occurred **6** times |

Three in two phases. The habit, not the individual mistakes, is the problem — a guard that cannot fail manufactures confidence instead of providing it, which is the same mechanism that let seven heatmap UI defects pass `tsc`, `vitest` AND `theme-guard` while rendering visibly broken.

**Rules:**
- Before committing to a grep criterion, run it. If it already passes, pick a different anchor (a new symbol name, a new test title, a new constant) and re-check.
- Prefer asserting on something the work *introduces* (`resolveInitialView`, `LONDON`, `H4:`) over something incidental that happens to appear near it.
- Some requirements are **not** automatically verifiable — "no visible flash", "the readout is legible", "colours read correctly in dark mode". Say so and route them to a `checkpoint:human-verify`. Do not dress an unprovable requirement in a grep that only looks rigorous. Expressing the *structural precondition* (e.g. "the view is a constructor argument; `setCenter`/`setZoom`/`.fit(` are absent") plus a human check is the honest pattern.
- If an executor finds a criterion that cannot discriminate, it should report it and verify the real requirement directly — never edit code to satisfy a broken check.

## Test gates
- Web: `cd packages/web && npx tsc --noEmit` clean; `npx vitest run` 100%; `npx vitest run src/styles/theme-guard.spec.ts` green.
- Server: `cd packages/server && npx tsc --noEmit` clean; server vitest is **SET-BASED** — failing files must be ⊆ the known `TD-V16-TEST-ISOLATION` set (cross-mode contamination that passes in isolation); never assert a fixed pass-count.
