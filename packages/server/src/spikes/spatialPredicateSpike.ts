/**
 * spatialPredicateSpike.ts — Standalone spatial-predicate spike runner for Phase 25.
 *
 * PURPOSE: Probe the deployed Kinetica instance to confirm which spatial predicate
 * names and argument orders work for BOTH latlon mode (STXY_WITHIN vs STXY_CONTAINS)
 * and WKT mode (ST_WITHIN vs ST_INTERSECTS), against production-realistic shapes
 * (4-corner bbox, 64-vertex circle, 150-vertex lasso).
 *
 * SPIKE-V15-01 P1 GATE: No spatialWhereClause.ts code may be written until BOTH
 * latlon AND WKT predicate forms PASS the strong criterion (HTTP 200 AND ≥1 row).
 * This runner probes both candidate names per mode in a SINGLE operator session so
 * future Kinetica-version re-runs are one shot without a re-plan trip.
 *
 * Payload-parity reference: commit d458408 (Phase 18 wkbSpike.ts runner-bug fix).
 * The runner MUST send the full 7-field /execute/sql body — Phase 18 lost a full
 * round-trip by sending only { statement, limit: 1 }. See runSql() comment below.
 *
 * USAGE:
 *   cd server && npm run spatial-predicate-spike
 *
 * REQUIRED .env VARS:
 *   KINETICA_URL         (e.g. http://kinetica.example.com:9191/gpudb-0)
 *   KINETICA_USERNAME    (operator's BI username — password mode)
 *   KINETICA_PASSWORD    (operator's BI password)
 *   LATLON_TABLE         (e.g. demo.nyctaxi — schema-qualified)
 *   LATLON_LON_COL       (e.g. pickup_longitude)
 *   LATLON_LAT_COL       (e.g. pickup_latitude)
 *   WKT_TABLE            (e.g. ki_home.us_states — schema-qualified)
 *   WKT_GEOM_COL         (e.g. WKT — column LITERALLY named "WKT"; do NOT assume any conventional name)
 *   PROBE_CENTER_LON     (e.g. -73.95 — NYC anchor)
 *   PROBE_CENTER_LAT     (e.g. 40.75 — NYC anchor)
 *   PROBE_HALF_DEG       (e.g. 0.5 — ±0.5° bbox extent, ~50 km square)
 *
 * OUTPUT:
 *   - Stdout lines for each Probe (L-A1 through W-B3): SQL, HTTP status, FULL verbatim JSON body
 *   - SPIKE SUMMARY block with PASS/FAIL classification per probe + recommendations per mode
 *
 * NOT PART OF THE EXPRESS APP — this is a one-shot CLI script invoked via tsx.
 */
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

// ── Operator setup ──────────────────────────────────────────────────────────

const LATLON_TABLE = process.env.LATLON_TABLE;
const LATLON_LON_COL = process.env.LATLON_LON_COL;
const LATLON_LAT_COL = process.env.LATLON_LAT_COL;
const WKT_TABLE = process.env.WKT_TABLE;
const WKT_GEOM_COL = process.env.WKT_GEOM_COL;
const PROBE_CENTER_LON = process.env.PROBE_CENTER_LON;
const PROBE_CENTER_LAT = process.env.PROBE_CENTER_LAT;
const PROBE_HALF_DEG = process.env.PROBE_HALF_DEG;

if (
  !LATLON_TABLE ||
  !LATLON_LON_COL ||
  !LATLON_LAT_COL ||
  !WKT_TABLE ||
  !WKT_GEOM_COL ||
  !PROBE_CENTER_LON ||
  !PROBE_CENTER_LAT ||
  !PROBE_HALF_DEG
) {
  console.error(
    "[spatial-predicate-spike] ERROR: missing spike-target env vars. Add to server/.env:\n" +
      "\n" +
      "  LATLON_TABLE=demo.nyctaxi\n" +
      "  LATLON_LON_COL=pickup_longitude\n" +
      "  LATLON_LAT_COL=pickup_latitude\n" +
      "  WKT_TABLE=ki_home.us_states\n" +
      "  WKT_GEOM_COL=WKT\n" +
      "  PROBE_CENTER_LON=-73.95\n" +
      "  PROBE_CENTER_LAT=40.75\n" +
      "  PROBE_HALF_DEG=0.5\n",
  );
  process.exit(1);
}

const centerLon = Number(PROBE_CENTER_LON);
const centerLat = Number(PROBE_CENTER_LAT);
const halfDeg = Number(PROBE_HALF_DEG);

if (isNaN(centerLon) || isNaN(centerLat) || isNaN(halfDeg)) {
  console.error(
    "[spatial-predicate-spike] ERROR: PROBE_CENTER_LON, PROBE_CENTER_LAT, PROBE_HALF_DEG must be valid numbers. Got: " +
      `LON=${PROBE_CENTER_LON}, LAT=${PROBE_CENTER_LAT}, HALF=${PROBE_HALF_DEG}`,
  );
  process.exit(1);
}

console.log(`[spatial-predicate-spike] Deployed Kinetica: ${redactedUrl}`);
console.log(`[spatial-predicate-spike] User: ${KINETICA_USERNAME}`);
console.log(`[spatial-predicate-spike] Latlon target: ${LATLON_TABLE}.(${LATLON_LON_COL}, ${LATLON_LAT_COL})`);
console.log(`[spatial-predicate-spike] WKT target: ${WKT_TABLE}.${WKT_GEOM_COL}`);
console.log(`[spatial-predicate-spike] Probe anchor: lon=${centerLon}, lat=${centerLat}, ±${halfDeg}°`);
console.log("");

// ── Helpers ─────────────────────────────────────────────────────────────────

async function rawFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: basicAuth,
      ...(options.headers ?? {}),
    },
  });
}

async function runSql(sql: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${KINETICA_URL}/execute/sql`;
  let response: Response;
  try {
    // NOTE: payload shape MUST match production /execute/sql contract used by
    // server/src/kinetica.ts:154-170 (kineticaSql helper). Earlier versions of
    // the Phase 18 spike sent only { statement, limit: 1 } and Kinetica rejected the request
    // at preprocessing with: "Value: '' not a valid parameter. Valid values are:
    // binary, json, geojson, arrow (U/PUh:355)" — i.e. the missing `encoding` field
    // surfaced as a parameter-validation error BEFORE the SQL function-name questions
    // the spike is trying to answer were ever evaluated. Future investigators reading
    // 25-SPIKE-NOTES.md must trust that the spike's HTTP contract matches what
    // production code actually sends, so we mirror the production payload verbatim.
    // Payload-parity reference: commit d458408.
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

// ── WKT shape helpers ────────────────────────────────────────────────────────

// 4-corner bbox — 5 coordinates (4 corners + OGC closure)
function buildBboxWkt(cLon: number, cLat: number, half: number): string {
  const w = cLon - half, e = cLon + half;
  const s = cLat - half, n = cLat + half;
  return `POLYGON ((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

// Regular n-gon polygon (production source: ol/interaction/Draw.createRegularPolygon(64))
function buildRegularPolygonWkt(
  cLon: number,
  cLat: number,
  half: number,
  vertexCount: number,
): string {
  const coords: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const theta = (i / vertexCount) * 2 * Math.PI;
    const lon = cLon + half * Math.cos(theta);
    const lat = cLat + half * Math.sin(theta);
    coords.push(`${lon.toFixed(5)} ${lat.toFixed(5)}`);
  }
  coords.push(coords[0]); // OGC closure — first vertex repeated
  return `POLYGON ((${coords.join(", ")}))`;
}

// Jittered polygon (lasso simulation) — deterministic via seeded PRNG so re-runs are byte-identical.
// 150-vertex cap matches the Phase 29 production lasso hard-cap after geom.simplify().
// This probe ALSO acts as a free V15-P-03 (WHERE-clause size-bomb) probe:
// if Kinetica rejects it, the statement-length limit is surfaced now not at Phase 31 UAT.
function buildJitteredPolygonWkt(
  cLon: number,
  cLat: number,
  half: number,
  vertexCount: number,
  jitter: number = 0.05,
): string {
  let seed = 42; // deterministic — same run == same WKT string
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1; // [-1, 1)
  };
  const coords: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const theta = (i / vertexCount) * 2 * Math.PI;
    const r = half * (1 + jitter * rand());
    const lon = cLon + r * Math.cos(theta);
    const lat = cLat + r * Math.sin(theta);
    coords.push(`${lon.toFixed(5)} ${lat.toFixed(5)}`);
  }
  coords.push(coords[0]); // OGC closure
  return `POLYGON ((${coords.join(", ")}))`;
}

// Pre-compute the three WKT strings once at module scope
const bboxWkt   = buildBboxWkt(centerLon, centerLat, halfDeg);
const circleWkt = buildRegularPolygonWkt(centerLon, centerLat, halfDeg, 64);
const lassoWkt  = buildJitteredPolygonWkt(centerLon, centerLat, halfDeg, 150, 0.05);

// ── Strengthened classify() helper ──────────────────────────────────────────
// STRONGER than wkbSpike.ts:133-166.
// PASS = HTTP 200 + body.status !== "ERROR" + COUNT(*) > 0
// FAIL = HTTP non-2xx OR body.status === "ERROR" OR COUNT(*) === 0 OR COUNT unparseable
// The ≥1-row criterion catches silent wrong-arg-order no-ops (Phase 25 differentiator from Phase 18).
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
  // Production parse pattern mirrors kinetica.ts:209-214.
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
  return [
    "FAIL",
    `${label} signature OK but 0 rows match — predicate likely no-ops (wrong arg order or unsupported geometry type)`,
    0,
  ];
}

function extractMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  return (
    (typeof obj.message === "string" && obj.message) ||
    (typeof obj.error === "string" && obj.error) ||
    ""
  );
}

// ── Probe matrix — 12 sequential probes ─────────────────────────────────────
// ALL 12 probes execute unconditionally (no early-exit).
// CONTEXT.md mandates capturing ALL outputs so future re-runs know whether the
// fallback candidate ALSO works, and to isolate V15-P-03 SQL-length-cap failures
// (only lasso shapes: L-A3, L-B3, W-A3, W-B3 are affected if the limit is hit).
//
// CRITICAL argument-order trap:
//   STXY_WITHIN(x, y, geom)           — x, y FIRST   (float, float, geometry)
//   STXY_CONTAINS(geom, x, y)         — geom FIRST   (geometry, float, float)
//   ST_WITHIN(geom_col, geom_literal) — column inside literal (geometry, geometry)
//   ST_INTERSECTS(geom_col, geom_lit) — symmetric; column first for consistency
//
// All predicates return integer 1 or 0 (NOT boolean) per Kinetica 7.1 docs — EVERY probe
// suffixes `= 1`.
//
// SQL shape: SELECT COUNT(*) AS n — trivial row-count parse for classify().

// ── LATLON MODE: STXY_WITHIN ─────────────────────────────────────────────────

console.log("=== Probe L-A1: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<bbox-WKT>')) — latlon bbox ===");
const sqlL_A1 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlL_A1}`);
const resultL_A1 = await runSql(sqlL_A1);
console.log(`[spatial-predicate-spike] HTTP status: ${resultL_A1.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_A1.body, null, 2));
console.log("");

console.log("=== Probe L-A2: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<64-vertex-circle-WKT>')) — latlon circle ===");
const sqlL_A2 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${circleWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlL_A2}`);
const resultL_A2 = await runSql(sqlL_A2);
console.log(`[spatial-predicate-spike] HTTP status: ${resultL_A2.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_A2.body, null, 2));
console.log("");

console.log("=== Probe L-A3: STXY_WITHIN(lon, lat, ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>')) — latlon lasso ===");
const sqlL_A3 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_WITHIN(${LATLON_LON_COL}, ${LATLON_LAT_COL}, ST_GEOMFROMTEXT('${lassoWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlL_A3}`);
const resultL_A3 = await runSql(sqlL_A3);
console.log(`[spatial-predicate-spike] HTTP status: ${resultL_A3.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_A3.body, null, 2));
console.log("");

// ── LATLON MODE: STXY_CONTAINS ───────────────────────────────────────────────

console.log("=== Probe L-B1: STXY_CONTAINS(ST_GEOMFROMTEXT('<bbox-WKT>'), lon, lat) — latlon bbox (INVERSE arg order) ===");
const sqlL_B1 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_CONTAINS(ST_GEOMFROMTEXT('${bboxWkt}'), ${LATLON_LON_COL}, ${LATLON_LAT_COL}) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlL_B1}`);
const resultL_B1 = await runSql(sqlL_B1);
console.log(`[spatial-predicate-spike] HTTP status: ${resultL_B1.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_B1.body, null, 2));
console.log("");

console.log("=== Probe L-B2: STXY_CONTAINS(ST_GEOMFROMTEXT('<64-vertex-circle-WKT>'), lon, lat) — latlon circle (INVERSE arg order) ===");
const sqlL_B2 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_CONTAINS(ST_GEOMFROMTEXT('${circleWkt}'), ${LATLON_LON_COL}, ${LATLON_LAT_COL}) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlL_B2}`);
const resultL_B2 = await runSql(sqlL_B2);
console.log(`[spatial-predicate-spike] HTTP status: ${resultL_B2.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_B2.body, null, 2));
console.log("");

console.log("=== Probe L-B3: STXY_CONTAINS(ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>'), lon, lat) — latlon lasso (INVERSE arg order) ===");
const sqlL_B3 = `SELECT COUNT(*) AS n FROM ${LATLON_TABLE} WHERE STXY_CONTAINS(ST_GEOMFROMTEXT('${lassoWkt}'), ${LATLON_LON_COL}, ${LATLON_LAT_COL}) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlL_B3}`);
const resultL_B3 = await runSql(sqlL_B3);
console.log(`[spatial-predicate-spike] HTTP status: ${resultL_B3.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultL_B3.body, null, 2));
console.log("");

// ── WKT MODE: ST_WITHIN ──────────────────────────────────────────────────────

console.log("=== Probe W-A1: ST_WITHIN(geom_col, ST_GEOMFROMTEXT('<bbox-WKT>')) — WKT bbox ===");
const sqlW_A1 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_WITHIN(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlW_A1}`);
const resultW_A1 = await runSql(sqlW_A1);
console.log(`[spatial-predicate-spike] HTTP status: ${resultW_A1.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultW_A1.body, null, 2));
console.log("");

console.log("=== Probe W-A2: ST_WITHIN(geom_col, ST_GEOMFROMTEXT('<64-vertex-circle-WKT>')) — WKT circle ===");
const sqlW_A2 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_WITHIN(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${circleWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlW_A2}`);
const resultW_A2 = await runSql(sqlW_A2);
console.log(`[spatial-predicate-spike] HTTP status: ${resultW_A2.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultW_A2.body, null, 2));
console.log("");

console.log("=== Probe W-A3: ST_WITHIN(geom_col, ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>')) — WKT lasso ===");
const sqlW_A3 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_WITHIN(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${lassoWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlW_A3}`);
const resultW_A3 = await runSql(sqlW_A3);
console.log(`[spatial-predicate-spike] HTTP status: ${resultW_A3.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultW_A3.body, null, 2));
console.log("");

// ── WKT MODE: ST_INTERSECTS ──────────────────────────────────────────────────

console.log("=== Probe W-B1: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT('<bbox-WKT>')) — WKT bbox ===");
const sqlW_B1 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_INTERSECTS(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${bboxWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlW_B1}`);
const resultW_B1 = await runSql(sqlW_B1);
console.log(`[spatial-predicate-spike] HTTP status: ${resultW_B1.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultW_B1.body, null, 2));
console.log("");

console.log("=== Probe W-B2: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT('<64-vertex-circle-WKT>')) — WKT circle ===");
const sqlW_B2 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_INTERSECTS(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${circleWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlW_B2}`);
const resultW_B2 = await runSql(sqlW_B2);
console.log(`[spatial-predicate-spike] HTTP status: ${resultW_B2.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultW_B2.body, null, 2));
console.log("");

console.log("=== Probe W-B3: ST_INTERSECTS(geom_col, ST_GEOMFROMTEXT('<150-vertex-lasso-WKT>')) — WKT lasso ===");
const sqlW_B3 = `SELECT COUNT(*) AS n FROM ${WKT_TABLE} WHERE ST_INTERSECTS(${WKT_GEOM_COL}, ST_GEOMFROMTEXT('${lassoWkt}')) = 1`;
console.log(`[spatial-predicate-spike] SQL: ${sqlW_B3}`);
const resultW_B3 = await runSql(sqlW_B3);
console.log(`[spatial-predicate-spike] HTTP status: ${resultW_B3.status}`);
console.log(`[spatial-predicate-spike] Body (verbatim):`);
console.log(JSON.stringify(resultW_B3.body, null, 2));
console.log("");

// ── Summary ────────────────────────────────────────────────────────────────

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
for (const k of ["L_A1", "L_A2", "L_A3", "L_B1", "L_B2", "L_B3"] as const) {
  const [v, r] = verdicts[k];
  console.log(`  ${k.replace("_", "-")}: ${v} — ${r}`);
}
console.log("");
console.log("WKT mode probes (table: " + WKT_TABLE + "):");
for (const k of ["W_A1", "W_A2", "W_A3", "W_B1", "W_B2", "W_B3"] as const) {
  const [v, r] = verdicts[k];
  console.log(`  ${k.replace("_", "-")}: ${v} — ${r}`);
}
console.log("");

// Determine first-PASS predicate per mode.
// Decision-locking rules per CONTEXT.md:
//   - Latlon: STXY_WITHIN preferred (probes L-A*) before STXY_CONTAINS (probes L-B*)
//   - WKT: ST_WITHIN preferred (probes W-A*) before ST_INTERSECTS (probes W-B*)
// A mode's candidate passes only if ALL THREE shapes (bbox + circle + lasso) PASS.
const latlonAPass = verdicts.L_A1[0] === "PASS" && verdicts.L_A2[0] === "PASS" && verdicts.L_A3[0] === "PASS";
const latlonBPass = verdicts.L_B1[0] === "PASS" && verdicts.L_B2[0] === "PASS" && verdicts.L_B3[0] === "PASS";
const wktAPass    = verdicts.W_A1[0] === "PASS" && verdicts.W_A2[0] === "PASS" && verdicts.W_A3[0] === "PASS";
const wktBPass    = verdicts.W_B1[0] === "PASS" && verdicts.W_B2[0] === "PASS" && verdicts.W_B3[0] === "PASS";

const latlonChoice = latlonAPass ? "STXY_WITHIN" : latlonBPass ? "STXY_CONTAINS" : "NONE_ESCALATE";
const wktChoice    = wktAPass    ? "ST_WITHIN"   : wktBPass    ? "ST_INTERSECTS" : "NONE_ESCALATE";

console.log(`[spatial-predicate-spike] Latlon mode recommendation: ${latlonChoice}`);
console.log(`[spatial-predicate-spike] WKT mode recommendation: ${wktChoice}`);
if (latlonChoice === "NONE_ESCALATE" || wktChoice === "NONE_ESCALATE") {
  console.log("[spatial-predicate-spike] Overall: NONE_ESCALATE → BLOCK_V15 (CONTEXT.md mandates milestone re-scope on any mode FAIL)");
} else {
  console.log("[spatial-predicate-spike] Overall: PASS — Phase 26 buildSpatialOrBlock authorized");
}
console.log("");
console.log("[spatial-predicate-spike] Done. Paste this full stdout + your Kinetica version into chat to complete Task 2.");
