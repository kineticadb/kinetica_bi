---
phase: 40-track-sub-section-ui
plan: 01
subsystem: ui
tags: [react, typescript, vitest, testing-library, wms, track-config]

# Dependency graph
requires:
  - phase: 38-schema-wms-engine-foundation
    provides: TrackConfig + coalesceTrackConfig inline in wmsUrlBuilder.ts; trackDetect.ts isTrackTable; colorHex helpers
  - phase: 39-classbreak-form-ui-auto-suggest
    provides: CbConfigForm structural precedent (patchCb pattern, props shape, useEffect TDD discipline)

provides:
  - lib/trackConfig.ts canonical home for TrackConfig type + coalesceTrackConfig + TRACK_DEFAULTS constant
  - lib/wmsUrlBuilder.ts back-compat re-export (line-440 callsite + Phase 38 spec imports unaffected)
  - TrackSubSection.tsx pure controlled React component (dormant — Plan 40-02 mounts)
  - lib/trackConfig.spec.ts 11 unit tests (coalesceTrackConfig + TRACK_DEFAULTS + type export)
  - TrackSubSection.spec.tsx 30 component tests (Groups A-F, TRACK-V17-01/02/04/06)

affects:
  - 40-02-wms-layer-form-wiring (mounts TrackSubSection into KineticaWmsLayerForm)
  - 41-layers-legend-panel (reads track_config for legend rendering)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Helper extraction pattern: inline Phase 38 type moved to lib/ when 2nd consumer (Phase 40 UI) surfaces"
    - "Back-compat re-export: import + export both from same module for local use + consumer re-export"
    - "useEffect([columns]) auto-seed: fires ONLY on column change, ONLY when config field is null — persisted state wins"
    - "patchTrack pattern: mirrors patchCb from CbConfigForm — single onChange write site via JSON.stringify"
    - "AARRGGBB two-control: color picker (RGB) + text input (AARRGGBB hex) + normalizeAARRGGBB blur fallback"

key-files:
  created:
    - kinetica_bi/src/lib/trackConfig.ts
    - kinetica_bi/src/lib/trackConfig.spec.ts
    - kinetica_bi/src/components/charts/TrackSubSection.tsx
    - kinetica_bi/src/components/charts/TrackSubSection.spec.tsx
  modified:
    - kinetica_bi/src/lib/wmsUrlBuilder.ts

key-decisions:
  - "TrackConfig + coalesceTrackConfig extraction from wmsUrlBuilder.ts: Phase 38 deferred extraction until 2nd consumer; Phase 40 form UI is that consumer"
  - "Re-export requires both import (for local use at line-440 callsite) AND export { } from (for external consumers) — re-export alone doesn't bind locally"
  - "useEffect dep array exclusion: patchTrack + config.track_config excluded, fires on columns change only — prevents infinite re-render loop while honoring persistence-wins rule"
  - "D4 test approach: null track_config + track-shape columns auto-seeds (A2 path), so D4 validated via the auto-seed assertion rather than separate checkbox click"

patterns-established:
  - "Dormant component shipping: complete component + spec shipped before host-form mount, same as Phase 39-01 CbConfigForm skeleton"
  - "trailSize-only write rule: Line width label writes exclusively to trailSize; lineWidth field is never written by the form"

requirements-completed:
  - TRACK-V17-01
  - TRACK-V17-02
  - TRACK-V17-04
  - TRACK-V17-06

# Metrics
duration: 6min
completed: 2026-05-22
---

# Phase 40 Plan 01: Track Config Helper and SubSection Summary

**TrackConfig helper extracted from wmsUrlBuilder.ts into lib/trackConfig.ts (back-compat re-export preserved), plus TrackSubSection.tsx pure controlled form component with auto-detect + override checkbox + 8 form inputs + AARRGGBB color pickers (dormant — Plan 40-02 mounts)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-22T01:15:46Z
- **Completed:** 2026-05-22T01:21:46Z
- **Tasks:** 2
- **Files modified:** 5 (3 created + 2 modified/created)

## Accomplishments

- Extracted `TrackConfig` type + `coalesceTrackConfig` + `TRACK_DEFAULTS` into canonical `lib/trackConfig.ts`; `wmsUrlBuilder.ts` back-compat re-export ensures Phase 38 line-440 callsite + all existing specs continue resolving
- Shipped `TrackSubSection.tsx` (318 lines) as a dormant pure controlled component implementing the full track form: override checkbox with auto-detect hint, 8 form inputs when enabled, AARRGGBB two-control color pickers for headColor and trailColor, spatial-bound exclusion for trackIdAttr dropdown
- Delivered `lib/trackConfig.spec.ts` (11 tests) and `TrackSubSection.spec.tsx` (30 tests in 6 groups) covering TRACK-V17-01/02/04/06 at the component level; full 1172-test suite passes with zero regressions

## Task Commits

1. **Task 1: Extract lib/trackConfig.ts helper + back-compat re-export** - `0739ff5` (feat)
2. **Task 2: Ship TrackSubSection.tsx component + companion spec (dormant)** - `57c473e` (feat)

## Files Created/Modified

- `kinetica_bi/src/lib/trackConfig.ts` — TrackConfig type, coalesceTrackConfig, TRACK_DEFAULTS constant (canonical source)
- `kinetica_bi/src/lib/trackConfig.spec.ts` — 11 unit tests: coalesceTrackConfig (5 cases) + TRACK_DEFAULTS (5 fields) + type export check
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — Removed inline TrackConfig/coalesceTrackConfig definitions (lines 31-60); added import from trackConfig + re-export for back-compat
- `kinetica_bi/src/components/charts/TrackSubSection.tsx` — 318-line pure controlled React component (dormant, no KineticaWmsLayerForm mount)
- `kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` — 680-line spec, 30 tests across Groups A-F

## Decisions Made

- **Back-compat re-export requires both import and re-export:** `export { } from "./trackConfig"` alone does not make the symbol available locally in wmsUrlBuilder.ts. A separate `import { coalesceTrackConfig } from "./trackConfig"` is needed for the line-440 callsite. This was caught and fixed in Task 1 execution.
- **useEffect dep exclusion lock:** `patchTrack` and `config.track_config` are intentionally excluded from the `useEffect([columns])` dep array — auto-seed fires on columns change only; persisted state (non-null `track_config`) is the guard. Without exclusion, patchTrack would trigger a re-render loop.
- **D4 test semantics:** Test D4 in the spec verifies that `trackIdAttr` comes from `isTrackTable(columns).trackIdCol` when track-shape columns are present. Since null `track_config` + track-shape columns triggers auto-seed in `useEffect`, this is covered by the A2 assertion path rather than a separate checkbox-click flow.

## Test Surface

| Group | Tests | REQ Coverage |
|-------|-------|-------------|
| trackConfig.spec.ts — coalesceTrackConfig | 5 | TRACK-V17-01 (parse contract) |
| trackConfig.spec.ts — TRACK_DEFAULTS | 5 | TRACK-V17-04 (defaults) |
| trackConfig.spec.ts — type export | 1 | (compile-time) |
| Group A — Auto-detect + override checkbox | 7 | TRACK-V17-01, TRACK-V17-02 |
| Group B — Field rendering when enabled | 7 | TRACK-V17-04 |
| Group C — Color picker AARRGGBB | 5 | TRACK-V17-04 |
| Group D — Override checkbox transitions | 4 | TRACK-V17-02, TRACK-V17-06 |
| Group E — Field-level mutations | 4 | TRACK-V17-04 |
| Group F — isValid + persistence | 3 | TRACK-V17-06 |

**Total: 41 tests across 2 spec files**

## TRACK-V17 REQ ID Coverage Map

| REQ ID | Covered by | Test(s) |
|--------|-----------|---------|
| TRACK-V17-01 | TrackSubSection.spec.tsx Group A | A1, A2, A3, A5, A6, A7 |
| TRACK-V17-02 | TrackSubSection.spec.tsx Group A + D | A3, A4, D1, D2, D3, D4 |
| TRACK-V17-04 | TrackSubSection.spec.tsx Groups B + C + E | B1-B7, C1-C5, E1-E4 |
| TRACK-V17-06 | TrackSubSection.spec.tsx Group F | F1, F2, F3 |
| TRACK-V17-03 | Plan 40-02 (host-mount gating) | — |
| TRACK-V17-05 | Plan 40-02 (fingerprint regression spec) | — |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Back-compat re-export requires local import**
- **Found during:** Task 1 (wmsUrlBuilder.ts update)
- **Issue:** After replacing the inline TrackConfig/coalesceTrackConfig definitions with `export { type TrackConfig, coalesceTrackConfig } from "./trackConfig"`, the line-440 callsite (`const tc = coalesceTrackConfig(...)`) threw `ReferenceError: coalesceTrackConfig is not defined` at test time. A re-export statement only re-exports to consumers; it does not bind the symbol in local scope.
- **Fix:** Added `import { coalesceTrackConfig, type TrackConfig } from "./trackConfig"` as a separate import line, keeping the re-export for back-compat. Both lines are needed.
- **Files modified:** `kinetica_bi/src/lib/wmsUrlBuilder.ts`
- **Verification:** `npx vitest run src/lib/wmsUrlBuilder.spec.ts` → 78/78 green (was 74/78 before fix)
- **Committed in:** `0739ff5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug — TypeScript/ESM re-export scope semantics)
**Impact on plan:** Essential correctness fix — plan's action section implied a single re-export line would suffice but ESM module scope requires an explicit local import. No scope creep.

## Issues Encountered

None beyond the auto-fixed re-export issue above.

## Self-Check

### Files exist

- `kinetica_bi/src/lib/trackConfig.ts` — FOUND
- `kinetica_bi/src/lib/trackConfig.spec.ts` — FOUND
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` (modified) — FOUND
- `kinetica_bi/src/components/charts/TrackSubSection.tsx` — FOUND
- `kinetica_bi/src/components/charts/TrackSubSection.spec.tsx` — FOUND

### Acceptance criteria grep counts

| Check | Expected | Actual |
|-------|----------|--------|
| `^export` lines in trackConfig.ts | 3 | 3 |
| re-export line in wmsUrlBuilder.ts | 1 match | 1 match |
| original definitions removed from wmsUrlBuilder.ts | 0 | 0 |
| line-440 callsite preserved | 1 match | 1 match |
| TrackSubSection.tsx line count | ≥ 250 | 318 |
| import count in TrackSubSection.tsx | ≥ 5 | 6 |
| lineWidth write patterns in TrackSubSection.tsx | 0 | 0 |
| trailSize references | ≥ 4 | 8 |
| POINT_SHAPES references | ≥ 1 | 3 |
| isTrackTable references | ≥ 2 | 4 |
| auto-detected references | ≥ 1 | 2 |
| TRACK_DEFAULTS references | ≥ 5 | 24 |
| Line width references | ≥ 2 | 3 |
| config-color-row count | 2 | 2 |
| spec line count | ≥ 350 | 680 |
| describe() blocks in spec | ≥ 6 | 7 |
| it() blocks in spec | ≥ 25 | 30 |
| TrackSubSection in KineticaWmsLayerForm | 0 | 0 |
| Full frontend suite | 1172 passing | 1172 passing |

## Self-Check: PASSED

## Next Phase Readiness

- `TrackSubSection.tsx` is complete and fully tested — ready for Plan 40-02 to mount in `KineticaWmsLayerForm.tsx`
- Plan 40-02 wires the component into the host form and adds TRACK-V17-03 (host-mount gate) and TRACK-V17-05 (fingerprint regression spec)
- No blockers

---
*Phase: 40-track-sub-section-ui*
*Completed: 2026-05-22*
