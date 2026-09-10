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
autonomous: false
requirements:
  - SPIKE-V15-01
  - SPIKE-V15-02
must_haves:
  truths:
    - "Operator has run spatial predicate probes against the deployed Kinetica instance with their own BI-user credentials (password mode)"
    - "All 12 probes (2 modes × 2 candidate predicates × 3 shapes) executed with verbatim outputs captured — bbox + 64-vertex circle + 150-vertex lasso across latlon (demo.nyctaxi) and WKT (ki_home.us_states.WKT) fixtures"
    - "25-SPIKE-NOTES.md exists with verbatim probe outputs, PASS/FAIL classifications under the strong criterion (HTTP 200 AND ≥1 row), and a Decision section that either (a) locks the first-PASS predicate name per mode OR (b) records NONE_ESCALATE → BLOCK_V15"
    - "The runner script in kinetica_bi/server/src/spatialPredicateSpike.ts is committed at a known commit so future Kinetica-version re-runs are one-shot via npm run spatial-predicate-spike"
    - "Phase 26 buildSpatialOrBlock is either authorized (PASS path — predicate names locked verbatim in Decision section) or BLOCKED (FAIL path — milestone re-scope required)"
  artifacts:
    - path: "kinetica_bi/server/src/spatialPredicateSpike.ts"
      provides: "Operator-runnable spatial predicate spike script invoked via npm run spatial-predicate-spike"
      min_lines: 200
      contains: "STXY_WITHIN, STXY_CONTAINS, ST_WITHIN, ST_INTERSECTS, ST_GEOMFROMTEXT, classify, buildBboxWkt, buildRegularPolygonWkt, buildJitteredPolygonWkt"
    - path: "kinetica_bi/server/package.json"
      provides: "npm-script wiring for the runner"
      contains: "spatial-predicate-spike"
    - path: ".planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md"
      provides: "Locked latlon + WKT predicate-name decision with verbatim probe output and downstream consequence for Phase 26 buildSpatialOrBlock"
      contains: "## Latlon Probes, ## WKT Probes, ## Decision, ## Caveats, ## Open Question Resolutions"
  key_links:
    - from: "kinetica_bi/server/src/spatialPredicateSpike.ts"
      to: "kinetica_bi/server/src/kinetica.ts (canonical /execute/sql payload at lines 154-170)"
      via: "Runner /execute/sql POST body MUST be byte-for-byte identical (7 fields: statement, offset, limit, encoding, request_schema_str, data, options) — Phase 18 lost a round-trip to this exact contract"
      pattern: "encoding.*json.*request_schema_str.*data.*options"
    - from: ".planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md ## Decision"
      to: "Phase 26 spatialWhereClause.ts buildSpatialOrBlock literal predicate name"
      via: "Spike outcome dictates literal STXY_WITHIN | STXY_CONTAINS for latlon mode; ST_WITHIN | ST_INTERSECTS for WKT mode"
      pattern: "STXY_WITHIN|STXY_CONTAINS|ST_WITHIN|ST_INTERSECTS"
    - from: "kinetica_bi/server/src/spatialPredicateSpike.ts classify()"
      to: "PASS criterion strengthened over Phase 18"
      via: "PASS = HTTP 200 AND body.status !== ERROR AND COUNT(*) row > 0 — catches silent wrong-arg-order no-ops (V15 set-filtering semantics require ≥1 row)"
      pattern: "countN.*> 0|>= 1 row"
---

<objective>
Operator-driven spike against the deployed Kinetica instance to lock the spatial predicate names Phase 26 `buildSpatialOrBlock` will use for v1.5 spatial filtering. The spike probes BOTH candidate names per mode in a SINGLE operator session: `STXY_WITHIN` vs `STXY_CONTAINS` for latlon mode (against `demo.nyctaxi`), and `ST_WITHIN` vs `ST_INTERSECTS` for WKT mode (against `ki_home.us_states.WKT`). Each candidate is probed against three production-realistic shapes (4-corner bbox, 64-vertex circle, 150-vertex jittered lasso) — 12 probes total per run.

Purpose: **This phase is the P1 gate for Phase 26** — no `spatialWhereClause.ts` code may be written until BOTH latlon AND WKT predicate forms PASS the strong criterion (HTTP 200 AND ≥1 row returned). Partial-fail (latlon PASS + WKT FAIL or vice versa) is **explicitly disallowed** per CONTEXT.md — the milestone re-scopes if any mode FAILs. The strong PASS criterion (≥1 row, not just HTTP 200) catches silent wrong-arg-order no-ops at spike time rather than at Phase 31 UAT.

Output: A spike runner script (`kinetica_bi/server/src/spatialPredicateSpike.ts`, modeled exactly on `kinetica_bi/server/src/wkbSpike.ts` at commit `d458408` with multi-candidate fallback within a single run), an npm-script wire-up (`spatial-predicate-spike`), and a `25-SPIKE-NOTES.md` decision record committed to the phase directory.

Pattern model: `.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-PLAN.md` (3-task plan: Claude writes runner → operator runs + pastes verbatim output → Claude writes decision record). Differentiator from Phase 18: multi-candidate-per-mode-per-run + strong PASS criterion + production-realistic shape generators.
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
@.planning/phases/25-spatial-predicate-spike/25-CONTEXT.md
@.planning/phases/25-spatial-predicate-spike/25-RESEARCH.md

# Reference: existing operator-driven spike pattern (Phase 18) — mirror byte-for-byte where the structure permits
@.planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-PLAN.md
@.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md

# Reference: production-parity payload + existing runner (mirror payload shape verbatim)
@kinetica_bi/server/src/wkbSpike.ts
@kinetica_bi/server/src/kinetica.ts
@kinetica_bi/server/package.json

<interfaces>
<!-- This plan does NOT consume any TS module interfaces — it is operator-driven -->
<!-- and produces a markdown decision file + a CLI runner script. -->

Environment variables operator must have set in `kinetica_bi/server/.env`:
- KINETICA_URL              (e.g. http://172.31.0.22:8082/gpudb-0 — same value used by Phase 11 / 13 / 18 spikes)
- KINETICA_USERNAME         (operator's BI username — password-mode probe uses Basic auth)
- KINETICA_PASSWORD         (operator's BI password)
- LATLON_TABLE              (e.g. demo.nyctaxi — schema-qualified table identifier)
- LATLON_LON_COL            (e.g. pickup_longitude)
- LATLON_LAT_COL            (e.g. pickup_latitude)
- WKT_TABLE                 (e.g. ki_home.us_states — schema-qualified table identifier)
- WKT_GEOM_COL              (e.g. WKT — operator's column is LITERALLY named "WKT"; do NOT assume any conventional name)
- PROBE_CENTER_LON          (e.g. -73.95 — NYC anchor; same coord Phase 18 used)
- PROBE_CENTER_LAT          (e.g. 40.75 — NYC anchor)
- PROBE_HALF_DEG            (e.g. 0.5 — ±0.5° bbox extent, ~50 km square)

Probe matrix (12 total per run):
  Latlon mode (against demo.nyctaxi):
    L-A1: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1
    L-A2: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<64-vertex-circle-WKT>')) = 1
    L-A3: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>')) = 1
    L-B1: STXY_CONTAINS(ST_GEOMFROMTEXT('<bbox-WKT>'), lon, lat) = 1
    L-B2: STXY_CONTAINS(ST_GEOMFROMTEXT('<64-vertex-circle-WKT>'), lon, lat) = 1
    L-B3: STXY_CONTAINS(ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>'), lon, lat) = 1
  WKT mode (against ki_home.us_states):
    W-A1: ST_WITHIN(geom_col, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1
    W-A2: ST_WITHIN(geom_col, ST_GEOMFROMTEXT('<64-vertex-circle-WKT>')) = 1
    W-A3: ST_WITHIN(geom_col, ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>')) = 1
    W-B1: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1
    W-B2: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT('<64-vertex-circle-WKT>')) = 1
    W-B3: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>')) = 1

CRITICAL argument-order trap (predicates are NOT symmetric):
  - STXY_WITHIN(x, y, geom)             — x, y FIRST   (float, float, geometry)
  - STXY_CONTAINS(geom, x, y)           — geom FIRST   (geometry, float, float)
  - ST_WITHIN(geom_col, geom_literal)   — column geom INSIDE WKT geom (both geometry)
  - ST_INTERSECTS(geom_col, geom_lit)   — symmetric but always emit geom column first for consistency

All predicates return integer 1 or 0 (NOT boolean) per Kinetica 7.1 docs verified 2026-05-11 — EVERY probe MUST suffix `= 1`.

Probe SQL shape (use SELECT COUNT(*) AS n so row-count parse is trivial):
  SELECT COUNT(*) AS n FROM ${TABLE} WHERE <predicate> = 1

PASS criterion (STRONGER than Phase 18):
  PASS = response.ok AND response.status === 200 AND body.status !== "ERROR" AND COUNT(*) > 0
  FAIL = HTTP non-2xx OR body.status === "ERROR" OR COUNT(*) === 0 OR COUNT unparseable
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Write spatial predicate spike runner (kinetica_bi/server/src/spatialPredicateSpike.ts) + npm-script wire-up</name>
  <files>kinetica_bi/server/src/spatialPredicateSpike.ts, kinetica_bi/server/package.json</files>
  <read_first>
    - kinetica_bi/server/src/wkbSpike.ts (Phase 18 runner at commit d458408 — PATTERN to mirror byte-for-byte for the /execute/sql payload, dotenv loading, basicAuth, redactedUrl, rawFetch/runSql helpers, classify-and-summary section, banner format)
    - kinetica_bi/server/src/kinetica.ts (lines 140-220 — canonical /execute/sql request body at lines 161-170; runner MUST send the exact 7-field body: statement, offset, limit, encoding, request_schema_str, data, options. NEVER the bare {statement, limit} shape — that exact bug cost Phase 18 a round-trip)
    - kinetica_bi/server/package.json (read the "scripts" block — wms-spike + wkb-spike are registered there; spatial-predicate-spike will be added alongside them)
    - .planning/phases/25-spatial-predicate-spike/25-CONTEXT.md (LOCKED decisions — probe BOTH candidate names per mode, demo.nyctaxi for latlon, ki_home.us_states.WKT for WKT, NYC ±0.5° anchor, strong PASS criterion)
    - .planning/phases/25-spatial-predicate-spike/25-RESEARCH.md (predicate signatures with argument orders, WKT-helper code in §"Code Examples", classify() pattern in §"Strong PASS classification", pitfall coverage)
    - .planning/phases/18-spatial-spike-and-endpoint/18-01-wkb-spike-PLAN.md (Task 1 structure — sectioned probe blocks, summary block at end, NOT-PART-OF-APP marker, env-var-driven probe target)
  </read_first>
  <action>
    Create `kinetica_bi/server/src/spatialPredicateSpike.ts` as a one-shot tsx CLI script (NOT part of the Express app). Mirror `kinetica_bi/server/src/wkbSpike.ts` byte-for-byte for the boilerplate (dotenv loading, env-var validation, basicAuth, redactedUrl, rawFetch, runSql payload), then implement the 12-probe matrix with WKT-shape helpers and a strengthened classify().

    Required structure (sections in order):

    1. **Header comment block** — file purpose, USAGE (`cd kinetica_bi/server && npm run spatial-predicate-spike`), REQUIRED .env VARS (list all 11), OUTPUT (stdout lines per probe + SPIKE SUMMARY), NOT-PART-OF-APP marker. Cite Phase 18 commit `d458408` as the payload-parity reference.

    2. **Imports + env loading** — copy verbatim from `wkbSpike.ts:28-43`:
       ```typescript
       import dotenv from "dotenv";
       dotenv.config();
       const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
       const KINETICA_USERNAME = process.env.KINETICA_USERNAME;
       const KINETICA_PASSWORD = process.env.KINETICA_PASSWORD;
       if (!KINETICA_URL || !KINETICA_USERNAME || !KINETICA_PASSWORD) {
         console.error("[spatial-predicate-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, and KINETICA_PASSWORD must be set in .env");
         process.exit(1);
       }
       const basicAuth = "Basic " + Buffer.from(`${KINETICA_USERNAME}:${KINETICA_PASSWORD}`).toString("base64");
       const redactedUrl = KINETICA_URL.replace(/:[^@:]+@/, ":***@");
       ```

    3. **Operator setup section** — read these env vars (with same missing-var error pattern as `wkbSpike.ts:44-63`):
       - `LATLON_TABLE` (e.g. `demo.nyctaxi` — schema-qualified)
       - `LATLON_LON_COL` (e.g. `pickup_longitude`)
       - `LATLON_LAT_COL` (e.g. `pickup_latitude`)
       - `WKT_TABLE` (e.g. `ki_home.us_states` — schema-qualified)
       - `WKT_GEOM_COL` (e.g. `WKT` — column LITERALLY named "WKT"; runner MUST NOT assume any conventional name)
       - `PROBE_CENTER_LON` (e.g. `-73.95`)
       - `PROBE_CENTER_LAT` (e.g. `40.75`)
       - `PROBE_HALF_DEG` (e.g. `0.5`)

       If any are missing, log the example template (verbatim above values) and exit 1.

       Parse numeric env vars: `const centerLon = Number(PROBE_CENTER_LON); const centerLat = Number(PROBE_CENTER_LAT); const halfDeg = Number(PROBE_HALF_DEG);` — exit 1 with a clear error if any is NaN.

       Log a banner:
       `[spatial-predicate-spike] Deployed Kinetica: ${redactedUrl}`
       `[spatial-predicate-spike] User: ${KINETICA_USERNAME}`
       `[spatial-predicate-spike] Latlon target: ${LATLON_TABLE}.(${LATLON_LON_COL}, ${LATLON_LAT_COL})`
       `[spatial-predicate-spike] WKT target: ${WKT_TABLE}.${WKT_GEOM_COL}`
       `[spatial-predicate-spike] Probe anchor: lon=${centerLon}, lat=${centerLat}, ±${halfDeg}°`

    4. **rawFetch + runSql helpers** — copy VERBATIM from `wkbSpike.ts:78-124`. The `runSql` body MUST send the production-parity 7-field payload (the doc-comment at `wkbSpike.ts:92-100` explaining WHY MUST be carried over):
       ```typescript
       body: JSON.stringify({
         statement: sql,
         offset: 0,
         limit: 5,
         encoding: "json",
         request_schema_str: "",
         data: [],
         options: {},
       }),
       ```
       DO NOT regress to `{ statement, limit }` — Phase 18 lost a full round-trip to this exact bug (verbatim Kinetica error: `Value: '' not a valid parameter. Valid values are: binary, json, geojson, arrow (U/PUh:355)`).

    5. **WKT helper functions** — three pure helpers that produce OGC-closed POLYGON strings (first vertex repeated as last; verified against research §"Code Examples" lines 484-535):

       ```typescript
       // 4-corner bbox — 5 coordinates (4 corners + closure)
       function buildBboxWkt(centerLon: number, centerLat: number, halfDeg: number): string {
         const w = centerLon - halfDeg, e = centerLon + halfDeg;
         const s = centerLat - halfDeg, n = centerLat + halfDeg;
         return `POLYGON ((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
       }

       // Regular n-gon polygon (production source: ol/interaction/Draw.createRegularPolygon(64))
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
           coords.push(`${lon.toFixed(5)} ${lat.toFixed(5)}`);
         }
         coords.push(coords[0]); // OGC closure — first vertex repeated
         return `POLYGON ((${coords.join(", ")}))`;
       }

       // Jittered polygon (lasso simulation) — deterministic via seeded PRNG so re-runs are byte-identical
       function buildJitteredPolygonWkt(
         centerLon: number,
         centerLat: number,
         halfDeg: number,
         vertexCount: number,
         jitter: number = 0.05,
       ): string {
         let seed = 42; // deterministic
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
         coords.push(coords[0]); // OGC closure
         return `POLYGON ((${coords.join(", ")}))`;
       }
       ```

       Pre-compute the three WKT strings once at module scope:
       ```typescript
       const bboxWkt   = buildBboxWkt(centerLon, centerLat, halfDeg);
       const circleWkt = buildRegularPolygonWkt(centerLon, centerLat, halfDeg, 64);
       const lassoWkt  = buildJitteredPolygonWkt(centerLon, centerLat, halfDeg, 150, 0.05);
       ```

    6. **Strengthened classify() helper** — STRONGER than `wkbSpike.ts:133-166`. PASS requires HTTP 200 + body.status !== "ERROR" + COUNT(*) > 0. Implementation (per research §"Strong PASS classification"):
       ```typescript
       function classify(
         label: string,
         result: { ok: boolean; status: number; body: unknown },
       ): ["PASS" | "FAIL", string, number | null] {
         if (!result.ok || result.status < 200 || result.status >= 300) {
           const msg = extractMessage(result.body);
           return ["FAIL", `HTTP ${result.status}${msg ? ` — ${msg.slice(0, 200)}` : ""}`, null];
         }
         const body = result.body as Record<string, unknown> | null | undefined;
         if (!body || typeof body !== "object") return ["FAIL", "unrecognized response body", null];

         const status = (body as { status?: unknown }).status;
         if (typeof status === "string" && status.toUpperCase() === "ERROR") {
           return ["FAIL", `body.status=ERROR — ${extractMessage(body).slice(0, 200)}`, null];
         }

         // Parse encoded row count from data_str (Kinetica /execute/sql encoding:"json" shape).
         const dataStr = (body as { data_str?: unknown }).data_str;
         let countN: number | null = null;
         if (typeof dataStr === "string" && dataStr.length > 0) {
           try {
             const parsed = JSON.parse(dataStr);
             const inner =
               typeof parsed?.json_encoded_response === "string"
                 ? JSON.parse(parsed.json_encoded_response)
                 : parsed?.json_encoded_response ?? parsed;
             const col = inner?.column_1 ?? inner?.n ?? inner?.["COUNT(*)"];
             if (Array.isArray(col) && col.length > 0) countN = Number(col[0]);
           } catch {
             // dataStr present but unparseable — countN stays null
           }
         }

         if (countN === null) {
           // Signature OK, row count unverified — record AMBIGUOUS as PASS-ish but flag explicitly
           return ["PASS", `${label} signature OK; row count unverified (inspect body)`, null];
         }
         if (countN > 0) {
           return ["PASS", `${label} signature OK; ${countN} rows match`, countN];
         }
         return ["FAIL", `${label} signature OK but 0 rows match — predicate likely no-ops (wrong arg order or unsupported geometry type)`, 0];
       }

       function extractMessage(body: unknown): string {
         if (!body || typeof body !== "object") return "";
         const obj = body as Record<string, unknown>;
         return (typeof obj.message === "string" && obj.message) ||
                (typeof obj.error === "string" && obj.error) ||
                "";
       }
       ```

    7. **Probe matrix** — 12 sequential probes (NO early-exit; CONTEXT.md mandates capturing ALL outputs so future re-runs know whether fallback ALSO works). Use SELECT COUNT(*) so the classify() row-count parse is trivial.

       Latlon mode probes (use literal predicates EXACTLY as shown — argument order is the trap):

       ```typescript
       // L-A1: STXY_WITHIN(x, y, geom) — x, y FIRST
       const sqlL_A1 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
       // L-A2: same predicate, circle WKT
       const sqlL_A2 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${circleWkt}')) = 1`;
       // L-A3: same predicate, lasso WKT
       const sqlL_A3 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${lassoWkt}')) = 1`;
       // L-B1: STXY_CONTAINS(geom, x, y) — geom FIRST (INVERSE arg order from STXY_WITHIN)
       const sqlL_B1 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_CONTAINS(ST_GEOMFROMTEXT('${bboxWkt}'), ${LATLON_LON_COL}, ${LATLON_LAT_COL}) = 1`;
       // L-B2: same predicate, circle WKT
       const sqlL_B2 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_CONTAINS(ST_GEOMFROMTEXT('${circleWkt}'), ${LATLON_LON_COL}, ${LATLON_LAT_COL}) = 1`;
       // L-B3: same predicate, lasso WKT
       const sqlL_B3 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_CONTAINS(ST_GEOMFROMTEXT('${lassoWkt}'), ${LATLON_LON_COL}, ${LATLON_LAT_COL}) = 1`;
       ```

       WKT mode probes (column geom INSIDE WKT geom for ST_WITHIN; symmetric for ST_INTERSECTS but emit geom column first):

       ```typescript
       // W-A1: ST_WITHIN(geom_col, geom_literal) — column inside literal
       const sqlW_A1 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_WITHIN(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
       // W-A2: same predicate, circle WKT
       const sqlW_A2 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_WITHIN(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${circleWkt}')) = 1`;
       // W-A3: same predicate, lasso WKT
       const sqlW_A3 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_WITHIN(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${lassoWkt}')) = 1`;
       // W-B1: ST_INTERSECTS(geom_col, geom_literal) — symmetric; emit geom column first for consistency
       const sqlW_B1 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_INTERSECTS(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
       // W-B2: same predicate, circle WKT
       const sqlW_B2 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_INTERSECTS(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${circleWkt}')) = 1`;
       // W-B3: same predicate, lasso WKT
       const sqlW_B3 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_INTERSECTS(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${lassoWkt}')) = 1`;
       ```

       For EACH probe, emit (mirror `wkbSpike.ts:180-188`):
       ```typescript
       console.log("=== Probe L-A1: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<bbox-WKT>')) — latlon bbox ===");
       console.log(`[spatial-predicate-spike] SQL: ${sqlL_A1}`);
       const resultL_A1 = await runSql(sqlL_A1);
       console.log(`[spatial-predicate-spike] HTTP status: ${resultL_A1.status}`);
       console.log(`[spatial-predicate-spike] Body (verbatim):`);
       console.log(JSON.stringify(resultL_A1.body, null, 2));
       console.log("");
       ```

       Repeat for all 12 probes. DO NOT truncate body output — operator needs verbatim error messages for the Decision record.

       Order: L-A1, L-A2, L-A3, L-B1, L-B2, L-B3, W-A1, W-A2, W-A3, W-B1, W-B2, W-B3. Putting bbox first (smallest WKT) before lasso (largest WKT) per mode isolates V15-P-03 SQL-length-cap failures cleanly — if only L-A3 / L-B3 / W-A3 / W-B3 FAIL while smaller shapes PASS, the lasso vertex cap is the issue.

    8. **Summary section** — classify all 12 results and emit a SPIKE SUMMARY block. Mirror `wkbSpike.ts:211-235` but expanded for 12 probes:

       ```typescript
       const verdicts = {
         L_A1: classify("Probe L-A1", resultL_A1),
         L_A2: classify("Probe L-A2", resultL_A2),
         L_A3: classify("Probe L-A3", resultL_A3),
         L_B1: classify("Probe L-B1", resultL_B1),
         L_B2: classify("Probe L-B2", resultL_B2),
         L_B3: classify("Probe L-B3", resultL_B3),
         W_A1: classify("Probe W-A1", resultW_A1),
         W_A2: classify("Probe W-A2", resultW_A2),
         W_A3: classify("Probe W-A3", resultW_A3),
         W_B1: classify("Probe W-B1", resultW_B1),
         W_B2: classify("Probe W-B2", resultW_B2),
         W_B3: classify("Probe W-B3", resultW_B3),
       };

       console.log("=== SPIKE SUMMARY ===");
       console.log("");
       console.log("Latlon mode probes (table: " + LATLON_TABLE + "):");
       for (const k of ["L_A1","L_A2","L_A3","L_B1","L_B2","L_B3"] as const) {
         const [v, r] = verdicts[k];
         console.log(`  ${k.replace("_","-")}: ${v} — ${r}`);
       }
       console.log("");
       console.log("WKT mode probes (table: " + WKT_TABLE + "):");
       for (const k of ["W_A1","W_A2","W_A3","W_B1","W_B2","W_B3"] as const) {
         const [v, r] = verdicts[k];
         console.log(`  ${k.replace("_","-")}: ${v} — ${r}`);
       }
       console.log("");

       // Determine first-PASS predicate per mode (CONTEXT.md: "Decision record locks the first PASS per mode";
       // ordering preference per REQUIREMENTS.md: STXY_WITHIN before STXY_CONTAINS for latlon;
       //                                          ST_WITHIN before ST_INTERSECTS for WKT)
       const latlonAllPass = verdicts.L_A1[0] === "PASS" && verdicts.L_A2[0] === "PASS" && verdicts.L_A3[0] === "PASS";
       const latlonBPass   = verdicts.L_B1[0] === "PASS" && verdicts.L_B2[0] === "PASS" && verdicts.L_B3[0] === "PASS";
       const wktAllPass    = verdicts.W_A1[0] === "PASS" && verdicts.W_A2[0] === "PASS" && verdicts.W_A3[0] === "PASS";
       const wktBPass      = verdicts.W_B1[0] === "PASS" && verdicts.W_B2[0] === "PASS" && verdicts.W_B3[0] === "PASS";

       const latlonChoice = latlonAllPass ? "STXY_WITHIN" : latlonBPass ? "STXY_CONTAINS" : "NONE_ESCALATE";
       const wktChoice    = wktAllPass    ? "ST_WITHIN"   : wktBPass    ? "ST_INTERSECTS" : "NONE_ESCALATE";

       console.log(`[spatial-predicate-spike] Latlon mode recommendation: ${latlonChoice}`);
       console.log(`[spatial-predicate-spike] WKT mode recommendation: ${wktChoice}`);
       if (latlonChoice === "NONE_ESCALATE" || wktChoice === "NONE_ESCALATE") {
         console.log("[spatial-predicate-spike] Overall: NONE_ESCALATE → BLOCK_V15 (CONTEXT.md mandates milestone re-scope on any mode FAIL)");
       } else {
         console.log("[spatial-predicate-spike] Overall: PASS — Phase 26 buildSpatialOrBlock authorized");
       }
       console.log("");
       console.log("[spatial-predicate-spike] Done. Paste this full stdout + your Kinetica version into chat to complete Task 2.");
       ```

    9. **Update `kinetica_bi/server/package.json`** — preserve `wms-spike` and `wkb-spike` entries verbatim; add NEW entry:
       ```json
       "spatial-predicate-spike": "tsx src/spatialPredicateSpike.ts"
       ```

    Anti-patterns to avoid (do NOT do these):
    - DO NOT send `{ statement, limit }` only — Phase 18 lost a round-trip to this exact bug. Send the 7-field payload verbatim.
    - DO NOT hardcode the latlon column names `pickup_longitude` / `pickup_latitude` or the WKT geom column name `WKT` in SQL strings — use env-var values (`LATLON_LON_COL`, `LATLON_LAT_COL`, `WKT_GEOM_COL`).
    - DO NOT swap the argument order — `STXY_WITHIN(x, y, geom)` puts x,y FIRST; `STXY_CONTAINS(geom, x, y)` puts geom FIRST. Reversing is the silent-bug surface this spike exists to catch.
    - DO NOT omit the `= 1` suffix on any predicate — Kinetica returns integer 1/0 (NOT boolean); the `/execute/sql` engine rejects `WHERE STXY_WITHIN(...)` without `= 1`.
    - DO NOT truncate body output (operator needs verbatim error messages for the Decision record).
    - DO NOT early-exit after first PASS — CONTEXT.md mandates ALL 12 probes execute so future re-runs know whether fallback ALSO works.
    - DO NOT add try/catch around the script body — let it crash with a stack trace if env vars are misconfigured (operator-friendly debugging).
    - DO NOT import from `kinetica_bi/server/src/lib/spatialQuery.ts` or any project module — runner stays self-contained per Phase 18 precedent.
    - DO NOT execute any probes from this task — Claude only WRITES the script. Operator runs it in Task 2.
    - DO NOT create the `25-SPIKE-NOTES.md` file in this task — that is Task 3 after operator output is captured.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/spatialPredicateSpike.ts` exists
    - File contains the literal string `STXY_WITHIN(` (latlon Probe A predicate)
    - File contains the literal string `STXY_CONTAINS(` (latlon Probe B predicate)
    - File contains the literal string `ST_WITHIN(` (WKT Probe A predicate)
    - File contains the literal string `ST_INTERSECTS(` (WKT Probe B predicate)
    - File contains the literal string `ST_GEOMFROMTEXT(` (WKT-literal wrapping)
    - File contains the literal string `= 1` (integer 1/0 predicate suffix — Pitfall 4 mitigation)
    - File contains `encoding: "json"` AND `request_schema_str` AND `data: []` AND `options: {}` (production-parity 7-field payload)
    - File contains `import dotenv from "dotenv"` and `dotenv.config()` (env-var loading)
    - File reads `process.env.LATLON_TABLE`, `process.env.LATLON_LON_COL`, `process.env.LATLON_LAT_COL`, `process.env.WKT_TABLE`, `process.env.WKT_GEOM_COL`, `process.env.PROBE_CENTER_LON`, `process.env.PROBE_CENTER_LAT`, `process.env.PROBE_HALF_DEG` (confirmed by grep)
    - File contains `function buildBboxWkt(` (4-corner WKT generator)
    - File contains `function buildRegularPolygonWkt(` (64-vertex circle WKT generator)
    - File contains `function buildJitteredPolygonWkt(` (150-vertex lasso WKT generator)
    - File contains `function classify(` (strong PASS/FAIL classifier)
    - File contains the literal string `=== SPIKE SUMMARY ===` (summary banner)
    - File contains all 12 probe labels: `L-A1`, `L-A2`, `L-A3`, `L-B1`, `L-B2`, `L-B3`, `W-A1`, `W-A2`, `W-A3`, `W-B1`, `W-B2`, `W-B3` (or matching `Probe L-A1`/etc. — grep `Probe [LW]-[AB][123]` returns exactly 12 matches)
    - `package.json` scripts object contains `"spatial-predicate-spike": "tsx src/spatialPredicateSpike.ts"`
    - Existing `wms-spike` and `wkb-spike` script entries preserved (regression check)
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0 (script type-checks against existing tsconfig)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && grep -q "STXY_WITHIN(" src/spatialPredicateSpike.ts && grep -q "STXY_CONTAINS(" src/spatialPredicateSpike.ts && grep -q "ST_WITHIN(" src/spatialPredicateSpike.ts && grep -q "ST_INTERSECTS(" src/spatialPredicateSpike.ts && grep -q "ST_GEOMFROMTEXT(" src/spatialPredicateSpike.ts && grep -q "= 1" src/spatialPredicateSpike.ts && grep -q 'encoding: "json"' src/spatialPredicateSpike.ts && grep -q "request_schema_str" src/spatialPredicateSpike.ts && grep -q "buildBboxWkt" src/spatialPredicateSpike.ts && grep -q "buildRegularPolygonWkt" src/spatialPredicateSpike.ts && grep -q "buildJitteredPolygonWkt" src/spatialPredicateSpike.ts && grep -q "function classify(" src/spatialPredicateSpike.ts && grep -q "=== SPIKE SUMMARY ===" src/spatialPredicateSpike.ts && [ "$(grep -oE 'Probe [LW]-[AB][123]' src/spatialPredicateSpike.ts | sort -u | wc -l)" -ge 12 ] && grep -q '"spatial-predicate-spike": "tsx src/spatialPredicateSpike.ts"' package.json && grep -q '"wms-spike"' package.json && grep -q '"wkb-spike"' package.json && npx tsc --noEmit</automated>
  </verify>
  <done>spatialPredicateSpike.ts is committed; npm run spatial-predicate-spike is wired in package.json; tsc --noEmit passes; operator can run `npm run spatial-predicate-spike` from `kinetica_bi/server` against their deployed Kinetica with the 11 env vars set.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Operator runs `npm run spatial-predicate-spike` against deployed Kinetica and pastes verbatim stdout</name>
  <files>(no files modified — operator captures output to chat; Task 3 turns it into 25-SPIKE-NOTES.md)</files>
  <read_first>
    - kinetica_bi/server/src/spatialPredicateSpike.ts (the script the operator runs — verify it exists and the env-var contract matches the OPERATOR INSTRUCTIONS below)
    - .planning/phases/25-spatial-predicate-spike/25-CONTEXT.md (locked fixtures: demo.nyctaxi for latlon, ki_home.us_states.WKT for WKT)
  </read_first>
  <action>
    THIS IS A BLOCKING HUMAN-ACTION CHECKPOINT — Claude does NOT execute the spike. Claude pauses and instructs the operator. There is no CLI / API Claude can substitute here: the spike must run against the operator's deployed Kinetica instance with the operator's own BI-user credentials (password mode), inside the operator's network/VPN context.

    OPERATOR INSTRUCTIONS:

    1. Confirm fixture reachability. Open Kinetica Workbench (or your SQL client) and confirm BOTH of these SELECT queries return ≥1 row from your account:
       ```sql
       SELECT COUNT(*) FROM demo.nyctaxi;
       SELECT COUNT(*) FROM ki_home.us_states;
       ```
       If either is unreachable, STOP and report it before continuing — the spike fixtures are operator-locked per CONTEXT.md and cannot be silently swapped.

    2. Confirm the WKT geometry column NAME on `ki_home.us_states`. Run:
       ```sql
       DESCRIBE TABLE ki_home.us_states;
       ```
       If the geometry column is literally named `WKT` (column-named-after-its-type), use `WKT_GEOM_COL=WKT` below. If it has a different name, substitute that name (the spike runner is env-var-driven and does NOT assume any conventional name).

    3. Add the following 8 spike-target env vars to `kinetica_bi/server/.env` (the KINETICA_URL / USERNAME / PASSWORD entries should already be present from prior phases):
       ```
       LATLON_TABLE=demo.nyctaxi
       LATLON_LON_COL=pickup_longitude
       LATLON_LAT_COL=pickup_latitude
       WKT_TABLE=ki_home.us_states
       WKT_GEOM_COL=WKT
       PROBE_CENTER_LON=-73.95
       PROBE_CENTER_LAT=40.75
       PROBE_HALF_DEG=0.5
       ```

    4. **(Backend dev shell precaution per project memory `project_backend_env_load_order.md`):** The spike script itself loads `.env` via `dotenv.config()` at the top of `spatialPredicateSpike.ts` — you do NOT need to `source .env` for the spike. HOWEVER, if you also want to run `npm run dev` in another shell first (e.g., to confirm Kinetica reachability via the existing BI app), source the env first to avoid `kinetica_bi/server`'s ESM import-order bug:
       ```bash
       cd kinetica_bi/server && set -a; source .env; set +a && npm run dev
       ```
       For the spike itself, the `source .env` step is NOT required — just:
       ```bash
       cd kinetica_bi/server && npm run spatial-predicate-spike
       ```

    5. Run the spike from `kinetica_bi/server`:
       ```bash
       cd kinetica_bi/server && npm run spatial-predicate-spike
       ```

    6. Paste the FULL stdout into chat — EVERY line from `[spatial-predicate-spike] Deployed Kinetica: ...` through `[spatial-predicate-spike] Done. ...`. Do NOT truncate any probe body — Task 3 needs verbatim Kinetica error messages (especially for any HTTP 400 responses, which carry the function-name / signature / SQL-length information).

    7. Also paste:
       (a) Your Kinetica server version (e.g., `7.1.9.x`). If unknown, run `SHOW SYSTEM PROPERTIES;` in Kinetica Workbench OR check the deployment banner on the Workbench landing page. If still unknown, say "version unknown".
       (b) The verbatim values you used for `LATLON_TABLE`, `LATLON_LON_COL`, `LATLON_LAT_COL`, `WKT_TABLE`, `WKT_GEOM_COL`, `PROBE_CENTER_LON`, `PROBE_CENTER_LAT`, `PROBE_HALF_DEG` (so 25-SPIKE-NOTES.md records what the spike actually ran against). Do NOT paste KINETICA_URL or credentials.

    8. Note any observations the script could not capture — e.g., if you saw a transient network blip and re-ran, if your Kinetica was under load, etc.

    Resume signal: type `spatial predicate spike output captured` once you have pasted (a) full stdout, (b) Kinetica version, (c) probe env values, (d) any observations.

    Claude proceeds to Task 3 only after the operator has pasted all four.

    Why this is a HUMAN-ACTION checkpoint (not auto/auth-gate): The spike runs against a private Kinetica instance reachable only from the operator's network with credentials Claude does not have. Even if Claude had credentials, the strong PASS criterion (≥1 row) requires the operator's account to have read access to demo.nyctaxi + ki_home.us_states — those grants live on the operator's Kinetica server and cannot be programmatically inspected by Claude. Operator runs, operator pastes; Claude diagnoses.
  </action>
  <acceptance_criteria>
    - Operator has pasted full stdout from `npm run spatial-predicate-spike`, including the SPIKE SUMMARY block with verdicts for all 12 probes (L-A1, L-A2, L-A3, L-B1, L-B2, L-B3, W-A1, W-A2, W-A3, W-B1, W-B2, W-B3)
    - Operator has provided Kinetica server version (or explicit "version unknown")
    - Operator has provided verbatim env values for LATLON_TABLE, LATLON_LON_COL, LATLON_LAT_COL, WKT_TABLE, WKT_GEOM_COL, PROBE_CENTER_LON, PROBE_CENTER_LAT, PROBE_HALF_DEG
    - Operator has typed the resume signal `spatial predicate spike output captured`
    - Outcome class is one of: (a) at least one full-mode candidate PASSed for BOTH latlon AND WKT modes (Phase 26 unblocked), OR (b) explicit NONE_ESCALATE on ≥1 mode (milestone re-scope triggered per CONTEXT.md "Total-fail escalation" lock; partial-fail is NOT an authorized escalation path)
  </acceptance_criteria>
  <verify>
    <automated>MISSING — checkpoint task: verification is human-driven (operator pastes spike output to chat; Claude reads chat). Task 3 produces the verifiable file artifact (25-SPIKE-NOTES.md) and runs a file-existence check there.</automated>
  </verify>
  <done>Operator has typed `spatial predicate spike output captured` and pasted full spike stdout + Kinetica version + probe env values + observations. Claude has all data needed to author 25-SPIKE-NOTES.md in Task 3.</done>
  <resume-signal>Type "spatial predicate spike output captured" and paste (a) full stdout from npm run spatial-predicate-spike, (b) Kinetica server version (or "unknown"), (c) verbatim values used for LATLON_TABLE / LATLON_LON_COL / LATLON_LAT_COL / WKT_TABLE / WKT_GEOM_COL / PROBE_CENTER_LON / PROBE_CENTER_LAT / PROBE_HALF_DEG, (d) any observations not captured by the script</resume-signal>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Write 25-SPIKE-NOTES.md from operator's spike output + decision record + Phase 26 SQL templates</name>
  <files>.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md</files>
  <read_first>
    - .planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md (format precedent — section-by-section structure to mirror; verbatim probe-body capture pattern; Decision section shape with downstream-consequence block; Caveats free-form; Open Question Resolutions checklist)
    - .planning/phases/25-spatial-predicate-spike/25-RESEARCH.md §"Decision Record Schema" (the exact section structure for 25-SPIKE-NOTES.md — lines 232-303 — Claude should follow this template verbatim with the operator's data filled in)
    - .planning/phases/25-spatial-predicate-spike/25-CONTEXT.md (decision-locking rules: first-PASS-per-mode preference; STXY_WITHIN before STXY_CONTAINS for latlon; ST_WITHIN before ST_INTERSECTS for WKT; NONE_ESCALATE → BLOCK_V15 on any mode FAIL)
    - kinetica_bi/server/src/spatialPredicateSpike.ts (re-read so SQL templates documented in 25-SPIKE-NOTES.md match what the script actually issued — argument orders, `= 1` suffixes, ST_GEOMFROMTEXT wrapping)
    - The Task 2 chat-attached operator output (raw stdout from npm run spatial-predicate-spike + Kinetica version + env values + observations)
  </read_first>
  <action>
    Create `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md` with the section structure below. Fill every `<...>` placeholder from the operator's Task 2 output verbatim. Where a probe genuinely yielded ambiguous data (e.g., HTTP 200 + body.status OK but `data_str` unparseable), record the verbatim body and classify per the rules — never fabricate.

    Required structure:

    ```markdown
    # Phase 25 — Spatial Predicate Spike Notes

    **Spike date:** <ISO date YYYY-MM-DD from operator's run timestamp>
    **Deployed Kinetica:** <KINETICA_URL value with credentials redacted, e.g. http://172.31.0.22:8082/gpudb-0>
    **Operator:** <username from KINETICA_USERNAME, redacted to first letter + *** if sensitive — e.g. admin>
    **Kinetica version:** <operator-provided, e.g. "7.1.9.x" or "unknown">
    **Latlon fixture:** <LATLON_TABLE>.<LATLON_LON_COL>, <LATLON_LAT_COL> — e.g. `demo.nyctaxi.(pickup_longitude, pickup_latitude)`
    **WKT fixture:** <WKT_TABLE>.<WKT_GEOM_COL> — e.g. `ki_home.us_states.WKT`
    **Probe anchor:** lon=<PROBE_CENTER_LON>, lat=<PROBE_CENTER_LAT>, ±<PROBE_HALF_DEG>° bbox
    **Auth mode:** password (OIDC deferred to Phase 31 UAT per CONTEXT.md "Auth mode coverage")
    **Confidence:** HIGH (all probes verified against deployed Kinetica) | MEDIUM (one or more probes ambiguous — documented below) | LOW (NONE_ESCALATE on ≥1 mode; milestone re-scope required)

    ## Latlon Probes

    ### Probe L-A1 — STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1
    **SQL:**
    ```sql
    SELECT COUNT(*) AS n FROM <LATLON_TABLE> WHERE STXY_WITHIN(<LATLON_LON_COL>, <LATLON_LAT_COL>, ST_GEOMFROMTEXT('<bbox-WKT verbatim from stdout>')) = 1
    ```
    **HTTP status:** <200 | 400 | other>
    **Rows returned (COUNT):** <integer or "unparseable">
    **Body (verbatim):**
    ```json
    <verbatim JSON from operator's stdout — full body, do NOT truncate; for HTTP 200 include data_str>
    ```
    **Status:** PASS | FAIL
    **Failure reason (if FAIL):** <one-line — e.g. "0 rows match — predicate likely no-ops (arg order wrong?)" or "body.message: function not found">

    ### Probe L-A2 — STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<64-vertex circle WKT>')) = 1
    [... same fields, circle WKT payload ...]

    ### Probe L-A3 — STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<150-vertex lasso WKT>')) = 1
    [... same fields, lasso WKT payload; specifically annotate if this probe surfaces a V15-P-03 statement-length cap (HTTP 400 with "statement too long" / "query length exceeded") ...]

    ### Probe L-B1 — STXY_CONTAINS(ST_GEOMFROMTEXT('<bbox-WKT>'), lon, lat) = 1
    [... same fields; note INVERSE arg order from L-A* probes — geom FIRST ...]

    ### Probe L-B2 — STXY_CONTAINS(ST_GEOMFROMTEXT('<circle-WKT>'), lon, lat) = 1
    [... same fields ...]

    ### Probe L-B3 — STXY_CONTAINS(ST_GEOMFROMTEXT('<lasso-WKT>'), lon, lat) = 1
    [... same fields ...]

    ## WKT Probes

    ### Probe W-A1 — ST_WITHIN(<WKT_GEOM_COL>, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1
    [... same fields; ki_home.us_states fixture ...]

    ### Probe W-A2 — ST_WITHIN(<WKT_GEOM_COL>, ST_GEOMFROMTEXT('<circle-WKT>')) = 1
    [... same fields ...]

    ### Probe W-A3 — ST_WITHIN(<WKT_GEOM_COL>, ST_GEOMFROMTEXT('<lasso-WKT>')) = 1
    [... same fields ...]

    ### Probe W-B1 — ST_INTERSECTS(<WKT_GEOM_COL>, ST_GEOMFROMTEXT('<bbox-WKT>')) = 1
    [... same fields ...]

    ### Probe W-B2 — ST_INTERSECTS(<WKT_GEOM_COL>, ST_GEOMFROMTEXT('<circle-WKT>')) = 1
    [... same fields ...]

    ### Probe W-B3 — ST_INTERSECTS(<WKT_GEOM_COL>, ST_GEOMFROMTEXT('<lasso-WKT>')) = 1
    [... same fields ...]

    ## Decision

    **Latlon-mode locked predicate:** STXY_WITHIN | STXY_CONTAINS | NONE_ESCALATE
    **WKT-mode locked predicate:** ST_WITHIN | ST_INTERSECTS | NONE_ESCALATE
    **Overall outcome:** PASS (Phase 26 buildSpatialOrBlock unblocked) | NONE_ESCALATE → BLOCK_V15 (milestone re-scope per CONTEXT.md "Total-fail escalation")

    **SQL template Phase 26 buildSpatialOrBlock will use (latlon mode):**
    ```sql
    -- For each shape `s` in the OR chain:
    <literal predicate string with $LON_COL / $LAT_COL / $WKT placeholders>
    -- Example for STXY_WITHIN PASS path:
    -- STXY_WITHIN($LON_COL, $LAT_COL, ST_GEOMFROMTEXT('$WKT')) = 1
    ```

    **SQL template Phase 26 buildSpatialOrBlock will use (WKT mode):**
    ```sql
    -- For each shape `s` in the OR chain:
    <literal predicate string with $GEOM_COL / $WKT placeholders>
    -- Example for ST_WITHIN PASS path:
    -- ST_WITHIN($GEOM_COL, ST_GEOMFROMTEXT('$WKT')) = 1
    ```

    **Reasoning:**
    Latlon mode: <one paragraph — why this name won. If STXY_WITHIN PASSed all three shapes, lock it (REQUIREMENTS.md primary; arg order x,y,geom). If STXY_WITHIN FAILed and STXY_CONTAINS PASSed, lock STXY_CONTAINS (note the geom,x,y inverse arg order in the SQL template). If both PASSed, lock STXY_WITHIN per CONTEXT.md "first PASS per mode" + REQUIREMENTS.md ordering preference, and note in ## Caveats that STXY_CONTAINS also PASSed (useful for future re-runs).>

    WKT mode: <one paragraph — same reasoning. ST_WITHIN if all-A PASS; ST_INTERSECTS if A failed and B PASSed; ST_WITHIN if both PASS per ordering preference, with ST_INTERSECTS PASS noted in ## Caveats.>

    **Downstream consequence:**
    - PASS path (both modes locked): Phase 26 `spatialWhereClause.ts:buildSpatialOrBlock` authorized to use the confirmed predicate names. All 4 WHERE-V15-* requirements unblocked. Plan 26-NN templates the SQL strings above verbatim with `$LON_COL` / `$LAT_COL` / `$GEOM_COL` / `$WKT` substituted at call time.
    - FAIL path (any mode NONE_ESCALATE): `BLOCK_V15`. CONTEXT.md "Total-fail escalation" lock: stop Phase 25, operator + planner reconvene, whole milestone shape changes. Partial-fail (latlon PASS + WKT FAIL or vice versa) is explicitly disallowed — same BLOCK_V15 outcome. Do NOT fall back to a TD carry-forward (different from v1.4 Phase 18 WKB outcome — that was a single-mode deferral; here all modes failing kills the milestone's value prop).

    ## Caveats

    <Free-form section. Fill from operator's stdout + observations. Topics to cover when present in the operator's data:
    - 150-vertex lasso outcome (V15-P-03 free probe): if L-A3 / L-B3 / W-A3 / W-B3 FAILed with "statement too long" / "query length exceeded" / "parse error near 'POLYGON'" while bbox + circle PASSed, document the verbatim Kinetica response here and recommend Phase 29's `geometry.simplify` config drops the vertex cap from 150 to a lower number (e.g., 100). This is the V15-P-03 mitigation surfaced at spike time per CONTEXT.md.
    - Argument-order findings: if both STXY_WITHIN AND STXY_CONTAINS PASSed, note this here for future re-runs.
    - Kinetica-version-specific quirks: if the operator's Kinetica version differs from 7.1 docs assumptions, note any deviation.
    - HTTP 200 + 0-row outcomes: if any probe returned HTTP 200 but COUNT=0, this caught a silent wrong-arg-order no-op the v1.5 strong PASS criterion is designed to detect — document the probe label and the body verbatim.
    - Auth mode: confirm password mode was used; OIDC deferred to Phase 31 UAT per CONTEXT.md.
    - Operator observations from Task 2 step 8.>

    ## Open Question Resolutions

    - **OQ-1 (latlon predicate name conflict — REQUIREMENTS.md `STXY_WITHIN` vs SUMMARY.md `STXY_CONTAINS`):** RESOLVED → <winning name per Decision>. <One-line rationale: e.g., "STXY_WITHIN PASSed all 3 shapes; primary per REQUIREMENTS.md; first-PASS per CONTEXT.md.">
    - **OQ-2 (WKT predicate name conflict — REQUIREMENTS.md `ST_WITHIN` vs SUMMARY.md `ST_INTERSECTS`):** RESOLVED → <winning name per Decision>. <One-line rationale.>
    - **OQ-3 (150-vertex polygon SQL length limit — V15-P-03):** RESOLVED → ACCEPTED (all lasso probes PASSed) | REJECTED with Kinetica response excerpt (vertex cap must drop for Phase 29) | INCONCLUSIVE (some PASS some FAIL — see ## Caveats).
    - **OQ-4 (STXY_DWITHIN distance unit — V15-P-05):** DEFERRED to Phase 26 supertest per CONTEXT.md "Claude's Discretion" — v1.5 circles use 64-vertex POLYGON approximation per WHERE-V15-01 (not STXY_DWITHIN), so V15-P-05 is a v1.6 concern (`DWITHIN-V16-01`). Not spiked here.
    ```

    Filling rules:
    - Fill EVERY `<...>` placeholder from operator's Task 2 paste. Verbatim Kinetica body JSON goes inside the fenced `json` blocks exactly as the operator pasted (do NOT re-format, do NOT truncate even if a body is 50+ lines).
    - For each probe, the **Status** field MUST be derived from the SPIKE SUMMARY line in the operator's stdout — Task 1's classify() already did the classification work. Trust it.
    - For the **Decision** section, apply the locking rules from CONTEXT.md and REQUIREMENTS.md:
      - Latlon: STXY_WITHIN preferred (REQUIREMENTS.md primary, first-PASS per CONTEXT.md); fall back to STXY_CONTAINS only if all three STXY_WITHIN probes (L-A1, L-A2, L-A3) FAILed AND all three STXY_CONTAINS probes (L-B1, L-B2, L-B3) PASSed.
      - WKT: ST_WITHIN preferred; fall back to ST_INTERSECTS only if all three ST_WITHIN probes FAILed AND all three ST_INTERSECTS probes PASSed.
      - If neither candidate's all-three-shapes PASS for a mode: that mode is NONE_ESCALATE. If either mode is NONE_ESCALATE, overall outcome is NONE_ESCALATE → BLOCK_V15 (partial-fail is NOT an authorized escalation per CONTEXT.md).
    - For the **SQL template** code blocks: use `$LON_COL` / `$LAT_COL` / `$GEOM_COL` / `$WKT` as placeholders (so Phase 26's `buildSpatialOrBlock` planner can grep these and the substitution scheme is obvious). Match argument order to the locked predicate exactly:
      - STXY_WITHIN: `STXY_WITHIN($LON_COL, $LAT_COL, ST_GEOMFROMTEXT('$WKT')) = 1`
      - STXY_CONTAINS: `STXY_CONTAINS(ST_GEOMFROMTEXT('$WKT'), $LON_COL, $LAT_COL) = 1`
      - ST_WITHIN: `ST_WITHIN($GEOM_COL, ST_GEOMFROMTEXT('$WKT')) = 1`
      - ST_INTERSECTS: `ST_INTERSECTS($GEOM_COL, ST_GEOMFROMTEXT('$WKT')) = 1`

    Anti-patterns to avoid:
    - DO NOT fabricate a PASS for a probe the operator did not run.
    - DO NOT pick STXY_WITHIN as the default if the operator's L-A1/L-A2/L-A3 probes show HTTP 400 or COUNT=0 — read the body verbatim and apply the locking rules.
    - DO NOT skip the SQL-template-with-placeholders blocks — Phase 26 reads this file and copies the templates verbatim.
    - DO NOT leave any `<...>` placeholders unreplaced (other than literal `$LON_COL`-style template placeholders that are intended to remain in the SQL template blocks for Phase 26 to substitute).
    - DO NOT remove the Caveats section even if empty — write `(none)` instead, so the section structure is preserved for grep stability.
    - DO NOT classify an HTTP 200 + COUNT=0 probe as PASS — the v1.5 strong PASS criterion (≥1 row) is the whole point of this spike; record it as FAIL in the Decision and note in ## Caveats.
  </action>
  <acceptance_criteria>
    - File `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md` exists
    - File contains all 5 top-level section headers: `## Latlon Probes`, `## WKT Probes`, `## Decision`, `## Caveats`, `## Open Question Resolutions` (exact strings, line-anchored)
    - File contains all 12 probe sub-headers: `### Probe L-A1`, `### Probe L-A2`, `### Probe L-A3`, `### Probe L-B1`, `### Probe L-B2`, `### Probe L-B3`, `### Probe W-A1`, `### Probe W-A2`, `### Probe W-A3`, `### Probe W-B1`, `### Probe W-B2`, `### Probe W-B3` (grep for `^### Probe [LW]-[AB][123]` returns exactly 12 matches)
    - File contains the literal heading `**Latlon-mode locked predicate:**` followed by one of: STXY_WITHIN, STXY_CONTAINS, NONE_ESCALATE
    - File contains the literal heading `**WKT-mode locked predicate:**` followed by one of: ST_WITHIN, ST_INTERSECTS, NONE_ESCALATE
    - File contains the literal heading `**Overall outcome:**` followed by one of: PASS, NONE_ESCALATE
    - File contains the literal heading `**SQL template Phase 26 buildSpatialOrBlock will use (latlon mode):**` followed by a fenced sql code block
    - File contains the literal heading `**SQL template Phase 26 buildSpatialOrBlock will use (WKT mode):**` followed by a fenced sql code block
    - File contains the literal heading `**Downstream consequence:**` (Decision section completeness)
    - File contains the operator's Kinetica version line (`**Kinetica version:**`) and the latlon fixture line (`**Latlon fixture:**`) and the WKT fixture line (`**WKT fixture:**`)
    - File contains zero unfilled `<...>` placeholders (verify: `grep -E '<[A-Za-z_ -]+>' 25-SPIKE-NOTES.md` returns no matches OUTSIDE fenced code blocks; intentional `$LON_COL` / `$LAT_COL` / `$GEOM_COL` / `$WKT` placeholders inside SQL templates are fine and use a different sigil)
    - File contains no TODO / FIXME / XXX markers (`grep -cE 'TODO|FIXME|XXX' 25-SPIKE-NOTES.md` returns 0)
    - File contains all 4 Open Question entries: `OQ-1`, `OQ-2`, `OQ-3`, `OQ-4`
  </acceptance_criteria>
  <verify>
    <automated>test -f .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && [ "$(grep -cE '^## (Latlon Probes|WKT Probes|Decision|Caveats|Open Question Resolutions)$' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md)" -eq 5 ] && [ "$(grep -cE '^### Probe [LW]-[AB][123] ' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md)" -eq 12 ] && grep -qE '^\*\*Latlon-mode locked predicate:\*\* (STXY_WITHIN|STXY_CONTAINS|NONE_ESCALATE)' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -qE '^\*\*WKT-mode locked predicate:\*\* (ST_WITHIN|ST_INTERSECTS|NONE_ESCALATE)' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -qE '^\*\*Overall outcome:\*\* (PASS|NONE_ESCALATE)' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -q '\*\*SQL template Phase 26 buildSpatialOrBlock will use (latlon mode):\*\*' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -q '\*\*SQL template Phase 26 buildSpatialOrBlock will use (WKT mode):\*\*' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && [ "$(grep -cE 'TODO|FIXME|XXX' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md)" -eq 0 ] && grep -qE 'OQ-1.*RESOLVED|OQ-1.*BLOCKED' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -qE 'OQ-2.*RESOLVED|OQ-2.*BLOCKED' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -qE 'OQ-3' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md && grep -qE 'OQ-4' .planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md</automated>
  </verify>
  <done>25-SPIKE-NOTES.md is committed; all 12 probe sections have a definitive PASS/FAIL status with verbatim body; Decision section locks one of {STXY_WITHIN, STXY_CONTAINS, NONE_ESCALATE} for latlon and {ST_WITHIN, ST_INTERSECTS, NONE_ESCALATE} for WKT; SQL template blocks contain copy-paste-ready predicates with $LON_COL/$LAT_COL/$GEOM_COL/$WKT placeholders; Open Question Resolutions filled for OQ-1 through OQ-4; if NONE_ESCALATE, user is informed Phase 26 cannot proceed and milestone re-scope is required.</done>
</task>

</tasks>

<verification>
- All 12 spatial-predicate probes have verbatim probe body output captured (PASS or FAIL with reason) for both latlon and WKT modes across bbox / circle / lasso shapes
- The strong PASS criterion (HTTP 200 AND ≥1 row returned) was applied uniformly — no probe was classified PASS purely on HTTP 200
- Decision section commits to ONE chosen pattern per mode with verbatim copy-paste-ready SQL templates Phase 26 will use
- If NONE_ESCALATE on ANY mode, the milestone re-scope is triggered — Phase 26 is BLOCKED and the user is notified
- The `spatialPredicateSpike.ts` script type-checks (tsc --noEmit), uses the production-parity 7-field /execute/sql payload, and is preserved at a known commit for future Kinetica-version re-runs
- The 150-vertex lasso outcome is explicitly recorded in ## Caveats (V15-P-03 free probe — surfaces SQL-length cap if present)
- The argument-order trap is honored in both runner SQL and Decision SQL templates: STXY_WITHIN(x, y, geom) / STXY_CONTAINS(geom, x, y) / ST_WITHIN(geom, geom_literal) / ST_INTERSECTS(geom, geom_literal)
- All predicates suffixed with `= 1` (integer 1/0 return — Pitfall 4 mitigation)
</verification>

<success_criteria>
- `.planning/phases/25-spatial-predicate-spike/25-SPIKE-NOTES.md` exists, committed, structured per the section schema above
- `kinetica_bi/server/src/spatialPredicateSpike.ts` exists, committed, type-checks (tsc --noEmit), uses production-parity 7-field /execute/sql payload, contains all four candidate predicate names (STXY_WITHIN, STXY_CONTAINS, ST_WITHIN, ST_INTERSECTS) and three WKT helpers (buildBboxWkt, buildRegularPolygonWkt, buildJitteredPolygonWkt)
- `kinetica_bi/server/package.json` has `"spatial-predicate-spike": "tsx src/spatialPredicateSpike.ts"` in scripts; existing `wms-spike` and `wkb-spike` entries preserved
- Operator approval recorded in chat (resume signal `spatial predicate spike output captured` received)
- No probe outcome fabricated — every PASS/FAIL maps 1:1 to operator-pasted stdout from the script's classify() output
- Phase 26 can proceed (locked latlon predicate name + locked WKT predicate name + copy-paste SQL templates with `$LON_COL`/`$LAT_COL`/`$GEOM_COL`/`$WKT` placeholders) OR Phase 26 is BLOCKED (`NONE_ESCALATE → BLOCK_V15`) with milestone re-scope triggered per CONTEXT.md "Total-fail escalation" lock
- All 4 Open Question Resolutions filled (OQ-1 latlon name, OQ-2 WKT name, OQ-3 lasso vertex cap V15-P-03, OQ-4 STXY_DWITHIN deferred to Phase 26)
</success_criteria>

<output>
After completion, create `.planning/phases/25-spatial-predicate-spike/25-01-spatial-predicate-spike-SUMMARY.md` summarizing:
- PASS/FAIL status of each of the 12 probes (L-A1..L-A3, L-B1..L-B3, W-A1..W-A3, W-B1..W-B3)
- The locked latlon predicate name (STXY_WITHIN | STXY_CONTAINS | NONE_ESCALATE)
- The locked WKT predicate name (ST_WITHIN | ST_INTERSECTS | NONE_ESCALATE)
- The overall outcome (PASS — Phase 26 unblocked | NONE_ESCALATE — milestone re-scope required)
- The verbatim SQL templates Phase 26 buildSpatialOrBlock will use (with $LON_COL/$LAT_COL/$GEOM_COL/$WKT placeholders)
- The 150-vertex lasso outcome (V15-P-03 free probe — accepted | rejected with vertex cap recommendation | inconclusive)
- The operator's Kinetica version + the verbatim env values for LATLON_TABLE/LATLON_LON_COL/LATLON_LAT_COL/WKT_TABLE/WKT_GEOM_COL
- Whether Phase 26 can proceed (PASS path) or is BLOCKED (NONE_ESCALATE → BLOCK_V15)
</output>
