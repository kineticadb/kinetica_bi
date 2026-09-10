---
phase: 20-info-selection-store
plan: 2
type: execute
wave: 2
depends_on:
  - 20-01-store-and-spec-PLAN
files_modified:
  - kinetica_bi/src/App.tsx
  - kinetica_bi/src/App.spec.tsx
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
autonomous: true
requirements:
  - STORE-V14-03
must_haves:
  truths:
    - "App.tsx UNAUTHORIZED handler effect (currently lines 42-56) calls useInfoSelectionStore.getState().reset() alongside the existing useFilterViewStore.getState().reset() and useFilterStore.getState().reset() calls"
    - "DashboardsPage.tsx DashboardOpen cleanup effect (currently lines 386-399) calls useInfoSelectionStore.getState().reset() alongside the existing useFilterViewStore.getState().reset() and useFilterStore.getState().reset() calls"
    - "After logout (App.tsx UNAUTHORIZED), useInfoSelectionStore state map and activeLayerId are both reset — no records or activeLayerId from prior session survive"
    - "After dashboard switch (DashboardOpen unmount), useInfoSelectionStore state map and activeLayerId are both reset — no selection from prior dashboard bleeds into newly opened dashboard"
    - "App.spec.tsx and DashboardsPage.spec.tsx have new test cases asserting the third reset fires (alongside the existing two-store reset assertions)"
  artifacts:
    - path: "kinetica_bi/src/App.tsx"
      provides: "Three-store reset block in UNAUTHORIZED handler (filterViewStore + filterStore + infoSelectionStore)"
      contains: "useInfoSelectionStore.getState().reset()"
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "Three-store reset block in DashboardOpen cleanup"
      contains: "useInfoSelectionStore.getState().reset()"
    - path: "kinetica_bi/src/App.spec.tsx"
      provides: "Test asserting useInfoSelectionStore.reset() fires on logout"
      contains: "useInfoSelectionStore"
    - path: "kinetica_bi/src/components/DashboardsPage.spec.tsx"
      provides: "Test asserting useInfoSelectionStore.reset() fires on dashboard switch / cleanup"
      contains: "useInfoSelectionStore"
  key_links:
    - from: "kinetica_bi/src/App.tsx"
      to: "kinetica_bi/src/store/infoSelectionStore.ts"
      via: 'import { useInfoSelectionStore } from "./store/infoSelectionStore"'
      pattern: "import .* useInfoSelectionStore .* from .*infoSelectionStore"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx"
      to: "kinetica_bi/src/store/infoSelectionStore.ts"
      via: 'import { useInfoSelectionStore } from "../store/infoSelectionStore"'
      pattern: "import .* useInfoSelectionStore .* from .*infoSelectionStore"
    - from: "App.tsx UNAUTHORIZED effect (status === 'unauthenticated' branch)"
      to: "useInfoSelectionStore.getState().reset()"
      via: "added alongside existing two reset() calls inside the same status-unauthenticated block"
      pattern: "useInfoSelectionStore.getState\\(\\).reset\\(\\)"
    - from: "DashboardsPage.tsx DashboardOpen cleanup return-fn"
      to: "useInfoSelectionStore.getState().reset()"
      via: "added alongside existing two reset() calls inside the same useEffect cleanup return"
      pattern: "useInfoSelectionStore.getState\\(\\).reset\\(\\)"
---

<objective>
Wire `useInfoSelectionStore.reset()` into the two canonical lifecycle reset sites already established by `useFilterViewStore` in v1.3 Phase 15: (1) `App.tsx` UNAUTHORIZED effect for logout, (2) `DashboardsPage.tsx` `DashboardOpen` cleanup for dashboard-switch/unmount.

Purpose: STORE-V14-03 (dashboard-switch reset) requires working reset behavior — the store from Plan 20-01 is dormant until wired here. STORE-V14-04 logout-reset wiring (success criterion #3) also lands in this plan since both reset sites are extended together. This plan ensures Phase 20 success criteria #2 (dashboard-switch clears info selection) and #3 (logout clears info selection) are both verifiable.

Output: 4-line additions to two production files (App.tsx, DashboardsPage.tsx) — adding the third reset call alongside the existing two-store reset block. Plus matching test additions in App.spec.tsx and DashboardsPage.spec.tsx that assert all three stores reset together.
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
@.planning/phases/20-info-selection-store/20-01-store-and-spec-PLAN.md

# Files being modified
@kinetica_bi/src/App.tsx
@kinetica_bi/src/components/DashboardsPage.tsx
@kinetica_bi/src/App.spec.tsx
@kinetica_bi/src/components/DashboardsPage.spec.tsx

# Reference pattern (existing two-store reset block — model for the three-store extension)
@kinetica_bi/src/store/filterViewStore.ts
@kinetica_bi/src/store/filterStore.ts

# The store being wired (created by Plan 20-01)
@kinetica_bi/src/store/infoSelectionStore.ts

<interfaces>
Existing two-store reset blocks that this plan extends to three stores.

App.tsx UNAUTHORIZED handler (current state, lines 42-56, before this plan):

```
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
    // Plan 20-02 adds useInfoSelectionStore.getState().reset() HERE
  }
}, [status]);
```

DashboardsPage.tsx DashboardOpen cleanup (current state, lines 386-399, before this plan):

```
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
    // Plan 20-02 adds useInfoSelectionStore.getState().reset() HERE
  };
}, [dashboard.id]);
```

useInfoSelectionStore export from Plan 20-01 (kinetica_bi/src/store/infoSelectionStore.ts):

```
export const useInfoSelectionStore = create<InfoSelectionState>((set) => ({ ... }));
// reset action body: set({ state: {}, activeLayerId: null })
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Wire useInfoSelectionStore.reset() into App.tsx UNAUTHORIZED handler + extend App.spec coverage</name>
  <files>kinetica_bi/src/App.tsx, kinetica_bi/src/App.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/App.tsx (full file — see lines 9-12 for existing store imports, lines 42-56 for the UNAUTHORIZED handler effect)
    - kinetica_bi/src/store/infoSelectionStore.ts (the store created by Plan 20-01 — confirm export name useInfoSelectionStore and reset signature)
    - kinetica_bi/src/App.spec.tsx (full file — see line 9 for filterViewStore import, lines 200-294 for the existing logout-reset describe block including the canonical "resets BOTH stores" test at line 230)
    - kinetica_bi/src/store/filterViewStore.ts (reference for reset action shape)
  </read_first>
  <behavior>
    Production code (App.tsx):
    - Add: import { useInfoSelectionStore } from "./store/infoSelectionStore"; alongside the existing store imports (filterStore on line 9, filterViewStore on line 10).
    - Inside the existing UNAUTHORIZED useEffect (currently lines 42-56), AFTER the existing useFilterViewStore.getState().reset() (line 53) and useFilterStore.getState().reset() (line 54), add a third call: useInfoSelectionStore.getState().reset().
    - Order: filterViewStore -> filterStore -> infoSelectionStore. Three reset calls are sequential set() calls; no batching needed (Zustand set() is synchronous).
    - Do NOT add a dropFilterView-style fire-and-forget loop for info-selection — the info store has no server-side resource (session-only per STORE-V14-02). Just call reset().
    - Do NOT modify any other line in App.tsx.

    Spec code (App.spec.tsx):
    - Add: import { useInfoSelectionStore } from "./store/infoSelectionStore"; alongside existing store imports.
    - In the existing describe block (currently around line 200) that tests logout-reset behavior, EXTEND the existing test "resets BOTH stores after the DROP loop fires" (currently at line 230). Either modify the existing test to assert all three stores are reset (preferred — single test covers full three-store invariant), OR add a new dedicated test referencing STORE-V14-04.
    - The test MUST: (1) seed the info store with at least one entry via useInfoSelectionStore.getState().setSelection(...) AND set activeLayerId via useInfoSelectionStore.getState().setActiveLayer(...) before render, (2) trigger logout via useAuthStore.setState({ status: "unauthenticated" }), (3) assert useInfoSelectionStore.getState().state equals {} AND useInfoSelectionStore.getState().activeLayerId is null.
  </behavior>
  <action>
STEP 1 — Modify kinetica_bi/src/App.tsx:

1a. Add the import. After line 10 (the existing useFilterViewStore import), add a new line:

import { useInfoSelectionStore } from "./store/infoSelectionStore";

1b. Modify the UNAUTHORIZED useEffect at lines 42-56. The existing block ends with:

      useFilterViewStore.getState().reset();
      useFilterStore.getState().reset();
    }
  }, [status]);

Add ONE line — useInfoSelectionStore.getState().reset(); — between the existing useFilterStore.getState().reset(); and the closing brace, with a brief comment explaining the session-only-no-DROP-loop rationale:

      useFilterViewStore.getState().reset();
      useFilterStore.getState().reset();
      // Phase 20 STORE-V14-04: third reset alongside the canonical two-store block.
      // No fire-and-forget DROP loop — info-selection store is session-only (STORE-V14-02);
      // no server-side resource to clean up.
      useInfoSelectionStore.getState().reset();
    }
  }, [status]);

Do NOT modify line ordering of the first two resets, the dropFilterView loop, the dep array, or any other line in App.tsx.

STEP 2 — Modify kinetica_bi/src/App.spec.tsx:

2a. Add the import. After line 9 (the existing useFilterViewStore import), add:

import { useInfoSelectionStore } from "./store/infoSelectionStore";

2b. EXTEND the existing test at line 230 (currently "resets BOTH stores after the DROP loop fires") to assert all three stores. Update the test name from "BOTH" to "ALL THREE" and add the info-selection seeding plus assertion. The replacement test body (full it block):

  it("resets ALL THREE stores after the DROP loop fires (filterStore + filterViewStore + infoSelectionStore — STORE-V14-04)", async () => {
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as ActiveFilter);
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
    // Phase 20: seed info-selection store
    useInfoSelectionStore.getState().setSelection(7, { rows: [{ id: 1 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(7);

    render(<App />);

    act(() => {
      useAuthStore.setState({ status: "unauthenticated" } as ReturnType<typeof useAuthStore.getState>);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().filterVersion).toBe(0);
    expect(useFilterViewStore.getState().views).toEqual({});
    // Phase 20 STORE-V14-04: info-selection store also resets
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });

(Replace the existing test at line 230 with the above. Keep all other tests in the describe block untouched.)

Constraints:
- Do NOT touch any other test in App.spec.tsx (the canary tests, kbi_returnTo tests, fire-and-forget error tests, no-DROP-on-stay-authenticated tests, empty-views test).
- Do NOT introduce any new mocks — useInfoSelectionStore is a real Zustand store auto-covered by the shim (same as the existing two stores).
- The test name change from "BOTH" to "ALL THREE" is mandatory so the test name self-documents the three-store invariant.
  </action>
  <verify>
    <automated>cd /Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi && npx tsc --noEmit 2>&1 | tail -5 ; npx vitest run src/App.spec.tsx 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - Import added to production: grep -c 'import { useInfoSelectionStore } from "./store/infoSelectionStore";' kinetica_bi/src/App.tsx returns >= 1
    - Reset call added to production UNAUTHORIZED branch: grep -c "useInfoSelectionStore.getState().reset()" kinetica_bi/src/App.tsx returns >= 1
    - Three reset calls in canonical order in App.tsx — verify line numbers ascend in the order filterViewStore < filterStore < infoSelectionStore: grep -n "getState().reset()" kinetica_bi/src/App.tsx | head -3 shows filterViewStore first, filterStore second, infoSelectionStore third
    - Reset sits inside the unauthenticated branch (not at module level): the useInfoSelectionStore.getState().reset() line appears between the line containing 'status === "unauthenticated"' and the closing braces of that useEffect
    - Import added to spec: grep -c 'import { useInfoSelectionStore } from "./store/infoSelectionStore";' kinetica_bi/src/App.spec.tsx returns >= 1
    - Spec assertion added: grep -c "useInfoSelectionStore.getState().state" kinetica_bi/src/App.spec.tsx returns >= 1
    - Spec asserts activeLayerId reset: grep -cE "useInfoSelectionStore.getState\\(\\).activeLayerId" kinetica_bi/src/App.spec.tsx returns >= 1
    - Spec seeds info store before logout: grep -c "useInfoSelectionStore.getState().setSelection" kinetica_bi/src/App.spec.tsx returns >= 1
    - Test name updated to reflect all three: grep -cE "ALL THREE stores" kinetica_bi/src/App.spec.tsx returns >= 1
    - STORE-V14-04 referenced in test: grep -c "STORE-V14-04" kinetica_bi/src/App.spec.tsx returns >= 1
    - cd kinetica_bi && npx tsc --noEmit exits 0
    - cd kinetica_bi && npx vitest run src/App.spec.tsx exits 0
    - The new three-store test passes (test output shows the "ALL THREE" test as passing)
    - No pre-existing App.spec test fails (regression check — UX-06, kbi_returnTo, fire-and-forget tests still green)
  </acceptance_criteria>
  <done>App.tsx imports useInfoSelectionStore and calls useInfoSelectionStore.getState().reset() as the third reset in the UNAUTHORIZED branch (alongside the existing two). App.spec.tsx asserts all three stores reset on logout including the info-selection store's state map and activeLayerId. tsc clean, full App.spec suite passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire useInfoSelectionStore.reset() into DashboardsPage DashboardOpen cleanup + extend DashboardsPage.spec coverage</name>
  <files>kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/components/DashboardsPage.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.tsx (specifically the imports at top of file and lines 380-399 for the DashboardOpen cleanup useEffect)
    - kinetica_bi/src/store/infoSelectionStore.ts (confirm export name and reset signature — created by Plan 20-01)
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (full file — pattern reference for the "directly invoke cleanup logic" test idiom at lines 36-52, and the existing "resets BOTH stores when cleanup runs" test at line 54 that this task extends)
    - kinetica_bi/src/store/filterViewStore.ts (reference for reset signature)
  </read_first>
  <behavior>
    Production code (DashboardsPage.tsx):
    - Add: import { useInfoSelectionStore } from "../store/infoSelectionStore"; alongside the existing useFilterStore and useFilterViewStore imports (note relative path uses ../store/... because this file is in src/components/).
    - Inside the DashboardOpen cleanup useEffect (currently lines 386-399), AFTER the existing useFilterViewStore.getState().reset() (line 396) and useFilterStore.getState().reset() (line 397), add a third reset call: useInfoSelectionStore.getState().reset().
    - Order: filterViewStore -> filterStore -> infoSelectionStore (matches App.tsx order from Task 1).
    - Do NOT add a dropFilterView-style fire-and-forget loop for info-selection (session-only store).
    - Do NOT modify any other line in DashboardsPage.tsx.

    Spec code (DashboardsPage.spec.tsx):
    - Add: import { useInfoSelectionStore } from "../store/infoSelectionStore"; alongside existing store imports.
    - In the existing describe block "DashboardsPage — LIFE-V13-04 (dashboard-switch cleanup)" at line 25, EXTEND the existing test "resets BOTH stores when cleanup runs" (line 54) to also assert the info-selection store is reset, OR add a dedicated test referencing STORE-V14-03.
    - The test MUST: (1) seed the info-selection store via setSelection + setActiveLayer, (2) directly invoke the cleanup-logic mirror (matching the pattern at lines 40-47), (3) assert useInfoSelectionStore.getState().state equals {} AND useInfoSelectionStore.getState().activeLayerId equals null.
    - Test name MUST reference STORE-V14-03 explicitly so the requirement traceability is grep-able.
  </behavior>
  <action>
STEP 1 — Modify kinetica_bi/src/components/DashboardsPage.tsx:

1a. Find the existing imports for useFilterStore and useFilterViewStore at the top of the file. Add a parallel import:

import { useInfoSelectionStore } from "../store/infoSelectionStore";

(If the existing imports use a specific style — single-line vs grouped — match that style.)

1b. Modify the DashboardOpen cleanup useEffect at lines 386-399. The existing cleanup return ends with:

      useFilterViewStore.getState().reset();
      useFilterStore.getState().reset();
    };
  }, [dashboard.id]);

Add ONE line — useInfoSelectionStore.getState().reset(); — between the existing useFilterStore.getState().reset(); and the closing brace, with a brief comment:

      useFilterViewStore.getState().reset();
      useFilterStore.getState().reset();
      // Phase 20 STORE-V14-03: third reset alongside the canonical two-store block.
      // Session-only store (STORE-V14-02) — no server-side DROP loop needed.
      useInfoSelectionStore.getState().reset();
    };
  }, [dashboard.id]);

Do NOT modify line ordering of the first two resets, the dropFilterView loop, the dashboard.id dep array, or any other line.

STEP 2 — Modify kinetica_bi/src/components/DashboardsPage.spec.tsx:

2a. Add the import. After the existing useFilterViewStore import (around line 4), add:

import { useInfoSelectionStore } from "../store/infoSelectionStore";

2b. EXTEND the existing test at line 54 (currently "resets BOTH stores when cleanup runs") to also exercise the info-selection store. Update the test name and assertions to cover all three stores. The replacement test body (full it block):

  it("resets ALL THREE stores when cleanup runs (filterStore + filterViewStore + infoSelectionStore — STORE-V14-03)", async () => {
    useFilterStore.getState().addFilter(99, {
      column: "g", value: "A", dataType: "string", addedAt: Date.now(),
    } as ActiveFilter);
    useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
    // Phase 20: seed info-selection store
    useInfoSelectionStore.getState().setSelection(11, { rows: [{ id: 42 }], columns: ["id"], page: 0, hasMore: false });
    useInfoSelectionStore.getState().setActiveLayer(11);

    // Direct invocation of cleanup logic (same pattern as production at DashboardsPage.tsx:386-399)
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
    useInfoSelectionStore.getState().reset();

    expect(useFilterStore.getState().filters).toEqual({});
    expect(useFilterStore.getState().filterVersion).toBe(0);
    expect(useFilterViewStore.getState().views).toEqual({});
    // Phase 20 STORE-V14-03: info-selection store also resets
    expect(useInfoSelectionStore.getState().state).toEqual({});
    expect(useInfoSelectionStore.getState().activeLayerId).toBeNull();
  });

(Replace the existing test at line 54 with the above. Keep all other tests in the describe block untouched: the dropFilterView-fires test, the swallows-errors test, the empty-views test, the smoke-test mount.)

Constraints:
- The "direct invocation of cleanup logic" pattern at lines 40-47 of the existing spec is the locked test idiom. DashboardOpen is internal; full render-tree drill into a dashboard requires a non-empty listDashboards mock; pragmatic path is direct invocation matching what production does. Use the same pattern.
- Do NOT change any other test in the describe block.
- Do NOT introduce new module mocks — useInfoSelectionStore is a real Zustand store auto-covered by the shim.
- Test name change from "BOTH" to "ALL THREE" is mandatory.
  </action>
  <verify>
    <automated>cd /Users/rydelpereira/Documents/projects/codex_kinetica_bi/kinetica_bi && npx tsc --noEmit 2>&1 | tail -5 ; npx vitest run src/components/DashboardsPage.spec.tsx 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - Import added to production: grep -c 'import { useInfoSelectionStore } from "../store/infoSelectionStore";' kinetica_bi/src/components/DashboardsPage.tsx returns >= 1
    - Reset call added to production cleanup: grep -c "useInfoSelectionStore.getState().reset()" kinetica_bi/src/components/DashboardsPage.tsx returns >= 1
    - Three reset calls in canonical order — line numbers in DashboardsPage.tsx ascend in order filterViewStore < filterStore < infoSelectionStore: grep -n "getState().reset()" kinetica_bi/src/components/DashboardsPage.tsx | head -3 shows the three reset calls in that order
    - Reset sits inside the cleanup-return function (not at module level): the useInfoSelectionStore.getState().reset() line appears between 'return () =>' and '};\n  }, [dashboard.id])' inside the cleanup useEffect
    - Import added to spec: grep -c 'import { useInfoSelectionStore } from "../store/infoSelectionStore";' kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - Spec asserts state map cleared: grep -c "useInfoSelectionStore.getState().state" kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - Spec asserts activeLayerId cleared: grep -cE "useInfoSelectionStore.getState\\(\\).activeLayerId" kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - Spec seeds info store before cleanup: grep -c "useInfoSelectionStore.getState().setSelection" kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - Spec invokes reset directly (matches production cleanup pattern): grep -c "useInfoSelectionStore.getState().reset()" kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - Test name updated to ALL THREE: grep -cE "ALL THREE stores" kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - STORE-V14-03 referenced in test: grep -c "STORE-V14-03" kinetica_bi/src/components/DashboardsPage.spec.tsx returns >= 1
    - cd kinetica_bi && npx tsc --noEmit exits 0
    - cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx exits 0
    - All four pre-existing tests in the describe block still pass (regression check — dropFilterView-fires-twice test, swallows-errors test, empty-views test, smoke mount test)
  </acceptance_criteria>
  <done>DashboardsPage.tsx imports useInfoSelectionStore and calls useInfoSelectionStore.getState().reset() as the third reset in the DashboardOpen cleanup (alongside the existing two). DashboardsPage.spec.tsx asserts all three stores reset on dashboard switch including the info-selection store's state map and activeLayerId. tsc clean, full DashboardsPage.spec suite passes.</done>
</task>

</tasks>

<verification>
Plan 20-02 verification (run all from kinetica_bi/):

1. Production reset wiring present in both files:

```
grep -c "useInfoSelectionStore.getState().reset()" kinetica_bi/src/App.tsx
grep -c "useInfoSelectionStore.getState().reset()" kinetica_bi/src/components/DashboardsPage.tsx
```
Both must return >= 1.

2. Spec coverage in both files:

```
grep -c "STORE-V14-04" kinetica_bi/src/App.spec.tsx
grep -c "STORE-V14-03" kinetica_bi/src/components/DashboardsPage.spec.tsx
```
Both must return >= 1.

3. TypeScript clean:

```
cd kinetica_bi && npx tsc --noEmit
```
Exits 0.

4. Affected specs pass:

```
cd kinetica_bi && npx vitest run src/App.spec.tsx src/components/DashboardsPage.spec.tsx src/store/infoSelectionStore.spec.ts
```
All exit 0.

5. Full frontend test suite green (regression check):

```
cd kinetica_bi && npx vitest run
```
Zero new failures vs main branch baseline.
</verification>

<success_criteria>
- App.tsx adds useInfoSelectionStore import and calls useInfoSelectionStore.getState().reset() as the third reset in the UNAUTHORIZED handler
- DashboardsPage.tsx adds useInfoSelectionStore import and calls useInfoSelectionStore.getState().reset() as the third reset in DashboardOpen cleanup
- App.spec.tsx and DashboardsPage.spec.tsx both have updated tests asserting all three stores reset together (test names now say "ALL THREE")
- Phase 20 success criterion #2 (dashboard-switch clears info selection) — VERIFIED via DashboardsPage.spec test
- Phase 20 success criterion #3 (logout clears info selection via App.tsx unauthenticated effect) — VERIFIED via App.spec test
- STORE-V14-03 (dashboard-switch reset) and STORE-V14-04 (logout reset wiring) — Plan 20-02 complete
- tsc --noEmit passes clean; full vitest suite passes with no new failures
</success_criteria>

<output>
After completion, create `.planning/phases/20-info-selection-store/20-02-lifecycle-integration-SUMMARY.md` summarizing: (a) production line additions in App.tsx and DashboardsPage.tsx (line numbers + snippet), (b) spec test additions / modifications (which describe blocks, which it blocks), (c) test pass count for App.spec.tsx, DashboardsPage.spec.tsx, and infoSelectionStore.spec.ts, (d) confirmation that no pre-existing tests regressed, (e) confirmation that all 5 STORE-V14-* requirements are now complete (STORE-V14-01..05 — Plan 20-01 covered 01/02/04-store-side/05; Plan 20-02 covered 03/04-wiring-side).
</output>
