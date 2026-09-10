---
phase: 18-spatial-spike-and-endpoint
plan: 03
subsystem: api
tags: [kinetica, spatial, express-route, info-query, geodist, stxy_distance, wkb-deferred-501, supertest, tdd]

requires:
  - phase: 18-spatial-spike-and-endpoint plan 02
    provides: spatialQuery.ts (buildLatLonQuery, buildWktQuery, buildWkbQuery-throws, SpatialMode, SpatialColumns) + radiusConversion.ts (pxToGroundDistance meters, pxToGroundDegrees degrees) — pure server modules, zero non-stdlib imports
  - phase: 18-spatial-spike-and-endpoint plan 01
    provides: WKB spike outcome (NONE_ESCALATE → TECH_DEBT, TD-V14-WKB-SPIKE) — endpoint encodes the deferral as HTTP 501 early-return
  - phase: 13-spikes-and-endpoint plan 03
    provides: POST /api/filter/materialize handler pattern (requireConfig + asyncHandler + per-user kineticaSqlHelper + no try/catch + supertest mirror with hoisted Issuer mock) — Plan 18-03 mirrors byte-for-byte
provides:
  - kinetica_bi/server/src/index.ts — POST /api/info/query route (lines 781-938) integrating Plan 18-02 modules
  - kinetica_bi/server/src/kinetica.ts — KineticaOp union extended with "INFO_QUERY"
  - kinetica_bi/server/tests/routes.info-query.spec.ts — 24 supertest specs (password + oidc), 24/24 passing
  - SPATIAL-V14-04 implemented end-to-end (Phase 21 frontend can now call this endpoint)
affects: [21-map-click-popup (consumer), future-WKB-spike-round-TD-V14-WKB-SPIKE (re-run will replace 501 path with proper wkb dispatch)]

tech-stack:
  added: []
  patterns:
    - "Three-mode dispatch with deferred-by-design 501: spatialMode='wkb' returns HTTP 501 early-return BEFORE any builder/kineticaSql call. Builds the Plan 18-01 NONE_ESCALATE outcome into the API contract — buildWkbQuery is intentionally NOT imported (would throw WkbDeferredError)."
    - "Sibling helper selection per spatialMode: pxToGroundDistance (meters) for 'latlon' (GEODIST consumer), pxToGroundDegrees (degrees) for 'wkt' (STXY_DISTANCE consumer). Eliminates divide-then-multiply round-tripping between the two SRS-unit conventions."
    - "Encoded-response parsing: Kinetica column-major (column_headers + column_1, column_2, ...) → row-major Record<string, unknown>[]. Generalizes the existing column_1 string[] consumption pattern from /api/kinetica/schemas* discovery routes to N columns."
    - "Spec-mirroring: routes.info-query.spec.ts copies routes.filter-materialize.spec.ts structure verbatim (hoisted Issuer mock + vi.mock('openid-client') + buildTestApp + describe-per-AUTH_MODE). Avoids TD-V11-04 OIDC mock divergence and TD-V13-01 fetch-mock brittleness."

key-files:
  created:
    - kinetica_bi/server/tests/routes.info-query.spec.ts
    - .planning/phases/18-spatial-spike-and-endpoint/18-03-info-query-endpoint-SUMMARY.md
  modified:
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/server/src/kinetica.ts

key-decisions:
  - "POST /api/info/query mounts under app.use('/api', requireAuth) namespace via requireConfig + asyncHandler middleware chain — mirrors POST /api/filter/materialize precedent (Plan 13-03). No new auth path; per-user creds forwarded via kineticaSqlHelper."
  - "WKB mode early-return 501: validates spatialMode/spatialColumns shape THEN immediately returns HTTP 501 with body { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }. Validation runs BEFORE the early-return so a mis-shaped wkb request gets 400 (not 501) — keeps client-error behavior consistent across modes. Test 3 asserts ZERO kineticaSql calls, proving buildWkbQuery is never invoked."
  - "buildWkbQuery NOT imported in index.ts (only buildLatLonQuery + buildWktQuery + types). Plan 18-02's stub throws WkbDeferredError by design; not importing it makes the deferral a static guarantee — even a future code-path bug couldn't accidentally invoke the throwing function. Comments in the import block document the intent for the next agent."
  - "Pagination edge case: hasMore = (rows.length === 50) — strict-equality, not ≥. With LIMIT 50 OFFSET (page * 50), exactly 50 rows means more pages MAY exist; <50 rows means we've reached the tail. Keeps server stateless re total-count (no COUNT(*) round-trip needed)."
  - "Encoded-response parser is inline at the route handler (not extracted to a helper). Kinetica's column-major shape is already consumed inline by the discovery routes (index.ts:771-799 for schemas/tables/columns) — extracting it now would be premature. If Phase 21+ adds a third inline parser, factor to a helper at that point."
  - "kineticaSql `extra: { limit: 50 }` matches the SQL's LIMIT 50 clause. The SQL LIMIT is the source of truth (PostGIS-style); the kineticaSql envelope limit is belt-and-suspenders to prevent over-allocation if the SQL ever drifts."
  - "No view-of-views (Phase 18 lock per planning_context): info popup queries the source table directly via FROM <schema>.<table>. Filter views (v1.3 _kbi_filt_*) are NOT applied — info popup is independent of dashboard filter state. Documented in route-handler comments so a future Phase 25+ can revisit if/when the lock is reconsidered."

patterns-established:
  - "Three-mode dispatch with deferred-by-design 501: validate request shape across all modes including the deferred one (so client gets consistent 400 on mis-shaped requests), THEN early-return HTTP 501 for the deferred mode BEFORE any builder/kineticaSql call. This pattern keeps the deferred mode discoverable in the API surface without introducing throwing code paths."
  - "Spec-by-mirror: when adding an endpoint that follows an established pattern (here POST /api/filter/materialize), copy its supertest spec verbatim and substitute the route + body shape. Saved ~hours of mock-pattern debugging and avoided TD-V11-04 / TD-V13-01 baselines."

requirements-completed: [SPATIAL-V14-04]

duration: 9min
completed: 2026-05-08
---

# Phase 18 Plan 03: Info-Query Endpoint Summary

**`POST /api/info/query` is live in `kinetica_bi/server/src/index.ts` (lines 781-938) — wires Plan 18-02's `spatialQuery.ts` + `radiusConversion.ts` modules into an Express route under `requireConfig + asyncHandler` (mirrors `POST /api/filter/materialize`). 24/24 supertest pass across `AUTH_MODE=password` (21 tests) and `AUTH_MODE=oidc` (3 tests). WKB mode returns HTTP 501 early-return per Plan 18-01 NONE_ESCALATE → TD-V14-WKB-SPIKE deferral.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-08T04:42:08Z
- **Completed:** 2026-05-08T04:50:58Z
- **Tasks:** 2 (TDD: RED + GREEN, 2 commits total — Task 2 spec satisfied by the comprehensive RED+GREEN cycle)
- **Files created:** 1 spec
- **Files modified:** 2 (index.ts route, kinetica.ts KineticaOp)

## Accomplishments

- **`POST /api/info/query` route registered** under `app.use("/api", requireAuth)` namespace via `requireConfig + asyncHandler` (mirrors `POST /api/filter/materialize` precedent). No try/catch — typed Kinetica errors bubble to `errorMiddleware`.
- **`KineticaOp` union extended** with `"INFO_QUERY"` (audit log op tag). All audit lines from this route emit `"op":"INFO_QUERY"` for log filtering.
- **Three-mode dispatch with deferred-by-design 501**:
  - `spatialMode='latlon'` → `pxToGroundDistance` (meters) → `buildLatLonQuery` → `kineticaSqlHelper`
  - `spatialMode='wkt'` → `pxToGroundDegrees` (degrees) → `buildWktQuery` → `kineticaSqlHelper`
  - `spatialMode='wkb'` → HTTP 501 with body `{ error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }` BEFORE any builder/kineticaSql call (validates request shape first; ZERO `fetch` calls — proven by Test 3)
- **`buildWkbQuery` is NOT imported** in `index.ts` — only `buildLatLonQuery + buildWktQuery + types`. Plan 18-02's stub throws by design; not importing it makes the deferral a static guarantee.
- **Comprehensive validation**: 9 distinct 400-error paths (missing layerId/tableId/schema/table, bad spatialMode, missing latCol for latlon mode, radiusPx ≤ 0, page < 0 / non-integer, mapBbox wrong length); 1 404 (table not found); 401/403/502 propagation from `errorMiddleware`.
- **Encoded-response parser**: Kinetica column-major (`column_headers + column_1, column_2, …`) → row-major `Record<string, unknown>[]`. `hasMore = (rows.length === 50)`.
- **24/24 supertest pass** across both AUTH_MODE branches; **`tsc --noEmit` clean**.

## Endpoint Contract (Verified)

### Request

```typescript
type InfoQueryRequest = {
  layerId: number;       // dashboard_layer.id (passed through; future-use)
  tableId: number;       // tables.id (admin metadata cross-check via getTable)
  schema: string;        // e.g. "ki_home"
  table: string;         // e.g. "events"
  spatialMode: "latlon" | "wkt" | "wkb";
  spatialColumns: { lonCol?, latCol?, wktCol?, wkbCol? };
  clickLon: number;
  clickLat: number;
  radiusPx: number;        // > 0
  mapBbox: [number, number, number, number];  // [minLon, minLat, maxLon, maxLat]
  mapWidthPx: number;      // > 0
  mapHeightPx: number;     // > 0
  page: number;            // 0-indexed; integer ≥ 0
};
```

### Response

```typescript
// 200 happy path:
type InfoQueryResponse = {
  rows: Record<string, unknown>[];   // up to 50 records
  columns: string[];                   // column names in row order
  hasMore: boolean;                    // rows.length === 50
  page: number;                        // echo of request.page
};

// 501 wkb mode (Plan 18-01 deferral):
{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }

// 400 validation: 9 distinct error messages
// 404 table not found: { error: "Table not found." }
// 401: from requireAuth (no cookie) OR from KineticaAuthError → REAUTH_REQUIRED
// 403: from KineticaPermissionError (no `code` field)
// 502: from KineticaUpstreamError (5xx upstream)
```

## Two-Line Stress Test for the WKB Branch (Test 3)

```typescript
// Test 3 asserts the deferred-by-design contract:
expect(res.status).toBe(501);
expect(res.body).toEqual({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" });
expect(fetchMock.mock.calls.filter(c => String(c[0]).includes("/execute/sql")).length).toBe(0);
```

The third assertion is the load-bearing one: it proves `buildWkbQuery` was NEVER invoked (zero `/execute/sql` POSTs to Kinetica). The endpoint validates the request shape (including `spatialColumns.wkbCol` being a string), then immediately early-returns 501 BEFORE any builder dispatch. This is the key behavior that makes the Plan 18-01 NONE_ESCALATE → TD-V14-WKB-SPIKE deferral safe to ship: the throwing stub in `spatialQuery.ts` is never reachable from production traffic.

## AUTH_MODE=oidc Status (TD-V11-04 mock divergence didn't bite)

**3/3 OIDC tests pass cleanly.** The hoisted `vi.mock("openid-client")` pattern from `routes.filter-materialize.spec.ts` (lines 27-70) was copied verbatim into `routes.info-query.spec.ts`. Specifically:

- `Issuer` is mocked as both a constructor function AND a static `discover` namespace (oidc.ts does `new Issuer(meta)` to suppress the RFC 9207 iss-check workaround per TD-V11-03)
- `seedOidcSession` creates a `credentialType: "oidc"` session via `createSession` AFTER `buildTestApp()` boots — survives the AUTH_MODE-change wipe
- Test 20 asserts `Authorization: Bearer <access_token>` (not Basic) on the Kinetica fetch call
- Test 21 asserts the audit log line contains `"auth_mode":"oidc"` alongside `"op":"INFO_QUERY"`
- Test 22 asserts SQL emitted is identical across auth modes (regression — builders don't read `req.user`)

TD-V11-04 (~60 backend tests red from OIDC mock divergence in 6 other spec files) did NOT contaminate this spec. The mirror pattern is the right pattern.

## Pass/Fail Status

- `tests/routes.info-query.spec.ts` — **PASS** (24/24)
- `npx tsc --noEmit` — **PASS** (clean)
- Adjacent regression checks (run alongside): `lib.spatialQuery.spec.ts` (12/12), `lib.radiusConversion.spec.ts` (9/9), `routes.filter-materialize.spec.ts` (23/23) — all PASS, no regressions

Pre-existing failures NOT caused by this plan (verified by checking against `master` before any 18-03 commits): `routes.sql.spec.ts` (8/10 fail) — TD-V13-01 fetch-mock brittleness baseline.

## Phase 18 Verification Roll-up — All 5 SPATIAL-V14-* Requirements

| Req | Status | How verified |
|-----|--------|--------------|
| SPATIAL-V14-01 (lat/lon GEODIST) | **Reachable** | `buildLatLonQuery` (Plan 18-02) + Test 4 asserts `GEODIST(lon, lat, -73.95, 40.75)` in WHERE+ORDER BY + LIMIT 50 OFFSET 0 |
| SPATIAL-V14-02 (WKT STXY_DISTANCE without ST_GEOMFROMTEXT) | **Reachable** | `buildWktQuery` (Plan 18-02) + Test 2 asserts SQL contains `STXY_DISTANCE(geom, -73.95, 40.75)` AND does NOT contain `ST_GEOMFROMTEXT` |
| SPATIAL-V14-03 (WKB) | **DEFERRED → TD-V14-WKB-SPIKE** | Plan 18-01 NONE_ESCALATE outcome encoded as Test 3 (501 early-return + ZERO kineticaSql calls); requirement stays `[ ]` in REQUIREMENTS.md with deferral note |
| SPATIAL-V14-04 (the endpoint) | **Implemented** | This plan: route at index.ts:781-938 + 24/24 supertest pass |
| SPATIAL-V14-05 (server-side radius conversion) | **Reachable** | `pxToGroundDistance` (latlon) + `pxToGroundDegrees` (wkt) called server-side in the route handler; Plan 18-02 unit tests cover the math; integration covered by latlon + wkt happy paths in this spec |

**Phase 18 Success Criteria (from ROADMAP.md):**

1. ✅ Operator spike runs with locked Decision in `18-SPIKE-NOTES.md` — `NONE_ESCALATE → TECH_DEBT` (TD-V14-WKB-SPIKE) on 2026-05-08
2. ✅ `spatialMode: "latlon"` returns up to 50 records ordered by ascending GEODIST distance — Tests 1, 4, 5, 23, 24 cover this
3. ✅ `spatialMode: "wkt"` uses STXY_DISTANCE with raw (x, y) — Test 2 asserts no ST_GEOMFROMTEXT
4. ✅ `spatialMode: "wkb"` returns HTTP 501 with TD-V14-WKB-SPIKE body, builder NOT invoked — Test 3 asserts both
5. ✅ radiusPx → ground-distance threshold derived from mapBbox + mapWidthPx + mapHeightPx — verified at unit-test level (Plan 18-02) and integration level (latlon + wkt happy paths in this spec)

## Task Commits

1. **Task 1 RED: failing supertest spec for POST /api/info/query** — `681ef7c` (test) — KineticaOp union extension + comprehensive 24-test spec; 23/24 fail (route not yet mounted), 1/24 passes (no-cookie 401 from requireAuth, route-independent)
2. **Task 1 GREEN: wire POST /api/info/query route in index.ts** — `4ef4632` (feat) — full route handler (validation + WKB 501 early-return + dispatch + parsing); 24/24 supertest pass; tsc clean

(Task 2 was the comprehensive spec creation — landed in the `681ef7c` RED commit. Task 2 GREEN was satisfied by `4ef4632` route implementation: spec went 23-fail → 24-pass with no spec edits required. Task structure honored as RED-then-GREEN per Plan 18-02 precedent.)

## Files Created/Modified

- `kinetica_bi/server/src/index.ts` (MODIFIED) — added imports for spatialQuery + radiusConversion modules; added POST /api/info/query route handler at lines 781-938 (~158 lines including comments)
- `kinetica_bi/server/src/kinetica.ts` (MODIFIED) — extended KineticaOp union with `"INFO_QUERY"`
- `kinetica_bi/server/tests/routes.info-query.spec.ts` (NEW) — 24 supertest specs across AUTH_MODE=password (21) and AUTH_MODE=oidc (3); ~600 lines

## Decisions Made

1. **Validate request shape across ALL modes (including wkb) BEFORE the wkb 501 early-return** — so a mis-shaped wkb request gets 400 (not 501), keeping client-error behavior consistent across modes. The 501 is reserved for "wkb mode is deferred"; 400 is reserved for "your request is malformed". Mixing them would hide bugs.
2. **Don't import `buildWkbQuery`** — Plan 18-02 exports it (throws WkbDeferredError by design), but pulling it into `index.ts` would require a code-path argument that it's never called. Easier to enforce statically: omit the import, comment the omission, document the intent. A future agent re-running TD-V14-WKB-SPIKE will add the import back when replacing the throw with the spike-locked SQL.
3. **`hasMore = (rows.length === 50)` strict-equality** — exact 50 rows means more pages MAY exist; <50 means tail. Avoids the COUNT(*) round-trip (server stays stateless re total-count) at the cost of one extra "load more" click that returns 0 rows in the edge case where the data is exactly N×50. Acceptable UX trade-off.
4. **Encoded-response parser inlined, not extracted** — the discovery routes (index.ts:771-799) already inline column_1 string[] consumption. This is the second inline; extracting now would be premature. If Phase 21+ adds a third inline parser, factor to a `parseKineticaTabular(result)` helper.
5. **`kineticaSqlHelper extra: { limit: 50 }`** — matches the SQL's LIMIT 50; belt-and-suspenders. The SQL LIMIT is the source of truth.
6. **Combined Task 1 + Task 2 into a single RED+GREEN cycle** — the plan's Task 1 was "wire route" and Task 2 was "build spec". The clean TDD pattern is spec-first (RED) then route (GREEN). The comprehensive 24-test spec landed in the RED commit (`681ef7c`); the route landed in the GREEN commit (`4ef4632`). 23 failing tests went to 24 passing tests with zero spec edits. Both tasks' acceptance criteria satisfied by these two commits — no third commit needed.

## Deviations from Plan

**None on substance.** Plan executed exactly as the updated `18-03-PLAN.md` (commit `b011854`) specified:
- WKB early-return 501 BEFORE any builder call ✓
- `buildWkbQuery` not imported ✓
- Test 3 asserts 501 + zero kineticaSql calls ✓
- latlon and wkt happy paths unchanged ✓

**One structural choice for the TDD cycle:** combined Tasks 1+2 into one RED+GREEN pair (test-first then implementation) rather than running two separate RED+GREEN cycles. This is more pragmatic when the spec from Task 2 is needed to validate Task 1 anyway. Two commits land the same artifacts a four-commit cycle would, with cleaner history. The plan's verify and acceptance_criteria for both tasks are satisfied (24 ≥ 22 it() blocks; tsc clean; SQL-string assertions present; audit-log assertions present).

## Issues Encountered

**One stash/unstash hiccup mid-execution** (recovered cleanly):
- During regression-check exploration, ran `git stash` to inspect `routes.sql.spec.ts` against master (to confirm 8 failures were pre-existing TD-V13-01 baselines, not caused by this plan).
- Stash pop failed because the working tree had pre-existing `kinetica_bi/server/data/kinetica.db-shm` / `kinetica.db-wal` modifications colliding with stash content.
- Recovered by `git checkout stash@{0} -- kinetica_bi/server/src/index.ts` to restore my Task 1 GREEN edits, then `git stash drop` to discard the stash (which only contained the route changes plus pre-existing noise).
- Verification after recovery: route at line 781, tsc clean, 24/24 tests pass — work intact.
- Confirmation: `routes.sql.spec.ts` is 8/10 failing on master too — pre-existing TD-V13-01 fetch-mock brittleness, NOT caused by this plan.

## Authentication Gates

None — pure backend work. Tests use mocked `fetch` + mocked `openid-client` Issuer; no real Kinetica calls, no real OIDC IdP calls, no env vars beyond what `tests/setup.ts` already sets.

## Next Phase Readiness

Phase 18 closes after this plan. Phase 21 (`map-click-popup`) is the next consumer: `MapChartRenderer` will fire `POST /api/info/query` on click events. Phase 21 also needs Phase 19 (config-schema) to land first — `info_enabled`, `info_columns`, `info_template` columns on `dashboard_layers` + `infoEnabled`/`infoRadiusPx` on map widget config.

Phase 18 ships partial scope as planned: SPATIAL-V14-01 + V14-02 + V14-04 + V14-05 complete; SPATIAL-V14-03 deferred to TD-V14-WKB-SPIKE (re-run pending until a WKB-binary column becomes reachable in the operator's Kinetica account; runner is production-payload-parity at commit `d458408`).

---
*Phase: 18-spatial-spike-and-endpoint*
*Plan: 03-info-query-endpoint*
*Completed: 2026-05-08*

## Self-Check: PASSED

- File `kinetica_bi/server/tests/routes.info-query.spec.ts` exists; 24 `it(...)` blocks; contains `vi.hoisted`, `vi.mock("openid-client"`, `fetchMock.mock.calls`, `"op":"INFO_QUERY"`, `TD-V14-WKB-SPIKE`.
- File `kinetica_bi/server/src/index.ts` contains `app.post("/api/info/query"` at line 781; imports `buildLatLonQuery + buildWktQuery + types` from `./lib/spatialQuery` (NOT buildWkbQuery — only commented references); imports `pxToGroundDistance + pxToGroundDegrees` from `./lib/radiusConversion`; route uses `op: "INFO_QUERY"`; route has WKB early-return 501 with `td: "TD-V14-WKB-SPIKE"`; ZERO `try {` blocks in the route handler.
- File `kinetica_bi/server/src/kinetica.ts` `KineticaOp` union includes `"INFO_QUERY"`.
- Commits `681ef7c` (test RED) and `4ef4632` (feat GREEN) both present in `git log --oneline --all`.
- `npx tsc --noEmit` is clean.
- `npx vitest run tests/routes.info-query.spec.ts` exits 0 with 24/24 passing.
- No regressions in adjacent specs (`lib.spatialQuery.spec.ts` 12/12, `lib.radiusConversion.spec.ts` 9/9, `routes.filter-materialize.spec.ts` 23/23).
