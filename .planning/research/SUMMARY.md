# Project Research Summary

**Project:** Kinetica BI — milestone v2.0 AI-Driven Dashboards
**Researched:** 2026-10-08
**Confidence:** MEDIUM-HIGH
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (this directory)

> **Operator decisions taken AFTER research (override the research where they differ):**
> - **No Anthropic API key is available to the operator.** Primary live-verified path is the in-repo OpenAI-compatible adapter (plain `fetch`), proven on **Gemini via Google AI Studio** (free tier, no billing; endpoint `https://generativelanguage.googleapis.com/v1beta/openai/`) and on **one local open model via Ollama**. Gemini free tier may use prompts for training → demo tables only.
> - **`@anthropic-ai/sdk` is NOT added.** The Claude adapter is written on plain `fetch` to `/v1/messages`, unit-tested, documented as not live-verified. (Research §7 recommended the SDK; reversed because it could not be exercised.) `zod-to-json-schema` remains an open planning-time choice vs hand-written schemas.
> - Scope extras chosen: highlight what changed, clarify-instead-of-guess, cancel; AI may also edit existing widgets, arrange layout, edit map layers; "Use AI" permission, server audit log, audit viewer page, env usage caps; generation = starter dashboard (single table). Per-step undo and an in-widget change list were NOT selected.

## Executive Summary

v2.0 adds an AI widget (Compact or Full) to a BI app. Mainstream competitors (Power BI Copilot, Tableau Agent, ThoughtSpot Spotter, Looker + Gemini, Databricks Genie) are all chat or side-panel copilots; "the dashboard is the answer, no transcript" is the genuine differentiator. Trust mechanics are table stakes: natural language to structured edits, visible indication of what changed, undo, follow-up chips, and a clarify/refuse path. Most of the milestone is NEW surface rather than reuse of the v1.11 action engine — that engine only patches ~12 allow-listed fields on existing ids, so add/remove of widgets, layers and dynamic views, data filters, and generation are all new.

Recommended approach: a server-side agent loop behind a thin in-repo provider adapter, with the browser as the apply-and-review surface. The server owns the key, the provider, schema/query tools (run with the user's Kinetica credentials), RBAC and audit. The browser owns the per-user session layer (op log with inverses, negative temp ids). Nothing touches the dashboard DB until an explicit Keep. One gateway plus a shared zod package gives security (the model is untrusted), testability (scripted fake provider) and provider portability.

Key risks: trusting model output on the client; the model exceeding the user's permissions; prompt injection and data egress against the admin data-access setting; model-authored SQL and orphaned Kinetica views; a large, subtle client change merging session entities across the Widget, Map and Legend read paths. Mitigations are structural (below). **SSYNC-F6 must be fixed before any AI filter or dynamic-view tool ships.**

## Resolved Positions

1. **Trust boundary (one design).** The agent loop runs SERVER-side. Every tool call passes ONE gateway: zod parse → allow-list → per-entity RBAC → live-schema validation against a shadow copy of the effective dashboard sent by the client. Identity comes from the session, never from tool args. Validated ops stream to the browser and are applied to the client session-layer op log. The server NEVER writes the dashboard DB during a turn. Only Keep persists, via one transactional endpoint that re-validates every op and re-checks edit rights. (STACK's "proposals applied by the client" and PITFALLS' "server gateway" are the same design: client half and server half.)
2. **widgetActionStore — flag for planner.** Do NOT naively reuse source-keyed contributions for AI patches: a later contribution from the same source REPLACES the earlier one, so turn 2 would erase turn 1. Resolution: `aiSessionStore` owns the op log; all patches are REBUILT FROM THE WHOLE LOG on every change and written as ONE contribution under a reserved `AI_SOURCE_ID`. Patches to temp-id session widgets mutate the derived session widget directly. Required test: turn 2 must not erase turn 1's patch — and it must fail before rebuild-from-log exists.
3. **SSYNC-F6 is a hard prerequisite.** `POST /api/filter/materialize` interpolates client column names unchecked; an LLM turns that into an automated injection vector. Fix first.
4. **Dynamic views = structured spec, not model SQL.** `{table, columns, filters, group_by, aggregates, order, limit}` validated against the live schema, compiled server-side with identifier quoting. Server-chosen names (`ai_<session>_<n>`, never `CREATE OR REPLACE` onto a real view), a per-session view cap, a short TTL not extended by keep-alive, and a reaper. Session-only dvs have no DB row, and every current dv route is keyed by a `dashboard_dynamic_views` id, so they need a NEW ad-hoc inline materialize path (spike S1). Fallback: draft rows with `draft_owner`.
5. **Shared package.** `packages/shared` (zod `AiOp` union, `WidgetAction`, allow-list v3, per-type validators). The server has no zod today and cannot import web code.
6. **SQL-GPT:** deferred; at most an optional single-shot `generate_sql` tool — it has no tool calling or streaming and cannot sit behind `LlmProvider`. **MCP:** not built; the tool registry is `{name, zodSchema, kind, handler}` so an MCP facade can be generated later.
7. **Dependencies.** Node 20 (`node:20-alpine`) rules out Vercel AI SDK 7 and `openai` v7 (both need Node ≥22). OpenAI-compatible provider and SSE reader/writer are hand-written on `fetch`. Per operator decision, the Claude adapter is also `fetch` (no SDK). Server `zod` (already a web dep, same range).
8. **Streaming vs batching.** Stream `status`/`step` events live for progress; the client buffers validated ops and applies them as ONE batch at turn end — one re-materialize cascade, atomic per-turn apply, one undo unit per turn.
9. **Data access.** `AI_DATA_ACCESS=schema|query`, default `schema`. In `schema` mode the query tools are NOT REGISTERED. One redaction/serializer choke point on the outbound message builder tags content by class (`schema`, `config`, `values`, `rows`). A canary-value test proves no row value leaves, including error paths.

## Key Findings

### Stack
- Thin adapter in `packages/server/src/ai/`: normalised event-level `LlmProvider` (`text_delta | tool_call | done | error`) with capability flags. Implementations: OpenAI-compatible (`fetch` → `/chat/completions`; Gemini, Ollama, vLLM, LM Studio, gateways) and Claude (`fetch` → `/v1/messages`).
- Own agent loop (mutate tools return to the browser, not the model). One sequential tool call per step; JSON-mode fallback for weak local models; keep the tool count ~8–10; retry once with the zod error.
- Streaming: POST + fetch `ReadableStream` with hand-written SSE framing (`EventSource` is GET-only). Express needs `flushHeaders`, `X-Accel-Buffering: no`, heartbeat, abort on `req.close`; mid-stream errors are SSE `error` events (errorMiddleware cannot send JSON after headers).
- Env-only config, fail closed: `AI_ENABLED`, `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL` (admin-only; SSRF-safe), `AI_MODEL`, `AI_DATA_ACCESS`, `AI_MAX_TOOL_STEPS`, `AI_TIMEOUT_MS`, plus usage caps.
- Do NOT add: `ai`/`@ai-sdk/*`, `openai`, `langchain`, `@modelcontextprotocol/sdk`, `eventsource`, `ws`/`socket.io`.

### Features
- **Table stakes:** NL → structured dashboard edits; visible "what changed"; undo; follow-up suggestions; clarify/refuse on ambiguity; atomic per-turn apply; bounded repair (1–2) on invalid references; execution under the user's permissions; audit.
- **Differentiators:** dashboard-as-answer (no transcript); highlight where the answer landed; spatial/map-layer awareness; on-prem provider.
- **Anti-features:** chat transcript; unvalidated model SQL or config; auto-save to the shared dashboard; raw rows to the model by default; free-text causal "insights"; DB-stored AI settings.
- **Deferred:** plan-then-approve, thumbs feedback, SQL-GPT backend, proactive insights, re-generation over an existing dashboard, selective per-step Keep, saved filters on Keep, spatial/draw filters, voice, cross-dashboard/join asks, MCP facade.
- Competitor claims are from vendor docs (MEDIUM); Hex, Metabase Metabot and Omni were not researched.

### Architecture
- Server loop is stateless between asks: the client sends a compact snapshot of the EFFECTIVE dashboard plus last-turn summaries.
- Mutate tools validate against shadow state, update it, return a tool_result, and emit an `op`.
- Client `aiSessionStore` holds the op log with inverses and derives effective widgets/layers/dvs, merged at the read sites: `DashboardsPage`, `MapChartRenderer` (~L534-539), `LegendRenderer`, `applyLayerOverrides`. Do not use draft DB rows (they leak into every list query).
- Filters: a NEW sibling `lib/aiOps/aiFilterApplier.ts` calling `filterStore` (`setBulkFilters`, `addDvFilter`), preserving the `ACTION-ENGINE-NO-FILTER` invariant and `actionEngineDecoupling.spec.ts`. Filters are viewer state — not persisted by Keep (say so in the Keep UI). Badges must read `filterCombinationStore`.
- Keep: `POST /api/dashboards/:id/ai-keep` — one `db.transaction`; re-validate; create dvs → layers → widgets with temp→real `RefIdMaps`/`remapWidgetConfigRefs` (reuse `lib/dashboardExportRefs.ts`, NOT `applyDashboardImport`, which always creates a new dashboard and needs `DATASETS_MANAGE`); then patches; then removals. `expectedDashboardUpdatedAt` → 409. Per-op permission re-check (`DASHBOARDS_EDIT`, `LAYERS_MANAGE`, `DYNAMIC_VIEWS_MANAGE`, `WIDGETS_CONFIGURE`) plus `canViewDashboard`. All-or-nothing.
- Query tool: `kineticaSql(req, sql, {op:"AI_QUERY"})` runs as the user; add an `sqlGuard` (single SELECT, real parser, fail closed) — Kinetica grants alone are not a read-only guarantee.
- Generate: create an empty dashboard via existing routes → run the same loop in `generate` mode into the session layer → Keep. One mechanism for both flows; importing an AI-authored export file was rejected.

### Critical Pitfalls
1. **Client-side trust / confused deputy.** Server gateway, session identity, no service account, Keep re-checks edit rights. Test: a valid patch from a user without edit rights is rejected.
2. **Egress and prompt injection.** Schema-only default; query tools unregistered; redaction choke point; plain-text rendering; per-turn caps on tool calls and mutations; confirmation above a destructive threshold. Test with a scripted "obedient" provider reading a poisoned table comment.
3. **Model SQL for dvs.** Structured spec, server-chosen names, session view cap, short TTL, count preflight, SSYNC-F6 first.
4. **Hallucinated columns/configs.** Live-schema validation, nearest-candidate errors, repair cap, column enums in tool schemas, `ALLOW_LIST_VERSION` → v3, new tool kinds rather than overloading `configPatch`. Several current validators are bare `z.string()`.
5. **Session-layer bugs.** Op log with inverses; temp ids never reach persisted routes; Keep is one transaction; view reaper (logout, switch, undo, boot sweep); undo/Keep disabled while streaming; `onLayoutChange` must not persist AI geometry during review.
6. **Project-specific.** Undefined CSS classes and layout defects pass every gate — reuse `global.css` classes, no hex/rgba, portal modals, route legibility to `checkpoint:human-verify`. Map WMS is a separate read path (both `buildWmsParams` sites + dep keys). A new RBAC permission ripples across rbacDb / rbacMigration / web permissions / RolesPage specs + `permissionGroups` — one plan owns it. `track_config`/`cb_config` are top-level layer fields. Only ONE plan edits shared planning docs. Every grep acceptance criterion must read 0 before the work. Dev `.env` leaks into server vitest — tests must force the fake provider.

## Implications for Roadmap (phases start at 133)

| Phase | Name | Delivers | Research flag |
|---|---|---|---|
| 133 | AI contract, shared package, prerequisites, spikes | `packages/shared` (AiOp, WidgetAction, allow-list v3, temp ids via `nonzero()` on the AI path, validators); `AI_*` env fail-fast; `LlmProvider` interface; SSYNC-F6 fix; spikes S1, S2, S3, S7; Keep op-shape contract | needed (S1, S3) |
| 134 | Session layer engine (client, no LLM) | `aiSessionStore`; effective-list merging at all read sites; cleanup chain incl. temp-dv drop; `onLayoutChange` gating (S5); `AI_SOURCE_ID` rebuild-from-log | standard (parallel with 135) |
| 135 | Server gateway, agent loop, providers, read tools, safety foundations | `aiRoutes`, `agentLoop`, OpenAI-compat + Claude adapters, tool registry/gateway, `get_schema`/`get_dashboard`, shadow state, redaction layer, scripted + recorded providers, `ai_audit` hooks, `ai:use` permission (one plan owns ripple), `/api/ai/config` | needed (S6) |
| 136 | AI widget + streaming | `definitions/ai.ts`; Compact/Full renderer + config panel; stream client; progress/explain/follow-up/clarify UI (plain text); cancel; single in-flight; highlights; Keep/Discard bar | needed (S2) |
| 137 | Structural + edit ops | add/remove/edit widget and layer tools; per-type validators (S3); layout placement/resize/reorder; no model hex; mutation caps | standard |
| 138 | Filters | `aiFilterApplier`; apply/clear filter tools; inverses with prior per-source state; `FILTER_CAP_PER_TABLE`; map WMS verification | standard |
| 139 | Session-only dynamic views | structured-spec `add_dynamic_view`; ad-hoc materialize; TTL/cap/reaper; both map `buildWmsParams` sites; `remove_dynamic_view` | needed (S1, S7) |
| 140 | Query tool / data-access mode | `run_query`, `get_column_profile`, `sqlGuard`, row/cell caps, env gating, canary tests on every tool and error path, injection fixtures | needed |
| 141 | Keep | `ai-keep` transaction, re-validation, per-op permissions, 409, idMap + client re-key (S4), "filters not saved" notice | standard |
| 142 | Generate + governance + hardening | starter-dashboard flow; delete-on-discard; audit viewer page + permission; usage caps; live UAT on Gemini + Ollama; tested-models matrix; supersede `mcp-action-seam.md` | standard |

Ordering rationale: the shared contract is consumed by server, client and Keep, so it goes first. Filters precede dvs because they reuse existing machinery. The query tool precedes Keep so the security review isn't rushed. Generate composes everything, so it is last. Safety plumbing (redaction, audit hooks, fake provider) lands in 135 because retrofitting it is where gaps appear.

## Consolidated Spikes

| # | Spike | Question | Fallback | Phase |
|---|---|---|---|---|
| S1 | Dv ad-hoc materialize | Can `materializedView.ts` + TTL serve an inline definition with a session-scoped name and no DB row? Does the dv branch of `/api/filter/materialize` accept an inline def? | Draft rows with `draft_owner` | 133 |
| S2 | SSE through proxy | Does the deploy nginx buffer `text/event-stream`? POST streaming with cookie auth and the 1 MB body limit; session TTL mid-stream | NDJSON over POST, or job polling (export precedent) | 133 (verify 136) |
| S3 | Per-widget-type validators | Can zod validators be derived from `ChartTypeDefinition.fields` + data-binding keys for all types? | Subset of widget types in v2.0 | 133 |
| S4 | Temp-id re-keying after Keep | `dvFilters`, `dynamicViewStore.views`, `vizToHash` are id-keyed | Reset affected stores and re-materialize | 141 |
| S5 | Layout during review | Does gating `onLayoutChange` keep AI geometry unpersisted without reflowing saved widgets? | Reserved rows below existing content | 134 |
| S6 | Tool calling on Gemini + local model | Reliability of the OpenAI-compatible path on Gemini and one Ollama model (Intel Mac = CPU-only, slow) | JSON-mode action-plan adapter + tested-models matrix | 135 |
| S7 | Kinetica capabilities | Read-only role, statement timeout, cost/row preflight on materialize | App-side guard, row cap, view cap | 133 (consumed 139/140) |

## Confidence

| Area | Level | Notes |
|---|---|---|
| Stack | HIGH/MEDIUM | Versions and Node engines verified with `npm view` 2026-10-08. Proxy streaming MEDIUM. Local-model behaviour MEDIUM-LOW. SQL-GPT shape LOW-MEDIUM. |
| Features | MEDIUM | Competitor claims from vendor docs; Hex/Metabase/Omni unverified. |
| Architecture | MEDIUM-HIGH | Integration points verified in the repo; S1, SSE, local models unverified. |
| Pitfalls | MEDIUM | Repo-history pitfalls HIGH; general LLM security MEDIUM; provider specifics LOW. |

## Gaps

- S1 decision (ad-hoc materialize vs draft rows) at the end of Phase 133.
- Local-model support is unproven: ship a tested-models matrix; never claim "any OpenAI-compatible endpoint works".
- Kinetica read-only role / timeouts / cost preflight unverified — grants are not the only read-only control.
- Audit prompt-retention policy needs an operator decision.
- Keep concurrency: minimum is a 409; "Keep anyway" semantics decided in Phase 141 planning.
- The session layer does not survive reload (locked) — keep it in memory.
- Gemini free tier may use prompts for training — live UAT on demo tables only.

## Sources

- **Primary (HIGH):** repo — `packages/web/docs/mcp-action-seam.md`, `widgetAction.ts`, `actionAllowList.ts`, `widgetActionStore.ts`, `filterStore.ts`, `filterCombinationStore.ts`, `DashboardsPage.tsx`, `MapChartRenderer.tsx`, server `index.ts`, `kinetica.ts`, `rbac.ts`, `lib/dashboardImport.ts`, `lib/dashboardExportRefs.ts`; PROJECT.md, CLAUDE.md, project memory; npm registry (2026-10-08).
- **Secondary (MEDIUM):** vendor docs for Power BI, Databricks, ThoughtSpot, Looker, Tableau; Kinetica SQL-GPT docs; OWASP LLM Top 10 themes.
- **Tertiary (LOW):** vLLM/Ollama tool-calling behaviour; Kinetica read-only/timeout capabilities; SSE through customer proxies; 2023 Kinetica LLM posts.

---
*Synthesized 2026-10-08 from four parallel researchers; operator decisions appended after research.*
