---
phase: 12-dashboard-layers-panel
plan: "04"
subsystem: ui-components
tags:
  - layers-modal
  - dashboard-ui
  - tdd
  - css
  - debounced-save
dependency_graph:
  requires:
    - 12-02 (KineticaWmsLayerForm — embedded in right pane)
    - 12-03 (useDashboardLayersStore + CRUD client functions)
    - 12-01 (backend routes)
  provides:
    - LayersModal.tsx (two-pane layer manager)
    - LayersModal.spec.tsx (16 tests)
    - Phase 12 CSS classes in global.css (26 classes)
    - DashboardsPage Layers button + data lifecycle + debounced auto-save
  affects:
    - 12-05 (uses .widget-map-empty, .widget-map-reconfigure, .config-layer-picker CSS)
    - 12-06 (reads layers from store loaded here)
tech_stack:
  added: []
  patterns:
    - TDD (RED commit → GREEN commit)
    - Native HTML5 drag-reorder (draggable + onDragStart/onDragOver/onDrop)
    - Debounced PATCH via ref-snapshot (RESEARCH Pitfall 5 lock)
    - Optimistic store update before debounced server PATCH
key_files:
  created:
    - kinetica_bi/src/components/LayersModal.tsx
    - kinetica_bi/src/components/LayersModal.spec.tsx
  modified:
    - kinetica_bi/src/components/DashboardsPage.tsx
    - kinetica_bi/src/styles/global.css
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
decisions:
  - "autoSuggestSpatialMode returns SpatialMode string (not an object with mode/latColumn/lonColumn) — handleTableChange sets spatialMode from the returned string, clears stale column fields; column pre-population is left to the KineticaWmsLayerForm dropdown after user picks from the new columns list"
  - "draggingIdRef uses useRef instead of useState to avoid stale closure in drag handlers; forceUpdate forces re-render when ref changes (drag opacity feedback)"
  - "WidgetRenderer.spec.tsx map-widget routing test updated to match Phase 12-05 MapChartRenderer reconfigure overlay text — MapChartRenderer was already updated for Plan 12-05 before this plan ran"
metrics:
  duration: "~9 minutes (511 seconds)"
  completed: "2026-05-05"
  tasks: 4
  files: 5
requirements_satisfied:
  - LAYER-07-modal-shell
  - LAYER-08-modal-interactions
  - LAYER-09-css-tokens
---

# Phase 12 Plan 04: LayersModal + DashboardsPage Wiring Summary

**Phase 12 CSS classes (26 new classes in global.css) + LayersModal two-pane component + DashboardsPage Layers button with debounced auto-save and full layer CRUD lifecycle**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-06T00:32:29Z
- **Completed:** 2026-05-06T00:40:58Z (paused at checkpoint)
- **Tasks:** 3 of 4 complete (Task 4 is checkpoint:human-verify)
- **Files modified:** 5

## Accomplishments

### Task 1: Phase 12 CSS classes (global.css)
Added 26 new CSS classes per UI-SPEC.md Component Inventory:
- **LayersModal**: `.modal-layers` (900px max-width), `.layers-modal-body`, `.layers-modal-left` (280px fixed), `.layers-modal-right` (padding 16px 24px), `.layers-modal-empty`
- **Layer list**: `.layer-list`, `.layer-list-add`, `.layer-row` + hover/active states, `.layer-row-drag` (min-height 32px), `.layer-row-eye` + hidden, `.layer-row-icon`, `.layer-row-name` (weight 600), `.layer-row-opacity` (64px), `.layer-row-actions`, `.layer-row-btn` + hover + danger:hover, `.layer-row-badge` (padding 4px 8px, weight 600) + error state
- **Config layer picker** (for Plan 05): `.config-layer-picker`, `.config-layer-toggle-row` + label, `.config-layer-none`
- **Map overlays** (for Plan 05): `.widget-map-reconfigure`, `.widget-map-reconfigure-badge`, `.widget-map-empty`

### Task 2: LayersModal component (TDD)
- **RED commit** `2a733ad`: 16 failing tests (component file missing)
- **GREEN commit** `2a43607`: Component created, all 16 tests pass
- Two-pane layout: left rail (layer list + add button) + right pane (table dropdown + KineticaWmsLayerForm)
- Layer rows: drag handle (⠿), eye visibility toggle (aria-label Hide/Show), type icon, auto-derived name (`{schema}.{table} — {renderMode}`), opacity slider (0-100, POINTOPACITY), duplicate + trash actions
- Inline delete confirm: trash click → `[Delete layer] [Keep layer]` buttons inline
- Missing-table badge: `.layer-row-badge.error` "Table removed — reconfigure"
- Table dropdown: selects from associatedTables; `handleTableChange` clears stale spatial columns + calls `autoSuggestSpatialMode` + patches `table_id`
- Native HTML5 drag-reorder: `draggable` + `onDragStart/onDragOver/onDrop`; `draggingIdRef` uses `useRef` to avoid stale closure
- ESC key handler + backdrop click + X button fire `onClose`

### Task 3: DashboardsPage wiring
- Added `useCallback`, `useRef` to React imports; added `LayersModal`, `useDashboardLayersStore`, CRUD functions, `useToastStore` imports
- `showLayersModal` state + Layers button in toolbar (`btn-primary btn-sm`)
- `layers` + `setLayers` selectors from `useDashboardLayersStore`
- `useEffect` for `listDashboardLayers` on `dashboard.id` with cleanup `setLayers([])`
- CRUD callbacks: `handleLayerCreate`, `handleLayerDelete`, `handleLayerDuplicate`, `handleLayerReorder`, `handleLayerPatch`
- Debounced PATCH: `pendingPatchRef` (per-layer patch accumulation) + `debounceTimerRef` (300ms reset), `flushPendingPatches` reads from ref at fire time (RESEARCH Pitfall 5 lock)
- `handleLayersModalClose`: flushes pending patches immediately before closing
- Auto-create blank layer on first open when `layers.length === 0 && associatedTables.length > 0`
- Toast strings verbatim per UI-SPEC: "Layer added", "Layer deleted", "Failed to save layer — check your connection"
- RESEARCH Open Q3 comment near layers fetch effect

## Task Commits

1. **Task 1: CSS** — `4b57ae0` (feat)
2. **Task 2 RED: failing spec** — `2a733ad` (test)
3. **Task 2 GREEN: LayersModal implementation** — `2a43607` (feat)
4. **Task 3: DashboardsPage wiring** — `854c385` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] autoSuggestSpatialMode returns SpatialMode string, not object**
- Found during: Task 2 implementation
- Issue: Plan pseudocode used `suggestion.mode`, `suggestion.latColumn` etc., but the actual `autoSuggestSpatialMode` in `columnTypes.ts` returns only a `SpatialMode` string (`"latlon"`, `"wkt"`, `"wkb"`)
- Fix: Adapted `handleTableChange` to use `const suggestedMode = autoSuggestSpatialMode(newColumns)` (returns string), set `spatialMode: suggestedMode` directly; removed `suggestion.latColumn/lonColumn/wktColumn/wkbColumn` references
- Files modified: `kinetica_bi/src/components/LayersModal.tsx`

**2. [Rule 1 - Bug] WidgetRenderer.spec.tsx map-routing test failed after Phase 12-05 MapChartRenderer changes**
- Found during: Task 3 full test suite run
- Issue: `WidgetRenderer.spec.tsx` line 560 asserted text "Configure spatial columns to render the map" but `MapChartRenderer.tsx` (already modified for Plan 12-05) now renders "This map needs to be reconfigured. Open the Layers panel..." for old-config widgets
- Fix: Updated assertion to `screen.getByText(/This map needs to be reconfigured/i)` with comment explaining Phase 12-05 context
- Files modified: `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
- Commit: included in `854c385`

**3. [Rule 3 - Blocking] draggingId state replaced with useRef**
- Found during: Task 2 implementation
- Issue: Using `useState` for `draggingId` would cause stale closure in `onDrop` handler — by the time drop fires, the closure captures the old `draggingId` value; `useRef` reads current at call time
- Fix: Replaced `const [draggingId, setDraggingId] = useState` with `const draggingIdRef = useRef<number | null>` + `forceUpdate` for re-render to update drag opacity style
- Files modified: `kinetica_bi/src/components/LayersModal.tsx`

## Human Verification

**Task 4: checkpoint:human-verify — APPROVED**

User verified the Layers modal UX. All 4 tasks complete. Plan 12-04 is fully closed.

**LAYERS-param bug surfaced during verification (out of scope for 12-04):**

During user walkthrough of the modal, it was discovered that the WMS GetMap request was missing the `LAYERS` parameter — layers failed to render because `layer.table_id` was never resolved to the `schema.name` string Kinetica requires. This bug was scoped to Plan 12-05's `MapChartRenderer` (not LayersModal or DashboardsPage). The fix was applied immediately after verification in a separate commit:

- **Commit:** `dfb12ca` — `fix(12-05): inject WMS LAYERS param by resolving layer.table_id → schema.name`
- **Plan scope:** 12-05 (renderer), not 12-04 (modal/wiring)
- **Plan 12-04 is unaffected** — LayersModal, DashboardsPage wiring, CSS, and tests all remain correct as shipped.

## Self-Check: PASSED

Files verified:
- FOUND: `kinetica_bi/src/components/LayersModal.tsx`
- FOUND: `kinetica_bi/src/components/LayersModal.spec.tsx`
- CSS classes confirmed in `kinetica_bi/src/styles/global.css`
- `grep "import LayersModal" kinetica_bi/src/components/DashboardsPage.tsx` confirmed

Commits verified:
- `4b57ae0` — Task 1 CSS
- `2a733ad` — Task 2 RED
- `2a43607` — Task 2 GREEN
- `854c385` — Task 3 DashboardsPage
