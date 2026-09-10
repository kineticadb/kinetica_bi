---
phase: 65-calendar-sql-builder-kinetica-spike
verified: 2026-06-16T00:30:00Z
status: passed
score: 7/7 must-haves verified
re_verification: false
---

# Phase 65: Calendar SQL Builder / Kinetica Spike Verification Report

**Phase Goal:** A pure, fully-tested SQL builder (`buildCalendarSql`) and cell-bounds helper (`computeCellBounds`) exist — with the Kinetica `DATE_TRUNC` unit set and `week` start-day anchor verified against a live instance (or explicitly documented NOT-RUN with Phase 69 UAT flag) — so all downstream phases build on a correct bucketing foundation.

**Verified:** 2026-06-16T00:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `buildCalendarSql` produces a two-level `DATE_TRUNC(domain,ts)` + `DATE_TRUNC(subdomain,ts)` + `AGG(metric) AS value` GROUP BY query, FROM pre-resolved, LIMIT cap, pivot columns | VERIFIED | 10 DATE_TRUNC occurrences in source; GROUP BY alias pattern; CELL_LIMIT wired; exact string test in spec |
| 2 | FROM target is pre-resolved before string construction — no `fromSwap`, no first-FROM regex | VERIFIED | `grep -qi "fromSwap" buildCalendarSql.ts` → 0 matches; `fromTarget` is a constructor param |
| 3 | `computeCellBounds(dateIso, subdomainUnit)` returns `[cellStartIso, cellEndIso]` where `cellEnd = nextBucketStart − 1ms`, UTC-only | VERIFIED | `nextBucketStartMs - 1` on line 150; all date arithmetic uses `Date.UTC`/`getUTC*`/`toISOString`; no local-time constructors |
| 4 | `computeCellBounds` passes month-end (leap Feb 2024-02-29, non-leap 2023-02-28), year-end (2024-12-31), week boundary, and DST-immunity tests | VERIFIED | All 5 boundary cases covered in `calendarBin.spec.ts`; 32 tests 32 passed |
| 5 | `VALID_DOMAIN_SUBDOMAIN` has exactly 8 combos (year×{month,week,day}, month×{week,day}, week×{day,hour}, day×hour) and is importable | VERIFIED | Record matches spec; `isValidCombo` tested for all 8 valid + 7 invalid combos |
| 6 | `KINETICA_DATE_TRUNC_UNITS` allow-list constant exists; spike is NOT-RUN with annotation + exact queries + Phase 69 UAT flag (not a silent assumption) | VERIFIED | Comment says "NOT YET VERIFIED... FLAGGED for Phase 69 UAT (CAL-V113-03)"; exact queries A–D recorded verbatim in 65-02-SUMMARY.md; `Phase 69 UAT Verification Item` section present |
| 7 | Pure-lib only — no renderer/config-panel/WidgetRenderer/server changes | VERIFIED | `git diff --name-only -- packages/server` EMPTY; `git diff --name-only -- packages/web/src/components` EMPTY |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/web/src/lib/calendarBin.ts` | VERIFIED | Exists, substantive (154 lines), exports all required symbols; imported by buildCalendarSql.ts and spec files |
| `packages/web/src/lib/calendarBin.spec.ts` | VERIFIED | Exists, 174 lines, 32 tests covering all required boundary cases |
| `packages/web/src/lib/buildCalendarSql.ts` | VERIFIED | Exists, 91 lines, exports `buildCalendarSql` and `BuildCalendarSqlArgs` |
| `packages/web/src/lib/buildCalendarSql.spec.ts` | VERIFIED | Exists, 189 lines, 12 tests including exact full-string assertion |
| `.planning/phases/65-calendar-sql-builder-kinetica-spike/65-02-SUMMARY.md` | VERIFIED | Exists, contains queries A–D verbatim, week anchor discussion, Phase 69 UAT section |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `buildCalendarSql.ts` | `calendarBin.ts` | `import { CELL_LIMIT }` + `import type { CalendarDomain, CalendarSubdomain }` | WIRED | Lines 17–18 of buildCalendarSql.ts |
| `buildCalendarSql.ts` | `timelineBin.ts` | `import type { TimelineAggregation }` | WIRED | Line 19 of buildCalendarSql.ts; enum reused, not redeclared |
| `65-02-SUMMARY.md` | `calendarBin.ts` | NOT-RUN outcome annotated into `KINETICA_DATE_TRUNC_UNITS` comment + week-anchor comment | WIRED | `NOT YET VERIFIED` + `FLAGGED for Phase 69 UAT (CAL-V113-03)` + 65-02-SUMMARY.md reference in the comment |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CAL-V113-03 | 65-01, 65-02 | Kinetica DATE_TRUNC unit set + week anchor verified (or NOT-RUN-documented) | SATISFIED (NOT-RUN path) | Annotation + exact queries + Phase 69 UAT item present; acceptable per phase goal criteria |

---

### Success Criterion Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC1: `buildCalendarSql` two-level `DATE_TRUNC`, FROM pre-resolved, LIMIT cap, pivot columns | PASSED | Source and spec verified; exact string test passes |
| SC2: `computeCellBounds` `[startIso, endIso]`, `cellEnd = nextBucketStart − 1ms`, UTC-only, all boundary tests | PASSED | Implementation and 32-test spec verified green |
| SC3: Kinetica spike — NOT-RUN acceptable outcome with annotation + exact queries + Phase 69 flag | PASSED | All four NOT-RUN conditions satisfied (see detailed check below) |
| SC4: Pure-lib only — no renderer/config-panel/WidgetRenderer/server changes | PASSED | Both diffs empty |

#### SC3 NOT-RUN Acceptable Outcome Checklist

- [x] Constant annotated `NOT-YET-VERIFIED` — `KINETICA_DATE_TRUNC_UNITS` comment line 39–45 of `calendarBin.ts`
- [x] Exact spike queries recorded verbatim in SUMMARY — Queries A (week anchor), B (per-unit), C (quarter), D (UTC format) all present in `65-02-SUMMARY.md`
- [x] Lib stays at documented UTC/Monday-guarded assumptions — no code changes to assumptions; only comment annotation
- [x] Explicit Phase 69 UAT item created — `## Phase 69 UAT Verification Item` section in `65-02-SUMMARY.md` with step-by-step remediation instructions

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No `TODO`/`FIXME`/placeholder comments found in the four new lib files. No stub implementations. No empty handlers. No `return null` / `return {}` stubs.

---

### Gates Run

| Gate | Command | Result |
|------|---------|--------|
| Calendar specs only | `cd packages/web && npx vitest run src/lib/calendarBin.spec.ts src/lib/buildCalendarSql.spec.ts` | 2 files, 44/44 passed |
| Full suite | `cd packages/web && npx vitest run` | 97 files, 2185/2185 passed — no regressions |
| TypeScript | `cd packages/web && npx tsc --noEmit -p tsconfig.json` | Exit 0 |
| Server diff | `git diff --name-only -- packages/server` | EMPTY |
| Components diff | `git diff --name-only -- packages/web/src/components` | EMPTY |

---

### Human Verification Required

None for automated checks. One item deferred to Phase 69 by design:

**DATE_TRUNC unit validation against live Kinetica instance (CAL-V113-03)**

- **Test:** Run queries A–D from `65-02-SUMMARY.md` via `POST /api/sql` (authenticated) or Kinetica Web UI against the live instance.
- **Expected:** All five units (`year`, `month`, `week`, `day`, `hour`) return valid non-NULL rows; week anchor returns `2024-01-01` (Monday). If Sunday anchor is returned, update `computeCellBounds` week-offset formula and spec expected values.
- **Why human:** Requires live Kinetica credentials from `packages/server/.env`; security-prohibited for automated executor; explicitly designed as Phase 69 UAT item.

---

### Spike Outcome Assessment

The NOT-RUN fallback was correctly invoked per the plan's documented FALLBACK PATH. Assessment:

- The plan explicitly anticipated and specified this outcome (FALLBACK PATH in 65-02 Task 1).
- The barrier was session auth (`requireAuth` on `/api/sql`), not server unavailability — confirmed by a `401 REAUTH_REQUIRED` response.
- All four NOT-RUN requirements from the phase goal's acceptable-outcome criteria are satisfied.
- The lib's documented Monday/ISO assumption is clearly labeled as unconfirmed and carries zero silent risk — the `KINETICA_DATE_TRUNC_UNITS` constant itself points readers to the SUMMARY and Phase 69.

**Verdict on spike:** NOT-RUN path handled correctly. No gap.

---

### Technical Notes

**UTC correctness of `computeCellBounds`:** Every `new Date(...)` call uses either a single-argument ISO string parse or a single-argument epoch ms value. The multi-argument local constructor `new Date(y, m, d)` (which would be timezone-sensitive) appears only in a prohibition comment (line 18) — never in runtime code. UTC getters (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCHours`, `getUTCDay`) are used exclusively.

**`whereClause.ts` compatibility:** `computeCellBounds` outputs `Date.prototype.toISOString()` format (`YYYY-MM-DDTHH:mm:ss.SSSZ`). The BETWEEN datetime branch at `whereClause.ts:124` wraps values in `escapeKineticaStringLiteral(String(v))` which doubles embedded single quotes. Since ISO 8601 strings contain no single quotes, the escape is a no-op — the ISO strings pass through unchanged. Format is fully compatible.

**`buildCalendarSql` FROM resolution:** The `fromTarget` parameter is the fully-resolved FROM string, accepted as-is. No post-construction regex swap occurs. The empty-schema (dv-bound) test confirms `"_kbi_dv_v1234"` passes through as `FROM _kbi_dv_v1234` with no leading dot or schema prefix added.

**Commits verified:** e0a1ea3 (calendarBin), 80f6111 (buildCalendarSql), 6282734 (NOT-RUN annotation) — all confirmed in git log.

---

_Verified: 2026-06-16T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
