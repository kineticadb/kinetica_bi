import { create } from "zustand";
import { useToastStore } from "./toast";

// PITFALL C-04 / AP-4 lock: filters MUST be Record<tableId, ActiveFilter[]> from day 1.
// Retrofit cost is very high — see .planning/research/PITFALLS.md C-04.
//
// distinction note: this store is the CLIENT-TRANSIENT drill-down filter set.
// The existing `views.filter_clause` field on the server (see ViewDto in src/api/client.ts)
// is the SERVER-PERSISTED filter applied at view-materialize time — totally separate concept.
// Phase 10 surfaces both in one filter bar; Phase 9 just builds this client-side store.

// Phase 44 (FILTER-V17-03): Raised from 10 to 25. Multi-column Data Filter widgets need
// headroom — 10 was conservative for drill-down-only usage; 25 provides a realistic budget
// for operator-configured filter widgets. Exported so downstream specs can assert the constant.
export const FILTER_CAP_PER_TABLE = 25; // PITFALL D-04 lock — never silently drop; warn user

export type ActiveFilter = {
  column: string;
  // Phase 44 (FILTER-V17-01): value union widened to carry IN arrays and BETWEEN tuples
  // in addition to the legacy scalar shape. operator discriminator below determines which
  // arm is in use; back-compat callers omit operator and pass a scalar (treated as "eq").
  value:
    | string
    | number
    | boolean
    | Date
    | null
    | (string | number)[]                                  // for operator: "in"
    | [number, number]                                     // for operator: "between" on numeric
    | [string, string];                                    // for operator: "between" on datetime/string
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  // Phase 44 (FILTER-V17-01): optional operator discriminator. Default behavior when absent is "eq"
  // (legacy drill-down callers in WidgetRenderer.tsx:110 omit this field — they continue working).
  // "isNull" is a sentinel for explicit-null filters (column IS NULL); current callers achieve this
  // via dataType: "null" + value: null and that path is preserved, but the explicit "isNull" operator
  // is reserved for future symmetry.
  operator?: "eq" | "in" | "between" | "isNull";
  sourceWidgetId?: number; // optional — Phase 10's DRILL-04 highlight uses it; tests skip it
  addedAt: number;         // Date.now() at addFilter time
};

export type FilterState = {
  filters: Record<number, ActiveFilter[]>;
  filterVersion: number;
  // Open Question #1 resolution (RESEARCH.md): tableId is a SEPARATE param, not on ActiveFilter.
  addFilter: (tableId: number, filter: ActiveFilter) => void;
  // Phase 44 (FILTER-V17-02): Apply button on Data Filter widget calls this to batch
  // N column replacements into ONE filterVersion tick — avoids N×materialize cycles.
  // Replace-semantics: existing entries for same column names are overwritten;
  // entries for columns NOT in the batch are PRESERVED (do not wipe other entries).
  // Respects FILTER_CAP_PER_TABLE — new columns that would push past 25 are rejected
  // (toast shown); existing columns can always be replaced even at cap.
  setBulkFilters: (tableId: number, filters: ActiveFilter[]) => void;
  removeFilter: (tableId: number, column: string) => void;
  clearFilters: (tableId: number) => void;
  // reset() is internal: called from App.tsx on logout, DashboardsPage on dashboard switch.
  reset: () => void;
};

export const useFilterStore = create<FilterState>((set) => ({
  filters: {},
  filterVersion: 0,

  addFilter: (tableId, filter) =>
    set((state) => {
      const existing = state.filters[tableId] ?? [];

      // PITFALL D-04: cap. If we'd exceed, no-op + toast.
      // Note: REPLACE on same column is allowed even at cap (count doesn't increase).
      const sameColumnIdx = existing.findIndex((f) => f.column === filter.column);
      if (sameColumnIdx === -1 && existing.length >= FILTER_CAP_PER_TABLE) {
        useToastStore.getState().showToast(
          `Filter limit reached (${FILTER_CAP_PER_TABLE} per table). Clear some first.`,
          "info"
        );
        return state; // no state change, no version bump
      }

      // Exact-duplicate dedupe (same column AND same value) — silent no-op (matches "click selected = stay selected" UX)
      if (
        sameColumnIdx !== -1 &&
        existing[sameColumnIdx].value === filter.value
      ) {
        return state; // silent — no toast, no version bump
      }

      // PITFALL D-05 lock: same-column-different-value REPLACES, never appends.
      // Single transactional set() — no intermediate state where col=A AND col=B can be observed.
      let newTableFilters: ActiveFilter[];
      if (sameColumnIdx !== -1) {
        newTableFilters = [...existing];
        newTableFilters[sameColumnIdx] = filter;
      } else {
        newTableFilters = [...existing, filter];
      }

      return {
        filters: { ...state.filters, [tableId]: newTableFilters },
        filterVersion: state.filterVersion + 1, // PITFALL S-02 lock: primitive dep MUST advance
      };
    }),

  setBulkFilters: (tableId, batch) =>
    set((state) => {
      const existing = state.filters[tableId] ?? [];

      // Build replacement: start with existing entries whose column is NOT in the batch
      // (preserve other-column entries — drill-down chips on this table survive a Data Filter Apply
      // unless the operator configured the same column on both).
      const batchColumns = new Set(batch.map((f) => f.column));
      const preserved = existing.filter((f) => !batchColumns.has(f.column));

      // Cap check: count after preserved + batch should not exceed FILTER_CAP_PER_TABLE.
      // Columns being REPLACED don't count toward the cap (their slot is reused).
      // Truncate the batch if it would push past the cap; show toast.
      let acceptedBatch = batch;
      if (preserved.length + batch.length > FILTER_CAP_PER_TABLE) {
        const room = FILTER_CAP_PER_TABLE - preserved.length;
        acceptedBatch = batch.slice(0, Math.max(0, room));
        useToastStore
          .getState()
          .showToast(
            `Filter limit reached (${FILTER_CAP_PER_TABLE} per table). Clear some first.`,
            "info",
          );
      }

      const next = [...preserved, ...acceptedBatch];

      return {
        filters: { ...state.filters, [tableId]: next },
        filterVersion: state.filterVersion + 1, // exactly one tick for the whole batch
      };
    }),

  removeFilter: (tableId, column) =>
    set((state) => {
      const existing = state.filters[tableId] ?? [];
      const next = existing.filter((f) => f.column !== column);
      if (next.length === existing.length) return state; // nothing removed — no version bump
      return {
        filters: { ...state.filters, [tableId]: next },
        filterVersion: state.filterVersion + 1,
      };
    }),

  clearFilters: (tableId) =>
    set((state) => {
      const existing = state.filters[tableId] ?? [];
      if (existing.length === 0) return state; // nothing to clear — no version bump
      const next = { ...state.filters };
      delete next[tableId]; // PITFALL S-02: deletion semantics — empty key vs absent key both selector-safe
      return {
        filters: next,
        filterVersion: state.filterVersion + 1,
      };
    }),

  // Internal-only — called from App.tsx on logout and DashboardsPage on dashboard switch.
  // NOT exposed as a user action.
  reset: () => set({ filters: {}, filterVersion: 0 }),
}));
