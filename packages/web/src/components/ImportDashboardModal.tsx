/**
 * Phase 121 Plan 02 (DXIM-V124-10): ImportDashboardModal
 *
 * Lets the operator pick a dashboard export file (.json produced by Export on another
 * environment), POST it to the server, and then read the FULL import report.
 *
 * WHY the report renders every metric-conflict sentence verbatim: when a target custom metric
 * shares a label but differs in expression, import reuses the target's definition, so an
 * imported widget can compute something different than it did in the source environment. The
 * server's per-conflict sentence is the only signal for that accepted risk, so this component
 * never reduces it to a count or a generic success banner — same treatment for every warning
 * string. Chrome mirrors DashboardAccessModal.tsx (modal-overlay/modal-content/modal-header
 * + modal-body, datasets-table/ds-row sections) — no new CSS.
 */

import React, { useState } from "react";
import { importDashboardFile } from "../api/client";
import type { ImportReportDto } from "../api/client";

interface ImportDashboardModalProps {
  onClose: () => void;
  /** Called once, after a successful import, with the report. DashboardsPage uses it to refetch
   *  the list so the newly created dashboard appears. The modal stays open showing the report. */
  onImported: (report: ImportReportDto) => void;
}

const ImportDashboardModal: React.FC<ImportDashboardModalProps> = ({ onClose, onImported }) => {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReportDto | null>(null);

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importDashboardFile(file);
      setReport(r);
      onImported(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {report === null ? (
          <>
            <div className="modal-header">
              <span className="modal-title">Import dashboard</span>
              <button className="ghost-sm" onClick={onClose}>Close</button>
            </div>
            <div className="modal-body">
              <div className="muted" style={{ marginBottom: "12px" }}>
                Choose a dashboard export file (.json) produced by Export on another environment.
              </div>
              {error && <div className="error">{error}</div>}
              <div className="ds-field">
                <span className="ds-field-label">Import file</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  aria-label="Import file"
                  onChange={(e) => { setError(null); setFile(e.target.files?.[0] ?? null); }}
                />
              </div>
              <div className="ds-actions">
                <button className="btn-primary btn-sm" disabled={!file || busy} onClick={handleImport}>
                  {busy ? "Importing…" : "Import"}
                </button>
                <button className="ghost-sm" onClick={onClose}>Cancel</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="modal-header">
              <span className="modal-title">Import report: {report.dashboardName}</span>
              <button className="ghost-sm" onClick={onClose}>Close</button>
            </div>
            <div className="modal-body">
              <h3 className="modal-section-title">Created</h3>
              <div className="datasets-table" style={{ marginBottom: "8px" }}>
                <div className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>Dashboard id</span>
                  <span>{report.dashboardId}</span>
                </div>
                <div className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>Widgets</span>
                  <span>{report.widgetsCreated}</span>
                </div>
                <div className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>Layers</span>
                  <span>{report.layersCreated}</span>
                </div>
                <div className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <span>Dynamic views</span>
                  <span>{report.dynamicViewsCreated}</span>
                </div>
              </div>

              <h3 className="modal-section-title modal-section-title-spaced">Tables</h3>
              {report.tablesMatched.length === 0 && report.tablesCreated.length === 0 ? (
                <div className="muted">No tables in this file.</div>
              ) : (
                <div className="datasets-table" style={{ marginBottom: "8px" }}>
                  {report.tablesMatched.map((t) => (
                    <div key={`matched-${t.newId}`} className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                      <span>{t.tableRef}</span>
                      <span className="muted">matched</span>
                    </div>
                  ))}
                  {report.tablesCreated.map((t) => (
                    <div key={`created-${t.newId}`} className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                      <span>{t.tableRef}</span>
                      <span className="muted">created</span>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="modal-section-title modal-section-title-spaced">Custom metrics</h3>
              {report.metricsMatched.length === 0 && report.metricsCreated.length === 0 ? (
                <div className="muted">No custom metrics in this file.</div>
              ) : (
                <div className="datasets-table" style={{ marginBottom: "8px" }}>
                  {report.metricsMatched.map((m) => (
                    <div key={`matched-${m.newId}`} className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                      <span>{m.label} — {m.tableRef}</span>
                      <span className="muted">matched</span>
                    </div>
                  ))}
                  {report.metricsCreated.map((m) => (
                    <div key={`created-${m.newId}`} className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                      <span>{m.label} — {m.tableRef}</span>
                      <span className="muted">created</span>
                    </div>
                  ))}
                </div>
              )}

              {report.metricConflicts.length > 0 && (
                <>
                  <h3 className="modal-section-title modal-section-title-spaced">
                    Metric conflicts — review before trusting these widgets
                  </h3>
                  {report.metricConflicts.map((c) => (
                    <div key={`conflict-${c.newId}`} className="error" style={{ marginBottom: "8px" }}>
                      {c.message}
                    </div>
                  ))}
                </>
              )}

              {report.warnings.length > 0 && (
                <>
                  <h3 className="modal-section-title modal-section-title-spaced">Warnings</h3>
                  {report.warnings.map((w, i) => (
                    <div key={`warning-${i}`} className="muted">{w}</div>
                  ))}
                </>
              )}

              {report.strippedReferences.length > 0 && (
                <>
                  <h3 className="modal-section-title modal-section-title-spaced">References removed</h3>
                  <div className="datasets-table" style={{ marginBottom: "8px" }}>
                    {report.strippedReferences.map((s, i) => (
                      <div key={`stripped-${i}`} className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                        <span>{s.from} — {s.kind} #{s.id}</span>
                        <span className="muted">removed</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {report.preflightDangling.length > 0 && (
                <>
                  <h3 className="modal-section-title modal-section-title-spaced">
                    Dangling references found before import
                  </h3>
                  <div className="datasets-table" style={{ marginBottom: "8px" }}>
                    {report.preflightDangling.map((s, i) => (
                      <div key={`dangling-${i}`} className="ds-row" style={{ gridTemplateColumns: "1fr auto" }}>
                        <span>{s.from} — {s.kind} #{s.id}</span>
                        <span className="muted">removed</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="ds-actions">
                <button className="ghost-sm" onClick={onClose}>Done</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImportDashboardModal;
