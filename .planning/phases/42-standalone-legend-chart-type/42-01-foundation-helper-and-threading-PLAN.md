---
phase: 42-standalone-legend-chart-type
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/resolveLegendLayers.ts
  - kinetica_bi/src/lib/resolveLegendLayers.spec.ts
  - kinetica_bi/src/components/LayersLegendPanel.tsx
  - kinetica_bi/src/components/LayersLegendPanel.spec.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/registry.ts
  - kinetica_bi/src/components/charts/ChartConfigPanel.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/components/DashboardsPage.tsx
autonomous: true
requirements:
  - WIDGET-V17-02
  - WIDGET-V17-03
  - WIDGET-V17-04
must_haves:
  truths:
    - "Pure helper `resolveLegendLayers(storeLayers, includedLayerIds)` exists in `lib/resolveLegendLayers.ts` and returns `ResolvedLegendLayer[]` honoring Phase 12 empty-array-means-all-on semantic."
    - "Phase 41's 14 MapChartRenderer specs still pass without modification after MapChartRenderer's inline resolvedLegendLayers derivation is replaced with a call to `resolveLegendLayers(...)` (zero-behavior-change refactor)."
    - "`<LayersLegendPanel>` accepts an optional `showChevron?: boolean` prop (default `true`) — when `false`, the header has no chevron, no onClick, no `role='button'`, no `aria-expanded`/`aria-controls`, no pointer cursor, and the body always renders regardless of the `collapsed` prop."
    - "Phase 41 in-map mount continues to work without passing `showChevron` (default `true` preserves all existing behavior)."
    - "`ConfigPanelProps` has an optional `widgets?: WidgetDto[]` field threaded from `DashboardsPage` → `WidgetConfigModal` → `ChartConfigPanel` → `Custom` panel slot, so CustomConfigPanels rendered inside WidgetConfigModal can read the dashboard's widget list without calling `useDashboardContext()` (which would throw, since WidgetConfigModal is outside DashboardContextProvider)."
    - "An `onConfigureWidget?: (widget: WidgetDto) => void` callback prop is threaded from `DashboardsPage` (which already owns `setConfiguringWidget`) through `WidgetRenderer` so that future widget renderers (notably Phase 42 LegendRenderer in plan 42-02) can request the config modal to open without importing DashboardsPage state."
  artifacts:
    - path: "kinetica_bi/src/lib/resolveLegendLayers.ts"
      provides: "Pure helper for filtering/projecting layers to ResolvedLegendLayer[]; ResolvedLegendLayer type"
      exports: ["resolveLegendLayers", "ResolvedLegendLayer"]
    - path: "kinetica_bi/src/lib/resolveLegendLayers.spec.ts"
      provides: "Unit tests for the pure helper"
    - path: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      provides: "Pure presentational panel with new optional showChevron prop + back-compat re-export of ResolvedLegendLayer"
    - path: "kinetica_bi/src/components/LayersLegendPanel.spec.tsx"
      provides: "Tests for showChevron=true (existing) + showChevron=false branches"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "Refactored useMemo body calling resolveLegendLayers(...) — zero behavior change"
    - path: "kinetica_bi/src/components/charts/registry.ts"
      provides: "ConfigPanelProps with optional widgets?: WidgetDto[] field"
    - path: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx"
      provides: "widgets prop threaded down to <Custom> panel slot"
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "Optional onConfigureWidget?: (widget: WidgetDto) => void prop threaded to renderers"
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "WidgetRenderer mount passes onConfigureWidget callback wired to setConfiguringWidget; WidgetConfigModal receives widgets prop and forwards to ChartConfigPanel"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "kinetica_bi/src/lib/resolveLegendLayers.ts"
      via: "import + call inside resolvedLegendLayers useMemo"
      pattern: "import.*resolveLegendLayers.*from.*lib/resolveLegendLayers"
    - from: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      to: "kinetica_bi/src/lib/resolveLegendLayers.ts"
      via: "back-compat type re-export"
      pattern: "export type \\{ ResolvedLegendLayer \\} from"
    - from: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx"
      to: "<Custom> panel slot"
      via: "widgets prop pass-through"
      pattern: "widgets=\\{widgets\\}"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx"
      to: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      via: "onConfigureWidget prop bound to setConfiguringWidget"
      pattern: "onConfigureWidget=\\{"
---

<objective>
Lay the foundation for Phase 42's standalone Legend widget: extract the shared `resolveLegendLayers` helper (zero-behavior refactor of Phase 41), extend `<LayersLegendPanel>` with the additive `showChevron` prop, thread `widgets` into `ConfigPanelProps`, and thread `onConfigureWidget` from DashboardsPage to WidgetRenderer. **No new chart type is registered in this plan; no LegendRenderer ships in this plan.** Plan 42-02 consumes everything this plan delivers.

Purpose: Plan 42-02's LegendRenderer + LegendConfigPanel both require infrastructure that doesn't exist yet — a shared layer-derivation helper (Phase 41 was the 1st consumer, Phase 42 is the 2nd — extract per the Phase 40 lib/trackConfig.ts precedent), a non-chevron header mode on `<LayersLegendPanel>`, a way for `LegendConfigPanel` (which runs inside `WidgetConfigModal`, OUTSIDE DashboardContextProvider) to read the dashboard's widget list, and a way for `LegendRenderer` to programmatically request the widget config modal to open. Splitting these into a foundation plan keeps the 42-02 plan focused on the visible feature.

Output: `lib/resolveLegendLayers.ts` + spec; `LayersLegendPanel.tsx` updated with `showChevron?` prop + back-compat type re-export; `MapChartRenderer.tsx` useMemo refactored to call the helper (Phase 41's 14 MapChartRenderer specs unchanged and still green); `ConfigPanelProps.widgets?` field added; `ChartConfigPanel` threads `widgets` to `<Custom>` slot; `WidgetConfigModal` accepts and forwards `widgets`; `DashboardsPage` passes `widgets` to `WidgetConfigModal` and `onConfigureWidget={(w) => setConfiguringWidget(w)}` to `WidgetRenderer`; `WidgetRenderer` declares the optional prop and threads it through (no consumer in this plan — Plan 42-02 wires the LegendRenderer consumer).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/42-standalone-legend-chart-type/42-CONTEXT.md
@.planning/phases/42-standalone-legend-chart-type/42-RESEARCH.md
@.planning/phases/41-layerslegendpanel-in-map-overlay/41-CONTEXT.md
@.planning/phases/41-layerslegendpanel-in-map-overlay/41-02-SUMMARY.md

@kinetica_bi/src/components/LayersLegendPanel.tsx
@kinetica_bi/src/components/LayersLegendPanel.spec.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/components/charts/ChartConfigPanel.tsx
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/components/DashboardsPage.tsx
@kinetica_bi/src/api/client.ts

<interfaces>
<!-- Key types/exports the executor needs. Extracted from codebase 2026-05-22. Use these directly — no exploration needed. -->

From `kinetica_bi/src/api/client.ts:303-312`:
```typescript
export type WidgetDto = {
  id: number;
  dashboard_id: number;
  title: string;
  type: string;           // OPEN string — no closed union; 'legend' needs NO type extension
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

From `kinetica_bi/src/api/client.ts:481`:
```typescript
export type DashboardLayerDto = { id: number; ... config: Record<string, unknown>; cb_config: string | null; ... }
```

From `kinetica_bi/src/components/LayersLegendPanel.tsx:32-42` (CURRENT shape, BEFORE this plan's extension):
```typescript
export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};

export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
```

From `kinetica_bi/src/components/charts/registry.ts:37-64` (CURRENT shape, BEFORE this plan's extension):
```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];
  tables?: { id: number; name: string; schema: string; columns: Record<string, string>; }[];
  isValid?: (valid: boolean) => void;
};
```

From `kinetica_bi/src/components/charts/MapChartRenderer.tsx:546-556` (CURRENT — target of refactor):
```typescript
const includedLayerIdsForLegend = widgetConfig.includedLayerIds as number[] | undefined;
const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
  const all = useDashboardLayersStore.getState().layers;
  const filtered =
    includedLayerIdsForLegend && includedLayerIdsForLegend.length > 0
      ? all.filter((l) => includedLayerIdsForLegend.includes(l.id))
      : all;
  return filtered.map((layer) => ({ layer, visible: true }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [legendKey, includedLayerIdsForLegend]);
```

From `kinetica_bi/src/components/charts/MapChartRenderer.tsx:89-90` (CURRENT imports — must continue to resolve after refactor; ResolvedLegendLayer back-compat re-export from LayersLegendPanel.tsx keeps this working):
```typescript
import { LayersLegendPanel } from "../LayersLegendPanel";
import type { ResolvedLegendLayer } from "../LayersLegendPanel";
```

From `kinetica_bi/src/components/LayersLegendPanel.spec.tsx:6` (existing spec import — back-compat must be preserved):
```typescript
import { LayersLegendPanel, type ResolvedLegendLayer } from "./LayersLegendPanel";
```

From `kinetica_bi/src/components/charts/WidgetRenderer.tsx:45-51` (CURRENT Props):
```typescript
type Props = {
  widget: WidgetDto;
};
type WidgetRendererProps = Props & {
  tables?: TableDto[];
};
```

From `kinetica_bi/src/components/charts/ChartConfigPanel.tsx:21-38` (CURRENT Props — extend with widgets?):
```typescript
type Props = {
  widgetType: string;
  title: string;
  config: Record<string, unknown>;
  tables?: TableInfo[];
  views?: ViewInfo[];
  dynamicViews?: DynamicViewRow[];
  onSave: (payload: { title: string; config: Record<string, unknown> }) => void;
  onCancel: () => void;
};
```

From `kinetica_bi/src/components/DashboardsPage.tsx:982-989` (CURRENT WidgetConfigModal render site):
```tsx
<WidgetConfigModal
  widget={configuringWidget}
  tables={associatedTables}
  views={views}
  dynamicViews={dynamicViews}
  onSave={(chartConfig) => handleSaveConfig(configuringWidget, chartConfig)}
  onClose={() => setConfiguringWidget(null)}
/>
```

From `kinetica_bi/src/components/DashboardsPage.tsx:955` (CURRENT WidgetRenderer mount site):
```tsx
<WidgetRenderer widget={w} tables={associatedTables} />
```

From `kinetica_bi/src/components/DashboardsPage.tsx:378` (existing state setter the new onConfigureWidget prop wires to):
```typescript
const [configuringWidget, setConfiguringWidget] = useState<WidgetDto | null>(null);
```

From `kinetica_bi/src/components/DashboardsPage.tsx:1055-1074` (CURRENT WidgetConfigModal signature — extend with `widgets`):
```typescript
const WidgetConfigModal = ({
  widget,
  tables,
  views,
  dynamicViews,
  onSave,
  onClose
}: {
  widget: WidgetDto;
  tables: TableDto[];
  views: ViewDto[];
  dynamicViews?: import("../api/client").DynamicViewRow[];
  onSave: (payload: { title: string; config: Record<string, unknown> }) => void;
  onClose: () => void;
}) => { ... }
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract resolveLegendLayers helper + back-compat re-export + Phase 41 MapChartRenderer refactor (zero behavior change)</name>
  <files>
    - kinetica_bi/src/lib/resolveLegendLayers.ts (NEW)
    - kinetica_bi/src/lib/resolveLegendLayers.spec.ts (NEW)
    - kinetica_bi/src/components/LayersLegendPanel.tsx (MODIFY — add back-compat type re-export only, no behavior change in this task)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (MODIFY — refactor useMemo body only)
  </files>
  <read_first>
    - kinetica_bi/src/components/LayersLegendPanel.tsx (full file — ~177 lines)
    - kinetica_bi/src/components/LayersLegendPanel.spec.tsx (line 6 confirms back-compat import `from "./LayersLegendPanel"`)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 1-100 + lines 525-560 (legendKey + resolvedLegendLayers useMemo)
    - kinetica_bi/src/api/client.ts lines 480-485 (DashboardLayerDto)
    - kinetica_bi/src/lib/legendPanelConfig.ts (Phase 41 helper-module precedent for file shape)
    - kinetica_bi/src/lib/trackConfig.ts (Phase 40 2nd-consumer extraction precedent)
  </read_first>
  <behavior>
    - Test 1 (resolveLegendLayers): `resolveLegendLayers([], undefined)` returns `[]`
    - Test 2: `resolveLegendLayers([], [])` returns `[]`
    - Test 3: `resolveLegendLayers([], [42, 99])` returns `[]`
    - Test 4 (Phase 12 empty-array-means-all-on): given a `storeLayers` array of 3 layers and `includedLayerIds === undefined`, the result has length 3 and each entry is `{ layer: <originalLayerRef>, visible: true }` in the original order
    - Test 5 (empty-array-means-all-on continued): given same 3-layer array and `includedLayerIds === []`, result still has length 3 (empty array treated identically to undefined)
    - Test 6 (filter applied when non-empty): given 3 layers with ids `[1, 2, 3]` and `includedLayerIds === [2]`, result has length 1 with layer.id === 2
    - Test 7 (mismatched IDs): given 2 layers with ids `[1, 2]` and `includedLayerIds === [99]`, result has length 0
    - Test 8 (preserves store order): given store layers `[{id:3},{id:1},{id:2}]` and `includedLayerIds === [1, 2, 3]`, result order is `[3, 1, 2]` (NOT sorted by includedLayerIds)
    - Test 9 (visible: true always): every returned entry has `visible === true` regardless of any layer field
    - Test 10 (LayersLegendPanel back-compat re-export): `import type { ResolvedLegendLayer } from "../components/LayersLegendPanel"` continues to resolve to the same type as `import type { ResolvedLegendLayer } from "../lib/resolveLegendLayers"` — verified via tsc + the LayersLegendPanel.spec.tsx existing 16 tests still pass without modification
    - Test 11 (MapChartRenderer refactor — zero behavior change): all 14 existing Phase 41 MapChartRenderer.spec.tsx tests still pass without modification to the spec file (the spec asserts panel mounts when legendPanelEnabled=true, renders correct layers per includedLayerIds, etc. — same observable behavior must hold after the useMemo body is replaced)
  </behavior>
  <action>
    **Step A — Create `kinetica_bi/src/lib/resolveLegendLayers.ts`** with this EXACT content:

    ```typescript
    /**
     * v1.7 Phase 42 (Plan 42-01): Shared layer derivation helper.
     *
     * Phase 41 (MapChartRenderer in-map overlay) was the 1st consumer of this derivation;
     * Phase 42 (standalone LegendRenderer) is the 2nd consumer. Per the Phase 40
     * lib/trackConfig.ts precedent, the derivation is lifted to a shared module on the
     * 2nd-consumer trigger to prevent divergence.
     *
     * Honors Phase 12's empty-array-means-all-on semantic for includedLayerIds:
     *   - undefined  → all store layers visible (legacy widgets pre-Phase-12)
     *   - []         → all store layers visible (lazy/inclusive default; same as undefined)
     *   - [a, b, c]  → only those layer IDs visible
     */

    import type { DashboardLayerDto } from "../api/client";

    export type ResolvedLegendLayer = {
      layer: DashboardLayerDto;
      visible: boolean;
    };

    /**
     * Filter store layers by widget config's includedLayerIds and project to ResolvedLegendLayer[].
     * Result order preserves storeLayers order (NOT includedLayerIds order).
     * Every returned entry has visible: true (callers that need a different visibility
     * convention should map the result).
     */
    export function resolveLegendLayers(
      storeLayers: DashboardLayerDto[],
      includedLayerIds: number[] | undefined,
    ): ResolvedLegendLayer[] {
      const filtered =
        includedLayerIds && includedLayerIds.length > 0
          ? storeLayers.filter((l) => includedLayerIds.includes(l.id))
          : storeLayers;
      return filtered.map((layer) => ({ layer, visible: true }));
    }
    ```

    **Step B — Create `kinetica_bi/src/lib/resolveLegendLayers.spec.ts`** with 9 tests covering all 9 RED cases in the `<behavior>` block above (Tests 1-9). Use vitest + describe + it pattern. Build minimal `DashboardLayerDto` fixtures via a `makeLayer(id: number): DashboardLayerDto` helper inside the spec file with all required fields populated (id, dashboard_id=1, table_id=1, layer_index=0, config={}, cb_config=null, info_enabled=1, dynamic_view_id=null) — match exact DashboardLayerDto shape from `kinetica_bi/src/api/client.ts:481`. Tests assert array length, `result[0].visible === true`, identity preservation (`result[0].layer === storeLayers[X]`), and store-order preservation.

    **Step C — Add back-compat re-export in `kinetica_bi/src/components/LayersLegendPanel.tsx`**:
    Replace the inline `export type ResolvedLegendLayer = { ... };` at LINE 32 with a re-export AFTER deleting the original. The exact transformation:

    BEFORE (lines 30-35):
    ```typescript
    // ─── Exported types ───────────────────────────────────────────────────────────

    export type ResolvedLegendLayer = {
      layer: DashboardLayerDto;
      visible: boolean;
    };
    ```

    AFTER:
    ```typescript
    // ─── Exported types ───────────────────────────────────────────────────────────

    // Phase 42 (Plan 42-01): ResolvedLegendLayer lifted to lib/resolveLegendLayers.ts
    // (2nd-consumer extraction per Phase 40 precedent). Back-compat re-export below
    // keeps LayersLegendPanel.spec.tsx:6 and MapChartRenderer.tsx:90 working unchanged.
    export type { ResolvedLegendLayer } from "../lib/resolveLegendLayers";
    ```

    Also remove the now-unused `import type { DashboardLayerDto } from "../api/client";` at line 24 IF AND ONLY IF no other reference to `DashboardLayerDto` remains in LayersLegendPanel.tsx after the type extraction. Run `grep -n "DashboardLayerDto" kinetica_bi/src/components/LayersLegendPanel.tsx` to verify — if any remain, leave the import.

    **Step D — Refactor `kinetica_bi/src/components/charts/MapChartRenderer.tsx` useMemo body (lines 547-556)**:

    Add a new import at the top of the file (next to existing `LayersLegendPanel` import at line 89):
    ```typescript
    import { resolveLegendLayers } from "../../lib/resolveLegendLayers";
    ```

    Replace lines 547-556 (the resolvedLegendLayers useMemo body) with this EXACT content. Preserve `includedLayerIdsForLegend` definition at line 546 unchanged, preserve the `useMemo<ResolvedLegendLayer[]>(...)` outer call signature, deps array, AND the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment:

    ```typescript
      const includedLayerIdsForLegend = widgetConfig.includedLayerIds as number[] | undefined;
      const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
        return resolveLegendLayers(
          useDashboardLayersStore.getState().layers,
          includedLayerIdsForLegend,
        );
        // legendKey is the read-trigger; includedLayerIdsForLegend is the filter trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [legendKey, includedLayerIdsForLegend]);
    ```

    **Verify zero behavior change**: run `npx vitest run kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` and confirm ALL 166 tests pass without ANY modification to the spec file. If any test fails, the refactor is wrong — fix the refactor (not the test).

    **AVOID:**
    - Don't drop the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment — `useDashboardLayersStore.getState()` is an imperative read; legendKey is the reactive trigger that justifies the disable
    - Don't modify the useMemo deps array — keep `[legendKey, includedLayerIdsForLegend]` exactly as-is
    - Don't modify LayersLegendPanel.spec.tsx — its import `from "./LayersLegendPanel"` MUST continue to work via the back-compat re-export
    - Don't modify any Phase 41 MapChartRenderer.spec.tsx tests — the refactor is observationally identical
    - Don't add `visible: bound.visible` or any new field — the helper signature is fixed: `(storeLayers, includedLayerIds) => ResolvedLegendLayer[]` with `visible: true` hard-coded
    - Don't sort the filtered layers by `includedLayerIds` — store order is preserved (matches Phase 41 behavior)
    - Don't add a `__test__` export hook — keep the helper public-API minimal
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/resolveLegendLayers.spec.ts src/components/LayersLegendPanel.spec.tsx src/components/charts/MapChartRenderer.spec.tsx 2>&1 | tail -50</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/lib/resolveLegendLayers.ts` returns 0
    - `test -f kinetica_bi/src/lib/resolveLegendLayers.spec.ts` returns 0
    - `grep -c "export function resolveLegendLayers" kinetica_bi/src/lib/resolveLegendLayers.ts` returns 1
    - `grep -c "export type ResolvedLegendLayer" kinetica_bi/src/lib/resolveLegendLayers.ts` returns 1
    - `grep -c "export type { ResolvedLegendLayer } from \"../lib/resolveLegendLayers\"" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1
    - `grep -c "^export type ResolvedLegendLayer = " kinetica_bi/src/components/LayersLegendPanel.tsx` returns 0 (inline type definition removed)
    - `grep -c "resolveLegendLayers" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 2 (one import, one call inside useMemo body)
    - `grep -n "includedLayerIds.includes" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns NO matches (the inline filter was moved into the helper)
    - `grep -n "eslint-disable-next-line react-hooks/exhaustive-deps" kinetica_bi/src/components/charts/MapChartRenderer.tsx` STILL finds the comment in the same useMemo block (preserve eslint-disable)
    - `grep -c "\\[legendKey, includedLayerIdsForLegend\\]" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 1 (useMemo deps unchanged)
    - vitest: `kinetica_bi/src/lib/resolveLegendLayers.spec.ts` passes (>= 9 new tests, all green)
    - vitest: `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` passes ALL existing 16 tests WITHOUT spec-file modification
    - vitest: `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` passes ALL existing 166 tests WITHOUT spec-file modification
  </acceptance_criteria>
  <done>
    `lib/resolveLegendLayers.ts` exists with `resolveLegendLayers` function + `ResolvedLegendLayer` type; spec has >= 9 passing tests; LayersLegendPanel.tsx re-exports the type; MapChartRenderer's useMemo body calls the helper while preserving the deps array and eslint-disable comment; all existing Phase 41 specs pass without modification.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend LayersLegendPanel with optional showChevron prop (default true; additive, back-compat)</name>
  <files>
    - kinetica_bi/src/components/LayersLegendPanel.tsx (MODIFY)
    - kinetica_bi/src/components/LayersLegendPanel.spec.tsx (MODIFY — add 4 new tests for showChevron=false branch; do not change existing 16 tests)
  </files>
  <read_first>
    - kinetica_bi/src/components/LayersLegendPanel.tsx (full file as it exists AFTER Task 1)
    - kinetica_bi/src/components/LayersLegendPanel.spec.tsx (full file — note line 6 import shape; 16 existing tests)
  </read_first>
  <behavior>
    - Test 12 (showChevron default — undefined): `<LayersLegendPanel layers={[layerA]} corner="top-right" collapsed={false} onToggleCollapse={mockToggle} />` (no showChevron prop) — chevron button is rendered with `aria-expanded="true"`, clicking header div calls `mockToggle` (1 call), clicking the inner chevron button also calls `mockToggle` (separately), header has cursor:pointer
    - Test 13 (showChevron=true explicit): same as Test 12 but with `showChevron={true}` — identical behavior; chevron present, click-toggles work
    - Test 14 (showChevron=false — no chevron): `<LayersLegendPanel layers={[layerA]} corner="top-right" collapsed={false} onToggleCollapse={mockToggle} showChevron={false} />` — chevron button is NOT in the DOM (`queryByRole("button")` returns null OR returns no button matching aria-expanded), header div has NO onClick / clicking the header div does NOT call `mockToggle`, and the header has NO `role="button"` / NO `aria-expanded` / NO `aria-controls` attributes
    - Test 15 (showChevron=false — body always rendered): `<LayersLegendPanel layers={[layerA]} corner="top-right" collapsed={true} onToggleCollapse={mockToggle} showChevron={false} />` — even though `collapsed={true}`, the layer-row body IS rendered (`getByText("layer-A")` returns the layer name). This is the locked rule: when showChevron=false, `collapsed` is ignored and body always shows.
  </behavior>
  <action>
    **Step A — Extend the props type at `kinetica_bi/src/components/LayersLegendPanel.tsx:37-42`**:

    BEFORE:
    ```typescript
    export type LayersLegendPanelProps = {
      layers: ResolvedLegendLayer[];
      corner: LegendPanelCorner;
      collapsed: boolean;
      onToggleCollapse: () => void;
    };
    ```

    AFTER:
    ```typescript
    export type LayersLegendPanelProps = {
      layers: ResolvedLegendLayer[];
      corner: LegendPanelCorner;
      collapsed: boolean;
      onToggleCollapse: () => void;
      /**
       * Phase 42 (Plan 42-01): when false, header renders the "Layers" label only —
       * no chevron icon, no onClick on the header div, no role/aria-expanded/aria-controls,
       * no pointer cursor, and the body ALWAYS renders regardless of `collapsed`.
       * Default `true` preserves Phase 41 in-map overlay behavior.
       * Phase 42 LegendRenderer (Plan 42-02) passes `false` to render a non-collapsible
       * panel inside a dashboard grid cell.
       */
      showChevron?: boolean;
    };
    ```

    **Step B — Update component signature** to destructure showChevron (line 87-92):

    BEFORE:
    ```typescript
    export function LayersLegendPanel({
      layers,
      corner,
      collapsed,
      onToggleCollapse,
    }: LayersLegendPanelProps): JSX.Element {
    ```

    AFTER:
    ```typescript
    export function LayersLegendPanel({
      layers,
      corner,
      collapsed,
      onToggleCollapse,
      showChevron = true,
    }: LayersLegendPanelProps): JSX.Element {
    ```

    **Step C — Update the header JSX (lines 99-117)** to conditionally render the chevron button and the onClick:

    BEFORE:
    ```tsx
          <div
            className="layers-legend-panel-header"
            onClick={onToggleCollapse}
          >
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              {collapsed ? "▸" : "▾"}
            </button>
            <span>Layers</span>
          </div>
    ```

    AFTER:
    ```tsx
          <div
            className="layers-legend-panel-header"
            onClick={showChevron ? onToggleCollapse : undefined}
            style={{ cursor: showChevron ? "pointer" : "default" }}
          >
            {showChevron && (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse();
                }}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                {collapsed ? "▸" : "▾"}
              </button>
            )}
            <span>Layers</span>
          </div>
    ```

    **Step D — Update the body render condition (line 120)**:

    BEFORE:
    ```tsx
          {!collapsed && (
            <div className="layers-legend-panel-body" id={bodyId}>
    ```

    AFTER:
    ```tsx
          {(!showChevron || !collapsed) && (
            <div className="layers-legend-panel-body" id={bodyId}>
    ```

    This implements the lock: when showChevron is false, body ALWAYS renders (collapsed is ignored).

    **Step E — Add 4 new tests at the END of `kinetica_bi/src/components/LayersLegendPanel.spec.tsx`** in a new `describe("Phase 42 showChevron prop", () => { ... })` block. The tests cover the 4 behavior cases (Tests 12-15) from the `<behavior>` block. Use the existing `makeResolvedLayer` helper at line 33. Use `@testing-library/react`'s `render`, `screen`, `fireEvent`. Use a `vi.fn()` mock for `onToggleCollapse`. Sample skeleton for Test 14:

    ```typescript
    it("showChevron=false renders header without chevron, no onClick, no aria attrs", () => {
      const mockToggle = vi.fn();
      const layer = makeResolvedLayer({ id: 99 });
      const { container } = render(
        <LayersLegendPanel
          layers={[layer]}
          corner="top-right"
          collapsed={false}
          onToggleCollapse={mockToggle}
          showChevron={false}
        />
      );
      const header = container.querySelector(".layers-legend-panel-header") as HTMLElement;
      expect(header).toBeTruthy();
      // No chevron button
      expect(header.querySelector("button")).toBeNull();
      // No aria-expanded on header
      expect(header.getAttribute("aria-expanded")).toBeNull();
      // No role=button on header
      expect(header.getAttribute("role")).not.toBe("button");
      // Cursor default
      expect((header.style as CSSStyleDeclaration).cursor).toBe("default");
      // Clicking header does not fire toggle
      fireEvent.click(header);
      expect(mockToggle).not.toHaveBeenCalled();
    });
    ```

    Cover all 4 behaviors (Tests 12, 13, 14, 15). Do not modify any of the 16 existing tests.

    **AVOID:**
    - Don't change the existing 16 tests
    - Don't drop the `<span>Layers</span>` label — it renders in both showChevron=true and showChevron=false branches
    - Don't add a separate "headerless" mode — showChevron=false keeps the "Layers" label, only removes the chevron + clickability
    - Don't make showChevron a required prop — it must be optional with default true for Phase 41 back-compat
    - Don't conditionalize `<span>Layers</span>` — it stays unconditional
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/LayersLegendPanel.spec.tsx 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "showChevron?: boolean" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1
    - `grep -c "showChevron = true" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1 (default in destructure)
    - `grep -c "showChevron ? onToggleCollapse : undefined" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1
    - `grep -c "{showChevron &&" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1 (conditional chevron button)
    - `grep -c "(!showChevron || !collapsed)" kinetica_bi/src/components/LayersLegendPanel.tsx` returns 1 (body-always-renders rule)
    - `grep -c "Phase 42 showChevron prop" kinetica_bi/src/components/LayersLegendPanel.spec.tsx` returns 1 (new describe block)
    - vitest: ALL existing 16 tests still pass without modification
    - vitest: 4 new tests pass (>= 20 total tests in LayersLegendPanel.spec.tsx)
  </acceptance_criteria>
  <done>
    `<LayersLegendPanel>` accepts optional `showChevron?: boolean` (default `true`); when false, no chevron, no header onClick, body always renders; 4 new tests pass; existing 16 tests still pass without modification.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Thread ConfigPanelProps.widgets + onConfigureWidget through ChartConfigPanel + WidgetRenderer + DashboardsPage</name>
  <files>
    - kinetica_bi/src/components/charts/registry.ts (MODIFY — add optional widgets?: WidgetDto[] to ConfigPanelProps)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (MODIFY — accept widgets prop, thread to <Custom> slot)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (MODIFY — accept onConfigureWidget prop)
    - kinetica_bi/src/components/DashboardsPage.tsx (MODIFY — WidgetConfigModal signature gains widgets, render site passes widgets={widgets}; WidgetRenderer mount passes onConfigureWidget={setConfiguringWidget})
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/registry.ts (full file — 138 lines)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx lines 1-100, 320-400, 386-433 (Custom panel slot)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx lines 1-50, 210-242 (Props, WidgetRendererProps, early-return ladder)
    - kinetica_bi/src/components/DashboardsPage.tsx lines 375-385 (widgets state + configuringWidget state), 950-960 (WidgetRenderer mount), 980-995 (WidgetConfigModal render site), 1055-1100 (WidgetConfigModal signature + ChartConfigPanel invocation)
    - kinetica_bi/src/api/client.ts lines 303-312 (WidgetDto)
  </read_first>
  <behavior>
    - Test 16 (registry.ts type): `ConfigPanelProps['widgets']` resolves to `WidgetDto[] | undefined` (optional). Verified via tsc compilation + by grep for the field declaration.
    - Test 17 (ChartConfigPanel forwards widgets to Custom): when ChartConfigPanel is rendered with a custom chart type and `widgets={[{...}, {...}]}` prop, the rendered `<Custom>` panel receives `widgets={[{...}, {...}]}` as a prop. Verified via spec test that mocks a custom panel and asserts the prop passes through.
    - Test 18 (WidgetRenderer accepts onConfigureWidget): WidgetRenderer's Props/WidgetRendererProps gains `onConfigureWidget?: (widget: WidgetDto) => void` and the prop is destructured (not yet consumed in WidgetRenderer body — consumer ships in Plan 42-02 LegendRenderer). Verified via tsc + grep.
    - Test 19 (DashboardsPage wires the prop): the WidgetRenderer mount at line ~955 includes `onConfigureWidget={(w) => setConfiguringWidget(w)}` (or equivalent identity-preserving binding); the WidgetConfigModal render at line ~982 includes `widgets={widgets}`; the WidgetConfigModal signature accepts a new `widgets: WidgetDto[]` field and the inner ChartConfigPanel invocation forwards it.
    - Test 20 (no regression — existing 47+ MapConfigPanel + ChartConfigPanel specs still pass without modification): the additive prop doesn't break any existing consumer.
  </behavior>
  <action>
    **Step A — Extend `kinetica_bi/src/components/charts/registry.ts` ConfigPanelProps (lines 37-64)**:

    Add a new import at the top of the file (next to existing `import type { ComponentType }`):
    ```typescript
    import type { WidgetDto } from "../../api/client";
    ```

    Add the `widgets?: WidgetDto[]` field at the END of the `ConfigPanelProps` type literal (before the closing `}`):

    ```typescript
    export type ConfigPanelProps = {
      config: Record<string, unknown>;
      onChange: (config: Record<string, unknown>) => void;
      columns?: { name: string; type: string }[];
      tables?: {
        id: number;
        name: string;
        schema: string;
        columns: Record<string, string>;
      }[];
      isValid?: (valid: boolean) => void;
      /**
       * Phase 42 (Plan 42-01 / WIDGET-V17-03): dashboard widget list, threaded from
       * DashboardsPage → WidgetConfigModal → ChartConfigPanel → Custom panel slot.
       * LegendConfigPanel (Plan 42-02) uses this to populate the source-map-widget
       * dropdown. Required as a prop (not via useDashboardContext) because
       * WidgetConfigModal is rendered OUTSIDE DashboardContextProvider —
       * useDashboardContext() would throw at runtime.
       * Optional — non-legend panels ignore.
       */
      widgets?: WidgetDto[];
    };
    ```

    **Step B — Extend `kinetica_bi/src/components/charts/ChartConfigPanel.tsx`**:

    1. Import `WidgetDto` at the top alongside existing imports:
    ```typescript
    import type { DynamicViewRow, WidgetDto } from "../../api/client";
    ```

    2. Extend the `Props` type (lines 21-38) — add `widgets?: WidgetDto[]` field with this JSDoc:
    ```typescript
    /**
     * Phase 42 (Plan 42-01): dashboard widget list threaded from WidgetConfigModal.
     * Forwarded to <Custom> panel slot so LegendConfigPanel (Plan 42-02) can populate
     * its source-map-widget dropdown.
     */
    widgets?: WidgetDto[];
    ```

    3. Destructure `widgets` in the component signature (lines 62-71):
    ```typescript
    const ChartConfigPanel = ({
      widgetType,
      title,
      config,
      tables,
      views,
      dynamicViews,
      widgets,           // Phase 42 Plan 42-01
      onSave,
      onCancel,
    }: Props) => {
    ```

    4. Forward `widgets` to the `<Custom>` panel slot at line ~386:
    ```tsx
              <Custom
                config={draft}
                columns={allColumns}
                tables={tables}
                widgets={widgets}       // Phase 42 Plan 42-01: thread for LegendConfigPanel
                isValid={(valid) => setCustomPanelValid(valid)}
                onChange={(c) => {
                  // ... existing onChange logic unchanged ...
    ```

    **Step C — Extend `kinetica_bi/src/components/charts/WidgetRenderer.tsx`** (lines 45-51, 212):

    Extend the Props + WidgetRendererProps types:
    ```typescript
    type Props = {
      widget: WidgetDto;
      /**
       * Phase 42 (Plan 42-01): callback to request the widget config modal to open.
       * Threaded down from DashboardsPage (which owns setConfiguringWidget state).
       * Consumed by Plan 42-02 LegendRenderer's Reconfigure button. Optional — non-legend
       * renderers ignore.
       */
      onConfigureWidget?: (widget: WidgetDto) => void;
    };

    type WidgetRendererProps = Props & {
      tables?: TableDto[];
    };
    ```

    Update the WidgetRenderer destructure (line 212):
    ```typescript
    const WidgetRenderer = ({ widget, tables = [], onConfigureWidget }: WidgetRendererProps) => {
    ```

    No consumer wiring in this task — `onConfigureWidget` is destructured but unused. Plan 42-02 adds the `LegendRenderer` consumer. To avoid `noUnusedLocals` lint errors, add a `void onConfigureWidget;` line directly under the destructure as a no-op marker:
    ```typescript
    const WidgetRenderer = ({ widget, tables = [], onConfigureWidget }: WidgetRendererProps) => {
      // Phase 42 Plan 42-01: prop is destructured here but consumed in Plan 42-02 by
      // the new LegendRenderer branch. void-tag silences noUnusedLocals until then.
      void onConfigureWidget;
    ```

    **Step D — Wire `kinetica_bi/src/components/DashboardsPage.tsx`**:

    1. WidgetRenderer mount at line ~955 — add `onConfigureWidget` prop:
    ```tsx
                  <WidgetRenderer
                    widget={w}
                    tables={associatedTables}
                    onConfigureWidget={(target) => setConfiguringWidget(target)}
                  />
    ```

    Use the inline arrow `(target) => setConfiguringWidget(target)` (NOT bare `setConfiguringWidget` reference) to make the parameter name explicit at the call site.

    2. WidgetConfigModal render site at line ~982 — add `widgets={widgets}`:
    ```tsx
            <WidgetConfigModal
              widget={configuringWidget}
              widgets={widgets}
              tables={associatedTables}
              views={views}
              dynamicViews={dynamicViews}
              onSave={(chartConfig) => handleSaveConfig(configuringWidget, chartConfig)}
              onClose={() => setConfiguringWidget(null)}
            />
    ```

    3. WidgetConfigModal signature at line ~1055 — add `widgets: WidgetDto[]` field and forward to ChartConfigPanel:
    ```typescript
    const WidgetConfigModal = ({
      widget,
      widgets,
      tables,
      views,
      dynamicViews,
      onSave,
      onClose
    }: {
      widget: WidgetDto;
      widgets: WidgetDto[];           // Phase 42 Plan 42-01: required prop
      tables: TableDto[];
      views: ViewDto[];
      dynamicViews?: import("../api/client").DynamicViewRow[];
      onSave: (payload: { title: string; config: Record<string, unknown> }) => void;
      onClose: () => void;
    }) => {
      // ... existing destructure of chartConfig ...
      return (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal-content modal-config" onClick={(e) => e.stopPropagation()}>
            // ... existing header ...
            <div className="modal-body">
              <ChartConfigPanel
                widgetType={widget.type}
                title={widget.title}
                config={chartConfig}
                tables={tables}
                views={views}
                dynamicViews={dynamicViews}
                widgets={widgets}      // Phase 42 Plan 42-01: forward to <Custom> slot
                onSave={onSave}
                onCancel={onClose}
              />
            </div>
          </div>
        </div>
      );
    };
    ```

    The `widgets` field on the WidgetConfigModal props is REQUIRED (not optional) — DashboardsPage always has the state variable available; mirrors Phase 30 widgets-required lock.

    **Step E — Add a single new test in `kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx`** (or create the spec file if it doesn't exist) verifying widgets-prop threading. Skeleton:

    ```typescript
    it("Phase 42 Plan 42-01: forwards widgets prop to <Custom> panel slot", () => {
      const widgetsList: WidgetDto[] = [
        { id: 1, dashboard_id: 1, title: "Map A", type: "map", position: 0, config: {}, created_at: "", updated_at: "" },
        { id: 2, dashboard_id: 1, title: "Bar B", type: "bar", position: 1, config: {}, created_at: "", updated_at: "" },
      ];
      let receivedWidgets: WidgetDto[] | undefined;
      const StubCustom = (props: { widgets?: WidgetDto[] }) => {
        receivedWidgets = props.widgets;
        return <div data-testid="stub-custom" />;
      };
      // Register a temporary chart type with the stub CustomConfigPanel
      registerChartType({
        type: "__test-custom__",
        label: "Test",
        icon: "T",
        fields: [],
        defaultConfig: {},
        usesAggregation: false,
        supportsDrillDown: false,
        CustomConfigPanel: StubCustom,
      });
      render(
        <ChartConfigPanel
          widgetType="__test-custom__"
          title="Test"
          config={{}}
          tables={[]}
          widgets={widgetsList}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(receivedWidgets).toEqual(widgetsList);
    });
    ```

    Place inside an existing `describe` block if one exists, or wrap in a new `describe("Phase 42 widgets prop threading", () => { ... })`. If `ChartConfigPanel.spec.tsx` does not exist, create it with minimal vitest harness + the test above. Verify the spec passes (tsc clean + vitest green).

    **AVOID:**
    - Don't make WidgetConfigModal's `widgets` prop optional — DashboardsPage always has it; required matches Phase 30 lock for loud failure
    - Don't drop the `void onConfigureWidget;` no-op — without it, tsc/eslint will flag unused parameter
    - Don't pass `onConfigureWidget` as bare `setConfiguringWidget` reference — use explicit `(target) => setConfiguringWidget(target)` so the type signature contract matches `(widget: WidgetDto) => void` exactly (setConfiguringWidget accepts `WidgetDto | null`, which would type-mismatch)
    - Don't write/read `useDashboardContext()` inside `LegendConfigPanel` — that's the entire reason this prop threading exists (Pitfall 1 in 42-RESEARCH.md)
    - Don't add `widgets` as a prop to `WidgetRenderer` — only `onConfigureWidget` goes there; `widgets` is for the config panel side only
    - Don't break existing ChartConfigPanel.spec.tsx tests — additive only
    - Don't add the `widgets` prop to any non-custom chart type's expected behavior — the field is opt-in via ConfigPanelProps
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -E "(error TS|widgets|onConfigureWidget)" | head -20 && npx vitest run src/components/charts/ChartConfigPanel.spec.tsx src/components/charts/MapConfigPanel.spec.tsx 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "widgets?: WidgetDto\\[\\]" kinetica_bi/src/components/charts/registry.ts` returns 1
    - `grep -c "import type { ComponentType }" kinetica_bi/src/components/charts/registry.ts` returns 1
    - `grep -c "WidgetDto" kinetica_bi/src/components/charts/registry.ts` returns at least 2 (1 import + 1 use)
    - `grep -c "widgets?: WidgetDto\\[\\]" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns 1
    - `grep -c "widgets={widgets}" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns 1 (Custom panel slot)
    - `grep -c "onConfigureWidget?: " kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `grep -c "onConfigureWidget" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns at least 2 (declaration + destructure)
    - `grep -c "onConfigureWidget=" kinetica_bi/src/components/DashboardsPage.tsx` returns 1
    - `grep -c "setConfiguringWidget(target)" kinetica_bi/src/components/DashboardsPage.tsx` returns 1
    - `grep -c "widgets={widgets}" kinetica_bi/src/components/DashboardsPage.tsx` returns at least 2 (WidgetConfigModal render site + ChartConfigPanel invocation inside WidgetConfigModal)
    - `grep -c "widgets: WidgetDto\\[\\]" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 (WidgetConfigModal signature — REQUIRED prop, not optional)
    - `cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -c "error TS"` returns 0 NEW errors (existing pre-Plan-42-01 baseline preserved; if pre-existing errors exist they must match the count from STATE.md Phase 41 SUMMARY)
    - vitest: ChartConfigPanel.spec.tsx new "Phase 42 widgets prop threading" test passes
    - vitest: MapConfigPanel.spec.tsx all 58 existing tests still pass (no regression from registry.ts/ChartConfigPanel.tsx changes)
  </acceptance_criteria>
  <done>
    `ConfigPanelProps.widgets?: WidgetDto[]` exists; `ChartConfigPanel` threads `widgets` to `<Custom>` slot; `WidgetRenderer` declares optional `onConfigureWidget` prop with `void` no-op; `DashboardsPage` wires the prop at the WidgetRenderer mount site and forwards `widgets` to WidgetConfigModal → ChartConfigPanel; tsc clean (no new errors); MapConfigPanel + ChartConfigPanel specs green.
  </done>
</task>

</tasks>

<verification>
**Phase 41 zero-behavior-change regression:**
```bash
cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx 2>&1 | tail -5
# Expect: 166/166 PASS — same as Phase 41 baseline
```

**Plan 42-01 new tests:**
```bash
cd kinetica_bi && npx vitest run src/lib/resolveLegendLayers.spec.ts src/components/LayersLegendPanel.spec.tsx src/components/charts/ChartConfigPanel.spec.tsx 2>&1 | tail -10
# Expect: >= 9 (resolveLegendLayers) + 20 (LayersLegendPanel) + 1+ (ChartConfigPanel widgets-threading) new passing tests
```

**Full frontend regression check:**
```bash
cd kinetica_bi && npx vitest run 2>&1 | tail -5
# Expect: full suite green, no regressions from Phase 41 baseline (1239+ tests pre-plan)
```

**tsc clean:**
```bash
cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -c "error TS"
# Expect: 0 NEW errors over the Phase 41 baseline (a handful of pre-existing spec-only errors documented in 41-02-SUMMARY.md may persist; planner verifies count parity)
```
</verification>

<success_criteria>
- `lib/resolveLegendLayers.ts` exists with pure helper + ResolvedLegendLayer type; ≥9 unit tests pass
- LayersLegendPanel.tsx back-compat re-exports `ResolvedLegendLayer` from `lib/resolveLegendLayers`
- MapChartRenderer.tsx useMemo body calls `resolveLegendLayers(...)`; eslint-disable + deps array preserved
- LayersLegendPanel.tsx accepts optional `showChevron?: boolean` (default true); 4 new tests cover showChevron=false branch; 16 existing tests unchanged
- `ConfigPanelProps.widgets?: WidgetDto[]` exists
- ChartConfigPanel threads `widgets` to `<Custom>` slot
- WidgetRenderer declares optional `onConfigureWidget?: (widget: WidgetDto) => void` prop
- DashboardsPage wires `onConfigureWidget={(target) => setConfiguringWidget(target)}` on WidgetRenderer mount
- DashboardsPage forwards `widgets={widgets}` to WidgetConfigModal → ChartConfigPanel
- WidgetConfigModal accepts `widgets: WidgetDto[]` (required)
- Phase 41 MapChartRenderer.spec.tsx 166 tests green without modification
- Phase 41 LayersLegendPanel.spec.tsx 16 existing tests green without modification
- tsc clean (no new errors over Phase 41 baseline)
- Plan 42-02 is unblocked: it can create `LegendRenderer.tsx` that consumes `resolveLegendLayers`, mounts `<LayersLegendPanel showChevron={false}>`, calls `onConfigureWidget` on the Reconfigure button, and ship `LegendConfigPanel.tsx` that reads `widgets` from props (not context).
</success_criteria>

<output>
After completion, create `.planning/phases/42-standalone-legend-chart-type/42-01-SUMMARY.md` capturing:
- 3 tasks completed with commit hashes + file lists
- Test counts: new tests added + pre-existing tests preserved (no regression)
- Phase 41 zero-behavior-change refactor verified (166/166 MapChartRenderer tests green without spec modification)
- Plan 42-02 readiness checklist: `lib/resolveLegendLayers.ts` callable, `<LayersLegendPanel showChevron={false}>` usable, `ConfigPanelProps.widgets` available, `onConfigureWidget` available
- Any deviations from this plan with rationale
- tsc baseline parity
</output>
