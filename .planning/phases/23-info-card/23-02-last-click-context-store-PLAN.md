---
phase: 23-info-card
plan: 02
plan_id: "23-02"
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/store/lastInfoClickContextStore.ts
  - kinetica_bi/src/store/lastInfoClickContextStore.spec.ts
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
  - kinetica_bi/src/App.tsx
  - kinetica_bi/src/App.spec.tsx
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
autonomous: true
requirements:
  - CARD-V14-02
must_haves:
  truths:
    - "useLastInfoClickContextStore Zustand slice exists with shape { context: LastInfoClickContext | null } and 2 actions (setContext, reset)"
    - "MapChartRenderer.tsx click handler writes to useLastInfoClickContextStore.setContext after computing clickLon/clickLat/mapBbox/radiusPx and BEFORE the fan-out loop"
    - "App.tsx UNAUTHORIZED handler calls useLastInfoClickContextStore.reset() as the FOURTH reset call (after filterViewStore, filterStore, infoSelectionStore)"
    - "DashboardsPage.tsx DashboardOpen cleanup calls useLastInfoClickContextStore.reset() as the FOURTH reset call (same canonical order)"
    - "Store ships LIVE (not dormant) — MapChartRenderer click is the immediate writer; Plan 23-03 InfoSelectionView will be the reader"
  artifacts:
    - path: "kinetica_bi/src/store/lastInfoClickContextStore.ts"
      provides: "useLastInfoClickContextStore Zustand slice; LastInfoClickContext type"
      min_lines: 30
      contains: "useLastInfoClickContextStore"
    - path: "kinetica_bi/src/store/lastInfoClickContextStore.spec.ts"
      provides: "Spec covering setContext, reset, and reference-stability of unrelated state"
      min_lines: 40
  key_links:
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      to: "kinetica_bi/src/store/lastInfoClickContextStore.ts"
      via: "useLastInfoClickContextStore.getState().setContext({ ... }) inside singleclick handler"
      pattern: "useLastInfoClickContextStore.getState\\(\\)\\.setContext"
    - from: "kinetica_bi/src/App.tsx"
      to: "kinetica_bi/src/store/lastInfoClickContextStore.ts"
      via: "fourth reset call in UNAUTHORIZED block"
      pattern: "useLastInfoClickContextStore.getState\\(\\)\\.reset\\(\\)"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx"
      to: "kinetica_bi/src/store/lastInfoClickContextStore.ts"
      via: "fourth reset call in DashboardOpen cleanup"
      pattern: "useLastInfoClickContextStore.getState\\(\\)\\.reset\\(\\)"
---

<objective>
Create the new sibling Zustand slice `useLastInfoClickContextStore` (Strategy B locked in 23-RESEARCH.md Q1) that captures the most-recent map click's spatial context (clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx/radiusPx + sourceWidgetId). Wire the WRITE site into `MapChartRenderer.tsx`'s singleclick handler. Wire the RESET path into the existing three-store reset block at `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen cleanup, turning it into a four-store reset block.

Purpose: The Info Card's in-widget dropdown must fire `POST /api/info/query` on switch when `state[newLayerId]` is undefined — but the card has no `mapRef`. The card needs to REPLAY the most-recent click's spatial coordinates (locked: card cannot synthesize new coordinates per 23-CONTEXT.md "the card's dropdown-switch CANNOT make up new spatial coordinates"). Strategy B (sibling slice) is locked in research over Strategy A (extend useInfoSelectionStore — would break Phase 20 store-shape lock) and Strategy C (find a primary mapRef — no precedent, breaks dashboard-scoped framing).

Output: New Zustand slice + write site in MapChartRenderer + extended reset block at two lifecycle sites. Plan 23-03 will read from this store inside `<InfoSelectionView />` to drive the on-demand fetch and Load-more paths.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/23-info-card/23-CONTEXT.md
@.planning/phases/23-info-card/23-RESEARCH.md
@.planning/phases/20-info-selection-store/20-02-lifecycle-integration-SUMMARY.md

@kinetica_bi/src/store/infoSelectionStore.ts
@kinetica_bi/src/store/filterViewStore.ts
@kinetica_bi/src/store/dashboardLayersStore.ts
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/App.tsx
@kinetica_bi/src/components/DashboardsPage.tsx

<interfaces>
<!-- Existing patterns the executor must mirror. -->

From kinetica_bi/src/store/dashboardLayersStore.ts (closest sibling-slice precedent — minimal shape, no per-key state):
```typescript
import { create } from "zustand";
import type { DashboardLayerDto } from "../api/client";

type LayersState = {
  layers: DashboardLayerDto[];
  setLayers: (layers: DashboardLayerDto[]) => void;
  // ... etc.
};

export const useDashboardLayersStore = create<LayersState>((set) => ({
  layers: [],
  setLayers: (layers) => set({ layers }),
  // ...
}));
```

From kinetica_bi/src/App.tsx lines 42-61 (current three-store reset block — ADD fourth reset after line 59):
```typescript
useEffect(() => {
  if (status === "unauthenticated") {
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
    // Phase 20 STORE-V14-04: third reset alongside the canonical two-store block.
    useInfoSelectionStore.getState().reset();
    // Plan 23-02 ADD HERE: useLastInfoClickContextStore.getState().reset();
  }
}, [status]);
```

From kinetica_bi/src/components/DashboardsPage.tsx lines 387-403 (current three-store DashboardOpen cleanup — ADD fourth reset after line 401):
```typescript
useEffect(() => {
  return () => {
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
    // Phase 20 STORE-V14-03: third reset alongside the canonical two-store block.
    useInfoSelectionStore.getState().reset();
    // Plan 23-02 ADD HERE: useLastInfoClickContextStore.getState().reset();
  };
}, [dashboard.id]);
```

From kinetica_bi/src/components/charts/MapChartRenderer.tsx lines 700-792 (current singleclick handler — INSERT setContext call between line ~724 (after `const radiusPx = getInfoRadiusPx(...)`) and line ~726 (before `let errorCount = 0`)).

Type contract for the new slice (locked from 23-RESEARCH.md Q1):
```typescript
export type LastInfoClickContext = {
  clickLon: number;          // EPSG:4326 (geographic degrees)
  clickLat: number;          // EPSG:4326
  mapBbox: [number, number, number, number];  // EPSG:3857 [minX, minY, maxX, maxY]
  mapWidthPx: number;        // > 0
  mapHeightPx: number;       // > 0
  radiusPx: number;          // resolved from owning widget config via getInfoRadiusPx
  sourceWidgetId: number;    // informational
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create useLastInfoClickContextStore slice + spec (RED-GREEN: spec asserts default state, setContext, reset, reference-stability)</name>
  <files>kinetica_bi/src/store/lastInfoClickContextStore.ts, kinetica_bi/src/store/lastInfoClickContextStore.spec.ts</files>
  <read_first>
    - kinetica_bi/src/store/dashboardLayersStore.ts (sibling-slice pattern at lines 17-54 — closest minimal precedent)
    - kinetica_bi/src/store/infoSelectionStore.ts (header docstring lines 1-44 — pattern for inline lock-citing JSDoc; reset() shape at line 170)
    - kinetica_bi/__mocks__/zustand.ts (auto-reset shim — verify the new store is auto-covered because it lives under src/store/*.ts)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Pattern 2: Sibling Zustand slice" (lines 240-274) and § "Q1 Strategy B field shape" (lines 610-621)
    - .planning/phases/20-info-selection-store/20-01-store-and-spec-SUMMARY.md (Phase 20 store spec format — mirror the test-organization style)
  </read_first>
  <behavior>
    Spec test cases (TDD RED first — write spec before slice):
    - Test L1: initial state — `useLastInfoClickContextStore.getState().context === null`
    - Test L2: `setContext(ctx)` — store now holds `ctx`; `getState().context === ctx` (deep equality)
    - Test L3: `setContext(ctxA)` then `setContext(ctxB)` — `getState().context === ctxB` (replacement, not merge)
    - Test L4: `reset()` — `getState().context === null` after reset, even if previously set
    - Test L5 (reference stability): subscribing only to `s.context` does NOT re-render on unrelated mutations — but since the store has no other top-level fields, this is mostly a sanity check. Verify the store's `set({ context })` does not pollute with other keys.
    - Test L6 (ts contract): the LastInfoClickContext type has all 7 fields (clickLon, clickLat, mapBbox, mapWidthPx, mapHeightPx, radiusPx, sourceWidgetId); compile-time check via `const ctx: LastInfoClickContext = { ... full set ... }` and assigning a missing-field object should fail tsc (this can be a `// @ts-expect-error` line in the spec).
  </behavior>
  <action>
    Create `kinetica_bi/src/store/lastInfoClickContextStore.ts` EXACTLY as follows. Mirror the docstring style of `infoSelectionStore.ts` (cite-locks-inline pattern):

    ```ts
    /**
     * Phase 23 (CARD-V14-02): Last-info-click spatial-context store.
     *
     * The Info Card (Plan 23-03) has no mapRef but must fire POST /api/info/query when its
     * dropdown switches to a layer with state[newLayerId] === undefined. The endpoint requires
     * clickLon/clickLat/mapBbox/mapWidthPx/mapHeightPx/radiusPx — the card REPLAYS the most-recent
     * map click's coordinates rather than synthesizing new ones (locked at 23-CONTEXT.md
     * "the card's dropdown-switch CANNOT make up new spatial coordinates").
     *
     * Strategy B locked at .planning/phases/23-info-card/23-RESEARCH.md § Q1: sibling slice
     * (NOT a Phase 20 store-shape change; NOT a recompute-from-mapRef strategy). Mirrors the
     * useFilterStore + useFilterViewStore + useInfoSelectionStore sibling pattern.
     *
     * LIFECYCLE — four-store reset block (Plan 23-02 extends the three-store block from Phase 20-02):
     *   - DashboardsPage.tsx DashboardOpen cleanup (alongside filterViewStore -> filterStore -> infoSelectionStore reset).
     *   - App.tsx UNAUTHORIZED handler (alongside the same three-store reset).
     * Canonical order: filterViewStore -> filterStore -> infoSelectionStore -> lastInfoClickContextStore.
     * Reset is critical — Pitfall 1 in 23-RESEARCH.md: stale dashboard-A coords MUST NOT survive a switch to dashboard-B.
     *
     * The store is automatically covered by the Zustand reset shim (kinetica_bi/__mocks__/zustand.ts
     * activated via vi.mock("zustand") in src/test/setup.ts) because it lives under src/store/*.ts.
     */

    import { create } from "zustand";

    export type LastInfoClickContext = {
      /** Click longitude in EPSG:4326 (geographic degrees). Plan 21-03 transforms from OL EPSG:3857 coord. */
      clickLon: number;
      /** Click latitude in EPSG:4326. */
      clickLat: number;
      /** Map viewport bbox in EPSG:3857 [minX, minY, maxX, maxY] at click time. Server uses for radiusPx -> ground conversion (SPATIAL-V14-05). */
      mapBbox: [number, number, number, number];
      /** Map widget pixel width at click time (> 0). */
      mapWidthPx: number;
      /** Map widget pixel height at click time (> 0). */
      mapHeightPx: number;
      /** Click radius in pixels — resolved from the owning widget's config via getInfoRadiusPx (default 20). */
      radiusPx: number;
      /** Informational — which map widget produced this context. Cards do NOT filter by this (dashboard-scoped — locked 23-CONTEXT.md). */
      sourceWidgetId: number;
    };

    type State = {
      context: LastInfoClickContext | null;
      /** Replace-semantics: writes overwrite any prior context. Called from MapChartRenderer.tsx singleclick handler. */
      setContext: (ctx: LastInfoClickContext) => void;
      /** Wipe to null. Wired into App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup as fourth call. */
      reset: () => void;
    };

    export const useLastInfoClickContextStore = create<State>((set) => ({
      context: null,
      setContext: (ctx) => set({ context: ctx }),
      reset: () => set({ context: null }),
    }));
    ```

    Create `kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` with all 6 tests (L1-L6) listed in `<behavior>`. Use the format established in `infoSelectionStore.spec.ts` (read it for reference). For test L6, structure as:

    ```ts
    import { describe, it, expect, beforeEach } from "vitest";
    import { useLastInfoClickContextStore, type LastInfoClickContext } from "./lastInfoClickContextStore";

    const FIXTURE_CTX: LastInfoClickContext = {
      clickLon: -73.985,
      clickLat: 40.748,
      mapBbox: [-74.1, 40.6, -73.85, 40.85],
      mapWidthPx: 800,
      mapHeightPx: 600,
      radiusPx: 20,
      sourceWidgetId: 42,
    };

    describe("useLastInfoClickContextStore", () => {
      // Zustand reset shim auto-resets between tests (vitest setup); no manual beforeEach reset needed
      // beyond standard vitest.

      it("L1: initial state has context: null", () => {
        expect(useLastInfoClickContextStore.getState().context).toBeNull();
      });

      it("L2: setContext writes the full LastInfoClickContext object", () => {
        useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX);
        expect(useLastInfoClickContextStore.getState().context).toEqual(FIXTURE_CTX);
      });

      it("L3: setContext is replace-semantics (not merge)", () => {
        useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX);
        const ctxB: LastInfoClickContext = { ...FIXTURE_CTX, clickLon: -122.0, clickLat: 37.5, sourceWidgetId: 99 };
        useLastInfoClickContextStore.getState().setContext(ctxB);
        expect(useLastInfoClickContextStore.getState().context).toEqual(ctxB);
        expect(useLastInfoClickContextStore.getState().context?.clickLon).toBe(-122.0);
      });

      it("L4: reset clears context to null even when previously set", () => {
        useLastInfoClickContextStore.getState().setContext(FIXTURE_CTX);
        useLastInfoClickContextStore.getState().reset();
        expect(useLastInfoClickContextStore.getState().context).toBeNull();
      });

      it("L5: store has only 'context' state field plus actions (no extra top-level keys)", () => {
        const state = useLastInfoClickContextStore.getState();
        const stateKeys = Object.keys(state).sort();
        expect(stateKeys).toEqual(["context", "reset", "setContext"]);
      });

      it("L6 (compile-time): LastInfoClickContext requires all seven fields", () => {
        // Positive: full assignment compiles.
        const ok: LastInfoClickContext = FIXTURE_CTX;
        expect(ok.clickLon).toBeTypeOf("number");
        expect(ok.mapBbox).toHaveLength(4);
        // Negative: missing field would fail tsc; this assertion is informational.
        // @ts-expect-error — radiusPx missing
        const bad: LastInfoClickContext = { clickLon: 0, clickLat: 0, mapBbox: [0,0,0,0], mapWidthPx: 1, mapHeightPx: 1, sourceWidgetId: 0 };
        void bad;
      });
    });
    ```

    Run `cd kinetica_bi && npm test -- --run lastInfoClickContextStore.spec` — must exit 0. Run `cd kinetica_bi && npx tsc --noEmit` — must exit 0.

    Commit message: `feat(23-02): add useLastInfoClickContextStore sibling slice (Phase 23 P02 Task 1)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run lastInfoClickContextStore.spec</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/store/lastInfoClickContextStore.ts` exists
    - File `kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` exists
    - `grep "export const useLastInfoClickContextStore" kinetica_bi/src/store/lastInfoClickContextStore.ts` returns >=1 match
    - `grep "export type LastInfoClickContext" kinetica_bi/src/store/lastInfoClickContextStore.ts` returns >=1 match
    - `grep -E "clickLon|clickLat|mapBbox|mapWidthPx|mapHeightPx|radiusPx|sourceWidgetId" kinetica_bi/src/store/lastInfoClickContextStore.ts` returns >=7 matches (one per field)
    - `grep "setContext\|reset" kinetica_bi/src/store/lastInfoClickContextStore.ts` returns >=2 matches (both actions present)
    - `grep -c "^  it(" kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` returns >=5 (L1-L6, allow L6 to be merged into another test)
    - `cd kinetica_bi && npm test -- --run lastInfoClickContextStore.spec` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Sibling Zustand slice committed and dormant — no production callers yet (Task 2 wires the writer; reset block extension is Task 3). Spec proves slice contract independently of consumers.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire MapChartRenderer.tsx singleclick handler to write into useLastInfoClickContextStore on every click (RED-GREEN: extend MapChartRenderer.spec.tsx with a click-writes-context assertion)</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (singleclick handler at lines 700-792; specifically the section between line 723 `const mapBbox = view.calculateExtent(size) ...` and line 729 `for (const layer of eligibleLayers)` — the setContext call inserts here)
    - kinetica_bi/src/store/lastInfoClickContextStore.ts (Task 1 output — for import path)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (existing POPUP-V14 test block P1-P16 around lines 1073-1640 — find the test that simulates a click and asserts useInfoSelectionStore mutations; mirror the pattern for the new useLastInfoClickContextStore assertion)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Q1 — Write site" (lines 622-628) and § Pitfall 2 (lines 388-396)
  </read_first>
  <behavior>
    - Test (NEW in MapChartRenderer.spec.tsx): given an info-enabled map widget, simulating a singleclick on the map produces ONE write to `useLastInfoClickContextStore` with the EXACT fields { clickLon, clickLat, mapBbox, mapWidthPx, mapHeightPx, radiusPx, sourceWidgetId } populated from the click event + map view + widget config + widget id. Use the existing OL-mock pattern from the surrounding P-tests.
    - Test (NEW): the setContext write happens BEFORE the fan-out loop (i.e., even if all eligible layers fail / abort, the context is still recorded — the click happened, the spatial coords are valid context).
    - Existing P1-P14 tests must continue to pass (no other behavior change in the click handler).
  </behavior>
  <action>
    Step 1: In `kinetica_bi/src/components/charts/MapChartRenderer.tsx`, add the import alongside the existing imports near the top of the file (find the line `import { useInfoSelectionStore } from "../../store/infoSelectionStore";` and add right after it):

    ```typescript
    import { useLastInfoClickContextStore } from "../../store/lastInfoClickContextStore";
    ```

    Step 2: In the singleclick handler (Effect 6, currently at lines ~700-792), insert the setContext call between line 724 (after `const radiusPx = getInfoRadiusPx(widgetConfig as MapWidgetConfig);`) and line 726 (before `let errorCount = 0;`). The exact insertion is:

    ```typescript
          const radiusPx = getInfoRadiusPx(widgetConfig as MapWidgetConfig);

          // Plan 23-02: capture the click context for cross-component replay.
          // Card's <InfoSelectionView /> dropdown-switch + Load-more (Plan 23-03) read from this slice
          // because the card has no mapRef. setContext fires UNCONDITIONALLY on every info-enabled click,
          // BEFORE the fan-out loop — even if all layers fail/abort, the click happened and the coords
          // are valid context. Pitfall 2 lock: when this is null, dropdown-switch in the view short-circuits.
          useLastInfoClickContextStore.getState().setContext({
            clickLon,
            clickLat,
            mapBbox,
            mapWidthPx: size[0],
            mapHeightPx: size[1],
            radiusPx,
            sourceWidgetId: widget.id,
          });

          let errorCount = 0;
    ```

    NOTE: Verify `widget.id` is in scope inside this handler. Looking at MapChartRenderer.tsx props and the surrounding context, `widget` is the renderer's prop (look near line ~140-180 where the component signature destructures `{ widget, tables }`). If `widget.id` is not directly accessible (e.g., `widget` was renamed to `widgetConfig`), use the original prop name. If only `widgetConfig` is in scope, also include `widget` in the destructure at the top of the component AND in the relevant useEffect deps.

    Step 3: Update the Effect 6 useEffect dep array (line ~792) to include any new dependencies. The current deps are `[getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]`. Adding `widget.id` may be needed — but `widget.id` is stable for the widget's lifetime, so it does NOT need to be in deps. The eslint-disable-next-line above the dep array remains; no additional dep needed.

    Step 4: In `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`, find the click-handler test block (P1-P14 in the POPUP-V14 section around lines 1073-1640). Add TWO new tests at the end of that block, named e.g. P15-LCC and P16-LCC (or LCC1/LCC2 — at the executor's discretion, just keep them in the same describe block as the other click-handler tests).

    Test LCC1: "click writes complete LastInfoClickContext into useLastInfoClickContextStore exactly once":
    - Set up an info-enabled map widget with at least one eligible layer.
    - Mock the OL singleclick event with a known coordinate.
    - Spy on `useLastInfoClickContextStore.getState().setContext` (or wrap the store and assert via getState().context).
    - Simulate the click.
    - Assert `setContext` called once.
    - Assert the recorded context has all 7 fields populated; clickLon/clickLat are EPSG:4326 transforms of the OL coord; mapBbox is the EPSG:3857 extent; mapWidthPx/mapHeightPx come from `map.getSize()`; radiusPx is the resolved widget radius; sourceWidgetId is the test fixture's widget.id.

    Test LCC2: "click writes context BEFORE fan-out loop (context is recorded even when all layers fail)":
    - Set up a map widget where all eligible layers fail their `infoQuery` calls (mock infoQuery to throw).
    - Simulate the click.
    - Assert `useLastInfoClickContextStore.getState().context` is non-null with the click's coords (proves setContext was called before / regardless of fan-out outcome).
    - Existing all-error toast assertion (matches the surrounding pattern) stays.

    Mirror the click-handler mock-setup pattern from existing P-tests (see e.g. tests at lines ~1100-1300 of the spec).

    Run `cd kinetica_bi && npm test -- --run MapChartRenderer.spec` — must exit 0. Run `cd kinetica_bi && npx tsc --noEmit` — must exit 0.

    Commit message: `feat(23-02): MapChartRenderer click handler writes useLastInfoClickContextStore (Phase 23 P02 Task 2)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run MapChartRenderer.spec</automated>
  </verify>
  <acceptance_criteria>
    - `grep "useLastInfoClickContextStore" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns >=2 matches (import + getState().setContext call)
    - `grep -E "useLastInfoClickContextStore\.getState\(\)\.setContext" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns >=1 match
    - The setContext call appears AFTER `const radiusPx = getInfoRadiusPx(...)` and BEFORE the fan-out `for (const layer of eligibleLayers)` loop. Verify by `grep -n -A 20 "const radiusPx = getInfoRadiusPx" kinetica_bi/src/components/charts/MapChartRenderer.tsx | grep -A 0 "useLastInfoClickContextStore"` — should show context within ~15 lines after radiusPx.
    - `grep -E "useLastInfoClickContextStore" kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` returns >=2 matches (at least 2 new tests that assert against the store)
    - `cd kinetica_bi && npm test -- --run MapChartRenderer.spec` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Every map click on an info-enabled widget records the spatial context into the new sibling slice. Plan 23-03's `<InfoSelectionView />` will read from this slice for replay-fetch. P15/P16 fan-out tests still pass; the click handler's behavior is unchanged except for the additional setContext write that happens before the existing fan-out logic.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend the three-store reset block to four-store at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup (RED-GREEN: spec asserts the new fourth reset call site at both locations)</name>
  <files>kinetica_bi/src/App.tsx, kinetica_bi/src/App.spec.tsx, kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/components/DashboardsPage.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/App.tsx (full file; pay attention to lines 9-13 imports and lines 42-61 UNAUTHORIZED block)
    - kinetica_bi/src/components/DashboardsPage.tsx (lines 24-25 imports and lines 387-403 DashboardOpen cleanup)
    - kinetica_bi/src/App.spec.tsx (existing tests asserting the three-store reset; find any test referencing "ALL THREE" or "three stores" or "useInfoSelectionStore" — those are the targets to extend to "ALL FOUR")
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (Phase 20-02 STORE-V14-03 tests; same target — extend to "ALL FOUR")
    - .planning/phases/20-info-selection-store/20-02-lifecycle-integration-SUMMARY.md (locked direct-invocation idiom for DashboardsPage spec; lines describing "filterViewStore -> filterStore -> infoSelectionStore canonical order" — Plan 23-02 extends to "filterViewStore -> filterStore -> infoSelectionStore -> lastInfoClickContextStore")
    - .planning/phases/23-info-card/23-RESEARCH.md § "Reset wiring" (lines 633-637) and § Pitfall 1 (lines 374-385)
  </read_first>
  <behavior>
    - App.spec.tsx: existing test that asserts the UNAUTHORIZED handler resets all three stores extends to assert ALL FOUR are reset in canonical order: filterViewStore -> filterStore -> infoSelectionStore -> lastInfoClickContextStore. Pre-populate each store; trigger UNAUTHORIZED; assert each store is back to its initial state.
    - DashboardsPage.spec.tsx: existing test that asserts DashboardOpen cleanup resets all three stores extends to assert ALL FOUR are reset. Pre-populate each store; trigger cleanup (per the locked direct-invocation idiom); assert each store is back to initial.
    - Pitfall 1 regression: write a NEW spec block in App.spec.tsx (or DashboardsPage.spec.tsx — at executor's discretion, place where most coherent) that pre-populates `useLastInfoClickContextStore` with stale dashboard-A context, triggers UNAUTHORIZED OR DashboardOpen cleanup, and asserts `useLastInfoClickContextStore.getState().context === null`. Single test is sufficient.
  </behavior>
  <action>
    Step 1: In `kinetica_bi/src/App.tsx`, add the import alongside the existing store imports (around line 11 — after `import { useInfoSelectionStore } from "./store/infoSelectionStore";`):

    ```typescript
    import { useLastInfoClickContextStore } from "./store/lastInfoClickContextStore";
    ```

    Step 2: In the UNAUTHORIZED handler (lines 42-61), add the FOURTH reset call after the existing `useInfoSelectionStore.getState().reset();` line (currently at line 59). The new line:

    ```typescript
          // Plan 23-02 STORE-V14-extended: fourth reset alongside the canonical three-store block.
          // Pitfall 1 lock: stale dashboard-A click coords MUST NOT survive a logout to dashboard-B.
          useLastInfoClickContextStore.getState().reset();
    ```

    Place it immediately after the `useInfoSelectionStore.getState().reset();` line. The reset block now has FOUR entries in canonical order.

    Step 3: In `kinetica_bi/src/components/DashboardsPage.tsx`, add the import alongside the existing store imports (around line 25 — after `import { useInfoSelectionStore } from "../store/infoSelectionStore";`):

    ```typescript
    import { useLastInfoClickContextStore } from "../store/lastInfoClickContextStore";
    ```

    Step 4: In the DashboardOpen cleanup useEffect (lines 387-403), add the FOURTH reset call after `useInfoSelectionStore.getState().reset();` (currently at line 401). The new line:

    ```typescript
          // Plan 23-02 STORE-V14-extended: fourth reset alongside the canonical three-store block.
          // Pitfall 1 lock: stale dashboard-A click coords MUST NOT survive a switch to dashboard-B.
          useLastInfoClickContextStore.getState().reset();
    ```

    Step 5: In `kinetica_bi/src/App.spec.tsx`, find the existing UNAUTHORIZED-resets test (search for "ALL THREE" or "useInfoSelectionStore" or "STORE-V14-04"). Extend it:
    - Update the test name from "ALL THREE" to "ALL FOUR" (or add a new test alongside if the existing one is brittle; at executor's discretion).
    - Pre-populate `useLastInfoClickContextStore` via `useLastInfoClickContextStore.getState().setContext({ ... full fixture ... })` BEFORE triggering UNAUTHORIZED.
    - After triggering UNAUTHORIZED, assert `useLastInfoClickContextStore.getState().context === null` alongside the existing three assertions.
    - Update the test name string to reference the new lock label (e.g. "STORE-V14-04 + Plan 23-02 extension" — the executor picks a clear label).

    Step 6: In `kinetica_bi/src/components/DashboardsPage.spec.tsx`, find the analogous DashboardOpen-cleanup-resets test. Extend identically:
    - Pre-populate `useLastInfoClickContextStore` before triggering cleanup.
    - Assert `useLastInfoClickContextStore.getState().context === null` after cleanup.
    - Update test name to reference four-store block.

    Step 7: Add Pitfall 1 regression test (at executor's discretion in App.spec.tsx OR DashboardsPage.spec.tsx — place where most coherent with existing organization):

    ```typescript
    it("Pitfall 1: stale lastInfoClickContext does not survive a session boundary", () => {
      useLastInfoClickContextStore.getState().setContext({
        clickLon: -73.985, clickLat: 40.748,
        mapBbox: [-74.1, 40.6, -73.85, 40.85],
        mapWidthPx: 800, mapHeightPx: 600,
        radiusPx: 20, sourceWidgetId: 42,
      });
      // ... trigger UNAUTHORIZED OR DashboardOpen cleanup using the surrounding test's pattern ...
      expect(useLastInfoClickContextStore.getState().context).toBeNull();
    });
    ```

    Run `cd kinetica_bi && npm test` — full suite must exit 0. Run `cd kinetica_bi && npx tsc --noEmit` — must exit 0.

    Commit message: `feat(23-02): extend three-store reset block to four-store (App + DashboardsPage); Pitfall 1 lock`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- --run "App.spec|DashboardsPage.spec|lastInfoClickContextStore.spec"</automated>
  </verify>
  <acceptance_criteria>
    - `grep "useLastInfoClickContextStore" kinetica_bi/src/App.tsx` returns >=2 matches (import + reset call)
    - `grep "useLastInfoClickContextStore" kinetica_bi/src/components/DashboardsPage.tsx` returns >=2 matches (import + reset call)
    - The reset call in App.tsx appears AFTER `useInfoSelectionStore.getState().reset();` — verify by `grep -B 1 -A 4 "useInfoSelectionStore.getState().reset" kinetica_bi/src/App.tsx | grep -A 0 "useLastInfoClickContextStore"` showing the pattern.
    - The reset call in DashboardsPage.tsx appears AFTER `useInfoSelectionStore.getState().reset();` in the DashboardOpen cleanup — verify identically.
    - `grep "useLastInfoClickContextStore" kinetica_bi/src/App.spec.tsx` returns >=1 match (test extension)
    - `grep "useLastInfoClickContextStore" kinetica_bi/src/components/DashboardsPage.spec.tsx` returns >=1 match (test extension)
    - `cd kinetica_bi && npm test -- --run "App.spec|DashboardsPage.spec|lastInfoClickContextStore.spec"` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - Full regression: `cd kinetica_bi && npm test` exits 0
  </acceptance_criteria>
  <done>
    Pitfall 1 closed — `useLastInfoClickContextStore` resets at the same two lifecycle sites as the other three stores, in canonical order. Stale dashboard-A click coords cannot leak into dashboard-B. Specs assert all four stores reset together.
  </done>
</task>

</tasks>

<verification>
- Frontend regression: `cd kinetica_bi && npm test` exits 0
- TypeScript: `cd kinetica_bi && npx tsc --noEmit` exits 0
- Slice contract: `useLastInfoClickContextStore.getState()` exposes `context: LastInfoClickContext | null`, `setContext`, `reset`
- Write site: `MapChartRenderer.tsx` setContext fires inside the singleclick handler before the fan-out loop
- Reset block: BOTH `App.tsx` UNAUTHORIZED and `DashboardsPage.tsx` DashboardOpen contain the four-call sequence ending with `useLastInfoClickContextStore.getState().reset()`
</verification>

<success_criteria>
1. `kinetica_bi/src/store/lastInfoClickContextStore.ts` exists with `useLastInfoClickContextStore` Zustand slice + `LastInfoClickContext` type (7 fields). Spec passes 6+ tests.
2. `kinetica_bi/src/components/charts/MapChartRenderer.tsx` singleclick handler writes to the new slice via `useLastInfoClickContextStore.getState().setContext({...})` AFTER computing radiusPx and BEFORE the fan-out loop. New spec tests LCC1/LCC2 pass.
3. `kinetica_bi/src/App.tsx` UNAUTHORIZED handler contains the FOURTH reset call as the last entry in the canonical four-store reset block.
4. `kinetica_bi/src/components/DashboardsPage.tsx` DashboardOpen cleanup contains the FOURTH reset call as the last entry in the canonical four-store reset block.
5. App.spec.tsx + DashboardsPage.spec.tsx assertions extended to cover all four stores resetting together; Pitfall 1 regression test exists in at least one location.
6. `cd kinetica_bi && npx tsc --noEmit` exits 0; `cd kinetica_bi && npm test` exits 0.
</success_criteria>

<output>
After completion, create `.planning/phases/23-info-card/23-02-last-click-context-store-SUMMARY.md` capturing: slice line count, write-site insertion line in MapChartRenderer.tsx (post-modification), reset-block locations (line numbers in App.tsx + DashboardsPage.tsx), and any deviations from plan with rationale.
</output>
