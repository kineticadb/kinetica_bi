---
phase: 81-brand-config-server-foundation
plan: 03
subsystem: server-api
tags: [postcss, css-sanitization, xss-prevention, unicode-escape, branding, oidc, auth-modes]

# Dependency graph
requires:
  - sanitizeCssPostcss() (this plan — brandCssSanitizer.ts)
  - PUT /api/branding NOTE placeholder (81-02)
  - postcss@8.5.15 installed (81-02)
provides:
  - sanitizeCssPostcss() — PostCSS AST walk strips url()/@import/@font-face/expression()/javascript:/behavior/-moz-binding, 64KB cap, unicode-escape bypass closed
  - PUT /api/branding customCss sanitized BEFORE storage (defense before write)
  - lib.brandCssSanitizer.spec.ts — 12 unit tests: all attack vectors + legitimate-CSS preservation + unicode-escape bypass
  - routes.branding.spec.ts extended — 3 CSS integration tests + AUTH_MODE=oidc smoke block (1 test)
affects: [83]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PostCSS AST walk: sanitize via node.remove() only — output is always root.toString(), never a regex-replaced string"
    - "CSS unicode-escape pre-resolution: resolveCssUnicodeEscapes() normalizes declaration values before pattern-matching (PostCSS does NOT canonicalize in declaration values at parse time)"
    - "Defense before write: customCss sanitized in PUT handler BEFORE db.prepare().run() call"
    - "OIDC smoke block: vi.hoisted() openid-client mock at spec file top + resetOidcClientForTests() in beforeEach — matches routes.dynamic-view-drop.spec.ts pattern exactly"

key-files:
  created:
    - packages/server/src/lib/brandCssSanitizer.ts
    - packages/server/tests/lib.brandCssSanitizer.spec.ts
  modified:
    - packages/server/src/index.ts
    - packages/server/tests/routes.branding.spec.ts

key-decisions:
  - "PostCSS does NOT canonicalize unicode escapes in declaration values at parse time (research doc claim was inaccurate for postcss@8 value nodes); resolveCssUnicodeEscapes() helper resolves CSS \\HEX{1-6} sequences before pattern-matching to close the u\\72l( bypass without regex-stripping the CSS output"
  - "sanitizeCssPostcss output is always root.toString() — the CSS document is mutated only via node.remove() in the AST walk; no regex replacement of CSS content"
  - "@scope wrapping deferred to Phase 83 — server stores PostCSS-sanitized string verbatim"

requirements-completed: [CSS-V116-02, SECA-V116-01]

# Metrics
duration: 6min
completed: 2026-06-24
---

# Phase 81 Plan 03: CSS Sanitizer + Integration Tests Summary

**PostCSS AST walk sanitizer wired into PUT /api/branding (defense before write); unicode-escape bypass closed via CSS escape pre-resolution; 30 tests green including CSS integration tests and AUTH_MODE=oidc smoke**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-24T16:47:14Z
- **Completed:** 2026-06-24T16:53:00Z
- **Tasks:** 2
- **Files modified:** 4 (brandCssSanitizer.ts created, lib.brandCssSanitizer.spec.ts created, index.ts modified, routes.branding.spec.ts extended)

## Accomplishments

- Created `packages/server/src/lib/brandCssSanitizer.ts` exporting `sanitizeCssPostcss()`: PostCSS AST walk that strips `url()`, `@import`, `@charset`, `@font-face`, `@namespace`, `expression()`, `javascript:`, `behavior`, `-moz-binding` from custom CSS; 64 KB input cap; returns `""` for empty/invalid input without throwing
- Added `resolveCssUnicodeEscapes()` helper to normalize CSS unicode escapes (e.g. `u\72l(` → `url(`) in declaration values before pattern-matching — postcss@8 does NOT resolve these in value nodes at parse time, so without this step the unicode-escape bypass (`u\72l(https://attacker.com)`) survives
- Wired `sanitizeCssPostcss(configObj.customCss)` into `PUT /api/branding` BEFORE the `db.prepare("UPDATE brand_config ...")` write — defense before write, not at render
- Created `packages/server/tests/lib.brandCssSanitizer.spec.ts`: 12 unit tests covering all attack vectors (url(), @import, expression(), @font-face, -moz-binding, behavior), legitimate-CSS preservation (letter-spacing, var(--accent), @keyframes), unicode-escape bypass, edge cases (empty input, invalid CSS, 64KB cap)
- Extended `routes.branding.spec.ts` with 3 CSS integration tests (url() exfiltration removed, @import stripped while `color: red` preserved, expression() stripped) proven via PUT→GET round-trip
- Added `AUTH_MODE=oidc smoke` describe block: hoisted `openid-client` mock (same pattern as routes.dynamic-view-drop.spec.ts) + `resetOidcClientForTests()` in beforeEach; confirms `GET /api/branding` returns 200 unauthenticated in OIDC mode (completes SECA-V116-01 both-auth-mode coverage)
- 30 total tests green across both spec files; tsc clean; full suite SET-BASED gate holds (routes.branding.spec.ts and lib.brandCssSanitizer.spec.ts not among failures)

## Task Commits

1. **Task 1: Create brandCssSanitizer.ts + unit spec** — `53e8d50` (feat)
2. **Task 2: Wire sanitizer into PUT + CSS integration tests + OIDC smoke** — `e334901` (feat)

## Files Created/Modified

- `packages/server/src/lib/brandCssSanitizer.ts` — NEW: `sanitizeCssPostcss()` with PostCSS AST walk + `resolveCssUnicodeEscapes()` helper
- `packages/server/tests/lib.brandCssSanitizer.spec.ts` — NEW: 12 unit tests
- `packages/server/src/index.ts` — import added + NOTE comment replaced with real sanitization call (3 lines)
- `packages/server/tests/routes.branding.spec.ts` — hoisted openid-client mock + resetOidcClientForTests import + 3 CSS integration tests + oidc smoke describe block

## Decisions Made

- **PostCSS does not canonicalize unicode escapes in declaration values** (confirmed by direct test against postcss@8): the RESEARCH.md claim "PostCSS resolves unicode escapes at parse time so the walker sees canonical url(" is inaccurate for value nodes. `u\72l(https://attacker.com)` comes through the AST unchanged. Closed by adding `resolveCssUnicodeEscapes()` which applies the CSS Syntax Level 3 `\HEX{1-6}` normalization to the value string before pattern-matching. The CSS output itself is NOT regex-replaced — still `root.toString()` after `node.remove()` calls.
- **sanitizeCssPostcss output is always root.toString()** — the acceptance criterion `grep -c ".replace(" == 0` was designed to rule out regex-stripping of CSS content (which can be bypassed); the `resolveCssUnicodeEscapes().replace()` is a pre-processing normalization on the value string only, not an output transformation.
- **@scope wrapping stays deferred to Phase 83** — server stores PostCSS-sanitized CSS verbatim, as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CSS unicode-escape bypass not closed by PostCSS at parse time**
- **Found during:** Task 1 TDD GREEN phase (unit test `u\72l() unicode-escape bypass` failed)
- **Issue:** postcss@8 preserves raw declaration values including CSS unicode escapes (`u\72l(`) without resolving them. The RESEARCH.md claim that "PostCSS resolves unicode escapes during parse so the AST walker sees canonical url(" is inaccurate for declaration value nodes. The `u\72l(https://attacker.com)` test case produced `"body { background: u\72l(https://attacker.com) }"` from `root.toString()` — the attack host survived.
- **Fix:** Added `resolveCssUnicodeEscapes(s: string): string` function that resolves CSS `\HEX{1-6}` escape sequences in declaration values before BLOCKED_VALUE_PATTERNS matching. This normalizes `u\72l(` to `url(` so the `/\burl\s*\(/i` pattern fires correctly. The CSS output is still produced by `root.toString()` after AST-based `node.remove()` — no regex strip of CSS content.
- **Files modified:** `packages/server/src/lib/brandCssSanitizer.ts`
- **Commit:** `53e8d50`

## Self-Check: PASSED

- `packages/server/src/lib/brandCssSanitizer.ts` — FOUND
- `packages/server/tests/lib.brandCssSanitizer.spec.ts` — FOUND
- `.planning/phases/81-brand-config-server-foundation/81-03-SUMMARY.md` — FOUND
- commit `53e8d50` — FOUND
- commit `e334901` — FOUND
