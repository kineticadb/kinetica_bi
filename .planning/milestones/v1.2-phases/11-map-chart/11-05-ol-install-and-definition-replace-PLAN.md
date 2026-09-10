---
phase: 11-map-chart
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/package.json
  - kinetica_bi/package-lock.json
  - kinetica_bi/src/components/charts/definitions/map.ts
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - MAP-01
  - MAP-02
  - MAP-03
  - MAP-04
must_haves:
  truths:
    - "ol@^10.5.0 is installed in kinetica_bi/package.json dependencies"
    - "definitions/map.ts no longer references the legacy stub fields (color/markerSize/centerLat/centerLon/zoom)"
    - "definitions/map.ts retains type, label, icon, usesAggregation: false; supportsDrillDown is intentionally unset"
    - "global.css has all .widget-map-* and .config-* classes per UI-SPEC.md Component Inventory"
    - "Bundle size delta from ol is measured and recorded in the plan summary (informs React.lazy decision)"
  artifacts:
    - path: "kinetica_bi/package.json"
      provides: "ol@^10.5.0 in dependencies"
      contains: "\"ol\":"
    - path: "kinetica_bi/src/components/charts/definitions/map.ts"
      provides: "Replaced ChartTypeDefinition for the map type — minimal schema, owns rendering via CustomConfigPanel"
      contains: "type: \"map\""
    - path: "kinetica_bi/src/styles/global.css"
      provides: "Phase 11 net-new CSS classes per UI-SPEC.md Component Inventory"
      contains: ".widget-map\\b"
  key_links:
    - from: "kinetica_bi/package.json"
      to: "kinetica_bi/node_modules/ol"
      via: "npm install"
      pattern: "\"ol\":"
    - from: "kinetica_bi/src/styles/global.css (.widget-map* + .config-* classes)"
      to: "Wave 3 MapChartRenderer.tsx + MapConfigPanel.tsx"
      via: "className references"
      pattern: "widget-map|config-spatial-mode|config-render-mode|config-classbreak|config-basemap"
---

<objective>
Install OpenLayers v10, replace the legacy `definitions/map.ts` stub with the new minimal schema (since `MapConfigPanel.tsx` will own all configuration via the CustomConfigPanel slot), and ship the Phase 11 CSS classes locked by `11-UI-SPEC.md` Component Inventory. This is INFRASTRUCTURE-only — no React components or WMS code in this plan; Waves 3+ build on top.

Purpose: Three independent infrastructure pieces that gate Wave 3. Bundling them in one plan keeps Wave 2 wide-parallel (this plan + 11-03 + 11-04 all run simultaneously, no shared files except none — verified file-ownership disjoint). Bundle-size measurement informs the `React.lazy` decision documented in CONTEXT.md "Claude's Discretion".

Output: ol@^10.5.0 installed, definitions/map.ts replaced, ~14 CSS classes added to global.css per UI-SPEC.md, bundle-size measurement.
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
@.planning/phases/11-map-chart/11-UI-SPEC.md
@kinetica_bi/package.json
@kinetica_bi/src/components/charts/definitions/map.ts
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/styles/global.css

<interfaces>
<!-- Existing ChartTypeDefinition interface (kinetica_bi/src/components/charts/registry.ts) -->
```typescript
export type ChartTypeDefinition = {
  type: ChartType;
  label: string;
  icon?: string;
  fields: ChartField[];
  defaultConfig: Record<string, unknown>;
  usesAggregation?: boolean;
  supportsDrillDown?: boolean;
  CustomConfigPanel?: React.ComponentType<CustomConfigPanelProps>;
  CustomRenderer?: React.ComponentType<...>;
};
```

<!-- Current stub (kinetica_bi/src/components/charts/definitions/map.ts) — ALL fields below are removed: -->
```typescript
fields: [
  { key: "color", label: "Marker Color", type: "color", defaultValue: "#38bdf8", group: "Appearance" },
  { key: "markerSize", label: "Marker Size", type: "range", defaultValue: 6, ... },
  { key: "centerLat", label: "Center Latitude", type: "number", defaultValue: 0, ... },
  { key: "centerLon", label: "Center Longitude", type: "number", defaultValue: 0, ... },
  { key: "zoom", label: "Zoom Level", type: "range", defaultValue: 3, ... },
],
defaultConfig: { color: "#38bdf8", markerSize: 6, centerLat: 0, centerLon: 0, zoom: 3 },
```

<!-- Target Phase 11 shape — minimal because MapConfigPanel owns all UI: -->
```typescript
const map: ChartTypeDefinition = {
  type: "map",
  label: "Map",
  icon: "M",
  fields: [],                  // empty — CustomConfigPanel owns the schema
  defaultConfig: {
    spatialMode: "latlon",
    renderMode: "raster",
    basemap: "osm",
    pointColor: "FF3838",
    pointSize: 4,
    pointOpacity: 100,
    blurRadius: 5,
    colormap: "viridis",
    cbBreakType: "numerical",
    classbreaks: [],
    contourColor: "FF0000",
    contourSmooth: true,
    contourBandwidth: 10,
  },
  usesAggregation: false,
  // supportsDrillDown intentionally unset — Phase 12 may flip
  // CustomConfigPanel will be wired in 11-07 (MapConfigPanel plan)
};
```

<!-- Phase 11 CSS classes (per UI-SPEC.md Component Inventory) -->
<!-- All classes added at end of global.css under a "/* Phase 11: Map Chart */" comment block -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install ol@^10.5.0 + measure bundle size delta</name>
  <files>kinetica_bi/package.json, kinetica_bi/package-lock.json</files>
  <read_first>
    - kinetica_bi/package.json (current dependencies block — confirm `ol` is NOT yet listed)
    - .planning/phases/11-map-chart/11-RESEARCH.md ("Standard Stack" + "Installation" — version pin and verification notes)
    - kinetica_bi/.gitignore (confirm node_modules and dist are ignored — they should be)
  </read_first>
  <action>
    Run from the frontend dir:
    ```bash
    cd kinetica_bi && npm install ol@^10.5.0
    ```

    Verify:
    1. `kinetica_bi/package.json` `dependencies` now includes `"ol": "^10.5.0"` (or whatever caret-resolved version, e.g. `^10.9.0` if npm picked the latest minor)
    2. `kinetica_bi/package-lock.json` updated
    3. `kinetica_bi/node_modules/ol/package.json` exists and reports its actual installed version

    Measure bundle size:
    ```bash
    cd kinetica_bi && npm run build 2>&1 | tee /tmp/build-with-ol.log
    ```
    Capture the largest chunk size from the build output (Vite reports chunk sizes). Compare with the build size BEFORE ol was added (record from the largest pre-existing JS chunk in dist — if a `dist/` doesn't exist, run `git stash`, `npm run build`, capture, `git stash pop`, then add ol and rebuild).

    Record the delta in your task summary. The threshold from CONTEXT.md "Claude's Discretion" is: if delta > ~200 KB gzipped, recommend `React.lazy` for `MapChartRenderer` in 11-06. If delta is ~120-150 KB gzipped (research estimate), `React.lazy` is OPTIONAL.

    Do NOT add `@types/ol` — types ship with `ol` v10 directly (RESEARCH.md STACK.md line 100 lock).

    Run a smoke import test: create a temporary file `/tmp/smoke-ol.ts`:
    ```typescript
    import Map from "ol/Map";
    import View from "ol/View";
    import TileLayer from "ol/layer/Tile";
    import OSM from "ol/source/OSM";
    import TileWMS from "ol/source/TileWMS";
    import XYZ from "ol/source/XYZ";
    import TileState from "ol/TileState";
    console.log("ol imports OK", { Map, View, TileLayer, OSM, TileWMS, XYZ, TileState });
    ```
    Run `cd kinetica_bi && npx tsc --noEmit /tmp/smoke-ol.ts`. Must compile cleanly — confirms the type-resolution path. Delete the file when done.
  </action>
  <acceptance_criteria>
    - `grep -c "\"ol\":" kinetica_bi/package.json` returns at least 1 (in dependencies block)
    - `kinetica_bi/node_modules/ol/package.json` exists and `node -e "console.log(require('./kinetica_bi/node_modules/ol/package.json').version)"` outputs a version starting with `10.`
    - `cd kinetica_bi && npm run build` exits 0 (build is unbroken by the new dep)
    - The temporary smoke-import test compiles via `tsc --noEmit` (no `Cannot find module 'ol/...'` errors)
    - `grep "@types/ol" kinetica_bi/package.json` returns 0 lines (NOT installed)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && grep "\"ol\":" package.json && npm run build > /tmp/build-with-ol.log 2>&1 && test -d node_modules/ol</automated>
  </verify>
  <done>ol@10.x installed; build succeeds; type-resolution verified; bundle delta measured and noted for the React.lazy decision.</done>
</task>

<task type="auto">
  <name>Task 2: Replace definitions/map.ts with the Phase 11 minimal schema</name>
  <files>kinetica_bi/src/components/charts/definitions/map.ts</files>
  <read_first>
    - kinetica_bi/src/components/charts/definitions/map.ts (current stub — every field below is REMOVED)
    - kinetica_bi/src/components/charts/registry.ts (ChartTypeDefinition interface — defaultConfig field shape)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Render-mode config UX" — what definitions/map.ts retains: type, label, icon, usesAggregation: false; what is REMOVED: color/markerSize/centerLat/centerLon/zoom)
    - .planning/phases/11-map-chart/11-UI-SPEC.md (defaults for spatial/render mode pickers)
    - kinetica_bi/src/components/charts/definitions/index.ts (confirm registerMap is already wired — should NOT need modification)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (confirm CustomConfigPanel branch exists and routes by chartDef.CustomConfigPanel — should already exist per CONTEXT.md)
  </read_first>
  <action>
    Replace the entire contents of `kinetica_bi/src/components/charts/definitions/map.ts` with:

    ```typescript
    import { registerChartType, type ChartTypeDefinition } from "../registry";

    // Phase 11: Map chart type — minimal definition.
    // CONTEXT.md "Decisions § Render-mode config UX" lock:
    //   - Stub fields (color/markerSize/centerLat/centerLon/zoom) deleted entirely.
    //   - CustomConfigPanel owns the new schema (wired in plan 11-07: MapConfigPanel).
    //   - usesAggregation: false — WMS is the data path, NOT aggregated SQL.
    //   - supportsDrillDown intentionally unset — Phase 12 (IDENT-02) decides; per Phase 10 lock.

    const map: ChartTypeDefinition = {
      type: "map",
      label: "Map",
      icon: "M",
      fields: [], // Empty — CustomConfigPanel (MapConfigPanel) owns the entire config schema.
      defaultConfig: {
        // Spatial defaults
        spatialMode: "latlon",
        latColumn: "",
        lonColumn: "",
        wktColumn: "",
        wkbColumn: "",
        // Render defaults
        renderMode: "raster",
        // Raster defaults
        pointColor: "FF3838",
        pointSize: 4,
        pointOpacity: 100,
        // Heatmap defaults
        blurRadius: 5,
        colormap: "viridis",
        // Classbreak defaults
        cbColumn: "",
        cbBreakType: "numerical",
        classbreaks: [],
        // Contour defaults
        contourColor: "FF0000",
        contourSmooth: true,
        contourBandwidth: 10,
        // Basemap default
        basemap: "osm",
      },
      usesAggregation: false,
      // supportsDrillDown intentionally unset — see comment above.
      // CustomConfigPanel attached in 11-07 to keep this file dependency-free until MapConfigPanel.tsx exists.
    };

    export default function register() {
      registerChartType(map);
    }
    ```

    Verify the file compiles cleanly: `cd kinetica_bi && npx tsc --noEmit`. The TypeScript should accept this even though `CustomConfigPanel` is missing — it's optional in `ChartTypeDefinition`.

    Run `cd kinetica_bi && npx vitest run` — all existing tests must pass. The change is config-only; no test should break.

    Note: This task does NOT yet ATTACH `CustomConfigPanel: MapConfigPanel`; that happens in 11-07 once `MapConfigPanel.tsx` exists. Without the attachment, the existing `ChartConfigPanel.tsx` falls back to rendering an empty `fields: []` config — which is fine because the user shouldn't be configuring a map widget in the live UI until 11-07 ships. If a user attempts to configure a map in dev between 11-05 and 11-07, the panel renders empty (visible regression, but ephemeral; clear for QA).
  </action>
  <acceptance_criteria>
    - `grep -c "fields: \\[\\]" kinetica_bi/src/components/charts/definitions/map.ts` returns 1 (empty fields array)
    - `grep -c "color: \"#38bdf8\"\|markerSize\|centerLat\|centerLon" kinetica_bi/src/components/charts/definitions/map.ts` returns 0 (legacy fields fully removed)
    - `grep "spatialMode: \"latlon\"\|renderMode: \"raster\"\|basemap: \"osm\"" kinetica_bi/src/components/charts/definitions/map.ts | wc -l` returns 3
    - `grep "usesAggregation: false" kinetica_bi/src/components/charts/definitions/map.ts` returns 1
    - `grep "supportsDrillDown" kinetica_bi/src/components/charts/definitions/map.ts` returns 0 (intentionally unset per Phase 10 lock)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx vitest run` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run</automated>
  </verify>
  <done>definitions/map.ts replaced; legacy fields gone; minimal schema in place; CustomConfigPanel attachment deferred to 11-07.</done>
</task>

<task type="auto">
  <name>Task 3: Add Phase 11 CSS classes to global.css per UI-SPEC.md</name>
  <files>kinetica_bi/src/styles/global.css</files>
  <read_first>
    - .planning/phases/11-map-chart/11-UI-SPEC.md (Component Inventory § "New CSS classes" — every class to add with exact properties; Spacing Scale § "Phase 11 strict 4-multiples"; Color § "Accent reserved-for list")
    - kinetica_bi/src/styles/global.css (full file — locate `:root` block at top; locate `.widget-card`/`.config-panel`/`.toast` patterns to mirror; identify the END of the file for the new classes block)
  </read_first>
  <action>
    Append to the END of `kinetica_bi/src/styles/global.css`:

    ```css
    /* ============================================
       Phase 11: Map Chart
       Source: .planning/phases/11-map-chart/11-UI-SPEC.md Component Inventory
       Spacing: strict multiples of 4 (4/8/12/16/20/24)
       Color: --bg / --panel / --card / --border / --accent / --muted / #ef4444 (destructive)
       ============================================ */

    /* Widget-body content for map */
    .widget-map {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 240px; /* Phase 11 spacing scale: multiple of 4 */
    }

    .widget-map-canvas {
      width: 100%;
      height: 100%;
      background: #0b1224; /* matches .config-color-text deep-panel tone */
    }

    .widget-map-toolbar {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 8px;
      z-index: 1;
    }

    .widget-map-toolbar-btn {
      padding: 8px 12px;
      background: rgba(11, 18, 36, 0.85);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 13px;
      backdrop-filter: blur(6px);
      cursor: pointer;
      min-width: 36px;
      min-height: 36px;
    }
    .widget-map-toolbar-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .widget-map-empty {
      /* Reuses .widget-placeholder layout — copy applied via Copywriting Contract */
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
      pointer-events: none;
    }

    .widget-map-error {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--panel);
      border: 1px solid rgba(239, 68, 68, 0.45);
      border-left: 4px solid #ef4444;
      border-radius: 8px;
      padding: 16px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 320px;
      z-index: 2;
    }

    .widget-map-error-title {
      font-size: 13px;
      font-weight: 600;
      color: #ef4444;
    }

    .widget-map-error-body {
      font-size: 13px;
      color: var(--text);
      line-height: 1.5;
    }

    .widget-map-error-retry {
      align-self: flex-start;
    }

    /* Tile fade-in (M-03 loading affordance) — applied to the WMS layer's canvas via OL Layer.className */
    .widget-map-tile {
      transition: opacity 200ms ease-out;
    }

    @media (prefers-reduced-motion: reduce) {
      .widget-map-tile {
        transition: none;
      }
    }

    /* Config panel: spatial-mode picker */
    .config-spatial-mode {
      /* Reuses .config-group shape — no extra rules needed beyond base; placeholder for future tweaks */
    }

    /* Config panel: render-mode picker */
    .config-render-mode {
      /* Reuses .config-group shape */
    }

    /* Config panel: classbreak builder */
    .config-classbreak-rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .config-classbreak-row {
      display: grid;
      grid-template-columns: 60px 1fr 36px 32px;
      gap: 8px;
      align-items: center;
    }

    .config-classbreak-row-label {
      font-size: 12px;
      color: var(--muted);
      font-weight: 500;
    }

    .config-classbreak-add {
      align-self: flex-start;
    }

    /* Cardinality warn / hard-cap hint (extends .config-hint with semantic color) */
    .config-cardinality-warn {
      color: var(--accent);
    }
    .config-cardinality-cap {
      color: #ef4444;
    }

    /* Config panel: basemap selector */
    .config-basemap {
      /* Reuses .config-group shape */
    }
    ```

    Verify with `cd kinetica_bi && npm run build`. Build must succeed — Vite catches CSS syntax errors at build time.

    Run `cd kinetica_bi && npx vitest run`. All tests still pass (no test asserts on these classes yet — those land in Wave 3 specs).

    DO NOT modify `:root`, `.widget-card`, `.widget-body`, `.config-panel`, `.config-panel-body`, `.config-group`, `.config-group-label`, `.toast`, or any pre-existing class. Phase 11 ADDS classes; it does not modify existing ones.
  </action>
  <acceptance_criteria>
    - `grep -c "/\\* ===.*Phase 11: Map Chart" kinetica_bi/src/styles/global.css` returns 1 (the section header)
    - `grep -E "^\\.widget-map\\b|^\\.widget-map-canvas|^\\.widget-map-toolbar|^\\.widget-map-toolbar-btn|^\\.widget-map-empty|^\\.widget-map-error|^\\.widget-map-error-title|^\\.widget-map-error-body|^\\.widget-map-error-retry|^\\.widget-map-tile|^\\.config-spatial-mode|^\\.config-render-mode|^\\.config-classbreak-rows|^\\.config-classbreak-row|^\\.config-classbreak-add|^\\.config-cardinality-warn|^\\.config-cardinality-cap|^\\.config-basemap" kinetica_bi/src/styles/global.css | wc -l` returns ≥ 16
    - `grep "min-height: 240px" kinetica_bi/src/styles/global.css` returns 1 (UI-SPEC.md min-height lock)
    - `grep "transition: opacity 200ms" kinetica_bi/src/styles/global.css` returns 1 (tile fade-in lock)
    - `grep "@media (prefers-reduced-motion: reduce)" kinetica_bi/src/styles/global.css` returns ≥ 1 (a11y lock from UI-SPEC.md "Reduced motion")
    - `grep "border-left: 4px solid #ef4444" kinetica_bi/src/styles/global.css` returns 1 (error-overlay border-left)
    - No existing class is modified — verify by `git diff kinetica_bi/src/styles/global.css | grep "^-"` (should show 0 deletions)
    - `cd kinetica_bi && npm run build` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npm run build > /tmp/build-css.log 2>&1 && grep -c "Phase 11: Map Chart" src/styles/global.css</automated>
  </verify>
  <done>~17 net-new CSS classes added in a single block at the end of global.css; reduced-motion media query honored; no existing class modified; production build still works.</done>
</task>

</tasks>

<verification>
- `ol` listed in `kinetica_bi/package.json` dependencies; `node_modules/ol` populated.
- `definitions/map.ts` cleaned of legacy fields; minimal schema with Phase 11 defaults.
- `global.css` extended with Phase 11 class block + reduced-motion media query.
- Production build (`npm run build`) succeeds.
- Test suite (`npx vitest run`) remains green.
- Bundle-size delta measured and documented in plan summary.
</verification>

<success_criteria>
- Wave 3 plans (11-06, 11-07) can `import Map from "ol/Map"` without setup work.
- Wave 3 plans can reference `.widget-map-*` and `.config-*` classes that ship in this plan.
- definitions/map.ts is in a state where 11-07 can attach `CustomConfigPanel: MapConfigPanel` with a one-line edit.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-05-SUMMARY.md` summarizing:
- Installed ol version (e.g. 10.9.0)
- Bundle-size delta (gzipped pre/post — measured)
- React.lazy recommendation for 11-06 based on delta (use it if >200 KB gzipped, optional otherwise)
- Count of CSS classes added
- Confirmation that no existing class was modified
</output>
