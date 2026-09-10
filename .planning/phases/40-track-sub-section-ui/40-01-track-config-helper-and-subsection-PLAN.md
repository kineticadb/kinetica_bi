---
phase: 40-track-sub-section-ui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/trackConfig.ts
  - kinetica_bi/src/lib/trackConfig.spec.ts
  - kinetica_bi/src/lib/wmsUrlBuilder.ts
  - kinetica_bi/src/components/charts/TrackSubSection.tsx
  - kinetica_bi/src/components/charts/TrackSubSection.spec.tsx
autonomous: true
requirements:
  - TRACK-V17-01
  - TRACK-V17-02
  - TRACK-V17-04
  - TRACK-V17-06
gap_closure: false

must_haves:
  truths:
    - "lib/trackConfig.ts exports TrackConfig + coalesceTrackConfig + TRACK_DEFAULTS; both re-exported from wmsUrlBuilder.ts (back-compat) so Phase 38 callsite at line 440 still resolves"
    - "TrackSubSection.tsx is a pure controlled component (props: config, onChange, columns, isValid); it patches track_config JSON via {...config, track_config: JSON.stringify(next)}"
    - "Override checkbox 'Treat as track table' is ALWAYS visible regardless of isTrackTable result; shows '(auto-detected)' hint when isTrackTable(columns) returns non-null"
    - "On new-layer + track-shape table (config.track_config === null AND isTrackTable returns non-null), useEffect([columns]) auto-seeds trackConfig with enabled=true + default field values"
    - "On saved layer with track_config !== null, persisted enabled wins on load — useEffect MUST NOT overwrite a persisted config even when isTrackTable is true"
    - "Unchecking the override checkbox flips enabled=false but preserves trackIdAttr/trackOrderAttr/headColor/trailColor/headSize/trailSize/headShape verbatim"
    - "8 form inputs render when enabled === true in single-column order: trackIdAttr select → trackOrderAttr select → headColor (color+text pair) → headSize (number 1-20) → headShape select → trailColor (color+text pair) → Line width (number 1-20, writes to trackConfig.trailSize)"
    - "trackIdAttr dropdown filters columns to non-spatial-bound (excludes columns named in config.xColumn/yColumn/spatialColumn); trackOrderAttr dropdown shows ALL columns"
    - "headShape dropdown exposes ALL 12 values of POINT_SHAPES (none, circle, dash, diamond, dot, hollowcircle, hollowdiamond, hollowsquare, hollowsquarewithplus, pipe, plus, square)"
    - "Color inputs use the AARRGGBB two-control pattern (color picker + text input) mirroring raster pointColor; on text-blur normalizeAARRGGBB(value, defaultValue) fallback applies"
    - "trackConfig.lineWidth is NEVER written by this form — 'Line width' input writes only to trackConfig.trailSize"
    - "isValid(true) is called unconditionally on mount (no required-completeness gate)"
    - "Spec file TrackSubSection.spec.tsx covers all 5 ROADMAP success criteria + all 6 TRACK-V17 REQ IDs"
  artifacts:
    - path: "kinetica_bi/src/lib/trackConfig.ts"
      provides: "TrackConfig type + coalesceTrackConfig + TRACK_DEFAULTS constant"
      exports: ["TrackConfig", "coalesceTrackConfig", "TRACK_DEFAULTS"]
      min_lines: 35
    - path: "kinetica_bi/src/lib/trackConfig.spec.ts"
      provides: "Unit tests for coalesceTrackConfig parse behavior"
      min_lines: 40
    - path: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      provides: "Re-exports TrackConfig + coalesceTrackConfig from lib/trackConfig.ts (back-compat for line-440 callsite)"
      contains: "export { TrackConfig, coalesceTrackConfig } from \"./trackConfig\""
    - path: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      provides: "TrackSubSection React component (dormant — no mount in host yet)"
      exports: ["default"]
      min_lines: 250
    - path: "kinetica_bi/src/components/charts/TrackSubSection.spec.tsx"
      provides: "Component spec covering auto-detect, override checkbox, field rendering, persistence, render-mode-preservation"
      min_lines: 350
  key_links:
    - from: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      to: "kinetica_bi/src/lib/trackConfig.ts"
      via: "type-only re-export of TrackConfig + value re-export of coalesceTrackConfig"
      pattern: "export.*coalesceTrackConfig.*from.*trackConfig"
    - from: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      to: "kinetica_bi/src/lib/trackConfig.ts"
      via: "import TrackConfig type + coalesceTrackConfig + TRACK_DEFAULTS"
      pattern: "from\\s+['\"]\\.\\./\\.\\./lib/trackConfig['\"]"
    - from: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      to: "kinetica_bi/src/lib/trackDetect.ts"
      via: "import isTrackTable in useEffect([columns])"
      pattern: "isTrackTable"
    - from: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      to: "kinetica_bi/src/lib/wmsUrlBuilder.ts"
      via: "import POINT_SHAPES for headShape dropdown"
      pattern: "POINT_SHAPES"
    - from: "kinetica_bi/src/components/charts/TrackSubSection.tsx"
      to: "kinetica_bi/src/lib/colorHex.ts"
      via: "import normalizeAARRGGBB, rgbFromAARRGGBB, alphaFromAARRGGBB, joinAARRGGBB"
      pattern: "normalizeAARRGGBB"
---

<objective>
Extract `coalesceTrackConfig` + `TrackConfig` type from `wmsUrlBuilder.ts` into a new pure helper module `lib/trackConfig.ts` (with a TRACK_DEFAULTS constant), AND ship `TrackSubSection.tsx` — a pure controlled React component that reads/writes `config.track_config` via the existing `onChange` chain. Component ships DORMANT (no mount in `KineticaWmsLayerForm.tsx` yet — Plan 40-02 wires it in).

Purpose: This plan establishes the helper module + dormant component. Phase 38 explicitly deferred the lib/trackConfig.ts extraction "until a 2nd consumer surfaces" — Phase 40's form IS that 2nd consumer. The dormant-component pattern mirrors Phase 39-01 (CbConfigForm skeleton shipped before wiring) — keeps host file mutations isolated from new-component churn, simplifies code review, and gives Plan 40-02 a working component to mount.

Output:
- `kinetica_bi/src/lib/trackConfig.ts` — helper module with TrackConfig type, coalesceTrackConfig, TRACK_DEFAULTS constant
- `kinetica_bi/src/lib/trackConfig.spec.ts` — unit tests
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — re-exports TrackConfig + coalesceTrackConfig from new module (backward-compat for line-440 callsite + Phase 38 spec callsites)
- `kinetica_bi/src/components/charts/TrackSubSection.tsx` — pure component
- `kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` — component spec covering all 5 SCs + 6 REQ IDs
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/40-track-sub-section-ui/40-CONTEXT.md
@.planning/phases/40-track-sub-section-ui/40-RESEARCH.md
@.planning/phases/38-schema-wms-engine-foundation/38-CONTEXT.md
@.planning/phases/38-schema-wms-engine-foundation/38-01-SUMMARY.md
@.planning/phases/38-schema-wms-engine-foundation/38-02-SUMMARY.md
@.planning/phases/39-classbreak-form-ui-auto-suggest/39-03-SUMMARY.md

# Source files Phase 40-01 reads
@kinetica_bi/src/lib/wmsUrlBuilder.ts
@kinetica_bi/src/lib/trackDetect.ts
@kinetica_bi/src/lib/colorHex.ts
@kinetica_bi/src/components/charts/CbConfigForm.tsx
@kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->
<!-- Executor uses these directly — no codebase exploration needed. -->

From kinetica_bi/src/lib/wmsUrlBuilder.ts (Phase 38 — KEEP signatures byte-identical when re-exported):
```typescript
// Lines 36-46 — to be MOVED to lib/trackConfig.ts:
export type TrackConfig = {
  enabled: boolean;
  trackIdAttr?: string;       // default "TRACKID" when omitted at emission time
  trackOrderAttr?: string;    // default "TIMESTAMP" when omitted at emission time
  headColor?: string;         // 8-char AARRGGBB
  trailColor?: string;        // 8-char AARRGGBB
  headSize?: number;
  trailSize?: number;         // emitted as TRACKLINEWIDTHS
  lineWidth?: number;         // alias for trailSize; trailSize takes precedence when both set
  headShape?: string;
};

// Lines 49-60 — to be MOVED to lib/trackConfig.ts:
export function coalesceTrackConfig(raw: string | null): TrackConfig {
  if (raw === null) return { enabled: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "enabled" in parsed) {
      return parsed as TrackConfig;
    }
    return { enabled: false };
  } catch {
    return { enabled: false };
  }
}

// Lines 62-89 — STAY in wmsUrlBuilder.ts (raster pointShape picker also imports this):
export type PointShape = "none" | "circle" | "dash" | "diamond" | "dot"
  | "hollowcircle" | "hollowdiamond" | "hollowsquare" | "hollowsquarewithplus"
  | "pipe" | "plus" | "square";
export const POINT_SHAPES: PointShape[] = [
  "none", "circle", "dash", "diamond", "dot",
  "hollowcircle", "hollowdiamond", "hollowsquare", "hollowsquarewithplus",
  "pipe", "plus", "square",
];

// Line 440 — Phase 38 callsite (UNCHANGED by Plan 40-01):
const tc = coalesceTrackConfig(layerJsonFields.track_config);
```

From kinetica_bi/src/lib/trackDetect.ts (Phase 38 — READ ONLY):
```typescript
export type TrackColumns = {
  trackIdCol: string;
  xCol: string;
  yCol: string;
  orderCol: string;
};

// Strict 4-name case-insensitive: TRACKID + x + y + TIMESTAMP. NO aliases.
// Returns matched column names (preserving original casing) when all 4 present; else null.
export function isTrackTable(columns: { name: string }[]): TrackColumns | null;
```

From kinetica_bi/src/lib/colorHex.ts (existing):
```typescript
export function normalizeAARRGGBB(input: string, fallback?: string): string;
export function rgbFromAARRGGBB(aarrggbb: string): string;     // returns 6-char RGB
export function alphaFromAARRGGBB(aarrggbb: string): string;   // returns 2-char AA
export function joinAARRGGBB(alphaAA: string, rgbRRGGBB: string): string;
```

From kinetica_bi/src/components/charts/CbConfigForm.tsx (Phase 39 — PRECEDENT — mirror the structure):
```typescript
// Lines 44-54 — Phase 40 mirrors this shape MINUS schema/tableName/tableRef (no server calls):
type CbConfigFormProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: Column[];
  isValid?: (valid: boolean) => void;
  tableRef?: string;
  schema?: string;
  tableName?: string;
};

// Lines 108-114 — patchCb pattern; Phase 40 mirrors as patchTrack:
const patchCb = useCallback(
  (next: CbConfig) => {
    onChange({ ...config, cb_config: JSON.stringify(next) });
  },
  [config, onChange],
);
```

From kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (raster pointColor two-control AARRGGBB pattern — MIRROR VERBATIM for headColor + trailColor):
```jsx
{/* Two-control AARRGGBB pattern. Phase 40 mirrors verbatim. */}
<div className="config-color-row">
  <input
    type="color"
    className="config-color-picker"
    aria-label="Head color (RGB)"
    value={`#${rgbFromAARRGGBB(trackConfig.headColor || "FFFF0000")}`}
    onChange={(e) =>
      patchTrack({
        ...trackConfig,
        headColor: joinAARRGGBB(
          alphaFromAARRGGBB(trackConfig.headColor || "FFFF0000"),
          e.target.value.replace("#", ""),
        ),
      })
    }
  />
  <input
    type="text"
    className="config-color-text"
    aria-label="Head color (AARRGGBB hex)"
    value={normalizeAARRGGBB(trackConfig.headColor || "FFFF0000")}
    onChange={(e) =>
      patchTrack({
        ...trackConfig,
        headColor: normalizeAARRGGBB(e.target.value, "FFFF0000"),
      })
    }
  />
</div>
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract lib/trackConfig.ts helper + back-compat re-export from wmsUrlBuilder.ts</name>
  <files>
    kinetica_bi/src/lib/trackConfig.ts,
    kinetica_bi/src/lib/trackConfig.spec.ts,
    kinetica_bi/src/lib/wmsUrlBuilder.ts
  </files>
  <read_first>
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (lines 1-100 for TrackConfig + coalesceTrackConfig source; line 440 for callsite verification)
    - kinetica_bi/src/lib/mapInfoConfig.ts (precedent helper-module shape — Phase 19)
    - kinetica_bi/src/lib/cbConfig.ts (precedent helper-module shape — Phase 38)
  </read_first>
  <behavior>
    Tests in `lib/trackConfig.spec.ts` (vitest, mirrors `cbConfig.spec.ts` pattern):
    - Test 1: `coalesceTrackConfig(null)` returns `{ enabled: false }`
    - Test 2: `coalesceTrackConfig("not valid json")` returns `{ enabled: false }`
    - Test 3: `coalesceTrackConfig("{}")` returns `{ enabled: false }` (missing `enabled` key)
    - Test 4: `coalesceTrackConfig('{"enabled":false}')` returns `{ enabled: false }`
    - Test 5: `coalesceTrackConfig('{"enabled":true,"trackIdAttr":"trackid","trackOrderAttr":"ts","headColor":"FFAA0000","trailColor":"FF0000AA","headSize":10,"trailSize":3,"headShape":"square"}')` returns object with all fields verbatim
    - Test 6: `TRACK_DEFAULTS` constant exports literal object `{ headColor: "FFFF0000", trailColor: "FF0000FF", headSize: 8, trailSize: 2, headShape: "circle" }` — assert each field with `.toBe()` byte-exact
    - Test 7: TrackConfig type is exported (compile-time check via `expectTypeOf` or simple assignment in spec)
  </behavior>
  <action>
    Create `kinetica_bi/src/lib/trackConfig.ts` with EXACTLY the following exports (zero behavior change from current wmsUrlBuilder.ts:36-60):

    ```typescript
    /**
     * Phase 40: lib/trackConfig.ts — extracted from wmsUrlBuilder.ts (Phase 38).
     *
     * Pure helper module for track_config JSON parsing + form defaults.
     * Phase 38 kept these inline; Phase 40 form UI is the 2nd consumer (per Phase 38
     * CONTEXT.md "Phase 40 may extract if a 2nd consumer surfaces"), so the
     * extraction earns its keep.
     *
     * Backward-compat: `wmsUrlBuilder.ts` re-exports TrackConfig + coalesceTrackConfig
     * so the line-440 callsite and any Phase 38 spec imports continue to resolve
     * without churn.
     */

    export type TrackConfig = {
      enabled: boolean;
      trackIdAttr?: string;       // default "TRACKID" when omitted at emission time
      trackOrderAttr?: string;    // default "TIMESTAMP" when omitted at emission time
      headColor?: string;         // 8-char AARRGGBB
      trailColor?: string;        // 8-char AARRGGBB
      headSize?: number;
      trailSize?: number;         // emitted as TRACKLINEWIDTHS
      lineWidth?: number;         // alias for trailSize; trailSize takes precedence when both set
      headShape?: string;
    };

    /** Parse raw track_config JSON. Returns { enabled: false } on null or parse failure. */
    export function coalesceTrackConfig(raw: string | null): TrackConfig {
      if (raw === null) return { enabled: false };
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "enabled" in parsed) {
          return parsed as TrackConfig;
        }
        return { enabled: false };
      } catch {
        return { enabled: false };
      }
    }

    /**
     * Form defaults applied when the override checkbox flips enabled false→true and
     * the corresponding field is currently undefined. Each default is applied
     * INDEPENDENTLY per field — only undefined fields get seeded; operator-set values
     * are preserved verbatim.
     *
     * Color defaults mirror wmsUrlBuilder Track-block emission defaults (line ~440-470).
     * Size defaults: head visibly larger than trail by default.
     * Shape default: circle (the only safe spike-confirmed default).
     */
    export const TRACK_DEFAULTS = {
      headColor: "FFFF0000",   // red
      trailColor: "FF0000FF",  // blue
      headSize: 8,
      trailSize: 2,
      headShape: "circle",
    } as const;
    ```

    Then DELETE lines 36-60 from `kinetica_bi/src/lib/wmsUrlBuilder.ts` and REPLACE with a back-compat re-export line immediately after the existing imports block (around line 28). The exact text to insert:

    ```typescript
    // Phase 40: TrackConfig + coalesceTrackConfig moved to lib/trackConfig.ts.
    // Re-export here so the line-440 callsite + any Phase 38 spec imports keep working.
    export { type TrackConfig, coalesceTrackConfig } from "./trackConfig";
    ```

    Verify line 440 (`const tc = coalesceTrackConfig(layerJsonFields.track_config);`) still type-checks — the re-export brings the symbol into local scope identically.

    Write the spec file `kinetica_bi/src/lib/trackConfig.spec.ts`. Mirror the structure of `kinetica_bi/src/lib/cbConfig.spec.ts` (existing) — vitest `describe("coalesceTrackConfig", ...)` block + a `describe("TRACK_DEFAULTS", ...)` block. Tests 1-7 from `<behavior>` above. Use `.toEqual(...)` for object comparisons, `.toBe(...)` for primitive byte-exact assertions.

    DO NOT modify the Track block emission code in wmsUrlBuilder.ts (lines ~428-472). DO NOT touch `POINT_SHAPES` / `PointShape` (raster picker still imports from wmsUrlBuilder.ts).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/trackConfig.spec.ts --reporter=basic 2>&1 | tail -20 &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/lib/trackConfig.ts` exists with the EXACT export shape above (`grep -c "^export" kinetica_bi/src/lib/trackConfig.ts` returns 3 — TrackConfig type, coalesceTrackConfig, TRACK_DEFAULTS)
    - `grep "export.*coalesceTrackConfig.*from.*\\./trackConfig" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns exactly 1 match
    - `grep -c "^export type TrackConfig\\|^export function coalesceTrackConfig" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 0 (original definitions removed; only re-export remains)
    - `grep "coalesceTrackConfig(layerJsonFields.track_config)" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns 1 match (line ~440 callsite preserved)
    - `npx vitest run src/lib/trackConfig.spec.ts` exits 0 with 7 passing tests
    - `npx vitest run src/lib/wmsUrlBuilder.spec.ts` still exits 0 (no Phase 38 regression — back-compat re-export proves out)
    - `npx tsc --noEmit` exits 0
    - `grep "TRACK_DEFAULTS" kinetica_bi/src/lib/trackConfig.ts | grep -c 'FFFF0000\\|FF0000FF\\|headSize.*8\\|trailSize.*2\\|circle'` returns ≥ 5 (defaults match Implementation Decisions table)
  </acceptance_criteria>
  <done>
    `lib/trackConfig.ts` is the canonical source for TrackConfig + coalesceTrackConfig; wmsUrlBuilder.ts re-exports for back-compat; spec passes 7/7; tsc clean; zero Phase 38 regressions.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship TrackSubSection.tsx component + companion spec (dormant — no host mount yet)</name>
  <files>
    kinetica_bi/src/components/charts/TrackSubSection.tsx,
    kinetica_bi/src/components/charts/TrackSubSection.spec.tsx
  </files>
  <read_first>
    - kinetica_bi/src/lib/trackConfig.ts (Task 1 deliverable — import target)
    - kinetica_bi/src/lib/trackDetect.ts (Phase 38 — import isTrackTable)
    - kinetica_bi/src/lib/colorHex.ts (existing — import normalizeAARRGGBB, rgbFromAARRGGBB, alphaFromAARRGGBB, joinAARRGGBB)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (Phase 38 — import POINT_SHAPES, type PointShape)
    - kinetica_bi/src/components/charts/CbConfigForm.tsx (Phase 39 precedent — full file; mirror structure)
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx (Phase 39 precedent — mirror spec patterns)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (lines 825-893 heatmap pattern; lines 832-859 if present — raster pointColor two-control)
  </read_first>
  <behavior>
    Tests in `TrackSubSection.spec.tsx` (vitest + @testing-library/react). Use `describe("TrackSubSection", ...)` outer block with the following nested groups. Each test imports default `TrackSubSection` and uses a `render(<TrackSubSection config={...} onChange={onChange} columns={...} isValid={isValid} />)` helper. `onChange = vi.fn()`, `isValid = vi.fn()`.

    **Helper baselines:**
    - `baseColumns = [{ name: "TRACKID", type: "INT" }, { name: "x", type: "DOUBLE" }, { name: "y", type: "DOUBLE" }, { name: "TIMESTAMP", type: "TIMESTAMP" }, { name: "vendor_id", type: "VARCHAR" }]` (4 track columns + 1 extra)
    - `nonTrackColumns = [{ name: "lon", type: "DOUBLE" }, { name: "lat", type: "DOUBLE" }, { name: "ts", type: "TIMESTAMP" }, { name: "vendor_id", type: "VARCHAR" }]` (no TRACKID/x/y/TIMESTAMP)
    - `emptyConfig = { track_config: null }`
    - `enabledConfig = { track_config: JSON.stringify({ enabled: true, trackIdAttr: "TRACKID", trackOrderAttr: "TIMESTAMP", headColor: "FFFF0000", trailColor: "FF0000FF", headSize: 8, trailSize: 2, headShape: "circle" }) }`

    **Group A — Auto-detect + override checkbox (TRACK-V17-01, TRACK-V17-02):**
    - A1: track-shape columns + null track_config → checkbox is CHECKED, "(auto-detected)" text visible
    - A2: track-shape columns + null track_config → onChange called with track_config JSON containing `enabled:true` AND trackIdAttr="TRACKID" AND trackOrderAttr="TIMESTAMP" AND headColor="FFFF0000" AND trailColor="FF0000FF" AND headSize=8 AND trailSize=2 AND headShape="circle"
    - A3: non-track columns + null track_config → checkbox is UNCHECKED, NO "(auto-detected)" text, NO auto-seeding onChange call
    - A4: non-track columns + persisted track_config `{enabled:true,trackIdAttr:"lon",...}` → checkbox is CHECKED, no "(auto-detected)" text
    - A5: track-shape columns + persisted `{enabled:false}` → checkbox is UNCHECKED, "(auto-detected)" text VISIBLE (hint is informational, never tied to enabled state)
    - A6: track-shape columns + persisted `{enabled:true, ...customFields}` → useEffect MUST NOT overwrite — assert onChange NOT called with the auto-seed default values (custom field values preserved)
    - A7: empty columns array → checkbox visible but UNCHECKED, no "(auto-detected)" text, no auto-seed

    **Group B — Field rendering when enabled (TRACK-V17-04):**
    - B1: enabledConfig → 7 form controls present: trackIdAttr select, trackOrderAttr select, headColor color+text pair, headSize number input, headShape select, trailColor color+text pair, Line width number input (use `getByLabelText` for each label string verbatim)
    - B2: trackIdAttr select shows non-spatial-bound columns; config with `{xColumn:"x",yColumn:"y"}` excludes "x" and "y" from trackIdAttr options but trackOrderAttr options DO include "x" and "y"
    - B3: trackOrderAttr select shows ALL columns (no exclusion)
    - B4: headShape select renders ALL 12 POINT_SHAPES values as options (assert by `getAllByRole("option")` inside the shape select scope; count === 13 including the empty placeholder)
    - B5: headSize input has attributes `min={1} max={20}` and `type="number"`; default displayed value = 8
    - B6: Line width input has attributes `min={1} max={20}` and `type="number"`; default displayed value = 2; label text is exactly "Line width" (not "Trail size")
    - B7: when enabled=false (override unchecked), NONE of the 7 form controls render (only the checkbox + label)

    **Group C — Color picker two-control AARRGGBB (TRACK-V17-04):**
    - C1: headColor color picker `<input type="color">` has value=`#ff0000` when trackConfig.headColor === "FFFF0000" (rgbFromAARRGGBB strips alpha)
    - C2: headColor text input has value="FFFF0000" when trackConfig.headColor === "FFFF0000"
    - C3: editing the color picker fires onChange with track_config containing headColor with preserved alpha byte (alpha was "FF" → stays "FF" after color picker write)
    - C4: editing the text input to "AA112233" fires onChange with track_config containing headColor === "AA112233"
    - C5: typing invalid text "zzz" + blur → normalizeAARRGGBB falls back to "FFFF0000" default (assert via onChange call argument)

    **Group D — Override checkbox state transitions (TRACK-V17-02, TRACK-V17-06):**
    - D1: enabled=true → click checkbox → onChange fires with track_config containing `enabled:false` AND ALL OTHER FIELDS PRESERVED VERBATIM (trackIdAttr/trackOrderAttr/headColor/trailColor/headSize/trailSize/headShape values from input config)
    - D2: enabled=false but other fields populated → click checkbox → onChange fires with track_config containing `enabled:true` AND prior field values still present
    - D3: enabled=false + null track_config + non-track columns → click checkbox → onChange fires with track_config containing `enabled:true` AND all TRACK_DEFAULTS seeded (trackIdAttr falls back to "TRACKID" because isTrackTable returned null)
    - D4: enabled=false + null track_config + track-shape columns → click checkbox → onChange fires with track_config containing trackIdAttr from `isTrackTable(columns)?.trackIdCol` (preserving matched casing from baseColumns)

    **Group E — Field-level mutations:**
    - E1: enabled=true → change trackIdAttr select to "vendor_id" → onChange fires with track_config containing `trackIdAttr:"vendor_id"`
    - E2: enabled=true → change headSize number input to 15 → onChange fires with track_config containing `headSize:15`
    - E3: enabled=true → change Line width input to 7 → onChange fires with track_config containing `trailSize:7` AND no `lineWidth` field write (assert via JSON parse + `"lineWidth" in parsed === false` OR parsed.lineWidth === undefined)
    - E4: enabled=true → change headShape select to "square" → onChange fires with track_config containing `headShape:"square"`

    **Group F — isValid + persistence round-trip (TRACK-V17-06):**
    - F1: isValid is called with true on mount (assert `expect(isValid).toHaveBeenCalledWith(true)`)
    - F2: enabled=true, any field-mutation → isValid still called with true (no required-completeness gate)
    - F3: persistence smoke: render with enabledConfig → assert all displayed values match the persisted track_config (trackIdAttr select value === "TRACKID", headColor text input value === "FFFF0000", headSize input value === "8", etc.) — verifies coalesceTrackConfig + read path round-trips

    Total: ~25 tests minimum.
  </behavior>
  <action>
    Create `kinetica_bi/src/components/charts/TrackSubSection.tsx`. The file is a pure controlled React component with NO server calls, NO Zustand subscriptions inside the component (callers pass config). Default export.

    **Imports (exact paths):**
    ```typescript
    import { useCallback, useEffect, useMemo } from "react";
    import type { Column } from "../../lib/columnTypes";
    import { isTrackTable } from "../../lib/trackDetect";
    import {
      coalesceTrackConfig,
      TRACK_DEFAULTS,
      type TrackConfig,
    } from "../../lib/trackConfig";
    import { POINT_SHAPES } from "../../lib/wmsUrlBuilder";
    import {
      normalizeAARRGGBB,
      rgbFromAARRGGBB,
      alphaFromAARRGGBB,
      joinAARRGGBB,
    } from "../../lib/colorHex";
    ```

    **Props (mirror CbConfigForm MINUS schema/tableName/tableRef — no server calls):**
    ```typescript
    type TrackSubSectionProps = {
      config: Record<string, unknown>;
      onChange: (config: Record<string, unknown>) => void;
      columns?: Column[];
      isValid?: (valid: boolean) => void;
    };

    export default function TrackSubSection({
      config,
      onChange,
      columns = [],
      isValid,
    }: TrackSubSectionProps): JSX.Element { ... }
    ```

    **Internal state derivation (NOT useState — purely derived from props, mirrors CbConfigForm.tsx:108-114):**
    ```typescript
    const trackConfig: TrackConfig = useMemo(
      () => coalesceTrackConfig((config.track_config as string | null) ?? null),
      [config.track_config],
    );

    const detectedColumns = useMemo(() => isTrackTable(columns), [columns]);

    const patchTrack = useCallback(
      (next: TrackConfig) => {
        onChange({ ...config, track_config: JSON.stringify(next) });
      },
      [config, onChange],
    );
    ```

    **Auto-detect useEffect (TRACK-V17-01, fires ONLY on columns change, ONLY when track_config is null — Pitfall 4 lock):**
    ```typescript
    useEffect(() => {
      const detected = isTrackTable(columns);
      const hasPersistedState = (config.track_config as string | null) !== null;
      if (detected && !hasPersistedState) {
        patchTrack({
          enabled: true,
          trackIdAttr: detected.trackIdCol,
          trackOrderAttr: detected.orderCol,
          headColor: TRACK_DEFAULTS.headColor,
          trailColor: TRACK_DEFAULTS.trailColor,
          headSize: TRACK_DEFAULTS.headSize,
          trailSize: TRACK_DEFAULTS.trailSize,
          headShape: TRACK_DEFAULTS.headShape,
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columns]);
    // NOTE: patchTrack + config.track_config intentionally EXCLUDED from deps —
    // auto-seed fires on columns-change only (mirrors CbConfigForm cardinality probe pattern).
    ```

    **isValid useEffect (TRACK-V17-04 — always true):**
    ```typescript
    useEffect(() => {
      isValid?.(true);
    }, [isValid]);
    ```

    **Override checkbox handler:**
    ```typescript
    const onToggleEnabled = (checked: boolean) => {
      if (!checked) {
        // Preserve all fields; only flip enabled.
        patchTrack({ ...trackConfig, enabled: false });
        return;
      }
      // Re-enable: seed defaults for undefined fields, preserve operator-set values.
      patchTrack({
        trackIdAttr: detectedColumns?.trackIdCol ?? "TRACKID",
        trackOrderAttr: detectedColumns?.orderCol ?? "TIMESTAMP",
        headColor: TRACK_DEFAULTS.headColor,
        trailColor: TRACK_DEFAULTS.trailColor,
        headSize: TRACK_DEFAULTS.headSize,
        trailSize: TRACK_DEFAULTS.trailSize,
        headShape: TRACK_DEFAULTS.headShape,
        ...trackConfig,  // operator-set values override defaults
        enabled: true,
      });
    };
    ```

    **Column eligibility (trackIdAttr excludes spatial-bound):**
    ```typescript
    const spatialBound = useMemo(() => {
      const s = new Set<string>();
      const xCol = (config.xColumn as string) ?? "";
      const yCol = (config.yColumn as string) ?? "";
      const wktCol = (config.spatialColumn as string) ?? "";
      if (xCol) s.add(xCol);
      if (yCol) s.add(yCol);
      if (wktCol) s.add(wktCol);
      return s;
    }, [config.xColumn, config.yColumn, config.spatialColumn]);

    const trackIdColumns = useMemo(
      () => columns.filter((c) => !spatialBound.has(c.name)),
      [columns, spatialBound],
    );
    // trackOrderAttr: ALL columns (no exclusion) — operator-locked per CONTEXT.md
    ```

    **JSX structure (single config-group, override checkbox always visible, content gated by enabled):**
    ```jsx
    <div className="config-group" role="group" aria-labelledby="map-track-params-label">
      <label id="map-track-params-label" className="config-group-label">
        TRACK PARAMS
      </label>

      <label className="config-toggle">
        <input
          type="checkbox"
          aria-label="Treat as track table"
          checked={trackConfig.enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
        />
        Treat as track table
        {detectedColumns !== null && (
          <span className="config-hint config-hint-inline" data-testid="track-auto-detected-hint">
            {" (auto-detected)"}
          </span>
        )}
      </label>

      {trackConfig.enabled && (
        <>
          {/* Track ID column */}
          <label className="config-field">
            Track ID column
            <select
              className="ds-select"
              aria-label="Track ID column"
              value={trackConfig.trackIdAttr ?? ""}
              disabled={columns.length === 0}
              onChange={(e) => patchTrack({ ...trackConfig, trackIdAttr: e.target.value || undefined })}
            >
              <option value="">— select —</option>
              {trackIdColumns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>

          {/* Track order column */}
          <label className="config-field">
            Track order column
            <select
              className="ds-select"
              aria-label="Track order column"
              value={trackConfig.trackOrderAttr ?? ""}
              disabled={columns.length === 0}
              onChange={(e) => patchTrack({ ...trackConfig, trackOrderAttr: e.target.value || undefined })}
            >
              <option value="">— select —</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>

          {/* Head color — two-control AARRGGBB (verbatim from raster pointColor) */}
          <label className="config-color-field">
            Head color
            <div className="config-color-row">
              <input
                type="color"
                className="config-color-picker"
                aria-label="Head color (RGB)"
                value={`#${rgbFromAARRGGBB(trackConfig.headColor || TRACK_DEFAULTS.headColor)}`}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    headColor: joinAARRGGBB(
                      alphaFromAARRGGBB(trackConfig.headColor || TRACK_DEFAULTS.headColor),
                      e.target.value.replace("#", ""),
                    ),
                  })
                }
              />
              <input
                type="text"
                className="config-color-text"
                aria-label="Head color (AARRGGBB hex)"
                value={normalizeAARRGGBB(trackConfig.headColor || TRACK_DEFAULTS.headColor)}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    headColor: normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.headColor),
                  })
                }
              />
            </div>
          </label>

          {/* Head size */}
          <label className="config-field">
            Head size
            <input
              type="number"
              className="ds-input"
              aria-label="Head size"
              min={1}
              max={20}
              value={trackConfig.headSize ?? TRACK_DEFAULTS.headSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const clamped = isNaN(v) ? TRACK_DEFAULTS.headSize : Math.max(1, Math.min(20, v));
                patchTrack({ ...trackConfig, headSize: clamped });
              }}
            />
          </label>

          {/* Head shape — full 12-value POINT_SHAPES */}
          <label className="config-field">
            Head shape
            <select
              className="ds-select"
              aria-label="Head shape"
              value={trackConfig.headShape ?? TRACK_DEFAULTS.headShape}
              onChange={(e) => patchTrack({ ...trackConfig, headShape: e.target.value })}
            >
              <option value="">— select —</option>
              {POINT_SHAPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          {/* Trail color — two-control AARRGGBB */}
          <label className="config-color-field">
            Trail color
            <div className="config-color-row">
              <input
                type="color"
                className="config-color-picker"
                aria-label="Trail color (RGB)"
                value={`#${rgbFromAARRGGBB(trackConfig.trailColor || TRACK_DEFAULTS.trailColor)}`}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    trailColor: joinAARRGGBB(
                      alphaFromAARRGGBB(trackConfig.trailColor || TRACK_DEFAULTS.trailColor),
                      e.target.value.replace("#", ""),
                    ),
                  })
                }
              />
              <input
                type="text"
                className="config-color-text"
                aria-label="Trail color (AARRGGBB hex)"
                value={normalizeAARRGGBB(trackConfig.trailColor || TRACK_DEFAULTS.trailColor)}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    trailColor: normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.trailColor),
                  })
                }
              />
            </div>
          </label>

          {/* Line width — single field writing to trailSize (NOT lineWidth) */}
          <label className="config-field">
            Line width
            <input
              type="number"
              className="ds-input"
              aria-label="Line width"
              min={1}
              max={20}
              value={trackConfig.trailSize ?? TRACK_DEFAULTS.trailSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const clamped = isNaN(v) ? TRACK_DEFAULTS.trailSize : Math.max(1, Math.min(20, v));
                // CRITICAL: writes to trailSize ONLY. Never lineWidth — Phase 40 CONTEXT lock.
                patchTrack({ ...trackConfig, trailSize: clamped });
              }}
            />
          </label>
        </>
      )}
    </div>
    ```

    **Anti-patterns to AVOID (Phase 40 RESEARCH §"Anti-Patterns to Avoid"):**
    - Do NOT write to `trackConfig.lineWidth` (only `trailSize`)
    - Do NOT auto-disable on field clearing
    - Do NOT modify wmsUrlBuilder Track block
    - Do NOT add WKB-column gate (track detection is column-name-based)
    - Do NOT add `'(none)'` special-case for headShape (headSize=0 is the no-marker control; `'none'` IS in POINT_SHAPES as one of the 12 values)
    - Do NOT reset track_config on render-mode flip (Plan 40-02 mounts the gate)

    Then create `kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` with the ~25 tests described in `<behavior>`. Imports:
    ```typescript
    import { describe, it, expect, vi, beforeEach } from "vitest";
    import { render, screen, fireEvent } from "@testing-library/react";
    import "@testing-library/jest-dom";
    import TrackSubSection from "./TrackSubSection";
    ```

    Define `baseColumns`, `nonTrackColumns`, `emptyConfig`, `enabledConfig` helpers at top of file. Use `describe` blocks for Groups A through F as documented. For each `onChange`-asserting test, parse the JSON via `JSON.parse(onChange.mock.calls[N][0].track_config)` and assert specific fields.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/TrackSubSection.spec.tsx --reporter=basic 2>&amp;1 | tail -30 &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/TrackSubSection.tsx` exists; line count ≥ 250
    - `grep -c "^import" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 5 (React hooks, columnTypes, trackDetect, trackConfig, wmsUrlBuilder, colorHex)
    - `grep "lineWidth" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns 0 matches in code paths that WRITE to it (only Pitfall comment may mention it as forbidden) — verify with `grep "trackConfig\\.lineWidth\\s*=\\|lineWidth:" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns 0
    - `grep -c "trailSize" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 4 (read default, write in Line width onChange, write in re-enable seed, default constant)
    - `grep -c "POINT_SHAPES" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 1
    - `grep -c "isTrackTable" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 2 (detectedColumns useMemo + useEffect call)
    - `grep -c "auto-detected" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 1
    - `grep -c "Treat as track table" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 1
    - `grep -c "TRACK_DEFAULTS" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 5
    - `grep -c "Line width" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns ≥ 2 (label + aria-label)
    - `grep -c "config-color-row" kinetica_bi/src/components/charts/TrackSubSection.tsx` returns 2 (headColor + trailColor)
    - `kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` exists; line count ≥ 350
    - `grep -c "describe(" kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` returns ≥ 6 (Group A-F sub-describes plus outer)
    - `grep -c "^\\s*it(" kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` returns ≥ 25
    - `npx vitest run src/components/charts/TrackSubSection.spec.tsx` exits 0 with all tests green
    - `npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx` exits 0 (Plan 40-01 does NOT modify the host form — zero regressions expected here)
    - `npx tsc --noEmit` exits 0
    - `grep "TrackSubSection" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 0 (component is dormant — no mount yet; Plan 40-02 wires it in)
  </acceptance_criteria>
  <done>
    `TrackSubSection.tsx` exists as a dormant pure component (zero host-form imports), `TrackSubSection.spec.tsx` covers all 6 TRACK-V17 REQ IDs at the component level (everything except the host-mount gating from TRACK-V17-03 and the fingerprint regression from TRACK-V17-05), all tests green, tsc clean. Phase 40-02 wires the component into the host form and adds the fingerprint regression spec.
  </done>
</task>

</tasks>

<verification>
**Phase-level checks (Plan 40-01 alone):**

1. `cd kinetica_bi && npx vitest run src/lib/trackConfig.spec.ts src/components/charts/TrackSubSection.spec.tsx --reporter=basic` → ALL GREEN
2. `cd kinetica_bi && npx vitest run --reporter=basic` → full frontend suite green (no Phase 38 regressions; existing wmsUrlBuilder.spec.ts still passes via re-export)
3. `cd kinetica_bi && npx tsc --noEmit -p tsconfig.json` → exit 0
4. `grep "coalesceTrackConfig" kinetica_bi/src/lib/wmsUrlBuilder.ts` returns ≥ 2 (re-export line + line-440 callsite)
5. `grep "TrackSubSection" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` returns 0 (DORMANT)
</verification>

<success_criteria>
- `lib/trackConfig.ts` is the canonical home for `TrackConfig` + `coalesceTrackConfig` + `TRACK_DEFAULTS`; `wmsUrlBuilder.ts` re-exports for back-compat
- `TrackSubSection.tsx` ships as a complete, fully-tested pure component (~250+ lines) implementing the full 7-input + override-checkbox + auto-detect + persistence form per CONTEXT.md locks
- All 25+ component spec tests green; all 7 helper unit tests green; tsc clean; full frontend suite still green
- Component is DORMANT — zero references in `KineticaWmsLayerForm.tsx` — Plan 40-02 wires it in next wave
</success_criteria>

<output>
After completion, create `.planning/phases/40-track-sub-section-ui/40-01-SUMMARY.md` per the SUMMARY template.

Required sections:
- Performance metrics (duration, tasks, files modified)
- Accomplishments (Task 1 helper extraction + back-compat re-export, Task 2 component + spec)
- Test surface (count + grouping)
- TRACK-V17-01/02/04/06 coverage map (which spec test asserts which REQ-ID)
- Deviations from plan (any auto-fixes during execution)
- Self-check (grep counts matching acceptance_criteria above)
</output>
