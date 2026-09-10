---
phase: 75-column-display-config-foundation
plan: 02
subsystem: ui
tags: [d3-format, typescript, formatter, vitest, tdd, pure-lib]

# Dependency graph
requires: []
provides:
  - "FormatSpec discriminated union (FormatSpecNumber | FormatSpecDate | FormatSpecD3 | FormatSpecNone) in packages/web/src/lib/columnFormatter.ts"
  - "buildFormatter(spec) factory — never-throwing, null/undefined passthrough, raw fallback on type mismatch"
  - "defaultFormatKind(colName, columns) — infers default kind from Kinetica column type"
  - "d3-format@^3.1.2 runtime dep + @types/d3-format@^3.0.4 devDep scoped to packages/web"
affects:
  - 75-03 (store helpers import FormatSpec + buildFormatter directly)
  - Phase 76 (editor UI consumes FormatSpec union + defaultFormatKind)
  - Phase 77 (render surfaces call buildFormatter at render time)

# Tech tracking
tech-stack:
  added:
    - "d3-format@^3.1.2 (packages/web runtime dep)"
    - "@types/d3-format@^3.0.4 (packages/web devDep — d3-format ships no native types)"
  patterns:
    - "percent preset: LITERAL % suffix (never d3 % type) — avoids silent ×100 (Pitfall 1)"
    - "d3 escape hatch: raw verbatim specifier, % DOES ×100 (intentional, documented in code)"
    - "date formatting: hand-rolled UTC getters + MONTH_NAMES table (extends columnTypes.ts pattern)"
    - "epoch normalization: values < 1e12 treated as epoch seconds, >= 1e12 as epoch ms"
    - "never-throw factory: all branches wrapped in try/catch returning raw value"

key-files:
  created:
    - "packages/web/src/lib/columnFormatter.ts"
    - "packages/web/src/lib/columnFormatter.spec.ts"
  modified:
    - "packages/web/package.json"
    - "package-lock.json"

key-decisions:
  - "Percent preset uses LITERAL '%' suffix — does NOT use d3's '%' type specifier (which ×100). Stored 42 renders '42%'. Only kind:'d3' escape hatch gets raw d3 semantics where '%' DOES ×100."
  - "Dates use hand-rolled UTC approach (extends columnTypes.ts MONTH_NAMES pattern) — no d3-time-format added. Keeps bundle lean, consistent with existing codebase."
  - "FormatSpec lives in columnFormatter.ts (pure lib), not in a shared types file — it is a pure client type and the server stores it as opaque JSON-in-TEXT."
  - "defaultFormatKind imports inferDataTypeFromColumn from ./columnTypes (allowed — pure lib), but buildFormatter never calls inferDataTypeFromColumn at render time."
  - "Epoch normalization heuristic: values < 1e12 = epoch seconds; >= 1e12 = epoch ms."

patterns-established:
  - "Pure formatter lib pattern: zero store/DOM/SQL/fetch imports; unit-testable with no mocks"
  - "TDD red→green: spec written first (confirms red), then implementation to green"
  - "Never-throw formatter: every code path returns raw value on error via try/catch"

requirements-completed: [COLCFG-V115-02]

# Metrics
duration: 25min
completed: 2026-06-20
---

# Phase 75 Plan 02: columnFormatter.ts — FormatSpec + buildFormatter + defaultFormatKind Summary

**Pure client-side column formatter library: FormatSpec discriminated union + never-throwing buildFormatter factory (number/date/d3/none) with literal-% percent preset and hand-rolled UTC date formatting via d3-format@3.1.2**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-20T00:28:17Z
- **Completed:** 2026-06-20T00:53:00Z
- **Tasks:** 2 (Task 1: dep install; Task 2: TDD red→green)
- **Files modified:** 4 (package.json, package-lock.json, columnFormatter.ts, columnFormatter.spec.ts)

## Accomplishments

- Installed `d3-format@^3.1.2` (runtime) + `@types/d3-format@^3.0.4` (devDep) scoped to packages/web; absent from packages/server
- Built `FormatSpec` discriminated union (4 kinds: number | date | d3 | none) as the shared contract for Plans 03, Phase 76, Phase 77
- Implemented `buildFormatter` with 41 green unit tests covering every kind, edge case, null/undefined passthrough, and the critical percent-no-×100 invariant
- Verified `web tsc --noEmit` clean + full 2494-test suite passes with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add d3-format + @types/d3-format to packages/web** - `d453698` (chore)
2. **Task 2 RED: Failing spec for columnFormatter** - `1fcdd36` (test)
3. **Task 2 GREEN: columnFormatter.ts implementation** - `ee9c83d` (feat)

**Plan metadata:** (docs commit follows)

_Note: Task 2 is TDD — spec commit (RED) precedes implementation commit (GREEN)_

## Files Created/Modified

- `packages/web/src/lib/columnFormatter.ts` — FormatSpec union + buildFormatter factory + defaultFormatKind (265 lines, pure)
- `packages/web/src/lib/columnFormatter.spec.ts` — 41 unit tests covering all FormatSpec kinds and edge cases
- `packages/web/package.json` — d3-format added to dependencies, @types/d3-format to devDependencies
- `package-lock.json` — updated lockfile

## Decisions Made

- **Percent preset = literal '%', NOT d3's '%' type:** d3's '%' specifier multiplies by 100 (0.42 → "42%"), but the product requirement stores already-scaled percentages (42 → "42%"). The `kind:"number"` formatter builds a `.Nf` specifier then appends `%` as a literal string. Only `kind:"d3"` receives raw d3 specifiers where `%` DOES ×100 — this is documented with a code comment per plan spec.
- **Hand-rolled UTC dates (no d3-time-format):** Extends the existing `columnTypes.ts` UTC getter + MONTH_NAMES pattern. Avoids adding a second d3 sub-package (~20 kB) for 5 presets + a simple custom token replacer.
- **FormatSpec lives in columnFormatter.ts:** A pure client type — the server stores it as opaque JSON-in-TEXT and never introspects it. Co-locating with the formatter keeps the shared contract in one file.
- **Epoch normalization:** Values < 1e12 treated as epoch seconds (max ~2286 AD in seconds = ~1e10); >= 1e12 treated as epoch ms. Covers Kinetica timestamp outputs in both units.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. `d3-format` was already present in `packages/web/package.json` dependencies (added by Plan 01 or a prior manual edit); `@types/d3-format` was absent and was freshly installed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `FormatSpec`, `buildFormatter`, and `defaultFormatKind` are exported and ready for Plan 03 (store helpers: `resolveFormatter` calls `buildFormatter`; `defaultFormatKind` seeds the initial kind for the Phase 76 editor).
- The shared contract is locked — Plans 03, Phase 76 editor, and Phase 77 render surfaces all import from `packages/web/src/lib/columnFormatter.ts`.
- No blockers.

---
*Phase: 75-column-display-config-foundation*
*Completed: 2026-06-20*

## Self-Check: PASSED

- `packages/web/src/lib/columnFormatter.ts` — FOUND
- `packages/web/src/lib/columnFormatter.spec.ts` — FOUND
- `packages/web/package.json` contains `d3-format` + `@types/d3-format` — FOUND
- Commit `d453698` — FOUND
- Commit `1fcdd36` — FOUND
- Commit `ee9c83d` — FOUND
- `columnFormatter.ts` min_lines: 265 (required >= 120) — PASSED
- Web tsc clean — PASSED
- 41/41 spec tests green — PASSED
- 2494/2494 full suite tests green — PASSED
