---
phase: 28-spatial-target-config
plan: 02
subsystem: ui
tags: [react, typescript, vitest, map-config, spatial-filtering, kinetica]

# Dependency graph
requires:
  - phase: 28-spatial-target-config
    plan: 01
    provides: SpatialMode + SpatialTarget types, getSpatialTargets/isSpatialTargetEligible helpers, MapWidgetConfig.spatialTargets?: SpatialTarget[]
  - phase: 11-map-widget-config
    provides: getValidSpatialColumns + autoSuggestSpatialMode (columnTypes.ts) — reused for per-row column filtering and on-table-change auto-suggest
provides:
  - ConfigPanelProps.tables?: { id, name, schema, columns }[] threading from ChartConfigPanel <Custom> slot
  - MapConfigPanel SPATIAL FILTER TARGETS section (UI editor; persistence rides existing onChange flow)
  - changeTable handler with autoSuggestSpatialMode auto-suggest pattern mirrored from LayersModal.tsx handleTableChange
  - WKB locked-verbatim warning text ("WKB spatial mode not yet supported — deferred")
  - Inline incomplete-row indicator ("Incomplete — will not filter")
affects:
  - 30-materialize-trigger (consumes getSpatialTargets(widget).filter(isSpatialTargetEligible) to compose materialize POST body)
  - DashboardsPage (no change — tables prop is already passed at ChartConfigPanel call site; new ConfigPanelProps.tables surface is purely additive)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-row auto-suggest-on-table-change pattern (mirrors LayersModal.tsx handleTableChange lines 147-165) reused inside MapConfigPanel"
    - "Mode-change stale-column clear pattern (mirrors KineticaWmsLayerForm onSelectSpatialMode lines 393-406)"
    - "Locked verbatim UI strings (WKB warning, empty-state, section header, incomplete indicator) asserted directly in spec — no constant indirection"
    - "Optional prop threading via additive ConfigPanelProps field; consumer panels destructure or ignore"

key-files:
  created: []
  modified:
    - "kinetica_bi/src/components/charts/registry.ts (+14 lines — optional tables?: { id, name, schema, columns }[] field on ConfigPanelProps)"
    - "kinetica_bi/src/components/charts/ChartConfigPanel.tsx (+1 line — tables={tables} prop forwarded to <Custom> slot)"
    - "kinetica_bi/src/components/charts/MapConfigPanel.tsx (+246 lines — SPATIAL FILTER TARGETS section + helpers imports + tables destructure)"
    - "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (+387 lines — 17 new it() cases under new describe block; +SpecTableInfo helper type)"

key-decisions:
  - "ConfigPanelProps.tables is OPTIONAL (?: …[]) — non-map panels (bar/line/pie/scatter/table/records/bignumber) ignore; MapConfigPanel destructures and uses for table-picker"
  - "Auto-suggest-on-table-change reuses autoSuggestSpatialMode (Phase 11 columnTypes.ts) — prior row.spatialMode NEVER preserved when table changes; new column shape may not satisfy the prior mode (CONTEXT.md line 57 LOCK)"
  - "WKB warning text 'WKB spatial mode not yet supported — deferred' is locked verbatim (en-dash U+2014); spec asserts via screen.getByText for regression catch"
  - "WKB row renders NO column picker — separate from incomplete indicator (WKB shows its own warning; incomplete shows only for latlon/wkt with missing columns)"
  - "Persistence rides existing ChartConfigPanel <Custom> onChange → onSave → PATCH /api/widgets/:id flow; MapConfigPanel does NOT call any API directly; debounce (if any) is upstream"
  - "Spec helper SpecTableInfo type declared so makeTables() return type widens columns to Record<string,string> (avoids TS narrowing the literal {lat:'double',…} union and rejecting cross-element assignability)"

requirements-completed:
  - TARGET-V15-01
  - TARGET-V15-03

# Metrics
duration: 4min
completed: 2026-05-12
---

# Phase 28 Plan 02: MapConfigPanel Spatial Filter Targets Section Summary

**Added the SPATIAL FILTER TARGETS section to MapConfigPanel — add/remove rows, per-row table picker + spatial-mode radio + per-mode column pickers, auto-suggest-on-table-change via `autoSuggestSpatialMode`, WKB verbatim warning, and inline incomplete indicator. Threaded `tables` through ConfigPanelProps + ChartConfigPanel `<Custom>` slot. 17 new spec tests; full frontend suite 570/570 green; tsc clean.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-12T17:30:27Z
- **Completed:** 2026-05-12T17:34:45Z
- **Tasks:** 3 (Task 1 auto; Tasks 2+3 tdd-style but executor used the plan's verbatim implementation + post-impl spec append, per plan 28-01 SUMMARY note)
- **Files modified:** 4

## Accomplishments

- `ConfigPanelProps.tables?: { id, name, schema, columns }[]` added as additive optional field — non-map panels unaffected
- `ChartConfigPanel.tsx` `<Custom>` slot now forwards `tables={tables}` (was already destructured from Props, so single-line edit)
- `MapConfigPanel` SPATIAL FILTER TARGETS section renders below INFO POPUP with:
  - Always-visible header `SPATIAL FILTER TARGETS` + `+` add affordance
  - Empty-state placeholder `No spatial filter targets configured.` when `spatialTargets` undefined or `[]`
  - Per-row card: table dropdown (sourced from `props.tables`) + trash icon, spatial-mode radio (latlon/wkt/wkb), mode-dependent column picker(s)
  - `changeTable` handler runs `autoSuggestSpatialMode(newColumns)` and writes the **suggested** mode (NOT prior) — clears stale columns
  - `changeMode` handler clears stale columns on every mode change
  - WKB row shows locked verbatim warning text; NO column picker rendered
  - Incomplete-row indicator shows when `!isSpatialTargetEligible(row) && row.spatialMode !== 'wkb'`
- `MapConfigPanel.spec.tsx` extended with new `describe("MapConfigPanel — Phase 28 Spatial filter targets section")` block (17 it() cases), all green
- TypeScript compilation clean across the project
- Full vitest suite: 570/570 (35 files) — no regression in any sibling spec

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ConfigPanelProps with optional tables + thread through ChartConfigPanel** — `af49e4f` (feat)
2. **Task 2: Add Spatial filter targets section to MapConfigPanel** — `432a1c1` (feat)
3. **Task 3: Extend MapConfigPanel.spec.tsx with Spatial filter targets coverage** — `9eb85c6` (test)

## Verbatim Text Strings Confirmed

| Text | Location | Asserted in spec |
| --- | --- | --- |
| `SPATIAL FILTER TARGETS` | section header label | T1 (`screen.getByText("SPATIAL FILTER TARGETS")`) + ordering check |
| `No spatial filter targets configured.` | empty-state placeholder | T2 |
| `WKB spatial mode not yet supported — deferred` (en-dash U+2014) | WKB row warning | T11 |
| `Incomplete — will not filter` (en-dash U+2014) | incomplete-row indicator | T13, T14, T15 |
| `+` | add affordance text | T3, T4, T5 |
| `Add spatial filter target` | aria-label on + button | T3, T4, T5 |
| `Remove spatial filter target {N}` | aria-label on trash button per row | T6 |
| `Spatial filter target {N} table` | aria-label on table select per row | T8, T8b, T16 |
| `Spatial filter target {N} longitude column` | aria-label on lon select | T9, T12 |
| `Spatial filter target {N} latitude column` | aria-label on lat select | T12 |
| `Spatial filter target {N} spatial column` | aria-label on wkt-mode select | T10, T12 |
| `Spatial filter target {N} mode` | aria-label on radiogroup | (struct asserted via radio name lookups in T7) |

## Auto-Suggest-on-Table-Change Wiring (CRITICAL)

The plan locks: when an operator picks a new table for an existing row, the row's `spatialMode` is **replaced** by `autoSuggestSpatialMode(newColumns)` — the prior mode is NEVER preserved.

**Implementation (MapConfigPanel.tsx changeTable):**
```typescript
const changeTable = (newTableId: number) => {
  const newTable = tables?.find((t) => t.id === newTableId);
  const newColumns: Column[] = newTable
    ? Object.entries(newTable.columns).map(([name, type]) => ({ name, type }))
    : [];
  const suggestedMode = autoSuggestSpatialMode(newColumns);
  const nextTargets = spatialTargets.map((t, i) =>
    i === idx
      ? {
          tableId: newTableId,
          spatialMode: suggestedMode,
          lonCol: undefined,
          latCol: undefined,
          spatialCol: undefined,
        }
      : t,
  );
  onChange({ ...config, spatialTargets: nextTargets });
};
```

**Spec T8b proves the auto-suggest fires on table change to a wkt-only table:**
- Fixture: `tableId=10` (lat/lon columns, mode='latlon') → change to `tableId=12` (columns `{boundary: "wkt"}`)
- `autoSuggestSpatialMode` precedence "type contains 'wkt'" returns `'wkt'`
- Assertion: `spatialMode: "wkt"` in the emitted onChange payload (with `// ← auto-suggested, NOT preserved from prior` annotation)

This mirrors `LayersModal.tsx handleTableChange` (lines 147-165) verbatim — same pattern, adapted to per-row patch.

## Test Counts

| Suite | Before Plan 28-02 | After Plan 28-02 | Delta |
| --- | --- | --- | --- |
| MapConfigPanel.spec.tsx — `it()` count | 23 (8 Phase 12 + 15 Phase 22 incl. GAP-24-01-B regression) | 40 | +17 |
| MapConfigPanel.spec.tsx — `describe()` count | 2 | 3 | +1 |
| Full frontend vitest suite | 553 / 35 files (baseline from 28-01 close) | 570 / 35 files | +17 |
| `kinetica_bi/src/lib/spatialTargets.spec.ts` | 15 | 15 | 0 (no regression) |

`npx tsc --noEmit` → exit 0
`npx vitest run src/components/charts/MapConfigPanel.spec.tsx` → 40/40 pass
`npx vitest run src/lib/spatialTargets.spec.ts` → 15/15 pass
`npx vitest run` → 570/570 pass (35 files)

## Decisions Made

- **`ConfigPanelProps.tables` is optional, additive** — Non-map panels (bar/line/pie/etc.) need not consume the new field; ts compilation is unaffected. MapConfigPanel destructures `{ config, onChange, tables }` for its picker.
- **`tables={tables}` passed at `<Custom>` slot only** — The non-custom branch of ChartConfigPanel doesn't need it; that branch renders the generic form which has no custom panel that consumes it.
- **`changeTable` always runs `autoSuggestSpatialMode`** — Even when the operator changes to a table where the prior mode would still be valid (e.g., latlon → latlon), the suggestion is applied. T8 spec covers this case (tableId=10 → tableId=11; both latlon-shape; mode stays latlon via auto-suggest, not via preservation).
- **`changeMode` also clears stale columns** — Distinct from `patchRow` (which is for column picks); mode change writes a full row replacement `{ tableId, spatialMode: newMode, lonCol: undefined, latCol: undefined, spatialCol: undefined }`.
- **Spec helper `SpecTableInfo` type declared explicitly** — Without it, TypeScript narrows the inline `{ lat: "double", lon: "double", ... }` columns object literal and treats it as having known keys, then rejects the array-of-tables assignment against `ConfigPanelProps.tables?` (Record<string,string>). Declaring `SpecTableInfo` with `columns: Record<string,string>` widens correctly. (Caught as Rule 3 blocking issue during tsc verification; fixed inline.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript narrowed makeTables() return type and rejected assignment to `ConfigPanelProps.tables?`**
- **Found during:** Task 3 (post-spec append, during plan-close tsc verification)
- **Issue:** Without an explicit return type, TS inferred each `makeTables()` array element as a narrow object literal (e.g., `{ lat: "double", lon: "double", geom: "wkt", id: "int" }`) and produced a union where each element was incompatible with `Record<string, string>` because optional/undefined properties on sibling literals leaked into the inferred type. `cd kinetica_bi && npx tsc --noEmit` reported 1 error at `MapConfigPanel.spec.tsx:772`.
- **Fix:** Declared a local `type SpecTableInfo = { id: number; name: string; schema: string; columns: Record<string, string> }` and annotated `makeTables(): SpecTableInfo[]`. Widens `columns` to the index-signature shape and matches `ConfigPanelProps.tables?[number]` exactly.
- **Files modified:** `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` (already in Task 3 commit since the type fix was applied before commit; no separate fix commit)
- **Commit:** `9eb85c6` (Task 3 — type fix bundled with spec body)

### TDD execution note (Tasks 2 and 3)

Plan 28-02 marked Tasks 2 and 3 `tdd="true"`, but the plan's `<action>` block specifies the implementation **verbatim** (full JSX block, full spec block). Per the prior plan 28-01 SUMMARY's TDD note, when the implementation is fully specified in the plan, a single GREEN commit per task is appropriate (no RED commit, no REFACTOR pass). The implementation in Task 2 passed all 17 spec assertions added in Task 3 on first run. No iteration was needed.

## Issues Encountered

- vitest 4.x produces deprecation warnings for `esbuild` options (`vite:react-babel` plugin); does not affect correctness — same warnings present in prior plan runs.
- DashboardContext.spec.tsx prints an intentional `useDashboardContext must be used inside DashboardContext.Provider` error during a negative-path test; the test passes (verifies the throw). This is pre-existing noise, not introduced by Plan 28-02.

## Verification Summary (plan close)

- `cd kinetica_bi && npx tsc --noEmit` → exit 0
- `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` → 40/40 (17 new + 23 baseline)
- `cd kinetica_bi && npx vitest run src/lib/spatialTargets.spec.ts` → 15/15 (no regression in Plan 28-01)
- `cd kinetica_bi && npx vitest run` → 570/570 (35 files)
- All Task 1, 2, 3 acceptance grep criteria PASS
- Section ordering verified: SPATIAL FILTER TARGETS at line 340 > INFO POPUP at line 257 (both inside the JSX render body)

## DashboardsPage Downstream-Consumer Note

`ChartConfigPanel` is already invoked with `tables={associatedTables}` at the DashboardsPage call site (the `tables?: TableInfo[]` field was always part of `ChartConfigPanel`'s `Props` type, declared at line 24). The new `ConfigPanelProps.tables` field simply makes the threading from `<Custom>` slot down to `MapConfigPanel` explicit. **No DashboardsPage edit needed.**

## TARGET-V15-01..03 Closure Status

| Requirement | Status | Where closed |
| --- | --- | --- |
| TARGET-V15-01 (spatialTargets type + persistence ride-along) | **Complete** | Plan 28-01 closed the type; Plan 28-02 wires the editor → onChange → existing PATCH /api/widgets/:id flow |
| TARGET-V15-02 (isSpatialTargetEligible single source of truth) | **Complete** (closed Plan 28-01) | n/a — closed in prior plan |
| TARGET-V15-03 (UI editor with WKB warning + incomplete indicator + auto-suggest-on-table-change) | **Complete** | Plan 28-02 SPATIAL FILTER TARGETS section + 17 spec tests |

Phase 28 milestone: editor + persistence complete; Phase 30 will wire `getSpatialTargets(widget).filter(isSpatialTargetEligible)` into the AggregatedWidgetRenderer materialize trigger.

## User Setup Required

None — no external service configuration. UI editor is operator-visible immediately; persistence rides the existing widget save flow.

## Next Phase Readiness

- **Plan 28 complete:** Phase 28 ships TARGET-V15-01 + V15-02 + V15-03 in full.
- **Phase 30 unblocked:** Operator-configured `widget.config.spatialTargets` is now persisted; Phase 30 materialize-trigger consumes via `getSpatialTargets(widget).filter(isSpatialTargetEligible)` to compose the materialize POST body.
- **No follow-up gaps:** No CSS class name conflicts (new `.config-spatial-targets*` namespace), no aria-label collisions (all per-row labels suffix with `${idx + 1}`), no a11y regressions (radio group has explicit `role="radiogroup"` + `aria-label`).

---
*Phase: 28-spatial-target-config*
*Completed: 2026-05-12*

## Self-Check: PASSED

- FOUND: kinetica_bi/src/components/charts/registry.ts
- FOUND: kinetica_bi/src/components/charts/ChartConfigPanel.tsx
- FOUND: kinetica_bi/src/components/charts/MapConfigPanel.tsx
- FOUND: kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
- FOUND: .planning/phases/28-spatial-target-config/28-02-SUMMARY.md
- FOUND commit: af49e4f (Task 1)
- FOUND commit: 432a1c1 (Task 2)
- FOUND commit: 9eb85c6 (Task 3)
