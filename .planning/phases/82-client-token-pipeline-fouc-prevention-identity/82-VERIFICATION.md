---
phase: 82-client-token-pipeline-fouc-prevention-identity
verified: 2026-06-24T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
re_verification: false
human_verification:
  - test: "Slow-3G hard reload with custom brand active — check no default-violet flash"
    expected: "Custom colors visible from the very first painted frame; Aurora purple never appears"
    why_human: "jsdom cannot measure first-paint timing or observe rendered CSS custom properties at the moment of paint; Slow-3G throttling requires a real browser DevTools Network panel"
  - test: "Favicon reflects the brand logo in the browser tab"
    expected: "After bootstrap completes, the browser tab favicon matches the uploaded logo, not the default Vite/Kinetica icon"
    why_human: "jsdom does not render favicon links visually; requires a real browser tab"
---

# Phase 82: Client Token Pipeline + FOUC Prevention + Identity — Verification Report

**Phase Goal:** Brand tokens flow server→browser at startup; the app never flashes the default Kinetica theme on load/reload; logo + app name + favicon are drawn from the brand store across every surface; an admin's brand change propagates live to other open tabs without a manual refresh.
**Verified:** 2026-06-24
**Status:** human_needed — all code/mechanism checks pass; 2 visual items are legitimately jsdom-untestable (Phase-84 UAT)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | FOUC mechanism: index.html inline IIFE reads `kbi-brand-tokens` + applies `setProperty` before module script | VERIFIED | Verified in `index.html` lines 20–50: brand block is a second `try/catch` inside the SAME IIFE as the theme block; `kbi-brand-tokens` at char 691, after `kinetica-bi-theme` at char 349; module script `<script type="module">` is in `<body>` (after `</head>`); `setProperty` loop present; `--font-body` used (not `--font-family`); `JSON.parse` and `rel = "icon"` both present; node verify prints `INDEX_OK` |
| 2 | Admin saves new color → other open tabs pick it up within seconds, no manual refresh | VERIFIED | `brandStore.ts` line 72–79: module-level `BroadcastChannel("kbi-brand-updated")` (guarded with `typeof BroadcastChannel !== "undefined"`); line 175–177: `brandChannel?.addEventListener("message", () => useBrandStore.getState().bootstrap())`; `update()` at line 167 calls `notifyOtherTabs()`; `App.tsx` lines 83–89: `window.focus` fallback gated on `hasLoaded` |
| 3 | Sidebar (expanded) shows logo as `<img>`; login page shows appName; Topbar excluded per CONTEXT.md | VERIFIED | `Sidebar.tsx` line 51: `<img src={logoUrl ?? DEFAULT_LOGO} alt={appName ?? "Kinetica BI"} className="logo-img">`; no `dangerouslySetInnerHTML`; `LoginPage.tsx` lines 29 and 63: `{appName ?? "Kinetica BI"}` in both OIDC and password branches; Topbar has 0 occurrences of brand string (no surface to wire — confirmed by grep) |
| 4 | `localStorage("kbi-brand-tokens")` populated after every authoritative fetch; inline script reads it before any stylesheet parses | VERIFIED | `brandStore.ts` lines 121–124: `localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ ...data.config, logoUrl: data.logoUrl }))` in `bootstrap()`; lines 153–157: same write in `update()`; both wrapped in inner `try/catch` (quota-safe); index.html brand block is inside `<head>` `<script>` — executes before `<body>` module script |

**Score: 4/4 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/store/brandStore.ts` | Zustand store: bootstrap, update, BroadcastChannel, theme subscription, BRAND_STORAGE_KEY | VERIFIED | 188 lines; contains `BroadcastChannel`, `setProperty`, `removeProperty`, `BRAND_STORAGE_KEY = "kbi-brand-tokens"`, `--font-body`, `document.title`, `typeof BroadcastChannel !== "undefined"` guard; no `--font-family` |
| `packages/web/src/api/client.ts` | `fetchBranding()` raw-fetch fn + `BrandingResponse` + `BrandConfigPayload` types | VERIFIED | Lines 128–157: `BrandConfigPayload`, `BrandingResponse`, `fetchBranding` using raw `fetch` (not `apiFetch`); `/api/branding` endpoint; `credentials: "include"` |
| `packages/web/src/components/BrandStyleInjector.tsx` | Custom CSS injection via `textContent` | VERIFIED | 30 lines; `el.textContent = customCss ?? ""`; 0 occurrences of `innerHTML`; returns null; imported in all 3 App render branches |
| `packages/web/index.html` | Extended inline FOUC guard applying brand tokens + font/favicon before first paint | VERIFIED | Brand block inside IIFE at lines 16–50; 9 token slots; `--font-body`; font/favicon `<link>` injection; cold-cache no-op pattern (`JSON.parse(... || "null")`) |
| `packages/web/src/assets/logo-default.svg` | Bundled default Kinetica logo, self-contained SVG | VERIFIED | 8 lines; `<svg>` present; uses `currentColor` (no hardcoded hex); no `xlink:href` or `<image href`; 120x32 viewBox K-mark wordmark |
| `packages/web/src/components/Sidebar.tsx` | Logo `<img>` (custom or default) + appName alt text, expanded state only | VERIFIED | Line 51: `<img src={logoUrl ?? DEFAULT_LOGO} alt={appName ?? "Kinetica BI"} className="logo-img">`; `useBrandStore` imported; `DEFAULT_LOGO` imported from `../assets/logo-default.svg`; 0 `dangerouslySetInnerHTML` |
| `packages/web/src/components/LoginPage.tsx` | appName-driven brand text in both auth branches | VERIFIED | Line 4: `useBrandStore` imported; line 11: `appName` selector; lines 29 + 63: `{appName ?? "Kinetica BI"}` in both OIDC and password branches |
| `packages/web/src/App.tsx` | Brand bootstrap in parallel with auth; BrandStyleInjector in all 3 render branches; window.focus fallback | VERIFIED | Line 77: `useBrandStore.getState().bootstrap()` in bootstrap effect; lines 83–89: focus effect with `hasLoaded` gate; lines 244, 248, 279: `<BrandStyleInjector />` in loading/login/authenticated branches |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `brandStore.ts` | `GET /api/branding` | `fetchBranding()` in `bootstrap()` | WIRED | Line 105: `const data: BrandingResponse = await fetchBranding()` |
| `brandStore.ts` | `document.documentElement.style` | `applyBrandTokens` `setProperty`/`removeProperty` loop | WIRED | Lines 41–49: 9 `set()` calls using `setProperty`/`removeProperty` helper |
| `App.tsx` | `useBrandStore.bootstrap()` | Imperative `getState().bootstrap()` in bootstrap useEffect + `<BrandStyleInjector />` + window.focus listener | WIRED | Line 77 bootstrap call; line 85 focus handler; lines 244/248/279 `<BrandStyleInjector />` mounts |
| `index.html` inline script | `document.documentElement.style` | `setProperty` loop over cached token slots | WIRED | Lines 36–38: `for` loop calling `root.style.setProperty` |
| `index.html` inline script | `localStorage("kbi-brand-tokens")` | `JSON.parse` synchronous read | WIRED | Line 21: `JSON.parse(localStorage.getItem("kbi-brand-tokens") \|\| "null")` |
| `Sidebar.tsx` | `useBrandStore (logoUrl, appName)` | Selector reads + `<img src={logoUrl ?? DEFAULT_LOGO}>` | WIRED | Lines 42–43: two selectors; line 51: `<img>` element |
| `LoginPage.tsx` | `useBrandStore (appName)` | `appName ?? "Kinetica BI"` in both branches | WIRED | Line 11: selector; lines 29 + 63: both render sites |
| `brandStore.ts update()` | `BroadcastChannel.postMessage` | `notifyOtherTabs()` call in `update()` | WIRED | Lines 77–79: `notifyOtherTabs` function; line 167: `notifyOtherTabs()` called in `update()` |
| `BroadcastChannel listener` | `useBrandStore.bootstrap()` | `brandChannel?.addEventListener("message", ...)` | WIRED | Lines 175–177: module-level listener re-invokes `bootstrap()` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BRANDFND-03 | 82-01-PLAN.md | Client fetches active brand at startup; applies via CSS custom properties; cross-tab propagation without hard refresh | SATISFIED | `brandStore.bootstrap()` + `BroadcastChannel` + `window.focus` all implemented and wired |
| BRANDFND-04 | 82-02-PLAN.md | Branding applied before first paint; no flash of default theme on load/reload | SATISFIED (mechanism) | index.html inline IIFE brand block reads `kbi-brand-tokens` synchronously before module script; cold-cache no-op documented and accepted; visual first-paint check is Phase-84 UAT |
| BRANDUI-01 | 82-03-PLAN.md | App name + brand logo used in sidebar, login, and favicon; Topbar excluded per CONTEXT.md locked decision | SATISFIED (within Phase 82 scope) | Sidebar `<img>`, LoginPage both branches, favicon via `injectFavicon()` in brandStore + index.html `<link rel=icon>` injection all wired; Topbar has no logo surface today and is excluded per 82-CONTEXT.md |

**Note on BRANDUI-01 and Topbar:** REQUIREMENTS.md lists "topbar" as a surface for BRANDUI-01. The 82-CONTEXT.md locked decision explicitly excludes Topbar from Phase 82. `Topbar.tsx` currently has no logo or brand surface at all (confirmed by grep — 0 occurrences of "logo", "brand", or "appName"). The requirement tracks Phase 82 as "Complete" in REQUIREMENTS.md, which reflects the reconciled ROADMAP scope. The Topbar logo slot (if ever desired) is a Phase-83/84 deferred item.

---

### Anti-Patterns Found

None detected. All scanned files are free of TODO/FIXME/HACK/PLACEHOLDER markers, empty implementations, and stub handlers.

| File | Pattern | Severity | Verdict |
|------|---------|----------|---------|
| `brandStore.ts` | `return` early on null config | Info | Intentional — compiled defaults win when no brand configured |
| `App.tsx` | `<div className="muted">Section coming soon.</div>` (settings page) | Info | Pre-existing, unrelated to Phase 82 |

---

### Human Verification Required

#### 1. Slow-3G first-paint: no default-violet FOUC

**Test:** In Chrome DevTools, open the app in an incognito tab that has previously loaded with a custom brand (so `kbi-brand-tokens` is in localStorage). Open Network tab, select Slow 3G throttling. Hard-reload (Cmd+Shift+R / Ctrl+Shift+R). Observe the first painted frames before React mounts.

**Expected:** Custom brand colors (not Aurora violet `#7b61ff`) visible from the very first painted frame. The inline IIFE fires synchronously before any stylesheet parses, so `:root` custom properties are already overridden before paint.

**Why human:** jsdom cannot measure first-paint timing, observe real CSS cascade resolution at the moment of paint, or simulate network throttling. The code mechanism is verified correct (inline script is in `<head>`, before `<body>` module script, reads localStorage synchronously), but the visual "no flash" outcome requires a real browser with Slow-3G DevTools.

#### 2. Favicon reflects brand logo in browser tab

**Test:** With a custom logo uploaded and brand bootstrapped, observe the browser tab favicon icon.

**Expected:** Tab favicon matches the uploaded brand logo (via the `<link rel="icon">` injected by `injectFavicon()` in brandStore and by the index.html IIFE from `brand.logoUrl`).

**Why human:** jsdom does not render or display favicon `<link>` elements visually. The code wiring is verified (`injectFavicon()` called in `bootstrap()` and `update()`; index.html IIFE injects `<link rel=icon>` from `brand.logoUrl`), but the visual outcome in the browser tab requires human observation.

---

### Gaps Summary

No gaps. All code mechanisms are verified against the actual codebase. The 2 human-needed items are legitimate jsdom limitations (first-paint timing and favicon visual rendering), explicitly scoped to Phase-84 UAT in both 82-02-PLAN.md and 82-03-SUMMARY.md.

---

**Commits verified:**
- `449a5fb` — fetchBranding + types in client.ts
- `59b60b4` — brandStore spec TDD RED
- `ecf0a62` — brandStore implementation GREEN
- `def3b9f` — BrandStyleInjector + App.tsx wiring
- `966ad88` — index.html FOUC brand block
- `37b367b` — logo-default.svg
- `8707085` — Sidebar + LoginPage identity wiring
- `ae50f80` — Sidebar.spec.tsx img-role assertions

All 8 commits confirmed present in git history.

---

_Verified: 2026-06-24_
_Verifier: Claude (gsd-verifier)_
