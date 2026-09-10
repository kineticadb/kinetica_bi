---
phase: 80-token-foundation-aurora-default-theme
plan: 02
subsystem: ui
tags: [css-tokens, design-system, theming, aurora, fonts, fontsource, hex-mesh, accent-text, gdpr]

# Dependency graph
requires: [80-01]
provides:
  - Self-hosted Manrope Variable + Space Grotesk Variable via @fontsource-variable (no Google CDN)
  - --font-body / --font-display wired to Variable family names in global.css
  - Hex-mesh + aurora-glow body treatment (vivid dark / subtle branded light)
  - Space Grotesk applied to display headings (logo, KPI values, widget/modal titles)
  - Two-tier accent-text applied to all persistent accent text/numbers/icons
  - Filter-bar chip migrated from green to violet Aurora palette
affects: [82, 83]

# Tech tracking
tech-stack:
  added:
    - "@fontsource-variable/manrope@5.2.8 (WOFF2 variable font, wght axis 300-800)"
    - "@fontsource-variable/space-grotesk@5.2.10 (WOFF2 variable font, wght axis 300-700)"
  patterns:
    - "Self-hosted variable fonts: import wght.css in main.tsx ABOVE global.css; family name is '<Name> Variable' not '<Name>'"
    - "Hex-mesh via inline SVG data-URI in background shorthand; background-attachment:fixed for fixed-position mesh"
    - "Two-tier accent: var(--accent) fills only; var(--accent-text) for all persistent text/number/icon accent coloring"
    - "Light mode retains hex mesh + faint violet glow — branded, not a flat generic light theme"

key-files:
  created: []
  modified:
    - packages/web/package.json
    - packages/web/package-lock.json
    - packages/web/src/main.tsx
    - packages/web/index.html
    - packages/web/src/styles/global.css

key-decisions:
  - "Variable font family names: 'Manrope Variable' and 'Space Grotesk Variable' — non-variable name silently falls back to system font"
  - "Hex-mesh as inline SVG data-URI (same technique as direction-A-aurora.html mockup); stroke is a geometric literal, pragmatized"
  - "background-attachment:fixed so mesh doesn't scroll with content (matches mockup behavior)"
  - "Display font applied to: logo wordmark, .kpi-value big numbers, .widget-title, .modal-title, .login-brand, .login-title"
  - "Hover interaction affordances (sidebar-toggle:hover, theme-toggle:hover, etc.) left as --accent; only persistent text switched to --accent-text"
  - "Filter-bar chip green rgba tint replaced with violet rgba (Aurora brand migration, auto-fixed Rule 1)"
  - "Light mode hex mesh uses violet stroke at opacity 0.06 (vs white 0.035 in dark) — branded presence without overpowering warm off-white canvas"

patterns-established:
  - "Aurora body treatment: hex-mesh SVG + 3-stop aurora radial gradients + var(--bg); same pattern in dark (vivid) and light (faint)"

requirements-completed: [THEME-V116-01, THEME-V116-02, TOKENS-V116-04]

# Status
status: checkpoint-pending (visual verification Task 3 awaiting human sign-off)

# Metrics
duration: ~15min
completed: 2026-06-23
---

# Phase 80 Plan 02: Aurora Visual Polish Summary

**Self-hosted Manrope Variable + Space Grotesk Variable via @fontsource-variable (no Google Fonts CDN), hex-mesh + aurora-glow body treatment matching direction-A-aurora.html, Space Grotesk on display headings, and two-tier --accent-text applied across all accent text surfaces — dark vivid, light branded-subtle**

## Status: CHECKPOINT PENDING

Task 3 (visual verification) is awaiting human sign-off. The automated test gates are all green. Resume with "approved" once the visual check passes.

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-23T17:17:58Z
- **Tasks:** 2 of 3 (Task 3 = human checkpoint)
- **Files modified:** 5

## Accomplishments

- Installed `@fontsource-variable/manrope@5.2.8` + `@fontsource-variable/space-grotesk@5.2.10`
- Added `wght.css` imports to `main.tsx` above `global.css` (registers @font-face before cascade)
- Removed all 3 Google Fonts `<link>` tags from `index.html` — zero CDN request at runtime; FOUC guard untouched
- Updated `--font-body: "Manrope Variable"` and `--font-display: "Space Grotesk Variable"` (avoids silent system-font fallback)
- Applied hex-mesh SVG layer + tuned 3-stop aurora radial glows to `body` background; `background-attachment: fixed`
- Light mode `body`: same hex mesh at lower opacity (violet stroke 0.06) + faint violet glow — retains brand character
- Applied `font-family: var(--font-display)` to: `.logo`, `.kpi-value`, `.widget-title`, `.modal-title`, `.login-brand`, `.login-title`
- Two-tier accent migration: `.text-accent`, `.kpi-delta.up`, `.config-group-label`, `.config-sql-code`, `.filter-bar-chip`, `.filter-bar-chip-dismiss`, `.login-brand`, `.config-cardinality-warn`, `.view-status-badge.materialized`, `.datafilter-applied-badge`, `.users-bulk-label` → all switched from `var(--accent)` to `var(--accent-text)`
- Fixed `filter-bar-chip` stale green rgba tints → violet Aurora palette `rgba(127,64,237,0.14/0.30)`

## Task Commits

Each task was committed atomically:

1. **Task 1: Self-host both fonts + wire Variable family names + remove Google CDN** - `ca91775` (feat)
2. **Task 2: Aurora visual polish — hex mesh, display font, two-tier accent-text** - `db0266c` (feat)
3. **Task 3: Visual verification checkpoint** - PENDING (awaiting human sign-off)

## Files Created/Modified

- `packages/web/package.json` — Added `@fontsource-variable/manrope` + `@fontsource-variable/space-grotesk`
- `packages/web/src/main.tsx` — Font imports above global.css
- `packages/web/index.html` — 3 Google Fonts links removed; FOUC guard preserved
- `packages/web/src/styles/global.css` — `--font-body`/`--font-display` updated to Variable names; hex-mesh + aurora body treatment; display font on headings; two-tier accent-text applied; filter chip migrated to violet

## Decisions Made

- Variable font family name must be `"Manrope Variable"` / `"Space Grotesk Variable"` — the fontsource variable packages register under these names (not `"Manrope"` / `"Space Grotesk"`)
- Hover interaction highlights (sidebar-toggle:hover, theme-toggle:hover, etc.) left as `--accent` — transient interactive affordance, not persistent text content; two-tier rule applies to persistent text only
- Filter-bar chip green rgba was a leftover from the green-anchored era — auto-migrated to violet per Aurora palette (Rule 1 deviation)
- Light mode hex mesh uses violet `%237f40ed` stroke at `stroke-opacity='0.06'` — visible branded presence without overpowering warm off-white

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Filter-bar chip had stale green rgba tints**
- **Found during:** Task 2 two-tier accent audit
- **Issue:** `.filter-bar-chip` background was `rgba(34, 197, 94, 0.12)` (NVIDIA green) and border `rgba(34, 197, 94, 0.35)` — a leftover from the pre-Aurora green-anchored theme
- **Fix:** Replaced with `rgba(127, 64, 237, 0.14)` and `rgba(127, 64, 237, 0.30)` matching the Aurora chip style in `direction-A-aurora.html`
- **Files modified:** `packages/web/src/styles/global.css`
- **Commit:** `db0266c` (included in Task 2)

## Test Gates

- `npx tsc --noEmit` — CLEAN
- `npx vitest run` — 112/112 files, 2672/2672 tests PASS (2 pre-existing unhandled 401 rejections from InfoCardRenderer when server not running — not caused by this plan)
- Theme-guard (extended structural) — 106/106 GREEN

## Self-Check: PASSED

- `packages/web/package.json` EXISTS with `@fontsource-variable/manrope` + `@fontsource-variable/space-grotesk`
- `packages/web/src/main.tsx` EXISTS with both wght.css imports above global.css
- `packages/web/index.html` EXISTS with FOUC guard; Google Fonts links absent
- `packages/web/src/styles/global.css` EXISTS with Variable family names + hex-mesh body + accent-text
- Commit `ca91775` EXISTS (Task 1)
- Commit `db0266c` EXISTS (Task 2)
- `grep '"Manrope Variable"' global.css` PASSES
- `grep '"Space Grotesk Variable"' global.css` PASSES
- `! grep 'fonts.googleapis' index.html` PASSES
- `grep 'var(--font-display)' global.css` PASSES
- `grep 'var(--accent-text)' global.css` PASSES
- `npx tsc --noEmit` CLEAN
- `npx vitest run` 112/112 PASS

---
*Phase: 80-token-foundation-aurora-default-theme*
*Checkpoint pending: 2026-06-23*
