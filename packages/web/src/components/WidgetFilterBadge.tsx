/**
 * Phase 95 (COMM-V118-01): On-widget "N of M filters" badge.
 *
 * Renders ONLY when >=1 active filter (or accepted shape) is ignored by a chart widget's
 * filterSelection config. Accept-all / no-active-filters → returns null (SC1: byte-identical
 * to v1.17 visuals for unconfigured widgets).
 *
 * Badge format: "{N} of {M} filters"  (SC2)
 * Hover breakdown via native title= attribute (SC3, locked decision #5 — no popover exists).
 * CSS class: .widget-filter-badge in global.css (SC4, added before this component).
 * Theme tokens only: var(--accent) / var(--accent-text) — no raw hex (SC2).
 */

import { useFilterScopeSummary, type FilterScopeSummary } from "../lib/useFilterScopeSummary";
import type { ActiveFilter } from "../store/filterStore";
import type { Shape } from "../store/spatialFilterStore";
import type { FilterSelectionConfig } from "../types/filterSelection";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  cfg: FilterSelectionConfig | undefined;
  tableId: number | undefined;
  dynamicViewId: number | undefined;
  spatialCapable: boolean;
};

// ─── Breakdown title builder ──────────────────────────────────────────────────

/**
 * Builds the native title= attribute text for hover breakdown (SC3).
 * Applied: comma-joined filter column names + shape labels.
 * Ignored: comma-joined filter column names + shape labels with "source excluded" reason.
 * Kept simple (column name only for filters) — col name is sufficient for SC3.
 */
export function buildBreakdownTitle(summary: FilterScopeSummary): string {
  // Label helpers
  const filterLabel = (f: ActiveFilter) => f.column;
  const shapeLabel = (s: Shape) => s.label ?? "drawn shape";

  const appliedFilterLabels = summary.applied.filters.map(filterLabel);
  const appliedShapeLabels = summary.applied.shapes.map(shapeLabel);
  const allAppliedLabels = [...appliedFilterLabels, ...appliedShapeLabels];

  const ignoredLabels = summary.ignored.map((item) =>
    item.kind === "filter" ? filterLabel(item.filter) : shapeLabel(item.shape),
  );

  const appliedStr =
    allAppliedLabels.length > 0 ? allAppliedLabels.join(", ") : "none";
  const ignoredStr =
    ignoredLabels.length > 0 ? ignoredLabels.join(", ") : "none";

  return `Applied: ${appliedStr}\nIgnored (source excluded): ${ignoredStr}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const WidgetFilterBadge = (props: Props) => {
  const summary = useFilterScopeSummary(props);

  // Locked decision #4: render ONLY when >=1 active filter (or shape) is ignored.
  if (summary.appliedCount >= summary.totalCount) return null;

  const title = buildBreakdownTitle(summary);

  return (
    <span
      className="widget-filter-badge"
      title={title}
      role="status"
      aria-label={`${summary.appliedCount} of ${summary.totalCount} filters applied. ${title}`}
    >
      {summary.appliedCount} of {summary.totalCount} filters
    </span>
  );
};
