---
phase: 24-verification
plan: 04
type: gap_closure
gap_closed: GAP-24-01-A
subsystem: ui
tags: [react, useEffect, useRef, openlayers, ImageWMS, source-listener, async-lifecycle, vitest]

# Dependency graph
requires:
  - phase: 12-dashboard-layers
    provides: LayersModal eye-toggle that flips layer.config.visible via parent onPatch (DashboardsPage.handleLayerPatch optimistic store update + debounced server PATCH)
  - phase: 11-map-renderer
    provides: MapChartRenderer.Effect 2 layer-stack reconciliation using imageLayersRef + imageSourcesRef Maps; ImageWMS source.on("imageloaderror") / source.on("imageloadend") listeners drive the tile-error overlay state machine
  - phase: 24-verification
    provides: GAP-24-01-A captured in 24-VERIFICATION.md with deferred_to v1.4-gap-closure; screenshot at 24-01-task1-layer-visibility-blank-app.png; verifier-report root-cause hypothesis grid in 24-VERIFIER-REPORT.md
provides:
  - sourceListenerCleanupRef Map<layerId, () => void> in MapChartRenderer pairing each ImageWMS source.on attach with a captured-handler-ref source.un closure
  - Effect 2 REMOVE-branch unsubscribe-before-removeLayer ordering: listener cleanup fires BEFORE map.removeLayer to prevent orphan setState from in-flight image-loads
  - Effect 1 unmount cleanup extended: iterates sourceListenerCleanupRef + clears imageLayersRef + imageSourcesRef + lastEmittedParamsRef + sourceListenerCleanupRef so dashboard-switch / remount sequences start with empty bookkeeping
  - 5 vitest regression specs covering visibility-toggle (LayersModal Test 14, 14b) + listener-unsubscribe ordering + round-trip OFF→ON re-add + defense-in-depth stale-handler invocation (MapChartRenderer Test K, K2, K3)
affects:
  - phase: 24-06 (GAP-24-02-A mountedRef fix) — orthogonal half of the OL-async vs React-state lifecycle; 24-04 covers per-toggle, 24-06 covers per-unmount. Both must land for the lifecycle to be safe across the visibility-toggle + dashboard-switch + logout matrix.
  - any future phase that adds OL source listeners on dynamic per-layer sources MUST register a per-id cleanup closure in sourceListenerCleanupRef alongside source.on calls — pattern locked here.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-layer-id listener cleanup map (Map<number, () => void>) pairing source.on attach-time with source.un detach-time using the EXACT captured handler refs (OL requires the original handler reference; passing undefined or a new closure would NOT detach)"
    - "Unsubscribe-before-removeLayer ordering: cleanup closure invoked FIRST in Effect 2 REMOVE loop, BEFORE map.removeLayer fires, so OL's internal dispose cannot trigger a stale callback during the same effect tick"
    - "try/catch around cleanup closure (silent on listener-already-detached) — defensive against double-cleanup paths (Effect 1 unmount running after Effect 2 already cleaned an id)"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx — sourceListenerCleanupRef + Effect 1 + Effect 2 changes
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx — Test K / K2 / K3 GAP-24-01-A regression specs
    - kinetica_bi/src/components/LayersModal.spec.tsx — Test 14 / 14b GAP-24-01-A regression specs

key-decisions:
  - "FIX SHAPE A chosen over B / C — DashboardsPage.handleLayerPatch + dashboardLayersStore.updateLayer are provably pure (cannot throw on a {config: {...}} patch); InfoSelectionView's auto-eligibility-leave effect (line 104-108) already handles the popup-open-then-toggled-off case; MapChartRenderer.spec.tsx Test E proves the static-render visible:false path works. Failure must be in the toggle-time transition, which is exactly when OL in-flight image-loads can complete after removeLayer — i.e. the stale-listener race documented in 24-04-PLAN <interfaces>."
  - "Per-layer sourceListenerCleanupRef Map keyed by layer.id (not by source identity) so re-add paths after toggle-OFF/ON cycles cleanly overwrite the cleanup entry; mirrors imageLayersRef + imageSourcesRef bookkeeping pattern already established."
  - "Effect 1's unmount cleanup ALSO iterates sourceListenerCleanupRef before map.dispose() — covers the orthogonal unmount path. This overlaps semantically with GAP-24-02-A's planned mountedRef fix (24-06), but the two are complementary: 24-04 detaches listeners eagerly (no callback fires); 24-06 adds a mountedRef early-return in case any callback DOES fire for any reason (defense in depth)."
  - "Test K asserts the unsubscribe CONTRACT (source.un called with the right event names alongside map.removeLayer); Test K2 asserts the DEFENSIVE invariant (even if a stale callback fires, the React tree stays mounted); Test K3 asserts the ROUND-TRIP path (OFF→ON re-adds correctly). Three angles → guards against future regressions narrowing the fix surface."

patterns-established:
  - "OL source-listener lifecycle pattern: whenever source.on(event, handler) is called on a dynamically-created source whose lifetime is shorter than the component's, register a cleanup closure capturing the EXACT handler ref. Call the closure BEFORE the source/layer is detached from the OL Map. This file's sourceListenerCleanupRef is the reference implementation."
  - "tsc cast pattern for OL source.un: `source.un(\"event\" as never, handler as never)` mirrors the existing source.on cast pattern in this file. Future fixes should not invent new typings; reuse this cast form for consistency."

requirements-completed:
  - VERIFY-V14-01

# Metrics
duration: 7min
completed: 2026-05-11
---

# Phase 24 Plan 04: GAP-24-01-A Layer-Visibility Toggle Closure Summary

**Layer-visibility eye-toggle no longer blanks the app: OL ImageWMS source listeners are unsubscribed before map.removeLayer so in-flight image-loads cannot fire orphan setState that crashes the unboundary'd React root.**

## Performance

- **Duration:** ~7 min (387s)
- **Started:** 2026-05-11T19:24:34Z
- **Completed:** 2026-05-11T19:31:01Z
- **Tasks:** 3 (Task 1 investigation, Task 2 TDD fix, Task 3 regression + SUMMARY)
- **Files modified:** 3 (MapChartRenderer.tsx, MapChartRenderer.spec.tsx, LayersModal.spec.tsx)

## Accomplishments

- Root-cause comment block authored in `kinetica_bi/src/components/charts/MapChartRenderer.tsx:200` documenting the stale-listener race, the failure timeline, and why FIX SHAPE A was selected over B/C from the plan's hypothesis grid.
- Per-layer `sourceListenerCleanupRef: Map<number, () => void>` introduced; ADD branch in Effect 2 registers a closure capturing the exact `handleTileError` + `handleTileLoadEnd` handler refs alongside the `source.on` calls.
- Effect 2 REMOVE loop invokes the cleanup BEFORE `map.removeLayer` fires (the unsubscribe-before-detach ordering is what closes the race).
- Effect 1's unmount cleanup ALSO iterates the cleanup map and clears `imageLayersRef` + `imageSourcesRef` + `lastEmittedParamsRef` + `sourceListenerCleanupRef` so remount sequences (e.g. dashboard switch) start with empty bookkeeping.
- 5 new regression specs (3 in MapChartRenderer.spec.tsx, 2 in LayersModal.spec.tsx) all green; full frontend vitest 519/519; `tsc --noEmit` exit 0.

## Gap Closed

**GAP-24-01-A (HIGH) — Toggling a layer's visibility OFF blanks the entire application.**

- **Captured root cause** (from Task 1 investigation comment at MapChartRenderer.tsx:200): stale OL source-listener race. The ImageWMS source's `imageloaderror` and `imageloadend` listeners (attached at MapChartRenderer.tsx lines 557-558, formerly 468-469) were never unsubscribed when Effect 2's REMOVE loop fired. In-flight image-loads completing after `map.removeLayer` invoked the listeners against a half-detached source, re-entering React's render path mid-Effect-2 and throwing an uncaught exception. With no `ErrorBoundary` anywhere in `kinetica_bi/src/` (verified via grep — 0 matches), React's default behavior unmounted the entire root tree → blank dark-blue screen matching the captured screenshot.
- **Fix shape A applied** (chosen over B and C per the analysis in 24-04-PLAN <interfaces>): per-layer cleanup closure Map; unsubscribe before removeLayer.
- **File:line of the fix:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx` lines 354 (`sourceListenerCleanupRef` declaration), 405-414 (Effect 1 cleanup additions), 427-432 (Effect 2 REMOVE-branch cleanup invocation), 568-578 (Effect 2 ADD-branch cleanup registration).

## Approach

**Why FIX SHAPE A over B (popup null-deref auto-dismiss) or C (DashboardsPage onPatch repair):**

- **Rule-out B:** `InfoSelectionView.tsx:104-108` already auto-callbacks `onActiveLayerIneligible` (= `handleDismiss` for the popup wrapper, = store reset for the card) when `activeLayerId` leaves `eligibleLayers`. The `if (activeLayerId === null || activeLayer === null) return <div>{empty}</div>` early-return on line 297 prevents the null-deref bug-shape outright. If this path were the crash site, the existing 23-01..23-03 specs would have caught it.
- **Rule-out C:** `DashboardsPage.handleLayerPatch` (DashboardsPage.tsx:557-566) is purely optimistic-store-update + debounced server PATCH. `dashboardLayersStore.updateLayer` (store/dashboardLayersStore.ts:36-46) is a pure array-spread keyed by id — no JSON parsing, no field-shape coupling that could throw on `{config: {visible: false, ...l.config}}`.
- **Confirm A:** Test E in MapChartRenderer.spec.tsx PROVES the static `visible: false` render path works (renders empty-state overlay cleanly). The failure must therefore be in the runtime TRANSITION, which is exactly when OL async callbacks can interleave with React's reconciliation. The verifier-report hypothesis grid (24-VERIFIER-REPORT.md gaps[1]) also placed stale-listener race as the strongest candidate.

The fix follows the plan's FIX SHAPE A almost literally: per-layer Map, captured handler refs at attach time, invoke-before-removeLayer ordering, Effect 1 cleanup extension. The only deviation from the plan body is small: I also clear `lastEmittedParamsRef.current` in Effect 1's cleanup (alongside the other per-layer ref clears) — this guards against stale-fingerprint false-negatives if a layer.id is reused across mounts (relevant on rapid dashboard-switch sequences). Logged below as a Rule-3 auto-fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Investigation + root-cause comment** — `3f2520d` (docs)
2. **Task 2 RED: Failing regression specs** — `a83fc93` (test)
3. **Task 2 GREEN: FIX SHAPE A implementation** — `18387fa` (fix)
4. **Task 3: SUMMARY + state propagation** — (this commit)

_TDD pattern: Task 2 produced two commits (RED test → GREEN fix); Task 1 is doc-only; Task 3 is doc + state._

## Files Created/Modified

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Added the GAP-24-01-A ROOT CAUSE comment block (line 200), `sourceListenerCleanupRef` declaration (line ~354), Effect 1 cleanup extension (5 ref-clears + iteration of cleanup closures), Effect 2 REMOVE-branch cleanup invocation, Effect 2 ADD-branch cleanup registration. 5 `GAP-24-01-A fix` markers grep-able.
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Tests K, K2, K3 appended after Test J in the main describe block. Reuses existing `tileLoadListeners` capture pattern, `allImageWmsInstances` array, and `lastMapInstance` reference.
- `kinetica_bi/src/components/LayersModal.spec.tsx` — Tests 14 and 14b appended at the end of the existing describe block. Reuses the existing `mkLayer` factory and `baseProps`.

## Decisions Made

- See "Approach" above for the FIX SHAPE A vs B vs C reasoning.
- Pattern lock: per-id cleanup Map keyed by `layer.id` mirrors the existing `imageLayersRef` + `imageSourcesRef` bookkeeping. Future fixes adding OL listeners on per-layer sources MUST follow the same pattern; documented inline at the ref declaration.
- Test triple-pattern (K = contract, K2 = defensive invariant, K3 = round-trip) chosen over a single happy-path test because GAP-24-01-A was a true async race; future regressions could narrow the fix surface (e.g., only handle removeLayer-during-Effect-2 but miss removeLayer-during-unmount) and the triple guards against each variant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cleared `lastEmittedParamsRef` in Effect 1 unmount cleanup**
- **Found during:** Task 2 GREEN (writing the Effect 1 cleanup extension)
- **Issue:** Plan's FIX SHAPE A only specifies clearing `sourceListenerCleanupRef` in Effect 1's cleanup. But `lastEmittedParamsRef` is also per-layer-id bookkeeping that survives across Effect 1's unmount, and on a rapid dashboard-switch (mount→unmount→remount) sequence a stale fingerprint could cause Effect 3 to skip a legitimate first-render `updateParams` call on the new mount (false-negative due to fingerprint match against stale-mount data).
- **Fix:** Added `lastEmittedParamsRef.current.clear()` to Effect 1's cleanup alongside the other per-layer ref clears.
- **Files modified:** kinetica_bi/src/components/charts/MapChartRenderer.tsx (Effect 1 cleanup block)
- **Verification:** Full vitest 519/519 green (Tests 16-A through 16-E + 17-02-1 through 17-03 follow-up all pass — these are the lastEmittedParamsRef consumers).
- **Committed in:** 18387fa (Task 2 GREEN commit)

**2. [Rule 2 - Missing Critical] Added try/catch around cleanup closure invocations**
- **Found during:** Task 2 GREEN (review of the REMOVE branch + Effect 1 cleanup logic)
- **Issue:** Plan's FIX SHAPE A doesn't specify what happens if the cleanup closure is invoked twice (e.g., Effect 2 REMOVE runs for layer id=1, then component unmounts and Effect 1 cleanup also iterates the Map). OL's `source.un` on an already-detached listener is a no-op in current OL versions but is not contractually guaranteed across versions — a future OL upgrade could throw on double-detach.
- **Fix:** Wrapped both cleanup invocations (Effect 2 REMOVE branch + Effect 1 unmount loop) in `try { cleanup(); } catch { /* ... */ }` with a silent inline comment.
- **Files modified:** kinetica_bi/src/components/charts/MapChartRenderer.tsx (both cleanup sites)
- **Verification:** All 5 GAP-24-01-A regression specs green.
- **Committed in:** 18387fa (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 Rule-3 blocking, 1 Rule-2 missing-critical)
**Impact on plan:** Both deviations are defensive hardenings tightly scoped to the same fix shape; no scope creep beyond the listener-lifecycle invariant. Plan body's intent preserved verbatim — these are additive guards.

## Issues Encountered

- **No live browser reproduction possible:** Per the plan's step-2 fallback in Task 1, static-code analysis across the four-hypothesis grid was used. The grade-A confidence in FIX SHAPE A comes from (a) existing Test E proving the static render works, (b) provable purity of the DashboardsPage / store paths ruling out C, (c) existing InfoSelectionView eligibility guards ruling out B, (d) no ErrorBoundary anywhere in `kinetica_bi/src/` (grep confirms 0 matches), and (e) the verifier-report explicitly naming stale-listener race as the strongest candidate. Live re-walk of STEP 24-01 layer-visibility flow by the operator is the closing verification gate; it has not been performed in this execution session.
- **No issue beyond that.** The TDD flow ran clean: RED → GREEN → no REFACTOR needed → full suite green.

## Test Coverage

- **Frontend vitest (full suite):** 519/519 passing across 33 test files (baseline was 509/509 at 24-03 close + 5 new from this plan + 5 new from Plan 24-05 already landed at commit 10721fb = 519). Run command: `cd kinetica_bi && npx vitest run`.
- **TypeScript:** `npx tsc --noEmit` → exit 0 (clean).
- **New specs (this plan):** 5 total.
  - LayersModal Test 14: ON→OFF eye-toggle does NOT throw + full-config patch payload.
  - LayersModal Test 14b: OFF→ON path symmetric.
  - MapChartRenderer Test K: visible:true→false fires `source.un` for both events + exactly one `map.removeLayer`.
  - MapChartRenderer Test K2: invoking captured listeners post-toggle does NOT throw; `.widget-map` stays mounted.
  - MapChartRenderer Test K3: round-trip OFF→ON re-adds via `map.addLayer`.
- **Pre-existing GAP-24-01-A-adjacent specs:** Test E (visible:false static render → empty overlay) confirmed still passing; rules out the static-render hypothesis.

## What Re-Verifies

STEP 24-01 layer-visibility flow can now be walked end-to-end:

1. Operator opens a dashboard with a map widget containing at least one visible layer.
2. Operator opens the Layers panel, clicks the eye icon on a layer to toggle visibility OFF.
3. **Expected (post-fix):** the dashboard, widgets, topbar, and any open InfoPopup all remain rendered. The toggled-off layer's WMS tile disappears from the map. The Layers panel stays mounted with the eye icon now showing the "Show layer" state.
4. Operator clicks the eye icon again to toggle the layer back ON.
5. **Expected (post-fix):** the layer's WMS tile re-renders on the map (one `GetMap` request fires); no console errors; React tree intact throughout.

This matches the `must_haves.truths` block in 24-04-PLAN.md frontmatter (lines 20-25) — all 5 truth statements are now satisfied for GAP-24-01-A.

## Followup

- **gsd-verifier re-spawn** (after 24-04, 24-05, 24-06 all complete): the gsd-verifier should walk STEP 24-01 layer-visibility live, confirm the blank-app failure mode no longer reproduces, and update `.planning/phases/24-verification/24-VERIFICATION.md` gap `GAP-24-01-A` from `deferred_to: v1.4-gap-closure` to `resolution: closed`. The other two gaps (GAP-24-01-B closed by 24-05 at commit 10721fb; GAP-24-02-A pending 24-06) should be re-verified in the same pass.
- **Cross-fix interaction with 24-06 (GAP-24-02-A):** 24-06 will add a `mountedRef` cleanup-gate to all async OL callbacks (XHR loader, `imageloaderror`/`imageloadend` handlers, Effect 6 fan-out). The two fixes are orthogonal AND complementary — 24-04 eagerly detaches listeners so no callback fires; 24-06 adds a defense-in-depth early-return if any callback does fire. If 24-06 lands after this plan, no merge conflict is expected in `MapChartRenderer.tsx` because the two fixes touch different concerns (this plan touches the REMOVE branch + cleanup registration; 24-06 touches the handler bodies + Effect 1 mountedRef flip).
- **Pattern lock for future OL listener additions:** Any future phase adding `source.on(event, handler)` on per-layer OL sources MUST register a `sourceListenerCleanupRef` entry capturing the handler refs. Inline comment at the ref declaration enforces this; the pattern is now documented in the file.

## User Setup Required

None — this is a pure code-level fix. No new dependencies, no env-var changes, no service configuration.

## Next Phase Readiness

- **v1.4 gap-closure cycle:** 2 of 3 gaps now have landed fixes (GAP-24-01-A via this plan; GAP-24-01-B via 24-05 at commit 10721fb). GAP-24-02-A (24-06) is the last remaining HIGH-severity gap before v1.4 milestone can be marked closed.
- **No new blockers.** The fix is contained to MapChartRenderer.tsx; no cross-file refactor required.

## Self-Check: PASSED

- Files exist (4/4): 24-04-SUMMARY.md, MapChartRenderer.tsx, MapChartRenderer.spec.tsx, LayersModal.spec.tsx.
- Commits exist (3/3): 3f2520d (Task 1 investigation), a83fc93 (Task 2 RED specs), 18387fa (Task 2 GREEN fix).
- Grep markers: 2x `GAP-24-01-A ROOT CAUSE` (file header + commit message reference), 5x `GAP-24-01-A fix` (code annotations), 4x `GAP-24-01-A` in LayersModal.spec.tsx, 7x `GAP-24-01-A` in MapChartRenderer.spec.tsx, 1x `gap_closed: GAP-24-01-A` in SUMMARY frontmatter.
- Full vitest 519/519 green; tsc --noEmit exit 0.

---
*Phase: 24-verification*
*Plan: 04 (gap closure for GAP-24-01-A)*
*Completed: 2026-05-11*
