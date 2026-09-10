---
phase: 07-frontend-auth-mode-awareness
plan: 04
subsystem: ui
tags: [react, oidc, sso, vitest, rtl, login, frontend-auth]

# Dependency graph
requires:
  - phase: 07-frontend-auth-mode-awareness
    provides: "API_BASE export from client.ts; useAuthStore.authMode field (Plan 07-03)"
  - phase: 07-frontend-auth-mode-awareness
    provides: "Vitest + jsdom + RTL + jest-dom test rig; zustand store-reset mock (Plan 07-02)"
  - phase: 05-oidc-module-routes
    provides: "GET /api/auth/oidc/start route — destination of the SSO link"
provides:
  - "LoginPage OIDC early-return branch: <a href={API_BASE+/api/auth/oidc/start}> with className=login-submit"
  - "Password form preserved unchanged for authMode in {password, null}"
  - "Session-expired banner renders in BOTH branches when reason==='session-expired'"
  - "11-test RTL spec locking all variants (OIDC / password / null fallback)"
affects: [07-frontend-auth-mode-awareness, 08-boot-wipe-hardening-runbook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Authoritative-state branching: render branch chosen from useAuthStore selector (authMode)"
    - "Pure <a href> for cross-origin / full-page-navigation flows (no onClick, no preventDefault)"
    - "Co-located component spec with explicit setAuth() helper + beforeEach defaults"

key-files:
  created:
    - "kinetica_bi/src/components/LoginPage.spec.tsx"
  modified:
    - "kinetica_bi/src/components/LoginPage.tsx"

key-decisions:
  - "OIDC early-return placed BEFORE handleSubmit + message declarations — avoids unused-variable warning in OIDC branch and keeps password-branch state colocated"
  - "Banner copy 'Your session has ended. Please sign in again.' literally duplicated in both branches (acceptable inline duplication; one banner per branch keeps each branch's JSX self-contained)"
  - "SSO link has NO onClick — return-to-page (UX-06) is captured at UNAUTHORIZED_EVENT in App.tsx, before LoginPage even renders"
  - "11 tests across 3 describe blocks chosen to lock every CONTEXT.md must-have: SSO href, link text, no-form-in-OIDC, login-submit class, banner gating both ways, password fields present, no-SSO-in-password, banner-above-form in password, null fallback"

patterns-established:
  - "Component spec layout: setAuth() helper at top, beforeEach explicit-defaults reset, describe blocks per branch — pattern for future LoginPage variants and other auth-aware components"
  - "Pure <a href> SSO link with reused .login-submit class — visual consistency without new CSS or new button class"

requirements-completed: [OIDC-01]

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase 07 Plan 04: LoginPage OIDC + Password Branching Summary

**LoginPage now renders an OIDC SSO `<a href>` link to `/api/auth/oidc/start` when `authMode === "oidc"`, falls through to the existing password form for `password`/`null`, with the session-expired banner preserved in both branches and locked by 11 RTL tests.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T18:43:30Z
- **Completed:** 2026-05-01T18:45:33Z
- **Tasks:** 2
- **Files modified:** 1 modified, 1 created

## Accomplishments

- OIDC early-return added to `LoginPage.tsx`: pure `<a href>` SSO link, no onClick, `className="login-submit"` (visual consistency with password button)
- Password form preserved byte-for-byte for `authMode === "password"` or `null` (safe default during boot)
- Session-expired banner renders in BOTH branches when `reason === "session-expired"` (Phase 7 SC4)
- New `LoginPage.spec.tsx` with 11 RTL tests across 3 describe blocks locking all variants
- Full frontend test suite green: 24/24 tests pass (sanity + auth + LoginPage)
- `npx tsc --noEmit` exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Add OIDC early-return branch to LoginPage.tsx** — `4d0a346` (feat)
2. **Task 2: Add LoginPage RTL component spec** — `bbd8bba` (test)

**Plan metadata:** _(pending final docs commit)_

## Files Created/Modified

- `kinetica_bi/src/components/LoginPage.tsx` — Added `import { API_BASE } from "../api/client"`, `authMode` selector from `useAuthStore`, and OIDC early-return branch (`if (authMode === "oidc")`) returning the SSO `<a>` link. Password form path preserved unchanged.
- `kinetica_bi/src/components/LoginPage.spec.tsx` (NEW) — 11 RTL tests across 3 describe blocks (OIDC mode, password mode, null fallback) covering SSO link href + text + class, password-form-absent in OIDC, banner gating in both branches, null-as-password-fallback.

## Decisions Made

- **`message` declaration positioned AFTER OIDC early-return** — the OIDC branch doesn't use `localError` or `error`, so declaring `const message = localError ?? error` inside the early-return-protected scope avoids any TypeScript unused-variable noise and keeps password-branch state localized.
- **Banner JSX literally duplicated in both branches** rather than hoisted into a shared `BannerSection` component — two-call duplication is below the abstraction-payoff threshold; both branches stay self-contained and one-glance readable.
- **SSO link has NO onClick** — return-to-page state is captured at the `UNAUTHORIZED_EVENT` hook in `App.tsx` (Phase 7 Plan 05 territory), BEFORE `LoginPage` mounts. By click time the work is already done. Pure `<a href>` keeps the link behavior browser-native (right-click new-tab, middle-click, ctrl-click all work).
- **`screen.getByRole("link", { name: /sign in with sso/i })`** chosen over `getByText` for the link assertion — accessible-name lookup is more semantically meaningful than text-content lookup and matches the role the user perceives.

## Deviations from Plan

None — plan executed exactly as written. Plan 07-04's `<action>` block specified the file content verbatim; both files match the plan spec byte-for-byte (modulo whitespace).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 07-05 ready**: `App.tsx` `UNAUTHORIZED_EVENT` handler + sessionStorage return-to-page hook (UX-06). Pre-existing local `App.tsx` and `Topbar.tsx` modifications visible in git status are NOT from Plan 07-04 — Plan 07-05's executor will reconcile those (or supersede them).
- **Phase 7 SC1 satisfied for the LoginPage layer**: `AUTH_MODE=oidc` shows "Sign in with SSO"; `AUTH_MODE=password` shows the existing form; same bundle, no rebuild.
- **OIDC-01 requirement complete**: SSO button on LoginPage exists, behaves per CONTEXT.md locks, locked by RTL tests.

## Self-Check: PASSED

- `kinetica_bi/src/components/LoginPage.tsx` exists and contains OIDC early-return with API_BASE + login-submit + "Sign in with SSO"
- `kinetica_bi/src/components/LoginPage.spec.tsx` exists with 3 describes + 11 it() blocks
- Commit `4d0a346` exists in git log
- Commit `bbd8bba` exists in git log
- `npx tsc --noEmit` exits 0
- `npm test` passes 24/24 tests
- `git grep -F "Sign in with SSO" kinetica_bi/src` matches LoginPage.tsx
- `git grep -F 'authMode === "oidc"' kinetica_bi/src/components` matches LoginPage.tsx

---
*Phase: 07-frontend-auth-mode-awareness*
*Plan: 04*
*Completed: 2026-05-01*
