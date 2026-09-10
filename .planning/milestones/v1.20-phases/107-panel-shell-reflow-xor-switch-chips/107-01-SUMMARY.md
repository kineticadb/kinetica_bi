---
phase: 107-panel-shell-reflow-xor-switch-chips
plan: 01
subsystem: ui
tags: [react, filter-chip, css-tokens, refactor, top-bar-parity]

# Dependency graph
requires:
  - phase: 106-display-mode-persistence
    provides: "dashboard.filter_display_mode DTO field (not yet consumed here — this plan is pure chip extraction)"
provides:
  - "Shared FilterChip component (topbar + panel variants) exported from packages/web/src/components/FilterChip.tsx"
  - "resolveProvenance pure helper for 1-hop sourceWidgetId -> 'from {title}' resolution"
  - "Panel-variant chip CSS classes (.filter-panel-chip/-row/-value/-provenance) pre-added to global.css"
  - "Top-bar refactored to render all 3 chip call sites via <FilterChip variant='topbar'>, byte-identical to pre-Phase-107"
affects: [107-02-panel-shell, 108-applies-to-highlight]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared presentational component with a variant prop, reused across two structurally different layouts (topbar row vs panel column) — extraction verified via unmodified-spec parity proof rather than new assertions on old code"
    - "Provenance/reverse-lookup kept as a trivial 1-hop pure function (resolveProvenance), explicitly NOT a reverse-map — avoids importing Phase 108's not-yet-built resolveWidgetsForFilter"

key-files:
  created:
    - packages/web/src/components/FilterChip.tsx
    - packages/web/src/components/FilterChip.spec.tsx
    - packages/web/src/lib/resolveProvenance.ts
    - packages/web/src/lib/resolveProvenance.spec.ts
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/styles/global.css

key-decisions:
  - "FilterChip's topbar branch is a literal copy-paste of the pre-existing inline JSX (no wrapper element, no restructuring) to guarantee byte-identical DOM/flex behavior — verified by running the existing DashboardsPage.spec.tsx completely unmodified (188/188 green) rather than editing any assertion"
  - "Panel-variant CSS classes were added to global.css in this plan even though unreferenced by any panel component yet (Plan 107-02 will consume them) — a harmless, explicitly-sanctioned pre-add per the plan/UI-SPEC, since undefined-class risk only applies to classes referenced before definition, not the reverse"

patterns-established:
  - "Pattern: variant-prop chip extraction — verified via full-suite parity (run the OLD spec unmodified) instead of writing new assertions against refactored markup"

requirements-completed: [FPANEL-V120-09, FPANEL-V120-03, FPANEL-V120-08]

# Metrics
duration: ~20min
completed: 2026-07-09
---

# Phase 107 Plan 01: Shared FilterChip + Top-Bar Parity Refactor Summary

**Extracted a single `FilterChip` component (topbar + panel variants) plus a pure `resolveProvenance` helper, and refactored all 3 existing top-bar chip render sites in `DashboardsPage.tsx` to use it — with the pre-existing `DashboardsPage.spec.tsx` passing 100% unmodified as the byte-identical parity proof.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-09
- **Tasks:** 2/2 completed
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `FilterChip.tsx` exports one component with `variant: "topbar" | "panel"` — the topbar branch is a verbatim copy of the pre-existing `.filter-bar-chip` JSX subtree (zero markup drift); the panel branch renders the new `.filter-panel-chip` column shell with an optional muted provenance subtitle.
- `resolveProvenance(sourceWidgetId, widgets)` — pure, no-React helper that returns `"from {title}"` for a resolvable widget id and `undefined` otherwise (never `"from Unknown"`).
- All 3 top-bar chip call sites (column filters, spatial shapes, dynamic-view filters) in `DashboardsPage.tsx` now render `<FilterChip variant="topbar" .../>` instead of inline `<span className="filter-bar-chip">` JSX, preserving exact `key`/text/aria-label/remove-handler behavior per site.
- Added `.filter-panel-chip`, `.filter-panel-chip-row`, `.filter-panel-chip-value`, `.filter-panel-chip-provenance` to `global.css` (tokens/`color-mix` only, no raw hex/`rgba`) — ready for Plan 107-02's panel to consume; harmless while unreferenced.
- Regression proof: `DashboardsPage.spec.tsx` (188 tests) ran completely **unmodified** and stayed 100% green after the refactor — the concrete evidence that the top bar is byte-identical.

## Task Commits

1. **Task 1: Create shared FilterChip + resolveProvenance helper + panel-chip CSS** - `75fc2a7` (feat)
2. **Task 2: Refactor top-bar chip call sites to use FilterChip (top-bar parity)** - `1dbe4e7` (feat)

**Plan metadata:** (this commit, docs)

## Files Created/Modified
- `packages/web/src/components/FilterChip.tsx` - Shared chip component; topbar variant is a byte-identical copy of the old inline chip JSX, panel variant is the new column shell + optional provenance line.
- `packages/web/src/components/FilterChip.spec.tsx` - 5 tests: exact topbar className, dismiss-click behavior, topbar ignores provenance, panel renders value+provenance, panel omits provenance when absent.
- `packages/web/src/lib/resolveProvenance.ts` - Pure 1-hop `sourceWidgetId -> "from {title}"` resolver.
- `packages/web/src/lib/resolveProvenance.spec.ts` - 3 tests: resolves known id, undefined id passthrough, unresolved id.
- `packages/web/src/components/DashboardsPage.tsx` - Added `FilterChip` import; replaced the 3 inline `.filter-bar-chip` JSX sites (column, spatial, dv) with `<FilterChip variant="topbar" .../>` calls, reusing the exact same store-action `onRemove` handlers.
- `packages/web/src/styles/global.css` - Added 4 new panel-chip rulesets immediately after the existing `.filter-bar-*` block; zero existing `.filter-bar-*` rules touched.

## Decisions Made
- Kept the topbar branch as a literal copy-paste (no shared sub-render helper between variants) specifically to eliminate any risk of an incidental wrapper element changing flex-wrap behavior — matches the plan's explicit instruction and the research doc's stated regression risk.
- Left `faXmark`/`FontAwesomeIcon` imports in `DashboardsPage.tsx` untouched since they're still used elsewhere in the file (line ~1186, an unrelated icon usage) — confirmed via grep before touching imports.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `FilterChip` (both variants) and `resolveProvenance` are ready for Plan 107-02 to import directly — no further extraction work needed.
- The panel-variant CSS classes already exist in `global.css`, so Plan 107-02 can reference `.filter-panel-chip*` immediately without a CSS-class-trap risk.
- No blockers. Top-bar parity is proven and locked by the unmodified, 100%-green `DashboardsPage.spec.tsx`.

---
*Phase: 107-panel-shell-reflow-xor-switch-chips*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created files verified present on disk; both task commits (75fc2a7, 1dbe4e7) verified present in git log.
