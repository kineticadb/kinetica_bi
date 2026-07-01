---
phase: 99-custom-metrics-server-store-foundation
plan: "02"
subsystem: web
tags: [custom-metrics, zustand, store, api-client, dashboard-lifecycle]
dependency_graph:
  requires:
    - 99-01 (CustomMetricRow server type + CRUD routes)
  provides:
    - CustomMetricRow web type (packages/web/src/api/client.ts)
    - listCustomMetrics / createCustomMetric / updateCustomMetric / deleteCustomMetric
    - useCustomMetricsStore (configs per table_id, configVersion, setConfig/upsertMetric/removeMetric/loadConfig/reset)
    - selectMetrics(tableId) selector for Phase 100 consumers
    - customMetricsStore.reset() wired into DashboardsPage cleanup chain (10th store)
  affects:
    - packages/web/src/api/client.ts
    - packages/web/src/store/customMetricsStore.ts
    - packages/web/src/store/customMetricsStore.spec.ts
    - packages/web/src/components/DashboardsPage.tsx
tech_stack:
  added: []
  patterns:
    - columnDisplayConfigStore precedent (v1.15) for store shape/version semantics
    - id-keyed metric rows (Record<number, CustomMetricRow>) per table — O(1) upsert/remove
    - Pitfall 5 lock: unconditional configVersion bump even on byte-identical payload
    - Strict no-op removeMetric: state ref preserved + no version bump when table/id absent
    - DashboardsPage cleanup chain: 10th store reset (mirrors columnDisplayConfigStore, 8th)
key_files:
  created:
    - packages/web/src/store/customMetricsStore.ts
    - packages/web/src/store/customMetricsStore.spec.ts
  modified:
    - packages/web/src/api/client.ts
    - packages/web/src/components/DashboardsPage.tsx
decisions:
  - id-map form (Record<number, CustomMetricRow>) chosen over array — O(1) upsert/remove by id; selectMetrics flattens+sorts to array for Phase 100 picker/editor
  - selectMetrics is a pure getState() fn (not a React hook) — consistent with resolveLabel/resolveFormatter precedent in columnDisplayConfigStore
  - Reset wired in DashboardsPage only (NOT App.tsx) — mirrors exact columnDisplayConfigStore precedent; global per-table config but cleared to prevent cross-session stale entries
metrics:
  duration: "~5 min"
  completed_date: "2026-07-01T00:30:54Z"
  tasks_completed: 3
  files_modified: 4
---

# Phase 99 Plan 02: Custom Metrics Client Store + API Foundation Summary

**One-liner:** Typed API client (`CustomMetricRow` + 4 CRUD fns matching Plan-01 route shape) + zustand `customMetricsStore` (id-keyed per-table cache, configVersion Pitfall-5 semantics, strict-no-op `removeMetric`, `selectMetrics` selector) + reset wired into DashboardsPage cleanup chain as the 10th store.

## API Client Functions (packages/web/src/api/client.ts)

```typescript
export type CustomMetricRow = {
  id: number;
  table_id: number;
  label: string;
  expression: string;
  format_spec: FormatSpec | null;
  created_at: string;
  updated_at: string;
};

// GET /api/tables/:tableId/custom-metrics -> { data: CustomMetricRow[] }
export const listCustomMetrics = async (tableId: number): Promise<CustomMetricRow[]>

// POST /api/tables/:tableId/custom-metrics -> 201 CustomMetricRow
export const createCustomMetric = async (
  tableId: number, label: string, expression: string, formatSpec: FormatSpec | null
): Promise<CustomMetricRow>

// PUT /api/tables/:tableId/custom-metrics/:id -> 200 CustomMetricRow
export const updateCustomMetric = async (
  tableId: number, id: number, label: string, expression: string, formatSpec: FormatSpec | null
): Promise<CustomMetricRow>

// DELETE /api/tables/:tableId/custom-metrics/:id -> 204
export const deleteCustomMetric = async (tableId: number, id: number): Promise<void>
```

## Store API (packages/web/src/store/customMetricsStore.ts)

```typescript
export type CustomMetricsEntry = { metrics: Record<number, CustomMetricRow> }; // keyed by metric id

export type CustomMetricsState = {
  configs: Record<number, CustomMetricsEntry>; // keyed by table_id
  configVersion: number;
  setConfig: (tableId: number, rows: CustomMetricRow[]) => void;    // REPLACE + always bump
  upsertMetric: (tableId: number, row: CustomMetricRow) => void;    // MERGE + always bump
  removeMetric: (tableId: number, id: number) => void;              // STRICT NO-OP if absent
  loadConfig: (tableId: number) => Promise<void>;                   // fetch + setConfig
  reset: () => void;                                                 // hard-set {configs:{}, configVersion:0}
};

export const useCustomMetricsStore: StoreApi<CustomMetricsState>;

// Pure selector for Phase 100 consumers (picker + editor)
export const selectMetrics = (tableId: number): CustomMetricRow[]  // label-sorted; [] if absent
```

## configVersion Semantics

| Operation | configVersion |
|-----------|--------------|
| `setConfig` (any payload, even byte-identical) | +1 |
| `upsertMetric` (any row, even identical re-set) | +1 |
| `removeMetric` (existing id) | +1 |
| `removeMetric` (absent table or absent id) | NO-OP — reference preserved |
| `reset()` | hard-set to 0 |

## Reset Wiring Site

`packages/web/src/components/DashboardsPage.tsx` — DashboardOpen cleanup `useEffect`, immediately after `useColumnDisplayConfigStore.getState().reset()` (~line 536):

```typescript
// Phase 99 (METRIC-V119-01/02): 10th store — custom-metrics cache; global per-table
// config but reset to prevent stale entries accumulating across dashboard sessions
// (mirrors columnDisplayConfigStore reset above).
useCustomMetricsStore.getState().reset();
```

App.tsx is NOT modified — exact mirror of the `columnDisplayConfigStore` precedent.

## Test Coverage (21 tests, customMetricsStore.spec.ts)

- Initial state: empty configs + configVersion 0
- `setConfig`: populate + version bump; Pitfall 5 byte-identical bump; REPLACE semantics; empty rows
- `upsertMetric`: add + version bump; Pitfall 5 byte-identical bump; MERGE semantics; creates table when absent
- `removeMetric`: strict no-op (absent table) → reference equality + same version; strict no-op (absent id) → reference equality + same version; success → removes + bumps version
- Version monotonicity: 5 mutations → configVersion === 5
- `loadConfig`: mocked `listCustomMetrics` → `setConfig` called → configVersion bumped
- `reset`: hard-sets to `{configs:{}, configVersion:0}` (NOT increment)
- `selectMetrics`: `[]` when absent; `[]` on empty setConfig; label-sorted 3 items; table isolation; reflects upsert updates

## Verification Gates

- `cd packages/web && npx tsc --noEmit`: CLEAN
- `cd packages/web && npx vitest run src/store/customMetricsStore.spec.ts`: 21/21 PASS
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts`: 132/132 PASS
- `cd packages/web && npx vitest run`: 132 test files, 3087 tests PASS
- No new CSS class or component introduced
- App.tsx unchanged

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 — API client fns + CustomMetricRow type | 5318eda | CustomMetricRow type + list/create/update/delete API client fns |
| 2 — customMetricsStore + spec (TDD) | c537f49 | customMetricsStore + per-table selector + 21 unit tests |
| 3 — DashboardsPage reset wiring | 5e67d19 | Wire customMetricsStore.reset() into DashboardsPage cleanup chain |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- packages/web/src/api/client.ts: FOUND (modified)
- packages/web/src/store/customMetricsStore.ts: FOUND (created)
- packages/web/src/store/customMetricsStore.spec.ts: FOUND (created)
- packages/web/src/components/DashboardsPage.tsx: FOUND (modified)
- Commit 5318eda: FOUND
- Commit c537f49: FOUND
- Commit 5e67d19: FOUND
