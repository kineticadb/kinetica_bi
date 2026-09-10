---
phase: 40-track-sub-section-ui
plan: 02
subsystem: ui
tags: [react, typescript, vitest, testing-library, wms, track-config, fingerprint]

# Dependency graph
requires:
  - phase: 40-track-sub-section-ui
    plan: 01
    provides: TrackSubSection.tsx pure controlled component + TrackConfig helpers (dormant — Plan 40-02 mounts)
  - phase: 38-schema-wms-engine-foundation
    provides: fingerprint at MapChartRenderer.tsx:1118+1208 (JSON.stringify {p,c,t}) + wmsUrlBuilder Track block (lines 428-472)
  - phase: 39-classbreak-form-ui-auto-suggest
    provides: CB-V17-09 fingerprint regression pattern (mirror for TRACK-V17-05)

provides:
  - KineticaWmsLayerForm.tsx TrackSubSection mount wired — live wiring making the dormant component operator-visible
  - KineticaWmsLayerForm.spec.tsx 7 host-form spec tests (TRACK-V17-03 render-mode gating + state preservation)
  - MapChartRenderer.spec.tsx 7 fingerprint regression tests (TRACK-V17-05 locks t-slot coverage shipped in Phase 38)

affects:
  - 41-layers-legend-panel (reads track_config for legend rendering — Phase 40 fully unblocked)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-gate pattern (Pitfall 5 lock): (renderMode === 'raster' || renderMode === 'classbreak') && <TrackSubSection/> as one expression, not duplicated inside each gate"
    - "Integration-level host-form spec: CbConfigForm not mocked → TrackSubSection not mocked → real component selectors (queryByText/queryByLabelText) for presence/absence assertions"
    - "CB-V17-09 mirror pattern: buildFingerprint local helper + fs.readFileSync grep assertion — locks both production callsites with ≥2 matches requirement"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

key-decisions:
  - "Single-gate live wiring: import TrackSubSection added after CbConfigForm import; JSX mount sits between CbConfigForm gate and CONTOUR block — single (raster||classbreak) expression, Pitfall 5 locked"
  - "Integration-level spec (not mock-level): CbConfigForm not mocked at top-of-file → TrackSubSection not mocked either per plan instruction; real selectors 'TRACK PARAMS' + 'Treat as track table' used"
  - "TRACK-V17-05 regression mirrors CB-V17-09 exactly: buildFingerprint local helper (same signature), fs.readFileSync grep asserts ≥2 production callsites; zero production code changes"

patterns-established:
  - "Dormant-then-wire pattern: Plan N-01 ships complete component + spec dormant; Plan N-02 adds 2-line import + JSX gate in host form — minimal diff, maximum test coverage"

requirements-completed:
  - TRACK-V17-03
  - TRACK-V17-05

# Metrics
duration: 4min
completed: 2026-05-22
---

# Phase 40 Plan 02: Host Mount and Fingerprint Regression Summary

**TrackSubSection wired into KineticaWmsLayerForm.tsx via single (raster||classbreak) gate (TRACK-V17-03) + TRACK-V17-05 fingerprint regression spec locking Phase 38 t-slot at both MapChartRenderer.tsx callsites**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-22T01:24:56Z
- **Completed:** 2026-05-22T01:28:32Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Wired `TrackSubSection` into `KineticaWmsLayerForm.tsx` as a SINGLE expression gated on `(renderMode === "raster" || renderMode === "classbreak")` immediately after the CbConfigForm gate — makes the dormant Phase 40-01 component operator-visible; Pitfall 5 lock (single mount, state preserved across raster ↔ classbreak swaps) enforced
- Added `Phase 40 TRACK-V17-03 mount-gate + state preservation` describe block (7 tests) to `KineticaWmsLayerForm.spec.tsx`: raster mount, classbreak mount, heatmap hide, contour hide, raster→classbreak preservation, heatmap→raster restore, no-onChange-on-mode-swap; integration-level with real component selectors
- Added `Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config` describe block (7 tests) to `MapChartRenderer.spec.tsx`: enabled-flip, headColor edit, trailSize edit, headShape edit, byte-identical stability, cb_raster vs raster STYLES p-slot diff, production grep asserting ≥2 callsites — zero production code changes

## Task Commits

1. **Task 1: Mount TrackSubSection in KineticaWmsLayerForm.tsx + host-form spec coverage** - `7a3641b` (feat)
2. **Task 2: Add TRACK-V17-05 fingerprint regression spec to MapChartRenderer.spec.tsx** - `fb1e2a1` (feat)

## Files Created/Modified

- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Added `import TrackSubSection from "./TrackSubSection"` + JSX mount block gated on `(renderMode === "raster" || renderMode === "classbreak")`
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — New `Phase 40 TRACK-V17-03 mount-gate + state preservation` describe block with 7 integration tests
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` — New `Phase 40 TRACK-V17-05 — fingerprint covers layer.track_config` describe block with 7 pure-function tests

## Decisions Made

- **Single-gate vs. duplicated gates:** Used a single `(renderMode === "raster" || renderMode === "classbreak") && <TrackSubSection/>` expression rather than duplicating `<TrackSubSection/>` inside each of the raster gate and classbreak gate. React uses component-instance identity to preserve state — two separate gate locations would unmount/remount the component on mode swap. Single gate is the Pitfall 5 lock from CONTEXT.md.
- **Integration-level spec (no vi.mock for TrackSubSection):** CbConfigForm is not mocked at the top of `KineticaWmsLayerForm.spec.tsx`. Per plan instruction, if CbConfigForm is not mocked, TrackSubSection must not be mocked either. Real component selectors (`queryByText("TRACK PARAMS")`, `queryByLabelText("Treat as track table")`) are used — these are always rendered when TrackSubSection is mounted, making them reliable presence/absence indicators.
- **Pre-existing TSC errors (MapChartRenderer.spec.tsx):** `fs`/`path`/`__dirname` TS errors in the Phase 39 CB-V17-09 block pre-exist and are not introduced by Phase 40. Confirmed via `git stash` baseline check. The TRACK-V17-05 block uses the same `async import("fs")` pattern as CB-V17-09 — same pre-existing TSC profile, same vitest behavior (dynamic import resolves at runtime).

## ROADMAP Success Criteria Closure

| SC | Mechanism | Closing Plan |
|----|-----------|--------------|
| SC #1 (auto-detect on track-shape table → sub-section visible) | Plan 40-01 Groups A1+A2 (component-level); Plan 40-02 Task 1 host-mount gate | 40-01 + **40-02** |
| SC #2 (override checkbox always visible; check/uncheck) | Plan 40-01 Groups A+D; Plan 40-02 mount-gate proves visible under raster/classbreak | 40-01 + **40-02** |
| SC #3 (renderMode raster ↔ classbreak preserves; not under heatmap) | Plan 40-02 Task 1 tests 1-7 (TRACK-V17-03 mount-gate + state preservation) | **40-02** |
| SC #4 (cb_raster comma-sep TRACK_* emission per SPIKE-V17-05) | Plan 40-02 Task 2 TRACK-V17-05 test #6 (cb_raster vs raster p-slot diff + production grep) | **40-02** |
| SC #5 (persistence round-trip through PATCH + dashboard load) | Plan 40-01 Group F3 (coalesceTrackConfig); Plan 40-02 rerender tests with persisted track_config strings | 40-01 + **40-02** |

**All 5/5 ROADMAP success criteria satisfied.**

## TRACK-V17 REQ-ID Coverage Map

| REQ ID | Closing Plan | Spec Test(s) |
|--------|-------------|--------------|
| TRACK-V17-01 | 40-01 | TrackSubSection.spec.tsx Groups A1, A2, A3, A5, A6, A7 |
| TRACK-V17-02 | 40-01 | TrackSubSection.spec.tsx Groups A3, A4, D1, D2, D3, D4 |
| TRACK-V17-03 | **40-02** | KineticaWmsLayerForm.spec.tsx Phase 40 TRACK-V17-03 block (7 tests) |
| TRACK-V17-04 | 40-01 | TrackSubSection.spec.tsx Groups B1-B7, C1-C5, E1-E4 |
| TRACK-V17-05 | **40-02** | MapChartRenderer.spec.tsx Phase 40 TRACK-V17-05 block (7 tests) |
| TRACK-V17-06 | 40-01 | TrackSubSection.spec.tsx Group F1, F2, F3 |

**All 6/6 TRACK-V17 REQ IDs covered across Plans 40-01 + 40-02.**

## Test Surface

| Spec File | Before | Added | After |
|-----------|--------|-------|-------|
| KineticaWmsLayerForm.spec.tsx | 33 tests | +7 (TRACK-V17-03) | 40 tests |
| MapChartRenderer.spec.tsx | 146 tests | +7 (TRACK-V17-05) | 153 tests |
| Full frontend suite | 1172 tests | +14 | **1186 tests** |

## Deviations from Plan

None — plan executed exactly as written. The integration-level selector choice (using real component selectors instead of vi.mock) was explicitly covered by the plan's conditional instruction ("If `./CbConfigForm` is NOT mocked at the top of the file, DO NOT add a TrackSubSection mock either — instead use queryByTestId against the real component's data-testid or similar real selectors").

## Issues Encountered

None beyond confirming that pre-existing TSC errors in MapChartRenderer.spec.tsx (`fs`/`path`/`__dirname`) originate from the Phase 39 CB-V17-09 block (verified via git stash baseline). These are not introduced by Phase 40-02.

## Self-Check

### Files exist

- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` (modified) — FOUND
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` (modified) — FOUND
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (modified) — FOUND

### Acceptance criteria grep counts

| Check | Expected | Actual |
|-------|----------|--------|
| `^import TrackSubSection` count in KineticaWmsLayerForm.tsx | 1 | 1 |
| `(renderMode === "raster" \|\| renderMode === "classbreak") &&` count | ≥1 | 1 |
| `<TrackSubSection` count (single mount point) | 1 | 1 |
| `Phase 40 TRACK-V17-03` count in spec | ≥1 | 2 |
| Real selectors for TrackSubSection presence | ≥1 | 13 |
| `Phase 40 TRACK-V17-05` count in MapChartRenderer.spec.tsx | ≥2 | 2 |
| `fingerprint covers layer.track_config` count | ≥1 | 2 |
| `buildFingerprint` count in MapChartRenderer.spec.tsx | ≥12 | 19 |
| KineticaWmsLayerForm.spec.tsx tests | 40 | 40 |
| MapChartRenderer.spec.tsx tests | 153 | 153 |
| Full frontend suite | 1186 | 1186 |
| `git diff MapChartRenderer.tsx` | empty | empty |
| `git diff wmsUrlBuilder.ts` | empty | empty |

### Production code unchanged

- `git diff kinetica_bi/src/components/charts/MapChartRenderer.tsx` → empty (Phase 38 fingerprint code untouched)
- `git diff kinetica_bi/src/lib/wmsUrlBuilder.ts` → empty (Phase 38 Track emission code untouched)

## Self-Check: PASSED

## Phase 40 Closure Note

Phase 40 is complete — all 5 ROADMAP SCs and 6 TRACK-V17 REQ IDs satisfied across Plans 40-01 + 40-02. Phase 41 (LayersLegendPanel — reads track_config for legend rendering) is now unblocked.

---
*Phase: 40-track-sub-section-ui*
*Completed: 2026-05-22*
