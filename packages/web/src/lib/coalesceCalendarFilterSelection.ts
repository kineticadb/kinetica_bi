import type { FilterSelectionConfig } from "../types/filterSelection";

// Legacy calendar migration (Phase 109.2 — FSCOPE-V120-05).
// - cfg.filterSelection present (any value) -> use it as-is (explicit scope always wins).
// - cfg.filterSelection absent AND "respondToFilters" key present in the persisted config ->
//     respondToFilters === true  -> undefined (accept-all / default scope)
//     respondToFilters === false -> { sourceMode: "allowlist", allowedSourceWidgetIds: [] } (respond to none)
// - cfg.filterSelection absent AND "respondToFilters" key absent (brand-new post-migration
//   calendar, or a pre-Phase-68 calendar) -> undefined (accept-all), matching every other
//   chart type's DEFAULT_FILTER_SELECTION convention.
export function coalesceCalendarFilterSelection(
  cfg: Record<string, unknown>,
): FilterSelectionConfig | undefined {
  if (cfg.filterSelection !== undefined) {
    return cfg.filterSelection as FilterSelectionConfig;
  }
  if (Object.prototype.hasOwnProperty.call(cfg, "respondToFilters")) {
    return cfg.respondToFilters === true
      ? undefined
      : { sourceMode: "allowlist", allowedSourceWidgetIds: [] };
  }
  return undefined;
}
