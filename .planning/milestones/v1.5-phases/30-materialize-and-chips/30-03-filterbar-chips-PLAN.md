---
phase: 30-materialize-and-chips
plan: 03
type: execute
wave: 2
depends_on: [30-01]
files_modified:
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
autonomous: true
requirements:
  - CHIP-V15-01
  - CHIP-V15-02
must_haves:
  truths:
    - "Spatial chips appear in the SAME .filter-bar-chips row as column chips inside each targeted table's .filter-bar-item"
    - "Each chip shows {Type} {N} ({measurement}) — e.g. 'Bbox 1 (5km × 3km)' — composed from shape.label + shape.measurement (no recomputation)"
    - "Chip × calls useSpatialFilterStore.getState().removeShape(shape.id) → spatialFilterVersion ticks → Plan 30-02's Effect 1 re-fires → materialize updates → chip disappears"
    - "Per-table 'Clear all' button removes ALL column filters for the table AND removes every shape whose target tableId equals this table (multi-target shapes nuked globally per CONTEXT.md operator lock). Implementation: column branch calls useFilterStore.getState().clearFilters(tableId); spatial branch iterates shapes and calls useSpatialFilterStore.getState().removeShape(id) for each."
    - "Orphan shapes (no eligible target for any table) produce NO chips anywhere — they only render on map overlays (Phase 29)"
    - "A table row appears in the filter bar when it has column filters OR a static clause OR a non-empty shapes-for-this-table set (extended tableIdsWithFilters discovery)"
  artifacts:
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "FilterBar JSX extended with spatial chip rendering per targeted table row"
      contains: "shape.label"
    - path: "kinetica_bi/src/components/DashboardsPage.spec.tsx"
      provides: "Spatial chip rendering + remove + per-table-clear-all coverage"
      contains: "spatial chip"
  key_links:
    - from: "kinetica_bi/src/components/DashboardsPage.tsx (FilterBar JSX)"
      to: "kinetica_bi/src/lib/spatialTargets.ts aggregateSpatialTargetsByTable"
      via: "useMemo on widgets state, called inside the FilterBar IIFE"
      pattern: "aggregateSpatialTargetsByTable\\(widgets\\)"
    - from: "Spatial chip × button onClick"
      to: "useSpatialFilterStore.getState().removeShape(shape.id)"
      via: "imperative store call inside chip × handler"
      pattern: "useSpatialFilterStore\\.getState\\(\\)\\.removeShape\\(shape\\.id\\)"
    - from: "Per-table 'Clear all' onClick — column branch"
      to: "useFilterStore.getState().clearFilters(tableId)"
      via: "imperative store call inside extended Clear all onClick handler"
      pattern: "useFilterStore\\.getState\\(\\)\\.clearFilters\\(tableId\\)"
    - from: "Per-table 'Clear all' onClick — spatial branch"
      to: "useSpatialFilterStore.getState().removeShape (in a loop over shape ids when hasSpatialForThisTable)"
      via: "imperative loop inside extended Clear all onClick handler — removes shape ids for each shape this row reports"
      pattern: "useSpatialFilterStore\\.getState\\(\\)\\.removeShape"
---

<objective>
Render drawn shapes as chips in the existing inline `FilterBar` JSX inside `DashboardsPage.tsx` and extend the per-table "Clear all" button to nuke shapes whose target tableId matches the row. After this plan, every shape that resolves to an eligible target (via `aggregateSpatialTargetsByTable`) appears as a `{Type} {N} ({measurement})`-formatted chip in the same `.filter-bar-chips` row as column chips inside that table's `.filter-bar-item`; the chip × removes the shape from `useSpatialFilterStore`, which bumps `spatialFilterVersion`, which triggers Plan 30-02's Effect 1 re-fire, which updates the materialized view, which makes the chip disappear (closed loop).

Purpose: Closes the user-facing surface of Phase 30 — without chips, the user has drawn shapes but no chip-based dismissal path, and the per-table "Clear all" lock from CONTEXT.md is unimplemented. This plan does NOT modify the materialize trigger (Plan 30-02 owns that); it only modifies the FilterBar JSX and per-table Clear all semantics. The shape→materialize loop closes naturally because the store mutation drives `spatialFilterVersion`, which Plan 30-02 already wires.

Output: Modified `DashboardsPage.tsx` FilterBar JSX block (lines ~691-758) with spatial chips + extended per-table Clear all; new test coverage in `DashboardsPage.spec.tsx` proving chip rendering, chip dismiss, and per-table-clear-all semantics for both single-target and multi-target shapes.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/30-materialize-and-chips/30-CONTEXT.md
@.planning/phases/30-materialize-and-chips/30-01-foundation-PLAN.md

# Source files this plan modifies
@kinetica_bi/src/components/DashboardsPage.tsx
@kinetica_bi/src/components/DashboardsPage.spec.tsx

# Read-only references — DO NOT modify
@kinetica_bi/src/store/spatialFilterStore.ts
@kinetica_bi/src/lib/spatialTargets.ts
@kinetica_bi/src/styles/global.css

<interfaces>
<!-- Existing exports the executor must use as-is. -->

From kinetica_bi/src/store/spatialFilterStore.ts (Phase 27 — read-only):
```typescript
export type Shape = {
  id: string;
  type: "bbox" | "lasso" | "circle";
  wkt: string;
  label: string;        // already "{Type} {N}" — e.g. "Bbox 1"
  measurement: string;  // already "5km × 3km" / "2.5 km" / "12.4 km²"
  addedAt: number;
};
export const useSpatialFilterStore = create<{
  shapes: Shape[];
  spatialFilterVersion: number;
  addShape: (...) => void;
  removeShape: (id: string) => void;
  clearAll: () => void;
  reset: () => void;
}>(...);
```

From kinetica_bi/src/lib/spatialTargets.ts (Plan 30-01 added):
```typescript
export function aggregateSpatialTargetsByTable(
  widgets: WidgetDto[],
): Map<number, SpatialTarget>;
```

Existing render pattern in kinetica_bi/src/components/DashboardsPage.spec.tsx (READ-FIRST for Task 2):
```typescript
// vi.mock at top:
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
    listDashboards: vi.fn(() => Promise.resolve([])),
    listAssociatedTables: vi.fn(() => Promise.resolve([])),
    listWidgets: vi.fn(() => Promise.resolve([])),
    listViews: vi.fn(() => Promise.resolve([])),
    listDashboardLayers: vi.fn(() => Promise.resolve([])),
    listDashboardTables: vi.fn(() => Promise.resolve([])),
    listTables: vi.fn(() => Promise.resolve([])),
  };
});

// Render pattern (line 140):
import DashboardsPage from "./DashboardsPage";
import { render } from "@testing-library/react";
const { unmount } = render(<DashboardsPage onViewChange={() => {}} />);
unmount();

// Pre-seed pattern (lines 36-37, 58-77):
useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
useFilterStore.getState().addFilter(99, { column: "g", value: "A", dataType: "string", addedAt: Date.now() } as ActiveFilter);
useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))", measurement: "5km × 3km" });

// Store reset pattern (between tests):
useFilterViewStore.getState().reset();
useFilterStore.getState().reset();
useSpatialFilterStore.getState().reset();
```

Existing CSS classes (do NOT modify — reuse verbatim per CONTEXT.md lock):
- `.filter-bar` — wrapper div around all .filter-bar-item rows
- `.filter-bar-item` — per-table row (one per tableId with active filters)
- `.filter-bar-table` — table-name label
- `.filter-bar-chips` — flex row container for chips
- `.filter-bar-chip` — green accent chip styling (text + × button container)
- `.filter-bar-chip-dismiss` — × button styling
- `.filter-bar-clear` — per-table "Clear all" button

Current FilterBar JSX block (DashboardsPage.tsx lines ~691-758) anatomy:
- IIFE returning null when no filters/clauses exist
- Builds `tableIdsWithFilters: Set<number>` from views (static clauses) + allStoreFilters
- For each tableId: renders `.filter-bar-item` with `.filter-bar-table` (name), optional `.filter-bar-clause` (static), `.filter-bar-chips` (column chips), `.filter-bar-clear` (per-table reset button)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend DashboardsPage FilterBar JSX with spatial chips and extended per-table Clear all</name>
  <files>kinetica_bi/src/components/DashboardsPage.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.tsx lines 1-50 (imports — useSpatialFilterStore already imported at line 27)
    - kinetica_bi/src/components/DashboardsPage.tsx lines 360-380 (widgets state)
    - kinetica_bi/src/components/DashboardsPage.tsx lines 437 (allStoreFilters selector)
    - kinetica_bi/src/components/DashboardsPage.tsx lines 691-758 (FilterBar IIFE — this is the only block changed)
    - kinetica_bi/src/store/spatialFilterStore.ts (Shape type for chip data)
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md `<decisions>` § "FilterBar chip placement" — verbatim text format + per-table Clear all multi-target lock
  </read_first>
  <action>
    Make these targeted edits in `kinetica_bi/src/components/DashboardsPage.tsx`:

    1. **Imports (top of file):**
       - `useSpatialFilterStore` is already imported at line 27 — no change.
       - Add this new import after the existing local imports (around line 42-49 area):
         ```typescript
         import { aggregateSpatialTargetsByTable } from "../lib/spatialTargets";
         ```
       - Verify `useMemo` is already imported from "react". If not, add it.

    2. **Add a primitive selector + memoized targetsByTable near the existing `allStoreFilters` selector (around line 437).** Place AFTER the `allStoreFilters` line:
       ```typescript
       // Phase 30 (CHIP-V15-01/02): subscribe to spatial shapes + memoize per-table eligible targets.
       // shapes is read as the full array (NOT a primitive selector) because chip rendering iterates
       // shapes directly — re-render on shape mutation is exactly the intended trigger.
       const shapes = useSpatialFilterStore((s) => s.shapes);
       const targetsByTable = useMemo(
         () => aggregateSpatialTargetsByTable(widgets),
         [widgets],
       );
       // Compute the set of tableIds that have any shape mapped to them (via targetsByTable.has).
       // A shape's "target tableId" is the tableId of the SpatialTarget that aggregateSpatialTargetsByTable
       // associates with this shape — but since shapes are global and targets are per-table, the
       // mapping is: for each tableId in targetsByTable, all shapes apply (OR-composition).
       // So a tableId has chips iff (a) targetsByTable.has(tableId) AND (b) shapes.length > 0.
       const tableIdsWithSpatialChips = useMemo(() => {
         if (shapes.length === 0) return new Set<number>();
         return new Set<number>(Array.from(targetsByTable.keys()));
       }, [shapes, targetsByTable]);
       ```

       (Note on the tableId→shapes mapping: per CONTEXT.md `<decisions>` § "FilterBar chip placement", a shape that filters two tables shows up TWICE — once in each row. The implementation is straightforward: inside each `.filter-bar-item`, iterate ALL shapes — they all apply to this table via OR — and render a chip per shape. The tiebreaker only affects which SpatialTarget is sent to the server; the chips themselves are tableId-keyed by row, shape-keyed within a row.)

    3. **Extend the FilterBar IIFE (lines 691-758).** Three surgical changes:

       a. **Extend `tableIdsWithFilters` discovery** (currently lines 698-704) to include tableIds with spatial chips:
          ```typescript
          const tableIdsWithFilters = new Set<number>();
          for (const v of views) {
            if (v.filter_clause?.trim()) tableIdsWithFilters.add(v.table_id);
          }
          for (const [tidStr, arr] of Object.entries(allStoreFilters)) {
            if (arr.length > 0) tableIdsWithFilters.add(Number(tidStr));
          }
          // Phase 30 (CHIP-V15-01): include tableIds that have an eligible target AND shapes drawn.
          for (const tid of tableIdsWithSpatialChips) {
            tableIdsWithFilters.add(tid);
          }
          ```

       b. **Extend the early-return guard** (currently line 691-694) to also consider spatial chips:
          ```typescript
          const hasAnyStaticClause = views.some((v) => !!v.filter_clause?.trim());
          const hasAnyStoreFilters = Object.values(allStoreFilters).some((arr) => arr.length > 0);
          const hasAnySpatialChips = tableIdsWithSpatialChips.size > 0;
          if (!hasAnyStaticClause && !hasAnyStoreFilters && !hasAnySpatialChips) return null;
          ```

       c. **Extend each `.filter-bar-item` body** to render spatial chips inside the same `.filter-bar-chips` row when present. Inside the existing `{tableIdsWithFilters.map((tableId) => { ... })}` callback (lines 708-755), the current structure is:
          ```typescript
          const storeFilters = allStoreFilters[tableId] ?? [];
          const hasStaticClause = !!view?.filter_clause?.trim();
          const hasStoreFilters = storeFilters.length > 0;
          if (!hasStaticClause && !hasStoreFilters) return null;   // ← DEFENSIVE GUARD
          ```
          Replace this with:
          ```typescript
          const storeFilters = allStoreFilters[tableId] ?? [];
          const hasStaticClause = !!view?.filter_clause?.trim();
          const hasStoreFilters = storeFilters.length > 0;
          const hasSpatialForThisTable = tableIdsWithSpatialChips.has(tableId);
          // Phase 30 (CHIP-V15-01): defensive guard extended to include spatial chips.
          if (!hasStaticClause && !hasStoreFilters && !hasSpatialForThisTable) return null;
          ```

          Then extend the `.filter-bar-chips` rendering block (currently lines 727-743, the `{hasStoreFilters && (...)}` block). Replace that block with a unified chip container that includes BOTH column and spatial chips when either are present:
          ```typescript
          {(hasStoreFilters || hasSpatialForThisTable) && (
            <div className="filter-bar-chips">
              {/* Column chips (existing v1.2/v1.3 behavior — unchanged) */}
              {storeFilters.map((f) => (
                <span key={`col-${f.column}`} className="filter-bar-chip">
                  {chipText(f.column, f.value, f.dataType)}
                  <button
                    type="button"
                    className="filter-bar-chip-dismiss"
                    aria-label={`Remove filter ${f.column}`}
                    onClick={() => useFilterStore.getState().removeFilter(tableId, f.column)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {/* Phase 30 (CHIP-V15-01): spatial chips — one per shape, same row, same chip class. */}
              {hasSpatialForThisTable && shapes.map((shape) => (
                <span key={`spatial-${shape.id}`} className="filter-bar-chip">
                  {`${shape.label} (${shape.measurement})`}
                  <button
                    type="button"
                    className="filter-bar-chip-dismiss"
                    aria-label={`Remove spatial filter ${shape.label}`}
                    onClick={() => useSpatialFilterStore.getState().removeShape(shape.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          ```

       d. **Extend the per-table "Clear all" button onClick** (currently lines 744-752). Replace with an extended handler that clears BOTH column filters AND any shapes that target this table:
          ```typescript
          {(hasStoreFilters || hasSpatialForThisTable) && (
            <button
              type="button"
              className="filter-bar-clear"
              onClick={() => {
                // Phase 30 column branch: clear column filters for this table (existing behavior).
                if (hasStoreFilters) {
                  useFilterStore.getState().clearFilters(tableId);
                }
                // Phase 30 (CHIP-V15-02) spatial branch: also remove every shape whose target
                // tableId includes this row's tableId. Per CONTEXT.md `<decisions>` § "FilterBar
                // chip placement": multi-target shapes are nuked GLOBALLY (their chips disappear
                // from other rows too) — operator-locked. The semantic is "Clear all means this
                // row is empty afterward".
                //
                // A shape is "targeting this tableId" when targetsByTable.has(tableId)
                // returns true (in which case ALL shapes apply to this table via OR). So
                // the condition for shape removal in this row's "Clear all" is simply:
                // remove ALL shapes if hasSpatialForThisTable, else no-op.
                //
                // This is the GLOBAL nuke per the operator lock — equivalent to
                // useSpatialFilterStore.getState().clearAll() — but written as an explicit
                // removeShape loop for grep-stability AND because removeShape preserves
                // shapeCounter for label continuity (clearAll resets shapeCounter to 0).
                if (hasSpatialForThisTable) {
                  // Snapshot shape ids before mutation (avoid iterator invalidation).
                  const idsToRemove = shapes.map((s) => s.id);
                  for (const id of idsToRemove) {
                    useSpatialFilterStore.getState().removeShape(id);
                  }
                }
              }}
            >
              Clear all
            </button>
          )}
          ```

    4. **DO NOT touch any other JSX in DashboardsPage.tsx.** The widget grid, ChartConfigPanel, ChartCard, LayersModal — all stay as-is. The only file-level changes are: 1 new import, ~5 lines of selectors/memos before the IIFE, and the FilterBar IIFE body.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "import { aggregateSpatialTargetsByTable } from \"../lib/spatialTargets\"" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match
    - `grep -n "const shapes = useSpatialFilterStore((s) => s.shapes)" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match
    - `grep -n "aggregateSpatialTargetsByTable(widgets)" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match (inside useMemo for FilterBar)
    - `grep -n "tableIdsWithSpatialChips" kinetica_bi/src/components/DashboardsPage.tsx` returns AT LEAST 4 matches (memo + 3 guards/uses inside FilterBar)
    - `grep -n "hasAnySpatialChips" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match (in extended early-return guard)
    - `grep -n "hasSpatialForThisTable" kinetica_bi/src/components/DashboardsPage.tsx` returns AT LEAST 4 matches (declaration + defensive guard + chip block + Clear all)
    - `grep -n "\\${shape.label} (\\${shape.measurement})" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match (exact format-string lock)
    - `grep -n "useSpatialFilterStore.getState().removeShape(shape.id)" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match (chip × handler — key_link "Spatial chip × button onClick")
    - `grep -n "useFilterStore.getState().clearFilters(tableId)" kinetica_bi/src/components/DashboardsPage.tsx` returns at least 1 match (column branch of extended Clear all — key_link "Per-table 'Clear all' onClick — column branch")
    - `grep -n "Remove spatial filter \\${shape.label}" kinetica_bi/src/components/DashboardsPage.tsx` returns 1 match (aria-label per CONTEXT.md discretion guidance)
    - `grep -nE "useSpatialFilterStore\\.getState\\(\\)\\.removeShape\\(id\\)" kinetica_bi/src/components/DashboardsPage.tsx` returns at least 1 match inside the Clear all handler — key_link "Per-table 'Clear all' onClick — spatial branch"
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>FilterBar JSX renders spatial chips alongside column chips per CONTEXT.md format, per-table Clear all globally nukes shapes when this row has them, tsc green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add Phase 30 spatial chip coverage to DashboardsPage.spec.tsx</name>
  <files>kinetica_bi/src/components/DashboardsPage.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (full file — lines 1-143; understand vi.mock pattern, render call at line 140, pre-seed pattern at lines 36-77, reset pattern at lines 49-50/86-90)
    - kinetica_bi/src/components/DashboardsPage.tsx (post-Task 1 state) — the FilterBar IIFE for assertion targets
    - kinetica_bi/src/store/spatialFilterStore.ts (useSpatialFilterStore.getState().addShape signature for test fixtures)
    - kinetica_bi/src/lib/spatialTargets.ts (SpatialTarget shape for widget fixtures)
    - kinetica_bi/src/api/client.ts §WidgetDto + §DashboardTableDto + §DashboardDto (mock return type shapes)
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md `<decisions>` § "Test surface" + "FilterBar chip placement"
  </read_first>
  <behavior>
    - Test 1: Spatial chip renders with exact format `Bbox 1 (5km × 3km)` (text content match) when shapes exist AND widgets includes a map widget with eligible latlon target for this tableId, AND when the user has navigated INTO a dashboard (DashboardOpen mounted — the FilterBar JSX lives inside DashboardOpen, not at the DashboardsPage list view)
    - Test 2: NO spatial chip renders for a tableId when widgets has NO eligible target for it (orphan-shape: shape persists in store but chip is absent from FilterBar)
    - Test 3: Spatial chip × click invokes useSpatialFilterStore.removeShape with the correct shape id — asserted via store snapshot before/after (`useSpatialFilterStore.getState().shapes.length` transitions 1 → 0)
    - Test 4: Per-table "Clear all" click removes ALL shapes when hasSpatialForThisTable is true — store.shapes.length goes from N to 0 (multi-target global nuke per CONTEXT.md lock)
    - Test 5: Per-table "Clear all" preserves column-clear behavior — when both column filters and shapes are present for a table, clicking Clear all empties BOTH (column filters via clearFilters + shapes via removeShape loop)
    - Test 6: A row appears in FilterBar for a tableId that has ONLY spatial chips (no column filters, no static clause) — the extended tableIdsWithFilters discovery works
  </behavior>
  <action>
    The existing spec at `kinetica_bi/src/components/DashboardsPage.spec.tsx` mocks `../api/client` exhaustively (every list* helper returns `Promise.resolve([])`) and renders `<DashboardsPage onViewChange={() => {}} />` directly. The FilterBar JSX lives inside the `DashboardOpen` child component which mounts when the user clicks into a dashboard — to exercise the FilterBar, the Phase 30 tests must populate the `listDashboards` / `listAssociatedTables` / `listWidgets` / `listDashboardTables` / `listViews` mocks with non-empty arrays AND drive a click on the dashboard's open trigger.

    Strategy: extend the existing `vi.mock("../api/client", ...)` block with a per-test override pattern (set the mock return values inside each test's setup before calling render). Use `userEvent.click` to navigate into the dashboard. Then assert against the rendered DOM.

    1. **Update imports** at the top of `DashboardsPage.spec.tsx`. Add:
       ```typescript
       import { waitFor, screen, fireEvent, act } from "@testing-library/react";
       import userEvent from "@testing-library/user-event";
       import { listDashboards, listAssociatedTables, listWidgets, listViews, listDashboardTables } from "../api/client";
       ```
       (Leave `render` import as-is. `useSpatialFilterStore` and `useFilterStore` are already imported at lines 7 and 3 respectively.)

    2. **Append a new `describe` block at the BOTTOM of the file** (after line 143's closing brace):
       ```typescript
       describe("Phase 30 — spatial chips in FilterBar (CHIP-V15-01/02)", () => {
         const dashboardId = 1;
         const tableId = 42;
         const dashboard = {
           id: dashboardId,
           name: "Test Dashboard",
           created_at: "2026-05-12T00:00:00Z",
           updated_at: "2026-05-12T00:00:00Z",
         };
         const associatedTable = {
           id: 1,
           dashboard_id: dashboardId,
           schema_name: "demo",
           table_name: "trips",
           position: 0,
         };
         const dashboardTable = {
           id: tableId,
           schema_name: "demo",
           table_name: "trips",
           columns: { lon: "double", lat: "double", zone: "string" },
         };
         const mapWidgetWithLatlonTarget = {
           id: 100,
           dashboard_id: dashboardId,
           title: "Map",
           type: "map",
           position: 0,
           config: {
             spatialTargets: [
               { tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
             ],
           },
           created_at: "2026-05-12T00:00:00Z",
           updated_at: "2026-05-12T00:00:00Z",
         };

         beforeEach(() => {
           useSpatialFilterStore.getState().reset();
           useFilterStore.getState().reset();
           useFilterViewStore.getState().reset();
           // Reset every api/client mock to default empty.
           (listDashboards as ReturnType<typeof vi.fn>).mockResolvedValue([dashboard]);
           (listAssociatedTables as ReturnType<typeof vi.fn>).mockResolvedValue([associatedTable]);
           (listDashboardTables as ReturnType<typeof vi.fn>).mockResolvedValue([dashboardTable]);
           (listViews as ReturnType<typeof vi.fn>).mockResolvedValue([]);
           (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue([]);
         });

         // Helper: render DashboardsPage, wait for the dashboard list to load, click into the
         // dashboard, then wait for the FilterBar / widgets to be ready.
         const openDashboard = async (widgets: unknown[]) => {
           (listWidgets as ReturnType<typeof vi.fn>).mockResolvedValue(widgets);
           const utils = render(<DashboardsPage onViewChange={() => {}} />);
           // Wait for the dashboard's name/link to appear, then click.
           const dashboardLink = await screen.findByText(dashboard.name);
           await userEvent.click(dashboardLink);
           // Wait for widgets to load (mocked listWidgets resolves).
           await waitFor(() => {
             expect(listWidgets).toHaveBeenCalled();
           });
           return utils;
         };

         it("renders a spatial chip with format '{label} ({measurement})' inside the targeted table's row", async () => {
           // Pre-seed the shape BEFORE opening — the FilterBar reads useSpatialFilterStore.
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox",
               wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
               measurement: "5km × 3km",
             });
           });
           await openDashboard([mapWidgetWithLatlonTarget]);
           // Phase 27 auto-label rule: addShape with type="bbox" → label "Bbox 1".
           const chipText = await screen.findByText("Bbox 1 (5km × 3km)");
           expect(chipText).toBeInTheDocument();
           // The chip text is inside a .filter-bar-chip span.
           const chipSpan = chipText.closest(".filter-bar-chip");
           expect(chipSpan).not.toBeNull();
           // The × button has the discretion-locked aria-label.
           const dismissBtn = await screen.findByLabelText("Remove spatial filter Bbox 1");
           expect(dismissBtn).toBeInTheDocument();
           expect(dismissBtn.className).toContain("filter-bar-chip-dismiss");
         });

         it("does NOT render a spatial chip when no map widget has an eligible target for this tableId (orphan)", async () => {
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox",
               wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
               measurement: "5km × 3km",
             });
           });
           // widgets=[] → aggregateSpatialTargetsByTable returns empty Map → no chips.
           await openDashboard([]);
           // The shape persists in the store...
           expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
           // ...but the chip text is absent from the DOM.
           expect(screen.queryByText(/Bbox \d+ \(/)).toBeNull();
           expect(screen.queryByLabelText(/Remove spatial filter/)).toBeNull();
         });

         it("clicking the spatial chip × removes the shape from the store", async () => {
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox",
               wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
               measurement: "5km × 3km",
             });
           });
           await openDashboard([mapWidgetWithLatlonTarget]);
           expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
           const dismissBtn = await screen.findByLabelText("Remove spatial filter Bbox 1");
           await userEvent.click(dismissBtn);
           await waitFor(() => {
             expect(useSpatialFilterStore.getState().shapes).toHaveLength(0);
           });
           // Chip is gone from DOM after the store update propagates.
           await waitFor(() => {
             expect(screen.queryByText("Bbox 1 (5km × 3km)")).toBeNull();
           });
         });

         it("per-table 'Clear all' removes ALL shapes when this row has spatial chips (multi-target global nuke)", async () => {
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "5km × 3km",
             });
             useSpatialFilterStore.getState().addShape({
               type: "circle", wkt: "POLYGON((0 0,2 0,2 2,0 2,0 0))", measurement: "2.5 km",
             });
             useSpatialFilterStore.getState().addShape({
               type: "lasso", wkt: "POLYGON((0 0,3 0,3 3,0 3,0 0))", measurement: "12.4 km²",
             });
           });
           await openDashboard([mapWidgetWithLatlonTarget]);
           expect(useSpatialFilterStore.getState().shapes).toHaveLength(3);
           // Wait for the Clear all button to appear (FilterBar row visible because shapes exist).
           const clearAllBtn = await screen.findByRole("button", { name: /clear all/i });
           await userEvent.click(clearAllBtn);
           await waitFor(() => {
             expect(useSpatialFilterStore.getState().shapes).toHaveLength(0);
           });
           // All chip texts removed from DOM.
           await waitFor(() => {
             expect(screen.queryByText(/Bbox 1/)).toBeNull();
             expect(screen.queryByText(/Circle 1/)).toBeNull();
             expect(screen.queryByText(/Lasso 1/)).toBeNull();
           });
         });

         it("per-table 'Clear all' clears BOTH column filters AND shapes when both are present", async () => {
           act(() => {
             useFilterStore.getState().addFilter(tableId, {
               column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: Date.now(),
             });
             useSpatialFilterStore.getState().addShape({
               type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "5km × 3km",
             });
           });
           await openDashboard([mapWidgetWithLatlonTarget]);
           expect(useFilterStore.getState().filters[tableId]).toHaveLength(1);
           expect(useSpatialFilterStore.getState().shapes).toHaveLength(1);
           // BOTH chips should be present.
           expect(await screen.findByText("Bbox 1 (5km × 3km)")).toBeInTheDocument();
           const clearAllBtn = await screen.findByRole("button", { name: /clear all/i });
           await userEvent.click(clearAllBtn);
           await waitFor(() => {
             // Column filter cleared (clearFilters deletes the tableId key per filterStore semantics).
             const colFilters = useFilterStore.getState().filters[tableId] ?? [];
             expect(colFilters).toHaveLength(0);
           });
           await waitFor(() => {
             expect(useSpatialFilterStore.getState().shapes).toHaveLength(0);
           });
           // No chips of either type remain.
           await waitFor(() => {
             expect(screen.queryByText("Bbox 1 (5km × 3km)")).toBeNull();
           });
         });

         it("a row appears in FilterBar for a tableId that has ONLY spatial chips (no column filters, no static clause)", async () => {
           // No column filter, no static clause via listViews — only a shape.
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "5km × 3km",
             });
           });
           await openDashboard([mapWidgetWithLatlonTarget]);
           // The FilterBar should be visible because hasAnySpatialChips is true.
           // The shape chip appears in the targeted table's row.
           expect(await screen.findByText("Bbox 1 (5km × 3km)")).toBeInTheDocument();
           // No column filter chips present.
           expect(screen.queryByLabelText(/Remove filter zone/)).toBeNull();
         });
       });
       ```

    3. **Note on render-strategy fallback:** if `userEvent.click(dashboardLink)` does not successfully open the dashboard (e.g., the dashboard list renders as a different control), inspect the rendered DOM with `screen.debug()` during a one-off run and adjust the click target. The existing smoke test at line 140 confirms the page mounts cleanly — the Phase 30 tests build on the same render call.

    4. **DO NOT modify the existing 5 tests** (lines 28-142). Phase 30 adds only the new `describe` block.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "describe(\"Phase 30 — spatial chips in FilterBar" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns 1 match
    - `grep -c "  it(" kinetica_bi/src/components/DashboardsPage.spec.tsx` shows AT LEAST 11 tests (5 existing + 6 new Phase 30)
    - `grep -n "Bbox 1 (5km × 3km)" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns at least 3 matches (3+ tests assert exact chip text)
    - `grep -n "Remove spatial filter" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns at least 2 matches (aria-label assertions)
    - `grep -n "useSpatialFilterStore.getState().addShape" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns at least 6 matches (across 5+ new tests)
    - `grep -n "useSpatialFilterStore.getState().shapes" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns at least 6 matches (length assertions in 4+ tests)
    - `grep -n "userEvent.click" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns at least 3 matches (open-dashboard click + chip × clicks + Clear-all clicks)
    - `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx` exits 0 with all 11 tests passing
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>DashboardsPage.spec.tsx has 6 new tests covering chip render / orphan absence / chip × removal / global Clear all / mixed-row Clear all / spatial-only row discovery; all pass; tsc clean.</done>
</task>

</tasks>

<verification>
1. `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx` — green
2. `cd kinetica_bi && npx tsc --noEmit` — exits 0
3. `cd kinetica_bi && npx vitest run` — full frontend suite green
4. `grep -n "useSpatialFilterStore" kinetica_bi/src/components/DashboardsPage.tsx` returns at least 3 matches (existing reset + new selector + chip handler + clear-all handler)
5. `grep -n "filter-bar-chip" kinetica_bi/src/components/DashboardsPage.tsx` returns at least 3 matches (column chip span + spatial chip span + dismiss button)
6. Manual smoke test (run after Plan 30-02 + 30-03 both land): start dev server, open a dashboard with a map widget configured with a latlon spatial target. Draw a bbox shape → a chip "Bbox 1 (W×H)" appears in the FilterBar inside the targeted table's row. Click the chip × → chip disappears, materialize re-fires, tiles revert. Re-draw 2 shapes, click per-table "Clear all" → both shapes gone, FilterBar row disappears (if no column filters remain).
</verification>

<success_criteria>
- Spatial chips render in the same `.filter-bar-chips` row as column chips, with text format `{label} ({measurement})` (e.g., `Bbox 1 (5km × 3km)`) — exact verbatim format from CONTEXT.md lock
- Chip × calls `useSpatialFilterStore.getState().removeShape(shape.id)` — verified by test 3
- Per-table "Clear all" nukes both column filters (via `useFilterStore.getState().clearFilters(tableId)`) AND every shape (via `useSpatialFilterStore.getState().removeShape(id)` loop) when this row has spatial chips — verified by tests 4+5
- Orphan shapes produce no chips — verified by test 2
- Spatial-only tableIds (no column filters) appear in the FilterBar — verified by test 6
- 6 new spec tests in DashboardsPage.spec.tsx; tsc clean; full frontend vitest green
</success_criteria>

<output>
After completion, create `.planning/phases/30-materialize-and-chips/30-03-SUMMARY.md` capturing:
- The exact chip JSX shipped (the span structure + onClick handler)
- The exact per-table "Clear all" handler logic (column branch + spatial loop)
- The exact aria-label format used (matches CONTEXT.md discretion guidance)
- Test counts in DashboardsPage.spec.tsx (before/after — should be 5 → 11)
- Confirmation that the existing `.filter-bar-chip` + `.filter-bar-chip-dismiss` CSS classes were REUSED without modification (no new CSS shipped — CONTEXT.md lock)
- Any deviation from `<action>` (e.g., if the `userEvent.click` flow needed adjustment for the dashboard-open trigger) and the rationale
- Confirmation that the closed loop works end-to-end: Plan 30-02's Effect 1 + Plan 30-03's chips compose correctly because both subscribe to spatialFilterVersion / shapes
</output>
</content>
</invoke>