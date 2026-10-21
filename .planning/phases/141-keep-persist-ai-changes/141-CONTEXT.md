# Phase 141: Keep (Persist AI Changes) - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning

<domain>
## Phase Boundary

A user with edit rights saves every AI session change into the dashboard in **one all-or-nothing step**: added, edited (including rebinds) and removed widgets, layers and dynamic views, with temporary (negative) ids replaced by real ones. Users without edit rights are not offered Keep, and the server rejects a forged Keep. If the dashboard changed since the session began, Keep returns 409 and saves nothing. Filters are not saved, and the user is told so. After Keep, a reload shows the saved result.

Requirements: AISES-V20-05, AISES-V20-06.

Out of scope: generate a starter dashboard, the audit viewer and live provider UAT (142); merging or replaying AI changes on top of someone else's newer edits.

</domain>

<decisions>
## Implementation Decisions

### Rights & partial rights
- **D-01 Rights the changes actually need**, checked server-side on the real change set: always `dashboards:edit`; plus `widgets:configure` if any widget is added, edited, rebound or removed; `layers:manage` if any layer changes; `dynamic_views:manage` if any dynamic view is added or removed. (135 D-16: edit rights are enforced at Keep, not at session apply.)
- **D-02 Missing a needed right refuses the whole Keep** and names the right, e.g. "You can't save these changes: saving dynamic views needs the Manage dynamic views permission." Nothing is saved. The session stays intact, so the user can revert that part or ask an editor.
- **D-03 Without `dashboards:edit`, Keep is hidden.** The bar shows only Discard, plus a short note "Only editors can save AI changes".
- **D-04 Partial rights:** if the user has `dashboards:edit` but lacks a specific right, Keep is shown. The server refuses on click with the named reason (D-02). The server is the authority; the client does not try to predict it.

### What counts as "changed" (409)
- **D-05 Any saved change to the dashboard** after the baseline counts as a conflict: any widget, layer, dynamic view or dashboard-settings change. There is no merging.
- **D-06 The user's own layer visibility (eye) toggles during the session don't count** (134 D-16 lets them save while AI changes are pending). The same kind of change by another user does count.
- **D-07 Baseline = when the dashboard was loaded** in this tab, not the first AI answer.
- **D-08 After a 409:** "Someone else changed this dashboard since you started. Your AI changes weren't saved." Options: **Discard and reload the latest** (AI changes lost) or **Stay** (keep exploring; Keep keeps refusing until they discard). No merge or replay.
- **Research flag:** `dashboards.updated_at` is only bumped by dashboard-settings updates today (db.ts ~L638). Widget, layer and dynamic-view writes may not touch it. Planning needs a reliable dashboard-wide change signal, such as a version counter or max(updated_at) across the dashboard's rows, that also lets D-06 exclude the user's own visibility toggles.

### Keep flow & confirmation
- **D-09 One confirm dialog** (portalled, same pattern as Discard: `AiLeaveDialog` / `modal-overlay` / `modal-content`): "Save AI changes? 3 added · 2 edited · 1 removed. Filters are not saved." [Save] [Cancel]. This is the "UI says filters are not saved" requirement.
- **D-10 While saving:** Keep shows "Saving…", and Keep and Discard are disabled until the response.
- **D-11 After success:** the conversation stays readable, every "Revert dashboard to this state" button is removed (history cleared, AISES-V20-03), and a muted chat note "Changes saved." is added. The bar disappears because there are no unsaved changes. Call the store `reset()` so the 136 removal approval clears (137 D-16).
- **D-12 On other failures** (server or DB error): "Couldn't save the AI changes. Nothing was saved; try again." The session stays intact and Keep can be retried.

### What survives Keep
- **D-13 Filters stay applied, not saved.** Table filters remain as they are. Filters on an AI view (`dvFilters[-N]`) are re-keyed to its new saved view id so the view stays filtered. Reload clears filters as today.
- **D-14 AI-added widget geometry is saved exactly as shown** (134 D-12).
- **D-15 Temporary Kinetica views:** Keep creates the saved `dashboard_dynamic_views` row from the AI view's compiled template (139: a valid saved-dv template; joined tables are read raw after Keep, D-21 accepted). The temp `_kbi_ai_*` view is dropped and its registry row removed. Widgets and layers now read the saved view through the normal path (a brief re-materialize).
- **D-16 Everything else is saved:** widgets, layers (including AI-set visibility and style), dynamic views, rebinds, removals and geometry. Only filters and the chat are not saved.

### Claude's Discretion
- The route shape (e.g. `POST /api/dashboards/:id/ai-keep`) and the payload: the client's folded change set versus the op log replayed through the gateway. The server must re-validate everything (shape, allow-list, rights, references, live schema) and never trust client-supplied SQL or names.
- Reuse of the `dashboardImport` transaction and temp-id remap (`createWidget` / `createDashboardLayer` / `createDashboardDynamicView`, in dependency order dv → layer → widget), and the client id swap / refetch after Keep.
- The injected mid-transaction failure test (SC1) and the forged-Keep rejection test (SC2).
- The audit of a Keep (whether `ai_audit` or a separate record notes it).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope & requirements
- `.planning/ROADMAP.md` § Phase 141: goal, 4 success criteria, research flag (S4 temp-id re-keying)
- `.planning/REQUIREMENTS.md`: AISES-V20-03 (Keep clears history), AISES-V20-05, AISES-V20-06, AISES-V20-07
- `.planning/STATE.md`: milestone decisions; Phase 139/140 follow-ups (D-21 join difference, Keep contract)

### Prior phase decisions
- `.planning/phases/134-session-layer-engine-client-no-llm/134-CONTEXT.md`: D-04 (history cleared by Keep), D-07/D-08 (editing lock), D-10 (concurrent edit → 141 409), D-12 (AI widget geometry), D-16 (eye toggle still saves)
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-CONTEXT.md`: D-16 rights at Keep
- `.planning/phases/136-structural-edit-ops/136-CONTEXT.md`: D-06 removal approval
- `.planning/phases/137-ai-widget-streaming-ui/137-CONTEXT.md`: D-15 bar, D-16 Keep disabled until 141 + `reset()`, D-17 confirm pattern, D-19 removed counts
- `.planning/phases/138-ai-filters/138-CONTEXT.md`: D-13 filters not saved
- `.planning/phases/139-session-only-dynamic-views/139-CONTEXT.md`: D-15/D-21/D-24, Keep compatibility of compiled templates; `139-RESEARCH.md` Q7
- `.planning/research/ARCHITECTURE.md`: Keep transaction / id remap / 409 section

### Project conventions
- `CLAUDE.md`: UI classes (`btn-primary btn-sm` + `ghost-sm` in `ds-actions`, modal pattern), red-first criteria, test gates

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/server/src/lib/dashboardImport.ts`: an all-or-nothing `db.transaction` plus temp-id remap; the model for Keep.
- `packages/server/src/db.ts`: `createWidget`, layer and dynamic-view creators; dashboards `updated_at` (settings only today).
- `packages/server/src/lib/permissions.ts`, `rbac.ts`, `lib/dashboardAccessDb.ts`: permission checks.
- `packages/server/src/lib/ai/gateway.ts` + `lib/aiDvCompile.ts`: re-validation and compiling AI views into saved templates.
- `packages/server/src/lib/aiSessionViews.ts` + `aiDvRoutes.ts`: temp-view registry and drop.
- Web: `components/AiChangeBar.tsx` (Keep is disabled today), `store/aiSessionStore.ts` (`reset()`, op log), `lib/aiSession/foldSession.ts` / `applySession.ts` (folded change set), `lib/aiDv/aiDvLifecycle.ts` (drops), `store/filterStore.ts` (`dvFilters` re-key), `components/charts/AiChat.tsx` (revert buttons, notes), the `AiLeaveDialog` confirm pattern.

### Established Patterns
- Exact user-facing refusal messages (135); server re-checks everything; reload reverts by construction.
- Adding a route or permission check ripples into count-asserting specs (memory: permission ripple).

### Integration Points
- New Keep route + client call; the bar enables Keep (D-03/D-04); after Keep, the client swaps ids and refetches the dashboard; AI-view filter re-key; temp-view drop.

</code_context>

<specifics>
## Specific Ideas

- Confirm text: "Save AI changes? 3 added · 2 edited · 1 removed. Filters are not saved."
- 409 text: "Someone else changed this dashboard since you started. Your AI changes weren't saved."

</specifics>

<deferred>
## Deferred Ideas

- "Reapply my AI changes on the latest dashboard" after a 409 (replay ops on top of the newer version). This is a new capability and not in this milestone.

</deferred>

---

*Phase: 141-keep-persist-ai-changes*
*Context gathered: 2026-10-21*
