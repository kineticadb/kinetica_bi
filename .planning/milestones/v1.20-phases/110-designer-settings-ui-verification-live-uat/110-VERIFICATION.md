# 110-VERIFICATION.md — v1.20 Filter Panel: Milestone Verification

**Date:** 2026-08-27
**Phase:** 110-designer-settings-ui-verification-live-uat, Plan 02, Task 3
**Requirement closed:** VERIFY-V120-01
**Evidence:** `110-GATES.md` (automated, re-run 2026-08-27) + `110-UAT.md` (operator walk-through, 8/8 PASS)

---

## SC1 — Designer can pick the filter display mode; non-permitted users cannot; NO new permission

**ATTESTED PASS.**

- `DashboardSettingsModal` ships a two-segment Top bar / Right panel toggle, save-on-change, in-flight disable, toast-on-failure (`110-01-SUMMARY.md`). The modal owns zero API calls — the parent (`DashboardsPage.handleChangeDisplayMode`) owns the `updateDashboard` PATCH plus the live state-lift.
- Gated on the EXISTING `DASHBOARDS_EDIT` (`canEdit`), matching every other toolbar button. **No new RBAC permission was introduced** — the permission catalog is byte-unchanged, so no `rbacDb` / `rbacMigration` / web-permissions / `RolesPage` spec count moved (the permission-ripple this invariant exists to prevent).
- Operator confirmed live (UAT group 1): the toggle flips the surface with no reload, the choice survives a reload, and a user without `dashboards:edit` sees the designer's chosen mode and **no Settings button**.
- Zero new CSS classes: reuses `TablePickerModal` chrome (`.modal-overlay` / `.modal-content` / `.modal-header` / `.modal-title` / `.modal-body`) and `RadioGroupRenderer`'s `.radiogroup--buttons` / `.radiogroup-button` / `.radiogroup-button--selected`.

## SC2 — Automated gates green on both stacks

**ATTESTED PASS.** Full evidence in `110-GATES.md` (re-run 2026-08-27 after commits `1061417` and `46b1300`).

| Gate | Command | Verdict |
|---|---|---|
| Web tsc | `cd packages/web && npx tsc --noEmit` | PASS (clean exit) |
| Web vitest | `cd packages/web && npx vitest run` | PASS — 154 files / 3439 tests, **0 failed** |
| Web theme-guard | `npx vitest run src/styles/theme-guard.spec.ts` | PASS — 148/148 |
| Server tsc | `cd packages/server && npx tsc --noEmit` | PASS (clean exit) |
| Server vitest | `DEFAULT_VIEW_TTL_MINUTES="" npx vitest run` (3 runs) | **SET-BASED PASS** |
| Sole-materialize-trigger | grep across `components/` + panel/chip files + orchestrator | PASS |

- **Web vitest is 100% with zero failures.** The `Errors: N` line (9 this run; 1–12 across runs) is the pre-existing `InfoPopup`/`columnDisplayConfigStore` 401 unhandled-rejection console noise, documented since `103-GATES.md`; the file itself passes and the count varies purely with parallel scheduling. The gate asserts FAILED == 0, not the error count.
- **Server verdict is SET-BASED, not a fixed pass-count** (per the TD-V16-TEST-ISOLATION contract). Every failing file across 3 runs is either the consistent 8-file core (TD-V11-04 OIDC issuer-mock, `db.smoke` schema-snapshot drift, `routes.wms` credential-forwarding) or a variable extra confirmed PASS in isolation — run 1's `layers.spec.ts` re-verified 51/51 together with `routes.info-query.spec.ts`. Zero failures fall outside the documented umbrella. The dev-`.env` TTL leak is neutralized with `DEFAULT_VIEW_TTL_MINUTES=""`.
- **Sole-materialize-trigger holds:** only the two authorized `DashboardsPage.tsx` cleanup call sites in `components/`; `FilterPanel.tsx` / `FilterPanelRail.tsx` / `FilterChip.tsx` are completely token-free (the global clear-all mutates INPUT stores only and never calls `materialize*` / `drop*View` / `filterStore.reset()` live); `useCombinationOrchestrator.ts` under `hooks/` remains the sole trigger with its 3 ref-count DROP sites. Recorded nit, not a breach: `WidgetRenderer.tsx:31` still imports `materializeFilter`/`dropFilterView` with zero call sites — dead since the Phase 90/91 move.

## SC3 — Blocking live operator walk-through attests PASS

**ATTESTED PASS — 8/8 groups.** Full matrix in `110-UAT.md`; operator attestation 2026-08-27.

| Group | Covers | Verdict |
|---|---|---|
| 1 | FSET designer Settings toggle (110-01) | PASS |
| 2 | FPANEL panel / chips / per-chip remove / group-clear / rail + badge / empty state (107) | PASS |
| 3 | FSCOPE applies-to list + hover ring + click scroll/flash (108) | PASS |
| 4 | FCLEAR global clear-all + ref-count `_c{hash}` DROP (109) | PASS |
| 5 | Filter scope on Calendar / Timeline / Numeric-Line, live read path (109.1/109.2) | PASS |
| 6 | Light + dark themes + narrow viewport (<900px rail/overlay) | PASS |
| 7 | Backward-compat: topbar/unset dashboards byte-identical, no layout staircase | PASS |
| 8 | Multi-map info-popup scoping + panel-mode reflow | PASS |

The light/dark + narrow-viewport group is the check the automated gates provably cannot make: undefined CSS classes and `rgba()`/wrong-token colors pass tsc, vitest and theme-guard while rendering broken. Groups 6 and 8 additionally covered the two post-gate map commits (basemap per-theme CSS + presets; info-click filtered-view fix).

## SC4 — Gaps fixed in-session and re-walked

**ATTESTED — no gaps found.** Every group passed on the first walk, so the gap-fix loop was not exercised. No code changed after the 2026-08-27 gate re-run, so `110-GATES.md` is the evidence of record for exactly the tree the operator walked.

---

## v1.20 Requirement Traceability (19 IDs)

| Requirement | Phase | Status |
|---|---|---|
| FSET-V120-01 | Phase 110 | Complete |
| FSET-V120-02 | Phase 106 | Complete |
| FSET-V120-03 | Phase 106 | Complete |
| FPANEL-V120-01 | Phase 107-02 | Complete |
| FPANEL-V120-02 | Phase 107-02 | Complete |
| FPANEL-V120-03 | Phase 107-01 + 107-02 | Complete |
| FPANEL-V120-04 | Phase 107-02 | Complete |
| FPANEL-V120-05 | Phase 107-02 | Complete |
| FPANEL-V120-06 | Phase 107-02 | Complete |
| FPANEL-V120-07 | Phase 107-02 | Complete |
| FPANEL-V120-08 | Phase 107-01 + 107-02 | Complete |
| FPANEL-V120-09 | Phase 107-01 | Complete |
| FSCOPE-V120-01 | Phase 105 (computation) + Phase 108 (display) | Complete |
| FSCOPE-V120-02 | Phase 108 | Complete |
| FSCOPE-V120-03 | Phase 108 | Complete |
| FSCOPE-V120-04 | Phase 109.1 | Complete |
| FSCOPE-V120-05 | Phase 109.2 | Complete |
| FCLEAR-V120-01 | Phase 109 | Complete |
| VERIFY-V120-01 | Phase 110 | Complete |

**Coverage: 19/19 (100%).** FSCOPE-V120-01 spans Phases 105 + 108; FSCOPE-V120-04/05 are the two mid-milestone inserted-phase requirements (109.1 / 109.2).

---

## Milestone Verdict

**v1.20 Filter Panel is VERIFIED GREEN on both stacks with operator PASS.**

All four Phase 110 success criteria are attested. Automated gates pass on web and server (server SET-BASED ⊆ TD-V16-TEST-ISOLATION, never a fixed pass-count); the sole-materialize-trigger invariant and theme-token discipline hold across the milestone; the blocking operator walk-through passed 8/8 groups including the light/dark and narrow-viewport visual checks, with no gaps requiring the in-session fix loop. All 19 v1.20 requirement IDs are Complete.

**Milestone is ready for archive (`/gsd:complete-milestone`).**

### Carried tech debt (not v1.20 blockers)

- TD-V16-TEST-ISOLATION (server set-based gate), TD-V11-04 (OIDC issuer-mock), TD-V14-WKB-SPIKE, GAP-54-04 (legend layer names), CALX-V2-* (calendar v2 backlog).
- `WidgetRenderer.tsx:31` dead `materializeFilter`/`dropFilterView` import.
- The two WMS build sites in `MapChartRenderer` still carry their own copy of layer-view resolution; adopting `lib/resolveLayerViewName` would close the drift class that produced the `46b1300` info-click bug.
- CARTO raster basemaps are being retired in favour of vector; `VITE_CARTO_API_KEY` is a stopgap, and its query-param name (`api_key` vs `key`) is unconfirmed against CARTO's key-issuance page.
