---
phase: 28-spatial-target-config
plan: 02
type: execute
wave: 2
depends_on:
  - "28-01"
files_modified:
  - kinetica_bi/src/components/charts/registry.ts
  - kinetica_bi/src/components/charts/ChartConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
autonomous: true
requirements:
  - TARGET-V15-01
  - TARGET-V15-03

must_haves:
  truths:
    - "ConfigPanelProps exposes optional `tables?: TableInfo[]` so MapConfigPanel can render a table-picker for spatial targets sourced from the dashboard's associatedTables"
    - "ChartConfigPanel forwards `tables` through to the `<Custom config tables ... />` slot (line ~231 of ChartConfigPanel.tsx) so MapConfigPanel receives the dashboard-scoped table list"
    - "MapConfigPanel renders a `<div class='config-group'>` with `<div class='config-group-label'>SPATIAL FILTER TARGETS</div>` below the existing INFO POPUP section (DOM ordering: TITLE -> BASEMAP -> LAYERS -> INFO POPUP -> SPATIAL FILTER TARGETS)"
    - "When `widget.config.spatialTargets` is undefined or [], the section renders the placeholder text 'No spatial filter targets configured.' plus the `+` add affordance in the header (always visible)"
    - "Clicking the `+` add affordance appends a fresh row `{ tableId: <first associatedTable.id or 0>, spatialMode: 'latlon' }` to spatialTargets and fires onChange with the full nextConfig (persistence rides the existing onChange → onSave → PATCH /api/widgets/:id flow; any debounce is upstream of MapConfigPanel and out of plan scope)"
    - "Each row renders a card with: line 1 = table picker dropdown (options sourced from props.tables) + trash icon button (aria-label='Remove spatial filter target {N}'); line 2 = spatial mode radio group with values latlon/wkt/wkb; line 3 = mode-specific column picker(s) OR WKB warning"
    - "For spatialMode='latlon' the row shows TWO column picker dropdowns labeled 'Longitude column' (binds lonCol) and 'Latitude column' (binds latCol); column options filtered via getValidSpatialColumns(columns, 'latlon')"
    - "For spatialMode='wkt' the row shows ONE column picker dropdown labeled 'Spatial column' (binds spatialCol); options filtered via getValidSpatialColumns(columns, 'wkt')"
    - "For spatialMode='wkb' the row shows the locked verbatim warning text 'WKB spatial mode not yet supported — deferred' (no column picker rendered)"
    - "Selecting a new table on an existing row updates that row's tableId, clears stale columns (lonCol/latCol/spatialCol all reset to undefined), AND auto-suggests the new spatialMode by calling `autoSuggestSpatialMode(newColumns)` on the newly-picked table's columns (mirrors LayersModal.tsx handleTableChange pattern at lines 147-165 — the prior table's spatialMode is NOT preserved because it may be invalid for the new table's column shape)"
    - "Changing a row's table from one with only lat/lon numeric columns to one whose columns are purely a geometry (wkt) column flips the row's `spatialMode` to `wkt` automatically without operator interaction (auto-suggest-on-table-change; same predicate as KineticaWmsLayerForm Phase 11)"
    - "Selecting a new spatial mode on an existing row updates spatialMode and clears stale columns (mirrors KineticaWmsLayerForm onSelectSpatialMode pattern at line 393-406)"
    - "Selecting a column on an existing row updates the appropriate field (lonCol/latCol/spatialCol) and fires onChange"
    - "Clicking the trash icon on a row removes that row from spatialTargets and fires onChange with the remaining rows"
    - "For an incomplete non-WKB row (latlon missing lon/lat OR wkt missing spatialCol), the row shows the inline italic indicator 'Incomplete — will not filter' (visible whenever isSpatialTargetEligible(row) === false AND row.spatialMode !== 'wkb')"
    - "MapConfigPanel.spec.tsx has describe block 'Spatial filter targets' with at least 8 it() cases covering: render-section, empty-state placeholder, add row, remove row, mode change clears columns, table change clears columns + auto-suggests mode, column pick fires onChange, WKB warning verbatim, incomplete indicator visibility"
    - "MapConfigPanel.spec.tsx legacy tests still pass (no regression in the 4 Phase 12 layer-picker tests, 13 Phase 22 INFO POPUP tests, 5 GAP-24-01-B regression tests)"
    - "Frontend vitest suite green: `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` exits 0"
    - "TypeScript compilation passes: `cd kinetica_bi && npx tsc --noEmit` exits 0"
  artifacts:
    - path: "kinetica_bi/src/components/charts/registry.ts"
      provides: "Extended ConfigPanelProps with optional tables?: TableInfo[] field"
      contains: "tables?:"
    - path: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx"
      provides: "Threads tables prop through to the Custom panel slot"
      contains: "tables={tables}"
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      provides: "New 'Spatial filter targets' section with add/remove rows, per-row table/mode/column pickers, auto-suggest-on-table-change (via autoSuggestSpatialMode), WKB warning, incomplete indicator; persistence rides existing onChange → onSave → PATCH /api/widgets/:id flow"
      contains: "SPATIAL FILTER TARGETS"
      min_lines: 450
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx"
      provides: "New describe block 'Spatial filter targets' with 17+ tests covering all interactions including auto-suggest-on-table-change"
      contains: "describe(\"MapConfigPanel — Phase 28 Spatial filter targets"
      min_lines: 580
  key_links:
    - from: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      to: "kinetica_bi/src/lib/spatialTargets.ts"
      via: "import { getSpatialTargets, isSpatialTargetEligible } from '../../lib/spatialTargets' + import type { SpatialMode, SpatialTarget }"
      pattern: "from \"../../lib/spatialTargets\""
    - from: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      to: "kinetica_bi/src/lib/columnTypes.ts"
      via: "import { getValidSpatialColumns, autoSuggestSpatialMode } from '../../lib/columnTypes'"
      pattern: "autoSuggestSpatialMode"
    - from: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx"
      to: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      via: "Custom component slot receives tables prop forwarded from ChartConfigPanel's parent (DashboardsPage)"
      pattern: "<Custom"
---

<objective>
Add the "Spatial filter targets" section to MapConfigPanel.tsx — add/remove rows, per-row table picker + spatial-mode radio group + per-mode column picker(s), auto-suggest-on-table-change (via `autoSuggestSpatialMode` from `columnTypes.ts`, mirroring `LayersModal.tsx` handleTableChange at lines 147-165), inline WKB warning, inline incomplete-row indicator. Extend MapConfigPanel.spec.tsx with new spec coverage. Closes TARGET-V15-01 (persistence rides the existing `onChange → onSave → PATCH /api/widgets/:id` flow; debounce, if any, is upstream and out of plan scope) and TARGET-V15-03 (UI editor with WKB warning) in full.

Purpose: This is the configuration entry point operators use to declare "when a user draws a spatial shape, filter THIS table by THIS column". Phase 30's materialize trigger reads `getSpatialTargets(widget).filter(isSpatialTargetEligible)` to decide which targets get a server-side spatial WHERE clause. Phase 28 ships the editor + persistence; Phase 30 wires it into the materialize trigger.

To render the table picker, MapConfigPanel needs the dashboard's `associatedTables` (each with its `columns` map). The existing `ConfigPanelProps` (registry.ts line 37-51) only carries `columns` (singular, from the selected table) — not the table list. This plan extends `ConfigPanelProps` with optional `tables?: TableInfo[]` and threads it through `ChartConfigPanel`'s `<Custom>` slot (line 231 of ChartConfigPanel.tsx). The extension is additive (optional field) — no existing consumer breaks.

Output: One edited registry type (registry.ts), one edited threader (ChartConfigPanel.tsx), one edited UI panel (MapConfigPanel.tsx ~+250 LOC), one edited spec (MapConfigPanel.spec.tsx ~+230 LOC).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/28-spatial-target-config/28-CONTEXT.md
@.planning/phases/28-spatial-target-config/28-01-spatial-targets-helper-PLAN.md

<interfaces>
<!-- Prior plan (28-01) shipped these. Import directly. -->

From kinetica_bi/src/lib/spatialTargets.ts:
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";
export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;
  latCol?: string;
  spatialCol?: string;
};
export function getSpatialTargets(widget: { config: Pick<MapWidgetConfig, "spatialTargets"> }): SpatialTarget[];
export function isSpatialTargetEligible(target: SpatialTarget): boolean;
```

<!-- Existing Phase 11 helpers — reuse, do not re-implement. -->

From kinetica_bi/src/lib/columnTypes.ts (lines 111, 125-158):
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb"; // note: same union, separate declaration (cross-module independence convention)
export type Column = { name: string; type: string };
export function getValidSpatialColumns(columns: Column[], mode: SpatialMode): Column[];
// Phase 28 also imports autoSuggestSpatialMode for the row-level table-change handler:
//   - Any KINETICA_GEOMETRY_TYPES column → 'wkb'
//   - Any column with type containing 'wkt' → 'wkt'
//   - Both lat-name + lon-name columns → 'latlon'
//   - Fallback → 'latlon'
export function autoSuggestSpatialMode(columns: Column[]): SpatialMode;
```

<!-- Existing ConfigPanelProps that this plan extends. -->

From kinetica_bi/src/components/charts/registry.ts (lines 37-51):
```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];
  isValid?: (valid: boolean) => void;
};
```

<!-- ChartConfigPanel custom slot — where threading is added (line ~231). -->

From kinetica_bi/src/components/charts/ChartConfigPanel.tsx (lines 5-10, 230-260):
```typescript
type TableInfo = {
  id: number;
  name: string;
  schema: string;
  columns: Record<string, string>;
};
// ... in the render body ...
<Custom
  config={draft}
  columns={allColumns}
  isValid={(valid) => setCustomPanelValid(valid)}
  onChange={(c) => { ... }}
/>
```

<!-- Existing MapConfigPanel — pattern for new section + auto-save callback. -->

From kinetica_bi/src/components/charts/MapConfigPanel.tsx (lines 239-319, existing INFO POPUP section):
```typescript
// Pattern: <div className="config-group"> with <div className="config-group-label">INFO POPUP</div>,
// children call onChange({ ...config, fieldName: newValue }) to persist.
// Auto-save: MapConfigPanel calls onChange synchronously; any debounce is wired UPSTREAM
// (ChartConfigPanel + DashboardsPage onSave path → PATCH /api/widgets/:id). MapConfigPanel
// does not own or assert a specific debounce window — that contract lives outside this plan.
```

<!-- Existing KineticaWmsLayerForm — spatial-mode radio group + column picker pattern to mirror. -->

From kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (lines 393-406, 503-603):
```typescript
const onSelectSpatialMode = (mode: SpatialMode) => {
  onChange({
    ...config,
    spatialMode: mode,
    latColumn: "", lonColumn: "", wktColumn: "", wkbColumn: "",
  });
};
// Radio group: ALL_SPATIAL_MODES.filter(allowed).map( <input type="radio" name="map-spatial-mode" ... /> )
// Per-mode column dropdowns: latlon -> Latitude + Longitude; wkt -> Geometry (WKT); wkb -> Geometry (Kinetica)
```

<!-- LayersModal.tsx handleTableChange — canonical pattern for "table picked → compute newColumns → autoSuggestSpatialMode → clear stale columns → write nextConfig". This plan MIRRORS this pattern verbatim inside MapConfigPanel's per-row changeTable handler. -->

From kinetica_bi/src/components/LayersModal.tsx (lines 147-165):
```typescript
const handleTableChange = (newTableId: number) => {
  if (!selectedLayer) return;
  const newTable = associatedTables.find((t) => t.id === newTableId);
  const newColumns = newTable
    ? Object.entries(newTable.columns).map(([name, type]) => ({ name, type }))
    : [];
  const suggestedMode = autoSuggestSpatialMode(newColumns);
  // Clear stale spatial columns so the form doesn't show invalid values
  const cleared = { ...selectedLayer.config } as Record<string, unknown>;
  delete cleared.latColumn;
  delete cleared.lonColumn;
  delete cleared.wktColumn;
  delete cleared.wkbColumn;
  const nextConfig: Record<string, unknown> = {
    ...cleared,
    spatialMode: suggestedMode,
  };
  onPatch(selectedLayer.id, { table_id: newTableId, config: nextConfig });
};
```

<!-- TableDto shape from DashboardsPage's associatedTables source. -->

From kinetica_bi/src/api/client.ts (lines 229-237):
```typescript
export type TableDto = {
  id: number;
  name: string;
  schema: string;
  description?: string;
  columns: Record<string, string>;  // column name -> column type
  created_at: string;
  updated_at: string;
};
```

<!-- TableInfo shape currently used by ChartConfigPanel (locally declared, byte-parity with TableDto.columns shape). -->

From kinetica_bi/src/components/charts/ChartConfigPanel.tsx (line 5-10):
```typescript
type TableInfo = {
  id: number;
  name: string;
  schema: string;
  columns: Record<string, string>;
};
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend ConfigPanelProps with optional tables and thread through ChartConfigPanel</name>
  <files>
    kinetica_bi/src/components/charts/registry.ts,
    kinetica_bi/src/components/charts/ChartConfigPanel.tsx
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/registry.ts (CURRENT — `ConfigPanelProps` at lines 37-51, add the new field at the end of the object before the closing `};`)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx lines 1-30 (existing `TableInfo` type declaration + Props type), lines 220-260 (the `<Custom ... />` JSX slot where threading is added)
  </read_first>
  <action>
    Step 1 — Edit `kinetica_bi/src/components/charts/registry.ts`. Find the `ConfigPanelProps` type (currently lines 37-51). The current shape is:
    ```typescript
    export type ConfigPanelProps = {
      config: Record<string, unknown>;
      onChange: (config: Record<string, unknown>) => void;
      columns?: { name: string; type: string }[];
      isValid?: (valid: boolean) => void;
    };
    ```
    Add a new optional `tables` field at the end (before the closing `};`). The full new shape:
    ```typescript
    export type ConfigPanelProps = {
      config: Record<string, unknown>;
      onChange: (config: Record<string, unknown>) => void;
      /**
       * Column list from the selected table — passed by ChartConfigPanel to CustomConfigPanel
       * so panels like MapConfigPanel can filter by column type (Phase 11 MAP-02).
       */
      columns?: { name: string; type: string }[];
      /**
       * v1.5 Phase 28 (TARGET-V15-03): dashboard-scoped table list with per-table column metadata,
       * threaded through ChartConfigPanel from DashboardsPage's `associatedTables` state. MapConfigPanel
       * uses this to render the "Spatial filter targets" section's per-row table picker (operator can
       * configure any associated table as a spatial filter target, not just the widget's primary table).
       * Optional — non-map panels can ignore.
       */
      tables?: {
        id: number;
        name: string;
        schema: string;
        columns: Record<string, string>;
      }[];
      /**
       * Phase 11 11-08: panels can signal Apply-disable state to the parent.
       * If called with false, the caller should disable the Apply button.
       * MapConfigPanel uses this for classbreak mode when classbreaks.length < 2.
       */
      isValid?: (valid: boolean) => void;
    };
    ```
    Do NOT remove or modify existing fields. Add the new `tables` field BETWEEN `columns` and `isValid` so the JSDoc grouping reads naturally.

    Step 2 — Edit `kinetica_bi/src/components/charts/ChartConfigPanel.tsx`. Find the `<Custom>` JSX element (currently at line ~231). The current invocation is:
    ```tsx
    <Custom
      config={draft}
      columns={allColumns}
      isValid={(valid) => setCustomPanelValid(valid)}
      onChange={(c) => { ... }}
    />
    ```
    Add the `tables={tables}` prop. The new invocation:
    ```tsx
    <Custom
      config={draft}
      columns={allColumns}
      tables={tables}
      isValid={(valid) => setCustomPanelValid(valid)}
      onChange={(c) => { ... }}
    />
    ```
    `tables` is already in scope at this point — it is destructured from `Props` at the top of the component (line 52: `const ChartConfigPanel = ({ widgetType, title, config, tables, views, onSave, onCancel }: Props)`). No additional imports or destructure changes needed.

    Do NOT modify the `TableInfo` type, the `Props` type, the `dataSourceOptions` memo, or any other code in the file. Only the JSX prop addition.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -A 4 "tables?:" kinetica_bi/src/components/charts/registry.ts | grep -q "columns: Record<string, string>"` succeeds (the new tables field with TableInfo-compatible shape is present in registry.ts)
    - `grep -q "Phase 28 (TARGET-V15-03)" kinetica_bi/src/components/charts/registry.ts` succeeds
    - `grep -q "tables={tables}" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` succeeds
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (TableInfo in ChartConfigPanel.tsx is structurally compatible with the new ConfigPanelProps.tables shape — both are `{ id, name, schema, columns: Record<string,string> }`)
    - `grep -q "export type ConfigPanelProps" kinetica_bi/src/components/charts/registry.ts` still finds the type (regression)
    - `grep -q "columns?: { name: string; type: string }\\[\\]" kinetica_bi/src/components/charts/registry.ts` still finds the existing columns field (regression)
    - `grep -q "isValid?: (valid: boolean) => void" kinetica_bi/src/components/charts/registry.ts` still finds the existing isValid field (regression)
    - `grep -c "isValid={(valid) => setCustomPanelValid(valid)}" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns 1 (existing line preserved)
  </acceptance_criteria>
  <done>
    `ConfigPanelProps` exposes optional `tables?: { id, name, schema, columns }[]`; ChartConfigPanel forwards `tables` to the Custom slot; tsc clean; no regression on existing usages.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add "Spatial filter targets" section to MapConfigPanel</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (CURRENT — full file; key sites: import block at lines 17-26, function signature at line 42, INFO POPUP section at lines 239-319, closing `</div>` at line 320, closing brace at 322)
    - kinetica_bi/src/lib/spatialTargets.ts (exports SpatialMode, SpatialTarget, getSpatialTargets, isSpatialTargetEligible — Plan 28-01)
    - kinetica_bi/src/lib/columnTypes.ts lines 111-158 (getValidSpatialColumns + autoSuggestSpatialMode signatures; autoSuggestSpatialMode is the Phase 11 helper used inside the per-row table-change handler)
    - kinetica_bi/src/components/LayersModal.tsx lines 147-165 (CANONICAL pattern for "table picked → autoSuggestSpatialMode → clear stale columns → write nextConfig"; this plan's `changeTable` handler mirrors this verbatim, adapted to a per-row patch)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx lines 393-406 (onSelectSpatialMode clears stale columns pattern), lines 503-603 (radio group + column picker JSX pattern to mirror)
    - .planning/phases/28-spatial-target-config/28-CONTEXT.md §"MapConfigPanel section placement & visibility", §"Per-row UX" (LOCKED — note line 57: "Auto-suggest spatial mode on table pick: Reuse autoSuggestSpatialMode logic from KineticaWmsLayerForm.tsx (Phase 11)"), §"Add / Remove / Validation UX" (LOCKED layout)
  </read_first>
  <behavior>
    Test 1: With no `widget.config.spatialTargets`, the section header "SPATIAL FILTER TARGETS" renders below "INFO POPUP" and the placeholder "No spatial filter targets configured." is visible.
    Test 2: Clicking the `+` add affordance fires onChange with `spatialTargets: [{ tableId: <firstTableId or 0>, spatialMode: "latlon" }]`.
    Test 3: With one row at `spatialMode: 'latlon', lonCol: 'x', latCol: 'y'`, clicking the trash icon fires onChange with `spatialTargets: []`.
    Test 4: With one row at `spatialMode: 'latlon'`, changing the radio to `wkt` fires onChange with the row's spatialMode='wkt' AND lonCol/latCol/spatialCol all undefined (stale-column clear).
    Test 5: With one row at `spatialMode: 'latlon', lonCol: 'x', latCol: 'y', tableId: 10`, changing the table-picker to tableId=11 (a table whose columns suggest a DIFFERENT mode) fires onChange with tableId=11, lonCol/latCol/spatialCol all undefined, AND spatialMode set to `autoSuggestSpatialMode(newTable.columns)` (NOT preserved from the prior table).
    Test 5b (new): Changing the table-picker from a lat/lon-only table to a wkt-only-geometry table flips the row's spatialMode to 'wkt' (auto-suggest-on-table-change).
    Test 6: With one row at `spatialMode: 'wkt'`, picking a spatial column fires onChange with `spatialCol: <picked>`.
    Test 7: With one row at `spatialMode: 'wkb'`, the literal text "WKB spatial mode not yet supported — deferred" is visible (verbatim from CONTEXT.md), AND no `<select>` for spatialCol is rendered for that row.
    Test 8: With one row at `spatialMode: 'latlon'` and no columns set, the literal text "Incomplete — will not filter" is visible.
    Test 9: With one row at `spatialMode: 'latlon', lonCol: 'x', latCol: 'y'`, the "Incomplete — will not filter" text is NOT visible (eligible).
    Test 10: The section ordering is TITLE -> BASEMAP -> LAYERS -> INFO POPUP -> SPATIAL FILTER TARGETS (verifiable via `.config-group-label` text order).
  </behavior>
  <action>
    Edit `kinetica_bi/src/components/charts/MapConfigPanel.tsx`. Four concrete changes:

    **Change 1 — imports (after line 26).** Add new imports. Note: `autoSuggestSpatialMode` is imported alongside `getValidSpatialColumns` from `columnTypes`:
    ```typescript
    import { useState, useEffect, useRef } from "react";  // existing — leave unchanged
    import type { ConfigPanelProps } from "./registry";    // existing — leave unchanged
    import { useDashboardLayersStore } from "../../store/dashboardLayersStore";  // existing
    import {
      getInfoEnabled,
      getInfoRadiusPx,
      getInfoPopupWidthPx,
      getInfoPopupHeightPx,
    } from "../../lib/mapInfoConfig";  // existing — leave unchanged
    import type { MapWidgetConfig } from "../../lib/wmsUrlBuilder";  // existing
    // NEW imports below:
    import {
      getSpatialTargets,
      isSpatialTargetEligible,
      type SpatialMode,
      type SpatialTarget,
    } from "../../lib/spatialTargets";
    import {
      getValidSpatialColumns,
      autoSuggestSpatialMode,
      type Column,
    } from "../../lib/columnTypes";
    ```

    **Change 2 — destructure `tables` from props.** Change the function signature (line 42) FROM:
    ```typescript
    export default function MapConfigPanel({ config, onChange }: ConfigPanelProps): JSX.Element {
    ```
    TO:
    ```typescript
    export default function MapConfigPanel({ config, onChange, tables }: ConfigPanelProps): JSX.Element {
    ```

    **Change 3 — append the new section.** Find the closing of the INFO POPUP section (the `</div>` immediately before the final closing `</div>` of `.config-panel` at line ~319-320). The current ending is:
    ```tsx
            {heightError && (
              <div className="info-popup-config-inline-error" role="alert">
                {heightError}
              </div>
            )}
          </div>
        </div>
      );
    }
    ```
    INSERT the new "Spatial filter targets" section BETWEEN the INFO POPUP section's closing `</div>` and the `.config-panel` closing `</div>`. The full new section to insert (verbatim — preserve string content for spec assertions):

    ```tsx
          {/* ─── SPATIAL FILTER TARGETS (Phase 28 TARGET-V15-01/03) ─────── */}
          <div className="config-group config-spatial-targets">
            <div className="config-spatial-targets-header">
              <div className="config-group-label">SPATIAL FILTER TARGETS</div>
              <button
                type="button"
                className="config-spatial-targets-add"
                aria-label="Add spatial filter target"
                onClick={() => {
                  const firstTableId = tables && tables.length > 0 ? tables[0].id : 0;
                  const nextRow: SpatialTarget = {
                    tableId: firstTableId,
                    spatialMode: "latlon",
                  };
                  const nextTargets = [...spatialTargets, nextRow];
                  onChange({ ...config, spatialTargets: nextTargets });
                }}
              >
                +
              </button>
            </div>
            {spatialTargets.length === 0 && (
              <div className="config-spatial-targets-empty">
                No spatial filter targets configured.
              </div>
            )}
            {spatialTargets.map((target, idx) => {
              const rowTable = tables?.find((t) => t.id === target.tableId);
              const rowColumns: Column[] = rowTable
                ? Object.entries(rowTable.columns).map(([name, type]) => ({ name, type }))
                : [];
              const validColumns =
                target.spatialMode === "wkb"
                  ? []
                  : getValidSpatialColumns(rowColumns, target.spatialMode);
              const eligible = isSpatialTargetEligible(target);
              const showIncomplete = !eligible && target.spatialMode !== "wkb";
              const rowKey = `${target.tableId}-${target.spatialMode}-${idx}`;

              const patchRow = (patch: Partial<SpatialTarget>) => {
                const nextTargets = spatialTargets.map((t, i) =>
                  i === idx ? { ...t, ...patch } : t,
                );
                onChange({ ...config, spatialTargets: nextTargets });
              };

              const removeRow = () => {
                const nextTargets = spatialTargets.filter((_, i) => i !== idx);
                onChange({ ...config, spatialTargets: nextTargets });
              };

              // CANONICAL pattern mirrored verbatim from LayersModal.tsx handleTableChange
              // (lines 147-165). When the operator picks a new table, compute the new
              // column list, run autoSuggestSpatialMode against it, and write the row
              // with the SUGGESTED spatialMode (NOT the prior mode — the prior mode may
              // be invalid for the new table's column shape, which would leave the row
              // permanently broken). Stale lonCol/latCol/spatialCol are explicitly
              // cleared because the prior table's column names are meaningless for the
              // new table. CONTEXT.md §"Per-row UX" line 57 LOCKS this behavior:
              // "Auto-suggest spatial mode on table pick: Reuse autoSuggestSpatialMode
              //  logic from KineticaWmsLayerForm.tsx (Phase 11)."
              const changeTable = (newTableId: number) => {
                const newTable = tables?.find((t) => t.id === newTableId);
                const newColumns: Column[] = newTable
                  ? Object.entries(newTable.columns).map(([name, type]) => ({ name, type }))
                  : [];
                const suggestedMode = autoSuggestSpatialMode(newColumns);
                const nextTargets = spatialTargets.map((t, i) =>
                  i === idx
                    ? {
                        tableId: newTableId,
                        spatialMode: suggestedMode,
                        // explicit undefined clears any prior column choices —
                        // the prior table's column names are invalid for the new table
                        lonCol: undefined,
                        latCol: undefined,
                        spatialCol: undefined,
                      }
                    : t,
                );
                onChange({ ...config, spatialTargets: nextTargets });
              };

              const changeMode = (newMode: SpatialMode) => {
                // Stale-column clear when mode changes (mirrors KineticaWmsLayerForm onSelectSpatialMode at line 393-406)
                const nextTargets = spatialTargets.map((t, i) =>
                  i === idx
                    ? {
                        tableId: t.tableId,
                        spatialMode: newMode,
                        lonCol: undefined,
                        latCol: undefined,
                        spatialCol: undefined,
                      }
                    : t,
                );
                onChange({ ...config, spatialTargets: nextTargets });
              };

              return (
                <div key={rowKey} className="config-spatial-target-row">
                  {/* Line 1: table picker + trash icon */}
                  <div className="config-spatial-target-row-line1">
                    <select
                      className="ds-select"
                      aria-label={`Spatial filter target ${idx + 1} table`}
                      value={String(target.tableId)}
                      onChange={(e) => changeTable(Number(e.target.value))}
                    >
                      {(!tables || tables.length === 0) && (
                        <option value="0">No associated tables</option>
                      )}
                      {tables?.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.schema ? `${t.schema}.${t.name}` : t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="config-spatial-target-remove"
                      aria-label={`Remove spatial filter target ${idx + 1}`}
                      onClick={removeRow}
                    >
                      🗑
                    </button>
                  </div>

                  {/* Line 2: spatial mode radio group */}
                  <div
                    className="config-spatial-target-row-line2"
                    role="radiogroup"
                    aria-label={`Spatial filter target ${idx + 1} mode`}
                  >
                    {(["latlon", "wkt", "wkb"] as SpatialMode[]).map((m) => (
                      <label key={m} className="config-spatial-target-mode-option">
                        <input
                          type="radio"
                          name={`spatial-target-mode-${idx}`}
                          value={m}
                          checked={target.spatialMode === m}
                          onChange={() => changeMode(m)}
                        />
                        {m}
                      </label>
                    ))}
                  </div>

                  {/* Line 3: mode-dependent column picker(s) OR WKB warning */}
                  <div className="config-spatial-target-row-line3">
                    {target.spatialMode === "latlon" && (
                      <>
                        <label className="ds-field-label">
                          Longitude column
                          <select
                            className="ds-select"
                            aria-label={`Spatial filter target ${idx + 1} longitude column`}
                            value={target.lonCol ?? ""}
                            onChange={(e) =>
                              patchRow({ lonCol: e.target.value || undefined })
                            }
                          >
                            <option value="">— select —</option>
                            {validColumns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="ds-field-label">
                          Latitude column
                          <select
                            className="ds-select"
                            aria-label={`Spatial filter target ${idx + 1} latitude column`}
                            value={target.latCol ?? ""}
                            onChange={(e) =>
                              patchRow({ latCol: e.target.value || undefined })
                            }
                          >
                            <option value="">— select —</option>
                            {validColumns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    {target.spatialMode === "wkt" && (
                      <label className="ds-field-label">
                        Spatial column
                        <select
                          className="ds-select"
                          aria-label={`Spatial filter target ${idx + 1} spatial column`}
                          value={target.spatialCol ?? ""}
                          onChange={(e) =>
                            patchRow({ spatialCol: e.target.value || undefined })
                          }
                        >
                          <option value="">— select —</option>
                          {validColumns.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {target.spatialMode === "wkb" && (
                      <div
                        className="config-spatial-target-wkb-warning"
                        role="alert"
                      >
                        WKB spatial mode not yet supported — deferred
                      </div>
                    )}
                    {showIncomplete && (
                      <div className="config-spatial-target-incomplete">
                        <em>Incomplete — will not filter</em>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
    ```

    **Change 4 — derive `spatialTargets` array near the top of the function body.** Add this BELOW the existing `widgetCfg` / `infoEnabled` / `infoRadiusPx` / etc. derivation block (around line 74-75, immediately after the `infoPopupHeightPx` line). Insert:
    ```typescript
      // ─── Phase 28 (TARGET-V15-01) — SPATIAL FILTER TARGETS derivation ─────
      // Read via Phase 28 helper for legacy-default coercion ([] for v1.4 widgets without the field).
      const spatialTargets = getSpatialTargets({ config: widgetCfg });
    ```
    Note: `widgetCfg` is already declared at line 70 as `config as Partial<MapWidgetConfig>`; the same cast also satisfies `Pick<MapWidgetConfig, "spatialTargets">` since `spatialTargets` is now an optional field on `MapWidgetConfig`.

    Style notes:
    - WKB warning text is LOCKED VERBATIM: `WKB spatial mode not yet supported — deferred` (en-dash `—`, not hyphen). Spec asserts via `screen.getByText("WKB spatial mode not yet supported — deferred")`.
    - Incomplete indicator text is LOCKED VERBATIM: `Incomplete — will not filter` (en-dash `—`).
    - Section header label is LOCKED VERBATIM: `SPATIAL FILTER TARGETS` (uppercase, matches the existing `INFO POPUP` / `LAYERS` / `BASEMAP` / `TITLE` style).
    - Empty-state placeholder is LOCKED VERBATIM: `No spatial filter targets configured.`
    - Add button is `+` (literal plus sign as text content).
    - Trash icon is `🗑` (unicode wastebasket U+1F5D1).
    - CSS class names (`config-spatial-targets`, `config-spatial-target-row`, etc.) are Claude's discretion per CONTEXT.md but MUST match the spec's `document.querySelector` assertions in Task 3. The names used above will be referenced in the spec.
    - `changeTable` MUST call `autoSuggestSpatialMode(newColumns)` and use its result as the row's new `spatialMode`. Preserving the prior row.spatialMode would break the row whenever the operator switches to a table whose columns cannot satisfy that mode (e.g. switching from a lat/lon table to a wkt-only-geometry table while spatialMode='latlon' would leave the row with mode='latlon' but no valid lon/lat columns available). CONTEXT.md §"Per-row UX" line 57 LOCKS this behavior.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "SPATIAL FILTER TARGETS" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "No spatial filter targets configured." kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "WKB spatial mode not yet supported — deferred" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds (en-dash `—` U+2014 — verify via `xxd` if unsure)
    - `grep -q "Incomplete — will not filter" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "import {" kinetica_bi/src/components/charts/MapConfigPanel.tsx && grep -q "from \"../../lib/spatialTargets\"" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "getValidSpatialColumns" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "autoSuggestSpatialMode" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds (NEW: auto-suggest-on-table-change wiring)
    - `grep -q "{ config, onChange, tables }: ConfigPanelProps" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "const spatialTargets = getSpatialTargets" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds
    - `grep -q "Add spatial filter target" kinetica_bi/src/components/charts/MapConfigPanel.tsx` succeeds (the aria-label for the `+` button)
    - `grep -B 2 -A 6 "const changeTable" kinetica_bi/src/components/charts/MapConfigPanel.tsx | grep -q "autoSuggestSpatialMode(newColumns)"` succeeds (NEW: changeTable invokes autoSuggestSpatialMode against the picked table's columns)
    - `grep -B 2 -A 12 "const changeTable" kinetica_bi/src/components/charts/MapConfigPanel.tsx | grep -q "spatialMode: suggestedMode"` succeeds (NEW: changeTable writes the SUGGESTED mode, not the prior mode)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - Existing Phase 22 INFO POPUP section unchanged: `grep -q "INFO POPUP" kinetica_bi/src/components/charts/MapConfigPanel.tsx` still succeeds AND `grep -q "Click radius (px)" kinetica_bi/src/components/charts/MapConfigPanel.tsx` still succeeds
    - Existing Phase 12 LAYERS picker unchanged: `grep -q "config-layer-picker" kinetica_bi/src/components/charts/MapConfigPanel.tsx` still succeeds
    - Section is placed AFTER INFO POPUP: line number of "SPATIAL FILTER TARGETS" > line number of "INFO POPUP" (verify via `grep -n` ordering)
  </acceptance_criteria>
  <done>
    MapConfigPanel renders "Spatial filter targets" section below INFO POPUP with add affordance, per-row table/mode/column pickers, auto-suggest-on-table-change via `autoSuggestSpatialMode`, WKB warning, incomplete indicator; tsc clean; existing sections untouched.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend MapConfigPanel.spec.tsx with "Spatial filter targets" coverage</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (CURRENT — full file; existing `_storeState` mock pattern at lines 23-30, `makeLayer` + `makeConfig` helpers at lines 36-55, Phase 22 INFO POPUP describe at line 189)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (after Task 2 lands)
    - kinetica_bi/src/lib/spatialTargets.ts (the helper module under test indirectly)
    - kinetica_bi/src/lib/columnTypes.ts lines 137-158 (autoSuggestSpatialMode precedence: KINETICA_GEOMETRY → 'wkb'; type contains "wkt" → 'wkt'; lat+lon name match → 'latlon'; else 'latlon')
  </read_first>
  <behavior>
    All 10 tests from Task 2's <behavior> block PLUS the new auto-suggest-on-table-change test must pass against the implementation in Task 2.
    Spec organization: ONE new `describe("MapConfigPanel — Phase 28 Spatial filter targets")` block APPENDED at the bottom of the file (after the Phase 22 INFO POPUP describe block ending at line 399).
    Existing tests (Phase 12 + Phase 22 + GAP-24-01-B regression) MUST continue to pass — no edits to existing test bodies.
  </behavior>
  <action>
    Edit `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx`. Append the following NEW describe block at the very end of the file (after the closing `});` of the existing Phase 22 INFO POPUP describe block at line 399). Use the literal text below verbatim.

    Note: `makeTables()` returns three table shapes — tableId=10 (lat/lon columns, suggests `latlon`); tableId=11 (different lat/lon columns, also suggests `latlon`); tableId=12 (geometry-only column, suggests `wkt` via the `autoSuggestSpatialMode` "type contains 'wkt'" rule). The third table is used by the new auto-suggest test (T8b) to demonstrate mode-flipping on table change.

    ```typescript
    /* ------------------------------------------------------------------ */
    /*  Phase 28 — Spatial filter targets section tests                   */
    /* ------------------------------------------------------------------ */

    const makeTables = () => [
      {
        id: 10,
        name: "orders",
        schema: "public",
        columns: { lat: "double", lon: "double", geom: "wkt", id: "int" },
      },
      {
        id: 11,
        name: "customers",
        schema: "public",
        columns: { latitude: "double", longitude: "double", region: "varchar" },
      },
      {
        id: 12,
        name: "regions",
        schema: "public",
        // Geometry-only table — autoSuggestSpatialMode returns 'wkt' for any
        // column whose type contains "wkt" (columnTypes.ts line 145-149).
        columns: { boundary: "wkt", region_name: "varchar" },
      },
    ];

    describe("MapConfigPanel — Phase 28 Spatial filter targets section", () => {
      beforeEach(() => {
        _storeState.layers = [];
        vi.clearAllMocks();
      });

      // T1: Section header renders below INFO POPUP
      it("renders SPATIAL FILTER TARGETS section header below INFO POPUP", () => {
        render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
        expect(screen.getByText("SPATIAL FILTER TARGETS")).toBeInTheDocument();
        const labels = Array.from(
          document.querySelectorAll(".config-group-label"),
        ).map((el) => el.textContent);
        const infoIdx = labels.indexOf("INFO POPUP");
        const spatialIdx = labels.indexOf("SPATIAL FILTER TARGETS");
        expect(infoIdx).toBeGreaterThanOrEqual(0);
        expect(spatialIdx).toBeGreaterThan(infoIdx);
      });

      // T2: Empty-state placeholder renders when no spatialTargets configured
      it("renders the 'No spatial filter targets configured.' placeholder when widget.config.spatialTargets is undefined", () => {
        render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
        expect(
          screen.getByText("No spatial filter targets configured."),
        ).toBeInTheDocument();
      });

      // T3: + add affordance is always visible (in section header)
      it("renders the + add affordance in the section header (always visible)", () => {
        render(<MapConfigPanel config={makeConfig()} onChange={vi.fn()} tables={makeTables()} />);
        const addBtn = screen.getByLabelText("Add spatial filter target");
        expect(addBtn).toBeInTheDocument();
      });

      // T4: Clicking + appends a fresh row with first associated table's id and spatialMode='latlon'
      it("clicking + add affordance fires onChange with a fresh row { tableId: <firstTableId>, spatialMode: 'latlon' }", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig()}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const addBtn = screen.getByLabelText("Add spatial filter target");
        fireEvent.click(addBtn);
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [{ tableId: 10, spatialMode: "latlon" }],
          }),
        );
      });

      // T5: Clicking + with no associated tables uses fallback tableId=0
      it("clicking + with empty tables prop fires onChange with tableId=0 fallback row", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig()}
            onChange={onChange}
            tables={[]}
          />,
        );
        const addBtn = screen.getByLabelText("Add spatial filter target");
        fireEvent.click(addBtn);
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [{ tableId: 0, spatialMode: "latlon" }],
          }),
        );
      });

      // T6: Trash icon removes the row
      it("clicking the trash icon on a row fires onChange with that row removed", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [
                { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
              ],
            })}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const removeBtn = screen.getByLabelText("Remove spatial filter target 1");
        fireEvent.click(removeBtn);
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({ spatialTargets: [] }),
        );
      });

      // T7: Changing spatial mode clears stale columns
      it("changing spatial mode on a row clears all column fields (lonCol/latCol/spatialCol → undefined)", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [
                { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
              ],
            })}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const wktRadio = screen.getByRole("radio", { name: "wkt" });
        fireEvent.click(wktRadio);
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [
              {
                tableId: 10,
                spatialMode: "wkt",
                lonCol: undefined,
                latCol: undefined,
                spatialCol: undefined,
              },
            ],
          }),
        );
      });

      // T8: Changing table to another lat/lon-shape table clears stale columns; auto-suggest keeps 'latlon'
      it("changing table on a row clears all column fields; auto-suggest preserves 'latlon' when the new table's columns still suggest latlon", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [
                { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
              ],
            })}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const tableSelect = screen.getByLabelText(
          "Spatial filter target 1 table",
        ) as HTMLSelectElement;
        // tableId=11 has columns { latitude, longitude, region } → autoSuggestSpatialMode → 'latlon'
        fireEvent.change(tableSelect, { target: { value: "11" } });
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [
              {
                tableId: 11,
                spatialMode: "latlon",
                lonCol: undefined,
                latCol: undefined,
                spatialCol: undefined,
              },
            ],
          }),
        );
      });

      // T8b (NEW — addresses checker context_compliance blocker): Changing table to a
      // geometry-only table flips the row's spatialMode to 'wkt' automatically via
      // autoSuggestSpatialMode. The prior spatialMode ('latlon') is NOT preserved —
      // it would be invalid for a table with no lat/lon numeric columns.
      // Source: CONTEXT.md §"Per-row UX" line 57 LOCKED decision; LayersModal.tsx
      // handleTableChange (lines 147-165) canonical pattern.
      it("changing table to one whose columns suggest a different mode flips spatialMode automatically (auto-suggest-on-table-change)", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [
                { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
              ],
            })}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const tableSelect = screen.getByLabelText(
          "Spatial filter target 1 table",
        ) as HTMLSelectElement;
        // tableId=12 has columns { boundary: "wkt", region_name: "varchar" }.
        // autoSuggestSpatialMode precedence: "type contains 'wkt'" → returns 'wkt'.
        // The prior row mode ('latlon') MUST NOT be preserved here.
        fireEvent.change(tableSelect, { target: { value: "12" } });
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [
              {
                tableId: 12,
                spatialMode: "wkt", // ← auto-suggested, NOT preserved from prior
                lonCol: undefined,
                latCol: undefined,
                spatialCol: undefined,
              },
            ],
          }),
        );
      });

      // T9: Picking a longitude column on a latlon row fires onChange with lonCol set
      it("picking a longitude column on a latlon row fires onChange with lonCol set on that row", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [{ tableId: 10, spatialMode: "latlon" }],
            })}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const lonSelect = screen.getByLabelText(
          "Spatial filter target 1 longitude column",
        ) as HTMLSelectElement;
        fireEvent.change(lonSelect, { target: { value: "lon" } });
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [
              expect.objectContaining({ tableId: 10, spatialMode: "latlon", lonCol: "lon" }),
            ],
          }),
        );
      });

      // T10: Picking a spatial column on a wkt row fires onChange with spatialCol set
      it("picking a spatial column on a wkt row fires onChange with spatialCol set on that row", () => {
        const onChange = vi.fn();
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [{ tableId: 10, spatialMode: "wkt" }],
            })}
            onChange={onChange}
            tables={makeTables()}
          />,
        );
        const spatialSelect = screen.getByLabelText(
          "Spatial filter target 1 spatial column",
        ) as HTMLSelectElement;
        fireEvent.change(spatialSelect, { target: { value: "geom" } });
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            spatialTargets: [
              expect.objectContaining({ tableId: 10, spatialMode: "wkt", spatialCol: "geom" }),
            ],
          }),
        );
      });

      // T11: WKB row shows the locked verbatim warning text
      it("WKB row renders the locked verbatim warning text 'WKB spatial mode not yet supported — deferred'", () => {
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [{ tableId: 10, spatialMode: "wkb" }],
            })}
            onChange={vi.fn()}
            tables={makeTables()}
          />,
        );
        expect(
          screen.getByText("WKB spatial mode not yet supported — deferred"),
        ).toBeInTheDocument();
      });

      // T12: WKB row does NOT render a column picker
      it("WKB row renders NO column picker dropdown", () => {
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [{ tableId: 10, spatialMode: "wkb" }],
            })}
            onChange={vi.fn()}
            tables={makeTables()}
          />,
        );
        // No spatial column / lat column / lon column labels for a wkb row
        expect(
          screen.queryByLabelText("Spatial filter target 1 spatial column"),
        ).toBeNull();
        expect(
          screen.queryByLabelText("Spatial filter target 1 latitude column"),
        ).toBeNull();
        expect(
          screen.queryByLabelText("Spatial filter target 1 longitude column"),
        ).toBeNull();
      });

      // T13: Incomplete latlon row shows the inline indicator
      it("incomplete latlon row (missing both columns) renders 'Incomplete — will not filter'", () => {
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [{ tableId: 10, spatialMode: "latlon" }],
            })}
            onChange={vi.fn()}
            tables={makeTables()}
          />,
        );
        expect(screen.getByText("Incomplete — will not filter")).toBeInTheDocument();
      });

      // T14: Complete latlon row does NOT show the inline indicator
      it("complete latlon row (both columns set) does NOT render the 'Incomplete — will not filter' indicator", () => {
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [
                { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
              ],
            })}
            onChange={vi.fn()}
            tables={makeTables()}
          />,
        );
        expect(screen.queryByText("Incomplete — will not filter")).toBeNull();
      });

      // T15: WKB row does NOT show 'Incomplete — will not filter' (WKB has its own warning instead)
      it("WKB row does NOT render the generic 'Incomplete' indicator (WKB has its own warning)", () => {
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [{ tableId: 10, spatialMode: "wkb" }],
            })}
            onChange={vi.fn()}
            tables={makeTables()}
          />,
        );
        expect(screen.queryByText("Incomplete — will not filter")).toBeNull();
      });

      // T16: Multiple rows render in order
      it("renders multiple rows in the order they appear in spatialTargets[]", () => {
        render(
          <MapConfigPanel
            config={makeConfig({
              spatialTargets: [
                { tableId: 10, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
                { tableId: 11, spatialMode: "wkt", spatialCol: "geom" },
              ],
            })}
            onChange={vi.fn()}
            tables={makeTables()}
          />,
        );
        // Both rows present (by their unique aria-labels)
        expect(screen.getByLabelText("Spatial filter target 1 table")).toBeInTheDocument();
        expect(screen.getByLabelText("Spatial filter target 2 table")).toBeInTheDocument();
      });
    });
    ```

    The new describe block contains 17 `it()` cases (T1–T16 plus T8b auto-suggest-on-table-change). Do NOT modify any of the existing describe blocks or `it()` cases in the file. Append only.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx --reporter=basic 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "describe(\"MapConfigPanel — Phase 28 Spatial filter targets section\"" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds
    - `grep -c "  it(" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns >= 17 more than the prior baseline (count from existing file — should be >= prior_count + 17). At minimum the new describe contains 17 `it(` cases (T1-T16 plus T8b auto-suggest).
    - `grep -q "auto-suggest-on-table-change" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds (NEW: comment marking the auto-suggest test)
    - `grep -q "spatialMode: \"wkt\", // ← auto-suggested" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds (NEW: the assertion that auto-suggest flipped the mode)
    - `grep -q "boundary: \"wkt\"" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds (NEW: the tableId=12 geometry-only fixture used by the auto-suggest test)
    - `grep -q "WKB spatial mode not yet supported — deferred" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds (en-dash verbatim assertion)
    - `grep -q "No spatial filter targets configured." kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds
    - `grep -q "Incomplete — will not filter" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds (en-dash verbatim)
    - `grep -q "const makeTables = () =>" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` succeeds (helper added)
    - `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` exits 0 (ALL tests pass — new + existing Phase 12 + Phase 22 + GAP-24-01-B)
    - Existing describe blocks NOT modified: `grep -c "describe(\"MapConfigPanel" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns 3 (Phase 12 shrunk surface + Phase 22 INFO POPUP + Phase 28 Spatial filter targets — three describes total)
    - No regression in Phase 22 W1-W10 + GAP-24-01-B tests (covered by the full-file vitest run)
  </acceptance_criteria>
  <done>
    Spec file has new "MapConfigPanel — Phase 28 Spatial filter targets section" describe block with 17 tests (T1–T16 plus T8b auto-suggest-on-table-change); all tests green; no regression in existing 22 Phase 12/22 tests; tsc clean.
  </done>
</task>

</tasks>

<verification>
After all tasks complete, run:
1. `cd kinetica_bi && npx tsc --noEmit` exits 0
2. `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` exits 0 (existing + 17 new tests green)
3. `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts` exits 0 (regression: Plan 28-01 spec still green after the MapConfigPanel consumption)
4. `cd kinetica_bi && npx vitest run` exits 0 (full frontend suite green — no regression in any sibling test)
5. Manual smoke (operator): open a map widget config panel in dev; verify "Spatial filter targets" section appears below "Info Popup"; verify `+` adds a row with the dashboard's first associated table; verify radio change clears columns; verify trash icon removes; verify table change auto-suggests the new mode (e.g. switching from a lat/lon table to a wkt-geometry table flips the row to wkt); verify WKB warning text renders verbatim. (Phase 28 ships without an explicit human-verify checkpoint — the locked verbatim strings + 17 spec tests provide sufficient coverage; a Phase 31 UAT walkthrough exercises the integrated flow.)
</verification>

<success_criteria>
- ConfigPanelProps + ChartConfigPanel thread `tables` through to the Custom slot
- MapConfigPanel renders "Spatial filter targets" section below INFO POPUP with: always-visible header + `+`, empty-state placeholder, per-row card layout, table picker from props.tables, spatial-mode radio (latlon/wkt/wkb), per-mode column picker(s) filtered via getValidSpatialColumns, auto-suggest-on-table-change via `autoSuggestSpatialMode` (mirrors LayersModal.tsx handleTableChange pattern), WKB verbatim warning, incomplete-row indicator
- Persistence rides the existing `onChange → onSave → PATCH /api/widgets/:id` flow (any debounce window is upstream of MapConfigPanel and out of plan scope)
- 17 new spec tests cover add/remove/mode-change/table-change-same-suggestion/table-change-auto-suggest-flip/column-pick/WKB-warning/incomplete-indicator; vitest green
- No regression in 22 existing Phase 12 + Phase 22 + GAP-24-01-B tests
- TARGET-V15-01 (persistence ride-along) + TARGET-V15-03 (UI editor + WKB warning) complete
</success_criteria>

<output>
After completion, create `.planning/phases/28-spatial-target-config/28-02-SUMMARY.md` documenting:
- Files edited (registry.ts, ChartConfigPanel.tsx, MapConfigPanel.tsx, MapConfigPanel.spec.tsx)
- Verbatim text strings confirmed (section header, empty state, WKB warning, incomplete indicator)
- Auto-suggest-on-table-change wiring confirmed (changeTable handler calls autoSuggestSpatialMode against the picked table's columns; spec test T8b asserts mode flip)
- Vitest result count (existing baseline + 17 new tests)
- Tsc clean confirmation
- DashboardsPage downstream-consumer note: ChartConfigPanel is already invoked with `tables={associatedTables}` at the DashboardsPage call site (line ~936) since `tables` was always part of `Props`; the new ConfigPanelProps.tables field simply makes the threading from Custom slot to MapConfigPanel explicit. No DashboardsPage edit needed.
- TARGET-V15-01..03 closure status (full)
</output>
