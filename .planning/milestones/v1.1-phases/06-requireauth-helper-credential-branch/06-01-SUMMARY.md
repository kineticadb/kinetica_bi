---
phase: 06-requireauth-helper-credential-branch
plan: "01"
subsystem: auth
tags: [oidc, kinetica, helper, audit, bearer, basic, credentialType]

# Dependency graph
requires:
  - phase: 04-schema-sessionstore-foundation
    provides: AuthedRequest flat shape with credentialType + dual creds.password/creds.token
  - phase: 05-oidc-module-routes
    provides: OIDC sessions with credential_type='oidc', secret=access_token

provides:
  - buildAuthHeader(req): credential-type-aware Bearer/Basic branch in kinetica.ts
  - emitAudit auth_mode field: top-level "password" | "oidc" on every Kinetica-call audit line

affects: [06-04, kinetica.ts callers, audit log consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PITFALL I-01 lock: discriminant is `credentialType === 'oidc'`, NEVER `if (creds.password)` truthiness"
    - "Single Basic site enforced: `Authorization.*Basic` appears exactly once in kinetica.ts (inside buildAuthHeader's password branch)"
    - "auth_mode threaded into baseAudit at both kineticaSql (line 148) and kineticaWms (line 254) via req.user!.credentialType"
    - "auth_mode added as required field to emitAudit's explicit-key JSON.stringify enumeration (Phase 02-02 'no spread' discipline preserved)"
    - "buildAuthHeader signature changed: (creds) → (req: AuthedRequest); both callsites updated mechanically"

key-files:
  created: []
  modified:
    - kinetica_bi/server/src/kinetica.ts
    - kinetica_bi/server/tests/kinetica.creds.spec.ts
    - kinetica_bi/server/tests/kinetica.audit.spec.ts

key-decisions:
  - "buildAuthHeader takes full req, not creds — co-locates credentialType + creds reads (ARCHITECTURE.md kinetica.ts Changes pattern)"
  - "auth_mode is the ONLY new audit field — no auth_scheme (rejected in CONTEXT.md as redundant)"
  - "Required, not optional: emitAudit's auth_mode parameter is non-optional; kineticaSql/Wms only run after requireAuth so req.user is guaranteed"
  - "PITFALL I-01 locked by negative-grep AC + dedicated unit test asserting credentialType (not creds.password) as discriminant"

patterns-established:
  - "Single source of truth for auth scheme decision: buildAuthHeader is the only branch site"
  - "Audit log field discipline: explicit JSON.stringify keys (no spread); auth_mode joins the enumerated 9 keys"

requirements-completed: [MODE-04, OBS-02]

# Metrics
duration: 6min
tests-added: 12
tests-passing: 310
tsc-clean: true

# Verification
verification:
  - "git grep -nE 'Authorization.*Basic' kinetica_bi/server/src/kinetica.ts | wc -l" returns 1 (single Basic site, in buildAuthHeader)
  - "git grep -n 'credentialType === \"oidc\"' kinetica_bi/server/src/kinetica.ts | wc -l" returns ≥1 (Bearer branch present)
  - "git grep -nE 'if \\(creds\\.(password|token)\\)' kinetica_bi/server/src/kinetica.ts | wc -l" returns 0 (PITFALL I-01 lock)
  - "git grep -n 'auth_mode' kinetica_bi/server/src/kinetica.ts | wc -l" returns ≥3 (emitAudit type + 2 callsite threading)
  - cd kinetica_bi/server && npx tsc --noEmit exits 0
  - cd kinetica_bi/server && npx vitest run exits 0 with 310 passing

# Commits
commits:
  - 68f8974: test(06-01) — failing TDD-RED tests for credential-type-aware buildAuthHeader
  - 8bc6952: feat(06-01) — buildAuthHeader credential-type branch + auth_mode in emitAudit
  - c8aa8a3: feat(06-01) — discriminant unit tests + audit auth_mode assertions

---

## What this plan delivered

Phase 6's helper-credential-branch core. Replaces `kinetica.ts`'s Basic-only `buildAuthHeader` with a `(req: AuthedRequest) => string` form that branches on `req.user.credentialType`. OIDC sessions emit `Authorization: Bearer ${creds.token}`; password sessions continue to emit `Authorization: Basic ${b64(user:pass)}` — same wire format as v1.0. Both callsites in `kineticaSql` (line 148) and `kineticaWms` (line 254) updated to pass `req` instead of `req.user!.creds`.

Every per-Kinetica-call audit log line now carries a top-level `auth_mode: "password" | "oidc"` field, sourced from `req.user.credentialType`. Required (non-optional) in the audit-line internal type. Added to `emitAudit`'s explicit-key `JSON.stringify` enumeration — no spread, no leakage (Phase 02-02 discipline).

PITFALL I-01 is locked by both a negative-grep acceptance criterion (`if (creds.password)` returns 0 occurrences in kinetica.ts) and a dedicated unit test that asserts the discriminant is `credentialType`, not the truthiness of `creds.password`.

## Success Criteria Trace

- **SC1** (one Basic site behind credentialType branch): ✓ — `git grep 'Authorization.*Basic'` returns exactly 1 in kinetica.ts, inside the password branch of buildAuthHeader
- **SC5** (auth_mode in every Kinetica-call audit line): ✓ — top-level field, required, threaded from req.user.credentialType in both helpers
- (SC2 end-to-end via supertest is delivered by 06-04, which depends on this plan's helper branch)

## Status

PLAN COMPLETE — code committed in 3 atomic commits; 310/310 server tests passing; tsc clean.
