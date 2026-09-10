---
phase: 67-svg-calendar-renderer-read-only
plan: "01"
subsystem: frontend-lib
tags: [calendar, color-scale, gap-fill, tdd, pure-lib]
dependency_graph:
  requires: [65-01, 66-01]
  provides: [calendarColorScale, calendarGapFill, chartColors.emptyCell]
  affects: [67-02-CalendarRenderer]
tech_stack:
  added: []
  patterns: [TDD-RED-GREEN, pure-lib, 5-bucket-quantize, 2D-gap-fill]
key_files:
  created:
    - packages/web/src/lib/calendarColorScale.ts
    - packages/web/src/lib/calendarColorScale.spec.ts
    - packages/web/src/lib/calendarGapFill.ts
    - packages/web/src/lib/calendarGapFill.spec.ts
  modified:
    - packages/web/src/lib/chartColors.ts
decisions:
  - "toCssColor helper replicated inside calendarColorScale.ts (not imported from TimelineRenderer) — keeps lib pure and avoids circular dependency"
  - "emptyCell token matches the existing grid token on both themes — '#e2e8f0' light / '#1f2937' dark"
  - "gapFillCalendar exposes cellAt(d, s) helper for O(1) lookup by Phase-68 click guard"
metrics:
  duration: "4 minutes"
  completed: "2026-06-16"
  tasks: 3
  files: 5
---

# Phase 67 Plan 01: Calendar Color Scale + Gap-Fill Pure Libs Summary

**One-liner:** 5-bucket linear quantize + 2D gap-fill foundations for SVG CalendarRenderer via TDD (computeDomain / quantizeToBucket / calendarBucketColors / gapFillCalendar / emptyCell token).

## Tasks Completed

| Task | Name | Commits | Result |
|------|------|---------|--------|
| 1 | calendarColorScale.ts — TDD | ae92f3d (RED), 124b29d (GREEN) | 21 tests pass |
| 2 | calendarGapFill.ts — TDD | 342e1b7 (RED), e608e57 (GREEN) | 13 tests pass |
| 3 | Extend useChartAxisColors with emptyCell | d57a334 | tsc clean, 0 regressions |

## Exported Signatures (for Plan 67-02 composer)

### calendarColorScale.ts

```typescript
export const CALENDAR_BUCKET_COUNT = 5;

// Returns null if data has no finite numeric values (caller shows "no data")
// Returns [min, max] including degenerate [v, v]
export function computeDomain(
  data: { value: number | null | undefined }[]
): [number, number] | null;

// Maps value to bucket index 0..count-1 over linear [min,max] domain
// Degenerate domain (max === min) always returns 0
// Clamps out-of-range values to [0, count-1]
export function quantizeToBucket(
  value: number,
  domain: [number, number],
  count: number
): number;

// Resolves 5 "#rrggbb" strings from getCbColorTheme(themeId)
// Falls back to "Greens" if themeId is unknown — never throws
export function calendarBucketColors(themeId: string): string[];
```

### calendarGapFill.ts

```typescript
export type CalendarCell = {
  domainKey: string;
  subdomainKey: string;
  value: number | null;
};

export type CalendarRow = {
  domainKey: string;
  cells: CalendarCell[];
};

// Input: populated { domain_bucket, subdomain_bucket, value }[] from buildCalendarSql decode
// Output: dense 2D grid with null for all missing (domain×subdomain) positions
export function gapFillCalendar(
  rows: { domain_bucket: string; subdomain_bucket: string; value: number | null }[]
): {
  domainKeys: string[];       // sorted ascending — columns left→right
  subdomainKeys: string[];    // sorted ascending — cells top→bottom within column
  rows: CalendarRow[];        // dense grid, one CalendarRow per domainKey
  cellAt: (d: string, s: string) => number | null;  // O(1) lookup for click guard + tooltips
};
```

### chartColors.ts (modified)

```typescript
export type ChartAxisColors = { grid: string; axis: string; emptyCell: string };

// emptyCell:
//   light → "#e2e8f0"  (slate-200, matches light grid token)
//   dark  → "#1f2937"  (matches dark grid token)
export function useChartAxisColors(): ChartAxisColors;
```

## Usage Pattern for Plan 67-02

```typescript
// In CalendarRenderer.tsx:
const { emptyCell } = useChartAxisColors();
const domain = useMemo(() => computeDomain(data), [data]);
const colors = useMemo(() => calendarBucketColors(config.colorTheme), [config.colorTheme]);
const grid = useMemo(() => gapFillCalendar(data), [data]);

// Per cell:
const fill = cell.value === null
  ? emptyCell
  : colors[quantizeToBucket(cell.value, domain!, CALENDAR_BUCKET_COUNT)];
```

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx vitest run src/lib/calendarColorScale.spec.ts` — 21 tests pass (GREEN)
- `npx vitest run src/lib/calendarGapFill.spec.ts` — 13 tests pass (GREEN)
- `npx tsc --noEmit` — clean
- `npx vitest run src/styles/theme-guard.spec.ts` — 49 tests pass (no new component files)
- Both lib modules are pure: grep confirms no `import.*react` or `import.*store`

## Self-Check: PASSED

- FOUND: calendarColorScale.ts
- FOUND: calendarColorScale.spec.ts
- FOUND: calendarGapFill.ts
- FOUND: calendarGapFill.spec.ts
- FOUND commit ae92f3d (RED calendarColorScale)
- FOUND commit 124b29d (GREEN calendarColorScale)
- FOUND commit 342e1b7 (RED calendarGapFill)
- FOUND commit e608e57 (GREEN calendarGapFill)
- FOUND commit d57a334 (chartColors emptyCell)
