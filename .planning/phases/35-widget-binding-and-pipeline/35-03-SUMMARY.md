---
phase: 35-widget-binding-and-pipeline
plan: 03
subsystem: ui

tags: [react, zustand, hook, abortcontroller, dynamic-views, orchestrator, tdd, vitest]

# Dependency graph
requires:
  - phase: 33-dynamic-view-store
    provides: "useDynamicViewStore (markPending, setView, setError) + dynamicViewVersion + buildDynamicViewName + listDynamicViews/materializeDynamicView client helpers + 3-branch MaterializeDynamicViewResponse"
  - phase: 14-filter-view-store
    provides: "useFilterViewStore.views[T].materializeVersion — primitive bump signal the orchestrator subscribes to"
  - phase: 34-dynamic-view-ui
    provides: "ToastKind locked union (permission | info | error) + DynamicViewsModal materialize-on-save pattern the orchestrator mirrors for cascades"
provides:
  - "useDynamicViewMaterializeChain(dashboardId) hook — dashboard-scope orchestrator (single instance per open dashboard)"
  - "Per-dv AbortController Map (useRef<Map<number, AbortController>>) — cross-dv isolation, rapid-filter-change dedup"
  - "Per-dv last-seen matVer tracking — prevents re-firing cascades when unrelated source-tables bump"
  - "Cold-start gate (matVer undefined || matVer === 0) — Pitfall 1 lock; no materialize flood on dashboard mount"
  - "Pitfall 2 cleanup — controllers + last-seen entries pruned for dvs removed from the list"
  - "Late-rejection guard — silences AbortError and unmount-during-rejection races"
  - "DashboardContext extended with dynamicViews: DynamicViewRow[] (required) — orphan detection surface for Plan 35-05"
  - "WidgetConfigModal + LayersModal prop conduits for dynamicViews — Plan 35-04/35-06 will render pickers"
affects: [35-04-chartconfig-picker, 35-05-aggregated-renderer-and-records, 35-06-map-renderer-and-layer-picker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dashboard-scope orchestrator hook (NEW for v1.6) — divergence from v1.3 sole-renderer-trigger because cascade is per-source-table-materialize, not per-widget"
    - "Per-id AbortController Map (useRef<Map<id, AbortController>>) for parallel async dedup with cross-id isolation"
    - "Per-id last-seen-version ref pattern: react-effect-graph fires on key change, but per-id guard prevents cross-key fan-out"
    - "Late-rejection guard: ctrl.signal.aborted check at catch entry covers both native AbortError and unmount race"
    - "Stable primitive key for selector subscription (sorted-and-joined Record<id,version> → string) — PITFALL S-02 carry-forward"

key-files:
  created:
    - "kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts (orchestrator hook implementation — 170 LOC)"
    - "kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts (17 spec cases — 555 LOC)"
  modified:
    - "kinetica_bi/src/components/DashboardContext.tsx (DynamicViewRow import + dynamicViews required field + useMemo on value)"
    - "kinetica_bi/src/components/DashboardContext.spec.tsx (3 new Phase 35 cases + dynamicViews={[]} on 6 existing fixtures)"
    - "kinetica_bi/src/components/DashboardsPage.tsx (hook import + mount in DashboardOpen + thread to provider + WidgetConfigModal + LayersModal)"
    - "kinetica_bi/src/components/DashboardsPage.spec.tsx (api/client mock extended + LayersModal mock + 3 new Phase 35 test cases)"
    - "kinetica_bi/src/components/LayersModal.tsx (LayersModalProps gains dynamicViews?: DynamicViewRow[])"
    - "kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx (1 fixture: dynamicViews={[]})"
    - "kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx (wrap helper signature: dynamicViews default [])"

key-decisions:
  - "Per-dv last-seen-matVer ref (useRef<Map<number, number>>) added on top of the locked AbortController Map — research skeleton said 'tracking last seen per-id is unnecessary' but T7 (cross-dv isolation) requires it. Without the guard, bumping table B's matVer re-fires every dv on table A. With the guard, only dvs whose own source-table matVer changed will re-fire."
  - "retry(id) calls fireCascade with force=true so the renderer's Retry button always re-attempts regardless of last-seen matVer or cold-start gate — AbortController dedup still applies so rapid retry-clicks don't pile."
  - "Late-rejection guard: catch returns early when ctrl.signal.aborted is true OR when err.name === 'AbortError'. Covers both the native fetch AbortError shape AND the race where unmount aborts the controller between materializeDynamicView's invocation and its rejection's microtask."
  - "DashboardContext.dynamicViews is REQUIRED (not optional with default []). Mirrors the Phase 30 widgets-required lock — missing-context errors are loud at compile time. Fixtures pay the per-test cost of `dynamicViews={[]}` (5 fixture updates) for compile-time honesty."
  - "WidgetConfigModal + LayersModal prop dynamicViews is OPTIONAL with `[]` default — these modals' downstream consumers (ChartConfigPanel, KineticaWmsLayerForm) ship in Plans 35-04/35-06; the optional prop keeps existing test fixtures (LayersModal.spec.tsx) compile-clean without forcing them to learn the new prop until those plans ship."
  - "Toast call doc-comments AVOID the literal string 'warning' — acceptance criterion's `! grep -q '\"warning\"'` is satisfied by referencing the Phase 34 ToastKind union ('permission' | 'info' | 'error') by enumeration rather than naming the forbidden kind. Keeps the grep gate trivial and unambiguous."

patterns-established:
  - "Pattern 1: dashboard-scope orchestrator hook with primitive matVersionKey + per-id AbortController Map + per-id last-seen-version ref. Reusable template for any future cascade-on-bump pattern."
  - "Pattern 2: stable primitive-string key for Zustand selector subscription — `sorted(ids).map(id => `${id}:${state.views[id]?.version ?? 0}`).join(',')`. Selector identity is stable when underlying versions don't change; effect dep is the primitive string."
  - "Pattern 3: retry-with-force semantics — the public retry() ignores last-seen guards while still using the AbortController Map for dedup. Renderer Retry buttons (Plan 35-05) always re-fire even when nothing has 'changed'."

requirements-completed: [DV-V16-13]

# Metrics
duration: 16min
completed: 2026-05-15
---

# Phase 35 Plan 03: Orchestrator Hook + DashboardContext Threading Summary

**Dashboard-scope `useDynamicViewMaterializeChain` hook with per-dv AbortController Map, cold-start gate, late-rejection guard, and per-dv last-seen-matVer tracking — mounted once at DashboardOpen, threading the dynamicViews list through DashboardContext + WidgetConfigModal + LayersModal for Wave 3 picker rendering.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-15T16:48:50Z
- **Completed:** 2026-05-15T17:05:33Z
- **Tasks:** 2 (both TDD: 4 atomic commits — 2 test + 2 feat)
- **Files modified:** 7 (2 created + 5 modified)
- **Tests added:** 23 new cases (17 hook + 3 context + 3 DashboardsPage)
- **Full frontend suite after change:** 920/920 pass (44 test files)

## Accomplishments

- **Orchestrator hook implemented** — `useDynamicViewMaterializeChain(dashboardId)` returns `{ dynamicViews, retry(id) }`. Subscribes to filter-view materializeVersion per unique source-table referenced by the dashboard's dvs and cascades markPending → materializeDynamicView → setView/setError per dv.
- **All 6 critical locks honored**:
  1. Cold-start gate (Pitfall 1): `matVer === undefined || matVer === 0` → no fire on dashboard mount.
  2. Per-dv AbortController Map: cross-dv isolation, rapid-filter-change dedup per id.
  3. Cascade sequence: exactly the Phase 33 contract (markPending → setView/setError, kind="error" toast on failure).
  4. Dynamic-view list source: single mount-fetch via `listDynamicViews`, refreshes on `dynamicViewVersion` increment.
  5. Hook return signature: `{ dynamicViews, retry: (id) => void }`.
  6. Mount site: `DashboardsPage.DashboardOpen` body, single instance per open dashboard.
- **DashboardContext extended** with `dynamicViews: DynamicViewRow[]` as required field (Phase 30 widgets-required pattern preserved).
- **17 hook spec cases** cover every locked behavior: cold-start, cascade fan-out, cross-dv isolation, per-id abort, 3-branch response handling, AbortError silence, list refresh, unmount cleanup, Pitfall 2 prune, retry, no-username defensive path.
- **3 context spec cases** cover dynamicViews exposure, empty default, reference stability.
- **3 DashboardsPage spec cases** cover hook mount (listDynamicViews call), LayersModal prop threading, lifecycle DROP loop regression preserved.

## Task Commits

Each task committed atomically following the TDD red→green pattern:

1. **Task 1 RED: failing hook spec (17 cases)** — `9dd7d8c` (test)
2. **Task 1 GREEN: implement useDynamicViewMaterializeChain** — `ef91311` (feat)
3. **Task 2 RED: failing context + DashboardsPage specs (6 new cases)** — `3825fdc` (test)
4. **Task 2 GREEN: mount hook + thread dynamicViews + extend context + modal prop types** — `385cbf3` (feat)

## Files Created/Modified

**Created:**
- `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` — 7-section hook implementation (list state, primitive-key subscription, AbortController Map, last-seen-matVer Map, fireCascade helper, cascade effect, unmount cleanup, retry callback).
- `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts` — T1–T17 covering mount/list, cold-start gate (Pitfall 1), cascade fan-out, cross-dv isolation, per-id abort, 3-branch materialize response, AbortError silence, list refresh on dynamicViewVersion, unmount abort of list-fetch, Pitfall 2 cleanup, retry(id), no-username defensive.

**Modified:**
- `kinetica_bi/src/components/DashboardContext.tsx` — DynamicViewRow import; `dynamicViews: DynamicViewRow[]` added to DashboardContextValue + provider props; `useMemo` wrapping the value for stable context identity.
- `kinetica_bi/src/components/DashboardContext.spec.tsx` — Phase 35 describe block with 3 new cases (exposes / empty / reference-equality); `dynamicViews={[]}` added to 6 existing fixtures via the strict-type contract.
- `kinetica_bi/src/components/DashboardsPage.tsx` — Imported `useDynamicViewMaterializeChain`; mounted at the TOP of DashboardOpen state declarations (after state hooks, before the lifecycle cleanup useEffect); destructured `{ dynamicViews, retry: _retryDynamicView }` (retry temporarily prefixed-unused — exposed via DashboardContext in Plan 35-05); threaded `dynamicViews={dynamicViews}` to `DashboardContextProvider`, `WidgetConfigModal`, and `LayersModal`.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` — `listDynamicViews` + `materializeDynamicView` added to the api/client mock; new `vi.mock("./LayersModal")` captures props via globalThis; new Phase 35 describe with 3 cases (hook mount via listDynamicViews call; LayersModal receives dynamicViews prop; lifecycle DROP loop regression preserved).
- `kinetica_bi/src/components/LayersModal.tsx` — `DynamicViewRow` import; `dynamicViews?: DynamicViewRow[]` added to LayersModalProps with `[]` default; not yet consumed inside the form body (Plan 35-06 ships the picker JSX).
- `kinetica_bi/src/components/charts/InfoCardRenderer.spec.tsx` — `dynamicViews={[]}` added to the one DashboardContextProvider fixture (strict-type contract).
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — `wrap` helper signature extended with `dynamicViews` parameter (default []) so existing call sites compile unchanged.

## Decisions Made

- **Per-dv last-seen-matVer ref added on top of the locked AbortController Map.** Research skeleton (35-RESEARCH.md §"Pattern 1") said "tracking 'last seen' per-id is unnecessary because materializeVersion is monotonic and abort dedups". But Test 7 in the plan locks "cross-dv isolation: bumping table B does NOT abort dv-A's controller". Without the guard, when table B's matVer goes 0 → 1, the matVersionKey primitive changes, the effect re-fires, iterates ALL dvs, and re-fires dv-A's cascade (which aborts sigA). The last-seen guard fixes this: each dv's cascade fires only when ITS source-table matVer is strictly greater than what we last acted on for that dv. This is the correct interpretation of "cross-dv isolation" and matches the locked T7 spec.

- **retry(id) uses force=true semantics.** Renderer's Retry button (Plan 35-05) clicks should always re-attempt — even when nothing has changed (e.g., error → click Retry → re-fire). force=true skips the last-seen comparison AND the cold-start gate but still uses the AbortController Map for in-flight dedup.

- **Late-rejection guard at catch entry.** `if (ctrl.signal.aborted) return` before the AbortError name check covers both the native AbortError shape AND the unmount-during-rejection race. The native fetch AbortError has `name === "AbortError"` but in JSDOM tests with mocked promises, the rejection may carry an arbitrary Error whose `.name` is "Error" — the signal-aborted check catches that case correctly.

- **DashboardContext.dynamicViews REQUIRED, not optional.** Locked Phase 30 pattern (STATE.md): "DashboardContextProvider.widgets required... missing-context errors are loud at compile time." Fixtures pay the per-test cost of `dynamicViews={[]}` for compile-time honesty.

- **WidgetConfigModal + LayersModal prop is OPTIONAL with `[]` default.** Downstream consumers (ChartConfigPanel picker in 35-04, KineticaWmsLayerForm picker in 35-06) ship later; the optional prop keeps existing test fixtures compile-clean. This is a different lock than the context's required prop because the context is the read-side (renderer orphan detection) while the modal prop is purely the threading conduit.

- **Toast doc comments avoid the literal string "warning".** Acceptance criterion `! grep -q '"warning"'` is satisfied by referencing the Phase 34 ToastKind union by enumeration ("permission" | "info" | "error") rather than naming the forbidden kind. Keeps the grep gate trivial and unambiguous.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added per-dv last-seen-matVer ref for cross-dv isolation (T7)**
- **Found during:** Task 1 GREEN (first spec run — T7 failed with 3 materialize calls instead of 2)
- **Issue:** The 35-RESEARCH.md skeleton said per-id last-seen tracking is unnecessary, but Test 7 (cross-dv isolation: bumping table B does NOT abort dv-A's controller) requires it. Without the guard, when table B's matVer bumps, the matVersionKey selector changes, the cascade effect re-fires for ALL dvs, and dv-A's controller gets aborted (because fireCascade always aborts the prior controller for that id). The plan's T7 spec is the authoritative contract; the research skeleton's "unnecessary" claim was incorrect.
- **Fix:** Added `lastSeenMatVerRef = useRef<Map<number, number>>(new Map())`. fireCascade reads the current source-table matVer, compares against lastSeenMatVerRef[dv.id], and returns early when `matVer <= lastSeen`. Updates the last-seen value before firing.
- **Files modified:** `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`
- **Verification:** T7 now passes; all 17 cases green; preserved cold-start gate + AbortController dedup + Pitfall 2 cleanup.
- **Committed in:** `ef91311` (Task 1 GREEN)

**2. [Rule 1 - Bug] Late-rejection guard in catch handler**
- **Found during:** Task 1 GREEN (T12 failed when run AFTER T11 — toast spy in T12 captured "Materialize failed: boom" from T11)
- **Issue:** T11's `mockRejectedValue(new Error("boom"))` rejection is enqueued as a microtask. In rapid test sequences, T11's catch can run during T12's lifecycle (after T12's spy is installed) — even though T11's waitFor block awaited the toast. Independently, the orchestrator's catch needs to gracefully handle the unmount-during-rejection race: hook unmount aborts ctrl, but the materialize promise was already rejecting and the catch fires after unmount, triggering setError + toast that doesn't belong.
- **Fix:** Added `if (ctrl.signal.aborted) return` as the FIRST check in the catch. Covers both the unmount race AND any case where the prior cascade for this dv was aborted before the rejection arrived. Also kept the `err.name === "AbortError"` check as a secondary silence for native fetch abort shapes.
- **Files modified:** `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts`
- **Verification:** Combined with the T12 spec fix (DOMException-based abortErr + capturing toast via direct setState wrapper), T11 + T12 + T11→T12 sequence all pass.
- **Committed in:** `ef91311` (Task 1 GREEN)

**3. [Rule 3 - Blocking] Strict DashboardContextProvider.dynamicViews forced 4 fixture updates**
- **Found during:** Task 2 GREEN (tsc reported 8 errors: missing `dynamicViews` in pre-existing fixtures)
- **Issue:** Making `dynamicViews` required matches the locked Phase 30 widgets-required pattern but cascades to all existing fixtures that wrap renderers in `<DashboardContextProvider>`.
- **Fix:** Added `dynamicViews={[]}` to 6 existing fixtures across 3 spec files (DashboardContext.spec.tsx via sed, InfoCardRenderer.spec.tsx by hand, WidgetRenderer.spec.tsx wrap helper signature extended with default param).
- **Files modified:** `DashboardContext.spec.tsx`, `InfoCardRenderer.spec.tsx`, `WidgetRenderer.spec.tsx`
- **Verification:** `npx tsc --noEmit` clean; `npx vitest run` 920/920 pass.
- **Committed in:** `385cbf3` (Task 2 GREEN)

---

**Total deviations:** 3 auto-fixed (2 bugs in research skeleton interpretation, 1 blocking type cascade)
**Impact on plan:** All three deviations are correctness fixes that satisfy the locked plan contracts. Deviation 1 closes a research-vs-plan gap (research said unnecessary; plan T7 says required). Deviation 2 closes a late-rejection race that would manifest in production on dashboard switch mid-cascade. Deviation 3 is the standard strict-type fan-out for a new required context field. No scope creep, no architectural changes, no behavioral surprises for Wave 3 consumers.

## Issues Encountered

- **T12 toast spy leakage across tests:** Initial use of `vi.spyOn(useToastStore.getState(), "showToast")` exhibited spy carry-over between sequential tests when the orchestrator's catch fired during T11→T12 transition. Resolved by replacing the spy approach with a direct `useToastStore.setState({ showToast: wrappingFn })` that records calls in a test-local array. The orchestrator's `ctrl.signal.aborted` guard at catch entry also prevents this kind of cross-test pollution in production by silencing rejections that arrive after the controller was aborted by unmount cleanup.

- **T15 list-refresh sequencing:** Initial spec used `.mockResolvedValueOnce(initialRows).mockResolvedValueOnce(emptyRows)` to control the two expected list calls. But `markPending` (called inside the cascade) bumps `dynamicViewVersion`, which triggers an intermediate refetch that consumed the second mockResolvedValueOnce → list updated to [] prematurely, pruning the cascade controller. Resolved by switching to `mockResolvedValue(initialRows)` (default) and only flipping the mock to return emptyRows AFTER the cascade has had a chance to fire. Sequencing matches real-world: the list refresh after markPending returns the SAME list (nothing was actually deleted yet); the test's deliberate clearView() then triggers the actual list shrinkage.

## User Setup Required

None — pure-frontend hook + context extension with no env vars, no external service, no schema changes (Plan 35-01 already shipped the schema; this plan consumes it client-side only).

## Self-Check: PASSED

Verified:
- `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.ts` exists. Confirmed.
- `kinetica_bi/src/hooks/useDynamicViewMaterializeChain.spec.ts` exists with 17 `it(` blocks. Confirmed.
- `kinetica_bi/src/components/DashboardContext.tsx` modified (dynamicViews field + useMemo). Confirmed.
- `kinetica_bi/src/components/DashboardContext.spec.tsx` modified (3 new Phase 35 cases). Confirmed.
- `kinetica_bi/src/components/DashboardsPage.tsx` modified (hook import + mount + threading). Confirmed.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` modified (api mock + LayersModal mock + 3 new Phase 35 cases). Confirmed.
- `kinetica_bi/src/components/LayersModal.tsx` modified (dynamicViews prop). Confirmed.
- Commits `9dd7d8c` (T1 RED), `ef91311` (T1 GREEN), `3825fdc` (T2 RED), `385cbf3` (T2 GREEN) all found in `git log --all`.
- `npx vitest run` 920/920 passing across 44 test files.
- `npx tsc --noEmit` clean (zero errors).
- All 13 acceptance criteria (8 grep gates for hook + 5 for DashboardsPage/Context) pass.

## Next Plan Readiness

- **Plan 35-04 (chartconfig-picker)** consumes `dynamicViews` via WidgetConfigModal prop — the conduit ships in this plan; WidgetConfigModal's prop type accepts it as optional with `[]` default, ChartConfigPanel will receive it through that channel.
- **Plan 35-05 (aggregated-renderer-and-records)** consumes `dynamicViews` via DashboardContext + `retryDynamicView` via DashboardContext extension. Renderer orphan detection has the surface it needs. `retryDynamicView` is currently destructured but `_`-prefixed in DashboardsPage — Plan 35-05 will lift it into the context value (or keep it as a sibling prop on the renderer; planner's call).
- **Plan 35-06 (map-renderer-and-layer-picker)** consumes `dynamicViews` via LayersModal prop — the conduit ships in this plan; LayersModal's prop type accepts it as optional with `[]` default, KineticaWmsLayerForm will receive it through that channel.
- **No blockers** for downstream plans. The 3 Wave 3 plans can execute in parallel since they touch different files (ChartConfigPanel vs WidgetRenderer vs LayersModal/KineticaWmsLayerForm) and share only the prop conduits this plan established.

---
*Phase: 35-widget-binding-and-pipeline*
*Completed: 2026-05-15*
