// Phase 107 Plan 01 (FPANEL-V120-09): shared FilterChip, extracted from the
// existing top-bar chip JSX (DashboardsPage.tsx). Two variants:
//   - "topbar": byte-identical copy of the existing `.filter-bar-chip` markup —
//     top-bar parity is a hard requirement, so this branch must never gain a
//     wrapper element or restructuring that could subtly change flex-wrap
//     behavior while still passing existing assertions.
//   - "panel": new vertical chip shell for the Phase 107-02 filter panel
//     (`.filter-panel-chip*` classes, added to global.css in this same plan).
//
// `text` is always the CALLER's pre-computed chip label (buildChipText(...)
// output, or the spatial `${shape.label} (${shape.measurement})` string) —
// this component never computes it itself.

import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

export type FilterChipProps = {
  text: string;
  removeAriaLabel: string;
  onRemove: () => void;
  variant: "topbar" | "panel";
  provenance?: string; // only rendered when variant === "panel" AND defined
};

export function FilterChip({ text, removeAriaLabel, onRemove, variant, provenance }: FilterChipProps) {
  if (variant === "topbar") {
    // Verbatim copy of the existing DashboardsPage.tsx chip subtree — do not
    // restructure. `provenance` is intentionally unused in this branch (parity).
    return (
      <span className="filter-bar-chip">
        {text}
        <button
          type="button"
          className="filter-bar-chip-dismiss"
          aria-label={removeAriaLabel}
          onClick={onRemove}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </span>
    );
  }

  return (
    <div className="filter-panel-chip">
      <div className="filter-panel-chip-row">
        <span className="filter-panel-chip-value" title={text}>
          {text}
        </span>
        <button
          type="button"
          className="filter-bar-chip-dismiss"
          aria-label={removeAriaLabel}
          onClick={onRemove}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      {provenance && <span className="filter-panel-chip-provenance">{provenance}</span>}
    </div>
  );
}
