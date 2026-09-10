# Phase 38: Schema + WMS Engine Foundation - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Server-side and URL-builder foundation for v1.7. Phase 38 ships:
1. PRAGMA-guarded `dashboard_layers` ALTER migration adding two nullable TEXT JSON columns: `cb_config` + `track_config` (mirrors v1.4 Phase 19 `info_columns`/`info_template` + v1.6 Phase 35 `dynamic_view_id` precedents).
2. Full DTO + CRUD extension end-to-end — server `DashboardLayer` type + `mapDashboardLayer` projection + `updateDashboardLayer` (with the `"key" in attrs` discriminant pattern) + PATCH route + frontend `DashboardLayerDto` — for both new JSON fields.
3. `kinetica_bi/src/lib/wmsUrlBuilder.ts` rewrite per Phase 37 spike findings — Lane C param set under `STYLES=cb_raster` (always — single STYLES path for all CB rendering), 8-char AARRGGBB color format via `normalizeAARRGGBB`, additive `DOTRACKS=TRUE` + TRACK_* block when `trackConfig.enabled === true`. **Hard cutover from legacy** Lane A code path (`CB_COLUMN_NAME`/`CB_BREAK_POINT_N`).
4. New `POST /api/quantile` server endpoint using NTILE bucket-MIN wrapper SQL from `37-SPIKE-NOTES.md`. Per-user Kinetica creds passthrough (existing `kineticaSql` helper). AUTH_MODE-agnostic supertests.
5. Pure helper modules `lib/trackDetect.ts` (`isTrackTable(columns)`) + `lib/cbConfig.ts` (defaults + NULL coalescer + type narrowing). Unit specs only — call sites land in Phase 40 / Phase 39.
6. Fix the existing `wmsUrlBuilder.ts:337` 6-char RRGGBB color bug as a side-effect of the Lane C swap.

In scope: schema migration + DTO/CRUD + wmsUrlBuilder rewrite + /api/quantile endpoint + 2 helper modules. Nothing user-visible ships in this phase — the form UI lands in Phase 39 (CB form), Phase 40 (Track sub-section), Phase 41 (LayersLegendPanel).

Out of scope: form UI changes (Phase 39+), Track sub-section UI (Phase 40), LayersLegendPanel component (Phase 41), standalone Legend chart type (Phase 42), TD-V16-TEST-ISOLATION fix (deferred to v1.8+), TD-V14-WKB-SPIKE retry (deferred), legacy v1.2 classbreak widget migration (HARD CUTOVER — operators reconfigure existing classbreak widgets via Phase 39 UI).

</domain>

<decisions>
## Implementation Decisions

### STYLES decision logic — always `cb_raster` (Lane C superset)

When `cb_config !== null` on a layer (operator has picked Class Break in Phase 39+), wmsUrlBuilder ALWAYS emits `STYLES=cb_raster` with the Lane C param set:

```text
STYLES=cb_raster
CB_ATTR=<cb_config.attr>
CB_VALS=<comma-separated values from cb_config.breaks[].value; supports <other> verbatim>
POINTCOLORS=<comma-separated 8-char AARRGGBB from cb_config.breaks[].color via normalizeAARRGGBB>
POINTSIZES=<comma-separated integers from cb_config.breaks[].pointSize; optional>
POINTSHAPES=<comma-separated shape names from cb_config.breaks[].pointShape; optional>
SHAPELINEWIDTHS=<optional comma-sep>
SHAPELINECOLORS=<optional comma-sep, 8-char>
SHAPEFILLCOLORS=<optional comma-sep, 8-char>
X_ATTR=<config.lonColumn>
Y_ATTR=<config.latColumn>
```

`STYLES=classbreak` (Lane B basic-only) is NOT emitted by Phase 38 code. Single path = simpler mental model + matches operator's domain confirmation that CB_RASTER is the working advanced path. Lane B remains in `37-SPIKE-NOTES.md` Decision as documentation; not used in production.

### Per-break label storage — client-side only

`cb_config.breaks[].label` is pure presentation. `wmsUrlBuilder` does NOT pass labels in the WMS URL. Phase 41 `<LayersLegendPanel />` reads labels directly from `cb_config.breaks[]` via the Zustand store. Keeping labels out of the URL avoids speculative CB_LABELS WMS param testing (Phase 37 did not probe it) and decouples legend rendering from tile rendering.

### `<other>` bucket — verbatim in CB_VALS

When `cb_config.breaks[]` contains an entry with `value === "<other>"`, emit it verbatim into the comma-separated `CB_VALS` string. Kinetica accepts the literal `<other>` keyword as a sink bucket (Phase 37 SPIKE-V17-02 confirmed, OQ-3 PASS). When `cb_config.includeOtherBucket === true` is true but no `<other>` row exists in `breaks[]`, wmsUrlBuilder does NOT auto-inject — Phase 39 form is responsible for placing the row when the operator toggles it ON.

### RenderMode surface — 3 user-facing modes (Raster | Heatmap | Class Break)

The `RenderMode` TypeScript type stays at the existing 4 values (`raster | heatmap | classbreak | contour`) — preserves contour as internal dead-code path and avoids RenderMode type churn affecting unrelated tests. **Phase 39 form picker filters to 3 user-facing modes:** Raster, Heatmap, Class Break. The form's "Class Break" option sets `renderMode = 'classbreak'` and populates `cb_config`. wmsUrlBuilder then emits `STYLES=cb_raster` (per the STYLES decision above).

### Legacy widget backward-compat — HARD CUTOVER

Existing v1.2 Phase 11 classbreak widgets (with legacy `config.cbColumn` + `config.classbreaks[]` fields but no `cb_config`) render as `STYLES=raster` after Phase 38 ships. No read-shim, no migration script.

- v1.7 MILESTONES entry documents the cutover.
- Operators reconfigure existing classbreak widgets via the Phase 39 form (new `cb_config` shape).
- Justification: PROJECT.md analysis shows no operator-reported in-prod classbreak widgets exist (the v1.2 classbreak code path was the abandoned WMS-QUERY filter approach, superseded by v1.3 LAYERS-swap; classbreak rendering was never widely deployed). The risk envelope is low.
- Concrete impact: when `cb_config === null` (the post-migration default), wmsUrlBuilder takes the raster branch regardless of `config.classbreaks[]` content.
- Phase 38 SCHEMA-V17-03 DELETES the existing classbreak branch at `wmsUrlBuilder.ts:325-340` and replaces it with the cb_raster path keyed on `cb_config`.

### `/api/quantile` endpoint contract

**Request:** `POST /api/quantile` with JSON body `{ schema: string, table: string, column: string, n: number }`.

**Response (success):** `{ breaks: number[] }` of length `n - 1`. (Quantile boundaries: drop bucket 1's MIN — it's the dataset minimum, not a useful upper bound; return upper boundaries for N-1 buckets defining N classbreak ranges.)

**Validation (server-side):**
- `n` must be integer in `[2, 256]` (Phase 11 cardinality-probe cap precedent).
- `schema`, `table`, `column` must be non-empty strings.
- Anything beyond that — column doesn't exist, table empty, column non-numeric, Kinetica permission denied — Kinetica's native error passes through as 400/4xx with verbatim message (matches the existing kinetica-error pattern from v1.6 Phase 34 `throwForStatus`).

**Auth + access:** Per-user passthrough via the existing `kineticaSql(req, sql, abortSignal?)` helper from v1.0 Phase 2. Each operator's Kinetica creds run their own quantile query; Kinetica enforces table-level access. AUTH_MODE-agnostic — works in both password and OIDC modes via `buildAuthHeader(req)`.

**SQL template (verbatim from `37-SPIKE-NOTES.md` Decision):**
```sql
SELECT bucket, MIN($column) AS boundary
FROM (
  SELECT NTILE($n) OVER (PARTITION BY 0 ORDER BY $column) AS bucket, $column
  FROM $schema.$table
)
GROUP BY bucket
ORDER BY bucket
```

**Server module:** `kinetica_bi/server/src/lib/quantileSql.ts` — pure SQL-builder module mirroring v1.5 Phase 26 `lib/spatialQuery.ts` pattern. Exports:
- `buildQuantileSql({ schema, table, column, n }): string` — template substitution
- `parseQuantileResponse(kineticaResponseJson): number[]` — pulls `column_2[1..N-1]` (skipping bucket 1's lower bound)

**Endpoint module:** route handler in `kinetica_bi/server/src/index.ts` mounted as `app.post("/api/quantile", ...)` between the existing `/api/filter/materialize` and `/api/dynamic-view/*` routes.

**No caching.** Quantile latency is dominated by Kinetica's NTILE evaluation; server-side caching adds significant cache-invalidation complexity for marginal benefit. If operator usage shows the Auto-suggest button is clicked rapidly + repeatedly, revisit in v1.8.

**AbortSignal threading:** Frontend `quantileFn({ schema, table, column, n }, signal): Promise<{ breaks: number[] }>` in `kinetica_bi/src/api/client.ts` mirrors v1.3 Phase 14 `materializeFilter(args, signal)` shape. Per-request AbortController; in-flight requests cancelled on rapid re-click. No in-flight Promise dedup needed (single quantile call per operator action; not a fan-out).

**Error response shape:** Standard v1.0 Phase 3 typed-error middleware. `KineticaUpstreamError` → 502, `KineticaPermissionError` → 403, validation failures → 400 with `{ code, message }`. Frontend uses `useApiQuery` hook (v1.0 Phase 3); Phase 39 Auto-suggest button surfaces failures as inline error text under the [Auto-suggest] CTA — no toast.

**Supertest:** `kinetica_bi/server/tests/routes.quantile.spec.ts` — AUTH_MODE-agnostic test pattern (NOT per-AUTH_MODE-only). Test cases:
- valid payload PASS (returns `{ breaks: number[] }` of length n-1)
- `n` out of [2,256] → 400
- empty `column` → 400
- Kinetica permission denied → 403 (mocked)
- Kinetica upstream error → 502 (mocked)

Must NOT add to TD-V16-TEST-ISOLATION red. Pattern: assert against both modes by reading `AUTH_MODE` env at test setup and running per-mode assertions in a single spec file.

### Schema migration — extend the v1.4 Phase 19 PRAGMA pattern

Pure mechanical extension of the existing `db.ts:159-187` block (which already does `info_enabled`/`info_columns`/`info_template`/`dynamic_view_id`):

```typescript
// v1.6 → v1.7 migration: add cb_config + track_config columns
if (!layerColNames.has("cb_config")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN cb_config TEXT");
}
if (!layerColNames.has("track_config")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN track_config TEXT");
}
```

Both columns are nullable TEXT (NOT `NOT NULL` — NULL = "not yet configured"). Phase 38 acceptance: second server restart against an existing v1.6 SQLite DB produces no migration errors (idempotent).

`CREATE TABLE IF NOT EXISTS dashboard_layers (...)` block in `db.ts:83-105` also gains the two new columns (covers fresh deployments).

### DTO + CRUD extension — extend `"key" in attrs` discriminant pattern

Extend the existing pattern at `db.ts:490-525` (already handles info_* + dynamic_view_id with the same idiom):

- `DashboardLayer` type in `types.ts` gains `cb_config: string | null` and `track_config: string | null` (raw JSON strings; deserialized at frontend boundary via `lib/cbConfig.ts`).
- `mapDashboardLayer` row projection at `db.ts:213-230` gains `cb_config: row.cb_config ?? null, track_config: row.track_config ?? null`.
- `updateDashboardLayer` accepts `cb_config` and `track_config` keys in `Pick<>`; uses `"key" in attrs ? attrs.key : existing.key` discriminant (NOT `??`) so explicit `null` clears the field while omitted key preserves.
- `UPDATE dashboard_layers SET ... cb_config = ?, track_config = ?, ...` extends the existing SET list.
- PATCH route at `index.ts:583-602` `app.patch("/api/dashboards/:id/layers/:layerId", ...)` accepts the two new keys in the body. Existing `body` destructure pattern continues.
- Frontend `DashboardLayerDto` in `kinetica_bi/src/api/client.ts` mirrors the server type (byte-parity).

### Pure helper modules — `lib/trackDetect.ts` + `lib/cbConfig.ts`

**`kinetica_bi/src/lib/trackDetect.ts`** — pure helper, no React, no Zustand, no async:

```typescript
export type TrackColumns = {
  trackIdCol: string;
  xCol: string;
  yCol: string;
  orderCol: string;
};

// Strict 4 names case-insensitive: TRACKID + x + y + TIMESTAMP. Returns matched
// column names (preserving original casing from columns list) when all 4 present;
// otherwise returns null. Operator override (Phase 40 TRACK-V17-02) is the
// escape hatch for non-standard schemas.
export function isTrackTable(columns: { name: string }[]): TrackColumns | null;
```

Match rules:
- TRACKID — case-insensitive exact match on `TRACKID`
- x — case-insensitive exact match on `x`
- y — case-insensitive exact match on `y`
- TIMESTAMP — case-insensitive exact match on `TIMESTAMP`

NO alias support (no `track_id` / `lat` / `lon` / `time` / `ts` matches). NO column type checks. Operator override picks up the slack for non-standard tables.

Spec file: `kinetica_bi/src/lib/trackDetect.spec.ts` — vitest unit tests covering:
- All 4 columns present (case-insensitive variations) → returns matched TrackColumns
- Missing TRACKID → returns null
- Missing x → returns null
- Missing y → returns null
- Missing TIMESTAMP → returns null
- Empty columns array → returns null
- Extra columns present + all 4 required → returns matched (extras ignored)

**`kinetica_bi/src/lib/cbConfig.ts`** — pure helpers mirroring v1.4 Phase 19 `mapInfoConfig.ts` pattern:

```typescript
export type CbBreak = {
  value: string | number;
  color: string;          // 8-char AARRGGBB (Phase 38 emits, Phase 39 form supplies)
  label?: string;
  pointSize?: number;
  pointShape?: string;
  shapeLineWidth?: number;
  shapeLineColor?: string;
  shapeFillColor?: string;
};

export type CbConfig = {
  attr: string;
  valsType: "numeric" | "categorical";
  breaks: CbBreak[];
  includeOtherBucket?: boolean;
};

export const EMPTY_CB_CONFIG: CbConfig = {
  attr: "",
  valsType: "numeric",
  breaks: [],
};

export function coalesceCbConfig(raw: string | null): CbConfig;       // null/parse-fail → EMPTY_CB_CONFIG
export function isCbConfigConfigured(cfg: CbConfig): boolean;          // attr non-empty + breaks.length > 0
export function isNumericValsType(cfg: CbConfig): boolean;             // type narrowing
export function isCategoricalValsType(cfg: CbConfig): boolean;
```

NO Zod validation (zod is not in this codebase; matches existing TypeScript-types-only pattern).

Spec file: `kinetica_bi/src/lib/cbConfig.spec.ts` — vitest unit tests covering the helpers with positive/negative inputs.

**`lib/trackDetect.ts` call site**: NONE in Phase 38. Helper + spec only. Phase 40 form UI is the first consumer.

**`lib/cbConfig.ts` call site**: ONE in Phase 38 — `wmsUrlBuilder.ts` reads `coalesceCbConfig(layer.cb_config)` before emitting Lane C params. Phase 39 form UI is the second consumer (mutating the config from form inputs).

### 6-char color bug fix (SCHEMA-V17-05)

Existing `wmsUrlBuilder.ts:337` `params[\`CB_POINTCOLOR_${n}\`] = b.color.toUpperCase()` emits 6-char RRGGBB. The bug naturally disappears as a side-effect of the Lane C cutover — the new code path is:

```typescript
params.POINTCOLORS = cb_config.breaks
  .map(b => normalizeAARRGGBB(b.color, "FF000000"))
  .join(",");
```

`normalizeAARRGGBB` already exists at `wmsUrlBuilder.ts:25` (imported from `colorHex`) — the raster + heatmap branches already use it. Phase 38 brings the CB branch into the same conformance.

Regression spec: `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` adds a test asserting that a `cb_config` with `breaks: [{color: "FF112233", value: 10}]` emits `POINTCOLORS=FF112233` (NOT `112233`). This spec locks the format so the bug cannot silently re-appear.

### Track block in wmsUrlBuilder (SCHEMA-V17-04)

New conditional block appended to `wmsUrlBuilder` after the render-mode branch:

```typescript
if (trackConfig?.enabled && (config.renderMode === "raster" || config.renderMode === "classbreak")) {
  params.DOTRACKS = "TRUE";
  if (trackConfig.trackIdAttr) params.TRACK_ID_ATTR = trackConfig.trackIdAttr;
  if (trackConfig.trackOrderAttr) params.TRACK_ORDER_ATTR = trackConfig.trackOrderAttr;

  // Under STYLES=cb_raster (the only CB path we emit), TRACK_* params are comma-separated
  // matching CB_VALS length per operator domain note + Phase 37 spike OQ-8.
  // Under STYLES=raster, TRACK_* params are single-value.
  const isCb = STYLES_BY_MODE[config.renderMode] === "cb_raster";
  const breakCount = isCb ? coalesceCbConfig(layer.cb_config).breaks.length : 1;
  // ... emit TRACK_* params expanded to breakCount via comma-sep when isCb, else single value
}
```

**Backward-compat lock:** Legacy widgets (with `trackConfig === undefined` OR `trackConfig.enabled !== true`) produce IDENTICAL WMS URLs to the pre-v1.7 code — verified by a regression spec that snapshots URLs for known legacy configs.

### `lastEmittedParamsRef` fingerprint (PITFALL coverage)

`MapChartRenderer.tsx` uses `lastEmittedParamsRef` to dedupe `imageWmsSource.updateParams` calls. Phase 38 extends the fingerprint computation to cover all new CB_* + TRACK_* params so style edits (color picker, break-row mutations, track-color changes from Phase 39+40 forms) trigger a tile re-render. Without this, the operator could change a CB color and see no tile update.

**Phase 38 scope:** Update the fingerprint computation in `MapChartRenderer.tsx` (or wherever it lives) to include `cb_config` JSON + `track_config` JSON serialized to a stable key. Reading-only consumer — no form UI work; that's Phase 39.

### Claude's Discretion

Areas explicitly left for the planner / executor:

- **Migration-block placement in `db.ts`:** Add the cb_config + track_config ALTER block immediately after the v1.6 `dynamic_view_id` block (line ~187) for chronological order. Final placement is planner's call.
- **PATCH route body validation:** Reject unknown keys vs silently ignore them. Existing pattern at `index.ts:583-602` uses Pick-style destructure; planner mirrors.
- **`/api/quantile` route module location:** Inline in `index.ts` (matches `/api/filter/materialize` precedent) vs extracted into `routes/quantile.ts` (would require route-modularization that doesn't exist yet). Inline is the path of least resistance.
- **Supertest mocking strategy for `/api/quantile`:** Mock `kineticaSql` to return synthetic NTILE response shape; Kinetica permission/upstream errors mocked separately. Planner picks mock library aligned with existing v1.3 Phase 13 `routes.filter-materialize.spec.ts` pattern.
- **`buildWmsParams` return type:** Stays as `Record<string, string>` (current shape) — planner doesn't refactor.
- **`config.cbColumn` + `config.classbreaks[]` legacy field handling:** Phase 38 LEAVES these fields in place on layer rows (don't DELETE; just don't read). v1.8 cleanup can remove them. Type definitions stay loose enough to accept legacy shapes.
- **`lib/quantileSql.ts` test surface:** Pure unit tests (no Kinetica) for `buildQuantileSql` template + `parseQuantileResponse` parsing. Endpoint tests (with mocked Kinetica) cover the route-handler behavior.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 38 requirements + roadmap
- `.planning/REQUIREMENTS.md` §"Schema + WMS Engine Foundation" — SCHEMA-V17-01..07 literal requirements
- `.planning/ROADMAP.md` §"Phase 38: Schema + WMS Engine Foundation" — Goal + 5 success criteria
- `.planning/PROJECT.md` §"Current Milestone: v1.7" — milestone scope + open tech-debt

### Spike outputs (CANONICAL for SCHEMA-V17-03/04/05/06)
- `.planning/phases/37-cb-track-wms-spike/37-SPIKE-NOTES.md` §"Decision" — exact CB param-name set + color format + NTILE SQL template + DOTRACKS+TRACK_* matrix locked verbatim. **Phase 38 implementer reads this first** and copies SQL/URL templates into the production code without re-probing.
- `.planning/phases/37-cb-track-wms-spike/37-VERIFICATION.md` — confirms which downstream phases (38/39/40/41/42/43) are unblocked + Phase 43 UAT precondition for Track visual

### Schema migration pattern (mirror these)
- `kinetica_bi/server/src/db.ts:159-187` — v1.4 Phase 19 + v1.6 Phase 35 PRAGMA-guarded ALTER block; Phase 38 appends two new ALTER statements here
- `kinetica_bi/server/src/db.ts:83-105` — `CREATE TABLE IF NOT EXISTS dashboard_layers` block; Phase 38 adds two new columns here
- `kinetica_bi/server/src/db.ts:490-525` — `updateDashboardLayer` with `"key" in attrs` discriminant pattern; Phase 38 extends this

### DTO + CRUD pattern (mirror these)
- `kinetica_bi/server/src/types.ts:61` — `DashboardLayer` type; Phase 38 adds `cb_config: string | null` and `track_config: string | null`
- `kinetica_bi/server/src/db.ts:213-230` — `mapDashboardLayer` row projection; Phase 38 adds the two fields here
- `kinetica_bi/server/src/index.ts:583-602` — PATCH `/api/dashboards/:id/layers/:layerId` route; Phase 38 accepts the two new body keys

### wmsUrlBuilder current state + integration points
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:25` — `normalizeAARRGGBB` import (Phase 38 CB branch uses this for 8-char color emission)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:27` — `RenderMode` type (Phase 38 leaves at 4 values; form UI in Phase 39 filters)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:80-97` — current MapWidgetConfig shape (Phase 38 leaves `cbColumn`/`classbreaks?` legacy fields untouched; doesn't read them)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:146-149` — `STYLES_BY_MODE` map (Phase 38 changes the `classbreak` value from `"classbreak"` to `"cb_raster"`)
- `kinetica_bi/src/lib/wmsUrlBuilder.ts:325-340` — current classbreak branch (Phase 38 DELETES this and replaces with cb_raster path reading from `coalesceCbConfig(layer.cb_config)`)

### Helper module precedents (mirror these)
- `kinetica_bi/src/lib/mapInfoConfig.ts` — v1.4 Phase 19 helper module; mirror this shape for `lib/cbConfig.ts`
- `kinetica_bi/src/lib/spatialTargets.ts` — v1.5 Phase 28 helper module with type narrowing + EMPTY constant pattern
- `kinetica_bi/server/src/lib/spatialQuery.ts` — v1.5 Phase 26 server-side SQL-builder module; mirror this for `lib/quantileSql.ts`
- `kinetica_bi/server/src/lib/spatialWhereClause.ts` — v1.5 Phase 26 server-side pure module with companion supertest

### `/api/quantile` endpoint precedents (mirror these)
- `kinetica_bi/server/src/index.ts` — `app.post("/api/filter/materialize", ...)` (v1.3 Phase 13); `app.post("/api/dynamic-view/...", ...)` (v1.6 Phase 32). Phase 38 mounts `app.post("/api/quantile", ...)` between these.
- `kinetica_bi/server/src/kinetica.ts:154-170` — `kineticaSql(req, sql, abortSignal?)` helper; Phase 38 `/api/quantile` route handler calls this with the NTILE SQL.
- `kinetica_bi/server/src/index.ts` global error middleware — typed-error mapping (KineticaUpstreamError → 502, KineticaPermissionError → 403, validation → 400)

### Frontend client helper precedents (mirror these)
- `kinetica_bi/src/api/client.ts` — existing helpers: `materializeFilter(args, signal)` (v1.3 Phase 14), `dropFilterView(args, signal)` (v1.3 Phase 14), `dynamic-view` family (v1.6 Phase 33). Phase 38 adds `quantileFn({ schema, table, column, n }, signal)` mirroring `materializeFilter` shape.
- `kinetica_bi/src/api/client.ts:79` — `throwForStatus` verbatim-message handler (v1.6 Phase 34 fix); `/api/quantile` errors flow through this.

### Test pattern precedents (mirror these — AUTH_MODE-agnostic)
- `kinetica_bi/server/tests/routes.filter-materialize.spec.ts` — v1.3 Phase 13; AUTH_MODE-agnostic pattern (NOT TD-V16-TEST-ISOLATION-tainted)
- `kinetica_bi/server/tests/routes.dynamic-view*.spec.ts` — v1.6 Phase 32; same pattern
- `kinetica_bi/src/lib/mapInfoConfig.spec.ts` — pure-helper unit-spec pattern

### TD-V16-TEST-ISOLATION constraint
- `.planning/PROJECT.md` §"Carried-in tech debt" — TD-V16-TEST-ISOLATION explanation; new server specs MUST be AUTH_MODE-agnostic (single spec asserts under both modes via `AUTH_MODE` env at setup) so they don't add to the cross-mode-isolation red count
- Phase 36 server vitest failures pattern (don't reproduce)

### `lastEmittedParamsRef` fingerprint reference
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — `lastEmittedParamsRef` + `imageWmsSource.updateParams` dedupe pattern (v1.3 Phase 16); Phase 38 extends the fingerprint computation to cover `cb_config` + `track_config` JSON

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`kinetica_bi/server/src/db.ts:159-187`** — PRAGMA-guarded ALTER pattern: read `PRAGMA table_info(table)` into a Set, then `if (!set.has(col)) instance.exec("ALTER TABLE ... ADD COLUMN ...")`. **Phase 38 appends 2 new entries here.**
- **`kinetica_bi/server/src/db.ts:490-525`** — `updateDashboardLayer` with `"key" in attrs` discriminant (NOT `??`) so explicit null clears + omitted key preserves. **Phase 38 extends the `Pick<>` and the UPDATE SQL with 2 new fields.**
- **`kinetica_bi/server/src/lib/spatialQuery.ts`** — Pure server-side SQL-builder module + companion spec. **Mirror this shape for `lib/quantileSql.ts`.**
- **`kinetica_bi/src/lib/mapInfoConfig.ts`** — Pure helper module with EMPTY constant + null-coalescer + type narrowing. **Mirror this shape for `lib/cbConfig.ts`.**
- **`kinetica_bi/src/lib/wmsUrlBuilder.ts:25`** — `normalizeAARRGGBB(color, default)` already imported; raster + heatmap branches already call it. **Phase 38 CB branch joins the conformance.**
- **`kinetica_bi/server/src/kinetica.ts:154-170`** — `kineticaSql(req, sql, abortSignal?)` per-user passthrough helper. **`/api/quantile` route calls this directly.**
- **`kinetica_bi/src/api/client.ts`** — `materializeFilter(args, signal)` shape; Phase 38 `quantileFn(args, signal)` mirrors.

### Established Patterns

- **PRAGMA-guarded idempotent ALTER** — locked since v1.1 Phase 4 sessions migration; reused at v1.4 Phase 19 + v1.6 Phase 35; Phase 38 = 4th reuse. Second-restart-no-error invariant verified by supertest in each prior reuse.
- **`"key" in attrs` discriminant in CRUD** — explicit null clears, omitted key preserves. Locked since v1.4 Phase 19; Phase 38 extends.
- **Pure helper module + companion spec** — locked across v1.4 (`mapInfoConfig`), v1.5 (`spatialTargets`, `spatialQuery`, `spatialWhereClause`), v1.6 (`dynamicViewName`, `dynamicViewSql`, `materializedView`). Phase 38 ships 3 new helpers in this pattern (`lib/cbConfig.ts`, `lib/trackDetect.ts`, `lib/quantileSql.ts`).
- **`/api/*` route mounted on `createApp()` Express app + global typed-error middleware** — v1.0 Phase 3 + v1.3 Phase 13 + v1.6 Phase 32; Phase 38 reuses.
- **AUTH_MODE-agnostic supertest pattern** — single spec asserts behavior under both `AUTH_MODE=password` and `AUTH_MODE=oidc`; avoids per-mode spec contamination (TD-V16-TEST-ISOLATION lock).

### Integration Points

- **`db.ts:83-105` + `159-187`** — schema migration block
- **`db.ts:213-230`** — `mapDashboardLayer` projection
- **`db.ts:490-525`** — `updateDashboardLayer` CRUD
- **`types.ts:61`** — `DashboardLayer` type
- **`index.ts:583-602`** — PATCH route
- **`index.ts`** — Express `app.post("/api/quantile", ...)` mount (between filter-materialize and dynamic-view routes)
- **`wmsUrlBuilder.ts:146-149`** — `STYLES_BY_MODE` map (`classbreak → "cb_raster"` swap)
- **`wmsUrlBuilder.ts:325-340`** — current classbreak branch (DELETE; replace with cb_raster path)
- **`wmsUrlBuilder.ts`** — new Track block appended after the render-mode branch
- **`client.ts`** — frontend `quantileFn(args, signal)` helper added
- **`client.ts`** — frontend `DashboardLayerDto` extended with `cb_config: string | null` + `track_config: string | null`
- **`MapChartRenderer.tsx`** — `lastEmittedParamsRef` fingerprint extension (read `cb_config` + `track_config` from layer rows)

### Risks & Anti-Patterns to Avoid

- **Don't read legacy `config.classbreaks[]`** — hard cutover locked. wmsUrlBuilder's classbreak branch must NOT have a "if cb_config is null, fall back to config.classbreaks[]" read-shim. Existing classbreak widgets render as raster after Phase 38 lands.
- **Don't add Zod runtime validation for cb_config / track_config JSON** — codebase pattern is TypeScript types + boundary `JSON.parse` only. Adding Zod is scope creep (Phase 39 form UI does client-side validation before PATCH submit).
- **Don't auto-inject `<other>` in wmsUrlBuilder** — Phase 39 form is responsible for placing the `<other>` row when operator toggles it. wmsUrlBuilder is a pure URL emitter; no semantic decisions.
- **Don't break the `MapChartRenderer.tsx` `lastEmittedParamsRef` invariant** — every new param shape must appear in the fingerprint, or style edits silently no-op. Regression test the fingerprint.
- **Don't drop or refactor `RenderMode = "raster" | "heatmap" | "classbreak" | "contour"` type** — leave `contour` in place; Phase 39 form filters in the picker.
- **Don't add new server vitest specs that fail under both AUTH_MODE values** — TD-V16-TEST-ISOLATION carry; AUTH_MODE-agnostic specs only.
- **Don't emit `STYLES=classbreak` (Lane B)** — single path = `STYLES=cb_raster` (Lane C) when `cb_config !== null`. Lane B is documented in `37-SPIKE-NOTES.md` only; Phase 38 code emits Lane C exclusively.

</code_context>

<specifics>
## Specific Ideas

- **Operator's domain-confirmed CB_RASTER + comma-sep model** drives the always-`cb_raster` STYLES decision. Validated by Phase 37 spike (Lane C PASS, byte-differentiated 15597 from baseline 27384) + operator's verbal confirmation that `POINTSIZES=4,5,2` etc. is the working production path.
- **`normalizeAARRGGBB` re-use** — function already exists at `colorHex` module + imported in wmsUrlBuilder. Phase 38 CB branch calls it identically to raster + heatmap branches. Zero new color-format code; bug fix is mechanical.
- **Hard cutover is operator-approved** — no read-shim, no migration script. Legacy classbreak widgets that exist (per PROJECT.md analysis, none reported in prod) render as raster until reconfigured via Phase 39 form. v1.7 MILESTONES entry documents the cutover.
- **`/api/quantile` mounts between `/api/filter/materialize` and `/api/dynamic-view/*`** in `index.ts` — chronological order matching the v1.3 → v1.6 → v1.7 lineage.
- **trackDetect: strict 4 names case-insensitive — TRACKID, x, y, TIMESTAMP** — exact match on the Kinetica 7.1 docs default attr names. No aliases. Operator override (Phase 40 TRACK-V17-02 checkbox) is the escape hatch.

</specifics>

<deferred>
## Deferred Ideas

- **CB_LABELS WMS param** — Phase 37 did not spike-test it; Phase 41 LayersLegendPanel renders labels client-side from `cb_config.breaks[].label`. Revisit if Kinetica adds native label support that obviates the client component.
- **Quantile result server-side caching** — quantile is deterministic for stable data, but cache invalidation is non-trivial. Single Kinetica round-trip per operator click is acceptable for v1.7.
- **Quantile method picker (equal-interval / k-means / Natural Breaks)** — defer to v1.8+; v1.7 ships NTILE-only (quantile) per CONTEXT.md from `/gsd:new-milestone`.
- **Aggressive pre-flight validation (column-exists + numeric-type)** — would double `/api/quantile` latency; Kinetica error pass-through covers the cases.
- **Zod schema validation for `cb_config` + `track_config` JSON** — adds a runtime dep (zod) not currently in the codebase. Phase 39 form UI handles client-side validation before PATCH submit.
- **CB_RASTER auto-detection** — there is no separate "advanced" render mode in Phase 39; one CB option that always emits cb_raster.
- **`lib/trackDetect.ts` call-site wiring** — Phase 38 ships helper + spec only; Phase 40 form UI is the first consumer. Avoids scope creep.
- **v1.2 legacy `config.cbColumn` + `config.classbreaks[]` field cleanup** — Phase 38 LEAVES these in place on layer rows. v1.8 cleanup can remove them.
- **Migration script for existing v1.2 classbreak widgets → new cb_config shape** — explicitly rejected (hard cutover); operator reconfigures via Phase 39 form.
- **In-memory `/api/quantile` cache** — explicitly rejected. Single round-trip is acceptable.
- **`/api/quantile` route extraction into `routes/quantile.ts` module** — codebase has no `routes/` directory; inline in `index.ts` mirrors `/api/filter/materialize` precedent.
- **Track auto-detect column type checks** — names-only check; operator override handles edge cases.
- **Track auto-detect aliases (`track_id`, `lat`, `lon`, `time`, `ts`)** — strict 4-name match only. Aliases revisited in v1.8+ if operator UX surfaces friction.
- **OIDC-mode probing for `/api/quantile`** — supertest is AUTH_MODE-agnostic (works both modes); live OIDC verification moves to Phase 43 UAT walk-through.

</deferred>

---

*Phase: 38-schema-wms-engine-foundation*
*Context gathered: 2026-05-19*
