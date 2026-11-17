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

import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import type { WidgetApplyEntry } from "../lib/computeReverseFilterMap";

export const AI_FILTER_PROVENANCE = "from AI assistant";

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
  aiApplied?: boolean; // 138 D-14: small "AI" tag (existing widget-filter-badge class)
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
  aiApplied,
}: FilterChipProps) {
  const [expanded, setExpanded] = useState(false);

  // Quick 261117-hls: the canvas highlight is ON while the chip is hovered OR holds KEYBOARD focus,
  // and OFF otherwise. Tracking both keeps it from sticking: a mouse-clicked button that regains
  // focus when the user returns to the tab is not :focus-visible; focus moving between the chip's
  // own buttons is not a blur; a blur while the mouse is still over the chip keeps it on; and a chip
  // removed while hovered (its ✕, "Clear all") clears its highlight on unmount.
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const litRef = useRef(false);
  const handlersRef = useRef({ onHighlight, onClearHighlight });
  handlersRef.current = { onHighlight, onClearHighlight };
  const syncHighlight = () => {
    const lit = hoveredRef.current || focusedRef.current;
    if (lit === litRef.current) return;
    litRef.current = lit;
    (lit ? handlersRef.current.onHighlight : handlersRef.current.onClearHighlight)?.();
  };
  useEffect(() => () => {
    if (litRef.current) handlersRef.current.onClearHighlight?.();
  }, []);

  if (variant === "topbar") {
    // Byte-identical for non-AI chips; the AI tag is a conditional sibling.
    // `provenance` is intentionally unused in this branch (parity).
    return (
      <span className="filter-bar-chip">
        {text}
        {aiApplied && (
          <span className="widget-filter-badge" title="Applied by the AI assistant">
            AI
          </span>
        )}
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
  const prov = provenance ?? (aiApplied ? AI_FILTER_PROVENANCE : undefined);

  return (
    <div
      className="filter-panel-chip"
      onMouseEnter={() => { hoveredRef.current = true; syncHighlight(); }}
      onMouseLeave={() => { hoveredRef.current = false; syncHighlight(); }}
      onFocus={(e) => { focusedRef.current = isKeyboardFocus(e.target); syncHighlight(); }}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        focusedRef.current = false;
        syncHighlight();
      }}
    >
      <div className="filter-panel-chip-row">
        <span className="filter-panel-chip-value" title={text}>
          {text}
        </span>
        {aiApplied && (
          <span className="widget-filter-badge" title="Applied by the AI assistant">
            AI
          </span>
        )}
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
      {prov && <span className="filter-panel-chip-provenance">{prov}</span>}
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

/** True when `el` was focused from the keyboard (not by a click). */
function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false; // engines without :focus-visible: hover still drives the highlight
  }
}
