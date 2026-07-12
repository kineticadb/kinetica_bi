import React, { useState } from "react";
import { useToastStore } from "../store/toast";

// v1.20 Phase 110 Plan 01 (FSET-V120-01): dashboard-settings modal — its first (and
// currently only) occupant is the filter-display-mode segmented toggle. Save-on-change
// (no Save/Cancel footer): the PATCH itself is owned by the parent (DashboardsPage) via
// `onModeChange`; this component stays a pure controlled toggle for trivial testability.
// Chrome mirrors TablePickerModal (.modal-overlay/.modal-content/.modal-header/.modal-title/
// .modal-body); the segmented control reuses RadioGroupRenderer's existing
// .radiogroup--buttons/.radiogroup-button/.radiogroup-button--selected classes verbatim —
// NO new CSS classes introduced.
export const DashboardSettingsModal = ({
  mode,
  onModeChange,
  onClose,
}: {
  mode: "topbar" | "panel";
  onModeChange: (mode: "topbar" | "panel") => Promise<void> | void;
  onClose: () => void;
}) => {
  const [saving, setSaving] = useState(false);

  const handleSelect = async (next: "topbar" | "panel") => {
    if (next === mode || saving) return; // already-selected segment is a no-op
    setSaving(true);
    try {
      await onModeChange(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update dashboard settings";
      useToastStore.getState().showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Dashboard Settings</span>
          <button className="ghost-sm" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="ds-field">
            <span className="ds-field-label">Filter display</span>
            <div className="radiogroup--buttons">
              <button
                type="button"
                className={`radiogroup-button${mode === "topbar" ? " radiogroup-button--selected" : ""}`}
                disabled={saving}
                onClick={() => handleSelect("topbar")}
              >
                Top bar
              </button>
              <button
                type="button"
                className={`radiogroup-button${mode === "panel" ? " radiogroup-button--selected" : ""}`}
                disabled={saving}
                onClick={() => handleSelect("panel")}
              >
                Right panel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardSettingsModal;
