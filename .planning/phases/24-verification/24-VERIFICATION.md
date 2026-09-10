---
phase: 24-verification
overall_status: passed
verified_on: 2026-05-11
updated: 2026-05-11
operator: rpereira@kinetica.com
re_verification:
  previous_status: tech_debt
  previous_score: "4/5 criteria passed; 1 tech_debt"
  human_needed_status: "Intermediate transition (post 24-04/24-05/24-06 gap-closure): overall_status=human_needed; criterion_3=human_needed pending live operator re-walk of STEP 24-02/2.1. Recorded earlier on 2026-05-11."
  passed_status: "Final transition (post live operator re-walk on 2026-05-11): overall_status=passed; criterion_3=passed. Operator attested STEP 24-02/2.1 dashboard-switch + four-store reset live, STEP 24-01 layer-visibility re-walk, and STEP 24-01/2.2 popup-dim read-back re-walk. One new regression GAP-24-06-A surfaced during the re-walk and was closed inline (commit 543f624) — see gaps[] below."
  gaps_closed:
    - "GAP-24-01-A (HIGH, layer-visibility blanks app) — closed via 24-04 commit 18387fa; live re-walk confirmed closed 2026-05-11"
    - "GAP-24-01-B (MEDIUM, MapConfigPanel popup-dim read-back) — closed via 24-05 commit 10721fb; live re-walk confirmed closed 2026-05-11"
    - "GAP-24-02-A (HIGH, dashboard-switch crash) — closed via 24-06 commit 7b21520; live re-walk confirmed closed 2026-05-11"
    - "GAP-24-06-A (HIGH, StrictMode mountedRef stale-false stranded WMS image src on map load) — discovered + closed inline 2026-05-11 via commit 543f624 (Effect 1 re-arm + Test M regression spec)"
  gaps_remaining:
    - "TD-V14-WKB-SPIKE — inherited from Phase 18, deferred to v1.5 (NOT a Phase 24 regression and NOT a v1.4 blocker)"
  regressions:
    - "GAP-24-06-A surfaced as a regression from the 24-06 mountedRef cleanup-gate fix interacting with React 18 StrictMode mount-cleanup-mount cycle. Closed inline same-day via commit 543f624."
criteria_status:
  criterion_1: passed
  criterion_2: passed
  criterion_3: passed
  criterion_4: passed
  criterion_5: passed
gaps:
  - id: TD-V14-WKB-SPIKE
    title: "WKB binary spatial mode not exercised — Kinetica-GEOMETRY sub-case closed via Session Fix #1"
    severity: medium
    deferred_to: v1.5
    note: "True WKB-binary column path remains deferred (SPATIAL-V14-03 NONE_ESCALATE → TECH_DEBT, locked 2026-05-08). The Kinetica-GEOMETRY sub-case — server uses ST_DISTANCE + ST_GEOMFROMTEXT when spatialMode='wkb' and the column is WKT-typed Kinetica geometry — was verified live at STEP 24-01/2.1. Phase 24 does NOT close TD-V14-WKB-SPIKE; it inherits Phase 18's deferral. A real WKB-binary column must be accessible before re-running the spike runner (commit d458408, production-payload-parity). NOT a v1.4 blocker."
  - id: TD-V12-04
    title: "Visible filter narrowing fixture-based demo — CLOSED via STEP 24-02/2.3"
    severity: low
    deferred_to: closed
    note: "Carried from v1.3 (Phase 17 UAT used demo.nyctaxi). Closed at STEP 24-02/2.3: operator verified viewName routing end-to-end — _kbi_filt_... present in POST /api/info/query payload when filter active, absent when cleared, rows correctly subset. STEP 24-02/2.4 confirmed this as sufficient closure. TD-V12-04 status: CLOSED."
  - id: GAP-24-01-A
    title: "Toggling layer visibility off blanks the entire application"
    severity: high
    deferred_to: closed
    resolution: "CLOSED 2026-05-11 via gap-closure plan 24-04 (commit 18387fa, fix; a83fc93, RED specs; 3f2520d, investigation; 37655f5, SUMMARY). Root cause: stale OL ImageWMS source-listener race — `imageloaderror` + `imageloadend` listeners were never unsubscribed when Effect 2's REMOVE loop fired, so in-flight image-loads invoked the listeners against a half-detached source, re-entering React mid-Effect-2 and throwing an uncaught exception that (with no ErrorBoundary) unmounted the root tree. Fix: per-layer `sourceListenerCleanupRef: Map<number, () => void>` in `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (line 426); Effect 2 REMOVE branch invokes cleanup BEFORE `map.removeLayer` (line ~596); Effect 1 unmount cleanup also iterates the Map (lines 545-561). Regression coverage: 5 vitest specs — `LayersModal.spec.tsx` Tests 14 / 14b (ON→OFF + OFF→ON eye-toggle does not throw), `MapChartRenderer.spec.tsx` Tests K (contract: source.un called alongside map.removeLayer), K2 (defensive: stale listener invocation does not throw), K3 (round-trip: OFF→ON re-adds via map.addLayer). Live operator re-walk of STEP 24-01 layer-visibility flow completed 2026-05-11: eye-toggle ON↔OFF keeps the app rendered, regression confirmed closed."
  - id: GAP-24-01-B
    title: "MapConfigPanel INFO POPUP inputs do not echo back saved infoPopupWidthPx / infoPopupHeightPx"
    severity: medium
    deferred_to: closed
    resolution: "CLOSED 2026-05-11 via gap-closure plan 24-05 (commit 10721fb, fix; fac6233, SUMMARY). Root cause: three draft `useState` initializers (`radiusDraft`, `widthDraft`, `heightDraft`) only ran on the FIRST render; when ConfigPanel re-rendered MapConfigPanel with a new `config` prop (no remount), the initial-render value remained captured and draft state was divorced from config. The existing line-comment 'Reset when stored config changes externally' promised behavior the code did not implement. Fix: `useEffect` + `useRef` re-sync hooks for radius / width / height drafts in `kinetica_bi/src/components/charts/MapConfigPanel.tsx` (lines 85-115). Mid-type guard `if (draft === String(priorRef.current))` distinguishes 'draft is the prior config echo' (re-sync safe) from 'user mid-type' (leave alone; clamp-on-blur reconciles). Phase 22 clamp-on-blur invariant preserved (FIX B chosen over full controlled-input refactor). Regression coverage: 5 vitest specs in `MapConfigPanel.spec.tsx` (lines 323-378) — width / height / radius non-default read-back, parent-rerender re-sync, mid-type guard non-clobber. Live operator re-walk of STEP 24-01/2.2 popup-resize-config completed 2026-05-11: saved width/height values display on MapConfigPanel reopen, regression confirmed closed."
  - id: GAP-24-02-A
    title: "Dashboard switch crashes when destination dashboard has a map widget"
    severity: high
    deferred_to: closed
    resolution: "CLOSED 2026-05-11 via gap-closure plan 24-06 (commit 7b21520, fix; bb6fa92, RED specs; dedaa18, investigation; c9be4bb, SUMMARY). Root cause: async OL image-load completing AFTER React unmount — the XHR-based image loader's `xhr.onreadystatechange` resolved post-`map.setTarget(undefined)` and mutated `image.getImage().src`; OL's next renderFrame called `insertBefore` on the (already detached) container, which threw `NotFoundError`. With no ErrorBoundary, React's default unmounted the root tree → blank screen replaced Dashboard B. GAP-24-01-A's per-listener cleanup is INSUFFICIENT on its own because the OL DOM-insert happens INSIDE OL's internal renderFrame, NOT inside the React-bound listeners — the XHR resolves and mutates `image.getImage().src` independently. Fix: `mountedRef = useRef<boolean>(true)` cleanup-gate in `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (line 439); Effect 1 cleanup flips `mountedRef.current = false` as the FIRST statement (line 542); `if (!mountedRef.current) return;` guards at four async-callback entry points: xhr.onreadystatechange (line 477), handleTileError (line 648), handleTileLoadEnd (~line 661), Effect 6 singleclick (top-of-handler + post-await + catch). Mirrors v1.3 Phase 15's materializeAbortRef pattern (LIFE-V13-04). Pairs with 24-04 as orthogonal+complementary defense-in-depth: 24-04 eagerly detaches listeners so no callback fires; 24-06 short-circuits any callback that DOES fire. Regression coverage: 3 vitest specs in `MapChartRenderer.spec.tsx` Tests L (XHR post-unmount does NOT mutate image.src), L2 (handleTileError post-unmount does NOT call showToast), L3 (handleTileLoadEnd post-unmount does NOT throw). Live operator re-walk of STEP 24-02/2.1 (dashboard-switch + four-store reset live observation) completed 2026-05-11: Dashboard B renders fully, no crash; four-store reset observed (filter chips cleared, filter view dropped, info-selection cleared, last-click-context cleared). Regression confirmed closed. NOTE: live re-walk surfaced GAP-24-06-A (StrictMode mountedRef stale-false on remount) — see below; closed inline same-day."
  - id: GAP-24-06-A
    title: "WMS layer fails to paint on map load under React 18 StrictMode — mountedRef stale-false strands image src"
    severity: high
    deferred_to: closed
    resolution: "CLOSED 2026-05-11 inline during live re-walk of STEP 24-01 / STEP 24-02 against the post-24-06 build via commit 543f624 (MapChartRenderer.tsx Effect 1 re-arm + Test M regression spec). Root cause: `useRef` preserves `.current` across React 18 StrictMode's mount → cleanup → mount cycle. The 24-06 fix flipped `mountedRef.current = false` in Effect 1's cleanup (correct behavior on real unmount), but Effect 1's setup never re-armed the ref to `true` on subsequent runs. Under StrictMode, the second mount inherited `mountedRef.current === false` from the StrictMode-induced cleanup pass; the very next xhr.onreadystatechange callback short-circuited the `if (!mountedRef.current) return;` guard at line 477 and never mutated `image.getImage().src`, leaving the WMS image element with no source and the tile never painted. Fix: Effect 1's setup body re-arms `mountedRef.current = true` as its FIRST statement on every run, so each (re-)mount starts the async-callback gate in the open position; cleanup continues to flip to false as before. Regression spec: `MapChartRenderer.spec.tsx` Test M — verifies that a StrictMode-style mount → cleanup → mount sequence on the same component instance leaves `mountedRef.current === true` after the second mount, and that the post-second-mount xhr.onreadystatechange path successfully mutates `image.src` (i.e., the cleanup-gate is correctly re-armed). Full vitest 523/523 green (1 new spec). tsc clean (exit 0). Live re-walk attestation 2026-05-11: WMS layer paints correctly on map load post-fix; the original GAP-24-02-A dashboard-switch + four-store reset behavior remains correct (re-armed mountedRef does NOT regress the post-unmount guard — cleanup flips it false BEFORE map.setTarget/dispose so any in-flight callbacks still see the closed gate). Pairs cleanly with 24-04 + 24-06; completes the defense-in-depth triad."
session_fixes_verified:
  bbox_projection: "STEP 24-01/1.1 — PASS (mapBbox in EPSG:4326 range; EPSG:3857→4326 transform confirmed)"
  kinetica_geometry_sql: "STEP 24-01/2.1 — PASS (ST_DISTANCE + ST_GEOMFROMTEXT SQL path; HTTP 200; rows returned)"
  single_record_nav: "STEP 24-01/1.4 — PASS (Back/Next/Record N of M+ UI; auto-fetch on Next at last loaded)"
  popup_resize_config: "STEP 24-01/2.2 — PASS (popup renders at 200x200 min and 1200x1200 max; GAP-24-01-B form read-back bug CLOSED via 24-05; live re-walk confirmed 2026-05-11)"
  edge_aware_positioning: "STEP 24-01/2.3 — PASS (4-corner anchor flip confirmed at all screen edges)"
  close_x_overlap: "STEP 24-01/2.4 — PASS (close-X clears layer dropdown; no overlap)"
  filter_view_alignment: "STEP 24-02/2.3 — PASS (viewName _kbi_filt_... in POST payload when filter active; absent when cleared; rows correctly subset)"
test_coverage:
  frontend_vitest: "523/523 green (34 test files) — re-verified 2026-05-11 post GAP-24-06-A fix (Test M added)"
  frontend_tsc: "clean (exit 0, no output)"
  new_regression_specs_post_initial_uat:
    - "LayersModal.spec.tsx Tests 14 / 14b — GAP-24-01-A (eye-toggle ON↔OFF does not throw, full-config patch)"
    - "MapChartRenderer.spec.tsx Tests K / K2 / K3 — GAP-24-01-A (source.un contract; stale listener invocation safe; OFF→ON re-add)"
    - "MapChartRenderer.spec.tsx Tests L / L2 / L3 — GAP-24-02-A (XHR post-unmount no-op; handleTileError no showToast; handleTileLoadEnd no throw)"
    - "MapChartRenderer.spec.tsx Test M — GAP-24-06-A (StrictMode mount→cleanup→mount re-arms mountedRef; post-second-mount xhr callback mutates image.src)"
    - "MapConfigPanel.spec.tsx 5 GAP-24-01-B specs — width/height/radius non-default read-back, parent-rerender re-sync, mid-type guard"
environment:
  dev_server_frontend: "Vite :5173 (npm run dev)"
  dev_server_backend: "Express :4000 (cd server && npm run dev)"
  browser: "Manual UAT — operator-selected browser"
  auth_modes_exercised: [password, oidc]
  verified_date: "2026-05-11"
human_verification:
  - test: "Re-walk STEP 24-02/2.1 dashboard-switch + four-store reset"
    status: completed
    completed_on: 2026-05-11
    completed_by: rpereira@kinetica.com
    why_human: "Criterion 3 explicitly says 'Operator attests that dashboard-switch ... clears the info selection'. The crash that blocked this walk (GAP-24-02-A) is now fixed and verified at the spec boundary (Tests L/L2/L3 prove the post-unmount async paths short-circuit cleanly); live four-store reset block (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore) needed live observation."
    expected: "Operator opens Dashboard A (with a map widget) → clicks a point → popup opens with records → switches to Dashboard B (with a map widget) → Dashboard B renders fully (no Error: Image load error; no NotFoundError: insertBefore) → the four-store reset fires AND is observable: filter chips cleared, filter view materialization references dropped, info-selection state cleared, last-click-context cleared. Switching back to Dashboard A then forward to Dashboard B again should not crash on either direction."
    operator_attestation: "PASS — Dashboard B rendered fully, no crash; four-store reset observed: filter chips cleared, filter view dropped, info-selection cleared, last-click-context cleared. (One new regression GAP-24-06-A — WMS layer initial paint failure under StrictMode — surfaced during this re-walk and was fixed inline via commit 543f624 before final attestation.)"
  - test: "Re-walk STEP 24-01 layer-visibility flow"
    status: completed
    completed_on: 2026-05-11
    completed_by: rpereira@kinetica.com
    why_human: "GAP-24-01-A fix is verified at the spec boundary (Tests 14/14b + K/K2/K3), but operator never confirmed the blank-app failure mode no longer reproduces against a live browser."
    expected: "Operator opens a dashboard with at least one visible layer → opens Layers panel → clicks eye icon to toggle visibility OFF → dashboard, widgets, topbar, popup all remain rendered (no blank screen) → toggled-off layer's WMS tile disappears → eye icon shows 'Show layer' state → clicking it again toggles ON → WMS tile re-renders (one GetMap request) → no console errors."
    operator_attestation: "PASS — eye-toggle ON↔OFF keeps the app rendered; no blank screen; WMS tile re-renders cleanly on toggle back ON. GAP-24-01-A regression confirmed closed."
  - test: "Re-walk STEP 24-01/2.2 MapConfigPanel popup-dim read-back"
    status: completed
    completed_on: 2026-05-11
    completed_by: rpereira@kinetica.com
    why_human: "GAP-24-01-B fix is verified at the spec boundary (5 specs covering width/height/radius read-back + re-sync + mid-type guard), but operator never confirmed the reopened panel shows saved (not default) values in a live browser."
    expected: "Operator opens MapConfigPanel for a map widget → sets Popup width = 800, Popup height = 1200 → blurs → closes MapConfigPanel → reopens MapConfigPanel for the same widget → Popup width input shows '800' (NOT default 360); Popup height input shows '1200' (NOT default 400). Popup itself continues rendering at the configured 800×1200 size."
    operator_attestation: "PASS — saved width/height values display on MapConfigPanel reopen. GAP-24-01-B regression confirmed closed."
---

# Phase 24 Verification — v1.4 Map Info Popup (Re-Verification After Gap Closure + Live Re-Walk)

## Summary

v1.4 Map Info Popup is functionally complete. All four gaps discovered during the initial UAT and the post-fix re-walk have landed code fixes with regression coverage and have been confirmed closed by live operator attestation on 2026-05-11. This is the final re-verification of the initial 2026-05-11 UAT (overall_status `tech_debt`) following the v1.4 gap-closure cycle and the closing live re-walk:

- **24-04 (commit `18387fa`)** — GAP-24-01-A (HIGH, layer-visibility blanks entire app). Per-layer `sourceListenerCleanupRef` Map in `MapChartRenderer.tsx`; OL source listeners unsubscribed BEFORE `map.removeLayer` to prevent orphan setState. 5 regression specs across `LayersModal.spec.tsx` (Tests 14, 14b) and `MapChartRenderer.spec.tsx` (Tests K, K2, K3). Live re-walk closed 2026-05-11.
- **24-05 (commit `10721fb`)** — GAP-24-01-B (MEDIUM, MapConfigPanel popup-dim read-back). `useEffect` + `useRef` re-sync hooks for radius / width / height drafts in `MapConfigPanel.tsx`; mid-type guard preserves typing-in-progress across external config updates. 5 regression specs in `MapConfigPanel.spec.tsx`. Live re-walk closed 2026-05-11.
- **24-06 (commit `7b21520`)** — GAP-24-02-A (HIGH, dashboard-switch crash at `MapChartRenderer.tsx:483`). `mountedRef = useRef<boolean>(true)` cleanup-gate in `MapChartRenderer.tsx`; Effect 1's cleanup flips it FIRST; `if (!mountedRef.current) return;` guards at xhr.onreadystatechange, handleTileError, handleTileLoadEnd, and Effect 6 (singleclick top + post-await + catch). 3 regression specs (Tests L, L2, L3) in `MapChartRenderer.spec.tsx`. Pairs with 24-04 as orthogonal+complementary defense-in-depth. Live re-walk closed 2026-05-11.
- **24-06 inline (commit `543f624`)** — GAP-24-06-A (HIGH, StrictMode mountedRef stale-false stranding WMS image src on map load). Effect 1 setup re-arms `mountedRef.current = true` as its first statement on every (re-)mount; cleanup continues to flip false on real unmount. 1 regression spec — `MapChartRenderer.spec.tsx` Test M. Root cause: useRef preserves .current across StrictMode's mount-cleanup-mount cycle; the cleanup-gate flipped to false but was never re-armed. Surfaced during the live re-walk against the post-24-06 build; closed inline same-day before final attestation.

Full frontend vitest is 523/523 green across 34 test files; `tsc --noEmit` exit 0 (clean). All four gap-closure commit hashes verified in `git log`. All fix markers verified present in source.

**Status: `passed`** — All five success criteria pass on the strength of the initial 2026-05-11 UAT, the gap-closure regression coverage, the inline GAP-24-06-A fix, AND the closing live operator re-walk on 2026-05-11. Criterion 3 (dashboard-switch + logout both clear the info selection) upgraded from `human_needed` to `passed` upon operator attestation that STEP 24-02/2.1 (dashboard-switch + four-store reset) produced the expected outcome live: Dashboard B rendered fully with no crash, and the four-store reset block (`filterViewStore` → `filterStore` → `infoSelectionStore` → `lastInfoClickContextStore`) was observed in full.

One item remains deferred and is inherited from Phase 18 (NOT a v1.4 regression and NOT a v1.4 blocker): **TD-V14-WKB-SPIKE** (true WKB-binary spatial mode). The Kinetica-GEOMETRY sub-case was already closed via Session Fix #1 (verified live at STEP 24-01/2.1). The full WKB-binary path requires a real BYTES-typed geometry column to be accessible before re-running the spike runner; deferred to v1.5.

## Re-Verification Diff

| Gap          | Initial (2026-05-11) | Post Gap-Closure (2026-05-11) | Post Live Re-Walk (2026-05-11) | Closing commit |
| ------------ | -------------------- | ----------------------------- | ------------------------------ | -------------- |
| GAP-24-01-A  | DEFERRED (HIGH)      | CLOSED (spec-verified)        | CLOSED (live-attested)         | `18387fa` (24-04) |
| GAP-24-01-B  | DEFERRED (MEDIUM)    | CLOSED (spec-verified)        | CLOSED (live-attested)         | `10721fb` (24-05) |
| GAP-24-02-A  | DEFERRED (HIGH)      | CLOSED (spec-verified)        | CLOSED (live-attested)         | `7b21520` (24-06) |
| GAP-24-06-A  | n/a (not yet surfaced) | n/a (not yet surfaced)      | CLOSED (live-attested + spec-verified) | `543f624` (24-06 inline) |
| TD-V14-WKB-SPIKE | DEFERRED to v1.5 | Unchanged (DEFERRED to v1.5)  | Unchanged (DEFERRED to v1.5)   | n/a — not a Phase 24 regression |

| Criterion | Initial | Post Gap-Closure | Post Live Re-Walk | Rationale |
| --------- | ------- | ---------------- | ----------------- | --------- |
| Criterion 1 | passed | passed | passed | No change. Initial UAT attestation stands. |
| Criterion 2 | passed | passed | passed | No change. Initial UAT attestation stands. |
| Criterion 3 | tech_debt | human_needed | **passed** | Operator live re-walked STEP 24-02/2.1 on 2026-05-11: Dashboard B rendered, four-store reset observed in full. Logout half already passed at STEP 24-02/2.2. Both halves now LIVE-attested. |
| Criterion 4 | passed | passed | passed | No change. Initial UAT attestation stands. |
| Criterion 5 | passed | passed | passed | This document — re-verified and updated 2026-05-11. |

## Criteria Results

### Criterion 1: Map click popup E2E across spatial modes and both auth modes — PASS

All six spatial-mode and popup-feature sub-steps in 24-01 passed, and both auth-mode sub-steps in 24-02 passed.

**Spatial modes verified:**

| Spatial mode | Step | Outcome | Evidence |
|---|---|---|---|
| lat/lon | STEP 24-01/1.1, STEP 24-01/1.2 | PASS | Popup opens with records; 50-record page; GEODIST-ordered results |
| WKT | STEP 24-01/1.2 | PASS | Popup opens with records; STXY_DISTANCE-ordered results |
| Kinetica-GEOMETRY (WKB route) | STEP 24-01/2.1 | PASS | ST_DISTANCE + ST_GEOMFROMTEXT SQL path; HTTP 200; rows returned |

Note: True WKB-binary column path remains deferred (TD-V14-WKB-SPIKE). The Kinetica-GEOMETRY sub-case (WKT-typed geometry column served via the WKB code route) was verified live at STEP 24-01/2.1.

**Popup features verified:**

| Feature | Step | Outcome |
|---|---|---|
| Open popup at click point | STEP 24-01/1.1 | PASS |
| Layer switch resets to page 1 | STEP 24-01/1.3 | PASS |
| Load more / pagination | STEP 24-01/1.4 | PASS |
| HTML template rendering | STEP 24-01/1.5 | PASS |
| Key-value fallback rendering | STEP 24-01/1.5 | PASS |
| Single-record nav (Back / Next / Record N of M+) | STEP 24-01/1.4 | PASS |
| Popup resize (200px min, 1200px max) | STEP 24-01/2.2 | PASS (GAP-24-01-B form read-back bug CLOSED via 24-05; live re-walk confirmed) |
| Edge-aware 4-corner anchor flip | STEP 24-01/2.3 | PASS |
| Close-X does not overlap layer dropdown | STEP 24-01/2.4 | PASS |

**Auth modes verified:**

| Auth mode | Step | Outcome | Evidence |
|---|---|---|---|
| AUTH_MODE=password | STEP 24-02/1.1 | PASS | Backend restarted in password mode; audit-log auth_mode=password observed |
| AUTH_MODE=oidc | STEP 24-02/1.2 | PASS | OIDC Authorization Code flow completed; Bearer-token auth observed |

Both auth modes exercised full info-popup E2E: map click → POST /api/info/query → records displayed in popup and Info Card.

---

### Criterion 2: Info Card receives same selection as popup — PASS

Verified at STEP 24-01/1.5 (template vs key-value in the same session) and STEP 24-01/1.6 (Info Card parity with popup).

At STEP 24-01/1.6 the operator confirmed that an Info Card configured for the same layer as the active popup displayed identical records using the same rendered output (template or key-value fallback), consistent with both surfaces importing the shared renderInfoTemplate helper from Phase 21. Template and key-value fallback both matched between popup and Info Card without a page refresh.

---

### Criterion 3: Dashboard-switch and logout clear info selection — PASS

**Logout half — PASS (STEP 24-02/2.2):**
Operator verified at STEP 24-02/2.2: logged out with content present, re-logged in, popup closed + Info Card showed empty-state placeholder, no stale records. The App.tsx UNAUTHORIZED effect calling the four-store reset (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore) fired correctly.

**Dashboard-switch half — PASS (live re-walk of STEP 24-02/2.1 on 2026-05-11):**

In the initial 2026-05-11 UAT, STEP 24-02/2.1 was BLOCKED by GAP-24-02-A. The operator opened a popup in Dashboard A and switched to Dashboard B; the console threw `Error: Image load error` at `MapChartRenderer.tsx:483` followed by `Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node'`, and Dashboard B did not render.

**Post gap-closure (commit `7b21520` from 24-06) + inline regression fix (commit `543f624`):** The crash root cause (async OL XHR image-load resolving after React unmount → OL renderFrame → insertBefore on detached container) is fixed by a `mountedRef` cleanup-gate. Effect 1's cleanup flips `mountedRef.current = false` as the FIRST statement before `map.setTarget(undefined)` / `map.dispose()`. Four async paths now short-circuit: xhr.onreadystatechange (the primary site that mutates `image.getImage().src`), handleTileError, handleTileLoadEnd, and Effect 6's singleclick handler (top + post-await + catch). The inline 543f624 fix re-arms `mountedRef.current = true` on every Effect 1 setup so React 18 StrictMode's mount-cleanup-mount cycle does not strand the cleanup-gate in the closed position on the second mount.

**Spec-level verification (Tests L / L2 / L3 + M in MapChartRenderer.spec.tsx):**
- Test L: xhr.onreadystatechange firing post-unmount does NOT mutate `image.src` and does NOT call `image.getImage()` (the observable that gates OL's renderFrame → insertBefore chain).
- Test L2: handleTileError stored handler invoked post-unmount does NOT call `useToastStore.showToast`.
- Test L3: handleTileLoadEnd stored handler invoked post-unmount does NOT throw.
- Test M: StrictMode-style mount → cleanup → mount sequence leaves `mountedRef.current === true` after the second mount; post-second-mount xhr.onreadystatechange path successfully mutates `image.src` (cleanup-gate is correctly re-armed each setup).

**Live operator re-walk (2026-05-11):** Operator opened Dashboard A → clicked map → popup opened with records → switched to Dashboard B. Dashboard B rendered fully (no Error: Image load error; no NotFoundError: insertBefore). The four-store reset fired AND was observable: filter chips cleared, filter view materialization references dropped, info-selection state cleared, last-click-context cleared. Round-trip A→B→A→B remained stable. Note: the WMS-initial-paint regression GAP-24-06-A surfaced during this re-walk and was fixed inline (commit 543f624) before the final attestation; once fixed, the re-walk was repeated and passed cleanly.

**Criterion 3 status: PASS.** Both halves (logout + dashboard-switch) are live-attested.

---

### Criterion 4: Per-layer and per-widget kill switches suppress popup — PASS

Both kill-switch variants verified at STEP 24-02/1.3 and STEP 24-02/1.4.

| Kill switch type | Step | Outcome | Evidence |
|---|---|---|---|
| Per-layer kill switch (info_enabled = 0) | STEP 24-02/1.3 | PASS | Disabled layer absent from popup layer dropdown; fan-out request skipped entirely |
| Per-widget kill switch (infoEnabled: false on widget config) | STEP 24-02/1.4 | PASS | Zero POST /api/info/query requests observed when infoEnabled set to OFF; no popup opened on map click |

---

### Criterion 5: 24-VERIFICATION.md committed in 17-VERIFICATION.md format — PASS

This document — re-verified and updated 2026-05-11 to reflect gap closure AND closing live re-walk. Frontmatter retains YAML structure with `phase`, `overall_status`, `verified_on`, `updated`, `operator`, `re_verification`, `criteria_status`, `gaps`, `session_fixes_verified`, `test_coverage`, `environment`, `human_verification`. Body sections: Summary → Re-Verification Diff → Criteria Results → Session Fixes Verified → Auth Modes Exercised → Resolved Gaps → Carried Tech Debt → What This Verification Did Not Cover → Requirements Coverage → Sign-off.

---

## Session Fixes Verified

All seven post-Phase-23 session fixes are confirmed by UAT step evidence.

| Session Fix | Description | Step | Outcome |
|---|---|---|---|
| bbox projection (EPSG:3857→4326) | MapChartRenderer transforms click coords from OL internal EPSG:3857 to EPSG:4326 before sending to POST /api/info/query | STEP 24-01/1.1 | PASS — mapBbox values observed in 4326 range; GEODIST query returned correct records |
| Kinetica-GEOMETRY SQL | When spatialMode='wkb' and column is Kinetica-GEOMETRY (WKT-typed), server issues ST_DISTANCE + ST_GEOMFROMTEXT — the Session Fix #1 narrowing | STEP 24-01/2.1 | PASS — HTTP 200; records returned; correct SQL template confirmed |
| single-record nav | Back/Next navigation buttons + Record N of M+ indicator + auto-fetch on Next at last loaded record | STEP 24-01/1.4 | PASS — all nav controls functional; auto-fetch triggered correctly |
| popup resize config | Popup respects infoPopupWidthPx / infoPopupHeightPx from widget config (200px min, 1200px max clamp) | STEP 24-01/2.2 | PASS — popup renders at configured size; MapConfigPanel form read-back fixed (GAP-24-01-B closed via 24-05; live re-walk confirmed) |
| edge-aware positioning | Popup anchor flips between 4 corners (bottom-left, bottom-right, top-left, top-right) to stay within viewport | STEP 24-01/2.3 | PASS — anchor flip confirmed at all screen edges |
| close-X overlap | Close button positioned absolutely at top-right of popup chrome; does not overlap layer dropdown | STEP 24-01/2.4 | PASS — no visual overlap observed |
| filter-view alignment | POST /api/info/query includes viewName (_kbi_filt_...) when filter active; routes query to filtered view | STEP 24-02/2.3 | PASS — viewName present in payload when filter active; absent when filter cleared; rows correctly subset |

---

## Auth Modes Exercised

Both AUTH_MODE values were exercised in full info-popup flows during the Phase 24 UAT session on 2026-05-11.

**AUTH_MODE=password (STEP 24-02/1.1):**
Backend restarted with `.env` updated to `AUTH_MODE=password`. Operator completed the full info-popup flow: map click → POST /api/info/query → popup opened with records. Audit-log entry confirmed `auth_mode=password` for the info-query request. Operator attestation: 2026-05-11.

**AUTH_MODE=oidc (STEP 24-02/1.2):**
Backend restarted with `AUTH_MODE=oidc`. Operator completed the OIDC Authorization Code flow, then performed the full info-popup flow. Bearer-token authentication observed in the POST /api/info/query request headers. Operator attestation: 2026-05-11.

This extends the v1.3 OIDC S2.b closure (operator confirmed in Phase 17 on 2026-05-07 for the filter-materialize endpoint) to the v1.4 info-query endpoint. Both endpoints use the same `kineticaSql(req, ...)` auth branching pattern; both are now confirmed live under OIDC.

---

## Resolved Gaps

Four gaps were discovered during the Phase 24 cycle (three during initial UAT 2026-05-11; one — GAP-24-06-A — surfaced during the closing live re-walk against the post-24-06 build). All four landed code fixes with regression coverage and live operator attestation on 2026-05-11.

| Gap ID | Severity | Discovery Step | Closing Plan / Commit | Status |
|---|---|---|---|---|
| GAP-24-01-A | HIGH | After STEP 24-01/1.6 | 24-04 / `18387fa` | CLOSED (live-attested 2026-05-11) |
| GAP-24-01-B | MEDIUM | STEP 24-01/2.2 | 24-05 / `10721fb` | CLOSED (live-attested 2026-05-11) |
| GAP-24-02-A | HIGH | STEP 24-02/2.1 | 24-06 / `7b21520` | CLOSED (live-attested 2026-05-11) |
| GAP-24-06-A | HIGH | Live re-walk against post-24-06 build | 24-06 inline / `543f624` | CLOSED (live-attested + spec-verified 2026-05-11) |

**GAP-24-01-A resolution (24-04, commit `18387fa`):** Per-layer `sourceListenerCleanupRef: Map<number, () => void>` in `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (line 426). Effect 2's REMOVE branch invokes the cleanup BEFORE `map.removeLayer` (lines ~596). Effect 1's unmount cleanup iterates the Map (lines 545-561) and clears `imageLayersRef` + `imageSourcesRef` + `lastEmittedParamsRef` + `sourceListenerCleanupRef` so dashboard-switch / remount sequences start with empty bookkeeping. Root-cause comment block authored at MapChartRenderer.tsx:200. Regression coverage: 5 vitest specs — LayersModal.spec.tsx Tests 14 (ON→OFF) and 14b (OFF→ON); MapChartRenderer.spec.tsx Tests K (contract: source.un called alongside map.removeLayer), K2 (defensive: stale listener invocation does not throw), K3 (round-trip: OFF→ON re-adds). Live operator re-walk 2026-05-11: confirmed eye-toggle ON↔OFF keeps the app rendered.

**GAP-24-01-B resolution (24-05, commit `10721fb`):** `useEffect` + `useRef` re-sync hooks for `radiusDraft` / `widthDraft` / `heightDraft` in `kinetica_bi/src/components/charts/MapConfigPanel.tsx` (lines 85-115). `priorWidthRef` / `priorHeightRef` capture the prior config-derived value. Mid-type guard `if (draft === String(priorRef.current))` distinguishes 'draft is the prior config echo' (re-sync safe) from 'user mid-type' (leave alone; clamp-on-blur reconciles). Phase 22 clamp-on-blur invariant preserved (FIX B chosen over full controlled-input refactor). Regression coverage: 5 vitest specs in MapConfigPanel.spec.tsx (lines 323-378) — width / height / radius non-default read-back, parent-rerender re-sync, mid-type guard non-clobber. Live operator re-walk 2026-05-11: saved width/height values display on MapConfigPanel reopen.

**GAP-24-02-A resolution (24-06, commit `7b21520`):** `mountedRef = useRef<boolean>(true)` cleanup-gate in `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (line 439). Effect 1's cleanup flips `mountedRef.current = false` as the FIRST statement (line 542), BEFORE `map.setTarget(undefined)` / `map.dispose()`. Four async paths guarded with `if (!mountedRef.current) return;`: xhr.onreadystatechange (line 477) — primary site, prevents `image.getImage().src` mutation that triggers OL renderFrame → insertBefore on detached container; handleTileError (line 648); handleTileLoadEnd (~line 661); Effect 6 singleclick (top-of-handler + post-await + catch). Mirrors v1.3 Phase 15's materializeAbortRef pattern (LIFE-V13-04). Pairs with 24-04 as orthogonal+complementary defense-in-depth — GAP-24-01-A's per-layer listener cleanup is insufficient on its own because the OL DOM-insert that throws happens INSIDE OL's internal renderFrame (NOT inside the React-bound listeners); the XHR resolves and mutates `image.getImage().src` independently. Regression coverage: 3 vitest specs in MapChartRenderer.spec.tsx — Tests L (XHR post-unmount no-op), L2 (handleTileError post-unmount no-toast), L3 (handleTileLoadEnd post-unmount no-throw). Live operator re-walk 2026-05-11: Dashboard A → Dashboard B switch renders B fully, four-store reset observed, no crash.

**GAP-24-06-A resolution (24-06 inline, commit `543f624`):** Root cause: `useRef` preserves `.current` across React 18 StrictMode's mount → cleanup → mount cycle. The 24-06 fix correctly flipped `mountedRef.current = false` in Effect 1's cleanup on real unmount, but Effect 1's setup never re-armed the ref to `true` on subsequent runs. Under StrictMode, the second mount inherited `mountedRef.current === false` from the StrictMode-induced cleanup pass; the very next xhr.onreadystatechange callback short-circuited the `if (!mountedRef.current) return;` guard at line 477 and never mutated `image.getImage().src`, leaving the WMS image element with no source and the tile never painted on map load. Fix: Effect 1's setup body re-arms `mountedRef.current = true` as its FIRST statement on every run, so each (re-)mount starts the async-callback gate in the open position; cleanup continues to flip to false as before. The fix is symmetric with the cleanup gate and does NOT regress GAP-24-02-A — on real unmount the cleanup still flips to false BEFORE `map.setTarget(undefined)` / `map.dispose()`, so any in-flight callbacks still see the closed gate. Regression spec: `MapChartRenderer.spec.tsx` Test M — verifies that a StrictMode-style mount → cleanup → mount sequence on the same component instance leaves `mountedRef.current === true` after the second mount, and that the post-second-mount xhr.onreadystatechange path successfully mutates `image.src`. Live operator re-walk 2026-05-11: WMS layer paints correctly on map load post-fix. Completes the defense-in-depth triad alongside 24-04 (eager listener detach) and 24-06 (mountedRef cleanup-gate).

---

## Carried Tech Debt

### TD-V14-WKB-SPIKE: True WKB-binary spatial mode — DEFERRED (inherited from Phase 18; NOT a Phase 24 regression; NOT a v1.4 blocker)

**Severity:** Medium
**Deferred to:** v1.5 (pending WKB-binary column access)

**Phase 18 outcome (locked 2026-05-08):** Spike runner initially returned HTTP 400 on all probes due to a missing production payload fields bug (commit `d458408` fixed this). Second run revealed no WKB-binary column reachable — operator's fixture used a WKT-typed (`geom WKT`) column which Kinetica surfaced as GEO, not true WKB-binary. Spike outcome locked as `NONE_ESCALATE → TECH_DEBT`. SPATIAL-V14-03 deferred. Plan 18-02 `buildWkbQuery` throws `WkbDeferredError("WKB mode deferred — TD-V14-WKB-SPIKE")`; Plan 18-03 endpoint returns HTTP 501 for `spatialMode='wkb'`.

**Phase 24 narrowing (Session Fix #1):** The Kinetica-GEOMETRY sub-case is closed. When a layer's column is WKT-typed Kinetica geometry and spatialMode='wkb', the server issues `ST_DISTANCE(geom_col, ST_GEOMFROMTEXT('POINT(lon lat)'))` — verified live at STEP 24-01/2.1 with HTTP 200 and correct records returned. This sub-case was the Session Fix applied during Phase 21 development. It is narrower than the full WKB-binary case.

**Phase 24 does NOT close TD-V14-WKB-SPIKE.** It inherits Phase 18's deferral verbatim. Re-running the spike requires a real WKB-binary column (`geom` typed as BYTES, not text/WKT). Runner is production-parity at commit `d458408`; future re-run is one `npm run wkb-spike` away. NOT a v1.4 blocker — v1.4 ships successfully without true WKB-binary support.

---

### TD-V12-04: Visible filter narrowing fixture-based demo — CLOSED

**Severity:** Low
**Status:** CLOSED via STEP 24-02/2.3 evidence (2026-05-11)

**Phase 17 history:** Carried from v1.3. Operator used `demo.nyctaxi` for Phase 17 UAT instead of creating `ki_home.v13_filter_fixture`. Filter behavior was verified end-to-end, but the dense urban dataset made visual narrowing subtle — exactly the problem TD-V12-04 was created to solve.

**Phase 24 closure:** At STEP 24-02/2.3, the operator verified viewName routing end-to-end: `_kbi_filt_...` present in POST /api/info/query payload when filter active, absent when filter cleared, rows correctly subset to filtered dataset. At STEP 24-02/2.4, the operator confirmed this as sufficient closure for TD-V12-04. The viewName routing mechanism — which was the originally unverified behavior in TD-V12-04 — is now fully verified for the v1.4 info-query path. TD-V12-04 is CLOSED.

---

## What This Verification Did NOT Cover

- **True WKB-binary spatial mode.** SPATIAL-V14-03 remains deferred as TD-V14-WKB-SPIKE. No WKB-binary column was reachable during Phase 18 spike; Phase 24 did not attempt a second spike. The Kinetica-GEOMETRY sub-case (WKT-typed geometry column served via the WKB route) was verified at STEP 24-01/2.1, but that is not the full WKB-binary path.

- **Backend test suite re-validation.** TD-V11-04 (OIDC mock divergence) and TD-V13-01 (fetch-mock brittleness under Node 24 / vitest 4) remain pre-existing failures. Phase 24 scope is frontend-regression + documentation only; backend suite re-validation is deferred.

- **v13 filter fixture materialization.** `ki_home.v13_filter_fixture` was not materialized during Phase 24 UAT. TD-V12-04 is considered closed via viewName routing verification (STEP 24-02/2.3), not via fixture-based visual narrowing demo.

---

## Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
| ----------- | ------ | ----------- | ------ | -------- |
| VERIFY-V14-01 | REQUIREMENTS.md line 65 + line 136 | End-to-end verification documented for map click → spatial query → popup → layer switch → pagination → HTML template → Info Card → dashboard switch clears selection → kill switches; all 3 spatial modes + both auth modes; 17-VERIFICATION.md pattern. | **Complete (live-attested)** — All five success criteria PASSED including criterion_3 (dashboard-switch + logout both clear info selection), confirmed by operator live re-walk on 2026-05-11. Re-graded in REQUIREMENTS.md from `Tech-Debt` to `Complete`. | This document; 24-04/05/06 SUMMARYs; commits `18387fa`, `10721fb`, `7b21520`, `543f624`; 523/523 vitest; operator attestation 2026-05-11 |

**No orphaned requirements** — VERIFY-V14-01 is the only requirement ID declared for Phase 24, and it is the only one assigned to Phase 24 in REQUIREMENTS.md (line 136).

---

## Sign-off

- **Operator:** Rydel Pereira (rpereira@kinetica.com)
- **Initial UAT date:** 2026-05-11
- **Gap-closure date:** 2026-05-11 (24-04 / 24-05 / 24-06 all landed)
- **Inline regression fix date:** 2026-05-11 (GAP-24-06-A closed via commit 543f624)
- **Live re-walk date:** 2026-05-11
- **Final re-verification date:** 2026-05-11
- **Status:** `passed` — Operator live-attested STEP 24-02/2.1 (dashboard-switch + four-store reset), STEP 24-01 (layer-visibility), and STEP 24-01/2.2 (popup-dim read-back). Criterion_3 upgraded human_needed → passed. Overall_status upgraded human_needed → passed. v1.4 milestone is fully closed.

All five success criteria PASS: criterion_1 PASS, criterion_2 PASS, criterion_3 PASS (both logout and dashboard-switch halves live-attested), criterion_4 PASS, criterion_5 PASS. OIDC end-to-end verified live (STEP 24-02/1.2). Kinetica-GEOMETRY SQL path closed (STEP 24-01/2.1). TD-V12-04 closed via STEP 24-02/2.3. All 4 v1.4-cycle gaps (GAP-24-01-A, GAP-24-01-B, GAP-24-02-A, GAP-24-06-A) closed with code fixes + regression coverage + live operator attestation. TD-V14-WKB-SPIKE inherited unchanged from Phase 18 (not a v1.4 regression and not a v1.4 blocker).
