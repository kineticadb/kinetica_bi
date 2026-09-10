# Phase 7: Frontend AUTH_MODE Awareness - Research

**Researched:** 2026-05-01
**Domain:** React SPA auth-mode-aware UI + Zustand store hydration + sessionStorage return-to-page + one-line server JSON shape change
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### `/api/auth/me` `authMode` field (D-3 / UX-08)
- **Response shape (top-level): `{ user: { username }, authMode: "password" | "oidc" }`**. Matches SC2 verbatim; mirrors `/api/auth/config`'s bare `{authMode}` shape; clean destructure on the frontend (`const { user, authMode } = await fetchMe()`).
- **Source: closure-captured `authMode` const at `createApp()` top.** Phase 5 already declares `const authMode = (process.env.AUTH_MODE || "password") as "password" | "oidc"` once at boot (ARCHITECTURE.md AP-5: "no per-route `process.env.AUTH_MODE` reads"). The new `/me` handler closes over the same const — single source of truth across `/api/auth/config`, `/api/auth/me`, and the route gates.
- **Type tightening: literal union `"password" | "oidc"`** (not loose `string`) on both server JSON shape and frontend `AuthUser` type's sibling.
- **Existing `/me` body parser still works**: only adds a top-level `authMode` field; `user.username` unchanged. Backward-compatible for any v1.0 callers.

#### Frontend consumption of `/me.authMode`
- **`bootstrap()` writes `authStore.authMode` from BOTH `/api/auth/config` AND `/api/auth/me`** — latest write wins. Sequence: `fetchAuthConfig` (sets) → `fetchMe` (overwrites if it succeeded). Belt-and-suspenders: if `/api/auth/config` failed but `/me` succeeded, `authMode` still gets set; in normal operation both agree.
- **Rationale**: `/me`'s authMode is the more authoritative source (came from a request that already passed `requireAuth` against a real session in the deployed mode), so it overwrites `/config`'s pre-auth read. ARCHITECTURE.md anti-pattern AP-5 ensures both use the same closure-const, so they always agree in practice.
- **No drift detection / no console.warn** on mismatch. Adding noise for a state that can't actually happen post-Phase-8 (mode flip wipes sessions; `/me` returns 401 → null user → no authMode write).

#### `bootstrap()` failure resilience (PITFALL I-03 / I-04)
- **`fetchAuthConfig` throws → silent fallback.** `authMode` stays `null`; `LoginPage` falls through to the password form (safe default). User attempts login; if AUTH_MODE=oidc on the server, `/api/auth/login` returns 400 ("Password login is disabled. Use OIDC.") which surfaces in the existing `.login-error` banner. Self-correcting on next page load.
- **Order: SEQUENTIAL `fetchAuthConfig` → `fetchMe`** (per ARCHITECTURE.md). Two awaits; ~50–100ms extra vs parallel — negligible against the bootstrap "Loading…" UX. Keeps the latest-write-wins semantics simple to reason about.
- **No `Promise.all`, no reverse order, no skip-fetchAuthConfig-if-fetchMe-200.** The premature optimizations don't pay back in this code's UX scale.
- **Stale kbi_session cookie post-mode-flip is already handled.** Phase 8's MODE-05 wipes contradicting sessions at boot. After restart: `bootstrap fetchAuthConfig` returns new authMode, `fetchMe` returns 401 (row gone, server clears cookie via `requireAuth`'s `clearSessionCookie(res)`), `markUnauthenticated`, `LoginPage` renders correct UI. Phase 7 adds NO new code for this — it's a verify-only chain.
- **Mid-session AUTH_MODE drift is also already handled.** AUTH_MODE flip = server restart = session wipe = next API call gets 401 REAUTH_REQUIRED → existing `apiFetch` body-peek → `UNAUTHORIZED_EVENT` → `markUnauthenticated("session-expired")` → `LoginPage`. The existing chain (Phase 3 + Phase 6's verifications) handles it. No periodic poll, no on-event `/api/auth/config` refetch.

#### OIDC SSO button on `LoginPage`
- **Element: `<a href={`${API_BASE}/api/auth/oidc/start`} className="login-submit">Sign in with SSO</a>`** — pure full-page navigation. No React state, no `preventDefault`, no JS-required flow. ARCHITECTURE.md spec verbatim.
- **No `onClick` handler on the button.** Return-to-page (UX-06) is captured in `App.tsx`'s `UNAUTHORIZED_EVENT` handler BEFORE `LoginPage` even renders — the user has already been bounced, sessionStorage is already written. By the time they click the SSO link, the work is done.
- **Class: `.login-submit`** (the existing primary-action class — visual consistency with the password "Sign in" button). Zero new CSS.
- **Text: "Sign in with SSO"** (ARCHITECTURE.md spec). Generic, non-IdP-specific. Matches PROJECT.md's "Generic OIDC over specific-IdP integration" v1.1 lock.
- **`API_BASE` is exported from `api/client.ts`** (currently file-local at `client.ts:1`). One-line change: `export const API_BASE = ...`. `LoginPage` imports it. Single source of truth for the base URL across the frontend.
- **Session-expired banner stays unchanged** (`reason === "session-expired"` block at LoginPage.tsx:31). Same copy in both modes — "Your session has ended. Please sign in again." reads correctly above either the password form or the SSO button.

#### Test strategy
- **Server-side: extend `tests/auth.routes.spec.ts`** — `GET /api/auth/me` returns `{ user, authMode: "password" }` in password mode and `{ user, authMode: "oidc" }` in OIDC mode (use existing `stubOidcEnv` from auth.oidc.spec.ts pattern; seed appropriate session).
- **Frontend: new spec for `store/auth.ts`** — `bootstrap()` sets `authStore.authMode` from `/api/auth/config`, then overwrites from `/api/auth/me`. `fetchAuthConfig` failure → `authMode` stays null. `fetchMe` 401 → status `unauthenticated` (existing behavior preserved).
- **Frontend: new spec for `LoginPage.tsx`** — when `authStore.authMode === "oidc"`, renders the SSO link with the right href; password form NOT in DOM. When `authMode === "password"` or `null`, renders the existing username/password form. `reason === "session-expired"` banner renders in both branches.
- **Frontend: extend or new spec for `App.tsx`** — on `UNAUTHORIZED_EVENT`, sessionStorage is written with the current page state (return-to-page hook).
- **No e2e (Playwright) for v1.1.** Repo has no Playwright; standing it up is out of scope. Server route + Vitest (or whatever test runner the frontend uses; planner discovers) is sufficient.

#### Carrying forward from prior phases (already locked, do not re-decide)
- **`/api/auth/config`** already exists (Phase 5) with `Cache-Control: no-store` set explicitly (PITFALL I-03). Phase 7's `fetchAuthConfig` consumes the existing endpoint — server-side route is unchanged. SC5 is already satisfied; verify-only.
- **`fetchAuthConfig` uses raw `fetch`, NOT `apiFetch`.** ARCHITECTURE.md note: this endpoint is unauthenticated and must NOT trigger `UNAUTHORIZED_EVENT` if it fails.
- **`fetchMe` uses raw `fetch`, NOT `apiFetch`.** `client.ts:100-108` comment: "Intentionally uses raw fetch — treats 401 as 'not authenticated', not as a session expiry." Phase 7 keeps this contract; the addition of `authMode` to the response body is a JSON shape change, not a fetch-layer change.
- **`apiLogout()` is already `await`-ed** in `store/auth.ts:45`. PITFALL U-04 (logout-not-awaited) is satisfied today; Phase 7 verifies any new logout call sites also await.
- **401-REAUTH chain unchanged** (Phase 3 + Phase 6 verifications): `apiFetch` body-peeks `code: "REAUTH_REQUIRED"` → dispatches `UNAUTHORIZED_EVENT` → `App.tsx` calls `markUnauthenticated("session-expired")` → `LoginPage` renders banner. Phase 7 adds the sessionStorage write at the same hook point but doesn't change the chain.
- **Frontend uses `useState<Page>` for routing (no react-router)**. Return-to-page hooks setPage / setDashboardViewMode / dashboard ID — no URL manipulation, no router state.
- **`AuthReason` type stays `"session-expired" | null`.** No new reason values for OIDC.
- **No `VITE_AUTH_MODE` build-time env var.** ARCHITECTURE.md AP rationale: same frontend bundle must support both modes. PITFALL I-03 lock.

#### Return-to-page after OIDC re-auth (UX-06 / TS-14) — Recommended Pattern
- **Write trigger**: `App.tsx`'s `UNAUTHORIZED_EVENT` handler (where `markUnauthenticated("session-expired")` already fires) — write `sessionStorage.setItem("kbi_returnTo", JSON.stringify({ page, dashboardId, viewMode }))` BEFORE the state transition.
- **Gate by mode**: only write if `authStore.authMode === "oidc"`. In password mode, the user re-logs in immediately on the same browser tab — no IdP round-trip — and the in-memory page state survives.
- **Read+restore+clear trigger**: `App.tsx` mount effect, AFTER `bootstrap()` sets `status === "authenticated"` — read from sessionStorage, set the page state via the existing `setPage` / `setDashboardViewMode` / dashboard-specific handlers, then `sessionStorage.removeItem("kbi_returnTo")`. Single-use.
- **Storage shape**: `{ page: "dashboards" | "datasets" | "settings", dashboardViewMode?: string, dashboardId?: number }` — capture enough to reconstruct the in-memory page state.
- **Missing/corrupt handling**: try/catch JSON.parse; on any failure, clear the key and land on the default page (`dashboards/list`). Never crash the app for stale storage.
- **Scope-out**: deep-link state inside a dashboard (open widget modal, edit dialog, scroll position) is NOT in scope for v1.1. Top-level page + dashboard ID is sufficient.

### Claude's Discretion
- Exact test runner / file layout for new frontend specs (`__tests__/` folder, co-located, vitest vs jest — planner discovers).
- Whether `fetchAuthConfig` and the `AuthConfig` type live above or below `fetchMe` in `client.ts` — alphabetical vs functional grouping; planner picks what reads cleanest.
- Internal naming of the return-to-page sessionStorage helper (if extracted) — `returnTo.ts`, `pageRestore.ts`, etc.
- Whether `authMode` in `authStore` defaults to `"password"` or `null`. Recommend `null` (per ARCHITECTURE.md) so a missing fetchAuthConfig is distinguishable from confirmed-password — but planner can choose the cleaner default.
- Whether `LoginPage` reads `authMode` directly from the store or accepts it as a prop from a wrapping component (recommend direct store read; consistent with existing `useAuthStore` usage in LoginPage.tsx:5-7).
- Whether the SSO link's target opens in the same tab (default, ARCHITECTURE.md spec) or `target="_blank"` — keep same-tab; the IdP redirect dance requires returning to the same window.
- Exact order of frontend changes: planner can land all four files in one wave (mechanical) or split (test-first per file).

### Deferred Ideas (OUT OF SCOPE)
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
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OIDC-01 | When `AUTH_MODE=oidc`, the LoginPage displays a "Sign in with SSO" button instead of the username/password form. Clicking it issues `GET /api/auth/oidc/start`. | Architecture Pattern A1 (LoginPage early-return on `authMode === "oidc"`); Code Example #2 (OIDC button as `<a href>`); existing `/api/auth/config` route returns `{authMode}` (Phase 5, server-verified at index.ts:226-229); existing `/api/auth/oidc/start` route exists (Phase 5, index.ts:233). Bootstrap flow (Pattern A2) writes `authStore.authMode` so LoginPage can render the correct UI without rebuild. |
| UX-06 | After a successful OIDC callback completes a fresh session, the user lands back at the page they were on when the re-auth was triggered. | Architecture Pattern A3 (sessionStorage at `UNAUTHORIZED_EVENT`); Code Example #4 (write hook in App.tsx UNAUTHORIZED handler); Code Example #5 (read+restore+clear in App.tsx mount effect after `status === "authenticated"`). Pitfall U-01 prevention. Phase 5 callback redirects to `/`; Phase 7 owns the post-`/`-bootstrap restore step. |
| UX-08 | `GET /api/auth/me` includes `authMode` in its response so the frontend can conditionally render mode-specific UX without hard-coding the mode at build time. | One-line server change at index.ts:219 — add `authMode` to the JSON response body using the closure-const at index.ts:82. Frontend consumes via expanded `fetchMe()` return type. Both `/config` and `/me` use the same closure-const so they always agree. |
</phase_requirements>

## Summary

Phase 7 is the v1.1 frontend's first contact with OIDC. It's a small, mechanical, four-file change, gated by a one-line server JSON shape addition. The hard work — runtime AUTH_MODE discovery via `/api/auth/config`, the OIDC start/callback routes, the 401-REAUTH chain, the session-expired banner, and Cache-Control: no-store — is already in place from Phases 3, 5, and 6. Phase 7 wires the existing pieces to render the correct LoginPage variant and to capture the user's pre-redirect page so they return after IdP round-trip.

The dominant risks are not implementation complexity but test infrastructure: the frontend (`kinetica_bi/`) currently has **NO test runner installed** — no Vitest, no Jest, no React Testing Library, no jsdom. The server has Vitest 4.1.5 + Supertest. The existing CONTEXT.md anticipates this gap ("planner discovers"). Standing up frontend Vitest + RTL + jsdom is the largest single sub-task in Phase 7. The server-side change is one line of JSON in `index.ts:219`.

**Primary recommendation:** Wave 0 stands up frontend Vitest 3.x + jsdom + @testing-library/react + @testing-library/jest-dom + @testing-library/user-event in `kinetica_bi/package.json`. Then sequentially: (1) export `API_BASE` and add `fetchAuthConfig` + `AuthConfig` to `client.ts`; expand `fetchMe` return type. (2) Add `authMode` field + bootstrap update to `store/auth.ts`. (3) Add `authMode === "oidc"` early-return branch to `LoginPage.tsx`. (4) Add sessionStorage write in `App.tsx`'s `UNAUTHORIZED_EVENT` handler + read-restore-clear in mount effect after `status === "authenticated"`. (5) Add `authMode` to the `/api/auth/me` response in `kinetica_bi/server/src/index.ts:219`. Server-side test extension goes in `auth.routes.spec.ts`; frontend specs are new. No e2e.

## Standard Stack

### Core (frontend test infrastructure — Wave 0)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^3.0.0 (latest 5.0.12 has been split as Vitest 4 LTS; see note) | Test runner | Native Vite integration; reuses `vite.config.ts`; same family as the server's vitest 4.1.5. Drop-in for the Vitest 4 dev experience the team already uses. |
| jsdom | ^29.0.0 | DOM environment | Required by RTL to render React components in Node. Standard pairing with Vitest. |
| @testing-library/react | ^16.0.0 | React component testing | The de-facto React testing library; encourages user-facing assertions over implementation details. Pairs with React 18.3 (already in deps). |
| @testing-library/jest-dom | ^6.0.0 | DOM matchers | `toBeInTheDocument`, `toHaveAttribute`, etc. Vitest has Jest-compatible API; RTL guides recommend this for ergonomic assertions. |
| @testing-library/user-event | ^14.0.0 | User interaction simulation | Modern click/type APIs that fire correct event sequences (better than `fireEvent` for focus/blur). |

**Note on vitest version mismatch:** The server uses vitest@4.1.5. The frontend should align (^4.0.0). npm view confirmed `vitest@5.0.12` is current latest — use `^4.0.0` to match server and stay on a Vitest line that has stable RTL ecosystem support. Confidence: MEDIUM — the planner can pin to whatever exact version `kinetica_bi/server/package.json` already locks (4.1.5) for consistency, or jump to 5.0.12 which is the npm registry's latest (verified 2026-05-01).

### Core (frontend production — already installed; verify-only)

| Library | Version | Purpose |
|---------|---------|---------|
| react | ^18.3.1 | UI framework |
| zustand | ^4.5.2 | Auth store (`useAuthStore`) — `bootstrap()`, `markUnauthenticated`, `authMode` field add |
| vite | ^5.2.0 | Bundler — used at runtime via `import.meta.env.VITE_API_URL` |

**Version verification (npm view, 2026-05-01):**
- `vitest`: 5.0.12 (latest); server pinned to ^4.1.5
- `jsdom`: 29.1.1 (latest)
- `@testing-library/react`: 16.3.2 (latest)
- `@testing-library/jest-dom`: 6.9.1 (latest)
- `@testing-library/user-event`: 14.6.1 (latest)
- `zustand`: production code uses `^4.5.2`; current latest (May 2026) is in the v4.x line — already current

### Supporting (already in repo; no install needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| supertest | ^7.2.2 | Server route HTTP testing | Server-side `auth.routes.spec.ts` extension for new `/me.authMode` field. |
| @vitejs/plugin-react | ^4.3.0 | Vite React JSX | Vitest reuses `vite.config.ts`; this is already in the bundle. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest + RTL | Jest + RTL | Jest needs separate Babel/transform pipeline; Vitest reuses Vite's existing TSX setup. Strongly rejected — adds tooling debt. |
| Vitest + RTL | Playwright (e2e) | E2E covers more, but the repo has no Playwright setup; user-locked OUT OF SCOPE in CONTEXT.md "Deferred". |
| RTL | Enzyme | Enzyme is unmaintained for React 18; not a real option. |
| jsdom | happy-dom | happy-dom is faster but has more edge cases; jsdom is the standard. Unless the test suite gets large, jsdom is the safer call. |
| sessionStorage for return-to-page | localStorage | sessionStorage cleared on tab-close = better security profile for auth round-trip data. Locked in CONTEXT.md and ARCHITECTURE.md TS-14. |
| sessionStorage | Encode `returnTo` into OIDC `state` parameter | Server-side decode + validation overhead, plus URL-length limits with deep dashboard state. SessionStorage stays browser-side, simpler. Rejected. |

**Installation (Wave 0):**

```bash
cd kinetica_bi
npm install --save-dev vitest@^4.1.5 jsdom@^29.0.0 \
  @testing-library/react@^16.0.0 \
  @testing-library/jest-dom@^6.0.0 \
  @testing-library/user-event@^14.0.0
```

The `vite.config.ts` needs a `test` block added (or split into `vitest.config.ts`):

```typescript
// vitest.config.ts (or extend vite.config.ts)
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,                 // describe/it/expect without imports (matches server style)
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.spec.{ts,tsx}"],
    isolate: true,                 // matches server pattern
  },
});
```

`tsconfig.json` (or a separate `tsconfig.test.json`) gains `"types": ["vitest/globals", "@testing-library/jest-dom"]`.

Add a `test` script in `kinetica_bi/package.json`:
```json
"test": "vitest --run"
```

## Architecture Patterns

### Recommended Project Structure

```
kinetica_bi/
├── src/
│   ├── api/
│   │   └── client.ts              # MODIFY: export API_BASE; add AuthConfig + fetchAuthConfig; expand fetchMe return
│   ├── store/
│   │   └── auth.ts                # MODIFY: AuthState gains authMode field; bootstrap() prepends fetchAuthConfig step
│   ├── components/
│   │   └── LoginPage.tsx          # MODIFY: early-return for authMode === "oidc" with SSO <a> link
│   ├── App.tsx                    # MODIFY: UNAUTHORIZED_EVENT handler writes sessionStorage; mount effect reads after bootstrap
│   ├── utils/                     # OPTIONAL NEW: returnTo.ts helper if planner extracts the read/write
│   │   └── returnTo.ts            # OPTIONAL: encapsulates kbi_returnTo sessionStorage I/O
│   └── test/                      # NEW: Wave 0 frontend test infra
│       ├── setup.ts               # imports @testing-library/jest-dom; resets stores between tests
│       └── __mocks__/zustand.ts   # OPTIONAL: store-reset mock per official Zustand testing guide
├── vitest.config.ts               # NEW: jsdom env + setupFiles
└── package.json                   # MODIFY: add devDeps + "test" script
kinetica_bi/server/
├── src/
│   └── index.ts                   # MODIFY (1 line): /api/auth/me JSON gains authMode field
└── tests/
    └── auth.routes.spec.ts        # MODIFY: extend with /me authMode assertions in both modes
```

### Pattern A1: Auth-mode-branched LoginPage (early return on OIDC)

**What:** Render the SSO `<a href>` for `authMode === "oidc"`, fall through to existing form otherwise.

**When to use:** Replacing a credential UI with a redirect-only flow when the server is in OIDC mode. The decision is data-driven (Zustand `authStore.authMode`); no build-time gating.

**Why early-return over a single JSX with conditional blocks:** Two fundamentally different forms (a `<form>` vs. a `<a>`). Conditional rendering inside one JSX tree obscures the divergence and risks accidental cross-contamination of class names and ARIA. The locked spec in ARCHITECTURE.md uses a clean early return — easier to read, easier to test (the password form must NOT be in DOM when in OIDC mode is a strong assertion).

**Example:** see Code Example #2 below.

### Pattern A2: Sequential bootstrap with latest-write-wins authMode

**What:** `bootstrap()` calls `await fetchAuthConfig()` then `await fetchMe()`, with each writing `authMode` to the store. Both write, latest wins.

**When to use:** Two endpoints expose the same authoritative-state field (here: `authMode`). The post-auth source (`/me`) is more authoritative because it travelled through `requireAuth` and a real session. The pre-auth source (`/config`) covers the unauthenticated-bootstrap case where `/me` returns 401.

**Why sequential not parallel:** Locked in CONTEXT.md — "two awaits; ~50–100ms extra vs parallel — negligible against the bootstrap 'Loading…' UX. Keeps the latest-write-wins semantics simple to reason about." The "Loading…" gate at `App.tsx:30` masks the small added latency.

**Pitfall guarded:** `fetchAuthConfig` failure must NOT throw out of `bootstrap()`. Wrap in try/catch; on failure, leave `authMode = null` (LoginPage falls back to password form, which is safe). PITFALL I-03/I-04.

**Example:** see Code Example #1 below.

### Pattern A3: sessionStorage write at UNAUTHORIZED_EVENT, read at status==='authenticated'

**What:** When the 401-REAUTH chain fires, capture the current top-level page state to `sessionStorage["kbi_returnTo"]` BEFORE the user is bounced to LoginPage (and possibly to the IdP). After bootstrap re-authenticates them, read+restore+clear the same key.

**When to use:** Deep-link / return-to-page restoration in OIDC flows where the user leaves the app entirely (full IdP redirect) and comes back to a fresh page load. Standard React-OIDC pattern (verified across react-oidc-context, oidc-client-ts, and angular-oidc patterns).

**Storage shape (CONTEXT.md):** `{ page: "dashboards" | "datasets" | "settings", dashboardViewMode?: string, dashboardId?: number }`. Top-level page + dashboard ID is enough; deep dashboard state (modals, scroll, edit dialogs) is OUT OF SCOPE.

**Gate by mode:** Only write if `authStore.authMode === "oidc"`. In password mode, the user re-auths in the same tab — in-memory `useState<Page>` survives. Writing for password mode would just clutter sessionStorage.

**Single-use semantics:** Read-restore-clear in one synchronous block. `sessionStorage.removeItem("kbi_returnTo")` AFTER the state setters fire. Prevents stale return targeting on the next bootstrap.

**Failure modes:** JSON.parse failure (corrupt key), unknown `page` value, missing dashboard ID — all handled by try/catch + clear, fall through to default page (`dashboards/list`). Never crash the app over stale storage.

**Example:** see Code Examples #4 and #5 below.

### Pattern A4: Server-side closure-const for AUTH_MODE (already in place — verify-only)

**What:** `AUTH_MODE` is read ONCE at `createApp()` top (index.ts:82) and captured as a closure const. All routes (`/api/auth/config`, `/api/auth/login`, `/api/auth/oidc/start`, `/api/auth/oidc/callback`, and now `/api/auth/me`) read from this const. No per-route `process.env.AUTH_MODE` reads anywhere.

**Why this matters for Phase 7:** The new `/me.authMode` field MUST close over the same const, NOT `process.env.AUTH_MODE`. Otherwise `/config` and `/me` could disagree mid-process if the env var is mutated (e.g., a test). Confidence is HIGH that the existing tests already enforce this pattern (Phase 5 verifies it).

**Anti-Pattern:** `app.get("/api/auth/me", (req, res) => { ... res.json({ ..., authMode: process.env.AUTH_MODE }); })` — reading `process.env` inside a handler. Phase 7 must close over the boot-captured `authMode` const at index.ts:82.

### Anti-Patterns to Avoid

- **Build-time `VITE_AUTH_MODE` env var** (PITFALL I-03 / M-03): Bakes the mode into the bundle; same frontend can't serve both modes; mode flip requires rebuild + redeploy. ARCHITECTURE.md AP-4. Fully forbidden.
- **`apiFetch` for `fetchAuthConfig` or `fetchMe`** (CONTEXT.md): Both endpoints are unauthenticated/auth-bootstrap. If `/config` 401'd, dispatching `UNAUTHORIZED_EVENT` would cause infinite reauth-loop on bootstrap. Use raw `fetch`.
- **Caching `authMode` in component-local React state inside `LoginPage`** (PITFALL M-03): `LoginPage` would not re-fetch on next mount. Single source of truth is the Zustand `authStore.authMode`, refreshed by `bootstrap()`.
- **`onClick` handler on the SSO button** (CONTEXT.md): Fragile — JS errors abort the navigation. The pre-redirect work (sessionStorage write) belongs at `UNAUTHORIZED_EVENT` time, not at click time. Pure `<a href>` is robust to JS failure.
- **`Promise.all([fetchAuthConfig(), fetchMe()])`** (CONTEXT.md): Race condition on `set({ authMode })`; obscures latest-write-wins semantics.
- **Conditional rendering INSIDE the existing form JSX** (Pattern A1): Mixing `<form>` and `<a>` semantics in one tree is a recipe for accidental form-submit handlers firing on the SSO link.
- **`window.location.href` set without awaiting `apiLogout()`** (PITFALL U-04): The `store/auth.ts:45` `await apiLogout()` already handles this. Phase 7 verifies any new logout call sites also await.
- **Drift detection / console.warn on `/me.authMode !== /config.authMode`** (CONTEXT.md): Can't actually happen — both close over the same const. Adds noise without value.
- **Bumping the JWT cookie `v` field** (PITFALL I-05): Phase 7 doesn't touch the cookie at all. If anything seems to need it, that's a sign of regression — stop and re-read the issue.
- **`target="_blank"` on the SSO link** (CONTEXT.md): The IdP redirect dance requires returning to the same window. New tab breaks the cookie-based session establishment.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test-runner config for React + TSX | Custom Babel + Jest pipeline | Vitest (reuses `vite.config.ts`) | Vitest's Vite reuse eliminates 100% of the transform configuration. Confidence HIGH (server already on Vitest, same pattern). |
| DOM rendering for component tests | Manual `react-dom` test harness | `@testing-library/react` | RTL is the de-facto React testing standard; encourages user-facing assertions; pairs cleanly with React 18 `act()`. |
| DOM API mocking | Custom DOM polyfills | `jsdom` (Vitest's standard env) | jsdom covers `window`, `localStorage`, `sessionStorage`, `addEventListener`, `dispatchEvent` — all four are used by Phase 7. |
| Zustand store reset between tests | Custom `useAuthStore.setState({...initialState})` in every `beforeEach` | Official `__mocks__/zustand.ts` pattern | The Zustand docs ship a vetted reset-via-mock pattern that captures initial state per store and resets in `afterEach`. Reduces test boilerplate. |
| OIDC return-to-page state preservation | Custom URL-encoding into `state` query param + server-side decode | `sessionStorage["kbi_returnTo"]` | Encoding into `state` requires server-side decode, validation against open-redirect attacks, and hits URL-length limits with dashboard IDs. SessionStorage is browser-local, simpler, locked in TS-14 / CONTEXT.md. |
| `AUTH_MODE` build-time gating | `VITE_AUTH_MODE` env var | Runtime `GET /api/auth/config` (already exists) | Build-time would require rebuild + redeploy on mode flip. ARCHITECTURE.md AP-4. Locked. |
| Cache-Control on `/api/auth/config` | Custom express middleware | Already set in index.ts:227 (`res.setHeader("Cache-Control", "no-store")`) | Phase 5 already shipped this; SC5 is verify-only. |

**Key insight:** Phase 7 is overwhelmingly composition + small wiring. The only "build" is the Wave 0 test infrastructure setup, and even that is "configure existing libraries" rather than "build a custom thing."

## Common Pitfalls

### Pitfall 1: `fetchAuthConfig` failure cascading into a broken bootstrap

**What goes wrong:** If `/api/auth/config` is unreachable (server down, network blip), `fetchAuthConfig()` throws. Without a try/catch, the throw escapes `bootstrap()`, which means `set({ status: "unauthenticated" ... })` may not run, the `useEffect` hangs, and `App.tsx` stays at "Loading…" forever (because `status === "unknown"` gate at App.tsx:30 never lifts).

**Why it happens:** `fetchAuthConfig` uses raw `fetch`; raw fetch throws on network errors (not 4xx/5xx, but DNS failure, CORS rejection, abort). Without a try/catch in bootstrap, the rest of the function (including `fetchMe()`) never runs.

**How to avoid:** Wrap `fetchAuthConfig()` in a try/catch INSIDE bootstrap. On failure: silently leave `authMode = null` and continue to `fetchMe()`. CONTEXT.md locks this behavior. The fall-through to password form is safe — if AUTH_MODE=oidc on the server, `/api/auth/login` will return 400 with a visible error.

**Warning signs:** App stuck on "Loading…" indefinitely after a network failure; no LoginPage render; no error in console.

### Pitfall 2: `LoginPage` rendered before `bootstrap()` finishes — `authMode === null` flash

**What goes wrong:** `App.tsx:30` already gates on `status === "unknown"` and renders `<div>Loading…</div>`. But if a future refactor weakens that gate (e.g., renders LoginPage during `unknown`), the user briefly sees the password form even when the server is in OIDC mode — then a flash to the SSO button. PITFALL U-03.

**Why it happens:** Bootstrap is async; React renders synchronously on first mount.

**How to avoid:** Verify the existing `status === "unknown"` gate at App.tsx:30 stays in place after Phase 7 changes. Don't render LoginPage for the `unknown` status. If `authMode === null` at LoginPage time (`fetchAuthConfig` failed), the password-form fallback is the documented safe default — not a flash, but an honest fallback the user can act on.

**Warning signs:** Flash of password form before SSO button on first load in OIDC mode. Add a test that asserts no LoginPage renders during `unknown` status.

### Pitfall 3: Stale `kbi_session` cookie post-AUTH_MODE flip — frontend hangs at "Loading…"

**What goes wrong:** Operator flips AUTH_MODE password→oidc and restarts. Phase 8 wipes the sessions table. User has the SPA open in another tab with a `kbi_session` cookie pointing to a now-deleted row. `bootstrap()` runs:
- `fetchAuthConfig()` → `{authMode: "oidc"}` ✓
- `fetchMe()` → 401 (row gone, `requireAuth` clears cookie via `loadSessionForRequest` returning null + `clearSessionCookie(res)`).
- `set({ status: "unauthenticated" ... })` — store clears.
- LoginPage renders with `authMode === "oidc"` → SSO button.

**Why it happens (potential failure):** The 401 from `/me` is handled by raw fetch — `null` user, no UNAUTHORIZED_EVENT dispatch (correct, per CONTEXT.md "fetchMe uses raw fetch"). The chain works because `requireAuth` returns `clearSessionCookie(res)` before responding 401.

**How to avoid:** Phase 7 doesn't add new code for this; it relies on Phase 6's verification. The risk is REGRESSION — if Phase 7 accidentally migrates `fetchMe` to `apiFetch`, the 401 would fire `UNAUTHORIZED_EVENT`, which calls `markUnauthenticated("session-expired")`, which would render the session-expired banner during a fresh-page load — wrong UX.

**Warning signs:** "Your session has ended" banner visible during a brand-new page load (the user wasn't even logged in). Test: bootstrap with no cookie, assert `reason === null`.

### Pitfall 4: sessionStorage `kbi_returnTo` corrupted or unparseable

**What goes wrong:** A previous tab wrote a malformed JSON, or a future schema bump leaves a stale key. `JSON.parse(sessionStorage.getItem("kbi_returnTo"))` throws.

**How to avoid:** Wrap the read+parse in try/catch. On any failure: `sessionStorage.removeItem("kbi_returnTo")` and fall through to the default page (`dashboards/list`). Don't crash. CONTEXT.md locks this.

**Warning signs:** App white-screens after OIDC callback. Console shows `Unexpected token in JSON`.

### Pitfall 5: Missing `Cache-Control: no-store` on `/api/auth/config` (already handled — verify-only)

**What goes wrong:** Browser caches the `{authMode: "password"}` response from before the operator flipped to OIDC mode. Even after restart, the SPA gets stale config. PITFALL I-03 / M-03.

**How to avoid:** Already done — index.ts:227 sets `res.setHeader("Cache-Control", "no-store")` on `/api/auth/config`. Phase 7 SC5 is verify-only: a new test in `auth.oidc.spec.ts` (or wherever) that asserts the header is present.

**Warning signs:** Wrong LoginPage variant in browsers that aggressively cache; refreshing fixes it (which itself is a smell that a CDN or proxy is caching).

### Pitfall 6: Wave-0 test infra Vitest version mismatch

**What goes wrong:** Frontend installs `vitest@^5.0.0`, server stays on `vitest@^4.1.5`. Two different test runners, two different APIs (Vitest 5 has small breaking changes from 4). Inconsistent dev experience; potential incompatibility with server's `tests/setup.ts` patterns being copy-pasted into frontend.

**How to avoid:** Pin frontend `vitest` to `^4.1.5` (match server) OR upgrade server to 5.x as a separate concern. CONTEXT.md says "planner discovers"; recommend matching the server pin (`^4.1.5`) for now.

**Warning signs:** `vi.fn()` semantics differ between server and frontend tests; CI runs two different vitest binaries.

### Pitfall 7: SSO link's `href` rendered before `API_BASE` is exported

**What goes wrong:** `LoginPage.tsx` imports `API_BASE` from `../api/client`. If the `client.ts` change ("export") lands in a different commit/wave than the LoginPage change, the import fails. The build silently produces `undefined`, and the SSO link goes to `https://kinetica-bi.example.com/undefined/api/auth/oidc/start`.

**How to avoid:** Land `client.ts` (export `API_BASE` + add `fetchAuthConfig`) BEFORE `LoginPage.tsx` in the wave order. Or: bundle them into one wave. The compiler can catch the missing export with `tsc --noEmit`; a CI gate that runs typecheck would catch it.

**Warning signs:** SSO link renders with literal "undefined" in the URL.

### Pitfall 8: `<a>` element styled as `.login-submit` button — accessibility regression

**What goes wrong:** `.login-submit` is the existing `<button type="submit">` class. Reusing it on `<a>` works visually but the element is now a link, not a button. Screen readers announce it as a link; click-with-Enter triggers a navigation, not a "click" event. For Phase 7's pure-link semantics, this is actually CORRECT — the link IS the action.

**Why it's still worth noting:** If a future maintainer adds an `onClick` handler thinking it's a button, the link's default navigation will still happen. This is the desired robust behavior in Phase 7 (CONTEXT.md "no onClick handler") but the maintainer mental model can drift.

**How to avoid:** Add a code comment near the SSO `<a>` link: `// Pure full-page navigation — no onClick handler. Pre-redirect work happens at UNAUTHORIZED_EVENT, not click time.` Single-line lock.

**Warning signs:** A future change adds an onClick that does sessionStorage work — this should be detected in PR review since it duplicates the `App.tsx` UNAUTHORIZED handler logic.

## Code Examples

Verified patterns from official sources, ARCHITECTURE.md, and existing codebase.

### Code Example #1: bootstrap() with sequential awaits and silent fallback

```typescript
// src/store/auth.ts (Phase 7 modifications)
// Source: ARCHITECTURE.md §"Frontend Changes" + CONTEXT.md decisions

import { create } from "zustand";
import { AuthUser, AuthConfig, fetchAuthConfig, fetchMe, login as apiLogin, logout as apiLogout } from "../api/client";

type AuthStatus = "unknown" | "authenticated" | "unauthenticated";
type AuthReason = "session-expired" | null;
type AuthMode = "password" | "oidc" | null;   // null = bootstrap not yet completed or fetchAuthConfig failed

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  reason: AuthReason;
  authMode: AuthMode;                          // NEW
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  markUnauthenticated: (reason?: AuthReason) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  user: null,
  error: null,
  reason: null,
  authMode: null,                              // NEW: starts null until /config or /me writes
  bootstrap: async () => {
    // Step 1: pre-auth config read. Failure → silent fallback (LoginPage renders password form).
    try {
      const config = await fetchAuthConfig();
      set({ authMode: config.authMode });
    } catch {
      // authMode stays null — LoginPage falls back to password form. Self-correcting on next load.
    }
    // Step 2: post-auth /me. Existing 401-as-null contract preserved.
    try {
      const me = await fetchMe();
      if (me) {
        // me carries authMode now; latest-write-wins (more authoritative than /config's pre-auth read).
        set({ status: "authenticated", user: me.user, authMode: me.authMode, error: null, reason: null });
      } else {
        // bootstrap-driven 401: honest "not logged in", NOT mid-session expiry — reason stays null
        set({ status: "unauthenticated", user: null, reason: null });
      }
    } catch {
      set({ status: "unauthenticated", user: null, reason: null });
    }
  },
  // ...login, logout, markUnauthenticated unchanged
}));
```

### Code Example #2: LoginPage.tsx OIDC early-return branch

```typescript
// src/components/LoginPage.tsx (Phase 7 modifications)
// Source: ARCHITECTURE.md §"Frontend Changes" lines 510-534 (verbatim)

import { FormEvent, useState } from "react";
import { useAuthStore } from "../store/auth";
import { API_BASE } from "../api/client";       // NEW: requires API_BASE export from client.ts

const LoginPage = () => {
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const reason = useAuthStore((s) => s.reason);
  const authMode = useAuthStore((s) => s.authMode);   // NEW
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const message = localError ?? error;

  // OIDC mode: full-page navigation to /api/auth/oidc/start.
  // Pure <a href> — no onClick. Pre-redirect work (sessionStorage write) happens at
  // UNAUTHORIZED_EVENT time in App.tsx, BEFORE LoginPage is rendered.
  if (authMode === "oidc") {
    return (
      <div className="login-shell">
        <div className="login-card">
          {reason === "session-expired" && (
            <div className="login-banner" role="status">
              Your session has ended. Please sign in again.
            </div>
          )}
          <div className="login-brand">Kinetica BI</div>
          <h1 className="login-title">Sign in</h1>
          <a href={`${API_BASE}/api/auth/oidc/start`} className="login-submit">
            Sign in with SSO
          </a>
        </div>
      </div>
    );
  }

  // authMode === "password" or null: existing password form (unchanged from v1.0).
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        {/* ...existing form JSX unchanged... */}
      </form>
    </div>
  );
};
```

### Code Example #3: client.ts — export API_BASE; add fetchAuthConfig; expand fetchMe return

```typescript
// src/api/client.ts (Phase 7 modifications)

// Line 1: change `const` → `export const`
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

// New type — placed near AuthUser at line 81.
export type AuthMode = "password" | "oidc";
export type AuthConfig = { authMode: AuthMode };

// New helper — placed near fetchMe.
// IMPORTANT: raw fetch (NOT apiFetch). Unauthenticated; must NOT trigger UNAUTHORIZED_EVENT.
export const fetchAuthConfig = async (): Promise<AuthConfig> => {
  const response = await fetch(`${API_BASE}/api/auth/config`, { credentials: "include" });
  if (!response.ok) throw new Error(`Failed to load auth config: ${response.status}`);
  return response.json() as Promise<AuthConfig>;
};

// fetchMe — expand return shape to carry authMode alongside user.
// IMPORTANT: still uses raw fetch (line 103 comment unchanged); 401-as-null contract preserved.
export type MeResponse = { user: AuthUser; authMode: AuthMode };

export const fetchMe = async (): Promise<MeResponse | null> => {
  const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Failed to load session: ${response.status}`);
  const json = await response.json();
  return { user: json.user as AuthUser, authMode: json.authMode as AuthMode };
};
```

### Code Example #4: App.tsx UNAUTHORIZED_EVENT handler with sessionStorage write

```typescript
// src/App.tsx (Phase 7 modifications — UNAUTHORIZED_EVENT handler at line 24-28)

useEffect(() => {
  const handler = () => {
    // UX-06 / TS-14: capture pre-redirect page state for OIDC return-to.
    // Only in OIDC mode (in password mode, the user re-auths in the same tab; in-memory state survives).
    const authMode = useAuthStore.getState().authMode;
    if (authMode === "oidc") {
      try {
        sessionStorage.setItem(
          "kbi_returnTo",
          JSON.stringify({ page, dashboardViewMode })
        );
      } catch {
        // Best-effort: sessionStorage may be disabled (private mode in some browsers).
        // Falling through to the default page is acceptable.
      }
    }
    markUnauthenticated("session-expired");
  };
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}, [markUnauthenticated, page, dashboardViewMode]);
// Effect deps include page + dashboardViewMode so the handler closure always sees fresh values.
```

### Code Example #5: App.tsx mount effect — read+restore+clear after authentication

```typescript
// src/App.tsx (Phase 7 NEW effect — runs when status flips to "authenticated")

useEffect(() => {
  if (status !== "authenticated") return;     // only after bootstrap completes
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem("kbi_returnTo");
    if (!raw) return;
    const parsed = JSON.parse(raw) as { page?: Page; dashboardViewMode?: string };
    if (parsed.page === "dashboards" || parsed.page === "datasets" || parsed.page === "settings") {
      setPage(parsed.page);
    }
    if (typeof parsed.dashboardViewMode === "string") {
      setDashboardViewMode(parsed.dashboardViewMode);
    }
  } catch {
    // Corrupt JSON or unknown shape — silently fall through to default page.
  } finally {
    // Single-use: clear regardless of success/failure.
    if (raw !== null) {
      try { sessionStorage.removeItem("kbi_returnTo"); } catch { /* sessionStorage disabled */ }
    }
  }
}, [status]);   // fires once when status transitions unauthenticated→authenticated
```

### Code Example #6: Server-side /api/auth/me extension (one line)

```typescript
// kinetica_bi/server/src/index.ts:211-220 (Phase 7 modification)

app.get("/api/auth/me", (req, res) => {
  const loaded = loadSessionForRequest(req);
  if (!loaded) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Not authenticated.", code: "REAUTH_REQUIRED" });
  }
  // Phase 7 (UX-08 / D-3): include authMode top-level. Closes over the boot-captured const at
  // index.ts:82 — NEVER re-read process.env here (ARCHITECTURE.md AP-5).
  return res.json({ user: { username: loaded.session.username }, authMode });
  //                                                              ^^^^^^^^^^^^^^^^ NEW
});
```

### Code Example #7: Server-side test extension for /me.authMode

```typescript
// kinetica_bi/server/tests/auth.routes.spec.ts (Phase 7 additions)

describe("GET /api/auth/me — authMode field (UX-08)", () => {
  it("returns authMode='password' in password mode for an authenticated user", async () => {
    mockKineticaLoginOK();
    const agent = await buildTestApp();
    const loginRes = await agent.post("/api/auth/login").send({ username: "alice", password: "hunter2" });
    const cookie = (loginRes.headers["set-cookie"] as string[])[0].split(";")[0];

    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ user: { username: "alice" }, authMode: "password" });
  });

  it("returns authMode='oidc' in OIDC mode for an authenticated user", async () => {
    // Stub OIDC env so createApp() sets authMode='oidc' at boot.
    // Pattern from auth.oidc.spec.ts — exact helper TBD by planner; may need to extract stubOidcEnv().
    process.env.AUTH_MODE = "oidc";
    process.env.AUTH_OIDC_ISSUER_URL = "https://idp.test";
    // ...other AUTH_OIDC_* vars + initOidcClient mock...

    const accessToken = makeJwt({ sub: "alice", exp: Math.floor(Date.now() / 1000) + 3600 });
    const { cookie } = seedOidcSession(accessToken);

    const agent = await buildTestApp();
    const meRes = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ user: { username: "alice" }, authMode: "oidc" });
  });
});
```

### Code Example #8: Frontend Vitest setup file (Wave 0)

```typescript
// kinetica_bi/src/test/setup.ts (NEW — Wave 0)
// Source: testing-library docs + Vitest setup guides.

import "@testing-library/jest-dom/vitest";    // augments expect with toBeInTheDocument etc.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();                                   // unmount React trees between tests
  sessionStorage.clear();                      // Phase 7 uses kbi_returnTo — clean per test
  localStorage.clear();                        // defensive
});
```

### Code Example #9: Optional Zustand mock for store reset (recommended)

```typescript
// kinetica_bi/__mocks__/zustand.ts (NEW — at project root, NOT inside src/)
// Source: Zustand official testing guide (verified via GitHub blob)

import { afterEach, vi } from "vitest";
import { act } from "@testing-library/react";
import * as zustandActual from "zustand";

const { create: actualCreate, createStore: actualCreateStore } = await vi.importActual<typeof zustandActual>("zustand");

const storeResetFns = new Set<() => void>();

const createUncurried = <T>(stateCreator: zustandActual.StateCreator<T>) => {
  const store = actualCreate(stateCreator);
  const initialState = store.getState();
  storeResetFns.add(() => store.setState(initialState, true));
  return store;
};

export const create = (<T>(stateCreator?: zustandActual.StateCreator<T>) =>
  stateCreator ? createUncurried(stateCreator) : createUncurried) as typeof zustandActual.create;

export const createStore = ((stateCreator: zustandActual.StateCreator<unknown>) => {
  const store = actualCreateStore(stateCreator);
  const initialState = store.getState();
  storeResetFns.add(() => store.setState(initialState, true));
  return store;
}) as typeof zustandActual.createStore;

afterEach(() => {
  act(() => {
    storeResetFns.forEach((fn) => fn());
  });
});
```

Activate in `src/test/setup.ts` with `vi.mock('zustand')`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Build-time `VITE_AUTH_MODE` baked into bundle | Runtime `GET /api/auth/config` (Cache-Control: no-store) | Phase 5 (Apr 2026) | Same bundle serves password and OIDC deployments. Mode flip = restart only, no rebuild. |
| Encode `returnTo` into OIDC `state` query param | `sessionStorage["kbi_returnTo"]` written at UNAUTHORIZED_EVENT, read at status==='authenticated' | TS-14 lock (Apr 2026) | Browser-local; no server-side decode/validation; no URL-length limits. |
| Custom Babel + Jest pipeline for React tests | Vitest + RTL (reuses `vite.config.ts`) | Vitest 1.x release (2023) — solidified by 2026 | Zero transform configuration. Test runner shares the bundler's config. |
| `react-dom/test-utils` direct rendering | `@testing-library/react` v16 | RTL v13+ for React 18 (2023) | User-facing assertions; ergonomic queries; pairs with React 18 `act()`. |
| Zustand store reset via per-test `useStore.setState({...initial})` | `__mocks__/zustand.ts` capturing initial state + `afterEach` reset | Documented in Zustand v4 testing guide (2023+) | Centralized; less boilerplate; survives store evolution. |

**Deprecated/outdated:**

- **Enzyme**: Unmaintained for React 18; do not consider.
- **`react-test-renderer`**: Still works, but RTL is preferred for the user-facing assertion model.
- **`fireEvent` for user interactions**: `@testing-library/user-event` v14 fires correct event sequences (focus/blur/click); prefer it for the SSO link click test.
- **Caching `authMode` in component-local React state inside `LoginPage`**: PITFALL M-03 — single source of truth must be the Zustand store, refreshed per bootstrap.

## Open Questions

1. **Vitest version: pin to server's `^4.1.5` or jump to `^5.0.12` (current latest)?**
   - What we know: server uses `^4.1.5`. npm latest is `5.0.12` (verified 2026-05-01).
   - What's unclear: Whether Vitest 4 → 5 has frontend-relevant breaking changes for React + jsdom + RTL setup.
   - Recommendation: Pin frontend to `^4.1.5` to match server. Upgrade both in a separate concern. Prevents two test-runner versions in CI.

2. **`__mocks__/zustand.ts` reset pattern: adopt or skip?**
   - What we know: Zustand official testing guide recommends it; reduces boilerplate.
   - What's unclear: Whether the team prefers the more-explicit-but-noisier pattern of resetting the auth store manually in each test's `beforeEach`.
   - Recommendation: Adopt. It's a one-time setup that pays off across all future store tests.

3. **Where do new frontend specs live: co-located `*.spec.tsx` or `src/__tests__/`?**
   - What we know: server uses `tests/*.spec.ts` (sibling top-level). Frontend has no precedent.
   - What's unclear: Team preference.
   - Recommendation: Co-located `src/components/LoginPage.spec.tsx`, `src/store/auth.spec.ts`, `src/App.spec.tsx`. Vitest's `include: ["src/**/*.spec.{ts,tsx}"]` picks them up. Cohesion with the file under test > top-level test directory. (CONTEXT.md Claude's Discretion.)

4. **Extract `returnTo.ts` helper or inline in `App.tsx`?**
   - What we know: CONTEXT.md leaves to planner discretion.
   - What's unclear: Whether the read+restore+clear logic is reused anywhere else (it's not, in v1.1).
   - Recommendation: Inline in `App.tsx` for v1.1. The logic is tightly coupled to App's state setters (`setPage`, `setDashboardViewMode`). Extract only if a second consumer appears.

5. **`authMode` default in `authStore`: `null` vs `"password"`?**
   - What we know: ARCHITECTURE.md uses `null`. CONTEXT.md "recommend `null` so a missing fetchAuthConfig is distinguishable from confirmed-password — but planner can choose the cleaner default."
   - What's unclear: Whether tests/types are cleaner with the literal default.
   - Recommendation: `null`. The distinction (loading vs confirmed-password) is real and shows up in the LoginPage flash test (Pitfall 2). Defaulting to `"password"` would mask a `fetchAuthConfig` failure in OIDC deployments — exactly the case PITFALL I-03 warns against.

## Sources

### Primary (HIGH confidence)
- `kinetica_bi/server/src/index.ts:82, 211-220, 226-229, 233-368` — Phase 5 boot const + existing `/me`, `/config`, `/oidc/start`, `/oidc/callback` handlers
- `kinetica_bi/src/api/client.ts:1, 3, 36-57, 100-108` — existing `API_BASE`, `UNAUTHORIZED_EVENT`, `apiFetch` body-peek, `fetchMe` raw-fetch contract
- `kinetica_bi/src/store/auth.ts:1-55` — existing `useAuthStore`, `bootstrap()`, `markUnauthenticated`, `AuthReason`
- `kinetica_bi/src/components/LoginPage.tsx:1-73` — existing form, `.login-banner`, `.login-card`, `.login-submit` classes
- `kinetica_bi/src/App.tsx:1-57` — existing UNAUTHORIZED_EVENT handler, `Page` type, `status === "unknown"` gate
- `kinetica_bi/server/tests/auth.routes.spec.ts` — existing `seedOidcSession` + `mockKineticaLoginOK` patterns for the new `/me.authMode` test
- `kinetica_bi/server/tests/setup.ts` — server vitest setup pattern (template for frontend)
- `kinetica_bi/server/vitest.config.ts` — server vitest config (template)
- `.planning/research/ARCHITECTURE.md:459-578` — verbatim Frontend Changes spec, OIDC end-to-end data flow
- `.planning/research/PITFALLS.md:204-580` — I-03, I-04, M-03, U-01, U-03, U-04 (Phase 7's pitfall map)
- `.planning/research/FEATURES.md:53-201` — TS-1 (SSO button), TS-14 (return-to-page), D-3 (`/me.authMode`)
- npm registry (`npm view`, 2026-05-01): vitest 5.0.12, jsdom 29.1.1, @testing-library/react 16.3.2, @testing-library/jest-dom 6.9.1, @testing-library/user-event 14.6.1
- [Zustand official testing guide (GitHub)](https://github.com/pmndrs/zustand/blob/HEAD/docs/learn/guides/testing.md) — `__mocks__/zustand.ts` reset pattern (verified 2026-05-01)

### Secondary (MEDIUM confidence)
- [DEV: React Testing Setup: Vitest + TypeScript + RTL](https://dev.to/kevinccbsg/react-testing-setup-vitest-typescript-react-testing-library-42c8) — corroborates Vitest 4/5 + RTL setup steps for jsdom env
- [Vitest official guide](https://vitest.dev/guide/) — `defineConfig`, `environment`, `setupFiles`, `globals`
- [react-oidc-context #99 + #1386 (GitHub)](https://github.com/authts/react-oidc-context/issues/99) — corroborates sessionStorage-for-returnURL pattern as standard in the React-OIDC ecosystem
- [oidc-spa basic usage docs](https://docs.oidc-spa.dev/docs/v6/usage) — sessionStorage state-store pattern

### Tertiary (LOW confidence)
- None for Phase 7. All claims are backed by code inspection or HIGH/MEDIUM sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via npm registry on 2026-05-01; team already uses Vitest 4.1.5 on server.
- Architecture: HIGH — every pattern is either already in code (verified) or verbatim from ARCHITECTURE.md.
- Pitfalls: HIGH — pitfalls cited from PITFALLS.md and locked in CONTEXT.md, with explicit "verify-only" annotations where Phase 7 doesn't add code.
- Frontend test infra (Wave 0): MEDIUM — no precedent in repo; standard pattern but planner must validate the exact `vite.config.ts` extension works without breaking the existing build.

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (30 days — the auth-mode awareness surface is stable; only Vitest/RTL ecosystem moves and only in non-breaking ways).
