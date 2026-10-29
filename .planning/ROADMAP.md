# Roadmap

> **Shipped milestones (v1.0–v1.10):** details collapsed to `milestones/` per the complete-milestone pattern. See `MILESTONES.md` and `milestones/v1.*-ROADMAP.md` for the archived phase-by-phase records (Phases 1–57).

## Milestones

- ✅ **v1.0 Authentication & Per-User Access** — Phases 1-3 (shipped 2026-04-29) — see `milestones/v1.0-ROADMAP.md`
- ✅ **v1.1 OIDC SSO Support** — Phases 4-8 (shipped 2026-05-02) — see `milestones/v1.1-ROADMAP.md`
- ✅ **v1.2 Interactive Dashboards** — Phases 9-12 (shipped 2026-05-06) — see `milestones/v1.2-ROADMAP.md`
- ✅ **v1.3 Unified Dashboard Filtering** — Phases 13-17 (shipped 2026-05-07) — see `milestones/v1.3-ROADMAP.md`
- ✅ **v1.4 Map Info Popup** — Phases 18-24 (shipped 2026-05-11) — see `milestones/v1.4-ROADMAP.md`
- ✅ **v1.5 Spatial filtering on map** — Phases 25-31 (shipped 2026-05-14) — see `milestones/v1.5-ROADMAP.md`
- ✅ **v1.6 Dynamic Views** — Phases 32-36 (shipped 2026-05-19) — see `milestones/v1.6-ROADMAP.md`
- ✅ **v1.7 WMS Class Break, Track & Legend** — Phases 37-45 (shipped 2026-06-05) — see `milestones/v1.7-ROADMAP.md`
- ✅ **v1.8 Roles & Permissions (RBAC)** — Phases 46-51 incl. 50.1-50.3 (shipped 2026-06-06) — see `milestones/v1.8-ROADMAP.md`
- ✅ **v1.9 Better Track Rendering** — Phases 52-54 (shipped 2026-06-08) — see `milestones/v1.9-ROADMAP.md`
- ✅ **v1.10 Per-Dashboard View Permissions** — Phases 55-57 (shipped 2026-06-10) — see `milestones/v1.10-ROADMAP.md`
- ✅ **v1.11 Programmable Widgets (Cross-Widget Control)** — Phases 58-61 incl. 58.1 / 60.1 / 60.2 (shipped 2026-06-15) — see `milestones/v1.11-ROADMAP.md`
- ✅ **v1.12 Drill-Down on Dynamic-View-Backed Widgets** — Phases 62-64 incl. 63.1 (shipped 2026-06-16) — see `milestones/v1.12-ROADMAP.md`
- ✅ **v1.13 Calendar Heatmap Visualization** — Phases 65-69 incl. 68.1 / 68.2 (shipped 2026-06-18) — see `milestones/v1.13-ROADMAP.md`
- ✅ **v1.14 Class-Break & Chart Config Refinements** — Phases 70-73 (shipped 2026-06-19) — see `milestones/v1.14-ROADMAP.md`
- ✅ **v1.15 Column Formatting & View Lifecycle** — Phases 74-79 (shipped 2026-06-22) — see `milestones/v1.15-ROADMAP.md`
- ✅ **v1.16 White-Label Theming** — Phases 80-84 (shipped 2026-06-26) — see `milestones/v1.16-ROADMAP.md`
- ✅ **v1.17 Chart Number Formatting** — Phases 85-87 (shipped 2026-06-27) — see `milestones/v1.17-ROADMAP.md`
- ✅ **v1.18 Per-Visualization Filter Selection** — Phases 88-96 incl. 93.5 (shipped 2026-06-30) — see `milestones/v1.18-ROADMAP.md`
- ✅ **v1.19 Visualization Customization** — Phases 97-104 (shipped 2026-07-08) — see `milestones/v1.19-ROADMAP.md`
- ✅ **v1.20 Filter Panel** — Phases 105-110 incl. 109.1 / 109.2 (shipped 2026-08-27) — see `milestones/v1.20-ROADMAP.md`
- ✅ **v1.21 Dashboard Links & Map Default View** — Phases 111-116 (shipped 2026-09-14) — see `milestones/v1.21-ROADMAP.md`
- ✅ **v1.22 Dashboard Settings Links** — Phase 117 (shipped 2026-09-15) — see `milestones/v1.22-ROADMAP.md`

- ✅ **v1.23 Zoom-Aware Layer Legend** — Phase 118 (shipped 2026-09-16) — see `milestones/v1.23-ROADMAP.md`

- ✅ **v1.24 Dashboard Export & Import** — Phases 119-121 (shipped 2026-09-21) — see `milestones/v1.24-ROADMAP.md`

- ✅ **v1.25 Schema Sync** — Phases 122-126 (shipped 2026-09-30) — see `milestones/v1.25-ROADMAP.md`

- ✅ **v1.26 Large Exports & Fixes** — Phases 127-132 (shipped 2026-10-08) — see `milestones/v1.26-ROADMAP.md`

- 🚧 **v2.0 AI-Driven Dashboards** — Phases 133-143 (in progress, started 2026-10-08)

---

## v2.0 AI-Driven Dashboards — IN PROGRESS (started 2026-10-08)

**Goal:** A user asks a question in an AI visualization on the dashboard, and the AI answers by changing the dashboard itself (adding/removing/editing visualizations, map layers and dynamic views, applying filters) instead of replying in a chat transcript. Designers can also ask it to build a starter dashboard from a table.

**Operator constraints:** no Anthropic API key — the OpenAI-compatible adapter is the live-verified path (Gemini via AI Studio free tier for development, demo tables only; one local Ollama model); the Claude adapter is `fetch`-based and unit-tested only; no `@anthropic-ai/sdk`. AI is off by default and env-configured. Research: `research/SUMMARY.md` (spikes S1–S7). Requirements: `REQUIREMENTS.md` (44).

### Phases

- [x] **Phase 133: AI Contract, Shared Package, SSYNC-F6 Fix & Spikes** — close the column-interpolation hole; shared zod contract; AI env validated at startup; spikes S1/S2/S3/S7 decided
- [x] **Phase 134: Session Layer Engine (client, no LLM)** — per-user op log, effective-list merge, per-answer undo, discard/reload revert
- [x] **Phase 135: Server Gateway, Agent Loop, Providers & Governance Core** — one gateway, agent loop, adapters, schema-only access, "Use AI" permission, audit, caps
- [x] **Phase 136: Structural & Edit Ops** — AI adds/removes/edits visualizations and map layers and lays them out
- [x] **Phase 137: AI Widget & Streaming UI** — full-chat AI widget (size-driven inline/drawer), per-answer revert, progress, cancel, follow-ups, clarify, highlights, Keep/Discard bar
- [x] **Phase 138: AI Filters** — AI applies/clears filters through the existing filter path
- [x] **Phase 139: Session-Only Dynamic Views** — structured-spec views, ad-hoc materialize, temp-view lifecycle
- [x] **Phase 140: Query Data-Access Mode & Injection Hardening** — guarded read-only SELECT; poisoned-input fixtures
- [x] **Phase 141: Keep (Persist AI Changes)** — one all-or-nothing save with edit-rights and 409 checks
- [ ] **Phase 142: Generate, Audit Viewer & Live Provider Proofs** — starter dashboard, audit page, live Gemini + Ollama UAT
- [ ] **Phase 143: Claude Desktop MCP Connector** — Claude Desktop builds and edits dashboards through Kinetica BI's gateway; text widget; fit-to-screen layout (added 2026-10-29)

**Order:** 133 → {134 ∥ 135} → 136 → 137 → 138 → 139 → 140 → 141 → 142. 134 (client) and 135 (server) touch disjoint files and may run in parallel after 133.
**Research-phase flagged:** 133 (S1, S3), 135 (S6), 137 (S2 through the deploy proxy), 139 (S1, S7), 140 (SQL guard, S7). Standard: 134, 136, 138, 141, 142.

### Phase Details

### Phase 133: AI Contract, Shared Package, SSYNC-F6 Fix & Spikes
**Goal:** The column-interpolation hole is closed, the shared AI contract exists for web and server, AI env config is validated at startup (bad config disables AI; the app still starts), and the risky unknowns have recorded decisions.
**Depends on:** — (first phase)
**Requirements:** AISAFE-V20-01, AIPRV-V20-01
**Research flag:** yes (S1 ad-hoc dv materialize, S3 per-type validators; also S2, S7)
**Success Criteria:**
1. `POST /api/filter/materialize` rejects a column that does not exist on the target table or view, with no materialize statement executed (dv path: one read-only column lookup); a valid column works as before.
2. With no `AI_*` env set the app behaves exactly as today; with AI enabled but misconfigured, the app still starts with AI disabled and the server log names the bad setting (never the key value) — no live provider call at boot (133-CONTEXT D-06/D-07).
3. The `packages/shared` contract builds and is imported by both web and server; an invalid op is rejected by the shared schema.
4. S1, S3 and S7 (as the operator's non-admin Kinetica user) and S2 (against `:4000`; proxy deferred to 137) each have a recorded decision and fallback in `133-SPIKES.md`, approved by the operator at a checkpoint before 134/135 start.
**Plans:** 10 plans

Plans:
- [x] 133-01-PLAN.md — column audit doc + pure columnGuard helper + filter/materialize table-path & spatial guard, red-before specs, fixture re-seed (wave 1)
- [x] 133-02-PLAN.md — guard exports + info/query (spatial cols, schema/table match, dv-view Tier B); export/info fixture re-seed (wave 2)
- [x] 133-03-PLAN.md — guard quantile/top-values/column-stats (assertSchemaTableColumn); DELETE ?viewName= own-prefix guard (wave 3)
- [x] 133-04-PLAN.md — packages/shared: move widgetAction/actionAllowList, AiOp union, allow-list v3, web shims (wave 1)
- [x] 133-05-PLAN.md — server consumes @kinetica-bi/shared; build:server = tsc --noEmit + esbuild --alias; Dockerfile, README, CI shared job (wave 2)
- [x] 133-06-PLAN.md — AI_* env config: pure parseAiConfig, degrade-to-disabled boot log, test-env leak guard, .env.example, bundle check (wave 4)
- [x] 133-07-PLAN.md — spikes S2 (SSE on :4000) + S3 (per-type validators); create 133-SPIKES.md (wave 1)
- [x] 133-08-PLAN.md — spikes S1 + S7 live as the operator's non-admin Kinetica user (operator checkpoint) (wave 2)
- [x] 133-09-PLAN.md — dv-path column guard using the S1-decided column source + cache (wave 5)
- [x] 133-10-PLAN.md — phase gates, D-15 operator review of 133-SPIKES.md + live guard check, STATE/REQUIREMENTS/ROADMAP bookkeeping (wave 6)

### Phase 134: Session Layer Engine (client, no LLM)
**Goal:** A per-user, in-memory session layer applies AI-style changes as a unit, undoes them answer by answer, and reverts cleanly — driven by a test harness, no AI involved.
**Depends on:** 133
**Requirements:** AISES-V20-01, AISES-V20-02, AISES-V20-03, AISES-V20-07
**Research flag:** standard
**Success Criteria:**
1. Scripted ops from a test harness apply as one unit, appear only for the asking user, and cause no dashboard DB write.
2. Turn 2 does not erase turn 1's patches — the test fails before rebuild-from-log exists (`widgetActionStore` source-keyed replacement hazard).
3. Reverting to any earlier answer restores that answer's state as one unit; jumping forward again works until a new question replaces the later answers.
4. Discard or reload restores the saved dashboard exactly, and AI geometry is never persisted by `onLayoutChange` (test + operator human-verify).
**Plans:** 10 plans

Plans:
- [x] 134-01-PLAN.md — widgetActionStore recency ordering (D-11: most recent wins; radio-vs-radio becomes recency) (wave 1)
- [x] 134-02-PLAN.md — pure session core: contracts, evaluateTurn, foldSession (op-log + fold, not C7 inverses), ref-stable merge helpers (wave 1)
- [x] 134-03-PLAN.md — in-memory aiSessionStore (turns/cursor/cap/reset, AI_SOURCE_ID rebuild-from-log), useAiEditLock/useEffectiveLayers/useAiSessionActions, test harness (wave 2)
- [x] 134-04-PLAN.md — map, legend, info card read session-aware layers; eye toggle never persists temp layers (D-16) (wave 3)
- [x] 134-05-PLAN.md — DashboardsPage effective widgets/layers, static saved items + guarded onLayoutChange, 14th cleanup reset, DEV console harness (wave 3)
- [x] 134-06-PLAN.md — requestLeave + portalled AiLeaveDialog; App-level leave paths; logout reset (wave 3)
- [x] 134-07-PLAN.md — edit lock on the open dashboard: gated can*, disabled toolbar + notice, handler guards, paired specs (wave 4)
- [x] 134-08-PLAN.md — DashboardsPage Back / popstate re-push / beforeunload (StrictMode-safe) (wave 5)
- [x] 134-09-PLAN.md — phase gates, operator browser verify via harness, STATE/ROADMAP/REQUIREMENTS bookkeeping (wave 6)
- [x] 134-10-PLAN.md — gap closure: allow-listed map/records overlay keys translated at the render seam (GAP-134-01); harness position feedback (GAP-134-02) (gap, runs before 134-09 resumes)

### Phase 135: Server Gateway, Agent Loop, Providers & Governance Core
**Goal:** The server runs the agent loop behind one validation gateway, with pluggable providers, schema-only data access by default, the "Use AI" permission, audit records and usage caps.
**Depends on:** 133 (parallel with 134)
**Requirements:** AISAFE-V20-02, AISAFE-V20-03, AIPRV-V20-04, AIPRV-V20-05, AIGOV-V20-01, AIGOV-V20-02, AIGOV-V20-04, AIGOV-V20-06
**Research flag:** yes (S6 tool calling on Gemini / a local model)
**RBAC note:** this phase OWNS the "Use AI" permission and its ripple across the count-asserting specs (rbacDb, rbacMigration, web permissions, RolesPage) plus `permissionGroups` wiring — assign it to ONE plan.
**Success Criteria:**
1. A change failing any gateway check (shape, allow-list, permission, live schema) is rejected and never reaches the browser; a change from a user lacking `ai:use`, view access to the dashboard, or access to a referenced table/column is rejected. (Session-only structural changes are allowed for any `ai:use` user; edit rights are enforced at Keep, Phase 141 — 135 D-16.)
2. A user without "Use AI" is refused by the server; an admin can grant it on the Roles page; the AI sees only tables the user can see.
3. In schema mode a planted canary row value never appears in any outbound provider message, including error paths; the API key never reaches the browser or logs.
4. Each answer writes an audit record with no row values; exceeding the step or hourly cap returns a message saying why.
5. The Claude adapter passes unit tests against recorded fixtures and is documented as not live-verified; tests never call a real provider or read the dev key.
**Plans:** 12 plans (6 waves)
**Completed 2026-10-13:** 12/12 plans. S6: Gemini `gemini-3-flash-preview` = native tool calling (provisional, 19 clean trials, free-tier daily quota cut the run; see 135-SPIKES.md); Claude adapter unit-tested only, NOT live-verified; AIGOV-V20-01 widget-side gate deferred to 137.

Plans:
- [x] 135-01-PLAN.md — `ai:use` permission + full RBAC ripple (server catalog/seed/specs, web mirror, "AI" group, Roles page) [W1]
- [x] 135-02-PLAN.md — Contracts: shared AskRequestSchema (D-17), AI cap/history/tool-mode config + env blanking, provider/tool types, SSE parser, egress choke point, AI test kit [W1]
- [x] 135-03-PLAN.md — ai_audit table, SQLite-derived caps with exact D-15 messages, retention sweep wired after startExportSweep [W1]
- [x] 135-04-PLAN.md — OpenAI-compatible adapter (hand-written fixtures, Gemini quirks) + D-14 retry budget [W2]
- [x] 135-05-PLAN.md — Claude adapter (doc fixtures, NOT live-verified) + JSON action-plan fallback decorator [W2]
- [x] 135-06-PLAN.md — Gateway (shape → allow-list → permission → reference → live schema; D-16 semantics) + shadow + user-credentialed live schema [W2]
- [x] 135-07-PLAN.md — Tool registry: read tools (access-filtered), validate-only mutate tools, flat schemas, schema-mode query gate [W2]
- [x] 135-08-PLAN.md — Context builder: snapshot projection, system prompt, bounded history with answer text (D-05/06/17) [W2]
- [x] 135-09-PLAN.md — Agent loop: atomic buffered ops, step cap, 429 retry, cancel/timeout/session re-check + scripted/recording providers [W3]
- [x] 135-10-PLAN.md — /api/ai/ask (SSE) + /api/ai/config, provider factory, ai:use 403, caps 429, one audit row per answer [W4]
- [x] 135-11-PLAN.md — End-to-end proofs: schema-mode canary egress matrix + key-sentinel matrix with positive controls [W5]
- [x] 135-12-PLAN.md — S6 spike (operator-run checkpoint), tested-models matrix, provider docs, phase bookkeeping [W6]

### Phase 136: Structural & Edit Ops
**Goal:** The AI can add, remove and edit visualizations and map layers and place them sensibly, with every change validated against the live schema.
**Depends on:** 134, 135
**Requirements:** AIACT-V20-01, AIACT-V20-02, AIACT-V20-03, AIACT-V20-04, AIACT-V20-05, AIACT-V20-06, AIACT-V20-10, AIACT-V20-11
**Research flag:** standard (after S3)
**Success Criteria:**
1. Scripted ops add, remove and edit a visualization, and add, remove and restyle a heatmap map layer; each is undoable.
2. A nonexistent table or column is repaired within 2 attempts or refused, never applied; the model cannot emit hex colours.
3. New widgets do not overlap and the AI can resize and reorder; layout sensibility is operator human-verify.
4. An AI-added or restyled heatmap layer renders tiles and legend correctly (both `buildWmsParams` sites; operator human-verify in light and dark).

**Carry-forward (135 verification, 2026-10-13):** (W2) the agent loop's rejection counter is keyed by tool name and never resets — after 2 rejections, later VALID calls of that tool are blocked ('too many invalid attempts') and recorded only in `tools`, not `skipped`. Key it per target or reset on success, and surface blocks in `skipped`, as part of criterion 2. Also add layer column-existence checks for heatmap `patch` ops (today only the allow-list is checked).

**Note (134 UAT, 2026-10-12):** see TD-V20-ALLOWLIST-KEYS in PROJECT.md — the chart metric/aggregation and layer-opacity allow-list fields must be designed before AI chart edits.

**Map test plan (operator, 2026-10-09):** automated — validator round-trip against the operator's real saved map/heatmap-layer configs + invalid cases, and buildWmsParams snapshot for AI heatmap layers on BOTH MapChartRenderer sites; operator-run — WMS GetMap render check (HTTP 200 image/png, non-blank) like spike S1.4; human-verify — light/dark visual. Optional later: claude-in-chrome screenshots (no new dependency).
**Scope note (operator, 2026-10-09):** v2.0 AI widget subset is bar, line, pie, table, bignumber, records and map; the AI adds/edits heatmap map layers only (others: AI-F12). Map widget and heatmap layer config get hand-written validators in this phase.
**Completed 2026-10-14:** 12/12 plans (+ fix 5233a6e, radio capture skips "" values). Operator UAT approved 2026-10-14 (run by Claude in the operator's signed-in Chrome, `136-12-UAT-RESULTS.md`): VAL_ATTR accepted by Kinetica and visibly changes the render (weighted and control tiles both 200 image/png with heat); default blur 5 matches Kinetica; light/dark pills, 9/18/36-col sizes with no overlap, set_layout, map + heatmap on a map-less dashboard, removal approval and undo all PASS. Carried to 137: legend "AI heat" row/eye (137-12 visual), AI bignumber label "value", layer-only edits not highlighting the host map (AIWID-V20-06). TD-V20-ALLOWLIST-KEYS resolved.
**Plans:** 12 plans (6 waves)

Plans:
- [x] 136-01-PLAN.md — Shared contract: allow-list v4 keyed by real widget types, positive AI config catalogue, palette/ramp vocabularies, grid layout math, new ops (set_layout, change_widget_type, set_widget_title, heatmap add_layer), approvals + clarification shape; all ripple specs [W1]
- [x] 136-02-PLAN.md — Heatmap render path: valueColumn -> VAL_ATTR, editor "Value column" control, HMAP specs on both MapChartRenderer buildWmsParams sites [W1]
- [x] 136-03-PLAN.md — Web generation libs: extracted buildChartSql (byte-identical), deriveChartConfig with hardening, palette map, AI widget defaults, heatmap layer defaults, drift specs [W2]
- [x] 136-04-PLAN.md — Gateway: catalogue, dashboard-tables-only (D-22), refusals (D-02/D-04/dv), removal clarification (D-06), map host (D-11/D-12), layer column checks (D-21), placement + layout, non-disclosing hints, refKey/slot [W2]
- [x] 136-05-PLAN.md — Flat typed mutate tools (12) + system rules; layer map ids in the dashboard view [W3]
- [x] 136-06-PLAN.md — Agent loop: W2 fix (per-reference counting), AI_MAX_NEW_WIDGETS cap, clarifications + skipped on the SSE result [W4]
- [x] 136-07-PLAN.md — Web overlay seam (TD-V20-ALLOWLIST-KEYS): key/value translation, SQL regeneration in WidgetRenderer, opacity -> POINTOPACITY, radio canary [W3]
- [x] 136-08-PLAN.md — Session fold + store: all Phase 136 ops, removal approval, generated SQL, rendering heatmap layers, layout overrides, AI-edited flags [W4]
- [x] 136-09-PLAN.md — Scripted end-to-end proofs (server loop + route SSE) and real saved-config round-trip [W5]
- [x] 136-10-PLAN.md — DashboardsPage gap-fill placement + AI layout overrides + baseline tables; minimal AI badge [W5]
- [x] 136-11-PLAN.md — DEV harness for all ops incl. approveRemoval; session-only eye for AI layers; client end-to-end with undo [W5]
- [x] 136-12-PLAN.md — Operator GetMap (with/without VAL_ATTR), light/dark + layout human-verify, optional single live ask, bookkeeping [W6]

### Phase 137: AI Widget & Streaming UI
**Goal:** Users ask questions in an AI widget that keeps a full chat conversation and watch the dashboard answer, with progress, cancel, follow-ups, clarification, highlights, a per-answer "Revert dashboard to this state" button and a Keep/Discard bar.
**Depends on:** 136
**Requirements:** AIWID-V20-01, AIWID-V20-02, AIWID-V20-03, AIWID-V20-04, AIWID-V20-05, AIWID-V20-06, AIWID-V20-07, AISES-V20-04, AIGOV-V20-01 (closes the widget clause; Partial since 135)
**Research flag:** yes (S2 streaming through the deploy proxy)
**Success Criteria:**
1. A designer adds an AI widget; a large tile shows the chat inline, a small tile shows an ask bar + history icon and opens the shared conversation in a portalled drawer (full-screen on narrow screens); a user without "Use AI" cannot add or use it.
2. A question changes the dashboard and appears in the shared conversation with the AI's full answer; progress shows, Cancel works, and a second ask is blocked while one runs.
3. Each answer shows full plain-text content, clickable follow-ups and a working "Revert dashboard to this state" button; an ambiguous question yields 2–3 clickable choices.
4. A provider error, cap or quota failure shows a clear message and leaves the dashboard unchanged.
5. Highlights and the Keep/Discard bar with counts are legible in light and dark (operator human-verify; reuse `global.css` classes, portal any modal).

**Carry-forward (135 verification, 2026-10-13):** (W1) the per-user in-flight AI lock is released only after the answer finishes; a provider that ignores abort, or a hung Kinetica probe (no abort/timeout, ~300 s undici default), can hold AI_BUSY. Add a route-level hard deadline that always releases the lock, and give the Kinetica probes an abort signal. Kinetica job tagging/cancel for user Cancel is also in scope here (see memory: abort does not cancel jobs).
**Plans:** 12 plans in 5 waves
Plans:
- [x] 137-01-PLAN.md — Shape-key defect fix red-first (W2-5/W2-6, SSE-R2 updated); gateway refuses ops on the AI widget; server ai:use guard on widget create/retype [W1]
- [x] 137-02-PLAN.md — W1: route hard deadline always releases the lock; abortable + tagged Kinetica probes; tag/find/cancel jobs on Cancel/deadline [W1]
- [x] 137-03-PLAN.md — S2: nginx `location = /api/ai/ask` streaming block + red-first textual spec (+ optional nginx -t) [W1]
- [x] 137-04-PLAN.md — Shared result contract (followUps, applied, choose_option); web SSE-over-POST client, AI availability hook, pure request builder [W1]
- [x] 137-05-PLAN.md — Pure helpers: starter questions + fallback follow-ups, chat copy/labels, change counts + changed ids, size constants; "ai" chart type registered [W1]
- [x] 137-06-PLAN.md — D-20 server: reply-trailer parser, prompt rule, result.followUps/applied/choose_option [W2]
- [x] 137-07-PLAN.md — Store run/draft/epoch/highlight + chat on turns; ask runner (one at a time, cancel, errors, choices); fold guard; DashboardContext ai accessor [W2]
- [x] 137-08-PLAN.md — AiChat: bubbles, empty state, ask box, progress/cancel, errors, choices, follow-ups, per-answer Revert; AiWidget.css [W3]
- [x] 137-09-PLAN.md — Keep/Discard bar + portalled Discard confirm; fading accent outline on changed widgets [W3]
- [x] 137-10-PLAN.md — AiWidgetRenderer (gates, inline vs small tile) + portalled drawer; WidgetRenderer branch; DEV harness chatTurn/fakeRun [W4]
- [x] 137-11-PLAN.md — DashboardsPage: picker gate + 12x40 add, duplicate gate, bar mount, shared AskContext, cancel on leave [W4]
- [x] 137-12-PLAN.md — Gates, operator light/dark human-verify (quota-free; live ask optional), bookkeeping by hand [W5]

**Completed 2026-10-15:** 12/12 plans (+ UAT fix 81117b2). Operator UAT 2026-10-15 (run by Claude in the operator's signed-in Chrome, `137-12-UAT-RESULTS.md`), light and dark, harness only (no provider request): steps 1-8 PASS after 7 visual issues were fixed in 81117b2 and re-verified (older choices greyed, question not shown twice, no follow-ups/Revert on clarification turns, drawer right-anchored with slide-in, Send inside the small tile, bar and leave-dialog copy); 136-12 carry-overs PASS (KPI "Sum of fare_amount", layer-only edit highlights the host map with +1 edited, Layers-panel "AI heat" row + eye). Step 8: operator accepted a visible-but-disabled Keep for AISES-V20-04 (Keep enabled in 141). Step 9 live ask skipped, so AIWID-V20-05 stays Partial (live trailer adherence in 142). Not eyeballed: drawer below 900 px, no-access user view, multi-widget run sync (all unit-tested). S2: `location = /api/ai/ask` nginx streaming block, red-first text spec + `nginx -t` OK (live status-line check through :8080 not run). W1: route hard deadline always releases the AI lock; probes abortable and tagged, tag/find/cancel on Cancel/deadline. Shape-key repair fix red-first (W2-5/W2-6, SSE-R2 updated). AIGOV-V20-01 closed (widget gate UI + server create/patch guard).

### Phase 138: AI Filters
**Goal:** The AI applies and clears filters through the same path a click uses, so charts, records tables and map tiles narrow consistently.
**Depends on:** 137
**Requirements:** AIACT-V20-09
**Research flag:** standard
**Success Criteria:**
1. "Show only X" narrows charts, records tables and map tiles exactly as a click would; clear removes it.
2. Undo restores the prior per-source filter state; filter badges read `filterCombinationStore`.
3. A filter on a nonexistent column is refused, and the per-table filter cap holds.
4. Map tiles visibly narrow against real Kinetica (operator human-verify).
**Plans:** 8 plans in 5 waves
Plans:
- [x] 138-01-PLAN.md — Shared contract: source-keyed apply_filter/clear_filter, aiFilter.ts (cap 25, coercion, value-free reasons), snapshot filters max 300 [W1]
- [x] 138-02-PLAN.md — Server: shadow filter map, gateway checks (ambiguity choose_option, column/type, cap, temp dv), flat tools, prompt rules, scripted e2e [W2]
- [x] 138-03-PLAN.md — Web session: fold evaluation, filter-only answers never lock (D-09), entry deltas, cursor sink, value-free snapshot filters [W2]
- [x] 138-04-PLAN.md — ActiveFilter.aiApplied + "AI" chip tag (top bar + panel), drift guards [W2]
- [x] 138-05-PLAN.md — aiFilterApplier (click actions only), per-column undo/redo/discard, click-equivalence orchestrator proof [W3]
- [x] 138-06-PLAN.md — applyAiTurn (outline, notes, zero-row check) wired into askRunner, session actions and Discard [W4]
- [x] 138-07-PLAN.md — Chat filter notes + "Clear this filter", chip call sites, snapshot wiring, DEV harness filter/clearFilter/highlight/filterState [W4]
- [x] 138-08-PLAN.md — Gates, operator light/dark human-verify incl. SC4 real map tiles (quota-free), bookkeeping by hand [W5]

**Completed 2026-10-16:** 8/8 plans. Operator UAT 2026-10-16 (run by Claude in the operator's signed-in Chrome, `138-08-UAT-RESULTS.md`), light and dark, real Kinetica, harness only (no provider request): steps 1-8b PASS. SC4: an AI filter narrows the bar and the map tiles via a combination view whose name is IDENTICAL to a hand click (click-equivalence proof). Gateway refusals (unknown column, cap, ambiguity question) covered by automated specs; per-column revert/forward/discard, AI chip tag, outline, zero-row notes with "Clear this filter" and the D-18 scoped-widget note verified live. Step 9 live ask skipped (live model adherence in Phase 142). Follow-ups: intermittent blank dark-mode map after an AI filter (todo, needs debug); "Clear this filter" looks like the follow-up buttons (todo).

### Phase 139: Session-Only Dynamic Views
**Goal:** The AI can create and remove session-only dynamic views from a structured description, and their temporary Kinetica views never outlive the session.
**Depends on:** 138
**Requirements:** AIACT-V20-07, AIACT-V20-08, AISAFE-V20-04, AISAFE-V20-06
**Research flag:** yes (S1 follow-through, S7 Kinetica limits)
**Success Criteria:**
1. A structured spec compiles server-side with quoted identifiers and a server-chosen name; raw SQL or an unknown column is rejected.
2. A widget or layer pointed at the view renders, and map tiles follow (both `buildWmsParams` sites).
3. The temp Kinetica view is dropped on undo, discard, dashboard switch, logout and server restart (verified by listing views in Kinetica); the per-session view cap and TTL hold.
4. Removing a view repoints or removes its dependents with no dangling references.
**Plans:** 14 plans in 6 waves
Plans:
- [x] 139-01-PLAN.md — Shared contract: structured AiDvSpec (no SQL field), checks, materialize/drop request, add/remove_dynamic_view + add_layer.dynamicViewId, value-free snapshot extensions, D-17 dependents planner [W1]
- [x] 139-02-PLAN.md — Server D-02/D-03 for saved views: lib/dvThreshold (source gate + tagged output preflight for aggregated templates), list `aggregated` flag, tag/signal in createOrReplaceMaterialized [W1]
- [x] 139-03-PLAN.md — Server foundation: AI_DV_* env, server-chosen tab-safe names (aiDvName), ai_session_views registry, dropViewsForSid, sweepAiViewsOnBoot (TTL-only gap logged) [W1]
- [x] 139-04-PLAN.md — compileAiDvSpec: live-schema validation, quoted alias-qualified SQL, APPROX_MEDIAN/PERCENTILE, DATE_TRUNC, joinRefs, Keep-compatible {view} template [W2]
- [x] 139-05-PLAN.md — Ad-hoc routes: POST /api/ai/dynamic-view/materialize (cap, joined filter views, tagged/cancellable preflight, registry, deadline), drop, list [W3]
- [x] 139-06-PLAN.md — Server lifecycle: logout drops AI views before deleteSession, boot sweep before listen, D-23 negative-dv branch in /api/filter/materialize (_dvn names) [W4]
- [x] 139-07-PLAN.md — Gateway + shadow: add/remove_dynamic_view (cap, live schema, compile + stamp, dependents repoint/drop, D-25 ask-once), AI views filterable (D-23) [W3]
- [x] 139-08-PLAN.md — Web fold: session views, removal repoint/drop in one entry, D-24 rebind, dv binding on add, no-dangling property test, change counts [W2]
- [x] 139-09-PLAN.md — Web lifecycle: per-tab nonce + generations, dv sink, DROP on undo/remove/discard/switch, API client calls, value-free snapshot fields [W3]
- [x] 139-10-PLAN.md — Gateway binding/rebind against view columns, add_dynamic_view tool + dynamicViewId args, AI_DV_RULES, runAnswer limits, scripted e2e [W4]
- [x] 139-11-PLAN.md — Web chain: merge session rows, ad-hoc materialize branch (join/gen tokens, pending drops), aggregated fast-path skip, D-05 note + follow-up, orchestrator aiNonce (D-23) [W4]
- [x] 139-12-PLAN.md — DashboardsPage/App wiring (single merge point, saved-only baseline, id>0 DROP guards), D-20 AI tag on view names, change-bar counts [W5]
- [x] 139-13-PLAN.md — Regression specs: both MapChartRenderer buildWmsParams sites + WidgetRenderer with negative dv ids; DEV harness view commands (quota-free UAT) [W5]
- [x] 139-14-PLAN.md — Gates, operator light/dark UAT (Kinetica version, U1-U9, real tiles both map sites, lifecycle listing incl. logout/restart, cap, removal), AISAFE-V20-04 joins amendment, bookkeeping by hand [W6]

**Completed 2026-10-20:** 14/14 plans. Operator UAT 2026-10-20 (run by Claude in the operator's signed-in Chrome, `139-14-UAT-RESULTS.md`), Kinetica 7.2.3.12, light and dark, harness only (no provider request): median/percentile/DATE_TRUNC views build; real WMS tiles follow an AI view at BOTH `buildWmsParams` sites; drill filters on AI-view bars work; removal repoint/drop with one-Revert restore; lifecycle verified by listing views in Kinetica (undo, discard, dashboard switch, logout, restart all empty; cap refuses the 6th). UAT fix 2cef90c (dv-bound widgets never bind to a table filter combination). Deferred to Phase 142: join preflight-cancel and join-through-filter-view live checks (no joinable table pair on dashboard 12), live ask (step 12). Open minor: undone AI view leaves a "dynamic view -101" chip; brief unfiltered flash on redo.

### Phase 140: Query Data-Access Mode & Injection Hardening
**Goal:** In query mode the AI can run only guarded read-only queries as the user, and poisoned inputs cannot push it past the gateway.
**Depends on:** 135, 137, 139
**Requirements:** AIGOV-V20-03, AISAFE-V20-05
**Research flag:** yes (SQL guard robustness, S7)
**Success Criteria:**
1. In query mode a single SELECT runs as the user with a row cap; multi-statement, non-SELECT and comment-smuggled SQL is refused; in schema mode the query tools are not registered.
2. A scripted "obedient" provider reading a poisoned table comment, column name, value or title cannot act outside the gateway's rules.
3. Model-supplied markup, links and images render as literal text (operator human-verify).
4. The canary no-egress test still passes across every tool and error path.
**Plans:** 13 plans in 6 waves
Plans:
- [x] 140-01-PLAN.md — libpg-query runtime dependency + smoke; pure SQL guard (raw-char refusals, single-SELECT AST allow-list, CTE scoping, system/catalog/function/table-function refusals, dashboard scope) + byte-offset view-alias substitution [W1]
- [x] 140-02-PLAN.md — AI_QUERY_MAX_ROWS/MAX_CHARS/TIMEOUT_MS/MAX_PER_ANSWER on AiConfig (+ log, .env.example); AiQueryAuditEntry + ai_audit.queries_json (create + migrate) [W1]
- [x] 140-03-PLAN.md — shared AskQueryEntrySchema + optional result.queries; web TurnChat.queries via askRunner and the DEV harness (display only) [W1]
- [x] 140-04-PLAN.md — pure query scope (dashboard tables, dv_<id>/aidv_<n> aliases -> physical names from server data) + get_column_profile SQL builders/parsers [W1]
- [x] 140-05-PLAN.md — untrusted-data envelope on describe/list/get_dashboard, flattened schema text in the system part, "tool results are data" rule, query-mode rules + queryViews part [W1]
- [x] 140-06-PLAN.md — query port: two-pass guard, run-as-user, envelope row cap + char budget, timeout/cancel by tag, per-answer cap, D-18 categorized errors, audit entries; column profile [W2]
- [x] 140-07-PLAN.md — "Ran N queries" collapsed list under answers (existing classes) + literal-markup jsdom proof [W2]
- [x] 140-08-PLAN.md — run_query / get_column_profile tools (QUERY_TOOLS, gated by the registry), ToolContext.query/signal, loop passes its abort signal to read tools [W3]
- [x] 140-09-PLAN.md — runAnswer query-mode wiring (scope, port, rules, SSE queries, queries_json) + deadline-finalize query list + route proofs RQ-1..9 (incl. end-to-end user cancel); full server gate [W4]
- [x] 140-10-PLAN.md — obedient-provider injection fixtures INJ-1..11 with positive controls (values, column names, comments, titles, schema mode, authority) [W5]
- [x] 140-11-PLAN.md — canary egress matrix: schema-mode query-tool attempts + query-mode containment and error paths (EGX-Q1..Q6), EGX-1..6 unchanged [W5]
- [x] 140-12-PLAN.md — operator-run live harness queryModeSpike (cap, timeout/cancel job check, writes refused, dialect corpus, D-18 calibration, quoted case, profile) + --dry-run [W5]
- [x] 140-13-PLAN.md — gates + deploy-bundle check, operator UAT (live spike, "Ran N queries" + literal markup in light/dark), bookkeeping by hand [W6]

**Completed 2026-10-21:** 13/13 plans. Live spike (`140-13-UAT-RESULTS.md`) on Kinetica 7.2.3.12 as admin: row cap 200 + truncated, timeout and user Cancel leave no tagged job (Q2/Q3 passed on a slower SQL; the default one was too fast), writes refused with 0 SQL sent, no PG-accepted/Kinetica-rejected dialect queries, model sees only categorized errors. Operator UAT driven by Claude in the operator's Chrome, light and dark, harness only: "Ran N queries" list, long-SQL wrapping (inline tile and small-tile drawer), markup rendered literally with no request to evil.test. Deploy image loads libpg-query. Live Gemini query-mode ask skipped (invalid dev AI_MODEL) -> Phase 142. Open minor: SQL line font ligature turns `--` into an en dash; spike default slow SQL too fast. Gate script printed FAILED solely on environmental `lib.exportRunner.memory`.

### Phase 141: Keep (Persist AI Changes)
**Goal:** A user with edit rights saves the AI's changes in one all-or-nothing step that never overwrites someone else's edits.
**Depends on:** 139, 140
**Requirements:** AISES-V20-05, AISES-V20-06
**Research flag:** standard (S4 temp-id re-keying)
**Success Criteria:**
1. Keep persists additions, edits and removals with real ids, all-or-nothing under an injected mid-transaction failure.
2. A user without edit rights is not offered Keep, and a forged Keep request is rejected server-side.
3. If the dashboard changed since the session began, Keep returns 409 and overwrites nothing.
4. After Keep, a reload shows the saved result; the UI says filters are not saved (operator human-verify).
**Plans:** 14/14 plans complete in 5 waves
Plans:
- [x] 141-01-PLAN.md — shared aiKeep.ts contract: strict capped change-set schema, exact D-02/D-08/D-12 texts, version-header format/parse helpers [W1]
- [x] 141-02-PLAN.md — dashboards.version column + kbi_ver_* triggers on widgets/layers/dynamic views/dashboard tables + updateDashboard bump + getDashboardVersion; DVER proofs incl. cascade + migration [W1]
- [x] 141-03-PLAN.md — negative-aware ref traversal (allowNegative) + collectSignedWidgetConfigRefs / remapTempRefs / remapTempFilterSelection; unmapped temp id throws [W1]
- [x] 141-04-PLAN.md — web store: completeKeep (keeps transcript as savedTurns, clears history/approval/overlay, drops temp views, keeps filters), keepBlocked, rekeyDvFilters, all Keep copy [W1]
- [x] 141-05-PLAN.md — before/after write stamps on 13 routes + per-list read stamps on 4 GETs + cors exposedHeaders + route-classification spec over app._router.stack [W2]
- [x] 141-06-PLAN.md — applyKeep: one sync transaction (version compare first, dv -> layer -> widget placeholders, temp-id rewrite, edits, removals, invariant) + SC1 RAISE(ABORT) injection proofs [W2]
- [x] 141-07-PLAN.md — requiredRights/missingRights (D-01/D-02), checkKeepChange (ownership, ai widget, retype, keys, refs), prepareKeep (live schema as user, server-side dv recompile without joinRefs) [W2]
- [x] 141-08-PLAN.md — extract mergeWidgetOverlay from WidgetRenderer; pure buildKeepPayload from the fold (configSet/configUnset, geometry baking, temp layer visibility) + Keep-equivalence spec + committed real-payload fixture + countViewToggles (D-20) [W2]
- [x] 141-09-PLAN.md — per-tab dashboardVersionStore (min of list reads + own-write edge chain), apiFetch header capture, never-throwing keepAiChanges [W2]
- [x] 141-10-PLAN.md — read-only saved turns + "Changes saved." in AiChat; saved turns sent as provider history (D-18) [W2]
- [x] 141-11-PLAN.md — AiKeepDialog ("Filters are not saved.") (+ D-20 view-toggle line) + AiKeepConflictDialog (D-08) + leave-dialog copy, editors only (AIDLG-3 edit, AIDLG-8) [W2]
- [x] 141-12-PLAN.md — POST /api/dashboards/:id/ai-keep + recordAiKeep audit + after-commit DROP; SC2 forged, SC3 409 (pre-check + in-transaction race), SC1 route atomicity; real-payload fixture applied; full server gate [W3]
- [x] 141-13-PLAN.md — keepRunner (refetch + one-block swap + rekey + completeKeep; conflict/permission/failure paths), AiChangeBar Keep states (BAR7-4 edit, D-03 hidden), DashboardsPage wiring + DashboardsPage.keep.spec; full web suite [W4]
- [x] 141-14-PLAN.md — step-0 gap gate (141-14-gap-gate.sh), all gates, operator UAT (reload, 409 two browsers, rights + forged fetch, temp views, dvFilters, tiles, light/dark), bookkeeping by hand [W5]

**Completed 2026-10-22:** 14/14 plans. Operator UAT (run by Claude in the operator's signed-in Chrome, `141-14-UAT-RESULTS.md`), Kinetica 7.2.3.12, light and dark, harness only (no provider request). SC1 (all-or-nothing, real ids) and SC2 (forged request refused) proven by server specs; SC3 409 verified live with two tabs (overwrites nothing, own-write chains pass); SC4 reload matches after Keep, "Filters are not saved." seen. UAT step 6 skipped by the operator (route specs cover it), join note deferred to Phase 142. UAT fixes: e5bb56e, eaad490, 3aef06f.

### Phase 142: Generate, Audit Viewer & Live Provider Proofs
**Goal:** Designers generate a starter dashboard from a table, admins browse the AI audit log, and the operator proves the provider live on Gemini and a local model.
**Depends on:** 141
**Requirements:** AIGEN-V20-01, AIGEN-V20-02, AIGOV-V20-05, AIPRV-V20-02, AIPRV-V20-03
**Research flag:** standard
**RBAC note:** the audit viewer reuses the existing `audit:view` permission (Phase 135 D-11, 2026-10-12) — no new permission, no spec ripple here.
**Success Criteria:**
1. A designer picks a table and gets 4–8 widgets suited to its columns, refinable by asking and keepable (operator human-verify of fit and layout).
2. Discarding a generated dashboard leaves no dashboard, widgets or views (checked in SQLite and Kinetica).
3. An admin with the audit permission browses the log (no row values); a user without it cannot open the page.
4. The operator completes live runs on Gemini and on one named Ollama model, recorded in a UAT file with a tested-models matrix.
**Plans:** 11 plans in 5 waves
Plans:
- [ ] 142-01-PLAN.md — dashboards.generated_by/generated_pending_at + one-pending-per-user unique index, ai_audit.kind + (dashboard_id, ts_ms) index, DTO generated_pending, creator-only override in canViewDashboard, enumerator filter, grant refusal, Keep clears the flag in-transaction [W1]
- [ ] 142-02-PLAN.md — shared placeGenerateBands + GENERATE_AI_RECT, server generateMode.ts (limits, recipe, nudge, band rewrite), agentLoop beforeFinish one-shot nudge [W1]
- [ ] 142-03-PLAN.md — web generateDashboard/discardGeneratedDashboard client, take-once generate intent, "Generate from a table" on the New Dashboard form, D-06 prompt, "Not kept yet" label [W1]
- [ ] 142-04-PLAN.md — .env.example tested model IDs/timeouts/Docker recipe/AI_GENERATED_TTL_HOURS, README Generate + AI activity docs, mcp-action-seam superseded banner [W1]
- [ ] 142-05-PLAN.md — aiGenerate.ts lifecycle (create in one transaction, one discard helper), dropViewsForDashboard, POST /api/dashboards/generate + /:id/discard-generated, DELETE via helper, logout/boot/TTL sweeps [W2]
- [ ] 142-06-PLAN.md — audit kind on every row; server-derived generate mode in the ask path (limits, recipe, nudge, 4-8 floor/ceiling, bands) [W2]
- [ ] 142-07-PLAN.md — web open generated dashboard: auto-start first ask once, pending note + server Discard dialog, Keep refetch, RGL guard regression [W2]
- [ ] 142-08-PLAN.md — web AI activity page (filters, paging, detail), audit client, nav gate on audit:view, permission description text [W2]
- [ ] 142-09-PLAN.md — GET /api/ai/audit (+ /:id, /dashboards) behind audit:view, bound filters, kind derivation, Keep summaries, no unkept names [W3]
- [ ] 142-10-PLAN.md — gap gate + full gates, UAT steps (both providers, Gemini quota plan), Gemini live UAT checkpoint + results [W4]
- [ ] 142-11-PLAN.md — Ollama-in-Docker live UAT checkpoint, Tested models matrix, phase bookkeeping by hand [W5]

### Phase 143: Claude Desktop MCP Connector
**Goal:** A user builds or changes a Kinetica BI dashboard from Claude Desktop (their Claude subscription, no API key), with every change checked by the same gateway as the in-app AI and nothing saved until they press Keep.
**Depends on:** 141 (Keep), 142 (audit kinds)
**Requirements:** AIMCP-V20-01 .. AIMCP-V20-09 (promotes AI-F6)
**Context:** `phases/143-claude-desktop-mcp-connector/143-CONTEXT.md` (started as `spike/kbi-mcp`, 2026-10-28)
**Success Criteria:**
1. Claude Desktop builds a dashboard that the user reviews and keeps; a rejected change comes back with reasons and Claude repairs it. *(done in the spike)*
2. The dashboard fits one screen when there are not too many widgets, and a text summary sits at the top sized to its text. *(done)*
3. The connector signs in with a revocable personal access token; no password is stored in Claude Desktop's config.
4. Discarding, or never opening the link, leaves no dashboard behind (checked in SQLite).
5. The AI activity page shows Claude Desktop builds as their own kind; Keep works with the in-app AI off.
6. Claude can change an existing dashboard and apply filters, reviewed with the same Keep bar.
**Done so far (spike, on `spike/kbi-mcp`):** 91ede8b connector + routes; 2ae8a5b clickable AI layers + fit layout; f5611dc chart fixes; d592ecb text widget, KPI format, axis decimals; 35e752e, 0961ef6, 5301497 sizing and KPI fixes. UAT: `143-UAT-RESULTS.md`.

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 133. AI Contract, Shared Package, SSYNC-F6 Fix & Spikes | 10/10 | Complete | 2026-10-09 |
| 134. Session Layer Engine | 10/10 | Complete | 2026-10-12 |
| 135. Server Gateway, Agent Loop, Providers & Governance Core | 12/12 | Complete | 2026-10-13 |
| 136. Structural & Edit Ops | 12/12 | Complete | 2026-10-14 |
| 137. AI Widget & Streaming UI | 12/12 | Complete | 2026-10-15 |
| 138. AI Filters | 8/8 | Complete | 2026-10-16 |
| 139. Session-Only Dynamic Views | 14/14 | Complete | 2026-10-20 |
| 140. Query Data-Access Mode & Injection Hardening | 13/13 | Complete | 2026-10-21 |
| 141. Keep (Persist AI Changes) | 14/14 | Complete | 2026-10-22 |
| 142. Generate, Audit Viewer & Live Provider Proofs | 9/11 | In UAT (G10 S6 spike left) | - |
| 143. Claude Desktop MCP Connector | 9/9 requirements | Complete (operator UAT passed; live token sign-in deferred) | 2026-10-29 |

---

## v1.26 Large Exports & Fixes — SHIPPED 2026-10-08
✅ v1.26 (Phases 127-132) — SHIPPED 2026-10-08 — full phase details archived in `milestones/v1.26-ROADMAP.md`
- [x] Phase 127: Row-Limit Ceiling, Caller Audit & Heatmap Truncation Fix
- [x] Phase 128: Export Job Core — Live Spike, Runner, Snapshot & Cancel
- [x] Phase 129: Export Routes — Resumable Download, History & Privacy
- [x] Phase 130: Export TTL Cleanup, Boot Reconciliation & Admin Caps
- [x] Phase 131: Client Export UI — Trigger Dialog, Progress & History
- [x] Phase 132: Line Chart Multi-Series Group By
**Verification:** 21/21 EXPRT-V126/LINE-V126 requirements Complete; all six phases verified (128 and 129 `human_needed`, 128's item closed live in 131 V10, 129's proxy-path resume still open). Web vitest 203 files / 4434 tests, web+server tsc clean, theme-guard 158/158, check-classnames clean, server `scripts/test-gate.mjs` GATE PASSED (set-based, 1803/1857 at the 131 verification; 132 was web-only). Operator-verified against a real Kinetica instance: 131 V1-V13 plus Z1-Z5 (1.5M-row export, snapshot isolation byte-identical, kill -9 restart reconcile) and 132 V1-V9. Audit `tech_debt`, no blockers (`milestones/v1.26-MILESTONE-AUDIT.md`).
**Known gaps carried, not smoothed over:** (1) **CSS and layout defects passed every automated gate and only the operator found them**: the export dialog was trapped inside its widget by grid CSS transforms, the dialog text was oversized, the Name field lost focus under StrictMode so Enter did not start the export, and the line Y axis was clipped; (2) **a wrong fix shipped first**: the `.gz` refusal was misdiagnosed as the gzip OS byte (`0418602`, reverted in `c83d138`), and the real cause was that Archive Utility refuses every `.gz`, so the format became `.zip`; (3) the integration checker's claim that formatted negatives get an apostrophe was **refuted** (d3 emits U+2212); (4) EXPRT-V126-05/07 were marked complete early in 128, then re-opened and completed in 131; (5) the plan checker kept catching non-discriminating guards, and more were reported during execution rather than satisfied; (6) `d3-format` was added to the server despite the "no new npm dependency" opening line; (7) proxy-path resume was never exercised.
**Open tech debt:** proxy-path resume; offset paging re-sorts per page; snapshot MV needs CREATE MATERIALIZED VIEW (untested as non-admin); `_kbi_exp_*` left to TTL by ended jobs; `EXPORT_DIR`/`EXPORT_VIEW_TTL_MINUTES` missing from `.env.example`; `exportRunner.memory.spec` contamination watch; unused web `ExportJobDto.compress`; records `page_size` override no-op (Phase 58); 132 V7 light/dark and epoch X labels unconfirmed; raw floats in line tooltips; Line vs Numeric Line merge deferred; operator dev `.env` `MAX_BAR_GROUP_BY_SERIES=2`; `EXPRT-F1`-`F4`, `CFGSQL-F1` deferred; carried: `SSYNC-F6`, `TD-V16-TEST-ISOLATION`, the theme-guard `global.css` exemption, `loadConfig(...).catch(() => {})`, OIDC never browser-verified.

---

## v1.25 Schema Sync — SHIPPED 2026-09-30
✅ v1.25 (Phases 122-126) — SHIPPED 2026-09-30 — full phase details archived in `milestones/v1.25-ROADMAP.md`
- [x] Phase 122: Schema Diff & Table-Missing Detection
- [x] Phase 123: Column Reference Enumeration
- [x] Phase 124: Impact Report
- [x] Phase 125: Apply & Sync History
- [x] Phase 126: Datasets UI, Access Gating & Operator Verification
**Verification:** 19/19 SSYNC-V125 requirements Complete; all five phases carry a passing VERIFICATION.md (126's written during the milestone audit). Web vitest 185 files / 4162 tests, web+server tsc clean, theme-guard 154/154, server `scripts/test-gate.mjs` GATE PASSED (set-based, 1490/1543, 8 documented failing files). Operator-verified against a real Kinetica instance 2026-09-30, 14/14 checks PASS (`phases/126-*/126-UAT.md`). Audit `tech_debt`, no blockers; F1/F2/PG-3 remediated the same day (`milestones/v1.25-MILESTONE-AUDIT.md`).
**Known gaps carried, not smoothed over:** (1) **three defects passed `tsc`, `vitest` AND `theme-guard` and only the operator found them** — the permission gate sealed itself shut (the client re-syncs permissions only on a 403, and a hidden button can never produce one), and the history font was wrong twice; (2) **the milestone audit found a guard recorded as closed that could not fail** — every MIRROR-PARITY test over the web's type Sets compared a hardcoded copy to a hardcoded copy, so a web-side edit reddened nothing; now read from source (`abb1304`), with a control run proving the old spec passed against a web mutation; (3) **same-screen staleness after apply** (audit F1) shipped past the operator checkpoint because the UAT script only checked the Dashboards config panels; fixed in `edd648b` but not yet re-verified live; (4) no automated gate covers colour or font size in `global.css`; (5) five of nine registered tables have been dropped from Kinetica, so most live checks return `table_missing`.
**Open tech debt:** `SSYNC-F1`-`F6` deferred (auto-repair on declared rename, rename-pairing UI, check-all-tables, dashboard staleness indicator, nullability, a server-side column-existence gate on `POST /api/filter/materialize`); `SCHEMA_APPLY_TABLE_MISSING_MESSAGE` kept with no HTTP emitter by operator decision; renderColumnType vs classifyFingerprint marker order proven only over a fixture; `DatasetsPage.spec.tsx` test that passes for the wrong reason (`deferred-items.md`); removing persisted `config.sql` is the named v1.26 candidate; carried: `TD-V16-TEST-ISOLATION`, the theme-guard `global.css` exemption, `loadConfig(...).catch(() => {})`, OIDC never browser-verified.

---

## v1.24 Dashboard Export & Import — SHIPPED 2026-09-21
✅ v1.24 (Phases 119-121) — SHIPPED 2026-09-21 — full phase details archived in `milestones/v1.24-ROADMAP.md`
- [x] Phase 119: Export
- [x] Phase 120: Import
- [x] Phase 121: UI + Cross-Environment Verification
**Verification:** 11/11 DXIM-V124 requirements Complete; web vitest 181 files / 4100 tests / 0 failed, web+server tsc clean, theme-guard 152/152, server `scripts/test-gate.mjs` GATE PASSED (set-based, 8 documented failing files). Operator-verified cross-environment 2026-09-18 and re-verified after the gap closure 2026-09-21, between two server processes with separate SQLite databases (`:4000`/`kinetica.db` and `:4001`/`env-b.db`). First milestone since v1.20 to require server work. Milestone audit graded `tech_debt` (no blockers) — see `milestones/v1.24-MILESTONE-AUDIT.md`.
**Known gaps carried, not smoothed over:** (1) **four defects shipped past `tsc`, `vitest` AND `theme-guard`, all four found by one operator checkpoint** — `config.spatialTargets[].tableId` missing from the reference inventory entirely (an imported map would filter against whatever table held that id, rendering confidently wrong data), `max_records: 0` (the documented UNLIMITED sentinel) rejected at the import boundary so no export with an unlimited dynamic view could be imported anywhere, custom metrics loaded for the wrong table, and `widget.config.sql` freezing the resolved metric expression; (2) **the fourth defect's signature was the side-by-side comparison PASSING** — the frozen SQL guarantees target matches source, so a naive A-vs-B check reads as a clean pass; it surfaced only because the operator noticed the config panel disagreeing with the chart. Root cause confirmed PRE-EXISTING by reproducing it in an environment never imported into, which is why the fix went into the renderer rather than import; (3) **a TENTH, text-valued reference kind existed and nine id-valued sweeps could not see it** — an audit that enumerates id fields is structurally blind to a string; a deliberate re-search found no others, but the lesson generalizes; (4) **phases 119 and 120 have no VERIFICATION.md** — never run through `gsd-verifier`, so 8 of 11 requirements appear in no phase verification report; graded `tech_debt` not `gaps_found` because the evidence was re-verified by hand and Phase 121's live round trip verified their output more stringently, but recorded because "green gates plus confident paperwork" is precisely the state the four defects above hid in; (5) **metadata portability only** — both SPAs ran under Vite (nginx same-origin path unverified) and both servers shared one `KINETICA_URL`; REF-3 (standalone Legend) was not re-exercised, that dashboard having no Legend widget; (6) **`gsd-tools` state/roadmap/phase mutation commands are unusable here, now well-evidenced** — `state begin-phase` and `milestone complete` each silently rewrote STATE.md (status reset to `unknown`, `stopped_at` rewound to a stale Phase 120-02 string, twice, from two different commands) and `verify key-links` cannot parse correctly-nested plan frontmatter; all v1.24 bookkeeping was done by hand; (7) 24 mutation probes across Phase 121 and the gap closure, all firing — two whose FIXTURES had to be strengthened rather than the probes weakened, one of them structurally undiscriminating because `fromSwap` and the new metric swap commute.
**Open tech debt:** `loadConfig(...).catch(() => {})` suspends a widget in `Loading...` forever on a rejected fetch — pre-existing and project-wide, now reachable from seven more widget types, the one item worth scheduling; `defect-dv-combination-filter-view.md` still OPEN (dv + filter COMBINATIONS, a v1.6/v1.18 naming seam); `DXIM-F1`-`F5` deferred.

---

<!-- LAYOUT NOTE (2026-09-11): archived milestones live at the END of this file
     and are NOT wrapped in <details>. Both details matter, and they were
     established empirically after a wrong first fix:
       - WRAPPED in <details>  -> `roadmap update-plan-progress` and `phase
         complete` silently no-op (they only rewrite content after the last
         closing details tag, which the archive was sitting after).
       - Archive moved to the TOP -> that fixed the above but broke
         `init plan-phase`'s phase_req_ids extraction, which returned null and
         would have silently skipped the requirements-coverage gate.
     Unwrapped + at the end is the only arrangement where BOTH work. Verified on
     phases 111/112/113. Keep new archives here, unwrapped.
     Also note: update-plan-progress stamps TODAY's date rather than preserving
     the original, so do not re-run it on an already-complete phase. -->

## v1.20 Filter Panel — SHIPPED 2026-08-27
✅ v1.20 (Phases 105-110 incl. 109.1 / 109.2) — SHIPPED 2026-08-27 — full phase details archived in `milestones/v1.20-ROADMAP.md`
- [x] Phase 105: Reverse-Mapping Pure Lib + Tests
- [x] Phase 106: Display-Mode Persistence
- [x] Phase 107: Panel Shell + Reflow + XOR Switch + Chips
- [x] Phase 108: Applies-To List + On-Canvas Highlight
- [x] Phase 109: Global Clear-All
- [x] Phase 109.1: Filter Scope for Custom-Panel Charts (INSERTED)
- [x] Phase 109.2: Wire Custom-Panel Charts into Filter-Scope Engine and Reverse-Map (INSERTED)
- [x] Phase 110: Designer Settings UI + Verification + Live UAT
**Verification:** 19/19 requirements Complete; both-stack automated gates green (web vitest 154 files / 3439 tests; server SET-BASED ⊆ TD-V16-TEST-ISOLATION); operator UAT PASS on all 8 groups. See `phases/110-*/110-VERIFICATION.md`.

## v1.21 Dashboard Links & Map Default View — SHIPPED 2026-09-14
✅ v1.21 (Phases 111-116) — SHIPPED 2026-09-14 — full phase details archived in `milestones/v1.21-ROADMAP.md`
- [x] Phase 111: Map Default View — Capture & Save
- [x] Phase 112: Map Default View — Apply on Load
- [x] Phase 113: Dashboard URL Sync
- [x] Phase 114: Deep Link Load & Error States
- [x] Phase 115: Deep Link Authentication Flow
- [x] Phase 116: Table Deep Links (added mid-milestone at operator request, partially promoting DLINK-F4)
**Verification:** 20/20 requirements Complete; web vitest 175 files / 3902 tests, web+server tsc clean, theme-guard green; frontend-only (`packages/server` unchanged throughout). See `phases/115-*/115-VERIFICATION.md` + `phases/116-*/116-VERIFICATION.md`.
**Known gaps carried, not smoothed over:** (1) scope was deliberately widened mid-milestone — Table Links (Phase 116) was an operator-added feature, not scope creep that slipped through; (2) Phase 116 criterion 6 was only half met — dashboard behaviour is byte-identical (clause 1 held, independently re-verified) but `lib/tableUrl.ts`/`hooks/useDeepLinkTable.ts` are structural duplicates of their dashboard siblings rather than a shared abstraction (clause 2 not met, deliberately — de-duplicating would have forced import-path edits across 132 tests and broken clause 1; recorded as `TLINK-F4`, graded 22/23 by the verifier for this reason); (3) the OIDC auth path (`kbi_returnTo` carry mechanism) was never browser-verified live in either Phase 115 or 116 UAT — both ran in password mode only, covered by automated tests + mutation probes but not seen working live; (4) TD-02 was audited and amended 2026-09-14 (commit `8847551`) — the claimed credential exposure does not exist in this repository's history, almost certainly describes a predecessor repo.

## v1.22 Dashboard Settings Links — SHIPPED 2026-09-15
✅ v1.22 (Phase 117) — SHIPPED 2026-09-15 — full phase details archived in `milestones/v1.22-ROADMAP.md`
- [x] Phase 117: Dashboard Settings Links
**Verification:** 8/8 DSET-V122 requirements Complete; web vitest 175 files / 3990 tests, web tsc clean, theme-guard 150/150; frontend-only (`packages/server` unchanged throughout, zero new dependency, no router). Operator UAT 23/23 checks PASS (UAT-117-G27, the OIDC half, recorded "not exercised" — password-mode-only instance). See `phases/117-*/117-VERIFICATION.md` + `phases/117-*/117-UAT.md`.
**Known gaps carried, not smoothed over:** (1) **the full test suite is non-deterministic under parallel load** — both the phase closeout and the independent verifier each needed THREE full-suite runs to observe one clean pass, reddening on a DIFFERENT file each time (`DatasetsPage.spec.tsx`, `actionEngine.canary.spec.tsx`, `App.tableDeeplink.spec.tsx`, `DashboardContext.spec.tsx` across the two rounds), with zero diff on disk and every failure clearing in isolation — this is the milestone's most significant finding and the operator has scheduled a dedicated investigation as the v1.23 target, see `deferred-items.md`; (2) `TLINK-F4` was RESOLVED, not deferred again — "keep duplicated" by measurement (the feature already touched all 132 dashboard tests unconditionally; extracting a shared core would additionally have put the table family's 100 tests in play, inside the phase whose highest-stakes requirement is not regressing a live URL) — there are now THREE parallel implementations, carried as a standing cost with an explicit reopening condition (a fourth linkable entity or a dedicated tech-debt phase); (3) two of the phase's own planning documents were wrong and both errors were caught before shipping — RESEARCH proposed unmount-clear timers guarded on id alone (would have wiped the URL one macrotask after every `edit→view` Save; shipped scoped on id AND mode instead), and a plan's audit for the highest-stakes requirement used a bare `git diff` with no revision range (a guard that could not fail — every task commits immediately); (4) TWENTY-ONE toothless acceptance criteria occurred across Phases 115-117 (nine found in Phase 117 alone), from prose-anchored greps, arithmetic errors, case-sensitivity mismatches, and a self-contradicting enumeration — all reported rather than satisfied by bending code, but recorded as a planner-side defect worth fixing at the source; (5) the OIDC path has STILL never been browser-verified, three milestones running (`AUTH_MODE=password` on this instance) — carried forward as open verification debt; (6) 20/20 mutation probes reddened as intended — zero non-firing, the positive counterpart to (4).

## v1.23 Zoom-Aware Layer Legend — SHIPPED 2026-09-16
✅ v1.23 (Phase 118) — SHIPPED 2026-09-16 — full phase details archived in `milestones/v1.23-ROADMAP.md`
- [x] Phase 118: Zoom-Aware Layer Legend
**Verification:** 7/7 ZLGND-V123 requirements Complete; web vitest 176 files / 4025 tests, web tsc clean, theme-guard 150/150; client-only (`packages/server` unchanged throughout, zero new dependency). Operator UAT 8/8 checks PASS — nothing recorded as not-exercised, the first phase in this project's recent history where every check was both runnable and run. See `phases/118-*/118-VERIFICATION.md` + `phases/118-*/118-UAT.md`.
**Known gaps carried, not smoothed over:** (1) a pre-existing SHIPPED bug was found and fixed — `MapChartRenderer.tsx`'s info-click gate (`isLayerVisibleAtCurrentZoom`) re-implemented the zoom-range check with raw inclusive bounds, diverging from what OpenLayers actually draws, so a layer visibly on the map at a fractional zoom just below its `minZoom` silently swallowed info-clicks; put in scope by explicit operator decision (overriding the researcher's "log as tech debt" recommendation) and fixed — there is now exactly ONE zoom predicate (`lib/zoomRangeBounds.ts`), confirmed by independent grep that no third implementation survives; (2) theme-guard's wholesale `global.css` hex-scan exemption was confirmed structurally, not just suspected — the guard only ever asserts hex IS present for allowlisted files, never that it is absent, so any hardcoded colour there passes every automated gate unconditionally; compensated this milestone with a hand-run hex+rgba audit (run three times independently — executor, orchestrator, verifier — all 0) plus separate light/dark operator checks; narrowing the exemption to `:root` blocks remains unscheduled and is now a well-evidenced candidate; (3) ~7 self-falsifying acceptance criteria occurred in this phase alone (3 caught before execution, 4 during) — running total across Phases 115-118 is roughly 28-32, the dominant cause being a plan mandating a code comment containing the very token its own grep counts — recorded as a planner-side defect worth fixing at the source, not executor error; (4) the web vitest suite's cross-run non-determinism (carried from v1.22 as `TD-V122-TEST-FLAKE`) was root-caused and fixed this milestone — TWO one-line async-query defects (RTL's unconfigured 1000ms `asyncUtilTimeout` vs vitest's 5000ms `testTimeout`, and one sync-`getBy*`-after-`await findBy*` site), not "cross-mode contamination" as first assumed — fixed in `cde63ae`; before: 0 of 4 full-suite runs clean, after: 4 of 4, and every Phase 118 verification passed on the first attempt with no re-runs; the server's `TD-V16-TEST-ISOLATION` set-based gate carries the same "contamination" attribution, never tested this way — worth re-examining before continuing to trust it; (5) the OIDC path has STILL never been browser-verified, four milestones running.
