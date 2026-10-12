# Phase 135: Server Gateway, Agent Loop, Providers & Governance Core - Research

**Researched:** 2026-10-12
**Domain:** Server-side LLM agent loop (Express 4 / Node 20 / SQLite), provider adapters on plain `fetch`, one validation gateway, RBAC, audit, caps
**Confidence:** MEDIUM-HIGH (repo facts HIGH; Claude wire format HIGH from current official docs; Gemini/Ollama OpenAI-compat quirks MEDIUM/LOW — that is exactly what S6 must measure)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**"Use AI" permission (AIGOV-V20-01)**
- **D-01** **One permission: `ai:use`** (asking the AI). Adding an AI widget to a dashboard additionally requires the existing edit/widget permissions (`dashboards:edit` / `widgets:configure`) — no separate "manage AI widget" permission.
- **D-02** **Default grants: `admin` (automatic, all permissions) and `designer`.** NOT `analyst`, NOT `user_admin` — admins grant it to analysts/custom roles on the Roles page.
- **D-03** A user who can view a dashboard but lacks `ai:use` sees the AI widget as a **read-only notice** ("You don't have access to the AI assistant") — no ask box; layout unchanged. Server refuses AI requests regardless (UI notice is built in 137; the server refusal + `/api/auth/me` permission exposure are here).
- **D-04** This phase OWNS the permission ripple (catalog count 18 → 19; rbacDb / rbacMigration / web permissions / RolesPage specs; `permissionGroups` wiring) — in ONE plan.

**Conversation memory & context (full chat — changed 2026-10-12)**
- **D-05** Each ask sends the AI the **last ~6 exchanges in full plus a short system-written summary of earlier turns** (bounded cost / free-tier quota; follow-ups like "now make it blue" work). Exact N is Claude's discretion, env-tunable if cheap.
- **D-06** Prior answers in that history include **what actually changed, built from the session change log** (applied/skipped ops), not the AI's prose — so the AI knows the true current state.
- **D-07** Tables: the AI starts with **this dashboard's tables**; a **`list_tables` (+ describe) tool** lets it look up other registered tables the user can access when a question needs them. Every table it can see is filtered by the user's own access (AISAFE-V20-03).
- **D-08** The server stays stateless between asks: the client sends the effective dashboard snapshot + the bounded history with each ask (research ARCHITECTURE). The conversation itself lives in the client session layer (Phase 134); the server does not store it except in the audit log (D-09).

**Audit log (AIGOV-V20-04)**
- **D-09** Each AI answer writes one record: user, time, dashboard, **the question, the AI's full answer text**, tools run (names + validated args, no row values), changes applied / rejected with reasons, outcome (ok / cancelled / capped / provider error / rate-limited), provider + model, token counts. **Never row values** (schema mode guarantees none; query-mode results are never stored).
- **D-10** Retention via **`AI_AUDIT_RETENTION_DAYS`, default 90** (0 = keep forever); a periodic sweep deletes older records.
- **D-11** Phase 142's audit viewer **reuses the existing `audit:view` permission** (no second permission ripple). → AIGOV-V20-05 reworded 2026-10-12.

**Usage caps & provider rate limits (AIGOV-V20-06)**
- **D-12** `AI_MAX_ANSWERS_PER_USER_PER_HOUR` default **30** (0 = no cap); `AI_MAX_TOOL_STEPS` default 8 (already parsed in 133).
- **D-13** Optional whole-deployment **`AI_MAX_ANSWERS_PER_DAY`**, default **0 = off** (for shared / free-tier keys).
- **D-14** Provider **HTTP 429 mid-answer: wait and retry briefly** — honour `Retry-After`, up to ~20 s total within the answer, emitting a "Waiting for the AI provider…" status; then stop with a clear message. Because answers apply atomically, nothing from a failed answer is applied.
- **D-15** Cap messages are **specific and say when**: e.g. "You've used 30 AI answers this hour. Try again in 12 minutes." / "This answer reached the 8-step limit; try a more specific question." / daily: "The AI's daily limit for this deployment has been reached." Admins can raise limits via env.

### Claude's Discretion
- Gateway/tool-registry design, SSE event shapes, provider interface details (normalised events + capability flags per research), where caps are counted (SQLite table vs in-memory + audit-derived), summary generation method for D-05 (deterministic from the change log is preferred over an extra model call).

### Deferred Ideas (OUT OF SCOPE)
- AI-F13 per-dashboard "viewers can prompt" switch (already deferred).
- Separate "manage AI widget" permission — rejected for v2.0 (D-01).
- (Phase boundary) chat UI / drawer / revert buttons (137), real structural ops + placement (136), filters (138), dynamic views (139), query tool + SQL guard + injection fixtures (140), Keep (141), audit viewer page (142), nginx stream-location change (137).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AISAFE-V20-02 | Every AI change passes one server-side gateway (shape → allow-list → user's permissions → live schema) before reaching the browser; failing change is rejected, never applied | §Gateway order; ops buffered server-side and emitted once at end (§Agent loop); `validateActionPatch`/`parseAiOp` already in `@kinetica-bi/shared`; live schema via user-credentialed `LIMIT 0` probe (S1.5a) |
| AISAFE-V20-03 | AI never exceeds the asking user's rights: sees only tables the user can see, proposes only changes the role allows | §RBAC per op kind table; `canViewDashboard` + `listDashboardTables`; per-user Kinetica probe for `list_tables`; per-op `getEffectivePermissions` re-read; hide tools the user cannot use |
| AIPRV-V20-04 | Claude provider exists, unit-tested, documented as not live-verified | §Claude adapter (verified 2026-10 against platform.claude.com: event flow, `input_json_delta`, `tool_result` ordering, thinking-block replay, no forced `tool_choice` on Sonnet 5.5); recorded fixtures hand-built from doc examples |
| AIPRV-V20-05 | Key never reaches browser or logs; tests never call a real provider or read dev key | §Secrets & test isolation: non-enumerable `apiKey` (133), injected `fetchFn`, `tests/setup.ts` blanks (extend with new env names), sentinel-key log-capture test with positive control |
| AIGOV-V20-01 | Admin grants "Use AI"; server refuses without it | §RBAC ripple (exact files/lines), seed is history-gated so existing DBs auto-seed designer grant; `requirePermission(PERMISSIONS.AI_USE)` |
| AIGOV-V20-02 | Schema mode by default; planted canary never reaches provider incl. error paths | §Data-access choke point: classified outbound builder, adapters accept only the builder's branded output, query tools unregistered in schema mode, canary + positive-control tests |
| AIGOV-V20-04 | Every answer logged, no row values | §Audit table (`ai_audit`), write-at-start/finalize-in-`finally`, 90-day sweep |
| AIGOV-V20-06 | Env usage caps; capped user told why | §Caps: SQLite-derived rolling window, exact message strings, 429 retry budget |
</phase_requirements>

## Summary

Phase 135 is almost entirely **new server code** with two small cross-cutting edits (permission catalog ripple, boot-time sweep hook). The repo already provides the hard parts the gateway needs: `parseAiOp` / `validateActionPatch` / `AI_BLOCKED_CONFIG_KEYS` (`packages/shared`), `requirePermission`, `canViewDashboard`, `listDashboardTables`, `kineticaSql` run as the user, `principalForSession(sid)` (per-call session re-check, `lib/exportRunner.ts:158`), the S2-proven POST+SSE pattern (`src/spikes/sseSpike.ts`), the export-TTL sweep pattern (`lib/exportCleanup.ts:49-80`), and fail-closed AI env parsing (`lib/aiConfig.ts`). Nothing about providers, tools, audit, caps, or SSE routing exists yet (`grep /api/ai` in `index.ts` = 0).

The biggest design consequence of the locked decisions: **D-14 + atomic apply means the server must buffer every validated op and emit them in ONE `result` event only after the loop finishes successfully.** A 429 give-up, step cap, timeout or cancel therefore emits no ops at all. Intermediate SSE events carry only labels/status. This also makes "a failing change never reaches the browser" structurally true.

The biggest risks are provider quirks, not our code: Gemini's OpenAI-compat layer (a) has historically omitted `index` on streaming `tool_calls` deltas, (b) for Gemini 3 models **requires `extra_content.google.thought_signature` to be echoed back on the assistant message or returns HTTP 400**, (c) rejects/ignores JSON-Schema constructs (`$ref`, `anyOf`, `oneOf`, `additionalProperties`), and (d) free-tier limits are low and project-specific, with 429 retry delays often > 20 s (so D-14 will give up often in dev). Claude Sonnet 5.5 additionally **rejects forced `tool_choice`** and needs `thinking`/`redacted_thinking` blocks replayed verbatim. The normalised message model therefore needs an opaque per-assistant-message `providerState` that each adapter round-trips. S6 (operator-run) must measure these on real Gemini; its recorded wire captures become the OpenAI-compat adapter's fixtures.

**Primary recommendation:** Build `packages/server/src/lib/ai/` as: `provider.ts` (normalised events + capability flags + opaque `providerState`) → `outbound.ts` (the single classified egress choke point; adapters only accept its branded output) → `providers/{openaiCompat,claude,scripted,jsonAction}.ts` → `gateway.ts` + `tools/` registry (flat, `$ref`/`anyOf`-free schemas) → `agentLoop.ts` (sequential steps, buffered ops, injected `sleep`/`now`) → `aiAudit.ts` (SQLite, also the cap counter) → `src/aiRoutes.ts` (`registerAiRoutes(app)`), with the `ai:use` ripple as its own single plan and S6 as an operator checkpoint that selects the default tool mode.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node `fetch` / `AbortSignal.any` / `ReadableStream` | built-in (Node 20; dev machine Node 24) | Both provider adapters + SSE parsing | Node 20 rules out `ai` SDK 7 and `openai` v7 (need Node >= 22); decided in SUMMARY §7. `AbortSignal.any` is Node >= 20.3 |
| `zod` | `^3.25.76` (already a server dep; installed 3.25.76) | Tool arg schemas, request-body schema | Shared contract is zod v3 API |
| `@kinetica-bi/shared` | workspace | `AiOpSchema`, `parseAiOp`, `validateActionPatch`, `AI_BLOCKED_CONFIG_KEYS`, `ALLOW_LIST_VERSION="v3"` | Single source for server+client+Keep. Build aliases it into esbuild (`package.json` `build` script) — new shared files exported from `shared/src/index.ts` are bundled automatically |
| `better-sqlite3` | `^12.8.0` (existing) | `ai_audit` table + cap counting | Same pattern as `rbac_audit`, `export_jobs` |
| `zod-to-json-schema` | `^3.25.2` (npm view 2026-10-12: 3.25.2, modified 2026-03-27; peer `zod ^3.25.28 \|\| ^4`) | zod tool schema → JSON Schema for provider `tools` | Only new runtime dep. Call with `{ $refStrategy: "none", target: "jsonSchema7" }` then run `sanitizeToolSchema()` (strip `$schema`, `additionalProperties`) and assert no `$ref/anyOf/oneOf/allOf` remain |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `^4.1.5` (existing) | Specs | All tests; no new test deps |
| `supertest` | `^7.2.2` (existing) | Route specs | Non-streaming paths (401/403/400/429 JSON). For SSE abort/heartbeat use `createApp()` + `app.listen(0)` + `fetch` like `sseSpike.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `zod-to-json-schema` | `import { z } from "zod/v4"` + `z.toJSONSchema` (ships in 3.25.x) | Zero new dep, but shared `AiOpSchema` is v3 and cannot be converted by v4's function; tool schemas here are small and flat, so either works. Recommendation: take the dep (one pure function, STACK.md decision) |
| Streaming adapter | Non-streaming `stream:false` per step | Far simpler and sidesteps Gemini's missing-`index` quirk. Loop only needs final text + tool calls (ops are buffered anyway). Implement streaming (progress + text) but keep adapter option `stream` so S6 can compare; if S6 shows streaming tool deltas are flaky, default to `stream:false` for tool-bearing steps |
| `@anthropic-ai/sdk` | plain fetch | Operator decision: no SDK (cannot be exercised). Streaming parser is ~60 lines (below) |

**Installation:**
```bash
cd packages/server && npm install zod-to-json-schema@^3.25.2
```
(No other new packages. Do NOT add `ai`, `@ai-sdk/*`, `openai`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `eventsource`.)

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/src/
├── aiAsk.ts                 # NEW: AskRequestSchema (zod) — client (137) + server share it; export from index.ts
packages/server/src/
├── aiRoutes.ts              # NEW: registerAiRoutes(app) — mirrors exportRoutes.ts; POST /api/ai/ask (SSE), GET /api/ai/config
├── lib/
│   ├── aiConfig.ts          # EXTEND: caps fields + log line (parseAiConfig); retention parsed separately (must work when AI disabled)
│   ├── aiAudit.ts           # NEW: ai_audit CRUD, cap counter, sweep (pattern: lib/exportCleanup.ts)
│   └── ai/
│       ├── provider.ts      # LlmProvider, LlmMessage, LlmEvent, capabilities, ProviderError kinds
│       ├── outbound.ts      # classified parts → OutboundRequest (branded). THE egress choke point
│       ├── retry.ts         # 429/5xx wait-and-retry (budget 20 s), injected sleep
│       ├── sse.ts           # writer (server→browser) + parseSse (provider→server) helpers
│       ├── providers/
│       │   ├── openaiCompat.ts
│       │   ├── claude.ts
│       │   ├── scripted.ts  # test-only ScriptedProvider + RecordingProvider
│       │   └── jsonAction.ts# decorator: native-tools-less fallback (JSON action plan)
│       ├── gateway.ts       # check(ctx, toolCall) -> {ok,op,stage,reasons}
│       ├── opPermissions.ts # op kind -> required permissions (reused by Keep in 141)
│       ├── liveSchema.ts    # user-credentialed LIMIT 0 probe + per-(user,table) TTL cache
│       ├── context.ts       # system prompt + snapshot projection + conversation context (D-05/06)
│       ├── tools/{registry.ts,read.ts,mutate.ts}
│       └── agentLoop.ts
├── spikes/toolCallSpike.ts  # NEW: S6, operator-run (not part of the Express app)
tests/
├── fixtures/ai/             # recorded wire captures (sanitised) — see Recorded fixtures
├── helpers/aiTestKit.ts     # forbidProviderNetwork(), ScriptedProvider builders, canary constants, log capture
└── lib.ai*.spec.ts, routes.ai*.spec.ts
```
Naming follows the flat `lib.<module>.spec.ts` / `routes.<x>.spec.ts` convention in `packages/server/tests`. (STACK.md suggested `src/ai/`; ARCHITECTURE.md and repo convention say `lib/` — use `lib/ai/`.)

### Pattern 1: Normalised provider interface (event level, opaque replay state)
**What:** Adapters translate wire formats to one event stream and one message model. Assistant messages carry `providerState` (opaque, adapter-owned) that is replayed verbatim on the next request.
**Why:** Gemini 3 needs `thought_signature` echoed; Claude needs `thinking`/`redacted_thinking` blocks replayed unchanged during tool use (400 otherwise). Without an opaque slot the loop would have to know provider internals.
```typescript
// Source: design for this phase; wire facts verified (Claude docs 2026-10, Gemini forum/docs 2026)
export type ToolSpec = { name: string; description: string; jsonSchema: Record<string, unknown> };
export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: { id: string; name: string; args: unknown; providerState?: unknown }[]; providerState?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };
export type Capabilities = {
  nativeTools: boolean; parallelTools: boolean; streaming: boolean;
  usageInStream: boolean; forcedToolChoice: boolean; opaqueReplay: boolean;
};
export type ProviderErrorKind =
  "rate_limited" | "overloaded" | "auth" | "bad_request" | "network" | "timeout" | "aborted" | "protocol";
export type LlmEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; argsRaw: string; providerState?: unknown } // argsRaw: never pre-parsed by adapter
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "done"; finish: "stop" | "tool_calls" | "length" | "filtered" | "other"; assistantState?: unknown }
  | { type: "error"; kind: ProviderErrorKind; status?: number; retryAfterMs?: number }; // NO provider body text
export interface LlmProvider {
  readonly id: string; readonly capabilities: Capabilities;
  complete(req: OutboundRequest, signal: AbortSignal): AsyncIterable<LlmEvent>;
}
```
Rules: error events carry only `kind/status/retryAfterMs` (never the provider's body text — provider bodies can echo prompts, and user-visible messages are fixed strings per kind); `argsRaw` stays a string so the loop's zod parse is the single parse point; when `done.finish` is absent/`other` but tool calls were seen, treat as `tool_calls` (Ollama sometimes omits `finish_reason` — LOW confidence, tolerate).

### Pattern 2: Single classified egress choke point (AIGOV-V20-02)
**What:** Every string destined for a provider is created via a class-tagged constructor; `buildOutboundRequest(parts, dataAccess)` is the ONLY producer of the branded `OutboundRequest` type that adapters accept. In `schema` mode parts classed `values`/`rows` cause a hard `EgressViolation` (request not sent, answer recorded as error).
```typescript
type DataClass = "system" | "user" | "schema" | "config" | "values" | "rows";
declare const brand: unique symbol;
export type OutboundRequest = { readonly [brand]: true; system: string; messages: LlmMessage[]; tools: ToolSpec[] };
const ALLOWED: Record<AiDataAccess, ReadonlySet<DataClass>> = {
  schema: new Set(["system", "user", "schema", "config"]),
  query:  new Set(["system", "user", "schema", "config", "values", "rows"]), // 140 only; unreachable in 135
};
```
Tool results fed back to the model are built by per-tool **allow-listed serializers** from typed objects (never `JSON.stringify(upstreamResponse)` or `err.message`). Error text to the model is always one of our fixed strings plus schema-class identifiers ("column `x` not found; did you mean `y`?"). Never forward `KineticaUpstreamError.message` or the Kinetica `console.error` body (Kinetica error bodies can echo values). Compile-time brand + runtime class check + canary test = three layers.

**Snapshot projection (important, easy to miss):** the client snapshot contains *viewer state with values* (active filter values, radio options, info-card templates, `customWhere`). Project it through an allow-list: widget `{id,type,title,tableId,layout{x,y,w,h},binding{metric,aggregation,groupByColumns,dimension}}`, layer `{id,title,tableId,renderMode,visible}`, dv `{id,name}`, filters as `{source,column,op}` **without values** in schema mode. Titles/column names are class `config`/`schema` (always sent; document that, per PITFALLS C4). Never pass the raw `config` blob.

### Pattern 3: Gateway = one pure-ish function, fixed stage order
Order is the roadmap's: **shape → allow-list → user's permissions → live schema**, with referential/shadow checks between permissions and live schema.
1. tool name exists in THIS request's registry (tools the user may not use are not even registered; gateway still enforces)
2. `tool.zodSchema.safeParse(args)` (strict; `argsRaw` JSON.parse failure = shape failure); build `AiOp`; `parseAiOp(op)` (shared strict union; temp ids must be negative)
3. allow-list: patch → `validateActionPatch(kind, widgetTypeFromShadow, configPatch)`; add_widget → `type ∈ AI_WIDGET_SUBSET` (bar,line,pie,table,bignumber,records,map per 133 checkpoint), no `AI_BLOCKED_CONFIG_KEYS`/`PERMANENTLY_BLOCKED_KEYS` keys in `config`
4. RBAC: `getEffectivePermissions(username)` **re-read at this op** ∩ `OP_PERMISSIONS[op.op][+target kind]`, plus `canViewDashboard(username, dashboardId)`
5. shadow-state referential: target id exists in the (effective) snapshot and not already removed; temp id unused
6. live schema: every column/table reference (`metric`, `groupByColumns`, `dimension`, table id) checked against `liveColumns(principalForSession(sid), table)`; miss → error with nearest-candidates list (Levenshtein/prefix, schema-class text)
7. apply to shadow, append to `bufferedOps`, return `ok` tool result. Rejected calls are recorded in the audit with `{stage, reasons}` (rejections are the injection signal — PITFALLS M6).

Repair: rejected shape/live-schema errors go back to the model as `isError` tool results; bound at 2 rejections per tool name per answer; every tool execution (including rejected ones) counts toward `AI_MAX_TOOL_STEPS`.

### RBAC per op kind (single table, reused by Keep in 141)
| Op | Required (all) |
|----|----------------|
| `patch` target widget | `widgets:configure` |
| `patch` target layer | `layers:manage` |
| `patch` target dynamicView | `dynamic_views:manage` |
| `add_widget`, `remove_widget` | `dashboards:edit` |
| `add_layer`, `remove_layer` | `layers:manage` |
| `add_dynamic_view`, `remove_dynamic_view` | `dynamic_views:manage` |
| `apply_filter`, `clear_filter` | none beyond `ai:use` + `canViewDashboard` (filters are viewer state; analyst-passthrough) |
Matches ARCHITECTURE Q6's Keep gate so 141 can import the same table. **Assumption to confirm with operator:** an analyst granted `ai:use` can use the AI for filters/Q&A but structural ops are rejected at the gateway with a plain explanation (this is what success criterion 1 "a valid change from a user lacking the right is rejected" requires). Register only the mutate tools the user's permissions allow (fewer wasted steps), gateway still enforces.

### Tools in Phase 135
| Tool | Kind | Phase 135 behaviour |
|------|------|---------------------|
| `get_dashboard` | read | From shadow snapshot projection (no Kinetica call) |
| `list_tables` | read | Registered tables (`listTables()` — **not** access-filtered, `index.ts:2550`) probed as the user (`SELECT * FROM schema.name LIMIT 0`, concurrency 4, cap 50, 60 s per-(user,table) cache); inaccessible tables omitted; return `{id,schema,name,description?,columnCount}` |
| `describe_table` | read | Same probe → live column names ∩ registry types (`tables.columns` Record<name,type>); inaccessible → "table not available" (identical text to not-found; do not leak existence) |
| `patch`, `remove_widget`, `add_widget`, `remove_layer`, `remove_dynamic_view` | mutate (validate-only) | Full gateway pipeline; emit nothing until loop end. `add_widget` validates type subset + blocked keys + live-schema binding keys only (per-type validators are 136) |
| `add_layer`, `add_dynamic_view`, `apply_filter`, `clear_filter` | — | **Not registered** (133 payloads are placeholders: `{tempId,widgetId}`, `{tempId}`, `{widgetId}`; 136/138/139 extend). Do not register a tool the model could call with a meaningless payload |
| `run_query`, `get_column_profile` | — | **Reserved names, never registered in 135**; registry builder takes `dataAccess` and a `QUERY_TOOL_NAMES` constant so 140 plugs in behind the gate |

Pitfall: `WIDGET_ALLOW_LIST` in `packages/shared/src/actionAllowList.ts` is keyed `map | chart | records` but real widget types are `bar/line/pie/...` — `validateActionPatch("widget","bar",…)` returns "no allow-list" (this is TD-V20-ALLOWLIST-KEYS, 136's job). Gateway tests for patch must use `map`/`records` fixtures; do not "fix" the allow-list in 135.

### Agent loop
```
ask → checks (perm, enabled, in-flight, caps) → audit row INSERT (running, counted=1, same tx as cap check)
→ build context (system prompt + dashboard tables schema + bounded history) → tools per user/dataAccess
→ loop (steps ≤ AI_MAX_TOOL_STEPS, deadline AI_TIMEOUT_MS, signal = any(clientAbort, deadline)):
     provider.complete → collect text/tool_calls → if no tool calls: final text, break
     for each tool_call (sequentially; each = 1 step): session re-check → gateway → tool_result message
→ final: session re-check once more → emit `result` {ops[], skipped[], text} → `done`
→ finally: finalize audit row exactly once (outcome, steps, tokens, tools_json, changes_json)
```
- One tool call per step is a *request* (Claude `tool_choice:{type:"auto",disable_parallel_tool_use:true}`; OpenAI `parallel_tool_calls:false` only if S6 shows it is accepted). The loop **tolerates** parallel calls anyway: execute in order, each counts a step, return a `tool` result for every call id (Claude/OpenAI both 400 if any id lacks a result; for unexecuted calls return `isError` "Not executed").
- Step cap hit → outcome `capped`, ops discarded, message per D-15. Cancel (client abort) → outcome `cancelled`, nothing emitted. Timeout → `provider_error` detail `timeout` (D-09's outcome list has no timeout; discretion).
- **Atomic:** `bufferedOps` is only read in the success path. Test: scripted provider issues 2 valid mutate calls then a 429 beyond budget → zero `ops` ever written to the response.
- **Injected deps** (`sleep(ms, signal)`, `now()`, `provider`, `liveSchema`, `audit`) — no fake timers (web has a known fake-timer cross-file leak; server vitest is set-based).
- **Session lifetime (S2 C5):** the stream outlives a revoked session. Use `principalForSession(sid)` for every Kinetica call (throws `SessionEndedError`), `getSession(sid)` before each tool execution and before emitting `result`; on end → outcome `cancelled` detail `session_ended`, emit `error` event `REAUTH_REQUIRED`.
- Kinetica job tagging (S7) is for 137/140. 135's Kinetica work is `LIMIT 0` metadata probes; do not add tag/find/cancel here (optionally pass a `/* kbi:ai:<requestId> */` prefix — skip unless trivial).

### Conversation memory (D-05..D-08) — request contract
Define `AskRequestSchema` in `packages/shared/src/aiAsk.ts` (so 137's client builds against it; server tests import via `@kinetica-bi/shared`):
```typescript
export const AskRequestSchema = z.object({
  dashboardId: z.number().int().positive(),
  question: z.string().trim().min(1).max(2000),
  snapshot: z.object({
    widgets: z.array(SnapWidget).max(100),     // id nonzero int, type, title<=200, tableId?, layout?, binding?
    layers: z.array(SnapLayer).max(50),
    dynamicViews: z.array(SnapDv).max(20),
    filters: z.array(SnapFilter).max(50),      // {source:{kind,id}, column, op}; values, if present, are ignored/dropped
  }).strict(),
  turns: z.array(z.object({                    // oldest→newest, all turns since last Keep/Discard (client cap 50, D-06 of 134)
    question: z.string().max(2000),
    changes: z.array(z.object({ label: z.string().max(200), status: z.enum(["applied","skipped"]), reason: z.string().max(200).optional() })).max(30),
  }).strict()).max(50),
}).strict();
```
- Server builds context deterministically (`context.ts`): last `AI_HISTORY_TURNS` (default 6, env, 1..20) turns **in full** (question + change list), earlier turns collapsed to one line ("Earlier: 3 changes applied (2 added, 1 removed), 1 skipped"). No extra model call, no AI prose replayed (D-06) — which also stops injected text in a prior AI answer from persisting in context.
- Ambiguity to flag to the operator: D-05 says "exchanges in full"; D-06 says prior answers are the change log, not prose. Research assumes: question verbatim + full change list for the last N; no AI prose. Cheap to add prose later.
- Bounds: whole body ≤ 1 MB (global `express.json`); AskRequest additionally ≤ ~64 KB serialized (zod `.max` per field + a `JSON.stringify(...).length` check → 400 `AI_REQUEST_TOO_LARGE`). Parse failure → 400 `{code:"AI_BAD_REQUEST", issues:[path+message only]}` (never echo values).

### SSE route (reuse S2 pattern)
`POST /api/ai/ask` registered via `registerAiRoutes(app)` placed before `app.use(errorMiddleware)` (index.ts:3311). `asyncHandler` is local to `createApp` (index.ts:371), so the route needs its own try/catch.
```typescript
// Source: packages/server/src/spikes/sseSpike.ts (S2, measured) + this phase's additions
app.post("/api/ai/ask", ...requirePermission(PERMISSIONS.AI_USE), async (req, res) => {
  // 1) everything that can fail BEFORE headers returns normal JSON: 503 AI_NOT_CONFIGURED, 400 body, 404 dashboard,
  //    409 AI_BUSY, 429 AI_USER_CAP / AI_DAY_CAP (+ Retry-After header)
  // 2) then:
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const clientAbort = new AbortController();
  res.on("close", () => { if (!res.writableEnded) clientAbort.abort(); });   // res, NOT req (S2 C4)
  const hb = setInterval(() => safeWrite(": ping\n\n"), 15_000); hb.unref();
  try { await runAnswer(...); } catch (e) { sendEvent("error", { code: "AI_INTERNAL", message: FIXED }); }
  finally { clearInterval(hb); finalizeAuditOnce(); if (!res.writableEnded) res.end(); }
});
```
Events (JSON in `data:`): `status {phase:"thinking"|"tool"|"waiting_provider", label, seconds?}`, `step {n, tool, label}`, `result {answerId, text, ops[], skipped[{op,stage,reasons}]}`, `error {code, message}`, `done {answerId, outcome, steps, usage}`. `result` only on success. After headers are sent, `errorMiddleware` cannot send JSON (S2/ARCH Q8) — every post-flush failure is an `error` event. `safeWrite` no-ops when `res.writableEnded || res.destroyed`. nginx stream-location directives stay in 137 (S2).

### Audit, caps, sweep
**Table (add to `SCHEMA_DDL` in `db.ts`; `CREATE TABLE IF NOT EXISTS`, no ALTER needed for fresh+existing DBs — same as `rbac_audit`, db.ts:212):**
```sql
CREATE TABLE IF NOT EXISTS ai_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,                 -- epoch ms: cap math + sweep are integer compares, clock-injectable
  username TEXT NOT NULL,
  dashboard_id INTEGER,
  request_id TEXT,
  question TEXT NOT NULL,
  answer_text TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'final'
  outcome TEXT,                           -- ok|cancelled|capped|provider_error|rate_limited
  outcome_detail TEXT,                    -- step_cap|user_hour_cap|deployment_day_cap|timeout|session_ended|interrupted|<provider error kind>; NEVER provider body text
  counted INTEGER NOT NULL DEFAULT 1,     -- 0 for cap refusals (they must not extend the lockout)
  provider TEXT, model TEXT, data_access TEXT, allow_list_version TEXT,
  steps INTEGER, input_tokens INTEGER, output_tokens INTEGER,   -- NULL when provider reported none (not 0)
  tools_json TEXT,                        -- [{name, args (validated), stage, result:"ok"|"rejected", reasons[]}]
  changes_json TEXT,                      -- {applied:[op summaries], rejected:[{op, stage, reasons}]}
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_audit_ts ON ai_audit (ts_ms);
CREATE INDEX IF NOT EXISTS idx_ai_audit_user_ts ON ai_audit (username, ts_ms);
```
- **Write timing:** INSERT `running` row inside the same `db.transaction` as the cap check (better-sqlite3 is synchronous → check+insert is atomic, so two concurrent asks cannot both pass at 29/30). Finalize with UPDATE in the route's `finally`, guarded to run exactly once. Cap refusals insert a `counted=0, outcome=capped` row (admins see them) and never start a stream. Permission-denied/AI-disabled requests are not answers → not audited (`requirePermission` already logs `permission_denied`).
- **Cap counting = SQLite-derived (survives restart; in-memory would reset on restart and under-count):**
  ```sql
  SELECT ts_ms FROM ai_audit WHERE username = ? AND counted = 1 AND ts_ms > ? ORDER BY ts_ms ASC   -- ? = now - 3600000
  ```
  If `rows.length >= cap`, the lockout ends when row `rows[rows.length - cap]` ages out: `waitMs = rows[rows.length-cap].ts_ms + 3_600_000 - now`; minutes = `ceil(waitMs/60000)`. Messages (exact, D-15): `You've used ${cap} AI answers this hour. Try again in ${m} minute${m===1?"":"s"}.` (`m<1` → "in less than a minute"); daily (rolling 24 h, count across all users): `The AI's daily limit for this deployment has been reached.`; step: `This answer reached the ${maxSteps}-step limit; try a more specific question.` Cap `0` = disabled. HTTP: 429 JSON `{code:"AI_USER_CAP"|"AI_DAY_CAP", message, retryAfterSeconds?}` + `Retry-After`. Step-cap message is delivered as an SSE `error`/`done` (outcome `capped`) because it occurs mid-stream.
- **Which answers count:** every accepted answer (`counted=1`), including cancelled/errored ones (a provider call was made). Do not count refusals.
- **Per-user in-flight guard:** in-memory `Map<username, AbortController>`; second concurrent ask → 409 `AI_BUSY` (also M3 single in-flight).
- **Sweep:** `startAiAuditSweep()` modeled on `startExportSweep` (immediate first pass, then hourly, `.unref()`, never `clearInterval`, try/catch per tick): `DELETE FROM ai_audit WHERE ts_ms < ?` when `AI_AUDIT_RETENTION_DAYS > 0`; also mark stale `running` rows (older than 15 min) `outcome=provider_error, outcome_detail=interrupted, status=final`. **Retention must run even when AI is disabled** (rows outlive a config change) → parse `AI_AUDIT_RETENTION_DAYS` in its own always-on function (invalid → default 90 + `[boot]` warn, like `readPositiveIntEnv`), not inside the enabled-gated `parseAiConfig`.
- **Boot wiring constraint:** `tests/bootstrap.spec.ts:63,70` regex-pins the IIFE order `await createApp(); … reconcileExportsOnBoot(); … app.listen … startSessionSweep(); … startExportSweep();`. Add `startAiAuditSweep();` AFTER `startExportSweep();` (extra statements after are fine; do not insert between the pinned tokens).
- **Caps in config:** add `maxAnswersPerUserPerHour` (default 30, range 0..100000), `maxAnswersPerDay` (default 0), `historyTurns` (default 6) to `AiConfig` via `parseIntInRange` (blank → default; invalid → AI disabled with message, consistent with 133). Extend `formatAiConfigLog` (never log the key). **Extend `tests/setup.ts` blanking** with every new env name (`AI_MAX_ANSWERS_PER_USER_PER_HOUR`, `AI_MAX_ANSWERS_PER_DAY`, `AI_AUDIT_RETENTION_DAYS`, `AI_HISTORY_TURNS`, any `AI_TOOL_MODE`) — dev `.env` leaks into specs otherwise (memory: dev-env-leaks-into-server-vitest).

### 429 handling (D-14)
`retry.ts`: `withProviderRetry(callOnce, {budgetMs: 20_000, sleep, now, onWait})`. Delay source precedence: `Retry-After` header (seconds or HTTP-date) → Gemini body `error.details[].retryDelay` (string like `"34s"`) → message regex `retry in ([\d.]+)s` → 2 s exponential fallback. If `delay > remainingBudget` → **do not wait**, fail immediately as `rate_limited`. Budget is cumulative per *answer* (not per call). Emit `status {phase:"waiting_provider", seconds}` before each wait; sleep is abortable by the loop signal. Also one quick retry (≤2 s, same budget) for 5xx/529 `overloaded`. Gemini free-tier reality: `retryDelay` values of 27-40 s are common in reports and the 429 header `Retry-After` is often absent → expect D-14 to give up frequently in dev; the user-visible text must say so plainly ("The AI provider is rate-limiting requests. Try again in a minute."). Fixed strings per kind; never provider text. `AI_MAX_ANSWERS_PER_DAY` is the tool for shared free-tier keys.

### Anti-Patterns to Avoid
- **Emitting ops as they validate** — breaks D-14 atomicity; emit once at end.
- **Per-tool redaction** — the setting must be enforced at the outbound builder, not in each tool (PITFALLS C4).
- **Echoing upstream errors to the model/client/audit** (Kinetica or provider bodies can contain values or prompt echoes).
- **`req.on("close")` for abort** — use `res.on("close")` (S2 C4).
- **Trusting `columns_json`/client column lists** — column truth is the user-credentialed probe (+ registry types), per 133-SPIKES S1 decision.
- **Registering placeholder-payload tools** (add_layer/add_dynamic_view/filters) in 135.
- **Sending temperature 0 by default** — Gemini 3 guidance favours the default; make it an adapter option S6 can test.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Op shape validation | custom checks | `parseAiOp` / `AiOpSchema` (shared) | Already strict, temp-id rules, used by client/Keep too |
| Allow-list / field location | new allow-list | `validateActionPatch`, `getFieldLocation`, `AI_BLOCKED_CONFIG_KEYS` | Single source of truth; `splitLayerPatch` already handles top-level `track_config`/`cb_config` (memory: track_config gotcha) |
| Permission check | ad-hoc role names | `requirePermission`, `getEffectivePermissions`, `canViewDashboard` | RBAC union semantics + bootstrap admin short-circuit |
| Kinetica as user | direct fetch | `kineticaSql(principalForSession(sid), …)` | Per-user creds, row clamps, audit line |
| Column probe | new SQL | `buildViewColumnsProbeSql` + `parseProbeColumns` + a copy of `createViewColumnsCache` keyed `username:table` | S1-measured (`LIMIT 0` → `column_headers`) |
| Identifier safety | quoting helpers | `assertIdentifier` / `SQL_IDENT_RE` (`columnGuard.ts`) | Existing convention is unquoted `schema.name` after `assertIdentifier` (index.ts:2620) |
| Sweep scheduling | custom scheduler | pattern of `startExportSweep` (`exportCleanup.ts:72`) | `.unref()`, immediate first pass, never throws |
| Audit JSON log line | new logger | `emitRbacAudit` style `console.log(JSON.stringify({...}))` | OBS-01 shape; log metadata only (no question/answer) |
| Provider SDK | `@anthropic-ai/sdk`/`openai` | ~60-line SSE parser + adapters | Node 20 / operator decision |
| JSON-schema generation | hand-written per tool | `zod-to-json-schema` + `sanitizeToolSchema` + flatness test | Drift between zod and provider schema |
| JSON extraction for fallback mode | `eval`/regex hacks | balanced-brace scanner + `JSON.parse` + zod | Never `eval` |

**Key insight:** the validation machinery already exists; this phase wires it in a fixed order behind a loop. The new, genuinely risky code is the two wire adapters and the egress builder — those get the recorded fixtures and the canary tests.

## Common Pitfalls

### Pitfall 1: Gemini 3 tool loop 400s without `thought_signature`
**What goes wrong:** Second step of a tool conversation fails: `Function call is missing a thought_signature in functionCall parts…` (HTTP 400).
**Why:** Gemini 3 returns `tool_calls[i].extra_content.google.thought_signature`; it must be echoed back exactly on the assistant message.
**Avoid:** Adapter copies `extra_content` from each streamed/non-streamed tool call into the call's `providerState` and re-emits it verbatim in the next request's assistant `tool_calls[i]`. Fixture + unit test for the round trip. (MEDIUM: Google forum thread discuss.ai.google.dev 109823; official OpenAI-compat docs confirm Gemini 3 thought signatures supported via `extra_body`.) S6 step "multi-turn tool round-trip" proves it live.
**Warning signs:** works for one tool call, 400 on the second.

### Pitfall 2: Streaming `tool_calls` deltas without `index`
**What goes wrong:** Accumulating by `index` crashes/merges calls (Gemini compat has omitted `index` since 2024, unresolved as of Nov 2025 forum report).
**Avoid:** accumulator key = `delta.index` if number, else the call `id` if present on this chunk, else "current open call"; a chunk with a new `id` starts a new call. Gemini tends to send whole calls; Ollama reportedly sends complete calls on the terminal chunk (LOW). Accept `function.arguments` as string **or** object (stringify objects).

### Pitfall 3: Unsupported JSON-Schema keywords in tool definitions
**What goes wrong:** Gemini function declarations support a restricted subset (no `$ref`, `additionalProperties`, `anyOf`/`oneOf`, discriminated unions per current function-calling docs); Ollama reportedly silently ignores tools with `anyOf`/`$ref` and answers in plain text (LOW). `zod-to-json-schema` emits `$schema`, `additionalProperties:false`, and `anyOf` for unions by default.
**Avoid:** one tool per op kind with flat object params; `{ $refStrategy:"none" }`; `sanitizeToolSchema` strips `$schema`/`additionalProperties`; a registry spec walks every emitted schema and fails on `$ref|anyOf|oneOf|allOf|not`. Enum column names are NOT inlined (wide tables) — live-schema check does that.

### Pitfall 4: Claude Sonnet 5.5 specifics
**What goes wrong:** (a) `tool_choice:{type:"any"|"tool"}` → 400 on Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Mythos 5.1 (only `auto`/`none`). (b) `thinking` is adaptive by default; assistant turns may contain `thinking`/`redacted_thinking` blocks that must be replayed unmodified in the tool loop or the request 400s. (c) Sonnet 5.5 rejects `thinking:{type:"disabled"}` (use `between_tools`). (d) `tool_result` blocks must come first in the user message and immediately follow the `tool_use` message. (e) `max_tokens` is required. (f) `message_delta.usage` token counts are cumulative.
**Avoid:** adapter never sends forced tool_choice; send `tool_choice:{type:"auto",disable_parallel_tool_use:true}`; omit `thinking`; store the raw assistant `content` array in `providerState` and replay it verbatim; group all tool results for one assistant turn into one user message with results first. All verified against platform.claude.com docs 2026-10-12 (HIGH). **Not live-verified** — fixtures are hand-assembled from the documented SSE examples; label them so.

### Pitfall 5: Free-tier quota vs multi-step answers
One answer = N model calls (each tool step is a call). At ~5-15 RPM free tier, one 6-step answer can exhaust a minute. Mitigations in design: include the dashboard's table schemas in the system prompt so common asks need 0 lookups (D-07), cap steps, honour the 20 s retry budget, daily cap env, record 429 counts in S6. Exact current free-tier numbers are unstable (sources conflict: 5-10 RPM, 100-250 RPD; "limits are project-specific, see AI Studio") — LOW; do not hard-code any number.

### Pitfall 6: Egress through error paths and snapshot values
Canary can leak via: Kinetica error text, provider error echo, active-filter values or `customWhere` in the snapshot, table `description`s (not row values, but untrusted text — delimit and length-cap), history `reason` strings. Covered by Pattern 2 + canary matrix below.

### Pitfall 7: Test isolation traps
- `createApp()` calls `loadAiConfig(process.env)` (index.ts:228) → route specs that need AI enabled must set `process.env.AI_*` (fake base URL, `AI_API_KEY="sk-test-SENTINEL"`) **before** `createApp()`, restore after; inject the provider through a `__setAiProviderFactoryForTest` seam so no real fetch to the provider URL is ever possible.
- `vi.restoreAllMocks()` in `beforeEach` does not undo `vi.stubGlobal("fetch")` — call `vi.unstubAllGlobals()` in `afterEach`.
- Negative greps ("key not in web bundle") read 0 before AND after the work (verified now: `grep AI_API_KEY packages/web/src` = 0) — per CLAUDE.md they are toothless. Use behavioural tests with a positive control instead (below).
- Server vitest gate is set-based; new specs must pass in isolation and not depend on file order.

### Pitfall 8: Long local-model latency
Operator's Intel-Mac CPU Ollama: first tokens can take minutes; default `AI_TIMEOUT_MS=60000` (max 600000) will cut it. Document that Ollama dev runs need `AI_TIMEOUT_MS` raised and a small model; add a stream idle-timeout separate from the overall deadline.

## RBAC `ai:use` ripple (D-01..D-04) — exact edit list

Seeding is **history-gated** (`lib/rbacSeed.ts`): a new `(designer, ai:use)` default has no `rbac_seed_history` row on existing DBs, so the next boot seeds it exactly once — **no explicit migration needed**; operator removals persist afterwards. Phase 81 did exactly this (commits 2d2012a, 8a6c4f2, f24f6ad; f24f6ad exists because executors missed specs).

**Source edits**
- `packages/server/src/lib/permissions.ts`: add `AI_USE: "ai:use"` to `PERMISSIONS`; add `PERMISSIONS.AI_USE` to `DEFAULT_ROLE_MAPPINGS.designer`; update the "18" comments (header line 41, admin comment line 66). `ALL_PERMISSIONS`/admin pick it up automatically.
- `packages/web/src/lib/permissions.ts`: add `AI_USE: "ai:use"` (byte-parity mirror).
- `packages/web/src/lib/permissionGroups.ts`: `PERMISSION_DESCRIPTIONS["ai:use"]`, `NOUN_TO_GROUP.ai = "AI"`, append `"AI"` to `GROUP_ORDER` (else it lands in "Other").
- `/api/auth/me` and login already return `getEffectiveRolesAndPermissions` (index.ts:446, 468) — the new permission is exposed with no code change; add a spec asserting it for a designer and its absence for an analyst.

**Spec edits (all verified by grep 2026-10-12)**
| File | Lines | Change |
|------|-------|--------|
| `server/tests/lib.permissions.spec.ts` | 20-30 (list), 33-34, 37, 52-53, 138-144 (admin), 150-151 (designer 10→11 + `EXPECTED_DESIGNER_PERMS`) | 18→19, add `"ai:use"` to `EXPECTED_PERMISSION_STRINGS`, `EXPECTED_ADMIN_PERMS`, `EXPECTED_DESIGNER_PERMS`; analyst/user_admin locks unchanged |
| `server/tests/db.rbacMigration.spec.ts` | 168/175, 178/187, 190/199, 253, 337, 461-470, 515, 531 | 35→37 rows (19+11+6+1), admin 18→19, designer 10→11, designer-removed case 9→10 |
| `server/tests/lib.rbacDb.spec.ts` | 47, 54, 61, 70-71, 77, 209-213 (+ designer `toHaveLength(10)` ~L206) | admin 18→19, designer 10→11 |
| `server/tests/routes.custom-metrics.spec.ts` | 431 | 18→19 |
| `server/tests/routes.dashboard-export.spec.ts` | 590 | 18→19 |
| `server/tests/routes.exports.spec.ts` | 409 | 18→19 (test also asserts no key matches `/export/i` — still true) |
| `server/tests/routes.dashboard-import.spec.ts` | 383 | 18→19 |
| `server/tests/auth.login-rbac.spec.ts` | 48-60 | derived from `ALL_PERMISSIONS`; verify green, add designer-has/analyst-lacks `ai:use` assertion |
| `web/src/lib/permissions.spec.ts` | 4, 10, 17-18, 44 (+ add string) | 18→19, header comment |
| `web/src/components/RolesPage.spec.tsx` | 5, 141-150, 154 | 18→19 checkboxes; 6→7 groups; add `"AI"` to the group-name loop |
| `web/src/lib/permissionGroups.spec.ts` | 88-89 (+ NOUN list ~L75-80) | `GROUP_ORDER` equality gains `"AI"`; add `"ai"` to expected nouns |
Re-grep before and after: `grep -rnE "toBe\(18\)|toHaveLength\(18\)|\.length\)\.toBe\(18" packages/server/tests packages/web/src` must go to 0 (reads 19 hits today (2 are unrelated: BrandColorSection.spec, cbColorThemes.spec, which stay), so it discriminates). Use `ai:use`-specific new assertions (e.g. `DEFAULT_ROLE_MAPPINGS.designer` contains `ai:use`, `analyst`/`user_admin` do not) as red-before tests. Server enforcement test: user with only `dashboards:view` → `POST /api/ai/ask` 403 `PERMISSION_DENIED`.

## Provider adapter specifics

### OpenAI-compatible adapter (primary live path: Gemini AI Studio, optionally Ollama)
- Endpoint `${baseUrl.replace(/\/+$/,"")}/chat/completions`; `Authorization: Bearer <key>` only when key non-empty (Ollama ignores); `redirect:"error"`; Gemini base `https://generativelanguage.googleapis.com/v1beta/openai/` (docs 2026-10).
- Request: `{model, messages, tools:[{type:"function",function:{name,description,parameters}}], tool_choice:"auto", stream:true, stream_options:{include_usage:true}, max_tokens}`. `tool_choice` is `"auto"` only (Gemini documents auto; Ollama docs list `tool_choice` as **unsupported** — omit when `capabilities.forcedToolChoice` is false and let S6 say). Unsupported OpenAI params are silently ignored by Gemini; do not rely on `parallel_tool_calls`/`response_format` there.
- Messages: system → `{role:"system"}`; tool results → `{role:"tool", tool_call_id, content}`; assistant tool calls → `{role:"assistant", content:null|text, tool_calls:[{id,type:"function",function:{name,arguments:<JSON string>}, extra_content?}]}`.
- Streaming parse (SSE `data:` lines, terminated by `data: [DONE]`): `choices[0].delta.content` → `text_delta`; `delta.tool_calls[]` → accumulate (Pitfall 2); `finish_reason` `stop|tool_calls|length|content_filter`; final chunk with `usage` (empty `choices`) → `usage`. Ignore comment lines/blank lines/unknown fields; handle chunk boundaries splitting mid-line.
- Error normalisation: body may be `{error:{…}}` **or** an array `[{error:{…}}]` (Gemini quirk, MEDIUM) — handle both; map HTTP 401/403→auth, 400→bad_request, 429→rate_limited (+`retryAfterMs` per precedence above), 5xx→overloaded, fetch reject→network, abort→aborted/timeout. Never put body text in events or logs; log `{kind,status,provider,model,request_id?}` only.
```typescript
// Tolerant tool-call accumulator (Gemini: index may be missing; args may arrive whole or fragmented)
const open = new Map<string|number, {id:string;name:string;args:string;state?:unknown}>();
let last: string|number|undefined;
for (const tc of delta.tool_calls ?? []) {
  const key = typeof tc.index === "number" ? tc.index : (tc.id ?? last ?? 0);
  let c = open.get(key);
  if (!c) { c = { id: tc.id ?? `call_${open.size}`, name: "", args: "" }; open.set(key, c); }
  if (tc.id) c.id = tc.id;
  if (tc.function?.name) c.name += tc.function.name;
  const a = tc.function?.arguments;
  if (typeof a === "string") c.args += a; else if (a && typeof a === "object") c.args = JSON.stringify(a);
  if (tc.extra_content) c.state = tc.extra_content;   // Gemini thought_signature container
  last = key;
}
```

### Claude adapter (plain fetch, not live-verified)
- `POST ${baseUrl}/messages` (config default base already includes `/v1`, `lib/aiConfig.ts:22`); headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. Body `{model, max_tokens, system, messages, tools:[{name,description,input_schema}], tool_choice:{type:"auto",disable_parallel_tool_use:true}, stream:true}` (no `thinking`, no forced tool_choice).
- Stream events (verified 2026-10 docs): `message_start` (input usage) → per block `content_block_start` / `content_block_delta` / `content_block_stop` → `message_delta` (`stop_reason`, cumulative `usage.output_tokens`) → `message_stop`; `ping` and unknown event types must be ignored; mid-stream `event: error` with `{"type":"error","error":{"type":"overloaded_error",...}}` → `error` event kind `overloaded`. Delta types: `text_delta` (`text`), `input_json_delta` (`partial_json` — accumulate, `JSON.parse` once at `content_block_stop`; first delta may be `""`), `thinking_delta`/`signature_delta` (keep inside raw block for replay). `stop_reason`: `end_turn`→stop, `tool_use`→tool_calls, `max_tokens`→length, `refusal`→filtered, `model_context_window_exceeded`→length, `pause_turn`/`stop_sequence`→other.
- Replay: assistant message = the accumulated raw `content` array (text, `tool_use`, `thinking`, `redacted_thinking` blocks) unmodified; user message = `tool_result` blocks first (`{type:"tool_result", tool_use_id, content:string, is_error?:true}`), then optional text.
- Errors: JSON `{type:"error", error:{type,message}, request_id}`; 429 `rate_limit_error` (`retry-after` header usually present, but spend-cap 429 has none and keeps failing → treat missing header as non-retryable beyond one short wait), 529 `overloaded_error`, 401 `authentication_error`, 400 `invalid_request_error`. Request-id header `request-id` is safe to log.
- Document in `packages/server/src/lib/ai/providers/claude.ts` header and in a docs note: "unit-tested against doc-derived fixtures; NOT live-verified (no Anthropic key)". Fixtures: hand-assembled from the official streaming/tool-use examples (text-only, tool_use with split `partial_json`, parallel tool_use, thinking+tool_use replay, `error` event, 429 JSON, 529) — mark `// source: platform.claude.com docs, not live-recorded`.

### Fallback: JSON action-plan decorator (`jsonAction.ts`)
A `LlmProvider` decorator (capability `nativeTools:false`) that renders tool specs into the system prompt and instructs: respond with exactly one JSON object `{"tool":"<name>","args":{…}}` or `{"final":"<text>"}`; parses tolerant (strip code fences, first balanced `{…}`, no `eval`), emits a normal `tool_call`/`text_delta` event so the loop is unchanged. Loop stays one call per step. Enabled by `AI_TOOL_MODE=json` (new env, default `native`; blank in `tests/setup.ts`) — build it in 135 (cheap, ~80 lines) and let S6 results choose the documented default per model. `response_format:{type:"json_object"}` is listed as supported by Ollama; for Gemini treat as optional (unverified).

### Recorded-fixture testing (no network in tests)
- Adapters take `fetchFn` (default `globalThis.fetch`); specs pass a stub returning `new Response(stream, {status, headers})` built from fixture files (`tests/fixtures/ai/*.sse.txt`, one SSE body per file) — include chunk-boundary splits (feed the body in 1-17 byte slices) because `ReadableStream` chunking is the classic parser bug.
- Fixture set: OpenAI-compat (text, single tool call fragmented, tool call without `index`, whole-args single chunk, parallel calls, Gemini `extra_content`, `finish_reason` missing, usage chunk, 400/401/429 JSON incl. array-wrapped error, mid-stream truncation); Claude (list above). **Real Gemini fixtures come from the S6 spike's `--record <dir>` output** (sanitised: synthetic prompts only, Authorization removed) — the operator commits them; until then the OpenAI-compat fixtures are hand-written and labelled as such.
- `ScriptedProvider(steps[])` (test dictates each response) and `RecordingProvider` (wraps any provider, records the exact `OutboundRequest` objects) in `lib/ai/providers/scripted.ts`; production code never imports them (put behind the test seam; a spec asserts `aiRoutes.ts` does not reference them).

## S6 spike design (operator-run, like 133 S1/S7)

**File:** `packages/server/src/spikes/toolCallSpike.ts` (precedent: `adhocDvSpike.ts`, `kineticaCapsSpike.ts`). Add `"tool-call-spike": "tsx src/spikes/toolCallSpike.ts"` to `package.json` scripts. The operator runs it in their own shell with their own env; **no agent ever runs it or requests a key.**
```
cd packages/server && AI_PROVIDER=openai-compatible \
  AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
  AI_MODEL=<model from AI Studio> AI_API_KEY=<operator key> \
  npx tsx src/spikes/toolCallSpike.ts --runs 5 --rpm 6 --record ./spike-out
# Ollama:  AI_BASE_URL=http://localhost:11434/v1 AI_MODEL=qwen3:8b ... --mode native|json
# optional: --burst 12  (deliberately provoke 429 to capture its shape; burns quota, off by default)
```
Reads env at runtime via `parseAiConfig` (never `.env`, never printed; log only `origin`, model, key set/unset). Uses the **production adapter + real tool registry JSON schemas** so findings apply to shipped code; a `--raw` flag additionally does a minimal bypass-adapter POST to separate adapter bugs from provider behaviour. Prompts are synthetic and use only `demo.nyctaxi`-style schema names from an inline fixture (no real data → safe on Gemini free tier, which may train on prompts). Self-paces to `--rpm` (default 6) and honours 429 delays (counted, not hidden).

**Scenarios (R runs each):** (1) `list_tables` expected; (2) `describe_table` with typed args; (3) multi-step: "add a bar chart of trips by vendor" against stub read tools → expects describe → `add_widget` (args validated by the real zod + gateway shape/allow-list stages); (4) parallel-invite prompt ("describe both tables"); (5) no-tool question → text only; (6) **multi-turn tool round-trip** (step 2 after a tool result: catches Gemini thought-signature 400s); (7) malformed-pressure: wide enum + nested object args.

**Metrics (JSON to stdout and `--out`, plus one Markdown matrix row):** valid-call rate (JSON-parsable AND zod-valid), malformed-args rate, wrong-tool rate, text-instead-of-tool rate, parallel-call rate, repair success after one zod-error bounce, p50/p95 latency and time-to-first-event, finish_reason distribution, usage fields present?, streaming deltas: `index` present? `id` present? args fragmented or whole?, `extra_content` seen?, schema rejections (400 on tool definitions — which keyword), 429 count + `Retry-After` header present? + body `retryDelay` value + whether `delay > 20 s`.
```
| provider | model | date | stream | tool valid% | malformed% | parallel% | 2nd-turn ok | index present | 429 delay>20s | verdict |
```
**Decision rule (record in `135-SPIKES.md`-style section):** native tools adopted for a model if valid-call rate >= 90% over >= 20 trials with <= 1 bounce repair and the multi-turn round-trip passes; otherwise document `AI_TOOL_MODE=json` for that model, and label it "best effort" in the tested-models matrix. Never claim "any OpenAI-compatible endpoint works". Gemini model id: operator picks per AI Studio (sources conflict on current names: docs mention `gemini-3.8-flash`/`gemini-3.1-pro`, search results mention 3.5 Flash/3.1 Flash-Lite — LOW; do not pin in code, `AI_MODEL` is env).

**Plan placement:** unit-test the spike's pure parts (metric aggregation, matrix row formatter, pacing) against fixtures in an autonomous task; the live run is a `checkpoint:human-action` in the **last** plan (the phase's default tool mode is `native` with `json` shipped, so the phase is not blocked on the run; the matrix row and any default change are recorded afterward).

## Validation Architecture

> `.planning/config.json` has `workflow.nyquist_validation: false`, which would normally skip this section. Included anyway because the orchestrator explicitly requested discriminating tests per requirement.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^4.1.5`, node env, `isolate:true`, setup `tests/setup.ts` |
| Config file | `packages/server/vitest.config.ts` |
| Quick run | `cd packages/server && npx vitest run tests/lib.ai tests/routes.ai` (< 30 s) |
| Full suite | `cd packages/server && npx tsc --noEmit && npm run test:gate` (set-based) ; web: `cd packages/web && npx tsc --noEmit && npx vitest run && npx vitest run src/styles/theme-guard.spec.ts` |

### Phase Requirements → Test Map
| Req | Behavior | Type | Automated command | Exists? |
|-----|----------|------|-------------------|---------|
| AISAFE-02 | Each stage rejects independently and a rejected/failed answer emits **zero** `ops` to the response (shape bad args; allow-list `customWhere`; RBAC; live-schema unknown column). Atomicity: 2 valid ops then provider 429 beyond budget → response has no `result` event | unit + route | `npx vitest run tests/lib.aiGateway.spec.ts tests/routes.aiAsk.atomic.spec.ts` | ❌ Wave 0 |
| AISAFE-02 | Stage order is fixed: a call failing both shape and RBAC reports `stage:"shape"`; failing RBAC and live-schema reports `stage:"rbac"` | unit | same | ❌ |
| AISAFE-03 | Valid `add_widget` from a user with only `widgets:configure` (no `dashboards:edit`) is rejected `stage:"rbac"`, same op accepted for designer (pair proves discrimination); `list_tables` omits a table whose probe throws `KineticaPermissionError`; dashboard not viewable → 404 | unit + route | `npx vitest run tests/lib.aiOpPermissions.spec.ts tests/lib.aiTools.spec.ts` | ❌ |
| AISAFE-03 | Permission re-read per op: revoke role between two tool calls → second rejected | unit | gateway spec | ❌ |
| AIPRV-04 | Claude adapter normalises each fixture to the exact expected `LlmEvent[]` (text, split `partial_json`, parallel, thinking replay round-trip, `error` event, 429, 529); chunk-boundary slicing 1/3/17 bytes yields identical events; request body has no `tool_choice` of type any/tool | unit | `npx vitest run tests/lib.aiClaude.spec.ts` | ❌ |
| AIPRV-04 | Header comment/doc states "not live-verified" | grep (anchor **introduced** by the work, e.g. `NOT live-verified` — verify count 0 first) | `grep -c "NOT live-verified" packages/server/src/lib/ai/providers/claude.ts` | ❌ |
| AIPRV-05 | Sentinel key `sk-test-KEYSENTINEL` set in env; run full loop through every outcome (ok, provider 401, 429-giveup, 500, abort, timeout, step-cap, gateway reject) with `console.log/error/warn/info` spied; assert sentinel in none of: logs, SSE bytes, `/api/ai/config`, `/api/auth/me`, audit rows, thrown error messages. **Positive control:** same harness with a deliberately leaky logger line proves the detector flags the sentinel | route | `npx vitest run tests/routes.aiSecrets.spec.ts` | ❌ |
| AIPRV-05 | No real network: `forbidProviderNetwork()` stubs `fetch` to throw on any non-test host; every AI spec calls it; `tests/setup.ts` blanks all `AI_*` incl. new names; a spec asserts `process.env.AI_API_KEY === ""` at import | unit | `npx vitest run tests/lib.aiConfig.spec.ts tests/lib.aiNoNetwork.spec.ts` | ❌ |
| AIGOV-01 | Catalog/seed/Roles specs updated (table above); `POST /api/ai/ask` 403 `PERMISSION_DENIED` for `dashboards:view`-only user, passes permission stage for designer; `/api/auth/me` lists `ai:use` for designer not analyst; existing-DB upgrade: DB seeded by old catalog (delete the `(designer,ai:use)` history+row) gets it on next `createDb` | unit/route | `npx vitest run tests/lib.permissions.spec.ts tests/db.rbacMigration.spec.ts tests/lib.rbacDb.spec.ts tests/routes.aiAsk.rbac.spec.ts` ; web `npx vitest run src/lib/permissions.spec.ts src/lib/permissionGroups.spec.ts src/components/RolesPage.spec.tsx` | ✅ edit existing / ❌ new |
| AIGOV-02 | **Canary matrix**: `RecordingProvider` records every `OutboundRequest`; Kinetica `fetch` mock returns `CANARY_ROW_VALUE_9f3` in rows, in an error message body, and in table `description`-adjacent fields; snapshot carries it as a filter value and in `customWhere`; scripted provider calls EVERY registered tool (valid, invalid-args, unknown table, 403, 500, session-ended) and the loop also hits provider-error paths; assert `JSON.stringify(recorded)` lacks canary **in every case** and `EgressViolation` is thrown if a `rows`-class part is injected. **Positive controls:** (1) detector run over a raw request containing the canary flags it; (2) a test-registered `leaky_tool` returning `rows`-class text → builder throws, canary not sent | unit + route | `npx vitest run tests/lib.aiEgress.spec.ts` | ❌ |
| AIGOV-02 | Schema mode registers no query tools: registry names ⊆ expected set; with `dataAccess:"query"` + a test-registered `run_query` stub it appears (proves the gate switches) | unit | `npx vitest run tests/lib.aiToolsRegistry.spec.ts` | ❌ |
| AIGOV-02 | Every emitted tool JSON schema is flat (no `$ref/anyOf/oneOf/allOf/additionalProperties/$schema`) | unit | same | ❌ |
| AIGOV-04 | Exactly one `ai_audit` row per answer for each outcome (ok, cancelled via abort, capped step, capped user-hour (counted=0), provider_error, rate_limited); no row contains canary; `tools_json` has names+validated args and rejected calls with reasons; token cols NULL when provider gave none; sweep deletes rows older than retention, keeps newer, `0` keeps all, marks stale `running` as interrupted; sweep works with AI disabled | unit/route | `npx vitest run tests/lib.aiAudit.spec.ts tests/routes.aiAsk.audit.spec.ts` | ❌ |
| AIGOV-06 | Hour cap: 30 counted rows → 31st is refused with exact string and minute math (inject clock: oldest row 48 min old → "Try again in 12 minutes."); cap=0 disables; refusals don't extend window; cap survives re-`createDb`/restart (rows persist); concurrent double-submit at 29/30 admits exactly one; day cap string; step cap: loop with always-tool-calling scripted provider stops at `AI_MAX_TOOL_STEPS`, outcome `capped`, exact string, **no ops** | unit/route | `npx vitest run tests/lib.aiCaps.spec.ts tests/lib.aiAgentLoop.spec.ts` | ❌ |
| AIGOV-06 | 429 retry: header `Retry-After: 2` waits 2 s (injected `sleep`) then succeeds; delay 25 s > budget → no wait, `rate_limited`; cumulative budget across two 429s in one answer; Gemini body `retryDelay:"34s"` parsed; status event emitted; abort during wait stops immediately | unit | `npx vitest run tests/lib.aiRetry.spec.ts` | ❌ |
| (SSE) | Route: headers (`text/event-stream`, `X-Accel-Buffering: no`), heartbeat (inject short interval), client abort → provider signal aborted + audit `cancelled` (real http via `createApp()`+`listen(0)`), session revoked mid-answer → no `result`, error `REAUTH_REQUIRED`, post-flush exception → `error` event not JSON, 400/404/409/429/503 all JSON before headers | route | `npx vitest run tests/routes.aiAsk.sse.spec.ts` | ❌ |
| (Memory) | `buildConversationContext`: last N in full, earlier collapsed deterministically, no AI prose, oversize request → 400 | unit | `npx vitest run tests/lib.aiContext.spec.ts` | ❌ |

### Sampling Rate
- **Per task commit:** the task's own spec file(s) + `npx tsc --noEmit` (server).
- **Per wave merge:** `npx vitest run tests/lib.ai tests/routes.ai tests/lib.permissions.spec.ts tests/db.rbacMigration.spec.ts tests/lib.rbacDb.spec.ts` and web permission specs.
- **Phase gate:** `npm run test:gate` set-based (failing files ⊆ `TD-V16-TEST-ISOLATION` set), web tsc + vitest + theme-guard green.

### Wave 0 Gaps
- [ ] `tests/helpers/aiTestKit.ts` — `forbidProviderNetwork()`, `ScriptedProvider`, `RecordingProvider` builders, `CANARY_ROW_VALUE_9f3`, `KEY_SENTINEL`, console-capture, injected clock/sleep
- [ ] `tests/fixtures/ai/` — OpenAI-compat + Claude SSE/JSON fixtures
- [ ] `tests/setup.ts` — blank every new `AI_*` env name
- [ ] all `tests/lib.ai*.spec.ts` / `tests/routes.aiAsk.*.spec.ts` listed above
- [ ] Framework install: none (vitest/supertest present); `npm install zod-to-json-schema` for the registry

**Criterion hygiene (CLAUDE.md):** before using any grep acceptance criterion, run it and confirm it reads 0/fails now. Safe introduced anchors: `ScriptedProvider`, `EgressViolation`, `CANARY_ROW_VALUE_9f3`, `registerAiRoutes`, `ai_audit`, `AI_USE`, `startAiAuditSweep` (all absent today — confirm at plan time). "Key is not in the browser bundle" and "no `AI_API_KEY` in web" are unprovable by grep (read 0 both ways) → behavioural test + `checkpoint:human-verify`.

## Code Examples

### Cap check + audit insert in one transaction
```typescript
// Source: design; pattern from lib/rbacAudit.ts + better-sqlite3 sync transactions (db.ts)
const admit = db.transaction((u: string, now: number, cap: number, dayCap: number) => {
  if (cap > 0) {
    const rows = db.prepare("SELECT ts_ms FROM ai_audit WHERE username=? AND counted=1 AND ts_ms>? ORDER BY ts_ms ASC")
      .all(u, now - 3_600_000) as { ts_ms: number }[];
    if (rows.length >= cap) {
      const waitMs = rows[rows.length - cap].ts_ms + 3_600_000 - now;
      return { ok: false as const, code: "AI_USER_CAP", minutes: Math.max(1, Math.ceil(waitMs / 60_000)) };
    }
  }
  if (dayCap > 0) {
    const n = (db.prepare("SELECT COUNT(*) c FROM ai_audit WHERE counted=1 AND ts_ms>?").get(now - 86_400_000) as {c:number}).c;
    if (n >= dayCap) return { ok: false as const, code: "AI_DAY_CAP" };
  }
  const id = db.prepare("INSERT INTO ai_audit (ts_ms, username, ...) VALUES (?, ?, ...)").run(now, u /* ... */).lastInsertRowid;
  return { ok: true as const, id: Number(id) };
});
```

### Per-op session + permission re-check
```typescript
// Source: lib/exportRunner.ts:158 (principalForSession), lib/rbacDb getEffectivePermissions
const principal = principalForSession(sid);                 // throws SessionEndedError
const perms = getEffectivePermissions(principal.user!.creds.username);
```

### Provider call with retry budget (injected clock)
```typescript
async function* callWithRetry(provider, req, signal, deps: { sleep, now, onWait }) {
  let spent = 0;
  for (let attempt = 0; ; attempt++) {
    const evs: LlmEvent[] = []; let err: Extract<LlmEvent,{type:"error"}> | undefined;
    for await (const e of provider.complete(req, signal)) { if (e.type === "error") err = e; else evs.push(e); }
    if (!err) { yield* evs; return; }
    const wait = err.kind === "rate_limited" ? (err.retryAfterMs ?? 2000 * 2 ** attempt) : err.kind === "overloaded" && attempt === 0 ? 1500 : null;
    if (wait === null || spent + wait > 20_000 || attempt >= 3) { yield err; return; }
    deps.onWait(Math.ceil(wait / 1000)); await deps.sleep(wait, signal); spent += wait;
  }
}
```
(Do not retry after any `text_delta`/`tool_call` has been consumed from a failed stream — buffer per attempt as above; a mid-stream failure restarts the step.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Gemini compat: plain tool calls | Gemini 3 requires `thought_signature` echo in OpenAI-compat tool calls | Gemini 3 (late 2025+) | Adapter must round-trip `extra_content` |
| Claude: `thinking.type:"enabled"` budget | Adaptive thinking default; Sonnet 5.5 rejects `disabled`, rejects forced tool_choice; thinking blocks must be replayed | 2026 (Claude 4.7+/5.x) | Claude adapter keeps raw content, never forces tools |
| Gemini free tier: generous Flash+Pro | Flash-class only, low RPM/RPD, project-specific limits | Apr 2026 (reports) | 429s frequent; caps + retry budget matter |
| `openai` Chat Completions as the only tool API | OpenAI pushes Responses API (newest models require it) | 2026 | We stay on Chat Completions because Gemini/Ollama/vLLM expose it; note for future providers |
| `EventSource` for streaming | POST + fetch stream with SSE framing | n/a | Decided in S2 |

**Deprecated/outdated in this repo's research docs:** STACK.md §1 recommends `@anthropic-ai/sdk` (reversed by operator); ARCHITECTURE.md Q2 shows per-op streaming `op` events (superseded: ops emitted once at end per D-14/SUMMARY §8); STACK.md names `src/ai/` (use `lib/ai/`).

## Open Questions

1. **Does `LIMIT 0` return `column_datatypes` as well as `column_headers`?**
   - Known: S1.5a measured `column_headers` for `SELECT * FROM <view> LIMIT 0`; INFORMATION_SCHEMA.COLUMNS returns `column_datatypes`.
   - Unclear: whether the `LIMIT 0` encoded response carries datatypes.
   - Recommendation: take types from the registry snapshot (`tables.columns`), names/existence from the probe; if a recorded fixture shows datatypes, upgrade later.
2. **Does Kinetica's `INFORMATION_SCHEMA.TABLES` filter by the caller's privileges?** (Would replace N probes with one query for `list_tables`.) Unverified → plan uses probes (cap 50, cached); optional later optimisation, needs an operator-run check like S7.
3. **Analyst with `ai:use` and structural asks** — research assumes gateway rejection with a plain message (success criterion 1). Confirm wording with operator during planning; no code impact beyond the message string.
4. **Gemini `parallel_tool_calls`/`response_format`/`tool_choice` acceptance** — docs say unsupported params are silently ignored; S6 confirms before the adapter sends them.
5. **Query-mode audit (Phase 140):** D-09 stores the AI's full answer text, which in query mode could echo row values. Not a 135 problem (schema mode) but 140 must decide (e.g. don't store `answer_text` in query mode). Flag in 140's context.
6. **Does Gemini's compat endpoint stream tool calls fragmented or whole, and does it still omit `index`?** — S6 (record fixtures).
7. **History "in full" wording (D-05 vs D-06)** — research assumes question + change log, no AI prose; operator may confirm at planning.

## Suggested plan decomposition (for the planner; not binding)
1. **RBAC `ai:use` ripple** (single plan owns all edits in the table above) — independent, Wave 1.
2. **Contract & config:** `shared/aiAsk.ts`, `aiConfig` extensions (caps/history), `tests/setup.ts` blanks, `aiTestKit`, fixtures dir.
3. **Provider layer:** `provider.ts`, `outbound.ts`, `sse.ts`, `retry.ts`, openaiCompat + claude adapters + fixtures + jsonAction decorator + scripted/recording.
4. **Audit/caps/sweep:** `ai_audit` DDL, `aiAudit.ts`, sweep + `startAiAuditSweep` wiring (respect bootstrap regex).
5. **Tools + gateway + live schema + context:** registry (flat schemas), read tools, mutate stubs, `opPermissions`, `liveSchema`, `context.ts`.
6. **Agent loop + route:** `agentLoop.ts`, `aiRoutes.ts` (`/api/ai/ask`, `/api/ai/config`), `index.ts` wiring, SSE specs.
7. **Egress/secrets proofs + S6 spike script + operator checkpoint + docs** (tested-models matrix, Claude "not live-verified" note). **Only one plan edits ROADMAP/STATE/REQUIREMENTS** (memory: parallel executors clobber shared docs; do bookkeeping by hand, not gsd-tools mutation).

## Sources

### Primary (HIGH confidence)
- Repo (read directly, file:line cited above): `packages/server/src/{index.ts,rbac.ts,kinetica.ts,auth.ts,db.ts}`, `lib/{aiConfig,aiContract,permissions,rbacSeed,rbacAudit,exportCleanup,exportRunner,viewColumns,columnGuard,dashboardAccessDb}.ts`, `spikes/sseSpike.ts`, `tests/{setup.ts,bootstrap.spec.ts,helpers/*}`, `packages/shared/src/{aiOp,actionAllowList,widgetAction,index}.ts`, web `lib/permission*.ts` + specs; `.planning/{research/*,phases/133-*/133-SPIKES.md,phases/134-*}`; git `f24f6ad/2d2012a/8a6c4f2` (Phase 81 ripple precedent)
- https://platform.claude.com/docs/en/build-with-claude/streaming — event flow, `input_json_delta`, tool_use SSE example, error event
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls — `tool_result` format/ordering, `is_error`
- https://platform.claude.com/docs/en/api/errors — HTTP codes, error body shape, `request-id`, 429 spend-cap has no `retry-after`, thinking-block replay, forced-tool_choice rejection, Sonnet 5.5 thinking rules
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use — `disable_parallel_tool_use` inside `tool_choice`
- https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons — stop_reason values
- npm registry 2026-10-12: `zod-to-json-schema` 3.25.2 (peer `zod ^3.25.28 || ^4`); installed `zod` 3.25.76

### Secondary (MEDIUM confidence)
- https://ai.google.dev/gemini-api/docs/openai — base URL, `tools`, `tool_choice:"auto"`, `stream_options.include_usage`, unsupported params silently ignored, thought signatures via `extra_body`
- https://ai.google.dev/gemini-api/docs/function-calling — restricted JSON-schema subset (no `$ref`, `additionalProperties`, `anyOf`/`oneOf`)
- https://discuss.ai.google.dev/t/openai-api-compatibility-broken-due-to-thought-signature-on-gemini-3-pro-preview/109823 — 400 text, `extra_content.google.thought_signature` echo
- https://discuss.ai.google.dev/t/gemini-openai-compatibility-issue-with-tool-call-streaming/59886 — missing streaming `index` (unresolved as of Nov 2025)
- https://docs.ollama.com/api/openai-compatibility — tools + streaming supported, `tool_choice` unsupported, key ignored locally

### Tertiary (LOW confidence — validate in S6)
- Gemini 429 shape (`retryDelay` in `RetryInfo` details, message "retry in Ns", `Retry-After` often absent) — forum/search results (discuss.ai.google.dev threads 114413/96899); array-wrapped compat errors (training knowledge)
- Gemini free-tier numbers and current model names (aggregator blogs conflict; AI Studio is authoritative)
- Ollama streaming tool-call delivery, missing `finish_reason`, silent ignore of `anyOf`/`$ref` (aggregator sites)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — constraints from repo + operator; one verified new dep
- Architecture/gateway/audit/caps/RBAC ripple: HIGH — built on read code with file:line; decisions follow locked D-01..D-15
- Claude adapter wire format: HIGH (official docs 2026-10) but unverifiable live
- Gemini/Ollama OpenAI-compat behaviour: MEDIUM/LOW — S6 resolves
- Pitfalls: MEDIUM-HIGH

**Research date:** 2026-10-12
**Valid until:** 2026-10-26 for provider specifics (fast-moving: model names, free-tier limits, compat quirks); repo findings valid until the next merge touching `index.ts`/`permissions.ts`.
