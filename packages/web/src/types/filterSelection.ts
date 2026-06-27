// Per-visualization filter scope (v1.18 — FSCOPE-V118-01).
// SCOPE LOCK: source-widget allow-list ONLY. Per-column / per-filter exclusion was
// DROPPED from v1.18 (deferred → FSCOPE-V2-02). No per-filter override field here.

// Descriptor for a filter-PRODUCING source. Filter sources are: chart drill-downs,
// the DataFilter widget, and map spatial draws — each carries a sourceWidgetId on the
// ActiveFilter it emits. (Records table, map info popup, legend are NOT sources.)
export type FilterSource = {
  sourceWidgetId: number;
};

export type FilterSelectionConfig = {
  // "all" = accept every active filter (default; backward-compatible with v1.17).
  // "allowlist" = accept only filters whose sourceWidgetId ∈ allowedSourceWidgetIds.
  sourceMode: "all" | "allowlist";
  // Only consulted when sourceMode === "allowlist".
  allowedSourceWidgetIds: number[];
};

// Opt-out default: absent/undefined config behaves identically to this.
export const DEFAULT_FILTER_SELECTION: FilterSelectionConfig = {
  sourceMode: "all",
  allowedSourceWidgetIds: [],
};
