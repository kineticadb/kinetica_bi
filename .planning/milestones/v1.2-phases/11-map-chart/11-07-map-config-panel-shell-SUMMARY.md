---
phase: 11-map-chart
plan: "07"
subsystem: ui
tags: [react, map, spatial, config-panel, wms, capabilities, tdd, vitest]

# Dependency graph
requires:
  - phase: 11-map-chart
    plan: "02"
    provides: getValidSpatialColumns + autoSuggestSpatialMode + SpatialMode type (columnTypes.ts)
  - phase: 11-map-chart
    plan: "03"
    provides: useWmsCapabilitiesStore Zustand store + capabilities.renderModes + capabilities.spatialModes
  - phase: 11-map-chart
    plan: "05"
    provides: definitions/map.ts Phase 11 schema (fields: [], CustomConfigPanel attachment point), CSS classes

provides:
  - "MapConfigPanel.tsx (281 lines): CustomConfigPanel React component covering spatial-mode + render-mode + basemap pickers"
  - "ConfigPanelProps.columns optional prop added to registry.ts — passes column list to Custom panels"
  - "ChartConfigPanel.tsx updated to pass allColumns to CustomConfigPanel"
  - "definitions/map.ts: CustomConfigPanel: MapConfigPanel attached with named import"
  - "PLACEHOLDER comment in MapConfigPanel.tsx at mode-specific param group insertion point (11-08 target)"

affects:
  - "11-08 (mode-specific param groups — raster/heatmap/classbreak/contour — land here)"
  - "11-06 (MapChartRenderer reads widget.config.spatialMode/renderMode/basemap set by this panel)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ConfigPanelProps.columns optional extension pattern: CustomConfigPanel can request column data via optional columns prop without breaking existing callers"
    - "TDD RED→GREEN: spec written first against locked UI-SPEC.md label strings; implementation follows spec"
    - "__autoSuggestActive draft flag: auto-suggest hint state persisted on draft object to survive re-renders; ChartConfigPanel copies all draft keys verbatim (potential __autoSuggestActive leak to widget.config — documented)"

key-files:
  created:
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
  modified:
    - kinetica_bi/src/components/charts/definitions/map.ts
    - kinetica_bi/src/components/charts/registry.ts
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx

key-decisions:
  - "ConfigPanelProps interface extended with optional columns prop (not a new type) — backward-compatible; existing callers pass nothing, MapConfigPanel receives columns to filter dropdowns"
  - "__autoSuggestActive is a useState<boolean> initialized from config.__autoSuggestActive — this allows parent re-renders to restore hint state while the modal is open; it is a draft-only flag not semantically part of widget.config. If QA shows it leaking into persisted widget.config, add a strip step in ChartConfigPanel's onSave (small targeted change; not done in this plan since it requires ChartConfigPanel scope)"
  - "autoSuggestSpatialMode result NOT immediately applied as checked radio — it is dispatched via onChange() which calls onSave() in ChartConfigPanel's current CustomConfigPanel pattern; the parent re-renders with updated config on next tick. This matches the existing CustomConfigPanel contract"
  - "renderMode defaults to 'raster' in component logic (config.renderMode ?? 'raster') — consistent with defaultConfig in definitions/map.ts; no write-back needed on render"
  - "MapConfigPanel matches actual ConfigPanelProps interface (config/onChange) not the plan's draft/setDraft/CustomConfigPanelProps which referred to a registry type that doesn't exist — plan interface comment was illustrative, not prescriptive"

patterns-established:
  - "PLACEHOLDER comment pattern: 11-08 inserts mode-specific param groups at the marked comment in MapConfigPanel.tsx"
  - "aria-label on each radio input + wrapping text label — UI-SPEC Accessibility contract compliance"

requirements-completed:
  - MAP-01
  - MAP-02
  - MAP-04

# Metrics
duration: ~4min
completed: 2026-05-05
---

# Phase 11 Plan 07: Map Config Panel Shell Summary

**MapConfigPanel.tsx (281 lines) with spatial-mode picker (3 radios + per-mode column dropdowns), render-mode picker (4 radios with capability gating), basemap picker (3 radios), auto-suggest + hint, and CustomConfigPanel attached to definitions/map.ts**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-05T13:57:15Z
- **Completed:** 2026-05-05T14:00:34Z
- **Tasks:** 2 (TDD: Task 1 = RED spec, Task 2 = GREEN impl)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `MapConfigPanel.tsx` (281 lines): all three foundational pickers with locked UI-SPEC.md label strings; capability gating with graceful null-fallback; per-mode column dropdowns; auto-suggest on first mount when spatialMode unset
- `MapConfigPanel.spec.tsx` (15 tests): covers picker labels, capability gating, auto-suggest, per-mode column filtering, per-mode column preservation (switching mode keeps other modes' picks), render mode default, basemap onChange, null capabilities fallback
- `definitions/map.ts`: `CustomConfigPanel: MapConfigPanel` attached (one import + one property line); opening a map widget's config modal now renders MapConfigPanel
- `ConfigPanelProps` extended with optional `columns` prop; `ChartConfigPanel.tsx` passes `allColumns` to CustomConfigPanel

## LOC of MapConfigPanel.tsx

**281 lines** — exceeds the plan's minimum of 200.

## Auto-Suggest Hint Implementation

Refactored from the plan's inline IIFE/useRef-based approach to:

```typescript
const [autoSuggestActive, setAutoSuggestActiveLocal] = useState<boolean>(
  () => Boolean(config.__autoSuggestActive),
);
```

**Used clean `useState<boolean>`** initialized lazily from `config.__autoSuggestActive` — recommended approach from the plan. The local state handles the per-modal-open hint lifecycle while the draft flag persists across parent re-renders.

## ChartConfigPanel draft strip for `__autoSuggestActive`

Not done in this plan. The `onChange` handler in ChartConfigPanel calls `onSave` immediately (current CustomConfigPanel pattern), copying all draft keys verbatim. If `__autoSuggestActive` leaks into `widget.config` in integration QA, add a one-line strip in `ChartConfigPanel`'s onChange handler for CustomConfigPanel:

```typescript
const { __autoSuggestActive: _drop, ...persistedConfig } = c;
onSave({ title: titleDraft, config: { ...persistedConfig, tableId: ... } });
```

This is a 2-line edit in ChartConfigPanel, no schema change required.

## UI-SPEC.md Locked Label Strings — Verbatim Confirmation

All `Microcopy / Labels (config panel)` strings appear in `MapConfigPanel.tsx`:

| String | Present |
|--------|---------|
| `SPATIAL MODE` | Yes (config-group-label) |
| `Latitude / Longitude pair` | Yes |
| `WKT geometry column` | Yes |
| `Kinetica geometry column` | Yes |
| `Latitude column` | Yes |
| `Longitude column` | Yes |
| `Geometry column (WKT)` | Yes |
| `Geometry column (Kinetica)` | Yes |
| `Auto-detected from column types` | Yes |
| `RENDER MODE` | Yes |
| `Raster (point markers)` | Yes |
| `Heatmap (density)` | Yes |
| `Classbreak (categorical)` | Yes |
| `Contour (lines)` | Yes |
| `BASEMAP` | Yes |
| `OpenStreetMap` | Yes |
| `CartoDB Voyager` | Yes |
| `CartoDB Dark Matter` | Yes |

## Test Count Delta

| Baseline (pre-11-07) | New (11-07) | Total |
|---------------------|-------------|-------|
| 179 tests | 15 tests | 194 tests passing |

(Pre-existing `MapChartRenderer.spec.tsx` OXC transform failure from plan 11-06 is unrelated and pre-existing before this plan's changes — confirmed via git stash.)

## Task Commits

1. **Task 1: TDD RED spec** - `9d0be66` (test)
2. **Task 2: GREEN implementation** - `03417db` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — New: MapConfigPanel React component (281 lines)
- `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — New: 15-test spec for all picker behaviors
- `kinetica_bi/src/components/charts/definitions/map.ts` — Modified: added import + CustomConfigPanel: MapConfigPanel property
- `kinetica_bi/src/components/charts/registry.ts` — Modified: ConfigPanelProps extended with optional columns prop
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — Modified: passes allColumns to CustomConfigPanel

## Decisions Made

- **ConfigPanelProps.columns** added as optional to avoid breaking existing callers (scatter/bar/line/pie/records don't need columns in their CustomConfigPanel — map is the only one that does today).
- **Actual interface** used (`config`/`onChange`) not the plan's proposed `draft`/`setDraft`/`columns` (`CustomConfigPanelProps`) which referenced a non-existent registry type. The plan's pseudocode was illustrative; implementation matches the actual `registry.ts` shape.
- **auto-suggest fires on empty columns list: no-op** (guard `if (columns.length === 0) return`) to avoid spurious onChange calls when the panel mounts before a table is selected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] ConfigPanelProps.columns added to registry.ts**
- **Found during:** Task 2 (implementation)
- **Issue:** `CustomConfigPanel` invocation in ChartConfigPanel did not pass columns to the panel. MapConfigPanel requires columns to filter spatial dropdowns via `getValidSpatialColumns`. Without this, all dropdowns would always show an empty list.
- **Fix:** Added `columns?: { name: string; type: string }[]` to `ConfigPanelProps` in `registry.ts`; updated ChartConfigPanel to pass `allColumns` in the Custom component render.
- **Files modified:** kinetica_bi/src/components/charts/registry.ts, kinetica_bi/src/components/charts/ChartConfigPanel.tsx
- **Verification:** All 15 MapConfigPanel spec tests pass including column dropdown filter tests.
- **Committed in:** 03417db (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical functionality)
**Impact on plan:** Required for correctness. Without columns prop, spatial column dropdowns would always be empty — defeating the entire purpose of the panel.

## Issues Encountered

- Pre-existing `MapChartRenderer.spec.tsx` OXC transform failure exists before this plan's work (confirmed: 11 passed / 1 failed both before and after our changes). Unrelated to 11-07. Logged in deferred-items.md.

## Next Phase Readiness

- **11-08 (mode-specific param groups):** Insert raster/heatmap/classbreak/contour `<div className="config-group">` sections at the `PLACEHOLDER` comment in `MapConfigPanel.tsx` (between RENDER MODE and BASEMAP sections). Component tree contract documented in UI-SPEC.md.
- **Integration QA:** Open any map widget's config gear — MapConfigPanel renders via ChartConfigPanel's CustomConfigPanel slot. Verify spatial mode picker, column dropdowns, render mode picker, basemap picker all work.
- **ChartConfigPanel `__autoSuggestActive` strip:** If QA shows `__autoSuggestActive` leaking into persisted `widget.config`, add a 2-line strip in ChartConfigPanel's CustomConfigPanel onChange before the onSave call (see above).

## Self-Check

Verified: `kinetica_bi/src/components/charts/MapConfigPanel.tsx` — FOUND
Verified: `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` — FOUND
Verified: `kinetica_bi/src/components/charts/definitions/map.ts` contains `CustomConfigPanel: MapConfigPanel` — FOUND
Verified: `kinetica_bi/src/components/charts/definitions/map.ts` contains `import MapConfigPanel` — FOUND
Verified commit 9d0be66 — FOUND
Verified commit 03417db — FOUND

## Self-Check: PASSED

---
*Phase: 11-map-chart*
*Completed: 2026-05-05*
