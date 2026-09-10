# Phase 26: server-spatial-where — Research

**Researched:** 2026-05-12
**Domain:** Server-side WHERE-clause composition + supertest coverage (TypeScript / Express / Vitest)
**Confidence:** HIGH — all findings drawn from source files on disk

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- New module: `kinetica_bi/server/src/lib/spatialWhereClause.ts` — pure, zero non-stdlib imports
- Exports: `buildSpatialOrBlock(shapes, target): string`, `composeWhereClause(filters, shapes, target): string`, types `SpatialFilter` / `SpatialTarget` / `SpatialMode`, class `SpatialFilterWkbDeferredError`
- Predicate templates verbatim from Phase 25 SPIKE-NOTES §3.3:
  - Latlon: `STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT('<wkt>')) = 1`
  - WKT: `ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT('<wkt>')) = 1`
  - WKB: builder throws `SpatialFilterWkbDeferredError` (static guarantee; never reached in production)
- `buildSpatialOrBlock` always wraps in outer parens — single-shape: `(pred)`, multi-shape: `(pred OR pred OR ...)`, zero shapes: `""` (V15-P-07 invariant)
- WKT literal escaped via `escapeKineticaStringLiteral` before interpolation
- `composeWhereClause` rich-types signature: `(filters: ActiveFilter[], shapes: SpatialFilter[], target: SpatialTarget | null): string`
  - Both → `(spatial_OR_chain) AND (col_AND_chain)` (spatial first, col wrapped)
  - Spatial-only → `(spatial_OR_chain)` (already parenthesized)
  - Column-only → `col_AND_chain` (no extra wrapping)
  - Neither → `"1=1"`
- Endpoint extended in place: `index.ts:684` — NOT forked
- Body adds `spatialFilters?: SpatialFilter[]` + `spatialTarget?: SpatialTarget` fields; existing `{ dashboardId, tableId, filters }` stays
- Validation order: (1) dashboardId/tableId number check, (2) empty-input 400, (3) pair-completeness 400, (4) tableId mismatch 400, (5) WKB 501 early-return, (6) compose+DDL
- WKB 501 body verbatim: `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }`
- DELETE handler unchanged
- `buildFilterViewName` unchanged; view-name shape unchanged (V15-P-10)
- Audit-log tag stays `"MATERIALIZE"`
- Supertest mirrors `routes.filter-materialize.spec.ts` dual-AUTH_MODE structure (23/23 reference)

### Claude's Discretion
- Plan structure (single plan vs split): planner picks based on file-touch isolation
- Exact wording of 400 error messages beyond the one locked above
- Whether `composeWhereClause` accepts `target: SpatialTarget | null` or `target?: SpatialTarget`
- Order of `parts.push(...)` for combined output — REQUIREMENTS literal says `(spatial) AND (col)`
- Whether to import `escapeKineticaStringLiteral` from `whereClause.ts` or duplicate the one-liner

### Deferred Ideas (OUT OF SCOPE)
- Frontend store (Phase 27)
- Per-widget spatialTargets config (Phase 28)
- Draw UX (Phase 29)
- Materialize trigger wiring (Phase 30)
- End-to-end UAT (Phase 31)
- WKB-binary mode implementation (TD-V14-WKB-SPIKE)
- STXY_DWITHIN / circle-as-distance semantics (v1.6)
- Per-shape AND/OR/SUBTRACT toggle
- Audit-log spatial breadcrumb (shape.id wiring)
- Server-side WKT length cap
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WHERE-V15-01 | `spatialWhereClause.ts` exports `buildSpatialOrBlock` producing the correct OR-chain per mode | SQL templates locked in 25-SPIKE-NOTES §3.3; pure-module pattern established in `whereClause.ts` + `spatialQuery.ts` |
| WHERE-V15-02 | `composeWhereClause` produces correct 4-case composition with V15-P-07 paren invariant | `buildServerWhereClause` in `whereClause.ts` is the column-clause source; composition logic is additive |
| WHERE-V15-03 | `POST /api/filter/materialize` extended with `spatialFilters` + `spatialTarget`; backward-compat; WKB→501 | Handler at `index.ts:684-721`; 501 pattern in comments at `index.ts:779-783` |
| WHERE-V15-04 | Supertest coverage for all composition cases, paren correctness, both AUTH_MODE variants | Reference spec: `tests/routes.filter-materialize.spec.ts`; auth fixture pattern: `seedOidcSession` + `makeSessionCookie` |
</phase_requirements>

---

## 1. Existing Server Structure

**Materialize handler location:** `kinetica_bi/server/src/index.ts:684-721`

Current request shape (v1.3 baseline):
```ts
{ dashboardId?: number; tableId?: number; filters?: ActiveFilter[] }
```

Current validation: (a) `typeof dashboardId !== "number"` or `typeof tableId !== "number"` → 400; (b) `!Array.isArray(filters) || filters.length === 0` → 400 with message `"filters array must be non-empty (use DELETE to clear)."`.

Current WHERE-building pipeline (index.ts:711-712):
```ts
const whereClause = buildServerWhereClause(filters);
const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;
```

**WHERE-building code that exists:**
- `kinetica_bi/server/src/lib/whereClause.ts` — exports `buildServerWhereClause(filters: ActiveFilter[]): string` (AND-chain, `"1=1"` on empty) and `escapeKineticaStringLiteral(val: string): string`
- `kinetica_bi/server/src/lib/spatialQuery.ts` — exports `SpatialMode`, `buildLatLonQuery`, `buildWktQuery`, `buildWkbQuery` (for proximity queries, not spatial filter; pattern source only)
- No `spatialWhereClause.ts` exists yet — Phase 26 creates it

**v1.3 baseline invariants to preserve:**
- `filters` allowed to be empty when `spatialFilters` are present (the existing 400 guard must be replaced by the new pair-based logic)
- `buildFilterViewName` call at index.ts:704-709 unchanged
- `kineticaSqlHelper` call at index.ts:714-717 unchanged
- DELETE handler at index.ts:723-745 untouched

---

## 2. What Phase 25 Proved

**Validated predicates (live Kinetica at http://172.31.0.22:8082, run 2026-05-11):**

| Mode | Predicate | Probes | Row counts | Status |
|------|-----------|--------|------------|--------|
| Latlon | `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(?)) = 1` | L-A1/A2/A3 | 490758/490753/490752 | LOCKED |
| WKT | `ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(?)) = 1` | W-B1/B2/B3 | 3/3/3 | LOCKED |
| WKT | `ST_WITHIN(geom_col, ST_GEOMFROMTEXT(?)) = 1` | W-A1/A2/A3 | 0/0/0 | REJECTED |

**V15-P-07 paren lock:** Outer parentheses on the OR-chain are mandatory. The single-shape bug is invisible in unit tests without explicit paren assertions — it only manifests when a second shape is added and breaks the AND with a column filter (silent wrong-result, no SQL error).

**REQUIREMENTS.md WHERE-V15-01 is stale:** It says `ST_WITHIN` for WKT mode. The spike result overrides this. Phase 26 implementer MUST use `ST_INTERSECTS`, not `ST_WITHIN`. The PLAN frontmatter should call this out explicitly.

**Reusable assets from Phase 25:**
- `spatialPredicateSpike.ts` at commit f72615f — preserved one-shot re-run script; do not modify
- `kinetica_bi/server/package.json` has `"spatial-predicate-spike"` npm script
- No extracted utilities from Phase 25 carry into Phase 26 — the spike produced decision records, not shared code

**TD items to carry forward:**
- TD-V14-WKB-SPIKE: WKB-binary mode remains deferred; Phase 26 returns 501 for this mode
- Server version not captured during spike run; Phase 26 PLAN frontmatter should record it via `SHOW SYSTEM PROPERTIES` follow-up

---

## 3. Builder Design

**New file:** `kinetica_bi/server/src/lib/spatialWhereClause.ts`

**Module style (must match `whereClause.ts` and `spatialQuery.ts`):**
- Pure module — zero non-stdlib imports (but MAY import `escapeKineticaStringLiteral` from `./whereClause` since both live in `lib/`)
- Module doc-comment block at top with explicit trust-boundary statement
- No Express / db / kinetica.ts dependencies

**`buildSpatialOrBlock(shapes: SpatialFilter[], target: SpatialTarget): string`**
- Returns `""` when `shapes.length === 0` (callers use `spatialClause.length > 0` guard)
- Wraps single-or-multi result in outer parens: `(pred1 OR pred2 OR ...)`
- Per-shape template (latlon): `` `STXY_WITHIN(${target.lonCol}, ${target.latCol}, ST_GEOMFROMTEXT('${escaped_wkt}')) = 1` ``
- Per-shape template (WKT): `` `ST_INTERSECTS(${target.spatialCol}, ST_GEOMFROMTEXT('${escaped_wkt}')) = 1` ``
- WKB: throws `SpatialFilterWkbDeferredError` (static guarantee — route handler never reaches here for wkb mode)
- Incoherent mode/cols (latlon without lonCol/latCol, wkt/wkb without spatialCol): throws plain `Error` → asyncHandler → middleware → 400
- Identifiers (`lonCol`, `latCol`, `spatialCol`) interpolated raw (admin-trusted boundary, same as whereClause.ts:14-21)

**`composeWhereClause(filters: ActiveFilter[], shapes: SpatialFilter[], target: SpatialTarget | null): string`**
- Calls `buildServerWhereClause(filters)` → `colClause`
- Calls `buildSpatialOrBlock(shapes, target!)` when `target !== null` → `spatialClause`
- Four cases:
  - `spatialClause.length > 0 && colClause !== "1=1"` → `${spatialClause} AND (${colClause})`
  - `spatialClause.length > 0 && colClause === "1=1"` → `${spatialClause}`
  - `spatialClause.length === 0 && colClause !== "1=1"` → `${colClause}`
  - `spatialClause.length === 0 && colClause === "1=1"` → `"1=1"`
- Note: `buildServerWhereClause([])` returns `"1=1"` so the empty-filters case is handled automatically

**Integration into existing pipeline:**
- Route handler replaces `const whereClause = buildServerWhereClause(filters)` with `const whereClause = composeWhereClause(filters, spatialFilters ?? [], spatialTarget ?? null)`
- The `ddl` string template at index.ts:712 is unchanged

---

## 4. Endpoint Changes

**File to modify:** `kinetica_bi/server/src/index.ts:684-721`

**New body destructuring (replace lines 685-690):**
```ts
const body = (req.body ?? {}) as {
  dashboardId?: number;
  tableId?: number;
  filters?: ActiveFilter[];
  spatialFilters?: SpatialFilter[];
  spatialTarget?: SpatialTarget;
};
const { dashboardId, tableId, filters = [], spatialFilters, spatialTarget } = body;
```

**New validation sequence (replace lines 692-697):**
1. `typeof dashboardId !== "number" || typeof tableId !== "number"` → 400 (existing check, unchanged)
2. Empty-input 400: `filters.length === 0 AND (spatialFilters absent/empty OR spatialTarget absent)` → 400 with message `"filters or (spatialFilters + spatialTarget) must be non-empty (use DELETE to clear)."`
3. Pair-completeness 400: `spatialFilters` present without `spatialTarget` (or vice versa) → 400
4. TableId mismatch 400: `spatialTarget && spatialTarget.tableId !== tableId` → 400
5. WKB 501 early-return: `spatialTarget?.spatialMode === "wkb"` → `return res.status(501).json({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" })` (mirror of Phase 18 pattern documented at index.ts:779-783)

**WHERE composition (replace line 711):**
```ts
const whereClause = composeWhereClause(filters, spatialFilters ?? [], spatialTarget ?? null);
```

**The 501 early-return must be BEFORE the builder call** — same structure as the intent documented in the Phase 18 comments at index.ts:779-783. Note: the actual index.ts code for `/api/info/query` does NOT implement this early-return (it calls `buildWkbQuery` directly at line 892). Phase 26 must implement it correctly for the materialize path.

**Backward compat:** v1.3 callers sending `{ dashboardId, tableId, filters: [...] }` (no spatial fields) continue to work. The empty-input validation only fires when BOTH column and spatial inputs are absent.

---

## 5. Test Plan

**New file:** `kinetica_bi/server/tests/routes.filter-materialize-spatial.spec.ts`
(separate file keeps the 23/23 v1.3 reference spec untouched; CONTEXT.md says "mirror" — a sibling file is cleaner)

**Auth fixture pattern (copy verbatim from `routes.filter-materialize.spec.ts`):**
- Hoisted `vi.mock("openid-client")` with `Issuer` constructor + static-discover (lines 27-64)
- `makeSessionCookie(username)` — creates password-mode session, returns `kbi_session` cookie
- `seedOidcSession(username, accessToken?)` — creates `credentialType: "oidc"` session after `buildTestApp()` via `createSession({ ..., credentialType: "oidc", idToken: makeJwt(...) })`
- `resetOidcClientForTests()` in `beforeEach` for OIDC describe blocks
- `vi.stubEnv("AUTH_MODE", "password"|"oidc")` per describe block with `vi.unstubAllEnvs()` in afterEach
- `cleanFixtures()` helper deleting all tables in beforeEach

**Unit tests for pure module (separate file):** `kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts`

**Required assertions (both describe blocks — password AND oidc):**

| Test | Key assertion |
|------|---------------|
| column-only (v1.3 backward compat) | DDL contains `WHERE zone = 'East Village'`; status 200 |
| spatial-only latlon (1 shape) | DDL contains `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('...')) = 1)`; no AND |
| spatial-only WKT (1 shape) | DDL contains `(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('...')) = 1)` |
| combined (1 col + 1 shape) | DDL exact-match: `(STXY_WITHIN(...) = 1) AND (zone = 'East Village')` |
| 1-shape paren correctness | Assert `(pred)` wrapper present — full string match, not substring |
| 3-shape OR-block paren correctness | Assert `(pred OR pred OR pred)` — full string match |
| 0-shape pass-through | `spatialFilters: []` + valid `spatialTarget` is equivalent to column-only; DDL has no spatial |
| Empty input → 400 | `filters: [], spatialFilters: [], spatialTarget: present` → 400 with new message |
| spatialFilters without spatialTarget → 400 | Pair-completeness check |
| spatialTarget without spatialFilters → 400 | Pair-completeness check |
| spatialTarget.tableId !== body.tableId → 400 | TableId mismatch check |
| WKB mode → 501 | `spatialTarget.spatialMode === "wkb"` → 501 `{ error, td }`; `fetchMock.mock.calls.length === 0` |
| Audit-log tag | `"op":"MATERIALIZE"` in console.log output (not a new op tag) |

**501 builder-not-invoked assertion pattern (from `routes.info-query.spec.ts` docstring):**
```ts
expect(res.status).toBe(501);
expect(res.body).toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" });
expect(fetchMock.mock.calls.length).toBe(0); // early-return before kineticaSqlHelper
```

**lib unit test assertions (lib.spatialWhereClause.spec.ts):**
- `buildSpatialOrBlock([], target)` → `""`
- `buildSpatialOrBlock([s1], latlonTarget)` → `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('wkt1')) = 1)"`
- `buildSpatialOrBlock([s1, s2], latlonTarget)` → full exact string with ` OR ` separator and outer parens
- `buildSpatialOrBlock([s1], wktTarget)` → `"(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('wkt1')) = 1)"`
- Single-quote in WKT → doubled (escape test)
- `composeWhereClause` — all 4 cases with exact string assertions (load-bearing V15-P-07 test)
- The 2-shape + 1-column combined test: `"(STXY_WITHIN(...) = 1 OR STXY_WITHIN(...) = 1) AND (zone = 'East Village')"` — full exact match

---

## 6. Open Risks / Unknowns

### Risk 1: Actual 501 early-return in `/api/info/query` is absent from code
The Phase 18 comments at `index.ts:779-783` describe a 501 early-return for WKB mode, but the actual handler at line 892 calls `buildWkbQuery` directly without a 501 guard. The `buildWkbQuery` function in `spatialQuery.ts` also does NOT throw — it returns a working SQL string using `ST_DISTANCE`. Phase 26 must implement the 501 early-return correctly for the materialize path. Do not assume the info-query pattern is a working reference — read the comments as intent, not implementation. **Confidence:** HIGH (verified by source read).

### Risk 2: `composeWhereClause` column-only case wrapping
CONTEXT.md states column-only output has no extra parens: `col_AND_chain` unchanged from `buildServerWhereClause`. But the combined case wraps the col-side: `(col_AND_chain)`. The exact "both" branch output must match REQUIREMENTS literal: `(spatial) AND (col)`. Unit tests must assert both cases with full string matching to prevent a wrapping inconsistency.

### Risk 3: `SpatialMode` type duplication vs import
`spatialQuery.ts` already exports `SpatialMode = "latlon" | "wkt" | "wkb"`. CONTEXT.md says `spatialWhereClause.ts` also exports `SpatialMode`. Options: (a) re-export from spatialQuery.ts, (b) re-define in spatialWhereClause.ts. CONTEXT.md's "zero non-stdlib imports" discipline favors (b) — defining locally avoids a cross-module dependency for a trivial type. Planner should pick one and note it explicitly.

### Risk 4: `filters` default value when v1.3 caller sends non-array
The existing validation checks `!Array.isArray(filters) || filters.length === 0`. With the new body shape, `filters` defaults to `[]` when absent. A v1.3 caller that sends `filters: null` would pass the type cast but fail the array check. The new validation handles this via the empty-input 400 with the updated message. Ensure the new guard handles `null` and `undefined` `filters` the same as `[]`.

### Risk 5: Kinetica server version not captured
The deployed Kinetica version is unknown (25-SPIKE-NOTES §4.1). CONTEXT.md requires recording it in Phase 26 PLAN frontmatter via `SHOW SYSTEM PROPERTIES`. This is an operator action, not a code task, but the planner should include a task step for it.

---

## Sources

### Primary (HIGH confidence — files on disk)
- `kinetica_bi/server/src/index.ts:684-721` — current POST /api/filter/materialize handler
- `kinetica_bi/server/src/index.ts:747-938` — POST /api/info/query (501 pattern intent, not implementation)
- `kinetica_bi/server/src/lib/whereClause.ts` — `buildServerWhereClause`, `escapeKineticaStringLiteral`, `ActiveFilter` type, pure-module style
- `kinetica_bi/server/src/lib/spatialQuery.ts` — `SpatialMode` type, three-builder pattern, trust-boundary doc style
- `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` — 23-test AUTH_MODE dual-mount reference
- `kinetica_bi/server/tests/routes.info-query.spec.ts` — OIDC session fixture pattern, 501 docstring
- `kinetica_bi/server/tests/lib.whereClause.spec.ts` — unit test style for pure lib modules
- `.planning/phases/26-server-spatial-where/26-CONTEXT.md` — all locked decisions
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md` — locked predicate templates, V15-P-07, hand-off checklist
- `.planning/phases/25-spatial-predicate-spike/25-VERIFICATION.md` — Phase 25 PASS confirmation, probe matrix

---

## RESEARCH COMPLETE
