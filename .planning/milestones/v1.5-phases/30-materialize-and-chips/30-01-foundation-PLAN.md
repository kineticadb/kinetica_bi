---
phase: 30-materialize-and-chips
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/spatialTargets.ts
  - kinetica_bi/src/lib/spatialTargets.spec.ts
  - kinetica_bi/src/components/DashboardContext.tsx
  - kinetica_bi/src/components/DashboardContext.spec.tsx
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/api/client.spec.ts
  - kinetica_bi/src/components/DashboardsPage.tsx
autonomous: true
requirements:
  - MAT-V15-02
must_haves:
  truths:
    - "aggregateSpatialTargetsByTable returns a Map keyed by tableId from the eligible target of the lowest-id map widget"
    - "WKB targets and incomplete targets never appear in the returned map"
    - "DashboardContext exposes widgets: WidgetDto[] alongside dashboardId, threaded from DashboardsPage"
    - "materializeFilter wire payload accepts optional spatialFilters and spatialTarget without breaking v1.3 column-only callers"
  artifacts:
    - path: "kinetica_bi/src/lib/spatialTargets.ts"
      provides: "aggregateSpatialTargetsByTable(widgets: WidgetDto[]): Map<number, SpatialTarget>"
      contains: "export function aggregateSpatialTargetsByTable"
    - path: "kinetica_bi/src/lib/spatialTargets.spec.ts"
      provides: "Coverage for aggregateSpatialTargetsByTable across 6 scenarios"
      contains: "describe(\"aggregateSpatialTargetsByTable"
    - path: "kinetica_bi/src/components/DashboardContext.tsx"
      provides: "DashboardContextValue with widgets field; provider accepts widgets prop"
      contains: "widgets: WidgetDto[]"
    - path: "kinetica_bi/src/api/client.ts"
      provides: "MaterializeFilterArgs extended with spatialFilters? and spatialTarget? fields"
      contains: "spatialFilters?: SpatialFilter[]"
    - path: "kinetica_bi/src/api/client.spec.ts"
      provides: "Test asserting extended payload byte-for-byte"
      contains: "spatialFilters"
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "DashboardContextProvider mounted with widgets={widgets}"
      contains: "<DashboardContextProvider dashboardId={dashboard.id} widgets={widgets}>"
  key_links:
    - from: "kinetica_bi/src/lib/spatialTargets.ts"
      to: "getSpatialTargets + isSpatialTargetEligible"
      via: "internal composition inside aggregateSpatialTargetsByTable"
      pattern: "getSpatialTargets\\(w\\).*\\.filter\\(isSpatialTargetEligible\\)"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx"
      to: "DashboardContext"
      via: "JSX prop passing widgets array"
      pattern: "DashboardContextProvider[^>]*widgets="
    - from: "kinetica_bi/src/api/client.ts"
      to: "kinetica_bi/server/src/lib/spatialWhereClause.ts"
      via: "byte-parity SpatialFilter + SpatialTarget shapes in HTTP body"
      pattern: "spatialTarget\\?:\\s*SpatialTarget"
---

<objective>
Land the pure foundation pieces that Plans 30-02 (materialize trigger) and 30-03 (FilterBar chips) consume: (1) the `aggregateSpatialTargetsByTable` helper that resolves widget configs → one eligible target per table with deterministic widget-id-ascending tiebreaker; (2) the `DashboardContext` extension so `widgets: WidgetDto[]` is reachable from any descendant renderer (avoids prop-drilling); (3) the `MaterializeFilterArgs` payload extension so the client helper accepts optional `spatialFilters` + `spatialTarget` while staying backward-compatible with v1.3 column-only callers; and (4) the `DashboardsPage.tsx` provider wiring that passes the already-loaded `widgets` array into the context.

Purpose: Without this foundation, Plan 30-02 cannot read widgets from context, cannot determine eligible targets per table, and cannot send spatial fields over the wire. This plan is dormant — no production behavior change ships from this plan alone. Plans 30-02 and 30-03 are the first consumers.

Output: One new helper export + spec coverage, one extended context type + provider signature + spec coverage, one extended client payload type + spec coverage, one provider JSX prop wiring change. All TS strict, all existing tests still green.
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

# Source files this plan modifies — read before editing
@kinetica_bi/src/lib/spatialTargets.ts
@kinetica_bi/src/lib/spatialTargets.spec.ts
@kinetica_bi/src/components/DashboardContext.tsx
@kinetica_bi/src/components/DashboardContext.spec.tsx
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/api/client.spec.ts
@kinetica_bi/src/components/DashboardsPage.tsx

# Server-side byte-parity contract (Phase 26 lock)
@kinetica_bi/server/src/lib/spatialWhereClause.ts

<interfaces>
<!-- Existing exports the executor must use as-is (no exploration needed). -->

From kinetica_bi/src/lib/spatialTargets.ts (current — Phase 28):
```typescript
export type SpatialMode = "latlon" | "wkt" | "wkb";
export type SpatialTarget = {
  tableId: number;
  spatialMode: SpatialMode;
  lonCol?: string;
  latCol?: string;
  spatialCol?: string;
};
export function getSpatialTargets(
  widget: { config: Pick<MapWidgetConfig, "spatialTargets"> },
): SpatialTarget[];
export function isSpatialTargetEligible(target: SpatialTarget): boolean;
```

From kinetica_bi/src/lib/wmsUrlBuilder.ts:
```typescript
export type MapWidgetConfig = {
  // ...other fields...
  spatialTargets?: SpatialTarget[];   // Phase 28
};
```

From kinetica_bi/src/api/client.ts (current):
```typescript
export type WidgetDto = {
  id: number;
  dashboard_id: number;
  title: string;
  type: string;            // "map" | "bar" | "line" | "pie" | "scatter" | "table" | "records" | "bignumber" | "info-card"
  position: number;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MaterializeFilterArgs = {
  dashboardId: number;
  tableId: number;
  filters: ActiveFilter[];
};
```

From kinetica_bi/src/components/DashboardContext.tsx (current):
```typescript
export type DashboardContextValue = { dashboardId: number };
export const DashboardContextProvider = ({
  dashboardId, children,
}: { dashboardId: number; children: ReactNode; }) => (...);
export const useDashboardContext = (): DashboardContextValue => { ... };
```

From kinetica_bi/server/src/lib/spatialWhereClause.ts (BYTE-PARITY contract — Phase 26 locked):
```typescript
export type SpatialFilter = { id: string; wkt: string };
export type SpatialTarget = {
  tableId: number;
  spatialMode: "latlon" | "wkt" | "wkb";
  lonCol?: string; latCol?: string; spatialCol?: string;
};
```
Server endpoint POST /api/filter/materialize accepts body:
`{ dashboardId, tableId, filters: ActiveFilter[], spatialFilters?: SpatialFilter[], spatialTarget?: SpatialTarget }`.
Pair-completeness: spatialFilters and spatialTarget must both be present or both absent (server returns 400 otherwise).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add aggregateSpatialTargetsByTable helper to lib/spatialTargets.ts with spec</name>
  <files>kinetica_bi/src/lib/spatialTargets.ts, kinetica_bi/src/lib/spatialTargets.spec.ts</files>
  <read_first>
    - kinetica_bi/src/lib/spatialTargets.ts (current Phase 28 exports — append helper at bottom)
    - kinetica_bi/src/lib/spatialTargets.spec.ts (extend existing describe block; reuse SpatialMode/SpatialTarget imports)
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md (`<decisions>` § "SpatialTarget resolution" — widget-id-ascending tiebreaker rule)
    - kinetica_bi/src/api/client.ts lines 297-306 (WidgetDto shape — needed for input type)
  </read_first>
  <behavior>
    - aggregateSpatialTargetsByTable([]) returns an empty Map (size 0)
    - aggregateSpatialTargetsByTable with widgets that are NONE of type "map" returns an empty Map (size 0)
    - aggregateSpatialTargetsByTable with one map widget having one eligible latlon target returns a Map with that one entry (tableId → target)
    - aggregateSpatialTargetsByTable with one map widget having multiple eligible targets (different tableIds) returns a Map with one entry per tableId
    - aggregateSpatialTargetsByTable with TWO map widgets targeting the same tableId returns the target from the widget with the LOWER id (widget-id-ascending tiebreaker); the higher-id widget's target for that same tableId is SKIPPED
    - aggregateSpatialTargetsByTable with widget order in the input array NOT matching id order STILL applies id-ascending (must sort internally, not rely on input order)
    - aggregateSpatialTargetsByTable filters out WKB-mode targets — a map widget with a WKB target for tableId X yields NO entry for X
    - aggregateSpatialTargetsByTable filters out incomplete targets — a latlon target missing lonCol or latCol is skipped; a wkt target missing spatialCol is skipped
    - aggregateSpatialTargetsByTable ignores non-map widgets entirely (bar/line/pie/scatter/table/records/bignumber/info-card all skipped — only widget.type === "map" is considered)
  </behavior>
  <action>
    Append to `kinetica_bi/src/lib/spatialTargets.ts` (do NOT modify existing exports):

    1. Import `WidgetDto` from `../api/client`:
       ```typescript
       import type { WidgetDto } from "../api/client";
       ```
       (Place this import at the TOP of the file alongside the existing `import type { MapWidgetConfig } from "./wmsUrlBuilder";` — type-only import keeps tsc happy with the file's pure-helper posture.)

    2. Append the new helper at the BOTTOM of the file (after `isSpatialTargetEligible`):
       ```typescript
       /**
        * Phase 30 (MAT-V15-02 prerequisite): aggregate per-table spatial targets across all
        * map widgets in a dashboard.
        *
        * Resolution rules (locked by 30-CONTEXT.md `<decisions>` § "SpatialTarget resolution"):
        *   - Iterate ONLY widgets with widget.type === "map".
        *   - Sort by widget.id ASCENDING (deterministic across renders; survives grid reorders).
        *   - For each map widget, call getSpatialTargets(w).filter(isSpatialTargetEligible) —
        *     WKB and incomplete targets are dropped by isSpatialTargetEligible.
        *   - First eligible target per tableId WINS — subsequent duplicates (from higher-id
        *     widgets targeting the same table) are silently skipped.
        *
        * Returns an empty Map when no widgets, no map widgets, or no eligible targets exist.
        * The returned Map is mutable but callers MUST NOT mutate it (treat as readonly).
        */
       export function aggregateSpatialTargetsByTable(
         widgets: WidgetDto[],
       ): Map<number, SpatialTarget> {
         const result = new Map<number, SpatialTarget>();
         // Sort by id ascending — do NOT rely on caller-supplied order. Phase 30 CONTEXT lock:
         // grid reorders persist position changes but never id changes; id-ascending is stable.
         const mapWidgets = widgets
           .filter((w) => w.type === "map")
           .slice()
           .sort((a, b) => a.id - b.id);
         for (const w of mapWidgets) {
           // Cast through Pick<MapWidgetConfig, "spatialTargets"> — WidgetDto.config is
           // Record<string, unknown>; getSpatialTargets only reads .spatialTargets.
           const eligibleTargets = getSpatialTargets({
             config: w.config as Pick<MapWidgetConfig, "spatialTargets">,
           }).filter(isSpatialTargetEligible);
           for (const target of eligibleTargets) {
             // First-write-wins per tableId — widget-id-ascending makes "first" deterministic.
             if (!result.has(target.tableId)) {
               result.set(target.tableId, target);
             }
           }
         }
         return result;
       }
       ```

    3. Append a new `describe("aggregateSpatialTargetsByTable", ...)` block at the BOTTOM of `kinetica_bi/src/lib/spatialTargets.spec.ts` (do NOT modify existing tests). Add a small WidgetDto factory at the top of the new block:
       ```typescript
       import type { WidgetDto } from "../api/client";
       import { aggregateSpatialTargetsByTable } from "./spatialTargets";

       const makeMapWidget = (id: number, spatialTargets: SpatialTarget[] = [], overrides: Partial<WidgetDto> = {}): WidgetDto => ({
         id,
         dashboard_id: 1,
         title: `map-${id}`,
         type: "map",
         position: 0,
         config: { spatialTargets } as unknown as Record<string, unknown>,
         created_at: "2026-05-12T00:00:00Z",
         updated_at: "2026-05-12T00:00:00Z",
         ...overrides,
       });
       const makeNonMapWidget = (id: number, type: string): WidgetDto =>
         makeMapWidget(id, [], { type });
       ```

       Write these 9 tests (one per `<behavior>` bullet):
       - `it("returns an empty Map for an empty widgets array", ...)` — assert `aggregateSpatialTargetsByTable([]).size === 0`
       - `it("returns an empty Map when no widgets are type 'map'", ...)` — widgets = [makeNonMapWidget(1, "bar"), makeNonMapWidget(2, "pie")] → size 0
       - `it("returns one entry for one map widget with one eligible latlon target", ...)` — widget with `[{ tableId: 5, spatialMode: "latlon", lonCol: "lon", latCol: "lat" }]` → Map has 1 entry; `.get(5)` returns the target
       - `it("returns one entry per tableId for one map widget with multiple eligible targets on different tables", ...)` — 2 targets on tableIds 5+6 → size 2; both keys present
       - `it("widget-id-ascending tiebreaker: lower id wins when two map widgets target the same tableId", ...)` — widget id=2 with latlon target `{tableId:5, lonCol:"a", latCol:"b"}`, widget id=1 with latlon target `{tableId:5, lonCol:"X", latCol:"Y"}` → result.get(5).lonCol === "X" (from id=1)
       - `it("sorts by id ascending regardless of input array order", ...)` — pass widgets in order [id=10, id=2, id=5] all targeting tableId=7 with distinct lonCol values → expect id=2's target to win
       - `it("skips WKB-mode targets — widget with only WKB target yields no entry for its tableId", ...)` — widget with `[{ tableId: 9, spatialMode: "wkb", spatialCol: "geom" }]` → result.size === 0; `result.has(9) === false`
       - `it("skips incomplete latlon targets (missing lonCol or latCol) and incomplete wkt targets (missing spatialCol)", ...)` — widget with `[{tableId:1, spatialMode:"latlon", lonCol:"x"}, {tableId:2, spatialMode:"wkt"}]` → result.size === 0
       - `it("ignores non-map widgets even when their config has spatialTargets-shaped fields", ...)` — pass [makeNonMapWidget(1, "bar") cast with a spatialTargets field, makeMapWidget(2, [{tableId:3, spatialMode:"latlon", lonCol:"x", latCol:"y"}])] → result.size === 1; only tableId 3 present
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "^export function aggregateSpatialTargetsByTable" kinetica_bi/src/lib/spatialTargets.ts` returns a single match
    - `grep -c "describe(\"aggregateSpatialTargetsByTable" kinetica_bi/src/lib/spatialTargets.spec.ts` returns 1
    - `grep -c "^  it(" kinetica_bi/src/lib/spatialTargets.spec.ts` shows AT LEAST 9 new tests beyond the Phase 28 baseline
    - `grep -n "sort((a, b) => a.id - b.id)" kinetica_bi/src/lib/spatialTargets.ts` confirms ascending-id sort is present
    - `grep -n "if (!result.has(target.tableId))" kinetica_bi/src/lib/spatialTargets.ts` confirms first-wins guard
    - `grep -n "filter(isSpatialTargetEligible)" kinetica_bi/src/lib/spatialTargets.ts` confirms eligibility filter is invoked
    - `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts` exits 0 with all tests green
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>aggregateSpatialTargetsByTable export exists, 9 new spec tests pass, full spatialTargets.spec.ts green, tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend DashboardContext with widgets field and wire DashboardsPage provider prop</name>
  <files>kinetica_bi/src/components/DashboardContext.tsx, kinetica_bi/src/components/DashboardContext.spec.tsx, kinetica_bi/src/components/DashboardsPage.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardContext.tsx (full file — replace value type + provider signature)
    - kinetica_bi/src/components/DashboardContext.spec.tsx (full file — update existing tests + add coverage for widgets)
    - kinetica_bi/src/components/DashboardsPage.tsx lines 360-380 (widgets state + setWidgets)
    - kinetica_bi/src/components/DashboardsPage.tsx lines 766-833 (provider mount + JSX)
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md `<decisions>` § "SpatialTarget resolution" — context-extension lock; `<code_context>` § "Integration Points"
  </read_first>
  <behavior>
    - DashboardContextValue.widgets is typed as WidgetDto[] (NOT readonly; matches DashboardsPage state type)
    - DashboardContextProvider accepts a `widgets` prop and exposes it in context value
    - useDashboardContext() returns { dashboardId, widgets } — both fields readable; throws if no provider (existing guard preserved)
    - DashboardsPage mounts <DashboardContextProvider dashboardId={dashboard.id} widgets={widgets}> with the existing widgets state array
    - When widgets is [], context value still includes widgets: [] (NOT undefined)
  </behavior>
  <action>
    1. Replace `kinetica_bi/src/components/DashboardContext.tsx` entirely with the new shape. Keep the file's `Phase 15 / Phase 30 (Phase 30: extended to expose widgets)` doc comment header. New body:
       ```typescript
       import { createContext, useContext, type ReactNode } from "react";
       import type { WidgetDto } from "../api/client";

       /**
        * Phase 15 + Phase 30 (MAT-V15-02 prerequisite — widgets field added).
        *
        * MINIMAL surface: { dashboardId: number; widgets: WidgetDto[] }.
        * widgets is exposed so descendant renderers (AggregatedWidgetRenderer in Phase 30)
        * can resolve per-table SpatialTarget eligibility via aggregateSpatialTargetsByTable
        * without prop-drilling or a new store. Provider receives widgets directly from
        * DashboardsPage state — single source of truth, same array reference.
        *
        * Fail-loud guard: useDashboardContext() THROWS on missing context (existing Phase 15
        * contract preserved). Tests MUST wrap renderers in the provider with BOTH props.
        */

       export type DashboardContextValue = {
         dashboardId: number;
         widgets: WidgetDto[];
       };

       const DashboardContext = createContext<DashboardContextValue | null>(null);

       export const DashboardContextProvider = ({
         dashboardId,
         widgets,
         children,
       }: {
         dashboardId: number;
         widgets: WidgetDto[];
         children: ReactNode;
       }) => (
         <DashboardContext.Provider value={{ dashboardId, widgets }}>
           {children}
         </DashboardContext.Provider>
       );

       export const useDashboardContext = (): DashboardContextValue => {
         const ctx = useContext(DashboardContext);
         if (ctx === null) {
           throw new Error("useDashboardContext must be used inside DashboardContext.Provider");
         }
         return ctx;
       };
       ```

    2. Update `kinetica_bi/src/components/DashboardContext.spec.tsx`:
       - Add `import type { WidgetDto } from "../api/client";` at top.
       - For EVERY existing test that mounts `<DashboardContextProvider dashboardId={N}>`, add `widgets={[]}` so tests still pass.
       - Append three NEW tests at the bottom:
         - `it("exposes widgets array in context value", ...)` — wrap consumer in `<DashboardContextProvider dashboardId={1} widgets={[{id:1,dashboard_id:1,title:"w",type:"bar",position:0,config:{},created_at:"",updated_at:""}]}>`; consumer renders `data-testid="widget-count"` showing `useDashboardContext().widgets.length`; assert `getByTestId("widget-count").textContent === "1"`
         - `it("exposes widgets: [] when provider receives an empty array", ...)` — provider with `widgets={[]}`; assert consumer reports length 0
         - `it("preserves widgets reference equality across consumer reads", ...)` — pass a fresh `const widgetsArr = [...]`; consumer reads `useDashboardContext().widgets` twice via two child components; assert `consumer1ref === consumer2ref === widgetsArr` (same reference; no defensive copy)

    3. Update `kinetica_bi/src/components/DashboardsPage.tsx`:
       - Locate the provider mount at line 766: `<DashboardContextProvider dashboardId={dashboard.id}>`
       - Change it to: `<DashboardContextProvider dashboardId={dashboard.id} widgets={widgets}>`
       - The `widgets` state variable already exists at line 366 (`const [widgets, setWidgets] = useState<WidgetDto[]>([])`) — use it as-is. No other changes to this file.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DashboardContext.spec.tsx && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "widgets: WidgetDto\[\]" kinetica_bi/src/components/DashboardContext.tsx` returns at least 2 matches (type + provider prop)
    - `grep -n "value={{ dashboardId, widgets }}" kinetica_bi/src/components/DashboardContext.tsx` returns 1 match
    - `grep -n "<DashboardContextProvider dashboardId={dashboard.id} widgets={widgets}>" kinetica_bi/src/components/DashboardsPage.tsx` returns exactly 1 match
    - `grep -c "widgets={\[\]}" kinetica_bi/src/components/DashboardContext.spec.tsx` shows widgets prop added to existing tests
    - At least 3 NEW `it(...)` tests in DashboardContext.spec.tsx mention `widgets` in their description
    - `cd kinetica_bi && npx vitest run src/components/DashboardContext.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (catches any other spec files that destructure useDashboardContext and now miss `widgets` — Plan 30-02 will repair those; this task fixes only DashboardContext's own spec)
  </acceptance_criteria>
  <done>DashboardContextValue carries widgets, provider accepts widgets prop, DashboardsPage wires it from existing state, DashboardContext spec is green, tsc is clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend MaterializeFilterArgs payload type and client helper with spatialFilters + spatialTarget</name>
  <files>kinetica_bi/src/api/client.ts, kinetica_bi/src/api/client.spec.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts lines 555-628 (MaterializeFilterArgs + materializeFilter helper)
    - kinetica_bi/src/api/client.spec.ts (current materializeFilter tests — extend, don't replace)
    - kinetica_bi/server/src/lib/spatialWhereClause.ts lines 63-81 (server-side SpatialFilter + SpatialTarget — BYTE-PARITY contract; client types must mirror exactly)
    - kinetica_bi/src/lib/spatialTargets.ts lines 35-54 (frontend SpatialMode + SpatialTarget types — reuse for client payload)
    - .planning/phases/30-materialize-and-chips/30-CONTEXT.md `<decisions>` § "Materialize payload contract"
  </read_first>
  <behavior>
    - MaterializeFilterArgs accepts `spatialFilters?: SpatialFilter[]` and `spatialTarget?: SpatialTarget` (both optional)
    - SpatialFilter type lives in client.ts and matches server byte-for-byte: `{ id: string; wkt: string }` (NOT the richer Shape from useSpatialFilterStore — projection happens at the call site in Plan 30-02)
    - SpatialTarget type is RE-EXPORTED from client.ts via `export type { SpatialTarget } from "../lib/spatialTargets"` (single source of truth: frontend lib/spatialTargets.ts; identical to server)
    - materializeFilter v1.3 callers (column-only) still work: body is `{dashboardId, tableId, filters: [...]}` with spatialFilters/spatialTarget omitted
    - materializeFilter combined-payload callers: body is `{dashboardId, tableId, filters: [...], spatialFilters: [...], spatialTarget: {...}}` — JSON.stringify includes all four fields verbatim
    - materializeFilter with only spatial fields (filters: []): body is `{dashboardId, tableId, filters: [], spatialFilters: [...], spatialTarget: {...}}` — server's pair-completeness check passes
  </behavior>
  <action>
    1. In `kinetica_bi/src/api/client.ts`, add a new exported type `SpatialFilter` immediately ABOVE the existing `MaterializeFilterArgs` declaration (line 571 area). Mirror the server type exactly:
       ```typescript
       /**
        * Phase 30 (MAT-V15-02): wire shape of a single spatial filter sent to the server.
        *
        * BYTE-PARITY with server `kinetica_bi/server/src/lib/spatialWhereClause.ts` (SpatialFilter).
        * Note this is intentionally MINIMAL — the client useSpatialFilterStore Shape carries
        * richer fields (type, label, measurement, addedAt) for UI use; only id + wkt cross the wire.
        * The Shape → SpatialFilter projection happens at the Plan 30-02 AggregatedWidgetRenderer
        * call site (NOT inside this helper) — keeping the helper UI-state-agnostic.
        */
       export type SpatialFilter = {
         id: string;
         wkt: string;
       };

       // Re-export SpatialTarget from lib/spatialTargets so client-side callers have a single
       // import path for materialize args. Type is BYTE-PARITY with server (see lib/spatialTargets.ts header).
       export type { SpatialTarget } from "../lib/spatialTargets";
       ```

    2. Update the existing `MaterializeFilterArgs` type (currently lines 571-578) to add the two new optional fields. Replace its body with:
       ```typescript
       export type MaterializeFilterArgs = {
         dashboardId: number;
         tableId: number;
         // ActiveFilter shape is duplicated server-side at server/src/lib/whereClause.ts:35-42
         // to keep the server module frontend-import-free. Field-shape parity is the contract —
         // any change to the client ActiveFilter MUST be mirrored in whereClause.ts atomically.
         filters: ActiveFilter[];
         // Phase 30 (MAT-V15-02): optional spatial extension. Both fields must be present together
         // OR both absent — the server pair-completeness check (POST /api/filter/materialize
         // step 3) returns 400 on partial submission. Plan 30-02 AggregatedWidgetRenderer is the
         // sole caller that sets these; v1.3 column-only callers leave both undefined.
         spatialFilters?: SpatialFilter[];
         spatialTarget?: SpatialTarget;
       };
       ```
       The import for `SpatialTarget` is implicit — TS resolves the re-export. Do NOT re-import SpatialTarget at the top of client.ts (avoids circular import risk; the `export type {...} from` is sufficient).

    3. The `materializeFilter` function body (lines 585-599) needs NO changes — it already calls `JSON.stringify(args)` which serializes whatever fields are present on the args object. Verify this is true; do not touch the function body.

    4. Extend `kinetica_bi/src/api/client.spec.ts` with new tests inside the existing `describe("materializeFilter", ...)` block. Append after the last existing test:
       ```typescript
       it("sends spatialFilters and spatialTarget in the request body when both are provided (combined payload)", async () => {
         const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
           new Response(JSON.stringify({ viewName: "_kbi_filt_x", expiresAt: 1 }), { status: 200 })
         );
         await materializeFilter({
           dashboardId: 7,
           tableId: 99,
           filters: [sampleFilter],
           spatialFilters: [{ id: "shape-1", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
           spatialTarget: { tableId: 99, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
         });
         const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
         const body = JSON.parse(init.body as string);
         expect(body).toEqual({
           dashboardId: 7,
           tableId: 99,
           filters: [sampleFilter],
           spatialFilters: [{ id: "shape-1", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
           spatialTarget: { tableId: 99, spatialMode: "latlon", lonCol: "lon", latCol: "lat" },
         });
       });

       it("omits spatialFilters and spatialTarget from request body when undefined (v1.3 backward compat)", async () => {
         const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
           new Response(JSON.stringify({ viewName: "_kbi_filt_y", expiresAt: 1 }), { status: 200 })
         );
         await materializeFilter({ dashboardId: 1, tableId: 2, filters: [sampleFilter] });
         const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
         expect(body).toEqual({ dashboardId: 1, tableId: 2, filters: [sampleFilter] });
         expect("spatialFilters" in body).toBe(false);
         expect("spatialTarget" in body).toBe(false);
       });

       it("sends spatial-only payload (filters: []) when caller has shapes but no column filters", async () => {
         const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
           new Response(JSON.stringify({ viewName: "_kbi_filt_z", expiresAt: 1 }), { status: 200 })
         );
         await materializeFilter({
           dashboardId: 3,
           tableId: 4,
           filters: [],
           spatialFilters: [{ id: "s1", wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))" }],
           spatialTarget: { tableId: 4, spatialMode: "wkt", spatialCol: "geom" },
         });
         const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
         expect(body.filters).toEqual([]);
         expect(body.spatialFilters).toHaveLength(1);
         expect(body.spatialTarget.spatialMode).toBe("wkt");
       });
       ```
       At the top of the spec file's imports, add `SpatialFilter` and `SpatialTarget` if needed for type-only references; otherwise rely on inline shape parity (no import needed since the spec only inspects the JSON body).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/api/client.spec.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "^export type SpatialFilter = {" kinetica_bi/src/api/client.ts` returns 1 match
    - `grep -n "export type { SpatialTarget } from \"../lib/spatialTargets\"" kinetica_bi/src/api/client.ts` returns 1 match
    - `grep -n "spatialFilters\?: SpatialFilter\[\]" kinetica_bi/src/api/client.ts` returns 1 match
    - `grep -n "spatialTarget\?: SpatialTarget" kinetica_bi/src/api/client.ts` returns 1 match
    - `grep -c "spatialFilters" kinetica_bi/src/api/client.spec.ts` shows at least 6 matches (across 3 new tests with multiple references each)
    - At least 3 NEW `it(...)` tests added to the `materializeFilter` describe block (grep `it("sends spatialFilters\|it("omits spatialFilters\|it("sends spatial-only` returns 3 distinct lines)
    - `cd kinetica_bi && npx vitest run src/api/client.spec.ts` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>MaterializeFilterArgs accepts spatialFilters + spatialTarget; client.spec.ts proves wire-payload byte parity for 3 cases (combined, column-only backward-compat, spatial-only); tsc clean.</done>
</task>

</tasks>

<verification>
1. `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts src/components/DashboardContext.spec.tsx src/api/client.spec.ts` — all three spec files green
2. `cd kinetica_bi && npx tsc --noEmit` — exits 0
3. `cd kinetica_bi && npx vitest run` — FULL frontend suite still green (Plan 30-02 will fix any specs that mount AggregatedWidgetRenderer descendants without `widgets={[]}`; if WidgetRenderer.spec.tsx breaks here that is EXPECTED and handled in Plan 30-02 Task 1)
4. `grep -rn "aggregateSpatialTargetsByTable" kinetica_bi/src/` — only matches in spatialTargets.ts + spatialTargets.spec.ts (helper is dormant — no production consumer yet)
5. `grep -rn "spatialFilters\?:" kinetica_bi/src/api/` — only matches in client.ts (helper signature only; no caller yet)
</verification>

<success_criteria>
- aggregateSpatialTargetsByTable export exists and has 9 passing tests covering empty/non-map/single/multi/tiebreaker/sort/WKB-skip/incomplete-skip/non-map-ignore cases
- DashboardContextValue carries `widgets: WidgetDto[]`; DashboardsPage threads `widgets={widgets}` into the provider; DashboardContext.spec.tsx has 3 new tests for widgets exposure
- MaterializeFilterArgs accepts optional spatialFilters + spatialTarget; client.spec.ts has 3 new tests proving wire-payload byte parity for combined / column-only / spatial-only cases
- Full tsc passes; the three modified specs pass; the broader suite may have AggregatedWidgetRenderer-related failures that Plan 30-02 closes (this plan does NOT attempt to fix WidgetRenderer.spec.tsx — that's Plan 30-02's job per its task list)
</success_criteria>

<output>
After completion, create `.planning/phases/30-materialize-and-chips/30-01-SUMMARY.md` capturing:
- The exact aggregateSpatialTargetsByTable signature shipped (input type, return type, sort + first-wins rules)
- Confirmation that DashboardContextValue now includes widgets and which line in DashboardsPage was changed
- Confirmation that SpatialFilter is exported from client.ts and SpatialTarget is re-exported from lib/spatialTargets
- Which existing specs needed `widgets={[]}` repair and which did NOT (so Plan 30-02 has a clear delta of WidgetRenderer.spec.tsx + any other AggregatedWidgetRenderer mounting spec)
- Any tsc warnings that surfaced and how they were resolved
</output>
