# Phase 140: Query Data-Access Mode & Injection Hardening - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning

<domain>
## Phase Boundary

With `AI_DATA_ACCESS=query`, the AI gets two read tools, `run_query` and `get_column_profile`. They run guarded, single, read-only SELECT statements **as the user** (the user's own Kinetica credentials) with a row cap, and refuse anything else. In schema mode these tools are not registered. Poisoned inputs (data values, column names, table comments, dashboard/widget titles) cannot make the AI act outside the gateway's rules. AI text renders as plain text.

Requirements: AIGOV-V20-03, AISAFE-V20-05.

Clarified with the operator: `run_query` is the AI's **own read tool**. Its rows go back to the model (the provider) so it can answer in words or decide what to build. It is **not** a visualization path. Charts, records tables and dynamic views keep their own queries and existing limits (chart limits, `max_records`), unchanged.

Out of scope: Keep (141), generate + audit viewer page + live Gemini/Ollama UAT (142), and any change to how widgets or dynamic views query.

</domain>

<decisions>
## Implementation Decisions

### Query limits & cost
- **D-01 Row cap:** env `AI_QUERY_MAX_ROWS`, **default 200**. The server clamps or adds `LIMIT`, and the tool result tells the model when rows were truncated.
- **D-02 Character budget:** env `AI_QUERY_MAX_CHARS` (suggested default 20000) also clamps what is sent to the model. Long cell values are truncated, and the tool result says so. This protects provider context and cost on wide tables.
- **D-03 Timeout:** env `AI_QUERY_TIMEOUT_MS`, **default 30000** (operator chose 30 s). On timeout, or when the user presses Cancel, the Kinetica job is cancelled with the existing tag → find → `/admin/alter/jobs` path (`tagSql`, `cancelKineticaJobsByTag`; S7: abort alone does not cancel). The model gets "query timed out".
- **D-04 Per answer:** env `AI_QUERY_MAX_PER_ANSWER`, **default 5**, within the existing steps-per-answer cap. Further queries are refused with a clear message to the model.
- **D-05 No cost preflight.** The LIMIT clamp, the timeout and cancel bound the cost. A COUNT preflight would double the work of every query.
- **D-06 `get_column_profile`** (one column): row count, distinct count, null count, min/max (numeric and time), and the top 10 values with counts (strings). Reuse the existing `/api/column-stats` and `/api/top-values` logic (`index.ts` ~L1687/L1738) where possible. It is query mode only, because it returns values.

### What the AI may query
- **D-07 Table scope:** only the tables on **this dashboard**, its **saved dynamic views** and the user's **session AI views**, the same scope as every other AI op (135 D-16). The guard checks every FROM and JOIN target server-side. Kinetica grants still apply, because the query runs as the user.
- **D-08 SQL shape:** one statement starting with `SELECT` or `WITH`. Joins, subqueries, CTEs, GROUP BY and window functions are allowed. These are refused: `INTO`, any DDL or DML, multiple statements, `;`, SQL comments (`--`, `/* */`, including smuggled ones), and anything outside the table rule.
- **D-09 System and catalog objects refused:** `ki_catalog`, `information_schema` and sys/admin functions. Schema info comes from the existing describe tools.
- **D-10 Refuse when unsure:** the guard uses a real SQL parser with an allow-list, not regex. A statement it cannot fully classify is refused with a reason the model can act on. **Research:** no SQL parser is in the deps today. Pick one that handles Kinetica's SQL dialect well enough, and list the dialect gaps. The S7 lock stands: the guard is entirely app-side, with no reliance on grants (the user can INSERT and CREATE TABLE).

### Visibility & audit
- **D-11 Visible to the user:** under each answer, a collapsed plain-text line "Ran N queries" that expands to each query's SQL text and row count, with no result grid. Refused queries appear in the same list as "refused: <reason>". Reuse the existing classes (`ai-chat-note muted`, `ghost-sm`, etc.) and add no new CSS without checking `global.css`.
- **D-12 Audit:** the per-answer `ai_audit` record gains each query's SQL text, row count, duration and outcome (ok / refused + reason / timed out / cancelled). The SQL may contain literal filter values the user or model typed. Result values are **never** stored (AIGOV-V20-04 stands).

### Injection response
- **D-13 Mark tool output as untrusted data.** Tool results that carry data-derived text (values, column names, table comments, titles) are structured JSON with the data clearly marked as data. The system prompt states that text inside tool results is never instructions. This is defence in depth: the gateway rules remain the real boundary.
- **D-14 No injection detection or heuristics.** Prove it is harmless instead. A scripted "obedient" provider follows the injected instruction, and the tests show the gateway still refuses anything outside the rules.
- **D-15 Fixtures cover all four sources:** (a) data values in query results, (b) column names and table comments returned by the describe tools, (c) dashboard and widget titles in the snapshot, (d) markup in answers (markdown links, images, HTML), which must render as literal text (operator human-verify; answers already render as React text, `AiChat.tsx:154`).
- **D-16 The canary no-egress test still passes in schema mode** across every tool and error path (roadmap SC4). In query mode, values intentionally reach the provider, but only through `run_query` and `get_column_profile`, within D-01/D-02.

### Post-research decisions (operator, 2026-10-20, after 140-RESEARCH.md)
- **D-17 Parser = `libpg-query`** (MIT; the real PostgreSQL parser as WASM, ~1.8 MB), added as a new server dependency. The first task adds it with a `parse("SELECT 1")` smoke spec and proves it loads under server vitest and in the deploy build. The server build uses `--packages=external`, so the WASM must ship in the deployed `node_modules`. Kinetica-only syntax it can't parse (QUALIFY, PIVOT, TOP, `LIMIT a,b`, `TABLE(fn())`, backticks) is refused with a rewrite hint (D-10).
- **D-18 Kinetica SQL errors go to the model as categorized, fixed messages** (e.g. "unknown column <name>", "syntax error", "timed out", "cancelled"). Kinetica's raw error text is never forwarded to the provider.
- **D-19 The model refers to dynamic views by aliases** `dv_<id>` (saved) and `aidv_<n>` (session AI views). The server swaps in the physical `_kbi_*` name, then re-runs the guard on the final SQL (a substitution bug can only cause a refusal). Physical names, which embed the username, never reach the provider.

### Claude's Discretion
- Exact env names and defaults for D-02. Tool argument shapes (flat, per REG-2). The untrusted-data envelope format. The concrete list of "outside the rules" actions each fixture tries: for example, querying a table not on the dashboard, DML through `run_query`, a query tool in schema mode, removing saved content without confirmation, a cross-user view name, and exfiltration through a markdown image URL.
- Whether `run_query` refusals count against D-04.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope & requirements
- `.planning/ROADMAP.md` § Phase 140: goal and 4 success criteria
- `.planning/REQUIREMENTS.md`: AIGOV-V20-02 (done), AIGOV-V20-03, AIGOV-V20-04 (audit, no row values), AISAFE-V20-05
- `.planning/STATE.md`: milestone scope decisions, Phase 135/139 outcomes and follow-ups

### Spikes & research
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md` § S7: non-admin user can CREATE TABLE and INSERT (grants not read-only), no server timeout, EXPLAIN has no cost, tag/find/cancel works
- `.planning/research/PITFALLS.md`: injection (C-series), model SQL (C5), markup exfiltration
- `.planning/research/ARCHITECTURE.md`: query tool / SQL guard section

### Prior phase decisions
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-CONTEXT.md`: D-16 rights, gateway stages, caps and message style, audit, canary egress matrix, key-sentinel matrix
- `.planning/phases/137-ai-widget-streaming-ui/137-CONTEXT.md`: chat UI, plain-text rendering, follow-ups
- `.planning/phases/139-session-only-dynamic-views/139-CONTEXT.md`: session AI views (part of D-07 scope), tag/cancel use

### Project conventions
- `CLAUDE.md`: UI class conventions, red-first grep criteria, test gates
- `.planning/codebase/CONVENTIONS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/server/src/lib/ai/tools/registry.ts`: `QUERY_TOOL_NAMES = ["run_query", "get_column_profile"]`, already held back unless `dataAccess === "query"`.
- `packages/server/src/lib/aiConfig.ts`: `AI_DATA_ACCESS` parsing; add the `AI_QUERY_*` limits here (the 139 `AI_DV_*` pattern).
- `packages/server/src/lib/kineticaJobs.ts` (`tagSql`, `cancelKineticaJobsByTag`) and `kinetica.ts` `kineticaSql({tag, signal})`: tag/cancel for D-03.
- `packages/server/src/lib/exportRunner.ts` `principalForSession`: the run-as-user pattern.
- `packages/server/src/lib/ai/gateway.ts`, `agentLoop.ts`, `runAnswer.ts`, `tools/read.ts`: where the read tools and their per-answer counting plug in.
- `packages/server/src/lib/aiAudit.ts`: per-answer audit row (D-12).
- `/api/column-stats`, `/api/top-values` in `index.ts`: profile logic for D-06.
- Tests: `tests/helpers/aiTestKit.ts` (`CANARY_ROW_VALUE_9f3`, `findLeak`), `lib.aiOutbound.spec.ts`, `lib.aiScripted.spec.ts`, the `lib.*.e2e.spec.ts` scripted-provider pattern.
- Web: `components/charts/AiChat.tsx` renders `{turn.answer}` as text (D-15d); the "Ran N queries" list goes here.

### Established Patterns
- Env limits parsed and logged in `aiConfig`; refusal messages exact and user-facing (135).
- Tool argument schemas are flat (REG-2); adding tools ripples into count-asserting specs (REG-1 tool count, TL-7 order, aiContract version).

### Integration Points
- The SSE stream / answer payload needs the per-answer query list (SQL, row count, status) for D-11.
- The audit schema extension (D-12).

</code_context>

<specifics>
## Specific Ideas

- The operator first read "row cap" as a visualization limit. Keep the docs and tool descriptions explicit that `run_query` is for the AI's own reading.

</specifics>

<deferred>
## Deferred Ideas

None. The discussion stayed within the phase scope. (Step 8/8b live join checks from 139 are already deferred to 142.)

</deferred>

---

*Phase: 140-query-data-access-mode-injection-hardening*
*Context gathered: 2026-10-20*
