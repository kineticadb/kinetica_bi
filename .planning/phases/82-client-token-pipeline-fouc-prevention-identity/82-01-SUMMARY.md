---
phase: 82-client-token-pipeline-fouc-prevention-identity
plan: "01"
subsystem: brand-pipeline
tags: [zustand, brand, css-tokens, broadcast-channel, fouc, client]
dependency_graph:
  requires: [Phase 81 — GET /api/branding server route]
  provides: [useBrandStore, fetchBranding, BrandStyleInjector, kbi-brand-tokens localStorage shape]
  affects: [App.tsx bootstrap sequence, document.title, :root CSS custom properties]
tech_stack:
  added: []
  patterns:
    - zustand create() mirroring theme.ts (no persist middleware, manual localStorage try/catch)
    - raw fetch unauthenticated GET (mirroring fetchAuthConfig pattern)
    - document.documentElement.style.setProperty/removeProperty for CSS token overrides
    - BroadcastChannel + window.focus refetch for cross-tab brand propagation
    - textContent injection for sanitized custom CSS (never innerHTML)
    - vi.hoisted() for module-level BroadcastChannel mock in jsdom
key_files:
  created:
    - packages/web/src/api/client.ts (BrandConfigPayload + BrandingResponse types + fetchBranding)
    - packages/web/src/store/brandStore.ts
    - packages/web/src/store/brandStore.spec.ts
    - packages/web/src/components/BrandStyleInjector.tsx
    - packages/web/src/components/BrandStyleInjector.spec.tsx
  modified:
    - packages/web/src/App.tsx (brand bootstrap + window.focus refetch + BrandStyleInjector mount)
decisions:
  - Used vi.hoisted() for BroadcastChannel mock because module-level new BroadcastChannel() runs at import time before vi.stubGlobal() executes
  - BroadcastChannel guard: typeof BroadcastChannel !== 'undefined' — jsdom has no BroadcastChannel; bare constructor throws
  - bootstrap() does NOT call notifyOtherTabs — initial load must not echo to other tabs
  - localStorage shape is { ...config, logoUrl } — includes all BrandConfigPayload keys + logoUrl for Plan 82-02 inline script
  - BrandStyleInjector mounted in all 3 App render branches so custom CSS applies pre-auth (login page)
metrics:
  duration: "766s"
  completed: "2026-06-24"
  tasks_completed: 3
  files_changed: 6
---

# Phase 82 Plan 01: brandStore Foundation + fetchBranding + BrandStyleInjector Summary

One-liner: Zustand brand store with unauthenticated GET /api/branding bootstrap, setProperty/removeProperty token application, kbi-brand-tokens localStorage cache (for FOUC script in 82-02), BroadcastChannel cross-tab propagation, and textContent custom CSS injector.

## What Was Built

### Task 1 — fetchBranding() + types in client.ts (commit 449a5fb)

Added after `fetchAuthConfig` (the established unauthenticated-GET pattern):

- `BrandConfigPayload` — all token override fields: dark + light variants for 8 colors, fontFamily, fontUrl, appName, customCss
- `BrandingResponse` — `{ config: BrandConfigPayload; logoUrl: string | null; updatedAt: string | null }`
- `fetchBranding()` — raw `fetch` (NOT `apiFetch`) with `credentials: "include"`; throws on `!response.ok`; never dispatches UNAUTHORIZED_EVENT

### Task 2 — brandStore.ts + spec (commits 59b60b4 RED, ecf0a62 GREEN)

`packages/web/src/store/brandStore.ts` mirrors `theme.ts` exactly:

- `BRAND_STORAGE_KEY = "kbi-brand-tokens"` — distinct from theme's `kinetica-bi-theme`
- `applyBrandTokens(config, theme)` — pure module function; DOM guard; `set()/removeProperty()` loop for 9 tokens:
  `--accent, --accent-2, --bg, --panel, --text, --muted, --border, --danger, --font-body`
  Uses `--font-body` (NOT `--font-family` — ARCHITECTURE.md was wrong; global.css uses `--font-body`)
- `bootstrap()` — async; raw fetchBranding → applyBrandTokens → document.title → injectFavicon → localStorage write → setState; silently swallows all errors
- `update(config, logoUrl)` — re-applies tokens + title + favicon + localStorage + notifyOtherTabs; implemented and tested (called only from Phase 83)
- BroadcastChannel guard: `typeof BroadcastChannel !== "undefined"` (jsdom safety)
- module-level theme subscription: `useThemeStore.subscribe(...)` re-applies dark/light variant on toggle
- **19/19 spec assertions green**

### localStorage Cache Shape (for Plan 82-02's inline script)

Every successful `bootstrap()` or `update()` writes:
```json
{
  "primaryColor": "...",    "lightPrimaryColor": "...",
  "accent2Color": "...",    "lightAccent2Color": "...",
  "bgColor": "...",         "lightBgColor": "...",
  "panelColor": "...",      "lightPanelColor": "...",
  "textColor": "...",       "lightTextColor": "...",
  "mutedColor": "...",      "lightMutedColor": "...",
  "borderColor": "...",     "lightBorderColor": "...",
  "dangerColor": "...",     "lightDangerColor": "...",
  "fontFamily": "...",      "fontUrl": "...",
  "appName": "...",         "customCss": "...",
  "logoUrl": "/api/branding/logo?v=<ts>"
}
```
All fields optional (`undefined`/`null` → field absent). The inline script in 82-02 reads this same shape.

### Task 3 — BrandStyleInjector.tsx + spec + App.tsx wiring (commit def3b9f)

- `BrandStyleInjector.tsx` — mounts `<style id="kbi-custom-css">` in `<head>` via `textContent` (never innerHTML); no `@scope` wrapping (Phase 83); returns null
- **6/6 spec assertions green**
- `App.tsx` changes:
  - `useBrandStore.getState().bootstrap()` fires in parallel with authStore bootstrap (imperative, mirrors initWmsCapabilities pattern)
  - `window.focus` refetch effect gated on `hasLoaded` (prevents double-bootstrap on initial load)
  - `<BrandStyleInjector />` mounted in ALL 3 render branches (loading, login, authenticated) so custom CSS applies pre-auth

## Token Slot List

| CSS Custom Property | BrandConfigPayload field (dark) | BrandConfigPayload field (light) |
|--------------------|---------------------------------|----------------------------------|
| `--accent`         | `primaryColor`                  | `lightPrimaryColor ?? primaryColor` |
| `--accent-2`       | `accent2Color`                  | `lightAccent2Color ?? accent2Color` |
| `--bg`             | `bgColor`                       | `lightBgColor ?? bgColor` |
| `--panel`          | `panelColor`                    | `lightPanelColor ?? panelColor` |
| `--text`           | `textColor`                     | `lightTextColor ?? textColor` |
| `--muted`          | `mutedColor`                    | `lightMutedColor ?? mutedColor` |
| `--border`         | `borderColor`                   | `lightBorderColor ?? borderColor` |
| `--danger`         | `dangerColor`                   | `lightDangerColor ?? dangerColor` |
| `--font-body`      | `fontFamily` (no light variant) | — |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.stubGlobal not hoisted — BroadcastChannel mock not active at brandStore module load**
- **Found during:** Task 2 GREEN phase
- **Issue:** The spec used `vi.stubGlobal("BroadcastChannel", ...)` which is NOT hoisted by vitest. When `brandStore.ts` is imported, its module-level `new BroadcastChannel(...)` fires BEFORE the stub, making `brandChannel` null and `notifyOtherTabs()` a no-op. The `update() calls postMessage` test failed (0 calls).
- **Fix:** Replaced `vi.stubGlobal` with `vi.hoisted(() => { class MockBroadcastChannel {...}; globalThis.BroadcastChannel = MockBroadcastChannel; })`. `vi.hoisted` is guaranteed to run before any module imports, so `brandChannel` is correctly constructed with the mock.
- **Files modified:** `packages/web/src/store/brandStore.spec.ts`

**2. [Rule 2 - Safety] Removed innerHTML from BrandStyleInjector.tsx comments**
- **Found during:** Task 3 acceptance criteria check
- **Issue:** The word "innerHTML" appeared in two JSDoc/inline comments. The plan's acceptance criterion `grep -c "innerHTML" BrandStyleInjector.tsx == 0` is a literal grep check.
- **Fix:** Reworded comments to not mention `innerHTML` by name.
- **Files modified:** `packages/web/src/components/BrandStyleInjector.tsx`

## Pre-existing Test Failures (Out of Scope)

The following test failures were observed in the full suite but are pre-existing and unrelated to this plan's files:
- `src/components/ColumnFormatEditorModal.spec.tsx` (1 failure)
- `src/components/DatasetsPage.spec.tsx` (1 failure)
- `src/components/RolesPage.spec.tsx` (1 failure — 18 permissions check)
- `src/components/charts/actionEngine.canary.spec.tsx` (4 failures)

None of these touch `client.ts`, `brandStore.ts`, `BrandStyleInjector.tsx`, or `App.tsx`.

## update() Status

`useBrandStore.update(config, logoUrl)` is fully implemented and tested (6 assertions in the spec). It is NOT called from any Phase 82 UI — the call site is the Phase 83 brand admin save action. This is intentional per the plan.

## Self-Check: PASSED

All created files confirmed on disk:
- packages/web/src/api/client.ts (modified)
- packages/web/src/store/brandStore.ts (created)
- packages/web/src/store/brandStore.spec.ts (created)
- packages/web/src/components/BrandStyleInjector.tsx (created)
- packages/web/src/components/BrandStyleInjector.spec.tsx (created)

All commits confirmed in git log:
- 449a5fb: Task 1 (fetchBranding + types)
- 59b60b4: Task 2 TDD RED (failing spec)
- ecf0a62: Task 2 TDD GREEN (brandStore implementation)
- def3b9f: Task 3 (BrandStyleInjector + App.tsx wiring)
