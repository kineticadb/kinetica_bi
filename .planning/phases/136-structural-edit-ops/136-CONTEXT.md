# Phase 136: Structural & Edit Ops - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning

<domain>
## Phase Boundary

The AI can add, remove and edit visualizations and heatmap map layers, and place, resize and reorder widgets, all as session-only changes in the Phase 134 session layer (undoable, saved only by Keep). Every change is validated by the Phase 135 gateway against the live schema. A bad table or column reference is repaired within 2 attempts or refused, and never applied.

Requirements: AIACT-V20-01..06, AIACT-V20-10, AIACT-V20-11.

Out of this phase:
- The AI chat widget and its UI (clarification buttons, highlights, Keep/Discard bar visuals): Phase 137. This phase is exercised through scripted ops, the server agent loop with the scripted provider, and the DEV harness (`window.__kbiAiHarness`).
- Filters: 138. Dynamic views: 139. Query tools: 140. Keep/save and edit-rights enforcement: 141.
- Raster, class-break and track layers: AI-F12.

</domain>

<decisions>
## Implementation Decisions

### Chart edits (AIACT-V20-01/02/03)
- **D-01 The AI never writes SQL.** It supplies structured fields only; the app generates the widget SQL with the same generator the config panel uses at Apply (`ChartConfigPanel` `generatedSql`). Today `widget.config.sql` is frozen at Apply time, so an AI edit must regenerate it, or the edit silently does nothing (see TD-V20-ALLOWLIST-KEYS).
- **D-02 Changing chart type:** allowed only among compatible types that share metric and group-by (bar, line, pie), keeping the fields. An incompatible change (e.g. bar to records) is done as remove plus add.
- **D-03 Editable chart fields:** metric and aggregation; group-by, sort and top-N (operator confirmed: keep the requirement wording); title and axis/legend labels (plain text); colours from a **named palette or theme vocabulary only**, never hex. The model cannot emit hex (roadmap criterion 2), so the palette names map to token-driven colours.
- **D-04 A chart's table cannot be changed.** Re-pointing a chart at another table is refused; the AI adds a new widget instead.
- **D-05 Marking edited saved widgets:** a saved widget the AI has edited in the session gets an **"AI edited" state flag**, like AI-added widgets, so it can be highlighted and badged. This phase owns the flag and selector; Phase 137 owns the final visuals. A minimal existing-class badge is acceptable here.

### Removing & rearranging (AIACT-V20-02/05/10)
- **D-06 Removing saved widgets or layers asks once per conversation.** The first time the AI wants to remove **saved** content, it must ask ("Remove the saved Pie Chart? Yes / No") instead of applying. After a Yes, later removals of saved content in the **same conversation** need no confirmation. The approval is cleared by Keep, Discard or reload, along with the session history (134 D-04).
  - Content the AI added itself can always be removed without asking.
  - This phase builds the gate and approval state, plus a scripted or harness way to answer it. The clickable Yes/No UI is Phase 137's clarification choices (AIWID-V20-06).
- **D-07 Moving saved widgets:** the AI may **freely** resize and reorder **saved** widgets in the session, without asking. It's revertible and persisted only by Keep. This refines 134 D-14: *automatic placement* of a new widget never pushes saved widgets, but explicit AI layout ops may move them.
- **D-08 Placement** (carried from 134 D-14): new widgets fill gaps first, then go below existing content, with sensible sizes per type (KPI or big number small, map large, records table wide). **If no gap fits, put it below everything**; the answer says where it went.
- **D-09 At most 6 new widgets per answer** (env-tunable, Claude names the variable, default 6). Extra add ops are skipped and reported in the change log; they are never applied.

### Heatmap layers via AI (AIACT-V20-04/05/06)
- **D-10 Heatmap style settings the AI may set:**
  - colour ramp (only the named ramps the layer editor offers; never hex)
  - radius/blur
  - opacity
  - weight/value column (numeric, validated against the live schema)
- **D-11 Choosing a map when several exist:** put the new heatmap on the **map that already shows the same table**. Ask (clarification choices) only if that still leaves more than one candidate or none. If there is exactly one map, use it.
- **D-12 No map on the dashboard:** one answer **adds a map widget** (large, placed per D-08) **plus the heatmap layer**. This counts toward the D-09 cap.
- **D-13 Saved layers follow the same rules as widgets:**
  - The AI may restyle saved **heatmap** layers freely; other layer types can't be restyled (AI-F12).
  - Any layer type may be **removed**, under the D-06 ask-once rule.
  - Any layer type may be **hidden or shown**.
  - AI-added (negative-id) layers must never reach `apiUpdateLayer` (134 D-16).
- **D-14 Render on both paths:** an AI-added or restyled heatmap must render through **both `buildWmsParams` sites in MapChartRenderer**, with tiles and legend (roadmap criterion 4). The automated, operator and human-verify map test plan in ROADMAP.md Phase 136 applies.

### Bad references & refusals (AIACT-V20-11)
- **D-15 Quiet repair with a hint:** on an unknown column or table, the gateway's rejection tells the AI the closest valid names, e.g. "no column `fare`; closest: `fare_amount`, `total_amount`". The AI retries, at most 2 attempts per bad reference.
  - The user just sees the corrected result. The answer may mention what was used.
  - Hints come **only from tables and columns the user can access**.
- **D-16 Refusal is a plain answer plus what to try.** After 2 failed attempts, or when a request is impossible (no such table, no access, unsupported type or layer, chart table change), that part is **not applied** and the answer says why and what's available.
  - **Other valid parts of the same answer still apply.** This is per-op skip, compatible with 135 atomic apply: the answer's ops still apply only if the answer completes. A rejected op is reported as skipped, never applied.
- **D-17 No access looks like not found:** "I couldn't find a table called X." Never disclose that an inaccessible table exists (AISAFE-V20-03). The same applies to repair hints.
- **D-18 Fixing W2 from 135 verification:** the agent loop's rejection counter is keyed by tool name and never resets, so after 2 rejections, later **valid** calls of that tool are blocked and recorded only in `tools`.
  - Key the counter per bad reference/target, or reset it on success. The 2-attempt limit applies to repairing **the same** bad reference.
  - Surface blocked calls in `skipped` so the change log and answer show them.

### Carried constraints
- **D-19 TD-V20-ALLOWLIST-KEYS is owned here.** Chart `metric`/`aggregation` are keyed under widget type `"chart"`, which matches no real type, while renderers read `metricColumn` and a frozen `config.sql`. Layer `opacity` is 0–1 in the allow-list while the renderer reads `config.POINTOPACITY` 0–100.
  - Fix these with a translation seam like 134-10's `WIDGET_OVERLAY_KEY_MAP`.
  - The same fix makes the v1.11 radio controls for those fields work too. Verify them.
- **D-20 Rights:** session-only ops are allowed for any `ai:use` user (135 D-16), with per-op checks for view and table/column access. Edit rights are enforced at Keep (141).
- **D-21 Layer column checks:** a layer `patch` today gets the allow-list check but no column-existence check (135 verification info item). Add live-schema column checks for heatmap layer ops (weight column, geometry/lat-lon).

### Claude's Discretion
- Op and tool payload shapes: extending `add_widget`/`add_layer` and adding layout ops such as `move_widget` / `resize_widget` or a single `set_layout`. Must stay inside the shared `AiOp` contract and the strict-schema style.
- The compatible-type matrix details (D-02), per-type default sizes (D-08), the palette and ramp vocabulary names (D-03, D-10), and how "closest name" is computed (D-15).
- How the D-06 approval is represented (a session-layer flag plus a server-side "needs confirmation" outcome) and how the harness answers it.
- The env variable name for D-09.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope & requirements
- `.planning/ROADMAP.md` § Phase 136: goal, 4 success criteria, map test plan, scope note, and the carry-forward notes (W2, layer column checks)
- `.planning/REQUIREMENTS.md`: AIACT-V20-01..06, -10, -11; AI-F12 (other layer types)
- `.planning/PROJECT.md`: TD-V20-ALLOWLIST-KEYS entry (Active tech debt)

### Prior phase decisions
- `.planning/phases/134-session-layer-engine-client-no-llm/134-CONTEXT.md`: D-01..D-17. Session layer, edit lock, D-12/D-13 session-only geometry, D-14 placement, D-16 eye toggle and negative-id layers
- `.planning/phases/134-session-layer-engine-client-no-llm/134-10-SUMMARY.md`: `WIDGET_OVERLAY_KEY_MAP` translation-seam pattern (the map `show_*` fix)
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-CONTEXT.md`: D-01..D-17 (D-16 session-only ops for any `ai:use` user)
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-VERIFICATION.md`: W2 (rejection counter) and the layer patch column-check info item
- `.planning/phases/135-server-gateway-agent-loop-providers-governance-core/135-SPIKES.md`: S6 tool-calling results (Gemini native, provisional; daily free-tier cap of 20 requests per model, so plan live checks sparingly)
- `.planning/phases/133-ai-contract-shared-package-ssync-f6-fix-spikes/133-SPIKES.md`: S1 (WMS render check pattern), S3/S5 (layout spike) if present

### Milestone research
- `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/SUMMARY.md`: v2.0 architecture and pitfalls

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/shared/src/aiOp.ts`: `AiOpSchema`. `add_widget {tempId,type,title,config}`, `add_layer {tempId,widgetId}` (payload marked "extended in Phase 136"), `remove_widget`, `remove_layer`, and `patch {target, configPatch}`.
- `packages/shared/src/actionAllowList.ts` (v3): per-kind allow-listed fields and their locations (`widget.config`, `layer.config`). The source of the TD-V20-ALLOWLIST-KEYS mismatches.
- `packages/server/src/lib/ai/{gateway,agentLoop,liveSchema}.ts`, `tools/{mutate,read,registry}.ts`: gateway check order, the live `SELECT * FROM t LIMIT 0` as the user, the per-tool rejection counter (D-18).
- `packages/web/src/lib/aiSession/{applySession,foldSession,devHarness}.ts`, `store/aiSessionStore.ts`: op-log, cursor, fold, and the DEV harness for scripted ops.
- `packages/web/src/lib/widgetOverlayKeys.ts`: `WIDGET_OVERLAY_KEY_MAP`, the pattern for D-19.
- `packages/web/src/components/charts/definitions/*.ts`: per-type widget definitions (bar, line, pie, table, bignumber, records, map, …), with default configs and sizes.
- `packages/web/src/components/charts/ChartConfigPanel.tsx`: `generatedSql`, the SQL generator to reuse for D-01.
- `packages/web/src/components/charts/MapChartRenderer.tsx` (two `buildWmsParams` sites), `lib/wmsUrlBuilder.ts`, `components/charts/KineticaWmsLayerForm.tsx` / `MapConfigPanel.tsx`: heatmap style fields and ramps (D-10, D-14).
- `packages/web/src/components/DashboardsPage.tsx`: react-grid-layout grid, `onLayoutChange` (must never persist AI geometry, 134 D-13), and default layer field names (~line 1342).

### Established Patterns
- Translation seam for allow-list keys versus renderer keys (134-10).
- Negative temp ids for AI-added widgets and layers; a reserved source id (`AI_SOURCE_ID=0`) in `widgetActionStore`.
- Grep acceptance criteria must read 0 before the work; use mutation proofs and positive controls (CLAUDE.md).
- Map changes must wire BOTH MapChartRenderer `buildWmsParams` sites plus their dependency keys (memory: map WMS is a separate read path).
- Portal any modal; reuse `global.css` classes; no hex.

### Integration Points
- Gateway: new op kinds and validators, plus column checks for layer ops.
- Agent loop: rejection counter (D-18); confirmation outcome for D-06; add cap (D-09).
- Web session fold: layout ops, the "AI edited" flag, and regenerating widget SQL after an AI field edit.
- Radio controls: fields fixed by D-19 must be verified through v1.11 radio controls too.

</code_context>

<specifics>
## Specific Ideas

- Operator on removal: "it should only ask once and then remember moving forward". This means once per conversation (cleared by Keep, Discard or reload).
- The operator chose **"Freely"** for rearranging saved widgets. Only removal asks.
- Operator test plan for maps (2026-10-09):
  - Automated: a validator round-trip against real saved map and heatmap configs, plus a `buildWmsParams` snapshot on both sites.
  - Operator-run: a WMS GetMap check (200, image/png, not blank).
  - Human-verify: light and dark.
- Free-tier Gemini allows 20 requests per day per model, so live UAT for this phase should be a handful of targeted asks. Use the scripted provider and the harness for everything else.

</specifics>

<deferred>
## Deferred Ideas

- The clickable Yes/No confirmation for removing saved content, and the clickable map choice: Phase 137 (AIWID-V20-06 clarification choices). This phase builds the gate and state.
- Restyling raster, class-break and track layers: AI-F12.
- Persistent "don't ask again" removal approval per user or dashboard: rejected for now (per-conversation chosen). Revisit only if the operator asks.

</deferred>

---

*Phase: 136-structural-edit-ops*
*Context gathered: 2026-10-13*
