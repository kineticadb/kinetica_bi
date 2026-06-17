### Phase 68.2: Calendar week-anchor spike + per-group date-range gap-fill (INSERTED)

**Goal:** Fix the calendar gap-fill so each domain group only shows the time slices within its own range (no global cross-fill that gives a week×day group phantom month-shaped columns) — in-range gaps grey, out-of-range slots blank — and verify/align the visual week anchor (`WEEK_START`) to the live Kinetica `DATE_TRUNC('week')` anchor (the NOT-RUN Phase 65 spike). Must land before Phase 69.
**Requirements**: CALUX-V113-03
**Depends on:** Phase 68.1
**Plans:** 3/3 plans complete

Plans:
- [ ] 68.2-01-PLAN.md — Pure `calendarBuckets.ts` per-group date-range bucket enumerator (TDD): `enumerateGroupBuckets(domainKey, domain, subdomain)` → in-range subdomain keys in "YYYY-MM-DD HH:mm:ss" UTC (week×day=7, month×day=28/29/30/31 incl. leap, year×month=12, day×hour=24, month/year×week, boundaries) [Wave 1]
- [ ] 68.2-02-PLAN.md — Live Kinetica `DATE_TRUNC('week')` anchor probe; set/confirm `WEEK_START` in `calendarLayout.ts` + clear the Phase-65 NOT-YET-VERIFIED annotation in `calendarBin.ts` — with the instance-unreachable fallback (record NOT-RUN, keep `WEEK_START=1`, re-flag Phase 69; never blocks the gap-fill fix) [Wave 1]
- [ ] 68.2-03-PLAN.md — Rewire `gapFillCalendar` to per-group (consumes `enumerateGroupBuckets`): in-range gaps grey, out-of-range blank, week×day single 7-row column; update the Phase-67 gapFill spec to per-group semantics + renderer call site + week×day/out-of-range/no-cross-fill renderer tests; preserve drill/highlight/gating/68.1 layout + no-materialize/no-hex invariants [Wave 2]
