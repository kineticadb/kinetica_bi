---
phase: 11-map-chart
plan: 04
type: execute
wave: 2
depends_on:
  - 11-01
files_modified:
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts
autonomous: true
requirements:
  - MAP-01
  - MAP-02
  - FILT-04
must_haves:
  truths:
    - "Given a map widget config + filter version + WHERE clause, buildWmsParams returns a Record<string, string> with the correct param names per spike-locked spelling"
    - "Each render mode (raster, heatmap, classbreak, contour) produces a distinct STYLES value AND its mode-specific params"
    - "Each spatial mode (latlon, wkt, wkb) produces the correct spatial-column params (X_/Y_ for latlon, GEOMETRY_/GEO_ for wkt+wkb)"
    - "The filter param (QUERY or CQL_FILTER per spike) is set when whereClause is non-empty; absent otherwise"
    - "_v: filterVersion is ALWAYS included as a string for cache-busting (M-02 lock)"
  artifacts:
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "buildWmsParams(config, filterVersion, whereClause): Record<string, string> + MapWidgetConfig type"
      exports:
        - "buildWmsParams"
        - "MapWidgetConfig"
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.spec.ts"
      provides: "≥15 tests covering all renderMode×spatialMode combinations + filter param presence/absence + cache-buster"
      contains: "describe(\"buildWmsParams"
  key_links:
    - from: "src/lib/wmsUrlBuilder.ts"
      to: "MapChartRenderer.tsx (Wave 3)"
      via: "named import; called inside the filter-subscription useEffect to construct updateParams payload"
      pattern: "import.*buildWmsParams.* from .*wmsUrlBuilder"
    - from: "11-SPIKE-NOTES.md (param-name table)"
      to: "src/lib/wmsUrlBuilder.ts (constant declarations at top of file)"
      via: "verbatim copy of locked param names — the spike notes are the source of truth"
      pattern: "X_COLUMN_NAME|X_ATTR|GEOMETRY_COLUMN_NAME|GEO_ATTR|QUERY|CQL_FILTER"
---

<objective>
Build a pure function `buildWmsParams(config, filterVersion, whereClause): Record<string, string>` that transforms a map widget config into the WMS parameter dictionary OL's `TileWMS.updateParams()` consumes. This is the single sanctioned interpolation path between user config and outbound WMS URLs (mirrors Phase 9's "all SQL flows through `buildWhereClause`" lock at AP-3).

Purpose: Centralize the renderMode × spatialMode branching in ONE pure module that's easy to test exhaustively. The function is consumed by Wave 3's `MapChartRenderer.tsx` for both initial TileWMS construction AND filter-subscription `updateParams()` calls. M-02 locks `_v: filterVersion` as the cache-buster; M-04 locks the WKT vs WKB branch; M-05 locks the units-in-label rule (UI concern, not builder concern — this builder just emits the numeric value).

Output: One pure function file + comprehensive spec covering all 4 render modes × 3 spatial modes + filter presence + absence + edge cases.
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

<interfaces>
<!-- Type contract this plan creates: -->
```typescript
export type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";
export type SpatialMode = "latlon" | "wkt" | "wkb"; // re-exported from columnTypes for downstream convenience

export type ClassbreakBreak = { value: string | number; color: string }; // RRGGBB hex (no alpha — opacity handled at render-mode level if at all)

export type MapWidgetConfig = {
  tableId: number;
  // Spatial:
  spatialMode: SpatialMode;
  latColumn?: string;
  lonColumn?: string;
  wktColumn?: string;
  wkbColumn?: string;
  // Render:
  renderMode: RenderMode;
  // Raster params:
  pointColor?: string;       // RRGGBB hex (e.g. "FF3838")
  pointSize?: number;        // px (2-20)
  pointOpacity?: number;     // 0-100; serialized as alpha-suffix on POINTCOLOR or separate POINTOPACITY param per SPIKE-NOTES
  // Heatmap params:
  blurRadius?: number;       // Kinetica map units (M-05)
  colormap?: string;         // viridis | plasma | ...
  minLevel?: number;
  maxLevel?: number;
  // Classbreak params:
  cbColumn?: string;
  cbBreakType?: "categorical" | "numerical";
  classbreaks?: ClassbreakBreak[];
  // Contour params:
  contourColor?: string;     // RRGGBB hex
  contourSmooth?: boolean;
  contourBandwidth?: number; // Kinetica map units (M-05)
  // Layer:
  layerName?: string;        // schema.table — caller resolves; default to widget.tableRef
  // Basemap (handled outside this builder by MapChartRenderer; not in WMS params)
};

export function buildWmsParams(
  config: MapWidgetConfig,
  filterVersion: number,
  whereClause: string  // empty string when no filters; never null/undefined
): Record<string, string>;
```

<!-- Param name constants — pulled VERBATIM from 11-SPIKE-NOTES.md -->
```typescript
// Top of wmsUrlBuilder.ts — these constants reflect SPIKE-NOTES.md "Locked Parameter Names"
// IF SPIKE WAS BLOCKED: the executor MUST stop and CHECKPOINT before writing this file —
// the constants below cannot be guessed.
const X_COLUMN_PARAM = "<from SPIKE-NOTES — e.g. X_COLUMN_NAME or X_ATTR>";
const Y_COLUMN_PARAM = "<from SPIKE-NOTES>";
const GEOMETRY_COLUMN_PARAM = "<from SPIKE-NOTES>";
const FILTER_PARAM = "<from SPIKE-NOTES — QUERY or CQL_FILTER>";
const SRS_VALUE = "<from SPIKE-NOTES — EPSG:3857 if accepted>";
```

<!-- STYLES values per render mode — also from SPIKE-NOTES.md -->
```typescript
const STYLES_BY_MODE: Record<RenderMode, string> = {
  raster: "<from SPIKE-NOTES>",     // typically "point" or "raster"
  heatmap: "heatmap",
  classbreak: "classbreak",
  contour: "contour",
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: TDD — write spec for buildWmsParams covering all renderMode × spatialMode combos</name>
  <files>kinetica_bi/src/lib/wmsUrlBuilder.spec.ts</files>
  <read_first>
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md (the param-name table — every assertion in this spec uses these locked names)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Reference: Kinetica WMS Param Tables — for default values when SPIKE-NOTES is silent)
    - .planning/phases/11-map-chart/11-CONTEXT.md (Render-mode config UX — for default values per mode)
    - kinetica_bi/src/lib/columnTypes.ts (SpatialMode type from 11-02)
    - kinetica_bi/src/test/setup.ts (vitest config — confirms `src/**/*.spec.{ts,tsx}` glob picks this up)
  </read_first>
  <behavior>
    Test suite structure:

    `describe("buildWmsParams — base params")`:
    - `always emits SERVICE=WMS, VERSION=1.1.1, REQUEST=GetMap, FORMAT=image/png, TRANSPARENT=true`
    - `emits SRS=<spike value>` (asserts against the locked SRS — typically EPSG:3857)
    - `emits LAYERS=<config.layerName>` when set
    - `emits _v as the stringified filterVersion (e.g. filterVersion=42 → "_v": "42")` — M-02 cache-buster lock

    `describe("buildWmsParams — spatial mode: latlon")`:
    - `emits X_COLUMN_PARAM=lonCol and Y_COLUMN_PARAM=latCol when spatialMode=latlon` (note: X is lon, Y is lat — geographic convention)
    - `omits GEOMETRY_COLUMN_PARAM when spatialMode=latlon`
    - `omits X/Y params when latColumn or lonColumn is undefined` (or throws — pick a behavior; recommend: returns the params dict WITHOUT the X/Y entries so the WMS request is malformed-but-debuggable rather than crashing the renderer)

    `describe("buildWmsParams — spatial mode: wkt")`:
    - `emits GEOMETRY_COLUMN_PARAM=wktCol when spatialMode=wkt`
    - `omits X/Y params when spatialMode=wkt`

    `describe("buildWmsParams — spatial mode: wkb")`:
    - `emits GEOMETRY_COLUMN_PARAM=wkbCol when spatialMode=wkb`

    `describe("buildWmsParams — render mode: raster")`:
    - `emits STYLES=<spike-locked raster value>`
    - `emits POINTCOLOR=<config.pointColor + opacity-as-alpha-suffix> when pointOpacity is set` (PER SPIKE-NOTES — if RRGGBBAA, builder concatenates; if separate POINTOPACITY param, builder emits separate)
    - `emits POINTSIZE=<config.pointSize>`
    - `pointOpacity 100 + pointColor "FF3838" → POINTCOLOR "FF3838FF"` (verify alpha conversion math: round(opacity/100*255) = 255 → "FF")
    - `pointOpacity 50 + pointColor "FF3838" → POINTCOLOR "FF383880"` (50% → 128 → "80"; verify rounding)
    - `pointOpacity 0 + pointColor "FF3838" → POINTCOLOR "FF383800"`

    `describe("buildWmsParams — render mode: heatmap")`:
    - `emits STYLES=heatmap`
    - `emits BLUR_RADIUS=<config.blurRadius>`
    - `emits COLORMAP=<config.colormap>`
    - `emits MIN_LEVEL/MAX_LEVEL only when defined (do not emit "undefined")`

    `describe("buildWmsParams — render mode: classbreak")`:
    - `emits STYLES=classbreak`
    - `emits CB_COLUMN_NAME=<config.cbColumn>`
    - `emits CB_BREAK_TYPE=CATEGORICAL when cbBreakType="categorical"` (uppercase per Kinetica convention)
    - `emits CB_BREAK_POINT_<n> + CB_POINTCOLOR_<n> for each break, 1-indexed`
    - `with classbreaks=[{value:"A",color:"FF0000"},{value:"B",color:"00FF00"}] emits CB_BREAK_POINT_1=A, CB_POINTCOLOR_1=FF0000, CB_BREAK_POINT_2=B, CB_POINTCOLOR_2=00FF00`
    - `does NOT emit CB_* params if classbreaks is empty or undefined`

    `describe("buildWmsParams — render mode: contour")`:
    - `emits STYLES=contour`
    - `emits CONTOUR_COLOR=<config.contourColor>`
    - `emits CONTOUR_SMOOTH=true when config.contourSmooth=true; "false" when false`
    - `emits CONTOUR_BANDWIDTH=<config.contourBandwidth>`

    `describe("buildWmsParams — filter clause (FILT-04)")`:
    - `emits <FILTER_PARAM>=<whereClause> when whereClause is non-empty`
    - `OMITS <FILTER_PARAM> entirely when whereClause is empty string` (NOT "FILTER_PARAM": "")
    - `emits _v unchanged regardless of filter presence (cache-buster always sent)`

    Total: ≥18 test cases. Each `expect(...).toEqual({...})` or `expect(...).toMatchObject({...})` against the result dict.
  </behavior>
  <action>
    Create `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts`. Import `buildWmsParams` and the types from `./wmsUrlBuilder`. Build a small helper `makeConfig(overrides: Partial<MapWidgetConfig>): MapWidgetConfig` that returns a sane base config (e.g. `{ tableId: 1, spatialMode: "latlon", latColumn: "lat", lonColumn: "lon", renderMode: "raster", layerName: "demo.points" }`). Use the helper to keep tests focused.

    Run: `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts`. Expect FAIL (RED — the function doesn't exist).

    If 11-SPIKE-NOTES.md is BLOCKED (no spike data), STOP this task and report a CHECKPOINT to the orchestrator: "wmsUrlBuilder cannot be coded against unknown param names — re-run spike or accept best-guess constants from RESEARCH.md training data." If the executor proceeds anyway with best-guess, document the choice inline at the top of the spec.

    Commit: `test(11-04): add failing spec for buildWmsParams`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/lib/wmsUrlBuilder.spec.ts` exists
    - File contains ≥ 18 `it(` cases (verify with `grep -c "  it(" kinetica_bi/src/lib/wmsUrlBuilder.spec.ts`)
    - `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts` exits NON-ZERO (RED)
    - File contains the literal string `_v` (cache-buster assertion present)
    - File contains the literal string `STYLES` (style assertions present)
    - Git commit message starts with `test(11-04):`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts; test $? -ne 0 && echo "RED phase confirmed"</automated>
  </verify>
  <done>≥18 failing tests committed; spec is the source-of-truth for downstream Task 2.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement buildWmsParams</name>
  <files>kinetica_bi/src/lib/wmsUrlBuilder.ts</files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.spec.ts (the spec from Task 1 — implement against it exactly)
    - .planning/phases/11-map-chart/11-SPIKE-NOTES.md ("Locked Parameter Names" — copy these into the file's top-level constants verbatim)
    - .planning/phases/11-map-chart/11-RESEARCH.md (Pattern 3 + Reference: Kinetica WMS Param Tables — for the structural shape of the params dict)
    - kinetica_bi/src/lib/columnTypes.ts (SpatialMode type for re-export)
  </read_first>
  <action>
    Create `kinetica_bi/src/lib/wmsUrlBuilder.ts`:

    ```typescript
    // Phase 11: WMS URL parameter builder (MAP-01, MAP-02, FILT-04)
    // PITFALL M-02 lock: _v=filterVersion cache-buster is ALWAYS emitted
    // PITFALL M-04 lock: WKT vs WKB branch — both use GEOMETRY_COLUMN_PARAM (Kinetica detects type from column metadata)
    // PITFALL M-05 lock: BLUR_RADIUS/CONTOUR_BANDWIDTH units are Kinetica map units — caller (config UI) labels them
    // AP-3 lock: filter clause is the output of Phase 9's buildWhereClause; this builder just inserts it under the spike-locked FILTER_PARAM

    import type { SpatialMode } from "./columnTypes";

    export type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";
    export type ClassbreakBreak = { value: string | number; color: string };

    export type MapWidgetConfig = {
      tableId: number;
      layerName?: string;
      spatialMode: SpatialMode;
      latColumn?: string;
      lonColumn?: string;
      wktColumn?: string;
      wkbColumn?: string;
      renderMode: RenderMode;
      pointColor?: string;
      pointSize?: number;
      pointOpacity?: number;
      blurRadius?: number;
      colormap?: string;
      minLevel?: number;
      maxLevel?: number;
      cbColumn?: string;
      cbBreakType?: "categorical" | "numerical";
      classbreaks?: ClassbreakBreak[];
      contourColor?: string;
      contourSmooth?: boolean;
      contourBandwidth?: number;
    };

    // SPIKE-LOCKED CONSTANTS — pulled verbatim from 11-SPIKE-NOTES.md "Locked Parameter Names" table
    const X_COLUMN_PARAM = "<from SPIKE-NOTES>";  // executor REPLACES with locked value before commit
    const Y_COLUMN_PARAM = "<from SPIKE-NOTES>";
    const GEOMETRY_COLUMN_PARAM = "<from SPIKE-NOTES>";
    const FILTER_PARAM = "<from SPIKE-NOTES>";  // QUERY or CQL_FILTER
    const SRS_VALUE = "<from SPIKE-NOTES>";       // typically EPSG:3857

    const STYLES_BY_MODE: Record<RenderMode, string> = {
      raster: "<from SPIKE-NOTES — typically 'point' or 'raster'>",
      heatmap: "heatmap",
      classbreak: "classbreak",
      contour: "contour",
    };

    function opacityToAlphaHex(opacity: number): string {
      // 0-100 → 00-FF. M-spike Open Question #6: SPIKE-NOTES.md decides whether to concat onto POINTCOLOR
      // or emit a separate POINTOPACITY param. This helper handles the concat path; if SPIKE-NOTES says
      // "separate param", refactor to emit POINTOPACITY directly and drop this helper.
      const clamped = Math.max(0, Math.min(100, opacity));
      const byte = Math.round((clamped / 100) * 255);
      return byte.toString(16).toUpperCase().padStart(2, "0");
    }

    export function buildWmsParams(
      config: MapWidgetConfig,
      filterVersion: number,
      whereClause: string
    ): Record<string, string> {
      const params: Record<string, string> = {
        SERVICE: "WMS",
        VERSION: "1.1.1",
        REQUEST: "GetMap",
        FORMAT: "image/png",
        TRANSPARENT: "true",
        SRS: SRS_VALUE,
        STYLES: STYLES_BY_MODE[config.renderMode],
        _v: String(filterVersion), // PITFALL M-02 lock — always emit
      };

      if (config.layerName) {
        params.LAYERS = config.layerName;
      }

      // Spatial-mode branch
      if (config.spatialMode === "latlon") {
        if (config.lonColumn) params[X_COLUMN_PARAM] = config.lonColumn;
        if (config.latColumn) params[Y_COLUMN_PARAM] = config.latColumn;
      } else if (config.spatialMode === "wkt") {
        if (config.wktColumn) params[GEOMETRY_COLUMN_PARAM] = config.wktColumn;
      } else {
        // wkb
        if (config.wkbColumn) params[GEOMETRY_COLUMN_PARAM] = config.wkbColumn;
      }

      // Render-mode branch
      if (config.renderMode === "raster") {
        if (config.pointColor) {
          if (config.pointOpacity !== undefined) {
            params.POINTCOLOR = `${config.pointColor.toUpperCase()}${opacityToAlphaHex(config.pointOpacity)}`;
          } else {
            params.POINTCOLOR = config.pointColor.toUpperCase();
          }
        }
        if (config.pointSize !== undefined) params.POINTSIZE = String(config.pointSize);
      } else if (config.renderMode === "heatmap") {
        if (config.blurRadius !== undefined) params.BLUR_RADIUS = String(config.blurRadius);
        if (config.colormap) params.COLORMAP = config.colormap;
        if (config.minLevel !== undefined) params.MIN_LEVEL = String(config.minLevel);
        if (config.maxLevel !== undefined) params.MAX_LEVEL = String(config.maxLevel);
      } else if (config.renderMode === "classbreak") {
        if (config.cbColumn) params.CB_COLUMN_NAME = config.cbColumn;
        if (config.cbBreakType) {
          params.CB_BREAK_TYPE = config.cbBreakType.toUpperCase();
        }
        if (config.classbreaks && config.classbreaks.length > 0) {
          config.classbreaks.forEach((b, i) => {
            const n = i + 1; // 1-indexed per Kinetica convention
            params[`CB_BREAK_POINT_${n}`] = String(b.value);
            params[`CB_POINTCOLOR_${n}`] = b.color.toUpperCase();
          });
        }
      } else if (config.renderMode === "contour") {
        if (config.contourColor) params.CONTOUR_COLOR = config.contourColor.toUpperCase();
        if (config.contourSmooth !== undefined) params.CONTOUR_SMOOTH = String(config.contourSmooth);
        if (config.contourBandwidth !== undefined) params.CONTOUR_BANDWIDTH = String(config.contourBandwidth);
      }

      // Filter (FILT-04) — only emit when non-empty
      if (whereClause && whereClause.trim().length > 0) {
        params[FILTER_PARAM] = whereClause;
      }

      return params;
    }

    // Re-export SpatialMode for downstream convenience (avoid double-imports in MapChartRenderer)
    export type { SpatialMode };
    ```

    CRITICAL: Before commit, the executor MUST replace every `<from SPIKE-NOTES>` placeholder with the locked value from `.planning/phases/11-map-chart/11-SPIKE-NOTES.md`. If SPIKE-NOTES is BLOCKED, the executor MUST stop and request a CHECKPOINT — DO NOT commit with placeholder values.

    Run `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts` — all ≥18 tests pass (GREEN). Then `cd kinetica_bi && npx vitest run` — full suite green.

    Commit: `feat(11-04): implement buildWmsParams covering all renderMode × spatialMode combos`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/lib/wmsUrlBuilder.ts` exists and exports `buildWmsParams`, `MapWidgetConfig`, `RenderMode`, `ClassbreakBreak`
    - `grep -c "<from SPIKE-NOTES>" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (placeholders fully replaced)
    - `cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts` exits 0 with all ≥18 tests passing
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite still green)
    - `grep -n "PITFALL M-02 lock\|PITFALL M-04 lock\|AP-3 lock" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns ≥ 3 (pitfall comments present)
    - `grep -c "_v.*String(filterVersion)" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 1 (cache-buster always emitted)
    - Git commit message starts with `feat(11-04):`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/wmsUrlBuilder.spec.ts && npx vitest run</automated>
  </verify>
  <done>buildWmsParams shipped with spike-locked param names; all tests pass; ready for Wave 3 MapChartRenderer.tsx consumption.</done>
</task>

</tasks>

<verification>
- ≥18 tests covering all renderMode × spatialMode combos + filter presence/absence + cache-buster.
- All `<from SPIKE-NOTES>` placeholders replaced with concrete locked values.
- M-02 cache-buster (`_v: filterVersion`) emitted unconditionally.
- M-04 WKT/WKB branch correctly emits GEOMETRY_COLUMN_PARAM for both.
- AP-3 lock honored: filter clause inserted only when non-empty (no `FILTER_PARAM=""`).
</verification>

<success_criteria>
- `cd kinetica_bi && npx vitest run` exits 0.
- `MapChartRenderer.tsx` (Wave 3) can `import { buildWmsParams } from "../../lib/wmsUrlBuilder"` and call it from inside the filter-subscription useEffect.
- No raw string concatenation of filter values inside the builder (always uses Phase 9's `buildWhereClause` output).
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-04-SUMMARY.md` summarizing:
- The locked param-name constants (X_COLUMN_PARAM, Y_COLUMN_PARAM, GEOMETRY_COLUMN_PARAM, FILTER_PARAM, SRS_VALUE) from spike notes
- POINTOPACITY treatment (alpha-suffix vs separate param)
- Test count delta and any edge cases discovered
- Whether any spec adjustment was needed when SPIKE-NOTES.md disagreed with RESEARCH.md training data
</output>
