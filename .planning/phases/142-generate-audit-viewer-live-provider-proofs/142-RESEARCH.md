# Phase 142: Generate, Audit Viewer & Live Provider Proofs - Research

**Researched:** 2026-10-23
**Domain:** AI agent-loop "generate" mode, server-side pending-dashboard lifecycle, audit read API + admin page, live Gemini/Ollama(Docker) provider proofs
**Confidence:** MEDIUM-HIGH (repo findings HIGH, verified by reading code; Ollama/Qwen runtime behaviour MEDIUM/LOW, only a live run settles it)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01..D-30 are locked. Copied in compressed form; the planner MUST read `142-CONTEXT.md` for the full text.

- **D-01** Entry = existing `DashboardCreate` (`DashboardsPage.tsx` ~548) gets a "Generate from a table" option: table picker + optional "what do you want to see" prompt next to Name/Description. Shown only with `ai:use` AND AI enabled (`/api/ai/config`). No second creation path, nothing on Datasets page.
- **D-02** Dashboard exists BEFORE Keep: create empty dashboard + table link through the existing routes -> run normal agent loop in a generate mode into the session layer -> Keep saves via the Phase 141 path -> Discard deletes the dashboard.
- **D-03** Unkept state marked server-side ("generated, never kept"). **D-03a** server deletes an unkept generated dashboard on logout (before the session is deleted), in a boot sweep before listen, and after an env cap (default 24 h; env name planner's choice, `AI_*` family, in `.env.example`). Deleting also drops its AI session views and widgets (same guarantee as Discard).
- **D-04** While unkept: visible only in its creator's list; everyone else's list AND direct GETs hide it.
- **D-05** After first Keep it is ordinary; pending flag clears IN the Keep transaction; later Discard only drops unsaved changes (Phase 141), never deletes the dashboard.
- **D-06** One unkept generated dashboard per user; second generation asks to Keep/Discard the first; SERVER enforces too.
- **D-07** Failure part-way (provider error, timeout, caps, Cancel): user stays on the empty generated dashboard; inline error + Retry (Phase 137); Discard still deletes; nothing auto-deletes except the D-03a sweep.
- **D-08** Generated dashboard always includes the AI Assistant widget, auto-placed in the right side column; saved with Keep.
- **D-09** Guided recipe: 1-3 KPIs (bignumber); time trend if date/time col; 1-2 breakdowns by low-cardinality cols; map + one heatmap layer if geometry/lat-lon; records table. AI picks columns, drops slots that don't fit. Server enforces **4-8 data widgets** (AI widget not counted, D-10). **D-09a** optional user prompt steers choices; recipe still fills gaps.
- **D-11** Map = map widget + one heatmap layer (other layer types = AI-F12).
- **D-12** Fixed-band layout placed by the SERVER whatever the model returns: KPIs row on top; trend + breakdowns middle; map + records table; AI widget side column right. Uses Phase 136 per-type default sizes + shared grid math. Model does not choose layout.
- **D-13** AI dynamic views allowed in generation up to the per-session cap (5), under Phase 139 D-02/D-03 build rules; Discard and the D-03a sweep must drop them.
- **D-14** Profiling follows `AI_DATA_ACCESS` (query mode may use `get_column_profile`; schema mode names/types only). No new server-side profiling path.
- **D-15** Audit viewer = new top-level admin-menu page "AI activity" beside Users/Roles; gated by `audit:view` (nav hidden without it; API 403). Update `permissionGroups.ts` description "View the audit log (viewer ships in a future release)" - text only, no permission change. Mirror `RolesPage.tsx` / `UsersPage.tsx`.
- **D-16** Compact rows (time, user, dashboard, kind, truncated question, outcome, steps, duration); click opens detail (full question + answer, tools, changes, queries SQL/rowCount/duration, provider/model, tokens, data-access mode, allow-list version, outcome detail).
- **D-17** Filters: date range (default last 7 days), outcome (incl. `kept`, `keep_conflict`, `keep_denied`, `keep_invalid`, `keep_failed`), dashboard. NO user filter (username shown in row + detail only).
- **D-18** Answer text shown as stored; one-line note "query results are never logged"; no change to what the audit writes.
- **D-19** Newest first, 50/page, server-side paging, Prev/Next + total count. Retention 90 days.
- **D-20** Kind column: Ask / Generate / Keep. Keep rows: empty `question`, `changes_json` counts+ids -> "Kept 3 added, 1 edited, 0 removed". Generate asks must be distinguishable in `ai_audit` (planner chooses how). Deadline rows can have `tools_json = []`; page must not assume completeness.
- **D-21** Deleted dashboards: rows stay, muted "Deleted dashboard #id", no link; no name stored in audit.
- **D-22** Ollama in Docker (not native): `ollama/ollama`, named model volume, port 11434 published, `AI_BASE_URL=http://localhost:11434/v1`; recommend Docker Desktop VM 4 -> 8 CPUs; cleanup = `docker rm` + remove volume + image; 5 GB pull + container start need operator approval at UAT time.
- **D-23** Local model `qwen2.5:7b-instruct` (Q4, ~4.7 GB), CPU-only, ~3-6 min per multi-step answer; `AI_TIMEOUT_MS` up to 600000 for Ollama run only.
- **D-24** Gemini `gemini-3-flash-preview`, `AI_TIMEOUT_MS >= 120000`. Operator sets `.env`; Claude never reads/edits `packages/server/.env`; dev `.env` has invalid `AI_MODEL=Antigravity`, fix first.
- **D-25** Gemini live set: (a) core ask + trailer (closes AIWID-V20-05 Partial), clarification, Revert; (b) model-set filter (138 casing) + dynamic views incl. saved-view removal ask (139); (c) query mode (`run_query`/`get_column_profile`, audit `queries_json`); (d) generate + refine + Keep one dashboard, Discard another and check SQLite + Kinetica clean (SC1/SC2), a Keep after a model-driven ask (141 follow-up), audit viewer showing these rows (SC3).
- **D-26** Ollama core set: one add/edit ask with trailer, one filter, one Generate with Keep, one Discard check. Views + query mode on Gemini only.
- **D-27** Create a small demo dimension table (e.g. nyctaxi payment_type or vendor codes, few rows) in a `uat` schema on the shared Kinetica, register it, join to `demo.nyctaxi`. **Operator must approve before anything is created on the shared instance.** Used for 139 step 8/8b and 141 step 9.
- **D-28** Re-run S6 spike (`toolCallSpike.ts`) against the current tool set on Gemini and the Ollama model; Gemini free tier (20 req/day/model) may span two days or need `--runs 3`; Ollama run unattended, may take hours.
- **D-29** Evidence in the 142 UAT file; short "Tested models" table (provider, model ID, tool mode, pass/partial, notes, date) in root `README.md` provider section ~line 227, replacing "Ollama/local models: untested"; update `packages/server/.env.example` to tested model IDs + timeouts (clears the 135 follow-up that it still shows `gemini-2.5-flash` / 60000).
- **D-30** Claude drives the browser UAT over CDP; operator signs in, sets `.env`, approves the Docker pull and the demo-table creation.

### Claude's Discretion
- How generate mode is signalled to the agent loop (mode flag, dedicated tool, or system-prompt rules); how the server checks the 4-8 count and applies the fixed-band layout.
- Schema for the pending flag and sweep timing beyond D-03a.
- Audit API shape; how Generate rows are told apart (D-20).
- Exact copy for the form option, the "keep or discard the first" prompt and the audit page note (plain sentences, sentence case).

### Deferred Ideas (OUT OF SCOPE)
- Audit log export and a user filter on the audit page.
- Storing dashboard name in audit rows.
- AI-F3 (multi-table generate), AI-F11 (live Claude), AI-F12 (other layer types), re-generation over an existing dashboard.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AIGEN-V20-01 | Designer picks a table, gets 4-8 widgets suited to its columns to review/refine/Keep | Generate route + generate mode (server-derived), recipe prompt, min/max enforcement hook in `agentLoop`, band layout rewrite, AI widget created up front; Standard Stack + Patterns 1-3 |
| AIGEN-V20-02 | Discarding a generated dashboard leaves no dashboard, widgets or views | `generated_by`/`generated_pending_at` columns, `discardGeneratedDashboard` helper, `ai_session_views` has NO FK (must be deleted explicitly), logout/boot/TTL sweeps; Pattern 4 |
| AIGOV-V20-05 | Admin browses AI log on an audit page gated by existing `audit:view` | `GET /api/ai/audit` (+ detail), `kind` column, dashboard index, new `Page` + Sidebar item; Pattern 6; no permission ripple |
| AIPRV-V20-02 | OpenAI-compatible provider proven live on Gemini | Live plan with Gemini quota budget, S6 re-run, spike scenario additions; Live UAT section |
| AIPRV-V20-03 | Same provider proven live on one named local model (Ollama) | Docker recipe, `OLLAMA_CONTEXT_LENGTH`, prompt size estimate, adapter risks; Live UAT section |
</phase_requirements>

## Summary

The existing machinery covers most of generate: the agent loop already buffers ops until the whole answer succeeds, the gateway already places `add_widget` rects, and Keep already remaps temp ids in one sync transaction. Three things are genuinely new on the server: (1) a **pending-dashboard lifecycle** (there is NO owner column on `dashboards` today and `canViewDashboard` is a permission/grant resolver where designers/admins bypass everything via `dashboards:manage_access`, so D-04 needs a new creator column and a hard override inside `canViewDashboard`); (2) a **generate mode** in `runAnswer`/`agentLoop` (raised step and widget limits, a recipe prompt, a min-count nudge, a server band-layout rewrite of `op.layout`); (3) an **audit read API** plus a `kind` column. The client work is a Generate section in `DashboardCreate`, a take-once auto-start of the first ask, pending-aware Discard (delete dashboard) and Keep (refetch to clear the flag), and a new `AiActivityPage`.

Biggest planning risks, in order: (a) **Provider cost/time**: current default limits (`AI_MAX_TOOL_STEPS=8`, `AI_MAX_NEW_WIDGETS=6`) make an 8-widget generate impossible, so generate mode needs its own floors; the Gemini free tier (20 req/day/model, measured in S6) cannot carry the full D-25 + D-28 set in under several days, and Qwen 7B on Docker CPU may not finish a Generate inside the 600000 ms ceiling. (b) **Ollama default context is 4k on CPU-only**; our request is ~5-7k tokens before conversation growth, so Ollama would silently truncate the system prompt. Must start the container with `OLLAMA_CONTEXT_LENGTH` (>= 16384). (c) **Visibility leaks**: 22 `canViewDashboard` call sites plus `GET /api/dashboards` plus two `listDashboards()` consumers (schema-check impact report) must all honour pending; centralising in `canViewDashboard` gets the 404-on-GET behaviour for free.

CONTEXT.md says "current 12-tool set"; the live registry actually exposes **18 tools in schema mode and 20 in query mode** (12 mutate + 3 read + 2 query + `remove_widget`/`remove_layer`/`remove_dynamic_view` registered from the mutate file; verified by building the registry). Tool schemas are ~12.0K chars (schema) / 12.9K (query), flat, with no `type:[...]` arrays. Use these numbers, not "12".

**Primary recommendation:** Add a dedicated server route `POST /api/dashboards/generate` (creates dashboard + table link + AI widget + pending flag in one SQLite transaction, enforces D-06), derive generate mode on the server from "dashboard is pending AND snapshot has zero data widgets" (so Retry and regeneration need no client flag), rewrite add_widget layouts into server-fixed bands after the loop, delete via one shared `discardGeneratedDashboard()` helper used by Discard, logout, boot and TTL, and add a `kind` column + `GET /api/ai/audit` behind `requirePermission(PERMISSIONS.AUDIT_VIEW)`.

## Standard Stack

No new runtime libraries are needed. Everything is built on what is in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | already installed | pending flag, audit read, sweep, `db.transaction` | `applyKeep` and `admitAiAnswer` already rely on sync transactions |
| zod (`zod/v4`) | already installed | audit query validation, ask schema | tool registry + shared schemas use it |
| express | already installed | new routes | existing `requirePermission(PERMISSIONS.X)` spread pattern |
| vitest | ^4.1.5 (web + server) | tests | existing |
| zustand | already installed | take-once "generate pending" intent | `aiSessionStore` precedent |
| `ollama/ollama` (Docker image) | latest at UAT time | local model host | D-22 |

### Supporting
| Item | Purpose | When to Use |
|------|---------|-------------|
| `packages/shared/src/layout.ts` (`AI_DEFAULT_SIZE`, `placeWidget`, `validateLayout`, `AI_GRID_COLS=36`) | band math | server band layout; add a pure `placeGenerateBands()` here so server and tests share it |
| `lib/ai/providers/scripted.ts` + `__setAiProviderFactoryForTest` | deterministic provider for route/loop specs | all generate-mode server specs (never a real provider) |
| `spikes/toolCallSpike.ts` (`--runs`, `--rpm`, `--mode`, `--out`, `--record`, `--raw`) | S6 re-run | D-28 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server-derived generate mode | `mode: "generate"` field on `AskRequestSchema` | Explicit but `AskRequestSchema` is `.strict()` (shared package change), and Retry (`runAsk(ctx, turn.prompt)`, AiChat.tsx:301) would drop the flag unless threaded. Server-derived survives Retry and an emptied pending dashboard. Use the flag only if a Generate refine round needs distinguishing. |
| Pending flag as `dashboards` columns | separate `generated_dashboards` table | A table avoids touching `Dashboard` type but every list/GET filter then needs a join; columns + one `canViewDashboard` check are simpler. Use columns. |
| AI widget as a temp (negative-id) add | real widget created up front | Keep CANNOT carry an AI widget: `AiKeepRequestSchema` types are `z.enum(AI_WIDGET_TYPES)` (no `ai`, shared/src/aiKeep.ts:28), the gateway locks AI widgets, and the widget route needs `ai:use`. Create it real, in the generate-route transaction. |

**Installation:** none for the app. Operator-side only: `docker` (already installed per D-22 context).

**Version verification:** no npm packages are added, so no registry check is needed. Verified externally: tag `qwen2.5:7b-instruct` exists, 7.62B params, 4.7 GB, Q4_K_M, lists the `tools` capability (https://ollama.com/library/qwen2.5:7b-instruct, fetched 2026-10-23).

## Architecture Patterns

### Recommended Structure (new/changed files)
```
packages/shared/src/layout.ts                 # + placeGenerateBands() pure band math (+ spec)
packages/server/src/db.ts                     # + dashboards.generated_by/generated_pending_at, ai_audit.kind, idx(dashboard_id,ts_ms)
packages/server/src/lib/aiGenerate.ts         # NEW: createGeneratedDashboard, discardGeneratedDashboard, sweeps, TTL reader, isPendingFor
packages/server/src/lib/aiGenerateMode.ts     # NEW: recipe prompt text, generate limits, band rewrite of ops, min-count check
packages/server/src/lib/ai/runAnswer.ts       # + generate detection + limits + post-loop band rewrite
packages/server/src/lib/ai/agentLoop.ts       # + optional beforeFinish hook (nudge once if < min widgets)
packages/server/src/lib/dashboardAccessDb.ts  # + pending override in canViewDashboard
packages/server/src/lib/aiKeepApply.ts        # + clear pending flag inside the Keep transaction
packages/server/src/lib/aiSessionViews.ts     # + dropViewsForDashboard(dashboardId, deps) (generalise dropSid)
packages/server/src/aiAuditRoutes.ts          # NEW: GET /api/ai/audit, GET /api/ai/audit/:id, dashboards facet
packages/server/src/aiGenerateRoutes.ts       # NEW (or in aiRoutes.ts): POST generate, POST :id/discard-generated
packages/server/src/index.ts                  # list filter, logout hook, boot sweep, interval sweep, route registration
packages/web/src/components/AiActivityPage.tsx (+ .css) # NEW, mirrors RolesPage/UsersPage
packages/web/src/App.tsx / Sidebar.tsx        # Page union, nav item (permission AUDIT_VIEW), gated restore list, render
packages/web/src/lib/permissionGroups.ts      # description text only
packages/web/src/components/DashboardsPage.tsx# Generate section in DashboardCreate; pending badge; pending-aware discard
```

### Pattern 1: Generate route + AI widget up front (answers Q1 AI-widget question)
**What:** `POST /api/dashboards/generate {tableId, prompt?, name?}` gated `requirePermission(DASHBOARDS_CREATE)` + `requirePermission(AI_USE)` (AND-gate spread, same form as `/api/dashboards/import`, index.ts:869-871) and AI enabled (`getAiConfig().enabled`, else 503 `AI_NOT_CONFIGURED`). In ONE `db.transaction`: refuse if the caller already has a pending row (409 `AI_GENERATE_PENDING` + the existing id/name so the UI can offer Keep/Discard, D-06), `createDashboard`, `addDashboardTable`, `createWidget(type:"ai", title:"AI Assistant", config:{layout:{x:24,y:0,w:12,h:40}})`, set `generated_by = lower(username)`, `generated_pending_at = now`. Returns the dashboard DTO.
**Why a dedicated route, not "existing routes":** CONTEXT D-02 says "through the existing routes", but D-06 demands server enforcement of one-per-user and D-03 demands a server-side marker. Neither can be set safely through `POST /api/dashboards` (its body is `{name, description}`; a client-set flag would be forgeable). Keeping dashboard creation, table link and flag atomic also removes a half-created state. This is a deliberate refinement of D-02's mechanism, not of its intent; flag it in the plan.
**AI widget size:** `AI_ASSISTANT_DEFAULT_SIZE = {w:12,h:40}` (web `lib/aiSession/constants.ts:35`); chat is inline only at `w>=12 && h>=24` (`AI_SMALL_TILE`). Side column = x 24..36 -> main area is 24 columns.
**Also verify:** the user can describe the chosen table in Kinetica as themselves (`createLiveSchema({username, principal}).describe(tableId)`) before linking, otherwise a dashboard is created on a table the user cannot read.
**Note on D-08 wording** ("saved with Keep"): the AI widget is persisted at creation, which is safe because the whole pending dashboard is deleted on Discard/sweep. Keep's baseline version already includes it.

### Pattern 2: Generate mode derived on the server
**What:** In `aiRoutes.ts` after the dashboard lookup, compute `generate = dashboard.generated_pending && snapshot.widgets.filter(w => w.type !== "ai").length === 0`. Pass `generate: true` into `runAnswer`. The client always sends a non-empty `question` (`AskRequestSchema.question` is `trim().min(1)`), so for the form with an empty optional prompt the client sends a fixed string such as "Create a starter dashboard for this table." Server composes the recipe; the user's text rides as the question (D-09a).
**runAnswer changes (file:line evidence):**
- `buildSystemParts` (context.ts:107-128) gets an optional `generate` block appended as one more `part.system(...)` (the recipe, tables already injected via `part.schema(tablesText)`).
- Limits: `maxToolSteps: config.maxToolSteps` (runAnswer.ts:142) and `maxNewWidgets: config.maxNewWidgets` (:144) become `Math.max(config.x, GEN_MIN)`. `steps` counts EVERY tool call, not provider rounds (agentLoop.ts `steps++` inside the per-call loop), so 8 widgets + 1 layer + 2-3 reads + optional views needs ~16-20; use `GEN_MIN_STEPS=20` (clamped to 50) and `GEN_MIN_WIDGETS=8`. The "Use at most N tool calls" sentence in the rules (context.ts:116) must use the raised value too.
- Do NOT count the heatmap layer or dynamic views as widgets: `addedWidgets++` only for `add_widget` (agentLoop.ts ~`if (g.op.op === "add_widget") addedWidgets++`).
**Min-count enforcement (4-8):** max is already enforced by `maxNewWidgets` (extras are skipped and reported). For the minimum add an optional `beforeFinish?: () => string | null` to `AgentLoopInput`, called in the `calls.length === 0` branch (agentLoop.ts ~line 206) BEFORE `text = turnText; break;`. If it returns a message and no nudge was sent yet, push it as a `user`/tool-less continuation (`convo.push({role:"user", parts:[part.user(msg)]})`) and `continue` the outer `for(;;)` loop; at most once. If still under 4 data widgets after the nudge: finalize as `outcome:"provider_error", detail:"generate_too_few"`, SSE error `AI_PROVIDER_ERROR`-style retryable message ("Couldn't build a starter dashboard from this table. Try again, or ask for specific charts."), zero ops (atomic apply already guarantees none are applied on non-ok). Keep `detail` a fixed code (audit rule: outcome_detail never holds provider text).
**Server-fixed band layout (D-12):** run after the loop on `result.ops` when outcome is ok, before `sse.send("result", ...)`: rewrite `op.layout` for every `add_widget`. The gateway's first-fit `placeWidget` (gateway.ts:661-664) places against the shadow, which in generate mode already contains the AI widget, so overlap is impossible, but the arrangement is model-order dependent; the rewrite makes it deterministic. Important: the shared default sizes do NOT fit beside a 12-wide side column (bignumber 9, bar 18, map 28, records 36, `AI_DEFAULT_SIZE` in layout.ts:11-19). Implement `placeGenerateBands(widgets: {tempId,type}[], opts:{mainCols:24})` as a pure shared function: row 1 = bignumbers, width `floor(24/n)` (min `AI_MIN_W=6`), h 14; row 2 = line/bar/pie/table in pairs or thirds of 24, h 30; row 3 = map (w 12-16) + records, fill remaining width; `validateLayout` over `[...rects, aiRect]` must return valid (use it in the spec). Group order: bignumber -> line -> bar/pie/table -> map -> records. Also emit/keep the AI rect unchanged (never include `ai` in ops).
**Rewriting `op.layout` safely:** ops are plain objects buffered in `bufferedOps`; `AiOpSchema` add_widget carries `layout` optional (aiOp.ts, "the gateway stamps this"). Also update `shadow` is not needed post-loop. Do the rewrite in a pure function over `AiOp[]` and spec it.
**Client folding:** `foldSession`/`applyAiTurn` consume `op.layout` as the widget rect (same as any ask), so no client change for layout. The first ask after creation has `snapshot.widgets=[ai widget]`, which the gateway needs for overlap (gateway.ts:375 comment: the AI widget "is in the snapshot for placement/overlap").

### Pattern 3: Starting the first ask from the client
`askRunner.ts` header: "Asks start ONLY from user handlers (click/Enter), never from effects: StrictMode double-invokes effects and would POST twice (quota)." So the auto-start must not be a bare `useEffect`. Recommended: `DashboardCreate`'s click handler calls the generate API, stores `{dashboardId, question}` in a NEW module-level/zustand slot OUTSIDE `aiSessionStore.initial` (because `reset()` bumps epoch and restores `initial`), then navigates to the dashboard. `AiChat` mounts with `ctx` and runs a **take-once** consume (`const intent = takeGenerateIntent(dashboardId)`: read-and-clear synchronously) inside an effect; the StrictMode second invocation finds nothing, so exactly one POST. Specs must assert exactly one `fetch` to `/api/ai/ask` under `<StrictMode>`. Fallback if this proves flaky: show the AI chat with the question pre-filled and a visible "Generate" click (one extra click, zero quota risk). Because the server derives generate mode, Retry (`runAsk(ctx, turn.prompt)`) automatically re-enters generate mode while the dashboard is still pending and empty.
**RGL storm (memory rgl-list-swap-layout-storm):** the generated widgets arrive as session (temp) widgets folded into the existing list, not a list replacement, but Keep swaps real ids in via `runKeep` (keepRunner.ts). The stale-id guard + `data-grid` in `handleLayoutChange` (DashboardsPage ~753) must be left intact; add a spec/UAT note: after Keep of a 5-9 widget generate, layout persisted equals the band rects (no 1x1 widgets).

### Pattern 4: Pending lifecycle (answers Q2)
**Schema (PRAGMA-guarded ALTER pattern, db.ts:495-513):**
```typescript
// Source: packages/server/src/db.ts:502-513 (existing pattern)
if (!dashboardColNames.has("generated_by")) instance.exec("ALTER TABLE dashboards ADD COLUMN generated_by TEXT");
if (!dashboardColNames.has("generated_pending_at")) instance.exec("ALTER TABLE dashboards ADD COLUMN generated_pending_at INTEGER");
instance.exec("CREATE INDEX IF NOT EXISTS idx_dashboards_pending ON dashboards (generated_by) WHERE generated_pending_at IS NOT NULL");
// one-unkept-per-user hard guarantee (race-proof, the app-level check is the friendly 409):
instance.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboards_one_pending ON dashboards (generated_by) WHERE generated_pending_at IS NOT NULL");
```
The partial UNIQUE index makes D-06 true even under a double-click race. `mapDashboard` (db.ts ~600) must expose `generated_pending: boolean` (and NOT `generated_by`) on `Dashboard`/`DashboardDto`; the web needs it for the badge and Discard semantics.
**Visibility (D-04):**
- `GET /api/dashboards` (index.ts:843) filter: `visible = all.filter(d => !d.pending || d.generatedBy === me) && canViewDashboard(...)`.
- `canViewDashboard` (dashboardAccessDb.ts:56) gets the override FIRST: if the dashboard is pending, return `generated_by === lower(username)` regardless of the `manage_access` bypass. This single change hides it from admins and designers on every route that calls it: widgets (index.ts:988), export (1002), tables (1057), layers (1089), views (1184), dynamic-view list (1808), `exportRoutes.ts:99`, `aiDvRoutes.ts:79`, `/api/ai/ask` (aiRoutes.ts:85), `ai-keep` (aiKeepRoutes.ts:42). 22 total `canViewDashboard` references (grep). Those routes already collapse "missing" and "denied" into 404.
- Not covered by `canViewDashboard` (no view check today): `PATCH/DELETE /api/dashboards/:id`, access-grant routes (index.ts:928-985), `POST widgets/tables/layers/views`, `PATCH/DELETE /api/widgets/:id`. These are pre-existing "permission only" routes. For D-04 hardening add: grant routes refuse a pending dashboard (409; otherwise a grant would leak it), and `DELETE /api/dashboards/:id` should go through the shared discard helper for pending rows. Do not retrofit view checks onto all permission-only routes (out of scope, behaviour change).
- Two enumerators that name dashboards: `listDashboards()` at index.ts:2758 (schema-check impact report) and `schemaApply.ts:344`. Filter pending rows out of both (names of unkept dashboards must not leak to datasets:manage users).
**Clear on Keep (D-05):** inside `applyKeep`'s `db.transaction` (aiKeepApply.ts:41), after the version compare: `UPDATE dashboards SET generated_by=NULL, generated_pending_at=NULL WHERE id=?`. A plain dashboards UPDATE does not bump `version` (the `kbi_ver_*` triggers are only on child tables, db.ts:514-519), so the returned `version` is unaffected. A rollback restores the flag (it is in the same txn). Keep route must then let the client learn the flag cleared: client refetches the dashboard list/DTO after `completeKeep` (keepRunner already refetches four lists; add dashboard DTO refetch or extend the Keep response with `generatedCleared:true`).
**Keep with empty change set:** if generation failed and the user wants to keep the empty (AI-widget-only) dashboard, there is nothing to "Keep" (bar only appears with changes). Open question below.
**Delete (D-03a / Discard), one helper:**
```typescript
// lib/aiGenerate.ts (new). Order matters: drop Kinetica views first (bounded), then rows.
export async function discardGeneratedDashboard(id: number, by: {username: string; sid?: string}, deps = {}) {
  // 1. views: extend aiSessionViews.ts with dropViewsForDashboard(id, deps) (generalise dropSid, which is not exported and keys on sid)
  // 2. DELETE FROM ai_session_views WHERE dashboard_id = ?   (NO FK on that table: db.ts:249-258 declares dashboard_id INTEGER NOT NULL, no REFERENCES)
  // 3. deleteDashboard(id)  (db.ts:658; explicit grant cleanup + cascade)
}
```
- SQLite cascade: better-sqlite3 opens with `foreign_keys = ON` by default (db.ts:1102-1108 comment, "MEASURED"), so widgets/layers/dynamic_views/dashboard_tables/table_views cascade (`ON DELETE CASCADE` at db.ts:46,54,66,98,136,273). `deleteDashboard` additionally deletes `dashboard_access_grants` by hand (belt and braces). The only thing that does NOT cascade is `ai_session_views` (and `ai_audit`, which D-21 keeps on purpose).
- Kinetica: AI session view names are in `ai_session_views` keyed by `sid` + `dashboard_id`; dropping uses `principalForSession(sid)`; if the session is gone the rows are left to `DEFAULT_VIEW_TTL_MINUTES` (existing 139 policy, logged). For the TTL sweep the user's session may have expired (that is the reason for the sweep) so views fall back to the Kinetica TTL; state this honestly in the UAT (SC2 live check must list views while the session is alive).
- User hand-filters on a pending dashboard create filter/combination views in Kinetica (client-managed `dropFilterView`/`dropCombinationView`, App.tsx:25). They are TTL-based and NOT dropped by the discard helper. Pitfall: SC2 "no views" must be checked as "no AI session views and no dashboard rows"; mention filter views fall to TTL.
**Logout (D-03a):** index.ts:462-472. After `dropViewsForSid(decoded.sid, ...)` and BEFORE `deleteSession(decoded.sid)`: look up the username from `getSession(decoded.sid)` (the JWT payload has `sub`, `sid` only; `getSession` returns the row incl. username, sessionStore.ts:193), then `await discardPendingForUser(username)` bounded (reuse the 3 s `bounded()` shape). Wrap in try/catch; never fails logout. Note: a user logged in from two browsers loses the pending dashboard when either logs out (acceptable, matches "one unkept per user"; document it).
**Boot sweep:** in the IIFE at index.ts:3496, right after `sweepAiViewsOnBoot` (which already deletes ALL `ai_session_views` rows) call `sweepGeneratedOnBoot()` : delete every pending dashboard (cascade handles children; views were just swept). Order: the views sweep first so Kinetica drops happen via stored sessions; then delete rows. Log one line in the same style (`[ai] boot sweep: ...`). It must run regardless of AI_ENABLED (rows outlive a config change).
**TTL sweep:** reuse the hourly timer pattern of `startAiAuditSweep` (aiAudit.ts:129; `unref()`, `tick` try/catch, never clearInterval). Env: `AI_GENERATED_TTL_HOURS` (default 24, `0` = off; reader modelled on `readAiAuditRetentionDays`, aiAudit.ts:99, with the same warn-once on invalid). Add it to `.env.example` and the README AI paragraph. Delete pending rows where `generated_pending_at < now - ttl`; for each, call `dropViewsForDashboard` as best effort first. Note the hourly granularity means "24 h" is 24-25 h; acceptable.
**Dashboard creation permission:** `POST /api/dashboards` needs `dashboards:create` (index.ts:850); designer and admin hold it plus `ai:use` (permissions.ts:74-86). A custom role with `dashboards:create` but not `ai:use` simply does not see the Generate option and the generate route 403s (spread-AND gate).
**dashboard_tables linkage today:** `POST /api/dashboards/:id/tables` -> `addDashboardTable` (index.ts:1062; db.ts `dashboard_tables` has a UNIQUE pair). The generate route calls `addDashboardTable` directly in its transaction. The `kbi_ver_dashboard_tables_i` trigger bumps `version` on that insert (fine: the version baseline is read after creation).
**Own-write chains:** the generating tab reads fresh lists after creation (`stampRead` on GET widgets/tables) so its baseline equals the post-creation version; no `stampWrite` is needed on the generate route. Do not call `stampWrite`-wrapped routes in a loop from the client for creation (that is what the single route avoids).

### Pattern 5: Audit marking (answers Q3)
`ai_audit` (db.ts:225-243) has no kind column. Writers:
| Row | Writer | Columns that land |
|---|---|---|
| Ask | `admitAiAnswer` INSERT_RUNNING then `finalizeAiAnswer` UPDATE | question, provider, model, data_access, allow_list_version at admit; outcome, outcome_detail, answer_text, steps, tokens, tools_json, changes_json, duration_ms, queries_json at finalize; `counted=1` |
| Cap refusal | INSERT_REFUSAL in admit | status final, outcome `capped`, detail `user_hour_cap`/`deployment_day_cap`, `counted=0`, steps 0 |
| Keep | `recordAiKeep` (aiAudit.ts:151) | `question=''`, `request_id='keep-<ts>-<rand>'`, provider/model NULL, `counted=0`, `changes_json` = counts + `idMap`, outcome `kept|keep_*` |
| Deadline | route finalizeOnce (aiRoutes.ts:185) | `tools_json='[]'`, outcome `provider_error`, detail `timeout`, `queries_json` if any |
| Interrupted | `runAiAuditSweepOnce` | outcome `provider_error`, detail `interrupted`, `tools_json` NULL |
**Recommendation:** add `kind TEXT` (PRAGMA-guarded ALTER, same pattern as `queries_json`, db.ts:435-436), values `ask|generate|keep`. Set it in `INSERT_RUNNING`/`INSERT_REFUSAL` (new `kind` field on `AdmitInput`, default `ask`; the route passes `generate ? "generate" : "ask"`) and in `recordAiKeep` (`keep`). The read API computes `kind ?? (request_id LIKE 'keep-%' ? 'keep' : 'ask')` so legacy rows render correctly with no backfill. A generate ask counts against hourly/daily caps like any ask (it does: `counted=1`).
Also add `CREATE INDEX IF NOT EXISTS idx_ai_audit_dash_ts ON ai_audit (dashboard_id, ts_ms)` (CONTEXT: "no dashboard index yet"). The dashboard filter composes with the ts range, so this composite is the right one.
**Pitfalls the viewer must handle:** `tools_json` may be `'[]'` or NULL; `changes_json` for Ask is `{applied:string[], rejected:[]}` while for Keep it is `{added,edited,removed,idMap?}`; `queries_json` NULL for schema mode; `answer_text` NULL for refusals; `provider`/`model` NULL for Keep rows. Parse defensively (try/catch each JSON column, treat failure as absent).

### Pattern 6: Audit read API + page (answers Q3)
**Route (new `aiAuditRoutes.ts`, registered beside `registerAiRoutes`):**
- `GET /api/ai/audit?from=<ms>&to=<ms>&outcome=<csv>&dashboardId=<n>&page=<n>` : `requirePermission(PERMISSIONS.AUDIT_VIEW)` (rbac.ts:44; returns the 403 JSON `{code:"PERMISSION_DENIED", permission}`). NOT gated on AI being enabled (rows outlive a config change). Page size fixed at 50 (clamp `page>=1`). Returns `{rows, total, page, pageSize:50}` newest first `ORDER BY ts_ms DESC, id DESC`. Row = id, ts_ms, username, dashboard_id, kind, `question` truncated to ~160 chars, outcome, outcome_detail, steps, duration_ms, and for Keep rows a server-built `summary` string from `changes_json`. Validate with zod: `from/to` ints, `outcome` from a closed enum list (`ok, cancelled, capped, provider_error, rate_limited, kept, keep_conflict, keep_denied, keep_invalid, keep_failed`), `dashboardId` positive int. Use bound parameters only (no string-built SQL).
- `GET /api/ai/audit/:id` : same gate; full row with parsed `tools`, `changes`, `queries`, `answer_text`, provider/model, tokens, `data_access`, `allow_list_version`, `outcome_detail`.
- `GET /api/ai/audit/dashboards` : distinct `dashboard_id` in the window for the filter dropdown, with `name` ONLY when the dashboard exists AND is not pending (D-04: don't leak unkept names to admins); otherwise `name:null` and the page renders "Deleted dashboard #id" (D-21) or "Dashboard #id (not kept yet)".
- Count query shares the WHERE; both run under one `db.prepare` pair. 90-day retention keeps this small; the composite indexes cover the filters.
**Page:** `AiActivityPage.tsx`, titled "AI activity". Mirror `RolesPage` structure (state + `listX` in `api/client.ts` + toast on error + `.css` page-local file) and use ONLY existing global classes (`ds-field`, `ds-field-label`, `ds-select`, `ghost-sm`, `btn-primary btn-sm` inside `ds-actions`, `config-group`). Table styling: copy `UsersPage`'s table classes (grep before inventing; CLAUDE.md rule). No hex; tokens only. One-line note: "Query results are never logged." (D-18). Wire: `Page` union (App.tsx:39) add `"ai-activity"`; Sidebar `nav` add `{label:"AI activity", key:"ai-activity", icon, permission: PERMISSIONS.AUDIT_VIEW}` after Roles (Sidebar.tsx:34); render `{page === "ai-activity" && hasPermission(PERMISSIONS.AUDIT_VIEW) && <AiActivityPage/>}` (App.tsx:672 area); add to the ReturnTo restore list WITH the permission gate exactly like branding (App.tsx:448-452); add a client-side redirect effect like the branding one (App.tsx:555-565) so a role change cannot strand a user on the page. Server is the real gate (403).
**permissionGroups.ts:29:** change only the string. `permissionGroups.spec.ts` references `audit:view` only as a group key (line 69, 85), no spec asserts the description text (grep `viewer ships` -> only the source line). No server-side copy of the description exists. No RBAC spec ripple (no permission added).
**Sidebar/App specs:** check `Sidebar.spec.tsx` for an exact nav-label list for admin before adding the item (grep found no length assertions on `audit`, but confirm when implementing).

### Anti-Patterns to Avoid
- **Client-supplied "generated" flag or layout:** server must derive generate mode and own the layout (D-12, D-06).
- **Counting the AI widget as a data widget or letting the model place it:** gateway locks it (gateway.ts:375-386); it is created by the generate route only.
- **Trusting `ON DELETE CASCADE` for `ai_session_views`:** no FK there; delete explicitly.
- **A bare `useEffect` that POSTs the first ask:** StrictMode double-fire burns quota (askRunner.ts header).
- **Concatenating filter values into audit SQL:** use bound params.
- **Putting generate state in `aiSessionStore.initial`:** `reset()` clears it and bumps the epoch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Permission gate on audit routes | custom check | `requirePermission(PERMISSIONS.AUDIT_VIEW)` (rbac.ts:44) | emits the standard 403 body + `permission_denied` log line |
| Per-user cap/counting for generate | new counter | existing `admitAiAnswer` | generate is an ask; `counted=1` rows already feed hour/day caps |
| Widget overlap/placement | new collision code | `placeWidget`/`validateLayout`/`rectsOverlap` in `packages/shared/src/layout.ts` | already shared by gateway + client; add only the band arrangement on top |
| Kinetica view drops | raw DDL | `dropSid`-style path in `aiSessionViews.ts` (validates names via `parseAiDynamicViewName`, handles ended sessions, tallies) | never issue DDL for a non-well-formed name |
| Sweep timers | new scheduler | pattern of `startAiAuditSweep` / `sweepAiViewsOnBoot` | unref'd, try/catch, never clears interval |
| Keep atomicity | multi-statement route logic | extend `applyKeep`'s existing `db.transaction` | rollback restores the pending flag for free |
| Retry-after-failure state | client flag | server-derived generate mode | Retry re-enters generate with no client change |
| Ollama context sizing in-app | patching the adapter to send `num_ctx` | `OLLAMA_CONTEXT_LENGTH` on the container | OpenAI-compat schema has no `num_ctx`; Ollama docs say use env or a Modelfile |

**Key insight:** every hard guarantee in this phase (one pending per user, no leftover rows, 4-8 widgets, no overlap) should be enforced by the server with a DB constraint, a transaction, or a pure function with a spec, never by the model or the client.

## Common Pitfalls

### Pitfall 1: Default limits make generate impossible
**What goes wrong:** `AI_MAX_TOOL_STEPS=8` and `AI_MAX_NEW_WIDGETS=6` (aiConfig.ts:90,105) cap an answer at 6 widgets, and steps count each tool call.
**How to avoid:** generate mode uses `max(config, 20 steps)` and `max(config, 8 widgets)`; keep `AI_TIMEOUT_MS` as is. Update the "Use at most N tool calls" sentence to the effective value.
**Warning signs:** generate ends with 5-6 widgets and a "limit of 6 new widgets" skipped entry, or `step_cap` outcome.

### Pitfall 2: Ollama silently truncates the prompt at 4k
**What goes wrong:** Ollama's context default is VRAM-based; under 24 GiB (any CPU-only Docker) it is 4k (https://docs.ollama.com/context-length). Our request: tool schemas 12.0-12.9K chars (~3-3.5K tokens, measured by building the registry), system rules 3.2K chars (+1.0K query rules), recipe ~1.5-2K chars, schema text and dashboard-view JSON (~1-2K chars), then tool results accumulate per round. That is roughly 5.5-7K tokens on round 1 and 8-12K by round 6. At 4k Ollama drops the front of the prompt (the system rules and tools), so the model "works" but ignores the rules. The OpenAI-compatible endpoint cannot set `num_ctx` per request.
**How to avoid:** start the container with `-e OLLAMA_CONTEXT_LENGTH=16384` (and `-e OLLAMA_NUM_PARALLEL=1`, `-e OLLAMA_KEEP_ALIVE=30m`). Confirm with `docker exec <c> ollama ps` (CONTEXT column) after the first request. 16K KV for a 7B GQA model is on the order of 1 GB, so the Docker Desktop VM needs roughly >= 8 GB RAM plus the 8 CPUs the operator was told to allot. (KV-size arithmetic is from model architecture knowledge, MEDIUM; verify with `docker stats`.)
**Warning signs:** the model ignores "never write SQL", skips the Follow-ups trailer, hallucinates tool names; server log of Ollama shows truncation warnings.

### Pitfall 3: Ollama CPU time vs the 600000 ms ceiling
**What goes wrong:** every provider round resends the full prompt; CPU prompt-eval of 6-12K tokens plus generation at a few tokens/s on an Intel Mac Docker VM can take minutes per round. A Generate of ~5 rounds can exceed `AI_TIMEOUT_MS` max (600000, aiConfig.ts:91) and the route hard deadline (`timeoutMs + 5 s`, aiRoutes.ts:162). Result: `provider_error/timeout` and zero ops.
**How to avoid / plan for it:** the matrix must be allowed to record **partial** for Ollama Generate; do not tune the product to pass it. Mitigations to try in order: (1) `OLLAMA_KEEP_ALIVE` so the model stays loaded; (2) rely on prefix KV-cache reuse (identical system prefix each round; do not reorder prompt parts); (3) generate prompt asks for all add_widget calls in a single turn (parallel calls are supported by the adapter, `parallelTools: true`); (4) if still too slow, record "partial: timed out at 10 min" with the round times. UAT D-26 already limits Ollama to core set.
**Warning signs:** Cancel/timeout at the same step count every time.

### Pitfall 4: Ollama OpenAI-compat gaps (unverified for our adapter)
- Docs list `tools` supported, `tool_choice` NOT supported, streaming supported but tool-call streaming not documented (https://docs.ollama.com/api/openai-compatibility). Our adapter always sends `tool_choice:"auto"` unless `sendToolChoice === false`, and `createProviderFromConfig` (providers/index.ts:16) never passes that option. Ollama normally ignores unknown fields, so this is probably harmless, but if the live run returns HTTP 400, the fix is a small adapter change (omit `tool_choice` when the base URL is Ollama or via a new env), not a model problem. Run the spike with `--raw` first to separate adapter from model behaviour.
- `stream_options.include_usage` is sent (openaiCompat.ts:101); the spike reports `usagePresent`. If Ollama omits usage the audit tokens are NULL, which is already tolerated (`inputTokens` optional).
- Tool-call `index` absent is already handled (Gemini case). Ollama normally sends whole arguments per chunk; other Qwen2.5 servers (vLLM, llama-cpp-python) have shown truncated streamed arguments or tool calls delivered as plain `content` (search results, LOW). If seen on Ollama: try `--stream false` in the spike and `AI_TOOL_MODE=json` as the documented fallback (json-action decorator exists, providers/jsonAction.ts).
- A Go-struct JSON-schema error ("cannot unmarshal array into ... properties.type") appears when a tool schema has `type:[...]`; verified our 20 tool schemas contain NO `type` arrays (built the registry and counted: 0), so this specific failure should not occur.

### Pitfall 5: Generate mode misfires or is bypassed
**What goes wrong:** a pending dashboard with zero data widgets after the user deleted everything would re-enter generate mode on any question. **How to avoid:** acceptable and arguably desirable, but write it down (spec it). A non-pending dashboard never enters generate mode (server-derived), so there is no way to get the 8-widget raised limits on normal dashboards.

### Pitfall 6: Visibility and orphan leaks
Covered in Pattern 4: `canViewDashboard` override, impact-report filter, grants refusal, `ai_session_views` explicit delete, filter views falling to TTL. Also: **the unique partial index** protects D-06 against races; the app-level check only exists to return a friendly 409 with the existing id.

### Pitfall 7: Discard UX for a pending dashboard differs from Phase 141
Phase 141 Discard = reset session; for a pending dashboard Discard must call the server discard and navigate back to the list (the dashboard is gone). The leave-dialog path (`AiLeaveDialog` "Discard and leave", `store.reset()` at AiLeaveDialog.tsx:32) and the unmount cleanup chain must NOT silently delete a pending dashboard on a plain navigation (user can come back via their list); decide copy ("This dashboard isn't saved yet; it stays in your list until you keep or discard it" is the honest message). After the first Keep the normal Discard applies (D-05).

### Pitfall 8: CSS classes and theme
New page and form section must use existing `global.css` classes only (grep first). `btn-primary btn-sm` + `ghost-sm` in `ds-actions` for Generate/Cancel. No hex, no `rgba()` overlays (theme-guard misses rgba; use `color-mix`/tokens). Verify visually in light and dark through CDP, not only via green tests (CLAUDE.md, memory css-bugs-evade-tests-and-theme-guard).

### Pitfall 9: Test-gate hazards
Run web vitest and server gates sequentially, `--maxWorkers=4` (memory parallel-test-load-false-failures); server vitest is SET-BASED (failing files must be a subset of the known `TD-V16-TEST-ISOLATION` set); the dev `.env` leaks into server vitest (memory dev-env-leaks-into-server-vitest): the new TTL env reader must read an injectable `env` param like `readAiAuditRetentionDays(env)`. Web: global `useRealTimers` afterEach already exists for fake-timer leaks; any new debounce in the audit page must use it.

## Code Examples

### Pending override inside the access resolver
```typescript
// Source: packages/server/src/lib/dashboardAccessDb.ts:56 (existing function; add the first branch)
export const canViewDashboard = (username: string, dashboardId: number, conn = defaultDb): boolean => {
  const p = conn.prepare("SELECT generated_by, generated_pending_at FROM dashboards WHERE id = ?")
    .get(dashboardId) as { generated_by: string | null; generated_pending_at: number | null } | undefined;
  if (p && p.generated_pending_at !== null) return p.generated_by === username.trim().toLowerCase(); // D-04: even admins/designers
  /* ...existing (a) bypass, (b) user grant, (c) role grant... */
};
```

### Clearing the flag in Keep
```typescript
// Source: packages/server/src/lib/aiKeepApply.ts:41 (inside the existing db.transaction, after the version compare)
db.prepare("UPDATE dashboards SET generated_by = NULL, generated_pending_at = NULL WHERE id = ?").run(dashboardId);
```

### beforeFinish hook (min 4 widgets), shape only
```typescript
// agentLoop.ts, calls.length === 0 branch (currently: deps.checkSession(); text = turnText; break;)
if (calls.length === 0) {
  deps.checkSession();
  const nudge = !nudged ? input.beforeFinish?.({ addedWidgets }) ?? null : null;
  if (nudge) { nudged = true; convo.push({ role: "assistant", parts: [part.history(turnText)] }, { role: "user", parts: [part.user(nudge)] }); continue; }
  text = turnText; break;
}
```
(Verify `OutboundMessage` accepts an assistant text-only message with the existing providers; `convo.push({role:"assistant", parts})` is already used at agentLoop.ts ~line 215 for the tool-call turn.)

### Audit list query (bound params)
```typescript
const where: string[] = ["ts_ms >= @from", "ts_ms <= @to"]; const p: Record<string, unknown> = { from, to, limit: 50, offset: (page-1)*50 };
if (outcomes.length) { where.push(`outcome IN (${outcomes.map((_, i) => `@o${i}`).join(",")})`); outcomes.forEach((o, i) => (p[`o${i}`] = o)); }
if (dashboardId) { where.push("dashboard_id = @d"); p.d = dashboardId; }
const rows = db.prepare(`SELECT id, ts_ms, username, dashboard_id, kind, request_id, question, outcome, outcome_detail, steps, duration_ms, changes_json FROM ai_audit WHERE ${where.join(" AND ")} ORDER BY ts_ms DESC, id DESC LIMIT @limit OFFSET @offset`).all(p);
```
(`outcome` values come from a closed zod enum; only the placeholder list is interpolated.)

### Ollama in Docker (operator runs; Claude does not start Docker)
```bash
# Source: https://docs.ollama.com/docker (base command) + https://docs.ollama.com/context-length (OLLAMA_CONTEXT_LENGTH)
docker run -d --name kbi-ollama -v kbi-ollama:/root/.ollama -p 127.0.0.1:11434:11434 \
  -e OLLAMA_CONTEXT_LENGTH=16384 -e OLLAMA_NUM_PARALLEL=1 -e OLLAMA_KEEP_ALIVE=30m ollama/ollama
docker exec kbi-ollama ollama pull qwen2.5:7b-instruct      # ~4.7 GB, needs operator approval
docker exec kbi-ollama ollama ps                             # after first ask: check CONTEXT=16384 and PROCESSOR=100% CPU
# cleanup
docker rm -f kbi-ollama && docker volume rm kbi-ollama && docker rmi ollama/ollama
```
Server env for the run: `AI_PROVIDER=openai-compatible AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen2.5:7b-instruct AI_TIMEOUT_MS=600000` (no key). If a server-side Docker/compose network is ever used, `localhost` will not reach the host container; for the dev UAT the server runs on the Mac so `localhost` is right.

## Live UAT Plan Inputs

### S6 spike re-run (answers Q5)
- File: `packages/server/src/spikes/toolCallSpike.ts` (+ `toolCallSpikeMetrics.ts`). Flags: `--runs N` (default 3), `--rpm N` (default 6), `--out`, `--record <dir>`, `--mode native|json`, `--stream true|false`, `--raw`, `--burst N` (off; burns quota). It builds `buildToolRegistry({dataAccess:"schema"})` (line 365) with `AI_SYSTEM_RULES`, so it automatically uses the current 18 tools and current rules (including the trailer/filter/dv rules) with no code change. It does NOT include the 2 query tools or the new generate recipe, and its 7 scenarios are the 135 set (list, describe, add bar, parallel, no-tool, round-trip, malformed). The unit tests (`parseSpikeArgs`, metrics) already exist.
- Recommended small additions (planner decision, optional but cheap): scenario 8 filter ("Filter to payment type CASH", expect `apply_filter`, checks casing), scenario 9 dynamic view (`add_dynamic_view`), scenario 10 generate recipe in one turn (expect >= 4 `add_widget`). Scenario 3/7 `stopOnAdd` logic already shows how.
- Quota math (Gemini free tier = 20 requests/day/model, measured: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, 135-SPIKES): the 7 existing scenarios use ~1+1+2-4+1+1+2+1-3 = 9-13 provider requests per run, so one `--runs 1` is about half a day's quota and the >= 20 clean-trial rule needs ~3 runs = 27-39 requests = 2 quota days minimum with NOTHING else running on that key. The interactive D-25 set shares the same model quota. Realistic free-tier schedule: S6 re-run on its own day(s); D-25(a)-(d) is roughly 25-40 provider requests (each ask 2-5 requests; a generate 4-8) so >= 2 more days. Recommendation: put this table in the plan, have the operator set `AI_MAX_ANSWERS_PER_DAY` per day's budget, and offer a paid/billing-enabled key as the way to finish in one day. Estimates are MEDIUM (derived from S6 scenario step counts, not measured for the new tools).
- Ollama run is unattended; `--rpm 30 --runs 3 --out ./s6-ollama.json` per the harness header; expect hours on CPU; record `--mode json` only if native fails.
- Spike user was admin not `uat_analyst` (STATE.md note); optional re-run as `uat_analyst`.

### Demo dimension table for joins (answers Q6)
- Registered nyctaxi facts available in the planning record: `vendor_id` (values seen: `DDS`, `CMT`; 139-14-UAT-RESULTS step 4; a third code `VTS` is the standard NYC TLC code but is UNVERIFIED here), `payment_type` (TEXT, documented as 2-6 distinct values, 37-SPIKE-NOTES; exact values unverified, the spike used `cash,credit` only as doc examples), `pickup_datetime` (timestamp; no DATE column; weeks start Sunday), numeric `fare_amount`, `tip_amount`, `total_amount`, `passenger_count`, pickup/dropoff lon/lat, `store_and_fwd_flag`.
- Recommended dim: `uat.vendor_dim (vendor_id VARCHAR(4), vendor_name VARCHAR(32))` (3-4 rows). Before creating anything, run a read-only `SELECT DISTINCT vendor_id FROM demo.nyctaxi` (UAT step 0) so the dim rows match real codes (and include one code NOT in the dim so the LEFT join has unmatched rows and INNER <= LEFT is provable).
- Creation needs operator approval on the shared instance (D-27); registration through Datasets (`datasets:manage`) then add to dashboard 12 (or a copy) so `demo.nyctaxi` + `uat.vendor_dim` are both on the dashboard (the gateway refuses tables not on the dashboard). Join key equality only, `AI_DV_MAX_JOINS` default 2.
- Steps to run: 139 step 8 (set `AI_DV_PREFLIGHT_TIMEOUT_MS=2000` in `.env` by the operator; joining two large tables; assert no `/* kbi-ai:aidv-` job remains in `/admin/show/jobs`; a join of the 100k-row-cap fact with a 3-row dim may be too fast to time out, so the "expensive" join may need a self-join of nyctaxi; if it builds fast, record the time and skip per the step text), 8b (filter on dim then INNER/LEFT, `peekAiView`), 141 step 9 (Keep a joined view; 139 D-21 known difference: kept joined views read joined tables raw).
- Teardown: drop `uat.vendor_dim` and unregister the table at the end; record in the UAT file.

### Live provider checks list (all deferred into 142)
AIWID-V20-05 trailer adherence (Follow-ups/Choices) on both providers; clarification; filter prompt rules (exact casing, omit tableId, Choices for ambiguity; 138); dynamic view prompt rules + D-25 saved-view removal ask once (139); query-mode adherence + `queries_json` (140: SQL + rowCount + durationMs, no row values); model-driven ask then Keep (141); generate/refine/Keep and generate/Discard with SQLite + Kinetica listing (SC1/SC2); audit viewer showing Ask, Generate, Keep rows incl. a deadline row if one occurs (SC3); non-admin (`uat_analyst`) has no AI activity nav entry and the API returns 403.
Minor follow-ups to touch if cheap: "Filter to the last 30 days" suggestion returns 0 rows on 2009 data; the cap message starts lowercase (STATE notes). Not required.

### README and .env.example edits (answers Q7)
- README.md line 225-227 provider paragraph: "Provider status: OpenAI-compatible - live-tested on Gemini ... (provisional, Phase 135 S6 matrix); Claude adapter: unit-tested ... NOT live-verified; Ollama/local models: untested." Replace the status sentence with a short "Tested models" table (columns: provider, model ID, tool mode, pass/partial, notes, date) keeping the Claude "NOT live-verified" row/sentence, the `AI_MODEL` ID warning, the 120000 ms Gemini note, the 20/day free-tier note, and the Ollama note (now Docker + `OLLAMA_CONTEXT_LENGTH` guidance). Also document the new `AI_GENERATED_TTL_HOURS` and the "AI activity" page / `audit:view` (README line 227 area and Roles note).
- `packages/server/.env.example` AI block: Gemini `AI_MODEL=gemini-2.5-flash` -> `gemini-3-flash-preview`, add `# AI_TIMEOUT_MS=120000` comment guidance for Gemini; the global default comment `AI_TIMEOUT_MS=60000` stays but add per-provider hints; Ollama example `AI_MODEL=llama3.1` -> `qwen2.5:7b-instruct`, `AI_TIMEOUT_MS=600000` hint, and the Docker command + `OLLAMA_CONTEXT_LENGTH` comment; add `# AI_GENERATED_TTL_HOURS=24`. The existing note that the step/new-widget limits are raised in generate mode belongs next to `AI_MAX_TOOL_STEPS` / `AI_MAX_NEW_WIDGETS`. Do NOT read `packages/server/.env`.
- CONTEXT canonical refs mention superseding `packages/web/docs/mcp-action-seam.md` (research SUMMARY.md row 142); that doc says "No AI chat widget and no MCP server are built this milestone". Add a short "Superseded by v2.0" banner at its top pointing to the shipped AI paths (docs-only task, not in CONTEXT's decisions but in SUMMARY.md's phase row; planner may include as a 5-minute task).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ollama default `num_ctx` 2048 | VRAM-based default: < 24 GiB -> 4k, 24-48 -> 32k, >= 48 -> 256k | recent Ollama releases (docs fetched 2026-10-23) | CPU-only Docker is 4k; still too small for our ~6-12K token requests; set `OLLAMA_CONTEXT_LENGTH` |
| Per-request `num_ctx` via OpenAI API | not possible; env var or Modelfile `PARAMETER num_ctx` | n/a | do not patch the adapter; configure the server |
| "12 flat typed tools" (STATE/CONTEXT wording) | 18 tools (schema) / 20 (query) in the registry | Phases 136-141 | S6 and prompt-size estimates use the real count |

**Deprecated/outdated:** the S6 verdict (135-SPIKES) is stale against the current tools and rules; the README "Ollama untested" line is replaced by this phase.

## Open Questions

1. **Keep for an empty or failed generation.** The change bar only appears with session changes, so a failed generation leaves an AI-widget-only pending dashboard whose only exits are Discard, Retry, or the sweep (D-07 says this is intended). If the operator wants "keep the empty one", `AiKeepRequestSchema` would need to accept an empty change set (not checked here). Recommendation: do NOT add; D-07 is explicit. Note in the plan so the executor does not improvise.
2. **Does `OutboundMessage` accept the nudge shape for every provider (native, json-action, claude)?** The `beforeFinish` snippet is shaped on existing `convo.push` usage but not run. Recommendation: first task is a red-first loop spec with the scripted provider covering native and json-action decorators.
3. **Ollama behaviours** (tool_choice tolerance, streamed tool_calls shape, usage in stream, qwen2.5 parallel calls, CPU round time) are unverified until the live run. Recommendation: UAT step order = `--raw` spike probe -> S6 spike -> app asks; accept "partial" honestly in the matrix.
4. **Gemini quota vs paid key.** Operator decision at planning/UAT time; plan both a free-tier day schedule and a one-day paid-key path.
5. **Band geometry (exact widths/heights) is a design choice** (24-column main area, AI column 12x40). It needs a human-verify checkpoint (success criterion 1 is explicitly operator human-verify of fit and layout) in light and dark. Also decide whether the AI widget height should match total band height (taller than 40 for tall dashboards); recommendation: fixed 12x40 at y=0, simplest and stable.
6. **Logout deletes the pending dashboard even when the same user has another live session.** Acceptable per "one unkept per user"; confirm with the operator or note in the UAT.

## Validation Architecture

`workflow.nyquist_validation` is `false` in `.planning/config.json`, so the formal Validation Architecture section is skipped. Test strategy hints for the planner (not a Nyquist map):

- **Frameworks:** web `cd packages/web && npx vitest run` (+ `npx tsc --noEmit`, `npx vitest run src/styles/theme-guard.spec.ts`); server `cd packages/server && npx vitest run <file>` (+ `npx tsc --noEmit`), set-based per CLAUDE.md. Shared `packages/shared` has its own `vitest.config.ts` (layout.spec.ts exists).
- **Server specs (red-first, no real provider):** (1) band layout pure function: sizes, no overlap with AI rect, `validateLayout` valid for 4..8 widgets and each type mix, deterministic regardless of input order; (2) generate route: 201 shape, AND-gate (403 without `ai:use` or without `dashboards:create`), 503 when AI off, 409 second pending (and unique-index race by two parallel inserts), AI widget created with the side-column rect; (3) `canViewDashboard` pending override for admin/designer/other and creator; list + each of widgets/tables/layers/views/export/dynamic-view/ai-ask/ai-keep returns 404 to non-creator; impact-report omits pending; (4) generate mode through `runAnswer` with the scripted provider: raised limits only when pending-and-empty, nudge once then success, nudge then fail -> `generate_too_few` with zero ops, > 8 adds skipped, ops layouts rewritten, normal dashboards untouched; (5) Keep clears the flag in-transaction and a forced rollback keeps it; (6) discard helper: SQLite rows gone (widgets, layers, dvs, tables, grants, `ai_session_views`), audit rows stay, Kinetica drop called with the injected `sql` dep for each registered view (use `DropDeps` injection like the 139 specs); (7) logout/boot/TTL sweeps with injected clock and conn; TTL reader invalid/zero/default; (8) audit API: 403 without `audit:view`, filters (date, outcome incl. all five keep outcomes, dashboard), paging 50 + total, newest first, kind derivation incl. legacy rows, Keep summary text, defensive parsing of NULL/`[]` tools and mismatched `changes_json`, Cap-refusal rows, pending-dashboard name not leaked in the facet, bound-param safety with hostile `outcome`/`dashboardId`.
- **Web specs:** `DashboardCreate` Generate section visible only with `ai:use` + enabled, table picker + prompt, calls the generate API once (StrictMode single-fire for the auto-start), 409 pending shows the Keep/Discard prompt; pending badge in the list; pending Discard calls the server and returns to the list; Keep refetch clears pending; `AiActivityPage` renders rows/filters/paging/detail, "Deleted dashboard #id", note text; Sidebar shows the item only with `audit:view`; App restore list + gate redirect; `permissionGroups` unchanged group keys. RGL stale-id guard spec around a Keep that swaps 5-9 widgets (memory rgl-list-swap-layout-storm).
- **Manual-only (route to `checkpoint:human-verify`, do not fake with grep):** generated layout looks right and widgets suit the columns (SC1), light and dark visuals of the new form section and audit page, Docker/Ollama runs, Gemini behaviour, SQLite + Kinetica emptiness after Discard (SC2, observed by listing), the "no visible flash" class of requirements.
- **Acceptance-criteria hygiene (CLAUDE.md):** every grep criterion must be run BEFORE the work to prove it reads 0. Safe new anchors introduced by this phase (all absent today, verify at plan time): `generated_pending_at`, `placeGenerateBands`, `discardGeneratedDashboard`, `AI_GENERATED_TTL_HOURS`, `idx_ai_audit_dash_ts`, `aiAuditRoutes`, `AiActivityPage`, `generate_too_few`, `beforeFinish`, `ai-activity`. Unsafe anchors: any string containing `audit:view` or "audit log" (already widespread), `"ai"` literals, `canViewDashboard` counts.

## Sources

### Primary (HIGH confidence, read directly from this repo)
- `packages/server/src/aiRoutes.ts`, `lib/ai/runAnswer.ts`, `lib/ai/agentLoop.ts`, `lib/ai/gateway.ts` (375-386 AI widget lock, 661-664 placement), `lib/ai/context.ts`, `lib/ai/tools/registry.ts`, `lib/ai/shadow.ts`, `lib/aiConfig.ts` (limits/defaults), `lib/aiAudit.ts`, `lib/aiSessionViews.ts`, `lib/aiKeepApply.ts`, `lib/aiKeepValidate.ts`, `aiKeepRoutes.ts`, `lib/dashboardAccessDb.ts`, `rbac.ts`, `db.ts` (schema 21-45, 225-258, 435, 495-519, 628-668, 1102-1122), `index.ts` (462-472 logout, 843-1100 dashboard routes, 3480-3521 boot)
- `packages/shared/src/layout.ts`, `aiAsk.ts`, `aiKeep.ts`, `aiOp.ts`
- `packages/web/src/lib/aiSession/askRunner.ts`, `constants.ts`, `store/aiSessionStore.ts`, `components/DashboardsPage.tsx` (548 DashboardCreate, 1280-1300 AI widget creation), `App.tsx`, `Sidebar.tsx`, `lib/permissionGroups.ts`
- `packages/server/src/spikes/toolCallSpike.ts`; `.planning/phases/135-*/135-SPIKES.md`, `139-14-UAT-STEPS/RESULTS`, `141-14-UAT-RESULTS`, `.planning/STATE.md`, `.planning/research/SUMMARY.md`
- Measured by building the live registry (temp script, removed): 18 tools schema mode / 20 query mode; schema JSON 12,016 / 12,910 chars; `AI_SYSTEM_RULES` 3,221 chars; query rules 991 chars; zero `"type":[` arrays.

### Secondary (MEDIUM confidence, official docs fetched 2026-10-23)
- https://docs.ollama.com/context-length (VRAM-based defaults, `OLLAMA_CONTEXT_LENGTH`)
- https://docs.ollama.com/api/openai-compatibility (tools supported, tool_choice not supported, no `num_ctx`, Modelfile workaround)
- https://docs.ollama.com/docker (CPU-only run command, named volume)
- https://ollama.com/library/qwen2.5:7b-instruct (tag exists, 4.7 GB, Q4_K_M, tools capability)

### Tertiary (LOW confidence, flagged for validation)
- Web search results on Qwen2.5-7B tool-calling quirks on other servers (vLLM stream truncation, llama-cpp-python tool calls in `content`); no confirmed Ollama bug found; treat as risks to probe, not facts.
- KV-cache memory estimate for 16K context and Docker memory sizing; Ollama behaviour for `tool_choice`, `stream_options`, parallel tool calls with our adapter.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new libraries; all anchors verified in the repo.
- Architecture: HIGH for server lifecycle/visibility/audit (code read end-to-end); MEDIUM for the loop nudge hook and the client auto-start (designed from existing patterns, not run).
- Pitfalls: HIGH for repo-derived ones; MEDIUM/LOW for Ollama runtime behaviour.

**Research date:** 2026-10-23
**Valid until:** 2026-11-22 for repo findings (changes only if Phases touch these files); Ollama/Gemini facts 7-14 days (fast-moving, re-check the free-tier quota and Ollama defaults at UAT time).
