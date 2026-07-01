/**
 * CustomMetricsEditorModal — Phase 100 Plan 01
 * Two-pane CRUD editor for a table's custom metrics.
 *
 * Props: { table: TableDto; onClose: () => void }
 * Left pane: scrollable metric list + "Add metric" button.
 * Right pane: edit/new form (label + SQL expression + optional default format).
 *
 * FRONTEND-ONLY — does NOT touch packages/server.
 * Theme tokens only — no raw hex (passes theme-guard.spec.ts without allowlisting).
 */

import "./CustomMetricsEditorModal.css";
import { useState, useEffect } from "react";
import { type TableDto } from "../api/client";
import {
  createCustomMetric,
  updateCustomMetric,
  deleteCustomMetric,
} from "../api/client";
import {
  useCustomMetricsStore,
  selectMetrics,
} from "../store/customMetricsStore";
import { useToastStore } from "../store/toast";
import {
  type FormatSpec,
  type FormatSpecNumber,
  type FormatSpecDate,
  type FormatSpecD3,
  type FormatSpecSI,
} from "../lib/columnFormatter";
import {
  NumberControls,
  DateControls,
  D3Controls,
  SIControls,
  defaultSpecForKind,
} from "./charts/FormatSpecEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "idle" | "new" | "edit";

type WorkingForm = {
  label: string;
  expression: string;
  spec: FormatSpec;
};

const EMPTY_FORM: WorkingForm = {
  label: "",
  expression: "",
  spec: defaultSpecForKind("none"),
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CustomMetricsEditorModal({
  table,
  onClose,
}: {
  table: TableDto;
  onClose: () => void;
}): JSX.Element {
  // Reactive subscription keyed on configVersion so the left list re-renders after mutations
  const rows = useCustomMetricsStore((s) => {
    void s.configVersion;
    return selectMetrics(table.id);
  });

  const [mode, setMode] = useState<Mode>("idle");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [working, setWorking] = useState<WorkingForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load on mount (cancelled-guard pattern)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    useCustomMetricsStore
      .getState()
      .loadConfig(table.id)
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = (err as Error)?.message ?? "Failed to load custom metrics";
        useToastStore.getState().showToast(`Failed to load custom metrics: ${msg}`, "error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id]);

  // ---------------------------------------------------------------------------
  // Dirty check — is the working form dirty vs the saved/baseline row?
  // ---------------------------------------------------------------------------
  function isDirty(): boolean {
    if (mode === "new") {
      return working.label.trim() !== "" || working.expression.trim() !== "";
    }
    if (mode === "edit" && selectedId !== null) {
      const row = rows.find((r) => r.id === selectedId);
      if (!row) return false;
      const savedSpec = row.format_spec ?? defaultSpecForKind("none");
      return (
        working.label !== row.label ||
        working.expression !== row.expression ||
        JSON.stringify(working.spec) !== JSON.stringify(savedSpec)
      );
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Close handling (dirty guard + ESC + overlay click)
  // ---------------------------------------------------------------------------
  const handleCloseRequest = () => {
    if (isDirty()) {
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
  }, [mode, working, selectedId, rows]);

  // ---------------------------------------------------------------------------
  // Select existing metric
  // ---------------------------------------------------------------------------
  const handleSelectRow = (id: number) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setMode("edit");
    setSelectedId(id);
    setWorking({
      label: row.label,
      expression: row.expression,
      spec: row.format_spec ?? defaultSpecForKind("none"),
    });
    setFormError(null);
  };

  // ---------------------------------------------------------------------------
  // Add metric — switch to new mode
  // ---------------------------------------------------------------------------
  const handleAddMetric = () => {
    setMode("new");
    setSelectedId(null);
    setWorking(EMPTY_FORM);
    setFormError(null);
  };

  // ---------------------------------------------------------------------------
  // Kind change helper
  // ---------------------------------------------------------------------------
  const handleKindChange = (kind: FormatSpec["kind"]) => {
    setWorking((prev) => ({ ...prev, spec: defaultSpecForKind(kind) }));
  };

  // ---------------------------------------------------------------------------
  // Save handler (create / update)
  // ---------------------------------------------------------------------------
  const handleSave = async () => {
    const trimmedLabel = working.label.trim();
    const trimmedExpression = working.expression.trim();

    if (!trimmedLabel || !trimmedExpression) {
      setFormError("Label and expression are required.");
      return;
    }

    const formatSpec: FormatSpec | null =
      working.spec.kind === "none" ? null : working.spec;

    setSaving(true);
    setFormError(null);

    try {
      if (mode === "new") {
        const created = await createCustomMetric(
          table.id,
          trimmedLabel,
          trimmedExpression,
          formatSpec,
        );
        useCustomMetricsStore.getState().upsertMetric(table.id, created);
        setMode("edit");
        setSelectedId(created.id);
        setWorking({
          label: created.label,
          expression: created.expression,
          spec: created.format_spec ?? defaultSpecForKind("none"),
        });
      } else if (mode === "edit" && selectedId !== null) {
        const updated = await updateCustomMetric(
          table.id,
          selectedId,
          trimmedLabel,
          trimmedExpression,
          formatSpec,
        );
        useCustomMetricsStore.getState().upsertMetric(table.id, updated);
        setWorking({
          label: updated.label,
          expression: updated.expression,
          spec: updated.format_spec ?? defaultSpecForKind("none"),
        });
      }

      setFormError(null);
      useToastStore.getState().showToast("Custom metric saved", "info");
    } catch (err: unknown) {
      const message = (err as Error)?.message ?? "Failed to save custom metric";
      // Surface server 409 "already exists" text as inline error (not a toast)
      if (message.toLowerCase().includes("already exists")) {
        setFormError(message);
      } else {
        setFormError(message);
      }
      // Do NOT close on error
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete handler
  // ---------------------------------------------------------------------------
  const handleDelete = async () => {
    if (selectedId === null) return;
    const ok = window.confirm("Delete this metric?");
    if (!ok) return;
    try {
      await deleteCustomMetric(table.id, selectedId);
      useCustomMetricsStore.getState().removeMetric(table.id, selectedId);
      setMode("idle");
      setSelectedId(null);
      setWorking(EMPTY_FORM);
      setFormError(null);
      useToastStore.getState().showToast("Custom metric deleted", "info");
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? "Failed to delete custom metric";
      useToastStore.getState().showToast(msg, "error");
    }
  };

  // ---------------------------------------------------------------------------
  // Save disabled when: saving OR (label/expression empty)
  // ---------------------------------------------------------------------------
  const isSaveDisabled =
    saving ||
    working.label.trim() === "" ||
    working.expression.trim() === "";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="modal-overlay" onClick={handleCloseRequest}>
      <div
        className="modal-content custom-metrics-editor-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Custom metrics — {table.name}</div>
          <button className="ghost-sm" onClick={handleCloseRequest}>
            Close
          </button>
        </div>

        {/* Two-pane body */}
        <div className="custom-metrics-editor-body">
          {/* LEFT: metric list */}
          <div className="modal-left custom-metrics-editor-left">
            {rows.map((row) => (
              <div
                key={row.id}
                className={`custom-metric-row${selectedId === row.id ? " active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectRow(row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleSelectRow(row.id);
                }}
              >
                {row.label}
              </div>
            ))}
            <button
              className="ghost-sm"
              onClick={handleAddMetric}
              style={{ marginTop: "auto" }}
            >
              Add metric
            </button>
          </div>

          {/* RIGHT: edit/new form or empty state */}
          <div className="modal-right custom-metrics-editor-right">
            {mode === "idle" ? (
              <div className="custom-metrics-editor-empty">
                Select a metric or add a new one.
              </div>
            ) : (
              <MetricEditorForm
                working={working}
                setWorking={setWorking}
                onKindChange={handleKindChange}
                formError={formError}
                saving={saving}
                isSaveDisabled={isSaveDisabled}
                onSave={handleSave}
                onDelete={mode === "edit" ? handleDelete : undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: MetricEditorForm
// ---------------------------------------------------------------------------

type MetricEditorFormProps = {
  working: WorkingForm;
  setWorking: React.Dispatch<React.SetStateAction<WorkingForm>>;
  onKindChange: (kind: FormatSpec["kind"]) => void;
  formError: string | null;
  saving: boolean;
  isSaveDisabled: boolean;
  onSave: () => void;
  onDelete?: () => void;
};

function MetricEditorForm({
  working,
  setWorking,
  onKindChange,
  formError,
  saving,
  isSaveDisabled,
  onSave,
  onDelete,
}: MetricEditorFormProps): JSX.Element {
  const { label, expression, spec } = working;

  return (
    <div className="custom-metrics-editor-form">
      {/* Label */}
      <div className="ds-field">
        <span className="ds-field-label">Label</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setWorking((prev) => ({ ...prev, label: e.target.value }))}
          aria-label="Label"
        />
      </div>

      {/* SQL expression */}
      <div className="ds-field">
        <span className="ds-field-label">SQL expression</span>
        <textarea
          value={expression}
          onChange={(e) => setWorking((prev) => ({ ...prev, expression: e.target.value }))}
          placeholder="SUM(revenue) / SUM(cost)"
          aria-label="SQL expression"
        />
      </div>

      {/* Optional default format */}
      <div className="ds-field">
        <span className="ds-field-label">Default format</span>
        <select
          className="ds-select"
          value={spec.kind}
          onChange={(e) => onKindChange(e.target.value as FormatSpec["kind"])}
          aria-label="Format kind"
        >
          <option value="none">None</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="d3">Advanced (d3-format)</option>
          <option value="si">Smart abbreviation (k / M / G / T)</option>
        </select>
      </div>

      {/* Kind-specific controls */}
      {spec.kind === "number" && (
        <NumberControls
          spec={spec as FormatSpecNumber}
          onChange={(s) => setWorking((prev) => ({ ...prev, spec: s }))}
        />
      )}
      {spec.kind === "date" && (
        <DateControls
          spec={spec as FormatSpecDate}
          onChange={(s) => setWorking((prev) => ({ ...prev, spec: s }))}
        />
      )}
      {spec.kind === "d3" && (
        <D3Controls
          spec={spec as FormatSpecD3}
          onChange={(s) => setWorking((prev) => ({ ...prev, spec: s }))}
        />
      )}
      {spec.kind === "si" && (
        <SIControls
          spec={spec as FormatSpecSI}
          onChange={(s) => setWorking((prev) => ({ ...prev, spec: s }))}
        />
      )}

      {/* Inline error */}
      {formError && (
        <div className="config-hint custom-metrics-editor-error">{formError}</div>
      )}

      {/* Actions */}
      <div className="custom-metrics-editor-actions">
        {onDelete && (
          <button
            type="button"
            className="ghost-sm ghost-danger"
            onClick={onDelete}
            disabled={saving}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={isSaveDisabled}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
