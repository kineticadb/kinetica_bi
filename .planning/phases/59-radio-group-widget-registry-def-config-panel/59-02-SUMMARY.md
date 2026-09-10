---
phase: 59-radio-group-widget-registry-def-config-panel
plan: 02
subsystem: ui
tags: [radio-group, config-panel, registry, tdd, target-picker, capture, json-editor, validation]

# Dependency graph
requires:
  - 59-01 (RadioGroupConfig/RadioOption types, validateRadioOption, isRadioGroupConfigValid, captureAllowListedSubset)
  - 58.1-01 (actionAllowList v2 — getFieldLocation, validateActionPatch, renderMode camelCase)
provides:
  - "radiogroup ChartTypeDefinition in registry (usesDataSource:false, CustomConfigPanel:RadioGroupConfigPanel)"
  - "registerRadioGroup() wired into registerAllChartTypes() — radiogroup appears in add-widget surface"
  - "RadioGroupConfigPanel — N-option authoring with label + 3-kind target picker + Capture + JSON editor + save-time validation"
affects:
  - 60 (RadioGroupRenderer + runtime wiring consumes the persisted RadioGroupConfig shape)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "usesDataSource:false + CustomConfigPanel registry shape (mirrors data-filter.ts precedent)"
    - "props.widgets for same-dashboard targets (NOT useDashboardContext — modal is outside DashboardContextProvider)"
    - "useDashboardLayersStore for layer targets (global Zustand, accessible from modal)"
    - "listDynamicViews(dashboardId, signal) with AbortController cleanup for dv targets"
    - "captureAllowListedSubset called on Capture button — pure function, sources passed in"
    - "validateRadioOption + isRadioGroupConfigValid signal isValid(false/true) in useEffect (mirrors DataFilterConfigPanel)"
    - "JSON.stringify/parse in textarea — parse error shown inline, config not mutated on failure"

key-files:
  created:
    - "packages/web/src/components/charts/definitions/radio-group.ts — ChartTypeDefinition for type 'radiogroup'"
    - "packages/web/src/components/charts/RadioGroupConfigPanel.tsx — CustomConfigPanel (N-option authoring)"
    - "packages/web/src/components/charts/RadioGroupConfigPanel.spec.tsx — 20 tests covering all behavior bullets"
  modified:
    - "packages/web/src/components/charts/definitions/index.ts — registerRadioGroup() added to registerAllChartTypes()"

key-decisions:
  - "RadioGroupConfigPanel reads widgets from props (NOT context) — WidgetConfigModal is outside DashboardContextProvider"
  - "Target change resets configPatch to {} — a new target invalidates the old patch (mirrors DataFilterConfigPanel reset-on-table-change)"
  - "captureAllowListedSubset is a pure function; config panel passes pre-fetched layer/widget/dv sources"
  - "JSON textarea is the raw configPatch viewer/editor — parse errors surfaced locally without corrupting config"
  - "isValid signal computed from isRadioGroupConfigValid in useEffect keyed on serialized config (mirrors DataFilterConfigPanel)"

# Metrics
duration: 4min
completed: 2026-06-10
---

# Phase 59 Plan 02: Radio-Group Config Panel + Registry Def Summary

**radiogroup ChartTypeDefinition (usesDataSource:false, CustomConfigPanel) registered in chart-type registry; RadioGroupConfigPanel authors N options with label + 3-kind target picker (props.widgets / useDashboardLayersStore / listDynamicViews) + Capture-from-target button + JSON textarea editor + save-time allow-list validation; 20 new tests, 1912/1912 vitest green, tsc clean**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-10T22:43:25Z
- **Completed:** 2026-06-10T22:47:12Z
- **Tasks:** 2 (Task 1: registry def + index wiring; Task 2: RadioGroupConfigPanel + spec)
- **Files modified:** 4 (3 new, 1 modified)

## Accomplishments

- **Task 1 (registry def + index wiring):** Created `definitions/radio-group.ts` mirroring the `data-filter.ts` precedent exactly. `type: "radiogroup"`, `label: "Radio Group"`, `icon: "RG"`, `fields: []`, `defaultConfig: { ...RADIO_GROUP_DEFAULT_CONFIG }` (spread to a plain Record), `usesAggregation: false`, `usesDataSource: false`, `supportsDrillDown: false`, `CustomConfigPanel: RadioGroupConfigPanel`. Wired `registerRadioGroup()` into `registerAllChartTypes()` with the Phase 59 comment. `getChartType("radiogroup")` resolves with `CustomConfigPanel` set.

- **Task 2 (RadioGroupConfigPanel + spec):** Created `RadioGroupConfigPanel.tsx` as the operator-facing authoring surface. Reads `widgets` from PROPS only (never `useDashboardContext` — modal is outside `DashboardContextProvider`). Layer targets from `useDashboardLayersStore`. Dynamic-view targets fetched via `listDynamicViews(dashboardId, signal)` with `AbortController` cleanup on unmount; skips fetch when no `dashboardId`. Per-option: label input; 3-kind target `<select>` with `<optgroup>` sections for Widgets / Map Layers / Dynamic Views; "Capture from target" button calls `captureAllowListedSubset` and writes the returned subset into `option.action.configPatch` via `onChange`; JSON `<textarea>` shows `JSON.stringify(configPatch, null, 2)` and updates on valid parse (inline error on bad JSON, config unchanged). Target change resets `configPatch` to `{}`. Orientation toggle (vertical default / horizontal), optional title `<input>`, optional `defaultOptionId` `<select>` with `(none)` entry. `isRadioGroupConfigValid` + `validateRadioOption` compute validity in `useMemo`; `isValid?.(result)` fired in `useEffect` on config change. Inline validation reasons rendered per option row.

## Task Commits

1. **Task 1** — `dcdf6ea` (feat): radiogroup chart-type registry def + index wiring
2. **Task 2** — `5687f5a` (feat): RadioGroupConfigPanel — N-option authoring with target picker + Capture + JSON editor + validation

## Test Gates

| Gate | Result |
|------|--------|
| `cd packages/web && npx vitest run src/components/charts/RadioGroupConfigPanel.spec.tsx` | 20/20 passed |
| `cd packages/web && npx vitest run` | 1912/1912 passed (91 files — was 1892, +20 new tests) |
| `cd packages/web && npx tsc --noEmit` | Clean (exit 0) |
| `git diff --name-only -- packages/server` | Empty — zero server changes |
| `grep -rn "render_mode" src/components/charts/RadioGroupConfigPanel.tsx src/components/charts/definitions/radio-group.ts` | No matches (renderMode camelCase only) |
| `grep -n "useDashboardContext" src/components/charts/RadioGroupConfigPanel.tsx` (functional code only) | No matches — reads from props.widgets only |

## Spec Coverage

The 20 tests in `RadioGroupConfigPanel.spec.tsx` cover:

1. **registers** — `getChartType("radiogroup")?.CustomConfigPanel` defined; `usesDataSource:false`
2. **option add** — clicking "Add option" calls `onChange` with one option appended (id, empty label, default action envelope)
3. **option remove** — clicking "Remove" splices out the row; `defaultOptionId` cleared if it pointed to removed option
4. **target picker lists** — widget labels, layer names, dv names all appear in target picker after mount + dv fetch
5. **target change resets** — changing target to a layer resets `configPatch` to `{}`
6. **Capture** — calls `captureAllowListedSubset` with correct args (target + layer source); writes patch into `configPatch`
7. **JSON edit valid** — valid JSON textarea change updates `configPatch`
8. **JSON edit invalid** — invalid JSON shows error, `onChange` NOT called (config not corrupted)
9. **orientation** — selecting "horizontal" calls `onChange` with `orientation: "horizontal"`
10. **defaultOptionId set** — selecting an option sets `defaultOptionId`
11. **defaultOptionId clear** — selecting "(none)" sets `defaultOptionId: undefined`
12. **title** — typing in title input calls `onChange` with `config.title`
13. **isValid(true)** — valid options with valid configPatch + non-empty labels
14. **isValid(false) empty options** — no options → `isValid(false)`
15. **isValid(false) empty configPatch** — option with `configPatch: {}` → `isValid(false)`
16. **isValid(false) empty label** — option with empty label → `isValid(false)`
17. **isValid(false) out-of-list** — `configPatch: { nonexistent_field_xyz: true }` → `isValid(false)`
18. **inline validation errors** — out-of-list `configPatch` shows `[data-testid="validation-errors-0"]` in DOM
19. **props.widgets rendered** — widget titles from `props.widgets` appear in target picker
20. **empty props.widgets** — no crash when `widgets=[]`

## Deviations from Plan

None — plan executed exactly as written. Task 2 was written as a combined RED+GREEN (component created alongside spec in one pass) given that the spec drove the component design, all 20 tests passed immediately on first run.

## Self-Check: PASSED

Files created/modified:
- FOUND: packages/web/src/components/charts/definitions/radio-group.ts
- FOUND: packages/web/src/components/charts/RadioGroupConfigPanel.tsx
- FOUND: packages/web/src/components/charts/RadioGroupConfigPanel.spec.tsx
- FOUND: packages/web/src/components/charts/definitions/index.ts (modified)

Commits:
- FOUND: dcdf6ea
- FOUND: 5687f5a

---

## Gap-Closure Note (SC3 — 2026-06-10)

**Gap:** ROADMAP SC3 required an explicit orphan-target warning when a configured target no longer exists on the dashboard. The original implementation blocked save indirectly (empty configPatch → `isValid(false)`) but did not render a dedicated warning element in the OptionRow.

**Fix (commit `efc40aa`):**
- Added orphan-target detection in `OptionRow`: `targetIsSet && !targetResolved` where `targetResolved` checks `allWidgets`/`layers`/`dynamicViews` for the configured `kind:id`.
- Renders `<div data-testid="orphan-target-warning-{idx}">Target no longer available — pick a new target</div>` styled with `color: var(--warning, #d97706)` (theme token, no hardcoded colors) when orphaned; absent when target resolves.
- Added 2-case spec to `RadioGroupConfigPanel.spec.tsx`: orphaned widget id (999, absent from `props.widgets`) renders the warning; resolvable id (1, present) does not.

**Test gates post-fix:**
| Gate | Result |
|------|--------|
| `cd packages/web && npx vitest run` | 1914/1914 passed (91 files, +2 new tests) |
| `cd packages/web && npx tsc --noEmit` | Clean (exit 0) |
| `git diff --name-only -- packages/server` | Empty — zero server changes |

SC3 is now fully satisfied.
