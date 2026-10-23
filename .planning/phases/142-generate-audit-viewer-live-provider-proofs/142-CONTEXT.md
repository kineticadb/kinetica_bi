# Phase 142: Generate, Audit Viewer & Live Provider Proofs - Context

**Gathered:** 2026-10-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Three deliverables, fixed by ROADMAP.md (requirements AIGEN-V20-01, AIGEN-V20-02, AIGOV-V20-05, AIPRV-V20-02, AIPRV-V20-03):

1. **Generate.** A designer picks one table and gets a starter dashboard: 4–8 widgets suited to its columns. They can refine it by asking, Keep it, or Discard it. Discarding leaves no dashboard, widgets or views, checked in both SQLite and Kinetica.
2. **Audit viewer.** An admin with the existing `audit:view` permission browses the AI audit log (`ai_audit`). A user without the permission cannot open the page. This adds no new permission and causes no RBAC spec ripple (Phase 135 D-11).
3. **Live provider proofs.** The operator UAT runs live on Gemini and on one named Ollama model. It is recorded in a UAT file and summarized in a tested-models matrix. This phase also picks up the live checks deferred from Phases 137–141.

Out of scope:
- Generating across several tables (AI-F3).
- Re-generating over an existing dashboard.
- AI layer types other than heatmap (AI-F12).
- Any new audit permission.
- Exporting the audit log.

</domain>

<decisions>
## Implementation Decisions

### Generate flow & lifecycle
- **D-01 Entry point:** the existing New Dashboard form (`DashboardCreate` in `DashboardsPage.tsx`) gets a "Generate from a table" option.
  - The option adds a table picker and an optional "what do you want to see" prompt next to Name and Description.
  - It is shown only when the user has `ai:use` and AI is enabled on the server (`/api/ai/config`).
  - There is no second creation path, and nothing on the Datasets page.
- **D-02 The dashboard exists before Keep.** Generation works like this:
  1. Create the empty dashboard and its table link through the existing routes.
  2. Run the normal agent loop in a generate mode into the session layer.
  3. Keep saves the widgets through the existing Phase 141 path.
  4. Discard deletes the dashboard.
  - This reuses the session, Keep and view lifecycle; it is the milestone research's plan.
- **D-03 Unkept state:** the dashboard is marked server-side as "generated, never kept" (for example a nullable `generated_pending` flag or owner + timestamp).
  - **D-03a The server deletes an unkept generated dashboard:**
    - on logout (before the session is deleted, as the `ai_session_views` drop does);
    - in a boot sweep before listen;
    - after an env cap, default 24 h, for sessions that never log out. The env name is the planner's choice, in the `AI_*` family, and goes into `.env.example`.
  - Deleting it also drops its AI session views and widgets. It is the same "leave nothing behind" guarantee as Discard.
- **D-04 Visibility:** while it is unkept, the dashboard appears only in its creator's dashboard list. Everyone else's list and direct GETs hide it.
- **D-05 After the first Keep it is an ordinary dashboard.** The pending flag clears in the Keep transaction. A later Discard only drops unsaved changes, exactly as in Phase 141; it never deletes the dashboard again.
- **D-06 One unkept generated dashboard per user at a time.** Starting a second generation while one is unkept asks the user to Keep or Discard the first. The server enforces this too, not just the UI.
- **D-07 Failure:** if generation fails part-way (provider error, timeout, daily or hourly cap, Cancel), the user stays on the empty generated dashboard.
  - The error shows inline in the AI chat with Retry, the existing Phase 137 behaviour.
  - Discard still deletes the dashboard.
  - Nothing deletes it automatically on failure; it can only go through Discard or the D-03a sweep.

### What gets generated
- **D-08 AI Assistant widget:** the generated dashboard always includes the AI widget, placed automatically (side column on the right, see D-12).
  - The generation prompt and answer are already in its chat, so the user can refine by asking straight away.
  - It is saved with Keep.
- **D-09 Guided recipe that the AI fills:**
  - 1–3 KPIs (bignumber);
  - a time trend if there is a date or time column;
  - 1–2 breakdowns by low-cardinality columns;
  - a map with one heatmap layer if there is geometry or lat/lon (D-11);
  - a records table.
  - The AI picks the columns and drops slots that don't fit.
  - The server enforces **4–8 data widgets**. The AI widget does not count toward 4–8 (D-10).
- **D-09a The user's optional prompt steers the choices,** for example "focus on tips by borough". The recipe still fills the gaps, so there are always 4–8 widgets.
- **D-10** 4–8 counts data widgets only. The AI Assistant widget comes on top.
- **D-11 Map:** a map widget plus one heatmap layer on the table, using what the AI can already do. Other layer types stay AI-F12.
- **D-12 Fixed-band layout, placed by the server whatever the model returns:**
  - KPIs in a row on top;
  - the trend and breakdowns in the middle;
  - then the map and the records table;
  - the AI widget in a side column on the right.
  - It uses the existing per-type default sizes (Phase 136) and shared grid layout math.
  - The model does not choose the layout during generation.
- **D-13 AI dynamic views ARE allowed in generation,** up to the existing per-session view cap (5). They are subject to the existing D-02/D-03 rules (Phase 139): aggregated views build unfiltered, and row views over the threshold wait for a filter. Discard and the D-03a sweep must drop them.
- **D-14 Profiling follows `AI_DATA_ACCESS`:**
  - In query mode the AI may use `get_column_profile` to pick columns, for example to avoid high-cardinality breakdowns.
  - In schema mode it works from column names and types only.
  - There is no new server-side profiling path past the admin setting.

### Audit viewer page
- **D-15 Placement:** a new top-level page in the admin menu beside Users and Roles.
  - Gated by `audit:view`: the nav entry is hidden without it, and the server API returns 403.
  - The page is titled "AI activity", so the `audit:view` "audit log" can grow to other events later.
  - Update the `permissionGroups.ts` description "View the audit log (viewer ships in a future release)" to describe the shipped viewer. Description text only, no permission change.
  - Mirror the layout of `RolesPage.tsx` / `UsersPage.tsx`.
- **D-16 Rows and detail:**
  - Each row is compact: time, user, dashboard, kind, question (truncated), outcome, steps and duration.
  - Clicking a row opens a detail panel with:
    - the full question and the answer text;
    - tools used, changes, and queries (SQL, row count and duration from `queries_json`);
    - provider and model, tokens, data-access mode, allow-list version and outcome detail.
- **D-17 Filters:**
  - date range (default last 7 days);
  - outcome, which includes the Keep outcomes `kept`, `keep_conflict`, `keep_denied`, `keep_invalid` and `keep_failed`;
  - dashboard.
  - There is **no user filter**. The username shows in each row and in the detail panel only.
- **D-18 Answer text:** shown exactly as stored. Row values means query result rows, which are never stored; the page shows only what `ai_audit` already holds. A one-line note on the page says query results are never logged. There is no change to what the audit writes.
- **D-19 Paging:** newest first, 50 per page, done server-side, with Prev/Next and a total count. Retention is 90 days.
- **D-20 Kind column** with three values: Ask, Generate and Keep.
  - Keep rows have an empty `question` and `changes_json` holding counts and ids. They show a summary such as "Kept 3 added, 1 edited, 0 removed" in place of a question.
  - Generate asks must be marked as such. This needs a way to tell them apart in `ai_audit`, for example a new `kind` column or an outcome/detail convention; the planner chooses.
  - Deadline-finalized rows can have `tools_json` = `[]` (Phase 140 note). The page must not assume `tools_json` is complete.
- **D-21 Deleted dashboards:** rows stay, and show a muted "Deleted dashboard #id" with no link. No dashboard name is stored in the audit.

### Live provider UAT
- **D-22 Ollama runs in Docker, not as a native install.** The operator does not want unnecessary software on the Mac.
  - Use the `ollama/ollama` image with a named model volume, port 11434 published, and `AI_BASE_URL=http://localhost:11434/v1`.
  - Recommend raising the Docker Desktop VM from 4 to 8 CPUs for speed.
  - Cleanup at the end is `docker rm` plus removing the volume and image.
  - The 5 GB pull and container start need operator approval at UAT time.
- **D-23 Named local model:** `qwen2.5:7b-instruct` (4-bit, about 4.7 GB). It runs CPU-only, so expect about 3–6 minutes per multi-step answer. Use `AI_TIMEOUT_MS` up to 600000 for the Ollama run only.
- **D-24 Gemini model:** `gemini-3-flash-preview` with `AI_TIMEOUT_MS` of at least 120000.
  - The operator sets `.env`. Claude never reads or edits `packages/server/.env`, and the operator also restarts or switches providers.
  - The dev `.env` had the invalid `AI_MODEL=Antigravity`, which must be fixed first.
- **D-25 Gemini live set:**
  - **(a) Core ask and trailer:** add, edit and remove widgets; follow-ups and choices from the reply trailer, which closes the AIWID-V20-05 Partial; a clarification; Revert.
  - **(b) Filters and views:** a filter set by the model (138 casing rules) and dynamic views, including the D-25 saved-view removal ask (139).
  - **(c) Query mode** (`AI_DATA_ACCESS=query`): whether the model uses `run_query` and `get_column_profile` as intended, and the audit `queries_json` (SQL, row count, duration, no row values).
  - **(d) Generate and Keep:**
    - generate, refine and Keep one dashboard;
    - Discard another and check SQLite and Kinetica are clean (SC1/SC2);
    - a Keep after a model-driven ask (141 follow-up);
    - the audit viewer showing these rows (SC3).
- **D-26 Ollama core set:** one add/edit ask with the trailer, one filter, one Generate with Keep, and one Discard check. Views and query mode run on Gemini only.
- **D-27 Joins: create a small demo dimension table.**
  - A tiny lookup table, for example nyctaxi payment_type or vendor codes with a handful of rows, in a `uat` schema on the shared Kinetica.
  - Register it and join it to `demo.nyctaxi`.
  - **The operator must approve before anything is created on the shared instance.**
  - Use it for 139 step 8/8b (join preflight cancel, and join through a filter view, INNER and LEFT) and the 141 step 9 join note.
- **D-28 Re-run the S6 tool-calling spike** (`packages/server/src/spikes/toolCallSpike.ts`) against the current 12-tool set on both Gemini and the Ollama model.
  - The Gemini free tier (20 requests per day per model) may make it span two days or need `--runs 3`.
  - The Ollama run is unattended and may take hours on CPU.
  - Results feed the matrix.
- **D-29 Tested-models matrix:**
  - Evidence goes in the 142 UAT file.
  - Add a short "Tested models" table to the provider section of the root `README.md`, around line 227 (no server README exists). Columns: provider, model ID, tool mode, pass or partial, notes, date. It replaces "Ollama/local models: untested".
  - `packages/server/.env.example` is updated to the tested model IDs and timeouts. This also clears the 135 follow-up that `.env.example` still shows `gemini-2.5-flash` / 60000.
- **D-30 Who drives:** Claude drives the browser UAT over CDP, as in Phases 137–141. The operator signs in, sets `.env` values and approves the Docker pull and the creation of the demo table.

### Claude's Discretion
- How generate mode is signalled to the agent loop: a mode flag, a dedicated tool, or system-prompt rules. Also how the server checks the 4–8 count and applies the fixed-band layout.
- The schema for the pending flag and the sweep timing, beyond D-03a.
- The audit API shape, and how Generate rows are told apart (D-20).
- Exact copy for the form option, the "keep or discard the first" prompt and the audit page note. Follow existing copy style: plain sentences and sentence case.

</decisions>

<specifics>
## Specific Ideas

- **Gemini free-tier budget is a real planning constraint.** The free tier allows 20 requests per day per model, and one ask uses several requests (one per tool step).
  - The full Gemini live set (D-25) plus the S6 re-run (D-28) will likely span several days on the free tier.
  - The plan should sequence the UAT so each day's quota is used deliberately, or note that a paid key shortens it.
  - Set `AI_MAX_ANSWERS_PER_DAY` to match.
- Generated dashboards should look the same every time whatever the model does: the layout is fixed by the server (D-12), and the widget mix is a guided recipe (D-09).
- The audit page should read as "AI activity", not a raw table dump. Keep rows read as plain sentences.
- Follow-ups noted in STATE that UAT steps should touch where cheap: the "last 30 days" suggestion returns 0 rows on 2009 nyctaxi data; the cap message starts lowercase. Fixing them isn't required.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope & requirements
- `.planning/ROADMAP.md` §Phase 142: goal, success criteria 1–4, RBAC note (audit:view reused)
- `.planning/REQUIREMENTS.md`: AIGEN-V20-01/02, AIGOV-V20-05, AIPRV-V20-02/03; deferred list AI-F3, AI-F11, AI-F12
- `.planning/STATE.md`: "New debt / follow-ups" for Phases 135–141. Every live check deferred to 142 is listed there.
- `.planning/research/SUMMARY.md`: the generate design (create empty dashboard, then generate mode, then Keep), provider reality, and the phase-142 row, which says to supersede `packages/web/docs/mcp-action-seam.md`.

### Prior phase decisions this phase builds on
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-CONTEXT.md` and `135-SPIKES.md`: audit row design (D-11 audit:view), caps, the S6 method and verdict
- `.planning/phases/137-ai-widget-streaming-ui/137-CONTEXT.md`: AI widget sizes, chat, errors and Retry, reply trailer
- `.planning/phases/139-session-only-dynamic-views/139-CONTEXT.md`: view lifecycle (logout drop, boot sweep, cap 5), the D-02/D-03 build rules, joins (D-07)
- `.planning/phases/139-session-only-dynamic-views/139-14-UAT-RESULTS.md`: steps 8/8b deferred (joins)
- `.planning/phases/140-query-data-access-mode-injection-hardening/140-CONTEXT.md` and `140-13-UAT-RESULTS.md`: query-mode rules, `queries_json`
- `.planning/phases/141-keep-persist-ai-changes/141-CONTEXT.md` and `141-14-UAT-RESULTS.md`: Keep contract, audit Keep outcomes, step 9 join note deferred

### Provider docs
- `README.md` (~line 225–227): AI provider status paragraph, to be replaced or extended by the tested-models table
- `packages/server/.env.example`: AI block (Gemini and Ollama examples)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DashboardCreate` (`packages/web/src/components/DashboardsPage.tsx` ~548): the New Dashboard form to extend (D-01). It uses `createDashboard` from `api/client.ts`.
- Agent loop: `packages/server/src/lib/ai/` (`agentLoop.ts`, `runAnswer.ts`, `gateway.ts`, `tools/`, `replyTrailer.ts`, `providers/openaiCompat.ts`) and the route in `packages/server/src/aiRoutes.ts`.
- Keep: `packages/server/src/aiKeepRoutes.ts`, `lib/aiKeepApply.ts`, `lib/aiKeepValidate.ts`. The Keep transaction is where the D-05 pending flag clears.
- View lifecycle: `packages/server/src/lib/aiSessionViews.ts` (registry, logout drop, boot sweep) and `aiDvRoutes.ts`. It is the model for the D-03a dashboard sweep.
- Audit: `packages/server/src/lib/aiAudit.ts` (`admitAiAnswer`, `finalizeAiAnswer`, `recordAiKeep`, retention sweep) and the `ai_audit` table in `packages/server/src/db.ts` ~225 (indexes on ts and username+ts; there is no dashboard index yet).
- Permissions: `AUDIT_VIEW` in `packages/server/src/lib/permissions.ts:34` and `packages/web/src/lib/permissions.ts:25`. Nothing enforces it today.
- Admin pages to mirror: `packages/web/src/components/UsersPage.tsx` and `RolesPage.tsx`. Navigation is the `Page` union in `packages/web/src/App.tsx:39` and the gated restore list around line 443.
- Layout math and per-type sizes from Phase 136 (shared grid layout), for the D-12 fixed bands.
- S6 spike: `packages/server/src/spikes/toolCallSpike.ts` and `toolCallSpikeMetrics.ts`.
- DEV harness `window.__kbiAiHarness` and the playwright-core CDP setup (memory: browser-uat-via-cdp-playwright) for UAT driving.

### Established Patterns
- Session-layer ops with negative temp ids, folded on the client; Keep remaps them in one sync better-sqlite3 transaction (141).
- `dashboards.version` triggers and own-write chains (141). Creating a generated dashboard and its widgets goes through these, so the generating tab must not see false conflicts.
- Replacing the widget list must keep the stale-id guard and `data-grid` (memory rgl-list-swap-layout-storm). A generated dashboard swapping in 5–9 widgets is exactly this case.
- UI uses existing `global.css` classes only (`btn-primary btn-sm` + `ghost-sm` in `ds-actions`, `ds-field`, `config-group`). Use theme tokens, no hex. CSS bugs pass every gate, so verify visually in light and dark mode.
- Do all GSD bookkeeping by hand; gsd-tools mutation commands corrupt STATE.md.

### Integration Points
- Dashboard list and GET filtering for D-04 visibility (server dashboard routes plus the list in `DashboardsPage`).
- The logout handler and boot sequence (where the `ai_session_views` drop and sweep already run), for the D-03a deletes.
- New audit read route(s) gated by `audit:view`, and a new `Page` entry plus nav item in `App.tsx`.

</code_context>

<deferred>
## Deferred Ideas

- Audit log export and a user filter on the audit page: not chosen (D-17). Revisit if admins ask.
- Storing the dashboard name in audit rows so it survives deletion: not chosen (D-21).
- Already deferred in REQUIREMENTS: AI-F3 (multi-table generate), AI-F11 (live Claude), AI-F12 (other layer types), re-generation over an existing dashboard.

</deferred>

---

*Phase: 142-generate-audit-viewer-live-provider-proofs*
*Context gathered: 2026-10-23*
