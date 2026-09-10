---
phase: 65-calendar-sql-builder-kinetica-spike
plan: 02
subsystem: web/lib
tags: [calendar, kinetica-spike, date-trunc, NOT-RUN, phase-69-uat, CAL-V113-03]
dependency_graph:
  requires:
    - packages/web/src/lib/calendarBin.ts (65-01)
  provides:
    - .planning/phases/65-calendar-sql-builder-kinetica-spike/65-02-SUMMARY.md (NOT-RUN record + exact queries)
  affects:
    - Phase 69 UAT (CAL-V113-03) — must run these queries during live walk-through
tech_stack:
  added: []
  patterns:
    - NOT-RUN fallback (documented assumption, Phase 69 UAT flag)
key_files:
  created:
    - .planning/phases/65-calendar-sql-builder-kinetica-spike/65-02-SUMMARY.md
  modified:
    - packages/web/src/lib/calendarBin.ts (KINETICA_DATE_TRUNC_UNITS comment annotated NOT-YET-VERIFIED)
decisions:
  - "Spike recorded as NOT-RUN: /api/sql on localhost:4000 is gated by requireConfig + session auth (POST /api/auth/login with live Kinetica credentials); reading packages/server/.env is security-prohibited; assumption (UTC; Monday/ISO week) remains in place pending Phase 69 UAT"
  - "KINETICA_DATE_TRUNC_UNITS annotated with NOT YET VERIFIED + FLAGGED for Phase 69 UAT (CAL-V113-03)"
metrics:
  duration: ~3min
  completed: 2026-06-16
  tasks_completed: 1
  files_created: 1
  files_modified: 1
  tests_added: 0
  test_total_after: 2185
---

# Phase 65 Plan 02: Kinetica DATE_TRUNC Spike — NOT-RUN Record

Spike could not execute against the live Kinetica instance. The assumptions from Plan 65-01
(UTC bucketing; Monday/ISO week start) remain in place as documented assumptions, now explicitly
flagged for Phase 69 UAT verification.

## Spike Status: NOT-RUN

**Reason:** The `POST /api/sql` route on `localhost:4000` is gated by:
1. `requireConfig` — checks `KINETICA_URL` env var is present (PASSES; server is running)
2. `requireAuth` — requires a valid session established via `POST /api/auth/login` with
   live Kinetica password credentials

The executor cannot obtain a valid session without reading `packages/server/.env` (which
contains the Kinetica username/password). Reading, printing, or surfacing `.env` secrets
is security-prohibited per the plan's explicit constraint.

The dev server was confirmed running (`GET http://localhost:4000/api/health` → 200 OK).
The barrier is session authentication, not server availability.

## Exact Queries for Phase 69 UAT

Run these queries via `POST /api/sql` (or directly in the Kinetica Web UI) during the
Phase 69 live operator walk-through to verify the assumptions baked into `calendarBin.ts`.

### Query A — Week Anchor (Jan 1 2024 is a Monday)

```sql
SELECT DATE_TRUNC('week', TIMESTAMP '2024-01-01 00:00:00') AS wk
```

**Expected (Monday/ISO assumption):** `2024-01-01 00:00:00.000` (or `2024-01-01T00:00:00.000Z`)

- If result = `2024-01-01` → week starts **Monday** (ISO) — assumption confirmed, no code change.
- If result = `2023-12-31` → week starts **Sunday** — the week-offset formula in
  `computeCellBounds` must change from `(getUTCDay() + 6) % 7` to `(getUTCDay() + 7) % 7`
  (effectively `getUTCDay()`, treating Sun=0 as anchor), AND `calendarBin.spec.ts` week-case
  expected values must be updated accordingly.
- If any other value → record exactly what came back.

### Query B — Per-Unit Validity

```sql
SELECT DATE_TRUNC('hour',  TIMESTAMP '2024-03-15 13:45:30') AS h
```
```sql
SELECT DATE_TRUNC('day',   TIMESTAMP '2024-03-15 13:45:30') AS d
```
```sql
SELECT DATE_TRUNC('week',  TIMESTAMP '2024-03-15 13:45:30') AS w
```
```sql
SELECT DATE_TRUNC('month', TIMESTAMP '2024-03-15 13:45:30') AS mo
```
```sql
SELECT DATE_TRUNC('year',  TIMESTAMP '2024-03-15 13:45:30') AS y
```

Record: `VALID` (non-NULL row returned) or `ERROR` (SQL error / all-NULL) for each unit.
If any unit in `KINETICA_DATE_TRUNC_UNITS` (`['year','month','week','day','hour']`) returns
ERROR, remove it from the constant and update downstream SQL builders + specs.

### Query C — Quarter Availability (v2/out-of-scope, informational only)

```sql
SELECT DATE_TRUNC('quarter', TIMESTAMP '2024-03-15 13:45:30') AS q
```

Record `VALID` or `ERROR`. Do NOT add `'quarter'` to `KINETICA_DATE_TRUNC_UNITS` regardless
of outcome — out of v1.13 scope; note the result here for future phases.

### Query D — UTC Behavior + Returned Format

```sql
SELECT DATE_TRUNC('day', TIMESTAMP '2024-03-15 13:45:30') AS d
```

Record the **exact returned string format** (e.g. `"2024-03-15 00:00:00.000"` or
`"2024-03-15T00:00:00.000Z"`). This determines:
- Whether Phase 67's label parser needs to strip a 'T' or 'Z'
- Whether Phase 68's drill bounds from `computeCellBounds` (which returns ISO 8601 with 'Z')
  need conversion before being passed to the Kinetica BETWEEN clause

Confirm no implicit timezone conversion occurs (value should be `2024-03-15 00:00:00.000`,
NOT an offset-adjusted local time).

## Documented Assumptions (in force until Phase 69 confirms/corrects)

| Assumption | Where encoded | Risk if wrong |
|------------|---------------|---------------|
| DATE_TRUNC units `year, month, week, day, hour` are all valid | `KINETICA_DATE_TRUNC_UNITS` in `calendarBin.ts` | If a unit returns NULL/error, buildCalendarSql emits invalid SQL silently |
| Week starts **Monday** (ISO) | `computeCellBounds` case `week`: `offset = (getUTCDay() + 6) % 7` | Cell bounds off by ±1 day; week drill-down returns adjacent bucket |
| Returned timestamp is UTC, no tz conversion | `computeCellBounds` output format `YYYY-MM-DDTHH:mm:ss.SSSZ` | Phase 68 BETWEEN bounds could miss rows if Kinetica returns local time |

## Phase 69 UAT Verification Item

**CAL-V113-03 — DATE_TRUNC spike verification (NOT-RUN in Phase 65-02)**

During the Phase 69 live operator walk-through, run the four queries above (A–D) against
the live Kinetica instance via the authenticated `/api/sql` endpoint (or Kinetica Web UI).

Record the results in the Phase 69 UAT document and, if any assumption is incorrect:
1. Update `KINETICA_DATE_TRUNC_UNITS` (remove invalid units)
2. Fix `computeCellBounds` week-offset formula (if Sunday start)
3. Update `calendarBin.spec.ts` week-case expected values
4. Run `cd packages/web && npx vitest run src/lib/calendarBin.spec.ts` to confirm green
5. Update the `KINETICA_DATE_TRUNC_UNITS` comment from NOT-YET-VERIFIED to CONFIRMED
   with the date and actual week anchor

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run src/lib/calendarBin.spec.ts` | 32/32 passed |
| `npx vitest run` (full suite) | 2185/2185 passed |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `git diff --name-only -- packages/server` | EMPTY |
| `git diff --name-only -- packages/web/src/components` | EMPTY |
| `packages/server/.env` read/printed/committed | NEVER |

## Deviations from Plan

**[NOT-RUN FALLBACK INVOKED — as specified in the plan]**

The plan explicitly specifies a FALLBACK PATH when Kinetica is genuinely unreachable or
authentication is blocked. This fallback was triggered:

- **Attempted:** `curl -s -X POST http://localhost:4000/api/sql` → `{"error":"Authentication required.","code":"REAUTH_REQUIRED"}`
- **Barrier:** Session auth requires `POST /api/auth/login` with Kinetica password credentials from `packages/server/.env`
- **Security constraint:** Reading `.env` is explicitly prohibited by the plan ("DO NOT read, print, echo, cat, or commit `packages/server/.env`")
- **Fallback executed:** Per plan specification — NOT-RUN record in SUMMARY, calendarBin.ts annotated, Phase 69 UAT item added

This is the expected and documented outcome, not a deviation from plan intent.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `.planning/phases/65-calendar-sql-builder-kinetica-spike/65-02-SUMMARY.md` | CREATED |
| `packages/web/src/lib/calendarBin.ts` KINETICA_DATE_TRUNC_UNITS annotated | CONFIRMED |
| `grep -Eqi "NOT YET VERIFIED" packages/web/src/lib/calendarBin.ts` | PASSES |
| `grep -Eqi "Phase 69" packages/web/src/lib/calendarBin.ts` | PASSES |
| `grep -q "DATE_TRUNC" 65-02-SUMMARY.md` | PASSES |
| `grep -Eqi "week.*(Monday|anchor)" 65-02-SUMMARY.md` | PASSES |
| commit 6282734 (Task 1 — annotation + REQUIREMENTS.md) | FOUND |
