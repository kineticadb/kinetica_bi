# Requirements: Kinetica BI — v1.19 Visualization Customization

**Defined:** 2026-06-30
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

## v1.19 Requirements

Requirements for the v1.19 milestone. Each maps to exactly one roadmap phase.

### Calendar Smart Domain Control (CALSMART)

- [x] **CALSMART-V119-01**: Designer can switch a calendar widget between the advanced two-dropdown (domain + subdomain) UI and a smart single-dropdown UI; existing calendars with no smart config keep the two-dropdown behavior unchanged.
- [x] **CALSMART-V119-02**: In smart mode, selecting month / week / day / hour auto-applies the mapped domain+subdomain pair (month→year/month, week→month/week, day→month/day, hour→day/hour).
- [x] **CALSMART-V119-03**: Designer can restrict which smart options (month / week / day / hour) are selectable by the viewer.

### Per-Visualization Custom WHERE Clause (VIZSQL)

- [x] **VIZSQL-V119-01**: On each plain-SQL widget (calendar, line, timeline, pie, bar, records table, big number, and other SQL-running widgets — excluding map/WMS layers), the designer can enter a freeform raw-SQL WHERE expression in the widget config.
- [x] **VIZSQL-V119-02**: A non-empty custom WHERE is ANDed into that widget's read query on top of all active drill-down / per-viz-selection filters, against the materialized view the widget already reads.
- [x] **VIZSQL-V119-03**: An empty/absent custom WHERE leaves the widget's query byte-identical to current behavior.
- [x] **VIZSQL-V119-04**: An invalid WHERE expression surfaces the query error on that widget without breaking the dashboard (other widgets unaffected).

### Custom Metrics per Table (METRIC)

- [x] **METRIC-V119-01**: From the Tables area, a user can define a custom metric on a table as a labeled SQL aggregate expression (e.g. `SUM(revenue)/SUM(cost)`). _(Server/CRUD half done in Phase 99; Tables-area authoring UI in Phase 100.)_
- [x] **METRIC-V119-02**: Custom metrics are persisted server-side per table and reused across all dashboards using that table; a user can edit and delete them.
- [x] **METRIC-V119-03**: Custom metrics appear in every visualization metric picker alongside real columns.
- [x] **METRIC-V119-04**: When a custom metric is selected, its aggregate expression is emitted directly into the widget's SQL with no further aggregation wrapper applied.

### Smart / Logarithmic Y-Axis (YAXIS)

- [x] **YAXIS-V119-01**: On line, timeline, and bar charts, the designer can choose a Y-axis scale mode: Zero-based (default), Smart, or Logarithmic.
- [x] **YAXIS-V119-02**: Smart mode derives the Y-axis min/max from the data range and does not force a 0 baseline.
- [x] **YAXIS-V119-03**: Logarithmic mode renders the value axis on a log scale.
- [x] **YAXIS-V119-04**: Absent config defaults to Zero-based — current behavior is unchanged for existing widgets.

### Multi-Column Group-By on Bar Chart (BARGRP)

- [x] **BARGRP-V119-01**: On the bar chart, the designer can select more than one group-by column.
- [x] **BARGRP-V119-02**: Multiple group-by columns render nested/hierarchically, with a designer toggle for grouped (clustered) vs stacked.
- [x] **BARGRP-V119-03**: The number of group-by columns / resulting series is capped via a deploy-time env var (read once at boot, fallback+warn), with graceful handling when the cap is exceeded.
- [x] **BARGRP-V119-04**: A single-column group-by (or none) renders byte-identical to current bar-chart behavior.

### Synchronized Map Viewports (MAPSYNC) — added 2026-07-07 (Phase 104)

- [x] **MAPSYNC-V119-01**: A per-map config toggle "Sync map viewport" (default OFF) controls whether a map participates in viewport sync; an enabled map both publishes and subscribes.
- [x] **MAPSYNC-V119-02**: When a sync-enabled map's viewport changes via user pan/zoom, its viewport (center + zoom) is published.
- [x] **MAPSYNC-V119-03**: A sync-enabled map subscribes to the published viewport and pans/zooms to match it.
- [x] **MAPSYNC-V119-04**: A map moved programmatically by an incoming sync does not re-publish (echo-loop guard).
- [x] **MAPSYNC-V119-05**: Sync is scoped per-dashboard, and the transient viewport state resets on dashboard switch + logout.
- [x] **MAPSYNC-V119-06**: A map with no sync config (toggle off/absent) behaves byte-identically to current map behavior.

### Verification (VERIFY)

- [x] **VERIFY-V119-01**: All five features verified via green automated gates (web vitest 100% from `packages/web`, web + server `tsc` clean, theme-guard green, server vitest set-based ⊆ TD-V16-TEST-ISOLATION) plus a blocking live operator walk-through, with any gaps fixed in-session and re-walked to PASS.

> NOTE: MAPSYNC (Phase 104) was added AFTER Phase 103's verification PASS (2026-07-02) — it is NOT covered by that attestation. Phase 103 must be re-run to cover Phase 104 before v1.19 closes.

## Future Requirements

Deferred to a later milestone. Tracked but not in the current roadmap.

### Visualization Customization (deferred)

- **VIZSQL-V2-01**: Custom WHERE clause on map / WMS layers (separate WMS render path).
- **METRIC-V2-01**: Row-level computed columns (non-aggregate expressions the viz then aggregates).
- **METRIC-V2-02**: Per-dashboard custom-metric overrides (v1.19 is global per-table).
- **YAXIS-V2-01**: Smart / log Y-axis on pie / calendar / other chart types.

## Out of Scope

Explicitly excluded for v1.19. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom WHERE on map / WMS layers | Maps use a separate WMS-param render path, not plain SQL; deferred to VIZSQL-V2-01 |
| Row-level computed columns | v1.19 custom metrics are pre-aggregated expressions only; row-level deferred to METRIC-V2-01 |
| New RBAC permission for custom metrics | Reuse the existing `datasets:manage` for writes / ungated read, mirroring `column_display_config` (v1.15) — avoids a permission ripple |
| Viewer-editable WHERE / metrics at runtime | Both are designer config-time fields persisted in config; no runtime viewer-entry surface |
| Smart / log Y-axis on pie / calendar | Scoped to line / timeline / bar only |
| Sandboxing / parsing of user SQL | Custom WHERE + metric expressions are raw SQL bounded by the user's own Kinetica creds (same trust model as existing SQL paths); no server-side SQL sandbox added |

## Traceability

Which phases cover which requirements. Populated during roadmap creation (2026-06-30).

| Requirement | Phase | Status |
|-------------|-------|--------|
| CALSMART-V119-01 | Phase 97 | Complete |
| CALSMART-V119-02 | Phase 97 | Complete |
| CALSMART-V119-03 | Phase 97 | Complete |
| VIZSQL-V119-01 | Phase 98 | Complete |
| VIZSQL-V119-02 | Phase 98 | Complete |
| VIZSQL-V119-03 | Phase 98 | Complete |
| VIZSQL-V119-04 | Phase 98 | Complete |
| METRIC-V119-01 | Phase 99 + Phase 100 | Complete |
| METRIC-V119-02 | Phase 99 | Complete |
| METRIC-V119-03 | Phase 100 | Complete |
| METRIC-V119-04 | Phase 100 | Complete |
| YAXIS-V119-01 | Phase 101 | Complete |
| YAXIS-V119-02 | Phase 101 | Complete |
| YAXIS-V119-03 | Phase 101 | Complete |
| YAXIS-V119-04 | Phase 101 | Complete |
| BARGRP-V119-01 | Phase 102 | Complete |
| BARGRP-V119-02 | Phase 102 | Complete |
| BARGRP-V119-03 | Phase 102 | Complete |
| BARGRP-V119-04 | Phase 102 | Complete |
| VERIFY-V119-01 | Phase 103 | Complete |
| MAPSYNC-V119-01 | Phase 104 | Complete |
| MAPSYNC-V119-02 | Phase 104 | Complete |
| MAPSYNC-V119-03 | Phase 104 | Complete |
| MAPSYNC-V119-04 | Phase 104 | Complete |
| MAPSYNC-V119-05 | Phase 104 | Complete |
| MAPSYNC-V119-06 | Phase 104 | Complete |

> METRIC-V119-01 is the only requirement spanning two phases: its server-persistence half lands in Phase 99 (the `custom_metrics` table + CRUD) and its Tables-area authoring-UI half in Phase 100. Every other requirement maps to exactly one phase.

**Coverage:**
- v1.19 requirements: 26 total (20 original + 6 MAPSYNC added post-verification)
- Mapped to phases: 26/26 ✓
- Unmapped: 0
- Phases: 8 (97 Calendar Smart Domain · 98 Custom WHERE · 99 Custom Metrics Foundation · 100 Custom Metrics UI/Picker · 101 Smart/Log Y-Axis · 102 Multi-Column Bar Group-By · 103 Verification + Live UAT · 104 Synchronized Map Viewports)

---
*Requirements defined: 2026-06-30*
*Last updated: 2026-07-07 — Phase 104 (Synchronized Map Viewports) added post-v1.19-verification; +6 MAPSYNC-V119 requirements (Phases now 97-104)*
