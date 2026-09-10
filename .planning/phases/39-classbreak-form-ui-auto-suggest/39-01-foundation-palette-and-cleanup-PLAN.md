---
phase: 39-classbreak-form-ui-auto-suggest
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/cbConfig.ts
  - kinetica_bi/src/lib/cbConfig.spec.ts
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
  - kinetica_bi/src/components/charts/CbConfigForm.tsx
autonomous: true
requirements:
  - CB-V17-01
  - CB-V17-08
must_haves:
  truths:
    - "Render-mode picker shows exactly 3 radio options: Raster, Heatmap, Class Break (contour hidden from picker)"
    - "Existing ClassbreakParamsGroup sub-component + ClassbreakBreak type + CardinalityState type are deleted from KineticaWmsLayerForm.tsx"
    - "PALETTE_COLORS sequential array of 8 AARRGGBB hex codes is exported from lib/cbConfig.ts"
    - "createDefaultBreak(valsType, index) helper returns a fully-populated CbBreak with all 5 advanced fields set to defaults"
    - "filterCbEligibleColumns(columns, spatialBound) excludes WKB-binary columns and spatial-bound columns"
    - "renderMode=='classbreak' renders <CbConfigForm/> skeleton (visible header + placeholder, no behavior yet)"
    - "Existing spec assertion 'Contour (lines)' is inverted to .not.toBeInTheDocument()"
    - "Obsolete ClassbreakParamsGroup-targeted specs (cbColumn/cbBreakType/Break 1/Break 2/isValid-classbreaks-length) are removed; placeholder spec confirms CbConfigForm header renders under classbreak mode"
  artifacts:
    - path: "kinetica_bi/src/lib/cbConfig.ts"
      provides: "PALETTE_COLORS + createDefaultBreak + filterCbEligibleColumns helpers"
      contains: "export const PALETTE_COLORS"
    - path: "kinetica_bi/src/components/charts/CbConfigForm.tsx"
      provides: "New CbConfigForm sub-component (skeleton with header + placeholder body)"
      exports: ["default CbConfigForm"]
    - path: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      provides: "Render-mode picker filtered to 3 options; classbreak gate renders <CbConfigForm/>; legacy ClassbreakParamsGroup deleted"
  key_links:
    - from: "KineticaWmsLayerForm.tsx render-mode picker (line ~806)"
      to: "ALL_RENDER_MODES filter predicate"
      via: ".filter((m) => allowedRenderModes.includes(m) && m !== 'contour')"
      pattern: "m !== \"contour\""
    - from: "KineticaWmsLayerForm.tsx classbreak gate (line ~1156)"
      to: "<CbConfigForm/> component"
      via: "{renderMode === 'classbreak' && <CbConfigForm ... />}"
      pattern: "<CbConfigForm"
    - from: "CbConfigForm.tsx"
      to: "lib/cbConfig.ts"
      via: "imports coalesceCbConfig + PALETTE_COLORS"
      pattern: "from \"../../lib/cbConfig\""
---

<objective>
Wave 1 foundation for Phase 39. Three concerns: (1) extend lib/cbConfig.ts with shared constants/helpers, (2) surgically clean legacy ClassbreakParamsGroup from KineticaWmsLayerForm.tsx + filter contour from picker, (3) ship a CbConfigForm.tsx skeleton component the parent can mount immediately (subsequent plans fill in behavior).

Purpose: Unblock Plan 39-02 (core form) and Plan 39-03 (categorical + auto-suggest) by establishing the constants, file, and mount point. Closes CB-V17-01 (render-mode picker shows Class Break) on the picker filter side. Lays the groundwork for CB-V17-08 (WKB exclusion) via the eligibility filter helper.

Output: Updated cbConfig.ts with palette + helpers + tests; trimmed KineticaWmsLayerForm.tsx (no ClassbreakParamsGroup, picker filtered to 3 modes); new CbConfigForm.tsx skeleton; updated spec file with obsolete assertions removed.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-CONTEXT.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-RESEARCH.md
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md

<interfaces>
<!-- Key types and contracts the executor needs. Use these directly — no codebase exploration required. -->

From kinetica_bi/src/lib/cbConfig.ts (Phase 38, READ-ONLY for Phase 39):
```typescript
export type CbBreak = {
  value: string | number;
  color: string;          // 8-char AARRGGBB
  label?: string;
  pointSize?: number;
  pointShape?: string;
  shapeLineWidth?: number;
  shapeLineColor?: string;
  shapeFillColor?: string;
};
export type CbConfig = {
  attr: string;
  valsType: "numeric" | "categorical";
  breaks: CbBreak[];
  includeOtherBucket?: boolean;
};
export const EMPTY_CB_CONFIG: CbConfig;
export function coalesceCbConfig(raw: string | null): CbConfig;
export function isCbConfigConfigured(cfg: CbConfig): boolean;
export function isNumericValsType(cfg: CbConfig): boolean;
export function isCategoricalValsType(cfg: CbConfig): boolean;
```

From kinetica_bi/src/lib/colorHex.ts:
```typescript
export function normalizeAARRGGBB(hex: string | undefined, fallback?: string): string;
export function rgbFromAARRGGBB(hex: string | undefined, fallback?: string): string;
export function alphaFromAARRGGBB(hex: string | undefined, fallback?: string): string;
export function joinAARRGGBB(alpha: string, rgb: string): string;
```

From kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (current state):
- Line ~88-93: `type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";` followed by `type ClassbreakBreak = { value: string | number; color: string };`
- Line ~111: `const ALL_RENDER_MODES: RenderMode[] = ["raster", "heatmap", "classbreak", "contour"];`
- Line ~174-178: `type CardinalityState = null | { state: "loading" } | { state: "ok"; count: number } | { state: "error" };`
- Lines 180-428: ClassbreakParamsGroup function + its props type
- Line 806: `{ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m)).map((m) => (`
- Lines 1156-1163: `{renderMode === "classbreak" && (<ClassbreakParamsGroup config={config} onChange={onChange} columns={columns} isValid={isValid} />)}`

From kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx:
- Line 90: `expect(screen.getByText("Contour (lines)")).toBeInTheDocument();`
- Lines 118-148: test `renderMode='classbreak' shows cbColumn dropdown, cbBreakType radios, and classbreak rows container` — asserts `screen.getByLabelText("Break column")`, `screen.getByLabelText("Numerical")`, `screen.getByLabelText("Categorical")`, `screen.getByText("Break 1")`, `screen.getByText("Break 2")`
- Lines 150-189: test `isValid(false) when classbreaks.length < 2; isValid(true) when classbreaks.length >= 2` — uses `classbreaks: [...]` config keys
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend lib/cbConfig.ts with PALETTE_COLORS + helpers + tests</name>
  <files>kinetica_bi/src/lib/cbConfig.ts, kinetica_bi/src/lib/cbConfig.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/cbConfig.ts (current Phase 38 helpers — types + EMPTY_CB_CONFIG + coalesceCbConfig + predicates)
    - kinetica_bi/src/lib/cbConfig.spec.ts (current Phase 38 unit-test patterns)
  </read_first>
  <behavior>
    - Test: PALETTE_COLORS exported as readonly string[] of length 8; each entry matches /^[0-9A-F]{8}$/.
    - Test: createDefaultBreak("numeric", 0) returns `{ value: 0, color: PALETTE_COLORS[0], label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" }`.
    - Test: createDefaultBreak("categorical", 3) returns `{ value: "", color: PALETTE_COLORS[3 % PALETTE_COLORS.length], label: "", pointSize: 5, pointShape: "circle", shapeLineWidth: 1, shapeLineColor: "FF000000", shapeFillColor: "FFFFFFFF" }`.
    - Test: createDefaultBreak("numeric", 9) wraps palette: color === PALETTE_COLORS[9 % 8] === PALETTE_COLORS[1].
    - Test: filterCbEligibleColumns excludes any column whose type contains "bytes" (case-insensitive) — e.g. {name: "geom_wkb", type: "BYTES"} filtered out.
    - Test: filterCbEligibleColumns excludes any column whose type contains "wkb" (case-insensitive).
    - Test: filterCbEligibleColumns excludes columns in the spatialBound set (e.g. when spatialBound = new Set(["lat", "lon"]), columns named "lat" and "lon" are filtered out even if they're numeric).
    - Test: filterCbEligibleColumns includes int, integer, int8, int16, int32, int64, long, float, double, decimal, numeric, smallint, bigint, real, number, tinyint (case-insensitive, with `(N,M)` suffix stripped — e.g. `decimal(10,2)`).
    - Test: filterCbEligibleColumns includes string, varchar, char (case-insensitive, with `(N)` suffix stripped — e.g. `varchar(255)`).
    - Test: filterCbEligibleColumns excludes types not in numeric/string union (e.g. "wkt", "datetime", "boolean", "timestamp").
  </behavior>
  <action>
    Append to `kinetica_bi/src/lib/cbConfig.ts` (preserve all existing exports — do NOT remove anything):

    1. Add the `PALETTE_COLORS` constant (operator-locked: ColorBrewer-Blues-inspired 8-color sequential palette, all 8-char AARRGGBB):
    ```typescript
    /** Default 8-color sequential palette for new break rows. Phase 39 CB form uses
     *  PALETTE_COLORS[index % PALETTE_COLORS.length] for the color of newly-added rows
     *  (Add break, Auto-suggest fill, <other> toggle-ON). Phase 41 LayersLegendPanel
     *  reads break colors directly from cb_config.breaks[].color, not from this palette
     *  (palette is only used at row-creation time). */
    export const PALETTE_COLORS: readonly string[] = [
      "FF3B82F6", // blue-500
      "FFEF4444", // red-500
      "FF10B981", // emerald-500
      "FFF59E0B", // amber-500
      "FF8B5CF6", // violet-500
      "FFEC4899", // pink-500
      "FF14B8A6", // teal-500
      "FF6B7280", // gray-500
    ];
    ```

    2. Add `createDefaultBreak(valsType, index)`:
    ```typescript
    /** Materialize a fully-populated CbBreak with all 5 advanced fields set to defaults.
     *  Phase 39 form invariant: every break row has all 5 advanced fields populated so
     *  wmsUrlBuilder never receives undefined values in CSV emission (POINTSIZES, POINTSHAPES,
     *  SHAPELINEWIDTHS, SHAPELINECOLORS, SHAPEFILLCOLORS). */
    export function createDefaultBreak(
      valsType: "numeric" | "categorical",
      index: number,
    ): CbBreak {
      return {
        value: valsType === "numeric" ? 0 : "",
        color: PALETTE_COLORS[index % PALETTE_COLORS.length],
        label: "",
        pointSize: 5,
        pointShape: "circle",
        shapeLineWidth: 1,
        shapeLineColor: "FF000000",
        shapeFillColor: "FFFFFFFF",
      };
    }
    ```

    3. Add `filterCbEligibleColumns(columns, spatialBound?)`:
    ```typescript
    /** Filter the column list to CB-eligible columns. Mirrors v1.2 Phase 11 logic plus
     *  Phase 39 additions: (a) exclude WKB-binary columns (type contains "bytes" or "wkb"
     *  case-insensitive) per CB-V17-08; (b) exclude columns already bound to spatial config
     *  (lat/lon/wkt/wkb) for visual de-clutter. Type-suffix stripping handles `varchar(255)`
     *  and `decimal(10,2)` style declarations. */
    const NUMERIC_TYPES = new Set([
      "int", "integer", "int8", "int16", "int32", "int64",
      "long", "float", "double", "decimal", "numeric",
      "smallint", "bigint", "real", "number", "tinyint",
    ]);
    const STRING_TYPES = new Set(["string", "varchar", "char"]);

    export function filterCbEligibleColumns(
      columns: { name: string; type: string }[],
      spatialBound?: Set<string>,
    ): { name: string; type: string }[] {
      return columns.filter((c) => {
        const rawType = c.type.toLowerCase();
        // CB-V17-08: WKB exclusion
        if (rawType.includes("bytes") || rawType.includes("wkb")) return false;
        // Spatial-bound exclusion (visual de-clutter)
        if (spatialBound && spatialBound.has(c.name)) return false;
        const t = rawType.replace(/\(.*\)/, "").trim();
        return NUMERIC_TYPES.has(t) || STRING_TYPES.has(t);
      });
    }
    ```

    4. Add `detectValsTypeFromColumn(column)`:
    ```typescript
    /** Auto-detect valsType from a column's type. Numeric columns default to "numeric";
     *  string columns default to "categorical". Returns "numeric" as the safe fallback
     *  for unknown types (caller should have already filtered via filterCbEligibleColumns). */
    export function detectValsTypeFromColumn(
      column: { name: string; type: string } | undefined,
    ): "numeric" | "categorical" {
      if (!column) return "numeric";
      const t = column.type.toLowerCase().replace(/\(.*\)/, "").trim();
      if (STRING_TYPES.has(t)) return "categorical";
      return "numeric";
    }
    ```

    Now extend `kinetica_bi/src/lib/cbConfig.spec.ts` with the test cases listed in <behavior>. Use the existing test pattern (`describe("cbConfig", () => { it(...); })`). Add one `describe` block for each new export: `describe("PALETTE_COLORS")`, `describe("createDefaultBreak")`, `describe("filterCbEligibleColumns")`, `describe("detectValsTypeFromColumn")`. Concrete assertions:

    - PALETTE_COLORS.length === 8
    - PALETTE_COLORS[0] === "FF3B82F6"
    - All PALETTE_COLORS entries match `/^[0-9A-F]{8}$/`
    - createDefaultBreak("numeric", 0) deep-equals the object specified above
    - createDefaultBreak("categorical", 3).color === PALETTE_COLORS[3]
    - createDefaultBreak("numeric", 9).color === PALETTE_COLORS[1]
    - filterCbEligibleColumns([{name:"a",type:"int"}, {name:"b",type:"BYTES"}, {name:"c",type:"varchar(255)"}, {name:"d",type:"wkt"}]).map(c=>c.name) === ["a","c"]
    - filterCbEligibleColumns([{name:"lat",type:"double"}, {name:"lon",type:"double"}, {name:"x",type:"int"}], new Set(["lat","lon"])).map(c=>c.name) === ["x"]
    - filterCbEligibleColumns([{name:"x",type:"decimal(10,2)"}]).map(c=>c.name) === ["x"]
    - detectValsTypeFromColumn({name:"a",type:"varchar(50)"}) === "categorical"
    - detectValsTypeFromColumn({name:"a",type:"int"}) === "numeric"
    - detectValsTypeFromColumn(undefined) === "numeric"
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/cbConfig.spec.ts --reporter=verbose</automated>
  </verify>
  <done>
    cbConfig.ts exports PALETTE_COLORS (length 8), createDefaultBreak, filterCbEligibleColumns, detectValsTypeFromColumn — all helpers covered by passing vitest assertions. No existing Phase 38 exports removed or changed (coalesceCbConfig, isCbConfigConfigured, etc. still work).
  </done>
</task>

<task type="auto">
  <name>Task 2: Create CbConfigForm.tsx skeleton + delete ClassbreakParamsGroup + filter contour from picker + update spec</name>
  <files>kinetica_bi/src/components/charts/CbConfigForm.tsx, kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx, kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (entire file — current ClassbreakParamsGroup lines 180-428, render-mode picker line 806, classbreak gate line 1156, RENDER_MODE_LABELS line 103, ALL_RENDER_MODES line 111, CardinalityState line 174)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx (line 90 Contour assertion, lines 118-189 ClassbreakParamsGroup-targeted tests)
    - kinetica_bi/src/lib/cbConfig.ts (Phase 38 + Task 1 additions — new exports CbBreak, CbConfig, coalesceCbConfig, PALETTE_COLORS, createDefaultBreak, filterCbEligibleColumns, detectValsTypeFromColumn)
  </read_first>
  <action>
    PART A — Create new file `kinetica_bi/src/components/charts/CbConfigForm.tsx` as a skeleton that subsequent plans will flesh out. Skeleton renders ONLY:
    - A `<div className="config-group">` with `role="group"` and `aria-labelledby="cb-config-form-label"`.
    - A `<label id="cb-config-form-label" className="config-group-label">CLASS BREAK PARAMS</label>` header.
    - A `<div className="cb-config-placeholder">` containing the text "Class Break configuration — coming in Plan 39-02".
    - A `useEffect` that signals `isValid(true)` on mount so the parent's Save button doesn't lock when switching to classbreak mode before the form is fleshed out. (Plan 39-02 replaces this with the real validity rule.)

    File contents (~50 lines):
    ```typescript
    /**
     * Phase 39: CbConfigForm — replaces v1.2 ClassbreakParamsGroup.
     *
     * Reads/writes `config.cb_config` (JSON string) via coalesceCbConfig + JSON.stringify.
     * NEVER reads or writes legacy `config.cbColumn` / `config.classbreaks[]` fields
     * (Phase 38 hard cutover).
     *
     * This file ships in Plan 39-01 as a skeleton; Plan 39-02 adds column picker +
     * break-row builder + advanced chevron; Plan 39-03 adds categorical UX +
     * Auto-suggest button + modal-confirm + AbortController error handling.
     */

    import { useEffect } from "react";
    import type { Column } from "../../lib/columnTypes";

    type CbConfigFormProps = {
      config: Record<string, unknown>;
      onChange: (config: Record<string, unknown>) => void;
      columns: Column[];
      isValid?: (valid: boolean) => void;
      /** "schema.table" string for probeCardinality. Plan 39-03 consumes. */
      tableRef?: string;
      /** Separate schema + table for quantileFn. Plan 39-03 consumes. */
      schema?: string;
      tableName?: string;
    };

    export default function CbConfigForm({
      config,
      onChange,
      columns,
      isValid,
      tableRef,
      schema,
      tableName,
    }: CbConfigFormProps): JSX.Element {
      // Skeleton: signal valid=true so Save button isn't locked while form is incomplete.
      // Plan 39-02 replaces with real validity rule (breaks.length >= 2 + all values non-empty).
      useEffect(() => {
        if (isValid) isValid(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Silence unused-prop warnings during skeleton phase; Plan 39-02/03 consume.
      void config; void onChange; void columns; void tableRef; void schema; void tableName;

      return (
        <div className="config-group" role="group" aria-labelledby="cb-config-form-label">
          <label id="cb-config-form-label" className="config-group-label">
            CLASS BREAK PARAMS
          </label>
          <div className="cb-config-placeholder" style={{ color: "var(--muted)" }}>
            Class Break configuration — coming in Plan 39-02
          </div>
        </div>
      );
    }
    ```

    PART B — Edit `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`:

    1. DELETE line 93 (the legacy `ClassbreakBreak` type declaration):
       ```typescript
       // Classbreak break shape (from wmsUrlBuilder.ts)
       type ClassbreakBreak = { value: string | number; color: string };
       ```

    2. DELETE lines 172-178 (CardinalityState type — only used by ClassbreakParamsGroup):
       ```typescript
       type CardinalityState =
         | null
         | { state: "loading" }
         | { state: "ok"; count: number }
         | { state: "error" };
       ```

    3. DELETE lines 180-428 entirely (the entire `// ─── ClassbreakParamsGroup sub-component ───` block including the `ClassbreakParamsGroupProps` type and the `function ClassbreakParamsGroup(...)` body — read the full range first to confirm boundaries before deletion).

    4. ADD import for the new skeleton component near the top of the file (after the existing component imports around line 49-50):
       ```typescript
       import CbConfigForm from "./CbConfigForm";
       ```

    5. UPDATE line 806 — the render-mode picker filter — add `&& m !== "contour"`:
       FROM:
       ```typescript
       {ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m)).map((m) => (
       ```
       TO:
       ```typescript
       {ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m) && m !== "contour").map((m) => (
       ```
       Add an inline comment directly above the line:
       ```typescript
       {/* Phase 39 (CB-V17-01): contour hidden from picker; RenderMode type unchanged.
           Existing layers with renderMode="contour" still render the contour params
           block below (Pitfall 6 mitigation per 39-RESEARCH.md). */}
       ```

    6. UPDATE lines 1156-1163 — the classbreak gate — swap `ClassbreakParamsGroup` to `CbConfigForm`:
       FROM:
       ```typescript
       {/* ─── CLASSBREAK PARAMS ────────────────────────────────────────────── */}
       {renderMode === "classbreak" && (
         <ClassbreakParamsGroup
           config={config}
           onChange={onChange}
           columns={columns}
           isValid={isValid}
         />
       )}
       ```
       TO:
       ```typescript
       {/* ─── CLASSBREAK PARAMS (Phase 39: CbConfigForm replaces ClassbreakParamsGroup) ─ */}
       {renderMode === "classbreak" && (
         <CbConfigForm
           config={config}
           onChange={onChange}
           columns={columns}
           isValid={isValid}
           tableRef={(config.tableRef as string) || ""}
           schema={layer ? (associatedTables.find((t) => t.id === layer.table_id)?.schema ?? "") : ""}
           tableName={layer ? (associatedTables.find((t) => t.id === layer.table_id)?.name ?? "") : ""}
         />
       )}
       ```

    PART C — Edit `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx`:

    1. UPDATE the existing "renders render mode labels" test (lines 79-91) to INVERT the contour assertion:
       FROM (line 90):
       ```typescript
       expect(screen.getByText("Contour (lines)")).toBeInTheDocument();
       ```
       TO:
       ```typescript
       // Phase 39 (CB-V17-01): contour hidden from picker
       expect(screen.queryByText("Contour (lines)")).not.toBeInTheDocument();
       ```

    2. ADD a new test directly after the "renders render mode labels" test asserting exactly 3 render-mode radios appear:
       ```typescript
       it("renders exactly 3 render-mode radio options (Raster, Heatmap, Class Break)", () => {
         render(
           <KineticaWmsLayerForm
             config={baseConfig}
             onChange={vi.fn()}
             columns={baseColumns}
           />
         );
         // Pick radios by accessible name (RENDER_MODE_LABELS strings)
         expect(screen.getByLabelText("Raster (point markers)")).toBeInTheDocument();
         expect(screen.getByLabelText("Heatmap (density)")).toBeInTheDocument();
         expect(screen.getByLabelText("Classbreak (categorical)")).toBeInTheDocument();
         // Contour radio MUST NOT be in the picker
         expect(screen.queryByLabelText("Contour (lines)")).not.toBeInTheDocument();
       });
       ```

    3. DELETE the existing test "renderMode='classbreak' shows cbColumn dropdown, cbBreakType radios, and classbreak rows container" (lines 118-148) — it asserts deleted UI elements ("Break column" label, "Numerical"/"Categorical" radios, "Break 1"/"Break 2" text).

    4. REPLACE it with a placeholder test that asserts the new CbConfigForm skeleton renders under classbreak mode:
       ```typescript
       it("renderMode='classbreak' renders CbConfigForm skeleton with CLASS BREAK PARAMS header", () => {
         const classbreakConfig: Record<string, unknown> = {
           ...baseConfig,
           renderMode: "classbreak",
         };
         render(
           <KineticaWmsLayerForm
             config={classbreakConfig}
             onChange={vi.fn()}
             columns={baseColumns}
           />
         );
         // New CbConfigForm skeleton renders header (Plan 39-02 fleshes out body)
         expect(screen.getByText("CLASS BREAK PARAMS")).toBeInTheDocument();
       });
       ```

    5. DELETE the existing test "isValid(false) when classbreaks.length < 2; isValid(true) when classbreaks.length >= 2" (lines 150-189) — it uses the deleted `classbreaks: [...]` config key. (Plan 39-02 re-adds a real isValid test using `cb_config` JSON.)

    Do NOT modify any other tests in the spec file. The "renderMode='raster' shows Point shape..." test and the "does NOT render a table picker" test stay unchanged.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx --reporter=verbose && grep -L "ClassbreakParamsGroup\|ClassbreakBreak\|CardinalityState" src/components/charts/KineticaWmsLayerForm.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "ClassbreakParamsGroup" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 0
    - `grep -c "ClassbreakBreak" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 0
    - `grep -c "CardinalityState" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 0
    - `grep -c 'import CbConfigForm from "./CbConfigForm";' kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 1
    - `grep -c 'm !== "contour"' kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns at least 1
    - `grep -c "<CbConfigForm" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns at least 1
    - kinetica_bi/src/components/charts/CbConfigForm.tsx exists and contains "CLASS BREAK PARAMS"
    - `grep -c '"Contour (lines)").not.toBeInTheDocument()' kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` returns at least 1
    - `grep -c "Break column" kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` returns 0
    - `grep -c 'CLASS BREAK PARAMS' kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` returns at least 1
    - `cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx` exits 0
  </acceptance_criteria>
  <done>
    ClassbreakParamsGroup + ClassbreakBreak type + CardinalityState type deleted from KineticaWmsLayerForm.tsx. Render-mode picker filtered to 3 visible options (contour radio absent). New CbConfigForm.tsx skeleton mounted under classbreak gate with header "CLASS BREAK PARAMS". Spec file's obsolete contour + classbreaks[] assertions removed/inverted. All non-deleted KineticaWmsLayerForm specs still pass.
  </done>
</task>

</tasks>

<verification>
- vitest passes for both cbConfig.spec.ts and KineticaWmsLayerForm.spec.tsx
- TypeScript compilation clean: `cd kinetica_bi && npx tsc -p tsconfig.app.json --noEmit` exits 0
- No reference to ClassbreakParamsGroup, ClassbreakBreak, or CardinalityState in KineticaWmsLayerForm.tsx
- Render-mode picker shows only 3 radio buttons (Raster, Heatmap, Classbreak) in DOM when rendered
- CbConfigForm.tsx exists with skeleton implementation that signals isValid(true) on mount
</verification>

<success_criteria>
- ROADMAP SC #1 partially satisfied (3-option render mode picker visible; Class Break reveals CbConfigForm)
- CB-V17-01 picker filter side closed
- CB-V17-08 eligibility filter helper available (consumed in Plan 39-02)
- Plan 39-02 unblocked: CbConfigForm.tsx exists for editing; PALETTE_COLORS + createDefaultBreak + filterCbEligibleColumns + detectValsTypeFromColumn exported from lib/cbConfig.ts
- No regressions: all surviving KineticaWmsLayerForm specs pass; tsc clean
</success_criteria>

<output>
After completion, create `.planning/phases/39-classbreak-form-ui-auto-suggest/39-01-SUMMARY.md` documenting:
- Files deleted (lines from KineticaWmsLayerForm.tsx)
- New exports in lib/cbConfig.ts (PALETTE_COLORS, createDefaultBreak, filterCbEligibleColumns, detectValsTypeFromColumn)
- CbConfigForm.tsx skeleton location + intended evolution in 39-02/39-03
- Spec assertion updates
- Any deviations from the plan
</output>
