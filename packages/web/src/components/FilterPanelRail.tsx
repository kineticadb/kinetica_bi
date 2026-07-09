// Phase 107 Plan 02 (FPANEL-V120-05): collapsed thin rail — shown instead of
// <FilterPanel> when the panel is collapsed. Shows an expand button + an
// active-filter count badge. Owns NO store subscription — count is computed
// by DashboardsPage from its existing input-store subscriptions and passed
// down as a prop (Pitfall #1 lock — never a new derived list).

import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAnglesLeft } from "@fortawesome/free-solid-svg-icons";

export type FilterPanelRailProps = {
  count: number;
  onExpand: () => void;
};

export function FilterPanelRail({ count, onExpand }: FilterPanelRailProps) {
  const isEmpty = count === 0;
  const title = isEmpty ? "No active filters" : `${count} active filters`;

  return (
    <div className="filter-panel-rail">
      <button
        type="button"
        className="sidebar-toggle"
        aria-label="Expand filter panel"
        title="Expand filter panel"
        onClick={onExpand}
      >
        <FontAwesomeIcon icon={faAnglesLeft} />
      </button>
      <span
        className={isEmpty ? "filter-panel-rail-badge filter-panel-rail-badge--empty" : "filter-panel-rail-badge"}
        title={title}
        aria-label={title}
      >
        {count}
      </span>
    </div>
  );
}
