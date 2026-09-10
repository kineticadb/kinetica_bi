---
phase: 67-svg-calendar-renderer-read-only
verified: 2026-06-16T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 67: SVG Calendar Renderer (Read-Only) Verification Report

**Phase Goal:** A calendar widget on a dashboard fetches its time-bucketed data, renders a correctly gap-filled domain/subdomain grid with color-scaled cells, empty-cell grey fill, time-axis labels, and per-cell hover tooltips — and automatically re-fetches when another widget applies a filter to the same table or dv. READ-ONLY (no cell click/drill — that is Phase 68).
**Verified:** 2026-06-16
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CalendarRenderer fetches via `runSql(buildCalendarSql(...))` with FROM target resolved via precedence (`fvViewName \|\| dvFilterViewName \|\| dvViewName \|\| "schema.table"`) BEFORE building SQL; `fromSwap()` NOT called inside CalendarRenderer | VERIFIED | Lines 162-252 of CalendarRenderer.tsx; `fromTarget` computed at lines 185-189 from store state before being passed to `buildCalendarSql`; no `fromSwap` import or call anywhere in the file |
| 2 | Missing/empty buckets render as muted/grey cells (client-side gap-fill via `useMemo`) — deleting rows produces grey cells, not collapsed neighbors | VERIFIED | `gapFillCalendar` called in `useMemo(() => gapFillCalendar(data), [data])` at line 256; empty cells rendered with `data-empty="true"` and `style={{ pointerEvents: "none" }}` (line 361); calendarGapFill.spec.ts has 13 tests confirming no neighbor collapse |
| 3 | All cell colors from chartTheme/cbColorThemes palette or CSS custom properties — no hardcoded hex; theme-guard.spec.ts passes with CalendarRenderer.tsx in scope | VERIFIED | `grep -n "#[0-9a-fA-F]"` returns NO_HARDCODED_HEX; colors sourced exclusively from `calendarBucketColors(colorTheme)` (cbColorThemes palette) and `useChartAxisColors()` (CSS custom properties); CalendarRenderer.tsx is NOT in theme-guard allowlist and has no hex literals |
| 4 | Color scale domain derived reactively: `useMemo(() => computeDomain(data), [data])` — applying/clearing a filter rescales the palette | VERIFIED | Exact string `useMemo(() => computeDomain(data), [data])` present at line 260 (confirmed by static grep in CalendarRenderer.spec.tsx Test 1); `colors` also reactive via `useMemo(() => calendarBucketColors(colorTheme), [colorTheme])` at line 262 |
| 5 | When `filterVersion` / `fvViewName` (or `dvFilterViewName`/`dvStatus`) changes, the calendar re-fetches and re-renders | VERIFIED | useEffect dep array (lines 236-252) includes `filterVersion`, `fvViewName`, `fvExpiresAt`, `fvMaterializing`, `dvFilterViewName`, `dvFilterMaterializing`, `dvViewName`, `dvStatus`; CalendarRenderer.spec.tsx Test 5 explicitly tests filterVersion bump causes re-fetch |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Role | Status | Details |
|----------|------|--------|---------|
| `src/components/charts/CalendarRenderer.tsx` | Main SVG calendar renderer (417 lines) | VERIFIED | Exists, substantive, imported and used in WidgetRenderer |
| `src/lib/calendarGapFill.ts` | 2D gap-fill pure module | VERIFIED | Exists, 113 lines, exported `gapFillCalendar` called from CalendarRenderer |
| `src/lib/calendarColorScale.ts` | Color domain + bucket quantize + palette resolver | VERIFIED | Exists, 87 lines, exports `computeDomain`, `quantizeToBucket`, `calendarBucketColors`, `CALENDAR_BUCKET_COUNT` — all used in CalendarRenderer |
| `src/components/charts/CalendarRenderer.spec.tsx` | 11-test spec (Tests 0-9) | VERIFIED | Exists, 326 lines; covers static invariant, reactive domain, fetch/grid, FROM-resolution (table + 2 DV paths), filterVersion re-fetch, gap-fill greys, no-data, config-incomplete, suspend-during-materializing |
| `src/lib/calendarGapFill.spec.ts` | 13-test spec for gap-fill pure module | VERIFIED | Exists, covers empty input, dense 2x2 from sparse, neighbor-collapse prevention, cellAt helper |
| `src/lib/calendarColorScale.spec.ts` | 21-test spec for color scale helpers | VERIFIED | Exists, covers computeDomain, quantizeToBucket, calendarBucketColors, CALENDAR_BUCKET_COUNT |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `WidgetRenderer.tsx` | `CalendarRenderer` | `import CalendarRenderer from "./CalendarRenderer"` at line 9 | WIRED | Calendar branch at lines 348-354, BEFORE `AggregatedWidgetRenderer` fallback at line 356 |
| `CalendarRenderer` | `runSql` + `buildCalendarSql` | `useEffect` fetch (lines 164-252) | WIRED | `buildCalendarSql({fromTarget, ...})` called at line 198; result passed directly to `runSql` at line 206 |
| `CalendarRenderer` | `gapFillCalendar` | `useMemo(() => gapFillCalendar(data), [data])` | WIRED | Line 256; result destructured and used for SVG layout at line 292 |
| `CalendarRenderer` | `computeDomain` + `calendarBucketColors` | `useMemo` calls | WIRED | Lines 260-262; `colorDomain` used in `quantizeToBucket` at line 367; `colors` used for cell fill and legend |
| `CalendarRenderer` | `useFilterStore` / `useFilterViewStore` / `useDynamicViewStore` | scoped selectors | WIRED | Lines 129-151; all values (`filterVersion`, `fvViewName`, `dvFilterViewName`, etc.) in useEffect dep array |

---

### Locked Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| CalendarRenderer does NOT import `materializeFilter`/`dropFilterView` | CONFIRMED | Import scan (lines 21-39): no such imports; CalendarRenderer.spec.tsx Test 0 statically asserts this |
| No `fromSwap` inside CalendarRenderer | CONFIRMED | `fromSwap` appears only in comments (lines 7, 18, 162), never imported or called |
| Read-only: no `setBulkFilters`/`addDvFilter`/`computeCellBounds`/cell-click in CalendarRenderer | CONFIRMED | grep returns no matches for these symbols; `onClick` absent from all `<rect>` elements; empty cells have `pointerEvents: "none"` |
| CalendarRenderer wired in WidgetRenderer BEFORE `AggregatedWidgetRenderer` fallback | CONFIRMED | `calendar` branch at line 348; `AggregatedWidgetRenderer` fallback at line 356 |

---

### Requirements Coverage

| Requirement | Description (abridged) | Phase 67 Scope | Status | Evidence |
|-------------|------------------------|----------------|--------|----------|
| CAL-V113-04 | Calendar renders domain/subdomain grid with color-scaled cells, grey gap-fill, time-axis labels, per-cell tooltip; no raw hex | Full delivery in Phase 67 | SATISFIED | CalendarRenderer.tsx fully implements; 11 spec tests + 13 gapFill + 21 colorScale tests pass |
| CAL-V113-05 | Filter-aware re-fetch (cap+defaults in Phase 66; re-fetch in Phase 67) | Re-fetch portion only | SATISFIED (re-fetch portion) | useEffect dep array includes `filterVersion`, `fvViewName`, `dvFilterViewName`, `dvStatus`; Test 5 covers filterVersion bump; combined with Phase 66 cap+defaults, requirement is now fully complete |

Note: REQUIREMENTS.md table still shows CAL-V113-05 as "Partial — cap done, re-fetch pending" (last updated before Phase 67 landed). The re-fetch portion is now delivered; the status entry should be updated to Complete. This is a documentation lag, not a code gap.

---

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments, empty implementations, or console-log-only handlers found in any Phase 67 files.

---

### Human Verification Required

**1. Visual calendar grid rendering**
**Test:** Open a dashboard with a configured calendar widget bound to a table with time-series data; confirm the SVG grid renders columns (domain) and rows (subdomain) with colored cells.
**Expected:** Cells with data show sequential color gradient (lighter = less, darker = more); missing time buckets appear as grey/muted tiles at their correct coordinate, not collapsed.
**Why human:** SVG visual layout and color gradient correctness require visual inspection.

**2. Hover tooltip content**
**Test:** Hover over a populated cell.
**Expected:** Native SVG `<title>` tooltip shows format: "{domain label} / {subdomain label} · {AGG}({metric}): {value}".
**Why human:** Tooltip rendering depends on browser native SVG title behavior; not testable in jsdom.

**3. Filter re-fetch end-to-end**
**Test:** Apply a filter from a sibling DataFilter widget on the same table; observe the calendar.
**Expected:** Calendar shows loading state briefly then re-renders with filtered data; color scale rescales to filtered data range.
**Why human:** Requires live backend + filter materialization pipeline; integration not covered by unit tests.

**4. Legend "Less → More" display**
**Test:** Inspect the legend row below the SVG.
**Expected:** "Less" label, 5 color swatches in ascending intensity, "More" label; colors match the configured ColorBrewer theme.
**Why human:** Legend color rendering is visual; spec only checks testid presence.

---

### Summary

Phase 67 delivers its full goal. All five success criteria are verified against the actual codebase:

1. FROM-target resolution happens in CalendarRenderer's own useEffect before `buildCalendarSql` is called — no `fromSwap`, no `materializeFilter`. The precedence chain (`fvViewName || dvFilterViewName || dvViewName || schema.table`) is implemented exactly as specified.

2. Gap-fill is a pure `useMemo` over `gapFillCalendar(data)` — the dense 2D grid always has a cell for every (domain, subdomain) coordinate; missing positions become `value: null` grey tiles with `pointerEvents: "none"`.

3. Zero hardcoded hex colors in CalendarRenderer.tsx — all colors flow through `calendarBucketColors` (cbColorThemes palette) or `useChartAxisColors` (CSS custom properties). theme-guard.spec.ts covers this file automatically.

4. Color domain is computed reactively with the exact `useMemo(() => computeDomain(data), [data])` pattern; domain rescales on every data change, including after filter application.

5. Filter-aware re-fetch (CAL-V113-05 re-fetch portion) is complete: useEffect dep array includes all filter-aware deps (`filterVersion`, `fvViewName`, `dvFilterViewName`, `dvStatus`, and their supporting gates). Combined with Phase 66's cap+defaults delivery, CAL-V113-05 is fully satisfied.

WidgetRenderer wires CalendarRenderer at line 348 — before the `AggregatedWidgetRenderer` fallback at line 356 — preserving the sole-materialize-trigger invariant.

Test suite confirmation (reported by orchestrator): 11 CalendarRenderer.spec.tsx tests, 21 calendarColorScale tests, 13 calendarGapFill tests, 84 WidgetRenderer tests, 50 theme-guard tests — all pass.

---

_Verified: 2026-06-16_
_Verifier: Claude (gsd-verifier)_
