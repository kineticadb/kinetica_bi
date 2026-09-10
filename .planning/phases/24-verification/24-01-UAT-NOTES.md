---
plan: 24-01
operator: rpereira@kinetica.com
started_on: 2026-05-11
---
# Task 1 — lat/lon + WKT spatial modes
- step: 1.1
  name: "lat/lon mode — basic popup open + 50-record page"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 1.2
  name: "WKT mode — basic popup open + 50-record page"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 1.3
  name: "layer switch resets to page 1"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 1.4
  name: "single-record nav — Back / Next / Record N of M(+) + auto-fetch on Next at last loaded"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 1.5
  name: "template vs key-value in the same session"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 1.6
  name: "Info Card parity with popup"
  status: PASS
  evidence: "operator-approved 2026-05-11"

# Task 2 — Kinetica-GEOMETRY + popup resize + edge-aware + close-X overlap
- step: 2.1
  name: "Kinetica-GEOMETRY column — live SQL path (ST_DISTANCE + ST_GEOMFROMTEXT)"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 2.2
  name: "popup resize config — 200x200 min and 1200x1200 max"
  status: PASS
  evidence: "operator-approved 2026-05-11; resize behavior correct — popup renders at configured dimensions. GAP-24-01-B captured: MapConfigPanel inputs display defaults (360/400) instead of saved values on panel reopen (form read-back bug, not a resize correctness failure)"
- step: 2.3
  name: "edge-aware positioning — 4-corner anchor flip"
  status: PASS
  evidence: "operator-approved 2026-05-11"
- step: 2.4
  name: "close-X does not overlap layer dropdown"
  status: PASS
  evidence: "operator-approved 2026-05-11"

# Gaps discovered during Task 1 UAT (outside original step script)
gaps:
  - id: GAP-24-01-A
    discovered_in: Task 1 UAT (after STEP 1.6)
    severity: high
    title: "Toggling layer visibility off in the layers panel blanks the entire app"
    description: "While completing steps 1.1–1.6, operator toggled a layer's visibility OFF in the layers panel. The application immediately rendered as a blank dark-blue background — no dashboard, no widgets, no popup, no topbar. Re-toggling required a page refresh or further investigation. Likely a render-loop / error-boundary swallow / null-deref in the visibility-toggle handler."
    evidence: ".planning/phases/24-verification/screenshots/24-01-task1-layer-visibility-blank-app.png"
    resolution: deferred_to_gap_closure
    route_to: "v1.4 gap-closure cycle — open as separate plan after Phase 24 verify"
  - id: GAP-24-01-B
    discovered_in: Task 2 UAT STEP 2.2
    severity: medium
    title: "MapConfigPanel INFO POPUP inputs do not echo back saved infoPopupWidthPx / infoPopupHeightPx"
    description: "Resize behavior is correct (popup renders at configured dimensions on next click). However, when the operator re-opens MapConfigPanel after saving custom width/height (e.g. 200x200 or 1200x1200), the infoPopupWidthPx and infoPopupHeightPx input fields display the defaults (360 / 400) rather than the saved configured values. The persisted widget config is intact — the popup still renders at the configured size — only the form inputs fail to read back the current values. Likely a controlled-input initial-value bug in MapConfigPanel.tsx INFO POPUP section."
    evidence: "Operator observed during STEP 2.2 — no screenshot captured; reproducible by setting width/height to non-default and reopening MapConfigPanel"
    resolution: deferred_to_gap_closure
    route_to: "v1.4 gap-closure cycle — UI input read-back fix in MapConfigPanel.tsx"
