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
//
// Phase 108 Plan 02 (FSCOPE-V120-01/02/03): the panel branch ONLY gains the
// applies-to line/expander + hover/click handlers below. The topbar branch
// (first return) is left BYTE-IDENTICAL — it already ignores `provenance`
// with the same discipline; the five new optional props are simply never
// referenced there.

import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import type { WidgetApplyEntry } from "../lib/computeReverseFilterMap";

export type FilterChipProps = {
  text: string;
  removeAriaLabel: string;
  onRemove: () => void;
  variant: "topbar" | "panel";
  provenance?: string; // only rendered when variant === "panel" AND defined
  // Phase 108 Plan 02 — panel-only fields; the topbar branch never reads these.
  appliesTo?: WidgetApplyEntry[]; // drives "applies to N widgets" + the expander
  onHighlight?: () => void; // onMouseEnter/onFocus -> setHighlighted(ids)
  onClearHighlight?: () => void; // onMouseLeave/onBlur -> clearHighlighted()
  onActivate?: () => void; // click "applies to N widgets" -> scroll topmost + flash all
  onActivateWidget?: (widgetId: number) => void; // expanded row click -> scroll+flash one
};

export function FilterChip({
  text,
  removeAriaLabel,
  onRemove,
  variant,
  provenance,
  appliesTo,
  onHighlight,
  onClearHighlight,
  onActivate,
  onActivateWidget,
}: FilterChipProps) {
  const [expanded, setExpanded] = useState(false);

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

  const n = appliesTo?.length ?? 0;

  return (
    <div
      className="filter-panel-chip"
      onMouseEnter={onHighlight}
      onMouseLeave={onClearHighlight}
      onFocus={onHighlight}
      onBlur={onClearHighlight}
    >
      <div className="filter-panel-chip-row">
        <span className="filter-panel-chip-value" title={text}>
          {text}
        </span>
        <button
          type="button"
          className="filter-bar-chip-dismiss"
          aria-label={removeAriaLabel}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      {provenance && <span className="filter-panel-chip-provenance">{provenance}</span>}
      {appliesTo && (
        <div className="filter-panel-chip-applies">
          <button
            type="button"
            className="filter-panel-chip-applies-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onActivate?.();
            }}
          >
            applies to {n} widgets
          </button>
          {n > 0 && (
            <button
              type="button"
              className="filter-panel-chip-applies-toggle"
              aria-label={`${expanded ? "Collapse" : "Expand"} applies-to list`}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((c) => !c);
              }}
            >
              <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} />
            </button>
          )}
        </div>
      )}
      {appliesTo && expanded && n > 0 && (
        <div className="filter-panel-chip-applies-list">
          {appliesTo.map((entry) => (
            <button
              key={entry.widgetId}
              type="button"
              className="applies-to-row"
              onClick={(e) => {
                e.stopPropagation();
                onActivateWidget?.(entry.widgetId);
              }}
            >
              {entry.widgetTitle}
              {entry.layerNames?.length ? ` — ${entry.layerNames.join(", ")}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
