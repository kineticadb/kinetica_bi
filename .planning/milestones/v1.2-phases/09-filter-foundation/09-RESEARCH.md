# Phase 9: Filter Foundation — Research

**Researched:** 2026-05-04
**Domain:** Zustand filter store, SQL escaping utilities, AbortController integration, vitest test wiring
**Confidence:** HIGH — all findings verified directly from codebase files; no claims based on training data alone

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ActiveFilter type shape**
```ts
type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: 'string' | 'number' | 'boolean' | 'datetime' | 'null';
  sourceWidgetId?: number;
  addedAt: number; // Date.now() at addFilter time
};
```
- `dataType` is explicitly stored (not derived from typeof value)
- `datetime` is a first-class union member
- `displayLabel` is NOT stored — computed at render time (Phase 10)
- `sourceWidgetId` is optional
- `addedAt` is stored for chronological ordering

**Filter store API surface**
- `useFilterStore = create<FilterState>((set) => ({ ... }))` — mirror `useAuthStore` pattern from `src/store/auth.ts`
- `filters: Record<tableId: number, ActiveFilter[]>` — table-keyed from day 1 (AP-4 / C-04 lock)
- `filterVersion: number` — increments on every mutation (S-02 lock)
- `addFilter(filter: ActiveFilter): void` — handles cap, dedupe, same-column-replace
- `removeFilter(tableId: number, column: string): void`
- `clearFilters(tableId: number): void` — no `clearAllFilters()` global
- `reset(): void` — internal only, called on dashboard unmount and logout

**Cap + dedupe behavior**
- Cap = 10 filters per table; 11th add is no-op + toast via `useToastStore`
- Exact duplicate (same column AND same value) = silent no-op
- Same column, different value = silent replace (last-click-wins, D-05 lock)

**Clear-all scope**
- `clearFilters(tableId)` only; no confirmation prompt; no `clearAllFilters()`

**Cross-dashboard lifecycle**
- `reset()` on every dashboard mount/unmount via `DashboardsPage` `useEffect` cleanup
- `reset()` on logout via `useAuthStore.subscribe` or top-level `useEffect` on auth status
- No persistence layer — transient only

**AbortController scope**
- Per-fetch in `useEffect` cleanup, NOT per-table at store level
- `runSql` gains `signal?: AbortSignal` as additive optional param (no breaking change)
- `AbortError` is caught and silenced in `runSql` — not routed to typed-error chain

**SQL-safe filter builder utility**
- Single module (planner picks exact location — `src/store/filters.ts` suggested)
- `escapeKineticaStringLiteral(s: string): string` — single source of truth for string interpolation
- `buildEqualityFilter(filter: ActiveFilter): string` — branches on `dataType`
  - `'null'` → `${column} IS NULL` (D-03 lock)
  - `'string'` → `${column} = '${escape(value)}'`
  - `'number'` → `${column} = ${value}`
  - `'boolean'` → `${column} = ${value ? 'TRUE' : 'FALSE'}`
  - `'datetime'` → `${column} = TIMESTAMP '${value.toISOString()}'` (planner spike confirms exact syntax)
- `buildWhereClause(filters: ActiveFilter[]): string` — joins with `AND`; empty array → empty string
- `injectWhereClause(baseSql: string, whereClause: string): string` — splices into baseSql with regex/string scan

**Test approach**
- New spec inherits `setupFiles: src/test/setup.ts` from `vitest.config.ts` (S-03 lock)
- Canary test at top of spec asserts store is empty at start of each test
- Direct pitfall-locking tests: D-02, D-03, D-04, D-05, C-04, S-02, cross-dashboard reset, logout reset, AbortController
- WHERE-injection unit tests for all SQL shapes ChartConfigPanel generates

### Claude's Discretion

- Exact directory structure (`src/store/filters.ts` vs `src/store/filters/{index,utils}.ts` vs `src/lib/filters/`)
- Naming: `useFilterStore` vs `useFiltersStore` — match v1.1 single-noun convention (`useAuthStore`, `useToastStore`)
- AbortController: small reusable helper vs inline in `AggregatedWidgetRenderer`
- TypeScript discriminated-union encoding for `ActiveFilter`
- Whether to colocate `escapeKineticaStringLiteral` with filter store or surface from `src/api/client.ts`
- Test-spec file count: one big spec or split (cap-spec, escape-spec, lifecycle-spec)
- Whether to use Zustand's `subscribe` API or a `useEffect` for logout-reset wiring

### Deferred Ideas (OUT OF SCOPE)

- URL-encoded filter state (FILT-V13-01)
- Saved-with-dashboard filter persistence (FILT-V13-02)
- Multi-value OR selection (DRILL-V13-01)
- Bbox/lasso spatial select on map (DRILL-V13-02)
- Undo last filter (DRILL-V13-03)
- `clearAllFilters()` global API
- Modal confirmation on bulk clear
- Toast on same-column replace
- Pre-rendered `displayLabel` on ActiveFilter
- Per-table AbortController in store
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-01 | `useFilterStore` Zustand slice with table-keyed `Record<tableId, ActiveFilter[]>`, `filterVersion` counter, `addFilter` (replace-same-column, 10-cap), `removeFilter`, `clearFilters` | Zustand 4.5.2 confirmed; `create<T>((set) => ...)` pattern verified in `auth.ts`; `filterVersion` primitive dep pattern is new but straightforward; no existing filterStore found |
| FILT-02 | `AggregatedWidgetRenderer` subscribes to filter store, re-runs SQL on filter change with `injectWhereClause`, cancels in-flight fetches via `AbortController` | `AggregatedWidgetRenderer` found at `WidgetRenderer.tsx:128-204`; currently uses raw `runSql` with `let active = true` pattern (no AbortController); `useApiQuery` is NOT used by it today — must add AbortController; `runSql` needs `signal?: AbortSignal` |
| FILT-03 | SQL-safe filter builder: `buildEqualityFilter`, `escapeKineticaStringLiteral`, IS NULL handling | No existing escape utility found anywhere in `src/`; must be new; standard SQL single-quote doubling pattern; `buildWhereClause` and `injectWhereClause` also new |
</phase_requirements>

---

## Summary

Phase 9 adds zero user-visible UI. All deliverables are headless: a Zustand store slice, a SQL-escaping utility module, and subscription wiring in `AggregatedWidgetRenderer`. The codebase is well-prepared — `useAuthStore` provides a clean 70-line store template, `useToastStore` provides the cap-warning path, and the Zustand store-reset shim in `__mocks__/zustand.ts` already covers any new `create()` call automatically provided the new spec file runs under the same `vitest.config.ts`.

The most important discovery is that `AggregatedWidgetRenderer` does NOT currently use `useApiQuery`. It has its own inline `useEffect` with a `let active = true` cancellation guard but no `AbortController`. This means Phase 9 must either (a) add `AbortController` inline to `AggregatedWidgetRenderer`'s existing `useEffect`, or (b) migrate it to `useApiQuery` with an `AbortController` extension. The CONTEXT.md decisions favor option (a) — per-fetch `AbortController` in `useEffect` cleanup — which is the simpler, lower-risk change.

The SQL shapes generated by `ChartConfigPanel` are fully known and predictable (two patterns: aggregated with `GROUP BY ... ORDER BY ... LIMIT` and records with `ORDER BY` only). The `injectWhereClause` regex approach is well-suited to these shapes.

**Primary recommendation:** New file `src/store/filterStore.ts` (or `filters.ts`) co-located with the store utilities. Follow `auth.ts` template exactly. Keep `escapeKineticaStringLiteral` in the same file for now (discretion item) — it simplifies import chains and the file will remain small.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 4.5.2 (confirmed in `package.json`) | Filter store state management | Already used for `useAuthStore` and `useToastStore`; zero new dependency |
| vitest | ^4.1.5 (confirmed in `package.json`) | Test runner for filter store spec | Already installed; `vitest.config.ts` already wires `src/test/setup.ts` |
| @testing-library/react | ^16.3.2 (confirmed) | RTL for harness component testing | Already installed; used in `App.spec.tsx` and `LoginPage.spec.tsx` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Native `AbortController` | Browser built-in | Cancel in-flight `runSql` fetches on filter change | Required in `AggregatedWidgetRenderer` useEffect cleanup |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `AbortController` in `AggregatedWidgetRenderer` | Migrate to `useApiQuery` | Migration is higher risk — `useApiQuery` would need `AbortController` extension too; inline is narrower change |
| `src/store/filterStore.ts` | `src/lib/filters/index.ts` | Either works; `src/store/` is where all existing Zustand stores live — follow convention |

**Installation:** No new packages required. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure

```
kinetica_bi/src/
├── store/
│   ├── auth.ts            # existing — Zustand template
│   ├── auth.spec.ts       # existing — spec template
│   ├── toast.ts           # existing — toast routing path
│   ├── user.ts            # existing
│   ├── filterStore.ts     # NEW — useFilterStore + SQL utilities
│   └── filterStore.spec.ts # NEW — pitfall-locking tests
├── api/
│   └── client.ts          # MODIFIED — runSql gains signal?: AbortSignal
└── components/
    └── charts/
        └── WidgetRenderer.tsx  # MODIFIED — AggregatedWidgetRenderer gains filter subscription + AbortController
```

### Pattern 1: Zustand Store Shape (verified from auth.ts)

**What:** State + actions colocated on same object; `create<T>((set) => ({ ...state, ...actions }))`. Actions call `set()` with functional update form when reading prior state.

**When to use:** Every Zustand store in this project. Mirror exactly.

**Example (from `kinetica_bi/src/store/auth.ts:20`):**
```typescript
// Source: kinetica_bi/src/store/auth.ts:20-70
export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  user: null,
  // ...state fields...
  markUnauthenticated: (reason: AuthReason = null) =>
    set({ status: "unauthenticated", user: null, reason })
}));
```

For the filter store, `addFilter` needs to read prior state before writing:
```typescript
addFilter: (filter: ActiveFilter) =>
  set((state) => {
    const tableFilters = state.filters[filter.tableId] ?? [];
    // cap check, dedupe check, same-column replace...
    return { filters: { ...state.filters, [filter.tableId]: newFilters }, filterVersion: state.filterVersion + 1 };
  }),
```

### Pattern 2: Toast Routing for Cap Warning (verified from toast.ts)

**What:** `useToastStore.getState().showToast(message, kind)` called imperatively from within a store action (not from a component). The toast store deduplicates the same message within a 5-second window.

**Call signature (from `kinetica_bi/src/store/toast.ts:9`):**
```typescript
showToast: (message: string, kind?: ToastKind) => void
// ToastKind = "permission" | "info" | "error"
```

**For cap warning:** `useToastStore.getState().showToast("Filter limit reached (10 per table). Clear some first.", "info")`

The 5-second dedup window in `useToastStore` means rapid repeated clicks at the cap will not spam toasts — built-in protection.

### Pattern 3: Zustand Selector Subscription (C-02 lock)

**What:** Subscribe to the minimal selector that includes only the tableId-scoped data. Zustand uses strict equality — `filters[tableId]` reference is unchanged when a different table's filters change, preventing O(N) re-renders.

**Pattern:**
```typescript
// In AggregatedWidgetRenderer — reads only this chart's table filters
const tableFilters = useFilterStore(state => state.filters[tableId] ?? []);
const filterVersion = useFilterStore(state => state.filterVersion);
// filterVersion is the primitive dep for useEffect (S-02 lock)
```

### Pattern 4: AbortController in useEffect Cleanup

**What:** `AggregatedWidgetRenderer` currently has `let active = true` cancellation (lines 137-150 of `WidgetRenderer.tsx`). Phase 9 replaces this with `AbortController` so `runSql` can cancel the actual fetch, not just suppress state updates after response arrives.

**Verified current pattern (WidgetRenderer.tsx:136-151):**
```typescript
// Source: kinetica_bi/src/components/charts/WidgetRenderer.tsx:136-151
useEffect(() => {
  if (!sql?.trim()) { setData([]); return; }
  setLoading(true);
  setError(null);
  runSql<Record<string, unknown>>(sql)
    .then((res) => { const rows = parseKineticaResponse(res); setData(rows); })
    .catch((err) => setError(err.message))
    .finally(() => setLoading(false));
}, [sql]);
```

**Phase 9 change — add AbortController + filterVersion dep:**
```typescript
useEffect(() => {
  if (!sql?.trim() || !tableId) { setData([]); return; }
  const controller = new AbortController();
  setLoading(true);
  setError(null);
  setData(null); // clear stale data before new fetch (C-03 contract)
  runSql<Record<string, unknown>>(injectWhereClause(sql, whereClause), { signal: controller.signal })
    .then((res) => { setData(parseKineticaResponse(res)); })
    .catch((err) => {
      if (err.name === 'AbortError') return; // expected control flow
      setError(err.message);
    })
    .finally(() => setLoading(false));
  return () => controller.abort();
}, [sql, filterVersion]); // filterVersion primitive dep — always changes on mutation
```

### Pattern 5: runSql Signal Extension (additive, no breaking change)

**Verified current signature (client.ts:126):**
```typescript
// Source: kinetica_bi/src/api/client.ts:126-138
export const runSql = async <T = unknown>(sql: string, options?: Record<string, unknown>): Promise<T> => {
  const response = await apiFetch(`${API_BASE}/api/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, options })
  });
  ...
};
```

**Phase 9 addition — add `signal` as second optional param:**
```typescript
export const runSql = async <T = unknown>(
  sql: string,
  options?: Record<string, unknown>,
  signal?: AbortSignal  // additive — no existing callers pass it
): Promise<T> => {
  const response = await apiFetch(`${API_BASE}/api/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, options }),
    signal  // threaded into fetch init
  });
  ...
};
```

Note: `apiFetch` wraps `fetch` (client.ts:36-57). Adding `signal` to the fetch init object is a standard addition — `AbortSignal` is supported natively in the browser `fetch` API.

### Pattern 6: SQL Assembly in ChartConfigPanel (injection point for WHERE clause)

**Verified SQL patterns generated by ChartConfigPanel (lines 108-135):**

Pattern A — aggregated (bar, line, pie, scatter, bignumber):
```sql
SELECT {groupByColumn}, {AGG}({metricColumn}) AS value
FROM {table}
GROUP BY {groupByColumn}
ORDER BY value DESC
LIMIT 100
```

Pattern B — records (no aggregation):
```sql
SELECT {colsClause} FROM {table} ORDER BY {sortField} {DIR}
```

The `injectWhereClause` utility must handle both patterns. Key injection cases:
- No WHERE, has GROUP BY → inject `WHERE <clause>` before `GROUP BY`
- No WHERE, has ORDER BY → inject `WHERE <clause>` before `ORDER BY`
- No WHERE, has LIMIT → inject `WHERE <clause>` before `LIMIT`
- Already has WHERE → append `AND <clause>` before GROUP BY/ORDER BY/LIMIT
- Empty whereClause → return baseSql unchanged

Note: the `tableId` is NOT currently stored in `widget.config` as an integer. It IS accessible through `ChartConfigPanel`'s `selectedSource.tableId` (ChartConfigPanel.tsx:71,77) at config-save time. The planner must determine how `AggregatedWidgetRenderer` resolves `tableId` — either from `widget.config.tableId` (which must be saved at config time) or by looking up the table by name. The CONTEXT.md says "tableId stored in widget.config.tableId at config-save time" — this is an AP-4 requirement that means ChartConfigPanel must be updated to save `tableId` into the config on save. This is a DEPENDENCY the planner must address.

### Anti-Patterns to Avoid

- **Flat filter array (AP-4):** Never `filters: ActiveFilter[]`. Always `filters: Record<number, ActiveFilter[]>`.
- **Full store subscription (C-02):** Never `useFilterStore(state => state.filters)` in a chart. Always scope to `state.filters[tableId] ?? []`.
- **Component-local filter shadow (S-01/AP-1):** No `useState` tracking filter values alongside Zustand subscription.
- **Raw value interpolation (AP-3):** Never `\`WHERE ${col} = '${value}'\`` without `escapeKineticaStringLiteral`.
- **`column = NULL` (D-03):** Always route null values to `IS NULL` in `buildEqualityFilter`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast for cap warning | Custom notification component | `useToastStore.getState().showToast()` | Already exists; dedup window built in |
| Store state reset between tests | Custom afterEach cleanup | `__mocks__/zustand.ts` shim (already active via `vi.mock("zustand")` in `setup.ts`) | Automatic for any new `create()` call; hand-rolling duplicates logic already proven |
| SQL string escaping | Ad-hoc `value.replace(/'/g, "''")` inline | `escapeKineticaStringLiteral` (the new utility) | Single location, unit-tested with adversarial inputs |

**Key insight:** The Zustand mock shim is fully automatic — it intercepts every `create()` call and registers it for `afterEach` reset. The only risk is a spec file not covered by `setupFiles`. The canary test is the safety net.

---

## Common Pitfalls

### Pitfall 1: S-03 — New spec file not covered by Zustand shim

**What goes wrong:** A new `filterStore.spec.ts` that doesn't inherit `setupFiles: src/test/setup.ts` will not have `vi.mock("zustand")` active. The shim never intercepts `create()`. Filter state bleeds across tests.

**Why it happens:** The `vitest.config.ts` `setupFiles` is global for all tests matching `include: ["src/**/*.spec.{ts,tsx}"]`. New files in `src/store/` are covered automatically. The risk is only if someone creates a separate `vitest.config.ts` for filter tests.

**How to avoid:** Keep the new spec in `src/store/filterStore.spec.ts`. It matches the glob `src/**/*.spec.{ts,tsx}` and inherits `setupFiles: ["./src/test/setup.ts"]` automatically. Add canary test:
```typescript
it('store is empty at start of each test (canary — Zustand shim active)', () => {
  const { filters, filterVersion } = useFilterStore.getState();
  expect(Object.keys(filters)).toHaveLength(0);
  expect(filterVersion).toBe(0);
});
```

**Warning signs:** Tests pass individually but fail in suite order (always a bleed sign).

### Pitfall 2: S-02 — filterVersion not advancing on clearFilters → no re-fetch

**What goes wrong:** `clearFilters(tableId)` mutates the store but if `filterVersion` doesn't increment, the `useEffect` dep sees no change and no re-fetch fires. Charts show stale filtered data after the user clears.

**Why it happens:** Easy to forget `filterVersion` increment in the clear action when focused on the array mutation.

**How to avoid:** Every store mutation (`addFilter`, `removeFilter`, `clearFilters`) MUST increment `filterVersion`. Test: add a filter, assert `filterVersion = 1`; clear, assert `filterVersion = 2`.

**Warning signs:** Filter bar appears to update (chips gone) but chart data doesn't change; no network request after clear.

### Pitfall 3: D-05 — Same column, two values → always-empty result

**What goes wrong:** `addFilter` appending rather than replacing when `filters[tableId]` already has an entry for the same column. The SQL becomes `WHERE col = 'EAST' AND col = 'WEST'` — always empty.

**How to avoid:** In `addFilter`, before appending: `const existingIdx = tableFilters.findIndex(f => f.column === filter.column)`. If found, replace at that index. Single transactional `set()` call. Test: add `region=EAST`, then `region=WEST` on same table → assert `filters[tableId].length === 1` and value is `'WEST'`.

### Pitfall 4: D-03 — `column = NULL` from null value

**What goes wrong:** `buildEqualityFilter` naively constructs `WHERE col = 'null'` or `WHERE col = NULL` (both wrong in SQL). SQL three-valued logic makes `col = NULL` always evaluate to UNKNOWN, returning zero rows.

**How to avoid:** In `buildEqualityFilter`, the first branch: `if (filter.dataType === 'null') return \`${filter.column} IS NULL\``. Never pass null through the string interpolation path.

### Pitfall 5: tableId missing from widget.config at render time

**What goes wrong:** `AggregatedWidgetRenderer` needs `tableId: number` from `widget.config` to call `useFilterStore(state => state.filters[tableId])`. If `ChartConfigPanel` never saves `tableId` to config, it will be `undefined` and the filter subscription silently applies no filters.

**Why it happens:** The current `ChartConfigPanel` saves `table` (string name) and chart-specific fields to config, but NOT `tableId` (integer). The integer `tableId` exists in `selectedSource.tableId` at config time (ChartConfigPanel.tsx:71) but is not persisted.

**How to avoid:** `ChartConfigPanel.onSave` must include `tableId: selectedSource?.tableId` in the saved config payload. This is a **prerequisite dependency** for FILT-02. The planner must add this as a task or sub-step in the plan.

**Warning signs:** `useFilterStore(state => state.filters[undefined])` returns `[]` — filters appear to work (no error) but never apply.

### Pitfall 6: AbortError routed to error state → red error UI on filter change

**What goes wrong:** If `runSql` rejects with `AbortError` and the catch handler in `AggregatedWidgetRenderer` routes it to `setError()`, every filter change shows a momentary red error state before the new data loads.

**How to avoid:** In the catch handler: `if (err.name === 'AbortError') return;` — silently discard abort errors, do not call `setError`. The new fetch will update state correctly.

### Pitfall 7: C-04 — filter.tableId vs the key used in the Record

**What goes wrong:** `addFilter` receives an `ActiveFilter` object. The key into `state.filters` must be the table's integer `id` (from `TableDto.id`). If the code accidentally uses the string table name as the key, the Record shape becomes `Record<string, ActiveFilter[]>` — still functional but breaks the `Record<number, ActiveFilter[]>` type contract and causes subtle key mismatch when `AggregatedWidgetRenderer` looks up by `widget.config.tableId` (number).

**How to avoid:** The `addFilter` action signature from CONTEXT.md takes a full `ActiveFilter` object. The `ActiveFilter` type does NOT include `tableId` — it only has `column`, `value`, `dataType`, `sourceWidgetId`, `addedAt`. Therefore `addFilter` must be called with `tableId` as a SEPARATE parameter: `addFilter(tableId: number, filter: ActiveFilter): void`. The planner must resolve this signature discrepancy from CONTEXT.md (which says `addFilter(filter: ActiveFilter): void`).

**Research finding:** CONTEXT.md says the action signature is `addFilter(filter: ActiveFilter): void` with no explicit `tableId` parameter. But `ActiveFilter` as defined has no `tableId` field. This is a gap — either (a) add `tableId` to `ActiveFilter`, or (b) make the signature `addFilter(tableId: number, filter: ActiveFilter): void`. Option (b) is cleaner (keeps `ActiveFilter` as a row-level type). The planner must resolve this.

---

## Code Examples

### Verified: Zustand store reset shim — how it works

```typescript
// Source: kinetica_bi/__mocks__/zustand.ts (full file verified)
// afterEach runs storeResetFns.forEach(...) — resets ALL stores created via create()
// New filterStore is automatically registered when create() is called
// Requirement: spec file must be in src/**/*.spec.{ts,tsx} to inherit setupFiles
```

### Verified: useApiQuery signature (does NOT need AbortController)

```typescript
// Source: kinetica_bi/src/hooks/useApiQuery.ts:17-19
export function useApiQuery<T>(
  fetchFn: () => Promise<T>,
  deps: ReadonlyArray<unknown>
): ApiQueryResult<T>
// Returns: { loading, data, error, refetch }
// Does NOT return abort — uses `let active = true` pattern only (no AbortController)
// AggregatedWidgetRenderer does NOT use useApiQuery — it has its own inline useEffect
```

### Verified: SQL shapes from ChartConfigPanel

```typescript
// Source: kinetica_bi/src/components/charts/ChartConfigPanel.tsx:108-135
// Aggregated shape:
// SELECT {groupByColumn}, {AGG}({metricColumn}) AS value FROM {table} GROUP BY {groupByColumn} ORDER BY value DESC LIMIT 100
// Records shape:
// SELECT {colsClause} FROM {table} ORDER BY {sortField} {DIR}
// No existing WHERE clause in either shape — injectWhereClause always inserts before GROUP BY or ORDER BY
```

### Verified: toast call pattern

```typescript
// Source: kinetica_bi/src/store/toast.ts:19
// showToast: (message: string, kind?: ToastKind) => void
// ToastKind = "permission" | "info" | "error"
// Called imperatively from store action:
useToastStore.getState().showToast(
  "Filter limit reached (10 per table). Clear some first.",
  "info"
);
```

### Verified: existing filter_clause distinction

```typescript
// Source: kinetica_bi/src/api/client.ts:356-361
// ViewDto.filter_clause: string — SERVER-SIDE filter on materialized view
// Applied at view DDL time (materialize endpoint). NOT the same as useFilterStore.
// DashboardsPage.tsx:450-471 renders this display-only filter bar.
// Phase 9 does NOT touch this. Phase 10 rewrites the bar to read from BOTH.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No filter state | `useFilterStore` Zustand slice | Phase 9 (new) | Foundation for all v1.2 cross-chart coordination |
| Raw `runSql` call in AggregatedWidgetRenderer | `runSql` + `AbortController` + filter injection | Phase 9 (modified) | Eliminates stale-response race and stale-data-on-filter-change |
| `let active = true` stale guard | `AbortController` + active guard | Phase 9 | Actually cancels in-flight fetch, not just suppresses state update |

**Deprecated/outdated in Phase 9 context:**
- The `active = true` pattern in `AggregatedWidgetRenderer`'s useEffect: still valid for non-abort cases but insufficient for filter-change race conditions — AbortController is additive, not a replacement.

---

## Open Questions

1. **`addFilter` signature — where does `tableId` come from?**
   - What we know: `ActiveFilter` type has no `tableId` field. The store key is `Record<number, ActiveFilter[]>`.
   - What's unclear: CONTEXT.md says `addFilter(filter: ActiveFilter): void` but the action needs a tableId to know which bucket to update.
   - Recommendation: Planner should resolve as `addFilter(tableId: number, filter: ActiveFilter): void` (two-param signature) to keep `ActiveFilter` row-scoped and the store key explicit. This is the cleanest design. All call sites in Phase 9 (tests) and Phase 10 (click handlers) must pass `tableId` explicitly.

2. **`tableId` in `widget.config` — who saves it?**
   - What we know: `AggregatedWidgetRenderer` receives `widget: WidgetDto`; `widget.config` is `Record<string, unknown>`. Currently `config.tableId` is not saved by `ChartConfigPanel`.
   - What's unclear: Is saving `tableId` to config a Phase 9 task or Phase 10?
   - Recommendation: Phase 9 should include it as a prerequisite sub-task. Without it, `AggregatedWidgetRenderer`'s filter subscription has no `tableId` to key on. It's a one-line addition to `ChartConfigPanel`'s save handler.

3. **Kinetica TIMESTAMP literal format**
   - What we know: `buildEqualityFilter` for `datetime` type uses `TIMESTAMP '...'` syntax. Exact format (ISO 8601, Unix timestamp, Kinetica-specific) is unconfirmed.
   - What's unclear: Does Kinetica accept `TIMESTAMP '2024-01-15T10:30:00.000Z'` or `TIMESTAMP '2024-01-15 10:30:00'`?
   - Recommendation: CONTEXT.md explicitly flags this as a "planner spike" item. The planner should add a Wave 0 spike task. For now, document as LOW confidence. Until resolved, `datetime` filter type can be deferred from the first implementation wave.

4. **Logout reset wiring location — `App.tsx` or `DashboardsPage.tsx`?**
   - What we know: `useAuthStore` exposes `status` field. Reset must fire when `status === 'unauthenticated'`.
   - What's unclear: Whether to use `useAuthStore.subscribe()` (Zustand imperative) or a `useEffect` in `App.tsx`.
   - Recommendation: A `useEffect` in `App.tsx` on `[status]` dep is simpler and more readable. `subscribe` is appropriate if the subscription must be outside a component (e.g., in a module-level setup). Either is correct per CONTEXT.md's discretion.

---

## Critical File Map (for planner and implementer)

| File | Status | Phase 9 Change |
|------|--------|----------------|
| `kinetica_bi/src/store/auth.ts` | Existing (~70 LOC) | Read-only reference template |
| `kinetica_bi/src/store/toast.ts` | Existing (~34 LOC) | Read-only; `showToast` called from filterStore |
| `kinetica_bi/src/hooks/useApiQuery.ts` | Existing (~66 LOC) | Read-only in Phase 9; `filterVersion` passes as a dep from callers |
| `kinetica_bi/src/api/client.ts` | Existing (~433 LOC) | MODIFIED: `runSql` gains `signal?: AbortSignal` at line 126 |
| `kinetica_bi/src/components/charts/WidgetRenderer.tsx` | Existing (~646 LOC) | MODIFIED: `AggregatedWidgetRenderer` gains filter subscription + AbortController |
| `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` | Existing | MODIFIED: save `tableId` into widget config on save |
| `kinetica_bi/__mocks__/zustand.ts` | Existing | Read-only; auto-covers new filterStore |
| `kinetica_bi/src/test/setup.ts` | Existing | Read-only; `vi.mock("zustand")` activates shim |
| `kinetica_bi/vitest.config.ts` | Existing | Read-only; `setupFiles: ["./src/test/setup.ts"]`, `include: ["src/**/*.spec.{ts,tsx}"]` |
| `kinetica_bi/src/store/filterStore.ts` | NEW | Filter store + SQL utilities |
| `kinetica_bi/src/store/filterStore.spec.ts` | NEW | All pitfall-locking tests + WHERE-injection tests |

### AggregatedWidgetRenderer — exact insertion point

Lines 128-204 in `kinetica_bi/src/components/charts/WidgetRenderer.tsx`. The `useEffect` at lines 136-150 is the SQL fetch loop. Phase 9 modifies this function by:
1. Reading `tableId` from `widget.config.tableId as number`
2. Reading `filterVersion` from `useFilterStore(state => state.filterVersion)`
3. Building `whereClause` from `useFilterStore(state => state.filters[tableId] ?? [])`
4. Adding `AbortController` to `useEffect` (replacing `let active = true`)
5. Injecting `injectWhereClause(sql, whereClause)` into the SQL before calling `runSql`
6. Adding `filterVersion` to the `useEffect` dep array

### DashboardsPage — existing filter bar (read-only in Phase 9)

Lines 450-471 in `kinetica_bi/src/components/DashboardsPage.tsx`. Renders `view.filter_clause` (server-side). Phase 9 does NOT touch this. Phase 10 rewrites it.

### Dashboard unmount reset wiring

`DashboardsPage` already has a `useEffect` that fires on `dashboard.id` change (line ~100+). The `reset()` call should go in this effect's cleanup (or at the top of a new dashboard load). The planner picks the exact location. `useFilterStore.getState().reset()` is the imperative call pattern (no subscription needed from within the component — direct store access).

---

## Sources

### Primary (HIGH confidence)

- `kinetica_bi/src/store/auth.ts` — Zustand store template; verified `create<T>((set) => ...)` pattern, inline action colocation
- `kinetica_bi/src/store/toast.ts` — Toast routing; verified `showToast(message, kind?)` signature, 5s dedup window
- `kinetica_bi/src/hooks/useApiQuery.ts` — Hook signature; verified `(fetchFn, deps) => {loading, data, error, refetch}`; confirmed NO AbortController, only `active` flag
- `kinetica_bi/src/api/client.ts:126-138` — `runSql` signature; confirmed `(sql, options?)` with no `signal` param today
- `kinetica_bi/src/components/charts/WidgetRenderer.tsx:128-204` — `AggregatedWidgetRenderer`; verified inline `useEffect` at lines 136-150; confirmed no filter or AbortController present
- `kinetica_bi/src/components/charts/ChartConfigPanel.tsx:108-135` — SQL generation patterns; verified both aggregated and records shapes; confirmed no WHERE clause in generated SQL
- `kinetica_bi/__mocks__/zustand.ts` — Store-reset shim; verified `afterEach` registration, automatic coverage of any new `create()` call
- `kinetica_bi/src/test/setup.ts` — `vi.mock("zustand")` activation; verified 11 lines
- `kinetica_bi/vitest.config.ts` — `setupFiles: ["./src/test/setup.ts"]`, `include: ["src/**/*.spec.{ts,tsx}"]`, `environment: "jsdom"`, `isolate: true`; verified
- `kinetica_bi/package.json` — zustand 4.5.2, vitest ^4.1.5, @testing-library/react ^16.3.2; confirmed
- `.planning/phases/09-filter-foundation/09-CONTEXT.md` — All locked decisions; verbatim in User Constraints section
- `.planning/research/PITFALLS.md` — D-02, D-03, D-04, D-05, C-02, C-04, S-01, S-02, S-03; full text read

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` Phase 9 section — canonical pitfall lock list; success criteria
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, 2-space indent, relative imports, no formatter
- `.planning/codebase/STRUCTURE.md` — `src/store/` is canonical location for Zustand stores

### Tertiary (LOW confidence)

- Kinetica TIMESTAMP literal format — training data only; unverified against deployed instance; flagged as open question requiring spike

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all confirmed from package.json and existing codebase
- Architecture: HIGH — all patterns verified from existing store files and WidgetRenderer
- Pitfalls: HIGH — directly traceable to code line numbers in the codebase
- Kinetica TIMESTAMP format: LOW — needs spike; flagged as open question

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable — zero new dependencies; all findings are codebase facts)
