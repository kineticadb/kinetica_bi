# Phase 110: Designer Settings UI + Verification + Live UAT - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Two concerns, closing milestone v1.20:
1. **FSET-V120-01** — a dashboard-edit-gated UI for the designer to choose a dashboard's filter display mode (top bar vs right panel), persisted via the Phase 106 `filter_display_mode` PATCH; the Phase 107 XOR switch consumes it live.
2. **VERIFY-V120-01** — milestone verification: green automated gates on BOTH stacks + the sole-materialize-trigger invariant, PLUS a BLOCKING live operator walk-through of the whole filter-panel feature (including light/dark + narrow-viewport visual checks automated gates can't catch), with any gaps fixed in-session and re-walked to PASS.

This is the FINAL v1.20 phase. No new feature capability beyond the toggle UI.
</domain>

<decisions>
## Implementation Decisions

### Toggle home — new dashboard "Settings" modal
- Add a `canEdit`-gated **"Settings"** button to the dashboard toolbar (`.dashboard-toolbar`, `btn-primary btn-sm` to match Tables/Dynamic Views/Map Layers/Visualizations) that opens a small **dashboard-settings modal** (mirror the existing modal pattern — TablePickerModal / LayersModal chrome). The filter-display-mode control is its FIRST occupant; this modal is the surface future per-dashboard settings (custom CSS, alternate layouts — deferred from Phase 106) will extend.
- Viewers without `DASHBOARDS_EDIT` do NOT see the Settings button (they just get the designer's chosen mode). No new permission.

### Control style + save
- A **two-option SEGMENTED toggle**: "Top bar" | "Right panel". Changing it **saves immediately** (PATCH `filter_display_mode` via the Phase 106 api-client `updateDashboard`) — no separate Save/Cancel footer.
- After the PATCH, update the in-memory dashboard's `filter_display_mode` so the Phase 107 XOR switch re-renders LIVE (no reload). Wire the updated dashboard back into DashboardsPage state (planner determines exact state-lift/refetch approach).
- Reuse an existing segmented/toggle style if one exists (e.g. a prior config toggle); otherwise add minimal `.` classes to global.css (tokens-only — no invented/unstyled classes; theme-guard-safe).

### Live UAT scope (VERIFY-V120-01) — blocking operator walk-through checklist
The plan must include a BLOCKING `checkpoint:human-verify` task with this operator checklist (all four groups selected):
1. **Full feature matrix:** FSET (open Settings → toggle Top bar↔Right panel → dashboard switches live; persists on reload; viewer without edit perm sees choice + NO Settings button) → FPANEL (panel on right; chips grouped table/dv/spatial, collapsible; remove a chip; per-group clear; collapse → rail + count badge; reload keeps collapse; empty state at zero) → FSCOPE ("applies to N" + expand list w/ layer names; hover → accent ring on affected widgets; click → scroll to topmost + flash all; expanded row → scroll+flash one) → FCLEAR ("Clear all filters" shows when filters active → clears all tables+dv+spatial; hidden at zero).
2. **Light + dark + narrow:** panel/rail/chips/ring/flash/badge/toggle readable in BOTH themes; narrow (<900px) auto-collapses to rail, expand overlays.
3. **Backward-compat sweep:** a topbar/unset dashboard is byte-identical (top bar unchanged, grid layout intact); switching a dashboard to panel and back behaves cleanly (no layout cascade — the 6c6eb3e fix).
4. **Multi-map + info popup:** re-confirm the earlier in-milestone fixes hold on a real multi-widget dashboard — multi-map info-popup scoping (activeWidgetId) + panel-mode grid reflow (no staircase).

### Milestone verification (VERIFY-V120-01) — automated
- BOTH stacks: web `tsc` clean + web vitest 100% (default PARALLEL — the global afterEach useRealTimers isolation guard must keep it green) + theme-guard green; server `tsc` clean + server vitest SET-BASED ⊆ TD-V16-TEST-ISOLATION (never a fixed pass-count; neutralize the dev-.env TTL leak when judging the set).
- Sole-materialize-trigger invariant grep across `packages/web/src/components/charts/` + the new panel/clear code stays clean.
- All v1.20 requirements (FSET/FPANEL/FSCOPE/FCLEAR + VERIFY) traceability = Complete.

### Claude's Discretion
- Exact settings-modal chrome/title, segmented-control markup + class names (reuse-or-add), the state-lift mechanism for live mode update.
- Empty/other future-settings placeholders in the modal (keep it to the one control this phase).

### Scope
- Panel/top-bar rendering behavior is DONE (Phases 107-109) — this phase only ADDS the toggle UI + runs verification/UAT. Deferred (not built): per-dashboard CSS, alternate layouts, top-bar global clear-all.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Toggle UI
- `packages/web/src/components/DashboardsPage.tsx` — the `dashboardHeader`/`.dashboard-toolbar` button row (~1098-1125, canEdit-gated `btn-primary btn-sm` buttons + modal open state pattern `showTableModal` etc.); how `dashboard` is in scope + `canEdit = hasPermission(PERMISSIONS.DASHBOARDS_EDIT)` (~94); `isPanelMode = dashboard.filter_display_mode === "panel"` (Phase 107) that must re-read after the PATCH.
- Existing modal components (e.g. `TablePickerModal`, `LayersModal`) — chrome/pattern to mirror for the new dashboard-settings modal.
- `packages/web/src/api/client.ts` — `updateDashboard` (accepts `filter_display_mode`, added Phase 106) + `DashboardDto.filter_display_mode`.
- `packages/web/src/store/auth.ts` + `PERMISSIONS.DASHBOARDS_EDIT`.
- `.planning/phases/106-display-mode-persistence/106-CONTEXT.md` — persistence contract (values 'topbar'|'panel', DTO coalesced).
- `CLAUDE.md` — UI conventions (canonical button/field classes; `ds-field`/`ds-select`; modal patterns; tokens-only; no invented classNames).

### Verification / UAT
- `.planning/REQUIREMENTS.md` — the full v1.20 requirement set to attest.
- `.planning/phases/107-.../107-CONTEXT.md` + `108-.../108-CONTEXT.md` + `109-.../109-CONTEXT.md` — the behaviors the UAT checklist exercises.
- `.planning/phases/103-verification-live-uat/103-VERIFICATION.md` + `103-GATES.md` — the prior milestone-verification format/gate framing to mirror (esp. server SET-BASED gate + dev-.env-leak neutralization).
- Memory: web-vitest parallel fake-timer isolation; map-wms separate read-path; adding-permission ripples (N/A — no new permission here).

### Prior in-milestone fixes to re-confirm in UAT
- Multi-map info-popup scoping (commit `9652182`), panel-mode grid reflow no-cascade (commit `6c6eb3e`).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Dashboard toolbar + modal-open-state pattern (Tables/Layers/etc.) — clone for the Settings button + dashboard-settings modal.
- Phase 106 `updateDashboard(id, { filter_display_mode })` api client + validated PATCH — the toggle just calls it.
- Phase 107 `isPanelMode` XOR switch already live-consumes `dashboard.filter_display_mode` — the toggle only needs to update that value in state.
- RolesPage `roles-btn-save`/settings patterns + `ds-field`/`ds-select` for form controls.

### Established Patterns
- Permission-gated toolbar buttons (`canEdit && <button>`).
- Modals mirror LayersModal/TablePickerModal chrome (backdrop, close, ESC).
- Tokens-only styling; theme-guard only catches raw #hex — verify visually.

### Integration Points
- New Settings button + modal in DashboardsPage; PATCH via api client; live state update flips the existing XOR switch. No new store, no new server work (Phase 106 already shipped persistence).
</code_context>

<specifics>
## Specific Ideas

- Toolbar + modal shape endorsed:
  ```
  [Tables][Dynamic Views][Map Layers][Visualizations][Settings][Back]
                                                        └→ modal:
     Filter display:  [ Top bar | █Right panel█ ]   (applies instantly)
  ```
- The in-app toggle replaces the manual DB flip on `Ookla Dash Vs2` — the operator will use it during UAT (and can set it back to top bar).
</specifics>

<deferred>
## Deferred Ideas

- Per-dashboard custom CSS + alternate layouts — future dashboard-settings-modal occupants (from Phase 106 discussion); NOT this phase.
- Top-bar global clear-all — deferred from Phase 109.
- A confirm/undo on the toggle — not needed (mode is trivially reversible).
</deferred>

---

*Phase: 110-designer-settings-ui-verification-live-uat*
*Context gathered: 2026-07-10*
