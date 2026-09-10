# Phase 27: spatial-filter-store - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Pure Zustand session-only store holding committed drawn shapes for the v1.5 spatial-filtering pipeline, plus a `spatialFilterVersion` counter consumed (in later phases) by the materialize trigger, plus 5th-position lifecycle reset wiring.

**Ships dormant.** No OpenLayers consumer (Phase 29 `MapDrawToolbar` / VectorLayer) and no FilterBar consumer (Phase 30 spatial chips) is written in this phase. Phase 27 is pure state + tests + reset wiring.

**Independent of Phase 26** — runs in parallel; no server module imports.

</domain>

<decisions>
## Implementation Decisions

### Store contract (locked by REQUIREMENTS.md STORE-V15-01..04 and ROADMAP success criteria)

- **State shape:** `{ shapes: Shape[], spatialFilterVersion: number, shapeCounter: number }`
  - `spatialFilterVersion` is the dep-array signal for the future `AggregatedWidgetRenderer` extension (Phase 30).
  - `shapeCounter` is the internal monotonic source for label `N` (kept in state, not derived from `shapes.length` — see "N counter semantics" below).
- **Shape type:** `{ id: string, type: 'bbox'|'lasso'|'circle', wkt: string (EPSG:4326), label: string, measurement: string, addedAt: number }`
- **Actions:** `addShape(shape: Omit<Shape, 'id' | 'label' | 'addedAt'>)`, `removeShape(id: string)`, `clearAll()`, `reset()`.
  - The store generates `id`, `label`, and `addedAt` internally so callers don't synthesize them. Caller passes `{ type, wkt, measurement }`.
- **Path:** `kinetica_bi/src/store/spatialFilterStore.ts` (NOT `src/state/` as REQUIREMENTS.md STORE-V15-01 says — the established convention is `src/store/`, and the Zustand reset shim in `kinetica_bi/__mocks__/zustand.ts` auto-covers `src/store/*.ts`).
  - Planner note: update REQUIREMENTS.md STORE-V15-01 path during planning, OR document the deviation; do NOT create a new `src/state/` directory.
- **Spec path:** `kinetica_bi/src/store/spatialFilterStore.spec.ts` (sibling spec, vitest + jsdom + Zustand reset shim auto-applies).

### N counter semantics (label number)

- **Scope: session-wide global, single counter.** Sequence: Bbox 1, Circle 2, Lasso 3, Bbox 4. NOT per-type. The roadmap's example `"Bbox 1", "Circle 2", "Lasso 3"` matches this; per-type would give `"Bbox 1", "Circle 1", "Lasso 1"`.
- **Increment mode: monotonic counter stored in state (`shapeCounter`).** Each `addShape` bumps `shapeCounter` and the new shape's label is `${TypeCapitalized} ${shapeCounter}`. Type capitalization: `bbox → "Bbox"`, `lasso → "Lasso"`, `circle → "Circle"`.
- **Post-removal: monotonic, no recycling.** `addShape → addShape → removeShape(first) → addShape` yields labels Bbox 1, Bbox 2, (Bbox 1 removed), Bbox 3. The counter never goes backward inside a session.
- **`clearAll()` resets the counter to 0.** Empties `shapes[]` AND sets `shapeCounter = 0`. Next `addShape` produces `${Type} 1`. (User mental model: "clear all = start over.")
- **`reset()` resets the counter to 0.** Same zero point as `clearAll()`. Wipes everything.
- **Counter never resets on `removeShape`.** Even if shapes.length drops to 0 via successive removes, the counter is unchanged. Only `clearAll()` and `reset()` zero it.

### `spatialFilterVersion` semantics

- Increments by 1 on every successful mutation: `addShape`, `removeShape(existing id)`, `clearAll()` when `shapes.length > 0`.
- **No-op cases (locked by success criteria 4 + the contract here):**
  - `removeShape(non-existent id)` — no shape match, `spatialFilterVersion` unchanged.
  - `clearAll()` when `shapes.length === 0` — nothing to clear, `spatialFilterVersion` unchanged. (`shapeCounter` is also unchanged — already 0 or no-op.)
- `reset()` sets `spatialFilterVersion = 0` (lifecycle hard-reset, not a mutation).

### Shape ID generation

- **`crypto.randomUUID()`** — UUID v4 string. Available in modern browsers (all current evergreens) and Node 16+. Globally unique, zero collision risk for a session-scoped store.
- Generated inside `addShape` — callers pass `{ type, wkt, measurement }`, store synthesizes `id`, `label`, `addedAt`.
- **Test strategy:** `vi.spyOn(globalThis.crypto, 'randomUUID')` in beforeEach to return deterministic stubs (`'uuid-1'`, `'uuid-2'`, ...) for assertions on `shape.id`. Mirrors how prior store specs handle non-deterministic state.

### Lifecycle reset wiring (5th store)

- Reset called from two sites, both already established:
  - `kinetica_bi/src/App.tsx` UNAUTHORIZED-event handler (status === 'unauthenticated')
  - `kinetica_bi/src/pages/DashboardsPage.tsx` DashboardOpen cleanup
- **Canonical order:** `filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore` (5th position).
- **No DROP loop / no server-side cleanup** — store is session-only, dashboard-scoped client state with no server resources to free. Mirrors `infoSelectionStore` and `lastInfoClickContextStore` reset pattern (NOT `filterViewStore`'s view-DROP snapshot loop).
- Reset wiring lives in this phase (Phase 27), not deferred — STORE-V15-04 is part of this phase's scope.

### Test coverage (locked by ROADMAP success criteria 4)

- Vitest spec at `kinetica_bi/src/store/spatialFilterStore.spec.ts`.
- Must cover:
  - No state bleed across tests (auto-handled by `__mocks__/zustand.ts` reset shim).
  - `addShape` produces shape with correct fields; `id` from stubbed `randomUUID`; `label` from monotonic counter with type-capitalization; `addedAt` from `Date.now()` (also stubbable).
  - `removeShape(existing)` removes + bumps `spatialFilterVersion`.
  - `removeShape(non-existent)` is a no-op (no array mutation, no version bump).
  - `clearAll()` with shapes → empties + bumps version + resets `shapeCounter` to 0.
  - `clearAll()` with empty shapes → no version bump, no state change (locked).
  - `reset()` zeroes everything.
  - N counter sequence: Bbox 1 → Circle 2 → Lasso 3 → Bbox 4 (session-wide global).
  - N counter post-removal: monotonic, no recycling (Bbox 1, Bbox 2, remove first, Bbox 3).
  - N counter post-clearAll: resets to 0, next addShape → Bbox 1.
- Lifecycle reset test in `App.tsx` and `DashboardsPage.tsx` specs (or sibling) confirms all 5 stores' reset() called in canonical order.

### Claude's Discretion

- Exact `addShape` parameter shape (whether `{ type, wkt, measurement }` is an object arg or three positional — the convention is object arg per prior stores).
- Whether `shapeCounter` is publicly readable or hidden internal state (recommend hidden — exported via getter only if a downstream consumer needs it).
- Spec organization (single describe block vs grouped per-action) — follow `infoSelectionStore.spec.ts` style.
- Whether to stub `Date.now()` in tests — recommend yes for `addedAt` determinism, but it's a soft preference.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 27 scope
- `.planning/ROADMAP.md` §"Phase 27: spatial-filter-store" — Goal, depends-on, requirements list, 4 success criteria
- `.planning/REQUIREMENTS.md` — STORE-V15-01..04 (the four phase requirements with full Shape type + action signatures)
- `.planning/PROJECT.md` §"Current Milestone: v1.5 Spatial filtering on map" — milestone-level intent

### Established Zustand store patterns (mirror these)
- `kinetica_bi/src/store/lastInfoClickContextStore.ts` — Closest sibling pattern: session-only, single-purpose, reset-only-lifecycle, no DROP loop. Phase 23 reference implementation.
- `kinetica_bi/src/store/infoSelectionStore.ts` — Session-only Zustand store with complex action set. Phase 20 reference. Uses the `__mocks__/zustand.ts` reset shim.
- `kinetica_bi/src/store/filterStore.ts` — Original `filterVersion` counter pattern that `spatialFilterVersion` mirrors.

### Lifecycle reset block (touched in this phase)
- `kinetica_bi/src/App.tsx` lines 44-66 — Current 4-store UNAUTHORIZED reset block. Phase 27 extends to 5 stores.
- `kinetica_bi/src/pages/DashboardsPage.tsx` — DashboardOpen cleanup also extends to 5 stores.

### Test infra
- `kinetica_bi/__mocks__/zustand.ts` — Zustand reset shim, auto-applied to `src/store/*.ts` files via `vi.mock("zustand")` in `src/test/setup.ts`. Critical: keeps the new store under `src/store/` (not `src/state/`) so the shim covers it.
- `kinetica_bi/src/store/lastInfoClickContextStore.spec.ts` — Closest spec style to follow.
- `kinetica_bi/src/store/infoSelectionStore.spec.ts` — Action-coverage style for stores with several mutations.

### Downstream consumers (do NOT touch in this phase, but be aware of the contract)
- Phase 29 `SHAPE-V15-01` — `MapChartRenderer` will subscribe to `shapesKey` primitive selector (joined IDs string per PITFALL S-02). Store must keep `shapes[]` reference-stable when unchanged.
- Phase 30 — `AggregatedWidgetRenderer` will read `spatialFilterVersion` as a dep-array signal.
- Phase 28 `SpatialTarget` type — separate file (`spatialTargets.ts`), no dependency from Phase 27.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`__mocks__/zustand.ts` reset shim** — auto-applies to `src/store/*.ts`. New store goes in `src/store/` (not the REQUIREMENTS.md-stated `src/state/`) so it gets coverage for free.
- **`lastInfoClickContextStore.ts`** — copy-paste-shape starting point for session-only + reset-only-lifecycle pattern. 50 LOC reference.
- **`filterStore.ts`'s `filterVersion`** — exact mental model for `spatialFilterVersion` (counter that the materialize trigger reads from a dep array).

### Established Patterns
- **Session-only stores have NO `localStorage`/`sessionStorage`/SQLite/URL persistence** — locked across v1.3/v1.4. Phase 27 follows.
- **Reset block grows as stores are added; canonical order tracked in `App.tsx` comments** — 4th store (Phase 23) is currently last; Phase 27 makes it 5th.
- **Counter-style state fields use plain incrementing numbers** (e.g. `filterVersion`, `materializeVersion`) — no overflow guard, sessions are short.
- **Action signatures pass an object arg** when 2+ fields are involved, plain positional arg for single-id actions like `removeShape(id)`.

### Integration Points
- `App.tsx` lines 44-66 — append `useSpatialFilterStore.getState().reset();` as 5th line in the existing reset block, with a comment citing STORE-V15-04.
- `DashboardsPage.tsx` DashboardOpen cleanup — mirror.
- Imports added to both files.

</code_context>

<specifics>
## Specific Ideas

- Label format examples (locked): "Bbox 1", "Circle 2", "Lasso 3". Type-name capitalization: `bbox → Bbox`, `lasso → Lasso`, `circle → Circle` (first letter cap, rest lowercase). NOT `BBOX 1` (all caps) or `bbox 1` (lowercase) — the roadmap example dictates title case.
- The user mental model for `clearAll()` is "start over" — that's why counter resets to 0. The user-facing chip list and toolbar behavior in later phases reinforces this; a user who hits "Clear all spatial filters" expects the next shape they draw to be #1, not #N+1.
- The user accepted Claude's recommendation on all four gray areas, so the decisions above are the conservative-default lock; the planner should not second-guess them.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 28 `SpatialTarget` type** — referenced obliquely by ROADMAP Phase 28 entry but defined separately. Phase 27 does NOT import or define `SpatialTarget`. Phase 28 handles `widget.config.spatialTargets` persistence and `isSpatialTargetEligible(target)` predicate.
- **OL VectorLayer / VectorSource integration** — Phase 29 (`SHAPE-V15-01..04`).
- **`shapesKey` primitive selector** — Phase 29 consumer-side concern. Phase 27 just needs to keep `shapes[]` reference-stable when unchanged so a `shapesKey = shapes.map(s => s.id).join('|')` selector stays cheap.
- **FilterBar chip integration** — Phase 30 (`materialize-and-chips`).
- **`addShape` triggering the materialize endpoint** — Phase 30. Phase 27 is dormant.

</deferred>

---

*Phase: 27-spatial-filter-store*
*Context gathered: 2026-05-12*
