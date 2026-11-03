# Phase 139: Session-Only Dynamic Views - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning

<domain>
## Phase Boundary

The AI can add a session-only dynamic view from a structured description, point widgets or map layers at it (map tiles follow, both `buildWmsParams` sites), and remove a dynamic view. The server compiles the description to SQL with quoted identifiers and a server-chosen name; the model never submits SQL. The temporary Kinetica views never outlive the session (undo, discard, dashboard switch, logout, server restart), under a per-session cap and TTL.

Requirements: AIACT-V20-07, AIACT-V20-08, AISAFE-V20-04, AISAFE-V20-06.

Out of scope: editing an existing view in place (add/remove only), query mode / guarded SELECT (140), saving anything (Keep, 141), generate + audit viewer (142).

</domain>

<decisions>
## Implementation Decisions

### Filters & row threshold
- **D-01 Follow dashboard filters, same as saved views.** An AI view's base source is `{view}` (the source table after active filters), so a click or AI filter on the base table narrows it and it re-materializes on filter change, exactly like a saved dynamic view. Keep (141) must be able to save it as a normal `dashboard_dynamic_views` row with no behaviour change.
- **D-02 Aggregated views can build unfiltered.** A view with group-by/aggregates builds over the unfiltered base if its *output* row count fits max_records. A non-aggregated row view keeps the existing rule: it shows "needs a filter" / "too many rows" until filters bring it under max_records.
- **D-03 Saved views get the same rule in this phase** so AI and saved views behave identically and Keep changes nothing. (Saved views are free SQL templates, so the rule is likely "output row count ≤ max_records" rather than detecting GROUP BY; that's up to the planner, but existing saved-view behaviour for non-aggregated templates must not regress.)
- **D-04 max_records:** a server env default (e.g. `AI_DV_MAX_RECORDS`) is the ceiling; the spec may ask for less, never more.
- **D-05 Over-threshold answer:** when an AI view is waiting for a filter or is over the threshold, the answer says so and offers a follow-up filter suggestion (e.g. "Filter to the last 30 days"). The widget shows the existing over-threshold state.

### What a view can express (structured spec)
- **D-06 Spec shape:** one base table (read through `{view}`) + optional joins + columns + filters + group-by + aggregates + sort + limit. No raw SQL anywhere in the spec. An unknown table or column is rejected (live schema, per 136 repair/refuse rules).
- **D-07 Joins are in scope.** The operator was explicit: "Dynamic views can join multiple tables together using a materialized view. That is the benefit of it." This amends AISAFE-V20-04's field list (table, columns, filters, grouping, aggregates, sort, limit) to add joins; update REQUIREMENTS.md wording in this phase.
  - Up to N joined tables, env cap (e.g. `AI_DV_MAX_JOINS`), **default 2**.
  - INNER and LEFT only; equality keys only (`a.col = b.col`, one or more AND-ed pairs, type-compatible per the live schema). No cross joins, no expressions in ON.
  - Each joined table is read through its own current filter view when it has one, otherwise the raw table. The base table follows filters (D-01).
  - The user must have access to every joined table/column (per-op check, 135 D-16).
- **D-08 Join cost guard:** a row-count preflight before materialize, compared with max_records; the materialize is SQL-tagged so the existing tag → find → `/admin/alter/jobs` cancel can stop it on Cancel/timeout (S7: Kinetica has no statement timeout or cost estimate; abort alone does not cancel).
- **D-09 Aggregates:** count, count distinct, sum, avg, min, max, **plus median and percentiles** (operator chose the wider set). Research must confirm the Kinetica functions and their behaviour on GPU tables (approximate vs exact).
- **D-10 Time buckets:** group-by may be `{column, bucket: minute|hour|day|week|month|year}` on date/time columns only; compiled server-side.
- **D-11 No computed/derived columns:** columns, aggregates and time buckets only.
- **D-12 Limit:** optional; default = maximum = the view's max_records.

### Lifetime, cap & TTL
- **D-13 Same keep-alive as saved views:** standard `DEFAULT_VIEW_TTL_MINUTES` (5) TTL, touched by `useViewKeepAlive` while the dashboard is open. Explicit DROP on undo, revert, discard, dashboard switch and logout; the TTL is only the safety net for crashes and closed tabs.
- **D-14 Per-session cap:** env (e.g. `AI_DV_MAX_PER_SESSION`), **default 5**, counting AI views (not their filter re-materializations). Over the cap the gateway refuses with a clear message ("Remove a view first…").
- **D-15 Undo/revert drops at once; redo rebuilds** from the stored spec (same name pattern, new suffix). Frees the cap immediately.
- **D-16 Server restart:** startup sweep that lists views matching the AI name prefix and drops them; TTL covers anything missed. Verified by listing views in Kinetica. **Research flag:** views are created as the user; confirm what identity the server can use at boot to list/drop them. If none, record the gap and fall back to TTL-only for restart (do not quietly drop the criterion).
- Server-chosen names carry a session-scoped suffix so two tabs of the same user don't collide (research ARCHITECTURE option B); never `CREATE OR REPLACE` onto a real view; prefix-validated on drop.

### Removal & visibility
- **D-17 Removing a view with dependents:** a widget/layer whose referenced columns all exist on the view's base table is repointed to that table; otherwise it is removed in the same answer. The answer lists what was repointed/removed; one undo restores all of it. No dangling references.
- **D-18 The AI may remove a saved dynamic view, session-only** (others still see it; it becomes real only at Keep). Consistent with 135 D-16; `dynamic_views:manage` is checked at Keep (141). Session removal must not drop materializations other users depend on.
- **D-19 Add/remove only, no `edit_dynamic_view` op.** "Change it" = add new view + repoint + remove old, within one answer.
- **D-20 Labelling:** a readable display name from the spec (e.g. "Trips by hour") plus an "AI" tag, like the AI filter chips, wherever the view name shows (widget source label, filter badges, the locked Dynamic Views list). The server-chosen Kinetica name is never shown.

### Post-research decisions (operator, 2026-10-20, after 139-RESEARCH.md)
- **D-21 Joined tables after Keep: accept the difference.** A session AI view reads joined tables through their current filter view (D-07); a saved view only substitutes `{view}` for the base, so after Keep the join reads the raw tables. Accepted for now and **logged as a known difference** for Phase 141 / later (do not build per-joined-table filter tokens in this phase).
- **D-22 Widgetless filtered joined table: defer, read raw.** Only joined tables that already have a filter view are read filtered; no extra orchestrator viz keys to create filter views for widgetless tables.
- **D-23 Drill clicks on AI-view widgets filter them like a saved view.** In scope: add a session-view (`dynamicViewId < 0`, registry-backed) branch to dv filtering so a click narrows an AI view exactly like a saved one (no 404, no ignoring the click). Filter badges read `filterCombinationStore`.
- **D-24 Rebind via edit ops.** `edit_widget` / `edit_layer` may set the view binding (`config.dynamicViewId` / top-level `dynamic_view_id`) to an AI or saved view whose columns fit, validated like add (columns checked against the view's columns). "Change a view" = add new view → rebind dependents → remove old view, in one answer. This narrows the `dynamic_view_id` data-binding block in `actionAllowList.ts` for AI ops only, with validation. D-17's auto-repoint to the base table stays as the remove-time fallback.
- **D-25 Removing a SAVED dynamic view follows 136 D-06** (ask once per conversation before removing saved content; same approval flag). Removing an AI-created view needs no confirmation.
- **D-26 Record the live Kinetica version** in the first UAT step; research verified functions against 7.2 docs (APPROX_MEDIAN / APPROX_PERCENTILE, DATE_TRUNC). If it isn't 7.2.x, re-check those.
- Median/percentile are **approximate** (`APPROX_MEDIAN`, `APPROX_PERCENTILE`); answer copy and tool descriptions must say so. D-09 stands with that caveat.

### Carried forward (not re-asked)
- S1 (133): ad-hoc inline materialize as a non-admin user works; no `dashboard_dynamic_views` row; dv column source = `SELECT * FROM <view> LIMIT 0`.
- S7 (133): grants don't limit the user; all limits are app-side.
- 135 D-16: any `ai:use` user who can view the dashboard and access the tables may do session ops; edit rights enforced at Keep.
- 134 D-08 / D-15: Dynamic Views editor locked during an AI session; leaving warns, then discards and runs cleanup hooks (this phase wires the DROPs into them).
- 138 D-01 / D-03: filters are whole-source; dv-backed widgets filter via the dv filter slice.
- Memory: maps are a separate read path. FROM-swaps must wire `MapChartRenderer` (both `buildWmsParams` sites + dep keys), not just `WidgetRenderer`. Filter badges read `filterCombinationStore`, not legacy `filterViewStore`.

### Claude's Discretion
- Exact spec schema (zod) in `packages/shared`, and filter operators inside the spec (reuse the 138 filter operator set).
- Route shape for ad-hoc materialize (new route vs `dynamicViewDef` in `/api/filter/materialize`).
- How session AI views merge into `dynamicViewStore` / `useDynamicViewMaterializeChain` and the read sites.
- Exact env names and the over-cap / over-threshold message copy (follow 135's exact-message style).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope & requirements
- `.planning/ROADMAP.md` § Phase 139: goal and 4 success criteria
- `.planning/REQUIREMENTS.md`: AIACT-V20-07/08, AISAFE-V20-04 (amend for joins, D-07), AISAFE-V20-06
- `.planning/STATE.md`: locked milestone scope decisions

### Spikes & research
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md` § S1 (ad-hoc dv path, TTL reaping, LIMIT 0 column source) and § S7 (no read-only grants, no timeout, tag/find/cancel)
- `.planning/research/ARCHITECTURE.md`: "Must session-only dynamic views materialize server-side?" (option B ad-hoc inline materialize, naming, permission, cap)
- `.planning/research/PITFALLS.md` § C5: model-generated SQL for dynamic views (cost, TTL, keep-alive, cap)
- `.planning/research/SUMMARY.md` item 4: structured spec, server-chosen names, reaper

### Prior phase decisions
- `.planning/phases/134-session-layer-engine-client-no-llm/134-CONTEXT.md`: D-08 lock scope, D-15 warn-then-discard + cleanup hooks
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-CONTEXT.md`: D-16 session-op rights, atomic buffered ops, caps/message style
- `.planning/phases/136-structural-edit-ops/136-CONTEXT.md`: repair/refuse of bad references, structural op patterns
- `.planning/phases/138-ai-filters/138-CONTEXT.md`: D-01/D-03 source-keyed filters, dv filter slice, AI tag on chips

### Project conventions
- `CLAUDE.md`: UI class conventions, theme tokens, verifiable acceptance criteria (red-first greps), test gates
- `.planning/codebase/CONVENTIONS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/shared/src/aiOp.ts`: `add_dynamic_view` / `remove_dynamic_view` placeholders (currently only `tempId` / `id`), to be filled with the spec.
- `packages/server/src/lib/materializedView.ts`: `CREATE [OR REPLACE] MATERIALIZED VIEW … USING TABLE PROPERTIES (TTL = n)`, the shared materialize path.
- `packages/server/src/lib/dynamicViewSql.ts`: `substituteViewToken` (`{view}` token); `packages/server/src/lib/dynamicViewName.ts`: view naming.
- `packages/server/src/lib/columnGuard.ts`: live-schema column checks (133 SSYNC-F6).
- `packages/server/src/index.ts` ~L1688-2190: dv routes, preview, and the `no_filter` / `exceeds_max_records` threshold logic (D-02/D-03 change lands here).
- `packages/server/src/lib/ai/gateway.ts`, `agentLoop.ts`, `runAnswer.ts`, `packages/server/src/aiRoutes.ts`: the gateway's shape → allow-list → permission → reference → live schema checks.
- `packages/web/src/store/dynamicViewStore.ts`: per-dv materialization state, `dynamicViewVersion`, reset + callsite-resident DROP loop.
- `packages/web/src/hooks/useDynamicViewMaterializeChain.ts`: cascade to include session views.
- `packages/web/src/hooks/useViewKeepAlive.ts`: keep-alive touch (D-13).
- `packages/web/src/store/aiSessionStore.ts`: session layer (already has a `dynamicView` change bucket).
- `packages/web/src/components/charts/MapChartRenderer.tsx` + `packages/web/src/lib/wmsUrlBuilder.ts`: the two `buildWmsParams` sites.
- `packages/server/src/lib/exportRunner.ts`: `principalForSession`, run-as-user pattern; SQL tag/cancel precedent.

### Established Patterns
- Saved dv = SQL template over `{view}` + `max_records`; materialize only under threshold.
- TTL 5 min (`DEFAULT_VIEW_TTL_MINUTES`) + client keep-alive (`TTL_KEEPALIVE_LEAD_MINUTES`); `MAX_COMBINATION_VIEWS_PER_TABLE=10` env-cap style.
- Operator prefers env config over runtime settings stores.

### Integration Points
- DashboardsPage cleanup chain (dashboard switch), App.tsx UNAUTHORIZED reset (logout), aiSessionStore undo/revert/discard → DROP calls.
- Server startup → prefix sweep (D-16).
- Keep (141) will persist AI views via the existing dv create path, so the compiled template must be a valid saved-dv template.

</code_context>

<specifics>
## Specific Ideas

- "Dynamic views can join multiple tables together using a materialized view. That is the benefit of it." Joins are the core value of a dynamic view, not an extra.
- Join cap: "up to a server env cap but default to 2".

</specifics>

<deferred>
## Deferred Ideas

- `edit_dynamic_view` op (change a view in place), not in AIACT-V20-07/08.
- Computed / derived columns and HAVING in the spec.

</deferred>

---

*Phase: 139-session-only-dynamic-views*
*Context gathered: 2026-10-20*
