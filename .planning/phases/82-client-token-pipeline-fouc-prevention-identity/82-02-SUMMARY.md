---
phase: 82-client-token-pipeline-fouc-prevention-identity
plan: "02"
subsystem: fouc-prevention
tags: [fouc, inline-script, brand-tokens, css-custom-properties, localStorage, favicon, font]

requires:
  - phase: 82-01
    provides: "kbi-brand-tokens localStorage shape ({...BrandConfigPayload, logoUrl}) written by brandStore.bootstrap()/update()"
provides:
  - "Extended index.html inline IIFE that reads kbi-brand-tokens synchronously and applies brand CSS custom properties before first paint"
  - "Font <link> injection from cached fontUrl so font download starts before React mounts"
  - "Favicon <link> injection from cached logoUrl"
affects: [Phase 84 — UAT slow-3G first-paint check, 82-03 (no technical dependency but same phase)]

tech-stack:
  added: []
  patterns:
    - "Two-try/catch-blocks in one IIFE: theme block first (resolves `t`), brand block second (uses `t` for dark/light variant)"
    - "Cold-cache no-op: JSON.parse(getItem() || 'null') — null guard means absent key is safe without extra checks"
    - "Vanilla ES5 only in inline script: var, for-loop, no arrow/let/const/optional-chaining"

key-files:
  created: []
  modified:
    - packages/web/index.html

key-decisions:
  - "Brand block placed INSIDE the same IIFE as the theme block so var t is in scope for dark/light token variant selection"
  - "Cold-cache (no kbi-brand-tokens): block is a complete no-op — one frame of Aurora default is the documented accepted behavior"
  - "Uses --font-body (NOT --font-family) — matches global.css Phase-80 token name; ARCHITECTURE.md was wrong about the token name"
  - "fontLink and iconLink appended to document.head synchronously, before module script loads"

patterns-established:
  - "IIFE extension pattern: add new try/catch after existing try/catch inside the same IIFE to reuse already-resolved variables"

requirements-completed: [BRANDFND-04]

duration: 4min
completed: "2026-06-24"
---

# Phase 82 Plan 02: FOUC Prevention — Inline IIFE Brand Token Extension Summary

**Inline `<head>` IIFE extended with a second try/catch block that synchronously reads `kbi-brand-tokens` from localStorage and applies 9 brand CSS custom properties + injects font/favicon `<link>` elements before first paint, with cold-cache no-op safety.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-24T18:02:55Z
- **Completed:** 2026-06-24T18:06:49Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Extended the existing 9-line dark/light FOUC guard in `packages/web/index.html` by adding the brand token block inside the same IIFE
- Brand block applies 9 CSS custom property overrides (`--accent`, `--accent-2`, `--bg`, `--panel`, `--text`, `--muted`, `--border`, `--danger`, `--font-body`) using `setProperty` on `:root`
- Light vs dark token variant selected via the already-resolved `var t` from the preceding theme block
- Font `<link rel=stylesheet>` injected from `brand.fontUrl` when present — starts font download before React mounts
- Favicon `<link rel=icon>` injected from `brand.logoUrl` when present — uses the URL persisted by `brandStore.bootstrap()`
- All gates green: `INDEX_OK` from node verify, `npx vitest run` 2699/2699 passed, `npm run build` clean

## Inline Script Final Structure

```javascript
(function () {
  // BLOCK 1 (existing, unchanged): dark/light theme guard
  try {
    var t = localStorage.getItem("kinetica-bi-theme");
    if (t !== "light" && t !== "dark") t = "dark";
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
  } catch (e) {}

  // BLOCK 2 (new): brand token + font + favicon guard
  // t is in scope (already resolved to "light" or "dark")
  // Cold-cache: absent key → JSON.parse("null") → null → if-guard is false → no-op
  try {
    var brand = JSON.parse(localStorage.getItem("kbi-brand-tokens") || "null");
    if (brand && typeof brand === "object") {
      // ... setProperty loop + fontLink + iconLink ...
    }
  } catch (e) {}
})();
```

## Task Commits

1. **Task 1: Extend inline IIFE with brand-token + font + favicon block** - `966ad88` (feat)

## Files Created/Modified

- `packages/web/index.html` — IIFE extended with brand token block (35 lines added)

## Decisions Made

- Brand block goes inside the SAME IIFE as the theme block so `var t` is already in scope — no need to re-read localStorage for the theme.
- Cold-cache safety: `JSON.parse(getItem("kbi-brand-tokens") || "null")` means the absent-key case returns `null` and the `if (brand && typeof brand === "object")` guard makes the entire block a safe no-op. No error is thrown, no property is set.
- Used `--font-body` (not `--font-family`) — confirmed by reading `packages/web/src/styles/global.css` directly; matches the 82-01 `brandStore.applyBrandTokens` implementation.
- The `<title>Kinetica BI</title>` static tag was NOT changed (82-03 owns the runtime `document.title` override via `brandStore.bootstrap()`).

## Deviations from Plan

None — plan executed exactly as written. The brand block added verbatim matches the RESEARCH.md specification.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- FOUC prevention complete for warm-cache loads: brand tokens, font, and favicon all applied synchronously before paint
- 82-03 (identity wiring: Sidebar logo/appName, LoginPage appName, Sidebar.spec.tsx updates) is unblocked
- Phase 84 UAT will verify the slow-3G first-paint no-FOUC behavior in a real browser with network throttling — this cannot be automated in jsdom

## Self-Check: PASSED

Files confirmed:
- `packages/web/index.html` exists and contains `kbi-brand-tokens`, `--font-body`, `setProperty`, `rel = "icon"`, `JSON.parse`
- `grep -c "--font-family" packages/web/index.html` = 0 (correct token name used)
- `node -e` verify command prints `INDEX_OK`

Commit confirmed:
- `966ad88` exists in git log

---
*Phase: 82-client-token-pipeline-fouc-prevention-identity*
*Completed: 2026-06-24*
