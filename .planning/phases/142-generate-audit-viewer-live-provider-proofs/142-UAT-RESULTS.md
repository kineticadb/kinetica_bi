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
- **Timeline year ticks** (follow-up to the observation above): when the buckets cross a calendar year, week/day/hour/minute ticks add the year ("Jan 18 2009", "Feb 22 2009 14:00"); single-year data keeps the short labels; year/quarter/month already carried it. The vertical-orientation bucket axis widens 72 -> 104 px when the year is shown. TICKYEAR tests red-first (5 failing). Gates: web 5139 passed / 1 skipped (incl. theme-guard), tsc clean. Live (harness, 0 answers, dashboard 21, sum of fare_amount by pickup_datetime): ticks read "Jan 18 2009 ... Jun 28 2015", light + dark; temporary widget discarded.

### G6 joins (harness, 0 answers)
- Step 0: `demo.nyctaxi` vendor_id = NYC 148,750 · YCAB 136,878 · VTS 124,067 · CMT 86,513 · DDS 3,792.
- Operator approved; created `uat.vendor_dim (vendor_id VARCHAR(4) NOT NULL, vendor_name VARCHAR(32) NOT NULL)` with NYC, YCAB, VTS, CMT (DDS left out). `CREATE SCHEMA IF NOT EXISTS uat` was run (could not tell whether `uat` pre-existed: at cleanup drop the schema only if vendor_dim is its only object). Registered as table id 10; attached to dashboard 21 (its 2 unkept G4 charts were discarded first so the attach would not stale the AI session).
- 139 step 8b: harness views on dashboard 21, `count(*)` by `vendor_id` + `vendor_name` (from the dim): INNER -901 = 4 rows / 496,208 trips; LEFT -902 = 5 rows / 500,000 with `DDS | null | 3,792`. INNER <= LEFT; LEFT shows the unmatched vendor. PASS.
- Filter on the dim: chart on the LEFT view ("UAT Trips by vendor name", sum of trips by vendor_name); `filter(dynamicView -902, vendor_name in [Yellow Cab, NYC Taxi Co])` -> two bars. PASS. Observation: the unmatched (null) category renders with a blank tick label.
- 141 step 9: Keep (dialog "3 added · 0 edited · 0 removed. Filters are not saved.") -> "Changes saved. Saved views read joined tables without their filters."; writes: one `POST /ai-keep`, 2 AI view drops, saved view materialize, chart reads (no layout PATCH storm); audit row 27 keep/kept; widget 171 bound to dynamic view 15. Reload: same chart, unfiltered, no change bar (light + dark). PASS.
- 139 step 8 (preflight timeout): operator set `AI_DV_PREFLIGHT_TIMEOUT_MS=2000`; API restarted (server10.log). Harness view -903 = nyctaxi self-join on payment_type, count by vendor_id: `POST /api/ai/dynamic-view/materialize` 502 after 1,915 ms; the view shows "The view took too long to build and was cancelled." (2.9 s in the browser). `SELECT ... FROM ki_catalog.ki_query_active_all WHERE query_text LIKE '%kbi-ai:aidv%'` right after: only the check query itself (2 active jobs total) - no AI view job left. PASS. (No app route lists jobs; ki_catalog.ki_query_active_all via /api/sql replaced /admin/show/jobs so Claude never handles Kinetica credentials.) Session discarded afterwards.
- **G6: PASS.**

## Ollama (142-11, 2026-10-26)

### Setup
- Operator approved Docker ("approve docker") before the image pull/container start and the model pull.
- `ollama/ollama` (0.40.11, image 5.03 GB, pulled 14:02-14:16) as container `kbi-ollama`, named volume `kbi-ollama`, `127.0.0.1:11434`, `OLLAMA_CONTEXT_LENGTH=16384`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_KEEP_ALIVE=30m`. Model `qwen2.5:7b-instruct` (4.7 GB, pulled 14:16-14:35).
- Docker Desktop left at its default 4 CPUs / 10.7 GiB (operator's choice; plan recommends 8 CPUs). `ollama ps`: 6.0 GB, 100% CPU, CONTEXT 16384. Prompt processing ~14-19 tokens/s.
- Operator set `.env`: AI_BASE_URL=http://localhost:11434/v1, AI_MODEL=qwen2.5:7b-instruct, AI_TIMEOUT_MS=600000, AI_DATA_ACCESS=schema, AI_MAX_ANSWERS_PER_DAY=50 (the day cap counts all providers; today's 5 Gemini answers had used it). AI_API_KEY left set (sent only to localhost; Ollama ignores it). Boot line: `model=qwen2.5:7b-instruct endpoint=http://localhost:11434 ... timeoutMs=600000 capPerDay=50 toolMode=native`.

### Results
| Step | Result | Time | Notes |
|------|--------|------|-------|
| O0 approvals + start | PASS | image 14 min, model 18 min | both approvals recorded before the commands ran |
| O1 probe (`--raw --runs 1`) | PASS (adapter) | 15:09-15:22 | raw POST 200, tool_calls=1, finish=tool_calls; tool_choice/stream_options accepted (no 400); calls arrive as tool_calls (index + id present, usage present, no extra content). 6/7 clean: valid calls 75%, malformed 25%, parallel 60%, 2nd turn ok, p50 46 s / p95 177 s. Scenario 1 (cold) excluded: network error at exactly 300 s (see defect 1). |
| O2 S6 native (`--runs 3`) | inconclusive (18 clean trials) | 16:25-19:52 | valid calls 58.1%, malformed 41.9%, wrong tool 38.9%, text-instead-of-tool 0%, parallel 53.3%, repair ok 80% (4/5), 2nd turn 3/3, p50 7.2 s / p95 206 s; 3 trials excluded `aborted` because the Mac slept with the lid closed (16:25-19:10 and again in run 3), not a provider fault. Decision line: default stays native. |
| O2 S6 json (`--runs 3 --mode json`, under `caffeinate -i -s`) | json (best effort) | 19:53-21:29 | 21/21 clean: valid calls 85.7%, malformed 14.3%, wrong tool 23.8%, text-instead-of-tool 22.2%, parallel 28.6%, repair 1/1, 2nd turn 3/3, p50 16 s / p95 169 s. Fewer, cleaner calls: the multi-step add-chart scenario made no call in 2 of 3 runs and the malformed-pressure scenario made none in 3 of 3. Decision line: `AI_TOOL_MODE=json (best effort) for qwen2.5:7b-instruct`. (Matrix date prints 2026-10-27 because the spike stamps UTC.) |
| O3 add ask "Add a bar chart of trip count by vendor" | FAIL (model) | 300.8 s / 51.8 s / 96.5 s | row 28: cut at 300 s while prefilling the 4,617-token prompt (defect 1). Retry (row 29, prompt cache hit 4,616 tokens, 51.8 s): `ok` with an EMPTY answer, 0 tools, 133 output tokens; chat showed only local template follow-ups (defect 2). Fresh ask (row 30, 96.5 s, 2 steps): both add_widget calls rejected at the shape stage (`(root): Unrecognized key "binding"`, then `"groupByColumn", "metricColumn"` at the root instead of in config); the model explained the failure in plain words. No chart, so the edit/rename ask was skipped. |
| O3 filter "Filter to payment type Credit" | FAIL (model) | 47.1 s + 26.3 s | row 31: asked which column (model follow-ups/trailer present). Reply "Yes, filter the payment_type column to Credit" (row 32): the model wrote "Applied filter ..." with NO tool call; the app showed "Changes: none" under it, so the claim is visibly unbacked; filterState empty. |
| O3 Generate (demo.nyctaxi, dashboard 24) | PARTIAL | 300.9 s, then 600.2 s | row 33: cut at 300 s while prefilling (defect 1). Retry (row 34): 13 tool calls in 600 s, then AI_TIMEOUT_MS ended it (`timeout`); 5 accepted in-flight (map + heatmap layer, records, bignumber, **timeline** for the time trend), 8 rejected (missing metric/aggregation, `columns` not allowed for bar, unknown column `count_total_amount` with did-you-mean, reused temp id, set_layout); nothing kept (dashboard showed only the AI panel). Nothing to Keep (failed generation, D-07). |
| O3 Discard (dashboard 24) | PASS | | before `1|1|0|0|1|0|2`, after `0|0|0|0|0|0|2` (audit rows kept); dialog "Discard this dashboard?" with Cancel focused; log `{"event":"ai_generated_discard","dashboard_id":24,"deleted":true}`. |
| O4 AI activity | PASS | | rows 28-34 listed with outcomes/steps/durations; dashboard 24 shows "Deleted dashboard #24"; details: `openai-compatible / qwen2.5:7b-instruct`, 8989 in / 924 out, schema, v4, outcome detail timeout, "The tools list can be incomplete for answers that timed out." |

| O5 cleanup | PASS | | operator chose "Remove all": `docker rm -f kbi-ollama && docker volume rm kbi-ollama && docker rmi ollama/ollama`; `docker ps -a`, `docker volume ls`, `docker images` show nothing for ollama (~9.7 GB freed). Operator to switch `.env` back to Gemini and AI_MAX_ANSWERS_PER_DAY=5. |

**Ollama verdict (qwen2.5:7b-instruct, CPU, 4 vCPU): PARTIAL.** The adapter works unchanged against Ollama (no 400s, proper streamed tool_calls). The model is too weak for the app's actions in native mode (S6 58% valid; in-app add/filter failed, Generate timed out at 600 s after 13 calls with 5 accepted); json mode is the better documented setting for it (S6 85.7% valid, best effort). Every malformed or unbacked action was blocked or shown as "Changes: none". Defect 1 (300 s fetch cap) needs a gap-closure plan.

### Defects / observations (Ollama)
1. **Calls are cut at 300 s regardless of AI_TIMEOUT_MS (gap-closure plan needed).** Node's built-in fetch (undici) has a 300 s headers timeout and the server sets no dispatcher (`grep -rn "headersTimeout\|dispatcher\|undici" packages/server/src` finds nothing). Ollama only sends headers after prompt processing, so a cold 4.6-9k-token prompt on CPU (~15 tokens/s) exceeds it: rows 28 and 33 failed `network` at 300.8/300.9 s; Ollama logged `500 | 5m0s` (client went away). Retry works only because Ollama keeps the processed prefix in its prompt cache. Not patched here (plan: record, do not tune).
2. **Empty answer accepted as `ok`.** Row 29: 133 output tokens, empty answer text, no tool calls, outcome ok; the chat shows no AI bubble text. Probably the model's output was neither a tool call nor answer text after trailer parsing (no wire capture in the app to confirm).
3. Model quality (Qwen 2.5 7B, native tools): config keys put at the top level instead of in `config`; claims an action without calling the tool; repairs some calls after the gateway's did-you-mean hints; picks timeline for the time trend. The gateway rejected every malformed call and the UI never showed an unbacked change as applied.

### Ollama defect fixes (operator-requested, 2026-10-26 evening)
- **Defect 1 fixed - 300 s cap.** New `providers/providerFetch.ts`: provider calls (OpenAI-compatible and Claude) go through an undici `Agent` with `headersTimeout: 0, bodyTimeout: 0`, so the agent loop's AI_TIMEOUT_MS abort is the only deadline (Kinetica and other fetches unchanged). `undici` declared as a direct server dependency at the already-installed 7.25.0 (was transitive via jsdom; lockfile diff is the one dependency line). PFETCH-1..4: the two adapters pass the dispatcher (red before wiring) and a real local server shows Node's global fetch honours a dispatcher's headers timeout (1 s Agent -> `UND_ERR_HEADERS_TIMEOUT`; providerFetch waits). Not re-run live: the Ollama container was already removed at O5.
- **Defect 2 fixed - empty answer.** `runAnswer`: an ask that ends with no text (follow-ups alone do not count), no changes, no choices and nothing skipped sends `AI_PROVIDER_ERROR` "The AI returned an empty answer. Nothing was changed. Try again." (retryable) and audits `provider_error` / `empty_answer`. Generate keeps its own too-few rule. EMPTYANS-1 (3 cases, red first), EMPTYANS-2/3 (an applied change or a skip still returns a normal result).
- Gates: server tsc clean; AI specs 68 files / 779 passed; full server suite failing files identical to a baseline run without the change (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.dynamic-view, routes.filter-materialize(-dv), routes.wms), plus one load timeout in layers.spec.ts that passes alone (23/23).

## Ollama re-run (2026-10-29, json mode, after 51b009d)

Purpose: the live re-run the 10-26 defect fixes never had, with the documented `AI_TOOL_MODE=json`. Container and model started again by Claude at the operator's request (`ollama/ollama:latest`, `qwen2.5:7b-instruct` 4.7 GB); Docker 4 CPUs / 11.5 GB; `ollama ps` 6.0 GB, 100% CPU, CONTEXT 16384; warm-up load 13 s. Operator set `.env` (Ollama base URL, model, AI_TIMEOUT_MS=600000, AI_TOOL_MODE=json, schema); boot line `toolMode=json capPerDay=18`. Asks driven by Claude through the AI Assistant's chat box in the operator's Chrome (dashboard 62 "UAT142 Ollama", demo.nyctaxi), dark mode.

| Step | Result | Time | Notes |
|------|--------|------|-------|
| O1 probe (native, `--raw --runs 1`) | PASS (adapter) | | no 400s, calls arrive as tool_calls; 6/7 clean: valid 50%, malformed 50%, parallel 60%, 2nd turn ok, calls 70-90 s; scenario 1 excluded `network` (spike script, not investigated). Supports json mode for this model. |
| Defect 1 (300 s cut) live | PASS | 394 s | the first ask ran 394 s to completion with no cut at 300 s (providerFetch). |
| O3 add "Add a bar chart of trip count by vendor" | FAIL then PASS | 394 s; 44 s | row 74: the model replied `{"add_widget":{...}}` (tool name as the key, optional fields `null`); json mode only knew `{"tool","args"}`, so the JSON showed as answer text, 0 steps (**defect 3**). Fixed (below); row 75: one valid add_widget, "Trip Count by Vendor" bar (NYC/YCAB/VTS/CMT/DDS) added, change bar "1 added". Follow-ups written inline in the answer, not as the trailer (local default chips shown). |
| O3 edit "Rename it to Trips per vendor" | FAIL (model) | 404 s; 45 s | rows 76-77 (second try named the chart): rename_widget on id 278, the AI Assistant widget, not the new chart (-1); gateway refused "the AI assistant widget can't be changed", chat showed "Couldn't do". The model's own text still claimed success. |
| O3 filter "Filter to payment type Cash" | FAIL (model) | 49 s | row 78: 0 tool calls; the model's answer says it applied the filter and even writes a "Changes: applied: ..." line in its own text (imitating the app's list); no chip, chart unchanged. |
| O3 Generate (demo.nyctaxi, dashboard 63) | PARTIAL | 600 s | row 79: one add_widget in 600 s (bignumber on column `count`, rejected with the did-you-mean `passenger_count`), then AI_TIMEOUT_MS ended it (`provider_error` / `timeout`). Nothing to Keep. |
| O3 Discard (dashboard 63) | PASS | | pending note "Discard dashboard" -> dialog "Discard this dashboard? ..." with Cancel focused -> back on the list, row gone; G3 query before `1|1|0|0|1|0|1`, after `0|0|0|0|0|0|1` (audit kept). |
| O4 AI activity | PASS | | row "Deleted dashboard #63 · Generate · Failed · 600.0 s"; detail `openai-compatible / qwen2.5:7b-instruct`, 4,750 in / 609 out, schema, v4, outcome detail timeout, incomplete-tools line, the rejected call with its reason. |
| O2 S6 | not re-run | | json mode already measured 10-26 (85.7% valid, 21/21 clean). |

**Re-run verdict: still PARTIAL.** Defect 1's fix holds live. json mode now runs this model's calls, but a 7B model on 4 CPUs still picks wrong targets, claims actions it did not take and cannot finish Generate in 600 s. Every wrong or unbacked action was refused or not applied.

- **Defect 3 fixed - json-mode reply shapes.** `jsonAction.ts`: besides `{"tool","args"}`, a reply whose single key is one of the request's own tool names with an object value is a call (`{"add_widget":{...}}`); `null` arguments count as absent. JSA-OLL-1/2 red first. Not a security change: only the request's tools can be named, and every call still goes through the gateway.
- **Observation:** a model can write text that looks like the app's change list ("Changes: applied: ..."). The app's own list was absent and nothing was applied, but the imitation is easy to misread. Possible follow-up: style the app's list so model text cannot pass for it.

## Gemini, day 3 (2026-10-27)

Cap 12 for the day (operator). 5 Gemini answers today (audit rows 35, 38-41); the 24 h window was full (12/12) after row 41. Row 37 was capped (`counted=0`): yesterday's rows 23-26 were still inside the rolling 24 h window, which I had miscounted.

| Step | Verdict | Evidence |
|---|---|---|
| G7 keep after an AI ask (joined view) | PASS | row 35 (24 s, 1 repair): "Add a bar chart of average tip by vendor" on dashboard 21 -> Gemini built dynamic view "Avg Tip by Vendor Name" (nyctaxi LEFT JOIN `uat.vendor_dim`, table 10) and bar "Average Tip by Vendor Name" (aggregation sum over the view's avg). Keep dialog "2 added · 0 edited · 0 removed. Filters are not saved." -> "Changes saved. Saved views read joined tables without their filters."; writes: ai-keep, AI view drop, saved view materialize, chart read; row 36 keep/kept; widget 173 bound to dynamic view 16. Reload: no change bar, same chart. |
| G4 rename + line | PASS (see observation) | row 38, 2 steps, 6.5 s: `rename_widget` + `change_widget_type` on widget 165 -> "Tips per vendor", line chart renders (CMT/DDS/NYC/VTS/YCAB, "Average of tip_amount"); 3 follow-up chips. |
| G4 remove + confirm | PASS after fix 21fd377 | row 39: `remove_widget 166` held at the clarification stage ("removing saved content needs the user's approval"); card `Remove the saved records "Recent Trip Records"?` Yes / No. Row 40 ("Yes, remove it"): `remove_widget 166` ok, "Removed widget \"Recent Trip Records\"", chips rendered. |
| G4 revert | PASS | "Revert dashboard to this state" on the rename turn: no dialog, the later turns dim, the records table returns, the line chart stays; change bar "0 added · 1 edited · 0 removed". The rest was then discarded (dialog "Discard all AI changes?"); widgets 165/166 back to bar "Average Tip by Vendor" / records. |
| Generate uses timeline | PASS | row 41, dashboard 25 "UAT Gemini gen day3": 13 steps, 11.4 s, 121k in / 3.6k out. Step 1 had 5 rejections (timeline/bar/pie without `metric`; map with a tableId; heatmap on the missing map), all repaired in step 2. Result: 2 KPIs, "Trips Over Time" **timeline** (ticks "Oct 31 2010 ... Jun 28 2015", so the year fix works on live data), bar by payment type, pie by vendor, map with a pickup heatmap, records. Left unkept for cleanup (later deleted by the restart sweep, see G3c below). |
| G9 AI activity page (0 answers) | PASS LIGHT + DARK (queries part waits for G8) | 41 rows, "Page 1 of 1 · 41 entries" (page size 50, so Next/Previous stay disabled; multi-page not exercised live). Kinds Ask / Generate / Keep; Keep rows read "Kept 2 added, 0 edited, 0 removed". Outcome filter counts match `ai_audit`: Kept 13, Keep conflict 3, Keep invalid 2, Keep denied 0 and Keep failed 0 ("No AI activity in this period."), Limit reached 1, Cancelled 1, Failed 5. Dashboard filter lists "Deleted dashboard #13 ... #25"; the cell is `<span class="muted">` with no link; filtering on #24 gives its 2 rows. Ask detail (row 35): question, answer, tools (add_dynamic_view ok, add_widget rejected, add_widget ok), changes, "1 rejected", `openai-compatible / gemini-3-flash-preview`, 68905 in / 840 out, schema, v4. Timeout row (34): outcome detail timeout and "The tools list can be incomplete for answers that timed out." |
| G3c restart path (incidental) | PASS | my server edit restarted the dev API at 13:08 and the boot sweep logged `{"event":"ai_generated_discard","dashboard_id":25,"deleted":true}` / "deleted 1 unkept generated dashboards"; dashboard 25 shows as "Deleted dashboard #25". |

- Not run: the "Show fares by type" ambiguous ask (day 2 row 26 already covered "an ambiguous ask offers Choices").

### Defects / observations (day 3)
- **Fixed 21fd377 - follow-ups shown as raw text when the reply repeats the confirm question.** Row 39's reply ended with the confirm question after its Follow-ups list. `parseReplyTrailer` only reads a trailer at the end, so the list stayed in the bubble as "Follow-ups: - ..." and the question appeared twice (bubble and card). The parser now gets the clarification questions and drops trailing lines that repeat one (case-insensitive), unless that is the reply's only text (no empty bubble). TRL-9 (parser) and E2E6-ECHO (route; red without the runAnswer change). Gates: server tsc clean; AI specs 68 files / 781 passed; full suite failing files = the baseline set plus lib.exportRunner.memory, routes.management, routes.rbac, each passing alone (8/8, 65/65, 5/5).
- **Observation (model):** "Rename that chart" picked the older "Average Tip by Vendor" (165) rather than the chart just added ("Average Tip by Vendor Name", 173). The reply named the chart it changed. On day 2 the same ask with two fresh charts asked which one.
- **Observation (model):** the G7 chart used `sum` over a view column that is already an average ("Sum of avg_tip"; correct values because there is one row per vendor).
- **Observation:** a generated dashboard's pie and map take half the width each, leaving the right column empty below the AI widget.
- **Observation (carried):** the unmatched (null) category renders with a blank tick label.
- **Observation (G9, minor):** the detail says "1 rejected" without the reason, and token counts have no thousands separator ("68905 in").

### Day 3 follow-up fixes (2026-10-27/28, 0 answers)
- **c5b7879 - null category reads "(blank)".** New `lib/categoryLabel.ts`: null, undefined and empty/whitespace categories display as "(blank)" on the bar category axis (vertical and horizontal), the line x axis and `ColumnFormatTooltip` (was a blank tick and "null"). Display only: data, sort order and click-to-filter keep the real value. CATLABEL-1..3 (CATLABEL-3 structural: the three axes use `tickFormatter={categoryLabel}`), CATLABEL-4 (tooltip).
- **285f686 - AI activity rejection reasons + grouped counts.** The detail lists each stored rejection as "label: reason; reason" (label alone when it has no reasons; malformed rows skipped) under "N rejected"; tokens and query row counts use thousands separators ("68,905 in / 840 out"). AUDPAGE-7c.
- Gates: web tsc clean; full web vitest 272 files / 5144 passed, 1 skipped (`--maxWorkers=2`); theme-guard green. A first full run at load ~17 failed 2599 tests in unrelated files (the sampled failing spec passed alone); the clean rerun is the result of record.
- **Checked live 2026-10-28 (light + dark):** the G7 "Average Tip by Vendor Name" chart (dashboard 21) shows the unmatched vendor's tick as "(blank)" and its tooltip as "vendor_name: (blank)"; row 35's detail lists "1 rejected" then "add_widget: missing required field aggregation", tokens "68,905 in / 840 out".

## Gemini, day 4 (2026-10-28)

Cap 18 for the day (operator). 7 Gemini answers (audit rows 42-48, all `ok`, counted). All on dashboard 21; every AI change was discarded afterwards (no saved content changed). Servers and the UAT Chrome launched by Claude (fresh scratchpad profile, Chrome 156); operator signed in and edited `.env`.

| Step | Verdict | Evidence |
|---|---|---|
| G5 filter | PASS light + dark | row 42 (1 step, 10.7 s): "Filter to payment type Credit" -> `apply_filter payment_type eq 'Credit'`, "Filtered nyctaxi to payment_type = 'Credit' (6 widgets)"; chip `payment_type = 'Credit'` with the AI tag; "Total Fare by Payment Type" shows only Credit, records only Credit, Total Trips 189,817. Map tiles narrow: after a zoom the WMS request's LAYERS is `_kbi_filt_uadmin_d21_t1_...` (the filter view), not demo.nyctaxi. Follow-ups present. |
| G5 dynamic view | PASS light + dark (see observation) | row 43 (3 steps, 15.3 s): `add_dynamic_view` "Average Tip by Hour" (groupBy pickup_datetime bucket hour, avg tip_amount) + line "Average Tip by Hour Trend" bound to it; change bar "2 added · 0 edited · 0 removed"; chart renders ("Showing 100 of 10,847 categories"). Follow-ups present. |
| G5 remove saved view | PASS light | row 44 (5.2 s): `remove_dynamic_view 14` held at the clarification stage ("removing saved content needs the user's approval"); card `Remove the saved dynamic view "UAT Trips by vendor INNER"?` Yes / No. Row 45 (Yes, 2.7 s): removed; change bar "2 added · 0 edited · 1 removed". View 14 was unbound. Discard ("Discard all AI changes?") then restored it; views 13-16 all present in SQLite. |
| G8 query mode | PASS (ask 1 by model choice, see observation) | Operator set `AI_DATA_ACCESS=query`; restart logged `dataAccess=query`. Row 46 "What's the average tip by payment type?" -> the model added a bar chart (`add_widget`, no query; `queries_json` `[]`). Row 47 "Which columns would make good breakdowns?" -> 3x `get_column_profile` (rate_code_id, store_and_fwd_flag, cab_type), answer in words, "Ran 3 queries". Row 48 "Don't add a chart. Just tell me the average tip for each payment type." -> `run_query`, answer in words (Cash 1.55, Credit 1.03, Unknown 0.34, Dispute 0.05, No Charge 0.00), "Ran 1 query". |
| G8 queries_json | PASS | row 48: `[{"sql":"SELECT payment_type, AVG(tip_amount) as avg_tip FROM demo.nyctaxi GROUP BY payment_type ORDER BY avg_tip DESC","rowCount":5,"durationMs":227,"outcome":"ok"}]`; row 47 entries have the same four keys. No row values stored. |
| G9 queries part | PASS light + dark | rows 47/48 detail: QUERIES section lists each SQL with "N rows · N ms · ok"; Data access "query"; tools `get_column_profile (ok)` x3 / `run_query (ok)`. |

- Not run today: G10 S6 spike (needs its own quota day).
- Operator to set `AI_DATA_ACCESS=schema` back and restart.

### Defects / observations (day 4)
- **Observation (model):** "average tip by hour" was read as calendar hour (`DATE_TRUNC` hour, 10,847 buckets) rather than hour of day; the line then plots 100 non-consecutive hours. Axis title "Average of avg_tip" (average over an average) and ticks are raw timestamps ("2009-01-04 07:00:00.000").
- **Observation (model):** in query mode the plain question "What's the average tip by payment type?" was answered with a chart, not a query; it answered in words only when told "Don't add a chart".
- **Observation (G9, minor):** the detail says "1 rows"; the answer text collapses the reply's bullet list onto one line ("are: - Cash: 1.55 - Credit: 1.03 ...") although the chat bubble shows a list.
- **Observation (UAT tooling):** the `?page=ai-activity` deep link lands on Dashboards on a fresh load (clicking the nav item works).

### Day 4 extra ask and follow-up fixes (operator-approved)
- Extra ask (schema mode restored, operator-requested to use leftover quota), row 49 (3 steps, 13.5 s): "Show average tip by hour of day" -> again `add_dynamic_view` with `bucket: "hour"` and a bar on it; discarded. So the hour-of-day gap is the app, not the model: `AI_DV_BUCKETS` only truncates (`DATE_TRUNC`), nothing extracts hour of day / day of week. **Deferred** to todo `2026-10-28-ai-dv-hour-of-day-day-of-week-buckets.md`. Row 49 also had `add_widget` rejected once for "missing required field aggregation" (repaired).
- **52919a9 - add_widget names required fields.** Across all audit rows 13 of 59 `add_widget` calls were rejected for a missing metric/aggregation/groupByColumn (each a provider round + ~40-60k input tokens). The description now carries "Required fields: bar metric+aggregation+groupBy, ... bignumber metric+aggregation, timeline timeColumn+metric+aggregation." built from `AI_WIDGET_CONFIG` (arg names), plus "never sum an average" for already-aggregated view columns (day 3 "Sum of avg_tip"). AWREQ-1/2 red first. Not yet checked live (next quota day: watch the rejection rate on new add_widget calls).
- **0150f36 - AI activity detail.** "1 row" (was "1 rows"); question/summary/answer use page-local `.ai-activity-text` (pre-wrap) so the model's lists keep their line breaks. AUDPAGE-7d red first. Checked live light + dark: row 48 answer shows its 5-line list; "1 row · 167 ms · ok".
- Gates: server tsc clean; AI specs 67 files / 785 passed; full server suite failing files = the known set (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.dynamic-view, routes.filter-materialize(-dv), routes.wms) plus routes.management, which passes alone (65/65). Web tsc clean; full web vitest 272 files / 5145 passed, 1 skipped (`--maxWorkers=2`); theme-guard green.

## Gemini G10 S6 spike, day 1 (2026-10-30)

Operator's terminal, `--runs 1 --rpm 6`, native, stream, output `packages/server/s6-gemini-day1.json` (git-ignored). 7/7 clean trials, 0 excluded, no 429s, no request errors.

| provider | model | date | stream | tool valid% | malformed% | parallel% | 2nd-turn ok | index present | 429 delay>20s | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini | gemini-3-flash-preview | 2026-10-30 | true | 80% | 20% | 25% | fail (0/1) | no | 0/0 | inconclusive (7 clean trials) |

| Scenario | Calls | Note |
|---|---|---|
| s1 list_tables | none | answered in text (3 s) |
| s2 describe_table typed args | describe_table | valid |
| s3 multi-step add bar chart | add_widget | valid |
| s4 parallel invite | list_tables | valid call, wrong tool for the scenario, not parallel |
| s5 no-tool question | none | correct |
| s6 multi-turn round-trip | none | text instead of the second-turn call (0/1) |
| s7 malformed pressure | add_widget, set_layout | parallel; 1 of 2 malformed, repair 0/1 |

Latency p50 9.8 s / p95 10.7 s. Decision line: inconclusive, default stays `AI_TOOL_MODE=native`. Needs about 2 more quota days (`--runs 1` each) to reach >= 20 clean trials; one run is too small to read the s1/s6 misses as a pattern.

## Tested models

Same table as README.md "Tested models (Phase 142):".

| Provider | Model ID | Tool mode | Result | Notes | Date |
|----------|----------|-----------|--------|-------|------|
| OpenAI-compatible (Gemini, AI Studio) | `gemini-3-flash-preview` | native | pass so far (the S6 spike still open) | `AI_TIMEOUT_MS=120000`; free tier ~20 requests/day/model; asks take 3-25 s, Generate 8-12 s | 2026-10-23 to 2026-10-28 |
| OpenAI-compatible (Ollama in Docker, CPU) | `qwen2.5:7b-instruct` | json | partial | `OLLAMA_CONTEXT_LENGTH=16384`, `AI_TIMEOUT_MS=600000`; 4 CPUs: asks 26-97 s, Generate did not finish in 600 s; S6 valid tool calls 86% json vs 58% native; malformed calls are blocked, never applied | 2026-10-26 |
| Claude | — | — | not live-verified | unit-tested against doc-derived fixtures only (no Anthropic key, AI-F11) | — |

The Ollama 300 s cut-off (defect 1) and empty-answer acceptance (defect 2) were fixed after the run (51b009d) and not re-run live. `.env.example` now carries `AI_TOOL_MODE=json` under the Ollama example.
