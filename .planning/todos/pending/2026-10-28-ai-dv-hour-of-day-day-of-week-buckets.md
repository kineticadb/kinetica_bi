---
created: 2026-10-28T12:00:00.000Z
title: Let AI dynamic views group by hour of day / day of week
area: ai
files:
  - packages/shared/src/aiDynamicView.ts
  - packages/server/src/lib/aiDvCompile.ts
  - packages/server/src/lib/ai/tools/mutate.ts
---

## Problem

Found in the Phase 142 Gemini UAT, day 4 (audit rows 43 and 49). "Average tip by hour" and even "average tip by hour of day" both produced `groupBy … bucket: "hour"`, which compiles to `DATE_TRUNC('hour', col)`: one group per calendar hour (10,847 on demo.nyctaxi), so the line/bar shows "Showing 100 of 10,847 categories" of non-consecutive hours. `AI_DV_BUCKETS` only has truncating buckets (minute..year); there is no way to extract a part of a timestamp, so the model picked the closest option. Its own follow-up chip "Compare average tips by day of the week" hits the same gap.

## Solution

Add extracting buckets alongside the truncating ones, e.g. `hour_of_day` (0-23), `day_of_week`, possibly `month_of_year`, compiled to Kinetica's extract functions (confirm names on 7.2.3.12: HOUR(), DAYOFWEEK()/DAY_OF_WEEK, MONTH()) and only allowed on timestamp columns (`hour_of_day` not on DATE). Say in the `add_dynamic_view` description when to use extract vs truncate ("hour of day" vs "per hour over time"). Check: shared schema + compile specs red-first; the saved-dv template path (Keep) still round-trips; whether the change needs an allow-list/contract version note. Live check costs ~2 answers: "average tip by hour of day" -> 24 bars; "trips by day of week" -> 7.
