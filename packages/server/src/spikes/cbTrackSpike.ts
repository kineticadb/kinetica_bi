/**
 * cbTrackSpike.ts — Standalone CB/Track WMS spike runner for Phase 37.
 *
 * PURPOSE: Probe the deployed Kinetica instance to lock the EXACT WMS parameter
 * surface for classbreak (CB_*) and track (TRACK_*) styling — eliminating:
 *   - CB_COLUMN_NAME vs CB_ATTR codebase-vs-docs discrepancy
 *   - 6-char RRGGBB vs 8-char AARRGGBB color-format ambiguity
 *   - DOTRACKS gating semantics under raster + cb_raster
 *   - CB_RASTER + comma-separated raster-param combo behavior
 *   - NTILE quantile SQL form for /api/quantile endpoint
 *
 * SPIKE-V17-01/02/03/04/05/06 P0 GATE: Phase 38 cannot start until every
 * probe lane has a Decision Record entry locking the working param-name set
 * per render mode. Strong evidence criterion: HTTP 200 AND visual tile diff
 * confirming differentiated output — NOT just HTTP 200.
 *
 * Payload-parity reference: commit d458408 (Phase 18 wkbSpike.ts runner-bug fix).
 * The runner MUST send the full 7-field /execute/sql body for NTILE probes —
 * Phase 18 lost a full round-trip by sending only { statement, limit: 1 }.
 * See runSql() comment below.
 *
 * USAGE:
 *   cd server && npm run cb-track-spike
 *
 * REQUIRED .env VARS (3 pre-existing from prior phases):
 *   KINETICA_URL              (e.g. http://kinetica.example.com:9191/gpudb-0)
 *   KINETICA_USERNAME         (operator's BI username — password mode)
 *   KINETICA_PASSWORD         (operator's BI password)
 *
 * REQUIRED .env VARS (6 CB fixture vars — mandatory):
 *   CB_NUMERIC_TABLE          (e.g. demo.nyctaxi — schema-qualified)
 *   CB_NUMERIC_COLUMN         (e.g. fare_amount — wide numeric spread 0-200)
 *   CB_CATEGORICAL_TABLE      (e.g. demo.nyctaxi — schema-qualified)
 *   CB_CATEGORICAL_COLUMN     (e.g. payment_type — low-cardinality TEXT)
 *   CB_X_COL                  (lon column on the CB tables — e.g. pickup_longitude; Kinetica
 *                              defaults to looking for column literally named "x" when X_ATTR
 *                              is missing, causing all probes to fail with HTTP 200 +
 *                              ServiceException 'No field with this name (Name:"x")')
 *   CB_Y_COL                  (lat column on the CB tables — e.g. pickup_latitude; same default-x/y
 *                              constraint as above)
 *
 * OPTIONAL .env VARS (5 track fixture vars — if absent, Track probes SKIP with DEFERRED):
 *   TRACK_TABLE               (operator-supplied; e.g. demo.tracks — NO baked-in default)
 *   TRACK_ID_COL              (e.g. TRACKID)
 *   TRACK_ORDER_COL           (e.g. TIMESTAMP)
 *   TRACK_X_COL               (track-table longitude column)
 *   TRACK_Y_COL               (track-table latitude column)
 *   TRACK_BBOX                (optional override BBOX for Track probes — needed when the track
 *                              fixture's data lives outside the locked Manhattan BBOX so every
 *                              probe returns the same blank tile. Defaults to BBOX if absent.
 *                              Format: "minLon,minLat,maxLon,maxLat" in EPSG:4326.)
 *
 * OUTPUT:
 *   - Stdout lines for each probe: params + HTTP status + content-type + bytes + body (if non-image)
 *   - PNG tile bytes saved to server/spike-output/37-*.png (gitignored)
 *   - SPIKE SUMMARY block with HTTP PASS/FAIL classification per probe
 *   - Operator confirms VISUAL tile diff vs raster baseline separately (Task 2 step 6)
 *
 * NOT PART OF THE EXPRESS APP — this is a one-shot CLI script invoked via tsx.
 */
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const KINETICA_USERNAME = process.env.KINETICA_USERNAME;
const KINETICA_PASSWORD = process.env.KINETICA_PASSWORD;

if (!KINETICA_URL || !KINETICA_USERNAME || !KINETICA_PASSWORD) {
  console.error("[cb-track-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, and KINETICA_PASSWORD must be set in .env");
  process.exit(1);
}

const basicAuth = "Basic " + Buffer.from(`${KINETICA_USERNAME}:${KINETICA_PASSWORD}`).toString("base64");
const redactedUrl = KINETICA_URL.replace(/:[^@:]+@/, ":***@");

// ── Operator setup — fixture env vars ───────────────────────────────────────

const CB_NUMERIC_TABLE = process.env.CB_NUMERIC_TABLE;
const CB_NUMERIC_COLUMN = process.env.CB_NUMERIC_COLUMN;
const CB_CATEGORICAL_TABLE = process.env.CB_CATEGORICAL_TABLE;
const CB_CATEGORICAL_COLUMN = process.env.CB_CATEGORICAL_COLUMN;
const CB_X_COL = process.env.CB_X_COL;
const CB_Y_COL = process.env.CB_Y_COL;

if (!CB_NUMERIC_TABLE || !CB_NUMERIC_COLUMN || !CB_CATEGORICAL_TABLE || !CB_CATEGORICAL_COLUMN || !CB_X_COL || !CB_Y_COL) {
  console.error(
    "[cb-track-spike] ERROR: missing CB fixture env vars. Add to server/.env:\n" +
      "\n" +
      "  CB_NUMERIC_TABLE=demo.nyctaxi\n" +
      "  CB_NUMERIC_COLUMN=fare_amount\n" +
      "  CB_CATEGORICAL_TABLE=demo.nyctaxi\n" +
      "  CB_CATEGORICAL_COLUMN=payment_type\n" +
      "  CB_X_COL=pickup_longitude    # lon column on demo.nyctaxi (Kinetica WMS requires X_ATTR; defaults to looking for column literally named 'x' if absent)\n" +
      "  CB_Y_COL=pickup_latitude     # lat column on demo.nyctaxi (same X_ATTR/Y_ATTR constraint)\n",
  );
  process.exit(1);
}

// Track fixture vars are OPTIONAL — if absent, Track probes skip with DEFERRED status
const TRACK_TABLE = process.env.TRACK_TABLE;
const TRACK_ID_COL = process.env.TRACK_ID_COL;
const TRACK_ORDER_COL = process.env.TRACK_ORDER_COL;
const TRACK_X_COL = process.env.TRACK_X_COL;
const TRACK_Y_COL = process.env.TRACK_Y_COL;
const TRACK_BBOX_ENV = process.env.TRACK_BBOX; // optional override; falls back to BBOX

const TRACK_PROBES_ENABLED = Boolean(TRACK_TABLE && TRACK_ID_COL && TRACK_ORDER_COL && TRACK_X_COL && TRACK_Y_COL);
if (!TRACK_PROBES_ENABLED) {
  console.log("[cb-track-spike] WARNING: TRACK_TABLE/TRACK_ID_COL/TRACK_ORDER_COL/TRACK_X_COL/TRACK_Y_COL not all set in .env — Track probes will SKIP with DEFERRED status per 37-CONTEXT.md fallback");
}

console.log(`[cb-track-spike] Deployed Kinetica: ${redactedUrl}`);
console.log(`[cb-track-spike] User: ${KINETICA_USERNAME}`);
console.log(`[cb-track-spike] CB numeric fixture: ${CB_NUMERIC_TABLE}.${CB_NUMERIC_COLUMN} (X_ATTR=${CB_X_COL}, Y_ATTR=${CB_Y_COL})`);
console.log(`[cb-track-spike] CB categorical fixture: ${CB_CATEGORICAL_TABLE}.${CB_CATEGORICAL_COLUMN} (X_ATTR=${CB_X_COL}, Y_ATTR=${CB_Y_COL})`);
console.log(`[cb-track-spike] Track fixture: ${TRACK_PROBES_ENABLED ? `${TRACK_TABLE}.${TRACK_ID_COL}/${TRACK_ORDER_COL}/${TRACK_X_COL}/${TRACK_Y_COL}` : "DEFERRED (no env vars)"}`);
console.log(`[cb-track-spike] BBOX (CB probes, Manhattan locked): -74.05,40.65,-73.85,40.85 EPSG:4326`);
console.log(`[cb-track-spike] BBOX (Track probes): ${TRACK_BBOX_ENV ?? "-74.05,40.65,-73.85,40.85 (defaulting to BBOX — set TRACK_BBOX in .env if track data lives outside Manhattan)"}`);
console.log("");

// ── Constants (CONTEXT.md-locked) ────────────────────────────────────────────

const BBOX = "-74.05,40.65,-73.85,40.85"; // EPSG:4326, Manhattan ±0.1°; matches Phase 25 anchor
const WIDTH = 512;
const HEIGHT = 512;
const FORMAT = "image/png";
const SRS = "EPSG:4326";
// src/spikes/cbTrackSpike.ts → up two levels to server/, then spike-output/.
const SPIKE_OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "spike-output");
mkdirSync(SPIKE_OUTPUT_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    // surfaced as a parameter-validation error BEFORE the SQL function the spike
    // is trying to probe was ever evaluated. Future investigators reading 37-SPIKE-NOTES.md
    // must trust that the spike's HTTP contract matches what production code actually sends,
    // so we mirror the production payload verbatim. Payload-parity reference: commit d458408.
    response = await rawFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statement: sql,
        offset: 0,
        limit: 1000,
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

async function getMap(
  params: Record<string, string>,
  outPath: string,
): Promise<{ ok: boolean; status: number; contentType: string; bytesLen: number; bodyText?: string }> {
  const url = `${KINETICA_URL}/wms?${new URLSearchParams(params).toString()}`;
  try {
    const response = await rawFetch(url);
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && contentType.includes("image")) {
      const buf = Buffer.from(await response.arrayBuffer());
      writeFileSync(outPath, buf);
      return { ok: true, status: response.status, contentType, bytesLen: buf.byteLength };
    }
    // Non-image response — capture body text for Kinetica error message
    const bodyText = await response.text();
    return { ok: false, status: response.status, contentType, bytesLen: 0, bodyText };
  } catch (e) {
    return { ok: false, status: -1, contentType: "", bytesLen: 0, bodyText: String(e) };
  }
}

// WMS GetMap base params (constant across all probes) — defaults to BBOX (Manhattan).
// X_ATTR/Y_ATTR are NOT included; callers MUST inject them via cbBaseParams/trackBaseParams.
function baseParams(layers: string, styles: string, bbox: string = BBOX): Record<string, string> {
  return {
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: layers,
    BBOX: bbox,
    WIDTH: String(WIDTH),
    HEIGHT: String(HEIGHT),
    FORMAT,
    SRS,
    STYLES: styles,
  };
}

// CB probe base params — wraps baseParams and injects X_ATTR/Y_ATTR from CB_X_COL/CB_Y_COL.
// Without these, Kinetica WMS defaults to looking for columns literally named "x"/"y" and every
// probe returns HTTP 200 + ServiceException "No field with this name". Phase 37 v1 lost a full
// operator round-trip to this exact bug — runner-v2 makes X_ATTR/Y_ATTR mandatory on CB probes.
function cbBaseParams(layers: string, styles: string): Record<string, string> {
  return {
    ...baseParams(layers, styles),
    X_ATTR: CB_X_COL!,
    Y_ATTR: CB_Y_COL!,
  };
}

// Track probe base params — uses TRACK_BBOX env var if set, else falls back to BBOX. Without the
// override, every Track probe returns the same blank tile when the track fixture's data lives
// outside Manhattan (operator observed identical 4722-byte responses across all 18 probes on v1).
function trackBaseParams(layers: string, styles: string): Record<string, string> {
  return baseParams(layers, styles, TRACK_BBOX_ENV ?? BBOX);
}

// classify() for WMS probes — PASS requires HTTP 200 AND content-type image/* AND bytesLen > 1000
// (real tiles are ≥1KB; Kinetica error tiles can be <500 bytes; visual-diff is the strong criterion
// and the operator confirms that separately in Task 2)
function classifyWms(
  result: { ok: boolean; status: number; contentType: string; bytesLen: number; bodyText?: string },
): ["PASS" | "FAIL", string] {
  if (!result.ok || result.status < 200 || result.status >= 300) {
    return ["FAIL", `HTTP ${result.status}${result.bodyText ? ` — ${result.bodyText.slice(0, 200)}` : ""}`];
  }
  if (!result.contentType.includes("image")) {
    return ["FAIL", `non-image content-type: ${result.contentType}${result.bodyText ? ` — ${result.bodyText.slice(0, 200)}` : ""}`];
  }
  if (result.bytesLen <= 1000) {
    return ["FAIL", `image response but suspiciously small (${result.bytesLen} bytes) — likely Kinetica error tile or blank tile`];
  }
  return ["PASS", `HTTP ${result.status}, ${result.bytesLen} bytes — operator visual-diff vs baseline required for strong PASS`];
}

// classify() for SQL probes (mirrors spatialPredicateSpike.ts pattern)
function classifySql(
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
  return ["PASS", `${label} HTTP ${result.status} OK — inspect body for row data`];
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

// ── Probe matrix ─────────────────────────────────────────────────────────────
// ALL probes execute unconditionally (no early-exit). CONTEXT.md mandates
// capturing ALL outputs so every lane has evidence in 37-SPIKE-NOTES.md
// regardless of PASS/FAIL. Decision Record summarises which naming + format
// worked per render mode per fixture.

// Collect results for SPIKE SUMMARY
type WmsVerdict = ["PASS" | "FAIL", string];
type SqlVerdict = ["PASS" | "FAIL", string];
const wmsVerdicts: Record<string, WmsVerdict> = {};
const sqlVerdicts: Record<string, SqlVerdict> = {};

// ── BASELINE PROBES ──────────────────────────────────────────────────────────
// Raster baseline tiles — visual-diff reference for CB-lane probes.
// Without these, operator cannot tell if a CB-lane tile "differs from raster"
// (i.e., is silently ignored and renders as raster). v1.2 Phase 11 lesson.

console.log(`=== Probe BASELINE-NUM: STYLES=raster baseline for ${CB_NUMERIC_TABLE} ===`);
console.log(`[cb-track-spike] params: SERVICE=WMS REQUEST=GetMap VERSION=1.1.1 LAYERS=${CB_NUMERIC_TABLE} BBOX=${BBOX} WIDTH=${WIDTH} HEIGHT=${HEIGHT} FORMAT=${FORMAT} SRS=${SRS} STYLES=raster POINTCOLORS=FF00CC11`);
const resultBaselineNum = await getMap(
  { ...cbBaseParams(CB_NUMERIC_TABLE, "raster"), POINTCOLORS: "FF00CC11" },
  resolve(SPIKE_OUTPUT_DIR, "37-baseline-num.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultBaselineNum.status}, content-type: ${resultBaselineNum.contentType}, bytes: ${resultBaselineNum.bytesLen}`);
if (resultBaselineNum.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultBaselineNum.bodyText.slice(0, 1000)}`);
wmsVerdicts["BASELINE-NUM"] = classifyWms(resultBaselineNum);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["BASELINE-NUM"][0]} — ${wmsVerdicts["BASELINE-NUM"][1]}`);
console.log("");

console.log(`=== Probe BASELINE-CAT: STYLES=raster baseline for ${CB_CATEGORICAL_TABLE} ===`);
console.log(`[cb-track-spike] params: SERVICE=WMS REQUEST=GetMap VERSION=1.1.1 LAYERS=${CB_CATEGORICAL_TABLE} BBOX=${BBOX} WIDTH=${WIDTH} HEIGHT=${HEIGHT} FORMAT=${FORMAT} SRS=${SRS} STYLES=raster POINTCOLORS=FF00CC11`);
const resultBaselineCat = await getMap(
  { ...cbBaseParams(CB_CATEGORICAL_TABLE, "raster"), POINTCOLORS: "FF00CC11" },
  resolve(SPIKE_OUTPUT_DIR, "37-baseline-cat.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultBaselineCat.status}, content-type: ${resultBaselineCat.contentType}, bytes: ${resultBaselineCat.bytesLen}`);
if (resultBaselineCat.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultBaselineCat.bodyText.slice(0, 1000)}`);
wmsVerdicts["BASELINE-CAT"] = classifyWms(resultBaselineCat);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["BASELINE-CAT"][0]} — ${wmsVerdicts["BASELINE-CAT"][1]}`);
console.log("");

// ── LANE A PROBES — STYLES=classbreak, codebase-current naming ───────────────
// CB_COLUMN_NAME / CB_BREAK_TYPE / CB_BREAK_POINT_N / CB_POINTCOLOR_N
// Probes what wmsUrlBuilder.ts:325-340 emits today.

console.log(`=== Probe A-NUM-8: Lane A numeric, STYLES=classbreak, 8-char AARRGGBB colors ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_COLUMN_NAME=${CB_NUMERIC_COLUMN} CB_BREAK_TYPE=NUMERICAL CB_BREAK_POINT_1=10 CB_POINTCOLOR_1=FF112233 CB_BREAK_POINT_2=25 CB_POINTCOLOR_2=FF445566 CB_BREAK_POINT_3=50 CB_POINTCOLOR_3=FF7788AA CB_BREAK_POINT_4=100 CB_POINTCOLOR_4=FFCC1100 CB_BREAK_POINT_5=200 CB_POINTCOLOR_5=FF00CC11`);
const resultANum8 = await getMap(
  {
    ...cbBaseParams(CB_NUMERIC_TABLE, "classbreak"),
    CB_COLUMN_NAME: CB_NUMERIC_COLUMN,
    CB_BREAK_TYPE: "NUMERICAL",
    CB_BREAK_POINT_1: "10",  CB_POINTCOLOR_1: "FF112233",
    CB_BREAK_POINT_2: "25",  CB_POINTCOLOR_2: "FF445566",
    CB_BREAK_POINT_3: "50",  CB_POINTCOLOR_3: "FF7788AA",
    CB_BREAK_POINT_4: "100", CB_POINTCOLOR_4: "FFCC1100",
    CB_BREAK_POINT_5: "200", CB_POINTCOLOR_5: "FF00CC11",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-A-num-8.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultANum8.status}, content-type: ${resultANum8.contentType}, bytes: ${resultANum8.bytesLen}`);
if (resultANum8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultANum8.bodyText.slice(0, 1000)}`);
wmsVerdicts["A-NUM-8"] = classifyWms(resultANum8);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["A-NUM-8"][0]} — ${wmsVerdicts["A-NUM-8"][1]}`);
console.log("");

console.log(`=== Probe A-NUM-6: Lane A numeric, STYLES=classbreak, 6-char RRGGBB colors (current wmsUrlBuilder.ts:337 bug shape) ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_COLUMN_NAME=${CB_NUMERIC_COLUMN} CB_BREAK_TYPE=NUMERICAL CB_BREAK_POINT_1=10 CB_POINTCOLOR_1=112233 CB_BREAK_POINT_2=25 CB_POINTCOLOR_2=445566 CB_BREAK_POINT_3=50 CB_POINTCOLOR_3=7788AA CB_BREAK_POINT_4=100 CB_POINTCOLOR_4=CC1100 CB_BREAK_POINT_5=200 CB_POINTCOLOR_5=00CC11`);
const resultANum6 = await getMap(
  {
    ...cbBaseParams(CB_NUMERIC_TABLE, "classbreak"),
    CB_COLUMN_NAME: CB_NUMERIC_COLUMN,
    CB_BREAK_TYPE: "NUMERICAL",
    CB_BREAK_POINT_1: "10",  CB_POINTCOLOR_1: "112233",
    CB_BREAK_POINT_2: "25",  CB_POINTCOLOR_2: "445566",
    CB_BREAK_POINT_3: "50",  CB_POINTCOLOR_3: "7788AA",
    CB_BREAK_POINT_4: "100", CB_POINTCOLOR_4: "CC1100",
    CB_BREAK_POINT_5: "200", CB_POINTCOLOR_5: "00CC11",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-A-num-6.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultANum6.status}, content-type: ${resultANum6.contentType}, bytes: ${resultANum6.bytesLen}`);
if (resultANum6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultANum6.bodyText.slice(0, 1000)}`);
wmsVerdicts["A-NUM-6"] = classifyWms(resultANum6);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["A-NUM-6"][0]} — ${wmsVerdicts["A-NUM-6"][1]}`);
console.log("");

console.log(`=== Probe A-CAT-8: Lane A categorical, STYLES=classbreak, 8-char colors, <other> sink-bucket ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_COLUMN_NAME=${CB_CATEGORICAL_COLUMN} CB_BREAK_TYPE=CATEGORICAL CB_BREAK_POINT_1=cash CB_POINTCOLOR_1=FF112233 CB_BREAK_POINT_2=credit CB_POINTCOLOR_2=FF445566 CB_BREAK_POINT_3=<other> CB_POINTCOLOR_3=FF7788AA`);
const resultACat8 = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_COLUMN_NAME: CB_CATEGORICAL_COLUMN,
    CB_BREAK_TYPE: "CATEGORICAL",
    CB_BREAK_POINT_1: "cash",    CB_POINTCOLOR_1: "FF112233",
    CB_BREAK_POINT_2: "credit",  CB_POINTCOLOR_2: "FF445566",
    CB_BREAK_POINT_3: "<other>", CB_POINTCOLOR_3: "FF7788AA",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-A-cat-8.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultACat8.status}, content-type: ${resultACat8.contentType}, bytes: ${resultACat8.bytesLen}`);
if (resultACat8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultACat8.bodyText.slice(0, 1000)}`);
wmsVerdicts["A-CAT-8"] = classifyWms(resultACat8);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["A-CAT-8"][0]} — ${wmsVerdicts["A-CAT-8"][1]}`);
console.log("");

console.log(`=== Probe A-CAT-6: Lane A categorical, STYLES=classbreak, 6-char colors ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_COLUMN_NAME=${CB_CATEGORICAL_COLUMN} CB_BREAK_TYPE=CATEGORICAL CB_BREAK_POINT_1=cash CB_POINTCOLOR_1=112233 CB_BREAK_POINT_2=credit CB_POINTCOLOR_2=445566 CB_BREAK_POINT_3=<other> CB_POINTCOLOR_3=7788AA`);
const resultACat6 = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_COLUMN_NAME: CB_CATEGORICAL_COLUMN,
    CB_BREAK_TYPE: "CATEGORICAL",
    CB_BREAK_POINT_1: "cash",    CB_POINTCOLOR_1: "112233",
    CB_BREAK_POINT_2: "credit",  CB_POINTCOLOR_2: "445566",
    CB_BREAK_POINT_3: "<other>", CB_POINTCOLOR_3: "7788AA",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-A-cat-6.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultACat6.status}, content-type: ${resultACat6.contentType}, bytes: ${resultACat6.bytesLen}`);
if (resultACat6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultACat6.bodyText.slice(0, 1000)}`);
wmsVerdicts["A-CAT-6"] = classifyWms(resultACat6);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["A-CAT-6"][0]} — ${wmsVerdicts["A-CAT-6"][1]}`);
console.log("");

// ── LANE B PROBES — STYLES=classbreak, Kinetica 7.1 docs naming ──────────────
// CB_ATTR / CB_VALS / CB_POINTCOLORS

console.log(`=== Probe B-NUM-8: Lane B numeric, STYLES=classbreak, 8-char AARRGGBB colors ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_NUMERIC_COLUMN} CB_VALS=10,25,50,100,200 CB_POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11`);
const resultBNum8 = await getMap(
  {
    ...cbBaseParams(CB_NUMERIC_TABLE, "classbreak"),
    CB_ATTR: CB_NUMERIC_COLUMN,
    CB_VALS: "10,25,50,100,200",
    CB_POINTCOLORS: "FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-B-num-8.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultBNum8.status}, content-type: ${resultBNum8.contentType}, bytes: ${resultBNum8.bytesLen}`);
if (resultBNum8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultBNum8.bodyText.slice(0, 1000)}`);
wmsVerdicts["B-NUM-8"] = classifyWms(resultBNum8);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["B-NUM-8"][0]} — ${wmsVerdicts["B-NUM-8"][1]}`);
console.log("");

console.log(`=== Probe B-NUM-6: Lane B numeric, STYLES=classbreak, 6-char RRGGBB colors ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_NUMERIC_COLUMN} CB_VALS=10,25,50,100,200 CB_POINTCOLORS=112233,445566,7788AA,CC1100,00CC11`);
const resultBNum6 = await getMap(
  {
    ...cbBaseParams(CB_NUMERIC_TABLE, "classbreak"),
    CB_ATTR: CB_NUMERIC_COLUMN,
    CB_VALS: "10,25,50,100,200",
    CB_POINTCOLORS: "112233,445566,7788AA,CC1100,00CC11",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-B-num-6.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultBNum6.status}, content-type: ${resultBNum6.contentType}, bytes: ${resultBNum6.bytesLen}`);
if (resultBNum6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultBNum6.bodyText.slice(0, 1000)}`);
wmsVerdicts["B-NUM-6"] = classifyWms(resultBNum6);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["B-NUM-6"][0]} — ${wmsVerdicts["B-NUM-6"][1]}`);
console.log("");

console.log(`=== Probe B-CAT-8: Lane B categorical, STYLES=classbreak, 8-char colors, <other> keyword ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=cash,credit,<other> CB_POINTCOLORS=FF112233,FF445566,FF7788AA`);
const resultBCat8 = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: "cash,credit,<other>",
    CB_POINTCOLORS: "FF112233,FF445566,FF7788AA",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-B-cat-8.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultBCat8.status}, content-type: ${resultBCat8.contentType}, bytes: ${resultBCat8.bytesLen}`);
if (resultBCat8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultBCat8.bodyText.slice(0, 1000)}`);
wmsVerdicts["B-CAT-8"] = classifyWms(resultBCat8);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["B-CAT-8"][0]} — ${wmsVerdicts["B-CAT-8"][1]}`);
console.log("");

console.log(`=== Probe B-CAT-6: Lane B categorical, STYLES=classbreak, 6-char colors ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=cash,credit,<other> CB_POINTCOLORS=112233,445566,7788AA`);
const resultBCat6 = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: "cash,credit,<other>",
    CB_POINTCOLORS: "112233,445566,7788AA",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-B-cat-6.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultBCat6.status}, content-type: ${resultBCat6.contentType}, bytes: ${resultBCat6.bytesLen}`);
if (resultBCat6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultBCat6.bodyText.slice(0, 1000)}`);
wmsVerdicts["B-CAT-6"] = classifyWms(resultBCat6);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["B-CAT-6"][0]} — ${wmsVerdicts["B-CAT-6"][1]}`);
console.log("");

// ── LANE C PROBES — STYLES=cb_raster, raster-style comma-separated params ────
// Operator's high-confidence domain note: "most of the raster options even
// POINTCOLORS, POINTSIZES, etc can be used for class breaks. You need to
// comma separate the values like this POINTSIZES=4,5,2"
// Lane C is the highest-confidence path per 37-CONTEXT.md.

console.log(`=== Probe C-NUM-8: Lane C numeric, STYLES=cb_raster, 8-char colors, comma-separated POINTCOLORS/POINTSIZES/POINTSHAPES ===`);
console.log(`[cb-track-spike] params: STYLES=cb_raster CB_ATTR=${CB_NUMERIC_COLUMN} CB_VALS=10,25,50,100,200 POINTCOLORS=FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11 POINTSIZES=4,5,6,7,8 POINTSHAPES=circle,circle,circle,circle,circle`);
const resultCNum8 = await getMap(
  {
    ...cbBaseParams(CB_NUMERIC_TABLE, "cb_raster"),
    CB_ATTR: CB_NUMERIC_COLUMN,
    CB_VALS: "10,25,50,100,200",
    POINTCOLORS: "FF112233,FF445566,FF7788AA,FFCC1100,FF00CC11",
    POINTSIZES: "4,5,6,7,8",
    POINTSHAPES: "circle,circle,circle,circle,circle",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-C-num-8.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultCNum8.status}, content-type: ${resultCNum8.contentType}, bytes: ${resultCNum8.bytesLen}`);
if (resultCNum8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultCNum8.bodyText.slice(0, 1000)}`);
wmsVerdicts["C-NUM-8"] = classifyWms(resultCNum8);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["C-NUM-8"][0]} — ${wmsVerdicts["C-NUM-8"][1]}`);
console.log("");

console.log(`=== Probe C-NUM-6: Lane C numeric, STYLES=cb_raster, 6-char RRGGBB colors ===`);
console.log(`[cb-track-spike] params: STYLES=cb_raster CB_ATTR=${CB_NUMERIC_COLUMN} CB_VALS=10,25,50,100,200 POINTCOLORS=112233,445566,7788AA,CC1100,00CC11 POINTSIZES=4,5,6,7,8 POINTSHAPES=circle,circle,circle,circle,circle`);
const resultCNum6 = await getMap(
  {
    ...cbBaseParams(CB_NUMERIC_TABLE, "cb_raster"),
    CB_ATTR: CB_NUMERIC_COLUMN,
    CB_VALS: "10,25,50,100,200",
    POINTCOLORS: "112233,445566,7788AA,CC1100,00CC11",
    POINTSIZES: "4,5,6,7,8",
    POINTSHAPES: "circle,circle,circle,circle,circle",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-C-num-6.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultCNum6.status}, content-type: ${resultCNum6.contentType}, bytes: ${resultCNum6.bytesLen}`);
if (resultCNum6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultCNum6.bodyText.slice(0, 1000)}`);
wmsVerdicts["C-NUM-6"] = classifyWms(resultCNum6);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["C-NUM-6"][0]} — ${wmsVerdicts["C-NUM-6"][1]}`);
console.log("");

console.log(`=== Probe C-CAT-8: Lane C categorical, STYLES=cb_raster, 8-char colors, <other> keyword ===`);
console.log(`[cb-track-spike] params: STYLES=cb_raster CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=cash,credit,<other> POINTCOLORS=FF112233,FF445566,FF7788AA POINTSIZES=4,5,6`);
const resultCCat8 = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "cb_raster"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: "cash,credit,<other>",
    POINTCOLORS: "FF112233,FF445566,FF7788AA",
    POINTSIZES: "4,5,6",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-C-cat-8.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultCCat8.status}, content-type: ${resultCCat8.contentType}, bytes: ${resultCCat8.bytesLen}`);
if (resultCCat8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultCCat8.bodyText.slice(0, 1000)}`);
wmsVerdicts["C-CAT-8"] = classifyWms(resultCCat8);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["C-CAT-8"][0]} — ${wmsVerdicts["C-CAT-8"][1]}`);
console.log("");

console.log(`=== Probe C-CAT-6: Lane C categorical, STYLES=cb_raster, 6-char colors ===`);
console.log(`[cb-track-spike] params: STYLES=cb_raster CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=cash,credit,<other> POINTCOLORS=112233,445566,7788AA POINTSIZES=4,5,6`);
const resultCCat6 = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "cb_raster"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: "cash,credit,<other>",
    POINTCOLORS: "112233,445566,7788AA",
    POINTSIZES: "4,5,6",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-C-cat-6.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultCCat6.status}, content-type: ${resultCCat6.contentType}, bytes: ${resultCCat6.bytesLen}`);
if (resultCCat6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultCCat6.bodyText.slice(0, 1000)}`);
wmsVerdicts["C-CAT-6"] = classifyWms(resultCCat6);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["C-CAT-6"][0]} — ${wmsVerdicts["C-CAT-6"][1]}`);
console.log("");

// ── CATEGORICAL EDGE-CASE PROBES ─────────────────────────────────────────────
// All four edge cases probed in a single operator session — no re-run needed.

// Edge-2: comma-escape in CB_VALS — probe both quoted and backslash-escaped forms
// May be N/A if payment_type has no comma-containing values — runner attempts both
// and captures verbatim Kinetica response so format ambiguity is documented.

console.log(`=== Probe EDGE-2-QUOTED: comma-escape, quoted variant, Lane B — CB_VALS="foo,bar",baz ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS="foo,bar",baz CB_POINTCOLORS=FF112233,FF445566`);
const resultEdge2Quoted = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: '"foo,bar",baz',
    CB_POINTCOLORS: "FF112233,FF445566",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-edge-2-quoted.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultEdge2Quoted.status}, content-type: ${resultEdge2Quoted.contentType}, bytes: ${resultEdge2Quoted.bytesLen}`);
if (resultEdge2Quoted.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultEdge2Quoted.bodyText.slice(0, 1000)}`);
wmsVerdicts["EDGE-2-QUOTED"] = classifyWms(resultEdge2Quoted);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["EDGE-2-QUOTED"][0]} — ${wmsVerdicts["EDGE-2-QUOTED"][1]}`);
console.log("");

console.log(`=== Probe EDGE-2-BACKSLASH: comma-escape, backslash variant, Lane B — CB_VALS=foo\\,bar,baz ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=foo\\,bar,baz CB_POINTCOLORS=FF112233,FF445566`);
const resultEdge2Backslash = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: "foo\\,bar,baz",
    CB_POINTCOLORS: "FF112233,FF445566",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-edge-2-backslash.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultEdge2Backslash.status}, content-type: ${resultEdge2Backslash.contentType}, bytes: ${resultEdge2Backslash.bytesLen}`);
if (resultEdge2Backslash.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultEdge2Backslash.bodyText.slice(0, 1000)}`);
wmsVerdicts["EDGE-2-BACKSLASH"] = classifyWms(resultEdge2Backslash);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["EDGE-2-BACKSLASH"][0]} — ${wmsVerdicts["EDGE-2-BACKSLASH"][1]}`);
console.log("");

// Edge-3: NULL bucket — issue CB_VALS without <other> to observe how NULLs route
// Three possible outcomes: NULLs map to <other> / NULLs are excluded / NULLs render as own bucket
console.log(`=== Probe EDGE-3-NULL: NULL bucket behavior, Lane B — CB_VALS without <other> sink ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=cash,credit CB_POINTCOLORS=FF112233,FF445566 (NOTE: no <other> — observe where NULLs land)`);
const resultEdge3Null = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: "cash,credit",
    CB_POINTCOLORS: "FF112233,FF445566",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-edge-3-null.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultEdge3Null.status}, content-type: ${resultEdge3Null.contentType}, bytes: ${resultEdge3Null.bytesLen}`);
if (resultEdge3Null.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultEdge3Null.bodyText.slice(0, 1000)}`);
wmsVerdicts["EDGE-3-NULL"] = classifyWms(resultEdge3Null);
console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["EDGE-3-NULL"][0]} — ${wmsVerdicts["EDGE-3-NULL"][1]}`);
console.log("[cb-track-spike] NOTE: Operator must visually compare this tile against B-CAT-8 (which HAS <other>) to determine NULL routing behavior");
console.log("");

// Edge-4: Mixed numeric:range/categorical — force-bad, expect HTTP 400 with explanatory message
// NOT silent garbage tiles (HTTP 200 with wrong rendering)
console.log(`=== Probe EDGE-4-MIXED: mixed numeric:range/categorical (force-bad), Lane B — expect HTTP 400 with explanatory error ===`);
console.log(`[cb-track-spike] params: STYLES=classbreak CB_ATTR=${CB_CATEGORICAL_COLUMN} CB_VALS=1:5,10:20,"high" CB_POINTCOLORS=FF112233,FF445566,FF7788AA`);
const resultEdge4Mixed = await getMap(
  {
    ...cbBaseParams(CB_CATEGORICAL_TABLE, "classbreak"),
    CB_ATTR: CB_CATEGORICAL_COLUMN,
    CB_VALS: '1:5,10:20,"high"',
    CB_POINTCOLORS: "FF112233,FF445566,FF7788AA",
  },
  resolve(SPIKE_OUTPUT_DIR, "37-edge-4-mixed.png"),
);
console.log(`[cb-track-spike] HTTP status: ${resultEdge4Mixed.status}, content-type: ${resultEdge4Mixed.contentType}, bytes: ${resultEdge4Mixed.bytesLen}`);
if (resultEdge4Mixed.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultEdge4Mixed.bodyText.slice(0, 2000)}`);
wmsVerdicts["EDGE-4-MIXED"] = classifyWms(resultEdge4Mixed);
// For EDGE-4, HTTP 400 with explanatory body IS the success criterion — FAIL on HTTP 200 (silent garbage)
console.log(`[cb-track-spike] Raw verdict (use to confirm Kinetica errors cleanly vs silent garbage): ${wmsVerdicts["EDGE-4-MIXED"][0]} — ${wmsVerdicts["EDGE-4-MIXED"][1]}`);
console.log("");

// ── NTILE QUANTILE SQL PROBES ─────────────────────────────────────────────────
// These go through runSql (NOT getMap). Production-payload-parity 7-field body MANDATORY.
// Decision Record locks the working form for Phase 38 /api/quantile endpoint.

console.log(`=== Probe NTILE-A: PARTITION BY 0 form (STACK-recommended) ===`);
const sqlNtileA = `SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY ${CB_NUMERIC_COLUMN}) AS bucket, ${CB_NUMERIC_COLUMN} FROM ${CB_NUMERIC_TABLE} LIMIT 1000`;
console.log(`[cb-track-spike] SQL: ${sqlNtileA}`);
const resultNtileA = await runSql(sqlNtileA);
console.log(`[cb-track-spike] HTTP status: ${resultNtileA.status}`);
console.log(`[cb-track-spike] Body (verbatim):`);
console.log(JSON.stringify(resultNtileA.body, null, 2));
sqlVerdicts["NTILE-A"] = classifySql("Probe NTILE-A", resultNtileA);
console.log(`[cb-track-spike] Verdict: ${sqlVerdicts["NTILE-A"][0]} — ${sqlVerdicts["NTILE-A"][1]}`);
console.log("");

console.log(`=== Probe NTILE-B: bare ORDER BY (fallback if NTILE-A fails) ===`);
const sqlNtileB = `SELECT NTILE(5) OVER (ORDER BY ${CB_NUMERIC_COLUMN}) AS bucket, ${CB_NUMERIC_COLUMN} FROM ${CB_NUMERIC_TABLE} LIMIT 1000`;
console.log(`[cb-track-spike] SQL: ${sqlNtileB}`);
const resultNtileB = await runSql(sqlNtileB);
console.log(`[cb-track-spike] HTTP status: ${resultNtileB.status}`);
console.log(`[cb-track-spike] Body (verbatim):`);
console.log(JSON.stringify(resultNtileB.body, null, 2));
sqlVerdicts["NTILE-B"] = classifySql("Probe NTILE-B", resultNtileB);
console.log(`[cb-track-spike] Verdict: ${sqlVerdicts["NTILE-B"][0]} — ${sqlVerdicts["NTILE-B"][1]}`);
console.log("");

console.log(`=== Probe NTILE-C: bucket-boundaries wrapper (validate Phase 38 /api/quantile design) ===`);
const sqlNtileC = `SELECT bucket, MIN(${CB_NUMERIC_COLUMN}) AS boundary FROM (SELECT NTILE(5) OVER (PARTITION BY 0 ORDER BY ${CB_NUMERIC_COLUMN}) AS bucket, ${CB_NUMERIC_COLUMN} FROM ${CB_NUMERIC_TABLE}) GROUP BY bucket ORDER BY bucket`;
console.log(`[cb-track-spike] SQL: ${sqlNtileC}`);
const resultNtileC = await runSql(sqlNtileC);
console.log(`[cb-track-spike] HTTP status: ${resultNtileC.status}`);
console.log(`[cb-track-spike] Body (verbatim):`);
console.log(JSON.stringify(resultNtileC.body, null, 2));
sqlVerdicts["NTILE-C"] = classifySql("Probe NTILE-C", resultNtileC);
console.log(`[cb-track-spike] Verdict: ${sqlVerdicts["NTILE-C"][0]} — ${sqlVerdicts["NTILE-C"][1]}`);
console.log("");

// ── TRACK_* MATRIX PROBES ─────────────────────────────────────────────────────
// 18-cell matrix: 9 params × 2 render modes (raster + cb_raster)
// Cumulative probing under STYLES=raster — each probe adds to the prior probe's
// params so operator can see incremental effect on the tile.
// Skipped entirely if TRACK_PROBES_ENABLED === false (see DEFERRED row in summary).

if (TRACK_PROBES_ENABLED) {
  // Defensive: TypeScript narrowing — we know these are defined here
  const TRACK_TABLE_VAL = TRACK_TABLE!;
  const TRACK_ID_COL_VAL = TRACK_ID_COL!;
  const TRACK_ORDER_COL_VAL = TRACK_ORDER_COL!;
  const TRACK_X_COL_VAL = TRACK_X_COL!;
  const TRACK_Y_COL_VAL = TRACK_Y_COL!;

  // ── Under STYLES=raster (DOTRACKS gating) ──────────────────────────────────
  // Cumulative: each probe adds to prior probe's params

  console.log(`=== Probe T-R-1: STYLES=raster + DOTRACKS=TRUE smoke test (does gating param enable tracks?) ===`);
  const tR1Params = {
    ...trackBaseParams(TRACK_TABLE_VAL, "raster"),
    DOTRACKS: "TRUE",
    X_ATTR: TRACK_X_COL_VAL,
    Y_ATTR: TRACK_Y_COL_VAL,
  };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR1Params)}`);
  const resultTR1 = await getMap(tR1Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-1.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR1.status}, content-type: ${resultTR1.contentType}, bytes: ${resultTR1.bytesLen}`);
  if (resultTR1.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR1.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-1"] = classifyWms(resultTR1);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-1"][0]} — ${wmsVerdicts["T-R-1"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-2: STYLES=raster + DOTRACKS=TRUE + TRACK_ID_ATTR ===`);
  const tR2Params = { ...tR1Params, TRACK_ID_ATTR: TRACK_ID_COL_VAL };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR2Params)}`);
  const resultTR2 = await getMap(tR2Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-2.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR2.status}, content-type: ${resultTR2.contentType}, bytes: ${resultTR2.bytesLen}`);
  if (resultTR2.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR2.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-2"] = classifyWms(resultTR2);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-2"][0]} — ${wmsVerdicts["T-R-2"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-3: STYLES=raster + DOTRACKS=TRUE + TRACK_ID_ATTR + TRACK_ORDER_ATTR ===`);
  const tR3Params = { ...tR2Params, TRACK_ORDER_ATTR: TRACK_ORDER_COL_VAL };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR3Params)}`);
  const resultTR3 = await getMap(tR3Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-3.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR3.status}, content-type: ${resultTR3.contentType}, bytes: ${resultTR3.bytesLen}`);
  if (resultTR3.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR3.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-3"] = classifyWms(resultTR3);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-3"][0]} — ${wmsVerdicts["T-R-3"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-4: + TRACKHEADCOLORS=FFFF0000 (single value under raster) ===`);
  const tR4Params = { ...tR3Params, TRACKHEADCOLORS: "FFFF0000" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR4Params)}`);
  const resultTR4 = await getMap(tR4Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-4.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR4.status}, content-type: ${resultTR4.contentType}, bytes: ${resultTR4.bytesLen}`);
  if (resultTR4.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR4.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-4"] = classifyWms(resultTR4);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-4"][0]} — ${wmsVerdicts["T-R-4"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-5: + TRACKLINECOLORS=FF0000FF (single value under raster) ===`);
  const tR5Params = { ...tR4Params, TRACKLINECOLORS: "FF0000FF" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR5Params)}`);
  const resultTR5 = await getMap(tR5Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-5.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR5.status}, content-type: ${resultTR5.contentType}, bytes: ${resultTR5.bytesLen}`);
  if (resultTR5.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR5.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-5"] = classifyWms(resultTR5);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-5"][0]} — ${wmsVerdicts["T-R-5"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-6: + TRACKHEADSIZES=8 (single value under raster) ===`);
  const tR6Params = { ...tR5Params, TRACKHEADSIZES: "8" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR6Params)}`);
  const resultTR6 = await getMap(tR6Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-6.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR6.status}, content-type: ${resultTR6.contentType}, bytes: ${resultTR6.bytesLen}`);
  if (resultTR6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR6.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-6"] = classifyWms(resultTR6);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-6"][0]} — ${wmsVerdicts["T-R-6"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-7: + TRACKLINEWIDTHS=2 (single value under raster) ===`);
  const tR7Params = { ...tR6Params, TRACKLINEWIDTHS: "2" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR7Params)}`);
  const resultTR7 = await getMap(tR7Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-7.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR7.status}, content-type: ${resultTR7.contentType}, bytes: ${resultTR7.bytesLen}`);
  if (resultTR7.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR7.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-7"] = classifyWms(resultTR7);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-7"][0]} — ${wmsVerdicts["T-R-7"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-8: + TRACKMARKERSHAPES=circle (probe TRACKMARKERSHAPES naming) ===`);
  const tR8Params = { ...tR7Params, TRACKMARKERSHAPES: "circle" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR8Params)}`);
  const resultTR8 = await getMap(tR8Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-8.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR8.status}, content-type: ${resultTR8.contentType}, bytes: ${resultTR8.bytesLen}`);
  if (resultTR8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR8.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-8"] = classifyWms(resultTR8);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-8"][0]} — ${wmsVerdicts["T-R-8"][1]}`);
  console.log("");

  console.log(`=== Probe T-R-9: TRACKHEADSHAPES=circle (alternate naming — probe both T-R-8 and T-R-9 to lock which Kinetica accepts) ===`);
  // T-R-9 replaces TRACKMARKERSHAPES with TRACKHEADSHAPES to determine which naming Kinetica actually accepts
  const tR9Params: Record<string, string> = { ...tR7Params, TRACKHEADSHAPES: "circle" };
  delete tR9Params["TRACKMARKERSHAPES"]; // remove the alternate to isolate TRACKHEADSHAPES
  console.log(`[cb-track-spike] params: ${JSON.stringify(tR9Params)}`);
  const resultTR9 = await getMap(tR9Params, resolve(SPIKE_OUTPUT_DIR, "37-T-R-9.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTR9.status}, content-type: ${resultTR9.contentType}, bytes: ${resultTR9.bytesLen}`);
  if (resultTR9.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTR9.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-R-9"] = classifyWms(resultTR9);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-R-9"][0]} — ${wmsVerdicts["T-R-9"][1]}`);
  console.log("[cb-track-spike] NOTE: Compare T-R-8 vs T-R-9 tile bytes to determine which TRACK shape param name Kinetica accepts");
  console.log("");

  // ── Under STYLES=cb_raster (comma-sep raster params + tracks) ───────────────
  // Probe if DOTRACKS even applies under cb_raster (operator's domain note: "cb_raster implies tracks via the style itself")
  // Lane C (highest-confidence) as base for CB params.

  console.log(`=== Probe T-CB-1: STYLES=cb_raster + DOTRACKS=TRUE smoke test (does DOTRACKS apply under cb_raster?) ===`);
  const tCB1Params = {
    ...trackBaseParams(TRACK_TABLE_VAL, "cb_raster"),
    DOTRACKS: "TRUE",
    X_ATTR: TRACK_X_COL_VAL,
    Y_ATTR: TRACK_Y_COL_VAL,
    CB_ATTR: TRACK_ID_COL_VAL, // use track ID as a proxy CB attribute for the cb_raster style
    CB_VALS: "1,2,3",
    POINTCOLORS: "FFFF0000,FF00FF00,FF0000FF",
  };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB1Params)}`);
  const resultTCB1 = await getMap(tCB1Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-1.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB1.status}, content-type: ${resultTCB1.contentType}, bytes: ${resultTCB1.bytesLen}`);
  if (resultTCB1.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB1.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-1"] = classifyWms(resultTCB1);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-1"][0]} — ${wmsVerdicts["T-CB-1"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-2: + TRACK_ID_ATTR under cb_raster ===`);
  const tCB2Params = { ...tCB1Params, TRACK_ID_ATTR: TRACK_ID_COL_VAL };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB2Params)}`);
  const resultTCB2 = await getMap(tCB2Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-2.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB2.status}, content-type: ${resultTCB2.contentType}, bytes: ${resultTCB2.bytesLen}`);
  if (resultTCB2.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB2.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-2"] = classifyWms(resultTCB2);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-2"][0]} — ${wmsVerdicts["T-CB-2"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-3: + TRACK_ORDER_ATTR under cb_raster ===`);
  const tCB3Params = { ...tCB2Params, TRACK_ORDER_ATTR: TRACK_ORDER_COL_VAL };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB3Params)}`);
  const resultTCB3 = await getMap(tCB3Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-3.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB3.status}, content-type: ${resultTCB3.contentType}, bytes: ${resultTCB3.bytesLen}`);
  if (resultTCB3.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB3.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-3"] = classifyWms(resultTCB3);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-3"][0]} — ${wmsVerdicts["T-CB-3"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-4: + TRACKHEADCOLORS=FFFF0000,FF00FF00,FF0000FF (comma-separated under cb_raster) ===`);
  const tCB4Params = { ...tCB3Params, TRACKHEADCOLORS: "FFFF0000,FF00FF00,FF0000FF" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB4Params)}`);
  const resultTCB4 = await getMap(tCB4Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-4.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB4.status}, content-type: ${resultTCB4.contentType}, bytes: ${resultTCB4.bytesLen}`);
  if (resultTCB4.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB4.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-4"] = classifyWms(resultTCB4);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-4"][0]} — ${wmsVerdicts["T-CB-4"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-5: + TRACKLINECOLORS=FF0000FF,FF00FF00,FFFF0000 (comma-separated under cb_raster) ===`);
  const tCB5Params = { ...tCB4Params, TRACKLINECOLORS: "FF0000FF,FF00FF00,FFFF0000" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB5Params)}`);
  const resultTCB5 = await getMap(tCB5Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-5.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB5.status}, content-type: ${resultTCB5.contentType}, bytes: ${resultTCB5.bytesLen}`);
  if (resultTCB5.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB5.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-5"] = classifyWms(resultTCB5);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-5"][0]} — ${wmsVerdicts["T-CB-5"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-6: + TRACKHEADSIZES=8,6,4 (comma-separated under cb_raster) ===`);
  const tCB6Params = { ...tCB5Params, TRACKHEADSIZES: "8,6,4" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB6Params)}`);
  const resultTCB6 = await getMap(tCB6Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-6.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB6.status}, content-type: ${resultTCB6.contentType}, bytes: ${resultTCB6.bytesLen}`);
  if (resultTCB6.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB6.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-6"] = classifyWms(resultTCB6);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-6"][0]} — ${wmsVerdicts["T-CB-6"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-7: + TRACKLINEWIDTHS=2,3,4 (comma-separated under cb_raster) ===`);
  const tCB7Params = { ...tCB6Params, TRACKLINEWIDTHS: "2,3,4" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB7Params)}`);
  const resultTCB7 = await getMap(tCB7Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-7.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB7.status}, content-type: ${resultTCB7.contentType}, bytes: ${resultTCB7.bytesLen}`);
  if (resultTCB7.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB7.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-7"] = classifyWms(resultTCB7);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-7"][0]} — ${wmsVerdicts["T-CB-7"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-8: + TRACKMARKERSHAPES=circle,square,diamond (comma-separated under cb_raster — probe TRACKMARKERSHAPES naming) ===`);
  const tCB8Params = { ...tCB7Params, TRACKMARKERSHAPES: "circle,square,diamond" };
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB8Params)}`);
  const resultTCB8 = await getMap(tCB8Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-8.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB8.status}, content-type: ${resultTCB8.contentType}, bytes: ${resultTCB8.bytesLen}`);
  if (resultTCB8.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB8.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-8"] = classifyWms(resultTCB8);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-8"][0]} — ${wmsVerdicts["T-CB-8"][1]}`);
  console.log("");

  console.log(`=== Probe T-CB-9: TRACKHEADSHAPES=circle,square,diamond (alternate naming under cb_raster — compare with T-CB-8) ===`);
  const tCB9Params: Record<string, string> = { ...tCB7Params, TRACKHEADSHAPES: "circle,square,diamond" };
  delete tCB9Params["TRACKMARKERSHAPES"]; // isolate TRACKHEADSHAPES
  console.log(`[cb-track-spike] params: ${JSON.stringify(tCB9Params)}`);
  const resultTCB9 = await getMap(tCB9Params, resolve(SPIKE_OUTPUT_DIR, "37-T-CB-9.png"));
  console.log(`[cb-track-spike] HTTP status: ${resultTCB9.status}, content-type: ${resultTCB9.contentType}, bytes: ${resultTCB9.bytesLen}`);
  if (resultTCB9.bodyText) console.log(`[cb-track-spike] Body (non-image response): ${resultTCB9.bodyText.slice(0, 1000)}`);
  wmsVerdicts["T-CB-9"] = classifyWms(resultTCB9);
  console.log(`[cb-track-spike] Verdict: ${wmsVerdicts["T-CB-9"][0]} — ${wmsVerdicts["T-CB-9"][1]}`);
  console.log("[cb-track-spike] NOTE: Compare T-CB-8 vs T-CB-9 to lock TRACKMARKERSHAPES vs TRACKHEADSHAPES naming under cb_raster");
  console.log("");
} else {
  console.log("=== Track probes: DEFERRED ===");
  console.log("[cb-track-spike] TRACK_TABLE / TRACK_ID_COL / TRACK_ORDER_COL / TRACK_X_COL / TRACK_Y_COL not all set in .env");
  console.log("[cb-track-spike] Track probes skipped per 37-CONTEXT.md fallback: Phase 40 ships operator-override-only path");
  console.log("[cb-track-spike] Re-runnable via `npm run cb-track-spike` once a track table is reachable in .env");
  console.log("");
}

// ── SPIKE SUMMARY ─────────────────────────────────────────────────────────────

console.log("=== SPIKE SUMMARY ===");
console.log("");
console.log(`Baseline tiles: spike-output/37-baseline-num.png, spike-output/37-baseline-cat.png`);
console.log("");
console.log("Lane A probes (codebase-current naming: CB_COLUMN_NAME / CB_BREAK_TYPE / CB_BREAK_POINT_N / CB_POINTCOLOR_N):");
for (const k of ["A-NUM-8", "A-NUM-6", "A-CAT-8", "A-CAT-6"] as const) {
  const [v, r] = wmsVerdicts[k] ?? ["FAIL", "not run"];
  console.log(`  ${k}: ${v} — ${r}`);
}
console.log("");
console.log("Lane B probes (Kinetica 7.1 docs naming: CB_ATTR / CB_VALS / CB_POINTCOLORS):");
for (const k of ["B-NUM-8", "B-NUM-6", "B-CAT-8", "B-CAT-6"] as const) {
  const [v, r] = wmsVerdicts[k] ?? ["FAIL", "not run"];
  console.log(`  ${k}: ${v} — ${r}`);
}
console.log("");
console.log("Lane C probes (STYLES=cb_raster, raster-style comma-sep: POINTCOLORS / POINTSIZES / POINTSHAPES):");
for (const k of ["C-NUM-8", "C-NUM-6", "C-CAT-8", "C-CAT-6"] as const) {
  const [v, r] = wmsVerdicts[k] ?? ["FAIL", "not run"];
  console.log(`  ${k}: ${v} — ${r}`);
}
console.log("");
console.log("Color format: 6-char vs 8-char tiles per lane saved in spike-output/ — operator visually compares");
console.log("");
console.log("Categorical edge cases:");
for (const k of ["EDGE-2-QUOTED", "EDGE-2-BACKSLASH", "EDGE-3-NULL", "EDGE-4-MIXED"] as const) {
  const [v, r] = wmsVerdicts[k] ?? ["FAIL", "not run"];
  console.log(`  ${k}: ${v} — ${r}`);
}
console.log("");
console.log("NTILE SQL probes:");
for (const k of ["NTILE-A", "NTILE-B", "NTILE-C"] as const) {
  const [v, r] = sqlVerdicts[k] ?? ["FAIL", "not run"];
  console.log(`  ${k}: ${v} — ${r}`);
}
console.log("");

if (TRACK_PROBES_ENABLED) {
  console.log("Track probes (STYLES=raster with DOTRACKS):");
  for (const k of ["T-R-1", "T-R-2", "T-R-3", "T-R-4", "T-R-5", "T-R-6", "T-R-7", "T-R-8", "T-R-9"] as const) {
    const [v, r] = wmsVerdicts[k] ?? ["FAIL", "not run"];
    console.log(`  ${k}: ${v} — ${r}`);
  }
  console.log("Track probes (STYLES=cb_raster comma-sep):");
  for (const k of ["T-CB-1", "T-CB-2", "T-CB-3", "T-CB-4", "T-CB-5", "T-CB-6", "T-CB-7", "T-CB-8", "T-CB-9"] as const) {
    const [v, r] = wmsVerdicts[k] ?? ["FAIL", "not run"];
    console.log(`  ${k}: ${v} — ${r}`);
  }
} else {
  console.log("Track probes: DEFERRED — no TRACK_TABLE/TRACK_ID_COL/TRACK_ORDER_COL/TRACK_X_COL/TRACK_Y_COL env vars set");
}
console.log("");

// Determine CB lane HTTP-pass shortlists (precondition; visual-diff is the strong criterion)
const laneAHttpPass = (wmsVerdicts["A-NUM-8"]?.[0] === "PASS" || wmsVerdicts["A-NUM-6"]?.[0] === "PASS") &&
                      (wmsVerdicts["A-CAT-8"]?.[0] === "PASS" || wmsVerdicts["A-CAT-6"]?.[0] === "PASS");
const laneBHttpPass = (wmsVerdicts["B-NUM-8"]?.[0] === "PASS" || wmsVerdicts["B-NUM-6"]?.[0] === "PASS") &&
                      (wmsVerdicts["B-CAT-8"]?.[0] === "PASS" || wmsVerdicts["B-CAT-6"]?.[0] === "PASS");
const laneCHttpPass = (wmsVerdicts["C-NUM-8"]?.[0] === "PASS" || wmsVerdicts["C-NUM-6"]?.[0] === "PASS") &&
                      (wmsVerdicts["C-CAT-8"]?.[0] === "PASS" || wmsVerdicts["C-CAT-6"]?.[0] === "PASS");

console.log(`[cb-track-spike] Lane A HTTP-precondition: ${laneAHttpPass ? "PASS" : "FAIL"}`);
console.log(`[cb-track-spike] Lane B HTTP-precondition: ${laneBHttpPass ? "PASS" : "FAIL"}`);
console.log(`[cb-track-spike] Lane C HTTP-precondition: ${laneCHttpPass ? "PASS" : "FAIL"}`);

if (!laneAHttpPass && !laneBHttpPass && !laneCHttpPass) {
  console.log("[cb-track-spike] Overall: NONE_ESCALATE → BLOCK_V17 (all three CB lanes failed across both fixtures per 37-CONTEXT.md 'Total-fail escalation policy' — milestone re-scope required)");
} else {
  console.log(`[cb-track-spike] Overall: HTTP preconditions met on ${[laneAHttpPass ? "A" : null, laneBHttpPass ? "B" : null, laneCHttpPass ? "C" : null].filter(Boolean).join("+")} — VISUAL tile diff confirmation required for strong PASS (compare tiles against 37-baseline-{num,cat}.png)`);
}
console.log("");
console.log("[cb-track-spike] Done. Paste this full stdout + open spike-output/37-*.png tiles for visual-diff verification, then complete Task 2 with the operator handoff.");
