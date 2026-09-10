---
phase: 35-widget-binding-and-pipeline
plan: 06
type: execute
wave: 3
depends_on:
  - "35-01"
  - "35-02"
  - "35-03"
files_modified:
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
  - kinetica_bi/src/components/LayersModal.tsx
  - kinetica_bi/src/components/LayersModal.spec.tsx
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - DV-V16-13
  - DV-V16-14
must_haves:
  truths:
    - "MapChartRenderer's Effect 2 (layer-stack reconciliation) and Effect 3 (per-layer subscription) BOTH compute a per-layer dynamicViewEntry + dynamicViewVersion and pass them to extended buildWmsParams (from Plan 35-02)"
    - "NEW dynamicViewsKey primitive selector mirrors viewsKey at MapChartRenderer.tsx:411-417 (research finding #6 / Pitfall 7) — added to Effect 2 + Effect 3 dep arrays so LAYERS-swap re-fires on dv store changes"
    - "When buildWmsParams returns null (dv non-materialized), the layer is OMITTED from the visible OL stack (no broken tile URL fired)"
    - "When at least one bound dynamic-view is over_threshold or error or pending, MapChartRenderer surfaces a 'Some layers over threshold' overlay (MapFilteringBadge-style)"
    - "LayersModal's KineticaWmsLayerForm gains a 'Data Source' picker section ABOVE the existing TABLE picker — same three-optgroup pattern as Plan 35-04's ChartConfigPanel"
    - "Picking a dynamic-view in KineticaWmsLayerForm PATCHes the layer with { dynamic_view_id: <id>, table_id: dv.source_table_id } — table_id stays NOT NULL = sourceTableId (research finding #4 lock)"
    - "Picking a plain table PATCHes with { dynamic_view_id: null, table_id: <selectedId> } — explicit null via 'key' in attrs discriminant (Plan 35-01 server contract)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "Per-layer dv lookup + dynamicViewsKey selector + buildWmsParams 4-case integration + layer-skip + over-threshold overlay"
      contains: "dynamicViewsKey"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx"
      provides: "Per-layer dv materialized/non-materialized + overlay + LAYERS-swap on dv store change"
      contains: "dynamic_view_id"
    - path: "kinetica_bi/src/components/LayersModal.tsx"
      provides: "dynamicViews prop pass-through to KineticaWmsLayerForm"
      contains: "dynamicViews"
    - path: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      provides: "Three-optgroup Data Source picker section + mutual-exclusion PATCH handler"
      contains: "Dynamic Views"
  key_links:
    - from: "MapChartRenderer Effect 2/3 per-layer iteration"
      to: "useDynamicViewStore.views[layer.dynamic_view_id]"
      via: "imperative getState() snapshot inside effect body"
      pattern: "dynamic_view_id"
    - from: "MapChartRenderer Effect 2/3 dep array"
      to: "dynamicViewsKey primitive selector"
      via: "Pitfall 7 lock"
      pattern: "dynamicViewsKey"
    - from: "buildWmsParams call site in MapChartRenderer"
      to: "extended 4-case precedence in wmsUrlBuilder (Plan 35-02)"
      via: "passes dynamicViewEntry + dynamicViewVersion args"
      pattern: "buildWmsParams\\("
    - from: "KineticaWmsLayerForm Data Source picker"
      to: "PATCH layer { dynamic_view_id, table_id }"
      via: "onPatch callback from LayersModal"
      pattern: "dynamic_view_id"
---

<objective>
Wire dynamic-view binding into the map widget at TWO levels:

1. **Render-time (MapChartRenderer):** For each layer with `dynamic_view_id !== null`, look up the entry in `useDynamicViewStore`, pass it to extended `buildWmsParams` (Plan 35-02), and either render the dv-named LAYERS=<dvViewName>+_mv=<dynamicViewVersion> (materialized) OR omit the layer from the visible stack (pending/over_threshold/error). When at least one bound layer is non-materialized, surface a "Some layers over threshold" overlay. Add a `dynamicViewsKey` primitive selector mirroring the existing `viewsKey` so Effect 2/3 re-fire on dv store changes (Pitfall 7 / research finding #6).

2. **Config-time (LayersModal/KineticaWmsLayerForm):** Add a "Data Source" picker section above the existing TABLE picker. Same three-optgroup pattern as Plan 35-04's ChartConfigPanel (Tables / Views / Dynamic Views). Selecting a dynamic-view PATCHes the layer with `{ dynamic_view_id: <dvId>, table_id: dv.source_table_id }` (keeps table_id = sourceTableId per research finding #4 — schema's NOT NULL constraint preserved without migration). Selecting a plain table PATCHes `{ dynamic_view_id: null, table_id: <newId> }`.

Purpose: Closes DV-V16-13 + DV-V16-14 for the map widget. The schema migration (Plan 35-01) + buildWmsParams precedence (Plan 35-02) + orchestrator (Plan 35-03) all converge here.

Output: Extended MapChartRenderer + LayersModal + KineticaWmsLayerForm + comprehensive specs + new "layers over threshold" overlay CSS.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md
@.planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
@kinetica_bi/src/components/LayersModal.tsx
@kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
@kinetica_bi/src/lib/wmsUrlBuilder.ts
@kinetica_bi/src/store/dynamicViewStore.ts
@kinetica_bi/src/api/client.ts

<interfaces>
<!-- Locked references from 35-RESEARCH.md §"Example 2", §"Example 3", §"Pitfall 7", §"Pitfall 8" -->

From kinetica_bi/src/components/charts/MapChartRenderer.tsx:
- viewsKey primitive selector at lines 411-417 (existing pattern Phase 35 mirrors)
- Effect 2 (layer-stack reconciliation, source/listener attach) at lines 776-879 — extend for per-layer dv lookup
- Effect 3 (per-layer subscription via updateParams) at lines 920-952 — extend for per-layer dv lookup + null layer skip
- Lines 826-834 (Effect 2): existing filter-view lookup via `useFilterViewStore.getState().views[tableId]` — Plan 35-06 adds parallel dv lookup
- Lines 942-948 (Effect 3): existing buildWmsParams call site — Plan 35-06 extends with new args
- `||` not `??` for `viewName || rawTableRef` substitution (anti-pattern lock at MapChartRenderer.tsx:833,942)

From Plan 35-02 (just shipped — kinetica_bi/src/lib/wmsUrlBuilder.ts):
```typescript
export type DynamicViewEntryInput = {
  status: "materialized" | "over_threshold" | "pending" | "error";
  viewName: string;
};

export function buildWmsParams(
  config: MapWidgetConfig,
  materializeVersion: number | undefined,
  dynamicViewEntry?: DynamicViewEntryInput,
  dynamicViewVersion?: number,
): Record<string, string> | null;
```

LOCKED dynamicViewsKey selector (35-RESEARCH.md §"Pitfall 7" verbatim):
```typescript
const dynamicViewsKey = useDynamicViewStore((s) =>
  includedLayers
    .filter((l) => l.dynamic_view_id !== null && l.dynamic_view_id !== undefined)
    .map((l) =>
      `${l.dynamic_view_id}:${s.views[l.dynamic_view_id!]?.viewName ?? ''}:${s.views[l.dynamic_view_id!]?.status ?? ''}`
    )
    .join(",")
);
// Add dynamicViewsKey to BOTH Effect 2 and Effect 3 dep arrays.
```

LOCKED per-layer lookup pattern (35-RESEARCH.md §"Example 2" verbatim):
```typescript
const dvEntry = layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
  ? useDynamicViewStore.getState().views[layer.dynamic_view_id]
  : undefined;
const dvVersion = layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
  ? useDynamicViewStore.getState().dynamicViewVersion
  : undefined;

const fvEntry = useFilterViewStore.getState().views[tableId];
const fvExpired = isViewExpired(fvEntry);
const fvViewName = !fvExpired ? fvEntry?.viewName : undefined;
const fvMaterializeVersion = !fvExpired ? fvEntry?.materializeVersion : undefined;

const wmsConfigInput = { ...cfg, tableId, tableRef: fvViewName || rawTableRef } as MapWidgetConfig;
const wmsParams = buildWmsParams(
  wmsConfigInput,
  fvMaterializeVersion,
  dvEntry !== undefined ? { status: dvEntry.status, viewName: dvEntry.viewName } : undefined,
  dvVersion,
);

if (wmsParams === null) {
  // Layer is dv-bound but non-materialized — skip from visible stack.
  // Track in a separate ref to surface "Some layers over threshold" overlay.
  continue;  // skip this layer's addLayer / updateParams
}
```

LOCKED KineticaWmsLayerForm "Data Source" section (35-RESEARCH.md §"Example 3" verbatim + research finding #4):
- Pick a dv → PATCH `{ dynamic_view_id: dvId, table_id: dv.source_table_id }`
- Pick a plain table → PATCH `{ dynamic_view_id: null, table_id: newTableId }` (explicit null via Plan 35-01's "key" in attrs discriminant)
- table_id stays NOT NULL (db.ts:87 lock — DO NOT relax)
- Same three-optgroup JSX as Plan 35-04
- LayersModal forwards `dynamicViews` prop (Plan 35-03 added it) to KineticaWmsLayerForm

Toast taxonomy lock: ToastKind = "permission" | "info" | "error" — no "warning". Over-threshold overlay is silent / inline visual; no toast fires.

Pitfall 8 lock: Map widget's ChartConfigPanel exclusion is HANDLED ELSEWHERE (Plan 35-04 preserves the existing usesDataSource: false guard). This plan only touches per-layer config in KineticaWmsLayerForm — that's the canonical site for map data-source binding.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend MapChartRenderer — per-layer dv lookup + dynamicViewsKey selector + extended buildWmsParams call + layer-skip + over-threshold overlay</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (FULL — viewsKey at 411-417; Effect 2 at 776-879; Effect 3 at 920-952; lookup patterns at 826-834 and 942)
    - kinetica_bi/src/lib/wmsUrlBuilder.ts (just-modified by Plan 35-02 — verify the new signature)
    - kinetica_bi/src/store/dynamicViewStore.ts (Phase 33 store contract)
    - kinetica_bi/src/components/MapFilteringBadge.tsx (existing overlay component — reuse pattern; verify its render shape)
    - kinetica_bi/src/styles/global.css (FULL — locate existing badge/overlay classes; new namespace .map-over-threshold-overlay)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"MapChart per-layer binding", §"buildWmsParams extension", §"MapChartRenderer status surfacing")
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Pitfall 7" verbatim selector; §"Example 2" caller integration; §"Open Question 1" overlay surfacing)
  </read_first>
  <behavior>
    Implementation behaviors enforced by Task 2 spec:

    - `dynamicViewsKey` primitive selector mirrors `viewsKey` exactly (research §"Pitfall 7" verbatim)
    - Effect 2 dep array includes `dynamicViewsKey` (so re-fires on dv store changes)
    - Effect 3 dep array includes `dynamicViewsKey` (same reason)
    - Effect 2 + Effect 3 bodies compute per-layer dvEntry + dvVersion before calling buildWmsParams
    - When buildWmsParams returns null, layer is OMITTED (continue/skip in the loop; ref tracker records the layer index for overlay)
    - When at least one bound layer is non-materialized, a "Some layers over threshold" overlay renders in MapChartRenderer's JSX body
    - Existing v1.3 filter-view path unchanged for layers WITHOUT dynamic_view_id
  </behavior>
  <action>
    **1. Add `dynamicViewsKey` primitive selector** (mirror viewsKey at lines 411-417):

    Locate the existing `viewsKey` selector in MapChartRenderer.tsx. Add the parallel dynamicViewsKey BELOW it:

    ```typescript
    // EXISTING viewsKey at lines 411-417 (filter-view path) — UNCHANGED:
    const viewsKey = useFilterViewStore((s) =>
      includedLayers
        .map((l) => `${l.table_id}:${s.views[l.table_id]?.viewName ?? ''}:${s.views[l.table_id]?.materializeVersion ?? 0}`)
        .join(",")
    );

    // NEW Phase 35 (DV-V16-13) — Pitfall 7 fix: dynamic-view-bound layers need their own primitive key
    // so Effects 2 + 3 re-fire when a dv re-materializes (filter-view path's viewsKey doesn't move).
    const dynamicViewsKey = useDynamicViewStore((s) =>
      includedLayers
        .filter((l) => l.dynamic_view_id !== null && l.dynamic_view_id !== undefined)
        .map((l) =>
          `${l.dynamic_view_id}:${s.views[l.dynamic_view_id!]?.viewName ?? ''}:${s.views[l.dynamic_view_id!]?.status ?? ''}`
        )
        .join(",")
    );
    ```

    **2. Track over-threshold layer indices in a ref (for overlay surfacing):**

    Add near the top of MapChartRenderer body, beside existing refs:

    ```typescript
    const overThresholdLayerCountRef = useRef<number>(0);
    const [hasOverThresholdLayers, setHasOverThresholdLayers] = useState(false);
    ```

    **3. Extend Effect 2 (layer-stack reconciliation) at lines 776-879:**

    Find the existing layer iteration. For each layer, BEFORE the existing filter-view lookup, add the per-layer dv lookup AND call the extended buildWmsParams:

    ```typescript
    useEffect(() => {
      // ... existing setup ...

      let overThresholdCount = 0;

      for (const layer of includedLayers) {
        const cfg = layer.config as MapWidgetConfig;
        const tableId = layer.table_id;
        const rawTableRef = /* existing computation */;

        // NEW Phase 35 (DV-V16-13): per-layer dv lookup BEFORE buildWmsParams call.
        const dvEntry =
          layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
            ? useDynamicViewStore.getState().views[layer.dynamic_view_id]
            : undefined;
        const dvVersion =
          layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
            ? useDynamicViewStore.getState().dynamicViewVersion
            : undefined;

        // EXISTING filter-view lookup (unchanged for non-dv layers; ignored when dv-bound + materialized)
        const fvEntry = useFilterViewStore.getState().views[tableId];
        const fvExpired = isViewExpired(fvEntry);
        const fvViewName = !fvExpired ? fvEntry?.viewName : undefined;
        const fvMaterializeVersion = !fvExpired ? fvEntry?.materializeVersion : undefined;

        // Use || (NOT ??) — Pitfall lock at MapChartRenderer.tsx:833 + Plan 35-02 reminder
        const wmsConfigInput = { ...cfg, tableId, tableRef: fvViewName || rawTableRef } as MapWidgetConfig;

        const wmsParams = buildWmsParams(
          wmsConfigInput,
          fvMaterializeVersion,
          dvEntry !== undefined ? { status: dvEntry.status, viewName: dvEntry.viewName } : undefined,
          dvVersion,
        );

        // NEW Phase 35: buildWmsParams returns null for dv-bound + non-materialized — skip the layer
        if (wmsParams === null) {
          overThresholdCount += 1;
          // Existing OL layer for this id (if any) should be removed/hidden from the stack.
          // OPTION (locked simple): also remove from the OL Map's layers collection here if it was added.
          const existingOlLayer = olLayersRef.current?.get(layer.id);
          if (existingOlLayer) {
            mapInstance.removeLayer(existingOlLayer);
            olLayersRef.current.delete(layer.id);
          }
          continue;  // do NOT add/update visible layer
        }

        // ... existing addLayer / source attach / listener wiring path — UNCHANGED ...
      }

      // Update overlay state ONCE after the loop completes.
      const newHas = overThresholdCount > 0;
      overThresholdLayerCountRef.current = overThresholdCount;
      setHasOverThresholdLayers((prev) => prev === newHas ? prev : newHas);

      // EXTENDED dep array — add dynamicViewsKey (Pitfall 7)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterVersion, viewsKey, dynamicViewsKey, includedLayers, tables]);
    ```

    **4. Extend Effect 3 (per-layer subscription via updateParams) at lines 920-952:**

    Mirror the Effect 2 pattern. For each layer, compute dvEntry + dvVersion, call extended `buildWmsParams`, and if null → skip updateParams for that layer.

    ```typescript
    useEffect(() => {
      for (const layer of includedLayers) {
        const cfg = layer.config as MapWidgetConfig;
        const tableId = layer.table_id;
        const rawTableRef = /* existing */;

        const dvEntry =
          layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
            ? useDynamicViewStore.getState().views[layer.dynamic_view_id]
            : undefined;
        const dvVersion =
          layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined
            ? useDynamicViewStore.getState().dynamicViewVersion
            : undefined;

        const fvEntry = useFilterViewStore.getState().views[tableId];
        const fvExpired = isViewExpired(fvEntry);
        const fvViewName = !fvExpired ? fvEntry?.viewName : undefined;
        const fvMaterializeVersion = !fvExpired ? fvEntry?.materializeVersion : undefined;

        const wmsConfigInput = { ...cfg, tableId, tableRef: fvViewName || rawTableRef } as MapWidgetConfig;
        const wmsParams = buildWmsParams(
          wmsConfigInput,
          fvMaterializeVersion,
          dvEntry !== undefined ? { status: dvEntry.status, viewName: dvEntry.viewName } : undefined,
          dvVersion,
        );

        if (wmsParams === null) {
          continue;  // dv-bound + non-materialized → no updateParams (layer is omitted from stack by Effect 2)
        }

        // EXISTING updateParams call — unchanged
        const source = olLayersRef.current?.get(layer.id)?.getSource();
        source?.updateParams(wmsParams);
      }

      // EXTENDED dep array — add dynamicViewsKey
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterVersion, viewsKey, dynamicViewsKey, includedLayers, tables]);
    ```

    **5. Add "Some layers over threshold" overlay** in MapChartRenderer's JSX:

    Locate the existing render body (probably renders a div with map + MapFilteringBadge). Add a new overlay element when `hasOverThresholdLayers` is true:

    ```tsx
    return (
      <div className="map-chart-container">
        {/* existing map mount div + existing MapFilteringBadge if present */}
        <div ref={mapDivRef} className="map-chart-mount" />

        {hasOverThresholdLayers && (
          <div className="map-over-threshold-overlay" role="status" aria-live="polite">
            <span>Some layers over threshold</span>
          </div>
        )}

        {/* ... existing existing badges ... */}
      </div>
    );
    ```

    **6. Add CSS in `kinetica_bi/src/styles/global.css`:**

    ```css
    /* Phase 35 (DV-V16-13/14): map per-layer over-threshold overlay */
    .map-over-threshold-overlay {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 6px 12px;
      background: rgba(255, 248, 220, 0.95);   /* subtle warning-yellow */
      border: 1px solid #d4a017;
      border-radius: 4px;
      color: #6b5300;
      font-size: 13px;
      z-index: 100;
      pointer-events: none;
    }
    .map-over-threshold-overlay::before {
      content: "⚠ ";
    }
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "dynamicViewsKey" kinetica_bi/src/components/charts/MapChartRenderer.tsx` (Pitfall 7 fix present)
    - `grep -c "dynamicViewsKey" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns ≥ 3 (definition + Effect 2 dep + Effect 3 dep)
    - `grep -q "useDynamicViewStore.getState" kinetica_bi/src/components/charts/MapChartRenderer.tsx` (per-layer lookup)
    - `grep -q "wmsParams === null" kinetica_bi/src/components/charts/MapChartRenderer.tsx` (layer-skip branch)
    - `grep -q "Some layers over threshold" kinetica_bi/src/components/charts/MapChartRenderer.tsx` (overlay)
    - `grep -q ".map-over-threshold-overlay" kinetica_bi/src/styles/global.css`
    - `grep -q "layer.dynamic_view_id" kinetica_bi/src/components/charts/MapChartRenderer.tsx`
    - `! grep -q "viewName ?? rawTableRef" kinetica_bi/src/components/charts/MapChartRenderer.tsx` (anti-pattern — must use ||)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - dynamicViewsKey primitive selector added; both Effects 2 + 3 dep arrays include it
    - Per-layer dv lookup + extended buildWmsParams call in both Effect 2 + Effect 3
    - Layer skip (continue) when buildWmsParams returns null
    - Over-threshold overlay surfaces when any bound layer is non-materialized
    - CSS namespace added
    - No `??` substitution anywhere — `||` everywhere for viewName fallbacks (Pitfall 4 lock)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MapChartRenderer.spec.tsx — per-layer dv materialized/non-materialized + overlay + dv store change re-fires LAYERS-swap</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (FULL — existing test fixtures + spy patterns for OL map mocks)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (just-modified)
  </read_first>
  <behavior>
    - Test 1: Layer with `dynamic_view_id: 7` + store entry `{ viewName: "_kbi_dv_x", status: "materialized" }` → OL layer is added with WMS params containing `LAYERS=_kbi_dv_x` AND `_mv=<dynamicViewVersion>`.
    - Test 2: Layer with `dynamic_view_id: 7` + store entry `{ status: "pending" }` → OL layer is NOT in the visible stack; "Some layers over threshold" overlay renders.
    - Test 3: Layer with `dynamic_view_id: 7` + store entry `{ status: "over_threshold" }` → OL layer omitted; overlay renders.
    - Test 4: Layer with `dynamic_view_id: 7` + store entry `{ status: "error" }` → OL layer omitted; overlay renders.
    - Test 5: Layer with `dynamic_view_id: null` (plain table-bound, no dv) → existing filter-view path; layer renders normally with LAYERS=<filter-view-name>. No overlay.
    - Test 6: Mix of one materialized dv layer + one table-bound layer → both render; no overlay.
    - Test 7: Initial state pending → orchestrator (mocked) transitions store to materialized → OL layer's `updateParams` is called with new LAYERS=<dvViewName>. Verifies dynamicViewsKey re-fires Effect 3.
    - Test 8: dvVersion bump (store mutation) → `updateParams` is called with new `_mv` value (cache-buster).
  </behavior>
  <action>
    Open `MapChartRenderer.spec.tsx`. Add a new `describe` block "Phase 35 per-layer dynamic-view binding (DV-V16-13/14)" at the end.

    The existing MapChartRenderer spec likely mocks OL `Map`, `ImageWMS`, layer add/remove, etc. Mirror the existing mock setup. For each test, render the component with a fixture set of layers and assert via the OL spy.

    Pseudocode for Test 1:

    ```typescript
    it("layer with dynamic_view_id + materialized → WMS params have LAYERS=<dvViewName> + _mv=<dynamicViewVersion>", async () => {
      // Setup store state
      useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: 9999,
      });
      const currentDvVersion = useDynamicViewStore.getState().dynamicViewVersion;

      const layers: DashboardLayerDto[] = [
        { id: 1, dashboard_id: 1, table_id: 4, layer_type: "KineticaWms", position: 0, config: { /* min */ },
          info_enabled: 1, info_columns: null, info_template: null,
          dynamic_view_id: 7,
          created_at: "x", updated_at: "x" },
      ];

      render(<MapChartRenderer layers={layers} /* other props */ />);

      await waitFor(() => {
        // Inspect the OL ImageWMS spy or wherever the WMS params get applied
        const paramsApplied = imageWmsConstructorSpy.mock.calls[0][0].params;
        expect(paramsApplied.LAYERS).toBe("_kbi_dv_u1_d1_7");
        expect(paramsApplied._mv).toBe(String(currentDvVersion));
      });
    });
    ```

    For Test 2 / 3 / 4 (non-materialized → layer omitted + overlay):

    ```typescript
    it("layer with dynamic_view_id + pending → layer NOT added; overlay 'Some layers over threshold' renders", async () => {
      useDynamicViewStore.getState().markPending(7, "_kbi_dv_u1_d1_7");
      render(<MapChartRenderer layers={[/* same shape */]} />);
      await waitFor(() => {
        // No ImageWMS constructed for this layer (or addLayer not called)
        expect(imageWmsConstructorSpy).not.toHaveBeenCalled();
        // Overlay visible
        expect(screen.getByText("Some layers over threshold")).toBeInTheDocument();
      });
    });
    ```

    For Test 7 (transition pending → materialized re-fires updateParams):

    ```typescript
    it("dvStatus pending → materialized fires updateParams with new LAYERS via dynamicViewsKey re-fire", async () => {
      useDynamicViewStore.getState().markPending(7, "_kbi_dv_u1_d1_7");
      render(<MapChartRenderer layers={[/* same */]} />);
      // Initial: layer omitted
      await waitFor(() => expect(imageWmsConstructorSpy).not.toHaveBeenCalled());

      // Transition store
      act(() => useDynamicViewStore.getState().setView(7, {
        viewName: "_kbi_dv_u1_d1_7",
        status: "materialized",
        expiresAt: 9999,
      }));

      // Now Effect 2 re-fires due to dynamicViewsKey change → layer added
      await waitFor(() => {
        expect(imageWmsConstructorSpy).toHaveBeenCalled();
        const paramsApplied = imageWmsConstructorSpy.mock.calls[0][0].params;
        expect(paramsApplied.LAYERS).toBe("_kbi_dv_u1_d1_7");
      });
    });
    ```

    Adapt spies and assertions to the existing MapChartRenderer spec patterns. The key locked behaviors:
    - dv-bound + materialized → WMS params have LAYERS=<dvViewName>, _mv=<dynamicViewVersion>
    - dv-bound + non-materialized → layer omitted, overlay visible
    - Plain table-bound layer (dynamic_view_id: null) → unchanged behavior
    - Effects 2/3 re-fire on dv store changes (dynamicViewsKey moves)
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "Phase 35 per-layer dynamic-view binding" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
    - `grep -q "Some layers over threshold" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
    - `grep -q "dynamic_view_id: 7" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`
    - `grep -c "it(" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns at least 8 higher than the pre-edit count
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` exits 0
    - All previous MapChartRenderer tests still pass
  </acceptance_criteria>
  <done>
    - 8 new spec tests covering materialized / pending / over_threshold / error / mixed / state-transition / version-bump cases
    - All previous tests pass (regression)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend LayersModal + KineticaWmsLayerForm — Data Source picker section with three optgroups; PATCH handler for dv binding</name>
  <files>kinetica_bi/src/components/LayersModal.tsx, kinetica_bi/src/components/LayersModal.spec.tsx, kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx, kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/LayersModal.tsx (FULL — locate the existing TABLE picker section at lines 293-364; this is where the new Data Source section goes ABOVE)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (FULL — verify it's the inner form component; identify the props for the Data Source section + onPatch callback)
    - kinetica_bi/src/components/LayersModal.spec.tsx (FULL — existing test fixtures + harness)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx (FULL — existing harness)
    - kinetica_bi/src/api/client.ts (DashboardLayerDto with dynamic_view_id from Plan 35-01; DynamicViewRow shape)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"LayersModal UI" — three-optgroup picker, mutual exclusion)
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Example 3" verbatim picker JSX + research finding #4 lock on table_id NOT NULL preservation)
  </read_first>
  <behavior>
    - Test 1 (LayersModal.spec.tsx): `<LayersModal>` accepts a `dynamicViews` prop. It is forwarded to KineticaWmsLayerForm (assert via mocked KineticaWmsLayerForm receiving the prop).

    - Test 2 (KineticaWmsLayerForm.spec.tsx): When `dynamicViews` is non-empty, the "Data Source" picker renders THREE optgroups (Tables / Views / Dynamic Views). Tables and Dynamic Views both visible. (Views optgroup may or may not exist depending on existing form scope — match the existing structure; Dynamic Views must be NEW.)

    - Test 3 (KineticaWmsLayerForm.spec.tsx): When `dynamicViews` is empty, the Dynamic Views optgroup is HIDDEN.

    - Test 4 (KineticaWmsLayerForm.spec.tsx): Picking a dynamic-view (`value="dv:7"`) calls `onPatch` with `{ dynamic_view_id: 7, table_id: <sourceTableId of dv 7> }`.

    - Test 5 (KineticaWmsLayerForm.spec.tsx): Picking a plain table (after dv was bound) calls `onPatch` with `{ dynamic_view_id: null, table_id: <new tableId> }` — explicit null, not omitted (verifies Plan 35-01's "key" in attrs discriminant gets triggered server-side).

    - Test 6 (KineticaWmsLayerForm.spec.tsx): When the layer has `dynamic_view_id: 7` already, the `<select>` value is `dv:7` (currently-selected).

    - Test 7 (KineticaWmsLayerForm.spec.tsx): When the layer's `dynamic_view_id` references an id NOT in the dynamicViews prop (orphan layer), the picker shows the table_id-bound option as selected (defensive fallback — operator can re-pick).
  </behavior>
  <action>
    **1. Verify `LayersModal.tsx` already accepts `dynamicViews` prop** (Plan 35-03 added it). If still placeholder pass-through, forward to KineticaWmsLayerForm:

    Locate where `<KineticaWmsLayerForm ...>` is mounted inside LayersModal. Add the prop:

    ```tsx
    <KineticaWmsLayerForm
      layer={selectedLayer}
      associatedTables={associatedTables}
      dynamicViews={dynamicViews}                       // NEW Phase 35 (DV-V16-13)
      onPatch={(patch) => onPatch(selectedLayer.id, patch)}
      /* other existing props */
    />
    ```

    **2. Extend `KineticaWmsLayerForm.tsx` props:**

    ```typescript
    import { type DynamicViewRow } from "../../api/client";

    type KineticaWmsLayerFormProps = {
      layer: DashboardLayerDto;
      associatedTables: TableDto[];
      dynamicViews?: DynamicViewRow[];                  // NEW Phase 35
      onPatch: (patch: Partial<DashboardLayerDto>) => void;
      /* existing props */
    };

    const KineticaWmsLayerForm: React.FC<KineticaWmsLayerFormProps> = ({
      layer, associatedTables, dynamicViews = [], onPatch, /* existing */
    }) => { /* ... */ };
    ```

    **3. Add Data Source picker section ABOVE the existing TABLE picker** (or REPLACE the existing TABLE picker — Claude's discretion. RECOMMEND: replace, since the new picker handles BOTH table + dv with discriminator prefix `dv:` vs raw table id, mirroring Plan 35-04's pattern. Simpler UX — single picker, three optgroups):

    ```tsx
    <div className="config-group">
      <div className="config-group-label">DATA SOURCE</div>
      <select
        className="ds-select"
        aria-label="Layer data source"
        value={
          layer.dynamic_view_id !== null && layer.dynamic_view_id !== undefined &&
          dynamicViews.some((d) => d.id === layer.dynamic_view_id)
            ? `dv:${layer.dynamic_view_id}`
            : String(layer.table_id)
        }
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("dv:")) {
            const dvId = parseInt(v.slice(3), 10);
            const dv = dynamicViews.find((d) => d.id === dvId);
            if (!dv) return;
            // Research finding #4 lock: keep table_id = dv.source_table_id (NOT NULL preserved).
            onPatch({ dynamic_view_id: dvId, table_id: dv.source_table_id });
          } else {
            const tableId = parseInt(v, 10);
            // Explicit null clears any previous dv binding (Plan 35-01's "key" in attrs discriminant).
            onPatch({ dynamic_view_id: null, table_id: tableId });
          }
        }}
      >
        <optgroup label="Tables">
          {/* If layer.table_id references a table no longer in associatedTables, show a (removed) placeholder */}
          {!associatedTables.find((t) => t.id === layer.table_id) && layer.dynamic_view_id === null && (
            <option value={String(layer.table_id)}>(table removed)</option>
          )}
          {associatedTables.map((t) => (
            <option key={`t-${t.id}`} value={String(t.id)}>
              {t.schema ? `${t.schema}.${t.name}` : t.name}
            </option>
          ))}
        </optgroup>
        {/* Dynamic Views optgroup — hidden when empty */}
        {dynamicViews.length > 0 && (
          <optgroup label="Dynamic Views">
            {dynamicViews.map((dv) => (
              <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>{dv.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
    ```

    NOTE: The existing LayersModal/KineticaWmsLayerForm may have a separate TABLE picker at LayersModal.tsx:293-364. EITHER replace that picker with the new section OR keep the existing picker and add the new section above it. RECOMMEND: replace, to enforce mutual exclusion at the UI level — a single picker means operator can't pick both a table AND a dv. Plan 35-RESEARCH.md §"LayersModal UI" supports this: "the section becomes a single picker labeled 'Data Source' that handles all three kinds."

    **4. Verify the form does NOT introduce a Views optgroup unless KineticaWmsLayerForm currently supports filter-views as a per-layer source** — the locked CONTEXT.md (§"LayersModal UI") says "same three-optgroup pattern as ChartConfigPanel (Tables / Views / Dynamic Views)". If the existing form does NOT support filter-views per layer (only tables + now dvs), then render two optgroups (Tables + Dynamic Views) — keep it simple and aligned with current form capabilities. Read the existing form to confirm.

    **5. Write spec tests in `KineticaWmsLayerForm.spec.tsx`:**

    ```typescript
    describe("Phase 35 Data Source picker (DV-V16-13)", () => {
      const mockTables: TableDto[] = [
        { id: 4, schema: "demo", name: "taxi_trips", columns: {} as any },
      ];
      const mockDynamicViews: DynamicViewRow[] = [
        { id: 7, dashboard_id: 1, source_table_id: 4, name: "Top vendors", template_sql: "x", max_records: 10000, columns_json: [], created_at: "x", updated_at: "x" },
      ];

      it("renders Dynamic Views optgroup when dynamicViews non-empty", () => {
        const onPatch = vi.fn();
        render(<KineticaWmsLayerForm
          layer={{ ...baseLayer, table_id: 4, dynamic_view_id: null }}
          associatedTables={mockTables}
          dynamicViews={mockDynamicViews}
          onPatch={onPatch}
        />);
        expect(screen.getByRole("group", { name: /Dynamic Views/i })).toBeInTheDocument();
      });

      it("hides Dynamic Views optgroup when dynamicViews empty", () => {
        render(<KineticaWmsLayerForm
          layer={{ ...baseLayer, table_id: 4, dynamic_view_id: null }}
          associatedTables={mockTables}
          dynamicViews={[]}
          onPatch={vi.fn()}
        />);
        expect(screen.queryByRole("group", { name: /Dynamic Views/i })).not.toBeInTheDocument();
      });

      it("picking a dv calls onPatch with { dynamic_view_id, table_id = sourceTableId }", () => {
        const onPatch = vi.fn();
        render(<KineticaWmsLayerForm
          layer={{ ...baseLayer, table_id: 4, dynamic_view_id: null }}
          associatedTables={mockTables}
          dynamicViews={mockDynamicViews}
          onPatch={onPatch}
        />);
        fireEvent.change(screen.getByLabelText(/layer data source/i), { target: { value: "dv:7" } });
        expect(onPatch).toHaveBeenCalledWith({ dynamic_view_id: 7, table_id: 4 });   // table_id = dv.source_table_id
      });

      it("picking a plain table after dv was bound calls onPatch with { dynamic_view_id: null, table_id }", () => {
        const onPatch = vi.fn();
        const dvBoundLayer = { ...baseLayer, table_id: 4, dynamic_view_id: 7 };
        render(<KineticaWmsLayerForm
          layer={dvBoundLayer}
          associatedTables={mockTables}
          dynamicViews={mockDynamicViews}
          onPatch={onPatch}
        />);
        fireEvent.change(screen.getByLabelText(/layer data source/i), { target: { value: "4" } });
        expect(onPatch).toHaveBeenCalledWith({ dynamic_view_id: null, table_id: 4 });
      });

      it("dv-bound layer shows dv option as currently selected", () => {
        render(<KineticaWmsLayerForm
          layer={{ ...baseLayer, table_id: 4, dynamic_view_id: 7 }}
          associatedTables={mockTables}
          dynamicViews={mockDynamicViews}
          onPatch={vi.fn()}
        />);
        const select = screen.getByLabelText(/layer data source/i) as HTMLSelectElement;
        expect(select.value).toBe("dv:7");
      });

      it("orphan layer (dv_id refs missing dv) falls back to table_id-bound option as selected", () => {
        // Layer says dv 99 but the prop dynamicViews only has dv 7 — fall back to plain table
        render(<KineticaWmsLayerForm
          layer={{ ...baseLayer, table_id: 4, dynamic_view_id: 99 }}
          associatedTables={mockTables}
          dynamicViews={mockDynamicViews}     // does NOT contain dv 99
          onPatch={vi.fn()}
        />);
        const select = screen.getByLabelText(/layer data source/i) as HTMLSelectElement;
        expect(select.value).toBe("4");        // table_id fallback (defensive)
      });
    });
    ```

    Add a single regression test to `LayersModal.spec.tsx`:

    ```typescript
    it("LayersModal forwards dynamicViews prop to KineticaWmsLayerForm", () => {
      // ... render with a mock KineticaWmsLayerForm spy ...
      // assert the spy was called with dynamicViews prop matching what was passed to LayersModal
    });
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/LayersModal.spec.tsx src/components/charts/KineticaWmsLayerForm.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "Dynamic Views" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` (optgroup)
    - `grep -q "dynamic_view_id: dvId" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` OR `grep -q "dynamic_view_id:" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` (PATCH payload)
    - `grep -q "dynamic_view_id: null" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` (explicit clear on plain-table pick)
    - `grep -q "dv.source_table_id" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` (research finding #4 lock — table_id keeps source)
    - `grep -q "dynamicViews" kinetica_bi/src/components/LayersModal.tsx` (forwarded to inner form)
    - `grep -q "Phase 35 Data Source picker" kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx`
    - `cd kinetica_bi && npx vitest run src/components/LayersModal.spec.tsx src/components/charts/KineticaWmsLayerForm.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - KineticaWmsLayerForm has Data Source section with three optgroups (Tables + Dynamic Views minimum)
    - PATCH payload dual-writes correctly for dv pick / single-write for table pick (with explicit null for clear)
    - table_id stays NOT NULL = sourceTableId when dv-bound (research finding #4 lock)
    - LayersModal forwards `dynamicViews` to inner form
    - 6+ spec tests covering picker render, hide-when-empty, dv pick, plain-table pick (with clear), selected state, orphan fallback
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx src/components/LayersModal.spec.tsx src/components/charts/KineticaWmsLayerForm.spec.tsx` passes
- `cd kinetica_bi && npx tsc --noEmit` clean
- `dynamicViewsKey` selector mirrors `viewsKey` exactly (research finding #6 / Pitfall 7)
- Both Effect 2 + Effect 3 dep arrays include `dynamicViewsKey`
- Layer skip path tested (buildWmsParams returns null → continue)
- Over-threshold overlay surfaces when any bound layer is non-materialized
- KineticaWmsLayerForm Data Source picker enforces mutual exclusion + table_id NOT NULL preservation
- Research finding #4 lock verified: dv-bound layers keep `table_id = source_table_id`
</verification>

<success_criteria>
- MapChartRenderer: per-layer dv lookup + dynamicViewsKey selector + extended buildWmsParams call + layer skip + over-threshold overlay
- LayersModal: dynamicViews prop forwarded to KineticaWmsLayerForm
- KineticaWmsLayerForm: Data Source picker with Tables + Dynamic Views optgroups; PATCH handler dual-writes correctly
- DV-V16-13 (MapChart LAYERS-swap) + DV-V16-14 (over-threshold UX) both closed for map widgets
- Layer with non-materialized dv is hidden from the visible stack (no broken tile URLs); overlay indicates the state
- table_id NOT NULL constraint preserved (no schema relaxation needed)
</success_criteria>

<output>
After completion, create `.planning/phases/35-widget-binding-and-pipeline/35-06-SUMMARY.md`.
</output>
