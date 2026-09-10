# Phase 68: Cell-Drill Integration - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Clicking a non-empty calendar cell applies a timestamp `BETWEEN [cellStart, cellEnd]` filter to
the dashboard (table-bound) or the dv scope (dv-bound), shows a removable human-readable chip,
propagates to ALL consumer read-paths including WMS map tiles, and preserves the
`AggregatedWidgetRenderer`-as-sole-materialize-trigger invariant (statically asserted).

**SCOPE EXPANSION (operator decision 2026-06-16):** This phase ALSO adds a
**"Respond to dashboard filters"** config toggle (default OFF) that controls whether the
calendar reads the filtered view or always the unfiltered source. This edits the
already-shipped Phase 66 `CalendarConfigPanel.tsx` and Phase 67 `CalendarRenderer.tsx`.

Requirements: CALDR-V113-01, CALDR-V113-02, CALDR-V113-03.

</domain>

<decisions>
## Implementation Decisions

### Cell-click dispatch (the core drill)
- Click handler guards: `if (cell.value === null) return` — empty/grey cells already
  non-interactive (Phase 67 set `pointerEvents:none`); keep that guard in the handler too.
- `computeCellBounds(cellStartIso, subdomain)` → `[cellStart, cellEnd]` (cellEnd =
  nextBucketStart − 1ms). Build `ActiveFilter`:
  `{ column: timeCol, value: [cellStart, cellEnd], operator: "between", dataType: "datetime" }`.
- **Table-bound:** `useFilterStore.getState().setBulkFilters(tableId, [filter])` +
  `useFilterViewStore.getState().markMaterializing(tableId, dashboardId)`.
- **DV-bound:** `useFilterStore.getState().addDvFilter(dynamicViewId, filter)` +
  `useFilterViewStore.getState().markDvMaterializing(dynamicViewId, dashboardId)`.
  dv-isolated: writes `dvFilters[dvId]`, NEVER `filters[sourceTableId]` (CALDR-V113-02).
- **Do NOT reuse `dispatchDrillDown`** — it is eq-only (dedupes by `sameCol.value === value`);
  BETWEEN tuples won't dedupe correctly. Calendar gets its own dispatch (locked, STATE.md).

### Re-click & cross-cell behavior
- **Same active cell re-clicked → TOGGLE OFF:** clear the calendar's timeCol BETWEEN filter,
  return to unfiltered. (Chip X remains the robust clear path too.)
- **Different cell clicked → REPLACE** the timeCol range (single time range at a time);
  `setBulkFilters`/`addDvFilter` overwrite the same-column filter.
- **Other columns' filters → COEXIST (AND):** only the calendar's own timeCol BETWEEN is
  replaced; filters on other columns / from other widgets stay intact (multi-widget drill-down).

### Chip label (CALDR-V113-01 + UAT human-readable)
- **Explicit range** label (operator wants start AND end visible — e.g. for a week cell,
  "Mar 2 – Mar 8, 2026"). Not a single-token slice.
- **Format in `buildChipText`'s `between` branch** (src/lib/columnTypes.ts) for datetime values —
  benefits ALL datetime-between chips (timeline drag too), single source of truth. Current code
  renders raw values (`column between <lo> and <hi>`) → produces raw ISO; replace with
  human-readable formatting.
- **Smart per subdomain unit:** day→"Mar 3, 2026"; hour→"Mar 3, 2026 14:00"; week→start–end
  date range; month→"Mar 2026". Mirror Phase 67's tooltip smart-format.
- **Display the INCLUSIVE human end**, NOT the raw stored `nextBucketStart − 1ms` (which would
  read "…23:59:59.999"). Derive the human end from the bucket (e.g. last day of the week).

### Selected-cell feedback
- **Outline the active cell** while its filter is live (theme token, NOT raw hex). DERIVE the
  active cell REACTIVELY by matching the store's active between filter bounds against cell
  bounds (mirror TimelineRenderer's `appliedBand` memo, lines ~173-183) — so the highlight
  stays in sync with the chip and survives re-render. Clears when the chip is removed.
- **Toast on drill:** show an info toast with the slice label, consistent with
  `dispatchDrillDown`'s `showToast` pattern.
- **Cursor:** `pointer` on populated cells, default on empty (empty already `pointerEvents:none`).

### "Respond to dashboard filters" toggle (PULLED INTO THIS PHASE)
- **New config field:** checkbox labeled **"Respond to dashboard filters"** in
  `CalendarConfigPanel.tsx`, persisted on `CalendarConfig` (e.g. `respondToFilters: boolean`),
  **default OFF (false)**.
- **Semantics (whole-hog, cheap/buildable):**
  - **OFF (default):** CalendarRenderer ALWAYS reads the UNFILTERED source → table-bound:
    `schema.table` (ignore `fvViewName`); dv-bound: raw `dvViewName` (ignore `dvFilterViewName`).
    Full grid always; ignores ALL filters (its own AND others). Its cell clicks STILL drive
    filters into `filters[tableId]`/`dvFilters[dvId]` (other widgets narrow). This makes the
    calendar a stable drill CONTROL.
  - **ON:** current Phase 67 behavior — full FROM precedence
    `fvViewName || dvFilterViewName || dvViewName || "schema.table"` with the filter-aware
    re-fetch dep array (self-narrows + responds to others).
- **CalendarRenderer FROM resolution gates on the toggle** (edits Phase 67 file): when OFF,
  short-circuit to the unfiltered source before building SQL; when ON, keep the existing
  precedence. The re-fetch dep array stays (clicks still update the store), but with OFF the
  resolved FROM ignores the view names.
- **NOT in scope (deferred):** "ignore own filter but still respond to OTHER widgets' filters" —
  requires a second materialized view excluding the calendar's own filter (new materialize
  infrastructure). Captured in Deferred Ideas.
- **Phase 69 note:** CAL-V113-05's "re-fetches when another widget filters" is now demonstrated
  with the toggle ON; default-OFF widgets won't self-narrow. UAT must toggle ON to show
  filter-awareness.

### WMS map propagation (CALDR-V113-03)
- **Automated spec + explicit checklist item** (not deferred to live UAT — v1.12 Phase 63.1
  lesson). Assert a WMS map widget's `buildWmsParams` (the 2 sites) + dep-keys pick up the
  calendar's filter on the same scope.
- **Cover BOTH** table-bound (map on same table) AND dv-bound (map on same dv) paths.

### Sole-materialize-trigger invariant
- `CalendarRenderer.tsx` still NEVER imports `materializeFilter`/`dropFilterView` — the drill
  writes to the filter stores; `AggregatedWidgetRenderer` Effect 1 fires the materialize off the
  filterVersion / dv tick. Static-grep re-asserted this phase.

### Claude's Discretion
- Exact `respondToFilters` field name in code (label text "Respond to dashboard filters" is locked).
- Whether the cell-click handler lives inline in CalendarRenderer or a small extracted helper.
- Exact human-date formatter (reuse Phase 67 tooltip formatter / an existing date util).
- Toast message wording.
- Highlight outline thickness/style (theme token only).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Drill dispatch + dv-isolation (the patterns to mirror, NOT reuse-as-is)
- `packages/web/src/components/charts/WidgetRenderer.tsx` §104-160 — `dispatchDrillDown`
  (eq-only) showing the dv-isolated routing pattern: `dvFilters[dvId]` + `addDvFilter` +
  `markDvMaterializing` for dv-bound; `filters[tableId]` + `markMaterializing` for table-bound.
  Calendar replicates the ROUTING but for BETWEEN (its own dispatch, not this fn).
- `packages/web/src/components/charts/TimelineRenderer.tsx` §305-325 — the BETWEEN
  `setBulkFilters([filter]) + markMaterializing` table-path drill (calendar mirrors + ADDS the
  dv path Timeline lacks) — and `appliedBand` memo §173-183 (reactive active-filter derivation
  for the selected-cell highlight).

### Cell bounds + config + renderer (the files this phase edits)
- `packages/web/src/lib/calendarBin.ts` — `computeCellBounds(dateIso, subdomainUnit)` →
  `[cellStart, cellEnd]` (cellEnd = nextBucketStart − 1ms). The drill's range source.
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` — `CalendarConfig` +
  `DEFAULT_CALENDAR_CONFIG`; ADD the `respondToFilters` checkbox here (default false).
- `packages/web/src/components/charts/CalendarRenderer.tsx` — Phase 67 renderer; ADD the
  cell-click handler + selected-cell highlight, and GATE the FROM resolution on `respondToFilters`.

### Chip formatting
- `packages/web/src/lib/columnTypes.ts` — `buildChipText` (§~120-151); the `between` branch
  (§135-139) currently renders raw values — enhance the datetime case to human-readable range.

### Filter stores
- `packages/web/src/store/filterStore` — `setBulkFilters`, `addDvFilter`, `filters[tableId]`,
  `dvFilters[dvId]`, `filterVersion`.
- `packages/web/src/store/filterViewStore` — `markMaterializing`, `markDvMaterializing`,
  `views[tableId]`, `dvViews[dvId]`.
- `useToastStore` — `showToast(text, "info")` for the drill toast.

### WMS read-path
- The 2 `buildWmsParams` sites + dep keys (MapChartRenderer) — per the
  "Map WMS is a separate read-path" lesson: filter/dv FROM-swaps must wire MapChartRenderer too.

### Locked invariants
- `.planning/STATE.md` §"v1.13 Locked Decisions" — dv-isolated drill routing; DO NOT use
  dispatchDrillDown for BETWEEN (eq-only); WMS propagation verified in-phase; sole-materialize
  trigger; computeCellBounds half-open→inclusive semantics.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeCellBounds` (Phase 65): cell → [start, end] ISO. Ready.
- `dispatchDrillDown` dv-branch (WidgetRenderer 124-150): the dv-isolation routing template.
- TimelineRenderer BETWEEN drill (305-325) + `appliedBand` memo (173-183): table-path dispatch
  + reactive active-filter derivation (basis for selected-cell highlight).
- `buildChipText` (columnTypes.ts): chip text; between-datetime branch to enhance.
- `setBulkFilters`/`addDvFilter` + `markMaterializing`/`markDvMaterializing`: the store actions.
- `useToastStore.showToast`: drill toast.

### Established Patterns
- dv-isolation: route to `dvFilters[dvId]` when `dynamicViewId !== undefined`, else `filters[tableId]`.
- Reactive applied-filter highlight: memo over store filters matching column+operator+value.
- Sole-materialize-trigger: renderers write filters; AggregatedWidgetRenderer Effect 1 materializes.

### Integration Points
- `CalendarRenderer.tsx` — cell-click handler + highlight + toggle-gated FROM.
- `CalendarConfigPanel.tsx` — `respondToFilters` checkbox (default false) + CalendarConfig field.
- `columnTypes.ts::buildChipText` — human-readable datetime-between.
- MapChartRenderer `buildWmsParams` (×2) + dep keys — WMS propagation (verify, may need wiring).

### ⚠ Scope note for planner
- This phase edits TWO already-verified files (CalendarConfigPanel from Phase 66,
  CalendarRenderer from Phase 67). Re-run their specs + theme-guard; do not regress the 5/5
  Phase 67 criteria. The toggle changes default behavior (OFF) from what Phase 67 shipped
  (always filter-aware) — update CalendarRenderer.spec.tsx expectations accordingly.

</code_context>

<specifics>
## Specific Ideas

- Operator's framing: the calendar is primarily a **drill control** — you click cells to filter
  OTHER widgets, so by default it should stay a stable full grid (toggle OFF), not collapse onto
  its own selection. Filter-awareness is opt-in.
- Week cells must show start AND end dates in the chip ("Mar 2 – Mar 8, 2026") — the reason the
  chip is an explicit range, not a single token.

</specifics>

<deferred>
## Deferred Ideas

- **"Ignore own filter but still respond to other widgets' filters"** — the ideal heatmap UX,
  but needs a second materialized view computed WITHOUT the calendar's own filter (new
  server/materialize infrastructure). Candidate for its own phase / v2 (relate to CALX-V2-*).
- Keyboard / a11y activation of cells (click only this phase).
- Multi-range time selection (stacking) — explicitly rejected; single time range, replace-on-click.

</deferred>

---

*Phase: 68-cell-drill-integration*
*Context gathered: 2026-06-16*
