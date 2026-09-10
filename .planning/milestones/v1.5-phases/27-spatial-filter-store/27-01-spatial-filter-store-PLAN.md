---
phase: 27-spatial-filter-store
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/store/spatialFilterStore.ts
  - kinetica_bi/src/store/spatialFilterStore.spec.ts
  - .planning/REQUIREMENTS.md
autonomous: true
requirements:
  - STORE-V15-01
  - STORE-V15-02
  - STORE-V15-03

must_haves:
  truths:
    - "Importing `useSpatialFilterStore` exposes initial state { shapes: [], spatialFilterVersion: 0, shapeCounter: 0 }"
    - "addShape({ type, wkt, measurement }) appends a shape with synthesized id (crypto.randomUUID), label '{TypeCap} {N}' (monotonic), addedAt (Date.now()), and bumps spatialFilterVersion by 1"
    - "removeShape(existing id) drops the shape and bumps spatialFilterVersion by 1; removeShape(non-existent id) is a strict no-op preserving state identity"
    - "clearAll() with shapes.length > 0 empties shapes, resets shapeCounter to 0, bumps spatialFilterVersion by 1; clearAll() with empty shapes is a strict no-op"
    - "reset() zeroes shapes, spatialFilterVersion, and shapeCounter (hard wipe; not an increment)"
    - "N counter is monotonic session-wide (Bbox 1 -> Circle 2 -> Lasso 3 -> Bbox 4); removeShape never decrements; clearAll/reset reset to 0"
    - "vitest spec passes with Zustand reset shim active (no state bleed between tests)"
  artifacts:
    - path: "kinetica_bi/src/store/spatialFilterStore.ts"
      provides: "useSpatialFilterStore Zustand slice + Shape type export"
      exports: ["useSpatialFilterStore", "Shape"]
      contains: "create<State>"
      min_lines: 50
    - path: "kinetica_bi/src/store/spatialFilterStore.spec.ts"
      provides: "Vitest coverage for store contract (canary + addShape + removeShape + clearAll + reset + N counter sequence + post-removal monotonicity + post-clearAll reset-to-zero)"
      contains: "useSpatialFilterStore"
      min_lines: 120
  key_links:
    - from: "kinetica_bi/src/store/spatialFilterStore.ts"
      to: "kinetica_bi/__mocks__/zustand.ts"
      via: "Zustand reset shim auto-applies to src/store/*.ts via vi.mock('zustand') in src/test/setup.ts"
      pattern: "from \"zustand\""
    - from: "kinetica_bi/src/store/spatialFilterStore.spec.ts"
      to: "kinetica_bi/src/store/spatialFilterStore.ts"
      via: "sibling import"
      pattern: "from \"\\./spatialFilterStore\""
---

<objective>
Create the `useSpatialFilterStore` Zustand slice with its sibling vitest spec, fulfilling STORE-V15-01/02/03. Also fix the REQUIREMENTS.md path drift (`src/state/` → `src/store/`) so the requirements file aligns with CONTEXT.md's locked path.

Purpose: Phase 27 is dormant plumbing. Downstream phases 29 (OL Draw / VectorLayer) and 30 (FilterBar chips + AggregatedWidgetRenderer materialize trigger) subscribe to this store. The version counter (`spatialFilterVersion`) mirrors `filterStore.filterVersion` semantics exactly — it is the dep-array signal the materialize trigger will read.

Output:
- `kinetica_bi/src/store/spatialFilterStore.ts` — new Zustand slice
- `kinetica_bi/src/store/spatialFilterStore.spec.ts` — new sibling spec
- `.planning/REQUIREMENTS.md` — one-line path correction for STORE-V15-01
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/27-spatial-filter-store/27-CONTEXT.md
@.planning/phases/27-spatial-filter-store/27-RESEARCH.md

# Reference implementations (sibling stores executor MUST mirror)
@kinetica_bi/src/store/lastInfoClickContextStore.ts
@kinetica_bi/src/store/lastInfoClickContextStore.spec.ts
@kinetica_bi/src/store/filterStore.ts
@kinetica_bi/__mocks__/zustand.ts

<interfaces>
<!-- Key contracts the executor must produce verbatim. Source: 27-CONTEXT.md + 27-RESEARCH.md (locked decisions). -->

From kinetica_bi/src/store/spatialFilterStore.ts (NEW — this plan creates it):
```typescript
import { create } from "zustand";

export type Shape = {
  id: string;
  type: 'bbox' | 'lasso' | 'circle';
  wkt: string;          // EPSG:4326 WKT (caller supplies; Phase 29 will produce via ol/format/WKT)
  label: string;        // "Bbox 1", "Circle 2", "Lasso 3" — store-synthesized
  measurement: string;  // "5km × 3km", "2.5 km", "12.4 km²" — caller supplies
  addedAt: number;      // store-synthesized via Date.now()
};

type State = {
  shapes: Shape[];
  spatialFilterVersion: number;
  shapeCounter: number; // internal monotonic counter for label N; NOT exposed as a separate getter
  addShape: (shape: Omit<Shape, 'id' | 'label' | 'addedAt'>) => void;
  removeShape: (id: string) => void;
  clearAll: () => void;
  reset: () => void;
};

export const useSpatialFilterStore = create<State>((set) => ({ ... }));
```

From kinetica_bi/src/store/lastInfoClickContextStore.ts (existing — pattern to mirror):
```typescript
import { create } from "zustand";
export const useLastInfoClickContextStore = create<State>((set) => ({
  context: null,
  setContext: (ctx) => set({ context: ctx }),
  reset: () => set({ context: null }),
}));
```

From kinetica_bi/src/store/filterStore.ts (existing — filterVersion no-op semantics to mirror):
```typescript
// clearFilters reference — empty case is strict no-op (returns state identity):
clearFilters: (tableId) =>
  set((state) => {
    const existing = state.filters[tableId] ?? [];
    if (existing.length === 0) return state; // nothing to clear — no version bump
    ...
  }),
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create useSpatialFilterStore Zustand slice</name>
  <files>kinetica_bi/src/store/spatialFilterStore.ts</files>
  <read_first>
    - kinetica_bi/src/store/lastInfoClickContextStore.ts (closest sibling — 56 lines; mirror file structure, header comment style, import order)
    - kinetica_bi/src/store/filterStore.ts (lines 87-101 — clearFilters no-op pattern to replicate in clearAll; filterVersion no-op semantics to replicate in spatialFilterVersion)
    - kinetica_bi/__mocks__/zustand.ts (so executor confirms the shim auto-applies — no manual reset boilerplate needed)
    - .planning/phases/27-spatial-filter-store/27-CONTEXT.md (decisions block — N counter semantics, no-op rules, ID generation)
    - .planning/phases/27-spatial-filter-store/27-RESEARCH.md (Pattern 1 code example lines 122-195 — full reference implementation)
  </read_first>
  <behavior>
    - Test C1 (canary 1): initial state — shapes is [], spatialFilterVersion === 0, shapeCounter === 0.
    - Test C2 (canary 2 — proves Zustand reset shim is active): same assertions as C1 in a second test; both pass without per-spec beforeEach reset.
    - Test A1 (addShape produces shape with synthesized fields): caller passes { type: 'bbox', wkt: 'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', measurement: '5km × 3km' }; result shape has id === 'uuid-1' (stubbed), label === 'Bbox 1', addedAt === 12345 (stubbed Date.now), type/wkt/measurement preserved.
    - Test A2 (addShape bumps spatialFilterVersion and shapeCounter): after one addShape, spatialFilterVersion === 1 and shapeCounter === 1.
    - Test A3 (label capitalization for all 3 types): bbox → 'Bbox 1', lasso → 'Lasso 1' (after reset), circle → 'Circle 1' (after reset). Confirm exact strings.
    - Test A4 (N counter session-wide global sequence): addShape(bbox), addShape(circle), addShape(lasso), addShape(bbox) → labels in order 'Bbox 1', 'Circle 2', 'Lasso 3', 'Bbox 4'; shapeCounter === 4.
    - Test R1 (removeShape existing): seed 2 shapes; removeShape(first.id); shapes.length === 1, only second remains, spatialFilterVersion === 3 (two adds + one remove).
    - Test R2 (removeShape non-existent — strict no-op): seed 1 shape (version becomes 1); removeShape('nonexistent-id'); shapes unchanged, spatialFilterVersion still 1, AND the returned state reference must be the same object (state identity preserved — verify via `const prev = getState(); removeShape('nope'); expect(getState() === prev OR all fields strictly equal)`). Asserting shapes array reference stability is fine: `prev.shapes === getState().shapes`.
    - Test R3 (post-removal counter monotonicity): addShape(bbox), addShape(bbox), removeShape(first.id), addShape(bbox) → labels Bbox 1, Bbox 2, (Bbox 1 removed), Bbox 3; shapeCounter === 3. The third addShape MUST be labeled 'Bbox 3', NOT 'Bbox 2'.
    - Test CL1 (clearAll with shapes): seed 2 shapes; clearAll(); shapes === [], shapeCounter === 0, spatialFilterVersion === 3 (two adds + one clearAll).
    - Test CL2 (clearAll empty — strict no-op): state untouched; spatialFilterVersion remains 0, shapeCounter remains 0; shapes array reference preserved.
    - Test CL3 (post-clearAll counter resets): addShape, clearAll, addShape → second add labeled 'Bbox 1' (counter reset to 0 by clearAll, then incremented to 1).
    - Test RS1 (reset zeroes everything): seed shapes + version > 0 + counter > 0; reset(); shapes === [], spatialFilterVersion === 0, shapeCounter === 0.
    - Test K1 (state-key shape): `Object.keys(getState()).sort()` === ['addShape', 'clearAll', 'removeShape', 'reset', 'shapeCounter', 'shapes', 'spatialFilterVersion'].
  </behavior>
  <action>
    Create kinetica_bi/src/store/spatialFilterStore.ts with this exact structure (mirror lastInfoClickContextStore.ts header style + filterStore.ts no-op pattern):

    ```typescript
    /**
     * Phase 27 (STORE-V15-01..03): Spatial filter store.
     *
     * Session-only Zustand slice holding committed drawn shapes (bbox / lasso / circle) for v1.5
     * spatial filtering. Ships dormant in Phase 27 — Phase 29 (MapDrawToolbar / VectorLayer) and
     * Phase 30 (FilterBar chips + AggregatedWidgetRenderer materialize trigger) are the first
     * consumers.
     *
     * `spatialFilterVersion` mirrors the `filterVersion` pattern from filterStore.ts — it is the
     * dep-array signal that AggregatedWidgetRenderer (Phase 30) will read alongside `filterVersion`
     * to trigger materialize. Increments on every successful mutation; no-op rules below.
     *
     * `shapeCounter` is an internal monotonic counter for label N — kept in state (NOT derived
     * from shapes.length) so post-remove sequences honor the no-recycling rule. Resets to 0 on
     * clearAll() and reset(); NEVER touched by removeShape.
     *
     * Label format (locked): `{TypeCapitalized} {N}` — "Bbox 1", "Circle 2", "Lasso 3" — session-wide
     * single counter (NOT per-type). Capitalization: bbox→Bbox, lasso→Lasso, circle→Circle.
     *
     * spatialFilterVersion semantics (locked by 27-CONTEXT.md):
     *   - addShape: +1
     *   - removeShape(existing id): +1
     *   - removeShape(non-existent id): NO-OP (state reference preserved)
     *   - clearAll() with shapes.length > 0: +1, shapes=[], shapeCounter=0
     *   - clearAll() with shapes.length === 0: NO-OP
     *   - reset(): hard-set to 0 (NOT an increment — lifecycle wipe, not a mutation signal)
     *
     * LIFECYCLE — 5-store reset block extended by Plan 27-02 (STORE-V15-04):
     *   Order: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore →
     *   spatialFilterStore (5th). Wired in App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen
     *   cleanup. Session-only — NO server-side DROP loop (mirrors lastInfoClickContextStore).
     *
     * Test infra: Zustand reset shim at kinetica_bi/__mocks__/zustand.ts auto-applies via
     * vi.mock("zustand") in src/test/setup.ts. File must live under src/store/ for shim coverage.
     */

    import { create } from "zustand";

    export type Shape = {
      /** UUID v4 from crypto.randomUUID(), generated inside addShape. */
      id: string;
      /** Shape geometry kind. Drives label capitalization (bbox→Bbox, lasso→Lasso, circle→Circle). */
      type: "bbox" | "lasso" | "circle";
      /** WKT polygon in EPSG:4326 geographic coordinates. Phase 29 produces via ol/format/WKT
       *  with { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' } after geom.clone(). */
      wkt: string;
      /** Auto-generated `{TypeCapitalized} {N}` — e.g. "Bbox 1". N is session-wide monotonic. */
      label: string;
      /** Human-readable measurement — "5km × 3km", "2.5 km", "12.4 km²". Caller supplies (Phase 29
       *  computes via ol/sphere.getDistance / getArea — never raw EPSG:3857 — V15-P-04). */
      measurement: string;
      /** Date.now() at addShape time. */
      addedAt: number;
    };

    type State = {
      shapes: Shape[];
      spatialFilterVersion: number;
      /** Internal monotonic counter for label N. NOT exposed via a separate getter — Phase 29/30
       *  consumers read shapes[] and spatialFilterVersion only. Kept in state so the Zustand reset
       *  shim covers it for free. */
      shapeCounter: number;
      addShape: (shape: Omit<Shape, "id" | "label" | "addedAt">) => void;
      removeShape: (id: string) => void;
      clearAll: () => void;
      reset: () => void;
    };

    const CAPITALIZE: Record<Shape["type"], string> = {
      bbox: "Bbox",
      lasso: "Lasso",
      circle: "Circle",
    };

    export const useSpatialFilterStore = create<State>((set) => ({
      shapes: [],
      spatialFilterVersion: 0,
      shapeCounter: 0,

      addShape: ({ type, wkt, measurement }) =>
        set((s) => {
          const nextCounter = s.shapeCounter + 1;
          const shape: Shape = {
            id: crypto.randomUUID(),
            type,
            wkt,
            measurement,
            label: `${CAPITALIZE[type]} ${nextCounter}`,
            addedAt: Date.now(),
          };
          return {
            shapes: [...s.shapes, shape],
            spatialFilterVersion: s.spatialFilterVersion + 1,
            shapeCounter: nextCounter,
          };
        }),

      removeShape: (id) =>
        set((s) => {
          const next = s.shapes.filter((sh) => sh.id !== id);
          // Non-existent id — strict no-op. Mirrors filterStore.ts:removeFilter pattern.
          // PITFALL S-02 + Phase 29 reference stability: shapes[] reference preserved when unchanged.
          if (next.length === s.shapes.length) return s;
          return {
            shapes: next,
            spatialFilterVersion: s.spatialFilterVersion + 1,
            // shapeCounter intentionally NOT touched — monotonic no-recycle rule (27-CONTEXT.md).
          };
        }),

      clearAll: () =>
        set((s) => {
          // Empty shapes — strict no-op. Mirrors filterStore.ts:clearFilters pattern (lines 87-97).
          // Locked by success criterion 4: spurious version bumps cause phantom materializations
          // in Phase 30's AggregatedWidgetRenderer dep array.
          if (s.shapes.length === 0) return s;
          return {
            shapes: [],
            spatialFilterVersion: s.spatialFilterVersion + 1,
            shapeCounter: 0, // "start over" semantics — next addShape produces `{Type} 1`.
          };
        }),

      // Internal — called from App.tsx UNAUTHORIZED and DashboardsPage.tsx DashboardOpen cleanup
      // (Plan 27-02 wiring). Hard-set to initial state; NOT an increment-style mutation.
      reset: () =>
        set({ shapes: [], spatialFilterVersion: 0, shapeCounter: 0 }),
    }));
    ```

    Implementation rules (do NOT deviate):
    1. Path is `kinetica_bi/src/store/spatialFilterStore.ts` — NEVER `src/state/`.
    2. NO middleware (no immer, no devtools, no persist). Mirrors all 4 existing stores.
    3. addShape uses `crypto.randomUUID()` directly — no nanoid, no uuid package. Already available in Node 16+ and jsdom.
    4. The exact strings `"Bbox"`, `"Lasso"`, `"Circle"` MUST appear in the CAPITALIZE table — these power the label format. Type case is `bbox`/`lasso`/`circle` (lowercase) per Shape type union.
    5. removeShape MUST early-return `s` (state identity) on no-op — used by Phase 29 consumers for reference stability.
    6. clearAll MUST early-return `s` when shapes.length === 0 — locked no-op rule.
    7. reset MUST NOT increment spatialFilterVersion — it sets to 0 directly.
    8. shapeCounter is NEVER decremented or reset by removeShape (post-removal monotonicity rule).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/store/spatialFilterStore.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f kinetica_bi/src/store/spatialFilterStore.ts`
    - File contains `export const useSpatialFilterStore = create<State>(` (matches `grep "export const useSpatialFilterStore = create<State>" kinetica_bi/src/store/spatialFilterStore.ts`)
    - File contains `export type Shape = {` (matches `grep "export type Shape" kinetica_bi/src/store/spatialFilterStore.ts`)
    - File contains `crypto.randomUUID()` invocation (matches `grep "crypto.randomUUID()" kinetica_bi/src/store/spatialFilterStore.ts`)
    - File contains the 3 capitalization entries: `bbox: "Bbox"`, `lasso: "Lasso"`, `circle: "Circle"` (each matches its own grep)
    - File contains the clearAll empty no-op early-return: `grep "shapes.length === 0" kinetica_bi/src/store/spatialFilterStore.ts` matches.
    - File contains the removeShape no-op early-return: `grep "next.length === s.shapes.length" kinetica_bi/src/store/spatialFilterStore.ts` matches.
    - File contains the reset hard-set: `grep "reset: () =>" kinetica_bi/src/store/spatialFilterStore.ts` matches AND the same line / following line contains `spatialFilterVersion: 0`.
    - File does NOT import middleware: `grep -E "zustand/middleware|immer|devtools|persist" kinetica_bi/src/store/spatialFilterStore.ts` returns no matches.
    - File does NOT live under `src/state/`: `test ! -d kinetica_bi/src/state` (no new directory created).
    - `tsc --noEmit` exits 0.
  </acceptance_criteria>
  <done>
    spatialFilterStore.ts created with the exact contract above; tsc clean; spec file in Task 2 will exercise every behavior.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Write spatialFilterStore.spec.ts with full behavioral coverage</name>
  <files>kinetica_bi/src/store/spatialFilterStore.spec.ts</files>
  <read_first>
    - kinetica_bi/src/store/spatialFilterStore.ts (the file just created in Task 1 — for import names and type exports)
    - kinetica_bi/src/store/lastInfoClickContextStore.spec.ts (closest sibling spec — 76 lines; mirror describe block style and Object.keys K1 test pattern)
    - kinetica_bi/src/store/infoSelectionStore.spec.ts (grouped action-coverage style reference — for ordering tests by action under a single describe)
    - .planning/phases/27-spatial-filter-store/27-RESEARCH.md (Pattern 3 lines 224-260 — canary tests + crypto.randomUUID stubbing pattern)
  </read_first>
  <behavior>
    All behavioral assertions are listed in Task 1's `<behavior>` block (Tests C1, C2, A1-A4, R1-R3, CL1-CL3, RS1, K1). This task implements them as a vitest spec file.
  </behavior>
  <action>
    Create kinetica_bi/src/store/spatialFilterStore.spec.ts with this exact structure:

    ```typescript
    import { describe, it, expect, vi, beforeEach } from "vitest";
    import { useSpatialFilterStore, type Shape } from "./spatialFilterStore";

    // Zustand reset shim auto-resets between tests via vi.mock("zustand") in src/test/setup.ts.
    // No explicit beforeEach reset of the store is needed — the shim handles it.

    describe("useSpatialFilterStore — Phase 27 (STORE-V15-01..03)", () => {
      let uuidCounter = 0;

      beforeEach(() => {
        uuidCounter = 0;
        vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
          () => `uuid-${++uuidCounter}` as ReturnType<typeof crypto.randomUUID>,
        );
        vi.spyOn(Date, "now").mockReturnValue(12345);
      });

      // ---------- Canary: prove Zustand reset shim is active ----------

      it("C1: initial state — shapes [], spatialFilterVersion 0, shapeCounter 0", () => {
        expect(useSpatialFilterStore.getState().shapes).toEqual([]);
        expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
        expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
      });

      it("C2: initial state again (proves shim resets between tests)", () => {
        expect(useSpatialFilterStore.getState().shapes).toEqual([]);
        expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
        expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
      });

      // ---------- addShape ----------

      it("A1: addShape synthesizes id (crypto.randomUUID), label, addedAt; preserves type/wkt/measurement", () => {
        useSpatialFilterStore.getState().addShape({
          type: "bbox",
          wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
          measurement: "5km × 3km",
        });
        const shape = useSpatialFilterStore.getState().shapes[0];
        expect(shape.id).toBe("uuid-1");
        expect(shape.label).toBe("Bbox 1");
        expect(shape.addedAt).toBe(12345);
        expect(shape.type).toBe("bbox");
        expect(shape.wkt).toBe("POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))");
        expect(shape.measurement).toBe("5km × 3km");
      });

      it("A2: addShape bumps spatialFilterVersion +1 and shapeCounter +1", () => {
        useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W", measurement: "M" });
        expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(1);
        expect(useSpatialFilterStore.getState().shapeCounter).toBe(1);
      });

      it("A3: label capitalization for all three types — bbox→Bbox, lasso→Lasso, circle→Circle", () => {
        useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W", measurement: "M" });
        expect(useSpatialFilterStore.getState().shapes[0].label).toBe("Bbox 1");
        useSpatialFilterStore.getState().reset();
        useSpatialFilterStore.getState().addShape({ type: "lasso", wkt: "W", measurement: "M" });
        expect(useSpatialFilterStore.getState().shapes[0].label).toBe("Lasso 1");
        useSpatialFilterStore.getState().reset();
        useSpatialFilterStore.getState().addShape({ type: "circle", wkt: "W", measurement: "M" });
        expect(useSpatialFilterStore.getState().shapes[0].label).toBe("Circle 1");
      });

      it("A4: N counter is session-wide global (Bbox 1, Circle 2, Lasso 3, Bbox 4 — NOT per-type)", () => {
        const s = useSpatialFilterStore.getState();
        s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
        s.addShape({ type: "circle", wkt: "W", measurement: "M" });
        s.addShape({ type: "lasso", wkt: "W", measurement: "M" });
        s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
        const labels = useSpatialFilterStore.getState().shapes.map((sh) => sh.label);
        expect(labels).toEqual(["Bbox 1", "Circle 2", "Lasso 3", "Bbox 4"]);
        expect(useSpatialFilterStore.getState().shapeCounter).toBe(4);
      });

      // ---------- removeShape ----------

      it("R1: removeShape(existing) drops the shape and bumps spatialFilterVersion +1", () => {
        const s = useSpatialFilterStore.getState();
        s.addShape({ type: "bbox", wkt: "W1", measurement: "M1" });
        s.addShape({ type: "circle", wkt: "W2", measurement: "M2" });
        const firstId = useSpatialFilterStore.getState().shapes[0].id;
        useSpatialFilterStore.getState().removeShape(firstId);
        const after = useSpatialFilterStore.getState();
        expect(after.shapes.length).toBe(1);
        expect(after.shapes[0].label).toBe("Circle 2");
        expect(after.spatialFilterVersion).toBe(3); // 2 adds + 1 remove
      });

      it("R2: removeShape(non-existent) is a strict no-op (no version bump, shapes reference preserved)", () => {
        useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W", measurement: "M" });
        const before = useSpatialFilterStore.getState();
        const beforeShapesRef = before.shapes;
        const beforeVersion = before.spatialFilterVersion;
        useSpatialFilterStore.getState().removeShape("nonexistent-id-zzz");
        const after = useSpatialFilterStore.getState();
        expect(after.shapes).toBe(beforeShapesRef); // reference identity preserved
        expect(after.spatialFilterVersion).toBe(beforeVersion);
        expect(after.shapeCounter).toBe(1);
      });

      it("R3: post-removal counter is monotonic — no recycling (Bbox 1, Bbox 2, remove first, addShape → Bbox 3)", () => {
        const s = useSpatialFilterStore.getState();
        s.addShape({ type: "bbox", wkt: "W1", measurement: "M1" });
        s.addShape({ type: "bbox", wkt: "W2", measurement: "M2" });
        const firstId = useSpatialFilterStore.getState().shapes[0].id;
        useSpatialFilterStore.getState().removeShape(firstId);
        useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W3", measurement: "M3" });
        const labels = useSpatialFilterStore.getState().shapes.map((sh) => sh.label);
        expect(labels).toEqual(["Bbox 2", "Bbox 3"]); // NOT ["Bbox 2", "Bbox 2"] — counter never recycles
        expect(useSpatialFilterStore.getState().shapeCounter).toBe(3);
      });

      // ---------- clearAll ----------

      it("CL1: clearAll with shapes empties array, resets shapeCounter to 0, bumps spatialFilterVersion +1", () => {
        const s = useSpatialFilterStore.getState();
        s.addShape({ type: "bbox", wkt: "W1", measurement: "M1" });
        s.addShape({ type: "circle", wkt: "W2", measurement: "M2" });
        useSpatialFilterStore.getState().clearAll();
        const after = useSpatialFilterStore.getState();
        expect(after.shapes).toEqual([]);
        expect(after.shapeCounter).toBe(0);
        expect(after.spatialFilterVersion).toBe(3); // 2 adds + 1 clearAll
      });

      it("CL2: clearAll when empty is a strict no-op (no version bump, shapes reference preserved)", () => {
        const before = useSpatialFilterStore.getState();
        const beforeShapesRef = before.shapes;
        useSpatialFilterStore.getState().clearAll();
        const after = useSpatialFilterStore.getState();
        expect(after.shapes).toBe(beforeShapesRef);
        expect(after.spatialFilterVersion).toBe(0);
        expect(after.shapeCounter).toBe(0);
      });

      it("CL3: post-clearAll counter resets — next addShape produces {Type} 1", () => {
        const s = useSpatialFilterStore.getState();
        s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
        useSpatialFilterStore.getState().clearAll();
        useSpatialFilterStore.getState().addShape({ type: "bbox", wkt: "W2", measurement: "M2" });
        const after = useSpatialFilterStore.getState();
        expect(after.shapes[0].label).toBe("Bbox 1");
        expect(after.shapeCounter).toBe(1);
      });

      // ---------- reset ----------

      it("RS1: reset zeroes shapes, spatialFilterVersion, and shapeCounter", () => {
        const s = useSpatialFilterStore.getState();
        s.addShape({ type: "bbox", wkt: "W", measurement: "M" });
        s.addShape({ type: "circle", wkt: "W", measurement: "M" });
        useSpatialFilterStore.getState().reset();
        const after = useSpatialFilterStore.getState();
        expect(after.shapes).toEqual([]);
        expect(after.spatialFilterVersion).toBe(0);
        expect(after.shapeCounter).toBe(0);
      });

      // ---------- structural ----------

      it("K1: state keys are exactly { shapes, spatialFilterVersion, shapeCounter, addShape, removeShape, clearAll, reset }", () => {
        const keys = Object.keys(useSpatialFilterStore.getState()).sort();
        expect(keys).toEqual(
          ["addShape", "clearAll", "removeShape", "reset", "shapeCounter", "shapes", "spatialFilterVersion"].sort(),
        );
      });

      it("K2 (compile-time): Shape type requires all six fields", () => {
        const ok: Shape = {
          id: "x",
          type: "bbox",
          wkt: "POLYGON(())",
          label: "Bbox 1",
          measurement: "5km × 3km",
          addedAt: 12345,
        };
        expect(ok.id).toBeTypeOf("string");
        // @ts-expect-error — addedAt missing from this assignment
        const bad: Shape = {
          id: "x", type: "bbox", wkt: "P", label: "L", measurement: "M",
        };
        void bad;
      });
    });
    ```

    Implementation rules:
    1. Use `vi.spyOn(globalThis.crypto, "randomUUID")` — NOT `global.crypto` (jsdom env exposes `globalThis.crypto`).
    2. Use `vi.spyOn(Date, "now")` — needed for deterministic `addedAt` assertion in A1.
    3. Cast UUID mock return value `as ReturnType<typeof crypto.randomUUID>` — TS strict mode requires the branded `${string}-${string}-...` template-literal return type.
    4. R2 and CL2 MUST assert reference identity via `expect(after.shapes).toBe(beforeShapesRef)` — this is the production contract Phase 29 consumers depend on (PITFALL S-02 reference stability).
    5. A4 (session-wide counter) labels MUST be the literal `["Bbox 1", "Circle 2", "Lasso 3", "Bbox 4"]` — proves the counter is global, not per-type.
    6. R3 (monotonic counter) MUST assert `["Bbox 2", "Bbox 3"]` after addShape/addShape/remove/addShape — the third add is `Bbox 3`, NOT `Bbox 2` (would indicate counter recycling).
    7. K2 includes a `@ts-expect-error` assertion to lock the compile-time contract on Shape (six required fields).
    8. NO `beforeEach` reset of the store itself — the Zustand shim handles it.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/store/spatialFilterStore.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f kinetica_bi/src/store/spatialFilterStore.spec.ts`
    - File imports the store: `grep "from \"./spatialFilterStore\"" kinetica_bi/src/store/spatialFilterStore.spec.ts` matches.
    - File contains all required test labels: `grep -E "C1:|C2:|A1:|A2:|A3:|A4:|R1:|R2:|R3:|CL1:|CL2:|CL3:|RS1:|K1:|K2" kinetica_bi/src/store/spatialFilterStore.spec.ts` returns 15 matches (all behaviors covered).
    - File contains the canary monotonic-counter assertion: `grep '"Bbox 2", "Bbox 3"' kinetica_bi/src/store/spatialFilterStore.spec.ts` matches (R3 — proves monotonicity).
    - File contains the session-wide global counter assertion: `grep '"Bbox 1", "Circle 2", "Lasso 3", "Bbox 4"' kinetica_bi/src/store/spatialFilterStore.spec.ts` matches (A4 — proves global, not per-type).
    - File contains reference identity assertion: `grep 'toBe(beforeShapesRef)' kinetica_bi/src/store/spatialFilterStore.spec.ts` matches at least twice (R2 and CL2).
    - File contains `vi.spyOn(globalThis.crypto, "randomUUID")` (matches grep).
    - vitest exits 0 (all tests pass): `cd kinetica_bi && npx vitest run src/store/spatialFilterStore.spec.ts`
    - vitest reports at least 15 passing tests for this spec file.
  </acceptance_criteria>
  <done>
    All 15+ tests pass; coverage exercises STORE-V15-01 (Shape type + initial state), STORE-V15-02 (4 actions + label format + N counter rules), and STORE-V15-03 (spatialFilterVersion increment + no-op rules).
  </done>
</task>

<task type="auto">
  <name>Task 3: Fix REQUIREMENTS.md STORE-V15-01 path (src/state/ → src/store/)</name>
  <files>.planning/REQUIREMENTS.md</files>
  <read_first>
    - .planning/REQUIREMENTS.md (line 30 — current STORE-V15-01 text references `src/state/spatialFilterStore.ts`)
    - .planning/phases/27-spatial-filter-store/27-CONTEXT.md (decisions block — explicitly locks path to `src/store/`)
    - .planning/phases/27-spatial-filter-store/27-RESEARCH.md (Pitfall 1 + Open Question 3 — planner directive to update REQUIREMENTS.md path)
  </read_first>
  <action>
    Edit `.planning/REQUIREMENTS.md` line 30. Locate this exact text:

    > - [ ] **STORE-V15-01**: New Zustand slice `kinetica_bi/src/state/spatialFilterStore.ts` with flat `Shape[]` (session-only, dashboard-scoped); ...

    Replace `kinetica_bi/src/state/spatialFilterStore.ts` with `kinetica_bi/src/store/spatialFilterStore.ts` (single character path edit: `state` → `store`).

    Do NOT change any other text on the line or in the document. The change is a one-character directory-name correction (`state` → `store`) — the Zustand reset shim at `kinetica_bi/__mocks__/zustand.ts` auto-covers `src/store/*.ts` and the established convention in the codebase is `src/store/` (verified by all 4 existing stores: filterStore, filterViewStore, infoSelectionStore, lastInfoClickContextStore).

    Do NOT mark STORE-V15-01 as `[x]` complete — Plan 27-02 wires lifecycle reset (STORE-V15-04) and the full Phase 27 requirement set is closed by the phase-close summary, not by this individual plan.
  </action>
  <verify>
    <automated>grep -c "kinetica_bi/src/store/spatialFilterStore.ts" .planning/REQUIREMENTS.md && ! grep -q "src/state/spatialFilterStore" .planning/REQUIREMENTS.md && echo PATH_FIXED</automated>
  </verify>
  <acceptance_criteria>
    - `.planning/REQUIREMENTS.md` contains `kinetica_bi/src/store/spatialFilterStore.ts` (matches `grep "kinetica_bi/src/store/spatialFilterStore.ts" .planning/REQUIREMENTS.md`).
    - `.planning/REQUIREMENTS.md` does NOT contain `src/state/spatialFilterStore` (no matches for `grep "src/state/spatialFilterStore" .planning/REQUIREMENTS.md`).
    - The STORE-V15-01 line is still preceded by `- [ ]` (unchecked — not marked complete by this plan): `grep -E "^- \[ \] \*\*STORE-V15-01\*\*" .planning/REQUIREMENTS.md` matches.
    - No other STORE-V15-* requirements were edited: `git diff --stat .planning/REQUIREMENTS.md` shows a single-line change (or insertion/deletion pair for that one line).
  </acceptance_criteria>
  <done>
    REQUIREMENTS.md path matches the code-side path. Future references to STORE-V15-01 will not contradict the actual file location.
  </done>
</task>

</tasks>

<verification>
After all three tasks complete, run from `kinetica_bi/`:

```bash
cd kinetica_bi && npx tsc --noEmit && npx vitest run src/store/spatialFilterStore.spec.ts
```

Confirms:
- `spatialFilterStore.ts` compiles cleanly under strict TypeScript
- All 15+ spec tests pass
- Zustand reset shim is active (canary tests C1 + C2 both pass)
- No state bleed across tests

Also confirm the documentation drift is fixed:
```bash
grep -c "src/store/spatialFilterStore.ts" .planning/REQUIREMENTS.md
grep -c "src/state/spatialFilterStore" .planning/REQUIREMENTS.md  # MUST be 0
```
</verification>

<success_criteria>
1. `kinetica_bi/src/store/spatialFilterStore.ts` exists with the exact Shape type, State type, and useSpatialFilterStore export described in `<interfaces>` above
2. `kinetica_bi/src/store/spatialFilterStore.spec.ts` covers all 15+ behaviors (canary, addShape × 4, removeShape × 3, clearAll × 3, reset × 1, structural × 2)
3. `tsc --noEmit` exits 0
4. `npx vitest run src/store/spatialFilterStore.spec.ts` exits 0 with at least 15 passing tests
5. No new `src/state/` directory is created (`test ! -d kinetica_bi/src/state`)
6. REQUIREMENTS.md STORE-V15-01 path corrected (`src/store/` not `src/state/`)
7. Store ships dormant — NO production consumer imports `useSpatialFilterStore` outside the spec file (verified by `grep -rl "useSpatialFilterStore" kinetica_bi/src --exclude="*.spec.ts" --exclude="spatialFilterStore.ts"` returning empty — Plan 27-02 adds the first production import sites)
</success_criteria>

<output>
After completion, create `.planning/phases/27-spatial-filter-store/27-01-SUMMARY.md` per the standard summary template.
</output>
