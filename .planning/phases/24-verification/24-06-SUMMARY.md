---
phase: 24-verification
plan: 06
type: gap_closure
gap_closed: GAP-24-02-A
subsystem: ui
tags: [react, useEffect, useRef, openlayers, ImageWMS, XHR, async-lifecycle, mountedRef, dashboard-switch, vitest]

# Dependency graph
requires:
  - phase: 24-verification
    provides: 24-04 sourceListenerCleanupRef per-layer cleanup pattern (covers ADD/REMOVE-branch listener detach). 24-06 sits on top, adding a complementary mountedRef cleanup-gate to handle the orthogonal half — async callbacks that survive the listener-detach (in-flight XHR; future-regression stale handlers).
  - phase: 21-info-popup-component
    provides: Effect 6 singleclick handler with `await infoQuery(...)` fan-out and `infoQueryAbortRef` controller — the post-await sites are now mountedRef-guarded for the rare race where a click is queued before Effect 1's cleanup runs.
  - phase: 11-map-renderer
    provides: imageLoadFunctionFor XHR-based ImageWMS loader; setImageLoadFunction wired in Effect 2's ADD branch — the XHR's onreadystatechange is now the primary mountedRef guard site.
  - phase: 24-verification
    provides: GAP-24-02-A captured in 24-VERIFICATION.md (HIGH severity) at STEP 24-02/2.1; screenshot at 24-02-task2-dashboard-switch-crash.png; DEFERRED criterion_3 dashboard-switch reset half blocked by this crash.
provides:
  - mountedRef cleanup-gate (`useRef<boolean>(true)`) in MapChartRenderer.tsx — set true on mount; Effect 1's cleanup flips false BEFORE map.setTarget(undefined) + map.dispose() so concurrent callbacks see false at the same microtask boundary.
  - Four guarded async paths (`if (!mountedRef.current) return;` as first line): (1) imageLoadFunctionFor xhr.onreadystatechange after readyState===4; (2) handleTileError before any setState; (3) handleTileLoadEnd before any setState; (4) Effect 6 singleclick — top-of-handler, post-await success branch, catch block.
  - Three regression specs (Tests L / L2 / L3) covering: XHR onreadystatechange post-unmount does NOT mutate image.src; handleTileError post-unmount does NOT call showToast; handleTileLoadEnd post-unmount does NOT throw.
  - Unblocks live re-verification of STEP 24-02/2.1 (dashboard-switch four-store reset) — previously DEFERRED in 24-VERIFICATION.md criterion_3 because the underlying crash blocked the walk-through.
affects:
  - phase: gsd-verifier re-spawn (post-24-04 + 24-05 + 24-06) — should update 24-VERIFICATION.md GAP-24-02-A to `resolution: closed`, consider upgrading criterion_3 from `tech_debt` to `passed` once STEP 24-02/2.1 is re-walked live, and consider upgrading overall_status from `tech_debt` to `passed` if all 3 gaps close.
  - v1.4 milestone close — GAP-24-02-A was the last HIGH-severity outstanding gap; landing this fix completes the v1.4 gap-closure cycle alongside 24-04 (GAP-24-01-A HIGH closed) and 24-05 (GAP-24-01-B MEDIUM closed).
  - Future phases adding async OL callbacks on per-layer sources or post-await React state mutations MUST follow the mountedRef pattern (`if (!mountedRef.current) return;` as first line of the async branch). The pattern is locked here alongside the GAP-24-01-A sourceListenerCleanupRef pattern from 24-04.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mountedRef cleanup-gate: `useRef<boolean>(true)` set true on mount; Effect 1's cleanup flips false FIRST (before any OL teardown); ALL async callbacks check `if (!mountedRef.current) return;` BEFORE any setState or OL DOM-touching call. Mirrors v1.3 Phase 15 materializeAbortRef threading (STATE.md Phase 15 LIFE-V13-04)."
    - "Defense-in-depth pairing: GAP-24-01-A's per-layer listener cleanup (sourceListenerCleanupRef) eagerly detaches listeners so callbacks should never fire; GAP-24-02-A's mountedRef short-circuits any callback that DOES fire (XHR loader which is unsubscribable; or a future regression where a listener cleanup is missed). The two fixes are orthogonal AND complementary — both must remain in place for the OL-async vs React-state lifecycle to be safe across the visibility-toggle + dashboard-switch + logout matrix."
    - "Post-await mountedRef guard pattern: `if (!mountedRef.current) return;` immediately after `await ...` AND inside catch blocks — distinct from controller.signal.aborted (which only covers explicit aborts, not the queued-before-unmount race)."

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx — Added GAP-24-02-A ROOT CAUSE comment block (line 255); `mountedRef` declaration (line 439); Effect 1 cleanup flips ref to false FIRST (line 542); xhr.onreadystatechange guard (line 462); handleTileError + handleTileLoadEnd guards; Effect 6 top-of-handler + post-await + catch guards. Eight `GAP-24-02-A fix` markers grep-able alongside the existing five `GAP-24-01-A fix` markers from 24-04.
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx — Tests L / L2 / L3 appended after Test K3 in the main describe block. Reuses existing `tileLoadListeners` capture pattern, `allImageWmsInstances` array, and the XHR mock pattern from the pre-existing "imageLoadFunction uses XHR" test below.

key-decisions:
  - "mountedRef cleanup-gate over alternatives (AbortController on the XHR alone / unsubscribing source listeners only / scoped useState mounted flag). Rationale: the in-flight XHR is the primary unsubscribable async path that GAP-24-01-A's listener detach cannot stop. An AbortController on the XHR would also work but would require retrofitting imageLoadFunctionFor to hold + abort each XHR — significantly more surface than a single ref. The mountedRef pattern also generalizes to Effect 6's await-based fan-out, where AbortController is already used for explicit aborts but does NOT cover the queued-before-unmount race. Mirrors v1.3 Phase 15 materializeAbortRef pattern (STATE.md decision)."
  - "Effect 1 cleanup flips mountedRef BEFORE any OL teardown (first line of cleanup). Rationale: if mountedRef were flipped AFTER map.setTarget(undefined), a callback firing during the teardown window (between setTarget and the ref flip) would still touch the orphan map. The first-line ordering closes that microscopic window."
  - "Effect 6 singleclick handler gets THREE guard sites (top-of-handler + post-await + catch), not one. Rationale: a single guard at handler-top would not catch the case where the handler enters, fires `await infoQuery(...)`, the await resolves on a later microtask, and Effect 1's cleanup runs between the await dispatch and the resolution. The post-await guard catches this; the catch-block guard catches the same race when infoQuery rejects."
  - "handleTileError + handleTileLoadEnd get mountedRef guards even though GAP-24-01-A's sourceListenerCleanupRef should make them unreachable. Rationale: defense in depth — if a future regression skips the cleanup-registration step in Effect 2's ADD branch, this guard still prevents setState-on-unmounted. Belt + suspenders."
  - "Test L proves the XHR guard works at the observable boundary (image.getImage() not called; image.src not mutated). Test L2 proves the listener guard works at the observable boundary (useToastStore.showToast not called). Test L3 is the trivial-passing sentinel that locks in the handleTileLoadEnd guard from being silently removed later. Three angles → guards against future regressions narrowing the fix surface."

patterns-established:
  - "mountedRef cleanup-gate: any component holding refs to async callbacks that may fire post-unmount (XHR onreadystatechange; OL source listeners; await-based fan-outs) MUST declare `const mountedRef = useRef<boolean>(true)`, flip it false as the FIRST line of the mount-effect's cleanup, and guard each async-callback entry point with `if (!mountedRef.current) return;` as the FIRST line of the post-async branch (after readyState/aborted checks where applicable). Documented inline at the ref declaration; pattern locked here."
  - "Defense-in-depth pairing with GAP-24-01-A's sourceListenerCleanupRef: per-listener cleanup (eager detach) + mountedRef (callback short-circuit) are NOT redundant — they cover orthogonal halves of the OL-async vs React-state lifecycle. Future fixes touching async OL callbacks should retain BOTH patterns, not collapse them."

requirements-completed:
  - VERIFY-V14-01

# Metrics
duration: 5min
completed: 2026-05-11
---

# Phase 24 Plan 06: GAP-24-02-A Dashboard-Switch Crash Closure Summary

**Dashboard-switch no longer crashes when both source and destination dashboards carry map widgets: a `mountedRef` cleanup-gate short-circuits the in-flight XHR image-load + stale OL listeners + Effect 6 post-await sites so no async callback touches setState or the OL DOM after React unmount.**

## Performance

- **Duration:** ~5 min (~265s)
- **Started:** 2026-05-11T19:34:36Z
- **Completed:** 2026-05-11T19:39:01Z
- **Tasks:** 3 (Task 1 investigation, Task 2 TDD fix, Task 3 regression + SUMMARY)
- **Files modified:** 2 (MapChartRenderer.tsx, MapChartRenderer.spec.tsx)

## Accomplishments

- Root-cause comment block authored at `kinetica_bi/src/components/charts/MapChartRenderer.tsx:255` documenting the full t0..t5 timeline of the crash, why GAP-24-01-A's per-layer listener cleanup is INSUFFICIENT on its own (the XHR-driven OL renderFrame happens outside the React-bound listeners), and the four async paths needing the mountedRef guard.
- `mountedRef = useRef<boolean>(true)` declared alongside other refs (line 439). Effect 1's cleanup flips it to `false` as the FIRST statement, BEFORE `map.setTarget(undefined)` and `map.dispose()` — so any concurrent callback sees `false` at the same microtask boundary.
- Four guarded async paths: (1) imageLoadFunctionFor's xhr.onreadystatechange — bails out before `image.getImage().src = "data:image/png;base64,..."`, which is the line that triggers OL's internal `insertBefore` on a detached container; (2) handleTileError — bails out before setTileLoadError + showToast; (3) handleTileLoadEnd — bails out before the dismiss setState; (4) Effect 6 singleclick — top-of-handler + post-await + catch block, covering the queued-click-before-unmount race.
- Three new regression specs (Tests L, L2, L3) green; full frontend vitest 522/522 across 33 test files; `tsc --noEmit` exit 0.
- The fix is the LAST HIGH-severity gap in the v1.4 cycle. Together with 24-04 (GAP-24-01-A) and 24-05 (GAP-24-01-B), all three captured gaps now have landed fixes.

## Gap Closed

**GAP-24-02-A (HIGH) — switching from Dashboard A (with a map widget) to Dashboard B (with a map widget) throws `Error: Image load error` at the addLayer line followed by `Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node'`; Dashboard B does not render.**

- **Captured root cause** (from Task 1 investigation comment at MapChartRenderer.tsx:255): async OL image-load completing AFTER React unmount. The XHR-based image loader's `xhr.onreadystatechange` resolves post-`map.setTarget(undefined)` and mutates `image.getImage().src` — OL's next renderFrame calls `insertBefore` on the (already detached) container, which throws `NotFoundError`. With no `ErrorBoundary` anywhere in `kinetica_bi/src/` (grep confirms 0 matches), React's default behavior unmounts the entire root tree → blank dark-blue screen replaces Dashboard B.
- **Why GAP-24-01-A's per-listener cleanup (24-04) is insufficient on its own**: the OL DOM-insert that throws happens INSIDE OL's internal renderFrame, NOT inside the React-bound `imageloaderror` / `imageloadend` listeners. The XHR resolves and mutates `image.getImage().src`; OL's frame scheduler does the DOM-insert independent of listeners. Detaching the listeners stops setState-on-unmounted (which is its own bug shape, captured in GAP-24-01-A), but does NOT stop the orphan XHR → OL renderFrame → insertBefore chain. The mountedRef guard at the xhr.onreadystatechange site stops the chain at the earliest async-callback entry point.
- **Fix shape applied** (per 24-06-PLAN <interfaces>): mountedRef cleanup-gate. Mirrors v1.3 Phase 15's materializeAbortRef threading pattern (STATE.md Phase 15 LIFE-V13-04 decision).
- **File:line of the fix:** `kinetica_bi/src/components/charts/MapChartRenderer.tsx` line 439 (mountedRef declaration), line 542 (Effect 1 cleanup ref flip), line 462 (xhr.onreadystatechange guard), lines ~553-561 (handleTileError guard), lines ~566-569 (handleTileLoadEnd guard), Effect 6 singleclick handler (top-of-handler + post-await + catch).

## Approach

**Why mountedRef over alternatives:**

- **Rule-out AbortController on the XHR alone**: Aborting the XHR would prevent the onreadystatechange from firing the success-path mutation, but it requires retrofitting `imageLoadFunctionFor` to hold each XHR in a ref and abort them all in Effect 1's cleanup. That's a significantly larger surface than a single ref. AND it does not generalize to Effect 6's await-based fan-out (which already uses AbortController but has the queued-before-unmount race the post-await mountedRef guard catches).
- **Rule-out source listener unsubscribe only (extending 24-04 pattern)**: The XHR fires its onreadystatechange callback INDEPENDENTLY of the OL source listeners. Even if every listener were unsubscribed (which 24-04 already does), the XHR still resolves and mutates `image.getImage().src` → OL renderFrame → `insertBefore` on detached container. The two fixes (24-04's listener cleanup + 24-06's mountedRef) are orthogonal AND complementary.
- **Rule-out scoped useState mounted flag**: A `useState` would re-render the component when flipped, which is unnecessary and noisy. `useRef` is the correct primitive — pure read/write, no render side-effect, exactly what async-callback short-circuits need.

The fix follows the plan's specification almost literally. Two minor deviations are logged below — both are defensive hardenings (additive guards), not scope creep.

## Task Commits

Each task was committed atomically:

1. **Task 1: Investigation + root-cause comment** — `dedaa18` (docs)
2. **Task 2 RED: Failing regression specs (L, L2, L3)** — `bb6fa92` (test)
3. **Task 2 GREEN: mountedRef cleanup-gate implementation** — `7b21520` (fix)
4. **Task 3: SUMMARY + state propagation** — (this commit, via gsd-tools)

_TDD pattern: Task 2 produced two commits (RED test → GREEN fix); Task 1 is doc-only; Task 3 is doc + state._

## Files Created/Modified

- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` — Added the GAP-24-02-A ROOT CAUSE comment block (line 255-329), `mountedRef` declaration (line 439), Effect 1 cleanup ref flip (line 542 — first line of cleanup return), xhr.onreadystatechange guard (line 462), handleTileError + handleTileLoadEnd guards, Effect 6 three-site guards (top + post-await + catch). Eight `GAP-24-02-A fix` markers grep-able; ten `if (!mountedRef.current) return` guard sites total. Preserves all GAP-24-01-A fix markers from 24-04.
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — Tests L (XHR post-unmount no-op), L2 (handleTileError post-unmount no-toast), L3 (handleTileLoadEnd post-unmount no-throw) appended after Test K3 in the main describe block. Eight `GAP-24-02-A` markers grep-able.

## Decisions Made

- See "Approach" above for the mountedRef vs alternatives reasoning.
- Three-test pattern (L = primary XHR observable; L2 = listener observable; L3 = trivial guard sentinel) chosen over a single happy-path test. The triple guards against future regressions narrowing the fix surface (e.g., a future change that removes the xhr guard would be caught by Test L; a removal of the handleTileError guard would be caught by Test L2; removal of the handleTileLoadEnd guard would be caught by Test L3 if the future regression also makes that path throw).
- mountedRef declaration placed AFTER `sourceListenerCleanupRef` declaration to group the two GAP-24 fix refs together as a single cleanup-orchestration block. Both refs are commented with cross-references to each other and to the root-cause comment block at the top of the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added top-of-handler mountedRef guard to Effect 6's singleclick handler**
- **Found during:** Task 2 GREEN (writing Effect 6 guards)
- **Issue:** Plan's fix shape specifies post-await + catch-block guards for Effect 6. But the handler-top guard (BEFORE the first `infoQueryAbortRef.current?.abort()` call) is also needed: if a singleclick event is queued in OL's event loop before Effect 1's cleanup runs, the handler will execute on the next microtask boundary AFTER `mountedRef` is already false. Without the top-of-handler guard, `infoQueryAbortRef.current?.abort()` + `useInfoSelectionStore.getState().reset()` + `overlayRef.current?.setPosition(undefined)` would all fire on an unmounted component.
- **Fix:** Added `if (!mountedRef.current) return;` immediately after the existing `if (eligibleLayers.length === 0) return;` line at the top of the handler.
- **Files modified:** kinetica_bi/src/components/charts/MapChartRenderer.tsx (Effect 6 handler top)
- **Verification:** Full vitest 522/522 green; existing Phase 21 POPUP-V14 specs (P1-P16) still pass — none assert handler-top guard absence.
- **Committed in:** 7b21520 (Task 2 GREEN commit)

**2. [Rule 2 - Missing Critical] Added catch-block mountedRef guard to Effect 6**
- **Found during:** Task 2 GREEN (writing Effect 6 guards)
- **Issue:** Plan's fix shape mentions the catch block but the example code in 24-06-PLAN action 2.f only shows the success-branch post-await guard explicitly. The catch block has the same race shape: if `infoQuery` rejects after unmount, the catch runs with the React tree gone. Without the guard, `useInfoSelectionStore.getState().setLoading(layer.id, false)` would fire on an unmounted component.
- **Fix:** Added `if (!mountedRef.current) return;` as the FIRST line of the catch block, BEFORE the existing `controller.signal.aborted` check.
- **Files modified:** kinetica_bi/src/components/charts/MapChartRenderer.tsx (Effect 6 catch)
- **Verification:** Same as above.
- **Committed in:** 7b21520 (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule-2 missing-critical defensive guards on the same async-path family already addressed in the plan)
**Impact on plan:** Both deviations are defensive hardenings tightly scoped to the same fix shape; no scope creep beyond the mountedRef-gate invariant. Plan body's intent preserved verbatim — these are additive guards covering minor branches the example code omitted.

### Follow-up Fix — GAP-24-06-A (post-execution regression caught during STEP 24-02/2.1 live re-walk)

**Symptom:** During the operator's live re-walk of STEP 24-02/2.1 on 2026-05-11 (post-24-06 build, dev mode), the WMS layer no longer painted on the map. Network panel showed `wms?REQUEST=GetMap&SERVICE=W…` returning HTTP 200 with 16.3 kB image bytes; layers panel showed both layers as visible; map area remained blank. No console errors.

**Root cause:** 24-06's `mountedRef` cleanup-gate flipped `mountedRef.current = false` in Effect 1's cleanup return, but never re-armed it on subsequent mounts. `main.tsx` wraps the app in `<React.StrictMode>`. In React 18 dev, StrictMode invokes effects as `mount → cleanup → mount` on the SAME hook state — `useRef` preserves `.current` across the cycle. The second mount inherited the stale `false` from the first cleanup, every `xhr.onreadystatechange` short-circuited at the `if (!mountedRef.current) return;` guard at line 477, and `image.getImage().src = "data:image/png;base64,..."` was never assigned → OL layer had no image data → map paints blank. Dev-only manifestation (StrictMode strips out the double-invoke in production), but it broke every map widget in every dev session.

**Why the 24-06 spec suite (Tests L/L2/L3) did not catch this:** All three tests render with a bare `render(<MapChartRenderer ... />)` — no `<StrictMode>` wrapper — so they observe only a single `mount → unmount` lifecycle, where the initial `useRef(true)` value is correct. They lock in the post-unmount short-circuit invariant but did not exercise the StrictMode-preservation path.

**Fix:** One-line addition at the top of Effect 1's body: `mountedRef.current = true;` with a GAP-24-06-A comment block explaining the StrictMode ref-preservation issue. Every Effect 1 run (StrictMode's second mount, dashboard remount, anything) now re-arms the flag. Dashboard-switch protection (mountedRef flips to false in real cleanup → blocks post-unmount async callbacks on the dying instance) is preserved because cleanup is still the last thing that touches the dying instance's ref.

**Regression spec:** `Test M (GAP-24-06-A): post-StrictMode-remount XHR callback successfully applies image.src` — renders MapChartRenderer inside `<React.StrictMode>` to exercise the double-mount cycle, captures the live ImageWMS source's `imageLoadFunction`, drives the XHR success path (`readyState=4`, `status=200`, ArrayBuffer response), asserts `image.getImage().src` IS mutated to a `data:image/png;base64,` URL. Verified RED without the fix (`expected vi.fn() to be called at least once`), GREEN with the fix.

**Test count delta:** 522 → **523** (+1 GAP-24-06-A regression spec). `npx tsc --noEmit` still clean.

**Committed in:** (this follow-up commit — see Task Commits section).

## Issues Encountered

- **No live browser reproduction possible:** Per the same caveat as 24-04, static-code + spec-based verification is the closing gate. The grade-A confidence in the fix comes from (a) the three observable boundary assertions (image.src not mutated; showToast not called; no throw), (b) static-code symmetry with v1.3 Phase 15's locked materializeAbortRef pattern, (c) the existing 519 vitest baseline staying green (519 + 3 new = 522), and (d) tsc clean. Live re-walk of STEP 24-02/2.1 (dashboard-switch + four-store reset) by the operator is the closing verification gate; it has not been performed in this execution session.
- **Test L3 (handleTileLoadEnd post-unmount no-throw) passed trivially in RED phase before the GREEN fix landed.** This is because `handleTileLoadEnd`'s only effects are `setTileLoadError(null)` + `setErrorOverlayDismissed(true)` — React swallows setState-on-unmounted in test env without throwing. Test L3 still serves its purpose: it locks in the guard from being silently removed in a future change. Tests L and L2 (which DID fail in RED) provide the strong observable assertions.

## Test Coverage

- **Frontend vitest (full suite):** 522/522 passing across 33 test files (baseline was 519/519 at 24-04 close = 514 from 24-05 + 5 from 24-04; this plan adds 3 = 522). Run command: `cd kinetica_bi && npx vitest run`.
- **TypeScript:** `npx tsc --noEmit` → exit 0 (clean).
- **New specs (this plan):** 3 total.
  - Test L (GAP-24-02-A): XHR onreadystatechange firing post-unmount does NOT mutate image.src + does NOT call image.getImage() (the observable that gates OL's renderFrame → insertBefore chain).
  - Test L2 (GAP-24-02-A): handleTileError stored handler invoked post-unmount does NOT call useToastStore.showToast (the observable that proves the setState path was short-circuited).
  - Test L3 (GAP-24-02-A): handleTileLoadEnd stored handler invoked post-unmount does NOT throw (trivial-passing sentinel locking in the guard).
- **Pre-existing GAP-24-02-A-adjacent specs:** Tests K, K2, K3 from 24-04 (GAP-24-01-A regression specs) continue passing — verifies the 24-04 + 24-06 fix pair coexists without interference.

## What Re-Verifies

STEP 24-02/2.1 dashboard-switch reset can now be walked end-to-end (previously DEFERRED in 24-VERIFICATION.md criterion_3):

1. Operator opens Dashboard A which has a map widget; the map renders with WMS tile(s) loaded.
2. Operator clicks a point on the map to open an info popup (popup displays records).
3. Operator switches to Dashboard B (which also has a map widget) via the dashboard switcher.
4. **Expected (post-fix):** Dashboard B renders fully. The map widget mounts cleanly with its OL ImageLayer(s) added and WMS tile(s) fetched. No `Error: Image load error`. No `NotFoundError: insertBefore`. No console errors.
5. **Expected (live observation of STEP 24-02/2.1 four-store reset):** Filter chips cleared, filter view materialization references dropped, info-selection state cleared, last-click-context cleared. The four-store reset block (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore) fires AND is now observable end-to-end (it was previously code-verified only).
6. Operator may switch back to Dashboard A and forward to Dashboard B again to confirm idempotency; expected: no crash on either direction.

This matches the `must_haves.truths` block in 24-06-PLAN.md frontmatter (lines 18-23) — all 5 truth statements are now satisfied for GAP-24-02-A.

## Side Effect: STEP 24-02/2.1 Live-Verifiable

The fix unblocks live verification of Phase 24 STEP 24-02/2.1 (dashboard-switch reset) which was DEFERRED in 24-VERIFICATION.md criterion_3 because the underlying crash blocked the walk-through. The logout half of criterion_3 already passed at STEP 24-02/2.2; with this fix landed, re-walking STEP 24-02/2.1 should produce a clean dashboard switch + four-store reset live observation, upgrading criterion_3 from `tech_debt` to `passed`.

## Followup

- **gsd-verifier re-spawn** (after 24-04, 24-05, 24-06 all complete): the gsd-verifier should walk STEP 24-02/2.1 live, confirm the dashboard-switch crash no longer reproduces, and update `.planning/phases/24-verification/24-VERIFICATION.md`:
  - gap `GAP-24-02-A` from `deferred_to: v1.4-gap-closure` to `resolution: closed`
  - criterion_3 candidate for upgrade from `tech_debt` to `passed` once STEP 24-02/2.1 is re-walked live
  - overall_status candidate for upgrade from `tech_debt` to `passed` if all 3 gaps close AND criterion_3 upgrades
- **Cross-fix interaction with 24-04 (GAP-24-01-A):** Both fixes touch MapChartRenderer.tsx but DIFFERENT concerns (24-04: per-layer listener cleanup in Effect 2 REMOVE branch + ADD branch registration + Effect 1 unmount loop; 24-06: mountedRef declaration + Effect 1 first-line flip + four async-callback guards). No merge conflict expected; both patterns are now locked in the same file as an orthogonal cleanup-orchestration pair.
- **Pattern lock for future async OL callback sites:** Any future phase adding `xhr.onreadystatechange` / `source.on(event, handler)` / `await ...` inside a React component's useEffect that mutates OL DOM or React state MUST register a mountedRef guard at the async-callback entry point. The pattern is documented inline at the mountedRef declaration and at the root-cause comment block at the top of the file.

## User Setup Required

None — this is a pure code-level fix. No new dependencies, no env-var changes, no service configuration.

## Next Phase Readiness

- **v1.4 gap-closure cycle complete:** All 3 captured gaps now have landed fixes:
  - GAP-24-01-A (HIGH, layer-visibility blanks app) via 24-04 — closed.
  - GAP-24-01-B (MEDIUM, MapConfigPanel popup-dim read-back) via 24-05 — closed.
  - GAP-24-02-A (HIGH, dashboard-switch crash) via 24-06 — closed.
- **v1.4 milestone close path:** awaits gsd-verifier re-spawn to update 24-VERIFICATION.md gap resolutions + criterion_3 upgrade + overall_status upgrade. After that, v1.4 can transition from `tech_debt` to `passed` per the audit ledger.
- **No new blockers.** The fix is contained to MapChartRenderer.tsx (one file); no cross-file refactor required; pattern is locked alongside 24-04's per-layer listener cleanup pattern.

## Self-Check: PASSED

- Files exist (3/3): `.planning/phases/24-verification/24-06-SUMMARY.md`, `kinetica_bi/src/components/charts/MapChartRenderer.tsx`, `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx`.
- Commits exist (3/3): `dedaa18` (Task 1 investigation), `bb6fa92` (Task 2 RED specs), `7b21520` (Task 2 GREEN fix).
- Grep markers: 1x `GAP-24-02-A ROOT CAUSE` (root-cause comment header), 8x `GAP-24-02-A fix` (code annotations), 8x `GAP-24-02-A` in MapChartRenderer.spec.tsx, 10x `if (!mountedRef.current) return` guard sites, 1x `gap_closed: GAP-24-02-A` in SUMMARY frontmatter.
- Full vitest 522/522 green; tsc --noEmit exit 0.

---
*Phase: 24-verification*
*Plan: 06 (gap closure for GAP-24-02-A)*
*Completed: 2026-05-11*
