---
phase: 38-schema-wms-engine-foundation
plan: 03
type: execute
wave: 2
depends_on:
  - 38-01
files_modified:
  - kinetica_bi/server/src/lib/quantileSql.ts
  - kinetica_bi/server/tests/lib.quantileSql.spec.ts
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/src/kinetica.ts
  - kinetica_bi/server/tests/routes.quantile.spec.ts
  - kinetica_bi/src/api/client.ts
autonomous: true
requirements:
  - SCHEMA-V17-06
gap_closure: false

must_haves:
  truths:
    - "SC2: POST /api/quantile returns { breaks: number[] } of length n-1 for a valid numeric column request; supertest cases pass under both AUTH_MODE=password and AUTH_MODE=oidc (single AUTH_MODE-agnostic spec; no TD-V16-TEST-ISOLATION regression)."
    - "buildQuantileSql interpolates schema/table/column/n directly into the locked NTILE template from 37-SPIKE-NOTES.md ## Decision (PARTITION BY 0 + bucket-MIN wrapper); pure module mirroring spatialQuery.ts pattern."
    - "parseQuantileResponse drops bucket 1's MIN (dataset minimum) and returns N-1 upper boundaries that define N classbreak ranges."
    - "Validation gates server-side: n integer in [2,256]; non-empty schema/table/column. Kinetica errors (column doesn't exist / non-numeric / permission denied) pass through verbatim via typed-error middleware."
    - "Frontend quantileFn(args, signal) helper in client.ts mirrors materializeFilter shape (apiFetch + throwForStatus + AbortSignal threading); no in-flight dedup needed (single call per operator click)."
  artifacts:
    - path: "kinetica_bi/server/src/lib/quantileSql.ts"
      provides: "Pure module: buildQuantileSql({schema,table,column,n}) string template + parseQuantileResponse(kineticaResponseJson) number[] (drops bucket 1's MIN, returns N-1 upper boundaries)"
      contains: "NTILE"
    - path: "kinetica_bi/server/tests/lib.quantileSql.spec.ts"
      provides: "Pure unit tests covering buildQuantileSql template interpolation + parseQuantileResponse skip-bucket-1 logic + edge cases"
      contains: "describe"
    - path: "kinetica_bi/server/src/index.ts"
      provides: "POST /api/quantile route mounted between /api/filter/materialize and /api/dynamic-view/* with requireConfig + asyncHandler + typed-error middleware"
      contains: 'app.post("/api/quantile"'
    - path: "kinetica_bi/server/src/kinetica.ts"
      provides: "QUANTILE added to KineticaOp union (audit log filter granularity)"
      contains: '"QUANTILE"'
    - path: "kinetica_bi/server/tests/routes.quantile.spec.ts"
      provides: "AUTH_MODE-agnostic supertest covering happy path, n bounds, empty fields, KineticaPermissionError → 403, KineticaUpstreamError → 502"
      contains: "AUTH_MODE"
    - path: "kinetica_bi/src/api/client.ts"
      provides: "Frontend quantileFn({schema,table,column,n}, signal) → Promise<{breaks:number[]}> mirroring materializeFilter shape"
      contains: "quantileFn"
  key_links:
    - from: "kinetica_bi/server/src/lib/quantileSql.ts buildQuantileSql"
      to: "37-SPIKE-NOTES.md ## Decision § NTILE syntax locked (lines 287-295)"
      via: "Verbatim copy of the bucket-MIN wrapper template with $schema/$table/$column/$n placeholders"
      pattern: "PARTITION BY 0"
    - from: "kinetica_bi/server/src/index.ts POST /api/quantile handler"
      to: "kinetica_bi/server/src/kinetica.ts kineticaSql(req, sql, options)"
      via: "Per-user passthrough; route handler awaits kineticaSql + maps result to {breaks: number[]}"
      pattern: "kineticaSql"
    - from: "kinetica_bi/server/tests/routes.quantile.spec.ts"
      provides: "AUTH_MODE-agnostic mocking strategy"
      to: "kinetica_bi/server/tests/routes.filter-materialize.spec.ts"
      via: "Hoisted openid-client mock + vi.stubGlobal('fetch') + dual describe blocks for both AUTH_MODE values"
      pattern: "AUTH_MODE"
    - from: "kinetica_bi/src/api/client.ts quantileFn"
      to: "kinetica_bi/src/api/client.ts materializeFilter (line 638)"
      via: "Same apiFetch + throwForStatus + AbortSignal pattern; no in-flight dedup (single call per click)"
      pattern: "AbortSignal"

key_links:
  - ".planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §`/api/quantile` endpoint contract (verbatim: request/response shape, validation, AUTH_MODE-agnostic, AbortSignal threading, typed-error mapping, no caching)"
  - ".planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision § NTILE syntax locked (lines 281-294 — VERBATIM SQL template for /api/quantile)"
  - "kinetica_bi/server/src/lib/spatialQuery.ts (PATTERN — pure server-side SQL-builder module + companion spec; mirror for quantileSql.ts)"
  - "kinetica_bi/server/src/kinetica.ts:36-44 (KineticaOp union — add QUANTILE entry)"
  - "kinetica_bi/server/src/kinetica.ts:150-170 (kineticaSql signature: `(req: AuthedRequest, sql: string, options: KineticaSqlOptions) => Promise<unknown>`)"
  - "kinetica_bi/server/src/index.ts:708-807 (POST /api/filter/materialize route — PATTERN: requireConfig + asyncHandler + typed-error bubbling; mount /api/quantile immediately after the DELETE /api/filter/materialize block)"
  - "kinetica_bi/server/tests/routes.filter-materialize.spec.ts (AUTH_MODE-agnostic supertest pattern — verbatim mock + describe-per-mode structure)"
  - "kinetica_bi/src/api/client.ts:638-685 (materializeFilter — PATTERN: apiFetch + throwForStatus + AbortSignal; mirror for quantileFn but DROP the in-flight dedup cache — quantile is single-shot per click)"
---

<objective>
Land the `/api/quantile` server endpoint backing Phase 39's Auto-suggest button + the pure `lib/quantileSql.ts` module that emits the locked NTILE SQL from 37-SPIKE-NOTES.md ## Decision, plus the frontend `quantileFn` client helper. AUTH_MODE-agnostic supertest covers both password and OIDC modes without adding to TD-V16-TEST-ISOLATION.

Purpose: SCHEMA-V17-06. Closes the only Phase 38 requirement not landed by Plans 38-01 + 38-02.

Output: pure quantileSql module + companion spec, POST /api/quantile route mounted in index.ts with per-user kineticaSql passthrough + AUTH_MODE-agnostic supertest, frontend quantileFn client helper.
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
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md
@.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md
@.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md

<interfaces>
<!-- VERBATIM NTILE template from 37-SPIKE-NOTES.md ## Decision lines 287-294 -->
<!-- Phase 38 copies this into lib/quantileSql.ts buildQuantileSql template substitution. -->

```sql
SELECT bucket, MIN($column) AS boundary
FROM (
  SELECT NTILE($n) OVER (PARTITION BY 0 ORDER BY $column) AS bucket, $column
  FROM $schema.$table
)
GROUP BY bucket
ORDER BY bucket
```

Kinetica response shape (37-SPIKE-NOTES.md NTILE-C probe verbatim — line 206):
```json
{
  "column_1":[1,2,3,4,5],
  "column_2":[-100,5.7,7.7,10.1,15.2],
  "column_headers":["bucket","boundary"],
  "column_datatypes":["long","float"]
}
```

`parseQuantileResponse` drops bucket 1's MIN (-100 above — dataset minimum) and returns the remaining 4 upper boundaries: `[5.7, 7.7, 10.1, 15.2]`. For N=5, the response defines 5 classbreak ranges: (-∞, 5.7], (5.7, 7.7], (7.7, 10.1], (10.1, 15.2], (15.2, +∞).

`buildQuantileSql({schema, table, column, n}): string` — pure template substitution. NO escaping (schema/table/column are admin-only trusted metadata sources, matching the spatialQuery.ts trust boundary). Numeric `n` validated by route handler before calling.

`parseQuantileResponse(kineticaResponseJson: unknown): number[]` — narrow to `{ column_2: number[] }` shape; return column_2.slice(1) so bucket 1's MIN is dropped. Throw a typed error if the shape is malformed.

`POST /api/quantile` request body:
```typescript
{ schema: string, table: string, column: string, n: number }
```

`POST /api/quantile` response body (success):
```typescript
{ breaks: number[] }  // length === n - 1
```

`POST /api/quantile` error responses:
- 400 + `{ error: "n must be integer in [2, 256]" }` — n out of bounds
- 400 + `{ error: "schema, table, column required as non-empty strings" }` — missing/empty fields
- 403 + `{ error: "..." }` — KineticaPermissionError (Kinetica passes through verbatim)
- 502 + `{ error: "..." }` — KineticaUpstreamError (Kinetica passes through verbatim)

Frontend client helper signature:
```typescript
export type QuantileArgs = { schema: string; table: string; column: string; n: number };
export type QuantileResponse = { breaks: number[] };

export const quantileFn = async (
  args: QuantileArgs,
  signal?: AbortSignal,
): Promise<QuantileResponse> => { /* apiFetch + throwForStatus pattern */ };
```

KineticaOp union extension (kinetica_bi/server/src/kinetica.ts line 36-44):
```typescript
export type KineticaOp =
  | "SQL"
  | "DISCOVERY"
  | "MATERIALIZE"
  | "WMS"
  | "INFO_QUERY"
  | "DYNAMIC_PREVIEW"
  | "DYNAMIC_MATERIALIZE"
  | "DYNAMIC_DROP"
  | "QUANTILE";   // v1.7 Phase 38 (SCHEMA-V17-06): NTILE bucket-MIN quantile query
```

<!-- kineticaSql signature resolution (revision-2 lock):
     38-CONTEXT.md documented the signature loosely as `kineticaSql(req, sql, abortSignal?)`.
     The ACTUAL signature read verbatim from kinetica_bi/server/src/kinetica.ts:150-154 is:

         export const kineticaSql = async (
           req: AuthedRequest,
           sql: string,
           options: KineticaSqlOptions,
         ): Promise<unknown>;

     where `options: KineticaSqlOptions` is REQUIRED (no `?`) and shaped as
     `{ route: string, op: KineticaOp, extra?: Record<string, unknown> }`. There is no
     AbortSignal arg — cancellation flows via the standard Express request lifecycle
     (no manual AbortSignal threading in v1.6 caller precedents either).

     Plan 38-03 Task 2 emits the literal `kineticaSql(authedReq, sql, { route: "POST /api/quantile", op: "QUANTILE" })`
     call shape. 38-CONTEXT.md's "abortSignal?" doc-line is superseded by this canonical
     signature read. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: lib/quantileSql.ts pure module + companion unit spec</name>
  <files>kinetica_bi/server/src/lib/quantileSql.ts, kinetica_bi/server/tests/lib.quantileSql.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/lib/spatialQuery.ts (PATTERN — pure server-side SQL-builder module; header comment style, trust-boundary docstring, exported builders + types)
    - kinetica_bi/server/tests/lib.spatialQuery.spec.ts (PATTERN for companion spec — describe per builder, positive + negative cases)
    - .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision § NTILE syntax locked (lines 281-294 — VERBATIM template; lines 199-207 — VERBATIM Kinetica response shape)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §`/api/quantile` endpoint contract (locked NTILE template + parseQuantileResponse semantics — drop bucket 1's MIN)
  </read_first>
  <behavior>
    lib.quantileSql.spec.ts:
    - buildQuantileSql({schema:"demo", table:"nyctaxi", column:"fare_amount", n:5}) returns EXACTLY the locked template with substitutions: `"SELECT bucket, MIN(fare_amount) AS boundary FROM ( SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY fare_amount) AS bucket, fare_amount FROM demo.nyctaxi ) GROUP BY bucket ORDER BY bucket"` (whitespace-normalized comparison acceptable).
    - buildQuantileSql preserves $column verbatim across all 4 substitution sites (one in outer SELECT MIN, one in inner SELECT NTILE ORDER BY, one in inner SELECT column projection — total 3 in the template).
    - buildQuantileSql for n=2 → SQL contains "NTILE(2)".
    - buildQuantileSql for n=256 → SQL contains "NTILE(256)".
    - parseQuantileResponse({column_1:[1,2,3,4,5], column_2:[-100,5.7,7.7,10.1,15.2]}) returns [5.7, 7.7, 10.1, 15.2] (4 values for N=5; bucket 1's -100 dropped).
    - parseQuantileResponse({column_1:[1,2], column_2:[0, 10]}) returns [10] (1 value for N=2).
    - parseQuantileResponse({}) throws Error matching /malformed.*quantile.*response/i (no column_2 field).
    - parseQuantileResponse({column_2: "not-an-array"}) throws Error matching /malformed/i.
    - parseQuantileResponse({column_2: []}) throws Error matching /empty|insufficient/i (cannot drop bucket 1 from empty array).
  </behavior>
  <action>
    Create `kinetica_bi/server/src/lib/quantileSql.ts`:

    ```typescript
    /**
     * v1.7 Phase 38 (SCHEMA-V17-06): pure server-side SQL builder + response parser
     * for the /api/quantile endpoint backing Phase 39 Auto-suggest classbreak
     * boundaries.
     *
     * Trust boundary on `schema`, `table`, `column`: names are interpolated DIRECTLY
     * into the SQL without quoting or escaping. They originate from server-side
     * table metadata (admin-only sources) and Phase 39 form pickers populated from
     * the discovery endpoint — NOT from arbitrary user input. Mirrors the equivalent
     * boundary documented in `lib/spatialQuery.ts`.
     *
     * Numeric `n` is typed and validated by the route handler in `index.ts` BEFORE
     * calling buildQuantileSql (n integer in [2, 256] per 38-CONTEXT.md).
     *
     * NTILE template locked verbatim from
     * .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision lines 287-294
     * (PASS HTTP 200 against deployed Kinetica with `PARTITION BY 0` form).
     *
     * Pure module — zero imports beyond Node stdlib. No Express, db, or kinetica.ts
     * dependencies — keeps the unit-test surface minimal.
     */

    export type QuantileSqlArgs = {
      schema: string;
      table: string;
      column: string;
      n: number;
    };

    /**
     * Build the bucket-MIN wrapper NTILE quantile SQL.
     * Verbatim from 37-SPIKE-NOTES.md ## Decision (Probe NTILE-C PASS).
     */
    export function buildQuantileSql(args: QuantileSqlArgs): string {
      return `SELECT bucket, MIN(${args.column}) AS boundary FROM ( SELECT NTILE(${args.n}) OVER (PARTITION BY 0 ORDER BY ${args.column}) AS bucket, ${args.column} FROM ${args.schema}.${args.table} ) GROUP BY bucket ORDER BY bucket`;
    }

    /**
     * Parse Kinetica's encoded NTILE response and return the N-1 upper-boundary
     * values that define N classbreak ranges.
     *
     * Kinetica response shape (37-SPIKE-NOTES.md NTILE-C probe):
     *   { column_1: number[bucket],  column_2: number[boundary],
     *     column_headers: ["bucket","boundary"], column_datatypes: ["long","float"] }
     *
     * For N buckets, column_2 has N entries [bucket1.MIN, bucket2.MIN, ..., bucketN.MIN].
     * bucket1.MIN is the dataset minimum (not a useful upper boundary). We return
     * column_2.slice(1) → [bucket2.MIN, ..., bucketN.MIN] = N-1 values defining N ranges:
     *   (-inf, bucket2.MIN], (bucket2.MIN, bucket3.MIN], ..., (bucketN.MIN, +inf).
     *
     * Throws if the response shape is malformed (column_2 missing or non-array) or
     * insufficient (column_2 empty — cannot drop bucket 1 from nothing). Kinetica
     * permission / upstream errors are caught by the route handler BEFORE calling
     * this — this parser only handles SHAPE-malformed responses on the success path.
     */
    export function parseQuantileResponse(kineticaResponseJson: unknown): number[] {
      if (!kineticaResponseJson || typeof kineticaResponseJson !== "object") {
        throw new Error("malformed quantile response: not an object");
      }
      const obj = kineticaResponseJson as { column_2?: unknown };
      if (!Array.isArray(obj.column_2)) {
        throw new Error("malformed quantile response: column_2 not an array");
      }
      const col2 = obj.column_2 as unknown[];
      if (col2.length === 0) {
        throw new Error("malformed quantile response: column_2 is empty (insufficient buckets)");
      }
      // Validate every entry is a number — Kinetica may emit nulls for non-numeric edge cases.
      const breaks: number[] = [];
      for (let i = 1; i < col2.length; i++) {
        const v = col2[i];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new Error(`malformed quantile response: column_2[${i}] is not a finite number`);
        }
        breaks.push(v);
      }
      return breaks;
    }
    ```

    Create `kinetica_bi/server/tests/lib.quantileSql.spec.ts`:

    ```typescript
    import { describe, it, expect } from "vitest";
    import { buildQuantileSql, parseQuantileResponse } from "../src/lib/quantileSql";

    describe("buildQuantileSql — NTILE template (37-SPIKE-NOTES.md ## Decision locked)", () => {
      it("interpolates schema/table/column/n into the locked PARTITION BY 0 form", () => {
        const sql = buildQuantileSql({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 });
        expect(sql).toContain("NTILE(5)");
        expect(sql).toContain("PARTITION BY 0");
        expect(sql).toContain("ORDER BY fare_amount");
        expect(sql).toContain("FROM demo.nyctaxi");
        expect(sql).toContain("MIN(fare_amount) AS boundary");
        expect(sql).toContain("GROUP BY bucket");
        expect(sql).toContain("ORDER BY bucket");
      });

      it("substitutes column verbatim across all 3 occurrences (outer MIN, inner ORDER BY, inner SELECT)", () => {
        const sql = buildQuantileSql({ schema: "s", table: "t", column: "price", n: 5 });
        const matches = sql.match(/price/g) ?? [];
        expect(matches.length).toBe(3);
      });

      it("emits NTILE(2) for n=2", () => {
        expect(buildQuantileSql({ schema: "s", table: "t", column: "c", n: 2 })).toContain("NTILE(2)");
      });

      it("emits NTILE(256) for n=256", () => {
        expect(buildQuantileSql({ schema: "s", table: "t", column: "c", n: 256 })).toContain("NTILE(256)");
      });
    });

    describe("parseQuantileResponse — drops bucket 1's MIN", () => {
      it("returns N-1 upper boundaries for N=5 (drops bucket 1's MIN which is the dataset minimum)", () => {
        const resp = { column_1: [1, 2, 3, 4, 5], column_2: [-100, 5.7, 7.7, 10.1, 15.2] };
        expect(parseQuantileResponse(resp)).toEqual([5.7, 7.7, 10.1, 15.2]);
      });

      it("returns 1 boundary for N=2", () => {
        const resp = { column_2: [0, 10] };
        expect(parseQuantileResponse(resp)).toEqual([10]);
      });

      it("throws when input is not an object", () => {
        expect(() => parseQuantileResponse(null)).toThrow(/malformed/i);
        expect(() => parseQuantileResponse("string")).toThrow(/malformed/i);
      });

      it("throws when column_2 missing", () => {
        expect(() => parseQuantileResponse({})).toThrow(/malformed.*column_2/i);
      });

      it("throws when column_2 is not an array", () => {
        expect(() => parseQuantileResponse({ column_2: "nope" })).toThrow(/malformed/i);
      });

      it("throws when column_2 is empty (insufficient buckets — cannot drop bucket 1 from nothing)", () => {
        expect(() => parseQuantileResponse({ column_2: [] })).toThrow(/empty|insufficient/i);
      });

      it("throws when any column_2 entry is non-numeric", () => {
        expect(() => parseQuantileResponse({ column_2: [0, "10", 20] })).toThrow(/malformed/i);
      });
    });
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; test -f src/lib/quantileSql.ts &amp;&amp; test -f tests/lib.quantileSql.spec.ts &amp;&amp; grep -q "NTILE" src/lib/quantileSql.ts &amp;&amp; grep -q "PARTITION BY 0" src/lib/quantileSql.ts &amp;&amp; grep -q "buildQuantileSql" src/lib/quantileSql.ts &amp;&amp; grep -q "parseQuantileResponse" src/lib/quantileSql.ts &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run tests/lib.quantileSql.spec.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/server/src/lib/quantileSql.ts && test -f kinetica_bi/server/tests/lib.quantileSql.spec.ts` returns 0.
    - `grep -q "NTILE" kinetica_bi/server/src/lib/quantileSql.ts` AND `grep -q "PARTITION BY 0" kinetica_bi/server/src/lib/quantileSql.ts` both return 0 (locked template emitted).
    - `grep -q "buildQuantileSql" kinetica_bi/server/src/lib/quantileSql.ts` AND `grep -q "parseQuantileResponse" kinetica_bi/server/src/lib/quantileSql.ts` both return 0 (both exports present).
    - Pure module: `! grep -q "from \"express\"" kinetica_bi/server/src/lib/quantileSql.ts && ! grep -q "from \"../db\"" kinetica_bi/server/src/lib/quantileSql.ts && ! grep -q "from \"../kinetica\"" kinetica_bi/server/src/lib/quantileSql.ts` (no framework / db / kinetica imports — mirrors spatialQuery.ts pure-module pattern).
    - `cd kinetica_bi/server && npx vitest run tests/lib.quantileSql.spec.ts --reporter=verbose` reports 0 failures across all 11 spec cases.
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
  <done>
    Pure quantileSql module + 11 unit spec cases all green. Locked NTILE template from 37-SPIKE-NOTES.md is the verbatim emission. Module is import-free of Express / db / kinetica — mirrors spatialQuery.ts.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: POST /api/quantile route in index.ts + KineticaOp QUANTILE entry + AUTH_MODE-agnostic supertest</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/server/src/kinetica.ts, kinetica_bi/server/tests/routes.quantile.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/kinetica.ts:36-44 (KineticaOp union — add "QUANTILE" entry with comment matching DYNAMIC_DROP precedent)
    - kinetica_bi/server/src/kinetica.ts:150-170 (kineticaSql signature — `(req: AuthedRequest, sql: string, options: KineticaSqlOptions) => Promise<unknown>`; options.route + options.op required)
    - kinetica_bi/server/src/index.ts:708-807 (POST /api/filter/materialize — PATTERN to mirror: requireConfig + asyncHandler + body destructure with validation + await kineticaSql + res.json)
    - kinetica_bi/server/src/index.ts:809-849 (DELETE /api/filter/materialize block — mount /api/quantile route IMMEDIATELY AFTER this block per 38-CONTEXT.md "/api/quantile mounts between /api/filter/materialize and /api/dynamic-view/* in chronological v1.3 → v1.6 → v1.7 lineage")
    - kinetica_bi/server/src/index.ts:1379-end (POST /api/info/query — alternative pattern with body validation; mirrors /api/quantile's typed-error flow)
    - kinetica_bi/server/tests/routes.filter-materialize.spec.ts:1-150 + 133-250 (AUTH_MODE-agnostic supertest harness — hoisted openid-client mock + dual describe blocks + vi.stubGlobal('fetch') mocking strategy)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §`/api/quantile` endpoint contract (validation rules + error mapping + AbortSignal + AUTH_MODE-agnostic)
  </read_first>
  <behavior>
    Route behavior (5 cases the supertest covers):
    - HAPPY PATH (password): valid body {schema:"demo", table:"nyctaxi", column:"fare_amount", n:5} → mock kineticaSql returns {column_2:[-100,5.7,7.7,10.1,15.2]} → response 200 + {breaks:[5.7,7.7,10.1,15.2]}.
    - HAPPY PATH (oidc smoke): same as above but with seedOidcSession() cookie.
    - VALIDATION: n=1 → 400 + {error:/n must be integer in \[2, 256\]/}; n=257 → 400; n=1.5 → 400; n omitted → 400.
    - VALIDATION: empty schema/table/column → 400 + {error:/required as non-empty strings/}.
    - KINETICA ERRORS: mock kineticaSql to throw `new KineticaPermissionError("Kinetica permission denied", 403)` → response 403 with body containing the verbatim message. Mock throwing `new KineticaUpstreamError("...", 502)` → response 502 with verbatim message.
  </behavior>
  <action>
    Edit `kinetica_bi/server/src/kinetica.ts` line 36-44 — KineticaOp union extension. Locate the closing `| "DYNAMIC_DROP";` and CHANGE the union to:

    ```typescript
    // QUANTILE (v1.7 Phase 38 — SCHEMA-V17-06): POST /api/quantile NTILE bucket-MIN
    // quantile query backing Phase 39 Auto-suggest classbreak boundaries. Single-shot
    // SQL operation (no DDL); separate op tag for audit granularity.
    export type KineticaOp =
      | "SQL"
      | "DISCOVERY"
      | "MATERIALIZE"
      | "WMS"
      | "INFO_QUERY"
      | "DYNAMIC_PREVIEW"
      | "DYNAMIC_MATERIALIZE"
      | "DYNAMIC_DROP"
      | "QUANTILE";
    ```

    Edit `kinetica_bi/server/src/index.ts` — add the POST /api/quantile route IMMEDIATELY AFTER the DELETE /api/filter/materialize block (which ends near line 849). Locate the closing `}));` of `app.delete("/api/filter/materialize", ...)`, and APPEND the new route block on the next line:

    ```typescript
      // v1.7 Phase 38 (SCHEMA-V17-06): POST /api/quantile — NTILE bucket-MIN quantile
      // query backing Phase 39 Auto-suggest classbreak boundaries. Per-user Kinetica
      // passthrough via kineticaSql (same auth + audit pipeline as /api/filter/materialize
      // + /api/dynamic-view/*). No caching (single round-trip per operator click is
      // acceptable — see 38-CONTEXT.md § /api/quantile endpoint contract).
      //
      // SQL template locked verbatim from .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md
      // ## Decision § NTILE syntax locked (PARTITION BY 0 form + bucket-MIN wrapper).
      //
      // AUTH_MODE-agnostic — works under both password and OIDC modes via the existing
      // kineticaSql credential-type branch.
      app.post("/api/quantile", requireConfig, asyncHandler(async (req, res) => {
        const body = (req.body ?? {}) as {
          schema?: unknown;
          table?: unknown;
          column?: unknown;
          n?: unknown;
        };

        // Validation step 1: schema/table/column non-empty strings
        if (
          typeof body.schema !== "string" || body.schema.length === 0 ||
          typeof body.table !== "string" || body.table.length === 0 ||
          typeof body.column !== "string" || body.column.length === 0
        ) {
          return res.status(400).json({ error: "schema, table, column required as non-empty strings." });
        }

        // Validation step 2: n is an integer in [2, 256]
        if (
          typeof body.n !== "number" ||
          !Number.isInteger(body.n) ||
          body.n < 2 ||
          body.n > 256
        ) {
          return res.status(400).json({ error: "n must be integer in [2, 256]." });
        }

        const { schema, table, column, n } = body as { schema: string; table: string; column: string; n: number };

        // Build SQL via the locked-template module + run via per-user kineticaSql.
        // Kinetica permission / upstream / column-doesn't-exist / non-numeric-column
        // errors bubble through asyncHandler → errorMiddleware unchanged.
        const sql = buildQuantileSql({ schema, table, column, n });
        const authedReq = req as AuthedRequest;
        const encoded = await kineticaSql(authedReq, sql, {
          route: "POST /api/quantile",
          op: "QUANTILE",
        });

        // Parse Kinetica's bucket-MIN response → drop bucket 1's MIN → return N-1 breaks.
        const breaks = parseQuantileResponse(encoded);
        return res.json({ breaks });
      }));
    ```

    Add the imports at the top of `kinetica_bi/server/src/index.ts` if not already present:

    ```typescript
    import { buildQuantileSql, parseQuantileResponse } from "./lib/quantileSql";
    ```

    Create `kinetica_bi/server/tests/routes.quantile.spec.ts` — AUTH_MODE-agnostic supertest. Mirror `routes.filter-materialize.spec.ts` exactly:

    1. Hoisted openid-client mock block (verbatim copy from filter-materialize spec lines 24-70).
    2. `vi.mock("openid-client", () => ({ Issuer: mocks.Issuer, custom: ..., errors: ... }))`.
    3. Imports: `buildTestApp`, `createSession`, `resetOidcClientForTests`, `db`, `createDashboard`, `createTable`.
    4. Top-level constants: `AUTH_SECRET`, `KINETICA_URL`, `SESSION_PASSWORD`, `FAKE_OIDC_ACCESS_TOKEN`.
    5. `cleanFixtures()` drops sessions + tables + dashboards.
    6. `makeSessionCookie()` + `seedOidcSession()` (verbatim copy from filter-materialize spec).
    7. `mockKineticaQuantileSuccess(breaksJson)` helper — `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "OK", data_str: JSON.stringify({ json_encoded_response: JSON.stringify(breaksJson) }) }), { status: 200 })))`.
    8. Two describe blocks: `describe("POST /api/quantile — AUTH_MODE=password", ...)` and `describe("POST /api/quantile — AUTH_MODE=oidc", ...)`. Each with `vi.stubEnv("AUTH_MODE", ...)` + `cleanFixtures()` in beforeEach, `vi.unstubAllEnvs()` in afterEach.
    9. Test cases per the 5 behavior bullets above. For Kinetica error mocks, stub global fetch to return HTTP 403 / 500 Kinetica responses that classifyHttpError will map to KineticaPermissionError / KineticaUpstreamError; assert response.status === 403 / 502.

    Example happy-path test body:

    ```typescript
    it("returns { breaks: number[] } of length n-1 for valid body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "OK",
              data_str: JSON.stringify({
                json_encoded_response: JSON.stringify({ column_1: [1,2,3,4,5], column_2: [-100, 5.7, 7.7, 10.1, 15.2] }),
              }),
            }),
            { status: 200 }
          )
        )
      );
      const agent = await buildTestApp();
      const { cookie } = makeSessionCookie();
      const response = await agent
        .post("/api/quantile")
        .set("Cookie", cookie)
        .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 })
        .expect(200);
      expect(response.body).toEqual({ breaks: [5.7, 7.7, 10.1, 15.2] });
    });
    ```

    Validation tests (n out of bounds + empty fields) do NOT need to stub fetch — the route returns 400 before reaching kineticaSql.

    Permission error test:

    ```typescript
    it("returns 403 when Kinetica returns HTTP 403 permission denied", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
      const agent = await buildTestApp();
      const { cookie } = makeSessionCookie();
      await agent
        .post("/api/quantile")
        .set("Cookie", cookie)
        .send({ schema: "demo", table: "nyctaxi", column: "fare_amount", n: 5 })
        .expect(403);
    });
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi/server &amp;&amp; grep -q '"QUANTILE"' src/kinetica.ts &amp;&amp; grep -q 'app.post("/api/quantile"' src/index.ts &amp;&amp; grep -q "buildQuantileSql" src/index.ts &amp;&amp; grep -q "parseQuantileResponse" src/index.ts &amp;&amp; test -f tests/routes.quantile.spec.ts &amp;&amp; grep -q "AUTH_MODE=password" tests/routes.quantile.spec.ts &amp;&amp; grep -q "AUTH_MODE=oidc" tests/routes.quantile.spec.ts &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run tests/routes.quantile.spec.ts --reporter=verbose</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q '"QUANTILE"' kinetica_bi/server/src/kinetica.ts` returns 0 (KineticaOp union extended).
    - `grep -q 'app.post("/api/quantile"' kinetica_bi/server/src/index.ts` returns 0 (route mounted).
    - `grep -q "buildQuantileSql" kinetica_bi/server/src/index.ts` AND `grep -q "parseQuantileResponse" kinetica_bi/server/src/index.ts` both return 0 (both imports used).
    - Route mount location: route appears AFTER `/api/filter/materialize` DELETE handler. Check: `grep -n 'app.post("/api/filter/materialize"\|app.delete("/api/filter/materialize"\|app.post("/api/quantile"' kinetica_bi/server/src/index.ts` shows /api/quantile line number > both /api/filter/materialize lines.
    - requireConfig + asyncHandler used: `grep -q 'app.post("/api/quantile", requireConfig, asyncHandler' kinetica_bi/server/src/index.ts` returns 0.
    - `test -f kinetica_bi/server/tests/routes.quantile.spec.ts` returns 0.
    - BOTH AUTH_MODEs covered: `grep -q "AUTH_MODE=password" kinetica_bi/server/tests/routes.quantile.spec.ts && grep -q "AUTH_MODE=oidc" kinetica_bi/server/tests/routes.quantile.spec.ts` returns 0.
    - Hoisted openid-client mock present: `grep -q "vi.hoisted" kinetica_bi/server/tests/routes.quantile.spec.ts` returns 0.
    - `cd kinetica_bi/server && npx vitest run tests/routes.quantile.spec.ts --reporter=verbose` reports 0 failures (all 5+ supertest cases pass under both modes).
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
    - **kineticaSql signature arg-shape lock (revision-2):** `grep -q 'route: "POST /api/quantile"' kinetica_bi/server/src/index.ts && grep -q 'op: "QUANTILE"' kinetica_bi/server/src/index.ts` returns 0 (literal `{ route: "POST /api/quantile", op: "QUANTILE" }` options-object passed as the 3rd arg, matching the canonical kineticaSql signature at kinetica.ts:150-154 — NOT an AbortSignal which 38-CONTEXT.md's doc-line mis-described).
  </acceptance_criteria>
  <done>
    POST /api/quantile route ships at the locked mount point with per-user Kinetica passthrough; AUTH_MODE-agnostic supertest passes both password + OIDC modes; QUANTILE audit-op tag landed. SC2 satisfied at the server layer.
  </done>
</task>

<task type="auto">
  <name>Task 3: Frontend quantileFn client helper (mirrors materializeFilter shape)</name>
  <files>kinetica_bi/src/api/client.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts:38-85 (apiFetch + throwForStatus pattern)
    - kinetica_bi/src/api/client.ts:601-685 (materializeFilter — PATTERN: types + helper + apiFetch + body JSON + throwForStatus on !ok; DROP the inFlightMaterialize dedup cache — quantile is single-shot)
    - .planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md §`/api/quantile` endpoint contract (AbortSignal threading, error pass-through via useApiQuery — no toast)

    **Wave-2 parallel-edit coordination:** Plan 38-02's Task 3 also modifies
    `kinetica_bi/src/api/client.ts` at a different location (DashboardLayerDto extension
    ~line 454-476 + updateLayer Pick&lt;&gt; ~line 498-518, both near top-of-file). The
    executor MUST apply 38-02 Task 3 (DashboardLayerDto extension) BEFORE THIS task
    (38-03 Task 3 — quantileFn export at end-of-file) to avoid merge conflicts. Both
    edits land additively; no overwrites. If the executor reads the current file state
    immediately before writing, sequential application is safe.
  </read_first>
  <action>
    Edit `kinetica_bi/src/api/client.ts` — APPEND the quantileFn helper near the END of the file (after the existing dropFilterView helper, before the closing of the file). Keep the helpers chronologically grouped: v1.3 materializeFilter → v1.4 info-query → v1.5 spatial → v1.6 dynamic-view → v1.7 quantile.

    Locate a sensible insertion point (e.g. between the dropFilterView block and the dynamic-view family). Add:

    ```typescript
    // ---------------------------------------------------------------------------
    // v1.7 Phase 38 (SCHEMA-V17-06): /api/quantile client helper for Phase 39
    // Auto-suggest classbreak boundaries.
    //
    // Server route: POST /api/quantile { schema, table, column, n } → { breaks: number[] }.
    // SQL template locked in .planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision.
    //
    // AbortSignal threading mirrors materializeFilter — Phase 39 Auto-suggest button
    // wires a dedicated AbortController so rapid re-clicks cancel the in-flight call.
    // NO in-flight dedup needed (single quantile call per operator action; not a fan-out).
    //
    // Error contract: throwForStatus maps 401/403/502 to ReauthRequiredError /
    // PermissionError / UpstreamError (typed-error chain). Phase 39 useApiQuery
    // surfaces failures as inline error text under the [Auto-suggest] CTA — no toast.
    // ---------------------------------------------------------------------------

    export type QuantileArgs = {
      schema: string;
      table: string;
      column: string;
      n: number;
    };

    export type QuantileResponse = {
      breaks: number[];   // length === n - 1 (server drops bucket 1's MIN per 37-SPIKE-NOTES.md)
    };

    export const quantileFn = async (
      args: QuantileArgs,
      signal?: AbortSignal,
    ): Promise<QuantileResponse> => {
      const response = await apiFetch(`${API_BASE}/api/quantile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to fetch quantile breaks");
      }
      return response.json() as Promise<QuantileResponse>;
    };
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi &amp;&amp; grep -q "quantileFn" src/api/client.ts &amp;&amp; grep -q "QuantileArgs" src/api/client.ts &amp;&amp; grep -q "QuantileResponse" src/api/client.ts &amp;&amp; grep -q "/api/quantile" src/api/client.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "quantileFn" kinetica_bi/src/api/client.ts` returns 0 (helper exported).
    - `grep -q "QuantileArgs" kinetica_bi/src/api/client.ts` AND `grep -q "QuantileResponse" kinetica_bi/src/api/client.ts` both return 0 (types exported).
    - `grep -q '"/api/quantile"' kinetica_bi/src/api/client.ts || grep -q "/api/quantile" kinetica_bi/src/api/client.ts` returns 0 (URL hardcoded).
    - Uses apiFetch + throwForStatus pattern: `grep -B2 -A12 "quantileFn" kinetica_bi/src/api/client.ts | grep -q "apiFetch"` returns 0 (matches materializeFilter pattern).
    - AbortSignal threading: `grep -B2 -A12 "quantileFn" kinetica_bi/src/api/client.ts | grep -q "signal"` returns 0 (signal arg + signal in fetch options).
    - NO in-flight dedup cache: `grep -B2 -A20 "quantileFn" kinetica_bi/src/api/client.ts | grep -q "inFlight" && exit 1; exit 0` (the new helper does NOT introduce an inFlight* Map — verify absence).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
    - Frontend full vitest stays green: `cd kinetica_bi && npx vitest run --reporter=verbose 2>&1 | tail -10` reports 0 failures.
  </acceptance_criteria>
  <done>
    Frontend quantileFn helper landed mirroring materializeFilter shape minus the in-flight dedup; AbortSignal threaded; Phase 39 Auto-suggest button has a typed client helper ready. Frontend tsc + vitest both clean.
  </done>
</task>

</tasks>

<verification>
End-to-end checks for Plan 38-03:

1. Pure module + spec: `cd kinetica_bi/server && npx vitest run tests/lib.quantileSql.spec.ts --reporter=verbose` reports 0 failures across 11 unit cases.
2. Route + supertest: `cd kinetica_bi/server && npx vitest run tests/routes.quantile.spec.ts --reporter=verbose` reports 0 failures across the AUTH_MODE-agnostic describe blocks (≥5 cases per mode).
3. Server tsc clean: `cd kinetica_bi/server && npx tsc --noEmit` exits 0.
4. Frontend tsc clean: `cd kinetica_bi && npx tsc --noEmit` exits 0.
5. Frontend full vitest stays green: `cd kinetica_bi && npx vitest run --reporter=verbose 2>&1 | tail -10` reports 0 failures.
6. Locked template emission: `grep -A1 "buildQuantileSql" kinetica_bi/server/src/lib/quantileSql.ts | grep -q "NTILE" && grep -q "PARTITION BY 0" kinetica_bi/server/src/lib/quantileSql.ts` (37-SPIKE-NOTES.md ## Decision locked verbatim).
7. No TD-V16-TEST-ISOLATION regression: `grep -c "AUTH_MODE=" kinetica_bi/server/tests/routes.quantile.spec.ts` returns ≥2 (both modes exercised in single spec file).
8. Mount location: `grep -n "app.post(\"/api/quantile\"\|app.delete(\"/api/filter/materialize\"" kinetica_bi/server/src/index.ts` shows quantile line > filter-materialize delete line (chronological placement honored).
</verification>

<success_criteria>
- `lib/quantileSql.ts` pure module ships with buildQuantileSql + parseQuantileResponse exports; 11 companion unit spec cases all green.
- POST /api/quantile route mounted with requireConfig + asyncHandler + typed-error middleware; validates n ∈ [2,256] + non-empty schema/table/column; passes through per-user Kinetica via kineticaSql.
- AUTH_MODE-agnostic supertest passes under both password and OIDC modes (≥5 cases per mode).
- KineticaOp union gains QUANTILE entry for audit-log granularity.
- Frontend quantileFn helper mirrors materializeFilter shape (apiFetch + throwForStatus + AbortSignal); no in-flight dedup (single-shot per operator click).
- Server tsc + frontend tsc + frontend vitest all clean.
- ROADMAP Phase 38 SC2 (POST /api/quantile returning {breaks:number[]} under both AUTH_MODE values) satisfied by this plan's exit.
</success_criteria>

<output>
After completion, create `.planning/phases/38-schema-wms-engine-foundation/38-03-SUMMARY.md` documenting:
- buildQuantileSql template substitution shape (verbatim from 37-SPIKE-NOTES.md)
- parseQuantileResponse drop-bucket-1 logic + malformed-shape error cases
- Route mount location (between /api/filter/materialize DELETE and /api/dynamic-view/* per 38-CONTEXT.md)
- KineticaOp QUANTILE audit tag rationale
- AUTH_MODE-agnostic supertest mocking strategy (vi.stubGlobal fetch with Kinetica response envelope shape)
- quantileFn client helper rationale (no in-flight dedup — single-shot)
- Test counts (11 quantileSql unit specs + ~10 routes.quantile supertest cases across both modes = ~21 new green tests)
</output>
