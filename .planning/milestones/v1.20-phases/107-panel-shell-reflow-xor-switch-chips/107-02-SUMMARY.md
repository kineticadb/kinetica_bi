---
phase: 107-panel-shell-reflow-xor-switch-chips
plan: 02
subsystem: ui
tags: [react, react-grid-layout, filter-panel, css-tokens, localstorage, matchmedia]

# Dependency graph
requires:
  - phase: 107-01
    provides: "Shared FilterChip (topbar/panel variants) + resolveProvenance helper + pre-added .filter-panel-chip* CSS"
  - phase: 106-display-mode-persistence
    provides: "dashboard.filter_display_mode DTO field ('topbar' | 'panel', default 'topbar')"
provides:
  - "Collapsible right-side FilterPanel (expanded drawer) + FilterPanelRail (collapsed thin rail with count badge)"
  - "isPanelMode XOR switch in DashboardsPage — panel renders INSTEAD of the top bar, never both; topbar/unset stays byte-identical"
  - "In-flow flex-sibling reflow (.filter-panel-layout / .filter-panel-grid-wrap) so react-grid-layout's useContainerWidth ResizeObserver auto-shrinks the grid"
  - "Per-dashboard collapse persistence via localStorage (kbi_filterPanelCollapsed_{id}), with a matchMedia(max-width:900px) narrow-viewport default and stored-pref-wins precedence"
  - "Source-grouped chips (stable order tables -> dynamic views -> spatial) with per-chip remove, per-group Clear all, provenance subtitles, and an empty state"
  - "Grid-cascade regression fix: breakpoint=\"lg\" pinned in panel mode only, stopping react-grid-layout's auto-generated stacked fallback (and the onLayoutChange persistence corruption path) when the flex-narrowed grid drops below RGL's sm/lg breakpoints"
affects: [108-applies-to-highlight, 109-global-clear-all, 110-designer-settings-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isPanelMode ternary is the ONLY new top-level conditional in DashboardOpen — topbar path stays textually/byte identical (gridBlock className is `undefined` in topbar mode, `.filter-panel-grid-wrap` only in panel mode)"
    - "localStorage collapse-state pattern mirrors App.tsx (try/catch read on init, try/catch write in useEffect), scoped per-dashboard-id key, with an explicit precedence rule: a stored value always wins over the matchMedia narrow-viewport default"
    - "Panel components own NO store subscriptions — DashboardOpen computes 3 group collections (table/dv/spatial) + activeFilterCount from its EXISTING input-store subscriptions and passes them down as props (source of truth stays useFilterStore/useSpatialFilterStore, never filterCombinationStore)"
    - "react-grid-layout breakpoint pinning: when a grid lives inside a width-shrinking flex sibling (not the full viewport), pin `breakpoint` to the one layout key that's actually populated (\"lg\") rather than letting RGL's internal width-based breakpoint detection pick a layout key with no explicit `layouts[key]` entry (which triggers its auto-generated/compacted fallback)"

key-files:
  created:
    - packages/web/src/components/FilterPanel.tsx
    - packages/web/src/components/FilterPanel.spec.tsx
    - packages/web/src/components/FilterPanelRail.tsx
    - packages/web/src/components/DashboardsPage.panel.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/styles/global.css

key-decisions:
  - "Checkpoint-found bug (Task 4 visual verification): the widget grid cascaded into a diagonal staircase in panel mode. Root cause — ResponsiveGridLayout only had an explicit `lg` layout; once the flex-narrowed .filter-panel-grid-wrap dropped the measured width below RGL's sm/lg breakpoint thresholds, RGL silently switched to an auto-generated, vertically-compacted fallback layout, and a subsequent onLayoutChange could persist that fallback into each widget's stored config.layout (a real corruption path, not just a visual glitch). Fixed by pinning `breakpoint=\"lg\"` in panel mode ONLY (topbar/unset passes `undefined`, preserving pre-fix behavior exactly); added a regression test asserting three widgets at x=0/6/12 stay in three distinct columns at a narrow panel-mode grid width (fails without the fix). Verified dashboard 10's already-stored layout was NOT corrupted before the fix landed."
  - "Panel-mode grid reflow is achieved via an in-flow flex sibling (.filter-panel-layout wrapping gridBlock + FilterPanel/Rail), never a position:fixed overlay on wide screens — the existing useContainerWidth ResizeObserver on the grid's containerRef does the reflow automatically once its container shrinks; the panel only becomes a position:fixed overlay in the narrow-viewport (<900px) media query, by design (UI-SPEC)."
  - "Group props (tableGroups/dvGroups/spatialGroup) are assembled directly in DashboardOpen from the existing allStoreFilters/allDvFilters/shapes/targetsByTable subscriptions as 3 fresh collections — NOT by lifting/refactoring the pre-existing top-bar grouping IIFE — to keep the topbar code path completely untouched (byte-identical parity proof via the unmodified DashboardsPage.spec.tsx)."

patterns-established:
  - "Pattern: XOR surface switch via a single top-level ternary + an unchanged, gated legacy branch, proven byte-identical by running the OLD spec unmodified — mirrors the 107-01 FilterChip variant-extraction pattern one level up (whole-surface swap instead of one component's variant prop)."
  - "Pattern: breakpoint-pin a react-grid-layout instance to its only defined layout key when it lives inside a shrinking flex container, to avoid RGL's implicit multi-breakpoint fallback/compaction from ever engaging (and from being persisted by onLayoutChange)."

requirements-completed: [FPANEL-V120-01, FPANEL-V120-02, FPANEL-V120-03, FPANEL-V120-04, FPANEL-V120-05, FPANEL-V120-06, FPANEL-V120-07, FPANEL-V120-08]

# Metrics
duration: ~7h (includes checkpoint pause + in-session bug fix)
completed: 2026-07-09
---

# Phase 107 Plan 02: Panel Shell + Rail + Reflow + XOR Switch + Source Groups Summary

**Collapsible right-side FilterPanel (grouped chips, per-group clear, provenance, empty state) XOR-switched against the top bar by `filter_display_mode`, reflowing the widget grid as an in-flow flex sibling with localStorage/matchMedia collapse persistence — plus an operator-caught grid-cascade bug (RGL auto-fallback below its lg breakpoint) fixed by pinning `breakpoint="lg"` in panel mode.**

## Performance

- **Duration:** ~7h (execution + blocking checkpoint pause for operator visual verification + in-session bug fix)
- **Completed:** 2026-07-09
- **Tasks:** 4/4 completed (3 auto + 1 human-verify checkpoint, approved)
- **Files modified:** 6 (4 created, 2 modified) across 4 commits

## Accomplishments
- `FilterPanel.tsx` — expanded drawer rendering source-grouped chips in the stable order tables -> dynamic views -> spatial, each group with a title, per-group "Clear all", a local collapse toggle (chevron, conditional unmount not `display:none`), and per-chip provenance ("from {widget}") via the shared `FilterChip`/`resolveProvenance` from 107-01; renders the empty state ("No active filters") when the active-filter count is zero; header collapse button is the ONLY control in `.filter-panel-header-actions` (global clear-all slot deliberately empty for Phase 109).
- `FilterPanelRail.tsx` — the collapsed thin rail: an expand button + a count badge (`.filter-panel-rail-badge`, `--empty` variant showing "0").
- `global.css` — added `--filter-panel-width` / `--filter-panel-rail-width` tokens and every `.filter-panel-*` shell/group/rail ruleset + the 900px overlay media query, copied verbatim from the UI-SPEC (tokens/`color-mix` only, zero raw hex/`rgba`).
- `DashboardsPage.tsx` — `isPanelMode` is the sole new top-level conditional; the pre-existing top-bar IIFE is gated behind `!isPanelMode` completely unchanged; the grid block is extracted with a className that's `undefined` in topbar mode (byte-identical) and `.filter-panel-grid-wrap` only in panel mode; panel mode wraps grid + FilterPanel/Rail in `.filter-panel-layout` (flex sibling reflow); collapse state persists per-dashboard via `localStorage` key `kbi_filterPanelCollapsed_{id}` with a `matchMedia("(max-width: 900px)")` narrow default that a stored preference always overrides; `activeFilterCount` and the 3 group-prop collections (table/dv/spatial, spatial hidden when no eligible target) are built fresh from the existing input-store subscriptions, reusing `removeFilter`/`clearFilters`/`removeDvFilter`/`clearDvFilters`/`removeShape` verbatim.
- `DashboardsPage.panel.spec.tsx` — new file covering XOR render (never both surfaces), topbar backward-compat, chip coverage, remove/clear store-mutation parity, empty state, rail count badge, collapse persistence round-trip (dashboard-scoped key), matchMedia narrow default with stored-pref-wins precedence, and stable group order; plus a class-presence assertion locking every `.filter-panel-*` class against `global.css`.
- **Checkpoint-found + fixed:** the Task 4 human-verify walk-through (wide viewport, several active filters) surfaced a widget-grid cascade (staircase layout) in panel mode. Root cause: `ResponsiveGridLayout` had only an `lg` layout defined; once the panel narrowed the grid below RGL's `sm`(768)/`lg`(1200) breakpoint widths, RGL silently substituted its own auto-generated, vertically-compacted fallback layout — and a subsequent `onLayoutChange` could persist that fallback into each widget's stored `config.layout`, a real corruption risk beyond the visual bug. Fixed by pinning `breakpoint="lg"` in panel mode ONLY (`undefined` in topbar/unset mode, preserving exact pre-fix behavior); added a regression test (three widgets at x=0/6/12 must stay in three distinct columns at a narrow panel-mode grid width); confirmed dashboard 10's already-persisted layout was NOT corrupted.

## Task Commits

1. **Task 1: Add panel CSS + build FilterPanel + FilterPanelRail components** - `597cc0f` (feat)
2. **Task 2: Wire XOR switch + reflow + collapse persistence into DashboardsPage** - `64e4a91` (feat)
3. **Task 3: Panel behavior specs (XOR, backward-compat, persistence, matchMedia, badge)** - `b39e3c6` (test)
4. **Task 4: Visual verification checkpoint** - approved by operator ("looks good") after the in-session reflow-cascade fix below
   - **Checkpoint fix: pin panel-mode grid to lg breakpoint to stop layout cascade** - `6c6eb3e` (fix)

**Plan metadata:** (this commit, docs)

_Task 4 was a blocking `checkpoint:human-verify` gate — the operator's live visual walk-through (light/dark theme, wide/narrow viewport) caught the grid-cascade bug, which was fixed and regression-tested in the same session before approval._

## Files Created/Modified
- `packages/web/src/components/FilterPanel.tsx` - Expanded panel drawer: grouped chips (stable order), per-group clear, collapse toggle, provenance, empty state, header collapse button.
- `packages/web/src/components/FilterPanel.spec.tsx` - Behavior specs: grouping order, chip coverage (eq/in + datetime-between + spatial), per-chip remove, per-group clear, provenance, empty state, group collapse, spatial-orphan hide.
- `packages/web/src/components/FilterPanelRail.tsx` - Collapsed thin rail: expand button + active-filter count badge (filled/empty variants).
- `packages/web/src/components/DashboardsPage.panel.spec.tsx` - New spec file: XOR render, topbar backward-compat, chip/remove/clear parity, empty state, count badge, collapse persistence + matchMedia precedence, group order, class-presence lock; plus the checkpoint-added grid-cascade regression test.
- `packages/web/src/components/DashboardsPage.tsx` - `isPanelMode` XOR branch; extracted `gridBlock` with conditional `.filter-panel-grid-wrap` className; `.filter-panel-layout` flex-sibling wrapper; localStorage + matchMedia collapse-state hook; `activeFilterCount` + 3-collection group-prop assembly; **checkpoint fix:** `breakpoint="lg"` pinned in panel mode only.
- `packages/web/src/styles/global.css` - Added `--filter-panel-width`/`--filter-panel-rail-width` tokens and every `.filter-panel-*` shell/group/rail ruleset + the 900px overlay media query (tokens/`color-mix` only).

## Decisions Made
- Group props are assembled as 3 fresh collections directly in `DashboardOpen` from the existing input-store subscriptions rather than refactoring the pre-existing top-bar grouping IIFE — keeps the topbar path completely untouched, so its parity proof (unmodified `DashboardsPage.spec.tsx` staying green) remains valid.
- Grid reflow is achieved purely via the flex-sibling layout (`.filter-panel-layout`/`.filter-panel-grid-wrap`) shrinking the grid's measured container width, which `useContainerWidth`'s ResizeObserver already reacts to — no new reflow mechanism was needed, only the breakpoint-pin fix once the narrowed width crossed RGL's own breakpoint thresholds.
- Collapse-state precedence: an existing `localStorage` value always wins over the `matchMedia` narrow-viewport default (Open Question #2 from the plan), so a user's explicit choice on a narrow screen isn't silently overridden on the next narrow-viewport load.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, caught at the Task 4 checkpoint] Widget grid cascaded (staircase) in panel mode**
- **Found during:** Task 4 (blocking human-verify checkpoint — operator's wide-viewport visual walk-through)
- **Issue:** `ResponsiveGridLayout` only had an `lg` layout defined; once the panel narrowed the grid's measured width below RGL's `sm`/`lg` breakpoint thresholds, RGL silently substituted its own auto-generated, vertically-compacted fallback layout, producing a visible diagonal-staircase cascade. Because `onLayoutChange` was still wired to persist layout changes, a subsequent width change (collapse/expand, resize) could have persisted that fallback into each widget's stored `config.layout` — a genuine data-corruption risk, not just a cosmetic bug.
- **Fix:** Pinned `breakpoint="lg"` on the `ResponsiveGridLayout` instance in panel mode ONLY (topbar/unset mode passes `undefined`, preserving exact pre-fix behavior — verified byte-identical). This forces RGL to always resolve to the one explicitly-defined `lg` layout regardless of measured width, so the multi-column arrangement is preserved (scaled down) and no auto-fallback/compaction ever engages.
- **Files modified:** `packages/web/src/components/DashboardsPage.tsx`, `packages/web/src/components/DashboardsPage.panel.spec.tsx`
- **Verification:** Added a regression test asserting three widgets seeded at x=0/6/12 remain in three distinct columns at a narrow panel-mode grid width (fails without the fix, passes with it); confirmed dashboard 10's already-persisted stored layout was NOT corrupted by the pre-fix bug; full web suite (3284 tests) + `tsc --noEmit` + theme-guard all green after the fix; operator re-verified visually and approved.
- **Committed in:** `6c6eb3e` (fix, part of the Task 4 checkpoint resolution, prior to plan finalization)

---

**Total deviations:** 1 auto-fixed (1 bug, caught during the blocking visual checkpoint rather than an automated gate — exactly the class of bug automated gates cannot catch, per project memory `css-bugs-evade-tests-and-theme-guard`).
**Impact on plan:** Necessary correctness fix for panel-mode grid reflow; scoped entirely to the panel-mode code path (topbar/unset byte-identical); no scope creep.

## Issues Encountered
- The grid-cascade bug above was found only through live visual verification, not any automated gate (tsc/vitest/theme-guard all stayed green throughout) — consistent with the project's known "CSS bugs evade tests + theme-guard" pattern, here manifesting as a layout-engine (react-grid-layout) breakpoint interaction rather than a CSS-class issue, but caught by the same discipline (mandatory human visual checkpoint before phase completion).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FPANEL-V120-01 through 08 are delivered and requirement-complete at the panel side (FPANEL-V120-09, the shared-component extraction, was completed in 107-01; FPANEL-V120-03/08 partials from 107-01 are now fully complete with their in-panel rendering here). This plan does NOT claim FPANEL-V120-09 or any 107-01-owned requirement beyond what 107-02 itself finishes.
- Phase 108 (Applies-To List + On-Canvas Highlight) can build directly on the now-complete panel shell + source groups.
- Phase 109 (Global Clear-All) can build on the panel's per-group `onClearAll` pattern and the empty `.filter-panel-header-actions` slot reserved for it.
- Phase 110 (Designer Settings UI + Verification) inherits a panel that has already passed one full light/dark + wide/narrow operator visual walk-through (this plan's Task 4) — reduces re-verification risk at the final milestone gate.
- No blockers. Both plans of Phase 107 (107-01, 107-02) are now complete; the phase itself still requires the orchestrator's phase-complete/verification step before being marked done in ROADMAP/STATE.

---
*Phase: 107-panel-shell-reflow-xor-switch-chips*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created files verified present on disk (FilterPanel.tsx, FilterPanel.spec.tsx, FilterPanelRail.tsx, DashboardsPage.panel.spec.tsx, this SUMMARY.md); all 4 task commits (597cc0f, 64e4a91, b39e3c6, 6c6eb3e) verified present in git log.
