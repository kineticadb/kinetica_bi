# Phase 60: Radio Renderer + Wiring + Persistence + MCP-Seam Doc - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The RUNTIME half of the radio widget: a `RadioGroupRenderer` that, when a viewer selects an option, applies that option's action to the target LIVE (via the transient overlay), with the designer-configured default applied on dashboard open. Plus the store work needed to make "switch replaces this radio's contribution" correct (source-control-keyed contributions), and documenting `applyWidgetAction` + the action envelope as the future AI/MCP seam. Closes RADIO-V111-03 + SEAM-V111-01. NO AI widget, NO MCP server built. Live UAT is Phase 61.

</domain>

<decisions>
## Implementation Decisions

### Persistence / reload semantics (RADIO-V111-03 — REFRAMED, locked)
- A viewer's runtime selection is **session-only / transient** — it writes the overlay, never PATCHes. On dashboard reload or dashboard-switch the session overlay clears (the `widgetActionStore.reset()` is already the 7th cleanup in DashboardOpen).
- On mount, the renderer applies the radio's **configured `defaultOptionId`** transiently (neutral if none). So "the radio's selected option persists" = the DESIGNER-configured default re-applies on open; a viewer's click does NOT persist. (RADIO-V111-03's literal "selectedIndex part of config" is satisfied by `defaultOptionId`, not by persisting live clicks — consistent with the transient-for-everyone decision.)
- `selectedOptionId` runtime state is the renderer's own transient state (component-local or a session-keyed slice — Claude's discretion); NOT written to the widget's persisted config.

### Switch-replace semantics (locked) → store refactor (the meaty/risky part)
- Re-selecting an option REPLACES this radio's ENTIRE contribution (not a merge): option B's patch fully supersedes option A's, so any field A set that B doesn't reverts to the target's saved baseline.
- The Phase 58 store keys overrides by TARGET id only and `applyXOverride` MERGES (`{ ...existing, ...patch }`) — it CANNOT do this. **Refactor:** track overlay contributions keyed by **source-control id** (the radio widget's id): a control's contribution = its currently-selected option's full patch (per target). The effective per-target overlay = merge of all controls' current contributions for that target (last-writer-per-field by control order — cross-control conflict is acceptable, not a focus). A control replacing its contribution drops fields it no longer sets → revert to baseline.
- **Minimize consumer churn (recommended):** keep the CONSUMER-facing read as the derived per-target effective overlay (the same `widgetOverrides[id]`/`layerOverrides[id]`/`dynamicViewOverrides[id]` shape MapChartRenderer/WidgetRenderer already consume), DERIVED via a selector from the control-keyed contributions. Then MapChartRenderer (`effectiveLayers`) + WidgetRenderer (`effectiveWidget`) change little or nothing; only the store internals + `applyWidgetAction`'s write-side (write a control's contribution, replacing its prior) + the store/canary specs change. Confirm this keeps the existing canary CASE A/B/C green (migrate spec shape only where the write API changed).

### RadioGroupRenderer (RADIO-V111-03)
- Reads its config (options, defaultOptionId, orientation, title) LIVE at render time (read-once-at-mount trap — read `widget.config` in the component body, apply via an effect keyed on the resolved selectedOptionId; NEVER a mount snapshot). Renders the radio options (vertical/horizontal) + optional title.
- Selecting an option → calls `applyWidgetAction` with that option's action (writes this control's contribution; live target update, no remount, no PATCH). Default applied on mount.
- Dangling target / rejected action → the Phase 58 typed no-op + toast (already built) — no crash. Decoupled from filter/materialize (the engine already is; the renderer adds a static-grep-safe consumer like DataFilterRenderer).

### MCP/AI seam documentation (SEAM-V111-01 — design + document ONLY)
- Document `applyWidgetAction` + the `{ target, configPatch }` envelope as the hook a future AI chat widget / MCP server reuses: where it lives, the contract, allow-list as the safety boundary, and the concrete MCP tool shape (the zod schema as `inputSchema`; an MCP tool calls the existing `PATCH /api/widgets/:id` + layer/dv PATCH routes — server surface already exists). A markdown doc (e.g. in the repo docs or a phase artifact) + a code-comment pointer. Build NO AI, NO MCP server.

### Claude's Discretion
- The exact control-keyed contribution data structure + derived-overlay selector design (keep consumer shape stable if feasible).
- Where `selectedOptionId` transient state lives (component-local vs session slice).
- Radio option visual styling (theme tokens, green accent) + active-option indication.
- The MCP-seam doc's exact location/format.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### What this builds on / refactors
- `packages/web/src/store/widgetActionStore.ts` — the overlay store to REFACTOR (target-keyed merge → control-keyed contributions + derived per-target effective overlay).
- `packages/web/src/lib/applyWidgetAction.ts` — dispatch; write-side changes to record a control's contribution (replacing its prior). Keep TRANSIENT-ONLY + idempotency + dangling-safety.
- `packages/web/src/components/charts/MapChartRenderer.tsx` (`effectiveLayers` ~482-495) + `WidgetRenderer.tsx` (`effectiveWidget` ~248-252) — overlay consumers; keep reading the derived per-target overlay (minimal change if the selector preserves shape).
- `packages/web/src/components/charts/actionEngine.canary.spec.tsx` + `widgetActionStore.spec.ts` + `applyWidgetAction.spec.ts` + `LayersLegendPanel.spec.tsx` — specs that assert the override shape; migrate to the refactored API as needed (keep canary CASE A/B/C green).

### Phase 59 inputs (the radio config the renderer consumes)
- `packages/web/src/lib/radioGroupConfig.ts` — `RadioGroupConfig`/`RadioOption` types + `RADIO_GROUP_DEFAULT_CONFIG`.
- `packages/web/src/components/charts/definitions/radio-group.ts` — the registry def (needs a `renderer`/runtime entry wired now).
- `packages/web/src/components/charts/DataFilterRenderer.tsx` — renderer + sole-materialize-decoupling precedent (static-grep pattern).

### Engine + prior context
- `.planning/phases/58-action-engine-contract-allow-list-canary/58-CONTEXT.md` + `58.1-.../58.1-01-SUMMARY.md` — the transient overlay model + v2 allow-list + deep-merge.
- `.planning/phases/59-.../59-CONTEXT.md` — the data model + switch-semantics forward-flag (this phase implements it).

### Phase contract
- `.planning/ROADMAP.md` §Phase 60 — goal + success criteria.
- `.planning/REQUIREMENTS.md` — RADIO-V111-03, SEAM-V111-01.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The transient overlay store + `applyWidgetAction` + allow-list (58/58.1) — the renderer dispatches through them.
- `effectiveLayers` / `effectiveWidget` deep-merge consumers (58/58.1) — read the derived overlay.
- DataFilterRenderer — renderer scaffold + the static-grep decoupling assertion pattern (no filter-store imports / filterVersion).
- Phase 59 `RadioGroupConfig`/`RadioOption` + registry def.

### Established Patterns
- Read config LIVE at render time, never a mount snapshot (the read-once-at-mount trap — GAP-24-01-A / 54-01..09 / 58.1 lineage).
- Session-scoped store reset on dashboard-switch/logout (filter/filterView/widgetAction precedent).
- Static source-grep decoupling assertion (DataFilterRenderer / actionEngineDecoupling.spec).

### Integration Points
- New `RadioGroupRenderer.tsx` + wire it into the registry def's runtime + `WidgetRenderer` dispatch.
- `widgetActionStore` refactor (control-keyed contributions + derived overlay) + `applyWidgetAction` write-side.
- Migrate the 4 affected specs to the refactored store API.
- MCP-seam doc artifact.

### Test-gate reality
- Frontend vitest DETERMINISTIC → 100% (run from packages/web; baseline 1914). New: renderer (default-on-open, select→apply live no-remount, switch-replace reverts unset fields, dangling/rejected toast, decoupling grep); refactored store/canary specs stay green. `cd packages/web && npx tsc --noEmit` clean (NO -p). Expected ZERO server changes (the MCP seam is DOC only).

</code_context>

<specifics>
## Specific Ideas

- The whole v1.11 payoff lands here: a viewer clicks a radio option and the map LIVE-switches render mode / class-break config, with no permission friction and no mutation of the shared dashboard.
- The MCP-seam doc is the bridge to the deferred AI milestone — keep the envelope + allow-list framed as exactly what an AI/MCP tool emits.

</specifics>

<deferred>
## Deferred Ideas

- AI chat widget + MCP server BUILD — v2 (this phase only documents the seam).
- Additional control widget types, filter-setting actions, cross-dashboard targeting — v2.
- Persisting a viewer's runtime selection / per-user saved view state — not v1.11 (transient).
- Sophisticated cross-control conflict resolution beyond last-writer-per-field — not needed for v1.

</deferred>

---

*Phase: 60-radio-renderer-wiring-persistence-mcp-seam-doc*
*Context gathered: 2026-06-10*
