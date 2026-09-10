---
phase: 27-spatial-filter-store
plan: 02
type: execute
wave: 2
depends_on:
  - 27-01
files_modified:
  - kinetica_bi/src/App.tsx
  - kinetica_bi/src/App.spec.tsx
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
autonomous: true
requirements:
  - STORE-V15-04

must_haves:
  truths:
    - "App.tsx UNAUTHORIZED handler resets all 5 stores in canonical order (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore)"
    - "DashboardsPage.tsx DashboardOpen cleanup resets all 5 stores in canonical order"
    - "Spec for App.tsx asserts spatialFilterStore.shapes empties after logout"
    - "Spec for DashboardsPage.tsx asserts spatialFilterStore.shapes empties after dashboard-switch cleanup"
    - "spatialFilterStore.reset() is called WITHOUT being preceded by a fire-and-forget DROP loop (session-only, no server-side resource)"
    - "Full frontend test suite is green (no regressions in App.spec.tsx, DashboardsPage.spec.tsx, or other specs)"
  artifacts:
    - path: "kinetica_bi/src/App.tsx"
      provides: "5-store reset block (5th call: useSpatialFilterStore.getState().reset())"
      contains: "useSpatialFilterStore"
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "5-store cleanup block (5th call: useSpatialFilterStore.getState().reset())"
      contains: "useSpatialFilterStore"
    - path: "kinetica_bi/src/App.spec.tsx"
      provides: "5-store reset assertion (extends the 'ALL FOUR stores' test to ALL FIVE)"
      contains: "ALL FIVE stores"
    - path: "kinetica_bi/src/components/DashboardsPage.spec.tsx"
      provides: "5-store reset assertion in DashboardOpen cleanup"
      contains: "ALL FIVE stores"
  key_links:
    - from: "kinetica_bi/src/App.tsx"
      to: "kinetica_bi/src/store/spatialFilterStore.ts"
      via: "useSpatialFilterStore.getState().reset() in UNAUTHORIZED useEffect"
      pattern: "useSpatialFilterStore.getState\\(\\).reset\\(\\)"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx"
      to: "kinetica_bi/src/store/spatialFilterStore.ts"
      via: "useSpatialFilterStore.getState().reset() in DashboardOpen useEffect cleanup"
      pattern: "useSpatialFilterStore.getState\\(\\).reset\\(\\)"
---

<objective>
Wire `useSpatialFilterStore.reset()` as the 5th call in the lifecycle reset block at both `App.tsx` UNAUTHORIZED handler and `DashboardsPage.tsx` DashboardOpen cleanup. Extend the corresponding specs to assert all 5 stores reset in canonical order. Closes STORE-V15-04.

Purpose: A user logging out or switching dashboards must clear all session-scoped client state — including spatial shapes — so dashboard-A shapes never leak into dashboard-B and a re-login session starts clean. Mirrors the established v1.4 Phase 23 4-store extension pattern.

Output:
- `kinetica_bi/src/App.tsx` — 1-line addition + 1 import
- `kinetica_bi/src/App.spec.tsx` — extended 'ALL FOUR' test to 'ALL FIVE'
- `kinetica_bi/src/components/DashboardsPage.tsx` — 1-line addition + 1 import
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` — extended 'ALL FOUR' test to 'ALL FIVE'
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
@.planning/phases/27-spatial-filter-store/27-01-SUMMARY.md

# Production reset blocks executor MUST extend
@kinetica_bi/src/App.tsx
@kinetica_bi/src/components/DashboardsPage.tsx

# Spec patterns executor MUST extend
@kinetica_bi/src/App.spec.tsx
@kinetica_bi/src/components/DashboardsPage.spec.tsx

# Store being wired in
@kinetica_bi/src/store/spatialFilterStore.ts

<interfaces>
<!-- Current 4-store reset block — App.tsx lines 44-66 (this plan extends to 5 stores) -->

From kinetica_bi/src/App.tsx (current code — lines 44-66):
```typescript
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
    useInfoSelectionStore.getState().reset();       // 3rd (Phase 20 STORE-V14-04)
    useLastInfoClickContextStore.getState().reset(); // 4th (Plan 23-02 CARD-V14-02)
    // INSERT 5th here: useSpatialFilterStore.getState().reset(); — Phase 27 STORE-V15-04
  }
}, [status]);
```

From kinetica_bi/src/components/DashboardsPage.tsx (current code — lines 388-408):
```typescript
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
    // INSERT 5th here: useSpatialFilterStore.getState().reset(); — Phase 27 STORE-V15-04
  };
}, [dashboard.id]);
```

From kinetica_bi/src/store/spatialFilterStore.ts (Plan 27-01):
```typescript
export const useSpatialFilterStore = create<State>(...);
// reset(): sets shapes=[], spatialFilterVersion=0, shapeCounter=0
```

From kinetica_bi/src/App.spec.tsx (current 'ALL FOUR' test at line 232):
```typescript
it("resets ALL FOUR stores after the DROP loop fires (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore — STORE-V14-04 + Plan 23-02 extension)", async () => {
  // seeds all 4, triggers logout, asserts all 4 are empty
});
```

From kinetica_bi/src/components/DashboardsPage.spec.tsx (current 'ALL FOUR' test at line 56):
```typescript
it("resets ALL FOUR stores when cleanup runs (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore — STORE-V14-03 + Plan 23-02 extension)", async () => {
  // seeds all 4, invokes cleanup directly, asserts all 4 are empty
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wire 5th-store reset into App.tsx UNAUTHORIZED handler + update App.spec.tsx</name>
  <files>kinetica_bi/src/App.tsx, kinetica_bi/src/App.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/App.tsx (lines 1-66 for current imports + 4-store reset block at lines 44-66)
    - kinetica_bi/src/App.spec.tsx (lines 1-30 for imports, lines 232-285 for current 'ALL FOUR' test + 'Pitfall 1' regression test)
    - kinetica_bi/src/store/spatialFilterStore.ts (verify the addShape signature and reset behavior from Plan 27-01)
    - .planning/phases/27-spatial-filter-store/27-CONTEXT.md (canonical reset order; "5th store, no DROP loop" lock)
  </read_first>
  <action>
    **Part A: Edit `kinetica_bi/src/App.tsx`**

    1. Add an import alongside the existing store imports. Current imports (around line 12) include:
       ```typescript
       import { useLastInfoClickContextStore } from "./store/lastInfoClickContextStore";
       ```
       Add immediately after:
       ```typescript
       import { useSpatialFilterStore } from "./store/spatialFilterStore";
       ```

    2. Inside the `useEffect(() => { if (status === "unauthenticated") { ... } }, [status])` block, locate line 64:
       ```typescript
             useLastInfoClickContextStore.getState().reset();
       ```
       Insert IMMEDIATELY AFTER this line (BEFORE the closing `}` of the `if` block):
       ```typescript
             // Phase 27 STORE-V15-04: fifth reset — spatial filter store.
             // Session-only shapes; NO server-side DROP loop needed (mirrors infoSelectionStore +
             // lastInfoClickContextStore pattern, NOT filterViewStore's view-DROP snapshot loop).
             useSpatialFilterStore.getState().reset();
       ```

    Canonical order MUST remain: filterViewStore (1st) → filterStore (2nd) → infoSelectionStore (3rd) → lastInfoClickContextStore (4th) → spatialFilterStore (5th).

    Do NOT add a fire-and-forget DROP loop for shapes — there is no server-side resource to free (shapes are session-only client state).

    **Part B: Edit `kinetica_bi/src/App.spec.tsx`**

    1. Add import alongside existing store imports. Current imports include:
       ```typescript
       import { useLastInfoClickContextStore } from "./store/lastInfoClickContextStore";
       ```
       Add immediately after:
       ```typescript
       import { useSpatialFilterStore } from "./store/spatialFilterStore";
       ```

    2. Locate the test starting at line 232:
       ```typescript
       it("resets ALL FOUR stores after the DROP loop fires (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore — STORE-V14-04 + Plan 23-02 extension)", async () => {
       ```

       Rename the test string (replace `ALL FOUR stores` with `ALL FIVE stores`, append `+ Plan 27-02 STORE-V15-04 extension` to the suffix):
       ```typescript
       it("resets ALL FIVE stores after the DROP loop fires (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore + spatialFilterStore — STORE-V14-04 + Plan 23-02 extension + Plan 27-02 STORE-V15-04 extension)", async () => {
       ```

    3. Inside that test body, locate the seeding block that ends with the `useLastInfoClickContextStore.getState().setContext(...)` call. Immediately AFTER that setContext call (before `render(<App />)`), add:
       ```typescript
           // Plan 27-02 (STORE-V15-04): seed spatial filter store
           useSpatialFilterStore.getState().addShape({
             type: "bbox",
             wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
             measurement: "5km × 3km",
           });
       ```

    4. After the existing assertion block (after the line `expect(useLastInfoClickContextStore.getState().context).toBeNull();` near line 263), append:
       ```typescript
           // Plan 27-02 (STORE-V15-04): spatial filter store also resets
           expect(useSpatialFilterStore.getState().shapes).toEqual([]);
           expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
           expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
       ```

    Do NOT modify the existing 'Pitfall 1: stale lastInfoClickContext...' test (lines 266-285) — it is a separate regression assertion unrelated to spatialFilterStore.

    Do NOT touch the `fires dropFilterView for each active view with entry.dashboardId on logout` test (line 212) — it asserts DROP loop, which spatial store does NOT participate in.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/App.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - App.tsx imports the new store: `grep "import { useSpatialFilterStore } from \"./store/spatialFilterStore\";" kinetica_bi/src/App.tsx` matches.
    - App.tsx contains the 5th reset call in the UNAUTHORIZED block: `grep "useSpatialFilterStore.getState().reset();" kinetica_bi/src/App.tsx` matches.
    - 5th reset call appears AFTER the 4th: `awk '/useLastInfoClickContextStore.getState\(\).reset\(\)/{found4=NR} /useSpatialFilterStore.getState\(\).reset\(\)/{if(NR>found4 && found4>0) exit 0; exit 1}' kinetica_bi/src/App.tsx` exits 0.
    - App.tsx does NOT add a DROP loop for spatial shapes: `grep -c "dropSpatialShape\|dropShape\|spatial.*DROP" kinetica_bi/src/App.tsx` returns 0.
    - App.spec.tsx imports the new store: `grep "useSpatialFilterStore" kinetica_bi/src/App.spec.tsx` matches at least 4 times (import + seed + 3 assertions).
    - App.spec.tsx contains the renamed test: `grep "ALL FIVE stores" kinetica_bi/src/App.spec.tsx` matches.
    - App.spec.tsx asserts spatial store empties: `grep 'useSpatialFilterStore.getState().shapes).toEqual(\[\])' kinetica_bi/src/App.spec.tsx` matches.
    - App.spec.tsx asserts spatialFilterVersion is 0 after reset: `grep "useSpatialFilterStore.getState().spatialFilterVersion).toBe(0)" kinetica_bi/src/App.spec.tsx` matches.
    - `tsc --noEmit` exits 0.
    - `npx vitest run src/App.spec.tsx` exits 0; the 'ALL FIVE stores' test passes.
  </acceptance_criteria>
  <done>
    App.tsx UNAUTHORIZED handler resets all 5 stores in canonical order. Spec asserts the 5-store reset and the spatial shape from seeded addShape is emptied.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire 5th-store reset into DashboardsPage.tsx DashboardOpen cleanup + update DashboardsPage.spec.tsx</name>
  <files>kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/components/DashboardsPage.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.tsx (lines 22-30 for imports, lines 385-410 for current 4-store cleanup block)
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (lines 1-15 for imports, lines 56-92 for current 'ALL FOUR' test)
    - kinetica_bi/src/store/spatialFilterStore.ts (verify addShape signature)
    - .planning/phases/27-spatial-filter-store/27-CONTEXT.md (canonical reset order; "5th store, no DROP loop" lock)
  </read_first>
  <action>
    **Part A: Edit `kinetica_bi/src/components/DashboardsPage.tsx`**

    1. Add an import alongside the existing store imports (around line 26). Current imports include:
       ```typescript
       import { useLastInfoClickContextStore } from "../store/lastInfoClickContextStore";
       ```
       Add immediately after:
       ```typescript
       import { useSpatialFilterStore } from "../store/spatialFilterStore";
       ```

       Note: This file is at `kinetica_bi/src/components/DashboardsPage.tsx` so the relative path is `../store/spatialFilterStore` (NOT `./store/...`).

    2. Inside the `useEffect(() => { return () => { ... } }, [dashboard.id])` cleanup block (lines 388-408), locate line 406:
       ```typescript
             useLastInfoClickContextStore.getState().reset();
       ```
       Insert IMMEDIATELY AFTER this line (BEFORE the closing `};` of the cleanup function):
       ```typescript
             // Phase 27 STORE-V15-04: fifth reset — spatial filter store.
             // Session-only shapes; NO server-side DROP loop needed (mirrors infoSelectionStore +
             // lastInfoClickContextStore pattern). Dashboard-A shapes MUST NOT leak into dashboard-B.
             useSpatialFilterStore.getState().reset();
       ```

    Canonical order MUST remain: filterViewStore (1st) → filterStore (2nd) → infoSelectionStore (3rd) → lastInfoClickContextStore (4th) → spatialFilterStore (5th).

    Do NOT add a fire-and-forget DROP loop for shapes — session-only client state.

    **Part B: Edit `kinetica_bi/src/components/DashboardsPage.spec.tsx`**

    1. Add import alongside existing store imports (around line 6). Current imports include:
       ```typescript
       import { useLastInfoClickContextStore } from "../store/lastInfoClickContextStore";
       ```
       Add immediately after:
       ```typescript
       import { useSpatialFilterStore } from "../store/spatialFilterStore";
       ```

    2. Locate the test at line 56:
       ```typescript
       it("resets ALL FOUR stores when cleanup runs (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore — STORE-V14-03 + Plan 23-02 extension)", async () => {
       ```

       Rename:
       ```typescript
       it("resets ALL FIVE stores when cleanup runs (filterStore + filterViewStore + infoSelectionStore + lastInfoClickContextStore + spatialFilterStore — STORE-V14-03 + Plan 23-02 extension + Plan 27-02 STORE-V15-04 extension)", async () => {
       ```

    3. Inside that test body, locate the existing seeding block. After the `useLastInfoClickContextStore.getState().setContext(...)` call (around line 65-70), add:
       ```typescript
           // Plan 27-02 (STORE-V15-04): seed spatial filter store
           useSpatialFilterStore.getState().addShape({
             type: "bbox",
             wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
             measurement: "5km × 3km",
           });
       ```

    4. In the direct-invocation cleanup block (around lines 79-82) that calls `useLastInfoClickContextStore.getState().reset()`, add immediately after:
       ```typescript
           useSpatialFilterStore.getState().reset();
       ```

    5. After the final assertion `expect(useLastInfoClickContextStore.getState().context).toBeNull();` (around line 91), append:
       ```typescript
           // Plan 27-02 (STORE-V15-04): spatial filter store also resets
           expect(useSpatialFilterStore.getState().shapes).toEqual([]);
           expect(useSpatialFilterStore.getState().spatialFilterVersion).toBe(0);
           expect(useSpatialFilterStore.getState().shapeCounter).toBe(0);
       ```

    Do NOT modify the smoke test (`smoke test — DashboardsPage mounts without error`) at the bottom of the file — it does not need spatial-store seeding.

    Do NOT modify the 'swallows dropFilterView errors silently' or 'handles empty views map cleanly' tests — they test DROP loop semantics, which spatial store does not participate in.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/components/DashboardsPage.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - DashboardsPage.tsx imports the new store with the relative path `../store/spatialFilterStore`: `grep "import { useSpatialFilterStore } from \"../store/spatialFilterStore\";" kinetica_bi/src/components/DashboardsPage.tsx` matches.
    - DashboardsPage.tsx contains the 5th reset call: `grep "useSpatialFilterStore.getState().reset();" kinetica_bi/src/components/DashboardsPage.tsx` matches.
    - 5th reset call appears AFTER the 4th: `awk '/useLastInfoClickContextStore.getState\(\).reset\(\)/{found4=NR} /useSpatialFilterStore.getState\(\).reset\(\)/{if(NR>found4 && found4>0) exit 0; exit 1}' kinetica_bi/src/components/DashboardsPage.tsx` exits 0.
    - DashboardsPage.tsx does NOT add a DROP loop for spatial shapes: `grep -c "dropSpatialShape\|dropShape" kinetica_bi/src/components/DashboardsPage.tsx` returns 0.
    - DashboardsPage.spec.tsx imports the new store: `grep "useSpatialFilterStore" kinetica_bi/src/components/DashboardsPage.spec.tsx` matches at least 4 times (import + seed + reset + 3 assertions).
    - DashboardsPage.spec.tsx contains 'ALL FIVE stores': `grep "ALL FIVE stores" kinetica_bi/src/components/DashboardsPage.spec.tsx` matches.
    - DashboardsPage.spec.tsx asserts spatial store empties: `grep 'useSpatialFilterStore.getState().shapes).toEqual(\[\])' kinetica_bi/src/components/DashboardsPage.spec.tsx` matches.
    - `tsc --noEmit` exits 0.
    - `npx vitest run src/components/DashboardsPage.spec.tsx` exits 0; the 'ALL FIVE stores' test passes.
  </acceptance_criteria>
  <done>
    DashboardsPage DashboardOpen cleanup resets all 5 stores in canonical order. Spec asserts the 5-store reset and the spatial shape from seeded addShape is emptied.
  </done>
</task>

<task type="auto">
  <name>Task 3: Full frontend regression run (tsc + vitest) — confirm no other specs broke</name>
  <files>kinetica_bi (no file modifications — verification gate)</files>
  <read_first>
    - kinetica_bi/package.json (confirm `test` / `vitest` scripts available — should map to vitest)
  </read_first>
  <action>
    Run the full frontend regression suite from `kinetica_bi/`. This catches any unintended ripple in adjacent specs that may import `App` or `DashboardsPage`. NO file edits in this task — it is a verification gate.

    Commands to run (in order):

    1. `cd kinetica_bi && npx tsc --noEmit` — must exit 0
    2. `cd kinetica_bi && npx vitest run` — must exit 0

    If the full vitest run reports failures:
    - Test failures in specs OTHER than `spatialFilterStore.spec.ts`, `App.spec.tsx`, `DashboardsPage.spec.tsx`: investigate and fix — likely a missed seed/assert in a sibling spec that snapshots the lifecycle reset block contents.
    - Test failures in `spatialFilterStore.spec.ts` / `App.spec.tsx` / `DashboardsPage.spec.tsx`: re-read Tasks 1-2 — likely a misplaced insertion or a typo in the test name string.

    Baseline note: vitest count at v1.5 entry (Phase 26 close) is unspecified in STATE.md but exceeds 522 (Phase 24 close baseline). The new spatialFilterStore.spec.ts (Plan 27-01) adds at least 15 tests; this plan adds spatial-store assertions to 2 existing tests (no new test files in this plan). Expected vitest count after Plan 27-02 close: at least (prior baseline + 15). No tests should be removed by this plan.

    Do NOT run backend (server-side) tests — Phase 27 is a frontend-only phase. Backend known-red tests (TD-V11-04, TD-V13-01) are unrelated and out of scope.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (no TypeScript errors).
    - `cd kinetica_bi && npx vitest run` exits 0 (all tests green).
    - vitest output `Test Files` line shows zero `failed` (e.g. line contains `Test Files  N passed (N)` with no `failed` substring).
    - vitest output `Tests` line shows zero `failed` (e.g. line contains `Tests  N passed (N)` with no `failed` substring).
    - No test removed: count of passing tests is ≥ count from the previous baseline (Phase 26 close).
  </acceptance_criteria>
  <done>
    Full frontend suite is green. Phase 27 closes with STORE-V15-01..04 complete: store exists (Plan 27-01), spec covers behaviors (Plan 27-01), and lifecycle reset is wired with spec coverage at both sites (this plan).
  </done>
</task>

</tasks>

<verification>
After all three tasks complete:

```bash
cd kinetica_bi && npx tsc --noEmit
cd kinetica_bi && npx vitest run
```

Both MUST exit 0. The 'ALL FIVE stores' tests must appear in both `App.spec.tsx` and `DashboardsPage.spec.tsx` outputs and pass.

Phase boundary check:
```bash
# Confirm no other file imports useSpatialFilterStore beyond the wired call sites + spec
grep -rl "useSpatialFilterStore" kinetica_bi/src
# Expected exactly 5 files:
#   - kinetica_bi/src/store/spatialFilterStore.ts (source)
#   - kinetica_bi/src/store/spatialFilterStore.spec.ts (spec)
#   - kinetica_bi/src/App.tsx (reset wiring)
#   - kinetica_bi/src/App.spec.tsx (reset assertion)
#   - kinetica_bi/src/components/DashboardsPage.tsx (reset wiring)
#   - kinetica_bi/src/components/DashboardsPage.spec.tsx (reset assertion)
# NO OL consumer (Phase 29), NO FilterBar/AggregatedWidgetRenderer consumer (Phase 30) — store ships dormant.
```
</verification>

<success_criteria>
1. `kinetica_bi/src/App.tsx` UNAUTHORIZED handler resets 5 stores in canonical order: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore
2. `kinetica_bi/src/components/DashboardsPage.tsx` DashboardOpen cleanup resets 5 stores in canonical order
3. `kinetica_bi/src/App.spec.tsx` has an 'ALL FIVE stores' test that seeds spatialFilterStore via addShape and asserts shapes empty + spatialFilterVersion 0 + shapeCounter 0 after logout
4. `kinetica_bi/src/components/DashboardsPage.spec.tsx` has an 'ALL FIVE stores' test that seeds spatialFilterStore and asserts emptiness after DashboardOpen cleanup
5. Neither App.tsx nor DashboardsPage.tsx adds a fire-and-forget DROP loop for spatial shapes (session-only locked)
6. `tsc --noEmit` exits 0
7. `npx vitest run` (full suite) exits 0 with all tests passing
8. Store remains dormant in production code outside reset wiring — no OL consumer, no FilterBar consumer, no AggregatedWidgetRenderer consumer in this phase (verified by counting `useSpatialFilterStore` import sites — exactly 6 files: source + spec + 2 reset wiring sites + 2 reset spec sites)
</success_criteria>

<output>
After completion, create `.planning/phases/27-spatial-filter-store/27-02-SUMMARY.md` per the standard summary template.
</output>
