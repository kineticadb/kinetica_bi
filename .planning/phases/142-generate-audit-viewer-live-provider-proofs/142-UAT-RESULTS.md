# Phase 142 UAT Results

Provider under test: Gemini `gemini-3-flash-preview` (OpenAI-compatible, native tool calling), free tier, `AI_MAX_ANSWERS_PER_DAY=5`, `AI_TIMEOUT_MS=120000`, `AI_DATA_ACCESS=schema`.
Driven by Claude over CDP (playwright-core, Chrome 155 on 127.0.0.1:9333); operator signs in and edits `.env`.
Kinetica: 7.2.3.12 (as in 139-141).

## Gemini, day 1 (2026-10-23)

Setup notes:
- First restarts showed `model=Antigravity` (the `.env` edit was not saved), then `model=gemini-3-flash-preview (this replaces Antigravity)` (a note pasted into the value) and `key=not set`. Both fixed by the operator. **Follow-up (minor):** the server accepts an `AI_MODEL` containing spaces/brackets without a warning.
- Two generations (audit rows 16, 17) failed in 0.4 s with HTTP 400. Temporary server logging (removed, never committed) showed Gemini's body: `"Please pass a valid API key", status INVALID_ARGUMENT`. The `.env` key was not saved; fixed by the operator. **Defect (open):** Gemini reports a bad key as 400, so the user sees the generic "The AI provider could not complete this answer. Try again." and the audit records `bad_request`, not `auth`.
- Those two failures counted toward the day cap (5), leaving 2 answers for G2.

| Step | Verdict | Evidence |
|---|---|---|
| G0 | PASS | `/api/ai/config`: enabled, openai-compatible, `gemini-3-flash-preview`, schema, `answersPerDay: 5`; no key in the response; server log `key=set` |
| G1 (admin) | PASS light + dark | "AI activity" after Roles; "Query results are never logged."; From/To (last 7 days), Outcome, Dashboard filters; columns Time, User, Dashboard, Kind, Question, Outcome, Steps, Duration; 141 Keep rows read "Kept 5 added, 2 edited, 1 removed" and "Not kept: someone else changed the dashboard"; deleted dashboards show muted "Deleted dashboard #17" |
| G1 (uat_analyst 403) | NOT RUN YET | needs the analyst signed in (day 2) |
| G2 | PASS after fix 9d91596 (light + dark) | see below |
| G3 | PASS (light + dark dialog) | dashboard 20: SQLite `1\|1\|0\|0\|1\|0\|1` -> `0\|0\|0\|0\|0\|0\|1` (audit kept); `ai_session_views` 0; dialog "Discard this dashboard? / It was generated and never kept. Discarding deletes it with its charts and AI views.", Cancel focused; back on the list |
| G3c (restart sweep) | PASS (incidental) | a `tsx watch` restart deleted unkept dashboard 18: `[ai] boot sweep: deleted 1 unkept generated dashboards`; the open tab then answered Retry with "Dashboard not found." |

### G2 detail
- Form: "Generate from a table" toggle reveals Table (all registered tables), "What do you want to see?" and the note "The AI builds 4 to 8 charts from this table. Nothing is saved until you keep it." Observation: the toggle label is larger than the field labels (config-toggle style) - operator to judge.
- First run (dashboard 20, window 1200 px, grid 948 px = RGL `sm`, 18 cols): 13 s, 10 steps, 7 data widgets, but the bands were stacked at widths 12/18. **Defect found and fixed (9d91596):** below the 36-col breakpoints RGL reports its column-clamped fallback through `onLayoutChange`; `handleLayoutChange` wrote it into AI session geometry (and, for saved widgets, PATCHed `config.layout` - pre-existing, outside AI sessions too). Now ignored unless the active breakpoint has 36 columns. KPAGE-7/8 red-first, KPAGE-6/9 positive controls, 205/205 DashboardsPage specs.
- Second run (dashboard 21, window 1760 px): 17 s, 13 steps, outcome ok. One `/api/ai/ask` (auto-start once). Widgets: KPIs "Average Fare Amount" (0,0,12,14) and "Total Trips" (12,0,12,14); "Total Fare by Payment Type" bar and "Average Tip by Payment Type" pie in the middle; "Pickup Locations Map" (0,44,24,40) with a heatmap layer; "Recent Trip Records" (0,84,36,36); AI Assistant (24,0,12,40). The model also built a dynamic view. 6 data widgets: the time trend was skipped and the chat said `Couldn't do: Add line "Daily Trip Count" (missing required field groupByColumn)` (model adherence). Trailer follow-ups present.
- Observations for the operator: the map opens at world zoom (NYC heat is a dot); empty space right of the map under the AI column.
- Refine "Replace the pie chart with a bar chart by vendor": ok, 3 steps, 5.4 s; "Average Tip by Vendor" bar; follow-ups present.
- Keep: dialog "Save AI changes? 8 added · 0 edited · 0 removed. Filters are not saved."; "Changes saved."; writes = one `POST /ai-keep`, the AI view drop + saved view materialize, then chart `/api/sql` reads (no layout PATCH storm). `generated_by`/`generated_pending_at` cleared. Saved layouts equal the bands exactly. Reload: same positions, no 1x1, no pending note.
- Designer-visibility half (second profile) NOT RUN YET (day 2).
- **Defect (open, diagnosed, not reproduced):** after the refine, react-grid-layout logged "Maximum update depth exceeded" about once a second until Keep. The saved AI widget is passed `static: true` (D-13 lock) while GridLayout's state held `static: false`, so the sync effect kept setting state. No visible effect (frame rate normal, no requests); stopped at Keep. Harness repros (lock only, saved type change, temp pie -> bar) did not reproduce it; capture again on day 2.

Quota used day 1: 5/5 answers (2 wasted on the unsaved key).

### Day 1 follow-up fixes (operator-approved, 2026-10-23)
- **bc97400** Gemini's 400 bad-key body (`API_KEY_INVALID` / message naming the API key) now maps to `auth`: the user sees "The AI provider rejected the server's credentials. Ask an administrator to check the AI configuration." and the audit records `auth`. OAI-9 red-first with live-shaped fixtures; body text still never leaks.
- **dba356f** "Generate from a table" now uses the form's `--text-sm` (11 px, was 14 px) via `.ds-form .config-toggle`; both discard dialogs (generated dashboard, AI changes) now show Discard as `btn-danger btn-sm` (the existing confirm-remove pairing) and Cancel as `ghost-sm`, still focused. Checked light + dark.
- **a758465, 9570676, 688ab33** Every AI-added map with an AI lat/lon heatmap layer in the same answer gets a server-stamped `config.defaultView` from the 2nd-98th percentile lon/lat extent (run as the user, tagged, 5 s, world view on any failure; never sent to the provider or audited; the model cannot set it). Live check on Kinetica 7.2.3.12: raw extent lon -736.6..0.08, lat -0.14..3210 (bad data); percentile box lon -74.010..-73.861, lat 40.674..40.800 in 577 ms; view center lon -73.936 / lat 40.737, zoom 11.72; applied to dashboard 21's map it opens on Manhattan + LaGuardia (light + dark). End-to-end on a model-driven map still to be seen on day 2. Geometry (WKT/WKB) layers and dynamic-view-bound layers keep the world view.
- Gate note: `routes.dynamic-view`, `routes.filter-materialize`, `routes.filter-materialize-dv` now fail in isolation because the dev `.env` sets `DEFAULT_VIEW_TTL_MINUTES=3` (tests expect TTL 5); environmental (memory: dev .env leaks into server vitest), not a regression.

## Gemini, day 2 (2026-10-26)

Quota: 5/5 answers (audit rows 22-26). The scratchpad playwright-core install had been partly removed by the macOS temp cleaner; reinstalled (1.48.2).

| Step | Verdict | Evidence |
|---|---|---|
| G1 (uat_analyst 403) | PASS | no "AI activity" in the nav; `/api/ai/audit`, `/api/ai/audit/dashboards`, `/api/ai/audit/1` -> 403 `audit:view is required`; `?page=ai-activity` lands on Dashboards |
| G2 (designer half) | PASS light + dark | unkept dashboard 22 absent from uat_designer's list; `?dashboard=22` shows "This dashboard isn't available"; `/api/dashboards/22/widgets` and `/tables` -> 404 "Dashboard not found." (same as id 99999); kept dashboard 21 listed and its widgets load (200) |
| G2 map zoom (model-driven) | PASS | dashboard 22 (generated, audit row 22, 8.4 s, 9 steps): the AI "Trip Map" heatmap opened on Manhattan with no manual step |
| G3b cancel | PASS after fix 0aa5150 | dashboard 23: "Cancelled, nothing changed", empty dashboard with the pending note and "Discard dashboard"; audit row 23 `generate/cancelled`, 0 steps, 69 ms (counted toward the cap). First attempt (my script clicked the form's Cancel) let dashboard 22 finish. |
| G3b one-unkept prompt | PASS light | Generate while 22 was unkept: `You already have a generated dashboard that isn't kept yet: "UAT142 Cancel A". Keep or discard it first.`; "Open it" (btn-primary btn-sm) and "Discard it" (ghost-sm ghost-danger) both 23 px; no /api/ai/ask. Dashboard 23 then discarded via "Discard dashboard" -> gone. |
| G3c logout | PASS | admin logout with 22 unkept: dashboards/widgets 1/1 -> 0/0, audit row kept (1); log `{"event":"ai_generated_discard","dashboard_id":22,"deleted":true}` |
| G4 (partial, dashboard 21 as the TEST dashboard; no dashboard-12 copy exists) | 3 of 6 asks | see below |

### G4 detail
1. "Add a bar chart of trip count by vendor": applied (row 24, 1 step, 4.4 s, 1 POST); "Trip Count by Vendor" placed below the records table; trailer present (3 follow-ups).
2. Follow-up chip "Would you like to see the average trip distance by vendor as well?": applied (row 25, 1 step, 5.0 s, 1 POST); trailer present.
3. "Rename that chart to Trips per vendor and make it a line chart": the model asked which chart ("Which did you mean?" with "Rename the Trip Count by Vendor chart" / "...Average Trip Distance by Vendor chart"), row 26, 0 steps, 11.9 s. Reasonable: two charts had just been added. Covers the "ambiguous ask offers Choices" item. Light + dark readable.
- Remaining for day 3: pick a choice (rename + line), "Remove the records table" (confirm once), the "Show fares by type" ambiguous ask, "Revert dashboard to this state" (free). Dashboard 21 has unkept AI changes (2 added) carried in the browser session.

### Defects / observations (day 2)
- **Fixed 0aa5150 - Cancel re-sent the question.** Cancel and Send shared one reused `<button>`; the aborted run restored the draft and ended before the click's default action, so the node (now `type=submit`, Send enabled) submitted the form again. Live: after G3b's cancel a second "Create a starter dashboard..." POST got 409 AI_BUSY (error box + toast). Reproduced for free with a hung mocked `/api/ai/ask`: 2 POSTs before, 1 after. Affects every Cancel since 137; if the server had already released the request it would have re-run (and counted) the cancelled question. CHAT-CANCEL-NORESEND asserts the precondition (distinct nodes) red-first; jsdom does not replay Chrome's late activation.
- **Open (model quality):** dashboard 22's "Trips Over Time" grouped by the raw pickup timestamp ("Showing 100 of 447,884 categories", epoch-ms axis) instead of a day/month bucket.
- **Open (minor):** count charts label the y-axis with the counted column ("vendor_id") rather than "Count".
- **Observation:** multi-line follow-up chips centre their wrapped text.
- The "Maximum update depth" warning did not recur today (no refine on an unkept generated dashboard was run).

## Day 2 follow-ups (2026-10-26, no provider quota)

### Fixes
- **b601087** bar value axis + legend default to the line chart's rule (`resolveLineMetricTitle`): display label, else "<Aggregation> of <column>" (a COUNT bar read "vendor_id"; now "Count of vendor_id"). Applies to hand-built bars too; explicit yAxisLabel/yFieldLabel and stored column labels still win. Checked live light + dark (dashboard 21: "Count of vendor_id", "Average of tip_amount").
- **f0d6929** time trend on a raw timestamp: the AI can now add the existing `timeline` chart (auto-binned), and the generate recipe's slot 2 asks for "One time trend (type timeline)". Model-facing config `timeColumn`/`metric`/`aggregation` (+ colour, valueLabel, showLegend); the gateway skips a non-date timeColumn ("column X is not a date or time column"). Timelines are add-only (edits/view binding refused with a clear reason; TimelineRenderer does not query a bound view), not in the action allow-list, so ALLOW_LIST_VERSION stays v4. Gates: shared 243/243, server AI specs 770/770, web 5131 passed + theme-guard 182/182, tsc clean x3. Live (harness, 0 answers, dashboard 21): count of trips by pickup_datetime renders ~100 chronological bins in the palette violet, light + dark. Observation (pre-existing timeline formatting): multi-year range ticks show day + month without the year. Model choosing timeline in a live generate: to check on day 3.

### G6 joins (harness, 0 answers)
- Step 0: `demo.nyctaxi` vendor_id = NYC 148,750 · YCAB 136,878 · VTS 124,067 · CMT 86,513 · DDS 3,792.
- Operator approved; created `uat.vendor_dim (vendor_id VARCHAR(4) NOT NULL, vendor_name VARCHAR(32) NOT NULL)` with NYC, YCAB, VTS, CMT (DDS left out). `CREATE SCHEMA IF NOT EXISTS uat` was run (could not tell whether `uat` pre-existed: at cleanup drop the schema only if vendor_dim is its only object). Registered as table id 10; attached to dashboard 21 (its 2 unkept G4 charts were discarded first so the attach would not stale the AI session).
- 139 step 8b: harness views on dashboard 21, `count(*)` by `vendor_id` + `vendor_name` (from the dim): INNER -901 = 4 rows / 496,208 trips; LEFT -902 = 5 rows / 500,000 with `DDS | null | 3,792`. INNER <= LEFT; LEFT shows the unmatched vendor. PASS.
- Filter on the dim: chart on the LEFT view ("UAT Trips by vendor name", sum of trips by vendor_name); `filter(dynamicView -902, vendor_name in [Yellow Cab, NYC Taxi Co])` -> two bars. PASS. Observation: the unmatched (null) category renders with a blank tick label.
- 141 step 9: Keep (dialog "3 added · 0 edited · 0 removed. Filters are not saved.") -> "Changes saved. Saved views read joined tables without their filters."; writes: one `POST /ai-keep`, 2 AI view drops, saved view materialize, chart reads (no layout PATCH storm); audit row 27 keep/kept; widget 171 bound to dynamic view 15. Reload: same chart, unfiltered, no change bar (light + dark). PASS.
- 139 step 8 (preflight timeout): operator set `AI_DV_PREFLIGHT_TIMEOUT_MS=2000`; API restarted (server10.log). Harness view -903 = nyctaxi self-join on payment_type, count by vendor_id: `POST /api/ai/dynamic-view/materialize` 502 after 1,915 ms; the view shows "The view took too long to build and was cancelled." (2.9 s in the browser). `SELECT ... FROM ki_catalog.ki_query_active_all WHERE query_text LIKE '%kbi-ai:aidv%'` right after: only the check query itself (2 active jobs total) - no AI view job left. PASS. (No app route lists jobs; ki_catalog.ki_query_active_all via /api/sql replaced /admin/show/jobs so Claude never handles Kinetica credentials.) Session discarded afterwards.
- **G6: PASS.**
