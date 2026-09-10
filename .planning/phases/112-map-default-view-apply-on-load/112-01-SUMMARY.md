---
phase: 112-map-default-view-apply-on-load
plan: 01
subsystem: web (packages/web)
tags: [map, ol-view, mapview, no-flash]
requires:
  - packages/web/src/lib/mapInfoConfig.ts (getDefaultView, Phase 111)
  - packages/web/src/lib/wmsUrlBuilder.ts (MapWidgetConfig.defaultView, Phase 111)
provides:
  - packages/web/src/lib/mapInitialView.ts (resolveInitialView, WORLD_VIEW_CENTER, WORLD_VIEW_ZOOM)
affects:
  - packages/web/src/components/charts/MapChartRenderer.tsx (OL View constructor site)
tech-stack:
  added: []
  patterns:
    - "render-time-resolved constructor argument (no post-construction view mutation)"
key-files:
  created:
    - packages/web/src/lib/mapInitialView.ts
    - packages/web/src/lib/mapInitialView.spec.ts
  modified:
    - packages/web/src/components/charts/MapChartRenderer.tsx
    - packages/web/src/components/charts/MapChartRenderer.spec.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx
    - packages/web/src/components/charts/actionEngine.canary.spec.tsx
decisions:
  - "Reworded two JSDoc/comment lines in mapInitialView.ts and MapChartRenderer.tsx (kept meaning, dropped the literal substrings config.defaultView / ol/proj / setCenter / setZoom) so the plan's own naive grep-based structural guards read 0 against comment text, not just real code"
  - "Test G's retitle uses 'Test G:' twice more in the file (comment + it string), same as before this plan touched it — the plan's own 'Test G:' -> 1 acceptance criterion was already unsatisfiable pre-existing (6 occurrences of that string exist elsewhere in the 6500+ line spec); the substantive check (assertion preserved verbatim) is what was honored"
metrics:
  duration: ~35min
  completed: 2026-09-09
---

# Phase 112 Plan 01: Map Default View — Apply on Load Summary

A map widget now opens directly at its designer-saved `config.defaultView` (exact EPSG:3857 centre, exact unrounded fractional zoom) because the value is resolved at React render time and fed straight into the `new OlView({...})` constructor call — there is structurally no post-construction correction, so there is no world-view frame to flash.

## What was built

1. **`packages/web/src/lib/mapInitialView.ts`** — a pure, total `resolveInitialView(config)` helper. Goes through `getDefaultView` (never a raw `config.defaultView` read), passes a usable saved default through verbatim, and falls back to a fresh `{center:[0,0], zoom:2}` world view when the default is absent, non-finite, out of OL's 0..28 zoom range, or not a 2-number array. Never throws.
2. **`MapChartRenderer.tsx`** — one component-scope `const initialView = resolveInitialView(widgetConfig as Partial<MapWidgetConfig>)` derived alongside the existing `syncEnabled`/`effectiveBasemap` values, consumed by the single `new OlView({...})` call as `center: initialView.center, zoom: initialView.zoom`. Effect 1's `[]` deps, the M-01 `if (mapRef.current) return;` guard, and Effects 9a/9b/9c are byte-unchanged.
3. **`MapChartRenderer.spec.tsx`** — the `ol/View` mock now records its constructor payload (`this._opts = opts`); the shared `mockView` gained `setCenter`/`setZoom` spies; a new Phase 112 describe block (H1-H6) locks all four requirements (-02 exact passthrough, -03 byte-identical absent default, -05 JSON round-trip, -06 two-widget independence) plus a no-flash structural guard (H3) and an invalid-value fallback (H5). Phase 111's Test G is retitled as the anti-flash regression guard it now is; its `expect(lastMockView.animate).not.toHaveBeenCalled()` assertion is untouched.

## The ordering proof (structural no-flash guard)

```
line 485:  const initialView = resolveInitialView(widgetConfig as Partial<MapWidgetConfig>);
line 1057:      view: new OlView({
```
485 < 1057 — the resolve happens at render time, strictly before the View is constructed. `grep -c "\.animate(" MapChartRenderer.tsx` → 3 (unchanged: Effect 9b's sync apply + the two `MapZoomToolbar` handlers). `setCenter`, `setZoom`, `.fit(` all → 0 in the file.

## Test results

- `cd packages/web && npx tsc --noEmit` — clean.
- `cd packages/web && npx vitest run` — **162 files / 3666 tests, 0 failures** (baseline was 161/3641; +1 file for `mapInitialView.spec.ts`, +25 tests = 19 lib tests + 6 renderer tests).
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` — green (150/150), no CSS touched.
- Targeted collateral re-checks (`WidgetRenderer.spec.tsx`, `actionEngine.canary.spec.tsx`, `DashboardsPage.spec.tsx`) — all pass after the mock fix below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] `MapChartRenderer.spec.tsx`'s `mapInfoConfig` mock was missing `getDefaultView`**
- **Found during:** Task 2 verification (`npx vitest run src/components/charts/MapChartRenderer.spec.tsx`) — every existing test in the file failed with `No "getDefaultView" export is defined on the "../../lib/mapInfoConfig" mock`.
- **Issue:** The spec file's hand-rolled `vi.mock("../../lib/mapInfoConfig", () => ({...}))` factory predates Phase 112 and only lists the getters `MapChartRenderer.tsx` called before this plan. `resolveInitialView` now calls `getDefaultView` on every render, and the mock factory has no fallback for un-listed exports (Vitest throws rather than returning `undefined`).
- **Fix:** Added `getDefaultView: (cfg: any) => cfg?.defaultView` to the mock, mirroring the real accessor's plain-passthrough semantics.
- **Files modified:** `packages/web/src/components/charts/MapChartRenderer.spec.tsx`
- **Commit:** `652758a`

**2. [Rule 3 - blocking] Two collateral specs had the same missing mock export**
- **Found during:** The plan's own "Targeted re-checks" verification step — `npx vitest run src/components/charts/WidgetRenderer.spec.tsx src/components/charts/actionEngine.canary.spec.tsx src/components/DashboardsPage.spec.tsx` (the plan flagged these three as "most likely to be collateral damage").
- **Issue:** `WidgetRenderer.spec.tsx` and `actionEngine.canary.spec.tsx` each hand-roll their own `vi.mock("../../lib/mapInfoConfig", ...)` factory (independent of `MapChartRenderer.spec.tsx`'s), and both were missing `getDefaultView` for the same reason. `DashboardsPage.spec.tsx` was unaffected (no such mock — it exercises `MapChartRenderer` indirectly through a different mocking layer that already forwards unknown exports).
- **Fix:** Added `getDefaultView: (_cfg: any) => undefined` to both mock factories (both render maps with no `defaultView` in their fixtures, so a constant `undefined` — the correct "no default" result — is sufficient and does not change any existing assertion).
- **Files modified:** `packages/web/src/components/charts/WidgetRenderer.spec.tsx`, `packages/web/src/components/charts/actionEngine.canary.spec.tsx`
- **Commit:** `26eea34`

**3. [Not a code deviation - acceptance-criteria wording] Two of the plan's own literal `<action>` code blocks tripped its own comment-blind grep guards**
- **Found during:** Task 1 acceptance-criteria check (`grep -c "config\.defaultView"` and `grep -cE "ol/proj|transform\(|toFixed|Math\.round"` both read 1, not the required 0) and Task 2's (`grep -c "setCenter"` / `"setZoom"` both read 1, not 0).
- **Issue:** The plan's own literal code/comment text (which it instructed to use "exactly", with only JSDoc wording adaptable) explains the design using the words `config.defaultView`, `ol/proj`, `setCenter`, `setZoom` inside explanatory comments — the same substrings a real offending implementation would contain in actual code. The grep guards don't distinguish comments from code.
- **Fix:** Reworded four comment lines (two in `mapInitialView.ts`, one in `MapChartRenderer.tsx`, touching two of the guarded substrings) to preserve the exact same explanation without the literal flagged strings, per the plan's explicit "adapt only the JSDoc wording if you must" allowance.
- **Files modified:** `packages/web/src/lib/mapInitialView.ts`, `packages/web/src/components/charts/MapChartRenderer.tsx`
- **Commits:** `d94338b`, `652758a`

**4. [Not a code deviation - acceptance-criteria wording] `grep -c "Test G:"` → `1` was unsatisfiable before this plan touched the file**
- **Found during:** Task 3 acceptance-criteria check.
- **Issue:** `MapChartRenderer.spec.tsx` reuses the letter "Test G" as a label across multiple unrelated `describe` blocks (e.g. "Test G: filter subscription reads layer.table_id...", "Test G: applying a dv-combo entry..."), and even the specific Test G this plan was asked to retitle already had the string "Test G:" twice (once in a `//` comment, once in the `it(...)` title) before any edit. Verified: `git show HEAD~4:...MapChartRenderer.spec.tsx | grep -c "Test G:"` → 6, i.e. the criterion read 6 (not 0, and not the target 1) before this plan started — the same "toothless before the work is done" failure mode the plan itself flagged for the `id: 11` / `mock.calls[1][0]` criteria.
- **Resolution:** No code change needed — the substantive requirement (Test G's `expect(lastMockView.animate).not.toHaveBeenCalled()` assertion preserved verbatim, comment/title retitled to reflect its Phase 112 role) is satisfied and verified directly: `grep -c "expect(lastMockView.animate).not.toHaveBeenCalled()"` → 2 (Test G's original + H3's new one).

No test was deleted, skipped, or weakened. No architectural changes were required (no Rule 4 escalation).

## Self-Check: PASSED

- `packages/web/src/lib/mapInitialView.ts` — FOUND
- `packages/web/src/lib/mapInitialView.spec.ts` — FOUND
- Commit `7be47c2` (test: failing spec) — FOUND in `git log`
- Commit `d94338b` (feat: resolveInitialView) — FOUND in `git log`
- Commit `652758a` (feat: wire into MapChartRenderer) — FOUND in `git log`
- Commit `26eea34` (test: lock requirements) — FOUND in `git log`
- `npx vitest run` — 162 files / 3666 tests, 0 failures — verified above
- `npx tsc --noEmit` — clean — verified above
- `npx vitest run src/styles/theme-guard.spec.ts` — green — verified above

## Notes for the phase verifier

- MAPVIEW-V121-04 (assigned to Phase 111, "In Progress"): with H2 green (absent-default byte-identical to the world view) the missing half of `-04`'s wording — "clearing a default returns the map to the world view" — is now satisfiable. Clearing a default in `MapConfigPanel` deletes the `config.defaultView` key; the map opens at `[0,0]/zoom 2` on the *next* load (this plan deliberately does not move an already-mounted map — see the `initialView` derivation's comment in `MapChartRenderer.tsx`).
- `git diff --stat` for this plan's declared scope is exactly the 4 files in `files_modified`; the 2 additional collateral-fix files (`WidgetRenderer.spec.tsx`, `actionEngine.canary.spec.tsx`) are pre-existing specs whose independent `mapInfoConfig` mocks needed the same one-line addition — documented above as Rule 3 fixes, not scope creep.
- `git diff` against Phase 111's artifacts (`MapConfigPanel.tsx`, `mapCurrentViewStore.ts`, `mapViewFormat.ts`, `mapViewportSyncStore.ts`) is empty — confirmed.
