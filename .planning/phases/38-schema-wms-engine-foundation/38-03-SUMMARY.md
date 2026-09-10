---
phase: 38-schema-wms-engine-foundation
plan: "03"
subsystem: server-api, frontend-api
tags: [quantile, ntile, classbreak, auto-suggest, pure-module, tdd, auth-mode-agnostic]
dependency_graph:
  requires:
    - "38-01: DashboardLayer cb_config + track_config schema + CRUD"
    - "38-02: DashboardLayerDto + wmsUrlBuilder Lane C rewrite"
  provides:
    - "lib/quantileSql.ts: buildQuantileSql + parseQuantileResponse (SCHEMA-V17-06)"
    - "POST /api/quantile: per-user NTILE bucket-MIN query returning { breaks: number[] }"
    - "KineticaOp QUANTILE: audit-granularity tag for quantile queries"
    - "quantileFn client helper: Phase 39 Auto-suggest button typed consumer"
    - "28 new green tests: 11 pure unit + 17 supertest (both AUTH_MODE values)"
  affects:
    - "Phase 39: CB form Auto-suggest button wires quantileFn({ schema, table, column, n })"
    - "Phase 43: UAT includes classbreak tile visual + quantile boundary accuracy verification"
tech_stack:
  added: []
  patterns:
    - "TDD RED→GREEN per task (spec RED-confirmed before implementation)"
    - "Pure server-side SQL-builder module mirroring spatialQuery.ts"
    - "AUTH_MODE-agnostic supertest: dual describe blocks + vi.stubEnv + vi.hoisted openid-client mock"
    - "KineticaOp union extension for audit log granularity"
    - "Frontend client helper mirroring materializeFilter shape minus in-flight dedup"
key_files:
  created:
    - kinetica_bi/server/src/lib/quantileSql.ts
    - kinetica_bi/server/tests/lib.quantileSql.spec.ts
    - kinetica_bi/server/tests/routes.quantile.spec.ts
  modified:
    - kinetica_bi/server/src/kinetica.ts
    - kinetica_bi/server/src/index.ts
    - kinetica_bi/src/api/client.ts
decisions:
  - "NTILE SQL template copied verbatim from 37-SPIKE-NOTES.md ## Decision (PARTITION BY 0 form — PASS)"
  - "parseQuantileResponse validates each column_2 entry is finite number (guards against Kinetica null emissions)"
  - "Route inlined in index.ts (matches /api/filter/materialize precedent — no routes/ dir exists)"
  - "No in-flight dedup in quantileFn (single-shot per operator click vs fan-out pattern of materializeFilter)"
  - "n validation: integer in [2, 256] — Phase 11 cardinality cap precedent"
metrics:
  duration: "~4 minutes"
  completed: "2026-05-20"
  tasks: 3
  files: 6
---

# Phase 38 Plan 03: Quantile Endpoint Summary

**One-liner:** POST /api/quantile NTILE bucket-MIN endpoint using locked 37-SPIKE-NOTES.md SQL template, pure lib/quantileSql.ts module with parseQuantileResponse drop-bucket-1 logic, KineticaOp QUANTILE audit tag, AUTH_MODE-agnostic supertest (28 tests), and quantileFn client helper mirroring materializeFilter shape.

## What Was Built

### Task 1 — lib/quantileSql.ts pure module + 11 unit specs

**Files created:** `kinetica_bi/server/src/lib/quantileSql.ts`, `kinetica_bi/server/tests/lib.quantileSql.spec.ts`

#### buildQuantileSql

Pure template function — no imports beyond Node stdlib. Emits the locked NTILE PARTITION BY 0 template verbatim from `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md ## Decision lines 287-294`:

```
SELECT bucket, MIN(<column>) AS boundary FROM ( SELECT NTILE(<n>) OVER (PARTITION BY 0 ORDER BY <column>) AS bucket, <column> FROM <schema>.<table> ) GROUP BY bucket ORDER BY bucket
```

Trust boundary: `schema`, `table`, `column` are interpolated directly without escaping (admin-only sources, same boundary as `spatialQuery.ts`). `n` is validated integer-in-[2,256] by the route handler before calling.

#### parseQuantileResponse

Narrows the Kinetica columnar NTILE response to `{ column_2: number[] }`. Returns `column_2.slice(1)` — drops bucket 1's MIN (the dataset minimum, not a useful upper boundary), returning N-1 upper boundaries defining N classbreak ranges:

```
(-∞, bucket2.MIN], (bucket2.MIN, bucket3.MIN], ..., (bucketN.MIN, +∞)
```

Throws on: not-an-object, column_2 missing, column_2 non-array, column_2 empty, column_2[i] non-finite-number.

#### 11 spec cases

| Describe | Tests |
|----------|-------|
| buildQuantileSql — NTILE template | 4 (PARTITION BY 0, 3 column occurrences, n=2, n=256) |
| parseQuantileResponse — drops bucket 1's MIN | 7 (N=5 happy path, N=2 happy path, not-object, column_2 missing, non-array, empty, non-numeric entry) |

### Task 2 — POST /api/quantile route + KineticaOp QUANTILE + AUTH_MODE-agnostic supertest

**Files modified:** `kinetica_bi/server/src/kinetica.ts`, `kinetica_bi/server/src/index.ts`
**Files created:** `kinetica_bi/server/tests/routes.quantile.spec.ts`

#### KineticaOp extension

Added `| "QUANTILE"` to the union in `kinetica.ts` with a comment referencing SCHEMA-V17-06. Audit log entries for quantile queries emit `"op":"QUANTILE"` and `"route":"POST /api/quantile"`.

#### Route mount location

`app.post("/api/quantile", requireConfig, asyncHandler(...))` at `index.ts:858` — after `/api/filter/materialize` DELETE (line 823) and before `/api/dynamic-view/*` routes (chronological v1.3 → v1.6 → v1.7 lineage per 38-CONTEXT.md).

#### Validation

- Step 1: `schema`, `table`, `column` non-empty strings → 400 `"schema, table, column required as non-empty strings."`
- Step 2: `n` integer in `[2, 256]` → 400 `"n must be integer in [2, 256]."`
- Kinetica errors bubble through asyncHandler → typed-error middleware (KineticaPermissionError → 403, KineticaUpstreamError → 502)

#### kineticaSql call (verbatim lock)

```typescript
await kineticaSqlHelper(authedReq, sql, {
  route: "POST /api/quantile",
  op: "QUANTILE",
});
```

3rd arg is `KineticaSqlOptions` (REQUIRED, not optional) per canonical kinetica.ts:150-154 signature. Not an AbortSignal — 38-CONTEXT.md's doc-line was superseded.

#### AUTH_MODE-agnostic supertest

`routes.quantile.spec.ts` mirrors `routes.filter-materialize.spec.ts` exactly:

- `vi.hoisted` block: mocked openid-client `Issuer` (constructor + static `discover`)
- `vi.mock("openid-client", ...)`: suppresses network calls on OIDC boot
- Dual describe blocks: `AUTH_MODE=password` (12 cases) + `AUTH_MODE=oidc` (5 cases) = 17 total
- Happy path fetch mock: `{ status: "OK", data_str: JSON.stringify({ json_encoded_response: JSON.stringify({ column_1, column_2 }) }) }` — matches kineticaSql's envelope parse
- Kinetica error mocks: raw HTTP 403 / 500 responses → classifyHttpError → typed errors → error middleware → 403 / 502
- Validation cases (400s) do NOT stub fetch — route short-circuits before kineticaSql call

### Task 3 — quantileFn client helper appended to end of client.ts

**File modified:** `kinetica_bi/src/api/client.ts` (append at line 1046 — after dropDynamicView)

```typescript
export type QuantileArgs = { schema: string; table: string; column: string; n: number };
export type QuantileResponse = { breaks: number[] };

export const quantileFn = async (
  args: QuantileArgs,
  signal?: AbortSignal,
): Promise<QuantileResponse> => {
  const response = await apiFetch(`${API_BASE}/api/quantile`, { ... signal });
  if (!response.ok) await throwForStatus(response, "Failed to fetch quantile breaks");
  return response.json() as Promise<QuantileResponse>;
};
```

Mirrors `materializeFilter` shape exactly — `apiFetch` + `throwForStatus` + `AbortSignal` threading. Drops the `inFlightMaterialize` dedup cache: quantile is single-shot per operator click (not a fan-out).

No regression on Plan 38-02's DashboardLayerDto changes (this append is additively at end-of-file; 38-02 modified top-of-file).

## Decisions Made

1. **NTILE template verbatim copy from 37-SPIKE-NOTES.md:** No re-derivation. The PARTITION BY 0 form was HTTP/visual-verified in Phase 37; Phase 38 locks it as-is.
2. **parseQuantileResponse validates finite-number on each column_2 entry:** Kinetica may emit null for non-numeric edge cases; guarding against that avoids a runtime `NaN` leak into the classbreak UI.
3. **Route inline in index.ts:** Matches the `/api/filter/materialize` precedent. No `routes/` directory exists; extracting would require a module pattern not yet established.
4. **No in-flight dedup in quantileFn:** materializeFilter's `inFlightMaterialize` cache was added post-verify because RecordsTableRenderer + AggregatedWidgetRenderer fire parallel requests on the same table. Quantile is triggered by a single operator button click — no fan-out scenario.

## Deviations from Plan

None — plan executed exactly as written.

## Success Criteria Verification

- [x] lib/quantileSql.ts created with NTILE + PARTITION BY 0 (grep verified)
- [x] buildQuantileSql + parseQuantileResponse both exported (grep verified)
- [x] Pure module — no Express/db/kinetica imports (grep-negative verified)
- [x] 11 unit spec cases all green
- [x] KineticaOp QUANTILE added (grep verified)
- [x] app.post("/api/quantile", requireConfig, asyncHandler) mounted (grep verified)
- [x] Route after /api/filter/materialize DELETE (line 858 > 823 > 722)
- [x] kineticaSql called with { route: "POST /api/quantile", op: "QUANTILE" } (grep verified)
- [x] both AUTH_MODE values covered in routes.quantile.spec.ts (grep verified)
- [x] vi.hoisted openid-client mock present (grep verified)
- [x] 17 supertest cases all green
- [x] quantileFn at end of client.ts (grep verified)
- [x] QuantileArgs + QuantileResponse types exported (grep verified)
- [x] AbortSignal threaded (grep verified)
- [x] No inFlight dedup (grep-negative verified)
- [x] Server tsc clean
- [x] Frontend tsc clean
- [x] Frontend full vitest: 1051/1051 pass (no regression on 38-02 DashboardLayerDto)

## Self-Check

Files exist:
- [x] kinetica_bi/server/src/lib/quantileSql.ts (created)
- [x] kinetica_bi/server/tests/lib.quantileSql.spec.ts (created)
- [x] kinetica_bi/server/tests/routes.quantile.spec.ts (created)
- [x] kinetica_bi/server/src/kinetica.ts (modified — QUANTILE op)
- [x] kinetica_bi/server/src/index.ts (modified — route + import)
- [x] kinetica_bi/src/api/client.ts (modified — quantileFn appended)

Commits exist:
- [x] 4284a86 feat(38-03): lib/quantileSql.ts pure module + 11 unit specs (SCHEMA-V17-06)
- [x] 5246b86 feat(38-03): POST /api/quantile route + KineticaOp QUANTILE + AUTH_MODE-agnostic supertest (SCHEMA-V17-06)
- [x] 41a88a4 feat(38-03): quantileFn client helper in client.ts (SCHEMA-V17-06)

## Self-Check: PASSED
