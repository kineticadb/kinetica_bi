import type { FilterViewEntry } from "../store/filterViewStore";

/**
 * Phase 16 (MAP-V13-04 / shared with Phase 15 LIFE-V13-01): proactive TTL expiry check.
 *
 * Returns true when the entry is missing-or-expired and the caller should fall through
 * to the raw-table path (FROM <table> for charts; LAYERS=<schema.table> for map).
 *
 * Lock contract:
 *   - undefined entry → false (no view yet; not "expired", just absent — caller treats
 *     as no-view by reading entry?.viewName which is undefined; both code paths converge)
 *     NOTE: callers should also handle entry === undefined explicitly via optional chaining.
 *     This helper returns false for undefined to keep the boolean semantics narrow:
 *     "is this entry past its expiry?" — undefined entries have no expiry to compare.
 *   - expiresAt=0 placeholder (from markMaterializing pre-call) → true (no real view; act as expired)
 *   - Date.now() >= expiresAt → true (sliding TTL boundary; >= not >)
 *   - Date.now() < expiresAt → false (still valid)
 *
 * Used by MapChartRenderer.tsx Effects 2 + 3 (Phase 16) at the per-layer build site.
 * Inline equivalent in WidgetRenderer.tsx (Phase 15 LIFE-V13-01) may be refactored to use
 * this helper in a follow-up plan; Phase 16 only adds the helper + map call sites.
 */
export function isViewExpired(entry: FilterViewEntry | undefined): boolean {
  if (entry === undefined) return false;
  return Date.now() >= entry.expiresAt;
}
