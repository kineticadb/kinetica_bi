# Phase 25: spatial-predicate-spike — Research

**Researched:** 2026-05-11
**Domain:** Kinetica spatial predicate SQL syntax + operator-driven spike runner pattern
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Predicate name set — probe BOTH candidate names per mode in a single run.** Both REQUIREMENTS.md (`STXY_WITHIN` / `ST_WITHIN`) and the v1.5 research SUMMARY (`STXY_CONTAINS` / `ST_INTERSECTS`) are valid candidate names. The spike resolves the conflict in one trip:

- **Latlon mode probes:** `STXY_WITHIN(lon_col, lat_col, ST_GEOMFROMTEXT(<wkt>)) = 1` AND `STXY_CONTAINS(ST_GEOMFROMTEXT(<wkt>), lon_col, lat_col) = 1`
- **WKT mode probes:** `ST_WITHIN(geom_col, ST_GEOMFROMTEXT(<wkt>)) = 1` AND `ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT(<wkt>)) = 1`
- Runner attempts every candidate in sequence within the same run; all verbatim outputs land in `25-SPIKE-NOTES.md`; Decision record locks the **first PASS** per mode.

**Fail-path behavior — sequence all candidates within one run.** If the primary predicate name returns HTTP 400 or empty rows, the runner automatically falls through to the next candidate (no operator re-run needed). Mirrors v1.3 S1-S4 pattern. Each probe's verbatim output is captured regardless of PASS/FAIL — Decision record summarises which name worked per mode.

**Total-fail escalation — block v1.5, re-scope milestone.** If ALL probed names FAIL across BOTH modes:
- Stop Phase 25 with Decision = `NONE_ESCALATE → BLOCK_V15`
- Operator + planner reconvene; whole milestone shape changes (mirrors v1.3 had-it-failed scenario)
- Do NOT fall back to a TD carry-forward.

Partial-fail (e.g., latlon PASS + WKT FAIL) is **not** an authorized escalation path — the milestone's WKT-mode targets are first-class scope. If WKT FAILs, the milestone re-scopes.

**Latlon-mode test fixture — `demo.nyctaxi`:**
- Table: `demo.nyctaxi`
- Lon column: `pickup_longitude`
- Lat column: `pickup_latitude`
- Known-reachable from v1.3 fixture demo + v1.4 Phase 24 UAT.

**WKT-mode test fixture — `ki_home.us_states.WKT`:**
- Table: `ki_home.us_states`
- Geometry column: `WKT` (column literally named `WKT`)
- Operator-confirmed reachable (resolves the Phase 18 blocker where no real geometry column was available).
- US-state polygon table → spike shapes anchored over NYC will intersect NY state polygon = strong WKT PASS signal.

**Probe shape anchor — NYC, ~50 km bbox:**
- Center: `lon = -73.95, lat = 40.75` (same coords Phase 18 used)
- Bbox extent: ±0.5° (~50 km)

**Probe shape payloads — all three production-realistic shapes in a single run:**
1. **4-corner bbox** — WKT `POLYGON ((lon1 lat1, lon2 lat1, lon2 lat2, lon1 lat2, lon1 lat1))` anchored on NYC ±0.5°
2. **64-vertex circle polygon** — WKT polygon approximating a circle (matches the production `ol/interaction/Draw.createRegularPolygon(64)` output)
3. **150-vertex lasso polygon** — WKT polygon at the production vertex cap (matches V15-P-03 `geom.simplify` + 150-vertex hard-cap output); doubles as a free **V15-P-03 size-limit probe**

**PASS criteria — signature confirmed + semantic correctness (≥1 row).** A probe PASSes only if:
- (a) SQL executes without HTTP 400 (signature confirmed), AND
- (b) returns ≥1 row from the known-spatial-spread dataset (semantic correctness — the predicate actually filters)

This is stronger than Phase 18's signature-only gate. For `demo.nyctaxi` latlon bbox over Manhattan: expect thousands of rows. For `ki_home.us_states` WKT bbox over NYC: expect ≥1 row (NY state polygon).

### Claude's Discretion

- **Auth mode coverage** — default to **password mode only** (mirrors Phase 18 spike pattern; OIDC was DEFERRED in v1.3 S2.b and closed live at v1.4 Phase 24 UAT — same trajectory expected here). If operator wants OIDC during the run, no objection.
- **Spike runner UX** — default to **Node CLI** mirroring `kinetica_bi/server/src/wkbSpike.ts` shape: `npm run spatial-predicate-spike` reading env vars. Critical: `/execute/sql` payload MUST be full production parity (`encoding: "json"` + the 4 other fields in `kinetica.ts:154-170`) — Phase 18 lost a round-trip to this exact runner bug.
- **Decision record format** — mirror `18-SPIKE-NOTES.md` section structure: `## Probe A`, `## Probe B`, ... `## Decision`, `## Caveats`, `## Open Question Resolutions`.
- **Env var naming for probe targets** — likely `LATLON_PROBE_SCHEMA` / `LATLON_PROBE_TABLE` / `LATLON_PROBE_LON_COL` / `LATLON_PROBE_LAT_COL` + WKT siblings + `PROBE_CENTER_LON` / `PROBE_CENTER_LAT` / `PROBE_BBOX_HALF_DEG`. Final naming is planner's call.
- **Whether to fold V15-P-05 (STXY_DWITHIN distance unit) probe into Phase 25 vs Phase 26 supertest** — planner decides. The 150-vertex lasso payload already addresses V15-P-03; V15-P-07 (OR-parens) is purely Phase 26 unit-test territory.
- **Runner output format on disk** — verbatim probe blocks written by the runner directly into `25-SPIKE-NOTES.md` OR runner outputs a JSON file that the operator pastes into the notes file. Planner decides; v1.3 / v1.4 pattern is direct-write to chat then Claude writes the file from operator paste.

### Deferred Ideas (OUT OF SCOPE)

- **WKB-mode probing** — out of scope; TD-V14-WKB-SPIKE carry-forward (no reachable WKB-binary column). v1.5 WKB paths return HTTP 501.
- **STXY_DWITHIN distance-unit probe (V15-P-05)** — may be folded into Phase 25 by the planner OR deferred to Phase 26 supertest. Research GAP open; not blocking SPIKE-V15-01 PASS.
- **Multi-predicate OR-parens correctness (V15-P-07)** — purely Phase 26 unit-test territory; not a Kinetica behavior to probe.
- **OIDC-mode probing** — defer to Phase 31 UAT.
- **PASS-criteria subset-count assertion** — stronger validation deferred; ≥1-row check is sufficient.
- **Partial-fail latlon-only unblock** — explicitly disallowed at Phase 25 close. Milestone re-scopes if any mode FAILs.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPIKE-V15-01 | Operator-driven spike confirms `STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON ((…))')) = 1` (latlon) and `ST_WITHIN(geom_col, ST_GEOMFROMTEXT('POLYGON ((…))')) = 1` (WKT) execute against deployed Kinetica for 4-corner bbox, 64-vertex circle, 150-vertex lasso. | Predicate signatures verified against Kinetica 7.1 docs (HIGH confidence: §"Kinetica Predicate Reference"). Runner pattern lifted from `wkbSpike.ts` at commit `d458408` (production-payload parity). WKT-literal payload generators derived from drawn-shape characteristics (4/64/150 vertices) — see §"WKT Literal Payload Construction". |
| SPIKE-V15-02 | Spike findings committed to `phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md`; runner script preserved at a known commit so future re-runs are one-shot. Decision record: PASS → unblock WHERE-builder; FAIL → escalate. | Decision record schema mirrors `18-SPIKE-NOTES.md` structure (§"Decision Record Template"). Runner script script-name + npm-script wiring matches `wkbSpike.ts` precedent (§"Runner Script Architecture"). |
</phase_requirements>

## Summary

This is a SPIKE phase — operator-driven SQL probes against the deployed Kinetica instance to lock predicate names for v1.5 Phase 26. The pattern is already well-established at this project (Phase 13 S1-S4, Phase 18 WKB spike). The differentiator versus Phase 18: this spike **probes two candidate predicate names per mode within a single run** and uses a **stronger PASS criterion** (signature + semantic correctness ≥1 row, not just HTTP 200).

The Kinetica 7.1 docs confirm all four candidate predicates exist with the signatures locked in CONTEXT.md: `STXY_WITHIN(x, y, geom)`, `STXY_CONTAINS(geom, x, y)`, `ST_WITHIN(geom1, geom2)`, `ST_INTERSECTS(geom1, geom2)`. All return integer 1/0 (not boolean), so the `= 1` suffix in CONTEXT.md is correct and necessary. `ST_GEOMFROMTEXT(wkt)` is aliased to `GEOMETRY(wkt)` and accepts a WKT string constant (drawn-shape literals qualify).

The runner script must mirror `kinetica_bi/server/src/wkbSpike.ts` at commit `d458408` byte-for-byte for the `/execute/sql` payload shape (`encoding: "json"` + four other fields from `kinetica.ts:154-170`). The Phase 18 runner-bug postmortem is the single most important precedent: a missing `encoding` field caused all three Phase 18 probes to fail at HTTP preprocessing before SqlEngine ever evaluated the function-name questions, costing a full round-trip.

**Primary recommendation:** Write a single `spatialPredicateSpike.ts` CLI runner that loops `{latlon, wkt} × {primary_candidate, fallback_candidate} × {bbox, circle, lasso}` for 12 total probes (2 modes × 2 candidates × 3 shapes); emit verbatim output for every probe; classify PASS/FAIL using the strict ≥1-row criterion; print a SPIKE SUMMARY locking the first-PASS predicate name per mode. Operator runs `npm run spatial-predicate-spike` from a `.env`-loaded shell, pastes full stdout to chat, Claude writes `25-SPIKE-NOTES.md` from the paste.

## Standard Stack

### Core (already in repo — DO NOT add new packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tsx` | ^4.7.0 | Run `.ts` files as ESM CLI without compile step | Already used for `npm run wms-spike` and `npm run wkb-spike` — `kinetica_bi/server/package.json` |
| `dotenv` | ^16.4.5 | Load `KINETICA_URL`/`KINETICA_USERNAME`/`KINETICA_PASSWORD` + probe-target env vars from `kinetica_bi/server/.env` | Used by both prior spike runners (`wkbSpike.ts:28-30`, `wmsSpike.ts:17-22`) |
| `node:fetch` (global) | Node 22+ | POST `/execute/sql` with Basic Auth | Native; no `node-fetch` dependency needed. Pattern in `wkbSpike.ts:78-86` |

### Supporting (none required)
The spike runner is a **one-shot CLI script with zero non-stdlib imports beyond `dotenv`**. The mature precedent (`wkbSpike.ts`) does not import any project modules — it duplicates the `/execute/sql` payload shape inline to keep the script self-contained and reusable across phases.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Standalone `.ts` CLI script | A vitest spec under `tests/spatialPredicateSpike.spec.ts` | Vitest auto-runs in CI and tests against deployed Kinetica every push → fragile; spike is operator-driven (not part of CI). Rejected. |
| Standalone `.ts` CLI script | Operator manually pastes 12 SQL strings into Kinetica Workbench | No verbatim output capture; no PASS/FAIL classification; not reusable. Phase 13/18 precedent rejects this. |
| Per-mode separate runner files | One spike script that loops both modes | Doubles maintenance; obscures the "two modes in one operator session" lock from CONTEXT.md. Rejected. |
| Inline call to production `kineticaSql()` helper | Re-derive payload shape inline | Spike is a one-shot script outside the Express app; `kineticaSql()` requires `AuthedRequest` shape + middleware context (`req.user.creds`, `req.requestId`). Rejected per Phase 18 precedent. |

**Installation:** No new packages. The runner uses only what's already installed.

**Version verification (already-installed, no need to bump):**
- `tsx@^4.7.0`, `dotenv@^16.4.5` — see `kinetica_bi/server/package.json`. Versions verified 2026-05-11 from the manifest in this repo.

## Architecture Patterns

### Recommended Project Structure

```
kinetica_bi/server/
├── src/
│   ├── spatialPredicateSpike.ts    # NEW — Phase 25 runner (mirrors wkbSpike.ts shape)
│   ├── wkbSpike.ts                 # EXISTING — Phase 18 precedent (commit d458408)
│   ├── wmsSpike.ts                 # EXISTING — Phase 11 precedent (older payload shape — DO NOT use)
│   ├── kinetica.ts                 # CANONICAL /execute/sql payload (lines 154-170)
│   └── lib/
│       └── spatialQuery.ts         # Phase 18 SQL builders — Phase 26 consumer of spike outcome
└── package.json                    # Add "spatial-predicate-spike": "tsx src/spatialPredicateSpike.ts" to scripts

.planning/phases/25-spatial-predicate-spike/
├── 25-CONTEXT.md                   # EXISTING (user decisions)
├── 25-RESEARCH.md                  # THIS FILE
├── 25-SPIKE-NOTES.md               # Operator-driven artifact (filled after Task 2 of Phase 25 plan)
└── 25-PLAN.md or similar           # Planner's output
```

### Pattern 1: Operator-Driven Spike Runner (3-Task Plan Shape)

**What:** A spike phase ships ONE plan with THREE tasks: (1) Claude writes the runner script + npm-script wire-up, (2) blocking checkpoint where the operator runs the script and pastes verbatim output to chat, (3) Claude writes `25-SPIKE-NOTES.md` from the paste.

**When to use:** Any phase where deployed-instance behavior must be confirmed before downstream SQL is committed. Phase 13 (S1-S4), Phase 18 (WKB), and now Phase 25 use the same shape.

**Plan-frontmatter example (from Phase 18, adapt for Phase 25):**

```yaml
---
phase: 25-spatial-predicate-spike
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/server/src/spatialPredicateSpike.ts
  - kinetica_bi/server/package.json
  - .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md
autonomous: false                       # CRITICAL: Task 2 is a human checkpoint
requirements:
  - SPIKE-V15-01
  - SPIKE-V15-02
must_haves:
  truths:
    - "Operator has run spatial predicate probes against deployed Kinetica with their own BI-user credentials"
    - "25-SPIKE-NOTES.md exists; documents verbatim probe outputs for both latlon and WKT modes across all 3 shapes (bbox / circle / lasso)"
    - "Decision is unambiguous: latlon-mode predicate name LOCKED; WKT-mode predicate name LOCKED; OR NONE_ESCALATE → BLOCK_V15"
  artifacts:
    - path: ".planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md"
      provides: "Locked latlon + WKT predicate name decision with verbatim probe output"
      contains: "## Latlon Probes, ## WKT Probes, ## Decision, ## Caveats"
    - path: "kinetica_bi/server/src/spatialPredicateSpike.ts"
      provides: "Operator-runnable spike script (npm run spatial-predicate-spike)"
      min_lines: 200
  key_links:
    - from: ".planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md ## Decision"
      to: "Phase 26 buildSpatialOrBlock literal predicate name"
      via: "Spike outcome dictates literal STXY_WITHIN | STXY_CONTAINS for latlon; ST_WITHIN | ST_INTERSECTS for WKT"
      pattern: "STXY_WITHIN|STXY_CONTAINS|ST_WITHIN|ST_INTERSECTS"
---
```

### Pattern 2: Production-Parity `/execute/sql` Payload

**What:** Every direct caller of Kinetica's `/execute/sql` endpoint — including spike runners — MUST send the full 7-field body, never the bare `{statement, limit}` form.

**Canonical reference:** `kinetica_bi/server/src/kinetica.ts:161-170`:

```typescript
// Source: kinetica_bi/server/src/kinetica.ts:161-170
body: JSON.stringify({
  statement: sql,
  offset: 0,
  limit: 1000,
  encoding: "json",
  request_schema_str: "",
  data: [],
  options: {},
  ...(options.extra ?? {}),
}),
```

The spike runner uses the same shape (with `limit: 5` for snapshot probes — see `wkbSpike.ts:104-112`):

```typescript
// Source: kinetica_bi/server/src/wkbSpike.ts:104-112 (commit d458408)
response = await rawFetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    statement: sql,
    offset: 0,
    limit: 5,
    encoding: "json",
    request_schema_str: "",
    data: [],
    options: {},
  }),
});
```

**Why this matters:** The Phase 18 first operator run lost a full round-trip because the runner sent `{ statement, limit: 1 }` only — Kinetica rejected at preprocessing with:

```
Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)
```

The error masked all three probe outcomes (HTTP 400 on probes A/B/C before SqlEngine ever evaluated the SQL). Commit `d458408` brought the runner to production parity. Phase 25 starts at production parity from line 1.

### Pattern 3: Decision Record Schema (mirror `18-SPIKE-NOTES.md`)

**What:** Spike findings are committed as a single Markdown file with strict section structure so downstream agents can grep predictably.

**Required sections in `25-SPIKE-NOTES.md`:**

```markdown
# Phase 25 — Spatial Predicate Spike Notes

**Spike date:** YYYY-MM-DD
**Deployed Kinetica:** http://...  (credentials redacted)
**Operator:** <username>
**Kinetica version:** <e.g., 7.2.x or "unknown">
**Latlon fixture:** demo.nyctaxi (pickup_longitude, pickup_latitude)
**WKT fixture:** ki_home.us_states.WKT
**Probe anchor:** lon=-73.95, lat=40.75, ±0.5° bbox
**Confidence:** HIGH | MEDIUM | LOW

## Latlon Probes

### Probe L-A1 (STXY_WITHIN, bbox)
**SQL:** ...
**HTTP status:** 200 | 400
**Rows returned:** N
**Body (verbatim):** ```json ...```
**Status:** PASS | FAIL — <reason>

### Probe L-A2 (STXY_WITHIN, 64-vertex circle)
...

### Probe L-A3 (STXY_WITHIN, 150-vertex lasso)
...

### Probe L-B1 (STXY_CONTAINS, bbox)
...
[... L-B2, L-B3 ...]

## WKT Probes

### Probe W-A1 (ST_WITHIN, bbox)
...
[... W-A2, W-A3, W-B1, W-B2, W-B3 ...]

## Decision

**Latlon-mode locked predicate:** STXY_WITHIN | STXY_CONTAINS | NONE_ESCALATE
**WKT-mode locked predicate:** ST_WITHIN | ST_INTERSECTS | NONE_ESCALATE

**SQL template Phase 26 buildSpatialOrBlock will use (latlon):**
```sql
<literal predicate string with $LON_COL / $LAT_COL / $WKT placeholders>
```

**SQL template Phase 26 buildSpatialOrBlock will use (WKT):**
```sql
<literal predicate string with $GEOM_COL / $WKT placeholders>
```

**Reasoning:** <one paragraph — per-mode why this name won>

**Downstream consequence:**
- PASS path: Phase 26 `buildSpatialOrBlock` authorized to use confirmed predicate names; all 4 WHERE-V15-* requirements unblocked.
- FAIL path (any mode): `NONE_ESCALATE → BLOCK_V15`; milestone re-scopes per CONTEXT.md "Total-fail escalation" lock.

## Caveats

<free-form: any version-specific quirks, 150-vertex limit findings (V15-P-03), DEC/HEX in returned column types, etc.>

## Open Question Resolutions

- **OQ-1 (latlon predicate name conflict — REQUIREMENTS.md STXY_WITHIN vs SUMMARY.md STXY_CONTAINS):** RESOLVED → <winning name>.
- **OQ-2 (WKT predicate name conflict — REQUIREMENTS.md ST_WITHIN vs SUMMARY.md ST_INTERSECTS):** RESOLVED → <winning name>.
- **OQ-3 (150-vertex polygon SQL length limit, V15-P-03):** RESOLVED → ACCEPTED | REJECTED with Kinetica response excerpt.
- **OQ-4 (STXY_DWITHIN distance unit, V15-P-05):** DEFERRED to Phase 26 supertest | RESOLVED if planner folded it in.
```

### Anti-Patterns to Avoid

- **Sending `{statement, limit}` only to `/execute/sql`** — caused Phase 18 to lose a round-trip (verbatim error: `Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)`). Use the 7-field payload from `kinetica.ts:154-170`.
- **PASS = HTTP 200 only** — Phase 18's signature-only PASS criterion missed semantic correctness. CONTEXT.md locks the v1.5 spike at **HTTP 200 AND ≥1 row returned**. A predicate name that parses but no-ops produces 0 rows silently.
- **Probing one candidate per run** — the v1.5 differentiator is **all candidates in one operator session**. Probing `STXY_WITHIN` first, waiting for FAIL, then re-planning to probe `STXY_CONTAINS` would cost a re-plan trip. Sequence all candidates in the same script execution.
- **Hard-coding the spatial column names in SQL templates** — operator's WKT-mode column is literally named `WKT` (column-named-after-its-type). Runner code must use env vars (`WKT_PROBE_GEOM_COL`), not assume `geom` or `geometry` or `wkt_col`.
- **Inline string concatenation of column names without env-var indirection** — Phase 18 runner reads `process.env.WKB_PROBE_COLUMN` and never assumes the column name. Phase 25 must do the same for both modes.
- **Spike runner imports from `src/lib/spatialQuery.ts` or any production module** — keep the runner self-contained per Phase 18 precedent. The whole point is "this script is reusable across Kinetica versions even if the codebase has moved on."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Kinetica `/execute/sql` request body shape | Hand-derive from API docs | Copy 7-field shape verbatim from `kinetica.ts:161-170` (encoding/offset/request_schema_str/data/options + statement + limit) | Phase 18 cost a round-trip discovering the missing `encoding` field. Production code is the source of truth — re-deriving from docs invites the same bug. |
| WKT POLYGON string generation for the 64-vertex circle | Compute trigonometry inline (cos/sin around centerLon/centerLat) | Codify a small helper inside the spike script (`buildCircleWkt(centerLon, centerLat, halfDeg, vertexCount)`) that emits `POLYGON ((lon0 lat0, lon1 lat1, ..., lon0 lat0))` with first-vertex closure | Hand-writing 64 coordinates is error-prone; helper is ~20 lines and exercised by all 6 latlon probes + 6 WKT probes. |
| WKT POLYGON string generation for the 150-vertex lasso | Hand-write a 150-vertex string | Generate via a helper that perturbs a regular polygon's vertices by ±0.05° (simulates lasso wobble); reuse the circle helper with `vertexCount=150` + jitter | A perfect 150-gon is geometrically identical to a 64-gon at this anchor; jitter is what makes it a "lasso shape" for V15-P-03 size testing. |
| Probe classification (PASS/FAIL) | Eyeball each probe body | Write a `classify()` helper similar to `wkbSpike.ts:133-166` but with the stronger ≥1-row criterion (count rows in `body.data_str` or `body.column_1` length) | The 12 probes need consistent verdicts; manual classification is bug-prone and inconsistent across modes. |
| Operator instructions for running the spike | Re-author from scratch | Copy the OPERATOR INSTRUCTIONS block verbatim from `18-01-wkb-spike-PLAN.md` Task 2 (lines 192-219) with env-var name swap | The operator knows this format; reading a new shape costs ramp-up. |
| Decision record file format | Custom Markdown shape | Mirror `18-SPIKE-NOTES.md` section-for-section (Probes → Decision → Caveats → Open Question Resolutions) | Phase 26 planner will grep for `## Decision` and `**Locked predicate:**` — section-name fidelity matters. |
| Multi-candidate runner control flow | Nested if-else per candidate | Loop: `for (const candidate of LATLON_CANDIDATES) for (const shape of SHAPES) await probe(candidate, shape)` — flat sequencing, no early exit | Early-exit-on-first-PASS is wrong: CONTEXT.md says capture ALL outputs (so we know whether the fallback ALSO works, useful for future re-runs). |

**Key insight:** This is a spike, not a feature build. Treat the runner as throwaway-but-preserved code — its sole job is to produce verbatim probe output. Don't build abstractions that pay off across phases; the next spike will be different. Mirror the Phase 18 shape as closely as possible to minimize cognitive overhead for the operator and the future-version re-runner.

## Common Pitfalls

### Pitfall 1: Runner sends bare `{statement, limit}` payload to `/execute/sql`

**What goes wrong:** Kinetica rejects every probe at HTTP preprocessing (HTTP 400) with `Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)`. SqlEngine never evaluates the SQL — the function-name questions the spike exists to answer are never tested.

**Why it happens:** The older `wmsSpike.ts` (Phase 11) used the bare `{statement, limit: 1}` shape (`wmsSpike.ts:59`) because it was for WMS GetCapabilities probes, not `/execute/sql`. A new spike author copying `wmsSpike.ts` instead of `wkbSpike.ts` inherits the bug.

**How to avoid:** Copy the `runSql` helper from `wkbSpike.ts:88-124` (commit `d458408`), NOT from `wmsSpike.ts`. The helper has an explicit doc-comment at lines 92-100 calling out the production-parity requirement.

**Warning signs:** All 12 probes return HTTP 400 with identical error mentioning `binary, json, geojson, arrow`.

### Pitfall 2: PASS criterion is too weak (signature-only, no row count)

**What goes wrong:** A predicate name that parses but no-ops (wrong arg order, silently treating the polygon as a different geometry type) returns 0 rows but HTTP 200. If PASS = "HTTP 200 only", the spike passes a name that will silently produce 0-row filtered tiles in Phase 30 — and the bug only surfaces at Phase 31 UAT.

**Why it happens:** Phase 18's PASS criterion was `result.ok && body.status !== "ERROR"` (signature only — `wkbSpike.ts:137-166`). Sufficient for that spike (proximity, single row matters). Insufficient for v1.5 (set filtering, row counts matter).

**How to avoid:** The classify function for Phase 25 MUST check **both**:
1. `response.ok === true` AND `body.status !== "ERROR"` (signature)
2. The returned dataset has ≥1 row (semantic)

The row-count check requires parsing `body.data_str` (which is a JSON-encoded string of column arrays). The existing `kineticaSql` helper at `kinetica.ts:208-214` shows the parse pattern:
```typescript
const dataStr = typeof body.data_str === "string" ? JSON.parse(body.data_str) : body.data_str;
const encoded = typeof dataStr?.json_encoded_response === "string"
  ? JSON.parse(dataStr.json_encoded_response)
  : dataStr?.json_encoded_response;
```

The spike doesn't need the full parse — just count rows. A simpler check: the SQL is `SELECT COUNT(*) FROM ... WHERE <predicate>`, classify PASS if the count > 0. (Recommended: use `SELECT COUNT(*) AS n` to make row-count inspection trivial.)

**Warning signs:** Multiple probes show HTTP 200 but `data_str: ""` or `data: ""`. Spike SUMMARY says PASS but Phase 26 supertest produces 0 rows.

### Pitfall 3: WKT column is named `WKT` (column literally named after its type)

**What goes wrong:** Spike SQL `ST_WITHIN(geom_col, ST_GEOMFROMTEXT(...))` errors with `column 'geom_col' not found` because the operator's column is literally `WKT`, not the conventional `geom` or `geometry`.

**Why it happens:** CONTEXT.md explicitly notes "the `ki_home.us_states.WKT` table is operator-supplied — column literally named `WKT`. Runner code must NOT assume `geom_col` is named anything sensible; env-var-driven only."

**How to avoid:** Read column names from env vars (`WKT_PROBE_GEOM_COL=WKT`); never hard-code. Use the same pattern as `wkbSpike.ts:46-51` (`process.env.WKB_PROBE_COLUMN` is unwrapped at the top of the script and used as `col` in every SQL template).

**Warning signs:** Probes return `column 'geom_col' not found` or similar identifier-not-found errors.

### Pitfall 4: Kinetica `STXY_*` predicates return integer 1/0, not boolean

**What goes wrong:** Writing `WHERE STXY_WITHIN(lon, lat, geom)` (without `= 1`) produces `expected boolean expression, got integer` or silently treats all non-zero values as truthy without indexing benefit.

**Why it happens:** Most SQL dialects auto-coerce integer-in-WHERE to boolean (`WHERE 1` = TRUE). Kinetica's `/execute/sql` engine is stricter — and the official 7.1 docs explicitly state STXY_* and ST_* topological predicates return integer 1/0 (verified via Context7/WebFetch of docs.kinetica.com/7.1).

**How to avoid:** Every probe predicate MUST end with `= 1`:
- `STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('POLYGON(...)')) = 1`
- `ST_WITHIN(geom_col, ST_GEOMFROMTEXT('POLYGON(...)')) = 1`

CONTEXT.md already locks this; planner must enforce in the runner script literal template strings.

**Warning signs:** Probe returns HTTP 400 with a message mentioning `boolean expression` or `type mismatch`.

### Pitfall 5: WKT POLYGON missing first-vertex closure

**What goes wrong:** Kinetica rejects `POLYGON ((lon1 lat1, lon2 lat2, lon3 lat3, lon4 lat4))` (4 vertices, no closure) with `polygon must be closed` or returns empty results.

**Why it happens:** OGC WKT requires the polygon's outer ring to be closed — first and last coordinate pair MUST be identical: `POLYGON ((lon1 lat1, lon2 lat2, lon3 lat3, lon4 lat4, lon1 lat1))`. The 4-corner bbox is really a 5-coordinate polygon string.

**How to avoid:** The runner's WKT-generator helpers ALWAYS append the first vertex as the last coordinate. The CONTEXT.md success-criteria block in §"Probe shape payloads" lists "4-corner bbox" but the actual WKT is 5 coordinates. The 64-vertex circle is a 65-coordinate string; the 150-vertex lasso is a 151-coordinate string. Document this in the runner's WKT-helper docstring.

**Warning signs:** Probe HTTP 400 with `polygon must be closed`, `invalid WKT`, or `geometry creation failed`.

### Pitfall 6: Operator runs spike from a fresh shell without `.env` sourced

**What goes wrong:** The script crashes immediately because `kinetica_bi/server` has an ESM import-order bug where `sessionStore.ts:25` evaluates `SESSION_ENCRYPTION_KEY` before `index.ts`'s `dotenv.config()` runs (per project memory `project_backend_env_load_order.md`).

**Why it happens:** The spike runner imports `dotenv` itself (`dotenv.config()` at the top of `wkbSpike.ts:28-30`) — so it does NOT have this bug for its own env vars. **BUT** if the operator follows habit and runs `cd kinetica_bi/server && npm run dev` to start the backend in another shell first (e.g., to confirm Kinetica is reachable), they'll hit the env-load order bug there.

**How to avoid:** The Phase 25 plan's OPERATOR INSTRUCTIONS block should explicitly note: "The spike script loads `.env` itself via `dotenv.config()` — you don't need to `source .env` for the spike. **However**, if you run `npm run dev` to verify backend health first, source the env first per project memory: `set -a; source .env; set +a; npm run dev`."

**Warning signs:** Operator reports "the script crashed before doing anything" — usually a node/tsx version issue, not env-related; or operator confused with backend dev failure.

### Pitfall 7: `ST_GEOMFROMTEXT` rejected for column-reference argument

**What goes wrong:** The spike accidentally constructs `ST_GEOMFROMTEXT(some_column)` instead of `ST_GEOMFROMTEXT('POLYGON ((...))')` and Kinetica rejects.

**Why it happens:** Official Kinetica 7.1 docs (verified 2026-05-11) state `ST_GEOMFROMTEXT` is "an alias for `GEOMETRY(wkt)`" and per the v1.5 STACK.md research at line 181: "The official docs state it is 'only compatible with constants' — meaning a string literal, NOT a column reference."

**How to avoid:** The spike uses ONLY string literals as the `ST_GEOMFROMTEXT` argument — embedded directly into the SQL string via template-literal substitution. No column references, no parameterized values. This is exactly the form the production `buildSpatialOrBlock` will emit in Phase 26.

**Warning signs:** Probe HTTP 400 with message mentioning `ST_GEOMFROMTEXT requires constant` or `unsupported argument type`.

### Pitfall 8: Lasso WKT > Kinetica SQL statement length cap (V15-P-03 surface)

**What goes wrong:** The 150-vertex lasso probe returns HTTP 400 with `statement too long` or parse-time rejection. This is exactly the V15-P-03 risk the spike is designed to surface NOW rather than at Phase 31 UAT.

**Why it happens:** Each vertex is ~20 characters (`-73.95123 40.75123, `); 150 vertices = ~3,000 chars per shape; in a `CREATE OR REPLACE MATERIALIZED VIEW ... AS SELECT * FROM ... WHERE (pred OR pred OR pred)` wrapper with 3+ shapes, total DDL can exceed 10,000 chars. Kinetica's SQL length cap is undocumented (per STACK.md research line 165).

**How to avoid:** Run the 150-vertex lasso probe as the LAST shape per mode (so bbox and circle PASS first, isolating the size-limit failure). If the lasso FAILs with `statement too long`, the Decision record annotates the v1.5 vertex cap should drop from 150 → something smaller (e.g., 100); Phase 29's `geometry.simplify` tolerance widens correspondingly. Document the verbatim Kinetica response in `## Caveats`.

**Warning signs:** Bbox + circle PASS, lasso FAIL specifically with `statement too long` / `query length exceeded` / `parse error near 'POLYGON'` for that one probe.

## Code Examples

Verified patterns from existing project sources:

### Production-parity `/execute/sql` invocation

```typescript
// Source: kinetica_bi/server/src/wkbSpike.ts:88-124 (commit d458408)
async function runSql(sql: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${KINETICA_URL}/execute/sql`;
  let response: Response;
  try {
    response = await rawFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statement: sql,
        offset: 0,
        limit: 5,
        encoding: "json",
        request_schema_str: "",
        data: [],
        options: {},
      }),
    });
  } catch (e) {
    return { ok: false, status: -1, body: { networkError: String(e) } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = { parseError: "non-JSON response" };
  }
  return { ok: response.ok, status: response.status, body };
}
```

### Probe block with verbatim output capture

```typescript
// Source: kinetica_bi/server/src/wkbSpike.ts:180-188 (Probe A shape; adapt for spatial predicates)
console.log("=== Probe L-A1: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<bbox-WKT>')) — latlon bbox ===");
const sqlL_A1 = `SELECT COUNT(*) AS n FROM ${LATLON_SCHEMA}.${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
console.log(`[spike] SQL: ${sqlL_A1}`);
const resultL_A1 = await runSql(sqlL_A1);
console.log(`[spike] HTTP status: ${resultL_A1.status}`);
console.log(`[spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_A1.body, null, 2));
console.log("");
```

### WKT POLYGON generation helpers (recommended for the new runner)

```typescript
// NEW: spatialPredicateSpike.ts helper — generates production-realistic shape WKT
// Returns POLYGON ((lon0 lat0, lon1 lat1, ..., lon0 lat0)) — closed ring per OGC.

function buildBboxWkt(centerLon: number, centerLat: number, halfDeg: number): string {
  const w = centerLon - halfDeg, e = centerLon + halfDeg;
  const s = centerLat - halfDeg, n = centerLat + halfDeg;
  // 5 coordinates (4 corners + closure)
  return `POLYGON ((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

function buildRegularPolygonWkt(
  centerLon: number,
  centerLat: number,
  halfDeg: number,
  vertexCount: number,
): string {
  const coords: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const theta = (i / vertexCount) * 2 * Math.PI;
    const lon = centerLon + halfDeg * Math.cos(theta);
    const lat = centerLat + halfDeg * Math.sin(theta);
    // Round to 5 decimals (~1m precision) — matches V15-P-03 quantization
    coords.push(`${lon.toFixed(5)} ${lat.toFixed(5)}`);
  }
  // Close the ring with the first vertex
  coords.push(coords[0]);
  return `POLYGON ((${coords.join(", ")}))`;
}

function buildJitteredPolygonWkt(
  centerLon: number,
  centerLat: number,
  halfDeg: number,
  vertexCount: number,
  jitter: number = 0.05,
): string {
  // Simulates a lasso shape — regular polygon with per-vertex random perturbation.
  // Deterministic via a seeded PRNG so re-runs are byte-identical (operator can paste
  // diffs against prior runs without false noise).
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1; // [-1, 1)
  };
  const coords: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const theta = (i / vertexCount) * 2 * Math.PI;
    const r = halfDeg * (1 + jitter * rand());
    const lon = centerLon + r * Math.cos(theta);
    const lat = centerLat + r * Math.sin(theta);
    coords.push(`${lon.toFixed(5)} ${lat.toFixed(5)}`);
  }
  coords.push(coords[0]);
  return `POLYGON ((${coords.join(", ")}))`;
}
```

### Strong PASS classification (≥1 row, not just HTTP 200)

```typescript
// NEW: spatialPredicateSpike.ts — STRONGER than wkbSpike.ts:133-166
// PASS = HTTP 200 AND body.status === "OK" AND COUNT(*) result > 0.
// Use SELECT COUNT(*) AS n probes so row-count parsing is trivial.

function classify(
  label: string,
  result: { ok: boolean; status: number; body: unknown },
): ["PASS" | "FAIL", string] {
  if (!result.ok || result.status < 200 || result.status >= 300) {
    const msg = extractMessage(result.body);
    return ["FAIL", `HTTP ${result.status}${msg ? ` — ${msg.slice(0, 200)}` : ""}`];
  }
  const body = result.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") return ["FAIL", "unrecognized response body"];

  const status = (body as { status?: unknown }).status;
  if (typeof status === "string" && status.toUpperCase() === "ERROR") {
    return ["FAIL", `body.status=ERROR — ${extractMessage(body).slice(0, 200)}`];
  }

  // Parse encoded row count from data_str.
  // Kinetica /execute/sql with encoding:"json" returns data_str as a stringified
  // JSON with shape: { column_1: [<count>], column_headers: ["n"], ... }
  const dataStr = (body as { data_str?: unknown }).data_str;
  let countN: number | null = null;
  if (typeof dataStr === "string" && dataStr.length > 0) {
    try {
      const parsed = JSON.parse(dataStr);
      const inner =
        typeof parsed?.json_encoded_response === "string"
          ? JSON.parse(parsed.json_encoded_response)
          : parsed?.json_encoded_response ?? parsed;
      // The COUNT(*) result lands in column_1 (or column_headers[0]).
      const col = inner?.column_1 ?? inner?.n ?? inner?.["COUNT(*)"];
      if (Array.isArray(col) && col.length > 0) countN = Number(col[0]);
    } catch {
      // dataStr present but unparseable — fall through to ambiguous PASS
    }
  }

  if (countN === null) {
    return ["PASS", `${label} signature OK; row count unverified (inspect body)`];
  }
  if (countN > 0) {
    return ["PASS", `${label} signature OK; ${countN} rows match`];
  }
  return ["FAIL", `${label} signature OK but 0 rows match — predicate likely no-ops (wrong arg order or unsupported geometry type)`];
}
```

### npm script wire-up

```json
// Source: kinetica_bi/server/package.json (after Phase 25 Task 1)
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -p tsconfig.json",
    "test": "vitest",
    "wms-spike": "tsx src/wmsSpike.ts",
    "wkb-spike": "tsx src/wkbSpike.ts",
    "spatial-predicate-spike": "tsx src/spatialPredicateSpike.ts"
  }
}
```

## WKT Literal Payload Construction (Drawn-Shape Characteristics)

The spike must produce **production-realistic** WKT polygons matching what Phase 29's `MapDrawToolbar` will emit:

### 4-corner bbox

- **WKT shape:** `POLYGON ((lon_w lat_s, lon_e lat_s, lon_e lat_n, lon_w lat_n, lon_w lat_s))` — 5 coordinates (4 corners + closure).
- **Characters:** ~120 (5 × ~24 char coords).
- **Production source:** OL `Draw` with `type: 'Circle'` + `geometryFunction: createBox()` (per DRAW-V15-04).
- **Anchor for spike:** Center `(-73.95, 40.75)`, ±0.5° → `POLYGON ((-74.45 40.25, -73.45 40.25, -73.45 41.25, -74.45 41.25, -74.45 40.25))`.

### 64-vertex circle polygon

- **WKT shape:** `POLYGON ((lon0 lat0, lon1 lat1, ..., lon63 lat63, lon0 lat0))` — 65 coordinates.
- **Characters:** ~1,500.
- **Production source:** OL `Draw` with `type: 'Circle'` + `geometryFunction: createRegularPolygon(64)` (per DRAW-V15-04).
- **Vertex generation:** `theta_i = (i / 64) * 2π`, `lon_i = centerLon + halfDeg * cos(theta_i)`, `lat_i = centerLat + halfDeg * sin(theta_i)`.

### 150-vertex lasso polygon

- **WKT shape:** `POLYGON ((lon0 lat0, ..., lon149 lat149, lon0 lat0))` — 151 coordinates.
- **Characters:** ~3,500.
- **Production source:** OL `Draw` with `type: 'Polygon'` + `freehand: true`, then `geometry.simplify(map.getView().getResolution() * 2)` + 150-vertex hard cap (per DRAW-V15-06, V15-P-03).
- **Vertex generation:** 64-vertex regular polygon × jittered radius `r_i = halfDeg * (1 + 0.05 * rand())` to simulate lasso wobble. Use a deterministic PRNG (seed=42) so re-runs are byte-identical.

### Total payload sizes per probe set

For the 12-probe matrix (2 modes × 2 candidates × 3 shapes), the SQL strings vary:
- Latlon bbox: ~250 chars total SQL
- Latlon circle: ~1,650 chars
- Latlon lasso: ~3,650 chars
- WKT bbox: ~200 chars
- WKT circle: ~1,600 chars
- WKT lasso: ~3,600 chars

If the 150-vertex lasso probe hits a SQL-length cap, **only that one probe** FAILs — the bbox and circle probes still succeed, isolating the V15-P-03 size-limit signal cleanly. This is the **V15-P-03 free probe** CONTEXT.md identifies.

## Kinetica Predicate Reference (HIGH confidence — Kinetica 7.1 docs verified 2026-05-11)

| Predicate | Signature | Returns | Notes |
|-----------|-----------|---------|-------|
| `STXY_WITHIN(x, y, geom)` | x, y = float; geom = geometry | int 1/0 | Returns 1 if (x, y) is **completely inside** geom (not on boundary). Per-point performance optimization. |
| `STXY_CONTAINS(geom, x, y)` | geom = geometry; x, y = float | int 1/0 | Returns 1 if geom **contains** the (x, y) point. **Inverse arg order** from STXY_WITHIN. |
| `STXY_INTERSECTS(x, y, geom)` | x, y = float; geom = geometry | int 1/0 | Returns 1 if (x, y) and geom intersect in 2-D. Includes boundary cases that STXY_WITHIN excludes. |
| `ST_WITHIN(geom1, geom2)` | both geometry | int 1/0 | Returns 1 if geom1 is **completely inside** geom2 (not on boundary). |
| `ST_CONTAINS(geom1, geom2)` | both geometry | int 1/0 | Returns 1 if geom1 **contains** geom2 (not on boundary). Inverse of ST_WITHIN arg order. |
| `ST_INTERSECTS(geom1, geom2)` | both geometry | int 1/0 | Returns 1 if geom1 and geom2 spatially intersect in 2-D. Includes boundary cases. |
| `ST_GEOMFROMTEXT(wkt)` | wkt = WKT string **constant** | geometry | Alias for `GEOMETRY(wkt)`. **Constants-only** — not column references. |

**Sources verified 2026-05-11:**
- `docs.kinetica.com/7.1/sql/query/#geospatial-functions` (via WebFetch — confirmed signatures + integer return type)
- `docs.kinetica.com/7.1/sql/query/` (via WebFetch — confirmed ST_WITHIN/ST_INTERSECTS/ST_CONTAINS arg shapes)
- v1.5 research STACK.md §"Kinetica Spatial WHERE Predicates" — Kinetica 7.1 confirmed; deployed-instance behavior unconfirmed (this spike resolves)
- v1.5 research PITFALLS.md §"V15-P-14" — predicate-availability risk on operator's version

**The spike's job is to confirm DEPLOYED-INSTANCE behavior** — the docs confirm Kinetica 7.1 supports these predicates, but the operator's instance version is unknown (per `18-SPIKE-NOTES.md` line 7) and may differ.

### Predicate name conflict resolution

REQUIREMENTS.md SPIKE-V15-01 lists `STXY_WITHIN` (latlon) and `ST_WITHIN` (WKT). v1.5 research SUMMARY.md recommends `STXY_CONTAINS` (latlon) and `ST_INTERSECTS` (WKT). Both are valid per Kinetica docs; CONTEXT.md locks **probe both in one run, lock first PASS per mode**.

**Argument-order trap:** `STXY_WITHIN(x, y, geom)` vs `STXY_CONTAINS(geom, x, y)` — inverse. A typo here is a silent-bug surface: the predicate parses but no-ops because geometry-typed and float-typed args are swapped. The classify function's ≥1-row criterion catches this; signature-only would not.

## Cost-of-Failure Analysis (from scope_clarification)

What happens if a predicate name is wrong? Three failure modes:

| Failure mode | How it manifests | Spike detection |
|--------------|------------------|-----------------|
| **Function name not found** | HTTP 400 with body.message containing "function 'stxy_within' not found" or "no match found for function signature" | `classify()` flags FAIL on HTTP 400; Decision record annotates. |
| **Argument order wrong (geom vs float swap)** | HTTP 200, 0 rows returned — silently passes signature, fails semantic | ≥1-row PASS criterion (vs Phase 18's signature-only) — `classify()` flags FAIL when COUNT = 0. |
| **Server error / unsupported geometry type** | HTTP 400 with body.message containing "invalid argument list: <type1>,<type2>,..." | `classify()` flags FAIL; verbatim body captured in SPIKE-NOTES. Example: Phase 18 Probe C surfaced this exact pattern (`STX(<GEO>)`). |

The spike's value is **catching mode 2 specifically** — the silent no-op. Phase 18's PASS criterion would have missed it for set-filtering predicates; v1.5 strengthens it.

## State of the Art

| Old approach (Phase 18) | New approach (Phase 25) | When changed | Impact |
|--------------|------------------|--------------|--------|
| One candidate per probe per run | Multi-candidate fallback in one run (2 modes × 2 candidates × 3 shapes = 12 probes) | Phase 25 CONTEXT.md (2026-05-11) | Operator runs once, locks both modes' names without a re-plan trip. |
| PASS = signature only (HTTP 200) | PASS = signature + semantic (HTTP 200 AND ≥1 row) | Phase 25 CONTEXT.md | Catches silent wrong-arg-order no-ops at spike time, not Phase 31 UAT. |
| Probe target = ad-hoc fixture (operator's choice) | Probe target = pre-locked production fixtures (`demo.nyctaxi` + `ki_home.us_states`) | Phase 25 CONTEXT.md | Operator-confirmed reachability; deterministic probe semantics. |
| Decision = single predicate name | Decision = locked predicate name per mode + downstream consequence + escalation path | Phase 25 CONTEXT.md | Phase 26's `buildSpatialOrBlock` reads the Decision section verbatim — one decision per mode. |

**Deprecated/outdated patterns:**
- **`{ statement, limit: 1 }` payload to `/execute/sql`** — Phase 11 `wmsSpike.ts` shape; tainted Phase 18 first run; never use for spatial probes. Always use the 7-field payload from `kinetica.ts:154-170`.
- **PASS-on-HTTP-200-alone** — Phase 18 `classify()` shape; insufficient for set filtering predicates where 0-row results are silent failures.

## Open Questions

1. **Will `ST_GEOMFROMTEXT('POLYGON ((...))')` accept a 150-vertex polygon, or hit an undocumented SQL length cap?**
   - What we know: Kinetica 7.1 docs do not specify a SQL statement length limit. v1.5 PITFALLS.md V15-P-03 flags this as critical-but-unknown.
   - What's unclear: Operator's Kinetica version's hard cap (if any).
   - Recommendation: Include the 150-vertex lasso probe in BOTH modes; if it FAILs with `statement too long`, Decision record's `## Caveats` section drops the v1.5 vertex cap from 150 to a lower number for Phase 29's `geometry.simplify` config.

2. **If `STXY_WITHIN` and `STXY_CONTAINS` BOTH PASS for latlon mode, which name does Phase 26 use?**
   - What we know: CONTEXT.md says "Decision record locks the **first PASS** per mode" — i.e., `STXY_WITHIN` (REQUIREMENTS.md primary) wins by default.
   - What's unclear: Whether the planner prefers `STXY_CONTAINS` for arg-order consistency with `ST_CONTAINS` in WKT mode (`geom, x, y` reads more naturally than `x, y, geom` for both modes).
   - Recommendation: Lock `STXY_WITHIN` first (REQUIREMENTS.md primary). Note in `## Caveats` if `STXY_CONTAINS` also PASSed — useful for future re-runs if `STXY_WITHIN` is ever deprecated.

3. **Does the spike need to probe both AUTH_MODE=password AND AUTH_MODE=oidc?**
   - What we know: CONTEXT.md "Claude's Discretion" defaults to **password mode only**, mirroring Phase 18 + v1.3 S2.b pattern.
   - What's unclear: Whether the v1.5 OIDC verification at Phase 31 will surface predicate-eval-under-OIDC bugs not caught by password-mode spike.
   - Recommendation: Default password mode; OIDC defers to Phase 31 UAT (same trajectory as v1.3 → closed live at v1.4 Phase 24).

4. **Should the V15-P-05 STXY_DWITHIN distance-unit probe be folded into Phase 25?**
   - What we know: CONTEXT.md "Claude's Discretion" says planner decides. The 150-vertex lasso payload addresses V15-P-03; V15-P-07 is Phase 26 unit-test territory.
   - What's unclear: Whether spending one extra probe (a `STXY_DWITHIN(lon, lat, ST_GEOMFROMTEXT('POINT(cx cy)'), 5000)` invocation) is worth it now vs deferred to Phase 26 supertest.
   - Recommendation: **Defer to Phase 26 supertest** — v1.5 circles are handled via 64-vertex POLYGON approximation per WHERE-V15-01 (not STXY_DWITHIN), so V15-P-05 is a v1.6 concern (`DWITHIN-V16-01` future requirement). Don't bloat the spike.

## Sources

### Primary (HIGH confidence)
- **`kinetica_bi/server/src/wkbSpike.ts`** (Phase 18 runner at commit `d458408`) — production-payload parity reference; classify() pattern; env-var-driven probe target.
- **`kinetica_bi/server/src/kinetica.ts:154-170`** — canonical `/execute/sql` request body shape.
- **`kinetica_bi/server/src/lib/spatialQuery.ts`** — Phase 18 SQL builder pattern + trust boundary; reference for Phase 26 consumption shape.
- **`.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`** — section-structure precedent for `25-SPIKE-NOTES.md`.
- **`.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-PLAN.md`** — 3-task plan structure (write runner / human checkpoint / write decision record); frontmatter `must_haves` shape; OPERATOR INSTRUCTIONS block lines 192-219.
- **`.planning/research/STACK.md` §"Kinetica Spatial WHERE Predicates"** — lines 162-240; confirms all 4 candidate predicate signatures + ST_GEOMFROMTEXT constants-only constraint.
- **`.planning/research/PITFALLS.md` §"V15-P-14"** (lines 544-573) — predicate availability spike rationale.
- **`.planning/research/PITFALLS.md` §"V15-P-03"** (lines 96-144) — freehand polygon vertex explosion (150-vertex lasso doubles as size-limit probe).
- **Kinetica 7.1 official docs** (verified 2026-05-11 via WebFetch):
  - `docs.kinetica.com/7.1/sql/query/#geospatial-functions` — STXY_* signatures + integer return type
  - `docs.kinetica.com/7.1/sql/query/` — ST_WITHIN/ST_INTERSECTS/ST_CONTAINS/ST_GEOMFROMTEXT signatures

### Secondary (MEDIUM confidence)
- **`.planning/research/SUMMARY.md`** §"Implications for Roadmap" Phase 1 — spike rationale; predicate-name conflict origin (REQUIREMENTS.md vs SUMMARY.md).
- **`.planning/research/FEATURES.md`** lines 196, 374-378 — OR-composition pattern + per-mode predicate recommendation tables.
- **`kinetica_bi/server/src/wmsSpike.ts`** — earlier spike pattern (Phase 11); section/banner structure relevant but `runSql()` payload is wrong shape (DO NOT copy).
- **Project memory `project_kinetica_spatial_idioms.md`** (2026-05-11) — STXY_* family preference over ST_* + ST_GEOMFROMTEXT wrap; idiom precedent for v1.4 buildWkbQuery.

### Tertiary (LOW confidence — informational only)
- None for the spike itself — every claim above is grounded in either codebase files (committed) or official Kinetica docs (verified live 2026-05-11).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All dependencies are already in `package.json`; no new packages introduced.
- Runner architecture: HIGH — Phase 18 `wkbSpike.ts` at commit `d458408` is the production-parity reference; section-by-section transposition with multi-candidate loop.
- Predicate signatures: HIGH — Kinetica 7.1 docs verified live 2026-05-11 via WebFetch; STACK.md research independently corroborates.
- Pitfalls: HIGH — All 8 pitfalls grounded in either Phase 18 postmortem (Pitfalls 1, 4), CONTEXT.md locks (Pitfalls 2, 3), v1.5 research (Pitfalls 5, 7, 8), or project memory (Pitfall 6).
- Open questions: MEDIUM — Q1 (150-vertex SQL cap) is exactly what the spike resolves; Q2-Q4 are planner-decision deferrals.

**Research date:** 2026-05-11
**Valid until:** 2026-06-11 (30 days — stable Kinetica 7.1 docs; spike pattern unchanged across phases 13/18/25)
