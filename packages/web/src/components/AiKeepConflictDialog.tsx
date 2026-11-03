import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { KEEP_CONFLICT_MESSAGE } from "@kinetica-bi/shared";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";

/**
 * 141 D-08: shown on a 409 from Keep. Stay keeps the AI changes; reload discards them and loads the latest.
 * Portalled to <body>; presentational (AiChangeBar wires the handlers).
 */
export default function AiKeepConflictDialog({ onStay, onReload }: { onStay: () => void; onReload: () => void }) {
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    stayRef.current?.focus();
    return () => {
      returnTo?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-overlay" onClick={onStay}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-keep-conflict-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onStay();
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title" id="ai-keep-conflict-dialog-title">
            {AI_CHAT_COPY.conflictTitle}
          </div>
        </div>
        <div className="modal-body">
          <p>{KEEP_CONFLICT_MESSAGE}</p>
          <div className="ds-actions">
            <button ref={stayRef} type="button" className="btn-primary btn-sm" onClick={onStay}>
              {AI_CHAT_COPY.conflictStay}
            </button>
            <button type="button" className="ghost-sm ghost-danger" onClick={onReload}>
              {AI_CHAT_COPY.conflictReload}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
