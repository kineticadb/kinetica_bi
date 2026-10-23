import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { discardGeneratedDashboard } from "../api/client";
import { discardAiSession } from "../lib/aiOps/aiFilterEffects";
import { cancelAsk } from "../lib/aiSession/askRunner";

export const GENERATED_COPY = {
  pendingNote: "This generated dashboard isn't kept yet. Ask the AI Assistant to build it, or discard it.",
  discardButton: "Discard dashboard",
  dialogTitle: "Discard this dashboard?",
  dialogBody: "It was generated and never kept. Discarding deletes it with its charts and AI views.",
  discarding: "Discarding…",
  failed: "Couldn't discard the dashboard. Try again.",
} as const;

/** 142 D-07: shown on an unkept generated dashboard with no AI changes (e.g. a failed generation) so it can be discarded. */
export function GeneratedPendingNote({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="ai-change-bar" role="status">
      <span className="ai-change-bar-text">{GENERATED_COPY.pendingNote}</span>
      <div className="ds-actions">
        <button type="button" className="ghost-sm ghost-danger" onClick={onDiscard}>
          {GENERATED_COPY.discardButton}
        </button>
      </div>
    </div>
  );
}

/** 142 D-05: confirm, then delete the unkept generated dashboard server-side. Portalled (grid transforms trap fixed). */
export function GeneratedDiscardDialog({
  dashboardId,
  onClose,
  onDiscarded,
}: {
  dashboardId: number;
  onClose: () => void;
  onDiscarded: (id: number) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      returnTo?.focus?.();
    };
  }, []);

  const discard = async () => {
    setBusy(true);
    setError(null);
    cancelAsk();
    discardAiSession();
    try {
      await discardGeneratedDashboard(dashboardId);
      onDiscarded(dashboardId);
    } catch {
      setError(GENERATED_COPY.failed);
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generated-discard-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title" id="generated-discard-dialog-title">
            {GENERATED_COPY.dialogTitle}
          </div>
        </div>
        <div className="modal-body">
          <p>{GENERATED_COPY.dialogBody}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="ds-actions">
            <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={() => void discard()}>
              {busy ? GENERATED_COPY.discarding : "Discard"}
            </button>
            <button ref={cancelRef} type="button" className="ghost-sm" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
