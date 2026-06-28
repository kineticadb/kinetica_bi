/**
 * FilterSelectionPanel.tsx — Phase 93 (FSCOPE-V118-01)
 *
 * Shared "Filter Scope" config section used by both ChartConfigPanel (chart widgets)
 * and KineticaWmsLayerForm (map WMS layers — Plan 02).
 *
 * Pure presentational component: no store reads. All state lives in props.
 *
 * CSS: reuses ONLY existing global.css classes:
 *   config-group, config-group-label, config-toggle, config-hint
 * No new class names. No raw hex — danger text via var(--danger) token only.
 */

import type { FilterSelectionConfig } from "../../types/filterSelection";
import type { WidgetDto } from "../../api/client";
import { isFilterProducingWidget, SPATIAL_DRAWS_SENTINEL } from "./filterSourceTypes";

type FilterSelectionPanelProps = {
  /** Current config — undefined means accept-all (the default). */
  value: FilterSelectionConfig | undefined;
  /** Called with next config, or undefined to revert to accept-all. */
  onChange: (next: FilterSelectionConfig | undefined) => void;
  /** Full widget list from the dashboard (will be filtered to filter-producing types). */
  widgets: WidgetDto[];
  /**
   * The widget being configured. Excluded from the source checklist so a widget
   * cannot list itself as a filter source. Omit for map WMS layers (Plan 02).
   */
  selfWidgetId?: number;
};

export function FilterSelectionPanel({
  value,
  onChange,
  widgets,
  selfWidgetId,
}: FilterSelectionPanelProps) {
  const isAllowlist = value !== undefined && value.sourceMode === "allowlist";

  // ── Customize toggle ────────────────────────────────────────────────────────
  const handleCustomizeToggle = () => {
    if (isAllowlist) {
      // Uncheck → revert to accept-all
      onChange(undefined);
    } else {
      // Check → enter allowlist mode with empty selection
      onChange({ sourceMode: "allowlist", allowedSourceWidgetIds: [] });
    }
  };

  // ── Toggle a single source id in the allowedSourceWidgetIds array ───────────
  const toggleSource = (id: number | string) => {
    if (!isAllowlist || !value) return;
    const current = value.allowedSourceWidgetIds;
    const next = current.includes(id as never)
      ? current.filter((x) => x !== id)
      : [...current, id];
    onChange({ ...value, allowedSourceWidgetIds: next });
  };

  // ── Compute the live source widget list ──────────────────────────────────────
  const sources = widgets.filter(
    (w) => isFilterProducingWidget(w.type) && w.id !== selfWidgetId,
  );

  // ── Orphan detection (numeric ids only — sentinel is never an orphan) ────────
  const liveIds = new Set(widgets.map((w) => w.id));
  const orphanIds: number[] = isAllowlist && value
    ? (value.allowedSourceWidgetIds.filter(
        (id) => typeof id === "number" && !liveIds.has(id),
      ) as number[])
    : [];

  // ── Accept-none warning: shown when allowlist has NO live selected source
  //    and DOES NOT include the spatial sentinel ─────────────────────────────
  const hasSentinel =
    isAllowlist && value
      ? value.allowedSourceWidgetIds.includes(SPATIAL_DRAWS_SENTINEL)
      : false;
  const hasLiveSelection =
    isAllowlist && value
      ? value.allowedSourceWidgetIds.some(
          (id) => typeof id === "number" && liveIds.has(id),
        )
      : false;
  const showAcceptNoneWarning = isAllowlist && !hasSentinel && !hasLiveSelection;

  return (
    <div className="config-group">
      <div className="config-group-label">Filter Scope</div>

      {/* Customize toggle */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={isAllowlist}
          onChange={handleCustomizeToggle}
          aria-label="Customize"
        />
        Customize
      </label>

      {!isAllowlist && (
        <span className="config-hint">Accept all filters</span>
      )}

      {isAllowlist && (
        <>
          {/* Accept-none warning */}
          {showAcceptNoneWarning && (
            <span className="config-hint" style={{ color: "var(--danger)" }}>
              No sources selected — this visualization ignores all filters. Uncheck
              Customize to accept all.
            </span>
          )}

          {/* Widget source checklist */}
          {sources.length === 0 ? (
            <span className="config-hint">
              No filter-producing widgets on this dashboard.
            </span>
          ) : (
            sources.map((w) => (
              <label key={w.id} className="config-toggle">
                <input
                  type="checkbox"
                  checked={value!.allowedSourceWidgetIds.includes(w.id)}
                  onChange={() => toggleSource(w.id)}
                  aria-label={w.title}
                />
                {w.title} ({w.type})
              </label>
            ))
          )}

          {/* Spatial draws sentinel row — ALWAYS rendered, not self-excluded, not orphan-checked */}
          <label className="config-toggle">
            <input
              type="checkbox"
              checked={hasSentinel}
              onChange={() => toggleSource(SPATIAL_DRAWS_SENTINEL)}
              aria-label="Spatial draws (map)"
            />
            Spatial draws (map)
          </label>

          {/* Orphan warnings for numeric ids no longer on the dashboard */}
          {orphanIds.map((id) => (
            <span
              key={id}
              className="config-hint"
              style={{ color: "var(--danger)" }}
            >
              ⚠ Deleted widget (id: {id})
            </span>
          ))}
        </>
      )}
    </div>
  );
}
