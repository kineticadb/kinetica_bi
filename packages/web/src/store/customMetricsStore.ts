/**
 * customMetricsStore.ts — Phase 99 Plan 02 (METRIC-V119-01/02).
 *
 * Per-table custom metrics cache. Mirrors columnDisplayConfigStore: per-table_id entry cache,
 * a single top-level `configVersion` counter bumped on EVERY mutation (even byte-identical),
 * strict no-op `removeMetric` when key absent (no version bump, state reference preserved),
 * and `reset()` hard-set to 0.
 *
 * configVersion semantics (mirror columnDisplayConfigStore):
 *   - setConfig: always +1 (even byte-identical rows payload)
 *   - upsertMetric: always +1 (even re-setting the same row)
 *   - removeMetric(existing): +1
 *   - removeMetric(absent table or id): STRICT NO-OP — no version bump, state reference preserved
 *   - reset(): hard-set to 0 — NOT an increment
 *
 * Divergence from columnDisplayConfigStore: entries are id-keyed metric ROWS
 * (Record<number, CustomMetricRow> per table) rather than column-name-keyed display configs.
 * This makes upsert/remove by id O(1) and the selector flattens to a label-sorted array.
 *
 * selectMetrics(tableId): pure getState()-based selector returning CustomMetricRow[]
 * label-sorted for Phase 100 consumers (picker + editor). Returns [] when table absent.
 *
 * LIFECYCLE — 10th store in the canonical cleanup block (after useFilterCombinationStore, 9th):
 *   Wired at DashboardsPage.tsx DashboardOpen cleanup useEffect.
 *   Custom metrics config is global per-table (not dashboard-scoped), but reset prevents
 *   stale entries accumulating across dashboard sessions (mirrors columnDisplayConfigStore reset).
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File MUST live under src/store/ for shim coverage.
 */

import { create } from "zustand";
import { listCustomMetrics, type CustomMetricRow } from "../api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomMetricsEntry = { metrics: Record<number, CustomMetricRow> }; // keyed by metric id

export type CustomMetricsState = {
  configs: Record<number, CustomMetricsEntry>; // keyed by table_id
  configVersion: number;                       // top-level; bumps on every mutation
  setConfig: (tableId: number, rows: CustomMetricRow[]) => void;
  upsertMetric: (tableId: number, row: CustomMetricRow) => void;
  removeMetric: (tableId: number, id: number) => void; // strict no-op if table/id absent
  loadConfig: (tableId: number) => Promise<void>;
  reset: () => void;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCustomMetricsStore = create<CustomMetricsState>((set) => ({
  configs: {},
  configVersion: 0,

  // REPLACE semantics — build a fresh metrics map from the rows array, set configs[tableId],
  // and bump configVersion unconditionally (even byte-identical payload — Pitfall 5 mirror).
  setConfig: (tableId, rows) =>
    set((s) => {
      const metrics: Record<number, CustomMetricRow> = {};
      for (const row of rows) metrics[row.id] = row;
      return {
        configs: { ...s.configs, [tableId]: { metrics } },
        configVersion: s.configVersion + 1,
      };
    }),

  // MERGE semantics — set/overwrite configs[tableId].metrics[row.id], bumps configVersion
  // unconditionally (even re-setting the same row — Pitfall 5 mirror).
  upsertMetric: (tableId, row) =>
    set((s) => {
      const prev = s.configs[tableId] ?? { metrics: {} };
      return {
        configs: {
          ...s.configs,
          [tableId]: { metrics: { ...prev.metrics, [row.id]: row } },
        },
        configVersion: s.configVersion + 1,
      };
    }),

  // DELETE-KEY semantics. STRICT NO-OP when configs[tableId] is absent OR metrics[id] is
  // absent — state reference preserved, configVersion NOT bumped (mirrors columnDisplayConfigStore.removeColumn).
  // Only deletes when entry exists and bumps configVersion on successful removal.
  removeMetric: (tableId, id) =>
    set((s) => {
      const entry = s.configs[tableId];
      if (!entry || !(id in entry.metrics)) return s; // strict no-op — preserve state reference
      const nextMetrics = { ...entry.metrics };
      delete nextMetrics[id];
      return {
        configs: {
          ...s.configs,
          [tableId]: { metrics: nextMetrics },
        },
        configVersion: s.configVersion + 1,
      };
    }),

  // On-demand per-table load: fetch the table's full metrics from the server and feed into setConfig.
  // Consumers call this to populate the cache lazily; setConfig always bumps configVersion.
  loadConfig: async (tableId) => {
    const rows = await listCustomMetrics(tableId);
    useCustomMetricsStore.getState().setConfig(tableId, rows);
  },

  // Hard-set to initial state; NOT an increment (mirrors columnDisplayConfigStore.reset).
  reset: () => set({ configs: {}, configVersion: 0 }),
}));

// ---------------------------------------------------------------------------
// Pure selector (for Phase 100 consumers: picker + editor)
// ---------------------------------------------------------------------------

/**
 * selectMetrics — returns the metrics for a table as a label-sorted array.
 * Pure getState()-based function (not a React hook) — testable without a DOM.
 * Returns [] when the table has no cached metrics.
 */
export const selectMetrics = (tableId: number): CustomMetricRow[] =>
  Object.values(useCustomMetricsStore.getState().configs[tableId]?.metrics ?? {}).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
