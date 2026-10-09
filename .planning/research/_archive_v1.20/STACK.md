# Stack Research

**Domain:** v1.20 Filter Panel — a collapsible right-side dashboard filter panel for an existing React + Vite + zustand app (`packages/web`) with an Express/SQLite server (`packages/server`).
**Researched:** 2026-07-08
**Confidence:** HIGH (all findings verified by direct source inspection of the installed code + npm registry; no reliance on training data)

## Headline Recommendation

**Add ZERO new npm packages.** Every capability the filter panel needs is already present in the codebase's existing stack and its established conventions:

- **Collapsible panel** → reuse the proven left-`.sidebar` collapse pattern (CSS `width` transition + a boolean state). No drawer library.
- **Grid reflow on open/close** → already solved for free by the `useContainerWidth()` hook (react-grid-layout v2.2.2) which wraps the grid container in a `ResizeObserver`. No manual width math, no library.
- **On-canvas widget highlight** → plain CSS class toggle driven by a small session-only zustand store (the existing transient-UI-store convention). No highlight/floating-ui library.
- **Per-dashboard display-mode persistence** → one small, on-pattern server touch (add a JSON `config` column to `dashboards` via the existing PRAGMA-guarded ALTER migration). No new library.

The only decision that is genuinely a *stack* decision (vs. pure implementation) is the persistence one — see section (d).

## Recommended Stack

### Core Technologies (all EXISTING — reused, not added)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| react-grid-layout | 2.2.2 (installed; latest 2.2.3) | Dashboard grid + **automatic reflow** when the panel resizes the grid container | `useContainerWidth()` (already used at `DashboardsPage.tsx:487`) observes the container via `ResizeObserver` and updates `width` on every box-size change. A right panel that shrinks the container makes the grid reflow with no extra code. Verified in installed source `dist/chunk-QGXQSZII.js`. |
| zustand | 4.5.2 | Transient panel-open + highlighted-widget state; the active-filter read model | Already the app's state layer. Session-only stores (`infoSelectionStore`, `spatialFilterStore`, `widgetActionStore`) are the established pattern for transient UI state and are already reset on dashboard switch. |
| CSS custom-property tokens + `global.css` utility classes | n/a | Panel chrome, chips, collapse animation | The app has **no design system** by policy (`CLAUDE.md`). The left `.sidebar` already implements a collapsible panel via a `width` transition + `--sidebar-width` on `:root` (`global.css:204-206`). Reuse it; reuse `.filter-bar-chip*` classes for chip parity. |
| better-sqlite3 (server, existing) | as installed | Persist the per-dashboard `filterDisplayMode` | The `dashboards` table + its PATCH route already exist; only a column + allow-list entry are needed (see (d)). |
| @fortawesome/free-solid-svg-icons | existing | Collapse/expand chevron, chip dismiss | `faChevronDown`/`faChevronRight` already imported elsewhere (`LayersLegendPanel.tsx`); `faXmark` already used for chips. |

### Supporting Libraries

**None required.** No supporting library should be added for this milestone.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| vitest + @testing-library/react (existing) | Panel render, chip parity, highlight-toggle, mode-persistence tests | Web gate: 100% from `packages/web`. Add a mock for any new zustand store to affected specs (the codebase's recurring "new store breaks specs" gotcha). |
| theme-guard.spec.ts (existing) | Enforce theme-token-only styling | The highlight ring MUST use `var(--accent)` (or `color-mix`/`--on-accent`) — raw hex fails the guard, and `rgba()` overlays slip past it but still ship light-mode bugs (per project memory). |

## Installation

```bash
# Nothing to install. Zero new web deps, zero new server deps.
```

## The Four Questions — Answered

### (a) Do we need a resizable/collapsible drawer library? — NO

Build the collapsible panel with plain CSS + a boolean, mirroring the existing left sidebar:

- App-shell grid is `grid-template-columns: var(--sidebar-width, 260px) 1fr` (`global.css:206`); `App.tsx` writes the live `--sidebar-width` and `.sidebar` animates a `width` transition on collapse. Do the same on the right: either add a third grid track (`… 1fr var(--filter-panel-width)`) or make the panel a flex sibling inside the content area. Collapsed → width 0 (or a thin rail); expanded → fixed width.
- Panel-open state = a `useState` boolean or a tiny zustand slice.

**"Resizable" (drag-to-resize width) is NOT in the confirmed scope** (the locked decision says *collapsible*). Do not add `react-resizable-panels`. Note: `react-resizable` is *already present transitively* (via react-grid-layout; its CSS is imported at `DashboardsPage.tsx:72`), so *if* drag-resize is ever wanted it can be reused — but a fixed-width collapsible panel matching the sidebar is simpler and on-pattern. Recommend deferring/omitting resize.

### (b) Grid reflow when the right panel opens/closes — SOLVED, zero additions

`useContainerWidth()` (react-grid-layout v2.2.2, already destructured at `DashboardsPage.tsx:487` as `{ width, mounted, containerRef }`) installs a `ResizeObserver` on the container `<div ref={containerRef}>` (which wraps `<ResponsiveGridLayout width={width} …>` at line 1118-1132). The observer reads `entry.contentRect.width` and calls `setWidth` on **every** container size change (verified in installed `dist/chunk-QGXQSZII.js` — no debounce).

**Integration rule (the one thing that matters):** the panel must be a **layout sibling that shrinks the grid container's box** — a grid column or flex sibling — NOT a `position: fixed`/`absolute` overlay painted on top. If it shrinks the `1fr` content area, `offsetWidth`/`contentRect.width` drops, the observer fires, `width` updates, and the grid reflows automatically. A CSS `width` transition on the panel produces per-frame resize events; RGL reflows smoothly across them (cheap; revisit only if profiling shows jank).

### (c) On-canvas widget highlighting — CSS class toggle, no library

Each widget card already has stable DOM identity (`<div key={String(w.id)} className="widget-card">`, `DashboardsPage.tsx:1151`). Highlight = conditionally append a class that draws an accent ring (`outline`/`box-shadow` in `var(--accent)`).

Drive it with a **session-only zustand store** holding the currently-highlighted widget-id set (mirrors `infoSelectionStore`/`spatialFilterStore`): the panel writes on filter hover/click; widget cards subscribe with a per-id selector to avoid re-rendering every card. This is exactly the existing transient-UI-store convention and must be added to the dashboard-switch `reset()` chain in `DashboardsPage.tsx` (and `App.tsx` logout) like the other 11 stores. No highlight library, no floating-ui, no react-aria. Use `var(--accent)` for the ring (theme-guard).

### (d) Persisting the per-dashboard display-mode setting — one small on-pattern server touch

**The gap:** the `dashboards` table has **no config/JSON column today** — only `id, name, description, created_at, updated_at` (`server/src/db.ts:15-21`; `DashboardDto` at `client.ts:323-329`; `updateDashboard` PATCH allow-list is `name | description` only, `client.ts:343`). So the mode cannot be stored without a schema touch.

**Recommended:** add `config TEXT NOT NULL DEFAULT '{}'` to `dashboards` via the **existing PRAGMA-guarded `ALTER TABLE ADD COLUMN` migration block** in `db.ts` (the same mechanism already used for `sessions` and `dashboard_layers` migrations, `db.ts:302-352`), and store `{ "filterDisplayMode": "topbar" | "sidepanel" }` as a JSON blob. This mirrors the codebase's dominant persistence pattern — `widgets.config`, `brand_config.config_json`, `column_display_config` all store JSON-as-TEXT. Then extend `DashboardDto` + the PATCH allow-list to carry `config`. Fresh installs get it from `CREATE TABLE`; existing DBs get it from the guarded ALTER.

**Alternative:** a single scalar `filter_display_mode TEXT NOT NULL DEFAULT 'topbar'` column. Simplest possible, but a JSON `config` blob is more future-proof for later per-dashboard settings and matches the prevailing pattern — recommend the JSON `config` column unless the team wants the absolute minimum surface.

This is exactly the "small dashboard-config persistence touch (TBD at plan time)" the milestone already anticipates. No new dependency either way.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Plain CSS collapse (sidebar pattern) | `react-resizable-panels`, MUI `Drawer`, Radix/Headless UI Dialog/Drawer | Never here — all violate the no-design-system policy, add bundle weight, and duplicate the working sidebar pattern. |
| `useContainerWidth` ResizeObserver (built in) | Manual width recompute on toggle / `WidthProvider` HOC | Not needed; v2's hook already handles it. `WidthProvider` is the *legacy* v1 API and isn't what this project uses. |
| CSS class + session zustand store for highlight | floating-ui, react-aria, an overlay/portal highlight lib | Never — a class toggle on an element that already exists in the DOM is strictly simpler and on-pattern. |
| JSON `config` column on `dashboards` | New `dashboard_settings` table; or client-only `localStorage` | A separate table is overkill for one scalar. `localStorage` fails the requirement that *all viewers see the designer's choice* (it must be server-persisted per dashboard). |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any drawer/panel component library (MUI, Radix, Headless UI, react-resizable-panels) | No design system by policy; duplicates the existing sidebar collapse; adds deps + theme drift | Plain CSS `width` transition + boolean state, mirroring `.sidebar` |
| A `position: fixed`/overlay panel | Grid won't reflow — `useContainerWidth`'s ResizeObserver never sees a size change, so widgets hide *behind* the panel | A layout-sibling panel (grid column / flex sibling) that shrinks the RGL container |
| A highlight/positioning library | Widget cards already exist in the DOM with stable keys | Conditional CSS class using `var(--accent)` |
| `localStorage`/client-only persistence for the mode | Must be a per-dashboard, designer-set, all-viewers-see-it setting | Server-persisted JSON `config` column on `dashboards` |
| Raw hex or `rgba()` overlay for the highlight ring | `theme-guard` only catches raw hex; `rgba()` slips through but ships light-mode bugs (project memory) | `var(--accent)` / `color-mix(...)` / `--on-accent` tokens |

## Version Compatibility

| Package | Status | Notes |
|---------|--------|-------|
| react-grid-layout@2.2.2 | Current major line (latest 2.2.3, 2026-03-24) | v2 is the modern rewrite: named `ResponsiveGridLayout` export, `useContainerWidth` hook, `dragConfig`/`resizeConfig` props (NOT v1's `WidthProvider`/`isDraggable`/`draggableHandle`). No upgrade needed for this milestone. |
| zustand@4.5.2 | Fine as-is | New session store follows the existing v4 `create(...)` pattern; no v5 migration needed. |
| better-sqlite3 (server) | Fine as-is | JSON-as-TEXT column + PRAGMA-guarded ALTER is an established, no-dep pattern in `db.ts`. |

## Integration Points Summary (for roadmap)

1. **`DashboardsPage.tsx`** — render the panel as a layout sibling of the `containerRef` grid wrapper (so reflow works); read `filterDisplayMode` from the dashboard to switch top-bar vs. side-panel; reuse `.filter-bar-chip*` classes for chip parity; add a global clear-all that loops the existing per-table `clearFilters`/`clearDvFilters`/`removeShape` + combination `reset` calls already present in the file.
2. **New session zustand store** (highlighted widget ids) — add to the `reset()` chains in `DashboardsPage.tsx` unmount effect AND `App.tsx` logout (matches the existing 11-store convention).
3. **Server `db.ts`** — add `config TEXT DEFAULT '{}'` to `dashboards` (CREATE + PRAGMA-guarded ALTER).
4. **`client.ts`** — extend `DashboardDto` + `updateDashboard` PATCH allow-list with `config`.
5. **Filter→widget mapping** — read from the existing v1.18 `filterCombinationStore` / per-viz `filterSelection` allow-list; no new state model.

## Sources

- Installed source `node_modules/react-grid-layout/dist/chunk-QGXQSZII.js` (`useContainerWidth` + `ResizeObserver` impl) — HIGH (direct inspection)
- `packages/web/src/components/DashboardsPage.tsx` (grid wiring, chips, clear-all, store reset chain) — HIGH
- `packages/web/src/store/filterCombinationStore.ts` (active-filter read model) — HIGH
- `packages/web/src/styles/global.css` (sidebar collapse pattern, filter-bar chip classes, token vars) — HIGH
- `packages/server/src/db.ts` (dashboards schema + PRAGMA-guarded ALTER migration pattern) — HIGH
- `packages/web/src/api/client.ts` (`DashboardDto`, `updateDashboard` allow-list) — HIGH
- `CLAUDE.md` (no design system; theme-token policy) — HIGH
- npm registry `registry.npmjs.org/react-grid-layout` (latest 2.2.3, 2026-03-24; 2.2.2 2025-12-30) — HIGH

---
*Stack research for: v1.20 Filter Panel (collapsible right-side dashboard filter panel)*
*Researched: 2026-07-08*
