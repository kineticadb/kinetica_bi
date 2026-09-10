---
phase: 110-designer-settings-ui-verification-live-uat
plan: 02
subsystem: verification
tags: [verification, uat, gates, milestone-close]

requires:
  - phase: 110-designer-settings-ui-verification-live-uat
    provides: "Plan 01's designer Settings modal + filter-display-mode toggle (the surface SC1 attests and the UAT walk uses to switch modes)"
provides:
  - "110-GATES.md — both-stack automated gate evidence + sole-materialize-trigger invariant (re-run 2026-08-27)"
  - "110-UAT.md — blocking operator walk-through, 8/8 groups PASS, no gaps"
  - "110-VERIFICATION.md — SC1-SC4 attestation + 19/19 v1.20 requirement traceability + milestone verdict"
affects: []

tech-stack:
  added: []
  patterns:
    - "Gate evidence re-run when commits land after the original capture, with the superseded numbers retained for comparison rather than silently overwritten"
    - "Server verdict recorded as SET-BASED (failing set ⊆ TD-V16-TEST-ISOLATION), never a fixed pass-count"

key-files:
  created:
    - .planning/phases/110-designer-settings-ui-verification-live-uat/110-UAT.md
    - .planning/phases/110-designer-settings-ui-verification-live-uat/110-VERIFICATION.md
  modified:
    - .planning/phases/110-designer-settings-ui-verification-live-uat/110-GATES.md
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Gates were re-run rather than trusted: two commits (1061417 basemap/OSM+CARTO-key+per-theme-CSS, 46b1300 info-click filtered-view fix) landed after the 2026-07-12 capture, so the recorded 152/3371 no longer described the tree. Re-run gives 154/3439, all verdicts unchanged."
  - "The two post-gate commits were folded into the UAT checklist rather than deferred — group 6 gained the basemap light/dark + preset checks, group 8 gained 'popup records match the visible filtered tiles' (the regression 46b1300 fixed)."
  - "Roadmap drift corrected in the same pass: the phase-progress table had 109 as '0/? Not started' though its checklist line and artifacts showed complete, and had no rows for the inserted 109.1 / 109.2."

requirements-completed: [VERIFY-V120-01]

duration: 1 session
completed: 2026-08-27
---

# Phase 110 Plan 02: Milestone Verification Summary

**v1.20 Filter Panel verified green on both stacks with an operator PASS on all 8 UAT groups — SC1-SC4 attested, 19/19 requirements Complete, milestone ready for archive.**

## What was verified

- **Automated (SC2):** web tsc clean; web vitest 154 files / 3439 tests, 0 failed; theme-guard 148/148; server tsc clean; server vitest SET-BASED PASS across 3 runs (every failing file either the consistent 8-file TD-V11-04/db.smoke/routes.wms core or a variable extra confirmed PASS in isolation — run 1's `layers.spec.ts` re-verified 51/51 with `routes.info-query.spec.ts`); sole-materialize-trigger grep clean with the v1.20 panel/chip/rail surface token-free.
- **Operator (SC3/SC4):** all 8 groups PASS — designer toggle, panel+chips, applies-to+highlight, global clear-all with ref-count DROP, custom-panel-chart filter scope on the live read path, light+dark+narrow viewport, backward-compat, multi-map info popup. No gaps, so the in-session gap-fix loop was not exercised.
- **Permission invariant (SC1):** the mode toggle rides the existing `DASHBOARDS_EDIT` — permission catalog byte-unchanged, no rbac spec counts moved.

## Notes for the next milestone

- `WidgetRenderer.tsx:31` imports `materializeFilter`/`dropFilterView` with zero call sites — dead since the Phase 90/91 move of the trigger into `useCombinationOrchestrator`.
- The two WMS build sites in `MapChartRenderer` still hold their own copy of layer-view resolution; adopting `lib/resolveLayerViewName` would close the drift class that caused the `46b1300` info-click bug (the info paths read a store Phase 91 had stopped populating, so the popup silently queried the base table for a whole milestone).
- CARTO raster basemaps are being retired in favour of vector; `VITE_CARTO_API_KEY` is a stopgap and its query-param name is unconfirmed.
