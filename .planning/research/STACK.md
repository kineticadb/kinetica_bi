# Technology Stack: v2.0 AI-Driven Dashboards (additions only)

**Project:** Kinetica BI
**Researched:** 2026-10-08
**Scope:** NEW capabilities only (LLM provider layer, tool calling, browser streaming, tool schemas, MCP decision, SQL-GPT). Existing stack is not re-researched.

## Verdict (one paragraph)

Build a **thin in-repo provider adapter** (`packages/server/src/ai/`) with a small `LlmProvider` interface and **two implementations**: Claude via the official `@anthropic-ai/sdk` (the only new runtime dependency on the server) and an OpenAI-compatible provider written against plain `fetch` (zero deps) for vLLM/Ollama/LM Studio/Azure-style endpoints. Do NOT add the Vercel AI SDK, the `openai` npm package, or MCP. Stream to the browser with **POST + fetch ReadableStream carrying SSE-framed events** (hand-written, about 60 lines, no library). Add `zod` to the server (same `^3.25.76` the web already uses) and reuse the existing `WidgetActionSchema`. Kinetica SQL-GPT is NOT a provider; at most an optional, deferred "generate_sql" tool.

## Recommended Stack

### New server dependencies

| Technology | Version (verified npm 2026-10-08) | Purpose | Why |
|------------|-----------------------------------|---------|-----|
| `@anthropic-ai/sdk` | `^0.132.1` | Claude provider: `messages.stream()`, tool use, retries, `baseURL` override, Bedrock/Vertex variants | Official; Node 20+ OK (matches current `node:20-alpine` Dockerfile); only 2 deps (`standardwebhooks`, `json-schema-to-ts`); handles Anthropic's event-stream parsing, 429/529 retries and typed tool_use blocks that are tedious to hand-roll. Pre-1.0 semver: pin with `~0.132.1` or exact and bump deliberately. HIGH (README + npm) |
| `zod` (server) | `^3.25.76` (same range as web) | Validate tool inputs and request bodies on the server; single source of truth shared with web | Already a project dependency in web; avoids a second version. `zod@3.25.x` also ships `zod/v4` subpath if ever needed. HIGH |
| `zod-to-json-schema` | `^3.25.2` | Convert the zod tool schemas (including existing v3 `WidgetActionSchema`) to JSON Schema for both Anthropic `input_schema` and OpenAI `parameters` | Peer-supports zod `^3.25.28 \|\| ^4`; tiny, pure function. Alternative with zero extra deps: author the NEW tool schemas with `import { z } from "zod/v4"` and use native `z.toJSONSchema` — but the existing v3 `WidgetActionSchema` could then not be reused directly. Recommendation: take the one small dep to reuse the seam schema unchanged. MEDIUM (API stability of v3 converter is known; version from npm) |

### New in-repo modules (no deps)

| Module | Purpose |
|--------|---------|
| `ai/provider.ts` | `LlmProvider` interface: `stream({system, messages, tools, signal}) -> AsyncIterable<{text-delta \| tool_call \| done \| error}>`. Normalised internal message/tool format (provider-neutral). |
| `ai/providers/anthropic.ts` | Wraps `@anthropic-ai/sdk`. Default model `claude-sonnet-5-5`; optional cheaper model (`claude-haiku-4-5-20251001`) for follow-up-question generation. |
| `ai/providers/openaiCompat.ts` | `fetch` to `${AI_BASE_URL}/chat/completions` with `stream: true`, `tools`, `tool_choice: "auto"`; parse SSE `data:` lines and accumulate `delta.tool_calls[].function.arguments` fragments by index. About 120 lines. |
| `ai/tools/registry.ts` | Tool name -> `{description, zodSchema, kind: "read"\|"propose", handler}`; derives JSON Schema once. |
| `ai/sse.ts` + web `lib/readSse.ts` | SSE writer (server) / fetch-stream reader (web). |

### Environment configuration (follows env-var-over-settings-store preference)

Read in the existing dotenv flow (`env.ts` loads `.env`; read `process.env` lazily/at import like other modules):

| Var | Meaning |
|-----|---------|
| `AI_ENABLED` | feature switch (default off; widget hidden / disabled when off) |
| `AI_PROVIDER` | `anthropic` (default) or `openai-compatible` |
| `AI_API_KEY` | key (Anthropic key, or bearer for compat endpoint; optional for local) |
| `AI_BASE_URL` | override; required for `openai-compatible` (e.g. `http://vllm:8000/v1`, `http://ollama:11434/v1`); also supports corporate proxy for Anthropic |
| `AI_MODEL` | model id (default `claude-sonnet-5-5` for anthropic; required for compat) |
| `AI_DATA_ACCESS` | `schema` (schema + dashboard config only; default, safest) or `query` (read-only SQL results executed as the user via their session creds) |
| `AI_MAX_TOOL_STEPS`, `AI_TIMEOUT_MS` | loop/cost guards |

Fail fast with a clear message at startup if `AI_ENABLED=true` and the provider is misconfigured.

### Browser side

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (none new) | - | fetch + `ReadableStream` + `TextDecoder`, zustand store for the per-user AI session layer | Reuses existing `applyWidgetAction` + overlay store; zod already in web |

## Key design decisions with rationale

### 1. Thin adapter vs Vercel AI SDK vs `openai` package

- **Vercel AI SDK 7** (`ai@7.0.136`, `@ai-sdk/anthropic@4.0.78`, `@ai-sdk/openai-compatible@3.0.67`) **requires Node >=22 and ESM** (verified in npm `engines`; AI SDK 7 release notes). The repo's Dockerfile is `node:20-alpine` x3. Adopting it forces a Node/runtime bump on every deployment, including on-prem customers. It also brings 3 packages plus transitive deps, and its headline v7 features (durable agents, tool approvals, voice, telemetry) are unneeded: our approval model is "apply + undo + Keep", our agent loop is a handful of steps. Rejected.
- **`openai` npm package 7.30.1** also declares `node >=22` and is 21 MB unpacked, with optional peers on ws/undici/AWS smithy. Overkill for one POST endpoint. Rejected; plain `fetch` (Node 20 built in) against `/v1/chat/completions` is sufficient.
- **Honest cost of thin adapter:** two wire formats to maintain (Anthropic content blocks vs OpenAI `tool_calls`), plus tool-result message shaping differences. This is real but bounded (~300 lines total + tests with recorded fixtures) and fully under our control — consistent with the v1.26 hand-written ZIP64 precedent. It also guarantees every provider produces the identical internal event stream, so the agent loop, validation and tests are provider-agnostic.
- Why keep the Anthropic SDK rather than raw fetch for Claude too: Anthropic's streaming event protocol (content_block_start/delta/stop, input_json_delta, pings, overloaded errors) plus retry/backoff is where hand-rolling bugs live; the SDK is first-party, Node-20-compatible, and light. If the operator wants zero deps, raw `fetch` to `/v1/messages` is feasible (MEDIUM effort), but not recommended.
- Do not use SDK `toolRunner`/`betaZodTool` helpers: they bind loop control to one provider. Run our own loop (needed anyway because "propose" tools return to the browser, not to the model).

### 2. Agent loop shape (affects stack, not just code)

The per-user overlay lives in the **browser** (`widgetActionStore`). So:
- **Read tools** (list tables, describe table, get dashboard config, and, only if `AI_DATA_ACCESS=query`, run read-only SQL as the user) execute **on the server** and return results to the model.
- **Mutating tools** (add/remove widget, add/remove layer, add/remove dynamic view, apply filter, patch config) are **proposals**: server validates the zod shape (and the allow-list where applicable), streams them to the browser as `action` events, the browser applies them to the overlay (with undo), and the server feeds back a synthetic `"applied"` / `"rejected: reason"` tool result so the model can continue. Server must never write the dashboard DB from an AI turn; "Keep" uses the existing, RBAC-checked save routes.
- Keep the tool set small (~8-10 tools): this is what makes small local models viable.

### 3. Streaming to the browser: POST + fetch stream with SSE framing

- Native `EventSource` is GET-only and cannot send a JSON body or custom headers; the ask payload (question, dashboard id, current overlay state) needs POST. Use `fetch(POST)` + `response.body.getReader()` + `TextDecoder`, parse `event:`/`data:` frames (about 40 lines). No `@microsoft/fetch-event-source` or similar dependency.
- Express 4 specifics (verified in repo: `express.json({limit:"1mb"})`, no compression middleware found in `index.ts`): set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`, call `res.flushHeaders()`, write `event: x\ndata: {json}\n\n`, heartbeat comment every ~15 s (proxies/idle timeouts), and wire an `AbortController` to `req.on("close")` so a closed tab cancels the provider call (cost + local GPU). If a reverse proxy/compression is added later it must not buffer this route. The 1 MB JSON limit is fine; do not send the whole dashboard — send ids and let a read tool fetch config.
- Auth: existing cookie session works with same-origin fetch; the route sits under `requireAuth` and per-user Kinetica credentials come from the session (needed for `AI_DATA_ACCESS=query`). Add an AI-specific RBAC permission (note memory: permission additions ripple across rbacDb/rbacMigration/permissions/RolesPage specs).
- Event vocabulary: `text` (explanation), `action` (validated proposal), `followups`, `status` (tool running), `error`, `done`.

### 4. Schema-validated tools: reuse zod

- `WidgetActionSchema` (target kind + configPatch) is already the seam; use it directly as the `patch_config` tool schema, converted via `zod-to-json-schema`, and keep `validateActionPatch` (allow-list, `ALLOW_LIST_VERSION`) as the binding gate on BOTH server (early reject so the model self-corrects) and web (authoritative at apply time).
- New actions (add/remove widget/layer/dynamic view, apply filter) need new zod schemas, plus an allow-list extension and an `ALLOW_LIST_VERSION` bump to `v3` (per seam doc section 7).
- Cross-package sharing: web and server have no shared package, and importing `../../web/src/lib/*` from server breaks `tsc` rootDir/ESM boundaries. Extract `widgetAction.ts` and `actionAllowList.ts` (and new tool schemas) into a small `packages/shared` workspace (the seam doc already anticipates this). No new third-party dependency; this is a structural change roadmap should schedule early.
- Always re-validate model output with `safeParse`; on failure return the zod error text as the tool result and let the model retry once (essential for local models).

### 5. On-prem / air-gapped path

- `AI_PROVIDER=openai-compatible` + `AI_BASE_URL` covers vLLM, Ollama, LM Studio, llama.cpp server, LiteLLM, and Azure/other gateways with no code change. Both Ollama (`/v1/chat/completions`) and vLLM expose OpenAI-style tool calling and streaming; vLLM needs server flags `--enable-auto-tool-choice --tool-call-parser <parser>` matching the model family (customer-side deployment note, MEDIUM — from training knowledge, validate in a spike with the target model).
- Tool-call reliability varies strongly by model; document a recommended minimum (tool-calling-capable instruct models) and keep a fallback: if the model returns JSON in text, a tolerant extractor + zod validate. Do not rely on `response_format: json_schema` being supported everywhere.
- No outbound calls other than `AI_BASE_URL`. The Anthropic SDK also supports `baseURL` for a corporate proxy and has Bedrock/Vertex variants if a customer wants Claude through their cloud account (separate package; add only on demand).
- Never send data to the provider beyond what `AI_DATA_ACCESS` permits; log tool calls (names + sizes, not row contents) for audit.

### 6. MCP: not the right mechanism for the in-app agent

- MCP is a protocol for exposing tools to external hosts. For an in-app agent the model, tools and executor are in one process; MCP would add JSON-RPC transport, session management, a second auth model (the user's Kinetica creds live in the encrypted cookie session), and the `@modelcontextprotocol/sdk` dependency (latest 1.32.1; the seam doc cited 1.29.0, now stale) with no benefit. Our mutating tools also execute in the browser overlay, which an MCP server cannot reach.
- The seam doc's MCP design was for an external agent persisting via PATCH routes. Keep that as a possible FUTURE milestone; because tools are defined once as `{name, zodSchema, handler}` in the registry, an MCP facade can later be generated from the registry cheaply. Do not add the SDK now.
- Kinetica already ships its own MCP server (`kineticadb/mcp-kinetica`: list_tables, describe_table, query_sql, get_records, generate_sql...) — a reference for tool naming/coverage, not a dependency.

### 7. Kinetica SQL-GPT

Findings (docs.kinetica.com 7.2 sql-gpt pages; MEDIUM-HIGH):
- Invoked as SQL: `GENERATE SQL FOR '<question>' WITH OPTIONS (context_name='[schema.]ctx' [, context_names, ai_api_provider, ai_api_url, use_rag])`; also `EXECUTE_AI_QUERY` for generate+execute. Reachable from the server through the existing SQL execution path (REST `/execute/sql`) as the user — no new client library.
- Requires admin-created **context objects** (tables, rules, few-shot samples) and SQL-GPT context GRANTs; context must fit the LLM window (docs imply ~5 tables per context unless `use_rag`).
- Default provider `sqlgpt` is an external OpenAI-based service (sqlgpt.io) — unacceptable for air-gapped; **SqlAssist** is Kinetica's local LLM that runs on-prem. `ai_api_url` can point to a custom endpoint.
- It is **single-shot NL to SQL**: no tool calling, no structured dashboard actions, no streaming, no conversation. Result column shape was not confirmed in the docs I could fetch (GAP).

Conclusion: **cannot sit behind the LlmProvider abstraction** (it does not produce tool calls). It is usable only as an optional *tool* (`generate_sql`) the main LLM can call when a customer has contexts configured, gated by env (`AI_SQLGPT_CONTEXT=schema.ctx`) and by `AI_DATA_ACCESS`. Recommend **deferring** to a later phase/milestone: the main LLM can write SQL itself from `describe_table` schemas, and dashboard SQL here is almost entirely aggregations the chart configs already express, so the value is small versus its setup burden. If built, run a spike first to confirm return shape and SqlAssist behaviour.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Provider layer | In-repo adapter | Vercel AI SDK 7 | Node >=22 vs repo's Node 20 images; 3+ packages; unneeded durability/approval features |
| OpenAI-compatible client | raw `fetch` | `openai` 7.30.1 | Node >=22, 21 MB, optional peers; one endpoint only |
| Claude client | `@anthropic-ai/sdk` | raw `fetch` | Reasonable zero-dep option; rejected only because streaming/retry edge cases are costly; revisit if operator insists |
| Browser stream | fetch stream + SSE frames | `EventSource`, WebSocket | EventSource: GET only; WS: new server infra and auth path |
| Tool agent protocol | In-process registry | MCP SDK | Overkill; no browser-overlay reach; extra auth model |
| JSON Schema | `zod-to-json-schema` | hand-written JSON Schema | Drift risk from the allow-list/zod source of truth |
| Text-to-SQL | main LLM + describe tools | Kinetica SQL-GPT as provider | Single-shot, no tool calls, contexts needed, default is external service |

## Installation

```bash
# server
cd packages/server && npm install @anthropic-ai/sdk@~0.132.1 zod@^3.25.76 zod-to-json-schema@^3.25.2

# web: nothing new
```

No Dockerfile change needed (Node 20 compatible). If the roadmap later decides to move to Node 22 (Node 20 is EOL as of 2026), the adapter layer still stands; revisit Vercel AI SDK only then, and still probably not.

## What NOT to add

`ai` / `@ai-sdk/*`, `openai`, `langchain`/`langgraph`, `@modelcontextprotocol/sdk`, `eventsource`/`fetch-event-source`, `socket.io`/`ws`, any vector DB, `@anthropic-ai/bedrock-sdk`/`vertex-sdk` (only on customer demand).

## Confidence

| Item | Level | Notes |
|------|-------|-------|
| Package versions and Node engines | HIGH | `npm view` on 2026-10-08 |
| Anthropic SDK capabilities | HIGH | official GitHub README |
| AI SDK 7 Node >=22 / ESM | HIGH | npm engines + release summary |
| Streaming/Express design | MEDIUM | standard practice; verify behind the customers' reverse proxies |
| vLLM/Ollama tool-calling specifics | MEDIUM | training knowledge, not re-verified; needs spike with target model |
| SQL-GPT result shape/permissions | LOW-MEDIUM | docs excerpt incomplete |

## Sources

- npm registry (`npm view`): @anthropic-ai/sdk 0.132.1, openai 7.30.1, ai 7.0.136, @ai-sdk/anthropic 4.0.78, @ai-sdk/openai-compatible 3.0.67, @modelcontextprotocol/sdk 1.32.1, zod-to-json-schema 3.25.2
- https://github.com/anthropics/anthropic-sdk-typescript
- https://newreleases.io/project/github/vercel/ai/release/ai@7.0.0
- https://docs.kinetica.com/7.2/sql/sqlgpt/ and https://docs.kinetica.com/7.2/sql-gpt/concepts
- https://glama.ai/mcp/servers/kineticadb/mcp-kinetica
- Repo: `Dockerfile` (node:20-alpine), `packages/web/docs/mcp-action-seam.md`, `packages/server/src/index.ts`
