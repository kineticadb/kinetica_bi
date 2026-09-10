# Phase 59: Radio-Group Widget — Registry Def + Config Panel - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a net-new `radiogroup` control widget TYPE (registry definition + a `CustomConfigPanel`) so an operator can ADD a radio group to a dashboard and AUTHOR its options — each option an independent multi-field action bound to a same-dashboard target, validated against the Phase 58 allow-list and saved to the widget's config. NO runtime behavior this phase: selecting an option, applying it to a target, default-on-open, and switch semantics are all Phase 60. This phase is purely "the widget exists + you can configure it + the config is valid + it persists."

</domain>

<decisions>
## Implementation Decisions

### Widget type + registry
- New `radiogroup` chart-type definition (mirror `data-filter.ts` / `legend.ts`): `CustomConfigPanel: RadioGroupConfigPanel`, `usesDataSource: false` (no table/SQL/drill-down), no metric/group-by. Appears in the add-widget surface alongside existing types.

### Config data model (persisted in the radio widget's `config`)
- `{ title?: string, orientation: "vertical" | "horizontal", defaultOptionId?: string, options: RadioOption[] }`.
- `RadioOption = { id: string, label: string, action: WidgetAction }` where `action` is the Phase 58 envelope `{ target: { kind, id }, configPatch }`.
- **Each option carries its OWN independent action** — different options may target different widgets/layers/dynamic-views, and a single option's `configPatch` may set MULTIPLE allow-listed fields at once (e.g. `{ renderMode: "classbreak", cb_config: {…} }`).
- The runtime *selected* option is NOT persisted as config — it's transient (Phase 60). What persists is `defaultOptionId` (optional).

### Authoring UX (the core of this phase)
- Per option: a **label** + a **target picker** (same-dashboard widget / map layer / dynamic-view) + a **`configPatch` editor** with TWO authoring affordances:
  1. **"Capture from target" button** — snapshots the chosen target's CURRENT allow-listed config subset into the option's `configPatch` (operator configures the target visually via the normal UI, then captures — the Power BI "bookmark" pattern). Capture must read the right source per target kind: widget.config (from props `widgets`), map-layer config (from `useDashboardLayersStore`, incl. the TOP-LEVEL `track_config`/`cb_config`), dynamic-view config; and extract only allow-listed fields.
  2. **JSON editor** (textarea) showing/editing that `configPatch` object — for inspection + power-user tweaking. This is literally the envelope's `configPatch` a future AI would emit.
- **Allow-list validation at SAVE** via Phase 58 `validateActionPatch`: out-of-list / wrong-type / enum-violating / meta+proto keys are rejected; an invalid or empty binding cannot be saved (surfaced inline). This REFINES RADIO-V111-02: JSON authoring IS allowed, but it's allow-list-validated — never "arbitrary/unsafe" free-form.

### Default selection + layout
- `defaultOptionId` is OPTIONAL. If set, Phase 60 applies that option transiently on dashboard open; if unset, neutral initial state (target shows its own saved config until a viewer clicks).
- Layout: vertical by default + a horizontal orientation toggle in config; optional widget title above the group. Match existing widget-config conventions (theme tokens, green accent).

### Switch semantics — DECISION RECORDED HERE, IMPLEMENTED IN PHASE 60
- Last-selected option's patch WINS; the radio REPLACES its own prior overlay contribution on each selection (switching A→B swaps A's fields out for B's; fields A set but B doesn't revert to the target's SAVED baseline).
- **FORWARD FLAG for Phase 60 + the Phase 58 store:** the Phase 58 overlay store keys by TARGET id only (`widgetOverrides`/`layerOverrides`/`dynamicViewOverrides`). Clean per-radio replace (and not clobbering other controls that target the same widget) likely needs overlay contributions keyed by **source control id** → target → patch, with the effective per-target overlay computed as a merge of all controls' current contributions. This is a Phase 60 concern (runtime wiring) and MAY require extending the Phase 58 `widgetActionStore`. Not built in Phase 59.

### Claude's Discretion
- Option `id` generation; add/remove/reorder-option row UX; exact Capture-button placement.
- How the target picker lists targets (label by widget title / layer name / dv name); how it handles a target with no allow-listed fields.
- JSON editor presentation (inline textarea vs expandable); whether Capture pre-fills then the operator edits.
- Whether to show a small read-only preview of the resolved action per option.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 58 engine (consumed at save-time validation)
- `packages/web/src/lib/widgetAction.ts` — the `WidgetAction` envelope type + `WidgetActionSchema` (the per-option `action` shape).
- `packages/web/src/lib/actionAllowList.ts` — `validateActionPatch` + `ALLOW_LIST_VERSION` + the allow-listed fields per target kind (drives the Capture subset + save validation; includes top-level `track_config`/`cb_config`).
- `packages/web/src/store/widgetActionStore.ts` — the overlay store (Phase 60 runtime target; the switch-semantics forward-flag concerns its keying).

### Config-panel precedents (mirror these)
- `packages/web/src/components/charts/LegendConfigPanel.tsx` — reads `widgets` from PROPS (CRITICAL: `WidgetConfigModal` is OUTSIDE `DashboardContextProvider`, so the same-dashboard target picker must use `props.widgets`, not context). `ConfigPanelProps.widgets` already threaded.
- `packages/web/src/components/charts/DataFilterConfigPanel.tsx` — N-row config editor + `usesDataSource:false` precedent.
- `packages/web/src/components/charts/CbConfigForm.tsx` — nested/complex config editor pattern (relevant if the JSON editor needs structure for cb_config).
- `packages/web/src/components/charts/definitions/data-filter.ts` + `legend.ts` — the registry-definition shape (`CustomConfigPanel`, `usesDataSource:false`).
- `packages/web/src/store/dashboardLayersStore.ts` (layer targets) + `packages/web/src/api/client.ts:972` `listDynamicViews` (dv targets) — target-list sources.

### Phase contract
- `.planning/ROADMAP.md` §Phase 59 — goal + success criteria.
- `.planning/REQUIREMENTS.md` — RADIO-V111-01, RADIO-V111-02 (read RADIO-V111-02 through the JSON-validated-by-allow-list refinement above).
- `.planning/phases/58-action-engine-contract-allow-list-canary/58-CONTEXT.md` + `58-VERIFICATION.md` — what the engine guarantees.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `validateActionPatch` / allow-list (Phase 58) — save-time validation + the field set Capture extracts.
- `ConfigPanelProps.widgets` (LegendConfigPanel precedent) — same-dashboard target list without DashboardContext.
- `useDashboardLayersStore` (global Zustand, accessible in the config modal) — layer targets + the source Capture reads for layer config.
- `listDynamicViews` (client.ts:972) — dynamic-view targets.
- CbConfigForm — pattern for editing a structured config object (cb_config).

### Established Patterns
- `CustomConfigPanel` + `usesDataSource:false` registry def (data-filter/legend).
- Theme tokens only + green accent (ui-consistency memory).
- track_config/cb_config are TOP-LEVEL DashboardLayerDto fields ([[track-config-toplevel-field]]) — Capture + allow-list must treat them as top-level for layer targets.

### Integration Points
- New `RadioGroupConfigPanel.tsx` + `definitions/radio-group.ts` (registry entry) + registry `index.ts`.
- The config panel imports `validateActionPatch` (Phase 58) for save-time validation.
- No server changes (config persists via the existing widget config-save path; the radio's config is a JSON blob like every other widget).

### Test-gate reality
- Frontend vitest DETERMINISTIC → 100% (run from `packages/web`; baseline 1828). New: registry-add, option authoring (add/remove, target pick, Capture, JSON edit), save-time allow-list validation (valid saves; out-of-list/empty rejected). `npx tsc --noEmit` (from packages/web) clean. Expected ZERO server changes.

</code_context>

<specifics>
## Specific Ideas

- Operator's stated need (verbatim): one option might "change to class break rendering and specify all the class break options" — i.e. a single option's configPatch sets `renderMode` + the full `cb_config` together. The Capture button + JSON editor both serve this.
- The JSON object the operator authors IS the future AI/MCP `configPatch` — keep it clean and allow-list-shaped.

</specifics>

<deferred>
## Deferred Ideas

- Runtime: selecting an option → applying it → default-on-open → switch-semantics overlay replacement → live re-render — all Phase 60.
- MCP/AI seam documentation — Phase 60 (SEAM-V111-01).
- Per-control overlay keying in widgetActionStore (if needed for clean switch replace) — Phase 60.
- Additional control widget types, filter-setting actions, cross-dashboard targeting — v2.

</deferred>

---

*Phase: 59-radio-group-widget-registry-def-config-panel*
*Context gathered: 2026-06-10*
