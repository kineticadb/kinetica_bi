---
phase: 82-client-token-pipeline-fouc-prevention-identity
plan: "03"
subsystem: brand-pipeline
tags: [react, zustand, brand, identity, svg, img, sidebar, login]

requires:
  - phase: 82-01
    provides: useBrandStore with appName + logoUrl selectors
provides:
  - packages/web/src/assets/logo-default.svg (bundled default Kinetica logo, Vite asset URL)
  - Sidebar renders logo <img> (custom logoUrl or DEFAULT_LOGO fallback) with appName alt text
  - LoginPage both branches (OIDC + password) use appName from brand store
  - No hardcoded "Kinetica BI" text nodes in Sidebar.tsx or LoginPage.tsx
  - Sidebar.spec.tsx updated to seed brand store and assert img role
affects: [83-branding-admin-ui, 84-verification-live-uat]

tech-stack:
  added: []
  patterns:
    - "Vite asset URL import: import DEFAULT_LOGO from '../assets/logo-default.svg' returns URL string"
    - "Brand store selector reads at component level: useBrandStore((s) => s.logoUrl)"
    - "Fallback pattern: logoUrl ?? DEFAULT_LOGO for src; appName ?? 'Kinetica BI' for alt/text"
    - "Test seeding: useBrandStore.setState({ appName, logoUrl }) in beforeEach"
    - "Role-based assertion: screen.getByRole('img', { name: appName }) instead of getByText"

key-files:
  created:
    - packages/web/src/assets/logo-default.svg
  modified:
    - packages/web/src/components/Sidebar.tsx
    - packages/web/src/components/Sidebar.spec.tsx
    - packages/web/src/components/LoginPage.tsx

key-decisions:
  - "Default logo SVG uses currentColor fill and 120x32 viewBox so it works on any sidebar surface without hardcoded hex"
  - "Sidebar spec seeds useBrandStore with { appName: 'Kinetica BI', logoUrl: null } to keep alt text deterministic and exercise the DEFAULT_LOGO fallback path"
  - "appName ?? 'Kinetica BI' fallback string in alt attribute and login-brand text is brand-store-driven (not a hardcoded text node), consistent with plan spec"
  - "Topbar intentionally left unchanged per locked CONTEXT.md decision"

patterns-established:
  - "Logo-as-img: all brand logo rendering uses <img src> only — never inline SVG or dangerouslySetInnerHTML"
  - "Brand store seeding in specs: useBrandStore.setState() in beforeEach to control logoUrl/appName state"

requirements-completed: [BRANDUI-01]

duration: 15min
completed: 2026-06-24
---

# Phase 82 Plan 03: App Identity Wiring Summary

**Brand logo rendered as `<img>` (custom or bundled DEFAULT_LOGO) in Sidebar expanded state; both LoginPage branches use `appName` from useBrandStore; Sidebar.spec updated with brand store seeding and img-role assertions; no hardcoded "Kinetica BI" text nodes remain in component files.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-24T14:00:00Z
- **Completed:** 2026-06-24T14:10:00Z
- **Tasks:** 3
- **Files modified:** 4 (created: logo-default.svg; modified: Sidebar.tsx, Sidebar.spec.tsx, LoginPage.tsx)

## Accomplishments
- Created `packages/web/src/assets/logo-default.svg` — K-mark wordmark SVG using `currentColor`, 120x32 viewBox, no hardcoded hex, self-contained
- Wired `Sidebar.tsx` to render `<img src={logoUrl ?? DEFAULT_LOGO} alt={appName ?? "Kinetica BI"} className="logo-img">` in the expanded state `{!collapsed && ...}` block
- Wired both `LoginPage.tsx` login-brand divs (OIDC branch + password branch) to `{appName ?? "Kinetica BI"}`
- Updated `Sidebar.spec.tsx`: added `useBrandStore` import, brand seed in `beforeEach`, rewrote the two "Kinetica BI" text assertions to `getByRole("img")` / `queryByRole("img")`, added custom logo test asserting `src` attribute

## Task Commits

Each task was committed atomically:

1. **Task 1: Create bundled default logo asset** - `37b367b` (feat)
2. **Task 2: Wire Sidebar logo + LoginPage appName to useBrandStore** - `8707085` (feat)
3. **Task 3: Update Sidebar.spec.tsx for the logo img** - `ae50f80` (feat)

## Files Created/Modified
- `packages/web/src/assets/logo-default.svg` - Bundled default Kinetica K-mark wordmark SVG (currentColor, 120x32, self-contained; Vite imports as URL string)
- `packages/web/src/components/Sidebar.tsx` - Added useBrandStore + DEFAULT_LOGO imports; replaced text div with `<img>` in expanded state
- `packages/web/src/components/Sidebar.spec.tsx` - Imported useBrandStore; seeded brand store in beforeEach; replaced text assertions with img-role assertions; added custom logo src test
- `packages/web/src/components/LoginPage.tsx` - Added useBrandStore import + appName selector; replaced both `.login-brand` "Kinetica BI" literals with `{appName ?? "Kinetica BI"}`

## Decisions Made
- Default logo SVG uses `currentColor` for fill so it reads correctly on the dark sidebar surface without introducing any hex literals (theme-guard compliance)
- Spec seeds `logoUrl: null` in beforeEach to exercise the DEFAULT_LOGO fallback code path; the `alt` remains `"Kinetica BI"` so existing role-name queries are stable
- Topbar.tsx confirmed clean (no brand string) and intentionally left unchanged per locked CONTEXT.md decision

## Deviations from Plan

None — plan executed exactly as written. The `alt={appName ?? "Kinetica BI"}` fallback string appearing in grep counts was expected per the plan spec (the plan explicitly shows this exact code); it is an expression value, not a hardcoded text node.

## Issues Encountered

None. tsc clean, theme-guard green (108/108), full vitest suite 2700/2700 (114 files).

## Topbar Exclusion Confirmed

`grep -c "Kinetica BI" packages/web/src/components/Topbar.tsx` → 0. Topbar has no brand string and was not modified.

## Next Phase Readiness
- BRANDUI-01 complete: logo + app name flow from brand store into sidebar + login page
- Phase 83 (Branding Admin UI) can now wire the admin save path to `useBrandStore.update()` (implemented in 82-01)
- Phase 84 verification: favicon render in browser tab (UAT only, not jsdom-testable)

---
*Phase: 82-client-token-pipeline-fouc-prevention-identity*
*Completed: 2026-06-24*
