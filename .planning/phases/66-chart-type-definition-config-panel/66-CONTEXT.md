# Phase 66: Chart-Type Definition + Config Panel - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Operators can add a **Calendar Heatmap** widget to a dashboard and configure it end-to-end:
data-source binding (base table **OR** dynamic view), timestamp column, a **single** metric
column + aggregation, a Domain dropdown (`year`/`month`/`week`/`day`) and a dependent Subdomain
dropdown enforcing exactly the 8 valid combos, and a sequential color palette — then save a
valid config. A cell-count cap blocks runaway-grid configurations at save time.

**No renderer in this phase.** Adding a calendar widget renders a placeholder (NOT
`AggregatedWidgetRenderer`). `CalendarRenderer` ships in Phase 67.

Requirements: CAL-V113-01, CAL-V113-02, CAL-V113-05 (cap portion).

</domain>

<decisions>
## Implementation Decisions

### Chart-type definition (`definitions/calendar.ts` + `definitions/index.ts`)
- Mirror the Timeline registry precedent: `usesAggregation: false`, `usesDataSource: false`,
  `supportsDrillDown: false`, `CustomConfigPanel: CalendarConfigPanel`.
- `usesAggregation: false` is the mechanism that keeps the calendar OUT of
  `AggregatedWidgetRenderer` (locked invariant: AggregatedWidgetRenderer is the SOLE
  materialize trigger). Renderer is short-circuited by `widget.type === "calendar"` in
  `WidgetRenderer` (Phase 67 wires the real renderer; Phase 66 wires a placeholder branch).
- `icon`: 2-char text token (consistent with "TL"/"DF"/"LG"/"IC") — Claude's discretion (e.g. "Cal"/"CH").
- `defaultConfig`: full CalendarConfig shape with the creation defaults below.

### Data-source binding — roll-own picker, but dv-aware (the key divergence from Timeline)
- `usesDataSource: false` — the calendar follows the custom-renderer pattern where the
  renderer owns its full SQL lifecycle (Timeline/DataFilter precedent), so the generic
  `ChartConfigPanel` data-source section is suppressed.
- **BUT** unlike `TimelineConfigPanel` (base-table-only; it explicitly deferred dv),
  `CalendarConfigPanel` MUST render its own data-source dropdown that ALSO lists
  **Dynamic Views** — because CAL-V113-01 requires table OR dv binding.
- The dropdown dual-writes the binding the same way the generic picker does:
  - dv pick → `dynamicViewId` + `tableId` (= dv's source_table_id) + `tableRef`
  - table pick → `tableId` + `tableRef`, and CLEAR `dynamicViewId` (mutual exclusion)
  - Reference the generic picker's dual-write logic in `ChartConfigPanel.tsx` (~lines 213-252)
    and `DataSourceOption` union (~lines 96-164) as the source of truth for the dv branch.
- **DV FROM resolution (binding intent — consumed by Phase 67):** the resolved FROM target is
  `fvViewName || dvFilterViewName || dvViewName || "schema.table"` — the standard v1.12 dv
  precedence — resolved BEFORE `buildCalendarSql` is called (NO `fromSwap` inside the renderer;
  `buildCalendarSql.fromTarget` is caller-resolved by contract).

### Column pickers (carried from Timeline precedent — not re-discussed)
- Timestamp column dropdown: datetime types only, via `inferDataTypeFromColumn(name, columns) === "datetime"`.
- Metric is **SINGLE** (not Timeline's N-row 0..4 builder): `buildCalendarSql` takes one
  `metricColumn` + one `aggregation`. One column dropdown (numeric + drilldown-safe via
  `isColumnDrillDownSafe`) + one aggregation dropdown reusing the existing `AGGREGATIONS` list
  (SUM/AVG/MIN/MAX/COUNT/COUNT_DISTINCT/STDDEV/VARIANCE).

### Domain / Subdomain dropdowns
- Domain dropdown options: the keys of `VALID_DOMAIN_SUBDOMAIN` — `year` / `month` / `week` / `day`
  (derive from `Object.keys(VALID_DOMAIN_SUBDOMAIN)`, do NOT hardcode; `day` enables the day×hour combo).
- Subdomain dropdown is **dependent**: list ONLY the valid subdomains for the chosen domain
  (invalid options **hidden**, not greyed) — derived from `VALID_DOMAIN_SUBDOMAIN[domain]` in
  `calendarBin.ts`. The 8 valid combos: year×{month,week,day}, month×{week,day},
  week×{day,hour}, day×hour.
- Save validity gate: `isValidCombo(domain, subdomain)` from `calendarBin.ts` must be true →
  `isValid(false)` otherwise (defense-in-depth even though invalid options are hidden).

### Sequential palette
- Offer the **full Sequential group**: `CB_COLOR_THEMES.filter(t => t.group === "Sequential")`
  (18 schemes) — mirrors how `TimelineConfigPanel` filters to `"Qualitative"`.
- **Default palette: `Greens`.**
- Calendar is a heatmap → ONE sequential scale (not Timeline's per-metric qualitative swatches).
  Color application (the actual scale) is Phase 67; Phase 66 only persists the chosen scheme id.
- Theme tokens only — no raw hex in `CalendarConfigPanel.tsx` (theme-guard.spec.ts gate).

### Cell-count cap (CAL-V113-05 cap portion)
- **Basis:** on save, run a quick `SELECT MIN(timeCol), MAX(timeCol)` over the bound
  table/dv (the FROM target resolved as above), compute
  `estimatedCells ≈ span(min,max) ÷ subdomain-granularity` (× domain grouping as appropriate),
  and compare to the cap. This is the only data-dependent query in the panel and runs at
  save-time only.
- **Cap value: 10000** — aligned with `CELL_LIMIT` in `calendarBin.ts` (one number to reason about).
- **Behavior: HARD BLOCK** — over cap → clear user-facing message + `isValid(false)` so the
  config does NOT persist. No override.

### Creation defaults (pre-filled when widget is added)
- Domain = `month`, Subdomain = `day` (classic GitHub/Superset calendar; safe cell count).
- Aggregation = `COUNT`, metricColumn = `"*"` (renders meaningful row-counts-per-slice
  immediately without forcing a column pick; operator can switch to SUM/AVG + a column).
- Palette = `Greens`.

### Claude's Discretion
- Exact `icon` text token and `label` string.
- Panel section order / layout / labels (follow TimelineConfigPanel visual conventions).
- Placeholder widget appearance for the Phase-66 short-circuit branch (a simple "Calendar —
  renderer coming in Phase 67" placeholder is fine).
- Exact cell-estimate arithmetic (how span × domain × subdomain maps to a cell count) — must be
  a defensible upper-bound estimate; precise formula is the planner's call.
- Whether the MIN/MAX query reuses `runSql` directly or an existing helper.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 65 foundation (pure libs — already shipped)
- `packages/web/src/lib/calendarBin.ts` — `CalendarDomain`, `CalendarSubdomain`,
  `VALID_DOMAIN_SUBDOMAIN`, `isValidCombo`, `CELL_LIMIT` (10000), `KINETICA_DATE_TRUNC_UNITS`,
  `computeCellBounds`. The valid-combo set + cap constant THIS phase enforces.
- `packages/web/src/lib/buildCalendarSql.ts` — `BuildCalendarSqlArgs` (single `metricColumn` +
  `aggregation`; caller-resolved `fromTarget`) + `buildCalendarSql`. Confirms single-metric shape.

### Timeline precedent (the template to mirror)
- `packages/web/src/components/charts/definitions/timeline.ts` — registry entry shape
  (usesAggregation:false / usesDataSource:false / CustomConfigPanel).
- `packages/web/src/components/charts/definitions/index.ts` — where `registerCalendar()` is added.
- `packages/web/src/components/charts/TimelineConfigPanel.tsx` — config panel structure,
  column-type filtering (`inferDataTypeFromColumn`, `isColumnDrillDownSafe`), `AGGREGATIONS`
  list, `isValid` wiring, palette dropdown pattern (`CB_COLOR_THEMES.filter(group===...)`).
- `packages/web/src/components/charts/TimelineConfigPanel.spec.tsx` — spec patterns to mirror.

### DV-aware data-source picker (the divergence — must add what Timeline lacks)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` §~96-164 (`DataSourceOption` union,
  `dynamicViews` optgroup) and §~213-252 (dv pick dual-writes `dynamicViewId`+`tableId`; table
  pick clears `dynamicViewId`). Source of truth for the calendar panel's dv branch.

### Color themes
- `packages/web/src/lib/cbColorThemes.ts` — `CB_COLOR_THEMES`, `CbThemeGroup`
  ("Sequential"|"Diverging"|"Qualitative"), `getCbColorTheme`, `themeColorsFor`. 18 sequential
  schemes; `Greens` is the chosen default.

### Locked invariants (STATE.md — v1.13)
- `.planning/STATE.md` §"v1.13 Locked Decisions" — AggregatedWidgetRenderer = sole materialize
  trigger; theme tokens only; cap at config-save; dv-isolated drill (Phase 68).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `calendarBin.ts` / `buildCalendarSql.ts` (Phase 65): valid combos, cap, computeCellBounds,
  SQL builder — already shipped and tested. Phase 66 consumes the combo set + cap constant.
- `TimelineConfigPanel.tsx`: near-complete template — copy structure, swap N-metric builder for
  single-metric, swap qualitative palette filter for sequential, add domain/subdomain dropdowns.
- `ChartConfigPanel.tsx` dv picker logic: the dual-write pattern to replicate inside the calendar's
  own data-source dropdown.
- `cbColorThemes.ts`: sequential palette source (`group === "Sequential"`).
- `ConfigPanelProps` (`./registry`): `config`, `onChange`, `tables`, `isValid` — and note the
  calendar panel needs `dynamicViews` too (check whether ConfigPanelProps already passes it; the
  generic picker receives it as a prop — confirm threading to CustomConfigPanel during planning).

### Established Patterns
- Registry: `registerChartType(def)` in a `definitions/*.ts`, wired in `definitions/index.ts`.
- Renderer short-circuit: `else if (widget.type === "...") body = <XRenderer .../>` in `WidgetRenderer`.
- Config validity: `useEffect(() => isValid?.(formValid), [formValid, isValid])`.
- Config patch helper: `patch(partial) => onChange({ ...config, ...partial })`.

### Integration Points
- `WidgetRenderer` — add `widget.type === "calendar"` placeholder branch this phase.
- `definitions/index.ts::registerAllChartTypes()` — add `registerCalendar()`.
- Widget-type picker surfaces the new type automatically from the registry.

### ⚠️ Open question for the planner (data-source threading)
- TimelineConfigPanel is base-table-only and receives `tables`. The calendar panel needs the
  **`dynamicViews`** list too. Verify how `dynamicViews` reaches a `CustomConfigPanel`
  (ConfigPanelProps may not currently include it — the generic ChartConfigPanel gets it as its
  own prop). Threading dv data into the CustomConfigPanel may be a small required plumbing task.

</code_context>

<specifics>
## Specific Ideas

- "Roll-own picker like Timeline, but it must support dynamic views" — the operator wants the
  calendar to be a self-contained custom-renderer widget (consistent with Timeline/DataFilter),
  NOT routed through the generic data-source section, yet still bindable to a dv. This is the
  defining nuance of the phase: build the dv-aware picker Timeline never built.
- Default calendar = month×day, COUNT(*), Greens — should render something meaningful the moment
  it's added, before the operator touches anything.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope. (Renderer, color scale application, gap-fill,
  tooltips, filter-aware re-fetch → Phase 67. Cell drill/BETWEEN filter, dv-isolated routing,
  WMS propagation → Phase 68.)

</deferred>

---

*Phase: 66-chart-type-definition-config-panel*
*Context gathered: 2026-06-16*
