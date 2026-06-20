/**
 * columnDisplayConfigStore.ts — Phase 75 Plan 03 (COLCFG-V115-03).
 *
 * Per-table column display config cache. Mirrors dynamicViewStore: per-table_id entry cache,
 * a single top-level `configVersion` counter bumped on EVERY mutation (even byte-identical),
 * strict no-op `removeColumn` when key absent (no version bump, state reference preserved),
 * and `reset()` hard-set to 0.
 *
 * configVersion semantics (mirror dynamicViewVersion):
 *   - setConfig: always +1 (even byte-identical rows payload)
 *   - upsertColumn: always +1 (even re-setting the same label/spec)
 *   - removeColumn(existing): +1
 *   - removeColumn(absent table or column): STRICT NO-OP — no version bump, state reference preserved
 *   - reset(): hard-set to 0 — NOT an increment
 *
 * PURE HELPERS (co-located here — NOT in columnFormatter.ts which forbids store imports):
 *   - resolveLabel(tableId, columnName): string — stored label ?? raw column name
 *   - resolveFormatter(tableId, columnName): (v: unknown) => string | unknown — buildFormatter(spec) ?? identity
 *
 * Both helpers are PURE getState()-based functions (not React hooks) — testable without a DOM.
 *
 * LIFECYCLE — 8th store in the canonical cleanup block (after useWidgetActionStore, 7th):
 *   Wired at DashboardsPage.tsx DashboardOpen cleanup useEffect.
 *   Column display config is global per-table (not dashboard-scoped), but reset prevents
 *   stale entries accumulating across dashboard sessions.
 *
 * Test infra: Zustand reset shim at __mocks__/zustand.ts auto-applies via
 * vi.mock("zustand") in src/test/setup.ts. File MUST live under src/store/ for shim coverage.
 */

import { create } from "zustand";
import { buildFormatter, type FormatSpec } from "../lib/columnFormatter";
import { listColumnDisplayConfig, type ColumnDisplayConfigRow } from "../api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnDisplayConfigEntry = {
  columns: Record<string, { label: string | null; format_spec: FormatSpec | null }>;
};

export type ColumnDisplayConfigState = {
  configs: Record<number, ColumnDisplayConfigEntry>; // keyed by table_id
  configVersion: number;                             // top-level; bumps on every setConfig/upsertColumn
  setConfig: (tableId: number, rows: ColumnDisplayConfigRow[]) => void;
  upsertColumn: (tableId: number, col: string, label: string | null, spec: FormatSpec | null) => void;
  removeColumn: (tableId: number, col: string) => void; // strict no-op if table/key absent
  loadConfig: (tableId: number) => Promise<void>;
  reset: () => void;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useColumnDisplayConfigStore = create<ColumnDisplayConfigState>((set) => ({
  configs: {},
  configVersion: 0,

  // REPLACE semantics — build a fresh columns map from the rows array, set configs[tableId],
  // and bump configVersion unconditionally (even byte-identical payload — Pitfall 5 mirror).
  setConfig: (tableId, rows) =>
    set((s) => {
      const columns: ColumnDisplayConfigEntry["columns"] = {};
      for (const row of rows) {
        columns[row.column_name] = { label: row.label, format_spec: row.format_spec };
      }
      return {
        configs: { ...s.configs, [tableId]: { columns } },
        configVersion: s.configVersion + 1,
      };
    }),

  // MERGE semantics — set/overwrite configs[tableId].columns[col], bumps configVersion
  // unconditionally (even re-setting the same label — Pitfall 5 mirror).
  upsertColumn: (tableId, col, label, spec) =>
    set((s) => {
      const prev = s.configs[tableId] ?? { columns: {} };
      return {
        configs: {
          ...s.configs,
          [tableId]: {
            columns: { ...prev.columns, [col]: { label, format_spec: spec } },
          },
        },
        configVersion: s.configVersion + 1,
      };
    }),

  // DELETE-KEY semantics. STRICT NO-OP when configs[tableId] is absent OR columns[col] is
  // absent — state reference preserved, configVersion NOT bumped (mirrors dynamicViewStore.clearView).
  // Only deletes when entry exists and bumps configVersion on successful removal.
  removeColumn: (tableId, col) =>
    set((s) => {
      const entry = s.configs[tableId];
      if (!entry || !(col in entry.columns)) return s; // strict no-op — preserve state reference
      const nextColumns = { ...entry.columns };
      delete nextColumns[col];
      return {
        configs: {
          ...s.configs,
          [tableId]: { columns: nextColumns },
        },
        configVersion: s.configVersion + 1,
      };
    }),

  // On-demand per-table load: fetch the table's full config from the server and feed into setConfig.
  // Consumers call this to populate the cache lazily; setConfig always bumps configVersion.
  loadConfig: async (tableId) => {
    const rows = await listColumnDisplayConfig(tableId);
    useColumnDisplayConfigStore.getState().setConfig(tableId, rows);
  },

  // Hard-set to initial state; NOT an increment (mirrors dynamicViewStore.reset).
  reset: () => set({ configs: {}, configVersion: 0 }),
}));

// ---------------------------------------------------------------------------
// Pure helpers (co-located — these call getState() + buildFormatter, so they CANNOT live
// in columnFormatter.ts which is a pure lib that forbids store imports)
// ---------------------------------------------------------------------------

/**
 * resolveLabel — returns the stored label for a column, falling back to the raw column name
 * when no label is configured for that table/column pair.
 */
export const resolveLabel = (tableId: number, columnName: string): string =>
  useColumnDisplayConfigStore.getState().configs[tableId]?.columns[columnName]?.label ?? columnName;

/**
 * resolveFormatter — returns a formatter function for the column.
 * When a format_spec is stored, returns buildFormatter(spec) (never throws — raw fallback built-in).
 * When no spec is set / no entry exists, returns an identity passthrough (v) => v.
 */
export const resolveFormatter = (tableId: number, columnName: string): (v: unknown) => string | unknown => {
  const spec = useColumnDisplayConfigStore.getState().configs[tableId]?.columns[columnName]?.format_spec;
  return spec ? buildFormatter(spec) : (v) => v;
};
