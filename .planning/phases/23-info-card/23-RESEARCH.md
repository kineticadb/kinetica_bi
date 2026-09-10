# Phase 23: info-card - Research

**Researched:** 2026-05-09
**Domain:** React widget chart-type registration + shared-component extraction (popup/card sibling refactor)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Card identity & registry shape**
- Chart type identifier: `info-card` (kebab-case, matches existing `records`, `bignumber`, `line` etc.)
- Label: `Info Card` (title-cased for the picker)
- Icon: short token (Claude's discretion — recommend `IC` to match existing conventions like `B`, `L`, `M`, `R`)
- `usesAggregation: false` — no SQL aggregation path. Mirrors `map` and `records` precedent
- `supportsDrillDown: false` — Phase 21 lock; info-popup interactions are orthogonal to the filter pipeline. Row clicks in the card body do NOT dispatch to `useFilterStore`
- `defaultConfig: {}` — empty object. No `title`, no fields. Card renders entirely from `useInfoSelectionStore` + `useDashboardLayersStore`
- `fields: []` — empty array. Generic field renderer has nothing to show. ChartConfigPanel's per-type config area renders an info note: "No configuration — Info Card mirrors the map info popup" (or equivalent placeholder; planner to decide exact copy)
- `CustomConfigPanel` undefined — no per-type panel needed
- Registration: new file `kinetica_bi/src/components/charts/definitions/info-card.ts` exporting a default `register()` function; imported and called from `definitions/index.ts` alongside the 8 existing types

**Layer subscription contract & dropdown source**
- The card has an in-widget layer dropdown (NOT in a config panel). Same UI affordance as the popup — sticky header band at top of card body
- Dropdown source: `useDashboardLayersStore.layers.filter(l => l.info_enabled === 1 && deriveSpatialMode(l) !== "wkb")`. Dashboard-scoped — independent of which map widget owns each layer or whether any map currently has the layer visible
- The card and popup share `useInfoSelectionStore` state. Switching the dropdown in EITHER surface fires the same store mutations (`setActiveLayer` → wipe prior layer's entry, then `setLoading` → `setSelection` → `setLoading(false)`). The OTHER surface (popup if open while card is being switched, or card while popup is being switched) re-renders to reflect the new active layer
- When `state[newLayerId]` is undefined, dropdown-switch fires `POST /api/info/query` for that layer using the SAME spatial-context payload that the originating click used. The card's dropdown-switch CANNOT make up new spatial coordinates — it must reuse the last click's
- When the active layer's entry in the store is wiped (e.g., user dismisses the popup, store `reset()` fires) and the card is rendered, `activeLayerId` becomes null → card shows empty state until the next map click
- When the configured-via-dropdown layer becomes ineligible mid-session: the existing Phase 21 `useEffect` that watches eligibility set fires `reset()` → card empties to default copy. Card extends this effect to use the NEW dashboard-scoped eligibility set (info_enabled + non-WKB across all dashboard layers, no map-widget visibility constraint)

**Pure-consumer lock — RELAXED**
- Pre-Phase 23 lock (PROJECT.md / STATE.md): "Info Card reads from `useInfoSelectionStore` only — it must never call `POST /api/info/query` directly. Only the map click handler in `MapChartRenderer` feeds the store."
- Phase 23 relaxation: "Both popup and card mount `<InfoSelectionView />`, which calls `POST /api/info/query` on dropdown-switch (when `state[newLayerId]` is undefined) and on Load more. The map click handler in `MapChartRenderer` remains the SOLE entry point for the initial multi-layer fan-out; popup-and-card dropdown-switches are SINGLE-layer on-demand fetches reusing the last click's spatial coords. Other widget types (bar/line/pie/scatter/table/records/bignumber/map) still cannot fetch info-queries — only the popup and card can."
- Phase 23 plans MUST update PROJECT.md and STATE.md to reflect the relaxation. REQUIREMENTS.md CARD-V14-02 is reinterpreted as "an in-widget layer dropdown" (not a widget config panel dropdown). Update CARD-V14-02 wording accordingly
- Existing `infoQuery(...)` POST helper at `kinetica_bi/src/api/client.ts` is already importable; no new endpoint or helper needed

**Records display, scroll, and chrome**
- Card body uses internal scroll. Records area fills available widget cell space. Author resizes via `react-grid-layout` cell handles to taste
- Sticky dropdown header band at the top of the card body (mirrors popup's sticky header semantics minus the close X)
- Sticky Load-more footer at the bottom of the card body when `state[activeLayerId].hasMore === true`; hidden when `hasMore === false`
- Records list scrolls between header and footer
- Card uses the standard dashboard widget chrome (drag handle, delete button, etc. — same as bar/line/pie/scatter/table/records/bignumber/map widgets). The widget chrome wraps the card body; the dropdown header is internal to the card body, NOT part of the widget chrome
- No close X (card is a permanent dashboard widget, dismissed via the standard widget delete button on widget chrome)
- No CSS triangle tail (no click-anchor; card is grid-positioned, not coordinate-anchored)
- No ESC dismiss handler (closing the card is a dashboard-edit operation, not a per-session interaction)

**Empty / mismatch states — single neutral copy**
- Single empty-state copy: `Click a point on the map to see details` (ROADMAP.md verbatim — Success Criterion 4)
- Renders when ANY of:
  - `activeLayerId === null` (initial load, before any click; or after `reset()` from popup dismiss / dashboard switch / logout)
  - `activeLayerId` is non-null but `state[activeLayerId]` is undefined (defensive)
  - `state[activeLayerId].rows.length === 0`
  - The layer pointed to by `activeLayerId` is no longer in the dashboard or has been disabled
- No warning state; no "configuration error" copy; no per-card error chrome

**Visual style — shared `.info-selection-*` namespace**
- Phase 21's `.info-popup-*` CSS classes are renamed to neutral `.info-selection-*`. The popup component continues to wrap content with the popup-specific classes (e.g., `.info-popup-anchored`, `.info-popup-tail`, `.info-popup-overlay`) for chrome that doesn't apply to the card
- Both popup and card render the body via the same `<InfoSelectionView />` component, which uses `.info-selection-*` for the dropdown header band, records list, KV table rows, template-mode container, Load-more button, error/loading micro-states
- The card's outer wrapper uses standard widget shell CSS; the popup's outer wrapper continues to use `.info-popup-*` for anchored-tail / close-X / overlay-onClick chrome
- One-shot rename — gradual rename via class-name aliasing is more churn for no benefit; rename atomically in Phase 23 P01

**Code-share with Phase 21 — shared `<InfoSelectionView />`**
- Phase 23 IS authorized to refactor Phase 21's `InfoPopup.tsx` to extract `<InfoSelectionView />`. The extraction is the design north star, not an optional optimization
- Proposed split:
  - `<InfoSelectionView />` (new) — receives `eligibleLayers: DashboardLayerDto[]` + spatial-context-replay info as props; reads `useInfoSelectionStore` directly. Renders dropdown header + records list + Load more. Owns the dropdown-switch fetch and Load-more fetch logic
  - `<InfoPopup />` (refactored) — wraps `<InfoSelectionView />` with `ol/Overlay` anchor + close X + ESC + click-outside-overlay + tail. Receives `dashboardLayers` and `widgetConfig` from `MapChartRenderer`; computes the eligible layers list (visible + enabled + non-WKB scoped to the popup's owning map widget); passes eligibility list to `<InfoSelectionView />`
  - `<InfoCardRenderer />` (new) — wraps `<InfoSelectionView />` with widget chrome only (no anchor, no close X, no ESC). Reads `useDashboardLayersStore` to compute the dashboard-scoped eligibility list (info_enabled + non-WKB, no visibility constraint). Passes eligibility list to `<InfoSelectionView />`
- Locked constraint: no map-widget reference inside `<InfoSelectionView />` (would couple it to OL).

### Claude's Discretion

- Exact file location of `<InfoSelectionView />` (recommend `kinetica_bi/src/components/charts/InfoSelectionView.tsx`)
- Exact icon string for `info-card` definition (recommend `IC`)
- Exact ChartConfigPanel placeholder copy when type=info-card has no fields
- Whether `<InfoCardRenderer />` lives in a new file or as a thin wrapper inside `WidgetRenderer.tsx`
- Exact prop shape for `<InfoSelectionView />` (eligibility list as `DashboardLayerDto[]` vs a simplified projection; spatial-context-replay as a single object vs flattened props)
- Exact CSS rename diff (file count, selector-by-selector list, test file impact)
- Exact sticky-header CSS for card dropdown band
- Exact ARIA labels for the dropdown
- Whether the empty-state container uses `.widget-placeholder` or `.info-selection-empty`
- Exact PROJECT.md / STATE.md update wording for the relaxed pure-consumer lock
- Exact REQUIREMENTS.md update wording for CARD-V14-02
- Whether to update REQUIREMENTS.md inline as part of the Phase 23 plan or as a docs-only commit before plan execution

### Deferred Ideas (OUT OF SCOPE)

- Per-card title field (out for v1.4)
- Per-card layer-eligibility filter (cards mirror dashboard scope)
- Multiple cards rendering different selections concurrently (single dashboard-global `activeLayerId` invariant from Phase 20)
- Drill-down on row click in card body (`supportsDrillDown: false` enforced)
- Custom empty-state copy per card
- Hover-preview integration on card (HOVER-V2-01 deferred)
- URL/localStorage persistence (PERSIST-V2-01/02 deferred)
- Per-widget kill-switch on card (n/a; card has no map widget binding)
- Pre-populated dropdown selection on card mount
- Card-card synchronization across multiple cards on same dashboard
- Drag-handle reorder of layer dropdown items
- CodeMirror or any editor on card (read-only display)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (current REQUIREMENTS.md) | Research Support |
|----|---------------------------------------|------------------|
| CARD-V14-01 | System registers a new `info-card` chart type in the chart-type registry alongside the existing 8 types; selectable from the chart type picker. | Registry `registerChartType()` + new `definitions/info-card.ts` + extend `registerAllChartTypes()` in `definitions/index.ts`. Pattern matches `records.ts` (no `CustomConfigPanel`) and `map.ts` (`usesAggregation: false`). |
| CARD-V14-02 | The Info Card widget renders records from `useInfoSelectionStore` for a configured layer; a dropdown allows the user to select which dashboard layer's info selection to display. | **Reword required** to "an in-widget layer dropdown" per CONTEXT relaxation. `<InfoSelectionView />` owns the dropdown. Card supplies `eligibleLayers` from `useDashboardLayersStore` filtered by `info_enabled === 1 && spatialMode !== 'wkb'`. |
| CARD-V14-03 | The Info Card renders records using the layer's `info_template` HTML when configured; falls back to plain key-value table; matches POPUP-V14-04 path. | Identical render path via `renderInfoTemplate` helper (`kinetica_bi/src/lib/renderInfoTemplate.ts`) executed inside `<InfoSelectionView />`. Cross-phase alphabetical column sort (Phase 22) moves into `<InfoSelectionView />` so both surfaces inherit it once. |
| CARD-V14-04 | When no info selection exists for the configured layer, displays neutral empty state ("Click a point on the map to see details") rather than blank panel or error. | Empty-state branch inside `<InfoSelectionView />` covers `activeLayerId === null`, `state[activeLayerId]` missing, `rows.length === 0`, and layer-leaves-eligibility (existing Phase 21 effect). Single neutral copy. |
</phase_requirements>

## Summary

Phase 23 is a **structural refactor + new chart type**, not a greenfield build. The card is locked as "popup mirrored in a widget" — same body, same store, same fetch helper, same render helper. The only material delta is **how the card supplies spatial context to the on-demand single-layer fetch when there is no map ref available**.

The codebase already has all the wiring needed:
- `useInfoSelectionStore` (Phase 20) — unchanged contract, both popup and card subscribe
- `infoQuery(...)` (Phase 21, `kinetica_bi/src/api/client.ts:686-700`) — POST helper
- `renderInfoTemplate` (Phase 21, pure helper) — render path consumed via shared view
- `useDashboardLayersStore` (Phase 12) — eligibility source
- Chart-type registry pattern (Phase 11/12) — `registerChartType(def)` + `definitions/<type>.ts`
- `WidgetRenderer.tsx:206-211` early-return precedent for non-SQL widget types

The work splits into four discrete units of refactor + addition:

1. **Extract `<InfoSelectionView />`** from `InfoPopup.tsx`. The popup keeps anchored chrome; the new view owns the dropdown band + records list + Load-more + dropdown-switch fetch + Load-more fetch. The cross-phase alphabetical column sort (currently in `InfoPopup.tsx:128`) moves into the view.
2. **Capture last-click spatial context** via a sibling Zustand slice (`useLastInfoClickContextStore`) populated by `MapChartRenderer.tsx`'s click handler. Both popup and card read it for replay. (Strategy B in CONTEXT — see R1 below for the full evaluation.)
3. **Register `info-card`** chart type and create `<InfoCardRenderer />` that wraps `<InfoSelectionView />` with widget chrome and dashboard-scoped eligibility derivation.
4. **Rename `.info-popup-*` body classes to `.info-selection-*`**; popup-only chrome classes stay. Two TSX files + one CSS file + four spec files touch.

**Primary recommendation:** Use **Strategy B (sibling `useLastInfoClickContextStore` slice)** for spatial-context replay. It's the lowest-risk, lowest-coupling option, keeps Phase 20's locked store shape pristine, and matches the established multi-store pattern in this codebase (filterStore + filterViewStore + infoSelectionStore are already three siblings).

## User Constraints

(See `<user_constraints>` block above — copied verbatim from CONTEXT.md.)

## Standard Stack

### Core (already installed; no new deps)

| Library | Version (verified) | Purpose | Why Standard |
|---------|-------------------|---------|--------------|
| react | 18.x (existing) | UI rendering | Existing app foundation |
| zustand | 4.x (existing) | Sibling state slice for last-click context | Already used for `useFilterStore`, `useFilterViewStore`, `useInfoSelectionStore`, `useDashboardLayersStore`, `useToastStore` — this codebase's locked state primitive |
| typescript | 5.x (existing) | Type safety on the spatial-context-replay payload | Already enforced via `tsc --noEmit` |
| vitest + @testing-library/react | existing | Spec coverage for view + card + register | Existing test infra; Zustand reset shim covers the new slice automatically (any `src/store/*.ts` is auto-reset between tests) |

### Supporting (existing modules consumed)

| Module | Path | Used For |
|--------|------|----------|
| `useInfoSelectionStore` | `kinetica_bi/src/store/infoSelectionStore.ts` | Card subscription via scoped selectors (same pattern as popup) |
| `useDashboardLayersStore` | `kinetica_bi/src/store/dashboardLayersStore.ts` | Card eligibility filter source (`s.layers`) |
| `infoQuery` | `kinetica_bi/src/api/client.ts:686-700` | POST `/api/info/query` for dropdown-switch + Load-more |
| `renderInfoTemplate` | `kinetica_bi/src/lib/renderInfoTemplate.ts` | Per-row HTML template substitution / KV pair derivation |
| `registerChartType` / `ChartTypeDefinition` | `kinetica_bi/src/components/charts/registry.ts` | New `info-card` definition |
| `WidgetRenderer` early-return | `kinetica_bi/src/components/charts/WidgetRenderer.tsx:202-213` | Insertion point for `info-card` branch |

### Alternatives Considered

| Instead of | Could Use | Why we don't |
|------------|-----------|--------------|
| Sibling Zustand slice for last-click context (Strategy B) | Add `lastClickContext` field to `useInfoSelectionStore` (Strategy A) | Phase 20 store shape was deliberately locked at roadmap creation; modifying it for a Phase 23 affordance breaks the "store-before-popup ordering" invariant in STATE.md |
| Sibling Zustand slice for last-click context (Strategy B) | Look up "primary" map widget's mapRef (Strategy C) | Tightly couples card to map widgets; "card is dashboard-scoped" framing breaks; cross-component-tree ref access is an anti-pattern in this codebase (no precedent) |
| `<InfoSelectionView />` as a new file | Inline body inside `InfoPopup.tsx` and re-export pieces | Card needs the same body without popup chrome; inlining defeats reuse and violates the design north star |
| Rename CSS atomically in P01 | Class-name aliasing (`.info-selection-* { @extend .info-popup-* }`) | One-shot rename is locked in CONTEXT § Visual style. Aliasing has zero technical merit during mid-flight v1.4. |

**No new packages. No installation step.** Bundle delta is ~0 (one new component file ~120 lines, one new store slice ~40 lines, one new definition file ~25 lines, one new card-renderer wrapper ~80 lines).

## Architecture Patterns

### Recommended File Structure (additions/changes)

```
kinetica_bi/src/
├── components/charts/
│   ├── InfoSelectionView.tsx        # NEW — shared body (dropdown + records + Load more + fetch)
│   ├── InfoSelectionView.spec.tsx   # NEW — body behavior tests (split from InfoPopup.spec.tsx)
│   ├── InfoPopup.tsx                # REFACTOR — slim to anchored-tail / close X / ESC chrome
│   ├── InfoPopup.spec.tsx           # SLIM — popup-only chrome cases
│   ├── InfoCardRenderer.tsx         # NEW — widget-chrome wrapper around <InfoSelectionView />
│   ├── InfoCardRenderer.spec.tsx    # NEW — card-only cases (registry, dashboard-scope, no chrome)
│   ├── WidgetRenderer.tsx           # EXTEND — early-return for widget.type === "info-card"
│   ├── definitions/
│   │   ├── info-card.ts             # NEW — chart-type definition + register()
│   │   └── index.ts                 # EXTEND — call registerInfoCard() in registerAllChartTypes()
│   └── MapChartRenderer.tsx         # EXTEND — write to useLastInfoClickContextStore on click
├── store/
│   ├── lastInfoClickContextStore.ts # NEW — sibling slice for spatial-context replay
│   └── lastInfoClickContextStore.spec.ts  # NEW
├── styles/global.css                # REFACTOR — rename .info-popup-* body classes; keep popup chrome
└── api/client.ts                    # UNCHANGED — infoQuery already exists
```

### Pattern 1: Shared body component with chrome wrappers (popup + card siblings)

**What:** Extract presentation primitives common to multiple surfaces into a single component that owns its store subscription and emits no callbacks for the shared portion. Each surface wraps the shared component with its own chrome (anchored vs widget grid).

**When to use:** Two surfaces that must render the SAME data the same way but in different containers. The wrappers handle dismiss / mount / lifecycle differently; the body is identical.

**Example (this phase, locked design):**
```tsx
// InfoSelectionView.tsx — shared body. NO chrome decisions here.
type Props = {
  eligibleLayers: DashboardLayerDto[];                    // computed by caller (popup vs card)
  layerNameFor: (l: DashboardLayerDto) => string;         // resolver
  /** Caller passes spatial-context-replay so on-demand fetch works in both surfaces */
  spatialContext: { clickLon: number; clickLat: number; mapBbox: [number, number, number, number]; mapWidthPx: number; mapHeightPx: number; radiusPx: number } | null;
  /** Caller resolves table_id → { schema, name } (mostly the same impl in both wrappers) */
  resolveTable: (tableId: number) => { schema: string; name: string } | null;
};

export default function InfoSelectionView({ eligibleLayers, layerNameFor, spatialContext, resolveTable }: Props) {
  const activeLayerId = useInfoSelectionStore(s => s.activeLayerId);
  const entry = useInfoSelectionStore(s => s.activeLayerId !== null ? s.state[s.activeLayerId] : null);
  // ...dropdown render, KV/template rows, Load more, on-demand fetch on dropdown switch, Load-more fetch
}
```
```tsx
// InfoPopup.tsx — popup chrome only.
return (
  <div className="info-popup-backdrop" onClick={onCloseFromOverlayClick}>
    <div className="info-popup info-popup-anchored info-popup-tail" onClick={(e) => e.stopPropagation()}>
      <button className="info-popup-close" aria-label="Close" onClick={onClose}>×</button>
      <InfoSelectionView eligibleLayers={...} layerNameFor={...} spatialContext={...} resolveTable={...} />
    </div>
  </div>
);
```
```tsx
// InfoCardRenderer.tsx — card chrome only.
return (
  <div className="widget-info-card">
    <InfoSelectionView eligibleLayers={...} layerNameFor={...} spatialContext={...} resolveTable={...} />
  </div>
);
```

**Source/precedent:** This is the natural extraction of `kinetica_bi/src/components/charts/InfoPopup.tsx` lines 86-176 (header + body + footer JSX, plus dropdown / Load-more handlers from `MapChartRenderer.tsx:537-673`). No external precedent needed; locked by CONTEXT.md.

### Pattern 2: Sibling Zustand slice for cross-component derived state

**What:** When two components need to share derived state that doesn't belong in either component's natural store, add a small dedicated Zustand slice with its own reset path.

**When to use:** State that's (a) read by multiple components, (b) doesn't fit the existing locked store shapes, (c) needs to survive across the writer's lifecycle (the writer may unmount but the readers still need the value).

**Example (this phase):**
```ts
// kinetica_bi/src/store/lastInfoClickContextStore.ts
import { create } from "zustand";

export type LastInfoClickContext = {
  clickLon: number;          // EPSG:4326
  clickLat: number;          // EPSG:4326
  mapBbox: [number, number, number, number];  // EPSG:3857 [minX, minY, maxX, maxY]
  mapWidthPx: number;
  mapHeightPx: number;
  radiusPx: number;          // resolved from MapChartRenderer's owning widget config
  /** Source widget id — informational; cards don't filter by it (dashboard-scoped) */
  sourceWidgetId: number;
};

type State = {
  context: LastInfoClickContext | null;
  setContext: (ctx: LastInfoClickContext) => void;
  reset: () => void;
};

export const useLastInfoClickContextStore = create<State>((set) => ({
  context: null,
  setContext: (ctx) => set({ context: ctx }),
  reset: () => set({ context: null }),
}));
```

**Source/precedent:** Mirrors `useFilterViewStore` (`kinetica_bi/src/store/filterViewStore.ts`) and `useToastStore` (`kinetica_bi/src/store/toast.ts`) sibling-slice pattern. Both ship as standalone slices, both auto-reset via the test shim in `kinetica_bi/__mocks__/zustand.ts`.

### Pattern 3: Chart-type registration via barrel + register() function

**What:** Each chart type lives in `definitions/<type>.ts` exporting a default `register()` function that calls `registerChartType(def)`. The barrel `definitions/index.ts` imports each register and calls them in `registerAllChartTypes()`.

**Source:** `kinetica_bi/src/components/charts/definitions/index.ts:10-30`. 9 existing types follow this pattern.

**Example for `info-card`:**
```ts
// kinetica_bi/src/components/charts/definitions/info-card.ts
import { registerChartType, type ChartTypeDefinition } from "../registry";

const infoCard: ChartTypeDefinition = {
  type: "info-card",
  label: "Info Card",
  icon: "IC",
  fields: [],
  defaultConfig: {},
  usesAggregation: false,
  supportsDrillDown: false,
};

export default function register() {
  registerChartType(infoCard);
}
```

```ts
// kinetica_bi/src/components/charts/definitions/index.ts (extend)
import registerInfoCard from "./info-card";
// ...
export function registerAllChartTypes() {
  // ...existing 9 calls
  registerInfoCard();
}
```

### Pattern 4: WidgetRenderer early-return for non-SQL widget types

**What:** Widgets that don't run aggregated SQL short-circuit before `AggregatedWidgetRenderer`. The early-returns at `WidgetRenderer.tsx:202-213` are the single insertion point.

**Source:** `kinetica_bi/src/components/charts/WidgetRenderer.tsx:202-213`:
```tsx
const WidgetRenderer = ({ widget, tables = [] }: WidgetRendererProps) => {
  if (widget.type === "map") {
    return <MapChartRenderer widget={widget} tables={tables} />;
  }
  if (widget.type === "records") {
    return <RecordsTableRenderer widget={widget} />;
  }
  return <AggregatedWidgetRenderer widget={widget} />;
};
```

**Example for Phase 23 (insert as third short-circuit):**
```tsx
const WidgetRenderer = ({ widget, tables = [] }: WidgetRendererProps) => {
  if (widget.type === "map") {
    return <MapChartRenderer widget={widget} tables={tables} />;
  }
  if (widget.type === "records") {
    return <RecordsTableRenderer widget={widget} />;
  }
  if (widget.type === "info-card") {
    return <InfoCardRenderer widget={widget} tables={tables} />;
  }
  return <AggregatedWidgetRenderer widget={widget} />;
};
```

The card needs `tables` for the same reason `MapChartRenderer` does — to resolve `layer.table_id → { schema, name }` for the `infoQuery` payload. Pass-through is one prop; no widget-config-derived props are needed (card has no widget config beyond `{}`).

### Anti-Patterns to Avoid

- **DO NOT subscribe to `useInfoSelectionStore.state` (whole map) in the card.** Scope to `state[activeLayerId]` and `activeLayerId` separately — Phase 20 PITFALL S-02 carry-forward. Already enforced in the popup at `InfoPopup.tsx:45-49`.
- **DO NOT compute eligibility inside `<InfoSelectionView />`.** It's intentionally agnostic to "what's eligible" — caller (popup or card wrapper) computes the list with its scoping rule.
- **DO NOT pass `mapRef` or any OL handle into `<InfoSelectionView />`.** It's the locked constraint in CONTEXT § Code-share — the view stays decoupled from OpenLayers.
- **DO NOT add a `CustomConfigPanel` or any fields to the `info-card` definition.** Locked: `defaultConfig: {}`, `fields: []`, no panel.
- **DO NOT add HTML sanitization in the card.** Locked PROJECT.md no-sanitize. The shared `<InfoSelectionView />` uses `dangerouslySetInnerHTML` exactly once, citing the lock inline.
- **DO NOT initiate a fetch on card mount.** Card waits for `activeLayerId` to be non-null. Locked: "It will show nothing when nothing is clicked on the map."
- **DO NOT reset the card's eligibility on map widget visibility changes.** Card is dashboard-scoped, not map-scoped. The popup's existing layer-leaves-eligibility effect uses the popup's map-scoped set; the card uses the dashboard-scoped set. They are separate predicates passed into the shared view.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-row template substitution | Custom regex / string-format helper | `renderInfoTemplate` from `kinetica_bi/src/lib/renderInfoTemplate.ts` | Already pure, already specced, already used by popup; co-renders with `info_columns` lenient-parse contract |
| POST `/api/info/query` | Custom `fetch` call inside the card | `infoQuery` from `kinetica_bi/src/api/client.ts:686-700` | Mirrors `materializeFilter` POST pattern; threads AbortSignal; handles 401/403/502 via `apiFetch + throwForStatus` |
| Global state for last-click context | React Context provider mounted at dashboard root | A dedicated Zustand slice (`useLastInfoClickContextStore`) | Context would re-render every consumer on every click; Zustand selector scoping is the codebase's locked pattern. Also Context can't be read imperatively from `MapChartRenderer.tsx`'s click handler without a hook hop |
| Chart-type-picker UI integration | New picker component for "Info Card" | The existing chart-type registry — adding a new entry registers it everywhere automatically | `getAllChartTypes()` is the picker's source; Phase 11/12 established this; zero picker UI work needed |
| Cross-component dropdown sync between popup and card | Imperative event bus | Shared `useInfoSelectionStore` subscription (already there) | Both surfaces subscribe to `activeLayerId` and `state[activeLayerId]`; switching either one mutates the store and the other re-renders. Single source of truth, zero new wiring |
| Empty-state copy-management | A copy-config table | Hard-coded literal `Click a point on the map to see details` | ROADMAP.md Success Criterion 4 verbatim; locked single neutral copy across all empty/missing/error variants |

**Key insight:** Phase 23 is mostly **wiring existing primitives**, not building new ones. The temptation to introduce a "chrome-agnostic widget shell" abstraction or a "spatial context provider" is a trap — both add coupling that the locked design specifically avoids.

## Common Pitfalls

### Pitfall 1: Stale spatial context after dashboard switch

**What goes wrong:** User clicks the map in dashboard A, `useLastInfoClickContextStore.context` is set. They switch to dashboard B (which has a card but no map widget yet). They open the card's dropdown — the card finds `state[layerId] === undefined` and tries to fetch. It uses the stale dashboard-A click coords, producing nonsense results.

**Why it happens:** Dashboard switch resets `useInfoSelectionStore`, `useFilterStore`, `useFilterViewStore` (Phase 20-02 wired three-store reset). If `useLastInfoClickContextStore` is not added to the same reset block, its state survives the switch.

**How to avoid:** Wire `useLastInfoClickContextStore.reset()` into the SAME two reset sites as `useInfoSelectionStore`:
- `kinetica_bi/src/App.tsx` UNAUTHORIZED handler (alongside the existing three-store reset).
- `kinetica_bi/src/components/DashboardsPage.tsx` `DashboardOpen` cleanup (alongside the existing three-store reset).

This becomes a "four-store reset block." Mirrors Phase 20-02 pattern exactly.

**Warning signs:** Card displays the wrong layer's records on first dropdown-switch after dashboard switch; or `infoQuery` fires with click coords from outside the current dashboard's data extent.

### Pitfall 2: Card's on-demand fetch fires when no click has ever happened

**What goes wrong:** User opens dashboard, the card mounts, `activeLayerId === null`, card shows empty state. User opens the card's dropdown and selects a layer. `<InfoSelectionView />`'s `handleLayerSwitch` runs — but `useLastInfoClickContextStore.context === null` because no click has happened yet. Fetch fires with garbage coords (or worse, throws).

**Why it happens:** Without an explicit guard, the dropdown-switch handler can't distinguish "user wants to switch to a previously-fetched layer" from "user wants to fetch a new layer's data" — it always fetches when `state[newLayerId] === undefined`.

**How to avoid:** Inside `<InfoSelectionView />`, the on-demand fetch path MUST short-circuit when `spatialContext === null`. Behavior: call `setActiveLayer(newId)` (lightweight, just updates focus), but skip the `setLoading(true) → infoQuery → setSelection` sequence. The card body then renders the empty state for that layer — same neutral copy "Click a point on the map to see details."

**Warning signs:** "Failed to fetch info records" toast on first dropdown switch with no prior click; or backend 400 from invalid coords.

### Pitfall 3: Forgetting to extend the layer-leaves-eligibility effect for dashboard scope

**What goes wrong:** Phase 21's `InfoPopup.tsx:67-75` watches `[activeLayerId, eligibleLayers]` (popup-owning-map-scoped) and calls `onClose()` when the active layer falls out. If this effect is moved verbatim into `<InfoSelectionView />`, the card's eligibility set (dashboard-scoped — broader) would still pass through correctly... BUT the popup's eligibility set (map-scoped — narrower) needs the popup's check, AND the card's check is different.

**Why it happens:** Both surfaces feed `eligibleLayers` to `<InfoSelectionView />`, but the SHRINK predicates differ:
- Popup wants: dismiss when active layer leaves the popup's map-widget visible-set.
- Card wants: empty out when active layer leaves the dashboard-scoped set.

If the effect lives in the shared view, it operates on whichever `eligibleLayers` the wrapper passed — which is correct AS LONG AS the wrapper computes the right set. So the effect can stay in the shared view. The trap is forgetting to verify the predicate semantics match for both wrappers.

**How to avoid:** The shared view's auto-eligibility-leave effect calls a callback prop (e.g., `onActiveLayerIneligible: () => void`). Popup wraps it as `onClose` (which calls `reset()`); card wraps it as a no-op (`reset()` already happens via store mutations elsewhere; for the card the natural effect is `activeLayerId` becomes null and the body renders the empty state). **Recommended:** the shared view always calls `useInfoSelectionStore.getState().reset()` directly when active layer leaves the eligible set — this is the popup's current semantic AND it produces the card's empty state (`activeLayerId === null` triggers the neutral copy). One behavior, two surfaces, no callback divergence.

**Warning signs:** Card body shows stale records for a layer that's been disabled in another tab; or card body never empties out after `info_enabled` is flipped to 0.

### Pitfall 4: Cross-phase column sort drift

**What goes wrong:** Phase 22 locked the cross-phase rule "caller sorts columns alphabetically before calling `renderInfoTemplate`." The current implementation lives at `InfoPopup.tsx:128`:
```tsx
const sortedColumns = [...entry.columns].sort((a, b) => a.localeCompare(b));
const result = renderInfoTemplate({ template: ..., columns: sortedColumns, row, infoColumns: ... });
```
After extraction to `<InfoSelectionView />`, if the sort is left in `InfoPopup.tsx` (ahead of where `<InfoSelectionView />` is rendered), the card's body would render KV columns in the original (server-emitted) order — diverging from the popup.

**Why it happens:** The temptation is to keep "what the popup did" intact during refactor. But the sort is BODY logic, not chrome logic.

**How to avoid:** **Move the sort INTO `<InfoSelectionView />`** at the same point in the JSX (before each row's `renderInfoTemplate` call). The popup wrapper drops it. Phase 22 SUMMARY explicitly flags this: "The alphabetical sort logic established in `InfoPopup.tsx` will need to be replicated or shared in the Info Card renderer so both surfaces render KV columns in the same order." Moving it into the shared view is the cleanest answer.

**Warning signs:** Spec assertions for column order in the popup pass but in the card fail (or vice versa); KV-mode column ordering differs between popup and card visually during UAT.

### Pitfall 5: Whole-store subscription in card

**What goes wrong:** Tempting first-pass card implementation:
```tsx
const store = useInfoSelectionStore();   // ← whole-state subscription
return store.activeLayerId === null ? <Empty /> : <Body />;
```
This re-renders the card on EVERY mutation to `useInfoSelectionStore`, including unrelated layers' loading/error transitions, mutations from another popup elsewhere, etc.

**Why it happens:** Phase 20 PITFALL S-02 — already locked, already documented in the existing popup at `InfoPopup.tsx:45-49` and the Phase 20 store header comment lines 17-19.

**How to avoid:** Always use scoped selectors in the shared view AND in the card wrapper (if the wrapper subscribes at all):
```tsx
const activeLayerId = useInfoSelectionStore(s => s.activeLayerId);
const entry = useInfoSelectionStore(s => s.activeLayerId !== null ? s.state[s.activeLayerId] : null);
```

**Warning signs:** Card flickers / re-renders during popup interactions; React DevTools shows excessive re-renders; spec test "S1 (PITFALL S-02 regression)" fails.

### Pitfall 6: AbortController not threaded into the card's fetch path

**What goes wrong:** Card mounts on dashboard A, user clicks dropdown, fetch starts. User switches to dashboard B before fetch settles — the card unmounts. The unsettled fetch returns and writes into `useInfoSelectionStore` for the now-defunct dashboard's state. Or worse, the user remounts the card on dashboard A again before the original fetch finishes — race.

**Why it happens:** The popup's existing `infoQueryAbortRef` (Phase 21, `MapChartRenderer.tsx:250`) is a `useRef` per-renderer-instance. The card needs the same pattern.

**How to avoid:** `<InfoSelectionView />` owns its own `useRef<AbortController | null>(null)` and threads `controller.signal` into every `infoQuery` call. On any cleanup path (dropdown switch, Load more, unmount), abort prior controller. Mirrors v1.3 `materializeAbortRef` (V13-P-10 lock) and Phase 21 `infoQueryAbortRef`.

**Warning signs:** Stale state writes after dashboard switch; spec test asserting AbortError is silenced (P11/P12 patterns from `MapChartRenderer.spec.tsx`) fails.

### Pitfall 7: Picker UI shows "Info Card" but creates a widget that AggregatedWidgetRenderer tries to render

**What goes wrong:** New definition is registered, picker shows it, user creates a widget — but `WidgetRenderer.tsx` doesn't have an early-return for `info-card`, so `AggregatedWidgetRenderer` runs. It tries to read `widget.config.sql` (undefined for info-card), short-circuits to `<div className="widget-placeholder"><span>Select a table and configure metrics to load data</span></div>` — wrong empty-state copy, no card.

**Why it happens:** The early-return is locked in `WidgetRenderer.tsx:202-213` and is forgettable if the implementer focuses only on the registry.

**How to avoid:** The implementation order is: (1) `<InfoCardRenderer />` exists, (2) `WidgetRenderer.tsx` early-return added, (3) registry definition added, (4) registered in `registerAllChartTypes()`. Any spec for "user adds info-card and sees the empty-state copy" exercises all four touchpoints in one assertion path.

**Warning signs:** Picker shows the type, widget creates, but the body is the generic placeholder text rather than the card's empty-state copy.

## Code Examples

Verified patterns from existing code in this repo. All references are absolute paths — read them in place rather than trusting the snippets here.

### Existing scoped selector for `useInfoSelectionStore`

Source: `kinetica_bi/src/components/charts/InfoPopup.tsx:45-52`
```tsx
const activeLayerId = useInfoSelectionStore((s) => s.activeLayerId);
// PITFALL S-02 lock: scoped selector — NEVER s.state whole.
const entry = useInfoSelectionStore((s) =>
  s.activeLayerId !== null ? s.state[s.activeLayerId] : null
);
const activeLayer = activeLayerId !== null
  ? eligibleLayers.find((l) => l.id === activeLayerId) ?? null
  : null;
```
Card and view use this pattern verbatim.

### Existing on-demand fetch (popup's dropdown switch — to be moved into the view)

Source: `kinetica_bi/src/components/charts/MapChartRenderer.tsx:537-603` (`handleLayerSwitch`)
```tsx
const handleLayerSwitch = useCallback((newLayerId: number) => {
  const layer = eligibleLayers.find((l) => l.id === newLayerId);
  if (!layer) return;
  const tableMeta = tables.find((t) => t.id === layer.table_id);
  if (!tableMeta) return;
  infoQueryAbortRef.current?.abort();
  const controller = new AbortController();
  infoQueryAbortRef.current = controller;
  const store = useInfoSelectionStore.getState();
  store.setActiveLayer(newLayerId);
  store.setLoading(newLayerId, true);
  // ...spatial context derived from mapRef.current.getView()...
  infoQuery({ /* full payload */ }, controller.signal)
    .then((res) => {
      if (controller.signal.aborted) return;
      const s = useInfoSelectionStore.getState();
      s.setSelection(newLayerId, res);
      s.setLoading(newLayerId, false);
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      if ((err as { name?: string })?.name === "AbortError") return;
      const s = useInfoSelectionStore.getState();
      s.setError(newLayerId, "Failed to load layer");
      s.setLoading(newLayerId, false);
    });
}, [eligibleLayers, tables, widgetConfig]);
```
The view uses an equivalent function but reads spatial context from the new sibling slice instead of `mapRef`. The map renderer keeps a slim version (since the click handler still derives mapBbox from the live `mapRef`); the dropdown-switch logic moves entirely into the view.

### Existing chart-type registration (records.ts — closest precedent for info-card shape)

Source: `kinetica_bi/src/components/charts/definitions/records.ts:1-32` (full file). Notable points: `usesAggregation: false`, `supportsDrillDown: true` (info-card differs — must be `false`), no `CustomConfigPanel`, default-export `register()` function.

### Existing dashboard-layers store selector (eligibility source)

Source: `kinetica_bi/src/components/MapConfigPanel.tsx:38` and `kinetica_bi/src/store/dashboardLayersStore.ts:30-32`
```ts
// In MapConfigPanel.tsx:
const layers = useDashboardLayersStore((s) => s.layers);

// In dashboardLayersStore.ts:
export const useDashboardLayersStore = create<LayersState>((set) => ({
  layers: [],
  setLayers: (layers) => set({ layers }),
  // ...
}));
```
Card uses the same selector. Eligibility filter (card-only):
```ts
const eligibleLayers = useDashboardLayersStore((s) =>
  s.layers.filter(l => l.info_enabled === 1 && (l.config as { spatialMode?: string }).spatialMode !== "wkb")
);
```

Note: scoped derived selector. Also note that `s.layers.filter(...)` returns a fresh array reference on every store update — to be paranoid about re-renders, the filter can run in a `useMemo` inside the card after a stable `layers` subscription, or use Zustand's `shallow` equality function. Recommend: subscribe to `s.layers`, do the filter in `useMemo([layers])`. This matches the `MapChartRenderer.tsx:209-216` `eligibleLayers` memo pattern.

### Existing `infoQuery` POST helper

Source: `kinetica_bi/src/api/client.ts:686-700` (signature is locked, see Standard Stack table above for type alias names). Card calls this verbatim through the shared view.

### Three-store reset block (to extend to four)

Source: `kinetica_bi/src/App.tsx:42-56` (UNAUTHORIZED) and `kinetica_bi/src/components/DashboardsPage.tsx` `DashboardOpen` cleanup (per Phase 20-02 SUMMARY, "filterViewStore -> filterStore -> infoSelectionStore canonical order"). Add `useLastInfoClickContextStore.reset()` as the fourth call in canonical order at both sites.

## State of the Art

| Old Approach (pre-Phase-23) | Current Approach (Phase 23) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Info Card pure-consumer lock (no fetch) | Card and popup both fetch via shared view | Phase 23 (this phase) | PROJECT.md and STATE.md updates required; bar/line/pie/etc. still cannot fetch (the lock narrows from "card cannot fetch" to "only popup+card can fetch") |
| `.info-popup-*` CSS namespace for body classes | `.info-selection-*` for body; `.info-popup-*` for popup chrome only | Phase 23 P01 (atomic rename) | Three TSX files + one CSS file + four spec files touch; class-name aliasing rejected |
| `InfoPopup.tsx` owns dropdown + records + Load more inline | `<InfoSelectionView />` owns body; `InfoPopup.tsx` is chrome-only | Phase 23 (this phase) | `InfoPopup.spec.tsx` shrinks to chrome cases; `InfoSelectionView.spec.tsx` is created with body cases |
| Map renderer owns dropdown-switch + Load-more handlers | `<InfoSelectionView />` owns those handlers; map renderer keeps only the click-to-fan-out handler | Phase 23 (this phase) | `MapChartRenderer.tsx` slims; click handler now also writes to `useLastInfoClickContextStore` |

**Deprecated/outdated (would-be) approaches:**
- A "dual mount" pattern (one `<InfoPopup />` + one `<InfoCard />` instance both holding their own copy of the records) — rejected because it duplicates state, breaks the single-source-of-truth invariant, and conflicts with Phase 20's single dashboard-global `activeLayerId` lock.
- Merging the popup and card into a single component with a `mode` prop — rejected because the chrome surfaces are genuinely different (anchored vs grid; close X vs none; ESC vs none), and a `mode` prop encourages branching inside one file rather than two clean wrappers.

## Open Questions

### Q1 (R1 — Most material): Spatial-context replay strategy

**What we know:**
- Card has NO map widget reference. When user switches the card's dropdown to a layer with `state[newLayerId] === undefined`, the card must fire `POST /api/info/query`.
- The endpoint requires `clickLon, clickLat, radiusPx, mapBbox, mapWidthPx, mapHeightPx`.
- The popup currently derives these from `mapRef.current.getView().calculateExtent(...)` etc. (`MapChartRenderer.tsx:549-587`).
- CONTEXT.md presents three candidate strategies (A, B, C).

**What's unclear:** Which strategy minimizes coupling and matches the codebase's locked patterns?

**Recommendation: Strategy B (sibling `useLastInfoClickContextStore` slice).** Justification below.

#### Strategy A — Add `lastClickContext` field to `useInfoSelectionStore`
**Pros:** Single store; everything info-related in one place.
**Cons:**
- Phase 20 store shape was deliberately locked at roadmap creation (STATE.md "store-before-popup ordering" Key Decision). Modifying it for a Phase 23 affordance breaks that invariant.
- The store's documented invariants (`activeLayerId !== null ⇒ state[activeLayerId] exists`, type signature `setActiveLayer: (number) => void` not `(number | null)`) would gain new orthogonal state. The store comment header at `infoSelectionStore.ts:21-44` is locked language; adding `lastClickContext` invalidates parts of it.
- 23 vitest tests in `infoSelectionStore.spec.ts` (per Phase 20-01 SUMMARY) would need extension; spec scope grows for an unrelated concern.
- Reset semantics are entangled: should `reset()` clear `lastClickContext`? Probably yes, but now the comment "reset() top-level wipe" requires expansion.

#### Strategy B — Sibling `useLastInfoClickContextStore` Zustand slice
**Pros:**
- Matches codebase pattern: filterStore + filterViewStore + infoSelectionStore + toast are all sibling slices in `src/store/`.
- Phase 20 store stays byte-for-byte unchanged (zero risk of regression; 23 specs stay valid).
- New slice is ~40 lines + one spec; auto-covered by Zustand reset shim because it lives in `src/store/*.ts` (per Phase 20-01 SUMMARY — "automatically covered by the Zustand reset shim").
- Reset semantics localized: the new slice has its own `reset()`; wired into the four-store reset block at the same two sites used by Phase 20-02.
- Subscription scoping is trivial: `useLastInfoClickContextStore(s => s.context)` — no re-render churn.
**Cons:**
- One more store slice to wire into the lifecycle reset block (turns three-store block into four-store block — minor bookkeeping).
- A new "store of stores" mental load — but the alternative (Strategy A) is conceptually heavier.

#### Strategy C — Recompute from a "primary" map widget
**Pros:** No new store state.
**Cons:**
- Requires cross-component-tree access to a `mapRef` — no precedent in this codebase. Refs don't escape components naturally; we'd have to expose `mapRef` via a context or store, which IS a new state mechanism, just disguised.
- Tightly couples card to the existence of a map widget on the same dashboard. Card is dashboard-scoped; if the dashboard has cards but no map, this strategy breaks.
- "Primary map widget" requires defining a tie-breaker (first by position? user-configurable?) — opens a deferred design question that doesn't need to be answered in v1.4.
- Recomputing mapBbox from the OL view at click-replay time would re-use the CURRENT viewport, not the click-time viewport — semantically wrong if the user has panned/zoomed since clicking.

**Locked recommendation: Strategy B.**

**Field shape (Strategy B):**
```ts
export type LastInfoClickContext = {
  clickLon: number;          // EPSG:4326 (geographic degrees)
  clickLat: number;          // EPSG:4326
  mapBbox: [number, number, number, number];  // EPSG:3857 [minX, minY, maxX, maxY]
  mapWidthPx: number;        // > 0
  mapHeightPx: number;       // > 0
  radiusPx: number;          // resolved from MapChartRenderer's owning widget config via getInfoRadiusPx
  sourceWidgetId: number;    // informational only; cards don't filter by it
};
```

**Write site:** `MapChartRenderer.tsx` Effect 6 (`MapChartRenderer.tsx:701-792`) — at the start of the click handler, after the `event.coordinate` transform and `mapBbox` computation but BEFORE the fan-out loop. Single line:
```ts
useLastInfoClickContextStore.getState().setContext({
  clickLon, clickLat, mapBbox, mapWidthPx: size[0], mapHeightPx: size[1], radiusPx, sourceWidgetId: widget.id,
});
```

**Read sites:**
- Inside `<InfoSelectionView />` `handleLayerSwitch` and `handleLoadMore` — replaces the `mapRef.current.getView().calculateExtent(...)` derivation that currently lives in `MapChartRenderer.tsx:549-573` and `626-636`.
- The map renderer's CLICK fan-out keeps its current direct derivation (it has the mapRef and the live click event — replay is for downstream consumers).

**Reset wiring:** Add `useLastInfoClickContextStore.getState().reset()` to the existing three-store reset block at:
- `kinetica_bi/src/App.tsx` UNAUTHORIZED handler (alongside the three Phase-20-02 reset calls)
- `kinetica_bi/src/components/DashboardsPage.tsx` `DashboardOpen` cleanup (alongside the three Phase-20-02 reset calls)

Confidence: **HIGH**. The strategy is the natural extension of the codebase's existing patterns; no novel architectural decisions needed.

### Q2 (R2): `<InfoSelectionView />` minimal prop interface

**Recommended prop interface** (Claude's discretion per CONTEXT — locked recommendation):
```tsx
type Props = {
  /** Eligibility list. Caller (popup wrapper or card wrapper) computes with its scoping rule. */
  eligibleLayers: DashboardLayerDto[];
  /** Display-name resolver for dropdown options. */
  layerNameFor: (layer: DashboardLayerDto) => string;
  /** Resolves layer.table_id → schema/name for infoQuery payload. */
  resolveTable: (tableId: number) => { schema: string; name: string } | null;
  /** Empty-state copy. Card passes "Click a point on the map to see details"; popup may pass the same or a different short copy. */
  emptyStateCopy?: string;
};
```

The view internally:
- Subscribes to `useInfoSelectionStore` (active layer + entry).
- Subscribes to `useLastInfoClickContextStore(s => s.context)` for the on-demand fetch.
- Owns its own `infoQueryAbortRef` ref.
- Owns the layer-leaves-eligibility effect.
- Owns the cross-phase column sort.
- Calls `useInfoSelectionStore.getState().reset()` directly when the active layer leaves the eligible set (single behavior; popup wraps with chrome dismiss; card naturally renders empty after `activeLayerId` becomes null).

**Stays in popup chrome:** ESC key handler, click-outside backdrop, close X button, ol/Overlay anchor, tail. Click-outside dismiss specifically calls `onClose` (popup wrapper's reset + overlay.setPosition(undefined)).

**Stays in card chrome:** Standard widget shell (drag handle, delete button — handled by the dashboard widget grid, not by `<InfoCardRenderer />` itself).

**Spec migration scope:**

Phase 21's `InfoPopup.spec.tsx` (20 tests, lines H1–H7, B1–B7, L1–L3, A1–A2, S1) split as follows:

| Existing test | Stays in InfoPopup.spec.tsx | Moves to InfoSelectionView.spec.tsx |
|---------------|----------------------------|---------------------------------|
| H1: renders nothing when activeLayerId is null | move | (move) — body decision |
| H2: renders dropdown with 2 options; active layer selected | move | (move) |
| H3: dropdown option order matches eligibleLayers prop order | move | (move) |
| H4: clicking close X calls onClose exactly once | **stays** (chrome) | — |
| H5: pressing Escape calls onClose exactly once | **stays** (chrome) | — |
| H6: clicking backdrop calls onClose; clicking popup body does not | **stays** (chrome) | — |
| H7: dropdown change calls onLayerSwitch | move | (move) — but rewrite as direct store assertion (view fires fetch internally; no callback) |
| B1–B7: body modes (template, KV, loading, empty, error, info_columns filter) | move | (move) — all body modes |
| L1–L3: Load more button + disabled state | move | (move) — view owns the footer |
| A1: auto-dismisses when active layer leaves eligible set | move | (move) — view's effect |
| A2: does not auto-dismiss when eligible set unchanged | move | (move) |
| S1: PITFALL S-02 regression | move | (move) — body subscribes |

Plus **new tests in `InfoSelectionView.spec.tsx`** for the on-demand fetch path (currently not specced because the popup's `MapChartRenderer.spec.tsx` covers the fetch via P15/P16):
- View's `handleLayerSwitch` reads from `useLastInfoClickContextStore` and calls `infoQuery` with the replayed coords.
- View's `handleLayerSwitch` short-circuits (no fetch) when `useLastInfoClickContextStore.context === null` (Pitfall 2 above).
- View's `handleLoadMore` reads from same store; same short-circuit semantics.
- View's `handleLayerSwitch` aborts prior in-flight controller on rapid switches.

**`MapChartRenderer.spec.tsx` POPUP-V14 section** (P1–P16, lines 1081-1640): keeps P1–P14 (kill switch, fan-out semantics, EPSG transform, dismiss). P15 and P16 (handleLayerSwitch, handleLoadMore) move to `InfoSelectionView.spec.tsx` because those handlers move out of `MapChartRenderer`. The P13 click-coord transform test stays — that's the click handler, not the dropdown switch.

**`InfoCardRenderer.spec.tsx` (NEW)** covers:
- Registry registration (`info-card` is in `getAllChartTypes()` after `registerAllChartTypes()`).
- `WidgetRenderer` early-return: `widget.type === "info-card"` renders `<InfoCardRenderer />`, NOT `AggregatedWidgetRenderer`.
- Dashboard-scoped eligibility: card includes layers from any map widget, excludes `info_enabled === 0` and `spatialMode === "wkb"`.
- No close X / no ESC handler / no anchored chrome.
- Empty state with `activeLayerId === null` renders the verbatim copy `Click a point on the map to see details`.
- Chrome-vs-popup separation: card does not render `.info-popup-anchored` / `.info-popup-tail` / `.info-popup-overlay-element`.

Confidence: **MEDIUM-HIGH**. The shape is locked by CONTEXT; only fine-grained naming (e.g., `resolveTable` vs `tables` array) is researcher-recommend, planner-lock.

### Q3 (R3): CSS rename diff

**File touched:** `kinetica_bi/src/styles/global.css` only. The Phase 21 `.info-popup-*` body classes live at lines 1928-2003.

**Selector inventory** (verbatim from `grep -n` against `global.css`):

| Line | Selector | Category | Rename to |
|------|----------|----------|-----------|
| 1931 | `.info-popup-backdrop` | popup chrome (click-outside dismiss target — no analog in card) | **stays** `.info-popup-backdrop` |
| 1935 | `.info-popup` | shared body container | rename `.info-selection` |
| 1948 | `.info-popup-header` | shared body (sticky header band) | rename `.info-selection-header` |
| 1956 | `.info-popup-layer-select` | shared body (dropdown) | rename `.info-selection-layer-select` |
| 1961 | `.info-popup-close` | popup chrome (close X — no analog in card) | **stays** `.info-popup-close` |
| 1970 | `.info-popup-close:hover` | popup chrome | **stays** |
| 1971 | `.info-popup-body` | shared body (scrollable record area) | rename `.info-selection-body` |
| 1976-1978 | `.info-popup-loading, .info-popup-empty, .info-popup-error` | shared body (state placeholders) | rename `.info-selection-loading`, `.info-selection-empty`, `.info-selection-error` |
| 1983 | `.info-popup-error` (color override) | shared body | rename `.info-selection-error` |
| 1984 | `.info-popup-rows` | shared body (record list container) | rename `.info-selection-rows` |
| 1985 | `.info-popup-row` | shared body | rename `.info-selection-row` |
| 1986-1988 | `.info-popup-row-kv` (table/th/td variants) | shared body (KV table) | rename `.info-selection-row-kv` |
| 1989 | `.info-popup-footer` | shared body (Load-more footer) | rename `.info-selection-footer` |
| 1995 | `.info-popup-load-more` | shared body (button) | rename `.info-selection-load-more` |
| 1999 | `.info-popup-load-more:disabled` | shared body | rename `.info-selection-load-more:disabled` |
| 2003 | `.info-popup-overlay-element` | popup chrome (ol/Overlay wrapper element — no analog in card) | **stays** `.info-popup-overlay-element` |
| 2008-2095 | `.info-popup-config-*` | Phase 22 layer/widget config UI (entirely separate concern; lives in KineticaWmsLayerForm + MapConfigPanel) | **stays** (out of scope for Phase 23 — these are config-form classes, not popup-body classes) |

**Lines `.info-popup-row-template` (line 141 in `InfoPopup.tsx` — uses `.info-popup-row info-popup-row-template`)**: the JSX uses `.info-popup-row-template` as a className but global.css does NOT define a `.info-popup-row-template` selector (verified — `grep` returns no `.info-popup-row-template` declaration). The `.info-popup-row` and `.info-popup-row-kv` styles cover both modes; `.info-popup-row-template` is just a marker class with no styling. Recommendation: rename to `.info-selection-row-template` for consistency, even though it has no styling rules.

**Total rename count:** 14 selector definitions + ~20 className references in `InfoPopup.tsx` (lines 87, 88, 89, 91, 103, 110, 112, 115, 118, 121, 141, 147, 163, 165) — but most of these references will move into `<InfoSelectionView />` during the extraction. The popup chrome refs (`info-popup-backdrop`, `info-popup`, `info-popup-close`, `info-popup-overlay-element`) stay in the popup wrapper and keep their existing names.

**Spec impact:**
- `InfoPopup.spec.tsx:133`: `container.querySelector(".info-popup-backdrop")` — stays (popup chrome).
- `InfoPopup.spec.tsx:134`: `container.querySelector(".info-popup")` — depends on whether the new `<InfoPopup />` outer element keeps `.info-popup` (popup chrome) or renders the renamed body class. Recommendation: popup outer wrapper keeps `.info-popup` (it's the anchored container; matches "popup chrome stays popup-namespaced"). Inner `<InfoSelectionView />` renders `.info-selection` as the body root. Spec query `container.querySelector(".info-popup")` continues to find the outer wrapper. **No spec change needed for this assertion.**
- New `InfoSelectionView.spec.tsx` queries use `.info-selection-*` class names.

**No external CSS file (PostCSS, SASS, CSS modules) — single global.css file.** Verified by `grep -rn 'info-popup' kinetica_bi/src` — only `global.css` declares them; only `InfoPopup.tsx`, `MapChartRenderer.tsx:836`, and the spec files reference them.

Confidence: **HIGH** — full inventory grep-verified.

### Q4 (R4): `dashboardLayersStore` eligibility filter shape

**Store shape** (`kinetica_bi/src/store/dashboardLayersStore.ts:20-28`):
```ts
type LayersState = {
  layers: DashboardLayerDto[];
  // ... CRUD actions
};
```

**`DashboardLayerDto` shape** (`kinetica_bi/src/api/client.ts:450-466` — relevant fields for eligibility):
```ts
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;          // contains spatialMode, etc.
  info_enabled: number;                      // 0 | 1
  info_columns: string | null;
  info_template: string | null;
  created_at: string;
  updated_at: string;
};
```

**spatialMode derivation** — read directly from `layer.config.spatialMode`. The current popup pattern at `MapChartRenderer.tsx:209-216`:
```tsx
const eligibleLayers = useMemo<DashboardLayerDto[]>(() => {
  return includedLayers.filter((layer) => {
    if (layer.info_enabled === 0) return false;
    const cfg = layer.config as Partial<MapWidgetConfig>;
    if (cfg.spatialMode === "wkb") return false;
    return true;
  });
}, [includedLayers]);
```

**Card's filter** — same predicate, but applied to `useDashboardLayersStore.layers` directly (no `includedLayerIds` widget-config narrowing, no visibility narrowing):
```tsx
// Inside InfoCardRenderer.tsx
const allLayers = useDashboardLayersStore((s) => s.layers);
const eligibleLayers = useMemo<DashboardLayerDto[]>(() => {
  return allLayers
    .filter((layer) => {
      if (layer.info_enabled === 0) return false;
      const cfg = layer.config as Partial<MapWidgetConfig>;
      if (cfg.spatialMode === "wkb") return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.position - b.position);   // stable order; matches popup's sort by position
}, [allLayers]);
```

**No helper extraction needed** — the predicate is 4 lines. Inlining matches `MapChartRenderer.tsx`'s pattern. If the planner wants to extract for shared use across popup + card, fine, but it's optional. Recommend inline — the predicate's two scopes (popup map-scoped, card dashboard-scoped) wrap the same predicate around different starting sets, so a helper would need to take the starting set as input — barely an abstraction.

**Note on derivation source:** The `spatialMode` lives in the layer's `config` JSON blob, not as a top-level DTO field. There's no separate `deriveSpatialMode(layer)` helper; the cast pattern `(layer.config as Partial<MapWidgetConfig>).spatialMode` is the established idiom across `MapChartRenderer.tsx`, `MapConfigPanel.tsx`, etc.

Confidence: **HIGH** — verified across `MapChartRenderer.tsx:206-216`, `dashboardLayersStore.ts:20-32`, and `client.ts:447-466`.

### Q5 (R5): Chart-type registry registration test

**Verified:** `kinetica_bi/src/components/charts/registry.spec.ts` does NOT exist.

**Registration coverage today** is implicit:
- `registerAllChartTypes()` is called at app init (probably `App.tsx` or `main.tsx` — the planner can verify the call site, but it's not relevant to phase scope).
- Existing chart types' specs (`MapConfigPanel.spec.tsx`, `KineticaWmsLayerForm.spec.tsx`, etc.) implicitly assume registration has happened.
- `WidgetRenderer.spec.tsx` (438 tests in the suite per Phase 21 SUMMARY) tests `widget.type` switch behavior, which implicitly relies on the registry.

**Recommendation for Phase 23:**
- Add registration coverage in `InfoCardRenderer.spec.tsx` directly (single test):
  ```tsx
  import { getChartType } from "./registry";
  import { registerAllChartTypes } from "./definitions";

  it("registers info-card in the chart-type registry", () => {
    registerAllChartTypes();
    const def = getChartType("info-card");
    expect(def).toBeDefined();
    expect(def?.label).toBe("Info Card");
    expect(def?.usesAggregation).toBe(false);
    expect(def?.supportsDrillDown).toBe(false);
    expect(def?.fields).toEqual([]);
    expect(def?.defaultConfig).toEqual({});
    expect(def?.CustomConfigPanel).toBeUndefined();
  });
  ```
- Do NOT introduce a separate `registry.spec.ts` — out of phase scope, and there's no precedent (no other chart type has a dedicated registration spec).

Confidence: **HIGH** — file existence verified by `ls`.

### Q6 (R6): `WidgetRenderer.tsx` integration site

**Current early-returns** at `WidgetRenderer.tsx:202-213`:
```tsx
const WidgetRenderer = ({ widget, tables = [] }: WidgetRendererProps) => {
  if (widget.type === "map") {
    return <MapChartRenderer widget={widget} tables={tables} />;
  }
  if (widget.type === "records") {
    return <RecordsTableRenderer widget={widget} />;
  }
  return <AggregatedWidgetRenderer widget={widget} />;
};
```

**Phase 23 insertion** — third early-return between `records` and the fall-through:
```tsx
const WidgetRenderer = ({ widget, tables = [] }: WidgetRendererProps) => {
  if (widget.type === "map") {
    return <MapChartRenderer widget={widget} tables={tables} />;
  }
  if (widget.type === "records") {
    return <RecordsTableRenderer widget={widget} />;
  }
  if (widget.type === "info-card") {
    return <InfoCardRenderer widget={widget} tables={tables} />;
  }
  return <AggregatedWidgetRenderer widget={widget} />;
};
```

**Props the card needs:**
- `widget: WidgetDto` — for `widget.id` (informational; not strictly required, but useful for debugging / spec assertions).
- `tables?: TableDto[]` — needed to resolve `layer.table_id → { schema, name }` for `infoQuery` payload (`schema` and `table` are required fields on `InfoQueryRequest` per `client.ts:662-676`).

**Why the card needs `tables`:** When the card's dropdown switches to a layer and `state[newLayerId]` is undefined, the on-demand fetch builds an `infoQuery` payload that includes `schema` and `table`. These come from `tables.find(t => t.id === layer.table_id)` — same pattern as `MapChartRenderer.tsx:540-541` and `MapChartRenderer.tsx:732`. The card's `<InfoSelectionView />` consumes a `resolveTable` prop that maps tableId → `{ schema, name }`; the card wrapper builds it from `tables`.

**Confirmation:** Card reads stores directly (`useInfoSelectionStore`, `useDashboardLayersStore`, `useLastInfoClickContextStore`). It does NOT need any widget-config-derived props — `widget.config` is `{}` for info-card per locked decision.

Confidence: **HIGH** — line numbers verified.

### Q7 (R7): Pre-empted potential pitfalls (selector-scope, lifecycle, etc.)

#### Q7.1: Phase 21 layer-leaves-eligibility effect — popup-only or shared?

**Current location:** `InfoPopup.tsx:67-75`. The effect watches `[activeLayerId, eligibleIds]` (eligibleIds is a memo'd `Set` over `eligibleLayers`).

**Recommendation: MOVE into `<InfoSelectionView />`.** Both popup and card need the same auto-cleanup behavior when the active layer falls out of their respective eligibility sets. Each wrapper passes its own `eligibleLayers` (popup: map-widget-scoped; card: dashboard-scoped); the shared view runs the effect against whatever it received.

**Behavior in shared view:** When active layer leaves the set, the view calls `useInfoSelectionStore.getState().reset()` directly (not via callback). Popup's chrome handles dismiss via React unmounting naturally (since `activeLayerId === null` makes the view render nothing → popup wrapper has nothing to anchor → existing popup wrapper logic dismisses or hides). Card's chrome handles it by rendering the empty-state copy (since `activeLayerId === null` triggers the empty branch).

Single behavior, two surfaces, no callback divergence. Pitfall 3 above documents this in detail.

#### Q7.2: Phase 22 cross-phase column sort — popup or shared?

**Current location:** `InfoPopup.tsx:128`:
```tsx
const sortedColumns = [...entry.columns].sort((a, b) => a.localeCompare(b));
```

**Recommendation: MOVE into `<InfoSelectionView />`** at the same point in the per-row JSX. Both popup and card render via `renderInfoTemplate`, so both must pre-sort. Phase 22 SUMMARY explicitly anticipates this: "The alphabetical sort logic established in `InfoPopup.tsx` will need to be replicated or shared in the Info Card renderer so both surfaces render KV columns in the same order." Moving it into the shared view is the cleanest implementation.

`renderInfoTemplate.ts` itself stays untouched — pure helper, order-preserving. Cross-phase contract: caller sorts; helper does not.

#### Q7.3: Selector scoping post-refactor

Both popup and card subscribe via `<InfoSelectionView />`. The view has two scoped selectors (one for `activeLayerId`, one for `state[activeLayerId]`). The card wrapper and popup wrapper do NOT need their own `useInfoSelectionStore` subscriptions — all body-driven re-rendering happens inside the view.

Card wrapper subscribes only to `useDashboardLayersStore.layers` (for eligibility). Popup wrapper subscribes to whatever it currently subscribes to (mostly map-renderer-derived props; no direct store subscription to `useInfoSelectionStore` at the popup level — the view handles it).

**Verification step for the planner:** After refactor, `grep -n 'useInfoSelectionStore' InfoPopup.tsx` should return ZERO matches (popup is pure chrome; subscription moved to view). Same for `InfoCardRenderer.tsx`.

#### Q7.4: AbortController lifecycle — does the card need explicit cleanup like Phase 21's `materializeAbortRef` pattern?

**Yes — but the responsibility lives in `<InfoSelectionView />`, not the card wrapper.** The view owns its own `useRef<AbortController | null>(null)` and aborts:
- On dropdown switch (new switch aborts the prior one).
- On Load-more (new load-more aborts the prior one — though Load-more is a button click, so concurrent presses are normally short-circuited by `disabled={loading}` already).
- On unmount (cleanup function in the relevant `useEffect`).

The card wrapper (`<InfoCardRenderer />`) does NOT need its own AbortController. When the card unmounts (e.g., dashboard switch), React unmounts the inner `<InfoSelectionView />`, which fires its cleanup, which aborts.

The map renderer keeps its own `infoQueryAbortRef` for the click-fan-out path (still lives at `MapChartRenderer.tsx:250`). The fan-out and the dropdown-switch are now two separate AbortControllers in two different components — that's correct because they have independent lifecycles.

#### Q7.5: Re-render hygiene on unrelated layer mutations

S-02 regression tested in `InfoPopup.spec.tsx:377-397` (test S1). The same regression test should apply in `InfoSelectionView.spec.tsx` post-extraction. Card's spec also includes a similar S1-equivalent.

#### Q7.6: Map widget kill-switch interaction with card

The popup's kill switch (`infoEnabled: false` on map widget config) is a per-map-widget setting. It disables the OL click listener. Card has no map widget binding, so the kill switch is a non-concern — the card always renders subject to empty state.

But: if all map widgets on a dashboard have `infoEnabled: false`, no clicks ever fire, so `useLastInfoClickContextStore.context` stays null, so the card's dropdown-switch-fetch will short-circuit (Pitfall 2). Card body shows the empty-state copy. This is the correct behavior — no special handling needed.

### Q8 (R8): Validation Architecture

Skipped per `.planning/config.json` setting `workflow.nyquist_validation: false`.

(The spec strategy is captured in detail in Q2 above; no separate validation-architecture section needed.)

## Sources

### Primary (HIGH confidence)

- `.planning/phases/23-info-card/23-CONTEXT.md` — locked decisions (read in full)
- `.planning/REQUIREMENTS.md` — CARD-V14-01..04 wording
- `.planning/STATE.md` — locked v1.4 architecture decisions
- `.planning/PROJECT.md` — Out-of-scope and Key Decisions
- `.planning/ROADMAP.md` — Phase 23 boundary + 4 success criteria
- `.planning/phases/21-map-click-popup/21-CONTEXT.md` — popup decisions to refactor
- `.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md` — InfoPopup line numbers
- `.planning/phases/21-map-click-popup/21-03-map-renderer-integration-SUMMARY.md` — fan-out + handler line numbers
- `.planning/phases/22-config-ui/22-CONTEXT.md` — cross-phase sort lock
- `.planning/phases/22-config-ui/22-03-layer-config-SUMMARY.md` — sort implementation site
- `kinetica_bi/src/components/charts/InfoPopup.tsx` (full file, 184 lines) — extraction source
- `kinetica_bi/src/components/charts/MapChartRenderer.tsx` (lines 209-216, 245-251, 515-792, 836-844) — eligibility memo, abort ref, handlers, JSX
- `kinetica_bi/src/components/charts/registry.ts` (full file) — ChartTypeDefinition shape
- `kinetica_bi/src/components/charts/definitions/index.ts` (full file) — barrel pattern
- `kinetica_bi/src/components/charts/definitions/records.ts` (full file) — closest precedent for info-card shape
- `kinetica_bi/src/components/charts/definitions/map.ts` (full file) — `usesAggregation: false` precedent
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` (lines 202-213) — early-return pattern + insertion site
- `kinetica_bi/src/store/infoSelectionStore.ts` (full file, 172 lines) — store contract
- `kinetica_bi/src/store/dashboardLayersStore.ts` (full file, 55 lines) — eligibility source
- `kinetica_bi/src/lib/renderInfoTemplate.ts` (full file, 78 lines) — pure render helper
- `kinetica_bi/src/lib/mapInfoConfig.ts` (full file) — `getInfoEnabled` / `getInfoRadiusPx` defaults
- `kinetica_bi/src/api/client.ts` (lines 447-700) — DashboardLayerDto + infoQuery types
- `kinetica_bi/src/styles/global.css` (lines 1928-2003) — `.info-popup-*` body class inventory
- `kinetica_bi/src/components/charts/InfoPopup.spec.tsx` (full file, 398 lines) — spec migration source
- `kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx` (lines 1073-1640) — POPUP-V14 tests P1–P16

### Secondary (MEDIUM confidence)

- Tool-confirmed file existence: no `registry.spec.ts`, no `InfoSelectionView.tsx`, no `lastInfoClickContextStore.ts`, no `InfoCardRenderer.tsx` — all verified via `ls` against `kinetica_bi/src/components/charts/` and `kinetica_bi/src/store/`.
- `.planning/config.json` confirms `workflow.nyquist_validation: false` — Validation Architecture section skipped per researcher rules.

### Tertiary (LOW confidence)

None. All design decisions in this RESEARCH.md are sourced from CONTEXT.md (locked) or verified against existing codebase files.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new deps; all primitives exist and are widely used
- Architecture / extraction shape: **HIGH** — design north star is locked in CONTEXT; the only researcher-recommended-planner-locks are naming details
- Spatial-context-replay strategy: **HIGH** — Strategy B's pros vs A and C are decisive
- CSS rename diff: **HIGH** — full inventory grep-verified, line-numbered
- Pitfalls: **HIGH** — all sourced from concrete existing-code patterns or locked Phase 20/21/22 decisions
- Spec migration scope: **MEDIUM-HIGH** — based on full read of `InfoPopup.spec.tsx` (20 tests) and `MapChartRenderer.spec.tsx` POPUP-V14 block (16 tests); planner may refine test groupings during P03 design

**Research date:** 2026-05-09
**Valid until:** 2026-06-08 (30 days; codebase is mid-flight v1.4 but the touchpoints in this phase are stable)

---
*Phase: 23-info-card*
*Research completed: 2026-05-09*
