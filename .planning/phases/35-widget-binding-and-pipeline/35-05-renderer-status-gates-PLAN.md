---
phase: 35-widget-binding-and-pipeline
plan: 05
type: execute
wave: 3
depends_on:
  - "35-03"
files_modified:
  - kinetica_bi/src/components/charts/WidgetRenderer.tsx
  - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - DV-V16-13
  - DV-V16-14
must_haves:
  truths:
    - "AggregatedWidgetRenderer Effect 1 (filter-view materialize trigger) stays UNCHANGED — locked from research finding #2"
    - "AggregatedWidgetRenderer Effect 2 viewName source flips to useDynamicViewStore when dynamicViewId is set; falls back to useFilterViewStore otherwise"
    - "Effect 2's suspend-gate extends to dvStatus === 'pending' for dv-bound widgets (research finding #7 — prevents stale-viewName race during cascade)"
    - "Status-aware render: undefined/pending → loading skeleton; over_threshold → 'Too much data — narrow your filters to enable this view.' (ROADMAP verbatim, single message regardless of reason); error → inline error + Retry; materialized → fromSwap+runSql; orphan → 'This dynamic view was deleted. Reconfigure the widget.'"
    - "RecordsTableRenderer mirrors AggregatedWidget status branching; the renderer's own Effect 2 (page-fetch at line 1264 + count-fetch at 1316) also flips viewName source"
    - "Orphan detection uses DashboardContext.dynamicViews (Plan 35-03 added it) — renderer detects dynamicViewId set + no entry in store + not in dashboard's dv list"
    - "Retry button calls the orchestrator hook's retry(dynamicViewId) — surfaced via DashboardContext or directly imported (Claude's discretion lock — recommend via dedicated retry context)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.tsx"
      provides: "AggregatedWidget + RecordsTable dynamic-view branches (5 states + orphan)"
      contains: "useDynamicViewStore"
    - path: "kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx"
      provides: "5-state + orphan coverage for both AggregatedWidget and RecordsTable"
      contains: "over_threshold"
    - path: "kinetica_bi/src/styles/global.css"
      provides: "Empty-state classes for over-threshold + orphan-dynamic-view + error states"
      contains: "widget-over-threshold"
  key_links:
    - from: "AggregatedWidgetRenderer Effect 2"
      to: "useDynamicViewStore.views[dynamicViewId]"
      via: "scoped selector (PITFALL C-02)"
      pattern: "useDynamicViewStore\\(\\(s\\) =>"
    - from: "AggregatedWidgetRenderer render body status gates"
      to: "DV-V16-14 ROADMAP message"
      via: "over_threshold render branch"
      pattern: "Too much data"
    - from: "RecordsTableRenderer Effect 1 + page/count effects"
      to: "useDynamicViewStore.views[dynamicViewId]?.viewName"
      via: "scoped selector flip"
      pattern: "dynamicViewId"
    - from: "Renderer error state Retry button"
      to: "orchestrator hook's retry(dynamicViewId)"
      via: "DashboardContext retry function (added here)"
      pattern: "retry"
---

<objective>
Wire `useDynamicViewStore` into `AggregatedWidgetRenderer` and `RecordsTableRenderer` so that dv-bound widgets:
1. Read viewName from `useDynamicViewStore.views[dynamicViewId]` instead of `useFilterViewStore.views[tableId]`
2. Render five status-aware states (undefined/pending → loading skeleton; over_threshold → ROADMAP-verbatim empty state; error → inline error + Retry; materialized → fromSwap + runSql; orphan → "deleted" message)
3. Effect 2's suspend-gate extends to `dvStatus === "pending"` for dv-bound widgets (Pitfall 6 / research finding #7 — prevents stale-viewName race)

**Effect 1 stays UNCHANGED** (research finding #2 lock) — the filter-view materialize trigger still fires because the filter view is the `{view}` substitution source for the dynamic-view; orchestrator hook is downstream.

Purpose: Closes DV-V16-13 (renderer FROM-swap) + DV-V16-14 (over-threshold empty state) for the chart + records-table widget types. MapChartRenderer is handled in Plan 35-06.

Output: Extended `WidgetRenderer.tsx` (both renderers) + comprehensive status-coverage spec + CSS classes for new empty states.
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
@kinetica_bi/src/components/charts/WidgetRenderer.tsx
@kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx
@kinetica_bi/src/store/dynamicViewStore.ts
@kinetica_bi/src/store/filterViewStore.ts
@kinetica_bi/src/components/DashboardContext.tsx
@kinetica_bi/src/lib/fromSwap.ts
@kinetica_bi/src/styles/global.css

<interfaces>
<!-- Locked references from 35-CONTEXT.md §"Renderer integration" + 35-RESEARCH.md §"Example 1" + Pitfalls 4, 6 -->

From kinetica_bi/src/components/charts/WidgetRenderer.tsx (existing AggregatedWidgetRenderer at lines 224-500):
- cfg.tableId reads at line 232
- filterViewStore scoped selectors at lines 252-272
- Effect 1 (filter-view materialize trigger) at lines 314-376 — DO NOT TOUCH
- Effect 2 (fromSwap + runSql) at lines 390-500 — extend viewName source + status gates
- LIFE-V13-01 proactive expiry at line 395-400 (filter-view path — unchanged)
- LIFE-V13-02 reactive retry on view-not-found at end of runChartQuery
- materializing suspend-gate at line ~400
- retryRef tracking at lines ~404-410 (existing)

From kinetica_bi/src/components/charts/WidgetRenderer.tsx (existing RecordsTableRenderer at lines 1107-1342):
- cfg.tableId at lines 1140-1158
- Effect 1 (Phase 30 spatial materialize trigger) at lines 1212-1256 — DO NOT TOUCH
- Page-fetch Effect at line 1264 — uses `fromSource = viewName || table` (NOT fromSwap; raw concat at line 1294)
- Count-fetch Effect at line 1316

LOCKED scoped-selector pattern (35-CONTEXT.md §"Renderer integration" + research §"Pattern 2"):
```typescript
const dvEntry = useDynamicViewStore((s) =>
  dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined
);
const dvStatus = dvEntry?.status;
const dvViewName = dvEntry?.viewName;
const dvReason = dvEntry?.reason;
const dvError = dvEntry?.error;
```

LOCKED status → render mapping (35-CONTEXT.md §"Status-aware widget rendering"):
| Status | Render | Notes |
|--------|--------|-------|
| undefined / pending | Loading skeleton | Reuse existing v1.3 loading state |
| materialized | fromSwap(sql, dvViewName) → runSql | viewName from dv store |
| over_threshold | Inline empty state: "Too much data — narrow your filters to enable this view." | NO runSql. Single ROADMAP-verbatim message regardless of reason. |
| error | Inline error + Retry link | Retry calls orchestrator's retry(dynamicViewId) |
| Orphan (dvId set, no entry, not in dashboard's dv list) | "This dynamic view was deleted. Reconfigure the widget." | |

Pitfall 4 (35-RESEARCH.md:609-628) — defense-in-depth check after status gate:
```typescript
if (dvStatus === "materialized" && !dvViewName) return <error-internal />;
```

Pitfall 6 (35-RESEARCH.md:646-662) — cold-start UX: `undefined` + filter-view not yet materialized vs `undefined` + filter-view materialized but orchestrator hasn't fired yet. CONTEXT.md's current locked render mapping treats both as "loading skeleton" — this plan honors that (SIMPLE mapping). If UAT surfaces issues, follow-up adds an "Apply a filter" hint for the cold-start case.

Suspend-gate extension (research finding #7): Effect 2's existing `if (materializing) return;` extends to `if (materializing || dvStatus === "pending") return;` for dv-bound widgets. Prevents stale-viewName race during cascade.

Toast taxonomy lock: ToastKind = "permission" | "info" | "error" — no "warning". Renderer Retry button doesn't toast (orchestrator's retry call may toast on subsequent failure).

DashboardContext extension (Plan 35-03 added `dynamicViews: DynamicViewRow[]`):
```typescript
const { dashboardId, widgets, dynamicViews } = useDashboardContext();
const isOrphan = dynamicViewId !== undefined && dvEntry === undefined &&
                 !dynamicViews.some((dv) => dv.id === dynamicViewId);
```

CRITICAL: Retry function source — Claude's discretion (35-CONTEXT.md). RECOMMEND: Add `retryDynamicView` to DashboardContext (already passed at the DashboardOpen level by Plan 35-03's hook return) so renderers don't need to import the orchestrator hook directly. Plan 35-03 already mounts the hook in DashboardOpen and destructures `retry: retryDynamicView`. This plan extends DashboardContext to expose it.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend AggregatedWidgetRenderer + RecordsTableRenderer with status-aware dynamic-view branches; add Retry context</name>
  <files>kinetica_bi/src/components/charts/WidgetRenderer.tsx, kinetica_bi/src/components/DashboardContext.tsx, kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (FULL — AggregatedWidgetRenderer at 224-500; RecordsTableRenderer at 1107-1342; pay attention to Effect 1 boundaries — DO NOT TOUCH lines 314-376 for AggregatedWidget; DO NOT TOUCH lines 1212-1256 for RecordsTable)
    - kinetica_bi/src/store/dynamicViewStore.ts (FULL — Phase 33 entry shape, status union)
    - kinetica_bi/src/store/filterViewStore.ts (Phase 14 — existing scoped selectors at lines 52-129 for reference pattern)
    - kinetica_bi/src/lib/fromSwap.ts (verify the falsy-viewName guard at line 22 — fromSwap(sql, "") returns sql unchanged)
    - kinetica_bi/src/components/DashboardContext.tsx (Plan 35-03 just added dynamicViews; this plan adds retryDynamicView)
    - kinetica_bi/src/components/DashboardsPage.tsx (verify orchestrator hook returns `retry`; thread it through DashboardContext)
    - kinetica_bi/src/styles/global.css (FULL — locate existing widget-placeholder + widget-error classes; add new namespace)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"Renderer integration", §"Status-aware widget rendering" — verbatim render table)
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Example 1" verbatim; §"Pitfall 4" defense-in-depth; §"Pitfall 6" cold-start; §"Open Question 2" suspend-gate)
  </read_first>
  <behavior>
    See Task 2 for full behavioral coverage. Implementation behaviors enforced:

    - Effect 1 in AggregatedWidget is verifiably UNCHANGED (no edits to lines 314-376; `git diff` should show NO changes inside that block)
    - Effect 2 reads `effectiveViewName = dynamicViewId !== undefined ? dvViewName : fvViewName`
    - Effect 2's suspend-gate becomes `if (materializing || (dynamicViewId !== undefined && dvStatus === "pending")) return;`
    - Render body has a NEW set of status gates BEFORE the existing render switch (for dv-bound widgets): undefined/pending → loading; over_threshold → empty state; error → error+retry; orphan → orphan empty state; materialized → fall through to existing render
    - RecordsTableRenderer's page-fetch Effect (line 1264) and count-fetch Effect (line 1316) BOTH flip viewName source (mirror Effect 2 logic)
    - RecordsTableRenderer render body has the same status gates
    - DashboardContext now exposes `retryDynamicView: (id: number) => void`
    - Renderer's Retry button calls `retryDynamicView(dynamicViewId)`
  </behavior>
  <action>
    **1. Extend `DashboardContext.tsx` to expose `retryDynamicView`:**

    ```typescript
    export type DashboardContextValue = {
      dashboardId: number;
      widgets: WidgetDto[];
      dynamicViews: DynamicViewRow[];                        // Plan 35-03 added
      retryDynamicView: (dynamicViewId: number) => void;     // NEW Phase 35 Plan 35-05
    };

    // Default fallback:
    const DashboardContext = React.createContext<DashboardContextValue>({
      dashboardId: 0,
      widgets: [],
      dynamicViews: [],
      retryDynamicView: () => { /* no-op default */ },
    });
    ```

    Extend the provider signature:

    ```typescript
    export const DashboardContextProvider: React.FC<{
      dashboardId: number;
      widgets: WidgetDto[];
      dynamicViews: DynamicViewRow[];
      retryDynamicView: (dynamicViewId: number) => void;       // NEW
      children: React.ReactNode;
    }> = ({ dashboardId, widgets, dynamicViews, retryDynamicView, children }) => {
      const value = useMemo(
        () => ({ dashboardId, widgets, dynamicViews, retryDynamicView }),
        [dashboardId, widgets, dynamicViews, retryDynamicView],
      );
      return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
    };
    ```

    **2. Update `DashboardsPage.tsx` to pass `retryDynamicView` into the provider:**

    Plan 35-03 already destructures `{ dynamicViews, retry: retryDynamicView }` from `useDynamicViewMaterializeChain`. Update the existing `<DashboardContextProvider>` mount:

    ```tsx
    <DashboardContextProvider
      dashboardId={dashboard.id}
      widgets={widgets}
      dynamicViews={dynamicViews}
      retryDynamicView={retryDynamicView}                    // NEW Phase 35 Plan 35-05
    >
      {/* existing children */}
    </DashboardContextProvider>
    ```

    **3. Extend `AggregatedWidgetRenderer` in `WidgetRenderer.tsx` (lines 224-500):**

    Apply changes near existing `cfg.tableId` read (line 232) and BEFORE Effect 1 (line 314):

    ```typescript
    const AggregatedWidgetRenderer = ({ widget }: Props) => {
      const cfg = widget.config ?? {};
      const sql = cfg.sql as string | undefined;
      const tableId = cfg.tableId as number | undefined;
      // NEW Phase 35 (DV-V16-13): dynamic-view binding
      const dynamicViewId = cfg.dynamicViewId as number | undefined;

      // ... existing drillDownColumn, drillDownColumnType, tableFilters, filterVersion declarations ...
      // ... existing materializing, clearMaterializingVersion declarations ...

      // EXISTING filter-view scoped selectors (lines 252-272) — UNCHANGED
      const fvViewName = useFilterViewStore((s) =>
        tableId !== undefined ? s.views[tableId]?.viewName : undefined
      );
      const fvExpiresAt = useFilterViewStore((s) =>
        tableId !== undefined ? s.views[tableId]?.expiresAt ?? 0 : 0
      );

      // NEW Phase 35: scoped selectors to useDynamicViewStore (PITFALL C-02)
      const dvEntry = useDynamicViewStore((s) =>
        dynamicViewId !== undefined ? s.views[dynamicViewId] : undefined
      );
      const dvStatus = dvEntry?.status;
      const dvViewName = dvEntry?.viewName;
      const dvError = dvEntry?.error;
      // dvReason intentionally omitted — over_threshold message is single ROADMAP-verbatim regardless

      // NEW Phase 35: orphan detection via DashboardContext
      const { dynamicViews: dashboardDynamicViews, retryDynamicView } = useDashboardContext();
      const isOrphan =
        dynamicViewId !== undefined &&
        dvEntry === undefined &&
        !dashboardDynamicViews.some((dv) => dv.id === dynamicViewId);

      // ... existing dashboardId, widgets, targetsByTable, myTarget, spatialFilterVersion declarations ...

      // EXISTING Effect 1 — UNCHANGED (locked from research finding #2)
      // CONTEXT.md: "Effect 1 stays unchanged (still fires filter-view materialize)"
      // ... lines 314-376 verbatim — DO NOT MODIFY ...

      // EXTENDED Effect 2 (chart-query)
      useEffect(() => {
        if (!sql?.trim()) {
          setData([]);
          return;
        }

        // EXISTING filter-view suspend gate UNCHANGED
        if (materializing) return;

        // NEW Phase 35: extend suspend-gate to dvStatus === "pending" for dv-bound widgets (research finding #7)
        if (dynamicViewId !== undefined && dvStatus === "pending") return;

        // EXISTING LIFE-V13-01 proactive expiry — applies only to filter-view path
        if (dynamicViewId === undefined && fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt && tableId !== undefined) {
          useFilterViewStore.getState().clearView(tableId);
          return;
        }

        // NEW Phase 35: status-aware short-circuits for dv-bound widgets (BEFORE the runQuery branch)
        let effectiveViewName: string | undefined;
        if (dynamicViewId !== undefined) {
          if (dvStatus === undefined || dvStatus === "pending") {
            // Already gated above; defense-in-depth — short-circuit any further work.
            setData([]);
            setLoading(true);
            setError(null);
            return;
          }
          if (dvStatus === "over_threshold") {
            setData([]);
            setLoading(false);
            setError(null);
            return;  // Render body's status gate handles the empty-state JSX
          }
          if (dvStatus === "error") {
            setData([]);
            setLoading(false);
            setError(dvError ?? "Dynamic view materialize failed");
            return;
          }
          // dvStatus === "materialized"
          // PITFALL 4 (35-RESEARCH.md:609-628): defense-in-depth on empty viewName
          if (!dvViewName) {
            setData([]);
            setLoading(false);
            setError("Internal error: materialized dynamic view has no viewName");
            return;
          }
          effectiveViewName = dvViewName;
        } else {
          // EXISTING filter-view path
          effectiveViewName = fvViewName;
        }

        // EXISTING retry budget reset on viewName change
        if (retryRef.current.viewName !== effectiveViewName) {
          retryRef.current = { viewName: effectiveViewName, retried: false };
        }

        // EXISTING fromSwap + runSql + LIFE-V13-02 reactive retry — call shape unchanged.
        // NOTE: use `||` (NOT `??`) — Pitfall 4 lock — so empty-string fall-through behaves correctly.
        const controller = new AbortController();
        const finalSql = fromSwap(sql, effectiveViewName);
        // ... rest of runChartQuery body unchanged ...
        setLoading(true);
        setError(null);

        const runChartQuery = async (sqlToRun: string): Promise<void> => {
          // ... existing body unchanged ...
        };
        runChartQuery(finalSql).finally(() => setLoading(false));
        return () => controller.abort();
        // PITFALL S-02: new primitives in deps — dynamicViewId, dvStatus, dvViewName.
        // dvEntry NOT in deps (unstable reference); primitives are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sql, filterVersion, fvViewName, fvExpiresAt, clearMaterializingVersion,
          dynamicViewId, dvStatus, dvViewName]);

      // ... existing render gates (loading/error/data.length === 0) ...

      // NEW Phase 35 render gates — INSERT BEFORE existing data.length check:

      // Orphan check first (highest priority — dv reference dangling)
      if (isOrphan) {
        return (
          <div className="widget-placeholder widget-orphan-dynamic-view">
            <span>This dynamic view was deleted. Reconfigure the widget.</span>
          </div>
        );
      }

      if (dynamicViewId !== undefined) {
        if (dvStatus === undefined || dvStatus === "pending") {
          // Loading skeleton — reuse existing widget loading UI
          return (
            <div className="widget-placeholder widget-loading">
              <span>Loading...</span>
            </div>
          );
        }
        if (dvStatus === "over_threshold") {
          return (
            <div className="widget-placeholder widget-over-threshold">
              <span>Too much data — narrow your filters to enable this view.</span>
            </div>
          );
        }
        if (dvStatus === "error") {
          return (
            <div className="widget-placeholder widget-error">
              <span>{dvError ?? "Dynamic view materialize failed"}</span>
              <button
                type="button"
                className="widget-retry-btn"
                onClick={() => retryDynamicView(dynamicViewId)}
              >
                Retry
              </button>
            </div>
          );
        }
        // dvStatus === "materialized" → fall through to existing render switch
      }

      // ... existing render switch (chart type, data, etc.) ...
    };
    ```

    **4. Apply parallel changes to `RecordsTableRenderer` at lines 1107-1342:**

    Mirror the AggregatedWidget changes for:
    - `cfg.dynamicViewId` read (alongside `cfg.tableId`)
    - dvEntry scoped selectors (status / viewName / error)
    - DashboardContext orphan + retry consumption
    - Effect 1 (lines 1212-1256) — UNCHANGED
    - Page-fetch Effect (line 1264): viewName source flip + suspend gate + status short-circuits. `fromSource = viewName || table` becomes `fromSource = effectiveViewName || table` where effectiveViewName is the dv-aware resolved name.
    - Count-fetch Effect (line 1316): same viewName source flip + suspend gate + status short-circuits.
    - Render body status gates BEFORE existing render — identical 5-state + orphan block as AggregatedWidget.

    **5. Add CSS classes in `kinetica_bi/src/styles/global.css`:**

    Locate the existing widget-placeholder block. Add new namespaced classes (or reuse if generic classes exist):

    ```css
    /* Phase 35 (DV-V16-13/14): dynamic-view empty + error states */
    .widget-over-threshold {
      /* Center the message; use a subtle warning visual (no red — it's informational) */
      color: #6b6b6b;
      text-align: center;
      padding: 24px;
    }
    .widget-over-threshold::before {
      content: "⚠";                                /* Or use FontAwesome if existing classes mount it */
      display: inline-block;
      margin-right: 8px;
      font-size: 1.2em;
    }

    .widget-orphan-dynamic-view {
      color: #6b6b6b;
      text-align: center;
      padding: 24px;
      font-style: italic;
    }

    .widget-error {
      color: #c62828;
      text-align: center;
      padding: 24px;
    }
    .widget-retry-btn {
      margin-top: 8px;
      padding: 4px 12px;
      background: transparent;
      border: 1px solid #c62828;
      color: #c62828;
      border-radius: 4px;
      cursor: pointer;
    }
    .widget-retry-btn:hover {
      background: #c62828;
      color: white;
    }
    ```

    Reuse existing widget-placeholder + widget-loading classes if present (don't redefine). The over-threshold + orphan + error variants should compose with `widget-placeholder` (e.g., `<div className="widget-placeholder widget-over-threshold">`).

    **6. Verify Effect 1 in BOTH renderers is UNCHANGED:**

    After all edits, do a final pass:
    - AggregatedWidget: lines 314-376 should have ZERO modifications (no new deps, no new logic). The Effect 1 block remains the sole filter-view materialize trigger.
    - RecordsTable: lines 1212-1256 should have ZERO modifications.

    This is the research finding #2 lock. If any change leaks in (e.g., adding `dvStatus` to a dep array), the orchestrator could double-fire materialize. Acceptance criteria includes a `grep -A 5 "Effect 1"` style check.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "useDynamicViewStore" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns ≥ 2 (AggregatedWidget + RecordsTable scoped selectors)
    - `grep -q "dynamicViewId" kinetica_bi/src/components/charts/WidgetRenderer.tsx`
    - `grep -q "Too much data — narrow your filters to enable this view" kinetica_bi/src/components/charts/WidgetRenderer.tsx` (DV-V16-14 ROADMAP-verbatim message)
    - `grep -q "This dynamic view was deleted" kinetica_bi/src/components/charts/WidgetRenderer.tsx` (orphan message)
    - `grep -q "retryDynamicView" kinetica_bi/src/components/charts/WidgetRenderer.tsx` (Retry binding)
    - `grep -q "retryDynamicView" kinetica_bi/src/components/DashboardContext.tsx` (context exposes retry)
    - `grep -q "dvStatus === \"pending\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` (suspend-gate extension — research finding #7)
    - `grep -q "isOrphan" kinetica_bi/src/components/charts/WidgetRenderer.tsx` (orphan detection)
    - `grep -q ".widget-over-threshold" kinetica_bi/src/styles/global.css` (CSS class)
    - `grep -q ".widget-orphan-dynamic-view" kinetica_bi/src/styles/global.css`
    - `! grep -q "\"warning\"" kinetica_bi/src/components/charts/WidgetRenderer.tsx` (forbidden toast kind absent)
    - Effect 1 regression — `grep -c "spatialFilterVersion" kinetica_bi/src/components/charts/WidgetRenderer.tsx` returns the SAME count as before the edit (no new deps added to Effect 1)
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - Both AggregatedWidget and RecordsTable read dynamicViewId
    - Both renderers' Effect 2 (chart-query / page-fetch / count-fetch) viewName source flips
    - Suspend-gate extends to dvStatus === "pending" (research finding #7)
    - Render body status gates: orphan → loading → over_threshold → error → fall-through-to-materialized
    - Effect 1 in both renderers verifiably UNCHANGED (locked from research finding #2)
    - DashboardContext exposes retryDynamicView
    - CSS classes added
    - tsc clean
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend WidgetRenderer.spec.tsx with status-aware coverage for both AggregatedWidget and RecordsTable</name>
  <files>kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (FULL — existing AggregatedWidget + RecordsTable test fixtures + render harness)
    - kinetica_bi/src/components/charts/WidgetRenderer.tsx (just-modified file — pickup the locked JSX shapes for assertion text)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"Test coverage scope" items 3, 4)
  </read_first>
  <behavior>
    Spec coverage (both AggregatedWidget AND RecordsTable — duplicate per renderer):

    **AggregatedWidget tests:**
    - Test 1: widget.config.dynamicViewId set + useDynamicViewStore.views[id] undefined → renders loading skeleton.
    - Test 2: ...store.views[id].status = "pending" → loading skeleton.
    - Test 3: ...store.views[id].status = "materialized" + viewName = "_kbi_dv_..." → fromSwap fires with that viewName; runSql is called (mock `runSql` to capture the SQL string — assert it contains the dv viewName).
    - Test 4: ...store.views[id].status = "over_threshold" → renders "Too much data — narrow your filters to enable this view." (exact verbatim); NO runSql.
    - Test 5: ...store.views[id].status = "error" + error = "boom" → renders error + Retry button. Clicking Retry calls the retryDynamicView context function with the dynamicViewId.
    - Test 6: widget.config.dynamicViewId = 99 + store.views[99] undefined + DashboardContext.dynamicViews does NOT contain id 99 → renders orphan "This dynamic view was deleted. Reconfigure the widget."
    - Test 7: dynamicViewId is undefined (legacy widget) → renderer behavior UNCHANGED (uses fvViewName from filterViewStore; existing fromSwap path).
    - Test 8 (Effect 1 regression): When dynamicViewId is set and dvStatus transitions from pending → materialized, Effect 1's `materializeFilter` is called EXACTLY ONCE (not retriggered by dvStatus changes — verifies Effect 1 dep array NOT changed).
    - Test 9 (suspend-gate): When dvStatus === "pending", Effect 2 does NOT call runSql even if all other conditions (sql present, filterView ready) are met.

    **RecordsTable tests** (mirror Tests 1-7 above for RecordsTableRenderer):
    - Test 10: dynamicViewId + store entry undefined → loading.
    - Test 11: dynamicViewId + materialized → page-fetch + count-fetch both use the dv viewName.
    - Test 12: dynamicViewId + over_threshold → "Too much data..." empty state; NO page fetch, NO count fetch.
    - Test 13: dynamicViewId + error → error + Retry.
    - Test 14: dynamicViewId + orphan (not in dashboardContext.dynamicViews) → orphan message.
    - Test 15: dynamicViewId + pagination still works on materialized (assert subsequent page click fires a new page-fetch with the dv viewName + correct LIMIT/OFFSET).
  </behavior>
  <action>
    Open `WidgetRenderer.spec.tsx`. Add two new `describe` blocks at the end:

    ```typescript
    describe("AggregatedWidgetRenderer — Phase 35 dynamic-view branches (DV-V16-13/14)", () => {
      const mockDashboardDynamicViews = [
        { id: 7, dashboard_id: 1, source_table_id: 4, name: "Top vendors", template_sql: "SELECT * FROM {view}", max_records: 10000, columns_json: [], created_at: "x", updated_at: "x" },
      ];

      function renderWithDvContext(widget: WidgetDto, options: {
        dvEntry?: DynamicViewEntry | undefined;
        dynamicViews?: DynamicViewRow[];
        retryDynamicView?: ReturnType<typeof vi.fn>;
      } = {}) {
        if (options.dvEntry) {
          // Phase 33 actions to set state imperatively for the test:
          useDynamicViewStore.getState().setView(7, options.dvEntry);
        }
        return render(
          <DashboardContextProvider
            dashboardId={1}
            widgets={[widget]}
            dynamicViews={options.dynamicViews ?? mockDashboardDynamicViews}
            retryDynamicView={options.retryDynamicView ?? vi.fn()}
          >
            <AggregatedWidgetRenderer widget={widget} />
          </DashboardContextProvider>
        );
      }

      const dvBoundWidget: WidgetDto = {
        // ... existing aggregated widget shape ...
        config: { sql: "SELECT * FROM x", tableId: 4, tableRef: "demo.taxi", dynamicViewId: 7 },
      };

      it("renders loading skeleton when dvStatus undefined", () => {
        renderWithDvContext(dvBoundWidget);
        // No store entry → undefined status
        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
      });

      it("renders loading skeleton when dvStatus = pending", () => {
        renderWithDvContext(dvBoundWidget, {
          dvEntry: { viewName: "_kbi_dv_u1_d1_7", status: "pending" },
        });
        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
      });

      it("calls fromSwap+runSql with dv viewName when materialized", async () => {
        const runSqlSpy = vi.spyOn(/* ... */);
        renderWithDvContext(dvBoundWidget, {
          dvEntry: { viewName: "_kbi_dv_u1_d1_7", status: "materialized", expiresAt: 9999 },
        });
        await waitFor(() => expect(runSqlSpy).toHaveBeenCalled());
        const sqlArg = runSqlSpy.mock.calls[0][0] as string;
        expect(sqlArg).toContain("_kbi_dv_u1_d1_7");
      });

      it("renders DV-V16-14 verbatim over-threshold empty state (no runSql)", () => {
        const runSqlSpy = vi.spyOn(/* ... */);
        renderWithDvContext(dvBoundWidget, {
          dvEntry: { viewName: "_kbi_dv_u1_d1_7", status: "over_threshold", reason: "exceeds_max_records" },
        });
        expect(screen.getByText("Too much data — narrow your filters to enable this view.")).toBeInTheDocument();
        expect(runSqlSpy).not.toHaveBeenCalled();
      });

      it("renders error state with Retry button calling retryDynamicView(id)", async () => {
        const retrySpy = vi.fn();
        renderWithDvContext(dvBoundWidget, {
          dvEntry: { viewName: "_kbi_dv_u1_d1_7", status: "error", error: "boom" },
          retryDynamicView: retrySpy,
        });
        expect(screen.getByText(/boom/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /retry/i }));
        expect(retrySpy).toHaveBeenCalledWith(7);
      });

      it("renders orphan empty state when dvId set, no store entry, not in dashboard list", () => {
        const orphanWidget: WidgetDto = {
          ...dvBoundWidget,
          config: { ...dvBoundWidget.config, dynamicViewId: 99 },     // 99 not in mockDashboardDynamicViews
        };
        renderWithDvContext(orphanWidget, { dynamicViews: mockDashboardDynamicViews });
        expect(screen.getByText("This dynamic view was deleted. Reconfigure the widget.")).toBeInTheDocument();
      });

      it("legacy widget (no dynamicViewId) behaves unchanged — uses filter-view path", async () => {
        const legacy: WidgetDto = { ...dvBoundWidget, config: { sql: "SELECT * FROM x", tableId: 4, tableRef: "demo.taxi" } };
        // Setup filterViewStore.views[4]
        useFilterViewStore.getState().setView(4, { viewName: "_kbi_filt_x", status: "created", expiresAt: 9999, materializeVersion: 1 });
        const runSqlSpy = vi.spyOn(/* ... */);
        renderWithDvContext(legacy);
        await waitFor(() => expect(runSqlSpy).toHaveBeenCalled());
        const sqlArg = runSqlSpy.mock.calls[0][0] as string;
        expect(sqlArg).toContain("_kbi_filt_x");
      });

      it("Effect 1 regression: materializeFilter NOT re-fired by dvStatus changes", async () => {
        const materializeFilterSpy = vi.spyOn(/* ... */);
        const { rerender } = renderWithDvContext(dvBoundWidget, {
          dvEntry: { viewName: "_kbi_dv_x", status: "pending" },
        });
        const initialCallCount = materializeFilterSpy.mock.calls.length;

        // Transition dv to materialized — should NOT cause Effect 1 to fire again
        act(() => useDynamicViewStore.getState().setView(7, {
          viewName: "_kbi_dv_x", status: "materialized", expiresAt: 9999,
        }));

        // Effect 1 deps: [sql, filterVersion, dashboardId, tableId, spatialFilterVersion]
        // None of these changed → no new materializeFilter call.
        expect(materializeFilterSpy.mock.calls.length).toBe(initialCallCount);
      });

      it("suspend-gate: runSql NOT called when dvStatus = pending even if all else ready", async () => {
        const runSqlSpy = vi.spyOn(/* ... */);
        // Setup filterViewStore so that materializing is false AND filter-view is ready
        useFilterViewStore.getState().setView(4, { viewName: "_kbi_filt_x", status: "created", expiresAt: 9999, materializeVersion: 1 });
        renderWithDvContext(dvBoundWidget, {
          dvEntry: { viewName: "_kbi_dv_x", status: "pending" },
        });
        // Give effects time to run
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(runSqlSpy).not.toHaveBeenCalled();
      });
    });

    describe("RecordsTableRenderer — Phase 35 dynamic-view branches (DV-V16-13/14)", () => {
      // ... mirror the same 6 main tests (loading/materialized/over_threshold/error/orphan + pagination) ...
    });
    ```

    For mocks: read the existing WidgetRenderer.spec.tsx for the canonical way to spy on `runSql` / `runQuery` / `materializeFilter`. Use the same approach for consistency. The exact mock setup depends on the existing test infrastructure (likely `vi.mock("../../api/client", ...)`).

    For RecordsTable's pagination test (Test 15), use the existing pagination test as a template; just bind to a dv-materialized state and assert the page-fetch URL contains the dv viewName.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "Phase 35 dynamic-view branches" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
    - `grep -q "Too much data — narrow your filters to enable this view" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
    - `grep -q "This dynamic view was deleted" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
    - `grep -q "Effect 1 regression" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx`
    - `grep -q "suspend-gate" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` (or "pending.*runSql.*not called" — adapt to test naming)
    - `grep -c "useDynamicViewStore.getState" kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` returns ≥ 5 (multiple tests imperatively set store state)
    - `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx` exits 0
    - All previous WidgetRenderer tests still pass (regression)
  </acceptance_criteria>
  <done>
    - 9 tests for AggregatedWidget + 6 tests for RecordsTable covering all 5 status states + orphan + Effect 1 regression + suspend-gate
    - Verbatim ROADMAP text asserted in over-threshold test
    - Retry interaction asserts retryDynamicView called with correct id
    - Effect 1 regression test catches accidental dep-array bloat
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/DashboardContext.spec.tsx src/components/DashboardsPage.spec.tsx` passes
- `cd kinetica_bi && npx tsc --noEmit` clean
- Effect 1 in both renderers verifiably unchanged (research finding #2 lock — `grep` regression test)
- Effect 2's suspend-gate extends to `dvStatus === "pending"` (research finding #7)
- Render body status gates handle 5 states + orphan (DV-V16-13 + DV-V16-14)
- Retry button wires through DashboardContext to orchestrator hook's retry function
</verification>

<success_criteria>
- AggregatedWidgetRenderer and RecordsTableRenderer both branch on `cfg.dynamicViewId`
- viewName source flips to `useDynamicViewStore.views[dynamicViewId]?.viewName` when set
- Effect 1 in both renderers UNCHANGED (locked from research finding #2)
- Effect 2 suspend-gate extends to `dvStatus === "pending"` (research finding #7)
- Render body: 5-state status branch + orphan branch
- DV-V16-14 message rendered verbatim from ROADMAP
- Retry button calls `retryDynamicView` via DashboardContext (sourced from orchestrator hook)
- No `"warning"` toast kind anywhere (locked Phase 34 research)
</success_criteria>

<output>
After completion, create `.planning/phases/35-widget-binding-and-pipeline/35-05-SUMMARY.md`.
</output>
