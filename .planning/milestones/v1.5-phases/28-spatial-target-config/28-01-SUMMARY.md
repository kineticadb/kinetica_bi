---
phase: 28-spatial-target-config
plan: 01
subsystem: ui
tags: [react, typescript, zustand-adjacent, vitest, spatial-filtering, kinetica]

# Dependency graph
requires:
  - phase: 26-server-spatial-where
    provides: SpatialTarget + SpatialMode + SpatialFilter server-side types (lines 54-81 of spatialWhereClause.ts) — frontend mirrors byte-for-byte
  - phase: 19-config-schema
    provides: mapInfoConfig.ts co-location pattern (type + helpers + defaults in one file) — template followed verbatim
provides:
  - SpatialMode + SpatialTarget frontend types byte-parity with server (no projection at the wire)
  - getSpatialTargets default-coercer (legacy widgets return [] without migration; same-array-reference passthrough)
  - isSpatialTargetEligible single source of truth for v1.5 three-gate eligibility (config-time, materialize-time, server-time)
  - MapWidgetConfig.spatialTargets?: SpatialTarget[] optional field for widget.config persistence
affects:
  - 28-02-map-config-panel-section (first UI consumer; imports SpatialTarget + isSpatialTargetEligible)
  - 30-materialize-trigger (eligibility gate at client materialize-call site; sends SpatialTarget array over wire)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Byte-parity type duplication (frontend mirrors server type 1:1; no field renames, no UI-only fields)"
    - "Co-located type + helpers + JSDoc in single .ts file (mirrors mapInfoConfig.ts pattern)"
    - "Same-array-reference passthrough in default-coercer helpers (no defensive copy — mirrors getInfoEnabled minimal-helper style)"

key-files:
  created:
    - "kinetica_bi/src/lib/spatialTargets.ts (93 lines — SpatialMode + SpatialTarget + getSpatialTargets + isSpatialTargetEligible)"
    - "kinetica_bi/src/lib/spatialTargets.spec.ts (137 lines — 15 it() cases across 3 describe blocks)"
  modified:
    - "kinetica_bi/src/lib/wmsUrlBuilder.ts (+9 lines — SpatialTarget import + optional spatialTargets?: SpatialTarget[] field on MapWidgetConfig)"

key-decisions:
  - "SpatialMode declared locally in spatialTargets.ts (not imported from ./columnTypes) — mirrors server-side local declaration choice (STATE.md Phase 26 [WHERE-V15-01]); zero cross-module import for trivial union"
  - "No DEFAULT_SPATIAL_TARGETS constant — [] is inline literal at the one read site in getSpatialTargets, unlike DEFAULT_INFO_ENABLED which is reused in MapConfigPanel + tests (Plan 28-02 will consume isSpatialTargetEligible, not a defaults constant)"
  - "Tasks 1 + 3 form a type-cycle (Pick<MapWidgetConfig,'spatialTargets'> requires the field; spatialTargets?: SpatialTarget[] requires the type); cycle resolves cleanly once both files land — tsc emerald only after Task 3 commit. Plan acceptance 'tsc passes' verified at plan close, not per-task."

patterns-established:
  - "Three-gate eligibility predicate pattern: a single helper (isSpatialTargetEligible) is the source of truth across config-time UI gate, client-side materialize-time skip, and server-side 501. Avoids drift between gates; mirrors PROJECT.md Key Decision on 'shared renderInfoTemplate helper' (Phase 21 / Phase 23)."
  - "Empty-string falsy treated as missing in eligibility check (Boolean(target.spatialCol)) — aligns with v1.4 mapInfoConfig 'no clamping' philosophy: helpers are pure reads, UI enforces non-empty input at edit time (Plan 28-02 ChipCombobox)."

requirements-completed:
  - TARGET-V15-01
  - TARGET-V15-02

# Metrics
duration: 3min
completed: 2026-05-12
---

# Phase 28 Plan 01: Spatial Targets Helper Summary

**Co-located SpatialTarget type + getSpatialTargets/isSpatialTargetEligible helpers (byte-parity with server spatialWhereClause.ts lines 54-81) plus optional spatialTargets?: SpatialTarget[] field on MapWidgetConfig — module ships dormant for Plan 28-02 + Phase 30 consumption.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-12T17:24:27Z
- **Completed:** 2026-05-12T17:27:12Z
- **Tasks:** 3 (all type=auto; Tasks 1+2 TDD-style)
- **Files modified:** 3 (2 created + 1 edited)

## Accomplishments
- SpatialMode + SpatialTarget types declared byte-for-byte against server kinetica_bi/server/src/lib/spatialWhereClause.ts lines 54-81 (verified field names + optionality across 5 fields)
- getSpatialTargets default-coerces missing/undefined to [] for legacy v1.4 widgets (no migration needed); returns same-array-reference when set (no defensive copy)
- isSpatialTargetEligible established as single source of truth across all 3 v1.5 gates: WKB→false (TD-V14-WKB-SPIKE), incomplete latlon→false (3 sub-cases), incomplete wkt→false (incl. empty-string), valid latlon+wkt→true
- MapWidgetConfig extended with optional spatialTargets?: SpatialTarget[] field — single source of truth import from ./spatialTargets; buildWmsParams body unchanged (field rides Phase 30 POST body, not WMS GET)
- 15 vitest cases pass (plan minimum 11+); zero regressions across 9 lib/ test files / 164 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Create spatialTargets.ts (type + helpers)** — `7fee36b` (feat)
2. **Task 2: Create spatialTargets.spec.ts (vitest coverage)** — `29aa23f` (test)
3. **Task 3: Extend MapWidgetConfig with optional spatialTargets field** — `5595862` (feat)

**Plan metadata:** _(pending — added in final docs commit alongside STATE.md + ROADMAP.md update)_

_Note: Plan 28-01 used `tdd="true"` flag on Tasks 1+2 but committed as a single test commit per task (Task 2 wrote all 15 cases at once and they passed against Task 1's implementation; no RED→GREEN→REFACTOR split needed because the implementation in Task 1 was specified verbatim in the plan's `<action>` block)._

## Files Created/Modified

- `kinetica_bi/src/lib/spatialTargets.ts` — NEW. SpatialMode + SpatialTarget types + getSpatialTargets + isSpatialTargetEligible helpers. 93 lines. No non-stdlib imports beyond `import type { MapWidgetConfig }` for Pick<>.
- `kinetica_bi/src/lib/spatialTargets.spec.ts` — NEW. 15 it() cases across 3 describe blocks (SpatialMode+SpatialTarget types / getSpatialTargets / isSpatialTargetEligible). 137 lines.
- `kinetica_bi/src/lib/wmsUrlBuilder.ts` — EDITED. +1 import line (`import type { SpatialTarget } from "./spatialTargets"`) + 8 lines on MapWidgetConfig (JSDoc + `spatialTargets?: SpatialTarget[]` field). buildWmsParams body unchanged.

## Byte-Parity Verification

Server source: `kinetica_bi/server/src/lib/spatialWhereClause.ts`

| Server location | Server text | Frontend text | Match |
|---|---|---|---|
| Line 54 | `export type SpatialMode = "latlon" \| "wkt" \| "wkb";` | identical, spatialTargets.ts line 37 | YES |
| Lines 75-81 | `export type SpatialTarget = { tableId: number; spatialMode: SpatialMode; lonCol?: string; latCol?: string; spatialCol?: string; }` | identical (5 fields, same names, same optionality), spatialTargets.ts lines 50-56 | YES |

Verified by direct file read at both locations. Phase 30's `materializeFilter` helper will send SpatialTarget instances as-is over the wire (zero projection at the boundary).

## Decisions Made

- **SpatialMode declared locally, not imported from ./columnTypes** — Phase 11's columnTypes.ts also exports a SpatialMode of the same shape, but mirroring the server-side decision (STATE.md Phase 26 [WHERE-V15-01]: "SpatialMode defined locally in spatialWhereClause.ts ... zero cross-lib import for trivial union") keeps spatialTargets.ts dependency-free of the columnTypes module. Both unions coexist independently; grep will find both declarations.
- **No DEFAULT_SPATIAL_TARGETS constant** — Unlike DEFAULT_INFO_ENABLED / DEFAULT_INFO_RADIUS_PX (which are reused in MapConfigPanel UI + tests), `[]` is the only default and it's inline at the one read site. Plan 28-02 will consume `isSpatialTargetEligible`, not a defaults constant.
- **Task 1 + Task 3 form a type-cycle** — Pick<MapWidgetConfig,"spatialTargets"> in spatialTargets.ts needs the field to exist on MapWidgetConfig (added by Task 3); spatialTargets?: SpatialTarget[] in wmsUrlBuilder.ts needs SpatialTarget (exported by Task 1). Resolution: cycle is clean once both files land (TypeScript handles cyclic type-only imports). Plan acceptance "tsc passes" verified at plan close (after Task 3 commit), not after each task.

## Deviations from Plan

None - plan executed exactly as written.

All 3 tasks ran with no Rule 1/2/3/4 deviations. The Task 1 tsc check was deferred to after Task 3 (because of the type-cycle described above) — this is not a deviation from the plan but a natural consequence of plan acceptance ordering when two files declare types that reference each other. Plan-level verification at completion confirmed tsc green and 15/15 vitest green.

## Issues Encountered

- **vitest 4.x rejected `--reporter=basic`** — The plan's Task 2 verify command included `--reporter=basic` which fails on vitest 4.1.5 with "Failed to load url basic (resolved id: basic). Does the file exist?" Resolution: re-ran without the `--reporter` flag; default reporter output is still concise (Test Files 1 passed; Tests 15 passed). Not flagged as a deviation because the verify command failure didn't affect correctness — the underlying test run succeeded; only the CLI invocation needed adjustment.

## Verification Summary (plan close)

- `cd kinetica_bi && npx tsc --noEmit` → exit 0 (clean across all consumers after Task 3 cycle resolves)
- `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts` → 15/15 pass
- `cd kinetica_bi && npx vitest run src/lib/` → 9 files / 164 tests pass (no regression in sibling lib specs)
- `grep -r "spatialTargets" kinetica_bi/src/lib/` → exactly 3 files (spatialTargets.ts, spatialTargets.spec.ts, wmsUrlBuilder.ts) — plan ships dormant, no stray production imports

## User Setup Required

None - no external service configuration required. Module ships dormant; Plan 28-02 wires the first UI consumer in MapConfigPanel.

## Next Phase Readiness

- **Plan 28-02 unblocked:** Can `import { type SpatialTarget, getSpatialTargets, isSpatialTargetEligible } from "./spatialTargets"` from MapConfigPanel-section component
- **Phase 30 unblocked:** Can import the same surface to build the materialize-time eligibility gate at the client materialize-call site; `MapWidgetConfig.spatialTargets` is now part of the persisted widget.config shape
- **Persistence wiring:** No server work needed — existing `PATCH /api/widgets/:id` handles the JSON blob update (TARGET-V15-01 closed via type-shape addition + getSpatialTargets default-coerce)

---
*Phase: 28-spatial-target-config*
*Completed: 2026-05-12*

## Self-Check: PASSED

- FOUND: kinetica_bi/src/lib/spatialTargets.ts
- FOUND: kinetica_bi/src/lib/spatialTargets.spec.ts
- FOUND: kinetica_bi/src/lib/wmsUrlBuilder.ts
- FOUND: .planning/phases/28-spatial-target-config/28-01-SUMMARY.md
- FOUND commit: 7fee36b (Task 1)
- FOUND commit: 29aa23f (Task 2)
- FOUND commit: 5595862 (Task 3)
