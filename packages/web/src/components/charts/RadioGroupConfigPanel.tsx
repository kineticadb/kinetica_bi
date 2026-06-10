/**
 * Phase 59 Plan 02 — RadioGroupConfigPanel
 *
 * CustomConfigPanel for the 'radiogroup' chart type.
 *
 * CRITICAL: Reads `widgets` from PROPS (NOT useDashboardContext — WidgetConfigModal
 * is rendered OUTSIDE DashboardContextProvider; useDashboardContext() would throw at runtime).
 *
 * Same-dashboard targets: props.widgets
 * Map-layer targets: useDashboardLayersStore (global Zustand, accessible from modal)
 * Dynamic-view targets: listDynamicViews(dashboardId, signal) — fetched on mount
 *
 * Authoring flow per option:
 *   label + 3-kind target picker (widget / layer / dynamicView) + "Capture from target"
 *   button (calls captureAllowListedSubset) + JSON textarea for configPatch editing
 *
 * Save-time validation: validateRadioOption / isRadioGroupConfigValid delegate to
 * Phase 58 validateActionPatch — out-of-list / wrong-type / meta-proto / empty binding
 * is rejected; isValid(false) disables Apply. isValid(true) when all options valid.
 *
 * NO runtime apply/select/default-on-open — Phase 60. This is authoring only.
 *
 * renderMode (camelCase) is the ONLY render-mode key.
 */

import { useEffect, useMemo, useState } from "react";
import type { ConfigPanelProps } from "./registry";
import type {
  RadioGroupConfig,
  RadioOption,
  RadioOrientation,
} from "../../lib/radioGroupConfig";
import {
  validateRadioOption,
  isRadioGroupConfigValid,
} from "../../lib/radioGroupConfig";
import { captureAllowListedSubset } from "../../lib/radioGroupCapture";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { listDynamicViews } from "../../api/client";
import type { DynamicViewRow } from "../../api/client";

// ---------------------------------------------------------------------------
// Helper: cast config prop to RadioGroupConfig with safe defaults
// ---------------------------------------------------------------------------

function parseConfig(raw: Record<string, unknown>): RadioGroupConfig {
  return {
    title: raw.title as string | undefined,
    orientation: (raw.orientation as RadioOrientation | undefined) ?? "vertical",
    defaultOptionId: raw.defaultOptionId as string | undefined,
    options: (raw.options as RadioOption[] | undefined) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Helper: generate a stable option id
// ---------------------------------------------------------------------------

let _idCounter = 0;
function generateOptionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `opt-${Date.now()}-${_idCounter++}`;
}

// ---------------------------------------------------------------------------
// OptionRow component
// ---------------------------------------------------------------------------

type OptionRowProps = {
  option: RadioOption;
  idx: number;
  widgets: ConfigPanelProps["widgets"];
  layers: ReturnType<typeof useDashboardLayersStore.getState>["layers"];
  dynamicViews: DynamicViewRow[];
  widgetTypeFor: (id: number) => string | undefined;
  onChange: (updated: RadioOption) => void;
  onRemove: () => void;
};

function OptionRow({
  option,
  idx,
  widgets,
  layers,
  dynamicViews,
  widgetTypeFor,
  onChange,
  onRemove,
}: OptionRowProps): JSX.Element {
  const [jsonError, setJsonError] = useState<string | null>(null);

  const allWidgets = widgets ?? [];
  const { kind, id: targetId } = option.action.target;

  // Encode target as "kind:id" for the <select> value
  const targetValue = `${kind}:${targetId}`;

  const handleTargetChange = (raw: string) => {
    const [newKind, newIdStr] = raw.split(":") as [
      "widget" | "layer" | "dynamicView",
      string,
    ];
    const newId = Number(newIdStr);
    onChange({
      ...option,
      action: {
        target: { kind: newKind, id: newId },
        configPatch: {}, // RESET — a new target invalidates the old patch
      },
    });
    setJsonError(null);
  };

  const handleCapture = () => {
    const target = option.action.target;
    let patch: Record<string, unknown> = {};

    if (target.kind === "widget") {
      const widget = allWidgets.find((w) => w.id === target.id);
      const wt = widgetTypeFor(target.id);
      patch = captureAllowListedSubset({ target, widgetType: wt, widget });
    } else if (target.kind === "layer") {
      const layer = layers.find((l) => l.id === target.id);
      patch = captureAllowListedSubset({ target, layer });
    } else if (target.kind === "dynamicView") {
      const dv = dynamicViews.find((d) => d.id === target.id);
      const dvConfig = dv ? { name: dv.name } : undefined;
      patch = captureAllowListedSubset({
        target,
        dynamicViewConfig: dvConfig,
      });
    }

    onChange({
      ...option,
      action: { ...option.action, configPatch: patch },
    });
    setJsonError(null);
  };

  const handleJsonChange = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setJsonError(null);
      onChange({
        ...option,
        action: { ...option.action, configPatch: parsed },
      });
    } catch {
      setJsonError("Invalid JSON — fix before saving");
    }
  };

  // Per-option validation reasons (for display only — isValid handled in parent)
  const widgetType =
    kind === "widget" ? widgetTypeFor(targetId) : undefined;
  const validation = validateRadioOption(option, widgetType);
  const reasons = validation.valid ? [] : validation.reasons;
  const labelMissing = option.label.trim() === "";

  // Orphan-target detection: the configured target kind+id must resolve against available lists.
  // Only flag as orphaned when a specific target is set (id !== 0) and it is absent from all lists.
  const targetIsSet = targetId !== 0;
  const targetResolved =
    !targetIsSet ||
    (kind === "widget" && allWidgets.some((w) => w.id === targetId)) ||
    (kind === "layer" && layers.some((l) => l.id === targetId)) ||
    (kind === "dynamicView" && dynamicViews.some((dv) => dv.id === targetId));
  const isOrphanTarget = targetIsSet && !targetResolved;

  const captureEmpty =
    Object.keys(option.action.configPatch).length === 0 &&
    !jsonError &&
    !labelMissing &&
    validation.valid;

  return (
    <div
      className="radiogroup-option-row"
      data-testid={`radiogroup-option-row-${idx}`}
      style={{
        border: "1px solid var(--border-color, #3a3a4a)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 10,
        background: "var(--panel-bg, #1e1e2e)",
      }}
    >
      {/* Row header: option number + remove */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--text-muted, #888)",
          }}
        >
          OPTION {idx + 1}
        </span>
        <button
          type="button"
          className="ghost-sm ghost-danger"
          aria-label={`Remove option ${idx + 1}`}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>

      {/* Label */}
      <div className="ds-field" style={{ marginBottom: 8 }}>
        <span className="ds-field-label">Label</span>
        <input
          className="ds-select"
          type="text"
          aria-label={`Option ${idx + 1} label`}
          value={option.label}
          placeholder="Option label"
          onChange={(e) => onChange({ ...option, label: e.target.value })}
          style={{ width: "100%" }}
        />
        {labelMissing && (
          <div
            className="config-hint"
            style={{ color: "var(--danger, #c44)" }}
            data-testid={`label-error-${idx}`}
          >
            Label is required
          </div>
        )}
      </div>

      {/* Target picker */}
      <div className="ds-field" style={{ marginBottom: 8 }}>
        <span className="ds-field-label">Target</span>
        <select
          className="ds-select"
          aria-label={`Option ${idx + 1} target`}
          value={targetValue}
          onChange={(e) => handleTargetChange(e.target.value)}
          style={{ width: "100%" }}
        >
          {allWidgets.length > 0 && (
            <optgroup label="Widgets">
              {allWidgets.map((w) => (
                <option key={`widget:${w.id}`} value={`widget:${w.id}`}>
                  {w.title || `Widget #${w.id}`}
                </option>
              ))}
            </optgroup>
          )}
          {layers.length > 0 && (
            <optgroup label="Map Layers">
              {layers.map((l) => (
                <option key={`layer:${l.id}`} value={`layer:${l.id}`}>
                  {(l.config?.title as string | undefined) ||
                    `Layer #${l.id}`}
                </option>
              ))}
            </optgroup>
          )}
          {dynamicViews.length > 0 && (
            <optgroup label="Dynamic Views">
              {dynamicViews.map((dv) => (
                <option
                  key={`dynamicView:${dv.id}`}
                  value={`dynamicView:${dv.id}`}
                >
                  {dv.name}
                </option>
              ))}
            </optgroup>
          )}
          {allWidgets.length === 0 &&
            layers.length === 0 &&
            dynamicViews.length === 0 && (
              <option value={targetValue} disabled>
                — no targets available —
              </option>
            )}
        </select>
        {isOrphanTarget && (
          <div
            className="config-hint"
            style={{ color: "var(--warning, #d97706)" }}
            data-testid={`orphan-target-warning-${idx}`}
          >
            Target no longer available — pick a new target
          </div>
        )}
      </div>

      {/* Capture from target */}
      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          className="ghost-sm"
          aria-label={`Capture from target for option ${idx + 1}`}
          onClick={handleCapture}
          style={{ color: "var(--accent, #22c55e)" }}
        >
          Capture from target
        </button>
        {captureEmpty && (
          <span
            className="config-hint"
            style={{ marginLeft: 8, color: "var(--text-muted, #888)" }}
          >
            no capturable fields on this target
          </span>
        )}
      </div>

      {/* JSON editor for configPatch */}
      <div className="ds-field" style={{ marginBottom: 4 }}>
        <span className="ds-field-label">Config Patch (JSON)</span>
        <textarea
          aria-label={`Option ${idx + 1} config patch JSON`}
          className="ds-select"
          rows={4}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            resize: "vertical",
          }}
          value={JSON.stringify(option.action.configPatch, null, 2)}
          onChange={(e) => handleJsonChange(e.target.value)}
        />
        {jsonError && (
          <div
            className="config-hint"
            style={{ color: "var(--danger, #c44)" }}
            data-testid={`json-error-${idx}`}
          >
            {jsonError}
          </div>
        )}
      </div>

      {/* Validation reasons */}
      {reasons.length > 0 && (
        <div
          className="config-hint"
          style={{ color: "var(--danger, #c44)" }}
          data-testid={`validation-errors-${idx}`}
        >
          {reasons.map((r, i) => (
            <div key={i}>{r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadioGroupConfigPanel — main export
// ---------------------------------------------------------------------------

export default function RadioGroupConfigPanel({
  config,
  onChange,
  widgets,
  isValid,
}: ConfigPanelProps): JSX.Element {
  const cfg = parseConfig(config);
  const allWidgets = widgets ?? [];
  const layers = useDashboardLayersStore((s) => s.layers);
  const [dynamicViews, setDynamicViews] = useState<DynamicViewRow[]>([]);

  // Derive dashboardId from the first widget (all same-dashboard)
  const dashboardId = allWidgets[0]?.dashboard_id;

  // Fetch dynamic views for this dashboard
  useEffect(() => {
    if (dashboardId === undefined) return;
    const controller = new AbortController();
    listDynamicViews(dashboardId, controller.signal)
      .then((res) => setDynamicViews(res.dynamic_views))
      .catch(() => {
        // Tolerate failure (network down, no dvs) — silently leave dvs empty
      });
    return () => controller.abort();
  }, [dashboardId]);

  // widgetTypeFor: resolves widget type by id from props.widgets
  const widgetTypeFor = useMemo(
    () =>
      (id: number): string | undefined =>
        allWidgets.find((w) => w.id === id)?.type,
    [allWidgets],
  );

  // Compute validity and signal isValid
  const allValid = useMemo(
    () => isRadioGroupConfigValid(cfg, widgetTypeFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(cfg), widgetTypeFor],
  );

  useEffect(() => {
    isValid?.(allValid);
  }, [allValid, isValid]);

  // ----- Handlers -----

  const handleAddOption = () => {
    const firstTargetKind: "widget" | "layer" | "dynamicView" =
      allWidgets.length > 0
        ? "widget"
        : layers.length > 0
          ? "layer"
          : "dynamicView";
    const firstTargetId =
      allWidgets.length > 0
        ? allWidgets[0].id
        : layers.length > 0
          ? layers[0].id
          : 0;

    const newOption: RadioOption = {
      id: generateOptionId(),
      label: "",
      action: {
        target: { kind: firstTargetKind, id: firstTargetId },
        configPatch: {},
      },
    };
    onChange({ ...config, options: [...cfg.options, newOption] });
  };

  const handleRemoveOption = (idx: number) => {
    const next = cfg.options.filter((_, i) => i !== idx);
    // Clear defaultOptionId if it pointed to the removed option
    const removedId = cfg.options[idx]?.id;
    const newDefaultId =
      cfg.defaultOptionId === removedId ? undefined : cfg.defaultOptionId;
    onChange({ ...config, options: next, defaultOptionId: newDefaultId });
  };

  const handleOptionChange = (idx: number, updated: RadioOption) => {
    const next = [...cfg.options];
    next[idx] = updated;
    onChange({ ...config, options: next });
  };

  return (
    <div
      className="config-group"
      role="group"
      aria-labelledby="radiogroup-config-label"
    >
      <label id="radiogroup-config-label" className="config-group-label">
        RADIO GROUP CONFIG
      </label>

      {/* Optional title */}
      <div className="ds-field" style={{ marginBottom: 10 }}>
        <span className="ds-field-label">Widget title (optional)</span>
        <input
          className="ds-select"
          type="text"
          aria-label="Radio group title"
          value={cfg.title ?? ""}
          placeholder="e.g. View Mode"
          onChange={(e) =>
            onChange({
              ...config,
              title: e.target.value || undefined,
            })
          }
          style={{ width: "100%" }}
        />
      </div>

      {/* Orientation toggle */}
      <div className="ds-field" style={{ marginBottom: 10 }}>
        <span className="ds-field-label">Orientation</span>
        <select
          className="ds-select"
          aria-label="Radio group orientation"
          value={cfg.orientation}
          onChange={(e) =>
            onChange({
              ...config,
              orientation: e.target.value as RadioOrientation,
            })
          }
        >
          <option value="vertical">Vertical (default)</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </div>

      {/* Options list */}
      <div
        className="config-group-label"
        style={{ marginTop: 14, marginBottom: 6 }}
      >
        OPTIONS
      </div>

      {cfg.options.length === 0 && (
        <div className="config-hint">
          No options yet. Click &quot;Add option&quot; to add one.
        </div>
      )}

      {cfg.options.map((option, idx) => (
        <OptionRow
          key={option.id}
          option={option}
          idx={idx}
          widgets={widgets}
          layers={layers}
          dynamicViews={dynamicViews}
          widgetTypeFor={widgetTypeFor}
          onChange={(updated) => handleOptionChange(idx, updated)}
          onRemove={() => handleRemoveOption(idx)}
        />
      ))}

      <button
        type="button"
        className="ghost-sm radiogroup-add-option"
        aria-label="Add option"
        onClick={handleAddOption}
        style={{ color: "var(--accent, #22c55e)", marginBottom: 12 }}
      >
        + Add option
      </button>

      {/* Default option selector */}
      {cfg.options.length > 0 && (
        <div className="ds-field" style={{ marginTop: 8 }}>
          <span className="ds-field-label">Default option (optional)</span>
          <select
            className="ds-select"
            aria-label="Default option"
            value={cfg.defaultOptionId ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                defaultOptionId: e.target.value || undefined,
              })
            }
          >
            <option value="">(none)</option>
            {cfg.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label || `Option ${cfg.options.indexOf(opt) + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
