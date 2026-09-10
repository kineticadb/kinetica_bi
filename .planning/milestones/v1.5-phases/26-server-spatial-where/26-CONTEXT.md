# Phase 26: server-spatial-where - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Server-side WHERE-clause composition for v1.5 spatial filtering. Deliver three things, no more:

1. Pure server module `kinetica_bi/server/src/lib/spatialWhereClause.ts` exporting:
   - `buildSpatialOrBlock(shapes, target): string` — fully parenthesized OR chain of spatial predicates per shape (single source of truth for V15-P-07 paren correctness)
   - `composeWhereClause(filters, shapes, target): string` — combines column AND-chain with spatial OR-chain
   - `SpatialFilter`, `SpatialTarget` server-side types (minimal slice — frontend-import-free)
   - `SpatialFilterWkbDeferredError` class (thrown stub for wkb mode)
2. Extend `POST /api/filter/materialize` body to accept `{ filters, spatialFilters?, spatialTarget? }`; backward-compatible with v1.3 (filters-only callers still work).
3. Supertest coverage of column-only / spatial-only / combined / paren correctness / WKB → 501 across `AUTH_MODE=password` + `AUTH_MODE=oidc`.

Out of scope: frontend store (Phase 27), per-widget spatialTargets config (Phase 28), draw UX (Phase 29), materialize trigger wiring (Phase 30), end-to-end UAT (Phase 31), WKB-binary mode implementation (TD-V14-WKB-SPIKE — endpoint returns 501).

</domain>

<decisions>
## Implementation Decisions

### Predicate templates — locked verbatim from Phase 25 spike

REQUIREMENTS.md WHERE-V15-01 still reads `ST_WITHIN` for WKT mode — **that wording is stale**. The Phase 25 spike rejected `ST_WITHIN` (returned 0 rows because no US state fits inside a 1° NYC bbox — correct semantic, wrong intent). Phase 26 uses the predicates locked in `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §3.3`:

- **Latlon mode:** `STXY_WITHIN(<lon_col>, <lat_col>, ST_GEOMFROMTEXT('<wkt>')) = 1`
  - Argument order is `(lon, lat, shape)` — lon/lat first, shape last. Do NOT swap.
- **WKT mode:** `ST_INTERSECTS(<geom_col>, ST_GEOMFROMTEXT('<wkt>')) = 1`
  - Argument order is `(geom_col, shape)`.
- **WKB mode:** builder throws `SpatialFilterWkbDeferredError`. Route handler never invokes the builder for wkb mode in production (501 early-return).

Phase 26 must record the Kinetica server version in PLAN frontmatter via `SHOW SYSTEM PROPERTIES` (25-SPIKE-NOTES §4.1 follow-up).

### `buildSpatialOrBlock(shapes, target)` contract

- **Returns a single string** containing the fully parenthesized OR chain — outer parens are the builder's responsibility. composeWhereClause and the route handler never re-wrap.
- `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1 OR STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w2')) = 1)` for 2+ shapes.
- Single-shape input still wraps: `(STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('w1')) = 1)` — V15-P-07 invariant.
- **Zero shapes returns `""`** (empty string). composeWhereClause uses `spatialClause.length > 0` to decide whether to emit the AND. Route handlers can call builder unconditionally.
- **WKT escape:** every `shape.wkt` is run through `escapeKineticaStringLiteral` (single-quote doubling) before interpolation into `ST_GEOMFROMTEXT('...')`. Matches whereClause.ts policy for column string values — defense in depth even though OL `writeGeometry` output never contains quotes. SQL-safe by construction (Kinetica errors on invalid WKT, never injection).
- **Mode/column coherence:** builder throws `Error` (plain) if target is incoherent for its mode — latlon without `lonCol && latCol`, wkt without `spatialCol`, wkb without `spatialCol` (theoretically; wkb path is unreachable anyway). Route handler catches and emits 400 with detail. Mirrors `spatialQuery.ts` fail-loud posture.
- **Identifier trust boundary** (matches whereClause.ts:14-21): `lonCol` / `latCol` / `spatialCol` are interpolated raw — they come from admin-curated table metadata, not user input. Only the WKT literal value gets escaped.

### `composeWhereClause(filters, shapes, target)` contract

- **Rich-types signature:** `composeWhereClause(filters: ActiveFilter[], shapes: SpatialFilter[], target: SpatialTarget | null): string`. Single entry point for the route handler. Internally calls `buildServerWhereClause(filters)` and `buildSpatialOrBlock(shapes, target)`.
- **Four cases** (mirror REQUIREMENTS WHERE-V15-02 wording literally):
  - Both clauses non-empty → `(spatial_OR_chain) AND (col_AND_chain)` — column side wrapped in parens
  - Spatial only → `(spatial_OR_chain)` — bare spatial group (already parenthesized by buildSpatialOrBlock)
  - Column only → `col_AND_chain` — unchanged from buildServerWhereClause output, **no extra parens**
  - Neither → `"1=1"` — fallback matches buildServerWhereClause empty-array behavior

### Endpoint body shape and validation

`POST /api/filter/materialize` request body becomes:

```ts
{
  dashboardId: number,        // existing
  tableId: number,            // existing
  filters: ActiveFilter[],    // existing — now allowed to be empty when spatial fields present
  spatialFilters?: SpatialFilter[],  // new
  spatialTarget?: SpatialTarget,     // new
}
```

**Validation order (route handler):**

1. Parse body fields and assert `typeof dashboardId === "number"` + `typeof tableId === "number"` (existing 400 cases stay).
2. **Empty-input 400:** `400` only when BOTH (a) `filters.length === 0` OR `filters` missing, AND (b) `spatialFilters.length === 0` OR `spatialFilters` missing OR `spatialTarget` missing. Error message: `"filters or (spatialFilters + spatialTarget) must be non-empty (use DELETE to clear)."`
3. **Pair-completeness 400:** if `spatialFilters` present without `spatialTarget` (or vice versa), reject with 400. They are paired — Phase 30 client always emits both.
4. **TableId mismatch 400:** if `spatialTarget` is present and `spatialTarget.tableId !== body.tableId`, reject with 400.
5. **WKB 501:** if `spatialTarget?.spatialMode === "wkb"`, return 501 BEFORE invoking the builder — body verbatim Phase 18: `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }`. (Builder's throwing stub is static guarantee only — never reached in production.)
6. **Compose + DDL:** `composeWhereClause(filters, spatialFilters ?? [], spatialTarget ?? null)` → `CREATE OR REPLACE MATERIALIZED VIEW <viewName> AS (SELECT * FROM <tableRef> WHERE <clause>) USING TABLE PROPERTIES (TTL = 5)` → existing kineticaSqlHelper call.

**View-name composition unchanged** — Phase 13's `buildFilterViewName` produces the same view-name shape regardless of spatial filter presence (V15-P-10 acknowledged — same-name CREATE OR REPLACE atomically swaps content).

**DELETE handler unchanged** — drops by view name, same regardless of WHERE clause content.

### Server-side type slices (minimal, frontend-import-free)

```ts
// In spatialWhereClause.ts:
export type SpatialMode = "latlon" | "wkt" | "wkb";

export type SpatialFilter = {
  id: string;     // shape id — used for audit-log breadcrumb only; builder ignores
  wkt: string;    // EPSG:4326 WKT produced by Phase 29's ol/format/WKT writer
};

export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;     // required when spatialMode === "latlon"
  latCol?: string;     // required when spatialMode === "latlon"
  spatialCol?: string; // required when spatialMode === "wkt" (or "wkb" — unreachable)
};

export class SpatialFilterWkbDeferredError extends Error {
  constructor() {
    super("WKB mode deferred — TD-V14-WKB-SPIKE");
    this.name = "SpatialFilterWkbDeferredError";
  }
}
```

Client (Phase 27 STORE-V15-01) holds the richer `Shape` type — `{ id, type, wkt, label, measurement, addedAt }`. Server consumes only `{ id, wkt }`. The frontend `client.ts` materializeFilter helper (Phase 30 MAT-V15-02) is responsible for projecting the client Shape down to the server's minimal SpatialFilter slice — server module stays import-free of frontend types.

### V15-P-07 paren-correctness regression test

A unit test for `composeWhereClause` MUST assert the exact paren structure for the 2-shape + 1-column-filter input:

```
expected: "(STXY_WITHIN(...) = 1 OR STXY_WITHIN(...) = 1) AND (column_x = 'value')"
```

Substring matching is NOT enough — the test asserts the full composed string. Single-shape inputs also asserted-with-parens. This test ships BEFORE any multi-shape UI exists (Phase 29) so the silent multi-shape regression mode can never land.

### Supertest coverage

Mirror `routes.filter-materialize.spec.ts` structure (23/23 reference); add the following scenarios for both AUTH_MODE=password AND AUTH_MODE=oidc:

- column-only (existing v1.3 path) — backward-compat regression
- spatial-only (no filters, with spatialFilters + spatialTarget) — Phase 30 trigger path
- combined (filters + spatialFilters + spatialTarget) — full WHERE composition
- 1-shape OR-block paren correctness (asserts `(pred)` wrapper)
- 3-shape OR-block paren correctness (asserts `(pred OR pred OR pred)`)
- Empty input → 400 with new error message
- spatialFilters present without spatialTarget → 400
- spatialTarget present without spatialFilters → 400
- spatialTarget.tableId !== body.tableId → 400
- spatialTarget.spatialMode === "wkb" → 501 with `{ error, td }` body
- Builder is NOT invoked when wkb mode → assert via spy on kineticaSql (zero call OR call but without spatial predicate text)
- KineticaOp audit-log tag stays `"MATERIALIZE"` (no new op tag needed)

### Claude's Discretion

- Plan structure (1 plan vs split into builder + endpoint + supertest). Both work; planner picks based on file-touch isolation.
- Exact wording of 400 error messages — be specific (which check failed, what was sent).
- Whether `composeWhereClause` accepts `target: SpatialTarget | null` or `target?: SpatialTarget`. Functionally equivalent; pick whichever reads cleanest with TypeScript strict mode.
- Order of `parts.push(...)` for combined clause output — `[spatial, col].join(" AND ")` vs `[col, spatial].join(" AND ")`. REQUIREMENTS literal is `(spatial) AND (col)` — match that order; mention in test names.
- Whether to import `escapeKineticaStringLiteral` from whereClause.ts or duplicate the one-liner. Importing is fine — both modules live in the same `lib/` directory.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 26 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Server Spatial WHERE Builder" — WHERE-V15-01..04 literal requirements (**note:** WHERE-V15-01 says `ST_WITHIN` for WKT mode — STALE; use `ST_INTERSECTS` per Phase 25 spike)
- `.planning/ROADMAP.md` §"Phase 26: server-spatial-where" — Goal + 4 success criteria
- `.planning/STATE.md` §"Key v1.5 Architecture Decisions" — V15-P-07 paren lock, WKB-deferred-again lock, sole-materialize-trigger invariant

### Phase 25 spike outcomes (predicates locked here)
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §2 Probe Results` — All 12 probes verbatim
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §3.1` — Latlon LOCKED: `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(?)) = 1`
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §3.2` — WKT LOCKED: `ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(?)) = 1`
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §3.3` — Exact SQL templates for buildSpatialOrBlock
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md §5` — Phase 26 hand-off checklist (paren lock, WKB gate, argument-order reminders)

### Existing pure-module precedents (mirror style)
- `kinetica_bi/server/src/lib/whereClause.ts` — `buildServerWhereClause` + `escapeKineticaStringLiteral` + ActiveFilter type + module doc-comment style + trust-boundary doc
- `kinetica_bi/server/src/lib/spatialQuery.ts` — Three-builder pattern + WkbDeferredError + identifier trust boundary mirror
- `kinetica_bi/server/src/lib/viewNaming.ts` — Pure-module style; zero non-stdlib imports
- `kinetica_bi/server/src/lib/radiusConversion.ts` — Sibling helper pattern

### Existing endpoint to extend
- `kinetica_bi/server/src/index.ts:670-745` — Current POST + DELETE /api/filter/materialize handlers (Phase 13 contract)
- `kinetica_bi/server/src/index.ts:747-938` — POST /api/info/query (Phase 18) — canonical 501-early-return pattern for wkb deferral

### Supertest pattern reference
- `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` — 23/23 reference; mirror the AUTH_MODE=password + AUTH_MODE=oidc dual-mount + hoisted `vi.mock("openid-client")` shape
- `kinetica_bi/server/tests/routes.info-query.spec.ts` (Phase 18 spec, if present) — for 501 assertion pattern + assert-zero-builder-call shape

### v1.5 pitfalls research (paren correctness, view-name collision)
- `.planning/research/PITFALLS.md §"V15-P-07: Multi-Shape OR Clause Without Grouping Parens"` — Why outer parens MUST always wrap
- `.planning/research/PITFALLS.md §"V15-P-10: View Name Collision When Spatial Filter Replaces Column Filter Mid-Flight"` — Why same view-name shape is correct (atomic CREATE OR REPLACE)
- `.planning/research/PITFALLS.md §"V15-P-08: Materialize Race with Multi-Table Fan-Out"` — Cross-table parallelism is accepted; server is per-call stateless

### TD-V14-WKB-SPIKE carry-forward (501 rationale)
- `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md ## Decision` — NONE_ESCALATE → TECH_DEBT outcome; Phase 26 inherits the same 501 posture for the materialize path

### Project locks
- `.planning/PROJECT.md` §"Key Decisions" — v1.3 stateless server for transient views; v1.3 unqualified view names; v1.3 dead-code deletion atomic with FROM-swap

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kinetica_bi/server/src/lib/whereClause.ts` — Reuse: import `buildServerWhereClause` + `escapeKineticaStringLiteral` + `ActiveFilter` type directly. Existing module is byte-for-byte unchanged; spatialWhereClause.ts is purely additive.
- `kinetica_bi/server/src/lib/spatialQuery.ts` — Pattern source: `SpatialMode` type already defined here; can re-export or duplicate (zero-import discipline favors duplication, but `SpatialMode` is data-only).
- `kinetica_bi/server/src/lib/viewNaming.ts` — `buildFilterViewName` unchanged; view-name composition stays Phase 13 contract.
- `kinetica_bi/server/src/index.ts:684` — Existing POST /api/filter/materialize handler — body parsing + validation pattern + tableRef composition + kineticaSqlHelper call. Extend in place; do NOT fork to a new endpoint.
- `kinetica_bi/server/src/index.ts:781-938` — POST /api/info/query handler — verbatim model for wkb early-return 501 pattern.

### Established Patterns
- **Pure-module discipline** (whereClause.ts / spatialQuery.ts / viewNaming.ts / radiusConversion.ts): zero non-stdlib imports; module doc-comment block at top with trust-boundary statement; no Express / db / kinetica.ts dependencies. spatialWhereClause.ts must follow.
- **Trust-boundary doc** (whereClause.ts:14-21 + spatialQuery.ts:21-26): identifier-vs-value escape boundary stated explicitly in module header. spatialWhereClause.ts must include the same statement.
- **No try/catch in route handlers** (index.ts:684-745 + 781-938 lock from Phase 13/18): typed Kinetica errors bubble through asyncHandler → errorMiddleware. spatialWhereClause builder throws plain `Error` for incoherent mode/cols → asyncHandler catches → middleware emits 400 with detail.
- **501-early-return for wkb mode** (Phase 18 lock): route handler short-circuits BEFORE any builder call. The throwing stub is a static guarantee, never executed in production. Phase 26 mirrors this exactly.
- **AUTH_MODE-parametric supertest** (routes.filter-materialize.spec.ts pattern): hoisted `vi.mock("openid-client")` with Issuer doubling as constructor + static-discover namespace; `resetOidcClientForTests()` in beforeEach; OIDC sessions seeded via `createSession({ credentialType: "oidc", ... })` AFTER `buildTestApp()`.
- **KineticaOp audit-log tag** stays `"MATERIALIZE"` — no new op tag needed (spatial is a different WHERE, same operation class).

### Integration Points
- **POST /api/filter/materialize body shape** extended in place at `index.ts:684`. Body parser adds `spatialFilters?: SpatialFilter[]` + `spatialTarget?: SpatialTarget` fields; existing `{ dashboardId, tableId, filters }` triple stays. DELETE handler at `index.ts:723` is unchanged.
- **View-name builder** `buildFilterViewName` at `lib/viewNaming.ts` — called as before; same view name regardless of WHERE clause shape (V15-P-10 acknowledged as correct via atomic CREATE OR REPLACE).
- **kineticaSqlHelper invocation** at `index.ts:714` — same `{ route, op: "MATERIALIZE" }` options; only the DDL string changes.
- **Phase 27 consumer** — frontend `useSpatialFilterStore.Shape` will project to server's SpatialFilter slice in `client.ts` materializeFilter helper (Phase 30 MAT-V15-02 territory). Server module stays import-free of frontend types.
- **Phase 30 consumer** — `AggregatedWidgetRenderer` extends Effect 1 dep array with `spatialFilterVersion`; `materializeFilter` client helper adds spatialFilters + spatialTarget to request body. Endpoint shape locked in Phase 26 is the contract.

</code_context>

<specifics>
## Specific Ideas

- **Test the silent-multi-shape regression**: V15-P-07's invisibility on single-shape input is the canonical reason this phase must ship paren-correctness tests BEFORE any multi-shape UI lands (Phase 29). The supertest for combined 2-shape + 1-column input is the load-bearing assertion.
- **Phase 25 SPIKE-NOTES §5 is the hand-off checklist** — every checkbox item there is a Phase 26 acceptance criterion (predicate templates, argument order, outer parens, WKB gate, shape WKT source, server version capture, runner preservation).
- **REQUIREMENTS.md WHERE-V15-01 ST_WITHIN/ST_INTERSECTS discrepancy** — this is an authoritative resolution: spike result wins, REQUIREMENTS wording is stale. Phase 26 implementer must NOT use ST_WITHIN. PLAN frontmatter should call this out so future readers don't get confused by the REQUIREMENTS literal.
- **Capture Kinetica server version in PLAN frontmatter** — `SHOW SYSTEM PROPERTIES` against the deployed instance; record in plan header so Phase 26 has a version pin for future re-validation (25-SPIKE-NOTES §4.1 follow-up).

</specifics>

<deferred>
## Deferred Ideas

- **STXY_DWITHIN distance-unit probe (V15-P-05)** — not Phase 26 territory; circle is rendered as 64-gon WKT polygon (Phase 29) so distance-unit semantics don't apply to the WHERE clause. Defer to v1.6 if precise GIS circle predicate becomes a requirement.
- **WKB-binary mode end-to-end implementation** — TD-V14-WKB-SPIKE carry-forward; Phase 26 returns 501. Re-run path: `npm run wkb-spike` when a WKB column becomes reachable, then replace the 501 path with a real builder.
- **Per-shape AND/OR/SUBTRACT boolean toggle** — Out-of-scope per REQUIREMENTS.md "Out of Scope (v1.5)"; implicit OR is industry standard.
- **Audit-log spatial breadcrumb (shape IDs)** — server type carries `shape.id` for future audit-log enrichment; not wired into the current log line in Phase 26. Reuse the field when ops asks for spatial-filter tracing.
- **Server-side WKT length cap** — Trust Phase 29 simplification; no defensive max-length guard. Revisit if a future client (paste-in-WKT, GeoJSON import) starts sending unsimplified geometry.
- **Plan structure (single vs split)** — Planner's call. Single plan keeps the V15-P-07 paren-test + endpoint extension atomic; splitting risks the test landing in a later plan.

</deferred>

---

*Phase: 26-server-spatial-where*
*Context gathered: 2026-05-12*
