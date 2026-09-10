---
phase: 65-calendar-sql-builder-kinetica-spike
plan: 01
subsystem: web/lib
tags: [calendar, sql-builder, tdd, pure-lib, utc, date-trunc]
dependency_graph:
  requires: []
  provides:
    - packages/web/src/lib/calendarBin.ts
    - packages/web/src/lib/buildCalendarSql.ts
  affects:
    - Phase 66 (CalendarConfigPanel imports VALID_DOMAIN_SUBDOMAIN + isValidCombo)
    - Phase 67 (CalendarRenderer imports buildCalendarSql + computeCellBounds)
    - Phase 68 (cell-drill passes computeCellBounds output to whereClause BETWEEN)
tech_stack:
  added: []
  patterns:
    - TDD (RED spec → GREEN impl, two separate commits per task)
    - Pure TypeScript modules (zero React/Zustand/Recharts)
    - UTC-only date arithmetic (Date.UTC / getUTC* / toISOString)
    - Alias-based GROUP BY (Kinetica pattern, mirrors buildTimelineSql.ts)
    - Pre-resolved fromTarget (no first-FROM regex swap — ARCHITECTURE Anti-Patterns)
key_files:
  created:
    - packages/web/src/lib/calendarBin.ts
    - packages/web/src/lib/calendarBin.spec.ts
    - packages/web/src/lib/buildCalendarSql.ts
    - packages/web/src/lib/buildCalendarSql.spec.ts
  modified: []
decisions:
  - "computeCellBounds ISO output format = Date.prototype.toISOString() — YYYY-MM-DDTHH:mm:ss.SSSZ; compatible with whereClause.ts BETWEEN datetime branch (single-quote-safe, no embedded quotes)"
  - "Month rollover via Date.UTC(y, mo+1, 1) — not a fixed-ms offset; JS normalizes mo+1=12 to Jan y+1 automatically (handles Dec→Jan)"
  - "Week start = Monday (ISO): offset = (getUTCDay() + 6) % 7; documented assumption — Plan 65-02 confirms against live Kinetica instance"
  - "buildCalendarSql leaves valid-combo validation to the config panel (Phase 66); the builder is unconstrained to allow future combos without changing SQL logic"
  - "fromSwap banned from buildCalendarSql — pre-resolved fromTarget passed in; same pattern as buildTimelineSql"
metrics:
  duration: ~6min (319 seconds)
  completed: 2026-06-16
  tasks_completed: 2
  files_created: 4
  tests_added: 44
  test_total_after: 2185
---

# Phase 65 Plan 01: Calendar SQL Builder — calendarBin + buildCalendarSql Summary

Pure calendar foundation library for the v1.13 Calendar Heatmap: `computeCellBounds` (UTC-only, cellEnd=nextBucketStart−1ms, covering hour/day/week/month/leap/DST) + `buildCalendarSql` (two-level DATE_TRUNC aggregation with pre-resolved fromTarget, alias-based GROUP BY, CELL_LIMIT cap).

## What Was Built

### calendarBin.ts

Exports the complete calendar bucketing foundation:

- `CalendarDomain` / `CalendarSubdomain` types
- `KINETICA_DATE_TRUNC_UNITS` — `["year","month","week","day","hour"]` (documented assumption; Plan 65-02 confirms)
- `VALID_DOMAIN_SUBDOMAIN` — 8 valid combos: year×{month,week,day}, month×{week,day}, week×{day,hour}, day×hour
- `isValidCombo(domain, subdomain): boolean` — predicate for config-panel validation
- `CELL_LIMIT = 10000` — safety cap consumed by buildCalendarSql
- `computeCellBounds(dateIso, subdomainUnit): [cellStartIso, cellEndIso]` — UTC-only, cellEnd = nextBucketStart − 1ms

**computeCellBounds implementation details:**
- UTC arithmetic only: `Date.UTC` / `getUTC*` / `toISOString` — no local-time constructors or getters
- Month rollover: `Date.UTC(y, mo+1, 1)` — JS normalizes December+1 to January of next year correctly
- Week start: Monday/ISO (`offset = (getUTCDay() + 6) % 7`); documented assumption flagged for Plan 65-02 confirmation
- Output format: `YYYY-MM-DDTHH:mm:ss.SSSZ` (Date.prototype.toISOString) — single-quote-safe, compatible with whereClause.ts BETWEEN datetime branch

### buildCalendarSql.ts

Exports the two-level DATE_TRUNC aggregation SQL builder:

- `BuildCalendarSqlArgs` type — fromTarget (pre-resolved), timeCol, metricColumn, aggregation, domain, subdomain, limit?
- `buildCalendarSql(args): string` — emits the pivot SQL:
  ```
  SELECT DATE_TRUNC('<domain>', <timeCol>) AS domain_bucket,
         DATE_TRUNC('<subdomain>', <timeCol>) AS subdomain_bucket,
         <AGG>(<metric>) AS value
  FROM <fromTarget>
  WHERE <timeCol> IS NOT NULL
  GROUP BY domain_bucket, subdomain_bucket
  ORDER BY domain_bucket ASC, subdomain_bucket ASC
  LIMIT <limit ?? CELL_LIMIT>
  ```
- COUNT_DISTINCT → `COUNT(DISTINCT col)` (Kinetica-correct)
- GROUP BY uses the computed-column aliases (Kinetica alias-GROUP-BY pattern)
- No fromSwap — fromTarget is pre-resolved by the caller to avoid first-FROM regex clobber

## Test Coverage (44 new tests)

**calendarBin.spec.ts (32 tests):**
- KINETICA_DATE_TRUNC_UNITS shape + CELL_LIMIT value
- VALID_DOMAIN_SUBDOMAIN per-domain arrays
- isValidCombo: all 8 valid combos true; 7 invalid/reverse combos false
- computeCellBounds:
  - `hour`: truncates to start of hour, end = HH:59:59.999Z
  - `day`: UTC midnight start, end = 23:59:59.999Z
  - `month` Feb leap 2024: end = 2024-02-29T23:59:59.999Z (NOT Feb 28)
  - `month` Feb non-leap 2023: end = 2023-02-28T23:59:59.999Z
  - `day` year-end Dec 31 2024: end = 2024-12-31T23:59:59.999Z
  - `month` Dec 2024: end = 2024-12-31T23:59:59.999Z (next=2025-01-01 − 1ms)
  - `week` ISO Mon anchor (2024-01-01): start = 2024-01-01, end = 2024-01-07T23:59:59.999Z
  - `week` 7-day span verification
  - DST-immunity: 2024-03-10T05:00:00.000Z (US/Eastern spring-forward night) → UTC-correct [00:00, 23:59:59.999]
  - DST: hour on DST night = exactly 3_600_000ms

**buildCalendarSql.spec.ts (12 tests):**
- Exact full-string match (month×day, SUM)
- Two DATE_TRUNC calls verified
- COUNT_DISTINCT → COUNT(DISTINCT col) shape; NOT COUNT_DISTINCT(col)
- COUNT(*) for wildcard column
- DV-bound fromTarget (bare view name, no leading dot)
- WHERE timeCol IS NOT NULL always present
- GROUP BY uses aliases (not DATE_TRUNC expressions)
- ORDER BY domain_bucket ASC, subdomain_bucket ASC
- LIMIT 10000 (CELL_LIMIT) by default
- Custom limit overrides CELL_LIMIT
- MIN aggregation
- week×hour combo

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run src/lib/calendarBin.spec.ts src/lib/buildCalendarSql.spec.ts` | 44/44 passed |
| `npx vitest run` (full suite) | 2185/2185 passed (baseline 2141 + 44 new) |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `git diff --name-only -- packages/server` | EMPTY (no server diff) |
| `git diff --name-only -- packages/web/src/components` | EMPTY (no components diff) |

## Exported Names for Downstream Phases

Downstream phases import from `./calendarBin` and `./buildCalendarSql`:

```typescript
// From calendarBin:
import type { CalendarDomain, CalendarSubdomain } from "./calendarBin";
import {
  KINETICA_DATE_TRUNC_UNITS,
  VALID_DOMAIN_SUBDOMAIN,
  isValidCombo,
  CELL_LIMIT,
  computeCellBounds,
} from "./calendarBin";

// From buildCalendarSql:
import { buildCalendarSql } from "./buildCalendarSql";
import type { BuildCalendarSqlArgs } from "./buildCalendarSql";
```

## Locked Decisions

1. **ISO output format:** `YYYY-MM-DDTHH:mm:ss.SSSZ` (toISOString) — locked; whereClause BETWEEN-datetime branch accepts this verbatim; single-quote-safe.

2. **Week start day:** Monday (ISO). Encoded as `offset = (getUTCDay() + 6) % 7`. **Flagged for Plan 65-02 confirmation** against the live Kinetica instance — if Kinetica DATE_TRUNC('week') uses Sunday, the offset formula must change to `(getUTCDay() + 7) % 7` (i.e., no offset adjustment).

3. **Month rollover:** `Date.UTC(y, mo+1, 1)` — not a fixed-ms offset. This handles Dec→Jan, Feb leap/non-leap, and 28/29/30/31-day months correctly.

4. **Combo validation placement:** buildCalendarSql does NOT validate isValidCombo — left to Phase 66 CalendarConfigPanel at config-save. The builder is intentionally unconstrained to allow future combos without SQL logic changes.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/web/src/lib/calendarBin.ts | FOUND |
| packages/web/src/lib/calendarBin.spec.ts | FOUND |
| packages/web/src/lib/buildCalendarSql.ts | FOUND |
| packages/web/src/lib/buildCalendarSql.spec.ts | FOUND |
| commit e0a1ea3 (Task 1) | FOUND |
| commit 80f6111 (Task 2) | FOUND |
