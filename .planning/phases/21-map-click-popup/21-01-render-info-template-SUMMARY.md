---
phase: 21-map-click-popup
plan: "01"
subsystem: ui
tags: [vitest, tdd, pure-helper, typescript]

# Dependency graph
requires:
  - phase: 19-config-schema
    provides: DashboardLayerDto.info_columns / info_template field types
  - phase: 18-spatial-spike-and-endpoint
    provides: POST /api/info/query response shape (rows + columns)

provides:
  - renderInfoTemplate pure function (mode discriminator: template | kv)
  - RenderResult discriminated-union type
  - RenderInfoTemplateArgs type
  - 13-test vitest spec covering all branch policies

affects:
  - 21-02 (InfoPopup.tsx imports renderInfoTemplate directly)
  - 23-info-card (Info Card renderer imports renderInfoTemplate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure helper with zero React/zustand/network imports (mirrors mapInfoConfig.ts pattern)"
    - "Discriminated-union return type (mode: template | kv) for type-safe render branch selection"
    - "Lenient JSON.parse with try/catch fallback to all-columns"
    - "TDD RED→GREEN: spec written first, module imported second"

key-files:
  created:
    - kinetica_bi/src/lib/renderInfoTemplate.ts
    - kinetica_bi/src/lib/renderInfoTemplate.spec.ts
  modified: []

key-decisions:
  - "Empty string template ('') is treated as configured template (mode=template, html='') — null is the kv-mode discriminator, not falsy check"
  - "info_columns empty array ('[]') falls back to all response columns (locked: if non-empty array of strings, use it; else fallback)"
  - "No HTML sanitization — locked PROJECT.md Key Decision: Dashboard authors are privileged users. Inline comment cites lock verbatim."
  - "Token substitution: {column_name} Tableau/Grafana convention — null/undefined coerce to empty string via String(v) guard"

patterns-established:
  - "Discriminated-union render result: { mode: 'template'; html: string } | { mode: 'kv'; pairs: ... } — Phase 23 Info Card uses same return type"
  - "Module-level docstring citing locked decisions (PROJECT.md no-sanitize + STATE.md shared-helper) with exact file paths"
  - "Regression tag POPUP-V14-04 comment at spec file top for grep-ability"

requirements-completed:
  - POPUP-V14-04

# Metrics
duration: 1min
completed: "2026-05-08"
---

# Phase 21 Plan 01: Render Info Template Summary

**Pure `renderInfoTemplate` helper with `{column_name}` substitution, discriminated-union result, and lenient `info_columns` JSON-parse fallback — shared primitive for Phase 21 popup and Phase 23 Info Card**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-08T14:58:50Z
- **Completed:** 2026-05-08T15:00:22Z
- **Tasks:** 1 (TDD: RED commit + GREEN/feat commit)
- **Files modified:** 2

## Accomplishments

- `renderInfoTemplate.ts` ships as a 77-line pure helper with zero React/zustand/network imports — Phase 23 Info Card can import it unchanged
- 13-test vitest spec covers all T1-T6 (template mode) + KV1-KV7 (kv mode) cases per plan; all green
- Locked behaviors encoded with inline comments citing originating decisions (no-sanitize from PROJECT.md, shared-helper from STATE.md, token syntax from CONTEXT.md)

## Task Commits

1. **Task 1: Write renderInfoTemplate helper + spec (RED → GREEN)** - `7659bfd` (feat)

## Files Created/Modified

- `kinetica_bi/src/lib/renderInfoTemplate.ts` — Pure discriminated-union render helper: template mode (`{column_name}` substitution) + kv mode (info_columns-filtered pairs), 77 lines
- `kinetica_bi/src/lib/renderInfoTemplate.spec.ts` — 13-test vitest spec, POPUP-V14-04 regression tag, 184 lines

## Locked Behaviors (with line references)

| Behavior | File:lines | Policy |
|---|---|---|
| Token regex | renderInfoTemplate.ts:55 | `/\{(\w+)\}/g` — ASCII column names, Tableau/Grafana convention |
| null/undefined → "" | renderInfoTemplate.ts:59 | `v === null \|\| v === undefined ? "" : String(v)` |
| Empty string template = template mode | renderInfoTemplate.ts:50 | `if (args.template !== null)` — null is the only kv discriminator |
| JSON parse fallback | renderInfoTemplate.ts:67-76 | try/catch; also empty array + non-array + mixed-type array → all-columns fallback |
| No sanitization | renderInfoTemplate.ts:13-16 (docstring) | Inline comment cites PROJECT.md locked decision verbatim |

## Test Counts

Expected: 13. Actual: **13** (all green).

- Template mode (T1-T6): 6 tests
- KV mode (KV1-KV7): 7 tests

## Decisions Made

- **Empty string template treatment:** `template: ""` routes to mode=`template` with `html=""`. The null discriminator is the kv-mode trigger; explicit empty string is the author's choice to render an empty HTML node. Plan explicitly documented this as the locked contract (Test T6 rationale).
- **No deviation from plan:** Implementation matches the `<action>` block in the plan verbatim, including the exact docstring, type definitions, and function body.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `renderInfoTemplate` + `RenderResult` + `RenderInfoTemplateArgs` are exported and importable by:
  - **Plan 21-02:** `InfoPopup.tsx` — map click popup body render
  - **Phase 23:** Info Card renderer — same function, zero refactor needed
- No blockers. Token syntax, no-sanitize, and lenient-parse policies are locked in code with inline citations.

---
*Phase: 21-map-click-popup*
*Completed: 2026-05-08*
