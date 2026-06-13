/**
 * Phase 60 Plan 02 (RADIO-V111-03): Radio Group widget runtime renderer.
 *
 * Short-circuits in WidgetRenderer.tsx BEFORE AggregatedWidgetRenderer, exactly
 * like DataFilterRenderer, LegendRenderer, and TimelineRenderer.
 *
 * SOLE-MATERIALIZE-TRIGGER + ACTION-ENGINE DECOUPLING INVARIANT:
 *   This file is a PURE ACTION-ENGINE CONSUMER — it dispatches option selections
 *   through useDashboardContext().applyWidgetAction(action, widget.id) and nothing more.
 *   It imports ZERO filter-store symbols and NEVER bumps the filter version counter.
 *   The transient overlay store (widgetActionStore) records the contribution;
 *   the existing render path in WidgetRenderer / MapChartRenderer deep-merges it
 *   at render time. No filter-system contact. Mirror of DataFilterRenderer.tsx lock.
 *
 * Transient semantics (CONTEXT.md lock):
 *   selectedOptionId is component-local transient state — NOT written to the widget's
 *   persisted config, NOT PATCHed to the server. On dashboard reload / store reset,
 *   the overlay clears; the configured defaultOptionId re-applies on next mount.
 *
 * Live-config read (GAP-24-01-A / 54-01..09 / 58.1 lineage):
 *   widget.config is cast to RadioGroupConfig in the component body EACH render.
 *   The effect that calls applyWidgetAction is keyed on [selectedOptionId] and reads
 *   options from a ref synced every render — NEVER a mount snapshot.
 */

import { useEffect, useRef, useState } from "react";
import type { WidgetDto } from "../../api/client";
import type { RadioGroupConfig, RadioOption } from "../../lib/radioGroupConfig";
import { useDashboardContext } from "../DashboardContext";

type Props = {
  /** The radiogroup WidgetDto — its .config is cast to RadioGroupConfig live each render. */
  widget: WidgetDto;
};

export default function RadioGroupRenderer({ widget }: Props): JSX.Element {
  // ---- Live config read ----
  // Read widget.config LIVE in the component body every render (NOT a mount snapshot).
  // This ensures a config edit + live re-render is always reflected.
  const cfg = (widget.config ?? {}) as unknown as RadioGroupConfig;
  const orientation = cfg.orientation ?? "vertical";
  const title = cfg.title;
  const options = cfg.options ?? [];
  const defaultOptionId = cfg.defaultOptionId;

  // ---- Transient selected state ----
  // Component-local — never persisted. Initialized to defaultOptionId or first option.
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>(
    () => defaultOptionId ?? options[0]?.id,
  );

  // ---- Live options ref ----
  // Synced every render so the effect below reads the CURRENT options on every run,
  // avoiding a stale closure on the options array (live-config read contract).
  const optionsRef = useRef<RadioOption[]>(options);
  optionsRef.current = options;

  // ---- applyWidgetAction from context ----
  // Signature (widened by 60-01): (action, controlId) => WidgetActionResult.
  // widget.id is this control's id (source-control-keyed contribution for switch-replace).
  const { applyWidgetAction } = useDashboardContext();

  // Keep applyWidgetAction in a ref too so the effect doesn't need it as a dep
  // (the function identity may change on provider re-render; ref avoids re-applying on
  // every provider update while still calling the latest version).
  const applyRef = useRef(applyWidgetAction);
  applyRef.current = applyWidgetAction;

  // ---- Effect: apply action on selectedOptionId change ----
  // Keyed on [selectedOptionId, widget.id]. Runs on mount (applies default) and on
  // every user select. Reads options from optionsRef so it always sees the latest config.
  // NOT a mount-only [] effect — the plan requires re-firing when selectedOptionId changes.
  useEffect(() => {
    if (selectedOptionId === undefined) return;
    const currentOptions = optionsRef.current;
    const option = currentOptions.find((o) => o.id === selectedOptionId);
    if (!option) return;
    // Dispatch: controlId = widget.id (source-control-keyed; switch-replace semantics).
    // Dangling target / rejected → applyWidgetAction already fires the toast (Phase 58);
    // the renderer does not crash — it still shows the option as selected.
    applyRef.current(option.action, widget.id);
  }, [selectedOptionId, widget.id]);

  // ---- Empty state gate ----
  // Mirrors DataFilterRenderer's empty gate: render a config hint, no crash.
  if (options.length === 0) {
    return (
      <div className="widget-radiogroup widget-radiogroup--empty" data-testid="radiogroup-renderer">
        <div className="config-hint">
          No options configured. Open the config panel to add radio options.
        </div>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="widget-radiogroup" data-testid="radiogroup-renderer">
      {title !== undefined && title !== "" && (
        <div className="radiogroup-title">{title}</div>
      )}
      <div
        className={`radiogroup-options radiogroup--${orientation}`}
        role="radiogroup"
        aria-label={title ?? "Radio Dashboard Control"}
      >
        {options.map((opt) => {
          const isSelected = selectedOptionId === opt.id;
          return (
            <label
              key={opt.id}
              className={`radiogroup-option${isSelected ? " radiogroup-option--selected" : ""}`}
              data-testid={`radiogroup-option-${opt.id}`}
            >
              <input
                type="radio"
                name={`radiogroup-${widget.id}`}
                value={opt.id}
                checked={isSelected}
                aria-label={opt.label}
                onChange={() => setSelectedOptionId(opt.id)}
                className="radiogroup-input accent-green"
              />
              <span className="radiogroup-label">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
