# Phase 13: spikes-and-endpoint - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Two distinct workstreams:

1. **Operator spikes (S1-S4)** — verify Kinetica-deployment-specific behavior the rest of v1.3 depends on. Each spike produces a concrete pass/fail with a documented downstream consequence.
2. **Net-new materialize endpoint** — `POST /api/filter/materialize` and `DELETE /api/filter/materialize` that create-or-replace / drop a transient Kinetica materialized view scoped to `(user, session, dashboard, table)` with a 5-min sliding TTL. Server is stateless — no SQLite tracking; Kinetica TTL is sole authoritative cleanup.

Out of scope for Phase 13: client-side store wiring (Phase 14), chart FROM-swap (Phase 15), map LAYERS-swap (Phase 16), dead-code deletion (Phase 15), end-to-end verification (Phase 17). The endpoint ships in Phase 13 with supertest coverage; no client consumer exists yet.

</domain>

<decisions>
## Implementation Decisions

### Spike methodology (user-locked)

- **Spike runner:** Operator runs all four spikes live against deployed Kinetica using their own BI-user credentials. Claude does not script the probes. This matches the v1.2 Phase 11 pattern (Plan 11-01 was the spike plan; SPIKE-NOTES.md captured findings).
- **Spike output location:** Single file at `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md`. One section per spike with: probe command, observed result, pass/fail, downstream consequence. No per-spike files; no inline-in-CONTEXT spread.
- **Spike timing within Phase 13:** All four spikes complete BEFORE endpoint construction. Suggested plan structure:
  - Plan 13-01 — Operator spikes S1-S4, write 13-SPIKE-NOTES.md
  - Plan 13-02+ — Endpoint construction informed by spike findings
  Linear; lowest rework risk; spike findings drive endpoint shape decisions (especially S2 → permission branch, S4 → schema-qualification of returned viewName).
- **S1 fail path:** If SPIKE-V13-01 (WMS LAYERS=view) fails, **endpoint still ships** as planned. MAP-V13-* requirements defer to a post-v1.3 follow-up phase. Phase 13 does NOT block on S1; charts unblock independently in Phases 14-15. Phase 16 (map-filtering) becomes a documented gap-closure later. The endpoint always knows how to materialize/drop views regardless of S1 outcome.

### Spike scope per-spike (research-driven)

| Spike | Probe target | Pass = | Fail consequence |
|-------|--------------|--------|------------------|
| S1 | WMS GetMap with `LAYERS=<materialized_view_name>` returns valid tile bytes | Tiles render against deployed Kinetica | MAP-V13-* defers post-v1.3; no Phase 16 work in this milestone |
| S2 | Per-user creds (in both `AUTH_MODE=password` and `AUTH_MODE=oidc`) execute `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = 5)` and `DROP TABLE IF EXISTS` against a real table | DDL succeeds for typical BI-user grant level | Service-account DDL path becomes a gap-closure plan within Phase 13 (e.g. `13-NN-service-account-ddl-PLAN.md`); does NOT speculatively pre-build |
| S3 | Query a materialized view that has been dropped — capture exact Kinetica error message string, HTTP status, and any `code`/category fields returned by `kineticaSql` | Concrete error pattern documented (e.g. `"table 'NAME' does not exist"`) | LIFE-V13-02 reactive recovery branch can't be built precisely; falls back to a broader catch (e.g. any 400-class with `KineticaUpstreamError`) |
| S4 | `LAYERS=<view_name>` (unqualified) vs `LAYERS=<schema>.<view_name>` (qualified) — both via WMS GetMap; record which form Kinetica accepts | Either form works (or both); endpoint returns matching format | Endpoint must always return schema-qualified viewName; client must always use it |

### Claude's Discretion (deferred — research-informed defaults)

The user explicitly chose not to discuss these areas. Defaults below are derived from research SUMMARY.md, codebase scout (`index.ts:613-648`, `index.ts:801-823`), and v1.0/v1.2 conventions. Planner may refine; user can revisit at plan-checkpoint.

#### DDL permission UX (VIEW-V13-05) — default

- **Error response shape:** Match existing convention from `errorMiddleware` (`index.ts:812-815`) — `KineticaPermissionError` → 403 + `{ error }` with **NO `code` field**. The REQUIREMENTS.md mention of `code: "DDL_DENIED"` was a placeholder; the existing convention wins. Client toast text is driven from response message text, not from a discriminated code.
- **Service-account fallback:** NOT speculatively built in Phase 13. Only added as a gap-closure plan IF SPIKE-V13-02 reveals DDL denied for typical BI users. Decision is documented in 13-SPIKE-NOTES.md.
- **Toast cadence (client side, lands in Phase 14-15):** "Filtering not enabled for your account — contact your administrator." One-time per session (suppression via `useFilterViewStore` flag).

#### Endpoint API shape — default

- **URLs:** `POST /api/filter/materialize` (apply) + `DELETE /api/filter/materialize` (clear). Paired endpoints — NOT single-POST-with-empty-filters-auto-drop. Clearer semantics; more idiomatic; matches REQUIREMENTS.md VIEW-V13-01/02 split.
- **Mounted under** `/api/filter/*` namespace (new); guarded by existing `app.use("/api", requireAuth)` (`index.ts:420`).
- **Wrappers:** `requireConfig` + `asyncHandler` — same pattern as `/api/views/:id/materialize` (`index.ts:613`).
- **POST request body:** `{ dashboardId: number, tableId: number, filters: ActiveFilter[] }`.
- **POST response:** `{ viewName: string, expiresAt: number }` (epoch ms; client computes against `Date.now()`).
- **DELETE request body:** `{ dashboardId: number, tableId: number }` (or via query params; planner picks).
- **DELETE response:** `{ dropped: true }`.
- **Error translation:** Typed errors (`KineticaAuthError`/`KineticaPermissionError`/`KineticaUpstreamError`) bubble through `asyncHandler` → existing `errorMiddleware`. No try/catch in route handler (Phase 3 lock — except where side effects required, which Phase 13 has none of since server is stateless re views).

#### View-name details — default

Per the locked shape `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`:

- **`sessionShort`:** First 8 hex chars of `sessionId` (16M+ entropy; minimal collision risk for typical concurrent-user counts; concise).
- **OIDC userId sanitization:** Alphanumeric chars preserved as-is; any other char → `_`. Truncate to max 32 chars total. Examples:
  - `john.doe@kinetica.com` → `john_doe_kinetica_com` (21 chars, fits)
  - `auth0|abc123def456...` → `auth0_abc123def456_...` truncated at 32
- **Total length:** Well under Kinetica's 200-char view-name limit even worst-case (32 + 32 + 32 + 4 + 8 + ~10 separators ≈ 120).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.3 architecture (project-level)
- `.planning/PROJECT.md` § "Current Milestone: v1.3 Unified Dashboard Filtering" — Locked architecture, target features, P1 spike list, dead-code list, two-store split
- `.planning/REQUIREMENTS.md` § "P1 Architectural Spikes" + "Backend Materialize Endpoint" — SPIKE-V13-01..04, VIEW-V13-01..07 specs in full

### v1.3 research (commit `e68080f`)
- `.planning/research/SUMMARY.md` — Synthesized findings + cross-file contradiction resolutions; reads like a TL;DR for the planner
- `.planning/research/STACK.md` — Kinetica DDL syntax (`USING TABLE PROPERTIES (TTL = 5)`, sliding semantics); per-user DDL permission unknown (S2 verifies); naming constraints (200 chars max, underscore-prefix allowed); zero new npm deps
- `.planning/research/ARCHITECTURE.md` — Endpoint shape recommendation (stateless; no SQLite); ties into existing `kineticaSql(req, ...)` helper; `requireAuth` middleware already gates `/api/*`
- `.planning/research/PITFALLS.md` — V13-P-08 (OIDC userId char sanitization); V13-P-09 (multi-tab same-user same-session: deterministic name causes last-write-wins; accepted); V13-P-12 (DDL permission failure handling); V13-P-S1 (server-side WHERE builder placement)

### Existing v1.0/v1.1/v1.2 patterns (codebase)
- `kinetica_bi/server/src/index.ts:613-648` — Pre-v1.0 `/api/views/:id/materialize` endpoint reference implementation (DDL string composition, `kineticaSql` invocation with `op: "MATERIALIZE"`, typed-error try/catch with side effects)
- `kinetica_bi/server/src/index.ts:801-823` — `errorMiddleware` translation rules: `KineticaAuthError` → 401 + `code: "REAUTH_REQUIRED"`; `KineticaPermissionError` → 403 + `{ error }` (NO code field — convention to follow for VIEW-V13-05)
- `kinetica_bi/server/src/index.ts:197-208` — `requireConfig` middleware + `asyncHandler` wrapper pattern
- `kinetica_bi/server/src/index.ts:420` — `app.use("/api", requireAuth)` global guard
- `kinetica_bi/server/src/kinetica.ts` — `kineticaSql(req, sqlString, options)` helper signature; branches on `credentialType` for password vs OIDC; handles per-user creds from session
- `kinetica_bi/server/src/kineticaErrors.ts` — Typed error classes: `KineticaAuthError`, `KineticaPermissionError`, `KineticaUpstreamError`

### v1.2 Phase 11 spike precedent
- `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` — Format/structure model for `13-SPIKE-NOTES.md`. Plan 11-01 was the spike plan; rest of phase consumed findings.
- `.planning/phases/11-map-chart/11-01-wms-spike-and-cache-control-PLAN.md` — Plan structure for spike plans (probe definitions, acceptance criteria, output file)

### v1.2 carry-forward (downstream phases consume this)
- `kinetica_bi/src/store/filterStore.ts` — `ActiveFilter` shape that POST request body's `filters[]` field accepts; `useFilterStore` actions stay unchanged

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`kineticaSql(req, sqlString, { route, op, extra? })` helper** (`kinetica_bi/server/src/kinetica.ts`) — single helper for any per-user-credentialed Kinetica SQL call. Phase 13's POST endpoint passes the composed `CREATE OR REPLACE MATERIALIZED VIEW ...` DDL through this helper with `op: "MATERIALIZE"`; DELETE passes `DROP TABLE IF EXISTS ...` with `op: "DROP_VIEW"` (or similar new op tag).
- **`requireConfig` + `asyncHandler` wrappers** (`kinetica_bi/server/src/index.ts:197-211`) — Phase 13 routes use both, identical pattern to `/api/views/:id/materialize`.
- **Typed error classes + errorMiddleware** (`kinetica_bi/server/src/kineticaErrors.ts`, `index.ts:801-823`) — Phase 13 routes do NOT need try/catch (server is stateless re views; no side effects to persist). Errors bubble through `asyncHandler` and middleware translates to HTTP.
- **`AuthedRequest` type** (`kinetica_bi/server/src/types.ts`) — `req.user.creds` (password or token) and `req.user.username` available post-`requireAuth`. View-name builder reads `req.user.username` for the userId component; `req.user.sid` (or session id from cookie) for sessionShort.

### Established Patterns

- **Route file layout** — All routes currently inline in `index.ts`. Phase 13 may extract `/api/filter/*` routes to a new module (`routes/filterMaterialize.ts`) to keep `index.ts` from growing further; or keep inline. Planner's call.
- **Supertest pattern** — `kinetica_bi/server/tests/*.spec.ts` mounts `buildTestApp()` and asserts on routes. Phase 11 (`tests/routes.wms.capabilities.spec.ts`) shows the `vi.mock('../src/kinetica')` pattern for mocking `kineticaSql` to assert on DDL string shape without hitting real Kinetica. Phase 13 supertests follow the same pattern: mock `kineticaSql`, assert SQL string shape per `op` tag.
- **`vi.stubEnv("AUTH_MODE", "password")` requirement** — Production `.env` has `AUTH_MODE=oidc`; tests must stub before `buildTestApp()` to avoid boot-time session-wipe. Phase 13 supertests cover both modes (password + oidc) per VIEW-V13-07.
- **No-code-field convention for permission errors** (`index.ts:812-815`) — Phase 13 follows this; client interprets from message text.

### Integration Points

- **Mounted under `/api/filter/*`** — adds new namespace alongside existing `/api/views/*`, `/api/dashboards/*`, `/api/wms/*`, `/api/sql`, `/api/kinetica/*`, `/api/auth/*`.
- **Pre-v1.0 view CRUD endpoints UNCHANGED** — `/api/dashboards/:id/views`, `/api/views/:id`, `/api/views/:id/materialize` keep doing what they do (persisted dashboard-table-views with SQLite-backed filter clauses). Phase 13 explicitly NOT extending these.
- **No SQLite migration** — Phase 13 adds zero schema changes. Server is stateless re transient views; the `views` SQLite table is for the persisted view CRUD only.
- **Phase 14 consumer signature** — Phase 14's `materializeFilter(args, signal?)` and `dropFilterView(args)` client helpers will hit Phase 13's endpoints. The request/response shape locked in this CONTEXT.md is what Phase 14's client helpers expect.

</code_context>

<specifics>
## Specific Ideas

- **v1.2 Phase 11 spike plan as model** — User confirmed this pattern: a dedicated spike-runner plan (Plan 13-01) producing 13-SPIKE-NOTES.md, then subsequent plans for the endpoint and supertest. The spike plan's task list is essentially "operator runs probes; record findings."
- **No automation of WMS image diffing** — S1 and S4 involve WMS GetMap responses (binary tile bytes). Operator inspects these visually via curl + image viewer, not via automated byte comparison. Pass = "tile renders against the filtered set"; fail = "tile is empty or errored."
- **Spike findings inform later-phase replanning if needed** — If S2 fails, a service-account DDL plan gets added inside Phase 13 (e.g., 13-04 or higher) as a gap-closure before Phase 14 starts. If S1 fails, MAP-V13-* requirements move to a post-v1.3 backlog item; Phase 16 closes empty (or is removed via `/gsd:remove-phase`); Phase 17 verification scope contracts to charts only.

</specifics>

<deferred>
## Deferred Ideas

- **Service-account DDL fallback path** — Only built if SPIKE-V13-02 reveals per-user DDL denied. Documented in SPIKE-NOTES.md; gap-closure plan added inside Phase 13 if needed. NOT speculatively pre-built.
- **Automated WMS-tile byte-diff for S1/S4** — Future tooling improvement. Out of v1.3 scope; manual operator inspection sufficient.
- **`/api/filter/materialize` rate limiting / throttling** — Server-side debounce was rejected in research (client-side debounce in Phase 14 is the chosen mechanism). If Phase 14's debounce + AbortController prove insufficient under load, revisit in v2.
- **Materialize-progress streaming** — Anti-feature (REQUIREMENTS.md Out of Scope); Kinetica DDL is synchronous.

</deferred>

---

*Phase: 13-spikes-and-endpoint*
*Context gathered: 2026-05-06*
