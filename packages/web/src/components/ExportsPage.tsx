// Phase 131 (EXPRT-V126-12, D-14..D-17): the Exports page. Mirrors DatasetsPage markup.
import { useState } from "react";
import { cancelExportJob, deleteExportJob, type ExportJobDto } from "../api/client";
import { useExportsList } from "../hooks/useExportsList";
import {
  exportDisplayName,
  exportStatusLabel,
  formatExportBytes,
  isTerminalExportStatus,
  parseExportTimestamp,
  relativeExpiry,
} from "../lib/exportFormat";
import { startExportDownload } from "../lib/exportDownload";
import ChartCard from "./ChartCard";

const addTo = (s: Set<string>, id: string) => new Set(s).add(id);
const removeFrom = (s: Set<string>, id: string) => {
  const n = new Set(s);
  n.delete(id);
  return n;
};

const ExportsPage = () => {
  const { jobs, loading, error, reload, replaceJob, removeJob } = useExportsList();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setActionError(null);
    setBusy((b) => addTo(b, id));
    try {
      await fn();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy((b) => removeFrom(b, id));
    }
  };

  const onDelete = (j: ExportJobDto) => {
    setActionError(null);
    if (!window.confirm(`Delete export "${exportDisplayName(j)}"? The file will be removed and cannot be recovered.`)) return;
    void withBusy(j.id, async () => {
      await deleteExportJob(j.id);
      removeJob(j.id);
    });
  };

  const onCancel = (j: ExportJobDto) =>
    void withBusy(j.id, async () => {
      const dto = await cancelExportJob(j.id);
      setCancelling((c) => addTo(c, j.id));
      if (dto) replaceJob(dto);
      else reload();
    });

  const onDownload = (j: ExportJobDto) =>
    void withBusy(j.id, async () => {
      if (!(await startExportDownload(j.id))) reload();
    });

  const statusCell = (j: ExportJobDto) => {
    const label = exportStatusLabel(j.status);
    if (cancelling.has(j.id) && !isTerminalExportStatus(j.status)) return <div>Cancelling…</div>;
    if (j.status === "failed" || j.status === "session_expired") {
      return (
        <>
          <div className="export-error">{label}</div>
          {j.errorMessage ? <div className="export-error">{j.errorMessage}</div> : null}
        </>
      );
    }
    if (j.status === "cancelled") return <div className="muted">{label}</div>;
    return <div>{label}</div>;
  };

  const rowsCell = (j: ExportJobDto) =>
    !isTerminalExportStatus(j.status) && j.totalRows != null
      ? `${j.rowsWritten.toLocaleString()} of ${j.totalRows.toLocaleString()}`
      : j.rowsWritten.toLocaleString();

  const actions = (j: ExportJobDto) => {
    const disabled = busy.has(j.id) || cancelling.has(j.id);
    if (j.status === "queued" || j.status === "running") {
      return (
        <button type="button" className="ghost-sm" disabled={disabled} onClick={() => onCancel(j)}>
          Cancel
        </button>
      );
    }
    return (
      <>
        {j.status === "complete" && (
          <button type="button" className="ghost-sm" disabled={busy.has(j.id)} onClick={() => onDownload(j)}>
            Download
          </button>
        )}
        <button type="button" className="ghost-sm ghost-danger" disabled={busy.has(j.id)} onClick={() => onDelete(j)}>
          Delete
        </button>
      </>
    );
  };

  return (
    <div className="dashboard-list">
      <ChartCard title="Exports" description="Your background CSV exports. Files are kept until they expire.">
        {loading && <div className="muted">Loading exports…</div>}
        {error?.kind === "permission" && <div className="widget-permission-denied">Permission denied</div>}
        {error && error.kind !== "permission" && (
          <>
            <div className="export-error">{error.message}</div>
            <button type="button" className="ghost-sm" onClick={reload}>Retry</button>
          </>
        )}
        {actionError && <div className="export-error">{actionError}</div>}
        {!loading && !error && jobs.length === 0 && (
          <div className="muted">No exports yet. Use Download on a large records table to start one.</div>
        )}
        {!loading && !error && jobs.length > 0 && (
          <div className="datasets-table exports-table">
            <div className="ds-header">
              <span>Name</span>
              <span>Status</span>
              <span>Rows</span>
              <span>Size</span>
              <span>Started</span>
              <span>Expires</span>
              <span>Actions</span>
            </div>
            {jobs.map((j) => (
              <div key={j.id} className="ds-row">
                <span>
                  <span className="ds-name">{exportDisplayName(j)}</span>
                  <div className="ds-meta">{`${j.dashboardName ?? "Deleted dashboard"} · ${j.widgetTitle ?? "Deleted widget"}`}</div>
                </span>
                <span>{statusCell(j)}</span>
                <span>{rowsCell(j)}</span>
                <span>{formatExportBytes(j.fileBytes)}</span>
                <span className="ds-meta">{parseExportTimestamp(j.createdAt).toLocaleString()}</span>
                <span>{j.status === "complete" ? relativeExpiry(j.expiresAt) : "—"}</span>
                <span className="ds-actions">{actions(j)}</span>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
};

export default ExportsPage;
