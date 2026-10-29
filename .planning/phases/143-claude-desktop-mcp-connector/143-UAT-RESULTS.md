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

## Phase 143 items 1-6 (2026-10-29), checked by Claude in the operator's Chrome through the connector's routes

| # | Requirement | Result | Notes |
|---|-------------|--------|-------|
| 8 | AIMCP-V20-04 token sign-in | PASS | Profile > Claude Desktop: created a token (shown once, Copy config), token-login opened a session as admin, Revoke removed the token and its session (0 rows left). Light and dark. |
| 9 | AIMCP-V20-05 unkept builds | PASS | start creates an unkept dashboard; AI bar Discard -> "Discard this dashboard?" -> deleted (SQLite); Keep cleared generated_by/pending. |
| 10 | AIMCP-V20-06 audit kind | PASS | AI activity row: kind "Claude Desktop", question 'Built "..." in Claude Desktop', Claude's summary, tools and changes; survives the dashboard's deletion. Labels no longer carry stale first-fit positions. |
| 11 | AIMCP-V20-07 Keep without the in-app AI | PASS (specs) | Route specs with AI off and MCP on; the browser handoff/Keep have no AI-config gate. Not re-run live with AI off (a restart signs the operator out). |
| 12 | AIMCP-V20-08 edit a saved dashboard | PASS after fix | First run: the confirmed removal was skipped in the browser (needs_confirmation). Fix: the handoff records the approval. Second run: 1 added, 1 edited, 1 removed; kept. |
| 13 | AIMCP-V20-09 filters | PASS | apply_filter payment_type = Cash: AI-tagged chip, KPIs/pie/timeline narrowed; filter-only changes show no Keep bar (same as in-app). |

**Next:** the operator runs items 1-6 in Claude Desktop itself: create a token on the Profile page, put it in the config (`KBI_TOKEN`), quit and reopen Claude Desktop, then build, edit and filter.
