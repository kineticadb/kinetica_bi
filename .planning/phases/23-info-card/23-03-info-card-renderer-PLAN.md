---
phase: 23-info-card
plan: 03
plan_id: "23-03"
type: execute
wave: 2
depends_on: ["23-01", "23-02"]
files_modified:
  - kinetica_bi/src/components/charts/InfoSelectionView.tsx
  - kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx
  - kinetica_bi/src/components/charts/InfoCardRenderer.tsx
  - kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx
  - kinetica_bi/src/components/charts/InfoPopup.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
  - kinetica_bi/src/components/charts/definitions/info-card.ts
  - kinetica_bi/src/components/charts/definitions/index.ts
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - CARD-V14-01
  - CARD-V14-02
  - CARD-V14-03
  - CARD-V14-04
must_haves:
  truths:
    - "Info Card chart type registered in chart-type registry — selectable from chart type picker"
    - "WidgetRenderer.tsx routes widget.type === 'info-card' to <InfoCardRenderer />"
    - "Info Card subscribes to useInfoSelectionStore + useDashboardLayersStore + useLastInfoClickContextStore via scoped selectors (PITFALL S-02)"
    - "Info Card eligibility = dashboard-scoped (s.layers.filter info_enabled === 1 && spatialMode !== 'wkb')"
    - "<InfoSelectionView /> on-demand fetch fires for both popup and card via useLastInfoClickContextStore replay"
    - "<InfoSelectionView /> Load-more fetch fires for both popup and card via useLastInfoClickContextStore replay"
    - "<InfoSelectionView /> short-circuits dropdown-switch fetch when context === null (Pitfall 2)"
    - "Info Card empty state literal copy 'Click a point on the map to see details' renders when activeLayerId === null OR state[activeLayerId] empty/missing OR layer ineligible"
    - "Info Card uses standard widget chrome — NO close X, NO ESC, NO ol/Overlay, NO popup-anchored chrome"
    - "AbortController for on-demand fetch lives inside <InfoSelectionView />; aborts on dropdown re-switch / Load-more re-click / unmount"
    - "Cross-phase column sort still applied (in InfoSelectionView only — Plan 23-01 location holds)"
    - "MapChartRenderer.tsx slimmed: handleLayerSwitch + handleLoadMore handlers REMOVED — moved into <InfoSelectionView />"
  artifacts:
    - path: "kinetica_bi/src/components/charts/InfoCardRenderer.tsx"
      provides: "Info Card renderer — wraps InfoSelectionView with widget chrome and dashboard-scoped eligibility"
      min_lines: 60
    - path: "kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx"
      provides: "Card-only spec: registry registration, dashboard-scoped eligibility, no popup chrome, empty state, WidgetRenderer routing"
      min_lines: 150
    - path: "kinetica_bi/src/components/charts/definitions/info-card.ts"
      provides: "Chart-type definition for info-card with locked metadata"
      contains: "registerChartType"
    - path: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      provides: "Now also owns on-demand fetch (handleLayerSwitch) + Load-more fetch (handleLoadMore) via useLastInfoClickContextStore replay"
      min_lines: 200
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "Third early-return branch for widget.type === 'info-card'"
      contains: "info-card"
  key_links:
    - from: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      to: "kinetica_bi/src/components/charts/InfoCardRenderer.tsx"
      via: "early-return JSX"
      pattern: "<InfoCardRenderer"
    - from: "kinetica_bi/src/components/charts/InfoCardRenderer.tsx"
      to: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      via: "JSX child"
      pattern: "<InfoSelectionView"
    - from: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      to: "kinetica_bi/src/store/lastInfoClickContextStore.ts"
      via: "scoped selector for replay"
      pattern: "useLastInfoClickContextStore"
    - from: "kinetica_bi/src/components/charts/InfoSelectionView.tsx"
      to: "kinetica_bi/src/api/client.ts"
      via: "infoQuery POST helper"
      pattern: "infoQuery"
    - from: "kinetica_bi/src/components/charts/definitions/index.ts"
      to: "kinetica_bi/src/components/charts/definitions/info-card.ts"
      via: "registerInfoCard() call inside registerAllChartTypes()"
      pattern: "registerInfoCard"
---

<objective>
Register a 9th chart type `info-card` in the chart-type registry. Create `<InfoCardRenderer />` that wraps `<InfoSelectionView />` with standard widget chrome and computes dashboard-scoped eligibility (`s.layers.filter(info_enabled === 1 && spatialMode !== 'wkb')`). Add a third early-return branch in `WidgetRenderer.tsx` for `widget.type === 'info-card'`. Move the on-demand fetch (`handleLayerSwitch`) and Load-more fetch (`handleLoadMore`) from `MapChartRenderer.tsx` INTO `<InfoSelectionView />` so both popup and card share the fetch path; both surfaces read spatial context from `useLastInfoClickContextStore` (Plan 23-02). The popup wrapper drops the `onLayerSwitch` / `onLoadMore` props it currently passes through (the view owns those handlers internally).

Purpose: Closes CARD-V14-01..04. The card is "popup mirrored in a widget" (locked at 23-CONTEXT.md). The shared fetch path inside `<InfoSelectionView />` is the design north star — single source of truth for dropdown-switch + Load-more behavior across both surfaces. The pure-consumer lock is RELAXED: card and popup both call POST /api/info/query, but only via the shared view; other widget types (bar/line/pie/scatter/table/records/bignumber/map) cannot fetch info-queries (the lock narrows from "card cannot fetch" to "only popup+card via view can fetch").

Output: A user can pick "Info Card" from the chart-type picker, place it on a dashboard, and see records populate after a map click. The card's in-widget dropdown switches layers (firing on-demand fetch using replayed coords); the Load-more button works identically. The empty state renders the verbatim ROADMAP copy when nothing is selected.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/23-info-card/23-CONTEXT.md
@.planning/phases/23-info-card/23-RESEARCH.md
@.planning/phases/23-info-card/23-01-extract-info-selection-view-SUMMARY.md
@.planning/phases/23-info-card/23-02-last-click-context-store-SUMMARY.md

@kinetica_bi/src/components/charts/InfoSelectionView.tsx
@kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx
@kinetica_bi/src/components/charts/InfoPopup.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/components/charts/registry.ts
@kinetica_bi/src/components/charts/definitions/index.ts
@kinetica_bi/src/components/charts/definitions/records.ts
@kinetica_bi/src/components/charts/definitions/map.ts
@kinetica_bi/src/store/lastInfoClickContextStore.ts
@kinetica_bi/src/store/infoSelectionStore.ts
@kinetica_bi/src/store/dashboardLayersStore.ts
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/lib/mapInfoConfig.ts

<interfaces>
<!-- Contracts the executor must respect. Extracted from existing codebase + Plan 23-01/23-02 outputs. -->

From kinetica_bi/src/components/charts/registry.ts (ChartTypeDefinition shape):
```typescript
export type ChartTypeDefinition = {
  type: string;
  label: string;
  icon: string;
  fields: ConfigField[];
  defaultConfig: Record<string, unknown>;
  CustomConfigPanel?: ComponentType<ConfigPanelProps>;
  usesAggregation?: boolean;
  supportsDrillDown?: boolean;
};

export function registerChartType(def: ChartTypeDefinition): void;
export function getChartType(type: string): ChartTypeDefinition | undefined;
export function getAllChartTypes(): ChartTypeDefinition[];
```

From kinetica_bi/src/components/charts/definitions/records.ts (closest precedent — read full file before writing info-card.ts).

From kinetica_bi/src/components/charts/definitions/index.ts (current barrel — add registerInfoCard import + call):
```typescript
import registerBar from "./bar";
import registerLine from "./line";
// ...
import registerRecords from "./records";

export function registerAllChartTypes() {
  registerBar();
  registerLine();
  // ...
  registerRecords();
  // Plan 23-03 ADD: registerInfoCard();
}
```

From kinetica_bi/src/components/charts/WidgetRenderer.tsx (current early-return; INSERT third branch):
```typescript
const WidgetRenderer = ({ widget, tables = [] }: WidgetRendererProps) => {
  if (widget.type === "map") {
    return <MapChartRenderer widget={widget} tables={tables} />;
  }
  if (widget.type === "records") {
    return <RecordsTableRenderer widget={widget} />;
  }
  // Plan 23-03 ADD: if (widget.type === "info-card") return <InfoCardRenderer widget={widget} tables={tables} />;
  return <AggregatedWidgetRenderer widget={widget} />;
};
```

From kinetica_bi/src/store/lastInfoClickContextStore.ts (Plan 23-02 output — read for type contract):
```typescript
export type LastInfoClickContext = {
  clickLon: number; clickLat: number;
  mapBbox: [number, number, number, number];
  mapWidthPx: number; mapHeightPx: number;
  radiusPx: number; sourceWidgetId: number;
};
```

From kinetica_bi/src/api/client.ts:
```typescript
export type InfoQueryRequest = { layerId, tableId, schema, table, spatialMode, spatialColumns, clickLon, clickLat, radiusPx, mapBbox, mapWidthPx, mapHeightPx, page };
export const infoQuery = async (args: InfoQueryRequest, signal?: AbortSignal): Promise<InfoQueryResponse>;
export type DashboardLayerDto = { id, dashboard_id, table_id, ..., info_enabled, info_columns, info_template, config };
export type TableDto = { id, schema, name, columns, ... };
export type WidgetDto = { id, type, config, ... };
```

From kinetica_bi/src/components/charts/MapChartRenderer.tsx (current handleLayerSwitch at lines 537-603 and handleLoadMore at lines 606-673 — these MOVE into InfoSelectionView in this plan; see Action steps below for the exact migration).

From the existing buildSpatialColumns helper used by MapChartRenderer.tsx (find via grep — it's local to MapChartRenderer.tsx). The card will need access to the same helper. Easiest path: extract `buildSpatialColumns` to a shared location (e.g., `kinetica_bi/src/lib/spatialColumns.ts`) OR re-derive inline in InfoSelectionView. Recommended: extract to a tiny shared module so both popup wrapper and view can use it. Verify the existing function signature before extracting.

NEW Props interface for `<InfoSelectionView />` (Plan 23-03 EXTENDS Plan 23-01's contract):
```typescript
type InfoSelectionViewProps = {
  eligibleLayers: DashboardLayerDto[];
  layerNameFor: (layer: DashboardLayerDto) => string;
  /** Caller resolves layer.table_id → schema/name for infoQuery payload. Popup builds from `tables` prop; card builds from `tables` prop. */
  resolveTable: (tableId: number) => { schema: string; name: string } | null;
  /** Empty state copy. Card passes 'Click a point on the map to see details'. Popup may pass 'No records' (kept identical to current popup empty state). */
  emptyStateCopy?: string;
  /** Called when active layer leaves eligibleLayers. Popup uses this for chrome dismiss; card uses it for store reset (which produces empty state). */
  onActiveLayerIneligible: () => void;
};
```

The view INTERNALLY:
- Subscribes to useInfoSelectionStore (activeLayerId + entry — scoped, PITFALL S-02).
- Subscribes to useLastInfoClickContextStore(s => s.context).
- Owns its own infoQueryAbortRef (useRef<AbortController | null>(null)).
- Owns handleLayerSwitch (dropdown switch) — fetches when state[newId] undefined AND context !== null; short-circuits when context === null (Pitfall 2 lock).
- Owns handleLoadMore — fetches with page = entry.page + 1 using replayed context; short-circuits when context === null.
- Owns the auto-eligibility-leave effect (calls onActiveLayerIneligible).
- Owns the cross-phase column sort (already moved in Plan 23-01).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Move handleLayerSwitch + handleLoadMore from MapChartRenderer.tsx INTO InfoSelectionView; extract buildSpatialColumns helper; popup drops onLayerSwitch/onLoadMore props (RED-GREEN: extend InfoSelectionView spec with on-demand fetch + Load-more + Pitfall 2 short-circuit cases)</name>
  <files>kinetica_bi/src/components/charts/InfoSelectionView.tsx, kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx, kinetica_bi/src/components/charts/InfoPopup.tsx, kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx, kinetica_bi/src/lib/spatialColumns.ts</files>
  <read_first>
    - kinetica_bi/src/components/charts/InfoSelectionView.tsx (Plan 23-01 output — current props + body structure)
    - kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx (Plan 23-01 output — V1-V16 tests; Task 1 ADDS V17-V21 for fetch path)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (handleLayerSwitch lines 537-603, handleLoadMore lines 606-673 — these relocate to InfoSelectionView)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (search for `buildSpatialColumns` — likely defined locally; record the signature for extraction)
    - kinetica_bi/src/components/charts/InfoPopup.tsx (Plan 23-01 slim wrapper — Task 1 drops the onLayerSwitch / onLoadMore props since the view owns them)
    - kinetica_bi/src/store/lastInfoClickContextStore.ts (Plan 23-02 output — context shape + selectors)
    - kinetica_bi/src/store/infoSelectionStore.ts (setActiveLayer signature is (number) NOT (number | null); reset() is the only path to null)
    - kinetica_bi/src/api/client.ts (infoQuery signature lines 686-700)
    - kinetica_bi/src/lib/mapInfoConfig.ts (getInfoEnabled + getInfoRadiusPx — radiusPx now comes from useLastInfoClickContextStore.context.radiusPx, not from widgetConfig directly, so the view does NOT need mapInfoConfig)
    - .planning/phases/23-info-card/23-RESEARCH.md § Pitfall 2 (lines 388-396), § Pitfall 6 (lines 446-454), § Code Examples handleLayerSwitch (lines 487-517)
  </read_first>
  <behavior>
    NEW spec cases in InfoSelectionView.spec.tsx (V17-V21):
    - Test V17 (handleLayerSwitch fetches with replayed coords): given useLastInfoClickContextStore.context = FIXTURE_CTX and useInfoSelectionStore.state[layerB] === undefined, simulating a dropdown change to layerB calls `infoQuery` ONCE with payload { layerId: layerB.id, tableId: layerB.table_id, schema: ..., table: ..., spatialMode: ..., spatialColumns: ..., clickLon: FIXTURE_CTX.clickLon, clickLat: FIXTURE_CTX.clickLat, mapBbox: FIXTURE_CTX.mapBbox, mapWidthPx: FIXTURE_CTX.mapWidthPx, mapHeightPx: FIXTURE_CTX.mapHeightPx, radiusPx: FIXTURE_CTX.radiusPx, page: 0 }. After resolution, store.state[layerB] is populated; activeLayerId is layerB.id.
    - Test V18 (Pitfall 2 short-circuit): given useLastInfoClickContextStore.context === null (no prior click), simulating a dropdown change to layerB calls `setActiveLayer(layerB.id)` (lightweight focus update) but does NOT fire `infoQuery`. Verify by spying on the infoQuery mock and asserting calls.length === 0.
    - Test V19 (handleLoadMore fetches with replayed coords): given useLastInfoClickContextStore.context = FIXTURE_CTX and active layer entry has hasMore=true and page=0, clicking Load more calls `infoQuery` ONCE with page=1 and the replayed coords. After resolution, store.state[activeLayerId].rows includes the appended page (assert via appendPage path).
    - Test V20 (Load more Pitfall 2 short-circuit): given context === null, clicking Load more does NOT fire `infoQuery` (calls.length === 0). The active layer entry remains unchanged.
    - Test V21 (AbortController on rapid switches): given context = FIXTURE_CTX, simulating two rapid dropdown changes (layerA → layerB → layerC) before either resolves, asserts the layerB controller was aborted (its .then callback returns early due to `signal.aborted`). Mirror the pattern from existing P11/P12 tests in MapChartRenderer.spec.tsx.

    InfoSelectionView signature change: drop `onLayerSwitch` and `onLoadMore` from props (the view owns them internally). Add `resolveTable: (tableId: number) => { schema: string; name: string } | null`.

    InfoPopup.tsx: drop `onLayerSwitch` + `onLoadMore` from its Props; pass `resolveTable` (built from `tables` prop) to `<InfoSelectionView />` instead.

    MapChartRenderer.tsx: delete `handleLayerSwitch` (lines 537-603) and `handleLoadMore` (lines 606-673) bodies. The popup wrapper at the JSX site (around line 836+) no longer receives those callback props — replace with `resolveTable` derived from `tables`. The click handler (Effect 6, lines 700-792) is UNCHANGED — it still owns the click-fan-out logic and writes to useLastInfoClickContextStore (Plan 23-02 already wired). The popup's existing click-handler integration test (P-tests) must still pass.

    MapChartRenderer.spec.tsx: P15 / P16 (handleLayerSwitch / handleLoadMore tests) DELETE — moved to InfoSelectionView.spec.tsx as V17-V21. Other POPUP-V14 tests (P1-P14, plus the new LCC tests added in Plan 23-02) stay.
  </behavior>
  <action>
    Step 1: Identify and extract `buildSpatialColumns`. Run `grep -n "buildSpatialColumns" kinetica_bi/src/components/charts/MapChartRenderer.tsx` to locate the function definition. Read its body. Create a new file `kinetica_bi/src/lib/spatialColumns.ts` with the extracted function. Example (verify exact signature against the existing implementation):

    ```ts
    /**
     * Phase 23 Plan 03: extracted from MapChartRenderer.tsx so both popup wrapper and
     * <InfoSelectionView /> can build the SpatialColumns argument for infoQuery.
     * Pure helper — no side effects, no store access.
     */
    import type { MapWidgetConfig } from "../api/client"; // adjust per actual export location
    import type { SpatialColumns } from "../api/client";  // adjust per actual export location

    export function buildSpatialColumns(cfg: Partial<MapWidgetConfig>): SpatialColumns | null {
      // EXACT BODY of the existing function in MapChartRenderer.tsx — copy verbatim
    }
    ```

    Update `MapChartRenderer.tsx` to import from the new module and delete the local definition. Run `cd kinetica_bi && npm test -- --run MapChartRenderer.spec` and `cd kinetica_bi && npx tsc --noEmit` to verify the extraction is behaviorally identical.

    Step 2: Update `kinetica_bi/src/components/charts/InfoSelectionView.tsx` to (a) drop `onLayerSwitch` + `onLoadMore` from Props, (b) add `resolveTable: (tableId: number) => { schema: string; name: string } | null`, (c) own the fetch logic internally. The new component shape:

    ```tsx
    import { useEffect, useMemo, useRef } from "react";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import { useLastInfoClickContextStore } from "../../store/lastInfoClickContextStore";
    import { renderInfoTemplate } from "../../lib/renderInfoTemplate";
    import { buildSpatialColumns } from "../../lib/spatialColumns";
    import { infoQuery, type InfoSpatialMode } from "../../api/client";
    import type { DashboardLayerDto, MapWidgetConfig } from "../../api/client";

    type Props = {
      eligibleLayers: DashboardLayerDto[];
      layerNameFor: (layer: DashboardLayerDto) => string;
      resolveTable: (tableId: number) => { schema: string; name: string } | null;
      emptyStateCopy?: string;
      onActiveLayerIneligible: () => void;
    };

    export default function InfoSelectionView({ eligibleLayers, layerNameFor, resolveTable, emptyStateCopy, onActiveLayerIneligible }: Props) {
      // PITFALL S-02 lock: scoped selectors. NEVER subscribe to s.state whole.
      const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
      const entry = useInfoSelectionStore((s) =>
        s.activeLayerId !== null ? s.state[s.activeLayerId] : null
      );
      const lastClickContext = useLastInfoClickContextStore((s) => s.context);
      const activeLayer = activeLayerId !== null
        ? eligibleLayers.find((l) => l.id === activeLayerId) ?? null
        : null;

      const infoQueryAbortRef = useRef<AbortController | null>(null);

      // Auto-callback when active layer leaves eligibleLayers (Plan 23-01 contract — unchanged).
      const eligibleIds = useMemo(
        () => new Set(eligibleLayers.map((l) => l.id)),
        [eligibleLayers]
      );
      useEffect(() => {
        if (activeLayerId !== null && !eligibleIds.has(activeLayerId)) {
          onActiveLayerIneligible();
        }
      }, [activeLayerId, eligibleIds, onActiveLayerIneligible]);

      // Cleanup AbortController on unmount.
      useEffect(() => {
        return () => {
          infoQueryAbortRef.current?.abort();
          infoQueryAbortRef.current = null;
        };
      }, []);

      // Plan 23-03: dropdown switch — fetch when state[newId] undefined AND context !== null.
      // Pitfall 2 lock: when context === null (no prior click), only update focus; do NOT fetch.
      const handleLayerSwitch = (newLayerId: number) => {
        const layer = eligibleLayers.find((l) => l.id === newLayerId);
        if (!layer) return;

        const store = useInfoSelectionStore.getState();

        // Pitfall 2: no prior click context — only update focus, do NOT fetch.
        if (lastClickContext === null) {
          store.setActiveLayer(newLayerId);
          return;
        }

        // Already-fetched layer: just switch focus, do NOT re-fetch (preserves data per Phase 20 layer-switch lock).
        if (store.state[newLayerId] !== undefined) {
          store.setActiveLayer(newLayerId);
          return;
        }

        const tableMeta = resolveTable(layer.table_id);
        if (!tableMeta) return;

        infoQueryAbortRef.current?.abort();
        const controller = new AbortController();
        infoQueryAbortRef.current = controller;

        store.setActiveLayer(newLayerId);
        store.setLoading(newLayerId, true);

        const cfg = layer.config as Partial<MapWidgetConfig>;
        const spatialColumns = buildSpatialColumns(cfg);
        if (!spatialColumns) {
          store.setLoading(newLayerId, false);
          return;
        }

        infoQuery({
          layerId: newLayerId,
          tableId: layer.table_id,
          schema: tableMeta.schema,
          table: tableMeta.name,
          spatialMode: cfg.spatialMode as InfoSpatialMode,
          spatialColumns,
          clickLon: lastClickContext.clickLon,
          clickLat: lastClickContext.clickLat,
          radiusPx: lastClickContext.radiusPx,
          mapBbox: lastClickContext.mapBbox,
          mapWidthPx: lastClickContext.mapWidthPx,
          mapHeightPx: lastClickContext.mapHeightPx,
          page: 0,
        }, controller.signal)
          .then((res) => {
            if (controller.signal.aborted) return;
            const s = useInfoSelectionStore.getState();
            s.setSelection(newLayerId, res);
            s.setLoading(newLayerId, false);
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            if ((err as { name?: string })?.name === "AbortError") return;
            const s = useInfoSelectionStore.getState();
            s.setError(newLayerId, "Failed to load layer");
            s.setLoading(newLayerId, false);
          });
      };

      // Plan 23-03: Load-more — fetch next page using replayed context.
      // Pitfall 2 lock: context === null short-circuits (no fetch).
      const handleLoadMore = () => {
        const store = useInfoSelectionStore.getState();
        const layerId = store.activeLayerId;
        if (layerId === null) return;
        const cur = store.state[layerId];
        if (!cur || !cur.hasMore || cur.loading) return;
        if (lastClickContext === null) return;  // Pitfall 2

        const layer = eligibleLayers.find((l) => l.id === layerId);
        if (!layer) return;
        const tableMeta = resolveTable(layer.table_id);
        if (!tableMeta) return;

        infoQueryAbortRef.current?.abort();
        const controller = new AbortController();
        infoQueryAbortRef.current = controller;
        store.setLoading(layerId, true);

        const cfg = layer.config as Partial<MapWidgetConfig>;
        const spatialColumns = buildSpatialColumns(cfg);
        if (!spatialColumns) {
          store.setLoading(layerId, false);
          return;
        }

        infoQuery({
          layerId,
          tableId: layer.table_id,
          schema: tableMeta.schema,
          table: tableMeta.name,
          spatialMode: cfg.spatialMode as InfoSpatialMode,
          spatialColumns,
          clickLon: lastClickContext.clickLon,
          clickLat: lastClickContext.clickLat,
          radiusPx: lastClickContext.radiusPx,
          mapBbox: lastClickContext.mapBbox,
          mapWidthPx: lastClickContext.mapWidthPx,
          mapHeightPx: lastClickContext.mapHeightPx,
          page: cur.page + 1,
        }, controller.signal)
          .then((res) => {
            if (controller.signal.aborted) return;
            const s = useInfoSelectionStore.getState();
            s.appendPage(layerId, { rows: res.rows, page: res.page, hasMore: res.hasMore });
            s.setLoading(layerId, false);
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            if ((err as { name?: string })?.name === "AbortError") return;
            const s = useInfoSelectionStore.getState();
            s.setError(layerId, "Failed to load more records");
            s.setLoading(layerId, false);
          });
      };

      // Empty state — single neutral copy across all variants. Plan 23-03 callers (popup + card) decide the copy.
      // Default to ROADMAP success criterion 4 verbatim if not overridden.
      const empty = emptyStateCopy ?? "Click a point on the map to see details";

      if (activeLayerId === null || activeLayer === null) {
        // Render-suppress completely OR show empty state — popup chrome wraps with anchored container
        // so when popup wrapper passes onActiveLayerIneligible = onClose, popup unmounts naturally.
        // Card wrapper renders this empty state inline. Either way, the view returns the empty body.
        // Per CARD-V14-04: card needs a visible empty state, so we render the empty placeholder
        // when activeLayerId === null. Popup wrapper short-circuits ABOVE this view (already does
        // in Plan 23-01 — popup returns null when activeLayerId === null), so this branch only
        // fires for the card.
        return <div className="info-selection-empty">{empty}</div>;
      }

      const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newId = Number(e.target.value);
        if (newId !== activeLayerId) handleLayerSwitch(newId);
      };

      return (
        <>
          <div className="info-selection-header">
            <select
              className="info-selection-layer-select"
              value={activeLayerId}
              onChange={handleDropdownChange}
              aria-label="Select layer"
            >
              {eligibleLayers.map((l) => (
                <option key={l.id} value={l.id}>
                  {layerNameFor(l)}
                </option>
              ))}
            </select>
          </div>
          <div className="info-selection-body">
            {entry?.loading && (entry.rows.length === 0) && (
              <div className="info-selection-loading">Loading…</div>
            )}
            {entry && !entry.loading && entry.rows.length === 0 && !entry.error && (
              <div className="info-selection-empty">{empty}</div>
            )}
            {entry?.error && entry.rows.length === 0 && (
              <div className="info-selection-error">{entry.error}</div>
            )}
            {entry && entry.rows.length > 0 && (
              <div className="info-selection-rows">
                {entry.rows.map((row, idx) => {
                  const sortedColumns = [...entry.columns].sort((a, b) => a.localeCompare(b));
                  const result = renderInfoTemplate({
                    template: activeLayer.info_template,
                    columns: sortedColumns,
                    row,
                    infoColumns: activeLayer.info_columns,
                  });
                  if (result.mode === "template") {
                    return (
                      <div
                        key={idx}
                        className="info-selection-row info-selection-row-template"
                        dangerouslySetInnerHTML={{ __html: result.html }}
                      />
                    );
                  }
                  return (
                    <table key={idx} className="info-selection-row info-selection-row-kv">
                      <tbody>
                        {result.pairs.map(({ col, value }) => (
                          <tr key={col}>
                            <th scope="row">{col}</th>
                            <td>{formatKvValue(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })}
              </div>
            )}
          </div>
          {entry?.hasMore && (
            <div className="info-selection-footer">
              <button
                className="info-selection-load-more"
                onClick={handleLoadMore}
                disabled={entry.loading}
              >
                {entry.loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      );
    }

    function formatKvValue(v: unknown): string {
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    }
    ```

    Step 3: Update `kinetica_bi/src/components/charts/InfoPopup.tsx` to drop `onLayerSwitch` + `onLoadMore` from its Props and pass `resolveTable` instead. The popup wrapper Props now:

    ```tsx
    type Props = {
      eligibleLayers: DashboardLayerDto[];
      layerNameFor: (layer: DashboardLayerDto) => string;
      resolveTable: (tableId: number) => { schema: string; name: string } | null;
      onClose: () => void;
    };
    ```

    The `<InfoSelectionView />` usage becomes:

    ```tsx
    <InfoSelectionView
      eligibleLayers={eligibleLayers}
      layerNameFor={layerNameFor}
      resolveTable={resolveTable}
      emptyStateCopy="No records"   // popup keeps its existing copy; card overrides with the ROADMAP copy
      onActiveLayerIneligible={onClose}
    />
    ```

    NOTE the popup-only "No records" copy — preserves the original popup empty-state behavior (B4 test). The card uses the default copy ("Click a point on the map to see details"). This is the cleanest way to honor both the existing popup spec assertion AND ROADMAP success criterion 4.

    The popup chrome (backdrop, close X, ESC effect) is unchanged from Plan 23-01.

    Step 4: Update `kinetica_bi/src/components/charts/MapChartRenderer.tsx`:
    - Delete the `handleLayerSwitch` callback (lines 537-603 currently).
    - Delete the `handleLoadMore` callback (lines 606-673 currently).
    - Find the JSX site where `<InfoPopup>` is rendered (around line 836+). Update the props passed:
      ```tsx
      <InfoPopup
        eligibleLayers={eligibleLayers}
        layerNameFor={layerNameFor}
        resolveTable={(tableId) => {
          const t = tables.find((tbl) => tbl.id === tableId);
          return t ? { schema: t.schema, name: t.name } : null;
        }}
        onClose={handleClose}
      />
      ```
    - The click handler (Effect 6, ~700-792) is UNCHANGED.
    - `infoQueryAbortRef` (line 250) is STILL used by the click-fan-out — DO NOT remove it. The view's own AbortController is independent.

    Step 5: Update `kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx`:
    - Update existing tests V1-V16 to match the new prop shape (drop `onLayerSwitch` + `onLoadMore` mocks; add `resolveTable` mock).
    - Tests V13/V14 (eligibility-leave) — props now use `onActiveLayerIneligible` callback (Plan 23-01 contract — unchanged).
    - Add NEW tests V17-V21 per `<behavior>` block above. Mock `infoQuery` from `../../api/client` (use `vi.mock`). Mock `useLastInfoClickContextStore` state via `useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX)` in beforeEach where applicable.
    - For test V18 / V20 (Pitfall 2 short-circuit): set context to null via `useLastInfoClickContextStore.getState().reset()` before the assertion.
    - For test V21 (AbortController on rapid switches): trigger two dropdown changes back-to-back (microtask boundary between them); assert the first promise's `.then` body returns early due to `signal.aborted` (verify by spying on store.setSelection — should NOT be called for the layerB attempt).

    Step 6: Update `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`:
    - Delete tests P15 (handleLayerSwitch) and P16 (handleLoadMore) from the POPUP-V14 block. They are now covered in V17-V21 in InfoSelectionView.spec.tsx.
    - Other POPUP-V14 tests (P1-P14, plus the new LCC1/LCC2 tests added in Plan 23-02) are unaffected.

    Run `cd kinetica_bi && npm test` — full suite must exit 0. `cd kinetica_bi && npx tsc --noEmit` must exit 0.

    Commit message: `refactor(23-03): move handleLayerSwitch + handleLoadMore from MapChartRenderer to InfoSelectionView; extract buildSpatialColumns (Phase 23 P03 Task 1)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run "InfoSelectionView.spec|InfoPopup.spec|MapChartRenderer.spec"</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/lib/spatialColumns.ts` exists with `export function buildSpatialColumns`
    - `grep "buildSpatialColumns" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns >=1 import line and ZERO local function-definition matches (function moved out)
    - `grep "buildSpatialColumns" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=1 match (view consumes the helper)
    - `grep "useLastInfoClickContextStore" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=2 matches (import + scoped selector)
    - `grep "infoQuery" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=2 matches (import + 2 call sites: dropdown switch + Load more)
    - `grep "infoQuery" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 1 match per the click-fan-out call site (handleLayerSwitch and handleLoadMore are gone; only the click-handler infoQuery loop remains — should still be present in Effect 6)
    - `grep -E "handleLayerSwitch|handleLoadMore" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ZERO matches (both handlers moved out)
    - `grep "onLayerSwitch\|onLoadMore" kinetica_bi/src/components/charts/InfoPopup.tsx` returns ZERO matches (popup wrapper no longer needs callbacks)
    - `grep "onLayerSwitch\|onLoadMore" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns ZERO matches (view owns handlers internally — no external callback exposed)
    - `grep "resolveTable" kinetica_bi/src/components/charts/InfoSelectionView.tsx` returns >=2 matches (prop + usage)
    - `grep -c "^  it(" kinetica_bi/src/components/charts/InfoSelectionView.spec.tsx` returns >=18 (V1-V16 minus 2 for prop-shape consolidation, plus V17-V21 = ~19)
    - `cd kinetica_bi && npm test -- --run "InfoSelectionView.spec|InfoPopup.spec|MapChartRenderer.spec"` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - Full regression: `cd kinetica_bi && npm test` exits 0
  </acceptance_criteria>
  <done>
    `<InfoSelectionView />` is the single source of truth for the on-demand fetch path (popup + card both use it via the same component). `MapChartRenderer.tsx` is slimmed: it owns ONLY the click-fan-out + setContext writes. `<InfoPopup />` is a chrome wrapper passing through `resolveTable` + `onClose`. AbortController for the on-demand fetch lives inside the view; aborts on rapid switches and unmount. Pitfall 2 short-circuit verified for both dropdown switch and Load more.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Register info-card chart type, create InfoCardRenderer, wire WidgetRenderer early-return; add CSS for widget-info-card outer container (RED-GREEN: InfoCardRenderer.spec.tsx covers registry + WidgetRenderer routing + dashboard-scoped eligibility + empty state + chrome-vs-popup separation + CARD-V14-01..04)</name>
  <files>kinetica_bi/src/components/charts/definitions/info-card.ts, kinetica_bi/src/components/charts/definitions/index.ts, kinetica_bi/src/components/charts/InfoCardRenderer.tsx, kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx, kinetica_bi/src/components/charts/WidgetRenderer.tsx, kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/charts/definitions/records.ts (closest precedent — read full file)
    - kinetica_bi/src/components/charts/definitions/map.ts (usesAggregation: false precedent)
    - kinetica_bi/src/components/charts/definitions/index.ts (current barrel; Plan 23-03 Task 2 ADDS one import + one call)
    - kinetica_bi/src/components/charts/registry.ts (full file — ChartTypeDefinition shape + getChartType helper for spec test)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (lines 195-213; Task 2 adds third early-return)
    - kinetica_bi/src/components/charts/InfoSelectionView.tsx (Task 1 output — read updated Props interface)
    - kinetica_bi/src/store/dashboardLayersStore.ts (s.layers selector + DashboardLayerDto shape)
    - kinetica_bi/src/api/client.ts (DashboardLayerDto / WidgetDto / TableDto / MapWidgetConfig types)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Pattern 3: Chart-type registration" (lines 277-312), § "Pattern 4: WidgetRenderer early-return" (lines 314-348), § Q4 dashboard-scoped eligibility (lines 744-805), § Q5 registration test (lines 807-835), § Q7.6 kill-switch (lines 924-928)
    - .planning/phases/23-info-card/23-CONTEXT.md § "Card identity & registry shape" (lines 44-55) — locked metadata values
  </read_first>
  <behavior>
    InfoCardRenderer.spec.tsx test cases (NEW):
    - Test C1 (CARD-V14-01 registry): after `registerAllChartTypes()`, `getChartType("info-card")` returns a definition with `label === "Info Card"`, `icon === "IC"`, `usesAggregation === false`, `supportsDrillDown === false`, `fields === []`, `defaultConfig === {}`, `CustomConfigPanel === undefined`.
    - Test C2 (WidgetRenderer routing — CARD-V14-01): rendering `<WidgetRenderer widget={...info-card widget...} tables={...} />` produces an `<InfoCardRenderer />` instance, NOT `<MapChartRenderer />` / `<RecordsTableRenderer />` / `<AggregatedWidgetRenderer />`. Verify by class name presence (`.widget-info-card`) or by mocking and asserting which component received the props.
    - Test C3 (CARD-V14-04 empty state — activeLayerId null): given `useInfoSelectionStore.getState().activeLayerId === null` (initial), `<InfoCardRenderer />` renders the verbatim copy `"Click a point on the map to see details"` and does NOT render the dropdown header / record list.
    - Test C4 (CARD-V14-04 empty state — entry undefined): given `activeLayerId !== null` but `state[activeLayerId] === undefined`, the card renders the empty-state copy.
    - Test C5 (CARD-V14-04 empty state — rows.length === 0): given a populated entry with `rows: []`, the card renders the empty-state copy (the empty branch in InfoSelectionView fires for both popup and card; verify the verbatim copy by rendering the card with `emptyStateCopy="Click a point on the map to see details"`).
    - Test C6 (CARD-V14-02 dashboard-scoped eligibility): given `useDashboardLayersStore.layers = [layer1 (info_enabled=1, latlon), layer2 (info_enabled=0, wkt), layer3 (info_enabled=1, wkb), layer4 (info_enabled=1, wkt)]`, the dropdown renders options for layer1 and layer4 ONLY (excluded: layer2 disabled; layer3 wkb).
    - Test C7 (CARD-V14-02 dashboard-scoped — independent of map widget visibility): given `useDashboardLayersStore.layers` contains layers from multiple map widgets (different position values), and one map widget has `includedLayerIds: [layer1.id]` while layer2 belongs to a different map widget, the card's dropdown still includes BOTH layer1 and layer2 (card eligibility ignores `includedLayerIds`). Mock setup: pre-populate `useDashboardLayersStore.layers` with two info-enabled non-WKB layers; the card renders both.
    - Test C8 (CARD-V14-03 template render parity): with active layer having `info_template = "<b>{name}</b>"` and a row `{name: "Bryant Park"}`, the card renders `<b>Bryant Park</b>` via `dangerouslySetInnerHTML` — same path as popup. Verify the rendered HTML matches.
    - Test C9 (CARD-V14-03 KV fallback parity): with active layer having `info_template = null` and a populated row, the card renders a KV table (`<table>` with `<th>` + `<td>` rows). Same path as popup.
    - Test C10 (no popup chrome): the card's rendered DOM does NOT contain `.info-popup-backdrop`, `.info-popup-close`, `.info-popup-overlay-element`. Verify by `container.querySelector` for each.
    - Test C11 (no ESC handler): pressing Escape in the document does NOT call any reset/close action attributable to the card (the card has no ESC effect). Verify by setting up `useInfoSelectionStore` with an active layer, dispatching keydown(Escape), then asserting `useInfoSelectionStore.getState().activeLayerId` is still set (the popup would reset on ESC; the card does not).
    - Test C12 (CARD-V14-04 layer-leaves-eligibility): given the card's eligibility set changes such that the active layer is removed (e.g., `info_enabled` flipped to 0), the card calls `useInfoSelectionStore.getState().reset()` (via `<InfoSelectionView />`'s `onActiveLayerIneligible`) and re-renders the empty state. Verify after the eligibility change: `activeLayerId === null` and the empty-state copy is visible.

    WidgetRenderer.spec.tsx (extension):
    - Test (NEW): rendering a widget with `widget.type === "info-card"` invokes `<InfoCardRenderer />` (assert by mock or by class-name).
  </behavior>
  <action>
    Step 1: Create `kinetica_bi/src/components/charts/definitions/info-card.ts`:

    ```ts
    import { registerChartType, type ChartTypeDefinition } from "../registry";

    /**
     * Phase 23 (CARD-V14-01): Info Card chart type definition.
     *
     * Card is a "popup mirrored in a widget" — locked design north star at
     * .planning/phases/23-info-card/23-CONTEXT.md § "Card identity & registry shape".
     *
     * No CustomConfigPanel — card has no per-widget configuration. The in-widget
     * dropdown (rendered by <InfoSelectionView />) is the user's only configuration
     * affordance. Empty fields, empty defaultConfig.
     *
     * supportsDrillDown: false — Phase 21 lock; info orthogonal to filter pipeline.
     * usesAggregation: false — card runs no SQL.
     */
    const infoCard: ChartTypeDefinition = {
      type: "info-card",
      label: "Info Card",
      icon: "IC",
      fields: [],
      defaultConfig: {},
      usesAggregation: false,
      supportsDrillDown: false,
    };

    export default function register() {
      registerChartType(infoCard);
    }
    ```

    Step 2: Update `kinetica_bi/src/components/charts/definitions/index.ts`:

    ```ts
    import registerBar from "./bar";
    import registerLine from "./line";
    import registerPie from "./pie";
    import registerScatter from "./scatter";
    import registerTable from "./table";
    import registerBigNumber from "./bignumber";
    import registerHeatmap from "./heatmap";
    import registerMap from "./map";
    import registerRecords from "./records";
    import registerInfoCard from "./info-card";  // NEW

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
      registerInfoCard();  // NEW
    }
    ```

    Step 3: Create `kinetica_bi/src/components/charts/InfoCardRenderer.tsx`:

    ```tsx
    /**
     * Phase 23 (CARD-V14-01..04): Info Card renderer — wraps <InfoSelectionView /> with widget chrome.
     *
     * Card is dashboard-scoped: dropdown lists ALL dashboard layers where info_enabled === 1
     * AND derived spatialMode !== "wkb" — independent of which map widget owns the layer or
     * whether any map currently has the layer visible (locked at 23-CONTEXT.md § "Layer subscription
     * contract & dropdown source").
     *
     * NO popup chrome (no anchored container, no close X, no ESC handler, no ol/Overlay).
     * Standard widget shell (drag handle, delete button) is provided by the dashboard widget grid
     * outside this component — InfoCardRenderer renders only the card body and outer wrapper class.
     *
     * Empty state copy: "Click a point on the map to see details" (ROADMAP.md verbatim — Success
     * Criterion 4). Single neutral copy across all empty/missing/error variants.
     *
     * The card does NOT initiate a fetch on mount. <InfoSelectionView /> waits for activeLayerId
     * to become non-null AND useLastInfoClickContextStore.context to become non-null before any
     * dropdown-switch can fire fetch (Pitfall 2 lock).
     */
    import { useMemo } from "react";
    import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import InfoSelectionView from "./InfoSelectionView";
    import type { DashboardLayerDto, MapWidgetConfig, WidgetDto, TableDto } from "../../api/client";

    type Props = {
      widget: WidgetDto;          // includes widget.id (informational); widget.config === {} per defaultConfig
      tables: TableDto[];          // resolved from WidgetRenderer prop pass-through
    };

    export default function InfoCardRenderer({ widget, tables }: Props) {
      // Dashboard-scoped eligibility — info_enabled === 1 AND spatialMode !== 'wkb'.
      // Sorted by position for stable dropdown order (matches popup's includedLayers order).
      const allLayers = useDashboardLayersStore((s) => s.layers);
      const eligibleLayers = useMemo<DashboardLayerDto[]>(() => {
        return allLayers
          .filter((layer) => {
            if (layer.info_enabled === 0) return false;
            const cfg = layer.config as Partial<MapWidgetConfig>;
            if (cfg.spatialMode === "wkb") return false;
            return true;
          })
          .slice()
          .sort((a, b) => a.position - b.position);
      }, [allLayers]);

      // Display-name resolver — matches popup's pattern at MapChartRenderer.tsx:218-224.
      const layerNameFor = (layer: DashboardLayerDto): string => {
        const t = tables.find((tbl) => tbl.id === layer.table_id);
        const tableName = t ? `${t.schema}.${t.name}` : "(unset table)";
        const renderMode = (layer.config as { renderMode?: string }).renderMode ?? "raster";
        return `${tableName} — ${renderMode}`;
      };

      // Table resolver for InfoSelectionView's on-demand fetch payload.
      const resolveTable = (tableId: number): { schema: string; name: string } | null => {
        const t = tables.find((tbl) => tbl.id === tableId);
        return t ? { schema: t.schema, name: t.name } : null;
      };

      // When active layer leaves eligibility: reset the store; the empty state renders naturally.
      // Single behavior, two surfaces — popup wraps with chrome dismiss; card just produces the empty state.
      const onActiveLayerIneligible = () => {
        useInfoSelectionStore.getState().reset();
      };

      return (
        <div className="widget-info-card" data-widget-id={widget.id}>
          <InfoSelectionView
            eligibleLayers={eligibleLayers}
            layerNameFor={layerNameFor}
            resolveTable={resolveTable}
            emptyStateCopy="Click a point on the map to see details"
            onActiveLayerIneligible={onActiveLayerIneligible}
          />
        </div>
      );
    }
    ```

    Step 4: Update `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — insert third early-return:

    ```tsx
    // existing imports + add InfoCardRenderer
    import InfoCardRenderer from "./InfoCardRenderer";

    const WidgetRenderer = ({ widget, tables = [] }: WidgetRendererProps) => {
      if (widget.type === "map") {
        return <MapChartRenderer widget={widget} tables={tables} />;
      }
      if (widget.type === "records") {
        return <RecordsTableRenderer widget={widget} />;
      }
      // Plan 23-03 (CARD-V14-01): info-card short-circuits BEFORE AggregatedWidgetRenderer
      // so it doesn't try to read widget.config.sql (info-card's defaultConfig is {}).
      if (widget.type === "info-card") {
        return <InfoCardRenderer widget={widget} tables={tables} />;
      }
      return <AggregatedWidgetRenderer widget={widget} />;
    };
    ```

    Step 5: Add CSS for `.widget-info-card` to `kinetica_bi/src/styles/global.css`. Place it in the body-styles area (around the existing `.info-selection-*` block — append a new rule at the end of that block, around line 2003+):

    ```css
    /* Plan 23-03: Info Card outer wrapper. The card uses standard widget chrome (drag/delete/title)
       provided by the dashboard widget grid OUTSIDE this component; .widget-info-card is the inner
       body container. Internal scroll on the records area is handled via .info-selection-body's
       existing overflow rules; sticky header + footer come from .info-selection-header / .info-selection-footer. */
    .widget-info-card {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    ```

    The `.info-selection-body` already has its own scroll behavior from Plan 23-01's CSS rename. If additional sticky-header / sticky-footer CSS is needed for the in-widget context (different from the popup's anchored context), add it inline alongside `.widget-info-card`. At the executor's discretion — the goal is "internal scroll, records fill body, sticky header + footer."

    Step 6: Create `kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx` with tests C1-C12 listed in `<behavior>`. Mock `infoQuery` from `../../api/client` where needed. Mock store state via `useInfoSelectionStore.getState().setSelection(...)` and `useDashboardLayersStore.getState().setLayers(...)` calls in `beforeEach` blocks (Zustand reset shim auto-clears between tests).

    For Test C1, structure the registration test as:
    ```tsx
    import { describe, it, expect } from "vitest";
    import { registerAllChartTypes } from "./definitions";
    import { getChartType } from "./registry";

    describe("InfoCard registry registration (CARD-V14-01)", () => {
      it("C1: getChartType('info-card') returns the locked definition", () => {
        registerAllChartTypes();
        const def = getChartType("info-card");
        expect(def).toBeDefined();
        expect(def?.label).toBe("Info Card");
        expect(def?.icon).toBe("IC");
        expect(def?.usesAggregation).toBe(false);
        expect(def?.supportsDrillDown).toBe(false);
        expect(def?.fields).toEqual([]);
        expect(def?.defaultConfig).toEqual({});
        expect(def?.CustomConfigPanel).toBeUndefined();
      });
    });
    ```

    Step 7: Update `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` to add a test that rendering a widget with `type: "info-card"` invokes `<InfoCardRenderer />`. Mock InfoCardRenderer if needed via `vi.mock("./InfoCardRenderer", ...)`.

    Run `cd kinetica_bi && npm test` — full suite must exit 0. `cd kinetica_bi && npx tsc --noEmit` must exit 0.

    Commit message: `feat(23-03): register info-card chart type; create InfoCardRenderer; wire WidgetRenderer (Phase 23 P03 Task 2)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run "InfoCardRenderer.spec|WidgetRenderer.spec|InfoSelectionView.spec"</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/definitions/info-card.ts` exists
    - `grep -E "type: \"info-card\"" kinetica_bi/src/components/charts/definitions/info-card.ts` returns >=1 match
    - `grep -E "label: \"Info Card\"" kinetica_bi/src/components/charts/definitions/info-card.ts` returns >=1 match
    - `grep -E "icon: \"IC\"" kinetica_bi/src/components/charts/definitions/info-card.ts` returns >=1 match
    - `grep "registerInfoCard" kinetica_bi/src/components/charts/definitions/index.ts` returns >=2 matches (import + call)
    - File `kinetica_bi/src/components/charts/InfoCardRenderer.tsx` exists
    - `grep "useDashboardLayersStore" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns >=1 match
    - `grep "info_enabled === 0\|info_enabled !== 1" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns >=1 match (eligibility filter present)
    - `grep -E "spatialMode === \"wkb\"" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns >=1 match (WKB exclusion)
    - `grep "InfoSelectionView" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns >=2 matches (import + JSX usage)
    - `grep "Click a point on the map to see details" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns >=1 match (verbatim ROADMAP empty-state copy)
    - `grep -E "info-popup-(backdrop|close|overlay)" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns ZERO matches (no popup chrome in card)
    - `grep "widget.type === \"info-card\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns >=1 match
    - `grep "InfoCardRenderer" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns >=2 matches (import + JSX usage)
    - File `kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx` exists
    - `grep -c "^  it(" kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx` returns >=10 (C1-C12; allow 2 to be merged)
    - `grep -E "\\.widget-info-card" kinetica_bi/src/styles/global.css` returns >=1 match
    - `cd kinetica_bi && npm test -- --run "InfoCardRenderer.spec|WidgetRenderer.spec|InfoSelectionView.spec"` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - Full regression: `cd kinetica_bi && npm test` exits 0
  </acceptance_criteria>
  <done>
    Chart-type picker shows "Info Card"; user creates a widget; WidgetRenderer routes to InfoCardRenderer; InfoCardRenderer reads dashboard-scoped layers + filters by info_enabled+non-WKB + sorts by position; passes eligibility to InfoSelectionView with the verbatim ROADMAP empty-state copy; popup behavior unchanged. Spec covers all four CARD-V14-01..04 requirements with concrete behavioral assertions.
  </done>
</task>

</tasks>

<verification>
- All four CARD-V14-* requirements demonstrably exercised by spec assertions in InfoCardRenderer.spec.tsx and InfoSelectionView.spec.tsx
- Frontend regression: `cd kinetica_bi && npm test` exits 0
- TypeScript: `cd kinetica_bi && npx tsc --noEmit` exits 0
- Single source of truth: only `<InfoSelectionView />` calls `infoQuery` for dropdown-switch + Load-more; popup wrapper and card wrapper both render `<InfoSelectionView />`
- Pure-consumer relaxation contained: `infoQuery` is imported by `MapChartRenderer.tsx` (click-fan-out) and `InfoSelectionView.tsx` (dropdown-switch + Load-more) — and NOWHERE ELSE. Verify with `grep -rn "infoQuery\b" kinetica_bi/src --include="*.tsx" --include="*.ts" | grep -v "client.ts" | grep -v ".spec."` returning only those two files plus possibly InfoSelectionView.spec.tsx mocks.
- Card has no popup chrome: `grep -rE "info-popup-(backdrop|close|overlay-element)" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns ZERO
- Card has no ESC effect: `grep "Escape\|keydown" kinetica_bi/src/components/charts/InfoCardRenderer.tsx` returns ZERO
</verification>

<success_criteria>
1. `info-card` chart type registered: `getChartType("info-card")` returns the locked definition (CARD-V14-01).
2. WidgetRenderer routes `widget.type === "info-card"` to `<InfoCardRenderer />` (CARD-V14-01).
3. Card's in-widget dropdown source = dashboard-scoped: `info_enabled === 1 && spatialMode !== "wkb"` predicate, sorted by position (CARD-V14-02).
4. Card's records render path identical to popup: same `renderInfoTemplate` helper, same `dangerouslySetInnerHTML` for template mode, same KV table for fallback (CARD-V14-03).
5. Card empty state renders the verbatim copy `"Click a point on the map to see details"` when `activeLayerId === null` OR `state[activeLayerId]` undefined OR `rows.length === 0` OR active layer leaves eligibility (CARD-V14-04).
6. `<InfoSelectionView />` owns on-demand fetch (handleLayerSwitch) + Load-more fetch (handleLoadMore) — both popup and card share. Pitfall 2 short-circuit verified for both.
7. AbortController for fetch lives in view; aborts on rapid switches and unmount.
8. `MapChartRenderer.tsx` slimmed: `handleLayerSwitch` and `handleLoadMore` deleted; click handler unchanged.
9. All specs GREEN; `tsc --noEmit` clean; full vitest suite passes.
</success_criteria>

<output>
After completion, create `.planning/phases/23-info-card/23-03-info-card-renderer-SUMMARY.md` capturing: registry registration assertion (chart-type metadata), WidgetRenderer routing assertion, dashboard-scoped vs map-scoped eligibility predicate verification, fetch-path migration (handleLayerSwitch + handleLoadMore line count moved from MapChartRenderer to InfoSelectionView), spec test count by file (InfoCardRenderer.spec / InfoSelectionView.spec / MapChartRenderer.spec), full vitest suite passing total, and any deviations from plan with rationale.
</output>
