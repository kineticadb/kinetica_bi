# Phase 27: spatial-filter-store - Research

**Researched:** 2026-05-12
**Domain:** Zustand store authoring, vitest store specs, lifecycle reset wiring
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Store path:** `kinetica_bi/src/store/spatialFilterStore.ts` (NOT `src/state/` as REQUIREMENTS.md STORE-V15-01 states — established convention is `src/store/`; Zustand reset shim auto-covers `src/store/*.ts`).
- **Spec path:** `kinetica_bi/src/store/spatialFilterStore.spec.ts` (sibling spec).
- **State shape:** `{ shapes: Shape[], spatialFilterVersion: number, shapeCounter: number }` — `shapeCounter` is internal monotonic counter, not derived from `shapes.length`.
- **Shape type:** `{ id: string, type: 'bbox'|'lasso'|'circle', wkt: string (EPSG:4326), label: string, measurement: string, addedAt: number }`.
- **Actions:** `addShape(shape: Omit<Shape, 'id' | 'label' | 'addedAt'>)`, `removeShape(id: string)`, `clearAll()`, `reset()`. Store generates `id`, `label`, `addedAt` internally.
- **Label format:** `{TypeCapitalized} {N}` — e.g. "Bbox 1", "Circle 2", "Lasso 3". Capitalization: `bbox → Bbox`, `lasso → Lasso`, `circle → Circle`.
- **N counter scope:** Session-wide global single counter (NOT per-type). Sequence: Bbox 1, Circle 2, Lasso 3, Bbox 4.
- **N counter increment mode:** Monotonic, no recycling. `removeShape` never decrements. `clearAll()` resets counter to 0. `reset()` resets counter to 0.
- **ID generation:** `crypto.randomUUID()` inside `addShape`. Callers do not synthesize IDs.
- **`spatialFilterVersion` semantics:**
  - Increments by 1 on: `addShape`, `removeShape(existing id)`, `clearAll()` when `shapes.length > 0`.
  - No-op (no increment): `removeShape(non-existent id)`, `clearAll()` when `shapes.length === 0`.
  - `reset()` sets `spatialFilterVersion = 0` (hard-reset, not a mutation increment).
- **Lifecycle reset:** 5th call in canonical order `filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore` at both `App.tsx` UNAUTHORIZED handler and `DashboardsPage.tsx` DashboardOpen cleanup. No DROP loop — session-only store.
- **No persistence:** No localStorage, sessionStorage, SQLite, or URL persistence. Session-only.
- **Ships dormant:** No OL consumer (Phase 29) or FilterBar consumer (Phase 30) in this phase.

### Claude's Discretion

- Exact `addShape` parameter shape (convention is object arg — `{ type, wkt, measurement }`).
- Whether `shapeCounter` is publicly readable or hidden (recommend hidden, not exposed in type signature).
- Spec organization (single describe block vs grouped per-action — follow `infoSelectionStore.spec.ts` grouped style).
- Whether to stub `Date.now()` in tests (recommended yes for `addedAt` determinism).

### Deferred Ideas (OUT OF SCOPE)

- Phase 28 `SpatialTarget` type — separate file, no dependency from Phase 27.
- OL VectorLayer / VectorSource integration — Phase 29.
- `shapesKey` primitive selector — Phase 29 consumer concern.
- FilterBar chip integration — Phase 30.
- `addShape` triggering materialize endpoint — Phase 30.
- Shape persistence across sessions (SQLite, URL) — v1.6+.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STORE-V15-01 | New Zustand slice `spatialFilterStore.ts` with flat `Shape[]` (session-only); Shape type `{ id, type: 'bbox'|'lasso'|'circle', wkt: string (EPSG:4326), label: string, measurement: string, addedAt: number }` | Store authoring pattern verified from `lastInfoClickContextStore.ts` (50 LOC) and `filterStore.ts`; path locked to `src/store/` |
| STORE-V15-02 | Actions `addShape`, `removeShape(id)`, `clearAll()`, `reset()`; auto-generated label `{Type} {N}` where N is sequential per-session draw order (resets on dashboard-switch + logout) | N counter semantics, capitalization, and monotonic-no-recycle rule fully specified in CONTEXT.md; mirrors `filterVersion` counter pattern in `filterStore.ts` |
| STORE-V15-03 | `spatialFilterVersion` counter increments on any shape mutation; consumed by `AggregatedWidgetRenderer` dep array as spatial counterpart to `filterVersion` | Pattern verified from `filterStore.ts:filterVersion`; no-op semantics locked in CONTEXT.md |
| STORE-V15-04 | 5-store reset block wired into `App.tsx` UNAUTHORIZED + `DashboardsPage.tsx` DashboardOpen cleanup (5th store, no DROP loop) | Exact insertion points confirmed by reading production code at `App.tsx:55-65` and `DashboardsPage.tsx:398-406`; spec pattern confirmed from `App.spec.tsx` and `DashboardsPage.spec.tsx` |
</phase_requirements>

---

## Summary

Phase 27 is a self-contained Zustand store with vitest spec and two-site lifecycle wiring. No external libraries are needed beyond what already exists in the project. All patterns are directly observable in the four existing stores (`filterStore.ts`, `filterViewStore.ts`, `infoSelectionStore.ts`, `lastInfoClickContextStore.ts`) and their specs.

The closest structural sibling is `lastInfoClickContextStore.ts` (50 LOC, session-only, reset-only lifecycle, no server DROP loop). The version counter pattern (`spatialFilterVersion`) mirrors `filterStore.ts::filterVersion` exactly — both increment on mutation, do not increment on no-ops, and reset to 0 on `reset()`. The 5-store lifecycle reset block extends the established 4-store block by appending one line at two production call sites, plus updating the two spec files (App.spec.tsx and DashboardsPage.spec.tsx) to assert all 5 stores reset.

**Primary recommendation:** Model `spatialFilterStore.ts` on `lastInfoClickContextStore.ts` for structure and `filterStore.ts` for the version-counter pattern. Write the spec grouped by action, following `infoSelectionStore.spec.ts` style. The Zustand reset shim auto-applies as long as the file lives under `src/store/`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | (project-installed) | State management | Already used by all 4 existing stores; `create` imported directly |
| vitest | (project-installed) | Test runner | Project-standard; `vitest.config.ts` targets `src/**/*.spec.{ts,tsx}` with jsdom |

**No new packages needed.** `crypto.randomUUID()` is a Web API available in Node 16+ and all modern browsers — no polyfill required.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/react | (project-installed) | `act()` wrapping for store state mutations in React render trees | Used in App.spec.tsx lifecycle tests; pure store specs use store API directly without act() |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.randomUUID()` | `nanoid` or `uuid` package | `crypto.randomUUID()` is built-in; no package install; already available in this runtime stack |
| Monotonic `shapeCounter` in state | Deriving N from `shapes.length` | `shapes.length` would recycle numbers after `removeShape`; monotonic counter is the only way to honour the no-recycling rule |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure (store files)

```
kinetica_bi/src/store/
├── filterStore.ts               # filterVersion counter reference
├── filterViewStore.ts           # existing
├── infoSelectionStore.ts        # complex action set reference
├── lastInfoClickContextStore.ts # closest sibling (session-only, reset-only)
├── spatialFilterStore.ts        # NEW — Phase 27
├── spatialFilterStore.spec.ts   # NEW — Phase 27
└── ...
```

### Pattern 1: Session-only Zustand store with version counter

**What:** A `create<State>((set) => ({ ... }))` call with flat state fields and explicit action functions that use `set()`. No middleware (no immer, no devtools, no persist) — matches all existing stores in this codebase.

**When to use:** Any session-scoped frontend state with no server persistence.

```typescript
// Source: kinetica_bi/src/store/lastInfoClickContextStore.ts + filterStore.ts combined pattern
import { create } from "zustand";

export type Shape = {
  id: string;
  type: 'bbox' | 'lasso' | 'circle';
  wkt: string;          // EPSG:4326
  label: string;        // "Bbox 1", "Circle 2", etc.
  measurement: string;  // "5km × 3km", "2.5 km", "12.4 km²"
  addedAt: number;      // Date.now()
};

type State = {
  shapes: Shape[];
  spatialFilterVersion: number;
  shapeCounter: number;          // internal monotonic label counter
  addShape: (shape: Omit<Shape, 'id' | 'label' | 'addedAt'>) => void;
  removeShape: (id: string) => void;
  clearAll: () => void;
  reset: () => void;
};

const CAPITALIZE: Record<Shape['type'], string> = {
  bbox: 'Bbox',
  lasso: 'Lasso',
  circle: 'Circle',
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
      if (next.length === s.shapes.length) return s; // non-existent id — no-op
      return {
        shapes: next,
        spatialFilterVersion: s.spatialFilterVersion + 1,
      };
    }),

  clearAll: () =>
    set((s) => {
      if (s.shapes.length === 0) return s; // already empty — no version bump, no counter reset
      return {
        shapes: [],
        spatialFilterVersion: s.spatialFilterVersion + 1,
        shapeCounter: 0,
      };
    }),

  reset: () => set({ shapes: [], spatialFilterVersion: 0, shapeCounter: 0 }),
}));
```

### Pattern 2: 5th-store lifecycle reset wiring

**What:** Append one import + one `reset()` call at each of two existing production reset blocks. No DROP loop because there is no server-side resource to free.

**`App.tsx` UNAUTHORIZED handler (current lines 44-66), add after line 64:**
```typescript
// Import added to top of file alongside other store imports:
import { useSpatialFilterStore } from "./store/spatialFilterStore";

// Inside the useEffect where status === 'unauthenticated', after lastInfoClickContextStore.reset():
// Phase 27 STORE-V15-04: fifth reset — spatial filter store.
// Session-only shapes; no server-side DROP loop needed.
useSpatialFilterStore.getState().reset();
```

**`DashboardsPage.tsx` DashboardOpen cleanup (current lines 398-406), add after line 406:**
```typescript
// Import added to top of file:
import { useSpatialFilterStore } from "../store/spatialFilterStore";

// Inside the useEffect return cleanup, after lastInfoClickContextStore.reset():
// Phase 27 STORE-V15-04: fifth reset — spatial filter store.
useSpatialFilterStore.getState().reset();
```

### Pattern 3: Spec with Zustand reset shim (no-bleed canary)

**What:** The `vi.mock("zustand")` in `src/test/setup.ts` activates `__mocks__/zustand.ts`, which registers every store created via `create()` in an `afterEach` reset set. As long as the new store file is under `src/store/`, the shim auto-applies — no per-spec configuration needed.

**Standard spec preamble (from `lastInfoClickContextStore.spec.ts`):**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpatialFilterStore } from "./spatialFilterStore";

// Zustand reset shim auto-resets between tests via vi.mock("zustand") in src/test/setup.ts.
// No explicit beforeEach reset needed for store state.
```

**Canary pattern to verify shim is active (always include two identical tests at top):**
```typescript
describe("useSpatialFilterStore — canary (shim must be active)", () => {
  it("store is empty at start of each test", () => {
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
    expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
    expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
  });
  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    expect(useSpatialFilterStore.getState().shapes).toEqual([]);
    expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
  });
});
```

**`crypto.randomUUID()` stub in beforeEach:**
```typescript
let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    () => `uuid-${++uuidCounter}` as ReturnType<typeof crypto.randomUUID>
  );
});
```

### Anti-Patterns to Avoid

- **Deriving label N from `shapes.length`:** After `addShape → addShape → removeShape(first)`, `shapes.length` is 1 but the next shape should be labeled "... 3" not "... 2". Always use `shapeCounter` in state.
- **Resetting `shapeCounter` on `removeShape`:** The monotonic-no-recycle rule explicitly forbids it.
- **Importing from `src/state/` directory:** REQUIREMENTS.md mentions `src/state/` but the codebase convention is `src/store/`. Creating `src/state/` would break shim coverage and introduce a new directory that doesn't exist.
- **Using immer or devtools middleware:** No existing store uses them. The convention is plain `create<State>((set) => ...)` with explicit spread returns.
- **Incrementing `spatialFilterVersion` on `reset()`:** `reset()` is a lifecycle wipe, not a mutation signal. It hard-sets to 0.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-test state bleed | Custom beforeEach reset logic | Zustand reset shim (`__mocks__/zustand.ts`) | Shim is already active via `vi.mock("zustand")` in setup.ts; hand-rolling reset in beforeEach creates double-reset risk and misses the official shim mechanism |
| UUID generation | Custom ID builder | `crypto.randomUUID()` | Web standard, zero collision, already available in jsdom test environment |
| Middleware for session-only store | immer, persist, devtools | Plain `create<State>((set) => ...)` | No existing store uses middleware; adding it would deviate from convention and add bundle weight for no benefit |

**Key insight:** The entire store implementation follows established patterns already verified in 4 production stores. The planner should not introduce any new patterns.

---

## Common Pitfalls

### Pitfall 1: File placed in `src/state/` instead of `src/store/`

**What goes wrong:** The Zustand reset shim (`__mocks__/zustand.ts`) is activated via `vi.mock("zustand")` in `src/test/setup.ts`. The shim captures stores created anywhere, BUT the CONTEXT.md explicitly locks the path to `src/store/` to match the established codebase convention. If a `src/state/` directory is created, it's a new directory that doesn't exist, will cause confusion for future phases, and makes grepping harder.

**How to avoid:** `kinetica_bi/src/store/spatialFilterStore.ts` — exactly as specified.

**Warning signs:** Any task instruction that says "create `src/state/spatialFilterStore.ts`" — this is a REQUIREMENTS.md error that CONTEXT.md corrects.

### Pitfall 2: `clearAll()` when empty increments version

**What goes wrong:** The no-op rule for `clearAll()` with empty shapes is a success criterion (SC-4). If the early-return `if (s.shapes.length === 0) return s;` is missing, `spatialFilterVersion` increments spuriously. This would cause a spurious `AggregatedWidgetRenderer` dep-array re-fire in Phase 30.

**How to avoid:** Mirror the exact pattern from `filterStore.ts::clearFilters`:
```typescript
// filterStore.ts reference (lines 87-97):
clearFilters: (tableId) =>
  set((state) => {
    const existing = state.filters[tableId] ?? [];
    if (existing.length === 0) return state; // nothing to clear — no version bump
    ...
  }),
```

**Warning signs:** Spec test `clearAll() with empty shapes → no version bump` fails.

### Pitfall 3: `removeShape` decrements or resets `shapeCounter`

**What goes wrong:** The post-removal counter monotonicity rule is locked. If `shapeCounter` is decremented or recalculated from `shapes.length` after a remove, label N will recycle within a session, violating success criterion 2.

**How to avoid:** `removeShape` only touches `shapes` and `spatialFilterVersion`. It never touches `shapeCounter`.

### Pitfall 4: 5th reset call added at wrong position in `App.tsx`

**What goes wrong:** The canonical order is `filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore`. If the 5th call is inserted before any of the first 4 (e.g., before the DROP loop snapshot), the views snapshot may already be cleared.

**How to avoid:** Insert `useSpatialFilterStore.getState().reset()` as the last line inside the `if (status === 'unauthenticated')` block in `App.tsx`. The current 4th call is at line 64 (`useLastInfoClickContextStore.getState().reset()`); the 5th goes immediately after.

**Warning signs:** The lifecycle reset spec asserts `filterViewStore.views === {}` before `spatialFilterStore.reset()` is called — this order is already validated by the existing test structure.

### Pitfall 5: `shapeCounter` exposed in the public type signature

**What goes wrong:** Downstream Phase 29/30 consumers should not need to read `shapeCounter` directly. If exported via the public store type, it creates an implicit contract that future refactors (e.g., per-type counters in v1.6) would have to maintain.

**How to avoid:** Keep `shapeCounter` in the state definition but do not add a getter function for it. Phase 29 reads `shapes[]` and `shapes.length`. Phase 30 reads `spatialFilterVersion`. Neither needs `shapeCounter`.

### Pitfall V15-P-09 (from STATE.md): Store updates only at `drawend`

**What goes wrong:** Phase 29 will add OL Draw interactions. If any Phase 29 code writes to `useSpatialFilterStore` on `pointermove` (live-draw updates), every cursor move triggers cross-map re-renders. This is V15-P-09 from STATE.md.

**How Phase 27 prevents it:** Phase 27 ships with no OL consumer. Phase 29's plan must include V15-P-09 as an explicit constraint. Document it in RESEARCH.md so the Phase 29 planner picks it up.

---

## Code Examples

Verified patterns from production source:

### Existing 4-store reset block — `App.tsx` lines 44-66

```typescript
// Source: kinetica_bi/src/App.tsx — current production code
useEffect(() => {
  if (status === "unauthenticated") {
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();          // 1st
    useFilterStore.getState().reset();              // 2nd
    useInfoSelectionStore.getState().reset();       // 3rd
    useLastInfoClickContextStore.getState().reset(); // 4th
    // Phase 27 STORE-V15-04: useSpatialFilterStore.getState().reset(); // 5th — ADD HERE
  }
}, [status]);
```

### Existing 4-store reset block — `DashboardsPage.tsx` lines 388-407

```typescript
// Source: kinetica_bi/src/components/DashboardsPage.tsx — DashboardOpen cleanup
useEffect(() => {
  return () => {
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();          // 1st
    useFilterStore.getState().reset();              // 2nd
    useInfoSelectionStore.getState().reset();       // 3rd
    useLastInfoClickContextStore.getState().reset(); // 4th
    // Phase 27 STORE-V15-04: useSpatialFilterStore.getState().reset(); // 5th — ADD HERE
  };
}, [dashboard.id]);
```

### Lifecycle reset spec — 5-store assertion pattern (extends DashboardsPage.spec.tsx)

The existing spec at `DashboardsPage.spec.tsx` has a test named `"resets ALL FOUR stores when cleanup runs (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore — STORE-V14-03 + Plan 23-02 extension)"`. Phase 27 extends this to assert the 5th store:

```typescript
// Pattern: import the new store, seed it, assert it resets
import { useSpatialFilterStore } from "../store/spatialFilterStore";

// In the test body:
useSpatialFilterStore.getState().addShape({ type: 'bbox', wkt: 'POLYGON(...)', measurement: '5km × 3km' });
expect(useSpatialFilterStore.getState().shapes.length).toBe(1);

// ... invoke cleanup ...

expect(useSpatialFilterStore.getState().shapes).toEqual([]);
expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
```

### Zustand shim — how it works (from `__mocks__/zustand.ts`)

```typescript
// Source: kinetica_bi/__mocks__/zustand.ts — read-only reference, do not modify
const storeResetFns = new Set<() => void>();

const createUncurried = <T>(stateCreator: StateCreator<T>) => {
  const store = actualCreate(stateCreator);
  const initialState = store.getState();
  storeResetFns.add(() => store.setState(initialState, true)); // true = replace (not merge)
  return store;
};

afterEach(() => {
  act(() => {
    storeResetFns.forEach((fn) => fn()); // auto-fires after every test
  });
});
```

The shim captures `initialState` at store-creation time (import time in vitest). Any state mutation during a test is wiped by this `afterEach`. No per-spec `beforeEach` reset is needed for store fields.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual beforeEach reset in each spec | Zustand reset shim via `__mocks__/zustand.ts` | Established Phase 14 (v1.3) | Zero state bleed without per-spec boilerplate; spec files are shorter |
| 2-store reset block | 4-store reset block | Phase 23 (Plan 23-02) | Pattern is additive; Phase 27 extends to 5 |
| No spatial state | Session-scoped spatial filter store | Phase 27 (this phase) | Downstream Phases 29-30 can subscribe without prop-drilling |

---

## Open Questions

1. **Should `shapeCounter` be exposed or hidden?**
   - What we know: No downstream consumer (Phase 29, 30) needs to read `shapeCounter` directly.
   - Recommendation: Keep as internal state field (part of `State` type but not a separate getter). If a future consumer needs it, the field is already in `getState()`.

2. **`Date.now()` stubbing in tests?**
   - What we know: `addedAt` uses `Date.now()`. Without stubbing, `addedAt` is non-deterministic.
   - Recommendation: `vi.spyOn(Date, 'now').mockReturnValue(12345)` in `beforeEach` for tests that assert on `shape.addedAt`. Tests that only check label/id/type/version do not need it.

3. **REQUIREMENTS.md path deviation — update or document?**
   - What we know: REQUIREMENTS.md STORE-V15-01 says `src/state/spatialFilterStore.ts`; CONTEXT.md locks to `src/store/spatialFilterStore.ts`.
   - Recommendation: The planner should add a task to update REQUIREMENTS.md STORE-V15-01's path reference during the planning phase. One-line fix.

---

## Downstream Consumer API Contracts (Phase 29-30 awareness)

Phase 27 ships dormant but must meet these API shapes on day one:

**Phase 29 (`SHAPE-V15-01`) will subscribe via primitive selector:**
```typescript
// In MapChartRenderer (Phase 29):
const shapesKey = useSpatialFilterStore((s) => s.shapes.map((sh) => sh.id).join('|'));
```
This is the PITFALL S-02 mitigation: subscribe to a derived primitive string, not the `shapes[]` array reference. Phase 27's store must keep `shapes[]` reference-stable when unchanged (which it does — `removeShape` with a non-existent id returns `s`, preserving reference identity).

**Phase 30 (`MAT-V15-01`) will read `spatialFilterVersion` in dep array:**
```typescript
// In AggregatedWidgetRenderer (Phase 30):
// Effect 1 dep array gains spatialFilterVersion alongside existing filterVersion
const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
```
The store's version-counter semantics (no spurious increments on no-ops) are critical to prevent phantom materializations.

**Phase 30 (`CHIP-V15-01`) will read `shapes[]` for chip rendering:**
```typescript
const shapes = useSpatialFilterStore((s) => s.shapes);
// Chip: shape.label ("Bbox 1"), shape.measurement ("5km × 3km"), shape.id (for removeShape)
```
All three fields must be present on every Shape object from `addShape`.

---

## Sources

### Primary (HIGH confidence)

- `kinetica_bi/src/store/lastInfoClickContextStore.ts` — closest sibling store (50 LOC, session-only, reset-only lifecycle). Read directly.
- `kinetica_bi/src/store/filterStore.ts` — `filterVersion` counter pattern reference. Read directly.
- `kinetica_bi/src/store/infoSelectionStore.ts` — spec style reference for grouped describe blocks. Read directly.
- `kinetica_bi/__mocks__/zustand.ts` — Zustand reset shim mechanism. Read directly.
- `kinetica_bi/src/test/setup.ts` — `vi.mock("zustand")` activation confirmed. Read directly.
- `kinetica_bi/src/App.tsx` lines 44-66 — 4-store reset block, exact insertion point. Read directly.
- `kinetica_bi/src/components/DashboardsPage.tsx` lines 388-407 — DashboardOpen cleanup block. Read directly.
- `kinetica_bi/src/App.spec.tsx` — 4-store lifecycle reset spec pattern. Read directly.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` — DashboardOpen cleanup spec pattern. Read directly.
- `kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` — closest spec style to follow. Read directly.
- `.planning/phases/27-spatial-filter-store/27-CONTEXT.md` — all implementation decisions locked.

### Secondary (MEDIUM confidence)

- `.planning/REQUIREMENTS.md` STORE-V15-01..04 — phase requirements (path deviation vs CONTEXT.md noted).
- `.planning/ROADMAP.md` Phase 27 section — success criteria verification.
- `.planning/STATE.md` — V15-P-09 Zustand re-render lock documented; v1.4 pattern history.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from 4 production stores; no new libraries.
- Architecture patterns: HIGH — verified from production code and spec files; exact line numbers confirmed.
- Pitfalls: HIGH — derived from CONTEXT.md locked decisions + filterStore.ts existing no-op pattern + V15-P-09 from STATE.md.
- Downstream consumer API: HIGH — derived from ROADMAP.md Phase 29/30 requirements + CONTEXT.md canonical_refs.

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (stable Zustand patterns; project conventions do not drift)
