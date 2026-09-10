---
phase: 26-server-spatial-where
plan: 2
type: execute
wave: 2
depends_on:
  - 26-01-spatial-where-builder
files_modified:
  - kinetica_bi/server/src/index.ts
autonomous: true
requirements:
  - WHERE-V15-03

# Backward-compatibility lock: v1.3 callers sending { dashboardId, tableId, filters: [...] }
# (no spatial fields) MUST continue to work unchanged. The empty-input 400 only fires when
# BOTH column AND spatial inputs are absent.
#
# WKB 501 lock: spatialTarget.spatialMode === "wkb" → return 501 BEFORE invoking the builder.
# Body: { error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" } (verbatim Phase 18).

must_haves:
  truths:
    - "v1.3 callers (filters only, no spatial) still receive 200 with { viewName, expiresAt }"
    - "Spatial-only requests (empty filters, spatialFilters + spatialTarget) succeed and emit DDL with (spatial) WHERE clause"
    - "Combined requests (filters + spatialFilters + spatialTarget) emit DDL with (spatial) AND (col) WHERE clause"
    - "WKB-mode spatialTarget returns HTTP 501 with body { error: \"WKB mode deferred\", td: \"TD-V14-WKB-SPIKE\" }"
    - "WKB-mode early-return fires BEFORE kineticaSqlHelper is called (zero kinetica fetch calls on WKB path)"
    - "spatialFilters present without spatialTarget returns 400"
    - "spatialTarget present without spatialFilters returns 400"
    - "spatialTarget.tableId !== body.tableId returns 400"
    - "Both filters AND spatial absent returns 400 with message mentioning both"
    - "DELETE handler unchanged (still drops by view name; same regardless of WHERE clause)"
    - "Audit-log op tag stays \"MATERIALIZE\" (no new op tag introduced)"
  artifacts:
    - path: "kinetica_bi/server/src/index.ts"
      provides: "Extended POST /api/filter/materialize body parsing + validation + composeWhereClause call"
      contains: "composeWhereClause("
  key_links:
    - from: "kinetica_bi/server/src/index.ts"
      to: "kinetica_bi/server/src/lib/spatialWhereClause.ts"
      via: "import composeWhereClause + SpatialFilter + SpatialTarget"
      pattern: "import .* from \"./lib/spatialWhereClause\""
    - from: "POST /api/filter/materialize handler"
      to: "composeWhereClause"
      via: "WHERE-clause composition call replacing buildServerWhereClause"
      pattern: "composeWhereClause\\(filters"
---

<objective>
Extend the existing `POST /api/filter/materialize` handler in `kinetica_bi/server/src/index.ts` (current location: lines 684-721) to accept `{ spatialFilters?, spatialTarget? }` in addition to the v1.3 `{ dashboardId, tableId, filters }` body. Replace the single `buildServerWhereClause(filters)` call with `composeWhereClause(filters, spatialFilters ?? [], spatialTarget ?? null)`. Implement the 5-step validation chain (with WKB 501 early-return) per 26-CONTEXT.md §"Endpoint body shape and validation".

Purpose: WHERE-V15-03. The endpoint is the single contract Phase 30 client code consumes. Backward compatibility with v1.3 callers is mandatory.

Output: A single-file modification (index.ts) committed to git. Plan 03 (supertest-coverage) asserts the full behavior.
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
@.planning/phases/26-server-spatial-where/26-01-spatial-where-builder-SUMMARY.md
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/src/lib/spatialWhereClause.ts

<interfaces>
<!-- Key types and contracts the executor needs. -->

From kinetica_bi/server/src/lib/spatialWhereClause.ts (Plan 01 output):
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";
export type SpatialFilter = { id: string; wkt: string };
export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;
  latCol?: string;
  spatialCol?: string;
};
export function composeWhereClause(
  filters: ActiveFilter[],
  shapes: SpatialFilter[],
  target: SpatialTarget | null,
): string;
export class SpatialFilterWkbDeferredError extends Error;
```

From kinetica_bi/server/src/lib/whereClause.ts (existing — unchanged):
```typescript
export type ActiveFilter = { column, value, dataType, sourceWidgetId?, addedAt };
```

Current handler (index.ts:684-721) — STARTING STATE to modify:
```typescript
app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as {
    dashboardId?: number;
    tableId?: number;
    filters?: ActiveFilter[];
  };
  const { dashboardId, tableId, filters } = body;

  if (typeof dashboardId !== "number" || typeof tableId !== "number") {
    return res.status(400).json({ error: "dashboardId and tableId are required numbers." });
  }
  if (!Array.isArray(filters) || filters.length === 0) {
    return res.status(400).json({ error: "filters array must be non-empty (use DELETE to clear)." });
  }

  // ... table lookup, viewName, buildServerWhereClause, DDL, kineticaSqlHelper ...

  const whereClause = buildServerWhereClause(filters);
  const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;
  // ...
}));
```

Phase 18 501 pattern reference (from index.ts:776-783 comments):
```
WKB SQL template DEFERRED to TD-V14-WKB-SPIKE — Plan 18-01 spike
landed NONE_ESCALATE. Endpoint returns 501 for spatialMode='wkb' with
body { error: 'WKB mode deferred', td: 'TD-V14-WKB-SPIKE' }. The
buildWkbQuery function throws by design — endpoint early-returns 501
BEFORE invoking it.
```

CRITICAL: Per 26-RESEARCH.md §6 Risk 1, the existing /api/info/query handler at index.ts:892 does NOT actually implement the 501 early-return (it calls buildWkbQuery directly). DO NOT model your code on that buggy reference; implement the 501 early-return per the Phase 18 COMMENTS at index.ts:776-783 (intent, not implementation).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend POST /api/filter/materialize handler body parsing + 5-step validation + composeWhereClause call</name>
  <files>kinetica_bi/server/src/index.ts</files>

  <read_first>
    BEFORE editing, read these files in this order:
    1. kinetica_bi/server/src/index.ts lines 670-745 — current materialize handler (this is the code being modified; understand it in place before changing).
    2. kinetica_bi/server/src/index.ts lines 14-30 — current imports (you will add a single line to import composeWhereClause + SpatialFilter + SpatialTarget from "./lib/spatialWhereClause").
    3. kinetica_bi/server/src/index.ts lines 776-783 — the Phase 18 WKB 501 INTENT comments (these describe the correct early-return pattern; the actual /api/info/query code at line 892 does NOT implement this correctly — do NOT copy from there).
    4. kinetica_bi/server/src/lib/spatialWhereClause.ts (Plan 01 output) — confirm exported names.
    5. .planning/phases/26-server-spatial-where/26-CONTEXT.md §"Endpoint body shape and validation" — the 5-step validation order (verbatim).
    6. .planning/phases/26-server-spatial-where/26-RESEARCH.md §4 "Endpoint Changes" — exact line-level guidance.
  </read_first>

  <action>
    Make TWO edits to `kinetica_bi/server/src/index.ts`:

    **EDIT 1: Add import** (single line, alongside existing whereClause import at line 17):

    Locate the line:
    ```typescript
    import { buildServerWhereClause, type ActiveFilter } from "./lib/whereClause";
    ```

    Immediately AFTER it, add a new import line:
    ```typescript
    import { composeWhereClause, type SpatialFilter, type SpatialTarget } from "./lib/spatialWhereClause";
    ```

    Do NOT remove the buildServerWhereClause import — it is referenced elsewhere (the existing v1.3 persisted-view endpoint at index.ts:641-642 also imports from whereClause indirectly; verify with grep before removing anything).

    **EDIT 2: Rewrite POST /api/filter/materialize handler body** (the block at index.ts:684-721; DELETE handler at 723-745 is UNCHANGED).

    Replace lines 685-712 (body parsing through whereClause assignment) with this EXACT structure:

    ```typescript
    app.post("/api/filter/materialize", requireConfig, asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        dashboardId?: number;
        tableId?: number;
        filters?: ActiveFilter[];
        spatialFilters?: SpatialFilter[];
        spatialTarget?: SpatialTarget;
      };
      const {
        dashboardId,
        tableId,
        filters = [],
        spatialFilters,
        spatialTarget,
      } = body;

      // ── Validation step 1: dashboardId / tableId numeric (existing v1.3 check) ──
      if (typeof dashboardId !== "number" || typeof tableId !== "number") {
        return res.status(400).json({ error: "dashboardId and tableId are required numbers." });
      }

      // Defensive: coerce filters to [] when caller sends null / undefined / non-array.
      // The default-value destructuring above handles `undefined` but not `null`.
      const filtersArr: ActiveFilter[] = Array.isArray(filters) ? filters : [];
      const hasFilters = filtersArr.length > 0;
      const hasSpatial = Array.isArray(spatialFilters) && spatialFilters.length > 0;

      // ── Validation step 2: empty input (BOTH column AND spatial absent/empty) ──
      // v1.3 backward compat: filters-only callers still pass through. Spatial-only callers
      // (filters: [] + spatialFilters: [...] + spatialTarget: {...}) also pass through.
      if (!hasFilters && (!hasSpatial || !spatialTarget)) {
        return res.status(400).json({
          error: "filters or (spatialFilters + spatialTarget) must be non-empty (use DELETE to clear).",
        });
      }

      // ── Validation step 3: pair-completeness (spatialFilters ↔ spatialTarget) ──
      // The Phase 30 client always emits both together; reject mismatched halves.
      if (hasSpatial && !spatialTarget) {
        return res.status(400).json({ error: "spatialTarget is required when spatialFilters are provided." });
      }
      if (spatialTarget && !hasSpatial) {
        return res.status(400).json({ error: "spatialFilters are required when spatialTarget is provided." });
      }

      // ── Validation step 4: spatialTarget.tableId must match body.tableId ──
      if (spatialTarget && spatialTarget.tableId !== tableId) {
        return res.status(400).json({
          error: "spatialTarget.tableId must match body.tableId.",
        });
      }

      // ── Validation step 5: WKB mode 501 early-return (BEFORE composeWhereClause) ──
      // Mirrors Phase 18 intent at index.ts:776-783. The throwing stub in
      // spatialWhereClause.ts is a static guarantee; this early-return is the
      // production code path. TD-V14-WKB-SPIKE carry-forward.
      if (spatialTarget?.spatialMode === "wkb") {
        return res.status(501).json({
          error: "WKB mode deferred",
          td: "TD-V14-WKB-SPIKE",
        });
      }

      // ── Table lookup ────────────────────────────────────────────────────
      const table = getTable(tableId);
      if (!table) return res.status(404).json({ error: "Table not found." });
      const tableRef = table.schema ? `${table.schema}.${table.name}` : table.name;

      const authedReq = req as AuthedRequest;
      const viewName = buildFilterViewName({
        username: authedReq.user!.creds.username,
        sessionId: authedReq.user!.sid,
        dashboardId,
        tableId,
      });

      // ── Compose WHERE: spatial OR-chain AND'd with column AND-chain ─────
      const whereClause = composeWhereClause(
        filtersArr,
        spatialFilters ?? [],
        spatialTarget ?? null,
      );
      const ddl = `CREATE OR REPLACE MATERIALIZED VIEW ${viewName} AS (SELECT * FROM ${tableRef} WHERE ${whereClause}) USING TABLE PROPERTIES (TTL = 5)`;

      await kineticaSqlHelper(authedReq, ddl, {
        route: "POST /api/filter/materialize",
        op: "MATERIALIZE",
      });

      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes (sliding TTL)
      return res.json({ viewName, expiresAt });
    }));
    ```

    **DO NOT touch the DELETE handler at lines 723-745** — it stays byte-for-byte unchanged. Drop-by-view-name doesn't care about WHERE clause content.

    **DO NOT touch the `/api/info/query` handler at lines 784-933** — it is a separate concern (Phase 18 territory; its WKB-501 bug is out of scope for Phase 26).

    **Critical formatting rules:**
    - The 501 response body MUST be exactly `{ error: "WKB mode deferred", td: "TD-V14-WKB-SPIKE" }` (verbatim Phase 18 contract; Plan 03 supertest asserts exact match via `toEqual`).
    - The empty-input 400 error message MUST be exactly `"filters or (spatialFilters + spatialTarget) must be non-empty (use DELETE to clear)."` (CONTEXT.md lock; Plan 03 supertest asserts via `toContain("must be non-empty")`).
    - composeWhereClause receives the THIRD positional arg as `spatialTarget ?? null` (matching the function's `SpatialTarget | null` signature from Plan 01).
    - Audit-log `op: "MATERIALIZE"` stays unchanged (Plan 03 supertest asserts).
  </action>

  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/26-02-tsc.txt &amp;&amp; ! grep -q "error TS" /tmp/26-02-tsc.txt &amp;&amp; npx vitest run tests/routes.filter-materialize.spec.ts 2>&amp;1 | tail -10</automated>
  </verify>

  <acceptance_criteria>
    - `kinetica_bi/server/src/index.ts` contains exact line: `import { composeWhereClause, type SpatialFilter, type SpatialTarget } from "./lib/spatialWhereClause";`
    - POST /api/filter/materialize handler contains substring `composeWhereClause(` (call site)
    - Handler does NOT contain substring `buildServerWhereClause(filters)` in the materialize-route body (replaced by composeWhereClause call)
    - Handler contains substring `spatialFilters?: SpatialFilter[]` (body type extended)
    - Handler contains substring `spatialTarget?: SpatialTarget` (body type extended)
    - Handler contains substring `"WKB mode deferred"` (501 body lock)
    - Handler contains substring `"TD-V14-WKB-SPIKE"` (501 body lock)
    - Handler contains substring `status(501)` (WKB early-return)
    - Handler contains substring `spatialTarget?.spatialMode === "wkb"` (mode dispatch)
    - Handler contains substring `"filters or (spatialFilters + spatialTarget) must be non-empty"` (verbatim empty-input message)
    - Handler contains substring `"spatialTarget is required when spatialFilters are provided"` (pair-completeness 400)
    - Handler contains substring `"spatialTarget.tableId must match body.tableId"` (tableId mismatch 400)
    - Handler still contains substring `op: "MATERIALIZE"` (audit-log op tag unchanged)
    - DELETE handler at index.ts (search for `app.delete("/api/filter/materialize"`) is byte-for-byte unchanged from current line 723-745
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0 (no TS errors)
    - `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` — existing 23/23 v1.3 supertest still passes (backward compat regression — empty filters with no spatial still returns 400 with new message containing "non-empty")
  </acceptance_criteria>

  <done>
    Handler extended with spatial body fields, 5-step validation chain (with WKB 501 BEFORE composeWhereClause call), composeWhereClause replaces buildServerWhereClause; DELETE handler unchanged; tsc clean; v1.3 supertest spec still green.
  </done>
</task>

</tasks>

<verification>
After Task 1:
1. `cd kinetica_bi/server && npx tsc --noEmit` — exits 0.
2. `cd kinetica_bi/server && npx vitest run tests/routes.filter-materialize.spec.ts` — existing 23/23 spec green (v1.3 backward compat preserved).
3. `cd kinetica_bi/server && npx vitest run tests/lib.spatialWhereClause.spec.ts` — Plan 01 spec still green.
4. `grep -c "composeWhereClause(" kinetica_bi/server/src/index.ts` returns ≥ 1 (call site present).
5. `grep -c "WKB mode deferred" kinetica_bi/server/src/index.ts` returns ≥ 2 (one in materialize 501 body, one in pre-existing /api/info/query comment — sanity check that the materialize 501 was added).
6. `grep -c "buildServerWhereClause(filters)" kinetica_bi/server/src/index.ts` returns 0 in the materialize handler (replaced by composeWhereClause; the pre-existing persisted-view endpoint at line 641 may still reference different call signature).
</verification>

<success_criteria>
- WHERE-V15-03: `POST /api/filter/materialize` accepts `{ filters, spatialFilters?, spatialTarget? }`; builds combined WHERE via composeWhereClause; WKB returns 501 BEFORE builder call.
- Backward compat: v1.3 filters-only callers continue to receive 200 (existing 23/23 spec green).
- No regression: tsc clean, Plan 01 spec still green.
</success_criteria>

<output>
After completion, create `.planning/phases/26-server-spatial-where/26-02-materialize-endpoint-SUMMARY.md` capturing:
- Final line numbers of the modified handler (e.g., "index.ts:684-740")
- Validation chain order (5 steps) with the exact error messages used
- 501 body shape verbatim
- Plan 01 spec re-run result (still green)
- Existing routes.filter-materialize.spec.ts result (still 23/23 green)
- Commit hash
</output>
