# Phase 137: AI Widget & Streaming UI - Context

**Gathered:** 2026-10-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Users ask questions in a new **AI widget** that keeps one shared chat conversation per dashboard and watch the dashboard answer: progress, Cancel, follow-ups, clarification choices, highlights, a per-answer "Revert dashboard to this state" button, and a Keep/Discard bar with counts. This is the first real client of `POST /api/ai/ask` (SSE), replacing the DEV harness as the driver.

Requirements: AIWID-V20-01..07, AISES-V20-04, AIGOV-V20-01 (closes the widget clause; Partial since 135).

In scope also (carry-forward, technical, Claude's discretion on approach):
- **S2 deploy-proxy streaming**: SSE through docker nginx `:8080` (`docker/nginx.conf` has `gzip on`, no `proxy_buffering off`), deferred from 133.
- **W1 (135 verification)**: route-level hard deadline that always releases the per-user in-flight lock; abort signal for Kinetica probes; Kinetica job tag/find/cancel on user Cancel (see memory: aborting `/execute/sql` does not cancel the job).
- **136 verification defect (fix first)**: a shape failure has no slot, so its `<tool>:shape:?` repair key is never cleared by a later successful call to the same tool. Result: `ops: 1` AND `skipped: [{label:"add_widget", stage:"shape"}]` for one applied change, and a second different malformed call is told "Do not retry". Clear `T:shape:?` when tool T succeeds; add a red-first spec. Must land before this phase shows `skipped` to users.

Out of scope: saving (Keep persistence) is Phase 141; filters 138; dynamic views 139; query tools 140; generate + audit viewer + live Gemini/Ollama UAT 142.

</domain>

<decisions>
## Implementation Decisions

### Already locked by earlier phases (do not re-ask)
- Presentation follows tile size; no Compact/Full setting. Large tile = inline chat; small tile = ask bar + history icon + one-line result of the last answer, full conversation in a portalled drawer (full-screen on narrow screens). (AIWID-V20-01, 134 discussion)
- One shared conversation per dashboard per user; several AI widgets show the same conversation (134 D-05). History is in memory only; Keep/Discard/reload clear it (134 D-04).
- Revert to any turn restores it as one unit; forward again possible; asking from a reverted cursor drops later turns (134 D-02/D-03).
- Editing locked while AI changes are unsaved; leave warning (portalled) + `beforeunload` (134 D-07/D-08/D-15). Op-less turns do not lock (134 D-17).
- User without `ai:use` sees the widget as a read-only notice "You don't have access to the AI assistant", no ask box, layout unchanged; server refuses regardless (135 D-03). This phase also gates **adding** the widget on `ai:use`.
- A failed/rejected/cancelled answer applies zero ops (135 atomic buffered ops).
- Removing saved content asks once per conversation (136 D-06; `approvals.removeSaved` / `approveRemoval()`); a heatmap with several candidate maps asks which map (`choose_map`, 136 D-11). This phase builds the clickable buttons.
- "AI added" / "AI edited" pills exist (`widget-filter-badge`, 136).

### Chat look & empty state
- **D-01 Empty state:** a one-line hint ("Ask about this dashboard's data") plus **2–3 clickable starter questions built from fixed templates filled from the dashboard tables' column names/types** (e.g. "Show total `<numeric>` by `<category>`", "Add a heatmap of `<table>`" when lat/lon exist). Built locally: **no provider call, no quota used**. Clicking a starter asks it.
- **D-02 Small-tile threshold (fixed grid size):** the widget uses the small ask-bar + drawer layout when it is **under 12 columns wide OR under 24 rows tall** (grid is 36 columns). Otherwise inline chat.
- **D-03 Default size of a newly added AI widget:** **12 cols x 40 rows** (inline chat from the start).
- **D-04 Chat style:** chat bubbles, **newest at the bottom**, auto-scroll to latest. User question right-aligned; AI answer left-aligned with its follow-ups and the "Revert dashboard to this state" button underneath.
- **D-05 Ask box:** at the **bottom**; single line that grows to a few lines; **Enter sends, Shift+Enter new line**; Send button beside it.
- **D-06 Header:** the normal widget title bar only (like every other widget); no extra conversation controls (Discard lives in the Keep/Discard bar).

### Progress & cancel
- **D-07 Progress:** **one live status line + spinner**, replaced as each server `step`/`status` event arrives (e.g. "Adding a bar chart…"); shows **elapsed seconds after 10 s**; a `status` with `seconds` (provider retry wait) shows that wait. Works in the small-tile layout too. The answer text and the dashboard changes arrive together with the `result` event (the server does not stream answer text token by token).
- **D-08 Cancel:** the question **stays in the conversation** with a muted note **"Cancelled, nothing changed"**, and the **ask box is refilled with the question text** so it can be edited and re-asked. Cancel must also release the server lock and cancel any running Kinetica job (W1).
- **D-09 Errors (provider error, daily quota, per-hour/day caps, timeout, AI_BUSY):** **toast + inline note** — a toast pops AND the AI's reply to that question shows the plain user-facing message (reuse the server's exact `AI_USER_MESSAGES` text). Dashboard unchanged. A Retry affordance where retrying could help is Claude's discretion (never for daily-quota/cap messages).
- **D-10 Busy state (all AI widgets on the dashboard):** the ask box stays typeable for a draft but cannot send; **the Send button becomes Cancel**. Every AI widget shows the same running state (one answer at a time per user — server lock already exists).

### Choices & follow-ups
- **D-11 Clicking a choice** (remove-saved Yes/No, which map, an ambiguous-question choice) shows the choice text **as the user's reply bubble**, then the AI continues as a **new turn** (revert works per turn). For remove-saved "Yes", the request carries `approvals.removeSaved: true` and the store's `approveRemoval()` remembers it for the conversation.
- **D-12 Typing instead of clicking:** allowed. Typing is a normal new question; the pending choice buttons go inactive; the typed text goes with the conversation so the AI can treat it as the answer.
- **D-13 Follow-up click:** **asks it immediately** ("clicking one asks it", AIWID-V20-03).
- **D-14 Old buttons:** past clarification choices are **greyed out with the picked one ticked** (cannot be answered twice); **follow-ups on every answer stay clickable** (each answer shows them, per requirement). Clicking a follow-up on an older answer while reverted follows 134 D-03 (later turns dropped).

### Keep/Discard bar & highlights
- **D-15 Bar placement:** a **full-width bar under the dashboard header**, replacing today's plain `config-hint` notice. Text like "Unsaved AI changes: 3 added · 2 edited · 1 removed" with **[Keep] [Discard]** (`btn-primary btn-sm` + `ghost-sm` in `ds-actions`). Visible regardless of where the AI widget is or its size. Still explains that editing is locked.
- **D-16 Keep before Phase 141:** **visible but disabled**, tooltip "Saving AI changes is coming soon". Discard works fully now. 141 only enables Keep (and must call the store `reset()` so removal approval clears — 136 verification note).
- **D-17 Discard confirm:** **yes** — a portalled confirm "Discard all AI changes?" reusing the existing confirm-dialog pattern (`AiLeaveDialog` / `modal-overlay` / `modal-content`). Discard clears the conversation and every AI change.
- **D-18 Highlights:** the "AI added"/"AI edited" pills stay until Keep/Discard; **widgets (and layers' map widgets) changed by the latest answer also get an accent outline that fades after ~3 s**. Tokens only (`var(--accent)` / `color-mix`), no hex, no rgba overlays; light and dark checked by the operator.
- **D-19 Removed items:** the bar shows a **"N removed" count; hovering it lists the removed names**; the AI's answer text also says what it removed. Revert brings them back. Counts cover widgets and layers (added / edited / removed).

### Claude's Discretion
- SSE client implementation (fetch + reader over POST), request assembly (snapshot, history, approvals) from `packages/shared/src/aiAsk.ts`, and wiring `result.ops` into `applyTurn`.
- Widget type registration (`ai` / "AI Assistant" chart definition), how the small-tile one-line result is worded, drawer details (portalled, full-screen below a narrow breakpoint).
- How `skipped` items are shown in an answer (plain wording, after the shape-key fix).
- Retry button rules (D-09), exact elapsed-time format, fade timing.
- S2 nginx change and verification method; W1 deadline value and job-cancel mechanics.
- Starter-question templates and how many columns they inspect.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — AIWID-V20-01..07, AISES-V20-04, AIGOV-V20-01 (exact wording; do not narrow it — see memory "don't reinterpret explicit requirement wording")
- `.planning/ROADMAP.md` § Phase 137 — goal, 5 success criteria, W1 carry-forward
- `.planning/research/SUMMARY.md` — milestone research (session layer, SSE, pitfalls)

### Prior phase decisions
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-CONTEXT.md` — D-11 S2 deferral (nginx)
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md` — S2 SSE-over-POST result, expected nginx change
- `.planning/phases/134-session-layer-engine-client-no-llm/134-CONTEXT.md` — D-01..D-17 history, lock, leave warning
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-CONTEXT.md` — D-03 no-access notice, caps, messages
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-VERIFICATION.md` — W1
- `.planning/phases/136-structural-edit-ops/136-CONTEXT.md` — D-05 AI-edited flag, removal confirmation, choose_map
- `.planning/phases/136-structural-edit-ops/136-VERIFICATION.md` — shape-key defect (fix first), S6 staleness, Keep must call reset()

### Contract and server
- `packages/shared/src/aiAsk.ts` — ask request schema (snapshot, history, `approvals.removeSaved`), clarification options
- `packages/shared/src/aiOp.ts`, `packages/shared/src/aiCatalog.ts` — op contract and positive config catalogue
- `packages/server/src/aiRoutes.ts` — SSE events: `status {phase,label,seconds?}`, `step {n,tool,label}`, `result {answerId,text,ops,skipped,clarifications}`, `error {code,message}`
- `packages/server/src/lib/ai/agentLoop.ts` — `AI_USER_MESSAGES` (exact user-facing texts), repair counters (shape-key fix)
- `docker/nginx.conf` — S2 streaming change

### Client
- `packages/web/src/store/aiSessionStore.ts` — turns, cursor, `approveRemoval`, `reset`, derived counts
- `packages/web/src/lib/aiSession/devHarness.ts` — how ops are driven today (the widget replaces this as the driver)
- `packages/web/src/hooks/useAiEditLock.ts` — lock source
- `packages/web/src/components/AiLeaveDialog.tsx` — portalled confirm pattern to reuse for Discard
- `packages/web/src/components/Toast.tsx` — toast for D-09
- `packages/web/src/components/DashboardsPage.tsx` (~L1493 `config-hint` lock notice to replace with the bar)
- `packages/web/src/styles/global.css` — reuse classes (`btn-primary btn-sm`, `ghost-sm`, `ds-actions`, `widget-filter-badge`, `modal-*`)
- `CLAUDE.md` — UI conventions, verifiable acceptance criteria, test gates

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `aiSessionStore` (op-log + fold, negative temp ids, `applyTurn`, `setCursor`, `discard`, `approveRemoval`, `removalApproved`, `derived.addedWidgets`, `aiEditedWidgetIds`): the widget is a new UI over it.
- `AiLeaveDialog`: portalled modal pattern for the Discard confirm.
- `Toast`: error toasts.
- Chart-type registry (`components/charts/definitions/*.ts`, `registerChartType`): register the AI widget type like `info-card` (no SQL, no drill).
- `useAiEditLock` / `LOCK_TOOLTIP`: the bar replaces the plain notice but keeps the lock semantics.
- `widget-filter-badge`: existing AI pills.

### Established Patterns
- No design-system components; plain elements with `global.css` classes; tokens only (theme-guard catches hex, not rgba — use `color-mix`).
- Modals inside widgets must portal (grid transforms trap `position:fixed`; StrictMode double-effect steals autoFocus).
- Adding the widget behind `ai:use` touches permission-gated add-widget UI; check RBAC spec ripples.
- `apiFetch` adds `credentials: "include"`; SSE over POST needs a fetch reader, not `EventSource`.

### Integration Points
- DashboardsPage: add-widget menu (gate on `ai:use`), grid rendering of the AI widget, header bar (D-15), harness install stays DEV-only.
- `/api/auth/me` permission exposure for `ai:use` (135).
- Server `aiRoutes.ts` lock + deadline (W1), Kinetica job cancel on abort.

</code_context>

<specifics>
## Specific Ideas

- Starter questions must cost nothing: templates only, no AI call (free tier is 20 requests/day/model).
- Bar copy example: "Unsaved AI changes: 3 added · 2 edited · 1 removed  [Keep] [Discard]".
- Cancelled turn: "Cancelled, nothing changed", question text back in the ask box.
- Operator visual check (light AND dark): chat bubbles, status line, choice buttons, pills, fading outline, bar, drawer on a small tile and on a narrow window.

</specifics>

<deferred>
## Deferred Ideas

- Re-run the S6 Gemini tool-calling spike against the 12-tool set (stale since 136) — before/at Phase 142 live UAT.
- 136 minor notes: radio capture now skips every `""` value (intentionally empty labels can't be captured); `opSlot` duplicated between agentLoop and gateway.

</deferred>

---

*Phase: 137-ai-widget-streaming-ui*
*Context gathered: 2026-10-14*
