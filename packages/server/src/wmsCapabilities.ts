/**
 * wmsCapabilities.ts — Server-side WMS GetCapabilities parser + in-process cache.
 *
 * Phase 11 Plan 03 (MAP-01, MAP-02)
 *
 * Exports:
 *   parseWmsCapabilities(xml: string): WmsCapabilities
 *   getCachedCapabilities(): Promise<WmsCapabilities>
 *   WmsCapabilities (type)
 *
 * Design decisions:
 *   - GetCapabilities is probed anonymously via Basic auth from KINETICA_USERNAME + KINETICA_PASSWORD
 *     env vars (same vars the spike runner uses — GetCapabilities does NOT go through kineticaWms
 *     which requires an AuthedRequest; GetCapabilities is a server-to-server probe, not per-user).
 *   - classbreak / contour are NOT listed in this Kinetica's GetCapabilities XML Style blocks
 *     (confirmed in SPIKE-NOTES.md). The parser intentionally intersects with only the 4 known modes;
 *     downstream code must NOT use renderModes to gate classbreak/contour (use GetMap probe instead).
 *   - colormaps: Kinetica's GetCapabilities has no <Colormap> element; always returns the 8-entry
 *     default list (all verified HTTP 200 in spike).
 *   - spatialModes: GetCapabilities does not enumerate these; always returns all 3 (latlon, wkt, wkb).
 *     Phase 10's getValidSpatialColumns filters at runtime based on actual column types.
 *   - SRS: intersected with the 3 known SRS values (EPSG:102100 from fixture excluded).
 *   - Fallback: on probe failure the caller receives all 4 render modes + 8 colormaps so the UI
 *     picker stays fully usable.
 */

import { XMLParser } from "fast-xml-parser";

// ── Types ────────────────────────────────────────────────────────────────────

export type WmsCapabilities = {
  renderModes: ("raster" | "heatmap" | "classbreak" | "contour")[];
  colormaps: string[];
  spatialModes: ("latlon" | "wkt" | "wkb")[];
  srs: string[];
  source: "probed" | "fallback";
};

// ── Constants ────────────────────────────────────────────────────────────────

const KNOWN_RENDER_MODES = ["raster", "heatmap", "classbreak", "contour"] as const;

// Full Kinetica colormap catalog — mirrors COLORMAP_GROUPS in
// packages/web/src/components/charts/KineticaWmsLayerForm.tsx. Used as the
// fallback declaration when probing Kinetica's `/admin/wms/capabilities`
// endpoint fails or returns an unrecognized shape. `cividis`/`turbo` are NOT
// in Kinetica's WMS docs (the deployed server rejects them) and are excluded.
const DEFAULT_COLORMAPS = [
  // Perceptually-Uniform
  "viridis", "inferno", "plasma", "magma",
  // Sequential I
  "Blues", "BuGn", "BuPu", "GnBu", "Greens", "Greys", "Oranges", "OrRd",
  "PuBu", "PuBuGn", "PuRd", "Purples", "RdPu", "Reds",
  "YlGn", "YlGnBu", "YlOrBr", "YlOrRd",
  // Sequential II
  "afmhot", "autumn", "bone", "cool", "copper", "gist_heat",
  "gray", "gist_gray", "gist_yarg", "binary", "hot", "pink",
  "spring", "summer", "winter",
  // Diverging
  "BrBG", "bwr", "coolwarm", "PiYG", "PRGn", "PuOr",
  "RdBu", "RdGy", "RdYlBu", "RdYlGn", "Spectral", "seismic",
  // Qualitative
  "Accent", "Dark2", "Paired", "Pastel1", "Pastel2", "Set1", "Set2", "Set3",
  // Misc
  "gist_earth", "terrain", "ocean", "gist_stern", "brg", "CMRmap",
  "cubehelix", "gnuplot", "gnuplot2", "gist_ncar", "spectral",
  "nipy_spectral", "jet", "rainbow", "gist_rainbow", "hsv", "flag", "prism",
];

const KNOWN_SRS = ["EPSG:3857", "EPSG:900913", "EPSG:4326"];

const FALLBACK: WmsCapabilities = {
  renderModes: ["raster", "heatmap", "classbreak", "contour"],
  colormaps: DEFAULT_COLORMAPS,
  spatialModes: ["latlon", "wkt", "wkb"],
  srs: ["EPSG:3857"],
  source: "fallback",
};

// ── In-process cache ─────────────────────────────────────────────────────────

// Module-scoped cache — persists for the lifetime of the server process.
// First call probes Kinetica; subsequent calls return the cached value.
let cached: WmsCapabilities | null = null;

// Test helper: reset cache between tests (vitest isolate:true resets module state
// per file, but within a file this lets beforeEach reset the cache).
export function __resetCacheForTest(): void {
  cached = null;
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * parseWmsCapabilities(xml: string): WmsCapabilities
 *
 * Extracts capabilities from a WMS 1.1.1 GetCapabilities XML response.
 * Returns a stable shape with source: "probed".
 *
 * Intersection logic:
 *   - renderModes: Style/Name values that appear in KNOWN_RENDER_MODES
 *   - colormaps: always DEFAULT_COLORMAPS (no Colormap element in Kinetica XML)
 *   - spatialModes: always ["latlon", "wkt", "wkb"] (not in GetCapabilities)
 *   - srs: SRS values that appear in KNOWN_SRS
 */
export function parseWmsCapabilities(xml: string): WmsCapabilities {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Treat repeated elements as arrays so we always get arrays, never scalars
    isArray: (name) => ["SRS", "Style", "Layer"].includes(name),
  });

  const doc = parser.parse(xml);

  // ── Extract Style names (renderModes) ─────────────────────────────────────
  const styleNames = new Set<string>();
  const collectStyles = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    if (Array.isArray(obj["Style"])) {
      for (const style of obj["Style"] as Array<Record<string, unknown>>) {
        if (style && typeof style["Name"] === "string") {
          styleNames.add(style["Name"]);
        }
      }
    }
    // Recurse into nested Layers
    if (Array.isArray(obj["Layer"])) {
      for (const layer of obj["Layer"]) {
        collectStyles(layer);
      }
    }
    // Also check the Capability root node
    if (obj["Capability"]) collectStyles(obj["Capability"]);
    if (obj["WMT_MS_Capabilities"]) collectStyles(obj["WMT_MS_Capabilities"]);
  };
  collectStyles(doc);

  const renderModes = KNOWN_RENDER_MODES.filter((m) => styleNames.has(m));

  // ── Extract SRS values ────────────────────────────────────────────────────
  const srsValues = new Set<string>();
  const collectSrs = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    if (Array.isArray(obj["SRS"])) {
      for (const s of obj["SRS"] as unknown[]) {
        if (typeof s === "string") srsValues.add(s);
      }
    }
    // Recurse into all known wrapper nodes
    for (const key of ["Capability", "WMT_MS_Capabilities", "Layer"]) {
      if (obj[key]) {
        if (Array.isArray(obj[key])) {
          for (const child of obj[key] as unknown[]) collectSrs(child);
        } else {
          collectSrs(obj[key]);
        }
      }
    }
  };
  collectSrs(doc);

  const srs = KNOWN_SRS.filter((s) => srsValues.has(s));

  return {
    renderModes,
    colormaps: DEFAULT_COLORMAPS,
    spatialModes: ["latlon", "wkt", "wkb"],
    srs,
    source: "probed",
  };
}

// ── Cached probe ──────────────────────────────────────────────────────────────

/**
 * getCachedCapabilities(): Promise<WmsCapabilities>
 *
 * First call: probes Kinetica's WMS GetCapabilities endpoint, parses, caches.
 * Subsequent calls: returns the cached value (no new fetch).
 * On failure: returns FALLBACK shape + logs error.
 *
 * Auth: Basic auth from KINETICA_USERNAME + KINETICA_PASSWORD env vars.
 * GetCapabilities is a server-to-server anonymous probe — it does NOT require
 * a per-user AuthedRequest (unlike tile fetches via kineticaWms).
 */
export async function getCachedCapabilities(): Promise<WmsCapabilities> {
  if (cached !== null) return cached;

  try {
    const kineticaUrl = (process.env.KINETICA_URL ?? "").replace(/\/$/, "");
    const username = process.env.KINETICA_USERNAME ?? "";
    const password = process.env.KINETICA_PASSWORD ?? "";
    const basicAuth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const capUrl =
      `${kineticaUrl}/wms?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`;

    const response = await fetch(capUrl, {
      headers: { Authorization: basicAuth },
      signal: AbortSignal.timeout(10_000), // 10s timeout — capabilities XML is ~42KB
    });

    if (!response.ok) {
      throw new Error(`GetCapabilities probe returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    cached = parseWmsCapabilities(xml);
    return cached;
  } catch (err) {
    console.error("WMS capabilities probe failed", err);
    cached = { ...FALLBACK };
    return cached;
  }
}
