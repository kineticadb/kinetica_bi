# Phase 103: Verification + Live UAT - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Close out v1.19: prove all five features green on both stacks via automated gates, then run a BLOCKING live operator walk-through of the full scenario matrix (all 5 features + edges + cross-feature combos + backward-compat), fix any gaps in-session (repro-test-driven, committed, re-walked), and record PASS. No new feature scope. Also folds in the 4 recharts-visual checks deferred from Phase 101. Verifies after Phases 97–102.

Covers: VERIFY-V119-01.

</domain>

<decisions>
## Implementation Decisions

### Walk-through scope
- **Full matrix + cross-feature combos.** Every feature's happy path + all edge cases + cross-feature interaction combos + a backward-compat sweep (see the matrix below). This is a milestone finale — thoroughness over speed.

### Where it runs + test data
- Walk runs against the **operator's live deployed Kinetica** (mirrors prior UATs — password mode). The plan/UAT record **documents the data characteristics each scenario needs** so the operator picks suitable real tables; no synthetic seed table is built.
- Per-scenario data needs are enumerated (below) so the operator can line up tables before the walk.

### Gap-fix + attestation protocol (standard, mirrors v1.18 Phase 96)
- Any gap found → **repro-test-driven fix → commit → re-walk to PASS**. Record the walk in a **UAT record** (per-scenario PASS/FAIL + notes) AND the final **VERIFICATION.md** with per-success-criterion attestation. Re-assert the sole-materialize-trigger static grep across all five features as part of gates.

### Log-axis zero/negative edge
- The log positive-min clamp is already **unit-locked in `yAxisScale.spec.ts`**. If the operator's tables have no reachable non-positive data, attest the live log behavior on positive data and rely on the unit test for the clamp edge — **note this explicitly** in the UAT record (do NOT block on seeding non-positive data).

### Claude's Discretion
- Exact UAT-record file name/format (mirror the prior milestone's UAT/verification artifact).
- Ordering of the walk; whether to temporarily set `MAX_BAR_GROUP_BY_SERIES` low (e.g. 3) to make the series-cap truncation warning easy to trigger without needing >12 live combos (recommended tip for the operator).
- How many automated-gate reruns before the walk vs after in-session fixes.

</decisions>

<uat_matrix>
## UAT Scenario Matrix (the walk-through checklist)

### SC1 — Automated gates (both stacks, before the walk)
- Web: `cd packages/web && npx vitest run` 100% (0 failed; the pre-existing InfoCardRenderer 401 unhandled-rejection logs an "error" but tests pass — assert on Test Files/Tests passed), `npx tsc --noEmit` clean, theme-guard green.
- Server: `cd packages/server && npx tsc --noEmit` clean; server vitest SET-BASED — failing files ⊆ TD-V16-TEST-ISOLATION (NEVER a fixed pass-count); the v1.19 server touch (custom_metrics routes, /api/auth/me fields) passes in isolation.
- **Sole-materialize-trigger static grep** across all five features: no chart renderer / helper (CalendarRenderer, TimelineRenderer, NumericLineRenderer, bar path, customMetricSql, yAxisScale, customWhere, barGroupedSeries) imports/calls `materializeFilter`/`dropFilterView`; `AggregatedWidgetRenderer` remains the sole trigger.

### F1 — Calendar smart domain control (Phase 97)
- Switch a calendar between advanced two-dropdown and smart single-dropdown (`controlMode`).
- Smart "Time scale" = month/week/day/hour renders the mapped pair (month→year/month, week→month/week, day→month/day, hour→day/hour).
- Restrict allowed smart options → only allowed appear in the picker.
- BACKWARD-COMPAT: an existing calendar (no `controlMode`) renders the two-dropdown UI unchanged.
- Data: a table with a timestamp column + a metric.

### F2 — Per-visualization custom WHERE (Phase 98)
- Enter a bare predicate on a plain-SQL widget → narrows THAT widget only; other widgets unaffected.
- Custom WHERE ANDed on top of an active drill-down filter (both apply).
- Empty WHERE → widget unchanged.
- **Invalid WHERE → error on that widget only; rest of the dashboard keeps rendering** (isolation — the key edge).
- Data: a table + a filterable column; one valid predicate + one deliberately-invalid predicate.

### F3 — Custom metrics (Phases 99 + 100)
- Create / edit / delete a custom metric (label + SQL aggregate, e.g. `SUM(a)/SUM(b)`) from the Tables-area editor; duplicate label → inline 409.
- Metric appears in EVERY viz metric picker (in the "Custom metrics" group); aggregation control hidden when a custom metric is selected.
- Select it → expression emitted directly (NO extra AGG wrapper); widget renders the computed value.
- **Deleted metric → "(deleted metric)" marker + widget falls back to error/empty** (orphan edge); editing a metric's expression flows through to widgets using it (id-referenced).
- Reused across dashboards (global per-table); writes gated by `datasets:manage` (a non-permitted user can't write).
- Data: a table with ≥2 numeric columns for a ratio metric; a `datasets:manage` user + a non-permitted user.

### F4 — Smart / logarithmic Y-axis (Phase 101; incl. deferred visual checks)
- On line, timeline, AND bar: pick Zero-based / Smart / Logarithmic.
- Smart → axis min/max from data scope, no forced 0 baseline (visual).
- Log → value axis on a log scale (visual, positive data).
- Log zero/negative clamp → unit-covered; note if not live-reproducible.
- BACKWARD-COMPAT: a widget with no scale config renders unchanged (bar zero-based, line/timeline data-derived).
- Data: line/timeline/bar with a numeric metric, ideally high dynamic range for log to read clearly.

### F5 — Multi-column bar group-by (Phase 102)
- Add ≥2 group-by columns on a bar → col1 = x-axis categories, col2..N = colored series.
- Grouped vs stacked toggle (reused `stacked`): clustered vs stacked bars.
- **Series-cap truncation warning** when series exceed the env cap (tip: set `MAX_BAR_GROUP_BY_SERIES` low, e.g. 3, to trigger without needing >12 combos).
- BACKWARD-COMPAT: single/no group-by column → byte-identical to today's single-series bar.
- Data: a table with ≥2 categorical columns + a numeric metric.

### X — Cross-feature combos
- ONE bar widget with: multi-column group-by + a custom metric (as the metric) + a custom WHERE + a smart/log Y-axis — all applied together render correctly.
- A calendar in smart mode + a custom WHERE.
- A custom metric used as a series metric in a multi-column bar.

### R — Backward-compat / regression sweep
- Open a pre-v1.19 dashboard → all widgets byte-identical: calendars in two-dropdown mode, bars single-series zero-based, no phantom custom filters, real-column metric pickers unchanged, existing line/timeline axes data-derived.

</uat_matrix>

<specifics>
## Specific Ideas

- Milestone finale: the walk is the acceptance gate for v1.19. All 19 feature requirements are already Complete (BARGRP/CALSMART/VIZSQL/METRIC/YAXIS); this phase proves them live + green and closes VERIFY-V119-01.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** No external specs — the canonical sources are the five feature phases' CONTEXT/VERIFICATION + the prior verification-phase pattern:

### Requirements
- `.planning/REQUIREMENTS.md` §"Verification (VERIFY)" — VERIFY-V119-01; the full v1.19 requirement list (all 19 features Complete) is the acceptance surface.
- `.planning/ROADMAP.md` §"Phase 103" — goal, invariant, 3 success criteria.

### Feature-phase contexts (the behaviors to walk)
- `.planning/phases/97-calendar-smart-domain-control/97-CONTEXT.md` (F1)
- `.planning/phases/98-per-visualization-custom-where-clause/98-CONTEXT.md` (F2)
- `.planning/phases/99-custom-metrics-server-store-foundation/99-CONTEXT.md` + `.planning/phases/100-custom-metrics-tables-area-editor-metric-picker-integration/100-CONTEXT.md` (F3)
- `.planning/phases/101-smart-logarithmic-y-axis/101-CONTEXT.md` (F4)
- `.planning/phases/102-multi-column-group-by-on-bar-chart/102-CONTEXT.md` (F5)

### Prior verification-phase pattern to mirror
- `.planning/phases/96-*/96-VERIFICATION.md` (+ any 96 UAT record) — v1.18's verification + live-UAT structure, in-session gap-fix + re-walk, per-scenario attestation. Also v1.17 Phase 87, v1.15 Phase 79.

</canonical_refs>

<code_context>
## Existing Code Insights

### Gate commands (from CLAUDE.md + prior phases)
- Web: `cd packages/web && npx tsc --noEmit`; `npx vitest run`; `npx vitest run src/styles/theme-guard.spec.ts`.
- Server: `cd packages/server && npx tsc --noEmit`; server vitest SET-BASED (⊆ TD-V16-TEST-ISOLATION; the OIDC-mock + db.smoke + dev-.env-leak cross-mode failures are the known set — verify new specs pass in isolation).
- Known non-failing noise: web `InfoCardRenderer.spec.tsx` logs a 401 unhandled-rejection "error" but tests pass — assert on "Test Files/Tests passed" with 0 failed.

### Env vars in play for the walk
- `MAX_BAR_GROUP_BY_SERIES` (default 12) — bar series cap; set low to force the truncation warning.
- Custom metrics need a `datasets:manage` user (writes) + reads ungated.
- The v1.15 TTL env vars + v1.18 combination/dv-scope flags are unchanged (not under test here).

### Static-grep invariant
- Re-run the sole-materialize-trigger grep across the five features' renderers/helpers (import-only where comments legitimately mention the tokens — e.g. CalendarRenderer).

</code_context>

<deferred>
## Deferred Ideas

- All v1.19 deferred backlog items remain deferred (VIZSQL-V2-01 map/WMS WHERE, METRIC-V2-01 row-level computed columns, METRIC-V2-02 per-dashboard metric overrides, YAXIS-V2-01 axis modes on pie/calendar, live viewer-facing calendar smart switcher) — NOT part of this walk.
- Seeding a synthetic test dataset for guaranteed edge reproduction — deferred; the walk uses the operator's real tables.

</deferred>

---

*Phase: 103-verification-live-uat*
*Context gathered: 2026-07-02*
