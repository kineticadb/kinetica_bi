# Phase 42: Standalone Legend Chart Type - Research

**Researched:** 2026-05-22
**Domain:** React chart-type registry pattern, Zustand primitive selectors, CustomConfigPanel context wiring
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- `type='legend'`, `label='Legend'`, `icon='LG'`, `fields=[]`, `defaultConfig={}`, `usesAggregation=false`, `supportsDrillDown=false` — mirrors info-card registry shape verbatim
- WidgetRenderer early-return `else if (widget.type === "legend")` BEFORE `AggregatedWidgetRenderer` — mirrors info-card short-circuit pattern
- `<LegendRenderer />` reads `widget.config.sourceMapWidgetId`, finds bound map widget via dashboard widgets, subscribes via `legendKey` primitive selector (PITFALL S-02)
- `<LayersLegendPanel>` mounted with `showChevron={false}`, `collapsed={false}`, `corner='top-right'` (irrelevant in grid cell)
- `lib/resolveLegendLayers.ts` shared helper extracted; Phase 41 MapChartRenderer refactored to call it (zero-behavior-change)
- Three orphan triggers: `sourceMapWidgetId === undefined`, widget not found, found widget is non-map — all render the same UI
- Orphan copy verbatim: "Source map widget not found. Reconfigure the legend."
- `showChevron?: boolean` (default `true`) — when `false`: no chevron, no onClick, no role='button', no aria-expanded/aria-controls, cursor default, body always rendered, `collapsed` prop ignored
- CSS class names: `.legend-widget-body`, `.legend-widget-orphan`, `.legend-widget-orphan-message`, `.legend-widget-orphan-reconfigure`
- NO auto-rebind when bound widget deleted; NO cascade-delete; operator-initiated reconfigure only
- `legendKey` selector formula: `s.layers.map(l => \`\${l.id}:\${l.config?.renderMode ?? "raster"}:\${l.cb_config ?? "null"}\`).join("|")` — mirror of Phase 41 MapChartRenderer selector verbatim
- `resolvedLegendLayers` useMemo deps: `[legendKey, bound?.config.includedLayerIds]`
- Empty-array-means-all-on semantic (Phase 12) honored in `resolveLegendLayers`
- Cross-dashboard legend binding locked OUT (WIDGET-V17-03)
- Live updates via `updateLayer` → `legendKey` change → useMemo recompute → component re-render (same mechanism as Phase 41 in-map panel)
- Auto-pick first map widget on Apply when `sourceMapWidgetId === undefined && mapWidgets.length > 0`
- No SQL fetch logic in LegendRenderer; no corner-anchor field; no collapse state in LegendRenderer

### Claude's Discretion

- **Auto-pick injection site**: ChartConfigPanel Apply handler vs LegendConfigPanel `useEffect`. Recommendation in CONTEXT.md: `LegendConfigPanel` useEffect keeps auto-pick logic local.
- **Reconfigure button modal open mechanism**: identify existing pattern (DashboardsPage `setConfiguringWidget`) — planner threads the existing mechanism.
- **`ResolvedLegendLayer` re-export from `LayersLegendPanel.tsx`**: back-compat re-export if existing test imports depend on it.
- **`DashboardContext` shape verification**: confirm context reach into `CustomConfigPanel` mount site. If not reachable, add `widgets` to `ConfigPanelProps`.
- **Spec file organization**: `LegendRenderer.spec.tsx` + `LegendConfigPanel.spec.tsx` (or inline one in the other if small).
- **CSS file location**: append `.legend-widget*` to global.css (Phase 41 precedent).
- **Phase 41 refactor scope**: pure-refactor task with zero-behavior-change; Phase 41 MapChartRenderer tests must pass unmodified.
- **WidgetDto.type union**: verify whether 'legend' needs explicit union extension.
- **Legend widget default grid sizing**: planner picks (recommendation: 4×6 grid units).

### Deferred Ideas (OUT OF SCOPE)

- Cross-dashboard legend mirroring
- Corner-anchor picker for standalone widget
- Session-only collapse for standalone widget
- CB-only filter on eligible map widgets
- Custom title pre-fill
- Preview pane in LegendConfigPanel
- Auto-rebind on bound-widget-deletion
- Cascade-delete legend widgets when bound map deleted
- Differentiated orphan trigger UIs
- Legend widget icon as FontAwesome glyph
- Auto-open config modal on orphan render
- `<LayersLegendPanel showHeader?>` to drop entire header
- Multi-map legend
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIDGET-V17-01 | New chart type `legend` registered in definitions/legend.ts + definitions/index.ts; `<WidgetRenderer />` early-return on `widget.type === "legend"` | info-card.ts + index.ts + WidgetRenderer.tsx early-return ladder fully verified — exact insertion point confirmed |
| WIDGET-V17-02 | `<LegendRenderer />` consumes `<LayersLegendPanel />`; subscribes to `useDashboardLayersStore` for bound map widget's layers via primitive `legendKey` selector | legendKey selector (lines 533–540 MapChartRenderer.tsx), resolvedLegendLayers useMemo (lines 547–556), LayersLegendPanel props contract all verified |
| WIDGET-V17-03 | Config UI — operator picks a single map widget on same dashboard via dropdown (`config.sourceMapWidgetId: number`). Cross-dashboard binding out of scope | ConfigPanelProps + context reach + WidgetConfigModal outside DashboardContextProvider — cleanest path is `widgets` in ConfigPanelProps, verified |
| WIDGET-V17-04 | Orphan state — bound map widget deleted or ID invalid: "Source map widget not found. Reconfigure the legend." + reconfigure CTA | `setConfiguringWidget(widget)` is the DashboardsPage open-config-modal mechanism; LegendRenderer needs widget prop + onConfigure callback or context |
| WIDGET-V17-05 | Live updates — operator edits CB colors/labels in LayersModal → standalone Legend re-renders without page reload | `useDashboardLayersStore.updateLayer` reference-stable (lines 36–46); legendKey selector guarantees reactive update — verified |
</phase_requirements>

## Summary

Phase 42 is a frontend-only feature shipping a new `legend` chart type that mirrors `<LayersLegendPanel />` from a chosen bound map widget. All infrastructure it needs is already shipped: the `LayersLegendPanel` component (Phase 41), the `legendKey` primitive selector pattern (Phase 41), `useDashboardLayersStore` with reference-stable `updateLayer` (Phase 12/41), and `DashboardContextProvider` with the `widgets` array (Phase 30).

The primary technical challenge is the context wiring: `WidgetConfigModal` (which contains `ChartConfigPanel` and thus `LegendConfigPanel`) is rendered **outside** the `DashboardContextProvider` tree in `DashboardsPage.tsx`. The `DashboardContextProvider` ends at line 963; `WidgetConfigModal` begins at line 982. This means `useDashboardContext()` would throw inside `LegendConfigPanel`. The correct solution is to add a `widgets?: WidgetDto[]` field to `ConfigPanelProps` in `registry.ts` and thread it down from `ChartConfigPanel` through to the `Custom` panel slot. `WidgetConfigModal` already receives `widget` and `tables` as props — adding `widgets` is the same threading pattern Phase 28 used for the `tables` field in `ConfigPanelProps`.

The second important finding is that `WidgetDto.type` is declared as `type: string` (an open string type — not a closed union), so adding `'legend'` requires no type union extension. New widgets default to `w: 6, h: 4` grid units via `handleAddVisualization` in DashboardsPage (line 534) — this applies universally to all new chart types.

**Primary recommendation:** Thread `widgets` into `ConfigPanelProps` (additive optional field mirroring the Phase 28 `tables` pattern) so `LegendConfigPanel` reads `props.widgets` without context. This is the cleanest path that requires the least cross-cutting change and avoids a new context propagation.

## Standard Stack

### Core (no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | Component + hooks | Already in project |
| zustand | existing | `useDashboardLayersStore` subscription | Established store pattern |
| `@testing-library/react` | existing | Spec testing | Established test pattern |

**No new npm dependencies required for Phase 42.** All libraries are already installed.

### Key Existing Modules Phase 42 Uses

| Module | Path | What Phase 42 Uses |
|--------|------|--------------------|
| LayersLegendPanel | `kinetica_bi/src/components/LayersLegendPanel.tsx` | Renders layer list with CB swatches |
| ResolvedLegendLayer type | `kinetica_bi/src/components/LayersLegendPanel.tsx:32` | Exported type; Phase 42 moves to resolveLegendLayers.ts + re-exports |
| useDashboardLayersStore | `kinetica_bi/src/store/dashboardLayersStore.ts` | legendKey primitive selector |
| DashboardContextProvider | `kinetica_bi/src/components/DashboardContext.tsx` | NOT reachable from WidgetConfigModal — thread via ConfigPanelProps instead |
| useDashboardContextOptional | `kinetica_bi/src/components/DashboardContext.tsx:93` | Fallback option (returns null when no provider — but WidgetConfigModal truly has no provider) |
| ChartTypeDefinition / ConfigPanelProps | `kinetica_bi/src/components/charts/registry.ts:37` | LegendConfigPanel implements `ConfigPanelProps` |
| coalesceCbConfig | `kinetica_bi/src/lib/cbConfig.ts` | Used internally by LayersLegendPanel — LegendRenderer does NOT call directly |

## Architecture Patterns

### Recommended Project Structure (new files)

```
kinetica_bi/src/
├── components/charts/
│   ├── definitions/
│   │   └── legend.ts                    # NEW: chart type registry entry
│   ├── LegendRenderer.tsx               # NEW: renderer component
│   ├── LegendRenderer.spec.tsx          # NEW: renderer + config panel specs
│   └── LegendConfigPanel.tsx            # NEW: CustomConfigPanel for source picker
├── lib/
│   ├── resolveLegendLayers.ts           # NEW: shared derivation helper
│   └── resolveLegendLayers.spec.ts      # NEW: helper unit tests (~6 tests)
```

Modified files:
- `definitions/index.ts` — `registerLegend()` call added
- `WidgetRenderer.tsx` — `else if (widget.type === "legend")` branch at lines 229–232
- `MapChartRenderer.tsx` — lines 547–556 useMemo body replaced with `resolveLegendLayers(...)` call
- `LayersLegendPanel.tsx` — `showChevron?: boolean` prop added
- `LayersLegendPanel.spec.tsx` — showChevron tests added
- `registry.ts` — `widgets?: WidgetDto[]` added to `ConfigPanelProps`
- `ChartConfigPanel.tsx` — thread `widgets` prop down to Custom panel slot
- `api/client.ts` — NO CHANGE NEEDED (WidgetDto.type is `string`, not a closed union)
- `styles/global.css` — `.legend-widget*` selectors appended

### Pattern 1: Registry Entry (mirrors info-card verbatim)

```typescript
// kinetica_bi/src/components/charts/definitions/legend.ts
import { registerChartType, type ChartTypeDefinition } from "../registry";
import LegendConfigPanel from "../LegendConfigPanel";

const legend: ChartTypeDefinition = {
  type: "legend",
  label: "Legend",
  icon: "LG",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  supportsDrillDown: false,
  CustomConfigPanel: LegendConfigPanel,
};

export default function register() {
  registerChartType(legend);
}
```

Key difference from info-card: includes `CustomConfigPanel`. The info-card definition at `definitions/info-card.ts` has NO `CustomConfigPanel` field.

### Pattern 2: WidgetRenderer Early-Return Insertion Point

**Exact current content at lines 225–234 (WidgetRenderer.tsx):**

```typescript
if (widget.type === "map") {
  body = <MapChartRenderer widget={widget} tables={tables} />;
} else if (widget.type === "records") {
  body = <RecordsTableRenderer widget={widget} />;
} else if (widget.type === "info-card") {
  // Phase 23 (CARD-V14-01): info-card short-circuits BEFORE AggregatedWidgetRenderer so it
  // does not try to read widget.config.sql (info-card defaultConfig is {} — no SQL).
  body = <InfoCardRenderer widget={widget} tables={tables} />;
} else {
  body = <AggregatedWidgetRenderer widget={widget} />;
}
```

**Phase 42 inserts between `info-card` and `else`:**

```typescript
} else if (widget.type === "legend") {
  // Phase 42 (WIDGET-V17-01): legend short-circuits BEFORE AggregatedWidgetRenderer
  // so it does not try to read widget.config.sql (legend defaultConfig is {} — no SQL).
  body = <LegendRenderer widget={widget} />;
}
```

Note: `tables` prop is NOT passed to `LegendRenderer` — it reads from `useDashboardLayersStore`, not SQL tables.

### Pattern 3: Phase 41 Refactor — resolveLegendLayers.ts Extraction

**Current inline useMemo in MapChartRenderer.tsx (lines 547–556):**

```typescript
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

**After extraction, useMemo body becomes:**

```typescript
const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
  return resolveLegendLayers(
    useDashboardLayersStore.getState().layers,
    includedLayerIdsForLegend,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [legendKey, includedLayerIdsForLegend]);
```

Zero behavior change. The `// eslint-disable-next-line` comment is preserved because `legendKey` (not `layers`) is the reactive dep.

### Pattern 4: ConfigPanelProps Extension (critical — widgets threading)

**Current `ConfigPanelProps` in `registry.ts` (lines 37–64):**

```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];
  tables?: { id: number; name: string; schema: string; columns: Record<string, string>; }[];
  isValid?: (valid: boolean) => void;
};
```

**Phase 42 adds `widgets?`:**

```typescript
  /**
   * Phase 42 (WIDGET-V17-03): dashboard widget list, threaded from DashboardsPage via
   * ChartConfigPanel. LegendConfigPanel uses this to populate the source-map-widget dropdown.
   * Optional — non-legend panels ignore. WidgetConfigModal is rendered outside
   * DashboardContextProvider, so context cannot be used; prop threading is required.
   */
  widgets?: WidgetDto[];
```

Then `ChartConfigPanel` must forward `widgets` to the `Custom` panel slot at line 386–433.

### Pattern 5: LegendConfigPanel Auto-Pick

Auto-pick via `useEffect` in `LegendConfigPanel` (CONTEXT.md Discretion — preferred over ChartConfigPanel Apply handler):

```typescript
// Auto-pick: when sourceMapWidgetId is undefined AND map widgets exist, pre-select first
useEffect(() => {
  if (sourceMapWidgetId === undefined && mapWidgets.length > 0) {
    onChange({ ...config, sourceMapWidgetId: mapWidgets[0].id });
  }
  // Only fires when mapWidgets list changes (e.g., first render, or a map widget added)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [mapWidgets.map(w => w.id).join(",")]);
```

The dep array uses a primitive string (joining map widget IDs) to avoid referential-equality issues — mirrors PITFALL S-02 discipline.

### Pattern 6: Reconfigure Button — Open Widget Config Modal

`DashboardsPage.tsx` opens the config modal via `setConfiguringWidget(w)` at line 940. The `Reconfigure` button in `LegendRenderer` cannot call `setConfiguringWidget` directly because that's DashboardsPage-local state.

**The threading path:**
1. `DashboardsPage` passes `onConfigureWidget?: (widget: WidgetDto) => void` to `WidgetRenderer` (new prop).
2. `WidgetRenderer` passes it to `LegendRenderer` (new prop on `LegendRenderer`).
3. `LegendRenderer` calls `onConfigureWidget(widget)` on the Reconfigure button click.

**Alternative (simpler — recommended):** Thread a callback through `DashboardContext`. However, `DashboardContext` is only available inside the widget grid, not in modals. Since `LegendRenderer` IS inside the grid (it's a widget body, not a modal), and `DashboardContextProvider` wraps the grid (lines 891–963), `useDashboardContext()` IS available in `LegendRenderer`.

**Confirmed:** `WidgetRenderer` is mounted at line 955, inside `DashboardContextProvider` (lines 891–963). `LegendRenderer` is called from `WidgetRenderer`, so `LegendRenderer` can use `useDashboardContext()`.

BUT `DashboardContext` does not currently expose a `setConfiguringWidget`-like callback. Options:
1. Extend `DashboardContextValue` with a new `openWidgetConfig?: (widgetId: number) => void` callback (more invasive)
2. Pass `onConfigureWidget` as a prop through `WidgetRenderer → LegendRenderer` (more explicit, less invasive)

**Recommended (minimal change):** Add `onConfigureWidget?: (widget: WidgetDto) => void` prop to `WidgetRenderer` and thread to `LegendRenderer`. `DashboardsPage` passes `(w) => setConfiguringWidget(w)` at the render site (line 955). This mirrors how other one-off callbacks flow from DashboardsPage to individual widget components.

### Anti-Patterns to Avoid

- **Do NOT subscribe to `useDashboardLayersStore.layers` array** — primitive `legendKey` only (PITFALL S-02)
- **Do NOT read `bound.config.includedLayerIds` from the LEGEND widget** — read from the BOUND MAP WIDGET's config
- **Do NOT call `useDashboardContext()` from `LegendConfigPanel`** — it runs inside WidgetConfigModal which is OUTSIDE DashboardContextProvider (see Critical Finding below)
- **Do NOT drop legend into AggregatedWidgetRenderer** — must short-circuit in WidgetRenderer early-return ladder
- **Do NOT add SQL fields to legend's `defaultConfig`**
- **Do NOT break Phase 41 MapChartRenderer tests** during resolveLegendLayers extraction — pure refactor, same behavior
- **Do NOT add collapse state to LegendRenderer** — always-expanded

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Layer list rendering + CB swatches | Custom layer display component | `<LayersLegendPanel>` (Phase 41) | Phase 41 ships exactly this; divergence would break parity guarantee |
| includedLayerIds filter logic | Inline useMemo | `lib/resolveLegendLayers.ts` | 2nd consumer trigger (Phase 40 precedent); shared helper prevents divergence |
| Layer store subscription | Direct `s.layers` selector | `legendKey` primitive selector | Array reference equality breaks React re-render short-circuit (PITFALL S-02) |
| AARRGGBB → CSS color conversion | Inline parsing | `aarrggbbToCssColor` inside LayersLegendPanel (internal) | Already correct in Phase 41; not exposed for external use |

## Common Pitfalls

### Pitfall 1: LegendConfigPanel Calling useDashboardContext()

**What goes wrong:** `LegendConfigPanel` calls `useDashboardContext()` to get the `widgets` array. This throws "useDashboardContext must be used inside DashboardContext.Provider" at runtime because `WidgetConfigModal` is rendered at DashboardsPage line 982, **after** the `DashboardContextProvider` closing tag at line 963.

**Why it happens:** The `DashboardContextProvider` only wraps the widget grid (lines 891–963). Modals (WidgetConfigModal, LayersModal, DynamicViewsModal, TablePickerModal) are all mounted outside the provider. The Phase 35 decision notes: "dashboardId + associatedTables are passed as PROPS (NOT via DashboardContext) ... mirrors LayersModal mount pattern."

**How to avoid:** Add `widgets?: WidgetDto[]` to `ConfigPanelProps` in `registry.ts` (additive optional — mirrors the Phase 28 `tables` extension). Thread from `ChartConfigPanel.tsx` → Custom panel slot. `WidgetConfigModal` already has `widget` in scope (which includes `dashboard_id`); the planner also adds `widgets` to the `WidgetConfigModal` props and threads it from `DashboardOpen`'s `widgets` state variable.

**Warning signs:** `Error: useDashboardContext must be used inside DashboardContext.Provider` in test output; LegendConfigPanel dropdown renders empty despite map widgets existing.

### Pitfall 2: Subscribing to Layers Array in LegendRenderer

**What goes wrong:** `const layers = useDashboardLayersStore(s => s.layers)` inside `LegendRenderer` causes re-renders on every unrelated store mutation (layer added, removed, reordered) even when the legend display is unchanged.

**Why it happens:** Array equality fails on every `set()` call regardless of content change. Phase 41 explicitly established `legendKey` to solve this.

**How to avoid:** Use `legendKey` primitive selector formula exactly as in MapChartRenderer.tsx lines 533–540. Read `useDashboardLayersStore.getState().layers` imperatively inside the `useMemo` body (not as a subscription).

### Pitfall 3: Reading includedLayerIds from the Wrong Widget

**What goes wrong:** `LegendRenderer` reads `widget.config.includedLayerIds` where `widget` is the legend widget itself. The legend widget has no `includedLayerIds` in its config — `defaultConfig` is `{}`.

**How to avoid:** Read `bound.config.includedLayerIds` where `bound = widgets.find(w => w.id === sourceMapWidgetId)`. The **bound map widget's** config carries the layer filter, not the legend widget's.

### Pitfall 4: Back-compat re-export for ResolvedLegendLayer

**What goes wrong:** Phase 42 moves `ResolvedLegendLayer` type from `LayersLegendPanel.tsx` to `lib/resolveLegendLayers.ts`. Existing imports `import type { ResolvedLegendLayer } from "../LayersLegendPanel"` break in tests.

**Why it happens:** Phase 41 specs (`LayersLegendPanel.spec.tsx` line 6) import from `./LayersLegendPanel`. Phase 41 `MapChartRenderer.tsx` imports from `../LayersLegendPanel`.

**How to avoid:** Keep a re-export in `LayersLegendPanel.tsx`: `export type { ResolvedLegendLayer } from "../lib/resolveLegendLayers"`. Both the import-and-re-export pattern (wmsUrlBuilder.ts Phase 40 precedent) applies here.

**Verified needed:** MapChartRenderer.tsx imports `ResolvedLegendLayer` from `../LayersLegendPanel` (Phase 41 Plan 02-02 added this import). LayersLegendPanel.spec.tsx line 6 also imports from `./LayersLegendPanel`. Both will break without the re-export.

### Pitfall 5: useMemo eslint-disable Comment Preservation

**What goes wrong:** When the Phase 41 MapChartRenderer useMemo body is replaced to call `resolveLegendLayers(...)`, the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment on line 555 must be preserved. Without it, `useDashboardLayersStore.getState().layers` inside the useMemo triggers a linting error (imperative read inside memo without dep).

**How to avoid:** The refactor is a one-line body replacement. Preserve the comment and deps array `[legendKey, includedLayerIdsForLegend]` unchanged.

## Code Examples

### Example 1: resolveLegendLayers.ts (exact shape from CONTEXT.md)

```typescript
// kinetica_bi/src/lib/resolveLegendLayers.ts
import type { DashboardLayerDto } from "../api/client";

export type ResolvedLegendLayer = {
  layer: DashboardLayerDto;
  visible: boolean;
};

/**
 * Filter store layers by widget config's includedLayerIds and project to ResolvedLegendLayer[].
 * Honors Phase 12 empty-array-means-all-on semantic.
 */
export function resolveLegendLayers(
  storeLayers: DashboardLayerDto[],
  includedLayerIds: number[] | undefined,
): ResolvedLegendLayer[] {
  const filtered = includedLayerIds && includedLayerIds.length > 0
    ? storeLayers.filter(l => includedLayerIds.includes(l.id))
    : storeLayers;
  return filtered.map(layer => ({ layer, visible: true }));
}
```

Back-compat re-export in `LayersLegendPanel.tsx` (append after existing exports):
```typescript
export type { ResolvedLegendLayer } from "../lib/resolveLegendLayers";
```

### Example 2: LegendRenderer skeleton

```typescript
// kinetica_bi/src/components/charts/LegendRenderer.tsx
import { useMemo } from "react";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { LayersLegendPanel } from "../LayersLegendPanel";
import { resolveLegendLayers } from "../../lib/resolveLegendLayers";
import { useDashboardContext } from "../DashboardContext";
import type { WidgetDto } from "../../api/client";

type Props = {
  widget: WidgetDto;
  onConfigureWidget?: (widget: WidgetDto) => void;
};

export default function LegendRenderer({ widget, onConfigureWidget }: Props) {
  const { widgets } = useDashboardContext();
  const sourceMapWidgetId = widget.config.sourceMapWidgetId as number | undefined;

  const legendKey = useDashboardLayersStore((s) =>
    s.layers
      .map((l) => `${l.id}:${(l.config as {renderMode?: string})?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`)
      .join("|")
  );

  const bound = widgets.find(w => w.id === sourceMapWidgetId && w.type === "map")
    ?? (sourceMapWidgetId !== undefined ? widgets.find(w => w.id === sourceMapWidgetId) : undefined);

  // Orphan check
  const isOrphan = sourceMapWidgetId === undefined
    || !widgets.find(w => w.id === sourceMapWidgetId)
    || (widgets.find(w => w.id === sourceMapWidgetId)?.type !== "map");

  const includedLayerIds = bound?.config.includedLayerIds as number[] | undefined;

  const resolvedLayers = useMemo(() => {
    return resolveLegendLayers(useDashboardLayersStore.getState().layers, includedLayerIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendKey, includedLayerIds]);

  if (isOrphan) {
    return (
      <div className="legend-widget-orphan" role="status">
        <div className="legend-widget-orphan-message">
          Source map widget not found. Reconfigure the legend.
        </div>
        <button
          type="button"
          className="legend-widget-orphan-reconfigure"
          onClick={() => onConfigureWidget?.(widget)}
        >
          Reconfigure
        </button>
      </div>
    );
  }

  return (
    <div className="legend-widget-body">
      <LayersLegendPanel
        layers={resolvedLayers}
        corner="top-right"
        collapsed={false}
        onToggleCollapse={() => {}}
        showChevron={false}
      />
    </div>
  );
}
```

Note: `useDashboardContext()` IS usable in `LegendRenderer` because it is mounted inside `DashboardContextProvider` (widget grid). The context restriction only applies to `LegendConfigPanel` (inside `WidgetConfigModal`).

### Example 3: LayersLegendPanel showChevron prop extension

**Current props type at line 37–42:**

```typescript
export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
};
```

**Phase 42 extends to:**

```typescript
export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Phase 42: when false, header shows label only — no chevron, no onClick, no aria-expanded */
  showChevron?: boolean;  // default true
};
```

**Header JSX modification (current lines 99–117):**

```tsx
{/* Header — conditional click and chevron based on showChevron */}
<div
  className="layers-legend-panel-header"
  onClick={showChevron !== false ? onToggleCollapse : undefined}
  style={{ cursor: showChevron !== false ? "pointer" : "default" }}
>
  {showChevron !== false && (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-controls={bodyId}
      onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
    >
      {collapsed ? "▸" : "▾"}
    </button>
  )}
  <span>Layers</span>
</div>
```

**Body modification** (when `showChevron={false}`, body is ALWAYS rendered regardless of `collapsed`):

```tsx
{(showChevron !== false ? !collapsed : true) && (
  <div className="layers-legend-panel-body" id={bodyId}>
    {/* ... layer rows ... */}
  </div>
)}
```

### Example 4: definitions/index.ts insertion

```typescript
// Add after registerInfoCard import:
import registerLegend from "./legend";

// Add in registerAllChartTypes():
registerLegend();  // after registerInfoCard()
```

### Example 5: ConfigPanelProps extension + ChartConfigPanel threading

In `registry.ts`, add to `ConfigPanelProps`:
```typescript
widgets?: WidgetDto[];  // Phase 42: LegendConfigPanel uses for source-map-widget dropdown
```

In `ChartConfigPanel.tsx` Props type:
```typescript
widgets?: WidgetDto[];
```

In `ChartConfigPanel` Custom panel slot (around line 386):
```tsx
<Custom
  config={draft}
  columns={allColumns}
  tables={tables}
  widgets={widgets}    // Phase 42: thread for LegendConfigPanel
  isValid={(valid) => setCustomPanelValid(valid)}
  onChange={(c) => { /* existing onChange logic */ }}
/>
```

In `WidgetConfigModal` (DashboardsPage.tsx ~line 1055), accept and thread `widgets` prop:
```typescript
// Add widgets to WidgetConfigModal props
widgets: WidgetDto[];
// Pass to ChartConfigPanel
<ChartConfigPanel ... widgets={widgets} />
```

In `DashboardsPage` at line 982 (WidgetConfigModal render site):
```tsx
<WidgetConfigModal
  widget={configuringWidget}
  widgets={widgets}   // Phase 42: thread for LegendConfigPanel
  tables={associatedTables}
  // ... rest unchanged
/>
```

### Example 6: New widget default grid size

All new widgets created via `handleAddVisualization` in DashboardsPage.tsx use the same default: `{ x: 0, y: nextY, w: 6, h: 4 }` (line 534). The legend widget will default to 6×4 grid units unless the planner adds a per-type override. CONTEXT.md recommends 4×6 for a readable legend panel; to achieve this, `handleAddVisualization` would need a per-type size lookup, OR the planner accepts the universal 6×4 default. The cleanest approach (no new code path): accept 6×4 as-is. A 4×6 default would require modifying `handleAddVisualization` to read an optional `defaultLayout` from `ChartTypeDefinition`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline derivation in MapChartRenderer | Shared `lib/resolveLegendLayers.ts` helper | Phase 42 (2nd consumer trigger) | Phase 40 precedent: extract when 2nd consumer appears |
| LayersLegendPanel with mandatory chevron | Optional `showChevron` prop (default `true`) | Phase 42 | Phase 41 behavior unchanged; Phase 42 standalone widget gets non-collapsible panel |
| ResolvedLegendLayer in LayersLegendPanel.tsx | ResolvedLegendLayer in lib/resolveLegendLayers.ts | Phase 42 | Back-compat re-export keeps Phase 41 imports working |

## Open Questions

1. **Default legend widget grid size (6×4 vs 4×6)**
   - What we know: `handleAddVisualization` universally uses `w:6, h:4` (line 534)
   - What's unclear: planner must decide whether to accept universal default or add per-type override to `ChartTypeDefinition`
   - Recommendation: Accept 6×4 universal default for v1.7. Operator resizes via grid handles. Adding per-type default sizing to `ChartTypeDefinition` is a larger scope change.

2. **WidgetConfigModal widgets prop threading**
   - What we know: `WidgetConfigModal` is outside `DashboardContextProvider`. It already receives `tables` and `dynamicViews`. Adding `widgets` is additive-optional following the exact Phase 28 precedent.
   - What's unclear: Whether the planner also updates `WidgetConfigModal`'s TypeScript type, or whether the `DashboardOpen` component passes `widgets` already
   - Recommendation: `DashboardOpen` (lines 891+) already has `widgets` in scope; `WidgetConfigModal` just needs the prop added. The executor should check that all existing `WidgetConfigModal` call sites (there is exactly one, line 982) receive the new prop.

3. **LegendConfigPanel spec file organization**
   - What we know: CONTEXT.md says planner picks (one file vs two)
   - Recommendation: Two separate spec files (`LegendRenderer.spec.tsx` + `LegendConfigPanel.spec.tsx`) for clarity, matching the InfoCardRenderer + InfoSelectionView spec split pattern. However, if `LegendConfigPanel` is short (~80 lines), inlining in `LegendRenderer.spec.tsx` is acceptable.

## Sources

### Primary (HIGH confidence)

- Source inspection of `kinetica_bi/src/components/charts/definitions/info-card.ts` — exact registry entry shape confirmed
- Source inspection of `kinetica_bi/src/components/charts/definitions/index.ts` — exact register pattern confirmed
- Source inspection of `kinetica_bi/src/components/charts/WidgetRenderer.tsx:225–234` — exact early-return ladder confirmed
- Source inspection of `kinetica_bi/src/components/charts/InfoCardRenderer.tsx` — sibling renderer props shape (`{ widget, tables }`) confirmed
- Source inspection of `kinetica_bi/src/components/charts/registry.ts:37–64` — `ConfigPanelProps` full shape confirmed; `widgets` not present
- Source inspection of `kinetica_bi/src/components/charts/MapChartRenderer.tsx:533–559` — `legendKey` selector (lines 533–540), `includedLayerIdsForLegend` (line 546), `resolvedLegendLayers` useMemo (lines 547–556), `legendCollapsed` state (line 559) — exact phase 42 refactor target confirmed
- Source inspection of `kinetica_bi/src/components/LayersLegendPanel.tsx` — `ResolvedLegendLayer` type at line 32, `LayersLegendPanelProps` at lines 37–42, chevron button at lines 103–116, header onClick at line 101, body render condition at line 120
- Source inspection of `kinetica_bi/src/components/LayersLegendPanel.spec.tsx` — 16 existing tests confirmed; import path `from "./LayersLegendPanel"` confirms back-compat re-export needed
- Source inspection of `kinetica_bi/src/components/DashboardContext.tsx` — `DashboardContextValue.widgets: WidgetDto[]` confirmed present; `useDashboardContext()` throws on missing provider; `useDashboardContextOptional()` available as fallback
- Source inspection of `kinetica_bi/src/components/DashboardsPage.tsx:891–963` — `DashboardContextProvider` wraps widget grid only; `WidgetConfigModal` (line 982) is OUTSIDE provider — CRITICAL FINDING
- Source inspection of `kinetica_bi/src/components/DashboardsPage.tsx:521–541` — `handleAddVisualization` uses universal `w:6, h:4` default layout for all new widget types
- Source inspection of `kinetica_bi/src/components/DashboardsPage.tsx:936–944` — `setConfiguringWidget(w)` at button onClick — existing modal-open mechanism confirmed
- Source inspection of `kinetica_bi/src/api/client.ts:303–312` — `WidgetDto.type: string` is an OPEN string type, not a closed union — NO union extension needed
- Source inspection of `kinetica_bi/src/store/dashboardLayersStore.ts:36–46` — `updateLayer` reference-stable behavior confirmed
- Phase 41 SUMMARY files (41-01, 41-02) — Phase 41 shipped deliverables verified, exact test counts confirmed (54 new tests total)
- Phase 40 SUMMARY file (40-01) — helper-extraction pattern and back-compat re-export pitfall documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in project; no new npm packages required
- Architecture patterns: HIGH — all critical files inspected at exact line numbers
- Pitfalls: HIGH — DashboardContext scope mismatch verified by reading actual DashboardsPage.tsx DOM structure; back-compat re-export need verified by reading actual import paths in LayersLegendPanel.spec.tsx and MapChartRenderer.tsx
- WidgetDto.type: HIGH — confirmed open string type at client.ts:307

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (stable codebase; no fast-moving dependencies)
