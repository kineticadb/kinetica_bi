# Phase 111: Map Default View — Capture & Save - Research

**Researched:** 2026-09-09
**Domain:** OpenLayers (React) live-viewport reflection into a sibling config panel; Zustand state; widget-config storage shape
**Confidence:** HIGH (all claims verified by reading the actual source files listed below — no Context7/WebSearch was needed; this is a closed-codebase mechanism question, not an external-library question)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **The control MUST show the view it would capture, live.** Not a bare button. Something of the form `Set as default — zoom 12.4 · 40.71°N, 74.01°W`. Blind-saving behind an opaque overlay was explicitly rejected.
- **Human-readable coordinates.** Degrees with hemisphere (`40.71°N, 74.01°W`), not raw EPSG:3857 metres. OL holds the centre in EPSG:3857, so this needs an `ol/proj` transform to EPSG:4326 for DISPLAY — `transform` is already imported and used in `MapChartRenderer.tsx`.
- **When a default already exists, show BOTH values** — the saved default and the pending replacement — so the overwrite is visible before it happens. There is no undo.
  ```
  Current default: zoom 8 · 40.7°N, 74.0°W
  [ Set as default — zoom 12.4 · 41.2°N, 73.8°W ]
  ```
- **Store the exact fractional OL zoom** (e.g. `12.437`); **display it rounded** (`zoom 12.4`). Do NOT round the stored value.
- **Consequence for the mechanism:** the panel needs a **continuous** read of the live view of the *specific* map being configured — not merely a value sampled at click time. Storage format (EPSG:3857 vs 4326) is Claude's call; only the DISPLAY format is fixed.

### Claude's Discretion

- **Control placement & wording** — own `DEFAULT VIEW` group adjacent to `VIEWPORT SYNC`. Exact section and button label are open.
- **Save confirmation** — the both-values readout already provides passive confirmation. An additional toast/label-flip may be unnecessary. Config auto-saves silently everywhere else in this panel.
- **Clear affordance** — always-visible Clear vs only-when-set, and what the readout reads when nothing is saved (e.g. "No default — opens at world view").
- Storage shape of the saved value inside the widget `config` blob.

### Deferred Ideas (OUT OF SCOPE)

- A "set default view" button on the map's own toolbar (rather than in config) — MAPVIEW-V121-01 specifies the control lives in the map's config.
- Dashboard-level default view applied to every map at once (MAPVIEW-F2).
- Auto-fit-to-data as an alternative default (MAPVIEW-F1) — deliberately removed in Phase 12-02.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAPVIEW-V121-01 | Designer can save a map widget's current zoom and center as that widget's default view, from the map's config | New `useMapCurrentViewStore` (widgetId-keyed, always-on publish) gives `MapConfigPanel` the live view; `getDefaultView`/`config.defaultView` write path documented below with exact `onChange` call |
| MAPVIEW-V121-04 | Designer can clear a saved default view, returning that map to the world view | `ghost-sm ghost-danger` Clear button pattern (precedent: NumericLineConfigPanel, RadioGroupConfigPanel, CbConfigForm) deletes `config.defaultView` via the same auto-save `onChange` path |
</phase_requirements>

## Summary

The phase's hard problem is a **cross-tree data-flow problem, not an OpenLayers problem**: `MapChartRenderer` (owns the live OL `Map`/`View`) and `MapConfigPanel` (needs to read it) are **siblings**, mounted from two completely different call sites (`WidgetRenderer.tsx`'s generic per-type dispatch for the canvas, and `DashboardsPage.tsx`'s `WidgetConfigModal` for the config UI) with no shared parent that holds both. `MapConfigPanel` is also explicitly barred from `useDashboardContext()` (it renders outside `DashboardContextProvider` — see `registry.ts:76-78`), which rules out any context-based bridge.

The existing `mapViewportSyncStore` already solves an almost-identical problem (publish live viewport out of `MapChartRenderer` on `moveend`) but is disqualified for two independently-fatal reasons documented in REQUIREMENTS.md: it's gated behind the (default-off) "Sync viewport" toggle, and it's keyed by `dashboardId` (single slot, wrong map on multi-map dashboards) not `widgetId`. Its **pattern**, however — `map.on("moveend", ...)` → `store.getState().publish(...)` → scoped Zustand selector on the reading side — is exactly right and should be copied almost verbatim into a **new, dedicated, always-on, widgetId-keyed store**.

A second finding materially simplifies the design: because `WidgetConfigModal` is additive JSX (`{configuringWidget && <WidgetConfigModal .../>}`) layered on top of the existing dashboard grid rather than replacing it, **the widget's `MapChartRenderer` instance is already mounted, and has already run at least one render cycle, before its config modal can ever be opened** (a widget must exist in the `widgets` array — and therefore be rendered on the grid — before "Configure" can be clicked on it; `handleAddVisualization` never auto-opens config). There is no mount-order race to design around. Additionally, the modal overlay (`.modal-overlay { position: fixed; inset: 0; }`, `rgba(0,0,0,0.78)`) makes the underlying map **fully non-interactive** while the panel is open — it cannot pan or zoom during that window — so a true "continuously live while the panel is open" subscription is not strictly required for correctness, only "live as of panel-open time," which a scoped Zustand selector already delivers as a side effect of being reactive (if the invariant is ever weakened, the same selector keeps working correctly with zero changes).

**Primary recommendation:** Add a new, dedicated Zustand store `useMapCurrentViewStore` (keyed by `widgetId`, EPSG:3857, always-on — no `syncViewport` gate), with `MapChartRenderer` publishing once on mount AND on every `moveend` (mirroring Effect 9a's wiring but unconditional and widgetId-keyed), and `MapConfigPanel` reading it via a scoped selector using the `widgetId` prop that `ConfigPanelProps` already carries (currently unused by `MapConfigPanel`). Store the default view in `config.defaultView: { center: [number, number]; zoom: number }` in **EPSG:3857** (OL's native projection, zero-conversion round-trip to Phase 112); transform to EPSG:4326 only at display time, in a new pure helper module.

## Standard Stack

This phase adds no new npm dependencies. Everything needed already exists in the codebase / is already installed:

| Library | Version (verified) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ol` | `^10.9.0` (installed; see `packages/web/package.json`) | `transform` from `ol/proj` for EPSG:3857→4326 display conversion | Already the project's only map/geo library; `transform` already imported and used in `MapChartRenderer.tsx` (lines 55, 1718, 2037-2038) |
| `zustand` | already installed, project-standard state layer | New `useMapCurrentViewStore` | Every other cross-component transient-state need in this codebase (filters, layers, viewport sync, toast, widget actions) is a Zustand store; this is the only pattern with an established reset-chain + selector-scoping convention |

No installation step is needed for this phase — no `npm install` required.

## Architecture Patterns

### The core mechanism — evaluated options

**(a) New per-`widgetId` viewport store, publishing on `moveend`, always on — RECOMMENDED**

- Copy `mapViewportSyncStore`'s Effect 9a wiring (`map.on("moveend", ...)` → `getState().publish(...)`) into a **new** store/effect, but:
  - key by `widgetId` (numeric, globally unique per `WidgetDto.id`) instead of `dashboardId`
  - **no `syncEnabled` gate** — attach the listener unconditionally, for every map widget, always
  - **publish once immediately after `mapRef.current = map`** (i.e. at mount), in addition to on every `moveend` — without this, a map that has never been panned since the dashboard loaded would have no store entry the first time its config panel opens
- `MapConfigPanel` reads it with a scoped selector: `useMapCurrentViewStore((s) => widgetId === undefined ? undefined : s.views[widgetId])` — identical shape to the existing S-02-locked pattern at `MapChartRenderer.tsx:2204-2206`.
- **Why recommended over the alternatives:** this is the only option that requires **zero new architectural pattern** in a codebase that is explicitly Zustand-first with a documented, tested convention for exactly this shape of problem (scoped selectors to avoid re-render storms — the v1.20 CONTEXT.md lock referenced in project memory; reset-chain membership on logout + dashboard-switch). The phase's own research flag literally names "the sync store's publish-on-moveend wiring... is the right PATTERN to copy" — this is that pattern, generalized correctly (unconditional, widgetId-keyed).
- **Cost:** every mounted map (not just ones being configured) now attaches one extra `moveend` listener and does one extra `Zustand.set()` per pan/zoom. This is cheap (a plain object write) and is **already happening today** for every sync-enabled map via Effect 9a — this just removes the gate and changes the key. `MapChartRenderer` itself never calls the *read* hook (`useMapCurrentViewStore()`), only the imperative `getState().publish(...)` — so publishing costs zero extra re-renders on the canvas map. Only `MapConfigPanel` (mounted only while a config modal is open) subscribes reactively.
- **Reset-chain integration:** becomes the **12th store** in both cleanup chains, following `mapViewportSyncStore`'s exact precedent:
  - `App.tsx:148-149` (logout): `useMapViewportSyncStore.getState().reset();` → add `useMapCurrentViewStore.getState().reset();` immediately after.
  - `DashboardsPage.tsx:575-576` (dashboard-switch): same addition.
  - Per-widget cleanup (deleted/unmounted widget): unlike `mapViewportSyncStore` (which has no per-item cleanup, only whole-store `reset()`), this store SHOULD also delete its own entry in `MapChartRenderer`'s Effect 1 unmount cleanup (`useMapCurrentViewStore.getState().clear(widget.id)`) to avoid entries accumulating for widgets deleted mid-session before the next dashboard-switch/logout `reset()`. Cheap to add, not strictly required for correctness (bounded, session-only leak otherwise), but consistent with the M-01 cleanup discipline already followed everywhere else in this file.
  - New file must live under `src/store/` — `__mocks__/zustand.ts`'s reset shim (auto-applied via `vi.mock("zustand")` in `src/test/setup.ts`) only covers files there (documented in `mapViewportSyncStore.ts`'s own header comment).

**(b) Module-level registry of OL map instances keyed by `widgetId`**

- A plain (non-Zustand) module singleton, e.g. `Map<number, OlMap>`, populated in Effect 1 right after `mapRef.current = map` and deleted in the same cleanup that nulls `mapRef.current` (symmetric with the existing PITFALL M-01 lock). `MapConfigPanel` looks up the instance by `widgetId` and either reads it once on mount or attaches its own `moveend` listener directly to the retrieved `OlMap`.
- **Pro:** avoids the always-on publish cost entirely — only the ONE map instance actually being configured gets a listener, and only for as long as the panel is open.
- **Con:** this is a **novel pattern with no precedent anywhere in the codebase** — every other cross-component transient-state need here goes through Zustand with the documented reset-chain discipline. Introducing a bare mutable module singleton sidesteps that discipline (no `reset()` call visible in the two established chains for anyone auditing them), and needs its OWN bespoke lifecycle/testing story (mocking a module-level `Map` in specs is less standard than mocking a Zustand store, for which this codebase already has an established `vi.mock("../../store/xStore", ...)` idiom used in every relevant spec file read during this research).
- Rejected in favor of (a): lower blast radius doesn't outweigh breaking with the codebase's single established state-sharing convention, especially given CLAUDE.md's explicit "match existing patterns, don't invent" instruction.

**(c) Threading a widget id + a viewport getter through `ConfigPanelProps`**

- `widgetId` is *already* threaded through `ConfigPanelProps` (added Phase 109.1, `registry.ts:97`) — but a **getter callback** cannot be threaded the same way because `MapChartRenderer` and `MapConfigPanel` are siblings with no common ancestor that renders both simultaneously ( `WidgetRenderer` renders `MapChartRenderer` on the canvas; `DashboardsPage`'s `WidgetConfigModal` renders `MapConfigPanel` — these are two disjoint render trees under `DashboardsPage`, and `DashboardsPage` itself would have to hold the same kind of registry described in (b), just scoped to itself instead of module-level, and prop-drill it into both `MapChartRenderer` (via `WidgetRenderer`, several extra prop-drilling layers) and into `ConfigPanelProps` (already has the id, would need to add a getter type too).
- **Rejected:** mechanically equivalent to (b) but with a wider blast radius (touches `registry.ts`, `WidgetRenderer.tsx`'s dispatch signature, `MapChartRenderer`'s `Props` type, and `DashboardsPage.tsx`'s own state) for no benefit over (a).

**(d) Nothing better found.** A `useSyncExternalStore`-based subscription to the real OL `View` object was considered but reduces to (b) plus extra boilerplate — Zustand already gives `useSyncExternalStore` semantics for free via its hook.

### Where `widgetId` comes from (verified prop chain)

Traced end-to-end, confirmed by reading each hop:

1. `DashboardsPage.tsx:1517-1560` — `WidgetConfigModal({ widget, ... })` receives the full `WidgetDto` (always has a real, persisted, non-optional `id: number` — `WidgetDto` type at `api/client.ts:471-480`; a widget cannot be configured before it exists server-side, see `handleAddVisualization`, `DashboardsPage.tsx:853-873`, which never auto-opens config after `createWidget`).
2. `DashboardsPage.tsx:1558` — `<ChartConfigPanel ... widgetId={widget.id} />` (comment: "Phase 93 Plan 93-01: self-exclusion in FilterSelectionPanel" — an existing, working precedent for exactly this kind of id-threading).
3. `ChartConfigPanel.tsx:79,114` — `Props.widgetId?: number`, destructured as `widgetId`.
4. `ChartConfigPanel.tsx:611` — forwarded into the `<Custom>` panel slot: `widgetId={widgetId}` (comment: "Phase 109.1 (FSCOPE-V120-04): thread for FilterSelectionPanel selfWidgetId").
5. `registry.ts:90-97` — `ConfigPanelProps.widgetId?: number` — the type `MapConfigPanel` already receives this prop under (it is simply not destructured/used today: `MapConfigPanel({ config, onChange, tables }: ConfigPanelProps)` at `MapConfigPanel.tsx:79` drops it).

**Action for the plan:** add `widgetId` to `MapConfigPanel`'s destructured props — no other file in this chain needs to change. This is the single biggest simplification this research found: the "flagged unknown" about identifying which map is being configured is **already solved and already wired**; only the *store* side (reading the live view once you have the id) is new.

### Recommended store shape

```typescript
// packages/web/src/store/mapCurrentViewStore.ts
import { create } from "zustand";

/** The live OL view of one map widget, in OL's native projection. */
export type MapCurrentView = {
  center: [number, number]; // EPSG:3857 — matches view.getCenter(), zero-conversion round-trip to Phase 112
  zoom: number;              // fractional OL zoom, unrounded
};

type State = {
  views: Record<number, MapCurrentView | undefined>; // keyed by widget.id
  publish: (widgetId: number, view: MapCurrentView) => void;
  clear: (widgetId: number) => void;
  reset: () => void;
};

export const useMapCurrentViewStore = create<State>((set) => ({
  views: {},
  publish: (widgetId, view) =>
    set((s) => ({ views: { ...s.views, [widgetId]: view } })),
  clear: (widgetId) =>
    set((s) => {
      const next = { ...s.views };
      delete next[widgetId];
      return { views: next };
    }),
  reset: () => set({ views: {} }),
}));
```

Wiring inside `MapChartRenderer.tsx` (new effect, placed near Effect 9a/9b for locality — does NOT touch the existing sync effects):

```typescript
// New effect: always-on publish of THIS widget's live view for MapConfigPanel's readout.
// Unconditional — no syncEnabled gate (unlike Effect 9a). Publishes once on mount (so the
// store has a value even if the map is never panned) AND on every moveend thereafter.
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  const publishCurrent = () => {
    const view = map.getView();
    const center = view.getCenter();
    const zoom = view.getZoom();
    if (!center || zoom === undefined) return;
    useMapCurrentViewStore.getState().publish(widget.id, { center: center as [number, number], zoom });
  };
  publishCurrent(); // initial value, before any moveend fires
  const key: EventsKey = map.on("moveend", publishCurrent);
  return () => {
    unByKey(key);
    useMapCurrentViewStore.getState().clear(widget.id);
  };
}, [widget.id]);
```

Reading side inside `MapConfigPanel.tsx`:

```typescript
export default function MapConfigPanel({ config, onChange, tables, widgetId }: ConfigPanelProps): JSX.Element {
  const currentView = useMapCurrentViewStore((s) =>
    widgetId === undefined ? undefined : s.views[widgetId]
  );
  // ...
}
```

### Storage shape (Claude's discretion, per CONTEXT.md)

**Recommendation: EPSG:3857, not EPSG:4326.**

- `MapChartRenderer.tsx`'s View is hard-locked to `projection: "EPSG:3857"` (PITFALL M-03). Phase 112 will feed `defaultView.center`/`.zoom` straight into either `new OlView({ center, zoom })` or `view.animate({ center, zoom })` — both expect EPSG:3857 coordinates. Storing EPSG:3857 makes Phase 112's read path a **zero-conversion passthrough**.
- Storing EPSG:4326 instead would force Phase 112 to `transform("EPSG:4326", "EPSG:3857")` on every load, and — more importantly — would put a lossy 3857→4326→3857 round trip between "what the designer framed" and "what Phase 112 reproduces." The locked requirement ("store the exact fractional zoom... reopening reproduces precisely the framed view") argues for the byte-identical native representation, not a converted one. `zoom` itself has no projection at all, so it is unaffected — the reasoning is EPSG-specific to `center`.
- Concrete field, added to `MapWidgetConfig` in `wmsUrlBuilder.ts` immediately after the existing `syncViewport?: boolean;` field (same section, same style):
  ```typescript
  /** Phase 111 (MAPVIEW-V121-01/04): designer-saved default view, in EPSG:3857 (OL's native
   *  projection — zero-conversion for Phase 112's View construction). Absent = no default,
   *  Phase 112 falls back to world view (center [0,0], zoom 2) per MAPVIEW-V121-03. */
  defaultView?: { center: [number, number]; zoom: number };
  ```
- Add a thin, pure read-helper in `mapInfoConfig.ts` (matching the file's existing convention — every other field there has a `getXxx(config)` accessor, even ones with no numeric default to apply):
  ```typescript
  /** Read the per-widget saved default view. Returns undefined when the config carries no
   *  `defaultView` field — legacy widgets and widgets with no saved default both fall through
   *  to Phase 112's world-view fallback (MAPVIEW-V121-03). Unlike the other getters in this
   *  file, there is no default VALUE to substitute — undefined IS the correct default state. */
  export function getDefaultView(
    config: Pick<MapWidgetConfig, "defaultView">,
  ): { center: [number, number]; zoom: number } | undefined {
    return config.defaultView;
  }
  ```
  Phase 112 should import and use this getter rather than reading `config.defaultView` directly, for the same "one canonical read path" reason every other map config field in this codebase does.

### Display formatting (EPSG:3857 → human-readable)

Extract a small, pure, independently-testable helper rather than inlining `transform()` calls in the JSX (matches this codebase's established pattern of pulling display/derivation logic into `lib/*.ts` — see `mapInfoConfig.ts`, `basemaps.ts`, `spatialTargets.ts`, all of which `MapConfigPanel` already imports from):

```typescript
// packages/web/src/lib/mapViewFormat.ts
import { transform } from "ol/proj";

/** "40.71°N, 74.01°W" — 2 decimal places, matches the CONTEXT.md-locked example format. */
export function formatLatLon(centerEpsg3857: [number, number]): string {
  const [lon, lat] = transform(centerEpsg3857, "EPSG:3857", "EPSG:4326") as [number, number];
  const latHemi = lat >= 0 ? "N" : "S";
  const lonHemi = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latHemi}, ${Math.abs(lon).toFixed(2)}°${lonHemi}`;
}

/** "12.4" — 1 decimal place, matches the CONTEXT.md-locked example ("zoom 12.4"). */
export function formatZoom(zoom: number): string {
  return zoom.toFixed(1);
}
```

- `transform(coord, "EPSG:3857", "EPSG:4326")` is the exact call already used in production code at `MapChartRenderer.tsx:1718` and `:2037-2038` — same signature, same two projection-string constants, no surprises.
- **Testing note:** `transform` from `ol/proj` is pure math (Web Mercator inverse projection) with no DOM/canvas dependency — it does NOT strictly need mocking to be safe in jsdom, unlike `ol/Map`/`ol/View`/`ol/layer/*` which touch rendering internals. `MapChartRenderer.spec.tsx` mocks it anyway (line 274) purely for **deterministic, hand-computable test assertions**, not because the real function is unsafe. Given `mapViewFormat.ts` is a tiny, isolated pure module, its own spec (`mapViewFormat.spec.ts`) can reasonably use the REAL `ol/proj` with known lat/lon fixtures (e.g. `transform([0,0],...)` → `0.00°N, 0.00°E`) instead of adding a mock — simpler and arguably higher-fidelity. If the plan prefers consistency with the existing mock convention instead, copy `MapChartRenderer.spec.tsx`'s `vi.mock("ol/proj", ...)` block verbatim.
- **`MapConfigPanel.spec.tsx` currently has ZERO OL mocks of any kind** (verified — it renders `MapConfigPanel` directly with only `dashboardLayersStore` mocked). If `mapViewFormat`'s formatting functions are imported directly into `MapConfigPanel.tsx` (not just indirectly), `MapConfigPanel.spec.tsx` will need to add `vi.mock("../../lib/mapViewFormat", () => ({ formatLatLon: (c) => `MOCK(${c[0]},${c[1]})`, formatZoom: (z) => String(z) }))` (mock the lib module, not `ol/proj` directly) — this is the cleaner seam and avoids needing an `ol/proj` mock inside a spec file that has never needed OL knowledge before.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-tree "read the live value of a sibling's imperative object" | A bespoke React Context, a prop-drilled callback through `WidgetRenderer`'s dispatch, or a raw module-level mutable singleton | A new Zustand store, scoped selector | Matches the ONE established pattern in this codebase for this exact class of problem (`mapViewportSyncStore`), inherits the tested reset-chain discipline and scoped-selector-avoids-rerender-storm convention for free |
| EPSG:3857 ↔ EPSG:4326 conversion | Manual Web Mercator trig | `transform` from `ol/proj` | Already imported, already used, already correct; hand-rolling risks subtle sign/scale errors in the inverse projection |
| Button/section styling | New CSS classes | `config-group`/`config-group-label`/`config-hint`/`ds-actions`/`btn-primary btn-sm`/`ghost-sm`/`ghost-sm ghost-danger` from `global.css` | CLAUDE.md: an invented class renders unstyled and passes `tsc`, vitest, AND theme-guard — this is a silent-failure trap, not a lint-caught one |

**Key insight:** every piece of this phase's "hard problem" already has a working precedent somewhere in this same file (`MapChartRenderer.tsx`) or its immediate neighbors (`registry.ts`, `ChartConfigPanel.tsx`). The work is closer to "generalize an existing pattern correctly" than "design something new."

## Common Pitfalls

### Pitfall 1: Forgetting the initial (mount-time) publish
**What goes wrong:** The readout shows "—" / disabled "Set as default" the FIRST time a designer opens config on a map they haven't panned since the dashboard loaded.
**Why it happens:** Copying Effect 9a literally only attaches a `moveend` listener — Effect 9a doesn't need an initial value because sync only cares about *changes* propagating outward, but this feature needs the CURRENT value to be already-correct in the store the moment the panel opens, before any interaction.
**How to avoid:** Call the publish function once, synchronously, right after registering the listener (shown in the code sample above).
**Warning signs:** A spec that only fires `capturedMoveendHandler!()` and asserts store state, without a separate assertion for the value immediately after mount (before firing moveend), would miss this.

### Pitfall 2: Re-adding the `syncEnabled` gate by copy-paste habit
**What goes wrong:** If Effect 9a's exact gate (`if (!syncEnabled || dashboardId === undefined) return;`) is copied along with its shape, the new effect would silently do nothing for the ~majority of maps that have "Sync viewport" off by default (`DEFAULT_SYNC_VIEWPORT = false`) — reproducing the EXACT bug this phase exists to avoid.
**How to avoid:** The new effect's only guard should be `if (!map) return;` — no toggle, no `dashboardId` check (this store isn't dashboard-scoped at all).

### Pitfall 3: StrictMode double-construction (PITFALL M-01)
**What goes wrong:** React 18 StrictMode (dev only) runs mount→cleanup→mount on Effect 1's hook state; without the existing `if (mapRef.current) return;` guard, TWO `OlMap` instances would be constructed, and — relevant to this phase — the new publish effect could attach a `moveend` listener to a map instance that gets disposed moments later, or publish under a stale reference.
**How to avoid:** The new effect depends only on `[widget.id]` and reads `mapRef.current` fresh inside the effect body (not captured in a closure from an earlier render) — this is already how Effect 9a/9b are written; follow the same shape. No new StrictMode-specific code is needed IF the new effect is a genuinely separate `useEffect` from Effect 1 (it must be — Effect 1 has an empty dep array and only runs once per M-01 lock; a `[widget.id]` dep effect is a different effect entirely, which is correct here since `widget.id` is stable for the component's life anyway).

### Pitfall 4: Subscribing to the whole store object instead of a scoped slice
**What goes wrong:** `useMapCurrentViewStore((s) => s.views)` (or worse, `useMapCurrentViewStore()` with no selector) would re-render `MapConfigPanel` on EVERY map's moveend on the dashboard, not just the one being configured — and since every map now publishes unconditionally (Pitfall 2's fix), this is a much larger blast radius than the old sync store's re-render-storm risk.
**How to avoid:** Scoped selector exactly as shown: `(s) => widgetId === undefined ? undefined : s.views[widgetId]`. This is the S-02-equivalent lock for this store; call it out explicitly in the plan the same way Effect 9a's comment does ("selector scoped to THIS [widget]'s slot only — never subscribe to the whole [...] object").

### Pitfall 5: Treating `isSyncDrivenRef` as relevant to this feature
**What goes wrong:** `isSyncDrivenRef` exists solely to stop a sync-driven `view.animate()` from re-publishing into `mapViewportSyncStore` and causing an echo loop between two sync-enabled maps. This phase's store has no such loop — nothing ever calls `.animate()` in response to reading `useMapCurrentViewStore`; it's a strictly one-directional publish (map → store → readout). Gating the new effect on `isSyncDrivenRef` would be a no-op at best and, at worst, would suppress the correct initial/moveend publish during a legitimate sync-driven pan on a map that ALSO happens to be sync-enabled (its true current view SHOULD still be reflected in the config-panel readout even if that pan was sync-driven).
**How to avoid:** Do not reference `isSyncDrivenRef` anywhere in the new effect.

### Pitfall 6: Missing the `defaultView` field from the `delete` (Clear) path
**What goes wrong:** Naively writing `onChange({ ...config, defaultView: undefined })` for Clear leaves an explicit `defaultView: undefined` key in the persisted JSON (depending on how the server/DB layer serializes it — `JSON.stringify` drops `undefined` values, so this specific case is probably safe, but every other optional-field clear in this file (`changeBasemapCss`, spatial-target `spatialCol`) explicitly `delete`s the key rather than setting it to `undefined`, for clarity/consistency).
**How to avoid:** Match the established convention: `const next = { ...config }; delete next.defaultView; onChange(next);` (mirrors `changeBasemapCss`'s `if (raw.trim() === "") delete next[key];` at `MapConfigPanel.tsx:101-106`).

## Code Examples

### Full recommended `DEFAULT VIEW` section (placed adjacent to `VIEWPORT SYNC`, per CONTEXT.md's discretion note)

```tsx
{/* ─── DEFAULT VIEW (Phase 111 MAPVIEW-V121-01/04) ─────────────── */}
<div className="config-group">
  <div className="config-group-label">DEFAULT VIEW</div>
  <div className="config-hint">
    {savedDefaultView
      ? `Current default: zoom ${formatZoom(savedDefaultView.zoom)} · ${formatLatLon(savedDefaultView.center)}`
      : "No default — opens at world view"}
  </div>
  <div className="ds-actions">
    <button
      type="button"
      className="btn-primary btn-sm"
      disabled={!currentView}
      onClick={() => currentView && onChange({ ...config, defaultView: currentView })}
    >
      {currentView
        ? `Set as default — zoom ${formatZoom(currentView.zoom)} · ${formatLatLon(currentView.center)}`
        : "Set as default"}
    </button>
    {savedDefaultView && (
      <button
        type="button"
        className="ghost-sm ghost-danger"
        onClick={() => {
          const next = { ...config };
          delete next.defaultView;
          onChange(next);
        }}
      >
        Clear
      </button>
    )}
  </div>
</div>
```

where `savedDefaultView = getDefaultView(widgetCfg)` (the persisted value) and `currentView = useMapCurrentViewStore((s) => widgetId === undefined ? undefined : s.views[widgetId])` (the live, pending-replacement value) — the SAME "config vs live" distinction already made throughout this file (e.g. `basemapLight` reads from `config` while OL's actual rendered state is downstream of it).

### Existing precedent for the moveend-publish wiring being copied

```typescript
// Source: packages/web/src/components/charts/MapChartRenderer.tsx:2214-2235 (Effect 9a, existing code)
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (!syncEnabled || dashboardId === undefined) return;
  const key: EventsKey = map.on("moveend", () => {
    if (isSyncDrivenRef.current) {
      isSyncDrivenRef.current = false;
      return;
    }
    const view = map.getView();
    const center = view.getCenter();
    const zoom = view.getZoom();
    if (!center || zoom === undefined) return;
    useMapViewportSyncStore.getState().publish(dashboardId, {
      center: center as [number, number],
      zoom,
      originWidgetId: widget.id,
      bump: Date.now(),
    });
  });
  return () => { unByKey(key); };
}, [syncEnabled, dashboardId, widget.id]);
```

### Existing precedent for the scoped-selector read

```typescript
// Source: packages/web/src/components/charts/MapChartRenderer.tsx:2204-2206 (existing code)
// S-02 lock: selector scoped to THIS dashboard's slot only — never subscribe to
// the whole viewports object (would re-render on any dashboard's updates).
const incomingViewport = useMapViewportSyncStore((s) =>
  dashboardId === undefined ? undefined : s.viewports[dashboardId]
);
```

## State of the Art

Not applicable — this is a same-repo mechanism-design question, not an ecosystem/library currency question. No "old vs current approach" axis exists here; the relevant "history" is entirely internal (Phase 104's sync store, which this phase explicitly must NOT reuse, only pattern-match).

## Open Questions

1. **Exact button label wording ("Set as default" vs "Set as default view" vs including the readout inline in the button vs above it)**
   - What we know: CONTEXT.md gives one illustrative example (`Set as default — zoom 12.4 · 40.71°N, 74.01°W`) and explicitly leaves exact wording to Claude's discretion.
   - What's unclear: whether the live readout should be INSIDE the button label (as the example shows) or as separate static text above/beside it.
   - Recommendation: follow the example literally (readout inside the primary button's own label) — it directly satisfies "the control MUST show the view it would capture, live" as one visual unit, and needs no extra DOM/CSS beyond what's already planned above.

2. **Whether `defaultView.center`/`.zoom` should be validated/clamped anywhere**
   - What we know: OL's live `getCenter()`/`getZoom()` values are always well-formed numbers when defined (the existing `if (!center || zoom === undefined) return;` guard in Effect 9a already excludes the only failure mode OL exposes).
   - What's unclear: none — no clamping is needed; this mirrors `mapInfoConfig.ts`'s explicit "NO CLAMPING / VALIDATION HERE" convention for pass-through numeric fields where the UI itself is the only source of writes (unlike free-text numeric inputs elsewhere in this same panel, which DO need blur-time clamping because a human can type anything into them — this field is never hand-typed).

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false`.

## Sources

### Primary (HIGH confidence — all verified by direct reading, 2026-09-09)
- `packages/web/src/components/charts/MapChartRenderer.tsx` (full PITFALL header, Effect 1 mount/cleanup lines 997-1120, Effect 9a/9b lines 2201-2253, `dashboardId` derivation line 548, `transform` usage lines 55, 1718, 2037-2038)
- `packages/web/src/store/mapViewportSyncStore.ts` (full file — store shape, reset-chain doc comment, zustand mock-shim requirement)
- `packages/web/src/components/charts/MapConfigPanel.tsx` (full file — existing sections, `onChange` auto-save convention, `changeBasemapCss` delete-on-clear pattern)
- `packages/web/src/components/charts/registry.ts` (`ConfigPanelProps` full type, lines 44-98, including the `widgetId` field and its Phase 109.1 doc comment)
- `packages/web/src/components/charts/ChartConfigPanel.tsx` (`Props.widgetId`, destructuring, forwarding to `<Custom>` at line 611)
- `packages/web/src/components/DashboardsPage.tsx` (`WidgetConfigModal` lines 1517-1560, `handleAddVisualization` lines 853-873, `handleSaveConfig` lines 901-922, reset-chain line 575-576)
- `packages/web/src/App.tsx` (reset-chain line 148-149)
- `packages/web/src/lib/wmsUrlBuilder.ts` (`MapWidgetConfig` type, `syncViewport` field placement lines 151-153)
- `packages/web/src/lib/mapInfoConfig.ts` (full file — established getter convention for optional config fields)
- `packages/web/src/components/charts/MapChartRenderer.spec.tsx` (OL mock scaffolding lines 156-340, `ol/proj` mock lines 270-297, moveend-capture pattern lines 134-136/210-219, sync-publish test block lines 6272-6394)
- `packages/web/src/components/charts/MapConfigPanel.spec.tsx` (confirmed zero OL mocks present today, lines 1-90)
- `packages/web/src/components/charts/NumericLineConfigPanel.tsx`, `RadioGroupConfigPanel.tsx`, `CbConfigForm.tsx` (via grep, `ghost-sm ghost-danger` Clear-button precedent)
- `packages/web/src/styles/global.css` (`.ds-actions`, `.btn-primary`, `.btn-sm`, `.ghost-sm`, `.ghost-danger`, `.config-group`, `.config-group-label`, `.config-hint`, `.config-toggle` rules)
- `packages/web/src/api/client.ts` (`WidgetDto` type, line 471-480 — `id: number` non-optional)
- `packages/web/package.json` (`ol` version `^10.9.0`)
- `.planning/config.json` (`workflow.nyquist_validation: false`)
- `.planning/phases/111-map-default-view-capture-save/111-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` §Phase 111, `CLAUDE.md`

### Secondary / Tertiary
None used — no WebSearch or Context7 lookups were needed for this phase; it is entirely a same-repo mechanism question with no external-library-currency dimension.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing `ol`/`zustand` usage read directly from source
- Architecture (the widgetId-keyed store + prop-chain trace): HIGH — every hop in the prop chain and every existing pattern cited was read directly, not inferred or recalled from training data
- Pitfalls: HIGH — all six pitfalls are grounded in specific, cited lines of existing code/comments (PITFALL M-01, Effect 9a's gate, S-02 lock, `isSyncDrivenRef`'s documented purpose)

**Research date:** 2026-09-09
**Valid until:** Effectively indefinite for the mechanism design (internal, stable code); ~30 days if `ol` is upgraded or `MapChartRenderer.tsx`'s Effect numbering/structure changes materially before this phase is planned/executed.
