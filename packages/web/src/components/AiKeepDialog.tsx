import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AI_CHAT_COPY, keepConfirmBody } from "../lib/aiSession/chatText";

/**
 * 141 D-09: confirm before persisting the AI change set. Portalled to <body> (grid CSS transforms
 * trap position:fixed inside widgets). Presentational; AiChangeBar owns open state and the save call.
 */
export default function AiKeepDialog({
  counts,
  viewTogglesNotSaved,
  onSave,
  onCancel,
}: {
  counts: { added: number; edited: number; removed: number };
  viewTogglesNotSaved?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      returnTo?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-keep-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title" id="ai-keep-dialog-title">
            {AI_CHAT_COPY.keepConfirmTitle}
          </div>
        </div>
        <div className="modal-body">
          <p>{keepConfirmBody(counts)}</p>
          {viewTogglesNotSaved && <p>{AI_CHAT_COPY.viewTogglesNotSaved}</p>}
          <div className="ds-actions">
            <button type="button" className="btn-primary btn-sm" onClick={onSave}>
              {AI_CHAT_COPY.keepSave}
            </button>
            <button ref={cancelRef} type="button" className="ghost-sm" onClick={onCancel}>
              {AI_CHAT_COPY.keepCancel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
