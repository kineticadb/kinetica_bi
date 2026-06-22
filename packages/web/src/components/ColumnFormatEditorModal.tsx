/**
 * ColumnFormatEditorModal — Phase 76 Plan 01
 * Two-pane column formatting editor modal.
 *
 * Props: { table: TableDto; onClose: () => void }
 * Left pane: scrollable column list with type badges + saved-config indicator.
 * Right pane: per-column editor form + live preview + Save (Tasks 2 + 3).
 *
 * FRONTEND-ONLY — does NOT touch packages/server.
 * Theme tokens only — no raw hex (passes theme-guard.spec.ts without allowlisting).
 */

import { useState, useEffect } from "react";
import { type TableDto } from "../api/client";
import {
  upsertColumnDisplayConfig,
  deleteColumnDisplayConfig,
} from "../api/client";
import { useColumnDisplayConfigStore } from "../store/columnDisplayConfigStore";
import { useToastStore } from "../store/toast";
import {
  buildFormatter,
  type FormatSpec,
  type FormatSpecNumber,
  type FormatSpecDate,
  type FormatSpecD3,
} from "../lib/columnFormatter";

// ---------------------------------------------------------------------------
// Sample values for live preview (fixed — no Kinetica fetch needed)
// ---------------------------------------------------------------------------
const SAMPLE_NUMBER = 1234567.891;
const SAMPLE_DATE = "2026-06-19T13:45:00Z";

// ---------------------------------------------------------------------------
// Per-kind working state
// ---------------------------------------------------------------------------
type ColWorking = {
  label: string;
  spec: FormatSpec;
};

type ColBaseline = {
  label: string;
  spec: FormatSpec;
};

// ---------------------------------------------------------------------------
// Default spec builder
// ---------------------------------------------------------------------------
function defaultSpecForKind(kind: FormatSpec["kind"]): FormatSpec {
  switch (kind) {
    case "number":
      return { kind: "number", thousandsSep: true, decimals: 2, currency: false, percent: false };
    case "date":
      return { kind: "date", preset: "iso" };
    case "d3":
      return { kind: "d3", specifier: "" };
    case "none":
    default:
      return { kind: "none" };
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ColumnFormatEditorModal({
  table,
  onClose,
}: {
  table: TableDto;
  onClose: () => void;
}): JSX.Element {
  const cols = Object.keys(table.columns);
  const firstCol = cols[0] ?? null;

  // Per-column working state (label + spec)
  const [working, setWorking] = useState<Record<string, ColWorking>>({});
  // Baseline snapshot at load time (for dirty comparison)
  const [baseline, setBaseline] = useState<Record<string, ColBaseline>>({});

  const [selectedCol, setSelectedCol] = useState<string | null>(firstCol);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Load on mount: fetch existing config + seed working state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    useColumnDisplayConfigStore
      .getState()
      .loadConfig(table.id)
      .then(() => {
        if (cancelled) return;
        const store = useColumnDisplayConfigStore.getState();
        const initialWorking: Record<string, ColWorking> = {};
        const initialBaseline: Record<string, ColBaseline> = {};

        for (const col of Object.keys(table.columns)) {
          const saved = store.configs[table.id]?.columns[col];
          const storedSpec = saved?.format_spec ?? null;
          const storedLabel = saved?.label ?? "";

          // No saved spec → default to "none" so the form truthfully reflects
          // "no format applied" (and Save stays disabled until the operator
          // actually picks a format). We deliberately do NOT pre-infer a kind
          // from the column type — that misrepresented unsaved columns as
          // already-formatted and seeded the baseline so the shown default
          // could never be saved.
          const spec: FormatSpec = storedSpec ? storedSpec : defaultSpecForKind("none");

          initialWorking[col] = { label: storedLabel, spec };
          initialBaseline[col] = { label: storedLabel, spec };
        }

        setWorking(initialWorking);
        setBaseline(initialBaseline);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = (err as Error)?.message ?? "Failed to load column config";
        useToastStore.getState().showToast(`Failed to load column config: ${msg}`, "error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id]);

  // ---------------------------------------------------------------------------
  // Dirty check: any column's working state differs from baseline
  // ---------------------------------------------------------------------------
  function computeIsDirty(
    w: Record<string, ColWorking>,
    b: Record<string, ColBaseline>,
  ): boolean {
    for (const col of Object.keys(table.columns)) {
      const wc = w[col];
      const bc = b[col];
      if (!wc || !bc) continue;
      if (JSON.stringify(wc) !== JSON.stringify(bc)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Close handling (dirty guard + ESC + overlay click)
  // ---------------------------------------------------------------------------
  const handleCloseRequest = () => {
    if (isDirty) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseRequest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, onClose]);

  // ---------------------------------------------------------------------------
  // Working state updaters
  // ---------------------------------------------------------------------------
  function updateWorking(col: string, updater: (prev: ColWorking) => ColWorking) {
    setWorking((prev) => {
      const prevCol = prev[col] ?? {
        label: "",
        spec: defaultSpecForKind("none"),
      };
      const next = { ...prev, [col]: updater(prevCol) };
      setIsDirty(computeIsDirty(next, baseline));
      return next;
    });
  }

  function setLabel(col: string, label: string) {
    updateWorking(col, (prev) => ({ ...prev, label }));
  }

  function setSpec(col: string, spec: FormatSpec) {
    updateWorking(col, (prev) => ({ ...prev, spec }));
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------
  const handleSave = async () => {
    setSaving(true);
    try {
      for (const col of Object.keys(table.columns)) {
        const wc = working[col];
        const bc = baseline[col];
        if (!wc) continue;
        // Skip columns that haven't changed
        if (bc && JSON.stringify(wc) === JSON.stringify(bc)) continue;

        const label = wc.label.trim() === "" ? null : wc.label;
        const isNoneEmpty = wc.spec.kind === "none" && label === null;

        if (isNoneEmpty) {
          await deleteColumnDisplayConfig(table.id, col);
          useColumnDisplayConfigStore.getState().removeColumn(table.id, col);
        } else {
          await upsertColumnDisplayConfig(table.id, col, label, wc.spec);
          useColumnDisplayConfigStore.getState().upsertColumn(table.id, col, label, wc.spec);
        }
      }

      // Re-baseline to saved values
      setBaseline((prev) => {
        const next = { ...prev };
        for (const col of Object.keys(table.columns)) {
          const wc = working[col];
          if (wc) {
            next[col] = { label: wc.label, spec: wc.spec };
          }
        }
        return next;
      });
      setIsDirty(false);
      useToastStore.getState().showToast("Column formatting saved", "info");
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? "unknown";
      useToastStore
        .getState()
        .showToast(`Failed to save column display config: ${msg}`, "error");
      // Keep isDirty so operator can retry
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Saved-config indicator: has the store entry for a column?
  // ---------------------------------------------------------------------------
  function hasSavedConfig(col: string): boolean {
    const store = useColumnDisplayConfigStore.getState();
    const entry = store.configs[table.id]?.columns[col];
    return !!(entry && (entry.label !== null || entry.format_spec !== null));
  }

  // ---------------------------------------------------------------------------
  // Current working state for selected column
  // ---------------------------------------------------------------------------
  const currentWorking: ColWorking | null = selectedCol
    ? working[selectedCol] ?? null
    : null;

  // ---------------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------------
  function computePreview(spec: FormatSpec | null): string {
    if (!spec) return String(SAMPLE_NUMBER);
    const sample = spec.kind === "date" ? SAMPLE_DATE : SAMPLE_NUMBER;
    return String(buildFormatter(spec)(sample));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="modal-overlay" onClick={handleCloseRequest}>
      <div
        className="modal-content col-format-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Format columns — {table.name}</div>
          <button className="ghost-sm" onClick={handleCloseRequest}>
            Close
          </button>
        </div>

        {/* Two-pane body */}
        <div className="col-format-editor-body">
          {/* LEFT: column list */}
          <div className="modal-left col-format-editor-left">
            {Object.entries(table.columns).map(([col, colType]) => {
              const isActive = col === selectedCol;
              const saved = hasSavedConfig(col);
              return (
                <div
                  key={col}
                  className={`col-format-row${isActive ? " active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCol(col)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedCol(col);
                  }}
                >
                  <span className="col-format-col-name">{col}</span>
                  <span className="col-format-col-type">{colType}</span>
                  {saved && (
                    <span className="col-format-saved-dot" title="Has saved config" />
                  )}
                </div>
              );
            })}
          </div>

          {/* RIGHT: editor form */}
          <div className="modal-right col-format-editor-right">
            {selectedCol && currentWorking ? (
              <ColumnEditorForm
                col={selectedCol}
                colType={table.columns[selectedCol] ?? ""}
                working={currentWorking}
                onLabelChange={(label) => setLabel(selectedCol, label)}
                onSpecChange={(spec) => setSpec(selectedCol, spec)}
                previewValue={computePreview(currentWorking.spec)}
                isDirty={isDirty}
                saving={saving}
                onSave={handleSave}
              />
            ) : (
              <div className="col-format-editor-empty">
                Select a column to format.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: ColumnEditorForm — label + kind picker + conditional controls + preview
// ---------------------------------------------------------------------------
type ColumnEditorFormProps = {
  col: string;
  colType: string;
  working: ColWorking;
  onLabelChange: (label: string) => void;
  onSpecChange: (spec: FormatSpec) => void;
  previewValue: string;
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
};

function ColumnEditorForm({
  col,
  working,
  onLabelChange,
  onSpecChange,
  previewValue,
  isDirty,
  saving,
  onSave,
}: ColumnEditorFormProps): JSX.Element {
  const { label, spec } = working;

  const handleKindChange = (kind: FormatSpec["kind"]) => {
    onSpecChange(defaultSpecForKind(kind));
  };

  return (
    <div className="col-format-editor-form">
      {/* Display label */}
      <div className="ds-field">
        <label className="ds-field-label">Display label</label>
        <input
          type="text"
          placeholder={col}
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          aria-label="Display label"
        />
      </div>

      {/* Format kind picker */}
      <div className="ds-field">
        <label className="ds-field-label">Format kind</label>
        <select
          className="ds-select"
          value={spec.kind}
          onChange={(e) => handleKindChange(e.target.value as FormatSpec["kind"])}
          aria-label="Format kind"
        >
          <option value="none">None</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="d3">Advanced (d3-format)</option>
        </select>
      </div>

      {/* Kind-specific controls */}
      {spec.kind === "number" && (
        <NumberControls
          spec={spec as FormatSpecNumber}
          onChange={onSpecChange}
        />
      )}
      {spec.kind === "date" && (
        <DateControls
          spec={spec as FormatSpecDate}
          onChange={onSpecChange}
        />
      )}
      {spec.kind === "d3" && (
        <D3Controls
          spec={spec as FormatSpecD3}
          onChange={onSpecChange}
        />
      )}

      {/* Live preview */}
      <div className="config-group">
        <div className="config-group-label">Preview</div>
        <div className="col-format-preview-value" data-testid="live-preview">
          {previewValue}
        </div>
      </div>

      {/* Save button */}
      <div className="col-format-editor-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!isDirty || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: NumberControls
// ---------------------------------------------------------------------------
function NumberControls({
  spec,
  onChange,
}: {
  spec: FormatSpecNumber;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Number format</div>

      {/* Thousands separator */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={spec.thousandsSep}
          onChange={(e) => onChange({ ...spec, thousandsSep: e.target.checked })}
          aria-label="Thousands separator"
        />
        <span>Thousands separator</span>
      </label>

      {/* Decimal places */}
      <div className="ds-field">
        <label className="ds-field-label">Decimal places</label>
        <input
          type="number"
          min={0}
          value={spec.decimals}
          onChange={(e) => {
            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
            onChange({ ...spec, decimals: v });
          }}
          aria-label="Decimal places"
        />
      </div>

      {/* Currency toggle + symbol */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={spec.currency !== false}
          onChange={(e) =>
            onChange({ ...spec, currency: e.target.checked ? "$" : false })
          }
          aria-label="Currency"
        />
        <span>Currency</span>
      </label>
      {spec.currency !== false && (
        <div className="ds-field">
          <label className="ds-field-label">Currency symbol</label>
          <input
            type="text"
            value={spec.currency as string}
            onChange={(e) => onChange({ ...spec, currency: e.target.value })}
            aria-label="Currency symbol"
            placeholder="$"
          />
        </div>
      )}

      {/* Percent toggle */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={spec.percent}
          onChange={(e) => onChange({ ...spec, percent: e.target.checked })}
          aria-label="Percent"
        />
        <span>Percent (appends %, no ×100)</span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: DateControls
// ---------------------------------------------------------------------------
function DateControls({
  spec,
  onChange,
}: {
  spec: FormatSpecDate;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Date format</div>

      <div className="ds-field">
        <label className="ds-field-label">Preset</label>
        <select
          className="ds-select"
          value={spec.preset}
          onChange={(e) =>
            onChange({ ...spec, preset: e.target.value as FormatSpecDate["preset"] })
          }
          aria-label="Date preset"
        >
          <option value="iso">2026-06-19</option>
          <option value="us">06/19/2026</option>
          <option value="long">Jun 19, 2026</option>
          <option value="us_time">06/19/2026 13:45</option>
          <option value="long_time">Jun 19, 2026 13:45</option>
          <option value="custom">Custom pattern…</option>
        </select>
      </div>

      {spec.preset === "custom" && (
        <div className="ds-field">
          <label className="ds-field-label">Custom pattern</label>
          <input
            type="text"
            placeholder="YYYY-MM-DD HH:mm"
            value={spec.customPattern ?? ""}
            onChange={(e) => onChange({ ...spec, customPattern: e.target.value })}
            aria-label="Custom date pattern"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: D3Controls
// ---------------------------------------------------------------------------
function D3Controls({
  spec,
  onChange,
}: {
  spec: FormatSpecD3;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Advanced (d3-format)</div>

      <div className="ds-field">
        <label className="ds-field-label">d3 specifier</label>
        <input
          type="text"
          value={spec.specifier}
          onChange={(e) => onChange({ ...spec, specifier: e.target.value })}
          aria-label="d3 specifier"
          placeholder=".2f"
        />
      </div>

      <div className="config-hint">
        Uses raw d3-format semantics: the <code>%</code> type multiplies by 100 here
        (unlike the Number &rarr; Percent preset which appends a literal % with no ×100).
      </div>
    </div>
  );
}
