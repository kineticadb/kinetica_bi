---
phase: 102-multi-column-group-by-on-bar-chart
verified: 2026-07-01T22:50:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 102: Multi-Column Group-By on Bar Chart — Verification Report

**Phase Goal:** On the bar chart, a designer can select arbitrary N group-by columns (env-var capped), rendered nested/hierarchically with a grouped (clustered) vs stacked toggle.
**Verified:** 2026-07-01T22:50:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Designer can select >1 group-by column on bar widgets (N-column builder, max 6) | VERIFIED | `ChartConfigPanel.tsx` L750–806: `isBar && requiresGroupBy` IIFE renders ordered add/remove builder; `MAX_BAR_GROUP_BY_COLUMNS = 6`; `aria-label` on each row select |
| 2 | Multi-column renders col1=x-axis, col2..N=compound " / " series; grouped/stacked toggle via `stacked` boolean | VERIFIED | `WidgetRenderer.tsx` L898–913: `toBarPivotInput` → `selectTopSeries` → `pivotSeriesRows`; `stackId: "stacked"` spread only when stacked, omitted when grouped (no empty-string stackId) |
| 3 | Env-var series cap (MAX_BAR_GROUP_BY_SERIES default 12) plumbed server→me→store; over-cap shows truncation note with real className | VERIFIED | `server/src/index.ts` L182–185: `readPositiveIntEnv("MAX_BAR_GROUP_BY_SERIES", 12)`; L425: `maxBarGroupBySeriesCap: MAX_BAR_GROUP_BY_SERIES` in `/api/auth/me`; `client.ts` L295: coalesce 12; `auth.ts` L22/40/55: type+initial+bootstrap; `WidgetRenderer.tsx` L1033–1036: `data-testid="bar-truncated-note"` with `className="config-hint"` |
| 4 | Single-column (or no groupByColumns) renders byte-identical to pre-102 single-`<Bar>` + `<Cell>` + `<LabelList>` path | VERIFIED | `WidgetRenderer.tsx` L1084–1124: single-series branch unchanged; `ChartConfigPanel.spec.tsx` Test 1 asserts exact byte-identical SQL string `SELECT region, SUM(amount) AS value FROM sales GROUP BY region ORDER BY value DESC LIMIT 100` |
| 5 | Phase 98 customWhere, Phase 100 custom-metric, Phase 101 yAxisScale not regressed by multi-column path | VERIFIED | `ChartConfigPanel.tsx` L327: `cw = whereCustomWhere(...)` computed before the `isMultiColumnBarGroupBy` branch; L381–382: `resolveMetricExpr` used in multi-column branch; `WidgetRenderer.tsx` L999/1005: `yAxisScale` + `yAxisScaleProps` computed over `scaleValues` in both modes |
| 6 | AggregatedWidgetRenderer sole materialize trigger; BarRenderer adds no materialize calls; server touch limited to index.ts | VERIFIED | `grep materializeFilter WidgetRenderer.tsx` shows only import (L31) and comment (L381) — no call in BarRenderer body; commit `02eec86` stat shows ONLY `packages/server/src/index.ts` changed |

**Score:** 6/6 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/barGroupedSeries.ts` | Pure helper: `toBarPivotInput`, `isMultiColumnBarGroupBy`, `BAR_SERIES_SEPARATOR` | VERIFIED | 49 lines; zero React/Recharts/Zustand imports; correct `length >= 2` guard; " / " compound key; null/non-finite → `null`; String()-coercion |
| `packages/web/src/lib/barGroupedSeries.spec.ts` | 11 tests across 5 behavior cases; Test 5 composes with real groupedSeries helpers | VERIFIED | 11/11 passing; Test 5 imports real `selectTopSeries`/`pivotSeriesRows`; Test 2 asserts `series === "A / X"` for 3-column; Test 3 asserts `value === null` for null/non-finite |
| `packages/server/src/index.ts` | `MAX_BAR_GROUP_BY_SERIES` boot read + `/api/auth/me` field | VERIFIED | L185: `readPositiveIntEnv("MAX_BAR_GROUP_BY_SERIES", 12)`; L425: `maxBarGroupBySeriesCap: MAX_BAR_GROUP_BY_SERIES` in res.json |
| `packages/server/tests/auth.routes.spec.ts` | Both password + oidc `toEqual` assertions include `maxBarGroupBySeriesCap: 12` | VERIFIED | L383 + L395: both assertions contain `maxBarGroupBySeriesCap: 12`; the `maxBarGroupBySeriesCap: 12` field appears in the actual response (confirmed via diff output) |
| `packages/web/src/api/client.ts` | `MeResponse` type + `fetchMe` coalesce default 12 | VERIFIED | L252: `maxBarGroupBySeriesCap: number` in `MeResponse`; L295: coalesce `typeof json.maxBarGroupBySeriesCap === "number" ? ... : 12` |
| `packages/web/src/store/auth.ts` | `maxBarGroupBySeriesCap` in type + initial state (12) + bootstrap set | VERIFIED | L22: type field; L40: `maxBarGroupBySeriesCap: 12` initial; L55: `maxBarGroupBySeriesCap: me.maxBarGroupBySeriesCap` in authenticated bootstrap set |
| `packages/web/src/components/charts/definitions/bar.ts` | `groupByColumns: [] as string[]` in defaultConfig; stacked hint updated | VERIFIED | L54–55: `groupByColumns: [] as string[]`; L18: stacked hint updated to document grouped/stacked dual meaning |
| `packages/web/src/components/charts/ChartConfigPanel.tsx` | Bar-only N-column builder; multi-column SQL branch; `draft.groupByColumns` in dep array; preserves Phase 98/100/101 | VERIFIED | L313–314: `isBar` flag; L318: `MAX_BAR_GROUP_BY_COLUMNS = 6`; L377–396: `isMultiColumnBarGroupBy` guard with generous LIMIT; L421: `draft.groupByColumns` in dep array; `cw`/`resolveMetricExpr`/`sortDir` all present in multi-column branch |
| `packages/web/src/components/charts/WidgetRenderer.tsx` | BarRenderer multi-series branch guarded by `isMultiColumnBarGroupBy`; N `<Bar>` with conditional `stackId`; truncation note; drill on `groupByColumns[0]`; Phase 101 scaleProps preserved | VERIFIED | L898–913: pivot setup; L958–974: multi-series drill on `payload["bucket"]` + `groupByColumns[0]`; L1033–1036: truncation note; L1072–1083: N `<Bar>` with conditional `stackId` spread; L1002–1005: scaleProps over flattened series values in multi mode |
| `packages/web/src/styles/theme-guard.spec.ts` | `charts/WidgetRenderer.tsx` in ALLOWLIST with justification | VERIFIED | L41–43: entry present with Phase 102 justification for toCssColor data-viz SVG fills |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/src/index.ts` `/api/auth/me` | `web/src/api/client.ts` `fetchMe` | `maxBarGroupBySeriesCap` JSON field | WIRED | L425 server → L295 client coalesce |
| `web/src/api/client.ts` `fetchMe` | `web/src/store/auth.ts` bootstrap | `me.maxBarGroupBySeriesCap` | WIRED | L55 auth.ts: `maxBarGroupBySeriesCap: me.maxBarGroupBySeriesCap` in authenticated set |
| `ChartConfigPanel` N-column builder `onChange` | `draft.groupByColumns` | `set("groupByColumns", next)` | WIRED | L768: `set("groupByColumns", next)` on column change; L786: same on remove |
| `ChartConfigPanel` multi-column SQL branch | `useAuthStore.maxBarGroupBySeriesCap` | `getState()` at save time | WIRED | L392: `const seriesCap = useAuthStore.getState().maxBarGroupBySeriesCap` |
| `BarRenderer` multi-series branch | `barGroupedSeries.toBarPivotInput` + `groupedSeries.selectTopSeries`/`pivotSeriesRows` | pivot rows → top-N series → recharts rows | WIRED | L903–907: full pivot chain present |
| `BarRenderer` multi-series `<Bar>` | `config.stacked` | `stackId` presence | WIRED | L1080: `{...(stacked ? { stackId: "stacked" } : {})}` — never empty string |
| `BarRenderer` multi-series drill | `dispatchDrillDown` | `payload["bucket"]` + `column=groupByColumns[0]` | WIRED | L959–972: `payload["bucket"]`; `column = groupByColumns[0] ?? ""`; `dispatchDrillDown` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BARGRP-V119-01 | 102-02 | Designer can select more than one group-by column | SATISFIED | N-column builder in ChartConfigPanel (max 6); multi-column SQL branch; spec Test 2 asserts LIMIT 2400 for 2-column config |
| BARGRP-V119-02 | 102-02, 102-03 | Multiple columns render nested/hierarchically with grouped/stacked toggle | SATISFIED | `toBarPivotInput` creates col1=bucket, col2..N=" / "-joined series; `stackId: "stacked"` spread only when `config.stacked===true`; compound labels via `BAR_SERIES_SEPARATOR` |
| BARGRP-V119-03 | 102-01, 102-03 | Series capped by deploy-time env var with graceful over-cap handling | SATISFIED | `MAX_BAR_GROUP_BY_SERIES` env var with `readPositiveIntEnv` fallback+warn; plumbed through `/api/auth/me` → auth store; `selectTopSeries({ max: maxCap })` in BarRenderer; truncation note with `data-testid="bar-truncated-note"` and `className="config-hint"` |
| BARGRP-V119-04 | 102-02, 102-03 | Single-column (or none) renders byte-identical to current behavior | SATISFIED | `isMultiColumnBarGroupBy` guard (length >= 2) falls through to existing single-series path when false; spec Test 1 asserts exact SQL string; static-source spec asserts `<Bar dataKey={y}`, `<Cell`, `<LabelList` remain in single-series branch |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `ChartConfigPanel.tsx` | 669 | `className="config-hint config-hint-warning"` — `config-hint-warning` is NOT in global.css | Info | Pre-existing from Phase 35 (DV-V16-12 dvColumnsMissing hint); NOT introduced by Phase 102. Confirmed via `git show e2e5f72` — the class was NOT in the Phase 102 commit diff. Zero impact on Phase 102 goal. |

No Phase 102-introduced anti-patterns found:
- No `stackId=""` or `stackId: ""` (grep returns nothing)
- No `config-hint-warning` in Phase 102 additions
- No raw hex in non-allowlisted components
- No `materializeFilter`/`dropFilterView` in BarRenderer body
- No invented CSS class names in Phase 102 additions (builder uses `ds-field`, `ds-field-label`, `ds-select`, `ghost-sm`, `config-hint`, `config-group`, `config-group-label`)

---

## Test Gate Results

### Web (packages/web)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | CLEAN — 0 errors |
| `npx vitest run src/lib/barGroupedSeries.spec.ts` | 11/11 PASSED |
| `npx vitest run src/components/charts/ChartConfigPanel.spec.tsx` | 34/34 PASSED (incl. 5 new BARGRP tests + all pre-existing) |
| `npx vitest run src/components/charts/WidgetRenderer.spec.tsx` | 118/118 PASSED (incl. 6 new BARGRP + Invariant tests + all pre-existing) |
| `npx vitest run src/styles/theme-guard.spec.ts` | 136/136 PASSED |
| `npx vitest run` (full web suite) | 137 files passed / 1 failed (DatasetsPage.spec.tsx — pre-existing TD-V16-TEST-ISOLATION cross-test contamination); 3174/3175 tests passed |

### Server (packages/server)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | CLEAN — 0 errors |
| `npx vitest run tests/auth.routes.spec.ts` | 15/20 passed, 5 failed — ALL 5 failures are pre-existing TD-V16-TEST-ISOLATION issues: `Issuer is not a constructor` (OIDC tests) + dev `.env` leaking `DISABLE_DV_FILTER_SCOPE=true` / `MAX_COMBINATION_VIEWS_PER_TABLE=2` into strict `toEqual` assertions. The `maxBarGroupBySeriesCap: 12` field IS present in the actual server response (confirmed in diff output — failure is field value mismatch for OTHER env vars, not missing Phase 102 field). |
| Server src diff | ONLY `packages/server/src/index.ts` touched in Phase 102 (commit `02eec86` stat confirms) |

---

## Human Verification Required

### 1. Visual grouped vs stacked toggle

**Test:** Create a bar widget with 2+ group-by columns. Toggle the "Stacked" boolean in the config panel.
**Expected:** Grouped (default): bars cluster side-by-side per x-axis category. Stacked (on): bars stack vertically.
**Why human:** recharts `stackId` prop behavior is JSX-rendered SVG; not testable in JSDOM.

### 2. Truncation note visibility

**Test:** Configure MAX_BAR_GROUP_BY_SERIES=3, create a bar widget whose data has >3 unique compound series values.
**Expected:** The "Showing top 3 of N series" note appears above the chart in `var(--accent-text)` color.
**Why human:** Requires a live server with the env var set and real data exceeding the cap.

### 3. ColorBrewer series colors in multi-series mode

**Test:** Add 2+ group-by columns to a bar widget, inspect the bar fill colors.
**Expected:** Each series cycles through the ColorBrewer palette (not single-color bars).
**Why human:** SVG fill color rendering cannot be verified in JSDOM.

---

## Gaps Summary

None. All 6 observable truths are VERIFIED. All 10 required artifacts exist, are substantive, and are wired. All 4 BARGRP requirements are satisfied. No Phase-102-introduced anti-patterns found.

The pre-existing `config-hint-warning` on ChartConfigPanel.tsx L669 is a CSS gap from Phase 35 — it renders as unstyled but does not affect any Phase 102 functionality and is outside this phase's scope.

---

_Verified: 2026-07-01T22:50:00Z_
_Verifier: Claude (gsd-verifier)_
