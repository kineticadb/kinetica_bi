---
phase: 26-server-spatial-where
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/lib/spatialWhereClause.ts
  - kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts
autonomous: true
requirements:
  - WHERE-V15-01
  - WHERE-V15-02
gap_closure: false

# NOTE: REQUIREMENTS.md WHERE-V15-01 says ST_WITHIN for WKT mode — STALE.
# Phase 25 spike rejected ST_WITHIN (returned 0 rows; correct semantic, wrong intent).
# Phase 26 uses ST_INTERSECTS for WKT mode per 25-SPIKE-NOTES.md §3.2 + §3.3.
# Kinetica server version: NOT YET CAPTURED. Run `SHOW SYSTEM PROPERTIES`
# against http://172.31.0.22:8082/gpudb-0 before merge and record version here.

must_haves:
  truths:
    - "buildSpatialOrBlock([], anyTarget) returns empty string \"\""
    - "buildSpatialOrBlock([single shape], latlonTarget) returns (STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1) WITH outer parens"
    - "buildSpatialOrBlock([2 shapes], latlonTarget) returns (pred1 OR pred2) with single space around OR and outer parens"
    - "buildSpatialOrBlock([single shape], wktTarget) uses ST_INTERSECTS (NOT ST_WITHIN)"
    - "buildSpatialOrBlock(anyShapes, wkbTarget) throws SpatialFilterWkbDeferredError"
    - "Single quotes in shape.wkt are doubled before interpolation (SQL escape)"
    - "Identifiers (lonCol/latCol/spatialCol) are interpolated raw (admin trust boundary)"
    - "composeWhereClause(filters, [], null) returns column AND-chain with no extra wrapping"
    - "composeWhereClause(filters, shapes, target) returns (spatial_OR) AND (col_AND) with both sides parenthesized"
    - "composeWhereClause([], shapes, target) returns (spatial_OR) bare"
    - "composeWhereClause([], [], null) returns \"1=1\""
    - "composeWhereClause([1 col filter], [2 shapes], latlonTarget) returns the EXACT string (STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')"
  artifacts:
    - path: "kinetica_bi/server/src/lib/spatialWhereClause.ts"
      provides: "buildSpatialOrBlock + composeWhereClause + types + SpatialFilterWkbDeferredError"
      exports:
        - "buildSpatialOrBlock"
        - "composeWhereClause"
        - "SpatialFilter"
        - "SpatialTarget"
        - "SpatialMode"
        - "SpatialFilterWkbDeferredError"
    - path: "kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts"
      provides: "Unit tests asserting V15-P-07 paren invariant + 4-case composeWhereClause"
      contains: "STXY_WITHIN"
  key_links:
    - from: "kinetica_bi/server/src/lib/spatialWhereClause.ts"
      to: "kinetica_bi/server/src/lib/whereClause.ts"
      via: "import escapeKineticaStringLiteral + buildServerWhereClause + ActiveFilter type"
      pattern: "import .* from \"./whereClause\""
---

<objective>
Create the pure server module `kinetica_bi/server/src/lib/spatialWhereClause.ts` exporting `buildSpatialOrBlock(shapes, target)` and `composeWhereClause(filters, shapes, target)`, plus types `SpatialFilter` / `SpatialTarget` / `SpatialMode` and class `SpatialFilterWkbDeferredError`. Ship unit tests asserting the V15-P-07 paren-correctness invariant (single-shape AND multi-shape) and all four cases of `composeWhereClause`.

Purpose: Phase 25 PASS authorized this builder. The V15-P-07 silent-multi-shape regression must be locked out BEFORE any multi-shape UI lands (Phase 29). Unit-level paren assertions are load-bearing.

Output: Two files — pure module + spec — committed to git. Plan 02 (materialize-endpoint) imports `composeWhereClause` and types.
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
@.planning/phases/26-server-spatial-where/26-CONTEXT.md
@.planning/phases/26-server-spatial-where/26-RESEARCH.md
@.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md
@kinetica_bi/server/src/lib/whereClause.ts
@kinetica_bi/server/src/lib/spatialQuery.ts
@kinetica_bi/server/tests/lib.whereClause.spec.ts

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->

From kinetica_bi/server/src/lib/whereClause.ts:
```typescript
export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  sourceWidgetId?: number;
  addedAt: number;
};
export function escapeKineticaStringLiteral(val: string): string;
export function buildServerWhereClause(filters: ActiveFilter[]): string;
// buildServerWhereClause([]) === "1=1" (the empty-filters fallback)
```

From kinetica_bi/server/src/lib/spatialQuery.ts (PATTERN SOURCE ONLY — do NOT import):
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";
// SpatialQuery has its own WkbDeferredError class; Phase 26 defines a SEPARATE
// SpatialFilterWkbDeferredError class for grep-stability and module purity.
```

Locked SQL templates (from 25-SPIKE-NOTES.md §3.3):
```
LATLON:  STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT('<escaped_wkt>')) = 1
WKT:     ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT('<escaped_wkt>')) = 1
WKB:     throws SpatialFilterWkbDeferredError
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create spatialWhereClause.ts pure module (buildSpatialOrBlock + composeWhereClause + types)</name>
  <files>kinetica_bi/server/src/lib/spatialWhereClause.ts</files>

  <read_first>
    BEFORE writing any code, read these files in this order:
    1. kinetica_bi/server/src/lib/whereClause.ts — copy the module-doc-comment style, the trust-boundary statement, and import the existing `escapeKineticaStringLiteral`, `buildServerWhereClause`, and `ActiveFilter` type.
    2. kinetica_bi/server/src/lib/spatialQuery.ts — pattern source for SpatialMode type + WkbDeferredError class style + trust-boundary comment style. Do NOT import from this file; spatialWhereClause.ts defines its own SpatialMode locally (no cross-module dependency for a trivial type union).
    3. .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §3.3 + §5 — the exact SQL templates and argument-order locks.
    4. .planning/phases/26-server-spatial-where/26-CONTEXT.md §"buildSpatialOrBlock contract" + §"composeWhereClause contract" + §"Server-side type slices".
    5. .planning/phases/26-server-spatial-where/26-RESEARCH.md §3 "Builder Design" — full implementation spec.
  </read_first>

  <behavior>
    Test expectations encoded in Task 2 spec (lib.spatialWhereClause.spec.ts):

    Pure types + class:
    - `SpatialMode` is `"latlon" | "wkt" | "wkb"` (defined locally; do NOT import from spatialQuery.ts)
    - `SpatialFilter` has shape `{ id: string; wkt: string }`
    - `SpatialTarget` has shape `{ tableId: number; spatialMode: SpatialMode; lonCol?: string; latCol?: string; spatialCol?: string }`
    - `SpatialFilterWkbDeferredError` extends Error with name "SpatialFilterWkbDeferredError" and message "WKB mode deferred — TD-V14-WKB-SPIKE"

    `buildSpatialOrBlock(shapes, target)`:
    - Empty shapes → returns `""` (empty string)
    - Single shape, latlon mode → returns exact string `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"` (note: outer parens MANDATORY even for single shape — V15-P-07 lock)
    - Two shapes, latlon mode → returns exact string `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1)"` (single space on each side of OR; outer parens)
    - Single shape, wkt mode → returns exact string `"(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('w1')) = 1)"` (uses ST_INTERSECTS — NOT ST_WITHIN; 25-SPIKE-NOTES §3.2 lock)
    - Single quote inside `shape.wkt` → doubled via `escapeKineticaStringLiteral` (e.g., `wkt: "a'b"` → `ST_GEOMFROMTEXT('a''b')`)
    - WKB mode (any shapes including empty) → throws `SpatialFilterWkbDeferredError`
    - latlon target missing `lonCol` or `latCol` (and shapes.length > 0) → throws plain `Error` with message mentioning "lonCol" and "latCol" (route handler emits 400)
    - wkt target missing `spatialCol` (and shapes.length > 0) → throws plain `Error` mentioning "spatialCol"
    - Identifier names `lonCol`, `latCol`, `spatialCol` are interpolated RAW (no quoting) — admin trust boundary mirrors whereClause.ts:14-21

    `composeWhereClause(filters, shapes, target)`:
    - Signature: `(filters: ActiveFilter[], shapes: SpatialFilter[], target: SpatialTarget | null) => string`
    - Internally calls `buildServerWhereClause(filters)` → `colClause` and `buildSpatialOrBlock(shapes, target)` when target !== null → `spatialClause` (default `""` when target is null)
    - Four cases (output must be EXACT strings):
      - Both: `spatialClause.length > 0 && colClause !== "1=1"` → `"${spatialClause} AND (${colClause})"` — note column side wrapped in extra parens (REQUIREMENTS.md WHERE-V15-02 literal)
      - Spatial only: `spatialClause.length > 0 && colClause === "1=1"` → `spatialClause` (already outer-parenthesized by builder)
      - Column only: `spatialClause === "" && colClause !== "1=1"` → `colClause` (NO extra parens; matches existing v1.3 behavior)
      - Neither: `spatialClause === "" && colClause === "1=1"` → `"1=1"`
    - Load-bearing example for the V15-P-07 test (single ASSERTION case used by Task 2 + Plan 03 supertest):
      Given filters `[{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }]`, shapes `[{ id: "s1", wkt: "w1" }, { id: "s2", wkt: "w2" }]`, target `{ tableId: 1, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }`
      → exact output: `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')`
  </behavior>

  <action>
    Create `kinetica_bi/server/src/lib/spatialWhereClause.ts` as a NEW pure module mirroring the style of `whereClause.ts` + `spatialQuery.ts`. Concrete structure (EXACT — do not paraphrase):

    1. Module doc-comment block at top covering: purpose (spatial WHERE composition for v1.5 materialize endpoint), predicates locked by Phase 25 spike (cite 25-SPIKE-NOTES.md §3.3), explicit V15-P-07 paren invariant statement, identifier-vs-value trust boundary (mirror whereClause.ts:14-21), zero-non-stdlib-import discipline EXCEPT a single import from `./whereClause` for `escapeKineticaStringLiteral`, `buildServerWhereClause`, and `ActiveFilter` type. Note also that `SpatialMode` is defined locally to avoid cross-lib import for a trivial union.

    2. Imports (one line):
    ```typescript
    import { buildServerWhereClause, escapeKineticaStringLiteral, type ActiveFilter } from "./whereClause";
    ```

    3. Types and class (verbatim from 26-CONTEXT.md §"Server-side type slices"):
    ```typescript
    export type SpatialMode = "latlon" | "wkt" | "wkb";

    export type SpatialFilter = {
      id: string;     // audit-log breadcrumb only; builder ignores
      wkt: string;    // EPSG:4326 WKT (Phase 29 OL writer output)
    };

    export type SpatialTarget = {
      tableId: number;
      spatialMode: SpatialMode;
      lonCol?: string;     // required for latlon
      latCol?: string;     // required for latlon
      spatialCol?: string; // required for wkt (and theoretically wkb — unreachable in production)
    };

    export class SpatialFilterWkbDeferredError extends Error {
      constructor() {
        super("WKB mode deferred — TD-V14-WKB-SPIKE");
        this.name = "SpatialFilterWkbDeferredError";
      }
    }
    ```

    4. `buildSpatialOrBlock(shapes, target)` — algorithm:
    ```typescript
    export function buildSpatialOrBlock(
      shapes: SpatialFilter[],
      target: SpatialTarget,
    ): string {
      // WKB mode is unreachable from production (route handler 501 early-returns
      // before calling), but throw as a static guarantee regardless of shape count.
      if (target.spatialMode === "wkb") {
        throw new SpatialFilterWkbDeferredError();
      }

      if (shapes.length === 0) return "";

      // Mode/column coherence — fail-loud (mirrors spatialQuery.ts posture);
      // route handler catches → 400 with detail.
      if (target.spatialMode === "latlon" && (!target.lonCol || !target.latCol)) {
        throw new Error(
          "buildSpatialOrBlock: latlon target requires lonCol and latCol"
        );
      }
      if (target.spatialMode === "wkt" && !target.spatialCol) {
        throw new Error(
          "buildSpatialOrBlock: wkt target requires spatialCol"
        );
      }

      const predicates = shapes.map((shape) => {
        const wkt = escapeKineticaStringLiteral(shape.wkt);
        if (target.spatialMode === "latlon") {
          // Argument order LOCKED by 25-SPIKE-NOTES §5: (lon, lat, shape)
          return `STXY_WITHIN(${target.lonCol}, ${target.latCol}, ST_GEOMFROMTEXT('${wkt}')) = 1`;
        }
        // wkt mode — uses ST_INTERSECTS (NOT ST_WITHIN; spike 25-SPIKE-NOTES §3.2)
        return `ST_INTERSECTS(${target.spatialCol}, ST_GEOMFROMTEXT('${wkt}')) = 1`;
      });

      // V15-P-07 lock: outer parens ALWAYS, even for single shape.
      // Single-shape: "(pred)"; multi-shape: "(pred1 OR pred2 OR ...)"
      return `(${predicates.join(" OR ")})`;
    }
    ```

    5. `composeWhereClause(filters, shapes, target)` — algorithm:
    ```typescript
    export function composeWhereClause(
      filters: ActiveFilter[],
      shapes: SpatialFilter[],
      target: SpatialTarget | null,
    ): string {
      const colClause = buildServerWhereClause(filters); // "1=1" when empty
      const spatialClause = target ? buildSpatialOrBlock(shapes, target) : "";

      const hasSpatial = spatialClause.length > 0;
      const hasCol = colClause !== "1=1";

      // REQUIREMENTS.md WHERE-V15-02 literal: (spatial) AND (col)
      // spatial first, col side wrapped in parens.
      if (hasSpatial && hasCol) return `${spatialClause} AND (${colClause})`;
      if (hasSpatial) return spatialClause;       // already outer-parenthesized
      if (hasCol) return colClause;                // no extra wrapping
      return "1=1";                                // empty-empty fallback
    }
    ```

    Trust boundary / inline doc-comments around each function MUST cite:
    - V15-P-07 paren lock + 25-SPIKE-NOTES §5
    - 25-SPIKE-NOTES §3.1 for STXY_WITHIN argument order
    - 25-SPIKE-NOTES §3.2 for ST_INTERSECTS-vs-ST_WITHIN decision
    - WHERE-V15-02 four-case literal in REQUIREMENTS.md

    Do NOT add any other imports. Do NOT touch any other file in this task.
  </action>

  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/26-01-tsc.txt &amp;&amp; ! grep -q "error TS" /tmp/26-01-tsc.txt</automated>
  </verify>

  <acceptance_criteria>
    - File `kinetica_bi/server/src/lib/spatialWhereClause.ts` exists
    - File contains exact line: `export function buildSpatialOrBlock(`
    - File contains exact line: `export function composeWhereClause(`
    - File contains exact line: `export class SpatialFilterWkbDeferredError extends Error`
    - File contains exact line: `export type SpatialMode = "latlon" | "wkt" | "wkb";`
    - File contains exact substring: `export type SpatialFilter`
    - File contains exact substring: `export type SpatialTarget`
    - File contains substring: `STXY_WITHIN(${target.lonCol}, ${target.latCol}, ST_GEOMFROMTEXT('${wkt}')) = 1`
    - File contains substring: `ST_INTERSECTS(${target.spatialCol}, ST_GEOMFROMTEXT('${wkt}')) = 1`
    - File does NOT contain substring `ST_WITHIN(` (V15-P-07 sibling: stale REQUIREMENTS wording rejected)
    - File contains substring: `predicates.join(" OR ")` AND the result wrapped in outer parens via template literal `\`(${...})\``
    - File imports from `./whereClause` exactly once (escapeKineticaStringLiteral + buildServerWhereClause + ActiveFilter type)
    - File does NOT import from `./spatialQuery` (SpatialMode is defined locally)
    - File does NOT import from `express`, `../db`, `../kinetica`, or `../auth` (pure-module discipline)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0 (no TS errors)
  </acceptance_criteria>

  <done>
    spatialWhereClause.ts compiles, exports the four named symbols + three types, uses ST_INTERSECTS (not ST_WITHIN), always wraps OR-chain in outer parens, imports only escapeKineticaStringLiteral/buildServerWhereClause/ActiveFilter from ./whereClause.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Unit tests for spatialWhereClause.ts (V15-P-07 paren-correctness + 4-case composeWhereClause)</name>
  <files>kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts</files>

  <read_first>
    BEFORE writing the spec, read these files in this order:
    1. kinetica_bi/server/tests/lib.whereClause.spec.ts — copy the import style, the `describe`/`it` block structure, the exact-string-match assertion style (`.toBe(...)` for full strings, not `.toContain(...)`).
    2. kinetica_bi/server/src/lib/spatialWhereClause.ts (output of Task 1) — confirm the exported symbol names and signatures.
    3. .planning/phases/26-server-spatial-where/26-RESEARCH.md §5 "Test Plan" — full assertion list.
    4. .planning/phases/26-server-spatial-where/26-CONTEXT.md §"V15-P-07 paren-correctness regression test" — load-bearing 2-shape + 1-column assertion.
  </read_first>

  <behavior>
    The load-bearing V15-P-07 test asserts the EXACT composed string for a 2-shape + 1-column-filter input:

    Input:
    - filters = `[{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }]`
    - shapes = `[{ id: "s1", wkt: "w1" }, { id: "s2", wkt: "w2" }]`
    - target = `{ tableId: 1, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }`

    Expected EXACT output:
    `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')`

    Note paren structure: outer parens around the OR chain; second pair of parens around the column AND-chain; single AND with single spaces; spatial first, column second.

    Additional required assertions (all use `.toBe(...)` full-string match, NOT `.toContain`):

    1. `buildSpatialOrBlock([], latlonTarget)` → `""`
    2. `buildSpatialOrBlock([{id:"s1",wkt:"w1"}], latlonTarget)` → `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"`
    3. `buildSpatialOrBlock([{id:"s1",wkt:"w1"},{id:"s2",wkt:"w2"}], latlonTarget)` → `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1)"`
    4. `buildSpatialOrBlock([{id:"s1",wkt:"w1"},{id:"s2",wkt:"w2"},{id:"s3",wkt:"w3"}], latlonTarget)` → exact 3-shape string with two ` OR ` separators
    5. `buildSpatialOrBlock([{id:"s1",wkt:"w1"}], wktTarget)` where wktTarget is `{ tableId: 1, spatialMode: "wkt", spatialCol: "geom" }` → `"(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('w1')) = 1)"`
    6. `buildSpatialOrBlock([{id:"s1",wkt:"O'Brien"}], latlonTarget)` → contains `ST_GEOMFROMTEXT('O''Brien')` (single quote doubled — assert via full-string `.toBe`)
    7. `buildSpatialOrBlock([{id:"s1",wkt:"w1"}], { tableId:1, spatialMode:"wkb", spatialCol:"g" })` throws `SpatialFilterWkbDeferredError` with message `"WKB mode deferred — TD-V14-WKB-SPIKE"`
    8. `buildSpatialOrBlock([{id:"s1",wkt:"w1"}], { tableId:1, spatialMode:"latlon" })` (no lonCol/latCol) throws Error with message matching `/lonCol.*latCol|latCol.*lonCol/`
    9. `buildSpatialOrBlock([{id:"s1",wkt:"w1"}], { tableId:1, spatialMode:"wkt" })` (no spatialCol) throws Error with message containing `"spatialCol"`
    10. `composeWhereClause([], [], null)` → `"1=1"`
    11. `composeWhereClause([colFilter], [], null)` → `"zone = 'East Village'"` (column-only, NO extra parens)
    12. `composeWhereClause([], [shape], latlonTarget)` → `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"` (spatial-only, no AND)
    13. `composeWhereClause([colFilter], [shape], latlonTarget)` → `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1) AND (zone = 'East Village')"` (single-shape + column, spatial first, col wrapped)
    14. **LOAD-BEARING V15-P-07 test:** `composeWhereClause([colFilter], [shape1, shape2], latlonTarget)` → exact 2-shape + 1-col string above
    15. `composeWhereClause([], [], latlonTarget)` (zero shapes with target present) → `"1=1"` (zero-shape path-through)
    16. `composeWhereClause([], [shape], { tableId:1, spatialMode:"wkb", spatialCol:"g" })` throws `SpatialFilterWkbDeferredError`
  </behavior>

  <action>
    Create `kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts` mirroring the structure of `kinetica_bi/server/tests/lib.whereClause.spec.ts`. Concrete structure:

    1. Imports (top of file):
    ```typescript
    import { describe, it, expect } from "vitest";
    import {
      buildSpatialOrBlock,
      composeWhereClause,
      SpatialFilterWkbDeferredError,
      type SpatialFilter,
      type SpatialTarget,
    } from "../src/lib/spatialWhereClause";
    import type { ActiveFilter } from "../src/lib/whereClause";
    ```

    2. Fixture constants at module scope (for readability and reuse):
    ```typescript
    const latlonTarget: SpatialTarget = {
      tableId: 1,
      spatialMode: "latlon",
      lonCol: "lon",
      latCol: "lat",
    };
    const wktTarget: SpatialTarget = {
      tableId: 1,
      spatialMode: "wkt",
      spatialCol: "geom",
    };
    const wkbTarget: SpatialTarget = {
      tableId: 1,
      spatialMode: "wkb",
      spatialCol: "geom",
    };
    const s1: SpatialFilter = { id: "s1", wkt: "w1" };
    const s2: SpatialFilter = { id: "s2", wkt: "w2" };
    const s3: SpatialFilter = { id: "s3", wkt: "w3" };
    const colFilter: ActiveFilter = {
      column: "zone",
      value: "East Village",
      dataType: "string",
      addedAt: 0,
    };
    ```

    3. Three describe blocks:

    **describe("buildSpatialOrBlock — V15-P-07 paren correctness")** — implement all 9 assertions from the behavior list using `.toBe(...)` for full-string matches and `.toThrow(...)` for error cases:

    ```typescript
    it("returns empty string for zero shapes", () => {
      expect(buildSpatialOrBlock([], latlonTarget)).toBe("");
    });

    it("single shape wraps in outer parens (V15-P-07 invariant — single-shape bug is invisible)", () => {
      expect(buildSpatialOrBlock([s1], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"
      );
    });

    it("two shapes: outer parens + single space around OR", () => {
      expect(buildSpatialOrBlock([s1, s2], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1)"
      );
    });

    it("three shapes: two OR separators, outer parens", () => {
      expect(buildSpatialOrBlock([s1, s2, s3], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w3')) = 1)"
      );
    });

    it("wkt mode uses ST_INTERSECTS (NOT ST_WITHIN — 25-SPIKE-NOTES §3.2)", () => {
      expect(buildSpatialOrBlock([s1], wktTarget)).toBe(
        "(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('w1')) = 1)"
      );
    });

    it("escapes single quotes in shape.wkt via SQL standard doubling", () => {
      const shape: SpatialFilter = { id: "s1", wkt: "O'Brien" };
      expect(buildSpatialOrBlock([shape], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('O''Brien')) = 1)"
      );
    });

    it("wkb mode throws SpatialFilterWkbDeferredError (TD-V14-WKB-SPIKE)", () => {
      expect(() => buildSpatialOrBlock([s1], wkbTarget)).toThrow(SpatialFilterWkbDeferredError);
      expect(() => buildSpatialOrBlock([s1], wkbTarget)).toThrow("WKB mode deferred — TD-V14-WKB-SPIKE");
    });

    it("latlon target missing lonCol/latCol throws coherent Error", () => {
      const badTarget: SpatialTarget = { tableId: 1, spatialMode: "latlon" };
      expect(() => buildSpatialOrBlock([s1], badTarget)).toThrow(/lonCol/);
    });

    it("wkt target missing spatialCol throws coherent Error", () => {
      const badTarget: SpatialTarget = { tableId: 1, spatialMode: "wkt" };
      expect(() => buildSpatialOrBlock([s1], badTarget)).toThrow(/spatialCol/);
    });
    ```

    **describe("composeWhereClause — 4-case composition")** — all 7 assertions:

    ```typescript
    it("neither: empty filters + empty shapes returns 1=1", () => {
      expect(composeWhereClause([], [], null)).toBe("1=1");
    });

    it("column-only: returns col_AND_chain with NO extra wrapping", () => {
      expect(composeWhereClause([colFilter], [], null)).toBe("zone = 'East Village'");
    });

    it("spatial-only: returns (spatial_OR_chain) bare (already outer-parenthesized)", () => {
      expect(composeWhereClause([], [s1], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"
      );
    });

    it("combined (1 shape + 1 col): (spatial) AND (col) — col side wrapped in parens", () => {
      expect(composeWhereClause([colFilter], [s1], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1) AND (zone = 'East Village')"
      );
    });

    // LOAD-BEARING V15-P-07 regression — 2 shapes + 1 column filter.
    // This is the load-bearing assertion that locks out the single-shape-invisible
    // bug class. Do NOT weaken to .toContain or substring matching.
    it("V15-P-07 load-bearing: 2-shape + 1-col returns EXACT combined string", () => {
      expect(composeWhereClause([colFilter], [s1, s2], latlonTarget)).toBe(
        "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')"
      );
    });

    it("zero shapes with target present is equivalent to column-only", () => {
      expect(composeWhereClause([colFilter], [], latlonTarget)).toBe("zone = 'East Village'");
    });

    it("zero shapes + zero filters + non-null target returns 1=1", () => {
      expect(composeWhereClause([], [], latlonTarget)).toBe("1=1");
    });
    ```

    **describe("composeWhereClause — wkb mode pass-through to builder")**:

    ```typescript
    it("wkb mode bubbles SpatialFilterWkbDeferredError from builder", () => {
      expect(() => composeWhereClause([], [s1], wkbTarget)).toThrow(SpatialFilterWkbDeferredError);
    });
    ```

    Total: 17 test cases across 3 describe blocks. Do NOT add any other test cases or fixtures.
  </action>

  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; npx vitest run tests/lib.spatialWhereClause.spec.ts 2>&amp;1 | tail -20</automated>
  </verify>

  <acceptance_criteria>
    - File `kinetica_bi/server/tests/lib.spatialWhereClause.spec.ts` exists
    - File contains exactly 17 test cases (count `\bit\(` matches)
    - File contains EXACT assertion line: `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')"` (the V15-P-07 load-bearing assertion)
    - File contains EXACT assertion substring: `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)"` (single-shape paren wrap)
    - File contains EXACT assertion substring: `"(ST_INTERSECTS(geom, ST_GEOMFROMTEXT('w1')) = 1)"` (ST_INTERSECTS for wkt mode)
    - File contains EXACT assertion substring: `"(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('O''Brien')) = 1)"` (single-quote escape)
    - File contains substring `.toThrow(SpatialFilterWkbDeferredError)` at least once
    - File does NOT contain substring `.toContain(` for the V15-P-07 assertion (full-string match is mandatory)
    - `cd kinetica_bi/server && npx vitest run tests/lib.spatialWhereClause.spec.ts` exits 0 with 17/17 tests passing
  </acceptance_criteria>

  <done>
    Spec file with 17 tests, all passing. V15-P-07 load-bearing assertion uses `.toBe` (full string), not `.toContain`. ST_INTERSECTS verified, ST_WITHIN excluded.
  </done>
</task>

</tasks>

<verification>
After both tasks complete:
1. `cd kinetica_bi/server && npx tsc --noEmit` — exits 0 (no TS errors).
2. `cd kinetica_bi/server && npx vitest run tests/lib.spatialWhereClause.spec.ts` — 17/17 green.
3. `cd kinetica_bi/server && npx vitest run tests/lib.whereClause.spec.ts` — still green (Plan 01 made zero changes to whereClause.ts).
4. `grep -c "ST_WITHIN(" kinetica_bi/server/src/lib/spatialWhereClause.ts` returns 0 (no stale ST_WITHIN usage).
5. `grep -c "STXY_WITHIN\|ST_INTERSECTS" kinetica_bi/server/src/lib/spatialWhereClause.ts` returns ≥ 2 (both locked predicates present).
</verification>

<success_criteria>
- WHERE-V15-01: `spatialWhereClause.ts` exports `buildSpatialOrBlock(shapes, target)` producing OR-chain per Phase 25 locked templates; outer parens mandatory; wkb mode throws.
- WHERE-V15-02: `composeWhereClause` produces correct 4-case composition with V15-P-07 paren invariant locked by unit test.
- Both requirements verified by lib.spatialWhereClause.spec.ts (17/17 green).
- No regression: lib.whereClause.spec.ts still green; tsc clean.
</success_criteria>

<output>
After completion, create `.planning/phases/26-server-spatial-where/26-01-spatial-where-builder-SUMMARY.md` capturing:
- Kinetica server version captured via `SHOW SYSTEM PROPERTIES` (HUMAN-RUN follow-up — record here when available)
- Final file paths created
- Test count and pass rate
- Any decisions made under Claude's Discretion (e.g., SpatialMode local-define vs re-export choice, exact 400-error wording for incoherent target)
- Commit hash for the two files
</output>
