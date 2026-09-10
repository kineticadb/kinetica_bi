---
phase: 20-info-selection-store
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/store/infoSelectionStore.ts
  - kinetica_bi/src/store/infoSelectionStore.spec.ts
autonomous: true
requirements:
  - STORE-V14-01
  - STORE-V14-02
  - STORE-V14-04
  - STORE-V14-05
must_haves:
  truths:
    - "useInfoSelectionStore Zustand slice exists at kinetica_bi/src/store/infoSelectionStore.ts with the locked state shape (state: Record<layerId, InfoSelectionEntry> + activeLayerId: number | null)"
    - "Store exposes 7 actions: setSelection, appendPage, clearSelection, setActiveLayer, setLoading, setError, reset"
    - "Calling setActiveLayer(B) when current activeLayerId is A (A !== B) deletes state[A] entirely (rows, columns, page, hasMore, loading, error all gone)"
    - "Calling setActiveLayer(A) when current activeLayerId is A is a full no-op (no state change)"
    - "appendPage pushes new rows onto existing entry without losing prior pages, preserves columns, sets page + hasMore from payload"
    - "setLoading and setError create placeholder entries when layerId is absent (mirrors useFilterViewStore.markMaterializing pattern)"
    - "setSelection preserves the prior loading flag (does NOT auto-clear) per CONTEXT.md § Action contract — caller toggles setLoading separately"
    - "setSelection clears the error flag to null (judgment call: settled rows obsolete the prior error; not locked by CONTEXT.md)"
    - "Reference identity: mutating state[layerId=A] preserves object identity of state[layerId=B] entries (selector-stability)"
    - "Spec proves Zustand reset shim auto-covers the store — first test asserts state === {} at start, second test asserts state === {} at start (back-to-back identity)"
  artifacts:
    - path: "kinetica_bi/src/store/infoSelectionStore.ts"
      provides: "useInfoSelectionStore Zustand slice with locked shape + 7 actions"
      contains: "export const useInfoSelectionStore = create<InfoSelectionState>"
    - path: "kinetica_bi/src/store/infoSelectionStore.spec.ts"
      provides: "vitest spec covering all 7 actions, no-op paths, placeholder paths, layer-switch delete-key, append-fail rows-preserved, reference stability, reset shim canary, setSelection-preserves-loading regression"
      contains: 'describe("useInfoSelectionStore'
  key_links:
    - from: "kinetica_bi/src/store/infoSelectionStore.ts"
      to: "kinetica_bi/__mocks__/zustand.ts (via vi.mock(\"zustand\") in src/test/setup.ts)"
      via: "Zustand reset shim auto-covers any store under src/store/*.ts"
      pattern: "import .* from \"zustand\""
    - from: "kinetica_bi/src/store/infoSelectionStore.spec.ts"
      to: "kinetica_bi/src/store/infoSelectionStore.ts"
      via: "spec imports useInfoSelectionStore and exercises all 7 actions"
      pattern: "import .* from \"./infoSelectionStore\""
---

<objective>
Ship `useInfoSelectionStore` — a frontend Zustand slice that holds the dashboard's current map info-popup selection per-layerId, plus a comprehensive vitest spec proving all 7 actions, no-op paths, placeholder paths, layer-switch state retention, append-fail behavior, and reference stability.

Purpose: Phase 21 (popup) and Phase 23 (Info Card) both need a stable consumer-ready store before they can be built. STORE-V14-01 / V14-02 / V14-05 acceptance criteria all live in the store and its spec; STORE-V14-04 (logout reset wiring) lands in plan 20-02 but needs the store to exist first.

Output: Two new files under `kinetica_bi/src/store/`. Store ships dormant for popup/card consumers; lifecycle reset wiring lands in plan 20-02.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/20-info-selection-store/20-CONTEXT.md

# Reference pattern (the primary template for this entire plan)
@kinetica_bi/src/store/filterViewStore.ts

# Reference for exact-duplicate dedupe / no-op pattern
@kinetica_bi/src/store/filterStore.ts

# Reference for spec style + Zustand reset shim canary pattern
@kinetica_bi/src/store/filterViewStore.spec.ts

# Test infra
@kinetica_bi/__mocks__/zustand.ts
@kinetica_bi/src/test/setup.ts

<interfaces>
<!-- Reference shapes the executor MUST match. Locked by 20-CONTEXT.md and REQUIREMENTS.md STORE-V14-01. -->

Locked store shape (from 20-CONTEXT.md § "Store shape" + § "Action contract"):
```typescript
export type InfoSelectionEntry = {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
};

export type InfoSelectionState = {
  state: Record<number, InfoSelectionEntry>; // keyed by layerId (number, matches DashboardLayerDto.id)
  activeLayerId: number | null;

  setSelection: (layerId: number, payload: { rows: Record<string, unknown>[]; columns: string[]; page: number; hasMore: boolean }) => void;
  appendPage: (layerId: number, payload: { rows: Record<string, unknown>[]; page: number; hasMore: boolean }) => void;
  clearSelection: (layerId: number) => void;
  setActiveLayer: (layerId: number) => void;
  setLoading: (layerId: number, loading: boolean) => void;
  setError: (layerId: number, error: string | null) => void;
  reset: () => void;
};

export const useInfoSelectionStore = create<InfoSelectionState>((set) => ({
  state: {},
  activeLayerId: null,
  // ... actions
}));
```

Reference patterns from useFilterViewStore (filterViewStore.ts):
- Reference-stable per-key update (lines 59-73): `return { state: { ...state.state, [layerId]: nextEntry } };`
- Delete-key clear (lines 75-81): `if (!(layerId in state.state)) return state; const next = { ...state.state }; delete next[layerId]; return { state: next };`
- Placeholder-on-missing (lines 89-96): `const prev = state.state[layerId]; const nextEntry = prev ? { ...prev, ... } : { rows: [], columns: [], page: 0, hasMore: false, loading: false, error: null, ... };`
- Internal-only reset (line 128): `reset: () => set({ state: {}, activeLayerId: null }),`

Reference patterns from useFilterStore (filterStore.ts):
- Exact-duplicate dedupe / no-op same-value (lines 53-58): `if (sameValue) return state; // silent — no version bump`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create useInfoSelectionStore Zustand slice</name>
  <files>kinetica_bi/src/store/infoSelectionStore.ts</files>
  <read_first>
    - kinetica_bi/src/store/filterViewStore.ts (THE primary template — copy structure verbatim, adapt names + shape)
    - kinetica_bi/src/store/filterStore.ts (reference for exact-duplicate dedupe pattern in setActiveLayer same-layer no-op, lines 53-58)
    - kinetica_bi/__mocks__/zustand.ts (verify shim auto-coverage requires nothing from store author)
    - .planning/phases/20-info-selection-store/20-CONTEXT.md (locked decisions — re-read § "Action contract" + § "activeLayerId invariant" + § "Layer-switch state retention")
  </read_first>
  <behavior>
    - State initial: `state: {}`, `activeLayerId: null`
    - `setSelection(layerId, { rows, columns, page, hasMore })`: REPLACE semantics — writes `{ rows, columns, page, hasMore, loading: prev?.loading ?? false, error: null }`. Does NOT auto-clear loading per CONTEXT.md § Action contract — caller toggles `setLoading(true)` before fetch and `setLoading(false)` after success/error. Clears `error` to null because settled data replaces an errored state (CONTEXT.md does not lock this — judgment call: settled rows obsolete the prior error). Reference-stable: only `state[layerId]` is new; other layers' entries keep object identity.
    - `appendPage(layerId, { rows, page, hasMore })`: APPEND semantics. If `state[layerId]` is absent, no-op (return state unchanged — appendPage with no prior page is a caller bug, store does not invent rows). If present, returns `{ ...prev, rows: [...prev.rows, ...rows], page, hasMore }`. `columns`, `loading`, `error` UNCHANGED.
    - `clearSelection(layerId)`: DELETE-KEY. If `!(layerId in state.state)` return state unchanged (no-op); otherwise delete the key. Mirror filterViewStore.clearView (lines 75-81).
    - `setActiveLayer(layerId)`: Number-only signature. If `layerId === state.activeLayerId` return state unchanged (no-op, mirrors filterStore exact-duplicate dedupe). Otherwise: in a SINGLE `set()` call, both (a) delete `state[priorActiveLayerId]` if priorActive is non-null AND `state[priorActive]` exists, and (b) set `activeLayerId = layerId`. The new layerId's entry is NOT touched (caller is responsible for setSelection on the new layer).
    - `setLoading(layerId, loading)`: Per-layer flag. If `state[layerId]` absent, create placeholder `{ rows: [], columns: [], page: 0, hasMore: false, loading, error: null }`. If present, `{ ...prev, loading }`. Reference-stable.
    - `setError(layerId, error)`: Per-layer error. If `state[layerId]` absent, create placeholder `{ rows: [], columns: [], page: 0, hasMore: false, loading: false, error }`. If present, `{ ...prev, error }` — rows are preserved (append-fail UX lock per CONTEXT.md § "specifics"). Reference-stable.
    - `reset()`: Top-level wipe. `set({ state: {}, activeLayerId: null })`. Internal-only (no UI surface).
    - All per-layer mutations use the `{ state: { ...state.state, [layerId]: nextEntry } }` reference-stable pattern from filterViewStore.ts:72.
  </behavior>
  <action>
Create `kinetica_bi/src/store/infoSelectionStore.ts` with the exact shape and 7 actions specified in the `<behavior>` block. Use `useFilterViewStore` (filterViewStore.ts) as the structural template — copy the file's import + create() + action layout, adapt names and shape.

CONCRETE CONTENTS — write this file:

```typescript
/**
 * Phase 20 (STORE-V14-01..05): per-layerId info-selection store.
 *
 * Three-store split (locked at .planning/STATE.md § "Key v1.4 Architecture Decisions"):
 *   - useFilterStore (UNCHANGED v1.2 slice) — chip state, filterVersion.
 *   - useFilterViewStore (UNCHANGED v1.3 slice) — server-resolved view names per tableId.
 *   - useInfoSelectionStore (THIS FILE) — current map info-popup selection per layerId.
 *
 * All three stores reset together at the same two lifecycle sites:
 *   - DashboardsPage.tsx DashboardOpen cleanup (lines 386-399).
 *   - App.tsx UNAUTHORIZED handler (lines 42-56).
 * Plan 20-02 wires this store at those sites; this file ships the store + actions only.
 *
 * The store is automatically covered by the Zustand reset shim (kinetica_bi/__mocks__/zustand.ts
 * activated via vi.mock("zustand") in src/test/setup.ts) because it lives under src/store/*.ts.
 *
 * Reference-stable per-layerId updates (mirrors useFilterViewStore.setView at filterViewStore.ts:59-73):
 * mutating state[layerId=A] returns a new top-level state object but entries for OTHER layerIds
 * keep their object identity. Phase 21/23 selector consumers must scope to s.state[layerId].
 *
 * activeLayerId invariant (locked in 20-CONTEXT.md § "activeLayerId invariant"):
 *   - Type signature is `number` not `number | null` — there is NO setActiveLayer(null) path.
 *   - The only paths to activeLayerId === null are: (a) initial state, (b) reset().
 *   - Phase 21 popup dismiss (POPUP-V14-05) calls reset(), not setActiveLayer(null).
 *
 * Layer-switch state retention (locked in 20-CONTEXT.md § "Layer-switch state retention"):
 *   - setActiveLayer(B) when current is A (A !== B) FULLY DELETES state[A] (rows, columns, page,
 *     hasMore, loading, error all gone). Returning to A re-fetches from scratch.
 *   - state[B] is NOT touched by setActiveLayer (Phase 21 click handler decides whether to
 *     overwrite via setSelection).
 *   - setActiveLayer(A) when current is A is a full no-op (no state change).
 *
 * setSelection loading-flag preservation (locked in 20-CONTEXT.md § "Action contract" line 28):
 *   - setSelection does NOT auto-clear `loading`. Caller toggles setLoading(true) before fetch
 *     and setLoading(false) after success/error. setSelection writes `loading: prev?.loading ?? false`
 *     so a setLoading(true) -> setSelection(payload) sequence preserves the loading flag for the
 *     caller to clear via setLoading(false). Phase 21 click handler is built against this contract.
 *   - setSelection DOES clear `error` to null (judgment call — not locked by CONTEXT.md): settled
 *     rows obsolete the prior error. Caller does not need to setError(null) before/after setSelection.
 *
 * Append-fail rows-preserved (locked in 20-CONTEXT.md § "specifics"):
 *   - setError leaves prior rows in place (mirrors filterViewStore.clearMaterializing preserves-fields
 *     pattern at filterViewStore.ts:104-113). Page 4 fail must NOT wipe pages 1-3 — hostile UX.
 */

import { create } from "zustand";

export type InfoSelectionEntry = {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
};

export type InfoSelectionState = {
  state: Record<number, InfoSelectionEntry>; // keyed by layerId (number, matches DashboardLayerDto.id)
  activeLayerId: number | null;

  setSelection: (
    layerId: number,
    payload: { rows: Record<string, unknown>[]; columns: string[]; page: number; hasMore: boolean }
  ) => void;
  appendPage: (
    layerId: number,
    payload: { rows: Record<string, unknown>[]; page: number; hasMore: boolean }
  ) => void;
  clearSelection: (layerId: number) => void;
  setActiveLayer: (layerId: number) => void;
  setLoading: (layerId: number, loading: boolean) => void;
  setError: (layerId: number, error: string | null) => void;
  reset: () => void;
};

const PLACEHOLDER: InfoSelectionEntry = {
  rows: [],
  columns: [],
  page: 0,
  hasMore: false,
  loading: false,
  error: null,
};

export const useInfoSelectionStore = create<InfoSelectionState>((set) => ({
  state: {},
  activeLayerId: null,

  // REPLACE semantics — fresh-click path. Caller passes page explicitly; store does NOT auto-increment.
  // Does NOT auto-clear loading per CONTEXT.md § Action contract — preserves prev?.loading so the
  // caller's setLoading(true) -> setSelection(...) -> setLoading(false) sequence works as locked.
  // DOES clear error to null (settled rows obsolete the prior error — not locked, judgment call).
  setSelection: (layerId, { rows, columns, page, hasMore }) =>
    set((s) => {
      const prev = s.state[layerId];
      const nextEntry: InfoSelectionEntry = {
        rows,
        columns,
        page,
        hasMore,
        loading: prev?.loading ?? false,
        error: null,
      };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // APPEND semantics — Load-more path. No-op if entry absent (caller bug; store does not invent rows).
  // columns, loading, error UNCHANGED. page + hasMore taken from payload.
  appendPage: (layerId, { rows, page, hasMore }) =>
    set((s) => {
      const prev = s.state[layerId];
      if (!prev) return s; // no-op — appendPage requires a prior setSelection
      const nextEntry: InfoSelectionEntry = {
        ...prev,
        rows: [...prev.rows, ...rows],
        page,
        hasMore,
      };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // DELETE-KEY semantics (mirrors useFilterViewStore.clearView at filterViewStore.ts:75-81).
  clearSelection: (layerId) =>
    set((s) => {
      if (!(layerId in s.state)) return s; // no-op
      const next = { ...s.state };
      delete next[layerId];
      return { state: next };
    }),

  // Pure focus-switch. Same-layer is a full no-op (mirrors filterStore exact-duplicate dedupe at
  // filterStore.ts:53-58). Different-layer fully deletes the prior layer's entry (rows, columns,
  // page, hasMore, loading, error all gone) AND sets activeLayerId — single set() call, atomic.
  // The new layer's entry is NOT touched (caller is responsible for setSelection if needed).
  setActiveLayer: (layerId) =>
    set((s) => {
      if (s.activeLayerId === layerId) return s; // no-op — same layer
      const nextStateMap = { ...s.state };
      if (s.activeLayerId !== null && s.activeLayerId in nextStateMap) {
        delete nextStateMap[s.activeLayerId];
      }
      return { state: nextStateMap, activeLayerId: layerId };
    }),

  // Per-layer flag flip. Caller toggles before/after fetch (both fresh-click and Load-more paths).
  // Creates placeholder when layerId absent (mirrors useFilterViewStore.markMaterializing at
  // filterViewStore.ts:89-96).
  setLoading: (layerId, loading) =>
    set((s) => {
      const prev = s.state[layerId];
      const nextEntry: InfoSelectionEntry = prev
        ? { ...prev, loading }
        : { ...PLACEHOLDER, loading };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // Per-layer error flip. Append-fail path: prior rows are preserved (existing pages remain visible,
  // user can retry). Mirrors filterViewStore.clearMaterializing preserves-prior-fields pattern.
  setError: (layerId, error) =>
    set((s) => {
      const prev = s.state[layerId];
      const nextEntry: InfoSelectionEntry = prev
        ? { ...prev, error }
        : { ...PLACEHOLDER, error };
      return { state: { ...s.state, [layerId]: nextEntry } };
    }),

  // Internal-only — Plan 20-02 wires reset() into App.tsx UNAUTHORIZED handler and DashboardsPage
  // DashboardOpen cleanup alongside the existing useFilterStore/useFilterViewStore reset() calls.
  reset: () => set({ state: {}, activeLayerId: null }),
}));
```

Constraints:
- Use `import { create } from "zustand"` exactly (matches filterViewStore.ts:28).
- File MUST live at `kinetica_bi/src/store/infoSelectionStore.ts` (CONTEXT.md § "Type definitions" lock).
- Export NAMES: `useInfoSelectionStore`, `InfoSelectionEntry`, `InfoSelectionState` (match filterViewStore.ts naming convention).
- Do NOT add any default consumer wiring — store ships dormant for popup/card. Plan 20-02 handles reset wiring.
- Do NOT introduce `useMemo` or selectors at this layer — store updates are cheap; selector scope is consumer's concern.
- TypeScript strict: `tsc --noEmit` MUST pass with zero errors after this file lands.
- setSelection action body MUST contain the exact substring `loading: prev?.loading ?? false` so the locked CONTEXT.md § Action contract behavior is grep-verifiable. This is the codified anti-regression for the v0 plan that incorrectly hard-coded `loading: false`.
  </action>
  <verify>
    <automated>cd /Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi && npx tsc --noEmit 2>&1 | grep -E "infoSelectionStore" | (read line && echo "FAIL: $line" || echo "PASS: no infoSelectionStore tsc errors")</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f kinetica_bi/src/store/infoSelectionStore.ts` returns 0
    - File contains: `grep -c "export const useInfoSelectionStore = create<InfoSelectionState>" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - File contains: `grep -c "export type InfoSelectionEntry" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - File contains: `grep -c "export type InfoSelectionState" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - All 7 actions present: `grep -cE "(setSelection|appendPage|clearSelection|setActiveLayer|setLoading|setError|reset):" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 7
    - Initial state correct: `grep -c "activeLayerId: null," kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1 AND `grep -c "state: {}," kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - Reference-stable update pattern present: `grep -c "state: { ...s.state, \[layerId\]: nextEntry }" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 4 (used in setSelection, appendPage non-noop branch, setLoading, setError)
    - Delete-key pattern present: `grep -c "delete next\[layerId\];" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - setActiveLayer same-layer no-op: `grep -cE "s\.activeLayerId === layerId" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - reset uses two-key wipe: `grep -c "set({ state: {}, activeLayerId: null })" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - **setSelection preserves prior loading flag (CONTEXT.md § Action contract lock):** `grep -c "loading: prev?.loading ?? false" kinetica_bi/src/store/infoSelectionStore.ts` returns >= 1
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (no TypeScript errors anywhere in the project)
  </acceptance_criteria>
  <done>The store file exists with exact shape (state Record + activeLayerId), exports the 3 named symbols, implements all 7 actions with the locked semantics (REPLACE preserving prior loading + clearing error / APPEND / DELETE-KEY / focus-switch with prior-delete / placeholder-on-missing / preserve-on-error / two-key reset), and tsc --noEmit passes clean. Store is dormant — no consumer files import it yet.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Comprehensive vitest spec for useInfoSelectionStore</name>
  <files>kinetica_bi/src/store/infoSelectionStore.spec.ts</files>
  <read_first>
    - kinetica_bi/src/store/infoSelectionStore.ts (the store under test — read AFTER Task 1 lands)
    - kinetica_bi/src/store/filterViewStore.spec.ts (THE template for spec structure — describe blocks, canary pattern, reference-stability assertions)
    - kinetica_bi/src/store/filterStore.spec.ts (additional reference for no-op assertions)
    - kinetica_bi/__mocks__/zustand.ts (confirm shim auto-resets between tests)
    - kinetica_bi/src/test/setup.ts (confirm vi.mock("zustand") is active)
    - .planning/phases/20-info-selection-store/20-CONTEXT.md § "Spec coverage (Claude's discretion)" — required test surface
  </read_first>
  <behavior>
    Spec MUST cover:
    1. **Reset shim canary** (PITFALL S-03): two back-to-back `it()` blocks both asserting `state === {}` and `activeLayerId === null` — proves Zustand reset shim auto-covers `src/store/*.ts`.
    2. **setSelection**:
       - Creates fresh entry on first call with payload exactly populated (rows, columns, page, hasMore). When no prior entry exists, loading defaults to false; error is null.
       - REPLACE on second call wipes prior rows/columns/page/hasMore (no append).
       - **Preserves prior loading flag (CONTEXT.md § Action contract lock):** `setLoading(1, true)` -> assert `state[1].loading === true` -> `setSelection(1, payload)` -> assert `state[1].loading === true` (still true, NOT cleared). Test name MUST contain "preserves prior loading" so the regression check is grep-able.
       - **Clears prior error to null (judgment call — settled rows obsolete error):** `setError(1, "boom")` -> `setSelection(1, payload)` -> assert `state[1].error === null`.
       - Reference identity: `state[layerId=2]` entry preserved across `state[layerId=1]` mutation.
    3. **appendPage**:
       - No-op when `state[layerId]` absent — state unchanged byte-for-byte (object identity preserved).
       - Appends rows onto existing entry, sets page + hasMore from payload, leaves columns unchanged.
       - Multiple appends accumulate (page 1 → 2 → 3 rows compound).
    4. **clearSelection**:
       - No-op when key absent — returns state with object identity preserved.
       - Removes the per-layerId entry when present.
    5. **setActiveLayer**:
       - Same-layer call is a full no-op (state object identity preserved, no mutation).
       - Different-layer call deletes prior layer's entry FULLY (rows, columns, page, hasMore, loading, error all gone — assert `state[priorLayerId] === undefined`).
       - **STORE-V14-05 explicit invariant test (success criterion #4):** Set `state[A].page = 5` via setSelection, then `setActiveLayer(B)` (A !== B), then assert `state[A]` is undefined (the page counter is "reset to 0" by virtue of the entry no longer existing). Comment cites STORE-V14-05.
       - Initial setActiveLayer when activeLayerId is null: no prior delete, just sets activeLayerId.
       - Reference identity: state[layerId=B] entry NOT touched by setActiveLayer.
    6. **setLoading**:
       - Creates placeholder entry when layerId absent: `{ rows: [], columns: [], page: 0, hasMore: false, loading: <arg>, error: null }`.
       - Updates existing entry without losing rows/columns/page/hasMore/error.
    7. **setError**:
       - Creates placeholder entry when layerId absent.
       - **Append-fail invariant (locked in CONTEXT.md § specifics):** Set rows via setSelection, call setError("oops"), assert rows are STILL present (existing pages preserved).
       - Setting error to null clears it.
    8. **reset**:
       - From populated state (`state` with entries, `activeLayerId` non-null) → `state === {}` AND `activeLayerId === null`.
       - From empty state → still `state === {}` AND `activeLayerId === null` (idempotent).
  </behavior>
  <action>
Create `kinetica_bi/src/store/infoSelectionStore.spec.ts` matching the structure and style of `kinetica_bi/src/store/filterViewStore.spec.ts`. Cover every behavior in the `<behavior>` block above with explicit `describe` + `it` blocks. Use `useInfoSelectionStore.getState()` to invoke actions and read state — same pattern as filterViewStore.spec.ts:5-12.

CONCRETE STRUCTURE — write the spec with these exact `describe` blocks (test names within may be Claude's discretion per CONTEXT.md, EXCEPT the two named regression tests below which MUST appear verbatim):

```typescript
import { describe, it, expect } from "vitest";
import { useInfoSelectionStore } from "./infoSelectionStore";

describe("useInfoSelectionStore — canary (PITFALL S-03 — Zustand shim must cover src/store/*.ts)", () => {
  it("store is empty at start of each test", () => {
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });

  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });
});

describe("useInfoSelectionStore — setSelection", () => {
  // creates fresh entry; replaces on second call; preserves other layers' identity

  // CONTEXT.md § Action contract lock — required regression for the v0 plan that hard-coded loading: false.
  // Test name MUST contain "preserves prior loading" (grep-verifiable acceptance criterion).
  it("setSelection preserves prior loading flag (CONTEXT.md § Action contract)", () => {
    useInfoSelectionStore.getState().setLoading(1, true);
    expect(useInfoSelectionStore.getState().state[1].loading).toBe(true);
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    // Loading flag is STILL true after setSelection — caller is responsible for setLoading(false).
    expect(useInfoSelectionStore.getState().state[1].loading).toBe(true);
  });

  // Paired test: setSelection DOES clear error (judgment call — settled rows obsolete prior error).
  it("setSelection clears prior error to null (settled rows obsolete the prior error)", () => {
    useInfoSelectionStore.getState().setError(1, "boom");
    expect(useInfoSelectionStore.getState().state[1].error).toBe("boom");
    useInfoSelectionStore.getState().setSelection(1, {
      rows: [{ id: 1 }],
      columns: ["id"],
      page: 0,
      hasMore: false,
    });
    expect(useInfoSelectionStore.getState().state[1].error).toBeNull();
  });
});

describe("useInfoSelectionStore — appendPage", () => {
  // no-op when absent; appends rows; preserves columns; accumulates across multiple calls
});

describe("useInfoSelectionStore — clearSelection", () => {
  // no-op when absent; removes entry when present
});

describe("useInfoSelectionStore — setActiveLayer (STORE-V14-05 layer-switch page reset)", () => {
  // same-layer no-op; different-layer deletes prior entry; STORE-V14-05 explicit page-reset assertion
  it("STORE-V14-05: setActiveLayer(B) when current is A wipes A's entry — page counter reset to 0 (entry gone)", () => {
    // Phase 20 success criterion #4 — set page > 0 on layer A, switch to B, assert state[A] gone.
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }], columns: ["id"], page: 5, hasMore: true });
    useInfoSelectionStore.getState().setActiveLayer(1);
    expect(useInfoSelectionStore.getState().state[1].page).toBe(5);
    useInfoSelectionStore.getState().setActiveLayer(2);
    expect(useInfoSelectionStore.getState().state[1]).toBeUndefined();
    expect(useInfoSelectionStore.getState().activeLayerId).toBe(2);
  });
});

describe("useInfoSelectionStore — setLoading", () => {
  // creates placeholder when absent; updates existing without losing other fields
});

describe("useInfoSelectionStore — setError", () => {
  // creates placeholder when absent
  // append-fail invariant — rows preserved when setError fires
  it("preserves prior rows when setError fires (append-fail UX lock)", () => {
    useInfoSelectionStore.getState().setSelection(1, { rows: [{ id: 1 }, { id: 2 }], columns: ["id"], page: 1, hasMore: true });
    useInfoSelectionStore.getState().setError(1, "Network error on page 2");
    const entry = useInfoSelectionStore.getState().state[1];
    expect(entry.rows).toEqual([{ id: 1 }, { id: 2 }]); // prior rows preserved
    expect(entry.error).toBe("Network error on page 2");
  });
});

describe("useInfoSelectionStore — reset", () => {
  // from populated state; from empty state (idempotent)
});
```

Constraints:
- Use `useInfoSelectionStore.getState().<action>(...)` to invoke (matches filterViewStore.spec.ts:6).
- Do NOT add a `beforeEach` reset — the Zustand shim handles it (CONTEXT.md § "Spec coverage" lock).
- Do NOT mock anything — pure store-level testing only.
- Total spec MUST be at least 20 `it()` blocks (canary x2 + setSelection x5 [includes 2 mandatory locked tests above + 3 baseline] + appendPage x3 + clearSelection x2 + setActiveLayer x4 + setLoading x2 + setError x3 + reset x2 = 23 minimum). Aim for ~22-26 it blocks.
- Test names may be Claude's discretion (CONTEXT.md § "Claude's Discretion" lock) EXCEPT the four named regression tests which MUST appear verbatim:
  - "setSelection preserves prior loading flag (CONTEXT.md § Action contract)"
  - "setSelection clears prior error to null (settled rows obsolete the prior error)"
  - "STORE-V14-05: setActiveLayer(B) when current is A wipes A's entry — page counter reset to 0 (entry gone)"
  - "preserves prior rows when setError fires (append-fail UX lock)"
- The STORE-V14-05 test, the append-fail rows-preserved test, and the two CONTEXT.md § Action contract tests MUST be present verbatim (those exact assertions are required by phase success criterion #4 + CONTEXT.md § "Action contract" + CONTEXT.md § "specifics" append-fail lock).
  </action>
  <verify>
    <automated>cd /Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi && npx vitest run src/store/infoSelectionStore.spec.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `test -f kinetica_bi/src/store/infoSelectionStore.spec.ts` returns 0
    - At least 20 it blocks: `grep -c "^  it(" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 20
    - All 8 describe blocks present (canary + 7 actions): `grep -c "^describe(" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 8
    - Canary pattern present: `grep -c "PITFALL S-03" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 1
    - STORE-V14-05 explicit assertion present: `grep -c "STORE-V14-05" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 1
    - STORE-V14-05 page-reset test present: `grep -cE "setActiveLayer\(2\)" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 1
    - Append-fail rows-preserved test present: `grep -c "append-fail" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 1
    - **CONTEXT.md § Action contract regression — setSelection preserves prior loading (BLOCKER fix from checker review):** `grep -c "preserves prior loading" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 1
    - **Paired test — setSelection clears error to null:** `grep -cE "clears prior error to null" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 1
    - Spec uses canonical action invocation: `grep -c "useInfoSelectionStore.getState()" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns >= 20
    - No beforeEach reset boilerplate (shim handles it): `grep -cE "beforeEach\(" kinetica_bi/src/store/infoSelectionStore.spec.ts` returns 0
    - Tests pass: `cd kinetica_bi && npx vitest run src/store/infoSelectionStore.spec.ts` exits 0
    - Test output shows `Test Files  1 passed` and `Tests  >=20 passed`
  </acceptance_criteria>
  <done>Spec file exists with at least 20 it blocks across 8 describe blocks (canary + 7 actions), `vitest run` passes 100%, STORE-V14-05 page-reset invariant has its own dedicated test (success criterion #4), append-fail rows-preserved invariant has its own dedicated test (CONTEXT.md § specifics lock), the setSelection-preserves-prior-loading invariant has its own dedicated test (CONTEXT.md § Action contract lock — addresses checker BLOCKER 1), the setSelection-clears-error invariant has its own paired test, Zustand reset shim auto-coverage proven by canary.</done>
</task>

</tasks>

<verification>
**Plan 20-01 verification (run all from kinetica_bi/):**

```bash
# 1. Both files exist
test -f kinetica_bi/src/store/infoSelectionStore.ts
test -f kinetica_bi/src/store/infoSelectionStore.spec.ts

# 2. TypeScript clean
cd kinetica_bi && npx tsc --noEmit

# 3. Spec passes
cd kinetica_bi && npx vitest run src/store/infoSelectionStore.spec.ts

# 4. Full test suite still green (no regression in other store specs)
cd kinetica_bi && npx vitest run src/store/

# 5. Store NOT yet imported by any consumer (dormant)
grep -rn "useInfoSelectionStore" kinetica_bi/src/ --include="*.ts" --include="*.tsx" | grep -v "infoSelectionStore.ts" | grep -v "infoSelectionStore.spec.ts"
# Expected: zero matches (Plan 20-02 adds the App.tsx + DashboardsPage.tsx imports)

# 6. CONTEXT.md § Action contract lock — setSelection preserves prior loading flag
grep -c "loading: prev?.loading ?? false" kinetica_bi/src/store/infoSelectionStore.ts
# Expected: >= 1

# 7. Spec covers the loading-preservation regression
grep -c "preserves prior loading" kinetica_bi/src/store/infoSelectionStore.spec.ts
# Expected: >= 1
```
</verification>

<success_criteria>
- Store file `kinetica_bi/src/store/infoSelectionStore.ts` exists with all 7 actions and the locked shape
- Spec file `kinetica_bi/src/store/infoSelectionStore.spec.ts` exists with >=20 passing it blocks
- `tsc --noEmit` passes clean across the entire frontend
- Phase 20 success criterion #1 (store exists, 7 actions, vitest reset shim auto-coverage proven) — COMPLETE
- Phase 20 success criterion #4 (setActiveLayer page-reset invariant) — COMPLETE via dedicated spec test
- CONTEXT.md § Action contract lock — setSelection does NOT auto-clear loading — COMPLETE via dedicated spec test ("preserves prior loading") and grep-verifiable production code (`loading: prev?.loading ?? false`)
- STORE-V14-01, STORE-V14-02, STORE-V14-04 (store-side portion), STORE-V14-05 — Plan 20-01 complete
- No consumer wiring yet — store is dormant; Plan 20-02 wires reset() calls into App.tsx + DashboardsPage.tsx
</success_criteria>

<output>
After completion, create `.planning/phases/20-info-selection-store/20-01-store-and-spec-SUMMARY.md` summarizing: (a) file paths created, (b) test pass count, (c) any deviations from CONTEXT.md decisions (expected: zero), (d) confirmation that store is dormant (zero consumer imports outside spec), (e) confirmation that the CONTEXT.md § Action contract setSelection-preserves-loading lock is honored both in production code (grep `loading: prev?.loading ?? false`) and spec (grep "preserves prior loading").
</output>
</content>
</invoke>