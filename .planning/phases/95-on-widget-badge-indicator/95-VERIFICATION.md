---
phase: 95-on-widget-badge-indicator
verified: 2026-06-29T10:30:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
human_verification:
  - test: "Visual appearance of the badge on a real dashboard with ≥1 excluded filter"
    expected: "Accent-colored pill reading '2 of 3 filters' (or similar) appears in widget header next to title; hovering shows breakdown tooltip"
    why_human: "CSS rendering, hover tooltip display, and visual layout cannot be verified by grep/test runners"
  - test: "Accept-all widget on same dashboard shows zero badge"
    expected: "No pill visible in the widget header — byte-identical to v1.17"
    why_human: "Visual regression confirmation requires a live browser session"
---

# Phase 95: On-Widget Badge Indicator — Verification Report

**Phase Goal:** Each single-scope chart widget ignoring ≥1 active filter shows an "N of M filters" badge in its widget header, with a hover breakdown of applied/ignored filters; default accept-all shows NO badge; the global top filter-bar is unchanged. (Map/per-layer badge is DEFERRED — COMM-V2-02.)
**Verified:** 2026-06-29T10:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A chart widget accepting ALL active filters (default accept-all OR configured) shows NO badge — zero visual change from v1.17 (SC1). | VERIFIED | `WidgetFilterBadge.tsx:63`: `if (summary.appliedCount >= summary.totalCount) return null` — guard confirmed. Spec tests: "renders null when appliedCount === totalCount (accept-all, 3 of 3)" + "renders null when appliedCount === totalCount === 0". DashboardsPage.spec.tsx SC1 integration test passes. |
| 2 | A chart widget ignoring ≥1 active filter shows a badge reading "{N} of {M} filters" in its widget header (SC2). | VERIFIED | `WidgetFilterBadge.tsx:74`: `{summary.appliedCount} of {summary.totalCount} filters`. Spec: "renders element with text '2 of 3 filters' when 2 applied of 3 total" passes. DashboardsPage.spec.tsx shows "{N} of {M} filters" badge for allowlist-excluding widget. |
| 3 | The badge uses theme tokens var(--accent)/var(--accent-text) — no hardcoded hex (SC2). | VERIFIED | `global.css:2821-2822`: `background: var(--accent); color: var(--accent-text)`. No raw hex found in `WidgetFilterBadge.tsx` (grep returned empty). Theme-guard 132/132 green. |
| 4 | Hovering the badge reveals a breakdown listing applied filters + ignored filters with a "source excluded" reason (SC3). | VERIFIED | `WidgetFilterBadge.tsx:65-66,70`: `title={buildBreakdownTitle(summary)}`. `buildBreakdownTitle` produces `Applied: {labels}\nIgnored (source excluded): {labels}`. Spec: "badge title attribute contains applied filter columns and ignored filter 'source excluded' reason" — title contains "Applied:", "Ignored", "source excluded". |
| 5 | The widget-filter-badge CSS class exists in global.css BEFORE the component uses it — theme-guard stays green (SC4). | VERIFIED | `global.css:2814`: `.widget-filter-badge {` (line 2814, after `.widget-filtering-badge` at 2800). Commit order: `17e506b` adds CSS + component together; plan spec says CSS added first (Step A before Step B). Spec asserts `expect(globalCss).toContain(".widget-filter-badge")`. Theme-guard: 132/132 green. |
| 6 | Spatial draws count toward M for spatial-capable table-bound widgets; dv-bound + non-spatial-capable widgets are column-only. | VERIFIED | `useFilterScopeSummary.ts:59,66`: `effShapes = spatialCapable ? activeShapes : []`; `totalCount = activeFilters.length + effShapes.length`. Spec tests cover: spatial-counted-in-M (test 4), spatial-excluded-from-M (test 5), non-spatial-capable (test 6), dv-bound (test 7). All 9 spec tests pass. |
| 7 | The MAP widget is never badged (deferred COMM-V2-02); the global top filter-bar is unchanged. | VERIFIED | `DashboardsPage.tsx:1118-1133`: `WidgetFilterBadge` is ONLY in the `: (` (non-map) branch; the `w.type === "map"` true-branch renders only `MapFilteringBadge`. Phase 95 commits touch zero filter-bar files (confirmed by `git show --name-only`). |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/lib/useFilterScopeSummary.ts` | Pure computeFilterScopeSummary fn + thin useFilterScopeSummary hook | VERIFIED | 116 lines; imports `resolveFilterSet` + `resolveSpatialShapes`; exports both fn and hook; no filterCombinationStore import |
| `packages/web/src/lib/useFilterScopeSummary.spec.ts` | 9 unit tests covering all behavior cases | VERIFIED | 211 lines; 9 tests covering accept-all, allowlist-exclude, object identity, spatial-in-M, spatial-excluded, non-spatial-capable, dv-bound, empty, no-mutation; all pass |
| `packages/web/src/components/WidgetFilterBadge.tsx` | Header badge: renders null unless appliedCount<totalCount; "{N} of {M} filters" + title-attr breakdown | VERIFIED | 77 lines; null guard at line 63; text at line 74; `className="widget-filter-badge"`; `title={buildBreakdownTitle(summary)}`; `buildBreakdownTitle` co-located |
| `packages/web/src/components/WidgetFilterBadge.spec.tsx` | 6 render tests + CSS-before-use guard | VERIFIED | 106 lines; 6 tests: null (accept-all), null (0-of-0), "2 of 3 filters" text, className, title/source-excluded, global.css contains class; all pass |
| `packages/web/src/styles/global.css` | .widget-filter-badge rule (theme tokens only) | VERIFIED | Rule at line 2814; uses var(--accent), var(--accent-text), var(--radius-sm), var(--text-sm), var(--space-2), var(--font-weight-medium); no raw hex |
| `packages/web/src/components/DashboardsPage.tsx` | WidgetFilterBadge mounted in widget-header for non-map widgets | VERIFIED | `WidgetFilterBadge` imported at line 63; rendered at line 1123 inside non-map branch; `spatialCapable` derived from existing `targetsByTable` useMemo (line 586) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `WidgetFilterBadge.tsx` | `useFilterScopeSummary.ts` | `useFilterScopeSummary` hook call | WIRED | `import { useFilterScopeSummary }` at line 14; called at line 60 |
| `useFilterScopeSummary.ts` | `resolveFilterSet.ts` + `resolveSpatialShapes.ts` | import + call | WIRED | Lines 16-17: both resolvers imported; called at lines 53 + 60 |
| `DashboardsPage.tsx` | `WidgetFilterBadge.tsx` | rendered in widget-header non-map branch | WIRED | Import at line 63; mounted at line 1123-1131 with cfg, tableId, dynamicViewId, spatialCapable props; strictly inside `: (` non-map branch |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| COMM-V118-01 | 95-01-PLAN.md | On-widget "N of M filters" badge shown only when ≥1 active filter is being ignored; hover breakdown of applied/ignored filters; global filter-bar unchanged | SATISFIED | All 7 truths verified; 3 specs passing (useFilterScopeSummary: 9 tests, WidgetFilterBadge: 6 tests, DashboardsPage: 2 integration tests); tsc clean; theme-guard green; zero server diff |

---

### Anti-Patterns Found

No blockers or stubs found.

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `packages/web/src/components/WidgetFilterBadge.tsx` | `return null` at line 63 | Info | Intentional — this IS the SC1 null-guard; not a stub |
| Full vitest run | 9 unhandled errors from `InfoCardRenderer.spec.tsx` | Info | Pre-existing TD-V16-TEST-ISOLATION cross-contamination (401 from auth store bleed); `InfoCardRenderer.spec.tsx` passes in isolation (12/12); not caused by Phase 95 |

---

### Test Gate Results

| Gate | Result |
|------|--------|
| `cd packages/web && npx tsc --noEmit` | CLEAN (no output) |
| `cd packages/web && npx vitest run` | 129/129 test files pass, 2968 tests pass; 9 unhandled errors are pre-existing TD-V16-TEST-ISOLATION (InfoCardRenderer cross-contamination, passes in isolation) |
| `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` | 132/132 PASS |
| `cd packages/web && npx vitest run src/lib/useFilterScopeSummary.spec.ts` | 9/9 PASS |
| `cd packages/web && npx vitest run src/components/WidgetFilterBadge.spec.tsx` | 6/6 PASS |
| `cd packages/web && npx vitest run src/components/DashboardsPage.spec.tsx` | 45/45 PASS (includes 2 Phase 95 integration assertions) |
| `git diff --name-only packages/server` | EMPTY — zero server diff |
| Phase 95 commits touch `package.json` | None — no new dependencies |

---

### Human Verification Required

#### 1. Badge visual appearance

**Test:** Open a dashboard where one chart widget has a `filterSelection` allowlist that excludes at least one active filter's source widget. Observe the widget header.
**Expected:** An accent-colored pill reading "N of M filters" appears in the widget header next to the title. Hovering the pill shows a native browser tooltip with "Applied: {columns}" and "Ignored (source excluded): {columns}".
**Why human:** CSS layout, accent color rendering, and browser tooltip display cannot be verified by automated tests.

#### 2. Accept-all badge absence

**Test:** On the same dashboard, observe a widget that uses the default accept-all config (no filterSelection set).
**Expected:** No badge appears — the widget header is byte-identical to v1.17.
**Why human:** Visual regression of "nothing renders" requires a live browser to confirm there is no ghost element, spacing artifact, or invisible DOM node.

---

### Gaps Summary

No gaps. All automated gates pass, all 7 must-have truths are verified against actual code, both resolvers are reused (not reimplemented), the map exclusion is correctly implemented, the global filter-bar is untouched, and COMM-V118-01 is satisfied. Two human-verification items remain for the live UAT walk (Phase 96).

---

_Verified: 2026-06-29T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
