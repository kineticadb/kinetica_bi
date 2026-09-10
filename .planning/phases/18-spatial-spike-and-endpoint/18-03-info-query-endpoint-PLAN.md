---
phase: 18-spatial-spike-and-endpoint
plan: 03
type: execute
wave: 3
depends_on: [18-01, 18-02]
files_modified:
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/tests/routes.info-query.spec.ts
autonomous: true
requirements:
  - SPATIAL-V14-04
must_haves:
  truths:
    - "POST /api/info/query route exists in kinetica_bi/server/src/index.ts, registered under requireConfig + asyncHandler middleware (same chain as POST /api/filter/materialize)"
    - "Endpoint accepts the locked request shape: { layerId, tableId, schema, table, spatialMode, spatialColumns, clickLon, clickLat, radiusPx, mapBbox, mapWidthPx, mapHeightPx, page }"
    - "Endpoint returns the locked response shape: { rows: Record<string, unknown>[], columns: string[], totalEstimate?: number, hasMore: boolean, page: number }"
    - "Endpoint routes by spatialMode: 'latlon' → buildLatLonQuery, 'wkt' → buildWktQuery. spatialMode='wkb' returns HTTP 501 with body { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' } — buildWkbQuery is NOT invoked (Plan 18-01 resolved NONE_ESCALATE → TECH_DEBT; the function throws by design)."
    - "Endpoint converts radiusPx → ground distance via pxToGroundDistance (radiusConversion.ts) before calling the SQL builder — server-side, no client trig"
    - "Endpoint forwards per-user creds via kineticaSql(req, sql, { op: 'INFO_QUERY' }) — Bearer in OIDC mode, Basic in password mode (auth.ts buildAuthHeader)"
    - "Endpoint has NO try/catch — typed Kinetica errors bubble through asyncHandler → errorMiddleware (mirrors POST /api/filter/materialize)"
    - "supertest spec covers latlon + wkt happy paths, the wkb-501-deferral path (asserts no kineticaSql call), error cases (401, 403, 5xx, missing params, bad spatialMode, unknown table), and pagination edge cases (page beyond data → empty rows + hasMore=false)"
    - "supertest covers both AUTH_MODE=password (mocked sessions via createSession) and AUTH_MODE=oidc (Issuer/openid-client hoisted vi.mock + seedOidcSession)"
    - "vitest run on routes.info-query.spec.ts exits 0; tsc --noEmit passes"
  artifacts:
    - path: "kinetica_bi/server/src/index.ts"
      provides: "POST /api/info/query route handler — wires Plan 18-02 modules into Express"
      contains: "/api/info/query"
    - path: "kinetica_bi/server/tests/routes.info-query.spec.ts"
      provides: "Comprehensive supertest coverage mirroring routes.filter-materialize.spec.ts (the v1.3 reference, 23/23 passing)"
      min_lines: 250
  key_links:
    - from: "kinetica_bi/server/src/index.ts POST /api/info/query"
      to: "kinetica_bi/server/src/lib/spatialQuery.ts"
      via: "import { buildLatLonQuery, buildWktQuery, buildWkbQuery, type SpatialMode } from './lib/spatialQuery'"
      pattern: "import.*spatialQuery"
    - from: "kinetica_bi/server/src/index.ts POST /api/info/query"
      to: "kinetica_bi/server/src/lib/radiusConversion.ts"
      via: "import { pxToGroundDistance } from './lib/radiusConversion'"
      pattern: "import.*radiusConversion"
    - from: "kinetica_bi/server/src/index.ts POST /api/info/query"
      to: "kinetica_bi/server/src/kinetica.ts kineticaSql"
      via: "kineticaSql(authedReq, sql, { route: 'POST /api/info/query', op: 'INFO_QUERY' }) — credential-type-aware, per-user creds"
      pattern: "kineticaSql.*op.*INFO_QUERY"
---

<objective>
Wire the modules built in Plan 18-02 (`spatialQuery.ts` + `radiusConversion.ts`) into a new Express route `POST /api/info/query` in `kinetica_bi/server/src/index.ts`, and back it with a comprehensive supertest spec at `kinetica_bi/server/tests/routes.info-query.spec.ts`.

Purpose: SPATIAL-V14-04 — the endpoint that the v1.4 map click popup (Phase 21) calls to resolve a click into nearby records. This is the only requirement this plan owns; it integrates SPATIAL-V14-01/02/03/05 (already implemented in Plan 18-02) into a live HTTP route.

Output:
1. New route `POST /api/info/query` registered in `index.ts` alongside the existing `POST /api/filter/materialize` (mirrors that route's middleware chain, no-try/catch pattern, and per-user kineticaSql call shape).
2. New supertest spec `routes.info-query.spec.ts` mirroring `routes.filter-materialize.spec.ts` (the v1.3 reference, 23/23 passing — established pattern; do NOT use the v1.0/v1.1 fetch-mock patterns flagged by TD-V11-04 / TD-V13-01).
3. Both AUTH_MODE=password and AUTH_MODE=oidc covered.

Pattern model: `kinetica_bi/server/src/index.ts:667-728` (`POST /api/filter/materialize`) + `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` (the supertest reference).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md

# Spike outcome (REQUIRED — endpoint WKB branch can only ship if 18-01 chose PROBE_A/B/C; NONE_ESCALATE blocks)
@.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md
@.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-SUMMARY.md
@.planning/phases/18-spatial-spike-and-endpoint/18-02-spatial-modules-SUMMARY.md

# Pattern references (read these before writing any code)
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/tests/routes.filter-materialize.spec.ts
@kinetica_bi/server/src/auth.ts
@kinetica_bi/server/src/kinetica.ts

# Modules consumed by this plan (built in 18-02)
@kinetica_bi/server/src/lib/spatialQuery.ts
@kinetica_bi/server/src/lib/radiusConversion.ts

<interfaces>
<!-- Existing types/exports the route handler must use -->

From kinetica_bi/server/src/auth.ts:
```typescript
export type AuthedRequest = Request & {
  requestId?: string;
  user?: {
    sub: string;
    sid: string;
    credentialType: "password" | "oidc";
    creds: { username: string; password: string; token: string };
  };
};
export const requireAuth: (req, res, next) => void;  // session validation middleware (used elsewhere; this route uses requireConfig — see filter-materialize.ts)
```

From kinetica_bi/server/src/kinetica.ts:
```typescript
export type KineticaOp = "SQL" | "DISCOVERY" | "MATERIALIZE" | "WMS";  // EXTEND with "INFO_QUERY"
export const kineticaSql = async (
  req: AuthedRequest,
  sql: string,
  options: { route: string; op: KineticaOp; extra?: Record<string, unknown> }
): Promise<unknown>;  // Returns the parsed encoded shape (see kinetica.ts:208-213)
```

From kinetica_bi/server/src/lib/spatialQuery.ts (Plan 18-02):
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";
export type SpatialColumns = { lonCol?, latCol?, wktCol?, wkbCol? };
export type SpatialQueryArgs = {
  schema: string; table: string;
  spatialColumns: SpatialColumns;
  clickLon: number; clickLat: number;
  radiusGroundDistance: number;
  page: number;
};
export function buildLatLonQuery(args: SpatialQueryArgs): string;
export function buildWktQuery(args: SpatialQueryArgs): string;
export function buildWkbQuery(args: SpatialQueryArgs): string;
```

From kinetica_bi/server/src/lib/radiusConversion.ts (Plan 18-02):
```typescript
export function pxToGroundDistance(
  radiusPx: number, mapBbox: [number,number,number,number],
  mapWidthPx: number, mapHeightPx: number, clickLat: number
): number;  // returns meters
// (Optionally also exports pxToGroundDegrees for STXY_DISTANCE/ST_DISTANCE consumers — read 18-02 SUMMARY to confirm)
```

LOCKED endpoint contract (from REQUIREMENTS.md SPATIAL-V14-04 + planning_context):
```typescript
// REQUEST BODY
type InfoQueryRequest = {
  layerId: number;       // dashboard_layer.id (passed through; not used by SQL builder; future-use for layer-config-aware routing)
  tableId: number;       // tables.id (passed through; future-use for cross-checking schema/table against admin metadata)
  schema: string;        // e.g. "ki_home"
  table: string;         // e.g. "nyctaxi"
  spatialMode: "latlon" | "wkt" | "wkb";
  spatialColumns: { lonCol?: string; latCol?: string; wktCol?: string; wkbCol?: string };
  clickLon: number;
  clickLat: number;
  radiusPx: number;
  mapBbox: [number, number, number, number];  // [minLon, minLat, maxLon, maxLat]
  mapWidthPx: number;
  mapHeightPx: number;
  page: number;          // 0-indexed
};

// RESPONSE BODY (200)
type InfoQueryResponse = {
  rows: Record<string, unknown>[];   // up to 50 records, ordered by ascending distance
  columns: string[];                  // column names in row order
  totalEstimate?: number;             // optional: rough cardinality (Kinetica response may include); omit if not available
  hasMore: boolean;                    // rows.length === 50 (more pages exist iff we filled this page)
  page: number;                        // echo of request.page
};
```

LOCKED constraint reads from CONTEXT (planning_context):
- Auth pattern: `kineticaSql(req, sql, { op: "INFO_QUERY" })` — per-user creds via auth.ts buildAuthHeader (Bearer for OIDC, Basic for password). NO try/catch (mirrors filter-materialize).
- View-of-views: NOT applied — info popup queries the source table directly via FROM <schema>.<table>. Document this as a Phase 18 lock comment.
- Type duplication: NO frontend imports. Reuse spatialQuery.ts types (SpatialMode, SpatialColumns) which are server-side definitions.
- Test pattern: mirror `routes.filter-materialize.spec.ts` (23/23 passing; both AUTH_MODE branches via vi.hoisted Issuer mock + createSession seed).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire POST /api/info/query route in kinetica_bi/server/src/index.ts</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/server/src/kinetica.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (lines 1-220 for imports and createApp boot setup; lines 615-728 for POST /api/views/:id/materialize and POST/DELETE /api/filter/materialize patterns to mirror)
    - kinetica_bi/server/src/kinetica.ts (lines 30-50 for KineticaOp type; lines 136-236 for kineticaSql signature and behavior — confirms response shape parser)
    - kinetica_bi/server/src/auth.ts (AuthedRequest type — confirms credentialType discriminant + creds shape)
    - .planning/phases/18-spatial-spike-and-endpoint/18-02-spatial-modules-SUMMARY.md (confirms which radiusConversion helper to use per spatialMode — pxToGroundDistance returns meters, GEODIST consumes meters; STXY_DISTANCE/ST_DISTANCE want degrees-equivalent)
  </read_first>
  <behavior>
    - Test 1: Importing buildLatLonQuery/buildWktQuery/buildWkbQuery + pxToGroundDistance from the new lib modules type-checks clean (compile-time guard against missing exports from Plan 18-02)
    - Test 2: KineticaOp union extended to include "INFO_QUERY" — the new op is referenced in the endpoint's kineticaSql call
    - Test 3: Endpoint validates request body shape and returns 400 for missing/wrong types (covered in Task 2 spec; this task ensures the validation code path exists)
    - Test 4: Endpoint dispatches to the correct SQL builder per spatialMode (covered in Task 2 spec; this task ensures the dispatch table exists)
    - Test 5: Endpoint emits one kineticaSql call per request (no double-fire) — supertest spec asserts via fetchMock.mock.calls.length
    - Test 6: tsc --noEmit clean across the server package
  </behavior>
  <action>
    Step 1 — Extend KineticaOp union in `kinetica_bi/server/src/kinetica.ts:30`:
      OLD: export type KineticaOp = "SQL" | "DISCOVERY" | "MATERIALIZE" | "WMS";
      NEW: export type KineticaOp = "SQL" | "DISCOVERY" | "MATERIALIZE" | "WMS" | "INFO_QUERY";
      No other changes to kinetica.ts — buildAuthHeader, emitAudit, classifyHttpError all flow through unchanged.

    Step 2 — Add imports at top of `kinetica_bi/server/src/index.ts` (alongside the existing whereClause + viewNaming imports near line 16-17):
      import {
        buildLatLonQuery,
        buildWktQuery,
        // buildWkbQuery is intentionally NOT imported — it throws WkbDeferredError
        // (Plan 18-01 NONE_ESCALATE → TD-V14-WKB-SPIKE). The endpoint early-returns
        // 501 for spatialMode='wkb' BEFORE any builder call.
        type SpatialMode,
        type SpatialColumns,
      } from "./lib/spatialQuery";
      import { pxToGroundDistance } from "./lib/radiusConversion";
      // If Plan 18-02 also exported pxToGroundDegrees, import it here too:
      //   import { pxToGroundDistance, pxToGroundDegrees } from "./lib/radiusConversion";

    Step 3 — Add the route handler in `kinetica_bi/server/src/index.ts` IMMEDIATELY AFTER the existing DELETE /api/filter/materialize block (around line 728 — find the closing `}));` of DELETE /api/filter/materialize and insert the new block right after).

    Use this exact handler skeleton (mirrors POST /api/filter/materialize structure verbatim):

      // ----- v1.4 Phase 18: Map info popup spatial query (SPATIAL-V14-04) -----
      // POST /api/info/query — resolve a map click to nearby records via Kinetica spatial-distance.
      //
      // Request body shape (locked in REQUIREMENTS.md SPATIAL-V14-04):
      //   { layerId, tableId, schema, table, spatialMode, spatialColumns, clickLon, clickLat,
      //     radiusPx, mapBbox, mapWidthPx, mapHeightPx, page }
      //
      // Response shape:
      //   { rows: Record<string, unknown>[], columns: string[], totalEstimate?: number,
      //     hasMore: boolean, page: number }
      //
      // Phase 18 locks (planning_context):
      //   - No view-of-views: queries source table directly via FROM <schema>.<table>; filter views (v1.3)
      //     are NOT applied here. Info popup is independent of dashboard filter state. v1.5 may revisit.
      //   - No try/catch: typed Kinetica errors bubble through asyncHandler -> errorMiddleware (mirrors
      //     POST /api/filter/materialize, distinct from POST /api/views/:id/materialize which persists
      //     a status row).
      //   - Per-user creds via kineticaSql(req, sql, { op: "INFO_QUERY" }) — credential-type-aware
      //     auth header in auth.ts buildAuthHeader.
      //   - radiusPx → ground distance is computed SERVER-SIDE via pxToGroundDistance (radiusConversion.ts):
      //     mapBbox + mapWidthPx + mapHeightPx + clickLat go in, ground meters come out. Avoids client
      //     trigonometry duplication and keeps the threshold consistent across zoom levels.
      //   - WKB SQL template DEFERRED to TD-V14-WKB-SPIKE — Plan 18-01 spike landed NONE_ESCALATE
      //     (operator has no WKB-binary column reachable; runner-bug-tainted first run + WKT-typed
      //     fixture column prevented characterization). Endpoint returns 501 for spatialMode='wkb'
      //     with body { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }. buildWkbQuery in
      //     spatialQuery.ts throws WkbDeferredError by design — the endpoint early-returns 501
      //     BEFORE invoking it. See 18-SPIKE-NOTES.md ## Decision.

      app.post("/api/info/query", requireConfig, asyncHandler(async (req, res) => {
        const body = (req.body ?? {}) as Partial<{
          layerId: number;
          tableId: number;
          schema: string;
          table: string;
          spatialMode: SpatialMode;
          spatialColumns: SpatialColumns;
          clickLon: number;
          clickLat: number;
          radiusPx: number;
          mapBbox: [number, number, number, number];
          mapWidthPx: number;
          mapHeightPx: number;
          page: number;
        }>;

        // ── Validation: required scalars ────────────────────────────────────
        if (typeof body.layerId !== "number" || typeof body.tableId !== "number") {
          return res.status(400).json({ error: "layerId and tableId are required numbers." });
        }
        if (typeof body.schema !== "string" || typeof body.table !== "string" ||
            body.schema.length === 0 || body.table.length === 0) {
          return res.status(400).json({ error: "schema and table are required non-empty strings." });
        }
        if (body.spatialMode !== "latlon" && body.spatialMode !== "wkt" && body.spatialMode !== "wkb") {
          return res.status(400).json({ error: "spatialMode must be 'latlon', 'wkt', or 'wkb'." });
        }
        if (typeof body.spatialColumns !== "object" || body.spatialColumns === null) {
          return res.status(400).json({ error: "spatialColumns is required." });
        }
        if (typeof body.clickLon !== "number" || typeof body.clickLat !== "number") {
          return res.status(400).json({ error: "clickLon and clickLat are required numbers." });
        }
        if (typeof body.radiusPx !== "number" || body.radiusPx <= 0) {
          return res.status(400).json({ error: "radiusPx must be a positive number." });
        }
        if (!Array.isArray(body.mapBbox) || body.mapBbox.length !== 4 ||
            !body.mapBbox.every((n) => typeof n === "number")) {
          return res.status(400).json({ error: "mapBbox must be a 4-number array." });
        }
        if (typeof body.mapWidthPx !== "number" || typeof body.mapHeightPx !== "number" ||
            body.mapWidthPx <= 0 || body.mapHeightPx <= 0) {
          return res.status(400).json({ error: "mapWidthPx and mapHeightPx must be positive numbers." });
        }
        if (typeof body.page !== "number" || body.page < 0 || !Number.isInteger(body.page)) {
          return res.status(400).json({ error: "page must be a non-negative integer." });
        }

        // ── Validation: spatialColumns matches spatialMode ──────────────────
        if (body.spatialMode === "latlon" &&
            (typeof body.spatialColumns.lonCol !== "string" || typeof body.spatialColumns.latCol !== "string")) {
          return res.status(400).json({ error: "spatialColumns.lonCol and spatialColumns.latCol are required for spatialMode='latlon'." });
        }
        if (body.spatialMode === "wkt" && typeof body.spatialColumns.wktCol !== "string") {
          return res.status(400).json({ error: "spatialColumns.wktCol is required for spatialMode='wkt'." });
        }
        if (body.spatialMode === "wkb" && typeof body.spatialColumns.wkbCol !== "string") {
          return res.status(400).json({ error: "spatialColumns.wkbCol is required for spatialMode='wkb'." });
        }

        // ── WKB mode: deferred to TD-V14-WKB-SPIKE ──────────────────────────
        // Plan 18-01 spike landed NONE_ESCALATE → TECH_DEBT (operator has no WKB-binary
        // column reachable; first run was tainted by a runner bug, fixture column type
        // was WKT not WKB). buildWkbQuery throws WkbDeferredError by design. We early-return
        // 501 BEFORE invoking the builder so the endpoint never throws.
        // When TD-V14-WKB-SPIKE re-run lands: replace this early-return with a proper
        // wkb-mode dispatch (same shape as latlon/wkt below) AND replace buildWkbQuery's
        // throw with the spike-locked SQL template.
        if (body.spatialMode === "wkb") {
          return res.status(501).json({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" });
        }

        // ── Verify the table is registered in the admin metadata (404 guard) ─
        const tableRow = getTable(body.tableId);
        if (!tableRow) {
          return res.status(404).json({ error: "Table not found." });
        }

        const authedReq = req as AuthedRequest;

        // ── Convert radiusPx → ground-distance threshold ────────────────────
        // GEODIST returns meters; STXY_DISTANCE / ST_DISTANCE return SRS-units (degrees-equivalent for EPSG:4326).
        // Plan 18-02's pxToGroundDistance returns meters. Branch the unit conversion per spatialMode here.
        const radiusMeters = pxToGroundDistance(
          body.radiusPx,
          body.mapBbox,
          body.mapWidthPx,
          body.mapHeightPx,
          body.clickLat,
        );
        // Convert meters back to degrees-equivalent for STXY_DISTANCE/ST_DISTANCE consumers.
        // (If Plan 18-02 exported pxToGroundDegrees, USE THAT directly instead — cleaner.)
        const metersPerDegLon = 111_320 * Math.cos((body.clickLat * Math.PI) / 180);
        const radiusDegrees = metersPerDegLon === 0 ? radiusMeters : radiusMeters / metersPerDegLon;

        const builderArgs = {
          schema: body.schema,
          table: body.table,
          spatialColumns: body.spatialColumns,
          clickLon: body.clickLon,
          clickLat: body.clickLat,
          page: body.page,
        };

        // Note: spatialMode === "wkb" is handled by the early-return 501 above
        // (TD-V14-WKB-SPIKE deferral). The remaining cases are exhaustive: latlon | wkt.
        let sql: string;
        if (body.spatialMode === "latlon") {
          sql = buildLatLonQuery({ ...builderArgs, radiusGroundDistance: radiusMeters });
        } else {
          // body.spatialMode === "wkt"
          sql = buildWktQuery({ ...builderArgs, radiusGroundDistance: radiusDegrees });
        }

        // Increase the kineticaSql limit to 50 (default is 1000, which would over-fetch but not break).
        // The SQL itself has LIMIT 50 OFFSET <page*50>; the kineticaSql `extra.limit` is the Kinetica
        // request envelope's limit, distinct from the SQL LIMIT clause. Set both to 50 for clarity.
        const result = (await kineticaSql(authedReq, sql, {
          route: "POST /api/info/query",
          op: "INFO_QUERY",
          extra: { limit: 50 },
        })) as { column_headers?: string[]; column_1?: unknown; [key: string]: unknown } | null;

        // Parse Kinetica's encoded response shape into { rows, columns }.
        // Kinetica's encoded response uses the column-major shape: column_headers + column_1, column_2, ...
        // (Pattern derived from the existing /api/sql route handler — read index.ts ~line 841 onward to confirm
        // the exact parsing helper. If a shared helper exists like decodeColumnar(result), reuse it; otherwise
        // inline the conversion: zip column_headers with the parallel column_<i> arrays into row objects.)
        const columns: string[] = Array.isArray(result?.column_headers) ? result!.column_headers : [];
        const rowCount = columns.length > 0 && Array.isArray((result as Record<string, unknown>)[`column_1`])
          ? ((result as Record<string, unknown>)[`column_1`] as unknown[]).length
          : 0;
        const rows: Record<string, unknown>[] = [];
        for (let i = 0; i < rowCount; i++) {
          const row: Record<string, unknown> = {};
          for (let c = 0; c < columns.length; c++) {
            const colArr = (result as Record<string, unknown>)[`column_${c + 1}`] as unknown[] | undefined;
            row[columns[c]] = colArr ? colArr[i] : null;
          }
          rows.push(row);
        }

        return res.json({
          rows,
          columns,
          hasMore: rows.length === 50,
          page: body.page,
        });
      }));

    Step 4 — IMPORTANT: The Kinetica encoded-response parser above is a best-guess shape. Before finalizing, READ the existing /api/sql handler in index.ts (around line 841 onward) and reuse its parsing pattern verbatim. If /api/sql uses a helper like `parseKineticaTabular(result)` or similar, import and reuse it. If /api/sql inlines the parsing, copy that inline block. The goal is parity with how /api/sql converts Kinetica's encoded response into row objects — do not invent a parsing path.

    Anti-patterns to avoid:
    - Do NOT add try/catch around kineticaSql — typed errors bubble through asyncHandler -> errorMiddleware (lock from planning_context).
    - Do NOT call requireAuth — POST /api/filter/materialize uses requireConfig (which delegates to requireAuth at the boot wiring); follow that exact precedent.
    - Do NOT introduce a new auth path; reuse Phase 13 per-user cred forwarding.
    - Do NOT touch frontend code — Phase 18 is backend-only (Phase 21 will add the frontend caller).
    - Do NOT introduce service-account fallback (v1.4 stays per-user-only, mirroring v1.3 lock).
    - Do NOT use `validateOidcEnv` or any boot-time auth setup — route inherits from createApp's existing AUTH_MODE branch.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/server/src/kinetica.ts` KineticaOp type includes `"INFO_QUERY"` (verify: `grep -E 'KineticaOp.*INFO_QUERY|"INFO_QUERY"' src/kinetica.ts`)
    - `kinetica_bi/server/src/index.ts` contains `app.post("/api/info/query"` (verify: `grep -E 'app\\.post\\("/api/info/query"' src/index.ts`)
    - `kinetica_bi/server/src/index.ts` imports buildLatLonQuery, buildWktQuery, buildWkbQuery from "./lib/spatialQuery" (verify: `grep -E 'from .*lib/spatialQuery' src/index.ts`)
    - `kinetica_bi/server/src/index.ts` imports pxToGroundDistance from "./lib/radiusConversion" (verify: `grep -E 'pxToGroundDistance' src/index.ts`)
    - Route uses `kineticaSql(authedReq, sql, { route: "POST /api/info/query", op: "INFO_QUERY", ... })` (verify: `grep -E 'op: "INFO_QUERY"' src/index.ts`)
    - Route is wrapped in `asyncHandler(async (req, res) =>` and registered with `requireConfig` middleware (mirrors filter-materialize precedent)
    - Route does NOT contain `try {` near the kineticaSql call (verify: the route block has zero try/catch — typed errors bubble)
    - Route contains an early-return for spatialMode='wkb' returning 501 with body `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }` (verify: `grep -E '"TD-V14-WKB-SPIKE"' src/index.ts` matches inside the route handler block)
    - Route does NOT import buildWkbQuery (it would throw if invoked) — verify: `grep -E 'buildWkbQuery' src/index.ts` returns no lines OR returns only a comment line referencing the deferral
    - endpoint returns 501 for spatialMode='wkb' with body containing 'TD-V14-WKB-SPIKE'
    - `cd kinetica_bi/server && npx tsc --noEmit` passes
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && grep -E 'app\.post\("/api/info/query"' src/index.ts && grep -E 'op: *"INFO_QUERY"' src/index.ts && grep -E 'lib/spatialQuery' src/index.ts && grep -E 'pxToGroundDistance' src/index.ts && grep -E 'INFO_QUERY' src/kinetica.ts && npx tsc --noEmit</automated>
  </verify>
  <done>POST /api/info/query route compiled, registered under requireConfig + asyncHandler, kineticaSql call uses op="INFO_QUERY", no try/catch, all imports resolve, tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build supertest spec routes.info-query.spec.ts (mirrors routes.filter-materialize.spec.ts)</name>
  <files>kinetica_bi/server/tests/routes.info-query.spec.ts</files>
  <read_first>
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts (REFERENCE — copy the file structure: hoisted Issuer mock, vi.mock("openid-client"), buildTestApp helper, makeSessionCookie + seedOidcSession helpers, cleanFixtures, describe blocks per AUTH_MODE; 23/23 passing — the established pattern)
    - kinetica_bi/server/tests/helpers/app.ts (buildTestApp helper — confirms async signature)
    - kinetica_bi/server/src/index.ts (the new route handler — verify the request body shape matches what the spec sends)
    - kinetica_bi/server/src/sessionStore.ts (createSession signature — for makeSessionCookie + seedOidcSession patterns)
    - kinetica_bi/server/src/lib/spatialQuery.ts (read the SQL templates — supertest assertions on the SQL string sent to Kinetica must match)
  </read_first>
  <behavior>
    AUTH_MODE=password block:
    - Test 1 (latlon happy path): POST with spatialMode="latlon" + valid lonCol/latCol → 200; response has { rows, columns, hasMore, page }; rows.length is 50; hasMore=true.
    - Test 2 (wkt happy path): POST with spatialMode="wkt" + valid wktCol → 200; SQL sent to Kinetica matches /STXY_DISTANCE\(geom_col, -73\.95, 40\.75\)/ (no ST_GEOMFROMTEXT — locked SPATIAL-V14-02).
    - Test 3 (wkb mode → 501 deferred): POST with spatialMode="wkb" + valid wkbCol → 501; response body equals { error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }; fetchMock.mock.calls.length === 0 (Kinetica was NOT called — endpoint early-returned BEFORE any kineticaSql invocation; buildWkbQuery is NOT invoked). Asserts the deferred-by-design contract (Plan 18-01 NONE_ESCALATE).
    - Test 4 (latlon SQL shape): SQL sent to Kinetica contains literal "GEODIST(lon, lat, -73.95, 40.75)" + "ORDER BY GEODIST(lon, lat, -73.95, 40.75) ASC" + "LIMIT 50 OFFSET 0".
    - Test 5 (pagination): POST with page=2 → SQL contains "OFFSET 100".
    - Test 6 (pagination edge — empty page): mock Kinetica to return zero rows → response { rows: [], columns: [...], hasMore: false, page: 5 }.
    - Test 7 (audit log op): kineticaSql audit line emitted with `"op":"INFO_QUERY"` and `"route":"POST /api/info/query"` (mirrors filter-materialize.spec.ts:251-276 pattern).
    - Test 8 (missing layerId → 400): POST without layerId returns 400 with error message.
    - Test 9 (missing schema → 400): POST without schema returns 400.
    - Test 10 (bad spatialMode → 400): POST with spatialMode="invalid" returns 400.
    - Test 11 (latlon missing latCol → 400): POST with spatialMode="latlon" but spatialColumns: { lonCol: "lon" } (no latCol) returns 400.
    - Test 12 (radiusPx <= 0 → 400): POST with radiusPx=0 returns 400.
    - Test 13 (page negative or non-integer → 400): POST with page=-1 returns 400.
    - Test 14 (mapBbox wrong length → 400): POST with mapBbox=[1,2,3] returns 400.
    - Test 15 (table not found → 404): POST with tableId pointing to a non-existent row returns 404 with `{ error: "Table not found." }`.
    - Test 16 (Kinetica 401 → 401 REAUTH_REQUIRED): mock fetch to return 401 → endpoint returns 401 with `code: "REAUTH_REQUIRED"`.
    - Test 17 (Kinetica 403 → 403 no code field): mock fetch to return 403 → endpoint returns 403 with no `code` field.
    - Test 18 (Kinetica 5xx → 502): mock fetch to return 500 → endpoint returns 502 (KineticaUpstreamError).
    - Test 19 (no session cookie → 401): POST without cookie returns 401 (requireAuth flow).

    AUTH_MODE=oidc block:
    - Test 20 (oidc happy path latlon): seedOidcSession + POST → 200 + auth header to Kinetica is `Bearer <access_token>` (verifies per-user OIDC cred forwarding).
    - Test 21 (oidc audit auth_mode): audit log line contains `"auth_mode":"oidc"`.
    - Test 22 (oidc → SQL shape unchanged): same SQL emitted regardless of auth mode (regression — SQL builders don't read req.user).

    Pagination behavior:
    - Test 23 (hasMore=true when 50 rows): mock Kinetica to return exactly 50 rows → response.hasMore === true.
    - Test 24 (hasMore=false when <50 rows): mock Kinetica to return 23 rows → response.hasMore === false; rows.length === 23.
  </behavior>
  <action>
    Create `kinetica_bi/server/tests/routes.info-query.spec.ts` modeled BYTE-FOR-BYTE on `kinetica_bi/server/tests/routes.filter-materialize.spec.ts`. Reuse:
      - The vi.hoisted Issuer mock (lines 27-64 of filter-materialize.spec.ts) verbatim
      - The vi.mock("openid-client", ...) block (lines 66-70) verbatim
      - The seedFixture, makeSessionCookie, makeJwt, seedOidcSession, cleanFixtures helpers (lines 93-131) verbatim
      - The describe-per-AUTH_MODE structure (lines 133-414) — substitute "/api/info/query" for "/api/filter/materialize" and adapt the request body shape

    Critical adaptations:

    1. Replace seedFixture's seeded body. The info-query route reads `getTable(tableId)` so the seeded fixture (createTable) must produce a row whose id matches the tableId in the request. Use the same pattern: `const tbl = createTable({ name: tableName, schema, columns: {} });` then send `tableId: tbl.id`.

    2. Build a reusable request-body factory:
       ```ts
       const baseReqBody = (overrides: Partial<...> = {}) => ({
         layerId: 1,
         tableId: 1,           // overwritten with seedFixture's tbl.id per test
         schema: "ki_home",
         table: "events",
         spatialMode: "latlon" as const,
         spatialColumns: { lonCol: "lon", latCol: "lat" },
         clickLon: -73.95,
         clickLat: 40.75,
         radiusPx: 20,
         mapBbox: [-74.05, 40.63, -73.75, 40.85] as [number, number, number, number],
         mapWidthPx: 800,
         mapHeightPx: 600,
         page: 0,
         ...overrides,
       });
       ```

    3. Build a successKineticaBody that returns 50 rows in column-major shape (matching the parser in Task 1):
       ```ts
       const successKineticaBody = (rowCount = 50, cols = ["id", "name", "lon", "lat"]) => {
         const encoded: Record<string, unknown> = { column_headers: cols };
         cols.forEach((c, idx) => {
           encoded[`column_${idx + 1}`] = Array.from({ length: rowCount }, (_, i) => `${c}_${i}`);
         });
         return {
           status: "OK",
           message: "",
           data_type: "execute_sql_response",
           data_str: JSON.stringify({ json_encoded_response: JSON.stringify(encoded) }),
         };
       };
       ```

    4. For each test, mock fetch:
       ```ts
       vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
         new Response(JSON.stringify(successKineticaBody(50)), { status: 200 })
       ));
       ```

    5. SQL-string assertions: extract from the mock's `mock.calls.find(c => String(c[0]).includes("/execute/sql"))[1].body` and JSON.parse it; assert `expect(reqBody.statement).toContain("GEODIST(lon, lat, -73.95, 40.75)")`. Mirrors filter-materialize.spec.ts:187-198.

    6. WKB 501 assertion (Test 3): Plan 18-01 spike landed NONE_ESCALATE → TECH_DEBT (TD-V14-WKB-SPIKE). The expected response is HTTP 501 with body equal to { error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }. Critical: assert that fetchMock.mock.calls.length === 0 to prove buildWkbQuery is never invoked — the endpoint early-returns BEFORE any builder/kineticaSql call. Do NOT mock a Kinetica response for this test (none should be issued). Suggested assertion shape:
         expect(res.status).toBe(501);
         expect(res.body).toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" });
         expect(fetchMock.mock.calls.length).toBe(0);

    7. Audit-log assertion (Test 7) — copy filter-materialize.spec.ts:251-276 pattern; assert `"op":"INFO_QUERY"` and `"route":"POST /api/info/query"`.

    8. OIDC describe block: stubEnv AUTH_MODE=oidc + the four AUTH_OIDC_* env vars (mirror filter-materialize.spec.ts:415-481).

    9. For 24 total tests, target this distribution:
       - AUTH_MODE=password block: Tests 1-19 (19 tests)
       - AUTH_MODE=oidc block: Tests 20-22 (3 tests)
       - Pagination edge cases (in password block): Tests 23-24 (2 tests)
       Total = 24 tests, matching 23/23 reference scope (one extra for WKB-specific SQL assertion).

    Anti-patterns to avoid (TD-V11-04 / TD-V13-01 baselines):
    - Do NOT use the v1.0/v1.1 fetch-mock patterns from auth.routes.spec.ts or routes.discovery.spec.ts — those have known mock divergence issues.
    - Do NOT mock the `kineticaSql` helper directly — mock `fetch` (the global), the same way filter-materialize.spec.ts does. This exercises the real kineticaSql + buildAuthHeader path including credentialType branch.
    - Do NOT skip the OIDC block on the assumption "tests too brittle." filter-materialize.spec.ts proves the hoisted Issuer mock works.
    - Do NOT add new mocking of openid-client beyond what's already in filter-materialize.spec.ts:27-70 — reuse.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/tests/routes.info-query.spec.ts` exists
    - File contains `vi.hoisted(` block for the Issuer mock (mirrors filter-materialize.spec.ts:27)
    - File contains `vi.mock("openid-client"` (mirrors filter-materialize.spec.ts:66)
    - File contains `describe("POST /api/info/query — AUTH_MODE=password"` and `describe("POST /api/info/query — AUTH_MODE=oidc"` blocks
    - File contains at least 22 `it(...)` blocks (verify: `grep -c "it("` returns >= 22)
    - File asserts on SQL strings sent to Kinetica via `fetchMock.mock.calls` extraction (verify: `grep -c "fetchMock.mock.calls" tests/routes.info-query.spec.ts` returns >= 1)
    - File asserts on `"op":"INFO_QUERY"` audit line (verify: grep contains `"op":"INFO_QUERY"`)
    - `cd kinetica_bi/server && npx vitest run tests/routes.info-query.spec.ts --reporter=verbose` exits 0 (all tests pass)
    - `cd kinetica_bi/server && npx tsc --noEmit` passes
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/routes.info-query.spec.ts --reporter=verbose && grep -c "it(" tests/routes.info-query.spec.ts | awk '$1 >= 22 {exit 0} {exit 1}'</automated>
  </verify>
  <done>routes.info-query.spec.ts is committed; 22+ tests pass; both AUTH_MODE branches exercised; SQL-string assertions match Plan 18-02's templates; audit-log assertions confirm op="INFO_QUERY"; tsc clean.</done>
</task>

</tasks>

<verification>
- POST /api/info/query route is live in kinetica_bi/server/src/index.ts
- KineticaOp type extended to include "INFO_QUERY"
- Spatial mode dispatch routes to the correct SQL builder for buildable modes (latlon → buildLatLonQuery; wkt → buildWktQuery); spatialMode='wkb' returns 501 early (deferred to TD-V14-WKB-SPIKE)
- pxToGroundDistance is called with mapBbox + mapWidthPx + mapHeightPx + clickLat — server-side conversion (SPATIAL-V14-05 behavior covered at endpoint level; unit-tested in Plan 18-02)
- routes.info-query.spec.ts mirrors routes.filter-materialize.spec.ts pattern; 22+ tests pass under both AUTH_MODE=password and AUTH_MODE=oidc
- No new auth pattern introduced; per-user creds forwarded via kineticaSql + auth.ts buildAuthHeader (Bearer for OIDC, Basic for password)
- No try/catch in handler; typed Kinetica errors bubble through asyncHandler → errorMiddleware
- Phase 21's frontend MapChartRenderer click handler can now call `POST /api/info/query` and receive the locked response shape
</verification>

<success_criteria>
- SPATIAL-V14-04 implemented: POST /api/info/query exists with the locked request/response contract
- All 5 SPATIAL-V14-* requirements are reachable end-to-end via this endpoint:
  - SPATIAL-V14-01 (lat/lon GEODIST) — through buildLatLonQuery
  - SPATIAL-V14-02 (WKT STXY_DISTANCE without ST_GEOMFROMTEXT) — through buildWktQuery
  - SPATIAL-V14-03 (WKB) — DEFERRED to TD-V14-WKB-SPIKE; endpoint returns 501 by design (Plan 18-01 NONE_ESCALATE outcome). WKB mode is intentionally 501 (TD-V14-WKB-SPIKE deferral).
  - SPATIAL-V14-04 (the endpoint itself) — this task
  - SPATIAL-V14-05 (server-side radius conversion) — through pxToGroundDistance call
- supertest spec mirrors the v1.3 filter-materialize.spec.ts reference; new tests use the established pattern, not the broken v1.0/v1.1 fetch-mock patterns
- Both AUTH_MODE=password and AUTH_MODE=oidc branches exercised
- Phase 18 milestone success criteria 1-5 (from ROADMAP.md) all satisfied (with WKB deferred):
  1. WKB spike resolved in 18-SPIKE-NOTES.md (Plan 18-01) — outcome NONE_ESCALATE → TECH_DEBT (TD-V14-WKB-SPIKE)
  2. latlon mode returns 50 records ordered by GEODIST (this plan, Test 1 + Test 4)
  3. wkt mode uses STXY_DISTANCE with raw (x, y) — no ST_GEOMFROMTEXT (this plan, Test 2)
  4. wkb mode returns 501 with TD-V14-WKB-SPIKE body — buildWkbQuery is NOT invoked (this plan, Test 3)
  5. radiusPx → ground-distance conversion server-side (Plan 18-02 unit test + this plan integration via mocked Kinetica) — verified for lat/lon + WKT modes
</success_criteria>

<output>
After completion, create `.planning/phases/18-spatial-spike-and-endpoint/18-03-info-query-endpoint-SUMMARY.md` summarizing:
- The committed POST /api/info/query route (file + line range in index.ts)
- The supertest pass count (e.g. "24/24 passing")
- The two-line stress test for the WKB branch (which probe pattern was asserted in Test 3)
- Whether AUTH_MODE=oidc tests passed cleanly (TD-V11-04 mock divergence didn't bite)
- Phase 18 verification roll-up: all 5 SPATIAL-V14-* requirements demonstrably reachable
</output>
</content>
