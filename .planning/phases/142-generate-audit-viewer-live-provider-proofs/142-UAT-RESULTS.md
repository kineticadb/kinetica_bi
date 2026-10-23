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
