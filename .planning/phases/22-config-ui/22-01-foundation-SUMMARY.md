---
phase: 22-config-ui
plan: "01"
subsystem: ui
tags: [codemirror, react, chips, css, vitest, tdd]

# Dependency graph
requires:
  - phase: 19-config-schema
    provides: DashboardLayerDto with info_enabled/info_columns/info_template, MapWidgetConfig with infoEnabled/infoRadiusPx
  - phase: 21-map-click-popup
    provides: .info-popup-* CSS namespace, InfoPopup component, renderInfoTemplate helper
provides:
  - "@uiw/react-codemirror@^4.25.9 + @codemirror/lang-html@^6.4.9 installed and importable"
  - "ChipCombobox custom component (77 lines, no library) with null-sentinel all-selected semantics"
  - ".info-popup-config-* CSS namespace with 13 selectors for chip, editor, section, notes, error states"
affects: [22-02-widget-config, 22-03-layer-config]

# Tech tracking
tech-stack:
  added:
    - "@uiw/react-codemirror@^4.25.9 (React 6 CodeMirror wrapper)"
    - "@codemirror/lang-html@^6.4.9 (HTML syntax highlighting extension)"
  patterns:
    - "Typed vi.fn() cast via 'as unknown as (T) => void' for strict-mode vitest 4.x mock compatibility"
    - "ChipCombobox null-sentinel: selected=null means all-chips-selected; first deselect materializes explicit string[]"
    - "TDD RED+GREEN commit split: failing spec committed before implementation"

key-files:
  created:
    - kinetica_bi/src/components/charts/ChipCombobox.tsx
    - kinetica_bi/src/components/charts/ChipCombobox.spec.tsx
  modified:
    - kinetica_bi/package.json
    - kinetica_bi/package-lock.json
    - kinetica_bi/src/styles/global.css

key-decisions:
  - "CodeMirror 6 via @uiw/react-codemirror (not Monaco) — ~50-60KB gzip vs ~500KB+ for Monaco; modular extension model"
  - "ChipCombobox built custom (not react-select/headlessui/cmdk) — 77-line custom build < 20KB gzip target; visual parity with existing config-group pattern"
  - "Null sentinel preserved in ChipCombobox — selected=null renders all chips selected; caller (Plan 22-03) owns compression-back-to-null"
  - "vi.fn() typed cast pattern for vitest 4.x strict TypeScript compatibility in spec files"

patterns-established:
  - "Chip-combobox null sentinel: 'selected === null' = all selected; first deselect materializes string[]"
  - "Typed mock cast: 'vi.fn() as unknown as (next: T) => void' in spec files for vitest 4.x + tsc compatibility"

requirements-completed:
  - CONFIG-V14-03

# Metrics
duration: 3min
completed: 2026-05-08
---

# Phase 22 Plan 01: Foundation Summary

**CodeMirror 6 React wrapper + @codemirror/lang-html installed, custom 77-line ChipCombobox (null-sentinel all-selected, TDD 10/10 green), and 13 .info-popup-config-* CSS selectors scaffolded for Plans 22-02 and 22-03**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-08T22:53:24Z
- **Completed:** 2026-05-08T22:56:36Z
- **Tasks:** 3 (+ 1 auto-fix deviation)
- **Files modified:** 5 (package.json, package-lock.json, ChipCombobox.tsx, ChipCombobox.spec.tsx, global.css)

## Accomplishments

- Installed `@uiw/react-codemirror` and `@codemirror/lang-html` — locked HTML template editor library for Phase 22 without mid-flow permission prompts in Plans 22-02/22-03
- Built custom `ChipCombobox` component (77 lines, zero library dependencies) with full null-sentinel semantics: `selected=null` renders all chips selected, first deselect materializes explicit `string[]`
- Added 13 `.info-popup-config-*` CSS selectors to `global.css` — chips, editor wrapper, section disabled state, inline error, syntax/security notes; both Plans 22-02 and 22-03 import by class name only

## Task Commits

Each task was committed atomically:

1. **Task 1: Install CodeMirror 6 React wrapper + HTML language pack** - `910d6a9` (feat)
2. **Task 2 RED: Add failing ChipCombobox spec** - `752068a` (test)
3. **Task 2 GREEN: Add ChipCombobox custom component** - `eafcb44` (feat)
4. **Task 3: Add .info-popup-config-* CSS classes** - `1c68402` (feat)
5. **Auto-fix Rule 1: Type vi.fn() mock for tsc --noEmit** - `e5f501a` (fix)

_Note: TDD tasks have separate RED (test) and GREEN (implementation) commits per TDD protocol._

## Files Created/Modified

- `kinetica_bi/package.json` — Added `@uiw/react-codemirror` and `@codemirror/lang-html` dependencies
- `kinetica_bi/package-lock.json` — Updated with 24 new packages (289 lines changed)
- `kinetica_bi/src/components/charts/ChipCombobox.tsx` — Custom chip-combobox component (77 lines; null-sentinel semantics; exports `default`, `ChipComboboxOption`, `ChipComboboxProps`)
- `kinetica_bi/src/components/charts/ChipCombobox.spec.tsx` — 10-test spec covering C1-C10 behavior contract
- `kinetica_bi/src/styles/global.css` — 13 new `.info-popup-config-*` selectors appended after existing `.info-popup-*` block (+94 lines)

## Decisions Made

- **CodeMirror 6 (not Monaco):** `@uiw/react-codemirror` v4.x is the canonical React 6 wrapper. ~50-60KB gzip vs Monaco's ~500KB. Modular extension model allows adding `html()` extension for HTML syntax. Explicitly rejected: `monaco-editor`, `@monaco-editor/react`.
- **ChipCombobox custom (not library):** `react-select` v5 ~30KB, `@headlessui/react` Combobox ~12KB but requires Tailwind ergonomics, `cmdk` ~7KB but command-palette UX. 77-line custom build matches existing `config-group` styling and stays under 20KB gzip target.
- **Null sentinel policy (caller-owned compression):** ChipCombobox fires `onChange(string[])` on first deselect from null. It does NOT compress back to null when user re-selects everything — that's Plan 22-03's responsibility.
- **vi.fn() typed cast pattern:** vitest 4.x returns `Mock<Procedure | Constructable>` which is not directly assignable to typed callbacks in strict TypeScript. Pattern `vi.fn() as unknown as (T) => void` established for all spec files in this phase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Typed vi.fn() mock for tsc --noEmit compatibility**
- **Found during:** Overall verification step (after all 3 tasks committed)
- **Issue:** `vi.fn()` in vitest 4.x returns `Mock<Procedure | Constructable>` which TypeScript's strict mode does not accept as `(next: string[] | null) => void` — caused 10+ tsc errors in `ChipCombobox.spec.tsx`
- **Fix:** Changed `onChange: ReturnType<typeof vi.fn>` to `onChange: (next: string[] | null) => void` and cast assignment `vi.fn() as unknown as (next: string[] | null) => void`
- **Files modified:** `kinetica_bi/src/components/charts/ChipCombobox.spec.tsx`
- **Verification:** `npx tsc --noEmit` exits 0; 10/10 spec tests still green
- **Committed in:** `e5f501a`

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Auto-fix necessary for tsc type-safety compliance. Tests still pass. No scope creep.

## Issues Encountered

None beyond the auto-fixed vi.fn() type issue above.

## Bundle-Size Note

- `@uiw/react-codemirror` pulls in `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` as transitive dependencies (24 packages total)
- Combined gzip contribution: ~50-60KB (well within <500KB Monaco alternative target per 22-CONTEXT.md)
- `ChipCombobox.tsx`: 77 lines, zero runtime dependencies (only `useMemo` from React) — <1KB gzip contribution

## Next Phase Readiness

- **Plan 22-02 (widget-config):** Independent of this plan. Imports nothing from 22-01 (MapConfigPanel and its spec are the targets). CSS classes ready via `global.css` (`.info-popup-config-inline-error`, `.info-popup-config-section`).
- **Plan 22-03 (layer-config):** Imports `ChipCombobox` from `./ChipCombobox` and `CodeMirror` from `@uiw/react-codemirror` + `html` from `@codemirror/lang-html`. Both are now installable without mid-flow permission prompts.
- **No blockers for 22-02 or 22-03.**

## Self-Check: PASSED

All files verified:
- `kinetica_bi/src/components/charts/ChipCombobox.tsx` — FOUND
- `kinetica_bi/src/components/charts/ChipCombobox.spec.tsx` — FOUND
- `.planning/phases/22-config-ui/22-01-foundation-SUMMARY.md` — FOUND

All commits verified:
- `910d6a9` feat(22-01): install CodeMirror 6 React wrapper + HTML language pack — FOUND
- `752068a` test(22-01): add failing spec for ChipCombobox — FOUND
- `eafcb44` feat(22-01): add ChipCombobox custom component — FOUND
- `1c68402` feat(22-01): add .info-popup-config-* CSS classes — FOUND
- `e5f501a` fix(22-01): type vi.fn() mock in ChipCombobox spec for tsc --noEmit — FOUND

---
*Phase: 22-config-ui*
*Completed: 2026-05-08*
