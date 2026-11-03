---
phase: 143-claude-desktop-mcp-connector
verified: 2026-11-02T00:00:00Z
status: human_needed
score: 6/6 success criteria verified in code and specs (2 live checks still open with the operator)
human_verification:
  - test: "Live token sign-in from Claude Desktop: create a token on Profile > Claude Desktop, put KBI_TOKEN (no KBI_USERNAME/KBI_PASSWORD) in claude_desktop_config.json, Cmd+Q and reopen, then list_tables and build a small dashboard. Afterwards revoke the token and call a tool again."
    expected: "The connector signs in through /api/mcp/token-login and works. After Revoke the next tool call fails with 'Invalid, expired or revoked token.'"
    why_human: "Needs the operator's Claude Desktop and a real token. The operator's 2026-10-29 Claude Desktop run used the password config. The token flow was checked in the browser (UAT row 8) and by MCP-10 / MCPC-3, not end to end from Claude Desktop."
  - test: "Live Keep with the in-app AI off: restart the server with MCP_ENABLED=true and AI_ENABLED unset, build from Claude Desktop, open the link, press Keep, reload."
    expected: "The Keep bar appears, Keep returns 200, the dashboard persists after reload, and the AI activity row shows kind 'Claude Desktop' with data access 'schema'."
    why_human: "Covered by route specs (KEEP-ROUTE-mcp-only, MCP-13). Not re-run live because a restart signs the operator out (UAT row 11)."
---

# Phase 143: Claude Desktop MCP Connector Verification Report

**Phase Goal:** A user builds or changes a Kinetica BI dashboard from Claude Desktop (their Claude subscription, no API key). Every change is checked by the same gateway as the in-app AI, and nothing is saved until they press Keep.
**Verified:** 2026-11-02
**Status:** human_needed. All six success criteria hold in code and specs, and the operator passed the live UAT. Two live checks are still open with the operator: token sign-in from Claude Desktop, and Keep with AI_ENABLED off.
**Re-verification:** No. This is the first verification. The phase began as a spike and has no PLAN/SUMMARY files, so the must-haves come from the ROADMAP success criteria and AIMCP-V20-01..09.

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Claude Desktop builds a dashboard the user reviews and keeps. A rejected change comes back with reasons and Claude repairs it. | VERIFIED | `mcpRoutes.ts` `/sessions/:id/call` sends every mutate tool through `checkAiOp` (same gateway: shape, allow-list, permission, reference, live schema). On rejection it returns `{ok:false, stage, reasons}` (around L271-279). `packages/mcp/src/server.ts` turns that into "Rejected (stage): reasons. Fix it and call again". Finish returns `/?dashboard=N&mcp=<id>`. The browser takes the ops once (`takeMcpHandoff` deletes the session) and applies them as one unsaved AI turn (`DashboardsPage.tsx:1147-1169`, `aiActions.applyTurn`). Specs: MCP-4, MCP-5, MCPS-3. UAT rows 1 and 3, and the operator's Claude Desktop run. |
| 2 | The dashboard fits one screen when there are not too many widgets, and a text summary sits at the top sized to its text. | VERIFIED | A new build is re-laid out at finish (`s.ops = applyFitBands(s.ops)`, mcpRoutes.ts, mode "new" only). The browser refits text to the real width (`refitTextLayouts(h.ops, textCharsPerLine(width - MCP_TEXT_PADDING_PX))`, DashboardsPage.tsx:1163). `shared/src/layout.spec.ts`, MCP-8, MCP-9. UAT rows 4, 6 and 7, checked at 1440 and 1920. |
| 3 | The connector signs in with a revocable personal access token. No password is stored in Claude Desktop's config. | VERIFIED (code + browser UAT). Live Claude Desktop run is human-needed | `lib/mcp/mcpTokens.ts`: the token is `kbi_<pub>_<secret>`. The DB stores only a SHA-256 of the token and the password encrypted with AES-256-GCM under an HKDF key derived from the unstored secret. Redeem uses `timingSafeEqual` and checks expiry. Revoke deletes the row and ends the sessions the token opened. `/api/mcp/token-login` is registered before the global auth gate (index.ts:714) and re-checks the credential with Kinetica. `kbiClient.ts` prefers `KBI_TOKEN`. The README and Profile "Copy config" emit only `KBI_URL` + `KBI_TOKEN`. Specs: MCPTOK-1..5, MCP-10, MCP-11, MCPC-3, ClaudeDesktopTokens.spec. UAT row 8. |
| 4 | Discarding, or never opening the link, leaves no dashboard behind (checked in SQLite). | VERIFIED | `POST /api/mcp/sessions` creates a dashboard through `createGeneratedDashboard` (pending, creator-only). Discard goes through `/discard-generated` (MCP-3c asserts `getDashboard` is undefined). A link that is never opened is cleaned up by logout (`discardPendingForUser`, index.ts:477), by the boot sweep (index.ts:3523, runs even with AI off) and by the hourly `AI_GENERATED_TTL_HOURS` sweep (index.ts:3536, default 24 h). UAT row 9 checked SQLite. |
| 5 | The AI activity page shows Claude Desktop builds as their own kind, and Keep works with the in-app AI off. | VERIFIED (specs). Live AI-off Keep is human-needed | `recordMcpBuild` writes kind `'mcp'` (aiAudit.ts:187-199). `AiAuditKind` includes "mcp" on both server and web. `AiActivityPage.tsx:21` shows the label "Claude Desktop". `aiCheckLimits()` returns `MCP_ONLY_LIMITS` (schema-only) when AI is off and MCP is on (aiConfig.ts:190-194). Keep uses it (aiKeepRoutes.ts:55). `AiChangeBar` is not gated on the AI config (DashboardsPage.tsx:1898). Specs: MCP-12, MCP-13, KEEP-ROUTE-mcp-only (200), KEEP-ROUTE-forged-disabled (503 when both are off). UAT row 10. |
| 6 | Claude can change an existing dashboard and apply filters, reviewed with the same Keep bar. | VERIFIED | `POST /api/mcp/sessions {dashboardId}` needs `canViewDashboard` + `dashboards:edit` and starts an edit session from `snapshotForDashboard`. Removing saved content needs `confirmed: true`, and the browser then calls `approveRemoval()` (`mcpHandoff.ts`, DashboardsPage.tsx:1165). `apply_filter`/`clear_filter` are in `MCP_TOOL_NAMES` and reach the browser as session-only ops. Keep does not save filters (Phase 141 behaviour). Specs: MCP-14, MCP-15, MCP-16, MCPS-5, MCPSNAP-1. UAT rows 12-13, and the operator renamed, removed and filtered dashboard 59 live. |

**Score:** 6/6

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/mcp/src/server.ts` | stdio MCP tool surface (local plus forwarded tools) | VERIFIED | 169 lines. Local tools: list_tables, start/open/finish_dashboard, list_dashboards. Remote tools come from `/api/mcp/tools`. The version is read from package.json. |
| `packages/mcp/src/kbiClient.ts` | REST client: token or password sign-in, one re-login on 401 | VERIFIED | Never logs credentials. |
| `packages/mcp/README.md` | Token-based Claude Desktop setup | VERIFIED | `KBI_TOKEN` config. States that AI_ENABLED is not required. |
| `packages/server/src/mcpRoutes.ts` | tools, sessions, call, finish, handoff, tokens, token-login | VERIFIED | Registered only when `MCP_ENABLED=true` (index.ts:714, 1342). MCP-1 checks this. |
| `packages/server/src/lib/mcp/mcpTokens.ts` | Hashed and encrypted PAT storage, revoke ends sessions | VERIFIED | `mcp_tokens` / `mcp_token_sessions` tables (db.ts:420-437). |
| `packages/server/src/lib/mcp/mcpSessions.ts` | In-memory sessions (2 h TTL, 3 per user, handoff once) | VERIFIED | |
| `packages/server/src/lib/mcp/mcpSnapshot.ts` | Saved-dashboard snapshot for edit mode, no values or SQL | VERIFIED | MCPSNAP-1 |
| `packages/web/src/components/ClaudeDesktopTokens.tsx` | Profile token create, copy and revoke | VERIFIED | Wired in ProfilePage.tsx:78 behind mcpEnabled + password mode + ai:use. Every class resolves to real CSS (global.css or ProfilePage.css). Buttons follow the canonical `btn-primary btn-sm` + `ghost-sm` inside `ds-actions`. |
| `packages/web/src/lib/markdownText.tsx` + `charts/TextRenderer.tsx` | Markdown rendered as React elements, no HTML | VERIFIED | No `dangerouslySetInnerHTML` or `innerHTML`. `SAFE_HREF` allows only http, https and mailto. Links use `rel="noopener noreferrer"`. |
| `packages/web/src/lib/aiSession/mcpHandoff.ts` + DashboardsPage handoff effect | `?mcp=` handoff into an unsaved AI turn | VERIFIED | The module-level `mcpHandoffsTaken` set guards against StrictMode running the effect twice. The URL param is cleared. |

## Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| Claude Desktop (stdio) | `/api/mcp/*` | `KbiClient.request` with the session cookie | WIRED (MCPS-*, MCPC-*) |
| `/sessions/:id/call` (mutate) | in-app AI gateway | `checkAiOp(...)` with shadow, live schema, permissions | WIRED |
| `/sessions/:id/call` (read) | egress filter | `isClassAllowed(config.dataAccess, p.cls)` | WIRED |
| `/finish` | audit | `recordMcpBuild` kind `'mcp'` | WIRED (MCP-12) |
| Browser `?mcp=` | `/handoff` then `aiActions.applyTurn` | `getMcpHandoff` (client.ts:2295) | WIRED |
| AI bar Keep | `/api/dashboards/:id/ai-keep` | `aiCheckLimits()` falls back to MCP_ONLY_LIMITS | WIRED (KEEP-ROUTE-mcp-only) |
| Unkept build | cleanup | discard-generated / logout / boot sweep / TTL sweep | WIRED |
| Profile page | `/api/mcp/tokens` | `ClaudeDesktopTokens` (client.ts:2315-2332) | WIRED |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| AIMCP-V20-01 | 91ede8b (+ d08359f) | Build from Claude Desktop through the same gateway; nothing saved until Keep | SATISFIED | Truth 1. MCP-4/5/6/7, MCPS-1..4. Live Claude Desktop run 2026-10-28/29 |
| AIMCP-V20-02 | 2ae8a5b, f5611dc, 35e752e, 0961ef6, 5301497 | Server fits one screen; text sized to the real width in the browser | SATISFIED | Truth 2. MCP-8, layout.spec. UAT rows 4, 6, 7 |
| AIMCP-V20-03 | d592ecb | Markdown text widget without HTML, for the user and the AI | SATISFIED | markdownText.spec (HTML shown as text, safe hrefs). MCP-9. UAT: a `<script>` line rendered as text, light and dark |
| AIMCP-V20-04 | a410fbd | Revocable PAT, no password in Claude Desktop config | SATISFIED in code and browser. NEEDS HUMAN for the live Claude Desktop run | Truth 3. MCPTOK-1..5, MCP-10/11, MCPC-3. UAT row 8 |
| AIMCP-V20-05 | a410fbd | Discard or never opening leaves no dashboard | SATISFIED | Truth 4. MCP-3/3b/3c. UAT row 9 (SQLite) |
| AIMCP-V20-06 | a410fbd | Own kind in the AI log and on the AI activity page | SATISFIED | MCP-12, AiActivityPage.spec. UAT row 10 |
| AIMCP-V20-07 | a410fbd, d08359f | Keep works with the in-app AI off | SATISFIED (route specs). NEEDS HUMAN for the live run | KEEP-ROUTE-mcp-only, KEEP-ROUTE-forged-disabled, MCP-13 |
| AIMCP-V20-08 | 955634f | Change an existing editable dashboard, same Keep bar | SATISFIED | MCP-14/15, MCPS-5. UAT row 12 after the approveRemoval fix |
| AIMCP-V20-09 | 779406e | Apply filters, session-only | SATISFIED | MCP-16. UAT row 13 |

No orphaned requirements. REQUIREMENTS.md maps exactly AIMCP-V20-01..09 to Phase 143, and all of them are covered above. Commit 779406e (AIMCP-V20-09) is on the branch but is not named in the REQUIREMENTS.md traceability row for 09. That is a bookkeeping detail only.

## Test Runs (this verification, run one at a time)

- `packages/mcp`: `npx vitest run`: 10/10 passed. `npx tsc --noEmit`: clean.
- `packages/server`: `routes.mcp.spec.ts`, `lib.mcpTokens.spec.ts`, `lib.mcpSnapshot.spec.ts`: 24/24 passed.
- `packages/server`: `routes.aiKeep.spec.ts -t "KEEP-ROUTE-mcp-only|KEEP-ROUTE-forged-disabled"`: 2/2 passed.
- `packages/web`: `ClaudeDesktopTokens.spec.tsx`, `markdownText.spec.tsx`, `AiActivityPage.spec.tsx`: 24/24 passed.
- The full suites were not run, on purpose (parallel load gives false timeouts).

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| server/src/mcpRoutes.ts | 2 | "kbi-mcp spike" header comment | Info | d08359f removed "spike" from the mcp package only. 7 comment labels are left in server/web: index.ts:1341, lib/ai/outbound.ts:59, lib/mcp/mcpSessions.ts:1, web DashboardsPage.tsx:107 and 1142, web api/client.ts:2295, and the routes.mcp.spec describe title. Cosmetic. |
| server/src/index.ts | 477 | Logout calls `discardPendingForUser` | Info | Signing out of the browser while Claude Desktop is mid-build deletes the in-progress unkept build. This matches Generate's lifecycle (D-03a) and fits "leaves nothing behind". Noted for awareness only. |
| server/src/lib/aiGenerate.ts | 113 | Unopened link lingers up to AI_GENERATED_TTL_HOURS (24 h default) | Info | The MCP session dies at 2 h, but the creator-only pending dashboard stays until the TTL, boot or logout sweep. Only the creator can see it in the meantime. |

No TODO/FIXME/placeholder code was found. No blockers.

## Human Verification Required

### 1. Live token sign-in from Claude Desktop (AIMCP-V20-04)
**Test:** On Profile > Claude Desktop, create a token and press Copy config. Put `KBI_URL` + `KBI_TOKEN` in claude_desktop_config.json with no password, then Cmd+Q and reopen. Build a small dashboard. Revoke the token and call a tool again.
**Expected:** Sign-in works through token-login. After revoke, the connector reports "Invalid, expired or revoked token."
**Why human:** Needs the operator's Claude Desktop. The 2026-10-29 operator run used the password config.

### 2. Live Keep with AI_ENABLED off (AIMCP-V20-07)
**Test:** Restart the server with `MCP_ENABLED=true` and `AI_ENABLED` unset. Build from Claude Desktop, open the link, press Keep, reload.
**Expected:** Keep succeeds and the dashboard persists. The AI activity row shows "Claude Desktop" with schema data access.
**Why human:** Proven by route specs only. A restart signs the operator out, so it was not re-run live.

## Gaps Summary

No code gaps. Every success criterion and all of AIMCP-V20-01..09 have implementation and spec evidence, and the operator passed the live Claude Desktop UAT on 2026-10-29. Two live checks are still open with the operator: token sign-in from Claude Desktop, and Keep with the in-app AI off. Both are already covered by automated specs and are not code defects.

---
_Verified: 2026-11-02_
_Verifier: Claude (gsd-verifier)_
