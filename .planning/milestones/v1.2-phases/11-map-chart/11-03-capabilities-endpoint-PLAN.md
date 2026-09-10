---
phase: 11-map-chart
plan: 03
type: execute
wave: 2
depends_on:
  - 11-01
files_modified:
  - kinetica_bi/server/src/index.ts
  - kinetica_bi/server/src/wmsCapabilities.ts
  - kinetica_bi/server/src/wmsCapabilities.spec.ts
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/store/wmsCapabilities.ts
  - kinetica_bi/src/store/wmsCapabilities.spec.ts
autonomous: true
requirements:
  - MAP-01
  - MAP-02
must_haves:
  truths:
    - "GET /api/wms/capabilities returns JSON with renderModes[], colormaps[], spatialModes[]"
    - "Server caches the parsed capabilities in-process at first hit (or boot) so subsequent calls don't re-fetch from Kinetica"
    - "The frontend can call fetchWmsCapabilities() once at app boot and gate config-panel options against the result"
    - "If the capabilities probe fails, the frontend store falls back to assuming all four render modes work (graceful degradation)"
  artifacts:
    - path: "kinetica_bi/server/src/wmsCapabilities.ts"
      provides: "parseWmsCapabilities(xml: string) and getCachedCapabilities() helpers"
      exports:
        - "parseWmsCapabilities"
        - "getCachedCapabilities"
        - "WmsCapabilities"
    - path: "kinetica_bi/server/src/index.ts"
      provides: "GET /api/wms/capabilities Express route"
      contains: "app.get(\"/api/wms/capabilities\""
    - path: "kinetica_bi/src/api/client.ts"
      provides: "fetchWmsCapabilities() exported client function"
      exports:
        - "fetchWmsCapabilities"
        - "WmsCapabilitiesDto"
    - path: "kinetica_bi/src/store/wmsCapabilities.ts"
      provides: "useWmsCapabilitiesStore Zustand slice + initWmsCapabilities() bootstrap"
      exports:
        - "useWmsCapabilitiesStore"
        - "initWmsCapabilities"
  key_links:
    - from: "kinetica_bi/src/store/wmsCapabilities.ts (initWmsCapabilities)"
      to: "kinetica_bi/src/api/client.ts (fetchWmsCapabilities)"
      via: "named import + call at app boot from App.tsx useEffect"
      pattern: "fetchWmsCapabilities\\(\\)"
    - from: "MapConfigPanel.tsx (Wave 3)"
      to: "useWmsCapabilitiesStore"
      via: "selector to gate render-mode picker options"
      pattern: "useWmsCapabilitiesStore"
---

<objective>
Build the `/api/wms/capabilities` endpoint that probes Kinetica's GetCapabilities response server-side, parses it, caches the result, and serves a stable JSON shape to the frontend. Add a Zustand store + client function so `MapConfigPanel.tsx` (Wave 3) can read capabilities without re-probing.

Purpose: CONTEXT.md "Decisions § Spatial-column-mode picker (MAP-02)" locks "Hide unsupported modes from the picker — driven by `/api/wms/capabilities` probe at boot. Fall back to assuming all four modes work if probe fails." This plan delivers that infrastructure end-to-end.

Output: New server-side parser + route handler, frontend client function, Zustand store with bootstrap helper, and tests for both server + frontend pieces.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-RESEARCH.md
@.planning/phases/11-map-chart/11-SPIKE-NOTES.md
@kinetica_bi/server/src/index.ts
@kinetica_bi/server/src/kinetica.ts
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/store/filterStore.ts

<interfaces>
<!-- Server: existing /api/wms route at index.ts:659 — pattern to mirror for /api/wms/capabilities -->
```typescript
app.get("/api/wms", requireConfig, asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store"); // (added in 11-01)
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const response = await kineticaWms(req as AuthedRequest, queryString, { route: "GET /api/wms" });
  // ... pipes response
}));
```

<!-- Frontend: existing client pattern (kinetica_bi/src/api/client.ts) -->
```typescript
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
export async function listDashboards(): Promise<DashboardDto[]> {
  const response = await apiFetch(`${API_BASE}/api/dashboards`);
  if (!response.ok) throw new Error(`listDashboards failed: ${response.status}`);
  return response.json();
}
```

<!-- Frontend: Zustand store pattern (kinetica_bi/src/store/filterStore.ts) -->
```typescript
import { create } from "zustand";
export const useFilterStore = create<FilterState>((set, get) => ({ /* ... */ }));
```

<!-- Target shape for /api/wms/capabilities response: -->
```typescript
type WmsCapabilities = {
  renderModes: ("raster" | "heatmap" | "classbreak" | "contour")[];
  colormaps: string[];
  spatialModes: ("latlon" | "wkt" | "wkb")[];
  srs: string[];
  source: "probed" | "fallback";
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Server — parseWmsCapabilities + getCachedCapabilities + spec</name>
  <files>kinetica_bi/server/src/wmsCapabilities.ts, kinetica_bi/server/src/wmsCapabilities.spec.ts</files>
  <read_first>
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md (the parsed values from Wave 1 — this parser must produce the same shape)
    - kinetica_bi/server/src/wmsCapabilities.xml (raw GetCapabilities XML fixture from 11-01 Task 2 — used as test fixture)
    - kinetica_bi/server/src/kinetica.ts (existing kineticaWms helper for the probe call pattern)
    - kinetica_bi/server/package.json (to confirm what XML parser is available; if none, plan adds `fast-xml-parser` as a dep)
  </read_first>
  <behavior>
    `parseWmsCapabilities(xml: string): WmsCapabilities`
    - Extracts `renderModes` from `<Style><Name>...</Name>` entries; intersects with `["raster", "heatmap", "classbreak", "contour"]` (ignore unknown styles).
    - Extracts `colormaps` from a Kinetica-specific `<Colormap>` or `<MetadataURL>` entry — exact element name documented in SPIKE-NOTES.md. If absent, defaults to `["viridis", "plasma", "inferno", "magma", "cividis", "turbo", "jet", "hot"]`.
    - Extracts `spatialModes` — Kinetica GetCapabilities does NOT explicitly enumerate these; default to `["latlon", "wkt", "wkb"]` (all three; the picker uses Phase 10 `getValidSpatialColumns` to filter at runtime).
    - Extracts `srs` from `<SRS>` elements; intersects with `["EPSG:3857", "EPSG:900913", "EPSG:4326"]`.
    - Returns `{ renderModes, colormaps, spatialModes, srs, source: "probed" }`.

    `getCachedCapabilities(): Promise<WmsCapabilities>`
    - In-process cache: module-scoped `let cached: WmsCapabilities | null = null;`.
    - First call: invokes `kineticaWms` (or a raw `fetch` if a service-account token strategy is established) with `?SERVICE=WMS&REQUEST=GetCapabilities`, parses XML, caches.
    - Subsequent calls: returns cached value.
    - On probe failure (timeout, 502, parse error): returns `{ renderModes: ["raster", "heatmap", "classbreak", "contour"], colormaps: [...defaults], spatialModes: ["latlon", "wkt", "wkb"], srs: ["EPSG:3857"], source: "fallback" }`. Logs the error to `console.error("WMS capabilities probe failed", err)`.

    NOTE on auth: GetCapabilities is typically anonymous on Kinetica WMS; if it requires auth, this helper uses a service-account token from env (`KINETICA_USERNAME` + `KINETICA_PASSWORD` — same vars the existing `kineticaWms` helper consumes for its non-OIDC fallback path). Confirm against SPIKE-NOTES.md whether GetCapabilities required Basic auth.

    Tests (using vitest + the captured `wmsCapabilities.xml` fixture):
    - `parseWmsCapabilities(<fixture xml>) returns the expected renderModes intersected with [raster, heatmap, classbreak, contour]`
    - `parseWmsCapabilities(<xml with no <Style> elements>) returns renderModes: []`
    - `parseWmsCapabilities(<xml>) extracts SRS values`
    - `parseWmsCapabilities("<malformed>") throws or returns fallback shape — pick one and document`
    - `getCachedCapabilities() caches: second call does NOT invoke fetch` (mock fetch, assert call count = 1 across two awaits)
    - `getCachedCapabilities() returns fallback shape when fetch rejects` — assert `result.source === "fallback"` and `renderModes.length === 4`
  </behavior>
  <action>
    Step 1: Confirm or install XML parser:
    ```bash
    cd kinetica_bi/server && grep "fast-xml-parser\|xml2js" package.json
    ```
    If neither is present, run `cd kinetica_bi/server && npm install fast-xml-parser@^4`. Use `fast-xml-parser` (smaller + better TypeScript types than xml2js).

    Step 2: Create `kinetica_bi/server/src/wmsCapabilities.ts` with the two exports + the inline `WmsCapabilities` type. Use `fast-xml-parser`'s `XMLParser` class. Use `kineticaWms` for the upstream call IF GetCapabilities accepts the same auth flow as GetMap (verified in SPIKE-NOTES.md); otherwise inline a raw `fetch` with Basic auth from env (mirroring `kineticaWms`'s non-OIDC branch).

    Step 3: Create `kinetica_bi/server/src/wmsCapabilities.spec.ts`. Use the `wmsCapabilities.xml` fixture from 11-01. If the fixture is absent (spike was network-blocked), use a hand-written minimal XML fixture inline in the spec — document this clearly with `// SPIKE-FIXTURE-FALLBACK: spike was blocked; inline-XML reflects best-known shape`.

    Step 4: Run `cd kinetica_bi/server && npm test -- wmsCapabilities.spec`. All ≥6 tests pass.

    DO NOT add the route handler in this task (Task 2 owns it). DO NOT modify `kineticaWms` (helper unchanged).
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/wmsCapabilities.ts` exists and exports `parseWmsCapabilities`, `getCachedCapabilities`, and a `WmsCapabilities` type
    - `grep -c "export function parseWmsCapabilities\|export async function getCachedCapabilities\|export type WmsCapabilities" kinetica_bi/server/src/wmsCapabilities.ts` returns 3
    - `kinetica_bi/server/src/wmsCapabilities.spec.ts` contains ≥ 6 `it(` cases
    - `cd kinetica_bi/server && npm test -- wmsCapabilities.spec` exits 0
    - `kinetica_bi/server/package.json` lists `fast-xml-parser` in `dependencies`
    - Module-level `let cached: WmsCapabilities | null = null` declared (verifies in-process cache, not just function-local)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npm test -- wmsCapabilities.spec</automated>
  </verify>
  <done>Parser + cached probe helper exported with passing tests; the helper falls back gracefully when probe fails.</done>
</task>

<task type="auto">
  <name>Task 2: Server — GET /api/wms/capabilities route + spec</name>
  <files>kinetica_bi/server/src/index.ts, kinetica_bi/server/src/index.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/index.ts (lines 655-680: existing /api/wms route — sibling pattern to mirror)
    - kinetica_bi/server/src/wmsCapabilities.ts (the helpers from Task 1)
    - kinetica_bi/server/src/index.spec.ts (existing spec from 11-01 — append, do NOT replace)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Hide unsupported modes" — short-lived browser cache ~5 min is reasonable; planner picks Cache-Control header)
  </read_first>
  <action>
    In `kinetica_bi/server/src/index.ts`:

    1. Add an import at the top: `import { getCachedCapabilities } from "./wmsCapabilities";`
    2. Add a new route handler IMMEDIATELY AFTER the `/api/wms` route (around line 680) — keep WMS routes adjacent for grep-ability:

       ```typescript
       app.get("/api/wms/capabilities", requireConfig, asyncHandler(async (req, res) => {
         // M-08-adjacent lock: short browser cache (5 min) since deployed Kinetica capabilities
         // rarely change at runtime. If capabilities change, an app reload picks them up.
         res.setHeader("Cache-Control", "private, max-age=300");
         try {
           const capabilities = await getCachedCapabilities();
           res.json(capabilities);
         } catch (err) {
           console.error("WMS capabilities probe failed", err);
           // Graceful degradation: return fallback shape with all modes assumed supported.
           res.json({
             renderModes: ["raster", "heatmap", "classbreak", "contour"],
             colormaps: ["viridis", "plasma", "inferno", "magma", "cividis", "turbo", "jet", "hot"],
             spatialModes: ["latlon", "wkt", "wkb"],
             srs: ["EPSG:3857"],
             source: "fallback",
           });
         }
       }));
       ```

       Note: `getCachedCapabilities` already returns the fallback shape on internal failure; the outer try/catch is defense-in-depth for unexpected errors (e.g. parser exception).

    3. Add 2 supertest cases to `kinetica_bi/server/src/index.spec.ts`:
       - `"GET /api/wms/capabilities returns JSON with renderModes, colormaps, spatialModes, srs, source fields"` — mock `getCachedCapabilities` to return a fixed shape; assert response shape
       - `"GET /api/wms/capabilities sets Cache-Control: private, max-age=300"` — assert `headers["cache-control"] === "private, max-age=300"`

    Run: `cd kinetica_bi/server && npm test -- index.spec`. All previous + 2 new pass.
  </action>
  <acceptance_criteria>
    - `grep -n 'app.get("/api/wms/capabilities"' kinetica_bi/server/src/index.ts` returns exactly 1 match
    - `grep -n "private, max-age=300" kinetica_bi/server/src/index.ts` returns 1 match (the capabilities route header)
    - `grep -n 'import.*getCachedCapabilities.*from "./wmsCapabilities"' kinetica_bi/server/src/index.ts` returns 1 match
    - `kinetica_bi/server/src/index.spec.ts` contains the literal test names listed in `<action>`
    - `cd kinetica_bi/server && npm test -- index.spec` exits 0 with the new tests passing alongside the 11-01 `Cache-Control: no-store` tests
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npm test -- index.spec</automated>
  </verify>
  <done>Route handler shipped + tested + browser-cache-friendly; degrades gracefully on probe failure.</done>
</task>

<task type="auto">
  <name>Task 3: Frontend — fetchWmsCapabilities client + useWmsCapabilitiesStore + boot wiring + spec</name>
  <files>kinetica_bi/src/api/client.ts, kinetica_bi/src/store/wmsCapabilities.ts, kinetica_bi/src/store/wmsCapabilities.spec.ts, kinetica_bi/src/App.tsx</files>
  <read_first>
    - kinetica_bi/src/api/client.ts (full file: existing patterns for typed errors, apiFetch, listDashboards/listTables shape — mirror exactly)
    - kinetica_bi/src/store/filterStore.ts (Zustand store pattern + Phase 9 store-reset shim integration)
    - kinetica_bi/src/test/setup.ts (Zustand store-reset shim — confirms store-reset shim auto-resets useWmsCapabilitiesStore between tests if it follows the same module-scope pattern)
    - kinetica_bi/__mocks__/zustand.ts (the shim itself)
    - kinetica_bi/src/App.tsx (where `initWmsCapabilities()` should fire — once on app mount, not per-route)
  </read_first>
  <action>
    Step 1 — `kinetica_bi/src/api/client.ts`: append to end of file:

    ```typescript
    // Phase 11: WMS capabilities probe (MAP-01, MAP-02)
    export type WmsCapabilitiesDto = {
      renderModes: ("raster" | "heatmap" | "classbreak" | "contour")[];
      colormaps: string[];
      spatialModes: ("latlon" | "wkt" | "wkb")[];
      srs: string[];
      source: "probed" | "fallback";
    };

    export async function fetchWmsCapabilities(
      signal?: AbortSignal
    ): Promise<WmsCapabilitiesDto> {
      const response = await apiFetch(`${API_BASE}/api/wms/capabilities`, { signal });
      if (!response.ok) {
        throw new Error(`fetchWmsCapabilities failed: ${response.status}`);
      }
      return response.json() as Promise<WmsCapabilitiesDto>;
    }
    ```

    (Use `apiFetch` not raw `fetch` — for the existing REAUTH chain wiring.)

    Step 2 — Create `kinetica_bi/src/store/wmsCapabilities.ts`:

    ```typescript
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

    // Idempotent boot helper — safe to call multiple times; only fetches on first call.
    let bootPromise: Promise<void> | null = null;
    export function initWmsCapabilities(): Promise<void> {
      if (bootPromise) return bootPromise;
      const store = useWmsCapabilitiesStore.getState();
      if (store.capabilities) return Promise.resolve();
      store._setLoading(true);
      bootPromise = fetchWmsCapabilities()
        .then((c) => { useWmsCapabilitiesStore.getState()._setCapabilities(c); })
        .catch((e) => {
          // Graceful degradation — the server already returns a fallback shape on probe error,
          // so this catch is for network failures only. Set error AND assume all modes work.
          console.error("initWmsCapabilities failed", e);
          useWmsCapabilitiesStore.getState()._setCapabilities({
            renderModes: ["raster", "heatmap", "classbreak", "contour"],
            colormaps: ["viridis", "plasma", "inferno", "magma", "cividis", "turbo", "jet", "hot"],
            spatialModes: ["latlon", "wkt", "wkb"],
            srs: ["EPSG:3857"],
            source: "fallback",
          });
          useWmsCapabilitiesStore.getState()._setError(String(e));
        });
      return bootPromise;
    }

    // Test helper: reset boot state between tests (the Zustand store-reset shim handles store state;
    // this resets the module-scoped bootPromise so re-init can occur).
    export function __resetWmsCapabilitiesBootForTest(): void {
      bootPromise = null;
    }
    ```

    Step 3 — `kinetica_bi/src/App.tsx`: locate the existing top-level `useEffect` that fires on app mount (or add one if absent — mirror Phase 9's logout-driven filter-reset useEffect pattern). Add:

    ```typescript
    import { initWmsCapabilities } from "./store/wmsCapabilities";
    // ... inside App component body
    useEffect(() => {
      initWmsCapabilities();
    }, []);
    ```

    Place this AFTER any auth-status-gating effect so it only fires when the user is authenticated. If the existing `useEffect` already gates on `status === "authenticated"`, add `initWmsCapabilities()` to that same block.

    Step 4 — `kinetica_bi/src/store/wmsCapabilities.spec.ts`:

    ```typescript
    import { describe, it, expect, vi, beforeEach } from "vitest";
    // The Zustand store-reset shim runs before each test; the boot-promise reset is manual.
    import {
      useWmsCapabilitiesStore,
      initWmsCapabilities,
      __resetWmsCapabilitiesBootForTest,
    } from "./wmsCapabilities";

    vi.mock("../api/client", () => ({
      fetchWmsCapabilities: vi.fn(),
    }));

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
          renderModes: ["raster", "heatmap"],
          colormaps: ["viridis"],
          spatialModes: ["latlon", "wkt", "wkb"],
          srs: ["EPSG:3857"],
          source: "probed" as const,
        };
        (fetchWmsCapabilities as any).mockResolvedValue(mockCapabilities);
        await initWmsCapabilities();
        expect(useWmsCapabilitiesStore.getState().capabilities).toEqual(mockCapabilities);
        expect(useWmsCapabilitiesStore.getState().loading).toBe(false);
      });

      it("initWmsCapabilities is idempotent — second call does not re-fetch", async () => {
        (fetchWmsCapabilities as any).mockResolvedValue({
          renderModes: [], colormaps: [], spatialModes: [], srs: [], source: "probed" as const,
        });
        await initWmsCapabilities();
        await initWmsCapabilities();
        expect(fetchWmsCapabilities).toHaveBeenCalledTimes(1);
      });

      it("initWmsCapabilities falls back to all-modes shape on network error", async () => {
        (fetchWmsCapabilities as any).mockRejectedValue(new Error("network down"));
        await initWmsCapabilities();
        const c = useWmsCapabilitiesStore.getState().capabilities!;
        expect(c.source).toBe("fallback");
        expect(c.renderModes).toEqual(["raster", "heatmap", "classbreak", "contour"]);
      });
    });
    ```

    Step 5 — Run: `cd kinetica_bi && npx vitest run src/store/wmsCapabilities.spec.ts && npx vitest run`. All pass.

    Commit: `feat(11-03): add /api/wms/capabilities route + frontend store + boot wiring`.
  </action>
  <acceptance_criteria>
    - `grep -c "export.*fetchWmsCapabilities\|export type WmsCapabilitiesDto" kinetica_bi/src/api/client.ts` returns 2
    - `kinetica_bi/src/store/wmsCapabilities.ts` exists and exports `useWmsCapabilitiesStore`, `initWmsCapabilities`, `__resetWmsCapabilitiesBootForTest`
    - `kinetica_bi/src/store/wmsCapabilities.spec.ts` contains ≥ 4 `it(` cases
    - `grep "initWmsCapabilities" kinetica_bi/src/App.tsx` returns at least 1 match
    - `cd kinetica_bi && npx vitest run src/store/wmsCapabilities.spec.ts` exits 0
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/store/wmsCapabilities.spec.ts && npx vitest run</automated>
  </verify>
  <done>Frontend can call `useWmsCapabilitiesStore(s => s.capabilities)` and get the probed (or fallback) capabilities; boot wiring fires once per app session.</done>
</task>

</tasks>

<verification>
- Server route `/api/wms/capabilities` returns JSON with the locked shape; supertest spec verifies it.
- Server-side parser tested against fixture XML from 11-01.
- Frontend client + Zustand store + boot wiring shipped; idempotent on repeated `initWmsCapabilities()` calls.
- `cd kinetica_bi/server && npm test` and `cd kinetica_bi && npx vitest run` BOTH exit 0.
</verification>

<success_criteria>
- `MapConfigPanel.tsx` (Wave 3) can `const caps = useWmsCapabilitiesStore(s => s.capabilities)` and gate render-mode picker options.
- A blocked spike (11-01) does NOT block this plan: the fallback path returns all four modes so the picker stays usable.
- No test in the existing suite regresses.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-03-SUMMARY.md` summarizing:
- Route shape and Cache-Control policy on /api/wms/capabilities
- Parser behavior on the fixture XML (which renderModes/colormaps/srs were extracted)
- Client + store + boot-wiring location in App.tsx
- Whether `fast-xml-parser` was newly installed
</output>
