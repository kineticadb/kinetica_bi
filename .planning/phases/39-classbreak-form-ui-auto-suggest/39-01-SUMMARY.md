---
phase: 39-classbreak-form-ui-auto-suggest
plan: 01
subsystem: ui
tags: [react, vitest, typescript, kinetica, classbreak, wms]

# Dependency graph
requires:
  - phase: 38-schema-wms-engine-foundation
    provides: "CbBreak/CbConfig types + EMPTY_CB_CONFIG + coalesceCbConfig + Phase 38 cbConfig.ts helpers"
provides:
  - "PALETTE_COLORS: readonly 8-color sequential palette for break-row creation"
  - "createDefaultBreak(valsType, index): fully-populated CbBreak with all 5 advanced fields"
  - "filterCbEligibleColumns(columns, spatialBound?): WKB-exclusion + spatial-bound exclusion filter (CB-V17-08)"
  - "detectValsTypeFromColumn(column): auto-detect numeric vs categorical from column type"
  - "CbConfigForm.tsx skeleton: CLASS BREAK PARAMS header + isValid(true) on mount — mount point for Plans 39-02/03"
  - "KineticaWmsLayerForm.tsx: render-mode picker filtered to 3 options (contour hidden, CB-V17-01); classbreak gate uses CbConfigForm"
affects:
  - 39-02-cb-config-form-core
  - 39-03-categorical-and-auto-suggest

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED→GREEN for cbConfig.ts additions (tests written before implementation)"
    - "Skeleton component pattern: CbConfigForm ships with isValid(true) placeholder so Save button unlocked during incremental build-out"
    - "Palette rotation: PALETTE_COLORS[index % PALETTE_COLORS.length] — wraps at 8"
    - "WKB exclusion: rawType.includes('bytes') || rawType.includes('wkb') case-insensitive check"

key-files:
  created:
    - kinetica_bi/src/components/charts/CbConfigForm.tsx
  modified:
    - kinetica_bi/src/lib/cbConfig.ts
    - kinetica_bi/src/lib/cbConfig.spec.ts
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx

key-decisions:
  - "Unused imports removed from KineticaWmsLayerForm.tsx after ClassbreakParamsGroup deletion (probeCardinality, useToastStore, FontAwesomeIcon, faXmark, useCallback, useRef) — tsc clean confirms no breakage"
  - "Comment referencing ClassbreakParamsGroup name updated to avoid grep false-positive in acceptance criteria"

patterns-established:
  - "All new cbConfig.ts helpers covered by dedicated describe blocks in cbConfig.spec.ts — one describe per export"
  - "CbConfigForm accepts tableRef/schema/tableName as props for Plan 39-03 Auto-suggest even though skeleton silences them with void"

requirements-completed:
  - CB-V17-01
  - CB-V17-08

# Metrics
duration: 12min
completed: 2026-05-21
---

# Phase 39 Plan 01: Foundation Palette and Cleanup Summary

**PALETTE_COLORS palette + createDefaultBreak/filterCbEligibleColumns/detectValsTypeFromColumn helpers in cbConfig.ts; ClassbreakParamsGroup excised from KineticaWmsLayerForm; CbConfigForm skeleton mounted under classbreak gate with contour hidden from picker (CB-V17-01)**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-21T14:17:00Z
- **Completed:** 2026-05-21T14:22:54Z
- **Tasks:** 2
- **Files modified:** 5 (2 modified + 1 created in components, 2 in lib)

## Accomplishments

- Extended lib/cbConfig.ts with 4 new exports: PALETTE_COLORS (8-color), createDefaultBreak, filterCbEligibleColumns (CB-V17-08), detectValsTypeFromColumn — all covered by 16 new vitest assertions (31 total in cbConfig.spec.ts)
- Deleted ClassbreakParamsGroup sub-component (~250 lines), ClassbreakBreak type, CardinalityState type from KineticaWmsLayerForm.tsx; removed now-unused imports (probeCardinality, useToastStore, FontAwesomeIcon etc)
- Created CbConfigForm.tsx skeleton (CLASS BREAK PARAMS header + placeholder text + isValid(true) on mount) — mount point for Plans 39-02 and 39-03
- Filtered contour from render-mode picker (CB-V17-01): `m !== "contour"` predicate; contour params block still renders for existing contour-mode layers
- Updated KineticaWmsLayerForm.spec.tsx: inverted Contour assertion, added 3-radio test, replaced obsolete ClassbreakParamsGroup tests with CbConfigForm skeleton test (33 tests total, all passing)

## Task Commits

1. **Task 1: Extend lib/cbConfig.ts with PALETTE_COLORS + helpers + tests** - `6dec8cc` (feat/TDD)
2. **Task 2: Create CbConfigForm.tsx skeleton + delete ClassbreakParamsGroup + filter contour + update spec** - `5ff72c3` (feat)

## Files Created/Modified

- `kinetica_bi/src/lib/cbConfig.ts` — Added PALETTE_COLORS, createDefaultBreak, filterCbEligibleColumns, detectValsTypeFromColumn (4 new exports; all Phase 38 exports unchanged)
- `kinetica_bi/src/lib/cbConfig.spec.ts` — Extended with 16 new test cases covering Phase 39 additions (31 total)
- `kinetica_bi/src/components/charts/CbConfigForm.tsx` — New file: skeleton component with CLASS BREAK PARAMS header + isValid(true) on mount
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` — Deleted ClassbreakParamsGroup (250 lines) + 3 type defs; added CbConfigForm import + mount; added contour filter to picker; removed 5 unused imports
- `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` — Inverted contour assertion + added 3-radio test + replaced 2 obsolete tests with CbConfigForm skeleton test

## Decisions Made

- Unused imports removed from KineticaWmsLayerForm.tsx after ClassbreakParamsGroup deletion (probeCardinality, useToastStore, FontAwesomeIcon, faXmark, useCallback, useRef). tsc clean confirms zero breakage.
- A comment containing "ClassbreakParamsGroup" was updated to avoid the grep acceptance criterion returning 1; the plan specified `grep -c "ClassbreakParamsGroup" ... returns 0`.

## Deviations from Plan

None — plan executed exactly as written. The comment update was a trivial literal adjustment to satisfy the acceptance criterion (`grep -c "ClassbreakParamsGroup" returns 0`).

## Issues Encountered

None.

## Next Phase Readiness

- Plan 39-02 (CbConfigForm core: column picker + break-row builder + advanced chevron) is unblocked — CbConfigForm.tsx exists at the expected path and PALETTE_COLORS/createDefaultBreak/filterCbEligibleColumns/detectValsTypeFromColumn are all exported from lib/cbConfig.ts
- CB-V17-01 picker-filter side closed; CB-V17-08 eligibility-filter helper available for Plan 39-02 consumption

## Self-Check

- `kinetica_bi/src/components/charts/CbConfigForm.tsx` — EXISTS
- `kinetica_bi/src/lib/cbConfig.ts` exports PALETTE_COLORS — CONFIRMED
- Commit `6dec8cc` — CONFIRMED (git log)
- Commit `5ff72c3` — CONFIRMED (git log)
- 64 tests passing (cbConfig.spec.ts 31 + KineticaWmsLayerForm.spec.tsx 33) — CONFIRMED
- tsc clean — CONFIRMED

## Self-Check: PASSED

---
*Phase: 39-classbreak-form-ui-auto-suggest*
*Completed: 2026-05-21*
