---
phase: 18-spatial-spike-and-endpoint
verified: 2026-05-08T05:05:00Z
status: passed
score: 5/5 success criteria verified (partial-scope WKB deferral is the locked decision, NOT a gap)
re_verification:
  is_re_verification: false
  note: "Initial verification of Phase 18 — three plans across one phase directory."
---

# Phase 18: spatial-spike-and-endpoint — Verification Report

**Phase Goal (from ROADMAP.md):** Two of three spatial query modes (lat/lon + WKT) are proven against Kinetica and `POST /api/info/query` is live with server-side radiusPx→ground conversion. WKB mode (SPATIAL-V14-03) deferred to TD-V14-WKB-SPIKE.

**Verified:** 2026-05-08T05:05:00Z
**Status:** PASSED (full pass on the locked partial-scope plan)
**Re-verification:** No — initial verification

## Partial-Scope Acknowledgment (SPATIAL-V14-03 → TD-V14-WKB-SPIKE)

Phase 18's contracted goal explicitly defers SPATIAL-V14-03 to TD-V14-WKB-SPIKE. The deferral is a planned outcome agreed by the operator on 2026-05-08, NOT a gap. Verification treats:

- "Endpoint returns HTTP 501 for `spatialMode='wkb'` with body `{ error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }`" as the **expected behavior** (Success Criterion 4)
- `buildWkbQuery` throwing `WkbDeferredError` as the **expected design** (Plan 18-02 Truth #3)

The deferral is encoded consistently across all five planning surfaces (verified below): PROJECT.md, STATE.md, REQUIREMENTS.md, ROADMAP.md, 18-SPIKE-NOTES.md.

## Success Criteria — Goal-Backward Verification

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Operator spike runs against deployed Kinetica with locked Decision in `18-SPIKE-NOTES.md` (PROBE_A/B/C/NONE_ESCALATE) — expected: `NONE_ESCALATE → TECH_DEBT` | PASS | `18-SPIKE-NOTES.md:99` records `**Chosen WKB SQL pattern:** NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE)`; all three probes have verbatim HTTP-status + body-JSON output |
| 2 | `POST /api/info/query` with `spatialMode: "latlon"` returns up to 50 records ordered by ascending GEODIST distance with correct page/hasMore/columns | PASS | Route handler at `index.ts:881-889`; SQL emits `GEODIST(lon, lat, ...) <= radius ORDER BY GEODIST(...) ASC LIMIT 50 OFFSET (page*50)`; supertest `routes.info-query.spec.ts` Tests 1, 4, 5, 23, 24 (5 tests) all green |
| 3 | `POST /api/info/query` with `spatialMode: "wkt"` returns records ordered by STXY_DISTANCE using raw (x, y) — NO ST_GEOMFROMTEXT | PASS | Route handler at `index.ts:892-897`; `buildWktQuery` at `spatialQuery.ts:106-109` emits `STXY_DISTANCE(${wktCol}, ${clickLon}, ${clickLat})` with no wrapper; supertest Test 2 (`routes.info-query.spec.ts:236-237`) asserts `toMatch(/STXY_DISTANCE\(geom, -73\.95, 40\.75\)/)` AND `not.toContain("ST_GEOMFROMTEXT")` — green |
| 4 | `POST /api/info/query` with `spatialMode: "wkb"` returns HTTP 501 with body `{ error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }`; endpoint does NOT invoke buildWkbQuery | PASS | Route handler at `index.ts:852-854` early-returns 501 BEFORE any builder dispatch; `buildWkbQuery` is intentionally NOT imported in `index.ts` (lines 20-32 — comment + import block); supertest Test 3 (`routes.info-query.spec.ts:241-263`) asserts `status === 501`, body equality, AND `fetchMock.mock.calls.filter(/execute\/sql/).length === 0` — green |
| 5 | Click radius threshold derived from radiusPx + mapBbox + mapWidthPx + mapHeightPx — verified for lat/lon + WKT modes | PASS | `pxToGroundDistance` at `radiusConversion.ts:71-88` (meters; for GEODIST/lat-lon); `pxToGroundDegrees` at `radiusConversion.ts:110-119` (degrees; for STXY_DISTANCE/wkt); both invoked at `index.ts:881-897` per spatialMode; unit tests in `lib.radiusConversion.spec.ts` (9/9 green) cover proportional zoom behavior + cos(lat) correction |

**Score:** 5/5 success criteria verified.

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `kinetica_bi/server/src/wkbSpike.ts` | Operator spike runner (npm run wkb-spike); production-payload-parity at commit `d458408` | VERIFIED | 10501 bytes; contains STXY_DISTANCE, ST_GEOMFROMTEXT, GEODIST probes; reusable for future TD-V14-WKB-SPIKE re-run |
| `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md` | Verbatim probe output + locked Decision (NONE_ESCALATE) | VERIFIED | All 5 sections present (Probe A/B/C, Decision, Caveats); Decision line `NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE)` matches expected outcome |
| `kinetica_bi/server/src/lib/spatialQuery.ts` | 3 SQL builders + WkbDeferredError + types; pure module (zero non-stdlib imports) | VERIFIED | 7 exports: `SpatialMode`, `SpatialColumns`, `SpatialQueryArgs`, `WkbDeferredError`, `buildLatLonQuery`, `buildWktQuery`, `buildWkbQuery` (throws); `grep "^import"` returns 0 lines |
| `kinetica_bi/server/src/lib/radiusConversion.ts` | `pxToGroundDistance` (meters) + `pxToGroundDegrees` (degrees); pure module | VERIFIED | 3 exports: `MapBbox`, `pxToGroundDistance`, `pxToGroundDegrees`; contains `Math.cos` and `111_320`; zero imports |
| `kinetica_bi/server/tests/lib.spatialQuery.spec.ts` | Unit tests for 3 builders | VERIFIED | 12 tests, 12/12 green |
| `kinetica_bi/server/tests/lib.radiusConversion.spec.ts` | Unit tests for radius conversion | VERIFIED | 9 tests, 9/9 green |
| `kinetica_bi/server/src/index.ts:781-938` | `POST /api/info/query` route handler | VERIFIED | Route registered under `requireConfig + asyncHandler`; no try/catch; per-user creds via `kineticaSqlHelper(req, sql, { op: "INFO_QUERY" })`; WKB early-return 501 ahead of builder dispatch |
| `kinetica_bi/server/src/kinetica.ts` (KineticaOp) | Union extended with `"INFO_QUERY"` | VERIFIED | `kinetica.ts:31` reads `KineticaOp = "SQL" \| "DISCOVERY" \| "MATERIALIZE" \| "WMS" \| "INFO_QUERY"` |
| `kinetica_bi/server/tests/routes.info-query.spec.ts` | Supertest coverage for password + OIDC modes | VERIFIED | 24 tests (21 password + 3 OIDC); 24/24 green |

## Key Link Verification (Wiring)

| From | To | Via | Status |
|---|---|---|---|
| `index.ts` | `lib/spatialQuery.ts` | `import { buildLatLonQuery, buildWktQuery, type SpatialMode, type SpatialColumns } from "./lib/spatialQuery"` (lines 27-32) — `buildWkbQuery` intentionally omitted | WIRED |
| `index.ts` | `lib/radiusConversion.ts` | `import { pxToGroundDistance, pxToGroundDegrees } from "./lib/radiusConversion"` (line 33) | WIRED |
| `index.ts POST /api/info/query` | `kinetica.ts kineticaSqlHelper` | `kineticaSqlHelper(authedReq, sql, { route: "POST /api/info/query", op: "INFO_QUERY", extra: { limit: 50 } })` (line 903-907) | WIRED |
| `spatialQuery.ts buildWkbQuery` | `WkbDeferredError` (same file) + 18-SPIKE-NOTES.md ## Decision | Doc-comment references TD-V14-WKB-SPIKE; throw raises `WkbDeferredError("WKB mode deferred — TD-V14-WKB-SPIKE")` | WIRED |
| `index.ts WKB branch` | HTTP 501 early-return BEFORE builder | `if (body.spatialMode === "wkb") { return res.status(501).json({ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }); }` (line 852-854) executed BEFORE `getTable` and any builder call | WIRED |

## Requirements Coverage (Cross-Reference Against REQUIREMENTS.md)

| Requirement | Source Plan | Description | Expected Status | REQUIREMENTS.md Status | Verdict |
|---|---|---|---|---|---|
| SPATIAL-V14-01 | 18-02 | Lat/Lon GEODIST nearest query | Complete | `Complete` (line 112) | SATISFIED — `buildLatLonQuery` ships verbatim GEODIST template; integration test green |
| SPATIAL-V14-02 | 18-02 | WKT STXY_DISTANCE without ST_GEOMFROMTEXT | Complete | `Complete` (line 113) | SATISFIED — `buildWktQuery` uses raw (x,y) per locked decision; spec asserts `not.toContain("ST_GEOMFROMTEXT")` |
| SPATIAL-V14-03 | 18-01 | WKB nearest query | Deferred (TD-V14-WKB-SPIKE) | `Deferred (TD-V14-WKB-SPIKE)` (line 114) | DEFERRED AS PLANNED — `buildWkbQuery` throws by design; endpoint 501s; deferral documented in PROJECT.md, STATE.md, ROADMAP.md, 18-SPIKE-NOTES.md |
| SPATIAL-V14-04 | 18-03 | `POST /api/info/query` endpoint | Complete | `Complete` (line 115) | SATISFIED — route at `index.ts:781-938` matches locked request/response contract; 24/24 supertest pass |
| SPATIAL-V14-05 | 18-02 | Server-side radiusPx → ground distance | Complete | `Complete` (line 116) | SATISFIED — `pxToGroundDistance` (meters) + `pxToGroundDegrees` (degrees) computed server-side in route handler; unit tests cover proportional zoom + cos(lat) correction |

All 5 requirement IDs in PLAN frontmatter (`SPATIAL-V14-01..05`) are accounted for. SPATIAL-V14-03 is correctly marked `Deferred (TD-V14-WKB-SPIKE)`, not `Pending`. No orphaned requirements found.

## Test Results

```
$ cd kinetica_bi/server
$ npx vitest run tests/lib.spatialQuery.spec.ts tests/lib.radiusConversion.spec.ts tests/routes.info-query.spec.ts

✓ tests/lib.spatialQuery.spec.ts    (12 tests) 8ms
✓ tests/lib.radiusConversion.spec.ts (9 tests) 6ms
✓ tests/routes.info-query.spec.ts   (24 tests) 167ms

Test Files  3 passed (3)
     Tests  45 passed (45)
```

```
$ npx tsc --noEmit
(no output — clean)
```

**Pre-existing baselines NOT counted as Phase 18 gaps** (verified to be pre-existing on master per Plan 18-03 SUMMARY's regression check):
- TD-V11-04: ~60 OIDC test mock divergence (v1.1 carry-over) — NOT contaminating `routes.info-query.spec.ts` (3/3 OIDC tests green here, mirror pattern from `routes.filter-materialize.spec.ts` is correct)
- TD-V13-01: `routes.sql.spec.ts` 8/10 fail + ~44 fetch-mock brittleness tests (v1.3 carry-over)
- TD-V12-04: fixture demo informational

## Cross-File Consistency of WKB Deferral

| Surface | Encoding | Verified |
|---|---|---|
| `.planning/PROJECT.md` line 39 | `**TD-V14-WKB-SPIKE** (registered 2026-05-08, Phase 18 close-out)` entry with full context | YES |
| `.planning/STATE.md` lines 129, 166-167 | Decisions section + Blockers/Concerns: SPATIAL-V14-03 `RESOLVED → TECH_DEBT`, TD-V14-WKB-SPIKE registered | YES |
| `.planning/REQUIREMENTS.md` line 18, 114 | SPATIAL-V14-03 row marked `Deferred (TD-V14-WKB-SPIKE)`; bullet annotated with deferral rationale | YES |
| `.planning/ROADMAP.md` lines 64, 147-152 | Phase 18 description annotates `Partial scope (locked 2026-05-08)`; SPATIAL-V14-03 listed as `Deferred → TD-V14-WKB-SPIKE`; Success criterion 1 reads `landed NONE_ESCALATE → TECH_DEBT on 2026-05-08` | YES |
| `18-SPIKE-NOTES.md ## Decision` | `NONE_ESCALATE → resolved to TECH_DEBT (TD-V14-WKB-SPIKE)` | YES |

## Anti-Pattern Scan

Files modified by Phase 18:
- `kinetica_bi/server/src/wkbSpike.ts` (Plan 18-01)
- `kinetica_bi/server/package.json` (Plan 18-01)
- `kinetica_bi/server/src/lib/spatialQuery.ts` (Plan 18-02)
- `kinetica_bi/server/src/lib/radiusConversion.ts` (Plan 18-02)
- `kinetica_bi/server/tests/lib.spatialQuery.spec.ts` (Plan 18-02)
- `kinetica_bi/server/tests/lib.radiusConversion.spec.ts` (Plan 18-02)
- `kinetica_bi/server/src/index.ts` (Plan 18-03)
- `kinetica_bi/server/src/kinetica.ts` (Plan 18-03)
- `kinetica_bi/server/tests/routes.info-query.spec.ts` (Plan 18-03)

No anti-patterns found. Specifically:
- `buildWkbQuery`'s throw is BY DESIGN (deferred-by-tech-debt stub), not a placeholder/TODO
- WKB 501 early-return is BY DESIGN, not stub behavior
- `mapHeightPx` parameter unused in `pxToGroundDistance` is documented in doc-comment for v2 ellipse-radius mode (forward-compat)
- No `console.log`-only handlers
- No empty `return null`/`return {}` placeholders
- No `TODO`/`FIXME`/`XXX` markers in modified source files (only references like `TD-V14-WKB-SPIKE` which are tracked tech-debt IDs)

## Commit Verification

All Phase 18 commits referenced in SUMMARYs are present:
- `15714e3` (feat): wkb-spike runner v1
- `d458408` (fix): wkb-spike runner production-payload parity
- `0f8237d`, `6cb4a1c`, `c5fd4d5`, `054e188`, `b011854`, `cfce9ea` (docs): Plan 18-01 close-out commits
- `60c18fe` (test), `77a92ae` (feat), `ee87e6a` (test), `a6f9754` (feat), `6da9187` (docs): Plan 18-02
- `681ef7c` (test), `4ef4632` (feat): Plan 18-03

## Gaps Summary

**No gaps found.** Phase 18 ships exactly the partial-scope contract locked on 2026-05-08:

- SPATIAL-V14-01 (lat/lon) — Complete
- SPATIAL-V14-02 (WKT) — Complete
- SPATIAL-V14-03 (WKB) — Deferred to TD-V14-WKB-SPIKE (locked decision; runner preserved at `d458408` for future re-run when WKB-binary column access becomes available)
- SPATIAL-V14-04 (endpoint) — Complete
- SPATIAL-V14-05 (server-side radius conversion) — Complete

The deferral is **NOT a gap** — it is the planned outcome of Plan 18-01's spike protocol (`NONE_ESCALATE → TECH_DEBT`) and is consistently documented across PROJECT.md, STATE.md, REQUIREMENTS.md, ROADMAP.md, and 18-SPIKE-NOTES.md.

All five Phase 18 success criteria from ROADMAP.md are satisfied. All 45 vitest tests across the three Phase 18 spec files pass. `tsc --noEmit` is clean.

## Human Verification (Optional)

The phase has full automated coverage. The only items that COULD benefit from a human end-to-end smoke test (but are NOT required for verification, since automated unit + integration coverage proves the contract):

1. **Real-Kinetica end-to-end smoke** (optional)
   - Test: With server running and `.env` configured, POST `/api/info/query` with a real lat/lon click against `demo.nyctaxi`
   - Expected: 200 with up to 50 rows ordered by GEODIST distance
   - Why optional: Plan 18-02 + 18-03 cover SQL-shape and HTTP-handling correctness via mocks; the per-user kineticaSql + auth.ts buildAuthHeader path is exercised by `routes.filter-materialize.spec.ts` (proven 23/23 against the same Kinetica SQL endpoint contract)

2. **Frontend Phase 21 integration** (deferred — not Phase 18 scope)
   - Test: When Phase 21 ships `MapChartRenderer` click handler, verify the locked request/response contract matches end-to-end
   - Why deferred: Phase 18 is backend-only by design; Phase 21 will integration-test the consumer

---

_Verified: 2026-05-08T05:05:00Z_
_Verifier: Claude (gsd-verifier)_
