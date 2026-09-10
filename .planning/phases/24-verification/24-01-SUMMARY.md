---
phase: 24-verification
plan: 01
subsystem: testing
tags: [uat, verification, info-popup, spatial-query, kinetica-geometry, edge-aware, popup-resize]

# Dependency graph
requires:
  - phase: 21-map-click-popup
    provides: InfoPopup component + MapChartRenderer click handler + EPSG:3857→4326 bbox fix (Session Fix #1)
  - phase: 22-config-ui
    provides: MapConfigPanel INFO POPUP section (infoPopupWidthPx / infoPopupHeightPx) + KineticaWmsLayerForm Info Popup section
  - phase: 23-info-card
    provides: InfoCardRenderer + InfoSelectionView shared body + useLastInfoClickContextStore
provides:
  - "Operator-attested PASS outcomes for VERIFY-V14-01 criteria 1 + 2 across lat/lon, WKT, and Kinetica-GEOMETRY spatial modes"
  - "24-01-UAT-NOTES.md with 10 step rows (1.1–1.6 + 2.1–2.4) all PASS — structured input for 24-03 VERIFICATION.md authoring"
  - "GAP-24-01-A: layer-visibility-toggle blanks entire app (high severity) — deferred to v1.4 gap-closure"
  - "GAP-24-01-B: MapConfigPanel INFO POPUP inputs don't echo saved popup dimensions (medium severity) — deferred to v1.4 gap-closure"
affects:
  - 24-02-PLAN
  - 24-03-PLAN

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UAT notes as structured YAML (step:/status:/evidence:/gaps:) — machine-readable for 24-03 synthesis"
    - "Gap-capture-not-fix-inline cadence — mirrors Phase 17 gap-closure model; bugs discovered during verify land in gaps: array only"

key-files:
  created:
    - .planning/phases/24-verification/24-01-UAT-NOTES.md
    - .planning/phases/24-verification/screenshots/24-01-task1-layer-visibility-blank-app.png
    - .planning/phases/24-verification/24-01-SUMMARY.md
  modified: []

key-decisions:
  - "GAP-24-01-B (medium): MapConfigPanel INFO POPUP controlled-input read-back bug — popup renders correctly at configured size but form inputs show defaults on reopen; deferred to v1.4 gap-closure, NOT fixed inline per Phase 24 no-inline-fix policy"
  - "STEP 2.2 marked PASS (not FAIL) for resize — the resize correctness criterion (popup renders at configured dimensions) is met; the form-input echo failure is a separate UI polish issue captured as a gap"
  - "GAP-24-01-A remains deferred — layer-visibility-blank-app high-severity bug routed to v1.4 gap-closure cycle"

patterns-established:
  - "Gap IDs follow GAP-{phase}-{plan}-{letter} scheme (GAP-24-01-A, GAP-24-01-B) for traceability into 24-VERIFICATION.md"

requirements-completed:
  - VERIFY-V14-01

# Metrics
duration: multi-session (checkpoint plan)
completed: 2026-05-11
---

# Phase 24 Plan 01: UAT — Spatial Modes + Popup Features Summary

**Operator-attested 10/10 PASS across lat/lon, WKT, and Kinetica-GEOMETRY spatial modes with two gaps captured for v1.4 gap-closure (layer-visibility crash + MapConfigPanel input echo bug)**

## Performance

- **Duration:** multi-session (2 checkpoint tasks)
- **Started:** 2026-05-11
- **Completed:** 2026-05-11
- **Tasks:** 2/2
- **Files modified:** 1 (24-01-UAT-NOTES.md created and populated over two sessions)

## Accomplishments

- All 6 Task 1 steps PASS: lat/lon popup open, WKT popup open, layer switch page reset, single-record nav with auto-fetch, template vs key-value, Info Card parity
- All 4 Task 2 steps PASS: Kinetica-GEOMETRY live SQL path (ST_DISTANCE + ST_GEOMFROMTEXT), popup resize 200/1200 clamp, edge-aware 4-corner anchor flip, close-X no overlap
- Two gaps captured for v1.4 gap-closure — neither required inline fix per Phase 24 no-fix-inline policy

## VERIFY-V14-01 Criterion Coverage

| Criterion | Steps Covering | Result |
|-----------|----------------|--------|
| Criterion 1: popup E2E across spatial modes (lat/lon, WKT, Kinetica-GEOMETRY) | 1.1, 1.2, 1.3, 1.4, 1.5, 2.1 | 6/6 PASS |
| Criterion 2: Info Card receives same selection as popup | 1.6 | 1/1 PASS |
| Session Fix #1 bbox projection (EPSG:3857→4326) | 1.1 (mapBbox in 4326 range) | PASS |
| Session Fix #1 Kinetica-GEOMETRY SQL path | 2.1 (ST_DISTANCE + ST_GEOMFROMTEXT, HTTP 200) | PASS |
| Session Fix #2 single-record nav (Back/Next/auto-fetch) | 1.4 | PASS |
| Session Fix #2 popup resize (200–1200 px clamp) | 2.2 | PASS (with GAP-24-01-B caveat — see below) |
| Session Fix #2 close-X overlap fix | 2.4 | PASS |
| Session Fix #3 edge-aware positioning | 2.3 | PASS |

## Gaps Captured

### GAP-24-01-A — Layer-visibility toggle blanks entire app

- **Severity:** high
- **Discovered in:** Task 1 UAT (after STEP 1.6)
- **Description:** Toggling a layer's visibility OFF in the layers panel immediately renders the application as a blank dark-blue background — no dashboard, no widgets, no popup, no topbar. Re-toggling requires a page refresh. Likely a render-loop / error-boundary swallow / null-deref in the visibility-toggle handler.
- **Evidence:** `.planning/phases/24-verification/screenshots/24-01-task1-layer-visibility-blank-app.png`
- **Resolution:** Deferred. Route to v1.4 gap-closure cycle as a separate plan after Phase 24 verify completes.

### GAP-24-01-B — MapConfigPanel INFO POPUP inputs don't echo saved popup dimensions

- **Severity:** medium
- **Discovered in:** Task 2 UAT STEP 2.2
- **Description:** Resize behavior is correct — popup renders at configured dimensions on next click. However, when the operator re-opens MapConfigPanel after saving custom width/height (e.g. 200×200 or 1200×1200), the `infoPopupWidthPx` and `infoPopupHeightPx` input fields display the defaults (360 / 400) rather than the saved configured values. The persisted widget config is intact. Likely a controlled-input initial-value bug in `MapConfigPanel.tsx` INFO POPUP section.
- **Evidence:** Operator observed during STEP 2.2; reproducible by setting width/height to non-default and reopening MapConfigPanel.
- **Resolution:** Deferred. Route to v1.4 gap-closure cycle — UI input read-back fix in `MapConfigPanel.tsx`.

## Task Commits

1. **Task 1: lat/lon + WKT spatial modes** — `a66f25f` (docs)
2. **Task 2: Kinetica-GEOMETRY + popup resize + edge-aware + close-X** — (this commit)

## Files Created/Modified

- `.planning/phases/24-verification/24-01-UAT-NOTES.md` — structured YAML with 10 step rows (all PASS) + 2 gap entries; primary input for 24-03
- `.planning/phases/24-verification/screenshots/24-01-task1-layer-visibility-blank-app.png` — screenshot evidence for GAP-24-01-A
- `.planning/phases/24-verification/24-01-SUMMARY.md` — this file

## Decisions Made

- STEP 2.2 graded PASS (not FAIL): the resize correctness criterion (popup renders at configured width/height) was met; the form-input echo failure is a separate UI polish issue that does not compromise the feature's correctness. Captured as GAP-24-01-B.
- Both gaps deferred without inline fix — this is Phase 24's explicit policy (mirrors Phase 17's gap-closure cadence). No `kinetica_bi/src/` files were modified.

## Deviations from Plan

None — plan executed exactly as written. No production code modified. Bugs discovered during UAT captured as gaps per plan policy.

## Notes for 24-03

Both gaps should appear in the 24-VERIFICATION.md `gaps` array AND in the body's "Discovered Gaps" subsection. They are observation-only outputs; do NOT fix inline.

- **GAP-24-01-A** (high): layer-visibility-toggle → blank app. Evidence screenshot committed.
- **GAP-24-01-B** (medium): MapConfigPanel INFO POPUP inputs show defaults instead of saved values on reopen.

The 24-01-UAT-NOTES.md `gaps:` YAML array contains the canonical descriptions for both gaps. Consume verbatim for 24-VERIFICATION.md `gaps:` frontmatter.

## Next Phase Readiness

- 24-02-PLAN.md is ready to execute: auth modes (password + OIDC) + kill switches + lifecycle resets UAT
- 24-03-PLAN.md synthesizes both UAT-NOTES files into 24-VERIFICATION.md; both gaps route into that report

---
*Phase: 24-verification*
*Completed: 2026-05-11*
