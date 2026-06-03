/**
 * wmsCapabilities.ts — Zustand store + boot wiring for WMS capabilities (Phase 11 MAP-01, MAP-02)
 *
 * Exports:
 *   useWmsCapabilitiesStore  — Zustand store selector (capabilities, loading, error state)
 *   initWmsCapabilities()    — Idempotent boot helper; call once at app mount from App.tsx
 *   __resetWmsCapabilitiesBootForTest() — Test helper: resets module-scoped bootPromise
 *
 * Design:
 *   - Server-side getCachedCapabilities() already returns a fallback shape on probe failure,
 *     so the only network failure this store needs to handle is a complete network error
 *     (server unreachable). In that case, the store sets the same all-modes fallback locally.
 *   - initWmsCapabilities() is idempotent: the module-scoped bootPromise prevents double-fetch
 *     if called multiple times (e.g., hot-reloaded app, React StrictMode double-effect).
 *   - The Zustand store-reset shim in __mocks__/zustand.ts resets store state between tests;
 *     the module-scoped bootPromise requires an explicit __resetWmsCapabilitiesBootForTest() call.
 */
import { create } from "zustand";
import { fetchWmsCapabilities, type WmsCapabilitiesDto } from "../api/client";

type WmsCapabilitiesState = {
  capabilities: WmsCapabilitiesDto | null;
  loading: boolean;
  error: string | null;
  _setCapabilities: (c: WmsCapabilitiesDto) => void;
  _setLoading: (l: boolean) => void;
  _setError: (e: string | null) => void;
};

export const useWmsCapabilitiesStore = create<WmsCapabilitiesState>((set) => ({
  capabilities: null,
  loading: false,
  error: null,
  _setCapabilities: (c) => set({ capabilities: c, loading: false, error: null }),
  _setLoading: (l) => set({ loading: l }),
  _setError: (e) => set({ error: e, loading: false }),
}));

// Module-scoped boot promise — persists for the lifetime of the app session.
// Prevents double-fetch on repeated initWmsCapabilities() calls.
let bootPromise: Promise<void> | null = null;

/**
 * initWmsCapabilities() — Idempotent boot helper.
 *
 * Call once at app mount (App.tsx useEffect) AFTER authentication is confirmed.
 * Subsequent calls return the same promise (already-resolved on success).
 *
 * On network failure: sets fallback capabilities (all 4 render modes) and records
 * the error. The fallback matches the server's own fallback shape so the UI picker
 * stays fully usable regardless of probe outcome.
 */
export function initWmsCapabilities(): Promise<void> {
  // If already initializing or complete, return existing promise
  if (bootPromise) return bootPromise;
  const store = useWmsCapabilitiesStore.getState();
  // If capabilities are already set (e.g., from a previous boot in same session), skip
  if (store.capabilities) return Promise.resolve();

  store._setLoading(true);
  bootPromise = fetchWmsCapabilities()
    .then((c) => {
      useWmsCapabilitiesStore.getState()._setCapabilities(c);
    })
    .catch((e) => {
      // Network failure — server was unreachable or returned non-OK.
      // Set fallback (all 4 render modes) so the UI picker stays fully usable.
      // Note: the server-side getCachedCapabilities() already returns a fallback JSON
      // on probe failure, so this catch handles the rarer case of the server itself
      // being down (complete network error or non-2xx without a capabilities shape).
      console.error("initWmsCapabilities failed", e);
      useWmsCapabilitiesStore.getState()._setCapabilities({
        renderModes: ["raster", "heatmap", "classbreak", "contour"],
        // Full Kinetica colormap catalog — mirrors COLORMAP_GROUPS in
        // src/components/charts/KineticaWmsLayerForm.tsx. When the
        // server's capability probe fails entirely, the fallback declares the
        // full docs-canonical set is supported. `cividis`/`turbo` are NOT in
        // Kinetica's WMS docs and are excluded.
        colormaps: [
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
        ],
        spatialModes: ["latlon", "wkt", "wkb"],
        srs: ["EPSG:3857"],
        source: "fallback",
      });
      useWmsCapabilitiesStore.getState()._setError(String(e));
    });
  return bootPromise;
}

/**
 * __resetWmsCapabilitiesBootForTest() — Test helper.
 *
 * Resets the module-scoped bootPromise so re-initialization can occur in the next test.
 * The Zustand store-reset shim handles store state; this handles the bootPromise sentinel.
 *
 * Call in beforeEach() alongside vi.clearAllMocks() in spec files that test initWmsCapabilities.
 */
export function __resetWmsCapabilitiesBootForTest(): void {
  bootPromise = null;
}
