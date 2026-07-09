# Phase 107: Panel Shell + Reflow + XOR Switch + Chips - Research

**Researched:** 2026-07-09
**Domain:** React + zustand presentation-layer refactor (no new libraries) — extracting a shared `FilterChip`, standing up a collapsible right-side drawer, wiring `react-grid-layout` auto-reflow, and an XOR mode switch, entirely inside `packages/web`.
**Confidence:** HIGH — every finding below is read directly from the live codebase (exact line numbers cited) or from the LOCKED 107-CONTEXT.md / 107-UI-SPEC.md. No Context7/WebSearch was needed: zero new packages, zero unfamiliar APIs — the stack (`react-grid-layout@2.2.2`, zustand, FontAwesome, existing CSS token system) is 100% already installed and used elsewhere in this exact file.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Panel shell — collapse & default state**
- Default expanded when mode=`panel`.
- Collapsed form = a thin vertical rail docked on the right showing a filter count badge + an expand handle (NOT fully hidden).
- Collapse state remembered per-user, per-dashboard via localStorage — survives reloads without touching the designer's saved default mode. Client-only preference; do NOT persist server-side.

**Panel shell — width & responsiveness**
- Fixed panel width (Claude's discretion; ~300px, `--filter-panel-width`-style token consistent with `.sidebar`).
- Panel is an in-flow flex sibling that shrinks the `useContainerWidth` grid container → `ResponsiveGridLayout` auto-reflows. NEVER a `position:fixed` overlay on wide screens.
- Auto-collapse below a width breakpoint so charts keep usable width on narrow viewports; when the user expands on a narrow viewport the panel overlays the charts (does not reflow) — reflow/push is wide-screen behavior only.

**Grouping & group headers**
- Group by source, matching the top bar's sectioning: one section per table, then dynamic views, then spatial draws.
- Group order is stable: tables → dynamic views → spatial.
- Groups are collapsible — each has a header showing the source name + a per-group clear control + a collapse/expand toggle.

**Chip anatomy & provenance**
- Each chip: the filter value/clause (via existing `buildChipText`) + a remove ✕.
- Provenance shows as a muted subtitle line beneath the value ("from <source widget>"), always visible. Resolve the source-widget display name from `sourceWidgetId`; when unknown/absent, omit the subtitle gracefully.
- Long values truncate with an ellipsis + full value on hover (title/tooltip).
- Spatial and datetime-between chips use the SAME shared chip; provenance subtitle applies where a source is known.

**Shared FilterChip (FPANEL-V120-09)**
- Extract ONE `FilterChip` component used by BOTH the new panel AND the existing top bar. In the TOP BAR it must render byte-identically to today's `.filter-bar-chip` (no visual/behavior regression). Provenance subtitle may be a prop the top bar leaves off — planner decides, but top-bar parity is a hard requirement.

**XOR mode switch (FPANEL-V120-01)**
- `DashboardsPage` reads `dashboard.filter_display_mode` and renders the top bar XOR the panel — never both. Absent/`topbar` → existing top bar, byte-identical.

**Empty state (FPANEL-V120-06)**
- When mode=`panel` and no active filters, the expanded panel shows a friendly empty state. The collapsed rail shows a 0/empty badge state.

### Claude's Discretion
- Exact panel width value + breakpoint threshold + empty-state copy + count-badge exact styling.
- Whether the shared FilterChip takes a `variant`/`showProvenance` prop vs composition — as long as top-bar parity holds and the panel shows the subtitle.
- Rail iconography / handle affordance.

### Deferred Ideas (OUT OF SCOPE)
None new from this discussion. Already deferred to v2 in REQUIREMENTS.md: in-panel filter search/quick-find (FPANEL-V2-01), pinned/floating or viewer-level layout override (FPANEL-V2-02), resizable drag-width panel (FPANEL-V2-03). The GLOBAL clear-all is Phase 109; applies-to list + highlight is Phase 108 — both in-milestone, just later phases.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| FPANEL-V120-01 | XOR: panel mode renders drawer instead of top bar; never both | `DashboardsPage.tsx` exact branch point identified (line 923 `dashboard-open` root, lines 937–1102 top-bar IIFE, lines 1110–1215 grid). Recommended minimal-diff wrapper pattern below. |
| FPANEL-V120-02 | Chips cover eq/in/datetime-between/spatial | `buildChipText` (`lib/columnTypes.ts:200`) already covers eq/in/between/datetime uniformly; spatial chip text `${shape.label} (${shape.measurement})` (`DashboardsPage.tsx:1009`) — both text-producers are reused verbatim by `FilterChip`. |
| FPANEL-V120-03 | Per-chip remove | Existing handlers `removeFilter(tableId, column)` / `removeDvFilter(dvId, column)` / `removeShape(id)` (`DashboardsPage.tsx:1000,1014,1083`) — reused unchanged via an `onRemove` prop on `FilterChip`. |
| FPANEL-V120-04 | Per-group clear | Existing `clearFilters(tableId)` / `clearDvFilters(dvId)` / shape-loop (`DashboardsPage.tsx:1029,1046-1052,1093`) — reused unchanged per panel group. |
| FPANEL-V120-05 | Collapse + count badge | New `.filter-panel-rail` + `.filter-panel-rail-badge`(`--empty`) classes (already specified in UI-SPEC, not yet in `global.css`); count = sum of `filterStore.filters` + `.dvFilters` entries + `spatialFilterStore.shapes.length`. |
| FPANEL-V120-06 | Empty state | `.filter-panel-empty` (expanded) / `.filter-panel-rail-badge--empty` (collapsed) — new classes, copy locked in UI-SPEC. |
| FPANEL-V120-07 | Group by source, stable order | NEW grouping assembly required — see Research Q6/Q7 below; NOT a straight reuse of the top bar's per-table loop (spatial must become its own trailing group, a deliberate deviation from today's per-table-embedded spatial chips). |
| FPANEL-V120-08 | Provenance | `sourceWidgetId` field already exists on `ActiveFilter` (`store/filterStore.ts:38`); resolve via `widgets.find(w => w.id === sourceWidgetId)?.title` — `widgets: WidgetDto[]` is already in scope in `DashboardOpen` (`DashboardsPage.tsx:410`). Spatial `Shape` has NO `sourceWidgetId` field (`store/spatialFilterStore.ts:34-46`) — spatial chips NEVER show provenance, by data-model, not by omission logic. |
| FPANEL-V120-09 | Shared FilterChip, top-bar parity | Extraction approach + regression strategy detailed in Research Q1 below. |

</phase_requirements>

## Summary

Phase 107 is a pure refactor-and-extend of `packages/web/src/components/DashboardsPage.tsx` (the only file with real logic risk) plus additive-only changes to `packages/web/src/styles/global.css` (new `.filter-panel-*` classes — the UI-SPEC has already fully specified these rulesets verbatim, so this phase's CSS work is "copy the spec's ruleset table into `global.css`," not design work). No new npm packages, no server changes, no Context7/WebSearch needed — everything required is already installed and already used elsewhere in this exact component (`react-grid-layout`, FontAwesome, zustand, the `.sidebar` collapse pattern, `buildChipText`).

The single highest-value insight for planning: **the panel's grouping shape is NOT a straight reuse of the top bar's grouping loop.** Today the top bar renders one row per `tableId`, with spatial chips embedded inside whichever table row(s) the shape targets (a shape can appear in multiple rows — the "multi-target global nuke" pattern). CONTEXT.md's locked order "tables → dynamic views → spatial" makes spatial its **own single trailing group** in the panel, decoupled from any specific table. This is a deliberate, useful simplification (it resolves the existing multi-target awkwardness) but it means the panel needs new group-assembly code, even though **individual chip rendering** (via the new `FilterChip`) is 100% shared with the top bar.

**Primary recommendation:** Split into two sequential plans — Plan A extracts `FilterChip` (byte-identical top-bar refactor + regression proof), Plan B builds the panel shell/rail/reflow/XOR/grouping/empty-state/badge on top of it. Do not attempt both in one wave; Plan B directly imports Plan A's component.

## Standard Stack

No new libraries. Everything is already installed and already imported in `DashboardsPage.tsx` / `global.css`:

| Package | Version (installed) | Purpose in this phase |
|---|---|---|
| `react-grid-layout` | 2.2.2 (verified installed; `useContainerWidth` confirmed to use `ResizeObserver` internally) | Grid reflow — unchanged API, just a new flex sibling |
| `@fortawesome/react-fontawesome` + `free-solid-svg-icons` | already installed | `faAnglesLeft`/`faAnglesRight` (rail), `faChevronDown`/`faChevronRight` (group collapse), `faXmark` (already imported in `DashboardsPage.tsx`) |
| `zustand` | already installed | `filterStore`, `spatialFilterStore` reads — unchanged |

No `npm install` needed for this phase. Do not add any dependency.

## Architecture Patterns

### Exact current structure (`packages/web/src/components/DashboardsPage.tsx`)

```
DashboardOpen component (props include dashboard: DashboardDto — line ~395-410)
  const [widgets, setWidgets] = useState<WidgetDto[]>([]);        // line 410 — has .title, usable for provenance
  const { width, mounted, containerRef } = useContainerWidth();   // line 487
  const shapes = useSpatialFilterStore((s) => s.shapes);          // line 596 — ALL shapes, unfiltered by eligible target
  const targetsByTable = useMemo(...aggregateSpatialTargetsByTable(widgets)...); // line 597
  const tableIdsWithSpatialChips = useMemo(...);                  // line 606 — tables with an ELIGIBLE target + shapes
  const allStoreFilters = useFilterStore((s) => s.filters);       // line 584
  const allDvFilters = useFilterStore((s) => s.dvFilters);        // line 589

  return (
    <div className="dashboard-open">                              // line 924
      ...header/error blocks...

      {/* lines 937-1102: top-bar IIFE — renders <div className="filter-bar"> or null */}
      {(() => { ... per-tableId rows (column chips + embedded spatial chips) ...
                ... per-dvId rows (dv chips) ... })()}

      {widgets.length === 0 && (<div className="muted">No visualizations yet...</div>)}  // lines 1104-1108

      <DashboardContextProvider dashboardId=... widgets=... ...>   // line 1110
        <div ref={containerRef}>                                   // line 1118 — THE measured element, currently classless
          {widgets.length > 0 && mounted && (
            <ResponsiveGridLayout width={width} ...>                // line 1120
              {widgets.map((w) => ( <div className="widget-card">...</div> ))}
            </ResponsiveGridLayout>
          )}
        </div>
      </DashboardContextProvider>
    </div>
  );
```

**The exact element `useContainerWidth` measures is the `<div ref={containerRef}>` at line 1118** — it currently has NO className and NO wrapper of its own; it is a direct child of `<DashboardContextProvider>`, which is itself a direct child of `<div className="dashboard-open">`.

### Recommended XOR + reflow wiring (minimal diff)

Introduce ONE new boolean and wrap the *existing* grid block, without touching its internals:

```tsx
const isPanelMode = dashboard.filter_display_mode === "panel";

const gridBlock = (
  <DashboardContextProvider dashboardId={dashboard.id} widgets={widgets} ...>
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      className={isPanelMode ? "filter-panel-grid-wrap" : undefined}
    >
      {widgets.length > 0 && mounted && (
        <ResponsiveGridLayout ...>{/* UNCHANGED */}</ResponsiveGridLayout>
      )}
    </div>
  </DashboardContextProvider>
);

return (
  <div className="dashboard-open">
    {/* header/error blocks unchanged */}

    {!isPanelMode && (/* EXACT existing top-bar IIFE, lines 937-1102, untouched */)}

    {widgets.length === 0 && (/* unchanged empty message */)}

    {isPanelMode ? (
      <div className="filter-panel-layout">
        {gridBlock}
        {panelCollapsed
          ? <FilterPanelRail count={activeFilterCount} onExpand={...} />
          : <FilterPanel ... onCollapse={...} />}
      </div>
    ) : gridBlock}
  </div>
);
```

This is the safest possible diff shape: in `topbar`/absent mode, `gridBlock` is rendered exactly as today (no wrapping div, no className added to `containerRef`'s div) — **byte-identical DOM**, satisfying the backward-compat lock and the UI-SPEC's explicit "topbar mode never wraps the grid in this div" rule. `useContainerWidth`'s `ResizeObserver` only ever measures one element either way, so no dual-measurement risk.

**Why this satisfies reflow (no thrash):** `.filter-panel-layout` is `display:flex`; `.filter-panel-grid-wrap` is `flex:1 1 auto; min-width:0`. Toggling `.filter-panel`⇄`.filter-panel-rail` is a **discrete conditional render** (component swap), not a CSS width transition — so `ResizeObserver` fires exactly once per toggle (UI-SPEC explicitly locks this: "Do not add a `transition: width`"). This directly satisfies PITFALLS.md Pitfall 3's warning about animated-width thrash.

### Grouping assembly (FPANEL-V120-07) — NOT a straight reuse

The top bar's existing per-table loop (lines 967-1099) mixes column filters and embedded spatial chips into the SAME row per `tableId`, then appends dv rows as siblings. The panel's locked order ("tables → dynamic views → spatial", spatial as its own concept) requires assembling three **separate** collections instead:

1. **Table groups** — for each `tableId` with `allStoreFilters[tableId]?.length > 0` (reuse this exact predicate), one `.filter-panel-group` titled by the same `srcName` resolution already used at line 972-974 (associatedTables lookup, falling back to view name / `table {id}`), containing ONLY column chips (no spatial embedding here — that's the deviation from top-bar shape).
2. **Dynamic-view groups** — for each `dvId` in `Object.entries(allDvFilters)` with `length > 0`, one `.filter-panel-group` titled by `dynamicViews.find(dv => dv.id === dvId)?.name ?? \`dynamic view ${dvId}\`` — this loop's body is otherwise a straight lift of lines 1067-1099.
3. **ONE spatial group** — if `shapes.length > 0` (and, per the existing orphan-hiding precedent, only if `targetsByTable.size > 0` — see Open Questions), a single trailing `.filter-panel-group` listing every shape flatly (not per-table), with one per-group clear that loops `removeShape(id)` over ALL shapes — this is actually a *cleaner* fit for the existing spatial data model (a shape's `targetsByTable` membership is inherently multi-table/OR-based; today's "global nuke on any table's Clear all" hack becomes literally correct once spatial is genuinely one global group).

Static `views[].filter_clause` (the muted read-only `WHERE ...` text) has **no defined home in the panel** per the current UI-SPEC/REQUIREMENTS — see Open Questions.

### Shared `FilterChip` — extraction approach (FPANEL-V120-09)

**Recommended props shape** (composition via one variant prop, per CONTEXT's discretion clause):

```tsx
type FilterChipProps = {
  text: string;              // buildChipText(...) output, or `${shape.label} (${shape.measurement})`
  removeAriaLabel: string;   // e.g. "Remove filter zone" / "Remove spatial filter Bbox 1" — EXACT existing copy
  onRemove: () => void;
  variant: "topbar" | "panel";
  provenance?: string;       // "from {widgetTitle}" — only ever passed when variant === "panel"; caller resolves/omits
};
```

- `variant === "topbar"` renders the **exact existing JSX subtree** from lines 994-1004 / 1008-1018 / 1077-1087, verbatim, moved into the component (do not rewrite it — copy-paste into the new component body so there is zero risk of a stray wrapper element breaking parity). `provenance` is ignored/unused in this branch.
- `variant === "panel"` renders the new `.filter-panel-chip` → `.filter-panel-chip-row` (`.filter-panel-chip-value` with `title={text}` + the same dismiss button, now styled by `.filter-bar-chip-dismiss` which the UI-SPEC confirms "works in row or column parents") → optional `.filter-panel-chip-provenance` line.

**Regression proof (concrete, no new test infra needed):** `DashboardsPage.spec.tsx` already asserts on `.filter-bar-chip` / `.filter-bar-chip-dismiss` class membership and exact aria-labels in ~6 existing tests (lines 469-475, 666-673, 734). **Run this spec file completely unmodified after the refactor** — 100% green on the existing assertions IS the byte-identical proof; do not edit these assertions to "make them pass" (if any existing assertion needs to change, parity has been broken). Additionally add one new lightweight snapshot-style assertion in the new `FilterChip.spec.tsx`: render `variant="topbar"` and assert the outer element's `className === "filter-bar-chip"` exactly (not `.toContain`, exact match) to lock the wrapper shape going forward.

### Provenance resolution (FPANEL-V120-08)

```tsx
const resolveProvenance = (sourceWidgetId: number | undefined, widgets: WidgetDto[]): string | undefined => {
  if (sourceWidgetId === undefined) return undefined;
  const w = widgets.find((w) => w.id === sourceWidgetId);
  return w ? `from ${w.title}` : undefined;   // literal template locked by CONTEXT.md
};
```

`widgets` is already in scope in `DashboardOpen` (state at line 410, same array the grid renders from) — no new fetch, no new store. This is a pure function, trivially unit-testable in isolation without React. Spatial shapes never pass a `sourceWidgetId` (the `Shape` type has no such field), so spatial chips in the panel simply never render a provenance line — this is a natural consequence of the data model, not a fallback branch that needs special-casing.

### Collapse-state persistence (localStorage)

Mirror `App.tsx`'s existing pattern exactly (lines 39, 45-51, 60-64 — `SIDEBAR_COLLAPSED_KEY = "kbi_sidebarCollapsed"`, try/catch read on init, try/catch write on change, default value when absent). This app has **no per-browser-user namespacing anywhere** — `localStorage` is inherently per-browser-profile, which already satisfies "per-user" without embedding a user id. Per-dashboard scoping just needs the dashboard id in the key:

```tsx
const collapsedKey = `kbi_filterPanelCollapsed_${dashboard.id}`;
const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => {
  try {
    const stored = localStorage.getItem(collapsedKey);
    if (stored !== null) return stored === "true";
  } catch { /* ignore */ }
  // No stored preference yet — fall back to the narrow-viewport auto-collapse default (see below).
  return isNarrowViewport();
});

useEffect(() => {
  try { localStorage.setItem(collapsedKey, String(panelCollapsed)); } catch { /* ignore */ }
}, [collapsedKey, panelCollapsed]);
```

**Narrow-viewport auto-collapse** needs a `matchMedia`/width check at initial-state time (CSS media queries alone cannot drive JS state — UI-SPEC is explicit about this). `window.matchMedia` is **not stubbed anywhere in `test/setup.ts`** and is `undefined` by default in jsdom for tests that don't stub it — any new spec exercising this path must add `vi.stubGlobal("matchMedia", ...)`, mirroring the existing `vi.stubGlobal("ResizeObserver", ...)` pattern already present in `DashboardsPage.spec.tsx:15`. Guard the read with try/catch or a feature check (`typeof window.matchMedia === "function"`) so the component doesn't throw in any environment where it's absent.

### Count badge

```tsx
const activeFilterCount =
  Object.values(allStoreFilters).reduce((n, arr) => n + arr.length, 0) +
  Object.values(allDvFilters).reduce((n, arr) => n + arr.length, 0) +
  shapes.length;
```

Compute this once in `DashboardOpen` (reusing the SAME subscriptions the top bar already holds — `allStoreFilters`, `allDvFilters`, `shapes`) and pass it as a prop to both `FilterPanel` (for its own internal empty-state check) and `FilterPanelRail` (for the badge number). Do not duplicate the store subscriptions inside the new components — pass the already-computed count/data down as props from `DashboardOpen`, which already owns every source-of-truth subscription needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Chip label text for eq/in/between/datetime | A new formatter | `buildChipText` (`lib/columnTypes.ts:200`) | Already handles all four variants correctly; a fresh formatter would diverge from the top bar (Pitfall 1 class of bug) |
| Grid reflow math | Manual width subtraction passed to `ResponsiveGridLayout` | Flex-sibling + `useContainerWidth`'s existing `ResizeObserver` | Already free — confirmed in `react-grid-layout@2.2.2`'s installed `dist/chunk-QGXQSZII.js` |
| "Which widgets does this filter affect" reverse-mapping | Anything | Nothing — **out of scope this phase** (Phase 108's `resolveWidgetsForFilter`) | Provenance here is a trivial 1-hop `sourceWidgetId → widgets.find` lookup, not a reverse-map; do not import or anticipate Phase 108's lib |
| Sidebar-style collapse chrome | New icon-button CSS | `.sidebar-toggle` (28×28, border, hover→accent) — UI-SPEC explicitly reuses it for BOTH the rail expand button and the panel-header collapse button | Zero new CSS needed for these two buttons |

**Key insight:** almost nothing in this phase is genuinely new logic — it is disciplined *reuse* of `buildChipText`, the existing remove/clear store actions, the existing `.sidebar`-collapse CSS recipe, and the existing `ResizeObserver`-driven grid. The only new logic is the grouping assembly (three collections instead of one interleaved loop) and the localStorage/matchMedia collapse-state wiring.

## Common Pitfalls

(Filtered from `.planning/research/PITFALLS.md` to the ones live in THIS phase's scope — the reverse-map/highlight/clear-all pitfalls in that doc belong to Phases 108/109 and are noted only where they create a boundary risk.)

### Pitfall: Dual source-of-truth drift (PITFALLS.md #1)
**What goes wrong:** Panel reads `filterCombinationStore` (the derived view-name registry) instead of `filterStore`/`spatialFilterStore` for its chip list.
**How to avoid:** The panel's chip list is built from the exact same three sources the top bar already reads (`allStoreFilters`, `allDvFilters`, `shapes`), passed down as props/subscriptions from `DashboardOpen` — never a new derived list.
**Warning sign:** grep finds `FilterPanel`/`FilterPanelRail` importing `useFilterCombinationStore`.

### Pitfall: Grid reflow thrash or no-reflow (PITFALLS.md #3)
**What goes wrong:** Panel rendered as `position:fixed`/absolute inside `containerRef` (no measured shrink) OR an animated width transition fires `ResizeObserver` every frame.
**How to avoid:** Flex-sibling wrapper exactly as coded above; discrete conditional render for collapse⇄expand, never a CSS width transition on `.filter-panel`/`.filter-panel-rail`.
**Warning sign:** rightmost widget clipped with panel open; visible slide/stutter; DevTools shows repeated layout recompute during a "collapse" click.

### Pitfall: Silent invented CSS class (PITFALLS.md #6 / CLAUDE.md hard rule)
**What goes wrong:** A `.filter-panel-*` class is referenced in TSX before it's added to `global.css` (or is subtly misspelled) — passes `tsc`, `vitest`, AND `theme-guard` and ships visibly unstyled.
**How to avoid:** Every class in the UI-SPEC's "ADD to global.css" table must be added to `global.css` in the SAME commit as its first TSX usage. Grep-confirm each class name exists before considering the plan/wave done: `grep -c "\.filter-panel-chip " src/styles/global.css` etc. for every new class.
**Warning sign:** panel renders with default browser button/box chrome.

### Pitfall: Backward-compat break / both surfaces render (PITFALLS.md #8)
**What goes wrong:** `dashboard.filter_display_mode` absent/`"topbar"` still mounts the panel (additively), or the wrapping refactor accidentally adds a className/wrapper div to the `containerRef` div even in topbar mode.
**How to avoid:** The `isPanelMode` ternary must be the ONLY new conditional; topbar mode's `gridBlock` render path must be textually identical to pre-Phase-107 code (no wrapper, no className). Lock with an explicit test: open a dashboard with `filter_display_mode: "topbar"` and assert `document.querySelector(".filter-panel-layout")` is null AND the existing `.filter-bar` assertions all still pass.
**Warning sign:** two "Clear all" buttons or two chip rows visible simultaneously.

### Pitfall: Theme-guard blind spot — rgba()/wrong tokens (PITFALLS.md #7)
**What goes wrong:** A translucent scrim/overlay for the narrow-viewport panel uses `rgba(...)` instead of `color-mix(in srgb, var(--token) X%, transparent)`.
**How to avoid:** UI-SPEC already locks this — the narrow-viewport `.filter-panel` override uses `background: var(--panel-solid)` (solid token, no mix needed) and `box-shadow: var(--shadow-lg)`; no raw `rgba(` anywhere in the new ruleset. Copy the UI-SPEC's media-query block verbatim; do not "improve" it with a custom scrim.
**Warning sign:** `grep -n "rgba(" global.css` finds a hit inside a `.filter-panel*` rule.

### New pitfall specific to this phase: grouping-shape mismatch
**What goes wrong:** Reusing the top bar's per-table loop wholesale for the panel (spatial chips embedded per-table) instead of pulling spatial into its own trailing group — silently violates the CONTEXT-locked "tables → dynamic views → spatial" order and duplicates spatial chips across multiple table groups.
**How to avoid:** Build three explicit collections (table groups / dv groups / one spatial group) as described in Architecture Patterns above; do not literally lift the existing IIFE.
**Warning sign:** a spatial chip with 2 table targets appears inside 2 different `.filter-panel-group` sections instead of once in a dedicated "spatial" section.

## Code Examples

### Existing top-bar chip JSX to extract verbatim (topbar variant of `FilterChip`)
```tsx
// Source: packages/web/src/components/DashboardsPage.tsx:994-1004 (current, unmodified)
<span className="filter-bar-chip">
  {buildChipText(f.column, f.value, f.dataType, f.operator)}
  <button
    type="button"
    className="filter-bar-chip-dismiss"
    aria-label={`Remove filter ${f.column}`}
    onClick={() => useFilterStore.getState().removeFilter(tableId, f.column)}
  >
    <FontAwesomeIcon icon={faXmark} />
  </button>
</span>
```

### Panel chip ruleset already fully specified — copy verbatim into global.css
```css
/* Source: 107-UI-SPEC.md "Class Manifest" table — copy these rows into global.css
   BEFORE first TSX use of each class name. */
.filter-panel-chip {
  display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  color: var(--accent-text);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: var(--text-xs);
}
```

### App.tsx's localStorage pattern to mirror
```tsx
// Source: packages/web/src/App.tsx:39,45-51,60-64
const SIDEBAR_COLLAPSED_KEY = "kbi_sidebarCollapsed";
const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; }
  catch { return false; }
});
useEffect(() => {
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed)); }
  catch { /* ignore quota / private-mode errors */ }
}, [sidebarCollapsed]);
```

## State of the Art

Not applicable — this phase makes no framework/library version changes and introduces no deprecated-vs-current-approach distinction. `react-grid-layout@2.2.2`'s `useContainerWidth` (ResizeObserver-based) is already the current approach in this codebase; nothing to migrate.

## Open Questions

1. **Does the panel represent the static persisted `views[].filter_clause` WHERE text anywhere?**
   - What we know: the top bar shows it as muted read-only `.filter-bar-clause` text inside the per-table row (`DashboardsPage.tsx:987-989`). PITFALLS.md's general research (pre-UI-SPEC) flags omitting it as a pitfall ("Pitfall 10").
   - What's unclear: REQUIREMENTS.md's FPANEL-V120-02 enumerates only eq/in/between/spatial as the covered filter set (no mention of static WHERE), and the LOCKED 107-UI-SPEC's Class Manifest has no `.filter-panel-*` analog for `.filter-bar-clause`.
   - Recommendation: treat static WHERE as explicitly OUT OF SCOPE for the panel's chip set in Phase 107 (top bar retains exclusive display) unless the planner gets an explicit confirmation otherwise — this is a minor functional gap (a table with ONLY a static clause and no drill filters would show as "empty" in the panel today) but matches the letter of both REQUIREMENTS.md and the UI-SPEC as written. Flag as a one-line note in the plan for visibility.

2. **Precedence between the localStorage collapse preference and the narrow-viewport auto-collapse default.**
   - What we know: CONTEXT.md locks default-expanded on wide screens and auto-collapse below the breakpoint; UI-SPEC's Interaction Contract calls narrow-auto-collapse "on load" behavior.
   - What's unclear: if a user previously expanded the panel on a wide screen (localStorage says `false`/expanded), then resizes/reopens on a narrow screen, should the stored preference win (expanded-but-overlaying) or should the narrow breakpoint force collapsed regardless of stored state?
   - Recommendation: stored preference wins if present (mirrors `sidebarCollapsed`'s unconditional trust-the-stored-value pattern); the `matchMedia` narrow-check only supplies the INITIAL default when no stored value exists yet for that `dashboard.id`. Lock this explicitly in the plan so the executor doesn't have to guess.

3. **Orphan-shape visibility in the panel's spatial group.**
   - What we know: today's top bar hides spatial chips entirely when no map widget has an eligible target for any table (`tableIdsWithSpatialChips` gate, regression-tested at `DashboardsPage.spec.tsx:478-493`).
   - What's unclear: CONTEXT.md's panel spatial group is described at the dashboard level ("spatial draws" as one section), not per-table — should the whole spatial group be hidden dashboard-wide when `targetsByTable.size === 0`, matching today's orphan-hiding semantics but at a coarser grain?
   - Recommendation: yes — gate the single spatial group's visibility on `targetsByTable.size > 0` (i.e., at least one eligible target exists ANYWHERE on the dashboard), preserving the existing regression test's *intent* (don't show spatial chips nobody can act on) even though the grouping grain changed.

4. **Existing `DashboardsPage.spec.tsx` dashboard mock fixtures do not set `filter_display_mode`.**
   - What we know: `DashboardDto.filter_display_mode` is a required (non-optional) field on the wire type (`api/client.ts:329`), but several `describe` blocks' local `const dashboard = {...}` literals (e.g. line 391-396) omit it entirely, relying on loose mock typing.
   - What's unclear: whether `tsc --noEmit` currently passes with these omissions (it apparently does, since Phase 106 shipped complete) — likely because `listDashboards` is a `vi.fn()` whose `mockResolvedValue` argument isn't strictly checked against `DashboardDto[]`.
   - Recommendation: leave existing fixtures untouched (they implicitly exercise the `topbar` default via `undefined`/absent, which is arguably a GOOD implicit backward-compat test) but any NEW test written for Phase 107 must explicitly set `filter_display_mode: "topbar"` or `"panel"` on its dashboard fixture — don't rely on the field being absent to mean topbar in new tests, since that conflates "old fixture predates the field" with "explicit backward-compat assertion."

## Suggested Plan Split

**Recommend 2 plans, sequential (not parallel-safe — B imports A's component):**

**Plan A — Shared `FilterChip` + top-bar parity**
- Extract `FilterChip.tsx` (topbar + panel variants, per Architecture Patterns above).
- Refactor the top bar's 3 chip-render call sites (column chips ×2 locations + dv chips ×1) to use `<FilterChip variant="topbar" ... />`.
- Add the provenance-resolution pure helper (`resolveProvenance`) + its unit tests (no React needed).
- Add `.filter-panel-chip`/`.filter-panel-chip-row`/`.filter-panel-chip-value`/`.filter-panel-chip-provenance` to `global.css` (used by Plan B, harmless to add early since unreferenced classes don't render anything).
- **Regression gate:** run `DashboardsPage.spec.tsx` unmodified — must stay 100% green. Add the new `FilterChip.spec.tsx` exact-className lock test.
- Zero DOM/behavior change to the shipped top bar.

**Plan B — Panel shell + rail + reflow + XOR + grouping + empty state + badge**
- `FilterPanel.tsx` / `FilterPanelRail.tsx` (new components, consume `FilterChip` from Plan A).
- `DashboardsPage.tsx`: `isPanelMode` branch, `gridBlock` extraction, `.filter-panel-layout`/`.filter-panel-grid-wrap` wiring, localStorage collapse-state, `matchMedia` narrow-viewport default, `activeFilterCount` computation, three-collection grouping assembly.
- `global.css`: `--filter-panel-width`/`--filter-panel-rail-width` tokens + `.filter-panel-layout`/`.filter-panel-grid-wrap`/`.filter-panel`/`.filter-panel-header*`/`.filter-panel-body`/`.filter-panel-rail*`/`.filter-panel-empty`/`.filter-panel-group*` classes + the narrow-viewport media query.
- Backward-compat spec: topbar-mode dashboard renders zero panel DOM, existing filter-bar assertions all still pass.
- New specs: XOR (topbar dashboard never shows panel; panel dashboard never shows top bar), per-group clear parity (dismiss same chip in top bar vs panel mode across two separately-rendered dashboards, assert identical store mutation), empty state, count badge, collapse persistence round-trip (mock localStorage), narrow-viewport default (mock `matchMedia`).

**Dependency:** Plan A must merge before Plan B starts (Plan B's `FilterPanel` imports `FilterChip`). This mirrors ARCHITECTURE.md's own suggested build order ("extract the chip-assembly builder first, before any panel-specific rendering").

## Test Strategy

- **jsdom-testable (automated gates):** DOM structure per mode (`.filter-panel-layout` present/absent), chip text content (`buildChipText` output, spatial `label (measurement)` string), remove/clear button click → store mutation (exactly like existing spec patterns at `DashboardsPage.spec.tsx:495-514`), empty-state text, badge count number, localStorage round-trip (jsdom's `localStorage` works natively — same pattern as `store/theme.spec.ts`), grouping order (assert group titles appear in DOM order tables-then-dv-then-spatial via `within(container).getAllByRole` ordering or `container.querySelectorAll` index comparison).
- **Needs new stubs:** `window.matchMedia` is not currently stubbed anywhere — any spec exercising the narrow-viewport default must `vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })))`, mirroring the existing `ResizeObserver` stub already present at `DashboardsPage.spec.tsx:15`.
- **Not meaningfully testable in jsdom (flag for manual verification per CLAUDE.md/CONTEXT.md's own test-gate notes):** actual pixel-level grid reflow (the existing `ResizeObserver` stub in `DashboardsPage.spec.tsx` is a no-op — it never fires real resize callbacks with real dimensions, so "the grid visibly shrinks by 300px" cannot be asserted in jsdom, only "the correct classNames/flex CSS properties are present" can be). CSS-class-exists-in-`global.css` should get a lightweight string-presence spec (mirrors PITFALLS.md #6's recommended mitigation) but does NOT prove correct visual rendering — light/dark theme + narrow-viewport visual correctness is explicitly a manual-verification item per 107-CONTEXT.md's own "Test / gate notes" section, deferred to the milestone's Phase 110 live UAT.
- **recharts/OL caveats:** not directly relevant to this phase (no chart/map rendering changes), but the existing `DashboardsPage.spec.tsx` already globally stubs `ResizeObserver` and mocks OL/map modules before import (lines 14-22) — any new test file that imports `DashboardsPage` transitively must be aware these stubs exist at the top of that spec file; a NEW standalone `FilterPanel.spec.tsx` that does NOT render map widgets does not need the OL mocks, only the `ResizeObserver`/`matchMedia` stubs if it touches the grid-wrap DOM at all.

## Scope Creep Risks (explicit guardrails for the planner/executor)

- **Do NOT build the "applies-to" list or on-canvas hover/click highlight.** `.filter-panel-chip` must not grow a hover handler or highlight-store import in this phase — that's Phase 108's `filterHighlightStore` + `resolveWidgetsForFilter`. Provenance here is a static 1-hop lookup, not a reverse-map.
- **Do NOT add a global "clear all dashboard filters" button.** `.filter-panel-header-actions` must render EMPTY in this phase (UI-SPEC explicitly reserves it, unstyled-but-present, for Phase 109). Per-group clear only.
- **Do NOT build the designer mode-toggle UI.** This phase only READS `dashboard.filter_display_mode` — no settings page, no PATCH call, no new UI control that writes it. That's Phase 110.
- **Do NOT import Phase 108's `resolveWidgetsForFilter` lib** even though Phase 105 (reverse-mapping) is already complete per STATE.md — it is not needed for provenance (a direct `sourceWidgetId → widgets.find` lookup suffices) and importing it prematurely couples this phase to Phase 108's not-yet-built consumption pattern.

## Regression Risk to the Existing Top Bar

- **CSS:** the extraction must ONLY ADD new `.filter-panel-*` rules to `global.css`; it must not touch a single existing `.filter-bar-*`/`.sidebar*`/`.config-group*` ruleset. Diff-review `global.css` changes for this phase should show zero modified lines in the pre-existing `.filter-bar-*` block (`global.css:1345-1455`).
- **JSX:** `FilterChip`'s `variant="topbar"` branch must be a literal copy-paste of the existing inline JSX (not a "cleaned up" rewrite) to avoid any incidental wrapper-element or prop-spreading difference that could still pass the existing `.closest(".filter-bar-chip")`/`.toContain(...)` assertions while subtly altering layout (e.g., an extra `<div>` between the chip and its parent flex container would not fail any existing assertion but would change flex-wrap behavior).
- **Existing spec suite:** `DashboardsPage.spec.tsx` (~40+ tests spanning multiple `describe` blocks across the file) must remain 100% green, UNMODIFIED, as the primary parity proof — treat any need to edit an existing assertion as a signal that parity has broken, not that the test needs updating.

## Sources

### Primary (HIGH confidence — read directly from the live codebase)
- `packages/web/src/components/DashboardsPage.tsx` — lines 395-410 (props/state), 460-560 (cleanup chain, unaffected by this phase), 584-606 (filter/spatial subscriptions), 923-1102 (top-bar render, exact JSX), 1104-1215 (grid wiring, `containerRef`/`ResponsiveGridLayout`).
- `packages/web/src/components/DashboardsPage.spec.tsx` — lines 14-22 (existing `ResizeObserver`/OL stubs), 380-540 (existing chip/clear-all regression assertions to preserve unmodified).
- `packages/web/src/styles/global.css` — lines 96 (`--sidebar-width-fixed` token pattern), 210-273 (`.sidebar`/`.sidebar-toggle`/900px media query pattern), 1222-1236 (`.config-group`/`.config-group-label`), 1345-1455 (`.filter-bar-*` full existing ruleset).
- `packages/web/src/lib/columnTypes.ts` — lines 200-237 (`buildChipText` full implementation, all 4 operator branches).
- `packages/web/src/api/client.ts` — lines 323-356 (`DashboardDto.filter_display_mode`, already required non-optional post-Phase-106; `updateDashboard` signature).
- `packages/web/src/store/filterStore.ts` — lines 17-40 (`ActiveFilter` type incl. `sourceWidgetId?: number`).
- `packages/web/src/store/spatialFilterStore.ts` — lines 33-46 (`Shape` type, confirms NO `sourceWidgetId` field).
- `packages/web/src/App.tsx` — lines 39-65 (`SIDEBAR_COLLAPSED_KEY` localStorage pattern to mirror).
- `packages/web/src/test/setup.ts` — full file (confirms no global `ResizeObserver`/`matchMedia` stub exists; per-spec-file stubbing is the established pattern).
- `.planning/phases/107-panel-shell-reflow-xor-switch-chips/107-CONTEXT.md`, `107-UI-SPEC.md` — locked decisions + exact class/token/copy contract (verbatim source for all new-class rulesets quoted above).
- `.planning/REQUIREMENTS.md` — FPANEL-V120-01..09 exact wording.
- `.planning/STATE.md` — v1.20 phase map/dependency spine, confirms Phases 105+106 complete, config.json `nyquist_validation: false`.

### Secondary (MEDIUM confidence — prior milestone research, partially superseded by the now-LOCKED UI-SPEC)
- `.planning/research/ARCHITECTURE.md` (2026-07-08) — reflow mechanics (flex-sibling, `ResizeObserver` confirmed against installed `react-grid-layout@2.2.2`), suggested build order (chip-builder-before-panel).
- `.planning/research/PITFALLS.md` (2026-07-08) — pitfalls #1, #3, #6, #7, #8 directly applicable to this phase; pitfalls #2/#4/#5/#10 belong to Phases 108/109 (noted as boundary risks only); pitfall #10's "represent static WHERE" recommendation is now superseded by the narrower REQUIREMENTS/UI-SPEC scope — flagged as Open Question 1 rather than treated as settled.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; every API already in use in this exact file.
- Architecture: HIGH — exact line numbers read directly; UI-SPEC has already locked every new class/token.
- Pitfalls: HIGH — sourced from live codebase + prior milestone pitfalls research + this phase's own CONTEXT/UI-SPEC locks.
- Open questions (static-WHERE scope, collapse-precedence, orphan-shape grouping grain): MEDIUM — reasoned recommendations given, but not explicitly re-confirmed with the operator; flag in plan for a quick sanity check if the executor hits ambiguity.

**Research date:** 2026-07-09
**Valid until:** stable — this is an internal-codebase refactor with zero external dependencies; valid until the codebase itself changes (i.e., effectively for the lifetime of this phase's execution window).
