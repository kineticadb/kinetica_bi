/**
 * Server-side spatial WHERE clause builder for the v1.5 materialize endpoint.
 *
 * Produces fully parenthesized OR chains of spatial predicates per drawn shape,
 * then composes them with the column AND-chain from the existing v1.3 filter
 * pipeline. Predicates locked by Phase 25 spike (25-SPIKE-NOTES.md §3.3):
 *
 *   LATLON:  STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT('<wkt>')) = 1
 *   WKT:     ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT('<wkt>')) = 1
 *   WKB:     throws SpatialFilterWkbDeferredError (TD-V14-WKB-SPIKE carry-forward)
 *
 * V15-P-07 paren invariant (MANDATORY):
 *   buildSpatialOrBlock ALWAYS wraps the entire OR chain in outer parentheses —
 *   even for a single shape. Without outer parens, a multi-shape spatial block
 *   concatenated with a column AND-chain produces silent AND-precedence breakage:
 *     wrong:  pred1 OR pred2 AND col = 'val'
 *             → pred1 OR (pred2 AND col = 'val')
 *     right:  (pred1 OR pred2) AND (col = 'val')
 *   Single-shape callers cannot detect this bug; multi-shape callers silently
 *   get wrong results. The unit test in lib.spatialWhereClause.spec.ts asserts
 *   the exact composed string for a 2-shape + 1-column-filter input to lock this
 *   out BEFORE any multi-shape UI exists (Phase 29).
 *
 * Trust boundary — identifier vs value escaping (mirrors whereClause.ts:14-21):
 *   Column-name fields (lonCol, latCol, spatialCol) are interpolated DIRECTLY
 *   into the SQL without quoting or escaping. They originate from admin-curated
 *   table metadata, NOT from arbitrary user input — injection risk is bounded by
 *   admin-only metadata routes. Shape WKT literals ARE always escaped via
 *   escapeKineticaStringLiteral (single-quote doubling, SQL standard) — this is
 *   defense-in-depth even though OL writeGeometry output never contains quotes.
 *
 * SpatialMode is defined locally (not re-exported from spatialQuery.ts) to keep
 * this module free of cross-lib dependencies for a trivial type union. Both files
 * coexist independently; grep will find both definitions.
 *
 * Pure module — sole non-stdlib import is from ./whereClause for
 * escapeKineticaStringLiteral, buildServerWhereClause, and the ActiveFilter type.
 * No Express, db, or kinetica.ts dependencies.
 */

import { buildServerWhereClause, escapeKineticaStringLiteral, type ActiveFilter } from "./whereClause";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Spatial mode discriminant. Defined locally (not imported from spatialQuery.ts)
 * to keep this module cross-lib-import-free for a trivial union type.
 *
 * `wkb` stays in the union for type-level completeness; the builder throws
 * SpatialFilterWkbDeferredError for wkb mode regardless of shape count (the
 * route handler returns HTTP 501 BEFORE invoking the builder in production —
 * the throw is a static guarantee only).
 */
export type SpatialMode = "latlon" | "wkt" | "wkb";

/**
 * Minimal server-side shape slice. The client Shape type (Phase 27
 * useSpatialFilterStore) carries richer fields (type, label, measurement,
 * addedAt); the server needs only id + wkt. The Phase 30 materializeFilter
 * helper projects the client Shape down to this slice before sending the
 * request body — server module stays import-free of frontend types.
 */
export type SpatialFilter = {
  id: string;     // audit-log breadcrumb only; builder ignores
  wkt: string;    // EPSG:4326 WKT (Phase 29 OL writer output)
};

/**
 * Describes which table column(s) to use for spatial predicate construction.
 * Exactly one mode-appropriate column variant must be set when shapes.length > 0:
 *   - spatialMode "latlon" → lonCol + latCol both required
 *   - spatialMode "wkt"    → spatialCol required
 *   - spatialMode "wkb"    → builder throws regardless (TD-V14-WKB-SPIKE)
 */
export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;     // required for latlon
  latCol?: string;     // required for latlon
  spatialCol?: string; // required for wkt (and theoretically wkb — unreachable in production)
};

/**
 * Thrown by buildSpatialOrBlock when spatialMode === "wkb".
 *
 * Distinct from the WkbDeferredError in spatialQuery.ts — separate class for
 * grep-stability and module purity. Future TD-V14-WKB-SPIKE re-run agent finds
 * this stub with a targeted grep for "SpatialFilterWkbDeferredError".
 *
 * In production: the route handler returns HTTP 501 BEFORE invoking the builder
 * for wkb mode. This throw is a static guarantee that the WKB code path cannot
 * silently produce SQL — not a runtime error path.
 */
export class SpatialFilterWkbDeferredError extends Error {
  constructor() {
    super("WKB mode deferred — TD-V14-WKB-SPIKE");
    this.name = "SpatialFilterWkbDeferredError";
  }
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a fully parenthesized spatial OR-chain from an array of drawn shapes.
 *
 * SQL templates LOCKED by 25-SPIKE-NOTES.md §3.3:
 *   Latlon:  STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT('<wkt>')) = 1
 *            Argument order (lon, lat, shape) — 25-SPIKE-NOTES §3.1.
 *            STXY_CONTAINS rejected (identical counts but reversed arg order;
 *            STXY_WITHIN is canonical Kinetica reference).
 *   WKT:     ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT('<wkt>')) = 1
 *            ST_WITHIN rejected (returned 0 rows for polygon features larger
 *            than the drawn shape — 25-SPIKE-NOTES §3.2; correct semantic,
 *            wrong intent). ST_INTERSECTS is the correct v1.5 semantic.
 *
 * V15-P-07 lock (25-SPIKE-NOTES §5):
 *   Outer parens are the builder's SOLE responsibility. composeWhereClause and
 *   the route handler NEVER re-wrap. Single-shape: "(pred)"; multi: "(p1 OR p2)".
 *
 * @param shapes - Array of drawn shapes; empty array returns "".
 * @param target - Describes spatial mode + column names (admin-trusted).
 * @returns Fully parenthesized OR-chain string, or "" when shapes is empty.
 * @throws SpatialFilterWkbDeferredError when target.spatialMode === "wkb"
 * @throws Error (plain) when target is incoherent for its mode (route handler → 400)
 */
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
      // Argument order LOCKED by 25-SPIKE-NOTES §3.1 + §5: (lon, lat, shape)
      return `STXY_WITHIN(${target.lonCol}, ${target.latCol}, ST_GEOMFROMTEXT('${wkt}')) = 1`;
    }
    // wkt mode — uses ST_INTERSECTS (NOT ST_WITHIN; spike 25-SPIKE-NOTES §3.2)
    return `ST_INTERSECTS(${target.spatialCol}, ST_GEOMFROMTEXT('${wkt}')) = 1`;
  });

  // V15-P-07 lock (25-SPIKE-NOTES §5): outer parens ALWAYS, even for single shape.
  // Single-shape: "(pred)"; multi-shape: "(pred1 OR pred2 OR ...)"
  return `(${predicates.join(" OR ")})`;
}

// ─── Composer ─────────────────────────────────────────────────────────────────

/**
 * Compose the final WHERE clause body from column filters + spatial shapes.
 *
 * Single entry point for the POST /api/filter/materialize route handler.
 * Internally delegates to buildServerWhereClause (column AND-chain) and
 * buildSpatialOrBlock (spatial OR-chain).
 *
 * Four cases (REQUIREMENTS.md WHERE-V15-02 literal):
 *   Both non-empty → "${spatialClause} AND (${colClause})"
 *                    Column side is wrapped in an extra pair of parens.
 *                    Spatial first, column second.
 *   Spatial only   → "${spatialClause}" (already outer-parenthesized by builder)
 *   Column only    → "${colClause}" (no extra parens — matches v1.3 behavior)
 *   Neither        → "1=1" (fallback — matches buildServerWhereClause empty-array)
 *
 * Load-bearing V15-P-07 example (2-shape + 1-column-filter):
 *   filters = [{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }]
 *   shapes  = [{ id: "s1", wkt: "w1" }, { id: "s2", wkt: "w2" }]
 *   target  = { tableId: 1, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }
 *   → "(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1) AND (zone = 'East Village')"
 *
 * @param filters - Column equality filters (existing v1.3 pipeline).
 * @param shapes  - Drawn spatial shapes; empty array skips spatial clause.
 * @param target  - Spatial column metadata; null skips spatial clause entirely.
 * @returns WHERE clause body string (no leading "WHERE" keyword).
 */
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
  // Spatial first; column side wrapped in extra parens for AND-precedence safety.
  if (hasSpatial && hasCol) return `${spatialClause} AND (${colClause})`;
  if (hasSpatial) return spatialClause;       // already outer-parenthesized by builder
  if (hasCol) return colClause;               // no extra wrapping — matches v1.3 behavior
  return "1=1";                               // empty-empty fallback
}
