/**
 * wmsSpike.ts — Standalone WMS GetCapabilities spike runner for Phase 11 Wave 1.
 *
 * PURPOSE: Answer the seven Open Questions from 11-RESEARCH.md by probing the deployed
 * Kinetica instance directly. Results are recorded in 11-SPIKE-NOTES.md and locked as
 * param-name sources of truth for downstream Wave 2 plans (wmsUrlBuilder.ts).
 *
 * USAGE:
 *   cd server && npm run wms-spike
 *
 * OUTPUT:
 *   - server/src/spikes/wmsCapabilities.xml  (raw GetCapabilities XML, gitignored)
 *   - Stdout lines matching: GetCapabilities status, ST_Envelope probe, SRS probe, POINTOPACITY probe
 *
 * NOT PART OF THE EXPRESS APP — this is a one-shot CLI script invoked via tsx.
 */
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const KINETICA_URL = process.env.KINETICA_URL?.replace(/\/$/, "");
const KINETICA_USERNAME = process.env.KINETICA_USERNAME;
const KINETICA_PASSWORD = process.env.KINETICA_PASSWORD;

if (!KINETICA_URL || !KINETICA_USERNAME || !KINETICA_PASSWORD) {
  console.error("[spike] ERROR: KINETICA_URL, KINETICA_USERNAME, and KINETICA_PASSWORD must be set in .env");
  process.exit(1);
}

const basicAuth = "Basic " + Buffer.from(`${KINETICA_USERNAME}:${KINETICA_PASSWORD}`).toString("base64");
const redactedUrl = KINETICA_URL.replace(/:[^@:]+@/, ":***@");

console.log(`[spike] Deployed Kinetica: ${redactedUrl}`);
console.log(`[spike] User: ${KINETICA_USERNAME}`);
console.log("");

// ── Helper ──────────────────────────────────────────────────────────────────

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
    response = await rawFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement: sql, limit: 1 }),
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

// ── Probe 1: GetCapabilities ─────────────────────────────────────────────────

console.log("=== Probe 1: WMS GetCapabilities ===");
let capabilitiesXml: string | null = null;
let getCapabilitiesContentType = "";

try {
  const capsUrl = `${KINETICA_URL}/wms?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`;
  console.log(`[spike] GET ${capsUrl.replace(KINETICA_URL, redactedUrl)}`);

  const response = await rawFetch(capsUrl);
  const contentType = response.headers.get("content-type") ?? "";
  getCapabilitiesContentType = contentType;
  const bodyText = await response.text();

  console.log(`GetCapabilities status: ${response.status}`);
  console.log(`GetCapabilities content-type: ${contentType}`);

  if (response.ok && contentType.includes("xml")) {
    capabilitiesXml = bodyText;
    const __dir = resolve(fileURLToPath(import.meta.url), "..");
    const xmlPath = resolve(__dir, "wmsCapabilities.xml");
    writeFileSync(xmlPath, bodyText, "utf-8");
    console.log(`[spike] Raw XML written to: ${xmlPath}`);
    console.log(`[spike] XML length: ${bodyText.length} chars`);

    // Scan for STYLES, param names, colormaps from the XML
    const stylesMatches = bodyText.match(/<Style[^>]*>[\s\S]*?<Name>(.*?)<\/Name>/g);
    if (stylesMatches) {
      console.log(`[spike] STYLES found in GetCapabilities:`);
      stylesMatches.forEach((m) => {
        const name = m.match(/<Name>(.*?)<\/Name>/)?.[1];
        if (name) console.log(`  - ${name}`);
      });
    } else {
      // Try to find style names without XML namespace
      const nameMatches = bodyText.match(/<Name>(.*?)<\/Name>/g);
      if (nameMatches) {
        console.log(`[spike] <Name> elements found (may include STYLES + layers):`);
        nameMatches.slice(0, 20).forEach((m) => {
          const name = m.replace(/<\/?Name>/g, "");
          console.log(`  - ${name}`);
        });
      }
    }
  } else if (response.ok) {
    console.log(`[spike] GetCapabilities returned non-XML, content-type was ${contentType}`);
    console.log(`[spike] Body preview (first 500 chars): ${bodyText.slice(0, 500)}`);
  } else {
    console.log(`[spike] GetCapabilities returned error: ${response.status}`);
    console.log(`[spike] Body preview: ${bodyText.slice(0, 500)}`);
  }
} catch (e) {
  console.log(`GetCapabilities status: NETWORK_ERROR`);
  console.error(`[spike] Network error reaching Kinetica: ${e}`);
}

console.log("");

// ── Probe 2: ST_Envelope spelling ────────────────────────────────────────────

console.log("=== Probe 2: ST_Envelope SQL signature ===");

const envelopeSpellings = [
  `SELECT ST_XMin(ST_Envelope(ST_GeomFromText('POINT(1 2)'))) AS minLon`,
  `SELECT STXMIN(ST_ENVELOPE(ST_GEOMFROMTEXT('POINT(1 2)'))) AS minLon`,
  `SELECT ST_X_Min(ST_Envelope(ST_GeomFromText('POINT(1 2)'))) AS minLon`,
];

let stEnvelopeWorkingSpelling: string | null = null;
for (const sql of envelopeSpellings) {
  const result = await runSql(sql);
  const shortSql = sql.split("AS")[0].trim().slice(0, 80);
  if (result.ok) {
    console.log(`ST_Envelope probe: OK (status ${result.status}) — spelling: ${shortSql}`);
    stEnvelopeWorkingSpelling = sql;
    break;
  } else {
    console.log(`ST_Envelope probe: FAIL (status ${result.status}) — spelling: ${shortSql}`);
    if (typeof result.body === "object" && result.body !== null) {
      const bodyStr = JSON.stringify(result.body).slice(0, 200);
      console.log(`  Response: ${bodyStr}`);
    }
  }
}

if (!stEnvelopeWorkingSpelling) {
  console.log(`ST_Envelope probe: ALL SPELLINGS FAILED — see Caveats in SPIKE-NOTES.md`);
}

console.log("");

// ── Probe 3: SRS support ─────────────────────────────────────────────────────

console.log("=== Probe 3: SRS support ===");

// Use a placeholder layer — GetMap with EPSG:3857 and minimal params.
// Kinetica will return 400 if SRS not supported, 200 or tile data if supported.
// We test against EPSG:3857 and EPSG:4326; actual layer name isn't critical for SRS negotiation.
const srsTests = ["EPSG:3857", "EPSG:900913", "EPSG:4326"];
const srsResults: Record<string, string> = {};

for (const srs of srsTests) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: "ki_home.test_srs_probe_does_not_exist",
    STYLES: "point",
    SRS: srs,
    BBOX: "-20037508,-20037508,20037508,20037508",
    WIDTH: "10",
    HEIGHT: "10",
    FORMAT: "image/png",
  });

  const srsUrl = `${KINETICA_URL}/wms?${params.toString()}`;
  let srsStatus = -1;
  let srsAccepted = false;
  try {
    const response = await rawFetch(srsUrl);
    srsStatus = response.status;
    const ct = response.headers.get("content-type") ?? "";
    // 200 + image/png = accepted. 400 with XML exception = rejected SRS.
    // Kinetica may return 400 with "layer not found" but still accept the SRS — check body.
    const bodyText = await response.text();
    if (srsStatus === 200 && ct.includes("image")) {
      srsAccepted = true;
    } else if (
      srsStatus === 400 &&
      (bodyText.includes("does not exist") || bodyText.includes("not found") ||
       bodyText.includes("Invalid table") || bodyText.includes("LAYER"))
    ) {
      // Kinetica rejected the layer (as expected for our fake probe table) but accepted SRS
      srsAccepted = true;
    } else if (srsStatus === 400 && (bodyText.includes("SRS") || bodyText.includes("projection") || bodyText.includes("CRS"))) {
      srsAccepted = false;
    } else {
      // Unknown response — treat as accepted if not explicitly SRS error
      srsAccepted = srsStatus !== 400 || !bodyText.toLowerCase().includes("srs");
    }
    srsResults[srs] = srsAccepted ? "yes" : `no (${srsStatus})`;
    console.log(`SRS probe: ${srs} → ${srsResults[srs]}`);
  } catch (e) {
    srsResults[srs] = `NETWORK_ERROR: ${e}`;
    console.log(`SRS probe: ${srs} → NETWORK_ERROR`);
  }
}

console.log("");

// ── Probe 4: POINTOPACITY treatment ──────────────────────────────────────────

console.log("=== Probe 4: POINTOPACITY treatment ===");

// Test A: RRGGBBAA 8-digit hex (alpha as suffix on POINTCOLOR)
// Test B: separate POINTOPACITY param
// Both tests use a non-existent layer so Kinetica returns a 400 with layer error.
// If Kinetica returns "unknown param" for POINTOPACITY instead of "layer not found",
// the separate-param approach is not supported.

const probeLayerName = "ki_home.pointopacity_probe_layer";

// Test A: 8-digit RRGGBBAA
const paramsA = new URLSearchParams({
  SERVICE: "WMS",
  REQUEST: "GetMap",
  VERSION: "1.1.1",
  LAYERS: probeLayerName,
  STYLES: "point",
  SRS: "EPSG:3857",
  BBOX: "-20037508,-20037508,20037508,20037508",
  WIDTH: "10",
  HEIGHT: "10",
  FORMAT: "image/png",
  POINTCOLOR: "FF0000FF",
});

// Test B: separate POINTOPACITY
const paramsB = new URLSearchParams({
  SERVICE: "WMS",
  REQUEST: "GetMap",
  VERSION: "1.1.1",
  LAYERS: probeLayerName,
  STYLES: "point",
  SRS: "EPSG:3857",
  BBOX: "-20037508,-20037508,20037508,20037508",
  WIDTH: "10",
  HEIGHT: "10",
  FORMAT: "image/png",
  POINTCOLOR: "FF0000",
  POINTOPACITY: "100",
});

let pointOpacityResult = "UNKNOWN";

try {
  const responseA = await rawFetch(`${KINETICA_URL}/wms?${paramsA.toString()}`);
  const bodyA = await responseA.text();
  const statusA = responseA.status;

  const responseB = await rawFetch(`${KINETICA_URL}/wms?${paramsB.toString()}`);
  const bodyB = await responseB.text();
  const statusB = responseB.status;

  const aIsLayerError = bodyA.includes("does not exist") || bodyA.includes("not found") || bodyA.includes("Invalid table") || bodyA.includes("LAYER") || statusA === 200;
  const aIsParamError = bodyA.toLowerCase().includes("pointcolor") && bodyA.toLowerCase().includes("invalid");
  const bIsLayerError = bodyB.includes("does not exist") || bodyB.includes("not found") || bodyB.includes("Invalid table") || bodyB.includes("LAYER") || statusB === 200;
  const bIsParamError = bodyB.toLowerCase().includes("pointopacity") && bodyB.toLowerCase().includes("invalid");

  if (aIsLayerError && !bIsLayerError) {
    pointOpacityResult = "8-digit RRGGBBAA suffix on POINTCOLOR (separate POINTOPACITY rejected)";
  } else if (bIsLayerError && !aIsLayerError) {
    pointOpacityResult = "separate POINTOPACITY=<0-100> param supported";
  } else if (aIsLayerError && bIsLayerError) {
    pointOpacityResult = "BOTH approaches accepted by Kinetica (RRGGBBAA + separate POINTOPACITY)";
  } else if (aIsParamError) {
    pointOpacityResult = "8-digit RRGGBBAA rejected — use separate POINTOPACITY param";
  } else if (bIsParamError) {
    pointOpacityResult = "separate POINTOPACITY rejected — use 8-digit RRGGBBAA suffix";
  } else {
    pointOpacityResult = `AMBIGUOUS — A: status=${statusA}, B: status=${statusB}. Manual inspection needed.`;
  }

  console.log(`POINTOPACITY probe: Test A (RRGGBBAA suffix) status=${statusA}, Test B (separate param) status=${statusB}`);
  console.log(`POINTOPACITY probe: result → ${pointOpacityResult}`);
  console.log(`  Test A body (200 chars): ${bodyA.slice(0, 200)}`);
  console.log(`  Test B body (200 chars): ${bodyB.slice(0, 200)}`);
} catch (e) {
  console.log(`POINTOPACITY probe: NETWORK_ERROR — ${e}`);
}

console.log("");

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("=== SPIKE SUMMARY ===");
console.log(`Deployed Kinetica: ${redactedUrl}`);
console.log(`GetCapabilities XML captured: ${capabilitiesXml !== null ? "YES" : "NO"}`);
console.log(`ST_Envelope working spelling: ${stEnvelopeWorkingSpelling ? stEnvelopeWorkingSpelling.slice(0, 60) + "..." : "NOT FOUND"}`);
console.log(`SRS results:`);
for (const [srs, result] of Object.entries(srsResults)) {
  console.log(`  ${srs}: ${result}`);
}
console.log(`POINTOPACITY: ${pointOpacityResult}`);
console.log("");
console.log("[spike] Done. Review output and run Task 3 to write 11-SPIKE-NOTES.md.");
