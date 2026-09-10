---
phase: 03-auth-failure-ux-admin-credential-removal
verified: 2026-04-28T00:00:00Z
status: human_needed
score: 3/5 must-haves verified (SC#3 and SC#5 fully verified; SC#1, SC#2, SC#4 pass all mechanical checks but require live browser/server verification per UAT.md)
human_verification:
  - test: "SC#1 — Session-expired banner + redirect to LoginPage (UAT Check 1-3)"
    expected: "After backend session is deleted, next API call sends 401+REAUTH_REQUIRED, frontend dispatches UNAUTHORIZED_EVENT, LoginPage appears with banner 'Your session has ended. Please sign in again.' Cookie cleared. No banner on logout or bootstrap 401."
    why_human: "Requires a live browser, a real backend, and sqlite3 shell to delete sessions. Wiring is mechanically complete (all code paths verified); observable redirect + banner + cookie clearing cannot be confirmed without running the browser."
  - test: "SC#2 — 403 inline permission error + toast + no logout (UAT Check 4-5)"
    expected: "Restricted user or injected KineticaPermissionError: affected widget shows '.widget-permission-denied' placeholder; global amber toast 'You don't have permission to view this data.' appears and auto-dismisses; user stays logged in; other widgets work. Duplicate toasts suppressed within 5s."
    why_human: "Requires a Kinetica user with restricted table access or deliberate injection of KineticaPermissionError at runtime. CSS/toast/store/hook wiring is mechanically verified; actual rendering cannot be confirmed without a browser."
  - test: "SC#4 — Server boots and serves authenticated routes with KINETICA_USERNAME/KINETICA_PASSWORD unset (UAT Steps 1-9)"
    expected: "Server starts cleanly, /api/health returns 200, login succeeds, /api/kinetica/schemas returns live data — all without KINETICA_USERNAME or KINETICA_PASSWORD in the environment."
    why_human: "Requires a live Kinetica instance. requireConfig is mechanically narrowed to KINETICA_URL-only (verified in code); actual route execution with session credentials requires the real backend."
---

# Phase 3: Auth Failure UX + Admin Credential Removal — Verification Report

**Phase Goal:** Mid-session Kinetica auth failures return the user cleanly to the login screen; permission failures (403) stay inline; the shared admin env vars are gone everywhere.
**Verified:** 2026-04-28
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Session-expired banner + LoginPage redirect on mid-session 401 | ? HUMAN_NEEDED | All mechanical proxies pass: errorMiddleware emits 401+REAUTH_REQUIRED+clearCookie; apiFetch body-peeks code==="REAUTH_REQUIRED" only; UNAUTHORIZED_EVENT fires; App.tsx calls markUnauthenticated("session-expired"); LoginPage renders banner when reason==="session-expired". Live browser flow deferred to UAT.md Checks 1-3. |
| 2 | 403 stays inline: widget grayed, toast fires, user not logged out | ? HUMAN_NEEDED | All mechanical proxies pass: errorMiddleware maps KineticaPermissionError → 403; throwForStatus throws PermissionError; useApiQuery catches it, sets error.kind="permission", calls showToast; DashboardsPage/DatasetsPage render .widget-permission-denied; Toast dedup in useToastStore. Live browser flow deferred to UAT.md Checks 4-5. |
| 3 | 401+code:REAUTH_REQUIRED vs 403 (no code) — frontend dispatches on code, not status | ✓ VERIFIED | errorMiddleware: KineticaAuthError → `{ error, code: "REAUTH_REQUIRED" }` + 401; KineticaPermissionError → `{ error }` + 403 (no code). apiFetch body-peek: `shouldDispatch = true` only when `peek.code === "REAUTH_REQUIRED"`. Test 1 asserts 401+REAUTH_REQUIRED; Test 2 asserts 403+no-code. All 5 errorMiddleware tests live and passing. |
| 4 | Server boots without KINETICA_USERNAME/KINETICA_PASSWORD — authenticated routes serve session creds | ? HUMAN_NEEDED | Mechanical proxies pass: requireConfig narrowed to KINETICA_URL-only check (verified in index.ts line 64-69); no other credential env vars on boot path. Tests confirm 210+1=211 passing. Live boot with unset creds deferred to UAT.md Steps 1-9. |
| 5 | `git grep` across repo (excluding .planning/) returns zero matches for KINETICA_USERNAME/KINETICA_PASSWORD | ✓ VERIFIED | `git grep -nE 'KINETICA_USERNAME\|KINETICA_PASSWORD' -- ':!.planning/'` → exit code 1, zero matches. Confirmed: .env.example clean, README.md clean, test specs use hardcoded "admin-env-user" sentinel, .env untracked via git rm --cached, dist/ gitignored. |

**Score:** 2/5 truths fully verified (SC#3, SC#5); 3/5 truths human_needed (SC#1, SC#2, SC#4)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `kinetica_bi/server/src/index.ts` | errorMiddleware, requireConfig narrowed, NODE_ENV gate | ✓ VERIFIED | errorMiddleware at line 431 with 4-arg signature, all 4 branches. requireConfig at line 64: KINETICA_URL-only check. NODE_ENV gate at line 455 wrapping both app.listen and startSessionSweep. |
| `kinetica_bi/server/tests/errorMiddleware.spec.ts` | 5 live tests covering all 4 middleware branches | ✓ VERIFIED | Tests 1-4 (typed errors via POST /api/sql) + Test 5 (generic Error standalone mount). All live, no it.todo remaining. |
| `kinetica_bi/server/tests/bootstrap.spec.ts` | Structural regression test for NODE_ENV gate | ✓ VERIFIED | Structural regex test live; runtime test it.skip with documented rationale. |
| `kinetica_bi/src/api/client.ts` | Body-peeking apiFetch, 3 error classes, throwForStatus | ✓ VERIFIED | ReauthRequiredError, PermissionError, UpstreamError exported. apiFetch clones 401 response, peeks code, dispatches only on REAUTH_REQUIRED. throwForStatus used by 26 helpers. |
| `kinetica_bi/src/store/auth.ts` | useAuthStore with reason: "session-expired" \| null | ✓ VERIFIED | reason field, AuthReason type, markUnauthenticated(reason?) signature. All bootstrap/login/logout paths set reason: null. |
| `kinetica_bi/src/hooks/useApiQuery.ts` | useApiQuery<T>(fetchFn, deps) with loading/data/error/refetch | ✓ VERIFIED | Active flag guard (no stuck spinners), PermissionError → error.kind="permission" + showToast, ReauthRequiredError → error.kind="reauth", finally { setLoading(false) }. |
| `kinetica_bi/src/store/toast.ts` | useToastStore with showToast, DEDUP_WINDOW_MS=5000 | ✓ VERIFIED | DEDUP_WINDOW_MS=5000, dedup key `${kind}::${message}`, auto-dismiss after 5000ms. |
| `kinetica_bi/src/components/Toast.tsx` | Toast container component | ✓ VERIFIED | Reads useToastStore, renders .toast-container with per-toast .toast.toast-${kind}, dismiss button. |
| `kinetica_bi/src/components/LoginPage.tsx` | Session-expired banner when reason==="session-expired" | ✓ VERIFIED | Reads reason from useAuthStore. Renders `<div className="login-banner" role="status">Your session has ended. Please sign in again.</div>` conditionally on reason==="session-expired". |
| `kinetica_bi/src/App.tsx` | Toast mounted, UNAUTHORIZED_EVENT → markUnauthenticated("session-expired") | ✓ VERIFIED | Toast mounted in all 3 render branches. UNAUTHORIZED_EVENT listener calls markUnauthenticated("session-expired"). |
| `kinetica_bi/src/styles/global.css` | .login-banner, .toast-container, .toast-permission, .widget-permission-denied | ✓ VERIFIED | All CSS classes present at lines 1201, 1211, 1238, 1268. |
| `kinetica_bi/server/.env.example` | No KINETICA_USERNAME or KINETICA_PASSWORD | ✓ VERIFIED | File contains only: PORT, KINETICA_URL, CORS_ORIGIN, DB_PATH, AUTH_SECRET, SESSION_ENCRYPTION_KEY. |
| `kinetica_bi/src/components/DashboardsPage.tsx` | useApiQuery migrations, .widget-permission-denied render | ✓ VERIFIED | listDashboards(), listDashboardTables(), listWidgets(), listViews() migrated. error.kind==="permission" renders .widget-permission-denied. |
| `kinetica_bi/src/components/DatasetsPage.tsx` | useApiQuery migrations, .widget-permission-denied render | ✓ VERIFIED | listTables() and fetchKineticaSchemas() migrated. error.kind==="permission" renders .widget-permission-denied. |
| `.planning/phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` | Phase 3 Delta appended | ✓ VERIFIED | "## Phase 3 Delta" at line 129. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| KineticaAuthError (routes) | 401+REAUTH_REQUIRED+clearCookie | errorMiddleware instanceof KineticaAuthError branch | ✓ VERIFIED | Routes use asyncHandler, no try/catch — errors bubble. Middleware clears cookie, sets code. Test 1 asserts. |
| KineticaPermissionError (routes) | 403 (no code) | errorMiddleware instanceof KineticaPermissionError branch | ✓ VERIFIED | Middleware returns 403 plain { error }. Test 2 asserts code is undefined. |
| 401+code:REAUTH_REQUIRED response | UNAUTHORIZED_EVENT dispatch | apiFetch body-peek | ✓ VERIFIED | apiFetch clones response, reads peek.code === "REAUTH_REQUIRED", dispatches only then. |
| UNAUTHORIZED_EVENT | markUnauthenticated("session-expired") | App.tsx event listener | ✓ VERIFIED | Handler calls markUnauthenticated("session-expired"). |
| useAuthStore.reason === "session-expired" | LoginPage banner render | LoginPage reads reason from useAuthStore | ✓ VERIFIED | Conditional render present; banner text exact match. |
| PermissionError (from throwForStatus) | error.kind="permission" + showToast | useApiQuery catch branch | ✓ VERIFIED | instanceof PermissionError → setError({kind:"permission"}) + showToast("You don't have permission..."). |
| showToast call | deduplicated toast render | useToastStore DEDUP_WINDOW_MS logic | ✓ VERIFIED | Dedup key and 5s window confirmed in store. Toast component subscribes to toasts array. |
| error.kind==="permission" | .widget-permission-denied placeholder | DashboardsPage / DatasetsPage conditional render | ✓ VERIFIED | Both components render `.widget-permission-denied` on error.kind==="permission". |
| requireConfig | KINETICA_URL-only boot guard | index.ts line 64-69 | ✓ VERIFIED | Single env var check; KINETICA_USERNAME/KINETICA_PASSWORD removed. |
| NODE_ENV gate | app.listen + startSessionSweep suppressed in tests | if(NODE_ENV !== "test") block | ✓ VERIFIED | Both calls inside single gate block. bootstrap.spec.ts structural regex test locks this. |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UX-01 | 03-01, 03-02, 03-03, 03-04 | Mid-session auth failure drops user to login screen with session-ended message | ? HUMAN_NEEDED | All mechanical components verified (middleware, apiFetch, authStore, LoginPage). Live flow per UAT.md Checks 1-3. |
| UX-02 | 03-01, 03-02, 03-04 | 403 permission failure stays inline on widget; user not logged out | ? HUMAN_NEEDED | Mechanical: 403 path, PermissionError, useApiQuery discrimination, .widget-permission-denied, toast. Live flow per UAT.md Checks 4-5. |
| UX-03 | 03-01, 03-02, 03-03 | Backend distinguishes REAUTH_REQUIRED (401+code) from permission denial (403 no code) | ✓ VERIFIED | errorMiddleware shape confirmed. apiFetch dispatches on code, not status. errorMiddleware Tests 1-2 assert exact shapes. |
| ADMN-01 | 03-05 | KINETICA_USERNAME/KINETICA_PASSWORD removed from server entirely | ✓ VERIFIED | git grep returns zero matches. .env untracked. Test specs use sentinel literal. |
| ADMN-02 | 03-05 | requireConfig narrowed to KINETICA_URL-only | ✓ VERIFIED | index.ts line 64-69 confirmed single-var check. |
| ADMN-03 | 03-05 | .env.example updated (no admin creds) | ✓ VERIFIED | .env.example contains no KINETICA_USERNAME or KINETICA_PASSWORD. |
| ADMN-04 | 03-06 | Server boots and operates with admin vars unset | ? HUMAN_NEEDED | Mechanical preconditions met (requireConfig narrowed, 211 tests pass, SC#5 clean). Live boot deferred to UAT.md Steps 1-9. |

**ADMN-04 note:** No orphaned requirements found. All 7 requirement IDs declared across phase plans; all 7 present in REQUIREMENTS.md.

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

Scan results: No TODO/FIXME/PLACEHOLDER comments in phase-created/modified files. No `return null` / `return {}` stubs. No empty implementations. No console.log-only handlers. The `it.skip` in bootstrap.spec.ts is intentional (documented rationale: vi.doMock fragility) and does not block the passing structural test.

---

## Human Verification Required

### 1. SC#1 — Session-expired banner and redirect (UAT Checks 1-3)

**Test:**
1. Log in as a valid Kinetica user
2. From terminal: `sqlite3 kinetica_bi/server/data/kinetica.db "DELETE FROM sessions"`
3. Click any UI action (navigate to Dashboards)

**Expected:** Redirected to LoginPage; banner "Your session has ended. Please sign in again." visible above the form; kbi_session cookie cleared in DevTools. Check 2: logout shows NO banner. Check 3: hard-refresh with no session shows NO banner.

**Why human:** Requires a live browser, a running backend, and sqlite3. Full redirect + cookie-clear behavior cannot be confirmed from code inspection alone.

### 2. SC#2 — 403 inline permission error + toast (UAT Checks 4-5)

**Test:**
Either use a restricted Kinetica user, or temporarily inject `throw new KineticaPermissionError("Test")` at the start of any route handler.

**Expected:** Affected widget shows dashed-border "Permission denied" placeholder. Bottom-right amber toast "You don't have permission to view this data." appears and auto-dismisses after 5s. User remains logged in. Other widgets keep working. Triggering the same 403 three times in 5s shows only one toast.

**Why human:** Requires a Kinetica user with restricted access or deliberate code injection. CSS rendering and toast behavior cannot be confirmed from code inspection alone.

### 3. SC#4 — Server boots without admin env vars (UAT Steps 1-9)

**Test:** See `03-UAT.md` § "Phase 3 Plan 06 — ADMN-04 Manual Smoke (Deferred)" for the full 9-step procedure. Core: `unset KINETICA_USERNAME KINETICA_PASSWORD`, start server, curl /api/health, login, curl /api/kinetica/schemas with session cookie.

**Expected:** Server starts cleanly, all endpoints respond correctly with no "Missing KINETICA_USERNAME" 500s.

**Why human:** Requires a live Kinetica instance. requireConfig is mechanically verified as KINETICA_URL-only; actual Kinetica credential passthrough from session cookies requires end-to-end execution.

---

## Mechanical Verification Summary

All code that can be checked without a running browser or Kinetica instance has been verified:

- **errorMiddleware** is present, exported, mounted pre-404, with all 4 translation branches (lines 431-453)
- **errorMiddleware tests**: 5 live tests, 0 todo, asserting exact HTTP shapes (401+REAUTH_REQUIRED, 403+no-code, 502+no-code, 500+generic)
- **apiFetch body-peek**: clones 401 response, dispatches UNAUTHORIZED_EVENT only when code==="REAUTH_REQUIRED"
- **3 client-side error classes**: ReauthRequiredError, PermissionError, UpstreamError with correct instanceof behavior
- **throwForStatus**: used by all 26 applicable helpers (login/fetchMe intentionally excluded with documented reasons)
- **useAuthStore.reason**: present, typed "session-expired"|null, set only by UNAUTHORIZED_EVENT path
- **App.tsx UNAUTHORIZED_EVENT listener**: calls markUnauthenticated("session-expired"); Toast mounted in all 3 branches
- **LoginPage banner**: conditional on reason==="session-expired" with exact copy "Your session has ended. Please sign in again."
- **useApiQuery hook**: active-flag guard, PermissionError → toast + error.kind="permission", finally { setLoading(false) }
- **Toast store**: DEDUP_WINDOW_MS=5000, dedup key format, 5s auto-dismiss
- **4 call site migrations**: DashboardsPage (list + 3 DashboardOpen), DatasetsPage (list + schema discovery)
- **Permission-denied rendering**: .widget-permission-denied in DashboardsPage and DatasetsPage
- **requireConfig**: KINETICA_URL-only, no credential vars
- **NODE_ENV gate**: wraps both app.listen and startSessionSweep; bootstrap.spec.ts structural test locks it
- **SC#5 audit**: `git grep -nE 'KINETICA_USERNAME|KINETICA_PASSWORD' -- ':!.planning/'` → exit code 1, zero matches
- **All 12 documented commits** present in git log (0411fa4 through 6f3f61f)
- **211 tests passing, 1 skipped, 0 failed** as of Plan 03-06

Phase 3 is mechanically complete. The three human verification items (SC#1, SC#2, SC#4) are deferred to `03-UAT.md` per explicit user decision during execution. When those UAT steps pass and `03-UAT.md` frontmatter is updated to `status: passed`, Phase 3 is shippable as the v1.0 milestone close.

---

_Verified: 2026-04-28_
_Verifier: Claude (gsd-verifier)_
