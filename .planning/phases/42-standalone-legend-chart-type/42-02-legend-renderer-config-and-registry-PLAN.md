---
phase: 42-standalone-legend-chart-type
plan: "02"
type: execute
wave: 2
depends_on: ["42-01"]
files_modified:
  - kinetica_bi/src/components/charts/LegendRenderer.tsx
  - kinetica_bi/src/components/charts/LegendRenderer.spec.tsx
  - kinetica_bi/src/components/charts/LegendConfigPanel.tsx
  - kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx
  - kinetica_bi/src/components/charts/definitions/legend.ts
  - kinetica_bi/src/components/charts/definitions/index.ts
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - WIDGET-V17-01
  - WIDGET-V17-02
  - WIDGET-V17-03
  - WIDGET-V17-04
  - WIDGET-V17-05
must_haves:
  truths:
    - "Operator can add a 'Legend' chart type from the chart picker — the registry includes a definition with type='legend', label='Legend', icon='LG'."
    - "Adding a legend widget creates a dashboard widget with widget.type === 'legend' and renders via <LegendRenderer />, NOT via AggregatedWidgetRenderer."
    - "LegendConfigPanel shows a dropdown of map widgets on the same dashboard, populated from props.widgets (NOT useDashboardContext, which would throw)."
    - "Auto-pick: when sourceMapWidgetId is undefined and at least one map widget exists on the dashboard, LegendConfigPanel calls onChange to set sourceMapWidgetId = mapWidgets[0].id via a useEffect."
    - "When no map widgets exist on the dashboard, the dropdown is disabled with placeholder '— no map widgets on this dashboard —' and an inline hint 'Add a map widget first, then bind the legend.'"
    - "LegendRenderer subscribes via legendKey primitive selector (PITFALL S-02) — NEVER subscribes to s.layers array directly."
    - "Orphan state renders the verbatim copy 'Source map widget not found. Reconfigure the legend.' + a Reconfigure button when (a) sourceMapWidgetId is undefined, OR (b) widgets.find(w => w.id === sourceMapWidgetId) is undefined (deleted), OR (c) the found widget's type !== 'map'."
    - "Clicking the Reconfigure button calls onConfigureWidget(widget), which (in DashboardsPage) opens the widget config modal for the legend widget."
    - "Happy-path rendering: LegendRenderer mounts <LayersLegendPanel showChevron={false} collapsed={false} corner='top-right' onToggleCollapse={() => {}} layers={resolvedLegendLayers} /> where resolvedLegendLayers = resolveLegendLayers(useDashboardLayersStore.getState().layers, bound.config.includedLayerIds)."
    - "Live updates: editing a classbreak layer's cb_config via useDashboardLayersStore.updateLayer triggers a legendKey change, causing the standalone Legend widget to re-render with updated swatches/labels without page reload."
  artifacts:
    - path: "kinetica_bi/src/components/charts/LegendRenderer.tsx"
      provides: "Renderer for widget.type==='legend'; reads bound map widget, resolves layers via shared helper, mounts LayersLegendPanel"
      min_lines: 60
    - path: "kinetica_bi/src/components/charts/LegendRenderer.spec.tsx"
      provides: "Tests for 3 orphan triggers + happy-path render + live-update + Reconfigure button"
    - path: "kinetica_bi/src/components/charts/LegendConfigPanel.tsx"
      provides: "CustomConfigPanel with source-map-widget dropdown + auto-pick useEffect + empty-state UI"
      min_lines: 40
    - path: "kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx"
      provides: "Tests for empty mapWidgets / populated dropdown / auto-pick useEffect / onChange writes sourceMapWidgetId"
    - path: "kinetica_bi/src/components/charts/definitions/legend.ts"
      provides: "Chart type registry entry with CustomConfigPanel: LegendConfigPanel"
    - path: "kinetica_bi/src/components/charts/definitions/index.ts"
      provides: "registerLegend() called in registerAllChartTypes()"
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "Early-return branch `else if (widget.type === 'legend') { body = <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} /> }` inserted between info-card and AggregatedWidgetRenderer fallback"
    - path: "kinetica_bi/src/styles/global.css"
      provides: ".legend-widget-body, .legend-widget-orphan, .legend-widget-orphan-message, .legend-widget-orphan-reconfigure CSS classes"
  key_links:
    - from: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      to: "kinetica_bi/src/components/charts/LegendRenderer.tsx"
      via: "early-return branch for widget.type==='legend' before AggregatedWidgetRenderer fallback"
      pattern: "widget\\.type === \"legend\""
    - from: "kinetica_bi/src/components/charts/LegendRenderer.tsx"
      to: "kinetica_bi/src/lib/resolveLegendLayers.ts"
      via: "import + call inside useMemo body"
      pattern: "resolveLegendLayers\\("
    - from: "kinetica_bi/src/components/charts/LegendRenderer.tsx"
      to: "kinetica_bi/src/components/LayersLegendPanel.tsx"
      via: "mount with showChevron={false}"
      pattern: "showChevron=\\{false\\}"
    - from: "kinetica_bi/src/components/charts/LegendConfigPanel.tsx"
      to: "ConfigPanelProps.widgets"
      via: "read widgets from props (NOT useDashboardContext)"
      pattern: "props\\.widgets\\|\\{ widgets \\}"
    - from: "kinetica_bi/src/components/charts/definitions/index.ts"
      to: "kinetica_bi/src/components/charts/definitions/legend.ts"
      via: "import registerLegend + call in registerAllChartTypes()"
      pattern: "registerLegend\\(\\)"
---

<objective>
Ship the standalone Legend chart type by consuming the foundation Plan 42-01 delivered: register `legend` in the chart-type registry, add the WidgetRenderer early-return branch, build `LegendRenderer.tsx` (orphan-state-aware, legendKey-subscribed, mounts `<LayersLegendPanel showChevron={false}>`), build `LegendConfigPanel.tsx` (source-map-widget dropdown driven by `props.widgets`, with auto-pick + empty-state), and append CSS. All 5 WIDGET-V17-* requirements close in this plan.

Purpose: Operators add a 'Legend' widget to a dashboard, bind it to a chosen map widget on the same dashboard, and the Legend widget mirrors that map's `<LayersLegendPanel>` content as a standalone tile that stays live-synchronized with classbreak edits via the shared `useDashboardLayersStore`.

Output: 6 new files (LegendRenderer.tsx + .spec.tsx, LegendConfigPanel.tsx + .spec.tsx, definitions/legend.ts, plus CSS additions); 2 modified files (WidgetRenderer.tsx, definitions/index.ts). All 5 ROADMAP success criteria for Phase 42 satisfied. Plan 42-02 closes the phase.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/42-standalone-legend-chart-type/42-CONTEXT.md
@.planning/phases/42-standalone-legend-chart-type/42-RESEARCH.md
@.planning/phases/42-standalone-legend-chart-type/42-01-foundation-helper-and-threading-PLAN.md

@kinetica_bi/src/components/LayersLegendPanel.tsx
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/components/charts/definitions/index.ts
@kinetica_bi/src/components/charts/definitions/info-card.ts
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/InfoCardRenderer.tsx
@kinetica_bi/src/components/charts/MapConfigPanel.tsx
@kinetica_bi/src/components/DashboardContext.tsx
@kinetica_bi/src/store/dashboardLayersStore.ts
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/lib/resolveLegendLayers.ts
@kinetica_bi/src/styles/global.css

<interfaces>
<!-- Plan 42-01 deliverables that this plan consumes -->

From `kinetica_bi/src/lib/resolveLegendLayers.ts` (created by Plan 42-01):
```typescript
export type ResolvedLegendLayer = { layer: DashboardLayerDto; visible: boolean };
export function resolveLegendLayers(
  storeLayers: DashboardLayerDto[],
  includedLayerIds: number[] | undefined,
): ResolvedLegendLayer[];
```

From `kinetica_bi/src/components/LayersLegendPanel.tsx` (extended by Plan 42-01):
```typescript
export type LayersLegendPanelProps = {
  layers: ResolvedLegendLayer[];
  corner: LegendPanelCorner;
  collapsed: boolean;
  onToggleCollapse: () => void;
  showChevron?: boolean;       // Plan 42-01: default true; when false, no chevron, body always renders
};
```

From `kinetica_bi/src/components/charts/registry.ts` (extended by Plan 42-01):
```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];
  tables?: { id: number; name: string; schema: string; columns: Record<string, string>; }[];
  isValid?: (valid: boolean) => void;
  widgets?: WidgetDto[];       // Plan 42-01: dashboard widget list for LegendConfigPanel
};
```

From `kinetica_bi/src/components/charts/WidgetRenderer.tsx` (extended by Plan 42-01):
```typescript
type Props = {
  widget: WidgetDto;
  onConfigureWidget?: (widget: WidgetDto) => void;   // Plan 42-01: threaded from DashboardsPage
};
type WidgetRendererProps = Props & { tables?: TableDto[] };
```

<!-- Pre-existing interfaces this plan also uses -->

From `kinetica_bi/src/api/client.ts:303-312`:
```typescript
export type WidgetDto = {
  id: number;
  dashboard_id: number;
  title: string;
  type: string;
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
```

From `kinetica_bi/src/components/DashboardContext.tsx`:
```typescript
export type DashboardContextValue = {
  dashboardId: number;
  widgets: WidgetDto[];
  dynamicViews: DynamicViewRow[];
  retryDynamicView: (dynamicViewId: number) => void;
};
export const useDashboardContext: () => DashboardContextValue;  // THROWS if no provider
```

From `kinetica_bi/src/store/dashboardLayersStore.ts`:
```typescript
// Reference-stable updateLayer; primitive-selector-safe
export const useDashboardLayersStore: ZustandHook & { getState: () => { layers: DashboardLayerDto[] } };
```

From `kinetica_bi/src/components/charts/MapChartRenderer.tsx:533-540` (legendKey formula to mirror VERBATIM):
```typescript
const legendKey = useDashboardLayersStore((s) =>
  s.layers
    .map(
      (l) =>
        `${l.id}:${(l.config as { renderMode?: string })?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`,
    )
    .join("|"),
);
```

From `kinetica_bi/src/components/charts/definitions/info-card.ts` (registry entry pattern to mirror):
```typescript
const infoCard: ChartTypeDefinition = {
  type: "info-card",
  label: "Info Card",
  icon: "IC",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  supportsDrillDown: false,
};
export default function register() { registerChartType(infoCard); }
```

From `kinetica_bi/src/components/charts/definitions/index.ts` (registerAllChartTypes pattern to extend):
```typescript
import registerInfoCard from "./info-card";
// ... other imports ...
export function registerAllChartTypes() {
  // ... other register calls ...
  registerInfoCard();
}
```

From `kinetica_bi/src/components/charts/WidgetRenderer.tsx:225-235` (early-return ladder — exact insertion point):
```typescript
if (widget.type === "map") {
  body = <MapChartRenderer widget={widget} tables={tables} />;
} else if (widget.type === "records") {
  body = <RecordsTableRenderer widget={widget} />;
} else if (widget.type === "info-card") {
  body = <InfoCardRenderer widget={widget} tables={tables} />;
} else {
  body = <AggregatedWidgetRenderer widget={widget} />;
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build LegendConfigPanel.tsx (source-map-widget dropdown + auto-pick + empty state) + spec</name>
  <files>
    - kinetica_bi/src/components/charts/LegendConfigPanel.tsx (NEW)
    - kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx (NEW)
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/registry.ts (full file — confirm ConfigPanelProps has widgets?: WidgetDto[] after Plan 42-01)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (lines 1-100, then scan for `<select>` + `config-group` + `aria-labelledby` patterns to mirror — CONTEXT.md decision: LegendConfigPanel mirrors MapConfigPanel styling)
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (line 1-50 — vitest harness shape to mirror)
    - kinetica_bi/src/api/client.ts lines 303-312 (WidgetDto)
    - .planning/phases/42-standalone-legend-chart-type/42-CONTEXT.md § "sourceMapWidgetId dropdown UX" (lines 73-110 — verbatim component skeleton + all UX strings)
  </read_first>
  <behavior>
    - Test 1 (empty mapWidgets — disabled select + placeholder + hint): render LegendConfigPanel with `widgets=[{ id:1, type:"bar", ... }]` (no map widgets) — the `<select>` element has the `disabled` attribute, contains an `<option>` with text `— no map widgets on this dashboard —`, and a sibling element with text `Add a map widget first, then bind the legend.`
    - Test 2 (populated dropdown + select placeholder): render with `widgets=[{id:1,type:"map",title:"Map A"}, {id:2,type:"map",title:"Map B"}, {id:3,type:"bar"}]` and `config={}` (sourceMapWidgetId undefined) — `<select>` is enabled, contains an `<option>` with text `— select —` first, then 2 options: `Map A` and `Map B` (bar widget filtered out)
    - Test 3 (sourceMapWidgetId pre-selected): render with the populated widgets list AND `config={ sourceMapWidgetId: 2 }` — `<select>` value is `"2"` (Map B is selected), the placeholder `— select —` is NOT in the DOM
    - Test 4 (onChange writes sourceMapWidgetId on selection): render populated, simulate `fireEvent.change(<select>, { target: { value: "2" } })` — `onChange` is called once with `{ ...originalConfig, sourceMapWidgetId: 2 }` (number, NOT string "2")
    - Test 5 (auto-pick on mount when undefined + map widgets exist): render with populated widgets AND `config={}` (sourceMapWidgetId undefined) — after initial render, `onChange` is called once with `{ ...config, sourceMapWidgetId: 1 }` (the first map widget's id)
    - Test 6 (no auto-pick when sourceMapWidgetId already set): render with populated widgets AND `config={ sourceMapWidgetId: 2 }` — `onChange` is NOT called after mount (auto-pick suppressed)
    - Test 7 (no auto-pick when no map widgets exist): render with `widgets=[]` AND `config={}` — `onChange` is NOT called (no map widgets means no auto-pick target)
    - Test 8 (no widgets prop — empty array fallback): render with `widgets={undefined}` (or omitted) — does NOT throw; renders identically to empty mapWidgets (disabled select + hint). Use `?? []` fallback inside LegendConfigPanel.
    - Test 9 (does NOT call useDashboardContext): grep audit — LegendConfigPanel.tsx source MUST NOT contain `useDashboardContext` anywhere. Source-only assertion via fs.readFileSync inside spec.
    - Test 10 (filter: only widgets with type==='map'): a widget with `type: "info-card"` or `type: "bar"` or `type: "records"` must NOT appear in the dropdown options
  </behavior>
  <action>
    **Create `kinetica_bi/src/components/charts/LegendConfigPanel.tsx`** with this EXACT content:

    ```typescript
    /**
     * v1.7 Phase 42 Plan 02 (WIDGET-V17-03): CustomConfigPanel for the 'legend' chart type.
     *
     * Renders a single labeled <select> "Source map widget" populated from
     * props.widgets filtered to type === "map". Auto-picks the first map widget
     * on mount when sourceMapWidgetId is undefined and at least one map widget exists.
     *
     * CRITICAL: Reads `widgets` from props (Plan 42-01 ConfigPanelProps extension),
     * NOT from useDashboardContext() — WidgetConfigModal is rendered OUTSIDE
     * DashboardContextProvider, so useDashboardContext() would throw at runtime.
     */

    import { useEffect } from "react";
    import type { ConfigPanelProps } from "./registry";

    export default function LegendConfigPanel({
      config,
      onChange,
      widgets,
    }: ConfigPanelProps): JSX.Element {
      const allWidgets = widgets ?? [];
      const mapWidgets = allWidgets.filter((w) => w.type === "map");
      const sourceMapWidgetId = config.sourceMapWidgetId as number | undefined;
      const hasMapWidgets = mapWidgets.length > 0;

      // Auto-pick: when sourceMapWidgetId is undefined AND map widgets exist,
      // pre-select the first one via onChange. Dep array uses a primitive string
      // (joined map widget IDs) to avoid referential-equality re-fires.
      const mapWidgetIdsKey = mapWidgets.map((w) => w.id).join(",");
      useEffect(() => {
        if (sourceMapWidgetId === undefined && mapWidgets.length > 0) {
          onChange({ ...config, sourceMapWidgetId: mapWidgets[0].id });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [mapWidgetIdsKey]);

      return (
        <div
          className="config-group"
          role="group"
          aria-labelledby="legend-source-label"
        >
          <label id="legend-source-label" className="config-group-label">
            SOURCE MAP WIDGET
          </label>
          <select
            className="ds-select"
            aria-label="Source map widget"
            disabled={!hasMapWidgets}
            value={String(sourceMapWidgetId ?? "")}
            onChange={(e) =>
              onChange({ ...config, sourceMapWidgetId: Number(e.target.value) })
            }
          >
            {!hasMapWidgets && (
              <option value="">— no map widgets on this dashboard —</option>
            )}
            {hasMapWidgets && sourceMapWidgetId === undefined && (
              <option value="">— select —</option>
            )}
            {mapWidgets.map((w) => (
              <option key={w.id} value={String(w.id)}>
                {w.title || `Map widget #${w.id}`}
              </option>
            ))}
          </select>
          {!hasMapWidgets && (
            <div className="config-hint">
              Add a map widget first, then bind the legend.
            </div>
          )}
        </div>
      );
    }
    ```

    **Create `kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx`** with vitest tests covering all 10 behaviors above. Skeleton structure:

    ```typescript
    import { describe, it, expect, vi } from "vitest";
    import { render, screen, fireEvent } from "@testing-library/react";
    import LegendConfigPanel from "./LegendConfigPanel";
    import type { WidgetDto } from "../../api/client";
    import fs from "fs";
    import path from "path";

    function makeWidget(overrides: Partial<WidgetDto>): WidgetDto {
      return {
        id: 1,
        dashboard_id: 1,
        title: "",
        type: "bar",
        position: 0,
        config: {},
        created_at: "",
        updated_at: "",
        ...overrides,
      };
    }

    describe("LegendConfigPanel (Phase 42 / WIDGET-V17-03)", () => {
      it("Test 1: empty mapWidgets — disabled select + placeholder + hint", () => {
        const onChange = vi.fn();
        render(
          <LegendConfigPanel
            config={{}}
            onChange={onChange}
            widgets={[makeWidget({ id: 1, type: "bar" })]}
          />
        );
        const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
        expect(select).toBeTruthy();
        expect(select.disabled).toBe(true);
        expect(screen.getByText("— no map widgets on this dashboard —")).toBeTruthy();
        expect(screen.getByText("Add a map widget first, then bind the legend.")).toBeTruthy();
      });

      it("Test 2: populated dropdown + select placeholder + bar widget filtered out", () => {
        const widgets = [
          makeWidget({ id: 1, type: "map", title: "Map A" }),
          makeWidget({ id: 2, type: "map", title: "Map B" }),
          makeWidget({ id: 3, type: "bar", title: "Bar C" }),
        ];
        render(<LegendConfigPanel config={{}} onChange={vi.fn()} widgets={widgets} />);
        const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
        expect(select.disabled).toBe(false);
        expect(screen.getByText("— select —")).toBeTruthy();
        expect(screen.getByText("Map A")).toBeTruthy();
        expect(screen.getByText("Map B")).toBeTruthy();
        expect(screen.queryByText("Bar C")).toBeNull();
      });

      it("Test 3: sourceMapWidgetId pre-selected; placeholder absent", () => {
        const widgets = [
          makeWidget({ id: 1, type: "map", title: "Map A" }),
          makeWidget({ id: 2, type: "map", title: "Map B" }),
        ];
        render(<LegendConfigPanel config={{ sourceMapWidgetId: 2 }} onChange={vi.fn()} widgets={widgets} />);
        const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
        expect(select.value).toBe("2");
        expect(screen.queryByText("— select —")).toBeNull();
      });

      it("Test 4: onChange fires with numeric sourceMapWidgetId on selection", () => {
        const onChange = vi.fn();
        const widgets = [
          makeWidget({ id: 1, type: "map", title: "Map A" }),
          makeWidget({ id: 2, type: "map", title: "Map B" }),
        ];
        render(<LegendConfigPanel config={{ sourceMapWidgetId: 1 }} onChange={onChange} widgets={widgets} />);
        const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
        // Clear auto-pick calls (none expected here since sourceMapWidgetId is set, but be defensive)
        onChange.mockClear();
        fireEvent.change(select, { target: { value: "2" } });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ sourceMapWidgetId: 2 });
      });

      it("Test 5: auto-pick fires onChange with first map widget id on mount", () => {
        const onChange = vi.fn();
        const widgets = [
          makeWidget({ id: 7, type: "map", title: "Map A" }),
          makeWidget({ id: 9, type: "map", title: "Map B" }),
        ];
        render(<LegendConfigPanel config={{}} onChange={onChange} widgets={widgets} />);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({ sourceMapWidgetId: 7 });
      });

      it("Test 6: no auto-pick when sourceMapWidgetId already set", () => {
        const onChange = vi.fn();
        const widgets = [makeWidget({ id: 7, type: "map" })];
        render(<LegendConfigPanel config={{ sourceMapWidgetId: 7 }} onChange={onChange} widgets={widgets} />);
        expect(onChange).not.toHaveBeenCalled();
      });

      it("Test 7: no auto-pick when no map widgets exist", () => {
        const onChange = vi.fn();
        render(<LegendConfigPanel config={{}} onChange={onChange} widgets={[]} />);
        expect(onChange).not.toHaveBeenCalled();
      });

      it("Test 8: widgets prop undefined — defaults to empty array (no throw)", () => {
        expect(() =>
          render(<LegendConfigPanel config={{}} onChange={vi.fn()} />)
        ).not.toThrow();
        const select = screen.getByLabelText("Source map widget") as HTMLSelectElement;
        expect(select.disabled).toBe(true);
      });

      it("Test 9: source file does NOT import or call useDashboardContext", () => {
        const source = fs.readFileSync(
          path.resolve(__dirname, "LegendConfigPanel.tsx"),
          "utf-8"
        );
        expect(source).not.toMatch(/useDashboardContext/);
      });

      it("Test 10: non-map widget types filtered out (records, info-card, bar)", () => {
        const widgets = [
          makeWidget({ id: 1, type: "map", title: "MapOne" }),
          makeWidget({ id: 2, type: "records", title: "Records" }),
          makeWidget({ id: 3, type: "info-card", title: "InfoCard" }),
          makeWidget({ id: 4, type: "bar", title: "BarChart" }),
        ];
        render(<LegendConfigPanel config={{ sourceMapWidgetId: 1 }} onChange={vi.fn()} widgets={widgets} />);
        expect(screen.getByText("MapOne")).toBeTruthy();
        expect(screen.queryByText("Records")).toBeNull();
        expect(screen.queryByText("InfoCard")).toBeNull();
        expect(screen.queryByText("BarChart")).toBeNull();
      });
    });
    ```

    **AVOID:**
    - Don't call `useDashboardContext()` inside LegendConfigPanel — WidgetConfigModal is OUTSIDE DashboardContextProvider; the hook would throw. Read `widgets` from props (Plan 42-01 ConfigPanelProps.widgets) only. The grep audit in Test 9 enforces this.
    - Don't auto-pick when `sourceMapWidgetId` is already set — only fires when undefined AND map widgets exist
    - Don't use `mapWidgets` (object reference) in the useEffect deps array — that re-fires on every render. Use the primitive `mapWidgetIdsKey` string instead (the `mapWidgets.map(w => w.id).join(",")` joined string). The eslint-disable comment is required for the same reason as MapChartRenderer's legendKey pattern.
    - Don't render anything other than the dropdown + optional hint — no preview pane (deferred), no "test binding" button (deferred)
    - Don't filter on `usesAggregation` or `usesDataSource` — eligibility is solely `w.type === "map"` (operator may bind to any map regardless of CB layer presence — the LayersLegendPanel renders sensibly for raster-only / heatmap-only / CB layers all)
    - Don't pass the widget's `title` raw without a fallback — use `w.title || \`Map widget #${w.id}\`` for headerless map widgets
    - Don't write a string to sourceMapWidgetId — coerce via `Number(e.target.value)` so the stored value is `number` (matches WIDGET-V17-03 contract `config.sourceMapWidgetId: number`)
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/LegendConfigPanel.spec.tsx 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 0
    - `test -f kinetica_bi/src/components/charts/LegendConfigPanel.spec.tsx` returns 0
    - `grep -c "useDashboardContext" kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 0 (CRITICAL — Pitfall 1)
    - `grep -c "import.*ConfigPanelProps" kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 1
    - `grep -c "widgets ?? \\[\\]" kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 1 (defensive default)
    - `grep -c "w.type === \"map\"" kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 1
    - `grep -c "— no map widgets on this dashboard —" kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 1 (verbatim copy)
    - `grep -c "Add a map widget first, then bind the legend." kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns 1 (verbatim hint)
    - `grep -c "mapWidgetIdsKey" kinetica_bi/src/components/charts/LegendConfigPanel.tsx` returns at least 2 (declaration + useEffect deps)
    - vitest: all 10 LegendConfigPanel.spec.tsx tests pass
  </acceptance_criteria>
  <done>
    LegendConfigPanel.tsx exists, reads `widgets` from props (not context), filters to type==='map', renders disabled+placeholder UI when empty, populated dropdown otherwise, auto-picks first map widget on mount, onChange writes numeric sourceMapWidgetId; 10 spec tests pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build LegendRenderer.tsx (orphan-aware, legendKey-subscribed, mounts LayersLegendPanel with showChevron=false) + spec</name>
  <files>
    - kinetica_bi/src/components/charts/LegendRenderer.tsx (NEW)
    - kinetica_bi/src/components/charts/LegendRenderer.spec.tsx (NEW)
    - kinetica_bi/src/styles/global.css (MODIFY — append .legend-widget* selectors)
  </files>
  <read_first>
    - kinetica_bi/src/lib/resolveLegendLayers.ts (Plan 42-01 — full file)
    - kinetica_bi/src/components/LayersLegendPanel.tsx (Plan 42-01-extended — full file; confirm showChevron prop)
    - kinetica_bi/src/components/DashboardContext.tsx (full file — useDashboardContext signature)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 525-560 (legendKey selector formula — mirror VERBATIM)
    - kinetica_bi/src/store/dashboardLayersStore.ts (useDashboardLayersStore + updateLayer)
    - kinetica_bi/src/components/charts/InfoCardRenderer.tsx (sibling renderer pattern — file organization reference)
    - kinetica_bi/src/styles/global.css (last 50 lines — find Phase 41 .layers-legend-panel* pattern to mirror)
    - .planning/phases/42-standalone-legend-chart-type/42-CONTEXT.md § "Orphan state" + § "Layer set + visibility" + § "legendKey subscription" + § "CSS class names"
  </read_first>
  <behavior>
    - Test 1 (orphan trigger A — sourceMapWidgetId undefined): mount LegendRenderer with `widget.config = {}` (no sourceMapWidgetId) inside DashboardContextProvider with `widgets=[mapA]` — renders verbatim text "Source map widget not found. Reconfigure the legend." + a button labeled "Reconfigure". <LayersLegendPanel> is NOT in the DOM.
    - Test 2 (orphan trigger B — bound widget deleted): mount with `widget.config = { sourceMapWidgetId: 999 }` inside DashboardContextProvider with `widgets=[{id:1,type:"map"}]` (no widget with id=999) — renders the same orphan UI as Test 1.
    - Test 3 (orphan trigger C — bound widget exists but non-map): mount with `widget.config = { sourceMapWidgetId: 1 }` inside DashboardContextProvider with `widgets=[{id:1,type:"bar"}]` — renders orphan UI (defensive guard).
    - Test 4 (Reconfigure button calls onConfigureWidget): given orphan state from Test 1, click the "Reconfigure" button — `onConfigureWidget` mock is called once with the legend widget itself (`expect(mock).toHaveBeenCalledWith(legendWidget)`).
    - Test 5 (happy path — bound map widget exists with includedLayerIds undefined): mount with `widget.config = { sourceMapWidgetId: 1 }`, DashboardContextProvider `widgets=[{id:1, type:"map", config:{}}]`, and `useDashboardLayersStore.setState({ layers: [layerX, layerY] })` — renders `<LayersLegendPanel>` with all 2 layers (Phase 12 all-on semantic); does NOT render orphan UI.
    - Test 6 (happy path — bound map filtering by includedLayerIds): mount with `widget.config = { sourceMapWidgetId: 1 }`, DashboardContextProvider `widgets=[{id:1, type:"map", config:{ includedLayerIds:[42] }}]`, and store layers `[{id:42}, {id:99}]` — renders <LayersLegendPanel> with only layer 42.
    - Test 7 (LayersLegendPanel mount props): in happy path, the rendered <LayersLegendPanel> receives `showChevron={false}`, `collapsed={false}`, `corner="top-right"`, and an `onToggleCollapse` callback (the callback can be a no-op `()=>{}`). Spec verifies these props via spying on a mocked LayersLegendPanel component.
    - Test 8 (live update via legendKey): mount happy-path with one CB layer; call `useDashboardLayersStore.getState().updateLayer(layerId, { cb_config: '{"attr":"x","valsType":"numeric","breaks":[{"value":10,"color":"FFFF0000"}]}' })`; assert legendKey re-subscription triggers a re-render (verifiable via the LayersLegendPanel mock receiving updated `layers` prop containing the new cb_config string).
    - Test 9 (no orphan when bound map exists with no layers): mount with `widget.config={ sourceMapWidgetId: 1 }`, widgets=[{id:1, type:"map", config:{}}], store layers=[] — renders <LayersLegendPanel layers={[]}>, NOT the orphan UI. (Empty layer list is a valid happy-path state.)
    - Test 10 (legendKey selector — primitive only): grep audit — LegendRenderer.tsx source MUST use the exact legendKey formula from MapChartRenderer.tsx:533-540. Source-only assertion via fs.readFileSync inside spec verifies the formula presence.
    - Test 11 (CSS classes present in global.css): grep `.legend-widget-body`, `.legend-widget-orphan`, `.legend-widget-orphan-message`, `.legend-widget-orphan-reconfigure` all exist in global.css.
  </behavior>
  <action>
    **Create `kinetica_bi/src/components/charts/LegendRenderer.tsx`** with this EXACT content:

    ```typescript
    /**
     * v1.7 Phase 42 Plan 02 (WIDGET-V17-01..05): Standalone Legend widget renderer.
     *
     * Mirrors the chosen map widget's <LayersLegendPanel> content as a dashboard tile.
     * Reads bound map widget via DashboardContext (LegendRenderer is INSIDE the
     * DashboardContextProvider, unlike LegendConfigPanel which is in WidgetConfigModal).
     *
     * Subscription discipline:
     *   - legendKey primitive selector (PITFALL S-02) — mirrors MapChartRenderer:533-540 verbatim
     *   - useDashboardLayersStore.getState().layers read IMPERATIVELY inside useMemo body
     *   - eslint-disable-next-line react-hooks/exhaustive-deps because legendKey is the reactive trigger
     *
     * Orphan state (single UI for all three triggers):
     *   1. widget.config.sourceMapWidgetId === undefined
     *   2. widgets.find(w => w.id === sourceMapWidgetId) === undefined (bound widget deleted)
     *   3. found widget but type !== "map" (defensive — picker filters but operator overrides possible)
     *
     * Live updates: store.updateLayer mutation → legendKey changes → useMemo recomputes
     * → <LayersLegendPanel> receives new layers prop → re-renders with updated CB swatches.
     */

    import { useMemo } from "react";
    import { LayersLegendPanel } from "../LayersLegendPanel";
    import type { ResolvedLegendLayer } from "../LayersLegendPanel";
    import { resolveLegendLayers } from "../../lib/resolveLegendLayers";
    import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
    import { useDashboardContext } from "../DashboardContext";
    import type { WidgetDto } from "../../api/client";

    type Props = {
      widget: WidgetDto;
      onConfigureWidget?: (widget: WidgetDto) => void;
    };

    export default function LegendRenderer({ widget, onConfigureWidget }: Props): JSX.Element {
      const { widgets } = useDashboardContext();
      const sourceMapWidgetId = widget.config.sourceMapWidgetId as number | undefined;

      // legendKey primitive selector — VERBATIM mirror of MapChartRenderer.tsx:533-540 (PITFALL S-02 lock)
      const legendKey = useDashboardLayersStore((s) =>
        s.layers
          .map(
            (l) =>
              `${l.id}:${(l.config as { renderMode?: string })?.renderMode ?? "raster"}:${l.cb_config ?? "null"}`,
          )
          .join("|"),
      );

      // Resolve bound map widget (single lookup; reused for orphan detection AND happy-path config read)
      const boundWidget =
        sourceMapWidgetId !== undefined
          ? widgets.find((w) => w.id === sourceMapWidgetId)
          : undefined;
      const isMapWidget = boundWidget?.type === "map";

      // Orphan state: ANY of the three triggers
      const isOrphan = sourceMapWidgetId === undefined || boundWidget === undefined || !isMapWidget;

      // Compute resolvedLegendLayers ONLY when not orphaned. Note: useMemo MUST be called
      // unconditionally (React hooks rule), so we compute it before the orphan branch.
      const includedLayerIds = (isMapWidget && boundWidget
        ? (boundWidget.config.includedLayerIds as number[] | undefined)
        : undefined);

      const resolvedLegendLayers = useMemo<ResolvedLegendLayer[]>(() => {
        if (isOrphan) return [];
        return resolveLegendLayers(
          useDashboardLayersStore.getState().layers,
          includedLayerIds,
        );
        // legendKey is the read-trigger; includedLayerIds is the filter trigger; isOrphan gates render
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [legendKey, includedLayerIds, isOrphan]);

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
            layers={resolvedLegendLayers}
            corner="top-right"
            collapsed={false}
            onToggleCollapse={() => {}}
            showChevron={false}
          />
        </div>
      );
    }
    ```

    **Append CSS to `kinetica_bi/src/styles/global.css`** (find the end of Phase 41 `.layers-legend-panel*` rules and append AFTER them):

    ```css
    /* ─── v1.7 Phase 42 (Plan 42-02): Standalone Legend widget ─────────────────── */

    .legend-widget-body {
      width: 100%;
      height: 100%;
      overflow: auto;
    }

    .legend-widget-orphan {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 1rem;
      box-sizing: border-box;
      text-align: center;
    }

    .legend-widget-orphan-message {
      color: var(--color-text-muted, #6b7280);
      font-size: 0.9rem;
      line-height: 1.4;
    }

    .legend-widget-orphan-reconfigure {
      background: var(--color-surface-2, #f3f4f6);
      color: var(--color-text, #111827);
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: 4px;
      padding: 0.4rem 0.9rem;
      cursor: pointer;
      font-size: 0.875rem;
    }

    .legend-widget-orphan-reconfigure:hover {
      background: var(--color-surface-3, #e5e7eb);
    }

    /* When LegendRenderer mounts <LayersLegendPanel showChevron={false}>, the panel must
       fill the standalone widget body (no corner-absolute positioning). Override the
       Phase 41 corner positioning with static positioning for this nested context. */
    .legend-widget-body .layers-legend-panel {
      position: static;
      width: 100%;
      max-width: 100%;
      max-height: 100%;
    }
    ```

    **Create `kinetica_bi/src/components/charts/LegendRenderer.spec.tsx`** with vitest tests for all 11 behaviors above. Key spec patterns:

    1. Mock `LayersLegendPanel` via `vi.mock("../LayersLegendPanel", ...)` to capture received props (mirrors Phase 41 MapChartRenderer.spec.tsx pattern — see lines around the mocks at top of that file).
    2. Mock `useDashboardLayersStore` similar to Phase 41 (provide both hook function AND `.getState()` method — see Phase 41-02 SUMMARY § "Auto-fixed Issues #3 getState() missing from dashboardLayersStore mock").
    3. Use a real `DashboardContextProvider` wrapper (cannot mock useDashboardContext because it's a real require). Wrap test renders with:
    ```tsx
    <DashboardContextProvider dashboardId={1} widgets={widgets} dynamicViews={[]} retryDynamicView={() => {}}>
      <LegendRenderer widget={legendWidget} onConfigureWidget={mockOnConfigure} />
    </DashboardContextProvider>
    ```

    Sample test skeletons:

    ```typescript
    import { describe, it, expect, vi, beforeEach } from "vitest";
    import { render, screen, fireEvent } from "@testing-library/react";
    import fs from "fs";
    import path from "path";
    import type { WidgetDto, DashboardLayerDto } from "../../api/client";
    import { DashboardContextProvider } from "../DashboardContext";

    // Captured props from mocked LayersLegendPanel
    let lastLayersLegendPanelProps: { layers: unknown[]; showChevron?: boolean; collapsed: boolean; corner: string } | null = null;
    vi.mock("../LayersLegendPanel", () => ({
      LayersLegendPanel: (props: any) => {
        lastLayersLegendPanelProps = props;
        return <div data-testid="mocked-layers-legend-panel" />;
      },
    }));

    // Zustand store mock — provides hook + getState
    const _storeState: { layers: DashboardLayerDto[] } = { layers: [] };
    vi.mock("../../store/dashboardLayersStore", () => {
      const hook = (selector: (s: { layers: DashboardLayerDto[] }) => unknown) => selector(_storeState);
      (hook as any).getState = () => _storeState;
      (hook as any).setState = (patch: Partial<typeof _storeState>) => { Object.assign(_storeState, patch); };
      return { useDashboardLayersStore: hook };
    });

    // Now import LegendRenderer AFTER the mocks
    import LegendRenderer from "./LegendRenderer";

    function makeWidget(overrides: Partial<WidgetDto>): WidgetDto {
      return { id: 100, dashboard_id: 1, title: "Legend", type: "legend", position: 0, config: {}, created_at: "", updated_at: "", ...overrides };
    }
    function makeLayer(id: number, extras: Partial<DashboardLayerDto> = {}): DashboardLayerDto {
      return {
        id,
        dashboard_id: 1,
        table_id: 1,
        layer_index: 0,
        config: {},
        cb_config: null,
        info_enabled: 1,
        dynamic_view_id: null,
        ...extras,
      } as DashboardLayerDto;
    }
    function renderWithContext(widget: WidgetDto, widgets: WidgetDto[], onConfigureWidget?: (w: WidgetDto) => void) {
      return render(
        <DashboardContextProvider dashboardId={1} widgets={widgets} dynamicViews={[]} retryDynamicView={() => {}}>
          <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />
        </DashboardContextProvider>
      );
    }

    beforeEach(() => {
      _storeState.layers = [];
      lastLayersLegendPanelProps = null;
    });

    describe("LegendRenderer (Phase 42 / WIDGET-V17-01..05)", () => {
      it("Test 1: orphan UI when sourceMapWidgetId is undefined", () => {
        const legendWidget = makeWidget({ id: 100, type: "legend", config: {} });
        const mapA = makeWidget({ id: 1, type: "map", title: "Map A" });
        renderWithContext(legendWidget, [mapA, legendWidget]);
        expect(screen.getByText("Source map widget not found. Reconfigure the legend.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reconfigure" })).toBeTruthy();
        expect(screen.queryByTestId("mocked-layers-legend-panel")).toBeNull();
      });

      it("Test 2: orphan UI when bound widget id not in widgets list (deleted)", () => {
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 999 } });
        const otherMap = makeWidget({ id: 1, type: "map" });
        renderWithContext(legendWidget, [otherMap, legendWidget]);
        expect(screen.getByText("Source map widget not found. Reconfigure the legend.")).toBeTruthy();
      });

      it("Test 3: orphan UI when bound widget is non-map (defensive)", () => {
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 5 } });
        const barWidget = makeWidget({ id: 5, type: "bar" });
        renderWithContext(legendWidget, [barWidget, legendWidget]);
        expect(screen.getByText("Source map widget not found. Reconfigure the legend.")).toBeTruthy();
      });

      it("Test 4: Reconfigure button calls onConfigureWidget(legendWidget)", () => {
        const onConfigure = vi.fn();
        const legendWidget = makeWidget({ id: 100, type: "legend", config: {} });
        renderWithContext(legendWidget, [legendWidget], onConfigure);
        const btn = screen.getByRole("button", { name: "Reconfigure" });
        fireEvent.click(btn);
        expect(onConfigure).toHaveBeenCalledTimes(1);
        expect(onConfigure).toHaveBeenCalledWith(legendWidget);
      });

      it("Test 5: happy path — bound map with no includedLayerIds renders all store layers", () => {
        _storeState.layers = [makeLayer(10), makeLayer(20)];
        const mapA = makeWidget({ id: 1, type: "map", config: {} });
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 1 } });
        renderWithContext(legendWidget, [mapA, legendWidget]);
        expect(screen.getByTestId("mocked-layers-legend-panel")).toBeTruthy();
        expect((lastLayersLegendPanelProps?.layers as Array<{layer: DashboardLayerDto}>)?.length).toBe(2);
        expect(screen.queryByText(/Source map widget not found/)).toBeNull();
      });

      it("Test 6: happy path — bound map with includedLayerIds filters layers", () => {
        _storeState.layers = [makeLayer(42), makeLayer(99)];
        const mapA = makeWidget({ id: 1, type: "map", config: { includedLayerIds: [42] } });
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 1 } });
        renderWithContext(legendWidget, [mapA, legendWidget]);
        const layers = lastLayersLegendPanelProps?.layers as Array<{ layer: DashboardLayerDto }>;
        expect(layers.length).toBe(1);
        expect(layers[0].layer.id).toBe(42);
      });

      it("Test 7: LayersLegendPanel receives showChevron=false, collapsed=false, corner='top-right'", () => {
        _storeState.layers = [makeLayer(10)];
        const mapA = makeWidget({ id: 1, type: "map", config: {} });
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 1 } });
        renderWithContext(legendWidget, [mapA, legendWidget]);
        expect(lastLayersLegendPanelProps?.showChevron).toBe(false);
        expect(lastLayersLegendPanelProps?.collapsed).toBe(false);
        expect(lastLayersLegendPanelProps?.corner).toBe("top-right");
      });

      it("Test 8: live cb_config update propagates via legendKey", () => {
        _storeState.layers = [makeLayer(10, { cb_config: null })];
        const mapA = makeWidget({ id: 1, type: "map", config: {} });
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 1 } });
        const { rerender } = renderWithContext(legendWidget, [mapA, legendWidget]);
        const initialLayer = (lastLayersLegendPanelProps?.layers as Array<{ layer: DashboardLayerDto }>)[0].layer;
        expect(initialLayer.cb_config).toBeNull();
        // Simulate store mutation
        _storeState.layers = [makeLayer(10, { cb_config: '{"attr":"x","valsType":"numeric","breaks":[{"value":10,"color":"FFFF0000"}]}' })];
        rerender(
          <DashboardContextProvider dashboardId={1} widgets={[mapA, legendWidget]} dynamicViews={[]} retryDynamicView={() => {}}>
            <LegendRenderer widget={legendWidget} />
          </DashboardContextProvider>
        );
        const updatedLayer = (lastLayersLegendPanelProps?.layers as Array<{ layer: DashboardLayerDto }>)[0].layer;
        expect(updatedLayer.cb_config).toContain("FFFF0000");
      });

      it("Test 9: empty store layers + bound map renders LayersLegendPanel (NOT orphan)", () => {
        _storeState.layers = [];
        const mapA = makeWidget({ id: 1, type: "map", config: {} });
        const legendWidget = makeWidget({ id: 100, type: "legend", config: { sourceMapWidgetId: 1 } });
        renderWithContext(legendWidget, [mapA, legendWidget]);
        expect(screen.getByTestId("mocked-layers-legend-panel")).toBeTruthy();
        expect(screen.queryByText(/Source map widget not found/)).toBeNull();
        expect((lastLayersLegendPanelProps?.layers as unknown[]).length).toBe(0);
      });

      it("Test 10: source uses legendKey primitive selector formula", () => {
        const source = fs.readFileSync(
          path.resolve(__dirname, "LegendRenderer.tsx"),
          "utf-8"
        );
        // Verify the exact selector formula (mirror of MapChartRenderer:533-540)
        expect(source).toMatch(/const legendKey = useDashboardLayersStore/);
        expect(source).toMatch(/\$\{l\.id\}:\$\{.*renderMode/);
        expect(source).toMatch(/l\.cb_config \?\? "null"/);
        // Anti-pattern check: must NOT subscribe to s.layers array directly
        expect(source).not.toMatch(/useDashboardLayersStore\(\(s\) => s\.layers\)/);
        expect(source).not.toMatch(/useDashboardLayersStore\(s => s\.layers\)/);
      });

      it("Test 11: global.css contains .legend-widget-* selectors", () => {
        const css = fs.readFileSync(
          path.resolve(__dirname, "..", "..", "styles", "global.css"),
          "utf-8"
        );
        expect(css).toMatch(/\.legend-widget-body/);
        expect(css).toMatch(/\.legend-widget-orphan/);
        expect(css).toMatch(/\.legend-widget-orphan-message/);
        expect(css).toMatch(/\.legend-widget-orphan-reconfigure/);
      });
    });
    ```

    **AVOID:**
    - Don't subscribe to `useDashboardLayersStore.layers` directly — primitive `legendKey` selector ONLY (PITFALL S-02 / Pitfall 2 in 42-RESEARCH.md)
    - Don't read `widget.config.includedLayerIds` from the LEGEND widget — read from the BOUND MAP WIDGET's config (Pitfall 3 in 42-RESEARCH.md)
    - Don't call useMemo conditionally — React hooks rule. The orphan branch comes AFTER the useMemo declaration; useMemo returns `[]` early when isOrphan is true.
    - Don't auto-open the config modal on orphan render — explicit operator click required (CONTEXT.md "Don't auto-open the config modal on orphan")
    - Don't differentiate orphan trigger UIs — single state, verbatim copy for all three triggers
    - Don't drop the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment — legendKey is the reactive trigger, layers is read imperatively inside the memo body
    - Don't add a collapse state — LegendRenderer is always-expanded; showChevron={false} hides the chevron and forces body render
    - Don't add a corner picker — LegendRenderer always passes `corner="top-right"` (no corner-anchor semantics for standalone widget; the CSS override `.legend-widget-body .layers-legend-panel { position: static }` neutralizes the corner positioning anyway)
    - Don't pass `tables` prop into LegendRenderer — legend has no table source; AggregatedWidgetRenderer fallback is bypassed via WidgetRenderer's early-return (Task 3)
    - Don't use `useDashboardContextOptional()` — LegendRenderer is always mounted inside DashboardContextProvider (because WidgetRenderer is, per DashboardsPage.tsx:891-963). Use the throwing `useDashboardContext()` to fail loud if accidentally rendered outside.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/LegendRenderer.spec.tsx 2>&1 | tail -40</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 0
    - `test -f kinetica_bi/src/components/charts/LegendRenderer.spec.tsx` returns 0
    - `grep -c "const legendKey = useDashboardLayersStore" kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 1 (primitive selector — PITFALL S-02)
    - `grep -c "useDashboardLayersStore.*s\\.layers)" kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 0 (anti-pattern check — no direct layers subscription)
    - `grep -c "Source map widget not found. Reconfigure the legend." kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 1 (verbatim copy)
    - `grep -c "onConfigureWidget?.(widget)" kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 1
    - `grep -c "showChevron={false}" kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 1
    - `grep -c "resolveLegendLayers(" kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 1
    - `grep -c "useDashboardContext()" kinetica_bi/src/components/charts/LegendRenderer.tsx` returns 1 (this component IS inside the provider, unlike LegendConfigPanel)
    - `grep -c "\\.legend-widget-body" kinetica_bi/src/styles/global.css` returns at least 1
    - `grep -c "\\.legend-widget-orphan" kinetica_bi/src/styles/global.css` returns at least 1
    - `grep -c "\\.legend-widget-orphan-message" kinetica_bi/src/styles/global.css` returns at least 1
    - `grep -c "\\.legend-widget-orphan-reconfigure" kinetica_bi/src/styles/global.css` returns at least 1
    - vitest: all 11 LegendRenderer.spec.tsx tests pass
  </acceptance_criteria>
  <done>
    LegendRenderer.tsx exists, uses legendKey primitive selector, renders 3 orphan triggers with verbatim copy + Reconfigure button calling onConfigureWidget, happy-path mounts LayersLegendPanel with showChevron={false}, live cb_config updates propagate via legendKey, CSS classes appended to global.css; 11 spec tests pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Register legend chart type + wire WidgetRenderer early-return branch + spec</name>
  <files>
    - kinetica_bi/src/components/charts/definitions/legend.ts (NEW)
    - kinetica_bi/src/components/charts/definitions/index.ts (MODIFY — add registerLegend import + call)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (MODIFY — add early-return branch for widget.type==='legend')
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (MODIFY — add tests for legend branch)
  </files>
  <read_first>
    - kinetica_bi/src/components/charts/definitions/info-card.ts (full file — registry entry pattern)
    - kinetica_bi/src/components/charts/definitions/index.ts (full file — registerAllChartTypes pattern)
    - kinetica_bi/src/components/charts/registry.ts (full file — registerChartType + ChartTypeDefinition)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx lines 200-242 (early-return ladder at lines 224-235)
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (full file — existing test patterns; if it doesn't exist, create with minimal harness)
  </read_first>
  <behavior>
    - Test 12 (registry entry registered): after calling `registerAllChartTypes()`, `getChartType("legend")` returns a definition with `type: "legend"`, `label: "Legend"`, `icon: "LG"`, `fields: []`, `defaultConfig: {}`, `usesAggregation: false`, `supportsDrillDown: false`, and `CustomConfigPanel === LegendConfigPanel`.
    - Test 13 (chart picker availability): `getAllChartTypes().map(c => c.type).includes("legend") === true`.
    - Test 14 (WidgetRenderer renders LegendRenderer for type='legend'): mount `<WidgetRenderer widget={{...type:"legend"}} onConfigureWidget={mockFn} />` inside DashboardContextProvider — the rendered tree contains a mounted LegendRenderer (verified via mocked LegendRenderer that emits a test-id), NOT AggregatedWidgetRenderer.
    - Test 15 (onConfigureWidget threading): the LegendRenderer mock receives `onConfigureWidget` prop equal to the one passed to WidgetRenderer.
    - Test 16 (no fallthrough to AggregatedWidgetRenderer): WidgetRenderer rendering a `type="legend"` widget does NOT mount AggregatedWidgetRenderer (verified via mocking AggregatedWidgetRenderer to throw + assert NOT thrown).
  </behavior>
  <action>
    **Step A — Create `kinetica_bi/src/components/charts/definitions/legend.ts`** with this EXACT content:

    ```typescript
    /**
     * v1.7 Phase 42 Plan 02 (WIDGET-V17-01): Legend chart type registry entry.
     *
     * Mirrors v1.4 Phase 23 info-card precedent:
     *   - icon: "LG" (2-char text, matches info-card's "IC")
     *   - usesAggregation: false (no SQL)
     *   - supportsDrillDown: false (no row context)
     *   - defaultConfig: {} (sourceMapWidgetId set via LegendConfigPanel auto-pick)
     *
     * Key difference: includes CustomConfigPanel for the source-map-widget dropdown.
     */

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

    **Step B — Extend `kinetica_bi/src/components/charts/definitions/index.ts`**:

    Add the import after `import registerInfoCard from "./info-card";`:
    ```typescript
    import registerLegend from "./legend";
    ```

    Add the call inside `registerAllChartTypes()` after `registerInfoCard();`:
    ```typescript
    export function registerAllChartTypes() {
      registerBar();
      registerLine();
      registerPie();
      registerScatter();
      registerTable();
      registerBigNumber();
      registerHeatmap();
      registerMap();
      registerRecords();
      registerInfoCard();
      registerLegend();       // Phase 42 Plan 02 (WIDGET-V17-01)
    }
    ```

    **Step C — Extend `kinetica_bi/src/components/charts/WidgetRenderer.tsx`** — add early-return branch and remove the `void onConfigureWidget;` no-op marker:

    1. Add the import at the top (alongside other renderer imports — find `import InfoCardRenderer from "./InfoCardRenderer";` and add the new line after it):
    ```typescript
    import LegendRenderer from "./LegendRenderer";
    ```

    2. Update the destructure at line ~212 — REMOVE the `void onConfigureWidget;` line that Plan 42-01 Task 3 added (it's now consumed):
    ```typescript
    const WidgetRenderer = ({ widget, tables = [], onConfigureWidget }: WidgetRendererProps) => {
      // (Plan 42-01 added a `void onConfigureWidget;` line here; Plan 42-02 removes it
      // because the prop is now consumed in the legend branch below.)
    ```

    3. Update the early-return ladder at lines 225-235 to insert the legend branch BETWEEN info-card and the else fallback:

    BEFORE (current):
    ```typescript
      let body: ReactElement;
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

    AFTER:
    ```typescript
      let body: ReactElement;
      if (widget.type === "map") {
        body = <MapChartRenderer widget={widget} tables={tables} />;
      } else if (widget.type === "records") {
        body = <RecordsTableRenderer widget={widget} />;
      } else if (widget.type === "info-card") {
        // Phase 23 (CARD-V14-01): info-card short-circuits BEFORE AggregatedWidgetRenderer so it
        // does not try to read widget.config.sql (info-card defaultConfig is {} — no SQL).
        body = <InfoCardRenderer widget={widget} tables={tables} />;
      } else if (widget.type === "legend") {
        // Phase 42 Plan 02 (WIDGET-V17-01): legend short-circuits BEFORE AggregatedWidgetRenderer
        // so it does not try to read widget.config.sql (legend defaultConfig is {} — no SQL).
        // onConfigureWidget threaded from DashboardsPage (Plan 42-01) for the Reconfigure CTA.
        body = <LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />;
      } else {
        body = <AggregatedWidgetRenderer widget={widget} />;
      }
    ```

    **Step D — Extend `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`** with 5 new tests for the legend branch. If the spec file does not exist, create it with minimal vitest harness. Sample skeleton:

    ```typescript
    import { describe, it, expect, vi } from "vitest";
    import { render, screen } from "@testing-library/react";
    import { DashboardContextProvider } from "../DashboardContext";
    import type { WidgetDto } from "../../api/client";

    vi.mock("./LegendRenderer", () => ({
      default: (props: { widget: WidgetDto; onConfigureWidget?: (w: WidgetDto) => void }) => {
        return (
          <div
            data-testid="mocked-legend-renderer"
            data-widget-id={String(props.widget.id)}
            data-has-on-configure={String(typeof props.onConfigureWidget === "function")}
          />
        );
      },
    }));

    vi.mock("./AggregatedWidgetRenderer", () => ({
      default: () => { throw new Error("AggregatedWidgetRenderer should NOT mount for legend widgets"); },
    }));

    // Stub other renderers minimally so import resolution succeeds
    vi.mock("./MapChartRenderer", () => ({ default: () => <div /> }));
    vi.mock("./RecordsTableRenderer", () => ({ default: () => <div /> }));
    vi.mock("./InfoCardRenderer", () => ({ default: () => <div /> }));

    import WidgetRenderer from "./WidgetRenderer";
    import { registerAllChartTypes, getChartType, getAllChartTypes } from "./registry";

    function makeWidget(overrides: Partial<WidgetDto>): WidgetDto {
      return { id: 1, dashboard_id: 1, title: "", type: "bar", position: 0, config: {}, created_at: "", updated_at: "", ...overrides };
    }

    function renderInContext(widget: WidgetDto, onConfigureWidget?: (w: WidgetDto) => void) {
      return render(
        <DashboardContextProvider dashboardId={1} widgets={[widget]} dynamicViews={[]} retryDynamicView={() => {}}>
          <WidgetRenderer widget={widget} onConfigureWidget={onConfigureWidget} />
        </DashboardContextProvider>
      );
    }

    describe("WidgetRenderer Phase 42 legend branch", () => {
      it("Test 12: registerAllChartTypes registers the legend definition", () => {
        registerAllChartTypes();
        const def = getChartType("legend");
        expect(def).toBeTruthy();
        expect(def?.type).toBe("legend");
        expect(def?.label).toBe("Legend");
        expect(def?.icon).toBe("LG");
        expect(def?.fields).toEqual([]);
        expect(def?.defaultConfig).toEqual({});
        expect(def?.usesAggregation).toBe(false);
        expect(def?.supportsDrillDown).toBe(false);
        expect(def?.CustomConfigPanel).toBeTruthy();
      });

      it("Test 13: legend appears in getAllChartTypes()", () => {
        registerAllChartTypes();
        const types = getAllChartTypes().map((c) => c.type);
        expect(types).toContain("legend");
      });

      it("Test 14: WidgetRenderer renders LegendRenderer for type=legend", () => {
        const w = makeWidget({ id: 100, type: "legend" });
        renderInContext(w);
        expect(screen.getByTestId("mocked-legend-renderer")).toBeTruthy();
        expect(screen.getByTestId("mocked-legend-renderer").getAttribute("data-widget-id")).toBe("100");
      });

      it("Test 15: onConfigureWidget threads through to LegendRenderer", () => {
        const w = makeWidget({ id: 100, type: "legend" });
        const onConfig = vi.fn();
        renderInContext(w, onConfig);
        expect(screen.getByTestId("mocked-legend-renderer").getAttribute("data-has-on-configure")).toBe("true");
      });

      it("Test 16: legend type does NOT fall through to AggregatedWidgetRenderer", () => {
        const w = makeWidget({ id: 100, type: "legend" });
        // If WidgetRenderer falls through, the mocked AggregatedWidgetRenderer throws.
        // Test passes if render does not throw.
        expect(() => renderInContext(w)).not.toThrow();
      });
    });
    ```

    **AVOID:**
    - Don't insert the legend branch AFTER the `else` fallback — the else MUST be unreachable for `widget.type === "legend"` (otherwise the legend widget tries to fetch SQL via AggregatedWidgetRenderer, which has no `widget.config.sql`)
    - Don't pass `tables` to LegendRenderer — LegendRenderer reads from useDashboardLayersStore, not from tables prop (Pitfall: don't add `tables={tables}` to the new branch)
    - Don't register legend BEFORE info-card in registerAllChartTypes order — register AFTER info-card for clarity (legend is a v1.7 addition; info-card is v1.4)
    - Don't drop the `void onConfigureWidget;` no-op without also wiring the consumer — both must happen atomically in Task 3 (Plan 42-01 added the no-op as a placeholder; Task 3 removes it AND wires the consumer in the same task)
    - Don't add a `usesDataSource: false` field — info-card omits this field too (the registry default is appropriate); keep the legend.ts file MINIMAL to mirror info-card.ts
    - Don't make the legend chart type's icon a FontAwesome glyph — 2-char text "LG" matches the established info-card "IC" pattern (deferred to v1.8 per CONTEXT.md)
    - Don't break the v1.7 Phase 41 lock that LayersLegendPanel and LegendRenderer share the SAME corner-positioning CSS — the `.legend-widget-body .layers-legend-panel { position: static }` override in global.css (Task 2) neutralizes the corner-anchor when nested inside .legend-widget-body
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/LegendRenderer.spec.tsx src/components/charts/LegendConfigPanel.spec.tsx 2>&1 | tail -30 && npx vitest run 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/components/charts/definitions/legend.ts` returns 0
    - `grep -c "type: \"legend\"" kinetica_bi/src/components/charts/definitions/legend.ts` returns 1
    - `grep -c "label: \"Legend\"" kinetica_bi/src/components/charts/definitions/legend.ts` returns 1
    - `grep -c "icon: \"LG\"" kinetica_bi/src/components/charts/definitions/legend.ts` returns 1
    - `grep -c "CustomConfigPanel: LegendConfigPanel" kinetica_bi/src/components/charts/definitions/legend.ts` returns 1
    - `grep -c "import registerLegend from \"./legend\"" kinetica_bi/src/components/charts/definitions/index.ts` returns 1
    - `grep -c "registerLegend();" kinetica_bi/src/components/charts/definitions/index.ts` returns 1
    - `grep -c "widget.type === \"legend\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `grep -c "<LegendRenderer widget={widget} onConfigureWidget={onConfigureWidget} />" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `grep -c "import LegendRenderer from \"./LegendRenderer\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - `grep -c "void onConfigureWidget;" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 0 (Plan 42-01's no-op marker is REMOVED in Plan 42-02 Task 3 because the prop is now consumed)
    - Phase 23 info-card branch grep `widget.type === "info-card"` STILL present (regression check — Phase 42 doesn't remove it): `grep -c "widget.type === \"info-card\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1
    - vitest: all 5 new WidgetRenderer.spec.tsx tests pass (Tests 12-16)
    - vitest: full frontend suite passes (>= 1264 tests — Plan 41 had 1239, Plan 42-01 adds ~14, Plan 42-02 adds ~26)
    - tsc: `cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -c "error TS"` returns 0 NEW errors over the Phase 41 + Plan 42-01 baseline
  </acceptance_criteria>
  <done>
    `legend` chart type registered with CustomConfigPanel=LegendConfigPanel; `definitions/index.ts` calls registerLegend(); WidgetRenderer early-returns LegendRenderer for widget.type==='legend' before AggregatedWidgetRenderer fallback; onConfigureWidget threads through; AggregatedWidgetRenderer NOT mounted for legend widgets; 5 new WidgetRenderer.spec.tsx tests pass; full frontend suite green; tsc clean.
  </done>
</task>

</tasks>

<verification>
**All 5 WIDGET-V17-* requirements close in this plan; verify each:**

**WIDGET-V17-01** (new chart type registered + WidgetRenderer early-return):
```bash
grep -c "type: \"legend\"" kinetica_bi/src/components/charts/definitions/legend.ts          # 1
grep -c "registerLegend()" kinetica_bi/src/components/charts/definitions/index.ts          # 1
grep -c "widget.type === \"legend\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx  # 1
```

**WIDGET-V17-02** (`<LegendRenderer>` consumes `<LayersLegendPanel>` via legendKey primitive selector):
```bash
grep -c "const legendKey = useDashboardLayersStore" kinetica_bi/src/components/charts/LegendRenderer.tsx  # 1
grep -c "resolveLegendLayers(" kinetica_bi/src/components/charts/LegendRenderer.tsx                       # 1
grep -c "showChevron={false}" kinetica_bi/src/components/charts/LegendRenderer.tsx                        # 1
```

**WIDGET-V17-03** (config UI picks single map widget on same dashboard; cross-dashboard out of scope):
```bash
grep -c "w.type === \"map\"" kinetica_bi/src/components/charts/LegendConfigPanel.tsx       # 1 (eligibility filter)
grep -c "useDashboardContext" kinetica_bi/src/components/charts/LegendConfigPanel.tsx     # 0 (uses props.widgets — Pitfall 1)
```

**WIDGET-V17-04** (orphan state + Reconfigure CTA):
```bash
grep -c "Source map widget not found. Reconfigure the legend." kinetica_bi/src/components/charts/LegendRenderer.tsx  # 1 (verbatim copy)
grep -c "onConfigureWidget?.(widget)" kinetica_bi/src/components/charts/LegendRenderer.tsx                            # 1
```

**WIDGET-V17-05** (live updates via shared store):
```bash
# Verified via Test 8 (live cb_config update) in LegendRenderer.spec.tsx
cd kinetica_bi && npx vitest run src/components/charts/LegendRenderer.spec.tsx -t "live cb_config update"
```

**Full suite & tsc:**
```bash
cd kinetica_bi && npx vitest run 2>&1 | tail -5     # all green
cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -c "error TS"  # 0 NEW errors vs Phase 41 + 42-01 baseline
```
</verification>

<success_criteria>
**ROADMAP Phase 42 Success Criteria (all 4):**

- **SC1** (chart type registry + WidgetRenderer early-return): `definitions/legend.ts` registered, `registerLegend()` called in `definitions/index.ts`, WidgetRenderer's early-return ladder includes `widget.type === "legend"` branch BEFORE AggregatedWidgetRenderer fallback. ✓
- **SC2** (config UI picks single map widget on same dashboard; cross-dashboard out of scope): LegendConfigPanel renders a dropdown filtered to `w.type === "map"`; auto-picks first map on mount; reads widgets from props.widgets (NOT useDashboardContext — Pitfall 1 enforced). ✓
- **SC3** (orphan state with reconfigure CTA): LegendRenderer renders verbatim "Source map widget not found. Reconfigure the legend." + Reconfigure button for all 3 trigger conditions (undefined / not found / non-map); clicking Reconfigure calls onConfigureWidget(widget) which DashboardsPage wires to setConfiguringWidget. ✓
- **SC4** (live updates via shared store): LegendRenderer subscribes via legendKey primitive selector; updateLayer mutation → legendKey changes → useMemo recomputes → <LayersLegendPanel> re-renders with new cb_config; Test 8 validates. ✓

**All 5 WIDGET-V17-* requirements close:**
- WIDGET-V17-01 ✓ via legend.ts + index.ts + WidgetRenderer branch (Task 3)
- WIDGET-V17-02 ✓ via LegendRenderer + legendKey + resolveLegendLayers + showChevron=false (Task 2)
- WIDGET-V17-03 ✓ via LegendConfigPanel.tsx + props.widgets threading (Task 1) — cross-dashboard NOT offered
- WIDGET-V17-04 ✓ via orphan UI + Reconfigure button (Task 2)
- WIDGET-V17-05 ✓ via legendKey + reference-stable updateLayer subscription (Task 2 Test 8)

**No regressions:**
- Phase 41 MapChartRenderer.spec.tsx 166 tests green without modification (Plan 42-01 zero-behavior-change refactor; Plan 42-02 doesn't touch MapChartRenderer)
- Phase 41 LayersLegendPanel.spec.tsx 16 existing tests green without modification (Plan 42-01 additive showChevron prop with default true)
- Full frontend suite green (>= 1264 tests; counting Phase 41's 1239 baseline + ~14 new from Plan 42-01 + ~26 new from Plan 42-02)
- tsc clean (no new errors over Phase 41 + Plan 42-01 baseline)
</success_criteria>

<output>
After completion, create `.planning/phases/42-standalone-legend-chart-type/42-02-SUMMARY.md` capturing:
- 3 tasks completed with commit hashes + file lists
- New test counts: ~10 LegendConfigPanel + ~11 LegendRenderer + ~5 WidgetRenderer = ~26 new tests
- All 5 WIDGET-V17-* requirements satisfied (with the specific test that closes each)
- All 4 ROADMAP success criteria for Phase 42 satisfied
- Full frontend suite count (baseline 1239 → 1264+ expected)
- tsc parity vs baseline
- Phase 43 unblocked: live UAT precondition (a map widget with classbreak layer) is the only operator-side setup needed; the standalone Legend widget is operator-add-able from the chart picker.
- Any deviations from this plan with rationale
</output>
