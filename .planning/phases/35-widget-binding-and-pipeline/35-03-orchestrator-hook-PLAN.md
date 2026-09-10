---
phase: 35-widget-binding-and-pipeline
plan: 03
type: execute
wave: 2
depends_on:
  - "35-01"
files_modified:
  - kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts
  - kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
  - kinetica_bi/src/components/DashboardContext.tsx
  - kinetica_bi/src/components/DashboardContext.spec.tsx
autonomous: true
requirements:
  - DV-V16-13
must_haves:
  truths:
    - "Orchestrator hook is mounted once per open dashboard at DashboardOpen scope"
    - "Cascade fires ONLY when filter-view materializeVersion > 0 for the source-table — cold-start dashboard mount does NOT flood materialize calls (Pitfall 1 lock)"
    - "Per-dynamic-view AbortController in useRef<Map<number, AbortController>> isolates rapid filter-change aborts to the single dv (no cross-dv cancellation)"
    - "Dynamic-view list refreshes when useDynamicViewStore.dynamicViewVersion increments (Pitfall 2 cleanup: prune controllers for removed dvs)"
    - "Hook returns { dynamicViews, retry(dynamicViewId) } — retry is consumed by Plan 35-05 error states"
    - "AbortError is silent; other errors call setError + toast 'error' kind (NEVER 'warning' — locked from Phase 34 research)"
    - "DashboardContext gains dynamicViews: DynamicViewRow[] for downstream orphan-detection (Plan 35-05/35-06)"
  artifacts:
    - path: "kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts"
      provides: "Dashboard-scope orchestrator hook"
      min_lines: 120
    - path: "kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts"
      provides: "Cascade-fire + cold-start gate + per-id abort + version-refresh + retry coverage"
      min_lines: 200
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "Hook mount + dynamicViews prop threading to WidgetConfigModal + LayersModal"
      contains: "useDynamicViewMaterializeChain"
    - path: "kinetica_bi/src/components/DashboardContext.tsx"
      provides: "dynamicViews context value for renderer orphan detection"
      contains: "dynamicViews"
  key_links:
    - from: "useDynamicViewMaterializeChain"
      to: "useFilterViewStore.views[T]?.materializeVersion"
      via: "primitive matVersionKey selector"
      pattern: "materializeVersion"
    - from: "useDynamicViewMaterializeChain"
      to: "useDynamicViewStore (markPending, setView, setError)"
      via: "imperative getState() calls"
      pattern: "useDynamicViewStore.getState\\(\\)\\.markPending"
    - from: "useDynamicViewMaterializeChain"
      to: "materializeDynamicView client helper"
      via: "per-id AbortController.signal"
      pattern: "materializeDynamicView\\("
    - from: "DashboardOpen"
      to: "WidgetConfigModal + LayersModal + DashboardContext"
      via: "dynamicViews prop / context value"
      pattern: "dynamicViews="
---

<objective>
Build the dashboard-scope orchestrator hook that watches `useFilterViewStore.views[T]?.materializeVersion` for each unique source-table referenced by the dashboard's dynamic-views, and fires `markPending → materializeDynamicView → setView/setError` cascades. Mount it once at `DashboardOpen` scope. Thread the resulting `dynamicViews` array as a prop to `WidgetConfigModal` (for Plan 35-04 ChartConfigPanel) and `LayersModal` (for Plan 35-06 KineticaWmsLayerForm), and through `DashboardContext` for renderer orphan detection.

Purpose: This is the heart of v1.6. Without the orchestrator, dv-bound widgets render once on mount and never update. With it, every filter-view re-materialize cascades to every dependent dv (per-source-table grouped). The cold-start gate (Pitfall 1) prevents N materialize calls on dashboard open before any filter is applied.

Output: One new hook file + spec + extensions to DashboardsPage and DashboardContext.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md
@.planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md
@.planning/phases/33-dynamic-view-store/33-CONTEXT.md
@.planning/phases/34-dynamic-view-ui/34-CONTEXT.md
@kinetica_bi/src/store/dynamicViewStore.ts
@kinetica_bi/src/store/filterViewStore.ts
@kinetica_bi/src/store/auth.ts
@kinetica_bi/src/store/toast.ts
@kinetica_bi/src/lib/dynamicViewName.ts
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/components/DashboardsPage.tsx
@kinetica_bi/src/components/DashboardContext.tsx
@kinetica_bi/src/components/DynamicViewsModal.tsx

<interfaces>
<!-- Locked references from 35-RESEARCH.md §"Pattern 1" + §"Example 6" + §"Example 7" + Pitfalls 1, 2, 6 -->

From kinetica_bi/src/store/dynamicViewStore.ts (Phase 33 actions — imperative via getState()):
```typescript
useDynamicViewStore.getState().markPending(id: number, viewName: string): void;
useDynamicViewStore.getState().setView(id: number, payload: { viewName: string; status: "materialized" | "over_threshold"; expiresAt?: number; reason?: "no_filter" | "exceeds_max_records" }): void;
useDynamicViewStore.getState().setError(id: number, error: string): void;
useDynamicViewStore.getState().clearView(id: number): void;
// State selectors:
useDynamicViewStore((s) => s.dynamicViewVersion): number;   // monotonic; bumps on every successful mutation
```

From kinetica_bi/src/store/filterViewStore.ts (Phase 14):
```typescript
useFilterViewStore.getState().views[tableId]?.materializeVersion: number | undefined;
// PITFALL S-02 lock: derive primitive key for stable subscription — see matVersionKey below.
```

From kinetica_bi/src/store/auth.ts:
```typescript
useAuthStore.getState().user?.username: string | undefined;   // Required for buildDynamicViewName
```

From kinetica_bi/src/lib/dynamicViewName.ts (Phase 33):
```typescript
export function buildDynamicViewName(args: { userId: string; dashboardId: number; dynamicViewId: number }): string;
// Returns "_kbi_dv_u<userId>_d<dashboardId>_<dynamicViewId>" — byte-parity with server.
```

From kinetica_bi/src/api/client.ts (Phase 33):
```typescript
export function listDynamicViews(dashboardId: number, signal?: AbortSignal): Promise<{ dynamic_views: DynamicViewRow[] }>;

export function materializeDynamicView(dynamicViewId: number, signal?: AbortSignal): Promise<MaterializeDynamicViewResponse>;
// MaterializeDynamicViewResponse = 3-branch discriminated union:
// | { status: "materialized", view_name: string, row_count: number, expires_at: number }
// | { status: "over_threshold", reason: "no_filter" }
// | { status: "over_threshold", reason: "exceeds_max_records", row_count: number }

export type DynamicViewRow = {
  id: number;
  dashboard_id: number;
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  columns_json: { name: string; type: string }[] | null;
  created_at: string;
  updated_at: string;
};
```

From kinetica_bi/src/store/toast.ts:
```typescript
export type ToastKind = "permission" | "info" | "error";   // NO "warning" — locked Phase 34
useToastStore.getState().showToast(message: string, kind: ToastKind): void;
```

Cold-start gate (Pitfall 1 from 35-RESEARCH.md:559-568):
```typescript
const matVer = useFilterViewStore.getState().views[dv.source_table_id]?.materializeVersion;
if (matVer === undefined || matVer === 0) continue;   // filter view hasn't materialized yet — DO NOT fire cascade
```

AbortController Map (35-RESEARCH.md §"Pattern 1" + Pitfall 2):
```typescript
const cascadeControllersRef = useRef<Map<number, AbortController>>(new Map());
// Per-id Map; abort prior in-flight for SAME id; never cross-cancel.

// Pitfall 2 cleanup: prune controllers for removed dvs after every effect fire.
const activeIds = new Set(dynamicViews.map((dv) => dv.id));
for (const [id, ctrl] of cascadeControllersRef.current.entries()) {
  if (!activeIds.has(id)) {
    ctrl.abort();
    cascadeControllersRef.current.delete(id);
  }
}
```

Stable primitive key (Pitfall S-02 + 35-RESEARCH.md:262-268):
```typescript
const sourceTableIds = useMemo(
  () => Array.from(new Set(dynamicViews.map((dv) => dv.source_table_id))).sort((a, b) => a - b),
  [dynamicViews]
);
const matVersionKey = useFilterViewStore((s) =>
  sourceTableIds.map((tid) => `${tid}:${s.views[tid]?.materializeVersion ?? 0}`).join(",")
);
```

DashboardContext existing shape (35-RESEARCH.md §"Example 7"):
```typescript
export type DashboardContextValue = {
  dashboardId: number;
  widgets: WidgetDto[];
  // NEW Phase 35:
  dynamicViews: DynamicViewRow[];
};
```

DashboardsPage existing mount sites (35-RESEARCH.md §"Example 6"):
- `DashboardOpen` body at lines 359-450 — orchestrator hook mounts here
- WidgetConfigModal at ~942-974 — pass `dynamicViews` prop (Plan 35-04 consumes)
- LayersModal at ~942-974 — pass `dynamicViews` prop (Plan 35-06 consumes)
- DynamicViewsModal at ~942-974 — UNCHANGED in Phase 35
- DashboardContextProvider — extend value with `dynamicViews`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create useDynamicViewMaterializeChain hook + comprehensive spec</name>
  <files>kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts, kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts</files>
  <read_first>
    - kinetica_bi/src/store/dynamicViewStore.ts (FULL — Phase 33 store contract, action signatures)
    - kinetica_bi/src/store/filterViewStore.ts (lines 30-130 — materializeVersion semantics)
    - kinetica_bi/src/store/auth.ts (FULL — useAuthStore.user.username path)
    - kinetica_bi/src/store/toast.ts (FULL — ToastKind union; "error" only for materialize failures)
    - kinetica_bi/src/lib/dynamicViewName.ts (FULL — buildDynamicViewName signature)
    - kinetica_bi/src/api/client.ts (lines 737-927 — listDynamicViews + materializeDynamicView signatures)
    - kinetica_bi/src/components/DynamicViewsModal.tsx (lines 280-516 — Phase 34 Save flow shows the EXACT markPending→materializeDynamicView→setView/setError chain; orchestrator mirrors this for cascades)
    - kinetica_bi/__mocks__/zustand.ts (test reset shim)
    - kinetica_bi/src/test/setup.ts (vitest + jsdom setup)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"Cascading materialize trigger architecture" — verbatim spec)
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Pattern 1" — hook skeleton verbatim; §"Pitfall 1" — cold-start gate; §"Pitfall 2" — controller cleanup)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md (§"Store shape", §"Action contract")
  </read_first>
  <behavior>
    **Spec coverage (must all pass):**

    - Test 1 (mount + listDynamicViews): On mount with `dashboardId=42`, calls `listDynamicViews(42, signal)`. Sets local `dynamicViews` state from response. The hook return value `dynamicViews` matches the fetched list.

    - Test 2 (cold-start gate — Pitfall 1): When `useFilterViewStore.views[T]?.materializeVersion` is `undefined` for all source tables (no filter applied yet), `materializeDynamicView` is NEVER called. NO toast fires. NO `markPending` writes.

    - Test 3 (cold-start gate — materializeVersion === 0 also skipped): When `useFilterViewStore.views[T] = { materializeVersion: 0 }`, the cascade is still gated off. (Defensive — `markMaterializing` writes `0` as placeholder per filterViewStore.ts:94.)

    - Test 4 (cascade fires after filter-view materializes): Setup `dynamicViews = [{ id: 7, source_table_id: 4 }, { id: 8, source_table_id: 4 }]`. Bump `useFilterViewStore.setView(4, { ..., materializeVersion: 1 })`. Assert: `markPending(7, viewName7)` + `markPending(8, viewName8)` BOTH called; `materializeDynamicView(7, signal)` + `materializeDynamicView(8, signal)` BOTH called. viewName matches `buildDynamicViewName` output.

    - Test 5 (cascade DOES NOT fire for unrelated source table): Setup `dynamicViews = [{ id: 7, source_table_id: 4 }]`. Bump filterViewStore for `source_table_id = 99` (unrelated). Assert: NO `markPending(7, ...)` call, NO `materializeDynamicView(7, ...)` call.

    - Test 6 (per-id AbortController dedup — rapid filter changes): Bump filterViewStore.materializeVersion=1 → orchestrator fires materialize for dv 7 (in-flight). Bump again to 2 BEFORE first resolves → assert the first AbortController's `.signal.aborted === true`; second materialize call uses a NEW signal.

    - Test 7 (per-id isolation — Pitfall 2 spirit): Setup dvs `[{ id: 7, source_table_id: 4 }, { id: 8, source_table_id: 99 }]`. Bump materializeVersion for table 4 → dv 7's controller created/in-flight. THEN bump materializeVersion for table 99 → dv 8's controller created; dv 7's controller is NOT aborted (cross-dv isolation).

    - Test 8 (response: materialized): Mock `materializeDynamicView` resolving `{ status: "materialized", view_name: "_kbi_dv_u1_d42_7", row_count: 100, expires_at: 9999 }`. Assert `useDynamicViewStore.getState().setView` called with `(7, { viewName: "_kbi_dv_u1_d42_7", status: "materialized", expiresAt: 9999 })`. NO toast fires (silent success — locked from Phase 34 research).

    - Test 9 (response: over_threshold/no_filter): Mock response `{ status: "over_threshold", reason: "no_filter" }`. Assert setView called with `{ viewName, status: "over_threshold", reason: "no_filter" }`. NO toast.

    - Test 10 (response: over_threshold/exceeds_max_records): Mock response `{ status: "over_threshold", reason: "exceeds_max_records", row_count: 50000 }`. Assert setView called with `{ viewName, status: "over_threshold", reason: "exceeds_max_records" }`. NO toast.

    - Test 11 (response: error): Mock `materializeDynamicView` rejecting with `new Error("boom")`. Assert `useDynamicViewStore.getState().setError(7, "boom")` called AND `useToastStore.getState().showToast("Materialize failed: boom", "error")` called. Toast kind MUST be `"error"` — never `"warning"`.

    - Test 12 (AbortError silent): Mock `materializeDynamicView` rejecting with `Object.assign(new Error("aborted"), { name: "AbortError" })`. Assert NO `setError` call, NO toast, NO state mutation.

    - Test 13 (list refresh on dynamicViewVersion increment): After initial list load, call `useDynamicViewStore.getState().setView(99, { ...someEntry })` (or any action that bumps `dynamicViewVersion`). Assert `listDynamicViews` is called a SECOND time. Assert local list updates.

    - Test 14 (list-fetch AbortController on unmount): Unmount the hook while `listDynamicViews` is in-flight. Assert the listAbort signal is aborted. NO unhandled rejection.

    - Test 15 (Pitfall 2 cleanup — removed dv controllers pruned): Setup `dynamicViews = [{ id: 7, source_table_id: 4 }]`. Bump matVersion → controller created. Then update `dynamicViews` (via list refresh) to `[]`. Assert `cascadeControllersRef.current.get(7)` is undefined AND any prior in-flight controller is aborted.

    - Test 16 (retry function): Hook returns `retry(dynamicViewId)`. Calling `retry(7)` fires `markPending(7, viewName)` + `materializeDynamicView(7, signal)`. Same branching as cascade for success/error/abort.

    - Test 17 (no username → no cascade): If `useAuthStore.getState().user?.username` is `undefined`, the cascade short-circuits — NO `markPending`, NO `materializeDynamicView` calls. (Defensive — can't compute viewName without userId.)
  </behavior>
  <action>
    **1. Create `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`:**

    ```typescript
    /**
     * Phase 35 (DV-V16-13): Dashboard-scope orchestrator hook for dynamic-view
     * cascading materialize.
     *
     * Subscribes to `useFilterViewStore.views[T]?.materializeVersion` for each unique
     * source-table referenced by the dashboard's dynamic-views. On materializeVersion
     * bump for table T, fires `markPending → materializeDynamicView → setView/setError`
     * for each dv with `source_table_id === T`.
     *
     * Key behaviors:
     * - Cold-start gate (Pitfall 1): cascade fires ONLY when `matVer > 0` — prevents
     *   N materialize calls on dashboard mount before any filter is applied.
     * - Per-dv AbortController in `useRef<Map<number, AbortController>>` — rapid filter
     *   changes abort prior in-flight for THE SAME dv; never cross-cancel between dvs.
     * - List refresh on `dynamicViewVersion` increment (Phase 33 locked option b).
     * - AbortError silent; other errors → setError + toast "error" kind.
     * - Returns { dynamicViews, retry(id) } — Plan 35-05 consumes retry for error states.
     */

    import { useCallback, useEffect, useMemo, useRef, useState } from "react";
    import { useFilterViewStore } from "../store/filterViewStore";
    import { useDynamicViewStore } from "../store/dynamicViewStore";
    import { useAuthStore } from "../store/auth";
    import { useToastStore } from "../store/toast";
    import { buildDynamicViewName } from "../lib/dynamicViewName";
    import {
      listDynamicViews,
      materializeDynamicView,
      type DynamicViewRow,
    } from "../api/client";

    export type UseDynamicViewMaterializeChainResult = {
      dynamicViews: DynamicViewRow[];
      retry: (dynamicViewId: number) => void;
    };

    export function useDynamicViewMaterializeChain(
      dashboardId: number,
    ): UseDynamicViewMaterializeChainResult {
      // --- 1. List state — refreshes on mount + when dynamicViewVersion increments ---
      const [dynamicViews, setDynamicViews] = useState<DynamicViewRow[]>([]);
      const dynamicViewVersion = useDynamicViewStore((s) => s.dynamicViewVersion);
      const listAbortRef = useRef<AbortController | null>(null);

      useEffect(() => {
        listAbortRef.current?.abort();
        const ctrl = new AbortController();
        listAbortRef.current = ctrl;
        listDynamicViews(dashboardId, ctrl.signal)
          .then(({ dynamic_views }) => {
            if (!ctrl.signal.aborted) setDynamicViews(dynamic_views);
          })
          .catch((err) => {
            if ((err as Error)?.name === "AbortError") return;
            // Soft-fail — operator can still use widgets; cascades just won't fire.
            // No toast — list-fetch failure is non-critical and not user-actionable here.
          });
        return () => ctrl.abort();
      }, [dashboardId, dynamicViewVersion]);

      // --- 2. Stable primitive key for filter-view materializeVersion subscription (PITFALL S-02) ---
      const sourceTableIds = useMemo(
        () =>
          Array.from(new Set(dynamicViews.map((dv) => dv.source_table_id))).sort(
            (a, b) => a - b,
          ),
        [dynamicViews],
      );
      const matVersionKey = useFilterViewStore((s) =>
        sourceTableIds
          .map((tid) => `${tid}:${s.views[tid]?.materializeVersion ?? 0}`)
          .join(","),
      );

      // --- 3. Per-dv AbortController Map ---
      const cascadeControllersRef = useRef<Map<number, AbortController>>(new Map());

      // --- 4. Cascade fire helper (used by both the effect and the retry callback) ---
      const fireCascade = useCallback(
        (dv: DynamicViewRow) => {
          const username = useAuthStore.getState().user?.username;
          if (!username) return;  // Test 17: no username → no cascade

          // Abort prior in-flight for THIS dv only (cross-dv isolation — Test 7)
          cascadeControllersRef.current.get(dv.id)?.abort();
          const ctrl = new AbortController();
          cascadeControllersRef.current.set(dv.id, ctrl);

          const viewName = buildDynamicViewName({
            userId: username,
            dashboardId: dv.dashboard_id,
            dynamicViewId: dv.id,
          });
          useDynamicViewStore.getState().markPending(dv.id, viewName);

          materializeDynamicView(dv.id, ctrl.signal)
            .then((result) => {
              if (ctrl.signal.aborted) return;
              if (result.status === "materialized") {
                useDynamicViewStore.getState().setView(dv.id, {
                  viewName: result.view_name,
                  status: "materialized",
                  expiresAt: result.expires_at,
                });
              } else if (result.status === "over_threshold") {
                useDynamicViewStore.getState().setView(dv.id, {
                  viewName,
                  status: "over_threshold",
                  reason: result.reason,
                });
              }
              // No toast on success — locked from Phase 34 research. Over-threshold is
              // surfaced via renderer empty state (Plan 35-05) and map overlay (Plan 35-06).
            })
            .catch((err) => {
              if ((err as Error)?.name === "AbortError") return;  // Test 12: silent
              const msg = (err as Error).message ?? "Materialize failed";
              useDynamicViewStore.getState().setError(dv.id, msg);
              // Toast kind LOCKED to "error" — NEVER "warning" (Phase 34 research lock).
              useToastStore.getState().showToast(`Materialize failed: ${msg}`, "error");
            });
        },
        [],
      );

      // --- 5. Cascade effect — fires on matVersionKey OR dynamicViews change ---
      useEffect(() => {
        // For each dv: read its source table's materializeVersion; if > 0, fire cascade.
        // matVer === undefined OR matVer === 0 → filter view hasn't materialized yet (Pitfall 1 gate).
        for (const dv of dynamicViews) {
          const matVer = useFilterViewStore.getState().views[dv.source_table_id]
            ?.materializeVersion;
          if (matVer === undefined || matVer === 0) continue;  // PITFALL 1 LOCK
          fireCascade(dv);
        }

        // PITFALL 2 cleanup: prune controllers for dvs removed from the list.
        const activeIds = new Set(dynamicViews.map((dv) => dv.id));
        for (const [id, ctrl] of cascadeControllersRef.current.entries()) {
          if (!activeIds.has(id)) {
            ctrl.abort();
            cascadeControllersRef.current.delete(id);
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [matVersionKey, dynamicViews, fireCascade]);

      // --- 6. Unmount cleanup: abort all in-flight cascades ---
      useEffect(
        () => () => {
          cascadeControllersRef.current.forEach((c) => c.abort());
          cascadeControllersRef.current.clear();
        },
        [],
      );

      // --- 7. Retry callback for renderer error states (Plan 35-05 consumes) ---
      const retry = useCallback(
        (dynamicViewId: number) => {
          const dv = dynamicViews.find((d) => d.id === dynamicViewId);
          if (!dv) return;
          fireCascade(dv);
        },
        [dynamicViews, fireCascade],
      );

      return { dynamicViews, retry };
    }
    ```

    **2. Create `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts`:**

    Use `renderHook` from `@testing-library/react`. Mock `listDynamicViews` and `materializeDynamicView` via `vi.mock("../api/client", ...)`. Set up auth state and stores via `getState()` calls (Zustand reset shim auto-resets between tests).

    Cover all 17 tests from the behavior block above. Mirror the pattern of an existing hook spec or store spec in the repo for module-mocking style. Each test should:
    - Reset stores via `useDynamicViewStore.getState().reset()` + `useFilterViewStore.getState().reset()` in `beforeEach` (or rely on the Zustand reset shim).
    - Mock `listDynamicViews` to return a controllable promise; mock `materializeDynamicView` likewise.
    - Use `await waitFor(...)` for async assertions.
    - Use `act(...)` for store mutations triggered from outside React.

    **For test 6 (rapid abort)**: Hold the first `materializeDynamicView` mock unresolved, trigger the second via second matVersion bump, then check the first controller's signal:
    ```typescript
    // Get the first call's signal:
    const firstSignal = (materializeDynamicView as Mock).mock.calls[0][1] as AbortSignal;
    act(() => useFilterViewStore.getState().setView(4, { ...viewMeta, materializeVersion: 2 }));
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    ```

    **For test 13 (list refresh)**: After initial mount, mutate the dynamic-view store to bump `dynamicViewVersion`:
    ```typescript
    act(() => useDynamicViewStore.getState().setView(99, { viewName: "x", status: "materialized" }));
    await waitFor(() => expect(listDynamicViews).toHaveBeenCalledTimes(2));
    ```

    **3. Verify the spec passes by reading existing hook specs in the repo** (`grep -rl "renderHook" kinetica_bi/src/`) for the canonical test-bed style. If no hook spec exists, the patterns in `DynamicViewsModal.spec.tsx` for mock-client + zustand-getState + waitFor will translate directly.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/hooks/useDynamicViewMaterializeChain.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "useDynamicViewMaterializeChain" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`
    - `grep -q "useRef<Map<number, AbortController>>" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (per-id Map lock)
    - `grep -q "matVer === undefined || matVer === 0" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (Pitfall 1 cold-start gate)
    - `grep -q "matVer > 0\|matVer === 0" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (cold-start gate present)
    - `grep -q "\"error\"" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (toast kind lock)
    - `! grep -q "\"warning\"" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (forbidden kind absent)
    - `grep -q "name === \"AbortError\"" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (silent abort)
    - `grep -q "activeIds.has" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (Pitfall 2 controller pruning)
    - `grep -q "buildDynamicViewName" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`
    - `grep -q "retry" kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` (retry callback exposed)
    - Spec file exists at expected path with ≥ 17 `it(` blocks
    - `cd kinetica_bi && npx vitest run src/hooks/useDynamicViewMaterializeChain.spec.ts` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - Hook implemented with all 7 numbered sections from spec verbatim
    - 17-test spec covers cold-start gate, per-id abort isolation, controller pruning, version refresh, all 4 response branches, retry callback, no-username defensive case
    - All locked anti-patterns enforced (no warning toast, no shared AbortController, no whole-views subscription)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Mount hook in DashboardsPage; extend DashboardContext; thread dynamicViews prop to WidgetConfigModal + LayersModal</name>
  <files>kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/components/DashboardsPage.spec.tsx, kinetica_bi/src/components/DashboardContext.tsx, kinetica_bi/src/components/DashboardContext.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.tsx (FULL — DashboardOpen body at 359-450; mount points at 942-974)
    - kinetica_bi/src/components/DashboardContext.tsx (FULL — current context shape; Phase 30 added widgets)
    - kinetica_bi/src/components/DashboardContext.spec.tsx (FULL — extend to assert dynamicViews carried through provider)
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (FULL — extend modal-mount tests)
    - kinetica_bi/src/components/LayersModal.tsx (verify current props for `dynamicViews` thread point)
    - kinetica_bi/src/components/WidgetConfigModal.tsx (or wherever ChartConfigPanel is mounted — verify props for `dynamicViews` thread point)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"Dynamic-view list source for orchestrator")
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Example 6", §"Example 7")
  </read_first>
  <behavior>
    - Test 1 (DashboardsPage.spec.tsx): Opening a dashboard mounts `useDynamicViewMaterializeChain` exactly once (verify via mock spy). Subsequent re-renders do NOT re-mount.

    - Test 2 (DashboardsPage.spec.tsx): The `dynamicViews` returned by the hook is threaded as a prop to WidgetConfigModal (verify the modal's props receive a non-undefined `dynamicViews: DynamicViewRow[]`).

    - Test 3 (DashboardsPage.spec.tsx): The `dynamicViews` returned by the hook is threaded as a prop to LayersModal.

    - Test 4 (DashboardContext.spec.tsx): `DashboardContext.Provider` accepts and exposes `dynamicViews: DynamicViewRow[]`. Consumer reads `dynamicViews` via `useDashboardContext()`.

    - Test 5 (DashboardContext.spec.tsx): When `dynamicViews` is `[]` (no dvs configured), the context value's `dynamicViews` is an empty array (not undefined).

    - Test 6 (DashboardsPage.spec.tsx): Closing the dashboard (unmount) calls cleanup on the hook (verified indirectly via the existing lifecycle reset assertions in DashboardsPage.spec.tsx — Phase 33 already covers store resets; this Test 6 just ensures the hook is mounted IN that lifecycle scope).
  </behavior>
  <action>
    **1. Extend `DashboardContext.tsx`:**

    Add `dynamicViews: DynamicViewRow[]` to `DashboardContextValue`. Update the provider's prop types AND the context default fallback (if any).

    ```typescript
    import { type DynamicViewRow } from "../api/client";

    export type DashboardContextValue = {
      dashboardId: number;
      widgets: WidgetDto[];                        // existing (Phase 30)
      dynamicViews: DynamicViewRow[];              // NEW Phase 35 (DV-V16-13) — renderer orphan detection
    };

    // If there's a default React.createContext value, update it:
    const DashboardContext = React.createContext<DashboardContextValue>({
      dashboardId: 0,
      widgets: [],
      dynamicViews: [],                            // NEW Phase 35
    });
    ```

    Update the provider's signature:

    ```typescript
    export const DashboardContextProvider: React.FC<{
      dashboardId: number;
      widgets: WidgetDto[];
      dynamicViews: DynamicViewRow[];              // NEW
      children: React.ReactNode;
    }> = ({ dashboardId, widgets, dynamicViews, children }) => {
      const value = useMemo(
        () => ({ dashboardId, widgets, dynamicViews }),
        [dashboardId, widgets, dynamicViews],
      );
      return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
    };
    ```

    **2. Extend `DashboardContext.spec.tsx`:**

    Add a test asserting:
    - Provider accepts `dynamicViews` prop.
    - Consumer via `useDashboardContext()` (or `useContext(DashboardContext)`) reads back the same array reference.
    - Empty array default works.

    **3. Extend `DashboardsPage.tsx`:**

    In `DashboardOpen` body (lines 359-450), add the hook mount at the TOP of the function body, after the existing state declarations:

    ```typescript
    const DashboardOpen = ({ dashboard, onBack }: { dashboard: DashboardDto; onBack: () => void }) => {
      // ... existing tablesQuery, widgetsQuery, viewsQuery, state declarations ...

      // NEW Phase 35 (DV-V16-13): orchestrator hook — mounted at DashboardOpen scope.
      // Returns the dashboard's dynamic-views list + a retry function for renderer error states.
      // Hook handles cold-start gate (matVer > 0) so this is safe to mount on every dashboard open
      // without flooding materialize calls.
      const { dynamicViews, retry: retryDynamicView } = useDynamicViewMaterializeChain(dashboard.id);

      // ... existing useEffects (lifecycle resets, layer loading, etc.) ...
    };
    ```

    Add the import at the top:
    ```typescript
    import { useDynamicViewMaterializeChain } from "../hooks/useDynamicViewMaterializeChain";
    ```

    **4. Thread `dynamicViews` through DashboardContextProvider** (locate the existing `<DashboardContextProvider>` wrapping in `DashboardOpen`'s return):

    ```tsx
    <DashboardContextProvider
      dashboardId={dashboard.id}
      widgets={widgets}
      dynamicViews={dynamicViews}                    // NEW Phase 35
    >
      {/* existing children */}
    </DashboardContextProvider>
    ```

    **5. Thread `dynamicViews` to WidgetConfigModal** (locate `<WidgetConfigModal ...>` or whichever modal wraps ChartConfigPanel):

    ```tsx
    {configuringWidget && (
      <WidgetConfigModal
        widget={configuringWidget}
        tables={associatedTables}
        views={views}
        dynamicViews={dynamicViews}                  // NEW Phase 35 — Plan 35-04 consumes
        onSave={(chartConfig) => handleSaveConfig(configuringWidget, chartConfig)}
        onClose={() => setConfiguringWidget(null)}
      />
    )}
    ```

    **6. Thread `dynamicViews` to LayersModal** (locate `<LayersModal ...>`):

    ```tsx
    {showLayersModal && (
      <LayersModal
        layers={layers}
        associatedTables={associatedTables}
        dynamicViews={dynamicViews}                  // NEW Phase 35 — Plan 35-06 consumes
        onClose={handleLayersModalClose}
        onCreate={handleLayerCreate}
        onDelete={handleLayerDelete}
        onDuplicate={handleLayerDuplicate}
        onPatch={handleLayerPatch}
        onReorder={handleLayerReorder}
      />
    )}
    ```

    **7. Forward-compat note: WidgetConfigModal + LayersModal prop type extensions** — these modals' prop types must accept the new `dynamicViews` prop. Plan 35-04 (ChartConfigPanel) and Plan 35-06 (KineticaWmsLayerForm) own the picker-rendering downstream; for THIS plan, just add the prop with type `dynamicViews?: DynamicViewRow[]` (optional default `[]` if not passed, but DashboardsPage always passes it). If the modal types are strict, add the prop with default. Do NOT add picker JSX inside the modals here — that's Plans 35-04 and 35-06.

    ```typescript
    // WidgetConfigModal.tsx top:
    import { type DynamicViewRow } from "../api/client";

    type WidgetConfigModalProps = {
      widget: WidgetDto;
      tables: TableDto[];
      views: ViewRow[];
      dynamicViews?: DynamicViewRow[];               // NEW Phase 35 — default empty
      onSave: (config: ChartConfig) => void;
      onClose: () => void;
    };
    ```

    Likewise for `LayersModal.tsx`:

    ```typescript
    type LayersModalProps = {
      layers: DashboardLayerDto[];
      associatedTables: TableDto[];
      dynamicViews?: DynamicViewRow[];               // NEW Phase 35 — default empty
      onClose: () => void;
      onCreate: (...) => void;
      onDelete: (...) => void;
      onDuplicate: (...) => void;
      onPatch: (...) => void;
      onReorder: (...) => void;
    };
    ```

    Pass the prop through to ChartConfigPanel / KineticaWmsLayerForm in the modal body (no picker rendering yet — placeholder pass-through only). Plans 35-04 and 35-06 will consume these props.

    **8. Extend `DashboardsPage.spec.tsx`:**

    Mock `useDynamicViewMaterializeChain` to return `{ dynamicViews: [], retry: vi.fn() }`. Add tests:
    - Test 1: `useDynamicViewMaterializeChain` is called with `dashboard.id` when DashboardOpen renders.
    - Test 2 + 3: `WidgetConfigModal` and `LayersModal` receive `dynamicViews` prop (use spy or render-prop assertion).
    - Test 6: Existing lifecycle reset tests still pass (regression).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx src/components/DashboardContext.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "useDynamicViewMaterializeChain" kinetica_bi/src/components/DashboardsPage.tsx`
    - `grep -q "dynamicViews={dynamicViews}" kinetica_bi/src/components/DashboardsPage.tsx` (modal threading + context threading; ≥ 3 occurrences expected)
    - `grep -c "dynamicViews" kinetica_bi/src/components/DashboardsPage.tsx` returns ≥ 4 (import, hook destructure, context value, modal prop[s])
    - `grep -q "dynamicViews: DynamicViewRow\[\]" kinetica_bi/src/components/DashboardContext.tsx`
    - `grep -q "dynamicViews" kinetica_bi/src/components/DashboardContext.spec.tsx` (test extended)
    - `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx src/components/DashboardContext.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - Hook mounted at DashboardOpen scope
    - DashboardContext exposes `dynamicViews`
    - WidgetConfigModal and LayersModal receive `dynamicViews` prop (downstream plans render picker UI)
    - All existing DashboardsPage.spec.tsx + DashboardContext.spec.tsx tests still pass
    - tsc clean
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/hooks/ src/components/DashboardsPage.spec.tsx src/components/DashboardContext.spec.tsx` all pass
- `cd kinetica_bi && npx tsc --noEmit` clean
- Hook mounts ONCE per open dashboard (not in widget render loops)
- Cold-start gate verified: dashboard open WITHOUT prior filter does NOT fire any materializeDynamicView calls
- `dynamicViews` is the single source of truth for the dashboard's dynamic-view list across: orchestrator hook (cascade triggers), ChartConfigPanel (Plan 35-04 picker), KineticaWmsLayerForm/LayersModal (Plan 35-06 per-layer picker), renderer orphan detection (via DashboardContext — Plans 35-05/35-06)
</verification>

<success_criteria>
- Orchestrator hook implemented with all locked behaviors: per-id AbortController Map, cold-start gate, list refresh on dynamicViewVersion, silent AbortError, "error" toast on materialize failure, retry callback
- Hook mounted at DashboardsPage `DashboardOpen` scope
- DashboardContext extended with `dynamicViews: DynamicViewRow[]` (enables Plan 35-05/35-06 orphan detection)
- WidgetConfigModal and LayersModal receive `dynamicViews` prop (Plans 35-04 and 35-06 consume)
- All 17 hook spec tests + 6 integration tests passing
</success_criteria>

<output>
After completion, create `.planning/phases/35-widget-binding-and-pipeline/35-03-SUMMARY.md`.
</output>
