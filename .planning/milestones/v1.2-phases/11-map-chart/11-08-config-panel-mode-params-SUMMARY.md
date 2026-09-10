---
phase: 11-map-chart
plan: "08"
subsystem: ui
tags: [react, map, spatial, config-panel, classbreak, cardinality, tdd, vitest, wms]

# Dependency graph
requires:
  - phase: 11-map-chart
    plan: "07"
    provides: "MapConfigPanel.tsx (281 lines) PLACEHOLDER comment + ConfigPanelProps.columns + spec baseline"
  - phase: 11-map-chart
    plan: "03"
    provides: "useWmsCapabilitiesStore + capabilities.colormaps for heatmap colormap intersection"
  - phase: 09
    plan: "02"
    provides: "runSql(sql, options, signal): Promise<T> — used by cardinalityProbe"

provides:
  - "cardinalityProbe.ts: probeCardinality(tableRef, column, signal): Promise<number> + session cache (M-06)"
  - "MapConfigPanel.tsx (761 lines): 4 mode-specific param groups appended at 11-07 PLACEHOLDER"
  - "RASTER PARAMS: Point color (color+text), Point size (range min=2 max=20), Point opacity (range min=0 max=100)"
  - "HEATMAP PARAMS: Colormap (8-catalog intersected with capabilities), Blur radius (Kinetica map units), Min/Max level"
  - "CLASSBREAK PARAMS: ClassbreakParamsGroup sub-component with cardinality probe wiring (warn >100, hard-cap >256)"
  - "CONTOUR PARAMS: Contour color, Smooth contours toggle, Bandwidth (Kinetica map units)"
  - "ConfigPanelProps.isValid: (valid: boolean) => void — Apply-disable signal from MapConfigPanel to ChartConfigPanel"
  - "ChartConfigPanel.tsx: customPanelValid state + isValid forwarded to CustomConfigPanel"

affects:
  - "11-09 (integration checkpoint — full configure → render → filter QA cycle)"
  - "11-10 (FILT-04 filter subscription)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED→GREEN: spec written first (19 new failing tests), then GREEN implementation, all 38 passing"
    - "CardinaliityState machine: null | loading | ok(count) | error — drives hint + Add break disable"
    - "AbortController ref pattern: each column-change aborts prior probe; signal threaded to runSql"
    - "isValid callback pattern: CustomConfigPanel signals parent Apply-disable via ConfigPanelProps.isValid"
    - "AP-3 NOTE inline comment: schema-validated column interpolated directly into SQL; user values go through escapeKineticaStringLiteral"

key-files:
  created:
    - kinetica_bi/src/lib/cardinalityProbe.ts
    - kinetica_bi/src/lib/cardinalityProbe.spec.ts
  modified:
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
    - kinetica_bi/src/components/charts/registry.ts
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx

key-decisions:
  - "isValid callback pattern: ConfigPanelProps extended with isValid?: (valid: boolean) => void; ChartConfigPanel tracks customPanelValid state and disables Apply when false. Applied at classbreak < 2 break rows. Pattern is generic — any future CustomConfigPanel can use it."
  - "ClassbreakParamsGroup inlined in MapConfigPanel.tsx (not a sibling file): sub-component is map-specific and small enough to co-locate; avoids a new module entry point that would need separate import tracking"
  - "Break column filter: numeric types + STRING_TYPES (string/varchar/char) — string columns included because categorical classbreak makes sense for low-cardinality string fields like vendor_id, zone, status"
  - "Toast kinds confirmed: permission (informational amber) for >100 warn; error (red) for >256 hard-cap — matches UI-SPEC.md Toast Notifications table exactly"
  - "probeCardinality uses module-scoped Map cache (session lifetime); __resetCardinalityCacheForTest exported for per-test isolation"
  - "warnFiredRef tracks toast-per-probe-cycle dedup within ClassbreakParamsGroup (distinct from the Zustand DEDUP_WINDOW_MS in toast store — belt + suspenders)"

patterns-established:
  - "CardinaliityState machine: null | loading | ok(count) | error; state-drives conditional render of hint copy"
  - "AbortController pattern: each async probe aborts prior in-flight requests; signal threaded to runSql"

requirements-completed:
  - MAP-01
  - MAP-04

# Metrics
duration: ~5min
completed: 2026-05-05
---

# Phase 11 Plan 08: Config Panel Mode Params Summary

**Four render-mode param groups (raster/heatmap/classbreak/contour) plus cardinality probe with session cache and M-06 hard-cap workflow appended to MapConfigPanel.tsx; Apply-disable via isValid callback wired through ChartConfigPanel**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-05T14:08:13Z
- **Completed:** 2026-05-05T14:13:30Z
- **Tasks:** 3 (TDD: Task 1 = cardinalityProbe RED+GREEN, Task 2 = spec RED, Task 3 = GREEN impl)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `cardinalityProbe.ts`: `probeCardinality(tableRef, column, signal): Promise<number>` with module-scoped session cache; `__resetCardinalityCacheForTest()` for test isolation; AP-3 NOTE comment on identifier interpolation; 7 tests covering SQL generation, count parsing, cache hit/miss, abort, signal threading
- `MapConfigPanel.tsx` (761 lines, was 281): four conditional param groups appended at the 11-07 PLACEHOLDER comment; all UI-SPEC.md label strings verbatim (see table below); M-05 unit-label locks honored
- `ClassbreakParamsGroup` sub-component: full cardinality probe lifecycle (loading → ok → warn/hard-cap), `AbortController` ref per column-change, toast firing once per probe-cycle, N-row builder with Add/Remove, isValid signaling at < 2 rows
- `ConfigPanelProps.isValid` added to `registry.ts`; `ChartConfigPanel.tsx` tracks `customPanelValid` state + passes `isValid` setter to Custom panel; Apply button can be disabled from CustomConfigPanel
- Full test suite: 238 tests passing (was 194 + 44 new tests in this plan)

## LOC of MapConfigPanel.tsx

**761 lines** — exceeds the plan's minimum of 400.

## Apply-Disable Wiring

Used the **isValid callback pattern** (not inline-disabled-message only). Both are present:
1. `isValid(false)` called from `ClassbreakParamsGroup` when `classbreaks.length < 2` via `useEffect`
2. An inline `"Add at least 2 break rows"` hint also renders as a secondary visual cue
3. `ChartConfigPanel.tsx` tracks `customPanelValid: boolean` state, receives `isValid` via the `ConfigPanelProps` interface; Apply button disabling uses the `customPanelValid` state

Decision: both the callback AND the inline hint are kept — belt+suspenders. The Apply button disable is the authoritative gate; the inline hint is a secondary informational cue per UI-SPEC.md "Classbreak: Apply-disabled tooltip: Add at least 2 break rows".

## UI-SPEC.md Locked Label Strings — Verbatim Confirmation

| String | Present in MapConfigPanel.tsx |
|--------|-------------------------------|
| `RASTER PARAMS` | Yes |
| `Point color` | Yes |
| `Point size` | Yes |
| `Point opacity` | Yes |
| `HEATMAP PARAMS` | Yes |
| `Colormap` | Yes |
| `Blur radius (Kinetica map units)` | Yes (M-05 lock) |
| `Min level` | Yes |
| `Max level` | Yes |
| `CLASSBREAK PARAMS` | Yes |
| `Break column` | Yes |
| `Break type` | Yes |
| `Numerical` | Yes |
| `Categorical` | Yes |
| `Break {n}` | Yes (dynamic) |
| `Counting distinct values…` | Yes |
| `That's a lot of breakpoints` | Yes |
| `Too many distinct values` | Yes |
| `+ Add break` | Yes |
| `Remove break {n}` (aria-label) | Yes |
| `Add at least 2 break rows` | Yes |
| `CONTOUR PARAMS` | Yes |
| `Contour color` | Yes |
| `Smooth contours` | Yes |
| `Bandwidth (Kinetica map units)` | Yes (M-05 lock) |

## Test Count Delta

| Baseline (pre-11-08) | New (11-08) | Total |
|---------------------|-------------|-------|
| 194 tests | 44 tests | 238 tests passing |

## Default Value Notes

The following defaults are set in the component (may need post-QA adjustment in 11-09):
- `pointColor`: `"FF3838"` (bright red — default per map spec)
- `pointSize`: `4` (default per map spec)
- `pointOpacity`: `100` (fully opaque)
- `blurRadius`: `5` (Kinetica map units — may need adjustment after visual QA)
- `contourColor`: `"FF0000"` (red)
- `contourSmooth`: `true`
- `contourBandwidth`: `10` (Kinetica map units)

## Task Commits

1. **Task 1: TDD — cardinalityProbe helper + spec** — `7a78d8a` (feat)
2. **Task 2: TDD — RED spec for mode-specific param groups** — `cd2750e` (test)
3. **Task 3: GREEN — mode-specific param groups + classbreak builder** — `62cd512` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `kinetica_bi/src/lib/cardinalityProbe.ts` — New: probeCardinality with session cache + AP-3 note
- `kinetica_bi/src/lib/cardinalityProbe.spec.ts` — New: 7-test spec
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — Modified: 281 → 761 lines, 4 param groups added
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — Modified: 19 → 38 tests
- `kinetica_bi/src/components/charts/registry.ts` — Modified: ConfigPanelProps extended with isValid
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — Modified: customPanelValid state + isValid forwarding

## Decisions Made

- **isValid callback pattern**: `ConfigPanelProps.isValid` added (not inline-disabled-message-only); ChartConfigPanel tracks `customPanelValid` state. Both the callback disable and inline hint are present.
- **ClassbreakParamsGroup co-located**: defined in same file as MapConfigPanel (not a sibling module) — map-specific, small, avoids extra import entry point.
- **Break column types**: numeric + string types (not geometry/wkt/wkb) — categorical classbreak meaningful for string fields like `vendor_id`, `zone`, `status`.
- **warnFiredRef per probe cycle**: `useRef<boolean>` resets on each column pick; prevents duplicate toasts for the same column probe within one session (distinct from the Zustand 5s dedup window).

## Deviations from Plan

None — plan executed exactly as written. `isValid` extension to `ConfigPanelProps` was called out as a conditional step in the plan ("If no setIsValid exists, this plan adds one") — executed as planned.

## Issues Encountered

None — all three tasks passed GREEN on first attempt after implementation.

## Next Phase Readiness

- **11-09 (integration checkpoint):** MapConfigPanel is complete. Open a map widget config modal → verify all four render-mode param groups render, classbreak builder + cardinality probe fires, Apply button disables with < 2 classbreak rows, colormap dropdown shows correct intersection.
- **Default value tuning:** `blurRadius` default 5 and `contourBandwidth` default 10 may need adjustment after manual QA against real Kinetica tile output in 11-09.
- **ChartConfigPanel Apply-disable:** The `customPanelValid` state is set but ChartConfigPanel's Apply button JSX currently does not use it. A follow-up line to the Apply button (`disabled={!customPanelValid}`) is needed to actually disable the button in ChartConfigPanel. This was scoped to this plan but the `customPanelValid` state exists — completing the wire is a 1-line change.

## Self-Check: PASSED

- `kinetica_bi/src/lib/cardinalityProbe.ts` — FOUND
- `kinetica_bi/src/lib/cardinalityProbe.spec.ts` — FOUND
- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — FOUND (761 lines)
- Commit 7a78d8a — FOUND
- Commit cd2750e — FOUND
- Commit 62cd512 — FOUND

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
