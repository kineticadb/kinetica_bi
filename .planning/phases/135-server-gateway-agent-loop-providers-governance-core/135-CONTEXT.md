# Phase 135: Server Gateway, Agent Loop, Providers & Governance Core - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning (research-phase flagged: S6 tool calling on Gemini / a local model)

<domain>
## Phase Boundary

Server-side AI core, no UI:
- the **agent loop** behind **one validation gateway** (shape → allow-list → the user's permissions → live schema) — a failing change is rejected and never reaches the browser (AISAFE-V20-02); the AI never exceeds the asking user's rights (AISAFE-V20-03);
- **providers**: in-repo OpenAI-compatible adapter (live-proven on Gemini in 142) and a `fetch`-based Claude adapter, unit-tested against recorded fixtures, documented as not live-verified (AIPRV-V20-04); the key never reaches the browser or logs; tests never call a real provider or read the dev key (AIPRV-V20-05);
- **governance core**: the "Use AI" permission (AIGOV-V20-01), schema-only data access by default with a planted-canary egress proof (AIGOV-V20-02), audit records (AIGOV-V20-04), env usage caps (AIGOV-V20-06).

Out of scope here: the chat UI / drawer / revert buttons (137), real structural ops + placement (136), filters (138), dynamic views (139), the query tool + SQL guard + injection fixtures (140), Keep (141), audit viewer page (142).

</domain>

<decisions>
## Implementation Decisions

### "Use AI" permission (AIGOV-V20-01)
- **D-01** **One permission: `ai:use`** (asking the AI). Adding an AI widget to a dashboard additionally requires the existing edit/widget permissions (`dashboards:edit` / `widgets:configure`) — no separate "manage AI widget" permission.
- **D-02** **Default grants: `admin` (automatic, all permissions) and `designer`.** NOT `analyst`, NOT `user_admin` — admins grant it to analysts/custom roles on the Roles page.
- **D-03** A user who can view a dashboard but lacks `ai:use` sees the AI widget as a **read-only notice** ("You don't have access to the AI assistant") — no ask box; layout unchanged. Server refuses AI requests regardless (UI notice is built in 137; the server refusal + `/api/auth/me` permission exposure are here).
- **D-04** This phase OWNS the permission ripple (catalog count 18 → 19; rbacDb / rbacMigration / web permissions / RolesPage specs; `permissionGroups` wiring) — in ONE plan.

### Conversation memory & context (full chat — changed 2026-10-12)
- **D-05** Each ask sends the AI the **last ~6 exchanges in full plus a short system-written summary of earlier turns** (bounded cost / free-tier quota; follow-ups like "now make it blue" work). Exact N is Claude's discretion, env-tunable if cheap.
- **D-06** Prior answers in that history include **what actually changed, built from the session change log** (applied/skipped ops), not the AI's prose — so the AI knows the true current state.
- **D-07** Tables: the AI starts with **this dashboard's tables**; a **`list_tables` (+ describe) tool** lets it look up other registered tables the user can access when a question needs them. Every table it can see is filtered by the user's own access (AISAFE-V20-03).
- **D-08** The server stays stateless between asks: the client sends the effective dashboard snapshot + the bounded history with each ask (research ARCHITECTURE). The conversation itself lives in the client session layer (Phase 134); the server does not store it except in the audit log (D-09).

### Audit log (AIGOV-V20-04)
- **D-09** Each AI answer writes one record: user, time, dashboard, **the question, the AI's full answer text**, tools run (names + validated args, no row values), changes applied / rejected with reasons, outcome (ok / cancelled / capped / provider error / rate-limited), provider + model, token counts. **Never row values** (schema mode guarantees none; query-mode results are never stored).
- **D-10** Retention via **`AI_AUDIT_RETENTION_DAYS`, default 90** (0 = keep forever); a periodic sweep deletes older records.
- **D-11** Phase 142's audit viewer **reuses the existing `audit:view` permission** (no second permission ripple). → AIGOV-V20-05 reworded 2026-10-12.

### Usage caps & provider rate limits (AIGOV-V20-06)
- **D-12** `AI_MAX_ANSWERS_PER_USER_PER_HOUR` default **30** (0 = no cap); `AI_MAX_TOOL_STEPS` default 8 (already parsed in 133).
- **D-13** Optional whole-deployment **`AI_MAX_ANSWERS_PER_DAY`**, default **0 = off** (for shared / free-tier keys).
- **D-14** Provider **HTTP 429 mid-answer: wait and retry briefly** — honour `Retry-After`, up to ~20 s total within the answer, emitting a "Waiting for the AI provider…" status; then stop with a clear message. Because answers apply atomically, nothing from a failed answer is applied.
- **D-15** Cap messages are **specific and say when**: e.g. "You've used 30 AI answers this hour. Try again in 12 minutes." / "This answer reached the 8-step limit; try a more specific question." / daily: "The AI's daily limit for this deployment has been reached." Admins can raise limits via env.

### Claude's Discretion
- Gateway/tool-registry design, SSE event shapes, provider interface details (normalised events + capability flags per research), where caps are counted (SQLite table vs in-memory + audit-derived), summary generation method for D-05 (deterministic from the change log is preferred over an extra model call).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & design
- `.planning/REQUIREMENTS.md` — AISAFE-V20-02/03, AIPRV-V20-04/05, AIGOV-V20-01/02/04/06 (+ AIGOV-V20-05 reworded 2026-10-12)
- `.planning/ROADMAP.md` §"Phase 135" — success criteria, RBAC note
- `.planning/research/SUMMARY.md` — resolved positions (trust boundary, data access/redaction choke point, streaming), spikes S2/S6
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` (C1–C4, C6, M1, M2, M5, M6)

### Phase 133 / 134 outputs
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md` — S2 (SSE over POST; stream outlives a revoked session → re-check session per op), S7 (grants don't make users read-only; job tag/find/cancel via `/admin/alter/jobs`), approved AI widget subset
- `packages/server/src/lib/aiConfig.ts` (`loadAiConfig`, `AI_*` env parsing), `packages/server/src/lib/aiContract.ts`, `packages/shared/src/{aiOp,actionAllowList,widgetAction}.ts`, `packages/server/src/spikes/sseSpike.ts`
- `.planning/phases/134-session-layer-engine-client-no-llm/134-CONTEXT.md` + `134-VERIFICATION.md` — client session layer the gateway's ops feed; `useAiSessionActions` is the client entry point
- `packages/server/src/lib/permissions.ts` — PERMISSIONS (18), BUILTIN_ROLES, DEFAULT_ROLE_MAPPINGS; existing `audit:view`

### Project rules / memory
- `CLAUDE.md` — verifiable criteria; server vitest is set-based
- Memory: adding a permission ripples across count-asserting specs; dev `.env` leaks into server vitest (tests must force the fake provider and blank AI_*); operator has no Anthropic key (Gemini AI Studio free tier for dev; demo tables only); Kinetica abort ≠ cancel (tag + `/admin/alter/jobs`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadAiConfig` (133) — config already parsed: provider, base URL origin logging, data access, max steps, timeout; extend with D-10/D-12/D-13 vars.
- `kineticaSql(req, …)` — runs as the logged-in user (session creds); needed for schema reads (`list_tables`/describe) under the user's own access.
- `sseSpike.ts` — POST + fetch-stream SSE pattern proven against :4000.
- RBAC `requirePermission`, `getEffectiveRolesAndPermissions`, `/api/auth/me` permission exposure.

### Established Patterns
- Env-only config, fail-closed (AI disabled, app still starts).
- Server vitest set-based gate; `tests/setup.ts` blanks `AI_*`.

### Integration Points
- New `/api/ai/*` routes; RBAC catalog + migration; audit table + sweep (pattern: v1.26 export TTL sweep).

</code_context>

<specifics>
## Specific Ideas
- Cap message examples (D-15) are the operator-approved wording.
- Gemini free tier is low-RPM: one answer may need several model calls, so D-14 retry behaviour matters for dev testing.

</specifics>

<deferred>
## Deferred Ideas
- AI-F13 per-dashboard "viewers can prompt" switch (already deferred).
- Separate "manage AI widget" permission — rejected for v2.0 (D-01).
</deferred>

---

*Phase: 135-server-gateway-agent-loop-providers-governance-core*
*Context gathered: 2026-10-12*
