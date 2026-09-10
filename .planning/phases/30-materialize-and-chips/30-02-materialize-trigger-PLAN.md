---
phase: 30-materialize-and-chips
plan: 02
type: execute
wave: 2
depends_on: [30-01]
files_modified:
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - MAT-V15-01
  - MAT-V15-03
must_haves:
  truths:
    - "Drawing a shape on any map increments useSpatialFilterStore.spatialFilterVersion, which AggregatedWidgetRenderer reads via a primitive selector and uses as the 5th dep of Effect 1"
    - "AggregatedWidgetRenderer Effect 1 sends spatialFilters (projected from Shape[] as { id: s.id, wkt: s.wkt } — byte-parity with kinetica_bi/server/src/lib/spatialWhereClause.ts SpatialFilter) + spatialTarget (from targetsByTable.get(tableId)) when an eligible target exists for this widget's tableId"
    - "AggregatedWidgetRenderer Effect 1 omits spatial fields and falls through to v1.3 column-only behavior when targetsByTable has no entry for this tableId (orphan-shape case)"
    - "The DROP branch fires when tableFilters.length === 0 AND (no myTarget OR shapes.length === 0) — i.e. there is nothing to filter on for this table"
    - "MapChartRenderer is NOT touched — single-materialize-trigger invariant preserved"
    - "WKB targets cannot reach the wire because aggregateSpatialTargetsByTable filters via isSpatialTargetEligible. This is verified by Plan 30-01 Task 1's spec test 'skips WKB-mode targets — widget with only WKB target yields no entry for its tableId' (spatialTargets.spec.ts), which proves WKB targets are absent from targetsByTable at the source — hence cannot reach Effect 1 in Plan 30-02."
    - "_mv / materializeVersion increment is satisfied by existing useFilterViewStore.setView code at kinetica_bi/src/store/filterViewStore.ts:67 — fires on every setView call regardless of spatial-or-column trigger. Phase 30 spatial materialize calls flow through setView identically to column-only materialize, so _mv increment for spatial triggers is automatic. The 'spatialFilterVersion dep' test in WidgetRenderer.spec.tsx (Task 2) implicitly exercises this code path — addShape → Effect 1 fires → materializeFilter resolves → setView called → materializeVersion advances."
  artifacts:
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "AggregatedWidgetRenderer with spatialFilterVersion dep, targetsByTable memo, extended materialize payload"
      contains: "spatialFilterVersion"
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx"
      provides: "Coverage for 5 new Phase 30 scenarios + repaired DashboardContextProvider widgets prop + materializeVersion advance assertion"
      contains: "spatialFilterVersion"
  key_links:
    - from: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      to: "useSpatialFilterStore"
      via: "primitive selector for spatialFilterVersion + getState() reads for shapes"
      pattern: "useSpatialFilterStore\\(.*spatialFilterVersion"
    - from: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      to: "kinetica_bi/src/lib/spatialTargets.ts"
      via: "aggregateSpatialTargetsByTable call inside useMemo on widgets"
      pattern: "aggregateSpatialTargetsByTable\\(widgets\\)"
    - from: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      to: "kinetica_bi/src/api/client.ts materializeFilter"
      via: "extended payload with spatialFilters + spatialTarget when myTarget exists"
      pattern: "spatialFilters,\\s*spatialTarget"
    - from: "Effect 1 dep array"
      to: "spatialFilterVersion"
      via: "5th element after [sql, filterVersion, dashboardId, tableId]"
      pattern: "\\[sql, filterVersion, dashboardId, tableId, spatialFilterVersion\\]"
---

<objective>
Wire `useSpatialFilterStore` into the v1.3 materialize pipeline by extending `AggregatedWidgetRenderer` (and ONLY this component — `MapChartRenderer` stays untouched per the single-materialize-trigger invariant). After this plan, drawing a shape on any map widget bumps `spatialFilterVersion`, which is the 5th dep of Effect 1's dep array; the 300ms debounce + `materializeAbortRef` then sends a combined `{filters, spatialFilters, spatialTarget}` payload to `POST /api/filter/materialize`; the resulting view name flows through `useFilterViewStore` and the existing `_mv` cache-buster as before.

Purpose: This is the load-bearing change of Phase 30. The eligibility gate `isSpatialTargetEligible` (composed inside `aggregateSpatialTargetsByTable`) guarantees WKB targets never reach the wire (MAT-V15-03 client-time gate). Orphan shapes (no eligible target for any table) fall through to v1.3 column-only behavior, preserving the "drawing always succeeds" UX from Phase 29.

`_mv` cache-buster note: `materializeVersion` (which composes into the `_mv` query param) is already incremented inside `useFilterViewStore.setView` at `kinetica_bi/src/store/filterViewStore.ts:67`. That call fires on EVERY successful materialize regardless of trigger source — `setView` does not discriminate between column-only and spatial-triggered materializes. Phase 30 routes its spatial materialize calls through the SAME setView path, so `_mv` increment is automatic and requires NO new wiring in this plan.

Output: Modified AggregatedWidgetRenderer with 5th dep, payload extension, DROP-branch extension, plus updated WidgetRenderer.spec.tsx with widgets prop repair + 5 new test cases. MapChartRenderer is NOT touched.
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

# Source files this plan modifies — read before editing
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

# Foundation from Plan 30-01 (consumed but not modified by this plan)
@kinetica_bi/src/lib/spatialTargets.ts
@kinetica_bi/src/components/DashboardContext.tsx
@kinetica_bi/src/api/client.ts

# Store contract from Phase 27 (read-only — never mutate from this plan)
@kinetica_bi/src/store/spatialFilterStore.ts

# Phase 15 setView contract — pre-existing _mv increment site (DO NOT MODIFY)
@kinetica_bi/src/store/filterViewStore.ts

<interfaces>
<!-- Plan 30-01 exports — use as-is. -->

From kinetica_bi/src/lib/spatialTargets.ts (Plan 30-01 added):
```typescript
export function aggregateSpatialTargetsByTable(
  widgets: WidgetDto[],
): Map<number, SpatialTarget>;
```

From kinetica_bi/src/components/DashboardContext.tsx (Plan 30-01 extended):
```typescript
export type DashboardContextValue = {
  dashboardId: number;
  widgets: WidgetDto[];
};
export const useDashboardContext = (): DashboardContextValue;
```

From kinetica_bi/src/api/client.ts (Plan 30-01 extended):
```typescript
export type SpatialFilter = { id: string; wkt: string };
export type { SpatialTarget } from "../lib/spatialTargets";
export type MaterializeFilterArgs = {
  dashboardId: number;
  tableId: number;
  filters: ActiveFilter[];
  spatialFilters?: SpatialFilter[];
  spatialTarget?: SpatialTarget;
};
```

From kinetica_bi/src/store/spatialFilterStore.ts (Phase 27 — read-only):
```typescript
export type Shape = {
  id: string;
  type: "bbox" | "lasso" | "circle";
  wkt: string;          // EPSG:4326
  label: string;
  measurement: string;
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

From kinetica_bi/src/store/filterViewStore.ts (Phase 15 — read-only; _mv increment site):
```typescript
// At line 67 inside setView's reducer:
materializeVersion: sameName ? prev!.materializeVersion + 1 : 1,
// This fires on EVERY successful setView call. Phase 30 spatial materialize routes
// through this same setView path → _mv increment is automatic for spatial triggers.
```

Key existing code in WidgetRenderer.tsx (AggregatedWidgetRenderer starts at line 222):
- Line 240-246: useFilterStore selectors (tableFilters + filterVersion)
- Line 250-270: useFilterViewStore selectors (viewName, expiresAt, materializing, clearMaterializingVersion)
- Line 274: const dashboardId = useDashboardContext().dashboardId  ← Plan 30-02 changes this destructure
- Line 279: materializeAbortRef
- Lines 284-325: Effect 1 (materialize trigger)
  - Line 285: if (tableId === undefined) return;
  - Line 292: if (tableFilters.length === 0) { dropFilterView + clearView; return; }
  - Line 301: markMaterializing
  - Lines 303-306: materializeFilter call with payload
  - Line 325: dep array: [sql, filterVersion, dashboardId, tableId]
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend AggregatedWidgetRenderer Effect 1 with spatialFilterVersion dep, targetsByTable memo, and combined payload</name>
  <files>kinetica_bi/src/components/charts/WidgetRenderer.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx lines 1-450 (imports through Effect 1+2)
    - kinetica_bi/src/store/spatialFilterStore.ts (Shape type + spatialFilterVersion semantics)
    - kinetica_bi/src/lib/spatialTargets.ts (aggregateSpatialTargetsByTable signature — added by Plan 30-01)
    - kinetica_bi/src/components/DashboardContext.tsx (Plan 30-01 widgets extension)
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md `<decisions>` § "Materialize payload contract" + "SpatialTarget resolution"
    - .planning/STATE.md § "Sole materialize trigger invariant preserved (Phase 30)" — do NOT add any materialize call to MapChartRenderer
  </read_first>
  <behavior>
    - When useDashboardContext() returns widgets, AggregatedWidgetRenderer derives `targetsByTable = useMemo(() => aggregateSpatialTargetsByTable(widgets), [widgets])`
    - `myTarget` is derived as `tableId !== undefined ? targetsByTable.get(tableId) : undefined`
    - A primitive selector `spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion)` is added
    - Effect 1's dep array becomes `[sql, filterVersion, dashboardId, tableId, spatialFilterVersion]` — exactly 5 deps in that order
    - Inside Effect 1's setTimeout callback: read `shapes` ONCE via `useSpatialFilterStore.getState().shapes` (imperative; not a selector — avoids stale-closure or extra re-render)
    - When `myTarget` exists AND `shapes.length > 0`: build `spatialFilters = shapes.map(s => ({ id: s.id, wkt: s.wkt }))` (projection: keep only id + wkt; drop type/label/measurement/addedAt which are UI-only). The `{ id, wkt }` shape is BYTE-PARITY with kinetica_bi/server/src/lib/spatialWhereClause.ts SpatialFilter (the server keeps `id` as an audit-log breadcrumb).
    - When `myTarget` exists AND `shapes.length > 0`: materializeFilter payload is `{dashboardId, tableId, filters: tableFilters, spatialFilters, spatialTarget: myTarget}` (4 fields populated)
    - When `myTarget` does NOT exist OR `shapes.length === 0`: omit spatialFilters AND spatialTarget — payload is the v1.3 shape `{dashboardId, tableId, filters: tableFilters}` (orphan-shape fallthrough)
    - DROP branch extension: `if (tableFilters.length === 0 && (!myTarget || shapes.length === 0))` — fire dropFilterView + clearView and return. Otherwise (column-only OR spatial-only OR combined non-empty) proceed to markMaterializing + materializeFilter
    - MapChartRenderer.tsx is NOT modified by this plan — single-materialize-trigger invariant preserved
  </behavior>
  <action>
    Make these targeted edits in `kinetica_bi/src/components/charts/WidgetRenderer.tsx`:

    1. **Imports (top of file, around lines 23-34):**
       - Add `useMemo` to the React import on line 1: `import { useEffect, useMemo, useRef, useState } from "react";`
       - Add a new import after the existing store imports: `import { useSpatialFilterStore } from "../../store/spatialFilterStore";`
       - Add an import for the helper: `import { aggregateSpatialTargetsByTable } from "../../lib/spatialTargets";`

    2. **Replace the `useDashboardContext` destructure at line 274:**
       Before: `const dashboardId = useDashboardContext().dashboardId;`
       After:
       ```typescript
       // Phase 30 (MAT-V15-02): read both dashboardId and widgets from context. widgets feeds
       // the per-table SpatialTarget aggregation memo below. Provider supplies widgets via
       // Plan 30-01 wiring in DashboardsPage.tsx.
       const { dashboardId, widgets } = useDashboardContext();
       ```

    3. **Add the targetsByTable memo + myTarget derivation IMMEDIATELY AFTER the destructure (before the `materializeAbortRef` declaration at line 279):**
       ```typescript
       // Phase 30 (MAT-V15-02 + MAT-V15-03): resolve per-table eligible spatial target.
       // First-eligible-target-per-table from the lowest-id map widget wins (deterministic
       // across renders; see lib/spatialTargets.ts aggregateSpatialTargetsByTable contract).
       // WKB and incomplete targets are filtered out by isSpatialTargetEligible inside the
       // helper — myTarget is GUARANTEED eligible or undefined.
       const targetsByTable = useMemo(
         () => aggregateSpatialTargetsByTable(widgets),
         [widgets],
       );
       const myTarget = tableId !== undefined
         ? targetsByTable.get(tableId)
         : undefined;

       // Phase 30 (MAT-V15-01): primitive-selector subscription to spatialFilterVersion.
       // Increments on every successful shape mutation (addShape / removeShape existing /
       // clearAll when non-empty); resets to 0 on store.reset(). This is the 5th dep of
       // Effect 1 below — mirrors PITFALL S-02 lock (counter, NOT array reference, in dep array).
       const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
       ```

    4. **Rewrite Effect 1's body (lines 284-325).** Keep the 300ms debounce, AbortController, markMaterializing/setView/clearMaterializing structure intact. Add the spatial-aware DROP guard, the imperative `shapes` read, and the conditional payload extension. Replace the existing Effect 1 with:
       ```typescript
       // Effect 1 (NEW) — Materialize trigger (debounced 300ms).
       // V13-P-01 lock: markMaterializing → await materializeFilter → setView (POST-200 only).
       // V13-P-09 accepted: multi-tab same-user same-session = last-write-wins on view content.
       // Phase 30 (MAT-V15-01): spatialFilterVersion is the 5th dep; payload includes
       // spatialFilters + spatialTarget when myTarget exists AND shapes.length > 0 (orphan-shape
       // fallthrough: missing myTarget falls back to v1.3 column-only path silently).
       // _mv cache-buster: setView at filterViewStore.ts:67 increments materializeVersion on
       // every successful resolve — fires identically for column-only and spatial-triggered
       // materializes; no new wiring needed in this effect for _mv.
       useEffect(() => {
         if (tableId === undefined) return;
         const timer = setTimeout(async () => {
           // Abort prior in-flight materialize before firing a new one.
           materializeAbortRef.current?.abort();
           const controller = new AbortController();
           materializeAbortRef.current = controller;

           // Phase 30: read shapes IMPERATIVELY (one-shot) inside the debounce callback.
           // Not a selector — avoids re-rendering on every store mutation; spatialFilterVersion
           // is the dep that drives re-fire. Stale-closure-safe because Effect 1 re-creates on
           // spatialFilterVersion change.
           const shapes = useSpatialFilterStore.getState().shapes;
           const hasShapesForThisTable = myTarget !== undefined && shapes.length > 0;

           // Phase 30 DROP guard extension: drop the view when there is NOTHING to filter on
           // for this table. tableFilters empty + (no eligible target for this table OR no
           // shapes drawn) → no WHERE clause needed → drop any stale view.
           if (tableFilters.length === 0 && !hasShapesForThisTable) {
             // V13-P-12: ignore drop errors — cleanup, nothing to surface.
             dropFilterView({ dashboardId, tableId }).catch(() => {});
             useFilterViewStore.getState().clearView(tableId);
             return;
           }

           // Non-empty filters branch — markMaterializing → await → setView.
           useFilterViewStore.getState().markMaterializing(tableId, dashboardId);
           try {
             // Phase 30 payload extension: project Shape → SpatialFilter (id + wkt only) at the
             // wire boundary; UI-only fields (type, label, measurement, addedAt) stay client-side.
             // Server contract: pair-completeness — spatialFilters + spatialTarget go together
             // or both are omitted. When hasShapesForThisTable is false, omit BOTH.
             // BYTE-PARITY with server SpatialFilter at spatialWhereClause.ts:63 — { id, wkt }.
             const args: import("../../api/client").MaterializeFilterArgs = hasShapesForThisTable
               ? {
                   dashboardId,
                   tableId,
                   filters: tableFilters,
                   spatialFilters: shapes.map((s) => ({ id: s.id, wkt: s.wkt })),
                   spatialTarget: myTarget,
                 }
               : { dashboardId, tableId, filters: tableFilters };
             const result = await materializeFilter(args, controller.signal);
             // setView at filterViewStore.ts:67 bumps materializeVersion → _mv cache-buster fires.
             useFilterViewStore.getState().setView(tableId, result, dashboardId);
           } catch (err) {
             // AbortError is expected on rapid filter changes — silent (matches Phase 9 lock).
             if ((err as Error)?.name === "AbortError") return;
             // Phase 17-02: clearMaterializing lifts the Effect 2 suspend gate so the chart query
             // falls through to raw FROM <table>. Without this, the entry stays with materializing=true
             // indefinitely after an error and the chart query is permanently blocked.
             if (tableId !== undefined) {
               useFilterViewStore.getState().clearMaterializing(tableId);
             }
             useToastStore.getState().showToast((err as Error).message, "error");
           }
         }, 300);
         return () => clearTimeout(timer);
         // PITFALL S-02: filterVersion + spatialFilterVersion are primitive deps; tableFilters
         // and shapes references are unstable when empty. myTarget is NOT in deps — it changes
         // only when widgets changes, which triggers a render that re-creates this effect anyway.
         // eslint-disable-next-line react-hooks/exhaustive-deps
       }, [sql, filterVersion, dashboardId, tableId, spatialFilterVersion]);
       ```

    5. **DO NOT modify Effect 2 (lines 339-449) or the LIFE-V13-02 reactive-retry block.** That code path also handles the spatial case correctly by calling materializeFilter with the existing args structure — but for Phase 30 minimal-diff we leave the reactive retry on the v1.3 column-only path. (The retry is rare; spatial-aware retry can be a Phase 31 / v1.6 follow-up if operator UAT surfaces a need.)

    6. **DO NOT touch MapChartRenderer.tsx.** Single-materialize-trigger invariant lock (STATE.md "Sole materialize trigger invariant preserved"). If a future plan needs to call materialize from MapChartRenderer, it requires explicit roadmap decision.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/components/charts/WidgetRenderer.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "useMemo" kinetica_bi/src/components/charts/WidgetRenderer.tsx` shows useMemo imported and used (at least 2 matches — import + memo call)
    - `grep -n "import { useSpatialFilterStore }" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "import { aggregateSpatialTargetsByTable }" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "const { dashboardId, widgets } = useDashboardContext()" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "aggregateSpatialTargetsByTable(widgets)" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "const myTarget = tableId !== undefined" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "useSpatialFilterStore((s) => s.spatialFilterVersion)" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "useSpatialFilterStore.getState().shapes" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "hasShapesForThisTable" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns AT LEAST 3 matches (declaration + DROP guard + payload conditional)
    - `grep -n "shapes.map((s) => ({ id: s.id, wkt: s.wkt }))" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns 1 match
    - `grep -n "\\[sql, filterVersion, dashboardId, tableId, spatialFilterVersion\\]" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns exactly 1 match (Effect 1 dep array)
    - `grep -n "materializeFilter\\|dropFilterView" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0 matches (single-trigger invariant preserved)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx` exits 0 (Task 1 may temporarily break tests that Plan 30-01 didn't repair; Task 2 below adds the widgets prop to every existing wrap call and adds new tests — so this verify runs AFTER Task 2's repairs land, OR Task 1's executor must apply the mechanical wrap-helper repair too. PREFERRED: Task 1 also updates the wrap helper at line 48 of WidgetRenderer.spec.tsx to default `widgets = []` so the existing tests pass as a side-effect — Task 2 then ONLY adds new tests and MapChartRenderer.spec.tsx repair.)
  </acceptance_criteria>
  <done>AggregatedWidgetRenderer reads widgets+spatialFilterVersion, memoizes targetsByTable, derives myTarget, sends combined-or-column-only payload, DROP guard extended, MapChartRenderer untouched, tsc green, WidgetRenderer.spec.tsx green (existing tests preserved via wrap-helper default widgets=[]).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Repair WidgetRenderer.spec.tsx + MapChartRenderer.spec.tsx wrappers and add 5 Phase 30 scenario tests</name>
  <files>kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx lines 1-100 (wrap helper at line 48)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx — search for `DashboardContextProvider` usage and update every mount
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (post-Task 1 state) — the new Effect 1 + targetsByTable shape
    - kinetica_bi/src/store/spatialFilterStore.ts — useSpatialFilterStore + Shape (for test fixtures)
    - kinetica_bi/src/store/filterViewStore.ts lines 59-73 — setView reducer; materializeVersion increment site
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md `<decisions>` § "Test surface"
  </read_first>
  <behavior>
    - Every `<DashboardContextProvider dashboardId={N}>` mount in WidgetRenderer.spec.tsx becomes `<DashboardContextProvider dashboardId={N} widgets={[]}>` (or with a populated widgets fixture for new tests)
    - Same repair applied to MapChartRenderer.spec.tsx — every existing provider mount gains `widgets={[]}` so existing 125+ tests continue passing
    - 5 new tests in a new `describe("Phase 30 — spatial materialize trigger (MAT-V15-01/02/03)", ...)` block in WidgetRenderer.spec.tsx prove:
      1. `materializeFilter` receives ONLY `{dashboardId, tableId, filters}` (no spatial fields) when shapes exist but widgets array has no map widget with eligible target for this tableId (ORPHAN-SHAPE case)
      2. `materializeFilter` receives `{dashboardId, tableId, filters, spatialFilters, spatialTarget}` (combined payload) when widgets includes a map widget with an eligible latlon target for this tableId AND shapes exist
      3. Effect 1 re-fires (a second materializeFilter call is made) when `useSpatialFilterStore.getState().addShape(...)` is invoked AFTER initial render (proves spatialFilterVersion dep is wired); ALSO asserts `useFilterViewStore.getState().views[tableId].materializeVersion` advanced after the second materialize resolved — proves _mv cache-buster fires for spatial triggers via the pre-existing setView path at filterViewStore.ts:67
      4. DROP branch fires (dropFilterView is called, materializeFilter is NOT) when tableFilters is empty AND shapes is empty (existing v1.3 behavior preserved)
      5. DROP branch fires when tableFilters is empty AND shapes exist BUT no eligible target for this tableId (orphan-shape DROP fallthrough — extension of existing DROP semantics)
  </behavior>
  <action>
    1. **In `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`:**

       a. Update the `wrap` helper at line 48 to accept an optional widgets fixture:
       ```typescript
       const wrap = (
         ui: React.ReactNode,
         dashboardId = 1,
         widgets: import("../../api/client").WidgetDto[] = []
       ) => (
         <DashboardContextProvider dashboardId={dashboardId} widgets={widgets}>{ui}</DashboardContextProvider>
       );
       ```

       b. Existing tests that call `wrap(<WidgetRenderer ... />)` continue to pass `widgets=[]` (the new default). NO other change to existing tests needed — they all use the helper.

       c. Add the `useSpatialFilterStore` and `useFilterViewStore` imports near the existing store imports:
       ```typescript
       import { useSpatialFilterStore } from "../../store/spatialFilterStore";
       import { useFilterViewStore } from "../../store/filterViewStore";
       ```
       (Skip whichever is already imported — read first.)

       d. At the BOTTOM of the file, append the new describe block:
       ```typescript
       describe("Phase 30 — spatial materialize trigger (MAT-V15-01/02/03)", () => {
         const tableId = 99;
         const targetWidget: import("../../api/client").WidgetDto = {
           id: 100,
           dashboard_id: 1,
           title: "Map",
           type: "map",
           position: 0,
           config: {
             spatialTargets: [
               { tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
             ],
           } as unknown as Record<string, unknown>,
           created_at: "2026-05-12T00:00:00Z",
           updated_at: "2026-05-12T00:00:00Z",
         };

         beforeEach(() => {
           // Reset spatial store between tests (Zustand reset shim covers this automatically,
           // but call defensively in case of test-order surprises).
           useSpatialFilterStore.getState().reset();
           useFilterViewStore.getState().reset();
           // Default runSql + materializeFilter mocks for the happy path.
           (clientModule.runSql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
           (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
             viewName: "_kbi_filt_x",
             expiresAt: Date.now() + 60_000,
           });
           (clientModule.dropFilterView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ dropped: true });
         });

         it("ORPHAN: sends column-only payload (no spatial fields) when shapes exist but no map widget targets this tableId", async () => {
           const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
           // Add a column filter to force a materialize call.
           act(() => {
             useFilterStore.getState().addFilter(tableId, {
               column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: 0,
             });
           });
           // Add a shape — but no targetWidget in the widgets array (orphan).
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km × 1km",
             });
           });
           render(wrap(<WidgetRenderer widget={widget} />, 1, []));
           await waitFor(() => {
             expect(clientModule.materializeFilter).toHaveBeenCalled();
           });
           const callArgs = (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
           expect(callArgs).toMatchObject({ dashboardId: 1, tableId, filters: expect.any(Array) });
           expect("spatialFilters" in callArgs).toBe(false);
           expect("spatialTarget" in callArgs).toBe(false);
         });

         it("COMBINED: sends spatialFilters + spatialTarget alongside filters when an eligible target exists and shapes are drawn", async () => {
           const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
           act(() => {
             useFilterStore.getState().addFilter(tableId, {
               column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: 0,
             });
             useSpatialFilterStore.getState().addShape({
               type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km × 1km",
             });
           });
           render(wrap(<WidgetRenderer widget={widget} />, 1, [targetWidget]));
           await waitFor(() => {
             expect(clientModule.materializeFilter).toHaveBeenCalled();
           });
           const callArgs = (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
           expect(callArgs.spatialFilters).toHaveLength(1);
           expect(callArgs.spatialFilters[0]).toMatchObject({ wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" });
           expect(callArgs.spatialFilters[0].id).toMatch(/.+/); // randomUUID present
           expect(callArgs.spatialTarget).toEqual({ tableId, spatialMode: "latlon", lonCol: "lon", latCol: "lat" });
         });

         it("spatialFilterVersion dep: addShape after initial render triggers a second materializeFilter call AND advances materializeVersion (_mv cache-buster path)", async () => {
           const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
           act(() => {
             useFilterStore.getState().addFilter(tableId, {
               column: "zone", value: "East", dataType: "string", sourceWidgetId: 1, addedAt: 0,
             });
           });
           render(wrap(<WidgetRenderer widget={widget} />, 1, [targetWidget]));
           await waitFor(() => {
             expect((clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
           });
           // Wait for first setView to land (proves first materializeVersion increment).
           await waitFor(() => {
             expect(useFilterViewStore.getState().views[tableId]?.materializeVersion ?? 0).toBeGreaterThanOrEqual(1);
           });
           const initialCalls = (clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
           const initialMv = useFilterViewStore.getState().views[tableId].materializeVersion;
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "circle", wkt: "POLYGON((0 0,2 0,2 2,0 2,0 0))", measurement: "2 km",
             });
           });
           await waitFor(() => {
             expect((clientModule.materializeFilter as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCalls);
           });
           // _mv ASSERTION (Blocker 3 lock): materializeVersion advanced after the spatial-triggered
           // materialize resolved. This proves setView at filterViewStore.ts:67 fired for the spatial
           // path identically to column-only — Phase 30 does NOT need to wire _mv, it is automatic.
           await waitFor(() => {
             expect(useFilterViewStore.getState().views[tableId].materializeVersion).toBeGreaterThan(initialMv);
           });
         });

         it("DROP: empty column filters + empty shapes → dropFilterView called, materializeFilter NOT called", async () => {
           const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
           render(wrap(<WidgetRenderer widget={widget} />, 1, [targetWidget]));
           await waitFor(() => {
             expect(clientModule.dropFilterView).toHaveBeenCalledWith(
               expect.objectContaining({ dashboardId: 1, tableId }),
             );
           });
           expect(clientModule.materializeFilter).not.toHaveBeenCalled();
         });

         it("ORPHAN-DROP: empty column filters + shapes drawn + no eligible target for this tableId → dropFilterView called (orphan fallthrough)", async () => {
           const widget = makeAggregatedWidget({ id: 1, config: { sql: "SELECT 1", tableId } });
           act(() => {
             useSpatialFilterStore.getState().addShape({
               type: "bbox", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))", measurement: "1km × 1km",
             });
           });
           // widgets=[] → no eligible target for tableId → orphan-shape case → DROP fires.
           render(wrap(<WidgetRenderer widget={widget} />, 1, []));
           await waitFor(() => {
             expect(clientModule.dropFilterView).toHaveBeenCalled();
           });
           expect(clientModule.materializeFilter).not.toHaveBeenCalled();
         });
       });
       ```

       Note: read `kinetica_bi/src/api/client.ts:610-628` (`dropFilterView` signature) before writing the DROP assertion — if it takes ONE arg (no signal), drop the second matcher entirely (as shown above). If it takes two args, append `expect.anything()`.

    2. **In `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`:**

       a. Find EVERY `<DashboardContextProvider dashboardId={...}>` mount (use grep). For each, append `widgets={[]}`:
          - Before: `<DashboardContextProvider dashboardId={1}>...</DashboardContextProvider>`
          - After:  `<DashboardContextProvider dashboardId={1} widgets={[]}>...</DashboardContextProvider>`

       b. If the spec defines a wrap helper, update its signature to default `widgets = []` (mirror the WidgetRenderer.spec.tsx pattern).

       c. NO new tests added here — Phase 30 does not change MapChartRenderer production code. The repair is mechanical: keep the existing 125 tests green by satisfying the new required `widgets` prop on the provider.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/MapChartRenderer.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "widgets={\[\]}\\|widgets={widgets}\\|widgets: \[\\|widgets=\[targetWidget\\|widgets, \[targetWidget" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` returns AT LEAST 5 matches (wrap default + 4 new-test mounts that pass widgets)
    - `grep -n "describe(\"Phase 30 — spatial materialize trigger" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` returns 1 match
    - `grep -c "  it(\"ORPHAN\\|  it(\"COMBINED\\|  it(\"spatialFilterVersion dep\\|  it(\"DROP\\|  it(\"ORPHAN-DROP" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` returns 5 (5 new tests in the Phase 30 block)
    - `grep -n "materializeVersion).toBeGreaterThan(initialMv)" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` returns 1 match (_mv assertion present per Blocker 3 lock)
    - `grep -c "<DashboardContextProvider" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` count matches `grep -c "widgets={\[\]}\\|widgets={widgets}" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` count (every provider mount has widgets prop)
    - `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx` exits 0
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>All existing WidgetRenderer + MapChartRenderer specs repaired to satisfy the widgets prop; 5 new Phase 30 tests cover orphan/combined/dep-trigger+_mv/drop/orphan-drop scenarios; both specs exit 0; tsc clean.</done>
</task>

</tasks>

<verification>
1. `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/MapChartRenderer.spec.tsx` — both green
2. `cd kinetica_bi && npx tsc --noEmit` — exits 0
3. `cd kinetica_bi && npx vitest run` — FULL frontend suite green (all 681+ tests; Phase 30 adds at least 5 + new spatialTargets/DashboardContext/client tests from Plan 30-01 = expected baseline ~700+)
4. `grep -n "materializeFilter\\|dropFilterView" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns 0 matches (sole-trigger invariant preserved)
5. `grep -n "spatialFilterVersion" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns at least 2 matches (selector + dep array)
6. `grep -n "materializeVersion).toBeGreaterThan" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` returns 1 match (_mv path exercised by test — Blocker 3)
7. Manual smoke test (run after Plan 30-03 lands): start dev server, open dashboard with a map widget configured with a latlon spatial target, draw a bbox → DevTools Network shows POST /api/filter/materialize with body containing `spatialFilters` + `spatialTarget`; chart tiles re-render filtered
</verification>

<success_criteria>
- AggregatedWidgetRenderer reads `widgets` from context, memoizes `targetsByTable`, derives `myTarget`, subscribes to `spatialFilterVersion`, sends combined-or-column-only payload, and extends the DROP guard to cover the orphan-shape case
- `MapChartRenderer.tsx` is byte-for-byte untouched (single-materialize-trigger invariant preserved)
- WidgetRenderer.spec.tsx + MapChartRenderer.spec.tsx are repaired to satisfy the new `widgets` provider prop, and 5 new Phase 30 tests prove ORPHAN / COMBINED / VERSION-TRIGGER+_MV / DROP / ORPHAN-DROP behaviors
- _mv cache-buster path is exercised by the spatialFilterVersion-dep test (materializeVersion advance assertion) — proves Phase 15's pre-existing setView increment site at filterViewStore.ts:67 fires identically for spatial-triggered materializes; no new wiring needed
- tsc clean; full frontend vitest green
</success_criteria>

<output>
After completion, create `.planning/phases/30-materialize-and-chips/30-02-SUMMARY.md` capturing:
- Confirmation of exact Effect 1 dep array (verbatim line number + content)
- Confirmation that MapChartRenderer.tsx has zero materialize-related changes (`git diff` summary)
- The exact payload-construction code (the args ternary) — load-bearing for any future audit
- Test counts: existing tests now passing with widgets prop + 5 new Phase 30 tests
- Confirmation that the _mv path was exercised (materializeVersion advance assertion present in the spatialFilterVersion-dep test)
- Any deviation from `<action>` and the rationale (e.g., if the dropFilterView call signature differs from the assertion's matcher)
- Confirmation that WKB cannot reach the wire (because aggregateSpatialTargetsByTable filters via isSpatialTargetEligible; Plan 30-01 Task 1's "skips WKB-mode targets" spec test is the backing verification at the source)
</output>
</content>
</invoke>