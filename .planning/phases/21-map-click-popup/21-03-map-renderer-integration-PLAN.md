---
phase: 21-map-click-popup
plan: 03
type: execute
wave: 3
depends_on:
  - 21-01
  - 21-02
files_modified:
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - POPUP-V14-01
  - POPUP-V14-02
  - POPUP-V14-03
  - POPUP-V14-05
  - POPUP-V14-06
must_haves:
  truths:
    - "Map widget with infoEnabled=true registers an OL singleclick listener; widgetConfig.infoEnabled=false leaves the listener unregistered"
    - "Click on info-enabled map widget triggers a sequential per-layer POST /api/info/query fan-out in z-order ascending position"
    - "First layer that returns rows.length > 0 → setSelection + setActiveLayer + Overlay.setPosition(clickCoord); fan-out stops"
    - "All eligible layers errored or returned empty → toast 'No records within click radius' (all-empty) or 'Failed to fetch info for {N} layer(s)' (all-error); popup does NOT open"
    - "WKB layers (config.spatialMode === 'wkb') are filtered out of eligibleLayers BEFORE fan-out begins; no 501 ever reaches the user"
    - "Layers with info_enabled === 0 are filtered out of eligibleLayers"
    - "Re-click during in-flight fan-out aborts the prior AbortController, calls reset(), starts fresh fan-out at the new click point"
    - "Dropdown switch in popup triggers on-demand fetch via infoQuery (single-layer); reset of active layer resets pagination"
    - "Click-outside / ESC / close-X dismiss → reset() store + Overlay.setPosition(undefined) (hide)"
    - "Active layer leaving eligible set (visibility toggle, info_enabled=0, spatialMode→wkb) auto-dismisses via onClose path"
    - "OL Overlay element ref attached BEFORE map.addOverlay(); empty-deps Effect mounts overlay after map exists"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "Click handler + OL Overlay mount + fan-out logic + InfoPopup JSX render"
      contains: "import InfoPopup"
      contains: "ol/Overlay"
      contains: "infoQuery"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      provides: "Spec for kill switch, fan-out semantics, abort, dropdown switch, dismiss, WKB skip"
      contains: "POPUP-V14"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "InfoPopup component"
      via: "import + JSX render"
      pattern: "import InfoPopup"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "infoQuery client helper"
      via: "import from ../../api/client"
      pattern: "import.*infoQuery"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "useInfoSelectionStore"
      via: "imperative getState() in click handler + dropdown switch + dismiss"
      pattern: "useInfoSelectionStore.getState\\(\\)"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "ol/Overlay"
      via: "new Overlay({ element, autoPan: false, positioning })"
      pattern: 'new Overlay\\('
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "EPSG:3857 → EPSG:4326 click coord conversion"
      via: "ol/proj.transform"
      pattern: 'transform.*"EPSG:3857".*"EPSG:4326"'
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "kill switch (POPUP-V14-06)"
      via: "getInfoEnabled(widgetConfig) gates Effect listener registration"
      pattern: "getInfoEnabled"
---

<objective>
Wire the map click handler, the geo-anchored Overlay mount, and the sequential fan-out logic inside `MapChartRenderer.tsx`. This plan is the INTEGRATION step — it connects: (a) the InfoPopup component (Plan 21-02), (b) the infoQuery helper (Plan 21-02), (c) the renderInfoTemplate helper (indirectly via InfoPopup), (d) the Phase 19 kill-switch helpers (`getInfoEnabled` / `getInfoRadiusPx`), (e) the Phase 20 store (`useInfoSelectionStore` actions), (f) the Phase 18 endpoint, and (g) OpenLayers' `ol/Overlay` API.

Purpose: All three previous plans ship dormant or self-contained code. This plan is where the popup becomes user-visible. The locked decisions in 21-CONTEXT.md (sequential top-down fan-out, abort-on-re-click, WKB-skip, kill-switch-as-listener-gate, ol/Overlay positioning + manual edge-clamp) all converge here.

Output:
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — extended with: eligibleLayers memo, ol/Overlay mount Effect, singleclick handler Effect (gated by getInfoEnabled), fan-out helper, dropdown-switch handler, load-more handler, dismiss handler, InfoPopup JSX rendered inside the overlay element ref
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — extended with new describe block covering the kill switch, fan-out semantics, abort behavior, WKB skip, dismiss paths

Scope rules:
- Existing Effects 1-4 (map mount, layer reconcile, filter subscription, basemap swap) are NOT modified.
- This plan does NOT modify Phase 22 config UI (infoEnabled / infoRadiusPx / info_columns / info_template are read-only here).
- Keep MapChartRenderer.tsx under ~750 lines after edit — split into a sibling helper module if exceeded.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/21-map-click-popup/21-CONTEXT.md
@.planning/phases/21-map-click-popup/21-RESEARCH.md
@.planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md
@.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
@kinetica_bi/src/store/infoSelectionStore.ts
@kinetica_bi/src/lib/mapInfoConfig.ts
@kinetica_bi/src/api/client.ts

<interfaces>
<!-- Interfaces this plan composes. Executor uses these directly — no codebase exploration needed. -->

From kinetica_bi/src/lib/mapInfoConfig.ts (Phase 19 — already shipped):
```typescript
export const DEFAULT_INFO_ENABLED = true;
export const DEFAULT_INFO_RADIUS_PX = 20;
export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean;
export function getInfoRadiusPx(config: Pick<MapWidgetConfig, "infoRadiusPx">): number;
```

From kinetica_bi/src/api/client.ts (Plan 21-02 — produced by upstream wave + existing types):
```typescript
export type DashboardLayerDto = {
  id: number;
  table_id: number;
  position: number;
  config: Record<string, unknown>;  // contains spatialMode, latColumn, lonColumn, wktColumn, wkbColumn
  info_enabled: number;             // 0 | 1
  info_columns: string | null;
  info_template: string | null;
  ...
};
export type SpatialColumns = { lonCol?: string; latCol?: string; wktCol?: string; wkbCol?: string };
export type InfoSpatialMode = "latlon" | "wkt" | "wkb";
export type InfoQueryRequest = { layerId; tableId; schema; table; spatialMode; spatialColumns; clickLon; clickLat; radiusPx; mapBbox; mapWidthPx; mapHeightPx; page };
export type InfoQueryResponse = { rows; columns; hasMore; page; totalEstimate? };
export const infoQuery: (args: InfoQueryRequest, signal?: AbortSignal) => Promise<InfoQueryResponse>;
```

From kinetica_bi/src/store/infoSelectionStore.ts (Phase 20 — already shipped):
```typescript
useInfoSelectionStore.getState() returns InfoSelectionState with all 7 actions:
  setSelection(layerId, { rows, columns, page, hasMore })
  appendPage(layerId, { rows, page, hasMore })
  clearSelection(layerId)
  setActiveLayer(layerId)   // SIGNATURE: number — NOT number | null
  setLoading(layerId, loading)
  setError(layerId, error: string | null)
  reset()                    // ← dismiss path
```

From kinetica_bi/src/lib/wmsUrlBuilder.ts (existing):
```typescript
export type MapWidgetConfig = {
  tableId: number;
  spatialMode: SpatialMode;     // "latlon" | "wkt" | "wkb"
  latColumn?: string;
  lonColumn?: string;
  wktColumn?: string;
  wkbColumn?: string;
  ...
  infoEnabled?: boolean;        // POPUP-V14-06 kill switch
  infoRadiusPx?: number;        // click radius in px
};
```

From kinetica_bi/src/components/charts/InfoPopup.tsx (Plan 21-02 — produced by upstream wave):
```typescript
type Props = {
  eligibleLayers: DashboardLayerDto[];
  layerNameFor: (layer: DashboardLayerDto) => string;
  onClose: () => void;
  onLayerSwitch: (layerId: number) => void;
  onLoadMore: () => void;
};
export default function InfoPopup(props: Props): JSX.Element | null;
```

From kinetica_bi/src/components/charts/MapChartRenderer.tsx (existing — Effect 1, 2, 3, 4 ALL LEFT INTACT):
- Line 151: `export default function MapChartRenderer({ widget, tables = [] }: Props)`
- Line 156: `const allLayers = useDashboardLayersStore((s) => s.layers);`
- Line 162-174: `includedLayers` useMemo — visible layers sorted by position. PRE-EXISTING, REUSE.
- Line 201-202: `const containerRef = useRef<HTMLDivElement>(null);` — mount target
- Line 203: `const mapRef = useRef<OlMap | null>(null);` — OL map instance
- Line 261-312: Effect 1 (map mount) — DO NOT MODIFY; new Effect must run AFTER it
- Line 533-568: JSX — append InfoPopup mount inside a new div ref'd to the overlay element

OL `ol/Overlay` API (verified from RESEARCH.md § Pattern 1):
```typescript
import Overlay from "ol/Overlay";
const overlay = new Overlay({
  element: popupContainerRef.current,
  autoPan: false,           // manual edge-clamping; do NOT enable autoPan
  positioning: "bottom-left", // flipped dynamically based on click pixel proximity to widget edge
  offset: [0, -8],          // ~8-12px clearance above click pixel
});
map.addOverlay(overlay);
overlay.setPosition(event.coordinate);  // EPSG:3857 OL coord — show
overlay.setPosition(undefined);          // hide (does NOT remove from DOM)
map.removeOverlay(overlay);              // cleanup on unmount
```

OL `ol/proj.transform` (verified from RESEARCH.md § Pattern 1 + locked PITFALL M-03):
```typescript
import { transform } from "ol/proj";
const [clickLon, clickLat] = transform(
  event.coordinate,        // EPSG:3857 (OL view projection — locked)
  "EPSG:3857",
  "EPSG:4326"              // geographic degrees (server expects)
) as [number, number];
```
</interfaces>

<pitfalls>
<!-- Carry-forward from prior phases — non-negotiable. -->

- **PITFALL M-01 (Phase 11+):** mapRef guard prevents StrictMode double-construction. New Effects MUST check `if (!mapRef.current) return;` first.
- **PITFALL M-03 (Phase 11+):** OL View locked to EPSG:3857. Click coord conversion to EPSG:4326 is REQUIRED before sending to server (server uses geographic distance).
- **PITFALL S-02 (Phase 12+):** scoped selectors only. The MapChartRenderer integration code uses `useInfoSelectionStore.getState()` IMPERATIVELY (not via selectors) for click-handler / dropdown-switch / dismiss paths. The reactive selector ONLY lives inside InfoPopup (per Plan 21-02).
- **PITFALL Pitfall 7 (Phase 21 RESEARCH § Pitfall 7):** WKB layers MUST be filtered from eligibleLayers BEFORE fan-out. Otherwise endpoint returns 501 and surfaces as a "Failed to fetch" toast on every click. WKB-skip is NOT user-visible.
- **PITFALL Stale-async (Phase 21 RESEARCH § Pitfall 2):** Per-click AbortController; new click aborts prior. Dropdown switch ALSO aborts (the popup's on-demand fetch needs its own abort thread, conceptually distinct from the fan-out abort but using the same ref because there's only one outstanding info request at a time per widget).
- **No `setActiveLayer(null)` (locked Phase 20):** Type signature is `(layerId: number)`. Dismiss MUST call `reset()`.
- **No filter views (Phase 18 lock):** info-query reads source table directly. Do NOT pass `viewName` from `useFilterViewStore` into the request. Use `${tableMeta.schema}.${tableMeta.name}` raw.
- **Effect ordering vs StrictMode:** Effect 1 (map mount) is the ONLY effect that constructs the map. New Effects must guard with `if (!mapRef.current) return;`. In StrictMode dev, Effect 1's second invocation is a no-op (M-01); the new Overlay-mount Effect must handle map-already-exists by rebinding to `mapRef.current` if its own state is stale (typically via empty deps + ref-current check).
</pitfalls>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add eligibleLayers memo, infoQueryAbortRef, ol/Overlay mount Effect, and InfoPopup JSX</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (FULL FILE — needs accurate state for line-anchored edits)
    - kinetica_bi/src/lib/mapInfoConfig.ts (getInfoEnabled / getInfoRadiusPx signatures)
    - kinetica_bi/src/components/charts/InfoPopup.tsx (Plan 21-02 — Props type)
    - kinetica_bi/src/api/client.ts (infoQuery + types from Plan 21-02 + existing DashboardLayerDto / TableDto)
    - kinetica_bi/src/store/infoSelectionStore.ts (full action contract)
    - .planning/phases/21-map-click-popup/21-CONTEXT.md (§ Popup positioning + container; § Multi-layer fetch concurrency; § Click handler short-circuit; § Dismiss interactions)
    - .planning/phases/21-map-click-popup/21-RESEARCH.md (§ Pattern 1 OL Overlay; § Pattern 2 sequential fan-out; § Pattern 7 kill switch; § Pitfall 1 element-not-in-DOM; § Pitfall 6 mapRef.current guard)
  </read_first>
  <action>
    Modify `kinetica_bi/src/components/charts/MapChartRenderer.tsx` as follows. Each edit is line-anchored to the existing file. Read the file first to confirm current line numbers (line numbers below are approximate; use grep anchors for exact positioning).

    EDIT 1: Add imports near the top (after line 49 `import type { DashboardLayerDto } from "../../api/client";`).
    Insert:
    ```typescript
    import Overlay from "ol/Overlay";
    import { transform } from "ol/proj";
    import { infoQuery, type InfoSpatialMode, type SpatialColumns } from "../../api/client";
    import { useInfoSelectionStore } from "../../store/infoSelectionStore";
    import { getInfoEnabled, getInfoRadiusPx } from "../../lib/mapInfoConfig";
    import InfoPopup from "./InfoPopup";
    ```

    EDIT 2: After the existing `imageLayersRef` / `imageSourcesRef` / `lastEmittedParamsRef` block (around line 217), add new refs:
    ```typescript
    // ── Phase 21 Info Popup refs ─────────────────────────────────────────────
    // Empty container DIV mounted into ol/Overlay's `element` slot. We render the InfoPopup
    // React tree INTO this DIV via React portal-like pattern (the element is in the DOM
    // because it's part of the JSX below; Overlay just moves it into the OL DOM tree
    // imperatively). Pitfall 1 lock: the element must exist in the DOM BEFORE
    // `map.addOverlay()` — empty deps Effect (Effect 5) guards via `if (!popupContainerRef.current) return;`.
    const popupContainerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<Overlay | null>(null);
    // Per-click AbortController. Mirrors materializeAbortRef pattern from
    // AggregatedWidgetRenderer.tsx (V13-P-10 lock). Aborted on re-click, dropdown switch,
    // dismiss, and unmount.
    const infoQueryAbortRef = useRef<AbortController | null>(null);
    ```

    EDIT 3: After the `viewsKey` useMemo block (around line 198), add the eligibleLayers derivation:
    ```typescript
    // ── Phase 21 (POPUP-V14-02 / Pitfall 7): eligibleLayers — filtered subset of
    // includedLayers used for the info-popup fan-out + dropdown.
    //
    // Filters applied:
    //   1. layer.info_enabled === 0 → excluded (per-layer kill switch from Phase 19 schema)
    //   2. (layer.config as MapWidgetConfig).spatialMode === "wkb" → excluded
    //      Locked Phase 18 deferral: endpoint returns HTTP 501 for wkb mode. Including WKB
    //      layers in the fan-out would surface a "Failed to fetch" toast on every click
    //      (Pitfall 7). Behavior reverts automatically when TD-V14-WKB-SPIKE lands.
    // Sort order = ascending position (inherited from includedLayers).
    const eligibleLayers = useMemo<DashboardLayerDto[]>(() => {
      return includedLayers.filter((layer) => {
        if (layer.info_enabled === 0) return false;
        const cfg = layer.config as Partial<MapWidgetConfig>;
        if (cfg.spatialMode === "wkb") return false;
        return true;
      });
    }, [includedLayers]);

    // Display-name resolver passed as `layerNameFor` prop to InfoPopup. Mirrors LayersModal
    // auto-naming at LayersModal.tsx:82-99 — `{schema.name} — {renderMode}` form, or "(unset table)"
    // when the table isn't found in the dashboard's associated tables.
    const layerNameFor = useCallback((layer: DashboardLayerDto): string => {
      const t = tables.find((tbl) => tbl.id === layer.table_id);
      const tableName = t ? `${t.schema}.${t.name}` : "(unset table)";
      const renderMode = (layer.config as { renderMode?: string }).renderMode ?? "raster";
      return `${tableName} — ${renderMode}`;
    }, [tables]);
    ```

    EDIT 4: After Effect 4 (basemap swap, around line 518), add Effect 5 (ol/Overlay mount):
    ```typescript
    // ── Effect 5 (Phase 21 POPUP-V14-01): ol/Overlay mount/unmount ────────────
    // Mount once after Effect 1 has constructed the OL Map. The popup container DIV
    // (popupContainerRef) is rendered unconditionally in JSX so the ref is populated by
    // the time this Effect runs. Pitfall 1 lock: overlay element MUST be in DOM before
    // map.addOverlay().
    //
    // PITFALL M-01 lock: mapRef.current guard handles StrictMode's double-invocation.
    // Empty deps array — overlay lifetime matches the component lifetime.
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !popupContainerRef.current) return;
      const overlay = new Overlay({
        element: popupContainerRef.current,
        autoPan: false,            // manual edge-clamping (deferred polish; v1.4 ships without)
        positioning: "bottom-left",
        offset: [0, -8],
        stopEvent: true,           // prevent map drag/click while interacting with popup body
      });
      map.addOverlay(overlay);
      overlayRef.current = overlay;
      return () => {
        map.removeOverlay(overlay);
        overlayRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    ```

    EDIT 5: Replace the existing JSX (around line 533-568) so InfoPopup mounts INSIDE the popup container ref. The container is rendered unconditionally. Add at the END of the `<div className="widget-map">` block (after the tile-error overlay close):
    ```jsx
    {/* Phase 21 POPUP-V14-01: ol/Overlay element. Container always rendered so the ref is
        populated before Effect 5 runs (Pitfall 1 lock). InfoPopup itself returns null when
        activeLayerId is null, so the DOM tree is empty during dormancy. */}
    <div ref={popupContainerRef} className="info-popup-overlay-element">
      <InfoPopup
        eligibleLayers={eligibleLayers}
        layerNameFor={layerNameFor}
        onClose={handleDismiss}
        onLayerSwitch={handleLayerSwitch}
        onLoadMore={handleLoadMore}
      />
    </div>
    ```

    Add CSS class to global.css (append):
    ```css
    /* Phase 21: ol/Overlay's element wrapper. OL imperatively moves this element into its own
       DOM tree when map.addOverlay() runs. Width follows .info-popup; height auto. */
    .info-popup-overlay-element { width: 360px; pointer-events: auto; }
    ```

    Note: Effect 6 (singleclick handler) and the three handler callbacks (`handleDismiss`,
    `handleLayerSwitch`, `handleLoadMore`) are added in Task 2.

    Verify after this edit:
    - `cd kinetica_bi && npx tsc --noEmit` will FAIL because handleDismiss / handleLayerSwitch / handleLoadMore are undefined. This is expected; Task 2 adds them.
    - `cd kinetica_bi && npx eslint kinetica_bi/src/components/charts/MapChartRenderer.tsx` should warn about unused imports (transform, infoQuery) — also expected, resolved in Task 2.
    - File length stays under 700 lines (current ~570 + ~120 = ~690). Target: keep under 750.
  </action>
  <verify>
    <automated>grep -c "import Overlay from .ol/Overlay." kinetica_bi/src/components/charts/MapChartRenderer.tsx && grep -c "popupContainerRef" kinetica_bi/src/components/charts/MapChartRenderer.tsx && grep -c "eligibleLayers" kinetica_bi/src/components/charts/MapChartRenderer.tsx && grep -c "InfoPopup" kinetica_bi/src/components/charts/MapChartRenderer.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'import Overlay from "ol/Overlay"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c 'import { transform } from "ol/proj"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c 'import { infoQuery' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c 'import { useInfoSelectionStore } from "../../store/infoSelectionStore"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c 'import { getInfoEnabled, getInfoRadiusPx } from "../../lib/mapInfoConfig"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c 'import InfoPopup from "./InfoPopup"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1`
    - `grep -c "popupContainerRef" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `3` (decl + Effect 5 element + JSX ref)
    - `grep -c "overlayRef" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `3` (decl + assign + cleanup)
    - `grep -c "infoQueryAbortRef" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (declared; populated in Task 2)
    - `grep -c "eligibleLayers" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `3` (memo + InfoPopup prop + Effect 6 closure in Task 2)
    - `grep -c 'spatialMode === "wkb"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (WKB skip in eligibleLayers filter)
    - `grep -c "info_enabled === 0" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (per-layer kill switch in eligibleLayers)
    - `grep -c "new Overlay(" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (Effect 5 instantiation)
    - `grep -c "autoPan: false" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (locked positioning policy)
    - `grep -c "<InfoPopup" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `1` (single render site)
    - `grep -c "removeOverlay" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (Effect 5 cleanup)
    - File length: `wc -l kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns less than `750`
  </acceptance_criteria>
  <done>
    eligibleLayers correctly excludes WKB and info_enabled=0 layers. ol/Overlay is constructed once per map instance, attached to popupContainerRef.current, with `autoPan: false` and `stopEvent: true`. InfoPopup is mounted inside the overlay element. Refs declared for Effect 6 (Task 2). NOTE: `tsc --noEmit` will fail temporarily until Task 2 lands the handlers — this is expected.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement singleclick Effect (kill-switch-gated), fan-out fetch, dismiss + dropdown + load-more handlers, and spec coverage</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (after Task 1 edits — verify imports + refs + eligibleLayers + Effect 5 are in place)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (existing — extend with new POPUP-V14 describe block; mirror the existing Test A-J scaffolding for vi.mock state)
    - .planning/phases/21-map-click-popup/21-CONTEXT.md (§ Multi-layer fetch concurrency; § Loading + error UX; § Dismiss interactions; § Click handler short-circuit; § Click-to-radius pipeline)
    - .planning/phases/21-map-click-popup/21-RESEARCH.md (§ Pattern 2 sequential fan-out with AbortController; § Pattern 7 kill switch effect registration; § Pitfall 4 EPSG; § Pitfall 7 WKB skip)
    - kinetica_bi/src/components/charts/AggregatedWidgetRenderer.tsx (search for `materializeAbortRef` to study the per-click AbortController pattern — mirror it for `infoQueryAbortRef`)
    - kinetica_bi/server/src/index.ts:787-940 (full validation rules for the request body — payload must satisfy or get 400)
  </read_first>
  <behavior>
    Spec test cases (group under new `describe("POPUP-V14 — info popup integration", () => { ... })` in MapChartRenderer.spec.tsx):

    Kill switch (POPUP-V14-06):
    - Test P1: widgetConfig.infoEnabled=false → fan-out NEVER triggered on simulated singleclick (no infoQuery network mock invocation)
    - Test P2: widgetConfig.infoEnabled=true (default) → singleclick handler IS registered (assert via map.on spy seeing one call with "singleclick")
    - Test P3: widgetConfig.infoEnabled flips false → true → cleanup unregisters then re-registers (assert via map.un + map.on spy call sequence)

    Eligibility filtering (POPUP-V14-02 / Pitfall 7):
    - Test P4: 3 layers (latlon, wkt, wkb) → eligibleLayers passed to InfoPopup contains only the latlon + wkt layers; wkb is filtered out
    - Test P5: 3 layers (info_enabled=1, info_enabled=0, info_enabled=1) → eligibleLayers contains only the two with info_enabled=1
    - Test P6: 0 eligible layers (all wkb / all disabled) → singleclick triggers NO infoQuery call; no toast (because all-empty toast is gated on N>0 layers attempted)

    Sequential fan-out (POPUP-V14-01):
    - Test P7: 2 eligible layers; layer A returns rows.length=0, layer B returns rows.length=2 → both layers queried sequentially in z-order; setSelection called with layer B's payload; setActiveLayer(B); overlay.setPosition called with the click coord
    - Test P8: 2 eligible layers; layer A returns rows.length=3 (FIRST HIT) → fan-out STOPS after A; layer B is NEVER queried (network mock for B has 0 calls); setActiveLayer(A)
    - Test P9: 2 eligible layers; both return empty → showToast called with "No records within click radius" (kind: "info"); popup does NOT open (overlay.setPosition NOT called)
    - Test P10: 2 eligible layers; both throw (network error) → showToast with "Failed to fetch info for 2 layer(s)" (kind: "error"); popup does NOT open
    - Test P11: layer A throws, layer B returns rows.length=2 → layer A's error is silenced, B's hit opens popup; no error toast (resilient to flaky single-layer errors)

    Abort on re-click (POPUP-V14-01):
    - Test P12: simulate click 1 → during pending fetch, simulate click 2 → click 1's AbortController is aborted (signal.aborted=true at the moment click 2 fires); store.reset() called between clicks; click 2 starts fresh fan-out

    Coordinate conversion (Pitfall 4):
    - Test P13: simulate singleclick with event.coordinate=[X3857, Y3857] → infoQuery called with clickLon/clickLat in EPSG:4326 (geographic degrees) — assert via the request body args. Use a known coord pair (e.g., [-13627665, 4548000] EPSG:3857 → roughly [-122.4, 37.7] EPSG:4326).

    Dismiss (POPUP-V14-05):
    - Test P14: handleDismiss invoked (e.g., test calls it imperatively) → useInfoSelectionStore.getState().reset() is called; overlayRef.current.setPosition(undefined) is called; infoQueryAbortRef aborted
    - Test P15: dropdown switch (handleLayerSwitch(B) when current is A) → infoQueryAbortRef aborted; setActiveLayer(B); on-demand fetch sequence: setLoading(B,true) → infoQuery → setSelection(B) → setLoading(B,false)

    Load more (POPUP-V14-03 — popup-side; the integration touches it via the handler):
    - Test P16: handleLoadMore (with current activeLayerId=A, entry.page=0, entry.hasMore=true) → infoQuery called with page=1; appendPage(A, response) on success; setLoading flips false after

    Test scaffolding setup (mirror the existing module-level `_filterState` / `_layersState` / `_filterViewState` pattern at the top of MapChartRenderer.spec.tsx):
    - Mock `../../api/client` such that `infoQuery` is a vi.fn() per-test reset
    - Mock `../../store/toast` such that `useToastStore.getState().showToast` is a vi.fn()
    - Mock OL Map's singleclick + addOverlay/removeOverlay/setPosition where needed (likely extend existing OL Map mock at the top of the spec file)
  </behavior>
  <action>
    Modify `kinetica_bi/src/components/charts/MapChartRenderer.tsx` further (continuing from Task 1's state):

    EDIT 6: Add three handler callbacks BEFORE Effect 5 (so they're closure-stable for both Effect 5 and the new Effect 6). Place them after the eligibleLayers / layerNameFor block (added in Task 1):

    ```typescript
    // ── Phase 21 (POPUP-V14-05): dismiss handler ─────────────────────────────
    // All dismiss paths converge here: close X, ESC, click-outside, active-layer-leaves-set,
    // and new-click (the click handler calls handleDismiss imperatively before starting a
    // fresh fan-out — see Effect 6).
    const handleDismiss = useCallback(() => {
      // Abort any in-flight info request (fan-out OR on-demand fetch).
      infoQueryAbortRef.current?.abort();
      infoQueryAbortRef.current = null;
      // Reset store — wipes state[*] and activeLayerId. Phase 20 lock: dismiss MUST call
      // reset(), NEVER setActiveLayer(null) (signature is `(layerId: number)`).
      useInfoSelectionStore.getState().reset();
      // Hide overlay without removing it from the DOM. setPosition(undefined) is the
      // canonical OL toggle pattern (RESEARCH.md § Pattern 1).
      overlayRef.current?.setPosition(undefined);
    }, []);

    // ── Phase 21 (POPUP-V14-02 / STORE-V14-05): dropdown switch handler ───────
    // User picked a different layer from the popup dropdown. setActiveLayer(B) wipes
    // state[A] (Phase 20 lock); we then fetch the new layer on demand. The CONTEXT.md
    // observation that "every dropdown switch triggers an on-demand fetch" follows from
    // the wipe — state[B] is undefined after the switch.
    const handleLayerSwitch = useCallback((newLayerId: number) => {
      const layer = eligibleLayers.find((l) => l.id === newLayerId);
      if (!layer) return;
      const tableMeta = tables.find((t) => t.id === layer.table_id);
      if (!tableMeta) return;
      // Abort any in-flight info request — typically the prior fan-out OR a prior
      // on-demand fetch that's still in flight.
      infoQueryAbortRef.current?.abort();
      const controller = new AbortController();
      infoQueryAbortRef.current = controller;
      const store = useInfoSelectionStore.getState();
      store.setActiveLayer(newLayerId);  // wipes prior layer's entry per Phase 20 lock
      store.setLoading(newLayerId, true);

      // Read map context at switch time — popup may have been opened at a different zoom.
      const map = mapRef.current;
      const view = map?.getView();
      const size = map?.getSize();
      if (!map || !view || !size || !overlayRef.current) {
        store.setLoading(newLayerId, false);
        return;
      }
      const overlayCoord = overlayRef.current.getPosition();
      if (!overlayCoord) {
        store.setLoading(newLayerId, false);
        return;
      }
      const [clickLon, clickLat] = transform(
        overlayCoord as [number, number],
        "EPSG:3857",
        "EPSG:4326"
      ) as [number, number];
      const mapBbox = view.calculateExtent(size) as [number, number, number, number];

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
        clickLon,
        clickLat,
        radiusPx: getInfoRadiusPx(widgetConfig as MapWidgetConfig),
        mapBbox,
        mapWidthPx: size[0],
        mapHeightPx: size[1],
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
          if (err?.name === "AbortError") return;
          const s = useInfoSelectionStore.getState();
          s.setError(newLayerId, "Failed to load layer");
          s.setLoading(newLayerId, false);
        });
    }, [eligibleLayers, tables, widgetConfig]);

    // ── Phase 21 (POPUP-V14-03): load-more handler ───────────────────────────
    // Pagination append. setLoading toggles around the fetch. appendPage on success;
    // setError on failure (Phase 20 lock: setError preserves prior rows — existing pages
    // remain visible). Toast on failure mirrors CONTEXT.md § Loading + error UX.
    const handleLoadMore = useCallback(() => {
      const store = useInfoSelectionStore.getState();
      const layerId = store.activeLayerId;
      if (layerId === null) return;
      const entry = store.state[layerId];
      if (!entry || !entry.hasMore || entry.loading) return;

      const layer = eligibleLayers.find((l) => l.id === layerId);
      if (!layer) return;
      const tableMeta = tables.find((t) => t.id === layer.table_id);
      if (!tableMeta) return;

      // New AbortController for the page fetch. Fan-out controller (if still alive) is
      // aborted — ensures only one in-flight info request per widget.
      infoQueryAbortRef.current?.abort();
      const controller = new AbortController();
      infoQueryAbortRef.current = controller;
      store.setLoading(layerId, true);

      const map = mapRef.current;
      const view = map?.getView();
      const size = map?.getSize();
      const overlayCoord = overlayRef.current?.getPosition();
      if (!map || !view || !size || !overlayCoord) {
        store.setLoading(layerId, false);
        return;
      }
      const [clickLon, clickLat] = transform(
        overlayCoord as [number, number],
        "EPSG:3857",
        "EPSG:4326"
      ) as [number, number];
      const mapBbox = view.calculateExtent(size) as [number, number, number, number];
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
        clickLon,
        clickLat,
        radiusPx: getInfoRadiusPx(widgetConfig as MapWidgetConfig),
        mapBbox,
        mapWidthPx: size[0],
        mapHeightPx: size[1],
        page: entry.page + 1,
      }, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          const s = useInfoSelectionStore.getState();
          s.appendPage(layerId, { rows: res.rows, page: res.page, hasMore: res.hasMore });
          s.setLoading(layerId, false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err?.name === "AbortError") return;
          const s = useInfoSelectionStore.getState();
          s.setError(layerId, "Failed to load more records");
          s.setLoading(layerId, false);
          useToastStore.getState().showToast("Failed to load more records", "error");
        });
    }, [eligibleLayers, tables, widgetConfig]);

    // Pure helper: derive SpatialColumns request shape from the layer's MapWidgetConfig.
    // Returns null when the config is incomplete (caller should bail without firing a network call).
    function buildSpatialColumns(cfg: Partial<MapWidgetConfig>): SpatialColumns | null {
      if (cfg.spatialMode === "latlon") {
        if (!cfg.lonColumn || !cfg.latColumn) return null;
        return { lonCol: cfg.lonColumn, latCol: cfg.latColumn };
      }
      if (cfg.spatialMode === "wkt") {
        if (!cfg.wktColumn) return null;
        return { wktCol: cfg.wktColumn };
      }
      // 'wkb' is filtered upstream by eligibleLayers (Pitfall 7) — defensive return.
      return null;
    }
    ```

    EDIT 7: Add Effect 6 (singleclick handler — kill-switch-gated) AFTER Effect 5:

    ```typescript
    // ── Effect 6 (Phase 21 POPUP-V14-01 / V14-06): singleclick handler ────────
    // Kill switch lock: getInfoEnabled(widgetConfig) gates listener registration. When
    // false, the listener is NEVER attached (no click event triggers fan-out, no network,
    // no store mutation). When the flag flips, this Effect re-runs — cleanup unregisters
    // the prior listener, then re-registration occurs (or doesn't, depending on the new
    // flag value).
    //
    // Sequential fan-out: for each eligible layer in z-order, fire infoQuery. First layer
    // returning rows.length > 0 wins — popup opens with that layer focused, fan-out stops.
    // Per-layer error treated as empty (CONTEXT.md § Multi-layer fetch concurrency).
    // All-empty / all-error → toast; no popup chrome.
    //
    // PITFALL M-01: mapRef.current guard.
    // PITFALL M-03: EPSG:3857 → EPSG:4326 transform on click coord.
    // PITFALL Pitfall 7: eligibleLayers already excludes WKB layers.
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      if (!getInfoEnabled(widgetConfig as MapWidgetConfig)) return;  // POPUP-V14-06 kill switch

      const handler = async (event: { coordinate: [number, number] }) => {
        if (eligibleLayers.length === 0) return;

        // New click — abort prior, reset store, prepare fresh controller.
        infoQueryAbortRef.current?.abort();
        useInfoSelectionStore.getState().reset();
        overlayRef.current?.setPosition(undefined);
        const controller = new AbortController();
        infoQueryAbortRef.current = controller;

        const view = map.getView();
        const size = map.getSize();
        if (!size) return;
        const [clickLon, clickLat] = transform(
          event.coordinate,
          "EPSG:3857",
          "EPSG:4326"
        ) as [number, number];
        const mapBbox = view.calculateExtent(size) as [number, number, number, number];
        const radiusPx = getInfoRadiusPx(widgetConfig as MapWidgetConfig);

        let errorCount = 0;
        let firstHit = false;

        for (const layer of eligibleLayers) {
          if (controller.signal.aborted) return;

          const tableMeta = tables.find((t) => t.id === layer.table_id);
          if (!tableMeta) { errorCount++; continue; }
          const cfg = layer.config as Partial<MapWidgetConfig>;
          const spatialColumns = buildSpatialColumns(cfg);
          if (!spatialColumns) { errorCount++; continue; }

          useInfoSelectionStore.getState().setLoading(layer.id, true);
          try {
            const res = await infoQuery({
              layerId: layer.id,
              tableId: layer.table_id,
              schema: tableMeta.schema,
              table: tableMeta.name,
              spatialMode: cfg.spatialMode as InfoSpatialMode,
              spatialColumns,
              clickLon,
              clickLat,
              radiusPx,
              mapBbox,
              mapWidthPx: size[0],
              mapHeightPx: size[1],
              page: 0,
            }, controller.signal);
            if (controller.signal.aborted) return;
            useInfoSelectionStore.getState().setLoading(layer.id, false);

            if (res.rows.length > 0) {
              const s = useInfoSelectionStore.getState();
              s.setSelection(layer.id, res);
              s.setActiveLayer(layer.id);
              overlayRef.current?.setPosition(event.coordinate);
              firstHit = true;
              break;  // stop fan-out on first hit
            }
            // Empty layer → continue to next.
          } catch (err: unknown) {
            if (controller.signal.aborted) return;
            const e = err as { name?: string };
            if (e?.name === "AbortError") return;
            errorCount++;
            useInfoSelectionStore.getState().setLoading(layer.id, false);
            // Continue to next layer — per-layer errors are silenced during fan-out.
          }
        }

        if (!firstHit) {
          if (errorCount === eligibleLayers.length && errorCount > 0) {
            useToastStore.getState().showToast(
              `Failed to fetch info for ${errorCount} layer(s)`,
              "error"
            );
          } else {
            useToastStore.getState().showToast("No records within click radius", "info");
          }
        }
      };

      map.on("singleclick", handler as never);
      return () => {
        map.un("singleclick", handler as never);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]);
    ```

    EDIT 8: Add unmount cleanup for `infoQueryAbortRef` inside Effect 1's cleanup return (around line 300-310):
    Append after `imageSourcesRef.current.clear();`:
    ```typescript
    // Phase 21: abort any in-flight info request; clear ref.
    infoQueryAbortRef.current?.abort();
    infoQueryAbortRef.current = null;
    ```

    EDIT 9: Extend `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`. Add a new top-level describe block AFTER the existing tests:
    ```typescript
    describe("POPUP-V14 — info popup integration (Phase 21)", () => {
      // P1-P16 per <behavior> section
    });
    ```

    Mock setup additions (mirror the existing `_filterState` pattern at the top of the spec):
    - Add `_infoQueryMock = vi.fn(() => Promise.resolve({ rows: [], columns: [], hasMore: false, page: 0 }))`
    - Add `_toastMock = vi.fn()`
    - In vi.mock("../../api/client", ...): include `infoQuery: _infoQueryMock` alongside existing exports
    - In vi.mock("../../store/toast", ...): expose `useToastStore.getState().showToast: _toastMock`
    - Reset both mocks in beforeEach
    - Add per-OL-Map mock methods if not already present: `addOverlay: vi.fn()`, `removeOverlay: vi.fn()`, `getView: () => ({ calculateExtent: vi.fn(() => [0,0,100,100]) })`, `getSize: () => [800, 600]`

    Each test follows the existing scaffolding (render with widget+layers via shared module-level mutable state), simulates singleclick by manually invoking the handler captured by `map.on` spy, and asserts on `_infoQueryMock` call counts/args + `_toastMock` calls + store.getState() snapshots.

    Run:
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` — all green (existing + new POPUP-V14 block)
    - `cd kinetica_bi && npx tsc --noEmit` — exit 0
    - `cd kinetica_bi && npx vitest run` — full frontend suite green (no regressions in InfoPopup.spec / renderInfoTemplate.spec / client.spec)
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "handleDismiss" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2` (decl + JSX use)
    - `grep -c "handleLayerSwitch" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2`
    - `grep -c "handleLoadMore" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2`
    - `grep -c 'useInfoSelectionStore.getState().reset()' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2` (handleDismiss + click-handler new-click reset)
    - `grep -c 'setPosition(undefined)' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (overlay hide on dismiss)
    - `grep -c 'setPosition(event.coordinate)' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (overlay show on first hit)
    - `grep -c 'getInfoEnabled' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2` (Effect 6 guard + dep array)
    - `grep -c 'getInfoRadiusPx' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2` (handleLayerSwitch + handleLoadMore + click handler)
    - `grep -c 'map.on("singleclick"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1`
    - `grep -c 'map.un("singleclick"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1`
    - `grep -c 'transform.*"EPSG:3857".*"EPSG:4326"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2` (click handler + handleLayerSwitch — both convert)
    - `grep -c 'AbortController' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `3` (click handler + dropdown + load-more)
    - `grep -c 'controller.signal.aborted' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `4` (loop guard + post-await checks)
    - `grep -c 'showToast.*"No records within click radius"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1`
    - `grep -c 'showToast.*"Failed to fetch info' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1`
    - `grep -c "buildSpatialColumns" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `4` (decl + 3 callsites)
    - `grep -c "setActiveLayer(null)" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns `0` (forbidden — null path uses reset())
    - `grep -c 'page: 0' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `2` (fan-out + dropdown switch always start at page 0)
    - `grep -c 'page: entry.page + 1' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least `1` (load-more increments)
    - `grep -c 'POPUP-V14' kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns at least `1` (new describe block tagged)
    - Spec contains at least 16 NEW `it(` invocations in the POPUP-V14 describe block (P1-P16)
    - File length: `wc -l kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns less than `850`
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` exits 0 (existing tests + new POPUP-V14 block all green)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx vitest run src/lib/renderInfoTemplate.spec.ts src/components/charts/InfoPopup.spec.tsx src/api/client.spec.ts` exits 0 (no regressions in upstream Plan 21-01 / 21-02 specs)
  </acceptance_criteria>
  <done>
    Effect 6 registers `singleclick` only when `getInfoEnabled(widgetConfig)` is true. Sequential fan-out runs in z-order, stops on first hit, treats per-layer errors as empty, fires the correct toast on all-empty vs all-error. Re-click aborts the prior controller. Click coords transform from EPSG:3857 to EPSG:4326 before reaching the server. Dropdown switch fires on-demand single-layer fetch with page=0. Load more increments page via `entry.page + 1`. All dismiss paths route through `handleDismiss` → `reset()` + overlay hide. Spec coverage includes P1-P16 mirroring CONTEXT.md locked decisions.
  </done>
</task>

</tasks>

<verification>
1. `cd kinetica_bi && npx vitest run` — full frontend suite green (existing + new specs in this phase)
2. `cd kinetica_bi && npx tsc --noEmit` — exit 0
3. End-to-end smoke (manual or backend test invocation): map widget with `infoEnabled: true`, latlon layer with `info_enabled: 1` → click on a known data point → popup opens; click X → popup hides + store empty
4. `getInfoEnabled` is checked at listener registration (POPUP-V14-06) — verified by grep + spec P1
5. WKB layers are filtered out of eligibleLayers BEFORE fan-out (Pitfall 7) — verified by grep + spec P4
6. Aggregate file length: `wc -l kinetica_bi/src/components/charts/MapChartRenderer.tsx` ≤ 850
</verification>

<success_criteria>
- POPUP-V14-01: Map click triggers sequential per-layer infoQuery fan-out; first non-empty layer opens the popup at the click coord
- POPUP-V14-02: eligibleLayers passed to InfoPopup excludes WKB layers and info_enabled=0 layers; dropdown change calls handleLayerSwitch which fires on-demand fetch
- POPUP-V14-05: handleDismiss calls reset() + setPosition(undefined) + abort
- POPUP-V14-06: getInfoEnabled gates Effect 6 listener registration — listener is NOT registered when infoEnabled=false
- Re-click aborts the prior fan-out (per-click AbortController pattern, mirrors materializeAbortRef)
- Click coords are EPSG:4326 (geographic degrees) when sent to the server (Pitfall M-03)
- All-empty fan-out triggers info toast "No records within click radius"
- All-error fan-out triggers error toast "Failed to fetch info for {N} layer(s)"
- Pre-existing Effects 1-4 are unmodified (no regression in tile rendering / layer reconcile / filter sub / basemap swap)
</success_criteria>

<output>
After completion, create `.planning/phases/21-map-click-popup/21-03-map-renderer-integration-SUMMARY.md` documenting:
- Final line count of MapChartRenderer.tsx (target ≤ 850)
- Effect 5 mount + Effect 6 click-handler line ranges
- POPUP-V14 spec count (target ≥ 16)
- Confirmation that buildSpatialColumns is co-located in MapChartRenderer.tsx (vs extracted) — note rationale
- Confirmation that abort patterns mirror materializeAbortRef
- Any deviations (e.g., if executor extracted handlers into a sibling hook file due to line-count concerns)
- v1.4 phase-close handoff: Phase 22 (config-ui) is next; Phase 23 (Info Card) imports renderInfoTemplate from Plan 21-01
</output>
