import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAiSessionStore } from "../store/aiSessionStore";

/**
 * D-15 leave confirmation. Mounted once in App.tsx; renders null unless a leave is pending.
 * Portalled to <body>: grid CSS transforms trap position:fixed inside widgets.
 */
export default function AiLeaveDialog() {
  const pendingLeave = useAiSessionStore((s) => s.pendingLeave);
  const open = pendingLeave !== null;
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    stayRef.current?.focus();
    return () => {
      returnTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const stay = () => useAiSessionStore.getState().setPendingLeave(null);
  const discard = () => {
    const p = useAiSessionStore.getState().pendingLeave;
    useAiSessionStore.getState().reset();
    p?.proceed();
  };

  return createPortal(
    <div className="modal-overlay" onClick={stay}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-leave-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            stay();
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title" id="ai-leave-dialog-title">
            You have unsaved AI changes
          </div>
        </div>
        <div className="modal-body">
          <p>
            Leaving will discard the changes the AI made to this dashboard. Saving AI changes is coming soon.
          </p>
          <div className="ds-actions">
            <button ref={stayRef} type="button" className="btn-primary btn-sm" onClick={stay}>
              Stay
            </button>
            <button type="button" className="ghost-sm ghost-danger" onClick={discard}>
              Discard and leave
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
