# Phase 67: SVG Calendar Renderer (Read-Only) - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A calendar widget on a dashboard fetches its time-bucketed data (via `buildCalendarSql` →
`runSql`), renders a **gap-filled** Domain/Subdomain grid of color-scaled SVG cells with
grey empty cells, time-axis labels, a color legend, and per-cell hover tooltips — and
**automatically re-fetches** when another widget applies a filter to the same table or dv.

**READ-ONLY.** No cell click / drill / BETWEEN-filter dispatch in this phase — that is
Phase 68. Empty cells are deliberately rendered non-interactive here to set up Phase 68's
click-guard cleanly.

Requirements: CAL-V113-04, CAL-V113-05 (filter-aware re-fetch portion).

</domain>

<decisions>
## Implementation Decisions

### Data-fetch lifecycle (mirror TimelineRenderer, extend FROM resolution)
- Model the fetch effect on `TimelineRenderer.tsx` (state: data/loading/error; AbortController;
  `cancelled` guard; `void fetchData()` in `useEffect`).
- **FROM target resolved BEFORE building SQL** (no `fromSwap`): precedence
  `fvViewName || dvFilterViewName || dvViewName || "schema.table"`.
  - Table-bound (`dynamicViewId === undefined`): use `fvViewName` when present (the
    materialized filter-view), else `schema.table`. Suspend while `fvMaterializing`; drop a
    stale view past `fvExpiresAt` (mirror TimelineRenderer lines 200-216).
  - DV-bound (`dynamicViewId !== undefined`): use `dvFilterViewName` (filtered-dv sub-view)
    when present, else `dvViewName` (raw dv view). Suspend while `dvFilterMaterializing`;
    gate render on `dvStatus`. (TimelineRenderer does NOT do the dv path — assemble it from
    `WidgetRenderer.tsx:425-470`, which holds the canonical dv selector + precedence logic.)
  - The resolved name is passed to `buildCalendarSql({ fromTarget, ... })` as an unprefixed
    table when it's a view (empty schema), exactly as TimelineRenderer feeds filter-views.
- **Re-fetch deps:** `filterVersion`, `fvViewName`, `fvExpiresAt`, `fvMaterializing` (table path),
  plus `dvFilterViewName`, `dvFilterMaterializing`, `dvViewName`, `dvStatus` (dv path), plus the
  config fields (`timeCol`, `metricColumn`, `aggregation`, `domain`, `subdomain`). This is the
  CAL-V113-05 filter-aware-consumer behavior.
- Single metric → single `runSql(buildCalendarSql(...))` (not Timeline's N parallel queries).

### Gap-fill (client-side, useMemo)
- DATE_TRUNC + GROUP BY returns only POPULATED buckets. Compute the FULL expected
  (domain_bucket × subdomain_bucket) set client-side via `useMemo` over the query response and
  fill missing positions with `null` (grey), NOT collapse neighbors. Deleting all rows for a
  range → grey cells in those positions, not a shifted grid.

### Color scale
- **Discrete quantized buckets, 5 steps** (default; GitHub-style). Use
  `themeColorsFor(getCbColorTheme(config.colorTheme), 5)` from `cbColorThemes.ts` — no
  interpolation library; the scheme already yields N discrete colors.
- **Linear domain** over `[min, max]` of the CURRENT (filtered) data; thresholds split the
  range into 5 equal bands. Derived REACTIVELY: `useMemo(() => computeDomain(data), [data])` —
  rescales correctly after a filter applies/clears (never initialized once at mount).
- **Color legend** rendered: a small discrete swatch strip with min/max ("Less → More") labels.
- Empty/null cells use the empty-cell grey (CSS custom property), NOT a palette color.

### Grid layout & orientation
- **GitHub-style:** each Domain group is a VERTICAL column of Subdomain cells; Domain groups
  laid out LEFT→RIGHT across the widget width. (e.g. month×day → each month a column of days.)
- **Square cells** with a small uniform gap.
- **Overflow:** keep cells a readable FIXED minimum size; when the grid exceeds the widget area,
  it SCROLLS within the widget (do not shrink cells to fit). The Phase 66 cell-count cap (10000)
  already bounds the worst case.

### Axis labels
- **Both axes labeled.** Domain axis: group labels (e.g. month names / years). Subdomain axis:
  the within-group unit labels (e.g. day-of-week / day-number / hour / week-number).
- Subdomain labels: **smart-by-unit + sparse** — auto-format per subdomain unit
  (day→Mon/Tue… or 1–31; hour→0–23h; week→W1…; month→Jan…) and show every Nth to avoid
  crowding on large grids.

### Tooltip
- Per-cell hover tooltip shows: human-readable time slice (composed from domain+subdomain
  bucket) + the **aggregation label** + the **formatted metric value**.
  e.g. `Mar 3, 2026 · SUM(amount): 1,240`.
- Empty/gap cells show **NO tooltip** (silent) — and are non-interactive (Phase 68 click-guard
  builds on this).

### States
- **Loading / error:** match TimelineRenderer conventions (loading text; error message block).
- **No-data-at-all** (zero rows / no time range): show a clear "No data for this time range"
  message — NOT an all-grey structural grid (mirrors TimelineRenderer's "No time range data").
- **Gap cells within a populated grid:** grey + silent (above).

### Theme compliance
- All colors from `chartTheme.ts` exports / `cbColorThemes` palette / CSS custom properties.
  NO hardcoded hex in `CalendarRenderer.tsx`. `theme-guard.spec.ts` auto-scans
  `src/components/**/*.tsx` → CalendarRenderer is in scope automatically (no allowlist entry).
- SVG strokes/axis/grid colors can't read CSS vars directly → use the existing
  `useChartAxisColors()` hook (as TimelineRenderer does) for axis/grid colors.

### Claude's Discretion
- Exact bucket count if 5 proves wrong for a unit (default 5 locked).
- Value number-formatting helper (reuse an existing formatter if one exists).
- Precise sparse-label stride math.
- SVG dimensions / cell px size constants.
- Tooltip implementation (reuse Timeline's tooltip pattern vs a lightweight title element).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Renderer template + lifecycle
- `packages/web/src/components/charts/TimelineRenderer.tsx` — fetch-effect skeleton, filter-view
  FROM-swap (lines ~194-303), AbortController/cancelled pattern, `useChartAxisColors()` usage,
  loading/error/empty-state conventions. The primary template.
- `packages/web/src/components/charts/TimelineRenderer.spec.tsx` — spec patterns to mirror.
- `packages/web/src/components/charts/WidgetRenderer.tsx` §425-470 — canonical dv FROM-target
  resolution: `dvEntry`/`dvStatus`/`dvViewName` (useDynamicViewStore) + `dvFilterViewName`/
  `dvFilterMaterializing` (useFilterViewStore.dvViews). Source of truth for the dv branch the
  calendar must add (Timeline lacks it). Also §347 — the calendar short-circuit branch (Phase 66
  placeholder) to replace with `<CalendarRenderer widget={widget} tables={tables} />`.

### Phase 65 + 66 foundation
- `packages/web/src/lib/buildCalendarSql.ts` — `buildCalendarSql({ fromTarget, timeCol,
  metricColumn, aggregation, domain, subdomain, limit? })` → emits domain_bucket /
  subdomain_bucket / value rows.
- `packages/web/src/lib/calendarBin.ts` — `computeCellBounds` (used Phase 68, not here),
  `VALID_DOMAIN_SUBDOMAIN`, `CELL_LIMIT`, `CalendarDomain`/`CalendarSubdomain` types.
- `packages/web/src/components/charts/CalendarConfigPanel.tsx` — `CalendarConfig` type +
  `DEFAULT_CALENDAR_CONFIG` (the exact config fields the renderer reads: domain, subdomain,
  metricColumn, aggregation, colorTheme, tableId/tableRef/dynamicViewId).

### Color + theme
- `packages/web/src/lib/cbColorThemes.ts` — `getCbColorTheme`, `themeColorsFor(theme, n)`
  (returns n discrete colors — basis for the 5-bucket scale).
- `packages/web/src/lib/chartTheme.ts` — existing theme constants (NOTE: no sequential scale
  helper exists; a small quantize helper is new work this phase).
- `packages/web/src/styles/theme-guard.spec.ts` — the no-raw-hex CI gate (auto-scans tsx).
- `useChartAxisColors()` hook (imported by TimelineRenderer) — theme-aware grid/axis colors.

### Locked invariants (STATE.md — v1.13)
- `.planning/STATE.md` §"v1.13 Locked Decisions" — no fromSwap in CalendarRenderer;
  AggregatedWidgetRenderer = sole materialize trigger (CalendarRenderer must NOT import
  `materializeFilter`/`dropFilterView` — re-asserted Phase 68); reactive color-scale domain;
  client-side gap-fill.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TimelineRenderer.tsx`: near-complete fetch-lifecycle template (state, abort, filter-view
  resolution, axis colors, loading/error). Copy structure; swap N-metric merge for single-metric
  + 2D gap-fill; swap Recharts line render for SVG cell grid.
- `WidgetRenderer.tsx:425-470`: the dv selectors + precedence to import for the dv branch.
- `cbColorThemes.themeColorsFor(theme, 5)`: the 5-bucket discrete palette.
- `useChartAxisColors()`: theme-aware SVG axis/grid colors.
- `buildCalendarSql`: data SQL (single call). `CalendarConfig` / `DEFAULT_CALENDAR_CONFIG`: shape.

### Established Patterns
- Renderer short-circuit already wired in `WidgetRenderer.tsx:347` (Phase 66 placeholder) —
  replace the placeholder body with the real renderer.
- Re-fetch dep arrays keyed on `filterVersion` + view-name/materializing flags (PITFALL C-02:
  scope view-store selectors to `views[tableId]` / `dvViews[dynamicViewId]`, never whole map).
- SVG color values must be concrete strings (can't reference CSS vars) → resolve via hook/palette.

### Integration Points
- `WidgetRenderer.tsx:347` — swap placeholder for `<CalendarRenderer widget tables />`.
- `useFilterStore` (filterVersion), `useFilterViewStore` (views[tableId] + dvViews[dvId]),
  `useDynamicViewStore` (views[dvId]) — the three stores the re-fetch watches.

### ⚠ New work (no existing equivalent)
- A sequential quantize helper (value → 1 of 5 palette buckets over a linear domain). chartTheme
  has only fixed palettes. Keep it pure + unit-testable (planner: consider a small lib module).
- 2D gap-fill (domain × subdomain expected-set) — Timeline's gap-fill is 1D (bucket set only).

</code_context>

<specifics>
## Specific Ideas

- GitHub contribution-graph aesthetic: square cells, columns per domain group, Less→More
  discrete legend, weekday/month axis labels.
- "Read-only now, drill later" — empty cells silent + non-interactive specifically so Phase 68's
  click handler can guard `if (cell.value === null) return` against a stable structure.

</specifics>

<deferred>
## Deferred Ideas

- Cell click → BETWEEN range filter, chip, dv-isolated routing, WMS propagation → **Phase 68**.
- `computeCellBounds` usage (cell → [start,end] ISO) is Phase 68, not this phase.
- Skeleton-grid loading state — considered, rejected in favor of TimelineRenderer parity.

</deferred>

---

*Phase: 67-svg-calendar-renderer-read-only*
*Context gathered: 2026-06-16*
