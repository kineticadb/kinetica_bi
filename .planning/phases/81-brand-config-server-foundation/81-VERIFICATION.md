---
phase: 81-brand-config-server-foundation
verified: 2026-06-24T17:10:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "Live curl: GET /api/branding with no session cookie returns 200 JSON"
    expected: "HTTP 200, JSON body with `config` and `logoUrl` keys, Cache-Control no-cache,no-store"
    why_human: "Supertests cover HTTP-level behavior (confirmed green); this is deferred to Phase 84 milestone UAT live walk-through"
  - test: "Logo renders as <img> in the actual UI (not inline SVG / dangerouslySetInnerHTML)"
    expected: "Topbar, sidebar, login page all render uploaded logo via <img src='/api/branding/logo?v=...'>, never via innerHTML"
    why_human: "Client rendering is Phase 82 work; server stores bytes and serves them — server-side proof is in place (nosniff + <img> contract documented). Live render check deferred to Phase 84 UAT."
---

# Phase 81: Brand Config Server Foundation — Verification Report

**Phase Goal:** The server-side brand persistence layer exists and is hardened — the branding API routes are live, the 18th permission gates writes, the login page can fetch brand before authentication, and logo + custom CSS save paths are sanitized against XSS/exfiltration vectors before any client code touches them.

**Verified:** 2026-06-24T17:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `GET /api/branding` returns 200 + JSON with no session (unauthenticated), with Cache-Control: no-cache, no-store | VERIFIED | Mounted at index.ts:416 BEFORE `app.use("/api", requireAuth)` at line 590; sets `no-cache, no-store` header; supertest covers both behaviors (tests 1 + 2) |
| 2 | `PUT /api/branding` without `branding:manage` → 403; with admin → saves + GET reflects it | VERIFIED | `requirePermission(PERMISSIONS.BRANDING_MANAGE)` at index.ts:598; supertest: no-session 401, analyst 403 PERMISSION_DENIED, admin 200 + subsequent GET returns updated appName |
| 3 | SVG with `<script>` is stripped before storage — including mislabeled SVG (SVG bytes declared as image/png) | VERIFIED | `looksSvg` content-sniff at index.ts:650 runs BEFORE any MIME check; DOMPurify sanitization unconditional for content-sniffed SVG; supertest test 13 (honest SVG) and test 14 (mislabeled bypass) both assert `decoded.not.toContain("<script")` and `logo_mime === "image/svg+xml"` |
| 4 | Custom CSS with `url()` / `@import` stored sanitized via PostCSS AST (NOT regex); unicode-escape bypass `u\72l(` neutralized | VERIFIED | `sanitizeCssPostcss()` in brandCssSanitizer.ts uses `postcss.parse()` + `root.walk()` + `node.remove()`; `resolveCssUnicodeEscapes()` pre-normalizes declaration values before pattern matching; output is always `root.toString()` (no regex strip); 12 unit tests green including unicode-escape bypass |
| 5 | `GET /api/branding` carries Cache-Control: no-cache, no-store; also returns 200 in AUTH_MODE=oidc | VERIFIED | Header set at index.ts:417; OIDC smoke block in routes.branding.spec.ts (hoisted openid-client mock) asserts 200 unauthenticated in oidc mode |

**Score:** 5/5 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/db.ts` | brand_config DDL in SCHEMA_DDL + INSERT OR IGNORE seed after seedRbac | VERIFIED | DDL at line 253; seed `INSERT OR IGNORE INTO brand_config (id) VALUES (1)` at line 347, after `seedRbac(instance)` at line 342 |
| `packages/server/src/lib/permissions.ts` | BRANDING_MANAGE 18th permission constant | VERIFIED | Line 36: `BRANDING_MANAGE: "branding:manage"` as 18th entry; `DEFAULT_ROLE_MAPPINGS.admin = [...ALL_PERMISSIONS]` includes it; designer/user_admin/analyst unchanged |
| `packages/web/src/lib/permissions.ts` | Byte-parity mirror of BRANDING_MANAGE | VERIFIED | Line 28: `BRANDING_MANAGE: "branding:manage"` byte-identical value |
| `packages/server/src/index.ts` | 4 branding routes: 2 unauthenticated GETs before requireAuth wall, PUT + POST gated on branding:manage | VERIFIED | GET /api/branding at 416, GET /api/branding/logo at 431 (both before wall at 590); PUT at 598 and POST at 629 both use `requirePermission(PERMISSIONS.BRANDING_MANAGE)` |
| `packages/server/src/lib/brandCssSanitizer.ts` | sanitizeCssPostcss() — PostCSS AST walk, 64KB cap | VERIFIED | EXISTS; exports `sanitizeCssPostcss`; `postcss.parse()` at line 47; `root.walk()` at line 48; 64KB cap `raw.slice(0, 65_536)` at line 45; `.replace()` appears ONLY in `resolveCssUnicodeEscapes()` helper (pre-processing on value string, not CSS output) |
| `packages/server/tests/routes.branding.spec.ts` | supertest coverage incl. mislabeled-SVG bypass, CSS sanitization, OIDC smoke | VERIFIED | EXISTS; 18 tests total (14 password-mode + 1 OIDC smoke + 3 CSS integration); all required assertions present |
| `packages/server/tests/lib.brandCssSanitizer.spec.ts` | Unit tests for each attack vector + unicode-escape bypass | VERIFIED | EXISTS; 12 tests across 4 describe blocks: attack vectors, unicode-escape bypass, legitimate-CSS preservation, edge cases |
| `packages/server/tests/lib.permissions.spec.ts` | Catalog lock bumped 17→18 with branding:manage assertion | VERIFIED | `toBe(18)` at lines 34 + 53; `"branding:manage"` in EXPECTED array and explicit `.toContain("branding:manage")` test |
| `packages/server/package.json` | multer, file-type@19, dompurify, jsdom, postcss in deps | VERIFIED | All 5 deps present: multer@^2.2.0, file-type@^19.6.0, postcss@^8.5.15, dompurify@^3.4.11, jsdom@^29.1.1 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `GET /api/branding` in index.ts | Before `app.use("/api", requireAuth)` wall | Mounted at line 416, wall at line 590 | WIRED | Line 416 < 590: unauthenticated access confirmed |
| `GET /api/branding/logo` in index.ts | Before `app.use("/api", requireAuth)` wall | Mounted at line 431, wall at line 590 | WIRED | Line 431 < 590 |
| `PUT /api/branding` in index.ts | `PERMISSIONS.BRANDING_MANAGE` | `...requirePermission(PERMISSIONS.BRANDING_MANAGE)` at line 598 | WIRED | Analyst 403 confirmed by supertest |
| `POST /api/branding/logo` in index.ts | Content-sniff SVG + DOMPurify sanitize | `looksSvg` check at line 650, DOMPurify in the `if (looksSvg)` branch | WIRED | Independent of declared/detected MIME; mislabeled-SVG bypass closed |
| `PUT /api/branding` in index.ts | `sanitizeCssPostcss` | Import at line 125; call at line 607 BEFORE db.prepare write | WIRED | Defense before write confirmed; `configObj.customCss = sanitizeCssPostcss(configObj.customCss)` |
| `brandCssSanitizer.ts` | PostCSS AST | `postcss.parse(capped)` + `root.walk(...)` | WIRED | AST-based node removal; unicode-escape pre-normalization via `resolveCssUnicodeEscapes()` |
| `db.ts createDb()` | brand_config seed row | `INSERT OR IGNORE INTO brand_config (id) VALUES (1)` after `seedRbac(instance)` | WIRED | Line order confirmed: seedRbac at 342, seed at 347 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BRANDFND-01 | 81-01, 81-02 | Server-side brand configuration store persists active branding | SATISFIED | `brand_config` table in SCHEMA_DDL with CHECK(id=1); INSERT OR IGNORE seed; GET+PUT routes read/write it |
| BRANDFND-02 | 81-01, 81-02 | New permission gates writes; reads unauthenticated | SATISFIED | `BRANDING_MANAGE` 18th permission; GET routes before requireAuth wall; PUT/POST gated; analyst returns 403 |
| SECA-V116-01 | 81-02, 81-03 | Logo uploads validated (MIME+magic-byte+size); SVG sanitized; logos rendered as images (not inline) | SATISFIED | Content-sniff SVG (independent of MIME); DOMPurify sanitization; 256KB multer cap → 413; nosniff header; GET /api/branding/logo serves bytes (server side); client <img> contract deferred to Phase 82 (human verification) |
| CSS-V116-02 | 81-03 | Injected CSS sanitized AST-based; scoping deferred Phase 83 | SATISFIED (sanitization portion) | PostCSS AST walk strips url()/@import/@font-face/expression()/javascript:/behavior/-moz-binding; unicode-escape bypass closed by `resolveCssUnicodeEscapes()`; `@scope` wrapping explicitly deferred to Phase 83 per plan — REQUIREMENTS.md traceability table shows "Pending" but the server-side AST sanitization deliverable is fully implemented |

**Note on CSS-V116-02 traceability:** REQUIREMENTS.md traceability table shows `CSS-V116-02 | Phase 81 | Pending`. The requirement text includes "scoped so it cannot break the app shell" — the `@scope` wrapping half is intentionally deferred to Phase 83 (documented in 81-03 PLAN + SUMMARY). The server-side AST sanitization half is complete. The "Pending" status in REQUIREMENTS.md reflects the combined requirement; REQUIREMENTS.md was not updated to "partial" — this is a documentation gap, not an implementation gap. Phase 83 owns the remaining `@scope` work.

---

## Anti-Patterns Scan

Files modified in this phase scanned for stubs and red flags:

| File | Pattern | Severity | Finding |
|------|---------|----------|---------|
| `packages/server/src/index.ts` | `// NOTE (81-03): sanitizeCssPostcss...` placeholder comment | None | Comment was replaced in 81-03 with real call; current code at line 604-608 shows the real sanitization wired in — no placeholder remaining |
| `packages/server/src/lib/brandCssSanitizer.ts` | `.replace()` in output path | None | The `.replace()` at line 17 is inside `resolveCssUnicodeEscapes()` — a pre-processing helper normalizing a value *string* before pattern matching, not a regex replacement of CSS output. Output is always `root.toString()`. Correctly documented in 81-03 SUMMARY deviation note. |
| `packages/server/src/db.ts` | Empty return or placeholder | None | Real DDL and seed present |

No blockers or warnings found.

---

## Human Verification Required

### 1. Live Unauthenticated Branding Fetch

**Test:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT/api/branding` with no cookie
**Expected:** 200, JSON body with `config` object and `logoUrl: null` initially; `Cache-Control: no-cache, no-store` header present
**Why human:** Supertests cover this at the HTTP level (confirmed green this session). Deferred to Phase 84 milestone UAT live walk-through.

### 2. Logo Renders as `<img>` in the UI

**Test:** Upload a logo via PUT /api/branding/logo (admin session), then observe topbar/login page rendering
**Expected:** Logo displayed via `<img src="/api/branding/logo?v=...">`, NOT via `innerHTML` or `dangerouslySetInnerHTML`
**Why human:** This is Phase 82 client work — the server stores bytes and serves them with correct MIME + nosniff headers (server contract verified). Client rendering pattern deferred to Phase 82 implementation + Phase 84 UAT.

---

## Gaps Summary

No gaps. All 5 observable truths verified, all artifacts exist and are substantive and wired, all key links confirmed. The one REQUIREMENTS.md documentation inconsistency (CSS-V116-02 showing "Pending") reflects deferred `@scope` scoping (Phase 83) — not a Phase 81 implementation shortfall.

Phase 81 goal is **achieved**: the server-side brand persistence layer exists and is hardened. All automated gates pass per test_gate_context: routes.branding.spec.ts (18 tests), lib.brandCssSanitizer.spec.ts (12 tests), lib.permissions.spec.ts (18 tests), and server tsc clean. Failing server files remain within the known TD-V16-TEST-ISOLATION set — no Phase 81 regressions.

---

_Verified: 2026-06-24T17:10:00Z_
_Verifier: Claude (gsd-verifier)_
