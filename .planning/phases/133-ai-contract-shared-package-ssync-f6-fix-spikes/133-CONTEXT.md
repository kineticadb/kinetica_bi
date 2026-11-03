# Phase 133: AI Contract, Shared Package, SSYNC-F6 Fix & Spikes - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning (research-phase recommended first: S1, S3)

<domain>
## Phase Boundary

Foundations only — no AI behaviour, no LLM calls, no UI:
1. Close `SSYNC-F6`: client-supplied column names reaching SQL are validated server-side (AISAFE-V20-01).
2. Create `packages/shared`: the zod AI op contract (`AiOp` union), `WidgetAction` + allow-list moved/extended to v3, consumable by web and server.
3. `AI_*` env configuration, off by default, validated at startup (AIPRV-V20-01).
4. Run spikes S1, S3, S7 (and S2 against `:4000` only) and record decisions in `133-SPIKES.md`, then pause for operator review.

Requirements: AISAFE-V20-01, AIPRV-V20-01. Everything else (gateway, loop, providers, widget, ops) belongs to later phases.

</domain>

<decisions>
## Implementation Decisions

### Column check (SSYNC-F6)
- **D-01** Check filter columns against the **registered snapshot** (`tables.columns`, kept current by Schema Sync) — no extra Kinetica call on the drill path. A column added in Kinetica but not yet synced is rejected until Schema Sync is applied (acceptable, by operator choice).
- **D-02** A filter/drill on a column that does not exist is **rejected with a clear error naming the column and table** (e.g. `Column "region" no longer exists on fleet.trips`); nothing is applied, no SQL executed. Not skip-and-warn.
- **D-03** Reach: **audit and fix all** server routes that interpolate client-supplied column names into SQL, not only `POST /api/filter/materialize`. Produce a caller inventory in the style of v1.26's `127-CALLER-AUDIT.md` (`133-COLUMN-AUDIT.md`), classify each site, and guard every one that takes client column names. Sites that only use server-derived names are recorded as such.
- **D-04** The guard must be shown to discriminate: the rejection test fails (SQL reaches Kinetica / interpolated) before the fix and passes after.

### AI configuration at startup
- **D-05** AI is off unless `AI_ENABLED=true`. With AI off, behaviour is byte-identical to today.
- **D-06** `AI_ENABLED=true` with invalid settings (missing key where required, unknown provider, malformed URL, bad numbers) → the **app starts normally with AI disabled** and the server log shows a loud, specific error. It must NOT exit the process (unlike `SESSION_ENCRYPTION_KEY`). → Roadmap 133 criterion 2 reworded accordingly.
- **D-07** Startup validates **format only** — no live call to the provider. A wrong key surfaces later as a clear "provider rejected the key" error (Phase 135/137).
- **D-08** AI status is reported in the **server log only** in this phase (no admin UI, no status in an endpoint yet).
- **D-09** Provider selection is **generic**: `AI_PROVIDER=openai-compatible|claude`, with `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`. No Gemini/Ollama-specific code; `packages/server/.env.example` carries copy-paste examples for **Gemini** (`https://generativelanguage.googleapis.com/v1beta/openai/`) and **Ollama** (`http://localhost:11434/v1`, no key). Other `AI_*` vars from research (`AI_DATA_ACCESS`, `AI_MAX_TOOL_STEPS`, `AI_TIMEOUT_MS`, caps) may be parsed here or in 135 — planner's call, but defaults must be safe (`AI_DATA_ACCESS=schema`).
- **D-10** The API key never appears in logs or error messages (log "AI_API_KEY is missing", never its value).

### Spikes
- **D-11 S2 (streaming):** spike against `:4000` only in this phase; the real deploy-proxy check (docker nginx `:8080`, `docker/nginx.conf` has `gzip on` and no `proxy_buffering off`) is **deferred to Phase 137**. Record the expected nginx change as a finding.
- **D-12 S7 (Kinetica capabilities):** the operator **has a non-admin Kinetica user** — test as that user: can it create the views the AI flow needs, statement timeouts, any read-only enforcement. Admin-only results are not sufficient.
- **D-13 S1 (session-only dynamic views):** if a dv cannot be materialized without a `dashboard_dynamic_views` row, the accepted fallback is **"AI dynamic views go live only after Keep"** (proposed in-session, materialized on Keep). Draft rows are NOT the fallback. If S1 fails, AIACT-V20-07 must be reworded at the checkpoint — flag it explicitly.
- **D-14 S3 (per-type validators):** decide whether zod validators can be derived from the widget registry for all types; fallback is a named subset of widget types for v2.0 — the subset is presented at the checkpoint.
- **D-15 Gate:** write `133-SPIKES.md` (per spike: question, method, result, decision, fallback, consequence for later phases) and **stop at a `checkpoint:human-verify` for operator approval** before Phases 134/135 start.

### Claude's Discretion
- How dynamic-view filter columns are checked (e.g. the dv's materialized column list read from Kinetica at materialize time vs its definition) — must still reject unknown columns with the D-02 error.
- `packages/shared` structure, build/tooling, and how web/server consume it (workspace package; note the Dockerfile copies each package's `package.json` explicitly in both stages — the new package must be added there).
- Exact env var parsing module layout and log format.
- Error status codes (400 vs 422) as long as the message is clear and consistent across routes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and research
- `.planning/REQUIREMENTS.md` — AISAFE-V20-01, AIPRV-V20-01 (+ later reqs the contract must anticipate: AIACT-*, AISES-*)
- `.planning/ROADMAP.md` §"Phase 133" — goal, success criteria
- `.planning/research/SUMMARY.md` — resolved positions (trust boundary, shared package, dv structured spec), spikes S1–S7 table
- `.planning/research/ARCHITECTURE.md` — integration points, `AiOp` shape, dv ad-hoc materialize option B
- `.planning/research/PITFALLS.md` — C1/C5/C6 (validation, model SQL, hallucinated columns), env/secrets
- `.planning/research/STACK.md` — env var set, zod version alignment, Node 20 constraint

### Existing contract to extend
- `packages/web/docs/mcp-action-seam.md` — v1.11 action envelope + allow-list as the AI seam
- `packages/web/src/lib/widgetAction.ts`, `packages/web/src/lib/actionAllowList.ts`, `packages/web/src/lib/applyWidgetAction.ts`, `packages/web/src/store/widgetActionStore.ts`

### SSYNC-F6
- `.planning/milestones/v1.25-REQUIREMENTS.md` / `.planning/MILESTONES.md` §v1.25 — origin of SSYNC-F6
- `packages/server/src/index.ts:1289` — `POST /api/filter/materialize` handler (table path + dv path)
- `.planning/phases/127-row-limit-ceiling-caller-audit-heatmap-truncation-fix/127-CALLER-AUDIT.md` — audit document style to mirror for `133-COLUMN-AUDIT.md`

### Project rules
- `CLAUDE.md` — verifiable acceptance criteria (grep criteria must read 0 before the work), test gates (server vitest is set-based)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/server/src/lib/columnRefs.ts`, `schemaFingerprint.ts`, `schemaDiff.ts` (v1.25): registered-column knowledge and fingerprints — candidates for the snapshot lookup.
- `packages/server/src/lib/dynamicViewSql.ts`, `dynamicViewName.ts`, `materializedView.ts`: dv SQL/naming/materialize — S1 spike surface.
- `packages/server/src/env.ts`: dotenv loading; existing fail-fast pattern (do NOT copy it for AI — D-06).
- `packages/web/src/lib/widgetAction.ts` + `actionAllowList.ts` (zod, `ALLOW_LIST_VERSION` "v2"): move/extend into `packages/shared`.

### Established Patterns
- Server has no zod today; web uses zod 3.x — shared package must align versions.
- Server vitest is set-based (TD-V16 contamination); dev `.env` leaks into server tests — AI env tests must not depend on the developer's `.env`.
- Caller-audit documents (v1.26 Phase 127) as the inventory pattern for D-03.

### Integration Points
- `POST /api/filter/materialize` (table path and dv path) and any other column-interpolating routes found by the audit.
- Root `package.json` workspaces (`packages/*`) and the `Dockerfile` (both stages copy each package's `package.json`).
- `packages/server/.env.example` for the AI examples.

</code_context>

<specifics>
## Specific Ideas

- Error copy example from discussion: `Column "region" no longer exists on fleet.trips`.
- The operator explicitly wants spike results reviewed before building on them (pause at checkpoint).
- Gemini via AI Studio free tier is the dev provider; nothing in this phase may call it.

</specifics>

<deferred>
## Deferred Ideas

- Admin-visible AI status (`/api/ai/config` reporting enabled/disabled + reason) — Phase 135 may add it; not in 133.
- Deploy-proxy streaming verification and nginx change — Phase 137.
- Live provider key check — surfaces on first use (135/137), never at boot.

</deferred>

---

*Phase: 133-ai-contract-shared-package-ssync-f6-fix-spikes*
*Context gathered: 2026-10-09*
