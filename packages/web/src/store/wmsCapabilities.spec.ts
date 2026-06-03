/**
 * wmsCapabilities.spec.ts — Frontend Zustand store + boot wiring spec (Phase 11 MAP-01, MAP-02)
 *
 * Tests:
 *   - Initial store state: capabilities=null, loading=false, error=null
 *   - initWmsCapabilities sets capabilities on success
 *   - initWmsCapabilities is idempotent — second call does not re-fetch
 *   - initWmsCapabilities falls back to all-modes shape on network error
 *
 * The Zustand store-reset shim in __mocks__/zustand.ts (activated via vi.mock("zustand")
 * in src/test/setup.ts) automatically resets useWmsCapabilitiesStore state between tests.
 * The module-scoped bootPromise is reset manually via __resetWmsCapabilitiesBootForTest().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useWmsCapabilitiesStore,
  initWmsCapabilities,
  __resetWmsCapabilitiesBootForTest,
} from "./wmsCapabilities";

vi.mock("../api/client", () => ({
  fetchWmsCapabilities: vi.fn(),
  // Other exports referenced by the module — not used here but required for import resolution
  apiFetch: vi.fn(),
}));

// Import the mock after vi.mock so we get the mocked version
import { fetchWmsCapabilities } from "../api/client";

describe("useWmsCapabilitiesStore (Phase 11)", () => {
  beforeEach(() => {
    __resetWmsCapabilitiesBootForTest();
    vi.clearAllMocks();
  });

  it("initial state: capabilities=null, loading=false, error=null", () => {
    const s = useWmsCapabilitiesStore.getState();
    expect(s.capabilities).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("initWmsCapabilities sets capabilities on success", async () => {
    const mockCapabilities = {
      renderModes: ["raster", "heatmap"] as ("raster" | "heatmap" | "classbreak" | "contour")[],
      colormaps: ["viridis"],
      spatialModes: ["latlon", "wkt", "wkb"] as ("latlon" | "wkt" | "wkb")[],
      srs: ["EPSG:3857"],
      source: "probed" as const,
    };
    (fetchWmsCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue(mockCapabilities);

    await initWmsCapabilities();

    expect(useWmsCapabilitiesStore.getState().capabilities).toEqual(mockCapabilities);
    expect(useWmsCapabilitiesStore.getState().loading).toBe(false);
    expect(useWmsCapabilitiesStore.getState().error).toBeNull();
  });

  it("initWmsCapabilities is idempotent — second call does not re-fetch", async () => {
    (fetchWmsCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue({
      renderModes: [],
      colormaps: [],
      spatialModes: [],
      srs: [],
      source: "probed" as const,
    });

    await initWmsCapabilities();
    await initWmsCapabilities();

    expect(fetchWmsCapabilities).toHaveBeenCalledTimes(1);
  });

  it("initWmsCapabilities falls back to all-modes shape on network error", async () => {
    (fetchWmsCapabilities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    await initWmsCapabilities();

    const c = useWmsCapabilitiesStore.getState().capabilities!;
    expect(c.source).toBe("fallback");
    expect(c.renderModes).toEqual(["raster", "heatmap", "classbreak", "contour"]);
    // Post-VERIFY (full Kinetica catalog): fallback now declares the complete
    // colormap set per the Kinetica WMS docs — 75 entries across Perceptually-
    // Uniform / Sequential I / Sequential II / Diverging / Qualitative / Misc.
    expect(c.colormaps.length).toBeGreaterThan(60);
    // Spot-check representative entries from each group.
    expect(c.colormaps).toContain("viridis"); // Perceptually-Uniform
    expect(c.colormaps).toContain("Blues"); // Sequential I
    expect(c.colormaps).toContain("autumn"); // Sequential II
    expect(c.colormaps).toContain("BrBG"); // Diverging
    expect(c.colormaps).toContain("Accent"); // Qualitative
    expect(c.colormaps).toContain("cubehelix"); // Misc
    expect(c.spatialModes).toEqual(["latlon", "wkt", "wkb"]);
    // Error should be recorded in the store
    expect(useWmsCapabilitiesStore.getState().error).not.toBeNull();
  });
});
