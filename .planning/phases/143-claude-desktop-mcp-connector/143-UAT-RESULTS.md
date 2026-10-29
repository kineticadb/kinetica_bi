# Phase 143 UAT Results — Claude Desktop MCP Connector

Run in the operator's Claude Desktop (subscription, no API key) against Kinetica BI on localhost, real Kinetica, table `demo.nyctaxi`. Browser checks driven by Claude over CDP in the operator's signed-in Chrome.

## Spike UAT (2026-10-28 / 2026-10-29)

| # | Step | Result | Notes |
|---|------|--------|-------|
| 1 | Routes driven like Claude Desktop (browser e2e) | PASS | Dashboard 32: 7 adds, one rejected-then-repaired call, handoff shows "7 added", Keep + reload persisted, audit `kept` |
| 2 | Claude Desktop setup | PASS after fix | First try: "Invalid Kinetica credentials" — the config still had the README placeholders |
| 3 | Claude Desktop builds a dashboard | PASS | Info click did nothing on the heatmap: AI layers were saved with `info_enabled 0` (Phase 134 stub leftover). Fixed 2ae8a5b |
| 4 | Layout | PASS after fixes | Map was at the bottom and widgets were oversized → `placeFitBands` (2ae8a5b), then map beside KPIs (f5611dc) |
| 5 | Chart readability | PASS after fixes | Count axis showed dates (count of a timestamp used its date format); bar labels dropped; redundant legends (f5611dc); axis decimals, KPI currency (d592ecb) |
| 6 | Text widget | PASS after fixes | Not offered at first: Claude Desktop was still running the 09:35 connector (needs Cmd+Q). Findings were stuffed into titles → instruction (35e752e). Summary too tall → width-aware refit (0961ef6) |
| 7 | KPI labels, 4 KPIs, timeline ticks | PASS after fixes | "Count of pickup_datetime" labels, a lone fourth KPI, "32000" ticks → fixed, map height matches its column |

Checked in dark mode throughout; the text widget also in light mode. Safety: a `<script>` line in the text rendered as text (no script element); links open with `noopener noreferrer`.

## Known limits (spike)

Password sign-in; new dashboards only; adds only; no filters; an unkept or never-opened dashboard stays behind; Keep needs `AI_ENABLED`; the audit records Keep only, under the in-app kind. These are Phase 143 items 1-6.
