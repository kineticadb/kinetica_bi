# Phase 93: Filter Scope Config UI — Research

**Researched:** 2026-06-28
**Domain:** Per-visualization filter scope configuration UI — chart widgets + WMS layers
**Confidence:** HIGH (all findings from direct codebase inspection; no training-data guesses)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FSCOPE-V118-01 | Per-visualization source-widget allow-list config (filter-PRODUCING widgets only; not records table / map info popup / legend; default accept-all) | FilterSelectionConfig type already exists in `types/filterSelection.ts`; `resolveFilterSet` already written; orchestrator already reads `w.config.filterSelection`; UI is the missing piece |
| FSCOPE-V118-02 | Filter-scope config on chart widgets AND map WMS layers; layer's filterScope is TOP-LEVEL (like track_config, never in layer.config) | `DashboardLayerDto.filterScope?` already declared in `client.ts:645`; orchestrator already reads `layer.filterScope`; persistence path has 5 gaps to close (see server touch section) |
</phase_requirements>

---

## Summary

Phase 93 is the config UI phase. The engine (orchestrator, stores, read paths) is already built by Phases 88–92. What remains is: (1) a `FilterSelectionPanel` component, (2) integrating it into `ChartConfigPanel` and `KineticaWmsLayerForm`, and (3) wiring persistence end-to-end for `layer.filterScope` (a top-level field that currently has ZERO persistence — it exists only as a TypeScript stub with `undefined` at runtime).

The scope is locked to source-widget allow-list ONLY. Per-column exclusion was dropped from v1.18 (deferred to FSCOPE-V2-02). The `FilterSelectionConfig` type in `types/filterSelection.ts` already reflects this: `sourceMode` + `allowedSourceWidgetIds` only.

**Primary recommendation:** Build `FilterSelectionPanel` as a new component; integrate into `ChartConfigPanel` (no new prop needed — `widgets` already threaded); thread `widgets` down to `KineticaWmsLayerForm` via `LayersModal` → `DashboardsPage` (new prop at each level); add server persistence for `layer.filterScope` following the exact `track_config` pattern at 5 sites.

---

## The track_config Persistence Path (Mirror Exactly for filterScope)

This is the canonical model. `filterScope` must follow every step.

### Server side

**SQLite DDL** — `packages/server/src/db.ts`
- Line 107: `track_config TEXT` in the `CREATE TABLE dashboard_layers` block (fresh installs)
- Lines 342–344: PRAGMA-guarded `ALTER TABLE dashboard_layers ADD COLUMN track_config TEXT` (existing deployments migration)
- Line 407: `mapDashboardLayer` function — line 426: `track_config: row.track_config ?? null`
- Lines 692–733: `updateDashboardLayer` function — `track_config` in the `Partial<Pick<DashboardLayer, ...>>` signature (line 703), in the UPDATE SQL string (line 709), and in the `"key" in attrs` discriminant pattern (line 730)

**Server type** — `packages/server/src/types.ts` line 90: `track_config: string | null` on the `DashboardLayer` interface

**Server route** — `packages/server/src/index.ts`
- Line 993: `"track_config"` in the route's `Partial<Pick<DashboardLayer, ...>>` body type
- Line 995: `updateDashboardLayer(layerId, body)` — the body passes through verbatim

### Client side

**DTO** — `packages/web/src/api/client.ts`
- Line 640: `track_config: string | null` on `DashboardLayerDto` (already done for `filterScope` at line 645 as `filterScope?: FilterSelectionConfig` — but the type is already correct)
- Lines 689–690: `"track_config"` in `updateLayer`'s `Partial<Pick<DashboardLayerDto, ...>>` — **`filterScope` is NOT in this Pick list yet** (line 678–691 is the gap)

**Layer store** — `packages/web/src/store/dashboardLayersStore.ts` — `updateLayer` accepts `Partial<DashboardLayerDto>`, so the store itself needs no change; it uses spread (`{ ...next[idx], ...patch }`)

**Debounced save** — `packages/web/src/components/DashboardsPage.tsx` line 717: `apiUpdateLayer(dashboard.id, layerId, patch)` — calls `updateLayer` from client.ts with whatever is in `pendingPatchRef`. The patch flows correctly once `filterScope` is in the Pick list.

**LayersModal merge/split** — `packages/web/src/components/LayersModal.tsx` lines 548–573: the `onChange` callback SPLITS `cb_config` and `track_config` back out of the merged config blob before calling `onPatch`. The same split pattern is needed for `filterScope` — see "LayersModal Merge/Split" section below.

### Summary: 5 gaps to close for layer.filterScope persistence

| # | File | Location | Change |
|---|------|----------|--------|
| 1 | `packages/server/src/db.ts` | DDL line 108 + PRAGMA ALTER block after line 344 | Add `filter_scope TEXT` column; PRAGMA-guarded ALTER |
| 2 | `packages/server/src/types.ts` | After line 90 | Add `filter_scope: string | null` to `DashboardLayer` |
| 3 | `packages/server/src/db.ts` | `mapDashboardLayer` line ~428 | Map `filter_scope` row → `filter_scope: row.filter_scope ?? null` AND parse JSON to object |
| 4 | `packages/server/src/db.ts` | `updateDashboardLayer` + UPDATE SQL | Add `filter_scope` to Pick, SQL string, `"key" in attrs` discriminant |
| 5 | `packages/server/src/index.ts` | PATCH route body Pick (line 992–993) | Add `"filter_scope"` |
| 6 | `packages/web/src/api/client.ts` | `updateLayer` Pick (line 681–691) | Add `"filterScope"` |

**Naming decision (IMPORTANT):** The server SQLite column should be `filter_scope` (snake_case, matching `cb_config`/`track_config` convention). The client DTO field is `filterScope` (camelCase, matching the existing stub at line 645). `mapDashboardLayer` maps `row.filter_scope` → parsed JSON → `filterScope` object on the DTO. The server route and `updateDashboardLayer` use `filter_scope` (snake_case) matching the DB column; the client sends `filterScope` in the JSON body; the server route must map `body.filterScope` → `JSON.stringify(...)` → column `filter_scope`. NOTE: `track_config` is stored as a raw JSON string in the DB and travels as a string on the wire; `filterScope` should follow the SAME wire format (JSON string in `filter_scope` column, parsed to object in `mapDashboardLayer`, serialized back to JSON string at save time in the route). This matches how the client already has `filterScope?: FilterSelectionConfig` (object type, not string).

**Widget config persistence:** `widget.config.filterSelection` is stored inside the existing `config` JSON blob. The widget PATCH route (`PATCH /api/dashboards/:id/widgets/:wid`) already accepts `{ config: Record<string, unknown> }` and stores it verbatim. No server change needed — `filterSelection` is just another key inside `config`. The orchestrator already reads `w.config.filterSelection as FilterSelectionConfig | undefined` (useCombinationOrchestrator.ts line 147). The `ChartConfigPanel` save path already merges everything in `draft` into the final config object (lines 740–780). Phase 93 just needs to write `filterSelection` into `draft` before save.

---

## Source-Widget Enumeration: Which Widgets Are Filter-Producing

### Rule (from REQUIREMENTS.md + registry.ts)

Filter-PRODUCING (show in allow-list):
- Any widget with `supportsDrillDown: true` in its registry definition: `bar`, `line`, `pie`, `scatter`, `table`, `records`
- `datafilter` widget (type string: `"datafilter"` — see `definitions/data-filter.ts` line 20) — always a filter source regardless of `supportsDrillDown`
- `calendar` — `supportsDrillDown: false` but uses a custom BETWEEN gesture (CalendarRenderer.tsx:496 sets `sourceWidgetId`); it IS a filter source
- `timeline` — `supportsDrillDown: false` but drag-to-filter gesture sets `sourceWidgetId` (TimelineRenderer.tsx:436); it IS a filter source
- `numericline` — `supportsDrillDown: false` but drag gesture sets `sourceWidgetId` (NumericLineRenderer.tsx:411); it IS a filter source
- Map spatial draws — a sentinel entry (see below)

NOT filter-producing (exclude from allow-list):
- `legend` — `supportsDrillDown: false`, no filter emission
- `info-card` — `supportsDrillDown: false`, no filter emission
- `map` — drill-down not implemented (comment in definitions/map.ts: "supportsDrillDown intentionally unset"); the map widget EMITS spatial draws via the spatialFilterStore but those are tracked as a sentinel, not as a widget ID
- `bignumber`, `heatmap`, `radio-group` — no drill-down / no filter emission

### The "spatial draws" sentinel problem

Spatial draws (MapDrawToolbar → spatialFilterStore) do NOT produce `ActiveFilter` entries with `sourceWidgetId`. They are a separate store (`spatialFilterStore.ts`) with `shapes[]` that get injected into the WMS WHERE clause directly. They do NOT flow through `filterStore.filters[tableId]`. Therefore the current `resolveFilterSet` function (which filters `allFilters` by `sourceWidgetId`) CANNOT gate spatial draws — the "spatial" sentinel in the FEATURES.md design is for the UI display only and represents "all spatial draws accepted/blocked as a unit."

**Decision needed by planner:** Phase 93 scope is the config UI. The "Spatial draws" entry in the allow-list checklist is informational/reserved for Phase 94+ unless the orchestrator already handles spatial draws. Spatial draws go through `useMapOnlySpatialMaterialize` (not the combination orchestrator), so gating them via `filterScope` is out of Phase 93 scope. The UI can show the sentinel as a disabled/grayed placeholder with "(future)" label, OR omit it entirely from the Phase 93 UI and add it in a future phase when the spatial filter path is wired to the combination orchestrator. The planner must lock this decision.

### Practical enumeration rule for FilterSelectionPanel

```typescript
// In the panel, filter the widgets prop to produce the source list:
function isFilterProducingWidget(w: WidgetDto): boolean {
  const FILTER_PRODUCING_TYPES = new Set([
    "bar", "line", "pie", "scatter", "table", "records",
    "datafilter", "calendar", "timeline", "numericline",
  ]);
  return FILTER_PRODUCING_TYPES.has(w.type);
}
```

Exclude the widget being configured (a chart cannot list itself as a source). Exclude map widgets. The current widget being configured is NOT in the allow-list (it can't filter itself).

---

## Where the Widget List Comes From in Each Config Surface

### ChartConfigPanel (chart widgets)

`widgets` prop already threaded: `DashboardsPage.tsx:1183` passes `widgets` → `WidgetConfigModal` → `ChartConfigPanel` (line 43: `widgets?: WidgetDto[]`). The prop flows through to the `CustomConfigPanel` slot. For the `FilterSelectionPanel` embedded directly in `ChartConfigPanel` (NOT in a custom panel), `widgets` is already available at that level.

**No threading change needed for ChartConfigPanel.**

### KineticaWmsLayerForm (map layers)

`KineticaWmsLayerForm` does NOT currently receive a `widgets` prop. Threading path:

```
DashboardsPage (has `widgets` state)
  └─ LayersModal (NO widgets prop currently)
       └─ KineticaWmsLayerForm (NO widgets prop currently)
```

Threading needed:
1. `LayersModalProps` (LayersModal.tsx line 45): add `widgets?: WidgetDto[]`
2. `LayersModal` destructure + pass to `KineticaWmsLayerForm`
3. `KineticaWmsLayerFormProps` (KineticaWmsLayerForm.tsx line 63): add `widgets?: WidgetDto[]`
4. `DashboardsPage.tsx` line 1193: add `widgets={widgets}` to `<LayersModal>`

The `widgets` prop is already optional everywhere it's been added (e.g., `ChartConfigPanel`). Add as optional with empty-array default so existing tests and callers compile unchanged.

**LayersModal also needs the filterScope split.** Currently the `onChange` callback at lines 563–573 splits `cb_config` and `track_config` out of the merged config blob before calling `onPatch`. The `FilterSelectionPanel` for layers writes to a `filterScope` prop on the form's callback — NOT into the config blob. The panel should receive `filterScope` as a separate prop (parallel to `infoEnabled`/`infoColumns`/`infoTemplate`) and emit via an `onChangeFilterScope` callback that calls `onPatch(selectedLayer.id, { filterScope: nextScope })`. This mirrors the `onChangeInfoConfig` pattern exactly.

---

## FilterSelectionPanel: Component Design

### Location

New file: `packages/web/src/components/charts/FilterSelectionPanel.tsx`
Used by both `ChartConfigPanel.tsx` and `KineticaWmsLayerForm.tsx`.

### Props

```typescript
type FilterSelectionPanelProps = {
  // Current config — undefined = accept-all default
  value: FilterSelectionConfig | undefined;
  onChange: (next: FilterSelectionConfig | undefined) => void;
  // Full widget list from DashboardsPage — will be filtered to filter-producing types
  widgets: WidgetDto[];
  // The widget being configured (excluded from the allow-list — can't filter itself).
  // For layers: undefined (layers are not widgets, they don't need self-exclusion).
  selfWidgetId?: number;
};
```

### Rendering logic

1. **Collapsed default state** (when `value === undefined || value.sourceMode === "all"`):
   ```
   [Filter Scope]              ← config-group-label
   Accept all filters          ← config-hint
   [Customize ☐]              ← config-toggle checkbox
   ```
   When the "Customize" checkbox is checked: set `sourceMode: "allowlist"`, `allowedSourceWidgetIds: []`, call `onChange`.

2. **Expanded "allowlist" state**:
   ```
   [Filter Scope]
   [✓] Customize
   
   Source widgets (check to allow):
   Hint: "No items checked — accepting all sources. Check items to restrict."
   
   [ ] Bar Chart — Revenue (bar)
   [ ] Timeline — Orders (timeline)
   [x] Global Filters (datafilter)
   ```
   Each source widget renders as a checkbox row using `config-toggle` + widget title + type label.
   When ALL checkboxes are unchecked: still `sourceMode: "allowlist"` with `allowedSourceWidgetIds: []` (accept-none, not accept-all — distinct from default). Hint text differentiates: "All sources unchecked — no filters accepted from any widget. Uncheck 'Customize' to return to accept-all."
   
   Unchecking "Customize": call `onChange(undefined)` to clear config (revert to accept-all default).

3. **Orphan handling**: if `allowedSourceWidgetIds` contains an ID not in the current `widgets` prop (deleted widget), render: `⚠ Deleted widget (id: N)` as a disabled entry with `color: var(--danger)`. Mirrors `RadioGroupConfigPanel`'s orphan pattern. The ID stays in the array (non-destructive) until the user manually unchecks it.

4. **Empty source list** (no filter-producing widgets on the dashboard besides self): render the config-group header + "No filter-producing widgets on this dashboard." config-hint. Do NOT show the checklist.

### CSS classes to use (NO invented classes)

- `config-group` — wrapping div
- `config-group-label` — section header
- `config-toggle` — each checkbox row (`<label className="config-toggle"><input type="checkbox" ... /> label text</label>`)
- `config-hint` — descriptive text / orphan warning (use `var(--danger)` for orphan via inline style, matching RadioGroupConfigPanel pattern — theme-guard compliant since it's a token var not raw hex)

No new CSS class is needed for Phase 93. The `widget-filter-badge` new class is Phase 95's concern.

---

## The Two UI Integration Points

### Integration 1: ChartConfigPanel

Add the `FilterSelectionPanel` after the Drill-Down `config-group` (lines 682–718) and before the chart-specific field groups (line 720).

**Condition:** render the filter scope section when the widget has a data source (i.e., `selectedSource` is defined). Same condition as the Drill-Down section.

**Read:** `draft.filterSelection as FilterSelectionConfig | undefined`

**Write:** call `set("filterSelection", nextValue)` (or `set("filterSelection", undefined)` when reverting to accept-all). The `draft` state already flows into the final `onSave` payload.

**Self-exclusion:** pass `selfWidgetId={configuringWidgetId}` so the panel doesn't list the widget being configured as a source. The widget's `id` must be threaded — check if `ChartConfigPanel` has access to the widget ID. Currently the Props type has `config` and `widgetType` but NOT `widgetId`. This is a minor gap: add `widgetId?: number` to `ChartConfigPanel` Props and thread from `WidgetConfigModal`. Alternatively, accept that a widget can appear in its own list (harmless — a widget is never a source of filters for itself since the drill-down fires AFTER the chart renders) and skip self-exclusion for Phase 93. The planner must decide.

### Integration 2: KineticaWmsLayerForm

Add a `FilterSelectionPanel` near the bottom of the form, after the Zoom Range / Info Popup section (which ends around line 1554). It should appear as the last config-group before the closing `</div>`.

**Read/write:** `FilterSelectionPanel` receives the `filterScope` from the layer via the same split pattern as `infoEnabled`. The form receives `filterScope?: FilterSelectionConfig` as a prop and emits via `onChangeFilterScope?: (next: FilterSelectionConfig | undefined) => void`. In LayersModal's onChange handler, `onChangeFilterScope` calls `onPatch(selectedLayer.id, { filterScope: nextScope })`.

**LayersModal** passes `filterScope={selectedLayer.filterScope}` and `onChangeFilterScope={...}` to `KineticaWmsLayerForm`.

**Self-exclusion:** not applicable (layers are not widgets; no `selfWidgetId`).

---

## Chart vs. Layer Persistence Split

| Surface | Config field | Write path | Server change needed? |
|---------|-------------|------------|----------------------|
| Chart/table/timeline/numericline/calendar/scatter/pie/line/bar widget | `widget.config.filterSelection` | `ChartConfigPanel` merges into `draft`, `onSave` calls `PATCH /api/dashboards/:id/widgets/:wid` with full `config` blob | NO — config is an opaque JSON blob; server passes through verbatim |
| DataFilter widget | `widget.config.filterSelection` | Same as above | NO |
| Map WMS layer | `layer.filterScope` (TOP-LEVEL, not in layer.config) | `KineticaWmsLayerForm` → `onChangeFilterScope` → `LayersModal` → `onPatch` → `handleLayerPatch` → `apiUpdateLayer(dashboardId, layerId, { filterScope })` | YES — 6 gaps (see server touch section above) |

**Critical:** The map widget itself (`type: "map"`) has `usesDataSource: false` and does not go through `ChartConfigPanel`'s data-source path. The filter scope for map visualizations is per-LAYER (in `KineticaWmsLayerForm`), NOT per map widget. This is already how the orchestrator treats it (reads `layer.filterScope`, not `widget.config.filterSelection` for map widgets).

---

## Defaults and Empty States

| State | Behavior |
|-------|----------|
| `filterScope` / `filterSelection` absent (new or unconfigured widget/layer) | Accept-all; orchestrator produces the same hash as v1.17 for all widgets on the same table; COMBO-V118-04 correctness gate passes |
| `sourceMode: "all"` (explicit default) | Same as absent — accept-all |
| `sourceMode: "allowlist"`, `allowedSourceWidgetIds: []` | Accept NO filters from any widget source (empty allow-list = block all) — distinct from accept-all. The orchestrator computes a resolved filter set of `[]` → NOFILTER sentinel → no view created → widget reads raw table. Must show UI warning: "No sources selected — this visualization ignores all active filters." |
| No filter-producing widgets on the dashboard | Show empty state in checklist: "No filter-producing widgets on this dashboard." |
| All source widgets deleted (all IDs orphaned) | Show orphan warnings for each; the effective allow-list is empty (no live matches) → same as empty allow-list above |

---

## Existing Specs to Extend

### Frontend (vitest)

- `packages/web/src/store/filterCombinationStore.spec.ts` — already exists (Phase 89). No extension needed for Phase 93.
- New spec: `packages/web/src/components/charts/FilterSelectionPanel.spec.tsx` — unit test for the panel component: renders accept-all default, checkbox toggle expands, source list filters to filter-producing types only, orphan warning, empty-source-list state, onChange fires with correct payload.
- `packages/web/src/components/LayersModal.spec.tsx` — extend to confirm `widgets` prop threads through to `KineticaWmsLayerForm`.

### Server (supertests in BOTH auth modes)

Mirror the `layers.spec.ts` `dynamic_view_id` pattern (lines 231–314) for `filter_scope`:
- `PATCH` accepts `filter_scope` JSON and round-trips it in the response (password mode)
- `PATCH` with `{ filter_scope: null }` clears a previously-set value (password mode)
- `PATCH` that omits `filter_scope` preserves the existing value (password mode)
- Repeat all three for OIDC auth mode (mirror the `it("... AUTH_MODE=password")` pattern with `AUTH_MODE=oidc` variants that appear elsewhere in layers.spec.ts)

---

## Server Touch Scope

Phase 93 is BOTH-stack (server-touching). The server changes are additive and contained:

**Files touched server-side:**
- `packages/server/src/types.ts` — add `filter_scope: string | null`
- `packages/server/src/db.ts` — DDL column, PRAGMA-guarded ALTER, `mapDashboardLayer` mapping, `updateDashboardLayer` signature + SQL + discriminant
- `packages/server/src/index.ts` — PATCH route Pick type extension

**No new routes.** No new SQLite tables. The `filter_scope` column is `TEXT NULL` (JSON string), consistent with `cb_config` / `track_config`.

---

## Architecture Patterns

### Existing config-group pattern (reference: ChartConfigPanel lines 686–707)

```tsx
<div className="config-group">
  <div className="config-group-label">Filter Scope</div>
  {/* FilterSelectionPanel renders its own inner content */}
  <FilterSelectionPanel
    value={draft.filterSelection as FilterSelectionConfig | undefined}
    onChange={(next) => set("filterSelection", next)}
    widgets={widgets ?? []}
    selfWidgetId={widgetId}
  />
</div>
```

### Existing top-level field split pattern in LayersModal (lines 548–573, reference for filterScope)

```tsx
// In LayersModal, alongside cb_config / track_config split:
<KineticaWmsLayerForm
  config={{ ...selectedLayer.config, cb_config: selectedLayer.cb_config, track_config: selectedLayer.track_config }}
  // filterScope is TOP-LEVEL — pass separately, not merged into config blob
  filterScope={selectedLayer.filterScope}
  onChangeFilterScope={(nextScope) => {
    onPatch(selectedLayer.id, { filterScope: nextScope });
  }}
  onChange={(nextConfig) => {
    const { cb_config, track_config, ...rest } = nextConfig as Record<string, unknown>;
    onPatch(selectedLayer.id, {
      config: rest,
      cb_config: (cb_config as string | null) ?? null,
      track_config: (track_config as string | null) ?? null,
    });
  }}
  ...
/>
```

### PRAGMA-guarded ALTER pattern (reference: db.ts lines 339–344)

```ts
if (!layerColNames.has("filter_scope")) {
  instance.exec("ALTER TABLE dashboard_layers ADD COLUMN filter_scope TEXT");
}
```

Run the `PRAGMA table_info(dashboard_layers)` block early in `createDb` to collect `layerColNames`, then gate. The existing `cb_config` + `track_config` block at lines 339–344 already does this; add `filter_scope` as a third entry in that block.

---

## Common Pitfalls

### Pitfall 1: Merging filterScope into the layer.config blob

**What goes wrong:** The `LayersModal` onChange handler merges `cb_config` and `track_config` into the config blob before passing to `KineticaWmsLayerForm` and splits them back on change. If `filterScope` is treated the same way (merged into config), the server receives it at `config.filterScope` instead of the top-level `filter_scope` column. The orchestrator reads `layer.filterScope` (top-level) — it would always be `undefined`.

**Prevention:** Pass `filterScope` as a separate prop to `KineticaWmsLayerForm` with a separate `onChangeFilterScope` callback. Do NOT add it to the config-merge block. Track-config memory note applies here directly.

### Pitfall 2: ChartConfigPanel lacks widgetId prop for self-exclusion

**What goes wrong:** The `FilterSelectionPanel` for chart widgets needs to exclude the widget being configured from the source list. If `widgetId` is not available in `ChartConfigPanel`, the panel either shows the current widget in the list (harmless but confusing) or the self-exclusion silently breaks.

**Prevention:** Either (a) add `widgetId?: number` to `ChartConfigPanel` Props and thread from `WidgetConfigModal`, OR (b) accept that a widget appears in its own source list for Phase 93 (a filtered-by-self allow-list simply never passes `f.sourceWidgetId === selfId` through the allow-list when the widget's own drill fires, so it's functionally harmless — the widget's own filters are already excluded by the allow-list gate if unchecked).

### Pitfall 3: Widget save clobbers filterSelection if not in draft

**What goes wrong:** `ChartConfigPanel` initializes `draft` from the existing `config` at mount (line 90: `setDraft({ ...defaults, ...config })`). If `config.filterSelection` exists but the panel doesn't render the field, it stays in `draft` and gets saved correctly. However, if the save path filters `draft` keys, `filterSelection` could be dropped. Confirm the save path at lines 740–780 passes `draft` fields through without a whitelist filter — it does (`const finalConfig = { ...draft, ...other overrides }`). No risk here.

### Pitfall 4: `filterScope` naming inconsistency (DB snake_case vs client camelCase)

**What goes wrong:** The SQLite column is `filter_scope` (snake_case like `cb_config`/`track_config`). The client DTO field is `filterScope` (camelCase). The server route receives a JSON body with `filterScope` (camelCase) from the client. The route handler must `JSON.stringify(body.filterScope)` before passing to `updateDashboardLayer` as `filter_scope`. If the route uses the wrong key name, the column stays `null`.

**Prevention:** Follow `track_config` exactly: the route body is typed as `Partial<Pick<DashboardLayer, ... | "filter_scope">>` where `DashboardLayer.filter_scope` is the snake_case key. The client sends `{ filter_scope: ... }` NOT `{ filterScope: ... }`. Wait — actually `track_config` is the same in both client DTO and DB column (snake_case on both sides). The existing `filterScope` stub on `DashboardLayerDto` is camelCase. To avoid a mismatch, either: (a) add `filter_scope: string | null` to `DashboardLayerDto` instead of `filterScope`, OR (b) keep `filterScope` on the DTO but add a mapping in `mapDashboardLayer` and the route handler.

**Recommendation (DECISION FOR PLANNER):** Use `filter_scope` (snake_case) as BOTH the DTO field and the DB column, matching `cb_config`/`track_config`. The stub in `client.ts:645` is currently `filterScope?: FilterSelectionConfig` — change it to `filter_scope?: FilterSelectionConfig` for consistency. The orchestrator in `useCombinationOrchestrator.ts:179` reads `layer.filterScope` — this will need to change to `layer.filter_scope`. Alternatively, keep `filterScope` on the DTO (camelCase) and document that the mapping layer converts from `filter_scope` DB column → `filterScope` DTO field. The planner must lock one convention.

### Pitfall 5: Theme-guard on FilterSelectionPanel

**What goes wrong:** Any new CSS class or hardcoded hex in `FilterSelectionPanel.tsx` triggers the theme-guard. Orphan warning "deleted widget" text in danger color must use `style={{ color: "var(--danger)" }}` or a CSS class that uses `var(--danger)` — NOT a raw hex value.

**Prevention:** Use only existing classes (`config-group`, `config-toggle`, `config-hint`, `ds-field`, `ds-select`). No new class needed for Phase 93. If any icon or indicator is added, use token vars only.

---

## Risks and Planner Decisions Required

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | DB column name: `filter_scope` (snake_case, matches cb_config/track_config convention) vs keep `filterScope` stub (camelCase, requires mapping) | (a) `filter_scope` on DB + DTO, update orchestrator reference; (b) `filter_scope` DB, `filterScope` DTO with mapping layer | Use snake_case `filter_scope` both sides — matches the established cb_config/track_config pattern; simpler |
| D2 | Spatial draws sentinel in the allow-list checklist | (a) Omit entirely from Phase 93 (spatial draws not wired to combination orchestrator); (b) Show disabled placeholder "(Spatial draws — future)"; (c) Include as if it were a real source (no-op until Phase 94+) | Omit from Phase 93 — spatial draws go through `useMapOnlySpatialMaterialize`, not the combination orchestrator; including a non-functional sentinel confuses designers |
| D3 | Self-exclusion of the current widget from its own allow-list | (a) Add `widgetId?: number` to ChartConfigPanel Props; (b) Skip self-exclusion (harmless functionally — a widget can never pass a filter through itself) | Add `widgetId?` — one-liner prop addition in WidgetConfigModal; cleaner UX |
| D4 | Where in KineticaWmsLayerForm to place the Filter Scope section | (a) After Info Popup (last section); (b) After Zoom Range (second-to-last) | After Info Popup (last) — filter scope is advanced designer config, belongs at the bottom |
| D5 | Empty allow-list (`allowedSourceWidgetIds: []` with `sourceMode: "allowlist"`) UX | Warn user explicitly in the panel that no filters will reach this visualization | Yes — add config-hint: "No sources selected — this visualization ignores all filters. Uncheck 'Customize' to accept all." |

---

## Sources

### Primary (HIGH confidence — live codebase inspection)

- `packages/web/src/types/filterSelection.ts` — `FilterSelectionConfig` type, scope lock comment (source-widget allow-list ONLY for v1.18), `DEFAULT_FILTER_SELECTION`
- `packages/web/src/lib/resolveFilterSet.ts` — pure function, already built
- `packages/web/src/api/client.ts` lines 613–700 — `DashboardLayerDto` (filterScope stub at 645, NOT in updateLayer Pick at 681–691), `updateLayer` function shape
- `packages/server/src/db.ts` lines 96–112 (DDL), 339–344 (migrations), 407–429 (mapDashboardLayer), 692–733 (updateDashboardLayer)
- `packages/server/src/types.ts` lines 83–92 — `DashboardLayer` type with track_config/cb_config
- `packages/server/src/index.ts` lines 967–998 — PATCH route, body Pick, track_config at line 993
- `packages/web/src/store/dashboardLayersStore.ts` — updateLayer accepts Partial<DashboardLayerDto>
- `packages/web/src/components/DashboardsPage.tsx` lines 704–734 — handleLayerPatch, flushPendingPatches, apiUpdateLayer call
- `packages/web/src/components/LayersModal.tsx` lines 45–63 (props), 548–573 (onChange split, no widgets prop)
- `packages/web/src/components/charts/KineticaWmsLayerForm.tsx` lines 63–103 — Props (no widgets prop)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` lines 23–46 (Props, widgets at 43), 682–707 (Drill-Down config-group pattern)
- `packages/web/src/components/charts/registry.ts` lines 134–144 — `supportsDrillDown` flag
- `packages/web/src/components/charts/definitions/` — all definition files for `type` strings and `supportsDrillDown` values
- `packages/web/src/store/filterStore.ts` line 38 — `sourceWidgetId` on `ActiveFilter`
- `packages/web/src/hooks/useCombinationOrchestrator.ts` lines 147, 177–181 — reads `w.config.filterSelection` for widgets, `layer.filterScope` for layers
- `packages/server/tests/layers.spec.ts` lines 231–314 — `dynamic_view_id` persistence test pattern to mirror for `filter_scope`
- `packages/web/src/styles/global.css` lines 1244–1257 — `config-toggle` class; line 1238–1242 `config-hint`

---

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (stable codebase; no external deps involved)
