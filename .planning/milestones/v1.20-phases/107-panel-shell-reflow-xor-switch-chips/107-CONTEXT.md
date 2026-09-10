# Phase 107: Panel Shell + Reflow + XOR Switch + Chips - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

When a dashboard's mode is `panel` (persisted in Phase 106), render its active filters in a collapsible right-side drawer INSTEAD of the top bar (mutually exclusive — never both). The drawer shows chips grouped by source with per-chip remove + per-group clear, provenance, an empty state, and a collapsed count badge — all via a single shared `FilterChip` component (also adopted by the top bar) — with the dashboard grid auto-reflowing to make room.

Covers FPANEL-V120-01…09. NOT here: the per-filter applies-to list + on-canvas highlight (Phase 108), the GLOBAL clear-all-dashboard-filters action (Phase 109 — this phase gives per-GROUP clear only), and the designer toggle UI that sets the mode (Phase 110).
</domain>

<decisions>
## Implementation Decisions

### Panel shell — collapse & default state
- **Default expanded** when mode=`panel` (filters immediately visible — the point of choosing panel mode).
- **Collapsed form = a thin vertical rail** docked on the right showing a filter **count badge** (the active-filter count) + an expand handle. One click reopens. (NOT fully-hidden.) The count badge (FPANEL-V120-05) lives on this rail.
- **Collapse state remembered per-user, per-dashboard via localStorage** — survives reloads without touching the designer's saved default mode. (Client-only preference; do NOT persist server-side.)

### Panel shell — width & responsiveness
- Fixed panel width (Claude's discretion; ~300px, using a `--filter-panel-width`-style token consistent with the existing `.sidebar` pattern).
- Panel is an **in-flow flex sibling that shrinks the `useContainerWidth` grid container** → `ResponsiveGridLayout` auto-reflows. NEVER a `position:fixed` overlay on wide screens (would hide widgets without reflow).
- **Auto-collapse below a width breakpoint** so charts keep usable width on narrow viewports; when the user expands on a narrow viewport the panel **overlays** the charts (does not reflow) — reflow/push is wide-screen behavior only.

### Grouping & group headers
- **Group by source**, matching the top bar's sectioning: one section per table, then dynamic views, then spatial draws.
- **Group order is stable: tables → dynamic views → spatial** (predictable; positions don't jump as filters change).
- **Groups are collapsible** — each has a header showing the source name + a per-group clear control + a collapse/expand toggle. (Per-group clear = FPANEL-V120-04, reusing existing store actions.)

### Chip anatomy & provenance
- Each chip: the filter value/clause (via existing `buildChipText`) + a remove ✕ (FPANEL-V120-03).
- **Provenance shows as a muted subtitle line beneath the value** ("from <source widget>"), always visible (FPANEL-V120-08). Resolve the source-widget display name from `sourceWidgetId`; when unknown/absent, omit the subtitle gracefully.
- **Long values truncate with an ellipsis + full value on hover** (title/tooltip) to keep chips tidy.
- Spatial and datetime-between chips use the SAME shared chip (buildChipText already handles their text); provenance subtitle applies where a source is known.

### Shared FilterChip (FPANEL-V120-09)
- Extract ONE `FilterChip` component used by BOTH the new panel AND the existing top bar. In the TOP BAR it must render byte-identically to today's `.filter-bar-chip` (no visual/behavior regression) — the top bar keeps its current horizontal look; the panel arranges the same chips vertically with the provenance subtitle. Provenance subtitle may be a prop that the top bar leaves off (or shows compactly) to preserve current top-bar appearance — planner decides, but top-bar parity is a hard requirement.

### XOR mode switch (FPANEL-V120-01)
- `DashboardsPage` reads `dashboard.filter_display_mode` (from the Phase 106 DTO) and renders the top bar XOR the panel — never both. Absent/`topbar` → existing top bar, byte-identical (backward-compat).

### Empty state (FPANEL-V120-06)
- When mode=`panel` and there are no active filters, the (expanded) panel shows a friendly empty state (copy = Claude's discretion; short + on-brand). The collapsed rail shows a 0/empty badge state.

### Claude's Discretion
- Exact panel width value + breakpoint threshold + empty-state copy + count-badge exact styling.
- Whether the shared FilterChip takes a `variant`/`showProvenance` prop vs composition — as long as top-bar parity holds and the panel shows the subtitle.
- Rail iconography / handle affordance.

### Test / gate notes
- FRONTEND-ONLY. Gates: web `tsc` clean; web vitest 100%; theme-guard green (theme tokens only — NO invented CSS class names: any new panel/rail/chip class MUST exist in global.css before use, since undefined classes pass all gates but render unstyled). VERIFY VISUALLY in BOTH light + dark themes and at a narrow viewport (automated gates cannot catch the CSS-class trap or reflow).
- Backward-compat: a `topbar`/unset dashboard is byte-identical — lock with a test that the panel does NOT render in topbar mode and the top bar is unchanged.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing filter-bar UI to mirror / refactor into the shared chip
- `packages/web/src/components/DashboardsPage.tsx` (~lines 940–1090) — the current top filter bar: `.filter-bar` → per-source `.filter-bar-item` (`.filter-bar-table`, `.filter-bar-chips`, `.filter-bar-chip` + `.filter-bar-chip-dismiss`, `.filter-bar-clear`) for tables, dv, and spatial; the store actions (`removeFilter`/`clearFilters`/`removeDvFilter`/`clearDvFilters`/`removeShape`). Also `useContainerWidth`/`containerRef`/`ResponsiveGridLayout` wiring (~line 487, 70).
- `packages/web/src/styles/global.css` — the `.filter-bar-*` classes (reuse/extend) AND the `.sidebar` collapse pattern (width transition + token) the panel rail mirrors. New classes go here BEFORE use.
- `packages/web/src/lib/columnTypes.ts` — `buildChipText` (chip label text for column/spatial/datetime filters).

### Data + persisted mode
- `packages/web/src/api/client.ts` — `DashboardDto.filter_display_mode` (added Phase 106) — the XOR switch reads this.
- `packages/web/src/store/filterStore.ts` + `spatialFilterStore.ts` — active-filter source of truth (`ActiveFilter.sourceWidgetId` powers provenance).

### v1.20 research
- `.planning/research/SUMMARY.md`, `.planning/research/ARCHITECTURE.md` — reflow (flex-sibling not overlay), shared-chip drift insurance, group-by-source.
- `.planning/research/PITFALLS.md` — source-of-truth drift, silent-CSS-class trap + theme-guard blind spots, backward-compat, top-bar XOR panel.

### Prior phase context
- `.planning/phases/106-display-mode-persistence/106-CONTEXT.md` — the persisted mode this phase consumes.

### Gates / conventions
- `CLAUDE.md` — UI conventions (reuse classes, no invented classNames, theme tokens only) + test gates.
- `.planning/codebase/CONVENTIONS.md`.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The entire `.filter-bar-*` class family + the per-source chip rendering in DashboardsPage — extract into a shared `FilterChip` (and likely a small group/section structure) reused by top bar + panel.
- The `.sidebar` collapse pattern (CSS width transition + boolean state + token) — model the panel rail on it.
- `useContainerWidth()` (ResizeObserver on `containerRef`) already drives grid reflow — the panel just needs to be a sibling that shrinks that measured element.
- `buildChipText` for chip labels; existing store remove/clear actions for chip/group controls.

### Established Patterns
- zustand scoped-selector reads (PITFALL S-02): subscribe to versions/primitives, read arrays via getState in useMemo (the top bar already does this).
- Theme-tokens-only styling; theme-guard only flags raw #hex (misses rgba()/wrong tokens) — verify visually.

### Integration Points
- `DashboardsPage` layout: top bar XOR panel (reads `filter_display_mode`); panel as flex sibling of the grid container. Consumed next by Phase 108 (applies-to + highlight render into these chips/cards) and Phase 109 (global clear-all button in the panel header).
</code_context>

<specifics>
## Specific Ideas

- Collapsed = thin right rail with a count badge + expand handle (not fully hidden).
- Chip shape endorsed:
  ```
  ┌─────────────────┐
  │ region = West  ✕ │
  │ from: Sales map  │   ← muted provenance subtitle
  └─────────────────┘
  ```
- Long values: `device = SAMSUNG-GAL… ✕` with full value on hover.
- Wide: `[ charts ][ panel ]`; narrow: charts + auto-collapsed rail (expand = overlay).
</specifics>

<deferred>
## Deferred Ideas

None new from this discussion. Already deferred to v2 in REQUIREMENTS.md: in-panel filter search/quick-find (FPANEL-V2-01), pinned/floating or viewer-level layout override (FPANEL-V2-02), resizable drag-width panel (FPANEL-V2-03). The GLOBAL clear-all is Phase 109; applies-to list + highlight is Phase 108 — both in-milestone, just later phases.
</deferred>

---

*Phase: 107-panel-shell-reflow-xor-switch-chips*
*Context gathered: 2026-07-09*
