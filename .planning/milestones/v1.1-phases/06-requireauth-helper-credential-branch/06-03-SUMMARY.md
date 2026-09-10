---
phase: 06-requireauth-helper-credential-branch
plan: "03"
subsystem: auth
tags: [oidc, observability, boot, kinetica, opaque-token, fire-and-forget]

# Dependency graph
requires:
  - phase: 06-02
    provides: tryDecodeAccessTokenExp(token) — null sentinel for opaque/malformed JWT

provides:
  - Structured oidc_boot info log at boot in OIDC mode (issuer + audience + redirect_uri)
  - Fire-and-forget unauthenticated GET /version reachability probe
  - Structured kinetica_unreachable warn log on probe failure (reject + non-2xx)
  - Structured oidc_opaque_access_token warn log at /oidc/callback when access token cannot be JWT-decoded

affects: [Phase 8 runbook will reference these log events]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Async IIFE wrap around fire-and-forget fetch — fully contains sync throws + async rejections + non-thenable returns from fetch (required because tests stub fetch with vi.fn() default-undefined)"
    - "Structured JSON one-liner via console.log/console.warn — uniform shape across boot + per-request audit (Phase 02-02 explicit-key discipline)"
    - "OIDC-only gating — both probe and oidc_boot live inside `if (authMode === 'oidc')`; password mode emits neither"
    - "Once-per-login opaque-token warning — placed at /oidc/callback after username extraction, before createSession; never per-request"

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/tests/bootstrap.spec.ts
    - kinetica_bi/server/tests/auth.oidc.spec.ts

key-decisions:
  - "Async IIFE pattern over .then().catch() chain — defensive against fetch returning undefined (test environment stubs); production code remains fire-and-forget"
  - "Probe URL hardcoded to /version (Claude's Discretion per CONTEXT.md); TODO comment notes KINETICA_HEALTHCHECK_PATH could become env-configurable later"
  - "Opaque-token warning placed after username extraction so 'username' field can be included; appears immediately before createSession"
  - "Old non-structured T-05 dot-count check (lines 274-279) deleted entirely; new structured form is the single warning site"
  - "Pre-empted Phase 8 SC5 wording: 'Kinetica must be configured to trust tokens from <issuer> with audience <client_id>' lives in oidc_boot.message"
  - "Phase 5 test 'POST /api/auth/login (oidc mode gate)' assertion narrowed from fetchMock.not.toHaveBeenCalled() to filtering for /execute/sql calls — the new boot probe shares the global fetch in tests"

patterns-established:
  - "Structured log shape: { ts, level, event, message, ...domain-fields }"
  - "kinetica_unreachable status: HTTP status on non-2xx; status: 0 on rejected fetch (network error)"

requirements-completed: [UX-05]

# Log shape contracts (operator-facing — Phase 8 runbook will quote these)
log-shapes:
  oidc_boot:
    level: info
    fields: [ts, level, event, message, issuer, audience, redirect_uri]
    fires: once per createApp() call in OIDC mode; never in password mode
  kinetica_unreachable:
    level: warn
    fields: [ts, level, event, url, status, message]
    fires: once per probe rejection or non-2xx response (status: 0 = network reject; status: <int> = HTTP non-2xx)
  oidc_opaque_access_token:
    level: warn
    fields: [ts, level, event, message, username]
    fires: once per /oidc/callback success when tryDecodeAccessTokenExp(accessToken) === null

# Metrics
duration: 12min
tests-added: 8
tests-passing: 318
tests-skipped: 1
tsc-clean: true

# Verification
verification:
  - grep "event:\\s*\"oidc_boot\"" kinetica_bi/server/src/index.ts | wc -l → 1
  - grep "event:\\s*\"kinetica_unreachable\"" kinetica_bi/server/src/index.ts | wc -l → 2 (non-2xx + catch branches)
  - grep "event:\\s*\"oidc_opaque_access_token\"" kinetica_bi/server/src/index.ts | wc -l → 1
  - grep "tryDecodeAccessTokenExp" kinetica_bi/server/src/index.ts | wc -l → 2 (1 import + 1 call site)
  - grep "[boot] OIDC mode active" kinetica_bi/server/src/index.ts | wc -l → 0 (old plaintext logs removed)
  - npx vitest run tests/bootstrap.spec.ts tests/auth.oidc.spec.ts exits 0 (43 passing + 1 skipped)
  - npx vitest run (full suite) exits 0 (318 passing + 1 pre-existing skip)
  - npx tsc --noEmit exits 0
  - bootstrap.spec.ts existing IIFE-structure regex test still passes (untouched)

# Commits
commits:
  - 1c02b2c: feat(06-03) — structured oidc_boot log + /version probe + opaque-token warn (Tasks 1+2)
  - 4ac165d: test(06-03) — boot probe + opaque-token tests + defensive IIFE wrap (Task 3 + Phase 5 test adjustment)

---

## What this plan delivered

Three operator-facing observability signals in `kinetica_bi/server/src/index.ts`, all gated to OIDC mode:

1. **`oidc_boot` info log** — one structured JSON line at `createApp()` time after `validateOidcEnv()` + `initOidcClient()` succeed. Fields: `issuer`, `audience`, `redirect_uri`. The `message` field carries the Phase 8 SC5 wording verbatim ("Kinetica must be configured to trust tokens from <issuer> with audience <client_id>") so operators see the contract at boot without needing the runbook.

2. **Unauthenticated `/version` reachability probe** — fire-and-forget `fetch(${KINETICA_URL}/version)` immediately after the boot log. NOT an OIDC-trust test (no token to send) — catches DNS/TLS/connectivity at boot. Wrapped in an async IIFE with `try`/`catch` so failures are fully contained: sync throws, async rejections, and non-thenable fetch returns all funnel to a structured `kinetica_unreachable` warn log. `createApp()` resolves regardless — no fail-fast on Kinetica unreachability.

3. **`oidc_opaque_access_token` warn at `/oidc/callback`** — replaces the prior bare `console.warn` dot-count check. Discriminant is `tryDecodeAccessTokenExp(accessToken) === null` (Phase 06-02 export), which catches malformed b64 + missing/non-numeric exp in addition to the 3-segment check. Once-per-login (lives in the callback handler, not middleware). Carries the username so operators correlate the warning with the user who logged in. Never includes the access_token (it's a secret).

## Success Criteria Trace

- **UX-05 backbone**: the operator-facing logs that make PITFALL I-06 (Kinetica OIDC trust loop) and PITFALL T-05 (opaque-token deployments) diagnosable from logs alone. Phase 8's runbook will reference these event names.
- **Phase 8 SC5 wording pre-empted**: the structured `oidc_boot.message` field carries the contract reminder.
- **PITFALL T-05 fully addressed for v1.1**: structured warn fires at session creation when access_token is opaque; reactive 401-REAUTH chain handles the runtime case.
- **PITFALL I-06 partially addressed**: code-side observability landed; full remediation requires Phase 8's runbook.

## Status

PLAN COMPLETE — code committed in 2 atomic commits; 318 server tests passing (1 pre-existing skip); tsc clean. Existing bootstrap-IIFE-structure regex test still passes.
