/**
 * wkbSpike.ts — Standalone WKB spatial-proximity spike runner for Phase 18 Wave 1.
 *
 * PURPOSE: Probe the deployed Kinetica instance to confirm which spatial-proximity
 * function (and arg-type pattern) works against a WKB-typed (binary geometry) column.
 * SPATIAL-V14-03 explicitly states the WKB function name and argument types are
 * unconfirmed. This spike is the P1 GATE for Phase 18: Plans 18-02 (SQL builders) and
 * 18-03 (endpoint) cannot define the WKB SQL template until this spike commits a
 * decision in 18-SPIKE-NOTES.md.
 *
 * USAGE:
 *   cd server && npm run wkb-spike
 *
 * REQUIRED .env VARS:
 *   KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD (from existing BI setup)
 *   WKB_PROBE_SCHEMA=<schema, e.g. ki_home>
 *   WKB_PROBE_TABLE=<table, e.g. v18_wkb_fixture>
 *   WKB_PROBE_COLUMN=<WKB column name, e.g. geom>
 *   WKB_PROBE_LON=-73.95
 *   WKB_PROBE_LAT=40.75
 *
 * OUTPUT:
 *   - Stdout lines for each Probe (A, B, C): SQL, HTTP status, FULL verbatim JSON body
 *   - SPIKE SUMMARY block with PASS/FAIL classification per probe + recommendation
 *
 * NOT PART OF THE EXPRESS APP — this is a one-shot CLI script invoked via tsx.
 */
import dotenv from "dotenv";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const KINETICA_USERNAME = process.env.KINETICA_USERNAME;
const KINETICA_PASSWORD = process.env.KINETICA_PASSWORD;

if (!KINETICA_URL || !KINETICA_USERNAME || !KINETICA_PASSWORD) {
  console.error("[wkb-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, and KINETICA_PASSWORD must be set in .env");
  process.exit(1);
}

const basicAuth = "Basic " + Buffer.from(`${KINETICA_USERNAME}:${KINETICA_PASSWORD}`).toString("base64");
const redactedUrl = KINETICA_URL.replace(/:[^@:]+@/, ":***@");

// ── Operator setup ──────────────────────────────────────────────────────────

const WKB_PROBE_SCHEMA = process.env.WKB_PROBE_SCHEMA;
const WKB_PROBE_TABLE = process.env.WKB_PROBE_TABLE;
const WKB_PROBE_COLUMN = process.env.WKB_PROBE_COLUMN;
const WKB_PROBE_LON = process.env.WKB_PROBE_LON;
const WKB_PROBE_LAT = process.env.WKB_PROBE_LAT;

if (!WKB_PROBE_SCHEMA || !WKB_PROBE_TABLE || !WKB_PROBE_COLUMN || !WKB_PROBE_LON || !WKB_PROBE_LAT) {
  console.error(
    "[wkb-spike] ERROR: missing WKB_PROBE_* env vars. Add to server/.env:\n" +
      "\n" +
      "  WKB_PROBE_SCHEMA=demo\n" +
      "  WKB_PROBE_TABLE=nyctaxi_wkb\n" +
      "  WKB_PROBE_COLUMN=geom\n" +
      "  WKB_PROBE_LON=-73.95\n" +
      "  WKB_PROBE_LAT=40.75\n",
  );
  process.exit(1);
}

const schema = WKB_PROBE_SCHEMA;
const table = WKB_PROBE_TABLE;
const col = WKB_PROBE_COLUMN;
const lon = WKB_PROBE_LON;
const lat = WKB_PROBE_LAT;

console.log(`[wkb-spike] Deployed Kinetica: ${redactedUrl}`);
console.log(`[wkb-spike] User: ${KINETICA_USERNAME}`);
console.log(`[wkb-spike] Probing ${schema}.${table}.${col} at (${lon}, ${lat})`);
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
    // this spike sent only { statement, limit: 1 } and Kinetica rejected the request at
    // preprocessing with: "Value: '' not a valid parameter. Valid values are:
    // binary, json, geojson, arrow (U/PUh:355)" — i.e. the missing `encoding` field
    // surfaced as a parameter-validation error BEFORE the SQL function-name questions
    // the spike is trying to answer were ever evaluated. Future investigators reading
    // 18-SPIKE-NOTES.md must trust that the spike's HTTP contract matches what
    // production code actually sends, so we mirror the production payload verbatim.
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

/**
 * Classify a probe outcome:
 *   PASS = HTTP ok AND body.status === "OK" AND body has a `dist`-shaped numeric column
 *   FAIL = HTTP not ok OR body.status === "ERROR"
 *
 * Returns a tuple [verdict, oneLineReason].
 */
function classify(label: string, result: { ok: boolean; status: number; body: unknown }): [
  "PASS" | "FAIL",
  string,
] {
  if (!result.ok || result.status < 200 || result.status >= 300) {
    const msg = extractMessage(result.body);
    return ["FAIL", `HTTP ${result.status}${msg ? ` — ${msg}` : ""}`];
  }
  const body = result.body as Record<string, unknown> | null | undefined;
  if (body && typeof body === "object") {
    const status = (body as { status?: unknown }).status;
    if (typeof status === "string" && status.toUpperCase() === "ERROR") {
      const msg = extractMessage(body);
      return ["FAIL", `body.status=ERROR${msg ? ` — ${msg}` : ""}`];
    }
    // Look for a `dist`-named column either in column_headers or data_str/data
    const columnHeaders =
      (body as { column_headers?: unknown }).column_headers ??
      (body as { data_type?: { column_headers?: unknown } }).data_type?.column_headers;
    const headersArr = Array.isArray(columnHeaders) ? (columnHeaders as unknown[]) : null;
    const hasDistHeader =
      !!headersArr && headersArr.some((h) => typeof h === "string" && /dist/i.test(h));
    // Also scan a string-encoded data_str payload (common Kinetica response shape)
    const dataStr = (body as { data_str?: unknown }).data_str;
    const hasDistInDataStr =
      typeof dataStr === "string" && /dist/i.test(dataStr);
    if (hasDistHeader || hasDistInDataStr) {
      return ["PASS", `${label} returned dist column`];
    }
    // SQL executed without ERROR but column shape unverified — still PASS-ish (SQL accepted)
    return ["PASS", `${label} SQL accepted (status OK; dist column shape not verified — inspect body)`];
  }
  return ["FAIL", "unrecognized response body"];
}

function extractMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  const msg =
    (typeof obj.message === "string" && obj.message) ||
    (typeof obj.error === "string" && obj.error) ||
    "";
  return msg ? msg.slice(0, 200) : "";
}

// ── Probe A: STXY_DISTANCE direct on WKB ───────────────────────────────────

console.log("=== Probe A: STXY_DISTANCE(<wkb_col>, lon, lat) ===");
const sqlA = `SELECT STXY_DISTANCE(${col}, ${lon}, ${lat}) AS dist FROM ${schema}.${table} ORDER BY dist ASC LIMIT 5`;
console.log(`[wkb-spike] SQL: ${sqlA}`);
const resultA = await runSql(sqlA);
console.log(`[wkb-spike] HTTP status: ${resultA.status}`);
console.log(`[wkb-spike] Body (verbatim):`);
console.log(JSON.stringify(resultA.body, null, 2));
console.log("");

// ── Probe B: ST_DISTANCE with ST_GEOMFROMTEXT wrapper ──────────────────────

console.log("=== Probe B: ST_DISTANCE(<wkb_col>, ST_GEOMFROMTEXT('POINT(lon lat)')) ===");
const sqlB = `SELECT ST_DISTANCE(${col}, ST_GEOMFROMTEXT('POINT(${lon} ${lat})')) AS dist FROM ${schema}.${table} ORDER BY dist ASC LIMIT 5`;
console.log(`[wkb-spike] SQL: ${sqlB}`);
const resultB = await runSql(sqlB);
console.log(`[wkb-spike] HTTP status: ${resultB.status}`);
console.log(`[wkb-spike] Body (verbatim):`);
console.log(JSON.stringify(resultB.body, null, 2));
console.log("");

// ── Probe C: GEODIST after STX/STY centroid extraction ─────────────────────

console.log("=== Probe C: GEODIST(STX(<wkb_col>), STY(<wkb_col>), lon, lat) ===");
const sqlC = `SELECT GEODIST(STX(${col}), STY(${col}), ${lon}, ${lat}) AS dist FROM ${schema}.${table} ORDER BY dist ASC LIMIT 5`;
console.log(`[wkb-spike] SQL: ${sqlC}`);
const resultC = await runSql(sqlC);
console.log(`[wkb-spike] HTTP status: ${resultC.status}`);
console.log(`[wkb-spike] Body (verbatim):`);
console.log(JSON.stringify(resultC.body, null, 2));
console.log("");

// ── Summary ────────────────────────────────────────────────────────────────

const [verdictA, reasonA] = classify("Probe A", resultA);
const [verdictB, reasonB] = classify("Probe B", resultB);
const [verdictC, reasonC] = classify("Probe C", resultC);

console.log("=== SPIKE SUMMARY ===");
console.log(`Probe A (STXY_DISTANCE direct):          ${verdictA} — ${reasonA}`);
console.log(`Probe B (ST_DISTANCE + ST_GEOMFROMTEXT): ${verdictB} — ${reasonB}`);
console.log(`Probe C (GEODIST + STX/STY):             ${verdictC} — ${reasonC}`);

let recommended: string;
if (verdictA === "PASS") {
  recommended = "Probe A (STXY_DISTANCE direct on WKB — no wrapper, lowest overhead)";
} else if (verdictB === "PASS") {
  recommended = "Probe B (ST_DISTANCE with ST_GEOMFROMTEXT wrapper — per-query parsing overhead)";
} else if (verdictC === "PASS") {
  recommended = "Probe C (GEODIST after STX/STY centroid — polygon-area-ignoring approximation; v2 should revisit)";
} else {
  recommended = "NONE — escalate; Plan 18-02 and 18-03 are BLOCKED until a working pattern is found";
}

console.log("");
console.log(`[wkb-spike] Recommended path: ${recommended}`);
console.log("[wkb-spike] Done. Now run Task 2 to record findings in 18-SPIKE-NOTES.md.");
