// Phase 107 Plan 02 (FPANEL-V120-01/02/03/04/06/07/08): the expanded filter-panel
// drawer. Renders INSTEAD of the top bar when dashboard.filter_display_mode ===
// "panel" (the isPanelMode branch lives in DashboardsPage.tsx). Owns NO store
// subscription of its own — DashboardsPage (DashboardOpen) already holds every
// source-of-truth subscription (allStoreFilters/allDvFilters/shapes) and passes
// the already-assembled group props down (Pitfall #1 lock — never reads the
// derived combination registry or any other derived list).
//
// Group order is a hard-locked prop-order contract, NOT computed here: caller
// passes tableGroups, then dvGroups, then spatialGroup — this component renders
// them in exactly that order (tables -> dynamic views -> spatial, 107-CONTEXT.md).
//
// Phase 109 Plan 01 (FCLEAR-V120-01): .filter-panel-header-actions now also renders a
// count-gated "Clear all filters" button (before the collapse button), wired via
// onClearAllFilters to DashboardsPage's clearAllFilters helper (input-store-only clear).
// Phase 108 Plan 02 (FSCOPE-V120-01/02/03) added applies-to + highlight/activate
// prop-threading (FilterPanelChip fields below), forwarded verbatim to FilterChip's
// panel branch — DashboardsPage still computes the appliesTo lookups and closures;
// this component remains a pure prop-forwarder with no store subscription of its own.

import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesRight, faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FilterChip } from "./FilterChip";
import type { WidgetApplyEntry } from "../lib/computeReverseFilterMap";

export type FilterPanelChip = {
  text: string;
  removeAriaLabel: string;
  onRemove: () => void;
  provenance?: string;
  // Phase 108 Plan 02 (FSCOPE-V120-01/02/03) — panel-only applies-to + highlight/activate
  // wiring, forwarded verbatim to FilterChip's panel branch.
  appliesTo?: WidgetApplyEntry[];
  onHighlight?: () => void;
  onClearHighlight?: () => void;
  onActivate?: () => void;
  onActivateWidget?: (widgetId: number) => void;
};

export type FilterPanelGroupData = {
  title: string;
  chips: FilterPanelChip[];
  onClearAll: () => void;
};

export type FilterPanelProps = {
  tableGroups: FilterPanelGroupData[];
  dvGroups: FilterPanelGroupData[];
  spatialGroup?: FilterPanelGroupData;
  count: number;
  onCollapse: () => void;
  // Phase 109 (FCLEAR-V120-01): global clear-all — mutates the input stores only
  // (DashboardsPage wires this to clearAllFilters). Rendered only when count > 0.
  onClearAllFilters: () => void;
};

function FilterPanelGroup({ group }: { group: FilterPanelGroupData }) {
  const [collapsed, setCollapsed] = useState(false);
  const { title, chips, onClearAll } = group;

  return (
    <div className="config-group">
      <div className="filter-panel-group-header">
        <span className="filter-panel-group-title">{title}</span>
        <div className="filter-panel-group-header-actions">
          <button type="button" className="filter-bar-clear" onClick={onClearAll}>
            Clear all
          </button>
          <button
            type="button"
            className="filter-panel-group-toggle"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${title} filters`}
            onClick={() => setCollapsed((c) => !c)}
          >
            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="filter-panel-chips">
          {chips.map((chip, idx) => (
            <FilterChip
              key={`${title}-${idx}`}
              variant="panel"
              text={chip.text}
              removeAriaLabel={chip.removeAriaLabel}
              onRemove={chip.onRemove}
              provenance={chip.provenance}
              appliesTo={chip.appliesTo}
              onHighlight={chip.onHighlight}
              onClearHighlight={chip.onClearHighlight}
              onActivate={chip.onActivate}
              onActivateWidget={chip.onActivateWidget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterPanel({
  tableGroups,
  dvGroups,
  spatialGroup,
  count,
  onCollapse,
  onClearAllFilters,
}: FilterPanelProps) {
  return (
    <div className="filter-panel">
      <div className="filter-panel-header">
        <span className="filter-panel-title">Filters</span>
        <div className="filter-panel-header-actions">
          {count > 0 && (
            <button type="button" className="filter-bar-clear" onClick={onClearAllFilters}>
              Clear all filters
            </button>
          )}
          <button
            type="button"
            className="sidebar-toggle"
            aria-label="Collapse filter panel"
            title="Collapse filter panel"
            onClick={onCollapse}
          >
            <FontAwesomeIcon icon={faAnglesRight} />
          </button>
        </div>
      </div>
      <div className="filter-panel-body">
        {count === 0 ? (
          <div className="filter-panel-empty">
            <span>No active filters</span>
            <span>Filters you apply from charts, tables, or the map will appear here.</span>
          </div>
        ) : (
          <>
            {tableGroups.map((g) => (
              <FilterPanelGroup key={`table-${g.title}`} group={g} />
            ))}
            {dvGroups.map((g) => (
              <FilterPanelGroup key={`dv-${g.title}`} group={g} />
            ))}
            {spatialGroup && <FilterPanelGroup key="spatial" group={spatialGroup} />}
          </>
        )}
      </div>
    </div>
  );
}
