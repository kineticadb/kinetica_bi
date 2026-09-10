# Phase 9: Filter Foundation — Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Build headless infrastructure for cross-chart filter coordination:

- A new `useFilterStore` Zustand slice (transient, table-keyed) with `addFilter` / `removeFilter` / `clearFilters` actions and a `filterVersion` counter
- A SQL-safe filter-builder utility set (`escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`)
- An `injectWhereClause(baseSql, whereClause)` utility for splicing the active filter into chart SQL
- Subscription wiring in `AggregatedWidgetRenderer` so charts re-fetch on filter change with `AbortController` cancellation of in-flight requests

**No user-visible UI in Phase 9.** Phase 10 owns the interactive filter bar surface (rebuilds the existing display-only bar at `DashboardsPage.tsx:450-471` to read from this store). Phase 11 wires the map chart's WMS tile invalidation into this same subscription pattern.

Verified scope discipline: this phase ships zero React component changes that render UI. Success criteria are testable headless via vitest+RTL on a minimal harness component.

</domain>

<decisions>
## Implementation Decisions

### ActiveFilter type shape

```ts
type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: 'string' | 'number' | 'boolean' | 'datetime' | 'null';
  sourceWidgetId?: number;  // optional; programmatic adds (tests, internal calls) skip it
  addedAt: number;          // Date.now() at addFilter time
};
```

- **`dataType` is explicitly stored** (not derived from `typeof value`) so SQL formatting is type-aware: strings get quoted+escaped, numbers raw, booleans `TRUE`/`FALSE`, datetimes wrapped in Kinetica's `TIMESTAMP '...'` literal syntax, null → `IS NULL`.
- **`datetime` is a first-class type** in the union (not collapsed into `string`) so the planner can branch `buildEqualityFilter` cleanly. Confirm exact Kinetica TIMESTAMP literal format during the planner's spike or via `kineticaSql` test query.
- **`displayLabel` is COMPUTED at render time** (Phase 10), not stored. Keeps store data normalized; no risk of stale labels if column metadata changes upstream.
- **`sourceWidgetId` is optional**. Phase 10's DRILL-04 'selected element' highlight needs this — it's the lookup key from `(column, value)` back to the chart that fired the filter.
- **`addedAt` is stored**. Used for chronological chip ordering in the filter bar, debugging, and fault-isolation if the cap behavior is ever reconsidered.

### Filter store API surface

- `useFilterStore = create<FilterState>((set) => ({ ... }))` — mirror `useAuthStore`'s pattern from `src/store/auth.ts`. State + actions on the same object.
- `filters: Record<tableId: number, ActiveFilter[]>` — **table-keyed from day 1**. Never a flat array. (PITFALL C-04 lock — retrofit cost is very high.)
- `filterVersion: number` — increments on every mutation. Consumers subscribe to it as a primitive `useEffect` dep (PITFALL S-02 lock — empty-array reference stability bug otherwise).
- `addFilter(filter: ActiveFilter): void` — handles cap, dedupe, and same-column-replace logic internally (see Cap + dedupe behavior below).
- `removeFilter(tableId: number, column: string): void` — single-filter dismiss for the filter-bar `×` button (Phase 10).
- `clearFilters(tableId: number): void` — clears every filter on the given table. **No `clearAllFilters()` global API** — every clear is scoped to a table.
- `reset(): void` — internal-only reset to empty state. Called on dashboard unmount + on logout. NOT exposed as a user-action.

### Cap + dedupe behavior

- **Cap = 10 filters per table.** When `addFilter` is called and that table already has 10:
  - addFilter is a **no-op** (no state change, no `filterVersion` bump)
  - Show a toast (via existing `useToastStore`): `"Filter limit reached (10 per table). Clear some first."`
- **Exact duplicate match** (same `column` AND same `value`):
  - **Silent no-op**. No toast, no state change, no re-fetch.
  - Matches typical "click selected = stay selected" UX. User doesn't notice; no harm done.
- **Same column, different value** (last-click-wins, PITFALL D-05 lock):
  - Existing filter on that column is removed; new one added. Single transactional `set()` call.
  - **Silent replace** — no toast. The chip change in the filter bar IS the user feedback.

### Clear-all scope

- `clearFilters(tableId)` is the only clear API. Phase 10's "Clear all" button calls it for the source table.
- Example: dashboard has tables A, B, C. User clicks "Clear all" in A's filter section → only A's filters wipe. B and C are untouched.
- **No confirmation prompt.** Filters are transient and recoverable (re-click chart elements to recreate them). Confirmation friction is unwarranted.
- **No `clearAllFilters()` global API.** If a user wants to reset every table, they dismiss each one. Forces intentional, scoped clears.

### Cross-dashboard lifecycle

- **Reset on every dashboard mount/unmount**: `useFilterStore.getState().reset()` called in `DashboardsPage`'s `useEffect` cleanup (and/or on initial mount of a different dashboard). User goes A → B → A and finds A's filters cleared. Matches "transient" from the locked requirements.
- **Reset on logout**: subscribe to `useAuthStore` status changes; when `status === 'unauthenticated'`, call `reset()`. Reasoning: filters can encode sensitive selections (`customer_id = 12345`); shouldn't survive a session boundary on a shared computer.
- **Reset on full page reload** is automatic (transient state, no persistence layer — locked from requirements).
- Implementation: a small `useEffect` (or a Zustand `subscribe` call) in either `App.tsx` or a top-level provider component. Single hook; minimal surface.

### AbortController scope

- **Per-fetch in `useEffect` cleanup**, not per-table at the store level.
- Each `fetchFn` call inside `AggregatedWidgetRenderer` (driven by `useApiQuery` or directly) creates a fresh `AbortController`. The `useEffect` cleanup function calls `.abort()` on the predecessor before the next fetch fires.
- `runSql` in `src/api/client.ts` gains `signal?: AbortSignal` as an additive optional param (no breaking change). The `fetch()` call inside threads the signal; `AbortError` is caught and silenced (NOT routed to the typed-error chain) since it's an expected control-flow signal, not a real failure.
- **Pattern matches React idioms** and is testable via vitest's mock `fetch` + `AbortController` assertions.

### SQL-safe filter builder utility

Lives in a single module (suggested: `src/store/filters.ts` or `src/store/filterStore.ts` colocated with the store; planner picks).

- `escapeKineticaStringLiteral(s: string): string` — single source of truth for interpolating user-clicked values into SQL strings (PITFALL D-02 lock). Replaces `'` with `''` (SQL standard); rejects/escapes any other characters that can break Kinetica's parser per its docs.
- `buildEqualityFilter(filter: ActiveFilter): string` — branches on `dataType`:
  - `'null'` → `${column} IS NULL` (PITFALL D-03 lock — never `column = NULL`)
  - `'string'` → `${column} = '${escape(value)}'`
  - `'number'` → `${column} = ${value}`
  - `'boolean'` → `${column} = ${value ? 'TRUE' : 'FALSE'}` (Kinetica accepts both; planner confirms)
  - `'datetime'` → `${column} = TIMESTAMP '${value.toISOString()}'` (planner spike confirms exact Kinetica syntax)
- `buildWhereClause(filters: ActiveFilter[]): string` — joins with `' AND '`; empty array returns empty string.
- `injectWhereClause(baseSql: string, whereClause: string): string` — splices into baseSql:
  - If empty whereClause → return baseSql unchanged
  - If baseSql has no `WHERE` → insert before `GROUP BY`/`ORDER BY`/`LIMIT` (whichever comes first); else append at end
  - If baseSql has `WHERE` → append `AND <new>` before `GROUP BY`/`ORDER BY`/`LIMIT`
  - Defensive: strip leading `WHERE` keyword from whereClause input if user passes it
  - Implementation strategy: regex/string scan — full SQL AST parse is overkill for the predictable SQL shape `ChartConfigPanel` generates

### Test approach

- New `filterStore.spec.ts` (or whatever the planner names it) MUST inherit `setupFiles: src/test/setup.ts` from `vitest.config.ts` so the Zustand store-reset shim (`__mocks__/zustand.ts`) covers it (PITFALL S-03 lock).
- Add a canary test at the top of the spec: assert store is empty at the start of each test. If the canary fails, the setup hook isn't running — fail fast, don't let other tests pass on stale state.
- Direct pitfall-locking tests (one per lock):
  - D-02: single-quote in value produces `O''Brien` (escape regression)
  - D-03: null value produces `IS NULL` (not `= NULL`)
  - D-04: 11th add at cap is no-op + toast shown
  - D-05: same-column second add yields exactly 1 filter for that column (replace, not append)
  - C-04: filter on table 1 doesn't appear in `filters[2]`
  - S-02: `filterVersion` advances on every mutation; assert it survives empty-array reference stability
  - Cross-dashboard reset: simulate unmount → assert store empty
  - Logout reset: simulate auth status flip → assert store empty
  - AbortController: filter change before fetch resolves → first fetch aborted (vitest mock assertion)
- WHERE-injection unit tests for the predictable SQL shapes `ChartConfigPanel` generates (with/without `WHERE`, with `GROUP BY`, with `ORDER BY`, with `LIMIT`).

### Claude's Discretion

- Exact directory structure (e.g., `src/store/filters.ts` vs `src/store/filters/{index,utils}.ts` vs `src/lib/filters/`)
- Naming details: `useFilterStore` vs `useFiltersStore` vs `filtersStore`. Match v1.1 convention (single-noun: `useAuthStore`, `useToastStore`).
- Whether to extract the AbortController setup into a small reusable helper or keep inline in `AggregatedWidgetRenderer`
- TypeScript discriminated-union encoding for `ActiveFilter` (whether `dataType` is the discriminator or the value-type pair is)
- Whether to colocate `escapeKineticaStringLiteral` with the filter store or surface it from `src/api/client.ts` for broader future reuse
- Test-spec file count: one big spec file or split (cap-spec, escape-spec, lifecycle-spec)
- Whether to use Zustand's `subscribe` API or a `useEffect` for the logout-reset wiring

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 9 requirements + research (PRIMARY)

- `.planning/REQUIREMENTS.md` — FILT-01, FILT-02, FILT-03 full text + traceability
- `.planning/ROADMAP.md` § Phase 9 — success criteria + canonical refs list + pitfall lock list
- `.planning/research/SUMMARY.md` — synthesized stack + pitfalls + architecture overview
- `.planning/research/ARCHITECTURE.md` § filter store, § per-chart-type click contracts, § injectWhereClause approach, § anti-patterns (AP-1, AP-3, AP-4)
- `.planning/research/PITFALLS.md` — D-02, D-03, D-04, D-05 (drill-down chain); C-02, C-04 (cross-chart coordination); S-01, S-02, S-03 (state/test). Each Phase 9 plan must reference the locks it tests.
- `.planning/research/STACK.md` — confirms zero new server deps for this phase; one Zustand slice + utilities only

### Project-level context

- `.planning/PROJECT.md` § Current Milestone, § Validated requirements, § Key Decisions, § Context (mentions the EXISTING per-table filter bar — read carefully)
- `.planning/STATE.md` — current position, accumulated decisions, blockers (none for Phase 9)

### Codebase maps (READ THESE BEFORE WRITING CODE)

- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, camelCase, 2-space indent, NO path aliases (relative imports only), no formatter config — match existing style
- `.planning/codebase/STRUCTURE.md` — repo layout for new file placement (`src/store/`)
- `.planning/codebase/STACK.md` — existing dependency baseline (Zustand version, vitest version)
- `.planning/codebase/TESTING.md` — testing conventions

### Existing code (mandatory read before writing)

- `kinetica_bi/src/store/auth.ts` — Zustand store template (~70 LOC); mirror its `create<T>((set) => ({...}))` pattern, action-on-state colocation, inline pitfall-comment style
- `kinetica_bi/src/store/toast.ts` — Zustand store + integration with useApiQuery (the cap-toast routing path); also a small ~34 LOC reference for sizing
- `kinetica_bi/src/hooks/useApiQuery.ts` — Hook that `AggregatedWidgetRenderer` consumes; integrates typed-error chain (`PermissionError`, `ReauthRequiredError`, `UpstreamError`). Filter subscription = adding `filterVersion` to its `deps` array.
- `kinetica_bi/src/api/client.ts` — `runSql` helper (line ~bottom of file) gains `signal?: AbortSignal` param. Existing typed errors already defined.
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx` — `AggregatedWidgetRenderer` lives here; the subscription wiring lands here.
- `kinetica_bi/src/components/DashboardsPage.tsx` — lines 450-471 hold the EXISTING display-only filter bar reading `view.filter_clause`; planner reads this for context but does NOT modify it in Phase 9 (Phase 10 rewrites it).
- `kinetica_bi/__mocks__/zustand.ts` — Zustand store-reset shim from v1.1 (PITFALL S-03 lock); new filterStore spec MUST inherit it via `vitest.config.ts` `setupFiles`
- `kinetica_bi/src/test/setup.ts` — vitest setup file pattern

### Anti-pattern locks (carried from research, must appear in plans)

- **AP-1**: Filter state NEVER lives on a chart component — only in `useFilterStore`. Components read via selector, never via props.
- **AP-3**: EVERY user-clicked value flowing into SQL goes through `escapeKineticaStringLiteral` — no exceptions.
- **AP-4**: Store filter state as `Record<number, ActiveFilter[]>` from day one — NOT a flat array.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`useAuthStore`** (`src/store/auth.ts`, ~70 LOC) — clean Zustand template. Mirror for `useFilterStore`. Same `create<T>((set) => ({...}))` shape, state + actions colocated.
- **`useToastStore`** (`src/store/toast.ts`, ~34 LOC) — already wired into `useApiQuery`. Route filter cap warnings through `useToastStore.getState().showToast(message, kind)`.
- **`useApiQuery`** (`src/hooks/useApiQuery.ts`, ~66 LOC) — accepts `(fetchFn, deps)`; provides `{loading, data, error, refetch}`. The integration path: include `filterVersion` in `deps`. Already handles typed-error chain to toast surface.
- **Typed-error classes** (`src/api/client.ts`) — `PermissionError`, `ReauthRequiredError`, `UpstreamError` already exist. `runSql`'s AbortError handling threads cleanly through these.
- **`__mocks__/zustand.ts`** — store-reset shim from v1.1 frontend infra; covers any new Zustand store created via `create()` AS LONG AS the spec file inherits `setupFiles`.

### Established Patterns

- TypeScript strict; relative imports only (no path aliases per `CONVENTIONS.md`)
- 2-space indent; no formatter — match existing style
- Zustand pattern: `create<StateType>((set) => ({ ...state, ...actions }))` — actions colocated with state on same object
- Inline pitfall-comment style: comments reference PITFALL IDs (e.g., `// PITFALL S-02 lock`) so future readers can trace decisions
- Test specs colocated next to source as `*.spec.{ts,tsx}`; vitest auto-discovers via `src/**/*.spec.{ts,tsx}` glob

### Integration Points

- `AggregatedWidgetRenderer` (`src/components/charts/WidgetRenderer.tsx`) — subscribes to `useFilterStore` via selector; `filterVersion` joins its existing `useEffect` deps; filtered SQL is what `useApiQuery` fetches
- `runSql` (`src/api/client.ts`) — gains `signal?: AbortSignal` (additive; no breaking change to existing callers)
- `DashboardsPage.tsx` unmount — `useFilterStore.getState().reset()` call wipes store on dashboard switch
- `useAuthStore.subscribe` (or a top-level `useEffect` on auth status) — wipe filterStore on `unauthenticated`

### CRITICAL: existing `filter_clause` is NOT this concept

The `views` table already has a `filter_clause: string` field (used at materialize time, persisted in SQLite via the views API at `src/api/client.ts:361, 379, 399`). That's the SERVER-SIDE filter on a materialized view — used during view DDL — a totally separate concept from Phase 9's client-side `ActiveFilter[]` in `useFilterStore`. The display-only filter bar at `DashboardsPage.tsx:450-471` currently renders `view.filter_clause`.

The two MUST NOT be conflated. Comment the new code clearly to distinguish:
- `view.filter_clause` = server-persisted, applied at materialize time, narrow scope (one-time SELECT filter baked into the view definition)
- `useFilterStore.filters[tableId]` = client-transient, applied per-chart at SQL-fetch time, dynamic scope (drill-down filter that changes within a session)

Phase 10 rewrites the filter bar to read from BOTH (visible to user as one unified bar) — Phase 9 just builds the new store; Phase 10 surfaces it.

</code_context>

<specifics>
## Specific Ideas

- "Filters bound to tables, not charts" — extends the existing per-table filter-bar mental model from `PROJECT.md` Context section
- "The new filter chip appearing IS the feedback" — for both replace and dedupe paths, no extra toast noise (matches typical interactive-viz UX)
- "Filters reset on dashboard unmount" — aligns with 'transient client memory' from the locked requirements
- "Same column same value = silent no-op" — matches typical 'click selected = stay selected' UX in interactive viz tools
- Pattern reference: `useAuthStore` is the clean Zustand template; `useFilterStore` should match its cohesion (~70 LOC for the store itself, utilities separate)

</specifics>

<deferred>
## Deferred Ideas

These came up during discussion but belong outside Phase 9:

- **URL-encoded filter state** (FILT-V13-01) — locked as v1.3 future scope (already in REQUIREMENTS.md v1.3 section)
- **Saved-with-dashboard filter persistence** (FILT-V13-02) — locked as v1.3 future scope
- **Multi-value OR selection** (DRILL-V13-01) — out of v1.2 scope; needs operator-extension primitive in the filter store first
- **Bbox/lasso spatial select on map** (DRILL-V13-02) — out of v1.2 scope; breaks the equality-only model
- **Undo last filter** (Ctrl+Z, DRILL-V13-03) — out of v1.2 scope
- **"Clear dashboard" button alongside "Clear table"** — discussed in this phase and rejected as overkill; if user wants to clear all, they dismiss each table's filters individually
- **Modal confirmation on bulk clear** — discussed and rejected as friction
- **Toast on same-column replace** — discussed and rejected as noisy (chip change is sufficient feedback)
- **Pre-rendered `displayLabel` field on ActiveFilter** — discussed and rejected (compute at Phase 10 render time keeps store normalized)
- **Per-table AbortController in store** — discussed and rejected (per-fetch in useEffect cleanup is the React idiom)

</deferred>

---

*Phase: 09-filter-foundation*
*Context gathered: 2026-05-04*
