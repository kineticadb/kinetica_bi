---
phase: 111-map-default-view-capture-save
plan: 01
subsystem: ui
tags: [zustand, ol-proj, openlayers, map, typescript]

# Dependency graph
requires: []
provides:
  - "useMapCurrentViewStore — widgetId-keyed live-view Zustand store (publish/clear/reset)"
  - "formatLatLon / formatZoom — EPSG:3857 to human-readable display formatters"
  - "MapWidgetConfig.defaultView optional field (EPSG:3857 center + exact fractional zoom)"
  - "getDefaultView(config) canonical read accessor"
affects: [111-02-publisher, 111-03-consumer, 112-map-default-view-apply-on-load]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "widgetId-keyed Zustand store mirroring mapViewportSyncStore's dashboardId-keyed shape, but always-on (no sync-toggle gate)"
    - "getDefaultView follows the existing mapInfoConfig.ts getter convention, but returns undefined-as-default instead of substituting a value"

key-files:
  created:
    - packages/web/src/store/mapCurrentViewStore.ts
    - packages/web/src/store/mapCurrentViewStore.spec.ts
    - packages/web/src/lib/mapViewFormat.ts
    - packages/web/src/lib/mapViewFormat.spec.ts
  modified:
    - packages/web/src/lib/wmsUrlBuilder.ts
    - packages/web/src/lib/mapInfoConfig.ts
    - packages/web/src/lib/mapInfoConfig.spec.ts

key-decisions:
  - "mapCurrentViewStore is a separate store from mapViewportSyncStore (Phase 104) — that one is sync-toggle-gated and dashboardId-keyed (last-writer-wins), unsuitable as the live-view source for a per-widget config readout"
  - "defaultView stored in EPSG:3857 (OL's native projection), not EPSG:4326 — avoids a lossy round-trip against the exact-fractional-zoom lock; formatLatLon/formatZoom are DISPLAY-ONLY and never touch the stored value"
  - "getDefaultView returns undefined as the correct default (no substituted fallback value, unlike every other getter in mapInfoConfig.ts) — Phase 112 owns the world-view fallback"

requirements-completed: [MAPVIEW-V121-01, MAPVIEW-V121-04]

# Metrics
duration: 12min
completed: 2026-09-09
---

# Phase 111 Plan 01: Foundations — Live-View Store, Display Formatter, Config Field Summary

**WidgetId-keyed Zustand store for live OL view + EPSG:3857-to-degrees display formatter + `MapWidgetConfig.defaultView` storage field with canonical getter — all pure/store modules, zero component or renderer changes.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-09T18:35:00Z
- **Completed:** 2026-09-09T18:48:16Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `useMapCurrentViewStore` — an always-on, widgetId-keyed live-view store with `publish`/`clear`/`reset`, isolated per widget, preserving the exact unrounded fractional zoom
- `formatLatLon` / `formatZoom` — pure display formatters producing the CONTEXT.md-locked `"40.71°N, 74.01°W"` / `"12.4"` shapes, verified against real `ol/proj` (no mocking)
- `MapWidgetConfig.defaultView` optional field plus `getDefaultView()` — the single canonical read path, with `undefined` as the correct default state (not a substituted value)

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: Create the widgetId-keyed live-view store**
   - `b27f899` (test) — failing spec: I1/I2 initial state, P1-P4 publish/isolation/exact-zoom, C1/C2 clear, R1 reset
   - `b91c97e` (feat) — store implementation, 9/9 tests passing
2. **Task 2: Create the pure EPSG:3857 -> human-readable view formatter**
   - `28710c2` (test) — failing spec against real `ol/proj`
   - `ca40c4b` (feat) — formatter implementation + spec wording fix (see Deviations), 8/8 tests passing
3. **Task 3: Add the defaultView config field and its canonical getter**
   - `f39bf1d` (feat) — `MapWidgetConfig.defaultView` field, `getDefaultView()`, spec extension (not TDD-flagged in plan; single commit)

_Note: Tasks 1 and 2 were TDD (`tdd="true"`), so each has a test-then-feat commit pair; Task 3 was a plain `auto` task._

## Files Created/Modified
- `packages/web/src/store/mapCurrentViewStore.ts` - widgetId-keyed live-view store (publish/clear/reset), 13th store in the logout/dashboard-switch cleanup chain (wiring deferred to 111-02)
- `packages/web/src/store/mapCurrentViewStore.spec.ts` - 9 tests covering initial state, publish/overwrite/isolation, exact-fractional-zoom, clear, reset
- `packages/web/src/lib/mapViewFormat.ts` - `formatLatLon`/`formatZoom` pure display formatters
- `packages/web/src/lib/mapViewFormat.spec.ts` - 8 tests against real `ol/proj` (hemisphere letters, no minus signs, 1dp zoom, no mutation of stored value)
- `packages/web/src/lib/wmsUrlBuilder.ts` - added `defaultView?: { center: [number, number]; zoom: number }` to `MapWidgetConfig` (single occurrence, not wired into any WMS param path)
- `packages/web/src/lib/mapInfoConfig.ts` - added `getDefaultView()` following the file's existing getter convention
- `packages/web/src/lib/mapInfoConfig.spec.ts` - added 4 tests: legacy-absent, explicit-undefined, unrounded passthrough, falsy zoom:0 edge case

## Decisions Made
- Followed the plan's specified interfaces verbatim — no architectural deviation.
- `mapCurrentViewStore` deliberately does NOT reuse `mapViewportSyncStore` (Phase 104): documented in the header comment (`Never add a syncViewport gate here`) so future maintainers don't conflate the two stores.
- `getDefaultView` breaks from every other getter in `mapInfoConfig.ts` by returning `undefined` as the correct default rather than substituting a value — documented inline since it is the one getter in the file that behaves this way.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a spec-wording false positive against its own acceptance grep**
- **Found during:** Task 2 (formatter spec/acceptance verification)
- **Issue:** The spec's own explanatory comment said "(no vi.mock)" to describe that the test uses real `ol/proj`. The plan's acceptance criterion greps the spec file for the literal string `vi.mock` and requires a count of 0 (proving no mocking is used) — the comment's own wording tripped that same grep as a false positive.
- **Fix:** Reworded the comment to "(unmocked)" instead of "(no vi.mock)" — same meaning, no longer matches the literal grep target.
- **Files modified:** `packages/web/src/lib/mapViewFormat.spec.ts`
- **Verification:** `grep -c 'vi.mock' src/lib/mapViewFormat.spec.ts` returns 0; spec still passes 8/8.
- **Committed in:** `ca40c4b` (bundled with the Task 2 GREEN commit, since it only touched the just-created spec file before its RED commit's intent was compromised)

**2. [Rule 1 - Bug] Reverted premature requirement completion**
- **Found during:** post-execution STATE.md/REQUIREMENTS.md update step
- **Issue:** `requirements mark-complete MAPVIEW-V121-01 MAPVIEW-V121-04` was run per this plan's frontmatter `requirements:` field, but 111-02-PLAN.md and 111-03-PLAN.md both also declare these same two IDs — this is a known multi-plan-requirement gotcha (a plan's `requirements` field can list a requirement the phase only *finishes* in a later plan). 111-01 ships only the non-user-facing foundation (store/formatter/config field); the actual save/clear UX is not functional until 111-03 wires the consumer UI.
- **Fix:** Reverted `REQUIREMENTS.md` checkboxes for MAPVIEW-V121-01/-04 back to unchecked and the traceability table to "In Progress (111-01/3 done)".
- **Files modified:** `.planning/REQUIREMENTS.md`
- **Verification:** `grep -n "MAPVIEW-V121-01\|MAPVIEW-V121-04" .planning/REQUIREMENTS.md` shows unchecked boxes and "In Progress" status.
- **Committed in:** final metadata commit for this plan

---

**Total deviations:** 2 auto-fixed (1 bug — self-referential acceptance-check false positive; 1 bug — premature requirement-completion revert)
**Impact on plan:** Both cosmetic/bookkeeping-only; no behavior change, no scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 111-02 (publisher: wires `MapChartRenderer` to call `useMapCurrentViewStore.getState().publish(...)` on `moveend`, plus lifecycle cleanup wiring) and 111-03 (consumer: `MapConfigPanel` UI reading the live view + saving/clearing `defaultView`) can now import all three artifacts verbatim per the plan's `<interfaces>` contract.
- `MapChartRenderer.tsx` remains byte-unchanged (confirmed via `git diff --stat`) — Phase 112's `center: [0, 0], zoom: 2` View-construction change is untouched.
- All three test gates green: `tsc --noEmit` clean, `npx vitest run` 3628/3628 passing (161 files), `theme-guard.spec.ts` 150/150 passing.

---
*Phase: 111-map-default-view-capture-save*
*Completed: 2026-09-09*

## Self-Check: PASSED

All created files and commit hashes verified present on disk / in git log:
- packages/web/src/store/mapCurrentViewStore.ts, .spec.ts
- packages/web/src/lib/mapViewFormat.ts, .spec.ts
- .planning/phases/111-map-default-view-capture-save/111-01-SUMMARY.md
- commits: b27f899, b91c97e, 28710c2, ca40c4b, f39bf1d
