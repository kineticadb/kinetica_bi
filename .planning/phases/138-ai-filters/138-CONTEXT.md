# Phase 138: AI Filters - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning

<domain>
## Phase Boundary

The AI can apply and clear data filters through the SAME path a user's click uses (`filterStore` -> `filterCombinationStore` -> `/api/filter/materialize`), so charts, records tables and map tiles narrow exactly as after a click, and clearing removes it. Requirement AIACT-V20-09. Success criteria (ROADMAP): (1) "show only X" narrows charts, records tables and map tiles like a click; clear removes it; (2) undo restores the prior per-source filter state; badges read `filterCombinationStore`; (3) nonexistent column refused, per-table cap holds; (4) map tiles visibly narrow against real Kinetica (operator human-verify).

Out of scope: AI-created dynamic views (139), query mode (140), saving anything (141), spatial/draw filters, per-widget filtering, saved "default filters" on a dashboard.

</domain>

<decisions>
## Implementation Decisions

### What a filter narrows
- **D-01 Whole source, like a click.** An AI filter is a per-table filter (or per-dynamic-view filter for dv-backed widgets): every chart, records table and map layer reading that source narrows. No per-widget filter mechanism.
- **D-02 Ambiguous column -> ask.** If the requested column exists on more than one source on the dashboard and the question does not name one, the AI asks which table using the Phase 137 choice buttons (`choose_option`). It does not filter both.
- **D-03 Saved dynamic views included.** dv-backed widgets are filtered through the existing dv filter slice (`addDvFilter`/`clearDvFilters`), same as a click on them. AI-created views are Phase 139.
- **D-04 Filter kinds = what clicks and the filter panel can set:** equals, in-list, between (numeric and datetime/string), and empty (`isNull` / dataType null). Uses the existing `ActiveFilter` shape; nothing new.

### Mixing with the user's own filters
- **D-05 Same column -> replace.** "Only credit" when the user has payment_type = Cash replaces Cash with Credit. Undo restores Cash.
- **D-06 Other columns stack.** Filters on other columns stay (same as clicking a second chart). The answer mentions filters that are still on.
- **D-07 "Clear the filters" clears all filters on the dashboard, the user's included.** No confirm (it is undoable). Narrower requests ("clear the vendor filter") clear only that.
- **D-08 Cap: refuse, never partial.** A filter that would exceed `FILTER_CAP_PER_TABLE` (25) is refused with a reason ("the table already has 25 filters"), suggesting clearing some. Nothing partial is applied.
- Nonexistent column: refused (client/gateway validation against the live schema; server `materialize` column guard from AISAFE-V20-01 / SSYNC-F6 is the backstop).

### Bar, lock and undo
- **D-09 Filter-only answers do not lock editing and do not show the unsaved-changes bar**, and do not trigger the leave warning. Filters are view state, like the user's own clicks. An answer that ALSO changes widgets/layers locks as before (the filter part still does not count in the bar's added/edited/removed numbers).
- **D-10 Every AI filter change is still a turn** in the session history: Revert/Forward restore the per-source filter state of that point; follow-ups and the answer bubble work as in 137.
- **D-11 Revert/Forward touch only the columns the AI changed.** A filter the user set by hand after the AI turn is never clobbered (inverse is per source + column, not a whole-store snapshot).
- **D-12 Discard restores filters to how they were before the AI** (including user filters the AI replaced or cleared), again per column, leaving the user's later manual filters on other columns intact. Since filter-only sessions show no bar, the user undoes them with Revert in the chat; Discard via the bar applies when the bar is present.
- **D-13 Keep (Phase 141) does not save filters.** Filters stay applied for the current view; Keep's confirmation should say "filters are not saved". Record for 141; nothing built here.

### Showing what was filtered
- **D-14 Filter chips:** AI-applied filters appear as normal chips (removable the usual way) with a small "AI" tag. The tag goes away once the user edits/replaces that chip.
- **D-15 Outline, no pill:** every widget and map layer host that narrowed gets the Phase 137 fading accent outline. No "AI edited" pill (the widget itself didn't change).
- **D-16 Answer wording:** says what was filtered and how many widgets narrowed, and notes filters still on, e.g. "Filtered trips to payment_type = Credit (5 widgets). Your vendor_id filter is still on."
- **D-17 Zero matches:** the filter is applied (as a click would) and the user is told it matched no rows, with an offer to clear it. Widgets show their normal empty state.

### Claude's Discretion
- The `apply_filter` / `clear_filter` op payload (the 133 placeholders are keyed by `widgetId`; D-01 implies a source-keyed shape `{source:{kind:"table"|"dv",id}, filters:[...]}` or similar) and how the gateway validates columns/values/operators against the live schema.
- Where the AI filter applier lives (research recommends a NEW sibling module outside the action engine, e.g. `packages/web/src/lib/aiOps/aiFilterApplier.ts`, keeping the `ACTION-ENGINE-NO-FILTER` invariant).
- How the session stores filter turns (filter deltas per source+column alongside ops) so D-10..D-12 hold without making filter-only turns count as unsaved changes.
- How D-17 detects "no rows" (likely client-side after materialize/widget result, since schema mode cannot count rows server-side).
- How the "AI" chip tag is tracked (e.g. a marker on `ActiveFilter`), provided badges keep reading `filterCombinationStore`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research and requirements
- `.planning/REQUIREMENTS.md` — AIACT-V20-09 (this phase); AISAFE-V20-01 (materialize column guard, done in 133)
- `.planning/ROADMAP.md` §Phase 138 — goal and 4 success criteria
- `.planning/research/ARCHITECTURE.md` — §5 filters go through filterStore -> filterCombinationStore -> materialize via a NEW module outside the action engine; `aiFilterApplier.ts`; interleaved user actions must not be clobbered
- `.planning/research/PITFALLS.md` — AI bypassing the filter path; badges going stale (legacy `filterViewStore`); maps' separate read path (two `buildWmsParams` sites + dep keys); dv FROM-swaps
- `.planning/research/FEATURES.md` — "AI" tagged filter chips reusing combination-store badges

### Prior phase decisions
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-COLUMN-AUDIT.md` — column guard residuals
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md` — S1 ad-hoc dv path (relevant to dv filtering)
- `.planning/phases/134-session-layer-engine-client-no-llm/` — session fold, turns, revert/forward, lock semantics
- `.planning/phases/136-structural-edit-ops/` — gateway op validation, removal confirmation pattern
- `.planning/phases/137-ai-widget-streaming-ui/137-CONTEXT.md` — D-15..D-19 bar/pills/outline, D-20 reply trailer (follow-ups + choices), choice buttons
- `.planning/phases/137-ai-widget-streaming-ui/137-12-UAT-RESULTS.md` — UAT harness approach and known harness gap (no highlight trigger)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/web/src/store/filterStore.ts`: `ActiveFilter` (eq/in/between/isNull), `setBulkFilters`, `addFilter`, `removeFilter`, `clearFilters`, dv slice `addDvFilter`/`removeDvFilter`/`clearDvFilters`, `FILTER_CAP_PER_TABLE = 25`, `filterVersion` bump drives re-materialize.
- `packages/web/src/store/filterCombinationStore.ts`: badges and table read-path read this (NOT `filterViewStore`).
- `packages/web/src/lib/clearAllFilters.ts`: existing "clear all" path (D-07).
- `packages/web/src/components/FilterChip.tsx`, `FilterPanel.tsx`: chips to tag "AI" (D-14).
- `packages/web/src/lib/aiSession/changeCounts.ts` (`changedWidgetIds`), `store/aiSessionStore.ts` (`setHighlight`, `selectHasUnsavedAiChanges`): outline (D-15) and lock (D-09).
- `packages/web/src/lib/aiSession/askRunner.ts` (`applyResult`), `chatText.ts`, `devHarness.ts` (add filter helpers + a highlight trigger for UAT).
- `packages/shared/src/aiOp.ts`: `apply_filter` / `clear_filter` placeholders ("filter payload added in Phase 138").
- Server: `packages/server/src/lib/ai/gateway.ts` (op validation), `liveSchema.ts` (live columns), `tools/`.

### Established Patterns
- Filters are per-table (and per-dv) client state; clicks never lock editing and are not saved.
- Map tiles use a separate read path (`MapChartRenderer`, two `buildWmsParams` sites + dependency keys) — AI filters must reach it via the same combination read a click uses.
- Session changes are folded from turns; revert/forward re-fold; lock follows "any op ever applied".

### Integration Points
- New AI filter applier (client) called from `applyResult` alongside `applyTurn`.
- Gateway accepts/validates the filter op; context/snapshot already carries active filters per research (`snapshot` includes active filters).
- AiLeaveDialog / AiChangeBar must ignore filter-only state (D-09).

</code_context>

<specifics>
## Specific Ideas

- "Only X" means replace on that column, not widen (D-05).
- Example answer: "Filtered trips to payment_type = Credit (5 widgets). Your vendor_id filter is still on."
- Operator UAT should include a real map narrowing against Kinetica in light and dark (SC4), run through the CDP harness as in 136/137, and needs a harness way to trigger the outline.

</specifics>

<deferred>
## Deferred Ideas

- Saving filters as a dashboard's default filters — new capability, own phase (backlog).
- Keep confirmation text "filters are not saved" — Phase 141.
- Per-widget filtering — not a click path today; not planned.

</deferred>

---

*Phase: 138-ai-filters*
*Context gathered: 2026-10-15*
