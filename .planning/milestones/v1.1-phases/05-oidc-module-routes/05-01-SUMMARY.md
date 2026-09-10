---
phase: 05-oidc-module-routes
plan: "01"
subsystem: auth
tags: [oidc, openid-client, env-validation, typescript]

# Dependency graph
requires:
  - phase: 04-schema-sessionstore-foundation
    provides: createSession options-object signature with credentialType + idToken fields

provides:
  - openid-client@5.7.1 installed in kinetica_bi/server (v5.x, not v6.x)
  - OidcConfig type with issuer, clientId, clientSecret, redirectUri, usernameClaim, usernameRegex
  - validateOidcEnv() function that validates + normalizes AUTH_OIDC_* env vars at boot
  - .env.example documenting AUTH_MODE + 6 AUTH_OIDC_* env vars with comments

affects:
  - 05-02 (adds initOidcClient, buildAuthorizationUrl, exchangeCode, extractUsername using OidcConfig)
  - 05-03 (route handlers consume validateOidcEnv + oidc.ts module)
  - 05-04 (route tests reference OidcConfig type)

# Tech tracking
tech-stack:
  added:
    - openid-client@5.7.1 (v5.x CJS-compatible OIDC RP library; Issuer.discover + client.callback API)
  patterns:
    - Boot-time env validation with descriptive throws per missing var (loud-failure pattern)
    - Object.freeze() on config return to prevent downstream mutation
    - vi.stubEnv + vi.unstubAllEnvs in beforeEach/afterEach for env-var unit tests

key-files:
  created:
    - kinetica_bi/server/src/oidc.ts
    - kinetica_bi/server/tests/oidc.module.spec.ts
  modified:
    - kinetica_bi/server/package.json
    - kinetica_bi/server/package-lock.json
    - kinetica_bi/server/.env.example

key-decisions:
  - "openid-client@^5 installed at v5.7.1 — NOT v6.x (ESM-only rewrite with incompatible API; no Issuer.discover in v6)"
  - "validateOidcEnv() returns Object.freeze() config so downstream consumers cannot mutate captured values"
  - "Trailing slash stripped via issuerRaw.replace(/\\/$/, '') — covers PITFALLS O-01 and C-05 at single call site"
  - "oidc.ts Plan 01 scope strictly limited to OidcConfig type + validateOidcEnv; no openid-client imports yet (Plan 05-02 territory)"

patterns-established:
  - "validateOidcEnv pattern: read all required env vars, throw descriptively per missing one, return frozen config"
  - "vi.stubEnv('X', '') in beforeEach clears vars — empty string is falsy in || default expressions"

requirements-completed: [MODE-01, OIDC-03]

# Metrics
duration: 5min
completed: 2026-05-01
---

# Phase 5 Plan 01: OIDC Module + Routes — Scaffolding Summary

**openid-client@5.7.1 installed and OidcConfig + validateOidcEnv() skeleton created with 10 passing unit tests covering all env-validation branches and trailing-slash normalization**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-30T19:04:48Z
- **Completed:** 2026-05-01T18:50:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Installed openid-client@^5 (resolved v5.7.1 — confirmed NOT v6.x which is ESM-only with incompatible API)
- Appended AUTH_MODE + 6 AUTH_OIDC_* env vars with full comments to .env.example; existing vars untouched
- Created src/oidc.ts with OidcConfig type and validateOidcEnv() matching RESEARCH.md §"Module Implementation" verbatim
- 10 unit tests in tests/oidc.module.spec.ts covering all branches; all pass; full vitest run green (225 passed, 1 skipped); tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Install openid-client@^5 and document AUTH_OIDC_* env vars** - `83e29b0` (feat)
2. **Task 2: validateOidcEnv test file (RED)** - `c62f902` (test)
3. **Task 2: Create src/oidc.ts skeleton with OidcConfig + validateOidcEnv() (GREEN)** - `d3cdc7f` (feat)

_Note: TDD task split into RED commit (tests only) + GREEN commit (implementation)._

## Files Created/Modified

- `kinetica_bi/server/src/oidc.ts` - OidcConfig type export + validateOidcEnv() boot validator (Plan 01 skeleton; no openid-client import yet)
- `kinetica_bi/server/tests/oidc.module.spec.ts` - 10 unit tests for validateOidcEnv (missing vars → throw, trailing slash normalization, default claim, regex capture, empty regex → undefined, frozen object)
- `kinetica_bi/server/package.json` - openid-client@^5.7.1 added to dependencies
- `kinetica_bi/server/package-lock.json` - lockfile updated with 6 new packages
- `kinetica_bi/server/.env.example` - AUTH_MODE + AUTH_OIDC_ISSUER_URL + AUTH_OIDC_CLIENT_ID + AUTH_OIDC_CLIENT_SECRET + AUTH_OIDC_REDIRECT_URI + AUTH_OIDC_USERNAME_CLAIM + AUTH_OIDC_USERNAME_REGEX documented with comments

## Decisions Made

**openid-client version locked at v5.7.1:** npm `latest` points to v6.8.4 (a complete ESM-only rewrite). The CONTEXT.md-locked API surface (`Issuer.discover`, `new issuer.Client`, `client.callback`, `TokenSet.claims()`) does not exist in v6. Installing `@^5` correctly resolved to v5.7.1.

**validateOidcEnv() returns frozen config:** The plan marks this as "Claude's discretion: returns config (recommended)." Returning `Object.freeze({...})` means Plan 05-02's `initOidcClient(config)` receives an immutable object — eliminates any risk of route handlers or tests mutating the boot-time config inadvertently.

**oidc.ts has zero openid-client imports in Plan 01:** The plan explicitly defers `Issuer`, `Client`, `custom`, `errors` imports to Plan 05-02. This keeps the skeleton minimal and lets the unit tests run without requiring openid-client to be loaded.

## Deviations from Plan

None — plan executed exactly as written. The `node -e "require('openid-client/package.json').version"` check in the plan's verify step failed on Node 24 (ESM package exports don't expose `./package.json` subpath), but reading the file directly via `cat node_modules/openid-client/package.json | grep '"version"'` confirmed v5.7.1. The acceptance criterion was met.

## Issues Encountered

**openid-client/package.json subpath not exported:** Node.js v24 enforces ESM `exports` map strictly — `require('openid-client/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because the package exports field doesn't list that subpath. Workaround: read the file directly. This is a Node 24 behavior difference, not a code issue, and has no impact on runtime usage of the library.

## User Setup Required

None — no external service configuration required for this scaffolding plan.

## Next Phase Readiness

- Plan 05-02 can now import `OidcConfig` from `./oidc` and add `initOidcClient`, `buildAuthorizationUrl`, `exchangeCode`, `extractUsername`, `mapOidcError` functions
- openid-client@5.7.1 is available and ready for `import { Issuer, Client, custom, errors } from "openid-client"`
- validateOidcEnv() is tested, frozen, and ready for use in createApp() boot sequence (Plan 05-03)
- No blockers

---
*Phase: 05-oidc-module-routes*
*Completed: 2026-05-01*
