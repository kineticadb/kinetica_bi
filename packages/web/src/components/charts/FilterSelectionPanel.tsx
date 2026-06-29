/**
 * FilterSelectionPanel.tsx — Phase 93 (FSCOPE-V118-01) + Phase 96 gap-closure (96-02)
 *
 * Shared "Filter Scope" config section used by both ChartConfigPanel (chart widgets)
 * and KineticaWmsLayerForm (map WMS layers — Plan 02).
 *
 * Pure presentational component: no store reads. All state lives in props.
 *
 * Gap-closure changes (96-02):
 *  - allowSpatial prop (default true): false for dv-bound vizs (dv+spatial is server-rejected).
 *    When false, the SPATIAL_DRAWS_SENTINEL row is hidden.
 *  - handleCustomizeToggle now pre-populates allowedSourceWidgetIds with ALL currently-listed
 *    source ids (+ sentinel when allowSpatial) so the start state == accept-all (GAP 4).
 *    The accept-none warning is preserved for the manual-uncheck-all case.
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
  /**
   * Whether to show the "Spatial draws (map)" sentinel row.
   * Pass false for dv-bound vizs — dv+spatial is server-rejected (400).
   * Defaults to true (table-bound vizs accept spatial draws).
   *
   * Phase 96-02 gap-closure (GAP 5): suppresses sentinel row for dv-bound vizs.
   */
  allowSpatial?: boolean;
};

export function FilterSelectionPanel({
  value,
  onChange,
  widgets,
  selfWidgetId,
  allowSpatial = true,
}: FilterSelectionPanelProps) {
  const isAllowlist = value !== undefined && value.sourceMode === "allowlist";

  // ── Compute the live source widget list (moved above handlers so pre-check can use it) ──
  const sources = widgets.filter(
    (w) => isFilterProducingWidget(w.type) && w.id !== selfWidgetId,
  );

  // ── Customize toggle ────────────────────────────────────────────────────────
  const handleCustomizeToggle = () => {
    if (isAllowlist) {
      // Uncheck → revert to accept-all
      onChange(undefined);
    } else {
      // Check → enter allowlist mode, pre-checked to ALL current sources (start == accept-all)
      // Phase 96-02 (GAP 4): pre-populate with every currently-listed source id + sentinel
      // so the start state equals accept-all; user unchecks to exclude.
      const ids: (number | string)[] = sources.map((w) => w.id);
      if (allowSpatial) ids.push(SPATIAL_DRAWS_SENTINEL);
      onChange({ sourceMode: "allowlist", allowedSourceWidgetIds: ids });
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

  // ── Orphan detection (numeric ids only — sentinel is never an orphan) ────────
  const liveIds = new Set(widgets.map((w) => w.id));
  const orphanIds: number[] = isAllowlist && value
    ? (value.allowedSourceWidgetIds.filter(
        (id) => typeof id === "number" && !liveIds.has(id),
      ) as number[])
    : [];

  // ── Accept-none warning: shown when allowlist has NO live selected source
  //    AND (when allowSpatial=true) DOES NOT include the spatial sentinel.
  //    When allowSpatial=false, spatial sentinel cannot be selected; warning
  //    depends only on whether any live numeric source is checked. ─────────────
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
  // When allowSpatial=true: warning if no live widget AND no sentinel
  // When allowSpatial=false: warning if no live widget (sentinel cannot be selected)
  const showAcceptNoneWarning =
    isAllowlist && !hasLiveSelection && (allowSpatial ? !hasSentinel : true);

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

          {/* Spatial draws sentinel row — suppressed for dv-bound vizs (allowSpatial=false)
              Phase 96-02 (GAP 5): dv+spatial is server-rejected; hide for dv-bound vizs */}
          {allowSpatial && (
            <label className="config-toggle">
              <input
                type="checkbox"
                checked={hasSentinel}
                onChange={() => toggleSource(SPATIAL_DRAWS_SENTINEL)}
                aria-label="Spatial draws (map)"
              />
              Spatial draws (map)
            </label>
          )}

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
