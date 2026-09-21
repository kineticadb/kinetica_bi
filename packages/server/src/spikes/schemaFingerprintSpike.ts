/**
 * schemaFingerprintSpike.ts — Standalone /show/table + INFORMATION_SCHEMA.COLUMNS spike
 * runner for Phase 122 (v1.25 Schema Sync).
 *
 * PURPOSE: Phase 122's central locked decision is a per-column type fingerprint precise
 * enough that `int -> double` AND `varchar(8) -> varchar(32)` are BOTH detected, built from
 * /show/table's `type_schemas` + `properties`. That rests on an assumption nobody has
 * verified against a REAL response body from THIS deployed Kinetica instance. This spike
 * is the P0 GATE — mirrors the house pattern (Phase 18 wkbSpike.ts, Phase 37 cbTrackSpike.ts):
 * a spike must lock a Decision Record entry with a REAL body before planning proceeds, not
 * just "the call succeeded".
 *
 * ANSWERS NEEDED (122-RESEARCH.md "the one question that decides the phase"):
 *   1. varchar(8) vs varchar(32) — what differs in the /show/table response?
 *   2. int vs double vs long — what differs?
 *   3. Is there any column attribute that would let a rename be detected as a rename?
 *   4. What does INFORMATION_SCHEMA.COLUMNS.DATA_TYPE return for the same columns — does it
 *      include a length, e.g. varchar(32)?
 *   5. What does /show/table return for a table that does NOT exist — an error, an empty
 *      table_names, or something else? Probed BOTH with default options AND with
 *      { no_error_if_not_exists: true } per the documented option (docs.kinetica.com 7.1
 *      /api/rest/show_table_rest/).
 *
 * USAGE:
 *   cd packages/server && npm run schema-fingerprint-spike
 *
 * REQUIRED .env VARS (3, same convention as every other spike in this directory):
 *   KINETICA_URL              (e.g. http://localhost:9191)
 *   KINETICA_USERNAME         (operator's BI username — password mode)
 *   KINETICA_PASSWORD         (operator's BI password)
 *
 * These are NOT currently set in packages/server/.env (confirmed 2026-09-21 during Phase 122
 * research) — this script was written but could not be executed against the live instance in
 * that research session because (a) credentials are absent from .env and (b) the sandboxed
 * research agent is denied any tool call that resembles credential discovery/guessing against a
 * live service, by design. Add real credentials to your LOCAL, un-committed .env to run this.
 *
 * OPTIONAL .env VARS (fixture tables — defaults match the dev DB tables named in 122-CONTEXT.md):
 *   SCHEMA_SPIKE_VARCHAR_TABLE   (default: demo.nyctaxi)   — must have a short + long text column
 *   SCHEMA_SPIKE_NUMERIC_TABLE   (default: demo.nyctaxi)   — must have int/double/long columns
 *   SCHEMA_SPIKE_MISSING_TABLE   (default: <schema>.__schema_spike_missing_table__, a name chosen
 *                                 not to exist) — probes the table-not-found outcome
 *
 * OUTPUT:
 *   - Full verbatim JSON bodies to stdout (type_schemas, properties, INFORMATION_SCHEMA rows)
 *   - A DECISION-RECORD-shaped summary at the end answering all 5 numbered questions
 *   - NOT PART OF THE EXPRESS APP — one-shot CLI script invoked via tsx. Read-only: never
 *     issues DDL/DML, only /show/table (POST, read-only per Kinetica docs) and SELECT.
 */
import dotenv from "dotenv";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const KINETICA_USERNAME = process.env.KINETICA_USERNAME;
const KINETICA_PASSWORD = process.env.KINETICA_PASSWORD;

if (!KINETICA_URL || !KINETICA_USERNAME || !KINETICA_PASSWORD) {
  console.error(
    "[schema-fingerprint-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, and KINETICA_PASSWORD must be set in .env\n" +
      "  KINETICA_URL is set in this repo's packages/server/.env, but KINETICA_USERNAME/\n" +
      "  KINETICA_PASSWORD are commented out. Add your real Kinetica credentials to your LOCAL\n" +
      "  .env (do not commit them) and re-run: cd packages/server && npm run schema-fingerprint-spike"
  );
  process.exit(1);
}

const basicAuth = "Basic " + Buffer.from(`${KINETICA_USERNAME}:${KINETICA_PASSWORD}`).toString("base64");
const redactedUrl = KINETICA_URL.replace(/:[^@:]+@/, ":***@");

const VARCHAR_TABLE = process.env.SCHEMA_SPIKE_VARCHAR_TABLE ?? "demo.nyctaxi";
const NUMERIC_TABLE = process.env.SCHEMA_SPIKE_NUMERIC_TABLE ?? "demo.nyctaxi";
const MISSING_TABLE = process.env.SCHEMA_SPIKE_MISSING_TABLE ?? "demo.__schema_spike_missing_table__";

console.log(`[schema-fingerprint-spike] Deployed Kinetica: ${redactedUrl}`);
console.log(`[schema-fingerprint-spike] User: ${KINETICA_USERNAME}`);
console.log(`[schema-fingerprint-spike] Varchar-fixture table: ${VARCHAR_TABLE}`);
console.log(`[schema-fingerprint-spike] Numeric-fixture table: ${NUMERIC_TABLE}`);
console.log(`[schema-fingerprint-spike] Missing-table probe: ${MISSING_TABLE}`);
console.log("");

async function rawFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: basicAuth,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function showTable(tableName: string, options: Record<string, unknown> = {}) {
  const url = `${KINETICA_URL}/show/table`;
  let response: Response;
  try {
    response = await rawFetch(url, {
      method: "POST",
      body: JSON.stringify({ table_name: tableName, options }),
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

async function runSql(sql: string) {
  const url = `${KINETICA_URL}/execute/sql`;
  let response: Response;
  try {
    response = await rawFetch(url, {
      method: "POST",
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

function decodeDataStr(body: unknown): unknown {
  const b = body as { data_str?: unknown };
  if (typeof b?.data_str === "string") {
    try {
      return JSON.parse(b.data_str);
    } catch {
      return { parseError: "data_str not valid JSON", raw: b.data_str };
    }
  }
  return b?.data_str;
}

// ── Probe 1: /show/table for the varchar-fixture table (full body) ─────────────
console.log(`=== Probe VARCHAR-TABLE: /show/table for ${VARCHAR_TABLE} ===`);
const r1 = await showTable(VARCHAR_TABLE);
console.log(`HTTP ${r1.status}`);
console.log("Decoded show_table_response:", JSON.stringify(decodeDataStr(r1.body), null, 2));
console.log("");

// ── Probe 2: /show/table for the numeric-fixture table (full body, may be same table) ──
if (NUMERIC_TABLE !== VARCHAR_TABLE) {
  console.log(`=== Probe NUMERIC-TABLE: /show/table for ${NUMERIC_TABLE} ===`);
  const r2 = await showTable(NUMERIC_TABLE);
  console.log(`HTTP ${r2.status}`);
  console.log("Decoded show_table_response:", JSON.stringify(decodeDataStr(r2.body), null, 2));
  console.log("");
}

// ── Probe 3: INFORMATION_SCHEMA.COLUMNS for the varchar-fixture table ──────────
const [schemaName, tableOnly] = VARCHAR_TABLE.split(".");
console.log(`=== Probe INFO-SCHEMA: INFORMATION_SCHEMA.COLUMNS for ${VARCHAR_TABLE} ===`);
const r3 = await runSql(
  `SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${schemaName}' AND TABLE_NAME = '${tableOnly}' ORDER BY ORDINAL_POSITION ASC`
);
console.log(`HTTP ${r3.status}`);
console.log("Body:", JSON.stringify(r3.body, null, 2));
console.log("");

// ── Probe 4: /show/table for a table that does NOT exist — default options ────
console.log(`=== Probe MISSING-DEFAULT: /show/table for ${MISSING_TABLE} (default options, no_error_if_not_exists unset) ===`);
const r4 = await showTable(MISSING_TABLE);
console.log(`HTTP ${r4.status}`);
console.log("Raw body:", JSON.stringify(r4.body, null, 2));
console.log("");

// ── Probe 5: /show/table for a table that does NOT exist — no_error_if_not_exists: true ──
console.log(`=== Probe MISSING-NOERROR: /show/table for ${MISSING_TABLE} (no_error_if_not_exists: true) ===`);
const r5 = await showTable(MISSING_TABLE, { no_error_if_not_exists: "true" });
console.log(`HTTP ${r5.status}`);
console.log("Raw body:", JSON.stringify(r5.body, null, 2));
console.log("Decoded show_table_response (if any):", JSON.stringify(decodeDataStr(r5.body), null, 2));
console.log("");

// ── Probe 6: INFORMATION_SCHEMA.COLUMNS for a table that does NOT exist ────────
const [missingSchema, missingTableOnly] = MISSING_TABLE.split(".");
console.log(`=== Probe INFO-SCHEMA-MISSING: INFORMATION_SCHEMA.COLUMNS for ${MISSING_TABLE} ===`);
const r6 = await runSql(
  `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '${missingSchema}' AND TABLE_NAME = '${missingTableOnly}' ORDER BY ORDINAL_POSITION ASC`
);
console.log(`HTTP ${r6.status}`);
console.log("Body (expect a clean empty result, NOT an error, if INFORMATION_SCHEMA is a true catalog view):", JSON.stringify(r6.body, null, 2));
console.log("");

// ── SPIKE SUMMARY ────────────────────────────────────────────────────────────
console.log("=== SPIKE SUMMARY — fill in from the probes above before planning proceeds ===");
console.log("Q1 (varchar(8) vs varchar(32)): inspect VARCHAR-TABLE properties[] for the short/long text columns —");
console.log("   expect entries like [\"char8\",\"data\"] vs [\"char32\",\"data\"] (or \"string\" with no size property = unbounded).");
console.log("Q2 (int vs double vs long): inspect VARCHAR-TABLE/NUMERIC-TABLE type_schemas[] avro field \"type\" —");
console.log("   expect \"int\" / \"double\" / \"long\" as the base avro type, independent of properties[].");
console.log("Q3 (stable per-column id for rename detection): inspect whether any field in the decoded body carries");
console.log("   a column id/ordinal that survives a rename — type_schemas fields are name-keyed avro records,");
console.log("   properties is a name-keyed map; if MISSING here, no stable id exists.");
console.log("Q4 (INFORMATION_SCHEMA.COLUMNS.DATA_TYPE precision): compare Probe INFO-SCHEMA's DATA_TYPE values");
console.log("   against Probe VARCHAR-TABLE's properties — does DATA_TYPE ever show a length?");
console.log("Q5 (table-not-found signature): compare Probe MISSING-DEFAULT (status/message) vs MISSING-NOERROR");
console.log("   (status/table_names/properties when suppressed) vs INFO-SCHEMA-MISSING (rows returned) —");
console.log("   this decides how Phase 122 tells 'table missing' apart from 'could not reach Kinetica'.");
