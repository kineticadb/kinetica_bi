---
phase: 110-designer-settings-ui-verification-live-uat
plan: 01
subsystem: ui
tags: [react, zustand, filter-panel, dashboard-settings, rbac-reuse]

requires:
  - phase: 106-display-mode-persistence
    provides: "updateDashboard({ filter_display_mode }) API client + DashboardDto.filter_display_mode (always concrete on the wire)"
  - phase: 107-panel-shell-reflow-xor-switch-chips
    provides: "isPanelMode XOR switch (dashboard.filter_display_mode === 'panel') driving the top-bar vs .filter-panel-layout render branch"
provides:
  - "canEdit-gated 'Settings' toolbar button on the dashboard toolbar (btn-primary btn-sm, after Visualizations, before Back)"
  - "DashboardSettingsModal: a pure controlled two-segment toggle (Top bar | Right panel) reusing existing modal + radiogroup--buttons classes verbatim, save-on-change, in-flight disable, toast-on-failure"
  - "Live state-lift: DashboardOpen's optional onDashboardUpdated callback, wired from the parent's view.mode==='open' branch, flips isPanelMode with no reload/refetch"
affects: [110-02-verification-live-uat]

tech-stack:
  added: []
  patterns:
    - "Pure controlled toggle component with PATCH ownership left to the parent (mirrors DashboardSettingsModal / handleChangeDisplayMode split) for trivial testability"
    - "State-lift via optional onDashboardUpdated prop threaded into a child component, mirroring the existing DashboardEdit onSaved -> setDashboards map pattern"

key-files:
  created:
    - packages/web/src/components/DashboardSettingsModal.tsx
    - packages/web/src/components/DashboardSettingsModal.spec.tsx
  modified:
    - packages/web/src/components/DashboardsPage.tsx
    - packages/web/src/components/DashboardsPage.spec.tsx

key-decisions:
  - "DashboardSettingsModal owns zero API calls — it's a pure controlled toggle (mode/onModeChange/onClose); the parent (DashboardsPage's handleChangeDisplayMode) owns the updateDashboard PATCH + the state-lift, keeping the modal trivially testable in isolation."
  - "Zero new CSS classes: reused .modal-overlay/.modal-content/.modal-header/.modal-title/.modal-body (TablePickerModal chrome) and .radiogroup--buttons/.radiogroup-button/.radiogroup-button--selected (RadioGroupRenderer's existing segmented control) verbatim."
  - "No new RBAC permission — gated on the existing DASHBOARDS_EDIT (canEdit), matching every other toolbar button."

requirements-completed: [FSET-V120-01]

duration: 15min
completed: 2026-07-12
---

# Phase 110 Plan 01: Designer Settings UI Summary

**canEdit-gated dashboard "Settings" modal with a save-on-change Top-bar/Right-panel segmented toggle that PATCHes `filter_display_mode` and flips the panel/top-bar surface live with no reload, closing the final v1.20 feature requirement (FSET-V120-01).**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-12
- **Tasks:** 2/2 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `DashboardSettingsModal` — a pure controlled two-segment toggle (Top bar | Right panel) mirroring TablePickerModal chrome and reusing RadioGroupRenderer's `.radiogroup--buttons` segmented control verbatim; disables both segments while a change is in flight; toasts and stays open on a rejected `onModeChange`.
- `DashboardsPage` wiring: a `canEdit`-gated `Settings` toolbar button (placed after Visualizations, before Back); `handleChangeDisplayMode` PATCHes `updateDashboard(dashboard.id, { filter_display_mode })`; the parent's `view.mode === "open"` branch lifts the returned dashboard into both `view` and `dashboards` state (mirroring the existing `DashboardEdit` `onSaved` pattern), so `isPanelMode` recomputes and the top-bar/panel surface swaps live — no reload, no widget refetch (`useApiQuery` keys strictly off `dashboard.id`).
- Verified topbar/unset dashboards render byte-identically apart from the new gated button — all 48 pre-existing `DashboardsPage.spec.tsx` assertions stayed green throughout.

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1: Create DashboardSettingsModal with the filter-display-mode segmented toggle** - `8d978fd` (test, RED) + `b0c7dc7` (feat, GREEN)
2. **Task 2: Wire the canEdit-gated Settings button + modal + LIVE state-lift into DashboardsPage** - `7c2f733` (test, RED) + `9d23d2d` (feat, GREEN)

_TDD tasks: RED confirmed by temporarily removing/reverting the not-yet-committed implementation and re-running the new spec (verified failing for the exact expected reason — missing module import for Task 1, missing Settings button/wiring for Task 2) before restoring and confirming GREEN._

## Files Created/Modified
- `packages/web/src/components/DashboardSettingsModal.tsx` - New modal: modal chrome + `.ds-field`-wrapped `.radiogroup--buttons` toggle; save-on-change with in-flight disable + toast-on-failure.
- `packages/web/src/components/DashboardSettingsModal.spec.tsx` - 11 tests covering chrome, segment rendering/selection, no-op on already-selected, onClose (overlay + Close button), in-flight disabling, rejected-onModeChange toast + stays-open, no Save/Cancel footer.
- `packages/web/src/components/DashboardsPage.tsx` - Added `DashboardSettingsModal` import, `showSettingsModal` state, `handleChangeDisplayMode`, the gated toolbar button, modal render block, `DashboardOpen`'s optional `onDashboardUpdated` prop, and the parent open-branch lift (`setView` + `setDashboards` map).
- `packages/web/src/components/DashboardsPage.spec.tsx` - Added `updateDashboard` mock (echoes requested `filter_display_mode`) and a new Phase 110 describe block (5 tests): button ordering/visibility (designer vs analyst), modal open/close reflecting current mode, live PATCH + surface-swap with no listWidgets refetch, and other toolbar buttons remaining present.

## Decisions Made
- Kept the PATCH call and state-lift entirely in the parent (`DashboardsPage`/`handleChangeDisplayMode`), not the modal — matches the plan's explicit interface contract and keeps `DashboardSettingsModal` a pure, trivially-unit-testable controlled component.
- Used the exact existing `.radiogroup--buttons`/`.radiogroup-button`/`.radiogroup-button--selected` classes from `RadioGroupRenderer` rather than wrapping them in the `.radiogroup-options radiogroup--buttons` combo used there — confirmed via `global.css` that `.radiogroup--buttons` is a standalone selector (not compounded with `.radiogroup-options`), so this reuse is exact and introduces zero new CSS.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The initial "no reload/refetch" assertion used a fixed `listWidgets` call count (`toHaveBeenCalledTimes(1)`), which is fragile across the shared `vi.mock` used by the whole spec file (accumulates calls across `describe` blocks run in the same file). Fixed by capturing the call count immediately before the toggle and asserting it is unchanged after — verifies the same "no refetch" property without depending on cross-test call-count isolation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FSET-V120-01 is complete; the designer-facing toggle exists and live-flips the Phase 107 XOR switch with no new permission, no new CSS, and no server change (reusing the Phase 106 PATCH).
- Ready for 110-02 (VERIFY-V120-01): the final v1.20 milestone-verification + blocking live operator UAT walk-through, which will exercise this toggle live (including switching `Ookla Dash Vs2` off its manual DB-flip workaround).

---
*Phase: 110-designer-settings-ui-verification-live-uat*
*Completed: 2026-07-12*

## Self-Check: PASSED

All created files and commit hashes verified present on disk / in git log.
