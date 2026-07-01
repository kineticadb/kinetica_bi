---
phase: 101-smart-logarithmic-y-axis
plan: "02"
subsystem: ui
tags: [recharts, y-axis, logarithmic, config-panel, renderer-wiring, tdd, static-assertion]

# Dependency graph
requires:
  - 101-01  # yAxisScaleProps(mode, values) helper from Wave 1
provides:
  - "yAxisScale? on TimelineConfig type + 'Y-axis scale' <select> after yAxisFormat control"
  - "yAxisScale? on NumericLineConfig type + <select> after yAxisFormat control"
  - "yAxisScale select ConfigField in definitions/bar.ts (Display group) + defaultConfig entry"
  - "yAxisScaleProps spread onto all 4 value-axis branches in TimelineRenderer"
  - "yAxisScaleProps spread onto all 4 value-axis branches in NumericLineRenderer"
  - "yAxisScaleProps spread onto both value axes in WidgetRenderer BarRenderer"
  - "Static-source assertions locking spread wiring per renderer (YAXIS-V119-04)"
affects:
  - 103  # verification phase will walk the new UI mode selector and chart rendering

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "yAxisScaleProps spread via plain call (not useMemo) after early returns — avoids hook-after-return violation"
    - "Static-source-assertion pattern (readFileSync + regex) for recharts axis prop verification in JSDOM"
    - "Empty-string coalesce: bar defaultConfig='' → || undefined → helper absent path (byte-identical)"

key-files:
  created: []
  modified:
    - packages/web/src/components/charts/TimelineConfigPanel.tsx
    - packages/web/src/components/charts/NumericLineConfigPanel.tsx
    - packages/web/src/components/charts/definitions/bar.ts
    - packages/web/src/components/charts/TimelineRenderer.tsx
    - packages/web/src/components/charts/NumericLineRenderer.tsx
    - packages/web/src/components/charts/WidgetRenderer.tsx
    - packages/web/src/components/charts/TimelineRenderer.spec.tsx
    - packages/web/src/components/charts/NumericLineRenderer.spec.tsx
    - packages/web/src/components/charts/WidgetRenderer.spec.tsx

key-decisions:
  - "scaleProps computed as a plain function call (not useMemo hook) after all early returns — correct because data is only available there; avoids Rule-of-Hooks violation"
  - "Bar defaultConfig uses '' (empty string) not undefined; coalesce with || undefined before passing to helper to hit the no-props path"
  - "Existing numericValues flatMap (used by estimateValueAxisWidth) reused for scaleProps — zero extra data scan"
  - "Category axes (type=category YAxis and dataKey={x} XAxis) do NOT receive {...scaleProps} — only value axes do"

requirements-completed: [YAXIS-V119-01, YAXIS-V119-02, YAXIS-V119-03, YAXIS-V119-04]

# Metrics
duration: 17min
completed: "2026-07-01"
---

# Phase 101 Plan 02: Smart Logarithmic Y-Axis — Renderer Wiring Summary

**End-to-end Y-axis scale wiring: Zero-based / Smart / Logarithmic select in all 3 config surfaces + yAxisScaleProps spread on every value axis in TimelineRenderer, NumericLineRenderer, and WidgetRenderer (bar)**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-07-01T12:20:00Z
- **Completed:** 2026-07-01T12:37:00Z
- **Tasks:** 4 (config surfaces, timeline/numericline wiring, bar wiring, TDD tests)
- **Files modified:** 9

## Accomplishments

- Added `yAxisScale?: YAxisScaleMode` to `TimelineConfig` and `NumericLineConfig` types with import from `lib/yAxisScale`
- Added `<select>` UI control (Y-axis scale, Default/Zero-based/Smart/Logarithmic) after the yAxisFormat block in both config panels; uses only `ds-select`/`ds-field`/`ds-field-label` classes
- Added `yAxisScale` as a `type: "select"` ConfigField in `definitions/bar.ts` (Display group) with `options` array and `defaultValue: ""`; existing FieldRenderer `case "select"` already supported this
- In `TimelineRenderer`: import + destructure `cfg.yAxisScale`, compute `scaleProps = yAxisScaleProps(yAxisScale, numericValues)` (reusing the existing flatMap), spread `{...scaleProps}` on all 4 value-axis branches (grouped+vertical XAxis, grouped+horizontal YAxis, ungrouped+vertical per-metric XAxis, ungrouped+horizontal per-metric YAxis)
- In `NumericLineRenderer`: identical change — 4 value-axis branches
- In `WidgetRenderer` BarRenderer: import `yAxisScaleProps`, read `config.yAxisScale` with `|| undefined` coalesce (bar defaultConfig is `""`), `scaleProps` from data `y` column values, spread on `XAxis type="number"` (horizontal) and `YAxis` (vertical); category axes untouched
- Added 3 static-source-assertion tests per renderer (9 total) locking the structural wiring

## Task Commits

1. **Task 1: Add 'Y-axis scale' select to all 3 config surfaces** — `333fd33` (feat)
2. **Task 2: Spread yAxisScaleProps onto all 4 value-axis branches in Timeline + NumericLine** — `7e9dfe8` (feat)
3. **Task 3: Spread yAxisScaleProps onto bar value axes in WidgetRenderer** — `3cdb460` (feat)
4. **Task 4: Static-source assertions per renderer (YAXIS-V119-04 lock)** — `4e4d50e` (test)

## Files Modified

- `packages/web/src/components/charts/TimelineConfigPanel.tsx` — `YAxisScaleMode` type field + `<select>` UI
- `packages/web/src/components/charts/NumericLineConfigPanel.tsx` — same
- `packages/web/src/components/charts/definitions/bar.ts` — `yAxisScale` ConfigField + defaultConfig
- `packages/web/src/components/charts/TimelineRenderer.tsx` — import + 4-branch spread
- `packages/web/src/components/charts/NumericLineRenderer.tsx` — import + 4-branch spread
- `packages/web/src/components/charts/WidgetRenderer.tsx` — import + 2-axis spread in BarRenderer
- `packages/web/src/components/charts/TimelineRenderer.spec.tsx` — 3 static-source tests
- `packages/web/src/components/charts/NumericLineRenderer.spec.tsx` — 3 static-source tests
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` — 3 static-source tests

## Decisions Made

- **Plain call not useMemo:** `scaleProps = yAxisScaleProps(...)` is placed after all early returns where `data` is available. Using `useMemo` there would violate Rules of Hooks (hooks cannot appear after conditional returns). A plain function call is correct and re-runs each render pass.
- **Bar empty-string coalesce:** Bar's `defaultConfig` stores `""` (not `undefined`) per the registry pattern. The coalesce `|| undefined` converts `""` to `undefined` before passing to the helper, ensuring the no-props (byte-identical) path fires for unconfigured bars.
- **Reuse existing flatMap for `numericValues`:** The existing `estimateValueAxisWidth` call already computed the same flatMap. Extracted to a named variable `numericValues` shared by both `yAxisWidth` and `scaleProps` — zero extra iteration.

## Deviations from Plan

**Auto-fixed: Rule-of-Hooks violation**

- **Found during:** Task 2 execution (test run after initial implementation)
- **Issue:** Initially added `scaleProps = useMemo(...)` after the early returns (loading/error/empty-data gates). React throws "Rendered more hooks than during the previous render" because hooks cannot appear after conditional returns.
- **Fix:** Replaced `useMemo` with a plain function call `scaleProps = yAxisScaleProps(yAxisScale, numericValues)`. Since `data` is only available after all early returns anyway, the plain call is semantically correct — no caching needed (re-execution on every render is fine for a pure function).
- **Files modified:** TimelineRenderer.tsx, NumericLineRenderer.tsx
- **Commit:** `7e9dfe8`

## Test Results

- `npx vitest run src/components/charts/TimelineRenderer.spec.tsx src/components/charts/NumericLineRenderer.spec.tsx src/components/charts/WidgetRenderer.spec.tsx src/lib/yAxisScale.spec.ts` → 180 passed, 0 failed
- Full web suite `npx vitest run` → 137 files passed, 3152 tests passed, 0 failed
- `npx tsc --noEmit` → clean
- `npx vitest run src/styles/theme-guard.spec.ts` → 136 passed (green)
- `git diff --name-only -- packages/server | wc -l` → 0 (zero server diff)

## Self-Check: PASSED

All 9 modified/created files verified present. All 4 task commits verified in git log:
- `333fd33` feat(101-02): config surfaces
- `7e9dfe8` feat(101-02): timeline + numericline renderer wiring
- `3cdb460` feat(101-02): bar renderer wiring
- `4e4d50e` test(101-02): static-source assertions

---

*Phase: 101-smart-logarithmic-y-axis*
*Completed: 2026-07-01*
