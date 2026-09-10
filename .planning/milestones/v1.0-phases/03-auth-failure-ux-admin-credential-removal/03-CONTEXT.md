# Phase 3: Auth failure UX + admin credential removal - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Close out the v1.0 milestone by mapping Phase 2's typed errors to user-visible HTTP responses, wiring the frontend to dispatch on the response `code` field, deleting the shared admin Kinetica credentials from the entire codebase, and folding in two carryover concerns (the latent `EADDRINUSE` bootstrap noise from Phase 2 verification, and the deploy-runbook update for the env-var removal).

Five concrete deliverables:

1. **Backend global error middleware** in `kinetica_bi/server/src/index.ts` (or a sibling module) that catches `KineticaAuthError` → 401 + `code: "REAUTH_REQUIRED"` + `clearSessionCookie`, `KineticaPermissionError` → 403 with `{ error }`, `KineticaUpstreamError` → 502 with `{ error }`. Routes stop catching helper throws — they let them bubble. Materialize is the one exception (keeps its `try/catch` to call `updateViewStatus("error", message)` as a side effect, then re-throws to the middleware).
2. **Frontend dispatch refactor** in `kinetica_bi/src/api/client.ts` and `kinetica_bi/src/App.tsx`: `apiFetch` body-peeks 401 responses and only fires `UNAUTHORIZED_EVENT` when `body.code === "REAUTH_REQUIRED"`. 403s surface as a global toast plus a per-widget grayed-out state. A new `useApiQuery` hook unifies `{ loading, data, error }` semantics so stuck-spinner regressions are structurally hard. LoginPage shows a banner ("Your session has ended, please sign in again") when triggered by mid-session auth failure.
3. **Admin credential removal:** narrow `requireConfig` to check only `KINETICA_URL`; delete all `KINETICA_USERNAME` / `KINETICA_PASSWORD` references from `.env.example`, `README.md`, and test specs (replace negative-assertion env-var reads with hardcoded sentinel strings). `git grep` across the working tree (excluding `.planning/`) returns zero matches.
4. **Bootstrap fix (Phase 2 carryover):** gate `app.listen()` and `startSessionSweep()` behind `process.env.NODE_ENV !== "test"` in `index.ts`. Eliminates the 5 non-fatal `EADDRINUSE` errors during parallel test runs.
5. **DEPLOY-RUNBOOK update:** extend `.planning/phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` with Phase 3 deltas — env-var unset is now safe, rollback past Phase 3 requires re-adding the env vars, no AUTH_SECRET rotation needed (Phase 1's `v:1` cookie field handles old sessions).

</domain>

<decisions>
## Implementation Decisions

### Backend global error middleware

- **Mount location:** `app.use((err, req, res, next) => ...)` with the four-arg error-handler signature, mounted just **before** the existing 404 handler at the bottom of `createApp()`. Express's error-middleware contract requires the four-arg signature regardless of mount order, but bottom-of-file is the idiomatic placement and minimizes surprise for future readers.
- **Translation rules:**
  - `err instanceof KineticaAuthError` → `clearSessionCookie(res)` + `res.status(401).json({ error: err.message, code: "REAUTH_REQUIRED" })`
  - `err instanceof KineticaPermissionError` → `res.status(403).json({ error: err.message })` (no `code` field)
  - `err instanceof KineticaUpstreamError` → `res.status(502).json({ error: err.message })` (no `code` field)
  - Anything else (including plain `Error`, `TypeError`, etc.) → `res.status(500).json({ error: "Internal server error" })` and `console.error(err)` for ops debugging. Defensive — should not happen in practice once routes are stripped.
- **Routes strip try/catches around helper calls.** The current Phase 2 pattern of `try { await kineticaSql(...) } catch (e) { return res.status(502)... }` is removed in every refactored route. The middleware does the translation.
  - **Single exception: materialize.** `POST /api/views/:id/materialize` keeps its `try/catch` because it must call `updateViewStatus(id, "error", message)` as a side effect on every failure (status persistence). The catch block does the side effect, then re-throws via `next(err)` so the middleware translates the response. Pattern: `try { ... } catch (err) { updateViewStatus(id, "error", String(err)); next(err); }`.
- **401-REAUTH cookie clearing.** The middleware calls `clearSessionCookie(res)` (existing helper from Phase 1) before sending the 401 body. This guarantees `/api/auth/me` also returns 401 on the next page load — no stuck-state where the cookie still exists but the session is dead. (Optional extension to also call `deleteSession(req.user?.sub)` is **NOT done** — `req.user` may not be reliably populated in the catch path, and the orphaned row will be GC'd within an hour by the Phase 1 sweep. Keeping the middleware simple.)
- **Body shape consistency.** Only 401 carries `code: "REAUTH_REQUIRED"`. 403/502/500 use plain `{ error }`. Phase 1's existing 401 responses (in `requireAuth` and `/api/auth/me`) already use this exact shape — no contract drift.
- **Audit log interaction.** The helper's audit log emits BEFORE the throw, with `outcome` reflecting the typed error type (`auth-fail` for KineticaAuthError, `permission-denied` for KineticaPermissionError, `upstream-error` for KineticaUpstreamError) and `status` reflecting what the middleware will return (401/403/502). Helper is responsible for the log line; middleware is responsible for the HTTP response. Two-layer separation, no duplication.

### Frontend dispatch refactor

- **`apiFetch` body-peek for `code: "REAUTH_REQUIRED"`.** Current implementation in `kinetica_bi/src/api/client.ts:5-11` fires `UNAUTHORIZED_EVENT` on every 401. Replace with: when `response.status === 401`, `response.clone()` then `.json()` (catch parse errors → fall back to current behavior of always-dispatch for safety), check `body.code === "REAUTH_REQUIRED"`, dispatch only then. The original `response` is still returned to the caller; the clone is only for inspection.
- **`UNAUTHORIZED_EVENT` listener in `App.tsx`** stays as-is — it calls `markUnauthenticated()` which routes to `LoginPage`. The dispatch trigger is what changed.
- **403 UX: global toast + per-widget grayed-out state.**
  - Introduce a small toast notification component (or adopt a minimal library — planner picks; `sonner` is recommended for size + zero-config; in-house implementation is also acceptable since the surface is small). Toast text: `"You don't have permission to view this data."`. Auto-dismiss after 5s; one toast per error per session (debounced — clicking 3 widgets you can't see shouldn't show 3 toasts).
  - Widgets render their own grayed-out state when their fetch returns a permission error. Existing widgets already have try/catch around their fetches; the catch handler now branches on `error` shape: if it's a `PermissionError` (new client-side class — see below), set `widget.state = "permission-denied"` and render a placeholder. Otherwise current error rendering.
  - **Client-side error class:** `client.ts` introduces `PermissionError extends Error` (and `ReauthRequiredError`, `UpstreamError` for symmetry) so callers can `instanceof` switch instead of parsing strings. Thrown from each `apiFetch`-using helper when `response.status` is 403/401/502 respectively.
- **`useApiQuery` hook for stuck-spinner prevention.** Introduce `kinetica_bi/src/hooks/useApiQuery.ts` returning `{ loading, data, error }`. Internally wraps a fetch promise with `setLoading(true)` → await → `try { setData; } catch (e) { setError(e) } finally { setLoading(false) }`. Gracefully handles `PermissionError` by setting a discriminated `error.kind: "permission"`. Existing widgets opt into the hook **incrementally** — Phase 3 rewrites the 4-5 most-used widget data fetches (Dashboard list, table list, schema/table/column discovery, SQL run for charts), leaves the rest for a future refactor.
  - **Scope discipline:** Phase 3 introduces the hook AND migrates the highest-traffic call sites only. Migrating all 26+ helpers in `client.ts` is out of scope; tracked in deferred ideas.
- **Re-login UX:** LoginPage reads a flag from `useAuthStore` (extend Phase 1's auth store with `reason: "session-expired" | null`, set when `markUnauthenticated()` is triggered by `UNAUTHORIZED_EVENT` and not by an explicit logout button). When `reason === "session-expired"`, LoginPage renders a banner above the form: `"Your session has ended. Please sign in again."`. Banner has a subtle styled treatment (existing `global.css` muted/info pattern is fine — Claude's discretion). Form fields stay empty (AUTH-V2-01 deferred).

### Admin credential removal mechanics

- **`requireConfig` narrowing.** Replace the current 3-var check with a 1-var check:
  ```ts
  const requireConfig = (req, res, next) => {
    if (!process.env.KINETICA_URL) {
      return res.status(500).json({ error: "Missing KINETICA_URL environment variable." });
    }
    return next();
  };
  ```
  Mounted on the same routes as today (no functional change beyond the narrowing). All routes that hit Kinetica still need `KINETICA_URL`; this preserves the boot-time guard.
- **Test cleanup with hardcoded sentinel.** Specs that currently do `process.env.KINETICA_USERNAME = "admin-env-user"` for negative assertions get rewritten to use the literal `"admin-env-user"` directly:
  ```ts
  // BEFORE: expect(decoded).not.toContain(process.env.KINETICA_USERNAME || "...")
  // AFTER:  expect(decoded).not.toContain("admin-env-user");
  ```
  Plus delete the `process.env.KINETICA_USERNAME = ...` setup/teardown in those specs.  `tests/setup.ts` also has `KINETICA_USERNAME` priming — remove it.
- **`.env.example`** loses the `KINETICA_USERNAME=[redacted]` and `KINETICA_PASSWORD=[redacted]` lines outright. No replacement comment — `git log` is the canonical history. The file shrinks; that's the intended signal.
- **`README.md`** loses the two table rows at lines 85-86 (`KINETICA_USERNAME` / `KINETICA_PASSWORD` env-var documentation). Adjacent rows shift up.
- **Audit scope:** `git grep -nE 'KINETICA_USERNAME|KINETICA_PASSWORD' -- ':!.planning/'` returns zero matches at the end of Phase 3. The `.planning/` exclusion is intentional — historical CONTEXT/SUMMARY files reference these strings as part of the decision record. ROADMAP SC#5 wording ("outside of intentional historical references") permits this.
- **Compiled artifact:** `kinetica_bi/server/dist/index.js` currently references the env vars too (line 21-23 from the scout output). `dist/` is a build output and will be regenerated on next `npm run build`; if it isn't gitignored it should be. Plan should verify `dist/` isn't committed or is rebuilt before the `git grep` audit.

### Latent EADDRINUSE bootstrap fix

- Wrap the production bootstrap in a `process.env.NODE_ENV !== "test"` guard:
  ```ts
  if (process.env.NODE_ENV !== "test") {
    const port = process.env.PORT || 4000;
    const app = createApp();
    app.listen(port, () => {
      console.log(`Kinetica BI backend running on http://localhost:${port}`);
    });
    startSessionSweep();
  }
  ```
- `tests/setup.ts` already sets `NODE_ENV = "test"` (Phase 1 / 02-02 setup) — this gate works without additional test-side changes.
- Plan should add a regression test that runs `npm test -- --run` and asserts no `EADDRINUSE` strings in the output.
- Production behavior is unchanged — `NODE_ENV` is unset or `"production"` in real deployments, so the guard's `!==` evaluates true.

### Deploy / migration

- **Update `.planning/phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md`** (don't write a new Phase 3 runbook — operators read one file for the milestone). Add a new top-level section `## Phase 3 Delta` with:
  - Pre-deploy: `KINETICA_USERNAME` and `KINETICA_PASSWORD` can now be removed from Helm/Terraform/CI-secret-managers. Removal is **safe** (server boots without them).
  - Post-deploy: identical to Phase 1 — old sessions with the unchanged `v:1` cookie field continue to work; sessions with no `v` field (pre-v1.0) get the same clean 401-REAUTH flow they got after Phase 1 deployed.
  - Rollback: rolling back past Phase 3 requires re-adding the env vars to deployment configs (server won't boot without them under the old code).
  - No `AUTH_SECRET` rotation required (Phase 1's `v:1` mechanism remains the primary migration handle).
- **No data migration needed.** No DB schema changes in Phase 3. The `sessions` table from Phase 1 is unchanged.

### Claude's Discretion

- **Toast component implementation.** Hand-roll a tiny one (existing `global.css` patterns + a `Toast.tsx` component + a singleton store) OR adopt `sonner` (~5KB gzipped, zero config). Planner picks. If hand-rolled, debouncing logic needs a small Zustand slice or singleton.
- **Where the global error middleware actually lives in source.** Inline in `index.ts` is fine for now (small surface). Splitting into `src/errorMiddleware.ts` is also acceptable. Prefer inline unless the file gets unwieldy.
- **Exact widget grayed-out state styling.** Existing `global.css` muted/empty patterns are the natural starting point. Use a placeholder like a faded chart icon + "Permission denied" text. No spec-level pixel requirements.
- **Discriminator on the client-side error classes.** `PermissionError`, `ReauthRequiredError`, `UpstreamError` is the recommended naming; planner can pick alternatives if there's a stylistic reason. As long as `instanceof` works.
- **Migration order of operations within Phase 3.** Recommended sequence: (1) Add backend middleware + `clearSessionCookie` import + middleware tests. (2) Strip route try/catches; full backend tests pass. (3) Frontend `apiFetch` body-peek + new client-side error classes. (4) `useApiQuery` hook + 4-5 high-traffic widget migrations + LoginPage banner + global toast. (5) `requireConfig` narrowing + test cleanup. (6) `.env.example` + `README.md` deletions + `git grep` audit. (7) Bootstrap gate + EADDRINUSE regression test. (8) DEPLOY-RUNBOOK update. Planner can re-order within reason.
- **`useApiQuery` hook scope.** Phase 3 ships the hook AND migrates the 4-5 highest-traffic call sites (chart SQL, dashboard list, table list, schema discovery, view materialize). The remaining ~21 call sites stay on the existing `try/catch + setError` pattern; tracked as deferred. Planner may extend if low-effort, but should not balloon the phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research
- `.planning/research/SUMMARY.md` §"Implications for Roadmap" → Phase 3; §"Watch Out For" items 4, 5
- `.planning/research/ARCHITECTURE.md` §3 ("KineticaAuthError / KineticaUpstreamError middleware pattern" — the source pattern this phase implements); §5 "Fate of KINETICA_USERNAME / KINETICA_PASSWORD"; §6 Phase 3; §"Anti-Patterns"
- `.planning/research/FEATURES.md` §"Table Stakes" TS-4, TS-5, TS-6, TS-8; §"Anti-Features" AF-3
- `.planning/research/PITFALLS.md` Pitfalls 9, 10, 11, 12, 14, 15, 18, 21, 22; "Looks Done But Isn't" checklist (especially: stuck-spinner avoidance, cookie-clearing on 401, deploy-time cookie migration)

### Prior phase outputs (consumed by Phase 3)
- `.planning/phases/01-encrypted-server-side-session-store/01-CONTEXT.md` §"JWT payload migration" (`v: 1` field handles old cookies; Phase 3 inherits this), §"Session lifecycle" (`code: "REAUTH_REQUIRED"` already in use)
- `.planning/phases/01-encrypted-server-side-session-store/DEPLOY-RUNBOOK.md` (target file for Phase 3 delta append)
- `.planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/02-CONTEXT.md` §"Helper API surface" (helper throws typed errors), §"Phase 2 client-facing behavior — UNCHANGED" (this is what Phase 3 changes), §"Failure signaling — typed errors" (the input contract)
- `.planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/02-VERIFICATION.md` (flagged the EADDRINUSE issue Phase 3 closes)
- `.planning/phases/02-per-user-credential-passthrough-on-every-kinetica-call/SPIKE.md` (DDL permission denial returns HTTP 400 + body — already classified as `KineticaPermissionError` by the helper from 02-02; middleware just maps to 403)

### Project-level
- `.planning/PROJECT.md` "Active" requirements (the two unchecked items map to Phase 3 deliverables)
- `.planning/REQUIREMENTS.md` ADMN-01..04 + UX-01..03 (this phase's seven requirements)
- `.planning/STATE.md`
- `.planning/ROADMAP.md` Phase 3 Goal, Success Criteria 1-5, Canonical references for Phase 3, deploy migration note (Pitfall 13)

### Existing code (refactor anchors)
- `kinetica_bi/server/src/index.ts` — lines 60-67 (`requireConfig` to narrow), lines 449-453 (`app.listen` bootstrap to gate), bottom of `createApp()` where 404 handler lives (mount middleware just above), every route currently using `try { await kineticaSqlHelper(...) } catch ... res.status(502)` (strip pattern)
- `kinetica_bi/server/src/auth.ts` — `clearSessionCookie` function (called by new middleware on 401)
- `kinetica_bi/server/src/kineticaErrors.ts` (Phase 2) — the typed error classes the middleware checks
- `kinetica_bi/server/.env.example` — lines 3-4 (delete)
- `kinetica_bi/server/tests/setup.ts` — `KINETICA_USERNAME` priming to remove
- `kinetica_bi/server/tests/routes.{sql,wms,discovery,materialize}.spec.ts` — env-var-reading negative assertions to convert to hardcoded sentinel
- `kinetica_bi/src/api/client.ts` — lines 1-11 (`apiFetch`, `UNAUTHORIZED_EVENT`); 26+ `apiFetch`-using helpers throughout (selective migration to `useApiQuery`)
- `kinetica_bi/src/App.tsx` — lines 24-28 (UNAUTHORIZED_EVENT listener; logic unchanged but auth-store gains `reason` field)
- `kinetica_bi/src/store/auth.ts` — extend with `reason: "session-expired" | null`
- `kinetica_bi/src/components/LoginPage.tsx` — read `reason` from store, render banner
- `kinetica_bi/src/components/Dashboard.tsx`, `DashboardsPage.tsx`, `DatasetsPage.tsx` — high-traffic data-fetch sites for `useApiQuery` migration
- `README.md` — lines 85-86 (env-var table rows to delete)

### External / spec
- Express 4 error-handling middleware contract (4-arg signature, `(err, req, res, next)`) — already part of Express; no new dependency.
- `sonner` v1.x (if adopted for toasts) — peer-dep React 18, ~5KB gz. Existing dependency footprint already includes React 18.
- Node `process.env.NODE_ENV` semantics — `tests/setup.ts` sets to `"test"`; production deploys leave unset or set to `"production"`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`clearSessionCookie(res)` in `auth.ts` (Phase 1)** — called by the new middleware on 401-REAUTH. No new helper needed.
- **`UNAUTHORIZED_EVENT` plumbing already exists** in `client.ts` and `App.tsx`. Phase 3 changes the *trigger* (now: code-based; before: status-only) without rebuilding the dispatch path.
- **`useAuthStore` (Phase 1)** — Zustand store; extending with `reason: "session-expired" | null` is idiomatic, matches the existing `markUnauthenticated`/`bootstrap` action pattern.
- **Phase 2's typed errors (`kineticaErrors.ts`)** — direct input to the middleware's `instanceof` switch.
- **Phase 2's spike-driven 400+access-denied → `KineticaPermissionError`** — already implemented in the helper. Middleware just maps `KineticaPermissionError` → 403, automatically covers materialize permission denial.
- **`tests/setup.ts` (Phase 1)** sets `NODE_ENV = "test"`. The bootstrap gate uses this same flag.
- **Existing `try/catch` pattern in widgets** — most chart components already wrap their fetches in `try { setLoading(true); ... } catch { setError(e) } finally { setLoading(false) }`. `useApiQuery` is a refactor over this pattern, not a green-field invention.
- **Phase 2's audit log** — already records `outcome: "auth-fail" | "permission-denied" | "upstream-error"` matching the typed error types. Phase 3 doesn't touch logging.

### Established Patterns
- **Routes throw, middleware translates** — Phase 3 standardizes this end-to-end. Phase 2 had it half-done (helper threw, routes caught and 502'd). Phase 3 finishes it.
- **One file per concern** in tests (`routes.sql.spec.ts`, `routes.wms.spec.ts`, etc.). Phase 3's middleware tests likely live in `tests/errorMiddleware.spec.ts` or `tests/routes.errorMiddleware.spec.ts`.
- **Generic error responses** (no Kinetica-internal details leak to clients) — middleware preserves this. The thrown errors carry sanitized messages from Phase 2's helper; the middleware just stamps the status code.
- **`code` field on 401, no `code` elsewhere** — Phase 1 set this precedent in `requireAuth`'s 401 responses. Phase 3 inherits.
- **`apiFetch` is the single network entry point on the frontend.** Every Kinetica-touching call goes through it. Modifying its dispatch logic affects all callers — desirable for this refactor.

### Integration Points
- **`createApp()` bottom of file** — middleware mounts here, just before 404 handler.
- **`createApp()` top of file (after `app.use(cookieParser())`)** — no change in Phase 3; mention only because some readers may consider mounting middleware early.
- **`apiFetch` in `client.ts`** — single change, rippling effect on all 26+ helpers (their behavior on 401 changes).
- **App.tsx UNAUTHORIZED_EVENT listener** — auth store action invocation; needs to set `reason: "session-expired"`.
- **`useAuthStore`** — add `reason` field, action to set/clear it.
- **Each migrated widget** — replaces local `useState` + `useEffect` + `try/catch` with `useApiQuery(fetchFn, deps)`.
- **`requireConfig`** — middleware function in `index.ts`; narrow body, leave mounting unchanged.

</code_context>

<specifics>
## Specific Ideas

- **Materialize is the one route that keeps a try/catch.** Not because the middleware can't handle it, but because there's a side effect (`updateViewStatus(id, "error", message)`) that must happen for any failure path. The pattern `try { await ...; updateViewStatus(id, "created"); } catch (err) { updateViewStatus(id, "error", String(err)); next(err); }` keeps the side effect at the route level (where `id` is in scope) while still routing the error response through the middleware. Don't try to factor this into the middleware — the middleware doesn't know which view to update.
- **The `code` field is the dispatch contract, not the status code alone.** SC#3 from ROADMAP is explicit: "the frontend dispatches on the code, not just status." Future endpoints might return 401 for non-session reasons (rare, but possible) and the frontend should NOT logout in that case. The body-peek implementation defends against this regression.
- **The toast + grayed-widget combination matters.** A user clicking on a chart they can't see needs immediate feedback (toast: "you don't have permission") AND persistent visual context (the chart stays grayed out so they don't keep clicking). One alone is insufficient — toast disappears, grayed alone leaves the user wondering why.
- **`useApiQuery` is intentionally bounded scope.** Migrating all 26+ helpers in one phase is a recipe for stalled completion. Pick the 4-5 sites that stuck-spinner regressions are most likely to surface from (high-traffic dashboard data, schema discovery — the widgets a user sees first when they open the app) and migrate those. The remaining helpers stay on `try/catch` and get migrated as they're touched for other reasons.
- **`git grep` for SC#5 must exclude `.planning/`.** The CONTEXT/SUMMARY/RESEARCH/PLAN files in `.planning/` are intentional history. ROADMAP SC#5 says "outside of intentional historical references (e.g., changelog)" which permits the exclusion. The planner should hardcode the exclusion in the verification command.
- **Order matters for the bootstrap gate.** Wrap `app.listen` AND `startSessionSweep` together. If you only wrap `app.listen`, `startSessionSweep` fires in tests and creates a 1-hour interval that vitest tolerates (because of `.unref()`) but pollutes the process. Both go inside the gate.

</specifics>

<deferred>
## Deferred Ideas

- **Migrating all 26+ `client.ts` helpers to `useApiQuery`** — Phase 3 ships the hook and migrates the 4-5 highest-traffic sites. Remaining helpers migrate opportunistically. Tracked here so the inconsistency isn't forgotten.
- **Username pre-filled on the re-login form** — `AUTH-V2-01`, captured in REQUIREMENTS.md. Banner copy is fixed in Phase 3; pre-filling the username field is V2.
- **"Sign me out everywhere" / session-revocation UI** — `AUTH-V2-07`. Out of milestone.
- **Sliding-window TTL** — `AUTH-V2-06`. Schema is ready (`last_used_at` from Phase 1); just needs an `extendSession` action and an `expires_at` update. Out of milestone.
- **Per-call latency histograms / Prometheus metrics** — `OBS-V2-01`. Audit log carries `duration_ms` (Phase 2); a future exporter consumes it. Out of milestone.
- **Failed-login alerting** — `OBS-V2-02`. Out of milestone.
- **Session-lifecycle audit stream (separate from per-call audit log)** — Phase 1 deferred. Not requested in v1.0.
- **CSRF protection for mutating routes** — not in milestone scope. Auth is via `httpOnly` `sameSite: "lax"` cookies; CSRF is mitigated by the SameSite default. Worth revisiting if the app is exposed cross-origin in a future deployment.
- **Toast library bikeshedding** — Claude picks during planning (`sonner` recommended; in-house also fine). Not a user-decided question.
- **More aggressive widget recovery (retry button on permission-denied state)** — not in scope. The user knows they don't have permission; a retry button implies the answer might change, which it won't without an admin action.

</deferred>

---

*Phase: 03-auth-failure-ux-admin-credential-removal*
*Context gathered: 2026-04-28*
