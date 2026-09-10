# Stack Research

**Domain:** BI Dashboard — interactive drill-down, cross-filtering, chart polish, schema discovery, state persistence
**Researched:** 2026-04-02
**Confidence:** MEDIUM-HIGH (versions confirmed from installed node_modules and npm outdated; external docs blocked)

---

## Context: This Is a Subsequent Milestone

The existing stack is already deployed and working. This research is NOT about choosing a greenfield stack — it is about what to ADD or UPGRADE to implement:

1. Interactive drill-down (click chart element → filter dashboard)
2. Cross-chart filter coordination (shared filter context)
3. Polished chart rendering with real data
4. Dashboard state persistence (save/share filter state)
5. Schema/table browser for column discovery

The core constraint: **do not rewrite what works**. Additions must compose cleanly with the existing React 18 + Zustand + Recharts + Express + SQLite foundation.

---

## Current Stack (Installed, Verified from node_modules)

| Package | Installed | Latest (as of research) | Gap |
|---------|-----------|------------------------|-----|
| react | 18.3.1 | 19.2.4 | Major — do not upgrade |
| recharts | 2.15.4 | 3.8.1 | Major — evaluate |
| zustand | 4.5.7 | 5.0.12 | Major — do not upgrade yet |
| react-grid-layout | 2.2.2 | 2.2.3 | Minor — safe to patch |
| vite | 5.4.21 | 8.0.3 | Major — do not upgrade |
| typescript | 5.9.3 | 6.0.2 | Major — do not upgrade |
| express | 4.22.1 | (current 4.x) | None |
| better-sqlite3 | 12.8.0 | (current) | None |
| clsx | 2.1.1 | (current) | None |

**Upgrade verdict:** Do not upgrade React, Zustand, Vite, or TypeScript during this milestone. Each is a major-version jump that introduces breaking changes. Stay on current installed versions. Only patch react-grid-layout (2.2.2 → 2.2.3) opportunistically.

---

## Recommended Stack for This Milestone

### Core Technologies (Keep As-Is)

| Technology | Version | Purpose | Why Keep |
|------------|---------|---------|----------|
| React | 18.3.1 | UI framework | React 19 breaks some Recharts patterns; defer |
| TypeScript | 5.9.3 | Type safety | TS 6 has breaking changes; defer |
| Vite | 5.4.21 | Build tool | Vite 8 is a major jump; not a milestone blocker |
| Zustand | 4.5.7 | State management | v5 has a new API surface; not worth migrating mid-milestone |
| Recharts | 2.15.4 | Charting | See section below |
| Express | 4.22.1 | API server | No reason to change |
| better-sqlite3 | 12.8.0 | Dashboard persistence | Synchronous, zero-config, correct for single-team use |

### Charting: Stay on Recharts 2.x, Do Not Upgrade to 3.x

**Decision: Recharts 2.15.4 (current installed). Do not upgrade to 3.x during this milestone.**

Rationale:

- Recharts 3.x (released ~2025) restructured the component API. `ResponsiveContainer` behavior changed, and several event handler signatures shifted. Upgrading mid-milestone introduces churn with no functional gain for the features being built.
- The existing `WidgetRenderer.tsx` already uses 8 chart type renderers correctly against 2.x. All the charts work.
- Recharts 2.x has `onClick` on every chart component (`BarChart`, `PieChart`, `LineChart`, `ScatterChart`). This is the exact API needed for drill-down: `<BarChart onClick={(data) => handleDrillDown(data)}>`. This is stable in 2.x.
- The `activeIndex` / `Cell` highlighting pattern for "selected bar" visual feedback is mature in 2.x.

**What Recharts 2.x gives for drill-down (HIGH confidence — read from installed source):**
- `BarChart onClick` receives `{ activePayload: [{payload: rowObject}], activeLabel: string }` 
- `PieChart` `onClick` on `<Pie>` receives `(data, index)` where `data` is the slice object
- `ScatterChart onClick` receives the point object
- `<Cell fill={isSelected ? highlightColor : normalColor}>` enables visual selection state
- `<Tooltip active={...} payload={...}>` can be controlled to show filter state

### State Management: Extend Zustand with a Dashboard Filter Store

**Decision: Add a second Zustand store (`useDashboardStore`) for cross-filter state. Do not use React Context.**

The existing `useUserStore` in `src/store/user.ts` demonstrates the pattern. Add a parallel store:

```typescript
// src/store/dashboard.ts
type FilterValue = string | number | boolean;

type ActiveFilter = {
  column: string;
  value: FilterValue;
  label: string; // human-readable, for the filter bar
  sourceWidgetId: number; // which widget set this filter
};

type DashboardState = {
  activeDashboardId: number | null;
  filters: ActiveFilter[]; // flat list; multiple filters AND'd together
  setFilter: (filter: ActiveFilter) => void;
  removeFilter: (column: string) => void;
  clearFilters: () => void;
  setActiveDashboard: (id: number | null) => void;
};
```

**Why Zustand over React Context for cross-filtering:**
- Context re-renders the entire subtree on every filter change. With 6-10 widgets each running SQL queries, this causes a cascade of unnecessary re-renders and re-fetches.
- Zustand uses shallow equality and selector subscriptions. Each `WidgetRenderer` subscribes only to the filter slice it cares about, so an unrelated filter change does not re-render it.
- The existing codebase already uses Zustand — no new dependency, consistent pattern.
- Zustand's `subscribeWithSelector` middleware (already available in v4) enables per-component fine-grained subscription.

**Why not Redux / Redux Toolkit:**
Overkill for this scope. Adds ~40KB, requires boilerplate (actions, reducers, slices), and the team has no existing Redux infrastructure to extend.

**Why not React Query / TanStack Query for data fetching:**
The current pattern (`useEffect` + `runSql`) is adequate for this scale. Introducing TanStack Query mid-milestone to manage SQL caching is a large refactor with marginal benefit for a team-internal tool. Flag for a future milestone if query deduplication or background refresh becomes needed.

### Dashboard State Persistence: URL + SQLite

**Decision: Dual-layer persistence — URL search params for transient filter state, SQLite for saved named states.**

Layer 1 — URL search params for active filter state:
- Encode active filters as `?filters=base64(JSON)` in the URL
- Users can share a URL and the recipient sees the same filtered view
- Zero new dependencies — use `URLSearchParams` natively
- On mount, parse URL params and hydrate Zustand filter store

Layer 2 — SQLite backend for "saved views":
- Add a `dashboard_saved_states` table: `id, dashboard_id, name, filter_json, created_at`
- One new Express endpoint: `POST /api/dashboards/:id/states`, `GET /api/dashboards/:id/states`, `DELETE /api/states/:id`
- Users can name and save a filter configuration, then restore it later
- No new backend dependency — better-sqlite3 already handles this

**Why not localStorage:**
- Filters are per-dashboard, not per-device. URL params achieve sharing without user accounts.
- localStorage silently fails in private browsing; URL is universally reliable.

**Why not a separate state management database:**
- SQLite is already the persistence layer. Using it for saved states is consistent and adds no ops burden.

### Schema Discovery: No New Library Needed

The backend already exposes `GET /api/kinetica/schemas`, `GET /api/kinetica/schemas/:schema/tables`, and `GET /api/kinetica/schemas/:schema/tables/:table/columns`. The frontend API client already has `fetchKineticaSchemas`, `fetchKineticaTables`, and `fetchKineticaColumns`.

**What is missing is a UI component** — a tree-style schema browser. Build this using:
- React local state (`useState`) for expand/collapse per schema/table node
- `clsx` (already installed) for active/hover states
- No virtual scrolling library needed — Kinetica schema hierarchies are small (dozens of tables, hundreds of columns at most)

If column lists grow large (500+ columns per table), add `@tanstack/react-virtual` for virtualized rendering. Defer until there is evidence of the need.

### Supporting Libraries to Add

| Library | Version to Install | Purpose | Why |
|---------|--------------------|---------|-----|
| `use-debounce` | ^10.0.0 | Debounce filter-driven SQL re-fetches | Without debouncing, each filter click triggers immediate SQL; at Kinetica's speed this is fine, but debouncing prevents double-fire on fast clicks. Tiny library, zero transitive deps. |
| `@tanstack/react-virtual` | ^3.x | Virtualized column list in schema browser | Only add if column lists exceed ~200 rows. Defer until needed. |

**Do not add:**
- D3 directly — Recharts wraps D3. Adding raw D3 alongside Recharts creates two rendering models for the same visual layer.
- Apache ECharts / `echarts-for-react` — requires replacing all existing renderers. Not justified for this milestone.
- Visx — low-level, high-effort, designed for custom visualization research. Not appropriate for a CRUD dashboard tool.
- MUI / Ant Design / shadcn/ui — introducing a component library now requires styling migration. The existing global CSS is bespoke. Adding a component library mid-project creates a two-system mess.

---

## Recommended Stack for This Milestone

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 18.3.1 | UI framework | Stable, Recharts 2.x compatible, no migration cost |
| TypeScript | 5.9.3 | Type safety | Installed, works with current Vite config |
| Vite | 5.4.21 | Build/dev server | Zero config changes needed |
| Recharts | 2.15.4 | Chart rendering | onClick events work; Cell highlighting works; defer 3.x migration |
| Zustand | 4.5.7 | Global filter state | Add `useDashboardStore` as second store; no upgrade needed |
| Express | 4.22.1 | REST API | Add saved states endpoints |
| better-sqlite3 | 12.8.0 | Persistence | Add `dashboard_saved_states` table |
| react-grid-layout | 2.2.3 | Widget grid | Patch-safe upgrade from 2.2.2 |
| clsx | 2.1.1 | CSS class composition | Schema browser active states |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `use-debounce` | ^10.0.0 | Debounce filter-triggered refetches | Add with drill-down implementation |
| `@tanstack/react-virtual` | ^3.11.x | Virtualize column lists | Only if >200 columns appear in schema browser |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Backend watch mode | Already installed; no change |
| `@types/better-sqlite3` | Type safety for DB layer | Already installed via server devDeps |

---

## Installation

```bash
# Frontend — add debounce utility
cd kinetica_bi
npm install use-debounce

# Patch react-grid-layout (minor — safe)
npm install react-grid-layout@2.2.3

# Backend — no new dependencies needed
# (better-sqlite3 already installed; new saved-states table is DDL only)
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Recharts 2.x (stay) | Recharts 3.x upgrade | After this milestone is stable; when a chart type genuinely requires 3.x API |
| Recharts 2.x (stay) | Apache ECharts | If heatmaps, geo maps, or large-dataset rendering (>10k points) become requirements |
| Zustand filter store | React Context | Never for this use case — Context causes cascade re-renders across all widgets |
| Zustand filter store | TanStack Query | Future milestone if query deduplication / stale-while-revalidate becomes needed |
| URL params + SQLite saved states | localStorage | If single-device, single-user with no sharing requirement |
| URL params + SQLite saved states | Redis / external cache | If multi-user / multi-server deployment (explicitly out of scope) |
| Native URLSearchParams | query-string library | Only if URL encoding complexity grows (nested filters, arrays) |
| Bespoke schema browser | react-arborist / react-complex-tree | If file-tree-style DnD or inline editing is needed in schema browser |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Recharts 3.x upgrade now | API surface changed; breaks existing 8 renderer components; no milestone-blocking feature requires it | Recharts 2.15.4 already installed |
| React 19 upgrade | react-grid-layout and some Recharts internals have known 19 compatibility issues; testing burden exceeds benefit | React 18.3.1 |
| Zustand 5.x upgrade | v5 changes `useStore` hook API; `create` is no longer default export; would require touching all existing store consumers | Zustand 4.5.7 |
| D3 directly | Recharts already wraps D3. Two rendering engines on the same layer creates z-index conflicts, SVG ownership issues, and animation fighting | Recharts event API (onClick, onMouseEnter) |
| Redux / Redux Toolkit | 40KB+ overhead; action/reducer boilerplate; no existing Redux infrastructure to extend | Zustand second store |
| MUI / Ant Design | Requires replacing bespoke CSS; creates dual styling system | Extend existing global.css with BEM-style additions |
| TanStack Query now | Large refactor for marginal gain at this scale; the team-internal usage doesn't stress current fetch pattern | useState + useEffect pattern already in place |
| React Query caching layer | Same as above | Direct fetch via runSql() |

---

## Stack Patterns by Variant

**For drill-down filter wiring:**
- Use Zustand `useDashboardStore` with `setFilter(column, value)`
- Each `WidgetRenderer` reads active filters via `useShallow` selector
- Append `WHERE column = value` to the widget's SQL before executing
- Because Kinetica SQL is built by the config panel, modify the SQL generation step (not the base SQL stored in config)

**For chart click events (Recharts 2.x pattern):**
- `BarChart onClick={(data) => data?.activePayload && onDrillDown(data.activePayload[0].payload)}`
- `Pie onClick={(data) => onDrillDown(data)}`
- Wrap each renderer in a `useCallback` for the handler to avoid anonymous function re-creation on each render

**For URL state serialization:**
- `filters → JSON.stringify → btoa` for encoding
- `atob → JSON.parse` for decoding on mount
- Guard against malformed params with try/catch; silently ignore corrupt URL state

**For saved filter states (backend DDL):**
```sql
CREATE TABLE IF NOT EXISTS dashboard_saved_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| recharts@2.15.4 | react@18.3.1 | Verified — existing app renders correctly |
| react-grid-layout@2.2.3 | react@18.3.1 | Minor patch; backward compatible |
| zustand@4.5.7 | react@18.3.1 | Verified — useUserStore already working |
| better-sqlite3@12.8.0 | Node 18+ | Requires native build; already installed and working |
| use-debounce@10.x | react@18.3.1 | Hooks-based; React 18 compatible (LOW confidence — unverified from official docs, but library is React hooks only with no breaking React-version constraints documented in 10.x) |

---

## Sources

- Installed node_modules inspection (`/kinetica_bi/node_modules/*/package.json`) — versions HIGH confidence
- `npm outdated --json` output — latest version comparison HIGH confidence
- Source code analysis (`WidgetRenderer.tsx`, `ChartConfigPanel.tsx`, `store/user.ts`, `api/client.ts`) — existing patterns HIGH confidence
- Recharts 2.x onClick API — MEDIUM confidence (derived from reading existing working code that uses the API; cannot verify against current official docs due to tool restrictions)
- Zustand v4 subscribeWithSelector middleware — MEDIUM confidence (part of v4 public API, documented in training data, consistent with installed version)
- URL search params pattern — HIGH confidence (web platform standard, no library dependency)
- SQLite saved states schema — HIGH confidence (follows existing schema patterns in the codebase)
- use-debounce v10 React 18 compatibility — LOW confidence (inferred from library's hooks-only design; verify before installation)

---

*Stack research for: Kinetica BI Dashboard — interactive drill-down milestone*
*Researched: 2026-04-02*
