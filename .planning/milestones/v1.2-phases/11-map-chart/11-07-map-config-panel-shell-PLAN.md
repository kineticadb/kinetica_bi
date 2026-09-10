---
phase: 11-map-chart
plan: 07
type: execute
wave: 3
depends_on:
  - 11-02
  - 11-03
  - 11-05
files_modified:
  - kinetica_bi/src/components/charts/MapConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
  - kinetica_bi/src/components/charts/definitions/map.ts
autonomous: true
requirements:
  - MAP-01
  - MAP-02
  - MAP-04
must_haves:
  truths:
    - "Opening a map widget's config modal renders MapConfigPanel via the CustomConfigPanel registry slot"
    - "Spatial mode picker shows 3 radios with locked UI-SPEC labels (Latitude / Longitude pair, WKT geometry column, Kinetica geometry column)"
    - "Spatial mode picker shows ONLY the modes returned by useWmsCapabilitiesStore (with all-modes fallback)"
    - "On first modal open with no widget.config.spatialMode, autoSuggestSpatialMode is invoked and the result is staged with an Auto-detected hint"
    - "Spatial column dropdowns filter via getValidSpatialColumns(columns, mode); switching modes preserves prior column picks per mode (latColumn/lonColumn/wktColumn/wkbColumn are independent slots)"
    - "Render mode picker shows 4 radios with locked labels — only the modes returned by useWmsCapabilitiesStore"
    - "Basemap picker shows 3 radios with locked labels (OpenStreetMap, CartoDB Voyager, CartoDB Dark Matter)"
    - "Apply commits to draft via parent setDraft; Cancel discards (existing ChartConfigPanel CustomConfigPanel pattern)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      provides: "MapConfigPanel React component covering spatial-mode + render-mode + basemap pickers (mode-specific param groups land in 11-08)"
      min_lines: 200
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx"
      provides: "Tests for picker behavior + auto-suggest + per-mode column preservation + capability gating"
      contains: "describe(\"MapConfigPanel"
    - path: "kinetica_bi/src/components/charts/definitions/map.ts"
      provides: "CustomConfigPanel: MapConfigPanel attached"
      contains: "CustomConfigPanel: MapConfigPanel"
  key_links:
    - from: "kinetica_bi/src/components/charts/definitions/map.ts (CustomConfigPanel field)"
      to: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      via: "named import"
      pattern: "CustomConfigPanel: MapConfigPanel"
    - from: "MapConfigPanel.tsx"
      to: "useWmsCapabilitiesStore (capabilities.renderModes + capabilities.spatialModes)"
      via: "selector"
      pattern: "useWmsCapabilitiesStore"
    - from: "MapConfigPanel.tsx"
      to: "src/lib/columnTypes.ts (getValidSpatialColumns + autoSuggestSpatialMode)"
      via: "named import"
      pattern: "getValidSpatialColumns|autoSuggestSpatialMode"
    - from: "ChartConfigPanel.tsx CustomConfigPanel slot"
      to: "MapConfigPanel.tsx"
      via: "registry-driven render"
      pattern: "chartDef.CustomConfigPanel"
---

<objective>
Build the SHELL of `MapConfigPanel.tsx` — the CustomConfigPanel that owns the entire map-widget config schema. This plan ships the spatial-mode picker, render-mode picker, and basemap picker (the THREE foundational radio groups) plus the auto-suggest behavior + per-mode column dropdowns. Mode-specific param groups (raster/heatmap/classbreak/contour) land in 11-08 (sequential dependency).

Splitting this plan from 11-08 keeps each at 2-3 tasks and ~50% context. 11-07 can ship as soon as 11-02, 11-03, 11-05 complete (Wave 3 parallel with 11-06's renderer). 11-08 must wait for this shell.

Purpose: Deliver MAP-02 (spatial-column-mode picker) and the OUTER CHROME of MAP-01 (render-mode picker) + MAP-04 (basemap picker). The renderer (11-06) already reads `widget.config.spatialMode/renderMode/basemap`; this plan provides the UI to set them.

Output: A working CustomConfigPanel that, when opened, displays the three pickers with locked UI-SPEC labels + working column dropdowns + auto-suggest hint + capability gating. Apply persists to widget.config; Cancel discards.
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
@kinetica_bi/src/components/charts/ChartConfigPanel.tsx
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/lib/columnTypes.ts
@kinetica_bi/src/store/wmsCapabilities.ts

<interfaces>
<!-- ChartConfigPanel.tsx CustomConfigPanel slot (lines 159-180) -->
```typescript
if (chartDef.CustomConfigPanel) {
  const Custom = chartDef.CustomConfigPanel;
  return (
    <Custom
      draft={draft}
      setDraft={setDraft}
      columns={allColumns}
      tableId={selectedTable?.id}
      tableRef={selectedTable?.tableRef}
      // ... existing props from CustomConfigPanelProps in registry.ts
    />
  );
}
```

<!-- CustomConfigPanelProps (registry.ts) -->
```typescript
export type CustomConfigPanelProps = {
  draft: Record<string, unknown>;
  setDraft: (next: Record<string, unknown>) => void;
  columns: { name: string; type: string }[];
  tableId?: number;
  tableRef?: string;
  // ... + any other existing props (READ FILE FOR EXACT SHAPE)
};
```

<!-- Phase 10 helpers from columnTypes.ts (Phase 11 11-02 added the bottom two) -->
```typescript
export function getValidSpatialColumns(columns: Column[], mode: SpatialMode): Column[];
export function autoSuggestSpatialMode(columns: Column[]): SpatialMode;
```

<!-- Capabilities store from 11-03 -->
```typescript
const capabilities = useWmsCapabilitiesStore(s => s.capabilities);
// capabilities.renderModes: ("raster" | "heatmap" | "classbreak" | "contour")[]
// capabilities.spatialModes: ("latlon" | "wkt" | "wkb")[]
```

<!-- UI-SPEC.md "Microcopy / Labels" — VERBATIM strings (gsd-ui-checker validates these): -->
<!-- Spatial mode picker section heading: "SPATIAL MODE" -->
<!-- Spatial mode option: lat/lon: "Latitude / Longitude pair" -->
<!-- Spatial mode option: WKT: "WKT geometry column" -->
<!-- Spatial mode option: WKB: "Kinetica geometry column" -->
<!-- Latitude column dropdown label: "Latitude column" -->
<!-- Longitude column dropdown label: "Longitude column" -->
<!-- WKT column dropdown label: "Geometry column (WKT)" -->
<!-- WKB column dropdown label: "Geometry column (Kinetica)" -->
<!-- Auto-suggest hint: "Auto-detected from column types" -->
<!-- Render mode picker section heading: "RENDER MODE" -->
<!-- Render mode option: raster: "Raster (point markers)" -->
<!-- Render mode option: heatmap: "Heatmap (density)" -->
<!-- Render mode option: classbreak: "Classbreak (categorical)" -->
<!-- Render mode option: contour: "Contour (lines)" -->
<!-- Basemap section heading: "BASEMAP" -->
<!-- Basemap option: OSM: "OpenStreetMap" -->
<!-- Basemap option: Voyager: "CartoDB Voyager" -->
<!-- Basemap option: Dark: "CartoDB Dark Matter" -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: TDD — write spec for MapConfigPanel pickers</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx</files>
  <read_first>
    - .planning/phases/11-map-chart/11-UI-SPEC.md ("Microcopy / Labels (config panel)" — every label string is asserted verbatim; "Component-tree shape" — component nesting)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Spatial-column-mode picker" — locked behaviors)
    - kinetica_bi/src/components/charts/registry.ts (CustomConfigPanelProps shape)
    - kinetica_bi/src/lib/columnTypes.ts (helpers from 11-02; SpatialMode type)
    - kinetica_bi/src/store/wmsCapabilities.ts (useWmsCapabilitiesStore from 11-03)
  </read_first>
  <behavior>
    Tests (≥ 12):

    `describe("MapConfigPanel — spatial mode picker")`:
    - `renders 3 radio options when capabilities returns ['latlon','wkt','wkb']` — exact labels: "Latitude / Longitude pair", "WKT geometry column", "Kinetica geometry column"
    - `renders only modes returned by capabilities (e.g. omit wkb if capabilities.spatialModes excludes it)`
    - `auto-suggests mode when draft.spatialMode is unset on first mount` — pass columns with a `geometry`-typed column, expect setDraft to be called with `spatialMode: "wkb"`
    - `does NOT auto-suggest if draft.spatialMode is already set` — verify setDraft NOT called for spatialMode on mount
    - `Auto-detected from column types hint is rendered after auto-suggest, hidden after manual override`
    - `switching from latlon to wkt preserves prior latColumn/lonColumn picks in draft`

    `describe("MapConfigPanel — spatial column dropdowns")`:
    - `latlon mode shows two dropdowns ("Latitude column", "Longitude column") populated from getValidSpatialColumns(cols, "latlon")` — only numeric cols visible
    - `wkt mode shows one dropdown ("Geometry column (WKT)") populated from getValidSpatialColumns(cols, "wkt")` — only string-typed cols visible
    - `wkb mode shows one dropdown ("Geometry column (Kinetica)") populated from getValidSpatialColumns(cols, "wkb")` — only Kinetica-geometry cols visible

    `describe("MapConfigPanel — render mode picker")`:
    - `renders 4 radio options when capabilities returns all 4` — exact labels per UI-SPEC
    - `renders only modes returned by capabilities`
    - `defaults to "raster" when draft.renderMode is unset`

    `describe("MapConfigPanel — basemap picker")`:
    - `renders 3 radio options with exact UI-SPEC labels (OpenStreetMap, CartoDB Voyager, CartoDB Dark Matter)`
    - `selecting an option calls setDraft with basemap key updated`

    `describe("MapConfigPanel — capability fallback")`:
    - `when capabilities is null (still loading), renders all 3 spatial modes + 4 render modes (graceful degradation per CONTEXT.md)`

    Use `@testing-library/react`'s `render` + `fireEvent.click` for radio selection. Mock `useWmsCapabilitiesStore` via `vi.mock`. Make `setDraft` a `vi.fn()`; assert calls with shape `{ spatialMode: "...", ...other previous draft keys }`.
  </behavior>
  <action>
    Step 1 — write `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` with the ≥12 cases.

    Step 2 — run `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` → RED.

    Commit: `test(11-07): add failing spec for MapConfigPanel pickers`.
  </action>
  <acceptance_criteria>
    - File exists with ≥ 12 `it(` cases
    - File contains literal strings: "Latitude / Longitude pair", "WKT geometry column", "Kinetica geometry column", "Auto-detected from column types", "Raster (point markers)", "Heatmap (density)", "Classbreak (categorical)", "Contour (lines)", "OpenStreetMap", "CartoDB Voyager", "CartoDB Dark Matter"
    - vitest exits non-zero (RED)
    - Commit message starts with `test(11-07):`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx; test $? -ne 0</automated>
  </verify>
  <done>≥12 failing tests committed; spec is the source of truth for Task 2.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GREEN — implement MapConfigPanel shell</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.tsx, kinetica_bi/src/components/charts/definitions/map.ts</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (Task 1 spec — implement against it)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (CustomConfigPanel slot at line 159; existing draft/setDraft pattern; existing config-panel JSX classes used by other config panels — REUSE the .config-panel-body, .config-group, .config-group-label classes)
    - .planning/phases/11-map-chart/11-UI-SPEC.md (Component-tree shape; CSS classes; copy)
    - .planning/phases/11-map-chart/11-CONTEXT.md (auto-suggest precedence; per-mode preservation)
    - kinetica_bi/src/lib/columnTypes.ts (helpers + types)
    - kinetica_bi/src/store/wmsCapabilities.ts (selector pattern)
    - kinetica_bi/src/components/charts/definitions/map.ts (current state from 11-05; this plan adds the CustomConfigPanel attachment)
  </read_first>
  <action>
    Step 1 — create `kinetica_bi/src/components/charts/MapConfigPanel.tsx`:

    ```typescript
    // Phase 11: Map widget custom config panel — SHELL (spatial-mode + render-mode + basemap)
    // CONTEXT.md "Decisions § Spatial-column-mode picker" + UI-SPEC.md "Component-tree shape"
    // Mode-specific param groups (raster/heatmap/classbreak/contour) land in plan 11-08.

    import { useEffect, useRef } from "react";
    import {
      getValidSpatialColumns,
      autoSuggestSpatialMode,
      type SpatialMode,
    } from "../../lib/columnTypes";
    import { useWmsCapabilitiesStore } from "../../store/wmsCapabilities";
    import type { CustomConfigPanelProps } from "./registry";

    type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";
    type Basemap = "osm" | "voyager" | "dark";

    const SPATIAL_MODE_LABELS: Record<SpatialMode, string> = {
      latlon: "Latitude / Longitude pair",
      wkt: "WKT geometry column",
      wkb: "Kinetica geometry column",
    };

    const RENDER_MODE_LABELS: Record<RenderMode, string> = {
      raster: "Raster (point markers)",
      heatmap: "Heatmap (density)",
      classbreak: "Classbreak (categorical)",
      contour: "Contour (lines)",
    };

    const BASEMAP_LABELS: Record<Basemap, string> = {
      osm: "OpenStreetMap",
      voyager: "CartoDB Voyager",
      dark: "CartoDB Dark Matter",
    };

    const ALL_SPATIAL_MODES: SpatialMode[] = ["latlon", "wkt", "wkb"];
    const ALL_RENDER_MODES: RenderMode[] = ["raster", "heatmap", "classbreak", "contour"];
    const ALL_BASEMAPS: Basemap[] = ["osm", "voyager", "dark"];

    export default function MapConfigPanel(props: CustomConfigPanelProps): JSX.Element {
      const { draft, setDraft, columns } = props;
      const capabilities = useWmsCapabilitiesStore((s) => s.capabilities);
      const autoSuggestedRef = useRef<boolean>(false);

      // Capability gating with graceful fallback
      const allowedSpatialModes = capabilities?.spatialModes ?? ALL_SPATIAL_MODES;
      const allowedRenderModes = capabilities?.renderModes ?? ALL_RENDER_MODES;

      // Auto-suggest on first mount when spatialMode is unset
      const spatialMode = (draft.spatialMode as SpatialMode | undefined) ?? undefined;
      useEffect(() => {
        if (autoSuggestedRef.current) return;
        if (spatialMode) return; // already set — don't override
        if (columns.length === 0) return; // can't suggest from empty
        autoSuggestedRef.current = true;
        const suggested = autoSuggestSpatialMode(columns);
        setDraft({ ...draft, spatialMode: suggested });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Manual override flag (hides Auto-detected hint)
      const [autoSuggestActive, setAutoSuggestActive] = (() => {
        // Inline state via useRef-based pattern to avoid React.useState import gymnastics
        // (this codebase uses functional components heavily; useRef + setDraft is sufficient).
        // Since draft already tracks the last selection, we use draft.__autoSuggestActive as the flag:
        return [
          (draft as any).__autoSuggestActive !== false && autoSuggestedRef.current && !!spatialMode,
          (active: boolean) => setDraft({ ...draft, __autoSuggestActive: active }),
        ] as const;
      })();
      // NOTE: __autoSuggestActive is a draft-only flag; it is NOT persisted to widget.config since
      // ChartConfigPanel's commit step only writes known schema keys. If commit copies all draft keys
      // verbatim, strip __autoSuggestActive at commit time — but that's ChartConfigPanel's concern,
      // not this panel's. If during integration QA __autoSuggestActive leaks, add a strip step
      // in ChartConfigPanel onApply (small change) — flag in plan summary.

      const onSelectSpatialMode = (mode: SpatialMode) => {
        setAutoSuggestActive(false);
        setDraft({ ...draft, spatialMode: mode });
      };

      const onSelectRenderMode = (mode: RenderMode) => {
        setDraft({ ...draft, renderMode: mode });
      };

      const onSelectBasemap = (b: Basemap) => {
        setDraft({ ...draft, basemap: b });
      };

      // Spatial column pickers — filtered via getValidSpatialColumns
      const validColumns = spatialMode ? getValidSpatialColumns(columns, spatialMode) : [];

      const onPickColumn = (key: string, value: string) => {
        setDraft({ ...draft, [key]: value });
      };

      return (
        <div className="config-panel">
          <div className="config-panel-body">

            {/* SPATIAL MODE */}
            <div className="config-group config-spatial-mode" role="radiogroup" aria-labelledby="map-spatial-mode-label">
              <label id="map-spatial-mode-label" className="config-group-label">SPATIAL MODE</label>
              {ALL_SPATIAL_MODES.filter((m) => allowedSpatialModes.includes(m)).map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="map-spatial-mode"
                    value={m}
                    checked={spatialMode === m}
                    onChange={() => onSelectSpatialMode(m)}
                  />
                  {SPATIAL_MODE_LABELS[m]}
                </label>
              ))}
              {autoSuggestActive && (
                <div className="config-hint">Auto-detected from column types</div>
              )}

              {/* Per-mode column dropdowns */}
              {spatialMode === "latlon" && (
                <>
                  <label className="ds-field-label">
                    Latitude column
                    <select
                      className="ds-select"
                      value={(draft.latColumn as string) || ""}
                      onChange={(e) => onPickColumn("latColumn", e.target.value)}
                    >
                      <option value="">— select —</option>
                      {validColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="ds-field-label">
                    Longitude column
                    <select
                      className="ds-select"
                      value={(draft.lonColumn as string) || ""}
                      onChange={(e) => onPickColumn("lonColumn", e.target.value)}
                    >
                      <option value="">— select —</option>
                      {validColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </label>
                </>
              )}
              {spatialMode === "wkt" && (
                <label className="ds-field-label">
                  Geometry column (WKT)
                  <select
                    className="ds-select"
                    value={(draft.wktColumn as string) || ""}
                    onChange={(e) => onPickColumn("wktColumn", e.target.value)}
                  >
                    <option value="">— select —</option>
                    {validColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
              )}
              {spatialMode === "wkb" && (
                <label className="ds-field-label">
                  Geometry column (Kinetica)
                  <select
                    className="ds-select"
                    value={(draft.wkbColumn as string) || ""}
                    onChange={(e) => onPickColumn("wkbColumn", e.target.value)}
                  >
                    <option value="">— select —</option>
                    {validColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            {/* RENDER MODE */}
            <div className="config-group config-render-mode" role="radiogroup" aria-labelledby="map-render-mode-label">
              <label id="map-render-mode-label" className="config-group-label">RENDER MODE</label>
              {ALL_RENDER_MODES.filter((m) => allowedRenderModes.includes(m)).map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="map-render-mode"
                    value={m}
                    checked={(draft.renderMode as RenderMode) === m}
                    onChange={() => onSelectRenderMode(m)}
                  />
                  {RENDER_MODE_LABELS[m]}
                </label>
              ))}
            </div>

            {/* MODE-SPECIFIC PARAMS — placeholder; filled by 11-08 */}
            {/* PLACEHOLDER: 11-08 inserts raster/heatmap/classbreak/contour groups here */}

            {/* BASEMAP */}
            <div className="config-group config-basemap" role="radiogroup" aria-labelledby="map-basemap-label">
              <label id="map-basemap-label" className="config-group-label">BASEMAP</label>
              {ALL_BASEMAPS.map((b) => (
                <label key={b}>
                  <input
                    type="radio"
                    name="map-basemap"
                    value={b}
                    checked={(draft.basemap as Basemap) === b}
                    onChange={() => onSelectBasemap(b)}
                  />
                  {BASEMAP_LABELS[b]}
                </label>
              ))}
            </div>

          </div>
          {/* config-panel-actions (Apply/Cancel) is rendered by parent ChartConfigPanel — do NOT duplicate */}
        </div>
      );
    }
    ```

    Step 2 — adapt the local-state pattern to the codebase's actual conventions. If the codebase uses `useState` (it does — verified in CONVENTIONS.md), refactor `autoSuggestActive` to a real `useState<boolean>(true)` initialized to `true` and set to `false` in `onSelectSpatialMode`. The inline IIFE was a placeholder; use a clean useState. (The verbatim implementation above is illustrative — tailor to the codebase's actual style.)

    Step 3 — wire the CustomConfigPanel attachment in `kinetica_bi/src/components/charts/definitions/map.ts`:

    Locate the export at end of file. ABOVE `export default function register()`, add:
    ```typescript
    import MapConfigPanel from "../MapConfigPanel";
    ```
    (Add at top of file with other imports.)

    Then add to the `map` ChartTypeDefinition object:
    ```typescript
    CustomConfigPanel: MapConfigPanel,
    ```
    (One new line in the object literal, after `usesAggregation: false`.)

    Step 4 — run `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` → all ≥12 tests pass (GREEN).

    Step 5 — run `cd kinetica_bi && npx vitest run` → full suite green.

    Commit: `feat(11-07): MapConfigPanel shell with spatial/render/basemap pickers`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/MapConfigPanel.tsx` exists; ≥ 200 lines
    - File contains every UI-SPEC.md locked label string verbatim:
      - `grep -c "Latitude / Longitude pair\|WKT geometry column\|Kinetica geometry column" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns ≥ 3
      - `grep -c "Raster (point markers)\|Heatmap (density)\|Classbreak (categorical)\|Contour (lines)" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns ≥ 4
      - `grep -c "OpenStreetMap\|CartoDB Voyager\|CartoDB Dark Matter" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns ≥ 3
      - `grep "Auto-detected from column types" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 1
      - `grep "SPATIAL MODE\|RENDER MODE\|BASEMAP" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns ≥ 3
    - `grep "CustomConfigPanel: MapConfigPanel" kinetica_bi/src/components/charts/definitions/map.ts` returns 1
    - `grep "import MapConfigPanel" kinetica_bi/src/components/charts/definitions/map.ts` returns 1
    - `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` exits 0 with all ≥12 tests passing
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx && npx vitest run</automated>
  </verify>
  <done>MapConfigPanel shell live with three working pickers + auto-suggest + capability gating; CustomConfigPanel attached to definitions/map.ts; ready for 11-08 to fill in mode-specific param groups.</done>
</task>

</tasks>

<verification>
- MapConfigPanel.spec.tsx covers all picker behaviors, auto-suggest precedence, per-mode column preservation, and capability gating fallback.
- All UI-SPEC.md locked labels appear verbatim in MapConfigPanel.tsx.
- definitions/map.ts ATTACHES MapConfigPanel as CustomConfigPanel.
- Full vitest suite green.
</verification>

<success_criteria>
- Opening a map widget's config modal in the live UI renders MapConfigPanel.
- Selecting a spatial mode populates the correct column dropdowns; switching modes preserves per-mode picks.
- Render mode picker and basemap picker work; selections persist on Apply.
- 11-08 can append four mode-specific config groups (raster/heatmap/classbreak/contour) at the marked PLACEHOLDER comment.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-07-SUMMARY.md` summarizing:
- LOC of MapConfigPanel.tsx
- Whether the inline `__autoSuggestActive` flag was retained or refactored to useState (recommend useState)
- Whether ChartConfigPanel's commit-time draft strip needed adjustment to drop `__autoSuggestActive` from persisted config
- Test count delta
- Confirmation that every UI-SPEC.md "Microcopy / Labels" string appears verbatim
</output>
