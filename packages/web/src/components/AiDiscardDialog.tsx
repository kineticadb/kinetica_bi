import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { discardAiSession } from "../lib/aiOps/aiFilterEffects";
import { cancelAsk } from "../lib/aiSession/askRunner";
import { AI_CHAT_COPY } from "../lib/aiSession/chatText";

/**
 * 137 D-17: confirm before discarding every AI change. Portalled to <body> (grid CSS transforms
 * trap position:fixed inside widgets). Local open state lives in AiChangeBar; never touches pendingLeave.
 */
export default function AiDiscardDialog({ onClose }: { onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      returnTo?.focus?.();
    };
  }, []);

  const discard = () => {
    cancelAsk();
    discardAiSession();
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-discard-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title" id="ai-discard-dialog-title">
            {AI_CHAT_COPY.discardTitle}
          </div>
        </div>
        <div className="modal-body">
          <p>{AI_CHAT_COPY.discardBody}</p>
          <div className="ds-actions">
            <button ref={cancelRef} type="button" className="btn-primary btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="ghost-sm ghost-danger" onClick={discard}>
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
