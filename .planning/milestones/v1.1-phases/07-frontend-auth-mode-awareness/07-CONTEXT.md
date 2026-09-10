# Phase 7: Frontend AUTH_MODE Awareness - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the browser render the correct login UI for the configured `AUTH_MODE` without rebuilding the frontend; expose `authMode` in the `/api/auth/me` response so the frontend has a single authoritative source after first authenticated request; capture the user's pre-redirect page in OIDC mode so they return to it after re-auth. First v1.1 phase that touches the frontend.

Server-side touches: `index.ts` `/api/auth/me` handler gains `authMode` top-level field. Frontend touches: `client.ts` (`fetchAuthConfig` helper, `AuthConfig` type, exported `API_BASE`), `store/auth.ts` (`authMode` field, updated `bootstrap()` flow), `LoginPage.tsx` (OIDC `<a href>` branch with `.login-submit` styling), `App.tsx` (sessionStorage-based return-to-page hook on `UNAUTHORIZED_EVENT`).

Covers requirements OIDC-01, UX-06, UX-08.

</domain>

<decisions>
## Implementation Decisions

### `/api/auth/me` `authMode` field (D-3 / UX-08)
- **Response shape (top-level): `{ user: { username }, authMode: "password" | "oidc" }`**. Matches SC2 verbatim; mirrors `/api/auth/config`'s bare `{authMode}` shape; clean destructure on the frontend (`const { user, authMode } = await fetchMe()`).
- **Source: closure-captured `authMode` const at `createApp()` top.** Phase 5 already declares `const authMode = (process.env.AUTH_MODE || "password") as "password" | "oidc"` once at boot (ARCHITECTURE.md AP-5: "no per-route `process.env.AUTH_MODE` reads"). The new `/me` handler closes over the same const — single source of truth across `/api/auth/config`, `/api/auth/me`, and the route gates.
- **Type tightening: literal union `"password" | "oidc"`** (not loose `string`) on both server JSON shape and frontend `AuthUser` type's sibling.
- **Existing `/me` body parser still works**: only adds a top-level `authMode` field; `user.username` unchanged. Backward-compatible for any v1.0 callers.

### Frontend consumption of `/me.authMode`
- **`bootstrap()` writes `authStore.authMode` from BOTH `/api/auth/config` AND `/api/auth/me`** — latest write wins. Sequence: `fetchAuthConfig` (sets) → `fetchMe` (overwrites if it succeeded). Belt-and-suspenders: if `/api/auth/config` failed but `/me` succeeded, `authMode` still gets set; in normal operation both agree.
- **Rationale**: `/me`'s authMode is the more authoritative source (came from a request that already passed `requireAuth` against a real session in the deployed mode), so it overwrites `/config`'s pre-auth read. ARCHITECTURE.md anti-pattern AP-5 ensures both use the same closure-const, so they always agree in practice.
- **No drift detection / no console.warn** on mismatch. Adding noise for a state that can't actually happen post-Phase-8 (mode flip wipes sessions; `/me` returns 401 → null user → no authMode write).

### `bootstrap()` failure resilience (PITFALL I-03 / I-04)
- **`fetchAuthConfig` throws → silent fallback.** `authMode` stays `null`; `LoginPage` falls through to the password form (safe default). User attempts login; if AUTH_MODE=oidc on the server, `/api/auth/login` returns 400 ("Password login is disabled. Use OIDC.") which surfaces in the existing `.login-error` banner. Self-correcting on next page load.
- **Order: SEQUENTIAL `fetchAuthConfig` → `fetchMe`** (per ARCHITECTURE.md). Two awaits; ~50–100ms extra vs parallel — negligible against the bootstrap "Loading…" UX. Keeps the latest-write-wins semantics simple to reason about.
- **No `Promise.all`, no reverse order, no skip-fetchAuthConfig-if-fetchMe-200.** The premature optimizations don't pay back in this code's UX scale.
- **Stale kbi_session cookie post-mode-flip is already handled.** Phase 8's MODE-05 wipes contradicting sessions at boot. After restart: `bootstrap fetchAuthConfig` returns new authMode, `fetchMe` returns 401 (row gone, server clears cookie via `requireAuth`'s `clearSessionCookie(res)`), `markUnauthenticated`, `LoginPage` renders correct UI. Phase 7 adds NO new code for this — it's a verify-only chain.
- **Mid-session AUTH_MODE drift is also already handled.** AUTH_MODE flip = server restart = session wipe = next API call gets 401 REAUTH_REQUIRED → existing `apiFetch` body-peek → `UNAUTHORIZED_EVENT` → `markUnauthenticated("session-expired")` → `LoginPage`. The existing chain (Phase 3 + Phase 6's verifications) handles it. No periodic poll, no on-event `/api/auth/config` refetch.

### OIDC SSO button on `LoginPage`
- **Element: `<a href={`${API_BASE}/api/auth/oidc/start`} className="login-submit">Sign in with SSO</a>`** — pure full-page navigation. No React state, no `preventDefault`, no JS-required flow. ARCHITECTURE.md spec verbatim.
- **No `onClick` handler on the button.** Return-to-page (UX-06) is captured in `App.tsx`'s `UNAUTHORIZED_EVENT` handler BEFORE `LoginPage` even renders — the user has already been bounced, sessionStorage is already written. By the time they click the SSO link, the work is done.
- **Class: `.login-submit`** (the existing primary-action class — visual consistency with the password "Sign in" button). Zero new CSS.
- **Text: "Sign in with SSO"** (ARCHITECTURE.md spec). Generic, non-IdP-specific. Matches PROJECT.md's "Generic OIDC over specific-IdP integration" v1.1 lock.
- **`API_BASE` is exported from `api/client.ts`** (currently file-local at `client.ts:1`). One-line change: `export const API_BASE = ...`. `LoginPage` imports it. Single source of truth for the base URL across the frontend.
- **Session-expired banner stays unchanged** (`reason === "session-expired"` block at LoginPage.tsx:31). Same copy in both modes — "Your session has ended. Please sign in again." reads correctly above either the password form or the SSO button.

### Test strategy
- **Server-side: extend `tests/auth.routes.spec.ts`** — `GET /api/auth/me` returns `{ user, authMode: "password" }` in password mode and `{ user, authMode: "oidc" }` in OIDC mode (use existing `stubOidcEnv` from auth.oidc.spec.ts pattern; seed appropriate session).
- **Frontend: new spec for `store/auth.ts`** — `bootstrap()` sets `authStore.authMode` from `/api/auth/config`, then overwrites from `/api/auth/me`. `fetchAuthConfig` failure → `authMode` stays null. `fetchMe` 401 → status `unauthenticated` (existing behavior preserved).
- **Frontend: new spec for `LoginPage.tsx`** — when `authStore.authMode === "oidc"`, renders the SSO link with the right href; password form NOT in DOM. When `authMode === "password"` or `null`, renders the existing username/password form. `reason === "session-expired"` banner renders in both branches.
- **Frontend: extend or new spec for `App.tsx`** — on `UNAUTHORIZED_EVENT`, sessionStorage is written with the current page state (return-to-page hook).
- **No e2e (Playwright) for v1.1.** Repo has no Playwright; standing it up is out of scope. Server route + Vitest (or whatever test runner the frontend uses; planner discovers) is sufficient.

### Return-to-page after OIDC re-auth (UX-06 / TS-14) — Claude's Discretion
**User opted not to discuss this area; default to ARCHITECTURE.md TS-14 sessionStorage approach.** Planner picks specifics.

Recommended pattern (for the planner to confirm):
- **Write trigger**: `App.tsx`'s `UNAUTHORIZED_EVENT` handler (where `markUnauthenticated("session-expired")` already fires) — write `sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page, dashboardId, viewMode }))` BEFORE the state transition.
- **Gate by mode**: only write if `authStore.authMode === "oidc"`. In password mode, the user re-logs in immediately on the same browser tab — no IdP round-trip — and the in-memory page state survives.
- **Read+restore+clear trigger**: `App.tsx` mount effect, AFTER `bootstrap()` sets `status === "authenticated"` — read from sessionStorage, set the page state via the existing `setPage` / `setDashboardViewMode` / dashboard-specific handlers, then `sessionStorage.removeItem("kbi_returnTo")`. Single-use.
- **Storage shape**: `{ page: "dashboards" | "datasets" | "settings", dashboardViewMode?: string, dashboardId?: number }` — capture enough to reconstruct the in-memory page state. Schema-versioned implicitly by key name (`kbi_returnTo` is v1; future bump = `kbi_returnTo_v2`).
- **Missing/corrupt handling**: try/catch JSON.parse; on any failure, clear the key and land on the default page (`dashboards/list`). Never crash the app for stale storage.
- **Scope-out**: deep-link state inside a dashboard (open widget modal, edit dialog, scroll position) is NOT in scope for v1.1. Top-level page + dashboard ID is sufficient.

Planner can choose to extract the read/write into a small `src/utils/returnTo.ts` helper or keep them inline in `App.tsx`. Cohesion vs file-count is the planner's call.

### Carrying forward from prior phases (already locked, do not re-decide)
- **`/api/auth/config`** already exists (Phase 5) with `Cache-Control: no-store` set explicitly (PITFALL I-03). Phase 7's `fetchAuthConfig` consumes the existing endpoint — server-side route is unchanged. SC5 is already satisfied; verify-only.
- **`fetchAuthConfig` uses raw `fetch`, NOT `apiFetch`.** ARCHITECTURE.md note: this endpoint is unauthenticated and must NOT trigger `UNAUTHORIZED_EVENT` if it fails.
- **`fetchMe` uses raw `fetch`, NOT `apiFetch`.** `client.ts:100-108` comment: "Intentionally uses raw fetch — treats 401 as 'not authenticated', not as a session expiry." Phase 7 keeps this contract; the addition of `authMode` to the response body is a JSON shape change, not a fetch-layer change.
- **`apiLogout()` is already `await`-ed** in `store/auth.ts:45`. PITFALL U-04 (logout-not-awaited) is satisfied today; Phase 7 verifies any new logout call sites also await.
- **401-REAUTH chain unchanged** (Phase 3 + Phase 6 verifications): `apiFetch` body-peeks `code: "REAUTH_REQUIRED"` → dispatches `UNAUTHORIZED_EVENT` → `App.tsx` calls `markUnauthenticated("session-expired")` → `LoginPage` renders banner. Phase 7 adds the sessionStorage write at the same hook point but doesn't change the chain.
- **Frontend uses `useState<Page>` for routing (no react-router)**. Return-to-page hooks setPage / setDashboardViewMode / dashboard ID — no URL manipulation, no router state.
- **`AuthReason` type stays `"session-expired" | null`.** No new reason values for OIDC.
- **No `VITE_AUTH_MODE` build-time env var.** ARCHITECTURE.md AP rationale: same frontend bundle must support both modes. PITFALL I-03 lock.

### Claude's Discretion
- Exact test runner / file layout for new frontend specs (`__tests__/` folder, co-located, vitest vs jest — planner discovers).
- Whether `fetchAuthConfig` and the `AuthConfig` type live above or below `fetchMe` in `client.ts` — alphabetical vs functional grouping; planner picks what reads cleanest.
- Internal naming of the return-to-page sessionStorage helper (if extracted) — `returnTo.ts`, `pageRestore.ts`, etc.
- Whether `authMode` in `authStore` defaults to `"password"` or `null`. Recommend `null` (per ARCHITECTURE.md) so a missing fetchAuthConfig is distinguishable from confirmed-password — but planner can choose the cleaner default.
- Whether `LoginPage` reads `authMode` directly from the store or accepts it as a prop from a wrapping component (recommend direct store read; consistent with existing `useAuthStore` usage in LoginPage.tsx:5-7).
- Whether the SSO link's target opens in the same tab (default, ARCHITECTURE.md spec) or `target="_blank"` — keep same-tab; the IdP redirect dance requires returning to the same window.
- Exact order of frontend changes: planner can land all four files in one wave (mechanical) or split (test-first per file).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frontend changes
- `.planning/research/ARCHITECTURE.md` §"Frontend Changes" (line 459+) — `fetchAuthConfig` helper, `AuthConfig` type, `authStore.authMode` field, `bootstrap()` updated body, `LoginPage` OIDC branch JSX (verbatim)
- `.planning/research/ARCHITECTURE.md` §"AUTH_MODE Discovery: Runtime via `GET /api/auth/config`" — rationale for runtime over build-time, why no `VITE_AUTH_MODE`
- `.planning/research/ARCHITECTURE.md` §"Data Flow: End-to-End OIDC Session" (line 540+) — steps 1-5 (bootstrap, LoginPage render, click, callback redirect, post-callback bootstrap)

### Features in scope
- `.planning/research/FEATURES.md` TS-1 (SSO button on LoginPage — In scope)
- `.planning/research/FEATURES.md` TS-14 (return-to-page after re-auth — In scope; sessionStorage approach)
- `.planning/research/FEATURES.md` D-3 (`/api/auth/me` returns `authMode` — In scope; one extra JSON field)

### Pitfalls in scope
- `.planning/research/PITFALLS.md` I-03 (AuthMode change: frontend cache stale — `Cache-Control: no-store` already set on `/api/auth/config` in Phase 5; refetch on bootstrap is Phase 7's job)
- `.planning/research/PITFALLS.md` I-04 (session cookie survives mode flip — bootstrap must re-fetch `/api/auth/me`; existing 401-REAUTH chain handles the cookie clearing)
- `.planning/research/PITFALLS.md` M-03 (frontend login page caches mode — preempted by `Cache-Control: no-store` and per-bootstrap refetch)
- `.planning/research/PITFALLS.md` U-01 (deep-link lost — sessionStorage save before IdP redirect; UX-06 / TS-14)
- `.planning/research/PITFALLS.md` U-03 (double-render flicker on bootstrap — verify `App.tsx` gate before rendering authenticated UI; existing `status === "unknown"` gate already handles this)
- `.planning/research/PITFALLS.md` U-04 (logout not awaited — frontend concern; `store/auth.ts:45` already awaits, verify any new logout call sites)

### Server-side touch (small)
- `kinetica_bi/server/src/index.ts:163-172` — current `/api/auth/me` handler; Phase 7 adds top-level `authMode` field to the response
- `kinetica_bi/server/tests/auth.routes.spec.ts` — extend with `/me` `authMode` field assertions in both modes (use existing `mockKineticaLoginOK` for password, the `seedOidcSession` pattern from Phase 6 for OIDC)

### Existing frontend code (read before editing)
- `kinetica_bi/src/api/client.ts` — `API_BASE` (line 1; needs export), `apiFetch` (line 36 — `UNAUTHORIZED_EVENT` dispatch path), `fetchMe` (line 100; uses raw fetch — return type expands), `UNAUTHORIZED_EVENT` (line 3)
- `kinetica_bi/src/store/auth.ts` — `AuthState` type (line 7), `bootstrap()` (line 23; needs `fetchAuthConfig` step), `markUnauthenticated` (line 52), `AuthReason` type (line 5)
- `kinetica_bi/src/components/LoginPage.tsx` — full file (73 lines); existing form, `reason === "session-expired"` banner at line 31, `.login-banner` / `.login-card` / `.login-submit` classes
- `kinetica_bi/src/App.tsx` — `UNAUTHORIZED_EVENT` handler at line 24-28 (Phase 7 adds sessionStorage write here for UX-06), `useState<Page>` routing (line 14), bootstrap effect (line 21)
- `kinetica_bi/src/hooks/useApiQuery.ts:44` (existing comment about UNAUTHORIZED_EVENT routing — verify the chain still works)

### Phase 4-6 contracts (consumed by Phase 7)
- `.planning/phases/06-requireauth-helper-credential-branch/06-CONTEXT.md` — Phase 6 contract: helper Bearer/Basic + auth_mode audit field. Phase 7 doesn't change this; it just creates OIDC sessions that the helper will use.
- `.planning/phases/05-oidc-module-routes/05-CONTEXT.md` — `/api/auth/config` shape, `Cache-Control: no-store` lock, `/api/auth/oidc/start` endpoint contract
- `.planning/phases/05-oidc-module-routes/05-CONTEXT.md` §"specifics" — "The success redirect target for `/oidc/callback` is `/` (app root) — frontend bootstrap (Phase 7) handles routing the user from there. Phase 5 doesn't implement return-to-page (UX-06, Phase 7's TS-14)." — Phase 7's responsibility starts at the redirect to `/`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`apiFetch`** (`client.ts:36-57`) — body-peek + `UNAUTHORIZED_EVENT` dispatch. Phase 7 doesn't change it; `fetchAuthConfig` and `fetchMe` use raw `fetch` instead.
- **`UNAUTHORIZED_EVENT`** (`client.ts:3`) — single dispatch site at line 53. Already imported by `App.tsx:9`. Phase 7 adds a sessionStorage write inside the existing `App.tsx` handler at line 24-28.
- **`useAuthStore`** (`store/auth.ts:18`) — Zustand store; existing fields `status / user / error / reason`. Phase 7 adds `authMode: "password" | "oidc" | null`.
- **`fetchMe`** (`client.ts:100-108`) — raw fetch, 401 → null contract. Phase 7 expands the response type and the success path's return value.
- **`AuthReason`** (`store/auth.ts:5`) — `"session-expired" | null`. Unchanged in Phase 7.
- **`.login-submit`** class — primary-action button styling. OIDC `<a>` link reuses it.
- **`.login-banner`** class (LoginPage.tsx:32) — session-expired banner. Stays in OIDC branch.
- **`.login-card` / `.login-shell` / `.login-brand` / `.login-title` / `.login-sub`** — existing layout classes. OIDC branch reuses them.

### Established Patterns
- **Raw fetch for unauthenticated endpoints**: `fetchMe` uses raw fetch (line 103 comment); `fetchAuthConfig` follows the same pattern (ARCHITECTURE.md note).
- **`apiFetch` for authenticated endpoints**: every `/api/dashboards`, `/api/sql`, `/api/widgets` etc. uses `apiFetch` so 401 dispatches `UNAUTHORIZED_EVENT`. Phase 7 doesn't change this.
- **Store-driven UI**: `LoginPage` reads `authStore.error / authStore.reason` directly via `useAuthStore` selectors; Phase 7 adds a third selector for `authMode`.
- **Sequential awaits in bootstrap**: existing `bootstrap()` does `await fetchMe()` then `set({ ... })`. Phase 7 prepends `await fetchAuthConfig()` then `set({ authMode })`. Same pattern, two awaits.
- **`useState<Page>` for routing**: `App.tsx:14` (`Page = "dashboards" | "datasets" | "settings"`); `dashboardViewMode` is sibling state (line 15). Return-to-page restores via existing setters.
- **Single source for `API_BASE`**: `client.ts:1` declares it; Phase 7 exports it so `LoginPage` can use the same value.

### Integration Points
- **`kinetica_bi/server/src/index.ts:163-172`** — `/api/auth/me` handler. Phase 7 adds `authMode` to the returned JSON (closure-const source).
- **`kinetica_bi/src/api/client.ts`** — exports `API_BASE` (currently file-local), adds `AuthConfig` type, adds `fetchAuthConfig()`, expands `AuthUser` consumers (or adds a new `fetchMe` return type carrying `authMode`).
- **`kinetica_bi/src/store/auth.ts`** — `AuthState` adds `authMode`, `bootstrap()` adds the `fetchAuthConfig` step.
- **`kinetica_bi/src/components/LoginPage.tsx`** — early-return for `authMode === "oidc"` (renders SSO `<a>` link); existing form is the fallthrough for `"password"` and `null`.
- **`kinetica_bi/src/App.tsx`** — `UNAUTHORIZED_EVENT` handler at line 24-28 gains a sessionStorage-write side effect; mount effect after `bootstrap` reads + clears the same key.

</code_context>

<specifics>
## Specific Ideas

- **Single source of truth = closure-const**: the same `authMode` const declared at `createApp()` top serves `/api/auth/config`, `/api/auth/me`, `POST /api/auth/login` gate, `GET /api/auth/oidc/start` gate, and `GET /api/auth/oidc/callback` gate. No per-route `process.env.AUTH_MODE` read anywhere. Phase 5's lock; Phase 7 reuses.
- **Pure-link OIDC button**: an `<a href>` is sufficient because all the pre-redirect work (sessionStorage write) happens at `UNAUTHORIZED_EVENT` time, BEFORE the user is bounced to LoginPage. By the time they click "Sign in with SSO", the return-to-page state is already persisted.
- **Password-mode parity**: `LoginPage` renders identically for `authMode === "password"` and `authMode === null`. The existing form is the safe default; the OIDC branch is an early return guarded by the strict equality `=== "oidc"`.
- **`/me` is the authoritative source of authMode post-auth**: `bootstrap()`'s sequence guarantees that whenever the user is authenticated, `authStore.authMode` reflects the deployment's actual mode (not just the pre-auth `/config` read).
- **Server `/api/auth/login` returns 400 in OIDC mode** (Phase 5 lock). If the user fills the password form when OIDC is active (e.g., `fetchAuthConfig` failed → null → password fallback), the 400 surfaces in `.login-error` with the locked message "Password login is disabled. Use OIDC." — visible recovery path.

</specifics>

<deferred>
## Deferred Ideas

- **`AUTH_OIDC_ISSUER_LABEL` for branded SSO button** (e.g., "Sign in with Okta") — out of scope; Phase 5 already deferred this. v2 if requested.
- **IdP icon / logo on the SSO button** — out of scope; bare text "Sign in with SSO" suffices.
- **`/api/auth/me` returning user roles or claims (email, display name)** — D-2 differentiator deferred to post-v1.1; Phase 4 stores `idToken` for this future use.
- **Drift detection / console.warn on `/me.authMode` ≠ `/config.authMode`** — rejected; can't actually happen post-Phase-8.
- **Periodic `/api/auth/config` poll for AUTH_MODE drift** — rejected; AUTH_MODE flip requires server restart.
- **Refetch `/api/auth/config` on `UNAUTHORIZED_EVENT`** — rejected; the existing chain handles mid-session mode flip via session wipe.
- **e2e Playwright tests** — out of scope; repo has no Playwright setup. Vitest + supertest covers Phase 7.
- **Deep-link state inside dashboards** (open widget modal, scroll position, edit dialog state) for return-to-page — out of scope; top-level page + dashboard ID is enough.
- **react-router** — out of scope; `useState<Page>` routing is the pattern. Return-to-page works without a router.
- **Schema-versioning sessionStorage key** (e.g., `kbi_returnTo_v2`) — premature; key name change suffices when shape changes.
- **Connection-error banner on LoginPage when `/config` fails** — rejected; silent fallback to password form is the spec'd behavior; user can refresh.
- **`target="_blank"` on SSO link** — rejected; OIDC redirect dance requires same-tab navigation.

</deferred>

---

*Phase: 07-frontend-auth-mode-awareness*
*Context gathered: 2026-05-01*
