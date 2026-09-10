---
phase: 74-app-settings-infrastructure-ttl-defaults
verified: 2026-06-19T01:05:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 74: Env-Driven TTL Defaults — Verification Report

**Phase Goal:** Make the materialized-view TTL and the keep-alive lead-time deploy-time configurable via environment variables (read once at boot, AUTH_MODE-style), replacing the hardcoded `TTL = 5` across all three materialize sites, and expose the keep-alive lead value to the client for Phase 78.
**Verified:** 2026-06-19T01:05:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                                  | Status     | Evidence                                                                                                      |
|----|----------------------------------------------------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------------------|
| 1  | Both DEFAULT_VIEW_TTL_MINUTES (default 5) and TTL_KEEPALIVE_LEAD_MINUTES (default 1) are read once at boot inside createApp()          | VERIFIED   | `index.ts:145-158` — readPositiveIntEnv helper + both consts captured in createApp() boot block after authMode |
| 2  | Missing/non-numeric/zero/negative env value falls back to its default AND logs a boot warning — app still starts (NOT fail-fast)       | VERIFIED   | `index.ts:149-153` — Number.isFinite/isInteger/<=0 check → console.warn + return def; no throw               |
| 3  | All THREE materialize sites use DEFAULT_VIEW_TTL_MINUTES for both the ttl arg AND the expiresAt arithmetic — no hardcoded 5 remains   | VERIFIED   | `index.ts:990/994` (site 1), `1076/1081` (site 2), `1739/1744` (site 3); `grep -c "ttl: 5"` = 0             |
| 4  | GET /api/me returns ttlKeepaliveLeadMinutes top-level next to authMode                                                                 | VERIFIED   | `index.ts:367` — `ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES` in res.json()                         |
| 5  | MeResponse type includes ttlKeepaliveLeadMinutes + fetchMe parses it with defensive default 1                                          | VERIFIED   | `packages/web/src/api/client.ts:130,167` — required `number` field in type; typeof coalesce in fetchMe       |
| 6  | Auth store exposes ttlKeepaliveLeadMinutes in state (initial 1) and sets it on bootstrap                                               | VERIFIED   | `packages/web/src/store/auth.ts:16,31,46` — AuthState type, initial value 1, set in bootstrap step 2        |
| 7  | No app_settings table, CRUD endpoint, new permission, or settings UI was introduced (scope pivot guard)                                | VERIFIED   | grep for `app_settings` / `app:manage_settings` in packages/server/src + packages/web/src = 0 matches        |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact                                        | Expected                                               | Status   | Details                                                                                                 |
|-------------------------------------------------|--------------------------------------------------------|----------|---------------------------------------------------------------------------------------------------------|
| `packages/server/src/index.ts`                  | readPositiveIntEnv, 2 boot consts, 3 wired sites, /me  | VERIFIED | All present at lines 145-158 (consts), 990/994/1076/1081/1739/1744 (sites), 367 (/me)                  |
| `packages/web/src/api/client.ts`                | MeResponse type + fetchMe parse ttlKeepaliveLeadMinutes | VERIFIED | Line 130: type; line 167: parse with defensive coalesce                                                 |
| `packages/web/src/store/auth.ts`                | AuthState field, initial 1, bootstrap set              | VERIFIED | Lines 16, 31, 46                                                                                        |
| `packages/server/tests/routes.filter-materialize.spec.ts` | DEFAULT_VIEW_TTL_MINUTES=10 env-override test | VERIFIED | Line 560-588: vi.stubEnv + asserts TTL=10 in DDL + expiresAt ~10 min                                   |
| `packages/server/tests/routes.filter-materialize-dv.spec.ts` | DEFAULT_VIEW_TTL_MINUTES=10 env-override test (site 1) | VERIFIED | Lines 304-327: vi.stubEnv + asserts TTL=10 in DDL + expiresAt ~10 min                             |
| `packages/server/tests/routes.dynamic-view.spec.ts`       | DEFAULT_VIEW_TTL_MINUTES=10 env-override test (site 3) | VERIFIED | Lines 752-777: vi.stubEnv + asserts TTL=10 in DDL + expires_at ~10 min                              |
| `packages/server/tests/auth.routes.spec.ts`     | ttlKeepaliveLeadMinutes in /api/me assertions + TTL_KEEPALIVE_LEAD_MINUTES=3 test | VERIFIED | Lines 382, 393: toEqual updated; line 413-426: new test passes |
| `packages/web/src/store/auth.spec.ts`           | Initial state default=1, bootstrap sets configured value | VERIFIED | Lines 31-32 (initial=1), lines 66-74 (bootstrap sets 3)                                                |

---

### Key Link Verification

| From                            | To                                                   | Via                                              | Status   | Details                                                              |
|---------------------------------|------------------------------------------------------|--------------------------------------------------|----------|----------------------------------------------------------------------|
| createApp() boot block          | createOrReplaceMaterialized ttl arg (sites 1/2/3)   | closed-over const DEFAULT_VIEW_TTL_MINUTES       | WIRED    | `ttl: DEFAULT_VIEW_TTL_MINUTES` at index.ts:990, 1076, 1739         |
| createApp() boot block          | GET /api/me response JSON                             | closed-over TTL_KEEPALIVE_LEAD_MINUTES           | WIRED    | `ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES` at index.ts:367 |
| fetchMe (client.ts)             | useAuthStore state (auth.ts bootstrap)               | me.ttlKeepaliveLeadMinutes set into the store     | WIRED    | auth.ts:46 — `ttlKeepaliveLeadMinutes: me.ttlKeepaliveLeadMinutes`  |

---

### Requirements Coverage

| Requirement      | Source Plan | Description                                                                                                    | Status    | Evidence                                                                  |
|------------------|-------------|----------------------------------------------------------------------------------------------------------------|-----------|---------------------------------------------------------------------------|
| SETTINGS-V115-01 | 74-01-PLAN  | Both TTL values configured via env vars read once at boot; invalid/missing falls back with warning; no store   | SATISFIED | readPositiveIntEnv at index.ts:145-158; REQUIREMENTS.md marked [x]        |
| SETTINGS-V115-02 | 74-01-PLAN  | DEFAULT_VIEW_TTL_MINUTES replaces hardcoded 5 at all THREE materialize sites including expiresAt arithmetic    | SATISFIED | 3x `ttl: DEFAULT_VIEW_TTL_MINUTES` + 3x `DEFAULT_VIEW_TTL_MINUTES * 60 * 1000`; zero `ttl: 5` remain |
| SETTINGS-V115-03 | 74-01-PLAN, 74-02-PLAN | TTL_KEEPALIVE_LEAD_MINUTES exposed on GET /api/me as ttlKeepaliveLeadMinutes; client plumbed through MeResponse + auth store | SATISFIED | index.ts:367, client.ts:130/167, auth.ts:16/31/46 |

No orphaned requirements — all three IDs in plan frontmatter match REQUIREMENTS.md entries marked [x] with Phase 74 assigned.

---

### Anti-Patterns Found

None detected. Scan of modified files found:
- No TODO/FIXME/PLACEHOLDER comments in the new TTL-related code
- No stub implementations (all three sites fully wired, not returning static values)
- No per-route process.env reads — the only `process.env[name]` access is inside `readPositiveIntEnv` which executes entirely within the createApp() boot block (AP-5 compliant)
- No app_settings table, settings CRUD endpoints, app:manage_settings permission, or settings UI (scope pivot guard holds)

---

### Test Gate Results

**Server vitest (Phase-74-relevant files):**
- `routes.filter-materialize.spec.ts` — PASS (all tests)
- `routes.filter-materialize-dv.spec.ts` — PASS (all tests)
- `routes.dynamic-view.spec.ts` — PASS (all tests)
- `auth.routes.spec.ts` — 3 failed | 13 passed; the 3 failures are pre-existing TD-V16-TEST-ISOLATION items (OIDC constructor `TypeError: Issuer is not a constructor` in initOidcClient, and a `roles`/`permissions` user-object mismatch present at baseline commit 4b4d43c). The Phase-74 new test `TTL_KEEPALIVE_LEAD_MINUTES=3 surfaces as ttlKeepaliveLeadMinutes: 3 on /api/me` passes.

**Server tsc:** Clean (exit 0, no output)
**Web tsc:** Clean (exit 0, no output)
**Web vitest:** Reported 2453/2453 by executor (not re-run here; web tsc clean confirms no type regressions)

---

### Human Verification Required

None. All critical behaviors are verifiable programmatically:
- Boot const capture and wiring verified via grep against actual source
- Hardcoded literal removal verified (count = 0)
- Field presence in /api/me response verified via source + passing test
- Web type/parse/store chain verified via source + web tsc clean

---

### Gaps Summary

No gaps. All seven observable truths are fully verified against the actual codebase. The scope pivot from runtime app-settings store to env-var config was correctly implemented — no banned artifacts (app_settings table, CRUD endpoints, permissions, UI) were introduced, and all required artifacts exist, are substantive, and are correctly wired.

---

_Verified: 2026-06-19T01:05:00Z_
_Verifier: Claude (gsd-verifier)_
