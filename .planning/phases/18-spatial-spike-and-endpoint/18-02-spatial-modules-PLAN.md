---
phase: 18-spatial-spike-and-endpoint
plan: 02
type: execute
wave: 2
depends_on: [18-01]
files_modified:
  - kinetica_bi/server/src/lib/spatialQuery.ts
  - kinetica_bi/server/src/lib/radiusConversion.ts
  - kinetica_bi/server/tests/lib.spatialQuery.spec.ts
  - kinetica_bi/server/tests/lib.radiusConversion.spec.ts
autonomous: true
requirements:
  - SPATIAL-V14-01
  - SPATIAL-V14-02
  - SPATIAL-V14-05
must_haves:
  truths:
    - "kinetica_bi/server/src/lib/spatialQuery.ts exports three SQL builders: buildLatLonQuery, buildWktQuery, buildWkbQuery. buildLatLonQuery + buildWktQuery return SQL strings; buildWkbQuery throws NotImplementedError (see below)."
    - "buildLatLonQuery + buildWktQuery embed LIMIT 50 OFFSET (page * 50) and ORDER BY <distance_expr> ASC for stable pagination per SPATIAL-V14-04"
    - "buildWkbQuery throws NotImplementedError(\"WKB mode deferred — see TD-V14-WKB-SPIKE\") because Plan 18-01 resolved NONE_ESCALATE → TECH_DEBT. The function signature still exports for type-stability so Plan 18-03 can route by spatialMode without conditional imports."
    - "kinetica_bi/server/src/lib/radiusConversion.ts exports pxToGroundDistance(radiusPx, mapBbox, mapWidthPx, mapHeightPx, clickLat) returning a positive ground-distance value derived without any client-side trigonometry"
    - "Both modules are pure (zero imports beyond Node stdlib) — no Express, no db, no kinetica.ts dependencies; mirrors whereClause.ts and viewNaming.ts pattern from Phase 13"
    - "Unit tests cover each SQL builder's verbatim output and pxToGroundDistance proportional behavior across two zoom levels"
    - "vitest run on lib.spatialQuery.spec.ts and lib.radiusConversion.spec.ts both exit 0"
  artifacts:
    - path: "kinetica_bi/server/src/lib/spatialQuery.ts"
      provides: "Three SQL builders (buildLatLonQuery, buildWktQuery, buildWkbQuery) + SpatialQueryArgs type — Plan 18-03 endpoint imports these"
      exports: ["buildLatLonQuery", "buildWktQuery", "buildWkbQuery", "SpatialQueryArgs", "SpatialMode"]
      min_lines: 80
    - path: "kinetica_bi/server/src/lib/radiusConversion.ts"
      provides: "pxToGroundDistance — Plan 18-03 endpoint imports this to convert radiusPx to a ground-distance threshold for the SQL WHERE clause"
      exports: ["pxToGroundDistance"]
      min_lines: 40
    - path: "kinetica_bi/server/tests/lib.spatialQuery.spec.ts"
      provides: "Unit-test coverage of all three SQL builders' verbatim SQL output"
      contains: "buildLatLonQuery, buildWktQuery, buildWkbQuery"
    - path: "kinetica_bi/server/tests/lib.radiusConversion.spec.ts"
      provides: "Unit-test coverage of pxToGroundDistance — verifies non-zero positive output AND proportional output between two zoom levels"
      contains: "pxToGroundDistance"
  key_links:
    - from: "kinetica_bi/server/src/lib/spatialQuery.ts buildWkbQuery"
      to: ".planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md ## Decision"
      via: "Spike landed NONE_ESCALATE → TECH_DEBT; buildWkbQuery throws NotImplementedError pending TD-V14-WKB-SPIKE re-run"
      pattern: "TD-V14-WKB-SPIKE|NotImplementedError|WkbDeferredError"
    - from: "kinetica_bi/server/src/lib/spatialQuery.ts"
      to: "kinetica_bi/server/src/index.ts (Plan 18-03)"
      via: "Plan 18-03 imports buildLatLonQuery / buildWktQuery / buildWkbQuery and routes by spatialMode"
      pattern: "import.*spatialQuery"
    - from: "kinetica_bi/server/src/lib/radiusConversion.ts"
      to: "kinetica_bi/server/src/index.ts (Plan 18-03)"
      via: "Plan 18-03 imports pxToGroundDistance and threads its return value into the SQL WHERE clause"
      pattern: "import.*radiusConversion"
---

<objective>
Build two pure server-side modules that Plan 18-03 will compose into the `POST /api/info/query` route handler:
1. `kinetica_bi/server/src/lib/spatialQuery.ts` — three SQL builders (buildLatLonQuery, buildWktQuery, buildWkbQuery), one per spatial mode, each producing a Kinetica-ready SQL string with `LIMIT 50 OFFSET (page * 50) ORDER BY <distance_expr> ASC`.
2. `kinetica_bi/server/src/lib/radiusConversion.ts` — `pxToGroundDistance(radiusPx, mapBbox, mapWidthPx, mapHeightPx, clickLat)` that converts the click radius from pixels to a ground-distance threshold (server-side, no client trig).

Purpose: Decouple SQL generation and radius math from the route handler so each is unit-testable in isolation (mirrors the v1.3 `whereClause.ts` + `viewNaming.ts` pattern). SPATIAL-V14-01 (lat/lon GEODIST), SPATIAL-V14-02 (WKT STXY_DISTANCE), and SPATIAL-V14-05 (radius conversion) are fully covered by this plan. SPATIAL-V14-03 (WKB) is covered IFF the 18-01 spike PASSED with PROBE_A | PROBE_B | PROBE_C.

Output: Two pure TypeScript modules + their corresponding vitest specs, all type-checking and all tests green.

Pattern model: `kinetica_bi/server/src/lib/whereClause.ts` (server-side type-duplication, pure module, no frontend imports) + `kinetica_bi/server/src/lib/viewNaming.ts` (deterministic builder, no Date.now/randomness).
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

# Spike outcome (REQUIRED — buildWkbQuery copies the verbatim SQL template from this file)
@.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md
@.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-SUMMARY.md

# Pattern references
@kinetica_bi/server/src/lib/whereClause.ts
@kinetica_bi/server/src/lib/viewNaming.ts
@kinetica_bi/server/tests/lib.whereClause.spec.ts
@kinetica_bi/server/tests/lib.viewNaming.spec.ts

<interfaces>
<!-- Existing types in the codebase that this plan REFERENCES (does NOT import — server type duplication per AP) -->

From kinetica_bi/src/lib/wmsUrlBuilder.ts (frontend — for reference only; do NOT import):
```typescript
type SpatialMode = "latlon" | "wkt" | "wkb";

type MapWidgetConfig = {
  // ... omitted ...
  spatialMode: SpatialMode;
  latColumn?: string;     // for spatialMode="latlon"
  lonColumn?: string;     // for spatialMode="latlon"
  wktColumn?: string;     // for spatialMode="wkt"
  wkbColumn?: string;     // for spatialMode="wkb"
};
```

From kinetica_bi/server/src/lib/whereClause.ts (server — pattern reference):
```typescript
export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  sourceWidgetId?: number;
  addedAt: number;
};
// Pure module — zero imports beyond Node stdlib
```

NEW types this plan EXPORTS from spatialQuery.ts:
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";

export type SpatialColumns = {
  // exactly one of these populated based on spatialMode (the route handler validates upstream)
  lonCol?: string;       // spatialMode="latlon"
  latCol?: string;       // spatialMode="latlon"
  wktCol?: string;       // spatialMode="wkt"
  wkbCol?: string;       // spatialMode="wkb"
};

export type SpatialQueryArgs = {
  schema: string;        // e.g. "ki_home"
  table: string;         // e.g. "nyctaxi"
  spatialColumns: SpatialColumns;
  clickLon: number;
  clickLat: number;
  radiusGroundDistance: number;  // OUTPUT of radiusConversion.pxToGroundDistance — same units as the distance expr (degrees-equivalent for STXY_DISTANCE; meters for GEODIST). Doc-comment specifies which unit per builder.
  page: number;          // 0-indexed; SQL emits OFFSET (page * 50)
};
```

Each builder returns `string` — the SQL is Kinetica-ready (no further interpolation needed by the caller). Trust boundary: column names + schema + table are inserted directly without quoting (mirrors whereClause.ts comment about admin-only metadata sources). Click coordinates and radius are ALWAYS numbers (typeof check at the boundary in Plan 18-03), so no string escaping is needed for those.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build spatialQuery.ts module + spec</name>
  <files>kinetica_bi/server/src/lib/spatialQuery.ts, kinetica_bi/server/tests/lib.spatialQuery.spec.ts</files>
  <read_first>
    - .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md (REQUIRED — read ## Decision section. Spike landed NONE_ESCALATE → TECH_DEBT (TD-V14-WKB-SPIKE); buildWkbQuery throws by design — DO NOT invent a SQL template.)
    - .planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-SUMMARY.md (REQUIRED — confirms outcome and locks the throws-by-design decision)
    - kinetica_bi/server/src/lib/whereClause.ts (PATTERN — pure module, server-side type duplication, doc-comment trust-boundary disclosure)
    - kinetica_bi/server/src/lib/viewNaming.ts (PATTERN — deterministic builder, no Date.now, doc-comment shape contract)
    - kinetica_bi/server/tests/lib.whereClause.spec.ts (PATTERN — vitest spec layout, verbatim-SQL-string assertions)
  </read_first>
  <behavior>
    - Test 1: buildLatLonQuery({ schema:"ki_home", table:"events", spatialColumns:{lonCol:"lon", latCol:"lat"}, clickLon:-73.95, clickLat:40.75, radiusGroundDistance:500, page:0 }) returns a SQL string containing exactly: "SELECT * FROM ki_home.events WHERE GEODIST(lon, lat, -73.95, 40.75) <= 500 ORDER BY GEODIST(lon, lat, -73.95, 40.75) ASC LIMIT 50 OFFSET 0"
    - Test 2: buildLatLonQuery with page=2 emits "OFFSET 100" (i.e. page * 50)
    - Test 3: buildWktQuery({ schema:"demo", table:"shapes", spatialColumns:{wktCol:"geom"}, clickLon:-73.95, clickLat:40.75, radiusGroundDistance:0.01, page:0 }) returns a SQL string containing exactly: "SELECT * FROM demo.shapes WHERE STXY_DISTANCE(geom, -73.95, 40.75) <= 0.01 ORDER BY STXY_DISTANCE(geom, -73.95, 40.75) ASC LIMIT 50 OFFSET 0" — note the lock from CONTEXT.md: NO ST_GEOMFROMTEXT wrapping for WKT mode (raw x, y per SPATIAL-V14-02).
    - Test 4: buildWkbQuery({ schema:"ki_home", table:"layers", spatialColumns:{wkbCol:"geom"}, clickLon:-73.95, clickLat:40.75, radiusGroundDistance:500, page:1 }) THROWS NotImplementedError (or WkbDeferredError) with message containing 'TD-V14-WKB-SPIKE'. The throw path is asserted via `expect(() => buildWkbQuery({...})).toThrow(/TD-V14-WKB-SPIKE/)`. NO SQL string is returned — Plan 18-01 resolved NONE_ESCALATE → TECH_DEBT; the function exists for type stability only.
    - Test 5: All three builders emit "ORDER BY ... ASC" (ascending distance — closest first per SPATIAL-V14-04)
    - Test 6: All three builders embed `LIMIT 50` (per-page limit per SPATIAL-V14-04 endpoint shape lock)
    - Test 7 (SQL injection edge case): if `schema` contains a dot or `table` contains a space, the builder still produces a string (no throw) — column/schema/table interpolation is documented as admin-trusted in the doc-comment; values are typeof-numbers and never string-interpolated.
    - Test 8: SpatialMode union type is exported (verified by `import type { SpatialMode } from ...; const m: SpatialMode = "latlon";` compiling clean)
  </behavior>
  <action>
    Create `kinetica_bi/server/src/lib/spatialQuery.ts` as a pure module mirroring whereClause.ts structure.

    REQUIRED EXPORTS (copy types from <interfaces> block above verbatim):
      export type SpatialMode
      export type SpatialColumns
      export type SpatialQueryArgs
      export function buildLatLonQuery(args: SpatialQueryArgs): string
      export function buildWktQuery(args: SpatialQueryArgs): string
      export function buildWkbQuery(args: SpatialQueryArgs): string

    HEADER DOC-COMMENT (mirror whereClause.ts:1-23 style — explain trust boundary, pure-module status, and reference 18-SPIKE-NOTES.md for the WKB decision).

    SQL TEMPLATES — exact strings:

    buildLatLonQuery (SPATIAL-V14-01):
      const distExpr = `GEODIST(${a.spatialColumns.lonCol}, ${a.spatialColumns.latCol}, ${a.clickLon}, ${a.clickLat})`;
      return `SELECT * FROM ${a.schema}.${a.table} WHERE ${distExpr} <= ${a.radiusGroundDistance} ORDER BY ${distExpr} ASC LIMIT 50 OFFSET ${a.page * 50}`;

    buildWktQuery (SPATIAL-V14-02 — locked: NO ST_GEOMFROMTEXT wrap):
      const distExpr = `STXY_DISTANCE(${a.spatialColumns.wktCol}, ${a.clickLon}, ${a.clickLat})`;
      return `SELECT * FROM ${a.schema}.${a.table} WHERE ${distExpr} <= ${a.radiusGroundDistance} ORDER BY ${distExpr} ASC LIMIT 50 OFFSET ${a.page * 50}`;

    buildWkbQuery (SPATIAL-V14-03 — DEFERRED, throws NotImplementedError):
      Plan 18-01 resolved `NONE_ESCALATE → TECH_DEBT (TD-V14-WKB-SPIKE)` on 2026-05-08 — see `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md ## Decision`. Operator has no WKB-binary column reachable; the spike could not characterize the WKB code path. Until a future spike round closes TD-V14-WKB-SPIKE, buildWkbQuery is a deferred-by-design stub.

      Implementation: throw a clear error referencing the TD entry. Either re-use Node's stdlib pattern (`throw new Error("...")`) or define a small `WkbDeferredError extends Error` class in the same file for grep-ability. The function signature stays exported so Plan 18-03 can route by `spatialMode` without conditional imports.

      Code stub:
        // SPATIAL-V14-03 — DEFERRED to TD-V14-WKB-SPIKE.
        // Plan 18-01 spike landed NONE_ESCALATE → TECH_DEBT (operator has no WKB-binary column
        // reachable; runner-bug-tainted first run + WKT-typed fixture column prevented characterization).
        // See 18-SPIKE-NOTES.md ## Decision. When TD-V14-WKB-SPIKE re-run lands, replace this throw
        // with the spike-locked SQL template and update the spec assertion accordingly.
        export class WkbDeferredError extends Error {
          constructor() {
            super("WKB mode deferred — TD-V14-WKB-SPIKE");
            this.name = "WkbDeferredError";
          }
        }
        export function buildWkbQuery(_args: SpatialQueryArgs): string {
          throw new WkbDeferredError();
        }

      Notes:
      - Argument param is prefixed `_` (or fully unused) — TS strict-mode tsc tolerates unused-prefixed params; alternatively, omit the arg and use `(_: SpatialQueryArgs)`.
      - The function MUST still be `export function buildWkbQuery(args: SpatialQueryArgs): string` (or the underscore variant) so the type signature matches buildLatLonQuery / buildWktQuery for consistent routing in Plan 18-03.
      - Do NOT delete the `wkb` member from `SpatialMode` union or the `wkbCol?: string` field from `SpatialColumns` — request validation in Plan 18-03 still accepts the wkb path (and 501s before invoking the builder).

    DOC-COMMENT NOTES per builder:
    - buildLatLonQuery: GEODIST returns meters per Kinetica docs; radiusGroundDistance MUST be passed in meters.
    - buildWktQuery: STXY_DISTANCE returns the same SRS-units as the WKT geometry's stored SRS (typically degrees for EPSG:4326). radiusGroundDistance MUST be in those same units. Plan 18-03's pxToGroundDistance returns degrees-equivalent for WKT mode.
    - buildWkbQuery: Throws by design — see TD-V14-WKB-SPIKE. Doc-comment must reference 18-SPIKE-NOTES.md ## Decision (NONE_ESCALATE outcome) so a future re-run agent has a clear pointer to replace the throw with a spike-locked SQL template.

    Then create `kinetica_bi/server/tests/lib.spatialQuery.spec.ts` with the 8 tests from <behavior> above. Use vitest's `expect(...).toBe(...)` for verbatim string assertions on the SQL output.

    Anti-patterns to avoid:
    - Do NOT add `?` placeholders or bound-params arrays — the existing kineticaSql helper takes a raw SQL string (see kinetica.ts:136-236; the body has `statement: sql` with no params field). Inline interpolation is the established pattern.
    - Do NOT escape numeric click coordinates — they are typed as `number` in SpatialQueryArgs; the route handler in 18-03 validates `typeof === "number"` before calling.
    - Do NOT add try/catch in buildLatLonQuery / buildWktQuery — pure functions throw nothing. (buildWkbQuery throws BY DESIGN — that's the deferred-stub contract.)
    - Do NOT import from kineticaErrors / auth / db / kinetica.ts — pure module, zero internal imports (mirrors whereClause.ts + viewNaming.ts).
    - Do NOT invent a buildWkbQuery SQL template — spike landed NONE_ESCALATE → TECH_DEBT. Throw `WkbDeferredError` (or equivalent) referencing TD-V14-WKB-SPIKE.
    - Do NOT delete the `wkb` member of `SpatialMode` union or the `wkbCol?: string` field of `SpatialColumns` — Plan 18-03 still validates the wkb path before 501-ing.
    - Do NOT remove the `buildWkbQuery` export — Plan 18-03 imports the symbol for type stability and routes by `spatialMode` (with an early-return 501 BEFORE calling the throwing stub).
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/lib/spatialQuery.ts` exists
    - File exports: `SpatialMode`, `SpatialColumns`, `SpatialQueryArgs`, `buildLatLonQuery`, `buildWktQuery`, `buildWkbQuery` (verified via grep `^export`)
    - File contains literal substring `GEODIST` in buildLatLonQuery
    - File contains literal substring `STXY_DISTANCE` in buildWktQuery (NO `ST_GEOMFROMTEXT` in buildWktQuery — locked decision)
    - buildWkbQuery throws NotImplementedError or WkbDeferredError; spec asserts the error path; no SQL template assertion (spike landed NONE_ESCALATE → TECH_DEBT, see 18-SPIKE-NOTES.md ## Decision)
    - File contains the literal substring "TD-V14-WKB-SPIKE" (in the buildWkbQuery throw message and/or doc-comment)
    - File contains zero non-stdlib imports (`grep -E "^import" spatialQuery.ts` returns no lines OR only `import type` lines from within the same file's exports — pure module status)
    - File `kinetica_bi/server/tests/lib.spatialQuery.spec.ts` exists with 8 test cases per <behavior>
    - `cd kinetica_bi/server && npx vitest run tests/lib.spatialQuery.spec.ts` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` passes
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/lib.spatialQuery.spec.ts --reporter=verbose && grep -c "^export" src/lib/spatialQuery.ts | awk '$1 >= 6 {exit 0} {exit 1}'</automated>
  </verify>
  <done>spatialQuery.ts exports all required builders + types; buildWkbQuery uses the spike-locked SQL template verbatim; spec passes 100%; tsc --noEmit clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build radiusConversion.ts module + spec</name>
  <files>kinetica_bi/server/src/lib/radiusConversion.ts, kinetica_bi/server/tests/lib.radiusConversion.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/lib/whereClause.ts (PATTERN — pure module, doc-comment shape contract)
    - kinetica_bi/server/tests/lib.viewNaming.spec.ts (PATTERN — vitest spec for a pure deterministic helper)
    - .planning/REQUIREMENTS.md (re-read SPATIAL-V14-05 — confirm the input parameters and output unit contract)
  </read_first>
  <behavior>
    - Test 1: pxToGroundDistance(20, [-74.05, 40.63, -73.75, 40.85], 800, 600, 40.75) returns a positive number > 0 (sanity — does not throw, returns ground distance for a 20px radius at NYC zoom)
    - Test 2: Doubling radiusPx (40 instead of 20) doubles the output (linear in radiusPx; same bbox/widthPx/clickLat)
    - Test 3: At the SAME radiusPx and clickLat but a 4x-zoomed-in bbox (one-quarter the bbox width and height; same center), the output is APPROXIMATELY 1/4 the size — proves zoom proportionality (SPATIAL-V14-05 success criterion 5: "issuing the same click at two different zoom levels and observing proportionally different record counts")
    - Test 4: clickLat=0 (equator) yields a LARGER ground distance than clickLat=80 (high latitude) for the same radiusPx + bbox + widthPx — proves the haversine cosine-of-latitude correction is applied (longitude degrees shrink toward the poles)
    - Test 5: Returns a finite, non-NaN, non-Infinity number for all valid inputs
    - Test 6: pxToGroundDistance(0, ...) returns 0 (degenerate case — zero radius pixels = zero ground distance)
  </behavior>
  <action>
    Create `kinetica_bi/server/src/lib/radiusConversion.ts` as a pure module.

    REQUIRED EXPORT:
      export function pxToGroundDistance(
        radiusPx: number,
        mapBbox: [number, number, number, number],  // [minLon, minLat, maxLon, maxLat] — Web Mercator bbox extent
        mapWidthPx: number,
        mapHeightPx: number,
        clickLat: number,
      ): number

    MATH (server-side, no client trig — locks SPATIAL-V14-05):
      Step 1: Compute the bbox width in degrees:
        const bboxWidthDeg = mapBbox[2] - mapBbox[0];
      Step 2: Compute the radius as a fraction of the map's pixel width, then map that to a fraction of bbox-width-in-degrees:
        const radiusDeg = (radiusPx / mapWidthPx) * bboxWidthDeg;
      Step 3: Convert degrees to ground meters using a haversine-style approximation centered on clickLat:
        // 1 degree of latitude ≈ 111_320 meters (constant)
        // 1 degree of longitude at latitude φ ≈ 111_320 * cos(φ) meters
        // We approximate the click radius as a longitude-degree distance at clickLat
        // (the bbox width is a longitude span; the radius derived from it inherits longitude-degree units)
        const latRad = (clickLat * Math.PI) / 180;
        const metersPerDegLon = 111_320 * Math.cos(latRad);
        const radiusMeters = radiusDeg * metersPerDegLon;
        return Math.max(0, radiusMeters);  // floor at 0 to avoid negative values from edge-case floating-point

    DOC-COMMENT requirements:
    - File header explains: server-side conversion of click radius pixels to ground meters; mirrors v1.3 whereClause.ts pure-module pattern.
    - Function doc-comment specifies:
        - INPUT units: radiusPx (pixels), mapBbox (degrees, EPSG:4326-style [minLon, minLat, maxLon, maxLat]), mapWidthPx/mapHeightPx (pixels), clickLat (degrees).
        - OUTPUT unit: meters.
        - LIMITATION: Approximation — assumes mapBbox is small enough that the longitude-degree-to-meter ratio is roughly constant across the bbox (acceptable for v1.4 typical zoom levels; degrades at world view).
        - WHY clickLat is required: longitude degrees compress toward the poles (cos(latitude) factor); ignoring this would over-estimate ground distance at high latitudes.
        - mapHeightPx is currently unused (longitude-aspect dominates radius math); accepted for forward-compat with a future "ellipse radius" mode (v2). Document this so a Phase-checker doesn't flag it as dead.
    - Doc-comment notes that buildLatLonQuery (which uses GEODIST) consumes the meters output directly. buildWktQuery and buildWkbQuery (which use STXY_DISTANCE / ST_DISTANCE) operate in degrees-equivalent SRS units — Plan 18-03 must convert meters back to degrees for those modes (radiusDeg = radiusMeters / metersPerDegLon, OR Plan 18-03 separates the math by mode). Suggest in the doc-comment that Plan 18-03 either: (a) adds a sibling `pxToGroundDegrees()` for STXY_DISTANCE consumers, OR (b) Plan 18-03 divides the meters output by 111320*cos(clickLat*PI/180) when calling buildWktQuery/buildWkbQuery.

    OPTIONAL: Also export `pxToGroundDegrees(radiusPx, mapBbox, mapWidthPx)` returning radiusDeg directly (steps 1-2 only, skipping the meters conversion). This makes Plan 18-03 cleaner — pick the right helper per spatialMode. Adds ~5 lines and avoids divide-then-multiply round-tripping.

    Anti-patterns to avoid:
    - Do NOT use trig libraries — Math.cos and Math.PI are built into V8.
    - Do NOT throw on degenerate inputs — return 0 for radiusPx=0; let the caller handle widthPx=0 (would Infinity, but caller validates upstream).
    - Do NOT add try/catch.
    - Do NOT import anything; pure module.

    Then create `kinetica_bi/server/tests/lib.radiusConversion.spec.ts` with the 6 tests from <behavior>. For Test 3 (zoom proportionality), assert `expect(zoomedIn).toBeCloseTo(zoomedOut / 4, 0)` — closeness to 0 decimal places (i.e. within ~0.5 units) accommodates floating-point noise + cos(lat) variations.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/lib/radiusConversion.ts` exists and exports `pxToGroundDistance` (and optionally `pxToGroundDegrees`)
    - File contains literal substring `Math.cos` (haversine-style cos correction is applied)
    - File contains literal substring `111_320` OR `111320` (constant for meters per degree of latitude)
    - File has zero imports (`grep -E "^import" radiusConversion.ts` returns no lines)
    - File `kinetica_bi/server/tests/lib.radiusConversion.spec.ts` exists with 6 test cases per <behavior>
    - `cd kinetica_bi/server && npx vitest run tests/lib.radiusConversion.spec.ts` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` passes
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run tests/lib.radiusConversion.spec.ts --reporter=verbose && grep -q "Math.cos" src/lib/radiusConversion.ts && grep -E "111[_]?320" src/lib/radiusConversion.ts</automated>
  </verify>
  <done>radiusConversion.ts exports pxToGroundDistance with haversine-corrected cos(lat) math; spec passes 100%; tsc --noEmit clean; doc-comment specifies output unit (meters) and the degrees-equivalent helper question for Plan 18-03's WKT/WKB consumers.</done>
</task>

</tasks>

<verification>
- spatialQuery.ts and radiusConversion.ts are committed; both pure modules with zero non-stdlib imports
- spec files for both modules exist and pass 100%
- buildWkbQuery throws NotImplementedError / WkbDeferredError with message containing "TD-V14-WKB-SPIKE" (Plan 18-01 NONE_ESCALATE outcome)
- buildLatLonQuery + buildWktQuery emit `LIMIT 50 OFFSET (page * 50) ORDER BY <distance_expr> ASC` (per SPATIAL-V14-04 endpoint contract)
- pxToGroundDistance produces proportional output across two zoom levels (SPATIAL-V14-05 success criterion 5 covered at unit-test level — Plan 18-03 covers it at integration-test level)
- tsc --noEmit clean
</verification>

<success_criteria>
- SPATIAL-V14-01 implemented: buildLatLonQuery uses GEODIST(lon_col, lat_col, click_lon, click_lat)
- SPATIAL-V14-02 implemented: buildWktQuery uses STXY_DISTANCE(wkt_col, click_lon, click_lat) — NO ST_GEOMFROMTEXT
- SPATIAL-V14-03 deferred (TD-V14-WKB-SPIKE) — buildWkbQuery throws by design; spec covers the throw path; no SQL template assertion
- SPATIAL-V14-05 implemented: pxToGroundDistance with mapBbox + mapWidthPx + mapHeightPx + clickLat — server-side, no client trig
- All four requirement IDs above appear in this plan's `requirements` frontmatter (SPATIAL-V14-03 is also in 18-01 since the spike is the discovery; this plan is the implementation)
- Plan 18-03 can now import these modules without further codebase exploration
</success_criteria>

<output>
After completion, create `.planning/phases/18-spatial-spike-and-endpoint/18-02-spatial-modules-SUMMARY.md` summarizing:
- The 3 SQL builders' final SQL templates (verbatim)
- The chosen WKB pattern (PROBE_A/B/C from 18-01) reflected in buildWkbQuery
- pxToGroundDistance math (degrees → meters via cos(lat) correction)
- Whether `pxToGroundDegrees` was also exported (helper for STXY_DISTANCE / ST_DISTANCE consumers in Plan 18-03)
- Pass/fail status of both spec files
</output>
</content>
