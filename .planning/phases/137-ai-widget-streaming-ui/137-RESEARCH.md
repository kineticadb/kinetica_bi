# Phase 137: AI Widget & Streaming UI - Research

**Researched:** 2026-10-14
**Domain:** SSE-over-POST client in React 19-era SPA (zustand), AI chat widget on a react-grid-layout dashboard, Express route lock/deadline hardening, nginx streaming, Kinetica job cancel
**Confidence:** HIGH for repo facts, nginx behaviour (measured locally) and W1/shape-key mechanics; MEDIUM for follow-up/ambiguity contract (design recommendation, live-provider behaviour unverifiable until 142)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(Copied from 137-CONTEXT.md `## Implementation Decisions`. Planner MUST honor.)

**Already locked by earlier phases (do not re-ask)**
- Presentation follows tile size; no Compact/Full setting. Large tile = inline chat; small tile = ask bar + history icon + one-line result of the last answer, full conversation in a portalled drawer (full-screen on narrow screens). (AIWID-V20-01, 134 discussion)
- One shared conversation per dashboard per user; several AI widgets show the same conversation (134 D-05). History is in memory only; Keep/Discard/reload clear it (134 D-04).
- Revert to any turn restores it as one unit; forward again possible; asking from a reverted cursor drops later turns (134 D-02/D-03).
- Editing locked while AI changes are unsaved; leave warning (portalled) + `beforeunload` (134 D-07/D-08/D-15). Op-less turns do not lock (134 D-17).
- User without `ai:use` sees the widget as a read-only notice "You don't have access to the AI assistant", no ask box, layout unchanged; server refuses regardless (135 D-03). This phase also gates **adding** the widget on `ai:use`.
- A failed/rejected/cancelled answer applies zero ops (135 atomic buffered ops).
- Removing saved content asks once per conversation (136 D-06; `approvals.removeSaved` / `approveRemoval()`); a heatmap with several candidate maps asks which map (`choose_map`, 136 D-11). This phase builds the clickable buttons.
- "AI added" / "AI edited" pills exist (`widget-filter-badge`, 136).

**Chat look & empty state**
- **D-01 Empty state:** a one-line hint ("Ask about this dashboard's data") plus **2-3 clickable starter questions built from fixed templates filled from the dashboard tables' column names/types** (e.g. "Show total `<numeric>` by `<category>`", "Add a heatmap of `<table>`" when lat/lon exist). Built locally: **no provider call, no quota used**. Clicking a starter asks it.
- **D-02 Small-tile threshold (fixed grid size):** the widget uses the small ask-bar + drawer layout when it is **under 12 columns wide OR under 24 rows tall** (grid is 36 columns). Otherwise inline chat.
- **D-03 Default size of a newly added AI widget:** **12 cols x 40 rows** (inline chat from the start).
- **D-04 Chat style:** chat bubbles, **newest at the bottom**, auto-scroll to latest. User question right-aligned; AI answer left-aligned with its follow-ups and the "Revert dashboard to this state" button underneath.
- **D-05 Ask box:** at the **bottom**; single line that grows to a few lines; **Enter sends, Shift+Enter new line**; Send button beside it.
- **D-06 Header:** the normal widget title bar only (like every other widget); no extra conversation controls (Discard lives in the Keep/Discard bar).

**Progress & cancel**
- **D-07 Progress:** **one live status line + spinner**, replaced as each server `step`/`status` event arrives (e.g. "Adding a bar chart..."); shows **elapsed seconds after 10 s**; a `status` with `seconds` (provider retry wait) shows that wait. Works in the small-tile layout too. The answer text and the dashboard changes arrive together with the `result` event (the server does not stream answer text token by token).
- **D-08 Cancel:** the question **stays in the conversation** with a muted note **"Cancelled, nothing changed"**, and the **ask box is refilled with the question text** so it can be edited and re-asked. Cancel must also release the server lock and cancel any running Kinetica job (W1).
- **D-09 Errors (provider error, daily quota, per-hour/day caps, timeout, AI_BUSY):** **toast + inline note** - a toast pops AND the AI's reply to that question shows the plain user-facing message (reuse the server's exact `AI_USER_MESSAGES` text). Dashboard unchanged. A Retry affordance where retrying could help is Claude's discretion (never for daily-quota/cap messages).
- **D-10 Busy state (all AI widgets on the dashboard):** the ask box stays typeable for a draft but cannot send; **the Send button becomes Cancel**. Every AI widget shows the same running state (one answer at a time per user - server lock already exists).

**Choices & follow-ups**
- **D-11 Clicking a choice** (remove-saved Yes/No, which map, an ambiguous-question choice) shows the choice text **as the user's reply bubble**, then the AI continues as a **new turn** (revert works per turn). For remove-saved "Yes", the request carries `approvals.removeSaved: true` and the store's `approveRemoval()` remembers it for the conversation.
- **D-12 Typing instead of clicking:** allowed. Typing is a normal new question; the pending choice buttons go inactive; the typed text goes with the conversation so the AI can treat it as the answer.
- **D-13 Follow-up click:** **asks it immediately** ("clicking one asks it", AIWID-V20-03).
- **D-14 Old buttons:** past clarification choices are **greyed out with the picked one ticked** (cannot be answered twice); **follow-ups on every answer stay clickable** (each answer shows them, per requirement). Clicking a follow-up on an older answer while reverted follows 134 D-03 (later turns dropped).

**Keep/Discard bar & highlights**
- **D-15 Bar placement:** a **full-width bar under the dashboard header**, replacing today's plain `config-hint` notice. Text like "Unsaved AI changes: 3 added · 2 edited · 1 removed" with **[Keep] [Discard]** (`btn-primary btn-sm` + `ghost-sm` in `ds-actions`). Visible regardless of where the AI widget is or its size. Still explains that editing is locked.
- **D-16 Keep before Phase 141:** **visible but disabled**, tooltip "Saving AI changes is coming soon". Discard works fully now. 141 only enables Keep (and must call the store `reset()` so removal approval clears - 136 verification note).
- **D-17 Discard confirm:** **yes** - a portalled confirm "Discard all AI changes?" reusing the existing confirm-dialog pattern (`AiLeaveDialog` / `modal-overlay` / `modal-content`). Discard clears the conversation and every AI change.
- **D-18 Highlights:** the "AI added"/"AI edited" pills stay until Keep/Discard; **widgets (and layers' map widgets) changed by the latest answer also get an accent outline that fades after ~3 s**. Tokens only (`var(--accent)` / `color-mix`), no hex, no rgba overlays; light and dark checked by the operator.
- **D-19 Removed items:** the bar shows a **"N removed" count; hovering it lists the removed names**; the AI's answer text also says what it removed. Revert brings them back. Counts cover widgets and layers (added / edited / removed).

### Claude's Discretion
- SSE client implementation (fetch + reader over POST), request assembly (snapshot, history, approvals) from `packages/shared/src/aiAsk.ts`, and wiring `result.ops` into `applyTurn`.
- Widget type registration (`ai` / "AI Assistant" chart definition), how the small-tile one-line result is worded, drawer details (portalled, full-screen below a narrow breakpoint).
- How `skipped` items are shown in an answer (plain wording, after the shape-key fix).
- Retry button rules (D-09), exact elapsed-time format, fade timing.
- S2 nginx change and verification method; W1 deadline value and job-cancel mechanics.
- Starter-question templates and how many columns they inspect.

In scope carry-forward (technical, Claude's discretion on approach): S2 deploy-proxy streaming; W1 (route-level hard deadline, abort for Kinetica probes, Kinetica job tag/find/cancel on user Cancel); **136 shape-key defect (fix first; red-first spec; must land before this phase shows `skipped`)**.

### Deferred Ideas (OUT OF SCOPE)
- Re-run the S6 Gemini tool-calling spike against the 12-tool set (stale since 136) - before/at Phase 142 live UAT.
- 136 minor notes: radio capture now skips every `""` value; `opSlot` duplicated between agentLoop and gateway.
- Out of scope phases: saving (Keep persistence) 141; filters 138; dynamic views 139; query tools 140; generate + audit viewer + live Gemini/Ollama UAT 142.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AIWID-V20-01 | Designer can add an AI widget; size-driven inline vs drawer | `ai` ChartTypeDefinition + WidgetRenderer branch + 2 NON_TRIGGER sets; add path special-cased to 12x40 (handleAddVisualization hardcodes 18x24); D-02 read from `widget.config.layout`; portalled drawer; gate on `ai:use` in `getVisualizationTypes` + server create guard |
| AIWID-V20-02 | Ask in widget, dashboard changes, full chat kept, all AI widgets share it | Store-level conversation (`aiSessionStore.turns`) + new `run` slice; snapshot from DashboardContext effective widgets; fetch+reader SSE client; result.ops -> `applyTurn` |
| AIWID-V20-03 | Full answer text, 2-3 clickable follow-ups, per-answer Revert | Revert = `setCursor(index)`; **follow-ups are NOT produced by the server today -> contract change** (Section "Contract gaps") |
| AIWID-V20-04 | Progress + cancel; one answer at a time | `status`/`step` events; AbortController -> `res.on("close")` -> abort; server lock + W1 hard deadline; Kinetica job tag/cancel |
| AIWID-V20-05 | Ambiguity -> 2-3 clickable choices | Existing `confirm_remove`, `choose_map` clarifications; **generic ambiguity kind does NOT exist -> contract change** |
| AIWID-V20-06 | Added/changed widgets and layers highlighted | Existing pills + new fading `widget-card--ai-changed` outline (color-mix) driven by latest-turn changed-widget ids |
| AIWID-V20-07 | Clear message on fail/cap/rate-limit, dashboard unchanged | SSE `error {code,message}` + pre-stream JSON errors (409/429/503/413/400/404); atomic zero-op guarantee already server-side |
| AISES-V20-04 | Unsaved-changes indicator with counts, Keep + Discard | Bar under header from `derived` counts (widgets + layers); Discard via portalled confirm; Keep disabled |
| AIGOV-V20-01 | "Use AI" permission; cannot use or add the widget; server refuses | `PERMISSIONS.AI_USE` already in web; hide picker entry + read-only notice; **add server guard on `POST /dashboards/:id/widgets` for type `ai`** (today any type is accepted) |
</phase_requirements>

## Summary

The server side of `POST /api/ai/ask` is complete and well-tested; this phase is the first real client plus four server-side hardening items. Key repo facts verified by reading code: the request field is **`turns`** (not `history`) with `{question, answer<=8000, changes[{label,status,reason?}]<=30}` per turn, max 50 turns, whole body <= 65,536 bytes; `approvals: {removeSaved: boolean}`; snapshot is structure only. SSE events are `status`, `step`, `result` (only on outcome ok, once), `error`, `done`, plus `: ping` comment frames every 15 s. Pre-stream failures are plain JSON (401, 403, 400 `AI_BAD_REQUEST`, 404, 409 `AI_BUSY`, 413, 429 with `{code,message,retryAfterSeconds}`, 503 `AI_NOT_CONFIGURED`). The route already sets `X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`, calls `flushHeaders()`, and aborts on the **response's** `close`.

**S2 finding (measured, HIGH):** I ran the current `docker/nginx.conf` semantics (gzip on, no `proxy_buffering off`) through the local nginx 1.27.2 (same minor as the `nginx:1.27-alpine` image) against a tiny SSE server on loopback ports (no containers). With the server's `X-Accel-Buffering: no` header the stream ALREADY arrives incrementally (551/1050/1551/2051 ms); without that header it is fully buffered (single chunk at 2057 ms); with the proposed exact-match location block it streams either way; `text/event-stream` is not gzipped. So the nginx change is defense-in-depth (non-nginx-aware ingress, header stripping), not the thing that makes it work today. A text-level spec plus an optional `nginx -t` check can verify it with no Kinetica and no container.

**W1:** the loop already has a deadline (`AI_TIMEOUT_MS`, default 60 s, max 600 s) but it only aborts *awaited provider IO*; `kineticaSql` takes no signal, the pre-loop `liveSchema.describe` probes in `runAnswer` run before the deadline exists, and `inflight.delete(key)` is only reached after `await runAnswer(...)`. A hung Kinetica holds `AI_BUSY` for undici's ~300 s. Fix = route-level `Promise.race` hard deadline (timeoutMs + grace) that always releases the lock, plus an optional `signal` on `kineticaSql`, plus a tag/find/cancel helper (none exists in production code; only the 133 S7 spike script).

**Two contract gaps the planner must surface:** (1) follow-ups (AIWID-V20-03) and (2) generic ambiguity choices (AIWID-V20-05) are not produced by the server. `result` has only `{answerId,text,ops,skipped,clarifications}`, `AiClarificationSchema.kind` is `confirm_remove | choose_map`, and no prompt/tool asks the model for follow-ups. Also the result carries no `applied` labels, which the client needs to fill `turns[].changes` for history. All three are additive changes to `result` and the shared schema.

**Primary recommendation:** Sequence as server hardening first (shape-key fix -> W1/Kinetica -> contract additions), nginx in parallel, then the web engine (SSE client, request builder, store extension, runner), then widget UI and Keep/Discard bar in parallel on disjoint files, then an operator light/dark human-verify checkpoint and hand bookkeeping.

## Standard Stack

No new runtime dependency is needed. Everything below is already in the repo.

### Core
| Library | Version (repo) | Purpose | Why |
|---------|----------------|---------|-----|
| zustand | existing (store/*) | `aiSessionStore` extension, run state | Project standard; `vi.mock("zustand")` reset shim covers `src/store/` |
| fetch + `ReadableStream.getReader()` | platform | SSE over POST client | `EventSource` cannot POST (133 S2 decision) |
| react-dom `createPortal` | existing | Drawer + Discard confirm | Grid transforms trap `position:fixed` (memory: widget-modals-must-portal) |
| react-grid-layout | existing | widget w/h source (`config.layout`) | Already the layout engine; 36 cols, rowHeight 5 |
| zod (`@kinetica-bi/shared`) | existing | `AskRequestSchema`, new result-event schema | Contract single source of truth |
| vitest + @testing-library/react | ^4.1.5 / ^16.3.2 | web specs | Existing |
| nginx | 1.27 (image `nginx:1.27-alpine`; local 1.27.2 present) | deploy proxy | Existing Dockerfile |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| hand-written fetch reader | `@microsoft/fetch-event-source` | New dependency for ~60 lines; it also auto-retries/reconnects, which is WRONG for a non-idempotent POST that spends quota. Do not add. |
| New `aiAskStore` | run slice in `aiSessionStore` | A 15th store needs wiring into both cleanup chains (App.tsx UNAUTHORIZED + DashboardsPage switch). `reset()` is already wired in both; put the run slice in the existing store. |

**Installation:** none. **Version verification:** no packages added (nothing to `npm view`).

## Architecture Patterns

### Recommended structure (new/changed files)
```
packages/shared/src/aiAsk.ts                   # + AiResultEventSchema {followUps?, applied?}, clarification kind "choose_option"
packages/server/src/aiRoutes.ts                # W1 hard deadline; keep headers
packages/server/src/lib/ai/{agentLoop,gateway,runAnswer,liveSchema,context}.ts
packages/server/src/lib/kineticaJobs.ts        # NEW: tagSql, cancelKineticaJobsByTag (admin show/alter jobs)
packages/server/src/kinetica.ts                # + optional `signal` and `tag` in KineticaSqlOptions
docker/nginx.conf                              # + exact-match location for /api/ai/ask
packages/web/src/lib/aiSession/askStream.ts    # NEW: SSE parser + postAsk()
packages/web/src/lib/aiSession/buildAskRequest.ts   # NEW: snapshot + turns + approvals (pure)
packages/web/src/lib/aiSession/askRunner.ts    # NEW: runAsk()/cancelAsk(): owns AbortController + store transitions
packages/web/src/lib/aiSession/starterQuestions.ts  # NEW: D-01 templates (pure)
packages/web/src/lib/aiSession/changeCounts.ts # NEW: D-15/D-19 counts + removed names (pure)
packages/web/src/store/aiSessionStore.ts       # Turn.chat meta + run slice + epoch
packages/web/src/components/charts/definitions/ai.ts + AiWidgetRenderer.tsx (+ AiChat, AiDrawer, AiWidget.css)
packages/web/src/components/AiChangeBar.tsx    # NEW: D-15 bar (+ AiDiscardDialog, portalled)
```

### Pattern 1: SSE client (fetch + reader), no EventSource
**What:** POST JSON with `credentials:"include"`, check `response.ok` BEFORE reading (pre-stream errors are JSON), then parse frames incrementally. Port `parseSseStream` from `packages/server/src/lib/ai/sseParse.ts` (WHATWG field rules, handles split chunks and lone trailing `\r`; ignores `:` comments, which swallows the heartbeat). Keep it web-local (smaller blast radius than moving to shared).
`apiFetch` in `api/client.ts` is a non-exported `const`; add an exported `askAi(body, signal)` in `client.ts` (or export `apiFetch`) so the 401 `REAUTH_REQUIRED` -> `UNAUTHORIZED_EVENT` handling and 403 `PERMISSION_DENIED` toast keep working. Use the response only after those peeks (they `clone()`).
```typescript
// Source: packages/server/src/aiRoutes.ts + sseParse.ts (read 2026-10-14); pattern for the web copy
export type AskEvent =
  | { event: "status"; data: { phase: "thinking" | "tool" | "waiting_provider"; label: string; seconds?: number } }
  | { event: "step"; data: { n: number; tool: string; label: string } }
  | { event: "result"; data: { answerId: number; text: string; ops: unknown[]; skipped: SkippedDto[]; clarifications: AiClarification[]; followUps?: string[]; applied?: string[] } }
  | { event: "error"; data: { code: string; message: string } }
  | { event: "done"; data: { answerId: number; outcome: string; steps: number } };

export async function* streamAsk(body: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  const res = await askAi(body, signal);               // apiFetch wrapper, method POST, JSON
  if (!res.ok) throw await toAskHttpError(res);        // {status, code, message, retryAfterSeconds?}
  for await (const ev of parseSseStream(res.body!, signal)) yield { event: ev.event ?? "message", data: JSON.parse(ev.data) } as AskEvent;
}
```
Rules the runner must enforce: apply ops ONLY from `result` (atomic); if the stream ends with neither `result` nor `error` (proxy cut, server restart) treat as error "Lost connection; nothing was changed" and apply nothing; a user abort must NOT show a toast; ignore a result that arrives after Cancel (`signal.aborted`) or after a store `epoch` change (Discard/dashboard switch while running).

### Pattern 2: Request assembly (`buildAskRequest`, pure)
- `snapshot.widgets`: from the **effective** widgets (saved + session, i.e. what the user sees at the cursor: `applySessionToWidgets`), with `layout` from `config.layout` overridden by `derived.layout` / session geometry (same precedence as the `layouts` memo in DashboardsPage). Negative temp ids are allowed by `SnapId`. `binding` only the closed key set. `type` for the AI widget itself is `"ai"` (see Pitfall 6: INCLUDE it).
- `snapshot.layers`: effective layers (`useEffectiveLayers`); `dynamicViews`: `{id,name}`; `filters`: `[]` is valid and safe for 137 (filter snapshot is 138's concern; if cheaply available send `{source,column,op}` only, never values).
- `turns`: kept turns `slice(0, cursor+1)` filtered to `chat.status === "ok"` (cancelled/error turns are not history). Per turn `{question: prompt, answer, changes}` where `changes` = applied entries (labels from `result.applied`, else derived client-side) + skipped (`label`, `reason` = first reason, truncated to 200). Cap 30 changes.
- **Size cap trap:** `AskTurnSchema.answer` <= 8000 chars x up to 50 turns can exceed `ASK_REQUEST_MAX_BYTES` (65,536) -> 413. The server only uses the last `historyTurns` (default 6, env `AI_HISTORY_TURNS` 1-20, not exposed to the client) turns' answers in full; older turns contribute only `changes` labels (`summarizeEarlierTurns`). So: send the last 8 turns with answers (truncate each to ~1500 chars), older turns with `answer: ""`, then loop dropping oldest turns until `JSON.stringify(body)` bytes < 60,000. Spec this with a worst-case fixture.
- `question` max 2000 -> `maxLength={2000}` on the ask box. `approvals: store.removalApproved ? { removeSaved: true } : undefined` (omit when false; the schema accepts either).
- **Clarification answers have no structured field** (`AskRequestSchema` is strict). A clicked choice is sent as plain `question` text. For `choose_map`, option ids are widget ids and labels are titles: send `Use the map "<title>" (widget <id>)` so the model resolves it from the snapshot. For `confirm_remove` Yes: `question: "Yes, remove it"` + `approvals.removeSaved = true` (call `approveRemoval()` first). No: `"No, keep it"`.

### Pattern 3: Store shape change (needed)
`Turn` today is `{id, prompt, answer, entries, createdAt}`; `TurnInput` is `{prompt, answer?, ops}`. Nothing holds follow-ups, clarifications, skipped, answerId, error/cancel status, or the picked choice. Extend additively:
```typescript
export type TurnChat = {
  status: "ok" | "error" | "cancelled";
  answerId?: number;
  followUps?: string[];
  clarifications?: AiClarification[];
  pickedChoice?: { clarificationIndex: number; optionId: string }; // D-14 greyed + ticked (set by the NEXT turn's runner)
  skipped?: { label: string; stage: string; reasons: string[] }[];
  errorCode?: string; message?: string;                            // D-09 inline note
};
// Turn gets `chat?: TurnChat`; TurnInput gets `chat?: TurnChat`.
```
Error and cancelled questions are recorded as turns with `entries: []` and `chat.status !== "ok"` via `applyTurn` (zero ops -> no lock, D-17). They occupy a cursor index; Revert on the previous ok answer simply drops them on next ask (134 D-03). They are excluded from `turns` history sent to the server. Add to the store a `run` slice `{ status:"idle"|"running", question, startedAt, line, seconds? } ` and `epoch` (bumped by `reset()`); `reset()` already runs on Discard, dashboard switch, leave and 401, so a late `result` compares epochs and is dropped. The AbortController lives in `askRunner` module scope; DashboardsPage unmount cleanup calls `cancelAsk()` (idempotent; StrictMode's synthetic unmount happens before any user ask so it cannot abort a real one). `useAiSessionActions` is the existing baseline-bound entry and already comments "shared by the dev harness and the AI widget (137)".

**Where the widget gets baseline/snapshot:** the baseline lives in `DashboardOpen` (`aiBaselineRef`), the widget is deep in `WidgetRenderer`. Extend `DashboardContextValue` with an optional `ai?: { getBaseline(): SessionBaseline; getSnapshot(): AskRequest["snapshot"]; savedWidgets... }` (optional so the many existing specs that mount a 4-prop provider keep working; missing -> widget shows a harmless "unavailable" state). `DashboardContext.widgets` is already `effectiveWidgets`.

### Pattern 4: Widget registration + render
`ai.ts` definition modelled on `radio-group.ts`/`info-card.ts`: `{type:"ai", label:"AI Assistant", icon:"AI", fields:[], defaultConfig:{}, usesAggregation:false, usesDataSource:false, supportsDrillDown:false}` (include `usesDataSource:false`; `info-card` omits it, `radio-group` sets it). Register in `definitions/index.ts`. Add a branch in `WidgetRenderer` BEFORE the `AggregatedWidgetRenderer` fallback (`else if (effectiveWidget.type === "ai") body = <AiWidgetRenderer .../>`). **Add `"ai"` to BOTH `NON_TRIGGER_TYPES` sets** (`hooks/useCombinationOrchestrator.ts:~83` and `lib/useReverseFilterMap.ts:~35`; they must mirror exactly, a mismatch is a known past bug) and keep it OUT of `FILTER_PRODUCING_TYPES`. `ai` must NOT be added to `AI_WIDGET_TYPES` in `aiAsk.ts` (that list is what the AI may create).
Add path: `handleAddVisualization(type)` hardcodes `layout:{x:0,y:nextY,w:18,h:24}` and `title: chartDef.label`. Special-case `type === "ai"` -> `w:12,h:40` (D-03). Put the size in one exported constant (e.g. `AI_ASSISTANT_DEFAULT_SIZE = {w:12,h:40}` in `lib/aiSession/constants.ts`); do NOT put `ai` into shared `AI_DEFAULT_SIZE` (typed `Record<AiWidgetType,...>`, would break the type and let the AI "place" it). `getVisualizationTypes()` is a module-level function: filter `ai` out unless `hasPermission(PERMISSIONS.AI_USE)` (pass a flag in). Also hide it when `GET /api/ai/config` says `{enabled:false}` (add a `getAiConfig()` client call; reading it is requireAuth-only and returns no secrets) and show a read-only "AI isn't set up" state in an existing widget.
**Duplicate:** `handleDuplicateWidget` copies any widget; gate duplicating an `ai` widget on `ai:use` too (several AI widgets are allowed, D-05 of 134).

### Pattern 5: D-02 size threshold
`WidgetCard` does not pass w/h. The widget's `widget.config.layout.{w,h}` (36-column coordinates, kept current by `handleLayoutChange` -> `setWidgets` whenever not AI-locked) is the "fixed grid size" D-02 specifies. Use `const {w,h} = resolveRect(widget.config?.layout, 0)` -> `small = w < 12 || h < 24`. Do not measure pixels, and do not rely on RGL's live item, because `cols` shrinks at narrow breakpoints (`sm:18, xs:12, xxs:6`) and would misclassify. Note while AI changes are unsaved ALL saved widgets are `static` (cannot resize), so the AI widget keeps its size during a session. The drawer goes full-screen below a narrow breakpoint; the repo uses `matchMedia("(max-width: 900px)")` (DashboardsPage ~L959) - reuse 900px or define one constant. jsdom has no `matchMedia`; specs that need it stub it (see DashboardsPage.aiSession.spec).

### Pattern 6: Fading accent outline (D-18) - token-only
Do not reuse `useFilterHighlightStore.flash` (1 s, shared with filter hover/flash, different semantics). Add a modifier next to `.widget-card--flashing` in `global.css`:
```css
/* Source: pattern of .widget-card--flashing (global.css ~L685); tokens only, color-mix not rgba */
.widget-card--ai-changed { animation: widget-ai-fade 3s ease-out 1 forwards; }
@keyframes widget-ai-fade {
  0%   { box-shadow: 0 0 0 2px var(--accent), var(--shadow); }
  100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 0%, transparent), var(--shadow); }
}
@media (prefers-reduced-motion: reduce) {
  .widget-card--ai-changed { animation: none; box-shadow: 0 0 0 2px var(--accent), var(--shadow); } /* steady; removed by timer */
}
```
State: `aiSessionStore.highlight: { ids: number[]; nonce: number }` set by the runner after `applyTurn` from the new entries (changed widget ids: add_widget tempId, patch/remove/change_type/set_title widget id, set_layout item ids, add_layer/patch layer -> owning `widgetId` via layers list). `WidgetCard` mirrors the existing flash effect (state on nonce, `setTimeout` ~3000 ms to clear class, restart via forced reflow). Clear `highlight` in `reset()`. Reduced-motion branch: the class is removed by the same timer, so the outline is steady then disappears. Light/dark legibility is NOT automatically verifiable (see Validation).

### Pattern 7: Bar (D-15..D-19)
Render inside `DashboardOpen` return, directly after the header and before `{error && ...}`; it must appear regardless of `topbarSlotEl` portal mode (the header can be portalled, so do not nest the bar in `dashboardHeader`). Show when `selectHasUnsavedAiChanges` (lock source), not when counts > 0: at cursor -1 counts are 0 while editing stays locked (Pitfall 5 in store) -> text "Unsaved AI changes: none shown at this point. Editing is locked until they are kept or discarded." Counts from `derived` (widgets + layers summed): added = `addedWidgets.length + addedLayers.length`; edited = `aiEditedWidgetIds.size + aiEditedLayerIds.size`; removed = `removedWidgetIds.size + removedLayerIds.size`. Removed names: look up ids in saved `widgets` (title) and `savedLayers` (name/title), shown via native `title=` (repo convention: "no popover component exists", see `.widget-filter-badge` comment). **Keep the phrase "editing is locked"** in the bar text: `DashboardsPage.aiLock.spec.tsx:268-273` asserts `/editing is locked/i` on a `role="status"` element; either keep that or update that spec in the same plan. Buttons: `<div className="ds-actions"><button className="btn-primary btn-sm" disabled title="Saving AI changes is coming soon">Keep</button><button className="ghost-sm" ...>Discard</button></div>`. Discard confirm: new portalled `AiDiscardDialog` cloned from `AiLeaveDialog` (focus the safe button inside the same effect, not `autoFocus`+cleanup; render under `<StrictMode>` in one spec); on confirm call `cancelAsk()` then `reset()`. Note `AiLeaveDialog` is mounted once in App.tsx and driven by `pendingLeave`; Discard needs its own state (do not overload `pendingLeave`).

### Pattern 8: Chat UI details
- Plain text only: answers are untrusted model output ("no markdown, no links"); render in a `<div>` with `white-space: pre-wrap`; never `dangerouslySetInnerHTML`. Follow-up and choice labels likewise as text.
- Auto-scroll: `ref.scrollTop = scrollHeight` in an effect on turns/run changes; respect user scrolled-up (optional).
- Elapsed seconds after 10 s: a 1 s `setInterval` effect keyed on `run.startedAt`; with fake timers in specs rely on the global `useRealTimers` afterEach (memory: web-vitest-parallel-faketimer-leak).
- Friendly status labels: `status.label` is `Thinking...`, the raw tool name for reads (`get_dashboard`, `list_tables`, `describe_table`), and for mutate steps the gateway label (`Added bar "X" below existing content`) or raw tool name on rejects. Map known tool names to friendly present-tense text client-side (D-07 example "Adding a bar chart..."), fall back to `label`. `waiting_provider` carries `seconds`.
- Skipped display: `skipped[].label` is a human label for gateway failures (`Add bar "T"`) but the **raw tool name** for shape failures (`add_widget`) and clarification entries; render skipped as a muted "Couldn't do: <label> - <first reason>" list, hide entries with `stage:"clarification"` (they are represented by the choice buttons), and map bare tool names to words.
- Starter questions (D-01): pure template function over `associatedTables[].columns` (`Record<string,string>` name -> type). Numeric types via the existing `isAiNumericColumnType`-style helper (check shared/web equivalent before writing a new one); category = string type; heatmap starter only when lat/lon-like names exist. 0 provider calls. Cap columns inspected (e.g. first 3 tables, 40 columns).
- Ask box: `<textarea rows={1}>` growing to ~4 rows, Enter (no Shift, not `isComposing`) sends; Send button `btn-primary btn-sm`; while running the button becomes Cancel (`ghost-sm`), the textarea stays typeable.
- Busy state is global: all AI widgets read `useAiSessionStore(s => s.run)`.
- Cancel (D-08): runner aborts; records turn `{prompt, chat:{status:"cancelled"}}`; sets a store `draft` string so every widget's ask box refills (put `draft` in the store, not component state, because multiple widgets and the drawer share it). Note a user abort does not reach `result`/`error` events.

### Anti-Patterns to Avoid
- **Starting the ask in an effect.** Asks must come only from click/Enter handlers; StrictMode double-invokes effects and would fire two `POST`s (quota spend, 409 AI_BUSY). Effects only for scroll, timers and subscriptions.
- **EventSource / auto-reconnect.** A reconnect re-POSTs and burns quota.
- **Applying ops from `step` events or partial data.** Only `result.ops`.
- **Reading AI state off `filterViewStore`/legacy stores** (memory: filtering-badges-read-combination-store) - not needed here, but do not add filter badges.
- **Inventing CSS classes.** Reuse `btn-primary btn-sm`, `ghost-sm`, `ghost-danger`, `ds-actions`, `config-hint`, `muted`, `widget-filter-badge`, `modal-overlay/modal-content/modal-header/modal-title/modal-body`, `widget-filtering-spinner` (spinner, 10 px, `filtering-spin`), `toast-*`. There are NO existing chat-bubble, drawer or side-sheet classes: those are new, scoped (`ai-chat-*`, `ai-drawer-*`) in a component-local `AiWidget.css` (precedent `RolesPage.css`), built only from `var(--...)` tokens (`--panel`, `--border`, `--accent`, `--on-accent`, `--muted`, `--text`, `--card`, `--space-*`, `--radius-*`, `--text-*`). User bubble: `background: var(--accent); color: var(--on-accent)` (NOT `--accent-text`, memory: theme-guard-misses-rgba-and-wrong-tokens). AI bubble: `var(--panel)` + `1px solid var(--border)`. No rgba overlays.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE framing | regex split on `\n\n` | Port `parseSseStream` from `server/src/lib/ai/sseParse.ts` | Handles chunk splits, CRLF, lone `\r`, comments, abort |
| Request validation | ad-hoc checks | `AskRequestSchema.safeParse` in a spec on `buildAskRequest` output | Strict schema; a stray key = 400 |
| Op application | custom fold | `useAiSessionStore.applyTurn` (`evaluateTurn`/`foldSession`) | Already handles temp ids, removal approval, layout, overlays |
| Revert/forward | custom history | `setCursor(i, baseline)` | Fold prefix; Discard = `reset()` |
| Portalled confirm | new modal system | `AiLeaveDialog` structure (`createPortal` + `modal-*`) | Grid-transform trap |
| Toast | custom | `useToastStore.getState().showToast(msg, "error")` (store/toast.ts, dedups 5 s same message) | Existing |
| Widget placement | client picks x/y | AI widgets already placed by gateway (`placeWidget`); user-added widget uses `nextY` logic | Existing |
| Kinetica job cancel | polling GAdmin by hand | New small `kineticaJobs.ts` using the S7.6-verified `/admin/show/jobs` + `/admin/alter/jobs` | Verified for non-admin own jobs |
| nginx streaming verification | docker-compose rig | text spec on `docker/nginx.conf` + optional `nginx -t` | See S2 section |

**Key insight:** every hard part (fold, revert, lock, leave-warning, gateway validation, caps, audit) already exists. This phase is wiring and UI; the risks are contract gaps, request-size, StrictMode double requests, CSS that tests cannot see, and the server lock.

## Server-side findings (plan inputs)

### 136 shape-key defect (fix first)
- Code: `agentLoop.ts` mutate-tool failure branch (the `else` after the `clarification` branch): `const key = g.refKey ?? \`${tool.name}:${g.stage}:${g.slot ?? "?"}\`; attemptsByRef.set(key,...); unresolvedBySlot.set(g.slot ?? key, ...)`. Shape failures come from two places in `gateway.checkAiOp`: JSON/zod failure (before the op exists, no `slot`) and `parseAiOp` failure and the empty-patch check. Zod-stage and parse-stage failures have no `slot`, so key = `add_widget:shape:?`. On success the loop deletes only `opSlot(g.op)` (e.g. `new:-3`), so the shape entry stays in `unresolvedBySlot` forever and `attemptsByRef` counts accumulate (Defect B).
- Fix: in the `g.ok` branch also `unresolvedBySlot.delete(\`${tool.name}:shape:?\`)` and `attemptsByRef.delete(\`${tool.name}:shape:?\`)`. (Shape-keyed failures with `refKey` set do not exist; only slotless.) Also give shape failures a human label (server-side map or client-side map of tool name -> words) since `label` is the raw tool name there.
- **Which spec goes red first:** a new `lib.aiAgentLoop.spec.ts` case, e.g. `W2-5 shape failure then repaired leaves skipped empty and ops 1` (script: `turn(call("a","add_widget",{type:"bar"}))` malformed -> `turn(addW("b",-1))` valid -> final). It must read `skipped: [{stage:"shape"}]` before the fix (red), `[]` after. **Existing spec that turns red AFTER the fix and must be updated in the same plan:** `routes.aiAsk.sse.spec.ts` SSE-R2 asserts `r.skipped.map(s=>s.stage)` equals `["shape","allow_list","live_schema","reference"]` where the shape call (a) is followed by a valid `add_widget` (e); after the fix the shape entry is cleared -> `["allow_list","live_schema","reference"]`. Also add a Defect-B case: two *different* malformed `add_widget` calls, the second must get the first-attempt message (no "Do not retry"). Verify the SSE-R2 expectation change is deliberate, not a masked regression.
- Dedupe: `opSlot` (agentLoop) duplicates `slotOf` (gateway). Deferred in CONTEXT; export one from gateway only if trivially safe (otherwise leave).

### W1: lock release, deadline, Kinetica probes, cancel
- Lock: module-global `inflight: Map<lowercased username, AbortController>` in `aiRoutes.ts`; set after admit, deleted only in the `finally` after `await runAnswer(...)`. `res.on("close")` aborts `ac` if `!res.writableEnded` (S2 C4: response close, not request close). The abort reaches provider fetch and the SSE reader and `guard()`; it does NOT reach `kineticaSql`.
- Not abortable today: (1) the pre-loop `for (const t of listDashboardTables(...)) await liveSchema.describe(t.id)` in `runAnswer` (before the loop deadline exists); (2) in-loop read-tool probes and gateway `live_schema` `describe()`; (3) `kineticaSql` itself (`fetch` has no `signal`; undici ~300 s default); (4) a provider/test fake that ignores abort.
- Design (prescriptive): in the route, after `inflight.set`, create `const hard = setTimeout(...)` at `config.timeoutMs + GRACE_MS` (GRACE ~5 s; `AI_TIMEOUT_MS` is 1000-600000, default 60000) that (a) `ac.abort()`, (b) `inflight.delete(key)` only if `inflight.get(key) === ac` (so a later request's lock is never freed by a stale timer), (c) if headers are sent, `sse.send("error", {code:"AI_TIMEOUT"...})` with `AI_USER_MESSAGES.timeout` then `res.end()`, (d) finalize the audit row as `provider_error/timeout` exactly once. Race the work: `fin = await Promise.race([runAnswer(...), hardDeadlinePromise])`; the `finally` must be idempotent (finalize once; `inflight.delete` guarded by identity). Make the deadline start BEFORE the pre-loop describes (it does, since it is in the route). Test with a never-settling provider and a never-settling `sql` (inject via `__setAiProviderFactoryForTest` and `mockKinetica`) with a tiny `AI_TIMEOUT_MS`: assert a second ask is not 409 after deadline+grace, one audit row, `error` event sent. Also exists: `__setAiHeartbeatMsForTest`; add `__setAiGraceMsForTest`.
- Probes abort: add optional `signal?: AbortSignal` (and optional `tag`) to `KineticaSqlOptions`, pass `signal` into the `fetch` in `postPage`, map `AbortError` to a typed non-leaky error; thread `signal` through `createLiveSchema({..., signal})` -> `sql(principal, stmt, {route, op, signal})` and make `describe()` return `{ok:false}` on abort (it already swallows non-session errors). `runAnswer` builds `createLiveSchema` with `input.signal`. Cache key: probe results are cached 60 s per user:table - unaffected.
- Kinetica job cancel (memory kinetica-abort-does-not-cancel-jobs, S7.6 verified for non-admin own jobs): production code has NO tag/find/cancel helper today (only `spikes/kineticaCapsSpike.ts`). Add `lib/kineticaJobs.ts`: `tagSql(sql, requestId)` -> `/* kbi:<requestId> */ <sql>`; `cancelKineticaJobsByTag(principal, tag)` = POST `/admin/show/jobs {options:{}}` -> locate the index whose `query_text` includes the tag (response is the parsed `data_str` with parallel arrays `job_id`, `auth_id`, `query_text`) -> POST `/admin/alter/jobs {job_ids:[id], action:"cancel", options:{}}`. Model the call on `kineticaShowTable` (envelope + `data_str` parse). Best effort: swallow and log (never throw out of the cancel path, never log SQL or creds). Call it from the route when the abort comes from client close or the hard deadline, for the answer's request tag. HONEST SCOPE NOTE: in 137 the only Kinetica SQL an answer issues is `SELECT * FROM <view> LIMIT 0` schema probes, which are near-instant; the machinery matters for Phase 140 query tools. Implement and unit-test it now with mocked fetch (assert tag prefix present and cancel called only for the matching job id; assert non-matching jobs untouched); the live behaviour is already verified in S7.6, so no operator Kinetica check is required for 137, but flag that cancelling a LIMIT 0 probe cannot be observed live.
- Cancel propagation: browser `AbortController.abort()` -> connection closes -> Express `res` `close` with `!writableEnded` -> `ac.abort()` -> loop `guard()` throws `Stop("cancelled","client_abort")` -> audit `cancelled`, lock released in `finally`. Spec exists for this path in `routes.aiAsk.sse.spec.ts` family (extend rather than duplicate).

### S2: nginx directives and verification
Add an exact-match location (prefix `/api/` stays for everything else; do NOT turn off buffering for all of `/api/`, exports/branding use it):
```nginx
# Source: 133-SPIKES S2 decision; behaviour measured locally with nginx 1.27.2 (scratchpad), 2026-10-14
location = /api/ai/ask {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_buffering off;
  proxy_cache off;
  gzip off;
  proxy_read_timeout 300s;   # idle gap between bytes, NOT total duration; the 15 s `: ping` heartbeat keeps it alive
  proxy_send_timeout 300s;
}
```
- `proxy_pass` without a URI inside an exact `location =` forwards the original URI; `proxy_set_header`s are not inherited from the outer server when a location sets its own, so repeat the three existing ones (as above).
- `proxy_read_timeout` vs `AI_TIMEOUT_MS`: read timeout resets on every received byte, so with the heartbeat any value > 15 s works; 300 s is safe even for `AI_TIMEOUT_MS` up to the 600 s max. Do not try to make it >= AI_TIMEOUT_MS.
- gzip: `text/event-stream` is not in `gzip_types`, so it was never compressed (measured `content-encoding: none`); `gzip off` is belt-and-braces.
- Request body: 64 KB cap is below nginx's default `client_max_body_size 1m`, no change needed.
- **Verification without Kinetica or containers:** (1) A server spec (Express route) asserting the response header `x-accel-buffering: no` already exists (`SSE-R1`) - keep it, it is the primary mechanism measured to stream through today's nginx. (2) New spec reading `docker/nginx.conf` as text and asserting, inside the `location = /api/ai/ask` block, `proxy_buffering off`, `gzip off`, `proxy_http_version 1.1`, `proxy_read_timeout`, and that the generic `location /api/` block does NOT contain `proxy_buffering off` (guards against global regression). Confirm it reads 0/fails against the current file BEFORE the change (CLAUDE.md criterion rule). (3) Optional script/spec, skipped when `nginx` is not on PATH: wrap the conf (events/http + temp paths, see below) and run `nginx -t`. Locally verified working: `nginx -t -p <dir> -c <wrapper>` with `include docker/nginx.conf;` inside `http{}` prints "syntax is ok" (the `/usr/local/var/log` permission alert is harmless; set `error_log`/`pid` in the wrapper). (4) Local docker daemon is running with no containers; `docker`, `nginx` are on PATH. I did not start any container. A true end-to-end proxy run is an optional operator step, not required to close S2 given the measured behaviour.

### Contract gaps (server) - planner must make these explicit tasks
1. **Follow-ups (AIWID-V20-03):** not produced anywhere (`grep followUp` in `packages/server/src/lib/ai` and `packages/shared/src` = no AI hits). Recommended: no new tool and no extra provider round (free tier is 20 requests/day/model). Add a system rule asking the model to end its reply with a trailer, e.g. a final block `Follow-ups:` + 2-3 lines starting `- `, parsed and stripped server-side by a pure `parseReplyTrailer(text)` in `lib/ai/` (spec'd: absent -> `[]`, caps 3 items x 120 chars, never throws, text sent to the client has the trailer removed). `result.followUps: string[]`. Treat as untrusted text. Fallback so the requirement still holds when a weaker model omits the trailer: client-side templated follow-ups from the turn's changes (e.g. "Change the colours", "Add a map") built locally, flagged as a planner decision. Live-model reliability is unverifiable before 142 UAT.
2. **Ambiguity choices (AIWID-V20-05):** only `confirm_remove` and `choose_map` exist. Add `choose_option` to `AiClarificationSchema.kind` (options min 1 / max 10 already allows 2-3) and let the same trailer mechanism (`Choices:` block following a question line) produce it, OR (heavier) an `ask_user` tool. Prefer the trailer (no tool-set change, no S6 re-spike). Because `AiClarificationSchema` is `.strict()`, bump the shared schema, the web type, and the old-client expectation in specs (`SSE6-1` asserts `r.clarifications` equal `[]` for no clarification - unaffected).
3. **`applied` labels in `result`:** `runAgentLoop` already returns `applied: string[]` (used for audit) but `runAnswer` omits it from the `result` event. Add `applied: result.applied`. The web needs it for `turns[].changes` and the "what changed" lines.
4. Update the SSE event doc comment at the top of `aiRoutes.ts`/`runAnswer.ts`, and any spec asserting the exact `result` key set (grep before editing).

### AI widget must not be edited by the AI (Pitfall 6)
Recommendation: **include** the AI widget in `snapshot.widgets` with `type:"ai"` and its `layout`, and make the gateway refuse ops that target it. Reasons: `placeWidget(shadowRects(shadow), size)` and `validateLayout` use the shadow built from the snapshot; if the AI widget were omitted from the snapshot, new AI widgets could be placed on top of it and `set_layout` overlap checks would miss it. Implementation: in `checkAiOp` reference stage reject (stage `reference`, reason "the AI assistant widget can't be changed") any `patch`(widget)/`remove_widget`/`change_widget_type`/`set_widget_title` whose target shadow widget has `type === "ai"`, and any `set_layout` item whose id is an `ai` widget; add one line to `AI_SYSTEM_RULES`. Defense in depth in the web fold (`evaluateTurn`): skip ops targeting a widget of type `ai` (`unsupported_target`). `AI_WIDGET_TYPES` stays without `ai`, so `add_widget type:"ai"` already fails shape.
Also add a server guard in `POST /api/dashboards/:id/widgets` (`index.ts` ~L996): if `input.type === "ai"` and the user lacks `ai:use` (`getEffectivePermissions(username).has(PERMISSIONS.AI_USE)`), return 403 `{code:"PERMISSION_DENIED", permission:"ai:use"}` (the shape `apiFetch` already toasts). Today any `type` string is accepted, so "cannot add the AI widget" would otherwise be UI-only. Dashboard import (`/api/dashboards/import`) can also carry `ai` widgets; note as a residual (the viewer without `ai:use` just sees the read-only notice, harmless).

## Common Pitfalls

### Pitfall 1: Double POST from StrictMode / re-render
**What goes wrong:** an ask started inside `useEffect` runs twice in dev -> second request gets 409 `AI_BUSY` or spends quota. **Avoid:** asks only from handlers; runner refuses to start when `run.status === "running"`. **Warning sign:** two `fetch` calls in a StrictMode spec.

### Pitfall 2: Request body > 64 KB -> 413
Long answers x many turns (see Pattern 2). Spec a worst case and assert `byteLength < ASK_REQUEST_MAX_BYTES`.

### Pitfall 3: Ending without `result`/`error`
Proxy/idle cut or server restart yields a closed stream with no terminal event. Treat as failure, apply nothing, toast + inline message, release run state in `finally`.

### Pitfall 4: Late result after Cancel/Discard/dashboard switch
`signal.aborted` and store `epoch` check before `applyTurn`. A discarded session must never receive ops.

### Pitfall 5: Bar hidden at cursor -1 / `editing is locked` text
Bar visibility = lock source, not counts. Keep `/editing is locked/i` text or update `DashboardsPage.aiLock.spec.tsx` (assertions at ~L268-273) in the same plan.

### Pitfall 6: Omitting the AI widget from the snapshot
Breaks server placement/overlap (see above). Include it, refuse edits to it.

### Pitfall 7: D-02 from RGL live width
Use `config.layout` (36-col). Cols shrink at narrow breakpoints.

### Pitfall 8: Disabled Keep tooltip
`title` on a `disabled` button does not show in every browser. Use `aria-disabled="true"` + `title` + a no-op click (or keep `disabled` and accept; the existing toolbar uses `disabled`+`title`). Route legibility to the human check.

### Pitfall 9: CSS evades every automated gate
Undefined classes, wrong tokens (`--accent-text` on accent fill), rgba overlays, fixed-position drawer trapped by a grid transform (portal!), bubble contrast in light mode all pass `tsc`, vitest AND theme-guard (memory notes). Route to human-verify; do not dress as grep. New CSS files under `src/components/` are scanned by theme-guard for `#hex` (it reads components); no hex at all.

### Pitfall 10: Permission ripple
No new permission is added (`ai:use` exists), so the RBAC count-assertion ripple (rbacDb/rbacMigration/RolesPage specs) does not apply. Do NOT add a permission for the widget. The ripple that DOES apply: adding a chart type changes `getAllChartTypes()` consumers - re-run `registry.addable.spec.ts` and any spec snapshotting the picker list; and the two NON_TRIGGER sets.

### Pitfall 11: dev `.env` leaks into server vitest
`DEFAULT_VIEW_TTL_MINUTES=3` from `packages/server/.env` can redden unrelated specs; run server tests via `node scripts/test-gate.mjs` (forces it empty) and never read/print `.env`. New AI specs use `enableAiEnv` + `forbidProviderNetwork(mockKinetica(...))` (existing helpers), so they never touch the network.

### Pitfall 12: cancelled/error "turns" shifting indices
Each cancelled/error question consumes a cursor index; Revert buttons must pass the store's turn index (not the ok-answer ordinal). The harness `revert(i)` indexing note already documents this class of confusion.

## Code Examples

### Shape-key fix (agentLoop, success branch)
```typescript
// Source: packages/server/src/lib/ai/agentLoop.ts (g.ok branch) - recommended edit
const slot = opSlot(g.op);
if (slot !== undefined) unresolvedBySlot.delete(slot);
// 136 shape-key defect: a slotless shape failure is keyed `${tool}:shape:?`; a later success by the same tool repairs it.
const shapeKey = `${tool.name}:shape:?`;
unresolvedBySlot.delete(shapeKey);
attemptsByRef.delete(shapeKey);
```

### Route hard deadline skeleton
```typescript
// Source: design for W1; builds on aiRoutes.ts current structure
const GRACE_MS = graceOverride ?? 5_000;
let released = false;
const release = () => { if (!released) { released = true; if (inflight.get(key) === ac) inflight.delete(key); } };
const hard = setTimeout(() => { ac.abort(); void cancelKineticaJobsByTag(principalForSession(sid), tag).catch(() => {}); hardHit = true; release(); }, config.timeoutMs + GRACE_MS);
hard.unref();
try { fin = await Promise.race([runAnswer({ ... , signal: ac.signal }), deadlinePromise /* resolves a timeout FinalizeInput */]); }
finally { clearTimeout(hard); release(); /* finalize once, then res.end() */ }
```

### Web mocked SSE stream (spec)
```typescript
// Source: pattern; existing specs stub fetch via vi.spyOn(globalThis,"fetch") (api/client.exports.spec.ts)
const enc = new TextEncoder();
const frames = (evs: [string, unknown][]) => new ReadableStream<Uint8Array>({
  start(c) { for (const [e, d] of evs) c.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)); c.close(); },
});
vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(frames([["result", {...}], ["done", {...}]]), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
// split-chunk case: enqueue `event: res` and `ult\ndata: {"a"` in two chunks; cancel case: stream whose pull() rejects with AbortError when init.signal aborts.
```

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| 133 plan: nginx change required for SSE | Measured: server `X-Accel-Buffering: no` already streams through nginx 1.27; directives are defense-in-depth | nginx task is small; spec is textual |
| Per-tool-name rejection counter (135 W2) | Per-reference keys (136) with `T:shape:?` residual | Fix first |
| 134 Compact/Full widget mode | Size-driven presentation (D-02/D-03) | no widget config |

**Deprecated/outdated:** `.planning/STATE` "gitignored" note is stale (planning files are fully tracked). The `devHarness` remains DEV-only and is not removed in this phase; `useAiSessionActions` is the shared entry.

## Open Questions

1. **Follow-ups / ambiguity mechanism (trailer vs tool).**
   - Known: server returns neither. Recommended: trailer parse + local fallback; no extra provider call.
   - Unclear: whether Gemini free-tier / Ollama follow the trailer reliably (live proof is 142).
   - Recommendation: implement trailer + client fallback; spec the parser with fuzz; list a 142 UAT item. Surface to the user if they want a stricter guarantee (tool) at the cost of an extra request.
2. **`filters` in the snapshot for 137.** Sending `[]` is valid. Recommendation: send `[]` now; 138 wires real structure.
3. **Retry affordance (D-09).** Recommendation: Retry button only for `AI_PROVIDER_ERROR`, `AI_INTERNAL`, timeout and connection-lost; never for `AI_CAPPED`-type daily/hour caps (429 `AI_CAP_*`/rate codes) or `AI_RATE_LIMITED` unless `retryAfterSeconds` is shown. Retry re-asks the same question as a new turn.
4. **AI_BUSY wording.** Not in `AI_USER_MESSAGES`; the 409 body message is "An AI answer is already in progress." Reuse server text verbatim. Because the client disables Send while its own run is active, a 409 only occurs from another tab/device: show the server message.
5. **Cap/429 codes.** `admitAiAnswer` failure codes live in `lib/aiAudit.ts` (message text is server-provided; reuse `body.message` verbatim, show `retryAfterSeconds` if present).
6. **Dashboard import carrying `ai` widgets** bypasses the create guard: accepted residual (read-only notice for users without `ai:use`).

## Testing approach (nyquist validation disabled in config; this is guidance, not the template)

| Area | Test | Command |
|------|------|---------|
| Shape-key fix | new W2-5 + Defect-B case in `tests/lib.aiAgentLoop.spec.ts`; update SSE-R2 expectation | `cd packages/server && npx vitest run tests/lib.aiAgentLoop.spec.ts tests/routes.aiAsk.sse.spec.ts` |
| W1 | never-settling provider / never-settling Kinetica fake + tiny `AI_TIMEOUT_MS`; second ask not 409; one audit row | `npx vitest run tests/routes.aiAsk.*.spec.ts` |
| Kinetica tag/cancel | mocked fetch, matching vs non-matching job ids | new `tests/lib.kineticaJobs.spec.ts` |
| nginx | text assertions on `docker/nginx.conf` (+ optional `nginx -t` when binary exists) | new `tests/deploy.nginxStream.spec.ts` |
| Contract | `parseReplyTrailer`, `AiClarificationSchema` choose_option, `result` has `applied`/`followUps` | server + `packages/shared` specs |
| SSE client | ReadableStream mock: split chunks, heartbeat comment, result, error, no-terminal-event, abort | `cd packages/web && npx vitest run src/lib/aiSession` |
| Request builder | worst-case size, strict-schema parse, `removeSaved` omitted when false | same |
| Store | `chat` meta, epoch drop, counts, cancelled/error turns do not lock | `src/store` / `src/lib/aiSession` |
| Widget | render under `<StrictMode>`; click starter asks once; Enter/Shift+Enter; Send->Cancel; no-`ai:use` notice; busy shared across two widgets | `src/components/charts` |
| Bar | counts, removed-names `title`, Keep disabled + tooltip, Discard confirm portalled to `document.body` | `src/components` |
| Gates | `cd packages/web && npx tsc --noEmit && npx vitest run && npx vitest run src/styles/theme-guard.spec.ts`; `cd packages/server && npx tsc --noEmit && node scripts/test-gate.mjs` | per CLAUDE.md |

Acceptance-criteria rule (CLAUDE.md): before writing any grep criterion, run it and confirm it reads 0/fails now. Introduce NEW anchors: e.g. `askAi`, `parseReplyTrailer`, `widget-card--ai-changed`, `cancelKineticaJobsByTag`, `location = /api/ai/ask`, `W2-5`, `AiChangeBar`, `AI_ASSISTANT_DEFAULT_SIZE`. Verify each currently has 0 hits (I confirmed none of `askAi`, `api/ai/ask` in `packages/web/src`; `followUp` has no AI hits server/shared).

**Must route to operator human-verify (not automatable, per CLAUDE.md):** chat bubble contrast and alignment in light AND dark; status line/spinner; choice buttons greyed + tick; pills; the 3 s fading outline (and reduced-motion); bar layout/legibility and removed-names hover; drawer on a small tile and on a narrow window (full-screen, portalled, not clipped by the grid); "no visible flash/jank" while streaming; Keep tooltip visibility. Live provider quality (follow-ups present, ambiguity choices) and a real run through docker nginx :8080 are 142-style UAT (no live Gemini/Ollama in this phase).

## Suggested plan / wave breakdown

Constraints applied: plans touching the same file never share a wave; only the LAST plan edits ROADMAP/REQUIREMENTS/STATE/PROJECT, by hand (never gsd-tools mutation commands); `.planning` is tracked, so executors must not clobber shared docs in parallel (memory: parallel-executors-roadmap-collision).

| Wave | Plan | Files (disjoint within wave) | Content |
|------|------|------------------------------|---------|
| 1 | 137-01 server fixes | `agentLoop.ts`, `gateway.ts`, `context.ts`(prompt line), `index.ts` (create guard), `tests/lib.aiAgentLoop.spec.ts`, `tests/lib.aiGateway.spec.ts`, `tests/routes.aiAsk.sse.spec.ts` | Shape-key fix red-first; AI-widget refusal; server create guard for type `ai`; SSE-R2 update |
| 1 | 137-02 W1 + Kinetica | `aiRoutes.ts`, `runAnswer.ts` (signal into liveSchema only), `liveSchema.ts`, `kinetica.ts`, new `lib/kineticaJobs.ts`, specs | Hard deadline, abortable probes, tag/find/cancel, cancel path specs |
| 1 | 137-03 nginx | `docker/nginx.conf`, `docker/README.md`, new `tests/deploy.nginxStream.spec.ts` | S2 location block + textual spec (+ optional `nginx -t`) |
| 2 | 137-04 contract additions | `packages/shared/src/aiAsk.ts` (+spec), `agentLoop.ts`, `runAnswer.ts`, `context.ts`, new `lib/ai/replyTrailer.ts` | followUps, `choose_option`, `applied` in `result`; trailer parser (touches files from 01/02, hence wave 2) |
| 3 | 137-05 web engine | `api/client.ts`, new `lib/aiSession/{askStream,buildAskRequest,askRunner,starterQuestions,changeCounts}.ts`, `store/aiSessionStore.ts`, `lib/aiSession/{types,constants,foldSession}.ts`, `components/DashboardContext.tsx`, `charts/definitions/{ai.ts,index.ts}`, the two NON_TRIGGER files, specs | SSE client, request builder, store `chat`/`run`/`epoch`/`draft`/`highlight`, registry, no UI |
| 4 | 137-06 AI widget UI | new `charts/AiWidgetRenderer.tsx`, `AiChat`, `AiDrawer`, `AiWidget.css`, `charts/WidgetRenderer.tsx` (branch) | chat, empty state, small tile + portalled drawer, progress/cancel/errors/choices/follow-ups, no-access notice |
| 4 | 137-07 bar + integration | `components/DashboardsPage.tsx` (picker gate, 12x40 add, bar mount, unmount `cancelAsk`, duplicate gate), `components/WidgetCard.tsx` (fade class), `AiChangeBar.tsx` + `AiDiscardDialog.tsx`, `styles/global.css` (fade keyframes + bar), `DashboardsPage.aiLock.spec.tsx` | Keep/Discard bar, highlights, add-widget gating |
| 5 | 137-08 verification + bookkeeping (LAST) | `.planning/ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`, `PROJECT.md` by hand; operator checkpoint | `checkpoint:human-verify` (light/dark list above); mark AIWID-01..07, AISES-04, AIGOV-01 (do NOT mark Complete early beyond what is proven; AIGOV-V20-01 closes here); record S2 result, W1, shape-key fix; note S6 staleness and Keep->`reset()` for 141 |

06 and 07 may share a wave only because they touch disjoint files (06: charts/* + its own CSS; 07: DashboardsPage/WidgetCard/global.css). If the planner prefers safety, serialise them.

## Sources

### Primary (HIGH confidence) - repo files read this session
- `packages/server/src/aiRoutes.ts`, `lib/ai/{runAnswer,agentLoop,gateway,context,liveSchema,sseWriter,sseParse}.ts`, `lib/ai/tools/{registry,types}.ts`, `kinetica.ts`, `spikes/kineticaCapsSpike.ts`, `tests/routes.aiAsk.sse.spec.ts`, `tests/lib.aiAgentLoop.spec.ts`
- `packages/shared/src/{aiAsk,layout}.ts`
- `packages/web/src/store/aiSessionStore.ts`, `lib/aiSession/*`, `hooks/{useAiEditLock,useAiSessionActions}.ts`, `components/{DashboardsPage,WidgetCard,AiLeaveDialog,Toast,DashboardContext}.tsx`, `charts/{registry,WidgetRenderer}`, `charts/definitions/*`, `api/client.ts`, `store/toast.ts`, `styles/global.css`
- `docker/nginx.conf`, `Dockerfile`; planning: 137-CONTEXT, 133-SPIKES (S2, S7), 135-VERIFICATION (W1), 136-VERIFICATION (shape-key), ROADMAP, REQUIREMENTS, memory notes
- Local measurement 2026-10-14: nginx 1.27.2 + Node SSE server on loopback (scratchpad), four configurations; `nginx -t` on the repo conf: ok

### Secondary (MEDIUM)
- Behaviour of `X-Accel-Buffering` / `proxy_buffering` / `proxy_read_timeout` semantics: consistent with the measurement and standard nginx docs (not re-fetched this session).

### Tertiary (LOW)
- Live provider adherence to a follow-up/choices trailer (no provider calls allowed; unverified).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new deps; all from repo
- Architecture: HIGH for server/W1/shape/nginx/store; MEDIUM for follow-up/ambiguity mechanism
- Pitfalls: HIGH - derived from code and memory notes

**Research date:** 2026-10-14
**Valid until:** ~2026-11-13 (stable; re-check if 138+ changes `aiAsk.ts` or the gateway first)
