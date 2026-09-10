---
phase: 59-radio-group-widget-registry-def-config-panel
plan: 01
subsystem: ui
tags: [radio-group, config-data-model, allow-list, capture, tdd, renderMode, location-aware]

# Dependency graph
requires:
  - 58-01 (WidgetAction envelope, widgetAction.ts)
  - 58.1-01 (actionAllowList v2 — getFieldLocation, validateActionPatch, renderMode camelCase, per-field location)
provides:
  - "RadioGroupConfig / RadioOption / RadioOrientation types — per-option full WidgetAction envelope"
  - "RADIO_GROUP_DEFAULT_CONFIG — orientation vertical, empty options, no title/defaultOptionId"
  - "validateRadioOption(option, widgetType?) — delegates to Phase 58 validateActionPatch; rejects empty/out-of-list/meta/wrong-type"
  - "isRadioGroupConfigValid(config, widgetTypeFor) — all-options-valid + non-empty-label gate"
  - "captureAllowListedSubset(args) — location-aware snapshot; reads nested layer.config for renderMode/visible/opacity, top-level layer for track_config/cb_config, widget.config for widget targets"
affects:
  - 59-02 (RadioGroupConfigPanel consumes these directly — no codebase scavenger hunt)
  - 60 (runtime apply/select phase; RadioGroupConfig shape is consumed unchanged)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "validateRadioOption delegates to validateActionPatch — allow-list is the single save-time gate"
    - "captureAllowListedSubset derives field location via getFieldLocation — no hardcoded field→location mapping"
    - "Candidate field lists (LAYER_CAPTURE_FIELDS etc.) enumerate names; LOCATION always from getFieldLocation"
    - "TDD RED→GREEN for each task (2 RED commits + 2 GREEN commits)"

key-files:
  created:
    - "packages/web/src/lib/radioGroupConfig.ts — RadioGroupConfig/RadioOption types + RADIO_GROUP_DEFAULT_CONFIG + validateRadioOption + isRadioGroupConfigValid"
    - "packages/web/src/lib/radioGroupConfig.spec.ts — 23 tests: valid/empty/out-of-list/meta/wrong-type validateRadioOption + isRadioGroupConfigValid matrix"
    - "packages/web/src/lib/radioGroupCapture.ts — captureAllowListedSubset (location-aware) + LAYER/WIDGET/DYNAMICVIEW_CAPTURE_FIELDS"
    - "packages/web/src/lib/radioGroupCapture.spec.ts — 20 tests: nested config.renderMode + top-level track_config + widget.config + empty-patch edge cases"
  modified: []

key-decisions:
  - "validateRadioOption checks empty configPatch BEFORE delegating to validateActionPatch — the empty guard is a radio-specific rule; the allow-list handles all other validity checks"
  - "captureAllowListedSubset accepts pre-fetched sources (layer/widget/dynamicViewConfig) — pure function, no Zustand reads; config panel passes them in"
  - "WIDGET_CAPTURE_FIELDS keyed by widget type (map/chart/records) mirrors WIDGET_ALLOW_LIST structure"
  - "dynamicView capture defaults to empty patch (dv rows have no config blob); captureAllowListedSubset accepts optional dynamicViewConfig for operator override via JSON editor (59-02)"

# Metrics
duration: 5min
completed: 2026-06-10
---

# Phase 59 Plan 01: Radio-Group Config Data Model + Location-Aware Capture Summary

**RadioGroupConfig/RadioOption types + validateRadioOption (delegates to Phase 58 validateActionPatch) + location-aware captureAllowListedSubset (reads nested layer.config for renderMode/visible/opacity, TOP-LEVEL layer for track_config/cb_config, widget.config for widget targets — all via getFieldLocation, no hardcoded mappings); 43 new tests, 1892/1892 vitest green, tsc clean**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-10T22:34:51Z
- **Completed:** 2026-06-10T22:39:57Z
- **Tasks:** 2 (TDD: 4 commits RED+GREEN per task)
- **Files modified:** 4 (all new)

## Accomplishments

- **Task 1 (data model + validateRadioOption):** Created `radioGroupConfig.ts` with `RadioOrientation`, `RadioOption`, `RadioGroupConfig` types and `RADIO_GROUP_DEFAULT_CONFIG`. Each `RadioOption` carries a full, independent Phase 58 `WidgetAction` envelope — different options may target different widgets/layers/dv's. `validateRadioOption` first checks for empty configPatch (radio-specific gate: "empty configPatch — capture or author at least one field"), then delegates fully to `validateActionPatch(kind, widgetType, configPatch)` — valid options pass; empty/out-of-list/meta-blocked/wrong-type options are rejected with the underlying `reasons`. `isRadioGroupConfigValid` gates on non-empty options, non-empty labels, and all options passing `validateRadioOption`. No React/Zustand imports. 23/23 spec tests green.

- **Task 2 (location-aware Capture — highest-risk task):** Created `radioGroupCapture.ts` with `captureAllowListedSubset`. Candidate field names are enumerated (`LAYER_CAPTURE_FIELDS`, `WIDGET_CAPTURE_FIELDS`, `DYNAMICVIEW_CAPTURE_FIELDS`) but their LOCATIONS are always derived via `getFieldLocation` — no hardcoded field→location mappings. Location branches: `"layer.config"` → reads `layer.config[field]`; `"layer"` → reads `layer[field]` (TOP-LEVEL for track_config/cb_config); `"widget.config"` → reads `widget.config[field]` or `dynamicViewConfig[field]`. Null/absent values excluded. The critical combined spec proves a single capture from a layer with `config.renderMode = "raster"` and `track_config = '{"TRACK":true}'` returns both keys from their correct sources. 20/20 spec tests green.

## Task Commits

Each task committed atomically (TDD RED → GREEN):

1. **Task 1 RED** — `1e2d722` (test): add failing spec for RadioGroupConfig data model + validateRadioOption
2. **Task 1 GREEN** — `31b664b` (feat): RadioGroupConfig data model + validateRadioOption + isRadioGroupConfigValid
3. **Task 2 RED** — `8b50a37` (test): add failing spec for location-aware captureAllowListedSubset
4. **Task 2 GREEN** — `b0aec0b` (feat): location-aware captureAllowListedSubset reading from correct source per getFieldLocation
5. **Comment fix** — `c9e199c` (fix): remove render_mode mention from radioGroupConfig comment

## Test Gates

| Gate | Result |
|------|--------|
| `cd packages/web && npx vitest run src/lib/radioGroupConfig.spec.ts src/lib/radioGroupCapture.spec.ts` | 43/43 passed |
| `cd packages/web && npx vitest run` | 1892/1892 passed (90 files — baseline was 1849, +43 new tests) |
| `cd packages/web && npx tsc --noEmit` | Clean (exit 0) |
| `git diff --name-only -- packages/server` | Empty — zero server changes |
| `grep -rn "render_mode" src/lib/radioGroupConfig.ts src/lib/radioGroupCapture.ts` | No matches (renderMode camelCase only) |

## Critical Proof: Combined Nested + Top-Level Capture

The spec `radioGroupCapture.spec.ts` contains this critical test:

```
it("returns BOTH renderMode (from nested layer.config) AND track_config (from top-level) in one capture")
  layer = { config: { renderMode: "raster" }, track_config: '{"TRACK":true}' }
  result = captureAllowListedSubset({ target: { kind: "layer", id: 1 }, layer })
  → result.renderMode === "raster"     (from layer.config.renderMode — nested)
  → result.track_config === '{"TRACK":true}'  (from layer.track_config — top-level)
```

This proves the location-aware routing is correct: `getFieldLocation("layer", undefined, "renderMode")` returns `"layer.config"`, so the value is read from `layer.config`; `getFieldLocation("layer", undefined, "track_config")` returns `"layer"`, so the value is read from the top-level DTO field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `__proto__` object literal shorthand does not create an own property**
- **Found during:** Task 1 GREEN run
- **Issue:** Test `rejects __proto__` used `{ __proto__: {} }` in an object literal — in JavaScript this sets the prototype (not an own property), so `Object.keys()` never sees it. `validateActionPatch` uses `Object.keys()` safe enumeration by design, so the test fixture was triggering the wrong path.
- **Fix:** Replaced the object literal with `Object.defineProperty` to create an actual enumerable `__proto__` own-property, matching the stated contract.
- **Files modified:** `src/lib/radioGroupConfig.spec.ts`
- **Commit:** `31b664b`

**2. [Rule 2 - Comment] `render_mode` appeared in module comment doc strings**
- **Found during:** Post-task acceptance criteria grep
- **Issue:** The phrase "never render_mode (snake_case)" in a JSDoc comment triggered the `grep -rn "render_mode"` acceptance check.
- **Fix:** Rephrased comments to convey the same meaning without the snake_case string literal.
- **Files modified:** `src/lib/radioGroupConfig.ts`, `src/lib/radioGroupCapture.ts`
- **Commit:** `c9e199c`

## Self-Check: PASSED

Files created:
- FOUND: packages/web/src/lib/radioGroupConfig.ts
- FOUND: packages/web/src/lib/radioGroupConfig.spec.ts
- FOUND: packages/web/src/lib/radioGroupCapture.ts
- FOUND: packages/web/src/lib/radioGroupCapture.spec.ts

Commits:
- FOUND: 1e2d722
- FOUND: 31b664b
- FOUND: 8b50a37
- FOUND: b0aec0b
- FOUND: c9e199c
