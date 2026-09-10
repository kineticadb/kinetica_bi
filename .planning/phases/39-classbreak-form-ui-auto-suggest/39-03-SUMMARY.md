---
phase: 39-classbreak-form-ui-auto-suggest
plan: 03
subsystem: ui
tags: [react, vitest, typescript, kinetica, classbreak, tdd, auto-suggest, categorical]

# Dependency graph
requires:
  - phase: 39-02
    provides: "CbConfigForm.tsx full implementation + CbConfigForm.spec.tsx 24 tests"
  - phase: 38-schema-wms-engine-foundation
    provides: "quantileFn + probeCardinality + useToastStore + fingerprint at MapChartRenderer.tsx:1118+1208"
provides:
  - "CbConfigForm.tsx: categorical <other> toggle + probeCardinality wiring + value validation + Auto-suggest + N slider + modal-confirm + AbortController + error UX"
  - "CbConfigForm.spec.tsx: 59 tests covering all CB-V17-02..08 behaviors"
  - "MapChartRenderer.spec.tsx: CB-V17-09 regression spec (5 tests) locking fingerprint invariant"
affects:
  - phase-43-live-uat

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CardinalityState machine: null | {state:'loading'} | {state:'ok',count} | {state:'error'}"
    - "AbortController per probe + per quantileFn call — probeAbortRef + autoSuggestAbortRef"
    - "Derived breakErrors: computed per render (no useState) via Map<string,number> for duplicate tracking"
    - "Confirm-overwrite pattern: showConfirm boolean state + inline role=dialog (mirrors LayersModal confirmDeleteId)"
    - "Color/label/advanced preservation by index: old breaks[i] fields preserved at matching index; new indices get PALETTE_COLORS[i%len]"
    - "Open-ended last row: value='' + label='≥ {lastBoundary}'"
    - "buildFingerprint regression: pure function test mirrors MapChartRenderer.tsx:1118 exactly"

key-files:
  created: []
  modified:
    - kinetica_bi/src/components/charts/CbConfigForm.tsx
    - kinetica_bi/src/components/charts/CbConfigForm.spec.tsx
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx

key-decisions:
  - "cardinality loading hint moved outside the valsType=categorical guard — probe fires before config prop updates (controlled component), so the hint must be visible during the in-flight probe even before parent propagates new valsType"
  - "aria-label removed from <other> chip span — span is a display element, not an interactive input; aria-label on a non-interactive span causes queryByLabelText to find it, conflicting with the intent that no value input exists for the <other> row"
  - "idempotent <other> test re-framed as 'orphaned row' scenario — initial state has includeOtherBucket=false but an <other> row already in breaks; toggling ON should detect the existing row and not add a second one"
  - "color-preservation test requires confirm dialog step — existing breaks.length > 0 triggers confirm-overwrite flow; test must click [Replace] before quantileFn resolves"

requirements-completed:
  - CB-V17-03
  - CB-V17-04
  - CB-V17-06
  - CB-V17-09

# Metrics
duration: ~9min
completed: 2026-05-21
---

# Phase 39 Plan 03: Categorical Auto-suggest and Fingerprint Summary

**Categorical <other> toggle + probeCardinality wiring + Auto-suggest with N slider + modal-confirm + AbortController + CB-V17-09 fingerprint regression spec — Phase 39 complete**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-21T18:36:08Z
- **Completed:** 2026-05-21T18:45:00Z
- **Tasks:** 3 (TDD: 2 commits RED + GREEN across Tasks 1+2; Task 3 direct)
- **Files modified:** 3

## Accomplishments

### Categorical UX (Task 1 — CB-V17-04)

- Categorical section (`cb-categorical-section`) renders above the row container when `valsType='categorical'`
- `<other>` bucket toggle (`aria-label="Include <other> bucket"`): ON appends row with `value='<other>'`, idempotent (no duplicate if row already exists), OFF removes all `<other>` rows + shows "NULL values will not appear in the map." warning
- `<other>` row value rendered as `<span class="cb-other-chip">` (NOT an input); remove button disabled on `<other>` row
- probeCardinality fires on categorical column select: cardinality loading hint visible outside the categorical section guard (controlled-component timing fix), AbortController per probe, re-fire on column change aborts previous
- Toast routing: count>100 → "permission" kind, count>256 → "error" kind; probeCardinality never fires in numeric mode
- Hard-cap: `cardinality.count > 256` disables `[+ Add break]` button
- Inline validation errors: "Value cannot be empty" + "Duplicate value" (`data-testid="cb-row-error-{i}"`); `<other>` row whitelisted from duplicate check
- isValid extended: categorical empty-value + duplicate rules enforced
- Column-change numeric→categorical: clears values to `""`, sets `includeOtherBucket=true`, appends `<other>` row

### Auto-suggest UX (Task 2 — CB-V17-06)

- Auto-suggest button + N slider visible only when `valsType='numeric' AND attr !== ""`
- N slider: range 2-16, default 5, displays `data-testid="cb-n-value"` alongside
- Confirm dialog (`role="dialog" aria-modal="true"`): shown when existing `breaks.length > 0`; [Replace] calls `runAutoSuggest()`, [Cancel] closes without calling `quantileFn`
- No confirm dialog when `breaks.length === 0` (direct call)
- On success: N rows total (N-1 boundaries + 1 open-ended row with `value=''` and `label='≥ {lastBoundary}'`)
- Color/label/advanced preservation by index: `old[i]` fields preserved for `i < oldBreaks.length`; new indices get PALETTE_COLORS fallback
- Error UX: inline `data-testid="cb-autosuggest-error"` + error toast; AbortError silently consumed
- Rapid re-click aborts in-flight request via `autoSuggestAbortRef`
- Zero legacy field writes confirmed (cbColumn/classbreaks absent from all onChange calls)

### CB-V17-09 Fingerprint Regression Spec (Task 3)

- Added `describe("Phase 39 CB-V17-09 — fingerprint covers layer.cb_config")` at end of MapChartRenderer.spec.tsx
- `buildFingerprint` pure helper mirrors `JSON.stringify({ p: wmsParams, c: cb_config, t: track_config })`
- 4 structural assertions: color edit differs, break-value edit differs, byte-identical stability, wmsParams Phase 38 lock
- 1 structural grep assertion: production code at lines 1118+1208 still uses `{p,c,t}` shape (regex match)
- 5/5 CB-V17-09 tests GREEN

## CbConfigForm.tsx Structure (Final)

- **Total lines:** 791 (was 469 at Plan 39-02 close)
- **Section breakdown (render order):**
  1. Column picker + WKB hint + empty hint
  2. Form-level Advanced header + panel (force-categorical checkbox)
  3. Cardinality loading hint (outside categorical guard — timing fix)
  4. Categorical section: cardinality warn/error hints + `<other>` toggle + NULL warning
  5. Auto-suggest panel: N label+slider + Auto-suggest button + error text + confirm dialog (numeric only, attr non-empty)
  6. Break rows container: chip/numeric/categorical value input + AARRGGBB color pair + label + remove (disabled on `<other>`) + inline error + per-row advanced panel
  7. `[+ Add break]` button + validity hint

## Test Surface

### CbConfigForm.spec.tsx
- **59 tests** in single `describe("CbConfigForm")` block
- Plan 39-02 tests (24): column picker, WKB hint, valsType auto-detect, add/remove/edit, color, Advanced override, column-change, isValid, per-row advanced, legacy guard
- Plan 39-03 Task 1 tests (21): categorical checkbox, `<other>` toggle ON/OFF/idempotent, NULL warning, chip vs input, disabled remove, probeCardinality wiring (loading/50/150/300), hard-cap, empty-value error, duplicate error, `<other>` whitelist, isValid categorical rules, column-change auto-defaults
- Plan 39-03 Task 2 tests (14): Auto-suggest visibility conditions, N slider, confirm dialog, Cancel/Replace, success (boundaries + open-ended row), color preservation, failure + error UX, AbortError silent, legacy guard

### MapChartRenderer.spec.tsx
- **5 new CB-V17-09 tests** added at end of file
- 1131/1131 full frontend suite GREEN

## Task Commits

1. **TDD RED: add failing specs** — `eadf3ab`
2. **TDD GREEN: implement categorical UX + Auto-suggest** — `9ebd1c7`
3. **feat: CB-V17-09 regression spec** — `ae63444`

## Phase 39 Closure

### ROADMAP Success Criteria Satisfied

- **SC #2:** Auto-suggest button calls /api/quantile, replaces rows on confirm, map re-renders via fingerprint — CLOSED (Task 2 + CB-V17-09 regression)
- **SC #3:** Categorical mode visible when TEXT/CHAR column selected, `<other>` bucket toggle present, cardinality probe warns + caps at 256 — CLOSED (Task 1)
- **SC #4:** WKB columns excluded from picker; inline message present — CLOSED (Plan 39-01 + 39-02)
- **SC #5:** lastEmittedParamsRef fingerprint regression spec locks cb_config coverage — CLOSED (Task 3)

### CB-V17 Requirements Closed

| Req | Plan | Description |
|-----|------|-------------|
| CB-V17-01 | 39-01 | Contour hidden from picker |
| CB-V17-02 | 39-02 | Column picker with exclusions |
| CB-V17-03 | 39-02+03 | N-row numeric builder with hard-cap |
| CB-V17-04 | 39-03 | Categorical breaks UX + `<other>` toggle + distinct-value probe |
| CB-V17-05 | 39-02 | Per-row value/color/label editing |
| CB-V17-06 | 39-03 | Auto-suggest button + modal-confirm |
| CB-V17-07 | 39-02 | Per-row advanced chevron (5 fields) |
| CB-V17-08 | 39-01+02 | WKB exclusion filter + hint |
| CB-V17-09 | 39-03 | Fingerprint regression spec |

All 9 CB-V17-01..09 requirements have at least one passing test asserting the behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cardinality loading hint moved outside categorical section guard**
- **Found during:** Task 1 (GREEN phase — test "selecting an attr column fires probeCardinality + shows loading hint" failing)
- **Issue:** Plan action placed the loading hint inside `{cbConfig.valsType === "categorical"}`. Since `CbConfigForm` uses controlled props (parent must propagate `onChange` result), the component's `cbConfig.valsType` is still `"numeric"` during the probe even after `onPickCbColumn("vendor")` fires. The categorical section was hidden, so the hint never rendered.
- **Fix:** Moved `{cardinality?.state === "loading"}` hint outside the categorical section guard into its own top-level conditional block. The non-loading cardinality hints (count warnings) stay inside the categorical section.
- **Files modified:** `kinetica_bi/src/components/charts/CbConfigForm.tsx`
- **Commit:** `9ebd1c7`

**2. [Rule 1 - Bug] aria-label removed from `<other>` chip span**
- **Found during:** Task 1 (GREEN phase — test "the <other> row's value field is rendered as a read-only chip, NOT an editable input" failing)
- **Issue:** Plan action set `aria-label={Value for break N}` on the chip span. Testing Library's `queryByLabelText("Value for break 2")` finds any element with that aria-label, including the span. The test expected null (no value input for the `<other>` row).
- **Fix:** Removed `aria-label` from the chip span. The `data-testid="cb-other-chip-{i}"` is the stable test selector. The chip is a display-only element; an aria-label here is semantically incorrect.
- **Files modified:** `kinetica_bi/src/components/charts/CbConfigForm.tsx`
- **Commit:** `9ebd1c7`

**3. [Rule 1 - Bug] Idempotent test re-framed as "orphaned row" scenario**
- **Found during:** Task 1 (GREEN phase — test "toggling <other> checkbox ON with <other> row already present does NOT duplicate the row" failing)
- **Issue:** Plan action rendered the test with `includeOtherBucket: true` and the `<other>` row, then clicked the checkbox. A checked checkbox click fires `e.target.checked=false` (toggle OFF), which removes the `<other>` row. The test expected `otherCount=1` after the toggle but the row was removed.
- **Fix:** Changed test to render with `includeOtherBucket: false` but an `<other>` row already orphaned in `breaks`. Clicking the checkbox (unchecked → checked) calls `onToggleOtherBucket(true)`, which detects the existing `<other>` row and skips appending a duplicate.
- **Files modified:** `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx`
- **Commit:** `9ebd1c7`

**4. [Rule 1 - Bug] Color-preservation test requires confirm-dialog click**
- **Found during:** Task 2 (GREEN phase — test "color preservation by index" failing with `parsedCbFromLastOnChange` returning undefined)
- **Issue:** Test rendered with 3 existing breaks then clicked Auto-suggest. Since `breaks.length > 0`, the confirm dialog appeared. `quantileFn` was never called (dialog blocks it), `onChange` was never called, so `onChange.mock.calls` was empty.
- **Fix:** Added `fireEvent.click(screen.getByLabelText("Replace breaks"))` after the confirm dialog appears, then awaited the resolved quantileFn before asserting the output.
- **Files modified:** `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx`
- **Commit:** `9ebd1c7`

## Self-Check

- `kinetica_bi/src/components/charts/CbConfigForm.tsx` 791 lines (>450 required) — CONFIRMED
- `grep -c "probeCardinality" CbConfigForm.tsx` >= 1 — CONFIRMED (4)
- `grep -c "useToastStore" CbConfigForm.tsx` >= 1 — CONFIRMED (4)
- `grep -c "Include &lt;other&gt; bucket" CbConfigForm.tsx` >= 1 — CONFIRMED (2)
- `grep -c "NULL values will not appear in the map" CbConfigForm.tsx` >= 1 — CONFIRMED (1)
- `grep -c "cb-other-chip" CbConfigForm.tsx` >= 1 — CONFIRMED (2)
- `grep -c "Value cannot be empty\|Duplicate value" CbConfigForm.tsx` >= 2 — CONFIRMED (3)
- `grep -c 'count > 256\|count > 100' CbConfigForm.tsx` >= 2 — CONFIRMED (5)
- `grep -c 'permission' CbConfigForm.tsx` >= 1 — CONFIRMED (1)
- `grep -c "AbortController" CbConfigForm.tsx` >= 1 — CONFIRMED (5)
- `grep -c "cbColumn\|classbreaks" CbConfigForm.tsx` === 0 — CONFIRMED (0)
- `grep -c "quantileFn" CbConfigForm.tsx` >= 1 — CONFIRMED (3)
- `grep -c "Auto-suggest breaks" CbConfigForm.tsx` >= 1 — CONFIRMED (2)
- `grep -c 'min={2}' CbConfigForm.tsx` >= 1 — CONFIRMED (1)
- `grep -c 'max={16}' CbConfigForm.tsx` >= 1 — CONFIRMED (1)
- `grep -c 'role="dialog"' CbConfigForm.tsx` >= 1 — CONFIRMED (1)
- `grep -c "autoSuggestAbortRef" CbConfigForm.tsx` >= 1 — CONFIRMED (6)
- `kinetica_bi/src/components/charts/CbConfigForm.spec.tsx` 1238 lines (>350 required) — CONFIRMED
- `grep -c "CB-V17-09" MapChartRenderer.spec.tsx` >= 1 — CONFIRMED (3)
- `grep -c "fingerprint covers layer.cb_config" MapChartRenderer.spec.tsx` >= 1 — CONFIRMED (2)
- `grep -c "buildFingerprint" MapChartRenderer.spec.tsx` >= 1 — CONFIRMED (6)
- 59/59 CbConfigForm.spec.tsx tests GREEN — CONFIRMED
- 5/5 MapChartRenderer.spec.tsx CB-V17-09 tests GREEN — CONFIRMED
- 1131/1131 full frontend suite GREEN — CONFIRMED
- tsc clean — CONFIRMED
- Commit `eadf3ab` (TDD RED) — CONFIRMED
- Commit `9ebd1c7` (TDD GREEN Tasks 1+2) — CONFIRMED
- Commit `ae63444` (Task 3) — CONFIRMED

## Self-Check: PASSED

---
*Phase: 39-classbreak-form-ui-auto-suggest*
*Completed: 2026-05-21*
