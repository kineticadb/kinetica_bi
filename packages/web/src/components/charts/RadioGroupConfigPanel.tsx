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
 *   label + per-option TARGET LIST (N targets with add/remove, each with 3-kind target picker,
 *   Capture, layer → RadioLayerConfigEditor side-by-side, widget/dv → JSON textarea, Advanced JSON)
 *   Single-target: no list chrome (identical to Phase 60.1). Multi-target: per-target headers
 *   and remove affordances appear only when actions.length > 1.
 *
 * Save-time validation: validateRadioOption(option, widgetTypeFor) / isRadioGroupConfigValid
 *   delegate to Phase 58 validateActionPatch — out-of-list / wrong-type / meta-proto / empty
 *   binding is rejected; isValid(false) disables Apply. isValid(true) when all options valid.
 *
 * Phase 60.1 Plan 02:
 *   - RadioLayerConfigEditor renders for layer targets (SC1)
 *   - tables prop destructured for columns resolution (SC3)
 *   - Per-option CbConfigForm validity folded into isValid plumbing (CONTEXT line 50, LOCKED)
 *   - JSON textarea wrapped in collapsible Advanced <details> for layer targets (SC4)
 *   - Widget/dv targets unchanged (SC4)
 *
 * Phase 60.2 Plan 02:
 *   - OptionRow authors a PER-OPTION TARGET LIST over option.actions[] (add/remove).
 *   - TargetEditor sub-component: one action's picker + editor + Advanced JSON.
 *   - Single-target CLEAN: list chrome (target header, per-target Remove) only when actions.length > 1.
 *   - Save writes actions[] + clears legacy action field on every write.
 *   - handleAddOption seeds actions: [{...}] (not legacy action: {...}).
 *   - validateRadioOption(option, widgetTypeFor) — new resolver signature from wave 1.
 *   - cbValidMap keyed by "optionIdx:targetIdx" for per-target classbreak validity.
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
  getOptionActions,
  validateRadioOption,
  isRadioGroupConfigValid,
} from "../../lib/radioGroupConfig";
import type { WidgetAction } from "../../lib/widgetAction";
import { captureAllowListedSubset } from "../../lib/radioGroupCapture";
import { useDashboardLayersStore } from "../../store/dashboardLayersStore";
import { listDynamicViews } from "../../api/client";
import type { DynamicViewRow, DashboardLayerDto } from "../../api/client";
import type { Column } from "../../lib/columnTypes";
import RadioLayerConfigEditor from "./RadioLayerConfigEditor";

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
// Helper: layer display name for the target picker
// ---------------------------------------------------------------------------

/**
 * Resolve a map layer's display name — mirrors LayersModal.layerName / the legend:
 * operator-set `config.name` wins; otherwise `{source} — {renderMode}` where source is the
 * dynamic-view's name (dv-bound) or `{schema}.{table}` (table-bound); final fallback `Layer #{id}`.
 * (The old picker read `config.title`, which layers don't use, so it always showed "Layer #N".)
 */
function resolveLayerLabel(
  layer: DashboardLayerDto,
  tables: ConfigPanelProps["tables"],
  dynamicViews: DynamicViewRow[],
): string {
  const custom = (layer.config as { name?: string } | undefined)?.name;
  if (typeof custom === "string" && custom.trim().length > 0) return custom.trim();
  let sourceName: string | undefined;
  if (layer.dynamic_view_id != null) {
    sourceName = dynamicViews.find((d) => d.id === layer.dynamic_view_id)?.name;
  } else {
    const t = tables?.find((tb) => tb.id === layer.table_id);
    sourceName = t ? (t.schema ? `${t.schema}.${t.name}` : t.name) : undefined;
  }
  if (sourceName) {
    const renderMode =
      (layer.config as { renderMode?: string } | undefined)?.renderMode ?? "raster";
    return `${sourceName} — ${renderMode}`;
  }
  return `Layer #${layer.id}`;
}

// ---------------------------------------------------------------------------
// TargetEditor — renders ONE action within an OptionRow
// ---------------------------------------------------------------------------

type TargetEditorProps = {
  action: WidgetAction;
  optionIdx: number;
  targetIdx: number;
  /** Total number of targets in this option — drives single-target-clean logic */
  totalTargets: number;
  widgets: ConfigPanelProps["widgets"];
  layers: ReturnType<typeof useDashboardLayersStore.getState>["layers"];
  dynamicViews: DynamicViewRow[];
  tables: ConfigPanelProps["tables"];
  widgetTypeFor: (id: number) => string | undefined;
  onChange: (next: WidgetAction) => void;
  onCbValid: (valid: boolean) => void;
  onRemove?: () => void;
};

function TargetEditor({
  action,
  optionIdx,
  targetIdx,
  totalTargets,
  widgets,
  layers,
  dynamicViews,
  tables,
  widgetTypeFor,
  onChange,
  onCbValid,
  onRemove,
}: TargetEditorProps): JSX.Element {
  const [jsonError, setJsonError] = useState<string | null>(null);

  const allWidgets = widgets ?? [];
  const { kind, id: targetId } = action.target;

  // Encode target as "kind:id" for the <select> value
  const targetValue = `${kind}:${targetId}`;

  const handleTargetChange = (raw: string) => {
    const [newKind, newIdStr] = raw.split(":") as [
      "widget" | "layer" | "dynamicView",
      string,
    ];
    const newId = Number(newIdStr);
    onChange({
      target: { kind: newKind, id: newId },
      configPatch: {}, // RESET — a new target invalidates the old patch
    });
    setJsonError(null);
  };

  const handleCapture = () => {
    const target = action.target;
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

    onChange({ ...action, configPatch: patch });
    setJsonError(null);
  };

  const handleJsonChange = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setJsonError(null);
      onChange({ ...action, configPatch: parsed });
    } catch {
      setJsonError("Invalid JSON — fix before saving");
    }
  };

  // Resolve columns for CbConfigForm (when kind === "layer")
  let columns: Column[] = [];
  let schema: string | undefined;
  let tableName: string | undefined;
  let tableRef: string | undefined;
  let autoSuggestDisabledReason: string | undefined;
  // Phase 60.2 follow-up: the target layer's CURRENT config, as a flat baseline snapshot.
  // The editor merges the option's configPatch ON TOP so the form OPENS reflecting the
  // layer's real appearance (render-mode radio checked, params populated) instead of blank.
  let baseSnapshot: Record<string, unknown> = {};

  if (kind === "layer") {
    const layer = layers.find((l) => l.id === targetId);
    if (layer) {
      // Build the flat baseline from the layer DTO: nested config keys (renderMode + style)
      // spread flat, plus top-level cb_config/track_config/info_* (the snapshot shape the
      // editor's adapter consumes). Data-binding/spatial keys are harmless for display
      // (spatial section is hidden) and are stripped on write by layerFormToSnapshot.
      baseSnapshot = {
        ...((layer.config as Record<string, unknown> | undefined) ?? {}),
        ...(layer.cb_config != null ? { cb_config: layer.cb_config } : {}),
        ...(layer.track_config != null ? { track_config: layer.track_config } : {}),
        ...(layer.info_enabled != null ? { info_enabled: layer.info_enabled } : {}),
        ...(layer.info_columns != null ? { info_columns: layer.info_columns } : {}),
        ...(layer.info_template != null ? { info_template: layer.info_template } : {}),
      };
      if (layer.dynamic_view_id == null) {
        // Table-bound: resolve columns from tables prop (LayersModal pattern)
        const table = tables?.find((t) => t.id === layer.table_id);
        columns = table
          ? Object.entries(table.columns).map(([name, type]) => ({ name, type }))
          : [];
        schema = table?.schema;
        tableName = table?.name;
        tableRef = table ? `${table.schema}.${table.name}` : undefined;
        autoSuggestDisabledReason = undefined;
      } else {
        // DV-bound: resolve columns from dv.columns_json
        const dv = dynamicViews.find((d) => d.id === layer.dynamic_view_id);
        if (dv?.columns_json != null) {
          try {
            // columns_json may be a parsed array or a JSON string
            const parsed: unknown = typeof dv.columns_json === "string"
              ? JSON.parse(dv.columns_json)
              : dv.columns_json;
            if (Array.isArray(parsed)) {
              columns = (parsed as unknown[])
                .filter(
                  (c): c is Column =>
                    typeof (c as Column)?.name === "string" &&
                    typeof (c as Column)?.type === "string",
                );
            }
          } catch {
            columns = [];
          }
          autoSuggestDisabledReason = undefined;
        } else {
          // Not materialized or columns_json missing
          columns = [];
          autoSuggestDisabledReason =
            "Materialize this dynamic view to enable auto-suggest";
        }
        schema = "";
        tableName = dv?.name;
        tableRef = undefined;
      }
    }
  }

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
    Object.keys(action.configPatch).length === 0 &&
    !jsonError;

  // SINGLE-TARGET CLEAN (SC4): only show list chrome when more than one target
  const showListChrome = totalTargets > 1;

  return (
    <div
      data-testid={`radiogroup-target-${optionIdx}-${targetIdx}`}
      style={showListChrome ? {
        border: "1px solid var(--border-color, #3a3a4a)",
        borderRadius: 4,
        padding: "8px 10px",
        marginBottom: 8,
        background: "var(--bg-subtle, #18182a)",
      } : undefined}
    >
      {/* Target header + per-target Remove — only when multi-target (SC4) */}
      {showListChrome && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: "var(--text-muted, #888)",
            }}
          >
            TARGET {targetIdx + 1}
          </span>
          {onRemove && (
            <button
              type="button"
              className="ghost-sm ghost-danger"
              aria-label={`Remove target ${targetIdx + 1} from option ${optionIdx + 1}`}
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {/* Target picker */}
      <div className="ds-field" style={{ marginBottom: 8 }}>
        <span className="ds-field-label">Target</span>
        <select
          className="ds-select"
          aria-label={`Option ${optionIdx + 1} target`}
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
                  {resolveLayerLabel(l, tables, dynamicViews)}
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
            data-testid={`orphan-target-warning-${optionIdx}`}
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
          aria-label={`Capture from target for option ${optionIdx + 1}`}
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

      {/* Phase 60.1 Plan 03: two-pane side-by-side layout ONLY for layer targets.
          LEFT = Advanced JSON (collapsible <details>).
          RIGHT = full RadioLayerConfigEditor (KineticaWmsLayerForm, data-source + spatial suppressed).
          Widget / dynamic-view targets keep the existing single-column layout unchanged. */}
      {kind === "layer" ? (
        <div className="radiogroup-layer-editor">
          {/* ── LEFT PANE ── */}
          <div className="radiogroup-layer-editor-left">
            {/* Advanced JSON (escape hatch + back-compat for layer targets) */}
            <details className="radio-advanced-json" style={{ marginBottom: 4 }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  color: "var(--text-muted, #888)",
                  userSelect: "none",
                }}
              >
                Advanced (raw JSON)
              </summary>
              <div className="ds-field" style={{ marginTop: 6 }}>
                <span className="ds-field-label">Config Patch (JSON)</span>
                <textarea
                  aria-label={`Option ${optionIdx + 1} config patch JSON`}
                  className="ds-select"
                  rows={4}
                  style={{
                    width: "100%",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    resize: "vertical",
                  }}
                  value={JSON.stringify(action.configPatch, null, 2)}
                  onChange={(e) => handleJsonChange(e.target.value)}
                />
                {jsonError && (
                  <div
                    className="config-hint"
                    style={{ color: "var(--danger, #c44)" }}
                    data-testid={`json-error-${optionIdx}`}
                  >
                    {jsonError}
                  </div>
                )}
              </div>
            </details>
          </div>

          {/* ── RIGHT PANE ── full RadioLayerConfigEditor */}
          <div className="radiogroup-layer-editor-right">
            <RadioLayerConfigEditor
              configPatch={action.configPatch}
              baseSnapshot={baseSnapshot}
              columns={columns}
              schema={schema}
              tableName={tableName}
              tableRef={tableRef}
              autoSuggestDisabledReason={autoSuggestDisabledReason}
              idx={optionIdx}
              onCbValid={onCbValid}
              onChange={(nextPatch) =>
                onChange({
                  ...action,
                  // MERGE: full-snapshot write; non-surfaced keys in the existing patch survive
                  configPatch: { ...action.configPatch, ...nextPatch },
                })
              }
            />
          </div>
        </div>
      ) : (
        /* Widget / dynamic-view target: JSON textarea EXACTLY as before (no two-pane, no disclosure) */
        <div className="ds-field" style={{ marginBottom: 4 }}>
          <span className="ds-field-label">Config Patch (JSON)</span>
          <textarea
            aria-label={`Option ${optionIdx + 1} config patch JSON`}
            className="ds-select"
            rows={4}
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: "0.8rem",
              resize: "vertical",
            }}
            value={JSON.stringify(action.configPatch, null, 2)}
            onChange={(e) => handleJsonChange(e.target.value)}
          />
          {jsonError && (
            <div
              className="config-hint"
              style={{ color: "var(--danger, #c44)" }}
              data-testid={`json-error-${optionIdx}`}
            >
              {jsonError}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  tables: ConfigPanelProps["tables"];
  widgetTypeFor: (id: number) => string | undefined;
  onChange: (updated: RadioOption) => void;
  onRemove: () => void;
  /** Reports per-target CbConfigForm validity up to the panel — keyed by "optionIdx:targetIdx" */
  onCbValidChange: (optionIdx: number, targetIdx: number, valid: boolean) => void;
};

function OptionRow({
  option,
  idx,
  widgets,
  layers,
  dynamicViews,
  tables,
  widgetTypeFor,
  onChange,
  onRemove,
  onCbValidChange,
}: OptionRowProps): JSX.Element {
  const allWidgets = widgets ?? [];

  // 1. Load normalization: derive working actions array via getOptionActions (back-compat path).
  //    A legacy { action } option presents as a 1-element list and re-saves as actions.
  const actions = getOptionActions(option);

  // 2. Write-back helpers — every write clears the legacy action field (normalize-everywhere).
  const commitActions = (next: WidgetAction[]) =>
    onChange({ ...option, actions: next, action: undefined });

  const updateActionAt = (i: number, next: WidgetAction) =>
    commitActions(actions.map((a, j) => (j === i ? next : a)));

  const addTarget = () => {
    const defaultKind: "widget" | "layer" | "dynamicView" =
      allWidgets.length > 0
        ? "widget"
        : layers.length > 0
          ? "layer"
          : "dynamicView";
    const defaultId =
      allWidgets.length > 0
        ? allWidgets[0].id
        : layers.length > 0
          ? layers[0].id
          : 0;
    commitActions([...actions, { target: { kind: defaultKind, id: defaultId }, configPatch: {} }]);
  };

  const removeTarget = (i: number) =>
    commitActions(actions.filter((_, j) => j !== i));

  // Per-option validation reasons for the OPTION-LEVEL aggregate (used to gate save).
  const validation = validateRadioOption(option, widgetTypeFor);
  const reasons = validation.valid ? [] : validation.reasons;
  const labelMissing = option.label.trim() === "";

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

      {/* Per-option target list — each target rendered by TargetEditor */}
      {actions.map((action, targetIdx) => (
        <TargetEditor
          key={targetIdx}
          action={action}
          optionIdx={idx}
          targetIdx={targetIdx}
          totalTargets={actions.length}
          widgets={widgets}
          layers={layers}
          dynamicViews={dynamicViews}
          tables={tables}
          widgetTypeFor={widgetTypeFor}
          onChange={(next) => updateActionAt(targetIdx, next)}
          onCbValid={(valid) => onCbValidChange(idx, targetIdx, valid)}
          onRemove={actions.length > 1 ? () => removeTarget(targetIdx) : undefined}
        />
      ))}

      {/* "+ Add target" button — mirror "+ Add option" affordance + theme tokens */}
      <button
        type="button"
        className="ghost-sm"
        aria-label={`Add target to option ${idx + 1}`}
        onClick={addTarget}
        style={{ color: "var(--accent, #22c55e)", marginBottom: 4 }}
      >
        + Add target
      </button>

      {/* Validation reasons (option-level aggregate — incl. all targets) */}
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
  tables,
}: ConfigPanelProps): JSX.Element {
  const cfg = parseConfig(config);
  const allWidgets = widgets ?? [];
  const layers = useDashboardLayersStore((s) => s.layers);
  const [dynamicViews, setDynamicViews] = useState<DynamicViewRow[]>([]);

  // Per-target CbConfigForm validity map keyed by "optionIdx:targetIdx"
  const [cbValidMap, setCbValidMap] = useState<Record<string, boolean>>({});

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

  // Handle per-target CbConfigForm validity changes — keyed by optionIdx:targetIdx
  const handleCbValidChange = (optionIdx: number, targetIdx: number, valid: boolean) => {
    setCbValidMap((prev) => ({ ...prev, [`${optionIdx}:${targetIdx}`]: valid }));
  };

  // Compute validity and signal isValid
  // Fold per-target cb validity into the overall validity:
  // A target is cb-invalid when kind==="layer" AND renderMode==="classbreak" AND cbValid===false.
  const allValid = useMemo(() => {
    const baseValid = isRadioGroupConfigValid(cfg, widgetTypeFor);
    if (!baseValid) return false;
    // Additional check: any layer target with zero-break classbreak makes the whole config invalid
    for (let optIdx = 0; optIdx < cfg.options.length; optIdx++) {
      const opt = cfg.options[optIdx];
      const optActions = getOptionActions(opt);
      for (let tgtIdx = 0; tgtIdx < optActions.length; tgtIdx++) {
        const action = optActions[tgtIdx];
        const optKind = action.target.kind;
        const optRenderMode = action.configPatch.renderMode as string | undefined;
        if (optKind === "layer" && optRenderMode === "classbreak") {
          const key = `${optIdx}:${tgtIdx}`;
          const cbOk = cbValidMap[key] !== false; // default true if not yet reported
          if (!cbOk) return false;
        }
      }
    }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cfg), widgetTypeFor, JSON.stringify(cbValidMap)]);

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
      actions: [{ target: { kind: firstTargetKind, id: firstTargetId }, configPatch: {} }],
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

  // Phase 60.1 Plan 03: detect whether any option targets a layer — used to add a
  // marker class that the CSS uses to widen the modal for the two-pane layout.
  // Phase 60.2: recompute over ALL actions of ALL options via getOptionActions.
  const hasLayerOption = cfg.options.some((o) =>
    getOptionActions(o).some((a) => a.target.kind === "layer"),
  );

  return (
    <div
      className={`config-group${hasLayerOption ? " radiogroup-has-layer-editor" : ""}`}
      role="group"
      aria-labelledby="radiogroup-config-label"
    >
      <label id="radiogroup-config-label" className="config-group-label">
        DASHBOARD CONTROL CONFIG
      </label>

      {/* Optional title */}
      <div className="ds-field" style={{ marginBottom: 10 }}>
        <span className="ds-field-label">Widget title (optional)</span>
        <input
          className="ds-select"
          type="text"
          aria-label="Radio Dashboard Control title"
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
          aria-label="Radio Dashboard Control orientation"
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
          tables={tables}
          widgetTypeFor={widgetTypeFor}
          onChange={(updated) => handleOptionChange(idx, updated)}
          onRemove={() => handleRemoveOption(idx)}
          onCbValidChange={handleCbValidChange}
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
