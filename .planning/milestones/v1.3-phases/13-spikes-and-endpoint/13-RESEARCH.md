# Phase 13: spikes-and-endpoint - Research

**Researched:** 2026-05-06
**Domain:** Operator spike methodology + Express route authoring for transient Kinetica materialized views
**Confidence:** HIGH (all code references verified from actual source files; DDL syntax from Kinetica official docs; testing patterns from existing server test suite)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Spike methodology:**
- Operator runs all four spikes live against deployed Kinetica using their own BI-user credentials. Claude does not script the probes. Matches v1.2 Phase 11 pattern.
- Single file output: `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md`. One section per spike with probe command, observed result, pass/fail, downstream consequence.
- All four spikes complete BEFORE endpoint construction. Plan structure: 13-01 = spike plan, 13-02+ = endpoint construction.
- S1 fail path: endpoint still ships. MAP-V13-* requirements defer to post-v1.3. Phase 13 does NOT block on S1.

**Spike scope (per-spike):**

| Spike | Probe target | Pass = | Fail consequence |
|-------|--------------|--------|------------------|
| S1 | WMS GetMap with `LAYERS=<materialized_view_name>` returns valid tile bytes | Tiles render against deployed Kinetica | MAP-V13-* defers post-v1.3; no Phase 16 work in this milestone |
| S2 | Per-user creds execute `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = 5)` and `DROP TABLE IF EXISTS` | DDL succeeds for typical BI-user grant level | Service-account DDL path becomes a gap-closure plan within Phase 13; does NOT speculatively pre-build |
| S3 | Query a materialized view that has been dropped — capture exact Kinetica error message string, HTTP status, any `code`/category fields | Concrete error pattern documented | LIFE-V13-02 reactive recovery falls back to broader catch (any 400-class with `KineticaUpstreamError`) |
| S4 | `LAYERS=<view_name>` (unqualified) vs `LAYERS=<schema>.<view_name>` (qualified) via WMS GetMap — record which form Kinetica accepts | Either form works | Endpoint must always return schema-qualified viewName; client must always use it |

**Endpoint API shape (locked):**
- URLs: `POST /api/filter/materialize` (apply) + `DELETE /api/filter/materialize` (clear). Paired endpoints — NOT single-POST-with-empty-filters-auto-drop.
- Mounted under `/api/filter/*` (new namespace); guarded by existing `app.use("/api", requireAuth)` at `index.ts:420`.
- Wrappers: `requireConfig` + `asyncHandler` — same pattern as `/api/views/:id/materialize` at `index.ts:613`.
- POST request body: `{ dashboardId: number, tableId: number, filters: ActiveFilter[] }`.
- POST response: `{ viewName: string, expiresAt: number }` (epoch ms).
- DELETE request body: `{ dashboardId: number, tableId: number }` (or via query params; planner picks).
- DELETE response: `{ dropped: true }`.
- Error translation: typed errors bubble through `asyncHandler` → existing `errorMiddleware`. No try/catch in route handler (server is stateless re views; no side effects).

**View-name details (locked):**
- Shape: `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`
- `sessionShort`: First 8 hex chars of `sessionId`.
- OIDC userId sanitization: alphanumeric preserved; any other char → `_`; truncate to max 32 chars total.

**DDL permission UX (locked defaults):**
- Error response: `KineticaPermissionError` → 403 + `{ error }` with NO `code` field. Matches `errorMiddleware` convention (`index.ts:812-815`).
- Service-account fallback: NOT built in Phase 13 unless S2 fails.

### Claude's Discretion

These were explicitly deferred by the user; defaults are established in CONTEXT.md:
- Route file layout: inline in `index.ts` vs extracted to `routes/filterMaterialize.ts` — planner's call.
- DELETE body vs query params — planner picks.

### Deferred Ideas (OUT OF SCOPE)

- Service-account DDL fallback path — only built if SPIKE-V13-02 reveals per-user DDL denied.
- Automated WMS-tile byte-diff for S1/S4 — future tooling improvement.
- `/api/filter/materialize` rate limiting / throttling — rejected in research; client-side debounce in Phase 14.
- Materialize-progress streaming — Kinetica DDL is synchronous; anti-feature.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPIKE-V13-01 | Operator verifies Kinetica WMS resolves `LAYERS=<materialized_view_name>` to valid tiles | Spike plan structure from Phase 11 precedent; WMS LAYERS param docs reviewed (LOW confidence views supported — spike required) |
| SPIKE-V13-02 | Operator verifies per-user creds have DDL permission for `CREATE OR REPLACE MATERIALIZED VIEW` and `DROP TABLE IF EXISTS` | `classifyHttpError` in `kinetica.ts:93-127` already classifies 400+access-denied as `KineticaPermissionError`; permission path fully wired |
| SPIKE-V13-03 | Operator captures exact Kinetica error message/code when querying an expired/dropped materialized view | `KineticaUpstreamError` is the expected container (any 400 without access-denied pattern); exact message text needed for `isViewNotFoundError` in Phase 15 |
| SPIKE-V13-04 | Operator verifies `LAYERS=<view_name>` unqualified vs schema-qualified — which form Kinetica WMS accepts | Informs schema-qualification logic in view-name generator; unresolved until spike |
| VIEW-V13-01 | `POST /api/filter/materialize` with non-empty filters fires `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = 5)` via `kineticaSql` and returns `{ viewName, expiresAt }` | `kineticaSql` signature verified; `op: "MATERIALIZE"` exists in `KineticaOp` enum; DDL syntax confirmed from official docs |
| VIEW-V13-02 | `DELETE /api/filter/materialize` fires `DROP TABLE IF EXISTS <viewName>` and returns `{ dropped: true }` | `DROP TABLE IF EXISTS` is correct Kinetica syntax for views (confirmed in STACK.md); `IF EXISTS` prevents errors on already-expired views |
| VIEW-V13-03 | View-name builder is deterministic: `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>`; OIDC userId sanitized | `req.user.creds.username` for userId; `req.user.sid` (from `SessionPayload`) for sessionShort; `AuthedRequest` type confirmed in `auth.ts:26-38` |
| VIEW-V13-04 | Server is stateless re views — no SQLite tracking; Kinetica TTL=5 sliding is sole cleanup | `dashboard_table_views` table is NOT used; `DROP TABLE IF EXISTS` idiom confirmed; `db.ts` unchanged |
| VIEW-V13-05 | `KineticaPermissionError` surfaces as 403; no `code` field | `errorMiddleware` at `index.ts:812-815` confirmed: `KineticaPermissionError → 403 + { error }` with NO code field |
| VIEW-V13-06 | Server-side WHERE clause builder extracted from deleted v1.2 client-side utilities; same `ActiveFilter[]` input shape | `ActiveFilter` type confirmed in `filterStore.ts:14-20`; builder must produce SQL-safe escaped output; placed in server handler or new utility module |
| VIEW-V13-07 | Supertest coverage for POST and DELETE — asserts DDL SQL string shape, view-name format, empty-filters DROP path, both AUTH_MODE variants | Test pattern established in `routes.materialize.spec.ts`; `vi.stubEnv("AUTH_MODE", ...)` pattern confirmed in `routes.wms.capabilities.spec.ts:39-42` |
</phase_requirements>

---

## Summary

Phase 13 has two sequential workstreams: (1) operator spike validation for four deployment-specific unknowns, and (2) implementation of the net-new `POST/DELETE /api/filter/materialize` endpoint with supertest coverage. The spike work must complete first because S2 (DDL permission) and S4 (schema qualification) directly shape the endpoint's implementation decisions.

The codebase is exceptionally well-prepared for this phase. The existing `kineticaSql` helper (`kinetica.ts`), `asyncHandler` wrapper, `requireConfig`/`requireAuth` middleware chain, and `errorMiddleware` all cover the exact patterns needed by the new endpoint. The reference implementation at `index.ts:613-648` (`POST /api/views/:id/materialize`) is the structural model — Phase 13's endpoint is simpler (no SQLite side effects, no try/catch in handler) but follows the same skeleton. The supertest harness (`routes.materialize.spec.ts` + `tests/helpers/app.ts` + `tests/setup.ts`) provides the exact testing infrastructure Phase 13 needs.

The only genuine unknowns are the four spikes. S2 (DDL permission) and S3 (expired-view error message) are P1 gates for endpoint behavior; S1 and S4 affect downstream phases. All four are operator-run against deployed Kinetica — Claude produces the probe commands; the operator executes them and records findings in `13-SPIKE-NOTES.md`.

**Primary recommendation:** Write Plan 13-01 as a spike-runner plan (operator tasks only, produces `13-SPIKE-NOTES.md`), then write Plan 13-02 for the endpoint + supertest in one unit (the endpoint is simple enough to be a single plan). Add Plan 13-03 (gap-closure) conditionally only if S2 fails.

---

## Standard Stack

### Core (all pre-existing — zero new npm packages)

| Library/Module | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Express 4 | existing | Route handler mounting | All routes in this project use Express |
| `kineticaSql` (`server/src/kinetica.ts`) | project module | Execute DDL against Kinetica with per-user creds | Established helper; handles auth headers, audit log, typed error classification |
| `kineticaErrors.ts` | project module | `KineticaAuthError`, `KineticaPermissionError`, `KineticaUpstreamError` | Typed error classes that `errorMiddleware` already handles |
| `requireAuth` middleware | `index.ts:420` | Guards all `/api/*` routes | Already gates the new namespace transparently |
| `requireConfig` middleware | `index.ts:197-202` | Checks `KINETICA_URL` presence before routes that call Kinetica | Same guard used on all Kinetica-touching routes |
| `asyncHandler` | `index.ts:208-214` | Wraps async route handlers; forwards errors to `next(err)` | Prevents Express 4 swallowing rejected promises |
| `errorMiddleware` | `index.ts:801-823` | Translates typed Kinetica errors to HTTP responses | Handles all typed errors; no per-route try/catch needed |
| `AuthedRequest` type | `server/src/auth.ts:26-38` | Post-`requireAuth` request shape with `req.user.creds`, `req.user.sid`, `req.user.credentialType` | Provides userId and sessionId components for view-name construction |

### Test Infrastructure (all pre-existing)

| Library/Module | Version | Purpose |
|----------------|---------|---------|
| vitest + supertest | existing | Server integration tests |
| `buildTestApp()` | `tests/helpers/app.ts` | Constructs Express app for supertest |
| `vi.stubEnv("AUTH_MODE", ...)` | vitest | Switches auth mode for tests without env var pollution |
| `vi.stubGlobal("fetch", ...)` | vitest | Intercepts Kinetica HTTP calls; asserts on DDL string shape |
| `tests/setup.ts` | project | Sets `AUTH_SECRET`, `KINETICA_URL`, `DB_PATH=:memory:` before each test |

**Installation:** No new packages needed. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure (Phase 13 additions)

```
kinetica_bi/server/
├── src/
│   ├── index.ts              # MODIFIED: add POST + DELETE /api/filter/materialize routes
│   │                         # OR: mount routes/filterMaterialize.ts here (planner's call)
│   ├── routes/
│   │   └── filterMaterialize.ts  # OPTIONAL: extracted route module (keeps index.ts lean)
│   └── lib/
│       └── whereClause.ts    # NEW: server-side WHERE builder (VIEW-V13-06)
│                             # Accepts ActiveFilter[], returns SQL-safe WHERE clause string
├── tests/
│   └── routes.filter-materialize.spec.ts  # NEW: supertest coverage (VIEW-V13-07)
.planning/phases/13-spikes-and-endpoint/
└── 13-SPIKE-NOTES.md         # NEW: operator writes after running S1-S4
```

### Pattern 1: New Route Follows Existing Materialize Skeleton

**What:** `POST /api/filter/materialize` mirrors the structure of `POST /api/views/:id/materialize` at `index.ts:613-648`, with three key differences: (1) no SQLite lookup/update, (2) no try/catch (stateless = no side effects to persist on error), (3) view name constructed server-side from request context.

**When to use:** All Kinetica-touching routes in this project.

**Example (POST handler):**
```typescript
// Source: index.ts:613-648 (reference implementation) + CONTEXT.md decisions
app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
  const { dashboardId, tableId, filters } = req.body as {
    dashboardId: number;
    tableId: number;
    filters: ActiveFilter[];
  };

  const authedReq = req as AuthedRequest;
  const userId = sanitizeForViewName(authedReq.user!.creds.username);
  const sessionShort = authedReq.user!.sid.slice(0, 8);
  const viewName = `_kbi_filt_u${userId}_d${dashboardId}_t${tableId}_s${sessionShort}`;

  const table = getTable(tableId);
  if (!table) return res.status(404).json({ error: "Table not found." });
  const tableRef = table.schema ? `${table.schema}.${table.name}` : table.name;

  const whereClause = buildServerWhereClause(filters); // VIEW-V13-06
  const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;

  await kineticaSqlHelper(authedReq, ddl, {
    route: "POST /api/filter/materialize",
    op: "MATERIALIZE",
  });

  const expiresAt = Date.now() + 5 * 60 * 1000; // 5-min sliding TTL in ms
  return res.json({ viewName, expiresAt });
}));
```

**Example (DELETE handler):**
```typescript
// Source: CONTEXT.md decisions
app.delete("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
  const { dashboardId, tableId } = req.body as { dashboardId: number; tableId: number };
  const authedReq = req as AuthedRequest;
  const userId = sanitizeForViewName(authedReq.user!.creds.username);
  const sessionShort = authedReq.user!.sid.slice(0, 8);
  const viewName = `_kbi_filt_u${userId}_d${dashboardId}_t${tableId}_s${sessionShort}`;

  await kineticaSqlHelper(authedReq, `DROP TABLE IF EXISTS ${viewName}`, {
    route: "DELETE /api/filter/materialize",
    op: "MATERIALIZE",
  });

  return res.json({ dropped: true });
}));
```

### Pattern 2: OIDC userId Sanitization

**What:** A pure function that makes any userId string safe for Kinetica identifier embedding.

**When to use:** View-name construction in both POST and DELETE handlers; must use the same sanitizer in both so names are deterministic.

```typescript
// Source: CONTEXT.md decisions + PITFALL V13-P-08
function sanitizeForViewName(username: string): string {
  // Replace any non-alphanumeric, non-underscore char with underscore
  // Truncate to 32 chars to keep total view name well under 200-char Kinetica limit
  return username.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
}
// Examples:
// "alice"                   → "alice"
// "john.doe@kinetica.com"   → "john_doe_kinetica_com" (21 chars)
// "auth0|abc123def456"      → "auth0_abc123def456" (18 chars)
```

### Pattern 3: Server-Side WHERE Clause Builder (VIEW-V13-06)

**What:** Extracted from the deleted v1.2 client-side `buildWhereClause`/`escapeKineticaStringLiteral`. Accepts `ActiveFilter[]`, returns a SQL-safe WHERE clause string. Must handle the same `ActiveFilter.dataType` values (`string`, `number`, `boolean`, `datetime`, `null`).

**When to use:** Called by the POST handler to compose the DDL.

**Critical property:** The builder must produce the same escaping semantics as the v1.2 client-side version (character escaping for strings: single quotes doubled; no user-supplied values ever interpolated without escaping). This is placed in `server/src/lib/whereClause.ts` or inline in the route module.

```typescript
// Source: filterStore.ts dead-code targets (v1.2 pattern to port server-side)
function escapeKineticaStringLiteral(val: string): string {
  return val.replace(/'/g, "''"); // double single quotes for SQL safety
}

function buildServerWhereClause(filters: ActiveFilter[]): string {
  if (filters.length === 0) return "1=1"; // fallback (shouldn't be called with empty filters)
  return filters
    .map((f) => {
      if (f.dataType === "string") {
        return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
      }
      if (f.dataType === "number") {
        return `${f.column} = ${Number(f.value)}`;
      }
      if (f.dataType === "null") {
        return `${f.column} IS NULL`;
      }
      if (f.dataType === "boolean") {
        return `${f.column} = ${Boolean(f.value)}`;
      }
      // datetime — treat as string literal
      return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
    })
    .join(" AND ");
}
```

### Pattern 4: Supertest DDL Assertion

**What:** The test asserts on the SQL string passed to `kineticaSql` via `global.fetch` mock — exactly the pattern in `routes.materialize.spec.ts:112-129`.

**When to use:** VIEW-V13-07 coverage for both POST and DELETE paths.

```typescript
// Source: routes.materialize.spec.ts:93-109 + CONTEXT.md test requirements
it("POST creates view with correct DDL string", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(successKineticaBody), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  const { cookie } = makeSessionCookie("alice");
  const agent = await buildTestApp();

  const res = await agent
    .post("/api/filter/materialize")
    .set("Cookie", cookie)
    .send({ dashboardId: 1, tableId: 1, filters: [{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }] })
    .expect(200);

  expect(res.body.viewName).toMatch(/^_kbi_filt_u\w+_d\d+_t\d+_s\w{8}$/);
  expect(res.body.expiresAt).toBeGreaterThan(Date.now());

  const [, init] = fetchMock.mock.calls[0];
  const body = JSON.parse(init.body as string);
  expect(body.statement).toMatch(/CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u\w+/);
  expect(body.statement).toContain("USING TABLE PROPERTIES (TTL = 5)");
  expect(body.statement).toContain("East Village");
});
```

### Pattern 5: AUTH_MODE Stubbing in Tests

**What:** The production `.env` has `AUTH_MODE=oidc`. Server tests that create password sessions must stub `AUTH_MODE=password` before `buildTestApp()`.

**When to use:** Every test suite for the new endpoint.

```typescript
// Source: routes.wms.capabilities.spec.ts:39-41
beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "password");
  db.exec("DELETE FROM sessions");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
```

For OIDC mode testing: create an OIDC session (token, not password) and use `vi.stubEnv("AUTH_MODE", "oidc")`.

### Pattern 6: OIDC Session for Tests

**What:** Creating an OIDC-credentialed session in supertest for VIEW-V13-07 AUTH_MODE=oidc coverage.

**When to use:** The second batch of tests in `routes.filter-materialize.spec.ts`.

```typescript
// Source: auth.ts:26-38 (AuthedRequest shape) + sessionStore.ts createSession patterns
const makeOidcSessionCookie = (username = "user.oidc@kinetica.com") => {
  const sid = createSession({
    username,
    kineticaUrl: KINETICA_URL,
    credentialType: "oidc",
    token: "fake-oidc-token",
    password: "",
  });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};
```

### Spike Plan Pattern (from Phase 11 precedent)

**What:** A spike plan consists entirely of `type: manual` tasks where the operator executes probe commands and records findings. Claude provides the exact probe commands; the operator runs them and writes `13-SPIKE-NOTES.md`.

**Probe format for S1 (WMS LAYERS=view):**
```bash
# After creating a test materialized view via S2:
curl -s -u "$KINETICA_USER:$KINETICA_PASS" \
  "$KINETICA_URL/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1\
&LAYERS=<test_view_name>\
&STYLES=raster\
&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude\
&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85\
&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  --output /tmp/wms_view_test.png && file /tmp/wms_view_test.png
```
Pass = `PNG image data` in output. Fail = XML error body or empty file.

**Probe format for S2 (DDL permission):**
```bash
curl -s -u "$KINETICA_USER:$KINETICA_PASS" \
  -X POST "$KINETICA_URL/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_spike_test AS (SELECT * FROM demo.nyctaxi WHERE 1=1) USING TABLE PROPERTIES (TTL = 5)","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
```
Pass = `"status":"OK"` in response. Fail = `"status":"ERROR"` with access-denied message.

**Probe format for S3 (expired view error):**
```bash
# Create, then immediately drop, then query:
# Step 1: Create a view with TTL=0 (immediate expiry) or wait for TTL, or manually DROP it
curl -s -u "$KINETICA_USER:$KINETICA_PASS" \
  -X POST "$KINETICA_URL/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"DROP TABLE IF EXISTS _kbi_filt_spike_test","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
# Step 2: Query the dropped view and capture the error:
curl -s -u "$KINETICA_USER:$KINETICA_PASS" \
  -X POST "$KINETICA_URL/execute/sql" \
  -H "Content-Type: application/json" \
  -d '{"statement":"SELECT * FROM _kbi_filt_spike_test LIMIT 1","offset":0,"limit":1,"encoding":"json","request_schema_str":"","data":[],"options":{}}'
# Record: HTTP status code, response body (especially body.message)
```

**Probe format for S4 (schema qualification):**
```bash
# Qualified (with user's default schema, e.g. ki_home):
curl -s -u "$KINETICA_USER:$KINETICA_PASS" \
  "$KINETICA_URL/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1\
&LAYERS=ki_home._kbi_filt_spike_test\
&STYLES=raster&X_ATTR=pickup_longitude&Y_ATTR=pickup_latitude\
&SRS=EPSG:4326&BBOX=-74.05,40.63,-73.75,40.85\
&WIDTH=256&HEIGHT=256&FORMAT=image/png" \
  --output /tmp/wms_qualified.png && file /tmp/wms_qualified.png
# Unqualified:
curl -s -u "$KINETICA_USER:$KINETICA_PASS" \
  "$KINETICA_URL/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1\
&LAYERS=_kbi_filt_spike_test\
... same params ...
```

### Anti-Patterns to Avoid

- **Optimistic view-name in client before server confirms:** View store (Phase 14) MUST only be updated after confirmed 200 from POST. Phase 13's endpoint shape enables this — it returns `{ viewName }` on success.
- **try/catch in the new route handlers:** Phase 13 routes have zero side effects (no SQLite row to update). Unlike the existing `POST /api/views/:id/materialize` which HAS a try/catch for `updateViewStatus`, Phase 13's handlers let all errors bubble through `asyncHandler` → `errorMiddleware`.
- **`DROP MATERIALIZED VIEW` syntax:** Kinetica uses `DROP TABLE IF EXISTS <name>` for all view drops. `DROP MATERIALIZED VIEW` is not valid Kinetica syntax.
- **TTL without parentheses:** The correct syntax is `USING TABLE PROPERTIES (TTL = 5)` — the parentheses around `TTL = 5` are required.
- **Per-widget materialize trigger (Phase 14 concern but must not be encoded in Phase 13):** Phase 13 endpoint is neutral — it does not know about widgets. But the response shape (`{ viewName, expiresAt }`) must support the coordinator pattern Phase 14 will implement (single coordinator per table/dashboard, not per-widget).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-request Kinetica auth + audit | Custom fetch wrapper | `kineticaSql(req, sql, { route, op })` at `kinetica.ts:136` | Already handles Basic/Bearer auth from session, audit log emission, typed error classification |
| Async error forwarding | try/catch forwarding to `next(err)` | `asyncHandler` at `index.ts:208-214` | Established pattern; avoids double-handling and swallowed rejections |
| HTTP error → typed error translation | Custom error detection | `classifyHttpError` at `kinetica.ts:93-127` | Handles 401/403/400-with-access-denied; DDL denial already classified as `KineticaPermissionError` |
| HTTP response → appropriate status | Per-route status switches | `errorMiddleware` at `index.ts:801-823` | Handles all typed errors; 403 for permission, 401 for auth, 502 for upstream |
| Auth guard on new routes | Per-route `requireAuth` application | `app.use("/api", requireAuth)` at `index.ts:420` | Already gates all `/api/*` including the new `/api/filter/*` namespace transparently |
| SQL injection prevention in WHERE builder | Ad-hoc escaping | Port the v1.2 `escapeKineticaStringLiteral` function server-side | The function already exists (in `filterStore.ts` dead code) — port, don't rewrite |

**Key insight:** The new endpoint is a thin shell around `kineticaSql`. The only novel code is view-name construction, username sanitization, and the WHERE clause builder. Everything else is assembled from existing building blocks.

---

## Common Pitfalls

### Pitfall 1: No try/catch in Phase 13 Routes (Unlike Existing Materialize)
**What goes wrong:** Developer sees the existing `POST /api/views/:id/materialize` has a try/catch at `index.ts:625-647` and copies the pattern. This causes double error handling: the catch block runs, but there are no side effects to perform (no SQLite row), so the catch is a no-op that then calls `next(err)` — identical to what `asyncHandler` would do automatically.
**Why it happens:** The try/catch exists in the existing endpoint specifically to call `updateViewStatus(id, "error", err.message)` as a side effect. Without that side effect, try/catch is unnecessary.
**How to avoid:** No try/catch in Phase 13 route bodies. `asyncHandler` + `errorMiddleware` handle everything.
**Warning signs:** If you see `try { ... } catch (err) { return next(err); }` with no SQLite call between them in the catch block.

### Pitfall 2: DDL Syntax — TTL Placement and Parentheses
**What goes wrong:** DDL issued as `... USING TABLE PROPERTIES TTL = 5` (missing parentheses) or `... WHERE ${clause} USING TABLE PROPERTIES (TTL = 5)` (WHERE clause outside the SELECT parentheses).
**Why it happens:** The existing pre-v1.0 DDL in `index.ts:623` does NOT have TTL — it's `CREATE OR REPLACE MATERIALIZED VIEW ${view.view_name} AS SELECT * FROM ${sourceTable}${whereClause}`. Copy-pasting without adding TTL is one failure mode; misplacing TTL is another.
**How to avoid:** The correct DDL structure is:
```sql
CREATE OR REPLACE MATERIALIZED VIEW <name> AS (SELECT * FROM <table> WHERE <clause>) USING TABLE PROPERTIES (TTL = 5)
```
The `WHERE` clause is INSIDE the `(SELECT ... )` wrapper. `USING TABLE PROPERTIES (TTL = 5)` is AFTER the closing paren of the SELECT.
**Warning signs:** Kinetica returns a syntax error body in the 400 response; `classifyHttpError` maps it to `KineticaUpstreamError` (502) rather than `KineticaPermissionError` (403).

### Pitfall 3: `req.user.sid` vs Session ID in Session Payload
**What goes wrong:** `req.user.sid` is the session identifier from the JWT `SessionPayload` (field `sid`), which is the session row's UUID from `sessionStore`. This is the correct value for `sessionShort`. However, the `sub` field on `req.user` is the username — don't confuse `sid` with `sub`.
**Why it happens:** `AuthedRequest.user` has shape `{ sub, sid, credentialType, creds }`. Both `sub` and `creds.username` hold the username; `sid` holds the session identifier.
**How to avoid:** Use `req.user!.sid.slice(0, 8)` for `sessionShort`. Use `req.user!.creds.username` for the userId component before sanitization.
**Warning signs:** View names in tests contain the username value where the session token should be.

### Pitfall 4: OIDC Username Contains Chars Invalid in Kinetica Identifiers (V13-P-08)
**What goes wrong:** OIDC usernames like `john.doe@kinetica.com` or `auth0|abc123` contain dots, at-signs, and pipes. These are NOT in Kinetica's valid identifier character set for the characters that matter (pipe `|` is not allowed). Interpolating them directly causes `CREATE MATERIALIZED VIEW` to fail with a Kinetica syntax/identifier error.
**How to avoid:** Always apply `sanitizeForViewName(username)` before interpolating into the view name. The sanitizer replaces every non-`[a-zA-Z0-9_]` character with `_`. Password-mode usernames (e.g., `alice`) pass through unchanged.
**Warning signs:** OIDC users get 502 responses from POST; password users succeed. Kinetica error body contains "invalid identifier" or similar.

### Pitfall 5: Test AUTH_MODE Not Stubbed Before `buildTestApp()`
**What goes wrong:** Production env has `AUTH_MODE=oidc`. Tests that create password sessions without stubbing `AUTH_MODE=password` before calling `buildTestApp()` get a boot-time session wipe (the app wipes all sessions on OIDC boot) and tests fail with 401.
**Why it happens:** `createApp()` is async and runs OIDC discovery + session wipe at boot time. The stub must be in place before `createApp()` is called.
**How to avoid:** `vi.stubEnv("AUTH_MODE", "password")` in `beforeEach`, BEFORE `buildTestApp()`. Call `vi.unstubAllEnvs()` in `afterEach`. This is the established pattern at `routes.wms.capabilities.spec.ts:39-42`.
**Warning signs:** All tests fail with 401 in OIDC mode; no tests pass when `AUTH_MODE=oidc` is the environment default.

### Pitfall 6: `DROP TABLE IF EXISTS` Called on a View That Was Never Created
**What goes wrong:** A DELETE request arrives for a view that was never materialized (e.g., user clears filters before any materialize completed). The deterministic view name is constructed correctly, but `DROP TABLE IF EXISTS` for a non-existent table/view...
**Resolution:** The `IF EXISTS` clause prevents Kinetica from returning an error when the view doesn't exist. Confirmed in STACK.md (spike S3 verifies exact behavior — but `IF EXISTS` is explicit insurance regardless).
**How to avoid:** Always use `DROP TABLE IF EXISTS`, never `DROP TABLE`. No conditional logic needed before issuing the DROP.

### Pitfall 7: Spike Output Missing Exact Error Message for S3
**What goes wrong:** The operator records "got an error" for S3 instead of the exact error message text. `isViewNotFoundError()` in Phase 15 needs the exact string to match (e.g., `"table 'ki_home._kbi_filt_...' does not exist"` vs `"object not found"`).
**How to avoid:** The S3 probe command must capture and print the FULL response body, not just the HTTP status. The `13-SPIKE-NOTES.md` S3 section must include the verbatim `body.message` value from Kinetica.
**Warning signs:** LIFE-V13-02 in Phase 15 uses a regex like `/not found|does not exist/i` that's a guess rather than derived from actual Kinetica output.

---

## Code Examples

### Exact `kineticaSql` Invocation for DDL
```typescript
// Source: kinetica.ts:136 (helper signature) + index.ts:626-630 (MATERIALIZE invocation)
await kineticaSqlHelper(req as AuthedRequest, ddl, {
  route: "POST /api/filter/materialize",
  op: "MATERIALIZE",
});
// Note: `extra` is NOT needed for DDL (no limit/offset/encoding override needed)
// Note: kineticaSqlHelper is the import alias for kineticaSql in index.ts
```

### Exact `AuthedRequest` Fields Available Post-requireAuth
```typescript
// Source: auth.ts:26-38
const authedReq = req as AuthedRequest;
const username = authedReq.user!.creds.username;  // string — always present
const sessionId = authedReq.user!.sid;             // UUID string
const credType = authedReq.user!.credentialType;  // "password" | "oidc"
// In OIDC mode: creds.password === "", creds.token === <access_token>
// In password mode: creds.token === "", creds.password === <password>
```

### Existing Materialize Endpoint DDL (Reference for v1.3 Extension)
```typescript
// Source: index.ts:622-623 (existing pre-v1.0 endpoint — does NOT have TTL)
const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${view.view_name} AS SELECT * FROM ${sourceTable}${whereClause}`;
// v1.3 adds:
// 1. Parentheses around the SELECT: AS (SELECT * FROM ... WHERE ...)
// 2. USING TABLE PROPERTIES (TTL = 5) after the closing paren
// 3. View name derived from session context, not SQLite view row
```

### `errorMiddleware` Translation Rules (No Code Field for Permission)
```typescript
// Source: index.ts:801-823
// KineticaPermissionError → 403 + { error }  ← NO code field
// KineticaAuthError       → 401 + { error, code: "REAUTH_REQUIRED" }
// KineticaUpstreamError   → 502 + { error }  ← NO code field
// This is the behavior Phase 13 routes rely on without a try/catch
```

### Successful Kinetica DDL Response Mock (for Tests)
```typescript
// Source: routes.materialize.spec.ts:48-53
const successKineticaBody = {
  status: "OK",
  message: "",
  data_type: "execute_sql_response",
  data_str: JSON.stringify({ json_encoded_response: JSON.stringify({}) }),
};
// Use in: vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(successKineticaBody), { status: 200 })))
```

### Session Creation for Supertest Password Mode
```typescript
// Source: routes.materialize.spec.ts:41-45
const makeSessionCookie = (username = "alice") => {
  const sid = createSession({ username, secret: SESSION_PASSWORD, kineticaUrl: KINETICA_URL });
  const token = jwt.sign({ sub: username, sid, v: 1 }, AUTH_SECRET, { expiresIn: "8h" });
  return { sid, cookie: `kbi_session=${token}` };
};
```

### Confirmed Kinetica DDL Syntax (from STACK.md)
```sql
-- Source: Kinetica DDL Reference 7.1 (docs.kinetica.com/7.1/sql/ddl/)
-- TTL unit: minutes (not seconds). SLIDING — resets on access.
CREATE OR REPLACE MATERIALIZED VIEW _kbi_filt_u17_d42_t9_s1aef8b3c AS
(
  SELECT * FROM demo.taxi_trips
  WHERE pickup_zone = 'East Village'
)
USING TABLE PROPERTIES (TTL = 5)

-- Drop syntax (NOT "DROP MATERIALIZED VIEW"):
-- Source: STACK.md (Kinetica uses DROP TABLE for all view drops)
DROP TABLE IF EXISTS _kbi_filt_u17_d42_t9_s1aef8b3c
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side `buildWhereClause` + `injectWhereClause` in `filterStore.ts` | Server-side WHERE builder in the new endpoint; view name returned to client | v1.3 Phase 13 | Eliminates SQL injection surface on client; WHERE clause never sent over wire |
| `POST /api/views/:id/materialize` (SQLite-backed, persisted view CRUD) | `POST /api/filter/materialize` (stateless, session-scoped, TTL-driven) | v1.3 Phase 13 | No SQLite migration needed; Kinetica TTL is sole cleanup mechanism |
| WMS `QUERY` param for filter (v1.2 — broken) | `LAYERS=<view_name>` swap (v1.3 Phase 16) | Not Phase 13 (but endpoint enables it) | Phase 13 delivers the server primitive; Phases 15/16 consume it |
| `_v: filterVersion` WMS cache-buster | `_mv: materializeVersion` (Phase 16) | Not Phase 13 | Phase 13 endpoint returns `expiresAt` which Phase 14 uses for `materializeVersion` |

**Deprecated/outdated:**
- `escapeKineticaStringLiteral`, `buildWhereClause`, `injectWhereClause`, `buildEqualityFilter` in `filterStore.ts`: scheduled for deletion in Phase 15. Phase 13 PORTS the escaping logic server-side but does NOT delete client-side yet (client still exports them; deletion is atomic with FROM-swap in Phase 15).

---

## Open Questions

1. **S3: Exact Kinetica error message for expired/dropped view**
   - What we know: `classifyHttpError` maps 400-without-access-denied to `KineticaUpstreamError`; the body message is available in `err.message`
   - What's unclear: Is it `"table 'NAME' does not exist"`, `"object not found"`, or something else entirely?
   - Recommendation: S3 spike captures the exact verbatim string; planner notes it in the plan as a "to be filled in from 13-SPIKE-NOTES.md" placeholder in the `isViewNotFoundError` pattern passed to Phase 15

2. **S4: Schema qualification requirement**
   - What we know: Unqualified view names land in the creating user's default schema; WMS LAYERS resolution uses the same auth context as SQL queries
   - What's unclear: Does WMS use the same schema resolution as SQL? If the user's schema is non-obvious (not `ki_home`), does unqualified LAYERS resolve correctly?
   - Recommendation: S4 spike tests both forms; if schema-qualification is required, the view-name generator returns `<schema>._kbi_filt_...` and the server needs a one-time `SHOW SCHEMAS` or session-level schema lookup. This would add a task to Plan 13-02 but does not block the spike plan.

3. **Route file extraction vs inline**
   - What we know: All routes are currently inline in `index.ts`; the file is long but functional
   - What's unclear: Planner's preference
   - Recommendation: Inline in `index.ts` for Phase 13 to match convention; extraction can happen in a later cleanup phase. If `index.ts` already exceeds ~900 lines, extract to `routes/filterMaterialize.ts` and `app.use("/api/filter", filterMaterializeRouter)`.

4. **DELETE via request body vs query params**
   - What we know: CONTEXT.md says "or via query params; planner picks"; supertest handles both
   - What's unclear: Express's `req.body` on DELETE is technically valid but some proxies strip it
   - Recommendation: Use query params for DELETE (`?dashboardId=1&tableId=2`) — safer with HTTP semantics and proxy compatibility. Document in the plan.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `kinetica_bi/server/src/index.ts:197-214` — `requireConfig`, `asyncHandler` definitions
- Codebase: `kinetica_bi/server/src/index.ts:420` — `app.use("/api", requireAuth)` global guard
- Codebase: `kinetica_bi/server/src/index.ts:613-648` — existing `POST /api/views/:id/materialize` reference implementation with try/catch for side effects
- Codebase: `kinetica_bi/server/src/index.ts:801-823` — `errorMiddleware` translation rules (confirmed NO code field for permission errors)
- Codebase: `kinetica_bi/server/src/kinetica.ts:30-37` — `KineticaOp` enum (`MATERIALIZE` already present), `KineticaSqlOptions` type
- Codebase: `kinetica_bi/server/src/kinetica.ts:93-127` — `classifyHttpError` (400+access-denied → `KineticaPermissionError`)
- Codebase: `kinetica_bi/server/src/kinetica.ts:136-236` — `kineticaSql` full implementation
- Codebase: `kinetica_bi/server/src/kineticaErrors.ts` — typed error class definitions (confirmed shape)
- Codebase: `kinetica_bi/server/src/auth.ts:26-38` — `AuthedRequest` type (`req.user.creds.username`, `req.user.sid`)
- Codebase: `kinetica_bi/server/tests/routes.materialize.spec.ts` — supertest DDL assertion pattern, `successKineticaBody`, session cookie creation
- Codebase: `kinetica_bi/server/tests/helpers/app.ts` — `buildTestApp()` helper
- Codebase: `kinetica_bi/server/tests/setup.ts` — test env vars, `vi.restoreAllMocks()` in `beforeEach`
- Codebase: `kinetica_bi/server/tests/routes.wms.capabilities.spec.ts:39-42` — `vi.stubEnv("AUTH_MODE", "password")` pattern
- Codebase: `kinetica_bi/src/store/filterStore.ts:14-20` — `ActiveFilter` type definition
- `.planning/research/STACK.md` — Kinetica DDL syntax (TTL=5, USING TABLE PROPERTIES, DROP TABLE IF EXISTS); naming constraints (200 chars max, underscore-prefix allowed)
- `.planning/research/ARCHITECTURE.md` — endpoint shape, stateless design rationale, test patterns
- `.planning/research/PITFALLS.md` — V13-P-01 through V13-P-19 (all Phase 13-relevant pitfalls catalogued with concrete code patterns)
- `.planning/phases/11-map-chart/11-01-wms-spike-and-cache-control-PLAN.md` — spike plan structure precedent
- `.planning/phases/11-map-chart/11-SPIKE-NOTES.md` — format model for `13-SPIKE-NOTES.md`

### Secondary (MEDIUM confidence)
- [Kinetica DDL Reference 7.1](https://docs.kinetica.com/7.1/sql/ddl/) — `CREATE OR REPLACE MATERIALIZED VIEW` syntax, `USING TABLE PROPERTIES (TTL = N)` clause
- [Kinetica TTL Concepts 7.1](https://docs.kinetica.com/7.1/concepts/ttl/) — TTL unit is minutes (not seconds); SLIDING semantics (resets on access)
- [Kinetica Table Naming 7.1](https://docs.kinetica.com/7.1/concepts/tables/) — 200-char limit; underscore prefix allowed; allowed characters

### Tertiary (LOW confidence — spike required)
- [Kinetica WMS REST API 7.1](https://docs.kinetica.com/7.1/api/rest/wms_rest/index.html) — LAYERS param "table names" only; views not explicitly mentioned as valid LAYERS values (SPIKE-V13-01 verifies)
- [Kinetica Security Concepts 7.1](https://docs.kinetica.com/7.1/security/sec_concepts/index.html) — per-user DDL permission model; whether typical BI users have CREATE rights is undocumented (SPIKE-V13-02 verifies)

---

## Metadata

**Confidence breakdown:**
- Spike methodology: HIGH — direct precedent from Phase 11; structure is clear; probe commands are derivable from known parameters
- Endpoint implementation: HIGH — all code patterns verified from existing source; DDL syntax confirmed from official docs
- WHERE clause builder: HIGH — direct port of v1.2 client-side code; no new SQL escaping logic
- Supertest coverage: HIGH — existing test infrastructure covers identical patterns; only content of assertions is new
- Spike outcomes: LOW (by definition — unknown until operator runs probes against deployed Kinetica)

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (stable domain; Kinetica DDL syntax unlikely to change in 30 days)

> Note: `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. Validation Architecture section omitted per configuration.
