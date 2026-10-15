---
phase: 137-ai-widget-streaming-ui
verified: 2026-10-15T11:05:00Z
status: passed
score: 5/5 success criteria verified (9/9 requirements: 8 satisfied, AIWID-V20-05 correctly Partial)
re_verification: false
residual_human_checks: # non-blocking, carry into Phase 142 UAT
  - test: "Sign in as a user without ai:use and open a dashboard that has an AI widget"
    expected: "Tile shows 'You don't have access to the AI assistant', no ask box, layout unchanged; picker has no AI Assistant"
    why_human: "Only unit-tested (AIW-1, DPAI-1/4) plus server 403 specs; never viewed live"
  - test: "Narrow the window below 900 px and open the small-tile drawer"
    expected: "Drawer is full-width (100vw)"
    why_human: "CSS media rule only; not eyeballed"
  - test: "Two AI widgets on one dashboard, ask from one"
    expected: "Both show the same running state, conversation and Cancel"
    why_human: "Unit-tested only (AIW-7)"
  - test: "Live ask through the docker nginx :8080 proxy"
    expected: "status/step events arrive progressively (not buffered); trailer follow-ups/choices adhered to by Gemini/Ollama"
    why_human: "S2 verified by text spec + nginx -t only; AIWID-V20-05 live adherence is Phase 142"
---

# Phase 137: AI Widget & Streaming UI Verification Report

**Phase Goal:** Users ask questions in an AI widget that keeps a full chat conversation and watch the dashboard answer, with progress, cancel, follow-ups, clarification, highlights, a per-answer "Revert dashboard to this state" button and a Keep/Discard bar.
**Verified:** 2026-10-15
**Status:** passed
**Re-verification:** No (initial)

## Goal Achievement

### Success Criteria (ROADMAP)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Designer adds AI widget; large tile inline chat, small tile ask bar + history + portalled drawer (full-screen narrow); no "Use AI" = cannot add or use | VERIFIED | `definitions/ai.ts` registers type `ai`; `DashboardsPage.getVisualizationTypes(canUseAi)` filters it unless `ai:use` AND `useAiConfigured()===true`; `handleAddVisualization` re-checks and uses `AI_ASSISTANT_DEFAULT_SIZE` 12x40; duplicate gated on `ai:use`. `WidgetRenderer` routes `type==="ai"` to `AiWidgetRenderer` before AggregatedWidgetRenderer. `AiWidgetRenderer` gate order noAccess -> notConfigured -> unavailable, then `isSmallAiTile` (w<12 or h<24) picks inline `AiChat` vs tile bar (History + `AiAskBox` + `AiRunStatus` + one-line last result) + `AiDrawer` (createPortal to body, focus in effect, Escape). `@media (max-width:900px) .ai-drawer {width:100vw}`. Server: `index.ts denyAiWidget` 403 on POST type ai and PATCH retype to ai; ask route `requirePermission(AI_USE)`. Operator UAT steps 1, 4 (after 81117b2). |
| 2 | Question changes dashboard, appears in shared conversation with full answer; progress, Cancel works, second ask blocked | VERIFIED | `askRunner.runAsk` -> `streamAsk` (fetch POST + reader SSE parser) -> `result` applied atomically via `applyTurn` with `chat` metadata; one store => all widgets share conversation. Progress: `status`/`step` -> `updateRun` -> `AiRunStatus` (spinner, elapsed after 10 s). Cancel: `cancelAsk` aborts fetch -> server `res.on("close")` -> `ac.abort()` + `cancelKineticaJobsByTag(requestId)`; client records "Cancelled, nothing changed" and refills draft. Second ask: client `run.status==="running"` guard + Send->Cancel; server `inflight` map 409 AI_BUSY. W1: `Promise.race` with hard deadline (timeoutMs+5 s) releases lock and cancels tagged jobs; `liveSchema` probes pass `signal`+`tag`; `kineticaSql` prefixes `/* kbi-ai:<id> */`. Specs W1-1..4, KJ-1..5. |
| 3 | Each answer: full plain text, clickable follow-ups, working Revert; ambiguous -> 2-3 choices | VERIFIED (choices live adherence deferred) | `AiChat` renders `turn.answer` untruncated as text, follow-ups (server `followUps` or template fallback) that call `runAsk`, Revert -> `setCursor(i, baseline)`. Server `replyTrailer.parseReplyTrailer` + `toChoiceClarification` -> `choose_option`; `AI_TRAILER_RULE` in system prompt; choice click -> `choiceQuestion` reply + `markChoicePicked`, `approveRemoval` for confirm_remove yes. Older choices disabled/greyed (81117b2). |
| 4 | Provider error, cap or quota shows clear message, dashboard unchanged | VERIFIED | `recordError` toasts and records error turn with `ops: []` (op-less turn: no lock); message is server's text (AI_USER_MESSAGES / 429 cap message); Retry only for retryable codes, never 429. Inline error + Retry operator-checked. |
| 5 | Highlights + Keep/Discard bar with counts legible light/dark; global.css classes; modals portalled | VERIFIED (operator UAT) | `WidgetCard` nonce-keyed `widget-card--ai-changed` outline (AI_HIGHLIGHT_MS 3000); `changedWidgetIds` resolves layer ops to host maps via `layersOfMap` with effective includedLayerIds; pill via `selectShowsAiEditedPill` (incl. `aiLayerHostWidgetIds`). `AiChangeBar` (added/edited/removed, removed-names hover, Keep disabled + tooltip, Discard) mounted under header; `AiDiscardDialog` portalled. All ~40 classes used resolve in `global.css`/`AiWidget.css`; no hex/rgba in AiWidget.css. Operator UAT steps 5/5b/5c/6/7 light + dark. |

**Score:** 5/5

### Required Artifacts (all exist, substantive, wired)

| Artifact | Status | Wiring |
|---|---|---|
| `packages/server/src/aiRoutes.ts` (deadline, cancelJobs) | VERIFIED | registered route; uses `cancelKineticaJobsByTag`, `runAnswer` |
| `packages/server/src/lib/kineticaJobs.ts` | VERIFIED | imported by aiRoutes + kinetica.ts (`tagSql`) |
| `packages/server/src/lib/ai/replyTrailer.ts` | VERIFIED | used in `runAnswer` result event + audit text |
| `packages/server/src/lib/ai/gateway.ts` AI-widget lock | VERIFIED | refuses patch/remove/retype/title/set_layout on type ai (GW7 specs) |
| `packages/server/src/lib/ai/agentLoop.ts` shape-key fix | VERIFIED | clears `${tool}:shape:?` on success |
| `docker/nginx.conf` `location = /api/ai/ask` | VERIFIED | proxy_buffering off, gzip off, 300 s; deploy.nginxStream spec |
| `packages/shared/src/aiAsk.ts` result contract | VERIFIED | consumed by server runAnswer + web runner |
| `web/lib/aiSession/askStream.ts`, `askRunner.ts`, `buildAskRequest.ts`, `aiAvailability.ts` | VERIFIED | used by AiChat/AiAskBox, DashboardsPage AskContext |
| `web/components/charts/AiChat.tsx`, `AiWidgetRenderer.tsx`, `AiDrawer.tsx`, `AiWidget.css` | VERIFIED | WidgetRenderer branch; context `ai` from DashboardsPage |
| `web/components/AiChangeBar.tsx`, `AiDiscardDialog.tsx` | VERIFIED | mounted in DashboardsPage; old config-hint removed (DPAI-5) |
| `web/components/WidgetCard.tsx` outline | VERIFIED | reads store `highlight`, set by `applyResult` |

### Key Links

| From | To | Via | Status |
|---|---|---|---|
| AiAskBox/AiChat | POST /api/ai/ask | runAsk -> streamAsk -> askAi | WIRED |
| result event | dashboard | applyTurn(ops) + setHighlight | WIRED |
| Cancel button | Kinetica job cancel | fetch abort -> res close -> cancelKineticaJobsByTag(requestId) | WIRED |
| liveSchema probe | job tag | kineticaSql({signal, tag}) | WIRED |
| Dashboard unmount | runner | cancelAsk() before reset() (DPAI-7) + epoch check | WIRED |
| Picker | ai:use + /api/ai/config | canUseAi filter | WIRED |
| Layer-only edit | host map outline + pill | changedWidgetIds hostsOf / aiLayerHostWidgetIds | WIRED |

### Requirements Coverage

| Requirement | Status in REQUIREMENTS.md | Verdict | Evidence |
|---|---|---|---|
| AIWID-V20-01 | Complete | SATISFIED | SC1 |
| AIWID-V20-02 | Complete | SATISFIED | single aiSessionStore conversation; AIW-7 |
| AIWID-V20-03 | Complete | SATISFIED | SC3 |
| AIWID-V20-04 | Complete | SATISFIED | SC2, W1, S2 |
| AIWID-V20-05 | Partial | CORRECTLY PARTIAL | UI + `choose_option` contract + parser done; live model adherence untested until Phase 142 |
| AIWID-V20-06 | Complete | SATISFIED | SC5 incl. layer-only host-map highlight |
| AIWID-V20-07 | Complete | SATISFIED | SC4 |
| AISES-V20-04 | Complete | SATISFIED (with accepted deviation) | bar with counts, Discard works; Keep visible but disabled, operator-accepted until 141 (D-16) |
| AIGOV-V20-01 | Complete | SATISFIED — evidence judged sufficient | see below |

**AIGOV-V20-01 judgment.** The no-access widget view was not operator-viewed, only unit-tested. I judge the evidence sufficient for Complete because: (a) the UI gate is the first, unconditional branch of `AiWidgetRenderer` (`if (!canUse) return notice(...)`), before any hook-dependent render or config fetch, covered by AIW-1; (b) the add gate is covered by DPAI-1/DPAI-4 and re-checked in `handleAddVisualization`; (c) the requirement's enforcement does not depend on the UI: the server refuses `/api/ai/ask` without `ai:use` (135) and now 403s widget create/retype (WCG-1..4), so a UI defect could at worst show an ask box that cannot succeed. What remains unproven is only visual (notice legibility, layout unchanged), which is a cosmetic check, not the governance property. Recommend observing it once in the Phase 142 UAT (listed in residual checks).

**Bookkeeping note (info):** the traceability row for AIGOV-V20-01 still says "Phase 135" while ROADMAP lists it under Phase 137; the note text explains the split, so this is cosmetic.

### Anti-Patterns Found

None blocking. "coming soon" matches are the intentional D-16 Keep tooltip; "placeholder" matches are the textarea placeholder attribute.

| Note | Severity |
|---|---|
| A provider that ignores abort keeps the user's lock until the hard deadline (timeoutMs + 5 s) after Cancel; bounded by design (W1) | Info |
| `cancelKineticaJobsByTag` is best-effort (swallows errors); live non-admin cancel proven in 133 S7 only, not re-run here | Info |

### Gates (run sequentially, 2026-10-15)

| Gate | Result |
|---|---|
| shared `tsc --noEmit` | clean |
| server `tsc --noEmit` | clean |
| server `scripts/test-gate.mjs` | PASSED: 2186/2240; 8 known-failing (TD-V11-04 OIDC, db.smoke drift, routes.wms) + `routes.column-display-config.spec.ts` passes alone (TD-V16-TEST-ISOLATION) |
| web `tsc --noEmit` | clean |
| web `vitest run --maxWorkers=4` | 232 files passed, 1 skipped; 4758 tests passed, 1 skipped |
| web theme-guard | 172/172 |

### Human Verification

Operator UAT (137-12-UAT-RESULTS.md) covered SC5 and the visual parts of SC1-4 in light and dark; 7 issues fixed in 81117b2 and re-verified. Residual non-blocking checks (frontmatter) belong in the Phase 142 UAT: no-access user view, drawer below 900 px, multi-widget sync, live streaming through :8080 and live trailer adherence.

### Gaps Summary

No gaps. All five success criteria are implemented and wired end to end; requirement statuses match the evidence (AIWID-V20-05 correctly Partial; AISES-V20-04 Complete with the operator-accepted disabled Keep; AIGOV-V20-01 Complete with sufficient evidence).

---

_Verified: 2026-10-15_
_Verifier: Claude (gsd-verifier)_
