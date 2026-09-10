# Phase 108: Applies-To List + On-Canvas Highlight - Research

**Researched:** 2026-07-07
**Domain:** React + zustand transient UI state; DOM scroll/flash; reuse of a pure reverse-map lib
**Confidence:** HIGH (every finding read directly from the current codebase; Phase 105 lib + Phase 107 panel already landed)

<user_constraints>
## User Constraints (from 108-CONTEXT.md)

### Locked Decisions
- **Applies-to display (FSCOPE-V120-01):** Each panel chip shows a compact **"applies to N widgets"** line + an **expand chevron** revealing the widget list (NOT always-expanded). Expanded rows show widget titles; for map widgets append the matched **layer name(s)** ("Coverage Map — Roads") from `WidgetApplyEntry.layerNames`. Zero-match → "applies to 0 widgets", NO expand control.
- **On-canvas highlight (FSCOPE-V120-02):** Hovering a chip highlights ALL its widgets with an **accent outline/ring** (`var(--accent)`; box-shadow ring) on the affected `.widget-card`s. Non-affected widgets are NOT dimmed (ring-only). Highlight target is the widget CARD (map layers resolve to owning map widget card). Clears on mouse-leave.
- **Interaction mapping:** Hover chip → highlight all (ring). Click chip → scroll to the topmost affected widget + flash ALL affected. Individual expanded widget rows are ALSO clickable → scroll to + flash THAT one.
- **Scroll + flash (FSCOPE-V120-03):** Smooth-scroll (scrollIntoView) to topmost affected widget + flash ALL (~1s pulse). Single-row click → scroll+flash just that one. Flash is a short accent pulse (distinct from the steady hover ring); respect `prefers-reduced-motion`.
- **Architecture (locked):** NEW session-only `filterHighlightStore` (zustand): a STEADY highlighted set + a TRANSIENT flashing set with a retrigger nonce. Actions `setHighlighted(ids)` / `clearHighlighted()` / `flash(ids)`. MUST join BOTH reset chains (DashboardsPage DashboardOpen cleanup + App UNAUTHORIZED). Extract a **`WidgetCard`** component; each subscribes with a SCOPED BOOLEAN selector so only cards whose state changed re-render. Deterministic flash-timeout cleanup on unmount / re-trigger. A live hook (`useReverseFilterMap`) wraps `computeReverseFilterMap` (Phase 105): enumerate all vizs (widgets + map layers → owning widget) with cfg/tableId/dynamicViewId/spatialCapable/title, read `useFilterStore` + `useSpatialFilterStore` via scoped selectors / version primitives (PITFALL S-02), honor `dvFilterScopeDisabled`. Mirrors DashboardsPage `includedLayers` + `useFilterScopeSummary` source-scoping.

### Claude's Discretion
- Exact ring thickness/offset, flash keyframe + duration, chevron/expand affordance styling.
- Whether hovering an expanded widget row also previews-highlights just that one.
- Reduced-motion exact treatment.

### Deferred Ideas (OUT OF SCOPE)
- Global clear-all → **Phase 109**. Designer mode-toggle UI → **Phase 110**. Dim-the-others highlight style + per-row hover-preview were considered and set aside (discretion, not deferred features).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FSCOPE-V120-01 (display portion) | For each active filter, the panel shows which widgets it applies to (count + expandable list) | Live hook `useReverseFilterMap` (Q3) feeds `FilterApplyEntry[]`/`ShapeApplyEntry[]` joined to Phase-107 chips by filter/shape reference identity; render "applies to N widgets" line + chevron expander in the panel chip (Q1/Q5/Q6) |
| FSCOPE-V120-02 (hover→highlight) | Hovering a filter highlights the widgets it applies to on the canvas | `filterHighlightStore.highlightedIds:Set<number>` (Q1) + `WidgetCard` scoped boolean selector (Q2) + `.widget-card--highlighted` ring class (Q6); chip `onMouseEnter/Leave` (Q5) |
| FSCOPE-V120-03 (click→scroll+flash) | Clicking a filter scrolls to + briefly flashes affected widget(s) | `filterHighlightStore.flashingIds` + `flashNonce` (Q1) + WidgetCard ref `scrollIntoView` + flash keyframe (Q2/Q4/Q6); chip/ row `onClick` (Q5) |
</phase_requirements>

## Summary

Phase 108 is a **pure frontend, presentation + transient-UI-state phase**. All hard computation already shipped in Phase 105 (`computeReverseFilterMap` — pure, tested, 465-line spec) and the panel shell shipped in Phase 107 (`FilterPanel`/`FilterChip`/`FilterPanelRail`, already wired in `DashboardsPage.tsx` behind `isPanelMode`). Phase 108 adds exactly four new artifacts and two edits:

1. **`store/filterHighlightStore.ts`** (NEW) — session-only zustand slice: a steady `highlightedIds:Set<number>`, a transient `flashingIds:Set<number>`, and a `flashNonce:number` for re-trigger. Mirrors `mapViewportSyncStore.ts` (the 11th store) exactly; becomes the **12th** store in BOTH reset chains.
2. **`lib/useReverseFilterMap.ts`** (NEW) — thin hook wrapping the Phase-105 pure fn: enumerates `VizDescriptor[]` from DashboardsPage's in-scope `widgets`/`layers`, reads `useFilterStore`/`useSpatialFilterStore` via version-primitive selectors (S-02), honors `dvFilterScopeDisabled`, returns `{filterEntries, shapeEntries}` joinable to chips by reference identity.
3. **`components/WidgetCard.tsx`** (NEW) — extracted from the inline `.widget-card` JSX at `DashboardsPage.tsx:1108-1166`. Subscribes to `filterHighlightStore` with a scoped boolean selector (`s => s.highlightedIds.has(w.id)`) → only affected cards re-render. Holds a `ref` for `scrollIntoView`, toggles ring/flash classes, owns deterministic flash-timeout cleanup.
4. **CSS** in `global.css` — `.widget-card--highlighted` (ring), `.widget-card--flashing` + `@keyframes widget-flash`, and applies-to line/expander classes; tokens/`color-mix` only.
5. **EDIT `FilterChip.tsx` / `FilterPanel.tsx`** — panel variant only: applies-to line + chevron expander + `onMouseEnter/Leave`/`onClick` handlers, expanded rows individually clickable. Top-bar variant byte-untouched.
6. **EDIT `DashboardsPage.tsx`** — replace inline card JSX with `<WidgetCard>`, call `useReverseFilterMap`, thread applies-to data + highlight callbacks into the panel groups, register `filterHighlightStore.reset()` in the DashboardOpen cleanup chain (and App.tsx).

**Primary recommendation:** Ship as **2 plans** — Plan 108-01 = foundation (`filterHighlightStore` + `WidgetCard` extraction + `useReverseFilterMap` + CSS + both reset chains), Plan 108-02 = panel wiring (applies-to line/expander + hover/click handlers threaded through FilterPanel/FilterChip). The two research-flagged HIGH risks (re-render storm, dangling flash timers) are both contained in Plan 108-01 and covered by unit tests there.

## Standard Stack

**ZERO new npm packages** (locked, STATE.md decision 7). Everything already installed:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zustand` | installed | `filterHighlightStore` transient slice | Every other store uses it; reset-shim auto-covers `src/store/*.ts` |
| `@fortawesome/react-fontawesome` + free-solid | installed | chevron icons | `faChevronDown`/`faChevronRight` already used in `FilterPanel.tsx:19` |
| React 18 + `useMemo`/`useRef`/`useEffect` | installed | hook + WidgetCard | house pattern |

No installation step. No Context7 lookup needed — this is an internal-pattern phase, not a library-integration phase.

## Architecture Patterns

### File layout (new/changed)
```
packages/web/src/
├── store/
│   └── filterHighlightStore.ts       # NEW — steady + transient sets + nonce; 12th reset-chain store
├── lib/
│   └── useReverseFilterMap.ts        # NEW — thin hook over computeReverseFilterMap (Phase 105)
├── components/
│   ├── WidgetCard.tsx                # NEW — extracted .widget-card; scoped highlight selector + ref
│   ├── DashboardsPage.tsx            # MOD — use WidgetCard, call hook, thread applies-to+callbacks, reset chain
│   ├── FilterPanel.tsx               # MOD — applies-to prop threading (panel only)
│   └── FilterChip.tsx                # MOD — applies-to line/expander + hover/click (panel variant only)
└── styles/global.css                 # MOD — ring + flash keyframe + applies-to classes
packages/web/src/App.tsx              # MOD — filterHighlightStore.reset() in UNAUTHORIZED chain
```

---

### Q1 — `filterHighlightStore` design

**Recommended shape** (mirrors `mapViewportSyncStore.ts` structure + lifecycle comment):

```typescript
// packages/web/src/store/filterHighlightStore.ts
import { create } from "zustand";

type State = {
  highlightedIds: Set<number>;   // STEADY — hover → ring; widget CARD ids (map layers already
                                 //          resolved to owning widget id by the reverse map)
  flashingIds: Set<number>;      // TRANSIENT — click → ~1s pulse; cleared by WidgetCard timers
  flashNonce: number;            // monotonic; re-clicking the SAME widget re-fires the flash even
                                 //           when flashingIds is identical (Set ref would be equal)
  setHighlighted: (ids: number[]) => void;
  clearHighlighted: () => void;
  flash: (ids: number[]) => void;   // sets flashingIds = new Set(ids), bumps flashNonce
  reset: () => void;
};

export const useFilterHighlightStore = create<State>((set) => ({
  highlightedIds: new Set(),
  flashingIds: new Set(),
  flashNonce: 0,
  setHighlighted: (ids) => set({ highlightedIds: new Set(ids) }),
  clearHighlighted: () => set({ highlightedIds: new Set() }),
  flash: (ids) => set((s) => ({ flashingIds: new Set(ids), flashNonce: s.flashNonce + 1 })),
  reset: () => set({ highlightedIds: new Set(), flashingIds: new Set(), flashNonce: 0 }),
}));
```

**Why a Set of `number` (widget-card ids), not vizKeys:** the Phase-105 reverse map already resolves `l:<layerId>` → owning **map widget id** (`WidgetApplyEntry.widgetId`). Highlight/flash target the widget CARD (`.widget-card` keyed by `w.id`), so the store holds plain widget-card ids. This is simpler than the ARCHITECTURE.md draft (`Set<"w:*"|"l:*">`) which predates Phase 105's widget-level output.

**Scoped-selector re-render isolation (PITFALL S-02 / re-render-storm HIGH risk):** each `WidgetCard` subscribes with a selector that returns a **boolean primitive**:
```typescript
const isHighlighted = useFilterHighlightStore((s) => s.highlightedIds.has(w.id));
const isFlashing    = useFilterHighlightStore((s) => s.flashingIds.has(w.id));
const flashNonce    = useFilterHighlightStore((s) => s.flashNonce); // drives re-fire; see Q2
```
Zustand's default `Object.is` equality short-circuits when a boolean is unchanged. On a hover that changes `highlightedIds`, zustand re-runs every subscriber's selector, but only cards whose boolean **flipped** re-render. This is the exact pattern `useFilterScopeSummary.ts:106-112` uses (version integers) and `FilteringBadge` uses (primitive `.has()` projections). **Confirmed correct** — a `Set` in state + `s => s.someSet.has(myId)` returns a stable boolean per card.

> Caveat: `flashNonce` is a shared integer subscribed by ALL WidgetCards, so a flash re-fire re-runs all card render fns. This is acceptable (flash is a click, not a hover; happens rarely) and each card still cheaply no-ops if `isFlashing` is false. If profiling ever shows this matters, scope the nonce read behind `isFlashing` — but do NOT prematurely optimize.

**Note on Set mutation:** always assign a NEW `Set` (never mutate in place) so the reference changes and selectors re-evaluate — the store above does this in every action.

---

### Q2 — `WidgetCard` extraction

**Exact source boundary:** `DashboardsPage.tsx:1090-1168` — the arrow-fn body inside `widgets.map((w) => { ... })`. Extract everything from the `mapTableIds` IIFE (line 1094) through the returned `<div className="widget-card">…</div>` block (lines 1108-1166). The card's inner content (header, `MapFilteringBadge`/`FilteringBadge`/`WidgetFilterBadge`, `widget-actions`, `WidgetRenderer`) moves **verbatim** — minimize churn, keep map/chart rendering byte-identical.

**Props the extracted `WidgetCard` needs** (all already in scope at the call site):
```typescript
type WidgetCardProps = {
  widget: WidgetDto;
  layers: DashboardLayerDto[];          // for mapTableIds IIFE
  associatedTables: TableDto[];         // WidgetRenderer `tables`
  targetsByTable: Map<number, ...>;     // spatialCapable check (line 1123)
  canEdit: boolean; canConfigure: boolean;
  onConfigure: (w: WidgetDto) => void;
  onDuplicate: (w: WidgetDto) => void;
  onRemove: (id: number) => void;
};
```

**Ref + highlight/flash wiring inside WidgetCard:**
```typescript
const cardRef = useRef<HTMLDivElement>(null);
const isHighlighted = useFilterHighlightStore((s) => s.highlightedIds.has(widget.id));
const isFlashing    = useFilterHighlightStore((s) => s.flashingIds.has(widget.id));
const flashNonce    = useFilterHighlightStore((s) => s.flashNonce);
const [flashOn, setFlashOn] = useState(false);
const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Deterministic flash: retrigger on (isFlashing, flashNonce) change; ALWAYS clear the prior
// timer first (re-trigger safety) and clear on unmount (leak safety — HIGH risk item).
useEffect(() => {
  if (!isFlashing) return;
  setFlashOn(false);
  // force reflow so the keyframe restarts even on an identical class (nonce-driven re-fire)
  void cardRef.current?.offsetWidth;
  setFlashOn(true);
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => setFlashOn(false), FLASH_MS); // FLASH_MS ~= 1000
  return () => { if (timerRef.current) clearTimeout(timerRef.current); };
}, [isFlashing, flashNonce]);

// className: `widget-card${isHighlighted ? " widget-card--highlighted" : ""}${flashOn ? " widget-card--flashing" : ""}`
// <div ref={cardRef} className={...}>
```
The parent (DashboardsPage) exposes the scroll: it looks up the card via a `Map<number, HTMLDivElement>` of refs, OR — simpler and preferred — the store's `flash(ids)` is separate from scroll. **Recommendation:** scroll is driven by the panel handler which needs the topmost id and a DOM handle. Give WidgetCard a way to register its ref into a shared ref-map owned by DashboardsPage (a `Map<number, HTMLElement>` in a `useRef`), so the panel click handler can `refMap.current.get(topmostId)?.scrollIntoView(...)`. Alternatively expose a `scrollToWidgetId` field in the highlight store and let each WidgetCard self-scroll when it matches (keeps DOM handles out of the parent). **Preferred: ref-map in DashboardsPage** — it keeps the store pure-data and avoids a second nonce; see Q4.

**Re-render isolation confirmation:** with the boolean selectors above, a hover that highlights widgets 3 and 7 re-renders ONLY cards 3 and 7 (their `isHighlighted` flips true) plus, on clear, flips them back. `WidgetRenderer` (the expensive map/chart child) is untouched because its props (`widget`, `tables`) are unchanged — React bails out of the child subtree if WidgetCard passes stable props. **Wrap `WidgetCard` in `React.memo`** and pass stable callbacks (the existing handlers are already stable-enough; wrap in `useCallback` if needed) so a sibling card's re-render never touches this one.

---

### Q3 — Live hook `useReverseFilterMap`

**Signature + shape** (thin wrapper over Phase-105 `computeReverseFilterMap`):
```typescript
// packages/web/src/lib/useReverseFilterMap.ts
export function useReverseFilterMap(args: {
  widgets: WidgetDto[];
  layers: DashboardLayerDto[];
  dynamicViews: DynamicViewDto[];
  associatedTables: TableDto[];
  targetsByTable: Map<number, SpatialTarget>;   // reuse the one already memoized in DashboardsPage:601
}): { filterEntries: FilterApplyEntry[]; shapeEntries: ShapeApplyEntry[] } {
  const filterVersion        = useFilterStore((s) => s.filterVersion);           // S-02 primitive
  const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
  const dvFilterScopeDisabled = useAuthStore((s) => s.dvFilterScopeDisabled);

  return useMemo(() => {
    const { filters, dvFilters } = useFilterStore.getState();   // arrays read imperatively (S-02)
    const { shapes } = useSpatialFilterStore.getState();
    const vizs = enumerateVizDescriptors({ widgets, layers, dynamicViews, associatedTables, targetsByTable });
    return computeReverseFilterMap({ filters, dvFilters, shapes, vizs, dvFilterScopeDisabled });
  }, [widgets, layers, dynamicViews, associatedTables, targetsByTable,
      filterVersion, spatialFilterVersion, dvFilterScopeDisabled]);
}
```
This mirrors `useFilterScopeSummary.ts:104-168` exactly (primitive version deps drive re-compute; arrays read via `getState()` inside `useMemo`).

**`enumerateVizDescriptors` — the enumeration (the real work of this hook).** Build one `VizDescriptor` per viz, matching `computeReverseFilterMap`'s input contract (`computeReverseFilterMap.ts:29-57`):

- **Chart/table widgets (`vizKind:"widget"`):** iterate `widgets`, keep only `isTriggerType(w.type)` — reuse the `NON_TRIGGER_TYPES` set logic from `useCombinationOrchestrator.ts:70-83` (map/info-card/legend/datafilter/timeline/numericline/radiogroup/calendar excluded; `table` and `records` INCLUDED). For each:
  - `widgetId: w.id`, `widgetTitle: w.title`
  - `cfg: w.config.filterSelection`
  - `tableId: w.config.tableId` OR `dynamicViewId: w.config.dynamicViewId` (mutually exclusive)
  - `spatialCapable: tableId !== undefined && targetsByTable.has(tableId)` (same test as `DashboardsPage.tsx:1121-1124` and `useFilterScopeSummary`)
- **Map layers (`vizKind:"layer"`):** iterate `layers`; for each layer, produce a descriptor whose `widgetId` is the **owning map widget's id**, NOT the layer id. Owning-widget resolution mirrors `mapTableIds` at `DashboardsPage.tsx:1094-1106`: a map widget `w` includes a layer iff `w.config.includedLayerIds` is empty/undefined (includes ALL layers) OR contains `layer.id`, AND the layer is visible (`layer.config.visible !== false`). One layer can belong to multiple map widgets → emit one descriptor per (owning-widget, layer) pair.
  - `layerId: layer.id`, `layerName: <derived>`, `widgetTitle: <owning map widget title>`
  - `cfg: layer.filter_scope` — **TOP-LEVEL field** `layer.filter_scope` (`DashboardLayerDto.filter_scope`, client.ts:654), NEVER `layer.config.filter_scope` (memory: track-config-toplevel-field)
  - `tableId: layer.table_id` OR `dynamicViewId: layer.dynamic_view_id ?? undefined`
  - `spatialCapable: layer.dynamic_view_id == null && targetsByTable.has(layer.table_id)` (the lib forces dv → false internally anyway, `computeReverseFilterMap.ts:107`)
- **`layerName` derivation:** mirror the existing `layerNameFor` at `MapChartRenderer.tsx:768-775` / `LayersModal.tsx:115-147`: operator-set `layer.config.name` wins; else `{schema.name} — {renderMode}`. **Open question / debt:** this naming is the known `GAP-54-04` (legend layer names) area. Recommend extracting the smallest possible shared helper OR duplicating the `config.name ?? table-derived` fallback inline in the enumerator (a full de-dup is out of scope for 108).

**Return join by reference identity:** `computeReverseFilterMap` seeds `filterEntries` keyed by the SAME `ActiveFilter` object references it received (`computeReverseFilterMap.ts:93-97`), and the panel chips in `DashboardsPage.tsx:668-704` iterate those SAME `filters`/`dvFilters`/`shapes` arrays from the store. So the panel joins a chip to its applies-to entry by `===` reference identity (build a `Map<ActiveFilter, WidgetApplyEntry[]>` from `filterEntries`, and `Map<Shape, WidgetApplyEntry[]>` from `shapeEntries`, then look up per chip). **This is why the existing chip-group builder (DashboardsPage:668-726) must carry the raw `f`/`shape` object alongside the display fields** — currently `FilterPanelChip` only carries `text`/`onRemove`. Plan 108-02 must extend the chip prop to include `appliesTo: WidgetApplyEntry[]` (computed by looking up the reverse map at build time).

---

### Q4 — Scroll + flash mechanics

- **scrollIntoView options:** `el.scrollIntoView({ behavior: "smooth", block: "nearest" })`. `block:"nearest"` avoids yanking a widget that's already visible; `"smooth"` per locked decision. Guard `prefers-reduced-motion` → use `behavior: "auto"` (instant) when reduced motion is requested:
  ```typescript
  const reduce = window.matchMedia?.("(max-width: 0)"); // NO — use the reduced-motion query:
  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "nearest" });
  ```
- **Topmost selection:** "topmost" = smallest layout `y`, tie-break smallest `x`. Reuse `getWidgetLayout(widget, index)` (`DashboardsPage.tsx:382`, already used at 763/786/1009) which returns `{x,y,w,h}`. Given the applies-to `WidgetApplyEntry[]` for a chip, map each `widgetId` back to its widget, compute layout, pick `min(y, then x)`. **Do NOT use DOM order** — grid layout order ≠ DOM order in react-grid-layout (absolute positioning). Layout-y is the visually-topmost. (In panel mode the grid is pinned to `lg` breakpoint per `DashboardsPage.tsx:1079`, so the `lg` layout coords are authoritative.)
- **Flash as CSS keyframe:** add `.widget-card--flashing` toggled by WidgetCard's `flashOn` state (Q2). The store's `flash(ids)` sets `flashingIds` + bumps `flashNonce`; WidgetCard's effect (Q2) turns `flashOn` true, forces a reflow (`void offsetWidth`) so re-clicking the same widget restarts the animation, and clears it after `FLASH_MS` (~1000ms).
- **Timer cleanup (leak HIGH risk):** the effect's cleanup `clearTimeout` runs on unmount AND before every re-fire (deps `[isFlashing, flashNonce]`). Store `reset()` in both chains clears `flashingIds` so a dashboard switch mid-flash leaves no residue. Test: mount, `flash([id])`, advance fake timers < FLASH_MS, unmount → assert no state update after unmount (no act warning / spy not called).
- **prefers-reduced-motion for the keyframe:** wrap `@keyframes widget-flash` usage in `@media (prefers-reduced-motion: reduce) { .widget-card--flashing { animation: none; } }` (mirrors the existing `.widget-map-tile` reduced-motion block at `global.css:2501-2505`). The ring (`--highlighted`) is a static box-shadow, no motion, needs no guard.

**Scroll ownership recommendation:** the **panel click handler** (in DashboardsPage, passed into FilterChip) does both: (1) call `useFilterHighlightStore.getState().flash(ids)`, and (2) look up the topmost id's DOM node via a `refMap` (a `useRef<Map<number, HTMLDivElement>>` populated by each WidgetCard on mount via a `registerRef(id, el)` callback prop) and `scrollIntoView`. Keeps scroll imperative and out of the store.

---

### Q5 — Hover/click wiring in FilterChip (panel variant ONLY)

`FilterChip.tsx` currently has two branches (`topbar` verbatim / `panel`). **Touch ONLY the panel branch (lines 45-62).** Add optional props:
```typescript
export type FilterChipProps = {
  text; removeAriaLabel; onRemove; variant; provenance?;   // existing
  appliesTo?: WidgetApplyEntry[];        // panel only — drives the "applies to N widgets" line
  onHighlight?: () => void;              // onMouseEnter/onFocus → setHighlighted(ids)
  onClearHighlight?: () => void;         // onMouseLeave/onBlur  → clearHighlighted()
  onActivate?: () => void;               // onClick chip body    → scroll topmost + flash all
  onActivateWidget?: (widgetId: number) => void; // expanded row click → scroll+flash that one
};
```
- The **top-bar branch returns before any of this** — parity preserved (existing `provenance` is already ignored there; same discipline).
- Panel chip body wraps in `onMouseEnter={onHighlight} onMouseLeave={onClearHighlight}`. **Do NOT put onClick on the whole chip** if it contains the dismiss button — put the click affordance on the chip value row / applies-to line, or stopPropagation on the dismiss button (it already has its own `onClick={onRemove}`; add `e.stopPropagation()` there).
- Applies-to line: below provenance, render `applies to {appliesTo.length} widgets` + a chevron button (`faChevronRight`/`faChevronDown`) gated on `appliesTo.length > 0` (zero → plain text, no chevron, per locked decision). Local `useState` for expanded (mirror `FilterPanelGroup`'s collapse at `FilterPanel.tsx:44`).
- Expanded list: `appliesTo.map(entry => <button className="applies-to-row" onClick={() => onActivateWidget(entry.widgetId)}>{entry.widgetTitle}{entry.layerNames ? ` — ${entry.layerNames.join(", ")}` : ""}</button>)`.

**Threading:** `FilterPanel.tsx` `FilterPanelChip` type + `FilterPanelGroup` map (`FilterPanel.tsx:22-27, 66-77`) must forward the new fields. DashboardsPage's group builders (`panelTableGroups`/`panelDvGroups`/`panelSpatialGroup`, lines 668-726) compute `appliesTo` per chip via the reverse-map lookup and build the `onHighlight`/`onActivate` closures (each closure captures the `WidgetApplyEntry[]` for that chip → derives the id list + topmost).

---

### Q6 — Exact `global.css` classes to add (tokens / color-mix only)

Add near the `.widget-card` block (`global.css:666`). All theme tokens; no `#hex`, no `rgba()`:

```css
/* Phase 108 (FSCOPE-V120-02): steady hover ring on an affected widget card.
   Ring-only (no dimming of others). box-shadow avoids layout shift that `outline`+`border` cause. */
.widget-card--highlighted {
  box-shadow: 0 0 0 2px var(--accent), var(--shadow);   /* keep existing --shadow underneath */
}

/* Phase 108 (FSCOPE-V120-03): transient ~1s accent pulse on click. Distinct from the steady ring. */
.widget-card--flashing {
  animation: widget-flash 1s ease-out 1;   /* theme-guard-ignore: animation timing, not a color/spacing token */
}
@keyframes widget-flash {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent); }
  50%  { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 25%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .widget-card--flashing { animation: none; box-shadow: 0 0 0 2px var(--accent); }
}

/* Phase 108 (FSCOPE-V120-01): applies-to line + expander inside the panel chip.
   Sits under .filter-panel-chip-provenance; reuses 107 tokens/scale. */
.filter-panel-chip-applies {
  display: flex; align-items: center; gap: var(--space-1);
  font-family: var(--font-body); font-size: var(--text-xs); color: var(--muted);
}
.filter-panel-chip-applies-toggle {
  background: none; border: none; color: var(--muted); cursor: pointer;
  padding: var(--space-1); display: flex; align-items: center;
}
.filter-panel-chip-applies-toggle:hover { color: var(--text); }
.filter-panel-chip-applies-toggle:focus-visible {
  outline: 1px solid var(--accent); border-radius: var(--radius-sm);
}
.filter-panel-chip-applies-list {
  display: flex; flex-direction: column; gap: 2px;      /* --space-0 == 2px */
  padding-left: var(--space-2);
}
.applies-to-row {
  background: none; border: none; text-align: left; cursor: pointer;
  font-family: var(--font-body); font-size: var(--text-xs); color: var(--accent-text);
  padding: var(--space-0) 0;
}
.applies-to-row:hover { color: var(--text); text-decoration: underline; }
.applies-to-row:focus-visible { outline: 1px solid var(--accent); border-radius: var(--radius-sm); }
```
(Exact ring thickness / flash duration / chevron styling are Claude's discretion — values above are a starting point.)

**CSS TRAP (memory: css-bugs-evade-tests):** every class above MUST be added to `global.css` in the SAME task that references it, and covered by a class-exists spec (precedent exists: `DashboardsPage.panel.spec.tsx:393-400` already reads `global.css` and asserts required `.filter-panel-*` classes are present — extend that list, or add a sibling spec).

---

### Q7 — Test strategy

| What | How | Type |
|------|-----|------|
| Scoped-selector re-render isolation (HIGH risk) | Render a small harness of N `WidgetCard`s (mock `WidgetRenderer`), instrument each with a render-count spy (a `useEffect` counter or a `vi.fn` in the body). Call `setHighlighted([3])`, assert only card 3's count incremented. This is the key regression test for the re-render storm. | unit (RTL) |
| Flash timer cleanup (HIGH risk) | `vi.useFakeTimers()`; mount a WidgetCard; `flash([id])`; advance < FLASH_MS; `unmount()`; advance past FLASH_MS; assert no post-unmount state update (no React act warning / setFlashOn spy not called after unmount). Also: re-`flash` same id twice, assert the first timer was cleared (only one active timer). | unit (RTL + fake timers) |
| Reverse-map hook wiring | Seed `useFilterStore`/`useSpatialFilterStore` via `getState()` actions; render a probe component calling `useReverseFilterMap` with fixture widgets/layers; assert returned `filterEntries` map a known filter → expected widget ids incl. a map layer → owning widget + `layerNames`; assert `dvFilterScopeDisabled` flips dv entries to accept-all. (The pure core is already covered by `computeReverseFilterMap.spec.ts` — here test only the ENUMERATION + store reads.) | unit (RTL) |
| Applies-to rendering | Render panel `FilterChip` variant with `appliesTo=[{widgetId,widgetTitle,layerNames}]`; assert "applies to 1 widgets" (or singular per copy), chevron present; zero-length → no chevron; expand → rows shown with layer-name suffix. | unit (RTL) |
| Hover/click handlers | fireEvent.mouseEnter/mouseLeave on panel chip → assert `setHighlighted`/`clearHighlighted` called with correct ids; click chip → assert `flash` called + `scrollIntoView` invoked on the topmost id's stubbed node; click an expanded row → assert single-id flash+scroll. | unit (RTL) |
| Top-bar variant untouched | Existing `FilterChip.spec.tsx` topbar assertions must still pass unchanged (parity gate). | regression |
| Class-exists in global.css | Extend `DashboardsPage.panel.spec.tsx:393` (or new spec): assert `.widget-card--highlighted`, `.widget-card--flashing`, `@keyframes widget-flash`, `.filter-panel-chip-applies*`, `.applies-to-row` present. | unit (fs read) |
| Both reset chains include the store | Assert `filterHighlightStore.reset()` is wired (mirror how MapViewportSync is asserted, if such a spec exists; else a source-grep spec). | unit |

**jsdom stubs required:**
- `scrollIntoView` — **not implemented in jsdom** → `Element.prototype.scrollIntoView = vi.fn()` (or `vi.stubGlobal` per-spec, mirroring the `matchMedia` stub pattern at `DashboardsPage.panel.spec.tsx:40-48`). Consider adding it to `src/test/setup.ts` globally (low-risk, mirrors the getComputedStyle stub there).
- `matchMedia` — already stubbed per-spec in `FilterPanel.spec.tsx:20` and `DashboardsPage.panel.spec.tsx:40`; reduced-motion query needs the same stub returning `{ matches: false }` by default.
- Fake timers for the flash test (`vi.useFakeTimers()` / `vi.runAllTimers()`).

**Visual-only (flag for Phase 110 manual UAT — no human-verify checkpoint in 108):**
- The ring/flash actual appearance in light + dark mode (theme-guard only flags raw `#hex`, misses `color-mix`/wrong tokens — memory: theme-guard-misses-rgba-and-wrong-tokens).
- Smooth-scroll motion + flash pulse timing feel.
- **Recommendation:** do NOT add a human-verify checkpoint to 108; the milestone already has a blocking operator walk-through in Phase 110 (VERIFY-V120-01) that explicitly covers "applies-to + hover/click highlight … including light/dark theme and narrow-viewport visual checks." Note the visual-only items in the plan's verification section so 110 exercises them.

---

### Q8 — Recommended plan split

**2 plans** (matches the granularity of the milestone's other feature phases and isolates the two HIGH risks in the foundation plan):

- **Plan 108-01 — Foundation (store + WidgetCard + hook + CSS):**
  1. `filterHighlightStore.ts` (12th store) + register `reset()` in DashboardsPage cleanup (`DashboardsPage.tsx:562`, after MapViewportSync) AND App.tsx (`App.tsx:148`).
  2. Extract `WidgetCard.tsx` from `DashboardsPage.tsx:1090-1168`; wire scoped boolean selectors, ref, flash effect + timer cleanup, `React.memo`; ref-map registration.
  3. `useReverseFilterMap.ts` + `enumerateVizDescriptors`.
  4. CSS: ring + flash keyframe + reduced-motion.
  5. Tests: re-render isolation, flash timer cleanup, hook enumeration, class-exists, reset-chain.
  - **Gate:** WidgetCard extraction must be byte-behavior-identical when nothing is highlighted (inert hook — the store is empty until a chip is hovered → grid renders identically). This is the backward-compat safety of the extraction.

- **Plan 108-02 — Panel wiring (applies-to + hover/click):**
  1. Extend `FilterChip` panel branch (applies-to line + expander + hover/click props).
  2. Extend `FilterPanel`/`FilterPanelChip` prop threading.
  3. DashboardsPage: call `useReverseFilterMap`, extend group builders (668-726) to attach `appliesTo` + `onHighlight`/`onClearHighlight`/`onActivate`/`onActivateWidget` closures (topmost via `getWidgetLayout`, scroll via ref-map).
  4. Tests: applies-to render, hover/click handlers, top-bar parity, singular/zero copy.

**Waves/deps:** 108-01 → 108-02 (strictly sequential; 02 imports the store, WidgetCard ref-map, and hook from 01). Within 108-01, the store + CSS can land before/parallel to the WidgetCard extraction, but keep them one plan since the WidgetCard tests need the store. **Do NOT parallelize the two plans** — 108-02 depends on every 108-01 export, and both edit `DashboardsPage.tsx` (parallel executors clobbering the same file — memory: parallel-executors-roadmap-collision).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter → widget resolution | A new reverse-map | `computeReverseFilterMap` (Phase 105, `lib/computeReverseFilterMap.ts`) | Pure, tested, handles both read paths + all filter kinds + dv-disabled; reimplementing = drift trap |
| Viz enumeration | Fresh widget/layer walk | Mirror `useCombinationOrchestrator.ts:70-160` (trigger types, layer→owning-widget) + `DashboardsPage.tsx:1094-1106` (`mapTableIds`) + `useFilterScopeSummary` (spatialCapable + dvDisabled) | These already encode every edge case; diverging silently mis-scopes |
| Transient store + reset lifecycle | Ad-hoc useState/context | Mirror `mapViewportSyncStore.ts` + the 12-store reset chains | Store MUST reset on dashboard switch + logout or highlight leaks (HIGH risk) |
| Chip text | `String(value)` | existing `buildChipText` (already used at DashboardsPage:680) | mangles `in`/`between` — not relevant here (chips already built), but do not re-derive |
| Layer display name | New naming scheme | reuse `layerNameFor` recipe (`MapChartRenderer.tsx:768`) | `config.name ?? {schema.name} — {renderMode}`; GAP-54-04 debt lives here |

## Common Pitfalls

### Pitfall 1: Re-render storm on hover (HIGH — research-flagged)
Subscribing a card to the whole `highlightedIds` Set (`s => s.highlightedIds`) returns a new ref each hover → every card + every `WidgetRenderer` (OpenLayers maps!) re-renders. **Avoid:** scoped boolean selector `s => s.highlightedIds.has(w.id)` + `React.memo(WidgetCard)` + stable props. **Test:** render-count spy (Q7).

### Pitfall 2: Dangling flash timers (HIGH — research-flagged)
A `setTimeout` that survives unmount/dashboard-switch fires `setState` on an unmounted card (leak + act warning), or a re-click doesn't restart because the class never toggled off. **Avoid:** clear the prior timer in the effect body + return a cleanup that clears on unmount; force reflow (`void offsetWidth`) on re-fire; store `reset()` clears `flashingIds`. **Test:** fake timers + unmount (Q7).

### Pitfall 3: Reading `layer.config.filter_scope` instead of top-level `layer.filter_scope`
Layer filter scope is a TOP-LEVEL field (`DashboardLayerDto.filter_scope`, client.ts:654; memory: track-config-toplevel-field). Reading it off `config` yields `undefined` → accept-all → every layer wrongly "applies". **Avoid:** `viz.cfg = layer.filter_scope`.

### Pitfall 4: Missing the map read path
Only enumerating chart widgets → hovering a filter never highlights a map card. **Avoid:** enumerate `layers` → owning map widget (Q3). This is the recurring "map WMS is a separate read-path" memory item.

### Pitfall 5: Invented CSS class ships unstyled + green
Every gate passes with a misspelled class; only live UAT catches it. **Avoid:** add all classes to `global.css` in-task + class-exists spec (Q6/Q7). theme-guard only catches `#hex` — use `color-mix`/tokens, verify light/dark in Phase 110.

### Pitfall 6: Touching the top-bar FilterChip variant
Adding applies-to/hover to the shared component's topbar branch breaks parity. **Avoid:** all new logic behind `variant === "panel"`; topbar branch returns first (FilterChip.tsx:27-43), untouched.

### Pitfall 7: Regressing the grid via WidgetCard extraction
Moving `.widget-card` JSX could subtly change render behavior. **Avoid:** verbatim move of inner content; inert hook when store empty → byte-identical when nothing highlighted; keep `key={String(w.id)}` on the element the map returns.

## State of the Art

| Old (ARCHITECTURE.md draft, pre-105) | Current (Phase 105 shipped) | Impact |
|--------------------------------------|-----------------------------|--------|
| `resolveWidgetsForFilter.ts` per-filter helper | `computeReverseFilterMap` (all filters/shapes in one pass, widget-level, layer-annotated) | Hook wraps the shipped fn; no new lib |
| Highlight store holds `Set<"w:*"\|"l:*">` vizKeys | Store holds `Set<number>` widget-card ids (105 already resolves layer→owning widget) | Simpler store; no vizKey parsing in cards |
| Highlight = steady only | Steady (hover ring) + transient (flash) + nonce (re-fire) | Two sets + nonce per locked decision |

## Open Questions

1. **Layer display name sharing (GAP-54-04).**
   - Known: `layerNameFor` (MapChartRenderer:768) and `LayersModal.layerName` (115) duplicate the `config.name ?? {schema.name}—{renderMode}` recipe.
   - Unclear: whether to extract a shared helper now or inline the fallback in the enumerator.
   - Recommendation: inline the minimal fallback in `enumerateVizDescriptors` (108 scope); a full de-dup is separate debt (GAP-54-04), don't expand scope.

2. **Singular/plural copy for "applies to N widgets".**
   - Locked copy is literally "applies to N widgets" (108-CONTEXT specifics). Recommend keeping it literal (even "1 widgets") to match the locked string, OR pluralize as discretion — flag for the planner. Zero case: "applies to 0 widgets", no chevron (locked).

3. **Scroll ownership: ref-map vs store field.**
   - Recommendation: ref-map owned by DashboardsPage (`useRef<Map<number,HTMLDivElement>>`, WidgetCard registers on mount). Keeps the store pure-data. Alternative (store `scrollToId` + self-scroll) works but adds a second nonce; not preferred.

4. **`flashNonce` shared read across all cards.**
   - All cards subscribe to `flashNonce` (integer) → a flash re-runs every card's render fn (cheap no-op when `isFlashing` false). Acceptable (click-rate, not hover-rate). Note for the planner; optimize only if profiling shows a problem.

## Sources

### Primary (HIGH confidence — read directly 2026-07-07)
- `packages/web/src/lib/computeReverseFilterMap.ts` — `VizDescriptor`, `WidgetApplyEntry`, `FilterApplyEntry`, `ShapeApplyEntry`, `computeReverseFilterMap` signature + seeding/dedup/dv-force logic (lines 29-144)
- `packages/web/src/lib/useFilterScopeSummary.ts` — the hook pattern to mirror (version-primitive deps + getState in useMemo, dvFilterScopeDisabled, spatialCapable) lines 90-168
- `packages/web/src/components/DashboardsPage.tsx` — `.widget-card` block (1090-1168), `mapTableIds` (1094-1106), reset chain (504-564, add after 562), panel group builders (668-726), `isPanelMode`/panel render (619, 1353-1370), `getWidgetLayout` (382), `targetsByTable` (601), `layers` from store (450), `resolveProvenance` (69)
- `packages/web/src/components/FilterChip.tsx` (full) + `FilterPanel.tsx` (full) — panel/topbar variants, prop shapes to extend
- `packages/web/src/store/mapViewportSyncStore.ts` (full) — transient-store template + reset-chain lifecycle comment
- `packages/web/src/store/filterStore.ts` / `spatialFilterStore.ts` — `ActiveFilter`/`Shape` types, version counters, reset()
- `packages/web/src/store/dashboardLayersStore.ts` (full) + `api/client.ts:622-657` — `DashboardLayerDto` incl. TOP-LEVEL `filter_scope` (654), `dynamic_view_id` (641)
- `packages/web/src/hooks/useCombinationOrchestrator.ts:70-160` — `NON_TRIGGER_TYPES`/`isTriggerType`, widget+layer enumeration keys
- `packages/web/src/components/charts/MapChartRenderer.tsx:768-775` + `LayersModal.tsx:115-147` — `layerNameFor` recipe
- `packages/web/src/App.tsx:111-148` — UNAUTHORIZED reset chain (add filterHighlightStore.reset() after 148)
- `packages/web/src/test/setup.ts` + `__mocks__/zustand.ts` — reset shim (auto-covers src/store/*.ts), global stubs pattern; jsdom 29.1.1 (no scrollIntoView)
- `packages/web/src/components/DashboardsPage.panel.spec.tsx:40-48, 393-400` — matchMedia stub + class-exists spec precedent
- `packages/web/src/styles/global.css:666 (.widget-card), 2501-2505 (reduced-motion precedent), 3077 (@keyframes precedent)` — where to add classes
- `.planning/research/ARCHITECTURE.md` + `PITFALLS.md` (v1.20) — re-render-storm (Pitfall 5), reverse-map (Pitfall 2), cleanup chains, silent-CSS (Pitfall 6)
- `.planning/config.json` — `nyquist_validation: false` → Validation Architecture section intentionally omitted

## Metadata

**Confidence breakdown:**
| Area | Level | Reason |
|------|-------|--------|
| filterHighlightStore design | HIGH | Directly mirrors shipped `mapViewportSyncStore` + reset shim; scoped-selector pattern proven in useFilterScopeSummary/FilteringBadge |
| WidgetCard extraction | HIGH | Exact source lines identified; inner content moves verbatim; memo+boolean selector is the established S-02 pattern |
| Live hook / enumeration | HIGH | Wraps a tested pure fn; enumeration mirrors 3 existing code sites (orchestrator, mapTableIds, useFilterScopeSummary) |
| Scroll+flash mechanics | MEDIUM-HIGH | scrollIntoView/keyframe/timer patterns standard; exact keyframe/duration is discretion; jsdom scrollIntoView stub required |
| Panel wiring | HIGH | FilterChip/FilterPanel prop shapes read directly; join-by-reference-identity confirmed against 105 seeding |
| CSS | MEDIUM | Class list concrete + token-only; actual light/dark appearance is visual-only (Phase 110 UAT), theme-guard blind to color-mix |
| Test strategy | HIGH | Precedents exist for every test type (fake timers, matchMedia stub, class-exists, store seeding) |

**Research date:** 2026-07-07
**Valid until:** ~2026-08-07 (stable internal codebase; no external deps)

## RESEARCH COMPLETE

**Phase:** 108 - Applies-To List + On-Canvas Highlight
**Confidence:** HIGH

### Key Findings
- All heavy lifting is done: Phase 105 `computeReverseFilterMap` (widget-level, layer-annotated, both read paths) + Phase 107 panel are shipped; 108 = a transient store + a thin hook + a card extraction + panel wiring + CSS.
- `filterHighlightStore` = `{highlightedIds:Set<number>, flashingIds:Set<number>, flashNonce, setHighlighted, clearHighlighted, flash, reset}`; store holds widget-CARD ids (105 already maps layer→owning widget). 12th store in BOTH reset chains.
- The two HIGH risks (re-render storm, dangling flash timers) are both contained in the foundation plan and covered by a render-count spy test + a fake-timer unmount test.
- Enumeration mirrors 3 existing sites; read `layer.filter_scope` TOP-LEVEL (not `.config`); enumerate map layers → owning widget or the map read path is missed.
- Join panel chips → applies-to by reference identity (105 seeds entries keyed by the same filter/shape objects the panel iterates).

### File Created
`.planning/phases/108-applies-to-list-on-canvas-highlight/108-RESEARCH.md`

### Ready for Planning
Recommended split: 108-01 (store + WidgetCard + hook + CSS, sequential, owns both HIGH risks) → 108-02 (panel applies-to + hover/click wiring). Do NOT parallelize — both edit DashboardsPage.tsx and 02 imports every 01 export.
