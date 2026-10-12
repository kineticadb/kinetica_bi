# Phase 134: Session Layer Engine (client, no LLM) - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The browser-side **session layer**: a per-user, in-memory record of AI-proposed dashboard changes, grouped by answer, that
- applies one answer's ops together and immediately, visible only to the asking user, with **no dashboard DB write** (AISES-V20-01);
- builds every later answer on top of the earlier ones — a second answer never erases the first (AISES-V20-02);
- **reverts the dashboard to the state after any earlier answer**, and jumps forward again until a new question replaces the later answers (AISES-V20-03, as changed 2026-10-12);
- restores the saved dashboard exactly on Discard or reload (AISES-V20-07).

Driven by a **test harness / scripted ops — no LLM, no server AI route, no visible AI widget UI** in this phase. Out of scope here (later phases): the AI widget and chat UI, highlights, Keep/Discard bar (137); real op kinds' validation and placement algorithm (136); filters (138); dynamic views (139); Keep persistence (141).

</domain>

<decisions>
## Implementation Decisions

### History model (changed requirement — see REQUIREMENTS.md 2026-10-12)
- **D-01** The session layer is an ordered list of **turns** with a **current position (cursor)**. Each turn records at least: an id, the user's prompt text, the AI's answer text (filled later by 135/137; may be empty in harness tests), the ops it applied, and enough inverse/snapshot data to restore the dashboard to "after this turn" as one unit.
- **D-02** **Revert to any turn** restores that turn's resulting state as one unit. Moving the cursor back does NOT delete later turns; the user can **jump forward** again to any later turn.
- **D-03** **Asking a new question while the cursor is not at the end replaces the later turns** (they are dropped; normal undo semantics).
- **D-04** History is cleared by **Keep** and by **Discard**; **reload clears it** (locked — in-memory only, never persisted).
- **D-05** **One shared history per dashboard per user.** If a dashboard has several AI widgets they all read/write the same session layer and show the same conversation.
- **D-06** Depth: all turns since the last Keep/Discard are revertible; an internal safety cap is Claude's discretion (e.g. 50 turns, oldest dropped with a note).

### Manual editing while AI changes are unsaved
- **D-07** **Editing is locked** while the session layer has unsaved AI changes: the designer must **Keep** (save) or **Discard** first, then edit. Operator: "Force the designer to save the current AI changes first and then modify if desired."
- **D-08** Lock scope = **editing only**. Blocked: widget config panels, add/delete widgets, the Layers and Dynamic Views editors, dashboard settings, drag/resize of SAVED widgets. Still allowed: filters, drill, map pan/zoom/draw, info popups, radio controls, exports, the AI widget itself.
- **D-09** This phase owns the lock **state + guard** (a single selector/hook such as `hasUnsavedAiChanges` that every edit entry point checks, plus specs that each blocked entry point is gated). The user-facing message text/placement may be finished in Phase 137; a plain non-blocking notice reusing existing classes is acceptable here.
- **D-10** "Warn before an edit that would orphan an AI change" — with D-07 the user's own edits can't orphan AI changes. The remaining case is **another user** changing the dashboard concurrently → handled by Phase 141's Keep 409; record any AI op whose target vanished as skipped (not applied), never crash.

### Radio Dashboard Controls vs AI
- **D-11** **Most recent wins** when a radio control and an AI op set the same field. Reverting the AI turn restores whatever the radio set. The AI contribution must be rebuilt from the whole log under a reserved source id so it never wipes the radio's contribution (and vice versa) — `widgetActionStore` is source-keyed replace (research/SUMMARY §2).

### Layout of AI widgets (state here; algorithm in 136)
- **D-12** AI-added widgets' geometry is **session-only**; users **can drag/resize AI-added widgets** before Keep, and that geometry is part of the unsaved AI changes (persisted only by Keep, dropped by Discard/revert). Saved widgets stay locked (D-08).
- **D-13** `onLayoutChange` (DashboardsPage grid) must **never persist** AI-widget geometry nor reflow-and-save saved widgets because AI widgets were inserted (roadmap criterion 4; spike S5). Test + operator human-verify.
- **D-14** *(For Phase 136, recorded now)* Placement: **fill gaps first, then below existing content**, with **sensible per-type sizing** (e.g. KPI/bignumber small, map large, records table wide). Saved widgets never move.

### Leaving with unsaved AI changes
- **D-15** **Warn first.** In-app dashboard switch / navigation → "You have unsaved AI changes — Discard and leave / Stay" (portalled modal; reuse the existing confirm-dialog pattern and classes). Reload / tab close → browser `beforeunload` prompt. Leaving discards (and triggers temp-view cleanup hooks once 139 exists).

### Decisions added after research (2026-10-12)
- **D-16** The legend **eye toggle stays as today** while AI changes are unsaved (show/hide is exploring; it keeps saving as now). Only AI-added (negative-id) layers must never reach `apiUpdateLayer`.
- **D-17** (orchestrator defaults from research, operator-informed) A conversation with no applied ops does **not** lock editing or trigger the leave warning. Revert/forward counts as the AI's "most recent" change for D-11. AI-added layers get a minimal default-filled builder in 134 (`add_layer` payload is `{tempId, widgetId}` until Phase 136 replaces it).

### Claude's Discretion
- Store shape (snapshot vs op-log + inverses per turn), temp-id scheme (negative ids per research), and how derived effective widgets/layers/dvs merge at the read sites (DashboardsPage, MapChartRenderer, LegendRenderer, applyLayerOverrides).
- The safety cap value (D-06) and the in-phase notice wording (D-09).
- How the harness drives ops in tests (scripted op lists through the shared `AiOp` contract from `@kinetica-bi/shared`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and design
- `.planning/REQUIREMENTS.md` — AISES-V20-01/02/03/07 (AISES-V20-03 and AIWID-V20-01/02/03 changed 2026-10-12)
- `.planning/ROADMAP.md` §"Phase 134" — success criteria (criterion 3 reworded 2026-10-12)
- `.planning/research/SUMMARY.md` — resolved positions §2 (widgetActionStore source-keyed hazard → rebuild-from-log under `AI_SOURCE_ID`), §8 (one batch per turn), spike S5 (layout during review)
- `.planning/research/ARCHITECTURE.md` — aiSessionStore, effective-list merge at read sites, temp ids
- `.planning/research/PITFALLS.md` — C7 session-layer bugs

### Phase 133 outputs this phase builds on
- `packages/shared/src/aiOp.ts` — `AiOp` union, temp-id schema (`AiTempIdSchema`)
- `packages/shared/src/actionAllowList.ts` (allow-list v3) and `packages/shared/src/widgetAction.ts`
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md` — S3 approved AI widget subset (bar, line, pie, table, bignumber, records, map with heatmap layers only)

### Existing code
- `packages/web/docs/mcp-action-seam.md` — v1.11 overlay design
- `packages/web/src/store/widgetActionStore.ts` — source-keyed contributions, `deriveOverlays`, `reset()` in the DashboardOpen cleanup chain
- `packages/web/src/lib/applyWidgetAction.ts`
- `packages/web/src/components/DashboardsPage.tsx` — cleanup chain (~lines 705-765), grid `onLayoutChange` (~1395-1413)

### Project rules
- `CLAUDE.md` — reuse `global.css` classes, no hex, portal modals, verifiable acceptance criteria
- Memory notes: widget modals must portal (grid transforms trap `position:fixed`); info-selection store is global; filtering badges read `filterCombinationStore`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `widgetActionStore` + `deriveOverlays()` already produce `widgetOverrides` / `layerOverrides` / `dynamicViewOverrides` consumed by WidgetRenderer and MapChartRenderer without remounts — reuse for PATCH ops under a reserved AI source id, rebuilt from the session log.
- `@kinetica-bi/shared` `AiOp` schema for harness-driven ops.
- Existing confirm-dialog/modal pattern for D-15 (portal it).

### Established Patterns
- Session-only overlays reset in the DashboardsPage cleanup chain (13 stores today) — the session layer joins it (respecting D-15 warn-first on switch).
- Structural adds/removes are NEW (the v1.11 engine only patches existing ids): effective widgets/layers/dvs must be merged at each read site.

### Integration Points
- DashboardsPage widget list + grid layout + `onLayoutChange`; MapChartRenderer `effectiveLayers` (both WMS build sites — map WMS is a separate read path); LegendRenderer / `applyLayerOverrides`; every edit entry point for the D-07 lock.

</code_context>

<specifics>
## Specific Ideas

- Operator's vision (2026-10-12): "a full chat communication with prompt and answers but next to each answer put a button to revert the dashboard to that state." Answers are full, not shortened.
- Research (2026-10-12): Grafana Assistant ships an Undo under each response but only for the latest request and blocks after manual edits; our design generalises to any answer and locks manual edits instead. Power BI is retiring its compact on-canvas Q&A visual in favour of chat.

</specifics>

<deferred>
## Deferred Ideas

- **AI-F13** per-dashboard "viewers can prompt" switch (on top of the "Use AI" role permission).
- Chat UI, size-driven inline/drawer presentation, highlights, Keep/Discard bar — Phase 137 (already scoped).
- Placement algorithm and per-type sizing — Phase 136 (D-14 recorded for it).

</deferred>

---

*Phase: 134-session-layer-engine-client-no-llm*
*Context gathered: 2026-10-12*
