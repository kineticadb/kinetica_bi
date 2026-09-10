# Phase 10: Existing-Chart Drill-Down — Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire click-to-filter on the five existing aggregated chart types (bar, line, pie, scatter, table) plus the records table, rebuild the filter bar at `DashboardsPage.tsx:450-471` to be interactive, and add visual confirmation per DRILL-04.

**In scope (DRILL-01..DRILL-04):**

- Add `supportsDrillDown?: boolean` to `ChartTypeDefinition` and a `drillDownColumn?: string` slot in `widget.config` (consumed by `ChartConfigPanel`).
- Per-chart-type `onClick` handlers per ARCHITECTURE.md §6 click contract; each calls `useFilterStore.getState().addFilter` with the row's `cfg.drillDownColumn` value.
- Chart-config-time picker for `drillDownColumn` that excludes WKT, WKB, Kinetica geometry, and large-text columns (PITFALL D-01 lock).
- Rewrite the existing display-only filter bar to render `useFilterStore.filters[tableId]` chips alongside the persisted `view.filter_clause` static label, with `×` dismiss per chip and a per-table "Clear all" button.
- Transient dim-peers click-feedback animation on the originating chart, then the Phase 9 store update + C-03 data-clear + refetch sequence.
- Persistent row-tint on records/table charts where rows match an active filter on the configured `drillDownColumn`.
- Confirmation toast (`column = 'value'` per DRILL-04 criterion #5) fired on first add only; suppressed on Phase 9's dedupe and replace paths.

**Out of scope (deferred):**

- Range filters (`>=`, `<=`, `between`) — explicitly the v1.3 range-filter primitive (DRILL-V13-02). v1.2 stays equality-only per ROADMAP + REQUIREMENTS lock. Numeric columns flow through the picker with equality semantics; users self-select for low-cardinality categorical-numeric cases.
- Multi-value OR selection (DRILL-V13-01).
- Map-chart drill-down (Phase 12, IDENT-01..IDENT-03).
- Bignumber and heatmap drill-down (no row context for bignumber; heatmap renderer doesn't exist yet).
- Global "clear all tables" API or button (Phase 9 locked: scope is per-table only).

</domain>

<decisions>
## Implementation Decisions

### Drill-down column picker (DRILL-02)

- **Default `drillDownColumn` = `groupByColumn`** for bar/line/pie when present in the chart config; for scatter, default to the configured x-axis key; for records/table, no auto-default — user picks (see records section). Scatter's groupBy is less meaningful for equality, so the default matches the x-axis category column.
- **Optional, never required.** Empty `drillDownColumn` means the chart's click handler is a no-op. Existing dashboards keep working without re-config; users opt in by selecting a column. Aligned with `supportsDrillDown` gating from ARCHITECTURE §6.
- **Exclusion logic = column-type filter ONLY** (PITFALL D-01 lock + ROADMAP success criterion #4). Excluded types: WKT, WKB, Kinetica geometry, and large-text (e.g., long-string or string columns whose declared length is > 256 or unbounded). No distinct-count probe — pure metadata-driven, no extra round-trip.
- **Records-table picker:** show every column from the records table except the excluded types. User picks any (typically a primary-key or low-cardinality category). No auto-default — users see all options and select intentionally. This matches the research note: "Any visible column can be the drill-down column."
- **`bignumber` and `heatmap` chart types:** `supportsDrillDown` = false (or omitted), picker is hidden in their config panel.

### Selected element visual state (DRILL-04)

- **Sequenced dim-then-clear** to honor Phase 9 PITFALL C-03 ("clear `data` to null on filter change — show loading state, not stale data"):
  1. On click, set component-local `clickedElement = { column, value }` state
  2. Render current data with non-matching peers at 30% opacity, active element at full saturation, for ~300ms
  3. THEN dispatch `useFilterStore.getState().addFilter(...)` — this triggers C-03's data-clear → loading state → refetch sequence
  4. New filtered data renders normally; `clickedElement` state is cleared on data arrival
- **Visual style:** 30% opacity on peers, active stays full saturation. Single CSS property, theme-agnostic, no extra ring/scale.
- **Records/table chart — persistent row tint.** This is the one chart type where DRILL-04's "persists until filter cleared" criterion has visible effect post-refetch (rows aren't aggregated, so peers remain). Rows where `row[cfg.drillDownColumn] === activeFilter.value` get a subtle accent-tinted background that survives the refetch. Compatible with existing zebra-striping at `WidgetRenderer.tsx:443` and `:636`.
- **Aggregated charts (bar/line/pie/scatter) post-refetch:** the filtered data IS the persistent state. When `groupByColumn === drillDownColumn` (typical), the post-filter result is a single visible element — there are no peers to dim, and the filter bar chip carries the explicit "filter active" indicator. The ~300ms dim-peers animation is the only "selected" treatment for these types.
- **Charts on the same `tableId` whose `drillDownColumn` does NOT match an active filter's column:** silent refetch, no chart-card border, no badge. The filter bar chip is the global "this dashboard is filtered" indicator.

### Filter bar UX (DRILL-03)

- **Unified per-table row** at `DashboardsPage.tsx:450-471`:
  - One row per table (preserving the existing `view`-keyed iteration)
  - Inside each row, in order: (a) `[schema.table]:` label on the left; (b) the persisted `view.filter_clause` rendered as a non-dismissable static label (it's server-side and durable, NOT a transient store chip); (c) `useFilterStore.filters[tableId]` chips rendered inline as dismissable badges; (d) per-table "Clear all" button at the right end
  - Static `view.filter_clause` label gets neutral styling; store chips get accent + `×` button
  - This satisfies Phase 9 context's "shows BOTH unified" mandate
- **Chip text format:** `column = 'value'` with visible single quotes for strings (mirrors actual SQL exactly). For null: `column IS NULL`. For datetime: `column = '<ISO date>'`. For booleans/numbers: unquoted (`column = 5`, `column = TRUE`).
- **Chip layout:** chips on a single row; if they overflow, allow horizontal scroll within that table's filter row (predictable height). Wrap-to-multi-line is rejected as it makes the bar unpredictable in height across dashboards.
- **"Clear all" button** is per-table only. No global clear API exists (Phase 9 lock); button calls `useFilterStore.getState().clearFilters(tableId)`.
- **Empty state:** hide the entire filter bar when no table has either an active store filter OR a non-empty `view.filter_clause`. Bar appears the moment first filter is added; disappears if all filters are cleared and no static clauses exist.

### Toast + click affordances (DRILL-04)

- **Toast text on add:** literal `column = 'value'` per DRILL-04 success criterion #5 verbatim. For null: `column IS NULL`. Routed through existing `useToastStore.getState().showToast(message, kind)` from v1.0.
- **Toast suppression rules** (mirror Phase 9's silent paths):
  - **Skip on exact dedupe** (same column + same value already in `filters[tableId]`) — Phase 9 silent no-op
  - **Skip on same-column replace** (same column, different value) — Phase 9 silent replace; chip change is the feedback
  - **Show on first add** for a previously-unfiltered column
  - **Cap-reached toast still fires** independently with the Phase 9 message: `"Filter limit reached (10 per table). Clear some first."`
- **Cursor:** pointer cursor on chart elements (bar segments, slices, points, table rows) ONLY when `supportsDrillDown && cfg.drillDownColumn` is set. Otherwise default cursor. Discoverability without visual noise; bignumber and heatmap stay default.
- **Re-click already-active element:** silent no-op (matches Phase 9 dedupe lock). User dismisses via the chip's `×` button — re-clicking doesn't toggle off. Honors the locked store contract; toggle-off semantics would require revisiting `addFilter`'s spec.

### Click-handler wiring (per ARCHITECTURE §6)

| Chart type | Recharts event | Value extraction |
|------------|----------------|------------------|
| bar | `<BarChart onClick={...}>` → `e.activePayload?.[0]?.payload` | `payload[cfg.drillDownColumn]` |
| line | `<LineChart onClick={...}>` → `e.activePayload?.[0]?.payload` | `payload[cfg.drillDownColumn]` |
| pie | `<Pie onClick={(slice) => ...}>` → `slice.payload` (the source row) | `payload[cfg.drillDownColumn]` |
| scatter | `<ScatterChart onClick={...}>` → `e.activePayload?.[0]?.payload` | `payload[cfg.drillDownColumn]` |
| table | `<tr onClick={() => ...}>` with `row` in scope | `row[cfg.drillDownColumn]` |
| records | `<tr onClick={() => ...}>` with `row` in scope | `row[cfg.drillDownColumn]` |

Each renderer reads `cfg.tableId as number` (already persisted by 09-02). The dispatch path is:

```ts
const value = row[cfg.drillDownColumn];
useFilterStore.getState().addFilter({
  column: cfg.drillDownColumn,
  value,
  dataType: inferDataTypeFromColumn(cfg.drillDownColumn, schema),
  sourceWidgetId: widget.id,
  addedAt: Date.now(),
});
```

`inferDataTypeFromColumn` consults the chart's source-table schema (already accessible at config time and at render time via the existing tables/columns query pipeline).

### Claude's Discretion

- Exact CSS class names + transition timing curve for the dim-peers animation (target ~300ms; ease-out feel)
- Whether the dim-peers transient is implemented via a shared hook (e.g., `useDrillDownClickFeedback`) or inline in each renderer's `onClick`
- Whether `inferDataTypeFromColumn` lives next to the filter store, in `src/api/client.ts`, or in a new `src/lib/columnTypes.ts`
- Whether the records-table row-tint uses an existing accent CSS variable or introduces a new `--filter-active-row-bg` token
- The exact label copy on the per-table "Clear all" button ("Clear all" vs "Clear filters" vs "Reset")
- Whether geometry/large-text exclusion logic is centralized in a single helper (e.g., `isColumnDrillDownSafe(col)`) or inlined in `ChartConfigPanel`'s picker
- Test-spec layout: extending `WidgetRenderer.spec.tsx` vs new `DrillDown.spec.tsx` per chart type

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 10 requirements + research (PRIMARY)

- `.planning/REQUIREMENTS.md` — DRILL-01, DRILL-02, DRILL-03, DRILL-04 full text + traceability
- `.planning/REQUIREMENTS.md` § Drill-Down v1.3 — DRILL-V13-01, DRILL-V13-02, DRILL-V13-03 (deferred capabilities; Phase 10 must NOT pull these forward)
- `.planning/ROADMAP.md` § Phase 10 — five success criteria, canonical-refs list, anti-pattern locks (AP-1, AP-3, AP-4)
- `.planning/research/ARCHITECTURE.md` § 4 — Drill-Down State Model (filter store shape; Phase 9 already shipped this)
- `.planning/research/ARCHITECTURE.md` § 5 — Cross-Chart Coordination (re-fetch trigger, debouncing, cancel-in-flight)
- `.planning/research/ARCHITECTURE.md` § 6 — **Per-Chart-Type Drill-Down Contract** (the click-extraction table; CRITICAL for Phase 10)
- `.planning/research/ARCHITECTURE.md` § 8 — Anti-patterns AP-1 (no per-chart filter state), AP-3 (no fetch in store), AP-4 (no SQL refetch on tile load), AP-5 (no separate drillDown registry), AP-6 (no `tableId` runtime lookup)
- `.planning/research/PITFALLS.md` § D-01 — Geometry/large-text exclusion from picker
- `.planning/research/PITFALLS.md` § D-02..D-05 — Already locked in Phase 9 spec (escape, null, cap, replace) — Phase 10 inherits, doesn't re-test
- `.planning/research/PITFALLS.md` § C-02, C-03, C-04 — Cross-chart concurrency + stale-data + table-keyed shape (Phase 9 inherited; Phase 10 honors C-03 in the dim-then-clear sequence)
- `.planning/research/SUMMARY.md` — Synthesized v1.2 architecture + pitfall map

### Phase 9 outputs (MANDATORY READS — Phase 10 builds directly on these)

- `.planning/phases/09-filter-foundation/09-CONTEXT.md` — Phase 9 locked decisions (especially the `decisions` block: ActiveFilter shape, store API, dedupe/replace contracts)
- `.planning/phases/09-filter-foundation/09-VERIFICATION.md` — passed; documents the LOW-confidence TIMESTAMP literal format note (Phase 10 datetime click validation closes that loop)
- `.planning/phases/09-filter-foundation/09-01-SUMMARY.md`, `09-02-SUMMARY.md`, `09-03-SUMMARY.md` — final state of the store, SQL utilities, and renderer subscription wiring

### Project-level context

- `.planning/PROJECT.md` § Current State (mentions Phase 9 just completed), § Validated Requirements (FILT-01/02/03 now under v1.2 deliverables), § Out of Scope (locks v1.2 equality-only mental model)
- `.planning/STATE.md` — current position; Phase 10 unblocked, ready to plan

### Codebase maps (READ THESE BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases, no formatter config
- `.planning/codebase/STRUCTURE.md` — repo layout for new file placement
- `.planning/codebase/STACK.md` — existing dependencies (Recharts version, Zustand version, vitest version)
- `.planning/codebase/TESTING.md` — testing conventions, vitest config, RTL patterns

### Existing code (mandatory read before writing)

- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `AggregatedWidgetRenderer` (already subscribes to filter store from 09-03), bar/line/pie/scatter/table render branches, records-table renderer; Phase 10 adds `onClick` handlers + dim-peers transient
- `kinetica_bi/src/components/charts/WidgetRenderer.spec.tsx` — Phase 9's filter-subscription tests; Phase 10 extends with click-handler + visual-state assertions
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — config UI; Phase 10 adds `drillDownColumn` field for `supportsDrillDown` chart types; column list filtered by exclusion logic
- `kinetica_bi/src/components/charts/registry.ts` — `ChartTypeDefinition` type definition; Phase 10 adds optional `supportsDrillDown` field
- `kinetica_bi/src/components/charts/definitions/{bar,line,pie,scatter,table,records}.ts` — set `supportsDrillDown: true` on each
- `kinetica_bi/src/components/charts/definitions/{bignumber,heatmap,map}.ts` — leave `supportsDrillDown` unset/false
- `kinetica_bi/src/components/DashboardsPage.tsx` § lines 450-471 — the existing display-only filter bar; Phase 10 rewrites this block to read from `useFilterStore` while preserving the legacy `view.filter_clause` static display
- `kinetica_bi/src/store/filterStore.ts` — Phase 9 store: `useFilterStore`, `ActiveFilter` type, `addFilter`/`removeFilter`/`clearFilters` actions, `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`. Phase 10 is a CONSUMER — does not modify any of these
- `kinetica_bi/src/store/toast.ts` — `useToastStore` for the DRILL-04 toast surface
- `kinetica_bi/src/store/auth.ts` — Zustand pattern reference for any new helper hooks/stores (none expected for Phase 10)

### Anti-pattern locks (carry forward, must appear in plans)

- **AP-1**: Filter state lives in `useFilterStore` only — Phase 10's chart click handlers read+write via store actions, never local state or props
- **AP-3**: EVERY clicked value flowing into SQL goes through Phase 9's `escapeKineticaStringLiteral` (now via `addFilter` → `buildEqualityFilter`) — Phase 10 must not bypass
- **AP-4**: `tableId` is read from `widget.config.tableId` (already persisted by 09-02) — no runtime table-name lookup
- **AP-5**: `drillDownColumn` lives in `widget.config.drillDownColumn` only — no sibling registry
- **AP-6**: same as AP-4 — `tableId` is `number`, persisted at config-save time

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useFilterStore`** (`src/store/filterStore.ts`, ~195 LOC, shipped 09-01) — `addFilter`, `removeFilter`, `clearFilters(tableId)`, `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`, `injectWhereClause`. Phase 10 is purely a consumer.
- **`useToastStore`** (`src/store/toast.ts`, ~34 LOC) — `getState().showToast(message, kind)`. Phase 10 routes the DRILL-04 confirmation toast through this.
- **`AggregatedWidgetRenderer`** (`src/components/charts/WidgetRenderer.tsx`) — already subscribes to `useFilterStore.filters[tableId]` and `filterVersion` from 09-03; already has `AbortController` cleanup. Phase 10 adds `onClick` handlers and the dim-peers transient.
- **Recharts `<BarChart>`/`<LineChart>`/`<PieChart>`/`<ScatterChart>` `onClick` props** — already supported; payload includes `activePayload?.[0]?.payload` (the source row). For `<Pie>`, `onClick` fires per-slice with the slice's source row in `payload`.
- **Existing filter-bar markup** at `DashboardsPage.tsx:450-471` with classes `filter-bar`, `filter-bar-item`, `filter-bar-table`, `filter-bar-clause` — extend rather than replace; reuse the per-`view` row structure.
- **`__mocks__/zustand.ts`** + `src/test/setup.ts` — store-reset shim (PITFALL S-03 lock from Phase 9); Phase 10 specs inherit via `setupFiles`.

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per CONVENTIONS.md)
- 2-space indent; no formatter — match existing style
- Inline pitfall-comment style: `// PITFALL D-01 lock` for any drill-down picker exclusion code
- Zustand consumers read via selector hook (`const filters = useFilterStore((s) => s.filters[tableId])`) and never via prop-drilling
- Test specs colocated as `*.spec.{ts,tsx}`; vitest auto-discovers via `src/**/*.spec.{ts,tsx}` glob

### Integration Points

- `WidgetRenderer.tsx` chart `switch` — each renderer's JSX gains an `onClick` prop wired through `cfg.drillDownColumn` lookup; bignumber/heatmap branches unchanged
- `ChartConfigPanel.tsx` — adds a `drillDownColumn` field below `groupByColumn` for chart types where `supportsDrillDown === true`; column options filtered by `isColumnDrillDownSafe`
- `registry.ts` — `ChartTypeDefinition` gains `supportsDrillDown?: boolean`
- `DashboardsPage.tsx:450-471` — the JSX block is rewritten to render legacy clause + store chips + Clear-all button per table row; the surrounding `views.length > 0 &&` condition is replaced with the new "hide if entirely empty" logic
- `definitions/*.ts` — six files updated: bar/line/pie/scatter/table/records get `supportsDrillDown: true`; bignumber/heatmap/map remain false/unset

### Why no `runSql` or store changes in Phase 10

Phase 9 already shipped the SQL+store contract and the renderer subscription. Phase 10 is purely:

1. Surface (config-panel picker, chart click handlers, dim-peers transient, filter-bar rewrite, toast, cursor)
2. New `supportsDrillDown` flag on `ChartTypeDefinition`
3. New `drillDownColumn` field on `widget.config`
4. New `isColumnDrillDownSafe(col)` helper

No `src/store/filterStore.ts` modifications. No `src/api/client.ts` modifications. No backend changes.

</code_context>

<specifics>
## Specific Ideas

- "The filtered chart IS the persistent state" — for aggregated bar/pie/line/scatter, the post-refetch single-element view + the filter bar chip carry the persistent indicator together; chart-level "selected highlight" is purely transient
- "Sequenced dim-then-clear" — preserves Phase 9 PITFALL C-03 (no stale-data display) by running the dim-peers animation BEFORE the store dispatch that triggers the data clear
- "Records/table is the chart type where DRILL-04 'persists until cleared' has visible effect" — because rows aren't aggregated, peer rows survive the refetch
- "Clear all is per-table" — extends Phase 9's locked scope-discipline; no global clear button anywhere
- "Numeric columns flow through with equality semantics" — users self-select for low-cardinality categorical-numerics (status codes, year, small enums); continuous-numeric drill-down is awkward by design until v1.3 range filters land
- "Existing dashboards keep working without re-config" — `drillDownColumn` is optional; empty = no-op click; no migration burden

</specifics>

<deferred>
## Deferred Ideas

These came up during discussion but belong outside Phase 10:

- **Range-filter primitive** (`>=`, `<=`, `between` operators on `ActiveFilter`) — already named as DRILL-V13-02 / "range-filter primitive" in REQUIREMENTS.md v1.3 backlog. Discussed and rejected for v1.2 to honor the locked equality-only mental model and avoid pulling forward Phase 9's spec extension. Continuous-numeric drill-down stays awkward until v1.3.
- **Multi-value OR selection** (Ctrl-click multiple bars → `column IN (a, b, c)`) — locked as DRILL-V13-01 in v1.3 backlog
- **Bbox/lasso spatial select on map** — locked as DRILL-V13-02 in v1.3 backlog (requires range-filter primitive)
- **Undo last filter (Ctrl+Z)** — locked as DRILL-V13-03 in v1.3 backlog
- **Distinct-count probe in column picker** — discussed and rejected; type-only exclusion is sufficient for v1.2 per PITFALL D-01
- **Override-C-03 path** (keep stale data visible during refetch on originating chart with peers dimmed) — discussed and rejected as a per-chart exception to a Phase 9 lock; sequenced dim-then-clear is cleaner
- **Pure DOM-element click animation** (CSS pulse on clicked element only, no peer dimming) — discussed and rejected as too subtle for the DRILL-04 selected-state criterion
- **"Clear all tables" global button** — discussed and rejected; consistent with Phase 9's per-table-only `clearFilters` API
- **Always-visible filter bar with empty placeholder** — discussed and rejected as permanent vertical-space cost
- **Chart-card border on charts with active filters** (subtle border on every subscribed chart while filters exist) — discussed and rejected as visual noise; filter bar chip is sufficient
- **Re-click toggles filter off** — discussed and rejected; contradicts Phase 9 dedupe lock
- **Toast on dedupe + replace paths** — discussed and rejected as noisy; chip change is the feedback
- **Required `drillDownColumn` for `supportsDrillDown` charts** — discussed and rejected; would force migration of existing dashboards
- **Friendlier toast/chip copy** (e.g., `Filtered region to West`) — discussed and rejected; verbatim `column = 'value'` per DRILL-04 success criterion #5
- **Focus state for keyboard-driven chart clicks** — not discussed; deferred to a future a11y polish phase
- **Chip dismiss button keyboard accessibility** — not discussed; standard `<button>` element semantics expected; deferred a11y polish

</deferred>

---

*Phase: 10-existing-chart-drill-down*
*Context gathered: 2026-05-04*
