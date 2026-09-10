---
phase: 81-brand-config-server-foundation
plan: 02
subsystem: server-api
tags: [express, branding, multer, file-type, dompurify, jsdom, svg-sanitization, rbac, api-routes]

# Dependency graph
requires:
  - brand_config singleton SQLite table (81-01)
  - BRANDING_MANAGE: "branding:manage" permission (81-01)
provides:
  - GET /api/branding — unauthenticated, no-cache,no-store, returns {config,logoUrl,updatedAt}
  - GET /api/branding/logo — unauthenticated, immutable cache, X-Content-Type-Options nosniff
  - PUT /api/branding — branding:manage gated, persists config_json verbatim (CSS sanitizer in 81-03)
  - POST /api/branding/logo — branding:manage gated, multer 256KB cap, content-sniff SVG bypass, DOMPurify sanitization, magic-byte raster validation
  - multer@2.2.0, file-type@19, postcss, dompurify@3.4.11, jsdom@29 installed in packages/server
  - routes.branding.spec.ts — 14 tests green (auth gating, cache headers, logo upload/serve, SVG sanitization, mislabeled-SVG bypass)
affects: [81-03, 82]

# Tech tracking
tech-stack:
  added:
    - multer@2.2.0 (multipart logo upload, memoryStorage, 256KB cap)
    - file-type@19.6.0 (magic-byte MIME detection for raster validation)
    - postcss@8.5.15 (installed now; CSS sanitizer wired in 81-03)
    - dompurify@3.4.11 (SVG sanitization at upload)
    - jsdom@29.1.1 (DOM environment for server-side DOMPurify)
    - "@types/multer" devDep
    - "@types/jsdom" devDep
  patterns:
    - "Unauthenticated routes mounted BEFORE app.use('/api', requireAuth) wall — same pattern as GET /api/auth/config (line 405)"
    - "SVG content-sniff: decode first 1KB as UTF-8, check for <?xml or /<svg[\\s>]/i — independent of declared or file-type detected MIME"
    - "Mislabeled SVG bypass: if looksSvg is true, always run DOMPurify regardless of req.file.mimetype or fileTypeFromBuffer() result"
    - "multer MulterError 413 mapped at route level — does not pass through asyncHandler/errorMiddleware"
    - "jsdom JSDOM() singleton instantiated once per createApp() call to amortize ~50ms startup cost"
    - "DOMPurify cast: _brandDomWindow as any to bridge jsdom Window type to DOMPurify WindowLike"

key-files:
  created:
    - packages/server/tests/routes.branding.spec.ts
  modified:
    - packages/server/package.json
    - packages/server/src/index.ts
    - package-lock.json

key-decisions:
  - "SVG detection is CONTENT-SNIFF ONLY — file-type always returns undefined for SVG (no magic bytes); never trust req.file.mimetype for SVG/raster decision"
  - "Mislabeled-SVG bypass (SECA-V116-01): SVG bytes sent with Content-Type image/png are content-sniffed, sanitized by DOMPurify, stored as image/svg+xml — the declared MIME is irrelevant"
  - "DOMPurify uses _brandDomWindow as any cast — WindowLike type mismatch between jsdom and DOMPurify type def; runtime behavior correct"
  - "PUT /api/branding stores config_json verbatim in 81-02; PostCSS CSS sanitization wired in 81-03 per plan decomposition"
  - "Cache headers: GET /api/branding → no-cache,no-store (reverse-proxy safety); GET /api/branding/logo → public,max-age=31536000,immutable (cache-busted by ?v= timestamp)"

requirements-completed: [BRANDFND-01, BRANDFND-02, SECA-V116-01]

# Metrics
duration: 4min
completed: 2026-06-24
---

# Phase 81 Plan 02: Branding API Routes Summary

**4 branding API routes in index.ts: 2 unauthenticated GETs before requireAuth wall + 2 branding:manage-gated writes with multer upload, content-sniff SVG detection, DOMPurify sanitization, and magic-byte raster validation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-24T16:38:12Z
- **Completed:** 2026-06-24T16:42:00Z
- **Tasks:** 2
- **Files modified:** 4 (package.json, index.ts, package-lock.json, routes.branding.spec.ts)

## Accomplishments

- Installed 5 prod deps (`multer@2.2.0`, `file-type@19`, `postcss`, `dompurify@3.4.11`, `jsdom@29`) + 2 devDeps (`@types/multer`, `@types/jsdom`)
- Added `GET /api/branding` and `GET /api/branding/logo` before the `requireAuth` wall (line 587) — mirroring `GET /api/auth/config` pattern; login page can fetch brand without a session cookie
- `GET /api/branding` serves `Cache-Control: no-cache, no-store` to prevent reverse-proxy stale brand
- `GET /api/branding/logo` serves `Cache-Control: public, max-age=31536000, immutable` + `X-Content-Type-Options: nosniff`, 404 when no logo stored
- Added `PUT /api/branding` gated on `PERMISSIONS.BRANDING_MANAGE` — validates config object, persists verbatim (CSS sanitizer deferred to 81-03 per plan)
- Added `POST /api/branding/logo` gated on `PERMISSIONS.BRANDING_MANAGE` — multer memoryStorage, 256KB cap mapped to 413, content-sniff SVG path (independent of MIME), DOMPurify sanitization on any content-sniffed SVG, magic-byte raster validation via file-type, 415 for unknown types
- Created `routes.branding.spec.ts`: 14 tests all green covering every must-have behavior including the mislabeled-SVG bypass (SECA-V116-01)

## Task Commits

1. **Task 1: Install branding deps + add 4 branding routes to index.ts** — `d68cecd` (feat)
2. **Task 2: routes.branding.spec.ts** — `4a5564e` (test)

## Files Created/Modified

- `packages/server/package.json` — multer, file-type@19, postcss, dompurify, jsdom in deps; @types/multer, @types/jsdom in devDeps
- `packages/server/src/index.ts` — 4 branding imports at top; jsdom/DOMPurify/multer/ALLOWED_RASTER_MIMES/BrandConfigRow singletons inside createApp(); 2 unauthenticated GETs at line ~414 (before requireAuth wall); 2 gated writes at line ~590 (after requireAuth wall)
- `packages/server/tests/routes.branding.spec.ts` — 14 supertest cases in AUTH_MODE=password describe block
- `package-lock.json` — updated with 22 new packages

## Decisions Made

- SVG detection is content-sniff only (first 1KB, `<?xml` or `/<svg[\s>]/i`) — `fileTypeFromBuffer()` always returns `undefined` for SVG (no magic bytes); client-supplied `Content-Type` is ignored for SVG/raster routing decision
- The mislabeled-SVG attack vector (SVG bytes + `Content-Type: image/png`) is closed: `looksSvg` check runs before any MIME check, so any SVG bytes — however labeled — go through DOMPurify
- `DOMPurify(_brandDomWindow as any)` — jsdom's `Window` type doesn't exactly satisfy DOMPurify's `WindowLike`; `as any` cast is correct at runtime (jsdom implements the required DOM interfaces)
- CSS sanitization (`sanitizeCssPostcss`) is intentionally absent in 81-02; `PUT /api/branding` stores verbatim per plan decomposition; wired in 81-03

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

One TypeScript type error on DOMPurify initialization (`_brandDomWindow as unknown as Window` → type mismatch between jsdom `Window` and DOMPurify `WindowLike`). Fixed inline with `as any` cast. This is a known type incompatibility between jsdom and DOMPurify type definitions; runtime behavior is correct.

## User Setup Required

None.

## Next Phase Readiness

- 81-03 can wire `sanitizeCssPostcss(configObj.customCss)` into `PUT /api/branding` — the NOTE comment is already in place
- Phase 82 client can call `GET /api/branding` to bootstrap brand config before auth; `GET /api/branding/logo` serves logo bytes with immutable cache + ?v= cache-busting
- All SECA-V116-01 requirements met: logo type decided by content-sniff + magic bytes, not client MIME; SVG always sanitized; unknown types rejected 415; served with nosniff + immutable cache

---
*Phase: 81-brand-config-server-foundation*
*Completed: 2026-06-24*
