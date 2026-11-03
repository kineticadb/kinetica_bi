---
phase: 135-server-gateway-agent-loop-providers-governance-core
verified: 2026-10-13T16:30:00Z
status: passed
score: 5/5 success criteria verified (7/8 requirements Complete, AIGOV-V20-01 correctly Partial)
re_verification: null
warnings:
  - id: W1
    severity: warning
    concern: "In-flight AI_BUSY lock has no independent watchdog"
    detail: "inflight.delete(key) runs only in the finally after `await runAnswer(...)`. Release depends on every awaited call honouring abort. Provider fetch and the SSE reader do honour the loop's deadline abort (AI_TIMEOUT_MS), so the real adapters release on time. But the dashboard-table describe probes in runAnswer run BEFORE the loop's deadline exists, and kineticaSql takes no signal. Read-tool probes inside the loop are not abortable either. A hung Kinetica therefore holds the lock until undici's default ~300 s timeouts. An adapter or test fake that ignores abort holds it until restart (135-11 SUMMARY deviation 3 hit exactly this in tests). The audit sweep marks stale 'running' rows interrupted after 15 min, but it does not clear the in-memory map."
    suggested_fix: "Route-level hard release: e.g. setTimeout(timeoutMs + grace) that aborts ac, deletes the inflight entry, and ends the response; or wrap runAnswer in Promise.race with that deadline. Optionally start the deadline before the pre-loop describes."
    blocks_goal: false
  - id: W2
    severity: warning
    concern: "Per-tool rejection counter blocks later VALID ops of the same tool"
    detail: "agentLoop.ts `rejections` is keyed by tool.name (MAX_REJECTIONS_PER_TOOL = 2), never reset on success. After 2 gateway rejections of e.g. add_widget, every later add_widget call in that answer, even a valid one for a different widget, gets 'Not executed: too many invalid attempts' without reaching the gateway. The answer still ends 'ok' with the other ops. The block appears in `tools` only, not in `rejected`/`skipped`, so the client cannot show it as a skipped change. It fails safe (never lets an invalid op through). Confirmed by 135-10 SUMMARY deviation 1 and LOOP-5."
    suggested_fix: "Phase 136 (more ops per answer; SC2 'repaired within 2 attempts') should key the counter per target (tempId / target id) or reset it on a successful op, and surface blocked calls in `skipped`."
    blocks_goal: false
human_verification: []
---

# Phase 135: Server Gateway, Agent Loop, Providers & Governance Core Verification Report

**Phase Goal:** The server runs the agent loop behind one validation gateway, with pluggable providers, schema-only data access by default, the "Use AI" permission, audit records and usage caps.
**Verified:** 2026-10-13
**Status:** passed (2 non-blocking warnings carried forward to 136/137)
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A change failing any gateway check (shape, allow-list, permission, live schema) is rejected and never reaches the browser. A user lacking `ai:use`, view access, or table/column access is rejected. Session-only ops are allowed for any `ai:use` user (D-16). | VERIFIED | `lib/ai/gateway.ts` `checkAiOp` runs a fixed order: shape (JSON + tool zod + `parseAiOp`) → allow_list (`AI_WIDGET_TYPES`, blocked config keys, `validateActionPatch`/`validateLayerSnapshot`) → permission (`ai:use` + `canViewDashboard`, re-read for every op, with no edit-right check per D-16) → reference (shadow) → live_schema (`liveSchema.describe` = `SELECT * FROM t LIMIT 0` via `kineticaSql(principalForSession(sid))`, so it runs as the user). `agentLoop.ts` buffers ok ops in `bufferedOps` and returns them only when `outcome === "ok"`. `runAnswer.ts` sends `result` only on ok. Tests: GW-1..9 (GW-8 stage order, GW-5 per-op re-read, GW-4 D-16), SSE-R2/R3/R4/R5/R7, LOOP-2. Route: `requirePermission(AI_USE)` plus a 404 when the dashboard is not viewable (PRE specs). |
| 2 | A user without "Use AI" is refused by the server. An admin can grant it on the Roles page. The AI sees only tables the user can see. | VERIFIED | `permissions.ts` `AI_USE` is granted to designer (and to admin by default). `db.rbacMigration.spec` AI-UPGRADE covers the seed-once upgrade. `/api/auth/me` exposure is covered by `auth.login-rbac.spec`. Web side: `permissions.ts` mirror, `permissionGroups.ts` `ai: "AI"` group, and `RolesPage.tsx` renders `groupPermissionList(ALL_PERMISSIONS)` dynamically. Table visibility: `list_tables`/`describe_table` and the system-prompt table list all go through `liveSchema.describe` as the user. Inaccessible and not-found are indistinguishable (`{ok:false}`). There is no app-level table ACL to bypass. |
| 3 | In schema mode a planted canary row value never appears in any outbound provider message, including error paths. The API key never reaches the browser or logs. | VERIFIED | `outbound.ts` `buildOutboundRequest` is the single branded producer. In schema mode the `values`/`rows` classes throw `EgressViolation`, and adapters reject unbranded requests (CLD-8). `AskRequestSchema` is strict and has no value field (EGX-6 gives a 400 before any provider call). `aiConfig.apiKey` is a non-enumerable property and the boot log prints only `key=set`. Matrices: EGX-1..6 with positive controls P1–P3 (P3 proves the gate, not luck, blocks rows), and KEY-1..10 with P1–P3 over SSE, `/api/ai/config`, `/api/auth/me`, the audit table and the console. `tests/setup.ts` blanks `AI_*`, and `lib.aiNoNetwork.spec` makes provider hosts unreachable. `AI_DATA_ACCESS` defaults to `schema`. |
| 4 | Each answer writes an audit record with no row values. Exceeding the step or hourly cap returns a message saying why. | VERIFIED | `aiAudit.ts`: `admitAiAnswer` checks the caps and inserts inside one `conn.transaction` (atomic admit, counted in SQLite, so it survives restart: CAP-8). `finalizeAiAnswer` updates exactly once (`status='running'` guard). The route's `finally` finalizes on every path (AUD-R1 matrix). The D-15 sentences are exact (CAP-1, CAP-9, PRE-7, SSE-R5). The retention sweep (`AI_AUDIT_RETENTION_DAYS`, default 90, 0 = keep forever) is wired in `index.ts` after `startExportSweep()` (SWP-1..5). AUD-3 confirms there is no row-value column. |
| 5 | The Claude adapter passes unit tests against recorded fixtures and is documented as not live-verified. Tests never call a real provider or read the dev key. | VERIFIED | `providers/claude.ts` with fixtures in `tests/fixtures/ai/claude/*` (CLD-1..8). It is documented as not live-verified in `README.md:227`, `fixtures/ai/claude/README.md`, and the claude.ts header. NET-1..3 and the setup env blanking cover the second part. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/server/src/lib/ai/gateway.ts` | Single validation gateway | VERIFIED | 166 lines. Wired via `agentLoop.ts` → `checkAiOp` |
| `packages/server/src/lib/ai/agentLoop.ts` | Loop, atomic buffer, caps, cancel/timeout/session | VERIFIED | Wired from `runAnswer.ts` |
| `packages/server/src/lib/ai/runAnswer.ts` | Ask → SSE + finalize input | VERIFIED | Wired from `aiRoutes.ts` |
| `packages/server/src/aiRoutes.ts` | `POST /api/ai/ask` (SSE over POST), `GET /api/ai/config` | VERIFIED | Registered in `index.ts:1284` |
| `packages/server/src/lib/ai/outbound.ts` | Egress choke point | VERIFIED | Used by agentLoop and jsonAction. Adapters check `isOutboundRequest` |
| `packages/server/src/lib/ai/liveSchema.ts` | User-credentialed LIMIT 0 probe | VERIFIED | Identifiers asserted. Probe from `viewColumns.buildViewColumnsProbeSql` |
| `packages/server/src/lib/ai/providers/{openaiCompat,claude,jsonAction,index}.ts` | Adapters + JSON fallback + factory | VERIFIED | Factory wraps in json-action when `toolMode === "json"` |
| `packages/server/src/lib/aiAudit.ts` | Audit, caps, sweep | VERIFIED | Admit/finalize used by the route. Sweep started at boot |
| `packages/server/src/lib/aiConfig.ts` | Caps, history, tool mode, retention env | VERIFIED | `AI_TOOL_MODE` native/json validated; bad values disable AI |
| `packages/server/src/lib/permissions.ts` + web mirror | `ai:use` | VERIFIED | Ripple across specs; web `permissionGroups` "AI" group |
| `packages/shared/src/aiAsk.ts` | Strict AskRequest (D-17) | VERIFIED | Imported by `aiRoutes.ts` and `context.ts` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| aiRoutes `/api/ai/ask` | `requirePermission(ai:use)` | middleware | WIRED (PRE specs give 403) |
| aiRoutes | `admitAiAnswer` / `finalizeAiAnswer` | before stream / `finally` | WIRED |
| runAnswer | runAgentLoop → checkAiOp | gateway deps `getEffectivePermissions`, `canViewDashboard`, `createLiveSchema` | WIRED |
| agentLoop | provider | `buildOutboundRequest` → `withProviderRetry` (signal + deadline) | WIRED |
| liveSchema | Kinetica as user | `kineticaSql(principalForSession(sid), "SELECT * FROM … LIMIT 0")` | WIRED |
| index.ts boot | `startAiAuditSweep` | after `startExportSweep()` | WIRED |
| provider factory | json-action decorator | `config.toolMode === "json"` | WIRED (PF-3) |
| RolesPage | `ai:use` | `groupPermissionList(ALL_PERMISSIONS)` + `NOUN_TO_GROUP.ai` | WIRED |

### Requirements Coverage

| Requirement | Description (short) | Status | Evidence |
|-------------|---------------------|--------|----------|
| AISAFE-V20-02 | One server gateway, so a failing change is never applied | SATISFIED | Truth 1 |
| AISAFE-V20-03 | AI never exceeds the user's rights | SATISFIED | User-credentialed probe, per-op permission re-read, view check. D-16 moves edit rights to Keep (141), as the reworded SC1 states |
| AIPRV-V20-04 | Claude provider unit-tested, documented as not live-verified | SATISFIED | Truth 5 |
| AIPRV-V20-05 | Key never reaches browser/logs; tests never call a real provider | SATISFIED | KEY matrix, NET specs |
| AIGOV-V20-01 | "Use AI" permission; without it, no AI widget; server refuses | PARTIAL (correctly classified) | Server refusal and Roles grant are done. The "cannot use or add the AI widget" clause needs the widget (AIWID-V20-01, Phase 137) and cannot be verified yet. Phase 137 SC1 explicitly covers it ("a user without Use AI cannot add or use it"). Bookkeeping note: Phase 137's `Requirements:` line does not list AIGOV-V20-01. Consider adding it so the Partial closes in traceability |
| AIGOV-V20-02 | Env data-access setting; schema default with planted-value proof | SATISFIED | `AI_DATA_ACCESS` defaults to schema; EGX matrix. The query-mode tools are AIGOV-V20-03 (Phase 140), which is still Pending. Ticking 02 is defensible because 02 is the setting plus the schema proof |
| AIGOV-V20-04 | Every answer logged, no row values | SATISFIED | Truth 4 |
| AIGOV-V20-06 | Env caps, capped user told why | SATISFIED | Truth 4 |

**Early-completion check:** In the REQUIREMENTS traceability, every requirement owned by phases 136–142 reads Pending. Nothing owned by a later phase was marked Complete. No orphaned Phase 135 requirements were found.

### Specific Concerns Requested

1. **In-flight "AI busy" lock (W1, Warning).** The lock can stick indefinitely only if an awaited call ignores abort. There is no timeout-based release at the route level. The real adapters pass `signal` to `fetch` and `parseSseStream` cancels the reader on abort, so the loop's `AI_TIMEOUT_MS` deadline (default 60 s) and client disconnect both release the lock in practice. The gaps:
   - The pre-loop dashboard-table `describe` probes and in-loop read-tool probes go through `kineticaSql`, which has no signal or timeout. A hung Kinetica holds the lock for up to undici's default ~300 s.
   - Any provider that ignores abort holds it until restart. The test suite already had to work around this (135-11 deviation 3).
   - The 15-minute stale-row audit sweep does not touch the in-memory `inflight` map.

   Recommendation for Phase 137, where users will see AI_BUSY: add a route-level hard deadline that releases the lock.

2. **Per-tool rejection limit (W2, Warning, fails safe).** Confirmed. After 2 rejections of a tool name (e.g. `add_widget`), every later call of that tool in the same answer is refused without reaching the gateway, even if valid. The counter is never reset on success. The refusal shows only in `tools`, not in `skipped`, so the client cannot tell the user. This does not compromise safety. It degrades UX and makes the 136 "repair within 2 attempts" criterion per-tool rather than per-op. Fix in 136, or in 137 at the latest.

3. **AIGOV-V20-01 Partial.** The classification is correct, see the table above. No later-phase requirement was marked Complete early.

4. **S6 / JSON fallback.** The Gemini `gemini-3-flash-preview` native verdict is recorded as provisional by operator decision in 135-SPIKES.md (19 clean trials, quota-limited) and in README.md:227. `AI_TOOL_MODE=json` is selectable and covered by tests:
   - `aiConfig.ts` validates `native|json`; an invalid value disables AI (lib.aiConfig spec).
   - `createProviderFromConfig` wraps the provider in `createJsonActionProvider` (PF-3).
   - The decorator is unit-tested in JSA-1..6: tools rendered into a class-checked system part via `deriveOutboundRequest`, fenced/prose JSON parsing, history rewrite, error/usage pass-through.

   It is not exercised end-to-end through `runAgentLoop` or the route in a test. That is low risk because it emits the same `tool_call`/`done` events as native mode. Noted as Info.

### Out-of-scope items (confirmed deferred, not gaps)
- The app-side read-only SQL guard and the query tool belong to Phase 140 (AIGOV-V20-03). The registry never registers `run_query`/`get_column_profile`. Phase 135 runs only identifier-asserted `LIMIT 0` probes.
- Kinetica job tag/find/cancel (S7) is deferred to 137/140 per 135-RESEARCH ("do not add tag/find/cancel here").
- `add_layer` / `add_dynamic_view` / filter tools are not exposed (136/138/139).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/aiRoutes.ts` | 33, 105–138 | Module-global `inflight` map released only after `await runAnswer` | Warning | W1 |
| `src/lib/ai/agentLoop.ts` | 64, 206–212 | `rejections` keyed by tool name, never reset | Warning | W2 |
| `src/lib/ai/gateway.ts` | 130–143 | live_schema checks widget column keys only. A `patch` with `targetKind:"layer"` gets allow-list (`validateLayerSnapshot`) but no column existence check | Info | No privilege escalation, because the layer's table is already on the dashboard and `tableId` cannot be patched. Heatmap layer edits are Phase 136 work (AIACT-V20-04/06) and should add layer column checks |
| `packages/server/s6-gemini.json`, `s6-gemini-wire/` | — | Untracked operator spike outputs, not gitignored | Info | Scanned: no API key or Authorization material present (0 matches). Risk of accidental commit; consider gitignoring them |
| `packages/server/.env.example` | — | Still shows `AI_MODEL=gemini-2.5-flash` (logged in STATE as a follow-up) | Info | Docs only |

No TODO/placeholder stubs were found in `lib/ai/**`. All mutate tools are validate-only by design (D-16 session ops are applied by the client).

### Gates (run by the verifier)

| Gate | Result |
|------|--------|
| server `npx tsc --noEmit` | clean (exit 0) |
| server `node scripts/test-gate.mjs` (set-based) | **GATE PASSED.** The failing set is the 8 documented known failures plus `routes.dashboard-import.spec.ts` (passes alone, TD-V16-TEST-ISOLATION). None of them are AI specs. The first run happened while web vitest ran concurrently, and there `lib.exportRunner.memory.spec.ts` (1M-row heap/timing test, untouched by 135) also failed its isolation re-run. It then passed 4/4 isolated runs, and a clean standalone gate re-run passed. This is load sensitivity, not a 135 regression |
| web `npx tsc --noEmit` | clean (exit 0) |
| web `npx vitest run` | 214 files passed, 1 skipped (includes theme-guard) |

### Human Verification Required

None blocking. The phase is server-only, and the only UI touch (the "AI" group on the Roles page) renders through the existing generic `RolesPage` group loop with no new class names. Optional spot check: open Roles, confirm an "AI" group with "ai:use", grant it to analyst, and confirm an analyst then gets past the 403 on `POST /api/ai/ask`. Live provider proofs are Phase 142's job.

### Gaps Summary

There are no goal-blocking gaps. All five success criteria and seven of the eight requirements are fully delivered and wired, with discriminating tests (positive controls on the egress and key matrices, mutation proofs on the loop). AIGOV-V20-01 is correctly Partial pending the AI widget (Phase 137 SC1).

Two warnings should be scheduled before users touch the feature:
- **W1:** there is no route-level hard release of the per-user in-flight lock.
- **W2:** the per-tool-name rejection counter can silently drop later valid ops, and those drops are invisible in `skipped`.

Both fail safe, meaning they deny rather than leak or misapply. Suggested home: 136 for W2, since it adds the repair semantics; 137 for W1, since the UI surfaces AI_BUSY.

---

_Verified: 2026-10-13_
_Verifier: Claude (gsd-verifier)_
