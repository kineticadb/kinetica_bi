---
plan: 24-02
operator: rpereira@kinetica.com
started_on: 2026-05-11
---
# Task 1 — auth modes + kill switches
- step: 1.1
  name: "AUTH_MODE=password — full info-popup flow + audit-log auth_mode evidence"
  status: PASS
  evidence: "operator-approved 2026-05-11 — backend restarted in password mode after .env edit; audit-log auth_mode=password observed"
- step: 1.2
  name: "AUTH_MODE=oidc — full info-popup flow + Bearer-token evidence"
  status: PASS
  evidence: "operator-approved 2026-05-11 — OIDC Authorization Code flow completed; Bearer-token auth observed"
- step: 1.3
  name: "per-layer kill switch — disabled layer drops from dropdown"
  status: PASS
  evidence: "operator-approved 2026-05-11 — disabled layer absent from dropdown; fan-out skipped"
- step: 1.4
  name: "per-widget kill switch — zero POST /api/info/query requests"
  status: PASS
  evidence: "operator-approved 2026-05-11 — zero POST /api/info/query requests observed when infoEnabled OFF"

# Task 2 — lifecycle resets + viewName routing + TD-V12-04
- step: 2.1
  name: "dashboard-switch reset — stores cleared, no stale popup"
  status: DEFERRED
  evidence: "BLOCKED by GAP-24-02-A — dashboard-switch crash: Image load error + NotFoundError insertBefore at MapChartRenderer.tsx:483 (map.addLayer). Could not switch to second dashboard with map widget. Screenshot: .planning/phases/24-verification/screenshots/24-02-task2-dashboard-switch-crash.png"
- step: 2.2
  name: "logout reset — no stale records after re-login"
  status: PASS
  evidence: "operator-approved 2026-05-11 — logged out with content present, re-logged in, popup closed + Info Card empty-state placeholder, no stale records"
- step: 2.3
  name: "filter-view-aligned popup — viewName routing in POST payload"
  status: PASS
  evidence: "operator-approved 2026-05-11 — viewName _kbi_filt_... present in POST payload when filter active (matches WMS LAYERS=), absent when filter cleared; rows correctly subset"
- step: 2.4
  name: "TD-V12-04 fixture resolution attempt"
  status: PASS
  evidence: "operator-approved 2026-05-11 — TD-V12-04 considered closed via STEP 2.3 PASS evidence (viewName routing verified end-to-end)"

# Gaps discovered during Task 2 UAT
gaps:
  - id: GAP-24-02-A
    discovered_in: Task 2 UAT STEP 2.1
    severity: high
    title: "Dashboard switch crashes when destination dashboard has a map widget — Image load error + NotFoundError insertBefore"
    description: "While attempting STEP 2.1 (dashboard-switch reset), operator opened a popup in Dashboard A then tried to switch to Dashboard B. Console threw 'Error: Image load error' at MapChartRenderer.tsx:483 (the map.addLayer(imageLayer) line) followed by 'Uncaught NotFoundError: Failed to execute insertBefore on Node: The node before which the new node is to be inserted is not a child of this node.' The error originates in the MapChartRenderer/WidgetRenderer/ResponsiveGridLayout stack. Symptom: dashboard switch fails; second dashboard does not render. Likely root cause: an async WMS image-load completes after the parent React component has started unmounting during dashboard transition, then OpenLayers' DOM-insert fires against a node React has already detached. This blocks STEP 2.1 verification."
    file_citation: "kinetica_bi/src/components/charts/MapChartRenderer.tsx:483 (map.addLayer(imageLayer))"
    evidence: ".planning/phases/24-verification/screenshots/24-02-task2-dashboard-switch-crash.png"
    resolution: deferred_to_gap_closure
    route_to: "v1.4 gap-closure cycle — investigate OL image-load vs React unmount race in MapChartRenderer; possibly add a cleanup gate or AbortController-style guard"
