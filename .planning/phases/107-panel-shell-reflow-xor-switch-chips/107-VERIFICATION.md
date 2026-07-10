---
phase: 107-panel-shell-reflow-xor-switch-chips
verified: 2026-07-09T21:40:00Z
status: passed
score: 8/8 must-haves verified (both plans)
human_verification:
  - test: "Light/dark theme + wide/narrow viewport visual walkthrough of the panel shell, rail, chips, provenance, reflow, and narrow-viewport overlay"
    expected: "Panel/rail render correctly styled (accent tint, readable text, no washed-out background) in both themes; grid reflows on wide screens; panel auto-collapses and overlays on narrow screens; top bar unchanged in topbar mode"
    why_human: "CSS-class-trap and reflow/theming correctness cannot be caught by tsc/vitest/theme-guard (per project memory css-bugs-evade-tests-and-theme-guard)"
    status: "ALREADY PERFORMED — operator completed this exact walkthrough at the Plan 107-02 Task 4 blocking checkpoint, found and the team fixed a real grid-cascade bug (breakpoint pinning, commit 6c6eb3e), then approved. Not re-run in this verification pass; recorded here per orchestrator instruction."
---

# Phase 107: Panel Shell + Reflow + XOR Switch + Chips Verification Report

**Phase Goal:** When a dashboard's mode is "panel", its active filters render in a collapsible right-side drawer (never alongside the top bar) as chips — with per-chip remove, per-group clear, grouping by source, provenance, an empty state, a collapsed count badge — all via a single shared FilterChip (top-bar parity), with the grid auto-reflowing.
**Verified:** 2026-07-09T21:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Top bar renders chips byte-identically to pre-Phase-107 | VERIFIED | `DashboardsPage.spec.tsx` untouched since a pre-Phase-107 commit (last touch `bd966df`/`c85b1da`, no Phase 107 commit modifies it); ran green (part of full 3284-test suite) |
| 2 | Single shared `FilterChip` used by both top bar (3 sites) and panel | VERIFIED | `FilterChip.tsx` exports one component with `variant: "topbar"\|"panel"`; `DashboardsPage.tsx` imports it and renders `variant="topbar"` at exactly 3 call sites (col/spatial/dv, lines 1249/1259/1324); `FilterPanel.tsx` renders `variant="panel"` per chip (line 68-76) |
| 3 | Panel renders grouped chips (tables→dv→spatial), per-chip remove, per-group clear, provenance, empty state | VERIFIED | `FilterPanel.tsx` renders `tableGroups`→`dvGroups`→`spatialGroup` in that literal render order (lines 108-114); each chip has `onRemove` wired to real store actions; each group has a `.filter-bar-clear` "Clear all" wired to `onClearAll`; provenance via `resolveProvenance(f.sourceWidgetId, widgets)`; `count===0` renders `.filter-panel-empty` |
| 4 | Collapsed rail shows count badge, persists via localStorage | VERIFIED | `FilterPanelRail.tsx` renders `.filter-panel-rail-badge`/`--empty`; `DashboardsPage.tsx` collapse state keyed `kbi_filterPanelCollapsed_${dashboard.id}`, read on init (stored value wins), written in a `useEffect` |
| 5 | XOR switch: panel mode → drawer only, topbar/unset → top bar only, never both | VERIFIED | `const isPanelMode = dashboard.filter_display_mode === "panel"`; top-bar IIFE gated `{!isPanelMode && (...)}`; panel block gated by `{isPanelMode ? (...) : gridBlock}` — mutually exclusive by construction |
| 6 | Grid auto-reflows as an in-flow flex sibling (not overlay) on wide screens | VERIFIED | `.filter-panel-layout` (flex row) wraps `gridBlock` + panel/rail; `containerRef` div gets `.filter-panel-grid-wrap` (`flex:1 1 auto`) only in panel mode, `undefined` className in topbar mode; `useContainerWidth`'s existing ResizeObserver reacts automatically |
| 7 | Grid-cascade regression fix present (breakpoint pin) | VERIFIED | `breakpoint={(isPanelMode ? "lg" : undefined) as ...}` present on `ResponsiveGridLayout` (line 1079); regression test in `DashboardsPage.panel.spec.tsx` asserts 3 widgets at x=0/6/12 stay in 3 distinct columns at a narrow panel-mode width |
| 8 | Non-scope items excluded (no applies-to/highlight, no global clear-all, no designer toggle, no resolveWidgetsForFilter import) | VERIFIED | grep confirms no `resolveWidgetsForFilter` import, no `filterCombinationStore` use in the panel path, `.filter-panel-header-actions` contains only the collapse button, `dashboard.filter_display_mode` is only READ (never assigned) |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/components/FilterChip.tsx` | Shared chip, topbar+panel variants | VERIFIED | Exports `FilterChip`; topbar branch is a verbatim `.filter-bar-chip` copy; panel branch renders `.filter-panel-chip` shell + optional provenance |
| `packages/web/src/lib/resolveProvenance.ts` | Pure 1-hop resolver | VERIFIED | `resolveProvenance(sourceWidgetId, widgets)` returns `"from {title}"` or `undefined`; no reverse-map, no Phase 108 import |
| `packages/web/src/components/FilterPanel.tsx` | Expanded drawer | VERIFIED (86 lines) | Groups, per-group clear, per-group collapse (unmount), empty state, provenance via `FilterChip variant="panel"`; owns no store subscription |
| `packages/web/src/components/FilterPanelRail.tsx` | Collapsed rail | VERIFIED (37 lines) | Expand button + count badge (filled/empty variant) |
| `packages/web/src/components/DashboardsPage.tsx` | `isPanelMode` XOR branch, gridBlock wrap, localStorage/matchMedia, activeFilterCount | VERIFIED | All present exactly per plan (see Truths 5-8 evidence) |
| `packages/web/src/styles/global.css` | Panel/rail/group/layout classes + tokens + 900px overlay | VERIFIED | `--filter-panel-width`, `--filter-panel-rail-width`, all `.filter-panel-*` rules + `@media (max-width: 900px)` overlay block present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `DashboardsPage.tsx` | `FilterChip.tsx` | `variant="topbar"` at 3 sites | WIRED | `grep -c "variant=\"topbar\""` = 3 |
| `DashboardsPage.tsx` | `FilterPanel.tsx` / `FilterPanelRail.tsx` | `isPanelMode ? (panelCollapsed ? <Rail/> : <Panel/>)` | WIRED | Lines 1353-1368 exact ternary |
| `FilterPanel.tsx` | `FilterChip.tsx` | `variant="panel" provenance={...}` | WIRED | Line 68-76 |
| `DashboardsPage.tsx` | `localStorage` | `kbi_filterPanelCollapsed_${dashboard.id}` read/write | WIRED | Read in `useState` init (try/catch), written in `useEffect` (try/catch) |
| `FilterPanel.tsx`/`FilterPanelRail.tsx` | `global.css` `.filter-panel-*` | every referenced class exists | WIRED | Class-presence lock test in `DashboardsPage.panel.spec.tsx` passes; manual grep confirms all 19 classes present |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FPANEL-V120-01 | 107-02 | XOR panel/top bar | SATISFIED | `isPanelMode` gate; REQUIREMENTS.md marked Complete |
| FPANEL-V120-02 | 107-02 | chip coverage (eq/in/datetime/spatial) | SATISFIED | `buildChipText` reused uniformly + spatial text recipe; REQUIREMENTS.md Complete |
| FPANEL-V120-03 | 107-01+02 | per-chip remove | SATISFIED | `onRemove` wired to real store actions in both surfaces; REQUIREMENTS.md Complete |
| FPANEL-V120-04 | 107-02 | per-group clear | SATISFIED | `.filter-bar-clear` per group calling `onClearAll`; REQUIREMENTS.md Complete |
| FPANEL-V120-05 | 107-02 | collapse + count badge | SATISFIED | `FilterPanelRail` badge + localStorage persistence; REQUIREMENTS.md Complete |
| FPANEL-V120-06 | 107-02 | empty state | SATISFIED | `.filter-panel-empty` + `--empty` rail badge; REQUIREMENTS.md Complete |
| FPANEL-V120-07 | 107-02 | group by source, stable order | SATISFIED | tableGroups→dvGroups→spatialGroup render order; REQUIREMENTS.md Complete |
| FPANEL-V120-08 | 107-01+02 | provenance | SATISFIED | `resolveProvenance` + `.filter-panel-chip-provenance`, omitted gracefully; REQUIREMENTS.md Complete |
| FPANEL-V120-09 | 107-01 | shared FilterChip, top-bar parity | SATISFIED IN CODE / STALE IN REQUIREMENTS.md | Code fully satisfies this (see Truth #2); **however `.planning/REQUIREMENTS.md` line 26 still shows the checkbox unchecked and its status table (line 81) shows "Pending"** — a documentation-sync gap only. `.planning/STATE.md` (lines 70-78) already correctly lists FPANEL-V120-09 as Complete, and both plan SUMMARYs claim it complete. Recommend the phase-complete step update `.planning/REQUIREMENTS.md` to match. |

No orphaned requirements found — all 9 FPANEL-V120-0x IDs declared across the two plans match the phase's requirement set in ROADMAP/REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none found | — | grep for TODO/FIXME/XXX/HACK/PLACEHOLDER/"coming soon" across FilterChip.tsx, FilterPanel.tsx, FilterPanelRail.tsx, resolveProvenance.ts returned nothing |

### Human Verification Required

None outstanding. The one visual-verification item (light/dark theme + wide/narrow viewport walkthrough) was already performed by the operator at the Plan 107-02 Task 4 blocking `checkpoint:human-verify` gate — it surfaced a real grid-cascade bug (RGL breakpoint fallback), which was fixed in-session (commit `6c6eb3e`, `breakpoint="lg"` pinned in panel mode only) and re-verified/approved before the plan was marked complete. Per orchestrator instruction, this is recorded as already-approved rather than re-run.

### Gaps Summary

No functional or code gaps found. All 8 derived observable truths verified against the actual codebase (not just SUMMARY claims): the shared `FilterChip` genuinely drives both surfaces, the panel's grouping/remove/clear/provenance/empty-state/collapse machinery is real and wired to the actual filter stores (not stubs), the XOR switch is a single clean ternary with the legacy top-bar branch textually untouched, and the documented grid-cascade regression fix (`breakpoint="lg"` pin) is present with a passing regression test. All automated gates are green: `tsc --noEmit` (0 errors), `vitest run` (146 files / 3284 tests passed — the 2 unhandled InfoPopup/columnDisplayConfig 401 rejections are the known pre-existing, non-failing noise), and `theme-guard.spec.ts` (144/144 green). No raw hex/rgba in any new `.filter-panel-*` CSS. No scope violations (no `resolveWidgetsForFilter` import, no global clear-all button, no designer mode-toggle write).

The only item worth flagging is a **documentation-sync gap, not a code gap**: `.planning/REQUIREMENTS.md`'s checkbox/status-table for FPANEL-V120-09 still reads unchecked/"Pending" even though the code, `.planning/STATE.md`, and both plan SUMMARYs all confirm it is complete. This should be reconciled during the phase-complete step but does not block phase sign-off since the underlying functionality is fully verified in the codebase.

---

*Verified: 2026-07-09T21:40:00Z*
*Verifier: Claude (gsd-verifier)*
