import { useEffect, useRef, useState } from "react";
import {
  cancelExportJob,
  NAVIGATE_EXPORTS_EVENT,
  startExport,
  type ExportFormat,
  type ExportStartOptions,
  type StartExportBody,
} from "../api/client";
import {
  EXPORT_NETWORK_ERROR_MESSAGE,
  startExportDownload,
} from "../lib/exportDownload";
import {
  defaultExportName,
  exportFileName,
  exportLimitsHint,
  exportRowCapMessage,
  formatExportBytes,
  isTerminalExportStatus,
} from "../lib/exportFormat";
import { useAuthStore } from "../store/auth";
import {
  setDialogJob,
  trackExport,
  useExportTrackerStore,
} from "../store/exportTracker";

const OVERRIDE_NOTE =
  "Exports use the saved widget settings. Filters and sort are included; widget-action overrides are not.";

export type ExportDialogProps = {
  widgetTitle: string;
  totalCount: number | null;
  inBrowserCap: number;
  formattedAvailable: boolean; // false when the widget has no numeric tableId (server falls back to raw)
  overrideActive: boolean; // D-04 note
  dvNotReady: boolean; // dv-bound widget whose dynamic view is not "materialized"
  buildRequest: (options: ExportStartOptions) => StartExportBody;
  onPartialDownload: () => void; // runs the existing in-browser download (handleDownloadCsv)
  onClose: () => void;
};

export default function ExportDialog(props: ExportDialogProps) {
  const {
    widgetTitle,
    totalCount,
    inBrowserCap,
    formattedAvailable,
    overrideActive,
    dvNotReady,
    buildRequest,
    onPartialDownload,
    onClose,
  } = props;
  const limits = useAuthStore((s) => s.exportLimits);

  const [name, setName] = useState(() =>
    defaultExportName(widgetTitle, new Date()),
  );
  const [format, setFormat] = useState<ExportFormat>("raw");
  const [gzip, setGzip] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const job = useExportTrackerStore((s) => (jobId ? s.jobs[jobId] : undefined));

  const returnTo = useRef(document.activeElement as HTMLElement | null);
  const jobIdRef = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const nameEmpty = name.trim() === "";
  const overRowLimit =
    totalCount !== null &&
    limits.maxRows !== null &&
    totalCount > limits.maxRows;
  const rowCapMessage =
    totalCount !== null && limits.maxRows !== null && overRowLimit
      ? exportRowCapMessage(totalCount, limits.maxRows)
      : null;
  const canStart = !nameEmpty && !overRowLimit && !starting && !dvNotReady;
  const limitsHint = exportLimitsHint(limits);

  function close() {
    if (jobId) setDialogJob(null);
    onClose();
  }
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The records widget can unmount while the dialog is open (remount, URL/history change) without close() running.
  // Release the tracker's dialog slot so a finished export still toasts (D-11); only clear our own claim.
  useEffect(
    () => () => {
      const id = jobIdRef.current;
      if (id && useExportTrackerStore.getState().dialogJobId === id)
        setDialogJob(null);
      returnTo.current?.focus?.();
    },
    [],
  );

  const terminal = job ? isTerminalExportStatus(job.status) : false;
  useEffect(() => {
    if (!jobId) return;
    bodyRef.current
      ?.querySelector<HTMLButtonElement>(".ds-actions button")
      ?.focus();
  }, [jobId, terminal]);

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const dto = await startExport(
        buildRequest({ gzip, format, name: name.trim() }),
      );
      trackExport(dto);
      setDialogJob(dto.id);
      jobIdRef.current = dto.id;
      setJobId(dto.id);
    } catch (e) {
      setStartError(
        e instanceof TypeError
          ? EXPORT_NETWORK_ERROR_MESSAGE
          : (e as Error).message,
      );
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!jobId) return;
    setCancelling(true);
    setActionError(null);
    try {
      const dto = await cancelExportJob(jobId);
      if (dto) trackExport(dto);
    } catch (e) {
      setCancelling(false);
      setActionError((e as Error).message);
    }
  }

  function seeAll() {
    close();
    window.dispatchEvent(new CustomEvent(NAVIGATE_EXPORTS_EVENT));
  }

  function partial() {
    close();
    onPartialDownload();
  }

  const seeAllButton = (
    <button type="button" className="ghost-sm" onClick={seeAll}>
      See all exports
    </button>
  );

  function renderProgress() {
    if (!job) {
      return (
        <>
          <div className="muted">
            This export is no longer tracked. See all exports for its status.
          </div>
          <div className="ds-actions">
            <button type="button" className="ghost-sm" onClick={close}>
              Close
            </button>
          </div>
          {seeAllButton}
        </>
      );
    }
    const complete = job.status === "complete";
    const active = job.status === "queued" || job.status === "running";
    const pct = complete
      ? 100
      : job.totalRows
        ? Math.min(100, (job.rowsWritten / job.totalRows) * 100)
        : 0;
    let text: string | null = null;
    if (job.status === "queued") text = "Waiting to start…";
    else if (complete)
      text = `${(job.totalRows ?? job.rowsWritten).toLocaleString()} rows · ${formatExportBytes(job.fileBytes)}`;
    else if (job.status === "cancelled") text = null;
    else if (job.totalRows != null)
      text = `${job.rowsWritten.toLocaleString()} of ${job.totalRows.toLocaleString()} rows`;
    else text = `${job.rowsWritten.toLocaleString()} rows`;
    const failed = job.status === "failed" || job.status === "session_expired";
    return (
      <>
        <div className="ds-name">{name.trim()}</div>
        {job.status !== "cancelled" && (
          <div
            className="export-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuenow={job.rowsWritten}
            {...(job.totalRows != null
              ? { "aria-valuemax": job.totalRows }
              : {})}
          >
            <div
              className="export-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="muted" aria-live="polite">
          {text}
        </div>
        {failed && (
          <div className="export-error" role="alert">
            {job.errorMessage ?? "Export failed."}
          </div>
        )}
        {job.status === "cancelled" && (
          <div className="muted">Export cancelled.</div>
        )}
        {actionError && (
          <div className="export-error" role="alert">
            {actionError}
          </div>
        )}
        <div className="ds-actions">
          {active && (
            <button
              type="button"
              className="ghost-sm"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {cancelling ? "Cancelling…" : "Cancel export"}
            </button>
          )}
          {complete && (
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void startExportDownload(job.id)}
            >
              Download
            </button>
          )}
          <button type="button" className="ghost-sm" onClick={close}>
            Close
          </button>
        </div>
        {seeAllButton}
      </>
    );
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="export-dialog-title">
            Export records
          </div>
          <button type="button" className="ghost-sm" onClick={close}>
            Close
          </button>
        </div>
        <div className="modal-body" ref={bodyRef}>
          {jobId ? (
            <div className="config-panel">{renderProgress()}</div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canStart) void start();
              }}
            >
              <div className="config-panel">
                {overrideActive && (
                  <div className="config-hint">{OVERRIDE_NOTE}</div>
                )}
                <label className="ds-field">
                  <span className="ds-field-label">Name</span>
                  <input
                    type="text"
                    autoFocus
                    maxLength={200}
                    value={name}
                    disabled={starting}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <div className="config-hint">{exportFileName(name, gzip)}</div>
                <div className="config-group">
                  <span className="config-group-label">Values</span>
                  <label className="config-toggle">
                    <input
                      type="radio"
                      name="export-format"
                      checked={format === "raw"}
                      disabled={starting}
                      onChange={() => setFormat("raw")}
                    />
                    Raw values
                  </label>
                  <div className="config-hint">
                    Real column names and unformatted values.
                  </div>
                  <label className="config-toggle">
                    <input
                      type="radio"
                      name="export-format"
                      checked={format === "formatted"}
                      disabled={starting || !formattedAvailable}
                      onChange={() => setFormat("formatted")}
                    />
                    Formatted values
                  </label>
                  <div className="config-hint">
                    Display labels and number formats from Format columns.
                  </div>
                  {!formattedAvailable && (
                    <div className="config-hint">
                      Not available for this widget: it has no dataset with
                      column formats.
                    </div>
                  )}
                </div>
                <label className="config-toggle">
                  <input
                    type="checkbox"
                    checked={gzip}
                    disabled={starting}
                    onChange={(e) => setGzip(e.target.checked)}
                  />
                  Compress (.csv.gz)
                </label>
                {limitsHint && <div className="config-hint">{limitsHint}</div>}
                {dvNotReady && (
                  <div className="export-error" role="alert">
                    The data view is not ready yet.
                  </div>
                )}
                {rowCapMessage && (
                  <div className="export-error" role="alert">
                    {rowCapMessage}
                  </div>
                )}
                {startError && (
                  <div className="export-error" role="alert">
                    {startError}
                  </div>
                )}
                <div className="ds-actions">
                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                    disabled={!canStart}
                    title={
                      nameEmpty ? "Enter a name for the export." : undefined
                    }
                  >
                    {starting ? "Starting…" : "Start export"}
                  </button>
                  <button type="button" className="ghost-sm" onClick={partial}>
                    {`Download first ${inBrowserCap.toLocaleString()} rows now`}
                  </button>
                  <button type="button" className="ghost-sm" onClick={close}>
                    Cancel
                  </button>
                </div>
                {seeAllButton}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
