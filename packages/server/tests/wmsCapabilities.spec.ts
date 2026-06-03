/**
 * wmsCapabilities.spec.ts — TDD RED → GREEN for Phase 11 Plan 03 (MAP-01, MAP-02)
 *
 * Tests for:
 *   - parseWmsCapabilities(xml): WmsCapabilities — extracts renderModes / srs from real fixture
 *   - getCachedCapabilities(): Promise<WmsCapabilities> — in-process cache + graceful fallback
 *
 * Fixture: server/src/wmsCapabilities.xml (42507-char GetCapabilities XML from
 * deployed Kinetica at http://kinetica.example.com:9191/gpudb-0, captured in Phase 11 Plan 01 Task 2).
 *
 * Key findings from SPIKE-NOTES.md:
 *   - GetCapabilities XML lists only "heatmap" and "raster" per layer Style blocks
 *   - classbreak / contour return HTTP 200 but are NOT in the XML — do NOT gate UI on XML
 *   - SRS values in fixture: EPSG:900913, EPSG:4326, EPSG:102100, EPSG:3857
 *   - Intersection target: ["EPSG:3857", "EPSG:900913", "EPSG:4326"] (EPSG:102100 excluded)
 *   - colormaps: fixture has no Colormap element; use default 8-entry list
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseWmsCapabilities,
  getCachedCapabilities,
  __resetCacheForTest,
} from "../src/wmsCapabilities";
import type { WmsCapabilities } from "../src/wmsCapabilities";

// Load real fixture from spike
const FIXTURE_XML = readFileSync(
  join(import.meta.dirname, "../src/wmsCapabilities.xml"),
  "utf8"
);

// Post-VERIFY (full Kinetica catalog): the fallback colormap list is now the
// complete Kinetica WMS docs catalog — 75 entries across 6 groups. The spec
// keeps DEFAULT_COLORMAPS as a representative spot-check rather than a literal
// equality comparison; the production DEFAULT_COLORMAPS source of truth lives
// in `server/src/wmsCapabilities.ts`.
const DEFAULT_COLORMAPS_SPOT_CHECK = [
  "viridis", // Perceptually-Uniform
  "Blues", // Sequential I
  "autumn", // Sequential II
  "BrBG", // Diverging
  "Accent", // Qualitative
  "cubehelix", // Misc
];
const VALID_RENDER_MODES = ["raster", "heatmap", "classbreak", "contour"] as const;
const VALID_SRS = ["EPSG:3857", "EPSG:900913", "EPSG:4326"];

describe("parseWmsCapabilities", () => {
  it("extracts renderModes from fixture XML intersected with known modes", () => {
    const result = parseWmsCapabilities(FIXTURE_XML);
    // Fixture has heatmap + raster in Style blocks; classbreak/contour absent from XML
    // Result must only include modes that are in the known-modes list
    expect(result.renderModes.every((m) => VALID_RENDER_MODES.includes(m as typeof VALID_RENDER_MODES[number]))).toBe(true);
    // Both heatmap and raster are present in the fixture
    expect(result.renderModes).toContain("heatmap");
    expect(result.renderModes).toContain("raster");
    // classbreak and contour are NOT in GetCapabilities XML (per SPIKE-NOTES.md)
    expect(result.renderModes).not.toContain("classbreak");
    expect(result.renderModes).not.toContain("contour");
  });

  it("returns renderModes: [] when XML has no <Style> elements", () => {
    const minimalXml = `<?xml version="1.0"?>
<WMT_MS_Capabilities version="1.1.1">
  <Capability>
    <Layer><Name>empty</Name></Layer>
  </Capability>
</WMT_MS_Capabilities>`;
    const result = parseWmsCapabilities(minimalXml);
    expect(result.renderModes).toEqual([]);
  });

  it("extracts SRS values from fixture and intersects with known list", () => {
    const result = parseWmsCapabilities(FIXTURE_XML);
    // Fixture has EPSG:900913, EPSG:4326, EPSG:102100, EPSG:3857
    // EPSG:102100 is NOT in the intersection target → must be excluded
    expect(result.srs).not.toContain("EPSG:102100");
    // These three ARE in both fixture and intersection target
    expect(result.srs).toContain("EPSG:3857");
    expect(result.srs).toContain("EPSG:900913");
    expect(result.srs).toContain("EPSG:4326");
    // All returned SRS values must be in the valid list
    expect(result.srs.every((s) => VALID_SRS.includes(s))).toBe(true);
  });

  it("returns default colormaps when fixture has no Colormap element", () => {
    const result = parseWmsCapabilities(FIXTURE_XML);
    // Kinetica's GetCapabilities XML doesn't include Colormap elements
    // Spot-check representative entries from each group (full catalog has ~75 entries).
    for (const entry of DEFAULT_COLORMAPS_SPOT_CHECK) {
      expect(result.colormaps).toContain(entry);
    }
    expect(result.colormaps.length).toBeGreaterThan(60);
  });

  it("returns all three spatialModes (hardcoded default — GetCapabilities does not enumerate them)", () => {
    const result = parseWmsCapabilities(FIXTURE_XML);
    expect(result.spatialModes).toEqual(["latlon", "wkt", "wkb"]);
  });

  it("returns source: 'probed' on successful parse", () => {
    const result = parseWmsCapabilities(FIXTURE_XML);
    expect(result.source).toBe("probed");
  });

  it("returns srs: [] when XML has no <SRS> elements", () => {
    const xmlNoSrs = `<?xml version="1.0"?>
<WMT_MS_Capabilities version="1.1.1">
  <Capability>
    <Layer>
      <Style><Name>raster</Name></Style>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;
    const result = parseWmsCapabilities(xmlNoSrs);
    expect(result.srs).toEqual([]);
  });
});

describe("getCachedCapabilities", () => {
  // We reset the module-scoped cache between tests via the test reset export.
  // Since vitest uses isolate:true, each spec file gets a fresh module graph,
  // so the module-scoped `cached` is always null at spec start. But within this
  // describe block we need to reset between individual tests.

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset module-level cache between tests so each test starts with no cached value.
    // vitest isolate:true resets module state per FILE, but not per individual test
    // within a file — we need this explicit reset for getCachedCapabilities tests.
    __resetCacheForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("second call does NOT re-invoke fetch (in-process cache)", async () => {
    // Mock fetch to return a minimal valid capabilities XML response
    const mockXmlResponse = `<?xml version="1.0"?>
<WMT_MS_Capabilities version="1.1.1">
  <Capability>
    <Layer>
      <SRS>EPSG:3857</SRS>
      <Style><Name>raster</Name></Style>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;

    fetchSpy = vi.fn().mockResolvedValue(
      new Response(mockXmlResponse, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result1 = await getCachedCapabilities();
    const result2 = await getCachedCapabilities();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result1).toBe(result2); // same reference — returned from cache
  });

  it("returns fallback shape when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await getCachedCapabilities();

    expect(result.source).toBe("fallback");
    expect(result.renderModes).toEqual(["raster", "heatmap", "classbreak", "contour"]);
    // Spot-check representative entries from each group (full catalog has ~75 entries).
    for (const entry of DEFAULT_COLORMAPS_SPOT_CHECK) {
      expect(result.colormaps).toContain(entry);
    }
    expect(result.colormaps.length).toBeGreaterThan(60);
    expect(result.spatialModes).toEqual(["latlon", "wkt", "wkb"]);
    expect(result.srs).toEqual(["EPSG:3857"]);
  });
});
