/**
 * adhocDvSpike.ts - Phase 133 S1 live harness (operator-run, NON-ADMIN Kinetica user, D-12).
 *
 * QUESTION: can an ad-hoc materialized view (no dashboard_dynamic_views row) be created, filtered by a
 * view-of-view, rendered by WMS, reaped by TTL and dropped - and which SQL yields a dv's column names?
 *
 * USAGE:
 *   cd packages/server && npx tsx src/spikes/adhocDvSpike.ts [--wait-ttl]
 *
 * ENV (LOCAL, un-committed packages/server/.env; never paste the password anywhere):
 *   KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD   - the NON-ADMIN user
 *   SPIKE_SOURCE_TABLE   (default demo.nyctaxi)  a table that user can read
 *   SPIKE_FILTER_COLUMN, SPIKE_FILTER_VALUE      equality filter for the view-of-view step
 *   SPIKE_LON_COL, SPIKE_LAT_COL                 for the WMS step (skipped, with a reason, if unset)
 *
 * SAFETY: creates only _kbi_spike_<rand>_* objects and drops them in `finally`. Never touches other tables.
 * No AI provider is called.
 */
import dotenv from "dotenv";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const USER = process.env.KINETICA_USERNAME;
const PASS = process.env.KINETICA_PASSWORD;
if (!KINETICA_URL || !USER || !PASS) {
  console.error("[s1-spike] ERROR: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD must be set in your local .env");
  process.exit(1);
}
console.log(`[s1-spike] User: ${USER}   (confirm this is the NON-ADMIN user)`);
console.log(`[s1-spike] Kinetica: ${KINETICA_URL}`);

const SRC = process.env.SPIKE_SOURCE_TABLE ?? "demo.nyctaxi";
const FCOL = process.env.SPIKE_FILTER_COLUMN;
const FVAL = process.env.SPIKE_FILTER_VALUE;
const LON = process.env.SPIKE_LON_COL;
const LAT = process.env.SPIKE_LAT_COL;
const WAIT_TTL = process.argv.includes("--wait-ttl");
const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
const r6 = Math.random().toString(36).slice(2, 8);
const DV = `_kbi_spike_${r6}_dv`;
const FV = `_kbi_spike_${r6}_f`;
console.log(`[s1-spike] Source: ${SRC}   spike objects: ${DV}, ${FV}\n`);

type SqlResult = { ok: boolean; message?: string; encoded?: Record<string, unknown> };

async function sql(statement: string, limit = 1000): Promise<SqlResult> {
  let res: Response;
  try {
    res = await fetch(`${KINETICA_URL}/execute/sql`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ statement, offset: 0, limit, encoding: "json", request_schema_str: "", data: [], options: {} }),
    });
  } catch (e) {
    return { ok: false, message: `network: ${String(e)}` };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || body.status === "ERROR") {
    return { ok: false, message: `HTTP ${res.status} ${String(body?.message ?? "no body")}` };
  }
  try {
    const ds = typeof body.data_str === "string" ? JSON.parse(body.data_str) : (body.data_str as Record<string, unknown>);
    const enc = typeof ds?.json_encoded_response === "string" ? JSON.parse(ds.json_encoded_response) : ds?.json_encoded_response;
    return { ok: true, encoded: enc as Record<string, unknown> };
  } catch {
    return { ok: true };
  }
}

const results: Record<string, string> = {};
function record(step: string, pass: boolean | "SKIPPED", detail: string): void {
  const tag = pass === "SKIPPED" ? "SKIPPED" : pass ? "PASS" : "FAIL";
  results[step] = tag;
  console.log(`${step}: ${tag}${detail ? " - " + detail : ""}`);
}
const firstScalar = (e?: Record<string, unknown>): unknown => {
  if (!e) return undefined;
  for (const [k, v] of Object.entries(e)) if (Array.isArray(v) && !["column_headers", "column_datatypes"].includes(k)) return v[0];
  return undefined;
};
const headers = (e?: Record<string, unknown>): string[] | undefined =>
  Array.isArray(e?.column_headers) ? (e!.column_headers as string[]) : undefined;

try {
  // S1.1 create
  const c1 = await sql(`CREATE OR REPLACE MATERIALIZED VIEW ${DV} AS (SELECT * FROM ${SRC} LIMIT 1000) USING TABLE PROPERTIES (TTL = 1)`);
  record("S1.1 create ad-hoc view", c1.ok, c1.message ?? "");

  // S1.2 count
  if (c1.ok) {
    const c2 = await sql(`SELECT COUNT(*) AS n FROM ${DV}`);
    record("S1.2 count ad-hoc view", c2.ok, c2.ok ? `n=${String(firstScalar(c2.encoded))}` : (c2.message ?? ""));
  } else record("S1.2 count ad-hoc view", "SKIPPED", "S1.1 failed");

  // S1.3 view-of-view
  if (c1.ok && FCOL && FVAL !== undefined) {
    const lit = FVAL.replace(/'/g, "''");
    const c3 = await sql(`CREATE OR REPLACE MATERIALIZED VIEW ${FV} AS (SELECT * FROM ${DV} WHERE ${FCOL} = '${lit}') USING TABLE PROPERTIES (TTL = 1)`);
    if (c3.ok) {
      const cnt = await sql(`SELECT COUNT(*) AS n FROM ${FV}`);
      record("S1.3 view-of-view filter", cnt.ok, cnt.ok ? `n=${String(firstScalar(cnt.encoded))}` : (cnt.message ?? ""));
    } else record("S1.3 view-of-view filter", false, c3.message ?? "");
  } else record("S1.3 view-of-view filter", "SKIPPED", c1.ok ? "SPIKE_FILTER_COLUMN / SPIKE_FILTER_VALUE unset" : "S1.1 failed");

  // S1.4 WMS
  if (results["S1.3 view-of-view filter"] === "PASS" && LON && LAT) {
    const params = new URLSearchParams({
      SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: FV, STYLES: "raster",
      SRS: "EPSG:3857", BBOX: "-20037508,-20037508,20037508,20037508", WIDTH: "256", HEIGHT: "256",
      FORMAT: "image/png", X_ATTR: LON, Y_ATTR: LAT,
    });
    try {
      const w = await fetch(`${KINETICA_URL}/wms?${params.toString()}`, { headers: { Authorization: auth } });
      const ct = w.headers.get("content-type") ?? "";
      const body = await w.arrayBuffer();
      record("S1.4 WMS GetMap", w.status === 200 && ct.includes("image"), `HTTP ${w.status} content-type=${ct} bytes=${body.byteLength}`);
    } catch (e) {
      record("S1.4 WMS GetMap", false, `network: ${String(e)}`);
    }
  } else {
    record("S1.4 WMS GetMap", "SKIPPED", !(LON && LAT) ? "SPIKE_LON_COL / SPIKE_LAT_COL unset" : "S1.3 did not pass");
  }

  // S1.5 column source
  if (c1.ok) {
    const a = await sql(`SELECT * FROM ${DV} LIMIT 0`);
    const aH = headers(a.encoded);
    record("S1.5a LIMIT 0 column_headers", !!aH?.length, a.ok ? `headers=${JSON.stringify(aH?.slice(0, 5))}...` : (a.message ?? ""));
    const b = await sql(`SELECT * FROM ${DV} LIMIT 1`, 1);
    const bH = headers(b.encoded);
    record("S1.5b LIMIT 1 column_headers", !!bH?.length, b.ok ? `headers=${JSON.stringify(bH?.slice(0, 5))}...` : (b.message ?? ""));
    const c = await sql(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${DV}'`);
    const cArr = Object.entries(c.encoded ?? {}).find(([k, v]) => Array.isArray(v) && !["column_headers", "column_datatypes"].includes(k));
    const cN = cArr ? (cArr[1] as unknown[]).length : 0;
    record("S1.5c INFORMATION_SCHEMA.COLUMNS", c.ok && cN > 0, c.ok ? `rows=${cN} keys=${JSON.stringify(Object.keys(c.encoded ?? {}))}` : (c.message ?? ""));
  } else record("S1.5 column source", "SKIPPED", "S1.1 failed");

  // S1.6 TTL
  if (WAIT_TTL && c1.ok) {
    console.log("S1.6: waiting 150 s without touching the view (TTL = 1 min)...");
    await new Promise((r) => setTimeout(r, 150_000));
    const t = await sql(`SELECT 1 FROM ${DV} LIMIT 0`);
    record("S1.6 TTL reaped", !t.ok, t.ok ? "view STILL EXISTS after 150 s (TTL not reaped / sliding?)" : `gone: ${t.message}`);
  } else record("S1.6 TTL reaped", "SKIPPED", c1.ok ? "pass --wait-ttl to run" : "S1.1 failed");
} finally {
  // S1.7 cleanup - own objects only
  const d1 = await sql(`DROP TABLE IF EXISTS ${FV}`);
  const d2 = await sql(`DROP TABLE IF EXISTS ${DV}`);
  record("S1.7 drop spike views", d1.ok && d2.ok, [d1.message, d2.message].filter(Boolean).join(" | "));
}

console.log("\n=== DECISION-RECORD ===");
console.log(`user=${USER} source=${SRC}`);
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
console.log("Rule (D-13): S1.1 + S1.3 + S1.4 all PASS => ad-hoc inline path. Any FAIL => AI dvs go live only after Keep (AIACT-V20-07 reworded). S1.4 SKIPPED => inconclusive, re-run with SPIKE_LON_COL / SPIKE_LAT_COL.");
console.log("Dv column source for 133-09: first of S1.5a / S1.5b / S1.5c that is PASS.");
