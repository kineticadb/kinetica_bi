# Phase 2: Per-user credential passthrough on every Kinetica call - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor every downstream Kinetica/gpudb call to authenticate as the BI user who initiated the request, using `req.user.creds` attached by Phase 1's `requireAuth`. Five call sites convert: `POST /api/sql`, the three discovery routes (`schemas`/`tables`/`columns`) sharing the `kineticaSql` helper, `POST /api/views/:id/materialize`, and `GET /api/wms`. Every call emits one audit log line (OBS-01). The shared admin module-level consts `kineticaUser` / `kineticaPassword` (`index.ts:44-45`) are deleted to mechanically force every site to migrate (TypeScript will surface any miss). Auth failures throw typed errors but Phase 2 keeps the existing 502 client-facing response shape — Phase 3 wires the global middleware that maps typed errors to the user-visible 401-REAUTH / 403-permission / 502-upstream dispatch (UX-01/02/03). `requireConfig` narrowing and `KINETICA_USERNAME`/`PASSWORD` env-var deletion are Phase 3 (ADMN-01/02).

</domain>

<decisions>
## Implementation Decisions

### Helper API surface

- **Split helpers, not one entry point.** `kineticaSql(req, sql, { route, options? })` for the four SQL sites (proxy + 3 discovery); `kineticaWms(req, query, { route })` for the WMS proxy. They share an internal fetch primitive for the `Authorization` header construction and timing/audit emission, but the public surface is two functions because the call shapes (POST JSON vs GET binary) and return types (parsed JSON vs Buffer) are fundamentally different.
- **`req`-aware signatures.** Helper pulls `req.user.creds` and the live `KINETICA_URL` itself rather than every route passing them explicitly. Consistent with the roadmap wording (`kineticaCall(req, ...)`).
- **Routes call the helper and translate.** Every route does `try { const data = await kineticaSql(req, sql, { route: "POST /api/sql" }); ... } catch (e) { ... }`. Route handlers stay thin.

### Failure signaling — typed errors

- Helper throws one of three typed error classes (planner picks file location; suggested: new `kineticaErrors.ts` to keep auth.ts focused):
  - `KineticaAuthError` — Kinetica returned HTTP 401 (creds invalid; may indicate password rotation mid-session)
  - `KineticaPermissionError` — Kinetica returned HTTP 403 (user authenticated but lacks permission for this resource)
  - `KineticaUpstreamError` — anything else: HTTP 5xx, network failure, malformed response, body `status: "ERROR"` with no recognizable category
- **Status code drives the type.** Trust Kinetica's HTTP status directly — no body-message parsing for the 401/403 split. (If Kinetica ever returns 200 with `status: "ERROR"`, that becomes `KineticaUpstreamError`.)
- **No retry logic in v1.0.** Network failure throws `KineticaUpstreamError` immediately. Resilience patterns (retry, circuit breaker) are out of scope for the milestone.
- **Sanitized `error.message`, raw body in `console.error` only.** Thrown errors carry a generic message safe to surface to the route handler ("Kinetica permission denied for SELECT on …" — without leaking internal Kinetica strings). The raw upstream body, if any, is logged via `console.error` for ops-side debugging but never included in the thrown error or HTTP response.

### Phase 2 client-facing behavior — UNCHANGED

- **Each route wraps the helper call in try/catch and returns 502** — same as today. No new client-visible response shapes in Phase 2. This explicitly preserves the boundary with Phase 3, which owns:
  - The global Express error middleware that catches `KineticaAuthError`/`KineticaPermissionError`/`KineticaUpstreamError` and maps to 401-REAUTH / 403 / 502 with the right `code` field for frontend dispatch (UX-01/02/03)
  - The cookie-clear-on-mid-session-auth-fail behavior
  - The frontend three-way dispatch on `code`
- The typed error classes themselves ship in Phase 2 (so the helper can throw them); the middleware that routes them to user-visible responses ships in Phase 3.

### Audit log (OBS-01)

- **Emitted from inside the helper.** Single source of truth — a new route can't accidentally skip the log line because the call goes through the helper. Each call site passes its `route` label as an argument.
- **Single-line JSON, one entry per call:**
  ```json
  {"ts":"2026-04-28T14:22:01.142Z","request_id":"...","username":"alice","route":"POST /api/sql","op":"SQL","outcome":"success","status":200,"duration_ms":142}
  ```
- **`op` enum:** `SQL` (4 SQL sites including materialize)`*`, `MATERIALIZE` (when route is the materialize endpoint), `DISCOVERY` (the 3 discovery routes), `WMS`. Planner: distinguish `MATERIALIZE` from generic `SQL` and `DISCOVERY` from generic `SQL` so logs can be filtered without parsing the route string.
- **`outcome` enum:** `success` | `auth-fail` | `permission-denied` | `upstream-error`. Maps 1:1 to the typed errors plus success.
- **`status`** is the HTTP status returned to the client (502 on every failure in Phase 2; will become 401/403/502 after Phase 3's middleware lands — same log shape, different distributions).
- **SQL body is NEVER logged.** Per OBS-01 ("no full SQL bodies that may contain PII") and Pitfall 17. No truncated SQL, no SHA hash, no first-N-chars. Only the operation type. WMS query strings are similarly dropped — bbox params can leak location intent.
- **`request_id`** — a UUID generated once per request. `requireAuth` (or a small reqId middleware mounted just before it) attaches `req.requestId`; the helper reads it. Useful for correlating one user action that triggers many Kinetica calls (e.g., dashboard load = many discovery calls + chart SQL + materialize). Planner picks the exact attach mechanism.
- **Audit log goes to `console.log`. Raw upstream-error stack/body goes to `console.error` separately.** Two-channel split: one clean, parseable line for ops dashboards plus a separate noisy debug stack only when something fails. Existing `console.error("Kinetica X error", error)` calls in the routes are deleted (the helper owns logging).

### Materialize service-account spike

- **First task of Phase 2, before any refactor.** Mirror Phase 1's token-exchange spike: blocking discovery work that locks the design before code lands.
- **Spike protocol:** create a least-privileged Kinetica user (granted `SELECT` on the relevant test schemas/tables, no DDL grants); attempt `CREATE OR REPLACE MATERIALIZED VIEW test_view AS SELECT * FROM ki_home.test_table` via `/execute/sql` with that user's Basic auth. Document exactly which grants the test user has, what the response is, what the failure mode looks like.
- **Output:** a short `SPIKE.md` in the phase directory committed alongside `02-PLAN.md`. Sections: Setup (test user grants), Test, Result, Recommendation, References.
- **Default policy if materialize fails for restricted users:** **per-user materialize, fail loudly.** The `KineticaPermissionError` propagates; the user sees an inline "you don't have permission to materialize" error on the affected widget (this is exactly UX-02 behavior, just earlier in the milestone). Consistent with the milestone principle: no shared-admin escape hatch.
- **Phase 2.1 contingency.** Only spawns if the spike output reveals (a) materialize fails for typical BI users *and* (b) the team determines loud-failure is unacceptable for milestone delivery. Phase 2.1 would handle the chosen alternative (service-account-for-materialize, pre-create-via-migration, or REFRESH-only). Phase 2 still ships the other 4 sites in either case.
- **Decision flow:** spike → SPIKE.md committed → user reviews recommendation → if loud-failure is acceptable, Phase 2 proceeds as planned; if not, `/gsd:insert-phase 2.1` and update the helper accordingly. Phase 2 does NOT pre-design a service-account fallback — that's premature.

### Module-const removal — `kineticaUser` / `kineticaPassword`

- Both module-level consts at `index.ts:44-45` are **deleted in Phase 2** (not Phase 3). Phase 2's success criteria #3 explicitly says `git grep` returns zero matches for these identifiers in `index.ts`; that requires the deletion now. TypeScript surfaces every missed call site as a compile error, which is the design intent.
- The `KINETICA_USERNAME` / `KINETICA_PASSWORD` *env vars* are still read in Phase 2 by `requireConfig` (which Phase 3 narrows/replaces under ADMN-02). Phase 2 leaves `requireConfig` untouched — narrowing it requires the auth-failure middleware to be live to maintain "every route still serves" guarantees.

### Claude's Discretion

- Exact filename for the typed-error classes (`src/kineticaErrors.ts`, `src/errors.ts`, or co-located in `src/kinetica.ts` alongside the helpers).
- File location of `kineticaSql` / `kineticaWms` (new `src/kinetica.ts` module is recommended; alternatives like `src/lib/kinetica/*` are fine).
- Exact mechanism for `request_id` attachment — `requireAuth` extension vs. dedicated `requestId` middleware mounted before `requireAuth`. Both are acceptable.
- Whether the helper accepts an optional `signal: AbortSignal` for future cancellation work (not required, harmless if added).
- Specific log-key naming (`username` vs `user`, `op` vs `operation`) as long as the field set matches the decisions above.
- The precise shape of the SPIKE.md sections — format above is a suggestion, not a contract.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research
- `.planning/research/SUMMARY.md` §"Implications for Roadmap" → Phase 2; §"Watch Out For" item 2 (5 call sites)
- `.planning/research/ARCHITECTURE.md` §3 "The New `kineticaCall` Abstraction"; §4 "Refactor Targets" (5-site enumeration); §6 Phase 2; §"Anti-Patterns"
- `.planning/research/FEATURES.md` §"Table Stakes" TS-1 (per-user creds), TS-3 (auth failure → re-login surface — partially Phase 3); §"Differentiators" D-1 (audit log)
- `.planning/research/PITFALLS.md` Pitfalls 7 (helper boundary), 8 (audit log shape), 16 (materialize DDL — drives the spike), 17 (log-leak discipline → no SQL bodies, no raw upstream payloads)

### Phase-1 outputs (consumed by Phase 2)
- `.planning/phases/01-encrypted-server-side-session-store/01-CONTEXT.md` §`<decisions>` "Session lifecycle" — defines the `req.user = { sub, creds: { username, password } }` shape that the helper consumes
- `.planning/phases/01-encrypted-server-side-session-store/01-VERIFICATION.md` — confirms `req.user.creds` is reliably attached on every authenticated request
- `kinetica_bi/server/src/auth.ts` (Phase 1 output) — `requireAuth`, `loadSessionForRequest`, `decodeAndVerifyJwt`. Helper does NOT reach into auth internals; it consumes `req.user` as published.
- `kinetica_bi/server/src/sessionStore.ts` (Phase 1 output) — `touchSession` is already called by `requireAuth`; helper does not need to interact with sessionStore directly.

### Project-level
- `.planning/PROJECT.md` Constraints ("BI app sign-in validates against Kinetica; per-user credentials authorize every downstream call (no shared admin)"); Key Decisions (`Per-user Kinetica passthrough`)
- `.planning/REQUIREMENTS.md` CRED-01..06, OBS-01 (this phase's requirements). Out-of-Scope row "Admin-credential fallback when user creds fail" is the policy backstop for the materialize spike default.
- `.planning/STATE.md` "Blockers/Concerns" — Pitfall 16 materialize verification (now scheduled as Phase 2's kickoff spike)
- `.planning/ROADMAP.md` Phase 2 Goal, Success Criteria, Phase 2 verification flag (materialize service-account)

### Existing code (5 refactor anchors in `kinetica_bi/server/src/index.ts`)
- Lines 44-45 — `kineticaUser` / `kineticaPassword` module consts (DELETED in Phase 2; deletion forces TS errors at every missed site)
- Lines 60-67 — `requireConfig` middleware (LEFT ALONE in Phase 2; Phase 3 narrows under ADMN-02)
- Line 250 — `POST /api/views/:id/materialize` (refactor; subject to spike outcome)
- Lines 333-365 — `kineticaSql` helper (DELETED — replaced by `kineticaSql(req, sql)` in new module)
- Lines 367-378 — `GET /api/kinetica/schemas` (refactor; consumes new helper)
- Lines 380-392 — `GET /api/kinetica/schemas/:schema/tables` (refactor)
- Lines 394-410 — `GET /api/kinetica/schemas/:schema/tables/:table/columns` (refactor)
- Lines 413-439 — `GET /api/wms` (refactor; uses `kineticaWms` not `kineticaSql`)
- Lines 442-475 — `POST /api/sql` (refactor)

### External / spec
- Kinetica REST `/execute/sql` endpoint — request shape (`statement`, `offset`, `limit`, `encoding`, `request_schema_str`, `data`, `options`); response shape (`status`, `message`, `data_str`, `data_str.json_encoded_response` columnar JSON). Existing `kineticaSql` at lines 333-365 is the canonical reference for the body parsing pattern; helper preserves this.
- Kinetica REST `/wms` endpoint — query-string passthrough, binary tile response. Existing WMS handler at lines 413-439 is canonical.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 1's `requireAuth` already attaches `req.user = { sub, creds: { username, password } }`** — the helper consumes this directly. No coupling to sessionStore internals.
- **Existing `kineticaSql` body-parse pattern** at `index.ts:355-364` (extract `body.data_str` → parse `json_encoded_response` → return columnar object) is correct and reused by the new helper. Helper is largely a refactor that adds auth/logging/error-typing around this same parse.
- **`createApp()` factory** (Phase 1, `index.ts:47`) already exposes the app for supertest. New Phase 2 helpers can be tested via supertest with a real session row created through the existing test helpers (`tests/helpers/app.ts` from Phase 1).
- **Phase 1's vitest setup** — 56 tests passing, isolated `:memory:` SQLite per spec via `tests/setup.ts`. Phase 2 tests slot in alongside without infrastructure work.

### Established Patterns
- **`console.log` for normal events, `console.error` for failures** (e.g., `[sessions] swept N expired rows` from Phase 1). Phase 2 audit log goes to `console.log` (success or fail outcome both surface there as one parseable line); raw upstream stack/body goes to `console.error` separately.
- **Generic, non-leaky error responses** to the client — `{ error: "Failed to fetch X", detail: String(error) }` is the existing pattern at e.g. `index.ts:376`. Phase 2 narrows this further: `detail: String(error)` should be replaced with the helper's sanitized message; the raw `error` only goes to `console.error`.
- **Synchronous SQLite, async HTTP** — helper is async (uses `fetch`), but it does not touch the database. SessionStore reads happen in `requireAuth` before the helper runs.
- **No third-party HTTP client** — Node 24's built-in `fetch`. Helper continues this.
- **Module-level `dotenv.config()` at line 42** — `process.env.KINETICA_URL` is reliably populated by the time the helper executes.

### Integration Points
- **New module: `kinetica_bi/server/src/kinetica.ts` (suggested)** — exports `kineticaSql`, `kineticaWms`, and the typed error classes. Single import surface for `index.ts`.
- **`index.ts:44-45` deletion** — the change that mechanically forces every site to migrate. Order of operations: write helper + types first (compiles, doesn't break anything), then refactor each site, then delete the consts (last task — surfaces any miss).
- **`tests/kinetica.helpers.spec.ts` (new)** — covers helper authentication header construction, error-class throwing rules, audit log shape, sanitization. Use Phase 1's `tests/helpers/app.ts` for full-route integration tests with real cookies.
- **No frontend changes in Phase 2.** `kinetica_bi/src/api/client.ts` and `App.tsx` are untouched; the existing `UNAUTHORIZED_EVENT` plumbing keeps working since 502s in Phase 2 don't trip 401 dispatch and 401s won't surface until Phase 3's middleware lands.

</code_context>

<specifics>
## Specific Ideas

- **Per-user materialize with loud failure is the default — not a fallback.** This isn't a graceful degradation pattern; it's the milestone's principle made concrete. If a user can't materialize, that's Kinetica's permission model working correctly. The spike exists to confirm this is operationally tolerable, not to find an excuse to keep a shared admin path.
- **The audit log is the milestone's first observability artifact, period.** It's the foundation that Phase 3's UX dispatch (UX-01/02/03) will let ops correlate against. Getting the field set right now (especially `request_id`) means a future move to a structured logging stack is just routing — no field-shape migrations.
- **Phase 2's success criteria #3 (`git grep` returns zero matches) is mechanically enforced** by deleting the module consts. Don't rely on reviewer attention; rely on `tsc` failing the build if any site is missed. This is the test that the refactor is complete.
- **Helper is `req`-aware but does NOT reach into Phase 1 sessionStore internals.** It only consumes `req.user.creds`. Tests for the helper should construct a fake `req` directly (`{ user: { sub: "alice", creds: { username, password } } }`); they don't need a sessions row.
- **Order of plan tasks matters for blast-radius control:** spike → write helper + tests → refactor SQL proxy (smallest blast radius, easiest to verify) → refactor 3 discovery sites (share old helper, all migrate together) → refactor materialize (subject to spike outcome) → refactor WMS (different shape, isolated) → delete module consts (last; surfaces misses).

</specifics>

<deferred>
## Deferred Ideas

- **Retry / circuit breaker on transient upstream failures** — out of v1.0; can be added inside the helper later without changing the public surface.
- **Per-call latency histograms / Prometheus counters** — captured as `OBS-V2-01`. The audit log's `duration_ms` field is the schema enabler; v2 just adds an exporter.
- **Failed-login alerting** — `OBS-V2-02`; out of v1.0.
- **Cancellation via `AbortSignal`** — only useful when the BI server has a request-cancel signal of its own (not currently the case). Helper can accept an optional `signal` arg without committing to wiring it up.
- **Cross-user response cache** — explicitly Out of Scope in REQUIREMENTS.md (Pitfall: leaks one user's data to another with different perms). Not deferred — rejected.
- **"Acting as" / impersonation** — explicitly Out of Scope. Would require a separate phase with its own permission model.
- **Materialize via migration script (operator pre-creates views at deploy time)** — listed as a possible spike-driven outcome under Phase 2.1 contingency; only revisited if the spike + team review demand it.

</deferred>

---

*Phase: 02-per-user-credential-passthrough-on-every-kinetica-call*
*Context gathered: 2026-04-28*
